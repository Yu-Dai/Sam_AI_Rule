'use strict';

/**
 * conflictResolver — 處理 AGENTS.md / CLAUDE.md 等 auto-gen 檔的衝突解決
 *
 * 三種檔案狀態：
 *   absent   — 檔不存在
 *   auto-gen — 檔存在且首行 == marker（之前由 ai-guardian 寫的，可安全覆寫）
 *   custom   — 檔存在但首行 != marker（user 客製內容，需互動決策）
 *
 * 三種衝突決策（custom 狀態下適用）：
 *   skip          — 完全不動 user 檔
 *   overwrite     — 把 user 檔備份到 .bak.<timestamp>，然後寫入 template
 *   insert-import — 在 user 檔頂端插一行 import（僅 CLAUDE.md 適用，因 Claude Code 支援 @import 語法）
 */

const fs = require('fs');

// AGENTS.md 與 CLAUDE.md 的首行 marker — 改了就無法回頭辨識舊版 auto-gen 檔
const AGENTS_MD_MARKER = '# AGENTS.md — AI Guardian Project Rules';
const CLAUDE_MD_MARKER = '<!-- ai-guardian:claude-stub -->';

function detectFileState(filePath, marker) {
  if (!fs.existsSync(filePath)) return 'absent';
  const existing = fs.readFileSync(filePath, 'utf-8');
  return existing.startsWith(marker) ? 'auto-gen' : 'custom';
}

// YYYYMMDD-HHMMSS 格式的時間戳（用於 backup 檔名）
function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 寫入檔案，依 decision 處理衝突。
 *
 * @param {string} filePath
 * @param {string} marker         首行識別字串
 * @param {string} content        要寫入的內容（template 渲染後）
 * @param {string} decision       'skip' | 'overwrite' | 'insert-import'（custom 狀態時才生效）
 * @param {object} [options]
 * @param {string} [options.insertLine]  insert-import decision 時要在頂端插的行
 * @returns {object} 結果 { written: bool, action: string, backupPath?: string, reason?: string }
 *   action: 'create' | 'update' | 'overwrite-with-backup' | 'insert-import' | 'skip'
 */
function writeWithDecision(filePath, marker, content, decision, options = {}) {
  const state = detectFileState(filePath, marker);

  if (state === 'absent') {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { written: true, action: 'create' };
  }

  if (state === 'auto-gen') {
    // ai-guardian 之前寫的（首行 marker 相符），直接覆寫
    fs.writeFileSync(filePath, content, 'utf-8');
    return { written: true, action: 'update' };
  }

  // state === 'custom'：依 decision 處理
  switch (decision) {
    case 'overwrite': {
      const backupPath = filePath + '.bak.' + timestamp();
      fs.copyFileSync(filePath, backupPath);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { written: true, action: 'overwrite-with-backup', backupPath };
    }
    case 'insert-import': {
      if (!options.insertLine) {
        return { written: false, action: 'skip', reason: 'no-insert-line' };
      }
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (existing.includes(options.insertLine)) {
        return { written: false, action: 'skip', reason: 'import-already-present' };
      }
      // 在最頂端插入 import + 一個空行，然後接 user 原本內容
      fs.writeFileSync(filePath, options.insertLine + '\n\n' + existing, 'utf-8');
      return { written: true, action: 'insert-import' };
    }
    case 'skip':
    default:
      return { written: false, action: 'skip', reason: 'custom-kept' };
  }
}

module.exports = {
  AGENTS_MD_MARKER,
  CLAUDE_MD_MARKER,
  detectFileState,
  writeWithDecision,
};
