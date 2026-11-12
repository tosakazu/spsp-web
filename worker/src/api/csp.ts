/**
 * CSP の違反報告の受け口と書き出し (セキュリティレビュー M4)。
 *
 *   POST /api/csp-report   ブラウザが送る違反報告。旧形式 (application/csp-report: {"csp-report":{…}}) と
 *                          Reporting API (application/reports+json: [{type:"csp-violation", body:{…}}]) の両方。
 *                          (directive, blocked, path, sample, source) でまとめて数える。クエリ文字列は保存しない。応答は 204 (中身なし)
 *                          sample = インラインのスクリプトの先頭 (CSP の 'report-sample'、40 文字まで)、source = 違反を起こしたスクリプトの origin
 *                          (どちらも 2026-10-28 から。インラインの違反が Google アナリティクスか拡張機能かを見分けるため)
 *   action: "csp_export"   { key } → { reports:[{directive, blocked, path, hits, first_seen, last_seen}], total }
 *                          鍵はエクスポートと同じ (exportKeyOk)
 */
import type { Config } from '../config.ts';
import { CSP_REPORT_MAX_KEYS, CSP_REPORT_PER_IP_PER_MIN } from '../config.ts';
import type { Store } from '../store.ts';
import { exportKeyOk } from './export.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { formatIso } from './time.ts';

export interface CspEntry { directive: string; blocked: string; path: string; sample: string; source: string }

/** script-sample / sample → 先頭 40 文字 (制御文字は空白に)。無ければ '' */
export function normalizeSample(v: unknown): string {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 40);
}
/** source-file / sourceFile → origin (拡張機能なら chrome-extension などの種類)。無ければ '' */
export function normalizeSource(v: unknown): string {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return /^(https?|wss?):$/.test(u.protocol) ? u.origin : u.protocol.slice(0, -1).slice(0, 30);
  } catch (_) {
    return 'other';
  }
}

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'data', 'blob', 'self']);

/** blocked-uri → origin か種類 (クエリ・パスは落とす)。 */
export function normalizeBlocked(v: unknown): string {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return 'none';
  const lower = s.toLowerCase().replace(/:$/, '');
  if (KEYWORDS.has(lower)) return lower;
  try {
    const u = new URL(s);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.protocol.slice(0, -1);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'wss:' || u.protocol === 'ws:') return u.origin;
    return u.protocol.slice(0, -1).slice(0, 30);
  } catch (_) {
    return 'other';
  }
}

/** document-uri → パスだけ (クエリ・# なし、200 文字まで)。 */
export function normalizePath(v: unknown): string {
  const s = String(v === undefined || v === null ? '' : v);
  try {
    return new URL(s).pathname.slice(0, 200) || '/';
  } catch (_) {
    const p = s.split(/[?#]/)[0];
    return p.startsWith('/') ? p.slice(0, 200) : 'other';
  }
}

/** 違反した directive の名前 (script-src-elem など)。 */
export function normalizeDirective(eff: unknown, violated: unknown): string {
  const s = String(eff || violated || '').trim().split(/\s+/)[0].toLowerCase();
  return /^[a-z-]{1,40}$/.test(s) ? s : 'unknown';
}

/** 報告の本文 (JSON を読んだもの) から違反の並びを取り出す。読めなければ []。 */
export function parseCspReports(body: unknown): CspEntry[] {
  const out: CspEntry[] = [];
  const one = (r: Record<string, unknown> | null | undefined, legacy: boolean) => {
    if (!r || typeof r !== 'object') return;
    out.push(legacy
      ? { directive: normalizeDirective(r['effective-directive'], r['violated-directive']), blocked: normalizeBlocked(r['blocked-uri']), path: normalizePath(r['document-uri']),
          sample: normalizeSample(r['script-sample']), source: normalizeSource(r['source-file']) }
      : { directive: normalizeDirective(r.effectiveDirective, r.violatedDirective), blocked: normalizeBlocked(r.blockedURL), path: normalizePath(r.documentURL),
          sample: normalizeSample(r.sample), source: normalizeSource(r.sourceFile) });
  };
  if (Array.isArray(body)) {
    for (const x of body.slice(0, 20)) {
      const o = x as { type?: unknown; body?: Record<string, unknown> };
      if (o && o.type === 'csp-violation') one(o.body, false);
    }
  } else if (body && typeof body === 'object' && (body as Record<string, unknown>)['csp-report']) {
    one((body as Record<string, Record<string, unknown>>)['csp-report'], true);
  }
  return out;
}

/** IP ごとの軽い制限 (この isolate の中だけ。1 分に CSP_REPORT_PER_IP_PER_MIN 件まで)。 */
const ipHits = new Map<string, { minute: number; n: number }>();
export function cspRateOk(ip: string, now: number): boolean {
  const minute = Math.floor(now / 60000);
  const cur = ipHits.get(ip);
  if (!cur || cur.minute !== minute) {
    if (ipHits.size > 5000) ipHits.clear();
    ipHits.set(ip, { minute, n: 1 });
    return true;
  }
  cur.n += 1;
  return cur.n <= CSP_REPORT_PER_IP_PER_MIN;
}

/** POST /api/csp-report の本文 (文字列) を記録する。何があっても例外は投げない (報告の失敗で困る人はいない)。 */
export async function recordCspReport(cfg: Config, store: Store, text: string, ip: string, now: number): Promise<void> {
  if (!cspRateOk(ip || 'unknown', now)) return;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (_) {
    return;
  }
  const ts = formatIso(now, cfg.tsOffsetMin);
  for (const e of parseCspReports(body)) {
    try {
      // sample / source が無いものは今までと同じ key (前からの行に数え続ける)
      const key = e.directive + '|' + e.blocked + '|' + e.path + (e.sample || e.source ? '|' + e.source + '|' + e.sample : '');
      await store.recordCsp(key, e, ts, CSP_REPORT_MAX_KEYS);
    } catch (ex) {
      console.error('csp report store failed: ' + (ex instanceof Error ? ex.message : String(ex)));
      return;
    }
  }
}

/** action: "csp_export" — 鍵つき。多い順。 */
export async function handleCspExport(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  if (!(await exportKeyOk(cfg, req && req.key))) return err('auth_failed', 'エクスポート鍵が違います。');
  const reports = await store.listCsp();
  return ok({ reports, total: reports.length });
}
