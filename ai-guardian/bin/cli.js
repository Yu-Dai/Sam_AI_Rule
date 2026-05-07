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
const {
  AGENTS_MD_MARKER,
  CLAUDE_MD_MARKER,
  detectFileState,
} = require('../src/utils/conflictResolver');

// IDE 編號 → key 的對照（順序也用於 askIDE 顯示）
const IDE_NUM_TO_KEY = { '1': 'cursor', '2': 'windsurf', '3': 'roo', '4': 'claude', '5': 'antigravity' };
const IDE_VALID_KEYS = new Set(Object.values(IDE_NUM_TO_KEY));
const VALID_CONFLICT_DECISIONS = new Set(['skip', 'overwrite', 'insert-import']);

function parseIdesAnswer(answer) {
  if (!answer || !answer.trim()) return [];
  const selected = [];
  answer.split(',').map(s => s.trim()).forEach(ch => {
    if (IDE_NUM_TO_KEY[ch]) selected.push(IDE_NUM_TO_KEY[ch]);
    else if (IDE_VALID_KEYS.has(ch.toLowerCase())) selected.push(ch.toLowerCase());
  });
  return [...new Set(selected)]; // dedup
}

// process.argv: [node, script, command, ...args]
const COMMAND_ARG_INDEX = 2;
const FIRST_TASK_ARG_INDEX = 3;

const command = process.argv[COMMAND_ARG_INDEX];

