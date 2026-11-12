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
  for (const m of ['0001_init.sql', '0002_card_settings.sql', '0003_class_brackets.sql', '0004_class_delete.sql', '0005_title_owned.sql', '0006_csp_reports.sql', '0007_title_owned_without_rowid.sql', '0008_title_owned_draw_counts.sql', '0009_tool_logs.sql', '0010_login_log.sql', '0011_csp_sample.sql', '0012_reports.sql', '0013_report_presets.sql', '0014_report_grants.sql', '0015_report_push.sql', '0016_report_managers.sql', '0017_report_outage.sql', '0018_report_dq_noshow.sql', '0019_report_start_sync.sql', '0020_report_sgg_admins.sql', '0021_report_prog_ok.sql', '0022_report_snapshot_meta.sql', '0023_report_ended.sql', '0024_bracket_shares.sql', '0025_bracket_shares_owner.sql', '0026_report_auto_start.sql', '0027_login_handoffs.sql', '0028_report_snapshot_checked.sql', '0029_report_entrants.sql']) db.exec(fs.readFileSync(new URL('../migrations/' + m, import.meta.url), 'utf8'));
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

test('title_owned: 読んだときのままの行だけ書く (無ければ作る・あれば prev と一致するときだけ)、updated はビットが変わったときだけ', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  assert.strictEqual(await store.getTitleOwned('1', 'ja'), null);
  const rows = Array.from({ length: 205 }, (_, i) => ({ uid: String(i + 1), prev: null, bits: 'Ag', n_pre: 0, n_post: 0 }));
  assert.deepStrictEqual(await store.casTitleOwnedMany('ja', rows, '2026-10-02'), []);
  assert.deepStrictEqual(await store.getTitleOwned('1', 'ja'), { bits: 'Ag', updated: '2026-10-02', n_pre: 0, n_post: 0 });
  assert.strictEqual(await store.getTitleOwned('1', 'en'), null);
  // 作るつもり (prev null) でもう行がある → 書かない
  assert.deepStrictEqual(await store.casTitleOwnedMany('ja', [{ uid: '1', prev: null, bits: 'Bg', n_pre: 3, n_post: 0 }], '2026-10-03'), ['1']);
  // prev が今の行と同じ → 書く (ビットが変わったので updated も変わる)。違えば書かない
  const prev = { bits: 'Ag', n_pre: 0, n_post: 0 };
  assert.deepStrictEqual(await store.casTitleOwnedMany('ja', [
    { uid: '1', prev, bits: 'Bg', n_pre: 3, n_post: 1 },
    { uid: '2', prev: { bits: 'Ag', n_pre: 1, n_post: 0 }, bits: 'Bg', n_pre: 3, n_post: 1 },
  ], '2026-10-03'), ['2']);
  assert.deepStrictEqual(await store.getTitleOwned('1', 'ja'), { bits: 'Bg', updated: '2026-10-03', n_pre: 3, n_post: 1 });
  assert.deepStrictEqual(await store.getTitleOwned('2', 'ja'), { bits: 'Ag', updated: '2026-10-02', n_pre: 0, n_post: 0 });
  // 回数だけ増えた (引き切っていてビットは同じ) → updated はそのまま
  assert.deepStrictEqual(await store.casTitleOwnedMany('ja', [{ uid: '1', prev: { bits: 'Bg', n_pre: 3, n_post: 1 }, bits: 'Bg', n_pre: 6, n_post: 1 }], '2026-10-04'), []);
  assert.deepStrictEqual(await store.getTitleOwned('1', 'ja'), { bits: 'Bg', updated: '2026-10-03', n_pre: 6, n_post: 1 });
  const page = await store.listTitleOwned('ja', 100, 3);
  assert.deepStrictEqual(page.map((x) => x.uid), [101, 102, 103]);
  assert.deepStrictEqual(page[0], { uid: 101, bits: 'Ag', updated: '2026-10-02', n_pre: 0, n_post: 0 });
  assert.deepStrictEqual((await store.listTitleOwned('ja', 204, 10)).map((x) => x.uid), [205]);
});

