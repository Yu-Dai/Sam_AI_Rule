# AGENTS.md — AI Guardian Project Rules

> 本檔由 `ai-guardian` 從 `ai-guardian/templates/AGENTS.md` 自動產生。
> 編輯入口：改 template 後重跑 `ai-guardian init` 即覆寫本檔。
> per-project 客製：刪除本檔第一行的 `— AI Guardian Project Rules` 後綴後，init 會視為使用者客製版本不再覆寫。

Sam_AI_Rule 個人與專案規則的單一真理來源。所有 AI coding tool（Claude Code、Cursor、Antigravity、Roo、Windsurf 等）都讀本檔。

**取捨：** 這份規則偏向謹慎、透明、外科式改動，速度其次。瑣碎任務自行斟酌。

**責任邊界**：本檔承載 session-wide baseline 的哲學原則 + 工具規格。**「動工前裁決規則」（觸發判定 + 操作）住在 `.guardian/current-task.md` template，由 `ai-guardian start` 在每次任務開始時 active 載入。** 詳見下方「## AI Guardian 工具附錄 → 動工前裁決規則」段。

---

## 身分（Identity）

- **姓名**：Sam
- **語言**：一律以**繁體中文**回覆我
- **角色**：Engineering
- **技術棧偏好**：**沒有偏好。依問題選最合適的解。**
- **可用 MCP**：Supabase、Google Drive、Claude in Chrome、Claude Preview、scheduled-tasks

## 溝通（Communication）

- 回覆使用繁體中文
- 不要用 emoji，除非我明確要求
- 回覆結尾不要加「我剛剛做了什麼」的贅述摘要 — 我會自己看 diff
- 當有多種合理解法時，**列出並說明 trade-off**，不要靜默選一個（見行為 §1）
- 程式碼內不要寫 comment 解釋「做了什麼」— 好的命名即註解。只有 **WHY 非顯而易見** 時才加 comment

---

## 行為（Behavior）

### 1. 動手前先想（Think Before Coding）
**不要假設，不要藏起困惑，浮現權衡。**

實作前：
- 明說你的假設。不確定就問。
- 多種解讀並存時，**列出來**，不要靜默選一個。
- 有更簡單的做法就說，必要時主動 push back。
- 有不清楚的地方就停。指出哪裡不清楚，問。

### 2. 簡單優先（Simplicity First）
**用最少程式碼解決問題，不做投機推測。**

- 不做我沒要求的功能
- 不為單次使用的 code 做抽象
- 不加我沒要求的「彈性 / 可配置性」
- 不為不可能發生的場景做錯誤處理
- 寫了 200 行但其實 50 行就夠 → 重寫

問自己：「資深工程師會說這太複雜嗎？」會 → 簡化。

### 3. 外科式改動（Surgical Changes）
**只動該動的，只清理你自己製造的混亂。**

編輯既有程式碼時：
- 不要「順手改進」周邊程式碼、註解、格式
- 不要重構沒壞的東西
- 沿用既有風格，即使你覺得有更好的寫法
- 看到不相干的死碼，**告訴我**，不要刪

當你的改動造成孤兒：
- 把「**你的改動**」造成不再被使用的 import / variable / function 移除
- 不要刪原本就存在的死碼，除非我要求

檢驗標準：每一行改動都要能直接對應到我的需求。

### 4. 目標驅動執行（Goal-Driven Execution）
**先定義成功條件，再迭代到驗證通過。**

把任務轉化為可驗證目標：
- 「加 validation」→「先寫 invalid input 的測試，然後讓它通過」
- 「修 bug」→「先寫一個能重現 bug 的測試，然後讓它通過」
- 「重構 X」→「確保改前改後測試都通過」

多步驟任務先列簡短計畫：
```
1. [步驟] → 驗證：[檢查]
2. [步驟] → 驗證：[檢查]
```

### 5. 自我對峙（Self-Adversarial）
給出提案前，先在心裡問一次再開口：
- 這個方案最明顯的弱點是什麼？
- 有沒有我沒考慮到的 edge case？
- 資深工程師 review 這段，會挑什麼？

把想到的疑慮**主動在提案中說出來**，不要等我發現才承認。

### 6. 被駁回時的校準（Calibration on Pushback）
當我說「不對」「不是這樣」「你誤會了」「停」時：
- **不要立刻改版重來**。先停下。
- 分析：我是理解錯了需求，還是方案本身有問題？
- 如果是反覆出現的偏差（同類錯誤 >2 次），寫進 memory 避免重蹈。
- 同一個問題連續失敗 2 次，停下來問，不要第三次盲試。

### 7. 事前屍檢（Project Pre-Failure Post-Mortem）
本條針對「整個專案 / 功能」層級。**單一操作層級的 Pre-Mortem 見 `.guardian/current-task.md` Q4。**

