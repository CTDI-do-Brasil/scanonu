const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 2. save-label: Duplicate check block
const start2 = code.indexOf("let checkRes: any = { rowCount: 0 };");
const end2Part = "duplicateType = 'SSID da Rede (pois n";
const end2Idx = code.indexOf(end2Part);
if (start2 > -1 && end2Idx > -1) {
    const end2Total = code.indexOf("}", end2Idx) + 1;
    code = code.substring(0, start2) + `let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }` + code.substring(end2Total);
    console.log("Replaced 2");
}

// 3. scan-label: Duplicate check block
const start3 = code.indexOf("// VERIFICA");
const end3Part = "no scan-label:', dbErr);\n      }\n    }";
const end3Idx = code.indexOf(end3Part);
if (start3 > -1 && end3Idx > -1) {
    const end3Total = end3Idx + end3Part.length;
    code = code.substring(0, start3) + `// VERIFICAÇÃO DE DUPLICIDADE: verifica se o GPON_SN já existe no banco de dados
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
    }` + code.substring(end3Total);
    console.log("Replaced 3");
}

fs.writeFileSync(filePath, code, 'utf8');
