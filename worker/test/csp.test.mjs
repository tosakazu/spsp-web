// サイトの CSP (段階 1 = report-only) と違反報告の受け口・書き出し。セキュリティレビュー M4
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import worker, { withSecurityHeaders, SITE_CSP, CALLBACK_CSP } from '../src/index.ts';
import { makeEnv, post, http } from './_env.mjs';
import { parseCspReports, normalizeBlocked, normalizePath, cspRateOk } from '../src/api/csp.ts';
import { deriveExportKey } from '../src/api/export.ts';
import { CSP_REPORT_MAX_KEYS, CSP_REPORT_PER_IP_PER_MIN } from '../src/config.ts';

const html = (body = '<p>x</p>') => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

test('CSP_MODE: report-only は HTML に Report-Only、enforce は Content-Security-Policy、未設定は付けない', () => {
  let r = withSecurityHeaders(html(), '/jp/index.html', 'report-only');
  assert.strictEqual(r.headers.get('content-security-policy-report-only'), SITE_CSP);
  assert.strictEqual(r.headers.get('content-security-policy'), null);
  r = withSecurityHeaders(html(), '/jp/', 'enforce');
  assert.strictEqual(r.headers.get('content-security-policy'), SITE_CSP);
  assert.strictEqual(r.headers.get('content-security-policy-report-only'), null);
  for (const mode of [undefined, '', 'off']) {
    r = withSecurityHeaders(html(), '/jp/', mode);
    assert.strictEqual(r.headers.get('content-security-policy'), null);
    assert.strictEqual(r.headers.get('content-security-policy-report-only'), null);
  }
  // HTML 以外 (JS・JSON・画像) には付けない
  r = withSecurityHeaders(new Response('x', { headers: { 'Content-Type': 'application/javascript' } }), '/jp/js/a.js', 'report-only');
  assert.strictEqual(r.headers.get('content-security-policy-report-only'), null);
  // callback は今までの厳しい CSP のまま (Report-Only は付けない)
  r = withSecurityHeaders(html(), '/jp/callback', 'report-only');
  assert.strictEqual(r.headers.get('content-security-policy'), CALLBACK_CSP);
  assert.strictEqual(r.headers.get('content-security-policy-report-only'), null);
});

test('SITE_CSP: 依頼どおりの指定と report-uri', () => {
  for (const s of ["default-src 'self'", "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://static.cloudflareinsights.com", 'https://cloudflareinsights.com;',
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", 'report-uri /api/csp-report', "worker-src 'self' blob:",
    'https://*.google-analytics.com', 'https://data.spsp.games']) {
    assert.ok(SITE_CSP.includes(s), s);
  }
  assert.ok(!/unsafe-eval/.test(SITE_CSP));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(SITE_CSP));
});

