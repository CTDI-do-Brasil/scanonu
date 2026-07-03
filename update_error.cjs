const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `      return res.status(500).json({
        success: false,
        error: 'Não foi possível gravar os dados no PostgreSQL.',
        details: dbError.message || String(dbError)
      });`;

const replacement = `      return res.status(500).json({
        success: false,
        error: 'Erro no BD: ' + (dbError.message || String(dbError)),
        details: dbError.message || String(dbError)
      });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update exact complete');
} else {
  console.log('Target not found');
}
