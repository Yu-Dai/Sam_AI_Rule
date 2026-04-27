const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildFileSnapshot, IGNORE_DIRS } = require('./utils/fileSnapshot');
const { syncGitignoreToConfig } = require('./utils/syncGitignore');

function runReview(projectRoot, force = false) {
  const guardianDir = path.join(projectRoot, '.guardian');
  const manifestPath = path.join(guardianDir, 'current-task.json');

  // 1. 確認任務宣言存在
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ 找不到任務宣言！');
    console.error('   請先執行 ai-guardian start "<任務描述>" 再開始工作。');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`\n📋 AI Guardian 改動審查報告`);
  console.log(`================================`);
  console.log(`任務：${manifest.taskDescription}`);
  console.log(`分支：${manifest.branch}`);
  console.log(`開始：${manifest.startedAt}`);
  console.log(`================================\n`);

  // 讀取使用者自訂的 ignoreDirs，並自動同步 .gitignore 中的新增條目
  // （確保 AI 改 .gitignore 後，guardian 掃描也跟著忽略對應路徑）
  const userIgnoreDirs = syncGitignoreToConfig(projectRoot);
  const allIgnoreDirs = [...new Set([...IGNORE_DIRS, ...userIgnoreDirs])];

  // 判斷某個相對路徑是否應被忽略（支援純名稱與路徑前綴兩種格式）
  function shouldSkipRelPath(relPath) {
    const normalizedRel = relPath.replace(/\\/g, '/');
    const parts = normalizedRel.split('/');
    return allIgnoreDirs.some(ignore => {
      const normalized = ignore.replace(/\\/g, '/').replace(/\/$/, '');
      if (!normalized.includes('/')) {
        // 純名稱：只要路徑中任一層段吻合就忽略
        return parts.includes(normalized);
      } else {
        // 相對路徑前綴比對
        return normalizedRel === normalized || normalizedRel.startsWith(normalized + '/');
      }
    });
  }

  const warnings = [];
  const errors = [];
  const infos = [];

  // 2. 確認目前在正確的 branch 上
  let currentBranch = '';
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    try {
      currentBranch = execSync('git branch --show-current', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    } catch (e2) {
      currentBranch = '';
    }
  }

  if (!currentBranch || currentBranch === 'HEAD') {
    warnings.push('⚠️  無法確認目前分支（可能是尚無任何 commit 的全新 repo），假設已在正確 Branch 上，繼續審查...');
  } else if (currentBranch !== manifest.branch) {
    errors.push('[Branch 錯誤] 目前在 "' + currentBranch + '"，但任務應在 "' + manifest.branch + '" 執行！');
  } else {
    infos.push('✅ 分支正確: ' + currentBranch);
  }

  // 3. 比對檔案快照，列出改動清單
  //    buildFileSnapshot 現在同時接受 userIgnoreDirs，確保快照也尊重使用者設定
  const oldSnapshot = manifest.fileSnapshot || {};
  const newSnapshot = buildFileSnapshot(projectRoot, userIgnoreDirs);

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [relPath, hash] of Object.entries(newSnapshot)) {
    if (shouldSkipRelPath(relPath)) continue; // 雙重保險：snapshot 已過濾，但防止 config 更新後的邊界情況
    if (!oldSnapshot[relPath]) {
      added.push(relPath);
    } else if (oldSnapshot[relPath] !== hash) {
      modified.push(relPath);
    }
  }

  for (const relPath of Object.keys(oldSnapshot)) {
    if (shouldSkipRelPath(relPath)) continue;
    if (!newSnapshot[relPath]) {
      deleted.push(relPath);
    }
  }

  if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
    warnings.push(`⚠️ 未偵測到任何改動，你確定完成任務了嗎？`);
  }

  if (added.length > 0) {
    infos.push(`\n📄 新增檔案 (${added.length}):`);
    added.forEach(f => infos.push(`   + ${f}`));
  }
  if (modified.length > 0) {
    infos.push(`\n📝 修改檔案 (${modified.length}):`);
    modified.forEach(f => infos.push(`   ~ ${f}`));
  }
  if (deleted.length > 0) {
    infos.push(`\n🗑️  刪除檔案 (${deleted.length}):`);
    deleted.forEach(f => infos.push(`   - ${f}`));
  }

  // 4. 流程合理性回饋：分析本次實際改動的檔案類型，告訴 AI 下次是否需要走 guardian 流程
  //    這是「事後學習」閉環的關鍵：即使 AI 這次選錯了流程，review 會糾正認知
  {
    const allChangedPaths = [...added, ...modified, ...deleted];
    const CODE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go',
                                '.dart', '.vue', '.svelte', '.rs', '.kt', '.swift', '.rb', '.php']);
    const DOC_EXTS  = new Set(['.md', '.txt', '.rst', '.mdx']);

    const isRulesFile = f => {
      const norm = f.replace(/\\/g, '/');
      return ['.agents/rules/', '.cursor/rules/', '.claude/rules/', '.roo/rules/',
              '.agents/skills/', '.cursor/skills/', '.claude/skills/', '.roo/skills/']
        .some(prefix => norm.startsWith(prefix));
    };

    const codeFiles  = allChangedPaths.filter(f => CODE_EXTS.has(path.extname(f)));
    const docFiles   = allChangedPaths.filter(f => DOC_EXTS.has(path.extname(f)));
    const rulesFiles = allChangedPaths.filter(f => isRulesFile(f));
    const otherFiles = allChangedPaths.filter(f =>
      !CODE_EXTS.has(path.extname(f)) && !DOC_EXTS.has(path.extname(f)) && !isRulesFile(f)
    );

    if (allChangedPaths.length > 0) {
      if (codeFiles.length === 0 && rulesFiles.length > 0 && docFiles.length === 0 && otherFiles.length === 0) {
        infos.push('\nℹ️  [流程提示] 本次只修改了 AI rules 設定檔。');
        infos.push('   這類任務下次不需要走 guardian 流程，可直接修改 rules 檔案。');
      } else if (codeFiles.length === 0 && docFiles.length > 0 && rulesFiles.length === 0 && otherFiles.length === 0) {
        infos.push('\nℹ️  [流程提示] 本次只修改了文件檔案（.md / .txt）。');
        infos.push('   這類任務下次不需要走 guardian 流程，可直接修改。');
      } else if (codeFiles.length === 0 && (docFiles.length > 0 || rulesFiles.length > 0)) {
        infos.push('\nℹ️  [流程提示] 本次沒有修改任何程式碼，只改了文件或 rules 設定。');
        infos.push('   這類任務下次不需要走 guardian 流程。');
      } else if (codeFiles.length > 0) {
        infos.push(`\n✅ [流程確認] 本次修改了 ${codeFiles.length} 個程式碼檔案，guardian 流程正確。`);
      }
    }
  }

  // 5. 掃描修改/新增的程式碼是否有可疑模式
  const allChanged = [...added, ...modified];
  const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.dart', '.vue', '.svelte'];

  for (const relPath of allChanged) {
    // 使用統一的路徑過濾函數（支援路徑前綴，不再只比對名稱段）
    if (shouldSkipRelPath(relPath)) continue;

    const ext = path.extname(relPath);
    if (!codeExts.includes(ext)) continue;

    const fullPath = path.join(projectRoot, relPath);
    let content = '';
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch (e) { continue; }

    // 偵測補丁模式：if 判斷大量疊加
    const patchPatterns = [
      /if\s*\(\s*is[A-Z][a-zA-Z]+\s*\)/g,   // if (isNew) / if (isLegacy)
      /if\s*\(\s*[a-zA-Z]+Mode\s*\)/g,       // if (newMode)
      /\/\/\s*(TODO|HACK|FIXME|TEMP|XXX)/gi, // 危險注釋
      /@temporary_until/g
    ];

    patchPatterns.forEach((pattern, i) => {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        const labels = ['補丁型 if 判斷', '模式切換 if', '危險技術債注釋', '強制過期標籤'];
        warnings.push(`⚠️  [疑似補丁] ${relPath} 發現 ${matches.length} 處 ${labels[i]}：${matches.slice(0, 2).join(', ')}`);
      }
    });

    // 偵測殭屍命名（新增或修改的檔案帶有殭屍命名）
    const fileName = path.basename(relPath, ext).toLowerCase();
    if (/v\d+$/i.test(fileName) || fileName.includes('old') || fileName.includes('backup')) {
      errors.push(`❌ [殭屍命名] "${relPath}" 帶有殭屍特徵！請改用正式命名（如 _Next, _Rewrite）。`);
    }
  }

  // 5. 輸出報告
  infos.forEach(msg => console.log(msg));

  if (warnings.length > 0 || errors.length > 0) {
    console.log('\n--- ⚠️ 審查發現問題 ---');
    warnings.forEach(w => console.log(w));
    errors.forEach(e => console.error(e));
  }

  if (errors.length > 0) {
    console.log('\n❌ 審查失敗：請修復上述嚴重問題後再提交。');
    process.exit(1);
  }

  if (warnings.length > 0) {
    if (!force) {
      console.log('\n⚠️  [防禦網攔截] 審查發現警告項目！為防止 AI 串聯指令自動忽略，本次審查已被阻擋。');
      console.log('🤖 給 AI 的指示：請仔細閱讀上述警告。若你確認這些寫法是合理且必然的 (非退化或補丁)，');
      console.log('請改用 "ai-guardian review --force" 來確認並強制通過本次審查。');
      process.exit(1);
    } else {
      console.log('\n⚠️  審查通過（已使用 --force 忽略警告）：已確認警告項目為刻意設計。');
    }
  } else {
    console.log('\n✅ 自動掃描通過！');
  }

  // 6. 更新宣言：標記審查已通過
  manifest.reviewPassed = true;
  manifest.reviewedAt = new Date().toISOString();
  manifest.changeSummary = { added: added.length, modified: modified.length, deleted: deleted.length };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // 7. AI 自我審計清單
  //    自動工具守語法，這一關守語意。
  //    不設機械硬鎖——但要求 AI 在對話框逐條說出理由，讓 User 看得到、能挑戰。
  const changedFiles = [
    ...added.map(f => `+ ${f}`),
    ...modified.map(f => `~ ${f}`),
    ...deleted.map(f => `- ${f}`)
  ];

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 [AI 自我審計] 執行 git commit 前的語意防線');
  console.log('   自動掃描只能守語法，以下由你對宣言負責。');
  console.log('   請在對話框逐條回答（附理由），User 確認後再 commit。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('本次改動：');
  changedFiles.forEach(f => console.log(`   ${f}`));
  console.log('');
  console.log('□ 溯源修復   所有 Bug Fix 都修在根因，');
  console.log('             沒有在下游用條件判斷掩蓋上游的髒輸入或錯誤狀態？');
  console.log('');
  console.log('□ 無雙軌     新舊邏輯沒有同時存活——');
  console.log('             舊邏輯已被完整替換或刪除，不存在因「兼容」而保留的平行路徑？');
  console.log('');
  console.log('□ 無殭屍     沒有殘留除錯輸出、未使用的引入、');
  console.log('             未完成的標記、或任何「暫時保留」的妥協片段？');
  console.log('');
  console.log('□ 無硬編機密 沒有將任何密碼、金鑰、Token 或機密資訊寫死在程式碼中？');
  console.log('             機密的正確位置是環境變數或後端驗證介面，不是原始碼。');
  console.log('');
  console.log('□ 原則非範例 若本次有修改規則、協議或說明文件，');
  console.log('             寫入的是「普遍原則」，而非從對話或 debug 案例中');
  console.log('             直接複製的特定函式名、變數名或錯誤訊息？');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('確認完畢後，執行 git commit。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

module.exports = { runReview };
