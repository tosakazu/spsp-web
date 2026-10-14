-- title_owned に「大会で引いた回数」を足す (2026-10-14)。docs/card_titles_design.md「持っている二つ名の記録」。
-- 抽選は記録に足していくだけにする: 同期の道具 (tools/titles/sync_owned.mjs) が「出た大会から決まる回数」と n_pre / n_post の差だけ新しく引く。
-- 過去に引いたものは計算し直さないので、一覧の追加・廃止や遅れて取れた大会があっても変わらない。
-- 書き込みは「同期の道具が読んだときの行のまま」のときだけ (title_sync、db.ts casTitleOwnedMany)。
-- 0007 より前の行は回数が分からないので 0 になる。preview の記録はこの後に空にして作り直す (本番の表はまだ空)。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp への適用は本番投入のとき)

ALTER TABLE title_owned ADD COLUMN n_pre INTEGER NOT NULL DEFAULT 0;    -- 大会で引いた前半の回数 (最初の配布は数えない)
ALTER TABLE title_owned ADD COLUMN n_post INTEGER NOT NULL DEFAULT 0;   -- 大会で引いた後半の回数