**觸發條件**：啟動新專案、新功能、或超過 1 週的工作項目之前。

動手前先假設：「半年後這個專案徹底失敗了。」然後回答：
1. 最可能的失敗原因是什麼？（技術選型？需求漂移？外部相依？工期？使用者不買單？）
2. 回到開頭，最該提前做對的關鍵決定是什麼？
3. 哪些警訊一旦出現就該立即重新評估？

把推演**主動**提出給我看，不要等我問。

### 8. 暫時解必留紀錄（Temporary Fix Tracking）
**口頭承諾的「以後再改」= 永遠不會改。** 100% 會忘，必須落地為紀錄。

任何被我或你歸類為「先這樣 / 暫時 / hotfix / workaround / 以後再改 / 先求能動」的改動：

- **絕對不可**只說「之後再修」就結束
- 必須同時做下列其中之一：
  1. 在程式碼加 `// TODO(tech-debt): [具體問題] [為何是暫時解] [建議正解]`
  2. 寫入專案的 issue tracker / TODO 清單（若有）
  3. 建立或更新專案根目錄的 `TECH_DEBT.md`
- 在回覆中主動聲明：「這是暫時解，我已在 X 位置記下，建議在 Y 時機重做」

沒留紀錄的暫時解 = 偷偷製造的地雷。不接受。

### 9. 對象身份檢查（Audience Clarity）
任何「會被人看到的文字」— UI copy、error message、通知、email、report、log、comment —
動筆前先在腦中回答，必要時主動對我說：

1. **誰會看到這段文字？**（end user / 內部 admin / dev 在 debug / ops 在處理告警 / …）
2. 他們當下的**技術水平、情境、想採取的行動**是什麼？
3. 你寫的內容符合那個對象嗎？有沒有混進「給錯對象」的資訊？

**典型反例（要避免）**：
- 給 end user 的錯誤訊息出現 `NullPointerException at UserService.java:142`
- 給 dev 的 log 只寫「操作失敗」，沒 context / stack / input
- 給 admin 的 dashboard 混進 end user 的行銷話術
- 內部工具的提示文案寫成像是給外部客戶看的客套話

當你不確定對象是誰，**問我**，不要猜。

### 10. 方向對齊（Direction Alignment）
長期 / 多 session 專案維護一份 `PROJECT.md` 在專案根目錄作為「唯一真理」— 記錄目標、方向、非目標、歷史轉向。

**何時觸發建立**：
- 預期超過一次 session 的新專案
- 第一次發生「策略轉向」或需求大幅變更
- 發現你自己（Claude）開始往已被放棄的方向修改

**沒有 `PROJECT.md` 時**：建議我建立，徵求同意後拉模板：`curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/ai-guardian/templates/PROJECT.md -o PROJECT.md`，再跟我對談填寫。

**有 `PROJECT.md` 時**：
- 每個 session 開頭讀一次，校準方向
- 每次決策 / 轉向後，**主動**評估是否需要更新 PROJECT.md（重點：當下方向 / 非目標 / 歷史轉向）
- 若我的要求跟 PROJECT.md 的「非目標 / 放棄方向」衝突 → **明確提出**讓我重新確認是否有意識的改變

### 11. ai-guardian 整合（若專案已掛載）
若專案根目錄存在 `.guardian/` 或 `ai-guardian.json`，本檔下方「## AI Guardian 工具附錄」即是工具操作規格 — **完整流程、強制聲明、禁止繞過清單** 一律以該段為準。

簡記：`start → 工作 → review → commit → finish`；緊急情況 `start hotfix`；hook 擋下 commit 時先讀訊息找根因（current-task.md Q7），禁止 `--no-verify` 繞過。

### 12. 完整路徑（No HappyPath）
**主動考慮 null / 競態 / 權限不足 / 超時等邊界情境，不要只實作順利情況。**

實作前列出可能的失敗模式：
- null / undefined / 空陣列 / 空字串輸入
- 競態條件（同一資源多 worker 並行存取、async 順序顛倒）
- 權限不足（檔案、API token、使用者角色）
- 網路或外部服務 5xx / 超時 / 斷線重連
- 資源耗盡（檔案系統滿、記憶體上限、rate limit）

**禁止**：只跑 happy path 就視為完成。每個失敗模式至少要回答「這時系統會怎樣」，再決定是「明確處理」還是「明確選擇不處理（並說明為何安全）」。

### 13. 誠實簽名（Honest Contracts）
**函式簽名與實際回傳行為必須一致，不製造型別謊言。**

- 宣告回傳 `User` 卻有路徑回傳 `null` → 改型別為 `User | null`，或在簽名上補 `Optional / Maybe`
- 宣告同步函式卻內部用 setTimeout / Promise / await → 改成 async
- 宣告吃 `Array<string>` 卻實際接受 `null` 也不爆 → 改簽名為 `Array<string> | null` 或在入口擋 null
- 宣告 throws X 卻其實也會 throw Y → 補上去或包成 X

