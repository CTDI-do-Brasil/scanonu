const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    const timer = setTimeout(() => {
      let tempZpl = selectedModel.codigo_zpl;
      Object.keys(selectedModel.campos_config || {}).forEach((key) => {`;

const replacement = `    const timer = setTimeout(() => {
      let tempZpl = selectedModel.codigo_zpl;
      
      // Remover dados gráficos pesados para evitar erro 414 (URL Too Large) no Labelary
      tempZpl = tempZpl.replace(/\\^GF[^~^]*/gi, '');

      Object.keys(selectedModel.campos_config || {}).forEach((key) => {`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target ZPL replacement timer not found');
}
