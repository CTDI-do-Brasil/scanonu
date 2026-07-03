const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    while ((match = regex.exec(zpl)) !== null) {
      const varName = match[1].trim();
      if (!detectedVariables.includes(varName)) {
        detectedVariables.push(varName);
      }
    }`;

const replacement = `    while ((match = regex.exec(zpl)) !== null) {
      const varName = match[1].trim();
      if (varName.endsWith('_clean')) {
        continue;
      }
      if (!detectedVariables.includes(varName)) {
        detectedVariables.push(varName);
      }
    }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target handleZplChange loop not found');
}
