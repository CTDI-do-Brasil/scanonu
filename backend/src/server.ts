import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { create } from 'xmlbuilder2';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { uploadZplToMinio } from './minio';

dotenv.config();

const geminiApiKey = process.env.GEMINI_API_KEY;
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
if (ai) {
  console.log('Cliente Gemini Vision API inicializado com sucesso.');
} else {
  console.warn('Variável de ambiente GEMINI_API_KEY não configurada. O serviço de leitura de etiquetas está inativo (OCR local descontinuado).');
}


const app = express();

app.use(helmet());

const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const PORT = process.env.PORT || 3001;

// Configurar limites de payload grandes (50MB) para suportar fotos de alta resolução
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Middleware para autenticar sessões usando o token no cabeçalho Authorization
const authenticateSession = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Token de sessão ausente.' });
    }

    if (!dbConnected || !dbPool) {
      // Fallback local em ambiente sem banco de dados (desenvolvimento)
      if (token === 'fallback-admin-token') {
        req.user = { email: 'admin@scanonu.com', role: 'admin' };
        return next();
      }
      return res.status(503).json({ success: false, error: 'Banco de dados offline.' });
    }

    const sessionRes = await dbPool.query(
      'SELECT email, role FROM sessoes_scan_onu WHERE token = $1 AND data_expiracao > NOW()',
      [token]
    );

    if (sessionRes.rowCount && sessionRes.rowCount > 0) {
      req.user = {
        email: sessionRes.rows[0].email,
        role: sessionRes.rows[0].role
      };
      return next();
    } else {
      return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
  } catch (err) {
    console.error('Erro na autenticação de sessão:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao validar autenticação.' });
  }
};

// Servir arquivos estáticos do frontend em ambiente de produção (CapRover)
// O Dockerfile irá compilar o frontend dentro do diretório public/dist
app.use(express.static('public'));

const pools: { [dbName: string]: Pool } = {};
const initializedDatabases = new Set<string>();

function getDefaultDatabaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return 'db-scanonu';
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.substring(1);
    return name || 'db-scanonu';
  } catch (e) {
    const match = url ? url.match(/\/([^\/?]+)(?:\?|$)/) : null;
    return match ? match[1] : 'db-scanonu';
  }
}

function getPoolForDatabase(dbName: string): Pool {
  const baseConnectionString = process.env.DATABASE_URL;
  if (!baseConnectionString) {
    throw new Error('DATABASE_URL não configurada no servidor.');
  }

  const cacheKey = dbName.trim();
  if (pools[cacheKey]) {
    return pools[cacheKey];
  }

  let connectionString = baseConnectionString;
  try {
    const parsedUrl = new URL(baseConnectionString);
    parsedUrl.pathname = '/' + cacheKey;
    connectionString = parsedUrl.toString();
  } catch (err) {
    const lastSlashIndex = baseConnectionString.lastIndexOf('/');
    const questionMarkIndex = baseConnectionString.indexOf('?', lastSlashIndex);
    if (lastSlashIndex !== -1) {
      const prefix = baseConnectionString.substring(0, lastSlashIndex + 1);
      const suffix = questionMarkIndex !== -1 ? baseConnectionString.substring(questionMarkIndex) : '';
      connectionString = prefix + cacheKey + suffix;
    }
  }

  console.log(`Criando novo pool de conexão para o banco de dados: ${cacheKey}`);
  const useSSL = !connectionString.includes('localhost') && 
                 !connectionString.includes('127.0.0.1') && 
                 !connectionString.includes('srv-captain') && 
                 !connectionString.includes('sslmode=disable') &&
                 process.env.DB_SSL !== 'false';

  const pool = new Pool({
    connectionString: connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : false
  });

  pools[cacheKey] = pool;
  return pool;
}

