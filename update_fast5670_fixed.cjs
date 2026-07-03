const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Update save-label random GPON SN block
const block1Regex = /    \/\/ Gerar um GPON SN.*?\n    if \(!gpon_sn.*?\) \{\n      const suffix.*?\n      gpon_sn = 'N\/A_' \+ suffix;\n    \}/s;

const block1Replacement = `    const normalizedModelo = normalizeModel(modelo, fabricante);
    const isFast5670 = normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';

    // Gerar um GPON SN unico se vier como N/A apenas para F@ST 5670
    if (isFast5670 && (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA')) {
      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
      gpon_sn = 'N/A_' + suffix;
    } else if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
      gpon_sn = 'N/A';
    }`;

code = code.replace(block1Regex, block1Replacement);

// 2. Remove the duplicated normalizedModelo definition
const block2Regex = /    const resolvedWebKey = senha !== undefined \? senha : web_key;\n    const normalizedModelo = normalizeModel\(modelo, fabricante\);/s;
const block2Replacement = `    const resolvedWebKey = senha !== undefined ? senha : web_key;`;
code = code.replace(block2Regex, block2Replacement);

// 3. Update save-label duplicate verification block
const block3Regex = /    if \(gpon_sn && !gpon_sn\.startsWith\('N\/A_'\)\) \{\n      checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = \$1 AND gpon_sn <> \\'N\/A\\' AND gpon_sn <> \\'NA\\'', \[gpon_sn\]\);\n    \} else if \(wifi_ssid && wifi_ssid\.toUpperCase\(\) !== 'N\/A' && wifi_ssid\.toUpperCase\(\) !== 'NA'\) \{\n      checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = \$1', \[wifi_ssid\]\);\n      duplicateType = 'SSID da Rede \(pois não há GPON na etiqueta\)';\n    \}/s;

const block3Replacement = `    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }`;
code = code.replace(block3Regex, block3Replacement);

// 4. Update scan-label duplicate verification block
const block4Regex = /    if \(dbConnected && dbPool && scanResult\.gpon_sn && scanResult\.gpon_sn\.toUpperCase\(\) !== 'N\/A' && scanResult\.gpon_sn\.toUpperCase\(\) !== 'NA'\) \{\n      try \{\n        const checkRes = await dbPool\.query\(\n          'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = \$1',\n          \[scanResult\.gpon_sn\]\n        \);\n        if \(checkRes\.rowCount && checkRes\.rowCount > 0\) \{\n          existsInDb = true;\n          existingData = checkRes\.rows\[0\];\n        \}\n      \} catch \(dbErr\) \{\n        console\.error\('Erro ao verificar duplicidade no scan-label:', dbErr\);\n      \}\n    \}/s;

const block4Replacement = `    if (dbConnected && dbPool) {
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
code = code.replace(block4Regex, block4Replacement);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update complete.');
