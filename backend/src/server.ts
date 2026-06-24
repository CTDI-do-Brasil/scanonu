import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { create } from 'xmlbuilder2';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const geminiApiKey = process.env.GEMINI_API_KEY;
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
if (ai) {
  console.log('Cliente Gemini Vision API inicializado com sucesso.');
} else {
  console.warn('Variável de ambiente GEMINI_API_KEY não configurada. Usando OCR local (Tesseract.js) como padrão.');
}


const app = express();
const PORT = process.env.PORT || 3001;

// Configurar limites de payload grandes (50MB) para suportar fotos de alta resolução
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Servir arquivos estáticos do frontend em ambiente de produção (CapRover)
// O Dockerfile irá compilar o frontend dentro do diretório public/dist
app.use(express.static('public'));

let dbConnected = false;
let dbPool: Pool | null = null;

// Guardar os últimos erros de escaneamento para diagnóstico
let lastScanErrors: any[] = [];
let lastScans: any[] = [];

// Tenta conectar ao banco de dados se a variável DATABASE_URL existir
async function connectToDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    try {
      console.log(`Tentando conectar ao PostgreSQL...`);
      const useSSL = !connectionString.includes('localhost') && 
                     !connectionString.includes('127.0.0.1') && 
                     !connectionString.includes('srv-captain') && 
                     !connectionString.includes('sslmode=disable') &&
                     process.env.DB_SSL !== 'false';

      dbPool = new Pool({
        connectionString: connectionString,
        ssl: useSSL ? { rejectUnauthorized: false } : false
      });

      // Validar conexão rodando um SELECT simples
      await dbPool.query('SELECT NOW()');
      dbConnected = true;
      console.log('Conexão estabelecida com sucesso com o PostgreSQL.');

      // Criar a tabela de etiquetas
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS etiquetas_scan_onu (
          gpon_sn VARCHAR(100) PRIMARY KEY,
          fabricante VARCHAR(100) NOT NULL,
          modelo VARCHAR(100) NOT NULL,
          cpe_sn VARCHAR(100),
          mac VARCHAR(100),
          wifi_ssid VARCHAR(100),
          wifi_ssid_5g VARCHAR(100), -- Novo campo
          wifi_key VARCHAR(100),
          usuario VARCHAR(100),
          senha VARCHAR(100),
          operador_email VARCHAR(150),
          data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await dbPool.query(createTableQuery);

      // Criar a tabela de usuários
      const createUsersTableQuery = `
        CREATE TABLE IF NOT EXISTS usuarios_scan_onu (
          id SERIAL PRIMARY KEY,
          email VARCHAR(150) UNIQUE NOT NULL,
          senha VARCHAR(100) NOT NULL,
          role VARCHAR(50) DEFAULT 'operador'
        );
      `;
      await dbPool.query(createUsersTableQuery);
      console.log('Tabelas de banco validadas/criadas com sucesso.');

      // Migração para remover a coluna ID caso ela já exista no banco
      try {
        const checkColumn = await dbPool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' AND column_name='id'"
        );
        if (checkColumn.rowCount && checkColumn.rowCount > 0) {
          console.log('Migrando banco: removendo coluna ID e definindo gpon_sn como PRIMARY KEY...');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP CONSTRAINT IF EXISTS etiquetas_scan_onu_pkey CASCADE');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN IF EXISTS id CASCADE');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD PRIMARY KEY (gpon_sn)');
          console.log('Migração concluída com sucesso!');
        }
      } catch (migrationErr: any) {
        console.error('Erro na migração da tabela de etiquetas:', migrationErr.message || migrationErr);
      }

      // Garantir que a coluna wifi_ssid exista caso a tabela já tenha sido criada anteriormente
      try {
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100)');
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid_5g VARCHAR(100)');
        console.log('Colunas de SSID verificadas/adicionadas com sucesso.');
      } catch (e) {}

      // Garantir que a constraint UNIQUE exista caso a tabela já tenha sido criada anteriormente sem ela
      try {
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD CONSTRAINT unique_gpon_sn UNIQUE (gpon_sn)');
        console.log('Constraint UNIQUE (gpon_sn) adicionada.');
      } catch (e) {}

      // Garantir o cadastro/reset do administrador padrão para evitar lockout
      const adminCheck = await dbPool.query("SELECT id FROM usuarios_scan_onu WHERE email = 'admin@scanonu.com'");
      if (!adminCheck.rowCount || adminCheck.rowCount === 0) {
        await dbPool.query(
          "INSERT INTO usuarios_scan_onu (email, senha, role) VALUES ('admin@scanonu.com', 'admin123', 'admin')"
        );
        console.log('Usuário admin padrão (admin@scanonu.com / admin123) cadastrado com sucesso.');
      } else {
        await dbPool.query(
          "UPDATE usuarios_scan_onu SET senha = 'admin123', role = 'admin' WHERE email = 'admin@scanonu.com'"
        );
        console.log('Senha e perfil do usuário admin@scanonu.com resetados com sucesso.');
      }

    } catch (err: any) {
      console.error('Falha ao conectar ou inicializar o PostgreSQL:', err.message || err);
      dbConnected = false;
    }
  } else {
    console.log(' DATABASE_URL não configurada no .env. Modo autônomo ativo (sem persistência).');
  }
}

