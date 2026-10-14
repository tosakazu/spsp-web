// tools/fonts/build_title_font.mjs — 二つ名のフォント (コーポレート・ロゴ ver2 Bold) を、二つ名に使う文字だけに絞り、文字の範囲ごとに分けた woff2 にする。
//   node tools/fonts/build_title_font.mjs
//     → site/fonts/title/<番号>-<中身のハッシュ>.woff2 (分けたフォント)、site/fonts/corporate-logo-title.chars.txt (全部の文字)、
//       site/css/player_card.css の「title-font」の印の間の @font-face (unicode-range 付き)
//   二つ名 (site/js/titles_ja.js) を足したらもう一度実行して、全部をコミットする (tests/frontend/titles.test.cjs が足りない文字を見つける)
// 分ける理由: ブラウザは unicode-range で、表示する文字を含むファイルだけを読む。カードに二つ名を 2 つ出すだけなら全部 (300 KB) は要らない。
//   0 番 = 英数字・記号とよく出る文字 (かなはほぼ全部ここに入る)、1 番から = 残りを出てくる回数の多い順に CHUNK 文字ずつ
//   ファイル名に中身のハッシュを入れる (文字が変わったら別の名前になるので、古いものがキャッシュに残っても混ざらない)
// フォントは LOGOTYPE.JP の「コーポレート・ロゴ ver2」(https://logotype.jp/corporate-logo-font-dl-old-v2.html)、
// SIL Open Font License 1.1 (tools/fonts/OFL.txt、配信側にも site/fonts/OFL.txt)。予約フォント名は無いので、文字を絞った版も配ってよい
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { TITLES } from '../../site/js/titles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'tools/fonts/Corporate-Logo-Bold-ver2.otf');
const OUT_DIR = path.join(ROOT, 'site/fonts/title');
const CHARS_OUT = path.join(ROOT, 'site/fonts/corporate-logo-title.chars.txt');
const CSS = path.join(ROOT, 'site/css/player_card.css');
const BEGIN = '/* title-font:begin */';   // この印と END の間を書き直す (手で直さない)
const END = '/* title-font:end */';
const FIRST = 240;   // 0 番の文字数 (英数字・記号 + よく出る文字)
const CHUNK = 100;   // 1 番からの 1 ファイルの文字数 (漢字 1 字で 200 バイトほど)

// いつも入れる文字: 区切りの「//」・空白・英数字 (英語の二つ名と、あとで足す数字入りのもの)
const BASE = ' /' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,-\'&';
/** @type {Map<string, number>} 文字 → 出てくる回数 */
const freq = new Map();
for (const list of Object.values(TITLES)) for (const t of list) for (const ch of t.text) freq.set(ch, (freq.get(ch) || 0) + 1);
const base = [...new Set(BASE)];
const rest = [...freq.keys()].filter(ch => !base.includes(ch))
  .sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || a.codePointAt(0) - b.codePointAt(0));
const chunks = [[...base, ...rest.slice(0, FIRST - base.length)]];
for (let i = FIRST - base.length; i < rest.length; i += CHUNK) chunks.push(rest.slice(i, i + CHUNK));

const otf = fs.readFileSync(SRC);
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) if (/\.woff2$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));   // 前のものは消す
const faces = [];
let total = 0;
for (let i = 0; i < chunks.length; i++) {
  const chars = chunks[i].slice().sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const buf = await subsetFont(otf, chars.join(''), { targetFormat: 'woff2' });
  const name = `${i}-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10)}.woff2`;
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
  total += buf.length;
  const range = chars.map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase()).join(',');
  faces.push(`@font-face { font-family: "SPSP Title"; src: url("../fonts/title/${name}") format("woff2"); font-weight: 700; font-display: swap; unicode-range: ${range}; }`);
}
const all = [...base, ...rest].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
fs.writeFileSync(CHARS_OUT, all + '\n');

const css = fs.readFileSync(CSS, 'utf8');
const a = css.indexOf(BEGIN), b = css.indexOf(END);
if (a < 0 || b < a) throw new Error(`${path.relative(ROOT, CSS)}: title-font の印が無い`);
fs.writeFileSync(CSS, css.slice(0, a) + BEGIN + '\n' + faces.join('\n') + '\n' + css.slice(b));
console.log(`site/fonts/title: ${chunks.length} files, ${all.length} chars, ${total} bytes (0 番 ${chunks[0].length} 文字)`);
