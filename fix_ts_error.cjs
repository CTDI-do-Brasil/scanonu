const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

appCode = appCode.replace('e.message', '(e as Error).message');
fs.writeFileSync(appPath, appCode, 'utf8');
console.log('Update App.tsx catch e as Error complete');
