const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex2 = /\} else if \(isFast5670 && wifi_ssid && wifi_ssid\.toUpperCase\(\) !== 'N\/A' && wifi_ssid\.toUpperCase\(\) !== 'NA'\) \{/g;
const replacement2 = `} else if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {`;

const regex3 = /checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = \$1 AND \(modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\'\)', \[wifi_ssid\]\);/g;
const replacement3 = `checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1', [wifi_ssid]);`;

if (regex2.test(code) && regex3.test(code)) {
  code = code.replace(regex2, replacement2);
  code = code.replace(regex3, replacement3);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex checkRes complete');
} else {
  console.log('Target regex checkRes not found');
}
