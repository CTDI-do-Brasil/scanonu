const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add "usb_local" option to printer select dropdown
const dropdownTarget = `                  <option value="" disabled>Selecione uma impressora...</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.ip})</option>)}`;

const dropdownReplacement = `                  <option value="" disabled>Selecione uma impressora...</option>
                  <option value="usb_local">🔌 USB LOCAL (Zebra Browser Print)</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.ip})</option>)}`;

if (code.includes(dropdownTarget)) {
  code = code.replace(dropdownTarget, dropdownReplacement);
}

// 2. Add local USB print handler inside handlePrint
const handlePrintTarget = `      setIsPrinting(true);
      try {
        const response = await fetch('/api/print-iptv', {`;

const handlePrintReplacement = `      setIsPrinting(true);
      try {
        if (selectedPrinter === 'usb_local') {
          // Detectar e imprimir via Zebra Browser Print local
          let localUrl = '';
          const endpoints = [
            'https://localhost:9102',
            'https://127.0.0.1.local.zebra.com:9102',
            'http://localhost:9101'
          ];
          
          for (const url of endpoints) {
            try {
              const res = await fetch(\`\${url}/default\`, { method: 'GET' });
              if (res.ok) {
                localUrl = url;
                break;
              }
            } catch (e) {}
          }
          
          if (!localUrl) {
            throw new Error('Não foi possível se conectar ao aplicativo Zebra Browser Print. Certifique-se de que ele está instalado, aberto e rodando em sua máquina local.');
          }
          
          // Buscar impressora padrão do Browser Print
          const deviceRes = await fetch(\`\${localUrl}/default\`, { method: 'GET' });
          const device = await deviceRes.json();
          if (!device || !device.uid) {
            throw new Error('Nenhuma impressora USB local padrão encontrada no Zebra Browser Print.');
          }
          
          // Enviar o ZPL para a impressora local
          const printRes = await fetch(\`\${localUrl}/write\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              device: device,
              data: previewZpl
            })
          });
          
          if (printRes.ok) {
            alert('Etiqueta enviada para a impressora USB local com sucesso!');
            setFieldsData({});
          } else {
            throw new Error('Erro ao enviar dados para a impressora USB.');
          }
          return;
        }

        const response = await fetch('/api/print-iptv', {`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = handlePrintTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, handlePrintReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target print handlers not found in App.tsx');
}
