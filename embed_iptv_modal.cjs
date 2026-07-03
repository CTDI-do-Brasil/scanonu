const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// The target is the end of the IPTV module main container
const target = `            </div>
          )}
        </main>
      </div>
    );
  }`;

const replacement = `            </div>
          )}
          
          {/* MODAL MODELO IPTV (Duplicado aqui para funcionar dentro do retorno antecipado do módulo IPTV) */}
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
                      Insira as variáveis entre chaves com cifrão, ex: <code>{"$"+"{sn}"}</code>, <code>{"$"+"{mac}"}</code>.
                    </p>
                    <textarea 
                      required rows={6}
                      value={iptvModelForm.codigo_zpl}
                      onChange={(e) => handleZplChange(e.target.value)}
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

                  <div className="flex gap-4 pt-4 border-t border-slate-100 mt-6">
                    <button 
                      type="button"
                      onClick={() => setShowIptvModelModal(false)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="button"
                      onClick={handleSaveIptvModel}
                      className="flex-1 bg-[#003865] hover:bg-blue-900 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-md"
                    >
                      Salvar Modelo
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target block for IPTV modal embed not found');
}
