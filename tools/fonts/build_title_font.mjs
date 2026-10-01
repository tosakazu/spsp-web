// tools/fonts/build_title_font.mjs — 二つ名のフォント (コーポレート・ロゴ ver2 Bold) を、二つ名に使う文字だけに絞って woff2 にする。
//   node tools/fonts/build_title_font.mjs   → site/fonts/corporate-logo-title.woff2 と site/fonts/corporate-logo-title.chars.txt
//   二つ名 (site/js/titles.js) を足したらもう一度実行して、両方をコミットする (tests/frontend/titles.test.cjs が足りない文字を見つける)
// フォントは LOGOTYPE.JP の「コーポレート・ロゴ ver2」(https://logotype.jp/corporate-logo-font-dl-old-v2.html)、
// SIL Open Font License 1.1 (tools/fonts/OFL.txt、配信側にも site/fonts/OFL.txt)。予約フォント名は無いので、文字を絞った版も配ってよい
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { TITLES } from '../../site/js/titles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'tools/fonts/Corporate-Logo-Bold-ver2.otf');
const OUT = path.join(ROOT, 'site/fonts/corporate-logo-title.woff2');
const CHARS_OUT = path.join(ROOT, 'site/fonts/corporate-logo-title.chars.txt');

// いつも入れる文字: 区切りの「//」・空白・英数字 (英語の二つ名と、あとで足す数字入りのもの)
const BASE = ' /' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,-\'&';
const chars = new Set(BASE);
for (const list of Object.values(TITLES)) for (const t of list) for (const ch of t.text) chars.add(ch);
const text = [...chars].sort().join('');

const buf = await subsetFont(fs.readFileSync(SRC), text, { targetFormat: 'woff2' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
fs.writeFileSync(CHARS_OUT, text + '\n');
console.log(`${path.relative(ROOT, OUT)}: ${chars.size} 文字, ${buf.length} bytes`);
