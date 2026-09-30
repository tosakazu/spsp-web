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
      : url.endsWith('/v2.1/tournaments.json') ? 'create' : url.includes('/participants/bulk_add.json') ? 'bulk'
      : url.endsWith('/v2.1/me.json') ? 'me' : init && init.method === 'DELETE' ? 'delete' : 'other';
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
  const e = env({ token: () => resp(200, { access_token: CH_TOKEN, token_type: 'Bearer', expires_in: 604800, scope: CHALLONGE_SCOPE }),
    me: () => resp(200, { data: { id: '1', type: 'user', attributes: { username: 'tosakazu_to', email: 'x@example.com' } } }) });
  const begin = await post(e, { action: 'challonge_begin', nonce: 'N', returnPath: '/jp/class/' });
  const state = new URL(begin.url).searchParams.get('state');
  const r = await post(e, { action: 'challonge_token', code: 'CODE-1', state });
  assert.deepStrictEqual(r, { ok: true, access_token: CH_TOKEN, expires_in: 604800, username: 'tosakazu_to' });
  const me = e.calls.find((x) => x.kind === 'me');
  assert.strictEqual(me.init.method, 'GET');
  assert.strictEqual(me.init.headers.Authorization, 'Bearer ' + CH_TOKEN);
  assert.strictEqual(me.init.headers['Authorization-Type'], 'v2');
  assert.strictEqual(me.init.body, undefined);
  assert.ok(!JSON.stringify(e.store).includes('tosakazu_to'), 'username も保存しない');
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
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql', 'gql'], '大会の確認 + 管理している大会の一覧 1 ページ');
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
  for (const sd of ['random', 'main_result', 'main_spsp', 'spsp']) assert.ok('input' in parseClassCreate(body({ seeding: sd })), sd);
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

/** gql の問い合わせを種類で分ける: 大会の確認 (SpspClassAdmin) / 管理している大会の一覧 (SpspClassAdminTours、page ごと) */
function gqlRouter(eventRes, toursPage) {
  return (init) => {
    const b = JSON.parse(init.body);
    if (b.query.includes('SpspClassAdminTours')) return toursPage(b.variables.page, b.variables.perPage);
    return eventRes();
  };
}
const toursResp = (ids) => resp(200, { data: { currentUser: { tournaments: { nodes: ids.map((id) => ({ id })) } } } });
const others = (n, base) => Array.from({ length: n }, (_, i) => base + i);

test('class_create: admins が null でも、本人の管理している大会の一覧にあれば TO として通す', async () => {
  const e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), (page) => toursResp(page === 1 ? [5, 777, 9] : [])) });
  const r = await post(e, body());
  assert.strictEqual(r.ok, true);
  const g = e.calls.filter((c) => c.kind === 'gql');
  assert.strictEqual(g.length, 2);
  const q = JSON.parse(g[1].init.body);
  assert.deepStrictEqual(q.variables, { page: 1, perPage: 50 });
  assert.match(q.query, /tournamentView: "admin"/);
  assert.strictEqual(g[1].init.headers.Authorization, 'Bearer ' + SG_KEY);
  assert.strictEqual(e.store.classes[0].parent_tournament_id, 777);
});

test('class_create: 管理している大会の一覧は 50 件ずつ、見つかるまで・50 件未満のページまで・最大 4 ページ', async () => {
  // 2 ページ目で見つかる
  let e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), (page) => toursResp(page === 1 ? others(50, 1) : [777])) });
  assert.strictEqual((await post(e, body())).ok, true);
  assert.strictEqual(e.calls.filter((c) => c.kind === 'gql').length, 3);
  // 50 件未満のページで止める
  e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), (page) => toursResp(page === 1 ? others(50, 1) : others(10, 100))) });
  assert.strictEqual((await post(e, body())).error.code, 'not_admin');
  assert.strictEqual(e.calls.filter((c) => c.kind === 'gql').length, 3);
  // 毎ページ 50 件でも 4 ページで止める (5 ページ目に有っても見ない)
  e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), (page) => toursResp(page <= 4 ? others(50, page * 1000) : [777])) });
  assert.strictEqual((await post(e, body())).error.code, 'not_admin');
  assert.strictEqual(e.calls.filter((c) => c.kind === 'gql').length, 5);
  assert.deepStrictEqual(e.calls.filter((c) => c.kind !== 'gql'), [], 'Challonge には作らない');
  // 一覧が取れない (nodes 無し・エラー無し) → not_admin
  e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), () => resp(200, { data: { currentUser: { tournaments: null } } })) });
  assert.strictEqual((await post(e, body())).error.code, 'not_admin');
});

