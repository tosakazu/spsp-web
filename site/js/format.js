// @ts-check
// format.js — 表示用の小さな整形 (サイト共通)。以前は同じはしごが ranking-table.js / player-detail.js /
// p/ / t/ / sim/ の 5 か所にコピーされていた。
//   SPSPFormat.lvSuffix(lv, rank) → '' | '+' | '👑' | '🥇' | '🥈' | '🥉'
//       レベル接尾辞: Lv5 は全国順位で 👑(≤8) / 🥇(≤16) / 🥈(≤32) / 🥉(≤64) / +(≤128)、
//       Lv1-4 は +カットオフ (384 / 768 / 1536 / 3072) 以内なら「+」。lv か rank が無ければ ''。
//   SPSPFormat.lvLabel(lv, rank)  → 'Lv3+' のような文字列。lv が無ければ ''。
//   SPSPFormat.fmtRank(r)         → 順位の表示 ('1,234' / 無ければ '—')
// 読み込み順: js/html.js の後、ranking-table.js / player-detail.js より前。
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
  var PLUS_CUTOFF = { 4: 384, 3: 768, 2: 1536, 1: 3072 };

  function lvSuffix(lv, rank) {
    if (!lv || !rank) return '';
    if (lv === 5) {
      return rank <= 8 ? '👑' : rank <= 16 ? '🥇' : rank <= 32 ? '🥈'
           : rank <= 64 ? '🥉' : rank <= 128 ? '+' : '';
    }
    var c = PLUS_CUTOFF[lv];
    return (c && rank <= c) ? '+' : '';
  }

  function lvLabel(lv, rank) {
    if (!lv || lv <= 0) return '';
    return 'Lv' + lv + lvSuffix(lv, rank);
  }

  function fmtRank(r) { return r != null && r > 0 ? r.toLocaleString() : '—'; }

  var api = { lvSuffix: lvSuffix, lvLabel: lvLabel, fmtRank: fmtRank, PLUS_CUTOFF: PLUS_CUTOFF };
  global.SPSPFormat = api;
  (global.SPSP = global.SPSP || {}).Format = api;   // window.SPSP.Format (名前空間。旧名 SPSPFormat も残す)

export default api;
export { lvSuffix, lvLabel, fmtRank, PLUS_CUTOFF };
