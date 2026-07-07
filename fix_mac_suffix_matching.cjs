const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Update /api/scan-label duplicate check to query by MAC suffix from SSID
const scanTarget = `        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
              [scanResult.wifi_ssid]
            );
          }`;

const scanReplacement = `        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            const cleanSsid = scanResult.wifi_ssid.replace(/_(2G|5G)$/i, '');
            const ssidSuffix = cleanSsid.length >= 4 ? cleanSsid.slice(-4).toUpperCase() : '';
            if (ssidSuffix) {
              checkRes = await dbPool.query(
                'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1 OR REPLACE(UPPER(mac), \\':\\', \\'\\') LIKE \\'%\\' || $2',
                [scanResult.wifi_ssid, ssidSuffix]
              );
            } else {
              checkRes = await dbPool.query(
                'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
                [scanResult.wifi_ssid]
              );
            }
          }`;

// 2. Update /api/save-label MAC suffix lookup to strip colons with REPLACE
const saveTarget = `      if (macSuffix) {
        const orphanRes = await pool.query(
          "SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE UPPER(mac) LIKE '%' || $1 AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)",
          [macSuffix]
        );`;

const saveReplacement = `      if (macSuffix) {
        const orphanRes = await pool.query(
          "SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE REPLACE(UPPER(mac), ':', '') LIKE '%' || $1 AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)",
          [macSuffix]
        );`;

const normCode = code.replace(/\r?\n/g, '\n');
const normScanTarget = scanTarget.replace(/\r?\n/g, '\n');
const normSaveTarget = saveTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normScanTarget) && normCode.includes(normSaveTarget)) {
  let updatedCode = normCode.replace(normScanTarget, scanReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normSaveTarget, saveReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target duplicate query search blocks not found in server.ts');
}
