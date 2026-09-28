// js/chars.js — キャラ名を表示言語で引く。
//   charName(id, fallback)   辞書の char.<id> (i18n/<lang>.js) があればそれ、無ければ fallback (データに入っている名前)
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

var api = { charName: charName };
var global = typeof window !== 'undefined' ? window : globalThis;
global.SPSPChars = api;   // 公開面 (テストの built() もこれを見る)
global.charName = charName;   // named import { charName } を built() で受けるため (escapeHtml と同じ)
(global.SPSP = global.SPSP || {}).chars = api;
export default api;
