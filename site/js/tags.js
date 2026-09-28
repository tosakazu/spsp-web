// @ts-check
// tags.js — 大会のタグ (休日 / 実質平日 / プレ大会 / 制限 / 下位クラス / 再開待ち …) の文言と判定 (サイト共通)。
// 以前は同じ判定と説明文が t/ / events/ / sim/ / player-detail.js にコピーされていた。
// ページごとに CSS のクラス名が違う (chip wk / tag tag-wk / badge wk / tag-wk) ので、クラス名は呼ぶ側が渡す。
//
//   SPSPTags.dayTag(t, cls, opts)      休日 / 実質休日 / 実質平日 / 平日 のどれか 1 つ。cls = { wk, wd }
//       opts.realWeekend=false で「実質休日」(平日開催だが休日扱い) の出し分けをしない (旧 player-detail の挙動)
//   SPSPTags.statusTag(t, cls)         再開待ち / 未完了 (どちらか、無ければ '')。cls = { resume, gf }
//   SPSPTags.flagTag(t, kind, cls)     kind = 'pre' | 'res' | 'lc' | 'uchi' | 'special' | 'small'。該当しなければ ''
//   SPSPTags.flagTags(t, cls)          cls に載っている kind を順に (pre → res → lc → uchi → special → small)
//   SPSPTags.TEXT / SPSPTags.TITLE     文言と説明 (title 属性)。中身は i18n/ja.js の tags.* (js/i18n.js を先に読む)
//
// 判定の意味:
//   実質平日 = 実暦は土日祝だが計算上は平日扱いの特定シリーズ (大菊月等)。
//   プレ大会も計算上は平日扱いだが、タグは従来どおり 平日 + プレ大会 で表す。
//   実質休日 = お盆・年末年始の大規模大会 (平日開催だが休日扱い)。
import SPSPI18n from './i18n.js';
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

  // 文言は i18n/ja.js (js/i18n.js を先に読む)。呼ばれたときに引く (TEXT.wk のように使う)
  var i18n = function (k) { return SPSPI18n.t(k); };
  var TEXT = {
    get wk() { return i18n('tags.wk'); }, get wk_real() { return i18n('tags.wk_real'); },
    get wd() { return i18n('tags.wd'); }, get wd_real() { return i18n('tags.wd_real'); },
    get resume() { return i18n('tags.resume'); }, get gf() { return i18n('tags.gf'); },
    get pre() { return i18n('tags.pre'); }, get res() { return i18n('tags.res'); }, get lc() { return i18n('tags.lc'); },
    get uchi() { return i18n('tags.uchi'); }, get special() { return i18n('tags.special'); }, get small() { return i18n('tags.small'); },
  };
  var TITLE = {
    get wk_real() { return i18n('tags.title.wk_real'); },
    get wd_real() { return i18n('tags.title.wd_real'); },
    get resume() { return i18n('tags.title.resume'); },
    get gf() { return i18n('tags.title.gf'); },
    get small() { return i18n('tags.title.small'); },
  };
  var FLAG_KEY = { pre: 'is_pre', res: 'is_restricted', lc: 'is_lower_class', uchi: 'is_uchi', special: 'is_special_rules', small: 'is_small' };
  // ビルド出力の tags 配列 ('weekend', 'pre', 'uchi' … = is_* の名前から is_ を取ったもの。spsp_scripts feat/output-ids から) があればそれを、
  // 無ければ (現行データ) is_* フラグを見る。どちらでも同じ判定になる
  /** @param {any} t @param {string} name 'weekend' など */
  function flag(t, name) {
    if (t && Array.isArray(t.tags)) return t.tags.indexOf(name) >= 0;
    return !!(t && t['is_' + name]);
  }
  var FLAG_ORDER = ['pre', 'res', 'lc', 'uchi', 'special', 'small'];

  function span(cls, text, title) {
    return '<span class="' + cls + '"' + (title ? ' title="' + title + '"' : '') + '>' + text + '</span>';
  }

  function dayTag(t, cls, opts) {
    var realWeekend = !(opts && opts.realWeekend === false);
    if (flag(t, 'weekend')) {
      // 「実質平日」は weekend_real の情報がある記録で、それが偽のとき (tags 配列なら無いこと、フラグなら明示の false)
      var knownReal = Array.isArray(t.tags) || t.is_weekend_real === false;
      return (realWeekend && knownReal && !flag(t, 'weekend_real'))
        ? span(cls.wk, TEXT.wk_real, TITLE.wk_real)
        : span(cls.wk, TEXT.wk);
    }
    return (flag(t, 'weekend_real') && !flag(t, 'pre'))
      ? span(cls.wd, TEXT.wd_real, TITLE.wd_real)
      : span(cls.wd, TEXT.wd);
  }

  function statusTag(t, cls) {
    if (flag(t, 'awaiting_resume')) return span(cls.resume, TEXT.resume, TITLE.resume);
    if (flag(t, 'gf_missing')) return span(cls.gf, TEXT.gf, TITLE.gf);
    return '';
  }

  function flagTag(t, kind, cls) {
    if (!flag(t, FLAG_KEY[kind].slice(3))) return '';
    return span(cls, TEXT[kind], TITLE[kind]);
  }

  function flagTags(t, cls) {
    var out = [];
    for (var i = 0; i < FLAG_ORDER.length; i++) {
      var k = FLAG_ORDER[i];
      if (!cls[k]) continue;
      var h = flagTag(t, k, cls[k]);
      if (h) out.push(h);
    }
    return out;
  }

  var api = { dayTag: dayTag, statusTag: statusTag, flagTag: flagTag, flagTags: flagTags, flag: flag, TEXT: TEXT, TITLE: TITLE };
  global.SPSPTags = api;
  (global.SPSP = global.SPSP || {}).Tags = api;   // window.SPSP.Tags (名前空間。旧名 SPSPTags も残す)

export default api;
export { dayTag, statusTag, flagTag, flagTags, flag, TEXT, TITLE };
