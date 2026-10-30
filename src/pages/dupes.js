// @ts-check
// src/pages/dupes.js — site/dupes/index.html (重複エントリーチェック、docs/dupe_check_design.md)。
//   1. 読み込む: start.gg のキーでその大会の管理者か確かめ (下位クラス作成と同じ)、参加者と連携アカウントを 100 人ずつ取る
//   2. 候補の組を作る (js/dupe_check.js findCandidates)。連携アカウントが空で返った人は取り直す:
//      start.gg は 1 回の応答に同じ Discord を持つ人が 2 人いると片方を空にして返す (2026-10-30 に確認)。10 人ずつ、まだ空なら 1 人ずつ
//   3. 候補の人の SPSP の出場記録 (players/<uid>.json) を読み、記録の無い人だけ start.gg の参加大会数をまとめて取る
//   4. 組ごとに判定して表とカードを出す。印刷 (PDF) と CSV
//   ブラウザの中だけで動く (SPSP のサーバには何も送らない。使用記録も取らない)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspStartggManager from '../../site/js/startgg_manager.js';
import '../../site/js/views.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import { parseStartggUrl, pickEvents } from '../../site/js/class_bracket.js';
import SpspDupeCheck from '../../site/js/dupe_check.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const D = SpspDupeCheck;

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const STARTGG_API = 'https://api.start.gg/gql/alpha';
/** 参加者を 1 回に取る人数 (連携アカウント込みで start.gg の上限 1000 件に収まる最大。150 は断られた) */
const ENTRANTS_PER_PAGE = 100;
/** 連携アカウントを取り直す・参加大会数を取るときに 1 回でまとめる人数 */
const USERS_PER_QUERY = 10;
/** SPSP の選手ファイルを同時に読む数 */
const SPSP_CONCURRENCY = 6;
/** 名前を訳してある連携アカウントの種類 (start.gg の authorizations の type を小文字にしたもの) */
const LINK_TYPES = new Set(['discord', 'twitter', 'twitch', 'mixer', 'xbox']);
/** 根拠のカードに出す大会の数 */
const EV_SHOW = 6;

/** @typedef {import('../../site/js/dupe_check.js').Entrant} Entrant */
/** @typedef {import('../../site/js/dupe_check.js').Side} Side */
/** @typedef {import('../../site/js/dupe_check.js').Kind} Kind */
/** @typedef {import('../../site/js/dupe_check.js').Verdict} Verdict */
/** @typedef {{ a: number, b: number, kinds: Kind[], res: ReturnType<typeof D.compare> }} Pair */

/** @param {string} msg @param {'' | 'error' | 'ok'} [kind] */
function status(msg, kind = '') {
  const el = $('dp-status');
  el.textContent = msg;
  el.className = 'cb-status' + (kind ? ' ' + kind : '');
}

/** start.gg GraphQL。回数制限で断られたら少し待って取り直す。ほかのエラーは Error で投げる
 * @param {string} token @param {string} query @param {Record<string, unknown>} [variables] */
async function sgg(token, query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(STARTGG_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && !j.errors) return j.data;
    const msg = (j && j.errors && j.errors[0] && j.errors[0].message) || (j && j.message) || String(res.status);
    if (attempt < 3 && (res.status === 429 || /rate limit/i.test(msg))) { await sleep(10000 * (attempt + 1)); continue; }
    throw new Error(msg);
  }
}
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** URL からイベントの slug を決める (下位クラス作成と同じ。大会の URL でイベントが複数なら選んでもらう)
 * @param {string} token @returns {Promise<string | null>} */
