'use strict';
// js/csv_text.js: CSV ファイルを UTF-8 / Shift_JIS のどちらでも読む・テンプレートの説明行 (##) を飛ばす (2026-11-11)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mod = () => import(pathToFileURL(path.resolve(__dirname, '../../site/js/csv_text.js')).href);

// 「山田太郎」の Shift_JIS (Excel で「CSV (コンマ区切り)」に保存し直したもの)
const SJIS_YAMADA = [0x8e, 0x52, 0x93, 0x63, 0x91, 0xbe, 0x98, 0x59];

test('UTF-8 (BOM あり・なし) はそのまま、BOM は外す', async () => {
  const { decodeCsvBytes } = await mod();
  const enc = new TextEncoder();
  assert.strictEqual(decodeCsvBytes(enc.encode('﻿name\n山田太郎')), 'name\n山田太郎');
  assert.strictEqual(decodeCsvBytes(enc.encode('name\nTaro')), 'name\nTaro');
});

test('UTF-8 として読めなければ Shift_JIS で読む (日本語の名前が化けない)', async () => {
  const { decodeCsvBytes } = await mod();
  const head = Array.from(new TextEncoder().encode('name,discriminator\n'));
  const bytes = new Uint8Array(head.concat(SJIS_YAMADA, Array.from(new TextEncoder().encode(',="1a2b3c4d"\n'))));
  assert.strictEqual(decodeCsvBytes(bytes), 'name,discriminator\n山田太郎,="1a2b3c4d"\n');
});

test('ファイルからも読める・説明行 (##) を飛ばす', async () => {
  const { readCsvText, dropCommentRows, CSV_COMMENT } = await mod();
  assert.strictEqual(CSV_COMMENT, '##');
  const text = await readCsvText(new Blob([new Uint8Array(SJIS_YAMADA)]));
  assert.strictEqual(text, '山田太郎');
  assert.deepStrictEqual(dropCommentRows([['## 説明'], ['  ## 説明'], ['name', 'discriminator'], ['#hash', 'x']]),
    [['name', 'discriminator'], ['#hash', 'x']], '# 1 つで始まる名前は消さない');
});
