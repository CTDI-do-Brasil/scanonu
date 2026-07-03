const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Define normalizeFabricante above normalizeModel
const normalizeModelDef = `function normalizeModel(modelo: string, fabricante: string): string {`;
const normalizeFabricanteDef = `function normalizeFabricante(fabricante: string, modelo: string): string {
  const modelUpper = (modelo || '').toUpperCase().trim();
  if (modelUpper.includes('FGA2232TIB')) {
    return 'VANTIVA';
  }
  return fabricante || 'N/A';
}

function normalizeModel(modelo: string, fabricante: string): string {`;

if (code.includes(normalizeModelDef)) {
  code = code.replace(normalizeModelDef, normalizeFabricanteDef);
}

// Update /api/save-label to call normalizeFabricante
const saveLabelTarget = `    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    const normalizedModelo = normalizeModel(modelo, fabricante);`;
const saveLabelReplacement = `    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    fabricante = normalizeFabricante(fabricante, modelo);
    const normalizedModelo = normalizeModel(modelo, fabricante);`;

if (code.includes(saveLabelTarget)) {
  code = code.replace(saveLabelTarget, saveLabelReplacement);
}

// Update /api/admin/parse-excel parsing order and normalize fabricante
const parseExcelTarget = `        const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
        const fabricante = fabricanteRaw || 'N/A';
  
        const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']);
        const modelo = modeloRaw || 'N/A';`;

const parseExcelReplacement = `        const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']);
        const modelo = modeloRaw || 'N/A';
  
        const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
        const fabricante = normalizeFabricante(fabricanteRaw || 'N/A', modelo);`;

if (code.includes(parseExcelTarget)) {
  code = code.replace(parseExcelTarget, parseExcelReplacement);
  console.log('Main parse-excel updated');
} else {
  // Let's check with looser matching or regex
  console.log('Target for parse-excel not found exactly');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update complete');
