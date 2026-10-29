// @ts-check
// 試合結果の報告の受付 (src/pages/report.js、docs/self_report_design.md) を運営が始めるときの start.gg ログイン。
//   start({ event, settings }, returnPath)  どのイベントか・設定を sessionStorage に置いて、scope tournament.reporter の認可画面へ
//   callback.js の reporter フローが、置いたものを読んで action report_enable を送る (運営のトークンは Worker が暗号化して置く)
import SpspLogin from './login.js';
import SpspOAuthState from './oauth_state.js';
'use strict';

export const REPORT_SETUP_KEY = 'spsp_report_setup';

/** @param {{ event: string, settings?: { top_cut: number | null, classes_only: boolean } }} setup @param {string} [returnPath] */
export async function start(setup, returnPath) {
  if (!SpspLogin.apiAvailable()) return false;
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return false; }
  SpspOAuthState.saveNonce(nonce);
  try {
    sessionStorage.setItem(SpspOAuthState.INTENT_KEY, 'reporter');
    sessionStorage.setItem(REPORT_SETUP_KEY, JSON.stringify(setup));
  } catch (e) { return false; }   // イベントを覚えられないと戻ってきても受付できない
  const r = await SpspLogin.api({ action: 'report_begin', nonce, returnPath: returnPath || location.pathname });
  if (!r || !r.ok || !r.url) return false;
  location.assign(r.url);
  return true;
}

const SpspReportAuth = { REPORT_SETUP_KEY, start };
const global = typeof window !== 'undefined' ? window : globalThis;
/** @type {any} */ (global).SpspReportAuth = SpspReportAuth;
export default SpspReportAuth;
