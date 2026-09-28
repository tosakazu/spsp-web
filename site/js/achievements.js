// js/achievements.js — 実績 / 動的バッチの表示文言。
//   achievementLabel(item)   ビルド出力の 1 件 ({label, cls, priority, kind, params}) から表示言語の文言を組む
// ビルド (spsp_scripts spsp/score.py) は判定だけを持ち、何の実績かを kind / params で出す。文言は辞書 (i18n/<lang>.js の ach.*) で組む
// ので、英語ページでは英語になる。kind が無い (古い出力 = 現行の配信データ) は label の形から kind / params を復元する (parseLegacyLabel)。
// 復元できないもの / 辞書に無い kind は label (ビルドの日本語) をそのまま出す。
// 契約 (kind → params):
//   peak_rank {top}            最高順位 (top = 1/2/3/10/50/100/500/1000 の到達枠)
//   peak_tier {lv, tier}       最高レベル (tier = crown/gold/silver/bronze/plus/base)
//   climb {n}                  1 ヶ月で +n ランク (n = 到達枠)
//   uf / spr / losers_run {v}  単独最高値
//   tours / matches / wins / same_opp {n}   活動量 (n = 到達枠)
//   tour_series {series, bucket, cls, count} / tour {name, bucket, cls}   大会成績 (bucket = win/2nd/3rd/4th/5th/top8/top16/top32/top64、cls = B/C/D/E/casual/null)
//   trend {days, n, surge}     動的バッチ (直近 days 日で +n、surge = 急上昇)
// 検証: tests/frontend/achievements.test.cjs (ビルド側テストが組んだ全件について、ja の組み立て = ビルドの label)。
// @ts-check
import SPSPI18n from './i18n.js';

/** 大会成績の枠ごとのアイコン (言語に依らない) */
var BUCKET_ICON = { win: '🏆', '2nd': '🥈', '3rd': '🥉', '4th': '🎖', '5th': '🎖', top8: '🏅', top16: '🏅', top32: '🏅', top64: '🏅' };

/**
 * @typedef {{ label?: string, cls?: string, priority?: number, kind?: string, params?: Record<string, any> }} AchievementItem
 */

/**
 * @param {AchievementItem | string | null | undefined} item
 * @returns {string}
 */
/** 大会成績の枠: ビルドの日本語 → コード */
var BUCKET_CODE = { '優勝': 'win', '準優勝': '2nd', '3位': '3rd', '4位': '4th', '5位': '5th', 'Top 8 以上達成': 'top8', 'Top 16 以上達成': 'top16', 'Top 32 以上達成': 'top32', 'Top 64 以上達成': 'top64' };
var TIER_CODE = { '👑': 'crown', '🥇': 'gold', '🥈': 'silver', '🥉': 'bronze', '+': 'plus' };

/**
 * ビルドの日本語 label から kind / params を復元する (kind が無い旧出力 = 現行の配信データ向け)。
 * 文言の形は spsp/score.py で固定なので機械的に戻せる。戻せなければ null (label をそのまま出す)。
 * 新しい出力 (feat/achievement-kinds) では kind が付くのでここは使わない。
 * @param {string} label
 * @returns {{ kind: string, params: Record<string, any> } | null}
 */
