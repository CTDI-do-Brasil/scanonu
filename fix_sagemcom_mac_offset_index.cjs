const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add matchMacAndSsidSuffix helper
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

// Normalize line breaks
let normCode = code.replace(/\r?\n/g, '\n');

// 2. Locate duplicate check block in scan-label route
const scanStartMarker = `} else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {`;
const scanEndMarker = `          }`; // up to the next closing block for this branch

const scanIndex = normCode.indexOf(scanStartMarker);
if (scanIndex !== -1) {
  // Find where it ends by looking for the database query checkRes assignment ending
  const querySegmentEnd = normCode.indexOf('}', scanIndex + scanStartMarker.length);
  const nextSegmentEnd = normCode.indexOf('}', querySegmentEnd + 1); // get the outer block close
  
  const scanReplacement = `} else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
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
          
  // We locate the full branch block and replace it
  const origBlockStart = scanIndex;
  const origBlockEnd = normCode.indexOf('checkRes.rowCount', scanIndex); // get to the next checkRes.rowCount check
  const branchCloseIndex = normCode.lastIndexOf('}', origBlockEnd); // find the closing brace before checkRes.rowCount
  
  const originalBlock = normCode.substring(origBlockStart, branchCloseIndex + 1);
  normCode = normCode.replace(originalBlock, scanReplacement);
  console.log('scan-label block updated');
} else {
  console.log('scan-label start marker not found');
}

// 3. Locate save-label route MAC reconciliation block
const saveStartMarker = `      if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {`;
const saveMarkerInside = `        if (cleanSsid.length >= 4) {`;
const saveEndMarker = `      }`; // outer block close

const saveIndex = normCode.indexOf(saveStartMarker);
if (saveIndex !== -1) {
  // Find where it ends by looking for reconciledModelo assignment
  const reconciledIndex = normCode.indexOf('reconciledModelo =', saveIndex);
  const outerCloseIndex = normCode.indexOf('}', reconciledIndex);
  
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
      
  const originalBlock = normCode.substring(saveIndex, outerCloseIndex + 1);
  normCode = normCode.replace(originalBlock, saveReplacement);
  console.log('save-label block updated');
} else {
  console.log('save-label start marker not found');
}

fs.writeFileSync(filePath, normCode, 'utf8');
console.log('Write server.ts success');
