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
    console.error('[err] 缺任務描述。用法: ai-guardian start "<任務描述>"');
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
    console.error('[err] 不是 git repo。先跑 git init 或 ai-guardian init。');
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
      console.log('[hint] 描述看起來只動 AI rules 檔。這類任務不需走 guardian — 確認真的有改 code 才繼續。\n');
    } else if (hasDocSignal && !hasCodeSignal) {
      console.log('[hint] 描述看起來只動文件（.md/.txt）。這類任務不需走 guardian — 確認真的有改 code 才繼續。\n');
    }
  }

  // [P3-a] 優先偵測「上一個任務未完結」——給出精確提示，而非讓用戶猜
  const manifestPath = path.join(guardianDir, 'current-task.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      console.error('[err] 上一個任務未完結，無法開新任務:');
      console.error(`        desc:   ${prev.taskDescription}`);
      console.error(`        branch: ${prev.branch}`);
      console.error(`        since:  ${prev.startedAt}`);
      console.error('  fix: 走完 review → commit → finish；或無法救援用 ai-guardian abort');
    } catch (e) {
      console.error('[err] 殘留的 .guardian/current-task.json 解析失敗。先 ai-guardian finish 或 abort。');
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
        console.log('[fix] 補寫 .gitignore 排除 .guardian/ 暫存檔...');
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
          console.log('       committed .gitignore fix\n');
        } catch (e) { /* 已是最新，忽略 */ }
      }

      // 非 guardian 的未提交改動：直接放行，告知已納入 snapshot 基準
      if (nonGuardianLines.length > 0) {
        console.log(`[info] ${nonGuardianLines.length} 個未提交改動已納入 baseline，review 不會誤報。`);
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
    console.log('[info] 全新 git repo（無 commit），建立空初始 commit 讓 branch 能 work...');
    execSync('git commit --allow-empty -m "chore: initial commit (ai-guardian bootstrap)"', { cwd: projectRoot, stdio: 'pipe' });
  }

  // 2. 判斷是否為急診模式 (Hotfix)
  const isHotfix = taskDescription.toLowerCase().startsWith('hotfix') || taskDescription.includes('--hotfix');
  const hotfixFlagPath = path.join(guardianDir, 'HOTFIX_MODE');
  if (isHotfix) {
    fs.writeFileSync(hotfixFlagPath, 'true', 'utf-8');
    console.log('[hotfix] 跳過 AST 掃描與 lab 強制使用。請確定真的是急修。');
  } else {
    if (fs.existsSync(hotfixFlagPath)) fs.unlinkSync(hotfixFlagPath);
  }

  // 2.5 遠端同步檢查（hotfix 模式跳過——救火優先）
  if (isHotfix) {
    console.log('[hotfix] 跳過 remote sync-check。');
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
    console.log(`[branch] new: ${branchName}`);
  } catch (e) {
    // 可能 branch 已存在
    try {
      execSync(`git checkout "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' });
      console.log(`[branch] reuse: ${branchName}`);
    } catch (e2) {
      console.error(`[err] 無法建立或切換至 ${branchName}。檢查 git 狀態是否乾淨。`);
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

  // [P2] 明確指示 AI：先讀 manifest、輸出宣言、等 user 確認，再動程式
  console.log(`[start] ${taskDescription}`);
  console.log('  next (AI):');
  console.log('    1. read .guardian/current-task.md');
  console.log('    2. fill Q1–Q7 + output 合規聲明');
  console.log('    3. wait for user to confirm before touching any file');
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
