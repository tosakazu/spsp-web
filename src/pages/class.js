// @ts-check
// src/pages/class.js — site/class/index.html (下位クラス作成、docs/class_bracket_design.md)。
//   1. 読み込む: start.gg のキーで TO か確かめ (大会の owner / admins)、本戦の順位を取る (開催途中でもよい)
//   2. 対象の選手とシード順を見せる。被り回避 (既定 ON) はシード機能の最適化 (seeding/seed_optimizer.js) をそのまま使う:
//      地域 (都道府県) と直近の対戦 (seed_data.js) に加えて、本戦で当たった組を強い再対戦として避ける。
//      1 ブラケットなので poolCount=1・ダブルエリミの勝者側として解く (シングルでも序盤の当たり方は同じ)
//   3. Challonge に作成: Worker (class_create) が start.gg でもう一度 TO か確かめ、TO の Challonge ログイン (SPSP のアプリ) で
//      トーナメントと参加者を作って登録する。アプリ経由で作るのは、取得側 (smash_database) がアプリの権限で読むため
//   Challonge のログインは最初にする (ページを離れる)。入力中の設定 (キー以外) はこのタブに残して戻ったら戻す
//   キーとトークンは SPSP に保存しない (Worker に渡すのは作成の 1 回だけ。Worker も保存しない)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import SpspOAuthState from '../../site/js/oauth_state.js';
import SPSPSeedOptimizer from '../../site/seeding/seed_optimizer.js';
import SPSPSeedData from '../../site/seeding/seed_data.js';
import { parseStartggUrl, pickEvents, selectTargets, seedOrder, participantName, challongeToken, challongeUser, CHALLONGE_TOKEN_KEY } from '../../site/js/class_bracket.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const STARTGG_API = 'https://api.start.gg/gql/alpha';
const FORM_KEY = 'spsp_class_form';
/** Challonge のログインでページを離れる間も残す入力 (キーは残さない) */
const FORM_IDS = ['cb-event', 'cb-letter', 'cb-format', 'cb-place-min', 'cb-place-max', 'cb-seeding', 'cb-av-region', 'cb-av-recent', 'cb-av-main', 'cb-av-weekday', 'cb-exclude-dq', 'cb-counted'];
const AV_IDS = ['cb-av-region', 'cb-av-recent', 'cb-av-main', 'cb-av-weekday'];
/** 本戦で当たった組の罰則 = 本戦の規模の重み (log2 人数) × この倍率。シード機能の同シリーズ再戦 (×3) に合わせる */
const MAIN_REMATCH_MULT = 3;
/** 1 つの下位クラスの最大人数 (Worker の class_create と同じ上限) */
const MAX_PARTICIPANTS = 512;

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

/** 読み込んだ内容 (作成で使う)。seeded = 全員の元のシード順、off = 外した人 (start.gg のユーザー ID)、
 * avoid = 被り回避の材料 (null = 使わない)、order = 表示・作成に使う最終の並び (外した人を除き、被り回避の後)、
 * mainSize = 本戦の人数、mainPairs = 本戦で当たった組 (必要になったら取る)
 * @type {null | { token: string, event: { id: number, name: string, tournament: { id: number, name: string } }, seeded: ClassEntrant[], off: Set<number>,
 *   avoid: null | { prefByUid: Record<string, string | null>, recentPair: Record<string, number>, params: Record<string, unknown> }, order: ClassEntrant[],
 *   mainSize: number, mainPairs: Set<string> | null, display: ClassEntrant[] }} */
let loaded = null;

