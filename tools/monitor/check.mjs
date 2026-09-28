// tools/monitor/check.mjs — spsp.games の外形監視 (GitHub Actions の monitor.yml が 1 時間おきに実行、失敗すると GitHub がメールで知らせる)。
// サーバ (ConoHa WING) の nightly は出力を捨てているので、止まっても誰も気づかない。外から「データが新しいか」「サイトが応答するか」を見る (2026-09-28)。
//   node tools/monitor/check.mjs            (環境変数 MAX_DATA_AGE_H = データの古さの上限 (時間、既定 8)、MAX_TOUR_AGE_D = 最新大会の古さの上限 (日、既定 8))
// 見ること:
//   1. データの鮮度: data.spsp.games/jp/meta.json の generated_at (nightly は 3 時間おき + 同期。全件の同期は 1.5 時間かかることがある)
//   2. 大会の取り込み: data/tournaments.json の最新の大会日 (start.gg のトークン切れなどで取得だけ止まっても generated_at は新しいまま)
//   3. サイト: /jp/ が 200、/ が /jp/ へ 301、一覧ファイルが 200、データの CORS、/api が応答する (Worker)
const MAX_DATA_AGE_H = Number(process.env.MAX_DATA_AGE_H || 8);   // 日本のビルドは 1 日 5 回 (0,6,12,18,21 時起動、間隔は最大 6 時間) + ビルドと同期の時間 (2026-09-29)
const MAX_TOUR_AGE_D = Number(process.env.MAX_TOUR_AGE_D || 8);
const SITE = 'https://spsp.games';
const DATA = 'https://data.spsp.games/jp/';
const problems = [];
const ok = [];
const check = async (name, fn) => {
  try { const msg = await fn(); ok.push(`${name}: ${msg}`); }
  catch (e) { problems.push(`${name}: ${e && e.message ? e.message : e}`); }
};
const get = async (url, init) => {
  const res = await fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': 'spsp-monitor/1.0', ...(init && init.headers) } });
  return res;
};

await check('データの鮮度 (meta.json)', async () => {
  const res = await get(DATA + 'meta.json?monitor=' + Date.now());
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const meta = await res.json();
  const t = Date.parse(meta.generated_at);
  if (!Number.isFinite(t)) throw new Error('generated_at が読めない: ' + meta.generated_at);
  const ageH = (Date.now() - t) / 3600e3;
  if (ageH > MAX_DATA_AGE_H) throw new Error(`generated_at ${meta.generated_at} (${ageH.toFixed(1)} 時間前、上限 ${MAX_DATA_AGE_H} 時間)。nightly か R2 同期が止まっている`);
  return `${meta.generated_at} (${ageH.toFixed(1)} 時間前、${meta.n_tournaments_total} 大会、${meta.n_players} 人)`;
});

await check('大会の取り込み (tournaments.json)', async () => {
  const res = await get(DATA + 'data/tournaments.json');
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  const dates = (d.tournaments || []).map((x) => x.date).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  if (!last) throw new Error('大会が 0 件');
  const ageD = (Date.now() - Date.parse(last + 'T00:00:00+09:00')) / 86400e3;
  if (ageD > MAX_TOUR_AGE_D) throw new Error(`最新の大会が ${last} (${ageD.toFixed(1)} 日前、上限 ${MAX_TOUR_AGE_D} 日)。start.gg からの取得が止まっている可能性`);
  return `最新 ${last} (${dates.length} 大会)`;
});

await check('トップ (/jp/)', async () => {
  const res = await get(SITE + '/jp/');
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  if (!/<title[\s>]/.test(html)) throw new Error('HTML に title が無い');
  return '200';
});

await check('ルートの転送 (/ → /jp/)', async () => {
  const res = await get(SITE + '/');
  const loc = res.headers.get('location') || '';
  if (res.status !== 301 || !/\/jp\/$/.test(loc)) throw new Error(`HTTP ${res.status} location=${loc}`);
  return '301';
});

await check('一覧ファイルと CORS', async () => {
  const res = await get(DATA + 'latest_tjpr_full.jsonl', { method: 'HEAD', headers: { Origin: SITE } });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const acao = res.headers.get('access-control-allow-origin');
  if (acao !== SITE && acao !== '*') throw new Error('access-control-allow-origin=' + acao);
  return '200、CORS ' + acao;
});

await check('API (Worker)', async () => {
  const res = await get(SITE + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'monitor_ping' }) });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j || j.ok !== false || !j.error) throw new Error('想定外の応答: ' + JSON.stringify(j).slice(0, 120));
  return '応答あり';
});

for (const s of ok) console.log('ok   ' + s);
for (const s of problems) console.log('FAIL ' + s);
if (problems.length) {
  console.log(`\n${problems.length} 件の問題。サーバのログ: ~/.local/log/spsp_nightly/ (nightly) と r2_sync_<日付>.log (R2 同期)`);
  process.exit(1);
}
