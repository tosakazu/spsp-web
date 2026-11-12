// @ts-check
// seeding/app/90_spec.js — SPSP シードツール本体の一部: 📌 シード指定・固定 (spec-panel)、作業状況の保存、トーナメントプレビュー発行。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { SEED_APP_CONFIG, i18n } from './10_skeleton.js';
import { DATA, _csvNormDisc, manualMovedSet, manualOrder, manualParseUid, manualPushOrder, orderedRecs, renderManualUI, saveManual } from './30_core.js';
import { fetchAllSeeds, getToken, render, seedNodeToInfo } from './40_startgg.js';
import { dropAppliedOrder, escHtml, resetSeedOptResultPanel, updateIntraToggleState } from './75_series_rematch.js';
import { CSV_SEAT_COLS, _csvMatchRow, _csvNormName, _csvPick, _csvRecLookups, _csvRowLabel, csvTemplateLines, downloadCsvTemplate, isCsvTemplateSample } from './80_csv_source.js';
import { currentWaveMap, poolLabel, waveLetter, waveOrderReversed } from './85_waves.js';
import SmashSeed from '../../seed-upload/seed_uploader.js';
import { decodeCsvBytes } from '../../js/csv_text.js';
import SeedOptimizer from '../seed_optimizer.js';
import SeedShare from '../seed_share.js';
'use strict';

// ── 📌 シード指定・固定 (spec-panel) ─────────────────────────
// CSV で一部プレイヤーの 順位 (シード番号) / ウェーブ を指定して並びを組み直し、
// 固定 (プール/ウェーブ) を被り回避最適化のハード制約として登録する。
const SPEC_WAVE_COLS = ['wave', 'ウェーブ', 'w'];   // CSV の列名 alias (機械可読なので辞書には出さない)
const SPEC_FIX_COLS = ['固定', 'fix', 'lock', 'pin'];

// ウェーブ指定値 → ウェーブ index (0始まり)。'A'〜'Z' または 1始まり数値。不正は null。
/** @param {unknown} v @returns {number | null} */
function parseWaveValue(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 65;
  const n = parseInt(s, 10);
  return (Number.isFinite(n) && String(n) === s && n >= 1) ? n - 1 : null;
}
// 「◯◯の逆」の参照の照合キー (名前の正規化 / discriminator の ="..." を外す)
/** @param {unknown} v */
function _specRefKey(v) { return String(v).trim().replace(/^="?|"$/g, '').toLowerCase(); }
const CSV_NAME_COLS_SPEC = ['player', 'name', 'display', 'tag', 'プレイヤー', '名前', 'hn', 'short gamertag', 'gamertag'];
// ウェーブ列の「指定しない」の書き方 (警告を出さずに空欄と同じ扱い、2026-11-11)
const WAVE_NONE_RE = /^(指定不可|指定なし|なし|無し|どっちでも|どちらでも|どれでも|any|either|none|no|n\/a|-|ー|—|×)$/i;
// ウェーブ列の「◯◯の逆」(◯◯ と別のウェーブ。◯◯ は CSV の name・discriminator か参加者の名前、2026-11-11)
const WAVE_OPPOSITE_RE = /^(.+?)\s*の逆$|^(?:opposite(?:\s+of)?|not)\s+(.+)$/i;
// seed 列の「ノーシード」(残りの全員より後ろ = 最後尾にまとめる、2026-11-11)
const NOSEED_RE = /^(ノーシード|ノシード|シードなし|no[\s_-]?seed|unseeded)$/i;
// seed 列の「DQ」(2026-11-12): 事前に DQ が決まっている人 (start.gg ではキャンセルにせず残す)。いちばん下のシードにまとめて
// 固定の種類「DQ」を付ける = 最適化で動かさず、被り (地域・再対戦) の計算にも入れない
const DQ_RE = /^(dq|ｄｑ|ＤＱ|事前dq|失格)$/i;
/** 「◯◯の逆」の参照先の文字列 (違えば null) @param {unknown} v @returns {string | null} */
export function parseWaveOpposite(v) {
  const m = v == null ? null : WAVE_OPPOSITE_RE.exec(String(v).trim());
  return m ? String(m[1] || m[2]).trim() || null : null;
}
/** 逆のウェーブ: 2 つなら他方、3 つ以上なら半周先 @param {number} w @param {number} W */
export function oppositeWave(w, W) { return W === 2 ? 1 - w : (w + Math.floor(W / 2)) % W; }
// 固定指定値 → 'pool' | 'wave' | null。明示 (プール/ウェーブ) 優先、
// 汎用 truthy (1/○/true/固定 …) はウェーブ指定行ならウェーブ固定、それ以外はプール固定。
/** @param {unknown} v @param {boolean} hasWave @returns {'pool' | 'wave' | 'seed' | 'dq' | null} */
function parseFixValue(v, hasWave) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === '0' || s === 'no' || s === 'false' || s === 'none' || s === '-' || s === '×') return null;
  if (s === 'wave' || s === 'ウェーブ' || s === 'w') return 'wave';
  if (s === 'pool' || s === 'プール' || s === 'p') return 'pool';
  // シード固定 (2026-11-11): 被り回避の最適化でもシード番号を動かさない
  if (s === 'seed' || s === 'シード' || s === 'シード固定' || s === 's') return 'seed';
  // DQ (2026-11-12): シード固定 + 被りの計算に入れない
  if (s === 'dq' || s === 'ｄｑ' || s === 'ＤＱ') return 'dq';
  return hasWave ? 'wave' : 'pool';
}

