const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

const uiStr = `
  if (activeModule === 'iptv') {
    const [selectedModel, setSelectedModel] = useState<any>(null);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [fieldsData, setFieldsData] = useState<any>({});
    const [isPrinting, setIsPrinting] = useState(false);

    // Initial load for Operator inside IPTV
    useEffect(() => {
      if (iptvModels.length === 0) fetchIptvModels();
      if (printers.length === 0) fetchPrinters();
    }, []);

    const handleFieldChange = (key: string, value: string) => {
      setFieldsData({ ...fieldsData, [key]: value.trim() });
    };

    const handlePrint = async () => {
      if (!selectedModel || !selectedPrinter) {
        alert('Selecione um modelo e uma impressora!');
        return;
      }

      // Validar travas de caracteres
      for (const [key, config] of Object.entries(selectedModel.campos_config) as any) {
        const val = fieldsData[key] || '';
        if (config.minLength && val.length < config.minLength) {
          alert(\`O campo \${config.label} precisa ter no mínimo \${config.minLength} caracteres. (Atual: \${val.length})\`);
          return;
        }
        if (config.maxLength && val.length > config.maxLength) {
          alert(\`O campo \${config.label} não pode ter mais de \${config.maxLength} caracteres. (Atual: \${val.length})\`);
          return;
        }
      }

      setIsPrinting(true);
      try {
        const response = await fetch('/api/print-iptv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${localStorage.getItem('scanonu_token')}\`
          },
          body: JSON.stringify({
            modelId: selectedModel.id,
            printerId: selectedPrinter,
            fieldsData
          })
        });
        const result = await response.json();
        if (response.ok && result.success) {
          alert('Etiqueta enviada para impressão com sucesso!');
          setFieldsData({}); // Limpar os campos após imprimir
        } else {
          alert(result.error || 'Erro ao imprimir.');
        }
      } catch (err) {
        console.error(err);
        alert('Erro ao se conectar com o servidor para impressão.');
      } finally {
        setIsPrinting(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <header className="bg-[#003865] text-white p-4 shadow-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModule('selection')} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <MonitorPlay className="w-6 h-6 text-blue-300" />
            <h1 className="text-xl font-bold tracking-tight">Módulo IPTV <span className="text-sm font-normal text-blue-200 ml-2">Reimpressão</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-white">{user?.email}</p>
              <p className="text-[10px] text-blue-200 uppercase tracking-wider">{user?.role}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 flex flex-col items-center">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Configuração da Etiqueta</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Modelo do Equipamento</label>
                <select
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-bold focus:border-[#003865] focus:ring-0 transition-colors"
                  onChange={(e) => {
                    const model = iptvModels.find(m => m.id === parseInt(e.target.value));
                    setSelectedModel(model || null);
                    setFieldsData({});
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Selecione um modelo...</option>
                  {iptvModels.map(m => <option key={m.id} value={m.id}>{m.nome_modelo}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Impressora Destino</label>
                <select
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-bold focus:border-[#003865] focus:ring-0 transition-colors"
                  onChange={(e) => setSelectedPrinter(e.target.value)}
                  defaultValue=""
                >
                  <option value="" disabled>Selecione uma impressora...</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.ip})</option>)}
                </select>
              </div>
            </div>

            {selectedModel ? (
              <div className="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <h3 className="font-bold text-[#003865] mb-4">Dados da Etiqueta</h3>
                {Object.entries(selectedModel.campos_config || {}).map(([key, config]: [string, any]) => (
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
                ))}

                <button
                  onClick={handlePrint}
                  disabled={isPrinting}
                  className="w-full mt-6 bg-[#003865] hover:bg-blue-900 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPrinting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
                  <span>Imprimir Etiqueta</span>
                </button>
              </div>
            ) : (
              <div className="text-center p-12 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Selecione um modelo acima para habilitar os campos.</p>
              </div>
            )}

          </div>
        </main>
      </div>
    );
  }
`;

code = code.replace(
  /if \(activeModule === 'iptv'\) \{[\s\S]*?return \(\s*\<div className=\{`min-h-screen flex bg-slate-50 text-slate-800 font-sans w-full/,
  `${uiStr}\n\n  return (\n    <div className={\`min-h-screen flex bg-slate-50 text-slate-800 font-sans w-full`
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx operator IPTV module updated.');
