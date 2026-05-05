const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const crypto = require('crypto');
const { diffAgainstBaseline, getNewLinesPerFile } = require('./utils/gitBaseline');

// fallback 全量掃描時用的最小硬編忽略集——只擋技術產物，不再讀 ai-guardian.json::ignoreDirs。
// 差異掃描走 git diff，本來就尊重 .gitignore，不會掃這些路徑。
const FALLBACK_IGNORE = new Set([
  'node_modules', '.git', '.guardian', 'dist', 'build',
  '.idea', '.vscode', '__pycache__', 'coverage', 'out',
]);

// AST 雷同偵測的最小函式行數門檻：低於此值的小函式不參與指紋比對
const MIN_FUNCTION_LINES_FOR_FINGERPRINT = 3;

async function runGuard(projectRoot) {
  const errors = [];
  
  // 🔥 [紅隊防護機制]：如果是 Git 解衝突狀態，發動合法退讓
  const mergeHeadPath = path.join(projectRoot, '.git', 'MERGE_HEAD');
  const rebaseHeadPath = path.join(projectRoot, '.git', 'rebase-merge');
  if (fs.existsSync(mergeHeadPath) || fs.existsSync(rebaseHeadPath)) {
    console.log('🛡️ [AI Guardian] 偵測到 Git 處於合併/衝突處理狀態。守衛系統合法退讓。');
    return { success: true, errors: [] };
  }

  // ⚖️ [法庭封鎖線]：檢查是否有未完成的對峙法庭
  const debateStatePath = path.join(projectRoot, '.guardian', 'debate.json');
  if (fs.existsSync(debateStatePath)) {
    try {
      const debateState = JSON.parse(fs.readFileSync(debateStatePath, 'utf-8'));
      if (debateState.status && debateState.status !== 'APPROVED') {
        errors.push(`[法庭鎖死] 當前有未結案的對峙法庭 (狀態: ${debateState.status})！\n請完成法庭程序後執行 'npx ai-guardian debate approve' 再提交。`);
        return { success: false, errors };
      }
    } catch(e) {}
  }

  // 🚨 [急診通道]：若是 Hotfix 模式，啟動合法繞過與查核軌跡
  const hotfixPath = path.join(projectRoot, '.guardian', 'HOTFIX_MODE');
  if (fs.existsSync(hotfixPath)) {
    console.log('🚨 [AI Guardian] 當前為 HOTFIX 急診模式，豁免 AST 審查，強制放行。');
    // 1. Auto-Revoke (用後即焚)：防止狀態遺留導致大門洞開
    fs.unlinkSync(hotfixPath);
    // 2. Audit Trail (恥辱標籤留底)：在專案記錄下繞過行為
    const auditPath = path.join(projectRoot, '.guardian', 'audit.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(auditPath, `[${timestamp}] ⚠️ [GUARDIAN-OVERRIDE] 觸發了 Hotfix 旁路放行。\n`);
    return { success: true, errors: [] };
  }

  // 1. 設定檔讀取——只取 productionDirs，ignoreDirs 已棄用（改由 .gitignore 統一管理）
  const configPath = path.join(projectRoot, 'ai-guardian.json');
  let config = {
    mode: 'standard',
    productionDirs: ['src/production'],
    labDir: 'src/lab',
    archiveDir: 'src/archive',
  };

  if (fs.existsSync(configPath)) {
    try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }; } catch (e) {}
  }

  // 2. fallback 走訪：技術產物路徑硬編排除，不再讀 config.ignoreDirs
  function shouldIgnoreFallback(fullPath) {
    const baseName = path.basename(fullPath);
    return FALLBACK_IGNORE.has(baseName);
  }

  function walkFiles(dir, callback) {
    if (!fs.existsSync(dir)) return;
    let items;
    try { items = fs.readdirSync(dir); } catch (e) { return; }
    for (const name of items) {
      const fullPath = path.join(dir, name);
      if (shouldIgnoreFallback(fullPath)) continue;
      let stat;
      try { stat = fs.statSync(fullPath); } catch (e) { continue; }
      if (stat.isDirectory()) walkFiles(fullPath, callback);
      else callback(fullPath);
    }
  }

  // 3. 決定掃描範圍：優先只掃「本次任務新增或修改」的檔案
  //    若無任務宣言（沒有執行 start），則退化為全量掃描並給出提示
  const manifestPath = path.join(projectRoot, '.guardian', 'current-task.json');
  let scanTargetSet = null; // null 代表全量掃描
  let newLinesPerFile = null; // null 代表全行視為新（fallback / 舊格式時不能精準歸屬）

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      if (!manifest.baselineCommit) {
        console.log('⚠️  [AI Guardian] 任務宣言為舊版 fileSnapshot 格式，無法以 git diff 比對，退化為全量掃描。');
      } else {
        const diff = diffAgainstBaseline(projectRoot, manifest.baselineCommit);
        const changedRels = [
          ...diff.added,
          ...diff.modified,
          ...diff.typeChanged,
          ...diff.renamed.map(r => r.to),
        ];
        const changedFiles = new Set(changedRels.map(rel => path.join(projectRoot, rel)));
        scanTargetSet = changedFiles;

        if (changedFiles.size === 0) {
          console.log('ℹ️  [AI Guardian] 未偵測到任務啟動後有任何檔案變更，跳過 AST 掃描。');
          return { success: true, errors: [] };
        }
        console.log(`🔍 [AI Guardian] 差異掃描模式：本次任務共變更 ${changedFiles.size} 個檔案。`);

        // 拿到「新增的行號集合」用於 magic number / magic string 的 line-level attribution
        try {
          newLinesPerFile = getNewLinesPerFile(projectRoot, manifest.baselineCommit);
        } catch (e) {
          console.warn(`⚠️  newLines diff 失敗，會把 pre-existing 違規一起報出（保守保護）：${e.message}`);
        }
      }
    } catch (e) {
      console.log(`⚠️  [AI Guardian] 無法讀取任務宣言或 git diff 失敗（${e.message}），退化為全量掃描。`);
    }
  } else {
    console.log('⚠️  [AI Guardian] 未偵測到任務宣言（current-task.json），執行全量掃描。建議先執行 ai-guardian start。');
  }

  const CODE_EXTS = ['.js', '.jsx', '.ts', '.tsx'];
  const prodFiles = [];
  config.productionDirs.forEach(dir => walkFiles(path.join(projectRoot, dir), (fp) => {
    if (!CODE_EXTS.includes(path.extname(fp))) return;
    // 若有差異清單，只加入有差異的檔案
    if (scanTargetSet === null || scanTargetSet.has(fp)) {
      prodFiles.push(fp);
    }
  }));

  // --- 重大方案：自研「AST 去骨雷同偵測」 (Logic Fingerprinting) ---
  const fingerprintMap = new Map(); // hash -> [ relFiles ]

  for (const filePath of prodFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(projectRoot, filePath);
    
    try {
      const ast = parser.parse(content, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      
      // 我們針對每個「函數宣告與函數運算式」提取其內部指紋
      traverse(ast, {
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(nodePath) {
          // 只偵測「有一定規模」的函數 (例如超過 5 行或 15 個節點)
          if (nodePath.node.loc.end.line - nodePath.node.loc.start.line < MIN_FUNCTION_LINES_FOR_FINGERPRINT) return;

          // 使用「去骨」策略：將所有 Identifiers (變數名) 替換為統一標記
          // 這樣不管你叫 order 還是 invoice，去骨後都叫 _ID_
          const clonedNode = JSON.parse(JSON.stringify(nodePath.node)); 
          const subAst = { type: 'File', program: { type: 'Program', body: [clonedNode], sourceType: 'module' } };
          
          traverse(subAst, {
            // 🔥 [紅隊防護機制]：拔除毫無邏輯意義的雜訊 (Junk Code)，專注於計算結構 MD5 
            DebuggerStatement(p) { p.remove(); },
            EmptyStatement(p) { p.remove(); },
            CallExpression(p) {
              if (p.node.callee.type === 'MemberExpression' && 
                  p.node.callee.object.type === 'Identifier' && 
                  (p.node.callee.object.name === 'console' || p.node.callee.object.name === '_ID_')) {
                if (p.parentPath.type === 'ExpressionStatement') p.parentPath.remove();
              }
            },
            Identifier(p) { p.node.name = '_ID_'; },
            StringLiteral(p) { p.node.value = '_STR_'; },
            NumericLiteral(p) {
               // 豁免基準值，其餘去骨
               if (![0, 1, -1, 100].includes(p.node.value)) p.node.value = 0;
            }
          }, nodePath.scope);

          // 重新生成代碼並計算 MD5
          const { code: normalizedCode } = generate(clonedNode, { comments: false, minified: true });
          const hash = crypto.createHash('md5').update(normalizedCode).digest('hex');

          if (!fingerprintMap.has(hash)) fingerprintMap.set(hash, []);
          fingerprintMap.get(hash).push(relPath);
        }
      });
    } catch (e) {}
  }

  // 報告雷同
  for (const [hash, files] of fingerprintMap) {
    if (files.length > 1) {
      // 去重，因同個檔案可能有多個同樣結構的函數
      const uniqueFiles = [...new Set(files)];
      if (uniqueFiles.length > 1) {
          errors.push(`❌ [絕對雷同] 偵測到邏輯結構 100% 重疊！
            -> 位置：${uniqueFiles.join(' 與 ')}
            💡 這是典型的「換湯不換藥」：你修改了命名但邏輯結構完全一致。請重構至共通模組。`);
      }
    }
  }

  // --- AST 原有守衛 (Magic Number + Magic String) ---
  for (const filePath of prodFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(projectRoot, filePath);
    // git diff 用 POSIX 路徑分隔；Windows 上 path.relative 可能回 backslash，做 forward-slash 對齊
    const relPathPosix = relPath.replace(/\\/g, '/');
    const fileNewLines = newLinesPerFile ? newLinesPerFile.get(relPathPosix) : null;
    // 行級別歸屬：只有「本次新引入」的違規才報，避免 pre-existing 連坐
    // null = fallback（無 baseline 或拿不到 diff）→ 全行視為新（保守，仍會誤報但比放水安全）
    const isLineNew = (line) => {
      if (newLinesPerFile === null) return true;
      if (!fileNewLines) return false;
      return fileNewLines.has(line);
    };

    try {
      const ast = parser.parse(content, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      traverse(ast, {
        NumericLiteral(nodePath) {
          const value = nodePath.node.value;
          if (![0, 1, -1, 100, 0.05].includes(value)) { // 加入稅率測試豁免
            const parent = nodePath.parent;
            if (parent.type !== 'VariableDeclarator' && parent.type !== 'ObjectProperty') {
              if (!isLineNew(nodePath.node.loc.start.line)) return; // pre-existing → 跳過
              errors.push(`⚠️ [Magic Number 硬編碼] "${relPath}" 第 ${nodePath.node.loc.start.line} 行發現死寫數字: ${value}。`);
            }
          }
        },

        StringLiteral(nodePath) {
          const value = nodePath.node.value;
          const parent = nodePath.parent;
          const grandParent = nodePath.parentPath && nodePath.parentPath.parent;

          // ── 白名單豁免（這些場景的字串是合法的）──
          // 1. ObjectProperty 的 key（如 { 'Content-Type': '...' }）
          if (parent.type === 'ObjectProperty' && parent.key === nodePath.node) return;
          // 2. import/require 路徑
          if (parent.type === 'ImportDeclaration') return;
          if (parent.type === 'CallExpression' && parent.callee && parent.callee.name === 'require') return;
          // 3. JSX attribute 字串（如 className="btn"）
          if (parent.type === 'JSXAttribute') return;
          // 4. VariableDeclarator 直接賦值（const STATUS = 'active' → 這是在定義常數，合法）
          if (parent.type === 'VariableDeclarator') return;
          // 5. console.log / console.error 等日誌輸出
          if (grandParent && grandParent.type === 'CallExpression' &&
              grandParent.callee && grandParent.callee.type === 'MemberExpression' &&
              grandParent.callee.object && grandParent.callee.object.name === 'console') return;

          // ── 憑證硬編偵測（語境感知，精準攔截）──
          // 偵測 if (pw === "XXX") / if (password !== "XXX") 這類 auth 變數比對
          // 只看「比對運算（=== / !== / == / !=）中對面是 auth 命名變數」，誤報率極低
          const AUTH_VAR_PATTERN = /^(pw|password|passwd|secret|token|api_?key|auth|credential|pin|otp|passphrase)$/i;
          if (
            parent.type === 'BinaryExpression' &&
            ['===', '!==', '==', '!='].includes(parent.operator)
          ) {
            const otherSide = parent.left === nodePath.node ? parent.right : parent.left;
            if (otherSide.type === 'Identifier' && AUTH_VAR_PATTERN.test(otherSide.name)) {
              errors.push(
                `❌ [硬編憑證] "${relPath}" 第 ${nodePath.node.loc.start.line} 行：` +
                `偵測到密碼/Token 字串寫死在比對運算中（"${value}"）。` +
                `\n   憑證絕對不能硬編在程式碼裡，應從環境變數或後端驗證介面取得。` +
                `\n   即使在 client-side「集中管理」也毫無意義，任何人開 DevTools 都能看到。`
              );
              return; // 已報 error，不繼續跑 Magic String 模式
            }
          }

          // ── 高風險 Magic String 模式偵測 ──
          const MAGIC_STRING_PATTERNS = [
            // 角色/權限硬編
            { pattern: /^(admin|superuser|root|guest|anonymous)$/i, label: '硬編角色字串' },
            // API 路徑硬編（含版本號）
            { pattern: /^\/api\//, label: '硬編 API 路徑' },
            // 環境字串硬編
            { pattern: /^(production|staging|development|dev|prod)$/i, label: '硬編環境字串' },
            // 版本號字串比對
            { pattern: /^v\d+(\.\d+)*$/, label: '硬編版本字串' },
            // legacy/new/old 語意的 flag 字串
            { pattern: /^(legacy|new_|old_|v\d+_)/i, label: '硬編新舊兼容識別字串' },
          ];

          for (const { pattern, label } of MAGIC_STRING_PATTERNS) {
            if (pattern.test(value)) {
              if (!isLineNew(nodePath.node.loc.start.line)) break; // pre-existing → 跳過（憑證硬編不適用此豁免，已在上方先報過）
              errors.push(`⚠️ [Magic String 硬編碼] "${relPath}" 第 ${nodePath.node.loc.start.line} 行發現 ${label}: "${value}"。請改為引用集中管理的常數或設定檔。`);
              break; // 每個節點只報一次
            }
          }
        }
      });
    } catch (e) {}
  }


  return { success: errors.length === 0, errors };
}

module.exports = { runGuard };
