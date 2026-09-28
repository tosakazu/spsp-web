// scripts/import_votes.mjs (シート → D1 の移行 SQL)。
import test from 'node:test';
import assert from 'node:assert';
import { normalizeRows, toSql, parseCsv, q } from '../scripts/import_votes.mjs';

test('export JSON / build の char_votes.json のどちらからも同じ行になる', () => {
  const fromExport = normalizeRows({ votes: [{ ts: '2026-08-14T10:00:00+09:00', userId: '111', charId: '1305', charName: 'ロックマン', status: 'pending' }] }, 'json');
  const fromBuild = normalizeRows(JSON.stringify({ votes: [{ ts: '2026-08-14T10:00:00+09:00', user_id: 111, char_id: 1305, char_name: 'ロックマン', status: 'pending' }] }), 'json');
  assert.deepStrictEqual(toSql(fromExport), toSql(fromBuild));
  const sql = toSql(fromExport)[0];
  assert.match(sql, /^INSERT INTO votes \(ts, ts_ms, day, user_id, user_slug, gamer_tag, char_id, char_name, status\) SELECT '2026-08-14T10:00:00\+09:00', 1786669200000, '2026-08-14', '111', '', '', '1305', 'ロックマン', 'pending' WHERE NOT EXISTS/);
});

test('CSV (シートのダウンロード) は全列が入る、引用符・改行・BOM に対応', () => {
  const csv = '﻿timestamp,user_id,user_slug,gamer_tag,char_id,char_name,status\r\n'
    + '2026-08-14T10:00:00+09:00,111,user/abc,"Tag ""T"", Jr.",1305,ロックマン,pending\r\n'
    + '2026-08-14T10:01:00+09:00,222,user/def,X,1271,ベヨネッタ,debug\r\n'
    + ',,,,,,\r\n';
  const rows = normalizeRows(csv, 'csv');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].gamer_tag, 'Tag "T", Jr.');
  const sql = toSql(rows);
  assert.strictEqual(sql.length, 1);                       // debug 行は入れない
  assert.match(sql[0], /'Tag "T", Jr\.'/);
  assert.match(sql[0], /'user\/abc'/);
  assert.deepStrictEqual(parseCsv('a,"b\nc",d\n'), [['a', 'b\nc', 'd']]);
  assert.strictEqual(q("it's"), "'it''s'");
});

test('壊れた行 (uid / char_id 無し) は捨て、timestamp が読めなければ例外', () => {
  assert.deepStrictEqual(toSql([{ ts: '2026-08-14T10:00:00+09:00', user_id: '', char_id: '1' }]), []);
  assert.deepStrictEqual(toSql([{ ts: '2026-08-14T10:00:00+09:00', user_id: '1', char_id: '' }]), []);
  assert.throws(() => toSql([{ ts: 'yesterday', user_id: '1', char_id: '2' }]), /timestamp/);
});
