const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `  const diff = macVal - ssidVal;
  // Permite uma margem de offset de até 15 hex (ex: 5477 - 5470 = 7)
  return diff >= 0 && diff <= 15;`;

const replacement = `  const diff = macVal - ssidVal;
  // Permite uma margem de offset de até 15 hex em qualquer direção (positivo ou negativo)
  return Math.abs(diff) <= 15;`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target diff bounds checking not found');
}
