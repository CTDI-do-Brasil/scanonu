import React, { useState, useRef, useEffect } from 'react';
// @ts-ignore
import logoCtdi from './assets/logo-ctdi.png';
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
  LogOut,
  Users,
  UserPlus,
  Download,
  Eye,
  EyeOff,
  Search,
  ArrowLeft,
  Menu,
  BarChart3,
  Printer,
  Monitor,
  MapPin,
  Trash2
, MonitorPlay, Edit, Plus } from 'lucide-react';


interface ScanData {
  fabricante: string;
  modelo: string;
  cpe_sn: string;
  gpon_sn: string;
  mac: string;
  wifi_ssid: string;
  wifi_ssid_5g: string;
  wifi_key: string;
  usuario: string;
  senha: string;
  reimpressa?: boolean;
}

interface BatchItem {
  id: string;
  fileName: string;
  image: string;
  data: ScanData;
  status: 'pending' | 'processing' | 'success' | 'error' | 'duplicate' | 'saved';
  existsInDb: boolean;
  existingData: ScanData | null;
  errorMsg: string | null;
  dbMessage: { type: 'success' | 'error'; text: string } | null;
  isSaving: boolean;
}

const DEFAULT_SCAN_DATA: ScanData = {
  fabricante: '',
  modelo: '',
  cpe_sn: '',
  gpon_sn: '',
  mac: '',
  wifi_ssid: '',
  wifi_ssid_5g: '',
  wifi_key: '',
  usuario: '',
  senha: '',
  reimpressa: false
};

function applyMacSsidRules(currentData: ScanData): ScanData {
  const dataCopy = { ...currentData };
  const modelUpper = (dataCopy.modelo || '').toUpperCase();
  const mfgUpper = (dataCopy.fabricante || '').toUpperCase();
  const isKaon = modelUpper.includes('KAON') || mfgUpper.includes('KAON') || modelUpper.includes('PG2447') || modelUpper.startsWith('PG');

  // PG2447 and BCSKV630 do not use CPE SN, set to N/A
  if (modelUpper.includes('PG2447') || modelUpper.includes('BCSKV630') || modelUpper.includes('BCSK') || mfgUpper.includes('BLU')) {
    dataCopy.cpe_sn = 'N/A';
  }

  if (!dataCopy.mac) return dataCopy;
  
  // Clean MAC (remove colons, hyphens, spaces, and make uppercase)
  const cleanMac = dataCopy.mac.replace(/[:\s-]/g, '').toUpperCase();
  if (cleanMac.length < 4) return dataCopy;
  
  const last4Hex = cleanMac.slice(-4);
  const last4Int = parseInt(last4Hex, 16);
  if (isNaN(last4Int)) return dataCopy;

  // Rule 1: KAON
  if (isKaon) {
    dataCopy.wifi_ssid = `LIVE TIM_${last4Hex}_2G`;
    dataCopy.wifi_ssid_5g = `LIVE TIM_${last4Hex}_5G`;
  }
  
  // Rule 1.5: BLU-CASTLE BCSKV630
  else if (modelUpper.includes('BCSKV630') || modelUpper.includes('BCSK')) {
    dataCopy.wifi_ssid = `TIM_ULTRAFIBRA_${last4Hex}_2G`;
    dataCopy.wifi_ssid_5g = `TIM_ULTRAFIBRA_${last4Hex}_5G`;
  }
  
  // Rule 2 & 3: F@ST 5655V2
  else if (modelUpper.includes('5655V2') || modelUpper.includes('5655 V2')) {
    // Check which format to use. We check if current scanned SSID has "LIVE" or if the 5G SSID has value
    const isLiveTim = (dataCopy.wifi_ssid || '').toUpperCase().includes('LIVE') || 
                      (dataCopy.wifi_ssid_5g || '').toUpperCase().includes('LIVE') ||
                      (dataCopy.modelo || '').toUpperCase().includes('LIVE') ||
                      (dataCopy.wifi_ssid === '' && dataCopy.wifi_ssid_5g !== '');
    
    if (isLiveTim) {
      // Subtract 3 in hexadecimal
      const sub3Int = (last4Int - 3 + 0x10000) % 0x10000;
      const sub3Hex = sub3Int.toString(16).toUpperCase().padStart(4, '0');
      dataCopy.wifi_ssid = `LIVE TIM_${sub3Hex}_2G`;
      dataCopy.wifi_ssid_5g = `LIVE TIM_${sub3Hex}_5G`;
    } else {
      // Subtract 7 in hexadecimal (TIM_ULTRAFIBRA_XXXX)
      const sub7Int = (last4Int - 7 + 0x10000) % 0x10000;
      const sub7Hex = sub7Int.toString(16).toUpperCase().padStart(4, '0');
      dataCopy.wifi_ssid = `TIM_ULTRAFIBRA_${sub7Hex}`;
      dataCopy.wifi_ssid_5g = ''; // Only one Wi-Fi network
    }
  }

  // Rule for 5676V2 5G SSID formatting
  if (modelUpper.includes('5676V2') || modelUpper.includes('5676 V2')) {
    if (dataCopy.wifi_ssid_5g && dataCopy.wifi_ssid_5g !== 'N/A' && dataCopy.wifi_ssid_5g.trim() !== '') {
      if (!dataCopy.wifi_ssid_5g.toUpperCase().endsWith('_5G')) {
        dataCopy.wifi_ssid_5g = dataCopy.wifi_ssid_5g.trim() + '_5G';
      }
    }
  }
  
  return dataCopy;
}

