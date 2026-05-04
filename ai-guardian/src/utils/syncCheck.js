/**
 * syncCheck
 *
 * 偵測本地主幹是否落後遠端主幹。落後時：
 *   - 互動模式：prompt user 決定
 *   - 非互動模式：要求 --force-stale，否則 fail
 *
 * 設計：
 *   fail-open：sync-check 自身出錯（fetch 卡住、parse 失敗、未知例外）一律 warn 後放行，
 *   不擋住主流程。這套機制是輔助，不是 git 本身。
 *
 *   strict 模式（finish 用）：偵測到 stale 不提供「記決策繼續」選項，要嘛先 pull、
 *   要嘛 --force-stale 一次性繞過。語意：finish 是臨門一腳，多次「忽略」沒意義。
 *
 *   非 strict 模式（start 用）：可以「記決策繼續」，下次同 SHA 不再問。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');
const decisions = require('./syncDecisionStore');

const FETCH_TIMEOUT_MS = 10000;
const DEFAULT_REMOTE = 'origin';

const STATUS = Object.freeze({
  OK: 'ok',
  ABORTED: 'aborted',
  SKIPPED: 'skipped'
});

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function loadRemoteConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'ai-guardian.json');
  if (!fs.existsSync(configPath)) return { name: DEFAULT_REMOTE, branch: null };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const r = raw && raw.remote ? raw.remote : {};
    return {
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : DEFAULT_REMOTE,
      branch: typeof r.branch === 'string' && r.branch.trim() ? r.branch.trim() : null
    };
  } catch (e) {
    return { name: DEFAULT_REMOTE, branch: null };
  }
}

function refExists(projectRoot, ref) {
  try {
    execSync(`git rev-parse --verify --quiet "${ref}^{commit}"`, {
      cwd: projectRoot,
      stdio: 'ignore'
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 偵測主幹分支名：
 *   1. 設定指定 → 直接用
 *   2. 否則 origin/main → main
 *   3. 否則 origin/master → master
 *   4. 否則本地 main / master
 *   5. 都沒有 → null（無法偵測，呼叫者跳過）
 */
function detectMainBranch(projectRoot, remoteName, configuredBranch) {
  if (configuredBranch) return configuredBranch;
  if (refExists(projectRoot, `${remoteName}/main`)) return 'main';
  if (refExists(projectRoot, `${remoteName}/master`)) return 'master';
  if (refExists(projectRoot, 'main')) return 'main';
  if (refExists(projectRoot, 'master')) return 'master';
  return null;
}

/**
 * 嘗試 fetch 指定 remote/branch。回傳：
 *   { ok: true }                       成功
 *   { ok: false, reason, detail }      失敗，reason ∈ no-remote | auth | network | timeout | unknown
 */
function fetchRemote(projectRoot, remoteName, branch) {
  const remotesOut = spawnSync('git', ['remote'], { cwd: projectRoot, encoding: 'utf-8' });
  if (remotesOut.status !== 0) {
    return { ok: false, reason: 'unknown', detail: 'git remote 指令失敗' };
  }
  const remotes = remotesOut.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (!remotes.includes(remoteName)) {
    return { ok: false, reason: 'no-remote', detail: `遠端 ${remoteName} 不存在` };
  }

  const result = spawnSync('git', ['fetch', '--quiet', remoteName, branch], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: FETCH_TIMEOUT_MS
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { ok: false, reason: 'timeout', detail: `fetch ${remoteName}/${branch} 超過 ${FETCH_TIMEOUT_MS}ms` };
  }
  if (result.signal === 'SIGTERM') {
    return { ok: false, reason: 'timeout', detail: 'fetch 被 timeout 中斷' };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').toLowerCase();
    if (stderr.includes('authentication') || stderr.includes('permission denied') || stderr.includes('could not read')) {
      return { ok: false, reason: 'auth', detail: result.stderr.trim() };
    }
    if (stderr.includes('could not resolve host') || stderr.includes('network') || stderr.includes('unable to access')) {
      return { ok: false, reason: 'network', detail: result.stderr.trim() };
    }
    return { ok: false, reason: 'unknown', detail: (result.stderr || '').trim() };
  }
  return { ok: true };
}

