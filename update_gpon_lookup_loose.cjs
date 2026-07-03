const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /if\s*\(gpon_sn\s*&&\s*!gpon_sn\.startsWith\('N\/A_'\)\s*&&\s*gpon_sn\.toUpperCase\(\)\s*!==\s*'N\/A'\)\s*\{[\s\S]*?checkRes\s*=\s*await\s*pool\.query\([\s\S]*?, \s*\[gpon_sn\]\);\s*\}/g;

const replacement = `if (gpon_sn && gpon_sn.toUpperCase() !== 'N/A' && gpon_sn.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
    }`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target regex not found in server.ts');
}
