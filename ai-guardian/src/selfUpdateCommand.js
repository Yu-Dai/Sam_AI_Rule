'use strict';

/**
 * selfUpdateCommand — 把當前 source clone 的 src/ + bin/ + templates/ 同步到 canonical install
 *
 * 場景：開發 ai-guardian 自己時，編輯 source clone 後不想跑完整 bootstrap（耗時且
 *      會 npm install）。本指令做輕量增量同步：把 .js + .md 檔案 copy 到 canonical。
 *
 * 路徑解析：透過 `npm root -g` + 'ai-guardian' 找到 global node_modules 內的 ai-guardian。
 *           bootstrap 之後它是 symlink → canonical (~/.ai-guardian or %LOCALAPPDATA%\ai-guardian)，
 *           所以寫進這個路徑等同寫進 canonical。
 *
 * 限制：
 *   - 必須在 ai-guardian source clone 內執行（package.json::name === 'ai-guardian'）
 *   - canonical 必須先裝過一次（執行過 bootstrap.sh / .ps1）
 *   - 不刪除 canonical orphan（要全清請重跑 bootstrap）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 每個目錄各自的副檔名 filter（src/bin 是 .js；templates 是 .md）
const SYNC_DIRS_WITH_EXTS = [
  { dir: 'src', exts: new Set(['.js']) },
  { dir: 'bin', exts: new Set(['.js']) },
  { dir: 'templates', exts: new Set(['.md']) },
];
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

// 走訪 dir 下所有檔案，回傳符合 exts 的（其他副檔名忽略）
function* walkFiles(absDir, relDir, exts) {
  if (!fs.existsSync(absDir)) return;
  for (const name of fs.readdirSync(absDir)) {
    const absPath = path.join(absDir, name);
    const relPath = path.posix.join(relDir, name);
    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    if (stat.isDirectory()) {
      yield* walkFiles(absPath, relPath, exts);
    } else if (exts.has(path.extname(name))) {
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
    console.error('❌ Canonical 尚未安裝 ai-guardian。');
    console.error('   首次安裝請從 Sam_AI_Rule clone 跑 bootstrap：');
    console.error('   cd <Sam_AI_Rule clone> && bash bootstrap.sh   # 或 .\\bootstrap.ps1');
    process.exit(1);
  }

  let synced = 0;
  let failed = 0;
  const failures = [];

  for (const { dir, exts } of SYNC_DIRS_WITH_EXTS) {
    const localDir = path.join(cwd, dir);
    for (const { absPath, relPath } of walkFiles(localDir, dir, exts)) {
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

  console.log(`✅ 已同步 ${synced} 個檔案到 canonical：${globalAiGuardian}`);
  if (failed > 0) {
    console.error(`❌ ${failed} 個檔案同步失敗：`);
    failures.forEach(({ relPath, err }) => console.error(`   ${relPath}: ${err}`));
    process.exit(1);
  }
  console.log('   提示：本指令只增量同步、不刪除 canonical orphan。要徹底重置請重跑 bootstrap。');
}

module.exports = { runSelfUpdate };
