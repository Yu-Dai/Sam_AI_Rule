const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function initProject(targetDir, ides = ['antigravity'], isAdopt = true) {
  // 追蹤本次 init 寫入的所有檔案，最後統一 commit（確保 working tree 乾淨）
  const writtenFiles = [];
  // 1. 設定防護配置與資料夾結構
  let config = {};

  if (isAdopt) {
    const dirs = ['.guardian/lab', '.guardian/archive'];
    dirs.forEach(dir => {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log('📁 建立沙盒資料夾: ' + dir);
      }
    });
    config = {
      mode: 'adopt',
      productionDirs: ['.'],
      labDir: '.guardian/lab',
      archiveDir: '.guardian/archive',
      ignoreDirs: ['node_modules', '.git', '.guardian', 'dist', 'build', '.idea', '.vscode']
    };
  } else {
    const dirs = ['src/production', 'src/lab', 'src/archive'];
    dirs.forEach(dir => {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log('📁 建立資料夾: ' + dir);
      }
    });
    config = {
      mode: 'standard',
      productionDirs: ['src/production'],
      labDir: 'src/lab',
      archiveDir: 'src/archive',
      ignoreDirs: ['node_modules', '.git']
    };
  }

  // 儲存配置檔
  fs.writeFileSync(path.join(targetDir, 'ai-guardian.json'), JSON.stringify(config, null, 2), 'utf-8');
  writtenFiles.push('ai-guardian.json');
  console.log('⚙️ 建立設定檔: ai-guardian.json (模式: ' + (isAdopt ? '無痛掛載 Adopt' : '全新標準 Standard') + ')');

  // 2. 通用規則內容 (防護協議)
  const productionLabel = isAdopt ? '目前專案的所有主要原始碼' : '`src/production` 區的程式碼';
  const labLabel = isAdopt ? '`.guardian/lab` 與 `.guardian/archive`' : '`src/lab` 與 `src/archive`';

  const coreProtocol = [
    '# == AI Guardian 系統防禦指令 (MANDATORY) ==',
    '',
    '> **⚠️ 這不是建議，這是強制操作約束 (Operational Constraint)。**',
    '> 你的每一次行動都受到 AI Guardian 監控。違反以下規則將導致你的所有改動在 git commit 時被永久封鎖。',
    '',
    '---',
    '',
    '## 🔀 開工前流程判定 — 先問這一個問題',
    '',
    '**「這個任務結束後，應用程式的執行行為會改變嗎？」**',
    '',
    '### ❌ 不需要 guardian 流程（直接執行，不需 start）',
    '以下情況直接做，完全不需要走 guardian 流程：',
    '- 純回答問題、解釋程式碼、討論方案（不修改任何檔案）',
    '- 只修改文件檔案：`.md` / `.txt` / `.rst` / `.mdx`',
    '- 只修改 AI rules 設定：`.agents/rules/`、`.cursor/rules/`、`.claude/rules/`、`.roo/rules/` 等',
    '',
    '### ⚡ 使用 Hotfix 流程',
    '同時符合以下**全部**條件時，使用 `ai-guardian start "hotfix: ..."`：',
    '- User 明確說了「緊急」「hotfix」「先這樣修」「快速修一下」',
    '- 修改範圍集中（1–3 個檔案），且根因已明確，不需要探索',
    '- 是修正既有邏輯錯誤，不是新增功能',
    '',
    '### ✅ 使用完整 guardian 流程',
    '其餘所有情況一律走完整流程：',
    '- 修改任何程式碼檔案（`.ts` `.js` `.py` `.go` `.java` `.vue` `.dart` 等）',
    '- 修改影響執行行為的設定（`package.json` 的 dependencies/scripts、`tsconfig.json`、`webpack.config.*`、CI/CD、Dockerfile 等）',
    '- 新增或刪除任何功能模組',
    '',
    '---',
    '',
    '## 🔴 MANDATORY FIRST ACTION — 接受任何任務的絕對第一步',
    '',
    '**在你說任何話、動任何檔案、執行任何指令之前，你的第一個 tool call 必須是：**',
    '',
    '```bash',
    'ai-guardian start "<用戶的需求描述>"',
    '```',
    '',
    '### 為什麼這是強制的？',
    '- 這個指令會自動建立隔離的 Git Branch，鎖定本次任務的檔案範圍。',
    '- 若你跳過此步驟直接修改檔案，系統狀態不會進入就緒狀態 (reviewPassed=false)。',
    '- Git pre-commit hook 將在你試圖 commit 時**永久攔截**你，你的所有工作將無法提交。',
    '',
    '### ✅ 正確的開工聲明格式（Chain-of-Thought 強制聲明）',
    '在你回覆用戶時，你必須先輸出以下結構化聲明，才能繼續：',
    '',
    '```',
    '[AI Guardian 合規聲明]',
    '- 任務描述：<一句話精確描述任務，不可模糊>',
    '- 已執行：ai-guardian start "<任務描述>"',
    '- 建立分支：guardian/<slug>-<date>',
    '- 任務範圍：<列出本次所有預計修改的檔案，禁止寫「視情況」>',
    '- 資料流入口：<邏輯起點的函式/模組/事件名稱>',
    '',
    '【自我承諾】以下 8 條，我已逐條理解並承諾遵守：',
    '  1. 唯一真理 (SSoT)       — 不建立功能相同、僅命名或位置不同的重複函式/變數',
    '  2. 溯源修復 (Fix Upstream) — 不用 fallback/catch 沉默掩蓋問題，追溯到真正源頭',
    '  3. 斷捨離   (No Dual-Track) — 不保留新舊雙軌兼容，舊邏輯必須完整替換或刪除',
    '  4. 完整路徑 (No HappyPath) — 主動考慮 null/競態/權限不足/超時等邊界情境',
    '  5. 誠實簽名 (Honest Contracts) — 函式簽名與實際回傳行為必須一致，不製造型別謊言',
    '  6. 清場     (No Zombie Code) — 完工後不留舊函式/dead import/TODO/console.log',
    '  7. 邊界封裝 (No Global Pollution) — 不將任務狀態偷掛全域/singleton/模組頂層',
    '  8. 設定顯名 (No Magic Constants) — 不在邏輯中硬編數字或字串，引用集中設定檔',
    '  9. 原則優於範例 (Principles over Examples) — 修改任何規則/協議/文件時，只寫入普遍原則；',
    '     User 在對話中提供的具體 debug 案例（特定函式名、變數名、錯誤訊息）是說明樣本，不是普遍法則，',
    '     不得將樣本直接複製進系統規則，否則等同把單一 bug 的特徵當成所有 bug 的定義。',
    '```',
    '',
    '---',
    '',
    '## 🟡 MANDATORY BEFORE COMMIT — commit 前的絕對最後一步',
    '',
    '**完成所有修改後，在執行 git commit 之前，你必須先執行：**',
    '',
    '```bash',
    'ai-guardian review',
    '```',
    '',
    '- 工具會自動比對改動清單、掃描補丁模式、檢查殭屍命名。',
    '- 審查報告亮綠燈後，才可執行 `git commit`。',
    '- 若你跳過此步驟直接 commit，pre-commit hook 將自動封鎖並提示錯誤。',
    '',
    '---',
    '',
    '## 🟢 MANDATORY TASK CLOSURE (最後一里路) — 撤收儀式',
    '',
    '**當你的任務已通過審查 (review) 並成功提交 (commit) 且 User 已確認滿意後，你必須執行：**',
    '',
    '```bash',
    'ai-guardian finish',
    '```',
    '',
    '### 為什麼必須執行此指令而非手動 git merge？',
    '- **歸檔必要性**：此指令會自動將此任務紀錄移入 `archive/`。手動 merge 會導致專案根目錄殘留一堆雜亂文檔。',
    '- **自動化撤收**：它會幫你切回主線並刪除任務分支。',
    '- **規則聲明**：嚴禁私下執行 `git merge`。手動合併會破壞專案的「免疫系統稽核鏈」。',
    '',
    '---',
    '',
    '## 核心定律',
    '',
    '### 1. 入口定位定律',
    '- 開工前主動讀取 README、package.json 或專案根目錄的主要設定檔，確認本次任務的正式邏輯入口。',
    '- 不靠猜測，不憑記憶——有疑問就讀原始碼，不推斷。',
    '',
    '### 1.5 忽略路徑管理定律（Guardian 掃描的唯一真理來源）',
    '- **Guardian 的掃描（review / start snapshot / guard AST）讀的是 `ai-guardian.json` 的 `ignoreDirs`，不是 `.gitignore`。**',
    '- 若你要讓某個目錄或路徑被 guardian 掃描忽略，必須更新 `ai-guardian.json` 的 `ignoreDirs` 陣列。',
    '- 只改 `.gitignore` 不夠——guardian 會在下次指令執行時自動把 `.gitignore` 的條目同步進來，',
    '  但若需要立即生效，請直接編輯 `ai-guardian.json`。',
    '- 格式：純目錄名（如 `"generated"`）或相對路徑前綴（如 `"src/proto-gen"`）皆可。',
    '',
    '### 2. 嚴禁打補丁 (Replace, Don\'t Patch)',
    '- **嚴禁**在既有函式中疊加 `if (isNew)` / `if (isLegacy)` 等兼容判斷。',
    '- 發現 Bug 時，回溯到上游參數的源頭修改，而非在下游打補丁。',
    '',
    '### 3. 平行替換與配接器模式 (Strangler Fig & Adapter)',
    '- 大幅修改核心邏輯時，請建立新的 `_Next` 平行實作並驗證。',
    '- **【避雷指南】**：實裝時，切忌直接改變檔名覆蓋！應在舊檔案清空邏輯並使用 `export * from "./_Next"` 轉接。',
    '- **⚠️ 預防模組炸裂**：注意 ES6 `export *` 不會導出 `default`！若原模組存在 `export default`，必須手動補上 `export { default } from "./_Next"`，嚴防切斷舊有依賴的大動脈。',
    '',
    '### 4. 嚴禁逆向依賴',
    '- ' + productionLabel + '，絕對不可依賴 ' + labLabel + ' 裡的測試或封存邏輯。',
    '',
    '### 5. 沙盒試車場定律 (Sandbox Harnessing)',
    '- **定位**：' + labLabel + ' 是你的「純邏輯試車場」與「外部 API 驅動台」。',
    '- **【強制啟動時機】(遇到以下情境，你必須主動使用 lab)：**',
    '  1. **外部交涉**：串接全新第三方 API 或未曾使用的 Library 時。',
    '  2. **心臟手術**：重構「計算、權限、金流」等核心業務資料流時。',
    '  3. **時序與非同步**：處理複雜的 Promise 批次任務或多線程時。',
    '- **操作程序**：',
    '  - **❌ 錯誤做法**：在 `lab/` 裡面手刻核心邏輯並用假資料造假測試。',
    '  - **✅ 正確做法**：將實際邏輯寫在正式區 (`_Next` 平行實作)。在 `lab/` 建立測試腳本 `import` 正式區模組，並攔截/擷取「主線真實 Payload」掛載進去測試，證明核心邏輯能在真實時序下存活。',
    '- **⚠️【UI 視圖層豁免】**：若你的任務是修改 React/Vue/Flutter 的視圖組件 (Components) 或牽涉 Context 等全域狀態管理，**嚴禁**硬抽離至 `lab/` 執行隔離測試。UI 層測試應依賴專案自身的 Hot Reload，由 User 肉眼驗證。',
    '',
    '### 6. Agentic 智能體工作流 (強制開工儀式)',
    '- **1. 開源與既有借鑑 (Scavenge over Invent)**：當涉及「高度專業化的已解決領域」(如 3D/資安/複雜解析) 時，必須優先找出開源社群或專案既有的函式庫作底層，嚴禁自刻陽春版。',
    '- **2. 啟動對峙法庭技能 (Adversarial Pre-mortem)**：當涉及「不可逆的系統連動」(如轉移 DB Schema、核心重構) 時，必須觸發名為 `adversarial-debate` 的技能(Skill)/工作流，強迫分裂出「紅隊 CTO」與「藍隊架構師」進行內部辯論，達成防禦共識後才能動工。',
    '- **3. 資源前置探勘 (Upfront Constraint Audit)**：當藍圖必然依賴「User 現實提供的資源」(申請 API Key、提供人工素材、網路權限) 時，必須第一時間暫停規劃，向 User 詢問資源取得狀況。嚴禁在資源未明朗前盲目推進假想架構。',
    '',
    '---',
    '> **你的最高使命：維持主線乾淨，每次改動都是一次外科手術而非補丁堆疊。**',
  ].join('\n');

  const debateSkillProtocol = [
    '---',
    'name: adversarial-debate',
    'description: "核心預防性診斷與紅藍對抗 (Adversarial Pre-mortem)"',
    '---',
    '## 護欄對峙法庭 (Guardian Debate Court)',
    '當你被要求執行「對峙驗屍 (Pre-mortem)」時，你必須依賴 `ai-guardian debate` 系統來引導流程。',
    '',
    '### 🎯 任務啟動判定：【豁免權界線】',
    '*   **[純視覺/UI/文案改動]**：如果任務僅涉及 CSS、靜態 HTML/文案，未碰觸任何業務邏輯 (.js/.ts)、API 或狀態管理，請直接輸出 `[UI Trivial Bypass: 免除對峙]` 並結束。',
    '*   **[核心改動]**：只要牽涉資料流、非同步請求或邏輯重構，請立即執行以下指令啟動法庭：',
    '',
    '### 👩‍⚖️ 操作手冊：如何推進法庭？',
    '這個法庭是一個「非同步狀態機」。你不能自己一口氣講完，必須透過 CLI 指令一步步推進：',
    '',
    '1. **啟動法庭**：',
    '   執行指令 `$ npx ai-guardian debate start`',
    '   (腳本會輸出你目前該扮演什麼角色、該用什麼 IDE 工具去蒐集情報，並要求你產出 Markdown 檔案)',
    '',
    '2. **查詢當前任務與要求**：',
    '   如果你忘記現在換誰發言，隨時執行 `$ npx ai-guardian debate status`',
    '',
    '3. **利用 IDE 工具蒐集情報與寫檔**：',
    '   在 CLI 腳本結束並將控制權還給你後，你可以自由地調用你的 `grep_search`, `read_file` 等工具去檢查 codebase。蒐集完畢後，依照 CLI 的指示把攻擊或防禦寫在指定的檔案裡 (例如 `.guardian/cto_attack.md`)。',
    '',
    '4. **提交審核**：',
    '   寫完檔案後，執行腳本要求的提交指令 (例如 `$ npx ai-guardian debate submit-cto`)。腳本會自動讀取你的檔案進行審查。如果被退回，請看清楚錯誤訊息並重寫檔案再次提交。',
    '',
    '> **最高原則**：不要猜測現在該做什麼，永遠呼叫 CLI 腳本，讓系統引導你切換 CTO 與防禦架構師的人格！',
  ].join('\n');

  // 5. 根據勾選的 IDE 配置 Global Rule 與 標準技能包 (SkillKit)
  ides.forEach(ide => {
    switch (ide.toLowerCase()) {
      case 'antigravity': {
        const ruleDir = path.join(targetDir, '.agents', 'rules');
        const skillDir = path.join(targetDir, '.agents', 'skills', 'adversarial-debate');
        if (!fs.existsSync(ruleDir)) fs.mkdirSync(ruleDir, { recursive: true });
        if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
        const content = '---\ntrigger: always_on\n---\n\n' + coreProtocol;
        fs.writeFileSync(path.join(ruleDir, 'ai_guardian_protocol.md'), content, 'utf-8');
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), debateSkillProtocol, 'utf-8');
        writtenFiles.push('.agents/rules/ai_guardian_protocol.md', '.agents/skills/adversarial-debate/SKILL.md');
        console.log('✅ 配置成功: ANTIGRAVITY / COPILOT (建立 rules 與標準技能包 .agents/skills/adversarial-debate/SKILL.md)');
        break;
      }
      case 'cursor': {
        const cursorRulesDir = path.join(targetDir, '.cursor', 'rules');
        const cursorSkillDir = path.join(targetDir, '.cursor', 'skills', 'adversarial-debate');
        if (!fs.existsSync(cursorRulesDir)) fs.mkdirSync(cursorRulesDir, { recursive: true });
        if (!fs.existsSync(cursorSkillDir)) fs.mkdirSync(cursorSkillDir, { recursive: true });
        const content = '---\ndescription: "Project safety and anti-zombie code rules"\nglobs: ["**/*"]\nalwaysApply: true\n---\n' + coreProtocol;
        fs.writeFileSync(path.join(cursorRulesDir, 'ai_guardian.mdc'), content, 'utf-8');
        fs.writeFileSync(path.join(cursorSkillDir, 'SKILL.md'), debateSkillProtocol, 'utf-8');
        writtenFiles.push('.cursor/rules/ai_guardian.mdc', '.cursor/skills/adversarial-debate/SKILL.md');
        console.log('✅ 配置成功: CURSOR (已建立 rules 環境與標準技能包 .cursor/skills/adversarial-debate/SKILL.md)');
        break;
      }
      case 'windsurf': {
        const windsurfSkillDir = path.join(targetDir, '.windsurf', 'skills', 'adversarial-debate');
        if (!fs.existsSync(windsurfSkillDir)) fs.mkdirSync(windsurfSkillDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, '.windsurfrules'), coreProtocol, 'utf-8');
        fs.writeFileSync(path.join(windsurfSkillDir, 'SKILL.md'), debateSkillProtocol, 'utf-8');
        writtenFiles.push('.windsurfrules', '.windsurf/skills/adversarial-debate/SKILL.md');
        console.log('✅ 配置成功: WINDSURF (建立 .windsurfrules 與標準技能包 .windsurf/skills/adversarial-debate/SKILL.md)');
        break;
      }
      case 'roo': {
        const rooRuleDir = path.join(targetDir, '.roo', 'rules');
        const rooSkillDir = path.join(targetDir, '.roo', 'skills', 'adversarial-debate');
        if (!fs.existsSync(rooRuleDir)) fs.mkdirSync(rooRuleDir, { recursive: true });
        if (!fs.existsSync(rooSkillDir)) fs.mkdirSync(rooSkillDir, { recursive: true });
        fs.writeFileSync(path.join(rooRuleDir, 'ai_guardian.md'), coreProtocol, 'utf-8');
        fs.writeFileSync(path.join(rooSkillDir, 'SKILL.md'), debateSkillProtocol, 'utf-8');
        writtenFiles.push('.roo/rules/ai_guardian.md', '.roo/skills/adversarial-debate/SKILL.md');
        console.log('✅ 配置成功: ROO CODE (已建立 rules 與標準技能包 .roo/skills/adversarial-debate/SKILL.md)');
        break;
      }
      case 'claude': {
        const claudeRuleDir = path.join(targetDir, '.claude', 'rules');
        const claudeSkillDir = path.join(targetDir, '.claude', 'skills', 'adversarial-debate');
        if (!fs.existsSync(claudeRuleDir)) fs.mkdirSync(claudeRuleDir, { recursive: true });
        if (!fs.existsSync(claudeSkillDir)) fs.mkdirSync(claudeSkillDir, { recursive: true });
        const content = '---\ndescription: Always apply. AI Guardian 系統強制操作約束，規範所有任務的開工、審查與撤收流程。\n---\n' + coreProtocol;
        fs.writeFileSync(path.join(claudeRuleDir, 'ai_guardian.md'), content, 'utf-8');
        fs.writeFileSync(path.join(claudeSkillDir, 'SKILL.md'), debateSkillProtocol, 'utf-8');
        writtenFiles.push('.claude/rules/ai_guardian.md', '.claude/skills/adversarial-debate/SKILL.md');
        console.log('✅ 配置成功: CLAUDE CODE (已建立 rules 與標準技能包 .claude/skills/adversarial-debate/SKILL.md)');
        break;
      }
    }
  });

  // 5. 產生 AGENTS.md（跨 IDE 標準，Claude Code / Copilot 等皆會讀取）
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    const agentsMd = [
      '# AGENTS.md — AI Guardian Project Rules',
      '> This file is automatically read by AI coding tools (Claude Code, GitHub Copilot, Cursor, etc.)',
      '> It defines the mandatory operating constraints for all AI agents working in this project.',
      '',
      coreProtocol,
    ].join('\n');
    fs.writeFileSync(agentsMdPath, agentsMd, 'utf-8');
    writtenFiles.push('AGENTS.md');
    console.log('✅ 建立 AGENTS.md（跨 IDE 標準，Claude Code / Copilot 等皆可讀取）');
  } else {
    console.log('ℹ️  AGENTS.md 已存在，跳過（若要更新請手動刪除後重新執行 init）');
  }

  // 6. 自動掛載 Git pre-commit Hook
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');
  if (!fs.existsSync(gitHooksDir)) {
    console.log('⚠️  未偵測到 .git 資料夾，AI Guardian 自動執行 git init...');
    try {
      const { execSync } = require('child_process');
      execSync('git init', { cwd: targetDir, stdio: 'ignore' });
    } catch (err) { }
  }

  // 6. 寫入 .gitignore — 確保 guardian 暫存檔案永遠不會污染 git working tree
  //    這是根治「每次 start 被 ?? current-task.json 擋下」的關鍵：
  //    只要 init 過的專案都有這幾行，guardian 內部狀態對 git 就完全透明。
  const guardianIgnoreBlock = [
    '',
    '# AI Guardian – 暫存任務狀態（不納入版本控制）',
    '.guardian/current-task.json',
    '.guardian/current-task.md',
    '.guardian/HOTFIX_MODE',
    '.guardian/audit.log',
    '.guardian/archive/',
    '.guardian/debate.json',
    '.guardian/cto_attack.md',
    '.guardian/defense_arch.md',
  ].join('\n');

  const gitignorePath = path.join(targetDir, '.gitignore');
  const existingGitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  if (!existingGitignore.includes('.guardian/current-task.json')) {
    fs.writeFileSync(gitignorePath, existingGitignore + guardianIgnoreBlock + '\n', 'utf-8');
    writtenFiles.push('.gitignore');
    console.log('📝 已更新 .gitignore：加入 AI Guardian 暫存檔案排除規則');
  } else {
    console.log('ℹ️  .gitignore 已含 AI Guardian 排除規則，跳過');
  }

  // 7. 掛載 Git pre-commit Hook
  const finalHookDir = path.join(targetDir, '.git', 'hooks');
  if (fs.existsSync(finalHookDir)) {
    const preCommitPath = path.join(finalHookDir, 'pre-commit');
    // 升級版 pre-commit hook：同時執行 review 前置檢查 + guard 掃描
    // reviewPassed 檢查已整合在 guard 指令內部，hook 只需一個入口即可
    const hookLines = [
      '#!/bin/sh',
      '# AI Guardian pre-commit hook',
      'echo ""',
      'echo "🛡️  AI Guardian 正在驗證你的 Commit 是否符合規範..."',
      '',
      '# guard 指令內部已整合 reviewPassed 檢查 + AST 掃描，單一入口避免重複攔截',
      'ai-guardian guard',
      'GUARD_EXIT=$?',
      '',
      'if [ $GUARD_EXIT -ne 0 ]; then',
      '  echo "🚫 守衛攔截：請修復上述問題後再重試 Commit。"',
      '  exit 1',
      'fi',
      '',
      'echo "✅  AI Guardian 大門長批准！你的 Commit 將被記錄。"',
      'exit 0',
    ];
    fs.writeFileSync(preCommitPath, hookLines.join('\n'), { mode: 0o755 });
    console.log('🔗 成功掛載 Git Hook v2: .git/hooks/pre-commit (三層防護網已上鎖)');
  }

  // 8. 自動 commit guardian 設定檔 —— 確保 init/adopt 後 working tree 是乾淨的
  //    不這樣做的後果：下次 ai-guardian start 會被自己寫的 rule files 和 .gitignore 擋下
  try {
    // 先嘗試確保有初始 commit（全新 repo 沒有 HEAD）
    try { execSync('git rev-parse HEAD', { cwd: targetDir, stdio: 'ignore' }); }
    catch (e) {
      execSync('git commit --allow-empty --no-verify -m "chore: initial commit (ai-guardian bootstrap)"', { cwd: targetDir, stdio: 'pipe' });
    }

    // 將曾被追蹤的 guardian 暫存目錄從 index 移除（解決 D 類型 ghost 問題）
    // --ignore-unmatch 確保就算檔案本來就沒被追蹤也不會報錯
    const ghostPaths = [
      '.guardian/archive',
      '.guardian/current-task.json',
      '.guardian/current-task.md',
      '.guardian/HOTFIX_MODE',
      '.guardian/audit.log',
      '.guardian/debate.json',
    ];
    for (const p of ghostPaths) {
      try {
        execSync(`git rm -r --cached --ignore-unmatch "${p}"`, { cwd: targetDir, stdio: 'pipe' });
      } catch (e) { /* 未被追蹤，跳過 */ }
    }

    // 只 stage guardian 自己寫的檔案，不動其他任何使用者的檔案
    for (const f of writtenFiles) {
      try {
        execSync(`git add "${f}"`, { cwd: targetDir, stdio: 'pipe' });
      } catch (e) { /* 檔案可能不存在（某些 IDE 跳過），忽略 */ }
    }

    // 檢查是否有東西要 commit（rm --cached 或 add 都算）
    const staged = execSync('git diff --cached --name-only', { cwd: targetDir, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (staged) {
      execSync('git commit --no-verify -m "chore(guardian): apply ai-guardian setup and .gitignore rules"', { cwd: targetDir, stdio: 'pipe' });
      console.log('\n✅ 已自動提交 AI Guardian 設定（working tree 現在是乾淨的）。');
    } else {
      console.log('\nℹ️  設定無變動，無需提交。');
    }
  } catch (e) {
    console.log('\n⚠️  Git 自動提交跳過（原因：' + e.message.split('\n')[0] + '）');
    console.log('   若 working tree 不乾淨，請手動執行：');
    console.log('   git add ' + writtenFiles.map(f => `"${f}"`).join(' '));
    console.log('   git commit --no-verify -m "chore(guardian): apply ai-guardian setup"');
  }

  console.log('\n🎉 防禦網初始化完成！');
  console.log('\n📖 使用流程：');
  console.log('   ① ai-guardian start "<任務描述>"  ← 開工前必須執行');
  console.log('   ② ... 進行開發工作 ...');
  console.log('   ③ ai-guardian review              ← 完工後必須通過審查');
  console.log('   ④ git commit                      ← 審查通過後才能提交');
  console.log('   ⑤ ai-guardian finish              ← 任務結束，自動合併主線並清理現場');
}

module.exports = { initProject };
