#!/usr/bin/env bash
# init-project.sh — 在當前專案目錄初始化 Sam_AI_Rule 設定
#
# 用法（在新專案目錄內執行）：
#   bash $HOME/Sam_AI_Rule/init-project.sh
#
# 行為：
#   1. 複製 CLAUDE.md 到當前目錄（若已存在則跳過）
#   2. (詢問) 複製 PROJECT.md 模板
#   3. (詢問) 執行 ai-guardian adopt 掛載守衛

set -e

REPO_DIR="$HOME/Sam_AI_Rule"

if [ ! -d "$REPO_DIR" ]; then
  echo "[error] Sam_AI_Rule 未安裝於 $REPO_DIR，請先執行 bootstrap.sh" >&2
  exit 1
fi

# 1. CLAUDE.md
if [ -f CLAUDE.md ]; then
  echo "[skip] CLAUDE.md 已存在"
else
  cp "$REPO_DIR/CLAUDE.md" .
  echo "[ok] CLAUDE.md 已建立"
fi

# 2. PROJECT.md (詢問)
read -r -p '是否建立 PROJECT.md（長期專案方向追蹤）？(y/N) ' ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  if [ -f PROJECT.md ]; then
    echo "[skip] PROJECT.md 已存在"
  else
    cp "$REPO_DIR/templates/PROJECT.md" .
    echo "[ok] PROJECT.md 模板已建立，請填寫"
  fi
fi

# 3. ai-guardian (詢問)
read -r -p '是否掛載 ai-guardian？(y/N) ' ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  if ! command -v ai-guardian >/dev/null 2>&1; then
    echo "[error] ai-guardian 指令未找到，請確認 bootstrap.sh 已正確執行（包含 npm link）" >&2
  else
    ai-guardian adopt
  fi
fi

echo
echo "初始化完成。"
