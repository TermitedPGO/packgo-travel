#!/bin/bash
# packgo-new-case.sh — 從範本開一個新案子資料夾
#
# 用法:
#   bash scripts/packgo-new-case.sh <狀態夾> <日期> <產品代碼> <客人> [根目錄]
#
# 範例:
#   bash scripts/packgo-new-case.sh 01_詢價 2026-08-15 TW8 Chen-Meiling
#   bash scripts/packgo-new-case.sh 05_已下單_待供應商確認 2026-08-06 SF1 Lin-Jiaqiong
#
# 客人姓名只以參數帶入,不寫進 repo(2026-08-04 PII 慣例)。
# 已存在的案子夾不覆蓋,直接報錯退出。

set -euo pipefail

if [ $# -lt 4 ]; then
  echo "用法: bash scripts/packgo-new-case.sh <狀態夾> <日期> <產品代碼> <客人> [根目錄]" >&2
  echo "範例: bash scripts/packgo-new-case.sh 01_詢價 2026-08-15 TW8 Chen-Meiling" >&2
  exit 1
fi

STAGE="$1"
DATE="$2"
CODE="$3"
CUSTOMER="$4"
ROOT="${5:-$HOME/PACKGO}"

TPL="$ROOT/_範本/_案件範本"
DEST="$ROOT/$STAGE/${DATE}_${CODE}_${CUSTOMER}"

if [ ! -d "$ROOT/$STAGE" ]; then
  echo "找不到狀態夾: $ROOT/$STAGE" >&2
  echo "可用的狀態夾:" >&2
  ls -1 "$ROOT" 2>/dev/null | grep -E '^[0-9]{2}_' >&2 || echo "  (根目錄不存在,先跑 packgo-init.sh)" >&2
  exit 1
fi

if [ ! -d "$TPL" ]; then
  echo "找不到範本: $TPL" >&2
  echo "先跑: bash scripts/packgo-init.sh" >&2
  exit 1
fi

if [ -e "$DEST" ]; then
  echo "案子已存在,不覆蓋: $DEST" >&2
  exit 1
fi

cp -R "$TPL" "$DEST"

# 把標題與狀態填上,其餘欄位由 Jeff 補
CASE_FILE="$DEST/00_案件.md"
if [ -f "$CASE_FILE" ]; then
  tmp="$(mktemp)"
  sed -e "1s|.*|# 案件 · ${CODE}-${DATE}-${CUSTOMER}|" \
      -e "s|^目前:\`01_詢價\`|目前:\`${STAGE}\`|" \
      "$CASE_FILE" > "$tmp"
  mv "$tmp" "$CASE_FILE"
fi

echo "建立 $DEST"
echo
ls -1 "$DEST"
echo
echo "下一步:編輯 $DEST/00_案件.md"
