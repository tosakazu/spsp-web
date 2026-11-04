-- 試合結果の報告: ブラケットの写しを圧縮して置く (2026-11-05)。3000 人規模の大会では写しが 3 MB を超え、D1 の 1 行 (2 MB) に入らない。
--   data は 'z1:' + gzip の base64 (古い行は JSON のまま)。中身を開かずに読む「1 周目が終わったか・試合の数」は列に持つ。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0022_report_snapshot_meta.sql` (deploy より先に)
ALTER TABLE report_snapshots ADD COLUMN m_full INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_snapshots ADD COLUMN m_sets INTEGER NOT NULL DEFAULT 0;
