const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// ==== PATCH 1: import-excel ====
const targetImportExcel = `      // GPON Serial: Se não vier GPON serial na planilha, geramos um N/A único
      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial', 'CUSN']);
      let gpon_sn = gpon_sn_raw ? gpon_sn_raw.toUpperCase().trim() : '';
      if (!gpon_sn) {
        const suffix = mac !== 'N/A' ? mac : (wifi_ssid !== 'N/A' ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
        gpon_sn = 'N/A_' + suffix;
      }

      try {
        const query = \`
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = EXCLUDED.cpe_sn,
            mac = EXCLUDED.mac,
            wifi_ssid = EXCLUDED.wifi_ssid,
            wifi_ssid_5g = EXCLUDED.wifi_ssid_5g,
            wifi_key = EXCLUDED.wifi_key,
            usuario = EXCLUDED.usuario,
            web_key = EXCLUDED.web_key,
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        \`;
        const values = [
          fabricante,
          normalizedModelo,
          cpe_sn,
          gpon_sn,
          mac,
          wifi_ssid,
          finalWifiSsid5g,
          wifi_key,
          usuario,
          web_key,
          operador_email
        ];`;

const newImportExcel = `      // GPON Serial: Se não vier GPON serial na planilha, geramos um N/A único
      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial', 'CUSN']);
      let gpon_sn = gpon_sn_raw ? gpon_sn_raw.toUpperCase().trim() : '';
      if (!gpon_sn) {
        const suffix = mac !== 'N/A' ? mac : (wifi_ssid !== 'N/A' ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
        gpon_sn = 'N/A_' + suffix;
      }

      // NOVO: Lógica de reconciliação (Planilha -> IA)
      let reconciledWifiSsid = null;
      let reconciledWifiSsid5g = null;
      let reconciledWifiKey = null;
      let reconciledWebKey = null;

      const isFast5670 = normalizedModelo.toUpperCase() === 'F@ST 5670' || normalizedModelo.toUpperCase() === 'F@ST 5670V2';
      if (isFast5670 && mac !== 'N/A' && mac.length >= 4) {
        const macSuffix = mac.slice(-4);
        
        const orphanRes = await pool.query(
          "SELECT gpon_sn, wifi_ssid, wifi_ssid_5g, wifi_key, web_key FROM etiquetas_scan_onu WHERE (modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND UPPER(wifi_ssid) LIKE '%' || $1 || '%' AND (mac = 'N/A' OR mac = 'NA' OR mac IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          const orphanGpon = orphanRes.rows[0].gpon_sn;
          reconciledWifiSsid = orphanRes.rows[0].wifi_ssid;
          reconciledWifiSsid5g = orphanRes.rows[0].wifi_ssid_5g;
          reconciledWifiKey = orphanRes.rows[0].wifi_key;
          reconciledWebKey = orphanRes.rows[0].web_key;
          
          await pool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn = $1", [orphanGpon]);
          console.log(\`Registro órfão \${orphanGpon} deletado para reconciliação com o MAC \${mac}\`);
        }
      }

      try {
        const query = \`
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = COALESCE(NULLIF(EXCLUDED.cpe_sn, 'N/A'), etiquetas_scan_onu.cpe_sn),
            mac = COALESCE(NULLIF(EXCLUDED.mac, 'N/A'), etiquetas_scan_onu.mac),
            wifi_ssid = COALESCE(NULLIF(EXCLUDED.wifi_ssid, 'N/A'), etiquetas_scan_onu.wifi_ssid),
            wifi_ssid_5g = COALESCE(NULLIF(EXCLUDED.wifi_ssid_5g, 'N/A'), etiquetas_scan_onu.wifi_ssid_5g),
            wifi_key = COALESCE(NULLIF(EXCLUDED.wifi_key, 'N/A'), etiquetas_scan_onu.wifi_key),
            usuario = COALESCE(NULLIF(EXCLUDED.usuario, 'N/A'), etiquetas_scan_onu.usuario),
            web_key = COALESCE(NULLIF(EXCLUDED.web_key, 'N/A'), etiquetas_scan_onu.web_key),
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        \`;
        const values = [
          fabricante,
          normalizedModelo,
          cpe_sn,
          gpon_sn,
          mac,
          reconciledWifiSsid || wifi_ssid,
          reconciledWifiSsid5g || finalWifiSsid5g,
          reconciledWifiKey || wifi_key,
          usuario,
          reconciledWebKey || web_key,
          operador_email
        ];`;


