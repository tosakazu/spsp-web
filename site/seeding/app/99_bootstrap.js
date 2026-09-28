// @ts-check
// seeding/app/99_bootstrap.js — SPSP シードツール本体の一部: ページの起動 (トークン欄、シリーズ切替、最適化ボタン)。読み込み時に他ファイルの関数を呼ぶので最後。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { i18n, regionGroupToggleId, regionGroupToggles } from './10_skeleton.js';
import { injectHelpIcons } from './20_help.js';
import { cachedFetchers } from './70_players_cache.js';
import SeedData from '../seed_data.js';
import { downloadCsv, handleFetch, showError, uploadToStartgg } from './40_startgg.js';
import { UPCOMING_PAGE_SIZE, openUpcomingBox, renderUpcomingPage, toggleUpcomingBox } from './60_upcoming.js';
import { cancelSeedOptimize, cleanupSeedOptWorker, runSeedOptimize, seriesNoteEl, stopSeedOptimize, updateIntraToggleState, updateSeriesToggleState } from './75_series_rematch.js';
import SeedOptimizer from '../seed_optimizer.js';
import SPSPGeo from '../../js/geo.js';
'use strict';

// ── Seed page bootstrap ──
(function () {
  const tokenEl = /** @type {HTMLInputElement | null} */ (document.getElementById('token'));
  const hintEl = document.getElementById('token-hint');
  const revealBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('token-reveal'));
  const saveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('token-save'));
  const TOKEN_KEY = 'spsp_startgg_token';
  if (!tokenEl || !hintEl || !revealBtn || !saveBtn) return;   // 骨格 (10_skeleton.js) に必ずある

  function updateHint() {
    if (!tokenEl || !hintEl) return;   // 巻き上げられる関数宣言なので上の guard の絞り込みは効かない
    const v = tokenEl.value.trim();
    if (!v) { hintEl.textContent = ''; return; }
    const tail = v.slice(-4);
    hintEl.textContent = `${i18n('seed.boot.t1')} ${tail} (${v.length} ${i18n('seed.boot.t2')}`;
  }
  // Restore token: 💾 で保存した localStorage から (入力の都度の sessionStorage 保存はやめた)
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) { tokenEl.value = t; updateHint(); }
  } catch (e) {}
  tokenEl.addEventListener('input', () => { updateHint(); });
  revealBtn.addEventListener('click', () => {
    const isPwd = tokenEl.type === 'password';
    tokenEl.type = isPwd ? 'text' : 'password';
    revealBtn.textContent = isPwd ? '🙈' : '👁';
  });
  saveBtn.addEventListener('click', () => {
    const v = tokenEl.value.trim();
    if (!v) { hintEl.textContent = i18n('seed.boot.s1'); return; }
    try {
      localStorage.setItem(TOKEN_KEY, v);
      const orig = saveBtn.textContent;
      saveBtn.textContent = i18n('seed.boot.s2');
      saveBtn.disabled = true;
      setTimeout(() => { saveBtn.textContent = orig; saveBtn.disabled = false; }, 1500);
    } catch (e) { hintEl.textContent = i18n('seed.boot.s3') + /** @type {any} */ (e).message; }
  });

  const seedForm = document.getElementById('seed-form');
  if (seedForm) seedForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleFetch();
  });
  const csvBtn = document.getElementById('csv-btn');
  if (csvBtn) csvBtn.addEventListener('click', downloadCsv);
  // createPhaseThenUpload 等の throw を握りつぶさず status に出す
  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) uploadBtn.addEventListener('click', () => {
    uploadToStartgg().catch(e => showError(e.message, e.rawError));
  });
  // 被り回避最適化パネル
  const soRun = document.getElementById('so-run');
  if (soRun) soRun.addEventListener('click', () => {
    runSeedOptimize().catch(e => {
      const soProgress = document.getElementById('so-progress');
      if (soProgress) soProgress.textContent = '⚠ ' + e.message;
      cleanupSeedOptWorker();   // 途中 throw でも実行ボタンを必ず戻す
    });
  });
  const soStop = document.getElementById('so-stop');
  if (soStop) soStop.addEventListener('click', stopSeedOptimize);
  // @ts-expect-error -- 骨格 (10_skeleton.js) に必ずある。tests/seeding/bracket_page.test.cjs がこの行の字面を検査するので形を変えない
  document.getElementById('so-cancel').addEventListener('click', cancelSeedOptimize);
  const soMode = document.getElementById('so-mode');
  if (soMode) soMode.addEventListener('change', applyModeDefaults);
  const soOrderpow = /** @type {HTMLInputElement | null} */ (document.getElementById('so-orderpow'));
  if (soOrderpow) soOrderpow.addEventListener('input', () => {
    const soOrderpowVal = document.getElementById('so-orderpow-val');
    if (soOrderpowVal) soOrderpowVal.textContent = soOrderpow.value;
  });
  // プール数に応じて「プール内変動」トグルの有効/無効を切り替える（2プール以上のみ指定可能）。
  const soPools = document.getElementById('so-pools');
  if (soPools) soPools.addEventListener('input', updateIntraToggleState);
  // 同シリーズ再マッチ: ON にした時点で大会一覧をロードしてシリーズを判定する。
  const seriesCb = document.getElementById('so-avoid-series');
  if (seriesCb) seriesCb.addEventListener('change', () => {
    Promise.resolve(updateSeriesToggleState()).catch(() => {});
  });
  const seriesSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('so-series-select'));
  if (seriesSel) seriesSel.addEventListener('change', () => {
    S.SERIES_USER_PICKED = true;
    const note = seriesNoteEl();
    if (note) {
      note.innerHTML = seriesSel.value ? ''
        : `<span style="color:#b91c1c">${i18n('seed.boot.series_unselected')}</span>`;
    }
  });

  // ── 直近の大会ピッカー: イベント binding ──
  const upToggle = document.getElementById('upcoming-toggle');
  if (upToggle) upToggle.addEventListener('click', toggleUpcomingBox);
  const upPrev = document.getElementById('upcoming-prev');
  if (upPrev) upPrev.addEventListener('click', () => {
    if (S.UPCOMING_PAGE > 0) { S.UPCOMING_PAGE -= 1; renderUpcomingPage(); }
  });
  const upNext = document.getElementById('upcoming-next');
  if (upNext) upNext.addEventListener('click', () => {
    const total = (S.UPCOMING_DATA && S.UPCOMING_DATA.tournaments) ? S.UPCOMING_DATA.tournaments.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / UPCOMING_PAGE_SIZE));
    if (S.UPCOMING_PAGE < totalPages - 1) { S.UPCOMING_PAGE += 1; renderUpcomingPage(); }
  });
  // 開いた状態で起動するので初期 load を即実行
  const upcomingBox = document.getElementById('upcoming-box');
  if (upcomingBox && upcomingBox.classList.contains('open')) {
    openUpcomingBox();
  }
})();

