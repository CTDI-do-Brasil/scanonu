const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `                {Object.entries(selectedModel.campos_config || {}).map(([key, config]: [string, any]) => (
                  <div key={key}>`;

const replacement = `                {Object.entries(selectedModel.campos_config || {}).filter(([key]) => !key.endsWith('_clean')).map(([key, config]: [string, any]) => (
                  <div key={key}>`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target print fields mapping not found');
}
