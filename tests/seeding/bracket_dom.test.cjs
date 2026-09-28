'use strict';
// jsdom 実行時テスト: トーナメントプレビューページを実ソースのまま jsdom で起動し、
// 「URL 復号 → ブラケット描画 → プール/フェーズ切替で URL 更新 → 注記/ポップアップ」
// の中核契約を検証する。fetch はフィクスチャ (players/prefs/overseas) で差し替える。
// jsdom は /tmp/jsdom_inst に隔離インストール。NODE_PATH で解決。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const S = ((m) => m.default || m)(require('../../site/seeding/seed_share.js'));

const DIR = path.resolve(__dirname, '../../site');
const HTML = fs.readFileSync(path.join(DIR, 'bracket/index.html'), 'utf8');
const SRC = [
  'js/html.js',            // サイト共通 (escapeHtml)。ページも最初に読む
  'region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js',   // 文言辞書
  'js/player_data.js',     // 分割された選手 JSON の組み立て (players/ + players_current.json)
  'seeding/seed_optimizer.js',
  'seeding/seed_data.js',
  'seeding/seed_share.js',
  'bracket/bracket_core.js',
  'bracket/bracket_app.js',
].map((f) => require('../helpers/built.cjs').built(f));   // 共通モジュールは古典 script の形で

// ── フィクスチャ ──────────────────────────────────────────
// 16人 (uid 101..116)。gi=1,6,9,14 (シード2,7,10,15) がプール A2。
//   - uid 102 と 115 は同居住地 (東京都) → A2 の 1回戦で同地域バッジ
//   - uid 107 と 110 は 10日前に対戦 → A2 の 1回戦で直近対戦バッジ
//   - uid 116 は海外 (米国)
function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function buildFixtures() {
  const players = {};
  for (let i = 1; i <= 16; i++) {
    const uid = 100 + i;
    players[uid] = {
      user_id: uid, display: 'P' + i,
      ranks: { ensemble: i },
      country: uid === 116 ? 'United States' : 'Japan',
      country_ja: uid === 116 ? '米国' : '日本',
      tournaments: [{ event_id: 5001, date: isoDaysAgo(10), name: 'テスト大会', nent: 64, place: i, is_weekend: true }],
      recent_matches: [],
    };
  }
  players[107].recent_matches.push({
    opp_uid: 110, opp_display: 'P10', event_id: 5001, tournament_name: 'テスト大会',
    date: isoDaysAgo(10), won: true, round: 1, round_text: 'WR1', phase_name: 'B',
  });
  const prefs = { 102: '東京都', 115: '東京都', 107: '大阪府', 110: '京都府' };
  const overseas = { uids: [116] };
  // メイン使用キャラ (プレイヤーページと同じ character_index.main_by_char × char_emoji)
  const charIdx = { main_by_char: { 1766: [102, 115], 1323: [107] } };
  const charEmoji = { 1766: { name: 'スティーブ', emoji: '🧱' }, 1323: { name: 'ロボット', emoji: '🤖' } };
  return { players, prefs, overseas, charIdx, charEmoji };
}

function payload16() {
  const uids = [], names = {};
  for (let i = 1; i <= 16; i++) uids.push(100 + i);
  uids[3] = null; names['3'] = 'NoDB選手';   // シード4 は uid なし
  return {
    v: 1, ev: 'jsdomテスト大会', src: 'spsp',
    phases: [{ name: '予選', pools: 4, adv: 2 }, { name: '決勝', pools: 1, adv: 0 }],
    wv: [0, 0, 1, 1],
    uids, names,
  };
}

// opts.playerStatus(uid) → 'ok' (既定) | 'error' (5xx) | 'missing' (404)。
// state.playerHits に players/<uid>.json の取得回数が入る。
async function bootPage(fragment, opts) {
  opts = opts || {};
  const fx = buildFixtures();
  const state = { playerHits: [] };
  const dom = new JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'https://spsp.example/bracket/index.html' + fragment,
  });
  const win = dom.window;
  // jsdom に無い Web API を Node のグローバルから注入 (seed_share の圧縮に必要)
  for (const k of ['CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder']) {
    win[k] = globalThis[k];
  }
  win.fetch = async (url) => {
    const u = String(url);
    const j = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('player_prefectures.json')) return j(fx.prefs);
    if (u.includes('geo.json')) return j(require('./fixtures/geo_jp.json'));   // 地域まとめの定義
    if (u.includes('overseas.json')) return j(fx.overseas);
    if (u.includes('character_index.json')) return j(fx.charIdx);
    if (u.includes('char_emoji.json')) return j(fx.charEmoji);
    // 揮発部分 (順位) は players_current.json (列形式)。フィクスチャの ranks から作る
    if (u.includes('players_current.json')) {
      const rows = {};
      for (const [uid, p] of Object.entries(fx.players)) rows[uid] = [p.ranks.ensemble];
      return j({ eval_date: '2026-09-06', eval_ts: 0, columns: ['ranks.ensemble'], players: rows });
    }
    if (u.includes('history/')) return { ok: false, status: 404, json: async () => ({}) };
    const m = u.match(/players\/(\d+)\.json/);
    if (m) {
      const uid = Number(m[1]);
      state.playerHits.push(uid);
      const st = opts.playerStatus ? opts.playerStatus(uid, state) : 'ok';
      if (st === 'error') return { ok: false, status: 503, json: async () => ({}) };
      const p = (st === 'missing') ? null : fx.players[uid];
      return p ? j(p) : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const src of SRC) {
    win.eval(src);
    // bracket/ はルートの 1 段下。js/html.js は script の src から推定するが、eval では取れないので教える
    if (win.SPSP && !win.SPSP.root) { win.SPSP.root = win.SPSP.langRoot = '../'; }
  }
  // init は readyState=complete で即時実行される (非同期)。描画完了を待つ。
  await waitFor(win, () => win.document.querySelectorAll('#bp-bracket .bp-match').length > 0);
  return { dom, win, fx, state };
}

