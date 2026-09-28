'use strict';
// gas/*.gs を vm で実行するテスト環境 (Apps Script API のスタブ)。
// gas.test.cjs (post) と gas_vote.test.cjs (login/vote) で共有する。
//
// GAS 側で新しい Apps Script API を使い始めたら、ここのスタブにも足すこと
// (足し忘れは ReferenceError で全部落ちるので気づける)。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const GAS_DIR = path.resolve(__dirname, '../../gas');
const SRC = ['config.gs', 'oauth.gs', 'sheet.gs', 'session.gs', 'vote.gs', 'export.gs', 'errlog.gs', 'main.gs']
  .map((f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8'))
  .join('\n;\n');

const HEADER = ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'body', 'status'];
const VOTES_HEADER = ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'char_id', 'char_name', 'status'];

/** JST の ISO 8601 / yyyy-MM-dd を作る (Utilities.formatDate のスタブ用)。 */
function jst(ms, dateOnly) {
  const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 19) + '+09:00';
}

const OK_TOKEN = { status: 200, body: { access_token: 'AT-secret', token_type: 'Bearer' } };
const OK_USER = {
  status: 200,
  body: { data: { currentUser: { id: 4242, slug: 'user/abcd1234', player: { gamerTag: 'Toko' } } } },
};

// GAS の byte[] は符号付きだが、スタブ内で一貫していれば十分なので符号なしで扱う。
function toBuf(data) {
  return Array.isArray(data)
    ? Buffer.from(data.map((b) => b & 0xff))
    : Buffer.from(String(data), 'utf8');
}

/**
 * テスト環境を組む。
 *   opts.rows        : posts シートの初期行 (ヘッダ込み)
 *   opts.voteRows    : char_votes シートの初期行 (ヘッダ込み)
 *   opts.token       : token 交換の応答 { status, body } / null で例外
 *   opts.user        : currentUser の応答 { status, body }
 *   opts.player      : players/<uid>.json の応答 (既定 200 + characters 空)
 *   opts.charEmoji   : char_emoji.json の応答 (既定 200 + 2 キャラ)
 *   opts.props       : スクリプトプロパティ
 *   opts.sheetMissing: posts/char_votes シートが未作成の状態にする
 */
