---
name: adversarial-debate
description: "核心預防性診斷與紅藍對抗 (Adversarial Pre-mortem)"
---
## 護欄對峙法庭 (Guardian Debate Court)
當你被要求執行「對峙驗屍 (Pre-mortem)」時，你必須依賴 `ai-guardian debate` 系統來引導流程。

### 🎯 任務啟動判定：【豁免權界線】
*   **[純視覺/UI/文案改動]**：如果任務僅涉及 CSS、靜態 HTML/文案，未碰觸任何業務邏輯 (.js/.ts)、API 或狀態管理，請直接輸出 `[UI Trivial Bypass: 免除對峙]` 並結束。
*   **[核心改動]**：只要牽涉資料流、非同步請求或邏輯重構，請立即執行以下指令啟動法庭：

### 👩‍⚖️ 操作手冊：如何推進法庭？
這個法庭是一個「非同步狀態機」。你不能自己一口氣講完，必須透過 CLI 指令一步步推進：

1. **啟動法庭**：
   執行指令 `$ npx ai-guardian debate start`
   (腳本會輸出你目前該扮演什麼角色、該用什麼 IDE 工具去蒐集情報，並要求你產出 Markdown 檔案)

2. **查詢當前任務與要求**：
   如果你忘記現在換誰發言，隨時執行 `$ npx ai-guardian debate status`

3. **利用 IDE 工具蒐集情報與寫檔**：
   在 CLI 腳本結束並將控制權還給你後，你可以自由地調用你的 `grep_search`, `read_file` 等工具去檢查 codebase。蒐集完畢後，依照 CLI 的指示把攻擊或防禦寫在指定的檔案裡 (例如 `.guardian/cto_attack.md`)。

4. **提交審核**：
   寫完檔案後，執行腳本要求的提交指令 (例如 `$ npx ai-guardian debate submit-cto`)。腳本會自動讀取你的檔案進行審查。如果被退回，請看清楚錯誤訊息並重寫檔案再次提交。

> **最高原則**：不要猜測現在該做什麼，永遠呼叫 CLI 腳本，讓系統引導你切換 CTO 與防禦架構師的人格！