// 指定 (順位ピン + ウェーブ割当) を現在の並びに適用した新しい並びを作る (純関数)。
//   curOrder: uid 配列 / pins: [uid, seat1][] / waveOf: [uid, waveIdx][] /
//   P: プール数 / waveMap: プール→ウェーブ / poolOf: (seedIdx0, P) => poolIdx。
// ピンはそのシード位置に固定配置し、残りは現在順のまま空き位置へ。ウェーブ指定者は
// そのウェーブのプールに落ちる最初の空き位置まで待つ (= 現在順位付近に収まる)。
// 満たせない指定は notes (人が読める説明) で返す (黙って握りつぶさない)。
function buildSpecOrder(curOrder, pins, waveOf, P, waveMap, poolOf, noSeed, dq) {
  const N = curOrder.length;
  const out = new Array(N).fill(null);
  const notes = [];
  const pinned = new Set();
  for (const [uid, seat] of pins) {
    const s = seat - 1;
    if (s < 0 || s >= N) { notes.push(`${i18n('seed.spec.t1')}${seat} ${i18n('seed.spec.t2')}`); continue; }
    if (out[s] != null) { notes.push(`${i18n('seed.spec.t1')}${seat} ${i18n('seed.spec.t3')}`); continue; }
    if (pinned.has(uid)) continue;
    out[s] = uid;
    pinned.add(uid);
  }
  // ウェーブ指定を優先する (2026-11-11 ユーザー指定): ウェーブ指定の人は、本来の位置 (今の並びで空きに詰めたときの位置)
  // から下へ見て最初の同じウェーブの空きに置く (シードは下げる方向にだけずらす)。ノーシードの枠に入ってもよい
  // (ノーシードの人は残りの最後にまとまるので、さらに下がる)。下に空きが無いときだけ上の一番近い空きに置き、
  // それも無い (= そのウェーブの枠を使い切った) ときは指定を諦める。残りの人は今の並びの順に空きへ詰め、ノーシードは最後
  // (ノーシードでウェーブ指定もある人は、そのウェーブでいちばん低いシード)。
  // DQ (事前 DQ、2026-11-12): ノーシードよりも下 = いちばん下の空きにまとめる (その中は今の並びの順)。ウェーブは見ない
  const dqTail = dq ? curOrder.filter((u) => dq.has(u) && !pinned.has(u)) : [];
  const dqSet = new Set(dqTail);
  const tail = noSeed ? curOrder.filter((u) => noSeed.has(u) && !pinned.has(u) && !dqSet.has(u)) : [];
  const tailSet = new Set(tail);
  const queue = curOrder.filter((u) => !pinned.has(u) && !tailSet.has(u) && !dqSet.has(u));
  /** @type {number[]} 空きの位置 (上から) */
  const freeSeats = [];
  for (let k = 0; k < N; k++) if (out[k] == null) freeSeats.push(k);
  const waveAt = (/** @type {number} */ k) => (waveMap ? waveMap[poolOf(k, P)] : 0);
  const taken = new Set();
  const placed = new Set();
  let waveGaveUp = 0, movedDown = 0, movedUp = 0, maxDown = 0;
  /** @type {{ uid: number, from: number, to: number }[]} ウェーブのために動かした人 (シード番号は 1 始まり) */
  const moved = [];
  const want = new Map(waveOf);
  for (let j = 0; j < dqTail.length; j++) {
    const i = freeSeats.length - dqTail.length + j;
    taken.add(i); placed.add(dqTail[j]);
    out[freeSeats[i]] = dqTail[j];
  }
  // ノーシード + ウェーブ指定 (2026-11-12 ユーザー指定): ウェーブを優先して、そのウェーブでいちばん低いシードの空きに置く
  // (今の並びで後ろの人から下へ。ほかの人のウェーブ指定より先に枠を取る)。そのウェーブに空きが無ければ指定を諦めて最後尾
  for (let ti = tail.length - 1; ti >= 0; ti--) {
    const u = tail[ti];
    if (!want.has(u)) continue;
    const w = want.get(u);
    let at = -1;
    for (let i = freeSeats.length - 1; i >= 0; i--) if (!taken.has(i) && waveAt(freeSeats[i]) === w) { at = i; break; }
    if (at < 0) { waveGaveUp++; continue; }
    taken.add(at); placed.add(u);
    out[freeSeats[at]] = u;
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    if (!want.has(u)) continue;
    const w = want.get(u);
    const home = qi;   // 本来の位置 = 空きの中で qi 番目
    let at = -1;
    for (let i = home; i < freeSeats.length; i++) if (!taken.has(i) && waveAt(freeSeats[i]) === w) { at = i; break; }
    if (at < 0) for (let i = home - 1; i >= 0; i--) if (!taken.has(i) && waveAt(freeSeats[i]) === w) { at = i; break; }
    if (at < 0) { waveGaveUp++; continue; }
    taken.add(at); placed.add(u);
    out[freeSeats[at]] = u;
    if (at !== home && home < freeSeats.length) moved.push({ uid: u, from: freeSeats[home] + 1, to: freeSeats[at] + 1 });
    if (at > home) { movedDown++; maxDown = Math.max(maxDown, freeSeats[at] - freeSeats[home]); } else if (at < home) movedUp++;
  }
  // 残り: 今の並びの順に空きへ詰め、ノーシードは最後
  const rest = queue.filter((u) => !placed.has(u)).concat(tail.filter((u) => !placed.has(u)));
  let r = 0;
  for (let i = 0; i < freeSeats.length; i++) if (!taken.has(i)) out[freeSeats[i]] = rest[r++];
  /** @type {string[]} 注意ではないお知らせ (ウェーブのために下げた) */
  const info = [];
  if (movedDown) info.push(i18n('seed.spec.wave_moved_down', { n: movedDown, max: maxDown }));
  if (movedUp) notes.push(i18n('seed.spec.wave_moved_up', { n: movedUp }));
  if (waveGaveUp) notes.push(`${i18n('seed.spec.t4')} ${waveGaveUp}${i18n('seed.spec.t5')}`);
  return { order: out, notes, info, moved };
}