async function main() {
  if (command === 'init' || command === 'adopt') {
    await runInitOrAdopt(command === 'adopt');

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

/**
 * init / adopt 主流程：
 * - 非互動（--ides=...）：直接執行，--on-conflict 控制衝突處理
 * - 互動：依序問 mode（init only）→ IDE（強制選擇）→ PROJECT.md → 衝突 prompt
 */
async function runInitOrAdopt(isAdoptCmd) {
  const idesArg = process.argv.find(arg => arg.startsWith('--ides='));
  const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
  const onConflictArg = process.argv.find(arg => arg.startsWith('--on-conflict='));

  // ===== 非互動：--ides= 旗標 =====
  if (idesArg) {
    const selected = parseIdesAnswer(idesArg.split('=')[1]);
    if (selected.length === 0) {
      console.error('[err] --ides= 需要至少一個 IDE。可用：cursor / windsurf / roo / claude / antigravity（或 1-5）');
      process.exit(1);
    }
    const isAdopt = isAdoptCmd ? true : (modeArg ? modeArg.split('=')[1] !== 'standard' : true);
    const createProjectMd = process.argv.includes('--project-md');

    const onConflict = onConflictArg ? onConflictArg.split('=')[1] : 'skip';
    if (!VALID_CONFLICT_DECISIONS.has(onConflict)) {
      console.error(`[err] --on-conflict 必須是 ${[...VALID_CONFLICT_DECISIONS].join(' / ')} 之一`);
      process.exit(1);
    }
    const conflictDecisions = buildNonInteractiveConflictDecisions(process.cwd(), onConflict);
    initProject(process.cwd(), selected, isAdopt, { createProjectMd, conflictDecisions });
    process.exit(0);
  }

  // ===== 互動模式 =====
  // 自己維護 line queue + waiter 隊列。原因：rl.question() 在 piped stdin 上有 race —
  // 當多個 line event 接連到達、但兩次 question() 之間有空檔時，line event 會被丟掉
  // （因為 question 的 once-listener 還沒註冊上）。手動 queue 確保 every line 都被消費。
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lineQueue = [];
  const waiterQueue = [];
  rl.on('line', line => {
    if (waiterQueue.length > 0) waiterQueue.shift()(line);
    else lineQueue.push(line);
  });
  const ask = prompt => new Promise(resolve => {
    process.stdout.write(prompt);
    if (lineQueue.length > 0) resolve(lineQueue.shift());
    else waiterQueue.push(resolve);
  });

  try {
    let isAdopt;
    if (!isAdoptCmd) {
      console.log('\nai-guardian init — 選擇專案狀態：');
      console.log('  1. 全新專案（建立 src/production / lab / archive 隔離結構）');
      console.log('  2. 既有專案（無痛掛載：保留現有結構，建立 .guardian 沙盒）[預設]');
      const modeAns = await ask('您的選項 (預設為 2): ');
      isAdopt = modeAns.trim() !== '1';
    } else {
      console.log('\nai-guardian adopt — 中途接管，重新掛載 git hook 與 IDE rules（不動其他專案結構）');
      isAdopt = true;
    }

    const selected = await askIDEInteractive(ask);

    const projectAns = await ask('是否建立 PROJECT.md（長期專案方向追蹤檔）？(y/N): ');
    const projectLower = projectAns.trim().toLowerCase();
    const createProjectMd = projectLower === 'y' || projectLower === 'yes';

    const conflictDecisions = await scanAndPromptConflicts(ask, process.cwd());

    initProject(process.cwd(), selected, isAdopt, { createProjectMd, conflictDecisions });
  } finally {
    rl.close();
    // 顯式 process.exit：readline 在 Windows Git Bash 上 close 後仍可能持有 stdin handle
    process.exit(0);
  }
}

async function askIDEInteractive(ask) {
  console.log('\n本機 IDE（可多選，逗號分隔，例如 1,5）：');
  console.log('  1. cursor       (.cursor/rules + skills)');
  console.log('  2. windsurf     (.windsurfrules)');
  console.log('  3. roo          (.roo/rules + skills)');
  console.log('  4. claude       (.claude/rules + skills)');
  console.log('  5. antigravity  (.agents/rules + skills)');

  while (true) {
    const answer = await ask('您的選擇（必填，至少一個）: ');
    const selected = parseIdesAnswer(answer);
    if (selected.length > 0) return selected;
    console.log('  [err] 必須選至少一個。輸入 1-5（多選用逗號分隔），例如 1,5');
  }
}

async function scanAndPromptConflicts(ask, cwd) {
  const decisions = {};
  const agentsState = detectFileState(path.join(cwd, 'AGENTS.md'), AGENTS_MD_MARKER);
  if (agentsState === 'custom') {
    decisions.AGENTS_MD = await promptAgentsConflict(ask);
  }
  const claudeState = detectFileState(path.join(cwd, 'CLAUDE.md'), CLAUDE_MD_MARKER);
  if (claudeState === 'custom') {
    decisions.CLAUDE_MD = await promptClaudeConflict(ask);
  }
  return decisions;
}

async function promptAgentsConflict(ask) {
  console.log('');
  console.log('[!] 這個專案已經有 AGENTS.md，但 ai-guardian 沒辦法判斷它是自己之前產生的、還是你手寫的。');
  console.log('    若直接 skip 不動它，guardian 規則不會被 IDE / AI 載入。');
  console.log('');
  console.log('    [s] skip      — 保留你的版本，guardian 規則不生效（之後你自己處理）');
  console.log('    [o] overwrite — 用 guardian template 覆寫（舊版備份到 AGENTS.md.bak.<timestamp>）');
  console.log('');
  while (true) {
    const ans = (await ask('選擇 [s/o]（必填）: ')).trim().toLowerCase();
    if (ans === 's' || ans === 'skip') return 'skip';
    if (ans === 'o' || ans === 'overwrite') return 'overwrite';
    console.log('  [err] 請輸入 s 或 o');
  }
}

async function promptClaudeConflict(ask) {
  console.log('');
  console.log('[!] 這個專案已經有 CLAUDE.md，但 ai-guardian 沒辦法判斷它是自己之前產生的、還是你手寫的。');
  console.log('    若直接 skip 不動它，Claude Code 不會自動載入 AGENTS.md → guardian 規則對 Claude Code 失效。');
  console.log('');
  console.log('    [s] skip          — 保留你的版本（Claude Code 不會載入 guardian 規則）');
  console.log('    [o] overwrite     — 用 stub 覆寫（舊版備份到 CLAUDE.md.bak.<timestamp>）');
  console.log('    [i] insert-import — 在你的 CLAUDE.md 頂端加一行 @AGENTS.md（保留你所有內容 + 載入 guardian 規則）');
  console.log('');
  while (true) {
    const ans = (await ask('選擇 [s/o/i] (預設 i): ')).trim().toLowerCase();
    if (ans === '' || ans === 'i' || ans === 'insert-import') return 'insert-import';
    if (ans === 's' || ans === 'skip') return 'skip';
    if (ans === 'o' || ans === 'overwrite') return 'overwrite';
    console.log('  [err] 請輸入 s / o / i');
  }
}

function buildNonInteractiveConflictDecisions(cwd, onConflict) {
  const decisions = {};
  if (detectFileState(path.join(cwd, 'AGENTS.md'), AGENTS_MD_MARKER) === 'custom') {
    // insert-import 對 AGENTS.md 沒意義（規則需完整 body，不是 import），fallback 為 skip
    decisions.AGENTS_MD = onConflict === 'insert-import' ? 'skip' : onConflict;
  }
  if (detectFileState(path.join(cwd, 'CLAUDE.md'), CLAUDE_MD_MARKER) === 'custom') {
    decisions.CLAUDE_MD = onConflict;
  }
  return decisions;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