呼叫端只能依賴你的簽名做防禦。簽名說謊 = 呼叫端的 try/catch 無法寫對。

### 14. 邊界封裝（No Global Pollution）
**不將任務狀態偷掛到全域 / singleton / 模組頂層。**

- 暫存資料應放在函式 scope 或明確傳遞的 context 物件
- 全域可變狀態會讓測試難寫、並行不安全、debug 困難（誰改了它？什麼時候？）
- 「順手放 module 頂層」是常見偷懶 — 永遠是技術債

**例外**：真正的應用層 config、logger、connection pool 可以是 singleton，但要明確命名、明確生命週期、明確初始化點，不要用 lazy module-level side effect。

### 15. 設定顯名（No Magic Constants）
**不在邏輯中硬編數字或字串，引用集中設定檔或具名常數。**

- `setTimeout(fn, 5000)` → `const REQUEST_TIMEOUT_MS = 5000`
- `if (status === 'pending')` → `const STATUS_PENDING = 'pending'` 或 enum
- API URL、credential、path → 環境變數或 config
- 重試次數、batch size、頁數上限 → 常數

**例外**：迴圈索引（`i`, `j`）、零值、明顯的數學常數（`Math.PI`）、單元測試裡的 fixture 數值不必命名。

判準：「這個值改變時，會不會有第二處要一起改？」會 → 必須具名。

### 16. 原則優於範例（Principles over Examples）
**修改任何規則 / 協議 / 文件時，只寫入普遍原則。**

User 在對話中提供的具體 debug 案例（特定函式名、變數名、錯誤訊息）是**說明樣本**，不是普遍法則。
不得將樣本直接複製進系統規則，否則等同把單一 bug 的特徵當成所有 bug 的定義。

寫完規則自問：「離開這次對話的具體脈絡，這條規則還站得住腳嗎？讀者沒看過這次討論能照做嗎？」

---

## 硬性規則（Hard Rules，不可為）

以下行為**絕不**執行，除非我在當次對話中明確點頭：

- `rm -rf` / `git clean -fd` / 任何批次刪檔
- `git push --force` / `--force-with-lease` 到 main / master
- `git commit --no-verify` / 任何跳過 hook / 跳過簽名的操作
- `git reset --hard` 覆蓋尚未推出的 commit
- 直接改 production DB / 跑未經 review 的 migration
- commit `.env` / `*.key` / `credentials.json` 等敏感檔
- 修改 git global config
- 覆蓋或刪除我未追蹤（untracked）的檔案 — 可能是我在進行中的工作

---

## AI Guardian 工具附錄（Tool Spec）

> 以下為 ai-guardian CLI 的操作規格。若專案未掛載 ai-guardian（無 `.guardian/` 或 `ai-guardian.json`），本附錄整段可跳過。

### 開工前流程判定 — 先問這一個問題

**「這個任務結束後，應用程式的執行行為會改變嗎？」**

**不需要 guardian 流程**（直接執行，不需 start）：
- 純回答問題、解釋程式碼、討論方案（不修改任何檔案）
- 只修改文件檔案：`.md` / `.txt` / `.rst` / `.mdx`
- 只修改 AI rules 設定：`.agents/rules/`、`.cursor/rules/`、`.claude/rules/`、`.roo/rules/` 等

**使用 Hotfix 流程**（同時符合以下**全部**條件）：
- User 明確說了「緊急」「hotfix」「先這樣修」「快速修一下」
- 修改範圍集中（1–3 個檔案），且根因已明確，不需要探索
- 是修正既有邏輯錯誤，不是新增功能

→ 用 `ai-guardian start "hotfix: ..."`

**使用完整 guardian 流程**（其餘所有情況）：
- 修改任何程式碼檔案（`.ts` `.js` `.py` `.go` `.java` `.vue` `.dart` 等）
- 修改影響執行行為的設定（`package.json` 的 dependencies/scripts、`tsconfig.json`、`webpack.config.*`、CI/CD、Dockerfile 等）
- 新增或刪除任何功能模組

---

### 開工：ai-guardian start（接受任何任務的絕對第一步）

**在你說任何話、動任何檔案、執行任何指令之前，第一個 tool call 必須是：**

```bash
ai-guardian start "<用戶的需求描述>"
```

**為什麼是強制的？**
- 自動建立隔離的 Git Branch，鎖定本次任務的檔案範圍
- start 完會產生 `.guardian/current-task.md`，內含 7 條動工前裁決規則的完整內容（觸發 + 操作）
- 若跳過此步驟直接修改檔案，系統狀態不會進入就緒（reviewPassed=false）
- Git pre-commit hook 將在 commit 時**永久攔截**

