// @ts-check
// player_card_model.js — プレイヤーカード (js/player_card.js) に渡す中身を選手データから作る。プレイヤーページと編集ページで共有 (2026-09-30)。
//   loadCardData(uid)              カードに要るデータ (選手・meta・都道府県・キャラ・海外勢…) を読む (編集ページ用。プレイヤーページは自分で読んだものを渡す)
//   buildCardModel(data, settings) カードの model。settings (テンプレート・色・実績の選択) は無ければ既定 (自動)
//   cardAchievements(data)         カードに出せる実績の全部 (既定の並び = 大会の成績を順位評価のポイント順、残りはビルドの優先度順)
//   perfInfoOf(t) / achievementBadge(a)  プレイヤーページの他の欄でも使う
//   設定 (docs/login_design.md):
//     fetchApplied(uid) / putApplied(uid, s)  適用済み = カードに出る設定。API (/api/card・card_put) があればサーバ、無い所 (ConoHa のプレビュー) はこのブラウザ
//     loadDraft(uid) / saveDraft(uid, s) / clearDraft(uid)  編集ページの途中の状態 (このブラウザに自動保存)
import SPSPI18n from './i18n.js';
import SPSPFormat from './format.js';
import SPSPLinks from './links.js';
import SPSPGeo from './geo.js';
import SPSPPlayerData from './player_data.js';
import SPSPCharEmoji from './char_emoji.js';
import { charName, mergeCharUses } from './chars.js';
import { achievementLabel } from './achievements.js';
import SpspLogin from './login.js';
import SPSP_POST_CONFIG from './post_config.js';

const i18n = SPSPI18n.t;
const S = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis).SPSP || {};

/** カードに要るデータ一式
 * @typedef {{ uid: number, player: any, rec: any, meta: any, subranks: any, prefs: any, overseas: Set<number> | null,
 *             charIdx: any, charEmoji: any }} CardData */
/** 編集ページで選ぶもの。ach = 選んだ実績の key (選んだ順)。null / 空なら自動
 * @typedef {{ template: string, color: string, ach: string[] | null }} CardSettings */

/** @type {CardSettings} */
export const DEFAULT_SETTINGS = { template: 'standard', color: 'red', ach: null };

// ── 実績 ──
// Legacy mapping (for old string-format achievements)
/** @type {Record<string, { readonly label: string, cls: string }>} */
const ACHIEVEMENT_LABELS = {
  lv5_reached:  { get label() { return i18n('player.ach.lv5'); },    cls: 'gold'   },
  lv4_reached:  { get label() { return i18n('player.ach.lv4'); },    cls: 'silver' },
  lv3_reached:  { get label() { return i18n('player.ach.lv3'); },    cls: 'bronze' },
  top10:        { label: '🌟 Top 10 in Japan', cls: 'gold' },
  top50:        { label: '🔥 Top 50 in Japan', cls: 'silver' },
  top100:       { label: '💪 Top 100 in Japan', cls: 'bronze' },
  top1000:      { label: '🎯 Top 1000', cls: '' },
  veteran50:    { get label() { return i18n('player.ach.veteran50'); },    cls: 'blue'   },
  regular20:    { get label() { return i18n('player.ach.regular20'); }, cls: 'blue' },
};
/** @param {SpspAchievement | string} item @returns {{ label: string, cls: string }} */
export function achievementBadge(item) {
  if (typeof item === 'object' && (item.label || item.kind)) return { label: achievementLabel(item), cls: item.cls || '' };  // ビルド出力 (kind/params から表示言語で組む。無ければ label)
  if (typeof item === 'string') {
    if (ACHIEVEMENT_LABELS[item]) return ACHIEVEMENT_LABELS[item];
    if (item.startsWith('climb_30d_+')) {
      const n = parseInt(item.slice('climb_30d_+'.length));
      return { label: i18n('player.ach.rank_up_month', { n }), cls: 'green' };
    }
    return { label: item, cls: '' };
  }
  return { label: '', cls: '' };
}

/** @param {SpspAchievement | string} a */
const isTourAch = a => typeof a === 'object' && (a.kind === 'tour' || a.kind === 'tour_series');
/** @param {SpspAchievement | string} a */
const achPriority = a => (typeof a === 'object' && typeof a.priority === 'number' ? a.priority : 0);
/** 大会の実績の並び順の値: もとになった大会ごとの 順位評価の素点 × 0.5^(評価日からの経過年数、1 年ごとに半分) の最大。
 * ビルドの tjpr_pts = [[日付, 素点], ...] (シリーズは中の全大会)。無い (古いデータ・集計対象外だけ) なら -1
 * @param {SpspAchievement | string} a @param {string} evalDate */
