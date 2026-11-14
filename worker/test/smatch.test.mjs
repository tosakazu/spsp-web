// スマッチとの連携 (api/smatch.ts): 一覧の確認・取り込み (失敗したら前の値のまま)・表示の形 (見せない最高レートは出さない)・受け渡しのトークン・プロフィールの設定
import test from 'node:test';
import assert from 'node:assert';
import { MemStore } from './_mem_store.mjs';
import {
  parseSmatchPayload, runSmatchImport, smatchViewOf, smatchImportDue, exportTokenOk, handleSmatchExport, handleSmatchStatus,
  handleProfileGet, handleProfilePut, validateProfile, validUrlTemplate, SMATCH_IMPORT, SMATCH_EXPORT, SMATCH_STALE_MS,
} from '../src/api/smatch.ts';
import { handleCardGet } from '../src/api/card.ts';

const NOON = Date.UTC(2026, 10, 15, 3, 0, 0);   // 日本時間 12:00
const cfg = (o) => ({ tsOffsetMin: 540, smatchImportUrl: 'https://smatch-jp.com/api/partner/spsp/players', smatchImportToken: 'IN-TOKEN', smatchExportTokens: ['OUT-1', 'OUT-2'], cardOpenEdit: true, titleLang: 'ja', ...(o || {}) });
const P = (d, id, extra) => ({ discriminator: d, smatch_id: id, name: 'n' + id, max_hidden: false,
  modes: { '1on1': { rate: 1650, rank: 120, season_max: 1700, max: 1720, games: 84 }, tokuoma: { rate: 1500, rank: 40, season_max: 1510, max: 1600, games: 12 } }, ...(extra || {}) });
const payload = (players) => ({ version: 1, generated_at: 1794700000, season: { id: 12, name: 'シーズン12' }, url_template: 'https://smatch-jp.com/user/{smatch_id}/', players });
const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const dataFetch = async (path) => path === '/data/discriminators.json' ? json(200, { 100: 'aaaaaaaa', 200: 'bbbbbbbb', 300: 'cccccccc' })
  : path === '/data/user_merges.json' ? json(200, { 300: 301 })
  : path === '/data/partner_smatch.json' ? json(200, { version: 1, players: [] }) : json(404, {});
const feed = (body, status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return json(status, body); }; f.calls = calls; return f; };

test('一覧の確認: 2 つのルール・見せない設定・1on1 だけの古い形。形が違えば全体を捨てる', () => {
  const ok = parseSmatchPayload(payload([P('AAAAAAAA', 1), P('bbbbbbbb', 2, { max_hidden: true, modes: { '1on1': { rate: null, rank: null, season_max: null, max: 1800 } } })]));
  assert.strictEqual(typeof ok, 'object');
  assert.strictEqual(ok.players[0].discriminator, 'aaaaaaaa');
  assert.deepStrictEqual(ok.players[1].modes, { '1on1': { rate: null, rank: null, season_max: null, max: 1800, games: null } });
  assert.deepStrictEqual(ok.season, { id: '12', name: 'シーズン12' });
  const old = parseSmatchPayload({ generated_at: 1794700000, players: [{ discriminator: 'aaaaaaaa', smatch_id: 1, name: 'x', rate: 1650, rank: 120, max_rate: 1720, max_hidden: false }] });
  assert.deepStrictEqual(old.players[0].modes, { '1on1': { rate: 1650, rank: 120, season_max: null, max: 1720, games: null } });
  assert.strictEqual(old.url_template, 'https://smatch-jp.com/user/{smatch_id}/');
  for (const bad of [null, [], {}, { ...payload([]), version: 2 }, { ...payload([]), generated_at: 'x' }, { ...payload([]), url_template: 'https://evil.example/{smatch_id}' },
    payload([P('zzz', 1)]), payload([P('aaaaaaaa', 1), P('aaaaaaaa', 2)]), payload([P('aaaaaaaa', 0)]), payload([P('aaaaaaaa', 1, { modes: { '1on1': { rate: 'high' } } })])]) {
    assert.strictEqual(typeof parseSmatchPayload(bad), 'string', JSON.stringify(bad).slice(0, 80));
  }
  assert.strictEqual(validUrlTemplate('https://smatch-jp.com/user/{smatch_id}/'), 'https://smatch-jp.com/user/{smatch_id}/');
  for (const u of ['http://smatch-jp.com/user/{smatch_id}/', 'https://smatch-jp.com.evil.example/{smatch_id}', 'https://smatch-jp.com/user/', 'https://smatch-jp.com/{smatch_id}/{x}', 'javascript:alert(1)']) assert.strictEqual(validUrlTemplate(u), null, u);
});

