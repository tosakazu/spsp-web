// @ts-check
// match.js — 試合 (ブラケット) の表示順・ラベル・DE の W2W 換算 (サイト共通)。以前は p/ と t/ に同じものがあった。
//   SPSPMatch.compactBracketLabel(label, roundText, bracketType?)
//       "Winners TOP 1024" → "W.Top1024"。GF / WF / LF は round_text を見て短縮 (Grand Final Reset は "GF2")。
//       class prefix ("B-" / "C-" / "D-" / "E-") は維持。カテゴリ (総当たり / スイスドロー / レート戦) はそのまま。
//   SPSPMatch.matchSortKey(m) → [tier, side, topX, gfOrder]
//       表示順: newest first (= GF/Reset を最上段、予選/RR を最下段)。
//         セクション: GF=0 → L=1 → W=2 → 予選/総当たり=3 (= 重要度高→低)。
//         セクション内: top_x 小さい順 (= LF / WF / 後期ラウンド先)。例: L 内 L.Top3(LF) → L.Top4 → … → L.Top12。
//         GF 内: Reset → 非Reset (= Reset の方が新しい)。
//   SPSPMatch.sortMatches(ms) → matchSortKey で並べ替えた新しい配列
//   SPSPMatch.placementToW2W(place)
//       DE bracket での「placement に到達するまでに失った round 数」。build_tjpr_ranking.py の同名関数と等価。
import SPSPI18n from './i18n.js';
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

  // ROUND_ROBIN などブラケット構造の無いフェーズは、ビルドが global_bracket_label に日本語のカテゴリ名 (総当たり / スイスドロー / レート戦) を入れる。
  // 新しい出力 (spsp_scripts feat/output-ids) は bracket_type (start.gg の phase bracket type) も持つので、あれば辞書 (match.bracket.<type 小文字>) で出す
  /** @param {string | null | undefined} label @param {string | null | undefined} roundText @param {string | null | undefined} [bracketType] */
  function compactBracketLabel(label, roundText, bracketType) {
    if (!label && !roundText) return '';
    var rt = (roundText || '').toLowerCase();
    var prefix = '';
    var body = label || '';
    var m = body.match(/^([BCDE])-/);
    if (m) { prefix = m[1] + '-'; body = body.slice(2); }
    if (rt.includes('grand final') && !prefix) return rt.includes('reset') ? 'GF2' : 'GF';
    if (body === 'Grand Final') return prefix + 'GF';
    // WF/LF は body が "Winners TOP 2" / "Losers TOP 3" のときだけ.
    if (body === 'Winners TOP 2' && rt.includes('winners final')) return prefix + 'WF';
    if (body === 'Losers TOP 3' && rt.includes('losers final')) return prefix + 'LF';
    if (!body) return '';
    if (/^(総当たり|スイスドロー|レート戦)$/.test(body)) {
      var type = bracketType ? String(bracketType).toLowerCase() : '';
      if (type && SPSPI18n.has('match.bracket.' + type)) return prefix + SPSPI18n.t('match.bracket.' + type);
      return prefix + body;
    }
    return prefix + body.replace(/^Winners TOP\s*/i, 'W.Top').replace(/^Losers TOP\s*/i, 'L.Top');
  }

  function matchSortKey(m) {
    var label = m.global_bracket_label || '';
    var rt = (m.round_text || '').toLowerCase();
    // class prefix ("B-" 等) を tier として分離. 0=main, 1=B, 2=C, 3=D, 4=E.
    var body = label, tier = 0;
    var cm = body.match(/^([BCDE])-/);
    if (cm) { tier = cm[1].charCodeAt(0) - 'A'.charCodeAt(0); body = body.slice(2); }
    var side, gfOrder = 0;
    if (rt.includes('grand final') && tier === 0) {
      side = 0;
      gfOrder = rt.includes('reset') ? 0 : 1;  // Reset 先 (newer)
    } else if (body === 'Grand Final') side = 0;
    else if (body.startsWith('Losers')) side = 1;
    else if (body.startsWith('Winners')) side = 2;
    else side = 3;  // 予選 / 総当たり / スイスドロー / レート戦 / null は末尾.
    var topX = m.global_top_x != null ? m.global_top_x : 999999;
    return [tier, side, topX, gfOrder];
  }

  function sortMatches(ms) {
    return ms.slice().sort(function (a, b) {
      var ka = matchSortKey(a), kb = matchSortKey(b);
      for (var i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return 0;
    });
  }

  var DE_W2W_BOUNDS = (function () {
    var out = [];
    for (var n = 0; n <= 30; n++) {
      var p;
      if (n === 0) p = 1;
      else if (n === 1) p = 2;
      else if (n % 2 === 0) p = Math.pow(2, n / 2) + 1;
      else p = 3 * Math.pow(2, (n - 3) / 2) + 1;
      out.push([p, n]);
    }
    return out;
  })();

  function placementToW2W(place) {
    if (place == null || place < 1) return 0;
    var result = 0;
    for (var i = 0; i < DE_W2W_BOUNDS.length; i++) {
      if (DE_W2W_BOUNDS[i][0] <= place) result = DE_W2W_BOUNDS[i][1];
      else break;
    }
    return result;
  }

  var api = { compactBracketLabel: compactBracketLabel, matchSortKey: matchSortKey, sortMatches: sortMatches, placementToW2W: placementToW2W };
  global.SPSPMatch = api;
  (global.SPSP = global.SPSP || {}).Match = api;   // window.SPSP.Match (名前空間。旧名 SPSPMatch も残す)

export default api;
export { compactBracketLabel, matchSortKey, sortMatches, placementToW2W };
