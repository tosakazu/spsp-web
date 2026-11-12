// @ts-check
/**
 * トーナメントプレビュー: 組み合わせを start.gg の構造で決める (2026-11-05)。
 * 共有 URL に start.gg のフェーズの id (payload.sgg、シードページが入れる) があれば、start.gg のブロックの構造 (試合のつながり・不戦勝・
 * 敗者側への落ち方) を読み、表 (bracket_app.js) の組み合わせをそれにする。表の見た目・列の形は従来のまま (bracket_sgg_core.js の alignToApp)。
 * ログインしていなければ SPSP の推定の組み方で出し、まれにずれること・ログインすれば一致することを書く (2026-11-05)。start.gg が読めない・その人数のブロックが無いとき・このページでフェーズ構成を変えたときは従来の組み方。
 * 共有 URL に sgg が入るのは、シードページで start.gg から取れたフェーズ構成をそのまま使ったときだけ (90_spec.js)。
 * 構造はまず SPSP のサーバー (bracket_structure、10 分キャッシュ) から、読めなければブラウザからログインのトークンで start.gg を直接読む。
 */
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SeedShare from '../../site/seeding/seed_share.js';
import SpspLogin from '../../site/js/login.js';
import { loginFromBracket } from './bracket_login_return.js';
import SpspStartggIdentity from '../../site/js/startgg_identity.js';
import SpspStartggManager from '../../site/js/startgg_manager.js';
import { makeGql } from '../../site/js/live_fetch.js';
import { fetchSimData } from '../../worker/src/api/bracket_struct.ts';
import { alignToApp, deFromSgg, deriveSeedGs } from '../../site/bracket/bracket_sgg_core.js';

const t = (k, v) => SPSPI18n.t(k, v);

/** @returns {Promise<any | null>} */
async function payloadOfHash() {
  try {
    const f = SeedShare.parseFragment(location.hash);
    if (!f || !f.d) return null;
    return await SeedShare.decodePayload(f.d);
  } catch (_) { return null; }
}

