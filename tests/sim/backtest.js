// 過去大会の実データで calc.js の数値を検証する
// A) glicko2 試合ごと変動の再現 (vol=0.06 近似込み)
// B) 順位評価素点 (tjpr_raw) の再現
// C) 180日ピーク (bt_peak_after) の再現
// D) gating 判定 (tracked フラグ) の一致
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');  // 絶対パス直書きをやめ、repo の場所から求める
const fs = require('fs');
const C = ((m) => m.default || m)(require(path.join(REPO, 'site/sim/calc.js')));
const SITE = path.join(REPO, 'site');
const EPU = C.ELO_PER_UNIT;
const EIDS = process.argv.slice(2).map(Number);

function loadPlayer(uid) {
  try { return JSON.parse(fs.readFileSync(`${SITE}/players/${uid}.json`)); }
  catch (e) { return null; }
}
function tsOf(dateStr) { return new Date(dateStr + 'T00:00:00+09:00').getTime() / 1000; }

// 大会前の (rating, rd, lastDate) を timeline から取る
function preState(pj, date) {
  const tl = (pj && pj.bt_timeline_g2) || [];
  let last = null;
  for (const e of tl) { if (e.date < date) last = e; else break; }
  if (!last) return { rating: 1500, rd: 350, lastTs: null };
  return { rating: last.rating, rd: last.rd, lastTs: tsOf(last.date) };
}

// v4/common.py _bracket_order_key の忠実移植 (class prefix 剥がし・top_x 既定 0)
function orderKey(m) {
  const lbl = m.global_bracket_label || '';
  let body = lbl;
  if (body.length >= 2 && 'BCDE'.indexOf(body[0]) >= 0 && body[1] === '-') body = body.slice(2);
  const rt = (m.round_text || '').toLowerCase();
  let side = 0;
  if (rt.indexOf('grand final') >= 0 || body === 'Grand Final') side = 3;
  else if (body.startsWith('Winners')) side = 1;
  else if (body.startsWith('Losers')) side = 2;
  const topx = m.global_top_x != null ? m.global_top_x : 0;
  const reset = rt.indexOf('reset') >= 0 ? 1 : 0;
  return side * 1e12 + (1e9 - topx) * 10 + reset;
}

