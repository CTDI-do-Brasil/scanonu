const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /\/\/ Sagemcom F@ST 5670V2/;
const replacement = `// Sagemcom F@ST 5657 TIM LIVE
  if (
    modelClean.includes('FAST5657') || 
    modelClean.includes('F@ST5657') || 
    (modelClean.includes('5657') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5657'))
  ) {
    return 'F@ST 5657 TIM LIVE';
  }

  // Sagemcom F@ST 5670V2`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update normalizeModel complete');
} else {
  console.log('Target normalizeModel not found');
}
