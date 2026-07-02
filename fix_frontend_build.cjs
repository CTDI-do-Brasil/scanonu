const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Fix Duplicate Trash2 import
code = code.replace(
  /, MonitorPlay, Edit, Trash2, Plus } from 'lucide-react';/,
  ', MonitorPlay, Edit, Plus } from \'lucide-react\';'
);

// 2. Fix variable interpolation error in JSX
code = code.replace(
  /<code>\$\{sn\}<\/code>, <code>\$\{mac\}<\/code>/g,
  '<code>{"$"+"{sn}"}</code>, <code>{"$"+"{mac}"}</code>'
);
code = code.replace(
  /placeholder="\^XA...\^FD\$\{sn\}\^FS...\^XZ"/g,
  'placeholder="^XA...^FD${sn}^FS...^XZ"'
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx build errors fixed.');
