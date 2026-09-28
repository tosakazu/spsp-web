/**
 * セッション (ログイン) — start.gg OAuth で本人確認し、署名付きトークンを発行する。
 *
 * トークン = base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload部, SESSION_SECRET))
 *   payload = { v:1, uid, slug, tag, iat, exp }
 *
 * - ブラウザは localStorage に保存し、以後の action (vote 等) に添えて送る。
 * - SESSION_SECRET はスクリプトプロパティ。無ければ初回に自動生成する
 *   (人手作業を増やさない)。値はログにもレスポンスにも出さない (INV-3 と同じ扱い)。
 * - 偽造には secret が要る。期限切れ・改ざんは verify で null になる。
 */

function ensureSessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (!s) {
    // UUID x2 (= 64 hex 相当のエントロピー)。自動生成なので人手投入は不要。
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function signPayload_(bodyB64) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(bodyB64, ensureSessionSecret_()));
}

/** currentUser 由来のユーザーからトークンを発行する。 */
function issueSessionToken_(user) {
  var now = Date.now();
  var payload = {
    v: 1,
    uid: String(user.id),
    slug: user.slug,
    tag: user.gamerTag,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + signPayload_(body);
}

/** 定数時間ふうの比較 (早期 return で長さ・位置のヒントを出さない)。 */
function timingSafeEq_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * トークンを検証して { id, slug, gamerTag, exp } を返す。
 * 改ざん・期限切れ・形式不正は null (呼び出し側が auth_failed にする)。
 */
function verifySessionToken_(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!timingSafeEq_(parts[1], signPayload_(parts[0]))) return null;

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (_) {
    return null;
  }
  if (!payload || payload.v !== 1) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (!payload.uid) return null;

  return {
    id: String(payload.uid),
    slug: typeof payload.slug === 'string' ? payload.slug : '',
    gamerTag: typeof payload.tag === 'string' ? payload.tag : '',
    exp: payload.exp,
  };
}

// ── 署名付き state ────────────────────────────────────────────────────
//
// なぜ要るか: 認証の照合値 (nonce) をブラウザに置く方式は、
// X などのアプリ内ブラウザで始めて通常の Safari に戻される経路で必ず失敗する
// (ブラウザ自体が変わるので sessionStorage も localStorage も引き継がれない。
//  2026-08-17 実機確認、失敗ログ 11 件)。
// そこで照合を GAS 側に移す: 認証開始時にここで署名した state を発行し、
// 戻ってきたときに署名と期限を検証する。ブラウザが変わっても通る。
//
// 乗っ取り耐性: セッションが誰になるかは **code だけ** で決まり (start.gg が
// 固定 redirect_uri にしか返さない)、state は「先に進んでよいか」のゲートに過ぎない。
// state を差し替えても他人の code は手に入らないので、なりすましはできない。
// 弱くなるのはログイン CSRF (攻撃者が自分の code を仕込んだ URL を踏ませる) だけで、
// これは **単回使用 + 短い期限** で塞ぐ。ブラウザに nonce が残っていれば
// クライアント側でも従来どおり照合する (二段構え)。
var STATE_TTL_MS = 5 * 60 * 1000;
var STATE_USED_PREFIX = 'st:';

/**
 * state を発行する。payload = { n, r, t, f }。
 *
 * f (flow) を署名に含めるのが要点。戻り先で「投票のログインなのか投稿なのか」を
 * sessionStorage から読んでいたが、アプリ内ブラウザ→別ブラウザで戻る経路では
 * それも引き継がれず、投稿フロー扱いになって「下書きがありません」と出ていた
 * (2026-08-19 実例)。state に載せればブラウザが変わっても判別できる。
 */
function signState_(nonce, returnPath, flow) {
  var payload = {
    n: String(nonce || ''),
    r: String(returnPath || ''),
    f: (flow === 'post') ? 'post' : 'login',
    t: Date.now(),
  };
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + signPayload_(body);
}

/**
 * state を検証して payload を返す。改ざん・期限切れ・使用済みは null。
 *
 * consume=true のときだけ「使用済み」に記録する (単回使用)。
 * 記録は CacheService (期限つき) に置く。永続シートに書かないのは、
 * 認証のたびに行が増えるのを避けるため。キャッシュが飛んだ場合は
 * 「1 回だけ再利用できる」に劣化するが、期限 5 分の範囲に留まる。
 */
function verifyState_(state, consume) {
  if (typeof state !== 'string' || !state || state.length > 4096) return null;
  var parts = state.split('.');
  if (parts.length !== 2) return null;
  if (!timingSafeEq_(parts[1], signPayload_(parts[0]))) return null;

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.t !== 'number') return null;
  var age = Date.now() - payload.t;
  if (age < 0 || age > STATE_TTL_MS) return null;   // 期限切れ / 未来日付

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (_) { cache = null; }
  if (cache) {
    // 署名部分をキーにする (state 全体だとキー長の上限に当たりうる)。
    var key = STATE_USED_PREFIX + parts[1].slice(0, 100);
    if (cache.get(key)) return null;                // 使い回し
    if (consume) cache.put(key, '1', Math.ceil(STATE_TTL_MS / 1000));
  }
  return payload;
}

/**
 * action: "begin_login" — 署名付き state を発行する。
 * 認証前なので誰でも叩ける。返すのは署名済み state だけで、秘密は含まない。
 */
function handleBeginLogin_(req) {
  var nonce = String(req && req.nonce ? req.nonce : '');
  var ret = String(req && req.returnPath ? req.returnPath : '');
  if (nonce.length > 128 || ret.length > 512) {
    return err_('bad_request', 'パラメータが長すぎます。');
  }
  return ok_({ state: signState_(nonce, ret, req && req.flow), ttlMs: STATE_TTL_MS });
}

/**
 * action: "login" — code を検証してセッショントークンを返す。
 * シートには何も書かない (ログインの記録は取らない)。
 */
function handleLogin_(req) {
  if (typeof req.code !== 'string' || req.code.length === 0) {
    return err_('bad_request', '認証コードがありません。');
  }
  // 署名 state の検証 (ここで単回使用にする)。
  if (!verifyState_(req.state, true)) {
    return err_('state_invalid',
      '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、'
      + '同じリンクを二度開いた可能性があります。投票ページからやり直してください。');
  }
  var user;
  {
    var accessToken = exchangeCodeForToken_(req.code);
    if (!accessToken) {
      // 何が起きたのかを可能な範囲で伝える (期限切れ / start.gg 障害 / 通信断)。
      return err_('auth_failed', oauthErrorMessage_(LAST_OAUTH_ERROR));
    }
    user = fetchCurrentUser_(accessToken);
    accessToken = null; // INV-4
  }
  if (!user) {
    return err_('auth_failed', oauthErrorMessage_('no_user'));
  }
  var token = issueSessionToken_(user);
  var sess = verifySessionToken_(token); // exp を取り出すついでに自己検証
  return ok_({
    token: token,
    user: { id: user.id, slug: user.slug, gamerTag: user.gamerTag },
    exp: sess ? sess.exp : null,
  });
}