async function waitFor(win, cond, ms) {
  const deadline = Date.now() + (ms || 3000);
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor タイムアウト');
}

const skip = !JSDOM ? 'jsdom 未導入' : false;

test('URL 復号 → A2 プールのブラケットが描画される', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  assert.strictEqual(doc.getElementById('bp-event').textContent, 'jsdomテスト大会');
  // フェーズタブ 2 個 / プール選択 4 個 (A1 A2 B1 B2)
  assert.strictEqual(doc.querySelectorAll('.bp-tab').length, 2);
  const opts = [...doc.querySelectorAll('#bp-pool-select option')].map((o) => o.value);
  assert.deepStrictEqual(opts, ['A1', 'A2', 'B1', 'B2']);
  // A2 = グローバルシード 2,7,10,15 (スネーク)。ラウンドは 2 つ (4人)
  const seeds = [...doc.querySelectorAll('.bp-round:first-child .bp-seed')].map((e) => e.textContent);
  assert.deepStrictEqual(seeds.sort((a, b) => a - b), ['2', '7', '10', '15']);
  assert.strictEqual(doc.querySelectorAll('.bp-round').length, 2);
  // 接続線 (SVG) が描画されている
  assert.ok(doc.querySelectorAll('.bp-links path').length >= 1, '接続線が無い');
  // 勝者予測: 決勝はシード2 (P2) が勝ち上がり
  const lastRound = doc.querySelector('.bp-round:last-of-type');
  assert.ok(lastRound.querySelector('.bp-slot.bp-win .bp-name').textContent === 'P2');
  // 名前は players/<uid>.json の display から
  assert.ok([...doc.querySelectorAll('.bp-name')].some((e) => e.textContent === 'P7'));
});

test('注記: 同居住地バッジと直近対戦バッジが付く', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  // uid 102 vs 115 (シード2 vs 15) = 同: 東京都
  const region = [...doc.querySelectorAll('.bp-flag-region')].map((e) => e.textContent);
  assert.ok(region.some((t) => t.includes('東京都')), '同居住地バッジが無い: ' + JSON.stringify(region));
  // uid 107 vs 110 (シード7 vs 10) = 直近対戦 1週間前
  const recent = doc.querySelector('.bp-flag-recent');
  assert.ok(recent, '直近対戦バッジが無い');
  assert.ok(recent.textContent.includes('週間前'), recent.textContent);
  // バッジクリック → 対戦詳細ポップアップ (大会名)
  recent.dispatchEvent(new win.Event('click', { bubbles: true }));
  const pop = doc.getElementById('bp-pop');
  assert.strictEqual(pop.hidden, false);
  assert.ok(pop.textContent.includes('テスト大会'));
});

test('プール切替 / フェーズ切替で URL が更新される', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  // プールを B1 へ
  const sel = doc.getElementById('bp-pool-select');
  sel.value = 'B1';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('pool=B1'));
  // フェーズを決勝へ → 8人 (4プール×2抜け) の1プール
  doc.querySelectorAll('.bp-tab')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('ph=1'));
  // 決勝は8人。前フェーズを無敗で通過したのは各プール1位の4人なので、
  // 残り4人は敗者側スタート = 勝者側1回戦に出るのは 1〜4
  await waitFor(win, () => doc.querySelectorAll('#bp-bracket .bp-round').length === 2);
  const seeds = [...doc.querySelectorAll('.bp-round:first-child .bp-seed')].map((e) => e.textContent).sort((a, b) => a - b);
  assert.deepStrictEqual(seeds, ['1', '2', '3', '4']);
  // d= は変わらない (表示状態だけが変わる)
  assert.ok(win.location.hash.includes('d=' + blob));
});

test('lb=1: 2人抜けの予選プールには GF が無い (通過が決まるまで)', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`);
  const doc = win.document;
  // 4人プールの2人抜け: 勝者側2列 + 敗者側2列。GF は実施されない
  const titles = [...doc.querySelectorAll('.bp-round-title')].map((e) => e.textContent);
  assert.ok(!titles.includes('グランドファイナル'), titles.join(','));
  assert.strictEqual(doc.querySelectorAll('.bp-round.bp-lb').length, 2, titles.join(','));
  assert.ok(doc.getElementById('bp-pool-info').textContent.includes('上位2人が通過'),
    doc.getElementById('bp-pool-info').textContent);
  // ドロップバッジ (勝者側決勝の敗者が降りてくる)
  assert.ok([...doc.querySelectorAll('.bp-drop')].length >= 1, 'ドロップバッジが無い');
  assert.ok(win.location.hash.includes('lb=1'));
  // 敗者側決勝はシード2 vs 7 (A2 のローカル 2,3 = グローバル 7,10 … ローカルシードで 2v3)
  const lbFinal = doc.querySelectorAll('.bp-round.bp-lb')[1];
  const lbSeeds = [...lbFinal.querySelectorAll('.bp-seed')].map((e) => e.textContent).sort((a, b) => a - b);
  assert.deepStrictEqual(lbSeeds, ['7', '10']);
  // チェックボックスを外すと敗者側が消えて lb=0 相当になる
  const cb = doc.getElementById('bp-lb');
  cb.checked = false;
  cb.dispatchEvent(new win.Event('change', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-round.bp-lb').length === 0);
  assert.ok(!win.location.hash.includes('lb=1'));
});

test('lb=1: 最終フェーズ (優勝まで) は GF まで描画される', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  // ph=1 = 決勝フェーズ (adv=0) = 8人1プール
  const { win } = await bootPage(`#v=1&ph=1&wd=1&lb=1&d=${blob}`);
  const doc = win.document;
  await waitFor(win, () => [...doc.querySelectorAll('.bp-round-title')].some((e) => e.textContent === 'グランドファイナル'));
  const titles = [...doc.querySelectorAll('.bp-round-title')].map((e) => e.textContent);
  assert.ok(titles.includes('敗者側決勝'), titles.join(','));
  assert.ok(!doc.getElementById('bp-pool-info').textContent.includes('人が通過'),
    doc.getElementById('bp-pool-info').textContent);
});

