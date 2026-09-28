// @ts-check
// seeding/app/80_csv_source.js — SPSP シードツール本体の一部: csv モード: 基準順位ソース (CSV / Google Sheets)。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { SEED_APP_CONFIG, i18n } from './10_skeleton.js';
import { DATA, _csvNormDisc, _disc2uid, canonicalUserId, ensureTable, loadMasterData, manualMovedSet, renderManualUI, saveManual } from './30_core.js';
import { filterAndRerank, render, setParticipantsUiVisible } from './40_startgg.js';
import { dropAppliedOrder, resetSeedOptResultPanel } from './75_series_rematch.js';
import { _applyCsvSettingColumns } from './90_spec.js';
import SmashSeed from '../../seed-upload/seed_uploader.js';
'use strict';

// ── csv モード: 基準順位ソース (CSV / Google Sheets) ─────────────────────────
// 読み込んだ行を参加者 (DATA) と照合し、その順序を手動調整の base として取り込む。
// 以降は spsp モードと完全に同じ (手動調整で微修正 → 被り回避 → CSV / start.gg 適用)。

/** @param {Record<string, unknown>} row @param {string[]} names @returns {string | null} */
export function _csvPick(row, names) {
  for (const k of Object.keys(row)) {
    if (names.includes(String(k).trim().toLowerCase())) {
      const v = row[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return null;
}
/** @param {unknown} s @returns {string} */
function _csvNormName(s) {
  const t = String(s).trim().toLowerCase();
  const i = t.lastIndexOf('|');           // チームタグ (zeta | あcola) は最後の | 以降を本体とみなす
  return i >= 0 ? t.slice(i + 1).trim() : t;
}
// seed/順位系の列があれば昇順、無ければ行順に並べた行リスト。
function _csvSortedRows(rows) {
  const numOf = (row) => {
    const v = _csvPick(row, CSV_SEAT_COLS);
    const n = v != null ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const withNum = rows.map((row, i) => ({ row, i, n: numOf(row) }));
  if (withNum.every(x => x.n != null)) withNum.sort((a, b) => a.n - b.n || a.i - b.i);
  return withNum.map(x => x.row);
}

// CSV 列名 (小文字比較)。csv モードの基準 CSV と 📌シード指定 CSV で共通。
const CSV_NAME_COLS = ['player', 'name', 'display', 'tag', 'プレイヤー', '名前'];   // CSV の列名 alias (日本語も受ける。機械可読なので辞書には出さない)
export const CSV_SEAT_COLS = ['seednum', 'seed_num', 'seed', 'phaseseed', 'phase_seed', '順位', 'シード'];
const CSV_DISC_COLS = ['discriminator', 'disc'];
// テンプレートの記入例 (実在しない disc = 先頭7桁が 0)。読み込み時は無視し警告を出す。
// 出力は ASCII 名にする: Shift_JIS 前提で CSV を開くアプリ (Excel for Mac 等) でも
// 化けないため。判定側は旧テンプレの日本語名も引き続き例として扱う。
export const CSV_TPL_OUT_NAMES = ['Taro Yamada', 'Hanako Suzuki'];
const CSV_TPL_NAMES = CSV_TPL_OUT_NAMES.concat(['山田太郎', '鈴木花子']);
/** @param {Record<string, unknown>} row @returns {boolean} */
export function isCsvTemplateSample(row) {
  const nm = _csvPick(row, CSV_NAME_COLS);
  if (nm != null && CSV_TPL_NAMES.indexOf(String(nm).trim()) >= 0) return true;
  const d = _csvPick(row, CSV_DISC_COLS);
  return d != null && /^0{7}[0-9a-f]$/i.test(_csvNormDisc(d));
}
// CSV テンプレートをダウンロードする (BOM 付き UTF-8 = Excel で文字化けしない)。
/** @param {(string | number)[]} lines @param {string} filename */
export function downloadCsvTemplate(lines, filename) {
  const blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// DATA から CSV 照合用の索引を作る (uid / seedId / 正規化名)。uid null 行は uid 照合不可。
// 正規化名 (タグ省略) が複数参加者に重なる名前は dupNames に載せ、名前照合ではエラー扱いにする
// (黙って先勝ちの1人に照合すると別人にシードを付けかねないため)。
export function _csvRecLookups() {
  const byUid = new Map(DATA.filter(r => r.user_id != null).map(r => [r.user_id, r]));
  const bySeedId = new Map(DATA.filter(r => r.seedId != null).map(r => [String(r.seedId), r]));
  const byName = new Map();
  const dupNames = new Set();
  for (const r of DATA) {
    const n = _csvNormName(r.display || '');
    if (!n) continue;
    if (byName.has(n)) dupNames.add(n);
    else byName.set(n, r);
  }
  // discriminator → rec (disc は一意)。第一ソースは参加者データそのもの
  // (start.gg user.discriminator = rec.discriminator。DB 未登録の参加者も照合できる)。
  // rec に disc が無いとき (CSV 単独リスト構築など) は discriminators.json で補完。
  // どちらのソースも無いときだけ null (= disc 列があれば discUnavailable エラー)。
  let hasOwnDisc = false;
  const byDisc = new Map();
  for (const r of DATA) {
    if (r.user_id == null) continue;
    let d = r.discriminator || null;
    if (d) hasOwnDisc = true;
    else if (S.DISCRIMINATORS) d = S.DISCRIMINATORS[String(r.user_id)] || null;
    if (d) byDisc.set(String(d).toLowerCase(), r);
  }
  return { byUid, bySeedId, byName, dupNames,
           byDisc: (hasOwnDisc || S.DISCRIMINATORS) ? byDisc : null };
}
// CSV 1 行 → {rec, ambiguousName, discUnavailable}。
// 優先: uid 列 → discriminator 列 → seedId 列 → 名前列 (タグ省略照合)。
//   rec = 照合できた参加者 (不可なら null)。
//   ambiguousName = 名前照合で同名の参加者が複数いた場合にその名前 (呼び出し側でエラーにする)。
//   discUnavailable = discriminator 列があるのに discriminators.json が無くて照合不能
//                     (呼び出し側でエラーにする。黙って名前照合等に劣化させない)。
export function _csvMatchRow(row, lk) {
  const uid = _csvPick(row, ['uid', 'user_id', 'userid']);
  if (uid != null) {
    const rec = lk.byUid.get(canonicalUserId(Number(uid))) || lk.byUid.get(Number(uid)) || null;
    if (rec) return { rec, ambiguousName: null };
  }
  const dv = _csvPick(row, CSV_DISC_COLS);
  if (dv != null) {
    if (!lk.byDisc) return { rec: null, ambiguousName: null, discUnavailable: true };
    const rec = lk.byDisc.get(_csvNormDisc(dv)) || null;
    if (rec) return { rec, ambiguousName: null };
  }
  const sid = _csvPick(row, ['seedid', 'seed_id', 'sid']);
  if (sid != null) {
    const rec = lk.bySeedId.get(String(parseInt(sid, 10))) || lk.bySeedId.get(sid) || null;
    if (rec) return { rec, ambiguousName: null };
  }
  const nm = _csvPick(row, CSV_NAME_COLS);
  if (nm != null) {
    const n = _csvNormName(nm);
    if (lk.dupNames.has(n)) return { rec: null, ambiguousName: nm };
    return { rec: lk.byName.get(n) || null, ambiguousName: null };
  }
  return { rec: null, ambiguousName: null };
}
/** @param {Record<string, unknown>} row @returns {string} */
export function _csvRowLabel(row) {
  return _csvPick(row, CSV_NAME_COLS.concat(['uid', 'user_id', 'seedid'])) || i18n('seed.csv.s7');
}

// CSV 行列 → 参加者 uid 順序。優先: uid 列 → seedId 列 → 名前列 (タグ省略照合)。
function csvRowsToOrder(rows) {
  const lk = _csvRecLookups();
  const order = [];
  const used = new Set();
  const unmatched = [];
  const ambiguous = [];   // 名前照合で複数参加者に該当した名前 (エラー扱い、適用しない)
  let discUnavailable = false;   // disc 列があるのに discriminators.json 無し (エラー扱い)
  let sampleRows = 0;            // テンプレートの記入例が残っていた行 (無視 + 警告)
  for (const row of _csvSortedRows(rows)) {
    if (isCsvTemplateSample(row)) { sampleRows++; continue; }
    const m = _csvMatchRow(row, lk);
    if (m.discUnavailable) { discUnavailable = true; continue; }
    if (m.ambiguousName != null) { ambiguous.push(m.ambiguousName); continue; }
    const rec = m.rec;
    if (rec && !used.has(rec.user_id)) { order.push(rec.user_id); used.add(rec.user_id); }
    else if (!rec) unmatched.push(_csvRowLabel(row));
  }
  // CSV に無い参加者は現在の SPSP 順位順で末尾に。
  const rest = DATA.slice()
    .sort((a, b) => (a.ranks[S.currentMethod] || 1e9) - (b.ranks[S.currentMethod] || 1e9))
    .map(r => r.user_id).filter(u => !used.has(u));
  return { order: order.concat(rest), matched: order.length, unmatched, ambiguous, discUnavailable,
           sampleRows, restCount: rest.length };
}
/** @param {string} msg @param {boolean} [isErr] */
function _csvStatus(msg, isErr) {
  const el = document.getElementById('csv-src-status');
  if (el) { el.textContent = msg; el.style.color = isErr ? '#dc2626' : '#374151'; }
}
// 参加者取得済みなら CSV 順を基準 (手動調整の base) に反映する。
// fromFetch=true (取得直後の自動適用) では復元済みの手動調整を上書きしない。
/** @param {boolean} fromFetch */
export function applyCsvOrderIfReady(fromFetch) {
  if (SEED_APP_CONFIG.mode !== 'csv' || !S.CSV_SOURCE || !DATA.length) return;
  if (fromFetch && S.MANUAL) {
    _csvStatus(i18n('seed.csv.s8'));
    return;
  }
  if (!fromFetch && S.MANUAL && manualMovedSet().size > 0 &&
      !confirm(i18n('seed.csv.s9'))) return;
  const { order, matched, unmatched, ambiguous, discUnavailable, sampleRows, restCount } = csvRowsToOrder(S.CSV_SOURCE.rows);
  if (discUnavailable) {
    _csvStatus(`${i18n('seed.csv.t1')}` +
      `${S.DISC_LOAD_ERROR ? ` (${S.DISC_LOAD_ERROR})` : ''}${i18n('seed.csv.t2')}`, true);
    return;
  }
  if (ambiguous.length) {
    _csvStatus(`${i18n('seed.csv.t3')} ${[...new Set(ambiguous)].slice(0, 5).join(', ')}${ambiguous.length > 5 ? ' …' : ''}` +
      i18n('seed.csv.s10'), true);
    return;
  }
  if (!matched) { _csvStatus(i18n('seed.csv.s11'), true); return; }
  S.MANUAL = { base: order, ops: [], hpos: 0, committed: true, editing: false, sel: null, src: 'csv' };
  // 後から読み込んだ CSV が最新の作業なので、適用済みの被り回避結果は解除する
  // (これをしないと CSV 順が出力に反映されない)。
  dropAppliedOrder();
  if (S.SEEDOPT_RESULT) resetSeedOptResultPanel(i18n('seed.csv.s12'));
  saveManual(); renderManualUI();
  const settingNotes = _applyCsvSettingColumns(S.CSV_SOURCE.rows);
  let msg = `✅ ${S.CSV_SOURCE.label}: ${matched}${i18n('seed.csv.t4')}`;
  if (restCount) msg += ` ${i18n('seed.csv.t5')} ${restCount}${i18n('seed.csv.t6')}`;
  if (settingNotes.length) msg += ` ${i18n('seed.csv.t7')}${settingNotes.join('・')})`;
  if (sampleRows) msg += ` ${i18n('seed.csv.t8')} ${sampleRows}${i18n('seed.csv.t9')}`;
  if (unmatched.length) msg += ` ${i18n('seed.csv.t10')} ${unmatched.length}${i18n('seed.csv.t11')} ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ' …' : ''}`;
  _csvStatus(msg, false);
  const st = document.getElementById('status');
  if (st) st.textContent = i18n('seed.csv.s13');
}
// csv モード: start.gg 未取得でも CSV の行だけで参加者リストを構築して表示する。
// uid 列 → SPSP マスター直引き、名前列 → マスター全体との正規化名照合 (曖昧名 =
// 複数 uid に当たる名前は使わない)。どちらも照合できない行は DB 不在扱いで末尾。
// start.gg への適用は後からイベントを取得すれば可能 (CSV は自動で再適用される)。
/** @type {Map<string, number | null> | null} */
let _MASTER_NAME_IDX = null;   // normName → uid (曖昧名は null)
function _masterNameIdx() {
  if (_MASTER_NAME_IDX) return _MASTER_NAME_IDX;
  /** @type {Map<string, number | null>} */
  const idx = new Map();
  if (!S.MASTER_MAP) return idx;   // loadMasterData 後にしか呼ばれない
  for (const [uid, rec] of S.MASTER_MAP.entries()) {
    const n = _csvNormName(rec.display || '');
    if (!n) continue;
    idx.set(n, idx.has(n) ? null : uid);   // 2回目以降 = 曖昧 → null
  }
  _MASTER_NAME_IDX = idx;
  return idx;
}
async function buildParticipantsFromCsv() {
  const status = document.getElementById('status');
  await loadMasterData();
  const MASTER = S.MASTER_MAP, CSV = S.CSV_SOURCE;   // 閉包 (forEach) の中でも null でない型に
  if (!MASTER || !CSV) return;
  // discriminator 列があるのに照合データが無い場合は fail-loud (黙って名前照合に劣化させない)。
  if (!S.DISCRIMINATORS && CSV.rows.some(row => _csvPick(row, CSV_DISC_COLS) != null)) {
    if (status) status.textContent = i18n('seed.csv.s14') +
      `${i18n('seed.csv.t12')}${S.DISC_LOAD_ERROR ? ` (${S.DISC_LOAD_ERROR})` : ''}。`;
    return;
  }
  const nameIdx = _masterNameIdx();
  const seedInfos = [];
  const seen = new Set();
  let sampleRows = 0;   // テンプレートの記入例が残っていた行 (無視 + 警告)
  let synth = 0;   // uid 不明行用の合成 id (負数・重複防止)
  _csvSortedRows(CSV.rows).forEach((row, i) => {
    if (isCsvTemplateSample(row)) { sampleRows++; return; }
    /** @type {number | null} */
    let userId = null;
    const uidV = _csvPick(row, ['uid', 'user_id', 'userid']);
    if (uidV != null) {
      const u = canonicalUserId(Number(uidV));
      if (u != null && MASTER.has(u)) userId = u;
    }
    if (userId == null) {
      const dV = _csvPick(row, CSV_DISC_COLS);
      if (dV != null && S.DISCRIMINATORS) {
        const u = /** @type {Map<string, number>} */ (_disc2uid()).get(_csvNormDisc(dV));   // DISCRIMINATORS があれば索引も作られる
        const cu = u != null ? canonicalUserId(u) : null;
        if (cu != null && MASTER.has(cu)) userId = cu;
      }
    }
    const nameV = _csvPick(row, ['player', 'name', 'display', 'tag', 'プレイヤー', '名前']);
    if (userId == null && nameV != null) {
      const u = nameIdx.get(_csvNormName(nameV));
      if (u != null) userId = u;
    }
    if (userId != null && seen.has(userId)) return;   // 重複行はスキップ
    if (userId != null) seen.add(userId);
    if (userId == null) { synth -= 1; userId = synth; }
    const sidV = _csvPick(row, ['seedid', 'seed_id', 'sid']);
    seedInfos.push({
      userId,
      display: nameV || (userId > 0 && MASTER.has(userId) ? /** @type {SpspRankRecord} */ (MASTER.get(userId)).display : `uid:${uidV || '?'}`),
      seedId: sidV != null ? sidV : null,
      originalSeed: i + 1,
      entrantId: null,
    });
  });
  const { records, rankedCount, missingCount } = filterAndRerank(seedInfos);
  // 表示名は CSV の名前を優先 (このツールの役割は「読み込んだものを出す」)。
  const csvNameByUid = new Map(seedInfos.filter(si => si.display != null).map(si => [si.userId, si.display]));
  for (const r of records) {
    const nm = csvNameByUid.get(r.user_id);
    if (nm) r.display = nm;
  }
  S.EVENT_CONTEXT = null;
  dropAppliedOrder({ render: false });
  S.MANUAL = null;
  S.SEED_SPEC = null;
  DATA.length = 0;
  for (const r of records) DATA.push(r);
  const metaInfo = document.getElementById('meta-info');
  if (metaInfo) metaInfo.textContent = `${CSV.label} ${i18n('seed.csv.t13')}`;
  if (status) status.textContent =
    `${i18n('seed.csv.t14')} ${records.length} ${i18n('seed.csv.t15')} ${rankedCount} ${i18n('seed.csv.t16')} ${missingCount} ${i18n('seed.csv.t17')}` +
    (sampleRows ? ` ${i18n('seed.csv.t8')} ${sampleRows}${i18n('seed.csv.t9')}` : '') +
    ` ${i18n('seed.csv.t18')}`;
  const csvBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('csv-btn'));
  if (csvBtn) csvBtn.disabled = false;
  // 適用は可能 (押した時に大会 URL から seedId を自動取得する)。
  const uploadBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upload-btn'));
  if (uploadBtn) uploadBtn.disabled = false;
  setParticipantsUiVisible(true);
  const tbl = ensureTable();
  tbl.setSort('rank', 'asc');
  render();
  applyCsvOrderIfReady(false);
}

async function loadCsvSource() {
  try {
    const fileEl = /** @type {HTMLInputElement | null} */ (document.getElementById('csv-src-file'));
    const url = (/** @type {HTMLInputElement} */ (document.getElementById('csv-src-url')).value || '').trim();   // 10_skeleton.js が csv モードで必ず置く
    let text, label;
    if (fileEl && fileEl.files && fileEl.files.length) {
      text = await SmashSeed.readCsvFile(fileEl.files[0]);
      label = fileEl.files[0].name;
    } else if (url) {
      const sheets = SmashSeed.getSheetsCsvUrl(url);
      if (sheets) {
        text = await SmashSeed.fetchSheetsCsv(url);
        label = 'Google Sheets';
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
        label = 'CSV URL';
      }
    } else {
      _csvStatus(i18n('seed.csv.s15'), true);
      return;
    }
    const parsed = SmashSeed.parseCsv(text);   // {rows, headers}
    const rows = parsed.rows || [];
    if (!rows.length) throw new Error(i18n('seed.csv.s16'));
    S.CSV_SOURCE = { rows, label };
    if (DATA.length) {
      applyCsvOrderIfReady(false);
    } else {
      // 参加者未取得でも CSV だけでリスト表示する (start.gg 適用は取得後)。
      _csvStatus(`📄 ${label}: ${rows.length}${i18n('seed.csv.t19')}`);
      await buildParticipantsFromCsv();
      _csvStatus(`✅ ${label}: ${rows.length}${i18n('seed.csv.t20')}`);
    }
  } catch (e0) {
    const e = /** @type {any} */ (e0);
    _csvStatus(i18n('seed.csv.s17') + (e && e.message ? e.message : e), true);
  }
}
if (SEED_APP_CONFIG.mode === 'csv') {
  const btn = document.getElementById('csv-src-load');
  if (btn) btn.addEventListener('click', loadCsvSource);
  const tpl = document.getElementById('csv-tpl');
  // seed は任意 (省略時は行順。2 行目が空欄可の例)。
  if (tpl) tpl.addEventListener('click', () => downloadCsvTemplate([
    'name,discriminator,seed',
    `${CSV_TPL_OUT_NAMES[0]},="00000000",1`,
    `${CSV_TPL_OUT_NAMES[1]},="00000001",`,
  ], 'spsp_seed_template.csv'));
}
