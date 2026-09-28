#!/usr/bin/env bash
# tools/monitor/trigger.sh — 監視 (monitor.yml) をサーバの cron から起動する。GitHub の schedule は 2026-09-28 に追加から 8 時間たっても
# 一度も起動しなかった (spsp_scripts の build も同じ) ので、起動はこちらから workflow_dispatch で送る。失敗の通知は GitHub のメール。
#   crontab: 47 * * * * /bin/bash $HOME/spsp-web/tools/monitor/trigger.sh >/dev/null 2>&1
# ログ: ~/.local/log/spsp_nightly/monitor_trigger.log (起動を送れたかどうかだけ。監視の結果は GitHub の Actions の画面)
set -u
GH=${GH:-$HOME/bin/gh}
LOG=${SPSP_LOG_DIR:-$HOME/.local/log/spsp_nightly}/monitor_trigger.log
mkdir -p "$(dirname "$LOG")"
if out=$("$GH" workflow run monitor -R tosakazu/spsp-web --ref main 2>&1); then
  echo "$(date '+%F %T') ok" >> "$LOG"
else
  echo "$(date '+%F %T') FAIL $(echo "$out" | tail -1)" >> "$LOG"; exit 1
fi
