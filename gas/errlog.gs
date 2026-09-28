/**
 * 失敗の記録 (errors シート)。
 *
 * 成功は posts / char_votes に残るが、失敗はどこにも残らなかった。
 * 「認証エラーになる」と言われても、こちらからは種別すら分からない状態だったため追加。
 *
 * 書くのは原因の切り分けに要る最小限だけ:
 *   timestamp / source (server|client) / action / code / user_id / note
 *
 * 絶対に書かないもの:
 *   OAuth code, access token, セッショントークン, client secret,
 *   gamer_tag / slug (誰が失敗したかは user_id だけで足りる), 投稿本文, 選んだキャラ。
 */

/** クライアントから受け付けるエラー種別。ここに無いものは記録しない (詰め込み防止)。 */
var CLIENT_ERROR_KINDS = {
  account_mismatch: 1,   // 選んだ選手と認証アカウントが違う (最頻)
  oauth_denied: 1,       // start.gg 側で許可しなかった
  oauth_error: 1,        // start.gg が error= を返した
  state_missing: 1,      // 照合情報がブラウザに残っていない
  state_mismatch: 1,     // 照合に失敗
  no_code: 1,            // code/state が返ってこなかった
  login_failed: 1,       // GAS の login が失敗 (server 側にも残るが経路確認用)
  network: 1             // fetch 自体が失敗
};

var ERRLOG_NOTE_MAX = 200;

function getErrorsSheet_() {
  return getDataSheet_(ERRORS_SHEET_NAME, ERRORS_HEADER);
}

/**
 * 1 行追記。記録に失敗しても本来の応答は返す (ログのために処理を落とさない)。
 * uid は数値化できないときは空欄。note は長さを切る。
 */
function logError_(source, action, code, uid, note) {
  try {
    var sh = getErrorsSheet_();
    var n = Number(uid);
    sh.appendRow([
      nowIsoJst_(),
      String(source || '').slice(0, 16),
      String(action || '').slice(0, 32),
      String(code || '').slice(0, 48),
      (isFinite(n) && n > 0) ? n : '',
      String(note === undefined || note === null ? '' : note).slice(0, ERRLOG_NOTE_MAX)
    ]);
    trimErrorsSheet_(sh);
  } catch (ex) {
    console.error('logError_ failed: ' + (ex && ex.message ? ex.message : ex));
  }
}

/** 行数が上限を超えたら古い行から削る (ヘッダは残す)。 */
function trimErrorsSheet_(sh) {
  var last = sh.getLastRow();
  if (last <= ERRORS_MAX_ROWS) return;
  var drop = last - ERRORS_TRIM_TO;
  if (drop > 0) sh.deleteRows(2, drop);   // 1 行目 = ヘッダ
}

/**
 * action: "client_error" — ブラウザ側でしか観測できない失敗を記録する。
 *
 * 認証前の失敗 (キャンセル / 照合失敗) や、アカウント不一致は GAS を通らないので、
 * クライアントから報告してもらわないと永久に見えない。
 *
 * 誰でも叩ける経路なので、種別は白リストで縛り、note は長さを切り、
 * シート自体にも行数上限を設けている。token があれば uid を添える
 * (無くても記録はする — 認証前の失敗こそ知りたいため)。
 */
function handleClientError_(req) {
  var kind = String(req.kind === undefined || req.kind === null ? '' : req.kind);
  if (!CLIENT_ERROR_KINDS[kind]) {
    // 未知の種別は黙って捨てる (エラーにはしない。報告のために画面を壊さない)
    return ok_({ logged: false });
  }
  var uid = '';
  if (typeof req.token === 'string' && req.token) {
    var sess = verifySessionToken_(req.token);
    if (sess) uid = sess.id;
  }
  logError_('client', String(req.flow || 'vote').slice(0, 16), kind, uid, req.note);
  return ok_({ logged: true });
}
