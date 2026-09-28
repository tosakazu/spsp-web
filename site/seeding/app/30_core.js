// @ts-check
// seeding/app/30_core.js — SPSP シードツール本体の一部: 本体の状態 (DATA / META / MASTER_MAP …)、出力順 (orderedRecs)、手動調整モード、表の列と生成。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { SEED_APP_CONFIG, i18n } from './10_skeleton.js';
import { render } from './40_startgg.js';
import { seedRowClickHandler } from './50_events.js';
import { dropAppliedOrder, escHtml, resetSeedOptResultPanel } from './75_series_rematch.js';
import { applyCsvOrderIfReady } from './80_csv_source.js';
import { currentWaveMap, poolLabel, waveLetter } from './85_waves.js';
import { _pruneSeedSpec, applySeedLockChoice, enforceSeedLocks, renderSpecStatus } from './90_spec.js';
import SPSPData from '../../js/data.js';
import SPSPRankingTable from '../../ranking-table.js';
import SeedOptimizer from '../seed_optimizer.js';
'use strict';

// ── Chart.js (lazy load on first graph use) ──
// ── 本体 ──

export const DATA = [];

// MASTER は (uid → record) Map にキャッシュ
/** @type {SpspRankMeta | null} */
let MASTER_META = null;
// 複数 start.gg アカウント統合表 (old uid → 正規 uid)。site/data/user_merges.json
// (= build/user_merges.py から生成) を loadMasterData で取得。旧アカウントで
// エントリーされてもランキング参照・再対戦履歴が正規 uid で引けるようにする。
/** @type {Map<number, number> | null} */
let USER_MERGES_MAP = null;

// start.gg から取った user_id を正規 uid に変換 (統合対象でなければそのまま)。
/** @param {number | null | undefined} uid @returns {number | null | undefined} */
export function canonicalUserId(uid) {
  if (uid == null || !USER_MERGES_MAP) return uid;
  const c = USER_MERGES_MAP.get(uid);
  return c != null ? c : uid;
}
// 直近フェッチした event 情報 (phaseId, eventName, entrant list, etc.)
// 被り回避最適化のシード順 (= uid 配列)。null なら currentMethod 順。
// 最適化が完了した時点で自動的にここへ入る (= 実行したら反映される)。
// CSV / start.gg 適用 / トーナメントプレビューはすべてこれを見る。
// 「最適化を取り消す」で戻る状態。最適化を反映する直前に取る。

