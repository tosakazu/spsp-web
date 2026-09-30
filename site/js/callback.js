// callback.js — start.gg からの戻り先。処理順は設計書 §5.2 のとおり厳守する。
//
//   1. code / state を読む
//   2. すぐ URL からクエリを消す (INV-6)
//   3. state の nonce を検証。不一致なら GAS に送らない
//   4. 下書きを取り出す
//   5. GAS に POST
//   6. 成否に応じて戻る
//
// このファイルとページには外部リソースを一切足さないこと (INV-8)。
// nav.js は Google Analytics を読み込むので、ここでは**読まない**。
import SpspAuth from './auth.js';
import './html.js';   // SPSP.pageHref (ページ間リンクの形)。読めない環境 (テストの vm) では .html のまま
import SPSPI18n from './i18n.js';
import SpspOAuthState from './oauth_state.js';
import SPSP_POST_CONFIG from './post_config.js';
import SPSPLogo from '../logo.js';   // 処理中のロゴ (外部リソースなし。INV-8)
import SpspLogin from './login.js';
import { CHALLONGE_TOKEN_KEY } from './class_bracket.js';   // 下位クラス作成の Challonge ログイン (challonge フロー)   // 失敗したときの「もう一度ログイン」(元のページを戻り先にして start.gg へ)
(function () {
  'use strict';
  var i18n = function (k, p) { return SPSPI18n.t(k, p); };   // 文言 (i18n/ja.js、js/i18n.js を先に読む)

  var CFG = SPSP_POST_CONFIG;
  var S = SpspOAuthState;
  var AUTH = SpspAuth;

  /**
   * 処理中の表示: 流れに合わせた文言 (ログイン中… / 投稿処理中…) と SPSP のロゴ (再生)。
   * ロゴの見た目は logo.css。このページの CSP は外部の CSS を読まないので、同じサイトから fetch して <style> で入れる
   * (connect-src 'self' と style-src 'unsafe-inline' の範囲。INV-8 の「外部リソースなし」はそのまま)。
   */
  function showBusy(flow) {
    var msg = document.getElementById('cb-busy-msg');
    var text = flow === 'post' ? i18n('callback.busy_post') : i18n('callback.busy_login');
    if (msg) msg.textContent = text;
    document.title = text + ' | SPSP';
    var logo = document.getElementById('cb-logo');
    if (!logo || !SPSPLogo || typeof fetch !== 'function') return;
    fetch(new URL('logo.css', location.href).toString()).then(function (r) { return r.ok ? r.text() : ''; }).then(function (css) {
      if (!css || !document.getElementById('cb-logo')) return;   // もう結果の表示に変わっていたら出さない
      var st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
      SPSPLogo.inline(logo, { sub: true });
    }).catch(function () { /* ロゴが出なくても処理は続ける */ });
  }

  /**
   * @param {string} kind @param {string} title @param {string} [detail] @param {string} [backPath]
   * @param {boolean} [retry] true なら「もう一度ログイン」ボタン (戻り先 = backPath) も出す
   */
  function show(kind, title, detail, backPath, retry) {
    var root = document.getElementById('cb-root');
    root.className = 'cb ' + kind;

    var h = document.createElement('p');
    h.className = 'cb-title';
    h.textContent = title;

    root.textContent = '';
    root.appendChild(h);

    if (detail) {
      var d = document.createElement('p');
      d.className = 'cb-detail';
      d.textContent = detail; // textContent なので本文由来の文字列でも安全
      root.appendChild(d);
    }
    if (backPath) {
      var a = document.createElement('a');
      a.className = 'cb-back';
      a.href = backPath;
      // ラベルは実際の戻り先に合わせる (投票 / 投稿 / サイトのトップ / それ以外 = 元のページ)
      a.textContent = backPath.indexOf('vote') >= 0 ? i18n('callback.s1')
        : backPath.indexOf('post') >= 0 ? i18n('callback.s2')
        : backPath === CFG.CANONICAL_BASE ? i18n('callback.back_top')
        : i18n('callback.back');
      if (retry) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cb-retry';
        b.textContent = i18n('callback.retry');
        b.addEventListener('click', function () {
          b.disabled = true;
          SpspLogin.startLogin(backPath).then(function (ok) { if (!ok) b.disabled = false; });
        });
        root.appendChild(b);
      }
      root.appendChild(a);
    }
  }

  /**
   * 認証前の失敗はここでしか観測できない (GAS を通らない) ので、記録だけ送る。
   * 送るのは種別と短い手掛かりのみ。code / token は絶対に載せない。
   */
  function reportError(kind, note) {
    try {
      if (!CFG || !CFG.GAS_ENDPOINT) return;
      fetch(CFG.GAS_ENDPOINT, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'client_error', flow: 'callback', kind: kind, note: note || '',
        }),
      }).catch(function () { /* 記録できなくても画面は出す */ });
    } catch (_) { /* 同上 */ }
  }

  /** start.gg が返した OAuth エラーを、利用者が次にとれる行動に翻訳する。 */
  function describeOAuthError(code, desc) {
    var base;
    switch (code) {
      case 'invalid_scope':
      case 'unauthorized_client':
      case 'invalid_client':
        base = i18n('callback.s3');
        break;
      case 'server_error':
      case 'temporarily_unavailable':
        base = i18n('callback.s4');
        break;
      case 'invalid_request':
        base = i18n('callback.s5')
          + i18n('callback.s6');
        break;
      default:
        base = i18n('callback.s7') + code + i18n('callback.s8')
          + i18n('callback.s9');
    }
    // start.gg が説明文を付けてきたときは併記する (原因の特定に役立つため)
    return desc ? base + '\n\n(start.gg からの説明: ' + desc + ')' : base;
  }

  function run() {
    // ── 1. 取得 ──
    var params = new URLSearchParams(location.search);
    var code = params.get('code');
    var state = params.get('state');
    var oauthError = params.get('error');
    var oauthErrorDesc = params.get('error_description');

    // ── 2. INV-6: 何をするより先に URL から code を消す ──
    history.replaceState(null, '', location.pathname);

    // 処理中の表示 (state の flow で文言を分ける。検証は下でする。ここは表示だけ)
    var st0 = state ? S.decodeState(state) : null;
    if (!oauthError && code) showBusy(st0 && st0.f);

    // 戻り先が分からないとき (state が読めない・start.gg から情報なしで開かれた) はサイトのトップ
    var backDefault = CFG.CANONICAL_BASE;

    if (oauthError) {
      // start.gg が返す error は OAuth 2.0 の標準コード。
      // 「キャンセル」以外もここに来るので、素通しで一括りにしない。
      if (oauthError === 'access_denied') {
        reportError('oauth_denied', S.browserTag(navigator.userAgent));
        show('error', i18n('callback.s10'),
          i18n('callback.s11')
          + i18n('callback.s12'),
          backDefault);
      } else {
        reportError('oauth_error', String(oauthError).slice(0, 60));
        show('error', i18n('callback.s13'),
          describeOAuthError(oauthError, oauthErrorDesc), backDefault);
      }
      return;
    }
    if (!code || !state) {
      reportError('no_code', 'code=' + (code ? 'y' : 'n') + ' state=' + (state ? 'y' : 'n')
        + ' ' + S.browserTag(navigator.userAgent));
      show('error', i18n('callback.s14'),
        i18n('callback.s15')
        + i18n('callback.s16')
        + i18n('callback.s17'), backDefault);
      return;
    }

    // ── 3. state 検証 (nonce)。ここで弾いたら GAS には一切送らない ──
    var st = S.decodeState(state);
    // 単回使用。ここで取り出したら保存側は消える。
    var stored = S.takeNonce();

    // 照合の本体は GAS 側の署名検証に移した (アプリ内ブラウザ→別ブラウザで
    // 戻される経路では、保存領域が引き継がれず必ず失敗するため)。
    // ブラウザに nonce が残っているときだけ、ここでも突き合わせる (二段構え)。
    // 残っていない場合は止めず、署名 state を GAS に検証させる。
    if (!st || (stored && st.n !== stored)) {
      var tag = S.browserTag(navigator.userAgent);
      reportError(!st ? 'state_broken' : 'state_mismatch', tag);
      show('error', i18n('callback.s14'),
        !st
          ? i18n('callback.s18')
            + i18n('callback.s19')
          : i18n('callback.s20')
            + i18n('callback.s21'),
        backDefault);
      return;
    }

    var back = S.safeReturnPath(st.r, CFG.CANONICAL_BASE); // INV-7

    // フローの種別 (post = 投稿 / login = ログインだけしてページに戻る)。
    // 読んだらすぐ消す (放置すると次の別フローに紛れ込む)。
    // 署名 state に入っている flow を最優先で使う。
    // sessionStorage はアプリ内ブラウザ→別ブラウザで引き継がれず、
    // 投稿フロー扱いになって「下書きがありません」と出る原因になっていた。
    var intent = st.f;
    try {
      var stored = sessionStorage.getItem(S.INTENT_KEY);
      sessionStorage.removeItem(S.INTENT_KEY);
      if (!intent) intent = stored;
    } catch (_) { /* state 側だけで判断する */ }

    var missing = S.missingConfig(CFG);
    if (missing.length) {
      show('error', i18n('callback.s22'),
        i18n('callback.s23'), back);
      return;
    }

    if (intent === 'login') {
      runLogin(code, state, back);
      return;
    }
    if (intent === 'challonge') {
      runChallonge(code, state, back);
      return;
    }

    // ── 4. 下書き (post フロー) ──
    var body = null;
    try {
      body = sessionStorage.getItem(S.DRAFT_KEY);
    } catch (_) { /* body は null のまま */ }

    if (!body) {
      reportError('draft_missing', S.browserTag(navigator.userAgent));
      show('error', i18n('callback.s24'),
        i18n('callback.s25'), back);
      return;
    }

    // ── 5. GAS へ ──
    // Content-Type: text/plain は CORS preflight を避けるため (GAS は
    // preflight に応答できない)。GAS はリダイレクト経由で応答するので follow。
    fetch(CFG.GAS_ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'post', code: code, state: state, body: body }),
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      // ── 6. 成否 ──
      if (json && json.ok) {
        try { sessionStorage.removeItem(S.DRAFT_KEY); } catch (_) { /* 消せなくても遷移する */ }
        location.replace(S.withPosted(back));
        return;
      }
      var msg = (json && json.error && json.error.message)
        ? json.error.message
        : i18n('callback.s26');
      // 下書きは残したまま戻す (書き直さずに再試行できる)
      show('error', i18n('callback.s27'), msg, back);
    }).catch(function () {
      show('error', i18n('callback.s27'),
        i18n('callback.s28'), back);
    });
  }

  /**
   * login フロー: code をセッショントークンに替えて localStorage に保存し、
   * 元のページに ?login=1 で戻る。シートには何も書かれない。
   */
  function runLogin(code, state, back) {
    fetch(CFG.GAS_ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'login', code: code, state: state }),
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (json && json.ok && json.token && json.user) {
        AUTH.save({ token: json.token, user: json.user, exp: json.exp });
        location.replace(S.withFlag(back, 'login'));
        return;
      }
      var msg = (json && json.error && json.error.message)
        ? json.error.message
        : i18n('callback.s29');
      // server 側にも残るが、どの経路で来たかを見るために種別だけ添える
      var errCode = (json && json.error && json.error.code) || 'unknown';
      reportError('login_failed', errCode);
      // 期限切れ・使用済み (state_invalid) はよくある: 時間がかかった / 同じ画面をもう一度開いた。やり直せば通る
      if (errCode === 'state_invalid') msg = i18n('callback.state_invalid');
      show('error', i18n('callback.s30'), msg, back, true);
    }).catch(function () {
      reportError('network', 'login fetch failed');
      show('error', i18n('callback.s30'),
        i18n('callback.s28'), back);
    });
  }

  /**
   * challonge フロー (下位クラス作成): code を Challonge のアクセストークンに替えて (Worker が交換し、保存しない)
   * sessionStorage に置き、元のページに ?challonge=1 で戻る。トークンはこのタブの中だけで使う。
   */
  function runChallonge(code, state, back) {
    fetch(CFG.GAS_ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'challonge_token', code: code, state: state }),
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (json && json.ok && json.access_token) {
        var exp = Date.now() + (Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600 * 1000);
        try { sessionStorage.setItem(CHALLONGE_TOKEN_KEY, JSON.stringify({ token: json.access_token, exp: exp, user: json.username || null })); } catch (_) { /* 下で失敗として出す */ }
        location.replace(S.withFlag(back, 'challonge'));
        return;
      }
      var errCode = (json && json.error && json.error.code) || 'unknown';
      reportError('challonge_failed', errCode);
      var msg = errCode === 'state_invalid' ? i18n('callback.state_invalid')
        : ((json && json.error && json.error.message) || i18n('callback.challonge_failed'));
      show('error', i18n('callback.challonge_title'), msg, back);
    }).catch(function () {
      reportError('network', 'challonge fetch failed');
      show('error', i18n('callback.challonge_title'), i18n('callback.s28'), back);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
