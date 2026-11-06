// @ts-check
// my_tournaments.js — start.gg で自分が管理している大会 (currentUser.tournaments、tournamentView "admin") を新しい順に読む (2026-11-06)。
//   start.gg はこの一覧を開始日の新しい順 (これからの大会 → 開催中 → 終わった大会) で返す。
//   なので、開始が sinceSec より前の大会が出たページで止める (そのあとは全部もっと前 = 終わった大会)。
//   たくさんの大会を運営しているアカウントでも全件は読まない。ページを読むたびに onPage で途中の一覧を出せる。
//
//   readAdminTournaments(gql, { fields, sinceSec, perPage?, maxPages?, onPage? })  読んだ大会 (新しい順)。onPage が true を返したらそこで止める
//   isAdminTournament(gql, tournamentId, startAtSec)   一覧にあるか (その大会より開始が前まで来たら止める)
//   gql = (query, variables) => Promise<data>  (各ページの start.gg の呼び方。エラーは投げてよい)

/** @typedef {{ id: number | string, startAt?: number | null, [k: string]: any }} AdminTournament */
/** @typedef {(query: string, variables: Record<string, unknown>) => Promise<any>} Gql */

/** @param {string} fields */
export const adminToursQuery = (fields) => `query($page: Int!, $per: Int!) { currentUser { tournaments(query: { page: $page, perPage: $per, filter: { tournamentView: "admin" } }) {
  pageInfo { totalPages } nodes { id startAt ${fields} } } } }`;

/**
 * @param {Gql} gql
 * @param {{ fields?: string, sinceSec: number, perPage?: number, maxPages?: number, onPage?: (all: AdminTournament[], done: boolean) => boolean | void }} o
 * @returns {Promise<AdminTournament[]>}
 */
export async function readAdminTournaments(gql, o) {
  const per = o.perPage || 20;
  const max = o.maxPages || 15;
  /** @type {AdminTournament[]} */
  const all = [];
  for (let page = 1; page <= max; page++) {
    const d = await gql(adminToursQuery(o.fields || ''), { page, per });
    const ts = d && d.currentUser && d.currentUser.tournaments;
    const nodes = /** @type {AdminTournament[]} */ ((ts && ts.nodes) || []).filter((/** @type {any} */ n) => n && n.id != null);
    all.push(...nodes);
    const last = nodes.length ? Number(nodes[nodes.length - 1].startAt) || 0 : 0;
    const done = nodes.length < per || page >= max || !!(ts && ts.pageInfo && page >= ts.pageInfo.totalPages) || (last > 0 && last < o.sinceSec);
    if (o.onPage && o.onPage(all, done) === true) break;   // true = もう要らない (見つかった等)
    if (done) break;
  }
  return all;
}

/**
 * 管理している大会の一覧にあるか。新しい順なので、開始がその大会より前の大会まで来たら (もう出てこない) 止める
 * @param {Gql} gql @param {number | string} tournamentId @param {number | null | undefined} startAtSec
 */
export async function isAdminTournament(gql, tournamentId, startAtSec) {
  let found = false;
  const since = Number(startAtSec) || 0;
  await readAdminTournaments(gql, {
    sinceSec: since ? since - 1 : 0, perPage: 50, maxPages: since ? 20 : 4,
    onPage: (all) => { found = all.some((t) => String(t.id) === String(tournamentId)); return found; },
  });
  return found;
}

const api = { adminToursQuery, readAdminTournaments, isAdminTournament };
export default api;
