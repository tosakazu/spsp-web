#!/usr/bin/env node
// tests/views/make_fixture.cjs — tests/views/fixtures/build/ (data/views/ 読みと従来の読み方の描画比較に使う小さいビルド出力) を作る。
// テストのたびには走らせない (作った結果を commit してある)。作り直すときだけ:
//
//   node tests/views/make_fixture.cjs --src <本物のビルド出力 (latest_tjpr_full.jsonl などがある dir)> \
//        --python <spsp_scripts の venv の python> --scripts <spsp_scripts の checkout (spsp/cli/build_split_views.py がある)>
//
// 選手は全体から ~170 人だけ選ぶ (総合上位・キャラ 1323 の使い手・東京都・シリーズ「肥後ブラSP」の参加者・大会 1503940 の参加者・
// 計測中・海外・順位なし)。順位などの値は本物のまま (選んだ人の中では飛び飛び)。選手 JSON と大会 JSON は配列を短く切る
// (両方の読み方が同じファイルを読むので、中身が本物どおりである必要はない)。
// views は spsp_scripts の build_split_views.py で作る。分割の挙動を小さい人数でも通すため、1 ファイルの人数 (CHUNK) は 25、
// current/ の分割数は 8 にする (manifest に書かれるのでページはそれに従う)。参加の少ない選手のまとめ (bundle/、SPSP_BUNDLE_SMALL=1) も作る。
// まとめる大きさの上限は 20 KB にして、短く切った大きい選手 (~40 KB) は個別のまま・小さい選手はまとめに入るようにする。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SRC = path.resolve(opt('--src'));
const PY = opt('--python');
const SCRIPTS = path.resolve(opt('--scripts'));
const OUT = path.resolve(__dirname, 'fixtures/build');

const rj = (rel) => JSON.parse(fs.readFileSync(path.join(SRC, rel), 'utf8'));
const wj = (rel, obj) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
fs.rmSync(OUT, { recursive: true, force: true });

const rows = fs.readFileSync(path.join(SRC, 'latest_tjpr_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byUid = new Map(rows.map((r) => [r.user_id, r]));
const overseas = rj('data/overseas.json');
const ovs = new Set(overseas.uids || []);
const prefs = rj('data/player_prefectures.json');
const charIdx = rj('data/character_index.json');
const series = rj('data/series.json');
const higo = series.series.find((s) => s.name === '肥後ブラSP');
const TID = 1503940;
const tour = rj(`tournaments/${TID}.json`);

const S = new Set();
const add = (uid) => { if (byUid.has(uid)) S.add(uid); };
const byEns = rows.slice().sort((a, b) => ((a.ranks || {}).ensemble || 1e9) - ((b.ranks || {}).ensemble || 1e9));
byEns.slice(0, 40).forEach((r) => add(r.user_id));
[1787719, 1983750, 2459574].forEach(add);   // 選手ページの 2 人 + 順位なし (ensemble 0) の 1 人
(charIdx.main_by_char['1323'] || []).slice(0, 25).forEach(add);
rows.filter((r) => prefs[String(r.user_id)] === '東京都').slice(0, 30).forEach((r) => add(r.user_id));
higo.participants.slice(0, 30).forEach((p) => add(p.uid));
tour.standings.slice(0, 25).forEach((s) => add(s.user_id));
rows.filter((r) => r.metadata && r.metadata.provisional).slice(0, 8).forEach((r) => add(r.user_id));
rows.filter((r) => ovs.has(r.user_id)).slice(0, 8).forEach((r) => add(r.user_id));
const keep = (uid) => S.has(Number(uid));
console.log('players', S.size);

// ── 一覧ファイル ──
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'latest_tjpr_full.jsonl'), rows.filter((r) => S.has(r.user_id)).map((r) => JSON.stringify(r)).join('\n') + '\n');
const cur = rj('players_current.json');
wj('players_current.json', { ...cur, players: Object.fromEntries(Object.entries(cur.players).filter(([u]) => keep(u))) });
const meta = rj('meta.json');
wj('meta.json', { ...meta, n_players: S.size });
const pick = (obj) => Object.fromEntries(Object.entries(obj).filter(([u]) => keep(u)));
wj('data/overseas.json', { ...overseas, uids: (overseas.uids || []).filter(keep) });
wj('data/player_prefectures.json', pick(prefs));
wj('data/last_activity.json', pick(rj('data/last_activity.json')));
wj('data/discriminators.json', pick(rj('data/discriminators.json')));
wj('data/player_subranks.json', pick(rj('data/player_subranks.json')));
wj('data/character_index.json', { ...charIdx, main_by_char: Object.fromEntries(Object.entries(charIdx.main_by_char).map(([c, us]) => [c, us.filter(keep)])) });
wj('data/geo.json', rj('data/geo.json'));
wj('data/user_merges.json', rj('data/user_merges.json'));
wj('data/series.json', { ...series, series: [higo] });
const tp = rj('data/tournament_prefectures.json');
wj('data/tournament_prefectures.json', { [String(TID)]: tp[String(TID)] });
const tl = rj('data/tournaments.json');
wj('data/tournaments.json', { ...tl, tournaments: tl.tournaments.filter((t) => t.event_id === TID) });
const up = rj('data/upcoming_entrants.json');
const upIds = Object.keys(up.events).slice(0, 6);
wj('data/upcoming_entrants.json', { ...up, events: Object.fromEntries(upIds.map((k) => [k, up.events[k]])),
  by_uid: Object.fromEntries(Object.entries(up.by_uid).filter(([u]) => keep(u)).map(([u, es]) => [u, es.filter((e) => upIds.includes(String(e)))])) });

