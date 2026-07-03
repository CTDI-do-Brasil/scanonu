const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex5 = /reconciledCpe = orphanRes\.rows\[0\]\.cpe_sn;\s*if \(orphanRes\.rows\[0\]\.fabricante\) fabricante = orphanRes\.rows\[0\]\.fabricante;\s*\}/;
const replacement5 = `reconciledCpe = orphanRes.rows[0].cpe_sn;
            if (orphanRes.rows[0].fabricante) fabricante = orphanRes.rows[0].fabricante;
            reconciledModelo = orphanRes.rows[0].modelo;
          }`;

const regex6 = /let reconciledCpe = null;/;
const replacement6 = `let reconciledCpe = null;
      let reconciledModelo = null;`;

const regex7 = /const updateValues = \[\s*fabricante \|\| 'N\/A',\s*normalizedModelo \|\| 'N\/A',/;
const replacement7 = `const updateValues = [
          fabricante || 'N/A',
          reconciledModelo || normalizedModelo || 'N/A',`;

if (regex5.test(code) && regex6.test(code) && regex7.test(code)) {
  code = code.replace(regex5, replacement5);
  code = code.replace(regex6, replacement6);
  code = code.replace(regex7, replacement7);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update generic reconciliation modelo complete');
} else {
  console.log('Target generic reconciliation modelo not found');
}
