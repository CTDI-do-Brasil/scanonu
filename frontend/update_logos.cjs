const fs = require('fs');
const targetPath = 'C:\\Users\\apongeluppi\\.gemini\\antigravity\\scratch\\scanonu\\frontend\\src\\App.tsx';
let code = fs.readFileSync(targetPath, 'utf8');

// Replace "ScanONU" logo text in public query header
code = code.replace(
  /<span className="font-bold text-lg text-slate-800 tracking-tight">Scan<span className="text-\[#003865\]">ONU<\/span><\/span>/g,
  '<span className="font-extrabold text-lg text-slate-800 tracking-tight">SMART SCAN</span>'
);

fs.writeFileSync(targetPath, code, 'utf8');
console.log('App.tsx updated for SMART SCAN logos.');
