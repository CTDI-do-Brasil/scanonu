const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

const sanitizeEffect = `
  // --- SANITIZAÇÃO GLOBAL DE INPUT DO SCANNER (! -> I) ---
  useEffect(() => {
    let hasChanges = false;
    const sanitizedData = { ...data };
    
    // Ignorar senha web na sanitização se necessário, mas o comum é sanitizar tudo
    // já que o scanner confunde ! com I
    const skipFields = ['senha', 'wifi_key']; // Opcional: ignorar campos que podem ter ! de propósito

    for (const [key, value] of Object.entries(sanitizedData)) {
      if (typeof value === 'string' && value.includes('!') && !skipFields.includes(key)) {
        sanitizedData[key as keyof ScanData] = value.replace(/!/g, 'I');
        hasChanges = true;
      }
    }
    if (hasChanges) {
      setData(sanitizedData as ScanData);
    }
  }, [data]);
`;

if (!code.includes("SANITIZAÇÃO GLOBAL")) {
  code = code.replace(
    /const \[showDuplicateModal, setShowDuplicateModal\] = useState\(false\);/,
    `const [showDuplicateModal, setShowDuplicateModal] = useState(false);\n${sanitizeEffect}`
  );
}

const iptvSanitize = `
    const handleFieldChange = (key: string, value: string) => {
      // Automagicamente troca ! por I para corrigir bugs de scanner no mobile
      const sanitized = value.replace(/!/g, 'I');
      setFieldsData({ ...fieldsData, [key]: sanitized.trim() });
    };
`;

code = code.replace(
  /const handleFieldChange = \(key: string, value: string\) =\> \{\s*setFieldsData\(\{ \.\.\.fieldsData, \[key\]: value\.trim\(\) \}\);\s*\};/,
  iptvSanitize
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx global sanitize added.');
