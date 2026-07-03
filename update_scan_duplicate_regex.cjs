const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Find: } else if (isScanFast5670 && ... ) { checkRes = await ... }
const regex = /else\s+if\s*\(\s*isScanFast5670\s*&&\s*scanResult\.wifi_ssid[\s\S]*?checkRes\s*=\s*await\s*dbPool\.query\([\s\S]*?\);\s*\}/g;

const replacement = `else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
              [scanResult.wifi_ssid]
            );
          }`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update scan-label duplicate check complete');
} else {
  console.log('Target regex not found in server.ts');
}
