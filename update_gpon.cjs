const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /\/\/ Gerar um GPON SN unico se vier como N\/A apenas para F@ST 5670\s*if\s*\(isFast5670\s*&&\s*\(!gpon_sn\s*\|\|\s*gpon_sn\.toUpperCase\(\)\s*===\s*'N\/A'\s*\|\|\s*gpon_sn\.toUpperCase\(\)\s*===\s*'NA'\)\)\s*\{\s*const\s*suffix\s*=\s*\(mac\s*&&\s*mac\.toUpperCase\(\)\s*!==\s*'N\/A'\)\s*\?\s*mac\s*:\s*Math\.random\(\)\.toString\(36\)\.substring\(2,\s*10\)\.toUpperCase\(\);\s*gpon_sn\s*=\s*'N\/A_'\s*\+\s*suffix;\s*\}\s*else\s*if\s*\(!gpon_sn\s*\|\|\s*gpon_sn\.toUpperCase\(\)\s*===\s*'N\/A'\s*\|\|\s*gpon_sn\.toUpperCase\(\)\s*===\s*'NA'\)\s*\{\s*gpon_sn\s*=\s*'N\/A';\s*\}/g;

const replacement = `// Gerar um GPON SN unico se vier como N/A SEMPRE para não violar UNIQUE constraint
      if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
        const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
        gpon_sn = 'N/A_' + suffix;
      }`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update GPON logic complete');
} else {
  console.log('Target GPON logic not found');
}
