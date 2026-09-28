# 投稿機能テスト

`site/post.html` / `site/callback.html` / `site/js/*` と `gas/*.gs` のテスト。
設計は [docs/post_feature_design.md](../../docs/post_feature_design.md)、
デプロイは [docs/DEPLOY.md](../../docs/DEPLOY.md)。

## 実行

```sh
cd ~/spsp-ranking
npm install jsdom --no-save --prefix /tmp/jsdom_inst   # 未導入なら
NODE_PATH=/tmp/jsdom_inst/node_modules node --test tests/post/*.cjs

# ビルド側 (キャラ投票の採用規則) は Python
OPENBLAS_NUM_THREADS=1 .venv/bin/python3 tests/post/test_char_vote.py
```

現在 **187 件 pass**。jsdom が無い場合、`*_dom.test.cjs` は自動 skip する。

## 構成

| ファイル | 内容 | 依存 |
|---|---|---|
| `_gas_env.cjs` | (テストではない) gas/*.gs を vm 実行するスタブ環境。gas*.test.cjs で共有 | なし |
| `state.test.cjs` | `oauth_state.js` の純粋ロジック: state 往復 / 戻り先検証 (INV-7) / 本文検証 / 認可 URL 組み立て | なし |
| `gas.test.cjs` | `gas/*.gs` を vm で実行 (Apps Script API はスタブ): INV-1/2/3/4/5、token 交換の形式、連投・日次上限 | なし |
| `page.test.cjs` | 静的整合: HTML↔JS の id、INV-8 (callback の外部リソース禁止・CSP)、クライアント定数と GAS 定数の一致 | なし |
| `callback_dom.test.cjs` | jsdom: 処理順 (INV-6)、nonce 不一致で送らない、成功時の遷移、失敗時に下書きを残す | jsdom |
| `post_dom.test.cjs` | jsdom: 本文検証、退避、認可 URL、正規配信元チェック、`posted=1` の復帰 | jsdom |
| `gas_vote.test.cjs` | login (トークン発行/改ざん/期限切れ) と vote (資格判定/連投/INV-1) | なし |
| `auth.test.cjs` | `auth.js`: セッション保存/期限切れ/壊れたデータの掃除 | なし |
| `vote_dom.test.cjs` | jsdom: 投票ページの状態遷移 (未ログイン/資格なし/投票/再ログイン) | jsdom |
| `gas_export.test.cjs` | `export_votes`: 鍵の検証、差分取得 (since)、debug 行の除外、slug/gamer_tag を返さないこと | なし |
| `char_ranking.test.cjs` | 使い手ランキングの使用率列が投票由来 (pct 無し) で壊れないこと | なし |
| `nav_dom.test.cjs` | jsdom: ナビのアイコンメニュー (お知らせ/選手向け) が狭い画面でアイコンの真下に出て、はみ出さないこと | jsdom |
| `test_char_vote.py` | **Python**。ビルド側の採用規則 (`spsp/char_vote.py`) と取得の正規化 | なし |

## 触るときの注意

- **`gas.test.cjs` は `gas/*.gs` の実ソースを読んで実行する**。GAS 側で新しい
  Apps Script API を使い始めたら、`makeEnv()` のスタブにも足すこと
  (足し忘れると ReferenceError で全部落ちるので気づける)。
- **`*_dom.test.cjs` は実ソースを `location` を引数に取る関数で包んで注入している**。
  jsdom では `location.replace` を差し替えられないため。
  実ソース側で `window.location` のように書くとこの差し替えが効かなくなるので、
  クライアント JS では **`location` を裸の識別子で参照する**こと。
- `page.test.cjs` はコメントを除いたソースを検査する
  (「nav.js は読まない」等の注意書き自体が引っかからないように)。
