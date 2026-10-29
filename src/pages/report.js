// 試合結果の報告 (site/report/index.html、docs/self_report_design.md)。
//   ?c=<受付>          選手の画面: 自分の試合 (台・相手のカード・シード)・結果の報告・試合待ちの次の相手の候補
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
import { charName, HIDDEN_CHAR_IDS } from '../../site/js/chars.js';
import SPSPViews from '../../site/js/views.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import SPSPPlayerCard from '../../site/js/player_card.js';
import { buildCardModel, fetchAppliedCard, loadCardData } from '../../site/js/player_card_model.js';
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

async function loadChars() {
  if (CHARS) return CHARS;
  const tbl = await SPSPCharEmoji.load().catch(() => null);
  CHARS = Object.keys(tbl || {}).map(Number).filter((id) => id > 0 && !HIDDEN_CHAR_IDS.has(id))
    .map((id) => ({ id, name: charName(id, (tbl[id] && tbl[id].name) || String(id)), emoji: SPSPCharEmoji.emojiOf(id) || '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return CHARS;
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
  phaseGroup { displayIdentifier phase { name } }
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
    const d = await gqlData(gql, 'query SpspReportMe { currentUser { id player { id } } }', {});
    ME_PID = d.currentUser && d.currentUser.player ? String(d.currentUser.player.id) : null;
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
  // 試合待ち: 相手の枠の前の試合 (2 段まで) を読んで候補にする
  for (const m of out) {
    if (m.state !== 'waiting') continue;
    m.prereq = await Promise.all(m.rawSlots.map((s, i) => (m.slots[i] ? null : prereqOf(gql, s, 2))));
  }
  return out;
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
    round: s.fullRoundText || '', pool: s.phaseGroup ? s.phaseGroup.displayIdentifier : '', phase,
    station: s.station && s.station.number ? s.station.number : null,
    stream: s.stream && s.stream.streamName ? { name: s.stream.streamName, source: s.stream.streamSource } : null,
    slots, mySide, winner, score: complete && sc[0] !== null && sc[1] !== null ? sc : null, games,
    totalGames: s.totalGames || null, lPlacement: s.lPlacement || null, isClass: LOWER_CLASS_NAME_PAT.test(phase || '') || LOWER_CLASS_NAME_PAT.test(INFO.name || ''),
    rawSlots, prereq: [null, null],
  };
}

/** 枠の前の試合 (候補)。depth 段までさかのぼる */
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
    h += `<div class="rp-pred-row"><span>${escapeHtml(i18n('report.pred.win'))}</span><b class="rp-up">${fmtDelta(bt.ifWin && bt.ifWin[m.id])}</b>`
      + `<span>${escapeHtml(i18n('report.pred.lose'))}</span><b class="rp-down">${fmtDelta(bt.ifLose && bt.ifLose[m.id])}</b></div>`;
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
  if (s.classes_only && !m.isClass) return i18n('report.gate.classes_only');
  if (s.top_cut && m.lPlacement && m.lPlacement <= s.top_cut) return i18n('report.gate.top_cut', { n: s.top_cut });
  return '';
}

function rowOf(setId) { return VIEW && VIEW.sets ? VIEW.sets.find((x) => x.set_id === setId) : null; }

/** 台・配信台 */
function stationHtml(m) {
  const parts = [];
  if (m.station) parts.push(`<span class="rp-station">🎮 ${escapeHtml(i18n('report.station', { n: m.station }))}</span>`);
  if (m.stream) parts.push(`<span class="rp-stream">📺 ${escapeHtml(i18n('report.stream'))}${m.stream.name ? ' · ' + escapeHtml(m.stream.name) : ''}</span>`);
  return parts.length ? `<div class="rp-stations">${parts.join('')}</div>` : '';
}

function seedHtml(slot) {
  return slot && slot.seed ? `<span class="rp-seed">${escapeHtml(i18n('report.seed', { n: slot.seed }))}</span>` : '';
}

function vsHtml(m) {
  const me = m.slots[m.mySide]; const op = m.slots[1 - m.mySide];
  return `<div class="rp-vs"><div class="rp-side rp-me"><div class="rp-name">${escapeHtml(me ? me.name : '')}</div>${seedHtml(me)}</div>`
    + `<div class="rp-vs-mark">VS</div>`
    + `<div class="rp-side rp-op"><div class="rp-name">${escapeHtml(op ? op.name : i18n('report.tbd'))}</div>${seedHtml(op)}</div></div>`;
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

function candidatesHtml(m) {
  const list = [];
  const walk = (p) => {
    if (!p) return;
    p.slots.forEach((s, i) => { if (s) list.push({ s, p }); else walk(p.deeper && p.deeper[i]); });
  };
  m.prereq.forEach(walk);
  if (!list.length) return `<p class="rp-muted">${escapeHtml(i18n('report.cand.none'))}</p>`;
  const stateText = (p) => (p.state === 'playing' ? i18n('report.cand.playing') : p.state === 'complete' ? i18n('report.cand.done') : i18n('report.cand.pending'));
  return `<div class="rp-cands">` + list.slice(0, 6).map(({ s, p }) => `<div class="rp-cand">
      <div class="rp-cand-head"><b>${escapeHtml(s.name)}</b> ${seedHtml(s)}</div>
      <div class="rp-muted">${escapeHtml((p.loser ? i18n('report.cand.loser') : i18n('report.cand.winner')) + ' · ' + (p.round ? p.round + ' · ' : '') + stateText(p))}${p.station ? ' · ' + escapeHtml(i18n('report.station', { n: p.station })) : ''}</div>
      ${s.uid ? `<div class="rp-card rp-card-sm" data-card-uid="${escapeHtml(s.uid)}"></div>` : ''}
    </div>`).join('') + `</div>`;
}

const CARD_DONE = new Map();   // uid → Promise (同じカードを何度も読まない)
function fillCards(root) {
  for (const el of root.querySelectorAll('[data-card-uid]')) {
    const uid = el.getAttribute('data-card-uid');
    if (!CARD_DONE.has(uid)) {
      CARD_DONE.set(uid, (async () => {
        const data = await loadCardData(uid).catch(() => null);
        if (!data) return null;
        const x = await fetchAppliedCard(uid).catch(() => null);
        return buildCardModel(data, x ? x.settings : null, x ? x.titleText : null);
      })());
    }
    CARD_DONE.get(uid).then((model) => {
      if (!el.isConnected) return;
      if (!model) { el.innerHTML = `<p class="rp-muted">${escapeHtml(i18n('report.card.none'))}</p>`; return; }
      try { SPSPPlayerCard.render(el, model); } catch (e) { el.textContent = ''; }
    });
  }
}

/** 結果の入力欄 */
function formHtml(m) {
  const n = m.totalGames || 3;
  const need = Math.floor(n / 2) + 1;
  const chars = CHARS || [];
  const stages = STAGES || [];
  const opt = (list, sel) => `<option value="">—</option>` + list.map((x) => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${escapeHtml((x.emoji ? x.emoji + ' ' : '') + x.name)}</option>`).join('');
  const withChars = m.kind === 'startgg';
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="rp-game" data-game="${i}"${i >= need ? ' data-extra="1"' : ''}>
      <div class="rp-game-no">${escapeHtml(i18n('report.game', { n: i + 1 }))}</div>
      <div class="rp-game-win">
        <button type="button" class="rp-pick" data-pick="${m.mySide}">${escapeHtml(i18n('report.i_won'))}</button>
        <button type="button" class="rp-pick" data-pick="${1 - m.mySide}">${escapeHtml(i18n('report.opp_won'))}</button>
      </div>
      ${withChars ? `<div class="rp-game-sel">
        <label>${escapeHtml(i18n('report.my_char'))}<select data-char="${m.mySide}">${opt(chars, null)}</select></label>
        <label>${escapeHtml(i18n('report.opp_char'))}<select data-char="${1 - m.mySide}">${opt(chars, null)}</select></label>
        ${stages.length ? `<label>${escapeHtml(i18n('report.stage'))}<select data-stage>${opt(stages, null)}</select></label>` : ''}
      </div>` : ''}
    </div>`;
  }
  return `<form class="rp-form" data-set="${escapeHtml(m.id)}">
    <h3>${escapeHtml(i18n('report.form.title'))}</h3>
    <p class="rp-muted">${escapeHtml(withChars ? i18n('report.form.help') : i18n('report.form.help_ch'))}</p>
    ${rows}
    <div class="rp-form-foot"><span class="rp-sum"></span><button type="submit" class="rp-btn rp-primary">${escapeHtml(i18n('report.send'))}</button></div>
    <div class="rp-status" data-form-status></div>
  </form>`;
}

/** 入力欄の動き: ゲームの勝者を押すと、決着までのゲームだけ出す。キャラは前のゲームを引き継ぐ */
function wireForm(form, m) {
  const n = m.totalGames || 3;
  const need = Math.floor(n / 2) + 1;
  const games = Array.from(form.querySelectorAll('.rp-game'));
  const picked = new Array(n).fill(null);
  const mainOf = (slot) => (slot && slot.uid && W.__rpMain ? W.__rpMain[slot.uid] : null);
  // 自分・相手のキャラの初期値 = メインキャラ (選手一覧の char)
  for (const k of [0, 1]) {
    const c = mainOf(m.slots[k]);
    if (c) for (const sel of form.querySelectorAll(`select[data-char="${k}"]`)) sel.value = String(c);
  }
  const refresh = () => {
    let a = 0; let b = 0; let last = -1;
    for (let i = 0; i < n; i++) {
      if (a >= need || b >= need) { games[i].hidden = true; continue; }
      games[i].hidden = i > 0 && picked[i - 1] === null;
      if (picked[i] === null) continue;
      if (picked[i] === 0) a++; else b++;
      last = i;
    }
    for (let i = 0; i < n; i++) for (const btn of games[i].querySelectorAll('.rp-pick')) btn.classList.toggle('on', picked[i] !== null && Number(btn.getAttribute('data-pick')) === picked[i]);
    const done = a >= need || b >= need;
    const mine = m.mySide === 0 ? a : b; const opp = m.mySide === 0 ? b : a;
    const sumKind = done ? (mine > opp ? 'win' : 'lose') : 'partial';
    form.querySelector('.rp-sum').textContent = last < 0 ? '' : i18n('report.sum_' + sumKind, { a: mine, b: opp });
    form.querySelector('button[type=submit]').disabled = !done;
  };
  games.forEach((g, i) => {
    for (const btn of g.querySelectorAll('.rp-pick')) {
      btn.addEventListener('click', () => {
        picked[i] = Number(btn.getAttribute('data-pick'));
        for (let j = i + 1; j < n; j++) if (games[j].hidden) picked[j] = null;
        // 次のゲームのキャラは前のゲームを引き継ぐ
        if (i + 1 < n) for (const sel of g.querySelectorAll('select[data-char]')) {
          const nx = games[i + 1].querySelector(`select[data-char="${sel.getAttribute('data-char')}"]`);
          if (nx && sel.value) nx.value = sel.value;
        }
        refresh();
      });
    }
  });
  refresh();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const g = [];
    for (let i = 0; i < n; i++) {
      if (picked[i] === null || games[i].hidden) break;
      const v = (sel) => (sel && sel.value ? Number(sel.value) : null);
      g.push({ w: picked[i], c: [v(games[i].querySelector('select[data-char="0"]')), v(games[i].querySelector('select[data-char="1"]'))], s: v(games[i].querySelector('select[data-stage]')) });
    }
    const a = g.filter((x) => x.w === 0).length; const b = g.filter((x) => x.w === 1).length;
    const result = { w: a > b ? 0 : 1, g };
    const op = m.slots[1 - m.mySide];
    const won = result.w === m.mySide;
    if (!confirm(i18n('report.confirm', { opp: op ? op.name : '', s: scoreText(result, m.mySide), r: won ? i18n('report.win') : i18n('report.lose') }))) return;
    const st = form.querySelector('[data-form-status]');
    setStatus(st, i18n('report.sending'), 'busy');
    form.querySelector('button[type=submit]').disabled = true;
    const r = await api({ action: 'report_submit', token: tok(), code: CODE, set_id: m.id, result });
    if (!r || !r.ok) { setStatus(st, errText(r), 'err'); form.querySelector('button[type=submit]').disabled = false; return; }
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
function matchAnimation(m) {
  if (!DEMO && seen(m.id)) return Promise.resolve();
  if (!DEMO) markSeen(m.id);
  const me = m.slots[m.mySide]; const op = m.slots[1 - m.mySide];
  const ov = document.createElement('div');
  ov.className = 'rp-match-ov';
  ov.innerHTML = `<div class="rp-match-title">${escapeHtml(i18n('report.matched'))}</div>
    <div class="rp-match-names"><span class="rp-match-l">${escapeHtml(me ? me.name : '')}</span><span class="rp-match-vs">VS</span><span class="rp-match-r">${escapeHtml(op ? op.name : '')}</span></div>
    ${m.station || m.stream ? `<div class="rp-match-station">${m.station ? escapeHtml(i18n('report.station', { n: m.station })) : ''}${m.stream ? ' 📺 ' + escapeHtml(i18n('report.stream')) : ''}</div>` : ''}`;
  document.body.appendChild(ov);
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch (e) { /* 震えないだけ */ }
  return new Promise((res) => {
    const done = () => { ov.classList.add('out'); setTimeout(() => { ov.remove(); res(); }, 350); };
    ov.addEventListener('click', done, { once: true });
    setTimeout(done, 2200);
  });
}

function renderPlayer() {
  const root = $('rp-player');
  root.hidden = false;
  const cur = MATCHES.find((m) => m.state === 'open');
  const waiting = MATCHES.find((m) => m.state === 'waiting');
  const done = MATCHES.filter((m) => m.state === 'complete');
  const notices = (VIEW && VIEW.sets ? VIEW.sets : []).filter((r) => r.state === 'conflict');
  let h = '';
  if (notices.length) h += `<div class="rp-banner rp-warn">⚠ ${escapeHtml(i18n('report.banner_conflict', { n: notices.length }))}</div>`;
  if (cur) {
    const gate = gateOf(cur);
    const op = cur.slots[1 - cur.mySide];
    h += `<section class="rp-card-sec rp-current">
      <div class="rp-round">${escapeHtml([cur.phase, cur.pool, cur.round].filter(Boolean).join(' · '))}</div>
      ${stationHtml(cur)}
      ${vsHtml(cur)}
      ${op && op.uid ? `<div class="rp-card" data-card-uid="${escapeHtml(op.uid)}"></div>` : ''}
      <details class="rp-more" data-pred="${escapeHtml(cur.id)}"><summary>${escapeHtml(i18n('report.more'))}</summary><div class="rp-pred">${escapeHtml(i18n('report.loading'))}</div></details>
      ${reportStateHtml(cur)}
      ${gate ? `<p class="rp-gate">${escapeHtml(gate)}</p>` : (FORM_OPEN === cur.id || !rowOf(cur.id) ? formHtml(cur) : `<button type="button" class="rp-btn" data-reopen="${escapeHtml(cur.id)}">${escapeHtml(i18n('report.resend'))}</button>`)}
    </section>`;
  } else if (waiting) {
    h += `<section class="rp-card-sec">
      <h2>${escapeHtml(i18n('report.waiting'))}</h2>
      <div class="rp-round">${escapeHtml([waiting.phase, waiting.pool, waiting.round].filter(Boolean).join(' · '))}</div>
      ${stationHtml(waiting)}
      <h3>${escapeHtml(i18n('report.cand.title'))}</h3>
      ${candidatesHtml(waiting)}
    </section>`;
  } else {
    h += `<section class="rp-card-sec"><p>${escapeHtml(MATCHES.length ? i18n('report.no_current') : i18n('report.no_sets'))}</p></section>`;
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
      if (INFO.kind === 'challonge') MATCHES = fromChallonge(v.challonge);
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
      if (cur) await matchAnimation(cur);
      if (!document.querySelector('.rp-form:focus-within') || force) renderPlayer();
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

function settingsFormHtml(s, kind) {
  const tc = s && s.top_cut ? s.top_cut : '';
  return `<div class="rp-settings">
    <label>${escapeHtml(i18n('report.set.top_cut'))}
      <select data-set-top><option value="">${escapeHtml(i18n('report.set.top_none'))}</option>${TOP_CUTS.map((n) => `<option value="${n}"${n === tc ? ' selected' : ''}>${escapeHtml(i18n('report.set.top_n', { n }))}</option>`).join('')}</select></label>
    ${kind === 'challonge' ? '' : `<label class="rp-check"><input type="checkbox" data-set-cls${s && s.classes_only ? ' checked' : ''}> ${escapeHtml(i18n('report.set.classes_only'))}</label>`}
  </div>`;
}
function readSettings(root) {
  const top = root.querySelector('[data-set-top]'); const cls = root.querySelector('[data-set-cls]');
  return { top_cut: top && top.value ? Number(top.value) : null, classes_only: !!(cls && cls.checked) };
}

async function renderAdmin() {
  const root = $('rp-admin');
  root.hidden = false;
  const r = await api({ action: 'report_admin', token: tok(), code: CODE });
  if (!r || !r.ok) { root.innerHTML = `<p class="rp-err">${escapeHtml(errText(r))}</p>`; return; }
  const ev = r.report;
  const url = pageUrl(CODE, false);
  let h = `<section class="rp-card-sec">
    <h2>${escapeHtml(i18n('report.admin.share'))}</h2>
    <div class="rp-share"><input type="text" readonly value="${escapeHtml(url)}" id="rp-share-url"><button type="button" class="rp-btn" id="rp-copy">${escapeHtml(i18n('report.admin.copy'))}</button></div>
    <p class="rp-muted">${escapeHtml(i18n('report.admin.expires', { t: new Date(ev.expires_ms).toLocaleString() }))}</p>
    <h3>${escapeHtml(i18n('report.admin.settings'))}</h3>
    ${settingsFormHtml(ev.settings, ev.kind)}
    <button type="button" class="rp-btn" id="rp-save-set">${escapeHtml(i18n('report.admin.save'))}</button> <span class="rp-status" id="rp-set-status"></span>
  </section>`;
  const sets = r.sets || [];
  const order = { review: 0, conflict: 1, reported: 2, reset: 3, agreed: 4, fixed: 5 };
  sets.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || b.updated_ms - a.updated_ms);
  h += `<section class="rp-card-sec"><h2>${escapeHtml(i18n('report.admin.sets', { n: sets.length }))}</h2>`;
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
        <select data-fix-w><option value="0">${escapeHtml(i18n('report.admin.winner', { name: names[0] }))}</option><option value="1">${escapeHtml(i18n('report.admin.winner', { name: names[1] }))}</option></select>
        <select data-fix-s>${['2-0', '2-1', '3-0', '3-1', '3-2', '1-0'].map((x) => `<option>${x}</option>`).join('')}</select>
        <button type="button" class="rp-btn" data-fix>${escapeHtml(i18n('report.admin.fix'))}</button>
        <button type="button" class="rp-btn" data-reset>${escapeHtml(i18n('report.admin.reset'))}</button>
        <span class="rp-status" data-fix-status></span>
      </div>
    </div>`;
  }
  h += `</section><section class="rp-card-sec"><button type="button" class="rp-btn rp-danger" id="rp-stop">${escapeHtml(i18n('report.admin.stop'))}</button></section>`;
  root.innerHTML = h;
  $('rp-copy').addEventListener('click', () => { const i = $('rp-share-url'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } });
  $('rp-save-set').addEventListener('click', async () => {
    const x = await api({ action: 'report_settings', token: tok(), code: CODE, settings: readSettings(root) });
    setStatus($('rp-set-status'), x && x.ok ? i18n('report.admin.saved') : errText(x), x && x.ok ? 'ok' : 'err');
    if (x && x.ok && INFO) INFO.settings = x.settings;
  });
  $('rp-stop').addEventListener('click', async () => {
    if (!confirm(i18n('report.admin.stop_confirm'))) return;
    const x = await api({ action: 'report_stop', token: tok(), code: CODE });
    if (x && x.ok) location.reload(); else alert(errText(x));
  });
  for (const row of root.querySelectorAll('.rp-adm-row')) {
    const setId = row.getAttribute('data-set');
    const st = row.querySelector('[data-fix-status]');
    row.querySelector('[data-fix]').addEventListener('click', async () => {
      const w = Number(row.querySelector('[data-fix-w]').value);
      const [a, b] = row.querySelector('[data-fix-s]').value.split('-').map(Number);
      const g = [];
      for (let i = 0; i < b; i++) g.push({ w: 1 - w, c: [null, null], s: null });
      for (let i = 0; i < a; i++) g.push({ w, c: [null, null], s: null });
      if (!confirm(i18n('report.admin.fix_confirm'))) return;
      setStatus(st, i18n('report.sending'), 'busy');
      const x = await api({ action: 'report_admin_fix', token: tok(), code: CODE, set_id: setId, result: { w, g } });
      setStatus(st, x && x.ok ? i18n('report.admin.done') : errText(x), x && x.ok ? 'ok' : 'err');
      if (x && x.ok) setTimeout(renderAdmin, 800);
    });
    row.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!confirm(i18n('report.admin.reset_confirm'))) return;
      setStatus(st, i18n('report.sending'), 'busy');
      const x = await api({ action: 'report_admin_fix', token: tok(), code: CODE, set_id: setId, reset: true });
      setStatus(st, x && x.ok ? i18n('report.admin.done') : errText(x), x && x.ok ? 'ok' : 'err');
      if (x && x.ok) setTimeout(renderAdmin, 800);
    });
  }
}

// ── 画面: 受付を始める (運営) ─────────────────────────────────────────

function renderSetup() {
  const root = $('rp-setup');
  root.hidden = false;
  $('rp-title').textContent = i18n('report.setup.title');
  root.innerHTML = `<section class="rp-card-sec">
    <p>${escapeHtml(i18n('report.setup.lead'))}</p>
    <label class="rp-label">${escapeHtml(i18n('report.setup.event'))}<input type="url" id="rp-event" placeholder="https://www.start.gg/tournament/…/event/…"></label>
    ${settingsFormHtml({ top_cut: null, classes_only: false }, 'startgg')}
    <button type="button" class="rp-btn rp-primary" id="rp-start">${escapeHtml(i18n('report.setup.start'))}</button>
    <div class="rp-status" id="rp-setup-status"></div>
    <p class="rp-muted">${escapeHtml(i18n('report.setup.scope'))}</p>
    <p class="rp-muted">${escapeHtml(i18n('report.setup.class'))}</p>
  </section>`;
  $('rp-start').addEventListener('click', async () => {
    const ev = String($('rp-event').value || '').trim();
    const st = $('rp-setup-status');
    if (!/start\.gg\/tournament\/[^/]+\/event\/[^/?#]+/.test(ev) && !/^\d+$/.test(ev)) { setStatus(st, i18n('report.setup.bad_event'), 'err'); return; }
    setStatus(st, i18n('report.setup.going'), 'busy');
    if (DEMO) { setStatus(st, i18n('report.demo.nogo'), 'warn'); return; }
    const okk = await SpspReportAuth.start({ event: ev, settings: readSettings(root) }, location.pathname);
    if (!okk) setStatus(st, i18n('report.err.generic'), 'err');
  });
}

// ── 見本の画面 ─────────────────────────────────────────────────────

let DEMO_ME = '';
const DEMO_SCENES = ['match', 'conflict', 'waiting', 'done', 'gate', 'challonge', 'admin', 'setup'];

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
  return Object.assign({ id: 'd1', kind: 'startgg', state: 'open', started: true, round: 'Winners Round 2', pool: 'B3', phase: 'Pools',
    station: 12, stream: null, slots: [demoSlot(P[0], 5, 0), demoSlot(P[1], 28, 1)], mySide: 0, winner: null, score: null, games: [],
    totalGames: 3, lPlacement: 33, isClass: false, prereq: [null, null] }, o || {});
}

function demoRow(id, state, mine, theirs, P) {
  const reports = {};
  if (mine) reports['0'] = { result: mine, ts: 1, mine: true };
  if (theirs) reports['1'] = { result: theirs, ts: 2, mine: false };
  return { code: 'demo', set_id: id, state, note: state === 'review' ? 'locked_conflict' : '', applied: mine || null,
    slots: [{ id: 'a', name: P[0].name }, { id: 'b', name: P[1].name }], reports, updated_ms: Date.now() - 60000 };
}

const R20 = { w: 0, g: [{ w: 0, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }] };
const R21 = { w: 0, g: [{ w: 0, c: [null, null], s: null }, { w: 1, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }] };
const L12 = { w: 1, g: [{ w: 1, c: [null, null], s: null }, { w: 0, c: [null, null], s: null }, { w: 1, c: [null, null], s: null }] };

let DEMO_P = [];
async function demoApi(body) {
  const P = DEMO_P;
  if (body.action === 'report_submit') {
    const state = DEMO === 'conflict' ? 'agreed' : 'reported';
    const row = demoRow(body.set_id, state, body.result, DEMO === 'conflict' ? body.result : null, P);
    VIEW.sets = (VIEW.sets || []).filter((x) => x.set_id !== body.set_id).concat([row]);
    return { ok: true, set_id: body.set_id, state, op: 'report' };
  }
  if (body.action === 'report_admin') {
    const row = (id, st, a, b, i) => Object.assign(demoRow(id, st, a, b, P), { slots: [{ id: 'a', name: P[i].name }, { id: 'b', name: P[i + 1].name }] });
    return { ok: true, report: { code: 'demo', kind: 'startgg', expires_ms: Date.now() + 86400e3, settings: { top_cut: 8, classes_only: false } },
      sets: [row('101', 'review', R20, L12, 0), row('102', 'conflict', R21, L12, 2), row('103', 'reported', R21, null, 4), row('104', 'agreed', R20, R20, 6), row('105', 'fixed', R21, null, 8)] };
  }
  if (body.action === 'report_settings') return { ok: true, settings: body.settings };
  return { ok: true, state: 'fixed', op: 'report' };
}

async function runDemo() {
  demoBanner();
  if (DEMO === 'list' || !DEMO_SCENES.includes(DEMO)) { $('rp-title').textContent = i18n('report.demo.title'); return; }
  if (DEMO === 'setup') { renderSetup(); return; }
  DEMO_P = await demoPlayers();
  const P = DEMO_P;
  DEMO_ME = P[0].uid;
  INFO = { code: 'demo', kind: DEMO === 'challonge' ? 'challonge' : 'startgg', name: i18n(DEMO === 'challonge' ? 'report.demo.class_name' : 'report.demo.event_name'),
    event_id: 0, active: true, expires_ms: Date.now() + 86400e3, settings: { top_cut: DEMO === 'gate' ? 8 : null, classes_only: false } };
  $('rp-title').textContent = INFO.name;
  if (DEMO === 'challonge') $('rp-sub').textContent = i18n('report.kind.challonge');
  VIEW = { ok: true, admin: true, sets: [] };
  if (DEMO === 'admin') { await renderAdmin(); return; }
  await loadChars();
  STAGES = ['戦場', '終点', '小戦場', 'ポケモンスタジアム2', 'すま村', 'ホロウバスティオン', 'カロスポケモンリーグ'].map((name, i) => ({ id: 9001 + i, name }));
  const done0 = demoMatch(P, { id: 'd0', state: 'complete', round: 'Winners Round 1', slots: [demoSlot(P[0], 5, 0), demoSlot(P[5], 60, 1)], winner: 0, score: [2, 0] });
  PRED = { p: { bt: { ifWin: { d1: 14.2 }, ifLose: { d1: -9.6 }, perSet: { d0: 6.8 } }, tjpr: { delta: 41.5 } } };
  if (DEMO === 'match') { MATCHES = [demoMatch(P, { stream: { name: 'spsp_tv', source: 'TWITCH' } }), done0]; VIEW.sets = [demoRow('d0', 'agreed', R20, R20, P)]; }
  if (DEMO === 'conflict') { MATCHES = [demoMatch(P), done0]; VIEW.sets = [demoRow('d1', 'conflict', R21, L12, P)]; }
  if (DEMO === 'gate') MATCHES = [demoMatch(P, { lPlacement: 7, round: 'Winners Semi-Final', phase: 'Top 8', pool: '' })];
  if (DEMO === 'challonge') { MATCHES = [demoMatch(P, { kind: 'challonge', station: null, phase: '', pool: 'A', round: i18n('report.round', { n: 1 }), totalGames: null, isClass: true })]; PRED = { none: true }; }
  if (DEMO === 'waiting') {
    const pre = { id: 'p1', state: 'playing', round: 'Winners Round 2', station: 7, loser: false, slots: [demoSlot(P[2], 12, 0), demoSlot(P[3], 21, 1)], deeper: [null, null] };
    MATCHES = [demoMatch(P, { id: 'd2', state: 'waiting', round: 'Winners Quarter-Final', station: null, slots: [demoSlot(P[0], 5, 0), null], prereq: [null, pre] }), done0];
    VIEW.sets = [demoRow('d0', 'agreed', R20, R20, P)];
  }
  if (DEMO === 'done') {
    MATCHES = [done0,
      demoMatch(P, { id: 'd3', state: 'complete', round: 'Winners Round 2', slots: [demoSlot(P[0], 5, 0), demoSlot(P[6], 12, 1)], winner: 1, score: [1, 2] }),
      demoMatch(P, { id: 'd4', state: 'complete', round: 'Losers Round 3', slots: [demoSlot(P[0], 5, 0), demoSlot(P[7], 20, 1)], winner: 0, score: [2, 1] })];
    VIEW.sets = [demoRow('d0', 'agreed', R20, R20, P), demoRow('d3', 'review', null, L12, P), demoRow('d4', 'reported', R21, null, P)];
  }
  const cur = MATCHES.find((m) => m.state === 'open');
  if (cur) await matchAnimation(cur);
  renderPlayer();
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

$('rp-login-btn').addEventListener('click', () => SpspLogin.startLogin(location.pathname + location.search));
$('rp-relogin-btn').addEventListener('click', () => SpspLogin.startLogin(location.pathname + location.search));
$('rp-to-admin').addEventListener('click', () => { location.href = pageUrl(CODE, true); });
$('rp-to-player').addEventListener('click', () => { location.href = pageUrl(CODE, false); });
main().catch((e) => setStatus($('rp-status'), String((e && e.message) || e), 'err'));
