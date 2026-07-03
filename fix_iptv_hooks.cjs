const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add states and useEffect at the top of App() component
const topHookTarget = `  const [printerError, setPrinterError] = useState<string | null>(null);
  const [isUpdatingPrinter, setIsUpdatingPrinter] = useState(false);`;

const topHookReplacement = `  const [printerError, setPrinterError] = useState<string | null>(null);
  const [isUpdatingPrinter, setIsUpdatingPrinter] = useState(false);

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
  }, [activeModule, iptvModels.length, printers.length]);`;

if (code.includes(topHookTarget)) {
  code = code.replace(topHookTarget, topHookReplacement);
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

if (code.includes(targetIptvBlockCode)) {
  code = code.replace(targetIptvBlockCode, replacementIptvBlockCode);
  console.log('Hooks removed successfully');
} else {
  // Let's handle \r\n vs \n for carriage returns
  const normTarget = targetIptvBlockCode.replace(/\r?\n/g, '\n');
  const normCode = code.replace(/\r?\n/g, '\n');
  if (normCode.includes(normTarget)) {
    code = normCode.replace(normTarget, replacementIptvBlockCode.replace(/\r?\n/g, '\n'));
    console.log('Hooks removed successfully with normalized newlines');
  } else {
    console.log('Target IPTV block code not found');
  }
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update complete');
