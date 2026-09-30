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
import { eventSlugOf, selectTargets, seedOrder, participantName, challongeToken, CHALLONGE_TOKEN_KEY } from '../../site/js/class_bracket.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const STARTGG_API = 'https://api.start.gg/gql/alpha';
const FORM_KEY = 'spsp_class_form';
/** Challonge のログインでページを離れる間も残す入力 (キーは残さない) */
const FORM_IDS = ['cb-event', 'cb-letter', 'cb-format', 'cb-place-min', 'cb-place-max', 'cb-seeding', 'cb-counted'];

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
      participants: loaded.seeded.map((p, i) => ({ name: participantName(p), seed: i + 1, misc: `startgg:${p.userId}` })),
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
