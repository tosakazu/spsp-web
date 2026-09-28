// @ts-check
// seeding/app/10_skeleton.js — SPSP シードツール本体の一部: ページスケルトン (本体 HTML) と SEED_APP_CONFIG。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import SPSPI18n from '../../js/i18n.js';
'use strict';

// 文言は i18n/ja.js (js/i18n.js を先に読む)。seeding/app/*.js は同じグローバル字句環境なので他のファイルからも使える
export const i18n = SPSPI18n.t;
import { escapeHtml } from '../../js/html.js';

// 地域まとめのトグル (data/geo.json の seed_groups。定義元は smash_database の scripts/<地域>/geo.py)。
// id は so-group-<seed_group id 小文字> (minamiKanto → so-group-minamikanto)。geo.json は起動後に読むので、
// 骨格には置き場 (#so-group-box) だけ置き、読めたら renderRegionGroupToggles (99_bootstrap.js) が入れる。まとめが無い地域では空。
export function regionGroupToggleId(def) { return `so-group-${String(def.id).toLowerCase()}`; }
export function regionGroupToggles(geo) {
  const units = geo && geo.units ? geo.units : [];
  // 単位の短い名前 (日本語なら「東京」、英語なら「Tokyo」)
  const shortName = (id) => {
    const u = units.find((x) => x.id === id);
    const nm = (u && SPSPI18n.pick(u.name)) || id;
    return nm.replace(/[都府県]$/, '');
  };
  return (geo && geo.seed_groups ? geo.seed_groups : []).map((g) => {
    const names = (g.units || []).map(shortName).join(i18n('seed.skeleton.unit_sep'));
    const name = SPSPI18n.pick(g.name) || g.id;
    return `<label title="${escapeHtml(i18n('seed.skeleton.group_help', { name, units: names }))}"><input type="checkbox" id="${regionGroupToggleId(g)}"${g.default ? ' checked' : ''}> ${escapeHtml(i18n('seed.skeleton.group_toggle', { units: names }))}</label>`;
  }).join('\n      ');
}

