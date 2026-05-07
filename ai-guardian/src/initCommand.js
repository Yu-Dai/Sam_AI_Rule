const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadTemplate, renderTemplate } = require('./utils/templates');

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
    } else {
      console.log('[ide] ' + adapter.label + ': rule only (IDE 無原生 skill 系統)');
    }
  });

  // 4a. 寫入 AGENTS.md — 全規則的 SSoT（個人 + 行為原則 + 工具規格，跨 IDE 標準）
  //     template 自身已含 H1 marker 與 auto-gen 說明，渲染後直接寫入即可
  const agentsResult = writeAutoGenIfPossible(path.join(targetDir, 'AGENTS.md'), AGENTS_MD_MARKER, agentsMd);
  if (agentsResult.written) {
    writtenFiles.push('AGENTS.md');
    console.log('[' + (agentsResult.action === '建立' ? 'create' : 'update') + '] AGENTS.md');
  } else {
    console.log('[skip] AGENTS.md 已客製化（無 auto-gen marker）');
  }

  // 4b. 寫入 CLAUDE.md stub — 用 Claude Code 原生 @import 語法把 AGENTS.md 載入 context
  //     原本用 markdown link「See [AGENTS.md](AGENTS.md)」是無效的 — Claude Code 不會主動 fetch，
  //     只會讀到「請去看 AGENTS.md」的字面文字。改用官方 @import 後 Claude Code 會在 session
  //     啟動時把 AGENTS.md 全文展開進 context，等同 Claude Code 直接讀到 AGENTS.md 全文。
  //     參考：https://code.claude.com/docs/en/memory（"Claude Code reads CLAUDE.md, not AGENTS.md"）
  //
  //     注意：HTML comments 在 Claude Code 看到時會被剝除，所以人類維護備註不會污染 Claude context；
  //           marker 字串「<!-- ai-guardian:claude-stub -->」也是 HTML comment，但 init 是直接讀
  //           檔案判斷 marker，不受剝除影響。
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
  const claudeResult = writeAutoGenIfPossible(path.join(targetDir, 'CLAUDE.md'), CLAUDE_MD_MARKER, claudeStub);
  if (claudeResult.written) {
    writtenFiles.push('CLAUDE.md');
    console.log('[' + (claudeResult.action === '建立' ? 'create' : 'update') + '] CLAUDE.md (stub → @AGENTS.md)');
  } else {
    console.log('[skip] CLAUDE.md 已客製化（無 stub marker）');
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

  console.log('\n[done] guardian 已掛載');
  console.log('       workflow: start "<task>" → work → review → commit → finish');
}

module.exports = { initProject };