function achTjprPts(a, evalDate) {
  if (typeof a !== 'object' || !Array.isArray(a.tjpr_pts) || !a.tjpr_pts.length) return -1;
  const now = Date.parse(evalDate);
  let best = -1;
  for (const [date, pts] of a.tjpr_pts) {
    const years = Math.max(0, Math.floor((now - Date.parse(date)) / (365.25 * 86400e3)));
    best = Math.max(best, pts * Math.pow(0.5, isNaN(years) ? 0 : years));
  }
  return best;
}
/** 実績の key (選択の保存用)。kind/params があればそれ、古い文字列形式はそのまま
 * @param {SpspAchievement | string} a */
const achKey = a => (typeof a === 'string' ? a : a.kind ? `${a.kind}:${JSON.stringify(a.params || {})}` : a.label);

/** カードに出せる実績の全部 [{ key, label }]。既定の並び: 大会の成績 (kind: tour / tour_series) を先に順位評価のポイント順
 * (同点・ポイントの無いものはビルドの優先度順)、残りはビルドの優先度順。カードの文言は「達成」を省く
 * @param {CardData} data @returns {{ key: string, label: string }[]} */
export function cardAchievements(data) {
  const all = /** @type {(SpspAchievement | string)[]} */ (data.player.achievements || []);
  const ev = data.meta.eval_date;
  return [...all.filter(isTourAch).sort((a, b) => (achTjprPts(b, ev) - achTjprPts(a, ev)) || (achPriority(b) - achPriority(a))),
          ...all.filter(a => !isTourAch(a))]
    .map(a => ({ key: achKey(a), label: achievementBadge(a).label.replace(/\s*達成/g, '').trim() }))
    .filter(a => a.label);
}

// パフォーマンス = 実際に獲得した順位帯が SPSP 換算で全国何位/Lvいくつ相当か。
// 計算は build 側 (v4/output.py _perf_map_for_t) が行い perf_rank として
// tournaments[] にエクスポート済み。ここでは相当 Lv と接尾辞を導出するだけ。
/** @param {any} t @returns {{ eq: number, eqLv: number, lvSfx: string } | null} */
export function perfInfoOf(t) {
  if (t.perf_rank == null || t.is_dq || t.place == null) return null;
  const eq = t.perf_rank;
  // 全国順位 (非 gray) 空間での Lv 境界は cascade 定数 (256/512/1024/2048) に一致
  const eqLv = eq <= 256 ? 5 : eq <= 512 ? 4 : eq <= 1024 ? 3 : eq <= 2048 ? 2 : 1;
  // 接尾辞はヒーローの lvLabel と同じカットオフ (./format.js)
  const lvSfx = SPSPFormat.lvSuffix(eqLv, eq);
  return { eq, eqLv, lvSfx };
}

// 全一/全二/全三 (メインキャラの使い手ランキングで海外勢を除いた順位が 1〜3 位) の [{ rank, chars }]。
// main_by_char は chars[0] (= メインキャラ) で集計済みなので、サブキャラは数えない.
/** @param {CardData} data */
function zenichiOf(data) {
  /** @type {Record<number, string[]>} */
  const zen = {};
  const idx = data.charIdx;
  if (idx && idx.characters && idx.main_by_char) {
    for (const c of idx.characters) {
      const uids = idx.main_by_char[String(c.id)] || [];
      let rank = 0;
      for (const u of uids) {
        if (data.overseas && data.overseas.has(u)) continue;
        rank += 1;
        if (u === data.uid) { (zen[rank] = zen[rank] || []).push(charName(c.id, c.name)); break; }   // 表示言語のキャラ名
        if (rank >= 3) break;
      }
    }
  }
  return [1, 2, 3].filter(r => zen[r] && zen[r].length).map(r => ({ rank: r, chars: zen[r].join(i18n('common.list_sep')) }));
}

// ── カードの model ──
//   場所 = 都道府県 (英語名、カードのデザインどおり「JAPAN, TOKYO」) と県内順位 / 海外勢は国名
//   キャラ = メイン (使い手ランキング内順位つき) + サブ 1 つ、実績 = 既定は cardAchievements の並び (上位 3 つを 1 行ずつ、隙間に入る分を足す)
//   最新の大会 = DQ を除いた最新 1 件、合計 = 出場大会数と試合数 (勝ち + 負け)
/** @param {CardData} data @param {CardSettings | null} [settings]
 * @returns {import('./player_card.js').PCardModel} */
