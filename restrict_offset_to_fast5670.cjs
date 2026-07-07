const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Update /api/scan-label route candidate filter
const scanTarget = `              const matchedRow = candidatesRes.rows.find((row: any) => 
                matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid)
              );`;

const scanReplacement = `              const matchedRow = candidatesRes.rows.find((row: any) => {
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
              });`;

// 2. Update /api/save-label route candidate filter
const saveTarget = `        const matchedRow = candidatesRes.rows.find((row: any) => 
          matchMacAndSsidSuffix(row.mac, wifi_ssid)
        );`;

const saveReplacement = `        const matchedRow = candidatesRes.rows.find((row: any) => {
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
        });`;

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
