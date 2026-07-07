const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add self-healing check inside /api/scan-label route
const scanTarget = `        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
        }`;

const scanReplacement = `        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
          
          // Se o registro encontrado no banco é temporário (não tem GPON real)
          const isTempGpon = existingData.gpon_sn && existingData.gpon_sn.toUpperCase().startsWith('N/A');
          if (isTempGpon && scanResult.wifi_ssid) {
            // Tenta achar um registro real pré-carregado no banco que tenha o MAC compatível
            const candidatesRes = await dbPool.query(
              "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn NOT LIKE 'N/A%' AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)"
            );
            const realMatchedRow = candidatesRes.rows.find((row: any) => 
              matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid)
            );
            if (realMatchedRow) {
              // Mescla os dados do registro real (S/N, GPON, MAC) com os dados de senhas do registro temporário
              existingData = {
                ...existingData,
                gpon_sn: realMatchedRow.gpon_sn,
                mac: realMatchedRow.mac,
                cpe_sn: realMatchedRow.cpe_sn,
                fabricante: realMatchedRow.fabricante || existingData.fabricante,
                modelo: realMatchedRow.modelo || existingData.modelo
              };
            }
          }
        }`;

// 2. Add temporary row deletion inside /api/save-label route
const saveTarget = `    if (exists || reconciledGpon) {`;
const saveReplacement = `    // Se estamos salvando um registro completo com GPON real, limpamos registros temporários duplicados com o mesmo SSID
    if (gpon_sn && !gpon_sn.toUpperCase().startsWith('N/A') && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A') {
      try {
        await pool.query(
          "DELETE FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND gpon_sn LIKE 'N/A%'",
          [wifi_ssid]
        );
      } catch (delErr) {
        console.error('Erro ao limpar registro temporario duplicado:', delErr);
      }
    }

    if (exists || reconciledGpon) {`;

const normCode = code.replace(/\r?\n/g, '\n');
const normScanTarget = scanTarget.replace(/\r?\n/g, '\n');
const normSaveTarget = saveTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normScanTarget) && normCode.includes(normSaveTarget)) {
  let updatedCode = normCode.replace(normScanTarget, scanReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normSaveTarget, saveReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target duplicate and save blocks not found in server.ts');
}
