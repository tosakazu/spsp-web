/**
 * spsp-web Worker — 静的アセット (dist-cf) の配信と /api/* (gas/*.gs の移植)。
 *
 * 順序:
 *   1. /api/*          → API (src/api/router.ts)
 *   2. /               → 301 /jp/
 *   3. 旧 URL          → 301 で /jp/ 配下へ (小さな表)
 *   4. それ以外        → ASSETS (セキュリティヘッダを付ける。callback.html には CSP)
 *
 * 設計: docs/refactor/07_cloudflare_plan.md。
 */
import type { ApiContext } from './api/router.ts';
import { handleApiRequest } from './api/router.ts';
import type { Env } from './config.ts';
import { configFromEnv } from './config.ts';
import { D1Store } from './db.ts';

/**
 * 旧 URL (spsp.games 直下 / gh-pages の /spsp/ 直下にあったもの) の先頭セグメント。
 * ここにあるパスは /jp/ を前置して 301 する (クエリはそのまま。例 /p/?uid=1 → /jp/p/?uid=1)。
 * 地域分離 (2026-09-14) より前のリンクが SNS 等に残っているため。
 */
export const LEGACY_PREFIXES: readonly string[] = [
  'p', 't', 'c', 'pref', 'local', 'en', 'seed', 'seed-upload', 'sim', 'priority', 'events', 'news', 'blog', 'bracket',
  'index.html', 'overview.html', 'details.html', 'math.html', 'eval.html', 'vote.html', 'post.html', 'callback.html',
];

/** 地域プレフィックス (これらの配下はそのまま assets に渡す)。 */
const REGION_PREFIXES = ['/jp/', '/na/', '/b/'];

/** 旧 URL なら付け替え先のパス、そうでなければ null。 */
export function legacyRedirectTarget(pathname: string, sitePrefix: string): string | null {
  // 旧サイト (tosakazu.github.io/spsp/…) のドメインだけ差し替えた URL: spsp.games/spsp/… → /jp/… (2026-09-28)
  if (pathname === '/spsp' || pathname.startsWith('/spsp/')) return sitePrefix.replace(/\/+$/, '') + (pathname.slice(5) || '/');
  if (REGION_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const first = pathname.replace(/^\/+/, '').split('/')[0];
  if (!first || !LEGACY_PREFIXES.includes(first)) return null;
  return sitePrefix.replace(/\/+$/, '') + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

/**
 * 言語別の木だった頃の URL (/jp/en/…、/na/ja/…、2026-09-28 まで) → 同じページ + ?lang=<言語> (配信は既定言語の 1 系統だけになった)。
 * 他のクエリはそのまま残す。該当しなければ null。
 */
export function langDirRedirectTarget(pathname: string, search: string): string | null {
  const m = /^\/(jp|na)\/(en|ja)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const params = new URLSearchParams(search);
  params.set('lang', m[2]);
  return '/' + m[1] + (m[3] || '/') + '?' + params.toString();
}

/** callback.html の CSP。site/callback.html の meta と同じで、connect-src だけ自分自身 (= /api)。 */
export const CALLBACK_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** アセット応答にヘッダを足す (Response は immutable なことがあるので作り直す)。 */
export function withSecurityHeaders(res: Response, pathname: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (/\/callback(\.html)?$/.test(pathname)) {   // 静的配信は /jp/callback.html → /jp/callback に寄せる (html_handling) ので両方
    // INV-8: 認可コードが URL に載るページ。外部リソース禁止・referrer も送らない。
    out.headers.set('Content-Security-Policy', CALLBACK_CSP);
    out.headers.set('Referrer-Policy', 'no-referrer');
    out.headers.set('Cache-Control', 'no-store');
  }
  return out;
}

/** 公開データの読み出し (投票の資格判定)。DATA_ORIGIN が URL ならそこ、"assets:<prefix>" なら ASSETS。 */
function makeDataFetch(env: Env, request: Request): (path: string) => Promise<Response> {
  const origin = String(env.DATA_ORIGIN || '').replace(/\/+$/, '');
  if (/^https?:\/\//.test(origin)) {
    return (path) => fetch(origin + path, { headers: { Accept: 'application/json' } });
  }
  const prefix = (origin.replace(/^assets:/, '') || String(env.SITE_PREFIX || '/jp')).replace(/\/+$/, '');
  return (path) => env.ASSETS.fetch(new Request(new URL(prefix + path, request.url).toString(), { method: 'GET' }));
}

/** 公開データの読み出し。キャラの表 (/data/char_emoji.json) だけはサイトと一緒に配信している静的ファイルから読む
 *  (2026-09-28 から表はフロント = spsp-web が持つ。R2 の同名ファイルは旧サイト用)。選手データは DATA_ORIGIN */
function makePublicFetch(env: Env, request: Request): (path: string) => Promise<Response> {
  const data = makeDataFetch(env, request);
  const sitePrefix = String(env.SITE_PREFIX || '/jp').replace(/\/+$/, '');
  return (path) => path === '/data/char_emoji.json'
    ? env.ASSETS.fetch(new Request(new URL(sitePrefix + path, request.url).toString(), { method: 'GET' }))
    : data(path);
}

/** state の payload (base64url JSON、署名は見ない) の r = 戻り先パスから地域の接頭辞を決める。読めなければ既定の地域 */
export function regionPrefixFromState(state: string | null, sitePrefix: string): string {
  try {
    const body = String(state || '').split('.')[0];
    if (!body) return sitePrefix;
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const r = String((JSON.parse(json) || {}).r || '');
    const m = /^\/([a-z]{2})\//.exec(r);
    return m ? '/' + m[1] : sitePrefix;
  } catch { return sitePrefix; }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sitePrefix = String(env.SITE_PREFIX || '/jp');

    // 1. API
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const ctx: ApiContext = {
        cfg: configFromEnv(env),
        store: new D1Store(env.DB),
        fetch: (input, init) => fetch(input, init),
        dataFetch: makePublicFetch(env, request),
        now: () => Date.now(),
      };
      return handleApiRequest(ctx, request);
    }

    // 2a. 地域に依らないコールバック (start.gg アプリの redirect URI = <origin>/callback.html)。
    //     state (署名付き。payload の r = 戻り先パス) を見て、その地域の callback.html へ渡す (code / state はそのまま)
    if (url.pathname === '/callback.html') {
      const prefix = regionPrefixFromState(url.searchParams.get('state'), sitePrefix);
      return Response.redirect(new URL(prefix + '/callback.html' + url.search, url).toString(), 302);
    }

    // 2. ルート → 既定の地域
    if (url.pathname === '/') {
      return Response.redirect(new URL(sitePrefix + '/' + url.search, url).toString(), 301);
    }

    // 3. 旧 URL
    const legacy = legacyRedirectTarget(url.pathname, sitePrefix);
    if (legacy) {
      // 旧 /en/… は地域を足した後に言語の付け替えもする (1 回の 301 で)
      const target = langDirRedirectTarget(legacy, url.search) || legacy + url.search;
      return Response.redirect(new URL(target, url).toString(), 301);
    }
    // 3b. 言語別の木だった頃の URL (/jp/en/…) → ?lang=en
    const langTarget = langDirRedirectTarget(url.pathname, url.search);
    if (langTarget) {
      return Response.redirect(new URL(langTarget, url).toString(), 301);
    }

    // 4. 静的アセット
    const res = await env.ASSETS.fetch(request);
    return withSecurityHeaders(res, url.pathname);
  },
} satisfies ExportedHandler<Env>;
