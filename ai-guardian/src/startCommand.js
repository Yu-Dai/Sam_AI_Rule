const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createBaseline } = require('./utils/gitBaseline');
const { checkRemoteSync, STATUS: SYNC_STATUS } = require('./utils/syncCheck');

// git status --porcelain 每行前綴：兩個狀態字元 + 一個空白
const STATUS_PORCELAIN_PREFIX_LEN = 3;
// 任務分支 slug 最大長度，避免 ref name 過長
const MAX_SLUG_LENGTH = 40;
// ISO 日期 (YYYY-MM-DD) 字串長度，用於 toISOString().slice(0, ?)
const ISO_DATE_LENGTH = 10;
// JSON.stringify 縮排寬度
const JSON_INDENT = 2;

async function runStart(projectRoot, taskDescription, options = {}) {
  const { forceStale = false } = options;
  if (!taskDescription || taskDescription.trim() === '') {
    console.error('❌ 請提供任務描述！用法: ai-guardian start "<任務描述>"');
    process.exit(1);
  }

  const guardianDir = path.join(projectRoot, '.guardian');
  if (!fs.existsSync(guardianDir)) {
    fs.mkdirSync(guardianDir, { recursive: true });
  }

  // 1. 確保在 git 環境中
  try {
    execSync('git status', { cwd: projectRoot, stdio: 'ignore' });
  } catch (e) {
    console.error('❌ 此目錄尚未初始化 Git，請先執行 git init 或 ai-guardian init。');
    process.exit(1);
  }

  // [流程建議] 分析任務描述，若高度疑似文件或討論任務，給出非阻擋式提醒
  // 目的：讓 AI 有機會自我修正，而不是盲目走完整流程
  // 注意：只給建議，不阻擋——最終判斷由 AI 根據 prompt 規則決定
  {
    const desc = taskDescription.toLowerCase();

    // 文件任務的強訊號關鍵字
    const DOC_SIGNALS = [
      'readme', 'changelog', 'license', '.md', '.txt',
      '說明文件', '文件更新', '補充說明', '修改說明', '更新說明',
      '備注', '備註', '注釋', 'note', 'doc', 'docs',
    ];
    // 程式碼任務的排除關鍵字（有這些 → 不觸發文件建議）
    const CODE_SIGNALS = [
      '功能', '實作', '修正', '修復', '重構', '新增', '刪除', '優化',
      'bug', 'fix', 'feat', 'refactor', 'implement', 'api', 'function',
      '程式', '邏輯', '模組', '元件', 'component', 'service', 'handler',
    ];

    // AI rules 目錄任務的強訊號
    const RULES_SIGNALS = [
      '.agents/rules', '.cursor/rules', '.claude/rules', '.roo/rules',
      'ai rule', 'guardian rule', 'prompt rule', '規則檔', 'rule 檔',
    ];

    const hasDocSignal  = DOC_SIGNALS.some(k => desc.includes(k));
    const hasCodeSignal = CODE_SIGNALS.some(k => desc.includes(k));
    const hasRulesSignal = RULES_SIGNALS.some(k => desc.includes(k));

    if (hasRulesSignal) {
      console.log('⚠️  [流程建議] 任務描述看起來只涉及 AI rules 設定檔修改。');
      console.log('   這類任務不需要走 guardian 流程，可直接修改 rules 檔案。');
      console.log('   若此任務確實包含程式碼修改，請繼續；否則建議取消此 start。\n');
    } else if (hasDocSignal && !hasCodeSignal) {
      console.log('⚠️  [流程建議] 任務描述看起來可能只涉及文件修改（.md / 說明 / 備注）。');
      console.log('   這類任務不需要走 guardian 流程，可直接修改文件。');
      console.log('   若此任務確實包含程式碼修改，請繼續；否則建議取消此 start。\n');
    }
  }

  // [P3-a] 優先偵測「上一個任務未完結」——給出精確提示，而非讓用戶猜
  const manifestPath = path.join(guardianDir, 'current-task.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      console.error('❌ [未完結任務] 偵測到上一個任務尚未完結，無法開啟新任務！');
      console.error(`   任務描述：${prev.taskDescription}`);
      console.error(`   任務分支：${prev.branch}`);
      console.error(`   開始時間：${prev.startedAt}`);
      console.error('\n💡 請先完結上一個任務，再開始新任務：');
      console.error('   ① ai-guardian review   ← 審查改動');
      console.error('   ② git commit           ← 提交');
      console.error('   ③ ai-guardian finish   ← 完結任務、合併主線');
    } catch (e) {
      console.error('❌ [未完結任務] 偵測到殘留的任務宣言檔案（.guardian/current-task.json）！');
      console.error('   請先執行 ai-guardian finish 完結上一個任務。');
    }
    process.exit(1);
  }

  // [P3-b] 處理 guardian 暫存檔的 gitignore 遺漏問題（自動修正）
  //
  // 設計說明：
  //   一般的未提交改動不再阻擋 start。
  //   createBaseline 把當下工作區（含 pre-existing dirty）凍結成 git commit，
  //   review 用 git diff 對比，pre-existing 改動自然落在 baseline 內、不會被誤報。
  try {
    const dirty = execSync('git status --porcelain', { cwd: projectRoot }).toString().trim();
    if (dirty) {
      const dirtyLines = dirty.split('\n').filter(Boolean);

      const GUARDIAN_TRANSIENT = [
        '.guardian/current-task.json',
        '.guardian/current-task.md',
        '.guardian/HOTFIX_MODE',
        '.guardian/audit.log',
        '.guardian/archive/',
        '.guardian/debate.json',
        '.guardian/cto_attack.md',
        '.guardian/defense_arch.md',
        '.guardian/state/',
      ];
      const isGuardianOwned = line => {
        const filePath = line.slice(STATUS_PORCELAIN_PREFIX_LEN).replace(/^"|"$/g, '').trim();
        return GUARDIAN_TRANSIENT.some(p =>
          filePath === p ||
          filePath.startsWith('.guardian/archive/') ||
          filePath.startsWith('.guardian/state/')
        );
      };

      const guardianLines = dirtyLines.filter(isGuardianOwned);
      const nonGuardianLines = dirtyLines.filter(l => !isGuardianOwned(l));

      // guardian 暫存檔：自動修正 .gitignore（同前）
      if (guardianLines.length > 0) {
        console.log('⚙️  [自動修正] 補寫 .guardian/ 暫存檔案的 .gitignore 排除規則...');
        const guardianIgnoreBlock = [
          '', '# AI Guardian – 暫存任務狀態（不納入版本控制）',
          '.guardian/current-task.json', '.guardian/current-task.md',
          '.guardian/HOTFIX_MODE', '.guardian/audit.log', '.guardian/archive/',
          '.guardian/debate.json', '.guardian/cto_attack.md', '.guardian/defense_arch.md',
          '.guardian/state/',
        ].join('\n');
        const gitignorePath = path.join(projectRoot, '.gitignore');
        const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
        if (!existing.includes('.guardian/current-task.json')) {
          fs.writeFileSync(gitignorePath, existing + guardianIgnoreBlock + '\n', 'utf-8');
        }
        try {
          execSync('git rm -r --cached --ignore-unmatch .guardian/current-task.json .guardian/current-task.md .guardian/archive/', { cwd: projectRoot, stdio: 'pipe' });
          execSync('git add .gitignore', { cwd: projectRoot, stdio: 'pipe' });
          execSync('git commit --no-verify -m "chore(guardian): add guardian transient files to .gitignore"', { cwd: projectRoot, stdio: 'pipe' });
          console.log('   ✅ 已自動提交 .gitignore 修正。\n');
        } catch (e) { /* 已是最新，忽略 */ }
      }

      // 非 guardian 的未提交改動：直接放行，告知已納入 snapshot 基準
      if (nonGuardianLines.length > 0) {
        console.log(`ℹ️  偵測到 ${nonGuardianLines.length} 個未提交的改動，已納入本次任務的 snapshot 基準。`);
        console.log('   review 時只會報告任務期間新增的改動，這些既有改動不會被誤報。');
      }
    }
  } catch (e) {
    // 全新 repo 尚無任何 commit 時 git status --porcelain 可能失敗，直接繼續
  }

  // 確保至少有一個初始 commit，否則 git checkout -b 無法建立分支
  try {
    execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'ignore' });
  } catch (e) {
    // 全新 repo，沒有任何 commit，建立一個空的初始 commit 讓分支能正常運作
    console.log('🌱 偵測到全新 Git Repo（無任何 Commit），自動建立初始提交...');
    execSync('git commit --allow-empty -m "chore: initial commit (ai-guardian bootstrap)"', { cwd: projectRoot, stdio: 'pipe' });
  }

  // 2. 判斷是否為急診模式 (Hotfix)
  const isHotfix = taskDescription.toLowerCase().startsWith('hotfix') || taskDescription.includes('--hotfix');
  const hotfixFlagPath = path.join(guardianDir, 'HOTFIX_MODE');
  if (isHotfix) {
    fs.writeFileSync(hotfixFlagPath, 'true', 'utf-8');
    console.log('🚨 [急診模式啟動]：已自動豁免 AST 指紋掃描與平行實驗室限制。這必定是緊急修復。');
  } else {
    if (fs.existsSync(hotfixFlagPath)) fs.unlinkSync(hotfixFlagPath);
  }

  // 2.5 遠端同步檢查（hotfix 模式跳過——救火優先）
  if (isHotfix) {
    console.log('ℹ️  [sync-check] hotfix 模式跳過遠端偵測。');
  } else {
    const syncResult = await checkRemoteSync(projectRoot, {
      strict: false,
      forceStale,
      taskContext: taskDescription
    });
    if (syncResult.status === SYNC_STATUS.ABORTED) {
      process.exit(1);
    }
  }

  // 3. 強制建立並切換到 guardian/ branch
  const slug = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
  const date = new Date().toISOString().slice(0, ISO_DATE_LENGTH).replace(/-/g, '');
  const branchName = `guardian/${slug}-${date}`;

  try {
    execSync(`git checkout -b "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' });
    console.log(`🌿 建立新分支: ${branchName}`);
  } catch (e) {
    // 可能 branch 已存在
    try {
      execSync(`git checkout "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' });
      console.log(`🌿 切換至既有分支: ${branchName}`);
    } catch (e2) {
      console.error(`❌ 無法建立或切換至分支 ${branchName}，請確認 Git 狀態是否乾淨。`);
      process.exit(1);
    }
  }

  // 4. 建立任務宣言
  //    baselineCommit 是用 git plumbing 凍結的游離 commit，代表「任務開始當下」的工作區狀態。
  //    review/guard 用 git diff 跟它比對，自動尊重 .gitignore、不限副檔名、不污染主 index。
  const now = new Date().toISOString();
  const taskManifest = {
    taskDescription,
    branch: branchName,
    startedAt: now,
    reviewPassed: false,
    baselineCommit: createBaseline(projectRoot, slug || 'task')
  };

  fs.writeFileSync(manifestPath, JSON.stringify(taskManifest, null, JSON_INDENT), 'utf-8');

  // [P5] current-task.md 精簡版：只含任務專屬資訊，永久規則已在 AGENTS.md / IDE rules 中
  const manifestMd = `# 🛡️ AI Guardian 任務宣言

> 全域防護規則已由 AGENTS.md / IDE Rules 載入。本檔案只記錄**本次任務專屬資訊**，請勿在此尋找全域規則。

## 任務描述
${taskDescription}

## 任務分支
\`${branchName}\`

## 開始時間
${now}

---

## 🚀 Pre-flight Checkout（開工前必填，完成後才能動工）

請依以下格式輸出你的開工分析報告，並等待 User 確認後再動手：

### 1. 🔍 開源借鑑 (Scavenge over Invent)
【觸發條件】任務涉及非專案專屬的通用技術（基礎架構、加解密、標準通訊協定）
→ （填寫評估，或寫「本次任務無需」）

### 2. 🪓 對峙驗屍 (Adversarial Pre-mortem)
【觸發條件】任務包含不可逆的系統破壞/連動（DB Schema 遷移、核心狀態重構）
→ （若需要，執行 \`ai-guardian debate start\`；否則寫「本次任務無需」）

### 3. 🧱 資源前置探勘 (Upfront Constraint Audit)
【觸發條件】任務必然依賴 User 提供的外部資源（API Key、素材、機器權限）
→ （列出需要的資源，或寫「本次任務無需」）

---

## ✅ 完工程序
\`\`\`bash
ai-guardian review    # 改動審查（必須通過才能 commit）
git commit
ai-guardian finish    # 任務完結，自動合併主線並清理現場
\`\`\`
`;
  fs.writeFileSync(path.join(guardianDir, 'current-task.md'), manifestMd, 'utf-8');

  // [P2] 明確指示 AI 必須讀取任務宣言後才能繼續，確保 Pre-flight 不被跳過
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 [AI 必讀指令] 在你回應 User 之前，');
  console.log('   你的第一個動作必須是讀取以下任務宣言檔案：');
  console.log('');
  console.log('   📄 .guardian/current-task.md');
  console.log('');
  console.log('   讀完後，輸出「Pre-flight Checkout 開工分析報告」');
  console.log('   並等待 User 確認，才能開始動任何檔案。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`🚀 任務已就緒：「${taskDescription}」`);
}

module.exports = { runStart };
