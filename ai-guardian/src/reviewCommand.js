const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { diffAgainstBaseline, getNewLinesPerFile } = require('./utils/gitBaseline');

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
 * 判斷一個 Q section body 是否「未填」。
 * 規則：if 沒勾選任何 [x] 且仍有 placeholder `_` → 未填
 * 為什麼這樣判斷：
 * - [x] 勾選代表 user 對這次任務做出了明確選擇（即便沒展開細節，至少已 stance）
 * - 完全沒 [x] 又留著 `_` placeholder = 動工聲明跳過，反映 AI 沒走完 pre-flight
 */
function isQSectionUnfilled(body) {
  // 任何層級的 [x] 勾選 = 已表態
  const hasCheckedBox = /^\s*-\s*\[[xX]\]/m.test(body);
  if (hasCheckedBox) return false;

  // 沒勾選的話，找看看 placeholder `_` 還在不在
  // 涵蓋四種 placeholder 結構（template 中實際出現的形式）：
  //   1. `label：_`（行尾）         — 例：「找到：_」
  //   2. `> _`（quote 行只有 _）    — 例：Q2 入口
  //   3. `- [ ] _`（bullet+checkbox 後接 _） — 例：Q1 預計修改
  //   4. `  - _`（縮排子 bullet 只有 _）     — 例：Q5「請 user 提供：」下的 sub-bullet
  const hasUnfilledPlaceholder =
    /[:：]\s*_\s*$/m.test(body) ||
    /^>\s*_\s*$/m.test(body) ||
    /^\s*-\s*\[\s*\]\s+_\s*$/m.test(body) ||
    /^\s+-\s+_\s*$/m.test(body);

  return hasUnfilledPlaceholder;
}

/**
 * 掃描 .guardian/current-task.md 的 Q1–Q7 是否填寫。回傳警告字串陣列（empty = 全填或檔不存在）。
 * Loose 檢查：只警告，不擋 commit（讓 AI 看到提醒但不 cascade 失敗）。
 */
function checkCurrentTaskFilled(currentTaskMdPath) {
  if (!fs.existsSync(currentTaskMdPath)) return [];
  const content = fs.readFileSync(currentTaskMdPath, 'utf-8');

  // 用 ### Qn. 切片：parts[0] 是序言，後面交替 [title, body, title, body, ...]
  const parts = content.split(/\n### (Q\d+\.[^\n]+)\n/);
  const warnings = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i];
    const body = parts[i + 1] || '';
    if (isQSectionUnfilled(body)) {
      warnings.push(`[unfilled] ${title.trim()}`);
    }
  }
  return warnings;
}

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
      const line = nodePath.node.loc && nodePath.node.loc.start.line;
      for (const { regex, label } of PATCH_IDENTIFIER_PATTERNS) {
        if (regex.test(test.name)) {
          findings.push({ label, sample: `if (${test.name})`, line });
          break;
        }
      }
    },
  });

  for (const comment of ast.comments || []) {
    const line = comment.loc && comment.loc.start.line;
    for (const { regex, label } of PATCH_COMMENT_PATTERNS) {
      const match = regex.exec(comment.value);
      if (match) findings.push({ label, sample: match[0], line });
    }
  }

  return findings;
}

/**
 * 將字串 offset 換算為 1-based 行號（線性掃描，O(offset)）。
 */
