const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { diffAgainstBaseline } = require('./utils/gitBaseline');

// 補丁警告中顯示前 N 個 match 樣本
const MATCH_PREVIEW_COUNT = 2;
// JSON.stringify 縮排寬度
const JSON_INDENT = 2;

// 補丁 if 判斷的識別字模式（AST 路徑用）
const PATCH_IDENTIFIER_PATTERNS = [
  { regex: /^is[A-Z][a-zA-Z]+$/, label: '補丁型 if 判斷' },
  { regex: /^[a-zA-Z]+Mode$/,    label: '模式切換 if' },
];

// 補丁註解模式（AST 路徑）
// 規則：marker 必須在 comment 內容「起始位置」（前面只能有空白）才算 tech-debt 標記，
// 才不會誤抓 marker 出現在中段做引用 / 字串示例的合理用法。
// 大小寫敏感（慣例都 ALL CAPS）。
const PATCH_COMMENT_PATTERNS = [
  { regex: /^\s*\b(TODO|HACK|FIXME|TEMP|XXX)\b/, label: '危險技術債注釋' },
  { regex: /@temporary_until/,                   label: '強制過期標籤' },
];

// 非 JS 路徑用的 fallback regex（會錯抓 string/regex literal，best-effort）
// 註解 marker 大小寫敏感（同 AST 路徑），避免誤抓正常英文字
const PATCH_PATTERNS_REGEX = [
  { regex: /if\s*\(\s*is[A-Z][a-zA-Z]+\s*\)/g, label: '補丁型 if 判斷' },
  { regex: /if\s*\(\s*[a-zA-Z]+Mode\s*\)/g,    label: '模式切換 if' },
  { regex: /\/\/\s*\b(TODO|HACK|FIXME|TEMP|XXX)\b/g, label: '危險技術債注釋' },
  { regex: /@temporary_until/g,                label: '強制過期標籤' },
];

const JS_FAMILY_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx']);

/**
 * 用 AST 掃描 JS/TS 補丁模式。回傳 [{label, sample}] 或 null（parse 失敗）。
 * 走 AST 而非 regex 避免誤抓字串 / regex literal 內的程式碼樣文字。
 */
