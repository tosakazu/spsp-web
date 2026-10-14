// tools/titles/freeze_titles.mjs — 公開する二つ名を tests/frontend/titles_frozen.json に足す (消さない)。
//   node tools/titles/freeze_titles.mjs
//   一覧 (site/js/titles_ja.js) を書き出し直したら、公開する前に実行してコミットする。
//   テストは、ここにある番号が一覧から消えていないこと・位置 (前半 / 後半 / どちらでも) が変わっていないことを確かめる
//   (持っている二つ名の記録は番号で持つので、消すと持っている人のカードから消え、位置を変えると付けていた位置で使えなくなる)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLES } from '../../site/js/titles.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/frontend/titles_frozen.json');
const frozen = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let added = 0;
for (const [lang, list] of Object.entries(TITLES)) {
  if (!frozen[lang]) continue;   // 仮の一覧 (北米) は固めない
  const have = new Set(Object.values(frozen[lang]).flat());
  for (const t of list) {
    const n = Number(t.id.slice(lang.length + 1));
    if (have.has(n)) continue;
    frozen[lang][t.part].push(n);
    added++;
  }
}
fs.writeFileSync(FILE, JSON.stringify(frozen) + '\n');
console.log(`titles_frozen.json: ${added} added`);
