/**
 * spsp 投稿 API — Web アプリのエントリポイント。
 *
 * クライアントは CORS preflight を避けるため Content-Type: text/plain で
 * JSON 文字列を POST してくる (e.postData.contents をそのまま JSON.parse する)。
 */

/** 成功レスポンス。 */
function ok_(payload) {
  var body = { ok: true };
  for (var k in payload) body[k] = payload[k];
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 失敗レスポンス。
 * code: bad_request / auth_failed / rate_limited / body_invalid / internal
 * スタックトレースや secret は絶対に載せない。
 */
function err_(code, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: code, message: message } }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return err_('bad_request', 'リクエストが空です。');
    }
    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (_) {
      return err_('bad_request', 'リクエストの形式が不正です。');
    }
    if (!req || typeof req !== 'object') {
      return err_('bad_request', 'リクエストの形式が不正です。');
    }

    var action = String(req.action || '');
    var res;
    switch (action) {
      case 'post':
        res = handlePost_(req); break;
      case 'begin_login':
        // 認証開始。署名済み state を配るだけ (秘密は含まない)。
        return handleBeginLogin_(req);    // session.gs
      case 'login':
        res = handleLogin_(req); break;   // session.gs
      case 'vote':
        res = handleVote_(req); break;    // vote.gs
      case 'export_votes':
        // ビルドサーバーの定期取得。失敗しても人手の出番は無いので記録しない。
        return handleExportVotes_(req);   // export.gs (鍵は client secret から導出)
      case 'export_errors':
        // 運営が失敗の原因を調べるための読み出し。記録そのものは残さない。
        return handleExportErrors_(req);  // export.gs
      case 'client_error':
        return handleClientError_(req);   // errlog.gs (記録そのものなので二重に記録しない)
      default:
        return err_('bad_request', '不明な action です。');
    }
    logIfFailed_(action, req, res);
    return res;
  } catch (ex) {
    // 例外は握りつぶさない。ただし内容はクライアントに返さない。
    console.error('doPost failed: ' + (ex && ex.stack ? ex.stack : ex));
    logError_('server', 'doPost', 'exception', '',
      (ex && ex.message) ? String(ex.message) : String(ex));
    return err_('internal', 'サーバー側でエラーが発生しました。');
  }
}

/**
 * ハンドラの応答が失敗なら errors シートに残す。
 *
 * 応答は ContentService の TextOutput なので、中身を読み直して判定する
 * (各ハンドラの return を書き換えずに済ませるため)。
 * user_id は token から引ける場合だけ添える (無ければ空欄)。
 */
function logIfFailed_(action, req, res) {
  var body;
  try {
    body = JSON.parse(res.getContent());
  } catch (_) {
    return;
  }
  if (!body || body.ok !== false || !body.error) return;
  var uid = '';
  if (req && typeof req.token === 'string' && req.token) {
    var sess = verifySessionToken_(req.token);
    if (sess) uid = sess.id;
  }
  // note には利用者に見せたメッセージではなく、内部の手掛かりだけを入れる。
  var note = (action === 'login' || action === 'post') ? String(LAST_OAUTH_ERROR || '') : '';
  logError_('server', action, body.error.code, uid, note);
}

/** GET は使わない。ブラウザで開かれたときの応答だけ返す。 */
function doGet() {
  return err_('bad_request', 'このエンドポイントは POST のみ受け付けます。');
}

/**
 * 投稿本編。
 *
 *   入力検証 → token 交換 → currentUser 照会 → (ロック) スパム判定 → append
 *
 * INV-1: シートに書く名前/ID は currentUser のレスポンス由来のものだけ。
 *        req に user 名等が入っていても一切見ない。
 * INV-2: currentUser が取れなければ何も書かない。
 * INV-4: access token / code はローカル変数のみ。ログにもシートにも出さない。
 */
function handlePost_(req) {
  // ── 1. 入力検証 ──
  if (typeof req.code !== 'string' || req.code.length === 0) {
    return err_('bad_request', '認証コードがありません。');
  }
  if (typeof req.body !== 'string') {
    return err_('body_invalid', '本文がありません。');
  }
  var body = sanitizeBody_(req.body);
  if (body.length < BODY_MIN) {
    return err_('body_invalid', '本文が空です。');
  }
  if (body.length > BODY_MAX) {
    return err_('body_invalid', '本文が長すぎます (' + BODY_MAX + '文字まで)。');
  }

  if (!verifyState_(req.state, true)) {
    return err_('state_invalid',
      '認証の照合に失敗しました。時間が経ちすぎたか、同じリンクを二度開いた可能性があります。'
      + '投稿ページからやり直してください。');
  }

  // ── 2-3. start.gg で本人確認 ──
  var user;
  {
    var accessToken = exchangeCodeForToken_(req.code); // null なら失敗
    if (!accessToken) {
      return err_('auth_failed', oauthErrorMessage_(LAST_OAUTH_ERROR));
    }
    user = fetchCurrentUser_(accessToken);
    accessToken = null; // INV-4: 以降のスコープに残さない
  }
  if (!user) {
    return err_('auth_failed', oauthErrorMessage_('no_user'));
  }

  // ── 4-5. スパム判定と append を直列化 ──
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    return err_('internal', '混み合っています。少し待ってからやり直してください。');
  }
  try {
    var limited = checkRateLimit_(user.id);
    if (limited) {
      return err_('rate_limited', limited);
    }
    appendPost_(user, body);
  } finally {
    lock.releaseLock();
  }

  return ok_({ user: user.slug });
}

/**
 * 制御文字を除去する。HTML タグは残す (表示時にビルド側でエスケープする前提)。
 * 改行とタブは残し、CRLF/CR は LF に正規化する。前後の空白は落とす。
 *
 * 落とすのは C0 (TAB/LF を除く) / DEL / C1。文字クラスの \x エスケープは
 * ファイルに実体の制御文字として混入しやすいので、コード値で判定している。
 */
function sanitizeBody_(s) {
  var t = String(s).replace(/\r\n?/g, '\n');
  var out = '';
  for (var i = 0; i < t.length; i++) {
    var c = t.charCodeAt(i);
    if (c === 9 || c === 10) { out += t.charAt(i); continue; }
    if (c < 32) continue;
    if (c >= 127 && c <= 159) continue;
    out += t.charAt(i);
  }
  return out.trim();
}
