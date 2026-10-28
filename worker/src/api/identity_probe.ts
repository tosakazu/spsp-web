/**
 * preview 専用の確認: ログイン (scope user.identity だけ) のアクセストークンで、start.gg の公開データが読めるか。
 * STARTGG_IDENTITY_PROBE = "1" の環境 (wrangler.toml の preview だけ) で、login の直後にいくつか問い合わせて
 * 結果 (読めたか・件数・先頭の名前・エラーの文) を login の応答に足す。トークンは返さない・保存しない (INV-4)。
 * 問い合わせる大会は公開済みの過去の大会 (第74回スマバトSP) と、開催予定の大会の一覧。
 */
import { GQL_URL } from '../config.ts';
import type { FetchFn } from './oauth.ts';

export type ProbeResult = { name: string; ok: boolean; detail: string };

const EID = 1720986;   // 第74回スマバトSP / 予選あり1on1トーナメント (2026-10-24、公開済み)

/** 名前 → [query, 応答の data から短い説明を作る関数] */
const PROBES: [string, string, (d: any) => string][] = [
  ['currentUser', 'query { currentUser { id player { gamerTag } } }',
    (d) => (d.currentUser ? 'id ' + d.currentUser.id : '')],
  ['tournament (slug)', 'query { tournament(slug: "tournament/74-sp-2") { id name numAttendees } }',
    (d) => (d.tournament ? `${d.tournament.name} (${d.tournament.numAttendees} 人)` : '')],
  ['event entrants', `query { event(id: ${EID}) { name numEntrants entrants(query: { page: 1, perPage: 3 }) { nodes { name } } } }`,
    (d) => (d.event ? `${d.event.numEntrants} 人: ` + (((d.event.entrants || {}).nodes) || []).map((n: any) => n.name).join(', ') : '')],
  ['seeds / pools', `query { event(id: ${EID}) { publishing phaseGroups { displayIdentifier seeds(query: { page: 1, perPage: 2 }) { nodes { seedNum entrant { name } } } } } }`,
    (d) => {
      const gs = (d.event && d.event.phaseGroups) || [];
      const s = gs[0] && gs[0].seeds && gs[0].seeds.nodes ? gs[0].seeds.nodes.map((n: any) => '#' + n.seedNum + ' ' + ((n.entrant || {}).name || '')).join(', ') : '';
      return d.event ? `プール ${gs.length} 個${s ? ' / ' + s : ''} / publishing ${JSON.stringify(d.event.publishing)}` : '';
    }],
  ['sets', `query { event(id: ${EID}) { sets(page: 1, perPage: 3) { pageInfo { total } nodes { fullRoundText displayScore } } } }`,
    (d) => (d.event && d.event.sets ? `${d.event.sets.pageInfo.total} 試合: ` + d.event.sets.nodes.map((n: any) => n.displayScore).join(' / ') : '')],
  ['upcoming tournaments', 'query { tournaments(query: { perPage: 3, filter: { countryCode: "JP", upcoming: true, videogameIds: [1386] } }) { nodes { name startAt } } }',
    (d) => (d.tournaments ? (d.tournaments.nodes || []).map((n: any) => n.name).join(', ') : '')],
];

export async function runIdentityProbe(accessToken: string, fetchFn: FetchFn): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const [name, query, describe] of PROBES) {
    try {
      const res = await fetchFn(GQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
        body: JSON.stringify({ query }),
      });
      let json: any = null;
      try { json = await res.json(); } catch (_) { /* 下で HTTP の番号だけ出す */ }
      if (res.status !== 200 || !json) { out.push({ name, ok: false, detail: 'HTTP ' + res.status }); continue; }
      if (json.errors) {
        const msg = (Array.isArray(json.errors) ? json.errors.map((e: any) => e && e.message).join(' | ') : String(json.errors)) || 'errors';
        out.push({ name, ok: false, detail: String(msg).slice(0, 300) });
        continue;
      }
      const detail = describe(json.data || {});
      out.push({ name, ok: !!detail, detail: detail ? detail.slice(0, 300) : 'data が空 (null)' });
    } catch (ex) {
      out.push({ name, ok: false, detail: 'fetch failed: ' + (ex instanceof Error ? ex.message : String(ex)).slice(0, 200) });
    }
  }
  return out;
}
