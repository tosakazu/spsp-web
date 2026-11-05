// トーナメントプレビューの短い URL (src/api/bracket_share.ts) のテスト (2026-11-05)
import test from 'node:test';
import assert from 'node:assert';
import { handleBracketShareCreate, handleBracketShareGet, SHARE_BURST_MAX, SHARE_BURST_WINDOW_MS, SHARE_MAX_PER_USER } from '../src/api/bracket_share.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { MemStore } from './_mem_store.mjs';

const DAY = 86400000;
const cfg = { clientId: 'c', redirectUri: 'https://x/cb', clientSecret: 'CS', sessionSecret: 'sess-share', sessionTtlMs: SESSION_TTL_MS_DEFAULT, stateTtlMs: STATE_TTL_MS_DEFAULT, tsOffsetMin: 540 };
const body = (r) => JSON.parse(JSON.stringify(r.body));
const frag = 'v=1&ph=0&wd=1&d=abcDEF_-123';
const sgg = { v: 1, fetched_at: 1, phases: [{ id: '1', groups: [], seeds: [], templates: {} }] };

test('ログイン必須・作った人を残す・start.gg の構造も入れて返す・保存期間・形式', async () => {
  const store = new MemStore();
  assert.strictEqual(body(await handleBracketShareCreate(cfg, store, { frag }, 1000)).error.code, 'auth_failed', 'ログインしていなければ作れない');
  const token = await issueSessionToken(cfg, { id: '42', slug: 'user/x', gamerTag: 'TO' }, 1000);
  const c = body(await handleBracketShareCreate(cfg, store, { token, frag, days: 7, sgg }, 1000));
  assert.strictEqual(c.ok, true);
  assert.match(c.id, /^[A-Za-z2-9]{8}$/);
  assert.strictEqual(c.expires_ms, 1000 + 7 * DAY);
  const row = store.shares.get(c.id);
  assert.deepStrictEqual([row.user_id, row.user_name], ['42', 'TO'], '誰が作ったか');
  const g = body(await handleBracketShareGet(store, { id: c.id }, 1000 + 6 * DAY));
  assert.deepStrictEqual([g.frag, g.sgg], [frag, sgg], 'ログインなしで開けて、構造も返る');
  assert.strictEqual(body(await handleBracketShareGet(store, { id: c.id }, 1000 + 8 * DAY)).error.code, 'not_found');
  assert.strictEqual(body(await handleBracketShareCreate(cfg, store, { token, frag, days: 99 }, 2000)).expires_ms, 2000 + 3 * DAY, '既定 3 日');
  for (const bad of ['', 'x=1', 'v=1&ph=0', 'v=1&d=a<b', 'v=1&d=' + 'a'.repeat(130000)]) {
    assert.strictEqual(body(await handleBracketShareCreate(cfg, store, { token, frag: bad }, 3000)).error.code, 'bad_request', bad.slice(0, 20));
  }
  assert.strictEqual(body(await handleBracketShareCreate(cfg, store, { token, frag, sgg: { v: 2 } }, 3000)).error.code, 'bad_request', '構造の形');
});

test('短い時間に作れる数と、1 人が持てる数 (古いものから消える)', async () => {
  const store = new MemStore();
  const token = await issueSessionToken(cfg, { id: '7', slug: 'user/y', gamerTag: 'Y' }, 0);
  let now = 0;
  const ids = [];
  for (let i = 0; i < SHARE_BURST_MAX; i++) { now += 1000; ids.push(body(await handleBracketShareCreate(cfg, store, { token, frag }, now)).id); }
  now += 1000;
  assert.strictEqual(body(await handleBracketShareCreate(cfg, store, { token, frag }, now)).error.code, 'rate_limited', '10 分に 10 個まで');
  // 時間をおけば作れる。1 人 30 個まで: 31 個目で最初のものが消える
  now += SHARE_BURST_WINDOW_MS;
  while (ids.length < SHARE_MAX_PER_USER + 1) {
    now += SHARE_BURST_WINDOW_MS / SHARE_BURST_MAX + 1;
    const r = body(await handleBracketShareCreate(cfg, store, { token, frag }, now));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    ids.push(r.id);
  }
  const mine = [...store.shares.values()].filter((x) => x.user_id === '7');
  assert.strictEqual(mine.length, SHARE_MAX_PER_USER);
  assert.ok(!store.shares.has(ids[0]), 'いちばん古いものが消えた');
  assert.ok(store.shares.has(ids[ids.length - 1]));
});
