const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

const targetStr = `    const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial j\\u01ED existe no banco de dados.'
        });
      }`;

const targetStr2 = `    const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial j existe no banco de dados.'
        });
      }`;

const newStr = `    let checkRes = { rowCount: 0 };
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

if (code.includes(targetStr)) {
  code = code.replace(targetStr, newStr);
  console.log('Replaced targetStr (unicode)');
} else if (code.includes(targetStr2)) {
  code = code.replace(targetStr2, newStr);
  console.log('Replaced targetStr2 (replacement char)');
} else {
  // Regex fallback
  const regex = /const checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = \$1 AND gpon_sn <> \\'N\/A\\' AND gpon_sn <> \\'NA\\'', \[gpon_sn\]\);[\s\S]*?error: 'Equipamento com este GPON Serial[^']*'[\s\S]*?\}\);[\s\S]*?\}/;
  if (regex.test(code)) {
    code = code.replace(regex, newStr);
    console.log('Replaced via regex');
  } else {
    console.log('Target string not found!');
  }
}

fs.writeFileSync(file, code, 'utf8');