async function ensureDatabaseSchema(pool: Pool, dbName: string) {
  if (initializedDatabases.has(dbName)) return;

  console.log(`Inicializando tabelas e migrações no banco: ${dbName}...`);
  
  // Criar tabela de etiquetas
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS etiquetas_scan_onu (
      gpon_sn VARCHAR(100) PRIMARY KEY,
      fabricante VARCHAR(100) NOT NULL,
      modelo VARCHAR(100) NOT NULL,
      cpe_sn VARCHAR(100),
      mac VARCHAR(100),
      wifi_ssid VARCHAR(100),
      wifi_ssid_5g VARCHAR(100),
      wifi_key VARCHAR(100),
      usuario VARCHAR(100),
      web_key VARCHAR(100),
      imagem_url VARCHAR(500),
      operador_email VARCHAR(150),
      data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(createTableQuery);

  // Criar tabela de usuários
  const createUsersTableQuery = `
    CREATE TABLE IF NOT EXISTS usuarios_scan_onu (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL,
      senha VARCHAR(100) NOT NULL,
      role VARCHAR(50) DEFAULT 'operador',
      operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'
    );
  `;
  await pool.query(createUsersTableQuery);

  // Garantir coluna operacao se não existir
  try {
    await pool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN IF NOT EXISTS operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
  } catch (e) {}

  // Criar tabela de sessões
  const createSessionsTableQuery = `
    CREATE TABLE IF NOT EXISTS sessoes_scan_onu (
      token VARCHAR(100) PRIMARY KEY,
      email VARCHAR(150) NOT NULL,
      role VARCHAR(50) NOT NULL,
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data_expiracao TIMESTAMP NOT NULL
    );
  `;
  await pool.query(createSessionsTableQuery);

  // Criar tabela de impressoras
  const createPrintersTableQuery = `
    CREATE TABLE IF NOT EXISTS impressoras_scan_onu (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      descricao VARCHAR(250),
      ip VARCHAR(50) NOT NULL,
      porta INT NOT NULL DEFAULT 6101,
      localizacao VARCHAR(150),
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(createPrintersTableQuery);

  // Migração para remover a coluna ID caso ela já exista
  try {
    const checkColumn = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' AND column_name='id'"
    );
    if (checkColumn.rowCount && checkColumn.rowCount > 0) {
      await pool.query('ALTER TABLE etiquetas_scan_onu DROP CONSTRAINT IF EXISTS etiquetas_scan_onu_pkey CASCADE');
      await pool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN IF EXISTS id CASCADE');
      await pool.query('ALTER TABLE etiquetas_scan_onu ADD PRIMARY KEY (gpon_sn)');
    }
  } catch (e) {}

  // Garantir SSID e Imagem URL
  try {
    await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100)');
    await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid_5g VARCHAR(100)');
    await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS imagem_url VARCHAR(500)');
  } catch (e) {}

  // Garantir UNIQUE
  try {
    await pool.query('ALTER TABLE etiquetas_scan_onu ADD CONSTRAINT unique_gpon_sn UNIQUE (gpon_sn)');
  } catch (e) {}

  // Garantir coluna web_key (se for banco legado que tinha 'senha')
  try {
    const checkSenha = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' AND column_name='senha'"
    );
    if (checkSenha.rowCount && checkSenha.rowCount > 0) {
      await pool.query('UPDATE etiquetas_scan_onu SET wifi_key = senha, senha = wifi_key');
      await pool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN senha TO web_key');
    }
  } catch (e) {}

  // Garantir admin
  const adminCheck = await pool.query("SELECT id FROM usuarios_scan_onu WHERE email = 'admin@scanonu.com'");
  if (!adminCheck.rowCount || adminCheck.rowCount === 0) {
    await pool.query(
      "INSERT INTO usuarios_scan_onu (email, senha, role) VALUES ('admin@scanonu.com', 'admin123', 'admin')"
    );
  }

  initializedDatabases.add(dbName);
  console.log(`Banco ${dbName} inicializado com sucesso.`);
}

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

      const defaultDb = getDefaultDatabaseName();
      pools[defaultDb] = dbPool;
      initializedDatabases.add(defaultDb);

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
          web_key VARCHAR(100),
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
          role VARCHAR(50) DEFAULT 'operador',
          operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'
        );
      `;
      await dbPool.query(createUsersTableQuery);

      // Garantir coluna operacao se não existir
      try {
        await dbPool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN IF NOT EXISTS operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
      } catch (e) {}

      // Criar a tabela de sessões
      const createSessionsTableQuery = `
        CREATE TABLE IF NOT EXISTS sessoes_scan_onu (
          token VARCHAR(100) PRIMARY KEY,
          email VARCHAR(150) NOT NULL,
          role VARCHAR(50) NOT NULL,
          data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          data_expiracao TIMESTAMP NOT NULL
        );
      `;
      await dbPool.query(createSessionsTableQuery);

      // Criar tabela de impressoras
      const createPrintersTableQuery = `
        CREATE TABLE IF NOT EXISTS impressoras_scan_onu (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(150) NOT NULL,
          descricao VARCHAR(250),
          ip VARCHAR(50) NOT NULL,
          porta INT NOT NULL DEFAULT 6101,
          localizacao VARCHAR(150),
          data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await dbPool.query(createPrintersTableQuery);

      // Migração para remover a coluna ID das etiquetas caso ela já exista
      try {
        const checkColumn = await dbPool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' AND column_name='id'"
        );
        if (checkColumn.rowCount && checkColumn.rowCount > 0) {
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP CONSTRAINT IF EXISTS etiquetas_scan_onu_pkey CASCADE');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN IF EXISTS id CASCADE');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD PRIMARY KEY (gpon_sn)');
        }
      } catch (e) {}

      // Garantir SSID e Imagem URL nas etiquetas
      try {
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100)');
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS wifi_ssid_5g VARCHAR(100)');
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS imagem_url VARCHAR(500)');
      } catch (e) {}

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

      // Migração para inverter os dados trocados e renomear a coluna senha para web_key
      try {
        const checkSenhaColumn = await dbPool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' AND column_name='senha'"
        );
        if (checkSenhaColumn.rowCount && checkSenhaColumn.rowCount > 0) {
          console.log('Migrando banco: corrigindo valores invertidos de wifi_key/senha e renomeando coluna para web_key...');
          // 1. Inverte os dados no banco
          await dbPool.query('UPDATE etiquetas_scan_onu SET wifi_key = senha, senha = wifi_key');
          // 2. Renomeia a coluna senha para web_key
          await dbPool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN senha TO web_key');
          console.log('Migração concluída com sucesso!');
        }
      } catch (migErr: any) {
        console.error('Erro ao migrar coluna senha para web_key:', migErr.message || migErr);
      }

      // Garantir o cadastro/reset do administrador padrão para evitar lockout
      const adminCheck = await dbPool.query("SELECT id FROM usuarios_scan_onu WHERE email = 'admin@scanonu.com'");
      if (!adminCheck.rowCount || adminCheck.rowCount === 0) {
        await dbPool.query(
          "INSERT INTO usuarios_scan_onu (email, senha, role, operacao) VALUES ('admin@scanonu.com', 'admin123', 'admin', 'CTDI MATRIZ')"
        );
        console.log('Usuário admin padrão (admin@scanonu.com / admin123) cadastrado com sucesso.');
      } else {
        await dbPool.query(
          "UPDATE usuarios_scan_onu SET senha = 'admin123', role = 'admin', operacao = 'CTDI MATRIZ' WHERE email = 'admin@scanonu.com'"
        );
        console.log('Senha e perfil do usuário admin@scanonu.com resetados com sucesso.');
      }

      // Executar migração para normalizar dados históricos existentes no banco
      try {
        console.log('Iniciando normalização de fabricantes e modelos antigos no banco...');
        // Normalizar fabricantes
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'Huawei' WHERE fabricante ILIKE '%Huawei%' AND fabricante != 'Huawei'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'ZTE' WHERE fabricante ILIKE '%ZTE%' AND fabricante != 'ZTE'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'FiberHome' WHERE fabricante ILIKE '%FiberHome%' AND fabricante != 'FiberHome'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'Intelbras' WHERE fabricante ILIKE '%Intelbras%' AND fabricante != 'Intelbras'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'Nokia' WHERE fabricante ILIKE '%Nokia%' AND fabricante != 'Nokia'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'Alcatel' WHERE fabricante ILIKE '%Alcatel%' AND fabricante != 'Alcatel'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'SagemCOM' WHERE (fabricante ILIKE '%Sagem%' OR fabricante ILIKE '%SMBS%' OR fabricante ILIKE '%SMB8%') AND fabricante != 'SagemCOM'");

        // Normalizar modelos Sagemcom
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5655V2' WHERE (fabricante = 'SagemCOM' OR fabricante ILIKE '%Sagem%') AND (modelo ILIKE '%5655%' OR modelo ILIKE '%FAST5655%') AND modelo != 'F@ST 5655V2'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5670V2' WHERE (fabricante = 'SagemCOM' OR fabricante ILIKE '%Sagem%') AND (modelo ILIKE '%5670%V2%' OR modelo ILIKE '%5670V2%') AND modelo != 'F@ST 5670V2'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5670' WHERE (fabricante = 'SagemCOM' OR fabricante ILIKE '%Sagem%') AND modelo ILIKE '%5670%' AND modelo NOT ILIKE '%V2%' AND modelo != 'F@ST 5670'");

        // Normalizar modelos ZTE e Huawei
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F670L' WHERE fabricante = 'ZTE' AND (modelo ILIKE '%F670L%' OR modelo ILIKE '%F670%') AND modelo != 'F670L'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F6600' WHERE fabricante = 'ZTE' AND (modelo ILIKE '%F6600%' OR modelo ILIKE '%F660%') AND modelo != 'F6600'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'HG8145V5' WHERE fabricante = 'Huawei' AND (modelo ILIKE '%HG8145V5%' OR modelo ILIKE '%8145V5%' OR modelo ILIKE '%HG8145%') AND modelo != 'HG8145V5'");
        await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'EG8145V5' WHERE fabricante = 'Huawei' AND (modelo ILIKE '%EG8145V5%' OR modelo ILIKE '%EG8145%') AND modelo != 'EG8145V5'");
        console.log('Normalização de dados históricos concluída com sucesso!');
      } catch (err: any) {
        console.error('Erro ao normalizar dados históricos existentes no banco:', err.message || err);
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

// Endpoint para listar os modelos do Gemini disponíveis no ambiente
app.get('/api/debug-models', async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: 'Cliente Gemini não inicializado.' });
    }
    const response = await ai.models.list();
    return res.json({ success: true, models: response });
  } catch (err: any) {
    console.error('Erro ao listar modelos do Gemini:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
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

function normalizeModel(modelo: string, fabricante: string): string {
  let modelNorm = (modelo || '').trim();
  const mfgUpper = (fabricante || '').toUpperCase();
  const modelClean = modelNorm.toUpperCase().replace(/[^A-Z0-9@]/g, '');

  // Sagemcom F@ST 5655V2
  if (
    modelClean.includes('FAST5655V2') || 
    modelClean.includes('F@ST5655V2') || 
    (modelClean.includes('5655V2') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5655'))
  ) {
    return 'F@ST 5655V2';
  }

  // Sagemcom F@ST 5670V2
  if (
    modelClean.includes('FAST5670V2') || 
    modelClean.includes('F@ST5670V2') || 
    (modelClean.includes('5670V2') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5670V2'))
  ) {
    return 'F@ST 5670V2';
  }

  // Sagemcom F@ST 5670
  if (
    modelClean.includes('FAST5670') || 
    modelClean.includes('F@ST5670') || 
    (modelClean.includes('5670') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5670'))
  ) {
    return 'F@ST 5670';
  }

  // ZTE F670L
  if (
    mfgUpper.includes('ZTE') &&
    (modelClean.includes('F670L') || modelClean.includes('F670'))
  ) {
    return 'F670L';
  }

  // ZTE F6600
  if (
    mfgUpper.includes('ZTE') &&
    (modelClean.includes('F6600') || modelClean.includes('F660'))
  ) {
    return 'F6600';
  }

  // Huawei HG8145V5
  if (
    mfgUpper.includes('HUAWEI') &&
    (modelClean.includes('HG8145V5') || modelClean.includes('8145V5') || modelClean.includes('HG8145'))
  ) {
    return 'HG8145V5';
  }

  // Huawei EG8145V5
  if (
    mfgUpper.includes('HUAWEI') &&
    (modelClean.includes('EG8145V5') || modelClean.includes('EG8145'))
  ) {
    return 'EG8145V5';
  }

  return modelNorm;
}

app.post('/api/scan-label', authenticateSession, async (req, res) => {
  let scanResult: any = null;
  let scanSource = 'gemini-vision';

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

  // Analise a imagem da etiqueta...
  const prompt = `Analise a imagem da etiqueta do equipamento ONU/ONT e extraia os seguintes campos de forma estruturada. 
Siga atentamente as instruções abaixo para cada campo:
1. fabricante: Fabricante da ONU (ex: Huawei, ZTE, FiberHome, Intelbras, Nokia, Alcatel, SagemCOM).
2. modelo: Modelo exato da ONU (ex: F670L, HG8145V5, EG8145V5, F6600, F680, F673, XC-FIT-150, F@ST 5655V2, etc.).
3. cpe_sn: Serial CPE/Equipamento (geralmente começa com N7 ou similar). Se for igual ao GPON SN, deixe vazio ou extraia o correto se houver.
4. gpon_sn: Serial GPON (ex: SMBS12345678, ZTEG12345678, FHTT12345678, ALCL12345678, HWTC12345678). Certifique-se de que tenha 12 caracteres. Se começar com SMB8, corrija para SMBS.
5. mac: Endereço MAC físico de 12 caracteres hexadecimais (ex: 8020DAD1D2D3). Remova separadores como ':' ou '-'. Certifique-se de que o prefixo/OUI seja válido para o fabricante.
6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única.
7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz, se existir separadamente.
8. wifi_key: Senha padrão do Wi-Fi. ATENÇÃO MÁXIMA: Diferencie claramente 'O' (letra) de '0' (número), '1' de 'I' ou 'l'. Preserve letras maiúsculas e minúsculas exatamente como na imagem. NUNCA adicione ou deduza caracteres.
9. usuario: Usuário padrão de acesso web (geralmente admin, user, etc.).
10. web_key: Senha de acesso web (Password/Senha). ATENÇÃO MÁXIMA À EXATIDÃO: Pode conter caracteres especiais (como %, @, !, #, &), letras maiúsculas, minúsculas e números. Leia exatamente o que está impresso. NUNCA adicione caracteres extras (como reticências ou '/o') e respeite rigorosamente as letras maiúsculas e minúsculas.
11. reimpressa: Identifique se a etiqueta é uma reimpressão (geralmente não original, impressa em papel adesivo comum) retornando 'sim' ou 'nao'.`;

    let response;
    const maxAttempts = 2;
    let lastError: any = null;

    // Tentamos os modelos mais recentes e estáveis em sequência: gemini-2.5-flash, gemini-3.5-flash e depois gemini-3.1-flash-lite
    for (const modelName of ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`Tentativa ${attempt} de escaneamento usando o modelo ${modelName}...`);
          response = await ai.models.generateContent({
            model: modelName,
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
                  web_key: { type: Type.STRING },
                  reimpressa: { type: Type.STRING, description: "Retorne 'sim' ou 'nao'" }
                },
                required: ['gpon_sn']
              }
            }
          });
          scanSource = `gemini-vision (${modelName})`;
          break;
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          console.warn(`Erro no modelo ${modelName} na tentativa ${attempt}/${maxAttempts}:`, errMsg);
          
          if (errMsg.includes('Validation') || errMsg.includes('Schema')) {
            break; // Se for erro de validação do próprio código/schema, não adianta re-tentar
          }
          
          if (attempt < maxAttempts) {
            const delay = attempt * 1500; // 1.5s na primeira tentativa
            console.log(`Aguardando ${delay}ms antes de tentar novamente...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      if (response) {
        break;
      }
      console.log(`Modelo ${modelName} falhou. Tentando alternar para o próximo modelo de fallback...`);
    }

    if (!response) {
      throw lastError || new Error('Não foi possível obter resposta da API do Gemini com nenhum modelo.');
    }

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
      modelo: normalizeModel(geminiData.modelo || '', fabricanteNorm),
      cpe_sn: cpeNorm,
      gpon_sn: gponNorm,
      mac: macNorm,
      wifi_ssid: geminiData.wifi_ssid || '',
      wifi_ssid_5g: geminiData.wifi_ssid_5g || '',
      wifi_key: geminiData.wifi_key || '',
      usuario: geminiData.usuario || '',
      senha: geminiData.web_key || geminiData.senha || '',
      web_key: geminiData.web_key || geminiData.senha || '',
      reimpressa: geminiData.reimpressa || 'nao'
    };

    if (!scanResult.gpon_sn) {
      throw new Error('Não foi possível identificar o GPON Serial Number (S/N) na imagem da etiqueta.');
    }

    // Regra específica para o modelo 5670V2: a senha web (web_key) deve ter exatamente 8 caracteres
    const is5670v2 = scanResult.modelo && (scanResult.modelo.toUpperCase().includes('5670V2') || scanResult.modelo.toUpperCase().includes('5670 V2'));
    if (is5670v2) {
      const webKeyLength = (scanResult.web_key || '').length;
      if (webKeyLength !== 8) {
        throw new Error(`Erro de leitura OCR: O modelo ${scanResult.modelo} exige que a Senha Web tenha EXATAMENTE 8 caracteres. O sistema extraiu ${webKeyLength} caracteres ("${scanResult.web_key}"). Por favor, tente focar melhor a câmera, ou digite os dados manualmente.`);
      }
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
          'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
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
// Nova rota para salvar ou atualizar (sobrescrever) os dados no banco PostgreSQL
app.post('/api/save-label', authenticateSession, async (req: any, res: any) => {
  try {
    const { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, web_key, operador, overwrite, targetDb, imagem_url } = req.body;
    const resolvedWebKey = senha !== undefined ? senha : web_key;
    const normalizedModelo = normalizeModel(modelo, fabricante);

    let resolvedWifiSsid5g = wifi_ssid_5g || 'N/A';
    if (normalizedModelo.toUpperCase().includes('5676V2') || normalizedModelo.toUpperCase().includes('5676 V2')) {
      if (resolvedWifiSsid5g && resolvedWifiSsid5g !== 'N/A' && resolvedWifiSsid5g.trim() !== '') {
        if (!resolvedWifiSsid5g.toUpperCase().endsWith('_5G')) {
          resolvedWifiSsid5g = resolvedWifiSsid5g.trim() + '_5G';
        }
      }
    }

    if (!dbConnected) {
      console.warn("PostgreSQL não está conectado. Simulando gravação com sucesso.");
      return res.json({ 
        success: true, 
        message: 'Dados simulados com sucesso (PostgreSQL desativado no momento).',
        savedData: { ...req.body, modelo: normalizedModelo }
      });
    }

    // Determinar em qual banco de dados salvar
    let chosenDb = targetDb;
    const databases = ['db-scanonu', 'ScanONU_Claro'];
    
    if (!chosenDb) {
      // Procurar em qual banco o registro já existe
      for (const dbName of databases) {
        try {
          const tempPool = getPoolForDatabase(dbName);
          await ensureDatabaseSchema(tempPool, dbName);
          const checkRes = await tempPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 OR (mac = $2 AND mac <> \'N/A\')', [gpon_sn, mac]);
          if (checkRes.rowCount && checkRes.rowCount > 0) {
            chosenDb = dbName;
            break;
          }
        } catch (e) {
          console.error(`Erro ao verificar existência no banco ${dbName}:`, e);
        }
      }
    }

    // Se ainda não tiver escolhido, tentar buscar pela operação do usuário logado
    if (!chosenDb && req.user && req.user.email) {
      try {
        const defaultPool = getPoolForDatabase('db-scanonu');
        await ensureDatabaseSchema(defaultPool, 'db-scanonu');
        const userRes = await defaultPool.query('SELECT operacao FROM usuarios_scan_onu WHERE email = $1', [req.user.email.trim().toLowerCase()]);
        if (userRes.rowCount && userRes.rowCount > 0) {
          const op = userRes.rows[0].operacao;
          if (op === 'CTDI OPERAÇÃO GLP') {
            chosenDb = 'ScanONU_Claro';
          } else if (op === 'CTDI MATRIZ') {
            chosenDb = 'db-scanonu';
          }
        }
      } catch (err) {
        console.error('Erro ao consultar operacao do usuario:', err);
      }
    }

    // Se ainda não tiver escolhido, usar o padrão
    if (!chosenDb) {
      chosenDb = getDefaultDatabaseName();
    }

    const pool = getPoolForDatabase(chosenDb);
    await ensureDatabaseSchema(pool, chosenDb);

    // Gerar arquivo ZPL e enviar para o MinIO
    let zplUrl: string | null = null;
    try {
      zplUrl = await uploadZplToMinio({
        fabricante, 
        modelo: normalizedModelo, 
        cpe_sn, 
        gpon_sn, 
        mac, 
        wifi_ssid, 
        wifi_ssid_5g: resolvedWifiSsid5g, 
        wifi_key
      });
    } catch (minioErr) {
      console.error('Erro ao gerar/enviar ZPL pro MinIO:', minioErr);
    }

    const checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists) {
      if (!overwrite) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial já existe no banco de dados.'
        });
      }

      // Se for para sobrescrever, usamos um UPDATE
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
          web_key = $9,
          operador_email = $10,
          imagem_url = COALESCE($12, imagem_url),
          data_leitura = CURRENT_TIMESTAMP
        WHERE gpon_sn = $11
      `;
      const updateValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        cpe_sn || 'N/A',
        mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        gpon_sn,
        zplUrl || imagem_url || null
      ];
      await pool.query(updateQuery, updateValues);
      console.log(`Dados atualizados com sucesso no banco ${chosenDb}. Serial GPON: ${gpon_sn}`);
    } else {
      const insertQuery = `
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email, imagem_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;
      const insertValues = [
        fabricante || 'N/A',
        normalizedModelo || 'N/A',
        cpe_sn || 'N/A',
        gpon_sn || 'N/A',
        mac || 'N/A',
        wifi_ssid || 'N/A',
        resolvedWifiSsid5g,
        wifi_key || 'N/A',
        usuario || 'N/A',
        resolvedWebKey || 'N/A',
        operador || 'sistema',
        zplUrl || imagem_url || null
      ];
      await pool.query(insertQuery, insertValues);
      console.log(`Dados salvos com sucesso no banco ${chosenDb}. Serial GPON: ${gpon_sn}`);
    }

    return res.json({ 
      success: true, 
      message: exists 
        ? `Dados atualizados/sobrescritos com sucesso no banco ${chosenDb}!`
        : `Dados salvos com sucesso no banco ${chosenDb}!` 
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

// Rota para obter uma etiqueta existente pelo GPON SN, MAC ou rede WIFI nos dois bancos
app.get('/api/label/:gpon_sn', authenticateSession, async (req, res) => {
  try {
    const { gpon_sn } = req.params;

    if (!dbConnected) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    const cleanQuery = gpon_sn.toUpperCase().trim();
    const databases = ['db-scanonu', 'ScanONU_Claro'];
    let foundRecord = null;
    let foundDb = '';

    for (const dbName of databases) {
      try {
        const pool = getPoolForDatabase(dbName);
        await ensureDatabaseSchema(pool, dbName);

        const checkRes = await pool.query(
          `SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha 
           FROM etiquetas_scan_onu 
           WHERE UPPER(gpon_sn) = $1 OR UPPER(mac) = $1 OR UPPER(wifi_ssid) = $1 OR UPPER(wifi_ssid_5g) = $1`,
          [cleanQuery]
        );

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          foundRecord = checkRes.rows[0];
          foundDb = dbName;
          break;
        }
      } catch (err) {
        console.error(`Erro ao buscar no banco ${dbName}:`, err);
      }
    }

    if (foundRecord) {
      return res.json({
        success: true,
        data: foundRecord,
        database: foundDb
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado em nenhum dos bancos de dados.'
      });
    }
  } catch (err: any) {
    console.error('Erro ao consultar GPON SN:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao consultar equipamento.' });
  }
});

// Rota pública para obter apenas as credenciais de acesso de uma ONU pelo GPON SN, MAC ou rede WIFI nos dois bancos
app.get('/api/public/label/:query', async (req, res) => {
  try {
    const { query } = req.params;

    if (!dbConnected) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    const cleanQuery = query.toUpperCase().trim();
    const databases = ['db-scanonu', 'ScanONU_Claro'];
    let foundRecord = null;
    let foundDb = '';

    for (const dbName of databases) {
      try {
        const pool = getPoolForDatabase(dbName);
        await ensureDatabaseSchema(pool, dbName);

        const checkRes = await pool.query(
          `SELECT fabricante, modelo, gpon_sn, mac, usuario, web_key, wifi_ssid 
           FROM etiquetas_scan_onu 
           WHERE UPPER(gpon_sn) = $1 OR UPPER(mac) = $1 OR UPPER(wifi_ssid) = $1 OR UPPER(wifi_ssid_5g) = $1`,
          [cleanQuery]
        );

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          foundRecord = checkRes.rows[0];
          foundDb = dbName;
          break;
        }
      } catch (err) {
        console.error(`Erro ao buscar no banco público ${dbName}:`, err);
      }
    }

    if (foundRecord) {
      return res.json({
        success: true,
        data: {
          fabricante: foundRecord.fabricante,
          modelo: foundRecord.modelo,
          gpon_sn: foundRecord.gpon_sn,
          mac: foundRecord.mac,
          usuario: foundRecord.usuario,
          senha: foundRecord.web_key,
          web_key: foundRecord.web_key
        },
        database: foundDb
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Equipamento não encontrado em nenhum dos bancos de dados.'
      });
    }
  } catch (err: any) {
    console.error('Erro na consulta pública do equipamento:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao consultar equipamento.' });
  }
});

