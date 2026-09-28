/**
 * ビルドサーバー向けのエクスポート — char_votes をビルドに渡す唯一の口。
 *
 * シートは非公開なので、ビルド側 (build/fetch_char_votes.py) はこの API 経由で読む。
 *
 * 公開範囲の原則:
 *   - 返すのは **ビルドが判定に使う列だけ** (timestamp / user_id / char_id /
 *     char_name / status)。user_slug と gamer_tag は返さない (漏れる面を狭くする)。
 *   - status='debug' の行はここで落とす (= 撤去したデバッグモードが書いたもの。
 *     シートからは掃除済みだが、念のため残してある)。ビルド側も採用しない。
 *   - 鍵が一致しない限り何も返さない。Web アプリは ANYONE_ANONYMOUS なので、
 *     鍵が唯一の防壁になる。鍵は保存せず、既存の STARTGG_CLIENT_SECRET から
 *     ラベル付き HMAC で導出する (config.gs の EXPORT_KEY_LABEL)。
 *
 * 差分取得: `since` (ISO 8601 の文字列) を渡すと **その時刻以降**の行だけ返す。
 * 境界は「以降」(>=) にしてある。タイムスタンプは秒単位なので、`>` にすると
 * 同じ秒に別々のユーザーが投票したときに片方を永久に取りこぼす。重複はビルド側で
 * (ts, user_id, char_id) をキーに畳む。
 * `since` を渡さなければ全行返す。
 */

/**
 * エクスポート鍵を導出する。
 *
 *   base64url( HMAC-SHA256(key = STARTGG_CLIENT_SECRET, msg = EXPORT_KEY_LABEL) )
 *
 * 末尾の '=' は落とす (ビルド側と揃える)。STARTGG_CLIENT_SECRET が未設定なら
 * requireProp_ が投げ、doPost が internal で返す (= 鍵無しで通してしまわない)。
 */
function exportKey_() {
  var sig = Utilities.computeHmacSha256Signature(
    EXPORT_KEY_LABEL, requireProp_('STARTGG_CLIENT_SECRET'));
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

/** 長さと内容を最後まで比べる (= 先頭一致で早期 return しない)。 */
function keyMatches_(given, expected) {
  var a = String(given === undefined || given === null ? '' : given);
  var b = String(expected);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < b.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * action: "export_votes" — { key, since? }
 *
 * 成功: { ok:true, votes:[{ts,userId,charId,charName,status}...],
 *         total:<シートのデータ行数>, since:<エコー> }
 *   total は since で絞る前のデータ行数。ビルドはこれが前回より減っていたら
 *   「行が消された」と判断して全件取り直す (差分だけでは削除を追えないため)。
 * 失敗: auth_failed / internal
 */
function handleExportVotes_(req) {
  if (!keyMatches_(req && req.key, exportKey_())) {
    return err_('auth_failed', 'エクスポート鍵が違います。');
  }
  var since = (req && typeof req.since === 'string') ? req.since : '';

  var sh = getVotesSheet_();
  var last = sh.getLastRow();
  if (last < 2) return ok_({ votes: [], total: 0, since: since });   // ヘッダのみ

  // A..G = timestamp / user_id / user_slug / gamer_tag / char_id / char_name / status
  var rows = sh.getRange(2, 1, last - 1, VOTES_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var status = String(r[6] || '');
    if (status === 'debug') continue;                  // デバッグ投票は渡さない
    var userId = String(r[1] || '');
    var charId = String(r[4] || '');
    if (!userId || !charId) continue;                  // 壊れた行は渡さない
    var ts = isoOf_(r[0]);
    if (since && ts < since) continue;                 // 差分 (境界は以降 = 取りこぼさない)
    out.push({
      ts: ts,
      userId: userId,
      charId: charId,
      charName: String(r[5] || ''),
      status: status,
    });
  }
  return ok_({ votes: out, total: rows.length, since: since });
}

/**
 * action: "export_errors" — errors シートを読む (運営が原因を調べるため)。
 *
 * 鍵は export_votes と同じ導出鍵。中身は種別と uid だけで個人情報は入っていないが、
 * 誰でも読めてよいものではないので同じ鍵で守る。
 *   req.limit : 末尾から何行返すか (既定 100 / 上限 1000)
 */
function handleExportErrors_(req) {
  if (!keyMatches_(req && req.key, exportKey_())) {
    return err_('auth_failed', 'エクスポート鍵が違います。');
  }
  var limit = Number(req && req.limit);
  if (!isFinite(limit) || limit <= 0) limit = 100;
  limit = Math.min(limit, 1000);

  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(ERRORS_SHEET_NAME);
  if (!sh) return ok_({ errors: [], total: 0 });      // まだ 1 件も失敗していない
  var last = sh.getLastRow();
  if (last < 2) return ok_({ errors: [], total: 0 });

  var n = Math.min(limit, last - 1);
  var start = last - n + 1;                            // 末尾 n 行 (新しい順に見たいので)
  var rows = sh.getRange(start, 1, n, ERRORS_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      ts: isoOf_(r[0]),
      source: String(r[1] || ''),
      action: String(r[2] || ''),
      code: String(r[3] || ''),
      userId: String(r[4] === null || r[4] === undefined ? '' : r[4]),
      note: String(r[5] || ''),
    });
  }
  return ok_({ errors: out, total: last - 1 });
}

/**
 * セルの値を ISO 8601 文字列にする。
 * A 列は書式なしテキストにしてあるが、既存行が日時値になっていた場合にも備える。
 */
function isoOf_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(v || '');
}
