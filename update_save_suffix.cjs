const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

const originalLogic = `    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : 
                     ((wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A') ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
      gpon_sn = 'N/A_' + suffix;
    }`;

const newLogic = `    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
      gpon_sn = 'N/A_' + suffix;
    }`;

code = code.replace(originalLogic, newLogic);

fs.writeFileSync(file, code, 'utf8');
console.log('Backend save logic updated to always use random suffix if no MAC is present.');
