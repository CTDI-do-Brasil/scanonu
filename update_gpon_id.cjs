const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target1 = "['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial', 'CUSN']";
const target2 = "['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'GPON ID', 'Serial', 'S/N', 'serial', 'CUSN']";

// Using split and join to replace all occurrences
if (code.includes(target1)) {
  code = code.split(target1).join(target2);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update complete.');
} else {
  console.log('Target string not found.');
}
