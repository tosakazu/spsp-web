// @ts-check
/**
 * 結果報告: トーナメント表 (2026-11-05)。Worker の report_bracket_view (D1 のブラケットの写しを読むだけ・start.gg は読まない) を描く。
 * 選手の画面・運営の画面の下に「トーナメント表」(開いたときだけ読む。開いているあいだは 30 秒ごとに読み直す)。
 *   - 勝者側・敗者側の列 (ラウンドごと)。並びは前の試合をたどった順 (start.gg の表と同じ上下)。不戦勝の試合は出さない
 *   - 総当たりは表 (行の人から見た勝ち負け)
 *   - 札: 対戦中 (start.gg) / start.gg 未反映 (SPSP にだけある結果と、start.gg ではまだ空いている枠に SPSP が前の試合の結果から入れた人。名前に *)
 */
import { escapeHtml } from '../../site/js/html.js';

const POLL_MS = 30 * 1000;

/**
 * @param {HTMLElement} root
 * @param {{ api: (b: object) => Promise<any>, tok: () => string, code: string, t: (k: string, v?: object) => string, hhmm: (ms: number) => string }} ctx
 */
export function mountBracketView(root, ctx) {
  const { t } = ctx;
  /** @type {{ groups: any[] | null, gid: string | null, data: any, timer: any, busy: boolean, err: string }} */
  const st = { groups: null, gid: null, data: null, timer: null, busy: false, err: '' };
  root.hidden = false;
  root.innerHTML = `<section class="rp-card-sec bk-sec"><details data-bk>
    <summary>${escapeHtml(t('report.bk.title'))}</summary>
    <div class="bk-bar"><select data-bk-group aria-label="${escapeHtml(t('report.bk.group'))}"></select> <span class="rp-muted" data-bk-at></span></div>
    <p class="rp-muted bk-legend">${escapeHtml(t('report.bk.legend'))}</p>
    <div data-bk-body><p class="rp-muted">${escapeHtml(t('report.loading'))}</p></div>
  </details></section>`;
  const det = /** @type {HTMLDetailsElement} */ (root.querySelector('[data-bk]'));
  const sel = /** @type {HTMLSelectElement} */ (root.querySelector('[data-bk-group]'));
  const body = /** @type {HTMLElement} */ (root.querySelector('[data-bk-body]'));
  const at = /** @type {HTMLElement} */ (root.querySelector('[data-bk-at]'));

  const load = async () => {
    if (st.busy || !det.open || document.hidden) return;
    st.busy = true;
    try {
      if (!st.groups) {
        const r = await ctx.api({ action: 'report_bracket_view', token: ctx.tok(), code: ctx.code });
        if (!r || !r.ok) { body.innerHTML = `<p class="rp-muted">${escapeHtml(r && r.error && r.error.code === 'not_ready' ? t('report.bk.none') : (r && r.error && r.error.message) || t('report.bk.none'))}</p>`; return; }
        st.groups = r.groups;
        sel.innerHTML = r.groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name || g.d || g.id)}</option>`).join('');
        sel.hidden = r.groups.length < 2;
        st.gid = r.groups.length ? r.groups[0].id : null;
        // 自分が出るブロックを先に (いちばん後ろのフェーズ)
        if (r.me && r.me.length) {
          const mineG = await firstMine(r.groups, r.me);
          if (mineG) st.gid = mineG;
        }
        if (st.gid) sel.value = st.gid;
      }
      if (!st.gid) { body.innerHTML = `<p class="rp-muted">${escapeHtml(t('report.bk.none'))}</p>`; return; }
      const r = await ctx.api({ action: 'report_bracket_view', token: ctx.tok(), code: ctx.code, group: st.gid });
      if (!r || !r.ok) { body.innerHTML = `<p class="rp-err">${escapeHtml((r && r.error && r.error.message) || 'error')}</p>`; return; }
      st.data = r;
      at.textContent = r.synced_ms ? t('report.bk.synced', { t: ctx.hhmm(r.synced_ms) }) : '';
      body.innerHTML = renderGroup(r, t);
    } catch (e) {
      body.innerHTML = `<p class="rp-err">${escapeHtml(String(e && /** @type {any} */ (e).message || e))}</p>`;
    } finally { st.busy = false; }
  };
  // 自分が出るブロック: 一覧には出場者が無いので、後ろのフェーズから 3 つまで読んで探す
  const firstMine = async (groups, me) => {
    for (const g of groups.slice().reverse().slice(0, 3)) {
      const r = await ctx.api({ action: 'report_bracket_view', token: ctx.tok(), code: ctx.code, group: g.id });
      if (r && r.ok && r.sets.some((s) => s.sl.some((x) => x.e && me.includes(x.e)))) return g.id;
    }
    return null;
  };
  det.addEventListener('toggle', () => {
    if (det.open) { load(); if (!st.timer) st.timer = setInterval(load, POLL_MS); }
    else if (st.timer) { clearInterval(st.timer); st.timer = null; }
  });
  sel.addEventListener('change', () => { st.gid = sel.value; body.innerHTML = `<p class="rp-muted">${escapeHtml(t('report.loading'))}</p>`; load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && det.open) load(); });
  return { open() { det.open = true; } };
}

/** 不戦勝の試合 (start.gg の表にも出ない) */
const isBye = (s) => s.sl.some((x) => x.pt === 'bye');

/** @param {any} r @param {(k: string, v?: object) => string} t */
export function renderGroup(r, t) {
  const me = new Set(r.me || []);
  const sets = r.sets.filter((s) => !isBye(s));
  const byId = new Map(r.sets.map((s) => [s.i, s]));
  let h = '';
  if (!r.group.trusted) h += `<p class="rp-warn">${escapeHtml(t('report.bk.untrusted'))}</p>`;
  if (r.group.b === 'ROUND_ROBIN') return h + rrHtml(sets, r.ents, me, t);
  const side = (want) => {
    const list = sets.filter((s) => (want > 0 ? (s.r || 0) > 0 : (s.r || 0) < 0));
    if (!list.length) return '';
    // 並び: 前の試合 (同じ側の勝者が来る枠) をたどった順。終わりの試合 (同じ側のどの試合にも勝者が行かない) から
    const sameSide = (s) => (want > 0 ? (s.r || 0) > 0 : (s.r || 0) < 0);
    const fed = new Set();
    for (const s of list) for (const x of s.sl) if (x.pt === 'set' && x.pp === 1 && byId.has(x.pi) && sameSide(byId.get(x.pi))) fed.add(x.pi);
    const order = new Map();
    const visit = (s) => {
      if (order.has(s.i)) return;
      order.set(s.i, order.size);
      for (const x of s.sl) {
        const c = x.pt === 'set' && x.pp === 1 ? byId.get(x.pi) : null;
        if (c && sameSide(c) && !isBye(c)) visit(c);
      }
    };
    for (const s of list.filter((x) => !fed.has(x.i)).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))) visit(s);
    const rounds = Array.from(new Set(list.map((s) => s.r))).sort((a, b) => Math.abs(a) - Math.abs(b));
    const cols = rounds.map((rd) => {
      const col = list.filter((s) => s.r === rd).sort((a, b) => (order.get(a.i) ?? 1e9) - (order.get(b.i) ?? 1e9));
      return `<div class="bk-col"><div class="bk-rt">${escapeHtml(col[0].t || '')}</div><div class="bk-sets">${col.map((s) => setHtml(s, byId, r.ents, me, t)).join('')}</div></div>`;
    }).join('');
    return `<h3 class="bk-side">${escapeHtml(want > 0 ? t('report.bk.winners') : t('report.bk.losers'))}</h3><div class="bk-scroll"><div class="bk-cols">${cols}</div></div>`;
  };
  return h + side(1) + side(-1);
}

function slotLabel(x, byId, ents, t) {
  if (x.e) return ents[x.e] || '?';
  if (x.pt === 'set') {
    const p = byId.get(x.pi);
    const id = p ? p.x || p.i : '';
    return x.pp === 2 ? t('report.bk.loser_of', { x: id }) : t('report.bk.winner_of', { x: id });
  }
  return t('report.bk.tbd');
}

function setHtml(s, byId, ents, me, t) {
  const win = s.w || s.hw || null;
  const mine = s.sl.some((x) => x.e && me.has(x.e));
  const rows = s.sl.map((x) => {
    const cls = ['bk-row', x.e && win === x.e ? 'bk-win' : '', x.e && win && win !== x.e ? 'bk-lose' : '', x.pd ? 'bk-pd' : '', x.e ? '' : 'bk-empty', x.e && me.has(x.e) ? 'bk-me' : ''].filter(Boolean).join(' ');
    const sc = s.s === 3 && x.sc !== null && x.sc !== undefined ? (x.sc < 0 ? 'DQ' : String(x.sc)) : '';
    return `<div class="${cls}"><span class="bk-name">${escapeHtml(slotLabel(x, byId, ents, t))}</span><span class="bk-sc">${escapeHtml(sc)}</span></div>`;
  }).join('');
  const tags = [
    s.s === 2 ? `<span class="bk-tag bk-live">${escapeHtml(t('report.bk.live'))}</span>` : '',
    // start.gg 未反映: この試合の結果が SPSP にだけある (hw) か、start.gg ではまだ空いている枠に SPSP が前の試合の結果から人を入れた (pd)
    s.hw || (s.sl.some((x) => x.pd) && !win) ? `<span class="bk-tag bk-held">${escapeHtml(t('report.bk.held'))}</span>` : '',
  ].join('');
  const head = [s.x, s.st ? t('report.bk.station', { n: s.st }) : ''].filter(Boolean).join(' · ');
  return `<div class="bk-set${mine ? ' bk-mine' : ''}${s.s === 3 ? ' bk-done' : ''}"><div class="bk-head">${escapeHtml(head)}${tags}</div>${rows}</div>`;
}

function rrHtml(sets, ents, me, t) {
  const ids = Array.from(new Set(sets.flatMap((s) => s.sl.map((x) => x.e).filter(Boolean))));
  ids.sort((a, b) => (ents[a] || '').localeCompare(ents[b] || ''));
  const cell = (a, b) => {
    const s = sets.find((x) => x.sl[0].e && x.sl[1].e && ((x.sl[0].e === a && x.sl[1].e === b) || (x.sl[0].e === b && x.sl[1].e === a)));
    if (!s) return '<td></td>';
    const win = s.w || s.hw;
    if (!win) return `<td class="bk-rr-open">${s.s === 2 ? escapeHtml(t('report.bk.live')) : ''}</td>`;
    const k = s.sl[0].e === a ? 0 : 1;
    const sc = s.s === 3 && s.sl[k].sc !== null && s.sl[1 - k].sc !== null ? ` ${s.sl[k].sc}-${s.sl[1 - k].sc}` : '';
    return `<td class="${win === a ? 'bk-win' : 'bk-lose'}${s.hw ? ' bk-held-cell' : ''}">${escapeHtml((win === a ? t('report.bk.rr_w') : t('report.bk.rr_l')) + sc)}</td>`;
  };
  const wins = (a) => sets.filter((s) => (s.w || s.hw) === a).length;
  const head = `<tr><th></th>${ids.map((b) => `<th>${escapeHtml(ents[b] || '?')}</th>`).join('')}<th>${escapeHtml(t('report.bk.rr_wins'))}</th></tr>`;
  const rows = ids.map((a) => `<tr${me.has(a) ? ' class="bk-me"' : ''}><th>${escapeHtml(ents[a] || '?')}</th>${ids.map((b) => (a === b ? '<td class="bk-rr-self"></td>' : cell(a, b))).join('')}<td>${wins(a)}</td></tr>`).join('');
  return `<div class="bk-scroll"><table class="bk-rr">${head}${rows}</table></div>`;
}
