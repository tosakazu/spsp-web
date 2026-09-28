#!/usr/bin/env bash
# tests/frontend/compare_with_ref.sh — フロントの変更で描画結果 (DOM / CSS / チャート設定) が変わっていないかを、
# git の基準版と作業ツリーを同じデータ・同じ固定時刻で jsdom に描かせて比べる。
#
#   tests/frontend/compare_with_ref.sh <git ref> [--data <deployed dir>] [--only <scenario 名の部分一致>] [--out <dir>] [--computed]
#
#   <git ref>   比べる相手 (例: main、コミット、タグ)。その時点の木を git archive で取り出す (src/pages があればビルドして dist を開く)
#   --data      ビルド出力 (deployed 相当)。既定は gh-pages の checkout (~/spsp-state/tosakazu.github.io/spsp)
#   --out       作業用ディレクトリ (既定 $SPSP_TMP_DIR または /tmp の下)。base/ after/ frozen/ compare.diff を置く
#   --computed  CSS の cascade (要素ごとに勝つ宣言) も比べる。CSS の構成を変える変更で使う (遅い: 数十分)
#
# 終了コード: 0 = 差分なし、1 = 差分あり (compare.diff に一覧)、2 = 実行できない
# jsdom は repo 直下の node_modules か $JSDOM_DIR (既定 /tmp/jsdom_inst) の node_modules から読む。
set -u
REF=${1:-}; shift || true
[ -n "$REF" ] || { echo "usage: $0 <git ref> [--data dir] [--only regex] [--out dir] [--computed] [--ignore selector] [--after-site dir]" >&2; exit 2; }
DATA=${SPSP_STATE_ROOT:-$HOME/spsp-state}/tosakazu.github.io/spsp
ONLY=""; OUT=""; COMPUTED=""; IGNORE=""; AFTER_SITE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA=$2; shift 2;;
    --only) ONLY=$2; shift 2;;
    --out) OUT=$2; shift 2;;
    --computed) COMPUTED=--computed; shift;;
    --ignore) IGNORE=$2; shift 2;;
    --after-site) AFTER_SITE=$2; shift 2;;   # 作業ツリーの site/ の代わりにこのディレクトリ (例 dist) を after 側にする   # この selector の要素を両側で無視 (新設 UI を除いて他が不変か見る)
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 2
[ -d "$DATA" ] || { echo "data dir が無い: $DATA" >&2; exit 2; }
if [ -d node_modules/jsdom ]; then NP="$ROOT/node_modules"
elif [ -d "${JSDOM_DIR:-/tmp/jsdom_inst}/node_modules/jsdom" ]; then NP="${JSDOM_DIR:-/tmp/jsdom_inst}/node_modules"
else echo "jsdom が無い (npm install か JSDOM_DIR)" >&2; exit 2; fi
[ -n "$OUT" ] || OUT=$(mktemp -d "${SPSP_TMP_DIR:-/tmp}/spsp_fe_compare.XXXXXX")
mkdir -p "$OUT"
rm -rf "$OUT/site_base" "$OUT/base" "$OUT/after"; mkdir -p "$OUT/site_base"
git archive "$REF" | tar -x -C "$OUT/site_base" || { echo "git archive $REF に失敗" >&2; exit 2; }
# 基準側にも src/pages/ (ページの script を dist/assets に束ねる構成) があればビルドしてから開く。無ければ site/ をそのまま開ける (2026-09-14 以前)
if [ -d "$OUT/site_base/src/pages" ]; then
  ln -sfn "$ROOT/node_modules" "$OUT/site_base/node_modules"
  (cd "$OUT/site_base" && node tools/build/build_site.mjs --quiet --out "$OUT/site_base/dist") || { echo "基準側 ($REF) のビルドに失敗" >&2; exit 2; }
  BASE_SITE="$OUT/site_base/dist"
else
  BASE_SITE="$OUT/site_base/site"
fi
# 作業ツリー側: src/pages があれば dist (npm run build 済みのもの) を使う。--after-site で明示もできる
if [ -z "$AFTER_SITE" ] && [ -d "$ROOT/src/pages" ]; then
  [ -f "$ROOT/dist/index.html" ] || { echo "dist/ が無い: npm run build してから" >&2; exit 2; }
  AFTER_SITE="$ROOT/dist"
fi
SNAP=tests/frontend/snapshot_pages.cjs
export TZ=Asia/Tokyo NODE_PATH="$NP"
# frozen/ は最初の読み込みで埋まり、以後の両側で同じ入力になる (nightly でデータが変わっても比較は成立する)
node "$SNAP" --data "$DATA" --out "$OUT/base" --freeze "$OUT/frozen" --site "$BASE_SITE" ${ONLY:+--only "$ONLY"} ${IGNORE:+--ignore "$IGNORE"} $COMPUTED > "$OUT/base.log" 2>&1 &
node "$SNAP" --data "$DATA" --out "$OUT/after" --freeze "$OUT/frozen" ${AFTER_SITE:+--site "$AFTER_SITE"} ${ONLY:+--only "$ONLY"} ${IGNORE:+--ignore "$IGNORE"} $COMPUTED > "$OUT/after.log" 2>&1 &
wait
echo "base  ($REF): $(tail -1 "$OUT/base.log")"
echo "after (作業ツリー): $(tail -1 "$OUT/after.log")"
# --computed のときは CSS テキスト (.css) の一致は求めない (cascade の一致 = .computed.txt で見る)
if [ -n "$COMPUTED" ]; then diff -rq -x fetch.txt -x "*.css" -x "*.stylesheets.txt" "$OUT/base" "$OUT/after" > "$OUT/compare.diff"; rc=$?
else diff -rq -x fetch.txt "$OUT/base" "$OUT/after" > "$OUT/compare.diff"; rc=$?; fi
n=$(wc -l < "$OUT/compare.diff")
if [ "$rc" -eq 0 ]; then echo "差分なし ($OUT)"; else
  echo "差分あり: $n ファイル ($OUT/compare.diff)"
  sed 's|.*/base/||; s| and .*||' "$OUT/compare.diff" | cut -d/ -f1 | sort | uniq -c
fi
exit $rc
