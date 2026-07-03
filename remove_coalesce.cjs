const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Loose regex replacement to find the UPDATE query inside save-label
const regex = /const\s*updateQuery\s*=\s*`\s*UPDATE\s+etiquetas_scan_onu\s+SET\s+fabricante\s*=\s*\$1,\s*modelo\s*=\s*\$2,\s*cpe_sn\s*=\s*COALESCE\(NULLIF\(\$3,\s*'N\/A'\),\s*cpe_sn\),\s*mac\s*=\s*COALESCE\(NULLIF\(\$4,\s*'N\/A'\),\s*mac\),/gi;

const replacement = `const updateQuery = \`
          UPDATE etiquetas_scan_onu 
          SET 
            fabricante = $1,
            modelo = $2,
            cpe_sn = $3,
            mac = $4,`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  // Let's search with normal string replacement just in case
  const target = `        const updateQuery = \`
          UPDATE etiquetas_scan_onu 
          SET 
            fabricante = $1,
            modelo = $2,
            cpe_sn = COALESCE(NULLIF($3, 'N/A'), cpe_sn),
            mac = COALESCE(NULLIF($4, 'N/A'), mac),`;

  if (code.includes(target)) {
    code = code.replace(target, `        const updateQuery = \`
          UPDATE etiquetas_scan_onu 
          SET 
            fabricante = $1,
            modelo = $2,
            cpe_sn = $3,
            mac = $4,`);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Update backend server.ts via exact string complete');
  } else {
    console.log('Target UPDATE query not found in server.ts');
  }
}
