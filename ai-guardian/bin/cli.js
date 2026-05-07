#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Pre-flight: 檢查依賴是否已安裝
const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.error('');
  console.error('[err] ai-guardian dependencies not installed (no node_modules).');
  console.error('');
  console.error('  fix:  cd ' + path.resolve(__dirname, '..'));
  console.error('        npm install');
  console.error('');
  console.error('  or one-shot via bootstrap (in Sam_AI_Rule clone):');
  console.error('        bash bootstrap.sh   # Linux / Mac / git bash');
  console.error('        .\\bootstrap.ps1    # Windows PowerShell');
  console.error('');
  process.exit(1);
}

const { initProject } = require('../src/initCommand');
const { runGuard } = require('../src/guardCommand');
const { runStart } = require('../src/startCommand');
const { runReview } = require('../src/reviewCommand');
const { runFinish } = require('../src/finishCommand');
const { runUninstall } = require('../src/uninstallCommand');

// process.argv: [node, script, command, ...args]
const COMMAND_ARG_INDEX = 2;
const FIRST_TASK_ARG_INDEX = 3;

const command = process.argv[COMMAND_ARG_INDEX];

async function main() {
  if (command === 'init' || command === 'adopt') {
    const isAdoptCmd = command === 'adopt';
    const idesArg = process.argv.find(arg => arg.startsWith('--ides='));
    const modeArg = process.argv.find(arg => arg.startsWith('--mode='));

    if (idesArg) {
      const idesList = idesArg.split('=')[1].split(',').map(s => s.trim());
      const selected = [];
      idesList.forEach(ch => {
        if (ch === '1' || ch.toLowerCase() === 'cursor') selected.push('cursor');
        if (ch === '2' || ch.toLowerCase() === 'windsurf') selected.push('windsurf');
        if (ch === '3' || ch.toLowerCase() === 'roo') selected.push('roo');
        if (ch === '4' || ch.toLowerCase() === 'claude') selected.push('claude');
        if (ch === '5' || ch.toLowerCase() === 'antigravity') selected.push('antigravity');
      });
      if (selected.length === 0) selected.push('antigravity');
      const isAdopt = isAdoptCmd ? true : (modeArg ? modeArg.split('=')[1] !== 'standard' : true);
      initProject(process.cwd(), selected, isAdopt);
      process.exit(0);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (!isAdoptCmd) {
      console.log('\nai-guardian init — 選擇專案狀態：');
      console.log('  1. 全新專案（建立 src/production / lab / archive 隔離結構）');
      console.log('  2. 既有專案（無痛掛載：保留現有結構，建立 .guardian 沙盒）[預設]');

      rl.question('您的選項 (預設為 2): ', (modeAnswer) => {
        const isAdopt = modeAnswer.trim() !== '1';
        askIDE(rl, isAdopt);
      });
    } else {
      console.log('\nai-guardian adopt — 中途接管，重新掛載 git hook 與 IDE rules（不動其他專案結構）');
      askIDE(rl, true);
    }

    function askIDE(rl, isAdopt) {
      console.log('\n本機 IDE（可多選，逗號分隔，例如 1,5）：');
      console.log('  1. cursor       (.cursor/rules + skills)');
      console.log('  2. windsurf     (.windsurfrules)');
      console.log('  3. roo          (.roo/rules + skills)');
      console.log('  4. claude       (.claude/rules + skills)');
      console.log('  5. antigravity  (.agents/rules + skills) [預設]');

      rl.question('您的選擇 (預設為 5): ', (answer) => {
        const selected = [];
        if (!answer.trim()) {
          selected.push('antigravity');
        } else {
          answer.split(',').map(s => s.trim()).forEach(ch => {
            if (ch === '1') selected.push('cursor');
            if (ch === '2') selected.push('windsurf');
            if (ch === '3') selected.push('roo');
            if (ch === '4') selected.push('claude');
            if (ch === '5') selected.push('antigravity');
          });
          if (selected.length === 0) selected.push('antigravity');
        }
        initProject(process.cwd(), selected, isAdopt);
        rl.close();
        // 顯式 process.exit：readline 在 Windows Git Bash 上 close 後仍可能持有 stdin handle，
        // 導致 Node event loop 不退、父 shell（例如 init-project.sh）卡死要 user Ctrl+C → exit 130
        process.exit(0);
      });
    }

  } else if (command === 'start') {
    const args = process.argv.slice(FIRST_TASK_ARG_INDEX);
    const forceStale = args.includes('--force-stale');
    const taskDescription = args.filter(a => a !== '--force-stale').join(' ');
    await runStart(process.cwd(), taskDescription, { forceStale });

  } else if (command === 'review') {
    const isForce = process.argv.includes('--force');
    runReview(process.cwd(), isForce);

  } else if (command === 'finish') {
    const forceStale = process.argv.includes('--force-stale');
    await runFinish(process.cwd(), { forceStale });

  } else if (command === 'abort') {
    const isYes = process.argv.includes('--yes') || process.argv.includes('-y');
    const { runAbort } = require('../src/abortCommand');
    await runAbort(process.cwd(), { yes: isYes });

  } else if (command === 'self-update') {
    const { runSelfUpdate } = require('../src/selfUpdateCommand');
    runSelfUpdate(process.cwd());

  } else if (command === 'debate') {
    const subCommand = process.argv[FIRST_TASK_ARG_INDEX];
    const { runDebate } = require('../src/debateCommand');
    runDebate(process.cwd(), subCommand);

  } else if (command === 'uninstall') {
    const isFull = process.argv.includes('--full');
    runUninstall(process.cwd(), isFull);

  } else if (command === 'guard') {
    // 檢查是否已跑過 review（如果有任務宣言的話）
    const manifestPath = path.join(process.cwd(), '.guardian', 'current-task.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.reviewPassed) {
        console.error('[blocked] commit 前必須先 review。跑 ai-guardian review。');
        process.exit(1);
      }
    }

    try {
      const result = await runGuard(process.cwd());
      if (!result.success) {
        console.error('\n[blocked] commit 被 guardian 攔截。');
        (result.errors || []).forEach(err => console.error('  ' + err));
        console.error('\n  AI: 依錯誤訊息重構，禁止打補丁。走 root-cause fix。');
        process.exit(1);
      } else {
        console.log('[guard] OK');
      }
    } catch (err) {
      console.error(`[err] guard scan 失敗: ${err.message}`);
      process.exit(1);
    }

  } else {
    // 當輸入 --help, -h, help 或是未知的指令時，一律印出這段
    console.log(`
ai-guardian — task-flow + AST commit gate

workflow:
  ai-guardian start "<task>"   開工：建立 task branch + 產生 .guardian/current-task.md
  ... 工作 ...
  ai-guardian review           commit 前審查（AST patch scan + 殭屍命名 + 填寫檢查）
  git commit                   審查通過才能提交（pre-commit hook 會擋）
  ai-guardian finish           合併 task branch → main，歸檔

flags (start / finish 共用):
  --force-stale                繞過 remote sync-check（start 會記錄，finish 一次性）

setup / 突發:
  ai-guardian init             新專案初始化（建立沙盒結構與全域規則）
  ai-guardian adopt            中途接管既有專案（掛 hook + IDE rules）
  ai-guardian start "hotfix:"  急修模式（跳過 AST 掃描與 lab 強制）
  ai-guardian abort [--yes]    丟棄當前任務（branch 刪除，未 commit 改動 stash 保留）
  ai-guardian guard            手動跑 AST 掃描（通常 pre-commit hook 自動執行）
  ai-guardian debate           pre-mortem 對峙（subcommand: start / status / submit-cto / submit-architect / approve / reset）
  ai-guardian self-update      [dev] 把 source clone 同步到 canonical（不必重跑 bootstrap）

uninstall:
  ai-guardian uninstall        移除 hook + .gitignore 規則
  ai-guardian uninstall --full 移除所有 guardian 設定檔與目錄
    `);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
