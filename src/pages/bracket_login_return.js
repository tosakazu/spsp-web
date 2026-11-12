// @ts-check
/**
 * トーナメントプレビューからのログイン (2026-11-12)。
 * 共有 URL は #d=… に並び全体が入っていて長い。ログインの戻り先 (returnPath) はサーバが 512 字までしか受けないので、
 * これまでは長い URL だと begin_login が断られ、ボタンを押しても何も起きなかった。
 * #… は戻り先に入れず、このタブの sessionStorage に置いて、戻ってきたときに付け直す。
 * bracket.js のいちばん先に import する (bracket_app.js が location.hash を読む前に付け直すため)。
 */
import SpspLogin from '../../site/js/login.js';

const KEY = 'spsp_bracket_login_hash';

// 戻ってきた: #… が無ければ付け直す (アドレスバーだけ書き換え。読み込みは起こさない)
try {
  const saved = sessionStorage.getItem(KEY);
  if (saved != null) {
    sessionStorage.removeItem(KEY);
    const o = JSON.parse(saved);
    if (o && o.path === location.pathname && typeof o.hash === 'string' && o.hash.length > 1 && location.hash.length <= 1
        && Date.now() - Number(o.ts) < 30 * 60 * 1000) {
      history.replaceState(history.state, '', location.pathname + location.search + o.hash);
    }
  }
} catch (e) { /* sessionStorage が使えないブラウザ: 付け直せないだけ */ }

/** ログインを始める。始められなかったら false (呼んだ側が一言出す) @returns {Promise<boolean>} */
export async function loginFromBracket() {
  try { sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, hash: location.hash, ts: Date.now() })); } catch (e) { /* 下で戻り先に入れる */ }
  const base = location.pathname + location.search;
  const full = base + location.hash;
  // 短ければこれまでどおり # も戻り先に入れる (sessionStorage が使えなくても戻れる)
  const ok = await SpspLogin.startLogin(full.length <= 512 ? full : (base.length <= 512 ? base : location.pathname));
  if (!ok) { try { sessionStorage.removeItem(KEY); } catch (e) { /* 何もしない */ } }
  return ok;
}
