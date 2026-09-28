'use strict';
// 各ページのスクリプト (src/pages/<id>.js の import の並び = ビルドの結合順) が site/js/README.md の依存関係の表と矛盾しないか。
// bundler が無いので、共通モジュールは依存先より後に読まれていないと (評価時か呼び出し時に) 壊れる。
// また、参照しているファイルが存在するか。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '../../site');

// モジュール (site/ からの相対パス) → そのモジュールより前に読まれていなければならないもの
const DEPS = {
  'ranking-table.js': ['js/html.js', 'js/format.js', 'js/links.js', 'js/i18n.js'],
  'nav.js': ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js'],
  'js/i18n.js': ['region/config.js', 'i18n/ja.js', 'region/i18n.js'],
  'region/i18n.js': ['i18n/ja.js'],
  'js/tags.js': ['js/i18n.js'],
  'player-detail.js': ['js/html.js', 'js/format.js', 'js/tags.js', 'js/player_data.js', 'js/i18n.js'],
  'js/ranking_page.js': ['js/data.js', 'ranking-table.js', 'player-detail.js', 'js/i18n.js'],
  'js/vote.js': ['js/player_data.js', 'js/fighter_number.js', 'js/auth.js', 'js/oauth_state.js', 'js/post_config.js', 'js/i18n.js'],
  'js/post.js': ['js/oauth_state.js', 'js/post_config.js', 'js/i18n.js'],
  'js/callback.js': ['js/auth.js', 'js/oauth_state.js', 'js/post_config.js', 'js/i18n.js'],
  'js/auth.js': ['js/post_config.js'],
  // シードツール本体 (seeding/app/*.js) は分割前の seed_app.js と同じ依存 + 前のファイル (site/seeding/app/README.md)
  ...(() => {
    const parts = ['00_state.js', '10_skeleton.js', '20_help.js', '30_core.js', '40_startgg.js', '50_events.js', '60_upcoming.js', '70_players_cache.js',
      '75_series_rematch.js', '80_csv_source.js', '85_waves.js', '90_spec.js', '99_bootstrap.js'].map((f) => 'seeding/app/' + f);
    const base = ['js/html.js', 'js/i18n.js', 'js/data.js', 'js/player_data.js', 'ranking-table.js', 'player-detail.js',
      'seeding/seed_optimizer.js', 'seeding/seed_data.js', 'seeding/seed_share.js'];
    const out = {};
    parts.forEach((f, i) => { out[f] = base.concat(parts.slice(0, i)); });
    return out;
  })(),
  'bracket/bracket_app.js': ['js/html.js', 'js/player_data.js', 'seeding/seed_data.js', 'seeding/seed_share.js', 'bracket/bracket_core.js', 'js/i18n.js'],
};

const { pageIds, pageImports, PAGE_ID } = require('../helpers/pages.cjs');
const DATA_SCRIPTS = ['region/config.js', 'i18n/ja.js', 'region/i18n.js'];   // HTML に残る (地域・言語ごとのデータ)。ビルドが言語ごとに差し替える

// ページ HTML: 残る <script src> は データ script 3 本 + assets/<id>.js だけ (CDN は除く)。ビルドが assets/<id>.js を src/pages/<id>.js から作る
for (const [rel, id] of Object.entries(PAGE_ID)) {
  test(`${rel}: <script> は データ 3 本 + assets/${id}.js`, () => {
    const html = fs.readFileSync(path.join(SITE, rel), 'utf8');
    const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((src) => !/^https?:/.test(src))
      .map((src) => path.posix.normalize(path.posix.join(dir, src)));
    assert.deepStrictEqual(order, [...DATA_SCRIPTS, `assets/${id}.js`], `${rel} の <script src> の並び`);
    assert.ok(fs.existsSync(path.resolve(__dirname, '../../src/pages', id + '.js')) || fs.existsSync(path.resolve(__dirname, '../../src/pages', id + '.ts')), `src/pages/${id}.js が無い`);
  });
}

// src/pages/<id>.js: import の並び (= 結合順) が依存関係の表と合う。データ script は HTML で先に読まれている扱い
for (const id of pageIds()) {
  test(`src/pages/${id}: import の並びが依存関係の表と合う`, () => {
    const order = [...DATA_SCRIPTS, ...pageImports(id)];
    for (const src of order) {
      assert.ok(fs.existsSync(path.join(SITE, src)), `src/pages/${id}: import 先が存在しない: ${src}`);
    }
    order.forEach((src, i) => {
      for (const dep of DEPS[src] || []) {
        const j = order.indexOf(dep);
        assert.ok(j >= 0 && j < i, `src/pages/${id}: ${src} より前に ${dep} が要る (並び: ${order.join(' → ')})`);
      }
    });
  });
}
