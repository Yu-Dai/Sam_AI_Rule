#!/usr/bin/env bash
# init-project.sh — 在 Sam_AI_Rule clone 子目錄內執行，把規則檔複製到 parent (專案根目錄)
#
# 用法：
#   cd <project>/Sam_AI_Rule
#   bash init-project.sh
#
# 行為（操作目標都是 parent，即專案根目錄）：
#   1. 從 ai-guardian/templates/CLAUDE.md 複製 CLAUDE.md 到 parent（若已存在則跳過）
#      若使用者選擇步驟 4 的 ai-guardian adopt，CLAUDE.md 也會由 adopt 帶 marker 重新產生
#   2. (詢問) 複製 PROJECT.md 模板到 parent
#   3. (詢問) 把 Sam_AI_Rule/ 加到 parent 的 .gitignore
#      （避免 ai-guardian adopt 把 Sam_AI_Rule 內的程式碼納入掃描）
#   4. (詢問) cd 到 parent 後執行 ai-guardian adopt 掛載守衛（會同步生成 AGENTS.md + CLAUDE.md）

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
if [ ! -d ai-guardian ] || [ ! -d ai-guardian/templates ] || [ ! -d templates ]; then
  echo "[error] 此腳本須從 Sam_AI_Rule clone 子目錄內執行（PWD: $PWD）" >&2
  echo "        正確做法：" >&2
  echo "          cd <project>/Sam_AI_Rule" >&2
  echo "          bash init-project.sh" >&2
  exit 1
fi

SAM_AI_DIR="$(pwd)"
TARGET="$(cd .. && pwd)"
SAM_AI_NAME="$(basename "$SAM_AI_DIR")"

echo "Sam_AI_Rule 路徑：$SAM_AI_DIR"
echo "專案根目錄：$TARGET"
echo

# 1. CLAUDE.md（template 在 ai-guardian/templates/，不在根目錄）
if [ -f "$TARGET/CLAUDE.md" ]; then
  echo "[skip] $TARGET/CLAUDE.md 已存在"
else
  cp ai-guardian/templates/CLAUDE.md "$TARGET/CLAUDE.md"
  echo "[ok] CLAUDE.md → $TARGET/"
fi

# 2. PROJECT.md (詢問)
read -r -p '是否建立 PROJECT.md（長期專案方向追蹤）？(y/N) ' ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  if [ -f "$TARGET/PROJECT.md" ]; then
    echo "[skip] $TARGET/PROJECT.md 已存在"
  else
    cp templates/PROJECT.md "$TARGET/"
    echo "[ok] PROJECT.md → $TARGET/（請填寫）"
  fi
fi

# 3. 把 Sam_AI_Rule 加到 parent 的 .gitignore（避免被 ai-guardian / git 納入）
if [ -f "$TARGET/.gitignore" ] && grep -qE "^/?${SAM_AI_NAME}/?\$" "$TARGET/.gitignore"; then
  echo "[skip] $TARGET/.gitignore 已含 $SAM_AI_NAME/"
else
  read -r -p "是否把 $SAM_AI_NAME/ 加到 $TARGET/.gitignore？(Y/n) " ans
  if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
    echo "" >> "$TARGET/.gitignore"
    echo "# Sam_AI_Rule clone（vendored 工具，不入 git）" >> "$TARGET/.gitignore"
    echo "/$SAM_AI_NAME/" >> "$TARGET/.gitignore"
    echo "[ok] 已將 /$SAM_AI_NAME/ 加入 $TARGET/.gitignore"
  fi
fi

# 4. ai-guardian (詢問)
read -r -p '是否在專案根目錄掛載 ai-guardian？(y/N) ' ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  if ! command -v ai-guardian >/dev/null 2>&1; then
    echo "[error] ai-guardian 指令未找到。請先在 Sam_AI_Rule 內執行 bash bootstrap.sh" >&2
  else
    cd "$TARGET" && ai-guardian adopt
  fi
fi

echo
echo "初始化完成於：$TARGET"
