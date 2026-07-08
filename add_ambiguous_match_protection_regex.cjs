const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Regex to replace matchedRow logic in /api/scan-label route
const scanRegex = /const\s+matchedRow\s+=\s+candidatesRes\.rows\.find\([\s\S]*?\}\);\s*if\s*\(matchedRow\)\s*\{\s*checkRes\.rows\s*=\s*\[matchedRow\];\s*checkRes\.rowCount\s*=\s*1;\s*\}/i;
const scanReplacement = `const matchingRows = candidatesRes.rows.filter((row: any) => {
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

// 2. Regex to replace matchedRow logic in /api/save-label route
const saveRegex = /const\s+matchedRow\s+=\s+candidatesRes\.rows\.find\([\s\S]*?\}\);\s*if\s*\(matchedRow\)\s*\{\s*reconciledGpon\s*=\s*matchedRow\.gpon_sn;\s*reconciledMac\s*=\s*matchedRow\.mac;\s*reconciledCpe\s*=\s*matchedRow\.cpe_sn;\s*if\s*\(matchedRow\.fabricante\)\s*fabricante\s*=\s*matchedRow\.fabricante;\s*reconciledModelo\s*=\s*matchedRow\.modelo;\s*\}/i;
const saveReplacement = `const matchingRows = candidatesRes.rows.filter((row: any) => {
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

if (scanRegex.test(code) && saveRegex.test(code)) {
  code = code.replace(scanRegex, scanReplacement);
  code = code.replace(saveRegex, saveReplacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target match blocks not matched by regex');
}
