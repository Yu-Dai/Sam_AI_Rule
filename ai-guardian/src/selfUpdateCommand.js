'use strict';

/**
 * selfUpdateCommand — 把當前 source repo 的 src/ + bin/ 同步到全域安裝
 *
 * 場景：開發 ai-guardian 自己時，npm install -g . 在 Windows 常 EBUSY 失敗，
 *      手動 cp 一堆檔案費時又容易漏。本指令自動化這個流程。
 *
 * 限制：
 *   - 必須在 ai-guardian source repo 根目錄執行（package.json::name === 'ai-guardian'）
 *   - 全域必須先裝過一次（npm install -g . 至少一次）
 *   - v1 只同步、不刪除全域 orphan（要全清請手動 npm uninstall -g + install -g）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SYNC_DIRS = ['src', 'bin'];
const SYNC_EXTS = new Set(['.js']);
const RETRY_DELAY_MS = 200;

function isAiGuardianRepo(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.name === 'ai-guardian';
  } catch {
    return false;
  }
}

function findGlobalInstallPath() {
  let globalRoot;
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`無法執行 npm root -g：${e.message}`);
  }
  return path.join(globalRoot, 'ai-guardian');
}

function* walkJsFiles(absDir, relDir) {
  if (!fs.existsSync(absDir)) return;
  for (const name of fs.readdirSync(absDir)) {
    const absPath = path.join(absDir, name);
    const relPath = path.posix.join(relDir, name);
    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    if (stat.isDirectory()) {
      yield* walkJsFiles(absPath, relPath);
    } else if (SYNC_EXTS.has(path.extname(name))) {
      yield { absPath, relPath };
    }
  }
}

function copyWithRetry(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.copyFileSync(src, dst);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      // Windows file lock — sync sleep 一下再試一次
      const start = Date.now();
      while (Date.now() - start < RETRY_DELAY_MS) { /* busy wait */ }
      fs.copyFileSync(src, dst);
    } else {
      throw e;
    }
  }
}

function runSelfUpdate(cwd) {
  if (!isAiGuardianRepo(cwd)) {
    console.error('❌ 必須在 ai-guardian source repo 根目錄執行。');
    console.error(`   當前：${cwd}`);
    console.error('   檢查：該目錄需有 package.json 且 name 為 "ai-guardian"。');
    process.exit(1);
  }

  let globalAiGuardian;
  try {
    globalAiGuardian = findGlobalInstallPath();
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  if (!fs.existsSync(globalAiGuardian)) {
    console.error('❌ 全域尚未安裝 ai-guardian。');
    console.error('   首次安裝請用：cd ' + cwd + ' && npm install -g .');
    process.exit(1);
  }

  let synced = 0;
  let failed = 0;
  const failures = [];

  for (const dir of SYNC_DIRS) {
    const localDir = path.join(cwd, dir);
    for (const { absPath, relPath } of walkJsFiles(localDir, dir)) {
      const dstPath = path.join(globalAiGuardian, relPath);
      try {
        copyWithRetry(absPath, dstPath);
        synced++;
      } catch (e) {
        failed++;
        failures.push({ relPath, err: e.message });
      }
    }
  }

  console.log(`✅ 已同步 ${synced} 個檔案到全域：${globalAiGuardian}`);
  if (failed > 0) {
    console.error(`❌ ${failed} 個檔案同步失敗：`);
    failures.forEach(({ relPath, err }) => console.error(`   ${relPath}: ${err}`));
    process.exit(1);
  }
  console.log('   提示：v1 不刪除全域 orphan。若要徹底清乾淨，請：');
  console.log('         npm uninstall -g ai-guardian && cd ' + cwd + ' && npm install -g .');
}

module.exports = { runSelfUpdate };
