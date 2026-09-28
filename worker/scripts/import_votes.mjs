#!/usr/bin/env node
// スプレッドシートの char_votes を D1 に 1 回だけ移すための SQL を作る。
//
//   node worker/scripts/import_votes.mjs <入力> > votes.sql
//   wrangler d1 execute spsp --remote --file votes.sql     (worker/ で実行)
//
// 入力 (拡張子で判定):
//   .json  GAS の export_votes の応答、またはビルドの build/data/char_votes.json
//          ({ votes: [{ts, userId|user_id, charId|char_id, charName|char_name, status}] })。
//          エクスポートには user_slug / gamer_tag が無いので空欄になる。
//   .csv   スプレッドシートの char_votes シートを「CSV でダウンロード」したもの
//          (ヘッダ timestamp,user_id,user_slug,gamer_tag,char_id,char_name,status)。
//          こちらは全列が入る。
// どちらも status=debug の行 (撤去済みデバッグモードの残り) は入れない。
// 同じ入力を 2 回流しても増えないよう、(ts, user_id, char_id) が既にある行は INSERT しない。
import fs from 'node:fs';
import path from 'node:path';

/** SQL 文字列リテラル。 */
export function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** RFC 4180 風の CSV を行配列にする (引用符内の改行・"" に対応)。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** JSON / CSV の中身を共通の行 ({ts,user_id,user_slug,gamer_tag,char_id,char_name,status}) にする。 */
export function normalizeRows(input, kind) {
  const out = [];
  if (kind === 'csv') {
    const rows = parseCsv(input);
    const header = rows.shift() || [];
    const idx = (name) => header.indexOf(name);
    const want = ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'char_id', 'char_name', 'status'];
    for (const w of want) if (idx(w) < 0) throw new Error('CSV のヘッダに ' + w + ' が無い: ' + header.join(','));
    for (const r of rows) {
      if (!r.length || r.every((c) => c === '')) continue;
      out.push({
        ts: r[idx('timestamp')], user_id: r[idx('user_id')], user_slug: r[idx('user_slug')], gamer_tag: r[idx('gamer_tag')],
        char_id: r[idx('char_id')], char_name: r[idx('char_name')], status: r[idx('status')],
      });
    }
  } else {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const votes = Array.isArray(data) ? data : (data && data.votes);
    if (!Array.isArray(votes)) throw new Error('votes が配列ではありません');
    for (const v of votes) {
      out.push({
        ts: v.ts, user_id: v.userId ?? v.user_id, user_slug: v.userSlug ?? v.user_slug ?? '', gamer_tag: v.gamerTag ?? v.gamer_tag ?? '',
        char_id: v.charId ?? v.char_id, char_name: v.charName ?? v.char_name ?? '', status: v.status,
      });
    }
  }
  return out;
}

/** 行 → INSERT 文の配列。壊れた行・debug 行は捨てる (エクスポートと同じ基準)。 */
export function toSql(rows) {
  const stmts = [];
  for (const r of rows) {
    const ts = String(r.ts || '').trim();
    const uid = String(r.user_id ?? '').trim();
    const cid = String(r.char_id ?? '').trim();
    const status = String(r.status || '').trim() || 'pending';
    if (!ts || !uid || !cid) continue;
    if (status === 'debug') continue;
    const ms = Date.parse(ts);
    if (Number.isNaN(ms)) throw new Error('timestamp が読めない: ' + ts);
    stmts.push(
      'INSERT INTO votes (ts, ts_ms, day, user_id, user_slug, gamer_tag, char_id, char_name, status) '
      + `SELECT ${q(ts)}, ${ms}, ${q(ts.slice(0, 10))}, ${q(uid)}, ${q(r.user_slug ?? '')}, ${q(r.gamer_tag ?? '')}, ${q(cid)}, ${q(r.char_name ?? '')}, ${q(status)} `
      + `WHERE NOT EXISTS (SELECT 1 FROM votes WHERE ts = ${q(ts)} AND user_id = ${q(uid)} AND char_id = ${q(cid)});`);
  }
  return stmts;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node worker/scripts/import_votes.mjs <char_votes.json | export.json | char_votes.csv> > votes.sql');
    process.exit(2);
  }
  const kind = path.extname(file).toLowerCase() === '.csv' ? 'csv' : 'json';
  const rows = normalizeRows(fs.readFileSync(file, 'utf8'), kind);
  const stmts = toSql(rows);
  process.stdout.write('-- import_votes.mjs: ' + rows.length + ' rows read, ' + stmts.length + ' INSERT\n');
  process.stdout.write(stmts.join('\n') + '\n');
  console.error(`${stmts.length} 行 (入力 ${rows.length} 行、debug/壊れた行は除外)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
