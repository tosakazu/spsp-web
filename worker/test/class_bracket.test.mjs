// 下位クラスの登録 (class_register)・取得待ちの一覧 (class_waitlist)・取得済み (class_done)。docs/class_bracket_design.md
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http } from './_env.mjs';
import { parseClassRegister } from '../src/api/class_bracket.ts';
import { CLASS_RATE_MIN_INTERVAL_MS } from '../src/config.ts';

const KEY = 'startgg-key-DO-NOT-LEAK-123';
const DONE_KEY = 'class-done-key-xyz';
const gql = (userId, owner, admins) => ({
  status: 200,
  body: { data: { currentUser: { id: userId }, event: { id: 1234567, tournament: { id: 777, owner: { id: owner }, admins } } } },
});
const env = (user, o) => makeEnv(Object.assign({ user, cfg: { classDoneKey: DONE_KEY } }, o || {}));
const body = (o) => Object.assign({
  action: 'class_register', startgg_token: KEY, parent_event_id: 1234567, class_letter: 'B', name: '篝火#15 Bクラス',
  challonge: { id: 12345678, url: 'https://challonge.com/abcd1234' }, format: 'single', counted: true,
  place_min: 9, place_max: null, seeding: 'main_result', entrant_count: 32,
}, o || {});
const leaked = (e) => JSON.stringify(e.store) .includes(KEY);

test('class_register: admins に入っていれば登録でき、class_waitlist に出る。キーはどこにも残らない', async () => {
  const e = env(gql(111, 999, [{ id: 111 }, { id: 222 }]));
  const r = await post(e, body());
  assert.deepStrictEqual(r, { ok: true, id: 1 });
  const row = e.store.classes[0];
  assert.strictEqual(row.parent_tournament_id, 777, '大会 ID は start.gg に問い合わせた値');
  assert.strictEqual(row.registered_by, '111', '登録者は start.gg に問い合わせた値');
  assert.strictEqual(row.counted, 1);
  assert.strictEqual(row.place_max, null);
  assert.strictEqual(row.status, 'waiting');
  assert.match(row.created_at, /\+09:00$/);
  // start.gg への問い合わせ: キーは Authorization ヘッダだけ、本文には入れない
  const f = e.fetches.find((x) => String(x.url).includes('/gql/'));
  assert.strictEqual(f.init.headers.Authorization, 'Bearer ' + KEY);
  assert.ok(!String(f.init.body).includes(KEY));
  assert.deepStrictEqual(JSON.parse(f.init.body).variables, { eventId: '1234567' });
  assert.ok(f.init.signal, 'タイムアウトつき');
  assert.strictEqual(leaked(e), false);
  const w = await post(e, { action: 'class_waitlist' });
  assert.deepStrictEqual(w.items, [{ id: 1, parent_event_id: 1234567, parent_tournament_id: 777, class_letter: 'B',
    name: '篝火#15 Bクラス', challonge_id: 12345678, challonge_url: 'https://challonge.com/abcd1234', created_at: row.created_at }]);
});

test('class_register: owner でも登録できる (admins が null で返っても)', async () => {
  const e = env(gql(111, 111, null));
  assert.strictEqual((await post(e, body())).ok, true);
});

test('class_register: owner でも admins でもなければ not_admin。何も書かず、errors の note にキーは入らない', async () => {
  const e = env(gql(111, 999, [{ id: 222 }]));
  const r = await post(e, body());
  assert.strictEqual(r.error.code, 'not_admin');
  assert.strictEqual(e.store.classes.length, 0);
  assert.deepStrictEqual(e.store.errors.map((x) => [x.action, x.code, x.note]), [['class_register', 'not_admin', 'not_admin']]);
  assert.strictEqual(leaked(e), false);
});

