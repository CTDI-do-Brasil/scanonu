const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `        const getMergedValue = (newVal, dbVal) => {`;
const replacement = `        const getMergedValue = (newVal: any, dbVal: any) => {`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target getMergedValue signature not found');
}
