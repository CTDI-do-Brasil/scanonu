const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add handleZplChange above handleSaveIptvModel with proper TS types
const targetFunc = `  const handleSaveIptvModel = async (e: React.FormEvent) => {`;
const replacementFunc = `  const handleZplChange = (zpl: string) => {
    // Extrair todas as variáveis do tipo \${variavel}
    const regex = /\\\$\{([^}]+)\}/g;
    let match;
    const detectedVariables: string[] = [];
    while ((match = regex.exec(zpl)) !== null) {
      const varName = match[1].trim();
      if (!detectedVariables.includes(varName)) {
        detectedVariables.push(varName);
      }
    }

    // Tentar fazer parse do JSON atual
    let currentConfig: any = {};
    try {
      currentConfig = JSON.parse(iptvModelForm.campos_config);
    } catch (e) {
      currentConfig = {};
    }

    // Montar nova configuração preservando configurações existentes
    const newConfig: any = {};
    detectedVariables.forEach(v => {
      if (currentConfig[v]) {
        newConfig[v] = currentConfig[v];
      } else {
        const lower = v.toLowerCase();
        if (lower === 'sn' || lower === 'serial' || lower === 'cpe_sn' || lower === 'gpon_sn') {
          newConfig[v] = { label: 'S/N:', minLength: 15, maxLength: 15 };
        } else if (lower === 'mac') {
          newConfig[v] = { label: 'MAC ETHERNET:', minLength: 17, maxLength: 17 };
        } else {
          newConfig[v] = { label: \`\${v.toUpperCase()}:\`, minLength: 0, maxLength: 50 };
        }
      }
    });

    setIptvModelForm({
      ...iptvModelForm,
      codigo_zpl: zpl,
      campos_config: JSON.stringify(newConfig, null, 2)
    });
  };

  const handleSaveIptvModel = async (e: React.FormEvent) => {`;

if (code.includes(targetFunc)) {
  code = code.replace(targetFunc, replacementFunc);
}

// 2. Replace ZPL textarea onChange handler
const targetTextarea = `                  value={iptvModelForm.codigo_zpl}
                  onChange={(e) => setIptvModelForm({...iptvModelForm, codigo_zpl: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono text-xs focus:border-[#003865] focus:ring-0 transition-colors"`;

const replacementTextarea = `                  value={iptvModelForm.codigo_zpl}
                  onChange={(e) => handleZplChange(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono text-xs focus:border-[#003865] focus:ring-0 transition-colors"`;

if (code.includes(targetTextarea)) {
  code = code.replace(targetTextarea, replacementTextarea);
  console.log('Update App.tsx complete');
} else {
  // Try loose newline matching
  const normTarget = targetTextarea.replace(/\r?\n/g, '\n');
  const normCode = code.replace(/\r?\n/g, '\n');
  if (normCode.includes(normTarget)) {
    code = normCode.replace(normTarget, replacementTextarea.replace(/\r?\n/g, '\n'));
    console.log('Update App.tsx with normalized newlines complete');
  } else {
    console.log('Target textarea not found');
  }
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update complete');
