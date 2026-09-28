/**
 * キャラ投票 — 本人のメインキャラ 1 体を報告する。
 *
 * 投票できる条件 (すべて満たすこと。理由はクライアントにも明示される):
 *   1. start.gg の選手認証 (セッショントークン) が有効
 *   2. SPSP にデータがある選手 (players/<uid>.json が存在する)
 *   3. 使用キャラ情報が無いか、ダブルメイン圏 (= メイン判定が僅差)
 *
 * 判定は投稿時に GAS が公開データ (DATA_BASE_URL) を読んで行う。
 * 資格がある間は再投票可 (上書き)。ビルド側は uid ごとに最新行を採用する想定。
 */

/**
 * キャラ一覧 { id: name } を返す。取得失敗は null (internal 扱い)。
 * char_emoji.json が正 (Random 等の集計対象外はそもそも載っていない)。
 */
function fetchCharList_() {
  var res;
  try {
    res = UrlFetchApp.fetch(DATA_BASE_URL + '/data/char_emoji.json', { muteHttpExceptions: true });
  } catch (ex) {
    console.error('char list fetch threw: ' + (ex && ex.message ? ex.message : ex));
    return null;
  }
  if (res.getResponseCode() !== 200) {
    console.error('char list fetch failed: HTTP ' + res.getResponseCode());
    return null;
  }
  var json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (_) {
    return null;
  }
  var out = {};
  for (var id in json) {
    if (json[id] && typeof json[id].name === 'string') out[id] = json[id].name;
  }
  return out;
}

/**
 * characters から「投票できる候補」を返す。
 *   null           → 使用実績が無い (全キャラから選べる)
 *   []             → 明確なメインがいる (投票不可)
 *   [{id,name}..]  → ダブルメイン圏 (この中からのみ投票可。必ず 2 体以上)
 *
 * - 基準は **最大 pct** (先頭ではない)。ビルドが投票採用で並びを変えるため、
 *   characters[0] が最大 pct とは限らない。
 * - pct を持たないエントリ (= 投票由来。ビルドが使用実績ゼロの人に足したもの) は
 *   実績として数えない。実績が 1 つも無ければ null (= 再投票可)。
 */
function voteCandidates_(chars) {
  if (!chars || !chars.length) return null;
  var measured = [];
  for (var i = 0; i < chars.length; i++) {
    var p = Number(chars[i] && chars[i].pct);
    if (isFinite(p) && chars[i].id !== undefined && chars[i].id !== null) {
      measured.push({ id: String(chars[i].id), name: String(chars[i].name || ''), pct: p });
    }
  }
  if (!measured.length) return null; // 投票由来のみ = 実績なし扱い
  var top = -Infinity;
  measured.forEach(function (c) { if (c.pct > top) top = c.pct; });
  var out = measured.filter(function (c) { return top - c.pct <= DOUBLE_MAIN_PCT_GAP; })
    .map(function (c) { return { id: c.id, name: c.name }; });
  return out.length >= 2 ? out : [];
}

/**
 * 投票資格を判定する。
 * { ok: true, candidates: null | [{id,name}...] } か { ok: false, code, message }。
 * candidates が配列なら「ダブルメイン圏」= その中からのみ投票できる。
 */
function checkVoteEligibility_(uid) {
  var res;
  try {
    res = UrlFetchApp.fetch(
      DATA_BASE_URL + '/players/' + encodeURIComponent(uid) + '.json',
      { muteHttpExceptions: true });
  } catch (ex) {
    console.error('player fetch threw: ' + (ex && ex.message ? ex.message : ex));
    return { ok: false, code: 'internal', message: '選手データの取得に失敗しました。時間をおいてやり直してください。' };
  }
  var status = res.getResponseCode();
  if (status === 404) {
    return { ok: false, code: 'not_player',
      message: 'キャラ投票は SPSP にデータがある選手のみ行えます。' };
  }
  if (status !== 200) {
    console.error('player fetch failed: HTTP ' + status);
    return { ok: false, code: 'internal', message: '選手データの取得に失敗しました。時間をおいてやり直してください。' };
  }
  var rec;
  try {
    rec = JSON.parse(res.getContentText());
  } catch (_) {
    return { ok: false, code: 'internal', message: '選手データの取得に失敗しました。時間をおいてやり直してください。' };
  }
  var candidates = voteCandidates_(rec && rec.characters);
  if (candidates && candidates.length === 0) {
    return { ok: false, code: 'char_exists',
      message: 'すでに使用キャラのデータがあり、メインキャラが明確なため投票できません (投票できるのは、キャラ情報が無い選手か、メインキャラ判定が僅差の選手のみです)。' };
  }
  return { ok: true, candidates: candidates };
}

/**
 * action: "vote" — { token, charId }
 *
 * 2026-08-14: ページの公開に合わせてデバッグモード (?debug=1) は撤去した。
 * 認証・資格判定を飛ばせる経路は残さない。過去に書かれた status='debug' の行は
 * シートに残っているので、エクスポート (export.gs) と採用 (v4/char_vote.py) の
 * 除外は残してある。
 */
function handleVote_(req) {
  // ── 1. 本人確認 (セッション) ──
  var sess = verifySessionToken_(req.token);
  if (!sess) {
    return err_('auth_failed', 'ログインが無効か期限切れです。もう一度認証してください。');
  }

  // ── 2. 入力検証 ──
  var charId = String(req.charId === undefined || req.charId === null ? '' : req.charId);
  if (!/^\d{1,8}$/.test(charId)) {
    return err_('bad_request', 'キャラの指定が不正です。');
  }
  var chars = fetchCharList_();
  if (!chars) {
    return err_('internal', 'キャラ一覧の取得に失敗しました。時間をおいてやり直してください。');
  }
  var charName = chars[charId];
  if (!charName) {
    return err_('bad_char', 'そのキャラは選択できません。');
  }

  // ── 3. 資格判定 (INV-1: uid はトークン=currentUser 由来のみ) ──
  var elig = checkVoteEligibility_(sess.id);
  if (!elig.ok) {
    return err_(elig.code, elig.message);
  }
  // ダブルメイン圏なら、候補の中からしか選べない
  if (elig.candidates) {
    var isCandidate = elig.candidates.some(function (c) { return c.id === charId; });
    if (!isCandidate) {
      var names = elig.candidates.map(function (c) { return c.name; }).join(' / ');
      return err_('not_candidate',
        'メインキャラ判定が僅差の ' + names + ' の中から選んでください。');
    }
  }

  // ── 4. 連投制御と append ──
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    return err_('internal', '混み合っています。少し待ってからやり直してください。');
  }
  try {
    var limited = checkRateLimitOn_(getVotesSheet_(), sess.id);
    if (limited) {
      return err_('rate_limited', limited);
    }
    appendVote_(sess, charId, charName);
  } finally {
    lock.releaseLock();
  }

  return ok_({ user: sess.slug, charId: charId, charName: charName });
}

/** 1 行追記。status は常に 'pending' (以降は人間が書き換えうる。GAS は読まない)。 */
function appendVote_(user, charId, charName) {
  getVotesSheet_().appendRow(
    [nowIsoJst_(), user.id, user.slug, user.gamerTag, charId, charName, 'pending']);
}
