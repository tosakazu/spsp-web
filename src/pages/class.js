// @ts-check
// src/pages/class.js — site/class/index.html (下位クラス作成、docs/class_bracket_design.md)。
//   1. 読み込む: start.gg のキーで TO か確かめ (大会の owner / admins)、本戦の順位を取る (開催途中でもよい)
//   2. 対象の選手とシード順を見せる
//   3. Challonge に作成: Worker (class_create) が start.gg でもう一度 TO か確かめ、TO の Challonge ログイン (SPSP のアプリ) で
//      トーナメントと参加者を作って登録する。アプリ経由で作るのは、取得側 (smash_database) がアプリの権限で読むため
//   Challonge のログインは最初にする (ページを離れる)。入力中の設定 (キー以外) はこのタブに残して戻ったら戻す
//   キーとトークンは SPSP に保存しない (Worker に渡すのは作成の 1 回だけ。Worker も保存しない)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import SpspOAuthState from '../../site/js/oauth_state.js';
import { parseStartggUrl, pickEvents, selectTargets, seedOrder, participantName, challongeToken, CHALLONGE_TOKEN_KEY } from '../../site/js/class_bracket.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const STARTGG_API = 'https://api.start.gg/gql/alpha';
const FORM_KEY = 'spsp_class_form';
/** Challonge のログインでページを離れる間も残す入力 (キーは残さない) */
const FORM_IDS = ['cb-event', 'cb-letter', 'cb-format', 'cb-place-min', 'cb-place-max', 'cb-seeding', 'cb-exclude-dq', 'cb-counted'];

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

/** 読み込んだ内容 (作成で使う)。seeded = 全員のシード順、off = 外した人 (start.gg のユーザー ID)
 * @type {null | { token: string, event: { id: number, name: string, tournament: { id: number, name: string } }, seeded: ClassEntrant[], off: Set<number> }} */
let loaded = null;
/** 作成に使う人 (外した人を除いたシード順) */
const activeSeeded = () => (loaded ? loaded.seeded.filter(p => !loaded?.off.has(p.userId)) : []);

/** URL からイベントの slug を決める。大会の URL なら候補から: 1 つならそれ、複数なら選んでもらう (選択欄を出して null)
 * @param {string} token @returns {Promise<string | null>} */
async function resolveEventSlug(token) {
  const parsed = parseStartggUrl($('cb-event').value);
  if (!parsed) { status(i18n('class.err.url'), 'error'); return null; }
  if (parsed.eventSlug) return `tournament/${parsed.tournamentSlug}/event/${parsed.eventSlug}`;
  const row = $('cb-event-pick-row');
  const pick = $('cb-event-pick');
  // 前回この大会で選択欄を出していれば、選んだもの
  if (!row.hidden && pick.dataset.tournament === parsed.tournamentSlug && pick.value) return pick.value;
  const d = await sgg(token, 'query($slug: String) { tournament(slug: $slug) { events { id slug name numEntrants type videogame { id } } } }', { slug: parsed.tournamentSlug });
  /** @type {any[]} */
  const events = pickEvents(/** @type {any[]} */ ((d.tournament && d.tournament.events) || []));
  if (!events.length) { status(i18n('class.err.event'), 'error'); return null; }
  if (events.length === 1) return events[0].slug;
  pick.innerHTML = events.map((/** @type {any} */ e) =>
    `<option value="${escapeHtml(e.slug)}">${escapeHtml(e.name)}${e.numEntrants != null ? ` (${e.numEntrants})` : ''}</option>`).join('');
  pick.dataset.tournament = parsed.tournamentSlug;
  row.hidden = false;
  status(i18n('class.err.event_pick'), 'error');
  return null;
}

