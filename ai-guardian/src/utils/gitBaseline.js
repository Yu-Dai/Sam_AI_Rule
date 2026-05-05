'use strict';

/**
 * gitBaseline
 *
 * 用 git plumbing 實作「任務基準」與「基準 → 當下」的差異比對。
 * 取代舊的 size+mtime fileSnapshot，解決：
 *   - 副檔名白名單導致的 silent false-negative
 *   - ai-guardian.json::ignoreDirs 跟 .gitignore 雙軌
 *   - 不認得 rename / binary skip
 *
 * 機制：
 *   1. 用獨立 temp index file（GIT_INDEX_FILE env）跑 git add -A
 *   2. write-tree 凍結當下完整工作區（含 untracked、自動尊重 .gitignore）
 *   3. commit-tree 建立游離 commit（不在任何 branch 上、不污染主 index）
 *   4. diff 用 git diff --name-status -z --find-renames 取改動清單
 *
 * 主 .git/index 全程不會被動到。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// temp index 檔名的隨機後綴位元組數：12 hex chars 足以避免並行 ai-guardian 進程碰撞
const TEMP_SUFFIX_BYTES = 6;

// commit-tree 需要 author / committer 資訊，顯式傳避免依賴 user.name/email 設定
const BASELINE_AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'ai-guardian',
  GIT_AUTHOR_EMAIL: 'ai-guardian@local',
  GIT_COMMITTER_NAME: 'ai-guardian',
  GIT_COMMITTER_EMAIL: 'ai-guardian@local',
};

function git(args, opts = {}) {
  const result = spawnSync('git', args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) {
    const cmd = `git ${args.join(' ')}`;
    const err = (result.stderr || '').trim() || `(no stderr, exit ${result.status})`;
    throw new Error(`${cmd} failed: ${err}`);
  }
  return result.stdout;
}

function makeTempIndexPath() {
  const rand = crypto.randomBytes(TEMP_SUFFIX_BYTES).toString('hex');
  return path.join(os.tmpdir(), `guardian-idx-${process.pid}-${Date.now()}-${rand}`);
}

function withTempIndex(projectRoot, fn) {
  const tmpIndex = makeTempIndexPath();
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    // 從 HEAD 載入起點，確保 temp index 一開始反映 HEAD 的 tracked 檔
    const headSha = git(['rev-parse', 'HEAD'], { cwd: projectRoot }).trim();
    git(['read-tree', headSha], { cwd: projectRoot, env });

    // 把工作區所有改動（含 untracked、刪除）疊上 temp index，自動尊重 .gitignore
    // .guardian/ 已由 .gitignore 排除，不需額外 pathspec
    git(['add', '-A', '--', '.'], { cwd: projectRoot, env });

    return fn({ env, headSha });
  } finally {
    if (fs.existsSync(tmpIndex)) {
      try { fs.unlinkSync(tmpIndex); } catch { /* best effort */ }
    }
  }
}

/**
 * 凍結當下工作區為 baseline commit（游離 commit，不在 branch 上）。
 * @returns {string} baseline commit SHA
 */
function createBaseline(projectRoot, label = 'baseline') {
  return withTempIndex(projectRoot, ({ env, headSha }) => {
    const treeSha = git(['write-tree'], { cwd: projectRoot, env }).trim();
    const message = `ai-guardian:${label}`;
    const commitSha = git(
      ['commit-tree', treeSha, '-p', headSha, '-m', message],
      { cwd: projectRoot, env: { ...env, ...BASELINE_AUTHOR_ENV } }
    ).trim();
    return commitSha;
  });
}

/**
 * 比對 baseline commit 與當下工作區的差異。
 * @param {string} projectRoot
 * @param {string} baselineCommit  createBaseline 回傳的 SHA
 * @returns {{added: string[], modified: string[], deleted: string[], renamed: Array<{from: string, to: string}>, typeChanged: string[]}}
 */
function diffAgainstBaseline(projectRoot, baselineCommit) {
  return withTempIndex(projectRoot, ({ env }) => {
    const currentTree = git(['write-tree'], { cwd: projectRoot, env }).trim();
    const output = git(
      [
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        `${baselineCommit}^{tree}`,
        currentTree,
      ],
      { cwd: projectRoot }
    );
    return parseNameStatusZ(output);
  });
}

/**
 * 解析 git diff --name-status -z 輸出。
 *
 * 格式：
 *   A\0path\0          新增
 *   M\0path\0          修改
 *   D\0path\0          刪除
 *   T\0path\0          type 變更（檔案 ↔ symlink）→ 視為 modified
 *   R<score>\0from\0to\0  rename
 *   C<score>\0from\0to\0  copy → 把 to 視為 added
 */
function parseNameStatusZ(output) {
  const result = { added: [], modified: [], deleted: [], renamed: [], typeChanged: [] };
  if (!output) return result;

  const tokens = output.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    if (!status) continue;
    const code = status[0];
    if (code === 'A') {
      result.added.push(tokens[i++]);
    } else if (code === 'M') {
      result.modified.push(tokens[i++]);
    } else if (code === 'D') {
      result.deleted.push(tokens[i++]);
    } else if (code === 'T') {
      result.typeChanged.push(tokens[i++]);
    } else if (code === 'R') {
      const from = tokens[i++];
      const to = tokens[i++];
      result.renamed.push({ from, to });
    } else if (code === 'C') {
      const _from = tokens[i++];
      const to = tokens[i++];
      result.added.push(to);
    } else {
      // 未知狀態碼：保守略過此筆（status 後通常一個 path）
      i++;
    }
  }
  return result;
}

module.exports = {
  createBaseline,
  diffAgainstBaseline,
};