test('CSV保存 → 読み込みで phases/表示状態ごと復元できる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  let saved = null;
  win.URL.createObjectURL = (b) => { saved = b; return 'blob:stub'; };
  win.URL.revokeObjectURL = () => {};
  doc.getElementById('bp-csv-save').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => saved != null);
  const text = await saved.text();
  assert.ok(text.includes('phases'), 'ヘッダに phases 列が無い');
  assert.ok(text.includes('予選'), 'phases JSON が入っていない');
  // 保存 CSV を workCsvToPayload に往復 (BOM 付きでも読めること)
  const { payload, view } = S.workCsvToPayload(text);
  assert.deepStrictEqual(payload.uids, payload16().uids);
  assert.deepStrictEqual(payload.phases, payload16().phases);
  assert.strictEqual(view.pool, 'A2');
  // 名前は解決済みの分だけ入る (表示済みプール A2 の gi=1 は players JSON 由来。
  // 未表示プールの登録者は空でも uid から復元できる)
  assert.strictEqual(payload.names['1'], 'P2');
  assert.strictEqual(payload.names['3'], 'NoDB選手');   // uid なしは常に残る
});

test('uid なし参加者は共有データの名前で表示され、ポップアップに未登録と出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=B2&wd=1&d=${blob}`);
  const doc = win.document;
  // シード4 (gi=3) は poolOfSeed(3,4)=3 → 4つ目のプール = B2
  const nameEl = [...doc.querySelectorAll('.bp-name')].find((e) => e.textContent === 'NoDB選手');
  assert.ok(nameEl, 'names からの表示が無い');
  nameEl.dispatchEvent(new win.Event('click', { bubbles: true }));
  const pop = doc.getElementById('bp-pop');
  assert.strictEqual(pop.hidden, false);
  assert.ok(pop.textContent.includes('未登録'));
});

// 共有データに全員分の名前がある場合 (= 発行側の既定)。選手 JSON が全滅しても
// 名前とブラケット構造は出る、が満たすべき契約。
function payload16WithNames() {
  const p = payload16();
  for (let i = 0; i < 16; i++) if (p.uids[i] != null) p.names[String(i)] = 'P' + (i + 1);
  return p;
}

test('選手データが全滅しても共有データの名前でブラケットは描画される', { skip }, async () => {
  const blob = await S.encodePayload(payload16WithNames());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, { playerStatus: () => 'error' });
  const doc = win.document;
  const names = [...doc.querySelectorAll('.bp-name')].map((e) => e.textContent);
  assert.ok(names.includes('P2') && names.includes('P7'), names.join(','));
  await waitFor(win, () => doc.getElementById('bp-status').textContent.includes('取得失敗'));
  const st = doc.getElementById('bp-status').textContent;
  // 理由 (HTTP ステータス) と復旧手段を示す
  assert.ok(/503/.test(st), st);
  assert.ok(st.includes('再取得'), st);
  // 名前は出せているので「名前が分からない」警告は出ない
  assert.ok(!st.includes('名前が分からない'), st);
});

test('名前が分からない参加者は理由付きで報告される', { skip }, async () => {
  // names を持たない uid 106 が 404 (= DB になし) のケース
  const p = payload16();
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, {
    playerStatus: (uid) => (uid === 107 ? 'missing' : 'ok'),
  });
  const doc = win.document;
  await waitFor(win, () => doc.getElementById('bp-status').textContent.includes('名前が分からない'));
  const st = doc.getElementById('bp-status').textContent;
  assert.ok(st.includes('シード7'), st);          // どの参加者か
  assert.ok(st.includes('uid 107'), st);
  assert.ok(st.includes('SPSP DB になし'), st);   // なぜ出せないか
});

test('取得失敗は「🔄 再取得」で再試行される (404 は再試行しない)', { skip }, async () => {
  let failing = true;
  const blob = await S.encodePayload(payload16WithNames());
  const { win, state } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, {
    playerStatus: (uid) => (uid === 102 && failing ? 'error' : (uid === 115 ? 'missing' : 'ok')),
  });
  const doc = win.document;
  await waitFor(win, () => doc.getElementById('bp-status').textContent.includes('取得失敗'));
  failing = false;
  state.playerHits.length = 0;
  doc.getElementById('bp-reload').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => {
    const st = doc.getElementById('bp-status').textContent;
    return st.includes('SPSP 未登録') && !st.includes('取得失敗') && !st.includes('取得中');
  });
  // 失敗した 102 は取り直す / 404 だった 115 と成功済みの他は取り直さない
  assert.ok(state.playerHits.includes(102), '失敗した uid を再取得していない');
  assert.ok(!state.playerHits.includes(115), '404 (DB 未登録) を再取得している');
  assert.ok(!state.playerHits.includes(107), '成功済みを再取得している');
  assert.ok(doc.getElementById('bp-status').textContent.includes('SPSP 未登録'));
});

test('プレイヤー名クリックでプレイヤーページへのリンク付き概要が出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A1&wd=1&d=${blob}`);
  const doc = win.document;
  const nameEl = [...doc.querySelectorAll('.bp-name')].find((e) => e.textContent === 'P1');
  assert.ok(nameEl);
  nameEl.dispatchEvent(new win.Event('click', { bubbles: true }));
  const pop = doc.getElementById('bp-pop');
  assert.strictEqual(pop.hidden, false);
  assert.ok(pop.textContent.includes('SPSP 総合'));
  const a = pop.querySelector('a');
  assert.ok(a && a.getAttribute('href') === '../p/?uid=101');
});

