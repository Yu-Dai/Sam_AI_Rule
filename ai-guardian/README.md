# ai-guardian

AST-level 程式碼守衛 CLI。Claude Code / Cursor / Windsurf 等 AI 助手的硬性互補工具。

> **狀態：pre-v1，本地開發中。** 介面可能變動，尚未發布到 npm。

---

## 為什麼需要

`CLAUDE.md` / `.cursor/rules` / `.windsurfrules` 是**軟性勸說** — AI 看到會考慮，但**沒有強制力**。

ai-guardian 在 git pre-commit hook 跑 AST 分析，**真的擋住違規 commit**。

| 性質 | Prompt 規則檔 | ai-guardian |
|------|--------------|-------------|
| 強度 | 軟性 | 硬性 |
| 失敗模式 | AI 可能忘 / 繞過 | 阻擋 commit（hotfix 模式有 audit log） |
| 涵蓋 | 廣（行為哲學） | 狹但精準（AST 違規） |

---

## 安裝

尚未發布 npm，手動安裝：

```bash
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git ~/Sam_AI_Rule
cd ~/Sam_AI_Rule/ai-guardian
npm install
npm link  # 註冊為全域指令（Windows 可能需要管理員 PowerShell）
```

---

## 使用流程

### 一次性：在新專案掛載

```bash
cd <your-project>
ai-guardian init    # 全新專案：建立 src/production / lab / archive 結構
ai-guardian adopt   # 既有專案：無痛掛載，建立 .guardian 沙盒
```

兩者都會：
- 安裝 git pre-commit hook
- 寫入你選擇的 IDE 規則檔（Cursor / Windsurf / Roo / Claude Code / Antigravity）
- 建立 `ai-guardian.json` 設定檔

### 每個任務：完整 workflow

```bash
ai-guardian start "<任務描述>"   # ① 開工宣誓，建立 branch + 檔案快照
# ... 開發 ...
ai-guardian review               # ③ 完工審查，產出改動報告
git commit                       # ④ pre-commit hook 自動跑 AST 掃描
ai-guardian finish               # ⑤ 合併主線、清理現場
```

跳過 `start` / `review` 會被擋。

### 緊急：Hotfix 模式

```bash
ai-guardian start hotfix    # 急診模式：豁免本次 AST 審查
# ... 緊急修復 ...
git commit                  # 用後即焚 + audit log 留底
```

---

## 檢查項目

| 檢查 | 說明 |
|------|------|
| **邏輯雷同偵測** | AST 去骨 + MD5 — 抓「換湯不換藥」的 copy-paste，變數改名也擋不住 |
| **Magic Number** | 程式裡死寫的數字（豁免 `0` `1` `-1` `100`） |
| **Magic String** | 硬編角色（`admin` / `root` / ...）、API 路徑、環境字串、版本號 |
| **新舊兼容字串** | `legacy_` / `new_` / `old_` / `v1_` 等 — 通常代表舊邏輯沒徹底刪除 |
| **硬編憑證** | 語境感知：`if (pw === "xxx")` 才報，誤報率低 |

---

## 設定檔

`ai-guardian.json`（init 後自動產生）：

```json
{
  "mode": "standard",
  "productionDirs": ["src/production"],
  "labDir": "src/lab",
  "archiveDir": "src/archive",
  "ignoreDirs": ["node_modules", ".git", ".guardian", "dist", "build"]
}
```

`ignoreDirs` 會自動同步 `.gitignore` 內容。

---

## 解除安裝

```bash
ai-guardian uninstall         # 移除 git hook 與部分設定
ai-guardian uninstall --full  # 完整移除 .guardian/、ai-guardian.json
```

---

## 限制

- 目前只支援 JavaScript / TypeScript（`.js` `.jsx` `.ts` `.tsx`）
- 邏輯雷同偵測有最小函數長度門檻（< 3 行函數不檢查）
- `debate` 對峙法庭機制尚未完整（只實作 `debate reset`）
