const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    if (!exists && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
        let macSuffix = null;
      const match = wifi_ssid.match(/([0-9a-fA-F]{4})(?:_2G|_5G)?$/i);
      if (match) {
        macSuffix = match[1].toUpperCase();
      } else {
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
      }
    }`;

const replacement = `    if (!exists && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
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
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target save-label reconciliation block not found');
}