function offsetToLine(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * 對非 JS 語言用 regex 掃描（best-effort，會誤抓 literal 內容）。
 * 用 matchAll 取 offset，再換算成行號，讓 line-level attribution 對非 JS 也生效。
 */
function scanPatchPatternsRegex(content) {
  const findings = [];
  for (const { regex, label } of PATCH_PATTERNS_REGEX) {
    for (const match of content.matchAll(regex)) {
      findings.push({
        label,
        sample: match[0],
        line: offsetToLine(content, match.index),
      });
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
    console.error('[err] 找不到任務宣言。先跑 ai-guardian start "<任務描述>"。');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // 舊版 manifest（fileSnapshot 格式）阻擋——機制已升級為 git-native diff，雙軌共存會誤判
  if (!manifest.baselineCommit) {
    console.error('[err] manifest 是舊版 fileSnapshot 格式，新版 review 無法比對。');
    console.error('  fix: 手動 commit + checkout main 完結此任務；或刪 .guardian/current-task.json 後重新 start。');
    process.exit(1);
  }

  console.log(`\n[review] ${manifest.taskDescription}`);
  console.log(`         branch: ${manifest.branch}`);
  console.log(`         since:  ${manifest.startedAt}\n`);

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
    warnings.push('[warn] 無法讀取當前分支（可能是無 commit 的全新 repo），假設位於 task branch，繼續審查');
  } else if (currentBranch !== manifest.branch) {
    errors.push('[Branch 錯誤] 目前在 "' + currentBranch + '"，但任務應在 "' + manifest.branch + '" 執行！');
  } else {
    infos.push('[ok] branch: ' + currentBranch);
  }

  // 3. 用 git diff 比對 baseline commit 與當下工作區
  //    自動尊重 .gitignore、不限副檔名、認得 rename
  let diff;
  try {
    diff = diffAgainstBaseline(projectRoot, manifest.baselineCommit);
  } catch (e) {
    console.error(`[err] diff 失敗，無法跟 baseline (${manifest.baselineCommit}) 比對：${e.message}`);
    console.error('  hint: baseline commit 可能已被 git gc 回收，或當前不在 git repo。');
    process.exit(1);
  }

  // 行級別歸屬：拿到每檔案「新增的行號集合」用於 patch scanner 過濾
  // 失敗時 fallback 為 null（保守全報，與 guardCommand 對齊）
  let newLinesPerFile = null;
  try {
    newLinesPerFile = getNewLinesPerFile(projectRoot, manifest.baselineCommit);
  } catch (e) {
    console.warn(`[warn] newLines diff 失敗，patch scanner 退化為全文掃描：${e.message}`);
  }

  const { added, modified, deleted, renamed, typeChanged } = diff;
  const totalChanges = added.length + modified.length + deleted.length + renamed.length + typeChanged.length;

  if (totalChanges === 0) {
    warnings.push(`[warn] 未偵測到任何改動（baseline 與當下一致）。確認 edit 是否真寫入磁碟。`);
  }

  if (added.length > 0) {
    infos.push(`\nadded (${added.length}):`);
    added.forEach(f => infos.push(`  + ${f}`));
  }
  if (modified.length > 0) {
    infos.push(`\nmodified (${modified.length}):`);
    modified.forEach(f => infos.push(`  ~ ${f}`));
  }
  if (deleted.length > 0) {
    infos.push(`\ndeleted (${deleted.length}):`);
    deleted.forEach(f => infos.push(`  - ${f}`));
  }
  if (renamed.length > 0) {
    infos.push(`\nrenamed (${renamed.length}):`);
    renamed.forEach(r => infos.push(`  ${r.from} → ${r.to}`));
  }
  if (typeChanged.length > 0) {
    infos.push(`\ntype-changed (${typeChanged.length}):`);
    typeChanged.forEach(f => infos.push(`  * ${f}`));
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
        infos.push('\n[hint] 本次只動 AI rules 檔。下次這類任務不需走 guardian。');
      } else if (codeFiles.length === 0 && docFiles.length > 0 && rulesFiles.length === 0 && otherFiles.length === 0) {
        infos.push('\n[hint] 本次只動文件（.md/.txt）。下次這類任務不需走 guardian。');
      } else if (codeFiles.length === 0 && (docFiles.length > 0 || rulesFiles.length > 0)) {
        infos.push('\n[hint] 本次無 code 改動，只動文件或 rules。下次這類任務不需走 guardian。');
      } else if (codeFiles.length > 0) {
        infos.push(`\n[ok] ${codeFiles.length} code files modified — guardian flow correct.`);
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
    // line-level attribution：只報新引入行上的 patch 模式，pre-existing 不報
    const findings = scanPatchPatterns(content, ext);
    const relPathPosix = relPath.replace(/\\/g, '/');
    const fileNewLines = newLinesPerFile ? newLinesPerFile.get(relPathPosix) : null;
    const isLineNew = (line) => {
      if (newLinesPerFile === null) return true; // fallback：保守全報
      if (!fileNewLines) return false;           // 檔案未變更（理論上不會到這）
      return line === undefined ? true : fileNewLines.has(line);
    };

    const grouped = {};
    for (const { label, sample, line } of findings) {
      if (!isLineNew(line)) continue;
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(sample);
    }
    for (const [label, samples] of Object.entries(grouped)) {
      warnings.push(`[patch?] ${relPath}: ${samples.length} 處 ${label}：${samples.slice(0, MATCH_PREVIEW_COUNT).join(', ')}`);
    }

    // 偵測殭屍命名（新增或修改的檔案帶有殭屍命名）
    const fileName = path.basename(relPath, ext).toLowerCase();
    if (/v\d+$/i.test(fileName) || fileName.includes('old') || fileName.includes('backup')) {
      errors.push(`[zombie] ${relPath}: 帶有殭屍命名特徵（v\\d+ / old / backup）。改用正式命名（_Next / _Rewrite）。`);
    }
  }

  // 5. 輸出報告
  infos.forEach(msg => console.log(msg));

  if (warnings.length > 0 || errors.length > 0) {
    console.log('\n[issues]');
    warnings.forEach(w => console.log('  ' + w));
    errors.forEach(e => console.error('  ' + e));
  }

  if (errors.length > 0) {
    console.error('\n[err] review 失敗。修復上述嚴重問題後重試。');
    process.exit(1);
  }

  if (warnings.length > 0) {
    if (!force) {
      console.log('\n[blocked] 有警告項目。AI: 確認非退化或補丁後，用 ai-guardian review --force 強制通過。');
      process.exit(1);
    } else {
      console.log('\n[ok] review 通過（--force 已忽略警告）');
    }
  } else {
    console.log('\n[ok] 自動掃描通過');
  }

  // 5.5 Pre-flight 填寫檢查（warn-only，不擋 commit）
  //     AGENTS.md 哲學原則靠 baseline，動工瞬間裁決靠 current-task.md Q1–Q7。
  //     若 AI 跳過裁決直接動工，這裡至少印警告留個 nudge。
  const currentTaskMdPath = path.join(projectRoot, '.guardian', 'current-task.md');
  const fillWarnings = checkCurrentTaskFilled(currentTaskMdPath);
  if (fillWarnings.length > 0) {
    console.log('\n[pre-flight] 未填的 Q（warn-only，不擋 commit）：');
    fillWarnings.forEach(w => console.log('  ' + w));
    console.log('  AI 自審：這些 Q 真的能跳過嗎？跳過 = 沒做動工前裁決。');
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
  console.log('[self-attest] 自動掃描守語法，以下由 AI 對宣言負責。逐條回答，user 確認後再 commit：');
  console.log('');
  console.log('changes:');
  changedFiles.forEach(f => console.log(`  ${f}`));
  console.log('');
  console.log('  □ root-cause fix    — bug fix 都修在根因，沒在下游條件判斷掩蓋');
  console.log('  □ no dual-track     — 舊邏輯已替換或刪除，無「兼容」平行路徑');
  console.log('  □ no zombie         — 無除錯輸出、無 unused import、無 TODO 「暫時保留」');
  console.log('  □ no hardcoded secret — 密碼 / token / key 不寫死在 source');
  console.log('  □ principles, not examples — 改規則 / 文件時寫普遍原則，不複製特定 case');
  console.log('');
  console.log('回答完 → git commit');
}

module.exports = { runReview };
