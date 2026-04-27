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

# 雙擊啟動時，避免視窗在腳本結束（成功或失敗）後立刻關掉看不到訊息
_pause_on_exit() {
  local code=$?
  echo ""
  if [ "$code" -ne 0 ]; then
    echo "[error] 腳本以非零代碼結束（exit code: $code）。請查看上方錯誤訊息。" >&2
  fi
  read -r -p "按 Enter 關閉視窗..." _ || true
}
trap _pause_on_exit EXIT

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
if [ $? -ne 0 ]; then
  echo "[error] npm install 失敗，請檢查網路或 npm 設定後重試。" >&2
  exit 1
fi

echo "[ai-guardian] 嘗試 npm link 註冊全域指令..."
set +e
npm link
LINK_EXIT=$?
set -e

echo
if [ "$LINK_EXIT" -eq 0 ]; then
  echo "完成！全域指令 'ai-guardian' 已註冊。"
  echo "  Sam_AI_Rule 路徑：$INSTALL_DIR"
  echo
  echo "新專案初始化："
  echo "  cd <new-project>"
  echo "  bash $INSTALL_DIR/init-project.sh"
else
  echo "⚠️  npm link 失敗（exit code: $LINK_EXIT）。常見原因：權限不足。"
  echo "依賴已安裝完成，但全域指令未註冊。請從以下擇一："
  echo
  echo "選項 A：以 sudo 重新註冊"
  echo "  cd $INSTALL_DIR/ai-guardian && sudo npm link"
  echo
  echo "選項 B：手動加 alias 到 shell profile（不需要 sudo）"
  echo "  在 ~/.bashrc 或 ~/.zshrc 加入下面這行："
  echo "  alias ai-guardian='node $INSTALL_DIR/ai-guardian/bin/cli.js'"
  echo
  echo "選項 C：每次用完整路徑呼叫"
  echo "  node $INSTALL_DIR/ai-guardian/bin/cli.js <command>"
  echo
  echo "Sam_AI_Rule 路徑：$INSTALL_DIR"
fi
