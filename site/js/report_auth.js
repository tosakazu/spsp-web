// @ts-check
// 試合結果の報告 (src/pages/report.js、docs/self_report_design.md) の運営の start.gg ログイン (scope tournament.reporter)。
//   start(returnPath)  認可画面へ。戻ると callback.js の reporter フローが action report_login を送り (運営のトークンは Worker が暗号化して預かる)、
//                      returnPath (受付を始める画面) に戻る。そこで管理している大会の一覧から選んで受付を始める (2026-10-30、ログインが先)
import SpspLogin from './login.js';
import SpspOAuthState from './oauth_state.js';
'use strict';

/** @param {string} [returnPath] */
export async function start(returnPath) {
  if (!SpspLogin.apiAvailable()) return false;
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return false; }
  SpspOAuthState.saveNonce(nonce);
  try { sessionStorage.setItem(SpspOAuthState.INTENT_KEY, 'reporter'); } catch (e) { /* 署名 state 側で判断できる */ }
  const r = await SpspLogin.api({ action: 'report_begin', nonce, returnPath: returnPath || location.pathname });
  if (!r || !r.ok || !r.url) return false;
  location.assign(r.url);
  return true;
}

const SpspReportAuth = { start };
const global = typeof window !== 'undefined' ? window : globalThis;
/** @type {any} */ (global).SpspReportAuth = SpspReportAuth;
export default SpspReportAuth;