test('wrangler.toml: CSP_MODE は 3 環境 (本番・preview・na) とも同じ値 (assemble_dist.sh は最初の値を _headers に使う)', () => {
  const t = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const sections = t.split(/^\[/m);
  const withMode = sections.filter((s) => /^CSP_MODE\s*=/m.test(s)).map((s) => s.split(']')[0]);
  assert.deepStrictEqual(withMode, ['vars', 'env.preview.vars', 'env.na.vars']);
  const modes = [...t.matchAll(/^CSP_MODE = "([^"]*)"/gm)].map((m) => m[1]);
  assert.deepStrictEqual(modes, ['report-only', 'report-only', 'report-only']);
});

test('fetch handler: env.CSP_MODE で静的 HTML と 404 ページに付く', async () => {
  const env = { SITE_PREFIX: '/jp', CSP_MODE: 'report-only', DB: {},
    ASSETS: { fetch: async (req) => ['/_errors/404', '/jp/'].includes(new URL(req.url).pathname)
      ? html() : new Response('nf', { status: 404 }) } };
  const page = await worker.fetch(new Request('https://spsp.games/jp/'), env);
  assert.strictEqual(page.headers.get('content-security-policy-report-only'), SITE_CSP);
  const nf = await worker.fetch(new Request('https://spsp.games/jp/nothing'), env);
  assert.strictEqual(nf.status, 404);
  assert.strictEqual(nf.headers.get('content-security-policy-report-only'), SITE_CSP);
});

test('違反報告の読み取り: 旧形式と Reporting API。クエリは残さない', () => {
  assert.deepStrictEqual(parseCspReports({ 'csp-report': {
    'document-uri': 'https://spsp.games/jp/callback?code=SECRET&state=x', 'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=SECRET',
  } }), [{ directive: 'script-src-elem', blocked: 'https://evil.example', path: '/jp/callback' }]);
  assert.deepStrictEqual(parseCspReports([
    { type: 'csp-violation', body: { documentURL: 'https://spsp.games/jp/p/?d=abc#x', effectiveDirective: 'script-src-attr', blockedURL: 'inline' } },
    { type: 'deprecation', body: {} },
    { type: 'csp-violation', body: { documentURL: 'https://spsp.games/jp/', effectiveDirective: 'script-src', blockedURL: 'eval' } },
  ]), [
    { directive: 'script-src-attr', blocked: 'inline', path: '/jp/p/' },
    { directive: 'script-src', blocked: 'eval', path: '/jp/' },
  ]);
  assert.deepStrictEqual(parseCspReports({ 'csp-report': { 'violated-directive': 'img-src https:', 'blocked-uri': 'data:image/png;base64,AAAA' } }),
    [{ directive: 'img-src', blocked: 'data', path: 'other' }]);
  for (const bad of [null, 'x', 1, {}, [1, 2], { 'csp-report': 'x' }]) assert.deepStrictEqual(parseCspReports(bad), []);
  assert.strictEqual(normalizeBlocked('blob:https://spsp.games/uuid'), 'blob');
  assert.strictEqual(normalizeBlocked(''), 'none');
  assert.strictEqual(normalizeBlocked('wss://x.example/ws?k=1'), 'wss://x.example');
  assert.strictEqual(normalizePath('/jp/a?b=1'), '/jp/a');
});

test('POST /api/csp-report: まとめて数える (同じ組は hits+1)。応答は 204、鍵や code は保存しない', async () => {
  const e = makeEnv({});
  const rep = (doc, blocked, dir = 'script-src-elem') => http(e, 'POST', '/api/csp-report',
    { 'csp-report': { 'document-uri': doc, 'effective-directive': dir, 'blocked-uri': blocked } }, { 'cf-connecting-ip': '1.2.3.4' });
  let r = await rep('https://spsp.games/jp/callback?code=SECRET', 'https://cdn.example/a.js?k=SECRET');
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.text, '');
  await rep('https://spsp.games/jp/callback?code=OTHER', 'https://cdn.example/b.js');
  await rep('https://spsp.games/jp/', 'inline', 'script-src-attr');
  const rows = await e.store.listCsp();
  assert.deepStrictEqual(rows.map((x) => [x.directive, x.blocked, x.path, x.hits]), [
    ['script-src-elem', 'https://cdn.example', '/jp/callback', 2],
    ['script-src-attr', 'inline', '/jp/', 1],
  ]);
  assert.ok(!JSON.stringify(rows).includes('SECRET'));
  assert.ok(!JSON.stringify(rows).includes('OTHER'));
  // 壊れた本文・空でも 204、何も書かない
  r = await http(e, 'POST', '/api/csp-report', 'not json');
  assert.strictEqual(r.status, 204);
  assert.strictEqual((await e.store.listCsp()).length, 2);
  assert.strictEqual(e.store.errors.length, 0, 'errors には書かない');
});

test('POST /api/csp-report: 組の数は上限まで (超えた新しい組は捨てる、既にある組は数え続ける)', async () => {
  const e = makeEnv({});
  for (let i = 0; i < CSP_REPORT_MAX_KEYS + 5; i++) {
    await e.store.recordCsp('k' + i, { directive: 'img-src', blocked: 'https://h' + i + '.example', path: '/' }, 't', CSP_REPORT_MAX_KEYS);
  }
  assert.strictEqual(e.store.csp.size, CSP_REPORT_MAX_KEYS);
  await e.store.recordCsp('k0', { directive: 'img-src', blocked: 'https://h0.example', path: '/' }, 't2', CSP_REPORT_MAX_KEYS);
  assert.strictEqual(e.store.csp.get('k0').hits, 2);
});

test('cspRateOk: 同じ IP は 1 分に上限まで', () => {
  const t = Date.parse('2026-10-08T00:00:00Z');
  let n = 0;
  for (let i = 0; i < CSP_REPORT_PER_IP_PER_MIN + 10; i++) if (cspRateOk('9.9.9.9', t)) n++;
  assert.strictEqual(n, CSP_REPORT_PER_IP_PER_MIN);
  assert.ok(cspRateOk('9.9.9.8', t), '別の IP');
  assert.ok(cspRateOk('9.9.9.9', t + 60000), '次の分');
});

test('csp_export: エクスポート鍵で読める (多い順)。鍵違いは auth_failed', async () => {
  const e = makeEnv({ cfg: { exportKey: 'EXP' } });
  await e.store.recordCsp('a', { directive: 'img-src', blocked: 'https://a.example', path: '/' }, 't1', 500);
  await e.store.recordCsp('b', { directive: 'script-src', blocked: 'inline', path: '/jp/' }, 't1', 500);
  await e.store.recordCsp('b', { directive: 'script-src', blocked: 'inline', path: '/jp/' }, 't2', 500);
  const r = await post(e, { action: 'csp_export', key: 'EXP' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.reports[0], { directive: 'script-src', blocked: 'inline', path: '/jp/', hits: 2, first_seen: 't1', last_seen: 't2' });
  assert.strictEqual((await post(e, { action: 'csp_export', key: 'wrong' })).error.code, 'auth_failed');
  // client secret からの導出鍵でも読める (エクスポートと同じ仕組み)
  assert.strictEqual((await post(e, { action: 'csp_export', key: await deriveExportKey(e.cfg.clientSecret) })).ok, true);
});