async function load() {
  loaded = null;
  $('cb-preview').hidden = true;
  $('cb-done').hidden = true;
  const token = String($('cb-sgg-key').value || '').trim();
  const min = parseInt($('cb-place-min').value, 10);
  const maxRaw = String($('cb-place-max').value || '').trim();
  const max = maxRaw ? parseInt(maxRaw, 10) : null;
  if (!parseStartggUrl($('cb-event').value)) return status(i18n('class.err.url'), 'error');
  if (!token) return status(i18n('class.err.startgg_key'), 'error');
  if (!(min >= 1) || (max != null && !(max >= min))) return status(i18n('class.err.range'), 'error');
  const slug = await resolveEventSlug(token);
  if (!slug) return;

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
  let isTo = myId != null && ((ev.tournament.owner && ev.tournament.owner.id === myId) || admins.some((/** @type {any} */ x) => x && x.id === myId));
  // スタッフの役割によっては admins が null になる (管理できる大会でも)。自分が管理する大会の一覧も見る
  for (let page = 1; !isTo && page <= 4; page++) {
    const d = await sgg(token, `query($page: Int!) { currentUser { tournaments(query: { page: $page, perPage: 50, filter: { tournamentView: "admin" } }) {
      pageInfo { totalPages } nodes { id } } } }`, { page });
    const ts = d.currentUser && d.currentUser.tournaments;
    const nodes = (ts && ts.nodes) || [];
    if (nodes.some((/** @type {any} */ n) => n && String(n.id) === String(ev.tournament.id))) isTo = true;
    if (!nodes.length || !ts.pageInfo || page >= ts.pageInfo.totalPages) break;
  }
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
  const targets = selectTargets(standings, min, max, !!$('cb-exclude-dq').checked);
  if (targets.length < 2) return status(i18n('class.err.too_few'), 'error');
  const method = /** @type {'random' | 'main_result' | 'spsp'} */ ($('cb-seeding').value);
  const rankOf = method === 'spsp' ? await spspRanks() : () => null;
  const seeded = seedOrder(targets, method, rankOf);
  loaded = { token, event: ev, seeded, off: new Set() };
  renderList();
  $('cb-preview').hidden = false;
  status(i18n('class.step.ready'), 'ok');
}