test('class_create: 管理している大会の一覧の取得に失敗したら startgg_error (not_admin にはしない)', async () => {
  for (const [page, note] of [
    [() => resp(500, {}), 'tours:http_500'],
    [() => resp(200, { data: null, errors: [{ message: 'x' }] }), 'tours:gql_error'],
    [() => { const x = new Error('t'); x.name = 'TimeoutError'; throw x; }, 'tours:timeout'],
  ]) {
    const e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 999, null), page) });
    const r = await post(e, body());
    assert.strictEqual(r.error.code, 'startgg_error', note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
    assert.strictEqual(JSON.stringify(e.store).includes(SG_KEY), false);
  }
});

test('class_create: owner / admins で通るときは一覧を問い合わせない', async () => {
  const e = env({ ...okHandlers(), gql: gqlRouter(() => gqlOk(111, 111, null), () => { throw new Error('should not be called'); }) });
  assert.strictEqual((await post(e, body())).ok, true);
  assert.strictEqual(e.calls.filter((c) => c.kind === 'gql').length, 1);
});

// ── class_mine / class_delete ──
/** gql を種類で分ける: 本人 (SpspCurrentUser) / 大会の確認 (SpspClassAdmin) / 管理している大会の一覧 (SpspClassAdminTours) */
function gqlBy(me, event, tours) {
  return (init) => {
    const q = JSON.parse(init.body).query;
    if (q.includes('SpspCurrentUser')) return me();
    if (q.includes('SpspClassAdminTours')) return tours ? tours() : toursResp([]);
    return event();
  };
}
const meResp = (id) => resp(200, { data: { currentUser: { id } } });

test('class_mine: 本人が作った直近 60 日・削除していないものを新しい順で', async () => {
  let id = 700;
  const e = env({ ...okHandlers(), create: () => createdOk(String(++id), 'https://challonge.com/m' + id),
    gql: gqlBy(() => meResp(111), () => gqlOk(111, 111, null)) });
  let t = Date.parse('2026-07-01T03:00:00Z');   // 1 件目は 92 日前 → 出ない
  for (const counted of [true, true, false]) {
    e.nowMs = t; t = Date.parse('2026-09-20T03:00:00Z') + (id - 700) * 60000;
    assert.strictEqual((await post(e, body({ counted }))).ok, true);
  }
  e.store.classes.push({ ...e.store.classes[1], id: 99, registered_by: '222', challonge_id: 9999 });   // 他人のもの
  e.nowMs = Date.parse('2026-10-01T03:00:00Z');
  const r = await post(e, { action: 'class_mine', startgg_token: SG_KEY });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((x) => x.id), [3, 2]);
  assert.deepStrictEqual(Object.keys(r.items[0]).sort(), ['challonge_id', 'challonge_url', 'class_letter', 'counted', 'created_at',
    'entrant_count', 'id', 'name', 'parent_event_id', 'parent_tournament_id', 'status'].sort());
  assert.strictEqual(r.items[0].counted, false);
  assert.strictEqual(r.items[1].counted, true);
  assert.strictEqual(r.items[0].status, 'waiting');
  assert.strictEqual(r.items[0].entrant_count, 4);
  // 連打は rate_limited、start.gg の失敗は startgg_error、キー無しは bad_request
  e.nowMs += 500;
  assert.strictEqual((await post(e, { action: 'class_mine', startgg_token: SG_KEY })).error.code, 'rate_limited');
  assert.strictEqual((await post(e, { action: 'class_mine' })).error.code, 'bad_request');
  const bad = env({ gql: () => resp(401, {}) });
  assert.strictEqual((await post(bad, { action: 'class_mine', startgg_token: SG_KEY })).error.code, 'startgg_error');
  assert.strictEqual(JSON.stringify(e.store).includes(SG_KEY), false);
});

