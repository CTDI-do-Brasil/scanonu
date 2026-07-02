const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

// Define handleGoBackToModules right after resetAll
const handleGoBackFunction = `  const handleGoBackToModules = () => {
    resetAll();
    setExcelFile(null);
    setExcelParsedData([]);
    setExcelImportStats(null);
    setActiveModule('selection');
  };

  const openInNewTab = () => {`;

code = code.replace(/  const openInNewTab = \(\) => \{/, handleGoBackFunction);

// Replace all onClick={() => setActiveModule('selection')}
code = code.replace(/onClick=\{\(\) => setActiveModule\('selection'\)\}/g, "onClick={handleGoBackToModules}");

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx updated to clear page when going back.');