connectToDatabase();

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    databaseConnected: dbConnected 
  });
});

// Diagnóstico de erros de escaneamento
app.get('/api/debug-errors', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    dbConnected,
    hasApiKey: !!process.env.GEMINI_API_KEY,
    apiKeyLength: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
    lastScanErrors
  });
});

// Diagnóstico de todos os escaneamentos (sucesso e falha)
app.get('/api/debug-scans', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    dbConnected,
    lastScans
  });
});

// Função de parsing baseada em RegEx para extrair dados estruturados do OCR
const KNOWN_SAGEMCOM_OUIS = ['8020DA', 'D87D7F', '700B01', '786559', '346BA6', '34DB1C', '34DB9C', 'D8D7F7'];

function correctMacPrefix(mac: string): string {
  const cleanMac = mac.replace(/[^0-9A-F]/ig, '').toUpperCase();
  if (cleanMac.length !== 12) return mac;
  
  const prefix = cleanMac.substring(0, 6);
  const rest = cleanMac.substring(6);
  
  if (KNOWN_SAGEMCOM_OUIS.includes(prefix)) {
    return cleanMac;
  }
  
  let bestOui = prefix;
  let minDistance = 999;
  
  for (const oui of KNOWN_SAGEMCOM_OUIS) {
    let dist = 0;
    for (let i = 0; i < 6; i++) {
      if (prefix[i] !== oui[i]) {
        dist++;
      }
    }
    if (dist < minDistance) {
      minDistance = dist;
      bestOui = oui;
    }
  }
  
  if (minDistance <= 1) {
    console.log(`[MAC OUI Correction] Corrected prefix ${prefix} to ${bestOui}`);
    return bestOui + rest;
  }
  
  return cleanMac;
}

