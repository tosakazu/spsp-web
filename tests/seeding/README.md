# シード被り回避テスト

`site/seeding/` の3モジュール（optimizer / data / worker）とシードページ統合のテスト。

## 実行

```sh
# モジュール・統合・実データ・静的整合（jsdom不要、jsdomテストは自動skip）
node --test tests/seeding/optimizer.test.cjs tests/seeding/data.test.cjs \
  tests/seeding/worker.test.cjs tests/seeding/realdata.test.cjs tests/seeding/page.test.cjs

# jsdom 実行時テストも含める（要 jsdom）
npm install jsdom --no-save --prefix /tmp/jsdom_inst
NODE_PATH=/tmp/jsdom_inst/node_modules node --test tests/seeding/*.cjs
```

## 構成

| ファイル | 内容 | 依存 |
|---|---|---|
| `optimizer.test.cjs` | 純粋コア: snake/最早回戦/評価関数/delta==full/可動制約/ゲーティング/フォールバック禁止/決定性/中断 | なし |
| `data.test.cjs` | 取得・集計層: 二重計上回避/減衰/missing&errors分離/optimizer連携 | なし |
| `worker.test.cjs` | Workerグルー（self/importScriptsをシム）: 多点/非対応/stop | なし |
| `realdata.test.cjs` | 実 `players/*.json` + `player_prefectures.json` でbuildSeedData→optimize（実データ未配置なら skip） | `$SPSP_STATE_ROOT/tosakazu.github.io/spsp/players` (既定 `~/spsp-state/...`)、`site/latest_tjpr_full.jsonl` |
| `page.test.cjs` | シードページ静的整合: JS↔HTML id, orderedRecs使用, 関数定義, Workerパス | なし |
| `page_dom.test.cjs` | jsdom 実行時: 適用→orderedRecs/downloadCsvが最適化後順を反映（実関数ソースを抽出して実行） | jsdom（無ければ skip） |
| `series_rematch.test.cjs` | 同シリーズ再マッチ罰則: シリーズ判定(event_id/大会名推定/判定不能)・同シリーズ分の別枠集計・倍率/加算の罰則・fail-loud・レポート件数 | なし |
| `move_candidates.test.cjs` | 近傍生成の候補集合方式: 候補集合↔`swapAllowed` の全ペア一致(`_verifyMoves`)・出力の制約遵守(タイ帯/固定/シードズレ)・有効手なし打ち切りが起きないこと | なし |
| `locks_waves.test.cjs` | プール/ウェーブ固定（seedLocks/poolWaves）とシード指定・固定パネル: 固定のハード制約/fail-loud検証/ウェーブ自動判定(wavesFromGroupNodes)/buildSpecOrder/静的配線 | なし |
| `seed_share.test.cjs` | トナメプレビューの共有コーデック: encode/decode往復・zlib互換・validatePayload/Phases・フラグメント・作業状況CSV→ペイロード | なし |
| `bracket_core.test.cjs` | プレビューの純粋コア: スネークプール割り(optimizer整合)・プール内ブラケット(bye/勝者伝播)・projectedMatches一致・スネーク性質・進出人数による打ち切り・敗者側スタート・**start.gg実プール197件との一括照合 (篝火/ウメブラ含む)**(fixtures/startgg_pools.json) | なし |
| `bracket_page.test.cjs` | プレビューページ+発行側の静的整合: JS↔HTML id・スクリプト順・issueBracketPreview 配線 | なし |
| `bracket_dom.test.cjs` | jsdom 実行時: URL復号→描画→プール/フェーズ切替でURL更新・注記バッジ・ポップアップ（実ソースを丸ごと実行、fetchはフィクスチャ） | jsdom（無ければ skip） |
| `bracket_realdata.test.cjs` | 実データ: 実uidでの往復/URL長・プール割り→buildSeedData連携・進出予測の整合 | realdata.test.cjs と同じ配置 |

実機（ブラウザ）でのUI操作は別途 https://spsp.games/b/latest/seed/ で確認。