// 固定 (対象付き) を満たすよう並びを組み直す (純関数・挿入ソート方式)。
//   order: uid 配列 / locks: {uid: {kind:'pool'|'wave', target} | 'pool'|'wave' (旧形式=移動なし)}
//   / P: プール数 / waveMap: プール→ウェーブ / poolOf: (seedIdx0, P) => poolIdx。
// 位置を前から埋め、固定者は対象プール/ウェーブのスロットが来るまで待つ (他は現在順のまま)。
// 入力が既に固定を満たしていれば恒等 (冪等)。枠が足りない対象は overflow で返す
// ({kind, target, cap, want})。入りきらない人は元の位置に残す。
export function enforceSeedLocks(order, locks, P, waveMap, poolOf) {
  const N = order.length;
  const need = new Map();   // uid → {pool} | {wave}
  for (const u of order) {
    const l = locks[u];
    if (!l) continue;
    const kind = l.kind || l;
    if (kind === 'seed' || kind === 'dq') continue;   // シード固定・DQ: 並びの位置そのものを固定 (最適化で動かさないだけ。射影では寄せない)
    const target = (l && l.target != null) ? l.target : null;
    if (target == null) continue;   // 旧形式/対象なし: 現位置のまま (移動しない)
    need.set(u, kind === 'pool' ? { pool: target } : { wave: target });
  }
  if (!need.size) return { order: order.slice(), overflow: [] };
  // 枠数 (= その対象に落ちるシード位置の数) と固定人数を数え、超過分を overflow で返す。
  const capOf = new Map();   // 'pool:3' → 枠数
  for (let s2 = 0; s2 < N; s2++) {
    const pool = poolOf(s2, P);
    const wave = waveMap ? waveMap[pool] : 0;
    capOf.set('pool:' + pool, (capOf.get('pool:' + pool) || 0) + 1);
    capOf.set('wave:' + wave, (capOf.get('wave:' + wave) || 0) + 1);
  }
  const wantOf = new Map();
  need.forEach((nd) => {
    const key = nd.pool != null ? 'pool:' + nd.pool : 'wave:' + nd.wave;
    wantOf.set(key, (wantOf.get(key) || 0) + 1);
  });
  const overflow = [];
  wantOf.forEach((want, key) => {
    const cap = capOf.get(key) || 0;
    if (want > cap) {
      const [kind, t] = key.split(':');
      // uids は「その対象に固定された全員」。実際に諦めた人は下の配置ループで dropped に入る。
      const uids = [];
      need.forEach((nd, u) => {
        if ((nd.pool != null ? 'pool:' + nd.pool : 'wave:' + nd.wave) === key) uids.push(u);
      });
      overflow.push({ kind, target: Number(t), cap, want, uids, dropped: [] });
    }
  });
  const overflowByKey = new Map(overflow.map((o) => [o.kind + ':' + o.target, o]));
  const out = new Array(N).fill(null);
  // シード固定・DQ の人は今の席のまま (2026-11-12)。以前はほかの人と同じに前へ詰めていたので、枠待ちの固定者が
  // 居ると席がずれ、DQ (最下位のはず) より下に枠待ちの人が来ることがあった
  const held = new Set();
  for (let s = 0; s < N; s++) {
    const l = locks[order[s]];
    const kind = l && (l.kind || l);
    if (kind === 'seed' || kind === 'dq') { out[s] = order[s]; held.add(order[s]); }
  }
  const queue = held.size ? order.filter((u) => !held.has(u)) : order.slice();
  let lockedLeft = need.size;
  for (let s = 0; s < N; s++) {
    if (out[s] != null) continue;
    if (!lockedLeft) { out[s] = queue.shift(); continue; }   // 残り固定なし: そのまま流す
    const pool = poolOf(s, P);
    const wave = waveMap ? waveMap[pool] : 0;
    let k = -1;
    for (let q = 0; q < queue.length; q++) {
      const nd = need.get(queue[q]);
      if (!nd || (nd.pool != null ? nd.pool === pool : nd.wave === wave)) { k = q; break; }
    }
    // 置ける人が居ない (= 枠不足) ときは先頭の 1 人だけ諦めてここに置く。
    // 他の固定は活かす (以前は全部諦めていた)。
    const gaveUp = k < 0;
    if (gaveUp) k = 0;
    const picked = queue.splice(k, 1)[0];
    if (need.has(picked)) {
      if (gaveUp) {   // 指定どおりに置けなかった人 (= 誰が影響を受けたか) を記録
        const nd = need.get(picked);
        const o = overflowByKey.get(nd.pool != null ? 'pool:' + nd.pool : 'wave:' + nd.wave);
        if (o) o.dropped.push(picked);
      }
      need.delete(picked); lockedLeft--;
    }
    out[s] = picked;
  }
  // 対象が存在しない (cap 0) 場合は全員が指定を反映できていない。
  for (const o of overflow) if (o.cap === 0) o.dropped = o.uids.slice();
  return { order: out, overflow };
}

/** @param {string} html @param {boolean} [isErr] */
function _specStatus(html, isErr) {
  const el = document.getElementById('spec-status');
  if (el) { el.innerHTML = html || ''; el.style.color = isErr ? '#dc2626' : '#374151'; }
}
// 現在の SEED_SPEC の要約を表示 (復元時・クリア時)。
export function renderSpecStatus() {
  if (!S.SEED_SPEC) { _specStatus(''); return; }
  const n = (o) => Object.keys(o || {}).length;
  _specStatus(`📌 ${S.SEED_SPEC.label ? escHtml(S.SEED_SPEC.label) + ': ' : ''}` +
    `${i18n('seed.spec.t6')} ${n(S.SEED_SPEC.pins)} ${i18n('seed.spec.t7')} ${n(S.SEED_SPEC.waves)} ${i18n('seed.spec.t8')} ${n(S.SEED_SPEC.locks)}${i18n('seed.spec.t9')}`);
}

// 作業状況 CSV (エクスポート) の pools / waves 列があれば設定に反映する。共有された CSV を読むだけで同じ
// プール構成になる。戻り値 = 変更内容の説明 (無ければ空)。spec CSV と順位 CSV の両方の適用で使う
// (以前は順位 CSV 側で未定義の settingNotes を参照して ReferenceError になっていた)。
/** @param {Record<string, string>[]} rows @returns {string[]} */
export function _applyCsvSettingColumns(rows) {
  /** @type {string[]} */
  const settingNotes = [];
  for (const [col, id, label2] of [['pools', 'so-pools', i18n('seed.spec.s4')], ['waves', 'so-waves', i18n('seed.spec.s5')]]) {
    const row = rows.find((r) => _csvPick(r, [col]) != null);
    const v = row ? parseInt(/** @type {string} */ (_csvPick(row, [col])), 10) : NaN;   // row は _csvPick != null で選んである
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el && Number.isFinite(v) && v >= 1 && String(v) !== String(el.value)) {
      el.value = String(v);
      settingNotes.push(`${label2}${i18n('seed.spec.t10')} ${v} ${i18n('seed.spec.t11')}`);
    }
  }
  // ウェーブの並び (wave_order 列がある CSV だけ。rev = 逆から、それ以外 (a・空) = A から)
  const orderRow = rows.find((r) => _csvPick(r, ['pools']) != null || _csvPick(r, ['waves']) != null);
  const orderEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-wave-order'));
  if (orderEl && orderRow && rows.some((r) => Object.keys(r).some((k) => String(k).trim().toLowerCase() === 'wave_order'))) {
    const v = String(_csvPick(orderRow, ['wave_order']) || '').trim().toLowerCase() === 'rev' ? 'rev' : '';
    if (v !== orderEl.value) {
      orderEl.value = v;
      settingNotes.push(`${i18n('seed.skeleton.wave_order')}${i18n('seed.spec.t10')} ${i18n(v ? 'seed.skeleton.wave_order_b' : 'seed.skeleton.wave_order_a')} ${i18n('seed.spec.t11')}`);
    }
  }
  if (settingNotes.length) updateIntraToggleState();
  return settingNotes;
}

