// js/geo.js — 地理単位のカタログ (data/geo.json) を読み、単位 id (日本: 都道府県の漢字名、北米: 州コード) を表示言語の名前にする。
//   loadGeo(root)         data/geo.json を 1 度だけ読む (Promise、キャッシュ)。root はデータの置き場 (SPSP.data)
//   setGeoCatalog(cat)    読み込み済みのカタログを渡す (seed_data.js が読んだものを共有するときなど)
//   geoCatalog()          読み込み済みのカタログ (無ければ null)
//   unitName(id)          単位 id → 表示言語の名前 (units[].name)。未読込 / 未知の id はそのまま
//   unitUrlKey(id)        URL (?pref=) に載せるキー。id が ASCII ならそのまま (北米 'CA')、そうでなければ英語名の slug (日本 '東京都' → 'tokyo')。未読込なら id
//   unitFromUrlKey(key)   URL のキー → 単位 id。新キー・id (旧 URL の '東京都')・各言語の名前を大文字小文字無視で引く。見つからなければ null
// 定義元は smash_database の scripts/<地域>/geo.py (契約 = spsp_scripts docs/geo_json.md)。フロントに県名の一覧を書かない。
// @ts-check
import SPSPI18n from './i18n.js';
import { asciiSlug } from './url_key.js';

/** @type {SpspGeoCatalog | null} */
var CAT = null;
/** @type {Record<string, SpspGeoUnit>} */
var BY_ID = {};
/** @type {Promise<SpspGeoCatalog> | null} */
var PENDING = null;

/** @param {SpspGeoCatalog} cat */
export function setGeoCatalog(cat) {
  if (!cat || !Array.isArray(cat.units)) throw new Error('geo.json の形が違います (units が無い)');
  CAT = cat;
  BY_ID = {};
  for (var i = 0; i < cat.units.length; i++) BY_ID[cat.units[i].id] = cat.units[i];
  return CAT;
}
export function geoCatalog() { return CAT; }

/** @param {string} root @returns {Promise<SpspGeoCatalog>} */
export function loadGeo(root) {
  if (CAT) return Promise.resolve(CAT);
  if (!PENDING) {
    PENDING = fetch((root || '') + 'data/geo.json')
      .then(function (r) { if (!r.ok) throw new Error('geo.json HTTP ' + r.status); return r.json(); })
      .then(setGeoCatalog)
      .catch(function (e) { PENDING = null; throw e; });
  }
  return PENDING;
}

/** @param {string | null | undefined} id @returns {string} */
export function unitName(id) {
  if (id == null) return '';
  var u = BY_ID[String(id)];
  return (u && SPSPI18n.pick(u.name)) || String(id);
}

/** @param {string | null | undefined} id @returns {string} */
export function unitUrlKey(id) {
  if (id == null) return '';
  var s = String(id);
  if (/^[A-Za-z0-9-]+$/.test(s)) return s;
  var u = BY_ID[s];
  return (u && u.name && asciiSlug(String(u.name.en || ''))) || s;
}

/** @param {string | null | undefined} key @returns {string | null} */
export function unitFromUrlKey(key) {
  if (key == null || key === '') return null;
  var k = String(key);
  if (BY_ID[k]) return k;
  var low = k.toLowerCase();
  var units = CAT ? CAT.units : [];
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (unitUrlKey(u.id).toLowerCase() === low || String(u.id).toLowerCase() === low) return u.id;
    var names = u.name || {};
    for (var lang in names) if (String(names[lang]).toLowerCase() === low) return u.id;
  }
  return null;
}

var api = { loadGeo: loadGeo, setGeoCatalog: setGeoCatalog, geoCatalog: geoCatalog, unitName: unitName, unitUrlKey: unitUrlKey, unitFromUrlKey: unitFromUrlKey };
var global = typeof window !== 'undefined' ? window : globalThis;
global.SPSPGeo = api;   // 公開面 (テストの built() もこれを見る)
(global.SPSP = global.SPSP || {}).geo = api;
export default api;