// ───────────────────────── 被り回避最適化パネル ─────────────────────────

// データ取得後にパネルを初期化（プール数 / 形式を既定で埋める）。
export function soFormat() {
  // 形式は start.gg の bracketType から自動。取得できなければ DE 想定。
  const bt = S.EVENT_CONTEXT && S.EVENT_CONTEXT.bracketType;
  return (bt === 'SINGLE_ELIMINATION' || bt === 'ROUND_ROBIN') ? bt : 'DOUBLE_ELIMINATION';
}
// 探索モードに応じて多点数/SA冷却率の既定をミラー（optimizer の MODE_DEFAULTS と一致）。
export function applyModeDefaults() {
  const md = (SeedOptimizer && SeedOptimizer.MODE_DEFAULTS) || {};
  const modeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('so-mode'));
  if (!modeEl) return;
  const m = modeEl.value;
  const d = md[m] || {};
  const restartsEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-restarts'));
  if (d.restarts != null && restartsEl) restartsEl.value = d.restarts;
  const coolingEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-cooling'));
  if (d.saCooling != null && coolingEl) coolingEl.value = d.saCooling;
  const itersScaleEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-itersscale'));
  if (d.maxItersScale != null && itersScaleEl) itersScaleEl.value = d.maxItersScale;
}
// シードズレ上限の既定値 [±0, ±1, ±2, ±3, ±4, ±5 それぞれ「〜位まで」]。
// 上位 4 人は固定、以降は 8 / 16 / 32 / 64 / 128 位まで段階的に緩める (2026-09-14 から規模によらず同じ)。
// 大会規模より小さい段は実質効かないだけなので、規模別には分けない。
const SHIFT_LIMIT_PRESET = [4, 8, 16, 32, 64, 128];
/** @param {number} n @returns {number[] | null} */
function shiftPresetForSize(n) {
  if (!n) return null;
  return SHIFT_LIMIT_PRESET.slice();
}
// 既定を入れる。全欄が空、または「前回の自動プリセットのまま (手入力なし)」の
// ときだけ上書きする。ユーザーが1欄でも書き換えていたら触らない。
/** @type {string[] | null} */
let _lastShiftPrefill = null;   // 直近に自動で入れた値 (['4','8',…] 形式)
const SHIFT_LIMIT_IDS = ['so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5'];
/** @param {number} n */
export function prefillShiftLimits(n) {
  const els0 = SHIFT_LIMIT_IDS.map(id => document.getElementById(id));
  if (els0.some(e => !e)) return;
  const els = /** @type {HTMLInputElement[]} */ (els0);
  const cur = els.map(e => (e.value || '').trim());
  const last = _lastShiftPrefill;
  const untouched = cur.every(v => v === '') ||
    (last != null && cur.every((v, k) => v === last[k]));
  if (!untouched) return;
  const p = shiftPresetForSize(n);
  if (!p) return;
  const vals = p.map(v => (v != null ? String(v) : ''));
  els.forEach((e, k) => { e.value = vals[k]; });
  _lastShiftPrefill = vals;
}

