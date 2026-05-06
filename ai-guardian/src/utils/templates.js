const fs = require('fs');
const path = require('path');

// markdown template 的 single source of truth
// 任何 template 修改，請改 ai-guardian/templates/ 底下的檔，不要回頭塞 JS 字串
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

function loadTemplate(filename) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf-8');
}

// 用 split/join 取代 replace(/regex/g, ...)，避免特殊字元 escape 議題
function renderTemplate(content, vars) {
  return Object.keys(vars).reduce(
    (acc, key) => acc.split('{{' + key + '}}').join(vars[key]),
    content
  );
}

module.exports = { loadTemplate, renderTemplate, TEMPLATES_DIR };
