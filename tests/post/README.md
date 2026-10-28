# 投稿機能テスト

`site/post.html` / `site/callback.html` / `site/js/*` のテスト。サーバ側 (`/api`) は Worker のテスト (`worker/test/`、`npm run worker:test`)。
旧 GAS 版 (`gas/`) とそのテストは 2026-10-29 に削除した (git の履歴にある)。
設計は [docs/archive/post_feature_design.md](../../docs/archive/post_feature_design.md)、
デプロイは [docs/archive/DEPLOY.md](../../docs/archive/DEPLOY.md)。

## 実行

```sh
node --test tests/post/*.cjs
```

jsdom が無い場合、`*_dom.test.cjs` は自動 skip する。

## 構成

| ファイル | 内容 | 依存 |
|---|---|---|
| `state.test.cjs` | `oauth_state.js` の純粋ロジック: state 往復 / 戻り先検証 (INV-7) / 本文検証 / 認可 URL 組み立て | なし |
| `page.test.cjs` | 静的整合: HTML↔JS の id、INV-8 (callback の外部リソース禁止・CSP)、クライアント定数とビルド側定数の一致 | なし |
| `callback_dom.test.cjs` | jsdom: 処理順 (INV-6)、nonce 不一致で送らない、成功時の遷移、失敗時に下書きを残す | jsdom |
| `post_dom.test.cjs` | jsdom: 本文検証、退避、認可 URL、正規配信元チェック、`posted=1` の復帰 | jsdom |
| `auth.test.cjs` | `auth.js`: セッション保存/期限切れ/壊れたデータの掃除 | なし |
| `vote_dom.test.cjs` | jsdom: 投票ページの状態遷移 (未ログイン/資格なし/投票/再ログイン) | jsdom |
| `char_ranking.test.cjs` | 使い手ランキングの使用率列が投票由来 (pct 無し) で壊れないこと | なし |
| `nav_dom.test.cjs` | jsdom: ナビのアイコンメニュー (お知らせ/選手向け) が狭い画面でアイコンの真下に出て、はみ出さないこと | jsdom |

## 触るときの注意

- **`*_dom.test.cjs` は実ソースを `location` を引数に取る関数で包んで注入している**。
  jsdom では `location.replace` を差し替えられないため。
  実ソース側で `window.location` のように書くとこの差し替えが効かなくなるので、
  クライアント JS では **`location` を裸の識別子で参照する**こと。
- `page.test.cjs` はコメントを除いたソースを検査する
  (「nav.js は読まない」等の注意書き自体が引っかからないように)。
