const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

// Fix 1: API /api/scan-label (around line 854)
// from: if (dbConnected && dbPool && scanResult.gpon_sn) {
// to: if (dbConnected && dbPool && scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
code = code.replace(
  /if \(\s*dbConnected && dbPool && scanResult\.gpon_sn\s*\) \{/,
  "if (dbConnected && dbPool && scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {"
);

// Fix 2: /api/save-label targetDb search (around line 951)
// from: const checkRes = await tempPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 OR (mac = $2 AND mac <> \\'N/A\\')', [gpon_sn, mac]);
// to: const checkRes = await tempPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE (gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\') OR (mac = $2 AND mac <> \\'N/A\\' AND mac <> \\'NA\\')', [gpon_sn, mac]);
code = code.replace(
  /const checkRes = await tempPool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = \$1 OR \(mac = \$2 AND mac <> \\'N\/A\\'\)', \[gpon_sn, mac\]\);/g,
  "const checkRes = await tempPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE (gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\') OR (mac = $2 AND mac <> \\'N/A\\' AND mac <> \\'NA\\')', [gpon_sn, mac]);"
);

// Fix 3: /api/save-label existence check (around line 1006)
// from: const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
// to: const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);
code = code.replace(
  /const checkRes = await pool\.query\('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = \$1', \[gpon_sn\]\);/g,
  "const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);"
);

fs.writeFileSync(file, code, 'utf8');
console.log('Duplicate check logic updated successfully.');
