const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const targetGetVal = `    const getVal = (row: any, keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }
      return '';
    };`;

const newGetVal = `    const getVal = (row: any, keys: string[]) => {
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const matchingKey = rowKeys.find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
        if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) {
          return String(row[matchingKey]).trim();
        }
      }
      return '';
    };`;

if (code.includes(targetGetVal)) {
  code = code.split(targetGetVal).join(newGetVal);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update robust getVal complete.');
} else {
  // try replacing line by line just in case indentation differs
  const oldValPattern = /const getVal = \(row: any, keys: string\[\]\) => \{\s*for \(const k of keys\) \{\s*if \(row\[k\] !== undefined && row\[k\] !== null\) \{\s*return String\(row\[k\]\)\.trim\(\);\s*\}\s*\}\s*return '';\s*\};/g;
  
  if(oldValPattern.test(code)){
    code = code.replace(oldValPattern, newGetVal);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Regex update robust getVal complete.');
  } else {
     console.log('Could not find getVal function block to replace.');
  }
}
