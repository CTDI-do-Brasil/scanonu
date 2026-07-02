const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

const handleGoBackFunction = `  const handleGoBackToModules = () => {
    resetAll();
    setActiveModule('selection');
  };

  const openInNewTab = () => {`;

code = code.replace(/  const handleGoBackToModules = \(\) => \{[\s\S]*?const openInNewTab = \(\) => \{/, handleGoBackFunction);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx updated to fix undefined variables.');
