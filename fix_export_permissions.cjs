const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// Replace XML export route role check
const xmlTarget = `    if (req.user.role !== 'master' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar o banco.' });
    }`;

const xmlReplacement = `    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar o banco.' });
    }`;

// Replace Excel export route role check
const excelTarget = `    if (req.user.role !== 'master' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar a planilha.' });
    }`;

const excelReplacement = `    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar a planilha.' });
    }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normXmlTarget = xmlTarget.replace(/\r?\n/g, '\n');
const normExcelTarget = excelTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normXmlTarget) && normCode.includes(normExcelTarget)) {
  let updatedCode = normCode.replace(normXmlTarget, xmlReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normExcelTarget, excelReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target permission blocks not found');
}
