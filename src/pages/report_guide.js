// @ts-check
// src/pages/report_guide.js — 結果報告の運営向けの使い方ガイド (2026-11-17)。動きは spot_guide.js (カード編集の裏面のガイドと同じ形)
//   login  ログイン前の画面: 結果報告とは → ログイン
//   setup  受付を始める画面 (ログイン後): 結果報告とは → イベント → 設定 → 何先 → 受付を始める
//   admin  運営の画面 (?c=…&admin=1): 選手に伝える URL → 設定 → 報告のあった試合 → 受付を止める
//   どれも初めて開いたときに出す (端末ごと)。「? 使い方」(rp-guide) でいつでも出し直せる
//   「結果報告とは」「ガイドをもう一度」は、ほかの画面 (シードツールの案内 = INTRO_KEY を同じ名前で書く) やほかのガイドで一度見せていたら、自動で出すときは飛ばす
import SPSPI18n from '../../site/js/i18n.js';
import { createGuide } from './spot_guide.js';

const i18n = (/** @type {string} */ k) => SPSPI18n.t(k);
const $ = (/** @type {string} */ id) => document.getElementById(id);
const q = (/** @type {string} */ sel) => document.querySelector(sel);
const labels = () => ({ prev: i18n('report.guide.prev'), next: i18n('report.guide.next'), done: i18n('report.guide.done'), skip: i18n('report.guide.skip') });
export const INTRO_KEY = 'spsp_report_intro_seen_v1';   // site/seeding/app/40_startgg.js の showReportPromo も同じキーに書く
const AGAIN_KEY = 'spsp_report_guide_again_v1';
/** @param {string} k @param {(() => (Element | null)[]) | null} targets @param {boolean} [optional] @param {string} [once] */
const step = (k, targets, optional, once) => { const tk = k + '.title', bk = k + '.body'; return { title: i18n('report.guide.' + tk), body: i18n('report.guide.' + bk), ...(targets ? { targets } : {}), optional: !!optional, ...(once ? { once } : {}) }; };
const intro = () => step('intro', null, false, INTRO_KEY);
const again = () => step('again', () => [$('rp-guide')], true, AGAIN_KEY);

export const loginGuide = createGuide({
  seenKey: 'spsp_report_guide_login_v1', labels: labels(),
  steps: () => [intro(), step('login', () => [$('rp-to-login')], true), again()],
});

export const setupGuide = createGuide({
  seenKey: 'spsp_report_guide_setup_v1', labels: labels(),
  steps: () => [
    intro(),
    step('pick', () => [q('#rp-setup .rp-tours'), q('#rp-setup .rp-ev-url')], true),
    step('settings', () => [q('#rp-setup .rp-settings')], true),
    step('ft', () => [$('rp-ft-set')], true),
    step('start', () => [$('rp-start')], true),
    again(),
  ],
});

export const adminGuide = createGuide({
  seenKey: 'spsp_report_guide_admin_v1', labels: labels(),
  steps: () => [
    step('share', () => [q('#rp-admin .rp-share')], true),
    step('admin_settings', () => [q('#rp-admin .rp-settings')], true),
    step('sets', () => [$('rp-adm-sets')]),
    step('stop', () => [$('rp-stop')], true),
    again(),
  ],
});

/** 「? 使い方」のボタンを出して、押したらそのガイド。初めてなら自動で出す。force = 見ていても出す (一度見せた段は飛ばす)、noAuto = 自動では出さない (見本)
 * @param {'login' | 'setup' | 'admin'} kind @param {boolean} [force] @param {boolean} [noAuto] */
export function wireGuide(kind, force, noAuto) {
  const g = kind === 'admin' ? adminGuide : kind === 'login' ? loginGuide : setupGuide;
  const b = /** @type {HTMLButtonElement | null} */ ($('rp-guide'));
  if (b) { b.hidden = false; b.onclick = () => g.start(); }
  if (force) setTimeout(() => g.start(true), 500); else if (!noAuto) g.maybeStart(600);
}
