/**
 * action: "bracket_structure" — { phases: [phase id, …] } トーナメントシミュレーションの構造 (bracket_struct.ts の fetchSimData) を返す (2026-11-05)。
 * start.gg の公開データ (フェーズ・シード・人数ごとに 1 ブロックの試合) を Worker のトークン (STARTGG_PUBLIC_TOKEN) で読み、
 * Cloudflare のキャッシュに 10 分置く (同じフェーズを何人が開いても start.gg は 10 分に 1 回)。
 * トークンが無い・start.gg が読めないときは not_ready (画面がログインのトークンで直接読む)。
 */
import type { Config } from '../config.ts';
import type { FetchFn } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { startggGql } from './class_bracket.ts';
import { fetchSimData, MAX_PHASES } from './bracket_struct.ts';

const CACHE_SEC = 600;
const MIN_GAP_MS = 750;   // start.gg は 1 分 80 回まで

export async function handleBracketStructure(cfg: Config, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const ids = Array.isArray(req.phases) ? req.phases.map((x) => String(x)) : [];
  if (!ids.length || ids.length > MAX_PHASES || !ids.every((x) => /^\d{1,12}$/.test(x))) return err('bad_request', '入力の形式が正しくありません。', 'bad:phases');
  if (!cfg.publicToken) return err('not_ready', 'サーバーでは読めません。', 'no_token');
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request('https://cache.spsp.games/bracket_structure/' + ids.join('-'));
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return ok({ data: await hit.json(), cached: true });
  }
  let last = 0;
  const token = cfg.publicToken;
  const gql = async (query: string, variables: Record<string, unknown>) => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r = await startggGql(fetchFn, token, query, variables);
    if (!r.ok) throw new Error(r.note);
    return r.json as { data?: unknown; errors?: unknown[] };
  };
  try {
    const data = await fetchSimData(gql, ids, now);
    if (cache) await cache.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_SEC } })).catch(() => undefined);
    return ok({ data, cached: false });
  } catch (e) {
    return err('not_ready', 'start.gg から読めませんでした。', 'sgg:' + String((e as Error).message || e).slice(0, 80));
  }
}