app.post('/api/scan-label', async (req, res) => {
  let scanResult: any = null;
  const scanSource = 'gemini-vision';

  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Nenhuma imagem foi fornecida no corpo da requisição.' });
    }

    if (!ai) {
      return res.status(503).json({
        success: false,
        error: 'Serviço temporariamente indisponível. A chave de API do Gemini (GEMINI_API_KEY) não está configurada no servidor. O OCR local foi desativado.'
      });
    }

    let mimeType = 'image/jpeg';
    let base64Data = image;
    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    console.log('Iniciando processamento com Gemini Vision API...');
    const prompt = `Analise a imagem da etiqueta do equipamento ONU/ONT e extraia os seguintes campos de forma estruturada. 
Siga atentamente as instruções abaixo para cada campo:
1. fabricante: Fabricante da ONU (ex: Huawei, ZTE, FiberHome, Intelbras, Nokia, Alcatel, SagemCOM).
2. modelo: Modelo exato da ONU (ex: F670L, HG8145V5, EG8145V5, F6600, F680, F673, XC-FIT-150, F@ST 5655V2, etc.).
3. cpe_sn: Serial CPE/Equipamento (geralmente começa com N7 ou similar). Se for igual ao GPON SN, deixe vazio ou extraia o correto se houver.
4. gpon_sn: Serial GPON (ex: SMBS12345678, ZTEG12345678, FHTT12345678, ALCL12345678, HWTC12345678). Certifique-se de que tenha 12 caracteres. Se começar com SMB8, corrija para SMBS.
5. mac: Endereço MAC físico de 12 caracteres hexadecimais (ex: 8020DAD1D2D3). Remova separadores como ':' ou '-'. Certifique-se de que o prefixo/OUI seja válido para o fabricante.
6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única.
7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz, se existir separadamente.
8. wifi_key: Senha padrão do Wi-Fi (geralmente de 8 a 10 caracteres, minúsculas/maiúsculas/números).
9. usuario: Usuário padrão de acesso web (geralmente admin, user, etc.).
10. senha: Senha padrão de acesso web (geralmente curta, minúsculas/números).
11. reimpressa: Identifique se a etiqueta é uma reimpressão (geralmente não original, impressa em papel adesivo comum) retornando 'sim' ou 'nao'.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        },
        prompt
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fabricante: { type: Type.STRING },
            modelo: { type: Type.STRING },
            cpe_sn: { type: Type.STRING },
            gpon_sn: { type: Type.STRING },
            mac: { type: Type.STRING },
            wifi_ssid: { type: Type.STRING },
            wifi_ssid_5g: { type: Type.STRING },
            wifi_key: { type: Type.STRING },
            usuario: { type: Type.STRING },
            senha: { type: Type.STRING },
            reimpressa: { type: Type.STRING, description: "Retorne 'sim' ou 'nao'" }
          },
          required: ['gpon_sn']
        }
      }
    });

    const responseText = response.text;
    console.log('--- Resposta bruta do Gemini ---');
    console.log(responseText);
    console.log('--------------------------------');

    if (!responseText) {
      throw new Error('A API do Gemini retornou uma resposta vazia.');
    }

    const geminiData = JSON.parse(responseText);
    
    // Normalização dos dados extraídos pelo Gemini
    let fabricanteNorm = geminiData.fabricante || 'Outro';
    const upperMfg = fabricanteNorm.toUpperCase();
    if (upperMfg.includes('HUAWEI')) fabricanteNorm = 'Huawei';
    else if (upperMfg.includes('ZTE')) fabricanteNorm = 'ZTE';
    else if (upperMfg.includes('FIBERHOME')) fabricanteNorm = 'FiberHome';
    else if (upperMfg.includes('INTELBRAS')) fabricanteNorm = 'Intelbras';
    else if (upperMfg.includes('NOKIA')) fabricanteNorm = 'Nokia';
    else if (upperMfg.includes('ALCATEL')) fabricanteNorm = 'Alcatel';
    else if (upperMfg.includes('SAGEMCOM') || upperMfg.includes('SAGEM') || upperMfg.includes('SMBS') || upperMfg.includes('SMB8')) fabricanteNorm = 'SagemCOM';

    let gponNorm = (geminiData.gpon_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
    if (gponNorm.startsWith('SMB8')) {
      gponNorm = 'SMBS' + gponNorm.substring(4);
    }

    let macNorm = (geminiData.mac || '').replace(/[^0-9A-F]/ig, '').toUpperCase();
    if (macNorm) {
      macNorm = correctMacPrefix(macNorm);
    }

    let cpeNorm = (geminiData.cpe_sn || '').replace(/[^A-Z0-9_-]/ig, '').toUpperCase();
    if (cpeNorm && cpeNorm.length >= 14 && !cpeNorm.startsWith('N7')) {
      cpeNorm = 'N7' + cpeNorm.substring(2);
    }

    scanResult = {
      fabricante: fabricanteNorm,
      modelo: geminiData.modelo || '',
      cpe_sn: cpeNorm,
      gpon_sn: gponNorm,
      mac: macNorm,
      wifi_ssid: geminiData.wifi_ssid || '',
      wifi_ssid_5g: geminiData.wifi_ssid_5g || '',
      wifi_key: (geminiData.wifi_key || '').toLowerCase(),
      usuario: geminiData.usuario || '',
      senha: geminiData.senha || '',
      reimpressa: geminiData.reimpressa || 'nao'
    };

    if (!scanResult.gpon_sn) {
      throw new Error('Não foi possível identificar o GPON Serial Number (S/N) na imagem da etiqueta.');
    }

    // Converter a resposta da reimpressão ("sim"/"nao") para boolean
    const isReimpressa = String(scanResult.reimpressa).toLowerCase().trim() === 'sim';
    scanResult.reimpressa = isReimpressa;

    // VERIFICAÇÃO DE DUPLICIDADE: verifica se o GPON_SN já existe no banco de dados
    let existsInDb = false;
    let existingData = null;

    if (dbConnected && dbPool && scanResult.gpon_sn) {
      try {
        const checkRes = await dbPool.query(
          'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
          [scanResult.gpon_sn]
        );
        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
        }
      } catch (dbErr) {
        console.error('Erro ao verificar duplicidade no scan-label:', dbErr);
      }
    }

    // Registrar o escaneamento bem-sucedido para auditoria e diagnóstico
    lastScans.push({
      timestamp: new Date().toISOString(),
      success: true,
      rawText: responseText,
      parsed: scanResult,
      existsInDb,
      scanSource
    });
    if (lastScans.length > 20) lastScans.shift();

    return res.json({ 
      success: true, 
      data: scanResult,
      existsInDb,
      existingData,
      scanSource
    });

  } catch (ocrError: any) {
    console.error('Erro no processamento da leitura da etiqueta:', ocrError);
    
    // Registrar a falha de escaneamento para auditoria e diagnóstico
    lastScanErrors.push({
      timestamp: new Date().toISOString(),
      ocrError: ocrError.message || String(ocrError)
    });
    if (lastScanErrors.length > 50) lastScanErrors.shift();

    lastScans.push({
      timestamp: new Date().toISOString(),
      success: false,
      rawText: 'Erro de processamento (Gemini)',
      error: ocrError.message || String(ocrError),
      scanSource
    });
    if (lastScans.length > 20) lastScans.shift();

    return res.status(502).json({
      success: false,
      error: ocrError.message || 'Falha ao realizar a leitura da etiqueta com Gemini Vision.',
      details: [ocrError.message || String(ocrError)]
    });
  }
});

// Nova rota para salvar ou atualizar (sobrescrever) os dados no banco PostgreSQL
app.post('/api/save-label', async (req, res) => {
  try {
    const { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, operador, overwrite } = req.body;

    if (!dbConnected || !dbPool) {
      console.warn("PostgreSQL não está conectado. Simulando gravação com sucesso.");
      return res.json({ 
        success: true, 
        message: 'Dados simulados com sucesso (PostgreSQL desativado no momento).',
        savedData: req.body
      });
    }

    const checkRes = await dbPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial já existe no banco de dados.'
        });
      }

      // Se for para sobrescrever, usamos um UPDATE que NÃO consome a sequence SERIAL!
      const updateQuery = `
        UPDATE etiquetas_scan_onu 
        SET 
          fabricante = $1,
          modelo = $2,
          cpe_sn = $3,
          mac = $4,
          wifi_ssid = $5,
          wifi_ssid_5g = $6,
          wifi_key = $7,
          usuario = $8,
          senha = $9,
          operador_email = $10,
          data_leitura = CURRENT_TIMESTAMP
        WHERE gpon_sn = $11
      `;
      const updateValues = [
        fabricante || '',
        modelo || '',
        cpe_sn || '',
        mac || '',
        wifi_ssid || '',
        wifi_ssid_5g || '',
        wifi_key || '',
        usuario || '',
        senha || '',
        operador || 'sistema',
        gpon_sn
      ];
      await dbPool.query(updateQuery, updateValues);
      console.log(`Dados atualizados com sucesso no banco de dados. Serial GPON: ${gpon_sn}`);
    } else {
      // Se não existe, fazemos um INSERT normal (que consome a sequence normalmente e cria o id consecutivo correto)
      const insertQuery = `
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, operador_email)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;
      const insertValues = [
        fabricante || '',
        modelo || '',
        cpe_sn || '',
        gpon_sn || '',
        mac || '',
        wifi_ssid || '',
        wifi_ssid_5g || '',
        wifi_key || '',
        usuario || '',
        senha || '',
        operador || 'sistema'
      ];
      await dbPool.query(insertQuery, insertValues);
      console.log(`Dados salvos com sucesso no banco de dados. Serial GPON: ${gpon_sn}`);
    }

    return res.json({ 
      success: true, 
      message: exists 
        ? 'Dados atualizados/sobrescritos com sucesso no PostgreSQL!'
        : 'Dados salvos com sucesso no PostgreSQL!' 
    });

  } catch (dbError: any) {
    console.error('Erro ao salvar no PostgreSQL:', dbError);
    return res.status(500).json({
      success: false,
      error: 'Não foi possível gravar os dados no PostgreSQL.',
      details: dbError.message || String(dbError)
    });
  }
});

