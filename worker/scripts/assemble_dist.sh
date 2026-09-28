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
rm -f "$OUT/_redirects" "$OUT"/*/_redirects.part   # 言語別の木の旧 URL は Worker が ?lang= へ 301 する (2026-09-28)。静的な _redirects は使わない
echo "dist-cf: $(find "$OUT" -type f | wc -l) files (limit 20,000)"
