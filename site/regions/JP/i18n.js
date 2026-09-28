// regions/JP/i18n.js — 日本版で言い方が変わるキーの上書き。言語ごとに、言語辞書 (i18n/ja.js / en.js) にあるキーだけ。
// 日本版は言語辞書がそのまま日本版の言い方なので、いまは空。北米版は regions/NA/i18n.js を見る。
// 読み込み順: i18n/<lang>.js の後、js/i18n.js より前 (ページは region/i18n.js として読む)。
window.SPSP_I18N_REGION = window.SPSP_I18N_REGION || {};
window.SPSP_I18N_REGION.JP = { ja: {}, en: {} };   // 言語の集合は config.langs と同じ