// ───────────────────────── 被り回避パネルの設定の保存 (2026-09-14) ─────────────────────────
// チェック・ズレ上限・ズレ抑制・上級者向けパラメータ・「適用時に被り回避を自動実行」を
// このブラウザ (localStorage) に保存し、次回開いたときに戻す。
// 保存するのは「既定と違う項目」だけ (既定値を後で変えたとき、触っていない項目には新しい既定が効くように)。
// 大会ごとに自動で入る値 (プール数・ウェーブ数・対象シリーズ) は保存しない。
const SEEDOPT_SETTINGS_KEY = 'spsp_seedopt_settings_v1';
const SEEDOPT_SETTINGS_SKIP = new Set(['so-pools', 'so-waves', 'so-series-select']);
/** @type {Record<string, string | boolean> | null} */
let SEEDOPT_DEFAULTS = null;   // 起動時 (markup) の値 = 既定。シードズレ上限は SHIFT_LIMIT_PRESET。

/** 設定欄 (input / select。select も value と type しか読まないので input として扱う) @returns {HTMLInputElement[]} */
function seedOptSettingFields() {
  const panel = document.getElementById('seedopt-panel');
  const els = panel ? Array.from(/** @type {NodeListOf<HTMLInputElement>} */ (panel.querySelectorAll('input[id^="so-"], select[id^="so-"]'))) : [];
  const auto = /** @type {HTMLInputElement | null} */ (document.getElementById('so-auto-apply'));
  if (auto) els.push(auto);
  return els.filter((e) => !SEEDOPT_SETTINGS_SKIP.has(e.id));
}
/** @param {HTMLInputElement} el */
function seedOptFieldValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
/** @param {HTMLInputElement} el @param {unknown} v */
function setSeedOptFieldValue(el, v) {
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = (v == null) ? '' : String(v);
}
/** @returns {Record<string, string | boolean>} */
function snapshotSeedOptDefaults() {
  if (SEEDOPT_DEFAULTS) return SEEDOPT_DEFAULTS;
  /** @type {Record<string, string | boolean>} */
  const defs = {};
  SEEDOPT_DEFAULTS = defs;
  for (const el of seedOptSettingFields()) defs[el.id] = seedOptFieldValue(el);
  // ズレ上限の欄は markup では空で、大会を読むと既定 (SHIFT_LIMIT_PRESET) が入る。既定はそちら。
  SHIFT_LIMIT_IDS.forEach((id, k) => { if (id in defs) defs[id] = String(SHIFT_LIMIT_PRESET[k]); });
  return defs;
}
function loadSeedOptSettings() {
  try {
    const raw = localStorage.getItem(SEEDOPT_SETTINGS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) { return null; }
}
/** 今の欄の値のうち既定と違うものを保存する。戻り値 = 保存した差分。 */
function saveSeedOptSettings() {
  const defs = snapshotSeedOptDefaults();
  /** @type {Record<string, string | boolean>} */
  const diff = {};
  for (const el of seedOptSettingFields()) {
    const v = seedOptFieldValue(el);
    // ズレ上限の空欄 (まだ既定が入っていない) は「触っていない」扱い。
    if (SHIFT_LIMIT_IDS.includes(el.id) && v === '') continue;
    if (v !== defs[el.id]) diff[el.id] = v;
  }
  try {
    if (Object.keys(diff).length) localStorage.setItem(SEEDOPT_SETTINGS_KEY, JSON.stringify(diff));
    else localStorage.removeItem(SEEDOPT_SETTINGS_KEY);
  } catch (e) { /* private mode など。保存できなくても動作は変えない */ }
  return diff;
}
/** 保存済みの設定を欄に戻す。戻り値 = 戻した項目数。 */
export function restoreSeedOptSettings() {
  snapshotSeedOptDefaults();
  const saved = loadSeedOptSettings();
  if (!saved) return 0;
  let n = 0;
  for (const el of seedOptSettingFields()) {
    if (!Object.prototype.hasOwnProperty.call(saved, el.id)) continue;
    setSeedOptFieldValue(el, saved[el.id]);
    n += 1;
  }
  if (n) refreshSeedOptDerivedUi();
  return n;
}
/** 設定を既定に戻し、保存も消す。 */
function resetSeedOptSettings() {
  const defs = snapshotSeedOptDefaults();
  for (const el of seedOptSettingFields()) setSeedOptFieldValue(el, defs[el.id]);
  try { localStorage.removeItem(SEEDOPT_SETTINGS_KEY); } catch (e) {}
  applyModeDefaults();   // 探索モードの既定に応じた多点数・冷却・反復
  // ズレ上限は既定を入れた状態 = 「自動で入れた値」扱いにする (次の大会読み込みで通常どおり更新される)。
  _lastShiftPrefill = SHIFT_LIMIT_IDS.map((id) => { const e = /** @type {HTMLInputElement | null} */ (document.getElementById(id)); return e ? e.value : ''; });
  refreshSeedOptDerivedUi();
  Promise.resolve(updateSeriesToggleState()).catch(() => {});
  const p = document.getElementById('so-progress');
  if (p) p.textContent = i18n('seed.boot.s4');
}
/** 値に連動する表示 (スライダーの数値・プール内変動の有効/無効・シリーズ欄の出し入れ) を更新。 */
function refreshSeedOptDerivedUi() {
  const op = /** @type {HTMLInputElement | null} */ (document.getElementById('so-orderpow'));
  const opv = document.getElementById('so-orderpow-val');
  if (op && opv) opv.textContent = op.value;
  updateIntraToggleState();
  const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('so-avoid-series'));
  const box = document.getElementById('so-series-box');
  if (cb && box) box.style.display = cb.checked ? '' : 'none';
}