export function parseLegacyLabel(label) {
  var s = String(label || '').trim();
  var m;
  if ((m = /^\S+ 最高 (?:全国 (\d+) 位|Top (\d+))$/.exec(s))) return { kind: 'peak_rank', params: { top: Number(m[1] || m[2]) } };
  if ((m = /^(?:\S+ )?最高 Lv(\d)(👑|🥇|🥈|🥉|\+)? 到達$/.exec(s))) return { kind: 'peak_tier', params: { lv: Number(m[1]), tier: m[2] ? TIER_CODE[m[2]] : 'base' } };
  if ((m = /^🚀 1ヶ月で \+(\d+) ランク上昇$/.exec(s))) return { kind: 'climb', params: { n: Number(m[1]) } };
  if ((m = /^⚡ UF (\d+) 達成$/.exec(s))) return { kind: 'uf', params: { v: Number(m[1]) } };
  if ((m = /^✨ SPR (\d+) 達成$/.exec(s))) return { kind: 'spr', params: { v: Number(m[1]) } };
  if ((m = /^\S+ ルーザーズラン (\d+) 達成$/.exec(s))) return { kind: 'losers_run', params: { v: Number(m[1]) } };
  if ((m = /^\S+ 大会出場 (\d+)\+$/.exec(s))) return { kind: 'tours', params: { n: Number(m[1]) } };
  if ((m = /^⚔ 試合数 (\d+)\+$/.exec(s))) return { kind: 'matches', params: { n: Number(m[1]) } };
  if ((m = /^🏅 勝利数 (\d+)\+$/.exec(s))) return { kind: 'wins', params: { n: Number(m[1]) } };
  if ((m = /^🤝 同一相手と対戦 (\d+)\+$/.exec(s))) return { kind: 'same_opp', params: { n: Number(m[1]) } };
  if ((m = /^(🚀|📈) 直近 (1|3) ヶ月で \+(\d+) (急上昇|上昇)$/.exec(s))) return { kind: 'trend', params: { days: m[2] === '1' ? 30 : 90, n: Number(m[3]), surge: m[4] === '急上昇' } };
  if ((m = /^📈 直近半年で \+(\d+) 上昇$/.exec(s))) return { kind: 'trend', params: { days: 180, n: Number(m[1]), surge: false } };
  if ((m = /^\S+ (.+?) (優勝|準優勝|3位|4位|5位|Top 8 以上達成|Top 16 以上達成|Top 32 以上達成|Top 64 以上達成)(?: ×(\d+))?$/.exec(s))) {
    var name = m[1], cm;
    /** @type {string | null} */
    var cls = null;
    if ((cm = /^(.*) ([BCDE])クラス$/.exec(name))) { name = cm[1]; cls = cm[2]; }
    else if ((cm = /^(.*) カジュアル$/.exec(name))) { name = cm[1]; cls = 'casual'; }
    if (m[3]) return { kind: 'tour_series', params: { series: name, bucket: BUCKET_CODE[m[2]], cls: cls, count: Number(m[3]) } };
    return { kind: 'tour', params: { name: name, bucket: BUCKET_CODE[m[2]], cls: cls } };
  }
  return null;
}

export function achievementLabel(item) {
  if (!item || typeof item !== 'object') return typeof item === 'string' ? item : '';
  if (!item.kind && item.label) {   // 旧出力: 日本語の label から復元して同じ経路で組む
    var parsed = parseLegacyLabel(item.label);
    if (parsed) item = { label: item.label, cls: item.cls, kind: parsed.kind, params: parsed.params };
  }
  var p = item.params || {};
  var fallback = item.label || '';
  /** 辞書にあれば組む、無ければビルドの label @param {string} key @param {Record<string, any>} [params] */
  var t = function (key, params) { return SPSPI18n.has(key) ? SPSPI18n.t(key, params) : fallback; };
  switch (item.kind) {
    case 'peak_rank': return t('ach.peak_rank.' + p.top);
    case 'peak_tier': { var tier = p.lv + '.' + p.tier; return t('ach.peak_tier.' + tier); }
    case 'climb': return t('ach.climb', { n: p.n });
    case 'uf': return t('ach.uf', { v: p.v });
    case 'spr': return t('ach.spr', { v: p.v });
    case 'losers_run': return t('ach.losers_run', { v: p.v });
    case 'tours': return t('ach.tours.' + p.n);
    case 'matches': return t('ach.matches', { n: p.n });
    case 'wins': return t('ach.wins', { n: p.n });
    case 'same_opp': return t('ach.same_opp', { n: p.n });
    case 'tour': case 'tour_series': {
      var name = String(item.kind === 'tour' ? p.name : p.series);
      if (p.cls) name += ' ' + t('ach.class.' + p.cls);
      return t('ach.tour', { icon: BUCKET_ICON[p.bucket] || '', name: name, bucket: t('ach.bucket.' + p.bucket),
                             count: p.count > 1 ? t('ach.tour_count', { n: p.count }) : '' });
    }
    case 'trend': { var trend = p.days + (p.surge ? '.surge' : ''); return t('ach.trend.' + trend, { n: p.n }); }
    default: return fallback;
  }
}

var api = { achievementLabel: achievementLabel, parseLegacyLabel: parseLegacyLabel };
var global = typeof window !== 'undefined' ? window : globalThis;
global.SPSPAchievements = api;   // 公開面 (テストの built() もこれを見る)
(global.SPSP = global.SPSP || {}).achievements = api;
export default api;
