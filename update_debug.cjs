const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `    const rows = XLSX.utils.sheet_to_json<any>(worksheet);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'A planilha está vazia ou não pôde ser lida.' });
    }

    const getVal = (row: any, keys: string[]) => {`;

const targetFallback = /const rows = XLSX\.utils\.sheet_to_json<any>\(worksheet\);\s*if \(!rows \|\| rows\.length === 0\) \{\s*return res\.status\(400\)\.json\(\{ success: false, error: 'A planilha est\S+ vazia ou n\S+ p\S+de ser lida\.' \}\);\s*\}\s*const getVal = \(row: any, keys: string\[\]\) => \{/g;

const replacement = `    const rows = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'A planilha está vazia ou não pôde ser lida.' });
    }

    console.log('--- DEBUG IMPORT EXCEL ---');
    console.log('Headers encontrados:', Object.keys(rows[0]));
    console.log('Primeira linha:', rows[0]);
    console.log('--------------------------');

    const getVal = (row: any, keys: string[]) => {`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update exact complete');
} else if (targetFallback.test(code)) {
  code = code.replace(targetFallback, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex complete');
} else {
  console.log('Target not found');
}
