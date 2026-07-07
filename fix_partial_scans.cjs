const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    if (exists || reconciledGpon) {
        if (exists) {
          const dbRow = checkRes.rows[0];
          const fieldsChanged = 
            (fabricante || 'N/A').toUpperCase() !== (dbRow.fabricante || 'N/A').toUpperCase() ||
            (normalizedModelo || 'N/A').toUpperCase() !== (dbRow.modelo || 'N/A').toUpperCase() ||
            (cpe_sn || 'N/A').toUpperCase() !== (dbRow.cpe_sn || 'N/A').toUpperCase() ||
            (mac || 'N/A').toUpperCase() !== (dbRow.mac || 'N/A').toUpperCase() ||
            (wifi_ssid || 'N/A').toUpperCase() !== (dbRow.wifi_ssid || 'N/A').toUpperCase() ||
            (resolvedWifiSsid5g || 'N/A').toUpperCase() !== (dbRow.wifi_ssid_5g || 'N/A').toUpperCase() ||
            (wifi_key || 'N/A') !== (dbRow.wifi_key || 'N/A') ||
            (usuario || 'N/A') !== (dbRow.usuario || 'N/A') ||
            (resolvedWebKey || 'N/A') !== (dbRow.web_key || 'N/A');

          if (!fieldsChanged) {
            return res.json({
              success: true,
              message: 'Dados identicos, nada foi alterado.'
            });
          }
        }

        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);

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
          reconciledModelo || normalizedModelo || 'N/A',
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
      ];`;

const replacement = `    if (exists || reconciledGpon) {
        const dbRow = exists ? checkRes.rows[0] : null;

        // Função auxiliar para fundir dados da nova captura com os dados existentes do banco
        // Evita que campos válidos já preenchidos no banco sejam apagados com "N/A" ou vazio
        const getMergedValue = (newVal, dbVal) => {
          if (!newVal || newVal.toUpperCase() === 'N/A' || newVal.toUpperCase() === 'NA' || newVal.trim() === '') {
            return dbVal || 'N/A';
          }
          return newVal;
        };

        const finalFabricante = getMergedValue(fabricante, dbRow?.fabricante);
        const finalModelo = getMergedValue(reconciledModelo || normalizedModelo, dbRow?.modelo);
        const finalCpe = getMergedValue(reconciledCpe || cpe_sn, dbRow?.cpe_sn);
        const finalMac = getMergedValue(reconciledMac || mac, dbRow?.mac);
        const finalSsid = getMergedValue(wifi_ssid, dbRow?.wifi_ssid);
        const finalSsid5g = getMergedValue(resolvedWifiSsid5g, dbRow?.wifi_ssid_5g);
        const finalWifiKey = getMergedValue(wifi_key, dbRow?.wifi_key);
        const finalUsuario = getMergedValue(usuario, dbRow?.usuario);
        const finalWebKey = getMergedValue(resolvedWebKey, dbRow?.web_key);

        if (exists) {
          const fieldsChanged = 
            finalFabricante.toUpperCase() !== (dbRow.fabricante || 'N/A').toUpperCase() ||
            finalModelo.toUpperCase() !== (dbRow.modelo || 'N/A').toUpperCase() ||
            finalCpe.toUpperCase() !== (dbRow.cpe_sn || 'N/A').toUpperCase() ||
            finalMac.toUpperCase() !== (dbRow.mac || 'N/A').toUpperCase() ||
            finalSsid.toUpperCase() !== (dbRow.wifi_ssid || 'N/A').toUpperCase() ||
            (finalSsid5g || 'N/A').toUpperCase() !== (dbRow.wifi_ssid_5g || 'N/A').toUpperCase() ||
            finalWifiKey !== (dbRow.wifi_key || 'N/A') ||
            finalUsuario !== (dbRow.usuario || 'N/A') ||
            finalWebKey !== (dbRow.web_key || 'N/A');

          if (!fieldsChanged) {
            return res.json({
              success: true,
              message: 'Dados identicos, nada foi alterado.'
            });
          }
        }

        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);

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
        finalFabricante,
        finalModelo,
        finalCpe,
        finalMac,
        finalSsid,
        finalSsid5g,
        finalWifiKey,
        finalUsuario,
        finalWebKey,
        operador || 'sistema',
        targetGpon,
        zplUrl || imagem_url || null
      ];`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target update block for partial scans not found');
}