// 6人プール (B=8 → 1回戦は 3試合中 2試合が bye)。bye は描画しない。
function payload6() {
  const uids = [], names = {};
  for (let i = 1; i <= 6; i++) { uids.push(200 + i); names[String(i - 1)] = 'Q' + i; }
  return {
    v: 1, ev: 'bye テスト', src: 'spsp',
    phases: [{ name: 'ブラケット', pools: 1, adv: 0 }], wv: [0], uids, names,
  };
}

test('片方が bye の試合は描画しない', { skip }, async () => {
  const blob = await S.encodePayload(payload6());
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // BYE スロットが1つも無い / 空カード (bp-ghost) も無い
  assert.strictEqual(doc.querySelectorAll('.bp-slot.bp-bye').length, 0);
  assert.strictEqual(doc.querySelectorAll('.bp-match.bp-ghost').length, 0);
  // 6人フル DE の実試合数 = 2*6-2 = 10 (勝者側5 + 敗者側4 + GF1)
  assert.strictEqual(doc.querySelectorAll('.bp-match').length, 10);
  // どのカードも 2 人そろっている
  for (const m of doc.querySelectorAll('.bp-match')) {
    assert.strictEqual(m.querySelectorAll('.bp-name').length, 2, m.textContent);
    assert.ok(!/BYE/.test(m.textContent), m.textContent);
  }
});

// トップカット: 上位が勝者側・下位が敗者側スタート
function payloadSplit() {
  const uids = [], names = {};
  for (let i = 1; i <= 24; i++) { uids.push(300 + i); names[String(i - 1)] = 'R' + i; }
  return {
    v: 1, ev: '敗者側スタート テスト', src: 'spsp',
    phases: [{ name: 'トップカット', pools: 1, adv: 0, lb: 16 }], wv: [0], uids, names,
  };
}

test('敗者側スタート: 上位8人だけが勝者側1回戦に出る', { skip }, async () => {
  const blob = await S.encodePayload(payloadSplit());
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const seedsIn = (el) => [...el.querySelectorAll('.bp-seed')].map((e) => parseInt(e.textContent, 10));
  const wr1 = seedsIn(doc.querySelectorAll('.bp-round')[0]).sort((a, b) => a - b);
  assert.deepStrictEqual(wr1, [1, 2, 3, 4, 5, 6, 7, 8], '勝者側1回戦が上位8人でない');
  const lr1 = seedsIn(doc.querySelectorAll('.bp-round.bp-lb')[0]).sort((a, b) => a - b);
  assert.deepStrictEqual(lr1, Array.from({ length: 16 }, (_, i) => i + 9), '敗者側初戦が下位16人でない');
  assert.ok(doc.getElementById('bp-pool-info').textContent.includes('勝者側スタート8人・敗者側スタート16人'),
    doc.getElementById('bp-pool-info').textContent);
});

test('フェーズ構成エディタで敗者側スタートを変更できる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=1&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // 決勝フェーズ (8人1プール) の敗者側スタートを 4 にする
  const row = doc.querySelectorAll('.bp-phase-row')[1];
  assert.strictEqual(row.querySelector('[data-f="lb"]').value, '4', '既定値がプリフィルされていない');
  row.querySelector('[data-f="lb"]').value = '2';
  doc.getElementById('bp-phase-apply').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.getElementById('bp-phase-status').textContent.includes('適用'));
  await waitFor(win, () => doc.getElementById('bp-pool-info').textContent.includes('敗者側スタート2人'));
  // 勝者側は6人ぶん (8人中2人が敗者側スタート)。6人ブラケットなので1回戦は bye を除いて 3v6, 4v5
  const wr1 = [...doc.querySelectorAll('.bp-round')[0].querySelectorAll('.bp-seed')]
    .map((e) => parseInt(e.textContent, 10)).sort((a, b) => a - b);
  assert.deepStrictEqual(wr1, [3, 4, 5, 6]);
  // URL の共有データにも載る (共有すれば同じ構成が開く)
  const d = win.location.hash.match(/[#&]d=([^&]+)/)[1];
  const payload = await S.decodePayload(d);
  assert.strictEqual(payload.phases[1].lb, 2);
});

test('通過者に次フェーズの入り口が出て、クリックでそこへ飛ぶ', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // A2 = グローバルシード 2,7,10,15。2人抜けなので通過はシード2と7
  const chips = [...doc.querySelectorAll('.bp-next')];
  // 決勝は「無敗で通過した4人が勝者側」なので、敗者側を勝ち上がったシード7は敗者側スタート
  assert.deepStrictEqual(chips.map((c) => c.textContent).sort(), ['→ P1 #2', '→ P1 #7 敗者側']);
  assert.deepStrictEqual(chips.map((c) => c.dataset.next).sort(), ['1', '6']);
  // 1人につき1つ (最後に出る試合だけ)
  assert.strictEqual(chips.length, 2);
  // クリック → 決勝フェーズの該当プールへ移動し、本人がハイライトされる
  chips.find((c) => c.dataset.next === '6').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-slot.bp-hi').length > 0);
  assert.ok(win.location.hash.includes('ph=1'), win.location.hash);
  assert.ok(win.location.hash.includes('hi=6'), win.location.hash);
  const hi = doc.querySelector('.bp-slot.bp-hi');
  assert.strictEqual(hi.querySelector('.bp-seed').textContent, '7');
});

test('敗者側スタートのフェーズへ進む人には「敗者側」と出る', { skip }, async () => {
  const p = payload16();
  p.phases = [{ name: '予選', pools: 4, adv: 2 }, { name: '決勝', pools: 1, adv: 0, lb: 4 }];
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const chips = [...doc.querySelectorAll('.bp-next')].map((c) => c.textContent).sort();
  // 決勝は8人で下位4人が敗者側スタート → シード7は敗者側、シード2は勝者側
  assert.deepStrictEqual(chips, ['→ P1 #2', '→ P1 #7 敗者側']);
});