// spec CSV の行を適用: 照合 → 順位/ウェーブ/固定を抽出 → 並び組み直し + SEED_SPEC 更新。
/** @param {Record<string, string>[]} rows @param {string} label */
function applySpecRows(rows, label) {
  if (!DATA.length) { _specStatus(i18n('seed.spec.s6'), true); return; }
  // 作業状況 CSV (エクスポート) の pools / waves 列があれば設定に反映してから解釈する。
  // 共有された CSV を読むだけで同じプール構成になる。
  const settingNotes = _applyCsvSettingColumns(rows);
  const P = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  const waveMap = currentWaveMap(P);
  const W = waveMap.reduce((mx, w) => Math.max(mx, w), 0) + 1;
  const lk = _csvRecLookups();
  const pins = new Map(), waveOf = new Map(), locks = {};
  const unmatched = [], problems = [], ambiguous = [];
  let discUnavailable = false;
  let sampleRows = 0;   // テンプレートの記入例が残っていた行 (無視 + 警告)
  let matchedRows = 0;
  const noSeed = new Set();
  const dq = new Set();   // seed 列が「DQ」の人
  /** @type {string[]} */
  const infos = [];
  let waveOver = 0;   // ウェーブ数より大きいウェーブの指定 (ウェーブ数を入れ忘れて読んだとき)
  /** @type {{ u: number, rec: any, ref: string, seat: number | null, fixV: unknown }[]} 「◯◯の逆」(全行を読んでから決める) */
  const opposites = [];
  /** CSV の行の名前・discriminator → 参加者 (「◯◯の逆」の参照先。参加者の start.gg の名前と違う呼び方でも引ける) */
  const csvRef = new Map();
  /** CSV の name が同じで別の人を指している行がある名前 (「◯◯の逆」では使えない = エラーにする、2026-11-12) */
  const csvRefAmb = new Set();
  /** CSV の discriminator → 参加者 (「◯◯の逆」を discriminator で書いたとき) */
  const csvDiscRef = new Map();
  for (const row of rows) {
    if (isCsvTemplateSample(row)) { sampleRows++; continue; }
    const m = _csvMatchRow(row, lk);
    if (m.discUnavailable) { discUnavailable = true; continue; }
    const rec = m.rec;
    if (m.ambiguousName != null) { ambiguous.push(m.ambiguousName); continue; }
    if (!rec) { unmatched.push(_csvRowLabel(row)); continue; }
    if (rec.user_id == null) { problems.push(`${rec.display}${i18n('seed.spec.t12')}`); continue; }
    matchedRows++;
    const u = rec.user_id;
    const refName = _csvPick(row, CSV_NAME_COLS_SPEC), refDisc = _csvPick(row, ['discriminator', 'disc']);
    if (refName != null && String(refName).trim()) {
      const k = _specRefKey(refName);
      if (csvRef.has(k) && csvRef.get(k).user_id !== rec.user_id) csvRefAmb.add(k);
      else csvRef.set(k, rec);
    }
    if (refDisc != null && String(refDisc).trim()) csvDiscRef.set(_csvNormDisc(refDisc), rec);
    /** @type {number | null} */
    let seat = null;
    const seatV = _csvPick(row, CSV_SEAT_COLS);
    if (seatV != null && DQ_RE.test(String(seatV).trim())) {
      dq.add(u);
      locks[u] = 'dq';   // ウェーブ・lock 列は見ない (いちばん下に固定)
      continue;
    } else if (seatV != null && NOSEED_RE.test(String(seatV).trim())) {
      noSeed.add(u);
    } else if (seatV != null) {
      const nn = parseInt(seatV, 10);
      if (Number.isFinite(nn) && nn >= 1 && nn <= DATA.length) seat = nn;
      else problems.push(`${rec.display}${i18n('seed.spec.t13')}${seatV})`);
    }
    /** @type {number | null} */
    let wIdx = null;
    const waveV = _csvPick(row, SPEC_WAVE_COLS);
    const oppRef = waveV != null ? parseWaveOpposite(waveV) : null;
    if (oppRef) {
      // 「◯◯の逆」: 参照先のウェーブは全行を読んでから決める (下の opposites)
      opposites.push({ u, rec, ref: oppRef, seat, fixV: _csvPick(row, SPEC_FIX_COLS) });
    } else if (waveV != null && WAVE_NONE_RE.test(String(waveV).trim())) {
      // 指定不可・どっちでも = 指定しない
    } else if (waveV != null) {
      wIdx = parseWaveValue(waveV);
      if (wIdx != null && wIdx >= W) waveOver++;
      if (wIdx == null || wIdx >= W) { problems.push(`${rec.display}${i18n('seed.spec.t14')}${waveV})`); wIdx = null; }
    }
    if (seat != null) {
      pins.set(u, seat);
      if (wIdx != null && SeedOptimizer &&
          waveMap[SeedOptimizer.poolOfSeed(seat - 1, P)] !== wIdx) {
        problems.push(`${rec.display}${i18n('seed.spec.t15')}${seat} ${i18n('seed.spec.t16')} ${waveLetter(wIdx)} ${i18n('seed.spec.t17')}`);
      }
    } else if (wIdx != null) {
      waveOf.set(u, wIdx);
    }
    const fixV = _csvPick(row, SPEC_FIX_COLS);
    const fx = parseFixValue(fixV, wIdx != null);
    if (fx === 'wave' && W < 2) {
      problems.push(`${rec.display}${i18n('seed.spec.t18')}`);
      locks[u] = 'pool';
    } else if (fx) {
      locks[u] = fx;
    }
  }
  // 「◯◯の逆」: ◯◯ のウェーブ (CSV で指定 > シード番号の指定 > 今の並び) の逆に置く。◯◯ にウェーブの指定が無い
  // (指定不可・シードが高くて動かせない) ときは、今の並び (既定のランキング) の位置に ◯◯ を固定して、その逆にする (2026-11-11)
  if (opposites.length) {
    const curOrder0 = orderedRecs().map((r) => r.user_id);
    const poolOfS0 = (s0) => (SeedOptimizer ? SeedOptimizer.poolOfSeed(s0, P) : 0);
    for (const o of opposites) {
      // ◯◯ の探し方: discriminator (一意) → CSV の name → 参加者の start.gg の名前。名前が複数の人に当たるときは
      // 選ばずにエラー (どちらの逆か決められない。discriminator で書いてもらう、2026-11-12)
      const key = _specRefKey(o.ref), disc = _csvNormDisc(o.ref), nm = _csvNormName(o.ref);
      const byDiscRec = csvDiscRef.get(disc) || (lk.byDisc ? lk.byDisc.get(disc) : null) || null;
      const ambiguousRef = !byDiscRec && (csvRefAmb.has(key) || (!csvRef.has(key) && lk.dupNames.has(nm)));
      const refRec = byDiscRec || (ambiguousRef ? null : (csvRef.get(key) || lk.byName.get(nm) || null));
      if (W < 2) { problems.push(`${o.rec.display}: ${i18n('seed.spec.opp_no_wave')}`); continue; }
      if (ambiguousRef) { problems.push(`${o.rec.display}: ${i18n('seed.spec.opp_ambiguous', { name: o.ref })}`); continue; }
      if (!refRec || refRec.user_id == null) { problems.push(`${o.rec.display}: ${i18n('seed.spec.opp_not_found', { name: o.ref })}`); continue; }
      const r = refRec.user_id;
      if (r === o.u) continue;
      let rw = waveOf.has(r) ? /** @type {number} */ (waveOf.get(r)) : null;
      if (rw == null && pins.has(r)) rw = waveMap[poolOfS0(pins.get(r) - 1)];
      if (rw == null) {
        // ◯◯ を今の並びの位置 (既定のランキングのシード) に固定する
        const pos = curOrder0.indexOf(r);
        if (pos < 0) { problems.push(`${o.rec.display}: ${i18n('seed.spec.opp_not_found', { name: o.ref })}`); continue; }
        if (!noSeed.has(r)) { pins.set(r, pos + 1); if (!locks[r]) locks[r] = 'wave'; }
        rw = waveMap[poolOfS0(pos)];
      }
      const wIdx = oppositeWave(/** @type {number} */ (rw), W);
      if (o.seat != null) {
        if (waveMap[poolOfS0(o.seat - 1)] !== wIdx) problems.push(`${o.rec.display}${i18n('seed.spec.t15')}${o.seat} ${i18n('seed.spec.t16')} ${waveLetter(wIdx)} ${i18n('seed.spec.t17')}`);
      } else {
        waveOf.set(o.u, wIdx);   // ノーシードの人も (そのウェーブでいちばん低いシードに置く、2026-11-12)
      }
      // 「◯◯の逆」はウェーブで固定する (被り回避の最適化でも逆のまま。lock 列に pool と書いてあればそちら)
      const fx = parseFixValue(o.fixV, true);
      locks[o.u] = fx || 'wave';
    }
  }
  // ウェーブ数を入れ忘れて読んだ: 1 件ずつの警告より先に、何をすればよいかを出す (2026-11-11)
  if (waveOver || (W < 2 && opposites.length)) problems.unshift(i18n('seed.spec.wave_count_hint', { w: W, n: waveOver + (W < 2 ? opposites.length : 0) }));
  // discriminator 列があるのに照合データが無い = エラー (黙って名前照合等に劣化させない)。
  if (discUnavailable) {
    _specStatus(`${i18n('seed.spec.t19')}` +
      `${S.DISC_LOAD_ERROR ? ` (${escHtml(S.DISC_LOAD_ERROR)})` : ''}${i18n('seed.spec.t20')}`, true);
    return;
  }
  // 名前の被り = エラー (何も適用しない)。黙って別人に指定が付くのを防ぐ。
  if (ambiguous.length) {
    _specStatus(`${i18n('seed.spec.t21')} ` +
      `${[...new Set(ambiguous)].map(escHtml).join(', ')}` +   // 省略しない (2026-11-11)
      i18n('seed.spec.s7'), true);
    return;
  }
  if (!matchedRows) {
    _specStatus(i18n('seed.spec.s8'), true);
    return;
  }
  // 順位/ウェーブ指定があれば現在の出力順を組み直して手動調整 base に取り込む。
  if (pins.size || waveOf.size || noSeed.size || dq.size) {
    // 手動調整の 1 手として積むので「元に戻す」で戻せる (確認は出さない、2026-11-11)
    const curOrder = orderedRecs().map(r => r.user_id);
    const { order, notes, info, moved } = buildSpecOrder(curOrder, [...pins], [...waveOf], P, waveMap,
      (s, PP) => (SeedOptimizer ? SeedOptimizer.poolOfSeed(s, PP) : 0), noSeed, dq);
    problems.push(...notes);
    infos.push(...info);
    // 誰をどれだけ動かしたか (上位から。下げるのは順位の高い指定者から順に近い枠を取った残り = 下位の指定者ほど下がる)
    const nameOf = new Map(DATA.map((r) => [r.user_id, r.display]));
    for (const m of moved) infos.push(i18n('seed.spec.wave_moved_one', { name: nameOf.get(m.uid) || String(m.uid), from: m.from, to: m.to }));
    manualPushOrder(order, 'spec');
    if (S.SEEDOPT_RESULT) resetSeedOptResultPanel(i18n('seed.spec.s10'));
  } else if (Object.keys(locks).length && !S.MANUAL) {
    // 固定のみの CSV: 現在の並びを手動調整として取り込む (手動列に射影後の位置と
    // 📌バッジが出て、固定の効果が見えるようにする)。
    S.MANUAL = { base: orderedRecs().map(r => r.user_id), ops: [], hpos: 0, committed: true, editing: false, sel: null, src: 'spec' };
    dropAppliedOrder();
  }
  // 固定を {kind, target} 形式で確定する。対象 = ウェーブ列があればその値、無ければ
  // 配置後の位置のプール/ウェーブ。以後は読み取り時射影が並びを常にこの対象へ寄せる。
  const lockObjs = {};
  if (Object.keys(locks).length) {
    const placedOrder = (pins.size || waveOf.size || noSeed.size || dq.size)
      ? manualOrder()   // 直前で手動調整に積んだ並び
      : orderedRecs().map(r => r.user_id);
    const poolOfS = (s) => (SeedOptimizer ? SeedOptimizer.poolOfSeed(s, P) : 0);
    for (const k in locks) {
      const u = manualParseUid(k);
      const kind = locks[k];
      if (kind === 'seed' || kind === 'dq') { lockObjs[u] = { kind, target: null }; continue; }
      let target;
      if (kind === 'wave' && waveOf.has(u)) {
        target = waveOf.get(u);
      } else {
        const pos = placedOrder.indexOf(u);
        const pool = pos >= 0 ? poolOfS(pos) : 0;
        target = kind === 'pool' ? pool : waveMap[pool];
      }
      lockObjs[u] = { kind, target };
    }
  }
  S.SEED_SPEC = {
    label,
    pins: Object.fromEntries(pins),
    waves: Object.fromEntries(waveOf),
    locks: lockObjs,
    noseed: [...noSeed],
  };
  saveManual();
  render();
  let msg = `✅ ${escHtml(label)}: ${matchedRows}${i18n('seed.spec.t22')} ` +
    `${i18n('seed.spec.t6')} ${pins.size} ${i18n('seed.spec.t7')} ${waveOf.size} ${i18n('seed.spec.t8')} ${Object.keys(locks).length}${i18n('seed.spec.t23')}`
    + (noSeed.size ? ` ${i18n('seed.spec.noseed_count', { n: noSeed.size })}` : '')
    + (dq.size ? ` ${i18n('seed.spec.dq_count', { n: dq.size })}` : '');
  if (settingNotes.length) msg += ` ${i18n('seed.spec.t24')}${settingNotes.join('・')})`;
  if (sampleRows) msg += ` ${i18n('seed.spec.t25')} ${sampleRows}${i18n('seed.spec.t26')}`;
  if (unmatched.length) {
    // 未照合・注意は省略せずに全部出す (注意は 1 件 1 行、2026-11-11)
    msg += ` ${i18n('seed.spec.t27')} ${unmatched.length}${i18n('seed.spec.t28')} ${unmatched.map(escHtml).join(', ')}`;
  }
  if (problems.length) {
    msg += problems.map((p) => `<br>⚠ ${escHtml(p)}`).join('');
  }
  if (infos.length) {
    msg += infos.map((p) => `<br>ℹ ${escHtml(p)}`).join('');
  }
  _specStatus(msg, false);
  const st = document.getElementById('status');
  if (st) st.textContent = i18n('seed.spec.s11');
}

