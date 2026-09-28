// @ts-check
// src/pages/priority.js — site/priority/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/priority.js にする。
import SPSPHtml from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPData from '../../site/js/data.js';
import SPSPSuggest from '../../site/js/suggest.js';
import '../../site/nav.js';
/** 地域の暦日の時差 (region/config.js utcOffset、例 '+09:00') */
const SITE_UTC_OFFSET = /** @type {SpspSiteConfig} */ (window.SPSP.site).utcOffset;
/** '+09:00' → ミリ秒 @param {string} off */
function utcOffsetMs(off) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(off || '');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000 : 0;
}

(function () {
  'use strict';
  var i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
  SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に
  // 共有データは相対パスで取る (= GitHub Pages でもプレビュー配信でも動く)。
  // discriminators.json は build_discriminators_json.py が nightly で site/data/ に生成。
  var DATA_BASE = SPSP.data;   // データ (JSON) の置き場 (config.dataRoot = data.spsp.games など)。ページ間リンクは SPSP.langRoot
  var DISC_URL = SPSP.data + 'data/discriminators.json';

  /** 選手 1 人分 (jsonl から要る分だけ) */
  /** @typedef {{ uid: number, display: string, ens: number | null, prov?: boolean }} Player */
  /** プレビューの 1 行 (手動 / CSV 由来は origin と追加順 ord を持つ) */
  /** @typedef {Player & { origin?: 'manual' | 'csv', ord?: number }} Row */
  /** CSV 一括追加 / 一括除去の対象 (list / unknown は in-place で操作する) */
  /** @typedef {{ list: number[], unknown: string[], noteId: string, skip: () => number[] }} CsvTarget */

  /** @type {string[]} */
  var PREF_ORDER = [];      // 都道府県の一覧と並び順は data/geo.json から (読み込み時に入る。docs/geo_json.md)

  /** @type {Player[]} */
  var RANKED = [];          // [{uid, display, ens}] ens 昇順 (ens null は末尾)
  /** @type {Map<number, { display: string, ens: number | null, prov?: boolean }>} */
  var MASTER = new Map();   // uid -> {display, ens}
  /** @type {Set<number>} */
  var OVERSEAS = new Set();
  /** @type {Record<string, string>} */
  var PREF = {};            // uid(str) -> 都道府県漢字
  /** @type {Record<string, string>} */
  var DISC = {};            // uid(str) -> discriminator
  /** @type {Record<string, string>} */
  var LAST = {};            // uid(str) -> 最終大会参加日 "YYYY-MM-DD"

  /** @type {string[]} */
  var selPrefs = [];        // 選択済み都道府県 (追加順)
  /** @type {number[]} */
  var manualUids = [];      // 手動追加 uid (追加順)
  /** @type {number[]} */
  var csvUids = [];         // CSV 一括追加 uid (追加順)
  /** @type {string[]} */
  var csvUnknown = [];      // CSV 内の未一致 discriminator (追加側)
  /** @type {number[]} */
  var removeUids = [];      // 手動除去 uid (自動選定から除外)
  /** @type {number[]} */
  var csvRemoveUids = [];   // CSV 一括除去 uid
  /** @type {string[]} */
  var csvRemoveUnknown = [];// CSV 内の未一致 discriminator (除去側)
  /** @type {Row[]} */
  var currentRows = [];     // プレビュー中の行 (= CSV 出力対象)
  /** @type {Record<string, number>} */
  var DISC2UID = {};        // discriminator (小文字) -> uid

  /** @param {any} s @returns {string} */
  function esc(s) { return SPSPHtml.escapeHtml(s); }   // ../js/html.js

  /** id の要素 (フォーム部品は静的 HTML にあるので、型だけ付ける) @param {string} id @returns {HTMLInputElement} */
  function inputEl(id) { return /** @type {HTMLInputElement} */ (document.getElementById(id)); }

  // ---- サジェストのキーボード操作と外側クリックで閉じる処理は ../js/suggest.js (sim/ と共通) ----
  SPSPSuggest.installCloseOnOutsideClick();
  /** @param {HTMLInputElement} input @param {HTMLElement} sug @param {(item: HTMLElement) => void} pick */
  function attachSuggestNav(input, sug, pick) {
    SPSPSuggest.attachSuggestNav(input, sug, pick, function (/** @type {HTMLElement} */ it) { return it.dataset.v !== undefined; });
  }

  // ---- データロード ----
  /** @param {string} url */
  function loadJsonl(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('jsonl ' + r.status);
      return r.text();
    }).then(function (text) {
      var recs = /** @type {SpspRankRecord[]} */ (SPSPData.parseJsonl(text));   // ../js/data.js
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i];
        var ens = (rec.ranks && rec.ranks.ensemble) || null;
        var prov = !!(rec.metadata && rec.metadata.provisional);
        MASTER.set(rec.user_id, { display: rec.display, ens: ens, prov: prov });
        RANKED.push({ uid: rec.user_id, display: rec.display, ens: ens, prov: prov });
      }
      RANKED.sort(function (a, b) {
        return (a.ens || Infinity) - (b.ens || Infinity) || a.uid - b.uid;
      });
    });
  }

  Promise.all([
    loadJsonl(DATA_BASE + 'latest_tjpr_full.jsonl'),
    fetch(DATA_BASE + 'data/overseas.json').then(function (r) { return r.json(); }),
    fetch(DATA_BASE + 'data/player_prefectures.json').then(function (r) { return r.json(); }),
    fetch(DISC_URL).then(function (r) { return r.json(); }),
    fetch(DATA_BASE + 'data/last_activity.json').then(function (r) { return r.json(); }),
    fetch(DATA_BASE + 'data/geo.json').then(function (r) { if (!r.ok) throw new Error('geo.json HTTP ' + r.status); return r.json(); }),
  ]).then(function (res) {
    PREF_ORDER = (res[5].units || []).map(function (/** @type {SpspGeoUnit} */ u) { return u.id; });
    (res[1].uids || []).forEach(function (/** @type {number} */ u) { OVERSEAS.add(u); });
    PREF = res[2] || {};
    DISC = res[3] || {};
    Object.keys(DISC).forEach(function (k) { DISC2UID[DISC[k].toLowerCase()] = parseInt(k, 10); });
    LAST = res[4] || {};
    var loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
    var card = document.getElementById('card');
    if (card) card.style.display = '';
    setup();
    recompute();
  }).catch(function (e) {
    var loading = document.getElementById('loading');
    if (loading) loading.textContent = i18n('common.load_failed', { message: e });
  });

  // ---- 選定ロジック ----
  function recompute() {
    var n = parseInt(inputEl('count').value.trim(), 10);
    var nValid = !isNaN(n) && n >= 0;
    if (!nValid) n = 0;
    var exclOverseas = inputEl('excl-overseas').checked;
    var exclProv = inputEl('excl-prov').checked;
    var recentOnly = inputEl('recent-only').checked;
    var recentK = parseInt(inputEl('recent-months').value.trim(), 10);
    var recentKValid = !isNaN(recentK) && recentK > 0;
    /** @type {string | null} */
    var recentCutoff = null;
    if (recentOnly && recentKValid) {
      // 最終参加日 (地域の暦日) と比べるので、しきい値も地域の暦日で作る (UTC の今日だと深夜に 1 日ずれる)。時差は region/config.js
      var cd = new Date(Date.now() + utcOffsetMs(SITE_UTC_OFFSET));
      cd.setUTCMonth(cd.getUTCMonth() - recentK);
      recentCutoff = cd.toISOString().slice(0, 10);
    }
    var prefSet = selPrefs.length ? new Set(selPrefs) : null;
    // 手動系 = 単体追加 + CSV 一括追加 (重複は単体追加を優先)
    var manualAll = manualUids.concat(csvUids.filter(function (u) { return manualUids.indexOf(u) < 0; }));
    var manualSet = new Set(manualAll);
    var removeSet = new Set(removeUids.concat(csvRemoveUids));
    var mode = /** @type {HTMLInputElement} */ (document.querySelector('input[name="manual-mode"]:checked')).value;

    var autoN = (mode === 'include') ? Math.max(0, n - manualAll.length) : n;
    /** @type {Row[]} */
    var auto = [];
    for (var i = 0; i < RANKED.length && auto.length < autoN; i++) {
      var p = RANKED[i];
      if (p.ens === null) break;                    // 総合順位なしは自動取得の対象外
      if (manualSet.has(p.uid)) continue;           // 手動分と重複させない
      if (removeSet.has(p.uid)) continue;           // 手動除去
      if (exclOverseas && OVERSEAS.has(p.uid)) continue;
      if (exclProv && p.prov) continue;
      if (recentCutoff && !(LAST[String(p.uid)] >= recentCutoff)) continue;
      if (!DISC[String(p.uid)]) continue;            // disc 不明 (≒退会) は自動選定の対象外
      if (prefSet && !prefSet.has(PREF[String(p.uid)])) continue;
      auto.push({ uid: p.uid, display: p.display, ens: p.ens, prov: p.prov });
    }
    /** @type {Row[]} */
    var manual = manualAll.map(function (uid, i) {
      var m = MASTER.get(uid) || { display: 'uid:' + uid, ens: null, prov: undefined };
      var origin = /** @type {'manual' | 'csv'} */ (manualUids.indexOf(uid) >= 0 ? 'manual' : 'csv');
      return { uid: uid, display: m.display, ens: m.ens, prov: m.prov, origin: origin, ord: i };
    });
    var rows = manual.concat(auto);
    rows.sort(function (a, b) {
      return (a.ens || Infinity) - (b.ens || Infinity) || (a.ord || 0) - (b.ord || 0) || a.uid - b.uid;
    });
    currentRows = rows;

    // プレビュー描画
    var nManual = manual.filter(function (r) { return r.origin === 'manual'; }).length;
    var nCsv = manual.length - nManual;
    var note = i18n('priority.note', { n: rows.length, manual: nManual, csv: nCsv, auto: auto.length });
    /** @type {string[]} */
    var warns = [];
    if (!nValid) warns.push(i18n('priority.warn.count_nan'));
    if (recentOnly && !recentKValid) warns.push(i18n('priority.warn.recent_nan'));
    if (auto.length < autoN) warns.push(i18n('priority.warn.short', { found: auto.length, want: autoN }));
    if (warns.length) note += ' <span class="warn">⚠ ' + warns.map(esc).join(' / ') + '</span>';
    var previewNote = document.getElementById('preview-note');
    if (previewNote) previewNote.innerHTML = note;

    var ptbody = document.getElementById('ptbody');
    if (ptbody) ptbody.innerHTML = rows.map(function (r, idx) {
      var disc = DISC[String(r.uid)];
      return '<tr>' +
        '<td class="col-no">' + (idx + 1) + '</td>' +
        '<td class="col-rank">' + (r.ens ? '#' + r.ens : '—') + '</td>' +
        // @ts-ignore SPSP.langRoot は string | undefined だが、この呼び出しの字面は tests/meta/priority_page.test.cjs が固定している
        '<td><a href="' + SPSPLinks.playerHref(SPSP.langRoot, r.uid) + '" target="_blank" rel="noopener" ' +
          'style="color:inherit;text-decoration:none">' + esc(r.display) + '</a>' +
          (OVERSEAS.has(r.uid) ? '<span class="ovs-badge">' + i18n('table.overseas') + '</span>' : '') +
          (r.prov ? '<span class="prov-badge">' + i18n('table.provisional') + '</span>' : '') +
          (r.origin === 'manual' ? '<span class="manual-badge">' + i18n('priority.badge.manual') + '</span>'
            : r.origin === 'csv' ? '<span class="csv-badge">CSV</span>' : '') + '</td>' +
        '<td class="col-disc' + (disc ? '' : ' nodisc') + '">' + (disc ? esc(disc) : '—') + '</td>' +
        '</tr>';
    }).join('');
    inputEl('dl-btn').disabled = !rows.length;
  }

  // ---- CSV ----
  /** @param {any} s @returns {string} */
  function csvField(s) {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // テンプレートの記入例 (実在しない disc = 先頭7桁が 0)。読み込み時は無視し警告する。
  // 出力は ASCII 名にする: Shift_JIS 前提で CSV を開くアプリ (Excel for Mac 等) でも
  // 化けないため。判定側は旧テンプレの日本語名も引き続き例として扱う。
  var TPL_OUT_NAMES = ['Taro Yamada', 'Hanako Suzuki'];
  var TPL_NAMES = TPL_OUT_NAMES.concat(['山田太郎', '鈴木花子']);
  /** @param {string | null | undefined} disc */
  function isTemplateDisc(disc) { return !!disc && /^0{7}[0-9a-f]$/i.test(disc); }
  /** @param {string[]} row @param {string | null} disc */
  function isTemplateSampleRow(row, disc) {
    if (isTemplateDisc(disc)) return true;
    return (row || []).some(function (c) { return TPL_NAMES.indexOf(String(c || '').trim()) >= 0; });
  }
  /** @param {string} text @param {string} filename */
  function downloadBlob(text, filename) {
    var blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
  // name は照合に使わない (discriminator のみ)。2 行目で name 空欄可を示す。
  function downloadTemplate() {
    downloadBlob('name,discriminator\r\n'
      + TPL_OUT_NAMES[0] + ',="00000000"\r\n'
      + ',="00000001"\r\n',
      'priority_template.csv');
  }
  function downloadCsv() {
    var lines = ['name,discriminator'];
    currentRows.forEach(function (r) {
      // disc は ="..." で書く: "600e0118" 等を Google Sheets / Excel が指数表記の
      // 数値 (6.00E+118) に化けさせるのを防ぐ (= 文字列を返す数式として読ませる)。
      var disc = DISC[String(r.uid)] || '';
      lines.push(csvField(r.display) + ',' + (disc ? '="' + disc + '"' : ''));
    });
    var d = new Date();
    var pad = function (/** @type {number} */ x) { return String(x).padStart(2, '0'); };
    downloadBlob(lines.join('\r\n') + '\r\n',
      'priority_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.csv');
  }

  // ---- チップ描画 ----
  function renderPrefChips() {
    var prefChips = document.getElementById('pref-chips');
    if (!prefChips) return;
    prefChips.innerHTML = selPrefs.map(function (p, i) {
      return '<span class="chip">' + esc(p) + '<span class="x" data-i="' + i + '">×</span></span>';
    }).join('');
  }
  // ---- CSV 一括追加 ----
  /** @param {string} text @returns {string[][]} */
  function parseCsv(text) {
    /** @type {string[][]} */
    var rows = [];
    /** @type {string[]} */
    var row = [];
    var cell = '', inQ = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { inQ = false; }
        } else { cell += ch; }
      } else if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else { cell += ch; }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (c) { return c.trim() !== ''; });
    });
  }

  // セル値 -> discriminator (無効なら null)。プレーンな "600e0118" のほか、
  // 本ページ出力の ="600e0118" (パース後は =600e0118) も受け付ける。
  /** @param {unknown} v @returns {string | null} */
  function cellDisc(v) {
    var m = String(v || '').trim().match(/^=?"?([0-9a-f]{8})"?$/i);
    return m ? m[1] : null;
  }

  /** @param {string[][]} rows @returns {{ col: number, start: number } | null} */
  function findDiscColumn(rows) {
    // ① ヘッダ行に discriminator らしき列名 (表記揺れ・大文字小文字無視。
    //    "discord" 等の誤爆を避けるため discriminator / disc 単独のみ)
    if (rows.length) {
      for (var c = 0; c < rows[0].length; c++) {
        var h = (rows[0][c] || '').trim();
        if (/discriminator/i.test(h) || /^disc$/i.test(h)) return { col: c, start: 1 };
      }
    }
    // ② 列名なし: 各列の hex8 マッチ数を数えて最多の列を採用 (ヘッダ行は自然に弾かれる)
    /** @type {{ col: number, start: number } | null} */
    var best = null;
    var bestCount = 0;
    var width = 0;
    rows.forEach(function (r) { if (r.length > width) width = r.length; });
    for (var c2 = 0; c2 < width; c2++) {
      var cnt = 0;
      rows.forEach(function (r) { if (cellDisc(r[c2])) cnt++; });
      if (cnt > bestCount) { bestCount = cnt; best = { col: c2, start: 0 }; }
    }
    return best;
  }

  // target: {list, unknown, noteId, skip()} — 追加用と除去用で共通。
  // clear で参照ごと差し替えないよう list/unknown は in-place で操作する。
  /** @param {string} text @param {CsvTarget} target */
  function importCsv(text, target) {
    var rows = parseCsv(text);
    var found = findDiscColumn(rows);
    if (!found) {
      var noteEl = document.getElementById(target.noteId);
      if (noteEl) noteEl.innerHTML =
        '<span style="color:#b45309">' + i18n('priority.csv.no_disc_col') + '</span>';
      return;
    }
    var added = 0, dup = 0, sample = 0;
    for (var i = found.start; i < rows.length; i++) {
      var v = cellDisc(rows[i][found.col]);
      if (!v) continue;
      // テンプレートの記入例が残っている行は無視 (警告は下の note に出す)。
      if (isTemplateSampleRow(rows[i], v)) { sample++; continue; }
      var uid = DISC2UID[v.toLowerCase()];
      if (uid === undefined) {
        if (target.unknown.indexOf(v) < 0) target.unknown.push(v);
        continue;
      }
      if (target.list.indexOf(uid) >= 0 || target.skip().indexOf(uid) >= 0) { dup++; continue; }
      target.list.push(uid);
      added++;
    }
    renderCsvNote(target, i18n('priority.csv.added', { n: added }) + (dup ? ' ' + i18n('priority.csv.dup', { n: dup }) : '') +
      (sample ? ' <span style="color:#b45309">' + i18n('priority.csv.sample_ignored', { n: sample }) + '</span>' : ''));
    recompute();
  }

  /** @param {CsvTarget} target @param {string} [extra] */
  function renderCsvNote(target, extra) {
    var note = /** @type {HTMLElement} */ (document.getElementById(target.noteId));
    if (!target.list.length && !target.unknown.length) { note.innerHTML = ''; return; }
    var parts = [i18n('priority.csv.total', { n: target.list.length })];
    if (extra) parts.push(extra);
    if (target.unknown.length) {
      parts.push('<span style="color:#b45309">' + i18n('priority.csv.unmatched', { n: target.unknown.length }) + ' (' +
        esc(target.unknown.slice(0, 3).join(', ')) + (target.unknown.length > 3 ? ' …' : '') + ')</span>');
    }
    note.innerHTML = parts.join(' · ') + '<span class="clear">' + i18n('priority.csv.clear') + '</span>';
    var clearBtn = note.querySelector('.clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      target.list.length = 0;
      target.unknown.length = 0;
      note.innerHTML = '';
      recompute();
    });
  }

  // 同一人物が複数リストに入らないよう、他リスト所属は重複スキップ扱いにする
  /** @type {CsvTarget} */
  var CSV_ADD = { list: csvUids, unknown: csvUnknown, noteId: 'csv-note',
                  skip: function () { return manualUids.concat(removeUids, csvRemoveUids); } };
  /** @type {CsvTarget} */
  var CSV_REM = { list: csvRemoveUids, unknown: csvRemoveUnknown, noteId: 'csv-rem-note',
                  skip: function () { return manualUids.concat(removeUids, csvUids); } };

  // 手動追加 / 手動除去 共通のプレイヤーピッカー (名前 / discriminator / uid で検索)
  /** @param {string} inputId @param {string} sugId @param {string} chipsId @param {number[]} arr @param {number[]} otherArr */
  function setupPlayerPicker(inputId, sugId, chipsId, arr, otherArr) {
    var input = inputEl(inputId);
    var sug = /** @type {HTMLElement} */ (document.getElementById(sugId));
    var chips = /** @type {HTMLElement} */ (document.getElementById(chipsId));
    function renderChips() {
      chips.innerHTML = arr.map(function (uid, i) {
        var m = MASTER.get(uid);
        return '<span class="chip">' + esc(m ? m.display : 'uid:' + uid) +
          '<span class="x" data-i="' + i + '">×</span></span>';
      }).join('');
    }
    function renderSug() {
      var q = input.value.trim().toLowerCase();
      if (!q) { sug.classList.remove('open'); return; }
      /** @type {Player[]} */
      var hits = [];
      for (var i = 0; i < RANKED.length && hits.length < 20; i++) {
        var p = RANKED[i];
        if (arr.indexOf(p.uid) >= 0 || otherArr.indexOf(p.uid) >= 0 ||
            csvUids.indexOf(p.uid) >= 0 || csvRemoveUids.indexOf(p.uid) >= 0) continue;
        var disc = DISC[String(p.uid)] || '';
        if (p.display.toLowerCase().indexOf(q) >= 0 ||
            disc.toLowerCase().indexOf(q) >= 0 ||
            String(p.uid) === q) {
          hits.push(p);
        }
      }
      sug.innerHTML = hits.map(function (p) {
        var disc = DISC[String(p.uid)];
        return '<div class="item" data-v="' + esc(p.uid) + '"><span>' + esc(p.display) + '</span>' +
          '<span class="meta">' + (p.ens ? '#' + p.ens + ' · ' : '') + (disc ? esc(disc) : i18n('priority.disc_unknown')) + '</span></div>';
      }).join('') || '<div class="item"><span class="meta">' + i18n('common.none') + '</span></div>';
      sug.classList.add('open');
    }
    /** @param {HTMLElement} item */
    function pick(item) {
      if (!item.dataset.v) return;
      arr.push(parseInt(item.dataset.v, 10));
      input.value = '';
      sug.classList.remove('open');
      renderChips();
      recompute();
    }
    input.addEventListener('input', renderSug);
    sug.addEventListener('click', function (e) {
      var item = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.item') : null);
      if (item) pick(item);
    });
    attachSuggestNav(input, sug, pick);
    chips.addEventListener('click', function (e) {
      var x = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.x') : null);
      if (!x) return;
      arr.splice(parseInt(/** @type {string} */ (x.dataset.i), 10), 1);
      renderChips();
      recompute();
    });
  }

  // ---- UI 配線 ----
  function setup() {
    inputEl('count').addEventListener('input', recompute);
    inputEl('excl-overseas').addEventListener('change', recompute);
    inputEl('excl-prov').addEventListener('change', recompute);
    inputEl('recent-only').addEventListener('change', recompute);
    inputEl('recent-months').addEventListener('input', recompute);
    document.querySelectorAll('input[name="manual-mode"]').forEach(function (r) {
      r.addEventListener('change', recompute);
    });
    inputEl('dl-btn').addEventListener('click', downloadCsv);
    inputEl('csv-tpl-btn').addEventListener('click', downloadTemplate);
    inputEl('csv-rem-tpl-btn').addEventListener('click', downloadTemplate);

    // 都道府県サジェスト
    var pin = inputEl('pref-input');
    var psug = /** @type {HTMLElement} */ (document.getElementById('pref-suggest'));
    var prefChips = /** @type {HTMLElement} */ (document.getElementById('pref-chips'));
    function renderPrefSug() {
      var q = pin.value.trim();
      var hits = PREF_ORDER.filter(function (p) {
        return selPrefs.indexOf(p) < 0 && (!q || p.indexOf(q) >= 0);
      });
      psug.innerHTML = hits.map(function (p) {
        return '<div class="item" data-v="' + esc(p) + '"><span>' + esc(p) + '</span></div>';
      }).join('') || '<div class="item"><span class="meta">' + i18n('common.none') + '</span></div>';
      psug.classList.add('open');
    }
    /** @param {HTMLElement} item */
    function pickPref(item) {
      if (!item.dataset.v) return;
      selPrefs.push(item.dataset.v);
      pin.value = '';
      psug.classList.remove('open');
      renderPrefChips();
      recompute();
    }
    pin.addEventListener('focus', renderPrefSug);
    pin.addEventListener('input', renderPrefSug);
    psug.addEventListener('click', function (e) {
      var item = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.item') : null);
      if (item) pickPref(item);
    });
    attachSuggestNav(pin, psug, pickPref);
    prefChips.addEventListener('click', function (e) {
      var x = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.x') : null);
      if (!x) return;
      selPrefs.splice(parseInt(/** @type {string} */ (x.dataset.i), 10), 1);
      renderPrefChips();
      recompute();
    });

    // 手動追加 / 手動除去 (お互い・CSV 追加済みの人はサジェストに出さない)
    setupPlayerPicker('padd-input', 'padd-suggest', 'padd-chips', manualUids, removeUids);
    setupPlayerPicker('prem-input', 'prem-suggest', 'prem-chips', removeUids, manualUids);

    // CSV 一括追加 / 一括除去
    /** @type {[string, CsvTarget][]} */
    var csvPairs = [['csv-file', CSV_ADD], ['csv-rem-file', CSV_REM]];
    csvPairs.forEach(function (pair) {
      inputEl(pair[0]).addEventListener('change', function (e) {
        var fileInput = /** @type {HTMLInputElement} */ (e.target);
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () { importCsv(String(reader.result), pair[1]); };
        reader.readAsText(f);
        fileInput.value = '';   // 同じファイルの再選択でも change が発火するように
      });
    });
  }
})();