for (const eid of EIDS) {
  const T = JSON.parse(fs.readFileSync(`${SITE}/tournaments/${eid}.json`));
  const ts = tsOf(T.date);
  const meta = { nent: T.nent, isWeekend: !!T.is_weekend, isCapped: !!(T.is_restricted || T.is_lower_class) };
  console.log(`\n=== ${T.name} (${T.date}, ${T.nent}人, ${T.is_weekend ? '週末' : '平日'}) ===`);

  // 参加者の事前状態
  const uids = new Set();
  T.standings.forEach(s => uids.add(s.user_id));
  T.matches.forEach(m => { uids.add(m.w_id); uids.add(m.l_id); });
  const pre = new Map(), pjCache = new Map();
  for (const uid of uids) {
    const pj = loadPlayer(uid);
    pjCache.set(uid, pj);
    pre.set(uid, preState(pj, T.date));
  }
  const atLv = new Map();
  T.standings.forEach(s => atLv.set(s.user_id, s.at_lv || 1));

  // D) gating 判定一致
  let gateOk = 0, gateNg = 0;
  for (const m of T.matches) {
    const mMeta = m.is_class ? Object.assign({}, meta, { isCapped: true }) : meta;
    for (const [uid, tracked] of [[m.w_id, m.w_tracked], [m.l_id, m.l_tracked]]) {
      const ours = C.tournamentPassesLv(atLv.get(uid) || 1, mMeta);
      if (!!ours === !!tracked) gateOk++; else gateNg++;
    }
  }
  console.log(`D) gating: 一致 ${gateOk} / 不一致 ${gateNg} (${(100*gateOk/(gateOk+gateNg)).toFixed(1)}%)`);

  // A) glicko2 リプレイ
  const players = new Map();
  for (const uid of uids) {
    const p0 = pre.get(uid);
    const g = new C.G2Player(p0.rating, p0.rd, 0.06);
    if (p0.lastTs) C.applyInactivity(g, (ts - p0.lastTs) / 86400);
    players.set(uid, g);
  }
  const ms = T.matches.slice().sort((a, b) => orderKey(a) - orderKey(b));
  let dErrs = [], nTracked = 0;
  for (const m of ms) {
    const w = players.get(m.w_id), l = players.get(m.l_id);
    const wr = w.rating(), wrd = w.rd(), lr = l.rating(), lrd = l.rd();
    if (m.w_tracked) { w.update([lr], [lrd], [1]); }
    if (m.l_tracked) { l.update([wr], [wrd], [0]); }
    if (m.w_tracked && m.w_d != null) {
      dErrs.push(Math.abs(Math.max(0, (w.rating() - wr) / EPU) - m.w_d)); nTracked++;
    }
    if (m.l_tracked && m.l_d != null) {
      dErrs.push(Math.abs(Math.min(0, (l.rating() - lr) / EPU) - m.l_d)); nTracked++;
    }
  }
  dErrs.sort((a, b) => a - b);
  const mean = dErrs.reduce((s, x) => s + x, 0) / dErrs.length;
  const p90 = dErrs[Math.floor(dErrs.length * 0.9)];
  const worst = dErrs[dErrs.length - 1];
  console.log(`A) glicko2: ${nTracked}側 平均誤差 ${(mean*EPU).toFixed(3)}elo p90 ${(p90*EPU).toFixed(3)}elo 最大 ${(worst*EPU).toFixed(3)}elo`);

  // B) 素点再現 (place ごと)
  const wins = new Map();
  T.matches.forEach(m => wins.set(m.w_id, (wins.get(m.w_id) || 0) + 1));
  const ratings = T.standings.map(s => pre.get(s.user_id).rating);
  const bz = C.buildBanzuke(ratings, T.nent);
  let rawOk = 0, rawNg = 0, rawErrMax = 0, ngSamples = [];
  for (const s of T.standings) {
    if (!s.tjpr_lv || s.tjpr_lv <= 0) continue;
    let ours = (wins.get(s.user_id) || 0) === 0 ? 0 : C.tjprRawForPlace(bz, s.tjpr_lv, s.place);
    const err = Math.abs(ours - s.tjpr_raw);
    rawErrMax = Math.max(rawErrMax, err);
    if (err < 0.05) rawOk++; else { rawNg++; if (ngSamples.length < 3) ngSamples.push(`${s.display}(${s.place}位 lv${s.tjpr_lv}) js=${ours.toFixed(2)} 実=${s.tjpr_raw}`); }
  }
  console.log(`B) 素点: 一致(±0.05) ${rawOk} / 不一致 ${rawNg} 最大誤差 ${rawErrMax.toFixed(3)}`);
  ngSamples.forEach(x => console.log('   NG例:', x));

  // C) ピーク再現 (上位30名の player json 行と比較)
  let pkOk = 0, pkNg = 0, pkMax = 0;
  for (const s of T.standings.slice(0, 30)) {
    const pj = pjCache.get(s.user_id);
    if (!pj) continue;
    const row = (pj.tournaments || []).find(r => r.event_id === eid);
    if (!row || !row.bt_used) continue;
    const hist = (pj.bt_timeline_g2 || []).filter(e => e.date <= T.date)
      .map(e => ({ ts: tsOf(e.date), rating: e.rating }));
    const cur = hist.length ? hist[hist.length - 1].rating : 1500;
    const peak = C.peakAt(hist, ts, cur) / EPU;
    const err = Math.abs(peak - row.bt_peak_after);
    pkMax = Math.max(pkMax, err);
    if (err < 0.01) pkOk++; else pkNg++;
  }
  console.log(`C) ピーク: 一致(±0.01ord) ${pkOk} / 不一致 ${pkNg} 最大誤差 ${pkMax.toFixed(4)}ord`);
}
