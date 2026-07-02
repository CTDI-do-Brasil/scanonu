const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Operator Header
code = code.replace(
  /<div className="max-w-2xl mx-auto w-full flex items-center justify-between">\s*<div className="flex items-center gap-2">\s*<div className="bg-\[#003865\] text-white p-1\.5 rounded-lg">/,
  `<div className="max-w-2xl mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActiveModule('selection')}
                className="text-slate-500 hover:text-[#003865] p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Voltar aos Módulos"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="bg-[#003865] text-white p-1.5 rounded-lg">`
);

// 2. Admin Mobile Header
code = code.replace(
  /<div className="md:hidden flex items-center justify-between bg-white border-b border-slate-200\/60 px-4 py-3 sticky top-0 z-40 w-full">\s*<div className="flex items-center gap-2">\s*<div className="bg-\[#003865\] text-white p-1\.5 rounded-lg">/,
  `<div className="md:hidden flex items-center justify-between bg-white border-b border-slate-200/60 px-4 py-3 sticky top-0 z-40 w-full">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActiveModule('selection')}
                className="text-slate-500 hover:text-[#003865] p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Voltar aos Módulos"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="bg-[#003865] text-white p-1.5 rounded-lg">`
);

// 3. Admin Sidebar (Bottom Profile)
code = code.replace(
  /<div className="flex gap-1">\s*<button\s*onClick=\{openInNewTab\}/,
  `<div className="flex gap-1">
                  <button 
                    onClick={() => setActiveModule('selection')}
                    className="text-blue-200/70 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    title="Voltar aos Módulos"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={openInNewTab}`
);

// Also fix the ScanONU logo in Admin Mobile Header if it's still there
code = code.replace(
  /<span className="font-bold text-lg text-slate-800 tracking-tight">\s*Scan<span className="text-\[#003865\]">ONU<\/span>\s*<\/span>/,
  `<span className="font-extrabold text-lg tracking-tight text-slate-800">SMART SCAN</span>`
);

fs.writeFileSync(file, code, 'utf8');
console.log('Added back buttons to all headers/sidebars in GPON module.');
