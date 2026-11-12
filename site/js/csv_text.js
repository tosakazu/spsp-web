// @ts-check
// csv_text.js — 読み込んだ CSV ファイルを文字列にする (2026-11-11)。
// UTF-8 として読めなければ Shift_JIS で読む: Excel (特に Windows・Mac の「CSV (コンマ区切り)」) で保存し直すと
// Shift_JIS になり、UTF-8 決め打ちで読むと日本語の名前が文字化けしていた。先頭の BOM は外す。
// テンプレートの説明行 (先頭のセルが「##」で始まる行) は CSV_COMMENT で読み飛ばす。

/** テンプレートの説明行の印 (PapaParse の comments、ほかの読み手も同じ印で飛ばす) */
export const CSV_COMMENT = '##';

/** @param {ArrayBuffer | Uint8Array} buf @returns {string} */
export function decodeCsvBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch (e) {
    try { text = new TextDecoder('shift_jis').decode(u8); } catch (e2) { text = new TextDecoder('utf-8').decode(u8); }
  }
  return text.replace(/^﻿/, '');
}

/** File / Blob を読んで文字列に @param {Blob} file @returns {Promise<string>} */
export async function readCsvText(file) {
  return decodeCsvBytes(await file.arrayBuffer());
}

/** 説明行 (先頭が ##) を除いた行 (自前で CSV を分解するページ用) @param {string[][]} rows @returns {string[][]} */
export function dropCommentRows(rows) {
  return rows.filter((r) => !String((r && r[0]) || '').trim().startsWith(CSV_COMMENT));
}
