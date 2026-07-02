const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'frontend/src/App.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Add iptv-models to adminSubTab type
code = code.replace(
  /useState\<'metrics' \| 'export' \| 'users' \| 'printers'\>\('metrics'\);/,
  `useState<'metrics' | 'export' | 'users' | 'printers' | 'iptv-models'>('metrics');`
);

// 2. Add State for IPTV models
const stateStr = `  const [iptvModels, setIptvModels] = useState<any[]>([]);
  const [isLoadingIptvModels, setIsLoadingIptvModels] = useState(false);
  const [editingIptvModel, setEditingIptvModel] = useState<any>(null);
  const [showIptvModelModal, setShowIptvModelModal] = useState(false);
  const [iptvModelForm, setIptvModelForm] = useState({ nome_modelo: '', codigo_zpl: '', campos_config: '' });`;

code = code.replace(
  /const \[printers, setPrinters\] = useState\<any\[\]\>\(\[\]\);/,
  `const [printers, setPrinters] = useState<any[]>([]);\n${stateStr}`
);

// 3. Add fetchIptvModels in useEffect
code = code.replace(
  /fetchPrinters\(\);/,
  `fetchPrinters();\n      fetchIptvModels();`
);

// 4. Add fetchIptvModels and CRUD functions
const crudStr = `
  const fetchIptvModels = async () => {
    if (!user || user.role !== 'master') return;
    setIsLoadingIptvModels(true);
    try {
      const response = await fetch('/api/iptv-models', {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('scanonu_token')}\` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setIptvModels(result.models);
      }
    } catch (err) {
      console.error('Erro ao buscar modelos IPTV:', err);
    } finally {
      setIsLoadingIptvModels(false);
    }
  };

  const handleSaveIptvModel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsedCampos;
      try {
        parsedCampos = JSON.parse(iptvModelForm.campos_config);
      } catch (e) {
        alert('O campo de configurações (JSON) é inválido!');
        return;
      }

      const url = editingIptvModel ? \`/api/admin/iptv-models/\${editingIptvModel.id}\` : '/api/admin/iptv-models';
      const method = editingIptvModel ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('scanonu_token')}\`
        },
        body: JSON.stringify({
          nome_modelo: iptvModelForm.nome_modelo,
          codigo_zpl: iptvModelForm.codigo_zpl,
          campos_config: parsedCampos
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setShowIptvModelModal(false);
        fetchIptvModels();
        alert('Modelo salvo com sucesso!');
      } else {
        alert(result.error || 'Erro ao salvar modelo.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar modelo.');
    }
  };

  const handleDeleteIptvModel = async (id: number) => {
    if (!confirm('Deseja realmente deletar este modelo?')) return;
    try {
      const response = await fetch(\`/api/admin/iptv-models/\${id}\`, {
        method: 'DELETE',
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('scanonu_token')}\` }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        fetchIptvModels();
      } else {
        alert(result.error || 'Erro ao deletar modelo.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao deletar modelo.');
    }
  };
`;

code = code.replace(
  /const fetchPrinters = async \(\) =\> \{/,
  `${crudStr}\n  const fetchPrinters = async () => {`
);

// 5. Add Sidebar Button for IPTV Models
const sidebarBtnStr = `
              {user?.role === 'master' && (
              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('iptv-models');
                  setSidebarOpen(false);
                }}
                className={\`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all \${
                  adminTab === 'admin' && adminSubTab === 'iptv-models'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }\`}
              >
                <MonitorPlay className="w-4 h-4" />
                Modelos IPTV
              </button>
              )}
`;

code = code.replace(
  /\<Printer className="w-4 h-4" \/\>\s*Gerenciar Impressoras\s*\<\/button\>\s*\)\}/,
  `<Printer className="w-4 h-4" />\n                Gerenciar Impressoras\n              </button>\n            )}\n${sidebarBtnStr}`
);

// 6. Add Sub-nav Button for IPTV Models
const subnavBtnStr = `
              {user?.role === 'master' && (
              <button
                onClick={() => setAdminSubTab('iptv-models')}
                className={\`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all \${
                  adminSubTab === 'iptv-models'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }\`}
              >
                Modelos IPTV
              </button>
              )}
`;

code = code.replace(
  /Gerenciar Impressoras\s*\<\/button\>\s*\)\}/,
  `Gerenciar Impressoras\n              </button>\n            )}\n${subnavBtnStr}`
);

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx updated for IPTV models CRUD.');