/** 外した人を除いて、被り回避 (あれば) をかけた並びを作る */
function computeOrder() {
  if (!loaded) return;
  const base = loaded.seeded.filter(p => !loaded?.off.has(p.userId));
  loaded.order = base;
  if (!loaded.avoid || base.length < 4) return;
  try {
    const r = SPSPSeedOptimizer.optimize({
      poolCount: 1, ranking: base.map(p => p.userId), format: 'DOUBLE_ELIMINATION',
      prefByUid: loaded.avoid.prefByUid, recentPair: loaded.avoid.recentPair, params: loaded.avoid.params,
    });
    if (r && Array.isArray(r.seedOrder)) {
      const byUid = new Map(base.map(p => [p.userId, p]));
      loaded.order = r.seedOrder.map((/** @type {number} */ u) => /** @type {ClassEntrant} */ (byUid.get(u)));
    }
  } catch (e) { /* 失敗したら元の並び (被り回避なし) */ }
  mergeDisplay();
}

/** 表の並び: 外した人はその場に残し (下に回さない)、出る人の枠に新しいシード順を上から入れる */
function mergeDisplay() {
  if (!loaded) return;
  const L = loaded;
  if (!L.display.length) { L.display = L.order.concat(L.seeded.filter(p => L.off.has(p.userId))); return; }
  const queue = L.order.slice();
  L.display = L.display.map(p => (L.off.has(p.userId) ? p : /** @type {ClassEntrant} */ (queue.shift())));
}

/** 本戦の試合から、当たった組 (pairKey) を集める
 * @param {string} token @param {number} eventId @returns {Promise<Set<string>>} */
async function mainEventPairs(token, eventId) {
  const pairs = new Set();
  for (let page = 1; page <= 60; page++) {
    const d = await sgg(token, `query($id: ID!, $page: Int!) { event(id: $id) { sets(page: $page, perPage: 40) {
      pageInfo { totalPages } nodes { slots { entrant { participants { user { id } } } } } } } }`, { id: eventId, page });
    const sets = d.event && d.event.sets;
    for (const s of (sets && sets.nodes) || []) {
      const uids = (s.slots || []).map((/** @type {any} */ sl) => sl && sl.entrant && sl.entrant.participants && sl.entrant.participants[0] && sl.entrant.participants[0].user && sl.entrant.participants[0].user.id).filter((/** @type {any} */ u) => u != null);
      if (uids.length === 2 && uids[0] !== uids[1]) pairs.add(SPSPSeedOptimizer.pairKey(uids[0], uids[1]));
    }
    if (sets && sets.pageInfo) status(i18n('class.progress.sets', { done: page, total: sets.pageInfo.totalPages || page }));
    if (!sets || !sets.pageInfo || page >= sets.pageInfo.totalPages) break;
  }
  return pairs;
}

/** 選手のファイル (対戦歴) はこのページの中で使い回す (設定を切り替えるたびに取り直さない) */
const PLAYER_CACHE = new Map();
function cachedFetchers() {
  const base = SPSPSeedData.defaultFetchers(SPSP.data);
  return Object.assign({}, base, {
    fetchPlayer: async (/** @type {number} */ uid) => {
      if (!PLAYER_CACHE.has(uid)) PLAYER_CACHE.set(uid, await base.fetchPlayer(uid));
      return PLAYER_CACHE.get(uid);
    },
  });
}

/** 地域まとめ (南関東など) のトグル。定義は geo.json の seed_groups (シード機能と同じ文言・既定) */
async function renderGroupToggles() {
  try {
    const geo = /** @type {any} */ (await SPSPSeedData.ensureGeoCatalog(cachedFetchers()));
    const units = (geo && geo.units) || [];
    const shortName = (/** @type {string} */ id) => {
      const u = units.find((/** @type {any} */ x) => x.id === id);
      return String((u && SPSPI18n.pick(u.name)) || id).replace(/[都府県]$/, '');
    };
    $('cb-av-groups').innerHTML = ((geo && geo.seed_groups) || []).map((/** @type {any} */ g) => {
      const names = (g.units || []).map(shortName).join(i18n('seed.skeleton.unit_sep'));
      const name = SPSPI18n.pick(g.name) || g.id;
      return `<label title="${escapeHtml(i18n('seed.skeleton.group_help', { name, units: names }))}"><input type="checkbox" data-group="${escapeHtml(String(g.id))}"${g.default ? ' checked' : ''}> ${escapeHtml(i18n('seed.skeleton.group_toggle', { units: names }))}</label>`;
    }).join('');
  } catch (e) { /* まとめ無し (都道府県単位) */ }
}

