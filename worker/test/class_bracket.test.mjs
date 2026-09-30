// 下位クラス: Challonge OAuth (challonge_begin / challonge_token)・作成 (class_create)・取得待ちの一覧 (class_waitlist)・
// 取得済み (class_done)。docs/class_bracket_design.md
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http, beginState } from './_env.mjs';
import { parseClassCreate, challongeSlug } from '../src/api/class_bracket.ts';
import { challongeErrorText } from '../src/api/challonge.ts';
import { signState } from '../src/api/session.ts';
import { CLASS_RATE_MIN_INTERVAL_MS, CHALLONGE_SCOPE } from '../src/config.ts';

const SG_KEY = 'startgg-key-DO-NOT-LEAK-123';
const CH_TOKEN = 'challonge-token-DO-NOT-LEAK-456';
const CH_SECRET = 'challonge-client-secret-DO-NOT-LEAK';
const DONE_KEY = 'class-done-key-xyz';

const resp = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gqlOk = (userId, owner, admins) => resp(200, { data: { currentUser: { id: userId }, event: { id: 1234567, tournament: { id: 777, owner: { id: owner }, admins } } } });
const createdOk = (id = '98765', url = 'https://challonge.com/spsp_1234567_b_abc123') => resp(200, { data: { id, type: 'tournament', attributes: { full_challonge_url: url, url: 'spsp_1234567_b_abc123' } } });

/** fetch を差し替える。h = { gql, token, create, bulk } (() => Response | 例外を投げる関数)。呼ばれた順に calls に残す */
function env(h, o) {
  const e = makeEnv(Object.assign({ cfg: { classDoneKey: DONE_KEY, challongeClientId: 'ch-client', challongeClientSecret: CH_SECRET,
    challongeRedirectUri: 'https://spsp-web-preview.tosakazu.workers.dev/callback.html' } }, o || {}));
  e.calls = [];
  e.ctx.fetch = async (url, init) => {
    const kind = url.includes('api.start.gg/gql') ? 'gql' : url.includes('challonge.com/oauth/token') ? 'token'
      : url.endsWith('/v2.1/tournaments.json') ? 'create' : url.includes('/participants/bulk_add.json') ? 'bulk' : 'other';
    e.calls.push({ kind, url, init });
    const f = h[kind];
    if (!f) throw new Error('unexpected fetch ' + url);
    return f(init);
  };
  return e;
}
const okHandlers = () => ({ gql: () => gqlOk(111, 999, [{ id: 111 }]), create: () => createdOk(), bulk: () => resp(200, { data: [] }) });
const participants = (n) => Array.from({ length: n }, (_, i) => ({ name: 'P' + (i + 1) + ' (disc' + i + ')', seed: i + 1, misc: 'startgg:' + (1000 + i) }));
const body = (o) => Object.assign({
  action: 'class_create', startgg_token: SG_KEY, challonge_token: CH_TOKEN, parent_event_id: 1234567, class_letter: 'B',
  name: '篝火#15 Bクラス', format: 'single', counted: true, place_min: 9, place_max: null, seeding: 'main_result',
  participants: participants(4),
}, o || {});
const leaked = (e) => { const s = JSON.stringify(e.store); return s.includes(SG_KEY) || s.includes(CH_TOKEN) || s.includes(CH_SECRET); };