export default function App() {
  // Autenticação
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [activeModule, setActiveModule] = useState<'selection' | 'gpon' | 'iptv'>('selection');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Administração
  const [adminTab, setAdminTab] = useState<'scan' | 'admin'>('scan');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [usersList, setUsersList] = useState<Array<{ id?: number; email: string; role: string; operacao?: string }>>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operador');
  const [newOperacao, setNewOperacao] = useState('CTDI MATRIZ');
  const [adminMessage, setAdminMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const currentVersionRef = useRef<string | null>(null);

  // Estados para edição/reset de senha de usuários
  const [editingUser, setEditingUser] = useState<{ id?: number; email: string; role: string; operacao?: string } | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('operador');
  const [editOperacao, setEditOperacao] = useState('CTDI MATRIZ');
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);

  // Filtros de Exportação
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [adminSubTab, setAdminSubTab] = useState<'metrics' | 'export' | 'users' | 'printers' | 'iptv-models'>('metrics');
  
  // Impressoras
  const [printers, setPrinters] = useState<any[]>([]);
  const [iptvModels, setIptvModels] = useState<any[]>([]);
  const [isLoadingIptvModels, setIsLoadingIptvModels] = useState(false);
  const [editingIptvModel, setEditingIptvModel] = useState<any>(null);
  const [showIptvModelModal, setShowIptvModelModal] = useState(false);
  const [iptvModelForm, setIptvModelForm] = useState({ nome_modelo: '', codigo_zpl: '', campos_config: '' });
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<any>(null);
  const [printerFormData, setPrinterFormData] = useState({
    nome: '', descricao: '', ip: '', porta: '6101', localizacao: 'CTDI MATRIZ'
  });
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [isUpdatingPrinter, setIsUpdatingPrinter] = useState(false);

  // Estados para Módulo IPTV (declarados no topo para seguir as regras do React)
  const [selectedModel, setSelectedModel] = useState<any>(null);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [fieldsData, setFieldsData] = useState<any>({});
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
      
      // Remover dados gráficos pesados para evitar erro 414 (URL Too Large) no Labelary
      tempZpl = tempZpl.replace(/\^GF[^~^]*/gi, '');

      Object.keys(selectedModel.campos_config || {}).forEach((key) => {
        const val = fieldsData[key] || `[${key.toUpperCase()}]`;
        const regex = new RegExp('\\$\\{\\s*' + key + '\\s*\\}', 'g');
        tempZpl = tempZpl.replace(regex, val);

        const valClean = val.replace(/[^A-Za-z0-9]/g, '');
        const regexClean = new RegExp('\\$\\{\\s*' + key + '_clean\\s*\\}', 'g');
        tempZpl = tempZpl.replace(regexClean, valClean);
      });
      setPreviewZpl(tempZpl);
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedModel, fieldsData]);

  useEffect(() => {
    if (activeModule === 'iptv') {
      if (iptvModels.length === 0) fetchIptvModels();
      if (printers.length === 0) fetchPrinters();
    }
  }, [activeModule]);

  interface StatsData {
    totalLabels: number;
    totalUsers: number;
    labelsByManufacturer: Array<{ fabricante: string; count: string }>;
    labelsByModel: Array<{ modelo: string; count: string }>;
    scansByOperator: Array<{ operador_email: string; count: string }>;
  }

  const [stats, setStats] = useState<StatsData>({
    totalLabels: 0,
    totalUsers: 0,
    labelsByManufacturer: [],
    labelsByModel: [],
    scansByOperator: []
  });
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Estados de Fluxo da Tela: 'idle', 'camera', 'processing', 'result'
  const [screen, setScreen] = useState<'idle' | 'camera' | 'processing' | 'result'>('idle');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [isZoomSupported, setIsZoomSupported] = useState(false);
  
  // Dicas rápidas colapsáveis
  const [showTips, setShowTips] = useState(true);
  
  // Imagem capturada (base64)
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  
  // Dados processados
  const [data, setData] = useState<ScanData>(DEFAULT_SCAN_DATA);
  
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
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // --- SANITIZAÇÃO GLOBAL DE INPUT DO SCANNER (! -> I) ---
  useEffect(() => {
    let hasChanges = false;
    const sanitizedData = { ...data };
    
    // Ignorar senha web na sanitização se necessário, mas o comum é sanitizar tudo
    // já que o scanner confunde ! com I
    const skipFields = ['senha', 'wifi_key']; // Opcional: ignorar campos que podem ter ! de propósito

    for (const [key, value] of Object.entries(sanitizedData)) {
      if (typeof value === 'string' && value.includes('!') && !skipFields.includes(key)) {
        (sanitizedData as any)[key] = value.replace(/!/g, 'I');
        hasChanges = true;
      }
    }
    if (hasChanges) {
      setData(sanitizedData as ScanData);
    }
  }, [data]);


  // Estados de Busca Manual/Ajuste sem Token
  const [searchGponInput, setSearchGponInput] = useState('');
  const [isSearchingGpon, setIsSearchingGpon] = useState(false);
  const [searchGponError, setSearchGponError] = useState<string | null>(null);

  // Estados de Processamento em Lote (Batch)
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchItem[]>([]);
  const [batchStartTime, setBatchStartTime] = useState<number>(0);

  // Referências para Stream da Câmera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const processingFilesRef = useRef(false);

  // Consulta Pública (antes do login)
  const [isPublicQueryMode, setIsPublicQueryMode] = useState(false);
  const [publicQueryInput, setPublicQueryInput] = useState('');
  const [publicQueryResult, setPublicQueryResult] = useState<{
    fabricante: string;
    modelo: string;
    gpon_sn: string;
    mac: string;
    usuario: string;
    senha: string;
  } | null>(null);
  const [publicQueryError, setPublicQueryError] = useState<string | null>(null);
  const [isPublicQuerying, setIsPublicQuerying] = useState(false);
  const [copiedPublicField, setCopiedPublicField] = useState<string | null>(null);

  // Estados para importação de Excel (Admin)
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [importExcelMessage, setImportExcelMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [targetDatabase, setTargetDatabase] = useState<'db-scanonu' | 'ScanONU_Claro'>('db-scanonu');
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);

  // Carrega estado de autenticação do localStorage ao iniciar
  useEffect(() => {
    const storedUser = localStorage.getItem('scanonu_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        if (parsedUser.role === 'consulta') {
          setAdminTab('admin');
          setAdminSubTab('export');
        }
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
    if (!user || (user.role !== 'master' && user.role !== 'admin')) return;
    setIsLoadingUsers(true);
    try {
      const response = await fetch('/api/admin/users', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        }
      });
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

  // Buscar estatísticas do banco de dados
  const fetchStats = async () => {
    if (!user || user.role !== 'master') return;
    setIsLoadingStats(true);
    try {
      const response = await fetch('/api/admin/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setStats(result.stats);
      }
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    if (adminTab === 'admin') {
      fetchUsers();
      fetchStats();
      fetchPrinters();
      fetchIptvModels();
    }
  }, [adminTab]);

  
  const fetchIptvModels = async () => {
    if (!user || user.role !== 'master') return;
    setIsLoadingIptvModels(true);
    try {
      const response = await fetch('/api/iptv-models', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}` }
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

  const handleZplChange = (zpl: string) => {
    // Extrair todas as variáveis do tipo ${variavel}
    const regex = /\${([^}]+)}/g;
    let match;
    const detectedVariables: string[] = [];
    while ((match = regex.exec(zpl)) !== null) {
      const varName = match[1].trim();
      if (varName.endsWith('_clean')) {
        continue;
      }
      if (!detectedVariables.includes(varName)) {
        detectedVariables.push(varName);
      }
    }

    // Tentar fazer parse do JSON atual
    let currentConfig: any = {};
    try {
      currentConfig = JSON.parse(iptvModelForm.campos_config);
    } catch (e) {
      currentConfig = {};
    }

    // Montar nova configuração preservando configurações existentes
    const newConfig: any = {};
    detectedVariables.forEach(v => {
      if (currentConfig[v]) {
        newConfig[v] = currentConfig[v];
      } else {
        const lower = v.toLowerCase();
        if (lower === 'sn' || lower === 'serial' || lower === 'cpe_sn' || lower === 'gpon_sn') {
          newConfig[v] = { label: 'S/N:', minLength: 15, maxLength: 15 };
        } else if (lower === 'mac') {
          newConfig[v] = { label: 'MAC ETHERNET:', minLength: 17, maxLength: 17 };
        } else {
          newConfig[v] = { label: `${v.toUpperCase()}:`, minLength: 0, maxLength: 50 };
        }
      }
    });

    setIptvModelForm({
      ...iptvModelForm,
      codigo_zpl: zpl,
      campos_config: JSON.stringify(newConfig, null, 2)
    });
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

      const url = editingIptvModel ? `/api/admin/iptv-models/${editingIptvModel.id}` : '/api/admin/iptv-models';
      const method = editingIptvModel ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
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
      const response = await fetch(`/api/admin/iptv-models/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}` }
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

  const fetchPrinters = async () => {
    if (!user || user.role !== 'master') return;
    setIsLoadingPrinters(true);
    try {
      const response = await fetch('/api/admin/printers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setPrinters(result.printers);
      }
    } catch (err) {
      console.error('Erro ao buscar impressoras:', err);
    } finally {
      setIsLoadingPrinters(false);
    }
  };

  const handlePublicQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicQueryInput.trim()) {
      setPublicQueryError('Por favor, insira um GPON SN ou MAC válido.');
      return;
    }
    setPublicQueryError(null);
    setPublicQueryResult(null);
    setIsPublicQuerying(true);

    try {
      const response = await fetch(`/api/public/label/${encodeURIComponent(publicQueryInput.trim())}`);
      const result = await response.json();
      if (response.ok && result.success) {
        setPublicQueryResult(result.data);
      } else {
        setPublicQueryError(result.error || 'Equipamento não encontrado.');
      }
    } catch (err) {
      console.error('Erro ao consultar equipamento:', err);
      setPublicQueryError('Erro de conexão ao servidor.');
    } finally {
      setIsPublicQuerying(false);
    }
  };

  const copyPublicField = (fieldId: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedPublicField(fieldId);
    setTimeout(() => setCopiedPublicField(null), 2000);
  };

  
  const checkVersion = async () => {
    try {
      const response = await fetch('/api/version');
      const data = await response.json();
      if (data && data.version) {
        if (!currentVersionRef.current) {
          currentVersionRef.current = data.version;
        } else if (currentVersionRef.current !== data.version) {
          setNewVersionAvailable(true);
        }
      }
    } catch (err) {
      // Ignore errors so it doesn't break anything if backend is temporarily down
    }
  };

  useEffect(() => {
    checkVersion();
  }, []);


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
        localStorage.setItem('scanonu_token', result.token);
        if (result.user.role === 'consulta') {
          setAdminTab('admin');
          setAdminSubTab('export');
        }
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
    localStorage.removeItem('scanonu_token');
    setEmailInput('');
    setPasswordInput('');
    setAdminTab('scan');
    resetAll();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (user.role !== 'master' && user.role !== 'admin')) return;
    setAdminMessage(null);
    setIsCreatingUser(true);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        },
        body: JSON.stringify({
          email: newEmail,
          senha: newPassword,
          role: newRole,
          operacao: newOperacao
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAdminMessage({ type: 'success', text: result.message || 'Usuário cadastrado com sucesso!' });
        setNewEmail('');
        setNewPassword('');
        setNewRole('operador');
        setNewOperacao('CTDI MATRIZ');
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

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (user.role !== 'master' && user.role !== 'admin') || !editingUser) return;
    setEditUserError(null);
    setIsUpdatingUser(true);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        },
        body: JSON.stringify({
          id: editingUser.id,
          email: editEmail,
          senha: editPassword,
          role: editRole,
          operacao: editOperacao
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAdminMessage({ type: 'success', text: result.message || 'Usuário atualizado com sucesso!' });
        setEditingUser(null);
        setEditEmail('');
        setEditPassword('');
        setEditOperacao('CTDI MATRIZ');
        fetchUsers();
      } else {
        setEditUserError(result.error || 'Erro ao atualizar usuário.');
      }
    } catch (err) {
      setEditUserError('Erro de conexão com o servidor.');
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleSavePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (user.role !== 'master' && user.role !== 'admin')) return;
    setPrinterError(null);
    setIsUpdatingPrinter(true);

    try {
      const url = editingPrinter ? `/api/admin/printers/${editingPrinter.id}` : '/api/admin/printers';
      const method = editingPrinter ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        },
        body: JSON.stringify(printerFormData)
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAdminMessage({ type: 'success', text: editingPrinter ? 'Impressora atualizada com sucesso!' : 'Impressora cadastrada com sucesso!' });
        setEditingPrinter(null);
        setPrinterFormData({ nome: '', descricao: '', ip: '', porta: '6101', localizacao: 'CTDI MATRIZ' });
        fetchPrinters();
      } else {
        setPrinterError(result.error || 'Erro ao salvar impressora.');
      }
    } catch (err) {
      setPrinterError('Erro de conexão com o servidor.');
    } finally {
      setIsUpdatingPrinter(false);
    }
  };

  const handleDeletePrinter = async (id: number) => {
    if (!user || user.role !== 'master') return;
    if (!window.confirm('Tem certeza que deseja remover esta impressora?')) return;

    try {
      const response = await fetch(`/api/admin/printers/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        }
      });
      if (response.ok) {
        setAdminMessage({ type: 'success', text: 'Impressora removida com sucesso!' });
        fetchPrinters();
      }
    } catch (err) {
      console.error('Erro ao remover impressora:', err);
    }
  };

  const handleExportExcel = async () => {
    if (!user || (user.role !== 'master' && user.role !== 'admin' && user.role !== 'consulta')) return;
    try {
      const response = await fetch(
        `/api/admin/export-excel?search=${encodeURIComponent(filterSearch)}` +
        `&startDate=${encodeURIComponent(filterStartDate)}` +
        `&endDate=${encodeURIComponent(filterEndDate)}` +
        `&modelo=${encodeURIComponent(filterModel)}` +
        `&targetDb=${targetDatabase}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
          }
        }
      );
      if (!response.ok) {
        throw new Error('Erro ao exportar planilha Excel.');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scanonu_etiquetas.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Erro ao exportar planilha Excel: ' + (err.message || err));
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    setImportExcelMessage(null);
    setImportProgress(null);
    setIsImportingExcel(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          const resultStr = reader.result as string;
          const base64Data = resultStr.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = error => reject(error);
      });

      // 1. Enviar para parsear a planilha no backend
      const parseResponse = await fetch('/api/admin/parse-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
        },
        body: JSON.stringify({ fileBase64: base64 })
      });

      const parseResult = await parseResponse.json();
      if (!parseResponse.ok || !parseResult.success) {
        throw new Error(parseResult.error || 'Erro ao processar/ler a planilha Excel.');
      }

      const rows = parseResult.rows || [];
      if (rows.length === 0) {
        throw new Error('A planilha está vazia ou nenhum registro válido foi encontrado.');
      }

      // 2. Enviar em lotes para atualizar o progresso
      const batchSize = 50;
      let successTotal = 0;
      let errorTotal = 0;
      setImportProgress({ current: 0, total: rows.length });

      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const chunkResponse = await fetch('/api/admin/import-excel-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
          },
          body: JSON.stringify({ rows: chunk, targetDb: targetDatabase })
        });

        const chunkResult = await chunkResponse.json();
        if (!chunkResponse.ok || !chunkResult.success) {
          throw new Error(chunkResult.error || 'Erro ao importar lote de registros.');
        }

        successTotal += chunkResult.successCount || 0;
        errorTotal += chunkResult.errorCount || 0;

        setImportProgress({ current: Math.min(i + batchSize, rows.length), total: rows.length });
      }

      setImportExcelMessage({ 
        type: 'success', 
        text: `Importação concluída! ${successTotal} importados/atualizados com sucesso. ${errorTotal} erros.` 
      });
      fetchStats();
    } catch (err: any) {
      setImportExcelMessage({ type: 'error', text: err.message || 'Erro ao realizar importação.' });
    } finally {
      setIsImportingExcel(false);
      setImportProgress(null);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

    const startCamera = async () => {
    setError(null);
    setScreen('camera');
    try {
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
      
      // CONFIGURAR ZOOM AUTOMÁTICO (Auto-Zoom)
      const [videoTrack] = stream.getVideoTracks();
      const capabilities = videoTrack.getCapabilities() as any;
      if (capabilities && capabilities.zoom) {
        setIsZoomSupported(true);
        setMinZoom(capabilities.zoom.min || 1);
        setMaxZoom(capabilities.zoom.max || 1);
        
        // Aplica um zoom de 2.5x por padrão (ou o máximo se for menor que 2.5)
        const targetZoom = Math.min(2.5, capabilities.zoom.max || 1);
        setZoomLevel(targetZoom);
        await videoTrack.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any);
      } else {
        setIsZoomSupported(false);
      }
      
    } catch (err: any) {
      console.error('Erro ao acessar a câmera:', err);
      setError('Não foi possível acessar a câmera. Verifique se deu permissão ou utilize a Galeria.');
      setScreen('idle');
    }
  };

  
  const handleZoomChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setZoomLevel(newZoom);
    if (streamRef.current) {
      const [videoTrack] = streamRef.current.getVideoTracks();
      try {
        await videoTrack.applyConstraints({ advanced: [{ zoom: newZoom }] } as any);
      } catch (err) {
        console.error('Erro ao aplicar zoom:', err);
      }
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
      
      // Garantir dimensões válidas maiores que zero
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w > 0 ? w : 1280;
      canvas.height = h > 0 ? h : 720;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          let base64 = '';
          try {
            base64 = canvas.toDataURL('image/jpeg', 0.9);
          } catch (e) {
            // Fallback para image/png se o Safari der erro de padrão de string
            base64 = canvas.toDataURL('image/png');
          }
          
          setCapturedImage(base64);
          stopCameraStream();
          processImage(base64);
        } catch (drawErr: any) {
          console.error('Erro ao desenhar/exportar imagem:', drawErr);
          setError('Erro ao capturar a foto do dispositivo: ' + (drawErr.message || drawErr));
          stopCameraStream();
          setScreen('idle');
        }
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (processingFilesRef.current) return;
    processingFilesRef.current = true;

    try {
      if (files.length > 16) {
        setError('Erro: É permitido enviar no máximo 16 unidades por lote.');
        if (e.target) {
          e.target.value = '';
        }
        return;
      }

      if (files.length === 1) {
        // Fluxo de arquivo único existente
        const file = files[0];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setCapturedImage(base64);
        await processImage(base64);
      } else {
        // Fluxo de processamento em Lote (Batch)
        setScreen('idle');
        setIsBatchMode(true);
        setIsBatchProcessing(true);
        setBatchResults([]);
        
        const items: BatchItem[] = [];
        for (let i = 0; i < files.length; i++) {
          items.push({
            id: `batch_${Date.now()}_${i}`,
            fileName: files[i].name,
            image: '',
            data: { ...DEFAULT_SCAN_DATA },
            status: 'pending',
            existsInDb: false,
            existingData: null,
            errorMsg: null,
            dbMessage: null,
            isSaving: false
          });
        }
        setBatchResults(items);
        setBatchStartTime(Date.now());

        // Processar cada imagem em lote sequencialmente
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          if (i > 0) {
            // Atraso de 4.5 segundos para evitar estourar o limite de requisições por minuto (RPM) da cota do Gemini (Free Tier)
            await new Promise(resolve => setTimeout(resolve, 4500));
          }
          
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });

          setBatchResults(prev => prev.map((item, idx) => idx === i ? { ...item, image: base64, status: 'processing' } : item));

          try {
            const localDetection = await detectBarcodeLocally(base64);
            let result: any = null;
            let skipGemini = false;

            const token = localStorage.getItem('scanonu_token');

            if (localDetection) {
              const lookupValue = localDetection.gpon_sn || localDetection.mac;
              if (lookupValue) {
                const dbResponse = await fetch(`/api/label/${encodeURIComponent(lookupValue)}`, {
                  headers: {
                    'Authorization': `Bearer ${token}`
                  }
                });
                if (dbResponse.ok) {
                  const dbResult = await dbResponse.json();
                  if (dbResult.success && dbResult.data) {
                    result = {
                      success: true,
                      existsInDb: true,
                      data: dbResult.data,
                      existingData: dbResult.data
                    };
                    skipGemini = true;
                  }
                }
              }
            }

            if (!skipGemini) {
              const response = await fetch('/api/scan-label', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ image: base64 })
              });
              result = await response.json();
            }

            if (result.success && result.data) {
              let processedData = applyMacSsidRules(result.data);
              
              if (result.data.reimpressa) {
                setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                  ...item, 
                  data: processedData, 
                  status: 'error',
                  errorMsg: 'Etiqueta Reimpressa Bloqueada'
                } : item));
              } else if (result.existsInDb) {
                setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                  ...item, 
                  data: processedData, 
                  status: 'duplicate',
                  existsInDb: true,
                  existingData: result.existingData
                } : item));
              } else {
                // Gravar automaticamente no banco de dados
                setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                  ...item, 
                  data: processedData,
                  isSaving: true
                } : item));

                try {
                  const saveResponse = await fetch('/api/save-label', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      ...processedData,
                      operador: user?.email || 'admin@scanonu.com',
                      overwrite: false
                    })
                  });
                  const saveResult = await saveResponse.json();
                  if (saveResult.success) {
                    setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                      ...item, 
                      status: 'saved',
                      isSaving: false,
                      dbMessage: { type: 'success', text: 'Salvo no banco!' }
                    } : item));
                  } else {
                    throw new Error(saveResult.error + (saveResult.details ? ' Detalhes: ' + saveResult.details : ''));
                  }
                } catch (saveErr: any) {
                  setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                    ...item, 
                    status: 'error',
                    isSaving: false,
                    errorMsg: saveErr.message || 'Falha ao salvar no banco.' 
                  } : item));
                }
              }
            } else {
              const errorMsg = result.error || 'Erro ao ler a etiqueta.';
              const detailsMsg = result.details ? ` Detalhes: ${JSON.stringify(result.details)}` : '';
              setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
                ...item, 
                status: 'error', 
                errorMsg: errorMsg + detailsMsg 
              } : item));
            }
          } catch (err: any) {
            setBatchResults(prev => prev.map((item, idx) => idx === i ? { 
              ...item, 
              status: 'error', 
              errorMsg: err.message || 'Erro de conexão.' 
            } : item));
          }
        }
        setIsBatchProcessing(false);
        checkVersion();
      }
    } finally {
      processingFilesRef.current = false;
      if (e.target) {
        e.target.value = '';
      }
    }
  };


  const retryBatchItem = async (itemId: string) => {
    const item = batchResults.find(it => it.id === itemId);
    if (!item || !item.image) return;

    setBatchResults(prev => prev.map(it => it.id === itemId ? { 
      ...it, 
      status: 'processing', 
      errorMsg: null,
      dbMessage: null 
    } : it));

    try {
      const localDetection = await detectBarcodeLocally(item.image);
      let result: any = null;
      let skipGemini = false;

      const token = localStorage.getItem('scanonu_token');

      if (localDetection) {
        const lookupValue = localDetection.gpon_sn || localDetection.mac;
        if (lookupValue) {
          const dbResponse = await fetch(`/api/label/${encodeURIComponent(lookupValue)}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (dbResponse.ok) {
            const dbResult = await dbResponse.json();
            if (dbResult.success && dbResult.data) {
              result = {
                success: true,
                existsInDb: true,
                data: dbResult.data,
                existingData: dbResult.data
              };
              skipGemini = true;
            }
          }
        }
      }

      if (!skipGemini) {
        const response = await fetch('/api/scan-label', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ image: item.image })
        });
        result = await response.json();
      }

      if (result.success && result.data) {
        let processedData = applyMacSsidRules(result.data);
        
        if (result.data.reimpressa) {
          setBatchResults(prev => prev.map(it => it.id === itemId ? { 
            ...it, 
            data: processedData, 
            status: 'error',
            errorMsg: 'Etiqueta Reimpressa Bloqueada'
          } : it));
        } else if (result.existsInDb) {
          setBatchResults(prev => prev.map(it => it.id === itemId ? { 
            ...it, 
            data: processedData, 
            status: 'duplicate',
            existsInDb: true,
            existingData: result.existingData
          } : it));
        } else {
          // Gravar automaticamente no banco de dados
          setBatchResults(prev => prev.map(it => it.id === itemId ? { 
            ...it, 
            data: processedData,
            isSaving: true
          } : it));

          try {
            const saveResponse = await fetch('/api/save-label', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                ...processedData,
                operador: user?.email || 'admin@scanonu.com',
                overwrite: false
              })
            });
            const saveResult = await saveResponse.json();
            if (saveResult.success) {
              setBatchResults(prev => prev.map(it => it.id === itemId ? { 
                ...it, 
                status: 'saved',
                isSaving: false,
                dbMessage: { type: 'success', text: 'Salvo no banco!' }
              } : it));
            } else {
                    throw new Error(saveResult.error + (saveResult.details ? ' Detalhes: ' + saveResult.details : ''));
            }
          } catch (saveErr: any) {
            setBatchResults(prev => prev.map(it => it.id === itemId ? { 
              ...it, 
              status: 'error',
              isSaving: false,
              errorMsg: saveErr.message || 'Falha ao salvar no banco.' 
            } : it));
          }
        }
      } else {
        const errorMsg = result.error || 'Erro ao ler a etiqueta.';
        const detailsMsg = result.details ? ` Detalhes: ${JSON.stringify(result.details)}` : '';
        setBatchResults(prev => prev.map(it => it.id === itemId ? { 
          ...it, 
          status: 'error', 
          errorMsg: errorMsg + detailsMsg 
        } : it));
      }
    } catch (err: any) {
      setBatchResults(prev => prev.map(it => it.id === itemId ? { 
        ...it, 
        status: 'error', 
        errorMsg: err.message || 'Erro de conexão.' 
      } : it));
    }
  };

  const retryAllFailedBatchItems = async () => {
    const failedItems = batchResults.filter(it => it.status === 'error');
    if (failedItems.length === 0) return;

    setIsBatchProcessing(true);
    setBatchStartTime(Date.now());

    for (let i = 0; i < failedItems.length; i++) {
      const item = failedItems[i];
      if (i > 0) {
        // Atraso de 4.5 segundos para evitar estourar o limite de requisições por minuto (RPM) da cota do Gemini (Free Tier)
        await new Promise(resolve => setTimeout(resolve, 4500));
      }
      await retryBatchItem(item.id);
    }

    setIsBatchProcessing(false);
  };

  // Helper para detectar GPON SN ou MAC a partir de códigos de barras locais em uma imagem base64
  const detectBarcodeLocally = async (base64Image: string): Promise<{ gpon_sn?: string; mac?: string } | null> => {
    if (!('BarcodeDetector' in window)) {
      console.log('BarcodeDetector API não é suportada neste navegador.');
      return null;
    }

    try {
      const img = new Image();
      img.src = base64Image;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const barcodeDetector = new (window as any).BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code']
      });

      const detected = await barcodeDetector.detect(img);
      console.log('Códigos de barras detectados localmente:', detected);

      if (!detected || detected.length === 0) {
        return null;
      }

      for (const item of detected) {
        const rawValue = (item.rawValue || '').trim().toUpperCase();
        
        // Padrão GPON SN: 12 caracteres alfanuméricos começando com 4 letras
        const gponPattern = /^[A-Z]{4}[A-Z0-9]{8}$/;
        if (gponPattern.test(rawValue)) {
          console.log('GPON SN detectado localmente:', rawValue);
          return { gpon_sn: rawValue };
        }

        // Padrão MAC Address: 12 hexadecimais (limpando separadores)
        const cleanMac = rawValue.replace(/[:\s-]/g, '');
        const macPattern = /^[0-9A-F]{12}$/;
        if (macPattern.test(cleanMac)) {
          console.log('MAC Address detectado localmente:', cleanMac);
          return { mac: cleanMac };
        }
      }
    } catch (err) {
      console.error('Erro ao detectar código de barras localmente:', err);
    }

    return null;
  };

  const handleSearchGponForEdit = async () => {
    if (!searchGponInput) {
      setSearchGponError('Insira um GPON Serial Number válido.');
      return;
    }
    setIsSearchingGpon(true);
    setSearchGponError(null);
    setError(null);
    setDbMessage(null);
    
    try {
      const token = localStorage.getItem('scanonu_token');
      const response = await fetch(`/api/label/${encodeURIComponent(searchGponInput.toUpperCase().trim())}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const result = await response.json();
      
      if (response.ok && result.success && result.data) {
        setData(result.data);
        setEquipmentExistsInDb(true);
        setExistingEquipmentData(result.data);
        setCapturedImage(null); // Sem foto associada a esta consulta direta
        setScreen('result');
        setSearchGponInput('');
      } else {
        setSearchGponError(result.error || 'Equipamento não encontrado.');
      }
    } catch (err: any) {
      setSearchGponError('Erro de conexão ao buscar equipamento.');
    } finally {
      setIsSearchingGpon(false);
    }
  };

  const processImage = async (base64Image: string) => {
    setScreen('processing');
    setError(null);
    setEquipmentExistsInDb(false);
    setExistingEquipmentData(null);
    setShowDuplicateModal(false);
    try {
      const token = localStorage.getItem('scanonu_token');
      // 1. Tenta detectar código de barras localmente para evitar gastar token se o equipamento já existir no banco
      console.log('Tentando detectar código de barras localmente...');
      const localDetection = await detectBarcodeLocally(base64Image);
      
      if (localDetection) {
        const lookupValue = localDetection.gpon_sn || localDetection.mac;
        if (lookupValue) {
          console.log(`Buscando no banco por GPON/MAC: ${lookupValue}...`);
          const dbResponse = await fetch(`/api/label/${encodeURIComponent(lookupValue)}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (dbResponse.ok) {
            const dbResult = await dbResponse.json();
            if (dbResult.success && dbResult.data) {
              console.log('Equipamento encontrado no banco localmente (0 tokens gastos!).');
              setData(prevData => {
                const merged = { ...prevData } as any;
                Object.keys(dbResult.data).forEach(key => {
                  const newVal = (dbResult.data as any)[key];
                  const oldVal = merged[key];
                  if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                    merged[key] = newVal;
                  } else if (!oldVal || oldVal.toUpperCase() === 'N/A' || oldVal.toUpperCase() === 'NA' || oldVal.trim() === '') {
                    merged[key] = oldVal || 'N/A';
                  }
                });
                return merged;
              });
              setEquipmentExistsInDb(true);
              setExistingEquipmentData(dbResult.data);
              setShowDuplicateModal(true);
              setScreen('result');
              return; // Sai do fluxo economizando o token!
            }
          }
        }
      }

      // 2. Se não encontrou no banco, prossegue com Gemini (gastando 1 token)
      console.log('Código de barras não detectado localmente ou não cadastrado no banco. Chamando Gemini Vision...');
      const response = await fetch('/api/scan-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ image: base64Image })
      });

      const result = await response.json();

      if (result.success && result.data) {
        if (result.data.reimpressa) {
          throw new Error('A etiqueta enviada foi identificada como REIMPRESSA e o envio foi bloqueado.');
        }
        if (result.existsInDb && result.existingData) {
          setData(prevData => {
            const merged = { ...prevData } as any;
            
            // 1. Mesclar a captura atual (ex: senhas e SSID capturados pelo Gemini)
            const scanData = result.data || {};
            Object.keys(scanData).forEach(key => {
              const val = scanData[key];
              if (val && val.toUpperCase() !== 'N/A' && val.toUpperCase() !== 'NA' && val.trim() !== '') {
                merged[key] = val;
              }
            });

            // 2. Mesclar os dados existentes no banco (ex: SN/MAC/GPON pre-carregados)
            Object.keys(result.existingData).forEach(key => {
              const newVal = (result.existingData as any)[key];
              if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                merged[key] = newVal;
              }
            });
            
            return applyMacSsidRules(merged);
          });
          setEquipmentExistsInDb(true);
          setExistingEquipmentData(result.existingData);
          setShowDuplicateModal(true);
        } else {
          setData(prevData => {
            const merged = { ...prevData } as any;
            Object.keys(result.data).forEach(key => {
              const newVal = (result.data as any)[key];
              const oldVal = merged[key];
              if (newVal && newVal.toUpperCase() !== 'N/A' && newVal.toUpperCase() !== 'NA' && newVal.trim() !== '') {
                merged[key] = newVal;
              } else if (!oldVal || oldVal.toUpperCase() === 'N/A' || oldVal.toUpperCase() === 'NA' || oldVal.trim() === '') {
                merged[key] = oldVal || 'N/A';
              }
            });
            return applyMacSsidRules(merged);
          });
        }
        setScreen('result');
      } else {
        const errorMsg = result.error || 'Erro desconhecido ao ler a etiqueta.';
        const detailsMsg = result.details ? ` Detalhes: ${JSON.stringify(result.details)}` : '';
        throw new Error(errorMsg + detailsMsg);
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
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const resetAll = () => {
    setCapturedImage(null);
    setData(DEFAULT_SCAN_DATA);
    setError(null);
    setEquipmentExistsInDb(false);
    setExistingEquipmentData(null);
    setDbMessage(null);
    setShowDuplicateModal(false);
    setIsBatchMode(false);
    setIsBatchProcessing(false);
    setBatchResults([]);
    setSearchGponInput('');
    setSearchGponError(null);
    setScreen('idle');
  };

  const handleGoBackToModules = () => {
    resetAll();
    setActiveModule('selection');
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  // Mapeamento amigável para rótulos de campos
  const fieldLabels: Omit<Record<keyof ScanData, string>, 'reimpressa'> = {
    fabricante: 'Fabricante',
    modelo: 'Modelo',
    cpe_sn: 'CPE Serial (S/N)',
    gpon_sn: 'GPON Serial (S/N)',
    mac: 'Endereço MAC',
    wifi_ssid: 'SSID Wi-Fi 2.4GHz / Único',
    wifi_ssid_5g: 'SSID Wi-Fi 5GHz',
    wifi_key: 'Senha WIFI',
    usuario: 'Usuário Padrão',
    senha: 'Senha WEB'
  };

  // RENDERIZAÇÃO DA ÁREA DE LOGIN OU CONSULTA PÚBLICA
  if (!user) {
    if (isPublicQueryMode) {
      return (
        <div className="min-h-screen flex flex-col justify-between bg-[#002f56] text-slate-800 font-sans p-6">
          <div className="flex-1 flex flex-col justify-center items-center w-full animate-scaleUp">
            {/* Card de Consulta */}
            <div className="bg-white rounded-[2.5rem] px-8 py-10 shadow-2xl w-full max-w-sm flex flex-col items-center">
              {/* Logo CTDI */}
              <div className="mb-4 flex flex-col items-center">
                <img src={logoCtdi} alt="Logo CTDI" className="w-48 h-auto object-contain mb-1" />
              </div>

              {/* Título */}
              <div className="mb-6 flex flex-col items-center border-t border-slate-100 w-full pt-4 text-center">
                <div className="flex items-center gap-2 mb-1">
                  <div className="bg-[#003865] text-white p-1.5 rounded-lg">
                    <Search className="w-5 h-5" />
                  </div>
                  <span className="font-bold text-lg text-slate-800 tracking-tight">Consulta Rápida</span>
                </div>
                <p className="text-xs text-slate-500 max-w-xs mt-1">
                  Consulte usuário e senha de acesso da ONU pelo GPON SN, MAC ou Rede Wi-Fi.
                </p>
              </div>

              {publicQueryError && (
                <div className="w-full bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2 text-xs text-red-800 mb-4">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{publicQueryError}</span>
                </div>
              )}

              <form onSubmit={handlePublicQuery} className="w-full space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-[#002f56] block">GPON SN, MAC ou Rede Wi-Fi (SSID)</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ex: GPON, MAC ou Rede Wi-Fi"
                    value={publicQueryInput}
                    onChange={(e) => setPublicQueryInput(e.target.value.toUpperCase().trim())}
                    className="w-full bg-white border border-slate-300 focus:border-[#002f56] focus:ring-1 focus:ring-[#002f56] rounded-2xl px-4 py-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 font-mono"
                  />
                </div>

                <button 
                  type="submit"
                  disabled={isPublicQuerying}
                  className="w-full bg-[#002f56] hover:bg-[#004075] active:bg-[#001d36] disabled:bg-[#002f56]/60 text-white font-bold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-md transition-all text-sm"
                >
                  {isPublicQuerying ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <span>Consultar Equipamento</span>
                  )}
                </button>
              </form>

              {publicQueryResult && (
                <div className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-4 shadow-inner mt-5 space-y-3.5 animate-fadeIn">
                  <div className="text-center pb-2 border-b border-slate-200">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Equipamento Encontrado</span>
                    <span className="text-xs font-bold text-[#003865] block mt-0.5">
                      {publicQueryResult.fabricante} ({publicQueryResult.modelo})
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs text-left w-full">
                    {/* GPON SN */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">GPON Serial (S/N)</span>
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono">
                        <span className="text-slate-700 font-bold">{publicQueryResult.gpon_sn}</span>
                        <button
                          onClick={() => copyPublicField('gpon', publicQueryResult.gpon_sn)}
                          className="text-slate-400 hover:text-[#003865] transition-colors p-1"
                        >
                          {copiedPublicField === 'gpon' ? <Check className="w-3.5 h-3.5 text-blue-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* MAC */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Endereço MAC</span>
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono">
                        <span className="text-slate-700 font-bold">{publicQueryResult.mac}</span>
                        <button
                          onClick={() => copyPublicField('mac', publicQueryResult.mac)}
                          className="text-slate-400 hover:text-[#003865] transition-colors p-1"
                        >
                          {copiedPublicField === 'mac' ? <Check className="w-3.5 h-3.5 text-blue-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Usuário */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Usuário de Acesso</span>
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-slate-800 font-bold">{publicQueryResult.usuario || 'Não informado'}</span>
                        <button
                          onClick={() => copyPublicField('user', publicQueryResult.usuario || '')}
                          className="text-slate-400 hover:text-[#003865] transition-colors p-1"
                          disabled={!publicQueryResult.usuario}
                        >
                          {copiedPublicField === 'user' ? <Check className="w-3.5 h-3.5 text-blue-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Senha */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Senha de Acesso</span>
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-slate-800 font-bold">{publicQueryResult.senha || 'Não informado'}</span>
                        <button
                          onClick={() => copyPublicField('pass', publicQueryResult.senha || '')}
                          className="text-slate-400 hover:text-[#003865] transition-colors p-1"
                          disabled={!publicQueryResult.senha}
                        >
                          {copiedPublicField === 'pass' ? <Check className="w-3.5 h-3.5 text-blue-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsPublicQueryMode(false)}
                className="mt-6 flex items-center justify-center gap-1.5 text-xs font-bold text-[#002f56] hover:underline"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar ao Login</span>
              </button>
            </div>
          </div>

          {/* Footer */}
          <footer className="py-2 text-center text-[10px] text-blue-200/50">
            SMART SCAN &copy; {new Date().getFullYear()} - Assistente de Campo
          </footer>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#002f56] text-slate-800 font-sans p-6">
        <div className="flex-1 flex flex-col justify-center items-center w-full">
          {/* Card de Login */}
          <div className="bg-white rounded-[2.5rem] px-8 py-10 shadow-2xl w-full max-w-sm flex flex-col items-center">
            {/* Logo CTDI */}
            <div className="mb-4 flex flex-col items-center">
              <img src={logoCtdi} alt="Logo CTDI" className="w-48 h-auto object-contain mb-1" />
            </div>

            {/* Logo ScanONU */}
            <div className="mb-6 flex flex-col items-center border-t border-slate-100 w-full pt-4">
              <div className="flex items-center gap-2">
                <div className="bg-[#003865] text-white p-1.5 rounded-lg">
                  <Cpu className="w-5 h-5" />
                </div>
                <span className="font-extrabold text-lg text-slate-800 tracking-tight">SMART SCAN</span>
              </div>
            </div>

            {loginError && (
              <div className="w-full bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2 text-xs text-red-800 mb-4">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="w-full space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-[#002f56] block">E-mail ou Usuário</label>
                <input 
                  type="text" 
                  required
                  placeholder="ex: seu.email@ctdibrasil.com.br"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-white border border-slate-300 focus:border-[#002f56] focus:ring-1 focus:ring-[#002f56] rounded-2xl px-4 py-3.5 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              <div className="space-y-1.5 relative">
                <label className="text-sm font-bold text-[#002f56] block">Senha</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    required
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-white border border-slate-300 focus:border-[#002f56] focus:ring-1 focus:ring-[#002f56] rounded-2xl pl-4 pr-12 py-3.5 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="text-left w-full">
                <button
                  type="button"
                  onClick={() => alert("Por favor, entre em contato com o suporte ou administrador do sistema para recuperar sua senha.")}
                  className="text-xs font-bold text-[#002f56] hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>

              <button 
                type="submit"
                disabled={isLoggingIn}
                className="w-full bg-[#002f56] hover:bg-[#004075] active:bg-[#001d36] disabled:bg-[#002f56]/60 text-white font-bold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-md transition-all text-base mt-2"
              >
                {isLoggingIn ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <span>Entrar no Sistema</span>
                )}
              </button>
            </form>

            <div className="border-t border-slate-100 my-4 pt-4 w-full">
              <button
                type="button"
                onClick={() => {
                  setIsPublicQueryMode(true);
                  setPublicQueryInput('');
                  setPublicQueryResult(null);
                  setPublicQueryError(null);
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all text-sm border border-slate-200 shadow-sm"
              >
                <Search className="w-4 h-4 text-slate-500" />
                <span>Consulta Rápida</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Login */}
        <footer className="py-2 text-center text-[10px] text-blue-200/50">
          SMART SCAN &copy; {new Date().getFullYear()} - Assistente de Campo
        </footer>
      </div>
    );
  }

  // APLICAÇÃO APÓS LOGADA (SCANNER)
  
  if (activeModule === 'selection') {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-[#002f56] p-6 animate-fadeIn relative">
        {newVersionAvailable && (
          <div className="absolute top-4 left-4 right-4 bg-orange-500 text-white px-4 py-3 shadow-md flex items-center justify-between z-[100] rounded-xl max-w-4xl mx-auto">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin-slow" />
              <span className="text-sm font-semibold">Uma nova atualização está disponível!</span>
            </div>
            <button onClick={() => window.location.reload()} className="bg-white text-orange-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-50">
              Atualizar Agora
            </button>
          </div>
        )}
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-white tracking-tight mb-2">SMART SCAN</h1>
          <p className="text-blue-200/80 font-medium">Selecione o módulo de operação</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 w-full max-w-3xl">
          {/* Módulo GPON */}
          <button
            onClick={() => setActiveModule('gpon')}
            className="flex-1 bg-white hover:bg-slate-50 transition-all rounded-[2rem] p-8 flex flex-col items-center justify-center gap-4 shadow-xl hover:-translate-y-2 hover:shadow-2xl group"
          >
            <div className="bg-[#003865]/10 p-4 rounded-2xl group-hover:bg-[#003865]/20 transition-colors">
              <Cpu className="w-12 h-12 text-[#003865]" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-800 mb-1">Módulo GPON</h2>
              <p className="text-sm text-slate-500 font-medium">Captura e Auditoria de ONUs</p>
            </div>
          </button>

          {/* Módulo IPTV */}
          <button
            onClick={() => setActiveModule('iptv')}
            className="flex-1 bg-white hover:bg-slate-50 transition-all rounded-[2rem] p-8 flex flex-col items-center justify-center gap-4 shadow-xl hover:-translate-y-2 hover:shadow-2xl group border-2 border-transparent hover:border-blue-500/20"
          >
            <div className="bg-blue-500/10 p-4 rounded-2xl group-hover:bg-blue-500/20 transition-colors">
              <MonitorPlay className="w-12 h-12 text-blue-600" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-800 mb-1">Módulo IPTV</h2>
              <p className="text-sm text-slate-500 font-medium">Reimpressão e Setup Box</p>
            </div>
          </button>
        </div>
        
        <button 
          onClick={() => { setUser(null); localStorage.removeItem('scanonu_token'); }}
          className="mt-12 text-white/50 hover:text-white transition-colors text-sm font-semibold flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sair
        </button>
      </div>
    );
  }

  
  if (activeModule === 'iptv') {

    
    const handleFieldChange = (key: string, value: string) => {
      // Automagicamente troca ! por I para corrigir bugs de scanner no mobile
      const sanitized = value.replace(/!/g, 'I');
      setFieldsData({ ...fieldsData, [key]: sanitized.trim() });
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
          alert(`O campo ${config.label} precisa ter no mínimo ${config.minLength} caracteres. (Atual: ${val.length})`);
          return;
        }
        if (config.maxLength && val.length > config.maxLength) {
          alert(`O campo ${config.label} não pode ter mais de ${config.maxLength} caracteres. (Atual: ${val.length})`);
          return;
        }
      }

      setIsPrinting(true);
      try {
        if (selectedPrinter === 'usb_local') {
          // HACK ABSOLUTO: Bypass do Chrome 149 usando window.open para escapar do CORS/PNA
          // Isso vai abrir uma nova aba rapidamente chamando nosso Proxy Local, que vai imprimir e fechar.
          try {
            // Encode the ZPL to pass in URL
            const encodedZpl = encodeURIComponent(previewZpl);
            
            // Abre o nosso proxy em uma nova janela temporária
            // A navegação top-level é IMUNE ao bloqueio PNA de CORS
            window.open('http://127.0.0.1:9105/print?zpl=' + encodedZpl, 'ZebraPrint', 'width=300,height=200,left=-1000,top=-1000');
            
            alert('Etiqueta enviada para a impressora USB local com sucesso!');
            setFieldsData({});
            
          } catch (error: any) {
            throw new Error(`Erro ao tentar abrir janela de impressão: ${error.message}`);
          }
          return;
        }

        const response = await fetch('/api/print-iptv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
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
      } catch (err: any) {
        console.error(err);
        alert(err.message || 'Erro ao se conectar com o servidor para impressão.');
      } finally {
        setIsPrinting(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <header className="bg-[#003865] text-white p-4 shadow-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={handleGoBackToModules} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
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

        <main className="flex-1 p-6 flex flex-col items-center w-full">
          {/* Tab Selector for IPTV Module */}
          {['master', 'admin'].includes(user?.role || '') && (
            <div className="flex border-b border-slate-200 mb-6 w-full max-w-2xl bg-white rounded-t-2xl px-6 pt-2 shadow-sm border-x border-t border-slate-200/60">
              <button
                onClick={() => setIptvTab('print')}
                className={`py-3 px-6 font-bold text-sm border-b-2 transition-all ${
                  iptvTab === 'print' ? 'border-[#003865] text-[#003865]' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Imprimir Etiqueta
              </button>
              <button
                onClick={() => setIptvTab('models')}
                className={`py-3 px-6 font-bold text-sm border-b-2 transition-all ${
                  iptvTab === 'models' ? 'border-[#003865] text-[#003865]' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Modelos IPTV
              </button>
            </div>
          )}

          {iptvTab === 'print' ? (
            <div className={`w-full grid grid-cols-1 ${selectedModel ? 'max-w-5xl lg:grid-cols-12 gap-8' : 'max-w-2xl'}`}>
              <div className={`bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8 ${selectedModel ? 'lg:col-span-7' : ''}`}>
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
                  <option value="usb_local">🔌 USB LOCAL (Zebra Browser Print)</option>
                  {printers.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.ip})</option>)}
                </select>
              </div>
            </div>

            {selectedModel ? (
              <div className="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <h3 className="font-bold text-[#003865] mb-4">Dados da Etiqueta</h3>
                {(() => {
                  const FIELD_ORDER = ['sn', 'serial', 'cpe_sn', 'gpon_sn', 'ca_id', 'sc_id', 'mac'];
                  return Object.entries(selectedModel.campos_config || {})
                    .filter(([key]) => !key.endsWith('_clean'))
                    .sort(([keyA], [keyB]) => {
                      const idxA = FIELD_ORDER.indexOf(keyA.toLowerCase());
                      const idxB = FIELD_ORDER.indexOf(keyB.toLowerCase());
                      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                      if (idxA !== -1) return -1;
                      if (idxB !== -1) return 1;
                      return keyA.localeCompare(keyB);
                    })
                    .map(([key, config]: [string, any]) => (
                      <div key={key}>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          {config.label} {config.minLength ? `(${config.minLength} chars)` : ''}
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
                    ));
                })()}

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

              {selectedModel && (
                <div className="lg:col-span-5 bg-white rounded-3xl shadow-sm border border-slate-200/60 p-8 flex flex-col items-center justify-start h-fit">
                  <h3 className="text-lg font-bold text-[#003865] mb-4 border-b border-slate-100 pb-2 w-full text-center flex items-center justify-center gap-2">
                    <MonitorPlay className="w-4 h-4" /> Layout da Etiqueta
                  </h3>
                  {previewZpl ? (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-center min-h-[300px] w-full">
                      <img 
                        src={`https://api.labelary.com/v1/printers/8dpmm/labels/4x3.5/0/${encodeURIComponent(previewZpl)}`} 
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
                      campos_config: '{\n  "sn": { "label": "S/N:", "minLength": 15, "maxLength": 15 },\n  "mac": { "label": "MAC ETHERNET:", "minLength": 17, "maxLength": 17 }\n}'
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
                      placeholder="^XA...^FD${sn}^FS...^XZ"
                    ></textarea>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Configuração de Campos (JSON)</label>
                    <p className="text-[10px] text-slate-500 mb-2 leading-tight">
                      Defina os campos obrigatórios e suas travas (min/max length). Exemplo:<br/>
                      <code>{"{ \"sn\": { \"label\": \"S/N:\", \"minLength\": 15, \"maxLength\": 15 } }"}</code>
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
  }


  return (
    <div className={`min-h-screen flex bg-slate-50 text-slate-800 font-sans w-full ${['master', 'consulta'].includes(user?.role || '') ? 'flex-col md:flex-row' : 'flex-col'}`}>
      {/* SIDEBAR PARA ADMIN / CONSULTA */}
      {['master', 'consulta'].includes(user?.role || '') ? (
        <>
          {/* Mobile Header (Only visible on small screens for Admin) */}
          <div className="md:hidden flex items-center justify-between bg-white border-b border-slate-200/60 px-4 py-3 sticky top-0 z-40 w-full">
            <div className="flex items-center gap-2">
              <button 
                onClick={handleGoBackToModules}
                className="text-slate-500 hover:text-[#003865] p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Voltar aos Módulos"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="bg-[#003865] text-white p-1.5 rounded-lg">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-slate-800">SMART SCAN</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={openInNewTab}
                className="text-slate-500 hover:text-[#003865] p-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Abrir em Nova Aba"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              {user?.role === 'master' && (
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none"
                >
                  <Menu className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>

          {/* Sidebar Drawer Container */}
          <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#003865] text-white transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out md:static md:flex md:flex-col shadow-xl md:shadow-none ${(user?.role === 'consulta' || user?.role === 'admin') ? 'hidden md:hidden' : ''}`}>
            {/* Sidebar Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="bg-white text-[#003865] p-1.5 rounded-lg">
                  <Cpu className="w-5 h-5" />
                </div>
                <span className="font-extrabold text-lg tracking-tight">SMART SCAN</span>
                <div className="h-6 w-px bg-white/20 mx-1"></div>
                <div className="bg-white rounded p-0.5 shadow-sm">
                  <img src={logoCtdi} alt="CTDI" className="h-4 w-auto object-contain" />
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="md:hidden text-white/75 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sidebar Navigation */}
            <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-200/50 px-3 mb-2">Geral</div>
              <button
                onClick={() => {
                  setAdminTab('scan');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'scan'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Camera className="w-4 h-4" />
                Escaneador
              </button>

              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-200/50 px-3 mt-6 mb-2">Painel Administrativo</div>
              {user?.role !== 'admin' && (
              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('metrics');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'admin' && adminSubTab === 'metrics'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Métricas & Dashboard
              </button>
            )}

              {user?.role !== 'admin' && (
              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('export');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'admin' && adminSubTab === 'export'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Search className="w-4 h-4" />
                Consulta & Exportação
              </button>
            )}

              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('users');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'admin' && adminSubTab === 'users'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                Gerenciar Usuários
              </button>

              {user?.role !== 'admin' && (
              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('printers');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'admin' && adminSubTab === 'printers'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Printer className="w-4 h-4" />
                Gerenciar Impressoras
              </button>
            )}

              {user?.role === 'master' && (
              <button
                onClick={() => setAdminSubTab('iptv-models')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  adminSubTab === 'iptv-models'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Modelos IPTV
              </button>
              )}


              {user?.role === 'master' && (
              <button
                onClick={() => {
                  setAdminTab('admin');
                  setAdminSubTab('iptv-models');
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                  adminTab === 'admin' && adminSubTab === 'iptv-models'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-blue-100/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <MonitorPlay className="w-4 h-4" />
                Modelos IPTV
              </button>
              )}

            </nav>

            {/* Sidebar User Profile Section */}
            <div className="p-4 border-t border-white/10 bg-[#002f55]">
              <div className="flex items-center justify-between">
                <div className="overflow-hidden mr-2">
                  <p className="text-xs font-bold truncate text-white">{user?.email}</p>
                  <p className="text-[10px] text-blue-200/70 font-medium capitalize">{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.8</p>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={handleGoBackToModules}
                    className="text-blue-200/70 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    title="Voltar aos Módulos"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={openInNewTab}
                    className="hidden md:flex text-blue-200/70 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    title="Abrir em Nova Aba"
                  >
                    <ExternalLink className="w-4.5 h-4.5" />
                  </button>
                  <button
                    onClick={handleLogout}
                    className="text-red-300 hover:text-red-100 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    title="Sair"
                  >
                    <LogOut className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            </div>
          </aside>

          {/* Sidebar overlay backdrop for mobile */}
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden"
            />
          )}
        </>
      ) : (
        /* Non-admin / Operator Header */
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/60 py-3 px-4 w-full">
          <div className="max-w-2xl mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button 
                onClick={handleGoBackToModules}
                className="text-slate-500 hover:text-[#003865] p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Voltar aos Módulos"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="bg-[#003865] text-white p-1.5 rounded-lg">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="font-extrabold text-lg text-slate-800 tracking-tight">SMART SCAN</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium mr-2 hidden sm:inline">{user?.email}</span>
              <button 
                onClick={openInNewTab}
                className="text-slate-500 hover:text-[#003865] p-2 rounded-full hover:bg-slate-100 transition-colors"
                title="Abrir em Nova Aba"
              >
                <ExternalLink className="w-4 h-4" />
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
      )}

      {/* CONTEÚDO PRINCIPAL COM CONTAINER SCROLLÁVEL */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <main className="flex-1 p-4 md:p-6 flex flex-col space-y-4 max-w-4xl mx-auto w-full relative">
        {newVersionAvailable && (
          <div className="bg-orange-500 text-white px-4 py-3 shadow-md flex items-center justify-between sticky top-0 z-[100] animate-fadeIn rounded-xl mb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin-slow" />
              <span className="text-sm font-semibold">Uma nova atualização do sistema está disponível!</span>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="bg-white text-orange-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-50 transition-colors shadow-sm"
            >
              Atualizar Agora
            </button>
          </div>
        )}
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

          {adminTab === 'admin' && ['master', 'admin', 'consulta'].includes(user?.role || '') ? (

          // PAINEL ADMINISTRATIVO COM SUB-TABS
          <div className="space-y-6 animate-fadeIn">
            {/* Sub-navegação do Painel Admin */}
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {user?.role !== 'admin' && (
              <button
                onClick={() => setAdminSubTab('metrics')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  adminSubTab === 'metrics'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Métricas
              </button>
            )}
              <button
                onClick={() => setAdminSubTab('export')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  adminSubTab === 'export'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Consulta
              </button>
              <button
                onClick={() => setAdminSubTab('users')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  adminSubTab === 'users'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Usuários
              </button>
              {user?.role !== 'admin' && (
              <button
                onClick={() => setAdminSubTab('printers')}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  adminSubTab === 'printers'
                    ? 'bg-white text-[#003865] shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Impressoras
              </button>
            )}
            </div>

            {/* Sub-tab 1: Métricas / Dashboard */}
            {adminSubTab === 'metrics' && user?.role !== 'admin' && (
              <div className="space-y-6 animate-fadeIn">
                {isLoadingStats ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-4 border-blue-100 border-t-[#003865] rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <>
                    {/* Grid de Contadores */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Total de Leituras</span>
                        <span className="text-3xl font-extrabold text-[#003865]">{stats.totalLabels}</span>
                      </div>
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Total de Usuários</span>
                        <span className="text-3xl font-extrabold text-[#003865]">{stats.totalUsers}</span>
                      </div>
                    </div>

                    {/* Rankings / Leaderboards */}
                    <div className="space-y-4">
                      {/* Por Fabricante */}
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                        <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-3">Leituras por Fabricante</h4>
                        {stats.labelsByManufacturer && stats.labelsByManufacturer.length > 0 ? (
                          <div className="space-y-2">
                            {stats.labelsByManufacturer.map((item, index) => (
                              <div key={item.fabricante || index} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-b-0">
                                <span className="font-medium text-slate-700">{item.fabricante || 'Desconhecido'}</span>
                                <span className="font-bold bg-blue-50 text-[#003865] px-2.5 py-0.5 rounded-full text-[10px]">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">Nenhum dado registrado.</p>
                        )}
                      </div>

                      {/* Por Modelo */}
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                        <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-3">Leituras por Modelo</h4>
                        {stats.labelsByModel && stats.labelsByModel.length > 0 ? (
                          <div className="space-y-2">
                            {stats.labelsByModel.map((item, index) => (
                              <div key={item.modelo || index} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-b-0">
                                <span className="font-medium text-slate-700">{item.modelo || 'Desconhecido'}</span>
                                <span className="font-bold bg-blue-50 text-[#003865] px-2.5 py-0.5 rounded-full text-[10px]">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">Nenhum dado registrado.</p>
                        )}
                      </div>

                      {/* Por Operador */}
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
                        <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-3">Ranking de Operadores</h4>
                        {stats.scansByOperator && stats.scansByOperator.length > 0 ? (
                          <div className="space-y-2">
                            {stats.scansByOperator.map((item, index) => (
                              <div key={item.operador_email || index} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-b-0">
                                <span className="font-medium text-slate-700">{item.operador_email || 'Desconhecido'}</span>
                                <span className="font-bold bg-blue-50 text-[#003865] px-2.5 py-0.5 rounded-full text-[10px]">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">Nenhum dado registrado.</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Sub-tab 2: Consultar e Exportar */}
            {adminSubTab === 'export' && user?.role !== 'admin' && (
              <>
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4 animate-fadeIn">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 text-[#003865] p-2.5 rounded-xl border border-blue-100">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-800">Consultar Banco de Dados</h4>
                    <p className="text-[11px] text-slate-400">Configure filtros opcionais, faça buscas e baixe as leituras em Excel</p>
                  </div>
                </div>

                {/* Filtros */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">SN / MAC</label>
                    <input 
                      type="text" 
                      placeholder="GPON SN, CPE SN ou MAC"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Modelo</label>
                    <input 
                      type="text" 
                      placeholder="Modelo da ONU"
                      value={filterModel}
                      onChange={(e) => setFilterModel(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Data Inicial</label>
                    <input 
                      type="date" 
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Data Final</label>
                    <input 
                      type="date" 
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Botões de Ação do Filtro */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <button
                    onClick={() => {
                      setFilterSearch('');
                      setFilterStartDate('');
                      setFilterEndDate('');
                      setFilterModel('');
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all"
                  >
                    Limpar
                  </button>
                  <button
                    onClick={handleExportExcel}
                    className="flex-1 bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all text-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar Planilha Excel (XLSX)</span>
                  </button>
                </div>
              </div>

              {/* Importar Planilha Excel */}
              {user?.role === 'master' && (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4 animate-fadeIn mt-4">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 text-[#003865] p-2.5 rounded-xl border border-blue-100">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-800">Importar Planilha Excel</h4>
                    <p className="text-[11px] text-slate-400">Envie uma planilha XLSX com registros de ONUs para salvar/atualizar no banco</p>
                  </div>
                </div>

                {importExcelMessage && (
                  <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                    importExcelMessage.type === 'success' 
                      ? 'bg-blue-50 border-blue-200 text-blue-800' 
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    {importExcelMessage.type === 'success' ? (
                      <Check className="w-4 h-4 text-blue-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                    <span>{importExcelMessage.text}</span>
                  </div>
                )}

                <div className="space-y-1.5 w-full pt-2 border-t border-slate-100">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">Banco de Dados de Destino</label>
                  <select
                    value={targetDatabase}
                    onChange={(e) => setTargetDatabase(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2.5 text-xs text-slate-800 outline-none transition-all font-semibold"
                  >
                    <option value="db-scanonu">db-scanonu (Padrão)</option>
                    <option value="ScanONU_Claro">ScanONU_Claro</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-slate-100 flex flex-col items-center justify-center w-full space-y-3">
                  {importProgress && (
                    <div className="w-full space-y-2 animate-fadeIn bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="flex justify-between text-[11px] font-bold text-slate-600">
                        <span>Importando registros...</span>
                        <span className="text-[#003865]">{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                        <div 
                          className="bg-[#003865] h-full transition-all duration-300 ease-out rounded-full" 
                          style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                        ></div>
                      </div>
                      <div className="text-[10px] text-slate-400 text-center font-bold">
                        Processados {importProgress.current} de {importProgress.total} registros
                      </div>
                    </div>
                  )}

                  <input 
                    type="file"
                    accept=".xlsx, .xls"
                    ref={importFileInputRef}
                    onChange={handleImportExcel}
                    className="hidden"
                  />
                  <button
                    onClick={() => importFileInputRef.current?.click()}
                    disabled={isImportingExcel}
                    className="w-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 disabled:bg-slate-100/60 text-slate-700 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-xs border border-slate-200 shadow-sm"
                  >
                    {isImportingExcel ? (
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-800 rounded-full animate-spin"></div>
                    ) : (
                      <Upload className="w-4 h-4 text-slate-500" />
                    )}
                    <span>{isImportingExcel ? 'Processando importação...' : 'Selecionar e Importar Planilha (.XLSX)'}</span>
                  </button>
                  <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
                    A planilha deve conter uma coluna com <b>GPON Serial Number</b> (ou GPON Serial, gpon_sn, Serial, S/N) e, opcionalmente, Fabricante, Modelo, Endereço MAC, Usuário e Senha. Registros com o mesmo GPON Serial serão atualizados automaticamente.
                  </p>
                </div>
              </div>
              )}
            </>
          )}

            {/* Sub-tab 3: Cadastro e Lista de Usuários */}
            {adminSubTab === 'users' && (
              <div className="space-y-6 animate-fadeIn">
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
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Usuário</label>
                      <input 
                        type="text" 
                        required
                        placeholder="ex: lucas.albino ou operador@scanonu.com"
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
                        <option value="admin">Administrador (Somente Gerenciar Usuários)</option>
   <option value="master">Master (Acesso Total)</option>
                        <option value="consulta">Consulta (Apenas relatórios)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Operação</label>
                      <select
                        value={newOperacao}
                        onChange={(e) => setNewOperacao(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all font-semibold"
                      >
                        <option value="CTDI MATRIZ">CTDI MATRIZ (db-scanonu)</option>
                        <option value="CTDI OPERAÇÃO GLP">CTDI OPERAÇÃO GLP (ScanONU_Claro)</option>
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
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                              {usr.operacao || 'CTDI MATRIZ'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              usr.role === 'admin'
                                ? 'bg-purple-50 text-purple-700 border border-purple-100'
                                : 'bg-blue-50 text-[#003865] border border-blue-100'
                            }`}>
                              {usr.role === 'master' ? 'Master' : usr.role === 'admin' ? 'Admin' : usr.role === 'consulta' ? 'Consulta' : 'Operador'}
                            </span>
                            <button
                              onClick={() => {
                                setEditingUser(usr);
                                setEditEmail(usr.email);
                                setEditPassword('');
                                setEditRole(usr.role);
                                setEditOperacao(usr.operacao || 'CTDI MATRIZ');
                                setEditUserError(null);
                              }}
                              className="text-slate-400 hover:text-[#003865] p-1 rounded-md hover:bg-slate-100 transition-all"
                              title="Editar Usuário / Resetar Senha"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-tab 4: Impressoras */}
            {adminSubTab === 'printers' && user?.role !== 'admin' && (
              <div className="space-y-6 animate-fadeIn">
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-[#003865]/10 p-2 rounded-xl">
                        <Printer className="w-5 h-5 text-[#003865]" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">
                        {editingPrinter ? 'Editar Impressora' : 'Cadastrar Impressora'}
                      </h3>
                    </div>
                    {editingPrinter && (
                      <button
                        onClick={() => {
                          setEditingPrinter(null);
                          setPrinterFormData({ nome: '', descricao: '', ip: '', porta: '6101', localizacao: 'CTDI MATRIZ' });
                        }}
                        className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Cancelar Edição
                      </button>
                    )}
                  </div>
                  
                  {printerError && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
                      {printerError}
                    </div>
                  )}

                  <form onSubmit={handleSavePrinter} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Printer Name</label>
                      <input
                        type="text"
                        required
                        value={printerFormData.nome}
                        onChange={e => setPrinterFormData({ ...printerFormData, nome: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003865]/30 focus:bg-white"
                        placeholder="Ex: Acessórios - LINHA C1 - 1"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Description</label>
                      <input
                        type="text"
                        value={printerFormData.descricao}
                        onChange={e => setPrinterFormData({ ...printerFormData, descricao: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003865]/30 focus:bg-white"
                        placeholder="Ex: Acessórios - LINHA C1 - 1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">IP Address</label>
                        <input
                          type="text"
                          required
                          value={printerFormData.ip}
                          onChange={e => setPrinterFormData({ ...printerFormData, ip: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003865]/30 focus:bg-white"
                          placeholder="Ex: 10.140.160.67"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Port Number</label>
                        <input
                          type="text"
                          required
                          value={printerFormData.porta}
                          onChange={e => setPrinterFormData({ ...printerFormData, porta: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003865]/30 focus:bg-white"
                          placeholder="6101"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Location</label>
                      <input
                        type="text"
                        value={printerFormData.localizacao}
                        onChange={e => setPrinterFormData({ ...printerFormData, localizacao: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003865]/30 focus:bg-white"
                        placeholder="Ex: Cielo c/o CTDI Brazil"
                      />
                    </div>
                    <div className="pt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={isUpdatingPrinter}
                        className="bg-[#003865] hover:bg-[#002a4d] text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md shadow-blue-900/10 transition-all active:scale-[0.98] disabled:opacity-70"
                      >
                        {isUpdatingPrinter ? 'Salvando...' : 'Update Printer'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Lista de Impressoras */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-800 mb-4">Impressoras Cadastradas na Rede</h3>
                  {isLoadingPrinters ? (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-blue-100 border-t-[#003865] rounded-full animate-spin"></div>
                    </div>
                  ) : printers.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 text-sm">
                      Nenhuma impressora cadastrada ainda.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {printers.map((ptr) => (
                        <div key={ptr.id} className="flex flex-col sm:flex-row justify-between sm:items-center p-3.5 bg-slate-50 border border-slate-100 rounded-xl hover:border-slate-300 transition-colors gap-3 sm:gap-0">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{ptr.nome}</p>
                            <div className="flex gap-3 text-xs text-slate-500 mt-1 font-medium">
                              <span className="flex items-center gap-1"><Monitor className="w-3.5 h-3.5" /> {ptr.ip}:{ptr.porta}</span>
                              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {ptr.localizacao}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingPrinter(ptr);
                                setPrinterFormData({
                                  nome: ptr.nome,
                                  descricao: ptr.descricao || '',
                                  ip: ptr.ip,
                                  porta: ptr.porta?.toString() || '6101',
                                  localizacao: ptr.localizacao || ''
                                });
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="p-2 text-slate-400 hover:text-[#003865] hover:bg-blue-50 rounded-lg transition-colors"
                              title="Editar impressora"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeletePrinter(ptr.id)}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Remover impressora"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : isBatchMode ? (
          // TELA DE PROCESSAMENTO EM LOTE (BATCH)
          <div className="flex-1 flex flex-col py-2 animate-fadeIn space-y-5">
            {/* Cabeçalho do Lote */}
            {(() => {
              const processedCount = batchResults.filter(it => it.status !== 'pending' && it.status !== 'processing').length;
              const percent = batchResults.length > 0 ? Math.round((processedCount / batchResults.length) * 100) : 0;
              
              let etaText = "";
              if (isBatchProcessing) {
                if (processedCount > 0 && batchStartTime > 0) {
                  const elapsed = Date.now() - batchStartTime;
                  const avgTime = elapsed / processedCount;
                  const remaining = batchResults.length - processedCount;
                  const etaSeconds = Math.round((remaining * avgTime) / 1000);
                  etaText = `(Tempo restante: ~${etaSeconds}s)`;
                } else {
                  const etaSeconds = (batchResults.length - processedCount) * 4;
                  etaText = `(Tempo restante: ~${etaSeconds}s)`;
                }
              }

              return (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Envio em Lote</h3>
                      {isBatchProcessing ? (
                        <p className="text-xs text-slate-500 animate-pulse">
                          Enviando: {percent}% ({processedCount} de {batchResults.length}) {etaText}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Processamento concluído. {batchResults.filter(it => it.status === 'saved').length} salvos com sucesso, {batchResults.filter(it => it.status === 'duplicate').length} ignorados (já existem), {batchResults.filter(it => it.status === 'error').length} falhas.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isBatchProcessing && batchResults.some(it => it.status === 'error') && (
                        <button 
                          onClick={retryAllFailedBatchItems}
                          className="bg-red-50 hover:bg-red-100 text-red-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 border border-red-100"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Reenviar Falhas ({batchResults.filter(it => it.status === 'error').length})</span>
                        </button>
                      )}
                      <button 
                        onClick={resetAll}
                        className="bg-blue-50 hover:bg-blue-100 text-[#003865] px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Nova Captura / Limpar</span>
                      </button>
                    </div>
                  </div>

                  {/* Barra de Progresso do Lote */}
                  {isBatchProcessing && (
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-[#003865] h-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Lista de Itens do Lote */}
            <div className="space-y-3">
              {batchResults.map((item) => {
                let badgeClass = "bg-slate-100 text-slate-600 border border-slate-200";
                let badgeText = "Aguardando";
                
                if (item.status === 'processing') {
                  badgeClass = "bg-blue-50 text-blue-700 border border-blue-100 animate-pulse";
                  badgeText = "Processando...";
                } else if (item.status === 'success') {
                  badgeClass = "bg-green-50 text-green-700 border border-green-100";
                  badgeText = "Processado";
                } else if (item.status === 'duplicate') {
                  badgeClass = "bg-amber-50 text-amber-700 border border-amber-100";
                  badgeText = "Ignorado (Já Existe)";
                } else if (item.status === 'saved') {
                  badgeClass = "bg-emerald-50 text-emerald-700 border border-emerald-100";
                  badgeText = "Salvo com sucesso!";
                } else if (item.status === 'error') {
                  badgeClass = "bg-red-50 text-red-700 border border-red-100";
                  badgeText = "Falha no Envio";
                }

                return (
                  <div key={item.id} className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm transition-all p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {item.image ? (
                        <img src={item.image} alt="ONU" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 text-slate-400 rounded-lg border border-slate-200 flex items-center justify-center">
                          <Upload className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-xs text-slate-700 truncate max-w-[150px] sm:max-w-xs">{item.fileName}</div>
                        {item.data.gpon_sn && (
                          <div className="text-[10px] text-slate-400 font-mono">GPON: {item.data.gpon_sn}</div>
                        )}
                        {item.errorMsg && (
                          <div className="text-[10px] text-red-500 mt-0.5 max-w-[150px] sm:max-w-xs break-words whitespace-normal">{item.errorMsg}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.status === 'error' && (
                        <button
                          onClick={() => retryBatchItem(item.id)}
                          className="bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1 rounded-full text-[9px] font-bold transition-all border border-red-200"
                        >
                          Reenviar
                        </button>
                      )}
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${badgeClass}`}>
                        {badgeText}
                      </span>
                    </div>
                  </div>
                );
              })}
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
                    multiple
                  />
                </div>

                {/* Busca Manual para ajuste sem gastar Token */}
                <div className="mt-4 pt-4 border-t border-slate-200/80">
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Edit3 className="w-4 h-4 text-[#003865]" />
                      <span className="font-semibold text-xs text-slate-800">Ajustar ONU Existente</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Insira o GPON Serial, MAC ou nome da rede Wi-Fi da ONU para buscar os dados cadastrados e fazer edições.
                    </p>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="Ex: GPON, MAC ou Rede Wi-Fi (SSID)"
                        value={searchGponInput}
                        onChange={(e) => setSearchGponInput(e.target.value.toUpperCase().trim())}
                        className="flex-1 bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all font-mono"
                      />
                      <button
                        onClick={handleSearchGponForEdit}
                        disabled={isSearchingGpon}
                        className="bg-[#003865] hover:bg-[#004e8c] disabled:bg-slate-300 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0"
                      >
                        {isSearchingGpon ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <span>Buscar</span>
                        )}
                      </button>
                    </div>
                    {searchGponError && (
                      <p className="text-[10px] text-red-500 font-semibold">{searchGponError}</p>
                    )}
                  </div>
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
                <div className="relative flex-1 bg-neutral-950 flex flex-col items-center justify-center overflow-hidden">
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

                  {/* Controle de Zoom Manual */}
                  {isZoomSupported && (
                    <div className="absolute bottom-8 w-3/4 max-w-[250px] z-20 bg-black/50 backdrop-blur-md rounded-2xl p-3 flex items-center gap-3 border border-white/10 shadow-lg">
                      <span className="text-white font-bold text-xs w-8 text-center bg-blue-500/20 px-1 py-0.5 rounded">{(zoomLevel).toFixed(1)}x</span>
                      <input 
                        type="range" 
                        min={minZoom} 
                        max={maxZoom} 
                        step="0.1" 
                        value={zoomLevel} 
                        onChange={handleZoomChange}
                        className="w-full accent-blue-500 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
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
                  </div>

                  <div className="space-y-3.5">
                    {(Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>).map((field) => {
                      const label = fieldLabels[field];
                      const value = data[field] || '';

                      return (
                        <div key={field} className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                            {label}
                          </label>
                          
                          <div className="relative flex items-center">
                            <input 
                              type="text"
                              value={value}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                let updated = { ...data, [field]: newValue };
                                if (field === 'mac' || field === 'modelo' || field === 'fabricante') {
                                  updated = applyMacSsidRules(updated);
                                }
                                setData(updated);
                              }}
                              className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-lg pl-3 pr-10 py-2 text-sm text-slate-800 outline-none transition-all font-medium"
                              placeholder={`Insira o ${label.toLowerCase()}`}
                            />
                            {value && (
                              <button 
                                onClick={() => handleCopyField(field, value)}
                                className="absolute right-2 text-slate-400 hover:text-[#003865] p-1.5 rounded-md hover:bg-white transition-all"
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
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* BOTÃO DE SALVAR NO BANCO DE DADOS (POSTGRESQL) OU NOVA CAPTURA */}
                <div className="space-y-2">
                  {dbMessage?.type === 'success' ? (
                    <button
                      onClick={resetAll}
                      className="w-full bg-[#003865] hover:bg-[#004e8c] active:bg-[#002340] text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md transition-all text-sm animate-fadeIn"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Nova Captura / Novo Scan</span>
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        setIsSavingDb(true);
                        setDbMessage(null);
                        try {
                          const response = await fetch('/api/save-label', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${localStorage.getItem('scanonu_token')}`
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
                            // Limpar as informações do estado
                            setData(DEFAULT_SCAN_DATA);
                            setCapturedImage(null);
                            setEquipmentExistsInDb(false);
                            setShowDuplicateModal(false);
                          } else {
                            throw new Error(result.error || 'Erro ao conectar ao banco.');
                          }
                        } catch (err: any) {
                          setDbMessage({ type: 'error', text: err.message || 'Falha ao salvar no banco.' });
                        } finally {
                          setIsSavingDb(false);
                        }
                      }}
                      disabled={isSavingDb}
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
                  )}

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
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

          </>
        )}
      </main>

      
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
                        campos_config: '{\n  "sn": { "label": "S/N:", "minLength": 15, "maxLength": 15 },\n  "mac": { "label": "MAC ETHERNET:", "minLength": 17, "maxLength": 17 }\n}'
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
                  Insira as variáveis entre chaves com cifrão, ex: <code>{"$"+"{sn}"}</code>, <code>{"$"+"{mac}"}</code>.
                </p>
                <textarea 
                  required rows={6}
                  value={iptvModelForm.codigo_zpl}
                  onChange={(e) => handleZplChange(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-mono text-xs focus:border-[#003865] focus:ring-0 transition-colors"
                  placeholder="^XA...^FD${sn}^FS...^XZ"
                ></textarea>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Configuração de Campos (JSON)</label>
                <p className="text-[10px] text-slate-500 mb-2 leading-tight">
                  Defina os campos obrigatórios e suas travas (min/max length). Exemplo:<br/>
                  <code>{"{ \"sn\": { \"label\": \"S/N:\", \"minLength\": 15, \"maxLength\": 15 } }"}</code>
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


      {/* MODAL DE AVISO DE DUPLICIDADE */}
      {showDuplicateModal && existingEquipmentData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 flex flex-col space-y-4 animate-scaleUp">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            
            <h3 className="font-bold text-base text-amber-800 text-center leading-snug">
              Aviso: Equipamento já cadastrado no banco!
            </h3>
            
            <p className="text-slate-600 text-xs text-center leading-relaxed">
              O GPON <strong className="text-slate-800 font-semibold">{data.gpon_sn}</strong> já está cadastrado. Deseja fazer algum ajuste? Você pode editar as informações na tela e salvá-las diretamente.
            </p>
            
            <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-1.5 text-xs text-slate-600">
              <div className="font-bold text-slate-700 border-b border-slate-200 pb-1 mb-1">Dados anteriores salvos:</div>
              <div>• Fabricante: <span className="font-medium text-slate-800">{existingEquipmentData.fabricante} ({existingEquipmentData.modelo})</span></div>
              <div>• MAC: <span className="font-medium text-slate-800">{existingEquipmentData.mac}</span></div>
              <div>• SSID 2.4G / Único: <span className="font-medium text-slate-800">{existingEquipmentData.wifi_ssid || 'Não cadastrado'}</span></div>
              {existingEquipmentData.wifi_ssid_5g && (
                <div>• SSID 5G: <span className="font-medium text-slate-800">{existingEquipmentData.wifi_ssid_5g}</span></div>
              )}
              <div>• Senha WIFI: <span className="font-medium text-slate-800">{existingEquipmentData.wifi_key}</span></div>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={resetAll}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 px-4 rounded-xl text-xs transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={() => setShowDuplicateModal(false)}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-sm shadow-amber-600/10"
              >
                Revisar e Ajustar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO DE USUÁRIO / RESETAR SENHA */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleUpdateUser}
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 flex flex-col space-y-4 animate-scaleUp"
          >
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800">
                Editar Usuário
              </h3>
              <button 
                type="button" 
                onClick={() => setEditingUser(null)} 
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editUserError && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{editUserError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">E-mail / Usuário</label>
              <input 
                type="text" 
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Nova Senha</label>
              <input 
                type="password" 
                placeholder="Deixe em branco para não alterar"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Perfil</label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
              >
                <option value="operador">Operador (Apenas scanner)</option>
                <option value="admin">Administrador (Somente Gerenciar Usuários)</option>
   <option value="master">Master (Acesso Total)</option>
                <option value="consulta">Consulta (Apenas relatórios)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Operação</label>
              <select
                value={editOperacao}
                onChange={(e) => setEditOperacao(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-[#003865] focus:ring-1 focus:ring-[#003865] rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all font-semibold"
              >
                <option value="CTDI MATRIZ">CTDI MATRIZ (db-scanonu)</option>
                <option value="CTDI OPERAÇÃO GLP">CTDI OPERAÇÃO GLP (ScanONU_Claro)</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                type="button" 
                onClick={() => setEditingUser(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold py-2 px-4 rounded-xl text-xs transition-all"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                disabled={isUpdatingUser}
                className="flex-1 bg-[#003865] hover:bg-[#004e8c] text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isUpdatingUser ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <span>Salvar</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FOOTER */}
      <footer className="py-4 text-center border-t border-slate-200/60 bg-white">
        <div className="max-w-2xl mx-auto w-full">
          <p className="text-[10px] text-slate-400">SMART SCAN &copy; {new Date().getFullYear()} - Assistente de Campo</p>
        </div>
      </footer>
      </div>
    </div>
  );
}
