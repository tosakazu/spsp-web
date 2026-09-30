// @ts-check
// src/pages/class.js — site/class/index.html (下位クラス作成、docs/class_bracket_design.md)。
//   1. 読み込む: start.gg のキーで TO か確かめ (大会の owner / admins)、本戦の順位を取る (開催途中でもよい)
//   2. 対象の選手とシード順を見せる
//   3. Challonge に作成: Challonge のキーでトーナメントと参加者を作り、SPSP に登録 (Worker が start.gg でもう一度 TO か確かめる)
//   キーはこのページの中だけで使う (SPSP に保存しない。start.gg のキーは登録の確認にだけ Worker へ渡し、Worker も保存しない)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import { eventSlugOf, selectTargets, seedOrder, participantName } from '../../site/js/class_bracket.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const STARTGG_API = 'https://api.start.gg/gql/alpha';
const CHALLONGE_API = 'https://api.challonge.com/v1';

/** @typedef {import('../../site/js/class_bracket.js').ClassEntrant} ClassEntrant */

/** @param {string} msg @param {'' | 'error' | 'ok'} [kind] */
function status(msg, kind = '') {
  const el = $('cb-status');
  el.textContent = msg;
  el.className = 'cb-status' + (kind ? ' ' + kind : '');
}

/** start.gg GraphQL。エラーは Error で投げる
 * @param {string} token @param {string} query @param {Record<string, unknown>} [variables] */
async function sgg(token, query, variables = {}) {
  const res = await fetch(STARTGG_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.errors) {
    const msg = (j && j.errors && j.errors[0] && j.errors[0].message) || (j && j.message) || String(res.status);
    throw new Error(msg);
  }
  return j.data;
}

/** 読み込んだ内容 (作成で使う)
 * @type {null | { token: string, event: { id: number, name: string, tournament: { id: number, name: string } }, seeded: ClassEntrant[] }} */
let loaded = null;

async function load() {
  loaded = null;
  $('cb-preview').hidden = true;
  $('cb-done').hidden = true;
  const slug = eventSlugOf($('cb-event').value);
  const token = String($('cb-sgg-key').value || '').trim();
  const min = parseInt($('cb-place-min').value, 10);
  const maxRaw = String($('cb-place-max').value || '').trim();
  const max = maxRaw ? parseInt(maxRaw, 10) : null;
  if (!slug) return status(i18n('class.err.url'), 'error');
  if (!token) return status(i18n('class.err.startgg_key'), 'error');
  if (!(min >= 1) || (max != null && !(max >= min))) return status(i18n('class.err.range'), 'error');

  status(i18n('class.step.check'));
  // 1. TO か (大会の owner か admins に自分がいるか)
  const me = await sgg(token, 'query { currentUser { id } }');
  const myId = me && me.currentUser && me.currentUser.id;
  const ev = (await sgg(token, 'query($slug: String) { event(slug: $slug) { id name tournament { id name owner { id } } } }', { slug })).event;
  if (!ev) return status(i18n('class.err.event'), 'error');
  let admins = [];
  try {
    const a = await sgg(token, 'query($id: ID) { tournament(id: $id) { admins { id } } }', { id: ev.tournament.id });
    admins = (a.tournament && a.tournament.admins) || [];
  } catch (e) { /* admins は admin でないと読めない: 読めなければ owner だけで判断 */ }
  const isTo = myId != null && ((ev.tournament.owner && ev.tournament.owner.id === myId) || admins.some((/** @type {any} */ x) => x && x.id === myId));
  if (!isTo) return status(i18n('class.err.not_admin'), 'error');

  // 2. 本戦の順位 (開催途中でもよい。順位が付いている人だけが対象になる)
  status(i18n('class.step.standings'));
  /** @type {ClassEntrant[]} */
  const standings = [];
  for (let page = 1; page <= 100; page++) {
    const d = await sgg(token, `query($id: ID!, $page: Int!) { event(id: $id) { standings(query: { page: $page, perPage: 64 }) {
      pageInfo { totalPages } nodes { placement entrant { isDisqualified participants { user { id discriminator player { gamerTag } } } } } } } }`,
    { id: ev.id, page });
    const st = d.event && d.event.standings;
    for (const n of (st && st.nodes) || []) {
      const u = n.entrant && n.entrant.participants && n.entrant.participants[0] && n.entrant.participants[0].user;
      if (!u) continue;
      standings.push({ userId: u.id, discriminator: u.discriminator || '', gamerTag: (u.player && u.player.gamerTag) || '', placement: n.placement, dq: !!n.entrant.isDisqualified });
    }
    if (!st || !st.pageInfo || page >= st.pageInfo.totalPages) break;
  }

  // 3. 対象とシード順
  const targets = selectTargets(standings, min, max);
  if (targets.length < 2) return status(i18n('class.err.too_few'), 'error');
  const method = /** @type {'random' | 'main_result' | 'spsp'} */ ($('cb-seeding').value);
  const rankOf = method === 'spsp' ? await spspRanks() : () => null;
  const seeded = seedOrder(targets, method, rankOf);
  loaded = { token, event: ev, seeded };
  $('cb-preview-title').textContent = i18n('class.preview', { n: seeded.length, name: className(ev) });
  $('cb-list').innerHTML = seeded.map(p =>
    `<li><span class="cb-name">${escapeHtml(participantName(p))}</span><span class="cb-place">${p.placement != null ? escapeHtml(i18n('class.main_place', { n: p.placement })) : ''}</span></li>`).join('');
  $('cb-preview').hidden = false;
  status(i18n('class.step.ready'), 'ok');
}