/** 111 が作った 1 件 (id 1、challonge 98765) がある状態を作る。削除時の start.gg / Challonge の応答は h で決める */
async function created(h) {
  const e = env({ ...okHandlers(), gql: gqlBy(() => meResp(111), () => gqlOk(111, 111, null)) });
  e.nowMs = Date.parse('2026-10-01T03:00:00Z');
  assert.strictEqual((await post(e, body())).ok, true);
  e.calls.length = 0;
  e.nowMs += 60 * 1000;
  e.ctx.fetch = (() => {
    const base = e.ctx.fetch;
    return async (url, init) => base(url, init);
  })();
  Object.assign(e, { h });
  return e;
}
function setHandlers(e, h) {
  e.ctx.fetch = async (url, init) => {
    const kind = url.includes('api.start.gg/gql') ? 'gql' : init && init.method === 'DELETE' ? 'delete' : url.endsWith('/change_state.json') ? 'reset' : 'other';
    e.calls.push({ kind, url, init });
    const fn = h[kind];
    if (!fn) throw new Error('unexpected fetch ' + url);
    return fn(init);
  };
}
const delBody = (o) => Object.assign({ action: 'class_delete', startgg_token: SG_KEY, challonge_token: CH_TOKEN, id: 1 }, o || {});

test('class_delete: 作った本人なら Challonge を消して deleted に。取得待ちの一覧からも class_mine からも消える', async () => {
  const e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(111), () => { throw new Error('not needed'); }), delete: () => new Response(null, { status: 204 }) });
  assert.deepStrictEqual(await post(e, delBody()), { ok: true, id: 1 });
  const d = e.calls.find((c) => c.kind === 'delete');
  assert.strictEqual(d.url, 'https://api.challonge.com/v2.1/tournaments/98765.json');
  assert.strictEqual(d.init.headers.Authorization, 'Bearer ' + CH_TOKEN);
  assert.strictEqual(d.init.headers['Authorization-Type'], 'v2');
  assert.strictEqual(d.init.body, undefined);
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql', 'delete'], '本人なら大会の確認はしない');
  assert.strictEqual(e.store.classes[0].status, 'deleted');
  assert.match(e.store.classes[0].deleted_at, /\+09:00$/);
  assert.deepStrictEqual((await post(e, { action: 'class_waitlist' })).items, []);
  e.nowMs += 10000;
  assert.deepStrictEqual((await post(e, { action: 'class_mine', startgg_token: SG_KEY })).items, []);
  // もう一度消そうとすると not_found、取得側が done を送っても done にはならない (status:'deleted' を返す)
  e.nowMs += 10000;
  assert.strictEqual((await post(e, delBody())).error.code, 'not_found');
  assert.deepStrictEqual(await post(e, { action: 'class_done', key: DONE_KEY, id: 1 }), { ok: true, id: 1, status: 'deleted' });
  assert.strictEqual(e.store.classes[0].status, 'deleted');
  const s = JSON.stringify(e.store);
  assert.ok(!s.includes(SG_KEY) && !s.includes(CH_TOKEN));
});

test('class_delete: Challonge で 404 (もう無い) なら続けて deleted に', async () => {
  const e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => resp(404, { errors: [{ detail: 'not found' }] }) });
  assert.deepStrictEqual(await post(e, delBody()), { ok: true, id: 1 });
  assert.strictEqual(e.store.classes[0].status, 'deleted');
});

test('class_delete: Challonge 401 は challonge_auth、403 などは challonge_error で D1 はそのまま', async () => {
  for (const [st, code] of [[401, 'challonge_auth'], [403, 'challonge_error'], [500, 'challonge_error']]) {
    const e = await created();
    setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => resp(st, { errors: [{ detail: 'Forbidden' }] }) });
    const r = await post(e, delBody());
    assert.strictEqual(r.error.code, code, String(st));
    assert.strictEqual(e.store.classes[0].status, 'waiting');
    assert.strictEqual(e.store.errors.at(-1).note, 'delete:http_' + st);
    if (st === 403) assert.match(r.error.message, /Forbidden/);
  }
});

