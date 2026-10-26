// @ts-check
// live.js — 開催中の大会の速報 (プレイヤーページの「参加中の大会」)。
// データは spsp-build の deploy/live-worker (Cloudflare Worker、1 分ごと) が R2 に書く <site.live>index.json と events/<event_id>.json。
// ランキングのビルドとは別の経路で、start.gg が ACTIVE と言っている部門だけが載る (終わってしばらくすると消える)。
// ランキングの対象外になる大会 (オンライン・身内など) も載る。
//   load(uid)                 その選手が出ている部門の一覧 [{summary, doc}] (無ければ [])。index.json は 1 回だけ読む
//   render(el, uid, items)    セクションの中身を描く
//   start(sectionEl, uid)     読んで描く。載っていればセクションを出し、REFRESH_MS ごとに読み直す (タブが裏のときは止める)
// 順位: 確定 (final) なら「N 位」、まだ残っていれば place_min を「N 位以上」、どちらも無ければ「—」。
// 同じ部門の下位クラス (Bクラスなど) にいる人 (entrants[].in_class) は本戦の順位に「◯クラス参加中」を添える。
// プール: entrants[].pg (その選手が最後に試合をしたプール) の start.gg ブラケットの URL。無ければ最初のフェーズのプール。
import SPSPI18n from './i18n.js';
import { escapeHtml } from './html.js';
import { charName } from './chars.js';

const REFRESH_MS = 60 * 1000;
/** @param {string} k @param {any} [p] */
const t = (k, p) => SPSPI18n.t(k, p);
const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

/** 速報の置き場 (末尾 /)。プレビュー (spsp.games 以外) では ?live=sample で見本 (live/sample/) を読む */
export function liveRoot() {
  const root = (W.SPSP && W.SPSP.site && W.SPSP.site.live) || '';
  if (!root) return '';
  const host = (W.location && W.location.hostname) || '';
  const sample = /[?&]live=sample(&|$)/.test((W.location && W.location.search) || '');
  if (sample && host !== 'spsp.games') return root.replace(/live\/[^/]+\/$/, 'live/sample/');
  return root;
}

/** @param {string} url */
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** @param {number | string} uid @returns {Promise<{summary: any, doc: any}[]>} */
export async function load(uid) {
  const root = liveRoot();
  if (!root || !uid) return [];
  let index;
  try { index = await getJson(root + 'index.json'); } catch (e) { return []; }
  const ids = ((index && index.players) || {})[String(uid)] || [];
  if (!ids.length) return [];
  const byId = new Map(((index && index.events) || []).map((/** @type {any} */ s) => [String(s.event_id), s]));
  const out = [];
  for (const id of ids) {
    try {
      const doc = await getJson(`${root}events/${id}.json`);
      out.push({ summary: byId.get(String(id)) || {}, doc });
    } catch (e) { /* 間で消えた部門は飛ばす */ }
  }
  return out;
}

/** @param {any} doc @param {number | string} uid */
function entrantOf(doc, uid) {
  for (const [id, e] of Object.entries(doc.entrants || {})) if (String(/** @type {any} */ (e).uid) === String(uid)) return [id, /** @type {any} */ (e)];
  return [null, null];
}

/** @param {any} doc @param {any} pgId */
function poolOf(doc, pgId) {
  for (const p of doc.phases || []) for (const g of p.groups || []) if (String(g.id) === String(pgId)) return { phase: p, group: g };
  const p0 = (doc.phases || [])[0];
  const g0 = p0 && (p0.groups || [])[0];
  return g0 ? { phase: p0, group: g0 } : null;
}

/** @param {any} e */
function placeHtml(e) {
  if (e.placement != null && e.final) {
    const p = e.placement;
    const cls = p === 1 ? 'gold' : p === 2 ? 'silver' : p === 3 ? 'bronze' : p <= 8 ? 'top8' : '';
    return `<span class="lv-place ${cls}">${t('live.place', { n: p })}</span>`;
  }
  if (e.place_min != null) return `<span class="lv-place">${t('live.place_or_better', { n: e.place_min })}</span>`;
  return `<span class="lv-place dim">—</span>`;
}

/** @param {number} ts */
function hhmm(ts) {
  try {
    return new Date(ts * 1000).toLocaleTimeString(SPSPI18n.lang === 'en' ? 'en-US' : 'ja-JP',
      { hour: '2-digit', minute: '2-digit', timeZone: (W.SPSP && W.SPSP.site && W.SPSP.site.timeZone) || undefined });
  } catch (err) { return ''; }
}

/** 下位クラスでも負けて終わったか (一番新しいセットが終わっていて負け。相手待ちのセットがあればまだ) */
function classOut(/** @type {any} */ doc, /** @type {string} */ myId) {
  const mine = (doc.sets || []).filter((/** @type {any} */ s) => (s.e || []).map(String).includes(myId));
  if (mine.some((/** @type {any} */ s) => s.winner == null)) return false;
  const last = mine.reduce((/** @type {any} */ a, /** @type {any} */ s) => (!a || (s.completed_at || 0) > (a.completed_at || 0) ? s : a), null);
  return !!last && String(last.winner) !== myId;
}

