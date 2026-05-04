/**
 * syncDecisionStore
 *
 * 個人對「遠端主幹某版本要不要拉」的決策記錄。
 *
 * 為何不放 ai-guardian.json：
 *   ai-guardian.json 是專案層設定（會 commit）。決策是 per-machine 個人判斷，
 *   Bob 拒絕拉某版不該強加給 Alice。所以分開存在 .guardian/state/ 並 gitignore。
 *
 * 自動失效：每次 start 開頭呼叫 prune()
 *   - 該 SHA 已是當前 HEAD 的 ancestor → 已合進來了，刪
 *   - git rev-parse 該 SHA 失敗（例：force push 後變幽靈）→ 刪
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_DIR_REL = path.join('.guardian', 'state');
const STORE_FILE_REL = path.join(STATE_DIR_REL, 'sync-decisions.json');

function storePath(projectRoot) {
  return path.join(projectRoot, STORE_FILE_REL);
}

function load(projectRoot) {
  const file = storePath(projectRoot);
  if (!fs.existsSync(file)) return { decisions: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!raw || !Array.isArray(raw.decisions)) return { decisions: [] };
    return raw;
  } catch (e) {
    return { decisions: [] };
  }
}

function save(projectRoot, data) {
  const dir = path.join(projectRoot, STATE_DIR_REL);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(projectRoot), JSON.stringify(data, null, 2), 'utf-8');
}

function hasDecision(projectRoot, remoteSha) {
  if (!remoteSha) return false;
  const { decisions } = load(projectRoot);
  return decisions.some(d => d.remoteSha === remoteSha);
}

function recordDecision(projectRoot, remoteSha, context) {
  if (!remoteSha) return;
  const data = load(projectRoot);
  if (data.decisions.some(d => d.remoteSha === remoteSha)) return;
  data.decisions.push({
    remoteSha,
    decidedAt: new Date().toISOString(),
    context: context || ''
  });
  save(projectRoot, data);
}

/**
 * 清掉已過時的決策：
 *   - 該 SHA 已是當前 HEAD 的 ancestor（已 pull 過了）
 *   - 該 SHA 在 repo 裡找不到（force push 後幽靈）
 *
 * 寫成靜默失敗：清不到就保留，不影響主流程。
 */
function prune(projectRoot) {
  const data = load(projectRoot);
  if (data.decisions.length === 0) return 0;

  const kept = [];
  for (const d of data.decisions) {
    let isGhost = false;
    let isAncestor = false;
    try {
      execSync(`git rev-parse --verify --quiet "${d.remoteSha}^{commit}"`, {
        cwd: projectRoot,
        stdio: 'ignore'
      });
    } catch (e) {
      isGhost = true;
    }
    if (!isGhost) {
      try {
        execSync(`git merge-base --is-ancestor "${d.remoteSha}" HEAD`, {
          cwd: projectRoot,
          stdio: 'ignore'
        });
        isAncestor = true;
      } catch (e) {
        isAncestor = false;
      }
    }
    if (!isGhost && !isAncestor) kept.push(d);
  }

  const removed = data.decisions.length - kept.length;
  if (removed > 0) {
    data.decisions = kept;
    save(projectRoot, data);
  }
  return removed;
}

module.exports = {
  load,
  save,
  hasDecision,
  recordDecision,
  prune,
  STORE_FILE_REL
};
