const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Replace SELECT gpon_sn with SELECT *
const regexSelect = /checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = \$1/g;
const replacementSelect = `checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = $1`;

const regexSelectSsid = /checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = \$1/g;
const replacementSelectSsid = `checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE wifi_ssid = $1`;

// Replace 409 block and update block
const regexUpdateBlock = /if\s*\(exists\s*\|\|\s*reconciledGpon\)\s*\{\s*if\s*\(exists\s*&&\s*!overwrite\)\s*\{\s*return\s*res\.status\(409\)\.json\([\s\S]*?\);\s*\}\s*const\s*targetGpon\s*=\s*exists\s*\?\s*checkRes\.rows\[0\]\.gpon_sn\s*:\s*\(reconciledGpon\s*\|\|\s*gpon_sn\);/g;

const replacementUpdateBlock = `if (exists || reconciledGpon) {
        if (exists) {
          const dbRow = checkRes.rows[0];
          const fieldsChanged = 
            (fabricante || 'N/A').toUpperCase() !== (dbRow.fabricante || 'N/A').toUpperCase() ||
            (normalizedModelo || 'N/A').toUpperCase() !== (dbRow.modelo || 'N/A').toUpperCase() ||
            (cpe_sn || 'N/A').toUpperCase() !== (dbRow.cpe_sn || 'N/A').toUpperCase() ||
            (mac || 'N/A').toUpperCase() !== (dbRow.mac || 'N/A').toUpperCase() ||
            (wifi_ssid || 'N/A').toUpperCase() !== (dbRow.wifi_ssid || 'N/A').toUpperCase() ||
            (resolvedWifiSsid5g || 'N/A').toUpperCase() !== (dbRow.wifi_ssid_5g || 'N/A').toUpperCase() ||
            (wifi_key || 'N/A') !== (dbRow.wifi_key || 'N/A') ||
            (usuario || 'N/A') !== (dbRow.usuario || 'N/A') ||
            (resolvedWebKey || 'N/A') !== (dbRow.web_key || 'N/A');

          if (!fieldsChanged) {
            return res.json({
              success: true,
              message: 'Dados idênticos, nada foi alterado.'
            });
          }
        }

        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);`;

if (regexSelect.test(code) && regexSelectSsid.test(code) && regexUpdateBlock.test(code)) {
  code = code.replace(regexSelect, replacementSelect);
  code = code.replace(regexSelectSsid, replacementSelectSsid);
  code = code.replace(regexUpdateBlock, replacementUpdateBlock);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target blocks not found in server.ts');
}
