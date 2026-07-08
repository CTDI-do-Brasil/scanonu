const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `          const endpoints = [
            'https://localhost:9101',
            'https://127.0.0.1.local.zebra.com:9101',
            'https://localhost:9102',
            'https://127.0.0.1.local.zebra.com:9102'
          ];`;

const replacement = `          const endpoints = [
            'http://localhost:9100',
            'http://127.0.0.1:9100',
            'https://localhost:9101',
            'https://127.0.0.1.local.zebra.com:9101',
            'https://localhost:9102',
            'https://127.0.0.1.local.zebra.com:9102'
          ];`;

const normAppCode = appCode.replace(/\r?\n/g, '\n');
const cleanTarget = target.replace(/\r?\n/g, '\n');
const cleanReplacement = replacement.replace(/\r?\n/g, '\n');

if (normAppCode.includes(cleanTarget)) {
  const updatedAppCode = normAppCode.replace(cleanTarget, cleanReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx to include HTTP 9100 endpoints complete');
} else {
  console.log('Target endpoints block not found in App.tsx');
}
