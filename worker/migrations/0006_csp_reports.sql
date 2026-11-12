-- CSP の違反報告 (Content-Security-Policy-Report-Only の report-uri = POST /api/csp-report)。セキュリティレビュー M4 の段階 1。
-- 同じ (directive, blocked, path) はまとめて hits を数える。行数は CSP_REPORT_MAX_KEYS (500) まで、超えた新しい組は捨てる。
-- クエリ文字列は保存しない (blocked は origin か inline / eval 等、path はパスだけ)。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp は段階 2 で本番に出すとき)

CREATE TABLE IF NOT EXISTS csp_reports (
  key        TEXT    PRIMARY KEY,   -- directive + "|" + blocked + "|" + path
  directive  TEXT    NOT NULL,      -- effective-directive (無ければ violated-directive の先頭)
  blocked    TEXT    NOT NULL,      -- blocked-uri の origin、または inline / eval / data / blob など
  path       TEXT    NOT NULL,      -- document-uri のパス (クエリ・# なし)
  hits       INTEGER NOT NULL,
  first_seen TEXT    NOT NULL,      -- ISO 8601 (+09:00)
  last_seen  TEXT    NOT NULL
);
