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
  console.log('🚨 [法庭啟動] AI Guardian 對峙法庭已立案。');
  
  const initialState = {
    status: 'AWAITING_CTO',
    startedAt: new Date().toISOString()
  };
  saveDebateState(cwd, initialState);

  console.log(`
👉【紅隊 CTO 任務指派】
請你現在立刻切換人格為「紅隊 CTO」。

[情報蒐集要求]
在寫下任何攻擊前，你必須先調用 IDE 工具 (如 grep_search 或 view_file) 實際去讀取與此次任務相關的 codebase（如 API 封裝、資料模型）。

[Assume Ruin 情境強制設定]
「你現在計畫的這套架構 / 任務改動，在上線第一天就導致了公司發生了嚴重的 Bug 或資料異常跑版。」

請冷酷地提出 3 個具體的災難邊界案例報告。
⚠️ 驗證要求：
1. 報告中必須明確引用真實存在的專案檔案路徑或函數名稱。
2. 必須指出在高併發、網路中斷、髒資料或生命週期錯亂下的具體死穴。

撰寫完畢後，請將報告存為 '.guardian/cto_attack.md'，
然後執行指令提交審查：
$ npx ai-guardian debate submit-cto
  `);
}

function statusDebate(cwd) {
  const state = getDebateState(cwd);
  if (!state) {
    console.log('目前沒有進行中的對峙法庭。請執行 ai-guardian debate start 啟動。');
    return;
  }
  
  console.log(`🔍 當前法庭狀態：${state.status}`);
  switch (state.status) {
    case 'AWAITING_CTO':
      console.log('⏳ 正在等待 CTO 提交攻擊點。請將內容寫入 .guardian/cto_attack.md，並執行 ai-guardian debate submit-cto。');
      break;
    case 'AWAITING_ARCHITECT':
      console.log('⏳ 正在等待藍隊架構師提交防禦策略。請將內容寫入 .guardian/architect_defend.md，並執行 ai-guardian debate submit-architect。');
      break;
    case 'AWAITING_APPROVAL':
      console.log('⏳ 正在等待開發者 (Human) 最終核准。AI 請在對話框向使用者確認。一旦使用者說 OK，請執行 ai-guardian debate approve。');
      break;
    case 'APPROVED':
      console.log('✅ 本非法庭案件已結案核准，Git 防線已為您解鎖！可以開始撰寫實體程式碼。');
      break;
  }
}

function submitCto(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_CTO') {
    console.error('❌ [錯誤] 當前不是 CTO 提交攻擊的階段。請執行 ai-guardian debate status 查看狀態。');
    process.exit(1);
  }

  const attackFile = path.join(cwd, '.guardian', 'cto_attack.md');
  if (!fs.existsSync(attackFile)) {
    console.error('❌ [錯誤] 找不到 .guardian/cto_attack.md 檔案！請確保你已經將災難報告寫入該文件。');
    process.exit(1);
  }

  const content = fs.readFileSync(attackFile, 'utf-8');
  
  if (content.length < 100) {
    console.error('❌ [駁回] 災難報告太短，請勿敷衍了事。請回去重寫並分析更潛在的深層邊界案例。');
    process.exit(1);
  }

  // 強制要求有類似單字或路徑出現 (非常寬鬆的地毯式掃描，只要有提到 src/ 或 lib/ 等類似路徑就算過關，確保不是空泛猜測)
  const hasPathOrExtension = /(\w+\.(js|ts|jsx|tsx|html|css))/i.test(content) || /(src\/|lib\/|components\/)/i.test(content);
  if (!hasPathOrExtension) {
    console.error('❌ [駁回] 缺乏實體證據！你的報告沒有引用任何一個實體的程式碼檔案副檔名 (如 .js, .ts) 或目錄 (如 src/)。請去搜尋 Codebase 後加上具體的出事路徑！');
    process.exit(1);
  }

  // 更新狀態
  state.status = 'AWAITING_ARCHITECT';
  saveDebateState(cwd, state);

  console.log(`
✅ [法庭驗證通過] CTO 攻擊已記錄！

👉【藍隊架構師任務指派】
請你現在立刻切換人格為「防禦架構師」。

請詳閱 '.guardian/cto_attack.md' 裡的火力。
你必須給出實體的「防禦程式碼策略」或「安全的 Try-Catch 退路 (Rollback) 機制」。
不能只給空泛建議，如果發現根本無法防禦，必須承認並構思新方案。

撰寫完畢後，請將防禦策略存為 '.guardian/architect_defend.md'，
然後執行指令提交審查：
$ npx ai-guardian debate submit-architect
  `);
}

function submitArchitect(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_ARCHITECT') {
    console.error('❌ [錯誤] 當前不是架構師提交防禦的階段。請執行 ai-guardian debate status 查看。');
    process.exit(1);
  }

  const defendFile = path.join(cwd, '.guardian', 'architect_defend.md');
  if (!fs.existsSync(defendFile)) {
    console.error('❌ [錯誤] 找不到 .guardian/architect_defend.md 檔案！請寫入防禦策略。');
    process.exit(1);
  }

  state.status = 'AWAITING_APPROVAL';
  saveDebateState(cwd, state);

  console.log(`
✅ [法庭驗證通過] 防禦策略已記錄！

👉【最終階段：人類裁判】
現在你的對話工作已經完成。
請在「Chat UI 對話框」向 User 總結防禦的亮點，並詢問 User：
「請問此防禦機制是否成立？若同意，請告訴我，我會解鎖狀態並開始撰寫實體程式碼。」

當 User 說 OK 後，請執行：
$ npx ai-guardian debate approve
  `);
}

function approveDebate(cwd) {
  const state = getDebateState(cwd);
  if (!state || state.status !== 'AWAITING_APPROVAL') {
    console.error('❌ [錯誤] 尚未準備好核准。');
    process.exit(1);
  }

  state.status = 'APPROVED';
  saveDebateState(cwd, state);
  console.log('🎉 [法庭解散] 專案已解鎖！你和開發者現在可以正式開始進行開發並且 Commit 程式碼了。');
}

function resetDebate(cwd) {
  const stateFile = getDebateStateFile(cwd);
  const attackFile = path.join(cwd, '.guardian', 'cto_attack.md');
  const defendFile = path.join(cwd, '.guardian', 'architect_defend.md');

  if (!fs.existsSync(stateFile)) {
    console.log('ℹ️  目前沒有進行中的法庭，無需重置。');
    return;
  }

  const state = getDebateState(cwd);
  fs.unlinkSync(stateFile);
  if (fs.existsSync(attackFile)) fs.unlinkSync(attackFile);
  if (fs.existsSync(defendFile)) fs.unlinkSync(defendFile);

  console.log(`🔄 [法庭重置] 已清除法庭狀態（原狀態：${state.status}）。`);
  console.log('   所有 Commit 封鎖已解除。');
  console.log('   如需重新啟動法庭，請執行 ai-guardian debate start。');
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
      console.error('未知的 debate 指令。支援的指令: start, status, submit-cto, submit-architect, approve, reset');
      process.exit(1);
  }
}

module.exports = {
  runDebate,
  resetDebate
};
