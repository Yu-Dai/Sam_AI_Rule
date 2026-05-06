# Sam AI Rule

個人 AI 助手（Claude Code）設定與專案初始化工具包。**每個專案 clone 一份**，把規則 / 模板 / 守衛複製到專案根目錄。

## 內容

| 項目 | 路徑 | 用途 |
|------|------|------|
| 全域行為規則 | [`CLAUDE.md`](CLAUDE.md) | Claude Code 跨專案行為準則（軟性） |
| 文件模板 | [`templates/`](templates/) | 專案模板（如 `PROJECT.md`） |
| 程式碼守衛 | [`ai-guardian/`](ai-guardian/) | AST-level commit 阻擋 CLI（硬性） |

**設計理念**：CLAUDE.md（軟）負責 prompt 階段勸說 AI；ai-guardian（硬）負責 commit 階段實際阻擋。兩者互補。

---

## 使用流程

### 一次性（每台新機器跑一次）：安裝 ai-guardian 為全域指令

任意挑一個專案 clone Sam_AI_Rule 後，跑 bootstrap：

```bash
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
cd Sam_AI_Rule
bash bootstrap.sh        # Linux / Mac / Windows git bash
# 或
.\bootstrap.ps1          # Windows PowerShell
```

bootstrap 只做一件事：**`cd ai-guardian && npm install && npm link`**，全域註冊 `ai-guardian` 指令。每台機器跑一次即可。

### 每個新專案：clone Sam_AI_Rule 並初始化

```bash
cd <project>
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
cd Sam_AI_Rule
bash init-project.sh     # 或 .\init-project.ps1
```

`init-project` 會在 **parent 目錄（你的專案根目錄）** 互動式做以下事：
1. 複製 `CLAUDE.md` 到專案根目錄
2. 詢問是否複製 `PROJECT.md` 模板
3. 詢問是否把 `Sam_AI_Rule/` 加到專案的 `.gitignore`（推薦，因為這是 vendored 工具）
4. 詢問是否在專案根目錄掛載 ai-guardian（執行 `ai-guardian adopt`）

執行完，`CLAUDE.md`、`PROJECT.md`、`.guardian/`、`.claude/`、`AGENTS.md` 等都會在**專案根目錄**，`Sam_AI_Rule/` 子目錄保留作為 vendored 工具。

---

## 不想用 init-project 腳本？純手動也可以

```bash
cd <project>
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
cp Sam_AI_Rule/CLAUDE.md .
cp Sam_AI_Rule/ai-guardian/templates/PROJECT.md .   # 需要的話
echo "/Sam_AI_Rule/" >> .gitignore       # 推薦
ai-guardian adopt                        # 需要的話
```

或者完全不 clone，只想要單檔：
```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/CLAUDE.md -o CLAUDE.md
```

---

## 升級 Sam_AI_Rule 在某個專案

```bash
cd <project>/Sam_AI_Rule
git pull
# 然後再次跑 init-project（會 skip 已存在檔，問你要不要重新 adopt）
bash init-project.sh
```

或直接覆蓋 CLAUDE.md：
```bash
cp Sam_AI_Rule/CLAUDE.md .
```

---

## 維護

任何元件變更 → commit → push 到 `main`。下次 clone 自動拿到最新版。

本 repo 只放**跨專案共通**的東西。個別專案的設定請放在那個專案內。