function makeEnv(opts) {
  const o = opts || {};
  const rows = o.rows ? o.rows.map((r) => r.slice()) : [HEADER.slice()];
  const voteRows = o.voteRows ? o.voteRows.map((r) => r.slice()) : [VOTES_HEADER.slice()];
  const props = Object.assign(
    { STARTGG_CLIENT_SECRET: 'SECRET-DO-NOT-LEAK', SHEET_ID: 'sheet-1' }, o.props);
  const fetches = [];
  const cache = new Map();
  const counts = { setNumberFormat: 0, openById: 0, insertSheet: 0 };

  function makeSheet(sheetRows) {
    return {
      getLastRow: () => sheetRows.length,
      getRange(a, b, c, d) {
        if (typeof a === 'string') return { setNumberFormat: () => { counts.setNumberFormat++; } };
        return {
          getValues: () => sheetRows.slice(a - 1, a - 1 + c).map((r) => r.slice(b - 1, b - 1 + d)),
          setNumberFormat: () => { counts.setNumberFormat++; },
        };
      },
      appendRow: (r) => sheetRows.push(r.slice()),
      deleteRow: (n) => { sheetRows.splice(n - 1, 1); },   // n は 1-based
      setFrozenRows: () => {},
      setName: () => {},
    };
  }

  // 名前 → 行配列。errors のように GAS 側が必要時に作るシートも扱えるようにする。
  const rowsByName = { posts: rows, char_votes: voteRows };
  const sheets = { posts: makeSheet(rows), char_votes: makeSheet(voteRows) };
  const present = { posts: !o.sheetMissing, char_votes: !o.sheetMissing };

  function resp(r) {
    return {
      getResponseCode: () => r.status,
      getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  }

  const CHAR_EMOJI_DEFAULT = {
    status: 200,
    body: { 1305: { name: 'ロックマン', emoji: '🤖' }, 1271: { name: 'ベヨネッタ', emoji: '🦋' } },
  };
  const PLAYER_DEFAULT = { status: 200, body: { user_id: 4242, characters: [] } };

  const sandbox = {
    console: { error: () => {}, log: () => {} },
    Date,
    JSON,
    Math,
    String,
    Number,
    isNaN,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props && props[k] != null ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    UrlFetchApp: {
      fetch(url, params) {
        fetches.push({ url, params });
        let spec;
        if (url.indexOf('/oauth/') !== -1) spec = o.token;
        else if (url.indexOf('/gql/') !== -1) spec = o.user;
        else if (url.indexOf('/players/') !== -1) spec = (o.player === undefined ? PLAYER_DEFAULT : o.player);
        else if (url.indexOf('char_emoji.json') !== -1) spec = (o.charEmoji === undefined ? CHAR_EMOJI_DEFAULT : o.charEmoji);
        if (spec === undefined || spec === null) throw new Error('network');
        return resp(spec);
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(s) {
        const out = { text: s, mime: null };
        out.setMimeType = function (m) { out.mime = m; return out; };
        // 実物の TextOutput は getContent() を持つ。main.gs の失敗ログ判定が使う。
        out.getContent = function () { return out.text; };
        return out;
      },
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    // 署名 state の単回使用に使う。TTL は無視して単純な Map で十分
    // (期限そのものは payload の t で検証しているため)。
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    SpreadsheetApp: {
      openById: () => {
        counts.openById++;
        return {
          getSheetByName: (name) => (present[name] ? sheets[name] : null),
          insertSheet: (name) => {
            counts.insertSheet++;
            present[name] = true;
            if (!sheets[name]) {          // 未知のシート (errors 等) はその場で作る
              rowsByName[name] = [];
              sheets[name] = makeSheet(rowsByName[name]);
            }
            return sheets[name];
          },
        };
      },
    },
    Utilities: {
      formatDate: (d, tz, pattern) => jst(d.getTime(), pattern === 'yyyy-MM-dd'),
      base64EncodeWebSafe: (data) =>
        toBuf(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) =>
        Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      computeHmacSha256Signature: (value, key) =>
        Array.from(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()),
      newBlob: (data) => ({ getDataAsString: () => toBuf(data).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.STARTGG_CLIENT_ID = 'test-client-id';

  return { sandbox, rows, voteRows, rowsByName, fetches, props, counts, cache };
}

/** doPost を生のまま呼ぶ (state を自動で足さない)。 */
function rawPost(env, body) {
  const out = env.sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.text);
}

/** 署名済み state を 1 つ発行する。 */
function beginState(env, nonce, returnPath) {
  const res = rawPost(env, {
    action: 'begin_login', nonce: nonce || 'N', returnPath: returnPath || '/spsp/vote.html',
  });
  if (!res.ok) throw new Error('begin_login failed: ' + JSON.stringify(res));
  return res.state;
}

/**
 * doPost を呼んで JSON を返す。
 * login / post は署名 state が必須なので、明示指定が無ければ有効なものを補う
 * (state 自体の検証は state.test.cjs / gas_state.test.cjs で個別に見る)。
 */
function post(env, body) {
  let b = body;
  if ((b.action === 'login' || b.action === 'post') && !('state' in b)) {
    b = Object.assign({}, b, { state: beginState(env) });
  }
  return rawPost(env, b);
}

/** login して有効なセッショントークンを得る。 */
function loginToken(env) {
  const res = post(env, { action: 'login', code: 'CODE-login' });
  if (!res.ok) throw new Error('login failed in helper: ' + JSON.stringify(res));
  return res.token;
}

module.exports = { GAS_DIR, HEADER, VOTES_HEADER, jst, OK_TOKEN, OK_USER, makeEnv, post, rawPost, beginState, loginToken };
