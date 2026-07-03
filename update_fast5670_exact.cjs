const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

function replaceBlock(searchStart, searchEnd, newBlock) {
    const startIdx = code.indexOf(searchStart);
    if (startIdx === -1) {
        console.log("Could not find start: " + searchStart.substring(0, 50));
        return;
    }
    const endIdx = code.indexOf(searchEnd, startIdx);
    if (endIdx === -1) {
        console.log("Could not find end: " + searchEnd.substring(0, 50));
        return;
    }
    const endTotal = endIdx + searchEnd.length;
    code = code.substring(0, startIdx) + newBlock + code.substring(endTotal);
    console.log("Successfully replaced block starting with: " + searchStart.substring(0, 50));
}

// 1. save-label: Random suffix block
replaceBlock(
    "if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {",
    "const normalizedModelo = normalizeModel(modelo, fabricante);",
    `const normalizedModelo = normalizeModel(modelo, fabricante);
    const isFast5670 = normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';

    // Gerar um GPON SN unico se vier como N/A apenas para F@ST 5670
    if (isFast5670 && (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA')) {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
      gpon_sn = 'N/A_' + suffix;
    } else if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      gpon_sn = 'N/A';
    }
    const resolvedWebKey = senha !== undefined ? senha : web_key;`
);

// 2. save-label: Duplicate check block
replaceBlock(
    "let checkRes: any = { rowCount: 0 };",
    "duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';\n    }",
    `let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }`
);

// 3. scan-label: Duplicate check block
replaceBlock(
    "// VERIFICA", // Just match up to the if dbConnected
    "console.error('Erro ao verificar duplicidade no scan-label:', dbErr);\n      }\n    }",
    `// VERIFICAÇÃO DE DUPLICIDADE: verifica se o GPON_SN já existe no banco de dados
    let existsInDb = false;
    let existingData = null;

    if (dbConnected && dbPool) {
      try {
        let checkRes = { rowCount: 0, rows: [] as any[] };
        const normModelo = normalizeModel(scanResult.modelo || '', scanResult.fabricante || '');
        const isScanFast5670 = normModelo === 'F@ST 5670' || normModelo === 'F@ST 5670V2';
        
        if (scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
            [scanResult.gpon_sn]
          );
        } else if (isScanFast5670 && scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')',
            [scanResult.wifi_ssid]
          );
        }

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
        }
      } catch (dbErr) {
        console.error('Erro ao verificar duplicidade no scan-label:', dbErr);
      }
    }`
);

fs.writeFileSync(filePath, code, 'utf8');
