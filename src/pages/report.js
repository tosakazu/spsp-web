// 試合結果の報告 (site/report/index.html、docs/self_report_design.md)。
//   ?c=<受付>          選手の画面: 自分の試合 (台・相手のカード)・結果の報告・試合待ちの次の相手の候補
//   ?c=<受付>&admin=1  運営の画面: 試合ごとの状態・両者の報告・直す / 取り消す・設定・受付の停止
//   (c なし)            運営が受付を始める画面 (start.gg のイベント)。下位クラス (Challonge) は下位クラス作成のページから
// start.gg の試合は、ブラウザが本人のログインのトークン (user.identity) で 15 秒ごとに読む。報告は Worker (action report_submit) が
// 運営のトークンで start.gg / Challonge に送る。Challonge の試合は Worker が読む (action report_view)。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import SpspStartggIdentity from '../../site/js/startgg_identity.js';
import SpspReportAuth from '../../site/js/report_auth.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import { CHAR_MERGE_CANONICAL, charName, HIDDEN_CHAR_IDS } from '../../site/js/chars.js';
import FIGHTER_NUMBER from '../../site/js/fighter_number.js';
import SPSPViews from '../../site/js/views.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import { cardDataOf, cardTitleOf, mountNoDataCard, mountPlayerCard } from '../../site/js/player_card_embed.js';
import SpspLive from '../../site/js/live.js';
import SpspLivePredict from '../../site/js/live_predict.js';
import { LOWER_CLASS_NAME_PAT, makeGql } from '../../site/js/live_fetch.js';
'use strict';

const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const $ = (id) => document.getElementById(id);
const W = /** @type {any} */ (window);
const SPSP = W.SPSP || {};
const Q = new URLSearchParams(location.search);
const CODE = (Q.get('c') || '').toLowerCase();
const WANT_ADMIN = Q.get('admin') === '1' || Q.get('demo') === 'admin';
/** 見本の画面 (?demo=list|match|conflict|waiting|done|gate|challonge|admin|setup)。見本のデータで描くだけで、API にも start.gg にも送らない */
const DEMO = Q.get('demo') || '';
const POLL_MS = 15000;
const ULT = 1386;   // start.gg の videogame (スマブラ SP)
const TOP_CUTS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];   // worker/src/api/report_logic.ts と同じ

let INFO = null;      // report_info の report
let VIEW = null;      // report_view の応答
let MATCHES = [];     // 自分の試合 (start.gg / Challonge を同じ形に)
let ME_PID = null;    // start.gg の player id
let ME_TAG = '';      // start.gg の gamerTag (出場しているかを名前で探す)
/** この大会に出場しているか (true / false / null = まだ分からない)。false ならエラーを出す (読み直しは続け、試合が出てきたら普通の画面に) */
let ENTRANT = null;
let STAGES = null;    // [{id, name}]
let CHARS = null;     // [{id, name, emoji}]
let PRED = null;      // live_predict の予想 (start.gg の大会だけ)
let PRED_AT = 0;
let pollTimer = 0;
let FORM_OPEN = null; // 入力中の試合 (読み直しで消さない)

// ── 共通 ──────────────────────────────────────────────────────────

function sess() { return SpspLogin.session(); }
function myUid() { if (DEMO) return DEMO_ME; const s = sess(); return s && s.user ? String(s.user.id) : ''; }
function tok() { const s = sess(); return s ? s.token : ''; }
async function api(body) { return DEMO ? demoApi(body) : SpspLogin.api(body); }
function errText(r) { return (r && r.error && r.error.message) || i18n('report.err.generic'); }
function setStatus(el, text, kind) { el.textContent = text || ''; el.className = 'rp-status' + (kind ? ' rp-' + kind : ''); }

function pageUrl(code, admin) {
  return location.origin + location.pathname + '?c=' + encodeURIComponent(code) + (admin ? '&admin=1' : '');
}

const STATE_LABEL = (s) => { const k = ['reported', 'agreed', 'conflict', 'review', 'fixed', 'reset'].includes(s) ? s : 'none'; return i18n('report.state.' + k); };

/** 結果 {w, g} → "2-1" (側 0 から見た数) */
function scoreText(r, mySide) {
  if (!r || !r.g) return '';
  const a = r.g.filter((g) => g.w === 0).length; const b = r.g.filter((g) => g.w === 1).length;
  return mySide === 1 ? b + '-' + a : a + '-' + b;
}

// ── キャラ・ステージの一覧 ───────────────────────────────────────────

/** 報告では 1 体ずつ選ぶ。使い手ランキングでまとめている代表 id の名前 (「サムス / ダークサムス」) は前半だけにする */
const singleName = (id, name) => (CHAR_MERGE_CANONICAL[id] === id ? String(name).split(' / ')[0] : name);
async function loadChars() {
  if (CHARS) return CHARS;
  const tbl = await SPSPCharEmoji.load().catch(() => null);
  CHARS = Object.keys(tbl || {}).map(Number).filter((id) => id > 0 && !HIDDEN_CHAR_IDS.has(id))
    .map((id) => ({ id, name: singleName(id, charName(id, (tbl[id] && tbl[id].name) || String(id))), emoji: SPSPCharEmoji.emojiOf(id) || '' }))
    .sort((a, b) => (FIGHTER_NUMBER[a.id] || 999) - (FIGHTER_NUMBER[b.id] || 999) || a.name.localeCompare(b.name, 'ja'));
  return CHARS;
}

// ── キャラ選び (キャラ投票と同じ: 名前で絞り込み + 絵文字の一覧) ──────────────────

