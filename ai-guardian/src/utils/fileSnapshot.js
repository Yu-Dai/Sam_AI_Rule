const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = ['node_modules', '.git', '.guardian', 'dist', 'build', '.idea', '.vscode', '__pycache__'];
const CODE_EXTS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.dart', '.vue', '.svelte', '.kt', '.swift'];

/**
 * 判斷某個完整路徑是否應被忽略。
 *
 * 支援兩種格式：
 *  (a) 純名稱   → 如 "node_modules"，任意層級的同名目錄或檔案都忽略
 *  (b) 相對路徑 → 如 "src/agent/test"，只忽略這個特定路徑（含子目錄）
 *
 * @param {string} fullPath     - 目標的完整絕對路徑
 * @param {string} projectRoot  - 專案根目錄
 * @param {string[]} ignoreDirs - 合併後的忽略清單（基礎 + 使用者自訂）
 */
function shouldIgnorePath(fullPath, projectRoot, ignoreDirs) {
  const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
  const baseName = path.basename(fullPath);
  return ignoreDirs.some(ignore => {
    const normalized = ignore.replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized.includes('/')) {
      // (a) 純名稱比對：任意層級
      return baseName === normalized;
    } else {
      // (b) 相對路徑前綴比對
      return relPath === normalized || relPath.startsWith(normalized + '/');
    }
  });
}

/**
 * 掃描專案目錄，產生所有程式碼檔案的快照（相對路徑 → size-mtime 字串）。
 * 用於 start 時記錄基準，以及 review / guard 時比對差異。
 *
 * @param {string}   projectRoot    - 專案根目錄的絕對路徑
 * @param {string[]} extraIgnoreDirs - 來自 ai-guardian.json 的使用者自訂忽略路徑
 * @returns {Record<string, string>} 快照物件
 */
function buildFileSnapshot(projectRoot, extraIgnoreDirs = []) {
  const allIgnore = [...new Set([...IGNORE_DIRS, ...extraIgnoreDirs])];
  const snapshot = {};

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return; }

    for (const name of entries) {
      const fullPath = path.join(dir, name);
      if (shouldIgnorePath(fullPath, projectRoot, allIgnore)) continue;

      let stat;
      try { stat = fs.statSync(fullPath); } catch (e) { continue; }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTS.includes(path.extname(name))) {
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        // 用檔案大小 + 修改時間當簡易指紋（避免大量讀取檔案內容）
        snapshot[relPath] = `${stat.size}-${stat.mtimeMs}`;
      }
    }
  }

  walk(projectRoot);
  return snapshot;
}

module.exports = { buildFileSnapshot, shouldIgnorePath, IGNORE_DIRS, CODE_EXTS };
