const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
    }`;

const replacement = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);

      // Nova variável automatizada: \${campo_clean} (remove dois-pontos e espaços, ideal para código de barras)
      const valClean = val.replace(/[^A-Za-z0-9]/g, '');
      const regexClean = new RegExp('\\\\\\$\\\\\\\{\\\\s*' + key + '_clean\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regexClean, valClean);
    }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target block for print clean variables not found');
}
