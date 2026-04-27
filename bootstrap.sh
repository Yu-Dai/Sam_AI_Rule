#!/usr/bin/env bash
# bootstrap.sh — 在新 Linux/Mac 機器（或 Windows git bash）安裝 Sam_AI_Rule
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.sh | bash
#
# 行為：
#   1. Clone（或更新）Sam_AI_Rule 到 $HOME/Sam_AI_Rule
#   2. 安裝 ai-guardian 依賴並 npm link 為全域指令

set -e

REPO_URL='https://github.com/Yu-Dai/Sam_AI_Rule.git'
INSTALL_DIR="$HOME/Sam_AI_Rule"

# 前置檢查
for cmd in git npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] 缺少 $cmd，請先安裝。" >&2
    exit 1
  fi
done

# 1. Clone or pull
if [ -d "$INSTALL_DIR" ]; then
  echo "[Sam_AI_Rule] 已存在於 $INSTALL_DIR，執行 git pull..."
  cd "$INSTALL_DIR" && git pull
else
  echo "[Sam_AI_Rule] Clone 到 $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# 2. ai-guardian
echo "[ai-guardian] 安裝依賴..."
cd "$INSTALL_DIR/ai-guardian"
npm install

echo "[ai-guardian] 註冊為全域指令（npm link 可能需要 sudo）..."
npm link

echo
echo "完成！"
echo "  Sam_AI_Rule 路徑：$INSTALL_DIR"
echo "  ai-guardian 已註冊為全域指令"
echo
echo "新專案初始化："
echo "  cd <new-project>"
echo "  bash $INSTALL_DIR/init-project.sh"
