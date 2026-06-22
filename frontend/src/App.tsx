import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  Copy, 
  Check, 
  Edit3, 
  Save, 
  RefreshCw, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  Cpu, 
  Info, 
  AlertTriangle,
  X,
  Lock,
  Mail,
  LogOut,
  UserCheck,
  Users,
  UserPlus,
  Download
} from 'lucide-react';

interface ScanData {
  fabricante: string;
  modelo: string;
  cpe_sn: string;
  gpon_sn: string;
  mac: string;
  wifi_key: string;
  usuario: string;
  senha: string;
}

const DEFAULT_SCAN_DATA: ScanData = {
  fabricante: '',
  modelo: '',
  cpe_sn: '',
  gpon_sn: '',
  mac: '',
  wifi_key: '',
  usuario: '',
  senha: ''
};

export default function App() {
  // Autenticação
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Administração
  const [adminTab, setAdminTab] = useState<'scan' | 'admin'>('scan');
  const [usersList, setUsersList] = useState<Array<{ id?: number; email: string; role: string }>>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operador');
  const [adminMessage, setAdminMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Estados de Fluxo da Tela: 'idle', 'camera', 'processing', 'result'
  const [screen, setScreen] = useState<'idle' | 'camera' | 'processing' | 'result'>('idle');
  
  // Dicas rápidas colapsáveis
  const [showTips, setShowTips] = useState(true);
  
  // Imagem capturada (base64)
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  
  // Dados processados
  const [data, setData] = useState<ScanData>(DEFAULT_SCAN_DATA);
  const [editedData, setEditedData] = useState<ScanData>(DEFAULT_SCAN_DATA);
  const [isEditing, setIsEditing] = useState(false);
  
  // Controle de erros
  const [error, setError] = useState<string | null>(null);
  
  // Copiar estados
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showJsonRaw, setShowJsonRaw] = useState(false);

  // Estados de persistência com SQL Server/Postgres
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [dbMessage, setDbMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estados de Duplicidade de Equipamento
  const [equipmentExistsInDb, setEquipmentExistsInDb] = useState(false);
  const [existingEquipmentData, setExistingEquipmentData] = useState<ScanData | null>(null);

  // Referências para Stream da Câmera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Carrega estado de autenticação do localStorage ao iniciar
  useEffect(() => {
    const storedUser = localStorage.getItem('scanonu_user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem('scanonu_user');
      }
    }
  }, []);

  // Fechar o stream da câmera ao desmontar
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  // Buscar usuários quando na aba admin
  const fetchUsers = async () => {
    if (!user || user.role !== 'admin') return;
    setIsLoadingUsers(true);
    try {
      const response = await fetch(`/api/admin/users?adminEmail=${encodeURIComponent(user.email)}`);
      const result = await response.json();
      if (response.ok && result.success) {
        setUsersList(result.users);
      }
    } catch (err) {
      console.error('Erro ao buscar usuários:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (adminTab === 'admin') {
      fetchUsers();
    }
  }, [adminTab]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: emailInput, senha: passwordInput })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setUser(result.user);
        localStorage.setItem('scanonu_user', JSON.stringify(result.user));
      } else {
        setLoginError(result.error || 'Credenciais inválidas. Verifique seu e-mail e senha.');
      }
    } catch (err: any) {
      setLoginError('Erro de conexão com o servidor.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('scanonu_user');
    setEmailInput('');
    setPasswordInput('');
    setAdminTab('scan');
    resetAll();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') return;
    setAdminMessage(null);
    setIsCreatingUser(true);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: newEmail,
          senha: newPassword,
          role: newRole,
          adminEmail: user.email
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAdminMessage({ type: 'success', text: result.message || 'Usuário cadastrado com sucesso!' });
        setNewEmail('');
        setNewPassword('');
        setNewRole('operador');
        fetchUsers();
      } else {
        setAdminMessage({ type: 'error', text: result.error || 'Erro ao cadastrar usuário.' });
      }
    } catch (err) {
      setAdminMessage({ type: 'error', text: 'Erro de conexão com o servidor.' });
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleExportXML = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const response = await fetch(`/api/admin/export-xml?adminEmail=${encodeURIComponent(user.email)}`);
      if (!response.ok) {
        throw new Error('Erro ao exportar banco.');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scanonu_etiquetas.xml';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Erro ao exportar arquivo XML: ' + (err.message || err));
    }
  };

  const startCamera = async () => {
    setError(null);
    setScreen('camera');
    try {
      // Priorizar a câmera traseira do celular (environment)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Erro ao acessar a câmera:', err);
      setError('Não foi possível acessar a câmera. Verifique se deu permissão ou utilize a Galeria.');
      setScreen('idle');
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const cancelCamera = () => {
    stopCameraStream();
    setScreen('idle');
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      // Capturar na resolução nativa do vídeo para melhor qualidade OCR
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        setCapturedImage(base64);
        stopCameraStream();
        processImage(base64);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCapturedImage(base64);
        processImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (base64Image: string) => {
    setScreen('processing');
    setError(null);
    setEquipmentExistsInDb(false);
    setExistingEquipmentData(null);
    try {
      const response = await fetch('/api/scan-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ image: base64Image })
      });

      const result = await response.json();

      if (result.success && result.data) {
        setData(result.data);
        setEditedData(result.data);
        if (result.existsInDb) {
          setEquipmentExistsInDb(true);
          setExistingEquipmentData(result.existingData);
        }
        setScreen('result');
      } else {
        throw new Error(result.error || 'Erro desconhecido ao ler a etiqueta.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Ocorreu um erro ao processar a imagem da etiqueta.');
      setScreen('idle');
    }
  };

  const handleCopyField = (field: keyof ScanData, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(editedData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleSaveEdit = () => {
    setData(editedData);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedData(data);
    setIsEditing(false);
  };

  const resetAll = () => {
    setCapturedImage(null);
    setData(DEFAULT_SCAN_DATA);
    setEditedData(DEFAULT_SCAN_DATA);
    setIsEditing(false);
    setError(null);
    setEquipmentExistsInDb(false);
    setExistingEquipmentData(null);
    setDbMessage(null);
    setScreen('idle');
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  // Mapeamento amigável para rótulos de campos
  const fieldLabels: Record<keyof ScanData, string> = {
    fabricante: 'Fabricante',
    modelo: 'Modelo',
    cpe_sn: 'CPE Serial (S/N)',
    gpon_sn: 'GPON Serial (S/N)',
    mac: 'Endereço MAC',
    wifi_key: 'Chave do Wi-Fi',
    usuario: 'Usuário Padrão',
    senha: 'Senha Padrão (Pass)'
  };

  // RENDERIZAÇÃO DA ÁREA DE LOGIN
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#002f56] text-slate-800 font-sans p-6">
        <div className="flex-1 flex flex-col justify-center items-center w-full">
          {/* Card de Login */}
          <div className="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-sm space-y-6">
            {/* Logo */}
            <div className="flex flex-col items-center">
              <div className="bg-[#003865] text-white p-3.5 rounded-2xl shadow-lg shadow-blue-900/20 mb-3 animate-pulse-slow">
                <Cpu className="w-8 h-8" />
              </div>
              <h1 className="font-extrabold text-2xl tracking-tight text-slate-800">Scan<span className="text-[#003865]">ONU</span></h1>
              <p className="text-slate-400 text-xs mt-1">Portal do Operador de Campo</p>
            </div>

            <h2 className="text-sm font-bold text-slate-700 text-center">Faça login para continuar</h2>
            
            {loginError && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input 
                    type="email" 
                    required
                    placeholder="ex: admin@scanonu.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl pl-9 pr-3 py-2 text-sm text-slate-800 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input 
                    type="password" 
                    required
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl pl-9 pr-3 py-2 text-sm text-slate-800 outline-none transition-all"
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={isLoggingIn}
                className="w-full bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] disabled:bg-[#003865]/60 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md transition-all text-sm mt-2"
              >
                {isLoggingIn ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>Entrar no Sistema</span>
                  </>
                )}
              </button>
            </form>

            {/* Dica de credenciais para testes rápidos */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] text-slate-400 text-center">
              Use <strong className="text-slate-600">admin@scanonu.com</strong> e senha <strong className="text-slate-600">admin123</strong>
            </div>
          </div>
        </div>

        {/* Footer Login */}
        <footer className="py-2 text-center text-[10px] text-blue-200/50">
          ScanONU &copy; {new Date().getFullYear()} - Assistente de Campo
        </footer>
      </div>
    );
  }

  // APLICAÇÃO APÓS LOGADA (SCANNER)
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans w-full">
      {/* HEADER FIXO */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/60 py-3 px-4">
        <div className="max-w-2xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-[#003865] text-white p-1.5 rounded-lg">
              <Cpu className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg text-slate-800 tracking-tight">Scan<span className="text-[#003865]">ONU</span></span>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={openInNewTab}
              className="text-slate-500 hover:text-[#003865] p-2 rounded-full hover:bg-slate-100 transition-colors flex items-center gap-1 text-xs font-medium"
              title="Abrir em Nova Aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            
            <button 
              onClick={handleLogout}
              className="text-slate-500 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors flex items-center gap-1 text-xs font-medium border border-transparent hover:border-red-100"
              title="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {user?.role === 'admin' && (
        <div className="bg-white border-b border-slate-200/60">
          <div className="max-w-2xl mx-auto w-full flex">
            <button
              onClick={() => setAdminTab('scan')}
              className={`flex-1 text-center py-3 text-xs font-bold border-b-2 transition-all ${
                adminTab === 'scan'
                  ? 'border-[#003865] text-[#003865]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Escaneador
            </button>
            <button
              onClick={() => setAdminTab('admin')}
              className={`flex-1 text-center py-3 text-xs font-bold border-b-2 transition-all ${
                adminTab === 'admin'
                  ? 'border-[#003865] text-[#003865]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Painel Admin
            </button>
          </div>
        </div>
      )}

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 p-4 flex flex-col space-y-4 max-w-2xl mx-auto w-full">
        {/* Notificação de Erro */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2.5 text-red-800 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="font-semibold">Falha na Leitura</p>
              <p className="text-red-700/90 text-xs mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {adminTab === 'admin' && user?.role === 'admin' ? (
          // PAINEL ADMINISTRATIVO
          <div className="space-y-6 animate-fadeIn">
            {/* Exportar Banco em XML */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 text-[#003865] p-2.5 rounded-xl border border-blue-100">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-800">Exportar Banco de Dados</h4>
                  <p className="text-[11px] text-slate-400">Baixe todas as leituras de etiquetas em formato XML</p>
                </div>
              </div>
              <button
                onClick={handleExportXML}
                className="w-full bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all text-xs"
              >
                <Download className="w-4 h-4" />
                <span>Baixar XML de Leituras</span>
              </button>
            </div>

            {/* Cadastrar Usuário */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 text-[#003865] p-2.5 rounded-xl border border-blue-100">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-800">Cadastrar Novo Usuário</h4>
                  <p className="text-[11px] text-slate-400">Crie credenciais de acesso para a equipe</p>
                </div>
              </div>

              {adminMessage && (
                <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                  adminMessage.type === 'success' 
                    ? 'bg-blue-50 border-blue-200 text-blue-800' 
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {adminMessage.type === 'success' ? (
                    <Check className="w-4 h-4 text-blue-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  )}
                  <span>{adminMessage.text}</span>
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">E-mail</label>
                  <input 
                    type="email" 
                    required
                    placeholder="ex: operador@scanonu.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Senha</label>
                  <input 
                    type="password" 
                    required
                    placeholder="Senha temporária"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Perfil</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  >
                    <option value="operador">Operador (Apenas scanner)</option>
                    <option value="admin">Administrador (Scanner + Painel)</option>
                  </select>
                </div>

                <button 
                  type="submit"
                  disabled={isCreatingUser}
                  className="w-full bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] disabled:bg-[#003865]/60 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all text-xs"
                >
                  {isCreatingUser ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Cadastrar Usuário</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Lista de Usuários */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 text-[#003865] p-2.5 rounded-xl border border-blue-100">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-800">Usuários Cadastrados</h4>
                  <p className="text-[11px] text-slate-400">Lista de e-mails ativos e suas permissões</p>
                </div>
              </div>

              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-5 h-5 border-2 border-blue-900/20 border-t-[#003865] rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {usersList.map((usr) => (
                    <div key={usr.email} className="px-3.5 py-2.5 flex items-center justify-between text-xs hover:bg-slate-50/50 transition-colors">
                      <div className="font-medium text-slate-700">{usr.email}</div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        usr.role === 'admin'
                          ? 'bg-purple-50 text-purple-700 border border-purple-100'
                          : 'bg-blue-50 text-[#003865] border border-blue-100'
                      }`}>
                        {usr.role === 'admin' ? 'Admin' : 'Operador'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 1. TELA INICIAL (IDLE) */}
            {screen === 'idle' && (
              <div className="flex-1 flex flex-col justify-between py-4 animate-fadeIn">
                {/* Dicas Rápidas (Collapsible) */}
                <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm transition-all duration-300">
                  <button 
                    onClick={() => setShowTips(!showTips)}
                    className="w-full px-4 py-3 bg-slate-50/50 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-slate-700">
                      <Info className="w-4 h-4 text-[#003865]" />
                      <span className="font-semibold text-sm">Dicas para melhor leitura</span>
                    </div>
                    {showTips ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  
                  {showTips && (
                    <div className="p-4 border-t border-slate-100 text-xs text-slate-600 space-y-2.5 bg-white">
                      <div className="flex gap-2">
                        <span className="text-[#003865] font-bold">1.</span>
                        <p>Evite reflexos de luz diretamente na etiqueta.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#003865] font-bold">2.</span>
                        <p>Mantenha a etiqueta focada e paralela à câmera.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#003865] font-bold">3.</span>
                        <p>Garanta boa iluminação sobre os dados do equipamento.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#003865] font-bold">4.</span>
                        <p>Se a câmera falhar, tire uma foto normal e envie pelo botão Galeria.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Painel Central Clean de Ação */}
                <div className="my-10 flex-1 flex flex-col justify-center items-center text-center px-4">
                  <div className="w-20 h-20 bg-blue-50 text-[#003865] rounded-full flex items-center justify-center mb-6 border border-blue-100 shadow-inner">
                    <Camera className="w-10 h-10" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">Escaneador de ONU</h2>
                  <p className="text-slate-500 text-sm mt-2 max-w-xs">
                    Capture ou envie a etiqueta do equipamento para extrair os códigos de barra e credenciais instantaneamente.
                  </p>
                </div>

                {/* Botões de Ação */}
                <div className="space-y-3">
                  <button 
                    onClick={startCamera}
                    className="w-full bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] text-white font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-blue-900/10 transition-all"
                  >
                    <Camera className="w-5 h-5" />
                    <span>Tirar Foto (Câmera)</span>
                  </button>

                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <span>Buscar Arquivo (Galeria)</span>
                  </button>
                  
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </div>
              </div>
            )}

            {/* 2. TELA DA CÂMERA (STREAM EM TEMPO REAL) */}
            {screen === 'camera' && (
              <div className="fixed inset-0 bg-black z-50 flex flex-col justify-between max-w-md mx-auto">
                {/* Header da Câmera */}
                <div className="p-4 flex justify-between items-center bg-black/40 backdrop-blur-sm z-10">
                  <span className="text-white font-medium text-sm">Escaneando etiqueta...</span>
                  <button 
                    onClick={cancelCamera}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-full text-xs font-semibold backdrop-blur transition-all"
                  >
                    Cancelar
                  </button>
                </div>

                {/* Stream de Vídeo com Guia Retícula */}
                <div className="relative flex-1 bg-neutral-950 flex items-center justify-center overflow-hidden">
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  
                  {/* Retícula guia centralizada */}
                  <div className="relative w-72 h-44 border-2 border-dashed border-blue-400/80 rounded-xl flex flex-col items-center justify-between p-4 z-10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    {/* Cantores destacados */}
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg"></div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg"></div>
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg"></div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg"></div>
                    
                    <span className="text-white/40 text-[10px] uppercase tracking-wider font-bold mt-auto pb-2">
                      Alinhe a etiqueta da ONU aqui
                    </span>
                  </div>
                </div>

                {/* Rodapé da Câmera com Botão de Captura */}
                <div className="p-6 bg-black/60 backdrop-blur-sm flex justify-center z-10">
                  <button 
                    onClick={capturePhoto}
                    className="bg-[#003865] hover:bg-[#004e8c] active:scale-95 text-white font-bold px-6 py-4 rounded-full flex items-center gap-3 shadow-lg shadow-blue-900/10 transition-all text-sm uppercase tracking-wide"
                  >
                    <Camera className="w-5 h-5 fill-current" />
                    <span>Capturar Imagem</span>
                  </button>
                </div>
              </div>
            )}

            {/* 3. TELA DE PROCESSAMENTO (LOADING) */}
            {screen === 'processing' && (
              <div className="flex-1 flex flex-col items-center justify-center py-10 animate-fadeIn">
                <div className="relative mb-8">
                  <div className="w-16 h-16 border-4 border-blue-100 border-t-[#003865] rounded-full animate-spin"></div>
                </div>
                
                <h3 className="text-lg font-bold text-slate-800">Processando imagem...</h3>
                <p className="text-slate-400 text-xs mt-1">Extraindo dados usando Inteligência Artificial</p>

                {/* Miniatura Grayscale */}
                {capturedImage && (
                  <div className="mt-8 border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm w-36 aspect-[4/3] bg-slate-100">
                    <img 
                      src={capturedImage} 
                      alt="Etiqueta capturada" 
                      className="w-full h-full object-cover filter grayscale contrast-125 opacity-70"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 4. TELA DE RESULTADOS */}
            {screen === 'result' && (
              <div className="flex-1 flex flex-col py-2 animate-fadeIn space-y-5">
                {/* Cabeçalho da Leitura */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Dados Extraídos</h3>
                    <p className="text-xs text-slate-400">Verifique e edite se necessário</p>
                  </div>
                  <button 
                    onClick={resetAll}
                    className="bg-blue-50 hover:bg-blue-100 text-[#003865] px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Nova Leitura</span>
                  </button>
                </div>

                {/* Prévia da Foto Enviada */}
                {capturedImage && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 h-28 w-full bg-slate-100">
                    <img 
                      src={capturedImage} 
                      alt="Prévia da Etiqueta" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Container dos Campos Extraídos */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Parâmetros analisados</span>
                    
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button 
                          onClick={handleCancelEdit}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 transition-all"
                        >
                          Cancelar
                        </button>
                        <button 
                          onClick={handleSaveEdit}
                          className="text-xs font-semibold text-white bg-[#003865] hover:bg-[#004e8c] px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all"
                        >
                          <Save className="w-3 h-3" />
                          <span>Salvar</span>
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="text-xs font-semibold text-[#003865] hover:text-[#004e8c] px-2.5 py-1 rounded-lg border border-blue-100 hover:bg-blue-50/50 flex items-center gap-1 transition-all"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Editar</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-3.5">
                    {(Object.keys(fieldLabels) as Array<keyof ScanData>).map((field) => {
                      const label = fieldLabels[field];
                      const value = data[field];
                      const editedValue = editedData[field];

                      return (
                        <div key={field} className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                            {label}
                          </label>
                          
                          {isEditing ? (
                            <input 
                              type="text"
                              value={editedValue}
                              onChange={(e) => setEditedData({ ...editedData, [field]: e.target.value })}
                              className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-lg px-3 py-1.5 text-sm text-slate-800 outline-none transition-all"
                            />
                          ) : (
                            <div className="flex items-center justify-between bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5 transition-colors group">
                              <span className={`text-sm ${value ? 'text-slate-800 font-medium' : 'text-slate-400 italic'}`}>
                                {value || 'Não encontrado'}
                              </span>
                              
                              {value && (
                                <button 
                                  onClick={() => handleCopyField(field, value)}
                                  className="text-slate-400 hover:text-[#003865] p-1 rounded-md hover:bg-white transition-all shadow-none hover:shadow-sm"
                                  title="Copiar Campo"
                                >
                                  {copiedField === field ? (
                                    <Check className="w-3.5 h-3.5 text-blue-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AVISO DE DUPLICIDADE */}
                {equipmentExistsInDb && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs text-amber-900">
                    <div className="flex items-start gap-2 font-bold">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                      <span>Atenção: Este equipamento (GPON: {data.gpon_sn}) já está cadastrado no banco!</span>
                    </div>
                    <p className="text-amber-800/90 leading-relaxed">
                      Você pode editar os dados acima e clicar no botão abaixo para <strong>sobrescrever/atualizar</strong> os dados existentes.
                    </p>
                    {existingEquipmentData && (
                      <div className="bg-amber-100/50 p-2.5 rounded-lg border border-amber-200/50 space-y-1 font-mono text-[10px] text-amber-800">
                        <div className="font-bold border-b border-amber-200/50 pb-1 mb-1">Dados anteriores salvos:</div>
                        <div>• Fabricante: {existingEquipmentData.fabricante} ({existingEquipmentData.modelo})</div>
                        <div>• MAC: {existingEquipmentData.mac}</div>
                        <div>• Wi-Fi Key: {existingEquipmentData.wifi_key}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* BOTÃO DE SALVAR NO BANCO DE DADOS (POSTGRESQL) */}
                <div className="space-y-2">
                  <button
                    onClick={async () => {
                      setIsSavingDb(true);
                      setDbMessage(null);
                      try {
                        const response = await fetch('/api/save-label', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({
                            ...data,
                            operador: user?.email || 'admin@scanonu.com',
                            overwrite: equipmentExistsInDb // Se já existe, envia para sobrescrever
                          })
                        });
                        const result = await response.json();
                        if (result.success) {
                          setDbMessage({ type: 'success', text: result.message || 'Salvo no PostgreSQL!' });
                          // Desativar aviso após salvar com sucesso
                          setEquipmentExistsInDb(false);
                        } else {
                          throw new Error(result.error || 'Erro ao conectar ao banco.');
                        }
                      } catch (err: any) {
                        setDbMessage({ type: 'error', text: err.message || 'Falha ao salvar no banco.' });
                      } finally {
                        setIsSavingDb(false);
                      }
                    }}
                    disabled={isSavingDb || isEditing}
                    className={`w-full font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md transition-all text-sm ${
                      equipmentExistsInDb 
                        ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 shadow-amber-600/15 text-white' 
                        : 'bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] shadow-blue-900/10 text-white'
                    }`}
                  >
                    {isSavingDb ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>{equipmentExistsInDb ? 'Sobrescrevendo dados...' : 'Gravando no PostgreSQL...'}</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>{equipmentExistsInDb ? 'Sobrescrever/Atualizar no PostgreSQL' : 'Enviar para o PostgreSQL'}</span>
                      </>
                    )}
                  </button>

                  {dbMessage && (
                    <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                      dbMessage.type === 'success' 
                        ? 'bg-blue-50 border-blue-200 text-blue-800' 
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}>
                      {dbMessage.type === 'success' ? (
                        <Check className="w-4 h-4 text-blue-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                      )}
                      <span>{dbMessage.text}</span>
                    </div>
                  )}
                </div>

                {/* Seção Sanfonada (Collapsible Card) com JSON Cru */}
                <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
                  <button 
                    onClick={() => setShowJsonRaw(!showJsonRaw)}
                    className="w-full px-4 py-3 bg-slate-50/50 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-semibold text-sm text-slate-700">JSON Estruturado</span>
                    {showJsonRaw ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  
                  {showJsonRaw && (
                    <div className="p-4 border-t border-slate-100 bg-slate-900 text-slate-300 font-mono text-[10px] space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <span className="text-slate-500">raw_output.json</span>
                        <button 
                          onClick={handleCopyJson}
                          className="text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800/80 hover:bg-slate-800 px-2 py-1 rounded-md transition-colors"
                        >
                          {copiedJson ? (
                            <>
                              <Check className="w-3 h-3 text-blue-400" />
                              <span>Copiado!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copiar JSON</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48">
                        {JSON.stringify(editedData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="py-4 text-center border-t border-slate-200/60 bg-white">
        <div className="max-w-2xl mx-auto w-full">
          <p className="text-[10px] text-slate-400">ScanONU &copy; {new Date().getFullYear()} - Assistente de Campo</p>
        </div>
      </footer>
    </div>
  );
}