test('title_owned: 0007 で WITHOUT ROWID に作り直し、0005 の行はそのまま残る。0008 で回数の列 (既定 0)', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_init.sql', '0002_card_settings.sql', '0003_class_brackets.sql', '0004_class_delete.sql', '0005_title_owned.sql']) db.exec(fs.readFileSync(new URL('../migrations/' + m, import.meta.url), 'utf8'));
  db.prepare('INSERT INTO title_owned (uid, lang, bits, updated) VALUES (?, ?, ?, ?)').run(7, 'ja', 'Ag', '2026-10-02');
  db.exec(fs.readFileSync(new URL('../migrations/0007_title_owned_without_rowid.sql', import.meta.url), 'utf8'));
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'title_owned'").get().sql, /WITHOUT ROWID/);
  db.exec(fs.readFileSync(new URL('../migrations/0008_title_owned_draw_counts.sql', import.meta.url), 'utf8'));
  const store = new D1Store(d1Like(db));
  assert.deepStrictEqual(await store.getTitleOwned('7', 'ja'), { bits: 'Ag', updated: '2026-10-02', n_pre: 0, n_post: 0 });
  assert.deepStrictEqual(await store.casTitleOwnedMany('ja', [{ uid: '7', prev: { bits: 'Ag', n_pre: 0, n_post: 0 }, bits: 'Bg', n_pre: 3, n_post: 0 }], '2026-10-03'), []);
  assert.deepStrictEqual(await store.getTitleOwned('7', 'ja'), { bits: 'Bg', updated: '2026-10-03', n_pre: 3, n_post: 0 });
});

test('csp_reports: 同じ key は hits+1・last_seen 更新、上限を超えた新しい key は入れない、多い順', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  const e = (i) => ({ directive: 'img-src', blocked: 'https://h' + i + '.example', path: '/', sample: i === 2 ? 'x()' : '', source: '' });
  await store.recordCsp('a', e(1), 'T1', 2);
  await store.recordCsp('a', e(1), 'T2', 2);
  await store.recordCsp('b', e(2), 'T3', 2);
  await store.recordCsp('c', e(3), 'T4', 2);   // 上限 2 で捨てる
  await store.recordCsp('b', e(2), 'T5', 2);
  await store.recordCsp('b', e(2), 'T6', 2);
  const rows = await store.listCsp();
  assert.deepStrictEqual(rows.map((r) => [r.blocked, r.hits, r.first_seen, r.last_seen, r.sample]),
    [['https://h2.example', 3, 'T3', 'T6', 'x()'], ['https://h1.example', 2, 'T1', 'T2', '']]);
});

test('login_log: 1 行ずつ足す (ユーザー ID・時刻・flow)', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { db, store } = fresh();
  await store.insertLogin({ user_id: '4242', ts_ms: 1793000000000, flow: 'login' });
  await store.insertLogin({ user_id: '4242', ts_ms: 1793000001000, flow: 'manager' });
  assert.deepStrictEqual(db.prepare('SELECT user_id, ts_ms, flow FROM login_log ORDER BY id').all().map((r) => ({ ...r })),
    [{ user_id: '4242', ts_ms: 1793000000000, flow: 'login' }, { user_id: '4242', ts_ms: 1793000001000, flow: 'manager' }]);
});

test('tool_logs: 1 行足す (null の欄はそのまま)・同じユーザーの当日分が上限なら足さない', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store, db } = fresh();
  const row = (u, day) => ({ ts: day + 'T12:00:00+09:00', ts_ms: 1, day, tool: 'seed', action: 'seeding', user_id: u, gamer_tag: 'T', verified: 0, auth: 'key',
    tournament_id: 777, tournament_slug: 's', tournament_name: 'n', event_id: null, event_name: '', phase_id: 9, count: 32, detail: '{"a":1}' });
  assert.strictEqual(await store.insertToolLog(row('1', '2026-10-28'), 2), true);
  assert.strictEqual(await store.insertToolLog(row('1', '2026-10-28'), 2), true);
  assert.strictEqual(await store.insertToolLog(row('1', '2026-10-28'), 2), false);
  assert.strictEqual(await store.insertToolLog(row('1', '2026-10-29'), 2), true);
  assert.strictEqual(await store.insertToolLog(row('2', '2026-10-28'), 2), true);
  const rows = db.prepare('SELECT user_id, day, event_id, phase_id, count, detail FROM tool_logs ORDER BY id').all();
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual({ ...rows[0] }, { user_id: '1', day: '2026-10-28', event_id: null, phase_id: 9, count: 32, detail: '{"a":1}' });
});

