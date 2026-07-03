const fs = require('fs');
const file = 'backend/src/server.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `const insertQuery = \`
          INSERT INTO etiquetas_scan_onu`;

const replacement = `console.log('TENTANDO INSERIR GPON SN:', gpon_sn);
        const insertQuery = \`
          INSERT INTO etiquetas_scan_onu`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log('Success');
} else {
  console.log('Target not found');
}