export function buildCardModel(data, settings) {
  const { uid, player, rec, meta } = data;
  const st = settings || DEFAULT_SETTINGS;
  const SUB = data.subranks && data.subranks[String(uid)];
  /** @type {{ text: string, href?: string, rank?: number | null } | null} */
  let loc = null;
  const pref = data.prefs && data.prefs[String(uid)];
  if (pref) {
    const cat = SPSPGeo.geoCatalog();
    const unit = cat && (cat.units || []).find((/** @type {any} */ x) => x.id === pref);
    const prefEn = (unit && unit.name && unit.name.en) || SPSPGeo.unitName(pref);
    loc = { text: `${(cat && cat.region) || 'Japan'}, ${prefEn}`, href: SPSPLinks.prefRankingHref(S.langRoot, pref),
            rank: SUB && SUB.pref ? SUB.pref.rank : null };
  } else if (player.country && player.country !== 'Japan' && data.overseas && data.overseas.has(uid)) {
    loc = { text: player.country };   // 日本勢扱い (jp_uids / 住んでそう勢) は国登録があっても出さない
  }
  // サムス / ダークサムス などは使い手ランキングと同じくまとめて 1 つにする (js/chars.js mergeCharUses、id は代表 id)
  const chars = mergeCharUses(player.characters || []).slice(0, 2).map((c, i) => {
    const ce = data.charEmoji && data.charEmoji[String(c.id)];   // 名前の左の印はキャラの絵文字 (無ければカードが ■ にする)
    return { name: c.name || '', href: SPSPLinks.charRankingHref(S.langRoot, c.id), main: i === 0,
             rank: i === 0 && SUB && SUB.char ? SUB.char.rank : null, emoji: (ce && ce.emoji) || '' };
  });
  // 総合評価の札: 海外 / 計測中 / 全一〜全三、いちばん右に現在の Lv
  const lvNow = (rec.scores && (rec.scores.shared_cascade_lv || rec.scores.tjpr_level)) || 0;
  const rankNow = (rec.ranks && rec.ranks.ensemble) || 0;
  /** @type {{ text: string, title?: string }[]} */
  const pills = [];
  if (data.overseas && data.overseas.has(uid)) pills.push({ text: i18n('table.overseas') });
  if (rec.metadata && rec.metadata.provisional) pills.push({ text: i18n('table.provisional') });   // 2 年で集計対象大会 3 未満
  for (const z of zenichiOf(data)) pills.push({ text: i18n('table.zenichi.' + z.rank, { chars: z.chars }), title: i18n('table.zenichi.title.' + z.rank, { chars: z.chars }) });
  pills.push({ text: lvNow ? `Lv${lvNow}${SPSPFormat.lvSuffix(lvNow, rankNow)}` : i18n('player.lv_none') });

  const tours = /** @type {any[]} */ (player.tournaments || []);
  /** @type {import('./player_card.js').PCardLatest | null} */
  let latest = null;
  // カードの最新の大会は DQ の大会を飛ばす
  const shown = tours.filter(x => !x.is_dq);
  if (shown.length) {
    const t = shown.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    const perf = perfInfoOf(t);
    const pre = t.pretour_ranks && t.pretour_ranks.ensemble != null ? t.pretour_ranks.ensemble : null;
    const d = t.rank_delta_ensemble;
    latest = {
      name: t.name || '', href: t.event_id ? SPSPLinks.tournamentHref(S.langRoot, t.event_id) : '', date: t.date || '',
      place: t.place, placeUnit: i18n('player.place_unit', { n: t.place || 0 }), nent: t.nent, dq: !!t.is_dq,
      perfRank: perf ? perf.eq : null, perfLv: perf ? `Lv${perf.eqLv}${perf.lvSfx}` : '',
      rankBefore: pre, rankAfter: pre != null && d != null ? pre - d : null,
    };
  }
  // 実績: 編集ページで選んだものがあれば選んだ順 (手動)。無ければ既定の並びの上位 12 件 (自動)
  const all = cardAchievements(data);
  const byKey = new Map(all.map(a => [a.key, a]));
  const picked = (st.ach || []).map(k => byKey.get(k)).filter(a => a);
  const manual = picked.length > 0;
  return {
    // 名前はチームタグ無し (ランキング一覧と同じ)
    name: SPSPFormat.stripTeamTag(rec.display), loc, evalDate: meta.eval_date, chars, rank: rec.ranks.ensemble ?? null, pills,
    color: st.color, achMode: manual ? 'manual' : 'auto',
    achievements: (manual ? picked : all.slice(0, 12)).map(a => ({ label: /** @type {{ label: string }} */ (a).label })),
    latest,
    totalTournaments: tours.length,
    totalMatches: tours.reduce((n, t) => n + (t.wins || 0) + (t.losses || 0), 0),
    labels: {
      evalDate: i18n('player.card.eval_date'), achievements: i18n('player.card.achievements'), latest: i18n('player.card.latest'),
      overall: i18n('ranking.tab.ensemble'), national: i18n('common.national'), equivalent: i18n('player.equivalent'), noAch: i18n('player.card.no_ach'),
    },
  };
}