// Rota de login real usando o PostgreSQL
app.post('/api/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!dbConnected || !dbPool) {
      // Fallback local se o banco não estiver configurado para testes
      if (email === 'admin@scanonu.com' && senha === 'admin123') {
        return res.json({ success: true, user: { email, role: 'admin' } });
      }
      return res.status(401).json({ error: 'Banco desconectado. Credenciais inválidas.' });
    }

    const userRes = await dbPool.query(
      'SELECT email, role FROM usuarios_scan_onu WHERE email = $1 AND senha = $2',
      [email.trim().toLowerCase(), senha]
    );

    if (userRes.rowCount && userRes.rowCount > 0) {
      return res.json({ 
        success: true, 
        user: userRes.rows[0] 
      });
    } else {
      return res.status(401).json({ error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
    }

  } catch (err: any) {
    console.error('Erro na rota de login:', err);
    return res.status(500).json({ error: 'Erro interno ao validar login.' });
  }
});

// Rota para cadastrar novos usuários (somente Admin)
app.post('/api/admin/users', async (req, res) => {
  try {
    const { email, senha, role, adminEmail } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem cadastrar usuários.' });
    }

    await dbPool.query(
      'INSERT INTO usuarios_scan_onu (email, senha, role) VALUES ($1, $2, $3)',
      [email.trim().toLowerCase(), senha, role || 'operador']
    );

    return res.json({ success: true, message: `Usuário ${email} cadastrado com sucesso!` });

  } catch (err: any) {
    console.error('Erro ao cadastrar usuário:', err);
    if (err.code === '23505') { // Código de erro de chave duplicada no PostgreSQL
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }
    return res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

// Rota para editar e resetar senhas de usuários (somente Admin)
app.put('/api/admin/users', async (req, res) => {
  try {
    const { id, email, senha, role, adminEmail } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar usuários.' });
    }

    let queryText = '';
    let queryValues = [];

    if (senha && senha.trim() !== '') {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, senha = $2, role = $3 WHERE id = $4';
      queryValues = [email.trim().toLowerCase(), senha.trim(), role, id];
    } else {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, role = $2 WHERE id = $3';
      queryValues = [email.trim().toLowerCase(), role, id];
    }

    await dbPool.query(queryText, queryValues);
    return res.json({ success: true, message: `Usuário atualizado com sucesso!` });

  } catch (err: any) {
    console.error('Erro ao atualizar usuário:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Este e-mail já está sendo utilizado por outro usuário.' });
    }
    return res.status(500).json({ error: 'Erro interno ao atualizar usuário.' });
  }
});

