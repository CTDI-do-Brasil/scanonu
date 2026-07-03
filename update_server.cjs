const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `      if (exists || reconciledGpon) {
        if (exists && !overwrite) {
          return res.status(409).json({
            success: false,
            conflict: true,
            error: \`Equipamento com este \${duplicateType} já existe no banco de dados.\`
          });
        }
  
        const targetGpon = reconciledGpon || gpon_sn;`;

const replacement = `      if (exists || reconciledGpon) {
        if (exists && !overwrite) {
          return res.status(409).json({
            success: false,
            conflict: true,
            error: \`Equipamento com este \${duplicateType} já existe no banco de dados.\`
          });
        }
  
        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update server.ts complete');
} else {
  console.log('Target server.ts not found');
}
