const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Using regex to handle newlines (\r?\n)
const parseExcelRegex = /const fabricanteRaw = getVal\(row, \['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand'\]\);\r?\n\s*const fabricante = fabricanteRaw \|\| 'N\/A';\r?\n\s*const modeloRaw = getVal\(row, \['Modelo', 'modelo', 'Model', 'model', 'HOST_PID'\]\);\r?\n\s*const modelo = modeloRaw \|\| 'N\/A';/g;

const parseExcelReplacement = `const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']);
        const modelo = modeloRaw || 'N/A';
        const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
        const fabricante = normalizeFabricante(fabricanteRaw || 'N/A', modelo);`;

if (parseExcelRegex.test(code)) {
  code = code.replace(parseExcelRegex, parseExcelReplacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update parse-excel complete');
} else {
  console.log('Target regex for parse-excel not found');
}
