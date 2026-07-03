const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex2 = /if\s*\(!exists\s*&&\s*isFast5670\s*&&\s*wifi_ssid\s*&&\s*wifi_ssid\.toUpperCase\(\)\s*!==\s*'N\/A'\s*&&\s*wifi_ssid\.toUpperCase\(\)\s*!==\s*'NA'\)\s*\{\s*let\s*macSuffix\s*=\s*null;/;
const replacement2 = `if (!exists && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
        let macSuffix = null;`;

if (regex2.test(code)) {
  code = code.replace(regex2, replacement2);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update generic reconciliation part 1 complete');
} else {
  console.log('Target part 1 not found');
}
