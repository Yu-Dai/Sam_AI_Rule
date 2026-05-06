# AI Guardian 任務宣言

> 規則本體（哲學原則、硬性紅線）由 AGENTS.md 載入。
> **本檔承載 7 條動工前裁決規則的完整內容**（觸發判定 + 為什麼 + 怎麼做）+ **本次任務的具體承諾**。
> AI 必須逐欄填寫後才能動程式。違規 = 跳過裁決 = pre-commit hook 攔截。

---

## 任務基本資料

- **描述**：{{TASK_DESCRIPTION}}
- **分支**：`{{BRANCH_NAME}}`
- **開始時間**：{{START_TIME}}

---

## 動工前必填裁決（Pre-flight）

### Q1. 範圍鎖定

**做什麼**：列出本次預計修改的所有檔案清單。**禁寫「視情況」「相關檔案」這類模糊詞** — 寫不出具體檔名 = 還沒想清楚 = 不該動工。

**規則精神**見 AGENTS.md §3 Surgical Changes。

**本次任務範圍：**

預計修改：
- [ ] _

預計新增：
- [ ] _

預計刪除：
- [ ] _

---

### Q2. 入口定位

**為什麼要問**：不靠猜測動工。動工前必須讀 README、`package.json` 或專案根目錄的主要設定檔，確認本次任務的正式邏輯入口。**有疑問就讀原始碼，不推斷、不憑記憶。**

**本次任務的入口**（函式名／模組／事件名／檔案路徑）：

> _

---

### Q3. 開源借鑑（Resource Inventory）

**為什麼要問**：不要重造輪子。常見需求（日期、HTTP、auth、parsing、charting…）有大量成熟 lib，憑訓練資料硬刻出來的版本通常有 bug 又少功能。

**盤點順序（由內而外）**：

- **L1 — 專案內既有**：用 Glob / Grep 找 codebase 有沒有既有 utility / helper / pattern；看 `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml` 等有沒有已安裝 dependency。有就優先用。
- **L2 — 生態系成熟方案**：常見需求先找主流套件 registry（npm / PyPI / Maven / crates.io…）或開源方案 — 活躍維護 + 社群採用 + 安全紀錄良好。**不要憑訓練資料硬刻**（date parser、LRU cache、JWT 驗證、rate limiter…）。
- **L3 — 以上都無才自寫**：明說「我搜過 X、Y 關鍵字以及 npm / PyPI，沒有合適現成方案，所以自寫」。

**例外**：實作複雜度 ≤ 20 行且無安全 / 邊界條件風險的小 util（純字串轉換、陣列分組之類）可直接自寫，但簡述「為何不值得拉 lib」。

**本次任務裁決：**

- [ ] 否，本次無通用技術需求（純專案內邏輯）
- [ ] 是 → 我已盤點：
  - L1（專案內）找到：_
  - L2（生態系）找到：_，選用 / 不選用理由：_
  - L3 結論：_

---

### Q4. 失敗推演（Pre-Mortem + Adversarial Debate）

**為什麼要問**：避免 fire-and-forget 造成不可回復後果。動手前先問「這會不會炸 + 炸了能不能救」。

**觸發條件**（任一即觸發）：

- 任何不可逆操作：`rm`、`DROP`、`git reset --hard`、force push、DB migration、大規模重構
- 會動到 >5 個檔案的改動
- User 形容為「大改 / 重構 / 遷移」的任務
- 涉及不可逆的系統破壞 / 連動（DB Schema 遷移、核心狀態重構）

**觸發後動手前先列**：

1. 這個操作如果失敗，會發生什麼？
2. 哪些狀態是不可回復的？
3. 需不需要先備份 / 開 branch / dry-run？

列完後再動作，且確認 user 同意。

**進階：對峙法庭（adversarial-debate skill）**