test('最終フェーズと非通過者には次フェーズの入り口を出さない', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  // 最終フェーズ (決勝) では次が無いのでチップなし
  const { win } = await bootPage(`#v=1&ph=1&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  assert.strictEqual(win.document.querySelectorAll('.bp-next').length, 0);
  // 予選 A1 で通過するのはシード1と8だけ (16人4プール2抜け)
  const { win: w2 } = await bootPage(`#v=1&ph=0&pool=A1&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const gis = [...w2.document.querySelectorAll('.bp-next')].map((c) => Number(c.dataset.next)).sort((a, b) => a - b);
  assert.deepStrictEqual(gis, [0, 7]);
});

test('1敗で通過した人は次フェーズの敗者側から始まる (勝者側に上がらない)', { skip }, async () => {
  // 24人 = 勝者側8 + 敗者側16、6抜け。通過6人のうち無敗は2人だけ。
  const uids = [], names = {};
  for (let i = 1; i <= 24; i++) { uids.push(400 + i); names[String(i - 1)] = 'S' + i; }
  const p = {
    v: 1, ev: '無敗判定テスト', src: 'spsp',
    phases: [{ name: 'Phase2', pools: 1, adv: 6, lb: 16 }, { name: 'TOP6', pools: 1, adv: 0 }],
    wv: [0], uids, names,
  };
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const chips = [...doc.querySelectorAll('.bp-next')].map((c) => c.textContent).sort();
  assert.deepStrictEqual(chips, [
    '→ P1 #1', '→ P1 #2',                 // 無敗の2人 = 次も勝者側
    '→ P1 #3 敗者側', '→ P1 #4 敗者側',   // 1敗して通過 = 敗者側スタート
    '→ P1 #5 敗者側', '→ P1 #6 敗者側',
  ].sort());
  // 次フェーズを開くと実際に勝者側1回戦がシード1,2 だけになっている
  doc.querySelectorAll('.bp-tab')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('ph=1'));
  await waitFor(win, () => doc.querySelectorAll('#bp-bracket .bp-round').length > 0);
  const wr1 = [...doc.querySelectorAll('.bp-round')[0].querySelectorAll('.bp-seed')]
    .map((e) => parseInt(e.textContent, 10)).sort((a, b) => a - b);
  assert.deepStrictEqual(wr1, [1, 2]);
});