// CSV / start.gg 適用で使うシード出力順。優先度: 被り回避適用 > 手動調整 > currentMethod 順。
// 手動調整は編集中でも現在の並びを出力に使う (確定は「編集を終える」の意味)。
export function orderedRecs() {
  if (S.APPLIED_ORDER) {
    const pos = new Map(S.APPLIED_ORDER.map((u, i) => [u, i]));
    return DATA.slice().sort((a, b) =>
      (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
  }
  if (S.MANUAL) {
    const pos = new Map(manualOrder().map((u, i) => [u, i]));
    return DATA.slice().sort((a, b) =>
      (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
  }
  // 手動調整なし: currentMethod 順 + 固定射影 (固定者は指定プール/ウェーブへ)。
  const base = DATA.slice().sort((a, b) => (a.ranks[S.currentMethod] || 1e9) - (b.ranks[S.currentMethod] || 1e9));
  const uids = _projectSeedLocks(base.map(r => r.user_id));
  const pos = new Map(uids.map((u, i) => [u, i]));
  return base.sort((a, b) =>
    (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
}

// ── 手動調整モード ─────────────────────────────────────────────
// ロックを外すと現在の出力順を基準 (base) に、行の「選択」→挿入位置クリック or
// シード番号直接入力で並べ替えできる。操作は op 履歴 (最大 MANUAL_MAX_OPS 件,
// undo/redo 可、超過分は base に畳み込み) で管理し、localStorage に1件だけ自動保存
// (同一イベント・同一参加者集合なら再訪時に復元)。確定すると orderedRecs / CSV /
// start.gg 適用 / 被り回避最適化の基準ランキングになる。
const MANUAL_LS_KEY = 'spsp_seed_manual_v1';
const MANUAL_MAX_OPS = 100;
// シード指定・固定 (spec-panel の CSV / 行の📌ボタン)。MANUAL と同じ localStorage に保存。
//   pins:  {uid: seat1}      … 順位指定 (base 組み直しに使用済みの記録)
//   waves: {uid: waveIdx0}   … ウェーブ指定 (同上)
//   locks: {uid: 'pool'|'wave'} … 被り回避最適化のハード制約 (optimizer の seedLocks へ)

function manualEventKey() {
  if (!S.EVENT_CONTEXT) return null;
  return `${S.EVENT_CONTEXT.eventId || ''}:${S.EVENT_CONTEXT.phaseId || ''}`;
}
export function manualParseUid(s) { const n = Number(s); return Number.isNaN(n) ? s : n; }
/** @param {number[]} arr @param {{ uid: number, to: number }} op @returns {number[]} */
function manualApplyOp(arr, op) {
  const a = arr.slice();
  const i = a.indexOf(op.uid);
  if (i >= 0) {
    a.splice(i, 1);
    a.splice(Math.max(0, Math.min(op.to, a.length)), 0, op.uid);
  }
  return a;
}
// 固定 (SEED_SPEC.locks の対象指定) を並びへ反映する読み取り時射影。
// 手動 op には積まず、manualOrder / orderedRecs / 最適化の基準すべてで常に適用される
// (= 最適化しなくても固定者は指定プール/ウェーブの位置に挿入ソート的に移動する)。
// op 履歴と独立なので undo/redo・固定解除でそのまま元の並びに戻る。冪等。
// uid 配列 → 表示名の列挙 (多いときは先頭 3 人 + 「ほか N 人」)。
/** @param {(number | string)[]} uids @param {number} [max] @returns {string} */
function namesOfUids(uids, max = 3) {
  if (!uids || !uids.length) return '';
  const byUid = new Map(DATA.map(r => [r.user_id, r]));
  const names = uids.map(u => {
    const rec = byUid.get(manualParseUid(u));
    return (rec && rec.display) || `uid:${u}`;
  });
  const head = names.slice(0, max).join('、');
  return names.length > max ? `${head} ${i18n('seed.core.t1')} ${names.length - max}${i18n('seed.core.t2')}` : head;
}

/** @type {string[]} */
let _lockProjNotes = [];   // 直近の射影で枠が足りなかった固定の説明 (manualBarHtml で表示)
/** @param {number[]} a @returns {number[]} */
export function _projectSeedLocks(a) {
  _lockProjNotes = [];
  if (!S.SEED_SPEC || !S.SEED_SPEC.locks || !Object.keys(S.SEED_SPEC.locks).length) return a;
  if (typeof document === 'undefined' || typeof window === 'undefined' || !SeedOptimizer) return a;
  const P = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  const waveMap = currentWaveMap(P);
  const r = enforceSeedLocks(a, S.SEED_SPEC.locks, P, waveMap,
    (s, PP) => SeedOptimizer.poolOfSeed(s, PP));
  // 枠不足は「どこが何人分足りないか + 誰が反映されないか」を出す。
  // 枠 0 = 現在のプール数/ウェーブ数にその対象が無い (設定変更や前回の固定が残っている)。
  _lockProjNotes = (r.overflow || []).map((o) => {
    const label = o.kind === 'pool' ? poolLabel(o.target, waveMap) : i18n('seed.core.s1') + waveLetter(o.target);
    const who = namesOfUids(o.dropped);
    if (o.cap === 0) {
      return `${label} ${i18n('seed.core.t3')}${o.kind === 'pool' ? `${i18n('seed.core.t4')}${P})` : `${i18n('seed.core.t5')}${waveMap.reduce((m, w) => Math.max(m, w), 0) + 1})`}${i18n('seed.core.t6')}${who} ${i18n('seed.core.t7')}`;
    }
    return `${label} ${i18n('seed.core.t8')} ${o.cap}${i18n('seed.core.t9')} ${o.want}${i18n('seed.core.t10')}${who} ${i18n('seed.core.t11')}`;
  });
  return r.order;
}
export function manualOrder() {
  const M = /** @type {SpspSeedManual} */ (S.MANUAL);   // 手動調整があるときにしか呼ばれない
  let a = M.base.slice();
  for (let k = 0; k < M.hpos; k++) a = manualApplyOp(a, M.ops[k]);
  return _projectSeedLocks(a);
}
export function manualMovedSet() {
  const M = /** @type {SpspSeedManual} */ (S.MANUAL);   // 同上
  return new Set(M.ops.slice(0, M.hpos).map(o => o.uid));
}
export function saveManual() {
  try {
    if (!S.MANUAL && !S.SEED_SPEC) { localStorage.removeItem(MANUAL_LS_KEY); return; }
    localStorage.setItem(MANUAL_LS_KEY, JSON.stringify({
      eventKey: manualEventKey(),
      base: S.MANUAL ? S.MANUAL.base : null, ops: S.MANUAL ? S.MANUAL.ops : [],
      hpos: S.MANUAL ? S.MANUAL.hpos : 0, committed: S.MANUAL ? S.MANUAL.committed : false,
      src: (S.MANUAL && S.MANUAL.src) || null,
      spec: S.SEED_SPEC,   // 指定・固定 (MANUAL と独立に保持)
      ts: Date.now(),
    }));
  } catch (e) { /* 容量超過等は無視 (保存はベストエフォート) */ }
}
// イベント取得後に呼ぶ: 同一イベント & 同一参加者集合なら保存済み手動調整を復元。
export function restoreManualForEvent() {
  S.MANUAL = null;
  S.SEED_SPEC = null;
  _lockProjNotes = [];   // 前の大会の固定警告を持ち越さない
  try {
    const raw = localStorage.getItem(MANUAL_LS_KEY);
    const key = manualEventKey();
    if (raw && key != null) {   // イベント不明 (key=null) では復元しない (別大会の取り違え防止)
      const s = JSON.parse(raw);
      if (s && s.eventKey === key) {
        const cur = new Set(DATA.map(r => r.user_id));
        if (Array.isArray(s.base) && s.base.length === cur.size && s.base.every(u => cur.has(u))) {
          S.MANUAL = {
            base: s.base, ops: Array.isArray(s.ops) ? s.ops : [],
            hpos: Math.min(s.hpos || 0, (s.ops || []).length),
            committed: !!s.committed, editing: false, sel: null, src: s.src || null,
          };
        }
        // 指定・固定の復元 (現在の参加者に居る uid の分だけ)。
        if (s.spec && typeof s.spec === 'object') {
          /** @param {Record<string, any> | null | undefined} obj @returns {Record<string, any>} */
          const keep = (obj) => {
            /** @type {Record<string, any>} */
            const o = {};
            for (const k in (obj || {})) {
              const u = manualParseUid(k);
              if (cur.has(u)) o[u] = /** @type {Record<string, any>} */ (obj)[k];
            }
            return o;
          };
          const sp = { label: s.spec.label || null, pins: keep(s.spec.pins),
                       waves: keep(s.spec.waves), locks: keep(s.spec.locks) };
          if (Object.keys(sp.pins).length || Object.keys(sp.waves).length || Object.keys(sp.locks).length) {
            S.SEED_SPEC = sp;
          }
        }
      }
    }
  } catch (e) { S.MANUAL = null; S.SEED_SPEC = null; }
  // 手動調整は既定でオン。復元が無ければ現在の出力順を基準に開いておく
  // (オフにしておく理由が無いので、わざわざ「編集を開始」を押させない)。
  if (!S.MANUAL && DATA.length) {
    S.MANUAL = { base: orderedRecs().map((r) => r.user_id), ops: [], hpos: 0,
               committed: false, editing: true, sel: null };
  } else if (S.MANUAL) {
    S.MANUAL.editing = true;
    S.MANUAL.sel = null;
  }
  renderManualUI();
  renderSpecStatus();
  // csv モード: 参加者が揃ったので読み込み済み CSV 順を基準に反映 (復元済み手動調整は優先)。
  if (typeof applyCsvOrderIfReady === 'function') applyCsvOrderIfReady(true);
}
/** @param {number} uid @param {number} to */
function manualPushOp(uid, to) {
  if (!S.MANUAL) return;
  const cur = manualOrder();
  const from = cur.indexOf(uid);
  if (from < 0) return;
  const t = Math.max(0, Math.min(to, cur.length - 1));
  if (t === from) { S.MANUAL.sel = null; renderManualUI(); return; }
  S.MANUAL.ops = S.MANUAL.ops.slice(0, S.MANUAL.hpos);
  S.MANUAL.ops.push({ uid, to: t });
  if (S.MANUAL.ops.length > MANUAL_MAX_OPS) {   // 古い op は base に畳み込む
    S.MANUAL.base = manualApplyOp(S.MANUAL.base, S.MANUAL.ops[0]);
    S.MANUAL.ops = S.MANUAL.ops.slice(1);
  }
  S.MANUAL.hpos = S.MANUAL.ops.length;
  S.MANUAL.sel = null;
  saveManual(); renderManualUI();
}
function manualUnlock() {
  if (!S.MANUAL) {
    // 初回: 現在の出力順 (被り回避適用済みならその順序) を基準に取り込む。
    S.MANUAL = { base: orderedRecs().map(r => r.user_id), ops: [], hpos: 0, committed: false, editing: true, sel: null };
  } else {
    // 再編集: MANUAL (op 履歴・undo/redo 位置) をそのまま保持する。
    // 被り回避は「最後に別枠でかける処理」なので base には畳み込まない
    // (適用は解除され、手動調整を確定してから再実行する)。
    S.MANUAL.editing = true;
    S.MANUAL.sel = null;
  }
  dropAppliedOrder();
  if (S.SEEDOPT_RESULT) resetSeedOptResultPanel(i18n('seed.core.s2'));
  saveManual(); renderManualUI();
}
function manualCommit() {
  if (!S.MANUAL) return;
  S.MANUAL.editing = false;
  S.MANUAL.committed = true;
  S.MANUAL.sel = null;
  saveManual(); renderManualUI();
  const st = document.getElementById('status');
  if (st) st.textContent = `${i18n('seed.core.t12')}${manualMovedSet().size}${i18n('seed.core.t13')}`;
}
function manualDiscard() {
  if (!S.MANUAL) return;
  // 必ず確認ダイアログを出す (undo/redo 履歴ごと消える操作なので)。
  if (!confirm(i18n('seed.core.discard_manual_confirm'))) return;
  S.MANUAL = null;
  saveManual(); renderManualUI();
}
function manualBarHtml() {
  /** @param {string} mn @param {string} label @param {string} [extra] */
  const btn = (mn, label, extra) =>
    `<button data-mn="${mn}" ${extra || ''} style="font-size:11px;padding:3px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;color:#374151;cursor:pointer">${label}</button>`;
  // 固定の枠不足 / 対象消失。黙って握りつぶさず、その場で解除できるようにする。
  const projWarn = _lockProjNotes.length
    ? `<span style="color:#b91c1c;font-size:11px;font-weight:600">⚠ ${_lockProjNotes.map(escHtml).join(' ／ ')}</span>`
      + `<button data-mn="clear-locks" style="font-size:10px;padding:2px 8px;border:1px solid #fca5a5;border-radius:5px;background:#fff;color:#b91c1c;cursor:pointer">${i18n('seed.core.t14')}</button>`
    : '';
  // プール数 / ウェーブ数 (被り回避パネルの so-pools / so-waves と同じ値。手動列のプール表示と
  // プール/ウェーブ固定の枠がこれで決まるので、パネルを開かずここでも変更できるようにする)。
  const _pv = (id, def) => { const v = parseInt(/** @type {{ value?: any }} */ (document.getElementById(id) || {}).value, 10); return Number.isFinite(v) ? v : def; };
  const poolWaveInputs =
    `<span style="font-size:11px;color:#6b7280;white-space:nowrap" title="${i18n('seed.core.t43')}">`
    + `${i18n('seed.core.t15')} <input type="number" data-mn-pools min="1" max="128" step="1" value="${_pv('so-pools', 1)}" style="width:56px;padding:1px 4px;border:1px solid #d1d5db;border-radius:4px;font-size:11px">`
    + ` ${i18n('seed.core.t16')} <input type="number" data-mn-waves min="1" max="26" step="1" value="${_pv('so-waves', 1)}" style="width:52px;padding:1px 4px;border:1px solid #d1d5db;border-radius:4px;font-size:11px">`
    + `</span>`;
  if (!S.MANUAL) {
    // 破棄した直後などの状態。プール数/ウェーブ数はここでも触れるようにしておく
    // (手動調整と関係なく、プール表示や固定の枠を決める設定なので)。
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`
      + `<button data-mn="unlock" style="font-size:12px;padding:5px 12px;border:1px solid #d1d5db;border-radius:6px;background:#f3f4f6;color:#6b7280;cursor:pointer">${i18n('seed.core.t17')}</button>`
      + poolWaveInputs + projWarn + `</div>`;
  }
  const moved = manualMovedSet().size;
  if (S.MANUAL.editing) {
    const canUndo = S.MANUAL.hpos > 0, canRedo = S.MANUAL.hpos < S.MANUAL.ops.length;
    return `<div style="border:2px solid #fb923c;background:#fff7ed;border-radius:8px;padding:8px 10px;font-size:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">`
      + `<span style="font-weight:700;color:#ea580c">${i18n('seed.core.t18')}</span>`
      + `<span style="color:#9a3412">${moved}${i18n('seed.core.t19')}</span>`
      + poolWaveInputs
      + projWarn
      // 操作ボタンは次の行に折り返す (flex-basis:100% で改行)。
      + `<div style="flex-basis:100%;display:flex;gap:8px;flex-wrap:wrap">`
      + btn('undo', i18n('seed.core.s3'), canUndo ? '' : 'disabled')
      + btn('redo', i18n('seed.core.s4'), canRedo ? '' : 'disabled')
      + `<button data-mn="commit" style="font-size:11px;padding:3px 12px;border:none;border-radius:6px;background:#16a34a;color:#fff;font-weight:600;cursor:pointer">${i18n('seed.core.t20')}</button>`
      + btn('discard', i18n('seed.core.s5'))
      + `</div>`
      + `</div>`;
  }
  const optNote = S.APPLIED_ORDER ? i18n('seed.core.s6') : '';
  return `<div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:6px 10px;font-size:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">`
    + `<span style="font-weight:700;color:#b45309">${i18n('seed.core.t21')}${moved}${i18n('seed.core.t19')}${S.MANUAL.src === 'csv' ? i18n('seed.core.s20') : (S.MANUAL.src === 'spec' ? i18n('seed.core.s21') : '')})</span><span style="color:#9ca3af;font-size:10px">${optNote}</span>`
    + poolWaveInputs
    + projWarn
    // 操作ボタンは次の行に折り返す (flex-basis:100% で改行)。
    + `<div style="flex-basis:100%;display:flex;gap:8px;flex-wrap:wrap">`
    + btn('unlock', moved > 0 ? i18n('seed.core.s7') : i18n('seed.core.s8')) + btn('discard', i18n('seed.core.s5'))
    + `</div>`
    + `</div>`;
}
// 「プール/ウェーブ指定」バー (「プール指定」ボタンで対象行の直下に表示)。
// 現在と違うプール/ウェーブを選んで適用すると、その中の最寄り位置へ行を移動 (通常の手動 op =
// undo 可) してから固定する。「固定しない」で解除。
function manualLockBarHtml() {
  if (!S.MANUAL || S.MANUAL.lockSel == null) return '';   // 固定バーは lockSel があるときだけ出す (decorateManualTable)
  const recBy = new Map(DATA.map(r => [r.user_id, r]));
  const rec = recBy.get(S.MANUAL.lockSel);
  const name = escHtml(rec ? rec.display : String(S.MANUAL.lockSel));
  const P = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  const waveMap = currentWaveMap(P);
  const W = waveMap.reduce((m, w) => Math.max(m, w), 0) + 1;
  const cur = manualOrder();
  const pos = cur.indexOf(S.MANUAL.lockSel);
  const poolOf = (s) => (SeedOptimizer ? SeedOptimizer.poolOfSeed(s, P) : 0);
  const curPool = pos >= 0 ? poolOf(pos) : 0;
  const lkRaw = (S.SEED_SPEC && S.SEED_SPEC.locks) ? S.SEED_SPEC.locks[S.MANUAL.lockSel] : null;
  const lkKind = lkRaw ? (lkRaw.kind || lkRaw) : null;
  const lkTarget = (lkRaw && lkRaw.target != null) ? lkRaw.target : null;
  const kind = S.MANUAL.lockKind || lkKind || 'pool';
  const selCss = 'padding:2px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;background:#fff';
  const kindSel = `<select data-mn-lock-kind style="${selCss}">`
    + `<option value="none"${kind === 'none' ? ' selected' : ''}>${i18n('seed.core.t22')}</option>`
    + `<option value="pool"${kind === 'pool' ? ' selected' : ''}>${i18n('seed.core.t23')}</option>`
    + (W >= 2 ? `<option value="wave"${kind === 'wave' ? ' selected' : ''}>${i18n('seed.core.t24')}</option>` : '')
    + `</select>`;
  let targetSel = '';
  if (kind === 'pool') {
    const sel = (kind === lkKind && lkTarget != null) ? lkTarget : curPool;
    targetSel = ` ${i18n('seed.core.t25')} <select data-mn-lock-target style="${selCss}">` + Array.from({ length: P }, (_, p) =>
      `<option value="${p}"${p === sel ? ' selected' : ''}>${escHtml(poolLabel(p, waveMap))}</option>`).join('') + `</select>`;
  } else if (kind === 'wave') {
    const sel = (kind === lkKind && lkTarget != null) ? lkTarget : waveMap[curPool];
    targetSel = ` ${i18n('seed.core.t25')} <select data-mn-lock-target style="${selCss}">` + Array.from({ length: W }, (_, w) =>
      `<option value="${w}"${w === sel ? ' selected' : ''}>${escHtml(waveLetter(w))}</option>`).join('') + `</select>`;
  }
  return `<div style="margin-top:6px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:6px 10px;font-size:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">`
    + `<b>${name}</b> ${i18n('seed.core.t26')} ${kindSel}${targetSel} `
    + `<button data-mn="lock-apply" style="padding:2px 12px;border:none;border-radius:5px;background:#dc2626;color:#fff;font-weight:600;cursor:pointer">${i18n('seed.core.t27')}</button> `
    + `<button data-mn="lock-cancel" style="padding:2px 8px;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer">${i18n('seed.core.t28')}</button>`
    + `<span style="color:#9ca3af;font-size:10px;flex-basis:100%">${i18n('seed.core.t29')}${P < 2 ? i18n('seed.core.s22') : ''}</span>`
    + `</div>`;
}
// 「移動中」アクションバー (選択中のみ manual-bar 直下に表示)。
function manualActionBarHtml() {
  if (!S.MANUAL) return '';
  const recBy = new Map(DATA.map(r => [r.user_id, r]));
  const selRec = recBy.get(S.MANUAL.sel);
  const n = manualOrder().length;
  return `<div style="margin-top:6px;background:#fff7ed;border:1px solid #fb923c;border-radius:6px;padding:6px 10px;font-size:12px">`
    + `<b>${escHtml(selRec ? selRec.display : String(S.MANUAL.sel))}</b> ${i18n('seed.core.t30')} `
    + `<input type="number" data-mn-input min="1" max="${n}" style="width:64px;padding:2px 4px;border:1px solid #d1d5db;border-radius:4px"> `
    + `<button data-mn="move-input" style="padding:2px 10px;border:none;border-radius:5px;background:#fb923c;color:#fff;cursor:pointer">${i18n('seed.core.t31')}</button> `
    + `<button data-mn="cancel-sel" style="padding:2px 8px;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer">${i18n('seed.core.t28')}</button></div>`;
}
// 通常のランキング表への手動調整装飾 (描画のたびに適用)。
//   - 移動済み行 = 黄背景、選択中行 = オレンジ背景
//   - 編集中はプレイヤーリンクを新規タブ化
//   - 選択中は行間に「▾ ここに挿入」スロット行を差し込む
function decorateManualTable() {
  if (!S.MANUAL) return;
  const M = S.MANUAL;   // 閉包 (forEach / find) の中でも null でない型に
  const tbody = /** @type {HTMLElement} */ (document.getElementById('ranktable')).querySelector('tbody');
  if (!tbody) return;
  const editing = S.MANUAL.editing;
  const colspan = (S.TABLE && S.TABLE.columns) ? S.TABLE.columns.length : 10;
  const rows = Array.from(/** @type {NodeListOf<HTMLElement>} */ (tbody.querySelectorAll('tr.main-row')));
  rows.forEach((tr) => {
    const uid = manualParseUid(tr.dataset.uid);
    if (M.sel === uid) tr.style.background = '#ffedd5';
    else if (M.lockSel === uid) tr.style.background = '#fee2e2';
    else if (_mnMoved.has(uid)) tr.style.background = '#fef9c3';
    // 手動調整中 (編集中/確定後とも) はプレイヤー名クリックを新規タブに。
    /** @type {NodeListOf<HTMLAnchorElement>} */ (tr.querySelectorAll('a.player-name')).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  });
  // 固定設定バーは対象行のすぐ下に差し込む (画面上部まで戻らずに操作できる)。
  if (editing && S.MANUAL.lockSel != null) {
    const target = rows.find((tr) => manualParseUid(tr.dataset.uid) === M.lockSel);
    if (target) {
      const lr = document.createElement('tr');
      lr.className = 'mn-lock-row';
      lr.innerHTML = `<td colspan="${colspan}" style="padding:0;border:none">${manualLockBarHtml()}</td>`;
      // 行クリック (詳細展開) に食われないようにする。
      lr.addEventListener('click', (e) => e.stopPropagation());
      /** @type {Element} */
      let anchor = target;
      if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('detail-row')) {
        anchor = anchor.nextElementSibling;
      }
      tbody.insertBefore(lr, anchor.nextElementSibling);
    }
  }
  if (editing && S.MANUAL.sel != null && rows.length) {
    const slotHtml = (attr) =>
      `<td colspan="${colspan}" style="padding:0;border:none"><div class="mn-slot" data-mn="slot" ${attr}>${i18n('seed.core.t32')}</div></td>`;
    const first = document.createElement('tr');
    first.className = 'mn-slot-row';
    first.innerHTML = slotHtml('data-top="1"');
    tbody.insertBefore(first, rows[0]);
    rows.forEach((tr) => {
      const s = document.createElement('tr');
      s.className = 'mn-slot-row';
      s.innerHTML = slotHtml(`data-after="${escHtml(String(tr.dataset.uid))}"`);
      // 詳細展開行 (detail-row) があればその後ろに入れる
      /** @type {Element} */
      let anchor = tr;
      if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('detail-row')) {
        anchor = anchor.nextElementSibling;
      }
      tbody.insertBefore(s, anchor.nextElementSibling);
    });
  }
}
// 手動調整のクリック操作 (バー/リスト共通のデリゲーション)。
export function manualClickHandler(e) {
  const el = e.target.closest('[data-mn]');
  if (!el || el.disabled) return;
  const act = el.dataset.mn;
  if (act === 'unlock') { manualUnlock(); return; }
  if (act === 'clear-locks') {
    if (S.SEED_SPEC) { delete S.SEED_SPEC.locks; _pruneSeedSpec(); }
    saveManual(); render(); renderSpecStatus();
    return;
  }
  if (!S.MANUAL) return;
  if (act === 'undo') { S.MANUAL.hpos = Math.max(0, S.MANUAL.hpos - 1); S.MANUAL.sel = null; saveManual(); renderManualUI(); return; }
  if (act === 'redo') { S.MANUAL.hpos = Math.min(S.MANUAL.ops.length, S.MANUAL.hpos + 1); S.MANUAL.sel = null; saveManual(); renderManualUI(); return; }
  if (act === 'commit') { manualCommit(); return; }
  if (act === 'discard') { manualDiscard(); return; }
  if (act === 'select') {
    const uid = manualParseUid(el.dataset.uid);
    S.MANUAL.sel = (S.MANUAL.sel === uid) ? null : uid;
    S.MANUAL.lockSel = null; S.MANUAL.lockKind = null;
    renderManualUI(); return;
  }
  if (act === 'lockopen') {
    const uid = manualParseUid(el.dataset.uid);
    S.MANUAL.lockSel = (S.MANUAL.lockSel === uid) ? null : uid;
    S.MANUAL.lockKind = null;
    S.MANUAL.sel = null;
    renderManualUI(); return;
  }
  if (act === 'lock-apply') { if (S.MANUAL.lockSel != null) applySeedLockChoice(S.MANUAL.lockSel); return; }
  if (act === 'lock-cancel') { S.MANUAL.lockSel = null; S.MANUAL.lockKind = null; renderManualUI(); return; }
  if (act === 'cancel-sel') { S.MANUAL.sel = null; renderManualUI(); return; }
  if (act === 'slot') {
    if (S.MANUAL.sel == null) return;
    // スロットは「先頭 (data-top)」か「行 uid の直後 (data-after)」。フィルタ中でも
    // 完全な手動順に対する位置で解決する。
    const cur = manualOrder();
    const from = cur.indexOf(S.MANUAL.sel);
    const k = el.dataset.top != null ? 0 : cur.indexOf(manualParseUid(el.dataset.after)) + 1;
    manualPushOp(S.MANUAL.sel, k > from ? k - 1 : k);
    return;
  }
  if (act === 'move-input') {
    if (S.MANUAL.sel == null) return;
    const inp = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (document.getElementById('manual-bar')).querySelector('input[data-mn-input]'));
    const v = inp ? parseInt(inp.value, 10) : NaN;
    if (!Number.isFinite(v)) return;
    manualPushOp(S.MANUAL.sel, v - 1);
    return;
  }
}

// 手動調整 UI 全体の再描画: バー更新 + 通常テーブルへの手動列/並び順の反映。
// テーブル自体は共有コンポーネントのまま (手動調整列 + 装飾を足すだけ)。
let _mnTableMode = false;   // テーブルに手動列が入っているか
export function renderManualUI() {
  const bar = document.getElementById('manual-bar');
  if (!bar) return;
  const workBar = document.getElementById('work-bar');
  if (!DATA.length) {
    bar.style.display = 'none';
    if (workBar) workBar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  if (workBar) workBar.style.display = '';
  // per-render キャッシュ (MANUAL_COL の cell / 装飾が参照)。バー描画より先に計算する
  // (manualOrder → 固定射影の警告 _lockProjNotes をバーが表示するため)。
  if (S.MANUAL) {
    const order = manualOrder();
    _mnPos = new Map(order.map((u, i) => [u, i]));
    _mnBase = new Map(S.MANUAL.base.map((u, i) => [u, i]));
    _mnMoved = manualMovedSet();
  } else {
    _mnPos = new Map(); _mnBase = new Map(); _mnMoved = new Set();
    // 手動調整が無くても固定は出力順に効くので、現在の並びで警告状態を計算し直す
    // (これをしないと前回計算時の警告が残り続ける)。
    orderedRecs();
  }
  // プール表示コンテキスト (被り回避パネルのプール数/ウェーブ数から)。
  const _pcP = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  _mnPoolCtx = _pcP >= 2 ? { P: _pcP, waveMap: currentWaveMap(_pcP) } : null;

  // 固定設定バーは行の直下に出す (decorateManualTable)。ここは移動中バーのみ。
  let barHtml = manualBarHtml();
  if (S.MANUAL && S.MANUAL.editing && S.MANUAL.sel != null) barHtml += manualActionBarHtml();
  bar.innerHTML = barHtml;

  const tbl = ensureTable();
  const wantManual = !!S.MANUAL && !S.APPLIED_ORDER;   // 被り回避適用中は通常表示 (最適化後順序)
  if (wantManual !== _mnTableMode) {
    _mnTableMode = wantManual;
    tbl.setColumns(wantManual ? /** @type {SeedColumn[]} */ ([MANUAL_COL]).concat(SEED_BASE_COLUMNS) : SEED_BASE_COLUMNS);
    tbl.setSort(wantManual ? 'manual_pos' : 'rank', 'asc');
  } else if (wantManual) {
    // 手動順 (manual_pos) で並べ直し + セル/装飾の再描画。
    tbl.setSort('manual_pos', 'asc');
  }
}

// V4 用 (= site/index.html の _columnsForMeta と同形): 平均順位 / 平均スコアの
// 代わりに 直対評 / 順位評 を小さい灰色で表示する.
const _smallGray = (v, decimals = 1) =>
  v != null ? `<span style="color:#9ca3af;font-size:11px">${v.toFixed(decimals)}</span>` : '–';
const TJPR_SCORE_COL = {
  id: 'tjpr_score_cell', label: i18n('seed.core.s9'), sortable: true, sortKey: 'tjpr_score',
  css: 'col-score',
  value: (rec) => -((rec.scores && rec.scores.tjpr_elo) || -Infinity),
  cell: (rec) => _smallGray(rec.scores && rec.scores.tjpr_elo, 2),
};
const BT_SCORE_COL = {
  id: 'bt_score_cell', label: i18n('seed.core.s10'), sortable: true, sortKey: 'bt_score',
  css: 'col-avg-rank',
  value: (rec) => -((rec.scores && rec.scores.bt_gated_elo) || -Infinity),
  cell: (rec) => _smallGray(rec.scores && rec.scores.bt_gated_elo, 2),
};

// 手動調整列 (手動調整モード中だけ SEED_BASE_COLUMNS の先頭に足す)。
// 手動順のシード番号 + 移動バッジ (元#N) + 編集中は「選択」ボタン。
// per-render キャッシュ (_mnPos/_mnMoved/_mnBase) は renderManualUI が更新する。
let _mnPos = new Map(), _mnMoved = new Set(), _mnBase = new Map();
/** @type {{ P: number, waveMap: number[] } | null} */
let _mnPoolCtx = null;   // {P, waveMap} — 手動列のプール表示用 (renderManualUI が更新)
const MANUAL_COL = {
  id: 'manual_pos', label: i18n('seed.core.s11'), css: 'col-manual', sortable: false, sortKey: 'manual_pos',
  value: (rec) => (_mnPos.has(rec.user_id) ? _mnPos.get(rec.user_id) : 1e9),
  cell: (rec) => {
    // 手動シード# + 変動矢印 (▲上げ=緑/▼下げ=青) → 元#N (小さく) → 選択ボタン。
    // 配置は .mn-cell (デスクトップ縦積み / モバイル横並び) で制御。
    const u = rec.user_id;
    const pos = _mnPos.get(u);
    const moved = _mnMoved.has(u);
    const isSel = S.MANUAL && S.MANUAL.sel === u;
    let h = `<div class="mn-cell">`;
    let numHtml = `#${pos != null ? pos + 1 : '–'}`;
    if (moved && pos != null) {
      const d = (_mnBase.get(u) != null ? _mnBase.get(u) : pos) - pos;   // 正 = 上げ (シード改善)
      if (d !== 0) {
        numHtml += ` <span style="font-size:10px;font-weight:700;color:${d > 0 ? '#16a34a' : '#2563eb'}">${d > 0 ? '▲' + d : '▼' + (-d)}</span>`;
      }
    }
    h += `<span class="mn-num" title="${i18n('seed.core.t44')}">${numHtml}</span>`;
    if (moved) h += `<span class="mn-orig" title="${i18n('seed.core.t45')}">${i18n('seed.core.t33')}${(_mnBase.get(u) != null ? _mnBase.get(u) : 0) + 1}</span>`;
    // この順位のプール (P>=2 のとき。ウェーブがあれば A3 形式、無ければ P3)。
    if (_mnPoolCtx && pos != null) {
      const pl = SeedOptimizer ? SeedOptimizer.poolOfSeed(pos, _mnPoolCtx.P) : 0;
      h += `<span style="font-size:10px;color:#9ca3af;white-space:nowrap" title="${i18n('seed.core.t34')} ${_mnPoolCtx.P}${i18n('seed.core.t35')}">${escHtml(poolLabel(pl, _mnPoolCtx.waveMap))}</span>`;
    }
    const lkRaw = S.SEED_SPEC && S.SEED_SPEC.locks ? S.SEED_SPEC.locks[u] : null;
    const lkKind = lkRaw ? (lkRaw.kind || lkRaw) : null;
    // 固定バッジの表記: 対象付きなら「A3固定」/「ウェーブA固定」、旧形式 (対象なし) は種別のみ。
    /** @type {string | null} */
    let lkLabel = null;
    /** @type {string | null} */
    let lkTitle = null;
    if (lkKind) {
      const tgt = (lkRaw && lkRaw.target != null) ? lkRaw.target : null;
      if (lkKind === 'pool') {
        lkLabel = tgt != null && _mnPoolCtx ? poolLabel(tgt, _mnPoolCtx.waveMap) + i18n('seed.core.s12') : i18n('seed.core.s13');
        lkTitle = i18n('seed.core.s13') + (tgt != null && _mnPoolCtx ? ` (${poolLabel(tgt, _mnPoolCtx.waveMap)})` : '');
      } else {
        lkLabel = tgt != null ? i18n('seed.core.s1') + waveLetter(tgt) + i18n('seed.core.s12') : i18n('seed.core.s14');
        lkTitle = i18n('seed.core.s14') + (tgt != null ? ` (${waveLetter(tgt)})` : '');
      }
      lkTitle += i18n('seed.core.s15');
    }
    if (S.MANUAL && S.MANUAL.editing) {
      const isLockSel = S.MANUAL.lockSel === u;
      h += `<button data-mn="select" data-uid="${escHtml(String(u))}" style="font-size:10px;padding:1px 8px;border:1px solid ${isSel ? '#ea580c' : '#d1d5db'};border-radius:5px;background:${isSel ? '#fb923c' : '#f9fafb'};color:${isSel ? '#fff' : '#374151'};cursor:pointer;white-space:nowrap">${isSel ? i18n('seed.core.s23') : i18n('seed.core.s24')}</button>`;
      h += `<button data-mn="lockopen" data-uid="${escHtml(String(u))}" title="${lkTitle ? escHtml(lkTitle) + i18n('seed.core.s25') : i18n('seed.core.s26')}" style="font-size:10px;padding:1px 6px;border:1px solid ${(lkKind || isLockSel) ? '#dc2626' : '#d1d5db'};border-radius:5px;background:${isLockSel ? '#dc2626' : (lkKind ? '#fee2e2' : '#f9fafb')};color:${isLockSel ? '#fff' : (lkKind ? '#b91c1c' : '#374151')};cursor:pointer;white-space:nowrap">${lkLabel ? escHtml(lkLabel) : i18n('seed.core.s27')}</button>`;
    } else if (lkKind) {
      h += `<span style="font-size:10px;color:#b91c1c;white-space:nowrap" title="${escHtml(lkTitle)}">${escHtml(lkLabel)}</span>`;
    }
    h += `</div>`;
    return h;
  },
};
// csv モードは「読み込んだものを編集してアップロードする」ツールなので、
// SPSP の順位/スコア列は出さない (被り回避などの内部処理では uid 照合を使う)。
/** 列の指定 (ranking-table.js resolveColumn): 組み込み列の名前か列定義 */
/** @typedef {string | { id: string, label: string, [k: string]: any }} SeedColumn */
/** @type {SeedColumn[]} */
const SEED_BASE_COLUMNS = SEED_APP_CONFIG.mode === 'csv'
  ? ['display']
  : [
      'rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL,
      'tjpr_lv', 'tour_count', 'bt_weekday',
      'rank_tjpr', 'rank_bt_gated',
    ];

// 共有 ranking table コンポーネント (= 初期化は DOMContentLoaded 後).
/** @returns {import('../../ranking-table.js').RankingTable} */
export function ensureTable() {
  if (S.TABLE) return S.TABLE;
  S.TABLE = /** @type {import('../../ranking-table.js').RankingTable} */ (new SPSPRankingTable.RankingTable({
    table: document.getElementById('ranktable'),
    rows: DATA,
    method: S.currentMethod,
    sort: { key: 'rank', dir: 'asc' },
    pageSize: 512,
    infiniteScroll: true,
    totalForRankFrac: 'rows',           // seed: event 参加者数を分母にする
    playerHrefPrefix: SPSP.langRoot,
    showTopTours: SEED_APP_CONFIG.mode !== 'csv',    // csv モードは SPSP 情報を出さない
    showDisplayBadges: SEED_APP_CONFIG.mode !== 'csv',
    showGlobalRank: SEED_APP_CONFIG.mode !== 'csv',
    btWeekdayStyle: 'pill',             // ローカル / メインと同じ 常連 / レア
    columns: SEED_BASE_COLUMNS,
    rowClick: (rec, tr, ev) => seedRowClickHandler(rec, tr, ev),
  }));
  // 手動調整モードの装飾 (背景色・挿入スロット・新規タブリンク) は描画のたびに当てる。
  S.TABLE.on('rendered', () => decorateManualTable());
  return S.TABLE;
}

// discriminator (start.gg 固有ID) 照合用。uid→disc は nightly 生成の discriminators.json
// (優先枠作成ページと同じデータ)。取得失敗は DISC_LOAD_ERROR に保持し、CSV に
// discriminator 列があるのに照合できないときだけ fail-loud でエラーにする。
/** @type {Promise<Record<string, string> | null> | null} */
let _DISC_PROMISE = null;
/** @type {Map<string, number> | null} */
let _DISC2UID = null;           // disc(小文字) → uid (遅延構築)
function loadDiscriminators() {
  if (_DISC_PROMISE) return _DISC_PROMISE;
  _DISC_PROMISE = fetch(SPSP.data + 'data/discriminators.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('discriminators.json HTTP ' + r.status); return r.json(); })
    .then(j => { S.DISCRIMINATORS = j; return j; })
    .catch(e => { S.DISC_LOAD_ERROR = String((e && e.message) || e); return null; });
  return _DISC_PROMISE;
}
export function _disc2uid() {
  if (_DISC2UID || !S.DISCRIMINATORS) return _DISC2UID;
  _DISC2UID = new Map();
  for (const k in S.DISCRIMINATORS) _DISC2UID.set(String(S.DISCRIMINATORS[k]).toLowerCase(), Number(k));
  return _DISC2UID;
}
// CSV セル値 → 正規化 discriminator。"#abc12345" / 大文字のほか、優先枠作成ページの
// 出力形式 ="abc12345" (Excel の指数表記化よけ。パース後は =abc12345) も受け付ける。
/** @param {unknown} v @returns {string} */
export function _csvNormDisc(v) {
  return String(v).trim().replace(/^=/, '').replace(/^"|"$/g, '').replace(/^#/, '').toLowerCase();
}

export async function loadMasterData() {
  if (S.MASTER_MAP) return S.MASTER_MAP;
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));   // 骨格 (10_skeleton.js) に必ずある
  status.textContent = i18n('seed.core.s16');
  const t0 = performance.now();
  // no-cache: デプロイ直後に新 meta と旧 jsonl の混在キャッシュを掴まないよう再検証させる
  // （upcoming.json と同方針。304 で済むので実コストは小さい）。
  const [metaRes, jsonlRes, mergesRes] = await Promise.all([
    fetch(SPSP.data + 'meta.json', { cache: 'no-cache' }),
    fetch(SPSP.data + 'latest_tjpr_full.jsonl', { cache: 'no-cache' }),
    fetch(SPSP.data + 'data/user_merges.json', { cache: 'no-cache' }),
  ]);
  if (!metaRes.ok) throw new Error(i18n('seed.core.s17'));
  if (!jsonlRes.ok) throw new Error(i18n('seed.core.s18'));
  if (!mergesRes.ok) throw new Error(i18n('seed.core.s19'));
  const mergesRaw = await mergesRes.json();
  USER_MERGES_MAP = new Map(
    Object.entries(mergesRaw).map(([k, v]) => [Number(k), Number(v)]));
  MASTER_META = /** @type {SpspRankMeta} */ (await metaRes.json());
  S.META = MASTER_META;  // alias for downstream code
  const footerInfo = document.getElementById('footer-info');
  if (footerInfo) footerInfo.innerHTML =
    `master generated ${S.META.eval_date} · ${S.META.n_players}${i18n('seed.core.t36')} ${S.META.lookback_days}${i18n('seed.core.t37')} ` +
    `<a href="${SPSP.root}${SPSP.pageHref('overview.html')}" style="color:#dc2626">${i18n('seed.core.t38')}</a> · ` +
    `<a href="${SPSP.root}${SPSP.pageHref('details.html')}" style="color:#dc2626">${i18n('seed.core.t39')}</a>`;
  const recs = SPSPData.parseJsonl(await jsonlRes.text());   // ../js/data.js
  status.textContent = `${recs.length}${i18n('seed.core.t40')}`;
  S.MASTER_MAP = new Map();
  for (const rec of recs) S.MASTER_MAP.set(rec.user_id, rec);
  // discriminator 索引 (照合の任意ソース)。失敗しても続行 (照合時に fail-loud)。
  await loadDiscriminators();
  status.textContent = `${i18n('seed.core.t41')}${S.MASTER_MAP.size} ${i18n('seed.core.t42')}${(performance.now()-t0).toFixed(0)}ms)`;
  return S.MASTER_MAP;
}