當涉及「不可逆的系統連動」時，必須執行 `ai-guardian debate start`，由 CLI 引導紅隊 CTO 與藍隊架構師對峙。詳見 `.claude/skills/adversarial-debate/SKILL.md` 或對應 IDE 的 skill 目錄。

**本次任務裁決：**

- [ ] 否，本次無觸發條件
- [ ] 是，但只觸發 Pre-Mortem（無 DB schema / 核心連動），3 問已列：_
- [ ] 是，且觸發對峙法庭 → 已執行 `ai-guardian debate start`

---

### Q5. 資源前置探勘（Autonomy Boundary）

**為什麼要問**：避免在 user 沒提供資源的情況下盲目推進架構。

**觸發判定**（下列任一成立 → 暫停詢問 user，不要自行決定）：

- 信心 < 70%
- 後果不可逆（刪檔、推遠端、動 production）
- 影響範圍超過當前任務明確邊界
- 牽涉到成本 / 配額 / 外部 API 付費資源
- 任務必然依賴 user 提供的外部資源（API Key、素材、機器權限）

**本次任務裁決：**

- [ ] 否，本次無外部資源依賴
- [ ] 是 → 缺以下，請 user 提供：
  - _

---

### Q6. 生命週期裁決（Lifecycle Awareness）

**為什麼要問**：避免替不存在的用戶留 backward compat 包袱。新專案 / 內部工具 / 實驗性 code 多留 compat 是純技術債。

**動手前必須確認**：

1. 當下生命週期階段？（prototype / alpha / beta / production / maintenance）
2. 有 end user 嗎？（無 / 內部 N 人 / 外部 N 人）
3. 有 production 部署嗎？
4. 有其他系統或 code 依賴這個介面嗎？

**決策原則**：

- 以上四項都是「無」→ **徹底刪除**舊實作，不留 fallback / compat shim / deprecation wrapper / adapter
- 只有「確實有人依賴舊行為」時才討論 backward compatibility
- **預設假設**：新專案 / 內部工具 / 實驗性 code = 無用戶。改就是改，不要替想像中的用戶留舊路徑

若專案有 `PROJECT.md`，先從那邊讀階段資訊；沒有就直接問 user。

**本次任務裁決：**

- [ ] prototype / 實驗 / 內部工具 → 改就改，不留 compat
- [ ] alpha / 內部 N 人 → 同上但記錄轉向（PROJECT.md）
- [ ] beta / production / 有外部依賴 → 需 compat 設計，理由：_

---

### Q7. 根因修復（Root-Cause Before Patch）

> **只在 bug fix 時觸發。** 其他類型任務直接寫「N/A 非 bug fix」即可。

**為什麼要問**：bug 出現時，預設從源頭修，不從症狀修。下游打補丁是技術債起源。

**規則**：

1. 先建立病因假說 — 問「為什麼會出現」，不是「怎麼讓它消失」
2. 假說信心 < 70% → **不要急著改**。先在假設會出問題的位置加 log / assertion / breakpoint，跑一次看真實數據再決定
3. 信心 ≥ 70% 但非確知 → 改動必須加 `// SPECULATIVE FIX (YYYY-MM-DD): [假說] — 驗證有效後移除` 註解標記
4. 驗證**有效** → 主動移除標記；驗證**失敗** → 回滾，不要在上面疊補丁

**禁止**：

- 在錯誤傳播鏈**下游**（catch 區塊、retry loop、UI fallback）塞「吞掉 / 忽略 / 包裝」邏輯當作修正
- 沒有假說就改程式碼試試看（shotgun debugging）
- 一個 bug 改 3 處才「好像修好了」— 代表根因沒抓到，停下來重想

**本次任務裁決：**

- [ ] N/A，本次非 bug fix
- [ ] 是 bug fix →
  - 病因假說：_
  - 信心度：_%
  - 驗證方式：_

---

## 完工程序

```bash
ai-guardian review    # 改動審查（必須通過才能 commit）
git commit
ai-guardian finish    # 任務完結，自動合併主線並清理現場
```
