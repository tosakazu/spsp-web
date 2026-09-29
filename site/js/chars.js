// js/chars.js — キャラ名を表示言語で引く。
//   charName(id, fallback)   辞書の char.<id> (i18n/<lang>.js) があればそれ、無ければ fallback (データに入っている名前)
//   mergeCharUses(chars)     使用キャラの並びを使い手ランキングと同じ 4 組 (下の CHAR_MERGE_CANONICAL) でまとめる
// キャラ名はビルド出力 (character_index.json / players の characters[].name / char_emoji.json) にも日本語で入っているが、
// 表示はここを通す (英語ページでは英語名)。id は start.gg の character id。
// @ts-check
import SPSPI18n from './i18n.js';

/**
 * @param {number | string} id
 * @param {string} [fallback]
 * @returns {string}
 */
export function charName(id, fallback) {
  return SPSPI18n.has('char.' + id) ? SPSPI18n.t('char.' + id) : (fallback || '');
}

// 使い手ランキングでまとめて 1 つにしている組 (member id → 代表 id)。ビルド側 spsp_scripts の
// spsp/char_index.py _MERGE_TO_CANONICAL と一致させる。辞書の char.<代表 id> は「サムス / ダークサムス」のようなまとめた名前。
/** @type {Record<number, number>} */
export const CHAR_MERGE_CANONICAL = {
  1411: 1411, 1412: 1411,   // シモン / リヒター
  1320: 1320, 1278: 1320,   // ピット / ブラックピット
  1328: 1328, 1408: 1328,   // サムス / ダークサムス
  1317: 1317, 1277: 1317,   // ピーチ / デイジー
};

/** @param {number | string} id @returns {number} */
export function canonicalCharId(id) {
  const n = Number(id);
  return CHAR_MERGE_CANONICAL[n] || n;
}

/**
 * 使用キャラの並び (players の characters、先頭 = メイン) を使い手ランキングと同じ組でまとめる。
 *   - 同じ組のキャラは 1 つにし、id は代表 id、pct は合計 (どれも pct が無い本人申告だけなら pct 無し)
 *   - 先頭 (メイン) の組が先頭。残りは合計 pct の高い順 (同じなら元の並び、pct 無しは後ろ)
 *   - name は charName(代表 id) (表示言語のまとめた名前)。ids は元の id の並び
 * @template {{ id: number, name?: string, pct?: number }} T
 * @param {T[]} chars
 * @returns {(T & { ids: number[] })[]}
 */
export function mergeCharUses(chars) {
  /** @type {Map<number, T & { ids: number[] }>} */
  const groups = new Map();
  for (const c of chars || []) {
    const cid = canonicalCharId(c.id);
    const g = groups.get(cid);
    if (!g) {
      groups.set(cid, Object.assign({}, c, { id: cid, ids: [Number(c.id)],
        name: charName(cid, c.name) }));
      continue;
    }
    g.ids.push(Number(c.id));
    if (typeof c.pct === 'number') g.pct = (typeof g.pct === 'number' ? g.pct : 0) + c.pct;
  }
  const list = [...groups.values()];
  const [main, ...rest] = list;
  const key = (/** @type {{ pct?: number }} */ g) => (typeof g.pct === 'number' ? g.pct : -1);
  rest.sort((a, b) => key(b) - key(a));   // Array.prototype.sort は安定 (同じなら元の並び)
  return main ? [main, ...rest] : [];
}

var api = { charName: charName, mergeCharUses: mergeCharUses, canonicalCharId: canonicalCharId, CHAR_MERGE_CANONICAL: CHAR_MERGE_CANONICAL };
var global = typeof window !== 'undefined' ? window : globalThis;
global.SPSPChars = api;   // 公開面 (テストの built() もこれを見る)
global.charName = charName;   // named import { charName } を built() で受けるため (escapeHtml と同じ)
global.mergeCharUses = mergeCharUses;
(global.SPSP = global.SPSP || {}).chars = api;
export default api;
