/**
 * syncGitignoreToConfig
 *
 * 目的：讓 .gitignore 與 ai-guardian.json 的 ignoreDirs 保持同步。
 *
 * 問題背景：
 *   AI 想忽略某個目錄時，自然會去改 .gitignore。
 *   但 guardian 的掃描（review / start snapshot / guard AST）
 *   讀的是 ai-guardian.json 的 ignoreDirs，不是 .gitignore。
 *   結果加了 .gitignore 沒效，要改 ignoreDirs 才有用。
 *
 * 解法：
 *   每次 guardian 指令執行前，自動把 .gitignore 裡「有你沒有」的路徑
 *   append 進 ai-guardian.json 的 ignoreDirs，不覆蓋，不重複。
 *
 * 回傳：合併後的 ignoreDirs 陣列（同時已寫回 ai-guardian.json）
 */

'use strict';
const fs   = require('fs');
const path = require('path');

/**
 * 解析 .gitignore，取出可直接當成路徑前綴使用的條目
 * （跳過 glob 萬用字元、否定規則、空行、注釋）
 */
function parseGitignorePaths(gitignoreContent) {
  return gitignoreContent
    .split('\n')
    .map(line => line.trim())
    .filter(line =>
      line &&
      !line.startsWith('#') &&   // 非注釋
      !line.startsWith('!') &&   // 非否定規則
      !line.includes('*') &&     // 非萬用字元
      !line.includes('?')        // 非萬用字元
    )
    .map(line => line.replace(/\/$/, '').replace(/^\//, '')); // 去掉前後斜線
}

/**
 * 主函式：同步 .gitignore → ai-guardian.json ignoreDirs
 *
 * @param {string} projectRoot - 專案根目錄
 * @returns {string[]} 合併後的 ignoreDirs
 */
function syncGitignoreToConfig(projectRoot) {
  const configPath    = path.join(projectRoot, 'ai-guardian.json');
  const gitignorePath = path.join(projectRoot, '.gitignore');

  // 讀取 ai-guardian.json（若不存在則用空設定）
  let config = { ignoreDirs: [] };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) { /* 解析失敗，使用預設 */ }
  }
  if (!Array.isArray(config.ignoreDirs)) config.ignoreDirs = [];

  // 讀取 .gitignore（若不存在則直接回傳現有 ignoreDirs）
  if (!fs.existsSync(gitignorePath)) return config.ignoreDirs;

  let gitignoreContent = '';
  try {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  } catch (e) { return config.ignoreDirs; }

  const gitignorePaths = parseGitignorePaths(gitignoreContent);

  // 找出「.gitignore 有、ignoreDirs 沒有」的條目
  const currentSet  = new Set(config.ignoreDirs);
  const newEntries  = gitignorePaths.filter(p => p && !currentSet.has(p));

  if (newEntries.length === 0) return config.ignoreDirs; // 沒有新東西，直接回傳

  // Append（不覆蓋）並寫回 ai-guardian.json
  config.ignoreDirs = [...config.ignoreDirs, ...newEntries];
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    // 寫入失敗（例如權限問題）→ 只回傳合併結果，不中斷流程
  }

  return config.ignoreDirs;
}

module.exports = { syncGitignoreToConfig };
