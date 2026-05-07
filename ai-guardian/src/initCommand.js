const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadTemplate, renderTemplate } = require('./utils/templates');
const {
  AGENTS_MD_MARKER,
  CLAUDE_MD_MARKER,
  writeWithDecision,
} = require('./utils/conflictResolver');

// JSON.stringify 縮排寬度
const JSON_INDENT = 2;

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

function initProject(targetDir, ides = ['antigravity'], isAdopt = true, options = {}) {
  const { createProjectMd = false, conflictDecisions = {} } = options;
  // 追蹤本次 init 寫入的所有檔案，最後統一 commit（確保 working tree 乾淨）
  const writtenFiles = [];
  // 收集 summary：每個動作一行，最後一次印出
  const summary = [];
  // 1. 設定防護配置與資料夾結構
  let config = {};

  if (isAdopt) {
    const dirs = ['.guardian/lab', '.guardian/archive'];
    dirs.forEach(dir => {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log('[mkdir] ' + dir);
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
        console.log('[mkdir] ' + dir);
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
  console.log('[write] ai-guardian.json (mode: ' + (isAdopt ? 'adopt' : 'standard') + ')');

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
      console.log('[ide] ' + adapter.label + ': rule + adversarial-debate skill');
      summary.push(`IDE ${adapter.label}: rule + skill`);
    } else {
      console.log('[ide] ' + adapter.label + ': rule only (IDE 無原生 skill 系統)');
      summary.push(`IDE ${adapter.label}: rule only`);
    }
  });

  // 4a. 寫入 AGENTS.md — 全規則的 SSoT（個人 + 行為原則 + 工具規格，跨 IDE 標準）
  //     template 自身已含 H1 marker 與 auto-gen 說明，渲染後直接寫入即可
  //     有衝突（user 客製版本）時，cli.js 已蒐集 user 決策放進 conflictDecisions.AGENTS_MD
  const agentsDecision = conflictDecisions.AGENTS_MD || 'skip';
  const agentsResult = writeWithDecision(
    path.join(targetDir, 'AGENTS.md'),
    AGENTS_MD_MARKER,
    agentsMd,
    agentsDecision
  );
  if (agentsResult.written) {
    writtenFiles.push('AGENTS.md');
    if (agentsResult.action === 'create')                      summary.push('AGENTS.md  created');
    else if (agentsResult.action === 'update')                 summary.push('AGENTS.md  updated (auto-gen marker matched)');
    else if (agentsResult.action === 'overwrite-with-backup')  summary.push(`AGENTS.md  overwritten — your version backed up to ${path.basename(agentsResult.backupPath)}`);
  } else {
    summary.push('AGENTS.md  SKIPPED (your custom version kept; guardian rules NOT loaded)');
  }
  console.log(`[agents.md] ${agentsResult.action}`);

  // 4b. 寫入 CLAUDE.md stub — 用 Claude Code 原生 @import 語法把 AGENTS.md 載入 context
  //     參考：https://code.claude.com/docs/en/memory（"Claude Code reads CLAUDE.md, not AGENTS.md"）
  //     有衝突時 conflictDecisions.CLAUDE_MD 可為 skip / overwrite / insert-import
  //     insert-import 是 CLAUDE.md 專屬：在 user 既有檔頂端插一行 @AGENTS.md，保留 user 內容 + 載入規則
  const claudeStub = [
    CLAUDE_MD_MARKER,
    '# CLAUDE.md',
    '',
    '<!--',
    '  Claude Code stub by ai-guardian.',
    '  下方「@AGENTS.md」是 Claude Code 原生 import 語法 — session 啟動時會把 AGENTS.md 全文展開進 context。',
    '  其他 IDE（Cursor / Antigravity / Roo / Windsurf）直接讀 root AGENTS.md，這個 import 對它們無作用也無害。',
    '  per-project 客製：刪掉本檔第一行的 stub marker 註解後，ai-guardian init 不會再覆寫本檔。',
    '-->',
    '',
    '@AGENTS.md',
    '',
  ].join('\n');
  const claudeDecision = conflictDecisions.CLAUDE_MD || 'skip';
  const claudeResult = writeWithDecision(
    path.join(targetDir, 'CLAUDE.md'),
    CLAUDE_MD_MARKER,
    claudeStub,
    claudeDecision,
    { insertLine: '@AGENTS.md' }
  );
  if (claudeResult.written) {
    writtenFiles.push('CLAUDE.md');
    if (claudeResult.action === 'create')                      summary.push('CLAUDE.md  created (stub → @AGENTS.md)');
    else if (claudeResult.action === 'update')                 summary.push('CLAUDE.md  updated (stub marker matched)');
    else if (claudeResult.action === 'overwrite-with-backup')  summary.push(`CLAUDE.md  overwritten with stub — your version backed up to ${path.basename(claudeResult.backupPath)}`);
    else if (claudeResult.action === 'insert-import')          summary.push('CLAUDE.md  @AGENTS.md import inserted at top (your content kept)');
  } else {
    if (claudeResult.reason === 'import-already-present')      summary.push('CLAUDE.md  SKIPPED (@AGENTS.md import already present, no change needed)');
    else                                                       summary.push('CLAUDE.md  SKIPPED (your custom version kept; @AGENTS.md NOT loaded by Claude Code)');
  }
  console.log(`[claude.md] ${claudeResult.action}${claudeResult.reason ? ` (${claudeResult.reason})` : ''}`);

  // 4c. 可選：建立 PROJECT.md（user 在 cli prompt 同意時觸發）
  //     PROJECT.md 性質不同 — 給人填的方向追蹤檔，一旦建立由 user 接管。skip-if-exists 即可，無 marker 機制。
  if (createProjectMd) {
    const projectMdPath = path.join(targetDir, 'PROJECT.md');
    if (fs.existsSync(projectMdPath)) {
      console.log('[project.md] skip (already exists)');
      summary.push('PROJECT.md skipped (already exists)');
    } else {
      fs.writeFileSync(projectMdPath, loadTemplate('PROJECT.md'), 'utf-8');
      writtenFiles.push('PROJECT.md');
      console.log('[project.md] create');
      summary.push('PROJECT.md created (please fill in)');
    }
  }

  // 5. 確保有 .git 資料夾（沒有就 init 一個，否則後續 hook 與 auto-commit 都會失敗）
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');
  if (!fs.existsSync(gitHooksDir)) {
    console.log('[init] 無 .git，自動執行 git init');
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
    console.log('[update] .gitignore (加入 .guardian/ 暫存檔排除規則)');
  } else {
    console.log('[skip] .gitignore 已含 guardian 排除規則');
  }

  // 7. 掛載 Git pre-commit Hook
  const finalHookDir = path.join(targetDir, '.git', 'hooks');
  if (fs.existsSync(finalHookDir)) {
    const preCommitPath = path.join(finalHookDir, 'pre-commit');
    // 升級版 pre-commit hook：reviewPassed 檢查整合在 guard 指令內部，hook 只需單一入口
    const hookLines = [
      '#!/bin/sh',
      '# AI Guardian pre-commit hook',
      '',
      '# guard 指令內部整合 reviewPassed 檢查 + AST 掃描，單一入口避免重複攔截',
      'ai-guardian guard',
      'GUARD_EXIT=$?',
      '',
      'if [ $GUARD_EXIT -ne 0 ]; then',
      '  echo "[blocked] commit 被攔截。修復上述問題後重試。"',
      '  exit 1',
      'fi',
      '',
      'exit 0',
    ];
    fs.writeFileSync(preCommitPath, hookLines.join('\n'), { mode: 0o755 });
    console.log('[hook] mounted .git/hooks/pre-commit');
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
      console.log('\n[ok] auto-committed guardian setup (working tree is clean)');
    } else {
      console.log('\n[skip] 設定無變動，無需提交');
    }
  } catch (e) {
    console.log('\n[warn] git auto-commit skipped: ' + e.message.split('\n')[0]);
    console.log('  fix: git add ' + writtenFiles.map(f => `"${f}"`).join(' '));
    console.log('       git commit --no-verify -m "chore(guardian): apply ai-guardian setup"');
  }

  // ===== 結尾 summary：把這次發生的事一次列清楚，user 不必往上滑 =====
  console.log('\n[summary]');
  if (summary.length === 0) {
    console.log('  (no file changes recorded)');
  } else {
    summary.forEach(line => console.log('  ' + line));
  }

  console.log('\n[done] guardian 已掛載');
  console.log('       workflow: start "<task>" → work → review → commit → finish');
}

module.exports = { initProject };
