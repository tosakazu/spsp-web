#!/bin/sh
# dist-cf/ を仕上げる: `npm run build:cf` (dist-cf/jp + dist-cf/na。tools/build/build_site.mjs) の後に
# assets/_headers を dist-cf/ 直下へ写し、ファイル数 (assets の上限 20,000) を出す。
#   sh worker/scripts/assemble_dist.sh            (リポジトリ直下で。--no-build で build:cf を飛ばす)
# JSON の生成物 (players/ tournaments/ history/ 等) は build:cf が出さない (R2 で配信する)。
# CI (.github/workflows/deploy.yml) は build:cf だけを走らせるので、_headers を効かせるには
# deploy.yml にこのスクリプト (か cp 1 行) を足す。
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/dist-cf"
if [ "${1:-}" != "--no-build" ]; then
  (cd "$ROOT" && GOMAXPROCS=1 npm run build:cf)
fi
[ -d "$OUT/jp" ] || { echo "dist-cf/jp が無い (npm run build:cf)" >&2; exit 1; }
cp "$ROOT/worker/assets/_headers" "$OUT/_headers"
# サイトの CSP (セキュリティレビュー M4)。文字列の正本は worker/src/index.ts の SITE_CSP、付け方は wrangler.toml の CSP_MODE
# (report-only / enforce。環境変数 CSP_MODE で上書き可)。_headers の /* に足す (Worker を通らない HTML の分)
CSP_MODE=${CSP_MODE:-$(sed -n 's/^CSP_MODE = "\(.*\)".*/\1/p' "$ROOT/worker/wrangler.toml" | head -1)}
CSP=$(cd "$ROOT/worker" && node --input-type=module -e "import { SITE_CSP } from './src/index.ts'; process.stdout.write(SITE_CSP)")
case "$CSP_MODE" in
  report-only) printf '  Content-Security-Policy-Report-Only: %s\n' "$CSP" >> "$OUT/_headers" ;;
  enforce)     printf '  Content-Security-Policy: %s\n' "$CSP" >> "$OUT/_headers" ;;
  *)           echo "CSP_MODE が report-only / enforce でない: '$CSP_MODE'" >&2; exit 1 ;;
esac
# 404 ページは Worker が返す (/_errors/404.html)。404.html という名前で置くと静的層が自動で返し、/ や旧 URL の転送が効かなくなる (2026-09-28 に一時発生)
rm -f "$OUT/404.html" "$OUT"/jp/404.html "$OUT"/na/404.html
mkdir -p "$OUT/_errors" && cp "$ROOT/worker/assets/404.html" "$OUT/_errors/404.html"
# robots.txt (サイトマップの場所)
cp "$ROOT/worker/assets/robots.txt" "$OUT/robots.txt"
rm -f "$OUT/_redirects" "$OUT"/*/_redirects.part   # 言語別の木の旧 URL は Worker が ?lang= へ 301 する (2026-09-28)。静的な _redirects は使わない
echo "dist-cf: $(find "$OUT" -type f | wc -l) files (limit 20,000)"