test('取り込み: uid を付けて入れる (統合済みは統合先)。変わっていない人は書かない。一覧から消えた人は表示をやめるが行は残す', async () => {
  const store = new MemStore();
  const f = feed(payload([P('aaaaaaaa', 1), P('bbbbbbbb', 2), P('cccccccc', 3), P('dddddddd', 4)]));
  assert.deepStrictEqual(await runSmatchImport(cfg(), store, f, dataFetch, NOON), { code: 'ok', n: 4 });
  assert.strictEqual(f.calls[0].init.headers.Authorization, 'Bearer IN-TOKEN');
  const rows = Object.fromEntries((await store.listSmatchPlayers()).map((r) => [r.discriminator, r]));
  assert.strictEqual(rows.aaaaaaaa.uid, 100);
  assert.strictEqual(rows.cccccccc.uid, 301, '統合済みは統合先の uid');
  assert.strictEqual(rows.dddddddd.uid, null, 'SPSP に居ない人も行は持つ');
  // 同じ一覧をもう一度 (20 時間たっていないので読まない)
  assert.strictEqual((await runSmatchImport(cfg(), store, f, dataFetch, NOON + 3600e3)).code, 'skip');
  // 翌日: b が消え、a のレートが変わる
  let writes = 0; const apply = store.applySmatchImport.bind(store);
  store.applySmatchImport = async (u, x, ts) => { writes = u.length; return apply(u, x, ts); };
  const f2 = feed(payload([P('aaaaaaaa', 1, { modes: { '1on1': { rate: 1700, rank: 90, season_max: 1700, max: 1720 } } }), P('cccccccc', 3), P('dddddddd', 4)]));
  assert.strictEqual((await runSmatchImport(cfg(), store, f2, dataFetch, NOON + 24 * 3600e3)).code, 'ok');
  assert.strictEqual(writes, 1, '変わった 1 人だけ書く');
  const after = Object.fromEntries((await store.listSmatchPlayers()).map((r) => [r.discriminator, r]));
  assert.strictEqual(after.bbbbbbbb.linked, 0);
  assert.ok(after.bbbbbbbb.data, '解除した人の行は消さない');
  assert.strictEqual(await store.getSmatchForUid('200'), null, '解除した人は表示に出ない');
  // シーズンごとの控え: 最初の取り込みは全員、翌日は変わった人だけ上書き。解除した人の行も残る
  const S = store.smatchSeasonStats;
  assert.deepStrictEqual([...S.keys()].sort(), ['12|aaaaaaaa', '12|bbbbbbbb', '12|cccccccc', '12|dddddddd']);
  assert.ok(S.get('12|aaaaaaaa').data.includes('1700'));
  // シーズンが変わったら、値が同じ人も含めて全員を新しいシーズンに入れる。前のシーズンの行はそのまま
  const f3 = feed({ ...payload([P('aaaaaaaa', 1, { modes: { '1on1': { rate: 1700, rank: 90, season_max: 1700, max: 1720 } } }), P('cccccccc', 3), P('dddddddd', 4)]), season: { id: 13, name: 'シーズン13' } });
  assert.strictEqual((await runSmatchImport(cfg(), store, f3, dataFetch, NOON + 48 * 3600e3)).code, 'ok');
  assert.deepStrictEqual([...S.keys()].filter((k) => k.startsWith('13|')).sort(), ['13|aaaaaaaa', '13|cccccccc', '13|dddddddd']);
  assert.strictEqual([...S.keys()].filter((k) => k.startsWith('12|')).length, 4);
  assert.deepStrictEqual([...store.smatchSeasons.keys()], ['12', '13']);
});

