const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `        if (result.existsInDb && result.existingData) {
          setData(prevData => {
            const merged = { ...prevData } as any;
            Object.keys(result.existingData).forEach(key => {
              const newVal = (result.existingData as any)[key];
              const oldVal = merged[key];
              if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                merged[key] = newVal;
              } else if (!oldVal || oldVal.toUpperCase() === 'N/A' || oldVal.toUpperCase() === 'NA' || oldVal.trim() === '') {
                merged[key] = oldVal || 'N/A';
              }
            });
            return merged;
          });
          setEquipmentExistsInDb(true);
          setExistingEquipmentData(result.existingData);
          setShowDuplicateModal(true);`;

const replacement = `        if (result.existsInDb && result.existingData) {
          setData(prevData => {
            const merged = { ...prevData } as any;
            
            // 1. Mesclar a captura atual (ex: senhas e SSID capturados pelo Gemini)
            const scanData = result.data || {};
            Object.keys(scanData).forEach(key => {
              const val = scanData[key];
              if (val && val.toUpperCase() !== 'N/A' && val.toUpperCase() !== 'NA' && val.trim() !== '') {
                merged[key] = val;
              }
            });

            // 2. Mesclar os dados existentes no banco (ex: SN/MAC/GPON pre-carregados)
            Object.keys(result.existingData).forEach(key => {
              const newVal = (result.existingData as any)[key];
              if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                merged[key] = newVal;
              }
            });
            
            return applyMacSsidRules(merged);
          });
          setEquipmentExistsInDb(true);
          setExistingEquipmentData(result.existingData);
          setShowDuplicateModal(true);`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target duplicate merge block not found in App.tsx');
}
