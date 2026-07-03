const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
    }`;

const replacement = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);

      // Nova variável automatizada: \${campo_clean} (remove dois-pontos e espaços, ideal para código de barras)
      const valClean = val.replace(/[^A-Za-z0-9]/g, '');
      const regexClean = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '_clean\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regexClean, valClean);
    }`;

const normCode = code.replace(/\r?\n/g, '\n');

// Try exact search
const actualTarget = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
    }`.replace(/\r?\n/g, '\n');

const normActualTarget = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
    }`.replace(/\r?\n/g, '\n');

if (normCode.includes(actualTarget)) {
  const updatedCode = normCode.replace(actualTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete (1)');
} else if (normCode.includes(normActualTarget)) {
  const updatedCode = normCode.replace(normActualTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete (2)');
} else {
  // Let's do a simple replace that finds line 1590
  const simpleTarget = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
    }`;

  // Let's print out what the file actually has around there to make matching perfect
  const lines = normCode.split('\n');
  const index = lines.findIndex(l => l.includes('Substituir variáveis no código ZPL'));
  if (index !== -1) {
    const slice = lines.slice(index, index + 8).join('\n');
    console.log('Actual file slice:');
    console.log(slice);
    
    // We will do string replacement on the slice
    const sliceReplacement = `    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \\\${chave\\}
      const regex = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);

      // Nova variável automatizada: \${campo_clean} (remove dois-pontos e espaços, ideal para código de barras)
      const valClean = val.replace(/[^A-Za-z0-9]/g, '');
      const regexClean = new RegExp('\\\\$\\\\\\\{\\\\s*' + key + '_clean\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regexClean, valClean);
    }`;
    
    const finalCode = normCode.replace(slice, sliceReplacement);
    fs.writeFileSync(filePath, finalCode, 'utf8');
    console.log('Update backend server.ts complete via index slice');
  } else {
    console.log('Could not find slice');
  }
}
