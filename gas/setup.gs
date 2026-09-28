/**
 * 初期化補助。Apps Script エディタから手で 1 回だけ実行するもの。
 * Web アプリの経路 (doPost) からは呼ばれない。
 */

/**
 * 投稿用スプレッドシートを新規作成し、posts シートのヘッダを置き、
 * スクリプトプロパティ SHEET_ID に登録する。
 *
 * 作られたファイルは作成者 (= このスクリプトの所有者) のみがアクセスできる。
 * 共有設定はここでも触らない (INV-5)。
 * すでに SHEET_ID がある場合は何もしない (取り違え防止)。
 */
function setupCreateSheet() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('SHEET_ID');
  if (existing) {
    Logger.log('SHEET_ID はすでに設定済みです。作り直す場合は先にプロパティを消してください。');
    return;
  }
  var ss = SpreadsheetApp.create('spsp posts (非公開)');
  var sh = ss.getSheets()[0];
  sh.setName(SHEET_NAME);
  sh.appendRow(SHEET_HEADER);
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('@');
  props.setProperty('SHEET_ID', ss.getId());
  Logger.log('作成しました: ' + ss.getUrl());
}

/**
 * 設定が揃っているかの確認。値そのものは出さず、有無だけを出す (INV-3)。
 * デプロイ後にまずこれを実行して OK を確認する。
 */
function setupCheck() {
  var props = PropertiesService.getScriptProperties();
  var lines = [];
  lines.push('STARTGG_CLIENT_ID (config.gs): ' +
    (STARTGG_CLIENT_ID && STARTGG_CLIENT_ID.indexOf('{{') !== 0 ? 'set' : 'NOT SET'));
  lines.push('STARTGG_CLIENT_SECRET: ' + (props.getProperty('STARTGG_CLIENT_SECRET') ? 'set' : 'NOT SET'));
  lines.push('SHEET_ID: ' + (props.getProperty('SHEET_ID') ? 'set' : 'NOT SET'));
  lines.push('REDIRECT_URI: ' + REDIRECT_URI);

  try {
    var sh = getPostsSheet_();
    lines.push('posts シート: OK (' + sh.getLastRow() + ' 行)');
  } catch (ex) {
    lines.push('posts シート: NG (' + (ex && ex.message ? ex.message : ex) + ')');
  }
  Logger.log(lines.join('\n'));
}