/** SPSP の総合順位 (players_current.json の ranks.ensemble)。選手 ID = start.gg のユーザー ID */
async function spspRanks() {
  try {
    const j = await fetch(SPSP.data + 'players_current.json').then(r => r.json());
    const col = (j.columns || []).indexOf('ranks.ensemble');
    const rows = j.players || {};
    return (/** @type {number} */ uid) => { const r = rows[String(uid)]; return r && col >= 0 ? r[col] : null; };
  } catch (e) { return () => null; }
}

/** @param {{ tournament: { name: string } }} ev */
function className(ev) {
  return `${ev.tournament.name} ${i18n('ach.class.' + $('cb-letter').value)}`;
}

/** Challonge v1 (JSON)。エラーは Error で投げる
 * @param {string} path @param {Record<string, unknown>} body */
async function challonge(path, body) {
  const res = await fetch(CHALLONGE_API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw new Error((j && j.errors && j.errors.join(' / ')) || String(res.status));
  return j;
}

async function create() {
  if (!loaded) return;
  const chKey = String($('cb-ch-key').value || '').trim();
  if (!chKey) return status(i18n('class.err.challonge_key'), 'error');
  const btn = $('cb-create');
  btn.disabled = true;
  try {
    const letter = $('cb-letter').value;
    const format = $('cb-format').value;
    const name = className(loaded.event);
    // 1. トーナメント (URL は重ならないよう大会 ID・クラス・乱数で作る)
    status(i18n('class.step.create'));
    const urlKey = `spsp_${loaded.event.id}_${letter.toLowerCase()}_${Math.random().toString(36).slice(2, 7)}`;
    const t = (await challonge('/tournaments.json', { api_key: chKey, tournament: {
      name, url: urlKey, tournament_type: format === 'double' ? 'double elimination' : 'single elimination',
      game_name: 'Super Smash Bros. Ultimate', open_signup: false,
    } })).tournament;
    // 2. 参加者 (名前 = start.gg の名前 (discriminator)、misc = start.gg のユーザー ID。取得側が選手に結びつける)
    await challonge(`/tournaments/${t.id}/participants/bulk_add.json`, { api_key: chKey,
      participants: loaded.seeded.map((p, i) => ({ name: participantName(p), seed: i + 1, misc: `startgg:${p.userId}` })) });
    // 3. SPSP に登録 (Worker が start.gg のキーでもう一度 TO か確かめる。キーは保存しない)
    status(i18n('class.step.register'));
    const reg = await SpspLogin.api({
      action: 'class_register', startgg_token: loaded.token, parent_event_id: loaded.event.id, class_letter: letter, name,
      challonge: { id: t.id, url: t.full_challonge_url }, format, counted: !!$('cb-counted').checked,
      place_min: parseInt($('cb-place-min').value, 10), place_max: $('cb-place-max').value ? parseInt($('cb-place-max').value, 10) : null,
      seeding: $('cb-seeding').value, entrant_count: loaded.seeded.length,
    });
    const link = $('cb-done-link');
    link.href = t.full_challonge_url;
    link.textContent = t.full_challonge_url;
    $('cb-done').hidden = false;
    // Challonge には作れている。SPSP への登録だけ失敗したときは、その旨を出す (集計対象にならない)
    if (reg && reg.ok) status(i18n('class.step.done'), 'ok');
    else status(i18n('class.err.register', { code: (reg && reg.error && (reg.error.message || reg.error.code)) || 'unknown' }), 'error');
  } catch (e) {
    status(i18n('class.err.challonge', { message: /** @type {Error} */ (e).message }), 'error');
  } finally {
    btn.disabled = false;
  }
}

$('cb-load').addEventListener('click', () => {
  const b = $('cb-load');
  b.disabled = true;
  load().catch(e => status(i18n('class.err.startgg', { message: e.message }), 'error')).finally(() => { b.disabled = false; });
});
$('cb-create').addEventListener('click', () => { create(); });
