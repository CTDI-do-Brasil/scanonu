const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

// Modificação 1: scan-label
const scanLabelOriginal = `    if (dbConnected && dbPool && scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
      try {
        const checkRes = await dbPool.query(
          'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
          [scanResult.gpon_sn]
        );
        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
        }
      } catch (dbErr) {
        console.error('Erro ao verificar duplicidade no scan-label:', dbErr);
      }
    }`;

const scanLabelNew = `    if (dbConnected && dbPool) {
      try {
        let checkRes = { rowCount: 0, rows: [] as any[] };
        if (scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
            [scanResult.gpon_sn]
          );
        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
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

code = code.replace(scanLabelOriginal, scanLabelNew);

// Modificação 2: save-label
const saveLabelOriginal = `    const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial já existe no banco de dados.'
        });
      }`;

const saveLabelNew = `    let checkRes = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_')) {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }

    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: \`Equipamento com este \${duplicateType} já existe no banco de dados.\`
        });
      }`;

code = code.replace(saveLabelOriginal, saveLabelNew);

fs.writeFileSync(file, code, 'utf8');
console.log('Duplicate by SSID logic applied.');