test('取り込みの失敗: 読めない・形が違う・人数が急に減った → 前の値のまま、失敗を数える。次に成功したら 0 に戻る', async () => {
  const store = new MemStore();
  const many = Array.from({ length: 30 }, (_, i) => P((0xa0000000 + i).toString(16), i + 1));
  await runSmatchImport(cfg(), store, feed(payload(many)), dataFetch, NOON);
  const day = 24 * 3600e3;
  for (const [f, code] of [[feed('oops', 500), 'http_500'], [feed('{not json'), 'bad_json'], [feed(payload([P('zzz', 1)])), 'bad_shape:players[0].discriminator'], [feed(payload(many.slice(0, 5))), 'shrunk:30->5'],
    [async () => { throw new Error('network down'); }, 'fetch:Error: network down']]) {
    const r = await runSmatchImport(cfg(), store, f, dataFetch, NOON + day, true);
    assert.strictEqual(r.code, code);
  }
  const s = await store.getPartnerSync(SMATCH_IMPORT);
  assert.strictEqual(s.fails, 5);
  assert.strictEqual(s.ok_ms, NOON, '成功した時刻は変わらない');
  assert.strictEqual((await store.listSmatchPlayers()).filter((r) => r.linked).length, 30, '前の値のまま');
  // discriminators.json が読めないときも取り込まない
  assert.strictEqual((await runSmatchImport(cfg(), store, feed(payload(many)), async () => json(503, {}), NOON + day, true)).code, 'discriminators_http_503');
  assert.strictEqual((await runSmatchImport(cfg(), store, feed(payload(many)), dataFetch, NOON + day, true)).code, 'ok');
  assert.strictEqual((await store.getPartnerSync(SMATCH_IMPORT)).fails, 0);
  // 設定が無ければ何もしない
  assert.strictEqual((await runSmatchImport(cfg({ smatchImportToken: undefined }), new MemStore(), feed(payload(many)), dataFetch, NOON)).code, 'skip');
});

test('読みに行く時刻: 日本時間 20 時〜翌 5 時は避ける。成功から 20 時間、失敗のあとは 30 分あける', () => {
  const at = (h) => Date.UTC(2026, 10, 15, h - 9, 0, 0);
  assert.strictEqual(smatchImportDue(null, at(12), 540), true);
  assert.strictEqual(smatchImportDue(null, at(21), 540), false);
  assert.strictEqual(smatchImportDue(null, at(4), 540), false);
  assert.strictEqual(smatchImportDue(null, at(5), 540), true);
  assert.strictEqual(smatchImportDue({ ok_ms: at(12) - 19 * 3600e3, try_ms: at(12) - 19 * 3600e3 }, at(12), 540), false);
  assert.strictEqual(smatchImportDue({ ok_ms: at(12) - 21 * 3600e3, try_ms: at(12) - 10 * 60e3 }, at(12), 540), false, '失敗の直後は待つ');
  assert.strictEqual(smatchImportDue({ ok_ms: at(12) - 21 * 3600e3, try_ms: at(12) - 31 * 60e3 }, at(12), 540), true);
});

test('表示: card_get に smatch が付く。最高レートを見せない人の最高は出さない (D1 にだけある)。本人が出さない設定・古い取り込みは null', async () => {
  const store = new MemStore();
  await runSmatchImport(cfg(), store, feed(payload([P('aaaaaaaa', 1), P('bbbbbbbb', 2, { max_hidden: true })])), dataFetch, NOON);
  const a = (await handleCardGet(cfg(), store, { uid: '100' }, NOON)).body;
  assert.deepStrictEqual(a.smatch, { url: 'https://smatch-jp.com/user/1/', name: 'n1', season: 'シーズン12', as_of: 1794700000,
    modes: { '1on1': { rate: 1650, rank: 120, season_max: 1700, max: 1720, games: 84 }, tokuoma: { rate: 1500, rank: 40, season_max: 1510, max: 1600, games: 12 } } });
  const b = (await handleCardGet(cfg(), store, { uid: '200' }, NOON)).body;
  assert.deepStrictEqual(b.smatch.modes['1on1'], { rate: 1650, rank: 120, season_max: null, max: null, games: 84 });
  // 今シーズンの対戦数が 0 のルールは出さない (どのルールも 0 なら smatch ごと null)
  assert.strictEqual(smatchViewOf({ data: JSON.stringify({ smatch_id: 1, name: 'x', max_hidden: false, modes: { '1on1': { rate: 1500, rank: null, season_max: null, max: 1720, games: 0 }, tokuoma: { rate: null, rank: null, season_max: null, max: 1600 } } }), meta: JSON.stringify({ generated_at: 1, season: null, url_template: 'https://smatch-jp.com/user/{smatch_id}/' }), ok_ms: NOON, profile: null }, NOON), null);
  assert.ok(!JSON.stringify(b).includes('1720'), '見せない最高レートは応答に無い');
  assert.ok((await store.listSmatchPlayers()).find((r) => r.discriminator === 'bbbbbbbb').data.includes('1720'), 'D1 には有る');
  assert.strictEqual((await handleCardGet(cfg(), store, { uid: '999' }, NOON)).body.smatch, null);
  // 連携を設定していない所 (北米など) は欄ごと無い
  assert.ok(!('smatch' in (await handleCardGet(cfg({ smatchImportUrl: undefined }), store, { uid: '100' }, NOON)).body));
  // 本人が出さない設定にした
  assert.strictEqual((await handleProfilePut(cfg(), store, { uid: '100', settings: { smatch: false } }, NOON)).body.ok, true);
  assert.strictEqual((await handleCardGet(cfg(), store, { uid: '100' }, NOON)).body.smatch, null);
  assert.deepStrictEqual((await handleProfileGet(cfg(), store, { uid: '100' }, NOON)).body, { ok: true, settings: { smatch: false }, smatch: { linked: true } });
  assert.deepStrictEqual((await handleProfileGet(cfg(), store, { uid: '999' }, NOON)).body, { ok: true, settings: { smatch: true }, smatch: { linked: false } });
  // 取り込みが 7 日止まったら出さない
  assert.strictEqual((await handleCardGet(cfg(), store, { uid: '200' }, NOON + SMATCH_STALE_MS + 1)).body.smatch, null);
  assert.strictEqual(smatchViewOf(null, NOON), null);
});