test('前フェーズの出どころが出て、クリックで戻れる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  // 決勝フェーズ (8人)。全員が予選のどこかのプールから来ている
  const { win } = await bootPage(`#v=1&ph=1&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const chips = [...doc.querySelectorAll('.bp-prev')];
  assert.strictEqual(chips.length, 8, '8人ぶんの出どころが無い');
  // スネークなので グローバルシード1→A1の1位 / 5→B2の2位 / 8→A1の2位
  const byGi = new Map(chips.map((c) => [c.dataset.prev, c.textContent]));
  assert.strictEqual(byGi.get('0'), '← A1 #1');
  assert.strictEqual(byGi.get('1'), '← A2 #1');
  assert.strictEqual(byGi.get('4'), '← B2 #2');
  assert.strictEqual(byGi.get('7'), '← A1 #2');
  // クリックで予選のそのプールへ戻り、本人がハイライトされる
  chips.find((c) => c.dataset.prev === '7').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-slot.bp-hi').length > 0);
  assert.ok(win.location.hash.includes('ph=0'), win.location.hash);
  assert.ok(win.location.hash.includes('pool=A1'), win.location.hash);
  assert.strictEqual(doc.querySelector('.bp-slot.bp-hi .bp-seed').textContent, '8');
});

test('フェーズ0には出どころチップを出さない', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A1&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  assert.strictEqual(win.document.querySelectorAll('.bp-prev').length, 0);
});

test('勝者側スタートが前フェーズの無敗通過数と食い違うと警告する', { skip }, async () => {
  const p = payload16();
  p.phases = [{ name: '予選', pools: 4, adv: 2 }, { name: '決勝', pools: 1, adv: 0, lb: 0 }];
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=1&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  await waitFor(win, () => doc.getElementById('bp-status').textContent.includes('無敗で通過したのは'));
  const st = doc.getElementById('bp-status').textContent;
  assert.ok(st.includes('4人'), st);
  assert.ok(st.includes('1敗で通過した人が勝者側から始まります'), st);
});

test('敗者側スタートは触らなければ前フェーズに追従する', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=1&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // 既定では 8人中4人が敗者側スタート (各プール1位の4人だけ勝者側)
  assert.strictEqual(doc.querySelectorAll('.bp-phase-row')[1].querySelector('[data-f="lb"]').value, '4');
  // 予選の進出人数を 4 に変えて適用 → 触っていない敗者側スタートは自動で追従する
  const row0 = doc.querySelectorAll('.bp-phase-row')[0];
  row0.querySelector('[data-f="adv"]').value = '3';
  doc.getElementById('bp-phase-apply').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.getElementById('bp-phase-status').textContent.includes('適用'));
  // 決勝は12人になり、無敗通過4人ぶんだけが勝者側 → 敗者側スタートは 8 に追従する
  await waitFor(win, () => doc.querySelectorAll('.bp-phase-row')[1].querySelector('[data-f="lb"]').value === '8');
  const d = win.location.hash.match(/[#&]d=([^&]+)/)[1];
  const payload = await S.decodePayload(d);
  assert.strictEqual(payload.phases[1].lb, undefined, '既定のままなら lb を持たせない');
  assert.ok(!doc.getElementById('bp-status').textContent.includes('食い違'), doc.getElementById('bp-status').textContent);
});

test('名前の左にメイン使用キャラの絵文字が出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // フィクスチャ: uid 102 = スティーブ 🧱 / uid 107 = ロボット 🤖
  const slots = [...doc.querySelectorAll('.bp-slot')];
  const s2 = slots.find((s) => s.querySelector('.bp-seed').textContent === '2');
  assert.ok(s2, 'シード2 の枠が無い');
  assert.strictEqual(s2.querySelector('.bp-char').textContent, '🧱');
  assert.strictEqual(s2.querySelector('.bp-char').getAttribute('title'), 'スティーブ');
  // 絵文字は名前より前 (1行目の中)
  const kids = [...s2.querySelector('.bp-line').children].map((e) => e.className);
  assert.ok(kids.indexOf('bp-char') < kids.indexOf('bp-name'), kids.join(','));
  // キャラ未登録の参加者には出さない
  const s10 = slots.find((s) => s.querySelector('.bp-seed').textContent === '10');
  assert.strictEqual(s10.querySelector('.bp-char'), null);
  // ポップアップにもキャラ名が出る
  s2.querySelector('.bp-name').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(doc.getElementById('bp-pop').textContent.includes('スティーブ'),
    doc.getElementById('bp-pop').textContent);
});

test('勝者側の枠に「負けたら敗者側どこへ落ちるか」が出て、クリックで飛べる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // A2 = 4人プール。勝者側1回戦の敗者は敗者側1回戦へ落ちる
  const w1 = doc.querySelectorAll('.bp-round:not(.bp-lb)')[0];
  const tos = [...w1.querySelectorAll('.bp-dropto')];
  assert.ok(tos.length >= 1, '落ちる先のバッジが無い');
  assert.ok(/敗者側/.test(tos[0].textContent), tos[0].textContent);
  // 勝つ側には出さない (負ける側だけ)
  const winSlots = [...w1.querySelectorAll('.bp-slot.bp-win')];
  assert.ok(winSlots.every((s) => !s.querySelector('.bp-dropto')), '勝つ側にも出ている');
  // クリック → 落ちる先の試合へ (data-key で特定でき、本人がハイライトされる)
  const targetKey = tos[0].dataset.jump;
  const gi = tos[0].dataset.jumpGi;
  tos[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelector(`.bp-match[data-key="${targetKey}"]`));
  assert.ok(targetKey.startsWith('L:'), targetKey);
  const hi = [...doc.querySelectorAll('.bp-slot.bp-hi .bp-seed')].map((e) => e.textContent);
  assert.ok(hi.includes(String(Number(gi) + 1)), hi.join(','));
});

test('敗者側の「↓勝者側○回戦」から元の試合へ飛べる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const from = [...doc.querySelectorAll('.bp-drop.bp-jump')];
  assert.ok(from.length >= 1, '飛べるドロップバッジが無い');
  assert.ok(from[0].dataset.jump.startsWith('W:'), from[0].dataset.jump);
  from[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelector(`.bp-match[data-key="${from[0].dataset.jump}"]`));
  await waitFor(win, () => doc.querySelectorAll('.bp-slot.bp-hi').length > 0);
});

test('名前クリックで通過しない選手もハイライトでき、もう一度で解除される', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // シード15 は A2 で通過しない (2抜けなので通過は 2 と 7)
  const target = [...doc.querySelectorAll('.bp-slot')]
    .find((s) => s.querySelector('.bp-seed').textContent === '15');
  assert.ok(target, 'シード15 の枠が無い');
  assert.strictEqual(target.querySelector('.bp-next'), null, '通過しないのにチップが出ている');
  target.querySelector('.bp-name').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-slot.bp-hi').length > 0);
  // その選手の枠がすべてハイライトされる
  const hiSeeds = [...doc.querySelectorAll('.bp-slot.bp-hi .bp-seed')].map((e) => e.textContent);
  assert.ok(hiSeeds.every((t) => t === '15'), hiSeeds.join(','));
  assert.ok(hiSeeds.length >= 1);
  // もう一度クリックで解除
  const again = [...doc.querySelectorAll('.bp-slot.bp-hi .bp-name')][0];
  again.dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-slot.bp-hi').length === 0);
});

test('再取得ボタンは取得失敗があるときだけ出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  await waitFor(win, () => !/取得中/.test(win.document.getElementById('bp-status').textContent));
  assert.strictEqual(win.document.getElementById('bp-reload').hidden, true, '失敗が無いのに出ている');
  const { win: w2 } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`, { playerStatus: () => 'error' });
  await waitFor(w2, () => w2.document.getElementById('bp-status').textContent.includes('取得失敗'));
  assert.strictEqual(w2.document.getElementById('bp-reload').hidden, false, '失敗しても出ない');
});

test('レイアウト: 進出先チップは枠の外、その他のタグは名前の下 (枠の中)', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // 進出先チップ = スロット直下 (1行目の外) に置き、CSS で枠の右外に出す
  const next = doc.querySelector('.bp-next');
  assert.ok(next, '進出先チップが無い');
  assert.ok(next.parentElement.classList.contains('bp-slot'), next.parentElement.className);
  assert.strictEqual(next.closest('.bp-line'), null, '1行目の中に入っている');
  assert.strictEqual(next.closest('.bp-tags'), null, 'タグ行の中に入っている');
  // 居住地・落ちる先は名前の下のタグ行 (同じスロットの中)
  const to = doc.querySelector('.bp-dropto');
  assert.ok(to, '落ちる先バッジが無い');
  assert.ok(to.parentElement.classList.contains('bp-tags'), to.parentElement.className);
  assert.ok(to.closest('.bp-slot'), 'スロットの外に出ている');
  // タグ行は1行目より後ろ (= 名前の下)
  const slot = to.closest('.bp-slot');
  const kids = [...slot.children].map((e) => e.className.split(' ')[0]);
  assert.ok(kids.indexOf('bp-line') < kids.indexOf('bp-tags'), kids.join(','));
});