/** 短い URL から開いたとき、作った人が start.gg から読んだ構造 (bracket_share.js が sessionStorage に置く。ログイン不要) */
export const SHARED_KEY = 'spsp_bracket_shared_sgg';
function sharedData() {
  try {
    const o = JSON.parse(sessionStorage.getItem(SHARED_KEY) || 'null');
    return o && o.frag === location.hash.replace(/^#/, '') && o.sgg && o.sgg.v === 1 ? o.sgg : null;
  } catch (_) { return null; }
}

/** 読めた構造が使えるか: 最初のフェーズのシードと試合がある (非公開の大会を権限なしで読むと、フェーズだけ返って中身が空のことがある) */
function usable(data) {
  const p0 = data && Array.isArray(data.phases) ? data.phases[0] : null;
  return !!(p0 && Array.isArray(p0.seeds) && p0.seeds.length && Object.values(p0.templates || {}).some((t) => t && Array.isArray(t.sets) && t.sets.length));
}

/** ブラウザで start.gg を読むトークンの候補 (強い順)。大会の管理者のトークン (運営用ログイン・保存した API キー) は非公開のシードも読める (2026-11-12)。
 * 普段のログイン (scope user.identity) のトークンは公開された分だけ */
async function tokenCandidates() {
  /** @type {{ token: string, kind: 'manager' | 'key' | 'identity' }[]} */
  const out = [];
  try { const m = SpspStartggManager.load(); if (m && m.token) out.push({ token: m.token, kind: 'manager' }); } catch (_) { /* 次へ */ }
  try { const k = (localStorage.getItem('spsp_startgg_token') || '').trim(); if (k) out.push({ token: k, kind: 'key' }); } catch (_) { /* 次へ */ }
  const id = await SpspStartggIdentity.token().catch(() => null);
  if (id) out.push({ token: id, kind: 'identity' });
  return out;
}

/**
 * 構造を読む: 共有 URL・CSV に入っている構造 → 短い URL の構造 → サーバー → だめならブラウザ (管理者のトークン → ログインのトークン)。
 * @returns {Promise<{ data: any | null, via: 'url' | 'shared' | 'server' | 'manager' | 'key' | 'identity' | null, tried: string[] }>}
 *   tried = ブラウザで試して読めなかったトークンの種類 (案内の出し分け)
 */
async function loadData(phases, payload) {
  const inUrl = payload && payload.sggData && payload.sggData.v === 1 && Array.isArray(payload.sggData.phases) ? payload.sggData : null;
  if (inUrl) return { data: inUrl, via: 'url', tried: [] };
  const shared = sharedData();
  if (shared) return { data: shared, via: 'shared', tried: [] };
  try {
    if (SpspLogin.apiAvailable && SpspLogin.apiAvailable()) {
      const r = await SpspLogin.api({ action: 'bracket_structure', phases });
      if (r && r.ok && usable(r.data)) return { data: r.data, via: 'server', tried: [] };
    }
  } catch (_) { /* ブラウザで読む */ }
  const tried = [];
  for (const c of await tokenCandidates()) {
    try {
      const client = makeGql(c.token, 300);
      const data = await fetchSimData((query, variables) => client(query, variables), phases);
      if (usable(data)) return { data, via: c.kind, tried };
    } catch (_) { /* 次の候補 */ }
    tried.push(c.kind);
  }
  return { data: null, via: null, tried };
}


/** 表に渡す: フェーズ (payload の順) × 人数 → start.gg から作った表 (列の形は従来に揃える) */
function provider(data, payload) {
  /** @type {Map<number, Map<number, { sets: any[], seedGs: Map<string, number | null> }>>} */
  const byPhase = new Map();
  /** @type {{ name: string, ok: boolean, derived: boolean, miss?: number[] }[]} フェーズごと: start.gg の組み合わせを反映できたか */
  const status = [];
  data.phases.forEach((ph, i) => {
    const want = payload.phases[i];
    // プール数が共有のフェーズ構成と違う (このページで編集した等) フェーズは使わない
    if (!want || (want.pools | 0) !== ph.groups.length) return;
    const bySize = new Map();
    let derived = false, bad = false;
    for (const [key, tpl] of Object.entries(ph.templates)) {
      const [type, n] = key.split(':');
      if (type !== 'DOUBLE_ELIMINATION') continue;
      let seedGs = new Map(ph.seeds.filter((s) => s.g === tpl.owner).map((s) => [s.id, s.gs]));
      let M = Number(n);
      if (!seedGs.size && i > 0) {
        // 開始前の後ろのフェーズ: シードが返らないので、試合の枠の ID から割り出す (deriveSeedGs)
        const d = deriveSeedGs(tpl.sets, data.phases[i - 1].groups.length);
        if (!d) { bad = true; continue; }
        seedGs = d.seedGs; M = d.M; derived = true;
      }
      // 表の形にできるかを先に確かめる (できないフェーズは「推定」と表示する)
      let okShape = false;
      try { okShape = !!deFromSgg(tpl.sets, seedGs, M); } catch (_) { okShape = false; }
      if (!okShape) { bad = true; continue; }
      bySize.set(M, { sets: tpl.sets, seedGs });
    }
    byPhase.set(i, bySize);
    status[i] = { name: ph.name, ok: bySize.size > 0 && !bad, derived };
  });
  // start.gg から読めなかった・プール数が違うフェーズ
  payload.phases.forEach((p, i) => { if (!status[i]) status[i] = { name: (data.phases[i] && data.phases[i].name) || (p && p.name) || '', ok: false, derived: false }; });
  const cache = new Map();
  return {
    ready: true,
    version: Date.now(),
    status,
    /** @param {number} ph @param {number} M @param {any} base 従来の組み方の表 */
    de(ph, M, base) {
      const k = ph + ':' + M + ':' + (base ? base.winners.length + '/' + base.losers.length : '');
      if (cache.has(k)) return cache.get(k);
      const bySize = byPhase.get(ph);
      const tpl = bySize ? bySize.get(M) : undefined;
      let out = null;
      if (tpl) {
        try { const sg = deFromSgg(tpl.sets, tpl.seedGs, M); out = sg ? alignToApp(base, sg) : null; } catch (_) { out = null; }
      }
      // 表に入れられなかった (その人数の型が無い・列の形が合わない): 表示を「推定」に直す
      if (!out && status[ph] && status[ph].ok && base && !(status[ph].miss || []).includes(M)) {
        (status[ph].miss = status[ph].miss || []).push(M);
        setTimeout(() => document.dispatchEvent(new CustomEvent('spsp:bracket-sgg-status')), 0);
      }
      cache.set(k, out);
      return out;
    },
  };
}

/** 表 (と表の操作) を隠す / 戻す。start.gg の組み合わせを読んでいる間は、違うかもしれない組み合わせを見せない */
function hideBracket(on) {
  const el = document.getElementById('bp-bracket');
  if (el) el.hidden = on;
}
/** 表の上に一言 (ログインの案内・読み込み中・読めなかった) */
function note(html) {
  let box = document.getElementById('bp-sgg-note');
  const st = document.getElementById('bp-status');
  if (!box && st) { box = document.createElement('div'); box.id = 'bp-sgg-note'; box.className = 'bp-inline-status'; st.before(box); }
  if (box) box.innerHTML = html;
  return box;
}

/** 取得して反映できたかをフェーズごとに出す (2026-11-12): ✅ start.gg から取得して反映済み / ⚠ 推定のまま */
function statusHtml(data, via) {
  const W = /** @type {any} */ (window);
  const st = (W.SPSP && W.SPSP.BracketSgg && W.SPSP.BracketSgg.status) || [];
  if (!st.length) return '';
  const full = st.filter((x) => x.ok && !(x.miss && x.miss.length)), part = st.filter((x) => x.ok && x.miss && x.miss.length), est = st.filter((x) => !x.ok);
  const names = (/** @type {any[]} */ a) => a.map((x) => escapeHtml(x.name || '?')).join('・');
  const when = data && data.fetched_at ? new Date(data.fetched_at).toLocaleString() : '';
  const src = via === 'url' || via === 'shared' ? t('bracket.sgg.src_shared') : via === 'manager' || via === 'key' ? t('bracket.sgg.src_manager') : '';
  let h = '';
  if (full.length || part.length) {
    h += `<span class="bp-sgg-ok" style="color:#047857;font-weight:600">✅ ${escapeHtml(est.length || part.length ? t('bracket.sgg.applied_some') : t('bracket.sgg.applied_all'))}</span>`
      + ` <span style="color:#6b7280">${names(full.concat(part))}${when ? ' · ' + escapeHtml(t('bracket.sgg.fetched_at', { t: when })) : ''}${src ? ' · ' + escapeHtml(src) : ''}</span>`;
    if (st.some((x) => x.ok && x.derived)) h += `<br><span style="color:#6b7280">${escapeHtml(t('bracket.sgg.derived_note'))}</span>`;
  }
  for (const x of part) h += `<br><span style="color:#b45309">⚠ ${escapeHtml(t('bracket.sgg.partial_phase', { name: x.name || '?', sizes: (x.miss || []).join('・') }))}</span>`;
  if (est.length) h += `${h ? '<br>' : ''}<span style="color:#b45309">⚠ ${escapeHtml(t('bracket.sgg.estimated_phase', { names: est.map((x) => x.name || '?').join('・') }))}</span>`;
  return h;
}
let _statusArgs = /** @type {[any, any] | null} */ (null);
function showStatus(data, via) { _statusArgs = [data, via]; note(statusHtml(data, via)); }

async function main() {
  const payload = await payloadOfHash();
  const phases = payload && Array.isArray(payload.sgg) ? payload.sgg.map(String).filter((x) => /^\d+$/.test(x)) : [];
  if (!phases.length) return;
  const W = /** @type {any} */ (window);
  // start.gg のフェーズが分かる共有 URL は、start.gg の組み合わせで出す (ログインしていなければ推定で出して案内)
  let custom = false;
  // このページでフェーズ構成を変えた (カスタム): start.gg の組み合わせは使わず、ログインなしで SPSP の組み方 (bracket_app.js が知らせる)
  document.addEventListener('spsp:bracket-phases-edited', () => {
    custom = true;
    _statusArgs = null;
    if (W.SPSP && W.SPSP.BracketSgg) W.SPSP.BracketSgg = null;
    note('');
    hideBracket(false);
  });
  hideBracket(true);
  note(escapeHtml(t('bracket.sgg.loading')));
  try {
    const got = await loadData(phases, payload);
    const data = got.data;
    if (custom) return;
    if (!data) {
      hideBracket(false);
      // ログインはしている (普段のログインのトークンで試した) のに読めない = 非公開。管理者としてログインすれば読める
      const triedIdentity = got.tried.includes('identity'), triedManager = got.tried.includes('manager') || got.tried.includes('key');
      const msg = triedManager ? t('bracket.sgg.private_denied') : triedIdentity ? t('bracket.sgg.private') : t('bracket.sgg.need_login');
      const box = note(escapeHtml(msg)
        + (triedIdentity || triedManager ? '' : ` <button type="button" class="bp-btn" data-login="user">${escapeHtml(t('bracket.sgg.login'))}</button>`)
        + ` <button type="button" class="bp-btn" data-login="manager">${escapeHtml(t('bracket.sgg.login_manager'))}</button>`);
      for (const btn of box ? box.querySelectorAll('button[data-login]') : []) btn.addEventListener('click', async (e) => {
        const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
        b.disabled = true;
        if (!(await loginFromBracket({ manager: b.dataset.login === 'manager' }))) {   // 始められなかった (通信の失敗など): 黙って何もしないのをやめて一言出す
          b.disabled = false;
          if (box && !box.querySelector('.bp-login-err')) box.insertAdjacentHTML('beforeend', ` <span class="bp-login-err" style="color:#dc2626">${escapeHtml(t('bracket.sgg.login_failed'))}</span>`);
        }
      });
      return;
    }
    if (custom) return;
    W.SPSP = W.SPSP || {};
    W.SPSP.BracketSgg = provider(data, payload);
    W.SPSP.BracketSggData = data;   // 短い URL に入れる (bracket_share.js)
    // 共有 URL (コピー)・CSV 保存にも入れる: 構造を入れた d= を作り直して表に渡す (表が URL を書き換える)
    if (!payload.sggData) {
      try {
        const blob = await SeedShare.encodePayload({ ...payload, sggData: data });
        document.dispatchEvent(new CustomEvent('spsp:bracket-blob', { detail: { blob, sggData: data } }));
      } catch (_) { /* 入らなくても表示はできる */ }
    }
    showStatus(data, got.via);
    hideBracket(false);
    document.dispatchEvent(new CustomEvent('spsp:bracket-sgg'));
  } catch (e) {
    // 読めなかった: 従来の組み方で出して、そう書く
    note(escapeHtml(t('bracket.sgg.error')));
    hideBracket(false);
  }
}

/** CSV を読み込んだ (別のデータ): 前の組み合わせは捨て、CSV に start.gg の構造があればそれで (ログイン不要) */
function onPayload(e) {
  const W = /** @type {any} */ (window);
  const payload = e.detail && e.detail.payload;
  if (W.SPSP) { W.SPSP.BracketSgg = null; W.SPSP.BracketSggData = null; }
  hideBracket(false);
  note('');
  const sd = payload && payload.sggData;
  if (payload && Array.isArray(payload.sgg) && sd && sd.v === 1 && Array.isArray(sd.phases)) {
    W.SPSP = W.SPSP || {};
    W.SPSP.BracketSgg = provider(sd, payload);
    W.SPSP.BracketSggData = sd;
    showStatus(sd, 'url');
    setTimeout(() => document.dispatchEvent(new CustomEvent('spsp:bracket-sgg')), 0);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('spsp:bracket-payload', onPayload);
  // 表に入れられない人数のプールが見つかった: 表示を直す
  document.addEventListener('spsp:bracket-sgg-status', () => { if (_statusArgs) note(statusHtml(_statusArgs[0], _statusArgs[1])); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
}
