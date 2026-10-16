// @ts-check
// views.js — ページ用に小さく分けた一覧ファイル (<dataRoot>/data/views/、ビルドの spsp/cli/build_split_views.py が書く) の読み込み。
// 以前はどのページも latest_tjpr_full.jsonl (全選手の行。北米 20 万人で 145 MB) か players_current.json (全選手の揮発部分) を
// 丸ごと読んでいた。views/ があればページはこちらの要る分だけを読む。
//
// 互換: サイト (spsp-web) とデータ (ビルド) は別々に更新される。views/manifest.json が無い (404・形が違う・取得失敗) ときは
// manifest() が null を返すので、ページは今までどおり大きいファイルを読む (どのページも「まず manifest()、null なら従来どおり」)。
//
//   SPSPViews.at(prefix)        → prefix (データの置き場 = SPSP.data) ごとの読み込み口 (キャッシュはこの中)。以下は at() の中身。
//                                  SPSPViews.manifest() など、トップレベルの同名関数は at(SPSP.data) の略
//   .manifest()                 → Promise<manifest | null>  (1 回だけ取る。null = views が無い → 従来どおり)
//   .index()                    → Promise<Index | null>     players_index.json (列形式) を復号したもの。下の Index
//   .peekIndex()                → Index | null              読み込み済みなら同期で (展開行の相手の名前・順位の引き当て用)
//   .currentFile(uid)           → Promise<file | null>      current/<uid % N>.json (players_current.json と同じ形で、その分割の uid だけ)
//   .currentRow(uid)            → Promise<array | null>     その uid の揮発部分の行 (列形式のまま。復号は js/player_data.js)
//   .chunk(method, k)           → Promise<rec[]>            ranking/<method>/<k>.json (範囲外は [])
//   .rowsByUids(uids, opts)     → Promise<rec[]>            uids の表の行 (uids の順、居ない uid は飛ばす)。
//                                  index の位置 → ranking/ensemble/<位置 / chunk> だけを取る。
//                                  opts.plain: 全国表用の _display_rank / _is_overseas を外した、jsonl の行と同じ形で返す
//   .searchIndex(query, opts)   → Promise<IndexRow[]>       名前の部分一致 / uid の部分一致 / discriminator の前方一致 (3 文字以上の 16 進)。
//                                  ranking-table.js の絞り込みと同じ規則。並びは index の並び (総合順位順)。opts.discOf(uid) で discriminator を引く
//                                  (既定は js/links.js の SPSPLinks.discOf。表は links.js が読む)
//   .charRows(id) / .prefRows(order) → Promise<rec[]>       char/<id>.json / pref/<order>.json (無ければ [])
//   .prefSummary() / .simPop()  → Promise<json | null>
//   .bundledPlayer(uid)         → Promise<{p, h} | null>   参加の少ない選手は players/<uid>.json と history/<uid>.json の中身が
//                                  bundle/<uid % manifest.bundle_shards>.json にまとめてあり、個別のファイルは更新されない (古いか無い)。
//                                  まとめてある選手なら {p: players/ の中身, h: history/ の中身 | null}、そうでなければ null (個別のファイルを読む)。
//                                  bundle_shards が 0 / 無い (まとめていないビルド) なら常に null。players_index.json を読み込み済みなら
//                                  列 b (1 = まとめてある) で分割を取るかを決め、未読み込みなら分割を取って中に居るかで決める
//   SPSPViews.dayToDate(days)   → 'YYYY-MM-DD' (players_index の last = 1970-01-01 からの日数)
//
// Index: { n, columns, rows, col: {uid: 0, …}, get(uid) → IndexRow | null, pos(uid) → 位置 | -1, at(i) → IndexRow, list() → IndexRow[] }
//   IndexRow = { uid, name, ens, tjpr, bt, lv, prov, ovs, char, pref, last, b } (prov / ovs / b は 0/1、pref = geo.json の単位の order。
//              b はまとめ (bundle/) が入ったビルドから)
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

var FORMAT = 1;
var METHODS = ['ensemble', 'tjpr', 'bt_gated'];

function validManifest(m) {
  return !!(m && typeof m === 'object' && m.format === FORMAT && m.ranking_chunks && typeof m.ranking_chunks === 'object' && m.chunk > 0);
}