async function loadSpecSource() {
  try {
    const fileEl = /** @type {HTMLInputElement | null} */ (document.getElementById('spec-src-file'));
    const url = (/** @type {HTMLInputElement} */ (document.getElementById('spec-src-url')).value || '').trim();   // 骨格 (10_skeleton.js) に必ずある
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
        text = decodeCsvBytes(await res.arrayBuffer());   // Shift_JIS の CSV もある (2026-11-11)
        label = 'CSV URL';
      }
    } else {
      _specStatus(i18n('seed.spec.s12'), true);
      return;
    }
    const parsed = SmashSeed.parseCsv(text);
    const rows = parsed.rows || [];
    if (!rows.length) throw new Error(i18n('seed.spec.s13'));
    applySpecRows(rows, label);
  } catch (e0) {
    const e = /** @type {any} */ (e0);
    _specStatus(i18n('seed.spec.s14') + escHtml((e && e.message) ? e.message : e), true);
  }
}

// 現在の作業状況 (シード順 + 固定 + プール/ウェーブ設定) を CSV に書き出す。
// 読み込み側 (applySpecRows) が理解する列だけを使うので、そのままインポートすれば
// 同じ状態を再現できる = 他の人との共有に使える。
//   seed  : シード番号 (順序の復元に使う)
//   name / discriminator / uid : 参加者の照合 (uid → disc → name の順で使われる)
//   lock  : pool / wave / 空 (固定の種別。対象は seed 順から決まる)
//   pool  : 参考表示 (A3 / P3。読み込み時は無視される)
//   pools / waves : プール数・ウェーブ数 (1 行目のみ。読み込み時に設定へ反映)
//   wave_order    : ウェーブの並び。rev = 逆から (B, A, A, B, …、既定) / a = A から。1 行目のみ。列が無い CSV は今の設定のまま
function exportSeedWorkCsv() {
  if (!DATA.length) { _specStatus(i18n('seed.spec.s15'), true); return; }
  const recs = orderedRecs();
  const P = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  const waveMap = currentWaveMap(P);
  const W = waveMap.reduce((m, w) => Math.max(m, w), 0) + 1;
  const locks = (S.SEED_SPEC && S.SEED_SPEC.locks) || {};
  const field = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ['seed,name,discriminator,uid,lock,pool,pools,waves,wave_order'];
  recs.forEach((r, i) => {
    const lk = locks[r.user_id];
    const kind = lk ? (lk.kind || lk) : '';
    // disc は ="..." で書く (Excel / Sheets が指数表記の数値に化けさせるのを防ぐ)。
    const disc = r.discriminator || (S.DISCRIMINATORS && S.DISCRIMINATORS[String(r.user_id)]) || '';
    lines.push([
      i + 1,
      field(r.display),
      disc ? '="' + disc + '"' : '',
      (r.user_id != null && r.user_id > 0) ? r.user_id : '',
      kind,
      field(P >= 2 ? poolLabel(SeedOptimizer.poolOfSeed(i, P), waveMap) : ''),
      i === 0 ? P : '',
      i === 0 ? W : '',
      i === 0 ? (waveOrderReversed() ? 'rev' : 'a') : '',
    ].join(','));
  });
  const name = ((S.EVENT_CONTEXT && S.EVENT_CONTEXT.eventName) || (S.CSV_SOURCE && S.CSV_SOURCE.label) || 'seed')
    .replace(/[^\w\-]/g, '_').slice(0, 40);
  downloadCsvTemplate(lines, `spsp_seed_work_${name}.csv`);
  const nLock = recs.filter(r => locks[r.user_id]).length;
  const msg = `${recs.length}${i18n('seed.spec.t29')}${nLock ? ` ${i18n('seed.spec.t30')} ${nLock}${i18n('seed.spec.t31')}` : ''}` +
    `${S.APPLIED_ORDER ? i18n('seed.spec.s26') : ''} ${i18n('seed.spec.t32')}`;
  const note = document.getElementById('work-note');
  if (note) note.textContent = '✅ ' + msg;
  _specStatus('💾 ' + msg);
}

