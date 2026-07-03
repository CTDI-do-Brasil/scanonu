const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /error:\s*'N.o foi poss.vel gravar os dados no PostgreSQL\.'/g;
const replacement = `error: 'Erro BD: ' + (dbError.message || String(dbError))`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex error complete');
} else {
  console.log('Target not found for error message');
}
