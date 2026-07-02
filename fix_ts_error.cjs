const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /sanitizedData\[key as keyof ScanData\] = value\.replace\(\/!\/g, 'I'\);/g,
  '(sanitizedData as any)[key] = value.replace(/!/g, \'I\');'
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx typescript error fixed.');
