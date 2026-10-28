-- CSP の違反報告に、インラインのスクリプトの先頭 (sample、'report-sample'、40 文字まで) と違反を起こしたスクリプトの origin (source) を足す (2026-10-28)。
-- インラインの違反が Google アナリティクスか拡張機能かを見分けるため。前からの行は '' のまま。
-- 適用: wrangler d1 execute spsp-preview --env preview --remote --file migrations/0011_csp_sample.sql / 本番 spsp も同じく --file
--       (本番は 0006 を --file で当てていて migrations の記録に無いので、migrations apply は使わない)

ALTER TABLE csp_reports ADD COLUMN sample TEXT NOT NULL DEFAULT '';
ALTER TABLE csp_reports ADD COLUMN source TEXT NOT NULL DEFAULT '';
