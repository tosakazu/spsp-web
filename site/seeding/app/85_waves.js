// @ts-check
// seeding/app/85_waves.js — SPSP シードツール本体の一部: ウェーブ (連続するプールの塊)。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { startggQuery } from './40_startgg.js';
'use strict';

// ── ウェーブ (= 連続するプールの塊 A,B,C,…) ─────────────────────────
// start.gg の phaseGroups (プール) から displayIdentifier / wave.identifier を読み、
// プール順 (識別子の自然順 = serpentine のプール順) とウェーブ対応を自動取得する。
// 取得できない場合はパネルの「ウェーブ数」手動設定で連続チャンク割りにする。
const PHASE_GROUPS_QUERY = `
  query PhaseGroups($phaseId: ID!, $page: Int!, $perPage: Int!) {
    phase(id: $phaseId) {
      phaseGroups(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages }
        nodes { id displayIdentifier wave { identifier } }
      }
    }
  }
`;

// phaseGroup ノード配列 → ウェーブ情報 (純関数)。
// 返り値: {poolCount, waveCount, poolToWave, letters, identifiers} または null (プールなし)。
// ウェーブ文字は wave.identifier 優先、無ければ displayIdentifier の先頭アルファベット。
// どのプールにも文字が無い (= "1","2",… のみ) ならウェーブ分けなし (waveCount=1)。
/** @param {any[]} nodes @returns {SpspSeedWaves | null} */
function wavesFromGroupNodes(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const parsed = nodes.map((n) => {
    const disp = String((n && n.displayIdentifier) || '');
    const m = disp.match(/^([A-Za-z]+)?\s*0*(\d+)?/) || [];
    const letter = (n && n.wave && n.wave.identifier != null && String(n.wave.identifier).trim())
      ? String(n.wave.identifier).trim().toUpperCase()
      : (m[1] ? m[1].toUpperCase() : null);
    const num = m[2] != null ? parseInt(m[2], 10) : null;
    return { disp, letter, num };
  });
  // 識別子の自然順 (A1, A2, …, A10, B1, …)。文字なしは先頭に数値順で並ぶ。
  parsed.sort((a, b) => {
    const la = a.letter || '', lb = b.letter || '';
    if (la !== lb) return la < lb ? -1 : 1;
    return (a.num || 0) - (b.num || 0);
  });
  const letters = [];
  for (const p of parsed) {
    if (p.letter && !letters.includes(p.letter)) letters.push(p.letter);
  }
  if (!letters.length) {
    return { poolCount: parsed.length, waveCount: 1, poolToWave: parsed.map(() => 0),
             letters: [], identifiers: parsed.map(p => p.disp) };
  }
  const li = new Map(letters.map((l, i) => [l, i]));
  return {
    poolCount: parsed.length,
    waveCount: letters.length,
    poolToWave: parsed.map(p => (p.letter != null ? /** @type {number} */ (li.get(p.letter)) : 0)),
    letters,
    identifiers: parsed.map(p => p.disp),
  };
}

/** @param {string} token @param {number | string} phaseId @returns {Promise<SpspSeedWaves | null>} */
export async function fetchPhaseWaves(token, phaseId) {
  const nodes = [];
  let page = 1;
  while (true) {
    const data = await startggQuery(token, PHASE_GROUPS_QUERY,
      { phaseId: String(phaseId), page, perPage: 64 });
    const pg = data.phase && data.phase.phaseGroups;
    if (!pg) return null;
    nodes.push(...(pg.nodes || []));
    const tot = (pg.pageInfo && pg.pageInfo.totalPages) || 1;
    if (page >= tot || !(pg.nodes || []).length) break;
    page += 1;
    await new Promise(r => setTimeout(r, 300));
  }
  return wavesFromGroupNodes(nodes);
}

// 現在の設定でのプール index → ウェーブ index。自動取得のマップがプール数・ウェーブ数と
// 整合するならそれを使い、そうでなければ連続チャンク割り (先頭側のウェーブから
// floor(P/W)+1 or floor(P/W) プールずつ)。W<=1 なら全プール同一ウェーブ (= 制約なし)。
/** @param {number} P @returns {number[]} */
export function currentWaveMap(P) {
  const W = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-waves') || {}).value, 10) || 1);
  const wv = S.EVENT_CONTEXT && S.EVENT_CONTEXT.waves;
  if (wv && Array.isArray(wv.poolToWave) && wv.poolCount === P && wv.waveCount === W) {
    return wv.poolToWave.slice();
  }
  return chunkWaveMap(P, W);
}
// P プールを W 個の連続チャンクに分ける (純関数)。
/** @param {number} P @param {number} W @returns {number[]} */
function chunkWaveMap(P, W) {
  const map = new Array(P);
  const Wc = Math.max(1, Math.min(W, P));
  const bsize = Math.floor(P / Wc), extra = P % Wc;
  let p = 0;
  for (let w = 0; w < Wc; w++) {
    const sz = bsize + (w < extra ? 1 : 0);
    for (let k = 0; k < sz; k++) map[p++] = w;
  }
  return map;
}
/** @param {number} i @returns {string} */
export function waveLetter(i) { return i < 26 ? String.fromCharCode(65 + i) : 'W' + (i + 1); }
// プール表示名: ウェーブありなら A3 (ウェーブ文字 + ウェーブ内プール番号)、なしなら P3。
/** @param {number} poolIdx @param {number[] | null | undefined} waveMap @returns {string} */
export function poolLabel(poolIdx, waveMap) {
  if (!waveMap || !waveMap.some(w => w > 0)) return 'P' + (poolIdx + 1);
  const w = waveMap[poolIdx];
  let k = 0;
  for (let p = 0; p < poolIdx; p++) if (waveMap[p] === w) k++;
  return waveLetter(w) + (k + 1);
}
