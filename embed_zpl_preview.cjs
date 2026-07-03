const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add previewZpl state and useEffect above the print handler
const topHookTarget = `  const [fieldsData, setFieldsData] = useState<any>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [iptvTab, setIptvTab] = useState<'print' | 'models'>('print');`;

const topHookReplacement = `  const [fieldsData, setFieldsData] = useState<any>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [iptvTab, setIptvTab] = useState<'print' | 'models'>('print');
  const [previewZpl, setPreviewZpl] = useState('');

  useEffect(() => {
    if (!selectedModel) {
      setPreviewZpl('');
      return;
    }
    const timer = setTimeout(() => {
      let tempZpl = selectedModel.codigo_zpl;
      Object.keys(selectedModel.campos_config || {}).forEach((key) => {
        const val = fieldsData[key] || \`[\${key.toUpperCase()}]\`;
        const regex = new RegExp('\\\\$\\\\{\\\\s*' + key + '\\\\s*\\\\}', 'g');
        tempZpl = tempZpl.replace(regex, val);

        const valClean = val.replace(/[^A-Za-z0-9]/g, '');
        const regexClean = new RegExp('\\\\$\\\\{\\\\s*' + key + '_clean\\\\s*\\\\}', 'g');
        tempZpl = tempZpl.replace(regexClean, valClean);
      });
      setPreviewZpl(tempZpl);
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedModel, fieldsData]);`;

if (code.includes(topHookTarget)) {
  code = code.replace(topHookTarget, topHookReplacement);
}

// 2. Change the layout of activeModule === 'iptv' printing container
const printLayoutTarget = `          {iptvTab === 'print' ? (
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Configuração da Etiqueta</h2>`;

const printLayoutReplacement = `          {iptvTab === 'print' ? (
            <div className={\`w-full grid grid-cols-1 \${selectedModel ? 'max-w-5xl lg:grid-cols-12 gap-8' : 'max-w-2xl'}\`}>
              <div className={\`bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8 \${selectedModel ? 'lg:col-span-7' : ''}\`}>
                <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Configuração da Etiqueta</h2>`;

const printLayoutEndTarget = `              <div className="text-center p-12 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Selecione um modelo acima para habilitar os campos.</p>
              </div>
            )}

            </div>
          ) : (`;

const printLayoutEndReplacement = `              <div className="text-center p-12 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Selecione um modelo acima para habilitar os campos.</p>
              </div>
            )}
              </div>

              {selectedModel && (
                <div className="lg:col-span-5 bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8 flex flex-col items-center justify-start h-fit">
                  <h3 className="text-lg font-bold text-[#003865] mb-4 border-b border-slate-100 pb-2 w-full text-center flex items-center justify-center gap-2">
                    <MonitorPlay className="w-4 h-4" /> Layout da Etiqueta
                  </h3>
                  {previewZpl ? (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-center min-h-[300px] w-full">
                      <img 
                        src={\`https://api.labelary.com/v1/printers/8dpmm/labels/4x3.5/0/\${encodeURIComponent(previewZpl)}\`} 
                        alt="Visualização da Etiqueta" 
                        className="max-w-full rounded-lg border border-slate-200/80 shadow-sm"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center min-h-[300px] w-full text-slate-400 font-medium animate-pulse">
                      Carregando visualização...
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-4 text-center leading-relaxed">
                    * Simulação gráfica aproximada gerada via Labelary API.
                  </p>
                </div>
              )}
            </div>
          ) : (`;

const normCode = code.replace(/\r?\n/g, '\n');
const normMainTarget = printLayoutTarget.replace(/\r?\n/g, '\n');
const normEndTarget = printLayoutEndTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normMainTarget) && normCode.includes(normEndTarget)) {
  let updatedCode = normCode.replace(normMainTarget, printLayoutReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normEndTarget, printLayoutEndReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target print layout blocks not found in App.tsx');
}