// Rota para listar usuários (somente Admin)
app.get('/api/admin/users', async (req, res) => {
  try {
    const { adminEmail } = req.query;

    if (!dbConnected || !dbPool) {
      return res.json({ success: true, users: [{ email: 'admin@scanonu.com', role: 'admin' }] });
    }

    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const usersRes = await dbPool.query('SELECT id, email, role FROM usuarios_scan_onu ORDER BY email ASC');
    return res.json({ success: true, users: usersRes.rows });

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// Rota para obter estatísticas do painel Admin
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { adminEmail } = req.query;

    if (!dbConnected || !dbPool) {
      return res.json({
        success: true,
        stats: {
          totalLabels: 0,
          totalUsers: 1,
          labelsByManufacturer: [],
          labelsByModel: [],
          scansByOperator: []
        }
      });
    }

    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const totalLabelsRes = await dbPool.query('SELECT COUNT(*) FROM etiquetas_scan_onu');
    const totalUsersRes = await dbPool.query('SELECT COUNT(*) FROM usuarios_scan_onu');
    
    const mfgRes = await dbPool.query(
      'SELECT fabricante, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY fabricante ORDER BY count DESC LIMIT 10'
    );
    const modelRes = await dbPool.query(
      'SELECT modelo, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY modelo ORDER BY count DESC LIMIT 10'
    );
    const opRes = await dbPool.query(
      'SELECT operador_email, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY operador_email ORDER BY count DESC LIMIT 10'
    );

    return res.json({
      success: true,
      stats: {
        totalLabels: parseInt(totalLabelsRes.rows[0].count),
        totalUsers: parseInt(totalUsersRes.rows[0].count),
        labelsByManufacturer: mfgRes.rows,
        labelsByModel: modelRes.rows,
        scansByOperator: opRes.rows
      }
    });
  } catch (err: any) {
    console.error('Erro ao buscar estatísticas:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar estatísticas.' });
  }
});