test('試合結果の報告: 受付の upsert (code は変えない)・期限切れの掃除・版つきの行・報告の数', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  const ev = { code: 'abcdefghjk', kind: 'startgg', target_id: '9', event_id: 9, tournament_id: 5, class_id: null, name: 'T', slug: 's',
    admins: '1', token_enc: 'v1.a.b', token_exp_ms: 10, status: 'active', created_ms: 100, expires_ms: 1000, settings: '{}' };
  await store.upsertReportEvent(ev);
  await store.upsertReportEvent({ ...ev, code: 'zzzzzzzzzz', admins: '1,2', created_ms: 999, settings: '{"top_cut":8}' });
  const got = await store.getReportEvent('abcdefghjk');
  assert.strictEqual(got.admins, '1,2'); assert.strictEqual(got.created_ms, 100); assert.strictEqual(got.settings, '{"top_cut":8}');
  assert.strictEqual(await store.getReportEvent('zzzzzzzzzz'), null);
  assert.strictEqual((await store.getReportEventByTarget('startgg', '9')).code, 'abcdefghjk');
  assert.strictEqual((await store.listActiveReportEvents(500)).length, 1);
  await store.updateReportEventSettings('abcdefghjk', '{}');
  await store.updateReportEventToken('abcdefghjk', 'v1.c.d', 20);
  assert.strictEqual((await store.getReportEvent('abcdefghjk')).token_enc, 'v1.c.d');
  await store.updateReportEventSggAdmins('abcdefghjk', '1,7', 30);
  await store.updateReportEventSggAdmins('abcdefghjk', null, 40);
  await store.upsertReportEvent({ ...ev, admins: '1,2', settings: '{}' });
  const sa = await store.getReportEvent('abcdefghjk');
  assert.deepStrictEqual([sa.sgg_admins, sa.sgg_admins_ms], ['1,7', 40], '時刻だけ・受付の上書きでも一覧は残る');
  await store.updateReportEventToken('abcdefghjk', 'v1.c.d', 20);
  await store.purgeReportTokens(2000);
  const p = await store.getReportEvent('abcdefghjk');
  assert.deepStrictEqual([p.status, p.token_enc], ['stopped', '']);
  assert.strictEqual((await store.listActiveReportEvents(500)).length, 0);

  // 名前をつけて保存した設定: 上書き・上限・消す
  assert.strictEqual(await store.saveReportPreset('11', { name: 'a', settings: '{}', updated_ms: 1 }, 2), true);
  assert.strictEqual(await store.saveReportPreset('11', { name: 'b', settings: '{}', updated_ms: 2 }, 2), true);
  assert.strictEqual(await store.saveReportPreset('11', { name: 'c', settings: '{}', updated_ms: 3 }, 2), false);
  assert.strictEqual(await store.saveReportPreset('11', { name: 'a', settings: '{"x":1}', updated_ms: 4 }, 2), true);
  assert.strictEqual(await store.saveReportPreset('22', { name: 'a', settings: '{}', updated_ms: 5 }, 2), true);
  assert.deepStrictEqual((await store.listReportPresets('11')).map((x) => [x.name, x.settings]), [['a', '{"x":1}'], ['b', '{}']]);
  await store.deleteReportPreset('11', 'a');
  assert.deepStrictEqual((await store.listReportPresets('11')).map((x) => x.name), ['b']);

  // 運営のログインのトークン: 置き直し・期限・消す
  await store.putReportGrant({ user_id: '11', token_enc: 'v1.a', token_exp_ms: 10, expires_ms: 5000 });
  await store.putReportGrant({ user_id: '11', token_enc: 'v1.b', token_exp_ms: 20, expires_ms: 6000 });
  assert.strictEqual((await store.getReportGrant('11', 5500)).token_enc, 'v1.b');
  assert.strictEqual(await store.getReportGrant('11', 6001), null);
  await store.purgeReportTokens(7000);
  assert.strictEqual(await store.getReportGrant('11', 0), null, '期限を過ぎたら消す');
  await store.putReportGrant({ user_id: '22', token_enc: 'v1.c', token_exp_ms: 20, expires_ms: 9000 });
  await store.deleteReportGrant('22');
  assert.strictEqual(await store.getReportGrant('22', 0), null);

  const row = { code: 'abcdefghjk', set_id: '100', state: 'reported', users: '|11|22|', slots: '[]', applied: '{}', note: '', floor_id: 0, version: 1, updated_ms: 1 };
  assert.strictEqual(await store.casReportSet(row, null), true);
  assert.strictEqual(await store.casReportSet(row, null), false);
  assert.strictEqual(await store.casReportSet({ ...row, state: 'agreed', version: 2 }, 0), false);
  assert.strictEqual(await store.casReportSet({ ...row, state: 'agreed', version: 2 }, 1), true);
  assert.strictEqual((await store.getReportSet('abcdefghjk', '100')).state, 'agreed');
  assert.strictEqual((await store.listReportSetsForUser('22', ['abcdefghjk'])).length, 1);
  assert.strictEqual((await store.listReportSetsForUser('2', ['abcdefghjk'])).length, 0);
  assert.strictEqual((await store.listReportSetsForUser('22', [])).length, 0);
  assert.strictEqual((await store.listReportSets('abcdefghjk')).length, 1);
  const id1 = await store.insertReportSubmission({ code: 'abcdefghjk', set_id: '100', user_id: '11', side: 0, ts_ms: 50, result: '{}', outcome: 'pending' });
  const id2 = await store.insertReportSubmission({ code: 'abcdefghjk', set_id: '100', user_id: '11', side: 0, ts_ms: 60, result: '{}', outcome: 'pending' });
  assert.ok(id2 > id1);
  await store.setReportSubmissionOutcome(id1, 'report');
  const subs = await store.listReportSubmissions('abcdefghjk', '100');
  assert.deepStrictEqual(subs.map((x) => [x.id, x.outcome]), [[id1, 'report'], [id2, 'pending']]);
  assert.deepStrictEqual(await store.reportSubmissionActivity('11', 55), { count: 1, latestMs: 60 });
  assert.deepStrictEqual(await store.reportSubmissionActivity('99', 0), { count: 0, latestMs: null });
  await store.stopReportEvent('abcdefghjk');
});

