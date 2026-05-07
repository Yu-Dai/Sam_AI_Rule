const fs = require('fs');
const path = require('path');

function getDebateStateFile(cwd) {
  return path.join(cwd, '.guardian', 'debate.json');
}

function getDebateState(cwd) {
  const file = getDebateStateFile(cwd);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function saveDebateState(cwd, state) {
  const file = getDebateStateFile(cwd);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

function startDebate(cwd) {
  const initialState = {
    status: 'AWAITING_CTO',
    startedAt: new Date().toISOString()
  };
  saveDebateState(cwd, initialState);

  console.log('[debate] state: AWAITING_CTO');
  console.log('');
  console.log('Phase 1 — CTO Attack（紅隊）');
  console.log('  切換到「紅隊 CTO」人格。任務：');
  console.log('  1. 用 grep / read 工具實際讀取本次任務牽涉的 codebase（API、資料模型）');
  console.log('  2. Assume Ruin：假設此架構上線第一天就爆炸（重大 bug / 資料異常）');
  console.log('  3. 產出 ≥3 個具體災難案例，每個必須：');
  console.log('     - 引用真實檔名 / 函式名 / 路徑');
  console.log('     - 點出在高併發、網路中斷、髒資料、生命週期錯亂下的死穴');
  console.log('  4. 寫入 .guardian/cto_attack.md');
  console.log('  5. 執行 ai-guardian debate submit-cto');
  console.log('');
  console.log('  驗證規則：報告 < 100 字 → 退回；無檔案路徑或副檔名 → 退回。');
}

function statusDebate(cwd) {
  const state = getDebateState(cwd);
  if (!state) {
    console.log('[debate] no active debate. run: ai-guardian debate start');
    return;
  }

  console.log(`[debate] state: ${state.status}`);
  switch (state.status) {
    case 'AWAITING_CTO':
      console.log('  next: 寫 .guardian/cto_attack.md → ai-guardian debate submit-cto');
      break;
    case 'AWAITING_ARCHITECT':
      console.log('  next: 寫 .guardian/architect_defend.md → ai-guardian debate submit-architect');
      break;
    case 'AWAITING_APPROVAL':
      console.log('  next: 在 chat 跟 user 確認防禦成立 → user 同意後執行 ai-guardian debate approve');
      break;
    case 'APPROVED':
      console.log('  next: 對峙已通過，可開始實作。commit 封鎖已解除。');
      break;
  }
}

function submitCto(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_CTO') {
    console.error('[err] 當前不是 CTO 提交階段。跑 ai-guardian debate status 看 state。');
    process.exit(1);
  }

  const attackFile = path.join(cwd, '.guardian', 'cto_attack.md');
  if (!fs.existsSync(attackFile)) {
    console.error('[err] 找不到 .guardian/cto_attack.md。先把災難報告寫入該檔。');
    process.exit(1);
  }

  const content = fs.readFileSync(attackFile, 'utf-8');

  if (content.length < 100) {
    console.error('[reject] cto_attack.md 太短（< 100 字）。回去寫具體案例，不要敷衍。');
    process.exit(1);
  }

  // 寬鬆地毯式掃：報告必須提到實體檔名 / 路徑，否則就是空泛猜測
  const hasPathOrExtension = /(\w+\.(js|ts|jsx|tsx|html|css))/i.test(content) || /(src\/|lib\/|components\/)/i.test(content);
  if (!hasPathOrExtension) {
    console.error('[reject] cto_attack.md 沒引用任何實體檔名或路徑（.js / .ts / src/ / lib/ ...）。');
    console.error('         要先 grep codebase，找到具體會出事的位置再寫。');
    process.exit(1);
  }

  state.status = 'AWAITING_ARCHITECT';
  saveDebateState(cwd, state);

  console.log('[debate] state: AWAITING_ARCHITECT');
  console.log('');
  console.log('Phase 2 — 架構師 Defend（藍隊）');
  console.log('  切換到「防禦架構師」人格。任務：');
  console.log('  1. 讀 .guardian/cto_attack.md，逐條看每個 attack');
  console.log('  2. 對每個 attack 提實體對策：');
  console.log('     - 防禦 code / try-catch / rollback / 參數驗證 / 鎖定機制');
  console.log('     - 禁止空泛建議（「應該加錯誤處理」這種不算）');
  console.log('     - 若某 attack 無法防禦 → 承認並提出換方案');
  console.log('  3. 寫入 .guardian/architect_defend.md');
  console.log('  4. 執行 ai-guardian debate submit-architect');
}

function submitArchitect(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_ARCHITECT') {
    console.error('[err] 當前不是架構師提交階段。跑 ai-guardian debate status 看 state。');
    process.exit(1);
  }

  const defendFile = path.join(cwd, '.guardian', 'architect_defend.md');
  if (!fs.existsSync(defendFile)) {
    console.error('[err] 找不到 .guardian/architect_defend.md。先寫防禦策略再提交。');
    process.exit(1);
  }

  state.status = 'AWAITING_APPROVAL';
  saveDebateState(cwd, state);

  console.log('[debate] state: AWAITING_APPROVAL');
  console.log('');
  console.log('Phase 3 — 人類裁判');
  console.log('  AI 任務：');
  console.log('  1. 在 chat 對話框向 user 總結防禦的關鍵點（highlights，不是 dump 全文）');
  console.log('  2. 詢問 user：「此防禦機制是否成立？通過後我才會開始實作。」');
  console.log('  3. user 同意後執行 ai-guardian debate approve');
}

function approveDebate(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_APPROVAL') {
    console.error('[err] 當前不是 approve 階段。跑 ai-guardian debate status 看 state。');
    process.exit(1);
  }

  state.status = 'APPROVED';
  saveDebateState(cwd, state);
  console.log('[debate] state: APPROVED — 可開始實作。commit 封鎖已解除。');
}

function resetDebate(cwd) {
  const stateFile = getDebateStateFile(cwd);
  const attackFile = path.join(cwd, '.guardian', 'cto_attack.md');
  const defendFile = path.join(cwd, '.guardian', 'architect_defend.md');

  if (!fs.existsSync(stateFile)) {
    console.log('[debate] no state to reset');
    return;
  }

  const state = getDebateState(cwd);
  fs.unlinkSync(stateFile);
  if (fs.existsSync(attackFile)) fs.unlinkSync(attackFile);
  if (fs.existsSync(defendFile)) fs.unlinkSync(defendFile);

  console.log(`[debate] reset (was: ${state.status})`);
  console.log('         to start over: ai-guardian debate start');
}

function runDebate(cwd, subCommand) {
  if (!subCommand) {
    statusDebate(cwd);
    return;
  }

  switch (subCommand) {
    case 'start':
      startDebate(cwd);
      break;
    case 'status':
      statusDebate(cwd);
      break;
    case 'submit-cto':
      submitCto(cwd);
      break;
    case 'submit-architect':
      submitArchitect(cwd);
      break;
    case 'approve':
      approveDebate(cwd);
      break;
    case 'reset':
      resetDebate(cwd);
      break;
    default:
      console.error('[err] unknown subcommand. supported: start / status / submit-cto / submit-architect / approve / reset');
      process.exit(1);
  }
}

module.exports = {
  runDebate,
  resetDebate
};
