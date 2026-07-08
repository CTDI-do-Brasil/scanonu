const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace /default with /available for the discovery loop so it triggers the Zebra popup
const target = `const res = await fetch(\`\${url}/default\`, { method: 'GET' });`;
const replacement = `const res = await fetch(\`\${url}/available\`, { method: 'GET' });`;

if (appCode.includes(target)) {
  appCode = appCode.replace(target, replacement);
  fs.writeFileSync(appPath, appCode, 'utf8');
  console.log('Update App.tsx to use /available endpoint complete');
} else {
  console.log('Target /default fetch not found in App.tsx');
}
