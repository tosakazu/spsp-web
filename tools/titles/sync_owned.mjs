// tools/titles/sync_owned.mjs — 二つ名の抽選を記録 (D1 title_owned、正本) に足す (docs/card_titles_design.md「持っている二つ名の記録」)。
//   ビルドの後に実行する (選手のファイルは読むだけで書かない。配信の順番には関係しない):
//     TITLE_SYNC_KEY=... node tools/titles/sync_owned.mjs --players <build>/site/players --api https://spsp.games/api
//       [--prefs <build>/site/data/player_prefectures.json] [--lang ja] [--date YYYY-MM-DD] [--dry-run]
//   1. title_export で今の記録 (ビット列と引いた回数) を全部読む。読めなければ何も書かずに終わる
//   2. 各 players/<uid>.json の tournaments から「ここまでに引く回数」(drawTargets)、メインキャラ (characters[0]) と都道府県 (--prefs) を出し、
//      記録の回数との差だけ新しく引く (advanceTitles。site/js/titles.js、ページ・Worker と同じ一覧)。過去に引いたものは計算し直さない
//   3. 変わった人だけ title_sync に送る (1 回 500 人・1.5 MB まで)。Worker は読んだときのままの行だけ書く (ほかの同期と重なったら次の回に回す)
//   --api は必ず付ける (付け忘れて本番に書かないように既定値は無い)。--dry-run は 1・2 だけ (読むが書かない)
//   失敗してもビルドは止めない (終了コード 0、警告だけ)。次の回が続きから引く
import fs from 'node:fs';
import path from 'node:path';
import { advanceTitles, drawTargets } from '../../site/js/titles.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const DIR = opt('--players', '');
const API = opt('--api', '');
const LANG = opt('--lang', 'ja');
const DRY = args.includes('--dry-run');
const PREFS = opt('--prefs', '');
const KEY = process.env.TITLE_SYNC_KEY || '';
const TODAY = opt('--date', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));   // JST
const MAX_ITEMS = 500;
const MAX_BODY = 1.5 * 1024 * 1024;
const warn = (msg) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::[titles] ${msg}` : `[titles] ${msg}`);

if (!DIR || !fs.existsSync(DIR)) { warn(`players dir not found: ${DIR}`); process.exit(0); }
if (!/^https:\/\/[^/]+\/api\/?$/.test(API)) { warn('--api https://<host>/api is required'); process.exit(0); }
if (!KEY) { warn('TITLE_SYNC_KEY is not set; skipped'); process.exit(0); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) { warn(`bad --date: ${TODAY}`); process.exit(0); }
const base = API.replace(/\/$/, '');

/** @param {string} sub @param {any} body */
async function call(sub, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${base}/${sub}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, key: KEY }), signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) return j;
      if (attempt >= 3) throw new Error(`${r.status} ${j && j.error ? j.error.code : ''}`);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise(res => setTimeout(res, attempt * 5000));
  }
}

// 1. 今の記録
/** @type {Map<number, { bits: string, n_pre: number, n_post: number }>} */
const cur = new Map();
try {
  let after = null;
  do {
    const j = await call('title_export', { action: 'title_export', lang: LANG, after_uid: after });
    for (const x of j.items) cur.set(Number(x.uid), { bits: x.bits, n_pre: x.n_pre, n_post: x.n_post });
    after = j.next_after;
  } while (after !== null);
} catch (e) {
  warn(`title_export failed (${e.message}); nothing written`);
  process.exit(0);
}

// 2. 新しく引く
/** @type {Record<string, string>} */
let prefs = {};
if (PREFS) {
  try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch (e) { warn(`prefs not read: ${e.message}`); }
}
/** @type {any[]} */
const items = [];
let players = 0;
for (const f of fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f))) {
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  players++;
  const uid = Number(f.replace(/\.json$/, ''));
  const main = (p.characters || [])[0];   // メインキャラ (ビルドがキャラ投票を反映した並びの先頭)
  const profile = { chars: main ? [main.id] : [], pref: prefs[String(uid)] || null };
  const prev = cur.get(uid) || null;
  const next = advanceTitles(LANG, uid, prev, drawTargets(p.tournaments || []), profile, TODAY);
  if (prev && prev.bits === next.bits && prev.n_pre === next.n_pre && prev.n_post === next.n_post) continue;
  items.push({ uid, prev, ...next });
}
console.log(`[titles] ${players} players, ${cur.size} records, ${items.length} to update (${TODAY})`);
if (DRY) { console.log('[titles] dry run: nothing written'); process.exit(0); }

// 3. 送る (人数と大きさで分ける)
let changed = 0, failed = 0;
/** @type {number[]} */
const conflicts = [];
for (let i = 0; i < items.length;) {
  const batch = [];
  let size = 200;
  while (i < items.length && batch.length < MAX_ITEMS) {
    const s = JSON.stringify(items[i]).length + 1;
    if (batch.length && size + s > MAX_BODY) break;
    batch.push(items[i++]);
    size += s;
  }
  try {
    const j = await call('title_sync', { action: 'title_sync', lang: LANG, date: TODAY, items: batch });
    changed += j.changed || 0;
    conflicts.push(...(j.conflicts || []));
  } catch (e) {
    failed += batch.length;
    warn(`title_sync failed for ${batch.length} players: ${e.message}`);
  }
}
if (conflicts.length) warn(`${conflicts.length} players changed by another sync; retried next run`);
console.log(`[titles] synced: changed ${changed}, conflicts ${conflicts.length}, failed ${failed}`);
