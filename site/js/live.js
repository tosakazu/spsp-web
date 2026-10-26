// @ts-check
// live.js — 開催中の大会の速報 (プレイヤーページの「参加中の大会」)。
// データは spsp-build の deploy/live-worker (Cloudflare Worker、1 分ごと) が R2 に書く <site.live>index.json と events/<event_id>.json。
// ランキングのビルドとは別の経路で、start.gg が ACTIVE と言っている部門だけが載る (終わってしばらくすると消える)。
// ランキングの対象外になる大会 (オンライン・身内など) も載る。
//   load(uid)                 その選手が出ている部門の一覧 [{summary, doc}] (無ければ [])。index.json は 1 回だけ読む
//   render(el, uid, items, opts?, hasPage?)  セクションの中身を描く (opts は LiveOpts)
//   start(sectionEl, uid, opts?)  読んで描く。載っていればセクションを出し、REFRESH_MS ごとに読み直す (タブが裏のときは止める)
//   showNotice(el)            トップの帯: ログイン中の本人が出ている開催中の部門 (大会名と順位、自分のプレイヤーページへ)。
//                             ログインしていなければ何もしない。プレビューでは ?live=sample&live_as=<uid> で本人の代わりにできる
// 順位: 確定 (final) なら「N 位」、まだ残っていれば place_min を「N 位以上」、どちらも無ければ「—」。
// 同じ部門の下位クラス (Bクラスなど) にいる人 (entrants[].in_class) は本戦の順位に「◯クラス参加中」を添える。
// プール: entrants[].pg (その選手が最後に試合をしたプール) の start.gg ブラケットの URL。無ければ最初のフェーズのプール。
import SPSPI18n from './i18n.js';
import { escapeHtml } from './html.js';
import SPSPMatch from './match.js';
import SPSPFormat from './format.js';
import SpspLogin from './login.js';
import SPSPLinks from './links.js';

const REFRESH_MS = 60 * 1000;
const { compactBracketLabel, placementToW2W } = SPSPMatch;
const shortName = (/** @type {string} */ s) => SPSPFormat.shortName(s);
/** プレイヤーページから渡すもの: name = 本人の表示名 (試合の見出し)、emojiOf = uid → メインキャラの絵文字、
 * hasPage = 「uid → SPSP にページがあるか」を返す Promise (あれば相手の名前をリンクにする)
 * @typedef {{ name?: string, emojiOf?: (uid: number) => string, hasPage?: Promise<((uid: number) => boolean) | null> }} LiveOpts */
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

/** 順位の文字 (確定 N 位 / N 位以上 / —) */
function placeText(/** @type {any} */ e) {
  if (e.placement != null && e.final) return t('live.place', { n: e.placement });
  if (e.place_min != null) return t('live.place_or_better', { n: e.place_min });
  return '—';
}