async function resolveEventSlug(token) {
  const parsed = parseStartggUrl($('dp-event').value);
  if (!parsed) { status(i18n('class.err.url'), 'error'); return null; }
  if (parsed.eventSlug) return `tournament/${parsed.tournamentSlug}/event/${parsed.eventSlug}`;
  const row = $('dp-event-pick-row');
  const pick = $('dp-event-pick');
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

/** そのキーで管理できる大会の ID (読み込むときの管理者の確認を飛ばすのに使う) */
let MY_TOURNAMENTS = { token: '', ids: /** @type {Set<string>} */ (new Set()) };

/** その大会の管理者か (owner / admins / 自分が管理する大会の一覧。下位クラス作成と同じ確かめ方)
 * @param {string} token @param {{ id: number, owner?: { id: number } | null }} tour */
async function isAdmin(token, tour) {
  if (MY_TOURNAMENTS.token === token && MY_TOURNAMENTS.ids.has(String(tour.id))) return true;
  const me = await sgg(token, 'query { currentUser { id } }');
  const myId = me && me.currentUser && me.currentUser.id;
  if (myId == null) return false;
  if (tour.owner && tour.owner.id === myId) return true;
  try {
    const a = await sgg(token, 'query($id: ID) { tournament(id: $id) { admins { id } } }', { id: tour.id });
    if (((a.tournament && a.tournament.admins) || []).some((/** @type {any} */ x) => x && x.id === myId)) return true;
  } catch (e) { /* admins は admin でないと読めない */ }
  for (let page = 1; page <= 4; page++) {
    const d = await sgg(token, `query($page: Int!) { currentUser { tournaments(query: { page: $page, perPage: 50, filter: { tournamentView: "admin" } }) {
      pageInfo { totalPages } nodes { id } } } }`, { page });
    const ts = d.currentUser && d.currentUser.tournaments;
    const nodes = (ts && ts.nodes) || [];
    if (nodes.some((/** @type {any} */ n) => n && String(n.id) === String(tour.id))) return true;
    if (!nodes.length || !ts.pageInfo || page >= ts.pageInfo.totalPages) break;
  }
  return false;
}

const USER_FIELDS = 'id discriminator location { city state country } authorizations { type externalUsername externalId }';

/** 参加者 (連携アカウント込み) を全部 @param {string} token @param {number} eventId @returns {Promise<Entrant[]>} */
async function fetchEntrants(token, eventId) {
  /** @type {Entrant[]} */
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const d = await sgg(token, `query($id: ID!, $page: Int!, $per: Int!) { event(id: $id) { entrants(query: { page: $page, perPage: $per }) {
      pageInfo { totalPages total } nodes { id name participants { gamerTag prefix user { ${USER_FIELDS} } } } } } }`,
    { id: eventId, page, per: ENTRANTS_PER_PAGE });
    const en = d.event && d.event.entrants;
    for (const n of (en && en.nodes) || []) out.push(D.entrantFromNode(n));
    if (en && en.pageInfo) status(i18n('dupes.progress.entrants', { done: out.length, total: en.pageInfo.total || out.length }));
    if (!en || !en.pageInfo || page >= en.pageInfo.totalPages) break;
  }
  return out;
}

/** user(id) をまとめて引く (別名 u0, u1, …) @param {string} token @param {number[]} ids @param {string} fields */
async function usersById(token, ids, fields) {
  const q = 'query { ' + ids.map((id, i) => `u${i}: user(id: ${Number(id)}) { ${fields} }`).join(' ') + ' }';
  const d = await sgg(token, q);
  return ids.map((_, i) => (d && d['u' + i]) || null);
}

/** 連携アカウントが空で返った人を取り直す (10 人ずつ → まだ空なら 1 人ずつ) @param {string} token @param {Entrant[]} entrants */
async function refillLinks(token, entrants) {
  const empty = entrants.filter((e) => e.userId != null && !e.links.length);
  /** @param {Entrant} e @param {any} u */
  const fill = (e, u) => {
    const a = (u && u.authorizations) || [];
    e.links = a.filter((/** @type {any} */ x) => x && x.type && x.externalUsername)
      .map((/** @type {any} */ x) => ({ type: String(x.type), name: String(x.externalUsername), id: x.externalId != null ? String(x.externalId) : null }));
  };
  for (let i = 0; i < empty.length; i += USERS_PER_QUERY) {
    const part = empty.slice(i, i + USERS_PER_QUERY);
    const us = await usersById(token, part.map((e) => /** @type {number} */ (e.userId)), 'authorizations { type externalUsername externalId }');
    part.forEach((e, k) => fill(e, us[k]));
  }
  for (const e of empty.filter((x) => !x.links.length)) {
    const [u] = await usersById(token, [/** @type {number} */ (e.userId)], 'authorizations { type externalUsername externalId }');
    fill(e, u);
  }
}

/** @param {string} path data のファイル (無ければ {}) */
async function spspJson(path) {
  try {
    const r = await fetch(SPSP.data + path);
    return r.ok ? await r.json() : {};
  } catch (e) { return {}; }
}

