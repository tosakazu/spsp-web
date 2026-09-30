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
      stmt.run = async () => { const r = db.prepare(sql).run(...stmt.params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
      return stmt;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function fresh() {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_init.sql', '0002_card_settings.sql', '0003_class_brackets.sql', '0004_class_delete.sql']) db.exec(fs.readFileSync(new URL('../migrations/' + m, import.meta.url), 'utf8'));
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

test('card_settings: 連投条件つきの置き換え・削除と、古い書き込み記録の掃除', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store, db } = fresh();
  const t0 = Date.parse('2026-09-30T03:00:00Z');
  const g = (now, max = 100) => ({ userId: '4242', nowMs: now, minIntervalMs: 10000, dayKey: dayOf(now), maxPerDay: max });
  assert.strictEqual(await store.getCardSettings('4242'), null);
  assert.strictEqual(await store.putCardSettings('4242', '{"a":1}', 'U1', g(t0)), true);
  assert.deepStrictEqual(await store.getCardSettings('4242'), { settings: '{"a":1}', updated_at: 'U1' });
  assert.strictEqual(await store.putCardSettings('4242', '{"a":2}', 'U2', g(t0 + 5000)), false);     // 5 秒後は連投
  assert.deepStrictEqual(await store.getCardSettings('4242'), { settings: '{"a":1}', updated_at: 'U1' });
  assert.strictEqual(await store.putCardSettings('4242', '{"a":3}', 'U3', g(t0 + 11000)), true);     // 置き換え
  assert.deepStrictEqual(await store.getCardSettings('4242'), { settings: '{"a":3}', updated_at: 'U3' });
  assert.strictEqual(await store.putCardSettings('4242', '{"a":4}', 'U4', g(t0 + 30000, 2)), false); // 当日 2 件で上限
  assert.strictEqual(await store.putCardSettings('4242', null, 'U5', g(t0 + 40000)), true);          // 削除
  assert.strictEqual(await store.getCardSettings('4242'), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM card_writes').get().n, 3);
  assert.strictEqual(await store.putCardSettings('4242', '{"a":6}', 'U6', g(t0 + 3 * 24 * 3600e3)), true);   // 3 日後: 古い記録は消える
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM card_writes').get().n, 1);
  assert.strictEqual(typeof db.prepare('SELECT uid FROM card_settings').get().uid, 'number', 'uid は INTEGER で入る');
});

test('class_brackets: 追加 (id を返す)・重複は duplicate・連投は rate_limited・取得待ちの一覧・done', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  const t0 = Date.parse('2026-09-30T03:00:00Z');
  const row = (cid, now, counted = 1) => ({ created_at: 'C' + cid, ts_ms: now, day: dayOf(now), parent_event_id: 1234567,
    parent_tournament_id: 777, class_letter: 'B', name: 'n' + cid, challonge_id: cid, challonge_url: 'https://challonge.com/' + cid,
    format: 'single', counted, place_min: 9, place_max: null, seeding: 'random', entrant_count: 32, registered_by: '111' });
  const g = (now) => ({ userId: '111', nowMs: now, minIntervalMs: 10000, dayKey: dayOf(now), maxPerDay: 50 });
  assert.deepStrictEqual(await store.insertClassBracket(row(1, t0), g(t0)), { status: 'ok', id: 1 });
  assert.strictEqual(await store.classExists(1), true);
  assert.deepStrictEqual(await store.insertClassBracket(row(1, t0 + 60000), g(t0 + 60000)), { status: 'duplicate' });
  assert.strictEqual(await store.classRateOk(g(t0 + 5000)), false);
  assert.strictEqual(await store.classRateOk(g(t0 + 20000)), true);
  assert.deepStrictEqual(await store.insertClassBracket(row(2, t0 + 5000), g(t0 + 5000)), { status: 'rate_limited' });
  assert.deepStrictEqual(await store.insertClassBracket(row(2, t0 + 20000, 0), g(t0 + 20000)), { status: 'ok', id: 2 });
  assert.deepStrictEqual(await store.insertClassBracket(row(3, t0 + 40000), g(t0 + 40000)), { status: 'ok', id: 3 });
  const w = await store.listClassWaitlist();
  assert.deepStrictEqual(w.map((x) => x.id), [1, 3]);
  assert.deepStrictEqual(w[0], { id: 1, parent_event_id: 1234567, parent_tournament_id: 777, class_letter: 'B', name: 'n1',
    challonge_id: 1, challonge_url: 'https://challonge.com/1', created_at: 'C1' });
  assert.strictEqual(await store.markClassDone(1), 'done');
  assert.strictEqual(await store.markClassDone(99), 'missing');
  assert.deepStrictEqual((await store.listClassWaitlist()).map((x) => x.id), [3]);
  // 削除 (0004): done は消さない、waiting は deleted に、deleted に done は付かない
  assert.deepStrictEqual(await store.getClassBracket(3), { id: 3, parent_event_id: 1234567, challonge_id: 3, registered_by: '111', status: 'waiting' });
  assert.strictEqual(await store.getClassBracket(42), null);
  assert.strictEqual(await store.markClassDeleted(1, 'D'), 'done');
  assert.strictEqual(await store.markClassDeleted(3, 'D3'), 'deleted');
  assert.strictEqual(await store.markClassDeleted(3, 'D3'), 'missing');
  assert.strictEqual(await store.markClassDeleted(42, 'D'), 'missing');
  assert.strictEqual(await store.markClassDone(3), 'deleted');
  assert.deepStrictEqual((await store.listClassWaitlist()).map((x) => x.id), []);
  const mine = await store.listClassMine('111', t0 - 1);
  assert.deepStrictEqual(mine.map((x) => [x.id, x.counted, x.status]), [[2, false, 'waiting'], [1, true, 'done']]);
  assert.deepStrictEqual(await store.listClassMine('111', t0 + 30000), [], '期間外');
  // class_actions の連投判定
  const ga = (now) => ({ userId: '111', nowMs: now, minIntervalMs: 2000, dayKey: dayOf(now), maxPerDay: 2 });
  assert.strictEqual(await store.recordClassAction('mine', ga(t0)), true);
  assert.strictEqual(await store.recordClassAction('mine', ga(t0 + 1000)), false);
  assert.strictEqual(await store.recordClassAction('delete', ga(t0 + 1000)), true, 'action ごとに別');
  assert.strictEqual(await store.recordClassAction('mine', ga(t0 + 3000)), true);
  assert.strictEqual(await store.recordClassAction('mine', ga(t0 + 6000)), false, '当日上限');
});
