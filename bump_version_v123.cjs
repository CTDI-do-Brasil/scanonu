const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

appCode = appCode.replace('v1.2.2', 'v1.2.3');
fs.writeFileSync(appPath, appCode, 'utf8');
console.log('Update App.tsx version to v1.2.3 complete');
