// ページと同じ経路で 水無灯里(2377204) × グランドスラム(1651150) を計算
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');  // 絶対パス直書きをやめ、repo の場所から求める
const fs = require('fs');
const C = ((m) => m.default || m)(require(path.join(REPO, 'site/sim/calc.js')));
const SITE = path.join(REPO, 'site');
const UID = 2377204, EID = '1651150';

const MASTER = new Map();
for (const line of fs.readFileSync(`${SITE}/latest_tjpr_full.jsonl`, 'utf8').split('\n')) {
  if (!line) continue;
  const rec = JSON.parse(line);
  const sc = rec.scores || {};
  MASTER.set(rec.user_id, {
    display: rec.display, tjpr_score: sc.tjpr_score || 0,
    bt_gated_elo: sc.bt_gated_elo || 0, bt_internal_elo: sc.bt_internal_elo || 0,
    lv: sc.shared_cascade_lv || 0, gray: !!(rec.metadata && rec.metadata.provisional),
  });
}
const overseas = new Set(JSON.parse(fs.readFileSync(`${SITE}/data/overseas.json`)).uids);
MASTER.forEach((v, uid) => { if (overseas.has(uid)) v.gray = true; });

const UP = JSON.parse(fs.readFileSync(path.join(REPO, 'site/data/upcoming_entrants.json')));
const ev = UP.events[EID];
const PLAYER = JSON.parse(fs.readFileSync(`${SITE}/players/${UID}.json`));

const lv = PLAYER.scores.shared_cascade_lv;
const entries = C.extractEntries(PLAYER);
const nent = ev.entrants.length;
console.log(`event=${ev.tournament_name} nent=${nent} weekend=${ev.is_weekend} lv=${lv}`);
console.log('gating pass:', C.tournamentPassesLv(lv, {nent, isWeekend: ev.is_weekend, isCapped: false}));

const ratings = ev.entrants.map(e => {
  const m = e.uid && MASTER.get(e.uid);
  return m && m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500;
});
const bz = C.buildBanzuke(ratings, nent);
const baseAgg = C.aggregateEntries(entries, lv);
const cur = PLAYER.scores.tjpr_score;

const tjprArr = [];
MASTER.forEach((v, uid) => { if (uid !== UID) tjprArr.push({score: v.tjpr_score, gray: v.gray}); });
tjprArr.sort((a, b) => b.score - a.score);
console.log(`現在: tjpr_score=${cur} rank=${PLAYER.ranks.tjpr}, 再現rank=${C.provisionalRank(tjprArr, cur)}`);

const maxTier = C.placementToTier(bz.n);
for (let tier = 0; tier <= Math.min(maxTier, 12); tier++) {
  const place = C.tierBestPlace(tier);
  const raw = C.tjprRawForPlace(bz, lv, place);
  const ns = cur + C.aggregateEntries(entries.concat([raw]), lv) - baseAgg;
  console.log(`${String(place).padStart(3)}位: 素点=${raw.toFixed(2).padStart(7)} newScore=${ns.toFixed(2)} (+${(ns-cur).toFixed(2)}) 暫定#${C.provisionalRank(tjprArr, ns)}`);
}

// BT sim: 現レート/rd + 篝火クラスの相手に 2 連勝
const tl = PLAYER.bt_timeline_g2;
const last = tl[tl.length - 1];
const me = new C.G2Player(PLAYER.scores.bt_internal_elo, last.rd, 0.06);
const days = (ev.start_at - new Date(last.date + 'T00:00:00+09:00').getTime() / 1000) / 86400;
C.applyInactivity(me, days);
console.log(`\nBT: rating=${me.rating().toFixed(1)} rd=${me.rd().toFixed(1)} (inactivity ${days.toFixed(0)}d)`);
const oppUid = ev.entrants.find(e => e.uid && MASTER.get(e.uid) && MASTER.get(e.uid).bt_internal_elo > 2400);
const om = MASTER.get(oppUid.uid);
const oppPj = JSON.parse(fs.readFileSync(`${SITE}/players/${oppUid.uid}.json`));
const otl = oppPj.bt_timeline_g2;
const opp = new C.G2Player(om.bt_internal_elo, otl[otl.length-1].rd, 0.06);
console.log(`opp=${om.display} rating=${opp.rating().toFixed(1)} rd=${opp.rd().toFixed(1)}`);
for (const won of [1, 1]) {
  const mr = me.rating(), mrd = me.rd(), or_ = opp.rating(), ord_ = opp.rd();
  me.update([or_], [ord_], [won]);
  opp.update([mr], [mrd], [1 - won]);
  console.log(`勝ち → me=${me.rating().toFixed(1)} (+${(me.rating()-mr).toFixed(1)}) opp=${opp.rating().toFixed(1)}`);
}
const history = tl.map(x => ({ts: new Date(x.date + 'T00:00:00+09:00').getTime()/1000, rating: x.rating}));
const peakAfter = Math.max(C.peakAt(history, ev.start_at, me.rating()), me.rating());
console.log(`直対評価: ${PLAYER.scores.bt_gated_elo} → ${peakAfter.toFixed(1)}`);