/** 順位 (最新の大会結果と同じ形: 大きい数字 + 単位) @param {any} e */
function placeHtml(e) {
  if (e.placement != null && e.final) {
    const p = e.placement;
    const cls = p === 1 ? 'gold' : p === 2 ? 'silver' : p === 3 ? 'bronze' : p <= 8 ? 'top8' : '';
    return `<span class="ph-place ${cls}">${p}<span class="ph-i">${t('player.place_unit', { n: p })}</span></span>`;
  }
  if (e.place_min != null) return `<span class="ph-place">${e.place_min}<span class="ph-i">${t('live.or_better_unit', { n: e.place_min })}</span></span>`;
  return '<span class="ph-place">—</span>';
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

/** その選手のセット (終わっていない試合 → 新しい順)。行は「最新の大会結果」の試合と同じ形 (ラウンドの位置・スコア・相手・シード・UF)
 * @param {any} doc @param {string} myId @param {LiveOpts} opts @param {((uid: number) => boolean) | null} hasPage */
function setsHtml(doc, myId, opts, hasPage) {
  const mine = (doc.sets || []).filter((/** @type {any} */ s) => (s.e || []).map(String).includes(myId));
  if (!mine.length) return '';
  const order = (/** @type {any} */ s) => s.completed_at || s.started_at || (s.state === 2 ? 4e9 : 0) || 0;
  mine.sort((/** @type {any} */ a, /** @type {any} */ b) => {
    const pa = a.winner == null ? 1 : 0, pb = b.winner == null ? 1 : 0;   // 終わっていない試合を上に
    return pb - pa || order(b) - order(a) || (b.round || 0) - (a.round || 0);
  });
  /** @type {Record<string, any>} */
  const typeOf = {};
  for (const p of doc.phases || []) for (const g of p.groups || []) typeOf[String(g.id)] = p.type;
  const ents = doc.entrants || {};
  const me = ents[myId] || {};
  const pSeed = me.seed;
  const rows = mine.map((/** @type {any} */ s) => {
    const i = (s.e || []).map(String).indexOf(myId);
    const oppId = s.e[1 - i];
    const opp = oppId != null ? ents[String(oppId)] : null;
    let score, color;
    if (s.winner != null) {
      const won = String(s.winner) === myId;
      const my = s.score && s.score[i], their = s.score && s.score[1 - i];
      score = (my === -1 || their === -1) ? 'DQ' : (my != null && their != null ? `${my}-${their}` : '—');
      color = won ? '#16a34a' : '#2563eb';
    } else {
      score = `<span class="live-next">${s.state === 2 ? t('live.playing') : t('live.next')}</span>`;
      color = '#dc2626';
    }
    // UF: 自分より高いシードに勝ったときだけ
    let ufHtml = '';
    if (s.winner != null && String(s.winner) === myId && pSeed != null && opp && opp.seed != null && pSeed > opp.seed) {
      const uf = placementToW2W(pSeed) - placementToW2W(opp.seed);
      if (uf > 0) ufHtml = `<div style="font-size:10px;line-height:1.1;margin-top:1px"><span style="color:#16a34a;font-weight:600">+${uf}</span> <span style="color:#9ca3af">UF</span></div>`;
    }
    let oppHtml = `<span class="dim">${t('live.tbd')}</span>`;
    if (opp) {
      const name = escapeHtml(shortName(opp.tag || opp.name || ''));
      const emoji = opp.uid != null && opts.emojiOf ? opts.emojiOf(opp.uid) : '';
      const link = opp.uid != null && hasPage && hasPage(opp.uid) ? SPSPLinks.playerLink(SPSPLinks.SELF, opp.uid, name) : name;
      oppHtml = `${emoji ? emoji + ' ' : ''}${link}`;
    }
    return `<div class="match-row">` +
      `<span class="m-bracket">${escapeHtml(compactBracketLabel(s.label, s.round_text, typeOf[String(s.pg)]) || '')}</span>` +
      `<span class="m-content">` +
        `<span class="m-player"><div>${escapeHtml(opts.name || '')}</div>${pSeed != null ? `<div class="m-seed">#${pSeed}</div>` : ''}</span>` +
        `<span class="m-score" style="color:${color};display:inline-block;text-align:center"><div>${score}</div>${ufHtml}</span>` +
        `<span class="m-opp"><div>${oppHtml}</div>${opp && opp.seed != null ? `<div class="m-seed">#${opp.seed}</div>` : ''}</span>` +
      `</span><span class="m-delta"></span></div>`;
  });
  const header = (opts.name || pSeed != null)
    ? `<div class="match-header">${escapeHtml(opts.name || '')}${pSeed != null ? `<span class="seed">#${pSeed}</span>` : ''}</div>` : '';
  return `<div class="tour-matches live-sets">${header}${rows.join('')}</div>`;
}

/** カードは「最新の大会結果」と同じ形 (大会アイコンは start.gg の画像をそのまま)
 * @param {HTMLElement} el @param {number | string} uid @param {{summary: any, doc: any}[]} items
 * @param {LiveOpts} [opts] @param {((uid: number) => boolean) | null} [hasPage] */
export function render(el, uid, items, opts = {}, hasPage = null) {
  const cards = [];
  for (const { summary, doc } of items) {
    const [myId, e] = entrantOf(doc, uid);
    if (!e || myId == null) continue;
    const pool = poolOf(doc, e.pg);
    const poolTxt = pool ? `${pool.phase.name || ''}${pool.group.ident && (pool.phase.groups || []).length > 1 ? ' ' + t('live.pool', { id: pool.group.ident }) : ''}` : '';
    const poolLink = pool && pool.group.url
      ? `<a class="live-link" href="${escapeHtml(pool.group.url)}" target="_blank" rel="noopener">${escapeHtml(poolTxt)} ↗</a>` : '';
    const img = summary.image ? `<img class="tour-icon lr-icon" src="${escapeHtml(summary.image)}" alt="" loading="lazy">` : '';
    const ended = !!(summary.ended || doc.ended_at);
    const badge = ended ? `<span class="lr-badge live-end">${t('live.ended')}</span>` : `<span class="lr-badge live-on">${t('live.on')}</span>`;
    const cls = e.in_class && pool
      ? `<span class="live-cls">${classOut(doc, String(myId)) ? t('live.class_out', { name: escapeHtml(pool.phase.name || '') }) : t('live.in_class', { name: escapeHtml(pool.phase.name || '') })}</span>` : '';
    let hero = placeHtml(e) + (doc.num_entrants != null ? `<span class="ph-n">/${doc.num_entrants}</span>` : '');
    if (e.seed != null) {
      hero += `<span class="ph-sep"></span><span class="ph-perf"><span class="ph-perf-lbl">${t('live.seed_label')}</span>` +
        `<span class="ph-rank">${e.seed}</span></span>`;
    }
    cards.push(
      `<div class="tour-group live-group">` +
        `<div class="tour-item tour-item-nohover latestres-card" style="border-bottom:none">` +
          `<div class="lr-top">${img}<a href="${escapeHtml(doc.tournament_url || summary.tournament_url || '')}" target="_blank" rel="noopener">${escapeHtml(doc.tournament_name || '')}</a>` +
            `${badge}<span class="lr-badge ng">${t('live.unreflected')}</span></div>` +
          `<div class="live-event">${escapeHtml(doc.event_name || '')}</div>` +
          `<div class="perf-hero">${hero}</div>` +
          `<div class="live-links">${cls}${poolLink}<a class="live-link" href="${escapeHtml(doc.url || '')}" target="_blank" rel="noopener">start.gg ↗</a></div>` +
        `</div>` +
        setsHtml(doc, String(myId), opts, hasPage) +
        `<div class="live-foot">${t('live.updated', { time: hhmm(doc.updated_at || 0) })}</div>` +
      `</div>`);
  }
  el.innerHTML = cards.join('');
  return cards.length;
}

/** @param {HTMLElement} section @param {number | string} uid @param {LiveOpts} [opts] */
export function start(section, uid, opts = {}) {
  const body = /** @type {HTMLElement | null} */ (section.querySelector('.live-body'));
  if (!body || !liveRoot() || !uid) return;
  let timer = 0;
  const tick = async () => {
    const items = await load(uid);
    const hasPage = opts.hasPage ? await opts.hasPage.catch(() => null) : null;
    const n = render(body, uid, items, opts, hasPage);
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

/** プレビューで本人の代わりにする uid (?live=sample&live_as=<uid>、spsp.games では無効) */
function previewUid() {
  if (liveRoot().indexOf('/live/sample/') < 0) return null;
  const m = /[?&]live_as=(\d+)/.exec((W.location && W.location.search) || '');
  return m ? m[1] : null;
}

/** @param {HTMLElement | null} el */
export async function showNotice(el) {
  if (!el || !liveRoot()) return;
  let uid = previewUid();
  if (!uid) {
    const sess = SpspLogin && SpspLogin.session && SpspLogin.session();
    if (!sess) return;
    uid = String(sess.user.id);
  }
  const items = await load(uid);
  const links = [];
  for (const { doc } of items) {
    const e = entrantOf(doc, uid)[1];
    if (!e) continue;
    const href = SPSPLinks.playerHref((W.SPSP && W.SPSP.langRoot) || '', uid) + '#live-section';
    links.push(`<a class="my-notice-item" href="${escapeHtml(href)}">${escapeHtml(doc.tournament_name || '')} <span class="d">${placeText(e)}</span></a>`);
  }
  if (!links.length) { el.style.display = 'none'; return; }
  el.innerHTML = `<span class="label">${t('live.notice_label')}</span><span class="my-notice-items">${links.join('')}</span>`;
  el.style.display = '';
}

const api = { liveRoot, load, render, start, showNotice };
export default api;
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspLive = api;
