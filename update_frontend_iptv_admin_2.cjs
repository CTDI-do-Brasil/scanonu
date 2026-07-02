const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

const uiStr = `
            {/* --- ABA MODELOS IPTV --- */}
            {adminSubTab === 'iptv-models' && user?.role === 'master' && (
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60 animate-fadeIn">
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
                        {iptvModels.map(model => (
                          <tr key={model.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-500">#{model.id}</td>
                            <td className="px-4 py-3 font-bold text-slate-800">{model.nome_modelo}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">
                                {Object.keys(model.campos_config || {}).length} campos
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
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
`;

const modalStr = `
      {/* MODAL MODELO IPTV */}
      {showIptvModelModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-3xl w-full shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">
                {editingIptvModel ? 'Editar Modelo' : 'Novo Modelo IPTV'}
              </h3>
              <button onClick={() => setShowIptvModelModal(false)} className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveIptvModel} className="flex-1 overflow-y-auto pr-2 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nome do Modelo</label>
                <input 
                  required type="text"
                  value={iptvModelForm.nome_modelo}
                  onChange={(e) => setIptvModelForm({...iptvModelForm, nome_modelo: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-bold focus:border-[#003865] focus:ring-0 transition-colors"
                  placeholder="Ex: S4KW3"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Código ZPL</label>
                <p className="text-[10px] text-slate-500 mb-2 leading-tight">
                  Insira as variáveis entre chaves, ex: <code>\${sn}</code>, <code>\${mac}</code>.
                </p>
                <textarea 
                  required rows={6}
                  value={iptvModelForm.codigo_zpl}
                  onChange={(e) => setIptvModelForm({...iptvModelForm, codigo_zpl: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono text-xs focus:border-[#003865] focus:ring-0 transition-colors"
                  placeholder="^XA...^FD\${sn}^FS...^XZ"
                ></textarea>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Configuração de Campos (JSON)</label>
                <p className="text-[10px] text-slate-500 mb-2 leading-tight">
                  Defina os campos obrigatórios e suas travas (min/max length). Exemplo:<br/>
                  <code>{"{ \\"sn\\": { \\"label\\": \\"S/N:\\", \\"minLength\\": 15, \\"maxLength\\": 15 } }"}</code>
                </p>
                <textarea 
                  required rows={6}
                  value={iptvModelForm.campos_config}
                  onChange={(e) => setIptvModelForm({...iptvModelForm, campos_config: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono text-xs focus:border-[#003865] focus:ring-0 transition-colors"
                ></textarea>
              </div>
            </form>
            
            <div className="mt-6 pt-4 border-t border-slate-100 flex gap-3">
              <button 
                type="button"
                onClick={() => setShowIptvModelModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveIptvModel}
                className="flex-1 bg-[#003865] hover:bg-blue-900 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-md"
              >
                Salvar Modelo
              </button>
            </div>
          </div>
        </div>
      )}
`;

code = code.replace(
  /\{\/\* --- FIM PAINEL ADMINISTRATIVO ---\*\/\}/,
  `${uiStr}\n          {/* --- FIM PAINEL ADMINISTRATIVO ---*/}`
);

code = code.replace(
  /\{\/\* MODALS E OVERLAYS \*\/\}/,
  `{/* MODALS E OVERLAYS */}\n${modalStr}`
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx UI and Modal added for IPTV models CRUD.');