test('プロフィールの設定: 本人だけ (preview の誰でも編集を除く)。形の違う設定は弾く', async () => {
  const store = new MemStore();
  const closed = cfg({ cardOpenEdit: false, sessionSecret: 's' });
  assert.strictEqual((await handleProfilePut(closed, store, { uid: '100', settings: { smatch: false } }, NOON)).body.error.code, 'invalid_session');
  assert.strictEqual((await handleProfileGet(closed, store, { uid: '100' }, NOON)).body.error.code, 'invalid_session');
  assert.strictEqual((await handleProfilePut(cfg(), store, { uid: '100', settings: { smatch: 'no' } }, NOON)).body.error.code, 'bad_settings');
  assert.strictEqual(validateProfile({ other: 1 }), null);
  assert.deepStrictEqual(validateProfile({}), { smatch: true });
});

test('受け渡し (SPSP → スマッチ): Bearer トークン (新旧 2 本)。ビルドの一覧をそのまま返し、読みに来た時刻を残す', async () => {
  const store = new MemStore();
  assert.strictEqual(exportTokenOk(cfg(), 'Bearer OUT-1'), true);
  assert.strictEqual(exportTokenOk(cfg(), 'Bearer OUT-2'), true);
  for (const bad of [null, '', 'OUT-1', 'Bearer', 'Bearer nope', 'Basic OUT-1']) assert.strictEqual(exportTokenOk(cfg(), bad), false, String(bad));
  assert.strictEqual((await handleSmatchExport(cfg(), store, dataFetch, 'Bearer nope', NOON)).status, 401);
  assert.strictEqual((await handleSmatchExport(cfg({ smatchExportTokens: [] }), store, dataFetch, 'Bearer OUT-1', NOON)).status, 404);
  assert.strictEqual((await handleSmatchExport(cfg(), store, async () => json(404, {}), 'Bearer OUT-1', NOON)).status, 503);
  assert.strictEqual(await store.getPartnerSync(SMATCH_EXPORT), null, '失敗は時刻を残さない');
  const res = await handleSmatchExport(cfg(), store, dataFetch, 'Bearer OUT-1', NOON);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { version: 1, players: [] });
  assert.strictEqual((await store.getPartnerSync(SMATCH_EXPORT)).ok_ms, NOON);
  const st = (await handleSmatchStatus(cfg(), store, NOON + 3 * 3600e3)).body;
  assert.deepStrictEqual(st.export, { read_age_h: 3 });
  assert.deepStrictEqual(st.import, { ok_age_h: null, try_age_h: null, fails: 0, n: 0 });
  assert.strictEqual(st.ready, false, '一度も取り込めていない間は ready でない');
  assert.deepStrictEqual((await handleSmatchStatus(cfg({ smatchImportUrl: undefined, smatchExportTokens: [] }), store, NOON)).body, { ok: true, ready: false, import: null, export: null });
});
