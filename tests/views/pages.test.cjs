'use strict';
// tests/views/pages.test.cjs — data/views/ (ビルドの build_split_views.py が書くページ用の小さい一覧) を読むときと、
// 従来どおり全選手の latest_tjpr_full.jsonl / players_current.json を読むときで、主なページの描画が同じになるか。
//
// 同じビルド出力 (tests/views/fixtures/build/。作り方は make_fixture.cjs) を、tests/frontend/snapshot_pages.cjs で 2 回描く:
//   従来: data/views/ への要求を 404 にする (= views がまだ無いデータ。ページは manifest が無いので従来どおり読む)
//   views: latest_tjpr_full.jsonl と players_current.json への要求を 404 にする (= ページがそれを読まずに描けること)
// 各操作の時点の DOM (.html) が一致すること、views 側でエラー (読んではいけないファイルへの要求を含む) が無いことを見る。
//
// 一致しないと分かっている所 (仕様。サイトの見た目の差):
//   - sim の選手検索 (#psearch) の候補の並び: 従来は jsonl の行の順、views は総合順位順 (players_index.json の並び)
//   - pref/ の一覧で人数が同じ都道府県どうしの並び: 従来は jsonl で最初に出てきた順、views は geo.json の順
// これらは比べる操作から外す (KNOWN_DIFF)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const FIX = path.join(__dirname, 'fixtures/build');
const SNAP = path.join(ROOT, 'tests/frontend/snapshot_pages.cjs');
const SCENARIOS = '^(index|c_index|c_ranking_1323|local_ranking_higoburaSP|pref_index|pref_ranking_tokyo|p_1787719|p_1983750|t_1503940|sim_1787719|priority)$';
// 外部フォント (Google Fonts) の読み込み失敗は描画の比較に関係しない (jsdom は外へ出ない。tests/frontend/snapshot_pages.cjs の既存の扱い)
const NOISE = /fonts\.googleapis\.com/;
const errLines = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l && !NOISE.test(l));
const KNOWN_DIFF = {
  pref_index: /_sort_th1(_again)?\.html$/,                           // 人数で並べたときの同数の並び
};

let tmp = null;
function run(label, block) {
  const out = path.join(tmp, label);
  const env = { ...process.env, TZ: 'Asia/Tokyo', NODE_PATH: path.join(ROOT, 'node_modules') };
  try {
    execFileSync(process.execPath, [SNAP, '--data', FIX, '--out', out, '--site', path.join(tmp, 'dist'), '--only', SCENARIOS, '--block', block],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 280000 });
  } catch (e) {
    // シナリオにエラーがあると終了コード 1 (従来側は data/views/ への要求が blocked として errors.txt に出るので必ず 1)
    if (!fs.existsSync(out)) throw e;
  }
  return out;
}

test('data/views/ 読みと従来の読み方で主なページの描画が同じ', { timeout: 600000 }, () => {
  if (!fs.existsSync(path.join(ROOT, 'node_modules/jsdom'))) return;   // jsdom が無い環境では飛ばす
  tmp = fs.mkdtempSync(path.join(process.env.SPSP_TMP_DIR || os.tmpdir(), 'spsp_views_'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build/build_site.mjs'), '--quiet', '--out', path.join(tmp, 'dist')],
      { cwd: ROOT, env: { ...process.env, GOMAXPROCS: '1' }, stdio: 'ignore', timeout: 280000 });
    const legacy = run('legacy', '^data/views/');
    const views = run('views', '^(latest_tjpr_full\\.jsonl|players_current\\.json)$');
    const names = fs.readdirSync(views).sort();
    assert.deepStrictEqual(names, fs.readdirSync(legacy).sort(), 'シナリオの集合');
    assert.ok(names.length >= 11, 'シナリオが走っていない: ' + names.join(', '));
    for (const sc of names) {
      const errV = errLines(path.join(views, sc, 'errors.txt'));
      assert.deepStrictEqual(errV, [], `${sc}: views 側でエラー`);
      const errL = errLines(path.join(legacy, sc, 'errors.txt')).filter((l) => !/^blocked request: data\/views\//.test(l));
      assert.deepStrictEqual(errL, [], `${sc}: 従来側でエラー`);
      const files = fs.readdirSync(views + '/' + sc).filter((f) => f.endsWith('.html')).sort();
      assert.deepStrictEqual(files, fs.readdirSync(legacy + '/' + sc).filter((f) => f.endsWith('.html')).sort(), `${sc}: 操作の数`);
      for (const f of files) {
        if (KNOWN_DIFF[sc] && KNOWN_DIFF[sc].test(f)) continue;
        const a = fs.readFileSync(path.join(legacy, sc, f), 'utf8');
        const b = fs.readFileSync(path.join(views, sc, f), 'utf8');
        if (a !== b) {
          const la = a.split('\n'), lb = b.split('\n');
          let i = 0; while (i < la.length && la[i] === lb[i]) i++;
          assert.fail(`${sc}/${f}: 描画が違う (${i + 1} 行目)\n  従来: ${(la[i] || '').slice(0, 300)}\n  views: ${(lb[i] || '').slice(0, 300)}`);
        }
      }
    }
    // views 側は全選手の大きいファイルを要求しない (要求すれば blocked が errors.txt に出て上で落ちる) うえで、views を実際に読んでいる
    const idx = fs.readFileSync(path.join(views, 'index', 'fetch.txt'), 'utf8');
    assert.match(idx, /data\/views\/ranking\/ensemble\/0\.json/);
    assert.match(idx, /data\/views\/ranking\/ensemble\/4\.json/, '無限スクロールの 1 段目 (512 行) で続きの分割まで読む');
  } finally {
    if (!process.env.KEEP_VIEWS_SNAP) fs.rmSync(tmp, { recursive: true, force: true });
    else console.log('snapshots kept in', tmp);
  }
});
