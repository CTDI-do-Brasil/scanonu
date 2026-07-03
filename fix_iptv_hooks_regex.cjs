const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add states and useEffect at the top of App() component using regex to be newline-independent
const topHookRegex = /const\s*\[isUpdatingPrinter,\s*setIsUpdatingPrinter\]\s*=\s*useState\(false\);/g;

const topHookReplacement = `const [isUpdatingPrinter, setIsUpdatingPrinter] = useState(false);

  // Estados para Módulo IPTV (declarados no topo para seguir as regras do React)
  const [selectedModel, setSelectedModel] = useState<any>(null);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [fieldsData, setFieldsData] = useState<any>({});
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (activeModule === 'iptv') {
      if (iptvModels.length === 0) fetchIptvModels();
      if (printers.length === 0) fetchPrinters();
    }
  }, [activeModule]);`;

if (topHookRegex.test(code)) {
  code = code.replace(topHookRegex, topHookReplacement);
  console.log('Top hooks added successfully');
} else {
  console.log('Top hook target not found');
}

// 2. Remove hooks and useEffect from the if (activeModule === 'iptv') block
const targetIptvBlockCode = `  if (activeModule === 'iptv') {
    const [selectedModel, setSelectedModel] = useState<any>(null);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [fieldsData, setFieldsData] = useState<any>({});
    const [isPrinting, setIsPrinting] = useState(false);

    // Initial load for Operator inside IPTV
    useEffect(() => {
      if (iptvModels.length === 0) fetchIptvModels();
      if (printers.length === 0) fetchPrinters();
    }, []);`;

const replacementIptvBlockCode = `  if (activeModule === 'iptv') {`;

// Normalize code newlines to simplify matching
const normTarget = targetIptvBlockCode.replace(/\r?\n/g, '\n');
const normCode = code.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  code = normCode.replace(normTarget, replacementIptvBlockCode.replace(/\r?\n/g, '\n'));
  console.log('Hooks removed successfully');
} else {
  console.log('Target IPTV block code not found');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update complete');
