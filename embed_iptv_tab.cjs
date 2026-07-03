const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add iptvTab hook at the top level
const topHookTarget = `  const [fieldsData, setFieldsData] = useState<any>({});
  const [isPrinting, setIsPrinting] = useState(false);`;

const topHookReplacement = `  const [fieldsData, setFieldsData] = useState<any>({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [iptvTab, setIptvTab] = useState<'print' | 'models'>('print');`;

if (code.includes(topHookTarget)) {
  code = code.replace(topHookTarget, topHookReplacement);
}

// 2. Modify activeModule === 'iptv' rendering block
const mainLayoutTarget = `        <main className="flex-1 p-6 flex flex-col items-center">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Configuração da Etiqueta</h2>`;

const mainLayoutReplacement = `        <main className="flex-1 p-6 flex flex-col items-center w-full">
          {/* Tab Selector for IPTV Module */}
          {['master', 'admin'].includes(user?.role || '') && (
            <div className="flex border-b border-slate-200 mb-6 w-full max-w-2xl bg-white rounded-t-2xl px-6 pt-2 shadow-sm border-x border-t border-slate-200/60">
              <button
                onClick={() => setIptvTab('print')}
                className={\`py-3 px-6 font-bold text-sm border-b-2 transition-all \${
                  iptvTab === 'print' ? 'border-[#003865] text-[#003865]' : 'border-transparent text-slate-500 hover:text-slate-700'
                }\`}
              >
                Imprimir Etiqueta
              </button>
              <button
                onClick={() => setIptvTab('models')}
                className={\`py-3 px-6 font-bold text-sm border-b-2 transition-all \${
                  iptvTab === 'models' ? 'border-[#003865] text-[#003865]' : 'border-transparent text-slate-500 hover:text-slate-700'
                }\`}
              >
                Modelos IPTV
              </button>
            </div>
          )}

          {iptvTab === 'print' ? (
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">Configuração da Etiqueta</h2>`;

// Add closing conditional bracket for iptvTab === 'print' and rendering block for 'models'
const endLayoutTarget = `              <div className="text-center p-12 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Selecione um modelo acima para habilitar os campos.</p>
              </div>
            )}

          </div>
        </main>`;

const endLayoutReplacement = `              <div className="text-center p-12 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Selecione um modelo acima para habilitar os campos.</p>
              </div>
            )}

            </div>
          ) : (
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8 animate-fadeIn">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold text-[#003865] flex items-center gap-2">
                    <MonitorPlay className="w-5 h-5" /> Modelos IPTV (ZPL)
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">Gerencie os modelos e códigos de impressão</p>
                </div>
                <button
                  onClick={() => {
                    setEditingIptvModel(null);
                    setIptvModelForm({
                      nome_modelo: '',
                      codigo_zpl: '',
                      campos_config: '{\\n  "sn": { "label": "S/N:", "minLength": 15, "maxLength": 15 },\\n  "mac": { "label": "MAC ETHERNET:", "minLength": 17, "maxLength": 17 }\\n}'
                    });
                    setShowIptvModelModal(true);
                  }}
                  className="bg-[#003865] hover:bg-blue-900 text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" /> Novo Modelo
                </button>
              </div>

              {isLoadingIptvModels ? (
                <div className="flex justify-center py-10"><RefreshCw className="w-8 h-8 text-[#003865] animate-spin" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-xl rounded-bl-xl font-bold">ID</th>
                        <th className="px-4 py-3 font-bold">Modelo</th>
                        <th className="px-4 py-3 font-bold text-center">Campos</th>
                        <th className="px-4 py-3 rounded-tr-xl rounded-br-xl font-bold text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {iptvModels.map((model: any) => (
                        <tr key={model.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-500">#{model.id}</td>
                          <td className="px-4 py-3 font-bold text-slate-800">{model.nome_modelo}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">
                              {Object.keys(model.campos_config || {}).length} campos
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right flex items-center justify-end">
                            <button
                              onClick={() => {
                                setEditingIptvModel(model);
                                setIptvModelForm({
                                  nome_modelo: model.nome_modelo,
                                  codigo_zpl: model.codigo_zpl,
                                  campos_config: JSON.stringify(model.campos_config, null, 2)
                                });
                                setShowIptvModelModal(true);
                              }}
                              className="text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors mr-2"
                              title="Editar"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteIptvModel(model.id)}
                              className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                              title="Deletar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {iptvModels.length === 0 && (
                        <tr><td colSpan={4} className="text-center py-6 text-slate-500 font-medium">Nenhum modelo cadastrado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>`;

const normCode = code.replace(/\r?\n/g, '\n');
const normMainTarget = mainLayoutTarget.replace(/\r?\n/g, '\n');
const normEndTarget = endLayoutTarget.replace(/\r?\n/g, '\n');

if (normCode.includes(normMainTarget) && normCode.includes(normEndTarget)) {
  let updatedCode = normCode.replace(normMainTarget, mainLayoutReplacement.replace(/\r?\n/g, '\n'));
  updatedCode = updatedCode.replace(normEndTarget, endLayoutReplacement.replace(/\r?\n/g, '\n'));
  
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target blocks for embedding IPTV tab not found');
}