/** 候補の人の材料 (SPSP の出場記録、無い人は start.gg の参加大会数) @param {string} token @param {Entrant[]} entrants @param {number[]} idx */
async function buildSides(token, entrants, idx) {
  const [tourPref, playerPref] = await Promise.all([spspJson('data/tournament_prefectures.json'), spspJson('data/player_prefectures.json')]);
  /** @type {Map<number, Side>} */
  const sides = new Map();
  let done = 0;
  const queue = idx.slice();
  const worker = async () => {
    for (let i = queue.shift(); i != null; i = queue.shift()) {
      const e = entrants[i];
      /** @type {import('../../site/js/dupe_check.js').History | null} */
      let hist = null;
      if (e.userId != null) {
        try {
          const rec = await SPSPPlayerData.load(SPSP.data, e.userId, { history: false, current: false });
          if (rec) hist = D.summarize(rec, tourPref);
        } catch (err) { /* 読めなければ記録なしとして扱う */ }
      }
      const pref = (e.userId != null && playerPref[String(e.userId)]) || (hist && hist.mainPref) || D.prefOf(e.location);
      sides.set(i, { e, hist, pref, sgg: null });
      status(i18n('dupes.progress.spsp', { done: ++done, total: idx.length }));
    }
  };
  await Promise.all(Array.from({ length: SPSP_CONCURRENCY }, worker));
  // SPSP に記録の無い人だけ、start.gg の参加大会数をまとめて取る
  const fresh = idx.filter((i) => { const s = /** @type {Side} */ (sides.get(i)); return !(s.hist && s.hist.count) && s.e.userId != null; });
  if (fresh.length) status(i18n('dupes.step.sgg'));
  for (let k = 0; k < fresh.length; k += USERS_PER_QUERY * 2) {
    const part = fresh.slice(k, k + USERS_PER_QUERY * 2);
    try {
      const us = await usersById(token, part.map((i) => /** @type {number} */ (entrants[i].userId)), 'tournaments(query: { perPage: 1, page: 1 }) { pageInfo { total } }');
      part.forEach((i, n) => {
        const t = us[n] && us[n].tournaments && us[n].tournaments.pageInfo;
        /** @type {Side} */ (sides.get(i)).sgg = t ? { total: Number(t.total) || 0 } : null;
      });
    } catch (e) { /* 数が取れなくても判定はできる */ }
  }
  return sides;
}

/** 読み込んだ結果 (印刷・CSV・表示の切り替えで使う)
 * @type {null | { event: any, entrants: Entrant[], sides: Map<number, Side>, pairs: Pair[], at: Date }} */
let report = null;

async function load() {
  report = null;
  $('dp-report').hidden = true;
  const token = sggToken();
  if (!parseStartggUrl($('dp-event').value)) return status(i18n('class.err.url'), 'error');
  if (!token) return status(i18n('class.err.startgg_key'), 'error');
  const slug = await resolveEventSlug(token);
  if (!slug) return;
  const ev = (await sgg(token, 'query($slug: String) { event(slug: $slug) { id name numEntrants tournament { id name startAt owner { id } } } }', { slug })).event;
  if (!ev) return status(i18n('class.err.event'), 'error');
  status(i18n('class.step.check'));
  if (!(await isAdmin(token, ev.tournament))) return status(i18n('class.err.not_admin'), 'error');

  const entrants = await fetchEntrants(token, ev.id);
  status(i18n('dupes.step.links'));
  await refillLinks(token, entrants);
  const cands = D.findCandidates(entrants);
  const idx = [...new Set(cands.flatMap((c) => [c.a, c.b]))];
  const sides = await buildSides(token, entrants, idx);
  const now = Date.now();
  /** @type {Pair[]} */
  const pairs = cands.map((c) => ({ ...c, res: D.compare(/** @type {Side} */ (sides.get(c.a)), /** @type {Side} */ (sides.get(c.b)), c.kinds, now) }));
  report = { event: ev, entrants, sides, pairs, at: new Date(now) };
  render();
  status(i18n('dupes.done', { n: entrants.length, pairs: pairs.filter((p) => !similarOnly(p)).length }), 'ok');
}