/** 被り回避の設定 (画面のトグル) から材料を作る。全部 OFF なら null
 * シード機能と同じ地域・直接対戦 (seed_data.js) に、本戦で当たった組を強い再対戦として足す */
async function refreshAvoid() {
  if (!loaded) return;
  const L = loaded;
  const region = !!$('cb-av-region').checked, recent = !!$('cb-av-recent').checked, main = !!$('cb-av-main').checked;
  if (!region && !recent && !main) { L.avoid = null; return; }
  /** @type {Record<string, boolean>} */
  const groups = {};
  for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('#cb-av-groups input[data-group]'))) groups[String(el.dataset.group)] = el.checked;
  const fetchers = cachedFetchers();
  /** @type {any} */
  let data = null;
  if (region || recent) {
    await SPSPSeedData.ensureGeoCatalog(fetchers);
    data = await SPSPSeedData.buildSeedData(L.seeded.map(p => p.userId), Object.assign({}, fetchers, {
      prefix: SPSP.data, regionGroups: SPSPSeedData.buildRegionGroups(groups), prefsOptional: !region,
      params: { excludeWeekday: !$('cb-av-weekday').checked },
      onProgress: (/** @type {any} */ pr) => { if (pr && pr.phase === 'fetch') status(i18n('class.progress.players', { done: pr.done, total: pr.total })); },
    }));
  }
  if (main && !L.mainPairs) L.mainPairs = await mainEventPairs(L.token, L.event.id);
  /** @type {Record<string, number>} */
  const recentPair = Object.assign({}, recent && data ? data.recentPair : {});
  status(i18n('class.progress.optimize'));
  if (main && L.mainPairs) {
    const w = MAIN_REMATCH_MULT * Math.log2(Math.max(2, L.mainSize));
    for (const k of L.mainPairs) recentPair[k] = Math.max(recentPair[k] || 0, w);
  }
  L.avoid = {
    prefByUid: region && data ? data.prefByUid : {},
    recentPair,
    params: { avoidRegion: region, avoidRecent: recent || main },
  };
}

