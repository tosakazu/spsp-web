// @ts-check
/**
 * トーナメントプレビュー: 組み合わせを start.gg の構造で決める (2026-11-05)。
 * 共有 URL に start.gg のフェーズの id (payload.sgg、シードページが入れる) があれば、start.gg のブロックの構造 (試合のつながり・不戦勝・
 * 敗者側への落ち方) を読み、表 (bracket_app.js) の組み合わせをそれにする。表の見た目・列の形は従来のまま (bracket_sgg_core.js の alignToApp)。
 * ログイン必須 (ログインしていなければ表を出さずに案内)。start.gg が読めない・その人数のブロックが無いとき・このページでフェーズ構成を変えたときは従来の組み方。
 * 共有 URL に sgg が入るのは、シードページで start.gg から取れたフェーズ構成をそのまま使ったときだけ (90_spec.js)。
 * 構造はまず SPSP のサーバー (bracket_structure、10 分キャッシュ) から、読めなければブラウザからログインのトークンで start.gg を直接読む。
 */
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SeedShare from '../../site/seeding/seed_share.js';
import SpspLogin from '../../site/js/login.js';
import SpspStartggIdentity from '../../site/js/startgg_identity.js';
import { makeGql } from '../../site/js/live_fetch.js';
import { fetchSimData } from '../../worker/src/api/bracket_struct.ts';
import { alignToApp, deFromSgg } from '../../site/bracket/bracket_sgg_core.js';

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

/** 構造を読む: 共有 URL・CSV に入っている構造 → 短い URL の構造 → サーバー → だめならブラウザ (ログインのトークン)。読めなければ null */
async function loadData(phases, payload) {
  const inUrl = payload && payload.sggData && payload.sggData.v === 1 && Array.isArray(payload.sggData.phases) ? payload.sggData : null;
  if (inUrl) return inUrl;
  const shared = sharedData();
  if (shared) return shared;
  try {
    if (SpspLogin.apiAvailable && SpspLogin.apiAvailable()) {
      const r = await SpspLogin.api({ action: 'bracket_structure', phases });
      if (r && r.ok && r.data) return r.data;
    }
  } catch (_) { /* ブラウザで読む */ }
  const token = await SpspStartggIdentity.token().catch(() => null);
  if (!token) return null;
  const client = makeGql(token, 300);
  return fetchSimData((query, variables) => client(query, variables), phases);
}

/** 表に渡す: フェーズ (payload の順) × 人数 → start.gg から作った表 (列の形は従来に揃える) */
function provider(data, payload) {
  /** @type {Map<number, Map<number, { sets: any[], seedGs: Map<string, number | null> }>>} */
  const byPhase = new Map();
  data.phases.forEach((ph, i) => {
    const want = payload.phases[i];
    // プール数が共有のフェーズ構成と違う (このページで編集した等) フェーズは使わない
    if (!want || (want.pools | 0) !== ph.groups.length) return;
    const bySize = new Map();
    for (const [key, tpl] of Object.entries(ph.templates)) {
      const [type, n] = key.split(':');
      if (type !== 'DOUBLE_ELIMINATION') continue;
      const seedGs = new Map(ph.seeds.filter((s) => s.g === tpl.owner).map((s) => [s.id, s.gs]));
      bySize.set(Number(n), { sets: tpl.sets, seedGs });
    }
    byPhase.set(i, bySize);
  });
  const cache = new Map();
  return {
    ready: true,
    version: Date.now(),
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
      cache.set(k, out);
      return out;
    },
  };
}

/** 表 (と表の操作) を隠す / 戻す。start.gg の組み合わせが読めるまでは、違うかもしれない組み合わせを見せない */
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

async function main() {
  const payload = await payloadOfHash();
  const phases = payload && Array.isArray(payload.sgg) ? payload.sgg.map(String).filter((x) => /^\d+$/.test(x)) : [];
  if (!phases.length) return;
  const W = /** @type {any} */ (window);
  // start.gg のフェーズが分かる共有 URL は、start.gg の組み合わせで出す (ログイン必須。2026-11-05)
  let custom = false;
  // このページでフェーズ構成を変えた (カスタム): start.gg の組み合わせは使わず、ログインなしで SPSP の組み方 (bracket_app.js が知らせる)
  document.addEventListener('spsp:bracket-phases-edited', () => {
    custom = true;
    if (W.SPSP && W.SPSP.BracketSgg) W.SPSP.BracketSgg = null;
    note('');
    hideBracket(false);
  });
  hideBracket(true);
  note(escapeHtml(t('bracket.sgg.loading')));
  try {
    const data = await loadData(phases, payload);
    if (custom) return;
    if (!data) {
      const box = note(escapeHtml(t('bracket.sgg.need_login')) + ` <button type="button" class="bp-btn">${escapeHtml(t('bracket.sgg.login'))}</button>`);
      const btn = box && box.querySelector('button');
      if (btn) btn.addEventListener('click', () => SpspLogin.startLogin(location.pathname + location.search + location.hash));
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
    note('');
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
    setTimeout(() => document.dispatchEvent(new CustomEvent('spsp:bracket-sgg')), 0);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('spsp:bracket-payload', onPayload);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
}