test('報告の障害時 (0017): 様子の upsert と試す役、写しの役 (同時に 1 つ)、指定した試合、報告の付け替え・行の削除', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  assert.strictEqual(await store.getReportHealth('startgg'), null);
  const h = { kind: 'startgg', down_since_ms: 100, last_fail_ms: 100, last_ok_ms: 0, fails: 2, probe_ms: 100, note: 'timeout' };
  await store.putReportHealth(h);
  await store.putReportHealth({ ...h, fails: 3 });
  assert.strictEqual((await store.getReportHealth('startgg')).fails, 3);
  assert.strictEqual(await store.claimReportProbe('startgg', 120, 30), false, '30 より前に試したばかり');
  assert.strictEqual(await store.claimReportProbe('startgg', 200, 30), true);
  assert.strictEqual(await store.claimReportProbe('startgg', 201, 30), false, '同時に 2 つは試さない');
  // 写し
  assert.strictEqual(await store.claimReportSnapshot('c1', 1000, 25), true, '行が無ければ作って取る');
  assert.strictEqual(await store.claimReportSnapshot('c1', 1010, 25), false);
  await store.putReportSnapshot('c1', '{"v":1}', 1010);
  assert.deepStrictEqual({ ...(await store.getReportSnapshot('c1')) }, { code: 'c1', data: '{"v":1}', synced_ms: 1010, lock_ms: 0, m_full: 0, m_sets: 0, checked_ms: 0 });
  assert.deepStrictEqual(await store.getReportSnapshotMeta('c1'), { synced_ms: 1010, checked_ms: 0, full: false, sets: 0 }, '古い形 (JSON) は中身から');
  // 圧縮した写し (0022): 中身を開かずに列から
  await store.putReportSnapshot('c2', 'z1:AAAA', 1020, { full: true, sets: 7 });
  assert.deepStrictEqual(await store.getReportSnapshotMeta('c2'), { synced_ms: 1020, checked_ms: 0, full: true, sets: 7 });
  // 変わっていなかった (0028): 確かめた時刻だけ進めて鍵を外す。書き直すと 0 に戻る
  assert.strictEqual(await store.claimReportSnapshot('c2', 1030, 25), true);
  await store.touchReportSnapshot('c2', 1040);
  assert.deepStrictEqual(await store.getReportSnapshotMeta('c2'), { synced_ms: 1020, checked_ms: 1040, full: true, sets: 7 });
  assert.strictEqual((await store.getReportSnapshot('c2')).lock_ms, 0);
  await store.putReportSnapshot('c2', 'z1:BBBB', 1050, { full: true, sets: 8 });
  assert.strictEqual((await store.getReportSnapshotMeta('c2')).checked_ms, 0);
  assert.strictEqual(await store.claimReportSnapshot('c1', 1011, 25), true, '書いたら役を外す');
  await store.releaseReportSnapshot('c1');
  assert.strictEqual((await store.getReportSnapshot('c1')).lock_ms, 0);
  // Challonge の写し: 読んだ後にほかの要求が書いていたら書かない (synced_ms で見る)。行が無ければ作る。書いたら役を外す
  assert.strictEqual(await store.casReportSnapshot('c3', '{"v":1,"n":1}', 2000, 0), true, '行が無ければ作る');
  assert.strictEqual(await store.casReportSnapshot('c3', '{"v":1,"n":2}', 2010, 0), false, 'もう書かれている');
  assert.strictEqual(await store.claimReportSnapshot('c3', 2020, 25), true);
  assert.strictEqual(await store.casReportSnapshot('c3', '{"v":1,"n":3}', 2030, 2000), true);
  assert.deepStrictEqual((({ data, synced_ms, lock_ms }) => ({ data, synced_ms, lock_ms }))(await store.getReportSnapshot('c3')), { data: '{"v":1,"n":3}', synced_ms: 2030, lock_ms: 0 });
  assert.strictEqual(await store.casReportSnapshot('c3', '{"v":1,"n":4}', 2040, 2000), false, '古い版からは書けない');
  assert.strictEqual(await store.claimReportSnapshot('c4', 2050, 25), true);
  assert.strictEqual(await store.casReportSnapshot('c4', '{"v":1}', 2060, 0), true, '役を取ったときにできた空の行に書く');
  // 指定した試合
  const m = { code: 'c1', side: 'l', group_id: '700', slots: '[]', users: '|11|22|', station: '3', set_id: '', status: 'open', created_by: '4242', created_ms: 5, updated_ms: 5 };
  const id = await store.insertReportManual(m);
  await store.insertReportManual({ ...m, users: '|33|44|' });
  assert.strictEqual((await store.getReportManual('c1', id)).station, '3');
  assert.deepStrictEqual((await store.listReportManualForUser('22', 'c1')).map((x) => x.id), [id]);
  await store.updateReportManual('c1', id, 'matched', '103', 9);
  assert.deepStrictEqual((await store.listReportManualForUser('22', 'c1')), [], 'open だけ');
  assert.deepStrictEqual((await store.listReportManual('c1')).map((x) => [x.id, x.status, x.set_id]), [[id + 1, 'open', ''], [id, 'matched', '103']]);
  // 報告の付け替え・行の削除
  const sid = await store.insertReportSubmission({ code: 'c1', set_id: 'm' + id, user_id: '22', side: 1, ts_ms: 5, result: '{"w":1}', outcome: '' });
  await store.updateReportSubmission(sid, '103', 0, '{"w":0}');
  assert.deepStrictEqual((await store.listReportSubmissions('c1', '103')).map((x) => [x.side, x.result]), [[0, '{"w":0}']]);
  await store.casReportSet({ code: 'c1', set_id: 'm1', state: 'queued', users: '', slots: '[]', applied: '', note: 'manual', floor_id: 0, version: 1, updated_ms: 5 }, null);
  await store.deleteReportSet('c1', 'm1');
  assert.strictEqual(await store.getReportSet('c1', 'm1'), null);
});

