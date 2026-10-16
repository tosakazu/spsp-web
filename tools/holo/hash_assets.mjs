// tools/holo/hash_assets.mjs — 実績バッジの素材画像 (site/img/holo/) の名前に中身の印 (md5 の先頭 8 文字) を付け、
// site/css/holo_badge.css の参照を書き換える。中身が変われば名前が変わるので、配信は長くキャッシュできる
// (worker/assets/_headers で /jp/img/holo/* を 1 年・immutable)。素材を差し替えたら、印の無い名前で置いてから実行する。
//   node tools/holo/hash_assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIRS = ['site/img/holo/l', 'site/img/holo/l740'];
const CSS = 'site/css/holo_badge.css';
let css = fs.readFileSync(CSS, 'utf8');
let n = 0;
for (const dir of DIRS) {
  for (const f of fs.readdirSync(dir)) {
    const m = /^(.+?)(?:\.[0-9a-f]{8})?\.(avif|webp)$/.exec(f);
    if (!m) continue;
    const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 8);
    const to = `${m[1]}.${hash}.${m[2]}`;
    const rel = dir.replace(/^site\//, '../');
    // CSS の参照: 印の有無を問わず同じ素材を指しているものを新しい名前に
    const re = new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.[0-9a-f]{8})?\\.${m[2]}`, 'g');
    css = css.replace(re, `${rel}/${to}`);
    if (f !== to) { fs.renameSync(path.join(dir, f), path.join(dir, to)); n++; }
  }
}
fs.writeFileSync(CSS, css);
// 画像版をキャンバスで 1 枚に描くとき (js/holo_badge.js の flatten) 用の名前の一覧。img/holo/ からの相対
/** @type {Record<string, { l?: string, l740?: string }>} */
const files = {};
for (const dir of DIRS) {
  const key = path.basename(dir);
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(.+?)\.[0-9a-f]{8}\.(avif|webp)$/.exec(f);
    if (m) (files[m[1]] ||= {})[key] = `${key}/${f}`;
  }
}
fs.writeFileSync('site/js/holo_assets.js', `// @ts-check
// holo_assets.js — 実績バッジの素材画像の名前 (tools/holo/hash_assets.mjs が作る。手で直さない)。img/holo/ からの相対
// l = 画像版 (740px の AVIF)、l740 = 前の画像版 (740px の WebP。AVIF が使えないときと、ラメ)
/** @type {Record<string, { l?: string, l740?: string }>} */
export const HOLO_FILES = ${JSON.stringify(files, null, 2)};
`);
console.log(`${n} 個の名前を変えた / js/holo_assets.js に ${Object.keys(files).length} 件`);
