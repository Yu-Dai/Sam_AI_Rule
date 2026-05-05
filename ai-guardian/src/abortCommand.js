'use strict';

/**
 * abortCommand — 任務反悔退出
 *
 * 場景：user 跑了 ai-guardian start，但發現任務描述打錯、應該用 hotfix、或乾脆不想做了。
 * 之前沒有官方退路，只能手動清 current-task.json + git checkout + branch -D。
 *
 * 安全保證：
 *   - 偵測任務分支是否有「超出主線的 commit」→ 有就拒絕，避免 branch -D 永久丟失工作
 *   - 未 commit 的改動透過 stash → checkout main → stash pop 保留
 *   - 非互動環境必須 --yes，避免 CI / AI 誤觸
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const TRANSIENT_FILES = ['current-task.json', 'current-task.md', 'HOTFIX_MODE'];
// parseInt 顯式 radix（不依賴 ECMAScript 預設值，更明確）
const DECIMAL_RADIX = 10;

function git(args, opts = {}) {
  const result = spawnSync('git', args, {
    cwd: opts.cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0 && !opts.allowFail) {
    const cmd = `git ${args.join(' ')}`;
    const err = (result.stderr || '').trim() || `(exit ${result.status})`;
    throw new Error(`${cmd} failed: ${err}`);
  }
  return result;
}

function detectMainRef(projectRoot) {
  for (const ref of ['main', 'master']) {
    const r = git(['rev-parse', '--verify', ref], { cwd: projectRoot, allowFail: true });
    if (r.status === 0) return ref;
  }
  return null;
}

async function confirmInteractive(question) {
  if (!process.stdin.isTTY) return false;
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + ' [y/N]: ', ans => {
      rl.close();
      const a = ans.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function runAbort(projectRoot, options = {}) {
  const { yes = false } = options;
  const guardianDir = path.join(projectRoot, '.guardian');
  const manifestPath = path.join(guardianDir, 'current-task.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ 沒有 active task — 沒東西可 abort。');
    console.error('   若 .guardian/ 有殘留檔案需清理，請手動處理。');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.error('❌ 讀取 current-task.json 失敗：' + e.message);
    process.exit(1);
  }

  const { branch: taskBranch, taskDescription: taskDesc, startedAt } = manifest;

  let currentBranch;
  try {
    currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectRoot }).stdout.trim();
  } catch (e) {
    console.error('❌ 無法取得當前 branch：' + e.message);
    process.exit(1);
  }

  if (currentBranch !== taskBranch) {
    console.error(`❌ 當前在 "${currentBranch}"，但任務分支是 "${taskBranch}"。`);
    console.error(`   請先 git checkout "${taskBranch}" 再 abort。`);
    process.exit(1);
  }

  const mainRef = detectMainRef(projectRoot);
  if (!mainRef) {
    console.error('❌ 找不到 main / master 分支，無法判斷主線。');
    process.exit(1);
  }

  // 阻擋級檢查：任務分支不可有超出主線的 commit
  const aheadResult = git(['rev-list', `${mainRef}..HEAD`, '--count'], {
    cwd: projectRoot, allowFail: true,
  });
  const aheadCount = parseInt(aheadResult.stdout.trim(), DECIMAL_RADIX) || 0;

  if (aheadCount > 0) {
    console.error(`❌ 任務分支 "${taskBranch}" 已有 ${aheadCount} 個 commit 超出 ${mainRef}。`);
    console.error('   abort 會永久刪除這些 commit。為避免遺失，已阻擋。');
    console.error('');
    console.error('   你可以選：');
    console.error('   • 想保留 → 跑完 ai-guardian review + git commit + ai-guardian finish');
    console.error(`   • 確定要丟 → git reset --hard ${mainRef}，再執行 ai-guardian abort`);
    console.error('');
    console.error('   commits 列表：');
    const log = git(['log', '--oneline', `${mainRef}..HEAD`], {
      cwd: projectRoot, allowFail: true,
    });
    (log.stdout || '').trim().split('\n').forEach(l => console.error('     ' + l));
    process.exit(1);
  }

  const status = git(['status', '--porcelain'], { cwd: projectRoot }).stdout.trim();
  const dirtyLines = status ? status.split('\n') : [];

  console.log('');
  console.log('🚧 AI Guardian abort 預覽：');
  console.log(`   任務描述：${taskDesc}`);
  console.log(`   任務分支：${taskBranch}`);
  console.log(`   開始時間：${startedAt}`);
  console.log(`   未 commit 改動：${dirtyLines.length} 個檔案（會 stash → ${mainRef} → pop 保留）`);
  dirtyLines.forEach(l => console.log('     ' + l));
  console.log('');

  if (!yes) {
    const ok = await confirmInteractive('要繼續 abort 嗎？');
    if (!ok) {
      if (!process.stdin.isTTY) {
        console.error('❌ 非互動環境且未傳 --yes，已阻擋。');
        process.exit(1);
      }
      console.log('🛑 已取消 abort。');
      process.exit(0);
    }
  }

  // 執行 abort
  let stashedSomething = false;
  if (dirtyLines.length > 0) {
    git(['stash', 'push', '-u', '-m', `guardian-abort-${Date.now()}`], { cwd: projectRoot });
    stashedSomething = true;
  }

  git(['checkout', mainRef], { cwd: projectRoot });
  git(['branch', '-D', taskBranch], { cwd: projectRoot });

  // 順序關鍵：先 stash pop 還原 user 改動，再清 transient。
  // 因為 stash 可能收進 untracked 的 .guardian/ 內容（當 .gitignore 沒設好時），
  // pop 後它們會回來，必須再刪一次。
  if (stashedSomething) {
    const popResult = git(['stash', 'pop'], { cwd: projectRoot, allowFail: true });
    if (popResult.status !== 0) {
      console.warn('⚠️  stash pop 衝突，stash 已保留。請手動執行：git stash list / git stash apply');
    }
  }

  for (const f of TRANSIENT_FILES) {
    const p = path.join(guardianDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  console.log('');
  console.log(`✅ 已 abort 任務 "${taskDesc}"。`);
  console.log(`   分支 ${taskBranch} 已刪除，當前在 ${mainRef}。`);
  if (stashedSomething) {
    console.log('   未 commit 改動已 stash → pop 還原到主線工作區。');
  }
}

module.exports = { runAbort };
