const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">Administrador</p>`;
const replacement = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.0</p>`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target profile description label not found');
}
