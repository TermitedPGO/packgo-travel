#!/usr/bin/env bash
# 把 packgo-poster 安裝到使用者層級的 skills 目錄。
#
# 為什麼要這一步:repo 的 .gitignore 忽略 .claude/,所以 skill 原始檔放在
# docs/skills/ 版控,再複製到 ~/.claude/skills/ 供 Claude 在任何目錄使用。
# 改完 repo 裡的版本重跑這支即可。

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/packgo-poster"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"

cp "$SRC/SKILL.md" "$DEST/"
cp -R "$SRC/references" "$SRC/assets" "$SRC/scripts" "$DEST/"

echo "已安裝 → $DEST"
echo
echo "驗證(出一張測試圖):"
echo "  node \"$DEST/scripts/render.mjs\" \"$DEST/references/template.html\" /tmp/packgo-poster-check.png --size wechat"
