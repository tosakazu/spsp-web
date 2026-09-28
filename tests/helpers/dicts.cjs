// tests/helpers/dicts.cjs — require(ESM) でモジュールを直接読むテスト向けに、言語辞書 (site/i18n/<lang>.js) を
// globalThis.SPSP_I18N に読み込む。js/i18n.js は同じオブジェクトを見るので、require の前後どちらで呼んでもよい。
// (ブラウザでは <script src="i18n/ja.js"> が window.SPSP_I18N に置く。built() で vm に流すテストはこれを使わない)
const fs = require('fs');
const path = require('path');
const SITE = path.resolve(__dirname, '../../site');

function loadDicts(langs) {
  const g = /** @type {any} */ (globalThis);
  g.window = g.window || g;   // 辞書ファイルは window.SPSP_I18N に置く
  for (const lang of langs || ['ja', 'en']) {
    new Function('window', fs.readFileSync(path.join(SITE, 'i18n', lang + '.js'), 'utf8'))(g);
  }
  return g.SPSP_I18N;
}
module.exports = { loadDicts };
