const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex3 = /"SELECT gpon_sn, mac, cpe_sn FROM etiquetas_scan_onu WHERE \(modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2'\) AND UPPER\(mac\) LIKE '%' \|\| \$1 AND \(wifi_ssid = 'N\/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL\)"/g;
const replacement3 = `"SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE UPPER(mac) LIKE '%' || $1 AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)"`;

if (regex3.test(code)) {
  code = code.replace(regex3, replacement3);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update generic reconciliation query complete');
} else {
  console.log('Target query not found');
}
