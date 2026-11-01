-- 結果報告の「報告管理者」(2026-11-01、docs/self_report_design.md)。運営が受付ごとに足す、試合結果の管理 (一覧・採用・直す・取り消す・止める) だけができる人。
--   設定・停止・報告管理者の追加はできない。JSON の配列 [{ id: start.gg ユーザー ID, name, disc: discriminator }]
-- 適用: preview は wrangler d1 execute spsp-preview --env preview --remote --file / 本番 spsp は本番に出すとき (同じく execute --file)

ALTER TABLE report_events ADD COLUMN managers TEXT NOT NULL DEFAULT '[]';
