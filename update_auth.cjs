const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /app\.post\('\/api\/save-label',\s*authenticateSession,\s*async\s*\(req:\s*any,\s*res:\s*any\)\s*=>\s*\{/g;
const replacement = `app.post('/api/save-label', async (req: any, res: any) => {`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex complete');
} else {
  console.log('Target not found');
}