// ── ページスケルトン (本体 HTML)。ページには <div id="seed-app-root"></div> だけ置く ──
const SEED_APP_SKELETON_HTML = `
<div class="header">
  <h1>${i18n('seed.skeleton.t1')}</h1>
  <p class="subtitle">${i18n('seed.skeleton.t2')}</p>

  <div class="upcoming-box open" id="upcoming-box">
    <div class="upcoming-toggle" id="upcoming-toggle">
      <span class="chev">▶</span>
      <span>${i18n('seed.skeleton.t3')}</span>
      <span class="badge" id="upcoming-count" style="display:none">0</span>
      <span style="color:#9ca3af;font-weight:400;font-size:11px;margin-left:auto">${i18n('seed.skeleton.t4')}</span>
    </div>
    <div class="upcoming-body" id="upcoming-body">
      <div class="upcoming-loading" id="upcoming-loading">${i18n('seed.skeleton.t5')}</div>
      <div class="upcoming-pager" id="upcoming-pager" style="display:none">
        <button type="button" id="upcoming-prev">${i18n('seed.skeleton.t6')}</button>
        <span id="upcoming-pageinfo">1 / 1</span>
        <button type="button" id="upcoming-next">${i18n('seed.skeleton.t7')}</button>
      </div>
      <div class="upcoming-list" id="upcoming-list" style="display:none"></div>
    </div>
  </div>

  <form id="seed-form" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <label for="token" style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">
          start.gg API Token
          <a href="https://start.gg/admin/profile/developer" target="_blank" rel="noopener" style="color:#dc2626;margin-left:6px;font-size:10px;text-decoration:underline">${i18n('seed.skeleton.t8')}</a>
        </label>
        <div style="display:flex;gap:4px;align-items:stretch">
          <input type="password" id="token" placeholder="xxxxxxxxxxxxxxxxxxxx" autocomplete="off"
            style="flex:1;min-width:0;padding:8px 12px;background:#f9fafb;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:inherit">
          <button type="button" id="token-reveal" title="${i18n('seed.skeleton.t116')}"
            style="background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:6px;padding:0 10px;font-size:14px;cursor:pointer;font-family:inherit">👁</button>
          <button type="button" id="token-save" title="${i18n('seed.skeleton.t117')}"
            style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:0 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">${i18n('seed.skeleton.t9')}</button>
        </div>
        <div id="token-hint" style="font-size:10px;color:#9ca3af;margin-top:3px;height:14px"></div>
      </div>
      <div style="flex:2;min-width:280px">
        <label for="event-url" style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">${i18n('seed.skeleton.t10')}</label>
        <input type="text" id="event-url" placeholder="https://www.start.gg/tournament/15-kagaribi-15/event/singles"
          style="width:100%;padding:8px 12px;background:#f9fafb;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:inherit">
        <div id="event-url-help" style="font-size:10px;color:#9ca3af;margin-top:3px">${i18n('seed.skeleton.t11')} <code>/event/...</code> ${i18n('seed.skeleton.t12')}</div>
      </div>
      <div style="display:flex;align-items:flex-end;padding-bottom:14px">
        <button type="submit" id="fetch-btn" style="background:#dc2626;color:#fff;border:none;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">${i18n('seed.skeleton.t13')}</button>
      </div>
    </div>
    <div id="phase-row" style="display:none">
      <label for="phase-select" style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">${i18n('seed.skeleton.t14')}</label>
      <select id="phase-select" style="width:100%;padding:8px 12px;background:#f9fafb;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:inherit"></select>
    </div>
    <!-- phase 未作成 event 用: シード適用時に自動作成する phase の設定 -->
    <div id="phase-create-row" style="display:none;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px">
      <div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:6px">${i18n('seed.skeleton.t15')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <label for="pc-group-count" style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">${i18n('seed.skeleton.t16')}</label>
          <input type="number" id="pc-group-count" value="1" min="1" max="128" step="1"
            style="width:72px;padding:7px 10px;background:#f9fafb;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:inherit">
        </div>
        <div>
          <label for="pc-phase-name" style="font-size:11px;color:#6b7280;display:block;margin-bottom:2px">${i18n('seed.skeleton.t17')}</label>
          <input type="text" id="pc-phase-name" value="Bracket" maxlength="80"
            style="width:140px;padding:7px 10px;background:#f9fafb;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;font-family:inherit">
        </div>
      </div>
    </div>
  </form>

  <div id="event-picker">
    <div class="label">${i18n('seed.skeleton.t18')}</div>
    <div class="pe-list" id="event-picker-list"></div>
  </div>

  <div class="method-tabs" id="method-tabs" style="display:none">
    <div class="method-tab active" data-method="ensemble">
      ${i18n('seed.skeleton.t19')}<span class="tab-desc">${i18n('seed.skeleton.t20')}</span>
    </div>
    <div class="method-tab" data-method="tjpr">
      ${i18n('seed.skeleton.t21')}<span class="tab-desc">${i18n('seed.skeleton.t22')}</span>
    </div>
    <div class="method-tab" data-method="bt_gated">
      ${i18n('seed.skeleton.t23')}<span class="tab-desc">${i18n('seed.skeleton.t24')}</span>
    </div>
  </div>

  <div class="controls">
    <input type="search" id="search" placeholder="${i18n('seed.skeleton.t118')}" autocomplete="off" style="display:none">
    <button id="csv-btn" disabled style="background:#16a34a;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:none">${i18n('seed.skeleton.t25')}</button>
    <button id="upload-btn" disabled style="background:#b91c1c;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:none">${i18n('seed.skeleton.t26')}</button>
    <label id="auto-opt-label" style="display:none;font-size:12px;color:#374151;white-space:nowrap"><input type="checkbox" id="so-auto-apply" checked> ${i18n('seed.skeleton.t27')}</label>
    <span class="status" id="status">${i18n('seed.skeleton.t28')}</span>
  </div>
  <div id="error-help" style="display:none;margin-top:8px"></div>
</div>

<!-- 🔀 被り回避最適化パネル -->
<div id="seedopt-panel" style="display:none;max-width:1400px;margin:14px auto 0;padding:12px 24px">
  <details id="seedopt-details" style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa">
    <summary style="cursor:pointer;list-style:revert">
      <strong style="font-size:14px;color:#111827">${i18n('seed.skeleton.t29')}</strong>
      <span style="font-size:11px;color:#6b7280">${i18n('seed.skeleton.t30')}</span>
    </summary>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
      <label style="font-size:11px;color:#6b7280">${i18n('seed.skeleton.t16')}
        <input type="number" id="so-pools" value="1" min="1" max="128" step="1"
          style="display:block;width:80px;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:13px">
      </label>
      <label style="font-size:11px;color:#6b7280" title="${i18n('seed.skeleton.t119')}">${i18n('seed.skeleton.t31')}
        <input type="number" id="so-waves" value="1" min="1" max="26" step="1"
          style="display:block;width:80px;padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:13px">
      </label>
      <span id="so-waves-label" style="font-size:11px;color:#9ca3af"></span>
      <span id="so-format-label" style="font-size:11px;color:#9ca3af"></span>
      <span style="display:inline-flex;align-items:center;gap:4px"><button id="so-run" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">${i18n('seed.skeleton.t32')}</button></span>
      <button id="so-stop" disabled style="background:#6b7280;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:none">${i18n('seed.skeleton.t33')}</button>
      <button id="so-cancel" title="${i18n('seed.skeleton.t120')}" style="background:#fff;color:#374151;border:1px solid #d1d5db;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:none">${i18n('seed.skeleton.t34')}</button>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12px;color:#374151">
      <label title="${i18n('seed.skeleton.t121')}"><input type="checkbox" id="so-enable-intra" checked> ${i18n('seed.skeleton.t35')}</label>
      <label title="${i18n('seed.skeleton.t122')}"><input type="checkbox" id="so-avoid-region" checked> ${i18n('seed.skeleton.t36')}</label>
      <label title="${i18n('seed.skeleton.t123')}"><input type="checkbox" id="so-avoid-recent" checked> ${i18n('seed.skeleton.t37')}</label>
      <label title="${i18n('seed.skeleton.t124')}"><input type="checkbox" id="so-keep-deplace" checked> ${i18n('seed.skeleton.t38')}</label>
      <label title="${i18n('seed.skeleton.t125')}"><input type="checkbox" id="so-scope-winners" checked> ${i18n('seed.skeleton.t39')}</label>
      <label title="${i18n('seed.skeleton.t126')}"><input type="checkbox" id="so-include-weekday"> ${i18n('seed.skeleton.t40')}</label>
      <label><input type="checkbox" id="so-avoid-series" checked> ${i18n('seed.skeleton.t41')}</label>
      <span id="so-series-box" style="display:none;font-size:11px;color:#6b7280">
        <select id="so-series-select" style="padding:3px 5px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;max-width:220px">
          <option value="">${i18n('seed.skeleton.t42')}</option>
        </select>
        <span id="so-series-note" style="margin-left:5px"></span>
      </span>
      <span id="so-group-box" style="display:contents"></span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:12px;color:#374151">
      <span id="so-shiftlimit-label" style="font-weight:600">${i18n('seed.skeleton.t45')}</span>
      <label>${i18n('seed.skeleton.t46')} <input type="number" id="so-shift0" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t48')} <input type="number" id="so-shift1" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t49')} <input type="number" id="so-shift2" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t50')} <input type="number" id="so-shift3" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t51')} <input type="number" id="so-shift4" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t52')} <input type="number" id="so-shift5" min="1" style="width:52px"> ${i18n('seed.skeleton.t47')}</label>
      <label>${i18n('seed.skeleton.t53')}<input type="number" id="so-maxshift" min="0" step="1" placeholder="${i18n('seed.skeleton.t129')}" style="width:56px"></label>
      <span style="color:#9ca3af;font-size:10px">${i18n('seed.skeleton.t54')}</span>
    </div>
    <div style="margin-top:10px;font-size:12px;color:#374151;max-width:360px">
      <div style="display:flex;align-items:center;gap:8px">
        <span id="so-orderpow-label" style="font-weight:600" title="${i18n('seed.skeleton.t130')}">${i18n('seed.skeleton.t55')}</span>
        <span id="so-orderpow-val" style="font-variant-numeric:tabular-nums;font-weight:700;font-size:11px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:1px 10px;min-width:34px;text-align:center">2.5</span>
      </div>
      <input type="range" id="so-orderpow" min="0" max="5" step="0.5" value="2.5" style="display:block;width:100%;margin:8px 0 3px;accent-color:#dc2626">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#9ca3af">
        <span>${i18n('seed.skeleton.t56')}</span><span>${i18n('seed.skeleton.t57')}</span>
      </div>
    </div>
    <div style="margin-top:8px">
      <details>
        <summary style="font-size:11px;color:#6b7280;cursor:pointer">${i18n('seed.skeleton.t58')}</summary>
        <div style="margin-top:8px;font-size:11px;color:#6b7280">
          <div style="font-weight:600;color:#374151;margin:6px 0 2px">${i18n('seed.skeleton.t59')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <label>${i18n('seed.skeleton.t60')}
              <select id="so-mode" style="display:block;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                <option value="multistart-sa">${i18n('seed.skeleton.t61')}</option>
                <option value="multistart-hillclimb">${i18n('seed.skeleton.t62')}</option>
                <option value="sa">${i18n('seed.skeleton.t63')}</option>
                <option value="hillclimb">${i18n('seed.skeleton.t64')}</option>
              </select>
            </label>
            <label>${i18n('seed.skeleton.t65')}<input type="number" id="so-restarts" value="15" min="1" max="100" style="display:block;width:64px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label>${i18n('seed.skeleton.t66')}<input type="number" id="so-cooling" value="0.999" step="0.001" min="0.5" max="0.9999" style="display:block;width:72px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t131')}">${i18n('seed.skeleton.t67')}<input type="number" id="so-itersscale" value="1000" min="10" max="2000" step="10" style="display:block;width:72px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label>${i18n('seed.skeleton.t68')}<input type="number" id="so-rngseed" value="12345" style="display:block;width:84px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
          </div>
          <div style="font-weight:600;color:#374151;margin:8px 0 2px">${i18n('seed.skeleton.t69')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <label>${i18n('seed.skeleton.t70')}<input type="number" id="so-wregion" value="1.0" step="0.1" style="display:block;width:72px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label>${i18n('seed.skeleton.t71')}<input type="number" id="so-wrecent" value="0.3" step="0.05" style="display:block;width:72px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t132')}">${i18n('seed.skeleton.t72')}<input type="number" id="so-worder" value="0.001" step="0.005" min="0" style="display:block;width:80px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t133')}">${i18n('seed.skeleton.t73')}<input type="number" id="so-seriesmult" value="3" step="0.5" min="1" style="display:block;width:72px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t134')}">${i18n('seed.skeleton.t74')}
              <select id="so-seriesmode" style="display:block;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                <option value="mult">${i18n('seed.skeleton.t75')}</option>
                <option value="add">${i18n('seed.skeleton.t76')}</option>
              </select>
            </label>
            <label title="${i18n('seed.skeleton.t135')}">${i18n('seed.skeleton.t77')}<input type="number" id="so-wseries" value="0.3" step="0.05" min="0" style="display:block;width:84px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label>${i18n('seed.skeleton.t78')}
              <select id="so-prefweight" style="display:block;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                <option value="inv_sqrt">${i18n('seed.skeleton.t79')}</option>
                <option value="inv">${i18n('seed.skeleton.t80')}</option>
                <option value="inv_log">${i18n('seed.skeleton.t81')}</option>
                <option value="const">${i18n('seed.skeleton.t82')}</option>
              </select>
            </label>
          </div>
          <div style="font-weight:600;color:#374151;margin:8px 0 2px">${i18n('seed.skeleton.t83')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <label title="${i18n('seed.skeleton.t136')}">${i18n('seed.skeleton.t84')}<input type="text" id="so-decaypoints" placeholder="0:1,30:1,91:0.5,182.5:0.25,365:0" style="display:block;width:300px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label>${i18n('seed.skeleton.t85')}
              <select id="so-sizeweight" style="display:block;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                <option value="log2">${i18n('seed.skeleton.t86')}</option>
                <option value="sqrt">${i18n('seed.skeleton.t87')}</option>
                <option value="linear">${i18n('seed.skeleton.t88')}</option>
              </select>
            </label>
            <label title="${i18n('seed.skeleton.t137')}">${i18n('seed.skeleton.t89')}
              <select id="so-recentagg" style="display:block;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px">
                <option value="max">${i18n('seed.skeleton.t90')}</option>
                <option value="sum">${i18n('seed.skeleton.t91')}</option>
              </select>
            </label>
          </div>
          <div style="font-weight:600;color:#374151;margin:8px 0 2px">${i18n('seed.skeleton.t92')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <label>${i18n('seed.skeleton.t93')}<input type="text" id="so-roundweights" placeholder="1,0.6,0.4,0.06,0.02" style="display:block;width:160px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t138')}">${i18n('seed.skeleton.t94')}<input type="text" id="so-kinter" placeholder="${i18n('seed.skeleton.t139')}" style="display:block;width:160px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
            <label title="${i18n('seed.skeleton.t140')}">${i18n('seed.skeleton.t95')}<input type="text" id="so-kintra" placeholder="${i18n('seed.skeleton.t141')}" style="display:block;width:160px;padding:4px;border:1px solid #d1d5db;border-radius:5px;font-size:12px"></label>
          </div>
        </div>
      </details>
    </div>
    <div style="margin-top:8px;display:flex;justify-content:flex-end;align-items:center;gap:4px">
      <button id="so-reset-defaults" style="background:#fff;color:#6b7280;border:1px solid #d1d5db;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit">${i18n('seed.skeleton.t96')}</button>
    </div>
    <div id="so-progress" style="margin-top:10px;font-size:12px;color:#374151"></div>
    <div id="so-report" style="margin-top:10px;font-size:12px;color:#374151"></div>
  </details>
</div>

<!-- 📌 シード指定・固定パネル: CSV で一部プレイヤーの順位/ウェーブ指定 + プール/ウェーブ固定 -->
<div id="spec-panel" style="display:none;max-width:1400px;margin:10px auto 0;padding:0 24px">
  <details style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;background:#fafafa">
    <summary style="cursor:pointer;list-style:revert">
      <strong style="font-size:13px;color:#111827">${i18n('seed.skeleton.t97')}</strong>
      <span style="font-size:11px;color:#6b7280">${i18n('seed.skeleton.t98')}</span>
    </summary>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
      <input type="text" id="spec-src-url" placeholder="${i18n('seed.skeleton.t142')}" style="flex:1;min-width:220px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px">
      <span style="font-size:11px;color:#6b7280">or</span>
      <input type="file" id="spec-src-file" accept=".csv,text/csv" style="font-size:11px">
      <button id="spec-src-load" style="background:#2563eb;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">${i18n('seed.skeleton.t99')}</button>
      <button id="spec-tpl" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:8px 12px;border-radius:6px;font-size:12px;cursor:pointer">${i18n('seed.skeleton.t100')}</button>
      <button id="spec-clear" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:8px 12px;border-radius:6px;font-size:12px;cursor:pointer">${i18n('seed.skeleton.t101')}</button>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px;line-height:1.6">
      ${i18n('seed.skeleton.t102')}<b>uid</b> / <b>discriminator</b> / <b>seedId</b> / <b>name</b>${i18n('seed.skeleton.t103')}
      <b>seed</b> ${i18n('seed.skeleton.t104')} <b>wave</b> ${i18n('seed.skeleton.t105')}
      <b>lock</b> ${i18n('seed.skeleton.t106')}
      ${i18n('seed.skeleton.t107')}
      <b>${i18n('seed.skeleton.t108')}</b> ${i18n('seed.skeleton.t109')}
      ${i18n('seed.skeleton.t110')}
    </div>
    <div id="spec-status" style="font-size:11px;color:#374151;margin-top:5px;line-height:1.6"></div>
  </details>
</div>

<!-- 作業状況の保存 (現在のシード順 + 固定を CSV に。読み込みは 📌 パネル側) -->
<div id="work-bar" style="display:none;margin:10px 0 0">
  <button id="spec-export" style="background:#16a34a;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">${i18n('seed.skeleton.t111')}</button>
  <button id="bracket-preview" title="${i18n('seed.skeleton.t143')}" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-left:6px">${i18n('seed.skeleton.t112')}</button>
  <span id="work-note" style="font-size:11px;color:#6b7280;margin-left:8px"></span>
</div>

<!-- 手動調整モード: ロック解除で通常のランキング表のまま並べ替えできる (自動保存/undo/redo) -->
<div id="manual-bar" style="display:none;margin:10px 0 6px"></div>

<div class="table-wrap">
  <table id="ranktable">
    <!-- thead は SPSPRankingTable コンポーネントが自動生成 -->
    <tbody id="tbody">
      <tr><td colspan="9" class="empty-msg">${i18n('seed.skeleton.t113')}</td></tr>
    </tbody>
  </table>
</div>

<div style="max-width:1400px;margin:24px auto 0;padding:0 24px;font-size:11px;color:#9ca3af;line-height:1.6">
  ${i18n('seed.skeleton.t114')}
  ${i18n('seed.skeleton.t115')}
</div>`;

