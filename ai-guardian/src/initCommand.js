const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// JSON.stringify 縮排寬度
const JSON_INDENT = 2;

// 規則本體與 SKILL 的 single source of truth
// 任何規則文字的修改，請改 templates/AGENTS.md，不要回頭塞 JS 字串
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplate(filename) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf-8');
}

function renderTemplate(content, vars) {
  return Object.keys(vars).reduce(
    (acc, key) => acc.split('{{' + key + '}}').join(vars[key]),
    content
  );
}

// IDE 配接器：每個 IDE 只描述「我的 rule 檔放哪、用什麼 frontmatter、要不要 skill」
// 不再夾帶規則本體 — 規則只活在 templates/AGENTS.md（即部署到根目錄的 AGENTS.md SSoT）
const REFERENCE_NOTE = 'See [AGENTS.md](AGENTS.md) for the full AI Guardian protocol. Apply every rule there as if it were inline here.';

const IDE_ADAPTERS = {
  antigravity: {
    label: 'ANTIGRAVITY / COPILOT',
    ruleFile: '.agents/rules/ai_guardian_protocol.md',
    skillDir: '.agents/skills/adversarial-debate',
    renderRule: () => '---\ntrigger: always_on\n---\n\n' + REFERENCE_NOTE + '\n',
  },
  cursor: {
    label: 'CURSOR',
    ruleFile: '.cursor/rules/ai_guardian.mdc',
    skillDir: null, // Cursor 無原生 skill 載入機制
    renderRule: () => [
      '---',
      'description: "AI Guardian protocol — see AGENTS.md for full spec"',
      'globs: ["**/*"]',
      'alwaysApply: true',
      '---',
      '',
      REFERENCE_NOTE,
      '',
      '@AGENTS.md',
      '',
    ].join('\n'),
  },
  windsurf: {
    label: 'WINDSURF',
    ruleFile: '.windsurfrules',
    skillDir: null, // Windsurf 無原生 skill 載入機制
    renderRule: () => REFERENCE_NOTE + '\n',
  },
  roo: {
    label: 'ROO CODE',
    ruleFile: '.roo/rules/ai_guardian.md',
    skillDir: null, // Roo 無原生 skill 載入機制
    renderRule: () => REFERENCE_NOTE + '\n',
  },
  claude: {
    label: 'CLAUDE CODE',
    ruleFile: '.claude/rules/ai_guardian.md',
    skillDir: '.claude/skills/adversarial-debate',
    renderRule: () => '---\ndescription: AI Guardian 系統強制操作約束（完整內容見 AGENTS.md）\n---\n\n' + REFERENCE_NOTE + '\n',
  },
};

// 自動產生檔案的固定首行 marker — 用來區分「auto-gen」vs「使用者客製版本」
// 移除 marker = 視為使用者客製，init 不再覆寫
const AGENTS_MD_MARKER = '# AGENTS.md — AI Guardian Project Rules';
// CLAUDE.md 的 stub 用 marker（內容很短，但仍走相同的 marker 判定機制）
const CLAUDE_MD_MARKER = '<!-- ai-guardian:claude-stub -->';