// 🏆 トーナメントプレビュー: 現在の出力順 (orderedRecs) + プール数/ウェーブを
// ペイロード化して site/bracket/ へのリンクを発行する (別タブ + クリップボード)。
// フェーズ区切り (Top カット) の追加はプレビューページ側で編集できる。
// プレビュー URL の長さ上限 (これを超えたら名前の同梱を DB 未登録者だけに落とす)。
// プレビュー側も 9,500 字超で「共有には CSV 推奨」と出すので、それと揃えている。
const BRACKET_URL_BUDGET = 9500;

/**
 * @param {{ recs?: any[], pools?: number | null, applied?: boolean } | Event} [opts] recs = この並びで (適用後に start.gg から読み直した並び)。
 *   ボタンのクリックから呼ばれたとき (Event) は今の出力順
 */
async function issueBracketPreview(opts) {
  const o = opts && !(opts instanceof Event) ? opts : {};
  const note = document.getElementById('work-note');
  const say = (m) => { if (note) note.textContent = m; };
  if (!DATA.length) { say(i18n('seed.spec.s15')); return; }
  if (typeof SeedShare === 'undefined') { say(i18n('seed.spec.s16')); return; }
  try {
    const recs = o.recs || orderedRecs();
    const P = Math.max(1, (Number(o.pools) | 0) || parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
    const waveMap = currentWaveMap(P);
    const uids = recs.map((r) => (r.user_id != null && r.user_id > 0) ? r.user_id : null);
    // 表示名。uid が無い参加者は URL に名前が無いと誰か分からなくなるので必ず入れる。
    const nameAt = (r, i) => r.display || (uids[i] == null ? i18n('seed.spec.s17') + (i + 1) : '');
    // 名前は原則 全員分を URL に載せる。プレビュー側が players/<uid>.json を
    // 取れなくても (回線・DB 未登録・上位帯の巨大 JSON) 名前だけは必ず出せるようにするため。
    // 規模が大きく URL が共有に耐えなくなる場合だけ、DB 登録者を落として uid 復元に任せる
    // (そのときはプール当たりの人数が小さいので、プレビュー側の取得も軽い)。
    const fullNames = {}, minimalNames = {};
    recs.forEach((r, i) => {
      const nm = nameAt(r, i);
      if (!nm) return;
      fullNames[String(i)] = nm;
      if (uids[i] == null || !S.MASTER_MAP || !S.MASTER_MAP.has(uids[i])) minimalNames[String(i)] = nm;
    });
    // フェーズ構成: start.gg から取れた連鎖 (通過人数込み) があればそれを初期値にする。
    // 使えない場合は従来の既定 (adv=2 + 自動最終フェーズ) にするが、**理由は必ず表示する**
    // (黙って劣化させない)。
    /** @type {SpspSeedPhaseConfig[] | null} */
    let phases = null;
    let phasesFromGg = false;
    let phasesGgNote = '';
    const fetched = S.EVENT_CONTEXT && S.EVENT_CONTEXT.phasesConfig;
    if (fetched && fetched.length >= 2) {
      if ((fetched[0].pools | 0) !== P) {
        phasesGgNote = `${i18n('seed.spec.t33')} ${fetched[0].pools}${i18n('seed.spec.t34')} ${P} ${i18n('seed.spec.t35')}`;
      } else {
        const cand = SeedShare.withFinalPhase(fetched.map((p) => Object.assign({}, p)), recs.length);
        const errs = SeedShare.validatePhases(cand, recs.length);
        if (errs.length) {
          phasesGgNote = `${i18n('seed.spec.t36')}${errs[0]})。`;
        } else {
          phases = cand;
          phasesFromGg = true;
        }
      }
    }
    if (!phases) {
      // プールが 2 つ以上なら、その先の 1 プールのフェーズまで作る (そこで終われないため)
      phases = SeedShare.withFinalPhase([{ name: P >= 2 ? i18n('seed.spec.s18') : i18n('seed.spec.s19'), pools: P, adv: 2 }], recs.length);
    }
    const payload = {
      v: 1,
      ev: (S.EVENT_CONTEXT && S.EVENT_CONTEXT.eventName) || (S.CSV_SOURCE && S.CSV_SOURCE.label) || i18n('seed.spec.s20'),
      src: SEED_APP_CONFIG.mode,
      phases,
      wv: waveMap,
      uids, names: fullNames,
    };
    // start.gg のフェーズの id (あれば、プレビューが start.gg の構造をそのまま読んで同じ形の表を出す。2026-11-05)
    const chainIds = S.EVENT_CONTEXT && Array.isArray(S.EVENT_CONTEXT.phaseChain) ? S.EVENT_CONTEXT.phaseChain : [];
    // start.gg から取れたフェーズ構成をそのまま使っているときだけ (カスタムした・取りようがないときは載せない = ログインなしで SPSP の組み方。2026-11-05)
    //   2 フェーズ以上: start.gg の連鎖 (phasesFromGg) / 1 フェーズ: プール数が start.gg のプール数と同じ
    const ggPools = S.EVENT_CONTEXT && S.EVENT_CONTEXT.poolCount;
    const fromGg = chainIds.length >= 2 ? phasesFromGg : chainIds.length === 1 && !!ggPools && !!phases && (phases[0].pools | 0) === ggPools;
    if (fromGg) /** @type {any} */ (payload).sgg = chainIds;
    const bracketUrl = new URL(SPSP.langRoot + 'bracket/', location.href).toString();
    let blob = await SeedShare.encodePayload(payload);
    let url = bracketUrl + SeedShare.buildFragment({ ph: 0, wd: 1 }, blob);
    let trimmed = false;
    if (url.length > BRACKET_URL_BUDGET) {
      payload.names = minimalNames;
      blob = await SeedShare.encodePayload(payload);
      url = bracketUrl + SeedShare.buildFragment({ ph: 0, wd: 1 }, blob);
      trimmed = true;
    }
    window.open(url, '_blank', 'noopener');
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* clipboard 不可の環境 */ }
    // データ版: 共有相手と「同じデータを見ているか」を突き合わせるための値。
    // プレビューページのヘッダにも同じものが出る。
    const ver = SeedShare.payloadVersion(payload);
    say(`${i18n('seed.spec.t37')}${ver ? i18n('seed.spec.s27') + ver + ' / ' : ''}${recs.length}${i18n('seed.spec.t38')} ${url.length.toLocaleString()}${i18n('seed.spec.t39')}${copied ? i18n('seed.spec.s28') : ''})。` +
      (trimmed ? i18n('seed.spec.s21') : '') +
      (phasesFromGg
        ? `${i18n('seed.spec.t40')}${/** @type {SpspSeedPhaseConfig[]} */ (phases).map((p) => p.name).join(' → ')}${i18n('seed.spec.t41')}`
        : (phasesGgNote ? phasesGgNote + ' ' : '') +
          i18n('seed.spec.s22')));
  } catch (e0) {
    const e = /** @type {any} */ (e0);
    say(i18n('seed.spec.s23') + (e && e.message));
  }
}

