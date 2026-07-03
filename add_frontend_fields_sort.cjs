const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

const target = `                {Object.entries(selectedModel.campos_config || {}).filter(([key]) => !key.endsWith('_clean')).map(([key, config]: [string, any]) => (
                  <div key={key}>`;

const replacement = `                {(() => {
                  const FIELD_ORDER = ['sn', 'serial', 'cpe_sn', 'gpon_sn', 'ca_id', 'sc_id', 'mac'];
                  return Object.entries(selectedModel.campos_config || {})
                    .filter(([key]) => !key.endsWith('_clean'))
                    .sort(([keyA], [keyB]) => {
                      const idxA = FIELD_ORDER.indexOf(keyA.toLowerCase());
                      const idxB = FIELD_ORDER.indexOf(keyB.toLowerCase());
                      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                      if (idxA !== -1) return -1;
                      if (idxB !== -1) return 1;
                      return keyA.localeCompare(keyB);
                    })
                    .map(([key, config]: [string, any]) => (
                      <div key={key}>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          {config.label} {config.minLength ? \`(\${config.minLength} chars)\` : ''}
                        </label>
                        <input
                          type="text"
                          value={fieldsData[key] || ''}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                          placeholder="Biper com o scanner ou digite..."
                          className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono focus:border-[#003865] focus:ring-0 transition-colors"
                          maxLength={config.maxLength}
                        />
                      </div>
                    ));
                })()}`;

// Replace the mapping block completely
const normCode = code.replace(/\r?\n/g, '\n');
const startMatch = `                {Object.entries(selectedModel.campos_config || {}).filter(([key]) => !key.endsWith('_clean')).map(([key, config]: [string, any]) => (`.replace(/\r?\n/g, '\n');
const endMatch = `                  </div>
                ))}`.replace(/\r?\n/g, '\n');

const indexStart = normCode.indexOf(startMatch);
const indexEnd = normCode.indexOf(endMatch, indexStart);

if (indexStart !== -1 && indexEnd !== -1) {
  const originalBlock = normCode.substring(indexStart, indexEnd + endMatch.length);
  const updatedCode = normCode.replace(originalBlock, replacement);
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target print fields mapping blocks not found');
}
