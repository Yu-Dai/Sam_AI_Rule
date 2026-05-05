#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Pre-flight: 檢查依賴是否已安裝
const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.error('');
  console.error('❌ ai-guardian 依賴尚未安裝（缺少 node_modules）。');
  console.error('');
  console.error('修復方式：');
  console.error('  cd ' + path.resolve(__dirname, '..'));
  console.error('  npm install');
  console.error('');
  console.error('或在 Sam_AI_Rule clone 內執行 bootstrap 一鍵安裝：');
  console.error('  cd <Sam_AI_Rule clone>');
  console.error('  bash bootstrap.sh        # Linux/Mac/git bash');
  console.error('  .\\bootstrap.ps1         # Windows PowerShell');
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
      console.log('\n🛡️  AI Guardian - 初始化防線配置');
      console.log('請選擇您的專案狀態：');
      console.log('1. [ ] 全新專案 (建立標準 src/production, lab, archive 隔離結構)');
      console.log('2. [V] 既有專案 (無痛掛載：保留現有結構，建立 .guardian 沙盒)');
      console.log('-------------------------------------------');

      rl.question('您的選項 (預設為 2): ', (modeAnswer) => {
        const isAdopt = modeAnswer.trim() !== '1';
        askIDE(rl, isAdopt);
      });
    } else {
      console.log('\n🤝 AI Guardian - 中途接管專案 (Adopt Mode)');
      console.log('系統將會為您的本機環境重新掛載 Git Hooks 與 IDE 防護規則，不影響其他專案結構。');
      askIDE(rl, true);
    }

    function askIDE(rl, isAdopt) {
      console.log('\n請選擇您的本機 IDE 環境 (可多選，例如 1,5)：');
      console.log('1. [ ] CURSOR (.cursor/rules & skills)');
      console.log('2. [ ] WINDSURF (.windsurfrules)');
      console.log('3. [ ] ROO CODE (.roo/rules & skills)');
      console.log('4. [ ] CLAUDE CODE (.claude/rules & skills)');
      console.log('5. [V] ANTIGRAVITY (.agents/rules & skills)');
      console.log('-------------------------------------------');

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
    console.log('🔍 正在執行 AI Guardian 專案巡邏掃描...');

    // 檢查是否已跑過 review（如果有任務宣言的話）
    const manifestPath = path.join(process.cwd(), '.guardian', 'current-task.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.reviewPassed) {
        console.error('❌ [流程違規] 你尚未執行改動審查！');
        console.error('   請先執行 ai-guardian review 通過審查後再提交。');
        process.exit(1);
      }
    }

    try {
      const result = await runGuard(process.cwd());
      if (!result.success) {
        console.error('\n❌ [嚴重違規] 提交已被 AI Guardian 阻攔！');
        console.error('=============================================');
        (result.errors || []).forEach(err => console.error(err));
        console.error('=============================================');
        console.error('🤖 給 AI 的指示：請依照指示重構，嚴禁使用補丁 (Patch)，請依循 Product Rewrite Protocol。');
        process.exit(1);
      } else {
        console.log('✅ 掃描通過！未發現殭屍代碼或違規依賴。');
      }
    } catch (err) {
      console.error(`掃描過程發生錯誤: ${err.message}`);
      process.exit(1);
    }

  } else {
    // 當輸入 --help, -h, help 或是未知的指令時，一律印出這段
    console.log(`
🛡️  AI Guardian v2 - 全流程專案免疫系統

【開發流程（必須遵守）】
  ① ai-guardian start "<任務描述>"  - 開工前宣誓，自動建立 branch 或標記狀態
  ② ... 進行開發工作 ...
  ③ ai-guardian review              - 完工審查，分析改動報告
  ④ git commit                      - 審查通過後才能提交
  ⑤ ai-guardian finish              - 任務結束，自動合併主線並清理現場

【遠端同步旗標（start / finish 共用）】
  --force-stale                - 知情下繞過遠端落後檢查，繼續執行
                                 (start 會記錄決策，下次同版本不再問；finish 為一次性)

【環境與突發指令】
  ai-guardian init             - 初始化專案防禦網 (建立沙盒與全域規則)
  ai-guardian adopt            - 中途接手專案 (建立你的本機 IDE 防護設定檔與 Git Hook)
  ai-guardian start hotfix     - [急診模式] 繞過所有審查，執行緊急修護（含 sync-check）
  ai-guardian abort [--yes]    - [反悔退出] 丟棄當前任務、刪除分支、回到主線（保留未 commit 改動）
  ai-guardian self-update      - [開發者用] 從當前 source repo 同步 src + bin 到全域安裝
  ai-guardian guard            - 手動掃描 AST (通常由 git pre-commit hook 自動執行)
  ai-guardian debate reset     - [解鎖] 清除卡住的法庭狀態，解除 Commit 封鎖

【解除安裝】
  ai-guardian uninstall        - 解除安裝（移除 hook 與 .gitignore 規則）
  ai-guardian uninstall --full - 完整解除安裝（移除所有 guardian 設定檔與目錄）

【說明】
  輸入 ai-guardian --help 或 -h 可隨時查看此選單。
    `);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
