const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

// Modificando a destruturação em /api/save-label para 'let' e adicionando lógica de geração de GPON SN único se for N/A
const originalDestructure = `    const { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, web_key, operador, overwrite, targetDb, imagem_url } = req.body;`;

const newDestructure = `    let { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, web_key, operador, overwrite, targetDb, imagem_url } = req.body;

    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : 
                     ((wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A') ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
      gpon_sn = 'N/A_' + suffix;
    }`;

code = code.replace(originalDestructure, newDestructure);

fs.writeFileSync(file, code, 'utf8');
console.log('Saved label duplicate insertion fix applied.');