// Rota de login real usando o PostgreSQL
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!dbConnected || !dbPool) {
      // Fallback local se o banco não estiver configurado para testes
      if (email === 'admin@scanonu.com' && senha === 'admin123') {
        return res.json({ 
          success: true, 
          token: 'fallback-admin-token',
          user: { email, role: 'admin' } 
        });
      }
      return res.status(401).json({ error: 'Banco desconectado. Credenciais inválidas.' });
    }

    const userRes = await dbPool.query(
      'SELECT email, role, operacao FROM usuarios_scan_onu WHERE email = $1 AND senha = $2',
      [email.trim().toLowerCase(), senha]
    );

    if (userRes.rowCount && userRes.rowCount > 0) {
      const user = userRes.rows[0];
      
      // Gerar token de sessão criptograficamente seguro
      const token = crypto.randomBytes(32).toString('hex');
      
      // Salvar a sessão no banco com validade de 1 dia
      await dbPool.query(
        "INSERT INTO sessoes_scan_onu (token, email, role, data_expiracao) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')",
        [token, user.email, user.role]
      );

      return res.json({ 
        success: true, 
        token,
        user
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
app.post('/api/admin/users', authenticateSession, async (req: any, res: any) => {
  try {
    const { email, senha, role, operacao } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem cadastrar usuários.' });
    }

    await dbPool.query(
      'INSERT INTO usuarios_scan_onu (email, senha, role, operacao) VALUES ($1, $2, $3, $4)',
      [email.trim().toLowerCase(), senha, role || 'operador', operacao || 'CTDI MATRIZ']
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
app.put('/api/admin/users', authenticateSession, async (req: any, res: any) => {
  try {
    const { id, email, senha, role, operacao } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar usuários.' });
    }

    let queryText = '';
    let queryValues = [];

    if (senha && senha.trim() !== '') {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, senha = $2, role = $3, operacao = $4 WHERE id = $5';
      queryValues = [email.trim().toLowerCase(), senha.trim(), role, operacao || 'CTDI MATRIZ', id];
    } else {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, role = $2, operacao = $3 WHERE id = $4';
      queryValues = [email.trim().toLowerCase(), role, operacao || 'CTDI MATRIZ', id];
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
app.get('/api/admin/users', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) {
      return res.json({ success: true, users: [{ email: 'admin@scanonu.com', role: 'admin', operacao: 'CTDI MATRIZ' }] });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const usersRes = await dbPool.query('SELECT id, email, role, operacao FROM usuarios_scan_onu ORDER BY email ASC');
    return res.json({ success: true, users: usersRes.rows });

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// --- ROTAS DE IMPRESSORAS (ADMIN) ---
// Listar impressoras
app.get('/api/admin/printers', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.json({ success: true, printers: [] });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const printersRes = await dbPool.query('SELECT * FROM impressoras_scan_onu ORDER BY nome ASC');
    return res.json({ success: true, printers: printersRes.rows });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar impressoras.' });
  }
});

// Adicionar impressora
app.post('/api/admin/printers', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { nome, descricao, ip, porta, localizacao } = req.body;
    await dbPool.query(
      'INSERT INTO impressoras_scan_onu (nome, descricao, ip, porta, localizacao) VALUES ($1, $2, $3, $4, $5)',
      [nome, descricao, ip, parseInt(porta) || 6101, localizacao]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar impressora.' });
  }
});

// Editar impressora
app.put('/api/admin/printers/:id', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { nome, descricao, ip, porta, localizacao } = req.body;
    await dbPool.query(
      'UPDATE impressoras_scan_onu SET nome = $1, descricao = $2, ip = $3, porta = $4, localizacao = $5 WHERE id = $6',
      [nome, descricao, ip, parseInt(porta) || 6101, localizacao, req.params.id]
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar impressora.' });
  }
});

// Deletar impressora
app.delete('/api/admin/printers/:id', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    await dbPool.query('DELETE FROM impressoras_scan_onu WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao remover impressora.' });
  }
});
// --- FIM ROTAS IMPRESSORAS ---

// Rota para obter estatísticas do painel Admin
app.get('/api/admin/stats', authenticateSession, async (req: any, res: any) => {
  try {
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

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const databases = ['db-scanonu', 'ScanONU_Claro'];
    let totalLabels = 0;
    
    let mfgMap: Record<string, number> = {};
    let modelMap: Record<string, number> = {};
    let opMap: Record<string, number> = {};

    for (const dbName of databases) {
      try {
        const tempPool = getPoolForDatabase(dbName);
        await ensureDatabaseSchema(tempPool, dbName);
        
        const countRes = await tempPool.query('SELECT COUNT(*) FROM etiquetas_scan_onu');
        totalLabels += parseInt(countRes.rows[0].count);

        const mfgRes = await tempPool.query('SELECT fabricante, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY fabricante');
        mfgRes.rows.forEach(r => {
          mfgMap[r.fabricante] = (mfgMap[r.fabricante] || 0) + parseInt(r.count);
        });

        const modelRes = await tempPool.query('SELECT modelo, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY modelo');
        modelRes.rows.forEach(r => {
          modelMap[r.modelo] = (modelMap[r.modelo] || 0) + parseInt(r.count);
        });

        const opRes = await tempPool.query('SELECT operador_email, COUNT(*) as count FROM etiquetas_scan_onu GROUP BY operador_email');
        opRes.rows.forEach(r => {
          opMap[r.operador_email] = (opMap[r.operador_email] || 0) + parseInt(r.count);
        });

      } catch (e) {
        console.error(`Erro ao buscar stats no banco ${dbName}:`, e);
      }
    }

    // A tabela de usuários fica apenas no banco principal (dbPool)
    const totalUsersRes = await dbPool.query('SELECT COUNT(*) FROM usuarios_scan_onu');

    // Transformar os mapas em arrays ordenados limitados a 10
    const mfgArray = Object.keys(mfgMap).map(k => ({ fabricante: k, count: mfgMap[k] })).sort((a, b) => b.count - a.count).slice(0, 10);
    const modelArray = Object.keys(modelMap).map(k => ({ modelo: k, count: modelMap[k] })).sort((a, b) => b.count - a.count).slice(0, 10);
    const opArray = Object.keys(opMap).map(k => ({ operador_email: k, count: opMap[k] })).sort((a, b) => b.count - a.count).slice(0, 10);

    return res.json({
      success: true,
      stats: {
        totalLabels: totalLabels,
        totalUsers: parseInt(totalUsersRes.rows[0].count),
        labelsByManufacturer: mfgArray,
        labelsByModel: modelArray,
        scansByOperator: opArray
      }
    });
  } catch (err: any) {
    console.error('Erro ao buscar estatísticas:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar estatísticas.' });
  }
});

// Rota para exportar todas as etiquetas em XML (somente Admin)
app.get('/api/admin/export-xml', authenticateSession, async (req: any, res: any) => {
  try {
    const { serialNumber, mac, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar o banco.' });
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
        .ele('senha').txt(row.web_key || '').up()
        .ele('web_key').txt(row.web_key || '').up()
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
app.get('/api/admin/export-excel', authenticateSession, async (req: any, res: any) => {
  try {
    const { search, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar a planilha.' });
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
      'Senha WEB': row.web_key || '',
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

// Rota para importar etiquetas a partir de uma planilha Excel (somente Admin)
app.post('/api/admin/import-excel', authenticateSession, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem importar planilhas.' });
    }

    const { fileBase64, targetDb } = req.body;
    if (!fileBase64) {
      return res.status(400).json({ success: false, error: 'Nenhuma planilha foi fornecida.' });
    }

    const targetDbName = targetDb || getDefaultDatabaseName();
    let pool: Pool;
    try {
      pool = getPoolForDatabase(targetDbName);
      await ensureDatabaseSchema(pool, targetDbName);
    } catch (dbErr: any) {
      console.error(`Erro ao conectar ao banco ${targetDbName}:`, dbErr);
      return res.status(500).json({ success: false, error: `Não foi possível conectar ao banco de dados '${targetDbName}': ${dbErr.message || dbErr}` });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Obter dados em JSON
    const rows = XLSX.utils.sheet_to_json<any>(worksheet);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'A planilha está vazia ou não pôde ser lida.' });
    }

    let successCount = 0;
    let errorCount = 0;
    
    // Função auxiliar para mapear chaves com flexibilidade
    const getVal = (row: any, keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }
      return '';
    };

    for (const row of rows) {
      // Mapeamento tolerante dos cabeçalhos
      const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
      const fabricante = fabricanteRaw || 'N/A';

      const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model']);
      const modelo = modeloRaw || 'N/A';

      const cpe_sn_raw = getVal(row, ['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE']);
      const cpe_sn = cpe_sn_raw || 'N/A';

      const macRaw = getVal(row, ['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr']);
      const mac = macRaw ? macRaw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : 'N/A';

      const wifi_ssid_raw = getVal(row, ['SSID Wi-Fi 2.4G / Único', 'SSID', 'wifi_ssid', 'SSID Wi-Fi', 'SSID Wifi', 'SSIDName', 'Rede Wi-Fi', 'Rede Wifi', 'wifi']);
      const wifi_ssid = wifi_ssid_raw || 'N/A';

      const wifi_ssid_5g_raw = getVal(row, ['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5']);
      const wifi_ssid_5g = wifi_ssid_5g_raw || 'N/A';

      const wifi_key_raw = getVal(row, ['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key']);
      const wifi_key = wifi_key_raw || 'N/A';

      const usuario_raw = getVal(row, ['Usuário', 'usuario', 'User', 'Usuario', 'Username', 'login', 'Login']);
      const usuario = usuario_raw || 'N/A';

      const web_key_raw = getVal(row, ['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web']);
      const web_key = web_key_raw || 'N/A';

      const operador_email = getVal(row, ['Operador', 'operador_email', 'Operator', 'Operador Email']) || req.user.email || 'N/A';

      const normalizedModelo = normalizeModel(modelo, fabricante);

      let finalWifiSsid5g = wifi_ssid_5g;
      if (normalizedModelo.toUpperCase().includes('5676V2') || normalizedModelo.toUpperCase().includes('5676 V2')) {
        if (finalWifiSsid5g && finalWifiSsid5g !== 'N/A' && finalWifiSsid5g.trim() !== '') {
          if (!finalWifiSsid5g.toUpperCase().endsWith('_5G')) {
            finalWifiSsid5g = finalWifiSsid5g.trim() + '_5G';
          }
        }
      }

      // GPON Serial: Se não vier GPON serial na planilha, geramos um N/A único
      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial']);
      let gpon_sn = gpon_sn_raw ? gpon_sn_raw.toUpperCase().trim() : '';
      if (!gpon_sn) {
        const suffix = mac !== 'N/A' ? mac : (wifi_ssid !== 'N/A' ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
        gpon_sn = 'N/A_' + suffix;
      }

      try {
        const query = `
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = EXCLUDED.cpe_sn,
            mac = EXCLUDED.mac,
            wifi_ssid = EXCLUDED.wifi_ssid,
            wifi_ssid_5g = EXCLUDED.wifi_ssid_5g,
            wifi_key = EXCLUDED.wifi_key,
            usuario = EXCLUDED.usuario,
            web_key = EXCLUDED.web_key,
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        `;
        const values = [
          fabricante,
          normalizedModelo,
          cpe_sn,
          gpon_sn,
          mac,
          wifi_ssid,
          finalWifiSsid5g,
          wifi_key,
          usuario,
          web_key,
          operador_email
        ];
        await pool.query(query, values);
        successCount++;
      } catch (dbErr) {
        console.error(`Erro ao importar linha com GPON SN ${gpon_sn}:`, dbErr);
        errorCount++;
      }
    }

    return res.json({
      success: true,
      message: `Processamento concluído. ${successCount} registros importados/atualizados com sucesso. ${errorCount} erros ou linhas inválidas.`,
      successCount,
      errorCount
    });

  } catch (err: any) {
    console.error('Erro na rota de importação de Excel:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro interno ao processar planilha.' });
  }
});

// Nova rota para apenas parsear e retornar os registros normalizados da planilha
app.post('/api/admin/parse-excel', authenticateSession, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas administradores podem importar planilhas.' });
    }

    const { fileBase64 } = req.body;
    if (!fileBase64) {
      return res.status(400).json({ success: false, error: 'Nenhuma planilha foi fornecida.' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const rows = XLSX.utils.sheet_to_json<any>(worksheet);
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'A planilha está vazia ou não pôde ser lida.' });
    }

    const getVal = (row: any, keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }
      return '';
    };

    const parsedRows = [];
    for (const row of rows) {
      const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
      const fabricante = fabricanteRaw || 'N/A';

      const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model']);
      const modelo = modeloRaw || 'N/A';

      const cpe_sn_raw = getVal(row, ['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE']);
      const cpe_sn = cpe_sn_raw || 'N/A';

      const macRaw = getVal(row, ['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr']);
      const mac = macRaw ? macRaw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : 'N/A';

      const wifi_ssid_raw = getVal(row, ['SSID Wi-Fi 2.4G / Único', 'SSID', 'wifi_ssid', 'SSID Wi-Fi', 'SSID Wifi', 'SSIDName', 'Rede Wi-Fi', 'Rede Wifi', 'wifi']);
      const wifi_ssid = wifi_ssid_raw || 'N/A';

      const wifi_ssid_5g_raw = getVal(row, ['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5']);
      const wifi_ssid_5g = wifi_ssid_5g_raw || 'N/A';

      const wifi_key_raw = getVal(row, ['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key']);
      const wifi_key = wifi_key_raw || 'N/A';

      const usuario_raw = getVal(row, ['Usuário', 'usuario', 'User', 'Usuario', 'Username', 'login', 'Login']);
      const usuario = usuario_raw || 'N/A';

      const web_key_raw = getVal(row, ['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web']);
      const web_key = web_key_raw || 'N/A';

      const normalizedModelo = normalizeModel(modelo, fabricante);

      let finalWifiSsid5g = wifi_ssid_5g;
      if (normalizedModelo.toUpperCase().includes('5676V2') || normalizedModelo.toUpperCase().includes('5676 V2')) {
        if (finalWifiSsid5g && finalWifiSsid5g !== 'N/A' && finalWifiSsid5g.trim() !== '') {
          if (!finalWifiSsid5g.toUpperCase().endsWith('_5G')) {
            finalWifiSsid5g = finalWifiSsid5g.trim() + '_5G';
          }
        }
      }

      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial']);
      let gpon_sn = gpon_sn_raw ? gpon_sn_raw.toUpperCase().trim() : '';
      if (!gpon_sn) {
        const suffix = mac !== 'N/A' ? mac : (wifi_ssid !== 'N/A' ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
        gpon_sn = 'N/A_' + suffix;
      }

      parsedRows.push({
        fabricante,
        modelo: normalizedModelo,
        cpe_sn,
        mac,
        wifi_ssid,
        wifi_ssid_5g: finalWifiSsid5g,
        wifi_key,
        usuario,
        web_key,
        gpon_sn
      });
    }

    return res.json({ success: true, rows: parsedRows });
  } catch (err: any) {
    console.error('Erro na rota de parsing de Excel:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro ao processar planilha.' });
  }
});