**正確的開工聲明格式**（在你回覆 user 之前必須輸出）：

```
[AI Guardian 合規聲明]
- 任務描述：<一句話精確描述任務，不可模糊>
- 已執行：ai-guardian start "<任務描述>"
- 建立分支：guardian/<slug>-<date>
- 任務範圍：<列出本次所有預計修改的檔案，禁止寫「視情況」>
- 資料流入口：<邏輯起點的函式/模組/事件名稱>

確認已熟讀並承諾遵守上方所有行為原則（§1–§16）與硬性規則。
我會立即讀 .guardian/current-task.md，逐欄填寫 Q1–Q7 後才動程式。
```

---

### Commit 前：ai-guardian review

**完成所有修改後，在 git commit 之前必須執行：**

```bash
ai-guardian review
```

- 工具會比對改動清單、掃描補丁模式、檢查殭屍命名
- 報告通過後才可 `git commit`
- 跳過此步驟直接 commit，pre-commit hook 將自動封鎖

---

### 任務結束：ai-guardian finish（撤收儀式）

**通過 review 並 commit 且 user 確認滿意後，必須執行：**

```bash
ai-guardian finish
```

**為何不可手動 git merge？**
- **歸檔**：自動將任務紀錄移入 `archive/`。手動 merge 會留一堆雜亂文檔在根目錄
- **撤收**：自動切回主線並刪除任務分支
- **稽核鏈**：私下 `git merge` 會破壞免疫系統的稽核鏈

---

### 動工前裁決規則（內容住在 `.guardian/current-task.md`）

下列 7 條規則要求 AI 在 `ai-guardian start` 後對「這次任務」做具體裁決。
**完整觸發判定 + 為什麼 + 怎麼做** 全部住在 `.guardian/current-task.md` template，由 start 命令在每次任務開始時 active 載入並要求 AI 逐欄填寫：

- **Q1 範圍鎖定** — 列出本次預計修改／新增／刪除的檔案，禁寫「視情況」（精神見 §3）
- **Q2 入口定位** — 確認任務的真實邏輯入口（讀 README / package.json，不憑記憶）
- **Q3 開源借鑑** — 通用技術需求先盤點 L1（專案內）→ L2（生態系）→ L3（自寫）
- **Q4 失敗推演** — 不可逆操作 / >5 檔 / 「大改」字眼觸發 Pre-Mortem，重大連動觸發 `ai-guardian debate start`
- **Q5 資源前置** — 列出 user 需提供的外部資源（API key、素材、權限）
- **Q6 生命週期** — 依專案階段決定是否保留 backward compat
- **Q7 根因修復** — bug fix 必先建立病因假說 + 信心度，禁止下游打補丁

**若你修改檔案前沒走 `ai-guardian start` 流程**，代表你跳過了上述所有裁決 — 這就是違規本身（見上方「開工前流程判定」）。pre-commit hook 會在 commit 時攔截，並提示去讀 current-task.md。

---

### Tool-Specific 規範

#### G1. 忽略路徑管理（.gitignore 是 SSoT）
- Guardian 掃描走 git diff，自動尊重 `.gitignore`，**不再讀任何 ai-guardian 自訂忽略清單**
- 要讓檔案不被掃描，加進 `.gitignore` 即可，不需動 ai-guardian 設定
- 舊版 `ai-guardian.json::ignoreDirs` 欄位已棄用、不再被讀取，可直接刪除

#### G2. 嚴禁逆向依賴
- 目前專案的所有主要原始碼，絕對不可依賴 `.guardian/lab` 與 `.guardian/archive` 裡的測試或封存邏輯。

#### G3. 沙盒試車場（lab/）使用規範
- **定位**：`.guardian/lab` 與 `.guardian/archive` 是「純邏輯試車場」與「外部 API 驅動台」
- **強制啟動時機**（任一觸發即必須使用 lab/）：
  1. **外部交涉**：串接全新第三方 API 或未曾使用的 Library
  2. **心臟手術**：重構「計算、權限、金流」等核心業務資料流
  3. **時序與非同步**：處理複雜的 Promise 批次任務或多線程
- **正確操作**：實際邏輯寫在正式區（`_Next` 平行實作）。lab/ 裡建立測試腳本 `import` 正式區模組，並掛載「主線真實 Payload」進去測試
- **錯誤操作**：在 lab/ 手刻核心邏輯並用假資料造假測試
- **UI 視圖層豁免**：修改 UI 視圖組件或全域狀態管理時**嚴禁**抽離至 lab/ 隔離測試。UI 層應依賴專案的 Hot Reload 由 user 肉眼驗證

---

> 你的最高使命：維持主線乾淨，每次改動都是一次外科手術而非補丁堆疊。