function scanPatchPatternsAst(content) {
  let ast;
  try {
    ast = parser.parse(content, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
  } catch (e) {
    return null;
  }

  const findings = [];

  traverse(ast, {
    IfStatement(nodePath) {
      const test = nodePath.node.test;
      if (test.type !== 'Identifier') return;
      for (const { regex, label } of PATCH_IDENTIFIER_PATTERNS) {
        if (regex.test(test.name)) {
          findings.push({ label, sample: `if (${test.name})` });
          break;
        }
      }
    },
  });

  for (const comment of ast.comments || []) {
    for (const { regex, label } of PATCH_COMMENT_PATTERNS) {
      const match = regex.exec(comment.value);
      if (match) findings.push({ label, sample: match[0] });
    }
  }

  return findings;
}

/**
 * 對非 JS 語言用 regex 掃描（best-effort，會誤抓 literal 內容）。
 */
function scanPatchPatternsRegex(content) {
  const findings = [];
  for (const { regex, label } of PATCH_PATTERNS_REGEX) {
    const matches = content.match(regex);
    if (matches) {
      for (const m of matches) findings.push({ label, sample: m });
    }
  }
  return findings;
}

function scanPatchPatterns(content, ext) {
  if (JS_FAMILY_EXTS.has(ext)) {
    const ast = scanPatchPatternsAst(content);
    if (ast !== null) return ast;
    // AST parse 失敗（罕見、非標準語法）→ 退回 regex
  }
  return scanPatchPatternsRegex(content);
}

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

  // 舊版 manifest（fileSnapshot 格式）阻擋——機制已升級為 git-native diff，雙軌共存會誤判
  if (!manifest.baselineCommit) {
    console.error('❌ [格式升級] 此任務的 manifest 是舊版 fileSnapshot 格式，無法以新版 review 比對。');
    console.error('   請完結這個任務（手動 git commit + git checkout main），或刪除 .guardian/current-task.json 後重新 ai-guardian start。');
    process.exit(1);
  }

  console.log(`\n📋 AI Guardian 改動審查報告`);
  console.log(`================================`);
  console.log(`任務：${manifest.taskDescription}`);
  console.log(`分支：${manifest.branch}`);
  console.log(`開始：${manifest.startedAt}`);
  console.log(`================================\n`);

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

  // 3. 用 git diff 比對 baseline commit 與當下工作區
  //    自動尊重 .gitignore、不限副檔名、認得 rename
  let diff;
  try {
    diff = diffAgainstBaseline(projectRoot, manifest.baselineCommit);
  } catch (e) {
    console.error(`❌ [diff 失敗] 無法跟 baseline (${manifest.baselineCommit}) 比對：${e.message}`);
    console.error('   baseline commit 可能已被 git gc 回收，或當前不在 git repo。');
    process.exit(1);
  }

  const { added, modified, deleted, renamed, typeChanged } = diff;
  const totalChanges = added.length + modified.length + deleted.length + renamed.length + typeChanged.length;

  if (totalChanges === 0) {
    warnings.push(`⚠️ 未偵測到任何改動（git diff 回報 baseline 與當下完全一致）。請確認你的 edit 是否真的寫入磁碟。`);
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
  if (renamed.length > 0) {
    infos.push(`\n🔀 重新命名 (${renamed.length}):`);
    renamed.forEach(r => infos.push(`   ${r.from} → ${r.to}`));
  }
  if (typeChanged.length > 0) {
    infos.push(`\n🔧 類型變更 (${typeChanged.length}):`);
    typeChanged.forEach(f => infos.push(`   * ${f}`));
  }

  // 4. 流程合理性回饋：分析本次實際改動的檔案類型，告訴 AI 下次是否需要走 guardian 流程
  //    這是「事後學習」閉環的關鍵：即使 AI 這次選錯了流程，review 會糾正認知
  {
    const allChangedPaths = [
      ...added, ...modified, ...deleted, ...typeChanged,
      ...renamed.flatMap(r => [r.from, r.to])
    ];
    // 涵蓋常見遊戲 / 嵌入式 / 後端 / 前端 / 設定檔，避免 Godot / Rust / Web 純 .css / 純 package.json
    // 這類任務被誤分類為「非程式碼」
    const CODE_EXTS = new Set([
      '.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.astro',
      '.html', '.css', '.scss', '.less',
      '.py', '.java', '.cs', '.go', '.rs', '.rb', '.php',
      '.kt', '.swift', '.dart',
      '.c', '.cpp', '.cc', '.h', '.hpp', '.m', '.mm',
      '.ex', '.exs', '.clj', '.scala', '.ml', '.fs',
      '.gd', '.gdshader', '.lua', '.shader',
      '.sql',
      '.sh', '.ps1', '.bat',
      '.json', '.yml', '.yaml', '.toml',
    ]);
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
    const ext = path.extname(relPath);
    if (!codeExts.includes(ext)) continue;

    const fullPath = path.join(projectRoot, relPath);
    let content = '';
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch (e) { continue; }

    // 偵測補丁模式：JS/TS 走 AST 避免誤抓字串/regex literal；其他語言保留 regex（best-effort）
    const findings = scanPatchPatterns(content, ext);
    const grouped = {};
    for (const { label, sample } of findings) {
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(sample);
    }
    for (const [label, samples] of Object.entries(grouped)) {
      warnings.push(`⚠️  [疑似補丁] ${relPath} 發現 ${samples.length} 處 ${label}：${samples.slice(0, MATCH_PREVIEW_COUNT).join(', ')}`);
    }

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
  manifest.changeSummary = {
    added: added.length,
    modified: modified.length,
    deleted: deleted.length,
    renamed: renamed.length,
    typeChanged: typeChanged.length,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, JSON_INDENT), 'utf-8');

  // 7. AI 自我審計清單
  //    自動工具守語法，這一關守語意。
  //    不設機械硬鎖——但要求 AI 在對話框逐條說出理由，讓 User 看得到、能挑戰。
  const changedFiles = [
    ...added.map(f => `+ ${f}`),
    ...modified.map(f => `~ ${f}`),
    ...deleted.map(f => `- ${f}`),
    ...renamed.map(r => `R ${r.from} → ${r.to}`),
    ...typeChanged.map(f => `* ${f}`),
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