/** 被り回避の設定を変えたら、読み込み済みなら並べ直す */
async function onAvoidChange() {
  if (!loaded) return;
  try { await refreshAvoid(); } catch (e) { if (loaded) loaded.avoid = null; }
  computeOrder();
  renderList();
  if (loaded && loaded.order.length <= MAX_PARTICIPANTS) status(i18n('class.step.ready'), 'ok');
}

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
      pageInfo { totalPages total } nodes { placement entrant { isDisqualified participants { user { id discriminator player { gamerTag } } } } } } } }`,
    { id: ev.id, page });
    const st = d.event && d.event.standings;
    for (const n of (st && st.nodes) || []) {
      const u = n.entrant && n.entrant.participants && n.entrant.participants[0] && n.entrant.participants[0].user;
      if (!u) continue;
      standings.push({ userId: u.id, discriminator: u.discriminator || '', gamerTag: (u.player && u.player.gamerTag) || '', placement: n.placement, dq: !!n.entrant.isDisqualified });
    }
    if (st && st.pageInfo) status(i18n('class.progress.standings', { done: standings.length, total: st.pageInfo.total || standings.length }));
    if (!st || !st.pageInfo || page >= st.pageInfo.totalPages) break;
  }

  // 3. 対象とシード順
  const targets = selectTargets(standings, min, max, !!$('cb-exclude-dq').checked);
  if (targets.length < 2) return status(i18n('class.err.too_few'), 'error');
  const method = /** @type {'random' | 'main_result' | 'main_spsp' | 'spsp'} */ ($('cb-seeding').value);
  const rankOf = (method === 'spsp' || method === 'main_spsp') ? await spspRanks() : () => null;
  const seeded = seedOrder(targets, method, rankOf);
  loaded = { token, event: ev, seeded, off: new Set(), avoid: null, order: [], mainSize: standings.length, mainPairs: null, display: [] };
  $('cb-search').value = '';
  listFilter = 'all';
  try { await refreshAvoid(); } catch (e) { loaded.avoid = null; }
  computeOrder();
  renderList();
  $('cb-preview').hidden = false;
  if (loaded && loaded.order.length <= MAX_PARTICIPANTS) status(i18n('class.step.ready'), 'ok');
}

/** 一覧の絞り込み ('all' | 'on' = 出る人 | 'off' = 出ない人) */
let listFilter = 'all';

/** 対象の一覧 (上から最終のシード順。外した人はその場に残る)。チェックを外した人は作成に入れない */
function renderList() {
  if (!loaded) return;
  const L = loaded;
  /** @type {Map<number, number>} */
  const seedOf = new Map(L.order.map((p, i) => [p.userId, i + 1]));
  const q = String($('cb-search').value || '').trim().toLowerCase();
  const rows = L.display.filter(p => {
    const on = !L.off.has(p.userId);
    if ((listFilter === 'on' && !on) || (listFilter === 'off' && on)) return false;
    return !q || p.gamerTag.toLowerCase().includes(q) || String(p.discriminator || '').toLowerCase().includes(q);
  });
  $('cb-list').innerHTML = rows.map(p => {
    const seed = seedOf.get(p.userId);
    const on = seed != null;
    return `<tr class="${on ? '' : 'off'}" data-uid="${p.userId}">
      <td class="col-on"><input type="checkbox" data-uid="${p.userId}"${on ? ' checked' : ''}></td>
      <td class="col-no">${on ? seed : ''}</td>
      <td><span class="name">${escapeHtml(p.gamerTag)}</span>${p.discriminator ? `<span class="disc">${escapeHtml(p.discriminator)}</span>` : ''}${p.dq ? '<span class="cb-badge">DQ</span>' : ''}</td>
      <td class="col-place">${p.placement != null ? p.placement : ''}</td>
    </tr>`;
  }).join('') || `<tr class="cb-empty"><td colspan="4">${escapeHtml(i18n('class.filter.empty'))}</td></tr>`;
  const n = L.order.length, total = L.display.length;
  const labels = { all: i18n('class.filter.all', { n: total }), on: i18n('class.filter.on', { n }), off: i18n('class.filter.off', { n: total - n }) };
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#cb-seg button'))) {
    const f = /** @type {'all' | 'on' | 'off'} */ (b.dataset.f);
    b.textContent = labels[f];
    b.classList.toggle('on', f === listFilter);
  }
  $('cb-preview-title').textContent = i18n('class.preview', { n, name: className(L.event) });
  $('cb-create').disabled = n < 2 || n > MAX_PARTICIPANTS;
  if (n > MAX_PARTICIPANTS) status(i18n('class.err.too_many', { n, max: MAX_PARTICIPANTS }), 'error');
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
      participants: loaded.order.map((p, i) => ({ name: participantName(p), seed: i + 1, misc: `startgg:${p.userId}` })),
    });
    const url = r && r.challonge && r.challonge.url;
    if (url) {
      const link = $('cb-done-link');
      link.href = url;
      link.textContent = url;
      $('cb-done').hidden = false;
    }
    if (r && r.ok) { loadMine(); return status(i18n('class.step.done'), 'ok'); }
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

/** 名前の無いログイン (名前を返す前の Worker でログインした等) は、Worker (challonge_me) に聞いて足す
 * (Challonge の API は実際の応答に CORS のヘッダが無く、ページから直接は読めない) */
/** 聞きに行ったトークン (1 つのトークンにつき 1 回だけ。失敗しても繰り返さない) */
let userTriedFor = '';
async function fillChallongeUser() {
  const tok = challongeToken();
  if (!tok || challongeUser() || userTriedFor === tok || !SpspLogin.apiAvailable()) return;
  userTriedFor = tok;
  const r = await SpspLogin.api({ action: 'challonge_me', challonge_token: tok });
  try {
    if (r && r.ok === false && r.error && r.error.code === 'challonge_auth') sessionStorage.removeItem(CHALLONGE_TOKEN_KEY);
    else if (r && r.ok && typeof r.username === 'string' && r.username) {
      const cur = JSON.parse(sessionStorage.getItem(CHALLONGE_TOKEN_KEY) || 'null');
      if (cur && cur.token === tok) sessionStorage.setItem(CHALLONGE_TOKEN_KEY, JSON.stringify(Object.assign(cur, { user: r.username })));
    }
  } catch (e) { /* 名前は出せないまま (ログイン済みの表示) */ }
  renderChallongeState();
}

function renderChallongeState() {
  const on = !!challongeToken();
  if (on && !challongeUser()) fillChallongeUser();
  const st = $('cb-ch-state');
  const user = challongeUser();
  st.textContent = !on ? i18n('class.challonge_off') : user ? i18n('class.challonge_as', { name: user }) : i18n('class.challonge_on');
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
for (const id of AV_IDS) $(id).addEventListener('change', () => { onAvoidChange(); });
$('cb-av-groups').addEventListener('change', () => { onAvoidChange(); });
$('cb-search').addEventListener('input', () => { renderList(); });

// 対象の順位の候補: ダブルエリミの順位の区切り (1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, …)。「〜位まで」は次の区切りの 1 つ前
(function fillPlaceLists() {
  /** @type {number[]} */
  const starts = [1, 2, 3, 4];
  for (let b = 4; b < 1024; b *= 2) starts.push(b + 1, b + b / 2 + 1);
  $('cb-place-min-list').innerHTML = starts.map(v => `<option value="${v}"></option>`).join('');
  $('cb-place-max-list').innerHTML = starts.slice(1).map(v => `<option value="${v - 1}"></option>`).join('');
})();
$('cb-seg').addEventListener('click', (/** @type {MouseEvent} */ e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-f]'));
  if (!b) return;
  listFilter = String(b.dataset.f);
  renderList();
});
renderGroupToggles();
// 行のどこを押してもオン・オフ (チェックボックスそのものも)。外す・戻すたびに被り回避をかけ直す
$('cb-list').addEventListener('click', (/** @type {MouseEvent} */ e) => {
  const tr = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('tr[data-uid]'));
  if (!loaded || !tr) return;
  const uid = Number(tr.dataset.uid);
  if (loaded.off.has(uid)) loaded.off.delete(uid); else loaded.off.add(uid);
  computeOrder();
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
$('cb-sgg-key').addEventListener('change', () => { loadMyTournaments(); loadMine(); });

// start.gg のキー: シード機能と同じ (👁 で表示、💾 を押したときだけブラウザに保存。保存場所も共通なのでどちらで保存しても使える)
const SGG_TOKEN_KEY = 'spsp_startgg_token';
function updateKeyHint() {
  const v = String($('cb-sgg-key').value || '').trim();
  $('cb-sgg-hint').textContent = v ? `${i18n('seed.boot.t1')} ${v.slice(-4)} (${v.length} ${i18n('seed.boot.t2')}` : '';
}
try { const t0 = localStorage.getItem(SGG_TOKEN_KEY); if (t0) $('cb-sgg-key').value = t0; } catch (e) { /* 入れてもらう */ }
updateKeyHint();
$('cb-sgg-key').addEventListener('input', updateKeyHint);
$('cb-sgg-reveal').addEventListener('click', () => {
  const el = $('cb-sgg-key');
  const pwd = el.type === 'password';
  el.type = pwd ? 'text' : 'password';
  $('cb-sgg-reveal').textContent = pwd ? '🙈' : '👁';
});
$('cb-sgg-save').addEventListener('click', () => {
  const b = $('cb-sgg-save');
  const v = String($('cb-sgg-key').value || '').trim();
  if (!v) { $('cb-sgg-hint').textContent = i18n('seed.boot.s1'); return; }
  try { localStorage.setItem(SGG_TOKEN_KEY, v); } catch (e) { $('cb-sgg-hint').textContent = i18n('seed.boot.s3') + /** @type {any} */ (e).message; return; }
  const orig = b.textContent;
  b.textContent = i18n('seed.boot.s2');
  b.disabled = true;
  setTimeout(() => { b.textContent = orig; b.disabled = false; }, 1500);
});
loadMyTournaments();

/** 作成した下位クラス (class_mine)。間違えて作ったものは削除できる (取り込み済みは不可)。まだ API が無い環境では出さない */
async function loadMine() {
  const token = String($('cb-sgg-key').value || '').trim();
  const box = $('cb-mine');
  if (!token || !SpspLogin.apiAvailable()) { box.hidden = true; return; }
  const r = await SpspLogin.api({ action: 'class_mine', startgg_token: token });
  const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
  if (!items.length) { box.hidden = true; return; }
  const fmt = (/** @type {string} */ s) => { const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const stateText = (/** @type {any} */ it) => it.status === 'done' ? i18n('class.mine.done') : (it.counted ? i18n('class.mine.waiting') : i18n('class.mine.uncounted'));
  $('cb-mine-list').innerHTML = items.map((/** @type {any} */ it) => `<li>
    <div class="cb-mine-main">
      <a href="${escapeHtml(String(it.challonge_url || ''))}" target="_blank" rel="noopener">${escapeHtml(String(it.name || ''))}</a>
      <div class="cb-mine-meta">${escapeHtml(fmt(it.created_at))} · ${escapeHtml(i18n('class.mine.entrants', { n: it.entrant_count }))} · ${escapeHtml(stateText(it))}</div>
    </div>
    <button type="button" class="cb-sub-btn cb-del-btn" data-id="${Number(it.id)}" data-name="${escapeHtml(String(it.name || ''))}"${it.status === 'done' ? ' disabled' : ''}>${escapeHtml(i18n('class.del'))}</button>
  </li>`).join('');
  box.hidden = false;
}

/** @param {string} msg @param {'' | 'error' | 'ok'} [kind] */
function mineStatus(msg, kind = '') {
  const el = $('cb-mine-status');
  el.textContent = msg;
  el.className = 'cb-status' + (kind ? ' ' + kind : '');
}

$('cb-mine-list').addEventListener('click', async (/** @type {MouseEvent} */ e) => {
  const b = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-id]'));
  if (!b || b.disabled) return;
  const chToken = challongeToken();
  if (!chToken) { renderChallongeState(); return mineStatus(i18n('class.err.challonge_login'), 'error'); }
  if (!confirm(i18n('class.del_confirm', { name: b.dataset.name || '' }))) return;
  b.disabled = true;
  const r = await SpspLogin.api({ action: 'class_delete', startgg_token: String($('cb-sgg-key').value || '').trim(), challonge_token: chToken, id: Number(b.dataset.id) });
  if (r && r.ok) { mineStatus(i18n('class.del_done'), 'ok'); loadMine(); return; }
  b.disabled = false;
  const code = (r && r.error && r.error.code) || 'unknown';
  if (code === 'challonge_auth') {
    try { sessionStorage.removeItem(CHALLONGE_TOKEN_KEY); } catch (e2) { /* 表示だけ変える */ }
    renderChallongeState();
    return mineStatus(i18n('class.err.challonge_auth'), 'error');
  }
  if (code === 'already_imported') return mineStatus(i18n('class.err.already_imported'), 'error');
  mineStatus(i18n('class.err.del', { message: (r && r.error && r.error.message) || code }), 'error');
});
loadMine();

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
