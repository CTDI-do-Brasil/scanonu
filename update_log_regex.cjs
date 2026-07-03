const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /const insertQuery = `\s*INSERT INTO etiquetas_scan_onu/g;
const replacement = `console.log('TENTANDO INSERIR GPON SN:', gpon_sn);
        const insertQuery = \`
          INSERT INTO etiquetas_scan_onu`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex log complete');
} else {
  console.log('Target regex log not found');
}
