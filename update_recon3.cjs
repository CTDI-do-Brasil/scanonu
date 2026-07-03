const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex4 = /reconciledMac = orphanRes\.rows\[0\]\.mac;\s*reconciledCpe = orphanRes\.rows\[0\]\.cpe_sn;\s*\}/;
const replacement4 = `reconciledMac = orphanRes.rows[0].mac;
            reconciledCpe = orphanRes.rows[0].cpe_sn;
            if (orphanRes.rows[0].fabricante) fabricante = orphanRes.rows[0].fabricante;
          }`;

if (regex4.test(code)) {
  code = code.replace(regex4, replacement4);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update generic reconciliation fields complete');
} else {
  console.log('Target generic reconciliation fields not found');
}
