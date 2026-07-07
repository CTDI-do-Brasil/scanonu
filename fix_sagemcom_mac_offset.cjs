const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add matchMacAndSsidSuffix helper to server.ts (e.g., near the correctMacPrefix function)
const helperTarget = `function correctMacPrefix(mac: string): string {`;
const helperCode = `function matchMacAndSsidSuffix(mac: string, ssid: string): boolean {
  if (!mac || !ssid) return false;
  const cleanMac = mac.replace(/[^0-9A-FA-F]/g, '');
  const cleanSsid = ssid.replace(/_(2G|5G)$/i, '').trim();
  if (cleanMac.length < 4 || cleanSsid.length < 4) return false;
  
  const macSuffix = cleanMac.slice(-4);
  const ssidSuffix = cleanSsid.slice(-4);
  
  const macVal = parseInt(macSuffix, 16);
  const ssidVal = parseInt(ssidSuffix, 16);
  
  if (isNaN(macVal) || isNaN(ssidVal)) return false;
  
  const diff = macVal - ssidVal;
  // Permite uma margem de offset de até 15 hex (ex: 5477 - 5470 = 7)
  return diff >= 0 && diff <= 15;
}

function correctMacPrefix(mac: string): string {`;

if (code.includes(helperTarget) && !code.includes('function matchMacAndSsidSuffix')) {
  code = code.replace(helperTarget, helperCode);
}

// 2. Update scan-label route duplicate check to use matchMacAndSsidSuffix
const scanTarget = `        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
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

const scanReplacement = `        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
              [scanResult.wifi_ssid]
            );
            if (checkRes.rowCount === 0) {
              const candidatesRes = await dbPool.query(
                "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL"
              );
              const matchedRow = candidatesRes.rows.find((row: any) => 
                matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid)
              );
              if (matchedRow) {
                checkRes.rows = [matchedRow];
                checkRes.rowCount = 1;
              }
            }
          }`;

// 3. Update save-label route MAC reconciliation check to use matchMacAndSsidSuffix
const saveTarget = `      if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
        const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '');
        if (cleanSsid.length >= 4) {
          macSuffix = cleanSsid.slice(-4).toUpperCase();
        }
      }

      if (macSuffix) {
        const orphanRes = await pool.query(
          "SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE REPLACE(UPPER(mac), ':', '') LIKE '%' || $1 AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          reconciledGpon = orphanRes.rows[0].gpon_sn;
          reconciledMac = orphanRes.rows[0].mac;
            reconciledCpe = orphanRes.rows[0].cpe_sn;
            if (orphanRes.rows[0].fabricante) fabricante = orphanRes.rows[0].fabricante;
            reconciledModelo = orphanRes.rows[0].modelo;
          }
      }`;

const saveReplacement = `      if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
        const candidatesRes = await pool.query(
          "SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL"
        );
        const matchedRow = candidatesRes.rows.find((row: any) => 
          matchMacAndSsidSuffix(row.mac, wifi_ssid)
        );
        if (matchedRow) {
          reconciledGpon = matchedRow.gpon_sn;
          reconciledMac = matchedRow.mac;
          reconciledCpe = matchedRow.cpe_sn;
          if (matchedRow.fabricante) fabricante = matchedRow.fabricante;
          reconciledModelo = matchedRow.modelo;
        }
      }`;

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