function getSha(projectRoot, ref) {
  try {
    return execSync(`git rev-parse "${ref}"`, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim();
  } catch (e) {
    return null;
  }
}

/**
 * 比較本地與遠端：
 *   same     兩者相同
 *   behind   local 是 remote 的 ancestor（單純落後，可 fast-forward）
 *   ahead    remote 是 local 的 ancestor（本地領先，無需處理）
 *   diverged 兩條線分歧（既領先又落後）
 */
function compareLocalRemote(projectRoot, localSha, remoteSha) {
  if (!localSha || !remoteSha) return 'unknown';
  if (localSha === remoteSha) return 'same';
  const localIsAncestor = (() => {
    try {
      execSync(`git merge-base --is-ancestor "${localSha}" "${remoteSha}"`, {
        cwd: projectRoot, stdio: 'ignore'
      });
      return true;
    } catch (e) { return false; }
  })();
  const remoteIsAncestor = (() => {
    try {
      execSync(`git merge-base --is-ancestor "${remoteSha}" "${localSha}"`, {
        cwd: projectRoot, stdio: 'ignore'
      });
      return true;
    } catch (e) { return false; }
  })();
  if (localIsAncestor && !remoteIsAncestor) return 'behind';
  if (!localIsAncestor && remoteIsAncestor) return 'ahead';
  return 'diverged';
}

function countCommitsBetween(projectRoot, fromSha, toSha) {
  try {
    const out = execSync(`git rev-list --count "${fromSha}..${toSha}"`, {
      cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function printStaleHeader(remoteName, branch, behindCount, remoteSha) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⚠️  本地 ${branch} 落後 ${remoteName}/${branch} ${behindCount ?? '?'} 個 commit`);
  console.log(`   遠端 HEAD: ${remoteSha.slice(0, 12)}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function printDivergedHeader(remoteName, branch, ahead, behind) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⚠️  本地 ${branch} 與 ${remoteName}/${branch} 分歧（領先 ${ahead ?? '?'}、落後 ${behind ?? '?'}）`);
  console.log('   這比單純落後更嚴重：兩邊各有對方沒有的 commit。');
  console.log('   sync-check 不提供自動繞過，請手動 rebase 或 merge 後重試。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/**
 * 主入口。
 *
 * @param {string} projectRoot
 * @param {object} opts
 * @param {boolean} opts.strict      true=finish 嚴格模式（不提供記決策選項）
 * @param {boolean} opts.forceStale  true=user 已用 --force-stale 旗標明示繞過
 * @param {string}  opts.taskContext 寫入決策記錄的 context（任務描述）
 * @returns {Promise<{status: string}>}
 */
async function checkRemoteSync(projectRoot, opts = {}) {
  const { strict = false, forceStale = false, taskContext = '' } = opts;

  // 包整段 try/catch：fail-open。sync-check 自身有 bug 不該擋住主流程。
  try {
    // 1. 載入設定 + 偵測主幹
    const cfg = loadRemoteConfig(projectRoot);
    const branch = detectMainBranch(projectRoot, cfg.name, cfg.branch);
    if (!branch) {
      console.log(`ℹ️  [sync-check] 找不到主幹分支（${cfg.name}/main 或 ${cfg.name}/master），跳過遠端偵測。`);
      return { status: STATUS.SKIPPED };
    }

    // 2. 自動清理過期決策（在 fetch 前先做，因為清理只看本地）
    decisions.prune(projectRoot);

    // 3. fetch 遠端
    const fetchRes = fetchRemote(projectRoot, cfg.name, branch);
    if (!fetchRes.ok) {
      switch (fetchRes.reason) {
        case 'no-remote':
          console.log(`ℹ️  [sync-check] 遠端 ${cfg.name} 不存在，跳過。`);
          return { status: STATUS.SKIPPED };
        case 'network':
          console.log(`ℹ️  [sync-check] 離線或無法連線遠端，跳過。`);
          return { status: STATUS.SKIPPED };
        case 'timeout':
          console.log(`⚠️  [sync-check] fetch ${cfg.name}/${branch} 逾時（${FETCH_TIMEOUT_MS}ms），跳過。`);
          return { status: STATUS.SKIPPED };
        case 'auth':
          console.log(`⚠️  [sync-check] 認證失敗（${fetchRes.detail}），請檢查 git 憑證設定。本次跳過。`);
          return { status: STATUS.SKIPPED };
        default:
          console.log(`⚠️  [sync-check] fetch 失敗：${fetchRes.detail || '未知原因'}。本次跳過。`);
          return { status: STATUS.SKIPPED };
      }
    }

    // 4. 拿 SHA 並比較
    const remoteRef = `${cfg.name}/${branch}`;
    const localSha = getSha(projectRoot, branch);
    const remoteSha = getSha(projectRoot, remoteRef);
    if (!localSha || !remoteSha) {
      console.log(`ℹ️  [sync-check] 無法取得 ${branch} 或 ${remoteRef} 的 SHA，跳過。`);
      return { status: STATUS.SKIPPED };
    }

    const cmp = compareLocalRemote(projectRoot, localSha, remoteSha);
    if (cmp === 'same' || cmp === 'ahead') return { status: STATUS.OK };
    if (cmp === 'unknown') {
      console.log(`⚠️  [sync-check] 無法判定本地與遠端關係，跳過。`);
      return { status: STATUS.SKIPPED };
    }

    // 5. diverged：不提供繞過，要求人工解決
    if (cmp === 'diverged') {
      const ahead = countCommitsBetween(projectRoot, remoteSha, localSha);
      const behind = countCommitsBetween(projectRoot, localSha, remoteSha);
      printDivergedHeader(cfg.name, branch, ahead, behind);
      console.log(`💡 建議：git checkout ${branch} && git pull --rebase ${cfg.name} ${branch}，解決衝突後重試。`);
      return { status: STATUS.ABORTED };
    }

    // 6. behind：核心邏輯
    const behind = countCommitsBetween(projectRoot, localSha, remoteSha);

    // 6a. --force-stale：明示繞過
    if (forceStale) {
      printStaleHeader(cfg.name, branch, behind, remoteSha);
      console.log('🟡 [--force-stale] 已明示繞過 sync-check，繼續流程。');
      // 非 strict（start）：寫入決策避免後續同 SHA 重複擋
      // strict（finish）：一次性，不寫決策
      if (!strict) {
        decisions.recordDecision(projectRoot, remoteSha, taskContext);
        console.log(`   已記錄決策：未來偵測到同一遠端 HEAD（${remoteSha.slice(0, 12)}）將自動沿用此決策。`);
      }
      return { status: STATUS.OK };
    }

    // 6b. 非 strict 模式且已有決策：自動沿用
    if (!strict && decisions.hasDecision(projectRoot, remoteSha)) {
      console.log(`ℹ️  [sync-check] 本地 ${branch} 落後 ${cfg.name}/${branch} ${behind ?? '?'} 個 commit，但已有歷史決策不拉，沿用。`);
      return { status: STATUS.OK };
    }

    // 6c. 互動模式：prompt
    if (isInteractive()) {
      printStaleHeader(cfg.name, branch, behind, remoteSha);
      if (strict) {
        console.log('finish 階段不允許帶著 stale base 合併。請選擇：');
        console.log(`  [P] 取消 finish，先跑 git pull --rebase ${cfg.name} ${branch} 再重試（建議）`);
        console.log(`  [c] 取消 finish，我自己處理`);
        console.log(`  （若你有意識要繞過，請改用：ai-guardian finish --force-stale）`);
        const ans = (await prompt('您的選擇 [P/c]: ')).trim().toLowerCase();
        if (ans === '' || ans === 'p') {
          console.log(`\n💡 請執行：git checkout ${branch} && git pull --rebase ${cfg.name} ${branch}，然後重新跑 ai-guardian finish。`);
        } else {
          console.log('\n已取消 finish。');
        }
        return { status: STATUS.ABORTED };
      } else {
        console.log('start 前發現主幹有新進度，請選擇：');
        console.log(`  [P] 取消 start，先跑 git pull --rebase ${cfg.name} ${branch} 再重試（建議）`);
        console.log(`  [n] 知情下用 stale base 繼續（記錄決策，下次同版本不再問）`);
        console.log(`  [c] 取消 start`);
        const ans = (await prompt('您的選擇 [P/n/c]: ')).trim().toLowerCase();
        if (ans === 'n') {
          decisions.recordDecision(projectRoot, remoteSha, taskContext);
          console.log(`   已記錄決策（${remoteSha.slice(0, 12)}），繼續開工。`);
          return { status: STATUS.OK };
        }
        if (ans === '' || ans === 'p') {
          console.log(`\n💡 請執行：git checkout ${branch} && git pull --rebase ${cfg.name} ${branch}，然後重新跑 ai-guardian start。`);
        } else {
          console.log('\n已取消 start。');
        }
        return { status: STATUS.ABORTED };
      }
    }

    // 6d. 非互動模式：fail with clear message（讓上層 AI 看到並轉述給 user）
    printStaleHeader(cfg.name, branch, behind, remoteSha);
    console.log('❌ [非互動模式] 偵測到本地主幹落後遠端，無法自動決策。');
    console.log('');
    console.log('解法二選一：');
    console.log(`  (a) 先同步：git checkout ${branch} && git pull --rebase ${cfg.name} ${branch}，然後重跑此指令`);
    console.log(`  (b) 知情繞過：在原指令加 --force-stale 旗標`);
    return { status: STATUS.ABORTED };

  } catch (err) {
    // fail-open：sync-check 自身炸了，loud warn 但放行
    console.log('');
    console.log('⚠️  [sync-check] 同步檢查模組發生例外，已 fail-open 放行。');
    console.log(`   ${err && err.message ? err.message : err}`);
    console.log('   建議檢查網路 / git 設定後重跑。');
    return { status: STATUS.SKIPPED };
  }
}

module.exports = {
  checkRemoteSync,
  STATUS,
  isInteractive,
  // 以下 export 主要供測試或其他模組重用
  loadRemoteConfig,
  detectMainBranch
};
