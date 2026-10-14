// tools/titles/sync_owned.mjs — 二つ名の持ち物を記録 (D1、正本) に足し、結果を選手のファイルに書く (docs/card_titles_design.md)。
//   ビルドの後、R2 に同期する前に実行する:
//     TITLE_SYNC_KEY=... node tools/titles/sync_owned.mjs --players <build>/site/players [--prefs <build>/site/data/player_prefectures.json]
//       [--api https://spsp.games/api] [--lang ja] [--no-write] [--dry-run]
//   1. 各 players/<uid>.json の tournaments・メインキャラ (characters[0]) と都道府県 (--prefs) から ownedTitles (site/js/titles.js、ページ・Worker と同じ関数) を計算
//   2. Worker の title_sync に 500 人ずつ送る (記録に OR。消さない)。返ってきた合計 (bits / updated) を
//   3. その選手のファイルに title_bits / title_updated として書き込む
//   API に届かないときは書き込まない (ファイルはそのまま。画面は計算で代わりをする)。ビルドは止めない (終了コード 0、警告だけ)
import fs from 'node:fs';
import path from 'node:path';
import { ownedTitles } from '../../site/js/titles.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const DIR = opt('--players', '');
const API = opt('--api', 'https://spsp.games/api');
const LANG = opt('--lang', 'ja');
const DRY = args.includes('--dry-run');
const NO_WRITE = args.includes('--no-write');   // 記録 (D1) にだけ足し、選手のファイルは書かない (preview の記録を作るとき)
const PREFS = opt('--prefs', '');
const KEY = process.env.TITLE_SYNC_KEY || '';
const BATCH = 500;

if (!DIR || !fs.existsSync(DIR)) { console.error(`[titles] players dir not found: ${DIR}`); process.exit(DRY ? 1 : 0); }
if (!KEY && !DRY) { console.warn('[titles] TITLE_SYNC_KEY is not set; skipped'); process.exit(0); }

/** @type {Record<string, string>} */
let prefs = {};
if (PREFS) {
  try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch (e) { console.warn(`[titles] prefs not read: ${e.message}`); }
}

const files = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f));
/** @type {{ uid: number, ids: string[] }[]} */
const items = [];
for (const f of files) {
  let p;
  try { p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  const uid = Number(f.replace(/\.json$/, ''));
  const main = (p.characters || [])[0];   // メインキャラ (ビルドがキャラ投票を反映した並びの先頭。ページの ownedTitlesOf と同じ)
  const profile = { chars: main ? [main.id] : [], pref: prefs[String(uid)] || null };
  items.push({ uid, ids: [...ownedTitles(LANG, uid, p.tournaments || [], profile).keys()] });
}
console.log(`[titles] ${items.length} players, ${items.reduce((n, x) => n + x.ids.length, 0)} titles`);
if (DRY) { console.log('[titles] dry run: nothing sent or written'); process.exit(0); }

let written = 0, changed = 0, failed = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  let j = null;
  for (let attempt = 1; attempt <= 3 && !j; attempt++) {
    try {
      // 1 回 1 MB 前後になるので、大きな body を受ける POST /api/title_sync に送る (/api は 64 KB まで)
      const r = await fetch(API.replace(/\/$/, '') + '/title_sync', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'title_sync', key: KEY, lang: LANG, items: batch }), signal: AbortSignal.timeout(60000) });
      const body = await r.json().catch(() => null);
      if (body && body.ok) j = body;
      else console.warn(`[titles] batch ${i / BATCH + 1}: ${r.status} ${body && body.error ? body.error.code : ''}`);
    } catch (e) { console.warn(`[titles] batch ${i / BATCH + 1}: ${e.message}`); }
    if (!j && attempt < 3) await new Promise(res => setTimeout(res, attempt * 5000));
  }
  if (!j) { failed += batch.length; continue; }
  changed += j.changed || 0;
  if (NO_WRITE) continue;
  for (const it of j.items || []) {
    const f = path.join(DIR, `${it.uid}.json`);
    let p;
    try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (p.title_bits === it.bits && p.title_updated === it.updated) continue;   // 変わらなければ書かない (配信の差分を増やさない)
    p.title_bits = it.bits;
    p.title_updated = it.updated;
    fs.writeFileSync(f, JSON.stringify(p));
    written++;
  }
}
console.log(`[titles] synced: changed ${changed}, files written ${written}, failed ${failed}`);