function dayToDate(days) {
  if (days == null || !isFinite(days)) return null;
  return new Date(Number(days) * 86400000).toISOString().slice(0, 10);
}

function makeIndex(j) {
  var columns = j.columns || [];
  var rows = j.rows || [];
  /** @type {Record<string, number>} */
  var col = {};
  columns.forEach(function (c, i) { col[c] = i; });
  /** @type {Map<number, number>} */
  var posMap = new Map();
  var iu = col.uid;
  for (var i = 0; i < rows.length; i++) posMap.set(Number(rows[i][iu]), i);
  /** @type {any[] | null} */
  var listCache = null;
  function at(i) {
    var r = rows[i];
    if (!r) return null;
    /** @type {Record<string, any>} */
    var o = {};
    for (var k = 0; k < columns.length; k++) o[columns[k]] = r[k];
    return o;
  }
  return {
    n: rows.length, columns: columns, rows: rows, col: col,
    pos: function (uid) { var p = posMap.get(Number(uid)); return p == null ? -1 : p; },
    get: function (uid) { var p = posMap.get(Number(uid)); return p == null ? null : (listCache ? listCache[p] : at(p)); },
    at: at,
    list: function () {
      if (!listCache) { listCache = []; for (var i2 = 0; i2 < rows.length; i2++) listCache.push(at(i2)); }
      return listCache;
    },
  };
}

function plainRec(rec) {
  if (!rec || (!('_display_rank' in rec) && !('_is_overseas' in rec))) return rec;
  /** @type {Record<string, any>} */
  var o = {};
  for (var k in rec) if (k !== '_display_rank' && k !== '_is_overseas') o[k] = rec[k];
  return o;
}

var _inst = {};
function at(prefix) {
  if (prefix == null) prefix = (global.SPSP && global.SPSP.data) || '';
  return _inst[prefix] || (_inst[prefix] = makeInst(prefix));
}