test('class_delete: 作った人でなくても本戦の大会の TO なら消せる / どちらでもなければ not_admin', async () => {
  let e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(333), () => gqlOk(333, 999, [{ id: 333 }])), delete: () => new Response(null, { status: 204 }) });
  assert.deepStrictEqual(await post(e, delBody()), { ok: true, id: 1 });
  e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(333), () => gqlOk(333, 999, null), () => toursResp([1, 2])), delete: () => { throw new Error('must not delete'); } });
  const r = await post(e, delBody());
  assert.strictEqual(r.error.code, 'not_admin');
  assert.strictEqual(e.store.classes[0].status, 'waiting');
});

test('class_delete: 取得済み (done) は already_imported で何も消さない', async () => {
  const e = await created();
  await post(e, { action: 'class_done', key: DONE_KEY, id: 1 });
  setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => { throw new Error('must not delete'); } });
  const r = await post(e, delBody());
  assert.strictEqual(r.error.code, 'already_imported');
  assert.strictEqual(e.store.classes[0].status, 'done');
});

test('class_delete: 入力不正は bad_request、無い id は not_found、start.gg の失敗は startgg_error、連打は rate_limited', async () => {
  const e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => new Response(null, { status: 204 }) });
  for (const b of [delBody({ id: 'x' }), delBody({ id: 0 }), delBody({ startgg_token: '' }), delBody({ challonge_token: 'a b' })]) {
    assert.strictEqual((await post(e, b)).error.code, 'bad_request');
  }
  assert.strictEqual((await post(e, delBody({ id: 42 }))).error.code, 'not_found');
  e.nowMs += 1000;
  assert.strictEqual((await post(e, delBody())).error.code, 'rate_limited');
  const e2 = await created();
  setHandlers(e2, { gql: () => resp(500, {}) });
  assert.strictEqual((await post(e2, delBody())).error.code, 'startgg_error');
  assert.strictEqual(e2.store.classes[0].status, 'waiting');
});

test('class_create: seeding は main_spsp も受け付けて保存する', async () => {
  const e = env(okHandlers());
  assert.strictEqual((await post(e, body({ seeding: 'main_spsp' }))).ok, true);
  assert.strictEqual(e.store.classes[0].seeding, 'main_spsp');
});

test('challonge_token: アカウント名は username → name → email の順。me が失敗しても ok で username は null', async () => {
  for (const [meH, want] of [
    [() => resp(200, { data: { attributes: { username: '', name: 'Name Only' } } }), 'Name Only'],
    [() => resp(200, { data: { attributes: { email: 'e@example.com' } } }), 'e@example.com'],
    [() => resp(200, { data: { attributes: {} } }), null],
    [() => resp(401, {}), null],
    [() => resp(500, 'x'), null],
    [() => { throw new Error('network'); }, null],
  ]) {
    const e = env({ token: () => resp(200, { access_token: CH_TOKEN, expires_in: 10 }), me: meH });
    const state = await signState(e.cfg, 'N', '/jp/class/', 'challonge', Date.now());
    const r = await post(e, { action: 'challonge_token', code: 'C', state });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.username, want);
    assert.strictEqual(r.access_token, CH_TOKEN);
  }
});

