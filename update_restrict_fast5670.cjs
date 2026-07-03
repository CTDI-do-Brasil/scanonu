const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

// 1. Update save-label random suffix generation
const regexSaveLabelTop = /\/\/ Gerar um GPON SN.*se vier como N\/A para.*violar a UNIQUE constraint[\s\S]*?const normalizedModelo = normalizeModel\(modelo, fabricante\);/;
const replacementSaveLabelTop = `const normalizedModelo = normalizeModel(modelo, fabricante);
    const isFast5670 = normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';

    // Gerar um GPON SN unico se vier como N/A apenas para F@ST 5670
    if (isFast5670 && (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA')) {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
      gpon_sn = 'N/A_' + suffix;
    } else if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      gpon_sn = 'N/A';
    }
    const resolvedWebKey = senha !== undefined ? senha : web_key;`;
if(regexSaveLabelTop.test(code)) {
    code = code.replace(regexSaveLabelTop, replacementSaveLabelTop);
    console.log("save-label random suffix updated");
}

// 2. Update save-label duplicate check
const regexSaveLabelDuplicate = /let checkRes: any = { rowCount: 0 };[\s\S]*?duplicateType = 'SSID da Rede[^']*';[\s\S]*?\}/;
const replacementSaveLabelDuplicate = `let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }`;
if(regexSaveLabelDuplicate.test(code)) {
    code = code.replace(regexSaveLabelDuplicate, replacementSaveLabelDuplicate);
    console.log("save-label duplicate check updated");
}

// 3. Update scan-label duplicate check
const regexScanLabel = /\/\/ VERIFICAÇÃO DE DUPLICIDADE[\s\S]*?if \(dbConnected && dbPool\) \{[\s\S]*?try \{[\s\S]*?let checkRes = \{ rowCount: 0, rows: \[\] as any\[\] \};[\s\S]*?if \(scanResult\.gpon_sn[\s\S]*?\}\) \{[\s\S]*?checkRes = await dbPool\.query\([\s\S]*?\[scanResult\.gpon_sn\][\s\S]*?\);[\s\S]*?\} else if \(scanResult\.wifi_ssid[\s\S]*?\}\) \{[\s\S]*?checkRes = await dbPool\.query\([\s\S]*?\[scanResult\.wifi_ssid\][\s\S]*?\);[\s\S]*?\}[\s\S]*?if \(checkRes\.rowCount && checkRes\.rowCount > 0\) \{[\s\S]*?existsInDb = true;[\s\S]*?existingData = checkRes\.rows\[0\];[\s\S]*?\}[\s\S]*?\} catch \(dbErr\) \{[\s\S]*?console\.error\('Erro ao verificar duplicidade no scan-label:', dbErr\);[\s\S]*?\}[\s\S]*?\}/;
const replacementScanLabel = `// VERIFICAÇÃO DE DUPLICIDADE
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
    }`;
if(regexScanLabel.test(code)) {
    code = code.replace(regexScanLabel, replacementScanLabel);
    console.log("scan-label duplicate check updated");
}

fs.writeFileSync(file, code, 'utf8');