// ── データの読み込み (編集ページ用) ──
/** @param {number} uid @returns {Promise<CardData | null>} 選手がいなければ null */
export async function loadCardData(uid) {
  const base = /** @type {string} */ (S.data);
  const json = (/** @type {Response | null} */ r) => (r && r.ok ? r.json().catch(() => null) : null);
  const [metaRes, player, overseasRes, charIdxRes, charEmojiRes, prefRes, , subrankRes] = await Promise.all([
    fetch(base + 'meta.json'),
    SPSPPlayerData.load(base, uid),
    fetch(base + 'data/overseas.json').catch(() => null),
    fetch(base + 'data/character_index.json').catch(() => null),
    fetch(SPSPCharEmoji.url()).catch(() => null),
    fetch(base + 'data/player_prefectures.json').catch(() => null),
    SPSPGeo.loadGeo(base).catch(() => null),
    fetch(base + 'data/player_subranks.json').catch(() => null),
  ]);
  if (!player) return null;
  const [meta, overseas, charIdx, charEmoji, prefs, subranks] = await Promise.all(
    [metaRes, overseasRes, charIdxRes, charEmojiRes, prefRes, subrankRes].map(json));
  const p = /** @type {any} */ (player);
  return { uid, player: p, rec: p, meta, subranks, prefs, overseas: overseas ? new Set(overseas.uids || []) : null, charIdx, charEmoji };
}

// ── 設定の保存 (ブラウザの localStorage。選手ごと) ──
const APPLIED_KEY = 'spsp_card_v1';
const DRAFT_KEY = 'spsp_card_draft_v1';
/** @param {string} key @returns {Record<string, CardSettings>} */
function readMap(key) {
  try { const j = JSON.parse(localStorage.getItem(key) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
}
/** @param {string} key @param {number} uid @param {CardSettings | null} s */
function writeOne(key, uid, s) {
  try {
    const m = readMap(key);
    if (s) m[String(uid)] = s; else delete m[String(uid)];
    localStorage.setItem(key, JSON.stringify(m));
  } catch (e) { /* 保存できない環境 (プライベートモードなど) では何もしない */ }
}
/** @param {any} s @returns {CardSettings | null} */
function normalize(s) {
  if (!s || typeof s !== 'object') return null;
  return { template: typeof s.template === 'string' ? s.template : 'standard', color: typeof s.color === 'string' ? s.color : 'red',
           ach: Array.isArray(s.ach) ? s.ach.filter((/** @type {any} */ k) => typeof k === 'string') : null };
}
const loadLocalApplied = (/** @type {number} */ uid) => normalize(readMap(APPLIED_KEY)[String(uid)]);

/** 適用済みの設定。サーバ (だれでも読める) から。読めなければ null (= 既定のカード)
 * @param {number} uid @returns {Promise<CardSettings | null>} */
export async function fetchApplied(uid) {
  if (!SpspLogin.apiAvailable()) return loadLocalApplied(uid);
  try {
    const r = await fetch(SPSP_POST_CONFIG.GAS_ENDPOINT + '/card?uid=' + encodeURIComponent(String(uid)));
    const j = r.ok ? await r.json() : null;
    return j && j.ok ? normalize(j.settings) : null;
  } catch (e) { return null; }
}
/** 適用 (本人のログインが要る)。settings が null なら既定に戻す。{ ok, code? }
 * @param {number} uid @param {CardSettings | null} s @returns {Promise<{ ok: boolean, code?: string }>} */
export async function putApplied(uid, s) {
  if (!SpspLogin.apiAvailable()) { writeOne(APPLIED_KEY, uid, s); return { ok: true }; }
  const sess = SpspLogin.session();
  if (!sess || !SpspLogin.isSelf(uid)) return { ok: false, code: 'not_owner' };
  const r = await SpspLogin.api({ action: 'card_put', token: sess.token, settings: s });
  return r && r.ok ? { ok: true } : { ok: false, code: (r && r.error && r.error.code) || 'unknown' };
}
/** @param {number} uid */ export const loadDraft = uid => normalize(readMap(DRAFT_KEY)[String(uid)]);
/** @param {number} uid @param {CardSettings} s */ export const saveDraft = (uid, s) => writeOne(DRAFT_KEY, uid, s);
/** @param {number} uid */ export const clearDraft = uid => writeOne(DRAFT_KEY, uid, null);

export default { buildCardModel, cardAchievements, loadCardData, perfInfoOf, achievementBadge, DEFAULT_SETTINGS,
                 fetchApplied, putApplied, loadDraft, saveDraft, clearDraft };