// 安全寫入：只在「檔案不存在」或「現有檔案以 marker 開頭」時覆寫
// 回傳 { written, action }；written=false 代表偵測到客製版本，跳過
function writeAutoGenIfPossible(filePath, marker, content) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
  const canOverwrite = existing === null || existing.startsWith(marker);
  if (canOverwrite) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { written: true, action: existing === null ? '建立' : '更新' };
  }
  return { written: false };
}

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
    };
  }

  // 儲存配置檔
  fs.writeFileSync(path.join(targetDir, 'ai-guardian.json'), JSON.stringify(config, null, JSON_INDENT), 'utf-8');
  writtenFiles.push('ai-guardian.json');
  console.log('⚙️ 建立設定檔: ai-guardian.json (模式: ' + (isAdopt ? '無痛掛載 Adopt' : '全新標準 Standard') + ')');

  // 2. 從 template 渲染規則本體（single source of truth: templates/AGENTS.md）
  const productionLabel = isAdopt ? '目前專案的所有主要原始碼' : '`src/production` 區的程式碼';
  const labLabel = isAdopt ? '`.guardian/lab` 與 `.guardian/archive`' : '`src/lab` 與 `src/archive`';

  const agentsMd = renderTemplate(loadTemplate('AGENTS.md'), {
    PRODUCTION_LABEL: productionLabel,
    LAB_LABEL: labLabel,
  }).trimEnd() + '\n';

  const debateSkillProtocol = loadTemplate('SKILL_adversarial_debate.md').trimEnd();

  // 3. 為勾選的每個 IDE 寫入 reference stub（規則本體只活在 AGENTS.md / templates）
  ides.forEach(ideName => {
    const adapter = IDE_ADAPTERS[ideName.toLowerCase()];
    if (!adapter) return;

    const ruleAbs = path.join(targetDir, adapter.ruleFile);
    fs.mkdirSync(path.dirname(ruleAbs), { recursive: true });
    fs.writeFileSync(ruleAbs, adapter.renderRule(), 'utf-8');
    writtenFiles.push(adapter.ruleFile);

    if (adapter.skillDir) {
      const skillAbs = path.join(targetDir, adapter.skillDir);
      fs.mkdirSync(skillAbs, { recursive: true });
      const skillRel = adapter.skillDir + '/SKILL.md';
      fs.writeFileSync(path.join(skillAbs, 'SKILL.md'), debateSkillProtocol, 'utf-8');
      writtenFiles.push(skillRel);
      console.log('✅ 配置成功: ' + adapter.label + ' (rule reference + adversarial-debate skill)');
    } else {
      console.log('✅ 配置成功: ' + adapter.label + ' (rule reference only — IDE 無原生 skill 系統)');
    }
  });

  // 4a. 寫入 AGENTS.md — 全規則的 SSoT（個人 + 行為原則 + 工具規格，跨 IDE 標準）
  //     template 自身已含 H1 marker 與 auto-gen 說明，渲染後直接寫入即可
  const agentsResult = writeAutoGenIfPossible(path.join(targetDir, 'AGENTS.md'), AGENTS_MD_MARKER, agentsMd);
  if (agentsResult.written) {
    writtenFiles.push('AGENTS.md');
    console.log('✅ ' + agentsResult.action + ' AGENTS.md（規則真理來源）');
  } else {
    console.log('ℹ️  AGENTS.md 看起來已被使用者客製化（未帶 auto-gen marker），跳過覆寫。');
  }

  // 4b. 寫入 CLAUDE.md stub — 只是給 Claude Code 與人類瀏覽者的引導，本體在 AGENTS.md
  const claudeStub = [
    CLAUDE_MD_MARKER,
    '# CLAUDE.md',
    '',
    'See [AGENTS.md](AGENTS.md) for the full ruleset (individual identity, behavior principles §1–§21, hard rules, AI Guardian tool spec).',
    '',
    '本檔僅是引導 stub — 規則本體在 AGENTS.md。要做 per-project 客製，請刪掉本檔第一行的 marker 註解，init 即不再覆寫。',
    '',
  ].join('\n');
  const claudeResult = writeAutoGenIfPossible(path.join(targetDir, 'CLAUDE.md'), CLAUDE_MD_MARKER, claudeStub);
  if (claudeResult.written) {
    writtenFiles.push('CLAUDE.md');
    console.log('✅ ' + claudeResult.action + ' CLAUDE.md（stub → AGENTS.md）');
  } else {
    console.log('ℹ️  CLAUDE.md 看起來已被使用者客製化（未帶 stub marker），跳過覆寫。');
  }

  // 5. 確保有 .git 資料夾（沒有就 init 一個，否則後續 hook 與 auto-commit 都會失敗）
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');
  if (!fs.existsSync(gitHooksDir)) {
    console.log('⚠️  未偵測到 .git 資料夾，AI Guardian 自動執行 git init...');
    try {
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
    '.guardian/state/',
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
    // 升級版 pre-commit hook：reviewPassed 檢查整合在 guard 指令內部，hook 只需單一入口
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
      '.guardian/state',
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