test('report_picks (0017): 1 人 1 行 (選び直すと上書き・空で消す)、試合ごとに消す、時刻で絞る', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  await store.putReportPick('c1', '11', '100', 10);
  await store.putReportPick('c1', '11', '101', 20);
  await store.putReportPick('c1', '12', '101', 30);
  await store.putReportPick('c1', '13', '102', 5);
  assert.deepStrictEqual((await store.listReportPicks('c1', 10)).map((x) => [x.user_id, x.set_id]).sort(), [['11', '101'], ['12', '101']]);
  await store.deleteReportPicksForSet('c1', '101');
  await store.putReportPick('c1', '13', '', 40);
  assert.deepStrictEqual(await store.listReportPicks('c1', 0), []);
});

test('0018: 見つからないの押し直し (回数・時刻・通知の時刻)・解決・対戦開始は最初の 1 回・DQ', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const { store } = fresh();
  const row = (ms) => ({ code: 'c1', set_id: '100', user_id: '11', users: '|11|12|', info: '{"opp":"B"}', first_ms: ms, last_ms: ms, count: 1, notified_ms: 0, status: 'open', note: '' });
  await store.upsertReportNoshow(row(10), 10);
  await store.upsertReportNoshow(row(20), null);
  let r = await store.getReportNoshow('c1', '100', '11');
  assert.deepStrictEqual([r.first_ms, r.last_ms, r.count, r.notified_ms, r.status], [10, 20, 2, 10, 'open']);
  assert.deepStrictEqual((await store.listReportNoshowsForUser('c1', '12', 0)).map((x) => x.user_id), ['11'], '相手の検索');
  await store.resolveReportNoshows('c1', '100', 'started', null);
  await store.upsertReportNoshow(row(30), 30);
  r = await store.getReportNoshow('c1', '100', '11');
  assert.deepStrictEqual([r.first_ms, r.count, r.status, r.notified_ms], [30, 3, 'open', 30], '解決の後に押したら開き直す');
  assert.strictEqual(await store.insertReportStart('c1', '100', '|11|12|', '12', 40), true);
  assert.strictEqual(await store.insertReportStart('c1', '100', '|11|12|', '11', 50), false);
  assert.deepStrictEqual({ ...(await store.getReportStart('c1', '100')) }, { set_id: '100', user_id: '12', ts_ms: 40, sgg: 0, tried_ms: 0, note: '', info: '{}' });
  await store.setReportStartSync('c1', '100', 1, '', 60);
  await store.insertReportStart('c1', 'm3', '|11|12|', '11', 70, '{"names":["A","B"]}');
  await store.moveReportStart('c1', 'm3', '200');
  assert.deepStrictEqual((await store.listReportStarts('c1', 0)).map((x) => [x.set_id, x.sgg, x.info]).sort(), [['100', 1, '{}'], ['200', 0, '{"names":["A","B"]}']]);
  assert.strictEqual((await store.listReportStartsForUser('c1', '11', 0)).length, 2);
  const id = await store.insertReportDq({ code: 'c1', entrant_id: '4', name: 'P4', scope: 'l', status: 'open', done_sets: '', note: '', created_by: '1', created_ms: 1, updated_ms: 1 });
  await store.updateReportDq('c1', id, 'done', '103', '', 5);
  assert.deepStrictEqual((await store.listReportDqs('c1')).map((x) => [x.status, x.done_sets]), [['done', '103']]);
});