// ── トーナメントプレビューのメニュー (2026-11-10) ──
// どの並びで組むかを選ぶ:
//   current   = 表示中のシード (今の表の並び = orderedRecs)
//   optimized = 被り回避最適化後のシード (最適化の結果があるときだけ。反映を外した・手動調整を再開したあとでも結果の並びで出せる)
//   startgg   = start.gg 上のシード (API で今のシードを読む。start.gg の大会を読み込んでいるときだけ)

/** 各項目を選べるか。選べないときは理由の文言 @returns {{ current: string | null, optimized: string | null, startgg: string | null }} */
export function bracketPreviewAvailability() {
  const opt = S.SEEDOPT_RESULT && Array.isArray(S.SEEDOPT_RESULT.seedOrder) && S.SEEDOPT_RESULT.seedOrder.length;
  const ctx = S.EVENT_CONTEXT;
  return {
    current: null,
    optimized: opt ? null : i18n('seed.preview.opt_disabled'),
    startgg: !ctx ? i18n('seed.preview.gg_disabled') : ctx.phaseId == null ? i18n('seed.preview.gg_no_phase') : null,
  };
}

/** 被り回避最適化の結果の並び (結果に無い人は後ろ) */
function optimizedRecs() {
  const order = /** @type {SpspSeedOptResult} */ (S.SEEDOPT_RESULT).seedOrder;
  const pos = new Map(order.map((u, i) => [u, i]));
  const at = (r) => (pos.has(r.user_id) ? /** @type {number} */ (pos.get(r.user_id)) : 1e9);
  return DATA.slice().sort((a, b) => at(a) - at(b));
}

/** start.gg に入っている今のシードを読んで、その並びで開く @param {string} token @param {number | string} phaseId */
async function previewStartggSeeds(token, phaseId) {
  const note = document.getElementById('work-note');
  try {
    if (note) note.textContent = i18n('seed.spec.applied_loading');
    const nodes = await fetchAllSeeds(token, phaseId);
    const infos = nodes.map(seedNodeToInfo).sort((a, b) => (a.originalSeed || 0) - (b.originalSeed || 0));
    const recs = infos.map((si) => ({ user_id: si.userId, display: si.display }));
    await issueBracketPreview({ recs, pools: S.EVENT_CONTEXT && S.EVENT_CONTEXT.poolCount, applied: true });
  } catch (err) {
    if (note) note.textContent = i18n('seed.spec.applied_error') + ' ' + String((err && /** @type {any} */ (err).message) || err);
  }
}

/** メニューの項目を選んだとき @param {'current' | 'optimized' | 'startgg'} kind */
export function runBracketPreviewChoice(kind) {
  closeBracketPreviewMenu();
  if (bracketPreviewAvailability()[kind]) return;
  if (kind === 'current') return issueBracketPreview();
  if (kind === 'optimized') return issueBracketPreview({ recs: optimizedRecs() });
  const token = getToken();
  if (!token) {
    const note = document.getElementById('work-note');
    if (note) note.textContent = i18n('seed.startgg.s16');
    return;
  }
  return previewStartggSeeds(token, /** @type {number | string} */ (/** @type {SpspSeedEventContext} */ (S.EVENT_CONTEXT).phaseId));
}

