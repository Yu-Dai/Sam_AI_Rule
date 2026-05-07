---
name: adversarial-debate
description: 對不可逆改動做事前對峙 — CTO 攻擊與架構師防禦的雙人格 state machine，強制以實體檔案為證據推理
---

# Adversarial Debate

對「不可逆改動 / 核心連動」做事前對峙。強制 AI 在同一次任務中切換成兩個獨立人格（攻擊方 vs 防禦方），各自以檔案為證據獨立推理，最後由 user 拍板。

避免 AI 一口氣在 chat 中自問自答 — attention 稀釋會讓「自我對峙」流於空泛。CLI 把流程切成 4 個 state，每個 state 強制寫檔 + 通過驗證才能進下一步。

## 何時觸發

由 AGENTS.md §7 Pre-Mortem 的觸發條件決定。典型情境：

- DB schema 遷移、核心狀態重構
- 不可逆 git / FS 操作（force push、`git reset --hard`、批次 rm）
- 跨模組大規模重構（>5 檔）、user 用「大改」「遷移」「重寫」描述的任務

不適用：純視覺/CSS/文案改動、未碰業務邏輯與 API/狀態管理者。

## 完整指令清單

| 指令 | 用途 |
|---|---|
| `ai-guardian debate start` | 立案，state → `AWAITING_CTO`，要求 CTO 寫 attack 報告 |
| `ai-guardian debate status` | 印當前 state + 下一步要做什麼（隨時可查） |
| `ai-guardian debate submit-cto` | 讀 `.guardian/cto_attack.md` 並驗證，過關後 state → `AWAITING_ARCHITECT` |
| `ai-guardian debate submit-architect` | 讀 `.guardian/architect_defend.md`，state → `AWAITING_APPROVAL` |
| `ai-guardian debate approve` | user 同意後執行，state → `APPROVED`，可開始實作 |
| `ai-guardian debate reset` | 清除狀態檔，解開卡住的 commit 封鎖（放棄 debate 用） |

## State machine

```
                  ┌──── start ────┐
                  ▼               │
       AWAITING_CTO ────submit-cto────▶ AWAITING_ARCHITECT
                                              │
                                       submit-architect
                                              ▼
       APPROVED ◀──── approve ──── AWAITING_APPROVAL
              │
              └─── reset (任何 state 都可呼叫，回原點)
```

## 產出檔案（全部住 `.guardian/`）

| 檔 | 內容 | 寫入者 |
|---|---|---|
| `debate.json` | state machine 狀態 | CLI 自動寫 |
| `cto_attack.md` | 攻擊方的災難案例報告 | AI 切到 CTO 人格寫 |
| `architect_defend.md` | 防禦方的對策 | AI 切到架構師人格寫 |

## Phase 1 — CTO Attack（紅隊）

切換成「紅隊 CTO」人格。任務：

1. **讀真實 codebase**：用 grep/read 工具找出本次任務牽涉的檔案、API、資料模型，**不要憑記憶**
2. **Assume Ruin 設定**：假設此架構 / 改動上線第一天就爆炸（重大 bug、資料異常、或服務癱瘓）
3. 產出 **≥ 3 個具體災難邊界案例**，每個必須：
   - 引用真實存在的檔名 / 函式名 / 路徑（如 `src/api/user.ts:fetchUser` 或 `lib/queue.js`）
   - 點出在高併發、網路中斷、髒資料、生命週期錯亂等情境下的具體死穴
4. 寫入 `.guardian/cto_attack.md`
5. 執行 `ai-guardian debate submit-cto`

**自動驗證規則**（過不了會退回重寫）：
- 報告字數 < 100 → 退回（敷衍了事）
- 報告無任何檔案路徑或副檔名（找不到 `.ts/.js/.py` 等或 `src/`、`lib/`、`components/` 路徑）→ 退回（過於空泛）

## Phase 2 — 架構師 Defend（藍隊）

切換成「防禦架構師」人格。任務：

1. 讀 `.guardian/cto_attack.md`，逐條看每一個 attack
2. 對每個 attack 提出**實體**對策：
   - 具體的防禦 code / try-catch / rollback / 參數驗證 / 鎖定機制
   - 禁止空泛建議（如「應該加錯誤處理」）
   - 若某 attack 根本無法防禦 → 直接承認，並提出「換方案」的具體建議
3. 寫入 `.guardian/architect_defend.md`
4. 執行 `ai-guardian debate submit-architect`

## Phase 3 — 人類裁判

submit-architect 過關後，AI 改回正常人格。任務：

1. 在 chat 對話框向 user 總結防禦的關鍵點（不是 dump 全文，是 highlights）
2. 明確詢問：「此防禦機制是否成立？通過後我才會開始實作。」
3. user 同意後執行 `ai-guardian debate approve`，state → `APPROVED`
4. 此時方可開始實作

## 卡住時的解法

任何 state 都可用 `ai-guardian debate reset` 清空：刪除 `debate.json` / `cto_attack.md` / `architect_defend.md`。適用於：
- 中途決定放棄 debate（任務改成不需要對峙的範圍）
- state 錯亂或檔案被誤刪
- commit 被某個被忘的 debate 狀態封鎖

reset 不會動 git 與 codebase，只清這 3 個 `.guardian/` 檔。

## 操作原則

- **不要憑記憶推進**：忘了現在 state 就跑 `debate status`，不要猜
- **不要在 chat 一口氣演完**：attention 會被稀釋，AI 自己也分不清誰是誰；走 CLI 與檔案才能強制人格切換
- **以實體檔為證據**：attack 與 defend 都必須引用真實 codebase，純哲學論述會被退回（attack）或被 user 看穿（defend）