test('レイアウト: 出どころチップも枠の外 (左) で、フェーズ1以降は左余白が付く', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=1&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const prev = doc.querySelector('.bp-prev');
  assert.ok(prev, '出どころチップが無い');
  assert.ok(prev.parentElement.classList.contains('bp-slot'), prev.parentElement.className);
  assert.strictEqual(prev.closest('.bp-line'), null);
  assert.ok(doc.getElementById('bp-bracket').classList.contains('has-prev'));
  // フェーズ0 では左余白を付けない
  const { win: w0 } = await bootPage(`#v=1&ph=0&pool=A1&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  assert.ok(!w0.document.getElementById('bp-bracket').classList.contains('has-prev'));
});

test('プールが2つ以上の単一フェーズを開くと次フェーズが自動で足される', { skip }, async () => {
  // 予選4プール2抜けだけの (次フェーズが無い) 共有データ = 発行側の旧仕様
  const p = payload16();
  p.phases = [{ name: '予選', pools: 4, adv: 2 }];
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&pool=A1&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  await waitFor(win, () => doc.querySelectorAll('.bp-tab').length === 2);
  assert.ok(doc.querySelectorAll('.bp-tab')[1].textContent.includes('TOP8'),
    doc.querySelectorAll('.bp-tab')[1].textContent);
  // 共有データも作り直されているので、その URL を開けば同じ構成になる
  const d = win.location.hash.match(/[#&]d=([^&]+)/)[1];
  const back = await S.decodePayload(d);
  assert.strictEqual(back.phases.length, 2);
  // 通過者に次フェーズの入り口が出る
  assert.ok(doc.querySelectorAll('.bp-next').length > 0, '進出チップが無い');
});

test('フェーズ構成でプール数を2以上にすると次フェーズが足される', { skip }, async () => {
  const p = payload16();
  p.phases = [{ name: 'ブラケット', pools: 1, adv: 0 }];
  p.wv = [0];
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  assert.strictEqual(doc.querySelectorAll('.bp-phase-row').length, 1);
  doc.querySelector('.bp-phase-row [data-f="pools"]').value = '4';
  doc.getElementById('bp-phase-apply').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.querySelectorAll('.bp-phase-row').length === 2);
  const st = doc.getElementById('bp-phase-status').textContent;
  assert.ok(st.includes('追加'), st);
  assert.strictEqual(doc.querySelectorAll('.bp-tab').length, 2);
});

test('敗者側1回戦にも「どこから落ちてきたか」が出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // 4人プールの敗者側1回戦 = 勝者側1回戦の敗者どうし。両方に出どころが付く
  const lb1 = doc.querySelectorAll('.bp-round.bp-lb')[0];
  const froms = [...lb1.querySelectorAll('.bp-drop')];
  assert.strictEqual(froms.length, 2, froms.map((e) => e.textContent).join(','));
  for (const f of froms) {
    assert.ok(/勝者側/.test(f.textContent), f.textContent);
    assert.ok(f.dataset.jump.startsWith('W:0:'), f.dataset.jump);
  }
  // 2回目以降の敗者側ラウンドでは、勝ち上がってきた側には出さない (初登場だけ)
  const lb2 = doc.querySelectorAll('.bp-round.bp-lb')[1];
  const froms2 = [...lb2.querySelectorAll('.bp-drop')];
  assert.strictEqual(froms2.length, 1, froms2.map((e) => e.textContent).join(','));
  assert.ok(froms2[0].dataset.jump.startsWith('W:1:'), froms2[0].dataset.jump);
});

test('敗者側スタート勢には出どころを出さない', { skip }, async () => {
  const uids = [], names = {};
  for (let i = 1; i <= 16; i++) { uids.push(500 + i); names[String(i - 1)] = 'T' + i; }
  const p = {
    v: 1, ev: '敗者側スタート', src: 'spsp',
    phases: [{ name: '本戦', pools: 1, adv: 0, lb: 8 }], wv: [0], uids, names,
  };
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const lb1 = doc.querySelectorAll('.bp-round.bp-lb')[0];
  assert.strictEqual(lb1.querySelectorAll('.bp-drop').length, 0, '直入り勢に出どころが出ている');
});

test('敗者側で名前を押しても、そのカードの位置に概要が出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`);
  const doc = win.document;
  const lbName = doc.querySelector('.bp-round.bp-lb .bp-name[data-gi]');
  assert.ok(lbName, '敗者側に名前が無い');
  const key = lbName.closest('.bp-match').dataset.key;
  assert.ok(key.startsWith('L:'), key);
  lbName.dispatchEvent(new win.Event('click', { bubbles: true }));
  const pop = doc.getElementById('bp-pop');
  assert.strictEqual(pop.hidden, false, '概要が出ない');
  // 押した試合と同じカードを基準に開く (勝者側の同じ選手の位置に飛ばない)
  assert.strictEqual(pop.dataset.anchor, key);
  assert.ok(pop.textContent.includes('SPSP'), pop.textContent);
});

