const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const targetBlock = `    let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
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
      }

      // Se for para sobrescrever, usamos um UPDATE
      const updateQuery = \`
        UPDATE etiquetas_scan_onu 
        SET 
          fabricante = $1,
          modelo = $2,
          cpe_sn = $3,
          mac = $4,
          wifi_ssid = $5,
          wifi_ssid_5g = $6,
          wifi_key = $7,
          usuario = $8,
          web_key = $9,
          operador_email = $10,
          imagem_url = COALESCE($12, imagem_url),
          data_leitura = CURRENT_TIMESTAMP
        WHERE gpon_sn = $11
      \`;
      const updateValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        cpe_sn || 'N/A',
        mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        gpon_sn,
        zplUrl || imagem_url || null
      ];
      await pool.query(updateQuery, updateValues);
      console.log(\`Dados atualizados com sucesso no banco \${chosenDb}. Serial GPON: \${gpon_sn}\`);
    } else {
      const insertQuery = \`
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email, imagem_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      \`;
      const insertValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        cpe_sn || 'N/A',
        gpon_sn || 'N/A',
        mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        zplUrl || imagem_url || null
      ];
      await pool.query(insertQuery, insertValues);
      console.log(\`Dados salvos com sucesso no banco \${chosenDb}. Serial GPON: \${gpon_sn}\`);
    }`;

const newBlock = `    let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }

    const exists = checkRes.rowCount && checkRes.rowCount > 0;
    
    // NOVO: Lógica de reconciliação (IA -> Planilha)
    let reconciledGpon = null;
    let reconciledMac = null;
    let reconciledCpe = null;
    if (!exists && isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      let macSuffix = null;
      const match = wifi_ssid.match(/([0-9a-fA-F]{4})(?:_2G|_5G)?$/i);
      if (match) {
        macSuffix = match[1].toUpperCase();
      } else {
        const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '');
        if (cleanSsid.length >= 4) {
          macSuffix = cleanSsid.slice(-4).toUpperCase();
        }
      }

      if (macSuffix) {
        const orphanRes = await pool.query(
          "SELECT gpon_sn, mac, cpe_sn FROM etiquetas_scan_onu WHERE (modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND UPPER(mac) LIKE '%' || $1 AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          reconciledGpon = orphanRes.rows[0].gpon_sn;
          reconciledMac = orphanRes.rows[0].mac;
          reconciledCpe = orphanRes.rows[0].cpe_sn;
        }
      }
    }

    if (exists || reconciledGpon) {
      if (exists && !overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: \`Equipamento com este \${duplicateType} já existe no banco de dados.\`
        });
      }

      const targetGpon = reconciledGpon || gpon_sn;
      
      const updateQuery = \`
        UPDATE etiquetas_scan_onu 
        SET 
          fabricante = $1,
          modelo = $2,
          cpe_sn = COALESCE(NULLIF($3, 'N/A'), cpe_sn),
          mac = COALESCE(NULLIF($4, 'N/A'), mac),
          wifi_ssid = $5,
          wifi_ssid_5g = $6,
          wifi_key = $7,
          usuario = $8,
          web_key = $9,
          operador_email = $10,
          imagem_url = COALESCE($12, imagem_url),
          data_leitura = CURRENT_TIMESTAMP
        WHERE gpon_sn = $11
      \`;
      const updateValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        reconciledCpe || cpe_sn || 'N/A',
        reconciledMac || mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        targetGpon,
        zplUrl || imagem_url || null
      ];
      await pool.query(updateQuery, updateValues);
      console.log(\`Dados atualizados/reconciliados com sucesso no banco \${chosenDb}. GPON alvo: \${targetGpon}\`);
    } else {
      const insertQuery = \`
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email, imagem_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      \`;
      const insertValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        cpe_sn || 'N/A',
        gpon_sn || 'N/A',
        mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        zplUrl || imagem_url || null
      ];
      await pool.query(insertQuery, insertValues);
      console.log(\`Dados salvos com sucesso no banco \${chosenDb}. Serial GPON: \${gpon_sn}\`);
    }`;

if (code.includes(targetBlock)) {
  code = code.replace(targetBlock, newBlock);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update save-label complete.');
} else {
  console.log('Target block not found in save-label.');
}