/** 対象の一覧。チェックを外した人は作成に入れない (シード番号は入れる人だけで詰める) */
function renderList() {
  if (!loaded) return;
  const ev = loaded.event;
  const off = loaded.off;
  let n = 0;
  $('cb-list').innerHTML = loaded.seeded.map(p => {
    const on = !off.has(p.userId);
    if (on) n++;
    return `<li class="${on ? '' : 'off'}"><label class="cb-row">
      <input type="checkbox" data-uid="${p.userId}"${on ? ' checked' : ''}>
      <span class="cb-seed">${on ? n : ''}</span>
      <span class="cb-name">${escapeHtml(participantName(p))}</span>${p.dq ? `<span class="cb-dq">DQ</span>` : ''}
      <span class="cb-place">${p.placement != null ? escapeHtml(i18n('class.main_place', { n: p.placement })) : ''}</span>
    </label></li>`;
  }).join('');
  $('cb-preview-title').textContent = i18n('class.preview', { n, name: className(ev) });
  $('cb-create').disabled = n < 2;
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

async function create() {
  if (!loaded) return;
  const chToken = challongeToken();
  if (!chToken) { renderChallongeState(); return status(i18n('class.err.challonge_login'), 'error'); }
  const btn = $('cb-create');
  btn.disabled = true;
  try {
    status(i18n('class.step.create'));
    const r = await SpspLogin.api({
      action: 'class_create', startgg_token: loaded.token, challonge_token: chToken,
      parent_event_id: loaded.event.id, class_letter: $('cb-letter').value, name: className(loaded.event),
      format: $('cb-format').value, counted: !!$('cb-counted').checked,
      place_min: parseInt($('cb-place-min').value, 10), place_max: $('cb-place-max').value ? parseInt($('cb-place-max').value, 10) : null,
      seeding: $('cb-seeding').value,
      // 名前 = start.gg の名前 (discriminator)、misc = start.gg のユーザー ID (取得側が選手に結びつける)
      participants: activeSeeded().map((p, i) => ({ name: participantName(p), seed: i + 1, misc: `startgg:${p.userId}` })),
    });
    const url = r && r.challonge && r.challonge.url;
    if (url) {
      const link = $('cb-done-link');
      link.href = url;
      link.textContent = url;
      $('cb-done').hidden = false;
    }
    if (r && r.ok) return status(i18n('class.step.done'), 'ok');
    const code = (r && r.error && r.error.code) || 'unknown';
    const message = (r && r.error && r.error.message) || code;
    if (code === 'challonge_auth') {
      try { sessionStorage.removeItem(CHALLONGE_TOKEN_KEY); } catch (e) { /* 表示だけ変える */ }
      renderChallongeState();
      return status(i18n('class.err.challonge_auth'), 'error');
    }
    // トーナメントまでは作れて途中で失敗したとき (参加者の追加・登録) は、作ったものの URL も出す
    status(url ? i18n('class.err.partial', { message }) : i18n('class.err.create', { message }), 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderChallongeState() {
  const on = !!challongeToken();
  const st = $('cb-ch-state');
  st.textContent = on ? i18n('class.challonge_on') : i18n('class.challonge_off');
  st.className = 'cb-connect-state' + (on ? ' on' : '');
  $('cb-ch-login').textContent = on ? i18n('class.challonge_relogin') : i18n('class.challonge_login');
}

function saveForm() {
  /** @type {Record<string, string | boolean>} */
  const v = {};
  for (const id of FORM_IDS) { const el = $(id); v[id] = el.type === 'checkbox' ? el.checked : el.value; }
  try { sessionStorage.setItem(FORM_KEY, JSON.stringify(v)); } catch (e) { /* 戻ったら入れ直してもらう */ }
}

function restoreForm() {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(FORM_KEY) || 'null'); sessionStorage.removeItem(FORM_KEY); } catch (e) { /* 何もしない */ }
  if (!v) return;
  for (const id of FORM_IDS) {
    if (!(id in v)) continue;
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!v[id]; else el.value = String(v[id]);
  }
}

/** SPSP のアプリとして Challonge にログイン (戻り先 = このページ。callback.js がトークンをこのタブに置く) */
async function challongeLogin() {
  const b = $('cb-ch-login');
  b.disabled = true;
  try {
    let nonce;
    try { nonce = crypto.randomUUID(); } catch (e) { return status(i18n('class.err.challonge_start'), 'error'); }
    SpspOAuthState.saveNonce(nonce);
    try { sessionStorage.setItem(SpspOAuthState.INTENT_KEY, 'challonge'); } catch (e) { /* 署名 state 側で判断できる */ }
    const r = await SpspLogin.api({ action: 'challonge_begin', nonce, returnPath: location.pathname });
    if (!r || !r.ok || !r.url) return status(i18n('class.err.challonge_start'), 'error');
    saveForm();
    location.assign(r.url);
  } finally {
    b.disabled = false;
  }
}

$('cb-load').addEventListener('click', () => {
  const b = $('cb-load');
  b.disabled = true;
  load().catch(e => status(i18n('class.err.startgg', { message: e.message }), 'error')).finally(() => { b.disabled = false; });
});
$('cb-create').addEventListener('click', () => {
  create().catch(e => { status(i18n('class.err.create', { message: e.message }), 'error'); $('cb-create').disabled = false; });
});
$('cb-ch-login').addEventListener('click', () => { challongeLogin(); });
$('cb-list').addEventListener('change', (/** @type {Event} */ e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (!loaded || !el.dataset.uid) return;
  const uid = Number(el.dataset.uid);
  if (el.checked) loaded.off.delete(uid); else loaded.off.add(uid);
  renderList();
});
// URL を変えたらイベントの選択欄は隠す (別の大会の選択が残らないように)
$('cb-event').addEventListener('input', () => { $('cb-event-pick-row').hidden = true; });

/** キーで管理できる大会 (tournamentView admin) を、開催中 → これから → 最近終わった の順に選択欄へ。
 * 取れなければ欄は出さない (URL を入れればよい) */
async function loadMyTournaments() {
  const token = String($('cb-sgg-key').value || '').trim();
  const row = $('cb-tour-pick-row');
  if (!token) { row.hidden = true; return; }
  /** @type {any[]} */
  let all = [];
  try {
    for (let page = 1; page <= 4; page++) {
      const d = await sgg(token, `query($page: Int!) { currentUser { tournaments(query: { page: $page, perPage: 50, filter: { tournamentView: "admin" } }) {
        nodes { id name slug startAt endAt } } } }`, { page });
      const nodes = (d.currentUser && d.currentUser.tournaments && d.currentUser.tournaments.nodes) || [];
      all = all.concat(nodes);
      if (nodes.length < 50) break;
    }
  } catch (e) { row.hidden = true; return; }
  const now = Date.now() / 1000;
  const DAY = 86400;
  const rank = (/** @type {any} */ t) => {
    const s = t.startAt || 0, e = t.endAt || s;
    if (s <= now + DAY / 2 && e >= now - DAY / 2) return [0, -s];   // 開催中 (前後半日)
    if (s > now) return [1, s];                                       // これから (近い順)
    return [2, -e];                                                   // 終わった (新しい順)
  };
  const list = all.filter(t => t && t.slug)
    .map(t => ({ t, k: rank(t) }))
    .sort((x, y) => (x.k[0] - y.k[0]) || (x.k[1] - y.k[1]))
    .slice(0, 30);
  if (!list.length) { row.hidden = true; return; }
  const fmt = (/** @type {number} */ s) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  $('cb-tour-pick').innerHTML = `<option value="">${escapeHtml(i18n('class.tour_pick_none'))}</option>` + list.map(({ t, k }) =>
    `<option value="${escapeHtml(t.slug)}">${k[0] === 0 ? escapeHtml(i18n('class.tour_live')) + ' ' : ''}${escapeHtml(t.name)}${t.startAt ? ` (${fmt(t.startAt)})` : ''}</option>`).join('');
  // 開催中が 1 つだけなら、URL が空のときはそれを選んでおく
  const live = list.filter(x => x.k[0] === 0);
  if (live.length === 1 && !String($('cb-event').value || '').trim()) {
    $('cb-tour-pick').value = live[0].t.slug;
    $('cb-event').value = 'https://www.start.gg/' + live[0].t.slug;
  }
  row.hidden = false;
}
$('cb-tour-pick').addEventListener('change', () => {
  const v = $('cb-tour-pick').value;
  if (!v) return;
  $('cb-event').value = 'https://www.start.gg/' + v;
  $('cb-event-pick-row').hidden = true;
});
$('cb-sgg-key').addEventListener('change', () => { loadMyTournaments(); });

// start.gg のキー: 「ブラウザに保存」を押したときだけ保存 (シード機能と同じ場所。どちらで保存しても両方で使える)
const SGG_TOKEN_KEY = 'spsp_startgg_token';
try { const t0 = localStorage.getItem(SGG_TOKEN_KEY); if (t0) $('cb-sgg-key').value = t0; } catch (e) { /* 入れてもらう */ }
loadMyTournaments();
$('cb-sgg-save').addEventListener('click', () => {
  const b = $('cb-sgg-save');
  const v = String($('cb-sgg-key').value || '').trim();
  if (!v) return status(i18n('class.err.startgg_key'), 'error');
  try { localStorage.setItem(SGG_TOKEN_KEY, v); } catch (e) { return; }
  b.textContent = i18n('class.key_saved');
  b.disabled = true;
  setTimeout(() => { b.textContent = i18n('class.key_save'); b.disabled = false; }, 1500);
});

// Challonge のログインから戻った (?challonge=1): 入力を戻し、印はアドレスバーから消す
restoreForm();
try {
  const u = new URL(location.href);
  if (u.searchParams.has('challonge')) {
    u.searchParams.delete('challonge');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  }
} catch (e) { /* 何もしない */ }
renderChallongeState();
