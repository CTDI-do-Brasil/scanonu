const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Locate scan-label route matchedRow block
const scanTarget = `              const matchedRow = candidatesRes.rows.find((row: any) => {
                const normModel = row.modelo ? row.modelo.toUpperCase() : '';
                const isFast5670 = normModel.includes('5670');
                if (isFast5670) {
                  return matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid);
                } else {
                  const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
                  const cleanSsid = scanResult.wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
                  if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
                    return cleanMac.endsWith(cleanSsid.slice(-4));
                  }
                  return false;
                }
              });
              if (matchedRow) {
                checkRes.rows = [matchedRow];
                checkRes.rowCount = 1;
              }`;

const scanReplacement = `              const matchingRows = candidatesRes.rows.filter((row: any) => {
                const normModel = row.modelo ? row.modelo.toUpperCase() : '';
                const isFast5670 = normModel.includes('5670');
                if (isFast5670) {
                  return matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid);
                } else {
                  const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
                  const cleanSsid = scanResult.wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
                  if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
                    return cleanMac.endsWith(cleanSsid.slice(-4));
                  }
                  return false;
                }
              });

              if (matchingRows.length > 1) {
                return res.json({
                  success: false,
                  error: 'Separe esta unidade e entregue para o seu Líder'
                });
              } else if (matchingRows.length === 1) {
                checkRes.rows = [matchingRows[0]];
                checkRes.rowCount = 1;
              }`;

// 2. Locate save-label route matchedRow block
const saveTarget = `        const matchedRow = candidatesRes.rows.find((row: any) => {
          const normModel = row.modelo ? row.modelo.toUpperCase() : '';
          const isFast5670 = normModel.includes('5670');
          if (isFast5670) {
            return matchMacAndSsidSuffix(row.mac, wifi_ssid);
          } else {
            const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
            const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
            if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
              return cleanMac.endsWith(cleanSsid.slice(-4));
            }
            return false;
          }
        });
        if (matchedRow) {
          reconciledGpon = matchedRow.gpon_sn;
          reconciledMac = matchedRow.mac;
          reconciledCpe = matchedRow.cpe_sn;
          if (matchedRow.fabricante) fabricante = matchedRow.fabricante;
          reconciledModelo = matchedRow.modelo;
        }`;

const saveReplacement = `        const matchingRows = candidatesRes.rows.filter((row: any) => {
          const normModel = row.modelo ? row.modelo.toUpperCase() : '';
          const isFast5670 = normModel.includes('5670');
          if (isFast5670) {
            return matchMacAndSsidSuffix(row.mac, wifi_ssid);
          } else {
            const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
            const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
            if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
              return cleanMac.endsWith(cleanSsid.slice(-4));
            }
            return false;
          }
        });

        if (matchingRows.length > 1) {
          return res.status(400).json({
            error: 'Separe esta unidade e entregue para o seu Líder'
          });
        } else if (matchingRows.length === 1) {
          const matchedRow = matchingRows[0];
          reconciledGpon = matchedRow.gpon_sn;
          reconciledMac = matchedRow.mac;
          reconciledCpe = matchedRow.cpe_sn;
          if (matchedRow.fabricante) fabricante = matchedRow.fabricante;
          reconciledModelo = matchedRow.modelo;
        }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normScanTarget = scanTarget.replace(/\r?\n/g, '\n');
const normSaveTarget = saveTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normScanTarget) && normCode.includes(normSaveTarget)) {
  let updatedCode = normCode.replace(normScanTarget, scanReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normSaveTarget, saveReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update server.ts complete');
} else {
  console.log('Target matchedRow blocks not matched in server.ts');
}