/** メニューを作り直す (開くたびに今の状態で) */
function renderBracketPreviewMenu() {
  const menu = document.getElementById('bracket-preview-menu');
  if (!menu) return;
  const av = bracketPreviewAvailability();
  /** @type {[ 'current' | 'optimized' | 'startgg', string, string ][]} */
  const items = [
    ['current', i18n('seed.preview.current'), i18n('seed.preview.current_sub')],
    ['optimized', i18n('seed.preview.opt'), i18n('seed.preview.opt_sub')],
    ['startgg', i18n('seed.preview.gg'), i18n('seed.preview.gg_sub')],
  ];
  menu.innerHTML = items.map(([k, label, sub]) => {
    const why = av[k];
    return `<button type="button" role="menuitem" data-bp-kind="${k}"${why ? ' disabled aria-disabled="true"' : ''}
      style="display:block;width:100%;text-align:left;background:none;border:none;border-radius:6px;padding:7px 10px;cursor:${why ? 'not-allowed' : 'pointer'};color:${why ? '#9ca3af' : '#111827'};font-size:12px">
      <span style="font-weight:600">${escHtml(label)}</span>
      <span style="display:block;font-size:11px;color:${why ? '#9ca3af' : '#6b7280'};margin-top:2px">${escHtml(why || sub)}</span>
    </button>`;
  }).join('');
  menu.querySelectorAll('[data-bp-kind]').forEach((b) => {
    const el = /** @type {HTMLButtonElement} */ (b);
    if (!el.disabled) {
      el.addEventListener('mouseenter', () => { el.style.background = '#f3f4f6'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'none'; });
    }
    el.addEventListener('click', () => { runBracketPreviewChoice(/** @type {any} */ (el.dataset.bpKind)); });
  });
}

/** @param {Event} e */
function _bpOutside(e) {
  const wrap = document.getElementById('bracket-preview-wrap');
  if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
  closeBracketPreviewMenu();
}
/** @param {KeyboardEvent} e */
function _bpKey(e) {
  if (e.key !== 'Escape') return;
  closeBracketPreviewMenu();
  const btn = document.getElementById('bracket-preview');
  if (btn) btn.focus();
}

export function closeBracketPreviewMenu() {
  const menu = document.getElementById('bracket-preview-menu');
  const btn = document.getElementById('bracket-preview');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', _bpOutside, true);
  document.removeEventListener('keydown', _bpKey);
}

export function toggleBracketPreviewMenu() {
  const menu = document.getElementById('bracket-preview-menu');
  const btn = document.getElementById('bracket-preview');
  if (!menu || !btn) return;
  if (!menu.hidden) { closeBracketPreviewMenu(); return; }
  if (!DATA.length) { const note = document.getElementById('work-note'); if (note) note.textContent = i18n('seed.spec.s15'); return; }
  renderBracketPreviewMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', _bpOutside, true);
  document.addEventListener('keydown', _bpKey);
  const first = /** @type {HTMLButtonElement | null} */ (menu.querySelector('[data-bp-kind]:not([disabled])'));
  if (first) first.focus();
}

function clearSeedSpec() {
  if (!S.SEED_SPEC) { _specStatus(i18n('seed.spec.s24')); return; }
  S.SEED_SPEC = null;
  saveManual();
  render();
  _specStatus(i18n('seed.spec.s25'));
}

// SEED_SPEC が空になったら null に戻す (保存・表示の簡素化)。
export function _pruneSeedSpec() {
  if (!S.SEED_SPEC) return;
  const n = (o) => Object.keys(o || {}).length;
  if (!n(S.SEED_SPEC.locks) && !n(S.SEED_SPEC.pins) && !n(S.SEED_SPEC.waves)) S.SEED_SPEC = null;
}

// 固定設定バーの「適用」: 種別 (なし/プール/ウェーブ) と対象を SEED_SPEC.locks に保存する。
// 並びへの反映は読み取り時射影 (_projectSeedLocks) が常時行う = 最適化しなくても
// 固定者は指定プール/ウェーブへ挿入ソート的に移動し、解除すれば元の位置付近に戻る。
/** @param {number} uid */
export function applySeedLockChoice(uid) {
  // 固定バーは表 (行の直下) にある。以前の manual-bar 内も一応拾えるよう document 全体で探す。
  const kindEl = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-mn-lock-kind]'));
  const targetEl = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-mn-lock-target]'));
  const kind = /** @type {'none' | 'pool' | 'wave' | 'seed' | 'dq'} */ (kindEl ? kindEl.value : 'none');   // select の option 値 (30_core.js manualLockBarHtml)
  if (kind === 'none') {
    if (S.SEED_SPEC && S.SEED_SPEC.locks) delete S.SEED_SPEC.locks[uid];
    _pruneSeedSpec();
  } else {
    const target = targetEl ? parseInt(targetEl.value, 10) : 0;
    if (!S.SEED_SPEC) S.SEED_SPEC = { label: null, pins: {}, waves: {}, locks: {} };
    if (!S.SEED_SPEC.locks) S.SEED_SPEC.locks = {};
    if (kind === 'seed' || kind === 'dq') S.SEED_SPEC.locks[uid] = { kind, target: null };
    else S.SEED_SPEC.locks[uid] = { kind, target: Number.isFinite(target) ? target : 0 };
  }
  const manual = /** @type {SpspSeedManual} */ (S.MANUAL);   // 固定バーは手動調整の編集中にしか出ない
  manual.lockSel = null;
  manual.lockKind = null;
  saveManual();
  renderManualUI();
  renderSpecStatus();
}

// spec パネルの配線 (スケルトンは mount 済みなので要素は常に存在する)。
(function () {
  const loadBtn = document.getElementById('spec-src-load');
  if (loadBtn) loadBtn.addEventListener('click', () => { loadSpecSource(); });
  const tplBtn = document.getElementById('spec-tpl');
  // テンプレートは表示言語で、使い方の説明行つき (2026-11-11)
  if (tplBtn) tplBtn.addEventListener('click', () => downloadCsvTemplate(csvTemplateLines('spec'), 'spsp_seed_spec_template.csv'));
  const exportBtn = document.getElementById('spec-export');
  if (exportBtn) exportBtn.addEventListener('click', exportSeedWorkCsv);
  // トーナメントプレビューはメニューから並びを選ぶ (2026-11-10)
  const bracketBtn = document.getElementById('bracket-preview');
  if (bracketBtn) bracketBtn.addEventListener('click', toggleBracketPreviewMenu);
  // 適用後のトーナメントをプレビュー (40_startgg.js のボタン): start.gg から適用後のシード順を読み直して、その並びで開く (2026-11-05)
  document.addEventListener('spsp:preview-applied', (e) => {
    const d = /** @type {CustomEvent} */ (e).detail || {};
    previewStartggSeeds(d.token, d.phaseId);
  });
  const clearBtn = document.getElementById('spec-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearSeedSpec);
  // プール数/ウェーブ数の変更は手動列のプール表示 (A3/P3) に反映する。
  const poolsEl = document.getElementById('so-pools');
  if (poolsEl) poolsEl.addEventListener('input', () => renderManualUI());
  const wavesEl = document.getElementById('so-waves');
  if (wavesEl) wavesEl.addEventListener('input', () => renderManualUI());
})();
