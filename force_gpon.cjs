const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /const insertValues = \[\s*fabricante \|\| 'N\/A',\s*normalizedModelo \|\| 'N\/A',\s*cpe_sn \|\| 'N\/A',\s*gpon_sn \|\| 'N\/A',/g;
const replacement = `if (!gpon_sn || gpon_sn.trim() === '' || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
          gpon_sn = 'N/A_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        }

        const insertValues = [
          fabricante || 'N/A',
          normalizedModelo || 'N/A',
          cpe_sn || 'N/A',
          gpon_sn,`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex force gpon complete');
} else {
  console.log('Target regex force gpon not found');
}
