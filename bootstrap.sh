#!/usr/bin/env bash
# bootstrap.sh — 在 Sam_AI_Rule clone 子目錄內執行，安裝 ai-guardian 為全域指令
#
# 用法：
#   cd <project>
#   git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
#   cd Sam_AI_Rule
#   bash bootstrap.sh
#
# 行為：
#   1. 進入 ai-guardian 子目錄
#   2. npm install + npm link（每台機器跑一次即可，全域註冊 ai-guardian 指令）
#   3. 不複製規則檔（用 init-project.sh 做）

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

# 前置檢查：必須在 Sam_AI_Rule clone 子目錄內執行
if [ ! -d ai-guardian ] || [ ! -d ai-guardian/templates ]; then
  echo "[error] 此腳本須從 Sam_AI_Rule clone 子目錄內執行（PWD: $PWD）" >&2
  echo "        正確做法：" >&2
  echo "          cd <project>" >&2
  echo "          git clone https://github.com/Yu-Dai/Sam_AI_Rule.git" >&2
  echo "          cd Sam_AI_Rule" >&2
  echo "          bash bootstrap.sh" >&2
  exit 1
fi

# 前置檢查：npm 必須存在
if ! command -v npm >/dev/null 2>&1; then
  echo "[error] 缺少 npm，請先安裝 Node.js（建議 LTS）：https://nodejs.org/" >&2
  exit 1
fi

cd ai-guardian

echo "[ai-guardian] 安裝依賴..."
npm install
if [ $? -ne 0 ]; then
  echo "[error] npm install 失敗，請檢查網路或 npm 設定後重試。" >&2
  exit 1
fi

echo "[ai-guardian] 清理可能的 stale link（避免 wrapper 沒被重建）..."
npm uninstall -g ai-guardian 2>/dev/null || true

echo "[ai-guardian] 嘗試 npm link 註冊全域指令..."
set +e
npm link
LINK_EXIT=$?
set -e

echo
if [ "$LINK_EXIT" -eq 0 ]; then
  echo "完成！全域指令 'ai-guardian' 已註冊（每台機器跑一次即可）。"
  echo
  echo "下一步：在這個 Sam_AI_Rule clone 內執行 init-project.sh"
  echo "把規則檔複製到專案根目錄："
  echo "  cd .."
  echo "  bash Sam_AI_Rule/init-project.sh"
else
  echo "[warn] npm link 失敗（exit code: $LINK_EXIT）。常見原因：權限不足。"
  echo "依賴已安裝完成，但全域指令未註冊。請從以下擇一："
  echo
  echo "選項 A：以 sudo 重新註冊"
  echo "  cd ai-guardian && sudo npm link"
  echo
  echo "選項 B：手動加 alias 到 shell profile（不需要 sudo）"
  echo "  在 ~/.bashrc 或 ~/.zshrc 加入下面這行："
  echo "  alias ai-guardian='node $(pwd)/bin/cli.js'"
  echo
  echo "選項 C：每次用完整路徑呼叫"
  echo "  node $(pwd)/bin/cli.js <command>"
fi
