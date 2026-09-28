// db.ts (D1Store) の SQL を本物の SQLite で確認する (node:sqlite。無い Node では skip)。
// D1 の API (prepare().bind().first()/run()/all(), batch()) を node:sqlite の上に薄く被せる。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { D1Store } from '../src/db.ts';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (_) { /* skip */ }

function d1Like(db) {
  return {
    prepare(sql) {
      const stmt = { sql, params: [] };
      stmt.bind = (...p) => { stmt.params = p; return stmt; };
      stmt.first = async () => db.prepare(sql).get(...stmt.params) ?? null;
      stmt.all = async () => ({ results: db.prepare(sql).all(...stmt.params) });
      stmt.run = async () => { const r = db.prepare(sql).run(...stmt.params); return { meta: { changes: Number(r.changes) } }; };
      return stmt;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return { db, store: new D1Store(d1Like(db)) };
}

const row = (ms, uid, cid) => ({ ts: new Date(ms + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00', ts_ms: ms, user_id: uid,
  user_slug: 'user/' + uid, gamer_tag: 'T' + uid, char_id: cid, char_name: 'c' + cid, status: 'pending' });
const guard = (uid, now, day) => ({ userId: uid, nowMs: now, minIntervalMs: 60000, dayKey: day, maxPerDay: 10 });
const dayOf = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

test('migration が通り、条件付き INSERT が連投 (60 秒 / 当日 10 件) を弾く', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  const t0 = Date.parse('2026-08-14T03:00:00Z');   // JST 12:00
  assert.strictEqual(await store.insertVote(row(t0, '1', '1305'), guard('1', t0, dayOf(t0))), true);
  assert.strictEqual(await store.insertVote(row(t0 + 30e3, '1', '1271'), guard('1', t0 + 30e3, dayOf(t0))), false);   // 30 秒後
  assert.strictEqual(await store.insertVote(row(t0 + 30e3, '2', '1271'), guard('2', t0 + 30e3, dayOf(t0))), true);    // 別ユーザー
  assert.strictEqual(await store.insertVote(row(t0 + 90e3, '1', '1271'), guard('1', t0 + 90e3, dayOf(t0))), true);    // 90 秒後
  let t = t0 + 90e3;
  for (let i = 0; i < 8; i++) { t += 120e3; assert.strictEqual(await store.insertVote(row(t, '1', '1305'), guard('1', t, dayOf(t))), true, 'i=' + i); }
  t += 120e3;
  assert.strictEqual(await store.insertVote(row(t, '1', '1305'), guard('1', t, dayOf(t))), false);   // 当日 10 件目以降
  const act = await store.recentActivity('votes', '1', dayOf(t));
  assert.deepStrictEqual(act, { latestMs: t - 120e3, todayCount: 10 });
  const next = t + 24 * 3600e3;                                                                        // 翌日
  assert.strictEqual(await store.insertVote(row(next, '1', '1305'), guard('1', next, dayOf(next))), true);
  const { rows, total } = await store.listVotes();
  assert.strictEqual(total, 12);
  assert.strictEqual(rows[0].user_id, '1');
  assert.strictEqual(rows[1].user_id, '2');
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['char_id', 'char_name', 'gamer_tag', 'status', 'ts', 'ts_ms', 'user_id', 'user_slug']);
  assert.strictEqual(await store.insertPost({ ...row(next, '9', ''), body: 'b' }, guard('9', next, dayOf(next))), true);
});

test('errors: 上限を超えたら古い行から削る、listErrors は末尾 n 行を古い順', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  for (let i = 0; i < 7; i++) await store.insertError({ ts: 't' + i, source: 'client', action: 'vote', code: 'x', user_id: '', note: '' }, 5, 3);
  const { rows, total } = await store.listErrors(2);
  // 6 件目で 5 を超え 3 件 (t3..t5) に間引き、7 件目が足されて 4 件 (GAS の trimErrorsSheet_ と同じ)
  assert.strictEqual(total, 4);
  assert.deepStrictEqual(rows.map((r) => r.ts), ['t5', 't6']);
  assert.deepStrictEqual(await store.listErrors(10).then((r) => r.rows.map((x) => x.ts)), ['t3', 't4', 't5', 't6']);
});

test('used_states: 単回使用と期限切れの掃除', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store, db } = fresh();
  assert.strictEqual(await store.checkState('st:a', false, 2000, 1000), true);
  assert.strictEqual(await store.checkState('st:a', true, 2000, 1000), true);
  assert.strictEqual(await store.checkState('st:a', false, 2000, 1000), false);
  assert.strictEqual(await store.checkState('st:a', true, 2000, 1000), false);
  assert.strictEqual(await store.checkState('st:b', true, 2000, 2500), true);    // 期限切れの a を掃除
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM used_states').get().n, 1);
});