/** 名前が 1 文字違いだけの組 (候補が多く偶然が多いので、別人と判断したものは出さず、残りも折りたたむ) @param {Pair} p */
const similarOnly = (p) => p.kinds.length === 1 && p.kinds[0] === 'similar_name';

/** @param {Verdict} v */
const pill = (v) => `<span class="dp-pill dp-v-${v}">${escapeHtml(i18n('dupes.v.' + v))}</span>`;
/** @param {Date} d */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** @param {Entrant} e */
function nameOf(e) {
  return (e.prefix ? e.prefix + ' | ' : '') + e.tag;
}
/** @param {Entrant} e */
function labelOf(e) {
  return `${escapeHtml(nameOf(e))} <span class="dp-disc">${escapeHtml(e.disc || i18n('dupes.no_disc'))}</span>`;
}
/** @param {import('../../site/js/dupe_check.js').Reason} r */
function reasonText(r) {
  return i18n('dupes.r.' + r.code, r.params || {});
}
/** @param {Pair} p */
function pairsLabel(p) {
  if (!report) return '';
  const e = report.entrants;
  return `${labelOf(e[p.a])} × ${labelOf(e[p.b])}`;
}
/** @param {import('../../site/js/dupe_check.js').HistEvent} h */
function rec(h) {
  return h.played ? i18n('dupes.rec', { w: h.w, l: h.l }) + (h.dq ? ' DQ' : '') : i18n('dupes.rec_dq');
}

