const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `          const endpoints = [
            'https://localhost:9102',
            'https://127.0.0.1.local.zebra.com:9102',
            'http://localhost:9101'
          ];`;

const replacement = `          const endpoints = [
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
  console.log('Update App.tsx complete');
} else {
  console.log('Target endpoints block not found in App.tsx');
}
