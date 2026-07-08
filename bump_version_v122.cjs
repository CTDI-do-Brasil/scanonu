const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.1`;
const replacement = `{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.2`;

if (appCode.includes(target)) {
  appCode = appCode.replace(target, replacement);
  fs.writeFileSync(appPath, appCode, 'utf8');
  console.log('Update App.tsx version to v1.2.2 complete');
} else {
  console.log('Target version label not found in App.tsx');
}
