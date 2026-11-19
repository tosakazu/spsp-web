# Hivee との連携

Hivee (hivee.jp、大会の受付・運営サイト) に、SPSP の順位の一覧を渡す (2026-11-19〜)。
人をつなぐ鍵は start.gg の discriminator (`start.gg/user/<discriminator>`)。

## SPSP → Hivee

`GET https://spsp.games/api/partner/hivee/players`、ヘッダ `Authorization: Bearer <トークン>`。

返す中身はスマッチに渡す一覧と同じ (形と各欄の意味は [smatch_partner.md](smatch_partner.md) の「SPSP → スマッチ」)。
SPSP で公開済みの情報だけ (総合評価の全国順位・オフラインの使用キャラ・プレイヤーページの URL の形)。1 日 1 回読めば足りる。

- 401 = トークンが違う、404 = 未設定、503 = 一覧を読めなかった (時間をおいて読み直す)。
- 読みに来た時刻は D1 `partner_sync` の `hivee_export` に残す。

| 名前 | 種類 | 中身 |
|---|---|---|
| `HIVEE_EXPORT_TOKENS` | secret | Hivee が SPSP の一覧を読むトークン (SPSP が発行)。カンマ区切りで複数置ける (入れ替えの間は新旧 2 本) |

## Hivee → SPSP

Hivee の大会結果の取り込みはまだ行っていない。
