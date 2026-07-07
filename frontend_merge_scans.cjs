const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Replace the local barcode detection setData block to merge instead of overwrite
const localTarget = `              if (dbResult.success && dbResult.data) {
                console.log('Equipamento encontrado no banco localmente (0 tokens gastos!).');
                setData(dbResult.data);`;

const localReplacement = `              if (dbResult.success && dbResult.data) {
                console.log('Equipamento encontrado no banco localmente (0 tokens gastos!).');
                setData(prevData => {
                  const merged = { ...prevData };
                  Object.keys(dbResult.data).forEach(key => {
                    const newVal = dbResult.data[key];
                    const oldVal = merged[key];
                    if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                      merged[key] = newVal;
                    } else if (!oldVal || oldVal.toUpperCase() === 'N/A' || oldVal.toUpperCase() === 'NA' || oldVal.trim() === '') {
                      merged[key] = oldVal || 'N/A';
                    }
                  });
                  return merged;
                });`;

// 2. Replace the Gemini vision scan-label setData block to merge instead of overwrite
const geminiTarget = `          if (result.existsInDb && result.existingData) {
            setData(result.existingData);
            setEquipmentExistsInDb(true);
            setExistingEquipmentData(result.existingData);
            setShowDuplicateModal(true);
          } else {
            setData(applyMacSsidRules(result.data));
          }`;

const geminiReplacement = `          if (result.existsInDb && result.existingData) {
            setData(prevData => {
              const merged = { ...prevData };
              Object.keys(result.existingData).forEach(key => {
                const newVal = result.existingData[key];
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
            setShowDuplicateModal(true);
          } else {
            setData(prevData => {
              const merged = { ...prevData };
              Object.keys(result.data).forEach(key => {
                const newVal = result.data[key];
                const oldVal = merged[key];
                if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                  merged[key] = newVal;
                } else if (!oldVal || oldVal.toUpperCase() === 'N/A' || oldVal.toUpperCase() === 'NA' || oldVal.trim() === '') {
                  merged[key] = oldVal || 'N/A';
                }
              });
              return applyMacSsidRules(merged);
            });
          }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normLocalTarget = localTarget.replace(/\r?\n/g, '\n');
const normGeminiTarget = geminiTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normLocalTarget) && normCode.includes(normGeminiTarget)) {
  let updatedCode = normCode.replace(normLocalTarget, localReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normGeminiTarget, geminiReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target scan result handlers not found in App.tsx');
}
