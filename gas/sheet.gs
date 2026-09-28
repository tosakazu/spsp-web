/**
 * 非公開スプレッドシートへの追記とスパム判定。
 *
 * INV-5: 共有設定は一切いじらない。ここには setSharing 系を書かないこと。
 */

// 1 実行のなかでシート取得は複数回呼ばれる (スパム判定 → append)。
// Apps Script はリクエストごとに実行コンテキストを作り直すので、
// このキャッシュは 1 リクエスト内でしか生きない。
var _ss = null;
var _sheetCache = {};

function getSpreadsheet_() {
  if (!_ss) _ss = SpreadsheetApp.openById(requireProp_('SHEET_ID'));
  return _ss;
}

/** 名前のシートを返す。無ければヘッダ付きで作る (共有設定には触れない)。 */
function getDataSheet_(name, header) {
  if (_sheetCache[name]) return _sheetCache[name];

  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    // A 列を書式なしテキストにしておく。ISO 8601 文字列を Sheets が日時値に
    // 変換してしまうと、ビルド側が読む型が変わってしまうため。
    // **作成時の 1 回だけ**。毎回やると書き込み操作が 1 回増え、
    // 何も追記していないリクエストでもシートの更新時刻が動いてしまう。
    sh.getRange('A:A').setNumberFormat('@');
  }
  _sheetCache[name] = sh;
  return sh;
}

function getPostsSheet_() { return getDataSheet_(SHEET_NAME, SHEET_HEADER); }
function getVotesSheet_() { return getDataSheet_(VOTES_SHEET_NAME, VOTES_HEADER); }

/**
 * 直近の投稿からスパム判定する (posts シート)。
 * 制限に掛かったら日本語のメッセージを、問題なければ null を返す。
 * 呼び出し側が ScriptLock を保持している前提。
 */
function checkRateLimit_(userId) {
  return checkRateLimitOn_(getPostsSheet_(), userId);
}

/** シートを指定して連投判定する。A=timestamp / B=user_id の列並びが前提。 */
function checkRateLimitOn_(sh, userId) {
  var last = sh.getLastRow();
  if (last < 2) return null; // ヘッダのみ

  var count = Math.min(RATE_SCAN_ROWS, last - 1);
  var start = last - count + 1;
  // A: timestamp, B: user_id
  var rows = sh.getRange(start, 1, count, 2).getValues();

  var now = Date.now();
  var today = todayKeyJst_();
  var todayCount = 0;
  var seenLatest = false; // このユーザーの最新行を見たか (連投判定は最新行とだけ比べる)

  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) !== String(userId)) continue;

    var ts = rows[i][0];
    if (!seenLatest) {
      seenLatest = true;
      var ms = parseTimestamp_(ts);
      if (ms !== null && now - ms < RATE_MIN_INTERVAL_MS) {
        return '投稿の間隔が短すぎます。1分ほど待ってからやり直してください。';
      }
    }
    if (dayKeyOf_(ts) === today) {
      todayCount++;
      if (todayCount >= RATE_MAX_PER_DAY) {
        return '本日の投稿数の上限 (' + RATE_MAX_PER_DAY + '件) に達しました。';
      }
    }
  }
  return null;
}

/**
 * 1 行追記する。INV-1: user は currentUser 由来のオブジェクトのみ。
 * status は常に 'pending' (以降は人間/ビルド側が書き換える。GAS は読まない)。
 */
function appendPost_(user, body) {
  var sh = getPostsSheet_();
  sh.appendRow([nowIsoJst_(), user.id, user.slug, user.gamerTag, body, 'pending']);
}

/** ISO 8601 (JST, 例 2026-08-13T23:45:01+09:00)。 */
function nowIsoJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** JST の yyyy-MM-dd。 */
function todayKeyJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * セルの値を epoch ms にする。Sheets が日時値に変換していた場合にも備える。
 * 解釈できなければ null。
 */
function parseTimestamp_(v) {
  if (v instanceof Date) return v.getTime();
  var ms = Date.parse(String(v));
  return isNaN(ms) ? null : ms;
}

/** セルの値の JST 日付キー (yyyy-MM-dd)。解釈できなければ空文字。 */
function dayKeyOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  var s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}