test('勝者側で押したときは勝者側のカードが基準になる', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&lb=1&d=${blob}`);
  const doc = win.document;
  const wName = doc.querySelector('.bp-round:not(.bp-lb) .bp-name[data-gi]');
  const key = wName.closest('.bp-match').dataset.key;
  wName.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.strictEqual(doc.getElementById('bp-pop').dataset.anchor, key);
  assert.ok(key.startsWith('W:'), key);
});

test('敗者側も勝ち上がる側が上のスロットに来る', { skip }, async () => {
  const uids = [], names = {};
  for (let i = 1; i <= 8; i++) { uids.push(700 + i); names[String(i - 1)] = 'U' + i; }
  const p = { v: 1, ev: '並び確認', src: 'spsp', phases: [{ name: 'ブラケット', pools: 1, adv: 0 }], wv: [0], uids, names };
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const topIsWinner = (round) => [...round.querySelectorAll('.bp-match')].every((card) => {
    const slots = [...card.querySelectorAll('.bp-slot')];
    if (slots.length < 2) return true;
    return slots[0].classList.contains('bp-win') && !slots[1].classList.contains('bp-win');
  });
  for (const col of doc.querySelectorAll('.bp-round.bp-lb')) {
    assert.ok(topIsWinner(col), '敗者側: ' + col.querySelector('.bp-round-title').textContent);
  }
  // 勝者側も同じ (元から上が勝ち上がる)
  for (const col of doc.querySelectorAll('.bp-round:not(.bp-lb)')) {
    assert.ok(topIsWinner(col), '勝者側: ' + col.querySelector('.bp-round-title').textContent);
  }
});

test('接続線: 折れ線でスロット単位に結ばれる (誰がどこへ行くかが追える)', { skip }, async () => {
  const uids = [], names = {};
  for (let i = 1; i <= 8; i++) { uids.push(800 + i); names[String(i - 1)] = 'V' + i; }
  const p = { v: 1, ev: '線の確認', src: 'spsp', phases: [{ name: 'ブラケット', pools: 1, adv: 0 }], wv: [0], uids, names };
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  const secs = [...doc.querySelectorAll('.bp-sec')];
  assert.strictEqual(secs.length, 2, '敗者側セクションが無い');
  const isStub = (d) => !/^M0 /.test(d);
  for (const [si, sec] of secs.entries()) {
    const side = si ? '敗者側' : '勝者側';
    for (const svg of sec.querySelectorAll('.bp-links')) {
      const ds = [...svg.querySelectorAll('path')].map((e) => e.getAttribute('d'));
      // 曲線は使わない (水平→垂直→水平の折れ線だけ)
      for (const d of ds) assert.ok(!/[CQSA]/.test(d), side + ': 曲線が入っている ' + d);
      // 左に対応する枠が無い側 (勝者側からのドロップ / GF の敗者側優勝) には線を引かない
      for (const d of ds) assert.ok(!isStub(d), side + ': 引き込み線が残っている ' + d);
      // 同じ試合に入る線は別々の段へ (終点 y が重ならない)
      const endY = (d) => Number(d.match(/V ([\d.]+)/)[1]);
      const ends = ds.filter((d) => /V /.test(d)).map(endY);
      assert.strictEqual(new Set(ends).size, ends.length, side + ': 同じ段に複数の線が入っている ' + ds.join(' / '));
    }
  }
});

test('接続線: 勝ち上がりが下段のときは線も下段に入る', { skip }, async () => {
  const uids = [], names = {};
  for (let i = 1; i <= 8; i++) { uids.push(810 + i); names[String(i - 1)] = 'W' + i; }
  const p = { v: 1, ev: '線の段', src: 'spsp', phases: [{ name: 'ブラケット', pools: 1, adv: 0 }], wv: [0], uids, names };
  const blob = await S.encodePayload(p);
  const { win } = await bootPage(`#v=1&ph=0&wd=1&lb=1&d=${blob}`, { playerStatus: () => 'missing' });
  const doc = win.document;
  // 敗者側2回戦 (勝者側からのドロップが勝つ) は前ラウンドからの線が下段へ降りる
  const svg = doc.querySelectorAll('.bp-sec')[1].querySelectorAll('.bp-links')[0];
  const d = [...svg.querySelectorAll('path')].map((e) => e.getAttribute('d')).find((x) => /^M0 /.test(x));
  const start = Number(d.match(/^M0 ([\d.]+)/)[1]);
  const end = Number(d.match(/V ([\d.]+)/)[1]);
  assert.ok(end > start, `線が下段に入っていない (始点 ${start} → 終点 ${end})`);
});

// ── データ版 (同じデータを見ているかの突き合わせ) ─────────────────────
test('データ版がヘッダに出て、プール/フェーズを切り替えても変わらない', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  const el = doc.getElementById('bp-version');
  await waitFor(win, () => el && !el.hidden && el.textContent.includes('データ版'));
  const shown = el.querySelector('code').textContent;
  assert.match(shown, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, '版の書式が違う: ' + shown);
  assert.strictEqual(shown, S.payloadVersion(payload16()), '発行側と値が違う');

  // 見る側の状態 (プール / フェーズ / 敗者側表示) では変わらない。
  const sel = doc.getElementById('bp-pool-select');
  sel.value = 'B1';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('pool=B1'));
  doc.querySelectorAll('.bp-tab')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('ph=1'));
  const lb = doc.getElementById('bp-lb');
  lb.checked = true;
  lb.dispatchEvent(new win.Event('change', { bubbles: true }));
  await waitFor(win, () => win.location.hash.includes('lb=1'));
  assert.strictEqual(doc.getElementById('bp-version').querySelector('code').textContent, shown,
    '見る側の状態で版が変わってしまっている');
  assert.ok(!el.classList.contains('bp-version-edited'), '編集していないのに編集済み表示');
});

test('フェーズ構成を変えるとデータ版も変わり、変更済みと出る', { skip }, async () => {
  const blob = await S.encodePayload(payload16());
  const { win } = await bootPage(`#v=1&ph=0&pool=A2&wd=1&d=${blob}`);
  const doc = win.document;
  await waitFor(win, () => doc.getElementById('bp-version').querySelector('code'));
  const before = doc.getElementById('bp-version').querySelector('code').textContent;
  // 決勝フェーズの敗者側スタートを変えて適用 (ブラケットの中身が変わる操作)
  const row = doc.querySelectorAll('.bp-phase-row')[1];
  row.querySelector('[data-f="lb"]').value = '2';
  doc.getElementById('bp-phase-apply').dispatchEvent(new win.Event('click', { bubbles: true }));
  await waitFor(win, () => doc.getElementById('bp-phase-status').textContent.includes('適用'));
  await waitFor(win, () => doc.getElementById('bp-version').querySelector('code').textContent !== before);
  const el = doc.getElementById('bp-version');
  assert.ok(el.classList.contains('bp-version-edited'), '編集済みの見た目になっていない');
  assert.ok(el.textContent.includes('変更済み'), '編集済みの注記が無い: ' + el.textContent);
});
