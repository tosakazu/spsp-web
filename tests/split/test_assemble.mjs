#!/usr/bin/env node
// tests/split/test_assemble.mjs — 分割された配信 JSON を site/js/player_data.js の assemble() で組み立て直し、
// 旧形式 (分割前のビルド) と内容一致するかを全選手・全大会で確かめる。
//
//   node tests/split/test_assemble.mjs --legacy <旧ビルドの deployed> --new <新ビルドの deployed> [--limit N] [--verbose]
//
// 比較の規則:
//   - dict はキー順を問わない (消費側はキーで引く)。list は順序込み。型込み (1 と 1.0 は同じ数)。
//   - 数値は |a−b| ≤ 1e-9·max(1,|a|)。tjpr_w だけ 2e-4 (raw を 4 桁、pos を 6 桁に丸めた値から再計算するため)。
//   - 設計上の差 (docs/refactor/04_player_json_split.md):
//       recent_spr は削除 (比較しない)。top_spr[].tjpr_* は tournaments[] の最終値になる (差の件数だけ報告)。
//       tjpr_age は直対のみのエントリで旧値 1.0 だったものが実際の減衰になる (旧 w=0 なら影響なし。件数だけ報告)。
//       history は点の置き方が違う (旧: 評価日から N 日前 / 新: 固定グリッド) ので、同じ日付に当たる行だけ比較する。
//       新にはさらに大会の点 (event_id 付き) が入る (比較対象外)。
//       peak_ranks / achievements は学習中に追跡した真の最高値 (spsp/peak_track) になった。旧はスナップショットの
//       最良値なので、新 ≤ 旧 (順位として同じか良い) を確かめる (下記 peak チェック)。
//   - 大会ドキュメントは standings[] / highlights.*[] から global_ranks / tjpr_w / tjpr_lv / tjpr_counted / tjpr_by_lv
//     を落とした形と比較する。global_ranks は players_current.json の ranks と一致するかを別に確かめる。
// 終了コード 0 = 一致 (設計上の差のみ)。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PD = require('../../site/js/player_data.js');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LEGACY = opt('--legacy'); const NEW = opt('--new');
const LIMIT = parseInt(opt('--limit', '0'), 10);
const VERBOSE = args.includes('--verbose');
if (!LEGACY || !NEW) { console.error('usage: --legacy <dir> --new <dir>'); process.exit(2); }

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cur = readJson(path.join(NEW, 'players_current.json'));
const meta = readJson(path.join(NEW, 'meta.json'));
const ctx = { eval_ts: cur.eval_ts, eval_date: cur.eval_date, decay_r: cur.decay_r || meta.decay_r };

// スナップショットの点が旧 (評価日から N 日前) と新 (固定グリッド) で違うと、そこから導く値
// (ピーク順位 / 実績 / バッジ / 非 serious 大会の「当時」近似) は一致しなくて当然。
// 点が同じ (新側を --snapshot-grid legacy でビルドした) ときだけ厳密に比べる。
const legacyMeta = fs.existsSync(path.join(LEGACY, 'meta.json')) ? readJson(path.join(LEGACY, 'meta.json')) : {};
const sameGrid = JSON.stringify((legacyMeta.snapshot_days || []).slice().sort((a, b) => a - b))
  === JSON.stringify((meta.snapshot_days || []).slice().sort((a, b) => a - b));
const GRID_PATHS = /(\.dynamic_badges\b|\.(at_lv|pretour_ranks|rank_delta_\w+|perf_rank|tjpr_pts_at)\b|\.highlights\.top_contrib_points\b)/;
// peak_ranks / achievements は点に依らず追跡値 (旧のスナップショット最良値とは別物) → 常に数えるだけ
const TRACK_PATHS = /(\.peak_ranks(_1y)?\b|\.achievements\b)/;
const gridStats = new Map();
function isGridPath(p) { return (!sameGrid && GRID_PATHS.test(p)) || TRACK_PATHS.test(p); }

