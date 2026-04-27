'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────
//  輔助：移除 .gitignore 中的 guardian block
//  只移除 guardian 自己加進去的那一段，不動使用者的其他內容
// ─────────────────────────────────────────────
function removeGuardianGitignoreBlock(gitignorePath) {
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const lines   = content.split('\n');
  const result  = [];
  let inBlock   = false;
  let removed   = false;

  for (const line of lines) {
    // 偵測 guardian block 的開頭注釋
    if (line.trim() === '# AI Guardian \u2013 \u66ab\u5b58\u4efb\u52d9\u72c0\u614b\uff08\u4e0d\u7d0d\u5165\u7248\u672c\u63a7\u5236\uff09') {
      inBlock = true;
      removed = true;
      continue;
    }
    if (inBlock) {
      // 繼續跳過：以 .guardian/ 開頭的條目 或 緊接的空行
      if (line.trim() === '' || line.trim().startsWith('.guardian/')) continue;
      inBlock = false; // 遇到不屬於 guardian block 的行，結束跳過
    }
    result.push(line);
  }

  if (removed) {
    // 清理多餘的連續空行，保持檔案整潔
    const cleaned = result.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
    fs.writeFileSync(gitignorePath, cleaned, 'utf-8');
  }
  return removed;
}

// ─────────────────────────────────────────────
//  主函式
// ─────────────────────────────────────────────
function runUninstall(projectRoot, isFull = false) {
  console.log('\n\ud83e\uddf9 AI Guardian 解除安裝程序啟動...');
  console.log(isFull
    ? '   模式：完整移除（--full）— 移除所有 guardian 設定檔與目錄'
    : '   模式：最小移除（預設）— 只移除 hook 與 .gitignore 規則\n');

  const removedFiles = [];
  const warnings     = [];

  // ── 0. 安全檢查：若在 guardian 任務分支上，先警告 ──
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim();

    if (branch.startsWith('guardian/')) {
      console.warn('⚠️  [警告] 目前在 guardian 任務分支上：' + branch);
      console.warn('   建議先執行以下流程完結任務，再解除安裝：');
      console.warn('   ai-guardian review → git commit → ai-guardian finish');
      console.warn('   繼續解除安裝可能導致任務改動未合併回主線。\n');
    }
  } catch (e) { /* 非 git 環境，跳過 */ }

  // ── 1. 移除 pre-commit hook（只移除 guardian 自己建立的）──
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    try {
      const hookContent = fs.readFileSync(hookPath, 'utf-8');
      if (hookContent.includes('AI Guardian') || hookContent.includes('ai-guardian guard')) {
        fs.unlinkSync(hookPath);
        removedFiles.push('.git/hooks/pre-commit');
        console.log('✅ 移除 Git pre-commit hook');
      } else {
        warnings.push('⚠️  pre-commit hook 並非 guardian 建立，保留不動。');
      }
    } catch (e) {
      warnings.push('⚠️  無法讀取或移除 pre-commit hook：' + e.message);
    }
  } else {
    console.log('ℹ️  未偵測到 pre-commit hook，跳過。');
  }

  // ── 2. 移除 .gitignore 中的 guardian block ──
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const removed = removeGuardianGitignoreBlock(gitignorePath);
      if (removed) {
        removedFiles.push('.gitignore');
        console.log('✅ 移除 .gitignore 中的 guardian 暫存檔案排除規則');
      } else {
        console.log('ℹ️  .gitignore 中未找到 guardian block，跳過。');
      }
    } catch (e) {
      warnings.push('⚠️  .gitignore 處理失敗：' + e.message);
    }
  }

  // ── 3. 完整移除模式（--full）──
  if (isFull) {
    console.log('');

    // 3-a. IDE rules 與 skills（所有可能的位置）
    const IDE_FILES = [
      '.agents/rules/ai_guardian_protocol.md',
      '.agents/skills/adversarial-debate/SKILL.md',
      '.cursor/rules/ai_guardian.mdc',
      '.cursor/skills/adversarial-debate/SKILL.md',
      '.claude/rules/ai_guardian.md',
      '.claude/skills/adversarial-debate/SKILL.md',
      '.roo/rules/ai_guardian.md',
      '.roo/skills/adversarial-debate/SKILL.md',
      '.windsurfrules',
      '.windsurf/skills/adversarial-debate/SKILL.md',
      'AGENTS.md',
    ];
    let ideCount = 0;
    for (const rel of IDE_FILES) {
      const full = path.join(projectRoot, rel);
      if (fs.existsSync(full)) {
        try {
          fs.unlinkSync(full);
          removedFiles.push(rel);
          ideCount++;
        } catch (e) {
          warnings.push(`⚠️  無法移除 ${rel}：${e.message}`);
        }
      }
    }
    if (ideCount > 0) console.log(`✅ 移除 ${ideCount} 個 IDE rules / skills 設定檔`);

    // 3-b. ai-guardian.json
    const configPath = path.join(projectRoot, 'ai-guardian.json');
    if (fs.existsSync(configPath)) {
      try {
        fs.unlinkSync(configPath);
        removedFiles.push('ai-guardian.json');
        console.log('✅ 移除 ai-guardian.json');
      } catch (e) {
        warnings.push('⚠️  無法移除 ai-guardian.json：' + e.message);
      }
    }

    // 3-c. .guardian/ 目錄（含所有 archive、lab、任務宣言）
    const guardianDir = path.join(projectRoot, '.guardian');
    if (fs.existsSync(guardianDir)) {
      try {
        fs.rmSync(guardianDir, { recursive: true, force: true });
        removedFiles.push('.guardian/');
        console.log('✅ 移除 .guardian/ 目錄（含 archive、lab、任務記錄）');
      } catch (e) {
        warnings.push('⚠️  無法移除 .guardian/ 目錄：' + e.message);
      }
    }
  }

  // ── 4. 自動提交清理（只 stage 已追蹤的改動）──
  if (removedFiles.length > 0) {
    try {
      // -u: 只 stage 已追蹤檔案的刪除/修改，不碰 untracked
      execSync('git add -u', { cwd: projectRoot, stdio: 'pipe' });
      const staged = execSync('git diff --cached --name-only', {
        cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore']
      }).toString().trim();

      if (staged) {
        const mode = isFull ? 'full uninstall' : 'remove hook and gitignore block';
        execSync(
          `git commit --no-verify -m "chore(guardian): ${mode}"`,
          { cwd: projectRoot, stdio: 'pipe' }
        );
        console.log('\n\ud83d\udce6 已自動提交解除安裝變更。');
      } else {
        console.log('\nℹ️  無需 git commit（移除的檔案未被版本控制追蹤）。');
      }
    } catch (e) {
      console.log('\nℹ️  自動提交跳過：' + e.message.split('\n')[0]);
    }
  }

  // ── 5. 輸出警告 ──
  if (warnings.length > 0) {
    console.log('');
    warnings.forEach(w => console.warn(w));
  }

  // ── 6. 最終摘要 ──
  console.log('');
  if (removedFiles.length === 0) {
    console.log('ℹ️  找不到 AI Guardian 的安裝痕跡，可能尚未安裝或已手動清除。');
  } else {
    console.log('🎉 AI Guardian 解除安裝完成！');
    console.log('   已移除：');
    removedFiles.forEach(f => console.log('   - ' + f));

    if (!isFull) {
      console.log('');
      console.log('ℹ️  IDE rules、ai-guardian.json、.guardian/ 目錄保留未動。');
      console.log('   若要完整移除所有 guardian 設定，請執行：');
      console.log('   ai-guardian uninstall --full');
    }
  }
}

module.exports = { runUninstall };
