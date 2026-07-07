const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// We use regex to find both matchedRow declarations and update them in a whitespace-independent way

// 1. For scanResult.wifi_ssid
const scanRegex = /const\s+matchedRow\s+=\s+candidatesRes\.rows\.find\(\(row:\s*any\)\s*=>\s*matchMacAndSsidSuffix\(row\.mac,\s*scanResult\.wifi_ssid\)\s*\);/i;
const scanReplacement = `const matchedRow = candidatesRes.rows.find((row: any) => {
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

// 2. For wifi_ssid
const saveRegex = /const\s+matchedRow\s+=\s+candidatesRes\.rows\.find\(\(row:\s*any\)\s*=>\s*matchMacAndSsidSuffix\(row\.mac,\s*wifi_ssid\)\s*\);/i;
const saveReplacement = `const matchedRow = candidatesRes.rows.find((row: any) => {
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

if (scanRegex.test(code) && saveRegex.test(code)) {
  code = code.replace(scanRegex, scanReplacement);
  code = code.replace(saveRegex, saveReplacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target matchMacAndSsidSuffix blocks not matched by regex');
}