test('challonge_me: Worker 経由でアカウント名を返す。401 は challonge_auth、他は challonge_error で理由は note だけ', async () => {
  let e = env({ me: () => resp(200, { data: { id: '1', type: 'user', attributes: { username: 'to_name' } } }) });
  assert.deepStrictEqual(await post(e, { action: 'challonge_me', challonge_token: CH_TOKEN }), { ok: true, username: 'to_name' });
  const c = e.calls[0];
  assert.strictEqual(c.url, 'https://api.challonge.com/v2.1/me.json');
  assert.strictEqual(c.init.headers.Authorization, 'Bearer ' + CH_TOKEN);
  // data が配列・attributes の無い形でも読む
  e = env({ me: () => resp(200, { data: [{ attributes: { username: 'arr_name' } }] }) });
  assert.strictEqual((await post(e, { action: 'challonge_me', challonge_token: CH_TOKEN })).username, 'arr_name');
  e = env({ me: () => resp(200, { username: 'flat_name' }) });
  assert.strictEqual((await post(e, { action: 'challonge_me', challonge_token: CH_TOKEN })).username, 'flat_name');
  for (const [h, code, note] of [
    [() => resp(401, {}), 'challonge_auth', 'me:http_401'],
    [() => resp(403, { errors: [{ detail: 'scope' }] }), 'challonge_error', 'me:http_403'],
    [() => resp(200, { data: { attributes: { image_url: 'x', created_at: 'y' } } }), 'challonge_error', 'me:no_username:keys=image_url,created_at'],
  ]) {
    e = env({ me: h });
    const r = await post(e, { action: 'challonge_me', challonge_token: CH_TOKEN });
    assert.strictEqual(r.error.code, code, note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
    assert.ok(!JSON.stringify(e.store).includes(CH_TOKEN));
  }
  assert.strictEqual((await post(env({}), { action: 'challonge_me' })).error.code, 'bad_request');
});

test('start.gg の HTTP エラーは本文の message を note に添える (キーは消す)', async () => {
  const e = env({ ...okHandlers(), gql: () => resp(400, { success: false, message: 'Invalid token ' + SG_KEY + ' given' }) });
  const r = await post(e, body());
  assert.strictEqual(r.error.code, 'startgg_error');
  const note = e.store.errors.at(-1).note;
  assert.strictEqual(note, 'http_400:Invalid token  given');
  assert.ok(!JSON.stringify(e.store).includes(SG_KEY));
  const e2 = env({ ...okHandlers(), gql: () => resp(401, { message: 'Unauthorized' }) });
  assert.match((await post(e2, body())).error.message, /API キーが無効/);
});

test('class_delete: 終了済み・進行中で 422 なら状態をリセットしてから消し直す', async () => {
  const e = await created();
  let n = 0;
  setHandlers(e, {
    gql: gqlBy(() => meResp(111)),
    delete: () => (++n === 1 ? resp(422, { errors: [{ detail: 'Tournament x is currently complete. Please revert the tournament to \`pending\` before deleting' }] }) : new Response(null, { status: 204 })),
    reset: () => resp(200, { data: { attributes: { state: 'pending' } } }),
  });
  assert.deepStrictEqual(await post(e, delBody()), { ok: true, id: 1 });
  assert.deepStrictEqual(e.calls.map((c) => c.kind), ['gql', 'delete', 'reset', 'delete']);
  const r = e.calls.find((c) => c.kind === 'reset');
  assert.strictEqual(r.url, 'https://api.challonge.com/v2.1/tournaments/98765/change_state.json');
  assert.strictEqual(r.init.method, 'PUT');
  assert.deepStrictEqual(JSON.parse(r.init.body), { data: { type: 'TournamentState', attributes: { state: 'reset' } } });
  assert.strictEqual(r.init.headers.Authorization, 'Bearer ' + CH_TOKEN);
  assert.strictEqual(e.store.classes[0].status, 'deleted');
});

test('class_delete: リセットに失敗・リセット後も消せないなら challonge_error で D1 はそのまま', async () => {
  let e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => resp(422, { errors: [{ detail: 'complete' }] }), reset: () => resp(403, { errors: [{ detail: 'Forbidden' }] }) });
  let r = await post(e, delBody());
  assert.strictEqual(r.error.code, 'challonge_error');
  assert.strictEqual(e.store.errors.at(-1).note, 'reset:http_403');
  assert.strictEqual(e.store.classes[0].status, 'waiting');
  e = await created();
  setHandlers(e, { gql: gqlBy(() => meResp(111)), delete: () => resp(422, { errors: [{ detail: 'still complete' }] }), reset: () => resp(200, {}) });
  r = await post(e, delBody());
  assert.strictEqual(r.error.code, 'challonge_error');
  assert.match(r.error.message, /still complete/);
  assert.strictEqual(e.store.errors.at(-1).note, 'delete:http_422');
  assert.strictEqual(e.store.classes[0].status, 'waiting');
});
