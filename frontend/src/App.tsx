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
  LogOut,
  Users,
  UserPlus,
  Download,
  Eye,
  EyeOff
} from 'lucide-react';

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
  if (!currentData.mac) return currentData;
  
  // Clean MAC (remove colons, hyphens, spaces, and make uppercase)
  const cleanMac = currentData.mac.replace(/[:\s-]/g, '').toUpperCase();
  if (cleanMac.length < 4) return currentData;
  
  const last4Hex = cleanMac.slice(-4);
  const last4Int = parseInt(last4Hex, 16);
  if (isNaN(last4Int)) return currentData;

  const modelUpper = (currentData.modelo || '').toUpperCase();
  const mfgUpper = (currentData.fabricante || '').toUpperCase();
  const dataCopy = { ...currentData };
  
  // Rule 1: KAON
  if (modelUpper.includes('KAON') || mfgUpper.includes('KAON')) {
    dataCopy.wifi_ssid = `LIVE TIM_${last4Hex}_2G`;
    dataCopy.wifi_ssid_5g = `LIVE TIM_${last4Hex}_5G`;
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
  
  return dataCopy;
}

export default function App() {
  // Autenticação
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Administração
  const [adminTab, setAdminTab] = useState<'scan' | 'admin'>('scan');
  const [usersList, setUsersList] = useState<Array<{ id?: number; email: string; role: string }>>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operador');
  const [adminMessage, setAdminMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Estados para edição/reset de senha de usuários
  const [editingUser, setEditingUser] = useState<{ id?: number; email: string; role: string } | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('operador');
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);

  // Filtros de Exportação
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [adminSubTab, setAdminSubTab] = useState<'metrics' | 'export' | 'users'>('metrics');

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

  // Estados de Processamento em Lote (Batch)
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchItem[]>([]);
  const [batchStartTime, setBatchStartTime] = useState<number>(0);

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

  // Buscar estatísticas do banco de dados
  const fetchStats = async () => {
    if (!user || user.role !== 'admin') return;
    setIsLoadingStats(true);
    try {
      const response = await fetch(`/api/admin/stats?adminEmail=${encodeURIComponent(user.email)}`);
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

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin' || !editingUser) return;
    setEditUserError(null);
    setIsUpdatingUser(true);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: editingUser.id,
          email: editEmail,
          senha: editPassword,
          role: editRole,
          adminEmail: user.email
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setAdminMessage({ type: 'success', text: result.message || 'Usuário atualizado com sucesso!' });
        setEditingUser(null);
        setEditEmail('');
        setEditPassword('');
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

  const handleExportExcel = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const response = await fetch(
        `/api/admin/export-excel?adminEmail=${encodeURIComponent(user.email)}` +
        `&search=${encodeURIComponent(filterSearch)}` +
        `&startDate=${encodeURIComponent(filterStartDate)}` +
        `&endDate=${encodeURIComponent(filterEndDate)}` +
        `&modelo=${encodeURIComponent(filterModel)}`
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

    if (files.length === 1) {
      // Fluxo de arquivo único existente
      const file = files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCapturedImage(base64);
        processImage(base64);
      };
      reader.readAsDataURL(file);
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
          const response = await fetch('/api/scan-label', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: base64 })
          });

          const result = await response.json();

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
                    'Content-Type': 'application/json'
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
                  throw new Error(saveResult.error || 'Erro ao salvar no banco.');
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
      const response = await fetch('/api/scan-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ image: item.image })
      });

      const result = await response.json();

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
                'Content-Type': 'application/json'
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
              throw new Error(saveResult.error || 'Erro ao salvar no banco.');
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

  const processImage = async (base64Image: string) => {
    setScreen('processing');
    setError(null);
    setEquipmentExistsInDb(false);
    setExistingEquipmentData(null);
    setShowDuplicateModal(false);
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
        if (result.data.reimpressa) {
          throw new Error('A etiqueta enviada foi identificada como REIMPRESSA e o envio foi bloqueado.');
        }
        setData(applyMacSsidRules(result.data));
        if (result.existsInDb) {
          setEquipmentExistsInDb(true);
          setExistingEquipmentData(result.existingData);
          setShowDuplicateModal(true);
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
    setScreen('idle');
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

  // RENDERIZAÇÃO DA ÁREA DE LOGIN
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#002f56] text-slate-800 font-sans p-6">
        <div className="flex-1 flex flex-col justify-center items-center w-full">
          {/* Card de Login */}
          <div className="bg-white rounded-[2.5rem] px-8 py-10 shadow-2xl w-full max-w-sm flex flex-col items-center">
            {/* Logo CTDI */}
            <div className="mb-6 flex flex-col items-center">
              <svg viewBox="0 0 200 50" className="w-52 h-14 mb-2" xmlns="http://www.w3.org/2000/svg">
                {/* Diamond 1 */}
                <polygon points="5,25 28,5 51,25 28,45" fill="none" stroke="#002f56" strokeWidth="2.5" />
                {/* Diamond 2 */}
                <polygon points="51,25 74,5 97,25 74,45" fill="none" stroke="#002f56" strokeWidth="2.5" />
                {/* Diamond 3 */}
                <polygon points="97,25 120,5 143,25 120,45" fill="none" stroke="#002f56" strokeWidth="2.5" />
                {/* Diamond 4 */}
                <polygon points="143,25 166,5 189,25 166,45" fill="none" stroke="#002f56" strokeWidth="2.5" />
                
                {/* Letters */}
                <text x="28" y="32.5" fontFamily="system-ui, -apple-system, sans-serif" fontSize="21" fontWeight="900" fontStyle="italic" fill="#002f56" textAnchor="middle">C</text>
                <text x="74" y="32.5" fontFamily="system-ui, -apple-system, sans-serif" fontSize="21" fontWeight="900" fontStyle="italic" fill="#002f56" textAnchor="middle">T</text>
                <text x="120" y="32.5" fontFamily="system-ui, -apple-system, sans-serif" fontSize="21" fontWeight="900" fontStyle="italic" fill="#002f56" textAnchor="middle">D</text>
                <text x="166" y="32.5" fontFamily="system-ui, -apple-system, sans-serif" fontSize="21" fontWeight="900" fontStyle="italic" fill="#002f56" textAnchor="middle">I</text>
              </svg>
              <h1 className="font-black text-3xl tracking-widest text-[#002f56] uppercase mt-2">Mídias</h1>
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

            {/* Dica de credenciais para testes rápidos */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] text-slate-400 text-center w-full mt-6">
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
          // PAINEL ADMINISTRATIVO COM SUB-TABS
          <div className="space-y-6 animate-fadeIn">
            {/* Sub-navegação do Painel Admin */}
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
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
            </div>

            {/* Sub-tab 1: Métricas / Dashboard */}
            {adminSubTab === 'metrics' && (
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
            {adminSubTab === 'export' && (
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
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              usr.role === 'admin'
                                ? 'bg-purple-50 text-purple-700 border border-purple-100'
                                : 'bg-blue-50 text-[#003865] border border-blue-100'
                            }`}>
                              {usr.role === 'admin' ? 'Admin' : 'Operador'}
                            </span>
                            <button
                              onClick={() => {
                                setEditingUser(usr);
                                setEditEmail(usr.email);
                                setEditPassword('');
                                setEditRole(usr.role);
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

      {/* MODAL DE AVISO DE DUPLICIDADE */}
      {showDuplicateModal && existingEquipmentData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-100 flex flex-col space-y-4 animate-scaleUp">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            
            <h3 className="font-bold text-base text-amber-800 text-center leading-snug">
              Atenção: Este equipamento já está cadastrado no banco!
            </h3>
            
            <p className="text-slate-600 text-xs text-center leading-relaxed">
              O GPON <strong className="text-slate-800 font-semibold">{data.gpon_sn}</strong> já existe no sistema. Você pode ajustar as informações na tela e clicar no botão abaixo para <strong className="text-amber-700">Sobrescrever/Atualizar</strong> os dados existentes.
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
            
            <button 
              onClick={() => setShowDuplicateModal(false)}
              className="w-full bg-[#003865] hover:bg-[#004e8c] text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-sm"
            >
              Fechar e Editar
            </button>
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
                <option value="admin">Administrador (Scanner + Painel)</option>
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
          <p className="text-[10px] text-slate-400">ScanONU &copy; {new Date().getFullYear()} - Assistente de Campo</p>
        </div>
      </footer>
    </div>
  );
}
