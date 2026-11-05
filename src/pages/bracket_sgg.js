// @ts-check
/**
 * トーナメントプレビュー: start.gg と同じ形の表 (2026-11-05)。
 * 共有 URL に start.gg のフェーズの id (payload.sgg、シードページが入れる) があれば、いつもの表の場所に (従来の表の代わりに) start.gg のブロックの構造
 * (試合のつながり・不戦勝・敗者側への落ち方) をそのまま読み、シード通り (シード番号の小さい方が勝つ) で勝ち上がらせて描く。
 * 計算は結果報告と同じ worker/src/api/bracket_engine.ts (bracket_struct.ts の simulate)、描き方は結果報告のトーナメント表と同じ。
 * 構造はまず SPSP のサーバー (bracket_structure、10 分キャッシュ) から、読めなければブラウザからログインのトークンで start.gg を直接読む。
 */
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SeedShare from '../../site/seeding/seed_share.js';
import SpspLogin from '../../site/js/login.js';
import SpspStartggIdentity from '../../site/js/startgg_identity.js';
import { makeGql } from '../../site/js/live_fetch.js';
import { fetchSimData, simulate } from '../../worker/src/api/bracket_struct.ts';
import { renderGroup } from './report_bracket_view.js';

const t = (k, v) => SPSPI18n.t(k, v);

/** @returns {Promise<any | null>} */
async function payloadOfHash() {
  try {
    const f = SeedShare.parseFragment(location.hash);
    if (!f || !f.d) return null;
    return await SeedShare.decodePayload(f.d);
  } catch (_) { return null; }
}

/** 構造を読む: サーバー → だめならブラウザ (ログインのトークン) */
async function loadData(phases) {
  try {
    if (SpspLogin.apiAvailable && SpspLogin.apiAvailable()) {
      const r = await SpspLogin.api({ action: 'bracket_structure', phases });
      if (r && r.ok && r.data) return { data: r.data, via: 'server' };
    }
  } catch (_) { /* ブラウザで読む */ }
  const token = await SpspStartggIdentity.token().catch(() => null);
  if (!token) return { data: null, via: 'need_login' };
  const client = makeGql(token, 300);
  const gql = async (query, variables) => client(query, variables);
  return { data: await fetchSimData(gql, phases), via: 'browser' };
}

/** start.gg と同じ形の表を出しているあいだ隠す、従来の表とその操作 (SPSP 側で組み立てる表) */
const OLD_IDS = ['bp-bracket', 'bp-phase-tabs', 'bp-pool-info', 'bp-phase-editor'];
function showOld(on) {
  for (const id of OLD_IDS) { const el = document.getElementById(id); if (el) el.hidden = !on; }
  for (const id of ['bp-pool-select', 'bp-lb', 'bp-wd']) {
    const el = document.getElementById(id);
    const lab = el && el.closest('label');
    if (lab) lab.hidden = !on;
  }
}

async function main() {
  const payload = await payloadOfHash();
  const phases = payload && Array.isArray(payload.sgg) ? payload.sgg.map(String).filter((x) => /^\d+$/.test(x)) : [];
  const anchor = document.getElementById('bp-bracket');
  if (!phases.length || !anchor || document.getElementById('bp-sgg')) return;
  // start.gg のフェーズが分かる共有 URL では、start.gg と同じ形の表をいつもの場所に出す (読めるまでは従来の表のまま)
  const box = document.createElement('section');
  box.id = 'bp-sgg';
  box.className = 'bp-sgg';
  box.innerHTML = `<div class="bk-bar"><select data-sgg-group hidden></select> <span class="bp-inline-status" data-sgg-status></span></div>
    <div data-sgg-body></div>`;
  anchor.before(box);
  const sel = /** @type {HTMLSelectElement} */ (box.querySelector('[data-sgg-group]'));
  const body = /** @type {HTMLElement} */ (box.querySelector('[data-sgg-body]'));
  const status = /** @type {HTMLElement} */ (box.querySelector('[data-sgg-status]'));
  /** @type {import('../../worker/src/api/bracket_struct.ts').SimResult | null} */
  let res = null;
  const names = payload.names || {};
  const nameOf = (e) => { const n = Number(String(e).slice(1)); return names[String(n - 1)] || t('bracket.sgg.seed', { n }); };
  const draw = () => {
    const cur = res;
    if (!cur) return;
    const g = cur.groups.find((x) => x.id === sel.value) || cur.groups[0];
    if (!g) { body.innerHTML = ''; return; }
    const ents = {};
    for (const s of g.views.sets) for (const x of s.sl) if (x.e) ents[x.e] = nameOf(x.e);
    body.innerHTML = renderGroup({ ...g.views, ents, me: [] }, t);
  };
  sel.addEventListener('change', draw);
  try {
    const got = await loadData(phases);
    if (!got.data) {
      // ログインしていない: 従来の表のまま、ログインすれば start.gg と同じ形になると出す
      status.innerHTML = escapeHtml(t('bracket.sgg.need_login')) + ` <button type="button" class="bp-btn" data-sgg-login>${escapeHtml(t('bracket.sgg.login'))}</button>`;
      const btn = status.querySelector('[data-sgg-login]');
      if (btn) btn.addEventListener('click', () => SpspLogin.startLogin(location.pathname + location.search + location.hash));
      return;
    }
    const sim = simulate(got.data);
    res = sim;
    const n = got.data.phases[0] ? got.data.phases[0].seeds.length : 0;
    const warn = [];
    if (n && payload.uids && n !== payload.uids.length) warn.push(t('bracket.sgg.count', { a: payload.uids.length, b: n }));
    if (sim.warnings.includes('rr')) warn.push(t('bracket.sgg.rr'));
    if (sim.warnings.includes('no_seeds')) warn.push(t('bracket.sgg.no_seeds'));
    if (sim.warnings.includes('est')) warn.push(t('bracket.sgg.est'));
    status.textContent = warn.join(' ');
    sel.innerHTML = sim.groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
    sel.hidden = sim.groups.length < 2;
    showOld(false);
    draw();
  } catch (e) {
    // 読めなかった: 従来の表のまま
    status.textContent = t('bracket.sgg.error') + ' ' + String((e && /** @type {any} */ (e).message) || e);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
  window.addEventListener('hashchange', () => { const old = document.getElementById('bp-sgg'); if (old) { old.remove(); showOld(true); } main(); });
}
