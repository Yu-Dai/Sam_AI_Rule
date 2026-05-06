const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { createBaseline } = require('./utils/gitBaseline');
const { checkRemoteSync, STATUS: SYNC_STATUS } = require('./utils/syncCheck');
const { loadTemplate, renderTemplate } = require('./utils/templates');

// git status --porcelain 每行前綴：兩個狀態字元 + 一個空白
const STATUS_PORCELAIN_PREFIX_LEN = 3;
// 任務分支 slug 最大長度，避免 ref name 過長
const MAX_SLUG_LENGTH = 40;
// ISO 日期 (YYYY-MM-DD) 字串長度，用於 toISOString().slice(0, ?)
const ISO_DATE_LENGTH = 10;
// JSON.stringify 縮排寬度
const JSON_INDENT = 2;
// branch slug 含非 ASCII 時用的 hash 後綴長度（hex chars）
const SLUG_HASH_LENGTH = 8;
// slug 含非 ASCII 時保留給 ASCII 部分的預算（總長 - hash - 1 個分隔符）
const SLUG_ASCII_BUDGET = MAX_SLUG_LENGTH - SLUG_HASH_LENGTH - 1;

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
  //    slug 規則：純 ASCII 描述 → 直接用；含非 ASCII → ASCII 部分 + hash 後綴
  //    避免中文 / 其他非 ASCII 字符在 GitHub UI / CI / 第三方 git 工具被 URL-encode 成亂碼
  const slug = makeBranchSlug(taskDescription);
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

  // current-task.md 從 template 渲染：承載 7 條動工前裁決規則的完整內容（Q1-Q7）+ 本次任務承諾
  // 規則本體 SSoT 在 ai-guardian/templates/current-task.md，要修內容請改 template
  const manifestMd = renderTemplate(loadTemplate('current-task.md'), {
    TASK_DESCRIPTION: taskDescription,
    BRANCH_NAME: branchName,
    START_TIME: now,
  });
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

/**
 * 從任務描述產生 ASCII 安全的 branch slug。
 *
 * 三種情境：
 *   純 ASCII → 直接 lower-case + 連字號化（保可讀，例：refactor-snapshot）
 *   含非 ASCII → ASCII 部分（若有）+ hash 後綴（例：snapshot-a1b2c3d4）
 *   全非 ASCII → t-{hash}（例：t-a1b2c3d4）
 *
 * Hash 用 sha1 取前 SLUG_HASH_LENGTH 個 hex chars 保唯一性。
 */
function makeBranchSlug(taskDescription) {
  const hasNonAscii = /[^\x00-\x7f]/.test(taskDescription);
  const asciiNormalized = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!hasNonAscii) {
    return asciiNormalized.slice(0, MAX_SLUG_LENGTH) || 't';
  }

  const hashPart = crypto
    .createHash('sha1')
    .update(taskDescription)
    .digest('hex')
    .slice(0, SLUG_HASH_LENGTH);
  const asciiPart = asciiNormalized.slice(0, SLUG_ASCII_BUDGET);
  return asciiPart ? `${asciiPart}-${hashPart}` : `t-${hashPart}`;
}

module.exports = { runStart };