/** アカウント 1 つ分の欄 @param {Side} s */
function acctHtml(s) {
  const e = s.e;
  const h = s.hist && s.hist.count ? s.hist : null;
  const name = e.disc
    ? `<a href="https://www.start.gg/user/${encodeURIComponent(e.disc)}" target="_blank" rel="noopener">${escapeHtml(nameOf(e))}</a>`
    : escapeHtml(nameOf(e));
  const spsp = h && e.disc ? ` <a class="dp-disc" href="../p/?d=${encodeURIComponent(e.disc)}" target="_blank" rel="noopener">SPSP</a>` : '';
  const histTxt = h ? i18n('dupes.hist', { n: h.count, first: String(h.first), last: String(h.last) })
    : i18n('dupes.hist_none') + (s.sgg ? ' · ' + i18n('dupes.sgg_total', { n: s.sgg.total }) : '');
  const links = e.links.length ? e.links.map((l) => {
    const t = l.type === 'DISCORD' ? D.discordCreated(l.id) : null;
    const nm = escapeHtml(l.name) + (t != null ? ' ' + escapeHtml(i18n('dupes.created', { date: ymd(new Date(t)).slice(0, 7) })) : '');
    const lt = l.type.toLowerCase();
    return `${escapeHtml(LINK_TYPES.has(lt) ? i18n('dupes.link.' + lt) : l.type)}: ${nm}`;
  }).join('<br>') : escapeHtml(i18n('dupes.links_none'));
  const rows = [
    [i18n('dupes.f.area'), escapeHtml(s.pref || '-')],
    [i18n('dupes.f.history'), escapeHtml(histTxt)],
  ];
  if (h && h.chars.length) rows.push([i18n('dupes.f.chars'), escapeHtml(h.chars.join(' / '))]);
  rows.push([i18n('dupes.f.links'), links]);
  return `<div class="dp-acct"><div class="dp-acct-name">${name} <span class="dp-disc">${escapeHtml(e.disc || i18n('dupes.no_disc'))}</span>${spsp}</div>
    <dl class="dp-kv">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
}

/** @param {Pair} p */
function cardHtml(p) {
  if (!report) return '';
  const A = /** @type {Side} */ (report.sides.get(p.a)), B = /** @type {Side} */ (report.sides.get(p.b));
  const warn = new Set(['link_id_conflict', 'link_name_conflict']);
  const reasons = p.res.reasons.map((r) => `<li${warn.has(r.code) ? ' class="warn"' : ''}>${escapeHtml(reasonText(r))}</li>`).join('');
  const ev = [];
  for (const s of p.res.shared.slice(0, EV_SHOW)) {
    ev.push(i18n('dupes.ev.shared', { date: s.a.date, name: s.a.name, a: rec(s.a), b: rec(s.b) }));
  }
  for (const s of p.res.sameDay.slice(0, EV_SHOW)) {
    ev.push(i18n('dupes.ev.sameday', { date: s.a.date, a: s.a.name, pa: String(s.a.pref), b: s.b.name, pb: String(s.b.pref) }));
  }
  const kinds = p.kinds.map((k) => i18n('dupes.k.' + k)).join(' · ');
  return `<article class="dp-card">
    <div class="dp-card-h"><h4>${pairsLabel(p)}</h4>${pill(p.res.verdict)}<span class="dp-kinds">${escapeHtml(kinds)}</span></div>
    <div class="dp-accts">${acctHtml(A)}${acctHtml(B)}</div>
    <ul class="dp-reasons">${reasons}</ul>
    ${ev.length ? `<ul class="dp-ev">${ev.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

/** 表示の並び: 判定 (確認が要るもの先) → 名前 @param {Pair[]} list */
function sortPairs(list) {
  const e = report ? report.entrants : [];
  return list.slice().sort((x, y) => (D.VERDICT_ORDER.indexOf(x.res.verdict) - D.VERDICT_ORDER.indexOf(y.res.verdict))
    || D.normName(e[x.a].tag).localeCompare(D.normName(e[y.a].tag)));
}

function render() {
  if (!report) return;
  const r = report;
  const showDiff = $('dp-show-diff').checked;
  const main = sortPairs(r.pairs.filter((p) => !similarOnly(p)));
  const sim = sortPairs(r.pairs.filter((p) => similarOnly(p) && p.res.verdict !== 'diff'));
  const simHidden = r.pairs.filter((p) => similarOnly(p) && p.res.verdict === 'diff').length;
  const shown = main.filter((p) => showDiff || p.res.verdict !== 'diff');
  $('dp-report-title').textContent = `${r.event.tournament.name} / ${r.event.name}`;
  $('dp-report-meta').textContent = i18n('dupes.meta', { n: r.entrants.length, pairs: main.length, date: ymd(r.at) });
  $('dp-legend').innerHTML = D.VERDICT_ORDER.map((v) => `${pill(v)} ${main.filter((p) => p.res.verdict === v).length}`).join(' ');
  $('dp-tbody').innerHTML = shown.map((p) => `<tr><td>${pairsLabel(p)}</td><td>${pill(p.res.verdict)}</td>
    <td>${escapeHtml(p.res.reasons[0] ? reasonText(p.res.reasons[0]) : '')}</td></tr>`).join('');
  $('dp-empty').hidden = shown.length > 0;
  $('dp-cards').innerHTML = shown.map(cardHtml).join('');
  $('dp-similar').hidden = !sim.length;
  $('dp-similar-sum').textContent = i18n('dupes.similar', { n: sim.length, m: simHidden });
  $('dp-similar-cards').innerHTML = sim.map(cardHtml).join('');
  $('dp-report').hidden = false;
}

/** CSV (全部の組。名前が 1 文字違いだけの組も入れる) */
function downloadCsv() {
  if (!report) return;
  const r = report;
  /** @param {unknown} v */
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['verdict', 'kinds', 'a_name', 'a_discriminator', 'b_name', 'b_discriminator', 'reasons'].map((k) => i18n('dupes.csv.' + k));
  const lines = [head.map(q).join(',')];
  for (const p of sortPairs(r.pairs)) {
    const a = r.entrants[p.a], b = r.entrants[p.b];
    lines.push([i18n('dupes.v.' + p.res.verdict), p.kinds.map((k) => i18n('dupes.k.' + k)).join(' / '), nameOf(a), a.disc || '', nameOf(b), b.disc || '',
      p.res.reasons.map(reasonText).join(' / ')].map(q).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dupes_${r.event.id}_${ymd(r.at)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let loading = false;
function startLoad() {
  if (loading) return;
  loading = true;
  const b = $('dp-load');
  b.disabled = true;
  load().catch((e) => status(i18n('class.err.startgg', { message: e.message }), 'error')).finally(() => { b.disabled = false; loading = false; });
}
$('dp-load').addEventListener('click', startLoad);
$('dp-show-diff').addEventListener('change', render);
$('dp-print').addEventListener('click', () => {
  // 印刷するときは折りたたみ (名前が 1 文字違いの組) も開く
  const d = $('dp-similar');
  const was = d.open;
  d.open = true;
  window.print();
  d.open = was;
});
$('dp-csv').addEventListener('click', downloadCsv);
$('dp-event').addEventListener('input', () => { $('dp-event-pick-row').hidden = true; });
$('dp-event-pick').addEventListener('change', startLoad);

/** キーで管理できる大会を、開催中 → これから → 最近終わった の順に選択欄へ (下位クラス作成と同じ) */
async function loadMyTournaments() {
  const token = sggToken();
  const row = $('dp-tour-pick-row');
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
  MY_TOURNAMENTS = { token, ids: new Set(all.filter((x) => x && x.id != null).map((x) => String(x.id))) };
  const now = Date.now() / 1000;
  const DAY = 86400;
  const rank = (/** @type {any} */ t) => {
    const s = t.startAt || 0, e = t.endAt || s;
    if (s <= now + DAY / 2 && e >= now - DAY / 2) return [0, -s];
    if (s > now) return [1, s];
    return [2, -e];
  };
  const list = all.filter((t) => t && t.slug).map((t) => ({ t, k: rank(t) }))
    .sort((x, y) => (x.k[0] - y.k[0]) || (x.k[1] - y.k[1])).slice(0, 30);
  if (!list.length) { row.hidden = true; return; }
  const fmt = (/** @type {number} */ s) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  $('dp-tour-pick').innerHTML = `<option value="">${escapeHtml(i18n('class.tour_pick_none'))}</option>` + list.map(({ t, k }) =>
    `<option value="${escapeHtml(t.slug)}">${k[0] === 0 ? escapeHtml(i18n('class.tour_live')) + ' ' : ''}${escapeHtml(t.name)}${t.startAt ? ` (${fmt(t.startAt)})` : ''}</option>`).join('');
  row.hidden = false;
}
$('dp-tour-pick').addEventListener('change', () => {
  const v = $('dp-tour-pick').value;
  if (!v) return;
  $('dp-event').value = 'https://www.start.gg/' + v;
  $('dp-event-pick-row').hidden = true;
});
$('dp-sgg-key').addEventListener('change', () => { loadMyTournaments(); });

// start.gg のキー: ほかの運営ツールと同じ (👁 で表示、💾 を押したときだけブラウザに保存。保存場所も共通)
const SGG_TOKEN_KEY = 'spsp_startgg_token';
/** start.gg に送るトークン (認証の欄で「start.gg でログイン」ならそのアクセストークン、「API キー」なら API キー欄) */
function sggToken() {
  return SpspStartggManager.pick($('dp-sgg-key').value);
}
function updateKeyHint() {
  const v = String($('dp-sgg-key').value || '').trim();
  $('dp-sgg-hint').textContent = v ? `${i18n('seed.boot.t1')} ${v.slice(-4)} (${v.length} ${i18n('seed.boot.t2')}` : '';
}
try { const t0 = localStorage.getItem(SGG_TOKEN_KEY); if (t0) $('dp-sgg-key').value = t0; } catch (e) { /* 入れてもらう */ }
updateKeyHint();
$('dp-sgg-key').addEventListener('input', updateKeyHint);
$('dp-sgg-reveal').addEventListener('click', () => {
  const el = $('dp-sgg-key');
  const pwd = el.type === 'password';
  el.type = pwd ? 'text' : 'password';
  $('dp-sgg-reveal').textContent = pwd ? '🙈' : '👁';
});
$('dp-sgg-save').addEventListener('click', () => {
  const b = $('dp-sgg-save');
  const v = String($('dp-sgg-key').value || '').trim();
  if (!v) { $('dp-sgg-hint').textContent = i18n('seed.boot.s1'); return; }
  try { localStorage.setItem(SGG_TOKEN_KEY, v); } catch (e) { $('dp-sgg-hint').textContent = i18n('seed.boot.s3') + /** @type {any} */ (e).message; return; }
  const orig = b.textContent;
  b.textContent = i18n('seed.boot.s2');
  b.disabled = true;
  setTimeout(() => { b.textContent = orig; b.disabled = false; }, 1500);
});
SpspStartggManager.mount({ root: $('dp-sgg-auth'), keyBlock: $('dp-sgg-keyblock'), onChange: () => { loadMyTournaments(); } });
loadMyTournaments();
