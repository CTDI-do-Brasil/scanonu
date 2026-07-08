const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `          const endpoints = [
            'http://localhost:9100',
            'http://127.0.0.1:9100',`;

const replacement = `          const endpoints = [
            'http://localhost:9105', // PNA Proxy
            'http://localhost:9100',
            'http://127.0.0.1:9100',`;

if (appCode.includes(target)) {
  appCode = appCode.replace(target, replacement);
  fs.writeFileSync(appPath, appCode, 'utf8');
  console.log('Update App.tsx to include proxy endpoint complete');
} else {
  console.log('Target endpoints block not found in App.tsx');
}