test('class_register: start.gg の失敗は startgg_error (キー無効・混雑・通信断・タイムアウト・壊れた応答)', async () => {
  const cases = [
    [{ status: 401, body: {} }, 'http_401', /API キーが無効/],
    [{ status: 429, body: {} }, 'http_429', /混み合って/],
    [{ status: 200, body: 'not json' }, 'bad_json', /確認できませんでした/],
    [{ status: 200, body: { data: { currentUser: null }, errors: [{ message: 'x' }] } }, 'gql_error', /確認できませんでした/],
    [null, 'network', /確認できませんでした/],
  ];
  for (const [spec, note, msg] of cases) {
    const e = env(spec);
    const r = await post(e, body());
    assert.strictEqual(r.error.code, 'startgg_error', note);
    assert.match(r.error.message, msg, note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
    assert.strictEqual(leaked(e), false);
  }
  const e = env(gql(1, 1, []));
  e.ctx.fetch = async () => { const x = new Error('timed out'); x.name = 'TimeoutError'; throw x; };
  const r = await post(e, body());
  assert.strictEqual(r.error.code, 'startgg_error');
  assert.strictEqual(e.store.errors.at(-1).note, 'timeout');
});

test('class_register: イベントが無ければ bad_request (event_not_found)', async () => {
  const e = env({ status: 200, body: { data: { currentUser: { id: 1 }, event: null } } });
  const r = await post(e, body());
  assert.strictEqual(r.error.code, 'bad_request');
  assert.strictEqual(e.store.errors.at(-1).note, 'event_not_found');
});

test('class_register: 同じ challonge_id は duplicate (start.gg に問い合わせる前に弾く)', async () => {
  const e = env(gql(111, 111, []));
  assert.strictEqual((await post(e, body())).ok, true);
  e.nowMs = Date.now() + CLASS_RATE_MIN_INTERVAL_MS + 1;
  const n = e.fetches.length;
  assert.strictEqual((await post(e, body({ name: '別名' }))).error.code, 'duplicate');
  assert.strictEqual(e.fetches.length, n);
  assert.strictEqual(e.store.classes.length, 1);
});

test('class_register: 同じ TO の連続登録は rate_limited、間隔を空ければ通る', async () => {
  const e = env(gql(111, 111, []));
  const t = Date.parse('2026-09-30T03:00:00Z');
  e.nowMs = t;
  assert.strictEqual((await post(e, body())).ok, true);
  e.nowMs = t + 1000;
  assert.strictEqual((await post(e, body({ challonge: { id: 2, url: 'https://challonge.com/b2' } }))).error.code, 'rate_limited');
  e.nowMs = t + CLASS_RATE_MIN_INTERVAL_MS + 1;
  assert.strictEqual((await post(e, body({ challonge: { id: 2, url: 'https://challonge.com/b2' } }))).ok, true);
});

test('parseClassRegister: 許す形と弾く形', () => {
  assert.ok('input' in parseClassRegister(body()));
  assert.ok('input' in parseClassRegister(body({ place_max: 16, parent_event_id: '1234567', challonge: { id: '5', url: 'https://challonge.com/x' } })));
  assert.ok('input' in parseClassRegister(body({ place_max: 9 })), 'place_max = place_min は可');
  const bads = {
    startgg_token: [undefined, '', 'a b', 'x'.repeat(201)],
    parent_event_id: [0, -1, 'abc', 1.5, null],
    class_letter: ['A', 'F', 'b', null],
    name: ['', '   ', 'x'.repeat(201), 5],
    challonge: [null, 'x', { id: 0, url: 'https://challonge.com/x' }, { id: 1, url: 'http://challonge.com/x' },
      { id: 1, url: 'https://evil.example/https://challonge.com/' }, { id: 1, url: 'https://challonge.com/' }, { id: 1, url: 'https://challonge.com/a b' }],
    format: ['swiss', null],
    counted: ['true', 1, null],
    place_min: [0, null, 'x'],
    place_max: [8, 0, 'x'],
    seeding: ['elo', null],
    entrant_count: [0, null, 100000],
  };
  for (const [k, vals] of Object.entries(bads)) {
    for (const v of vals) assert.ok('bad' in parseClassRegister(body({ [k]: v })), k + '=' + JSON.stringify(v));
  }
});

test('class_waitlist: counted でないもの・done のものは出ない。GET /api/class_waitlist でも同じ', async () => {
  const e = env(gql(111, 111, []));
  let t = Date.parse('2026-09-30T03:00:00Z');
  for (const [i, counted] of [[1, true], [2, false], [3, true]]) {
    e.nowMs = t; t += CLASS_RATE_MIN_INTERVAL_MS + 1;
    assert.strictEqual((await post(e, body({ counted, challonge: { id: i, url: 'https://challonge.com/c' + i } }))).ok, true);
  }
  assert.deepStrictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 1 })), { ok: true, id: 1, status: 'done' });
  const g = await http(e, 'GET', '/api/class_waitlist');
  assert.strictEqual(g.headers.get('Cache-Control'), 'no-store');
  assert.deepStrictEqual(g.json.items.map((x) => x.challonge_id), [3]);
  assert.deepStrictEqual(Object.keys(g.json.items[0]).sort(),
    ['challonge_id', 'challonge_url', 'class_letter', 'created_at', 'id', 'name', 'parent_event_id', 'parent_tournament_id']);
});

test('class_done: 鍵違いは auth_failed、id 不正は bad_request、無い id は not_found、鍵が未設定なら internal', async () => {
  const e = env(gql(111, 111, []));
  await post(e, body());
  assert.strictEqual((await post(e, { action: 'class_done', key: 'wrong', id: 1 })).error.code, 'auth_failed');
  assert.strictEqual((await post(e, { action: 'class_done', id: 1 })).error.code, 'auth_failed');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 'x' })).error.code, 'bad_request');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 99 })).error.code, 'not_found');
  assert.strictEqual(e.store.classes[0].status, 'waiting');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: '1' })).ok, true);
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 1 })).ok, true, 'もう done でも ok');
  const noKey = makeEnv({ user: gql(111, 111, []) });
  assert.strictEqual((await post(noKey, { action: 'class_done', key: '', id: 1 })).error.code, 'internal');
});
