const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { checkRemoteSync, STATUS: SYNC_STATUS } = require('./utils/syncCheck');

async function runFinish(projectRoot, options = {}) {
  const { forceStale = false } = options;
  const guardianDir = path.join(projectRoot, '.guardian');
  const manifestPath = path.join(guardianDir, 'current-task.json');

  // 1. 確認任務宣言存在
  if (!fs.existsSync(manifestPath)) {
    console.error('[err] 找不到任務宣言。沒有 active task 可 finish。');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const branchName = manifest.branch;

  // 2. 只有審查通過才允許 Finish
  if (!manifest.reviewPassed) {
    console.error('[err] 任務尚未通過 review。先跑 ai-guardian review。');
    process.exit(1);
  }

  // 2.5 遠端同步檢查（嚴格模式：不記決策；hotfix 模式跳過全程護欄）
  const isHotfix = fs.existsSync(path.join(guardianDir, 'HOTFIX_MODE'));
  if (isHotfix) {
    console.log('[hotfix] 跳過 remote sync-check。');
  } else {
    const syncResult = await checkRemoteSync(projectRoot, {
      strict: true,
      forceStale,
      taskContext: manifest.taskDescription
    });
    if (syncResult.status === SYNC_STATUS.ABORTED) {
      process.exit(1);
    }
  }

  console.log(`\n[finish] ${branchName}`);

  // 3. 取得目前主線分支 (通常是 main 或 master)
  let mainBranch = 'main';
  try {
    const branches = execSync('git branch', { cwd: projectRoot }).toString();
    if (branches.includes('master') && !branches.includes('main')) {
      mainBranch = 'master';
    }
  } catch (e) {}

  // 判斷主線分支是否實際存在（全新 repo 可能從未建立過 main）
  let mainBranchExists = false;
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${mainBranch}`, { cwd: projectRoot });
    mainBranchExists = true;
  } catch (e) {
    mainBranchExists = false;
  }

  // [Pre-merge stash]
  //   start 現在允許帶著 pre-existing dirty 檔案進入任務（Option C 設計）。
  //   這些改動不屬於本次任務，merge 前先 stash 排開，merge 完後自動 pop 還原。
  //   只 stash 追蹤中的改動（-u 同時包含 untracked），確保 checkout/merge 乾淨執行。
  let stashedBeforeMerge = false;
  try {
    const dirty = execSync('git status --porcelain', { cwd: projectRoot }).toString().trim();
    if (dirty) {
      execSync('git stash push -u -m "guardian: pre-finish stash (auto)"', { cwd: projectRoot, stdio: 'pipe' });
      stashedBeforeMerge = true;
      console.log('  stashed dirty changes (will pop after merge)');
    }
  } catch (e) { /* 全新 repo 或無法 stash，跳過 */ }

  try {
    if (!mainBranchExists) {
      // 主線從未存在（全新 repo 首次 finish）：直接從當前 guardian 分支建立主線，不需 merge
      console.log(`  main branch ${mainBranch} 不存在，從任務分支建立`);
      execSync(`git branch ${mainBranch}`, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });
      execSync(`git checkout ${mainBranch}`, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });
      console.log(`  created main: ${mainBranch}（內容同任務分支，無需 merge）`);
    } else {
      // A. 切換回主線
      console.log(`  checkout ${mainBranch}`);
      execSync(`git checkout ${mainBranch}`, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });

      // B. 合併任務分支 (使用 --no-ff 保留紀錄)
      console.log(`  merge ${branchName} → ${mainBranch}`);
      execSync(`git merge "${branchName}" --no-edit`, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });
    }

    // C. 歸檔任務宣言至 .guardian/archive/tasks/
    const archiveTasksDir = path.join(guardianDir, 'archive', 'tasks');
    if (!fs.existsSync(archiveTasksDir)) {
      fs.mkdirSync(archiveTasksDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `${timestamp}_${branchName.replace(/[\/\\]/g, '_')}.json`;
    fs.renameSync(manifestPath, path.join(archiveTasksDir, archiveName));
    
    // D. 刪除暫時的 Markdown 說明與急診憑證
    const manifestMd = path.join(guardianDir, 'current-task.md');
    if (fs.existsSync(manifestMd)) fs.unlinkSync(manifestMd);
    
    const hotfixFlag = path.join(guardianDir, 'HOTFIX_MODE');
    if (fs.existsSync(hotfixFlag)) fs.unlinkSync(hotfixFlag);

    // E. 提交清理動作（archive 移入 + 暫存文件刪除），確保主線保持乾淨
    //    使用 --no-verify 是刻意的：此 commit 只移動 .guardian/ 內部帳務文件，
    //    不涉及任何程式碼，不需要也不應該觸發 guardian 自身的 pre-commit hook。
    //    若不加 --no-verify，guard 會因找不到 current-task.json 而退化成全量掃描，
    //    掃出問題後 block 掉這個 commit，導致檔案卡在 staged 未提交狀態。
    try {
      const cleanupDirty = execSync('git status --porcelain', { cwd: projectRoot }).toString().trim();
      if (cleanupDirty) {
        execSync('git add -A', { cwd: projectRoot, stdio: 'pipe' });
        const shortDesc = manifest.taskDescription.replace(/"/g, "'").slice(0, 50);
        execSync(`git commit --no-verify -m "chore(guardian): archive task – ${shortDesc}"`, { cwd: projectRoot, stdio: 'pipe' });
        console.log(`  archived task record`);
      }
    } catch (e) {
      console.warn(`\n[warn] 歸檔 commit 失敗，檔案已 staged 但未提交：${e.message}`);
      console.warn('  fix: git commit --no-verify -m "chore(guardian): manual archive cleanup"');
    }

    // F. 刪除本地任務分支 (既然已經合併了)
    console.log(`  delete branch ${branchName}`);
    execSync(`git branch -d "${branchName}"`, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });

    // G. 還原任務前的 pre-existing 改動（若先前有 stash）
    if (stashedBeforeMerge) {
      try {
        execSync('git stash pop', { cwd: projectRoot, stdio: 'pipe' });
        console.log('  restored stashed dirty changes');
      } catch (e) {
        console.warn('[warn] stash pop 衝突。手動 git stash pop 並解決。');
      }
    }

    console.log(`\n[ok] merged → ${mainBranch}`);
    console.log(`     archive: .guardian/archive/tasks/${archiveName}`);

    // PROJECT.md 軟提醒（依 AGENTS.md §10 Direction Alignment）
    const projectMdPath = path.join(projectRoot, 'PROJECT.md');
    if (fs.existsSync(projectMdPath)) {
      console.log(`\n[reminder] PROJECT.md 存在 — 本次任務是否改變了方向 / 非目標 / 技術選型 / 階段？`);
      console.log(`           若是 → 建議 user 更新 PROJECT.md。若否 → 跳過。`);
    }

  } catch (err) {
    // 若 merge/checkout 失敗，嘗試還原 stash 避免用戶的改動卡在 stash 裡
    if (stashedBeforeMerge) {
      try {
        execSync('git stash pop', { cwd: projectRoot, stdio: 'pipe' });
        console.warn('  restored stash (after flow failure)');
      } catch (e) { /* stash pop 失敗，讓用戶手動處理 */ }
    }
    console.error(`\n[err] finish 失敗於合併或清理階段：`);
    console.error('      ' + err.message);
    console.error(`  fix: 手動處理 git 衝突或確認 git 狀態，再重試 ai-guardian finish`);
    process.exit(1);
  }
}

module.exports = { runFinish };