/** ひらがな→カタカナ + 小文字 (site/js/vote.js の normChar と同じ) */
const normChar = (x) => String(x).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).toLowerCase();
const charById = (id) => (id && CHARS ? CHARS.find((x) => x.id === Number(id)) || null : null);
function cpLabel(id) {
  const c = charById(id);
  return c ? `<span class="rp-cp-em">${escapeHtml(c.emoji || '🎮')}</span><span class="rp-cp-nm">${escapeHtml(c.name)}</span>`
    : `<span class="rp-cp-nm rp-cp-none">${escapeHtml(i18n('report.char.pick'))}</span>`;
}
/** 入力欄 (hidden の値 = キャラ ID) とボタン。attr は data-char="0" など */
function charPickHtml(attr, label) {
  return `<div class="rp-cp"><span class="rp-cp-l">${escapeHtml(label)}</span><input type="hidden" ${attr} value=""><button type="button" class="rp-cp-btn" data-cp-open aria-label="${escapeHtml(label)}">${cpLabel(null)}</button></div>`;
}
function setChar(input, id) {
  input.value = id ? String(id) : '';
  const btn = input.parentElement && input.parentElement.querySelector('.rp-cp-btn');
  if (btn) btn.innerHTML = cpLabel(input.value);
}
function wireCharPickers(root, m) {
  for (const b of root.querySelectorAll('[data-cp-open]')) {
    const input = b.parentElement.querySelector('input[type=hidden]');
    const k = Number(input.getAttribute('data-char') ?? input.getAttribute('data-sum-char'));
    const slot = m && m.slots ? m.slots[k] : null;
    if (slot && slot.uid) usedCharsOf(slot.uid);   // 開く前に読んでおく
    b.addEventListener('click', () => openCharPicker(input, b.getAttribute('aria-label') || '', slot && slot.uid ? usedCharsOf(slot.uid) : null));
  }
}
/** その人の使用キャラ (多い順、最大 6)。選手のデータ (characters) → 無ければ選手一覧のメインキャラ。ID は CHARS にあるものだけ */
const USED = new Map();
function usedCharsOf(uid) {
  if (!USED.has(uid)) {
    USED.set(uid, cardDataOf(uid).then((d) => {
      const ids = ((d && d.player && d.player.characters) || []).map((c) => Number(c.id));
      const main = W.__rpMain && W.__rpMain[uid];
      if (!ids.length && main) ids.push(Number(main));
      return Array.from(new Set(ids)).filter((id) => charById(id)).slice(0, 6);
    }).catch(() => []));
  }
  return USED.get(uid);
}
/** used = 使用キャラの ID (Promise)。一覧はすぐ開き、読めたらいちばん上に足す */
function openCharPicker(input, title, used) {
  const cBtn = (c, cls) => `<button type="button" class="rp-cp-c${cls}${String(c.id) === input.value ? ' sel' : ''}" data-id="${c.id}" data-name="${escapeHtml(c.name)}"><span class="em">${escapeHtml(c.emoji || '🎮')}</span><span class="nm">${escapeHtml(c.name)}</span></button>`;
  const ov = document.createElement('div');
  ov.className = 'rp-cp-ov';
  ov.innerHTML = `<div class="rp-cp-panel" role="dialog" aria-label="${escapeHtml(title)}">
    <div class="rp-cp-head"><b>${escapeHtml(title)}</b><button type="button" class="rp-link" data-cp-clear>${escapeHtml(i18n('report.char.clear'))}</button><button type="button" class="rp-cp-x" data-cp-close aria-label="${escapeHtml(i18n('report.char.close'))}">×</button></div>
    <input type="search" class="rp-cp-q" placeholder="${escapeHtml(i18n('report.char.search'))}" autocomplete="off">
    <div class="rp-cp-used" hidden></div>
    <div class="rp-cp-grid rp-cp-all">${(CHARS || []).map((c) => cBtn(c, '')).join('')}</div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const pick = (id) => { setChar(input, id); input.dispatchEvent(new Event('change', { bubbles: true })); close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-cp-close]').addEventListener('click', close);
  ov.querySelector('[data-cp-clear]').addEventListener('click', () => pick(null));
  for (const b of ov.querySelectorAll('.rp-cp-c')) b.addEventListener('click', () => pick(b.getAttribute('data-id')));
  const btns = Array.from(ov.querySelectorAll('.rp-cp-all .rp-cp-c'));
  const usedBox = ov.querySelector('.rp-cp-used');
  let hasUsed = false;
  if (used) Promise.resolve(used).then((ids) => {
    const list = (ids || []).map(charById).filter(Boolean);
    if (!list.length || !ov.isConnected) return;
    usedBox.innerHTML = `<div class="rp-muted">${escapeHtml(i18n('report.char.used'))}</div><div class="rp-cp-grid">${list.map((c) => cBtn(c, ' rp-cp-u')).join('')}</div>`;
    for (const b of usedBox.querySelectorAll('.rp-cp-c')) b.addEventListener('click', () => pick(b.getAttribute('data-id')));
    hasUsed = true;
    usedBox.hidden = !!q.value.trim();
  }).catch(() => { /* 使用キャラが出ないだけ */ });
  const q = ov.querySelector('.rp-cp-q');
  q.addEventListener('input', () => {
    const t = normChar(q.value.trim());
    usedBox.hidden = !hasUsed || !!t;   // 絞り込み中は使用キャラの段を隠す
    let first = null;
    for (const b of btns) { const hit = !t || normChar(b.getAttribute('data-name')).includes(t); b.hidden = !hit; if (hit && !first) first = b; }
    for (const b of btns) b.classList.toggle('hit', !!t && b === first);
  });
  // Enter で絞り込みの先頭を選ぶ
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = btns.find((x) => !x.hidden); if (b) pick(b.getAttribute('data-id')); } });
  try { q.focus(); } catch (e) { /* 入力欄に移れないだけ */ }
}

const STAGE_KEY = 'spsp_report_stages_v1';
async function loadStages(gql) {
  if (STAGES) return STAGES;
  try {
    const c = JSON.parse(localStorage.getItem(STAGE_KEY) || 'null');
    if (c && c.t > Date.now() - 7 * 86400e3 && Array.isArray(c.s)) { STAGES = c.s; return STAGES; }
  } catch (e) { /* 読み直す */ }
  if (!gql) return [];
  try {
    const j = await gql('query SpspStages($id: ID!) { videogame(id: $id) { stages { id name } } }', { id: ULT });
    STAGES = ((j.data && j.data.videogame && j.data.videogame.stages) || []).map((s) => ({ id: Number(s.id), name: String(s.name || '') }));
    try { localStorage.setItem(STAGE_KEY, JSON.stringify({ t: Date.now(), s: STAGES })); } catch (e) { /* 毎回読むだけ */ }
  } catch (e) { STAGES = []; }
  return STAGES;
}

// ── start.gg の自分の試合 (本人のトークンでブラウザから) ─────────────────

const SLOT_FIELDS = 'prereqType prereqId prereqPlacement entrant { id name initialSeedNum participants { user { id } player { gamerTag } } } standing { stats { score { value } } }';
const setFields = (extra) => `id state round fullRoundText identifier totalGames winnerId lPlacement ${extra}
  phaseGroup { id displayIdentifier phase { id name groupCount } }
  slots { ${SLOT_FIELDS} }
  games { orderNum winnerId stage { id } selections { entrant { id } character { id } } }`;
const EXTRA = 'station { number } stream { streamName streamSource }';   // 台・配信台 (読めなければ外して読み直す)
let useExtra = true;

async function gqlData(gql, query, vars) {
  const j = await gql(query, vars);
  if (j && j.errors && j.errors.length) { const e = new Error('gql: ' + String(j.errors[0].message || '')); throw e; }
  return j.data || {};
}

async function startggSets(gql) {
  if (!ME_PID) {
    const d = await gqlData(gql, 'query SpspReportMe { currentUser { id player { id gamerTag } } }', {});
    ME_PID = d.currentUser && d.currentUser.player ? String(d.currentUser.player.id) : null;
    ME_TAG = d.currentUser && d.currentUser.player ? String(d.currentUser.player.gamerTag || '') : '';
    if (!ME_PID) return [];
  }
  const q = (ex) => `query SpspReportMine($eventId: ID!, $pid: ID!) { event(id: $eventId) {
    sets(perPage: 40, page: 1, sortType: RECENT, filters: { playerIds: [$pid], hideEmpty: false }) { nodes { ${setFields(ex)} } } } }`;
  let d;
  try { d = await gqlData(gql, q(useExtra ? EXTRA : ''), { eventId: INFO.event_id, pid: ME_PID }); } catch (e) {
    if (!useExtra || !/gql/.test(String(e.message))) throw e;
    useExtra = false;
    d = await gqlData(gql, q(''), { eventId: INFO.event_id, pid: ME_PID });
  }
  const nodes = (d.event && d.event.sets && d.event.sets.nodes) || [];
  const out = nodes.map(fromStartgg).filter(Boolean);
  // 試合が無いとき: 出場しているか (ブラケットが始まる前は試合が無い)。出ている大会の一覧 (新しい順) か、出場者を名前で探して本人が居るか
  if (out.length) ENTRANT = true;
  else if (ENTRANT !== true) ENTRANT = await isEntrant(gql).catch(() => null);
  // 試合待ち: 相手の枠の前の試合 (2 段まで) を読んで候補にする
  for (const m of out) {
    if (m.state !== 'waiting') continue;
    m.prereq = await Promise.all(m.rawSlots.map((s, i) => (m.slots[i] ? null : prereqOf(gql, s, CAND_DEPTH))));
  }
  return out;
}

/** 本人がこのイベントの出場者か (分からなければ null) */
async function isEntrant(gql) {
  const ev = String(INFO.event_id);
  const u = await gqlData(gql, 'query SpspReportMyEvents { currentUser { events(query: { perPage: 50, page: 1 }) { nodes { id } } } }', {}).catch(() => null);
  const evs = u && u.currentUser && u.currentUser.events ? u.currentUser.events.nodes || [] : null;
  if (evs && evs.some((e) => e && String(e.id) === ev)) return true;
  if (!ME_TAG) return evs ? false : null;
  const d = await gqlData(gql, `query SpspReportEntrant($eventId: ID!, $name: String) { event(id: $eventId) {
    entrants(query: { perPage: 20, page: 1, filter: { name: $name } }) { nodes { participants { user { id } } } } } }`, { eventId: INFO.event_id, name: ME_TAG });
  const ns = (d.event && d.event.entrants && d.event.entrants.nodes) || [];
  return ns.some((n) => (n.participants || []).some((p) => p.user && String(p.user.id) === myUid()));
}

function slotFromStartgg(s) {
  const e = s && s.entrant;
  if (!e) return null;
  const p = (e.participants || [])[0] || {};
  return { id: String(e.id), name: String(e.name || (p.player && p.player.gamerTag) || ''), uid: p.user ? String(p.user.id) : null,
    seed: e.initialSeedNum || null, score: s.standing && s.standing.stats && s.standing.stats.score ? s.standing.stats.score.value : null };
}

function fromStartgg(s) {
  if (!s || !/^\d+$/.test(String(s.id))) return null;   // preview_ の set (ブラケットの開始前) は報告できない
  const rawSlots = s.slots || [];
  const slots = [slotFromStartgg(rawSlots[0]), slotFromStartgg(rawSlots[1])];
  const uid = myUid();
  const mySide = slots[0] && slots[0].uid === uid ? 0 : slots[1] && slots[1].uid === uid ? 1 : null;
  if (mySide === null) return null;
  const complete = Number(s.state) === 3;
  const winner = complete ? (slots[0] && String(s.winnerId) === slots[0].id ? 0 : slots[1] && String(s.winnerId) === slots[1].id ? 1 : null) : null;
  const games = (s.games || []).slice().sort((a, b) => a.orderNum - b.orderNum).map((g) => ({
    w: slots[0] && String(g.winnerId) === slots[0].id ? 0 : 1,
    c: [0, 1].map((k) => { const sel = (g.selections || []).find((x) => x.entrant && slots[k] && String(x.entrant.id) === slots[k].id); return sel && sel.character ? Number(sel.character.id) : null; }),
    s: g.stage ? Number(g.stage.id) : null,
  }));
  const sc = slots.map((x) => (x && x.score !== null && x.score !== undefined ? Number(x.score) : null));
  const phase = s.phaseGroup && s.phaseGroup.phase ? s.phaseGroup.phase.name : '';
  return {
    id: String(s.id), kind: 'startgg', state: complete ? 'complete' : slots[0] && slots[1] ? 'open' : 'waiting', started: Number(s.state) === 2,
    round: s.fullRoundText || '', pool: s.phaseGroup && !(s.phaseGroup.phase && s.phaseGroup.phase.groupCount === 1) ? s.phaseGroup.displayIdentifier : '', phase,   // ブロックが 1 つだけのフェーズは番号 (「1」) を出さない
   
    groupId: s.phaseGroup && s.phaseGroup.id != null ? String(s.phaseGroup.id) : null,
    roundNum: Number.isInteger(s.round) ? s.round : null, phaseKey: s.phaseGroup && s.phaseGroup.phase && s.phaseGroup.phase.id != null ? String(s.phaseGroup.phase.id) : null,
    station: s.station && s.station.number ? s.station.number : null,
    stream: s.stream && s.stream.streamName ? { name: s.stream.streamName, source: s.stream.streamSource } : null,
    slots, mySide, winner, score: complete && sc[0] !== null && sc[1] !== null ? sc : null, games,
    totalGames: s.totalGames || null, lPlacement: s.lPlacement || null, isClass: LOWER_CLASS_NAME_PAT.test(phase || '') || LOWER_CLASS_NAME_PAT.test(INFO.name || ''),
    rawSlots, prereq: [null, null],
  };
}

/** 枠の前の試合 (候補)。depth 段までさかのぼる */
/** 次の相手の候補をさかのぼる段数 (3 段 = 最大 8 人)。それより前は「まだ決まっていない枠」とだけ出す */
const CAND_DEPTH = 3;
async function prereqOf(gql, slot, depth) {
  if (!slot || slot.prereqType !== 'set' || !/^\d+$/.test(String(slot.prereqId)) || depth <= 0) return null;
  let d;
  try {
    d = await gqlData(gql, `query SpspReportPre($id: ID!) { set(id: $id) { id state fullRoundText ${useExtra ? 'station { number }' : ''} slots { ${SLOT_FIELDS} } } }`, { id: String(slot.prereqId) });
  } catch (e) { return null; }
  const s = d.set;
  if (!s) return null;
  const raw = s.slots || [];
  const slots = [slotFromStartgg(raw[0]), slotFromStartgg(raw[1])];
  const out = { id: String(s.id), state: Number(s.state) === 3 ? 'complete' : Number(s.state) === 2 ? 'playing' : 'pending', round: s.fullRoundText || '',
    station: s.station && s.station.number ? s.station.number : null, loser: Number(slot.prereqPlacement) === 2, slots, deeper: [null, null] };
  if (depth > 1) out.deeper = await Promise.all(raw.map((r, i) => (slots[i] ? null : prereqOf(gql, r, depth - 1))));
  return out;
}

/** Challonge の試合 (report_view の challonge.matches) を同じ形に */
function fromChallonge(c) {
  if (!c || !c.participant) return [];
  const me = String(c.participant.id);
  return (c.matches || []).map((m) => {
    const slots = (m.slots || []).map((s) => (s ? { id: String(s.id), name: s.name || '', uid: s.users && s.users[0] ? String(s.users[0]) : null, seed: s.seed || null } : null));
    while (slots.length < 2) slots.push(null);
    const mySide = slots[0] && slots[0].id === me ? 0 : slots[1] && slots[1].id === me ? 1 : null;
    if (mySide === null) return null;
    const complete = m.state === 'complete';
    const prereq = (m.prereq || [null, null]).map((p) => (p ? { id: String(p.match_id), state: p.state === 'complete' ? 'complete' : p.state === 'open' ? 'playing' : 'pending', round: '',
      station: null, loser: !!p.loser, slots: (p.slots || []).map((s) => (s ? { id: String(s.id), name: s.name || '', uid: s.users && s.users[0] ? String(s.users[0]) : null, seed: s.seed || null } : null)), deeper: [null, null] } : null));
    return {
      id: String(m.id), kind: 'challonge', state: complete ? 'complete' : slots[0] && slots[1] ? 'open' : 'waiting', started: false,
      round: m.round != null ? i18n('report.round', { n: m.round }) : '', pool: m.identifier || '', phase: '', station: null, stream: null,
      roundNum: Number.isInteger(m.round) ? m.round : null, phaseKey: 'c',
      slots, mySide, winner: m.winner, score: m.score, games: [], totalGames: null, lPlacement: m.l_placement || null, isClass: true, prereq,
    };
  }).filter(Boolean);
}

// ── 予想 (勝ったら・負けたら・ここまでの変化。start.gg の大会で速報に載っているときだけ) ──

async function loadPrediction(force) {
  if (DEMO) return PRED;
  if (!INFO || INFO.kind !== 'startgg' || !myUid()) return null;
  if (!force && PRED && Date.now() - PRED_AT < 60000) return PRED;
  try {
    const uid = myUid();
    const docs = await SpspLive.load(uid);
    const hit = docs.find((x) => String((x.summary && x.summary.event_id) || (x.doc && x.doc.event_id)) === String(INFO.event_id));
    if (!hit) { PRED = { none: true }; PRED_AT = Date.now(); return PRED; }
    const [player, meta] = await Promise.all([SPSPPlayerData.load(SPSP.data || '', uid), fetch((SPSP.data || '') + 'meta.json').then((r) => r.json())]);
    const pr = SpspLivePredict.create({ uid, player, data: SPSP.data || '', meta, utcOffset: (SPSP.site && SPSP.site.utcOffset) || '+00:00' });
    const p = await pr.predict(hit.doc);
    PRED = p ? { p, doc: hit.doc } : { none: true };
  } catch (e) { PRED = { none: true }; }
  PRED_AT = Date.now();
  return PRED;
}

const fmtDelta = (d) => (d == null || !Number.isFinite(d) ? '—' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1));

function predHtml(m) {
  if (!PRED || PRED.none || !PRED.p || !PRED.p.bt) return `<p class="rp-muted">${escapeHtml(i18n('report.pred.none'))}</p>`;
  const bt = PRED.p.bt;
  let h = '';
  if (m && m.state === 'open') {
    h += `<div class="rp-pred-row"><span>${escapeHtml(i18n('report.pred.win'))}</span><b class="rp-up">${fmtDelta(bt.ifWin && bt.ifWin[m.id])}</b></div>`;
  }
  const done = MATCHES.filter((x) => x.state === 'complete' && bt.perSet && bt.perSet[x.id] != null).reverse();
  if (done.length) {
    let sum = 0;
    h += `<table class="rp-hist"><tr><th>${escapeHtml(i18n('report.pred.round'))}</th><th>${escapeHtml(i18n('report.pred.opp'))}</th><th></th><th>${escapeHtml(i18n('report.pred.delta'))}</th><th>${escapeHtml(i18n('report.pred.total'))}</th></tr>`;
    for (const x of done) {
      const d = bt.perSet[x.id]; sum += d;
      const opp = x.slots[1 - x.mySide];
      h += `<tr><td>${escapeHtml(x.round)}</td><td>${escapeHtml(opp ? opp.name : '')}</td><td>${x.winner === x.mySide ? '○' : '●'}</td>`
        + `<td class="${d >= 0 ? 'rp-up' : 'rp-down'}">${fmtDelta(d)}</td><td>${fmtDelta(sum)}</td></tr>`;
    }
    h += '</table>';
  }
  if (PRED.p.tjpr) h += `<p class="rp-muted">${escapeHtml(i18n('report.pred.tjpr', { d: fmtDelta(PRED.p.tjpr.delta) }))}</p>`;
  h += `<p class="rp-muted">${escapeHtml(i18n('report.pred.note'))}</p>`;
  return h;
}

// ── 画面: 選手 ─────────────────────────────────────────────────────

function gateOf(m) {
  const s = (INFO && INFO.settings) || {};
  if (s.opens_ms && Date.now() < s.opens_ms) return i18n('report.gate.not_open', { t: fmtOpen(s.opens_ms) });
  if (s.classes_only && !m.isClass) return i18n('report.gate.classes_only');
  if (s.top_cut && m.lPlacement && m.lPlacement <= s.top_cut) return i18n('report.gate.top_cut', { n: s.top_cut });
  return '';
}

// ── start.gg / Challonge へのリンク ───────────────────────────────────

const SGG = 'https://www.start.gg/';
/** イベントの slug (tournament/x/event/y)。形が違えば '' */
function eventSlug() { const sl = INFO && INFO.kind === 'startgg' ? String(INFO.slug || '') : ''; return /^tournament\/[\w-]+\/event\/[\w-]+$/.test(sl) ? sl : ''; }
/** Challonge のトーナメントの URL (https://challonge.com/… だけ) */
function challongeUrl() { const u = INFO && INFO.kind === 'challonge' ? String(INFO.slug || '') : ''; return /^https:\/\/([\w-]+\.)?challonge\.com\/[\w\/-]+$/.test(u) ? u : ''; }
/** ブラケット (その試合のあるプール) のページ。リンクはこれ 1 つだけ出す (2026-10-30、多すぎたので)。m が無ければイベントのブラケット */
function bracketUrl(m) {
  const sl = eventSlug();
  if (sl && m && m.phaseKey && m.groupId) return SGG + sl + '/brackets/' + m.phaseKey + '/' + m.groupId;
  return sl ? SGG + sl + '/brackets' : challongeUrl();
}
const extLink = (href, label) => (href ? `<a class="rp-ext" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>` : '');
/** その試合のあるトーナメント (ブラケット) へのリンク */
const bracketLink = (m) => extLink(bracketUrl(m), i18n('report.link.bracket', { site: INFO && INFO.kind === 'challonge' ? 'Challonge' : 'start.gg' }));
function matchLinks(m) {
  const b = bracketLink(m);
  return b ? `<div class="rp-links">${b}</div>` : '';
}
/** プール・ラウンドと、ブラケットへのリンク (1 行)。何先は「結果を報告」の見出しに出す */
function roundHtml(m) {
  return `<div class="rp-round">${escapeHtml([m.phase, m.pool, m.round].filter(Boolean).join(' · '))} ${bracketLink(m)}</div>`;
}

function rowOf(setId) { return VIEW && VIEW.sets ? VIEW.sets.find((x) => x.set_id === setId) : null; }

/** 台・配信台 */
function stationHtml(m) {
  const parts = [];
  if (m.station) parts.push(`<span class="rp-station">🎮 ${escapeHtml(i18n('report.station', { n: m.station }))}</span>`);
  if (m.stream) parts.push(`<span class="rp-stream">📺 ${escapeHtml(i18n('report.stream'))}${m.stream.name ? ' · ' + escapeHtml(m.stream.name) : ''}</span>`);
  return parts.length ? `<div class="rp-stations">${parts.join('')}</div>` : '';
}

/**
 * VS = 自分のカード・VS・相手のカード (2026-10-30、名前の文字の VS はやめた)。二つ名・名前はカードに出る。
 * カードが読み込まれるまでと SPSP にデータが無い人 (初参加・start.gg のアカウントが無い) は名前だけのカード、相手が未定なら札を出す
 */
/** VS のカード。読み込むまでは同じ大きさの空の枠、SPSP にデータが無い人 (初参加・start.gg のアカウントがつながっていない) は NO DATA のカード */
function vsCardHtml(slot, cls) {
  if (!slot) return `<div class="rp-vs-side ${cls}"><div class="rp-plate"><span class="rp-plate-n">${escapeHtml(i18n('report.tbd'))}</span></div></div>`;
  const body = `<div class="rp-card rp-vs-card pcard rp-card-wait"${slot.uid ? ` data-card-uid="${escapeHtml(slot.uid)}"` : ''} data-card-name="${escapeHtml(slot.name)}"></div>`;
  return `<div class="rp-vs-side ${cls}">${body}</div>`;
}
function vsHtml(m) {
  const me = m.slots[m.mySide]; const op = m.slots[1 - m.mySide];
  return `<div class="rp-vs">${vsCardHtml(me, 'rp-me')}<div class="rp-vs-mid"><div class="rp-vs-mark">VS</div></div>${vsCardHtml(op, 'rp-op')}</div>`;
}

/** 報告の状態 (この試合の D1 の行) */
function reportStateHtml(m) {
  const row = rowOf(m.id);
  if (!row) return '';
  let h = `<div class="rp-state rp-state-${escapeHtml(row.state)}"><b>${escapeHtml(STATE_LABEL(row.state))}</b>`;
  const mine = Object.values(row.reports || {}).find((x) => x.mine);
  const theirs = Object.values(row.reports || {}).find((x) => !x.mine);
  if (mine && mine.result) h += ` · ${escapeHtml(i18n('report.yours', { s: scoreText(mine.result, m.mySide), r: mine.result.w === m.mySide ? i18n('report.win') : i18n('report.lose') }))}`;
  if (theirs && theirs.result) h += ` · ${escapeHtml(i18n('report.theirs', { s: scoreText(theirs.result, m.mySide), r: theirs.result.w === m.mySide ? i18n('report.win') : i18n('report.lose') }))}`;
  if (row.state === 'conflict') h += `<div class="rp-warn">${escapeHtml(i18n('report.conflict_help'))}</div>`;
  if (row.state === 'review') h += `<div class="rp-warn">${escapeHtml(i18n('report.review_help'))}</div>`;
  return h + '</div>';
}

/**
 * 次の相手の候補。人数は決まっていない (相手の枠の前の試合が終わっていれば 1 人、さかのぼるほど増える)。
 * 前の試合ごとに「◯◯ の勝った方 / 負けた方」としてまとめ、まだ決まっていない枠は入れ子で前の試合を出す
 */
function candidatesHtml(m) {
  let n = 0; let open = false;
  const me = m.slots[m.mySide];
  const stateText = (p) => (p.state === 'playing' ? i18n('report.cand.playing') : p.state === 'complete' ? i18n('report.cand.done') : i18n('report.cand.pending'));
  const person = (sl) => {
    n++;
    return `<div class="rp-cand">
      <div class="rp-cand-head"><b>${escapeHtml(sl.name)}</b></div>
      ${sl.uid ? `<div class="rp-card rp-card-sm pcard" data-card-uid="${escapeHtml(sl.uid)}"></div>` : ''}
    </div>`;
  };
  const route = (p) => {
    const who = p.loser ? i18n('report.cand.loser') : i18n('report.cand.winner');
    const head = (p.round ? i18n('report.cand.route', { round: p.round, who }) : who) + ' · ' + stateText(p) + (p.station ? ' · ' + i18n('report.station', { n: p.station }) : '');
    const body = p.slots.map((sl, i) => {
      if (sl) return me && sl.id === me.id ? '' : person(sl);   // 自分は相手にならない
      const d = p.deeper && p.deeper[i];
      if (d) return route(d);
      open = true;
      return `<p class="rp-muted rp-cand-tbd">${escapeHtml(i18n('report.cand.tbd'))}</p>`;
    }).join('');
    return `<div class="rp-route"><div class="rp-route-h">${escapeHtml(head)}</div><div class="rp-cands">${body}</div></div>`;
  };
  const html = m.prereq.filter(Boolean).map(route).join('');
  if (!n && !open) return `<p class="rp-muted">${escapeHtml(i18n('report.cand.none'))}</p>`;
  return `<p class="rp-muted">${escapeHtml(open ? i18n('report.cand.count_more', { n }) : i18n('report.cand.count', { n }))}</p>` + html;
}

/** カードはプレイヤーページと同じもの (js/player_card_embed.js: データ・設定・二つ名・フォントとも同じ)。データが無ければ VS は NO DATA のカード、候補は出さない */
function fillCards(root) {
  const noData = (el) => { el.classList.remove('rp-card-wait'); mountNoDataCard(el, el.getAttribute('data-card-name') || ''); };
  for (const el of root.querySelectorAll('.rp-vs-card:not([data-card-uid])')) noData(el);
  for (const el of root.querySelectorAll('[data-card-uid]')) {
    mountPlayerCard(el, el.getAttribute('data-card-uid')).then((ok) => {
      if (!el.isConnected) return;
      el.classList.remove('rp-card-wait');
      if (ok) return;
      if (el.hasAttribute('data-card-name')) noData(el);   // VS: SPSP にデータが無い人
      else el.remove();   // 次の相手の候補: 名前は上に出ているのでカードは出さない
    }).catch(() => { /* カードが出ないだけ */ });
  }
}

/** 運営の設定の何先 (無ければ null)。worker/src/api/report_logic.ts の ftOf と同じ。これがあるとサーバもスコアを確かめる */
function ftSet(m) {
  const ft = INFO && INFO.settings && INFO.settings.ft;
  const rule = ft && m.phaseKey ? ft[m.phaseKey] : null;
  if (!rule) return null;
  const r = m.roundNum;
  const sd = r !== null && r !== undefined && r < 0 ? rule.l : rule.w;
  if (sd.from === null || sd.from === undefined) return sd.a;
  if (r === null || r === undefined) return null;
  if (r === 0) return sd.b;
  return Math.abs(r) >= sd.from ? sd.b : sd.a;
}
/**
 * 何先か: 運営の設定 → 分からなければ null。
 * start.gg の totalGames は使わない (実際の大会では 2 先のラウンドでも全部 5 のまま、2026-10-30 確認)
 */
function ftOf(m) {
  return ftSet(m);
}
const ftHtml = (m) => { const n = ftOf(m); return n ? `<span class="rp-ft">${escapeHtml(i18n('report.ft', { n }))}</span>` : ''; };

const MAX_GAMES = 9;   // worker の MAX_GAMES と同じ
const SCORE_OTHER = 'x';

/**
 * ステージの選択肢: 大会でよく使うステージ (start.gg の stage id) を先に表示言語の名前で、残りは「その他」に start.gg の名前で。
 * start.gg の一覧は 100 以上あって英語名なので、そのままでは選びにくい (2026-10-30 実データで確認)
 */
const COMMON_STAGES = [311, 484, 328, 378, 387, 397, 348, 513, 497, 407, 353, 406];
function stageOpts(stages) {
  const o = (id, name) => `<option value="${id}">${escapeHtml(name)}</option>`;
  const ids = new Set(stages.map((x) => x.id));
  const common = COMMON_STAGES.filter((id) => ids.has(id));
  const rest = stages.filter((x) => !COMMON_STAGES.includes(x.id));
  if (!common.length) return `<option value="">—</option>` + rest.map((x) => o(x.id, x.name)).join('');
  return `<option value="">—</option>` + common.map((id) => o(id, i18n('report.stage.' + id))).join('')
    + (rest.length ? `<optgroup label="${escapeHtml(i18n('report.stage_other'))}">${rest.map((x) => o(x.id, x.name)).join('')}</optgroup>` : '');
}

/**
 * 結果の入力欄。まとめて (既定) = 名前の隣でスコアを選ぶ・キャラ / 1 戦ごと = ゲームごとの勝者・キャラ・ステージ。
 * 運営の直し (m.admin、運営の画面) も同じ欄で、「自分 / 相手」の代わりに両者の名前を出す (mySide = 0)
 */
const winLabel = (m, k) => (m.admin ? i18n('report.admin.winner', { name: m.slots[k] ? m.slots[k].name : '' }) : (k === m.mySide ? i18n('report.i_won') : i18n('report.opp_won')));
const charLabel = (m, k) => (m.admin ? i18n('report.admin.char', { name: m.slots[k] ? m.slots[k].name : '' }) : (k === m.mySide ? i18n('report.my_char') : i18n('report.opp_char')));
function formHtml(m) {
  const ft = ftOf(m);
  const n = ft ? 2 * ft - 1 : MAX_GAMES;   // 1 戦ごとの欄の数 (何先が分からなければ最大まで、決着は勝ち越しで)
  const stages = STAGES || [];
  const opt = (list, sel) => `<option value="">—</option>` + list.map((x) => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${escapeHtml((x.emoji ? x.emoji + ' ' : '') + x.name)}</option>`).join('');
  const withChars = m.kind === 'startgg';
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="rp-game" data-game="${i}">
      <div class="rp-game-no">${escapeHtml(i18n('report.game', { n: i + 1 }))}</div>
      <div class="rp-game-win">
        <button type="button" class="rp-pick" data-pick="${m.mySide}">${escapeHtml(winLabel(m, m.mySide))}</button>
        <button type="button" class="rp-pick" data-pick="${1 - m.mySide}">${escapeHtml(winLabel(m, 1 - m.mySide))}</button>
      </div>
      ${withChars ? `<div class="rp-game-sel">
        ${charPickHtml(`data-char="${m.mySide}"`, charLabel(m, m.mySide))}
        ${charPickHtml(`data-char="${1 - m.mySide}"`, charLabel(m, 1 - m.mySide))}
        ${stages.length ? `<label>${escapeHtml(i18n('report.stage'))}<select data-stage>${stageOpts(stages)}</select></label>` : ''}
      </div>` : ''}
    </div>`;
  }
  // まとめて: 両者の名前・キャラ (start.gg だけ、「キャラ選択」のボタン → 選ぶとキャラ名)・スコア (0〜3・それ以外は数を入れる) を 1 行に。ステージは選べない
  // 候補: 何先が分かれば 0〜N (運営の設定なら それ以外 は出さない)、分からなければ 0〜3 と それ以外。既定は 0 (2026-10-30)
  const top = ft || 3;
  const scoreOpts = Array.from({ length: top + 1 }, (_, x) => `<option value="${x}"${x === 0 ? " selected" : ""}>${x}</option>`).join('')
    + (ftSet(m) ? '' : `<option value="${SCORE_OTHER}">${escapeHtml(i18n('report.score_other'))}</option>`);
  const sumRow = (k) => {
    const slot = m.slots[k];
    return `<div class="rp-sum-row" data-side="${k}">
      <div class="rp-sum-name">${escapeHtml(slot ? slot.name : '')}${k === m.mySide && !m.admin ? ` <span class="rp-muted">${escapeHtml(i18n('report.you'))}</span>` : ''}</div>
      ${withChars ? `<div class="rp-sum-char">${charPickHtml(`data-sum-char="${k}"`, charLabel(m, k))}</div>` : ''}
      <select class="rp-score" data-score="${k}" aria-label="${escapeHtml(i18n('report.score'))}">${scoreOpts}</select>
      <input class="rp-score-n" type="number" inputmode="numeric" min="0" max="${MAX_GAMES}" data-score-n="${k}" hidden aria-label="${escapeHtml(i18n('report.score'))}">
    </div>`;
  };
  const sumPane = `<div class="rp-pane" data-pane="sum">
      ${sumRow(m.mySide)}${sumRow(1 - m.mySide)}
    </div>`;
  return `<form class="rp-form" data-set="${escapeHtml(m.id)}">
    <div class="rp-form-top">${m.admin ? '' : `<h3>${escapeHtml(i18n('report.form.title'))} ${ftHtml(m)}</h3>`}
      <div class="rp-tabs" role="tablist">
        <button type="button" role="tab" class="rp-tab on" data-mode="sum" aria-selected="true">${escapeHtml(i18n('report.mode.sum'))}</button>
        <button type="button" role="tab" class="rp-tab" data-mode="each" aria-selected="false">${escapeHtml(i18n('report.mode.each'))}</button>
      </div></div>
    ${sumPane}
    <div class="rp-pane" data-pane="each" hidden>
    ${withChars ? '' : `<p class="rp-muted">${escapeHtml(i18n('report.form.help_ch'))}</p>`}
    ${rows}
    </div>
    <div class="rp-form-foot"><span class="rp-sum"></span><button type="submit" class="rp-btn rp-primary">${escapeHtml(m.admin ? i18n('report.admin.fix') : i18n('report.send'))}</button></div>
    <div class="rp-status" data-form-status></div>
  </form>`;
}

/** 入力欄の動き。1 戦ごと = ゲームの勝者を押すと、決着までのゲームだけ出す。キャラは前のゲームを引き継ぐ */
function wireForm(form, m) {
  const ft = ftOf(m);
  const games = Array.from(form.querySelectorAll('.rp-game'));
  const n = games.length;
  const need = ft || null;   // null = 何先か分からない (勝ち越せば送れる)
  const picked = new Array(n).fill(null);
  let mode = 'sum';
  // キャラは空欄から (選ぶ一覧のいちばん上にその人の使用キャラを出す、2026-10-30)
  wireCharPickers(form, m);
  const submit = form.querySelector('button[type=submit]');
  /** 「2-0 で勝ち」(運営: 「A の 2-0 勝ち」)。mine / opp = mySide 側から見た数 */
  const sumText = (mine, opp, done) => {
    if (!done) return i18n('report.sum_partial', { a: mine, b: opp });
    if (!m.admin) return mine > opp ? i18n('report.sum_win', { a: mine, b: opp }) : i18n('report.sum_lose', { a: mine, b: opp });
    const w = mine > opp ? m.mySide : 1 - m.mySide;
    return i18n('report.admin.sum', { name: m.slots[w] ? m.slots[w].name : '', a: Math.max(mine, opp), b: Math.min(mine, opp) });
  };
  const setSum = (text, warn) => { const el = form.querySelector('.rp-sum'); el.textContent = text; el.classList.toggle('rp-warn', !!warn); };
  /** まとめてのスコア [側 0, 側 1] (どちらか未入力なら null) */
  const sumScore = () => [0, 1].map((k) => {
    const sel = form.querySelector(`select[data-score="${k}"]`);
    if (sel.value === '') return null;
    if (sel.value !== SCORE_OTHER) return Number(sel.value);
    const v = form.querySelector(`input[data-score-n="${k}"]`).value;
    const x = Number(v);
    return v !== '' && Number.isInteger(x) && x >= 0 && x <= MAX_GAMES ? x : null;
  });
  const refreshSum = () => {
    for (const k of [0, 1]) form.querySelector(`input[data-score-n="${k}"]`).hidden = form.querySelector(`select[data-score="${k}"]`).value !== SCORE_OTHER;
    const sc = sumScore();
    submit.disabled = true;
    if (sc[0] === null || sc[1] === null) { setSum(''); return; }
    const mine = sc[m.mySide]; const opp = sc[1 - m.mySide];
    if (mine === opp) { setSum(mine === 0 ? '' : i18n('report.sum_tie'), true); return; }   // 0-0 = まだ何も入れていない
    if (mine + opp > MAX_GAMES) { setSum(i18n('report.sum_too_many'), true); return; }
    const strict = ftSet(m);
    if (strict && Math.max(mine, opp) !== strict) { setSum(i18n('report.sum_ft', { n: strict }), true); return; }
    setSum(sumText(mine, opp, true));
    submit.disabled = false;
  };
  for (const el of form.querySelectorAll('select[data-score], input[data-score-n]')) {
    el.addEventListener('change', refreshSum);
    el.addEventListener('input', refreshSum);
  }
  const refresh = () => {
    let a = 0; let b = 0; let last = -1;
    const over = () => (need ? a >= need || b >= need : false);
    for (let i = 0; i < n; i++) {
      if (over()) { games[i].hidden = true; continue; }
      games[i].hidden = i > 0 && picked[i - 1] === null;
      if (picked[i] === null) continue;
      if (picked[i] === 0) a++; else b++;
      last = i;
    }
    for (let i = 0; i < n; i++) for (const btn of games[i].querySelectorAll('.rp-pick')) btn.classList.toggle('on', picked[i] !== null && Number(btn.getAttribute('data-pick')) === picked[i]);
    const done = need ? a >= need || b >= need : a !== b;
    const mine = m.mySide === 0 ? a : b; const opp = m.mySide === 0 ? b : a;
    setSum(last < 0 ? '' : sumText(mine, opp, done));
    submit.disabled = !done;
  };
  for (const tab of form.querySelectorAll('.rp-tab')) {
    tab.addEventListener('click', () => {
      mode = tab.getAttribute('data-mode');
      for (const t of form.querySelectorAll('.rp-tab')) { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', String(t === tab)); }
      for (const p of form.querySelectorAll('.rp-pane')) p.hidden = p.getAttribute('data-pane') !== mode;
      if (mode === 'sum') refreshSum(); else refresh();
    });
  }
  games.forEach((g, i) => {
    for (const btn of g.querySelectorAll('.rp-pick')) {
      btn.addEventListener('click', () => {
        picked[i] = Number(btn.getAttribute('data-pick'));
        for (let j = i + 1; j < n; j++) if (games[j].hidden) picked[j] = null;
        // 次のゲームのキャラは前のゲームを引き継ぐ
        if (i + 1 < n) for (const inp of g.querySelectorAll('input[data-char]')) {
          const nx = games[i + 1].querySelector(`input[data-char="${inp.getAttribute('data-char')}"]`);
          if (nx && inp.value) setChar(nx, inp.value);
        }
        refresh();
      });
    }
  });
  refreshSum();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    const g = [];
    const v = (sel) => (sel && sel.value ? Number(sel.value) : null);
    if (mode === 'sum') {
      const sc = sumScore();
      if (sc[0] === null || sc[1] === null || sc[0] === sc[1]) return;
      // ゲームの順は分からないので、負けた側の勝ちを先に並べる (最後のゲームは勝った側)。キャラは全ゲーム同じ・ステージなし
      const c = [v(form.querySelector('input[data-sum-char="0"]')), v(form.querySelector('input[data-sum-char="1"]'))];
      const ws = sc[0] > sc[1] ? 0 : 1;
      for (let i = 0; i < sc[1 - ws]; i++) g.push({ w: 1 - ws, c: c.slice(), s: null });
      for (let i = 0; i < sc[ws]; i++) g.push({ w: ws, c: c.slice(), s: null });
    } else {
      for (let i = 0; i < n; i++) {
        if (picked[i] === null || games[i].hidden) break;
        g.push({ w: picked[i], c: [v(games[i].querySelector('input[data-char="0"]')), v(games[i].querySelector('input[data-char="1"]'))], s: v(games[i].querySelector('select[data-stage]')) });
      }
    }
    const a = g.filter((x) => x.w === 0).length; const b = g.filter((x) => x.w === 1).length;
    const result = { w: a > b ? 0 : 1, g };
    const op = m.slots[1 - m.mySide];
    const won = result.w === m.mySide;
    if (m.admin) { await m.onSubmit(result, form); return; }
    if (!confirm(i18n('report.confirm', { opp: op ? op.name : '', s: scoreText(result, m.mySide), r: won ? i18n('report.win') : i18n('report.lose') }))) return;
    const st = form.querySelector('[data-form-status]');
    setStatus(st, i18n('report.sending'), 'busy');
    submit.disabled = true;
    const r = await api({ action: 'report_submit', token: tok(), code: CODE, set_id: m.id, result });
    if (!r || !r.ok) { setStatus(st, errText(r), 'err'); submit.disabled = false; return; }
    const sentKind = ['reported', 'agreed', 'conflict', 'review', 'fixed'].includes(r.state) ? r.state : 'reported';
    setStatus(st, i18n('report.sent.' + sentKind), r.state === 'conflict' || r.state === 'review' ? 'warn' : 'ok');
    FORM_OPEN = null;
    setTimeout(() => poll(true), 800);
  });
}

/** マッチングのアニメーション (試合ごとに 1 回) */
const SEEN_KEY = 'spsp_report_seen_v1';
function seen(id) { try { return (JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')).includes(id); } catch (e) { return false; } }
function markSeen(id) { try { const a = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); a.push(id); sessionStorage.setItem(SEEN_KEY, JSON.stringify(a.slice(-50))); } catch (e) { /* 毎回出るだけ */ } }
/** 二つ名 (カードの設定)。読めなければ空。待つのは長くても ms まで */
function titleOf(uid, ms) {
  if (!uid) return Promise.resolve('');
  const p = cardTitleOf(uid).catch(() => '');
  return Promise.race([p, new Promise((r) => setTimeout(() => r(''), ms))]);
}
async function matchAnimation(m) {
  if (!DEMO && seen(m.id)) return;
  if (!DEMO) markSeen(m.id);
  const me = m.slots[m.mySide]; const op = m.slots[1 - m.mySide];
  for (const sl of [me, op]) if (sl && sl.uid) cardDataOf(sl.uid);   // VS のカードはアニメーションの間に読んでおく (画面はこの下に先に作ってある)
  // 幕は先に (同じ処理の中で) 出して、下の画面が見えないようにする。中身は二つ名を読んでから (最大 1.2 秒)
  const ov = document.createElement('div');
  ov.className = 'rp-match-ov';
  document.body.appendChild(ov);
  let skipped = false;
  ov.addEventListener('click', () => { skipped = true; }, { once: true });
  let [tMe, tOp] = await Promise.all([titleOf(me && me.uid, 1200), titleOf(op && op.uid, 1200)]);
  if (DEMO) { tMe = tMe || i18n('report.demo.title_me'); tOp = tOp || i18n('report.demo.title_op'); }   // 見本: 二つ名が無い人には見本の二つ名
  const side = (slot, title, cls) => `<span class="rp-match-p ${cls}">${title ? `<span class="rp-match-t">${escapeHtml(title)}</span>` : ''}<span class="rp-match-n">${escapeHtml(slot ? slot.name : '')}</span></span>`;
  ov.innerHTML = `<div class="rp-match-title">${escapeHtml(i18n('report.matched'))}</div>
    <div class="rp-match-names">${side(me, tMe, 'rp-match-l')}<span class="rp-match-vs">VS</span>${side(op, tOp, 'rp-match-r')}</div>
    ${ftOf(m) ? `<div class="rp-match-ft">${escapeHtml(i18n('report.ft', { n: ftOf(m) }))}</div>` : ''}
    ${m.station || m.stream ? `<div class="rp-match-station">${m.station ? escapeHtml(i18n('report.station', { n: m.station })) : ''}${m.stream ? ' 📺 ' + escapeHtml(i18n('report.stream')) : ''}</div>` : ''}
    <div class="rp-match-skip">${escapeHtml(i18n('report.match_skip'))}</div>`;
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch (e) { /* 震えないだけ */ }
  // タップ (クリック)・Esc / Enter / Space で飛ばす。飛ばしたときは短く消す
  return new Promise((res) => {
    let over = false;
    const done = (skip) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      ov.classList.add(skip ? 'skip' : 'out');
      setTimeout(() => { ov.remove(); res(); }, skip ? 120 : 350);
    };
    const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); done(true); } };
    ov.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => done(false), 2200);
    if (skipped) done(true);   // 二つ名を読んでいる間にタップされた
  });
}

/** アニメーションの後、相手のカードが画面の上に来るところまでスクロールする (1 試合 1 回。その下に台・試合開始・入力欄が続く) */
const SCROLLED = new Set();
function scrollToMatch(m) {
  if (!m || SCROLLED.has(m.id)) return;
  SCROLLED.add(m.id);
  const op = document.querySelector('.rp-current .rp-op');
  if (!op) return;
  let top = 0;   // 上に貼り付くヘッダーの高さ
  for (const el of document.querySelectorAll('header, .site-header, nav')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'sticky' || cs.position === 'fixed') && el.getBoundingClientRect().top <= 0) top = Math.max(top, el.getBoundingClientRect().bottom);
  }
  const y = op.getBoundingClientRect().top + window.scrollY - top - 8;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
}

function renderPlayer() {
  const root = $('rp-player');
  root.hidden = false;
  const cur = MATCHES.find((m) => m.state === 'open');
  const waiting = MATCHES.find((m) => m.state === 'waiting');
  const done = MATCHES.filter((m) => m.state === 'complete');
  const notices = (VIEW && VIEW.sets ? VIEW.sets : []).filter((r) => r.state === 'conflict');
  let h = '';
  if (ENTRANT === false && !MATCHES.length) {
    // ログインしているが出場者に居ない: 報告できない (別のアカウントなら入り直す)
    const s = sess();
    root.innerHTML = `<section class="rp-card-sec">
      <p class="rp-err">${escapeHtml(i18n('report.not_entrant'))}</p>
      <p class="rp-muted">${escapeHtml(i18n('report.not_entrant_who', { name: DEMO ? i18n('report.demo.to_name') : s && s.user ? s.user.gamerTag || '' : '' }))}</p>
      <button type="button" class="rp-btn" data-other-login>${escapeHtml(i18n('report.not_entrant_relogin'))}</button>
    </section>`;
    root.querySelector('[data-other-login]').addEventListener('click', () => { if (!DEMO) SpspLogin.startLogin(location.pathname + location.search); });
    return;
  }
  if (notices.length) h += `<div class="rp-banner rp-warn">⚠ ${escapeHtml(i18n('report.banner_conflict', { n: notices.length }))}</div>`;
  if (cur) {
    const gate = gateOf(cur);
    // スマホで探さずに報告できるよう、カード → (相手のカードを画面の上に) → ラウンド・台 → 入力欄 の順 (2026-10-30)
    h += `<section class="rp-card-sec rp-current">
      ${vsHtml(cur)}
      ${roundHtml(cur)}
      ${stationHtml(cur)}
      ${reportStateHtml(cur)}
      ${gate ? `<p class="rp-gate">${escapeHtml(gate)}</p>` : (FORM_OPEN === cur.id || !rowOf(cur.id) ? formHtml(cur) : `<button type="button" class="rp-btn" data-reopen="${escapeHtml(cur.id)}">${escapeHtml(i18n('report.resend'))}</button>`)}
      <details class="rp-more" data-pred="${escapeHtml(cur.id)}"><summary>${escapeHtml(i18n('report.more'))}</summary><div class="rp-pred">${escapeHtml(i18n('report.loading'))}</div></details>
    </section>`;
  } else if (waiting) {
    h += `<section class="rp-card-sec">
      <h2>${escapeHtml(i18n('report.waiting'))}</h2>
      ${roundHtml(waiting)}
      ${stationHtml(waiting)}
      <h3>${escapeHtml(i18n('report.cand.title'))}</h3>
      ${candidatesHtml(waiting)}
    </section>`;
  } else {
    h += `<section class="rp-card-sec"><p>${escapeHtml(MATCHES.length ? i18n('report.no_current') : i18n('report.no_sets'))}</p>${matchLinks(done[0] || null)}</section>`;
  }
  if (done.length) {
    h += `<section class="rp-card-sec"><h2>${escapeHtml(i18n('report.done'))}</h2><ul class="rp-done">` + done.map((m) => {
      const op = m.slots[1 - m.mySide];
      const row = rowOf(m.id);
      const sc = m.score ? (m.mySide === 0 ? m.score[0] + '-' + m.score[1] : m.score[1] + '-' + m.score[0]) : '';
      return `<li><span class="rp-done-r">${m.winner === m.mySide ? '○' : '●'}</span> ${escapeHtml(m.round)} · ${escapeHtml(op ? op.name : '')} ${escapeHtml(sc)}`
        + `${row ? ` <span class="rp-tag rp-state-${escapeHtml(row.state)}">${escapeHtml(STATE_LABEL(row.state))}</span>` : ''}`
        + `${!gateOf(m) ? ` <button type="button" class="rp-link" data-redo="${escapeHtml(m.id)}">${escapeHtml(i18n('report.redo'))}</button>` : ''}</li>`
        + (FORM_OPEN === m.id ? `<li class="rp-redo-form">${formHtml(m)}</li>` : '');
    }).join('') + `</ul></section>`;
  }
  root.innerHTML = h;
  for (const form of root.querySelectorAll('form.rp-form')) {
    const m = MATCHES.find((x) => x.id === form.getAttribute('data-set'));
    if (m) wireForm(form, m);
  }
  for (const b of root.querySelectorAll('[data-reopen],[data-redo]')) {
    b.addEventListener('click', () => { FORM_OPEN = b.getAttribute('data-reopen') || b.getAttribute('data-redo'); renderPlayer(); });
  }
  const det = root.querySelector('details[data-pred]');
  if (det) det.addEventListener('toggle', async () => {
    if (!det.open) return;
    await loadPrediction(false);
    const m = MATCHES.find((x) => x.id === det.getAttribute('data-pred'));
    det.querySelector('.rp-pred').innerHTML = predHtml(m);
  });
  fillCards(root);
}

// ── 読み直し ─────────────────────────────────────────────────────────

let GQL = null;
let LAST_SIG = '';
/** 試合の状態の要約 (start.gg / Challonge 側で結果が変わったかを見る) */
/** 試合待ちの画面に出るもの (台・配信・次の相手の候補の試合の進み具合)。報告の入力欄が無いときだけ見る (描き直しで入力を消さない) */
function waitingSig() {
  if (MATCHES.some((m) => m.state === 'open')) return '';
  const w = MATCHES.find((m) => m.state === 'waiting');
  if (!w) return '';
  const pre = (p) => (p ? [p.id, p.state, p.station || '', (p.slots || []).map((x) => (x ? x.id : '')).join('/'), (p.deeper || []).map(pre).join(',')].join(':') : '');
  return [w.id, w.station || '', w.stream ? w.stream.name : '', (w.prereq || []).map(pre).join(';')].join('~');
}
function matchesSig() {
  return waitingSig() + '#' + MATCHES.map((m) => [m.id, m.state, m.winner, m.score ? m.score.join('-') : '', (m.slots || []).map((x) => (x ? x.id : '')).join('/')].join(':')).join('|')
    + '#' + String(ENTRANT) + '#' + (VIEW && VIEW.sets ? VIEW.sets.map((r) => r.set_id + ':' + r.state + ':' + r.updated_ms).join('|') : '');
}
async function poll(force) {
  if (DEMO) { renderPlayer(); return; }
  clearTimeout(pollTimer);
  if (!force && document.visibilityState === 'hidden') { pollTimer = setTimeout(poll, POLL_MS); return; }
  const st = $('rp-status');
  try {
    const v = await api({ action: 'report_view', token: tok(), code: CODE });
    if (!v || !v.ok) {
      setStatus(st, errText(v), 'err');
      if (v && v.error && (v.error.code === 'report_closed' || v.error.code === 'auth_failed')) return;
    } else {
      VIEW = v;
      if (v.admin) $('rp-to-admin').hidden = false;
      if (INFO.kind === 'challonge') {
        MATCHES = fromChallonge(v.challonge);
        if (v.challonge && !v.challonge.error) ENTRANT = !!v.challonge.participant;
      }
      else {
        const tok = await SpspStartggIdentity.token();
        if (!tok) { setStatus(st, i18n('report.need_relogin'), 'warn'); $('rp-relogin').hidden = false; return; }
        if (!GQL) GQL = makeGql(tok, 1000000);
        if (!CHARS) await loadChars();
        if (!STAGES) await loadStages(GQL);
        MATCHES = await startggSets(GQL);
      }
      if (!CHARS) await loadChars();
      await loadMains();
      const cur = MATCHES.find((m) => m.state === 'open');
      // 画面は先に作って、アニメーションはその上に出す (カード・二つ名の読み込みを待たずに操作できる)
      const sig = matchesSig();
      // 入力の途中を消さないよう、start.gg / 報告の状態が変わったときだけ描き直す
      if (!LAST_SIG || sig !== LAST_SIG) renderPlayer();
      LAST_SIG = sig;
      if (cur) matchAnimation(cur).then(() => scrollToMatch(cur));
      setStatus(st, i18n('report.updated', { t: new Date().toLocaleTimeString() }), '');
    }
  } catch (e) {
    if (e && e.auth) { SpspStartggIdentity.clear(); GQL = null; }
    setStatus(st, i18n('report.err.read') + ' (' + String((e && e.message) || e).slice(0, 80) + ')', 'err');
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

/** 選手のメインキャラ (入力欄の初期値)。選手一覧 (views) の char */
let MAINS_P = null;
async function loadMains() {
  if (!MAINS_P) {
    MAINS_P = SPSPViews.at(SPSP.data || '').index().catch(() => null);
  }
  const ix = await MAINS_P;
  if (!ix) return;
  W.__rpMain = W.__rpMain || {};
  for (const m of MATCHES) for (const s of m.slots) if (s && s.uid && !(s.uid in W.__rpMain)) { const r = ix.get(Number(s.uid)); W.__rpMain[s.uid] = r && r.char ? Number(r.char) : null; }
}

// ── 画面: 運営 ─────────────────────────────────────────────────────

function noteText(note) {
  const k = /^error:/.test(note) ? 'error' : ['locked_conflict', 'locked_change', 'external_mismatch', 'admin'].includes(note) ? note : 'other';
  return i18n('report.note.' + k) + (k === 'error' ? ' (' + note.slice(6, 80) + ')' : '');
}

/** 受付の開始 (datetime-local の値 ⇔ ms、端末の時刻で) */
const pad2 = (n) => String(n).padStart(2, '0');
function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromLocalInput(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}
const fmtOpen = (ms) => new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
function settingsFormHtml(s, kind) {
  const tc = s && s.top_cut ? s.top_cut : '';
  return `<div class="rp-settings">
    <label>${escapeHtml(i18n('report.set.opens'))}
      <input type="datetime-local" data-set-open value="${escapeHtml(toLocalInput(s && s.opens_ms))}"></label>
    <label>${escapeHtml(i18n('report.set.top_cut'))}
      <select data-set-top><option value="">${escapeHtml(i18n('report.set.top_none'))}</option>${TOP_CUTS.map((n) => `<option value="${n}"${n === tc ? ' selected' : ''}>${escapeHtml(i18n('report.set.top_n', { n }))}</option>`).join('')}</select></label>
    ${kind === 'challonge' ? '' : `<label class="rp-check"><input type="checkbox" data-set-cls${s && s.classes_only ? ' checked' : ''}> ${escapeHtml(i18n('report.set.classes_only'))}</label>`}
  </div>`;
}
function readSettings(root) {
  const top = root.querySelector('[data-set-top]'); const cls = root.querySelector('[data-set-cls]'); const op = root.querySelector('[data-set-open]');
  const out = { top_cut: top && top.value ? Number(top.value) : null, classes_only: !!(cls && cls.checked) };
  const ms = op ? fromLocalInput(op.value) : null;
  if (ms) out.opens_ms = ms;
  return out;
}

/** 何先の設定 (フェーズごと)。rule = { w: {a, from, b}, l: {a, from, b} } (worker/src/api/report_logic.ts の FtRule) */
const FT_MAX = 5;
let PHASES = null;   // report_phases の phases (1 回だけ読む)
const ftRoundLabel = (r) => r.label || (r.n > 0 ? i18n('report.ft.round_w', { n: r.n }) : i18n('report.ft.round_l', { n: -r.n }));
function ftModeOf(rule) {
  if (!rule) return '';
  const { w, l } = rule;
  if (w.from == null && l.from == null && w.a === l.a && w.a <= 3) return 'all' + w.a;
  return 'split';
}
/** start.gg のラウンドの何本勝負 (bestOf) から、側ごとの { a, from, b } (切り替えが 1 回までのとき)。読めなければ null */
const boFt = (bo) => (Number.isInteger(bo) && bo > 0 && bo % 2 === 1 ? (bo + 1) / 2 : null);
function sggSide(ph, k) {
  const rs = (ph.rounds || []).filter((r) => (k === 'w' ? r.n > 0 : r.n < 0) && boFt(r.bestOf));
  if (!rs.length) return null;
  const a = boFt(rs[0].bestOf);
  const sw = rs.find((r) => boFt(r.bestOf) !== a);
  return { a, from: sw ? Math.abs(sw.n) : null, b: sw ? boFt(sw.bestOf) : a, label: sw ? ftRoundLabel(sw) : '' };
}
/** start.gg の設定のまとめ (例: 勝者側 2 先 → Winners Final から 3 先) */
function sggSummary(ph) {
  const part = (k) => {
    const sd = sggSide(ph, k);
    if (!sd) return '';
    const name = k === 'w' ? i18n('report.ft.winners') : i18n('report.ft.losers');
    return name + ' ' + i18n('report.ft', { n: sd.a }) + (sd.from ? ' → ' + i18n('report.ft.from', { r: sd.label }) + ' ' + i18n('report.ft', { n: sd.b }) : '');
  };
  return [part('w'), part('l')].filter(Boolean).join(' · ');
}
function ftPhaseHtml(ph, rule) {
  const mode = ftModeOf(rule);
  const sgg = sggSummary(ph);
  const nums = (sel) => Array.from({ length: FT_MAX }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${escapeHtml(i18n('report.ft', { n: i + 1 }))}</option>`).join('');
  const side = (k) => {
    const rounds = (ph.rounds || []).filter((r) => (k === 'w' ? r.n > 0 : r.n < 0));
    if (k === 'l' && !rounds.length) return '';
    const sd = rule ? rule[k] : sggSide(ph, k) || { a: 2, from: null, b: 3 };   // 初期値は start.gg の設定
    const from = rounds.map((r) => `<option value="${Math.abs(r.n)}"${sd.from === Math.abs(r.n) ? ' selected' : ''}>${escapeHtml(i18n('report.ft.from', { r: ftRoundLabel(r) }))}</option>`).join('');
    return `<div class="rp-ft-side"><span class="rp-ft-k">${escapeHtml(k === 'w' ? i18n('report.ft.winners') : i18n('report.ft.losers'))}</span>
      <select data-ft-a="${k}">${nums(sd.a)}</select>
      <select data-ft-from="${k}"><option value="">${escapeHtml(i18n('report.ft.no_change'))}</option>${from}</select>
      <select data-ft-b="${k}"${sd.from == null ? ' hidden' : ''}>${nums(sd.b || 3)}</select></div>`;
  };
  const modes = [['', sgg ? i18n('report.ft.use_sgg') : i18n('report.ft.unset')], ['all1', i18n('report.ft.all', { n: 1 })], ['all2', i18n('report.ft.all', { n: 2 })], ['all3', i18n('report.ft.all', { n: 3 })], ['split', i18n('report.ft.split')]];
  return `<div class="rp-ft-ph" data-ph="${escapeHtml(ph.key)}">
    <label>${escapeHtml(ph.name || i18n('report.ft.phase_all'))}
      <select data-ft-mode>${modes.map(([v, t]) => `<option value="${v}"${v === mode ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>
    <div data-ft-split${mode === 'split' ? '' : ' hidden'}>${side('w')}${side('l')}</div>
  </div>`;
}
function wireFt(root) {
  for (const ph of root.querySelectorAll('.rp-ft-ph')) {
    const mode = ph.querySelector('[data-ft-mode]');
    mode.addEventListener('change', () => { ph.querySelector('[data-ft-split]').hidden = mode.value !== 'split'; });
    for (const from of ph.querySelectorAll('[data-ft-from]')) {
      from.addEventListener('change', () => { ph.querySelector(`[data-ft-b="${from.getAttribute('data-ft-from')}"]`).hidden = !from.value; });
    }
  }
}
function readFt(root) {
  const out = {};
  for (const ph of root.querySelectorAll('.rp-ft-ph')) {
    const mode = ph.querySelector('[data-ft-mode]').value;
    if (!mode) continue;
    if (mode !== 'split') { const n = Number(mode.slice(3)); out[ph.getAttribute('data-ph')] = { w: { a: n, from: null, b: n }, l: { a: n, from: null, b: n } }; continue; }
    const sd = (k) => {
      const a = ph.querySelector(`[data-ft-a="${k}"]`);
      if (!a) return null;
      const from = ph.querySelector(`[data-ft-from="${k}"]`).value;
      const b = Number(ph.querySelector(`[data-ft-b="${k}"]`).value);
      return { a: Number(a.value), from: from ? Number(from) : null, b: from ? b : Number(a.value) };
    };
    const w = sd('w'); const l = sd('l');
    if (w || l) out[ph.getAttribute('data-ph')] = { w: w || l, l: l || w };
  }
  return Object.keys(out).length ? out : null;
}

const ADMIN_POLL_MS = 15000;
let adminTimer = 0;
let ADMIN_SIG = '';

// ── 名前をつけて保存した設定 (アカウントごと、worker の report_presets) ──────────────
// phase id は大会ごとに違うので、何先はフェーズ名・順番 (i)・切り替えのラウンド名 (fl) で持ち、呼び出すときにこの大会のフェーズに当てはめる
const PRESET_PENDING = 'spsp_report_preset_pending';   // 受付を始める画面で選んだ設定 (受付の後に何先を当てはめる)
const roundLabelOf = (ph, n) => { const r = (ph.rounds || []).find((x) => x.n === n); return r && r.label ? r.label : null; };
function presetFrom(settings, ft) {
  const phases = [];
  (PHASES || []).forEach((ph, i) => {
    const rule = ft && ft[ph.key];
    if (!rule) return;
    const side = (sd, sign) => ({ a: sd.a, from: sd.from, b: sd.b, fl: sd.from ? roundLabelOf(ph, sign * sd.from) : null });
    phases.push({ name: ph.name || '', i, w: side(rule.w, 1), l: side(rule.l, -1) });
  });
  return { top_cut: settings.top_cut, classes_only: settings.classes_only, phases };
}
/** 保存した設定の何先を、この大会のフェーズに当てはめる。同じ名前のフェーズ → 無ければ同じ順番。当てはまらなかったフェーズ名も返す */
function presetToFt(p) {
  const ft = {}; const missed = []; const used = new Set();
  for (const pp of (p && p.phases) || []) {
    const ph = (PHASES || []).find((x) => pp.name && x.name === pp.name && !used.has(x.key))
      || ((PHASES || [])[pp.i] && !used.has(PHASES[pp.i].key) ? PHASES[pp.i] : null);
    if (!ph) { missed.push(pp.name || '#' + (pp.i + 1)); continue; }
    used.add(ph.key);
    const side = (sd, sign) => {
      if (!sd.from) return { a: sd.a, from: null, b: sd.a };
      const r = sd.fl ? (ph.rounds || []).find((x) => sign * x.n > 0 && x.label === sd.fl) : null;   // 同じ名前のラウンド (Winners Final など) から
      return { a: sd.a, from: r ? Math.abs(r.n) : sd.from, b: sd.b };
    };
    ft[ph.key] = { w: side(pp.w, 1), l: side(pp.l, -1) };
  }
  return { ft: Object.keys(ft).length ? ft : null, missed };
}
function presetBarHtml(withSave) {
  return `<div class="rp-presets">
    <label class="rp-preset-l">${escapeHtml(i18n('report.preset.title'))}
      <select id="rp-preset-sel"><option value="">${escapeHtml(i18n('report.loading'))}</option></select></label>
    <button type="button" class="rp-btn" id="rp-preset-load" disabled>${escapeHtml(i18n('report.preset.load'))}</button>
    <button type="button" class="rp-link" id="rp-preset-del" disabled>${escapeHtml(i18n('report.preset.delete'))}</button>
    ${withSave ? `<div class="rp-preset-save"><input type="text" id="rp-preset-name" maxlength="40" placeholder="${escapeHtml(i18n('report.preset.name'))}">
      <button type="button" class="rp-btn" id="rp-preset-save">${escapeHtml(i18n('report.preset.save'))}</button></div>` : ''}
    <span class="rp-status" id="rp-preset-status"></span>
  </div>`;
}
/** 保存した設定の欄を動かす。onLoad(preset, name) = 呼び出したとき、current() = 今の入力 (保存する中身) */
function wirePresets(onLoad, current) {
  const sel = $('rp-preset-sel'); const st = $('rp-preset-status');
  let list = [];
  const fill = (xs, pick) => {
    list = xs || [];
    sel.innerHTML = list.length ? `<option value="">—</option>` + list.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join('')
      : `<option value="">${escapeHtml(i18n('report.preset.none'))}</option>`;
    const i = pick ? list.findIndex((p) => p.name === pick) : -1;
    sel.value = i >= 0 ? String(i) : '';
    sel.dispatchEvent(new Event('change'));
  };
  sel.addEventListener('change', () => { const on = sel.value !== ''; $('rp-preset-load').disabled = !on; $('rp-preset-del').disabled = !on; });
  const sel1 = () => list[Number(sel.value)] || null;
  $('rp-preset-load').addEventListener('click', () => { const p = sel1(); if (p) onLoad(p.settings, p.name); });
  $('rp-preset-del').addEventListener('click', async () => {
    const p = sel1(); if (!p || !confirm(i18n('report.preset.delete_confirm', { name: p.name }))) return;
    const x = await api({ action: 'report_preset_delete', token: tok(), name: p.name });
    if (x && x.ok) fill(x.presets); else setStatus(st, errText(x), 'err');
  });
  const save = $('rp-preset-save');
  if (save) save.addEventListener('click', async () => {
    const name = String($('rp-preset-name').value || '').trim();
    if (!name) { setStatus(st, i18n('report.preset.need_name'), 'err'); return; }
    if (list.some((p) => p.name === name) && !confirm(i18n('report.preset.overwrite', { name }))) return;
    const x = await api({ action: 'report_preset_save', token: tok(), name, settings: current() });
    if (x && x.ok) { fill(x.presets, name); setStatus(st, i18n('report.preset.saved', { name }), 'ok'); } else setStatus(st, errText(x), 'err');
  });
  (async () => {
    const x = await api({ action: 'report_presets', token: tok() });
    if (x && x.ok) fill(x.presets); else { fill([]); setStatus(st, errText(x), 'err'); }
  })();
}
function applySettingsInputs(root, p) {
  const top = root.querySelector('[data-set-top]'); const cls = root.querySelector('[data-set-cls]');
  if (top) top.value = p.top_cut ? String(p.top_cut) : '';
  if (cls) cls.checked = !!p.classes_only;
}

async function renderAdmin() {
  const root = $('rp-admin');
  root.hidden = false;
  const r = await api({ action: 'report_admin', token: tok(), code: CODE });
  if (!r || !r.ok) { root.innerHTML = `<p class="rp-err">${escapeHtml(errText(r))}</p>`; return; }
  const ev = r.report;
  const url = pageUrl(CODE, false);
  root.innerHTML = `<section class="rp-card-sec">
    <h2>${escapeHtml(i18n('report.admin.share'))}</h2>
    <div class="rp-share"><input type="text" readonly value="${escapeHtml(url)}" id="rp-share-url"><button type="button" class="rp-btn" id="rp-copy">${escapeHtml(i18n('report.admin.copy'))}</button></div>
    <p class="rp-muted">${escapeHtml(i18n('report.admin.expires', { t: new Date(ev.expires_ms).toLocaleString() }))}</p>
    ${matchLinks(null)}
    <h3>${escapeHtml(i18n('report.admin.settings'))}</h3>
    ${presetBarHtml(true)}
    ${settingsFormHtml(ev.settings, ev.kind)}
    <h3>${escapeHtml(i18n('report.ft.title'))}</h3>
    <div id="rp-ft-set" class="rp-ft-set"><p class="rp-muted">${escapeHtml(i18n('report.loading'))}</p></div>
    <button type="button" class="rp-btn" id="rp-save-set">${escapeHtml(i18n('report.admin.save'))}</button> <span class="rp-status" id="rp-set-status"></span>
  </section>
  <section class="rp-card-sec" id="rp-adm-sets"></section>
  <section class="rp-card-sec"><button type="button" class="rp-btn rp-danger" id="rp-stop">${escapeHtml(i18n('report.admin.stop'))}</button></section>`;
  $('rp-copy').addEventListener('click', () => { const i = $('rp-share-url'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } });
  let curFt = ev.settings && ev.settings.ft ? ev.settings.ft : null;
  const drawFt = (ft) => {
    const box = $('rp-ft-set');
    box.innerHTML = PHASES.length ? PHASES.map((ph) => ftPhaseHtml(ph, ft && ft[ph.key])).join('') : `<p class="rp-muted">${escapeHtml(i18n('report.ft.no_phases'))}</p>`;
    wireFt(box);
  };
  const phasesP = (async () => {
    if (!PHASES) { const p = await api({ action: 'report_phases', token: tok(), code: CODE }); PHASES = p && p.ok ? p.phases : []; }
    drawFt(curFt);
  })();
  const formFt = () => (PHASES && PHASES.length ? readFt($('rp-ft-set')) : curFt);
  const saveSettings = async (msg) => {
    const settings = { ...readSettings(root), ft: formFt() };
    const x = await api({ action: 'report_settings', token: tok(), code: CODE, settings });
    setStatus($('rp-set-status'), x && x.ok ? msg || i18n('report.admin.saved') : errText(x), x && x.ok ? 'ok' : 'err');
    if (x && x.ok) { curFt = x.settings.ft || null; if (INFO) INFO.settings = x.settings; }
    return !!(x && x.ok);
  };
  $('rp-save-set').addEventListener('click', () => saveSettings());
  // 保存した設定を呼び出す = 入力に入れて、この大会の設定として保存する
  const loadPreset = async (p, name) => {
    await phasesP;
    applySettingsInputs(root, p);
    const { ft, missed } = presetToFt(p);
    if (PHASES.length) drawFt(ft);
    await saveSettings(i18n('report.preset.loaded', { name }) + (missed.length ? ' ' + i18n('report.preset.missed', { names: missed.join(', ') }) : ''));
  };
  wirePresets(loadPreset, () => presetFrom(readSettings(root), formFt()));
  // 受付を始める画面で選んだ設定: 範囲は受付のときに入っているので、何先だけ当てはめる
  let pend = null;
  try { pend = JSON.parse(sessionStorage.getItem(PRESET_PENDING) || 'null'); sessionStorage.removeItem(PRESET_PENDING); } catch (e) { pend = null; }
  if (pend && pend.settings && !curFt) loadPreset(pend.settings, pend.name || '');
  $('rp-stop').addEventListener('click', async () => {
    if (!confirm(i18n('report.admin.stop_confirm'))) return;
    const x = await api({ action: 'report_stop', token: tok(), code: CODE });
    if (x && x.ok) location.reload(); else alert(errText(x));
  });
  // 直しの欄のキャラ・ステージ (ステージは start.gg の一覧。普段のログインのトークンが無ければステージは出さない)
  await loadChars();
  if (INFO && INFO.kind === 'startgg' && !STAGES) {
    const t = DEMO ? null : await SpspStartggIdentity.token().catch(() => null);
    await loadStages(t ? makeGql(t, 1000000) : null);
  }
  renderAdminSets(r.sets || []);
  if (!DEMO) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAdminSets(true); });
    adminTimer = setTimeout(refreshAdminSets, ADMIN_POLL_MS);
  }
}

/** 試合の一覧だけ読み直す (設定の入力は消さない)。直している最中は待つ */
async function refreshAdminSets(force) {
  clearTimeout(adminTimer);
  const box = $('rp-adm-sets');
  const busy = !!box && (box.contains(document.activeElement) || !!ADMIN_FORM_OPEN);
  if (box && (force === true || (document.visibilityState !== 'hidden' && !busy))) {
    const r = await api({ action: 'report_admin', token: tok(), code: CODE });
    if (r && r.ok) renderAdminSets(r.sets || []);
  }
  adminTimer = setTimeout(refreshAdminSets, ADMIN_POLL_MS);
}

/** 運営の直しの欄の試合 (formHtml / wireForm にそのまま渡す)。何先は分からないので、0〜3 と それ以外 */
function adminModel(s) {
  const slots = (s.slots || []).map((x) => (x ? { id: String(x.id), name: String(x.name || ''), uid: x.users && x.users[0] ? String(x.users[0]) : null, seed: x.seed || null } : null));
  return { id: s.set_id, kind: INFO ? INFO.kind : 'startgg', admin: true, mySide: 0, slots, phaseKey: null, roundNum: null };
}
let ADMIN_FORM_OPEN = null;   // 直しの欄を開いている試合
let LAST_ADMIN_SETS = [];
function renderAdminSets(sets, force) {
  const box = $('rp-adm-sets');
  LAST_ADMIN_SETS = sets;
  const sig = sets.map((s) => s.set_id + ':' + s.state + ':' + s.updated_ms).join('|');
  if (!force && sig === ADMIN_SIG && box.childElementCount) return;
  if (!force && ADMIN_FORM_OPEN && box.childElementCount) return;   // 直している途中は描き直さない
  ADMIN_SIG = sig;
  const order = { review: 0, conflict: 1, reported: 2, reset: 3, agreed: 4, fixed: 5 };
  sets.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || b.updated_ms - a.updated_ms);
  let h = `<h2>${escapeHtml(i18n('report.admin.sets', { n: sets.length }))}</h2>`;
  if (!sets.length) h += `<p class="rp-muted">${escapeHtml(i18n('report.admin.empty'))}</p>`;
  for (const s of sets) {
    const names = (s.slots || []).map((x) => (x ? x.name : '?'));
    const rep = (k) => { const x = s.reports && s.reports[k]; return x && x.result ? (x.result.w === 0 ? names[0] : names[1]) + ' ' + scoreText(x.result, 0) : '—'; };
    h += `<div class="rp-adm-row rp-state-${escapeHtml(s.state)}" data-set="${escapeHtml(s.set_id)}">
      <div class="rp-adm-head"><b>${escapeHtml(names.join(' vs '))}</b> <span class="rp-tag rp-state-${escapeHtml(s.state)}">${escapeHtml(STATE_LABEL(s.state))}</span>
        <span class="rp-muted">#${escapeHtml(s.set_id)} · ${escapeHtml(new Date(s.updated_ms).toLocaleTimeString())}</span></div>
      <div class="rp-muted">${escapeHtml(i18n('report.admin.applied'))}: ${escapeHtml(s.applied ? (s.applied.w === 0 ? names[0] : names[1]) + ' ' + scoreText(s.applied, 0) : '—')}
        · ${escapeHtml(names[0])}: ${escapeHtml(rep('0'))} · ${escapeHtml(names[1])}: ${escapeHtml(rep('1'))}${s.note ? ' · ' + escapeHtml(noteText(s.note)) : ''}</div>
      <div class="rp-adm-fix">
        <button type="button" class="rp-btn" data-fix-open>${escapeHtml(ADMIN_FORM_OPEN === s.set_id ? i18n('report.admin.fix_close') : i18n('report.admin.fix_open'))}</button>
        <button type="button" class="rp-btn" data-reset>${escapeHtml(i18n('report.admin.reset'))}</button>
        <span class="rp-status" data-fix-status></span>
      </div>
      ${ADMIN_FORM_OPEN === s.set_id ? formHtml(adminModel(s)) : ''}
    </div>`;
  }
  box.innerHTML = h;
  for (const row of box.querySelectorAll('.rp-adm-row')) {
    const setId = row.getAttribute('data-set');
    const st = row.querySelector('[data-fix-status]');
    row.querySelector('[data-fix-open]').addEventListener('click', () => {
      ADMIN_FORM_OPEN = ADMIN_FORM_OPEN === setId ? null : setId;
      renderAdminSets(LAST_ADMIN_SETS, true);
    });
    const form = row.querySelector('form.rp-form');
    if (form) {
      const s = sets.find((x) => x.set_id === setId);
      wireForm(form, Object.assign(adminModel(s), {
        // 選手の欄と同じ入力から直す (送る前に確かめる)
        onSubmit: async (result) => {
          const fst = form.querySelector('[data-form-status]');
          const wn = s.slots && s.slots[result.w] ? s.slots[result.w].name : '';
          if (!confirm(i18n('report.admin.fix_confirm2', { name: wn, s: scoreText(result, result.w) }))) return;
          setStatus(fst, i18n('report.sending'), 'busy');
          const x = await api({ action: 'report_admin_fix', token: tok(), code: CODE, set_id: setId, result });
          setStatus(fst, x && x.ok ? i18n('report.admin.done') : errText(x), x && x.ok ? 'ok' : 'err');
          if (x && x.ok) { ADMIN_FORM_OPEN = null; if (!DEMO) setTimeout(() => refreshAdminSets(true), 800); else setTimeout(() => renderAdminSets(LAST_ADMIN_SETS, true), 800); }
        },
      }));
    }
    row.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!confirm(i18n('report.admin.reset_confirm'))) return;
      setStatus(st, i18n('report.sending'), 'busy');
      const x = await api({ action: 'report_admin_fix', token: tok(), code: CODE, set_id: setId, reset: true });
      setStatus(st, x && x.ok ? i18n('report.admin.done') : errText(x), x && x.ok ? 'ok' : 'err');
      if (x && x.ok && !DEMO) setTimeout(() => refreshAdminSets(true), 800);
    });
  }
}

// ── 画面: 受付を始める (運営) ─────────────────────────────────────────

/**
 * 受付を始める画面。運営のログインが先 (2026-10-30、シード作成・下位クラス作成と同じ):
 *   1. start.gg で運営としてログイン (scope tournament.reporter、トークンは Worker が暗号化して受付を始めるまで預かる)
 *   2. 管理している大会 (開催中 → これから → 終わって 2 日まで) のイベントを選ぶ。一覧に無ければ URL でも指定できる
 *   3. 設定を選んで受付を始める → 運営の画面へ
 */
async function renderSetup() {
  const root = $('rp-setup');
  root.hidden = false;
  $('rp-title').textContent = i18n('report.setup.title');
  const loginView = (msg) => {
    root.innerHTML = `<section class="rp-card-sec">
      <p>${escapeHtml(i18n('report.setup.lead'))}</p>
      ${msg ? `<p class="rp-warn">${escapeHtml(msg)}</p>` : ''}
      <button type="button" class="rp-btn rp-primary" id="rp-to-login">${escapeHtml(i18n('report.setup.login_btn'))}</button>
      <p class="rp-muted">${escapeHtml(i18n('report.setup.login_help'))}</p>
      <div class="rp-status" id="rp-setup-status"></div>
    </section>`;
    $('rp-to-login').addEventListener('click', async () => {
      const st = $('rp-setup-status');
      if (DEMO) { setStatus(st, i18n('report.demo.nogo'), 'warn'); return; }
      setStatus(st, i18n('report.setup.going'), 'busy');
      if (!(await SpspReportAuth.start(location.pathname))) setStatus(st, i18n('report.err.generic'), 'err');
    });
  };
  if ((!DEMO && !sess()) || DEMO === 'setup_login') { loginView(''); return; }
  root.innerHTML = `<section class="rp-card-sec"><p class="rp-muted">${escapeHtml(i18n('report.setup.loading'))}</p></section>`;
  const r = await api({ action: 'report_tournaments', token: tok() });
  if (!r || !r.ok) {
    const code = r && r.error && r.error.code;
    if (code === 'no_grant' || code === 'auth_failed') { loginView(''); return; }   // まだ運営としてログインしていない・切れた
    loginView(errText(r));
    return;
  }
  const tours = r.tournaments || [];
  const fmt = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '');
  // スマブラ SP のイベントを先に。受付中のイベントは運営の画面へのリンク
  const evRow = (t, e) => {
    const meta = [e.entrants ? i18n('report.setup.entrants', { n: e.entrants }) : '', e.game && e.game !== ULT ? i18n('report.setup.other_game') : ''].filter(Boolean).join(' · ');
    return `<label class="rp-ev${e.code ? ' rp-ev-on' : ''}">
      <input type="radio" name="rp-ev" value="${escapeHtml(e.slug || String(e.id))}"${e.code ? ' disabled' : ''}>
      <span class="rp-ev-n">${escapeHtml(e.name)}</span>${meta ? ` <span class="rp-muted">${escapeHtml(meta)}</span>` : ''}
      ${e.code ? ` <a class="rp-link" href="${escapeHtml(pageUrl(e.code, true))}">${escapeHtml(i18n('report.setup.open_admin'))}</a>` : ''}
    </label>`;
  };
  const tourHtml = (t) => {
    const evs = (t.events || []).slice().sort((a, b) => (a.game === ULT ? 0 : 1) - (b.game === ULT ? 0 : 1));
    return `<div class="rp-tour">
      <div class="rp-tour-h">${t.live ? `<span class="rp-tag rp-live">${escapeHtml(i18n('report.setup.live'))}</span> ` : ''}<b>${escapeHtml(t.name)}</b> <span class="rp-muted">${escapeHtml(fmt(t.startAt))}</span></div>
      ${evs.length ? evs.map((e) => evRow(t, e)).join('') : `<p class="rp-muted">${escapeHtml(i18n('report.setup.no_events'))}</p>`}
    </div>`;
  };
  const who = DEMO ? i18n('report.demo.to_name') : sess() && sess().user ? sess().user.gamerTag || '' : '';
  root.innerHTML = `<section class="rp-card-sec">
    <p class="rp-muted">${escapeHtml(i18n('report.setup.logged_in', { name: who }))} <button type="button" class="rp-link" id="rp-relogin-mgr">${escapeHtml(i18n('report.setup.relogin'))}</button></p>
    <h2>${escapeHtml(i18n('report.setup.pick'))}</h2>
    ${tours.length ? `<div class="rp-tours">${tours.map(tourHtml).join('')}</div>` : `<p class="rp-muted">${escapeHtml(i18n('report.setup.no_tours'))}</p>`}
    <details class="rp-ev-url"${tours.length ? '' : ' open'}><summary>${escapeHtml(i18n('report.setup.by_url'))}</summary>
      <label class="rp-label">${escapeHtml(i18n('report.setup.event'))}<input type="url" id="rp-event" placeholder="https://www.start.gg/tournament/…/event/…"></label>
    </details>
    <h3>${escapeHtml(i18n('report.admin.settings'))}</h3>
    ${presetBarHtml(false)}
    ${settingsFormHtml({ top_cut: null, classes_only: false }, 'startgg')}
    <h3>${escapeHtml(i18n('report.ft.title'))}</h3>
    <div id="rp-ft-set" class="rp-ft-set"><p class="rp-muted">${escapeHtml(i18n('report.setup.ft_pick'))}</p></div>
    <button type="button" class="rp-btn rp-primary" id="rp-start">${escapeHtml(i18n('report.setup.start'))}</button>
    <div class="rp-status" id="rp-setup-status"></div>
  </section>`;
  let chosen = null;   // 呼び出した設定 (何先はイベントのフェーズが分かってから当てはめる)
  // 何先: イベントを選ぶとフェーズを読む。受付の開始の既定値 = start.gg のイベント (無ければ大会) の開始
  const ftBox = $('rp-ft-set');
  const startOf = new Map();
  for (const t of tours) for (const e of t.events || []) startOf.set(e.slug || String(e.id), e.startAt || t.startAt || null);
  const setOpen = (sec) => { const op = root.querySelector('[data-set-open]'); if (op) op.value = sec ? toLocalInput(sec * 1000) : ''; };
  const drawFt = (ft) => {
    ftBox.innerHTML = PHASES.length ? PHASES.map((ph) => ftPhaseHtml(ph, ft && ft[ph.key])).join('') : `<p class="rp-muted">${escapeHtml(i18n('report.ft.no_phases'))}</p>`;
    wireFt(ftBox);
  };
  const presetFt = () => (chosen ? presetToFt(chosen.settings) : { ft: null, missed: [] });
  let seq = 0;
  const pickEvent = async (ev) => {
    const my = ++seq;
    PHASES = null;
    if (startOf.has(ev)) setOpen(startOf.get(ev));
    ftBox.innerHTML = `<p class="rp-muted">${escapeHtml(i18n('report.loading'))}</p>`;
    const p = await api({ action: 'report_phases', token: tok(), event: ev });
    if (my !== seq) return;
    if (!p || !p.ok) { PHASES = null; ftBox.innerHTML = `<p class="rp-err">${escapeHtml(errText(p))}</p>`; return; }
    PHASES = p.phases || [];
    if (!startOf.has(ev)) { startOf.set(ev, p.startAt || null); setOpen(p.startAt); }
    drawFt(presetFt().ft);
  };
  for (const x of root.querySelectorAll('input[name="rp-ev"]')) {
    x.addEventListener('change', () => { if (x.checked) { $('rp-event').value = ''; pickEvent(x.value); } });
  }
  $('rp-event').addEventListener('input', () => { if ($('rp-event').value.trim()) for (const x of root.querySelectorAll('input[name="rp-ev"]')) x.checked = false; });
  $('rp-event').addEventListener('change', () => {
    const url = String($('rp-event').value || '').trim();
    if (/start\.gg\/tournament\/[^/]+\/event\/[^/?#]+/.test(url) || /^\d+$/.test(url)) pickEvent(url);
  });
  // 開催中のスマブラのイベントが 1 つだけなら選んでおく
  const live = tours.filter((t) => t.live).flatMap((t) => (t.events || []).filter((e) => e.game === ULT && !e.code));
  if (live.length === 1) { const v = live[0].slug || String(live[0].id); const x = Array.from(root.querySelectorAll('input[name="rp-ev"]')).find((i) => i.value === v); if (x) { x.checked = true; pickEvent(v); } }
  $('rp-relogin-mgr').addEventListener('click', () => { if (!DEMO) SpspReportAuth.start(location.pathname); });
  wirePresets((p, name) => {
    applySettingsInputs(root, p);
    chosen = { name, settings: p };
    if (PHASES && PHASES.length) {
      const { ft, missed } = presetFt();
      drawFt(ft);
      setStatus($('rp-preset-status'), i18n('report.preset.loaded_setup2', { name }) + (missed.length ? ' ' + i18n('report.preset.missed', { names: missed.join(', ') }) : ''), 'ok');
    } else setStatus($('rp-preset-status'), i18n('report.preset.loaded_setup', { name }), 'ok');
  }, () => null);
  $('rp-start').addEventListener('click', async () => {
    const st = $('rp-setup-status');
    const picked = root.querySelector('input[name="rp-ev"]:checked');
    const url = String($('rp-event').value || '').trim();
    const ev = url || (picked ? picked.value : '');
    if (!ev) { setStatus(st, i18n('report.setup.need_pick'), 'err'); return; }
    if (url && !/start\.gg\/tournament\/[^/]+\/event\/[^/?#]+/.test(url) && !/^\d+$/.test(url)) { setStatus(st, i18n('report.setup.bad_event'), 'err'); return; }
    if (DEMO) { setStatus(st, i18n('report.demo.nogo'), 'warn'); return; }
    setStatus(st, i18n('report.setup.starting'), 'busy');
    const ftNow = PHASES && PHASES.length ? readFt(ftBox) : null;
    const x = await api({ action: 'report_enable', token: tok(), event: ev, settings: { ...readSettings(root), ...(ftNow ? { ft: ftNow } : {}) } });
    if (!x || !x.ok) {
      if (x && x.error && x.error.code === 'no_grant') { loginView(i18n('report.setup.login_expired')); return; }
      setStatus(st, errText(x), 'err');
      return;
    }
    try { if (chosen && !(PHASES && PHASES.length)) sessionStorage.setItem(PRESET_PENDING, JSON.stringify(chosen)); else sessionStorage.removeItem(PRESET_PENDING); } catch (e) { /* 何先は後で入れ直す */ }
    location.href = pageUrl(x.report.code, true);
  });
}

// ── 見本の画面 ─────────────────────────────────────────────────────

let DEMO_ME = '';
const DEMO_SCENES = ['match', 'newcomer', 'conflict', 'waiting', 'done', 'gate', 'challonge', 'login', 'not_entrant', 'admin', 'setup_login', 'setup'];

/** 見本の選手: 公開の選手一覧から (ログイン中なら自分を「自分」に) */
async function demoPlayers() {
  let rows = [];
  try {
    const j = await (await fetch((SPSP.data || '') + 'data/views/players_index.json')).json();
    const cols = j.cols || j.columns || [];
    const ci = (k) => cols.indexOf(k);
    rows = (j.rows || []).slice(40, 60).map((r) => ({ uid: String(r[ci('uid')]), name: String(r[ci('name')] || ''), char: Number(r[ci('char')]) || null }));
  } catch (e) { rows = []; }
  while (rows.length < 12) rows.push({ uid: '', name: 'Player ' + (rows.length + 1), char: null });
  const s = sess();
  if (s && s.user) rows[0] = { uid: String(s.user.id), name: s.user.gamerTag || rows[0].name, char: null };
  W.__rpMain = {};
  for (const r of rows) if (r.uid) W.__rpMain[r.uid] = r.char;
  return rows;
}

function demoBanner() {
  const links = DEMO_SCENES.map((k) => '<a href="?demo=' + k + '"' + (k === DEMO ? ' class="on"' : '') + '>' + escapeHtml(i18n('report.demo.' + k)) + '</a>').join('');
  const el = document.createElement('div');
  el.className = 'rp-demo';
  el.innerHTML = '<b>' + escapeHtml(i18n('report.demo.banner')) + '</b><div class="rp-demo-links">' + links + '</div>';
  const main = document.querySelector('.rp-main');
  main.insertBefore(el, main.firstChild);
}

function demoSlot(p, seed, side) {
  return p ? { id: 'e' + side + '_' + p.uid, name: p.name, uid: p.uid || null, seed } : null;
}

function demoMatch(P, o) {
  return Object.assign({ id: '90001', kind: 'startgg', state: 'open', started: true, round: 'Winners Round 2', pool: 'B3', phase: 'Pools',
    station: 12, stream: null, slots: [demoSlot(P[0], 5, 0), demoSlot(P[1], 28, 1)], mySide: 0, winner: null, score: null, games: [],
    totalGames: 3, lPlacement: 33, isClass: false, prereq: [null, null], roundNum: 2, phaseKey: 'p1', groupId: '901' }, o || {});
}

function demoRow(id, state, mine, theirs, P) {
  const reports = {};
  if (mine) reports['0'] = { result: mine, ts: 1, mine: true };
  if (theirs) reports['1'] = { result: theirs, ts: 2, mine: false };
  return { code: 'demo', set_id: id, state, note: state === 'review' ? 'locked_conflict' : '', applied: mine || null,
    slots: [{ id: 'a', name: P[0].name, users: P[0].uid ? [P[0].uid] : [] }, { id: 'b', name: P[1].name, users: P[1].uid ? [P[1].uid] : [] }], reports, updated_ms: Date.now() - 60000 };
}

const R20 = { w: 0, g: [{ w: 0, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }] };
const R21 = { w: 0, g: [{ w: 0, c: [null, null], s: null }, { w: 1, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }] };
const L12 = { w: 1, g: [{ w: 1, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }, { w: 1, c: [null, null], s: null }] };

let DEMO_P = [];
/** 見本の何先: 予選 (p1) は 2 先・本戦 (p2) は勝者側 3 回戦・敗者側 4 回戦から 3 先・Challonge は全部 1 先 */
const DEMO_FT = { p1: { w: { a: 2, from: null, b: 2 }, l: { a: 2, from: null, b: 2 } }, p2: { w: { a: 2, from: 3, b: 3 }, l: { a: 2, from: 4, b: 3 } },
  c: { w: { a: 1, from: null, b: 1 }, l: { a: 1, from: null, b: 1 } } };
let DEMO_PRESETS = [
  { name: 'いつもの (予選 2 先・Top 8 から 3 先)', settings: { top_cut: null, classes_only: false, phases: [
    { name: 'Pools', i: 0, w: { a: 2, from: null, b: 2, fl: null }, l: { a: 2, from: null, b: 2, fl: null } },
    { name: 'Top 32', i: 1, w: { a: 2, from: 4, b: 3, fl: 'Winners Final' }, l: { a: 2, from: 4, b: 3, fl: 'Losers Quarter-Final' } }] } },
  { name: '全部 1 先', settings: { top_cut: null, classes_only: false, phases: [
    { name: 'Pools', i: 0, w: { a: 1, from: null, b: 1, fl: null }, l: { a: 1, from: null, b: 1, fl: null } },
    { name: 'Top 32', i: 1, w: { a: 1, from: null, b: 1, fl: null }, l: { a: 1, from: null, b: 1, fl: null } }] } },
];
const DEMO_PHASES = [
  { key: 'p1', name: 'Pools', rounds: [1, 2, 3, -1, -2, -3].map((n) => ({ n, label: null, bestOf: 3 })) },
  { key: 'p2', name: 'Top 32', rounds: [{ n: 1, label: 'Winners Round 1' }, { n: 2, label: 'Winners Quarter-Final' }, { n: 3, label: 'Winners Semi-Final' }, { n: 4, label: 'Winners Final', bestOf: 5 },
    { n: 5, label: 'Grand Final', bestOf: 5 }, { n: -1, label: 'Losers Round 1' }, { n: -2, label: 'Losers Round 2' }, { n: -3, label: 'Losers Round 3' }, { n: -4, label: 'Losers Quarter-Final' },
    { n: -5, label: 'Losers Semi-Final' }, { n: -6, label: 'Losers Final' }] },
];
async function demoApi(body) {
  const P = DEMO_P;
  if (body.action === 'report_submit') {
    const state = DEMO === 'conflict' ? 'agreed' : 'reported';
    const row = demoRow(body.set_id, state, body.result, DEMO === 'conflict' ? body.result : null, P);
    VIEW.sets = (VIEW.sets || []).filter((x) => x.set_id !== body.set_id).concat([row]);
    return { ok: true, set_id: body.set_id, state, op: 'report' };
  }
  if (body.action === 'report_admin') {
    const row = (id, st, a, b, i) => Object.assign(demoRow(id, st, a, b, P), { slots: [P[i], P[i + 1]].map((p, k) => ({ id: 'e' + k + '_' + i, name: p.name, users: p.uid ? [p.uid] : [] })) });
    return { ok: true, report: { code: 'demo', kind: 'startgg', expires_ms: Date.now() + 86400e3, settings: { top_cut: null, classes_only: false, ft: DEMO_FT } },
      sets: [row('101', 'review', R20, L12, 0), row('102', 'conflict', R21, L12, 2), row('103', 'reported', R21, null, 4), row('104', 'agreed', R20, R20, 6), row('105', 'fixed', R21, null, 8)] };
  }
  if (body.action === 'report_tournaments') {
    // 見本: 開催中 1 つ (イベント 2 つ、片方は受付中) とこれから 1 つ
    const now = Math.floor(Date.now() / 1000);
    return { ok: true, tournaments: [
      { id: 1, name: i18n('report.demo.tour1'), slug: 'tournament/demo', startAt: now - 3 * 3600, endAt: now + 5 * 3600, live: true, events: [
        { id: 11, name: 'Singles', slug: 'tournament/demo/event/singles', entrants: 128, game: ULT, code: null },
        { id: 12, name: 'Crew Battle', slug: 'tournament/demo/event/crew', entrants: 16, game: ULT, code: 'demo' }] },
      { id: 2, name: i18n('report.demo.tour2'), slug: 'tournament/demo2', startAt: now + 6 * 86400, endAt: now + 6 * 86400, live: false, events: [
        { id: 21, name: 'Singles', slug: 'tournament/demo2/event/singles', entrants: 48, game: ULT, code: null }] }] };
  }
  if (body.action === 'report_settings') return { ok: true, settings: body.settings };
  if (body.action === 'report_phases') return { ok: true, phases: DEMO_PHASES };
  // 保存した設定 (見本はこの画面の中だけ)
  if (body.action === 'report_presets') return { ok: true, presets: DEMO_PRESETS };
  if (body.action === 'report_preset_save') { DEMO_PRESETS = [{ name: body.name, settings: body.settings }, ...DEMO_PRESETS.filter((p) => p.name !== body.name)]; return { ok: true, presets: DEMO_PRESETS }; }
  if (body.action === 'report_preset_delete') { DEMO_PRESETS = DEMO_PRESETS.filter((p) => p.name !== body.name); return { ok: true, presets: DEMO_PRESETS }; }
  return { ok: true, state: 'fixed', op: 'report' };
}

async function runDemo() {
  demoBanner();
  if (DEMO === 'list' || !DEMO_SCENES.includes(DEMO)) { $('rp-title').textContent = i18n('report.demo.title'); return; }
  if (DEMO === 'setup' || DEMO === 'setup_login') { renderSetup(); return; }
  DEMO_P = await demoPlayers();
  const P = DEMO_P;
  DEMO_ME = P[0].uid;
  INFO = { code: 'demo', kind: DEMO === 'challonge' ? 'challonge' : 'startgg', name: i18n(DEMO === 'challonge' ? 'report.demo.class_name' : 'report.demo.event_name'),
    slug: DEMO === 'challonge' ? 'https://challonge.com/spsp_demo_b' : 'tournament/spsp-demo/event/singles',
    event_id: 0, active: true, expires_ms: Date.now() + 86400e3, settings: { top_cut: DEMO === 'gate' ? 8 : null, classes_only: false, ft: DEMO_FT } };
  $('rp-title').textContent = INFO.name;
  if (DEMO === 'challonge') $('rp-sub').textContent = i18n('report.kind.challonge');
  VIEW = { ok: true, admin: true, sets: [] };
  if (DEMO === 'admin') { await renderAdmin(); return; }
  if (DEMO === 'login') { $('rp-login').hidden = false; return; }   // ログインしていない人が報告ページを開いた
  if (DEMO === 'not_entrant') { ENTRANT = false; MATCHES = []; renderPlayer(); return; }   // ログインしたが出場者に居ない
  await loadChars();
  STAGES = ['戦場', '終点', '小戦場', 'ポケモンスタジアム2', 'すま村', 'ホロウバスティオン', 'カロスポケモンリーグ'].map((name, i) => ({ id: 9001 + i, name }));
  const done0 = demoMatch(P, { id: '90000', state: 'complete', round: 'Winners Round 1', slots: [demoSlot(P[0], 5, 0), demoSlot(P[5], 60, 1)], winner: 0, score: [2, 0] });
  PRED = { p: { bt: { ifWin: { 90001: 14.2 }, perSet: { 90000: 6.8 } }, tjpr: { delta: 41.5 } } };
  if (DEMO === 'match') { MATCHES = [demoMatch(P, { stream: { name: 'spsp_tv', source: 'TWITCH' } }), done0]; VIEW.sets = [demoRow('90000', 'agreed', R20, R20, P)]; }
  if (DEMO === 'newcomer') {   // 相手が初参加 (SPSP にデータが無い)
    MATCHES = [demoMatch(P, { slots: [demoSlot(P[0], 5, 0), { id: 'e1_new', name: i18n('report.demo.newcomer_name'), uid: '999999999', seed: 40 }] }), done0];
    VIEW.sets = [demoRow('90000', 'agreed', R20, R20, P)];
  }
  if (DEMO === 'conflict') { MATCHES = [demoMatch(P), done0]; VIEW.sets = [demoRow('90001', 'conflict', R21, L12, P)]; }
  if (DEMO === 'gate') MATCHES = [demoMatch(P, { lPlacement: 7, round: 'Winners Semi-Final', phase: 'Top 32', pool: '', phaseKey: 'p2', roundNum: 3 })];
  if (DEMO === 'challonge') { MATCHES = [demoMatch(P, { kind: 'challonge', station: null, phase: '', pool: 'A', round: i18n('report.round', { n: 1 }), totalGames: null, isClass: true, phaseKey: 'c', roundNum: 1 })]; PRED = { none: true }; }
  if (DEMO === 'waiting') {
    const pre = { id: 'p1', state: 'playing', round: 'Winners Round 2', station: 7, loser: false, slots: [demoSlot(P[2], 12, 0), demoSlot(P[3], 21, 1)], deeper: [null, null] };
    MATCHES = [demoMatch(P, { id: '90002', state: 'waiting', round: 'Winners Quarter-Final', station: null, slots: [demoSlot(P[0], 5, 0), null], prereq: [null, pre] }), done0];
    VIEW.sets = [demoRow('90000', 'agreed', R20, R20, P)];
  }
  if (DEMO === 'done') {
    MATCHES = [done0,
      demoMatch(P, { id: '90003', state: 'complete', round: 'Winners Round 2', slots: [demoSlot(P[0], 5, 0), demoSlot(P[6], 12, 1)], winner: 1, score: [1, 2] }),
      demoMatch(P, { id: '90004', state: 'complete', round: 'Losers Round 3', slots: [demoSlot(P[0], 5, 0), demoSlot(P[7], 20, 1)], winner: 0, score: [2, 1] })];
    VIEW.sets = [demoRow('90000', 'agreed', R20, R20, P), demoRow('90003', 'review', null, L12, P), demoRow('90004', 'reported', R21, null, P)];
  }
  const cur = MATCHES.find((m) => m.state === 'open');
  renderPlayer();
  if (cur) matchAnimation(cur).then(() => scrollToMatch(cur));
}

// ── はじめ ─────────────────────────────────────────────────────────

async function main() {
  if (DEMO) { await runDemo(); return; }
  if (!CODE) { renderSetup(); return; }
  const info = await api({ action: 'report_info', code: CODE });
  if (!info || !info.ok) { setStatus($('rp-status'), errText(info), 'err'); return; }
  INFO = info.report;
  $('rp-title').textContent = INFO.name || i18n('report.title');
  const tags = [];
  if (INFO.kind === 'challonge') tags.push(i18n('report.kind.challonge'));
  $('rp-sub').textContent = tags.join(' · ');
  if (!INFO.active) { setStatus($('rp-status'), i18n('report.closed'), 'warn'); return; }
  if (!sess()) {
    $('rp-login').hidden = false;
    return;
  }
  await SpspLogin.verify();
  if (!sess()) { $('rp-login').hidden = false; return; }
  if (WANT_ADMIN) { $('rp-to-player').hidden = false; await renderAdmin(); return; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(true); });
  poll(true);
}

$('rp-login-btn').addEventListener('click', () => { if (!DEMO) SpspLogin.startLogin(location.pathname + location.search); });
$('rp-relogin-btn').addEventListener('click', () => SpspLogin.startLogin(location.pathname + location.search));
$('rp-to-admin').addEventListener('click', () => { location.href = pageUrl(CODE, true); });
$('rp-to-player').addEventListener('click', () => { location.href = pageUrl(CODE, false); });
main().catch((e) => setStatus($('rp-status'), String((e && e.message) || e), 'err'));
