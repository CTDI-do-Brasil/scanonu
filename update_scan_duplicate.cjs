const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /else\s+if\s*\(isScanFast5670\s*&&\s*scanResult\.wifi_ssid\s*&&\s*scanResult\.wifi_ssid\.toUpperCase\(\)\s*!==\s*'N\/A'\s*&&\s*scanResult\.wifi_ssid\.toUpperCase\(\)\s*!==\s*'NA'\)\s*\{\s*checkRes\s*=\s*await\s*dbPool\.query\(\s*'SELECT\s+fabricante,[\s\S]*?WHERE\s+wifi_ssid\s*=\s*\$1\s+AND\s+\(modelo\s*=\s*'F@ST 5670'\s+OR\s+modelo\s*=\s*'F@ST 5670V2'\)'\s*,\s*\[scanResult\.wifi_ssid\]\s*\);\s*\}/g;

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
  // Try loose or exact string replacement
  const target = `          } else if (isScanFast5670 && scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')',
              [scanResult.wifi_ssid]
            );
          }`;

  const targetNorm = target.replace(/\r?\n/g, '\n');
  const codeNorm = code.replace(/\r?\n/g, '\n');

  if (codeNorm.includes(targetNorm)) {
    code = codeNorm.replace(targetNorm, replacement.replace(/\r?\n/g, '\n'));
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Update scan-label duplicate check via string replacement complete');
  } else {
    console.log('Target for scan-label duplicate check not found');
  }
}