// ── 比較器 ──
const TOL = 1e-9;
function numEq(a, b, tol) { return Math.abs(a - b) <= (tol != null ? tol : TOL * Math.max(1, Math.abs(a))); }
function tolFor(pathStr) {
  if (/\.tjpr_w$/.test(pathStr)) return 2e-4;
  return null;
}
function diff(a, b, p, out) {
  if (a === b) return;
  if (isGridPath(p)) {   // グリッド由来の差は数えるだけ (下位のパスへは降りない)
    const o = []; diffStrict(a, b, p, o);
    for (const line of o) { const k = line.replace(/\[\d+\]/g, '[]').split(':')[0]; gridStats.set(k, (gridStats.get(k) || 0) + 1); }
    return;
  }
  diffStrict(a, b, p, out);
}
function diffStrict(a, b, p, out) {
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!numEq(a, b, tolFor(p))) out.push(`${p}: ${a} → ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${p}: 型が違う`); return; }
    if (a.length !== b.length) { out.push(`${p}: 長さ ${a.length} → ${b.length}`); }
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${p}.${k}: 新にだけある`); continue; }
      if (!(k in b)) { out.push(`${p}.${k}: 旧にだけある`); continue; }
      diff(a[k], b[k], `${p}.${k}`, out);
    }
    return;
  }
  out.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

// ── 選手 ──
const legacyPlayers = path.join(LEGACY, 'players');
let files = fs.readdirSync(legacyPlayers).filter(f => f.endsWith('.json')).sort();
if (LIMIT) files = files.slice(0, LIMIT);
const stats = { players: 0, ok: 0, ng: 0, missing: 0, design: { top_spr: 0, tjpr_age_btonly: 0, tjpr_age_w: 0 },
  history: { rows_legacy: 0, matched: 0, ok: 0, ng: 0 }, peak: { n: 0, better: 0, same: 0, worse: 0 }, peak1y: { n: 0, better: 0, same: 0, worse: 0 }, byPath: new Map() };
const samples = [];
for (const f of files) {
  const legacy = readJson(path.join(legacyPlayers, f));
  const uid = legacy.user_id;
  const stablePath = path.join(NEW, 'players', f);
  if (!fs.existsSync(stablePath)) { stats.missing++; continue; }
  const stable = readJson(stablePath);
  const histPath = path.join(NEW, 'history', f);
  const hist = fs.existsSync(histPath) ? readJson(histPath) : [];
  const rec = PD.assemble(stable, PD.currentOf(cur, uid), hist, ctx);
  stats.players++;

  // 設計上の差を先に取り分ける
  const legacyCmp = { ...legacy };
  delete legacyCmp.recent_spr;
  const recCmp = { ...rec };
  // top_spr の tjpr_*: 件数を数えて比較から外す
  const stripTopSpr = (lst) => (lst || []).map(e => { const o = { ...e }; delete o.tjpr_w; delete o.tjpr_raw; delete o.tjpr_lv; delete o.tjpr_counted; return o; });
  for (let i = 0; i < Math.min((legacy.top_spr || []).length, (rec.top_spr || []).length); i++) {
    const a = legacy.top_spr[i], b = rec.top_spr[i];
    if (!(numEq(a.tjpr_w || 0, b.tjpr_w || 0, 2e-4) && numEq(a.tjpr_raw || 0, b.tjpr_raw || 0) && (a.tjpr_lv || 0) === (b.tjpr_lv || 0) && !!a.tjpr_counted === !!b.tjpr_counted)) stats.design.top_spr++;
  }
  legacyCmp.top_spr = stripTopSpr(legacy.top_spr); recCmp.top_spr = stripTopSpr(rec.top_spr);
  // tjpr_age: 旧 1.0 (直対のみのエントリ) は新では実減衰。旧 w=0 なら表示に影響しないので数えるだけ
  const stripAge = (lst, isLegacy) => (lst || []).map(e => {
    const o = { ...e };
    if (isLegacy && e.tjpr_age === 1.0 && (e.tjpr_w || 0) === 0) { o.__age1 = true; }
    return o;
  });
  const la = stripAge(legacy.tournaments, true), na = stripAge(rec.tournaments, false);
  for (let i = 0; i < Math.min(la.length, na.length); i++) {
    if (la[i].__age1) { delete la[i].__age1; delete la[i].tjpr_age; delete na[i].tjpr_age; stats.design.tjpr_age_btonly++; }
    else if (la[i].tjpr_age === 1.0 && (la[i].tjpr_w || 0) > 0 && !numEq(la[i].tjpr_age, na[i].tjpr_age)) { delete la[i].tjpr_age; delete na[i].tjpr_age; stats.design.tjpr_age_w++; }
  }
  legacyCmp.tournaments = la; recCmp.tournaments = na;
  // history: 同じ日付に当たる行だけ
  const legacyHist = legacy.history || [], newHist = rec.history || [];
  delete legacyCmp.history; delete recCmp.history;
  stats.history.rows_legacy += legacyHist.length;
  // 新には大会の点 (event_id 付き、順位が変化した日付) も入る。旧と比べるのはグリッドの点だけ
  const byD = new Map(newHist.filter(h => h.event_id == null).map(h => [h.d, h]));
  for (const h of legacyHist) {
    const n = byD.get(h.d);
    if (!n) continue;
    stats.history.matched++;
    const o = []; diff(h, n, `history[d=${h.d}]`, o);
    if (o.length) { stats.history.ng++; if (samples.length < 20) samples.push(`${f}: ${o[0]}`); } else stats.history.ok++;
  }

  // 過去最高順位: 追跡値は旧のスナップショット最良値と同じか良い (小さい) はず (全期間)。悪い側は不一致に数える
  for (const pk of ['peak_ranks', 'peak_ranks_1y']) for (const key of ['ensemble', 'tjpr', 'bt_gated']) {
    const a = (legacy[pk] || {})[key], b = (rec[pk] || {})[key];
    if (a && b && a.rank > 0 && b.rank > 0) {
      const st = pk === 'peak_ranks' ? stats.peak : stats.peak1y;
      st.n++;
      if (b.rank < a.rank) st.better++; else if (b.rank === a.rank) st.same++; else { st.worse++; if (samples.length < 20) samples.push(`${f}: ${pk}.${key} 旧 ${a.rank} → 新 ${b.rank} (悪化)`); }
    }
  }

  const out = [];
  diff(legacyCmp, recCmp, 'rec', out);
  if (out.length) {
    stats.ng++;
    for (const line of out) {
      const key = line.replace(/\[\d+\]/g, '[]').split(':')[0];
      stats.byPath.set(key, (stats.byPath.get(key) || 0) + 1);
    }
    if (samples.length < 20) samples.push(`${f}: ${out.slice(0, 3).join(' | ')}`);
  } else stats.ok++;
}

// ── 新ビルド内の自己整合: players_current.json の ranks == latest_tjpr_full.jsonl の ranks ──
// (旧ビルドでは jsonl と players/<uid>.json の ranks.tjpr が同点ブロックで食い違っていた。spsp/overlay.py で統一済)
const selfNg = { ensemble: 0, tjpr: 0, bt_gated: 0 }; let selfN = 0;
for (const line of fs.readFileSync(path.join(NEW, 'latest_tjpr_full.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line); const p = PD.currentOf(cur, r.user_id); if (!p) continue;
  selfN++;
  for (const k of Object.keys(selfNg)) if ((r.ranks[k] || 0) !== (p.ranks[k] || 0)) selfNg[k]++;
}

// ── 大会 ──
const tstats = { docs: 0, ok: 0, ng: 0, missing: 0, ranks_checked: 0, ranks_ng: { ensemble: 0, tjpr: 0, bt_gated: 0 } };
const CURRENT_KEYS = ['global_ranks', 'tjpr_w', 'tjpr_lv', 'tjpr_counted', 'tjpr_by_lv'];
let tfiles = fs.readdirSync(path.join(LEGACY, 'tournaments')).filter(f => f.endsWith('.json')).sort();
if (LIMIT) tfiles = tfiles.slice(0, LIMIT);
for (const f of tfiles) {
  const legacy = readJson(path.join(LEGACY, 'tournaments', f));
  const np = path.join(NEW, 'tournaments', f);
  if (!fs.existsSync(np)) { tstats.missing++; continue; }
  const doc = readJson(np);
  tstats.docs++;
  const strip = (e) => { const o = { ...e }; for (const k of CURRENT_KEYS) delete o[k]; return o; };
  const legacyCmp = { ...legacy, standings: (legacy.standings || []).map(strip),
    highlights: Object.fromEntries(Object.entries(legacy.highlights || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(strip) : v])) };
  const out = [];
  diff(legacyCmp, doc, 'doc', out);
  if (out.length) { tstats.ng++; if (samples.length < 30) samples.push(`tournaments/${f}: ${out.slice(0, 2).join(' | ')}`); } else tstats.ok++;
  // 旧 global_ranks == players_current.json の ranks か
  for (const s of legacy.standings || []) {
    const g = s.global_ranks; if (!g) continue;
    tstats.ranks_checked++;
    const p = PD.currentOf(cur, s.user_id);
    if (!p) { tstats.ranks_checked--; continue; }   // fixture では一部の選手しか入っていない
    const r = p.ranks || {};
    for (const k of Object.keys(tstats.ranks_ng)) if ((g[k] || 0) !== (r[k] || 0)) tstats.ranks_ng[k]++;
  }
}

console.log(`players: ${stats.players} (一致 ${stats.ok} / 不一致 ${stats.ng} / 新に無い ${stats.missing})`);
console.log(`  設計上の差: top_spr の tjpr_* が最終値に変わった要素 ${stats.design.top_spr}、` +
  `tjpr_age 1.0→実減衰 (旧 w=0) ${stats.design.tjpr_age_btonly}、同 (旧 w>0) ${stats.design.tjpr_age_w}`);
console.log(`  history: 旧 ${stats.history.rows_legacy} 行のうち同じ日付に当たる ${stats.history.matched} 行を比較 → 一致 ${stats.history.ok} / 不一致 ${stats.history.ng}`);
console.log(`  過去最高順位 (全期間、追跡値+グリッド vs 旧スナップショット最良値) ${stats.peak.n} 件: 良い ${stats.peak.better} / 同じ ${stats.peak.same} / 悪い ${stats.peak.worse}` +
  (sameGrid ? ' (同じ点なので悪い側は 0 のはず)' : ' (点が違うので数件は動く。同じ点での厳密比較は --snapshot-grid legacy)'));
console.log(`  1 年ピーク (同上) ${stats.peak1y.n} 件: 良い ${stats.peak1y.better} / 同じ ${stats.peak1y.same} / 悪い ${stats.peak1y.worse}` +
  ' (追跡の窓は週単位なので 365 日ちょうどの端で数件は動きうる)');
if (gridStats.size && sameGrid) { console.log('  追跡値による差 (設計上):'); for (const [k, v] of [...gridStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${v.toString().padStart(6)}  ${k}`); }
if (stats.byPath.size) {
  console.log('  不一致のパス:');
  for (const [k, v] of [...stats.byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`    ${v.toString().padStart(6)}  ${k}`);
}
if (!sameGrid) {
  console.log(`  スナップショットの点が違う (旧 ${(legacyMeta.snapshot_days || []).length} 点 / 新 ${(meta.snapshot_days || []).length} 点) → そこから導く値の差は設計上 (厳密比較は --snapshot-grid legacy のビルドで):`);
  for (const [k, v] of [...gridStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${v.toString().padStart(6)}  ${k}`);
}
console.log(`tournaments: ${tstats.docs} (一致 ${tstats.ok} / 不一致 ${tstats.ng} / 新に無い ${tstats.missing})`);
console.log(`  旧 standings[].global_ranks と新 players_current.json の ranks (${tstats.ranks_checked} 件): 不一致 ensemble ${tstats.ranks_ng.ensemble} / tjpr ${tstats.ranks_ng.tjpr} / bt_gated ${tstats.ranks_ng.bt_gated}` +
  ` (tjpr の差は旧 jsonl 側の同点順が不定だったもの。新ビルド内では jsonl と一致することを下で確かめる)`);
console.log(`  新ビルド内: latest_tjpr_full.jsonl と players_current.json の ranks (${selfN} 人): 不一致 ensemble ${selfNg.ensemble} / tjpr ${selfNg.tjpr} / bt_gated ${selfNg.bt_gated}`);
if (VERBOSE || stats.ng || tstats.ng || stats.history.ng) {
  console.log('例:'); for (const s of samples) console.log('  ' + s);
}
const bad = stats.ng + stats.missing + tstats.ng + tstats.missing + stats.history.ng + (sameGrid ? stats.peak.worse : 0)
  + tstats.ranks_ng.ensemble + tstats.ranks_ng.bt_gated + selfNg.ensemble + selfNg.tjpr + selfNg.bt_gated;
console.log(bad ? `NG (${bad})` : 'OK: 組み立て直した出力は旧形式と一致 (設計上の差のみ)');
process.exit(bad ? 1 : 0);