// ── 地理単位のカタログ (geo.json): 地域まとめトグルはここから描く ──
// 骨格 (10_skeleton.js) には置き場 #so-group-box だけある。geo.json が読めたらトグルを入れ、? アイコンと保存設定も付ける。
/** @param {SpspGeoCatalog} geo */
export function renderRegionGroupToggles(geo) {
  const box = document.getElementById('so-group-box');
  if (!box) return;
  box.innerHTML = regionGroupToggles(geo);
  const ids = (geo && geo.seed_groups ? geo.seed_groups : []).map(regionGroupToggleId);
  injectHelpIcons(box, ids);
  // 設定の保存/復元の対象に加える (既定 = geo.json の default、保存済みならそれを戻す)
  const defs = snapshotSeedOptDefaults();
  const saved = loadSeedOptSettings();
  for (const id of ids) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (!el) continue;
    if (!(id in defs)) defs[id] = seedOptFieldValue(el);
    if (saved && Object.prototype.hasOwnProperty.call(saved, id)) setSeedOptFieldValue(el, saved[id]);
  }
}
export async function ensureGeoForSeed() {
  const geo = /** @type {SpspGeoCatalog} */ (/** @type {unknown} */ (await SeedData.ensureGeoCatalog(cachedFetchers(SPSP.data))));   // seed_data.js は未検査 (推論では null になる)
  SPSPGeo.setGeoCatalog(geo);   // レポートの地域名 (js/geo.js unitName) も同じカタログで
  renderRegionGroupToggles(geo);
  return geo;
}

(function wireSeedOptSettings() {
  const panel = document.getElementById('seedopt-panel');
  if (!panel) return;
  snapshotSeedOptDefaults();
  restoreSeedOptSettings();
  // 地域まとめトグル (geo.json) を起動時に入れる。失敗は進捗欄に出す (実行時にも読み直す)。
  ensureGeoForSeed().catch((e) => {
    const p = document.getElementById('so-progress');
    if (p) p.textContent = i18n('seed.boot.geo_failed', { msg: e.message });
  });
  // 欄が変わるたびに保存 (change: チェック・select・確定した入力 / input: スライダーと入力中の数値)。
  const onEdit = (ev) => {
    const t = ev.target;
    if (!t || !t.id || !/^so-/.test(t.id) || SEEDOPT_SETTINGS_SKIP.has(t.id)) return;
    saveSeedOptSettings();
  };
  panel.addEventListener('change', onEdit);
  panel.addEventListener('input', onEdit);
  const auto = document.getElementById('so-auto-apply');
  if (auto) auto.addEventListener('change', () => saveSeedOptSettings());
  const reset = document.getElementById('so-reset-defaults');
  if (reset) reset.addEventListener('click', resetSeedOptSettings);
})();