test('challonge_begin: Challonge の認可 URL (client_id・scope・戻り先・state は Worker が決める)', async () => {
  const e = env({});
  const r = await post(e, { action: 'challonge_begin', nonce: 'N1', returnPath: '/jp/class/' });
  assert.strictEqual(r.ok, true);
  const u = new URL(r.url);
  assert.strictEqual(u.origin + u.pathname, 'https://api.challonge.com/oauth/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'ch-client');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://spsp-web-preview.tosakazu.workers.dev/callback.html');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('scope'), CHALLONGE_SCOPE);
  assert.ok(CHALLONGE_SCOPE.split(' ').includes('application:organizer'));
  const st = JSON.parse(Buffer.from(u.searchParams.get('state').split('.')[0], 'base64url').toString());
  assert.strictEqual(st.f, 'challonge');
  assert.strictEqual(st.r, '/jp/class/');
  assert.ok(!r.url.includes(CH_SECRET));
  assert.strictEqual((await post(env({}), { action: 'challonge_begin', nonce: 'x'.repeat(129) })).error.code, 'bad_request');
  assert.strictEqual((await post(makeEnv({}), { action: 'challonge_begin', nonce: 'N' })).error.code, 'internal', 'client_id 未設定');
});

test('challonge_token: code を換えて access_token を返す (form・Accept つき)。保存も記録もしない', async () => {
  const e = env({ token: () => resp(200, { access_token: CH_TOKEN, token_type: 'Bearer', expires_in: 604800, scope: CHALLONGE_SCOPE }) });
  const begin = await post(e, { action: 'challonge_begin', nonce: 'N', returnPath: '/jp/class/' });
  const state = new URL(begin.url).searchParams.get('state');
  const r = await post(e, { action: 'challonge_token', code: 'CODE-1', state });
  assert.deepStrictEqual(r, { ok: true, access_token: CH_TOKEN, expires_in: 604800 });
  const c = e.calls[0];
  assert.strictEqual(c.url, 'https://api.challonge.com/oauth/token');
  assert.strictEqual(c.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.strictEqual(c.init.headers.Accept, 'application/json');
  const form = new URLSearchParams(c.init.body);
  assert.deepStrictEqual(Object.fromEntries(form), { grant_type: 'authorization_code', code: 'CODE-1', client_id: 'ch-client',
    client_secret: CH_SECRET, redirect_uri: 'https://spsp-web-preview.tosakazu.workers.dev/callback.html' });
  assert.strictEqual(leaked(e), false);
  // 同じ state は 2 回使えない
  assert.strictEqual((await post(e, { action: 'challonge_token', code: 'CODE-2', state })).error.code, 'state_invalid');
  assert.strictEqual(e.store.errors.at(-1).note, 'reused');
});

test('challonge_token: start.gg ログイン用の state は通らない / その逆も通らない', async () => {
  const e = env({ token: () => resp(200, { access_token: CH_TOKEN, expires_in: 1 }) });
  const loginState = await beginState(e);
  const r = await post(e, { action: 'challonge_token', code: 'C', state: loginState });
  assert.strictEqual(r.error.code, 'state_invalid');
  assert.strictEqual(e.store.errors.at(-1).note, 'wrong_flow');
  assert.strictEqual(e.calls.length, 0, 'Challonge に問い合わせない');
  const chState = await signState(e.cfg, 'N', '/jp/class/', 'challonge', Date.now());
  const l = await post(e, { action: 'login', code: 'C', state: chState });
  assert.strictEqual(l.error.code, 'state_invalid');
  assert.strictEqual(e.store.errors.at(-1).note, 'wrong_flow');
});

test('challonge_token: 期限切れ・使用済みの code は challonge_auth、Challonge の不調は challonge_error', async () => {
  for (const [h, code, note] of [
    [() => resp(400, { error: 'invalid_grant' }), 'challonge_auth', 'http_400'],
    [() => resp(401, {}), 'challonge_auth', 'http_401'],
    [() => resp(520, 'x'), 'challonge_error', 'http_520'],
    [() => resp(200, 'not json'), 'challonge_error', 'bad_json'],
    [() => resp(200, { token_type: 'Bearer' }), 'challonge_error', 'no_token'],
    [() => { const x = new Error('t'); x.name = 'TimeoutError'; throw x; }, 'challonge_error', 'timeout'],
  ]) {
    const e = env({ token: h });
    const state = await signState(e.cfg, 'N', '/jp/class/', 'challonge', Date.now());
    const r = await post(e, { action: 'challonge_token', code: 'C', state });
    assert.strictEqual(r.error.code, code, note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
  }
});

test('class_create: start.gg で確認 → Challonge に作成 → 参加者を一括追加 → D1 に登録。トークンはどこにも残らない', async () => {
  const e = env(okHandlers());
  const r = await post(e, body());
  assert.deepStrictEqual(r, { ok: true, id: 1, challonge: { id: 98765, url: 'https://challonge.com/spsp_1234567_b_abc123' } });
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql', 'create', 'bulk']);
  const [g, c, b] = e.calls;
  assert.strictEqual(g.init.headers.Authorization, 'Bearer ' + SG_KEY);
  for (const x of [c, b]) {
    assert.strictEqual(x.init.headers.Authorization, 'Bearer ' + CH_TOKEN);
    assert.strictEqual(x.init.headers['Authorization-Type'], 'v2');
    assert.strictEqual(x.init.headers['Content-Type'], 'application/vnd.api+json');
    assert.strictEqual(x.init.headers.Accept, 'application/json');
    assert.ok(!String(x.init.body).includes(CH_TOKEN) && !String(x.init.body).includes(SG_KEY));
    assert.ok(x.init.signal);
  }
  const cb = JSON.parse(c.init.body);
  assert.strictEqual(cb.data.type, 'tournaments');
  const a = cb.data.attributes;
  assert.strictEqual(a.name, '篝火#15 Bクラス');
  assert.match(a.url, /^spsp_1234567_b_[a-z0-9]{6}$/);
  assert.strictEqual(a.tournament_type, 'single elimination');
  assert.strictEqual(a.game_name, 'Super Smash Bros. Ultimate');
  assert.strictEqual(a.private, false);
  assert.strictEqual(b.url, 'https://api.challonge.com/v2.1/tournaments/98765/participants/bulk_add.json');
  const bb = JSON.parse(b.init.body);
  assert.strictEqual(bb.data.type, 'Participants');
  assert.deepStrictEqual(bb.data.attributes.participants, participants(4));
  const row = e.store.classes[0];
  assert.strictEqual(row.challonge_id, 98765);
  assert.strictEqual(row.challonge_url, 'https://challonge.com/spsp_1234567_b_abc123');
  assert.strictEqual(row.entrant_count, 4);
  assert.strictEqual(row.parent_tournament_id, 777);
  assert.strictEqual(row.registered_by, '111');
  assert.strictEqual(leaked(e), false);
  const w = await post(e, { action: 'class_waitlist' });
  assert.deepStrictEqual(w.items.map((x) => [x.id, x.challonge_id, x.challonge_url]), [[1, 98765, 'https://challonge.com/spsp_1234567_b_abc123']]);
});

test('class_create: ダブルエリミは double elimination', async () => {
  const e = env(okHandlers());
  await post(e, body({ format: 'double' }));
  assert.strictEqual(JSON.parse(e.calls[1].init.body).data.attributes.tournament_type, 'double elimination');
});

test('class_create: 管理者でなければ not_admin で、Challonge には何も作らない', async () => {
  const e = env({ ...okHandlers(), gql: () => gqlOk(111, 999, [{ id: 222 }]) });
  const r = await post(e, body());
  assert.strictEqual(r.error.code, 'not_admin');
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql']);
  assert.strictEqual(e.store.classes.length, 0);
  assert.strictEqual(e.store.errors.at(-1).note, 'not_admin');
  assert.strictEqual(leaked(e), false);
});

test('class_create: start.gg の失敗は startgg_error / イベントが無ければ bad_request', async () => {
  for (const [gql, code, note] of [
    [() => resp(401, {}), 'startgg_error', 'http_401'],
    [() => resp(200, { data: { currentUser: null }, errors: [{ message: 'x' }] }), 'startgg_error', 'gql_error'],
    [() => { const x = new Error('t'); x.name = 'TimeoutError'; throw x; }, 'startgg_error', 'timeout'],
    [() => resp(200, { data: { currentUser: { id: 1 }, event: null } }), 'bad_request', 'event_not_found'],
  ]) {
    const e = env({ ...okHandlers(), gql });
    const r = await post(e, body());
    assert.strictEqual(r.error.code, code, note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
    assert.strictEqual(e.calls.filter((c) => c.kind !== 'gql').length, 0);
  }
});

test('class_create: Challonge のトークン無効は challonge_auth、作成の失敗は challonge_error (Challonge の文言を出す)', async () => {
  let e = env({ ...okHandlers(), create: () => resp(401, { errors: [{ detail: 'unauthorized' }] }) });
  let r = await post(e, body());
  assert.strictEqual(r.error.code, 'challonge_auth');
  assert.strictEqual(e.store.errors.at(-1).note, 'create:http_401');
  e = env({ ...okHandlers(), create: () => resp(422, { errors: [{ status: 422, detail: 'URL has already been taken' }, { detail: 'Name is too long' }] }) });
  r = await post(e, body());
  assert.strictEqual(r.error.code, 'challonge_error');
  assert.strictEqual(r.error.message, 'URL has already been taken / Name is too long');
  assert.strictEqual(r.challonge, undefined, 'できていないので URL は無い');
  e = env({ ...okHandlers(), create: () => resp(200, { data: { id: 'x' } }) });
  r = await post(e, body());
  assert.strictEqual(r.error.code, 'challonge_error');
  assert.strictEqual(e.store.classes.length, 0);
});

test('class_create: 作れたが参加者の追加で失敗したら、トーナメントの URL を添えて返す (D1 には登録しない)', async () => {
  const e = env({ ...okHandlers(), bulk: () => resp(422, { errors: [{ detail: 'Seed is invalid' }] }) });
  const r = await post(e, body());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'challonge_error');
  assert.match(r.error.message, /参加者を入れられませんでした: Seed is invalid/);
  assert.deepStrictEqual(r.challonge, { id: 98765, url: 'https://challonge.com/spsp_1234567_b_abc123' });
  assert.strictEqual(e.store.classes.length, 0);
  assert.strictEqual(e.store.errors.at(-1).note, 'bulk_add:http_422');
});

test('class_create: 同じ TO の連続作成は Challonge に作る前に rate_limited', async () => {
  let id = 500;
  const e = env({ ...okHandlers(), create: () => createdOk(String(++id), 'https://challonge.com/t' + id) });
  const t = Date.parse('2026-10-01T03:00:00Z');
  e.nowMs = t;
  assert.strictEqual((await post(e, body())).ok, true);
  e.nowMs = t + 1000;
  e.calls.length = 0;
  assert.strictEqual((await post(e, body())).error.code, 'rate_limited');
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql'], 'Challonge には作らない');
  e.nowMs = t + CLASS_RATE_MIN_INTERVAL_MS + 1;
  assert.deepStrictEqual(await post(e, body()), { ok: true, id: 2, challonge: { id: 502, url: 'https://challonge.com/t502' } });
});

test('parseClassCreate: 許す形と弾く形', () => {
  assert.ok('input' in parseClassCreate(body()));
  assert.ok('input' in parseClassCreate(body({ place_max: 16, parent_event_id: '1234567', participants: participants(512) })));
  const dupSeed = participants(3); dupSeed[2].seed = 1;
  const dupMisc = participants(3); dupMisc[2].misc = dupMisc[0].misc;
  const bads = {
    startgg_token: [undefined, '', 'a b', 'x'.repeat(201)],
    challonge_token: [undefined, '', 'a b', 'x'.repeat(4097)],
    parent_event_id: [0, -1, 'abc', 1.5, null],
    class_letter: ['A', 'F', 'b', null],
    name: ['', '   ', 'x'.repeat(201), 5],
    format: ['swiss', null],
    counted: ['true', 1, null],
    place_min: [0, null, 'x'],
    place_max: [8, 0, 'x'],
    seeding: ['elo', null],
    participants: [undefined, [], participants(1), participants(513), [null, ...participants(2)],
      [{ name: '', seed: 1, misc: 'startgg:1' }, ...participants(2).map((p, i) => ({ ...p, seed: i + 2 }))],
      [{ name: 'a', seed: 0, misc: 'startgg:9' }, ...participants(2)],
      [{ name: 'a', seed: 3, misc: 'challonge:9' }, ...participants(2)],
      [{ name: 'a', seed: 3, misc: 'startgg:' }, ...participants(2)],
      dupSeed, dupMisc],
  };
  for (const [k, vals] of Object.entries(bads)) {
    for (const v of vals) assert.ok('bad' in parseClassCreate(body({ [k]: v })), k + '=' + String(JSON.stringify(v)).slice(0, 80));
  }
});

test('challongeSlug / challongeErrorText', () => {
  assert.match(challongeSlug(1234567, 'C'), /^spsp_1234567_c_[a-z0-9]{6}$/);
  assert.notStrictEqual(challongeSlug(1, 'B'), challongeSlug(1, 'B'));
  assert.strictEqual(challongeErrorText({ errors: [{ detail: 'a' }, { title: 'b' }, 'c'] }), 'a / b / c');
  assert.strictEqual(challongeErrorText({ errors: { url: ['is taken'] } }), 'url: is taken');
  assert.strictEqual(challongeErrorText({}), '');
  assert.strictEqual(challongeErrorText({ errors: [{ detail: 'x'.repeat(400) }] }).length, 300);
});

test('class_waitlist: counted でないもの・done のものは出ない。GET /api/class_waitlist でも同じ', async () => {
  let id = 100;
  const e = env({ ...okHandlers(), create: () => createdOk(String(++id), 'https://challonge.com/t' + id) });
  let t = Date.parse('2026-10-01T03:00:00Z');
  for (const counted of [true, false, true]) {
    e.nowMs = t; t += CLASS_RATE_MIN_INTERVAL_MS + 1;
    assert.strictEqual((await post(e, body({ counted }))).ok, true);
  }
  assert.deepStrictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 1 })), { ok: true, id: 1, status: 'done' });
  const g = await http(e, 'GET', '/api/class_waitlist');
  assert.strictEqual(g.headers.get('Cache-Control'), 'no-store');
  assert.deepStrictEqual(g.json.items.map((x) => x.challonge_id), [103]);
  assert.deepStrictEqual(Object.keys(g.json.items[0]).sort(),
    ['challonge_id', 'challonge_url', 'class_letter', 'created_at', 'id', 'name', 'parent_event_id', 'parent_tournament_id']);
});

test('class_done: 鍵違いは auth_failed、id 不正は bad_request、無い id は not_found、鍵が未設定なら internal', async () => {
  const e = env(okHandlers());
  await post(e, body());
  assert.strictEqual((await post(e, { action: 'class_done', key: 'wrong', id: 1 })).error.code, 'auth_failed');
  assert.strictEqual((await post(e, { action: 'class_done', id: 1 })).error.code, 'auth_failed');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 'x' })).error.code, 'bad_request');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 99 })).error.code, 'not_found');
  assert.strictEqual(e.store.classes[0].status, 'waiting');
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: '1' })).ok, true);
  assert.strictEqual((await post(e, { action: 'class_done', key: DONE_KEY, id: 1 })).ok, true, 'もう done でも ok');
  assert.strictEqual((await post(makeEnv({}), { action: 'class_done', key: '', id: 1 })).error.code, 'internal');
});

test('class_register は廃止 (class_create に置き換え)', async () => {
  assert.strictEqual((await post(env({}), { action: 'class_register' })).error.code, 'bad_request');
});
