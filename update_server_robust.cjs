const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Replace SELECT gpon_sn with SELECT *
code = code.replace(
  /checkRes\s*=\s*await\s*pool\.query\(\s*'SELECT\s+gpon_sn\s+FROM\s+etiquetas_scan_onu/gi,
  "checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu"
);

// Match: if (exists || reconciledGpon) { ... const targetGpon = ... }
const regexUpdateBlock = /if\s*\(\s*exists\s*\|\|\s*reconciledGpon\s*\)\s*\{[\s\S]*?const\s*targetGpon\s*=[\s\S]*?;/i;

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
              message: 'Dados identicos, nada foi alterado.'
            });
          }
        }

        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);`;

if (regexUpdateBlock.test(code)) {
  code = code.replace(regexUpdateBlock, replacementUpdateBlock);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target block not found in server.ts');
}