function makeInst(prefix) {
  var base = prefix + 'data/views/';
  /** @type {Promise<any> | null} */
  var manifestP = null;
  /** @type {Promise<any> | null} */
  var indexP = null;
  /** @type {any} */
  var indexVal = null;
  /** @type {Record<string, Promise<any>>} */
  var files = {};

  function getJson(rel, missing) {
    // 404 は「無い」(missing を返す)。それ以外の失敗は throw
    if (!files[rel]) {
      files[rel] = fetch(base + rel).then(function (r) {
        if (r.status === 404) return missing;
        if (!r.ok) throw new Error('data/views/' + rel + ' HTTP ' + r.status);
        return r.json();
      });
      files[rel].catch(function () { delete files[rel]; });   // 通信エラーは次の呼び出しで取り直す
    }
    return files[rel];
  }
  function manifest() {
    if (!manifestP) {
      manifestP = Promise.resolve().then(function () { return fetch(base + 'manifest.json'); })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (m) { return validManifest(m) ? m : null; })
        .catch(function () { return null; });
    }
    return manifestP;
  }
  function index() {
    if (!indexP) {
      indexP = manifest().then(function (m) {
        if (!m) return null;
        return getJson('players_index.json', null).then(function (j) {
          indexVal = j ? makeIndex(j) : null;
          return indexVal;
        });
      });
      indexP.catch(function () { indexP = null; });
    }
    return indexP;
  }
  function currentFile(uid) {
    return manifest().then(function (m) {
      if (!m || !(m.current_shards > 0)) return null;
      return getJson('current/' + (Number(uid) % m.current_shards) + '.json', null);
    });
  }
  function currentRow(uid) {
    return currentFile(uid).then(function (f) { return (f && f.players && f.players[String(uid)]) || null; });
  }
  function chunk(method, k) {
    return manifest().then(function (m) {
      var n = m && m.ranking_chunks ? (m.ranking_chunks[method] || 0) : 0;
      if (!m || k < 0 || k >= n) return [];
      return getJson('ranking/' + method + '/' + k + '.json', []);
    });
  }
  function rowsByUids(uids, opts) {
    opts = opts || {};
    var plain = !!opts.plain;
    return Promise.all([manifest(), index()]).then(function (res) {
      var m = res[0], I = res[1];
      if (!m || !I) return [];
      var size = m.chunk;
      /** @type {number[]} */
      var want = [];
      var poss = (uids || []).map(function (u) {
        var p = I.pos(u);
        if (p >= 0) { var k = Math.floor(p / size); if (want.indexOf(k) < 0) want.push(k); }
        return p;
      });
      return Promise.all(want.map(function (k) { return chunk('ensemble', k); })).then(function (chunks) {
        /** @type {Record<number, any[]>} */
        var byK = {};
        want.forEach(function (k, i) { byK[k] = chunks[i]; });
        var out = [];
        for (var i = 0; i < poss.length; i++) {
          var p = poss[i];
          if (p < 0) continue;
          var rec = (byK[Math.floor(p / size)] || [])[p % size];
          if (rec && Number(rec.user_id) === Number(uids[i])) out.push(plain ? plainRec(rec) : rec);
        }
        return out;
      });
    });
  }
  function matcher(query, opts) {
    var ft = String(query || '').toLowerCase();
    var discOf = (opts && opts.discOf) || (global.SPSPLinks && global.SPSPLinks.discOf) || null;
    var byDisc = !!discOf && ft.length >= 3 && /^[0-9a-f]+$/.test(ft);
    return function (uid, name) {
      return (!!name && String(name).toLowerCase().indexOf(ft) >= 0) ||
        String(uid).indexOf(ft) >= 0 ||
        (byDisc && String(discOf(uid) || '').toLowerCase().indexOf(ft) === 0);
    };
  }
  function searchIndex(query, opts) {
    return index().then(function (I) {
      if (!I || !query) return [];
      var hit = matcher(query, opts);
      var iu = I.col.uid, inm = I.col.name, out = [];
      for (var i = 0; i < I.rows.length; i++) {
        var r = I.rows[i];
        if (hit(r[iu], r[inm])) out.push(I.at(i));
      }
      return out;
    });
  }
  return {
    prefix: prefix,
    manifest: manifest,
    index: index,
    peekIndex: function () { return indexVal; },
    currentFile: currentFile,
    currentRow: currentRow,
    chunk: chunk,
    rowsByUids: rowsByUids,
    searchIndex: searchIndex,
    matcher: matcher,
    charRows: function (id) { return manifest().then(function (m) { return m ? getJson('char/' + id + '.json', []) : []; }); },
    prefRows: function (order) { return manifest().then(function (m) { return (m && order != null) ? getJson('pref/' + order + '.json', []) : []; }); },
    prefSummary: function () { return manifest().then(function (m) { return m ? getJson('pref_summary.json', null) : null; }); },
    simPop: function () { return manifest().then(function (m) { return m ? getJson('sim_pop.json', null) : null; }); },
    bundledPlayer: function (uid) {
      return manifest().then(function (m) {
        var n = m && m.bundle_shards;
        if (!(n > 0)) return null;
        if (indexVal && 'b' in indexVal.col) {
          var r = indexVal.get(uid);
          if (!r || !r.b) return null;   // まとめていない (または SPSP に居ない) 人は個別のファイル
        }
        return getJson('bundle/' + (Number(uid) % n) + '.json', null).then(function (f) {
          var e = f && f.players && f.players[String(uid)];
          return e ? { p: e.p, h: e.h == null ? null : e.h } : null;
        });
      });
    },
  };
}

var api = {
  FORMAT: FORMAT, METHODS: METHODS,
  at: at, dayToDate: dayToDate, plainRec: plainRec,
  manifest: function () { return at().manifest(); },
  index: function () { return at().index(); },
  peekIndex: function () { return at().peekIndex(); },
  currentFile: function (uid) { return at().currentFile(uid); },
  currentRow: function (uid) { return at().currentRow(uid); },
  chunk: function (method, k) { return at().chunk(method, k); },
  rowsByUids: function (uids, opts) { return at().rowsByUids(uids, opts); },
  searchIndex: function (query, opts) { return at().searchIndex(query, opts); },
  charRows: function (id) { return at().charRows(id); },
  prefRows: function (order) { return at().prefRows(order); },
  prefSummary: function () { return at().prefSummary(); },
  simPop: function () { return at().simPop(); },
  bundledPlayer: function (uid) { return at().bundledPlayer(uid); },
};
global.SPSPViews = api;
(global.SPSP = global.SPSP || {}).Views = api;   // window.SPSP.Views (名前空間。旧名 SPSPViews も置く)

export default api;
export { at, dayToDate, plainRec, FORMAT, METHODS };