// ==== PATCH 2: import-excel-batch ====
const targetImportBatch = `    for (const row of rows) {
      try {
        const query = \`
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = EXCLUDED.cpe_sn,
            mac = EXCLUDED.mac,
            wifi_ssid = EXCLUDED.wifi_ssid,
            wifi_ssid_5g = EXCLUDED.wifi_ssid_5g,
            wifi_key = EXCLUDED.wifi_key,
            usuario = EXCLUDED.usuario,
            web_key = EXCLUDED.web_key,
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        \`;
        const values = [
          row.fabricante || 'N/A',
          row.modelo || 'N/A',
          row.cpe_sn || 'N/A',
          row.gpon_sn,
          row.mac || 'N/A',
          row.wifi_ssid || 'N/A',
          row.wifi_ssid_5g || 'N/A',
          row.wifi_key || 'N/A',
          row.usuario || 'N/A',
          row.web_key || 'N/A',
          operatorEmail
        ];`;

const newImportBatch = `    for (const row of rows) {
      let reconciledWifiSsid = null;
      let reconciledWifiSsid5g = null;
      let reconciledWifiKey = null;
      let reconciledWebKey = null;
      
      const normalizedModelo = row.modelo || 'N/A';
      const mac = row.mac || 'N/A';
      
      const isFast5670 = normalizedModelo.toUpperCase() === 'F@ST 5670' || normalizedModelo.toUpperCase() === 'F@ST 5670V2';
      if (isFast5670 && mac !== 'N/A' && mac.length >= 4) {
        const macSuffix = mac.slice(-4);
        
        const orphanRes = await pool.query(
          "SELECT gpon_sn, wifi_ssid, wifi_ssid_5g, wifi_key, web_key FROM etiquetas_scan_onu WHERE (modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND UPPER(wifi_ssid) LIKE '%' || $1 || '%' AND (mac = 'N/A' OR mac = 'NA' OR mac IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          const orphanGpon = orphanRes.rows[0].gpon_sn;
          reconciledWifiSsid = orphanRes.rows[0].wifi_ssid;
          reconciledWifiSsid5g = orphanRes.rows[0].wifi_ssid_5g;
          reconciledWifiKey = orphanRes.rows[0].wifi_key;
          reconciledWebKey = orphanRes.rows[0].web_key;
          
          await pool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn = $1", [orphanGpon]);
          console.log(\`Registro órfão \${orphanGpon} deletado para reconciliação com o MAC \${mac}\`);
        }
      }

      try {
        const query = \`
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = COALESCE(NULLIF(EXCLUDED.cpe_sn, 'N/A'), etiquetas_scan_onu.cpe_sn),
            mac = COALESCE(NULLIF(EXCLUDED.mac, 'N/A'), etiquetas_scan_onu.mac),
            wifi_ssid = COALESCE(NULLIF(EXCLUDED.wifi_ssid, 'N/A'), etiquetas_scan_onu.wifi_ssid),
            wifi_ssid_5g = COALESCE(NULLIF(EXCLUDED.wifi_ssid_5g, 'N/A'), etiquetas_scan_onu.wifi_ssid_5g),
            wifi_key = COALESCE(NULLIF(EXCLUDED.wifi_key, 'N/A'), etiquetas_scan_onu.wifi_key),
            usuario = COALESCE(NULLIF(EXCLUDED.usuario, 'N/A'), etiquetas_scan_onu.usuario),
            web_key = COALESCE(NULLIF(EXCLUDED.web_key, 'N/A'), etiquetas_scan_onu.web_key),
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        \`;
        const values = [
          row.fabricante || 'N/A',
          row.modelo || 'N/A',
          row.cpe_sn || 'N/A',
          row.gpon_sn,
          row.mac || 'N/A',
          reconciledWifiSsid || row.wifi_ssid || 'N/A',
          reconciledWifiSsid5g || row.wifi_ssid_5g || 'N/A',
          reconciledWifiKey || row.wifi_key || 'N/A',
          row.usuario || 'N/A',
          reconciledWebKey || row.web_key || 'N/A',
          operatorEmail
        ];`;


if (code.includes(targetImportExcel)) {
  code = code.replace(targetImportExcel, newImportExcel);
  console.log('Update import-excel complete.');
} else {
  console.log('Target block not found in import-excel.');
}

if (code.includes(targetImportBatch)) {
  code = code.replace(targetImportBatch, newImportBatch);
  console.log('Update import-excel-batch complete.');
} else {
  console.log('Target block not found in import-excel-batch.');
}

fs.writeFileSync(filePath, code, 'utf8');
