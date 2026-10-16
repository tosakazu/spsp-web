// tools/badges/build_event_icons.mjs — バッジ貼り付けの試作 (site/p/badges.html) 用に、大会 (event_id) → 大会アイコンの表 site/data/event_icons.json を作る。
//   node tools/badges/build_event_icons.mjs <smash_database の tournaments.jsonl> [出力]
// 出力: { "f": [アイコンのファイル名 (R2 images/tournament/h/ の中)…], "e": { "<event_id>": f の番号 } }。アイコンのある大会だけ
// (本番ではビルドが選手の JSON に入れる想定。それまでの仮の表)
import fs from 'node:fs';

const [dbPath, out = 'site/data/event_icons.json'] = process.argv.slice(2);
if (!dbPath) { console.error('usage: build_event_icons.mjs <tournaments.jsonl> [out]'); process.exit(1); }

const index = await (await fetch('https://data.spsp.games/images/tournament/index.json')).json();
/** @type {string[]} */
const files = [];
/** @type {Map<string, number>} */
const pos = new Map();
/** @type {Record<string, number>} */
const ev = {};
for (const line of fs.readFileSync(dbPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const t = JSON.parse(line);
  const f = index[String(t.tournament_id)];
  if (!f || !f.file) continue;
  const name = String(f.file).replace(/^h\//, '');
  if (!pos.has(name)) { pos.set(name, files.length); files.push(name); }
  for (const e of t.events || []) ev[String(e.event_id)] = /** @type {number} */ (pos.get(name));
}
fs.writeFileSync(out, JSON.stringify({ f: files, e: ev }));
console.log(`大会 ${Object.keys(ev).length} / アイコン ${files.length} → ${out}`);
