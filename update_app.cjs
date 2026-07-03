const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `                            if (result.success) {
                              setDbMessage({ type: 'success', text: result.message || 'Salvo no PostgreSQL!' });
                              // Limpar as informações do estado
                              setData(DEFAULT_SCAN_DATA);
                              setCapturedImage(null);
                              setEquipmentExistsInDb(false);
                              setShowDuplicateModal(false);
                            } else {
                              throw new Error(result.error || 'Erro ao conectar ao banco.');
                            }`;

const replacement = `                            if (result.success) {
                              setDbMessage({ type: 'success', text: result.message || 'Salvo no PostgreSQL!' });
                              // Limpar as informações do estado
                              setData(DEFAULT_SCAN_DATA);
                              setCapturedImage(null);
                              setEquipmentExistsInDb(false);
                              setShowDuplicateModal(false);
                            } else {
                              if (result.conflict) {
                                setEquipmentExistsInDb(true);
                              }
                              throw new Error(result.error || 'Erro ao conectar ao banco.');
                            }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target App.tsx not found');
}