// Rota para exportar todas as etiquetas em XML (somente Admin)
app.get('/api/admin/export-xml', async (req, res) => {
  try {
    const { adminEmail, serialNumber, mac, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem exportar o banco.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;

    if (serialNumber) {
      queryText += ` AND (gpon_sn ILIKE $${paramCount} OR cpe_sn ILIKE $${paramCount})`;
      queryValues.push(`%${serialNumber}%`);
      paramCount++;
    }

    if (mac) {
      queryText += ` AND mac ILIKE $${paramCount}`;
      queryValues.push(`%${mac}%`);
      paramCount++;
    }

    if (modelo) {
      queryText += ` AND modelo ILIKE $${paramCount}`;
      queryValues.push(`%${modelo}%`);
      paramCount++;
    }

    if (startDate) {
      queryText += ` AND data_leitura >= $${paramCount}`;
      queryValues.push(startDate);
      paramCount++;
    }

    if (endDate) {
      queryText += ` AND data_leitura <= $${paramCount}`;
      queryValues.push(`${endDate} 23:59:59`);
      paramCount++;
    }

    queryText += ' ORDER BY data_leitura ASC';
    const etiquetasRes = await dbPool.query(queryText, queryValues);
    
    // Construção do XML usando xmlbuilder2
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('scanonu')
        .ele('etiquetas');

    etiquetasRes.rows.forEach((row, index) => {
      root.ele('onu')
        .ele('id').txt(String(index + 1)).up()
        .ele('fabricante').txt(row.fabricante || '').up()
        .ele('modelo').txt(row.modelo || '').up()
        .ele('cpe_sn').txt(row.cpe_sn || '').up()
        .ele('gpon_sn').txt(row.gpon_sn || '').up()
        .ele('mac').txt(row.mac || '').up()
        .ele('wifi_ssid').txt(row.wifi_ssid || '').up()
        .ele('wifi_ssid_5g').txt(row.wifi_ssid_5g || '').up()
        .ele('wifi_key').txt(row.wifi_key || '').up()
        .ele('usuario').txt(row.usuario || '').up()
        .ele('senha').txt(row.senha || '').up()
        .ele('operador_email').txt(row.operador_email || '').up()
        .ele('data_leitura').txt(String(row.data_leitura)).up()
      .up();
    });

    const xmlString = root.end({ prettyPrint: true });

    // Definir os headers HTTP para forçar o download do arquivo XML
    res.header('Content-Type', 'application/xml');
    res.attachment('scanonu_etiquetas.xml');
    return res.send(xmlString);

  } catch (err: any) {
    console.error('Erro ao exportar XML:', err);
    return res.status(500).json({ error: 'Erro ao gerar arquivo XML.' });
  }
});

// Rota para exportar todas as etiquetas em Excel (somente Admin)
app.get('/api/admin/export-excel', async (req, res) => {
  try {
    const { adminEmail, search, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    const checkAdmin = await dbPool.query('SELECT role FROM usuarios_scan_onu WHERE email = $1', [adminEmail]);
    if (!checkAdmin.rowCount || checkAdmin.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem exportar o banco.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;

    if (search) {
      queryText += ` AND (gpon_sn ILIKE $${paramCount} OR cpe_sn ILIKE $${paramCount} OR mac ILIKE $${paramCount})`;
      queryValues.push(`%${search}%`);
      paramCount++;
    }

    if (modelo) {
      queryText += ` AND modelo ILIKE $${paramCount}`;
      queryValues.push(`%${modelo}%`);
      paramCount++;
    }

    if (startDate) {
      queryText += ` AND data_leitura >= $${paramCount}`;
      queryValues.push(startDate);
      paramCount++;
    }

    if (endDate) {
      queryText += ` AND data_leitura <= $${paramCount}`;
      queryValues.push(`${endDate} 23:59:59`);
      paramCount++;
    }

    queryText += ' ORDER BY data_leitura ASC';
    const etiquetasRes = await dbPool.query(queryText, queryValues);

    const dataRows = etiquetasRes.rows.map((row, index) => ({
      'ID': index + 1,
      'Fabricante': row.fabricante || '',
      'Modelo': row.modelo || '',
      'CPE Serial Number': row.cpe_sn || '',
      'GPON Serial Number': row.gpon_sn || '',
      'Endereço MAC': row.mac || '',
      'SSID Wi-Fi 2.4G / Único': row.wifi_ssid || '',
      'SSID Wi-Fi 5G': row.wifi_ssid_5g || '',
      'Senha WIFI': row.wifi_key || '',
      'Usuário': row.usuario || '',
      'Senha WEB': row.senha || '',
      'Operador': row.operador_email || '',
      'Data de Leitura': row.data_leitura ? new Date(row.data_leitura).toLocaleString('pt-BR') : ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Etiquetas');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=scanonu_etiquetas.xlsx');
    return res.send(excelBuffer);

  } catch (err: any) {
    console.error('Erro ao exportar Excel:', err);
    return res.status(500).json({ error: 'Erro ao gerar arquivo Excel.' });
  }
});

import fs from 'fs';
import path from 'path';

// Rota da API externa para consulta de unidades (ex: integração com C#)
app.get('/api/external/units', async (req, res) => {
  try {
    const { gpon_sn, mac, search } = req.query;

    // Proteção por chave de API (opcional, pode ser definida no .env como EXTERNAL_API_KEY)
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedApiKey = process.env.EXTERNAL_API_KEY;
    if (expectedApiKey && apiKeyHeader !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Chave de API inválida ou ausente no cabeçalho X-API-Key.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    let queryText = 'SELECT ROW_NUMBER() OVER (ORDER BY data_leitura ASC)::integer AS id, fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, operador_email, data_leitura FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;

    if (gpon_sn) {
      queryText += ` AND gpon_sn = $${paramCount}`;
      queryValues.push(gpon_sn);
      paramCount++;
    } else if (mac) {
      queryText += ` AND mac = $${paramCount}`;
      queryValues.push(mac);
      paramCount++;
    } else if (search) {
      queryText += ` AND (gpon_sn ILIKE $${paramCount} OR cpe_sn ILIKE $${paramCount} OR mac ILIKE $${paramCount})`;
      queryValues.push(`%${search}%`);
      paramCount++;
    }

    queryText += ' ORDER BY data_leitura DESC';
    const result = await dbPool.query(queryText, queryValues);

    return res.json({
      success: true,
      count: result.rowCount,
      units: result.rows
    });

  } catch (err: any) {
    console.error('Erro na API externa de consulta:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao consultar unidades.' });
  }
});

// Todas as outras rotas GET servem o index.html do React em produção
app.get('*', (req, res) => {
  const indexPath = path.resolve('public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <html>
        <head>
          <title>ScanONU API</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #002f56; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .container { text-align: center; max-width: 600px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); }
            h1 { margin-bottom: 10px; font-weight: 800; }
            p { font-size: 14px; opacity: 0.8; }
            a { color: #38bdf8; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>ScanONU API Rodando 🚀</h1>
            <p>O backend está funcionando normalmente na porta 3001.</p>
            <p>Para interagir com o sistema no ambiente de desenvolvimento, acesse o frontend em: <a href="http://localhost:3000" target="_blank">http://localhost:3000</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor ScanONU rodando na porta http://localhost:${PORT}`);
});

