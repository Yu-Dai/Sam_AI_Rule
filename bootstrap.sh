#!/usr/bin/env bash
# bootstrap.sh — 把 ai-guardian source 安裝到 canonical 路徑並全域註冊
#
# 用法：
#   cd <project>
#   git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
#   cd Sam_AI_Rule
#   bash bootstrap.sh
#
# 行為：
#   1. 偵測 canonical 路徑（Linux/Mac: ~/.ai-guardian；Windows: $LOCALAPPDATA/ai-guardian）
#   2. 把 ai-guardian/ 複製到 canonical（覆寫，但保留 canonical 自己的 node_modules 加速）
#   3. cd canonical → npm install → npm link
#   4. 全域 ai-guardian 指令永遠指向 canonical（不指向 clone）
#
# 環境變數：
#   AI_GUARDIAN_CANONICAL_DIR — 覆寫 canonical 路徑（除錯 / 自訂用）

set -e

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

if ! command -v npm >/dev/null 2>&1; then
  echo "[error] 缺少 npm，請先安裝 Node.js（建議 LTS）：https://nodejs.org/" >&2
  exit 1
fi

# 偵測平台
case "$(uname)" in
  *CYGWIN*|*MINGW*|*MSYS*) PLATFORM="windows" ;;
  Darwin) PLATFORM="mac" ;;
  *) PLATFORM="linux" ;;
esac

# 決定 canonical 路徑（環境變數優先）
if [ -n "$AI_GUARDIAN_CANONICAL_DIR" ]; then
  CANONICAL_DIR="$AI_GUARDIAN_CANONICAL_DIR"
elif [ "$PLATFORM" = "windows" ] && [ -n "$LOCALAPPDATA" ]; then
  if command -v cygpath >/dev/null 2>&1; then
    CANONICAL_DIR="$(cygpath -u "$LOCALAPPDATA")/ai-guardian"
  else
    CANONICAL_DIR="$LOCALAPPDATA/ai-guardian"
  fi
else
  CANONICAL_DIR="$HOME/.ai-guardian"
fi

SOURCE_DIR="$(pwd)/ai-guardian"

echo "[ai-guardian] Source 來源:    $SOURCE_DIR"
echo "[ai-guardian] Canonical 路徑: $CANONICAL_DIR"

# 邊界：source 已經是 canonical（從 canonical 自身重跑 bootstrap）
SOURCE_REAL="$(cd "$SOURCE_DIR" 2>/dev/null && pwd -P || echo "$SOURCE_DIR")"
CANONICAL_REAL="$(cd "$CANONICAL_DIR" 2>/dev/null && pwd -P || echo "$CANONICAL_DIR")"

if [ "$SOURCE_REAL" = "$CANONICAL_REAL" ]; then
  echo "[ai-guardian] Source 已是 canonical，跳過複製，直接 install + link"
else
  echo "[ai-guardian] 複製 source 到 canonical（覆寫）..."
  mkdir -p "$CANONICAL_DIR"
  if command -v rsync >/dev/null 2>&1; then
    # rsync --delete 確保 canonical 跟 source 一致；exclude node_modules 保留
    # canonical 自己已下載的依賴（避免每次 bootstrap 重新 npm install 浪費時間）
    rsync -a --delete --exclude='node_modules' "$SOURCE_DIR/" "$CANONICAL_DIR/"
  else
    # Fallback：手動清空後 cp -r，保留 node_modules
    find "$CANONICAL_DIR" -mindepth 1 -maxdepth 1 ! -name 'node_modules' -exec rm -rf {} +
    # cp -r 包含隱藏檔（.gitignore 等）
    shopt -s dotglob 2>/dev/null || true
    for item in "$SOURCE_DIR"/*; do
      [ -e "$item" ] || continue
      name=$(basename "$item")
      [ "$name" = "node_modules" ] && continue
      cp -r "$item" "$CANONICAL_DIR/"
    done
    shopt -u dotglob 2>/dev/null || true
  fi
fi

cd "$CANONICAL_DIR"

echo "[ai-guardian] 安裝依賴（in canonical）..."
npm install
if [ $? -ne 0 ]; then
  echo "[error] npm install 失敗，請檢查網路或 npm 設定後重試。" >&2
  exit 1
fi

echo "[ai-guardian] 清理可能的 stale link..."
npm uninstall -g ai-guardian 2>/dev/null || true

echo "[ai-guardian] 註冊全域指令（npm link）..."
set +e
npm link
LINK_EXIT=$?
set -e

echo
if [ "$LINK_EXIT" -eq 0 ]; then
  echo "[ok] 全域 'ai-guardian' 指令已註冊"
  echo "     canonical: $CANONICAL_DIR"
  echo "     之後從任何 Sam_AI_Rule clone 重跑 bootstrap 都會覆寫此處"
  echo
  echo "下一步：cd 到任何想啟用 guardian 的專案，跑："
  echo "  ai-guardian adopt    # 既有專案，無痛掛載"
  echo "  ai-guardian init     # 全新專案，建立 src/production / lab / archive 隔離結構"
  echo
  echo "init / adopt 會互動式問：IDE 多選 + 是否建立 PROJECT.md。"
  echo "需要時自己決定是否把這個 Sam_AI_Rule clone 路徑加入該專案的 .gitignore。"
  echo
  echo "[Dev 場景] 編輯 source clone 的 .js / .md 後，跑 'ai-guardian self-update'"
  echo "          即可同步到 canonical（不需重跑 bootstrap）"
else
  echo "[warn] npm link 失敗（exit code: $LINK_EXIT）。"
  echo "依賴已安裝，但全域指令未註冊。"
  echo

  if [ "$PLATFORM" = "windows" ]; then
    echo "Windows 上最常見原因是 EBUSY（檔案被鎖住）— 而非權限問題："
    echo "  - 其他 terminal / IDE 正在跑 ai-guardian"
    echo "  - Windows Defender / 防毒在掃 npm 全域目錄"
    echo "  - 之前的 ai-guardian 指令還有 node.exe 殘留 handle 沒釋放"
    echo
    echo "選項 A（推薦）：手動清除舊 link 後重試"
    echo "  1. 關掉所有跑過 ai-guardian 的 terminal / IDE 視窗"
    echo "  2. （PowerShell）taskkill /F /IM node.exe   # 殺掉殘留 node"
    echo "  3. npm uninstall -g ai-guardian"
    echo "  4. cd \"$CANONICAL_DIR\" && npm link"
    echo
    echo "選項 B：跳過 npm link，加 alias 指向 canonical"
    echo "  alias ai-guardian='node \"$CANONICAL_DIR/bin/cli.js\"'"
    echo
    echo "選項 C：每次用完整路徑呼叫"
    echo "  node \"$CANONICAL_DIR/bin/cli.js\" <command>"
  else
    echo "Unix 上最常見原因是權限不足（無法寫入 npm 全域目錄）："
    echo
    echo "選項 A：以 sudo 重新註冊"
    echo "  cd \"$CANONICAL_DIR\" && sudo npm link"
    echo
    echo "選項 B：手動加 alias 到 shell profile（不需要 sudo）"
    echo "  在 ~/.bashrc 或 ~/.zshrc 加入下面這行："
    echo "  alias ai-guardian='node $CANONICAL_DIR/bin/cli.js'"
    echo
    echo "選項 C：每次用完整路徑呼叫"
    echo "  node $CANONICAL_DIR/bin/cli.js <command>"
  fi
fi