/** その選手のセット (新しいものが上)。行 = ラウンド・相手・スコア・キャラ */
function setsHtml(/** @type {any} */ doc, /** @type {string} */ myId) {
  const mine = (doc.sets || []).filter((/** @type {any} */ s) => (s.e || []).map(String).includes(myId));
  if (!mine.length) return '';
  const order = (/** @type {any} */ s) => s.completed_at || s.started_at || (s.state === 2 ? 4e9 : 0) || 0;
  mine.sort((/** @type {any} */ a, /** @type {any} */ b) => {
    const pa = a.winner == null ? 1 : 0, pb = b.winner == null ? 1 : 0;   // 終わっていない試合を上に
    return pb - pa || order(b) - order(a) || (b.round || 0) - (a.round || 0);
  });
  const rows = mine.map((/** @type {any} */ s) => {
    const i = (s.e || []).map(String).indexOf(myId);
    const oppId = s.e[1 - i];
    const opp = oppId != null ? (doc.entrants || {})[String(oppId)] : null;
    const oppName = opp ? escapeHtml(opp.tag || opp.name || '') : `<span class="dim">${t('live.tbd')}</span>`;
    const oppSeed = opp && opp.seed != null ? `<span class="lv-seed">${t('live.seed_short', { n: opp.seed })}</span>` : '';
    let res = '';
    if (s.winner != null) {
      const win = String(s.winner) === myId;
      const my = s.score && s.score[i], their = s.score && s.score[1 - i];
      const sc = (my != null && their != null && my >= 0 && their >= 0) ? `${my}-${their}` : (my === -1 || their === -1 ? 'DQ' : '');
      res = `<span class="lv-res ${win ? 'win' : 'lose'}">${win ? 'W' : 'L'}</span><span class="lv-score">${sc}</span>`;
    } else {
      res = `<span class="lv-res next">${s.state === 2 ? t('live.playing') : t('live.next')}</span>`;
    }
    // キャラ (自分の使ったもの、重複なし)
    const chars = [];
    for (const g of s.games || []) {
      const c = g.c && g.c[myId];
      if (c != null && !chars.includes(c)) chars.push(c);
    }
    const charTxt = chars.length ? `<span class="lv-chars">${chars.map(c => escapeHtml(charName(c, ''))).filter(Boolean).join(' / ')}</span>` : '';
    return `<div class="lv-set">${res}<span class="lv-round">${escapeHtml(s.round_text || '')}</span>` +
      `<span class="lv-opp">vs ${oppName}${oppSeed}</span>${charTxt}</div>`;
  });
  return `<div class="lv-sets">${rows.join('')}</div>`;
}

/** @param {HTMLElement} el @param {number | string} uid @param {{summary: any, doc: any}[]} items */
export function render(el, uid, items) {
  const cards = [];
  for (const { summary, doc } of items) {
    const [myId, e] = entrantOf(doc, uid);
    if (!e || myId == null) continue;
    const pool = poolOf(doc, e.pg);
    const poolTxt = pool ? `${pool.phase.name || ''}${pool.group.ident && (pool.phase.groups || []).length > 1 ? ' ' + t('live.pool', { id: pool.group.ident }) : ''}` : '';
    const poolLink = pool && pool.group.url
      ? `<a class="lv-link" href="${escapeHtml(pool.group.url)}" target="_blank" rel="noopener">${escapeHtml(poolTxt)} ↗</a>` : '';
    const img = summary.image ? `<img class="lv-img" src="${escapeHtml(summary.image)}" alt="" loading="lazy">` : '';
    const ended = !!(summary.ended || doc.ended_at);
    const badge = ended ? `<span class="lv-badge end">${t('live.ended')}</span>` : `<span class="lv-badge on">${t('live.on')}</span>`;
    const seed = e.seed != null ? `<span class="lv-meta-i">${t('live.seed', { n: e.seed })}</span>` : '';
    const cls = e.in_class && pool
      ? `<span class="lv-meta-i lv-cls">${classOut(doc, String(myId)) ? t('live.class_out', { name: escapeHtml(pool.phase.name || '') }) : t('live.in_class', { name: escapeHtml(pool.phase.name || '') })}</span>` : '';
    const nent = doc.num_entrants != null ? `<span class="lv-meta-i">${t('live.entrants', { n: doc.num_entrants })}</span>` : '';
    cards.push(
      `<div class="lv-card">` +
        `<div class="lv-head">${img}<div class="lv-title">` +
          `<a href="${escapeHtml(doc.tournament_url || summary.tournament_url || '')}" target="_blank" rel="noopener">${escapeHtml(doc.tournament_name || '')}</a>${badge}` +
          `<div class="lv-event">${escapeHtml(doc.event_name || '')}</div>` +
        `</div></div>` +
        `<div class="lv-hero">${placeHtml(e)}${cls}${seed}${nent}</div>` +
        `<div class="lv-links">${poolLink}<a class="lv-link" href="${escapeHtml(doc.url || '')}" target="_blank" rel="noopener">start.gg ↗</a></div>` +
        setsHtml(doc, String(myId)) +
        `<div class="lv-foot">${t('live.updated', { time: hhmm(doc.updated_at || 0) })} · ${t('live.note')}</div>` +
      `</div>`);
  }
  el.innerHTML = cards.join('');
  return cards.length;
}

/** @param {HTMLElement} section @param {number | string} uid */
export function start(section, uid) {
  const body = /** @type {HTMLElement | null} */ (section.querySelector('.lv-body'));
  if (!body || !liveRoot() || !uid) return;
  let timer = 0;
  const tick = async () => {
    const items = await load(uid);
    const n = render(body, uid, items);
    section.style.display = n ? '' : 'none';
    clearTimeout(timer);
    if (n && typeof document !== 'undefined' && document.visibilityState !== 'hidden') timer = W.setTimeout(tick, REFRESH_MS);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && section.style.display !== 'none') tick();
      else clearTimeout(timer);
    });
  }
  tick();
}

const api = { liveRoot, load, render, start };
export default api;
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspLive = api;