// Nova rota para importar um lote (batch) de registros em um banco selecionado
app.post('/api/admin/import-excel-batch', authenticateSession, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Acesso negado.' });
    }

    const { rows, targetDb } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ success: false, error: 'Lista de registros inválida ou vazia.' });
    }

    const targetDbName = targetDb || getDefaultDatabaseName();
    let pool: Pool;
    try {
      pool = getPoolForDatabase(targetDbName);
      await ensureDatabaseSchema(pool, targetDbName);
    } catch (dbErr: any) {
      console.error(`Erro ao conectar ao banco ${targetDbName}:`, dbErr);
      return res.status(500).json({ success: false, error: `Não foi possível conectar ao banco de dados '${targetDbName}': ${dbErr.message || dbErr}` });
    }

    let successCount = 0;
    let errorCount = 0;
    const operatorEmail = req.user.email || 'N/A';

    for (const row of rows) {
      try {
        const query = `
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = EXCLUDED.cpe_sn,
            mac = EXCLUDED.mac,
            wifi_ssid = EXCLUDED.wifi_ssid,
            wifi_ssid_5g = EXCLUDED.wifi_ssid_5g,
            wifi_key = EXCLUDED.wifi_key,
            usuario = EXCLUDED.usuario,
            web_key = EXCLUDED.web_key,
            operador_email = EXCLUDED.operador_email,
            data_leitura = CURRENT_TIMESTAMP
        `;
        const values = [
          row.fabricante || 'N/A',
          row.modelo || 'N/A',
          row.cpe_sn || 'N/A',
          row.gpon_sn,
          row.mac || 'N/A',
          row.wifi_ssid || 'N/A',
          row.wifi_ssid_5g || 'N/A',
          row.wifi_key || 'N/A',
          row.usuario || 'N/A',
          row.web_key || 'N/A',
          operatorEmail
        ];
        await pool.query(query, values);
        successCount++;
      } catch (dbErr) {
        console.error(`Erro ao importar linha no lote com GPON SN ${row.gpon_sn}:`, dbErr);
        errorCount++;
      }
    }

    return res.json({
      success: true,
      successCount,
      errorCount
    });
  } catch (err: any) {
    console.error('Erro na rota de importação de lote:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro interno ao importar lote.' });
  }
});

import fs from 'fs';
import path from 'path';

// Rota da API externa para consulta de unidades (ex: integração com C#)
app.get('/api/external/units', async (req, res) => {
  try {
    const { gpon_sn, mac, search } = req.query;

    // Proteção OBRIGATÓRIA por chave de API
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedApiKey = process.env.EXTERNAL_API_KEY;

    if (!expectedApiKey || expectedApiKey.trim() === '') {
      console.error('Aviso de Segurança: EXTERNAL_API_KEY não está configurada no servidor. Bloqueando consultas externas.');
      return res.status(503).json({ 
        success: false, 
        error: 'Serviço de consulta externa desativado por motivos de segurança. Configure a variável EXTERNAL_API_KEY no servidor.' 
      });
    }

    if (apiKeyHeader !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave de API inválida ou ausente no cabeçalho X-API-Key.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    let queryText = 'SELECT ROW_NUMBER() OVER (ORDER BY data_leitura ASC)::integer AS id, fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha, operador_email, data_leitura FROM etiquetas_scan_onu WHERE 1=1';
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