// ── 選手 JSON (表示に使う人だけ。配列は短く) ──
const short = (p) => {
  const o = { ...p };
  for (const k of ['tournaments', 'recent_matches', 'bt_timeline', 'bt_timeline_g2']) if (Array.isArray(o[k])) o[k] = o[k].slice(0, k === 'recent_matches' ? 40 : 12);
  for (const k of ['top_tjpr_contribs', 'top_bt_gains', 'top_ufs', 'achievements']) if (Array.isArray(o[k])) o[k] = o[k].slice(0, 6);
  return o;
};
const top2 = byEns.filter((r) => S.has(r.user_id)).slice(0, 2).map((r) => r.user_id);
// 選手ページのライバル欄 (キャラ内・都道府県内で近い順位の人。src/pages/p.js pickBySubrank) は、従来の読み方では players/<uid>.json から名前を引く
// (ページは他の欄で選んだ人を飛ばすので、片側 4 人まで入れておく)
const subr = pick(rj('data/player_subranks.json'));
const neighbors = [];
for (const me of [1787719, 1983750]) {
  const mine = subr[String(me)] || {};
  for (const kind of ['char', 'pref']) {
    const m = mine[kind];
    if (!m) continue;
    const key = kind === 'char' ? m.id : m.name;
    const pool = Object.entries(subr).filter(([u, e]) => Number(u) !== me && e[kind] && (kind === 'char' ? e[kind].id : e[kind].name) === key).map(([u, e]) => ({ uid: Number(u), r: e[kind].rank }));
    neighbors.push(...pool.filter((p) => p.r < m.rank).sort((x, y) => y.r - x.r).slice(0, 4).map((p) => p.uid),
      ...pool.filter((p) => p.r > m.rank).sort((x, y) => x.r - y.r).slice(0, 4).map((p) => p.uid));
  }
}
const tiny = (p) => ({ user_id: p.user_id, display: p.display, scores: p.scores, metadata: p.metadata, characters: p.characters });
// キャラ 1323 の使い手は players/<uid>.json の characters から views の char/ の行に使用実績が入る (使用率の列)
for (const uid of (charIdx.main_by_char['1323'] || []).filter(keep)) neighbors.push(uid);
for (const uid of new Set(neighbors)) if (![1787719, 1983750, ...top2].includes(uid)) wj(`players/${uid}.json`, tiny(rj(`players/${uid}.json`)));
for (const uid of new Set([1787719, 1983750, ...top2])) {
  wj(`players/${uid}.json`, short(rj(`players/${uid}.json`)));
  try { wj(`history/${uid}.json`, rj(`history/${uid}.json`).slice(-30)); } catch (e) { /* 無い人もいる */ }
}
// ── 大会 JSON (選んだ人の分だけ) ──
wj(`tournaments/${TID}.json`, { ...tour, standings: tour.standings.filter((s) => keep(s.user_id)),
  matches: (tour.matches || []).filter((m) => keep(m.w_id) && keep(m.l_id)) });

// ── views ──
const code = `import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import spsp.cli.build_split_views as b; b.CHUNK = 25; b.CURRENT_SHARDS = 8; b.BUNDLE_MAX_BYTES = 20000; print(b.build_views(${JSON.stringify(OUT)}))`;
console.log(execFileSync(PY, ['-c', code], { encoding: 'utf8', env: { ...process.env, OPENBLAS_NUM_THREADS: '1', SPSP_BUNDLE_SMALL: '1' } }).trim());
fs.rmSync(path.join(OUT, '_unbundled_players.txt'), { force: true });   // R2 への送り分け用 (ビルドの作業ファイル)。ページは読まない