export const SEED_APP_CONFIG = Object.assign({ mode: 'spsp' }, window.SEED_APP_CONFIG || {});
(function mountSeedAppSkeleton() {
  const root = document.getElementById('seed-app-root');
  if (!root) throw new Error(i18n('seed.skeleton.s1'));
  root.innerHTML = SEED_APP_SKELETON_HTML;
  // csv モード: ページ名・説明をシードアップロード用に差し替え
  if (SEED_APP_CONFIG.mode === 'csv') {
    const h1 = root.querySelector('.header h1');
    if (h1) h1.textContent = i18n('seed.skeleton.s2');
    const sub = root.querySelector('.header .subtitle');
    if (sub) sub.textContent = i18n('seed.skeleton.s3');
    // 「参加者を取得」ボタンは不要 (適用時に URL から seedId を自動取得する)。
    const fb = /** @type {HTMLElement | null} */ (root.querySelector('#fetch-btn'));
    if (fb) fb.style.display = 'none';
    const urlHelp = /** @type {HTMLElement | null} */ (root.querySelector('#event-url-help'));
    if (urlHelp) urlHelp.style.display = 'none';
    // 「参加者を取得」前提の案内文も CSV 向けに差し替え
    const st = root.querySelector('#status');
    if (st) st.textContent = i18n('seed.skeleton.s4');
    const emptyMsg = root.querySelector('#ranktable .empty-msg');
    if (emptyMsg) emptyMsg.textContent = i18n('seed.skeleton.s5');
  }
  // csv モード: 基準順位ソース (CSV / Sheets) の入力欄を差し込む
  if (SEED_APP_CONFIG.mode === 'csv') {
    const anchorEl = root.querySelector('#event-picker');
    const div = document.createElement('div');
    div.id = 'csv-source-row';
    div.style.cssText = 'background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 12px;margin-top:10px';
    div.innerHTML = `<div style="font-size:12px;font-weight:600;color:#1e40af;margin-bottom:6px">📄 ${i18n('seed.skeleton.s7')}</div>`
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
      + `<input type="text" id="csv-src-url" placeholder="${i18n('seed.skeleton.s8')}" style="flex:1;min-width:220px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px">`
      + '<span style="font-size:11px;color:#6b7280">or</span>'
      + '<input type="file" id="csv-src-file" accept=".csv,text/csv" style="font-size:11px">'
      + `<button id="csv-src-load" style="background:#2563eb;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">${i18n('seed.skeleton.s9')}</button>`
      + `<button id="csv-tpl" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:8px 12px;border-radius:6px;font-size:12px;cursor:pointer">${i18n('seed.skeleton.s10')}</button>`
      + '</div>'
      + '<div id="csv-src-status" style="font-size:11px;color:#6b7280;margin-top:5px;line-height:1.5">'
      + i18n('seed.skeleton.s6')
      + i18n('seed.skeleton.s11') + '</div>';
    if (anchorEl && anchorEl.parentNode) anchorEl.parentNode.insertBefore(div, anchorEl);
  }
})();
