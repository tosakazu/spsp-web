/**
 * spsp 投稿 API — 設定値。
 *
 * 秘匿値 (client secret / シートID) は **コードに書かない**。
 * スクリプトプロパティ (Apps Script エディタ > プロジェクトの設定 > スクリプト プロパティ)
 * に人間が投入する (INV-3)。
 */

/** start.gg アプリの client_id。公開値なのでコードに置いてよい。 */
var STARTGG_CLIENT_ID = '582';

/**
 * 認可時に使った redirect_uri と完全一致していないと token 交換が失敗する。
 * GitHub Pages のみ。spsp.games は検証/ビルド用でユーザーには出さないため登録しない。
 */
var REDIRECT_URI = 'https://tosakazu.github.io/spsp/callback.html';

/** developer.start.gg/docs/oauth/ の記載どおり。authorize 側は api. が付かない点に注意。 */
var TOKEN_URL = 'https://api.start.gg/oauth/access_token';
var GQL_URL = 'https://api.start.gg/gql/alpha';

/** 認可リクエストと token 交換で同じ値を送る必要がある。 */
var SCOPE = 'user.identity';

/** 本文の長さ (UTF-16 code unit 数。クライアントの textarea maxlength と同じ数え方)。 */
var BODY_MIN = 1;
var BODY_MAX = 1000;

/** スパム制御。 */
var RATE_MIN_INTERVAL_MS = 60 * 1000; // 同一ユーザーの連投間隔
var RATE_MAX_PER_DAY = 10;            // 同一ユーザーの当日投稿数
var RATE_SCAN_ROWS = 500;             // 末尾から遡って見る行数

var SHEET_NAME = 'posts';
var SHEET_HEADER = ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'body', 'status'];

/** キャラ投票シート。 */
// 失敗の記録先。成功はそれぞれのシートに残るが、失敗はどこにも残らず
// 「認証エラーになる」と言われても原因が追えなかったため追加 (2026-08-16)。
// 個人を特定できる情報 (gamer_tag / slug / 本文 / キャラ) は書かない。
var ERRORS_SHEET_NAME = 'errors';
var ERRORS_HEADER = ['timestamp', 'source', 'action', 'code', 'user_id', 'note'];
// 無制限に伸ばさない。超えたら古い行から間引く。
var ERRORS_MAX_ROWS = 3000;
var ERRORS_TRIM_TO = 2000;

var VOTES_SHEET_NAME = 'char_votes';
var VOTES_HEADER = ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'char_id', 'char_name', 'status'];

/**
 * 資格判定・キャラ一覧の読み出し先 (= 公開データ)。
 * 2026-09-28: 旧サイト (gh-pages) は spsp.games への転送ページに切り替えるので、spsp.games と同じデータの置き場 (R2) を読む。
 * nightly が 3h おきに同期するので、ビルド反映と同じ鮮度で判定される。
 */
var DATA_BASE_URL = 'https://data.spsp.games/jp';

/**
 * ダブルメイン圏の判定閾値。players/<uid>.json の characters[].pct (使用率, 0..1) で、
 * トップとの差がこの値以内のキャラが 2 体以上いれば「どちらがメインか僅差」とみなし、
 * その候補の中からの投票を許す。
 * ビルド側の採用規則 (docs/post_feature_design.md §12): 後の大会でのキャラ使用の結果、
 * この圏を超えて明確なメインが出たら、投票ではなく使用実績を採用する。
 * クライアント (site/js/post_config.js) と同じ値にすること (テストが検査する)。
 */
var DOUBLE_MAIN_PCT_GAP = 0.20;

/**
 * ビルドサーバー向けエクスポート (export.gs) の鍵を導出するときのラベル。
 *
 * 鍵そのものは持たず、**既存の STARTGG_CLIENT_SECRET から HMAC で導出**する
 * (= 新しいスクリプトプロパティを人手で投入しなくてよい)。ラベルで用途を分けて
 * いるので、導出鍵が漏れても他の用途に使い回せないし、HMAC は一方向なので
 * 元の client secret も復元できない。
 * ビルド側 (build/fetch_char_votes.py) が同じラベルで同じ値を導出する。
 * 変えると両方が揃うまでエクスポートが auth_failed になる (= 静かに壊れない)。
 */
var EXPORT_KEY_LABEL = 'spsp:export_votes:v1';

/**
 * セッショントークン (ログイン) の有効期間。
 * セキュリティ要件の高いサービスではないので長め (半年) でよい (2026-08-14 ユーザー判断)。
 */
var SESSION_TTL_MS = 180 * 24 * 3600 * 1000; // 180 日

/**
 * スクリプトプロパティを取得する。未設定なら例外 (呼び出し側が internal で返す)。
 * 値そのものはログにもレスポンスにも出さない (INV-3)。
 */
function requireProp_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) {
    throw new Error('script property not set: ' + name);
  }
  return v;
}

/** client_id のプレースホルダ置き換え漏れを起動時に弾く。 */
function requireClientId_() {
  if (!STARTGG_CLIENT_ID || STARTGG_CLIENT_ID.indexOf('{{') === 0) {
    throw new Error('STARTGG_CLIENT_ID is not configured in config.gs');
  }
  return STARTGG_CLIENT_ID;
}
