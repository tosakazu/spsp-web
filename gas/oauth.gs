/**
 * start.gg OAuth2 — 認可コードの交換と本人照会。
 *
 * 実装時に https://developer.start.gg/docs/oauth/ を参照して確認したこと (2026-08-13):
 *   - token エンドポイントは POST https://api.start.gg/oauth/access_token
 *   - **Content-Type: application/json** で、パラメータは JSON body に入れる
 *     (form-encoded ではない)
 *   - body のキーは grant_type / client_id / client_secret / code / scope / redirect_uri
 *   - 応答は { access_token, token_type: "Bearer", expires_in, refresh_token }
 *   - 認可 URL のホストは api. が付かない https://start.gg/oauth/authorize
 * refresh token は使わない (1 回きりの本人確認なので破棄する。INV-4)。
 */

/**
 * 認可コードを access token に交換する。
 * 失敗したら null を返す (呼び出し側が auth_failed にする)。
 * code / secret / token は一切ログに出さない (INV-3 / INV-4)。
 */
// 直近の OAuth 失敗理由 (呼び出し側がメッセージを出し分けるためだけに使う)。
// 秘密は入れない。'code_invalid' | 'startgg_down' | 'network' | 'exchange_failed' | 'no_user'
var LAST_OAUTH_ERROR = null;

/** 失敗理由に応じた利用者向けメッセージ。原因が分からないときは汎用文。 */
function oauthErrorMessage_(reason) {
  switch (reason) {
    case 'code_invalid':
      return 'start.gg の認証情報が期限切れか、既に使用済みでした。'
        + 'ブラウザの「戻る」で認証画面に戻った場合や、認証してから時間が経った場合に起きます。'
        + 'もう一度最初から認証し直してください。';
    case 'auth_rejected':
      return 'start.gg に認証を拒否されました。'
        + '認証情報が期限切れか使用済みだった可能性が高いので、まずは最初からやり直してください。'
        + '何度やっても同じ場合は SPSP 側の設定の問題かもしれないので、X (@smash_tskz) までご連絡ください。';
    case 'startgg_down':
      return 'start.gg 側から正しい応答が返りませんでした。'
        + 'start.gg が混雑・障害中の可能性があります。時間をおいてやり直してください。';
    case 'network':
      return 'start.gg に接続できませんでした。時間をおいてやり直してください。';
    case 'no_user':
      return 'start.gg のアカウント情報を読み取れませんでした。'
        + 'start.gg にログインし直してから、もう一度お試しください。';
    default:
      return 'start.gg の認証に失敗しました。時間をおいてやり直してください。';
  }
}

function exchangeCodeForToken_(code) {
  LAST_OAUTH_ERROR = null;
  var payload = {
    grant_type: 'authorization_code',
    client_id: requireClientId_(),
    client_secret: requireProp_('STARTGG_CLIENT_SECRET'),
    code: code,
    scope: SCOPE,
    redirect_uri: REDIRECT_URI
  };

  var res;
  try {
    res = UrlFetchApp.fetch(TOKEN_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (ex) {
    console.error('token exchange threw: ' + (ex && ex.message ? ex.message : ex));
    LAST_OAUTH_ERROR = 'network';
    return null;
  } finally {
    payload.client_secret = null; // INV-3
    payload.code = null;
  }

  var status = res.getResponseCode();
  if (status !== 200) {
    // 本文には code が反射される可能性があるのでステータスだけ記録する。
    console.error('token exchange failed: HTTP ' + status);
    // 4xx = こちら/利用者側の問題 (期限切れ・使い回し・設定ミス)、
    // 5xx = start.gg 側の障害。原因の粒度が違うので呼び出し側に伝える。
    // 401/403 は「code が無効」と「アプリ設定/遮断」の両方がありうるので分けておく
    // (start.gg は無効な認証情報に 403 を返すことがある。2026-08-16 実測)。
    LAST_OAUTH_ERROR = (status === 401 || status === 403) ? 'auth_rejected'
      : (status >= 400 && status < 500) ? 'code_invalid'
      : (status >= 500) ? 'startgg_down'
      : 'exchange_failed';
    return null;
  }

  var json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (_) {
    console.error('token exchange: response was not JSON');
    LAST_OAUTH_ERROR = 'startgg_down';
    return null;
  }
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    // start.gg は無効な code でも HTTP 200 を返し、本文側にだけ error を入れることがある
    // (2026-08-16 実測: 400/401/403 のどれにもならなかった)。本文の error を見る。
    // error は OAuth 2.0 の定型コードなのでログに出しても秘密は漏れない。
    var oe = (json && typeof json.error === 'string') ? json.error : '';
    console.error('token exchange: access_token missing' + (oe ? ' (error=' + oe + ')' : ''));
    LAST_OAUTH_ERROR = (oe === 'invalid_client' || oe === 'unauthorized_client') ? 'auth_rejected'
      : 'code_invalid';   // invalid_grant / 本文に手掛かり無し = code が無効か使用済み
    return null;
  }
  return json.access_token;
}

/**
 * access token の持ち主を照会する。
 * 返り値 { id, slug, gamerTag } / 取れなければ null (INV-2)。
 *
 * ここで返ってきた値だけがシートに書かれる (INV-1)。
 */
function fetchCurrentUser_(accessToken) {
  var query = 'query { currentUser { id slug player { gamerTag } } }';

  var res;
  try {
    res = UrlFetchApp.fetch(GQL_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: JSON.stringify({ query: query }),
      muteHttpExceptions: true
    });
  } catch (ex) {
    console.error('currentUser threw: ' + (ex && ex.message ? ex.message : ex));
    return null;
  }

  if (res.getResponseCode() !== 200) {
    console.error('currentUser failed: HTTP ' + res.getResponseCode());
    return null;
  }

  var json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (_) {
    console.error('currentUser: response was not JSON');
    return null;
  }
  if (json && json.errors) {
    console.error('currentUser: GraphQL errors');
    return null;
  }

  var u = json && json.data && json.data.currentUser;
  if (!u || u.id === null || u.id === undefined || u.id === '') {
    console.error('currentUser: null');
    return null; // INV-2
  }

  return {
    id: String(u.id),
    slug: typeof u.slug === 'string' ? u.slug : '',
    gamerTag: (u.player && typeof u.player.gamerTag === 'string') ? u.player.gamerTag : ''
  };
}
