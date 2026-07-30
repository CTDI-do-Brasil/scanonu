import express from 'express';
import net from 'net';
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


const APP_VERSION = Date.now().toString();
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

// Rota de verificação de versão
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// Rota temporária para limpar o lixo do banco
app.get('/api/admin/padronizar-5657', async (req, res) => {
  try {
    if (!dbPool) return res.send('Banco não conectado.');
    const result = await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5657 TIM LIVE' WHERE modelo ILIKE '%5657%'");
    res.send('Padronização concluida com sucesso! ' + result.rowCount + ' modelos atualizados. Voce ja pode fechar esta aba.');
  } catch (e: any) {
    res.send('Erro: ' + e.message);
  }
});

  // Rota temporária para padronizar fabricante VANTIVA no banco
  app.get('/api/admin/padronizar-vantiva', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'VANTIVA' WHERE modelo ILIKE '%FGA2232TIB%'");
      res.send('Padronização concluida com sucesso! ' + result.rowCount + ' fabricantes atualizados para VANTIVA. Voce ja pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });

app.get('/api/admin/limpar-lixo', async (req, res) => {
  try {
    if (!dbPool) return res.send('Banco não conectado.');
    const result = await dbPool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn LIKE 'N/A_%'");
    res.send('Limpeza concluida com sucesso! ' + result.rowCount + ' linhas apagadas. Voce ja pode fechar esta aba.');
  } catch (e: any) {
    res.send('Erro: ' + e.message);
  }
});


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
      'SELECT email, role, operacao FROM sessoes_scan_onu WHERE token = $1 AND data_expiracao > NOW()',
      [token]
    );

    if (sessionRes.rowCount && sessionRes.rowCount > 0) {
      req.user = {
        email: sessionRes.rows[0].email,
        role: sessionRes.rows[0].role,
        operacao: sessionRes.rows[0].operacao || 'CTDI MATRIZ'
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

// Print Queue Memory Store
const printJobs: { id: string; zpl: string; targetStation: string; timestamp: number }[] = [];
// Active Printers Registry
const activePrinters: { [id: string]: { name: string; lastSeen: number } } = {};

// Clean up inactive printers every minute (timeout after 30s)
setInterval(() => {
  const now = Date.now();
  for (const id in activePrinters) {
    if (now - activePrinters[id].lastSeen > 30000) {
      delete activePrinters[id];
    }
  }
}, 60000);

// Endpoint for the local proxy to register itself (heartbeat)
app.post('/api/active-printers', (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing id or name' });
  activePrinters[id] = { name, lastSeen: Date.now() };
  res.json({ success: true });
});

// Endpoint for frontend to fetch active printers
app.get('/api/active-printers', (req, res) => {
  const printers = Object.keys(activePrinters).map(id => ({
    id,
    name: activePrinters[id].name
  }));
  res.json({ printers });
});

// Proxy endpoint to render ZPL using Labelary via POST (bypasses CORS in browser)
app.post('/api/render-zpl', express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const zpl = req.body || '';
    const response = await fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4x3.5/0/', {
      method: 'POST',
      body: zpl,
      headers: {
        'Accept': 'image/png'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('Error proxying to Labelary:', error);
    res.status(500).send(error.message || 'Error rendering ZPL');
  }
});

// Endpoint para importação inteligente de código ZPL bruto usando o Gemini
app.post('/api/admin/smart-import-zpl', authenticateSession, express.text({ type: '*/*', limit: '5mb' }), async (req: any, res: any) => {
  try {
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    if (!ai) return res.status(503).json({ error: 'Serviço de IA Gemini não configurado ou offline.' });

    const rawZpl = req.body || '';
    if (!rawZpl.trim()) {
      return res.status(400).json({ error: 'O código ZPL não pode estar vazio.' });
    }

    const prompt = `Analise o código ZPL de etiqueta a seguir. 
O ZPL contém valores de dados estáticos e fixos que representam informações de equipamentos, como números de série, endereços MAC, senhas de Wi-Fi, SSIDs de Wi-Fi, IDs de chip (CA ID, SC ID), senhas de administração, etc.
Sua tarefa é converter este ZPL estático em um template ZPL dinâmico e gerar a configuração de campos correspondente.

Regras de Conversão:
1. Identifique apenas os dados variáveis individuais (bipados pelo operador por aparelho) e substitua-os por variáveis dinâmicas no ZPL no formato \${nome_da_variavel}.
   Use nomes de variáveis padrão e limpos, preferencialmente:
   - Para Serial Number / número de série: use "sn" (e "sn_clean" se estiver em código de barras).
   - Para MAC Address: use "mac" (e "mac_clean" sem pontuação se estiver em código de barras).
   - Para PON ID: use "pon" (e "pon_clean" sem pontuação se estiver em código de barras).
   - Para D-SN: use "d_sn" (e "d_sn_clean" sem pontuação se estiver em código de barras).
   - Para CA ID: use "ca_id" (ou "caid", e "ca_id_clean" se estiver em código de barras).
   - Para SC ID: use "sc_id" (ou "scid", e "sc_id_clean" se estiver em código de barras).
   - Para SSID de Wi-Fi: use "ssid".
   - Para Senha de Wi-Fi: use "senha_wifi".
   - Para Senha de Admin/Acesso: use "senha_admin".
   - Para Usuário de Admin/Acesso: use "usuario".
2. IMPORTANTE (O QUE NÃO DEVE SER VARIÁVEL): Textos fixos de homologação (como código Anatel "2156-23-08848", "04333-20-01647", etc.), o nome do Modelo do equipamento (como "K4KCW5", "ZXHN F689", "S4KW3"), IPs fixos (como "192.168.0.1"), CNPJs, nomes de fabricantes e avisos legais/comodato NUNCA devem ser transformados em variáveis. Deixe-os fixados como textos estáticos no ZPL!
3. Correção de Código de Barras: Se o ZPL utilizar comandos de código de barras (^BC ou ^B3) com desvios complexos (ex: >;8493>6B2E4C7DB ou >;ZTEGP7>5300225), simplifique-os substituindo por codificação do subconjunto B do Code 128 que inicia com >: (ex: >:\${sn} ou >:\${mac_clean}). Isso garante leitura universal sem cortes de dígitos.
4. Monte a configuração de campos (campos_config) que descreve cada variável que você introduziu.
   - Cada campo deve ter um "label" amigável (ex: "S/N:", "MAC ETHERNET:", "SSID Wi-Fi:").
   - Defina comprimentos mínimos (minLength) e máximos (maxLength) sugeridos com base nos valores típicos (ex: MAC tem minLength 12 e maxLength 17; S/N de ONT geralmente tem minLength 12 e maxLength 20).
   - A ordem dos campos na lista 'campos' DEVE corresponder EXATAMENTE à ordem física vertical em que eles aparecem na etiqueta ZPL, de cima para baixo (ex: S/N primeiro, depois CAID, depois MAC).
   - IMPORTANTE: NÃO inclua na lista de campos nenhuma variável terminada em "_clean" (como "sn_clean", "mac_clean"). Essas variáveis derivadas limpas não devem ter campos JSON correspondentes, pois o frontend as calcula automaticamente no momento da impressão a partir de sua variável base.
5. Dados Gráficos e Imagens: Mantenha todos os blocos de dados gráficos e comandos de imagem (como ^GF, ^GFA e dados de compressão Z64 ou hexadecimais) 100% idênticos, completos e intactos. NÃO encurte nem modifique nenhuma letra ou número desse bloco.
6. Acentuação e Codificação de Caracteres Especiais: Para garantir que as letras com acentos (como ã, ç, é, á, ê, ú, à, í, õ, etc.) sejam impressas corretamente pela impressora física Zebra (sem gerar lacunas ou caracteres corrompidos), converta-os obrigatoriamente para códigos hexadecimais do padrão CP-1252/Latin-1 (ex: 'ã' ➔ '\\E3', 'ç' ➔ '\\E7', 'é' ➔ '\\E9', 'á' ➔ '\\E1', 'ê' ➔ '\\EA', 'ú' ➔ '\\FA', 'à' ➔ '\\E0', 'í' ➔ '\\ED', 'õ' ➔ '\\F5'). Certifique-se de ativar o comando '^FH\\' e '^CI27' correspondente para que a impressora interprete os escapes hexadecimais de forma adequada.
7. Correção de Ortografia/Typas no ZPL original: Corrija os erros ortográficos comuns que vêm de digitação no ZPL original para manter o padrão profissional da etiqueta original. Exemplos comuns:
   - 'aluguei' ➔ deve ser corrigido para 'aluguel'.
   - 'devoivido' ➔ deve ser corrigido para 'devolvido'.
   - 'Doiby' ➔ deve ser corrigido para 'Dolby'.
   - Separação de palavras incorretas (ex: 'Audioe o' ➔ deve ser corrigido para 'Audio e o').
8. Largura e Qualidade dos Códigos de Barras: Se o ZPL utilizar um comando '^BY1' (largura do código de barras de 1 ponto), isso o tornará ilegível para bipe de scanners industriais. Corrija-o para usar '^BY2' ou '^BY3' conforme o tamanho do campo, a fim de deixá-lo legível, proporcional e correspondente ao design da etiqueta física original.

ZPL Bruto:
${rawZpl}`;

    let response: any;
    // Tentar rodar apenas com modelos Flash da série 3 (gemini-3.6-flash, gemini-3.5-flash) - sem fallback para Pro
    for (const modelName of ['gemini-3.6-flash', 'gemini-3.5-flash']) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de 25s no modelo ${modelName}`)), 25000)
        );
        response = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  codigo_zpl: { type: Type.STRING },
                  campos: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        key: { type: Type.STRING, description: "Nome curto da variável usada no ZPL (sem chaves e sem cifrão). Ex: 'sn', 'mac', 'caid'" },
                        label: { type: Type.STRING, description: "Label legível de exibição. Ex: 'S/N:', 'MAC:', 'CAID:'" },
                        minLength: { type: Type.INTEGER, description: "Comprimento mínimo do campo" },
                        maxLength: { type: Type.INTEGER, description: "Comprimento máximo do campo" }
                      },
                      required: ['key', 'label', 'minLength', 'maxLength']
                    }
                  }
                },
                required: ['codigo_zpl', 'campos']
              }
            }
          }),
          timeoutPromise
        ]);
        if (response && response.text) break;
      } catch (err: any) {
        console.error(`Erro ao rodar Smart Import com ${modelName}:`, err.message);
      }
    }

    if (!response || !response.text) {
      throw new Error('Não foi possível obter resposta do Gemini Vision API.');
    }

    const data = JSON.parse(response.text);
    
    // Converter de array estruturado para dicionário chave-valor esperado pelo frontend
    const campos_config: any = {};
    if (Array.isArray(data.campos)) {
      for (const item of data.campos) {
        if (item.key) {
          campos_config[item.key] = {
            label: item.label,
            minLength: item.minLength,
            maxLength: item.maxLength
          };
        }
      }
    }

    return res.json({ 
      success: true, 
      codigo_zpl: data.codigo_zpl, 
      campos_config 
    });
  } catch (error: any) {
    console.error('Erro na rota de Smart Import:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar importação inteligente.' });
  }
});

// Endpoint to receive a print job from the frontend
app.post('/api/print-jobs', (req, res) => {
  const { zpl, targetStation } = req.body;
  if (!zpl || !targetStation) {
    return res.status(400).json({ error: 'Missing zpl or targetStation' });
  }
  const id = Math.random().toString(36).substring(2, 15);
  printJobs.push({ id, zpl, targetStation, timestamp: Date.now() });
  // Keep only the last 100 jobs to avoid memory leaks
  if (printJobs.length > 100) printJobs.shift();
  res.json({ success: true, id });
});

// Endpoint for the local proxy to poll its jobs
app.get('/api/print-jobs', (req, res) => {
  const station = req.query.station as string;
  if (!station) return res.status(400).json({ error: 'Missing station parameter' });
  
  // Return only jobs targeted to this station
  const stationJobs = printJobs.filter(j => j.targetStation === station);
  res.json({ jobs: stationJobs });
});

// Endpoint for the local proxy to mark a job as done
app.delete('/api/print-jobs/:id', (req, res) => {
  const index = printJobs.findIndex(j => j.id === req.params.id);
  if (index !== -1) {
    printJobs.splice(index, 1);
  }
  res.json({ success: true });
});

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
      password_router VARCHAR(100),
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
      operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ',
      permitir_gpon BOOLEAN DEFAULT TRUE,
      permitir_reimpressao BOOLEAN DEFAULT TRUE,
      tecnologias_permitidas VARCHAR(200) DEFAULT 'IPTV,GPON,EMTA,STB'
    );
  `;
  await pool.query(createUsersTableQuery);

  // Migrate existing admins to master
  try {
    await pool.query("UPDATE usuarios_scan_onu SET role = 'master' WHERE role = 'admin'");
  } catch(err) { console.error('Erro ao migrar admins:', err); }


  // Garantir coluna operacao se não existir e colunas de permissão
  try {
    const checkCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='usuarios_scan_onu'");
    const cols = checkCols.rows.map(r => r.column_name);
    if (!cols.includes('operacao')) await pool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
    if (!cols.includes('permitir_gpon')) await pool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN permitir_gpon BOOLEAN DEFAULT TRUE");
    if (!cols.includes('permitir_reimpressao')) await pool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN permitir_reimpressao BOOLEAN DEFAULT TRUE");
    if (!cols.includes('tecnologias_permitidas')) await pool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN tecnologias_permitidas VARCHAR(200) DEFAULT 'IPTV,GPON,EMTA,STB'");
  } catch (e) {
    console.error('Erro ao adicionar colunas em usuarios_scan_onu:', e);
  }

  // Criar tabela de sessões
  const createSessionsTableQuery = `
    CREATE TABLE IF NOT EXISTS sessoes_scan_onu (
      token VARCHAR(100) PRIMARY KEY,
      email VARCHAR(150) NOT NULL,
      role VARCHAR(50) NOT NULL,
      operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ',
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data_expiracao TIMESTAMP NOT NULL
    );
  `;
  await pool.query(createSessionsTableQuery);

  // Garantir operacao nas sessoes e etiquetas
  try {
    const checkSess = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='sessoes_scan_onu'");
    if (!checkSess.rows.some(r => r.column_name === 'operacao')) {
      await pool.query("ALTER TABLE sessoes_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
    }
    const checkEtiq = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu'");
    const etiqCols = checkEtiq.rows.map((r: any) => r.column_name.toLowerCase());
    if (!etiqCols.includes('operacao')) {
      await pool.query("ALTER TABLE etiquetas_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
    }
    try {
      await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS password_router VARCHAR(100) DEFAULT \'N/A\'');
      try {
        await pool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN IF EXISTS "PASSWORD_ROUTER"');
      } catch (dropErr) {}
      try {
        await pool.query("UPDATE etiquetas_scan_onu SET password_router = 'N/A' WHERE password_router = web_key");
      } catch (cleanErr) {}
    } catch (e) {
      console.error('Erro ao adicionar/limpar coluna password_router em etiquetas_scan_onu:', e);
    }
  } catch (e) {
    console.error('Erro ao adicionar operacao nas tabelas:', e);
  }

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

  // Criar tabela de modelos IPTV
  const createIptvModelsTableQuery = `
    CREATE TABLE IF NOT EXISTS modelos_zpl_iptv (
      id SERIAL PRIMARY KEY,
      nome_modelo VARCHAR(150) NOT NULL,
      codigo_zpl TEXT NOT NULL,
      campos_config JSONB NOT NULL,
      tecnologia VARCHAR(50) NOT NULL DEFAULT 'IPTV',
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(createIptvModelsTableQuery);

  // Migração para adicionar a coluna tecnologia na tabela modelos_zpl_iptv se não existir
  try {
    const checkColumn = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='modelos_zpl_iptv' AND column_name='tecnologia'"
    );
    if (checkColumn.rowCount === 0) {
      await pool.query("ALTER TABLE modelos_zpl_iptv ADD COLUMN tecnologia VARCHAR(50) NOT NULL DEFAULT 'IPTV'");
      console.log("Coluna 'tecnologia' adicionada com sucesso à tabela modelos_zpl_iptv.");
    }
  } catch (err: any) {
    console.error("Erro ao rodar migração de tecnologia em modelos_zpl_iptv:", err.message);
  }


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

  // Migração para mover data_leitura para a última posição
  try {
    const lastCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' ORDER BY ordinal_position DESC LIMIT 1");
    if (lastCol.rowCount && lastCol.rowCount > 0 && lastCol.rows[0].column_name !== 'data_leitura') {
      console.log('Movendo a coluna data_leitura para a ultima posicao no banco', dbName);
      await pool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN data_leitura TO data_leitura_old');
      await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      await pool.query('UPDATE etiquetas_scan_onu SET data_leitura = data_leitura_old');
      await pool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN data_leitura_old');
    }
  } catch (e) {
    console.error('Erro ao mover a coluna data_leitura:', e);
  }

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
      "INSERT INTO usuarios_scan_onu (email, senha, role) VALUES ('admin@scanonu.com', 'admin123', 'master')"
    );
  }

  // Migração para limpar chaves que terminam com _clean na tabela modelos_zpl_iptv
  try {
    const res = await pool.query('SELECT id, campos_config FROM modelos_zpl_iptv');
    for (const row of res.rows) {
      const config = row.campos_config;
      let changed = false;
      if (config && typeof config === 'object') {
        for (const key of Object.keys(config)) {
          if (key.endsWith('_clean')) {
            delete config[key];
            changed = true;
          }
        }
      }
      if (changed) {
        await pool.query('UPDATE modelos_zpl_iptv SET campos_config = $1 WHERE id = $2', [JSON.stringify(config), row.id]);
      }
    }
  } catch (e) {
    console.error('Erro na migração de limpeza dos campos _clean:', e);
  }

  // Migração: Mover GP0/GPO de gpon_sn para cpe_sn e setar gpon_sn como N/A_MAC no modelo PG2447
  try {
    const migrateGpoRes = await pool.query(
      "UPDATE etiquetas_scan_onu SET cpe_sn = gpon_sn, gpon_sn = 'N/A_' || UPPER(REPLACE(COALESCE(mac, 'N/A'), ':', '')) || '_' || substring(md5(random()::text) from 1 for 6) WHERE modelo = 'PG2447' AND (gpon_sn LIKE 'GPO%' OR gpon_sn LIKE 'gpo%' OR gpon_sn LIKE 'GP0%' OR gpon_sn LIKE 'gp0%')"
    );
    if (migrateGpoRes.rowCount !== null && migrateGpoRes.rowCount > 0) {
      console.log(`[${dbName}] Migração GP0/GPO concluída: ${migrateGpoRes.rowCount} registros atualizados.`);
    }
  } catch (e: any) {
    console.error(`[${dbName}] Erro ao migrar registros GP0/GPO para cpe_sn:`, e.message || e);
  }

  
  // Nova Migração: Corrigir gpon_sn com base na planilha de mapeamento MAC -> KAON
  try {
    const mapping = [
  [
    "KAON09024145",
    "24E4CE48B642"
  ],
  [
    "KAON09022533",
    "24E4CE47D5B2"
  ],
  [
    "KAON0900A8F6",
    "1834AF593722"
  ],
  [
    "KAON0900B803",
    "1834AF59AF8A"
  ],
  [
    "KAON0901F49B",
    "24E4CE2F8B42"
  ],
  [
    "KAON09008363",
    "1834AF580A8A"
  ],
  [
    "KAON09024846",
    "24E4CE897BD8"
  ],
  [
    "KAON09012D05",
    "1834AF5D579A"
  ],
  [
    "KAON09013404",
    "1834AF5D8F92"
  ],
  [
    "KAON09024FEB",
    "24E4CE89B900"
  ],
  [
    "KAON09012ACA",
    "1834AF5D45C2"
  ],
  [
    "KAON09000F01",
    "1834AF527212"
  ],
  [
    "KAON090088DB",
    "1834AF58364A"
  ],
  [
    "KAON09006C7F",
    "1834AF57536A"
  ],
  [
    "KAON09011404",
    "1834AF5C8F92"
  ],
  [
    "KAON09006FCB",
    "1834AF576DCA"
  ],
  [
    "KAON0901BFDF",
    "24E4CE2DE562"
  ],
  [
    "KAON09024EBB",
    "24E4CE89AF80"
  ],
  [
    "KAON0900D522",
    "1834AF5A9882"
  ],
  [
    "KAON0902A56B",
    "24E4CEEB0205"
  ],
  [
    "KAON0902414C",
    "24E4CE48B67A"
  ],
  [
    "KAON0900B244",
    "1834AF598192"
  ],
  [
    "KAON0901E525",
    "24E4CE2F0F92"
  ],
  [
    "KAON09016CF6",
    "1834AF5F5722"
  ],
  [
    "KAON0900C4EC",
    "1834AF5A16D2"
  ],
  [
    "KAON09024237",
    "24E4CE48BDD2"
  ],
  [
    "KAON090051FF",
    "1834AF567F6A"
  ],
  [
    "KAON09025007",
    "24E4CE89B9E0"
  ],
  [
    "KAON0900473B",
    "1834AF56294A"
  ],
  [
    "KAON0901528B",
    "1834AF5E83CA"
  ],
  [
    "KAON09003AAF",
    "1834AF53CF82"
  ],
  [
    "KAON09002876",
    "1834AF533DBA"
  ],
  [
    "KAON09020372",
    "24E4CE46C7AA"
  ],
  [
    "KAON09024741",
    "24E4CE8973B0"
  ],
  [
    "KAON090125F0",
    "1834AF5D1EF2"
  ],
  [
    "KAON090206D2",
    "24E4CE46E2AA"
  ],
  [
    "KAON090059C2",
    "1834AF56BD82"
  ],
  [
    "KAON0901EA92",
    "24E4CE2F3AFA"
  ],
  [
    "KAON0900DA76",
    "1834AF5AC322"
  ],
  [
    "KAON0900AFEE",
    "1834AF596EE2"
  ],
  [
    "KAON090269D0",
    "24E4CE8A8828"
  ],
  [
    "KAON09027068",
    "24E4CE8ABCE8"
  ],
  [
    "KAON0901541E",
    "1834AF5E9062"
  ],
  [
    "KAON09004D8B",
    "1834AF565BCA"
  ],
  [
    "KAON09017925",
    "1834AF5FB89A"
  ],
  [
    "KAON0900C265",
    "1834AF5A029A"
  ],
  [
    "KAON09010C6C",
    "1834AF5C52D2"
  ],
  [
    "KAON0900C5AC",
    "1834AF5A1CD2"
  ],
  [
    "KAON0900696F",
    "1834AF573AEA"
  ],
  [
    "KAON09028895",
    "24E4CE8B7E50"
  ],
  [
    "KAON090199A5",
    "1834AFB37879"
  ],
  [
    "KAON09011A78",
    "1834AF5CC332"
  ],
  [
    "KAON09003AAB",
    "1834AF53CF62"
  ],
  [
    "KAON0900DB4B",
    "1834AF5AC9CA"
  ],
  [
    "KAON09014766",
    "1834AF5E2AA2"
  ],
  [
    "KAON0900F41E",
    "1834AF5B9062"
  ],
  [
    "KAON09013E53",
    "1834AF5DE20A"
  ],
  [
    "KAON09021DB7",
    "24E4CE4799D2"
  ],
  [
    "KAON0900B497",
    "1834AF59942A"
  ],
  [
    "KAON090209F2",
    "24E4CE46FBAA"
  ],
  [
    "KAON09003EDB",
    "1834AF53F0E2"
  ],
  [
    "KAON0900AE9A",
    "1834AF596442"
  ],
  [
    "KAON09017923",
    "1834AF5FB88A"
  ],
  [
    "KAON09021F04",
    "24E4CE47A43A"
  ],
  [
    "KAON0901C48D",
    "24E4CE2E0AD2"
  ],
  [
    "KAON0900932A",
    "1834AF5888C2"
  ],
  [
    "KAON090202B6",
    "24E4CE46C1CA"
  ],
  [
    "KAON09013354",
    "1834AF5D8A12"
  ],
  [
    "KAON09006BB3",
    "1834AF574D0A"
  ],
  [
    "KAON09007702",
    "1834AF57A782"
  ],
  [
    "KAON0902721C",
    "24E4CE8ACA88"
  ],
  [
    "KAON0900C05A",
    "1834AF59F242"
  ],
  [
    "KAON0902041F",
    "24E4CE46CD12"
  ],
  [
    "KAON09004139",
    "1834AF5403D2"
  ],
  [
    "KAON09026446",
    "24E4CE8A5BD8"
  ],
  [
    "KAON0900387A",
    "1834AF53BDDA"
  ],
  [
    "KAON090154D6",
    "1834AF5E9622"
  ],
  [
    "KAON0901FE5C",
    "24E4CE469EFA"
  ],
  [
    "KAON09005E6E",
    "1834AF56E2E2"
  ],
  [
    "KAON0901ABCD",
    "24E4CE2D08E6"
  ],
  [
    "KAON090157DD",
    "1834AF5EAE5A"
  ],
  [
    "KAON0902790A",
    "24E4CE8B01F8"
  ],
  [
    "KAON09005D9D",
    "1834AF56DC5A"
  ],
  [
    "KAON09011735",
    "1834AF5CA91A"
  ],
  [
    "KAON09010880",
    "1834AF5C3372"
  ],
  [
    "KAON09013ECC",
    "1834AF5DE5D2"
  ],
  [
    "KAON09008C09",
    "1834AF584FBA"
  ],
  [
    "KAON09011212",
    "1834AF5C8002"
  ],
  [
    "KAON090294B5",
    "24E4CEEA7C55"
  ],
  [
    "KAON09002F1F",
    "1834AF537302"
  ],
  [
    "KAON09028D07",
    "24E4CEEA3EE5"
  ],
  [
    "KAON0900D70E",
    "1834AF5AA7E2"
  ],
  [
    "KAON09022EAA",
    "24E4CE48216A"
  ],
  [
    "KAON09010118",
    "1834AF5BF832"
  ],
  [
    "KAON09023EB4",
    "24E4CE48A1BA"
  ],
  [
    "KAON090276B6",
    "24E4CE8AEF58"
  ],
  [
    "KAON09015139",
    "1834AF5E793A"
  ],
  [
    "KAON0901A408",
    "1834AFB3CB91"
  ],
  [
    "KAON09027E0C",
    "24E4CE8B2A08"
  ],
  [
    "KAON09010762",
    "1834AF5C2A82"
  ],
  [
    "KAON09026D9F",
    "24E4CE8AA6A0"
  ],
  [
    "KAON09027451",
    "24E4CE8ADC30"
  ],
  [
    "KAON0902768A",
    "24E4CE8AEDF8"
  ],
  [
    "KAON090225A0",
    "24E4CE47D91A"
  ],
  [
    "KAON0901D304",
    "24E4CE2E7E8A"
  ],
  [
    "KAON090277BB",
    "24E4CE8AF780"
  ],
  [
    "KAON09029D5A",
    "24E4CEEAC17D"
  ],
  [
    "KAON09004287",
    "1834AF540E42"
  ],
  [
    "KAON0901849E",
    "1834AFB2D041"
  ],
  [
    "KAON090237DA",
    "24E4CE486AEA"
  ],
  [
    "KAON0900572C",
    "1834AF56A8D2"
  ],
  [
    "KAON0901EF3C",
    "24E4CE2F604A"
  ],
  [
    "KAON09014CD5",
    "1834AF5E561A"
  ],
  [
    "KAON0900F421",
    "1834AF5B907A"
  ],
  [
    "KAON09005DBB",
    "1834AF56DD4A"
  ],
  [
    "KAON09014432",
    "1834AF5E1102"
  ],
  [
    "KAON09027C7E",
    "1834AF5630E2"
  ],
  [
    "KAON09027837",
    "24E4CE8AFB60"
  ],
  [
    "KAON0900B586",
    "1834AF599BA2"
  ],
  [
    "KAON09013DC6",
    "1834AF5DDDA2"
  ],
  [
    "KAON09003F46",
    "1834AF53F43A"
  ],
  [
    "KAON0900EEF1",
    "1834AF5B66FA"
  ],
  [
    "KAON0900A36E",
    "1834AF590AE2"
  ],
  [
    "KAON0901EC84",
    "24E4CE2F4A8A"
  ],
  [
    "KAON09016ED6",
    "1834AF5F6622"
  ],
  [
    "KAON0901C80B",
    "24E4CE2E26C2"
  ],
  [
    "KAON0900879D",
    "1834AF582C5A"
  ],
  [
    "KAON0901A1A6",
    "1834AFB3B881"
  ],
  [
    "KAON0901E668",
    "24E4CE2F19AA"
  ],
  [
    "KAON09014F7C",
    "1834AF5E6B52"
  ],
  [
    "KAON090093E5",
    "1834AF588E9A"
  ],
  [
    "KAON090125CB",
    "1834AF5D1DCA"
  ],
  [
    "KAON0901A39D",
    "1834AFB3C839"
  ],
  [
    "KAON09016760",
    "1834AF5F2A72"
  ],
  [
    "KAON09023728",
    "24E4CE48655A"
  ],
  [
    "KAON0900575D",
    "1834AF56AA5A"
  ],
  [
    "KAON09017C34",
    "1834AF5FD112"
  ],
  [
    "KAON0900D446",
    "1834AF5A91A2"
  ],
  [
    "KAON09009492",
    "1834AF589402"
  ],
  [
    "KAON090270A7",
    "24E4CE8ABEE0"
  ],
  [
    "KAON09003C80",
    "1834AF53DE0A"
  ],
  [
    "KAON09014A44",
    "1834AF5E4192"
  ],
  [
    "KAON0901C4D5",
    "24E4CE2E0D12"
  ],
  [
    "KAON0900AE04",
    "1834AF595F92"
  ],
  [
    "KAON0900101F",
    "1834AF527B02"
  ],
  [
    "KAON09004DB1",
    "1834AF565CFA"
  ],
  [
    "KAON0902A444",
    "24E4CEEAF8CD"
  ],
  [
    "KAON09017796",
    "1834AF5FAC22"
  ],
  [
    "KAON090101B8",
    "1834AF5BFD32"
  ],
  [
    "KAON09012C99",
    "1834AF5D543A"
  ],
  [
    "KAON0900F996",
    "1834AF5BBC22"
  ],
  [
    "KAON09012CA7",
    "1834AF5D54AA"
  ],
  [
    "KAON09000B19",
    "1834AF5252D2"
  ],
  [
    "KAON09026660",
    "24E4CE8A6CA8"
  ],
  [
    "KAON09023AFC",
    "24E4CE4883FA"
  ],
  [
    "KAON0900FA68",
    "1834AF5BC2B2"
  ],
  [
    "KAON0900FAAC",
    "1834AF5BC4D2"
  ],
  [
    "KAON0900DE82",
    "1834AF5AE382"
  ],
  [
    "KAON090050FA",
    "1834AF567742"
  ],
  [
    "KAON0900DD89",
    "1834AF5ADBBA"
  ],
  [
    "KAON0900FC51",
    "1834AF5BD1FA"
  ],
  [
    "KAON0901E5DE",
    "24E4CE2F155A"
  ],
  [
    "KAON09026772",
    "24E4CE8A7538"
  ],
  [
    "KAON09002604",
    "1834AF532A2A"
  ],
  [
    "KAON09021C26",
    "24E4CE478D4A"
  ],
  [
    "KAON090207F8",
    "24E4CE46EBDA"
  ],
  [
    "KAON09011888",
    "1834AF5CB3B2"
  ],
  [
    "KAON0900D9CE",
    "1834AF5ABDE2"
  ],
  [
    "KAON0900C951",
    "1834AF5A39FA"
  ],
  [
    "KAON09018194",
    "1834AFB2B7F1"
  ],
  [
    "KAON09028D85",
    "24E4CEEA42D5"
  ],
  [
    "KAON09019C09",
    "1834AFB38B99"
  ],
  [
    "KAON0900CC62",
    "1834AF5A5282"
  ],
  [
    "KAON090079C7",
    "1834AF57BDAA"
  ],
  [
    "KAON09011D85",
    "1834AF5CDB9A"
  ],
  [
    "KAON09002718",
    "1834AF5332CA"
  ],
  [
    "KAON09004D50",
    "1834AF5659F2"
  ],
  [
    "KAON0901C789",
    "24E4CE2E22B2"
  ],
  [
    "KAON090051BF",
    "1834AF567D6A"
  ],
  [
    "KAON09028808",
    "24E4CE8B79E8"
  ],
  [
    "KAON090224CB",
    "24E4CE47D272"
  ],
  [
    "KAON09018D21",
    "1834AFB31459"
  ],
  [
    "KAON0902178C",
    "24E4CE47687A"
  ],
  [
    "KAON09025659",
    "24E4CE89EC70"
  ],
  [
    "KAON09003AF2",
    "1834AF53D19A"
  ],
  [
    "KAON0901F1A6",
    "24E4CE2F739A"
  ],
  [
    "KAON09021773",
    "24E4CE4767B2"
  ],
  [
    "KAON09004FBE",
    "1834AF566D62"
  ],
  [
    "KAON09029BF8",
    "24E4CEEAB66D"
  ],
  [
    "KAON090153AE",
    "1834AF5E8CE2"
  ],
  [
    "KAON09000840",
    "1834AF54300A"
  ],
  [
    "KAON0902852A",
    "24E4CE8B62F8"
  ],
  [
    "KAON090272E9",
    "24E4CE8AD0F0"
  ],
  [
    "KAON09001FB2",
    "1834AF52F79A"
  ],
  [
    "KAON09028282",
    "24E4CE8B4DB8"
  ],
  [
    "KAON09016489",
    "1834AF5F13BA"
  ],
  [
    "KAON09002174",
    "1834AF5305AA"
  ],
  [
    "KAON09011028",
    "1834AF5C70B2"
  ],
  [
    "KAON09024563",
    "24E4CE8964C0"
  ],
  [
    "KAON09008609",
    "1834AF58263A"
  ],
  [
    "KAON09015396",
    "1834AF5E8C22"
  ],
  [
    "KAON0901910D",
    "1834AFB333B9"
  ],
  [
    "KAON09017BF7",
    "1834AF5FCF2A"
  ],
  [
    "KAON09022EED",
    "24E4CE482382"
  ],
  [
    "KAON09024198",
    "24E4CE48B8DA"
  ],
  [
    "KAON0901F29C",
    "24E4CE2F7B4A"
  ],
  [
    "KAON09010DBD",
    "1834AF5C5D5A"
  ],
  [
    "KAON090016D7",
    "1834AF52B0C2"
  ],
  [
    "KAON090289E8",
    "24E4CE8B88E8"
  ],
  [
    "KAON090121A1",
    "1834AF5CFC7A"
  ],
  [
    "KAON09007D14",
    "1834AF57D812"
  ],
  [
    "KAON09010524",
    "1834AF5C1892"
  ],
  [
    "KAON090129D9",
    "1834AF5D3E3A"
  ],
  [
    "KAON09023905",
    "24E4CE487442"
  ],
  [
    "KAON09026945",
    "24E4CE8A83D0"
  ],
  [
    "KAON09003DF7",
    "1834AF53E9C2"
  ],
  [
    "KAON090175EA",
    "1834AF5F9EC2"
  ],
  [
    "KAON0901D3C1",
    "24E4CE2E8472"
  ],
  [
    "KAON09024960",
    "24E4CE8984A8"
  ],
  [
    "KAON09027399",
    "24E4CE8AD670"
  ],
  [
    "KAON0902388F",
    "24E4CE487092"
  ],
  [
    "KAON09007F55",
    "1834AF57EA1A"
  ],
  [
    "KAON0900CEE2",
    "1834AF5A6682"
  ],
  [
    "KAON09003952",
    "1834AF53C49A"
  ],
  [
    "KAON09003E33",
    "1834AF53EBA2"
  ],
  [
    "KAON09010E04",
    "1834AF5C5F92"
  ],
  [
    "KAON09008B1F",
    "1834AF58486A"
  ],
  [
    "KAON0902A6EE",
    "24E4CEEB0E1D"
  ],
  [
    "KAON09025E4C",
    "24E4CE8A2C08"
  ],
  [
    "KAON090127CF",
    "1834AF5D2DEA"
  ],
  [
    "KAON09003B20",
    "1834AF53D30A"
  ],
  [
    "KAON090271B5",
    "24E4CE8AC750"
  ],
  [
    "KAON090026EA",
    "1834AF53315A"
  ],
  [
    "KAON09024E04",
    "24E4CE89A9C8"
  ],
  [
    "KAON090177AE",
    "1834AF5FACE2"
  ],
  [
    "KAON09025FF5",
    "24E4CE8A3950"
  ],
  [
    "KAON090112F2",
    "1834AF5C8702"
  ],
  [
    "KAON09003BFC",
    "1834AF53D9EA"
  ],
  [
    "KAON0900AB19",
    "1834AF59483A"
  ],
  [
    "KAON09009054",
    "1834AF587212"
  ],
  [
    "KAON09003E67",
    "1834AF53ED42"
  ],
  [
    "KAON09002080",
    "1834AF52FE0A"
  ],
  [
    "KAON09004A9D",
    "1834AF56445A"
  ],
  [
    "KAON09003DDE",
    "1834AF53E8FA"
  ],
  [
    "KAON09012803",
    "1834AF5D2F8A"
  ],
  [
    "KAON09020197",
    "24E4CE46B8D2"
  ],
  [
    "KAON090241C3",
    "24E4CE48BA32"
  ],
  [
    "KAON09001585",
    "1834AF52A632"
  ],
  [
    "KAON09015BD5",
    "1834AF5ECE1A"
  ],
  [
    "KAON09025E04",
    "24E4CE8A29C8"
  ],
  [
    "KAON0900A547",
    "1834AF5919AA"
  ],
  [
    "KAON0900E69B",
    "1834AF5B244A"
  ],
  [
    "KAON0900B904",
    "1834AF59B792"
  ],
  [
    "KAON090260AB",
    "24E4CE8A3F00"
  ],
  [
    "KAON09012014",
    "1834AF5CF012"
  ],
  [
    "KAON0900C114",
    "1834AF59F812"
  ],
  [
    "KAON09016616",
    "1834AF5F2022"
  ],
  [
    "KAON09017D0B",
    "1834AFB293A9"
  ],
  [
    "KAON09000F70",
    "1834AF52758A"
  ],
  [
    "KAON0900B8AC",
    "1834AF59B4D2"
  ],
  [
    "KAON09018772",
    "1834AFB2E6E1"
  ],
  [
    "KAON0901110F",
    "1834AF5C77EA"
  ],
  [
    "KAON090240B0",
    "24E4CE48B19A"
  ],
  [
    "KAON0900A53F",
    "1834AF59196A"
  ],
  [
    "KAON09015009",
    "1834AF5E6FBA"
  ],
  [
    "KAON0901FF9E",
    "24E4CE46A90A"
  ],
  [
    "KAON090034A8",
    "1834AF539F4A"
  ],
  [
    "KAON09012A56",
    "1834AF5D4222"
  ],
  [
    "KAON09025C78",
    "24E4CE8A1D68"
  ],
  [
    "KAON09018859",
    "1834AFB2EE19"
  ],
  [
    "KAON0901FF2A",
    "24E4CE46A56A"
  ],
  [
    "KAON0902AF5C",
    "24E4CEEB518D"
  ],
  [
    "KAON0900E89D",
    "1834AF5B345A"
  ],
  [
    "KAON09024878",
    "24E4CE897D68"
  ],
  [
    "KAON09018DE5",
    "1834AFB31A79"
  ],
  [
    "KAON09017B6B",
    "1834AF5FCACA"
  ],
  [
    "KAON09027E3F",
    "24E4CE8B2BA0"
  ],
  [
    "KAON09006630",
    "1834AF5720F2"
  ],
  [
    "KAON0901FB0A",
    "24E4CE46846A"
  ],
  [
    "KAON09010427",
    "1834AF5C10AA"
  ],
  [
    "KAON09020B50",
    "24E4CE47069A"
  ],
  [
    "KAON09014911",
    "1834AF5E37FA"
  ],
  [
    "KAON09002BD9",
    "1834AF5358D2"
  ],
  [
    "KAON09001674",
    "1834AF52ADAA"
  ],
  [
    "KAON09006222",
    "1834AF570082"
  ],
  [
    "KAON09009102",
    "1834AF587782"
  ],
  [
    "KAON09012703",
    "1834AF5D278A"
  ],
  [
    "KAON09013F61",
    "1834AF5DEA7A"
  ],
  [
    "KAON09010DC1",
    "1834AF5C5D7A"
  ],
  [
    "KAON0901122C",
    "1834AF5C80D2"
  ],
  [
    "KAON09017941",
    "1834AF5FB97A"
  ],
  [
    "KAON0900D530",
    "1834AF5A98F2"
  ],
  [
    "KAON09000FD1",
    "1834AF527892"
  ],
  [
    "KAON090231BA",
    "24E4CE4839EA"
  ],
  [
    "KAON09001D6A",
    "1834AF52E55A"
  ],
  [
    "KAON09011770",
    "1834AF5CAAF2"
  ],
  [
    "KAON0902846C",
    "24E4CE8B5D08"
  ],
  [
    "KAON09004216",
    "1834AF540ABA"
  ],
  [
    "KAON09011DC6",
    "1834AF5CDDA2"
  ],
  [
    "KAON0902A823",
    "24E4CEEB17C5"
  ],
  [
    "KAON09014F78",
    "1834AF5E6B32"
  ],
  [
    "KAON0900B8D0",
    "1834AF59B5F2"
  ],
  [
    "KAON090068AB",
    "1834AF5734CA"
  ],
  [
    "KAON0901D9BB",
    "24E4CE2EB442"
  ],
  [
    "KAON09007B59",
    "1834AF57CA3A"
  ],
  [
    "KAON09018BFC",
    "1834AFB30B31"
  ],
  [
    "KAON0902432D",
    "24E4CE48C582"
  ],
  [
    "KAON09005362",
    "1834AF568A82"
  ],
  [
    "KAON0902288F",
    "24E4CE47F092"
  ],
  [
    "KAON09003F12",
    "1834AF53F29A"
  ],
  [
    "KAON0901DCB8",
    "24E4CE2ECC2A"
  ],
  [
    "KAON09009CEF",
    "1834AF58D6EA"
  ],
  [
    "KAON0902614C",
    "24E4CE8A4408"
  ],
  [
    "KAON0900AE1C",
    "1834AF596052"
  ],
  [
    "KAON09021C04",
    "24E4CE478C3A"
  ],
  [
    "KAON09006F06",
    "1834AF5767A2"
  ],
  [
    "KAON09020FE6",
    "24E4CE472B4A"
  ],
  [
    "KAON09020199",
    "24E4CE46B8E2"
  ],
  [
    "KAON090022C9",
    "1834AF531052"
  ],
  [
    "KAON0900A91A",
    "1834AF593842"
  ],
  [
    "KAON090216B1",
    "24E4CE4761A2"
  ],
  [
    "KAON09016C54",
    "1834AF5F5212"
  ],
  [
    "KAON09025A88",
    "24E4CE8A0DE8"
  ],
  [
    "KAON0901618E",
    "1834AF5EFBE2"
  ],
  [
    "KAON09020F02",
    "24E4CE47242A"
  ],
  [
    "KAON0901D6AA",
    "24E4CE2E9BBA"
  ],
  [
    "KAON090191BD",
    "1834AFB33939"
  ],
  [
    "KAON0901BDBB",
    "24E4CE2DD442"
  ],
  [
    "KAON0900A7F0",
    "1834AF592EF2"
  ],
  [
    "KAON09003461",
    "1834AF539D12"
  ],
  [
    "KAON090038CD",
    "1834AF53C072"
  ],
  [
    "KAON09012518",
    "1834AF5D1832"
  ],
  [
    "KAON090233A0",
    "24E4CE48491A"
  ],
  [
    "KAON09018BBE",
    "1834AFB30941"
  ],
  [
    "KAON090238FF",
    "24E4CE487412"
  ],
  [
    "KAON0900DAC4",
    "1834AF5AC592"
  ],
  [
    "KAON09015EA7",
    "1834AF5EE4AA"
  ],
  [
    "KAON0900152A",
    "1834AF52A35A"
  ],
  [
    "KAON0901D91E",
    "24E4CE2EAF5A"
  ],
  [
    "KAON0900E143",
    "1834AF5AF98A"
  ],
  [
    "KAON0901F60C",
    "24E4CE465C7A"
  ],
  [
    "KAON09018B95",
    "1834AFB307F9"
  ],
  [
    "KAON09021C7F",
    "24E4CE479012"
  ],
  [
    "KAON0900A6B1",
    "1834AF5924FA"
  ],
  [
    "KAON090285C3",
    "24E4CE8B67C0"
  ],
  [
    "KAON09026F8D",
    "24E4CE8AB610"
  ],
  [
    "KAON090297ED",
    "24E4CEEA9615"
  ],
  [
    "KAON09009DD7",
    "1834AF58DE2A"
  ],
  [
    "KAON09024A14",
    "24E4CE898A48"
  ],
  [
    "KAON09010826",
    "1834AF5C30A2"
  ],
  [
    "KAON0901C34E",
    "24E4CE2E00DA"
  ],
  [
    "KAON090028C5",
    "1834AF534032"
  ],
  [
    "KAON090084BD",
    "1834AF58155A"
  ],
  [
    "KAON0902539F",
    "24E4CE89D6A0"
  ],
  [
    "KAON09027193",
    "24E4CE8AC640"
  ],
  [
    "KAON09009E75",
    "1834AF58E31A"
  ],
  [
    "KAON09005968",
    "1834AF56BAB2"
  ],
  [
    "KAON090087EA",
    "1834AF582EC2"
  ],
  [
    "KAON0900288F",
    "1834AF533E82"
  ],
  [
    "KAON0901AA04",
    "24E4CE2CFA9E"
  ],
  [
    "KAON090218E8",
    "24E4CE47735A"
  ],
  [
    "KAON09022D00",
    "24E4CE48141A"
  ],
  [
    "KAON09017D5E",
    "1834AFB29641"
  ],
  [
    "KAON090186CE",
    "1834AFB2E1C1"
  ],
  [
    "KAON0900986A",
    "1834AF58B2C2"
  ],
  [
    "KAON090269EA",
    "24E4CE8A88F8"
  ],
  [
    "KAON0901B438",
    "24E4CE2D882A"
  ],
  [
    "KAON0901EDBA",
    "24E4CE2F543A"
  ],
  [
    "KAON090086BD",
    "1834AF58255A"
  ],
  [
    "KAON090272D2",
    "24E4CE8AD038"
  ],
  [
    "KAON090127EA",
    "1834AF5D2EC2"
  ],
  [
    "KAON0902332C",
    "24E4CE48457A"
  ],
  [
    "KAON090052F6",
    "1834AF568722"
  ],
  [
    "KAON09009E7D",
    "1834AF58E35A"
  ],
  [
    "KAON0901E434",
    "24EACE2F080A"
  ],
  [
    "KAON09023B0A",
    "24E4CE48846A"
  ],
  [
    "KAON0900F555",
    "1834AF5B9A1A"
  ],
  [
    "KAON0901109C",
    "1834AF5C7452"
  ],
  [
    "KAON0901CB72",
    "24E4CE2E41FA"
  ],
  [
    "KAON0901DBFE",
    "24E4CE2EC65A"
  ],
  [
    "KAON09002AD1",
    "1834AF535092"
  ],
  [
    "KAON09023194",
    "24E4CE4838BA"
  ],
  [
    "KAON0900C846",
    "1834AF5A31A2"
  ],
  [
    "KAON09021A1D",
    "24E4CE477D02"
  ],
  [
    "KAON09026B48",
    "24E4CE8A93E8"
  ],
  [
    "KAON0900BA42",
    "1834AF59C182"
  ],
  [
    "KAON09027DDB",
    "24E4CE8B2880"
  ],
  [
    "KAON0901D2E5",
    "24E4CE2E7D92"
  ],
  [
    "KAON090269F7",
    "24E4CE8A8960"
  ],
  [
    "KAON09004488",
    "1834AF5613B2"
  ],
  [
    "KAON0901AB49",
    "24E4CE2D04C6"
  ],
  [
    "KAON09026E2A",
    "24E4CE8AAAF8"
  ],
  [
    "KAON09028199",
    "24E4CE8B4670"
  ],
  [
    "KAON0901BA3C",
    "24E4CE2DB84A"
  ],
  [
    "KAON09003BF6",
    "1834AF53D9BA"
  ],
  [
    "KAON0902105E",
    "24E4CE472F0A"
  ],
  [
    "KAON090227FD",
    "24E4CE47EC02"
  ],
  [
    "KAON09019915",
    "1834AFB373F9"
  ],
  [
    "KAON090209DA",
    "24E4CE46FAEA"
  ],
  [
    "KAON0902960E",
    "24E4CEEA871D"
  ],
  [
    "KAON090256AF",
    "24E4CE89EF20"
  ],
  [
    "KAON0900F90F",
    "1834AF5BB7EA"
  ],
  [
    "KAON09011D9A",
    "1834AF5CDC42"
  ],
  [
    "KAON0900E906",
    "1834AF5B37A2"
  ],
  [
    "KAON0901F485",
    "24E4CE2F8A92"
  ],
  [
    "KAON090232FB",
    "24E4CE4843F2"
  ],
  [
    "KAON09011E1E",
    "1834AF5CE062"
  ],
  [
    "KAON09024355",
    "24E4CE48C6C2"
  ],
  [
    "KAON09024A8A",
    "24E4CE898DF8"
  ],
  [
    "KAON0900EC0B",
    "1834AF5B4FCA"
  ],
  [
    "KAON090266C9",
    "24E4CE8A6FF0"
  ],
  [
    "KAON09015278",
    "1834AF5E8332"
  ],
  [
    "KAON0901BBE3",
    "24E4CE2DC582"
  ],
  [
    "KAON0902823B",
    "24E4CE8B4B80"
  ],
  [
    "KAON0901C37F",
    "24E4CE2E0262"
  ],
  [
    "KAON090281B7",
    "24E4CE8B4760"
  ],
  [
    "KAON09021418",
    "24E4CE474CDA"
  ],
  [
    "KAON09000DD3",
    "1834AF5268A2"
  ],
  [
    "KAON09002497",
    "1834AF531EC2"
  ],
  [
    "KAON090059FF",
    "1834AF56BF6A"
  ],
  [
    "KAON09029639",
    "24E4CEEA8875"
  ],
  [
    "KAON09009570",
    "1834AF589AF2"
  ],
  [
    "KAON090108FD",
    "1834AF5C375A"
  ],
  [
    "KAON09024533",
    "24E4CE896340"
  ],
  [
    "KAON09022347",
    "24E4CE47C652"
  ],
  [
    "KAON0902700B",
    "24E4CE8ABA00"
  ],
  [
    "KAON09024F15",
    "24E4CE89B250"
  ],
  [
    "KAON09022175",
    "24E4CE47B7C2"
  ],
  [
    "KAON09017F2D",
    "1834AFB2A4B9"
  ],
  [
    "KAON09018004",
    "1834AFB2AB71"
  ],
  [
    "KAON0902272A",
    "24E4CE47E56A"
  ],
  [
    "KAON09013568",
    "1834AF5D9AB2"
  ],
  [
    "KAON09001505",
    "1834AF52A232"
  ],
  [
    "KAON0901E7AE",
    "24E4CE2F23DA"
  ],
  [
    "KAON090088E9",
    "1834AF5836BA"
  ],
  [
    "KAON0901B833",
    "24E4CE2DA802"
  ],
  [
    "KAON09018236",
    "1834AFB2BD01"
  ],
  [
    "KAON09025001",
    "24E4CE89B9B0"
  ],
  [
    "KAON09027629",
    "24E4CE8AEAF0"
  ],
  [
    "KAON09008BD4",
    "1834AF584E12"
  ],
  [
    "KAON09020C7C",
    "24E4CE470FFA"
  ],
  [
    "KAON090093B9",
    "1834AF588D3A"
  ],
  [
    "KAON0901AA38",
    "24E4CE2CFC3E"
  ],
  [
    "KAON0900918C",
    "1834AF587BD2"
  ],
  [
    "KAON0900B405",
    "1834AF598F9A"
  ],
  [
    "KAON09006019",
    "1834AF56F03A"
  ],
  [
    "KAON0900482E",
    "1834AF5630E2"
  ],
  [
    "KAON09028776",
    "24E4CE8B7558"
  ],
  [
    "KAON0902A881",
    "24E4CEEB1AB5"
  ],
  [
    "KAON09027424",
    "24E4CE8ADAC8"
  ],
  [
    "KAON09006979",
    "1834AF573B3A"
  ],
  [
    "KAON090236B5",
    "24E4CE4861C2"
  ],
  [
    "KAON090130B2",
    "1834AF5D7502"
  ],
  [
    "KAON090150C0",
    "1834AF5E7572"
  ],
  [
    "KAON09024A1C",
    "24E4CE898A88"
  ],
  [
    "KAON0901520D",
    "1834AF5E7FDA"
  ],
  [
    "KAON0902B192",
    "24E4CEEB633D"
  ],
  [
    "KAON09008396",
    "1834AF580C22"
  ],
  [
    "KAON09029E7B",
    "24E4CEEACA85"
  ],
  [
    "KAON0900823F",
    "1834AF58016A"
  ],
  [
    "KAON0902AF3F",
    "24E4CEEB50A5"
  ],
  [
    "KAON0901058A",
    "1834AF5C1BC2"
  ],
  [
    "KAON0901E46D",
    "24E4CE2F09D2"
  ],
  [
    "KAON0901D61E",
    "24E4CE2E975A"
  ],
  [
    "KAON0902AB66",
    "24E4CEEB31DD"
  ],
  [
    "KAON09020E7A",
    "24E4CE471FEA"
  ],
  [
    "KAON09029C5E",
    "24E4CEEAB99D"
  ],
  [
    "KAON09006061",
    "1834AF56F27A"
  ],
  [
    "KAON0900C4C0",
    "1834AF5A1572"
  ],
  [
    "KAON0901FA4F",
    "24E4CE467E92"
  ],
  [
    "KAON0900D8CF",
    "1834AF5AB5EA"
  ],
  [
    "KAON0900DC43",
    "1834AF5AD18A"
  ],
  [
    "KAON0901E662",
    "24E4CE2F197A"
  ],
  [
    "KAON090177CA",
    "1834AF5FADC2"
  ],
  [
    "KAON090252F2",
    "24E4CE89D138"
  ],
  [
    "KAON090012D3",
    "1834AF5290A2"
  ],
  [
    "KAON090288A4",
    "24E4CE8B7EC8"
  ],
  [
    "KAON0902828C",
    "24E4CE8B4E08"
  ],
  [
    "KAON090024CE",
    "1834AF53207A"
  ],
  [
    "KAON0902972D",
    "24E4CEEA9015"
  ],
  [
    "KAON090264D9",
    "24E4CE8A6070"
  ],
  [
    "KAON09025E91",
    "24E4CE8A2E30"
  ],
  [
    "KAON09028606",
    "24E4CE8B69D8"
  ],
  [
    "KAON0901EAA3",
    "24E4CE2F3B82"
  ],
  [
    "KAON0902B265",
    "24E4CEEB69D5"
  ],
  [
    "KAON09024C20",
    "24E4CE899AA8"
  ],
  [
    "KAON09022B26",
    "24E4CE48054A"
  ],
  [
    "KAON0900EE39",
    "1834AF5B613A"
  ],
  [
    "KAON09027CB9",
    "24E4CE8B1F70"
  ],
  [
    "KAON0901B533",
    "24E4CE2D9002"
  ],
  [
    "KAON0902B1BB",
    "24E4CEEB6485"
  ],
  [
    "KAON0901F279",
    "24E4CE2F7A32"
  ],
  [
    "KAON090257C5",
    "24E4CE89F7D0"
  ],
  [
    "KAON09029B7B",
    "24E4CEEAB285"
  ],
  [
    "KAON0900EDD2",
    "1834AF5B5E02"
  ],
  [
    "KAON0901FC15",
    "24E4CE468CC2"
  ],
  [
    "KAON0901CAAF",
    "24E4CE2E3BE2"
  ],
  [
    "KAON090260D1",
    "24E4CE8A4030"
  ],
  [
    "KAON09028571",
    "24E4CE8B6530"
  ],
  [
    "KAON090254FA",
    "24E4CE89E178"
  ],
  [
    "KAON09004754",
    "1834AF562A12"
  ],
  [
    "KAON09015F66",
    "1834AF5EEAA2"
  ],
  [
    "KAON09019495",
    "1834AFB34FF9"
  ],
  [
    "KAON09001EB0",
    "1834AF52EF8A"
  ],
  [
    "KAON090140EB",
    "1834AF5DF6CA"
  ],
  [
    "KAON0901AD33",
    "24E4CE2D1416"
  ],
  [
    "KAON09011A9A",
    "1834AF5CC442"
  ],
  [
    "KAON0901A863",
    "24E4CE2CED96"
  ],
  [
    "KAON090013E9",
    "1834AF529952"
  ],
  [
    "KAON0902AB2E",
    "24E4CEEB301D"
  ],
  [
    "KAON09018D8D",
    "1834AFB317B9"
  ],
  [
    "KAON09008247",
    "1834AF5801AA"
  ],
  [
    "KAON0901F9BD",
    "24E4CE467A02"
  ],
  [
    "KAON090203E1",
    "24E4CE46CB22"
  ],
  [
    "KAON09021FA9",
    "24E4CE47A962"
  ],
  [
    "KAON0900F7E9",
    "1834AF5BAEBA"
  ],
  [
    "KAON09021386",
    "24E4CE47484A"
  ],
  [
    "KAON0901188A",
    "1834AF5CB3C2"
  ],
  [
    "KAON09011E78",
    "1834AF5CE332"
  ],
  [
    "KAON0901964E",
    "1834AFB35DC1"
  ],
  [
    "KAON0902B3C7",
    "24E4CEEF911E"
  ],
  [
    "KAON09017129",
    "1834AF5F78BA"
  ],
  [
    "KAON09011F1D",
    "1834AF5CE85A"
  ],
  [
    "KAON0900D9E0",
    "1834AF5ABE72"
  ],
  [
    "KAON09015964",
    "1834AF5EBA92"
  ],
  [
    "KAON0902ABF5",
    "24E4CEEB3655"
  ],
  [
    "KAON090298F5",
    "24E4CEEA9E55"
  ],
  [
    "KAON0902A888",
    "24E4CEEB1AED"
  ],
  [
    "KAON090105C1",
    "1834AF5C1D7A"
  ],
  [
    "KAON09022DCB",
    "24E4CE481A72"
  ],
  [
    "KAON0902A0B9",
    "24E4CEEADC75"
  ],
  [
    "KAON09019152",
    "1834AFB335E1"
  ],
  [
    "KAON09026EC8",
    "24E4CE8AAFE8"
  ],
  [
    "KAON0901B660",
    "24E4CE2D996A"
  ],
  [
    "KAON0902841A",
    "24E4CE8B5A78"
  ],
  [
    "KAON09020492",
    "24E4CE46D0AA"
  ],
  [
    "KAON0902106E",
    "24E4CE472F8A"
  ],
  [
    "KAON09029EFE",
    "24E4CEEACE9D"
  ],
  [
    "KAON090195AA",
    "1834AFB358A1"
  ],
  [
    "KAON0902B2C5",
    "24E4CEEF890E"
  ],
  [
    "KAON090014A7",
    "1834AF529F42"
  ],
  [
    "KAON0902AC0E",
    "24E4CEEB371D"
  ],
  [
    "KAON0900634F",
    "1834AF5709EA"
  ],
  [
    "KAON0900CEA2",
    "1834AF5A6482"
  ],
  [
    "KAON0900C572",
    "1834AF5A1B02"
  ],
  [
    "KAON09001C83",
    "1834AF52DE22"
  ],
  [
    "KAON09025337",
    "24E4CE89D360"
  ],
  [
    "KAON0902B2F3",
    "24E4CEEF8A7E"
  ],
  [
    "KAON0902AEFF",
    "24E4CEEB4EA5"
  ],
  [
    "KAON09021A71",
    "24E4CE477FA2"
  ],
  [
    "KAON0902683F",
    "24E4CE8A7BA0"
  ],
  [
    "KAON0901FDEE",
    "24E4CE469B8A"
  ],
  [
    "KAON090298EC",
    "24E4CEEA9E0D"
  ],
  [
    "KAON0900E4CC",
    "1834AF5B15D2"
  ],
  [
    "KAON09017FB8",
    "1834AFB2A911"
  ],
  [
    "KAON0901E7EF",
    "24E4CE2F25E2"
  ],
  [
    "KAON09013E6B",
    "1834AF5DE2CA"
  ],
  [
    "KAON0900A73D",
    "1834AF59295A"
  ],
  [
    "KAON090114AB",
    "1834AF5C94CA"
  ],
  [
    "KAON09024B71",
    "24E4CE899530"
  ],
  [
    "KAON09021373",
    "24E4CE4747B2"
  ],
  [
    "KAON09003A57",
    "1834AF53CCC2"
  ],
  [
    "KAON09009147",
    "1834AF5879AA"
  ],
  [
    "KAON0902775C",
    "24E4CE8AF488"
  ],
  [
    "KAON090222E5",
    "24E4CE47C342"
  ],
  [
    "KAON0902039D",
    "24E4CE46C902"
  ],
  [
    "KAON0902A18A",
    "24E4CEEAE2FD"
  ],
  [
    "KAON09021FCE",
    "24E4CE47AA8A"
  ],
  [
    "KAON0901B3E7",
    "24E4CE2D85A2"
  ],
  [
    "KAON090261B9",
    "24E4CE8A4770"
  ],
  [
    "KAON0901648B",
    "1834AF5F13CA"
  ],
  [
    "KAON09026580",
    "24E4CE8A65A8"
  ],
  [
    "KAON09011595",
    "1834AF5C9C1A"
  ],
  [
    "KAON0900448C",
    "1834AF5613D2"
  ],
  [
    "KAON090206D8",
    "24E4CE46E2DA"
  ],
  [
    "KAON090173D6",
    "1834AF5F8E22"
  ],
  [
    "KAON0901DFB1",
    "24E4CE2EE3F2"
  ],
  [
    "KAON0902A2A1",
    "24E4CEEAEBB5"
  ],
  [
    "KAON09022C04",
    "24E4CE480C3A"
  ],
  [
    "KAON0902B147",
    "24E4CEEB60E5"
  ],
  [
    "KAON09021D69",
    "24E4CE479762"
  ],
  [
    "KAON09008B06",
    "1834AF5847A2"
  ],
  [
    "KAON09025FE6",
    "24E4CE8A38D8"
  ],
  [
    "KAON09003A59",
    "1834AF53CCD2"
  ],
  [
    "KAON09013735",
    "1834AF5DA91A"
  ],
  [
    "KAON0900695A",
    "1834AF573A42"
  ],
  [
    "KAON0901382F",
    "1834AF5DB0EA"
  ],
  [
    "KAON09024B0F",
    "24E4CE899220"
  ],
  [
    "KAON09019329",
    "1834AFB34499"
  ],
  [
    "KAON09015423",
    "1834AF5E908A"
  ],
  [
    "KAON0901BF56",
    "24E4CE2DE11A"
  ],
  [
    "KAON090276FB",
    "24E4CE8AF180"
  ],
  [
    "KAON09022A61",
    "24E4CE47FF22"
  ],
  [
    "KAON0901BB2F",
    "24E4CE2DBFE2"
  ],
  [
    "KAON09007C6C",
    "1834AF57D2D2"
  ],
  [
    "KAON090261B6",
    "24E4CE8A4758"
  ],
  [
    "KAON09002BD0",
    "1834AF53588A"
  ],
  [
    "KAON09022E45",
    "24E4CE481E42"
  ],
  [
    "KAON0901E489",
    "24E4CE2F0AB2"
  ],
  [
    "KAON09007874",
    "1834AF57B312"
  ],
  [
    "KAON09028DF0",
    "24E4CEEA462D"
  ],
  [
    "KAON09023F8E",
    "24E4CE48A88A"
  ],
  [
    "KAON090182D4",
    "1834AFB2C1F1"
  ],
  [
    "KAON090156A3",
    "1834AF5EA48A"
  ],
  [
    "KAON09028271",
    "24E4CE8B4D30"
  ],
  [
    "KAON09014A51",
    "1834AF5E41FA"
  ],
  [
    "KAON09029BF1",
    "24E4CEEAB635"
  ],
  [
    "KAON090113C9",
    "1834AF5C8DBA"
  ],
  [
    "KAON0901F706",
    "24E4CE46644A"
  ],
  [
    "KAON09002C18",
    "1834AF535ACA"
  ],
  [
    "KAON0900DA74",
    "1834AF5AC312"
  ],
  [
    "KAON0900F888",
    "1834AF5BB3B2"
  ],
  [
    "KAON090269B2",
    "24E4CE8A8738"
  ],
  [
    "KAON090134B8",
    "1834AF5D9532"
  ],
  [
    "KAON09011149",
    "1834AF5C79BA"
  ],
  [
    "KAON0901303E",
    "1834AF5D7162"
  ],
  [
    "KAON09022075",
    "24E4CE47AFC2"
  ],
  [
    "KAON0901CFDD",
    "24E4CE2E6552"
  ],
  [
    "KAON090139AC",
    "1834AF5DBCD2"
  ],
  [
    "KAON09024244",
    "24E4CE48BE3A"
  ],
  [
    "KAON09004A8F",
    "1834AF5643EA"
  ],
  [
    "KAON09005D5B",
    "1834AF56DA4A"
  ],
  [
    "KAON090245C4",
    "24E4CE8967C8"
  ],
  [
    "KAON0902A3A7",
    "24E4CEEAF3E5"
  ],
  [
    "KAON09015F3A",
    "1834AF5EE942"
  ],
  [
    "KAON09026B6F",
    "24E4CE8A9520"
  ],
  [
    "KAON090179E0",
    "1834AF5FBE72"
  ],
  [
    "KAON09012F4B",
    "1834AF5D69CA"
  ],
  [
    "KAON090277D8",
    "24E4CE8AF868"
  ],
  [
    "KAON090126F7",
    "1834AF5D272A"
  ],
  [
    "KAON09027316",
    "24E4CE8AD258"
  ],
  [
    "KAON09019DF3",
    "1834AFB39AE9"
  ],
  [
    "KAON0902567A",
    "24E4CE89ED78"
  ],
  [
    "KAON090054E6",
    "1834AF5696A2"
  ],
  [
    "KAON09025560",
    "24E4CE89E4A8"
  ],
  [
    "KAON09020A59",
    "24E4CE46FEE2"
  ],
  [
    "KAON090114B9",
    "1834AF5C953A"
  ],
  [
    "KAON09004640",
    "24E4CEEA4CB5"
  ],
  [
    "KAON0901415B",
    "1834AF5DFA4A"
  ],
  [
    "KAON090232E1",
    "24E4CE484322"
  ],
  [
    "KAON09007A6C",
    "1834AF57C2D2"
  ],
  [
    "KAON09008057",
    "1834AF57F22A"
  ],
  [
    "KAON09024866",
    "24E4CE897CD8"
  ],
  [
    "KAON0900DED3",
    "1834AF5AE60A"
  ],
  [
    "KAON09022D37",
    "24E4CE4815D2"
  ],
  [
    "KAON090158FF",
    "1834AF5EB76A"
  ],
  [
    "KAON09001B69",
    "1834AF52D552"
  ],
  [
    "KAON0900B0C9",
    "1834AF5975BA"
  ],
  [
    "KAON09013B2C",
    "1834AF5DC8D2"
  ],
  [
    "KAON090099F8",
    "1834AF58BF32"
  ],
  [
    "KAON0901E0D0",
    "24E4CE2EECEA"
  ],
  [
    "KAON0900C873",
    "1834AF5A330A"
  ],
  [
    "KAON0901963F",
    "1834AFB35D49"
  ],
  [
    "KAON090193CF",
    "1834AFB349C9"
  ],
  [
    "KAON0900C644",
    "1834AF5A2192"
  ],
  [
    "KAON09016668",
    "1834AF5F22B2"
  ],
  [
    "KAON09026E45",
    "24E4CE8AABD0"
  ],
  [
    "KAON09002F26",
    "1834AF53733A"
  ],
  [
    "KAON09013BBA",
    "1834AF5DCD42"
  ],
  [
    "KAON0902A022",
    "24E4CEEAD7BD"
  ],
  [
    "KAON090077FE",
    "1834AF57AF62"
  ],
  [
    "KAON0901BA98",
    "24E4CE2DBB2A"
  ],
  [
    "KAON0901F96A",
    "24E4CE46776A"
  ],
  [
    "KAON0901B64E",
    "24E4CE2D98DA"
  ],
  [
    "KAON0902A99D",
    "24E4CEEB2395"
  ],
  [
    "KAON09018A28",
    "1834AFB2FC91"
  ],
  [
    "KAON09002DBE",
    "1834AF5367FA"
  ],
  [
    "KAON09020897",
    "24E4CE46F0D2"
  ],
  [
    "KAON0902981F",
    "24E4CEEA97A5"
  ],
  [
    "KAON090166B8",
    "1834AF5F2532"
  ],
  [
    "KAON0902A61C",
    "24E4CEEB078D"
  ],
  [
    "KAON09011A2A",
    "1834AF5CC0C2"
  ],
  [
    "KAON090176F8",
    "1834AF5FA732"
  ],
  [
    "KAON0900A64D",
    "1834AF5921DA"
  ],
  [
    "KAON0900B7AE",
    "1834AF59ACE2"
  ],
  [
    "KAON09000566",
    "1834AF17D126"
  ],
  [
    "KAON09014764",
    "1834AF5E2A92"
  ],
  [
    "KAON090097A9",
    "1834AF58ACBA"
  ],
  [
    "KAON09029035",
    "24E4CEEA5855"
  ],
  [
    "KAON0900F968",
    "1834AF5BBAB2"
  ],
  [
    "KAON090098D2",
    "1834AF58B602"
  ],
  [
    "KAON0900B2D0",
    "1834AF5985F2"
  ],
  [
    "KAON09028E0E",
    "24E4CEEA471D"
  ],
  [
    "KAON09016C89",
    "1834AF5F53BA"
  ],
  [
    "KAON090103C9",
    "1834AF5C0DBA"
  ],
  [
    "KAON09011F36",
    "1834AF5CE922"
  ],
  [
    "KAON0900DA9C",
    "1834AF5AC452"
  ],
  [
    "KAON090010F9",
    "1834AF5281D2"
  ],
  [
    "KAON090107AB",
    "1834AF5C2CCA"
  ],
  [
    "KAON0901A288",
    "1834AFB3BF91"
  ],
  [
    "KAON090122AB",
    "1834AF5D04CA"
  ],
  [
    "KAON09002723",
    "1834AF533322"
  ],
  [
    "KAON09003FD9",
    "1834AF53F8D2"
  ],
  [
    "KAON090214DB",
    "24E4CE4752F2"
  ],
  [
    "KAON090026FD",
    "1834AF5331F2"
  ],
  [
    "KAON090149A6",
    "1834AF5E3CA2"
  ],
  [
    "KAON09002B2E",
    "1834AF53537A"
  ],
  [
    "KAON09013006",
    "1834AF5D6FA2"
  ],
  [
    "KAON0900B73E",
    "1834AF59A962"
  ],
  [
    "KAON0901F6A1",
    "24E4CE466122"
  ],
  [
    "KAON0900D2DA",
    "1834AF5A8642"
  ],
  [
    "KAON09024AF7",
    "24E4CE899160"
  ],
  [
    "KAON0900826F",
    "1834AF5802EA"
  ],
  [
    "KAON09000CC8",
    "1834AF52604A"
  ],
  [
    "KAON0900CC56",
    "1834AF5A5222"
  ],
  [
    "KAON09017B50",
    "1834AF5FC9F2"
  ],
  [
    "KAON09014A08",
    "1834AF5E3FB2"
  ],
  [
    "KAON09029903",
    "24E4CEEA9EC5"
  ],
  [
    "KAON09010AE8",
    "1834AF5C46B2"
  ],
  [
    "KAON09002FF0",
    "1834AF53798A"
  ],
  [
    "KAON09022AEB",
    "24E4CE480372"
  ],
  [
    "KAON09018484",
    "1834AFB2CF71"
  ],
  [
    "KAON090160A9",
    "1834AF5EF4BA"
  ],
  [
    "KAON0902774A",
    "24E4CE8AF3F8"
  ],
  [
    "KAON090178B5",
    "1834AF5FB51A"
  ],
  [
    "KAON090206A7",
    "24E4CE46E152"
  ],
  [
    "KAON0900FC5B",
    "1834AF5BD24A"
  ],
  [
    "KAON0902864F",
    "24E4CE8B6C20"
  ],
  [
    "KAON090298EA",
    "24E4CEEA9DFD"
  ],
  [
    "KAON0902B0DF",
    "24E4CEEB5DA5"
  ],
  [
    "KAON0902B2ED",
    "24E4CEEF8A4E"
  ],
  [
    "KAON09011797",
    "1834AF5CAC2A"
  ],
  [
    "KAON0902A210",
    "24E4CEEAE72D"
  ],
  [
    "KAON09009AEE",
    "1834AF58C6E2"
  ],
  [
    "KAON090282D3",
    "24E4CE8B5040"
  ],
  [
    "KAON09014E70",
    "1834AF5E62F2"
  ],
  [
    "KAON09029329",
    "24E4CEEA6FF5"
  ],
  [
    "KAON090184C8",
    "1834AFB2D191"
  ],
  [
    "KAON09017899",
    "1834AF5FB43A"
  ],
  [
    "KAON09025B12",
    "24E4CE8A1238"
  ],
  [
    "KAON0901E08F",
    "24E4CE2EEAE2"
  ],
  [
    "KAON09029BD7",
    "24E4CEEAB565"
  ],
  [
    "KAON09029603",
    "24E4CEEA86C5"
  ],
  [
    "KAON09007063",
    "1834AF57728A"
  ],
  [
    "KAON09006DC8",
    "1834AF575DB2"
  ],
  [
    "KAON0901B47B",
    "24E4CE2D8A42"
  ],
  [
    "KAON09018A4B",
    "1834AFB2FDA9"
  ],
  [
    "KAON09007B43",
    "1834AF57C98A"
  ],
  [
    "KAON0901E866",
    "24E4CE2F299A"
  ],
  [
    "KAON0901AF42",
    "24E4CE2D248E"
  ],
  [
    "KAON0900B3B1",
    "1834AF598CFA"
  ],
  [
    "KAON0902902F",
    "24E4CEEA5825"
  ],
  [
    "KAON0901E8BF",
    "1834AF5D741A"
  ],
  [
    "KAON09015E59",
    "1834AF5EE23A"
  ],
  [
    "KAON0901D969",
    "24E4CE2EB1B2"
  ],
  [
    "KAON0900972A",
    "1834AF58A8C2"
  ],
  [
    "KAON09000CD0",
    "1834AF52608A"
  ],
  [
    "KAON09026FDA",
    "24E4CE8AB878"
  ],
  [
    "KAON0901F3FD",
    "24E4CE2F8652"
  ],
  [
    "KAON09013594",
    "1834AF5D9C12"
  ],
  [
    "KAON0900F624",
    "1834AF5BA092"
  ],
  [
    "KAON09015851",
    "1834AF5EB1FA"
  ],
  [
    "KAON09021282",
    "24E4CE47402A"
  ],
  [
    "KAON09024755",
    "24E4CE897450"
  ],
  [
    "KAON09011EC6",
    "1834AF5CE5A2"
  ],
  [
    "KAON090051B2",
    "1834AF567D02"
  ],
  [
    "KAON0902A7EF",
    "24E4CEEB1625"
  ],
  [
    "KAON09013B9E",
    "1834AF5DCC62"
  ],
  [
    "KAON09012CE3",
    "1834AF5D568A"
  ],
  [
    "KAON09000195",
    "1834AF17B29E"
  ],
  [
    "KAON0901A5A5",
    "1834AFB3D879"
  ],
  [
    "KAON09006A13",
    "1834AF57400A"
  ],
  [
    "KAON09008FFD",
    "1834AF586F5A"
  ],
  [
    "KAON0901DB9E",
    "24E4CE2EC35A"
  ],
  [
    "KAON090135D6",
    "1834AF5D9E22"
  ],
  [
    "KAON0901580A",
    "1834AF5EAFC2"
  ],
  [
    "KAON090084C2",
    "1834AF581582"
  ],
  [
    "KAON090148CF",
    "1834AF5E35EA"
  ],
  [
    "KAON09026D68",
    "24E4CE8AA4E8"
  ],
  [
    "KAON09016253",
    "1834AF5F020A"
  ],
  [
    "KAON09010622",
    "1834AF5C2082"
  ],
  [
    "KAON09017DA3",
    "1834AFB29869"
  ],
  [
    "KAON090060F4",
    "1834AF56F712"
  ],
  [
    "KAON09025283",
    "24E4CE89CDC0"
  ],
  [
    "KAON09007AEB",
    "1834AF57C6CA"
  ],
  [
    "KAON09025BD3",
    "24E4CE8A1840"
  ],
  [
    "KAON0900DA9D",
    "1834AF5AC45A"
  ],
  [
    "KAON09006FBE",
    "1834AF576D62"
  ],
  [
    "KAON090047E5",
    "1834AF562E9A"
  ],
  [
    "KAON0901DD01",
    "24E4CE2ECE72"
  ],
  [
    "KAON090130D9",
    "1834AF5D763A"
  ],
  [
    "KAON0901B151",
    "24E4CE2D70F2"
  ],
  [
    "KAON090122AA",
    "1834AF5D04C2"
  ],
  [
    "KAON0901A46F",
    "1834AFB3CEC9"
  ],
  [
    "KAON09012D44",
    "1834AF5D5992"
  ],
  [
    "KAON090118DB",
    "1834AF5CB64A"
  ],
  [
    "KAON0900169F",
    "1834AF52AF02"
  ],
  [
    "KAON09010C2C",
    "1834AF5C50D2"
  ],
  [
    "KAON090160E4",
    "1834AF5EF692"
  ],
  [
    "KAON090189B3",
    "1834AFB2F8E9"
  ],
  [
    "KAON0900F61A",
    "1834AF5BA042"
  ],
  [
    "KAON090191CA",
    "1834AFB339A1"
  ],
  [
    "KAON0901ACC4",
    "24E4CE2D109E"
  ],
  [
    "KAON090190D4",
    "1834AFB331F1"
  ],
  [
    "KAON090114F8",
    "1834AF5C9732"
  ],
  [
    "KAON0901D435",
    "24E4CE2E8812"
  ],
  [
    "KAON09002BDE",
    "1834AF5358FA"
  ],
  [
    "KAON09027D31",
    "24E4CE8B2330"
  ],
  [
    "KAON0902826C",
    "24E4CE8B4D08"
  ],
  [
    "KAON0902A72F",
    "24E4CEEB1025"
  ],
  [
    "KAON0900CF19",
    "1834AF5A683A"
  ],
  [
    "KAON09000B28",
    "1834AF52534A"
  ],
  [
    "KAON0900FFDE",
    "1834AF5BEE62"
  ],
  [
    "KAON0900115F",
    "1834AF528502"
  ],
  [
    "KAON09024FE4",
    "24E4CE89B8C8"
  ],
  [
    "KAON090026B1",
    "1834AF532F92"
  ],
  [
    "KAON0901E997",
    "24E4CE2F3322"
  ],
  [
    "KAON0900DE70",
    "1834AF5AE2F2"
  ],
  [
    "KAON09000BA5",
    "1834AF525732"
  ],
  [
    "KAON0901BB3D",
    "24E4CE2DC052"
  ],
  [
    "KAON0900CDDC",
    "1834AF5A5E52"
  ],
  [
    "KAON09015A41",
    "1834AF5EC17A"
  ],
  [
    "KAON0901C948",
    "24E4CE2E30AA"
  ],
  [
    "KAON0900AEA7",
    "1834AF5964AA"
  ],
  [
    "KAON0900C90B",
    "1834AF5A37CA"
  ],
  [
    "KAON09004093",
    "1834AF53FEA2"
  ],
  [
    "KAON090120BF",
    "1834AF5CF56A"
  ],
  [
    "KAON09024FCE",
    "24E4CE89B818"
  ],
  [
    "KAON0902012D",
    "24E4CE46B582"
  ],
  [
    "KAON0902344D",
    "24E4CE484E82"
  ],
  [
    "KAON0901E699",
    "24E4CE2F1B32"
  ],
  [
    "KAON09002FA8",
    "1834AF53774A"
  ],
  [
    "KAON0901DDDE",
    "24E4CE2ED55A"
  ],
  [
    "KAON09021325",
    "24E4CE474542"
  ],
  [
    "KAON09023389",
    "24E4CE484862"
  ],
  [
    "KAON0901EFE7",
    "24E4CE2F65A2"
  ],
  [
    "KAON0901AE6F",
    "24E4CE2D1DF6"
  ],
  [
    "KAON090011DE",
    "1834AF5288FA"
  ],
  [
    "KAON09016F9C",
    "1834AF5F6C52"
  ],
  [
    "KAON0901DC86",
    "24E4CE8AA4B0"
  ],
  [
    "KAON090061C2",
    "1834AF56FD82"
  ],
  [
    "KAON09004BD9",
    "1834AF564E3A"
  ],
  [
    "KAON09017765",
    "1834AF5FAA9A"
  ],
  [
    "KAON09026A17",
    "24E4CE8A8A60"
  ],
  [
    "KAON0901C91B",
    "24E4CE2E2F42"
  ],
  [
    "KAON0901FFD3",
    "24E4CE46AAB2"
  ],
  [
    "KAON090144E6",
    "1834AF5E16A2"
  ],
  [
    "KAON09024059",
    "24E4CE48AEE2"
  ],
  [
    "KAON09016F6E",
    "1834AF5F6AE2"
  ],
  [
    "KAON0901C275",
    "24E4CE2DFA12"
  ],
  [
    "KAON0901C65F",
    "24E4CE2E1962"
  ],
  [
    "KAON0901E571",
    "24E4CE2F11F2"
  ],
  [
    "KAON09022FE6",
    "24E4CE482B4A"
  ],
  [
    "KAON09028A8B",
    "24E4CE8B8E00"
  ],
  [
    "KAON090226A5",
    "24E4CE47E142"
  ],
  [
    "KAON0900FC3A",
    "1834AF5BD142"
  ],
  [
    "KAON09020FAD",
    "24E4CE472982"
  ],
  [
    "KAON0900BAB7",
    "1834AF59C52A"
  ],
  [
    "KAON09008738",
    "1834AF582932"
  ],
  [
    "KAON090237EF",
    "24E4CE486B92"
  ],
  [
    "KAON090192EF",
    "1834AFB342C9"
  ],
  [
    "KAON0902A579",
    "24E4CEEB0275"
  ],
  [
    "KAON0901B7E2",
    "24E4CE2DA57A"
  ],
  [
    "KAON0901663D",
    "1834AF5F215A"
  ],
  [
    "KAON09008364",
    "1834AF580A92"
  ],
  [
    "KAON090024C0",
    "1834AF53200A"
  ],
  [
    "KAON09012CCD",
    "1834AF5D55DA"
  ],
  [
    "KAON09026944",
    "24E4CE8A83C8"
  ],
  [
    "KAON09013054",
    "1834AF5D7212"
  ],
  [
    "KAON090140AC",
    "1834AF5DF4D2"
  ],
  [
    "KAON09017FC2",
    "1834AFB2A961"
  ],
  [
    "KAON0901C1D5",
    "24E4CE2DF512"
  ],
  [
    "KAON0901D3E5",
    "24E4CE2E8592"
  ],
  [
    "KAON09015F22",
    "1834AF5EE882"
  ],
  [
    "KAON090203AC",
    "24E4CE46C97A"
  ],
  [
    "KAON0901EED4",
    "24E4CE2F5D0A"
  ],
  [
    "KAON0901CCAF",
    "24E4CE2E4BE2"
  ],
  [
    "KAON0901AA12",
    "24E4CE2CFB0E"
  ],
  [
    "KAON0901E6C8",
    "24E4CE2F1CAA"
  ],
  [
    "KAON09024FE3",
    "24E4CE89B8C0"
  ],
  [
    "KAON090276F3",
    "24E4CE8AF140"
  ],
  [
    "KAON090290DF",
    "24E4CEEA5DA5"
  ],
  [
    "KAON09001E0F",
    "1834AF52EA82"
  ],
  [
    "KAON090156A6",
    "1834AF5EA4A2"
  ],
  [
    "KAON09010F0C",
    "1834AF5CC8AA"
  ],
  [
    "KAON09024257",
    "24E4CE48BED2"
  ],
  [
    "KAON09023A15",
    "24E4CE487CC2"
  ],
  [
    "KAON09019C8E",
    "1834AFB38FC1"
  ],
  [
    "KAON0901906C",
    "1834AFB32EB1"
  ],
  [
    "KAON0902179D",
    "24E4CE476902"
  ],
  [
    "KAON0900ABD9",
    "1834AF594E3A"
  ],
  [
    "KAON09022054",
    "24E4CE47AEBA"
  ],
  [
    "KAON09002228",
    "1834AF530B4A"
  ],
  [
    "KAON09027509",
    "24E4CE8AE1F0"
  ],
  [
    "KAON0901778C",
    "1834AF5FABD2"
  ],
  [
    "KAON090142C6",
    "1834AF5E05A2"
  ],
  [
    "KAON0900E5ED",
    "1834AF5B1EDA"
  ],
  [
    "KAON09017134",
    "1834AF5F7912"
  ],
  [
    "KAON090174CA",
    "1834AF5F95C2"
  ],
  [
    "KAON090125BA",
    "1834AF5D1D42"
  ],
  [
    "KAON09002B56",
    "1834AF5354BA"
  ],
  [
    "KAON09028BA0",
    "24E4CEEA33AD"
  ],
  [
    "KAON090276B9",
    "24E4CE8AEF70"
  ],
  [
    "KAON09016552",
    "1834AF5F1A02"
  ],
  [
    "KAON0900683B",
    "1834AF57314A"
  ],
  [
    "KAON0901552A",
    "1834AF5E98C2"
  ],
  [
    "KAON09006F39",
    "1834AF57693A"
  ],
  [
    "KAON0900E9CF",
    "1834AF5B3DEA"
  ],
  [
    "KAON0900751F",
    "1834AF57986A"
  ],
  [
    "KAON090067E7",
    "1834AF572EAA"
  ],
  [
    "KAON090133EA",
    "1834AF5D8EC2"
  ],
  [
    "KAON0900CB55",
    "1834AF5A4A1A"
  ],
  [
    "KAON09028248",
    "24E4CE8B4BE8"
  ],
  [
    "KAON0901092C",
    "1834AF5C38D2"
  ],
  [
    "KAON09011618",
    "1834AF5CA032"
  ],
  [
    "KAON09024A5F",
    "24E4CE898CA0"
  ],
  [
    "KAON09029E3D",
    "24E4CEEAC895"
  ],
  [
    "KAON0900CF5B",
    "1834AF5A6A4A"
  ],
  [
    "KAON09005F4B",
    "1834AF56E9CA"
  ],
  [
    "KAON09016F7C",
    "1834AF5F6B52"
  ],
  [
    "KAON0901C8D2",
    "24E4CE2E2CFA"
  ],
  [
    "KAON090080FB",
    "1834AF57F74A"
  ],
  [
    "KAON09020D96",
    "24E4CE4718CA"
  ],
  [
    "KAON09008F9B",
    "1834AF586C4A"
  ],
  [
    "KAON09029C95",
    "24E4CEEABB55"
  ],
  [
    "KAON09023D42",
    "24E4CE48962A"
  ],
  [
    "KAON09000C54",
    "1834AF525CAA"
  ],
  [
    "KAON09017278",
    "1834AF5F8332"
  ],
  [
    "KAON0900B5CF",
    "1834AF599DEA"
  ],
  [
    "KAON090241DB",
    "24E4CE48BAF2"
  ],
  [
    "KAON0901BEEF",
    "24E4CE2DDDE2"
  ],
  [
    "KAON0901A95A",
    "24E4CE2CF54E"
  ],
  [
    "KAON090294B5",
    "24E4CEEA7D45"
  ],
  [
    "KAON09019CC9",
    "1834AFB39199"
  ],
  [
    "KAON0901F97E",
    "24E4CE46780A"
  ],
  [
    "KAON09024F25",
    "24E4CE89B2D0"
  ],
  [
    "KAON0901D973",
    "24E4CE2EB202"
  ],
  [
    "KAON0902028A",
    "24E4CE46C06A"
  ],
  [
    "KAON0901E6F7",
    "24E4CE2F1E22"
  ],
  [
    "KAON090202CB",
    "24E4CE46C272"
  ],
  [
    "KAON0900CBD1",
    "1834AF5A4DFA"
  ],
  [
    "KAON0900ACBE",
    "1834AF595562"
  ],
  [
    "KAON0900F7D4",
    "1834AF5BAE12"
  ],
  [
    "KAON0900CCAB",
    "1834AF5A54CA"
  ],
  [
    "KAON0901AB0C",
    "24E4CE2D02DE"
  ],
  [
    "KAON09011127",
    "1834AF5C78AA"
  ],
  [
    "KAON0901A57B",
    "1834AFB3D729"
  ],
  [
    "KAON0901563D",
    "1834AF5EA15A"
  ],
  [
    "KAON0902A7A8",
    "24E4CEEB13ED"
  ],
  [
    "KAON0902AEE2",
    "24E4CEEB4DBD"
  ],
  [
    "KAON09028A4E",
    "24E4CE8B818"
  ],
  [
    "KAON09017745",
    "1834AF5FA99A"
  ],
  [
    "KAON09014287",
    "1834AF5E03AA"
  ],
  [
    "KAON090049E1",
    "1834AF563E7A"
  ],
  [
    "KAON0901C065",
    "24E4CE2DE992"
  ],
  [
    "KAON09003F91",
    "1834AF53F692"
  ],
  [
    "KAON09009926",
    "1834AF58B8A2"
  ],
  [
    "KAON0900A748",
    "1834AF5929B2"
  ],
  [
    "KAON0901027B",
    "1834AF5C034A"
  ],
  [
    "KAON0900BBAE",
    "1834AF59CCE2"
  ],
  [
    "KAON090078BC",
    "1834AF57B552"
  ],
  [
    "KAON09027705",
    "24E4CE8AF1D0"
  ],
  [
    "KAON0900E260",
    "1834AF5B0272"
  ],
  [
    "KAON0901A81A",
    "24E4CE2CEB4E"
  ],
  [
    "KAON09008959",
    "1834AF583A3A"
  ],
  [
    "KAON0901C146",
    "24E4CE2DF09A"
  ],
  [
    "KAON09012F69",
    "1834AF5D6ABA"
  ],
  [
    "KAON090006F8",
    "1834AF5425CA"
  ],
  [
    "KAON09009217",
    "1834AF58802A"
  ],
  [
    "KAON0902858D",
    "24E4CE8B6610"
  ],
  [
    "KAON09020AB5",
    "24E4CE4701C2"
  ],
  [
    "KAON09023989",
    "24E4CE487862"
  ],
  [
    "KAON0901C728",
    "24E4CE2E1FAA"
  ],
  [
    "KAON0900DBF3",
    "1834AF5ACF0A"
  ],
  [
    "KAON090201EA",
    "24E4CE46BB6A"
  ],
  [
    "KAON0901A880",
    "24E4CE2CEE7E"
  ],
  [
    "KAON09004B83",
    "1834AF564B8A"
  ],
  [
    "KAON0901F739",
    "24E4CE4665E2"
  ],
  [
    "KAON090194A0",
    "1834AFB35051"
  ],
  [
    "KAON0900133F",
    "1834AF529402"
  ],
  [
    "KAON090164CE",
    "1834AF5F15E2"
  ],
  [
    "KAON09004D32",
    "1834AF565902"
  ],
  [
    "KAON0900BC7E",
    "1834AF59D362"
  ],
  [
    "KAON09016257",
    "1834AF5F022A"
  ],
  [
    "KAON090098B1",
    "1834AF58B4FA"
  ],
  [
    "KAON0900680E",
    "1834AF572FE2"
  ],
  [
    "KAON09014A47",
    "1834AF5E41AA"
  ],
  [
    "KAON09007A45",
    "1834AF57C19A"
  ],
  [
    "KAON0900AA15",
    "1834AF59401A"
  ],
  [
    "KAON0900A800",
    "1834AF592F72"
  ],
  [
    "KAON0901D55A",
    "24E4CE2E913A"
  ],
  [
    "KAON09027425",
    "24E4CE8ADAD0"
  ],
  [
    "KAON0900AF05",
    "1834AF59679A"
  ],
  [
    "KAON09009A8D",
    "1834AF58C3DA"
  ],
  [
    "KAON09009ACB",
    "1834AF58C5CA"
  ],
  [
    "KAON0901ABAC",
    "24E4CE2D07DE"
  ],
  [
    "KAON09017EDF",
    "1834AFB2A249"
  ],
  [
    "KAON090112B5",
    "1834AF5C851A"
  ],
  [
    "KAON09002449",
    "1834AF531C52"
  ],
  [
    "KAON090151DF",
    "1834AF5E7E6A"
  ],
  [
    "KAON0901FD10",
    "24E4CE46949A"
  ],
  [
    "KAON09012036",
    "1834AF5CF122"
  ],
  [
    "KAON0900F4DD",
    "1834AF5B965A"
  ],
  [
    "KAON0901A785",
    "24E4CE2CE6A6"
  ],
  [
    "KAON0900C80E",
    "1834AF5A2FE2"
  ],
  [
    "KAON090265FF",
    "24E4CE8A69A0"
  ],
  [
    "KAON0902B7A4",
    "24E4CEEFB006"
  ],
  [
    "KAON0901E17C",
    "24E4CE2EF24A"
  ],
  [
    "KAON09010D9C",
    "1834AF5C5C52"
  ],
  [
    "KAON0901CFC7",
    "24E4CE2E64A2"
  ],
  [
    "KAON090207E9",
    "24E4CE46EB62"
  ],
  [
    "KAON090159F9",
    "1834AF5EBF3A"
  ],
  [
    "KAON090266C1",
    "24E4CE8A6FB0"
  ],
  [
    "KAON09010016",
    "1834AF5BF022"
  ],
  [
    "KAON090162DE",
    "1834AF5F0662"
  ],
  [
    "KAON0901E5CA",
    "24E4CE2F14BA"
  ],
  [
    "KAON090012C2",
    "1834AF52901A"
  ],
  [
    "KAON09005BD6",
    "1834AF56CE22"
  ],
  [
    "KAON09010F3C",
    "1834AF5C6952"
  ],
  [
    "KAON0900E244",
    "1834AF5B0192"
  ],
  [
    "KAON090281E2",
    "24E4CE8B48B8"
  ],
  [
    "KAON090113BB",
    "1834AF5C8D4A"
  ],
  [
    "KAON09029311",
    "24E4CEEA6F35"
  ],
  [
    "KAON0901D608",
    "24E4CE2E96AA"
  ],
  [
    "KAON09026F12",
    "24E4CE8AB238"
  ],
  [
    "KAON0900F54E",
    "1834AF5B99E2"
  ],
  [
    "KAON09027474",
    "24E4CE8ADD48"
  ],
  [
    "KAON090294C6",
    "24E4CEEA7CDD"
  ],
  [
    "KAON09007C2C",
    "1834AF57D0D2"
  ],
  [
    "KAON09029D4A",
    "24E4CEEAC0FD"
  ],
  [
    "KAON090292F0",
    "24E4CEEA6E2D"
  ],
  [
    "KAON09010048",
    "1834AF5BF1B2"
  ],
  [
    "KAON0901D138",
    "24E4CE2E702A"
  ],
  [
    "KAON09005D7D",
    "1834AF56DB5A"
  ],
  [
    "KAON09029D66",
    "24E4CEEAC1DD"
  ],
  [
    "KAON090177AD",
    "1834AF5FACDA"
  ],
  [
    "KAON09026AE1",
    "24E4CE8A90B0"
  ],
  [
    "KAON0901A7CB",
    "24E4CE2CE8D6"
  ],
  [
    "KAON0900F4F6",
    "1834AF5B9722"
  ],
  [
    "KAON09002B15",
    "1834AF5352B2"
  ],
  [
    "KAON0900161A",
    "1834AF52AADA"
  ],
  [
    "KAON0901F406",
    "24E4CE2F869A"
  ],
  [
    "KAON09012012",
    "1834AF5CF002"
  ],
  [
    "KAON0901CAC9",
    "24E4CE2E3CB2"
  ],
  [
    "KAON0901E4D1",
    "24E4CE2F0CF2"
  ],
  [
    "KAON09025107",
    "24E4CE89C1E0"
  ],
  [
    "KAON09023897",
    "24E4CE4870D2"
  ],
  [
    "KAON09001CBA",
    "1834AF52DFDA"
  ],
  [
    "KAON0901BE59",
    "24E4CE2DD932"
  ],
  [
    "KAON09008612",
    "1834AF582002"
  ],
  [
    "KAON09021D54",
    "24E4CE4796BA"
  ],
  [
    "KAON09009274",
    "1834AF588312"
  ],
  [
    "KAON09017B2B",
    "24E4CE47299A"
  ],
  [
    "KAON0901A708",
    "1834AFB3E391"
  ],
  [
    "KAON0902060D",
    "24E4CE46DC82"
  ],
  [
    "KAON09024E46",
    "24E4CE89ABD8"
  ],
  [
    "KAON0902819A",
    "24E4CE8B4678"
  ],
  [
    "KAON09009393",
    "1834AF588C0A"
  ],
  [
    "KAON09021519",
    "24E4CE4754E2"
  ],
  [
    "KAON09017A8B",
    "1834AF5FC3CA"
  ],
  [
    "KAON0901A048",
    "1834AFB3AD91"
  ],
  [
    "KAON0902A750",
    "24E4CEEB112D"
  ],
  [
    "KAON09025810",
    "24E4CE89FA28"
  ],
  [
    "KAON0901E921",
    "24E4CE2F2F72"
  ],
  [
    "KAON090235FF",
    "24E4CE485C12"
  ],
  [
    "KAON09001B6F",
    "1834AF52D582"
  ],
  [
    "KAON090003F2",
    "1834AF17C586"
  ],
  [
    "KAON0901F888",
    "24E4CE46705A"
  ],
  [
    "KAON0901AAA8",
    "24E4CE2CFFBE"
  ],
  [
    "KAON09015017",
    "1834AF5E702A"
  ],
  [
    "KAON090188AE",
    "1834AFB2F0C1"
  ],
  [
    "KAON090184D9",
    "1834AFB2D219"
  ],
  [
    "KAON0900CE39",
    "1834AF5A613A"
  ],
  [
    "KAON09003015",
    "1834AF537AB2"
  ],
  [
    "KAON090064AD",
    "1834AF5714DA"
  ],
  [
    "KAON0902753A",
    "24E4CE8AE378"
  ],
  [
    "KAON09027A14",
    "24E4CE8B0A48"
  ],
  [
    "KAON0900194A",
    "1834AF52C45A"
  ],
  [
    "KAON090185F9",
    "1834AFB2DB19"
  ],
  [
    "KAON09016C92",
    "1834AF5F5402"
  ],
  [
    "KAON0900D9C5",
    "1834AF5ABD9A"
  ],
  [
    "KAON0901FCB6",
    "24E4CE4691CA"
  ],
  [
    "KAON09001198",
    "1834AF5286CA"
  ],
  [
    "KAON09007681",
    "1834AF57A37A"
  ],
  [
    "KAON09013ACD",
    "1834AF5DC5DA"
  ],
  [
    "KAON0901267B",
    "1834AF5D234A"
  ],
  [
    "KAON0900FD50",
    "24E4CE2F8CEA"
  ],
  [
    "KAON0901E774",
    "24E4CE2F220A"
  ],
  [
    "KAON0902836B",
    "24E4CE8B5500"
  ],
  [
    "KAON09020340",
    "24E4CE46C61A"
  ],
  [
    "KAON09016E31",
    "1834AF5F60FA"
  ],
  [
    "KAON09018C1F",
    "1834AFB30C49"
  ],
  [
    "KAON0901DB30",
    "24E4CE2EBFEA"
  ],
  [
    "KAON09010D74",
    "1834AF5C5B12"
  ],
  [
    "KAON090086CA",
    "1834AF5825C2"
  ],
  [
    "KAON0902802A",
    "24E4CE8B3AF8"
  ],
  [
    "KAON0901A8D6",
    "24E4CE2CF12E"
  ],
  [
    "KAON090266DD",
    "24E4CE8A7090"
  ],
  [
    "KAON0901E839",
    "24E4CE2F2832"
  ],
  [
    "KAON090114D0",
    "1834AF5C95F2"
  ],
  [
    "KAON09028BA4",
    "24E4CEEA33CD"
  ],
  [
    "KAON090012D1",
    "1834AF529092"
  ],
  [
    "KAON09002F7B",
    "1834AF5375E2"
  ],
  [
    "KAON0900DB72",
    "1834AF5ACB02"
  ],
  [
    "KAON0901267A",
    "1834AF5D2342"
  ],
  [
    "KAON0901203C",
    "1834AF5CF152"
  ],
  [
    "KAON09006BDE",
    "1834AF574E62"
  ],
  [
    "KAON0900BF47",
    "1834AF59E9AA"
  ],
  [
    "KAON09028BAE",
    "24E4CEEA341D"
  ],
  [
    "KAON0900DEAB",
    "1834AF5AE4CA"
  ],
  [
    "KAON09019C57",
    "1834AFB38E09"
  ],
  [
    "KAON09014448",
    "1834AF5E11B2"
  ],
  [
    "KAON0902A341",
    "24E4CEEAF0B5"
  ],
  [
    "KAON09021FBA",
    "24E4CE47A9EA"
  ],
  [
    "KAON09027DF8",
    "24E4CE8B2968"
  ],
  [
    "KAON0900FABD",
    "1834AF5BC55A"
  ],
  [
    "KAON09010431",
    "1834AF5C10FA"
  ],
  [
    "KAON090207FB",
    "24E4CE46EBF2"
  ],
  [
    "KAON09004E47",
    "1834AF5661AA"
  ],
  [
    "KAON09016021",
    "1834AF5EF07A"
  ],
  [
    "KAON0900997D",
    "1834AF58BB5A"
  ],
  [
    "KAON09027CEE",
    "24E4CE8B2118"
  ],
  [
    "KAON0900752E",
    "1834AF5798E2"
  ],
  [
    "KAON0900F7D1",
    "1834AF5BADFA"
  ],
  [
    "KAON09012B85",
    "1834AF5D4B9A"
  ],
  [
    "KAON09014695",
    "1834AF5E241A"
  ],
  [
    "KAON0901A61C",
    "1834AFB3DC31"
  ],
  [
    "KAON0901FBA3",
    "24E4CE468932"
  ],
  [
    "KAON09015CA3",
    "1834AF5ED48A"
  ],
  [
    "KAON09029467",
    "24E4CEEA79E5"
  ],
  [
    "KAON0900A5E1",
    "1834AF591E7A"
  ],
  [
    "KAON0900263A",
    "1834AF532BDA"
  ],
  [
    "KAON0902150D",
    "24E4CE475482"
  ],
  [
    "KAON0900FFDF",
    "1834AF5BEE6A"
  ],
  [
    "KAON0901935E",
    "1834AFB34641"
  ],
  [
    "KAON0901C259",
    "24E4CE2DF932"
  ],
  [
    "KAON0901B494",
    "24E4CE2D8B0A"
  ],
  [
    "KAON09004AE3",
    "1834AF56468A"
  ],
  [
    "KAON0901EB58",
    "24E4CE2F412A"
  ],
  [
    "KAON090051E0",
    "1834AF567E72"
  ],
  [
    "KAON0902A04A",
    "24E4CEEAD8FD"
  ],
  [
    "KAON0900F3F4",
    "1834AF5B8F12"
  ],
  [
    "KAON0901BB72",
    "24E4CE2DC1FA"
  ],
  [
    "KAON0901CDAA",
    "24E4CE2E53BA"
  ],
  [
    "KAON0901E910",
    "24E4CE2F2EEA"
  ],
  [
    "KAON090244EB",
    "24E4CE896100"
  ],
  [
    "KAON0902270C",
    "24E4CE47E47A"
  ],
  [
    "KAON09022095",
    "24E4CE47B0C2"
  ],
  [
    "KAON09022FF2",
    "24E4CE482BAA"
  ],
  [
    "KAON090175AB",
    "1834AF5F9CCA"
  ],
  [
    "KAON09015E67",
    "1834AF5EE2AA"
  ],
  [
    "KAON0901371C",
    "1834AF5DA852"
  ],
  [
    "KAON0900226A",
    "1834AF530D5A"
  ],
  [
    "KAON09026209",
    "24E4CE8A49F0"
  ],
  [
    "KAON09017CCB",
    "1834AFB291A9"
  ],
  [
    "KAON09013771",
    "1834AF5DAAFA"
  ],
  [
    "KAON090162B7",
    "1834AF5F052A"
  ],
  [
    "KAON0901EAA4",
    "24E4CE2F3B8A"
  ],
  [
    "KAON0902878E",
    "24E4CE8B7618"
  ],
  [
    "KAON09013D26",
    "1834AF5DD8A2"
  ],
  [
    "KAON090059E4",
    "1834AF56BE92"
  ],
  [
    "KAON09020084",
    "24E4CE46B03A"
  ],
  [
    "KAON0901F5F7",
    "24E4CE465BD2"
  ],
  [
    "KAON09005C50",
    "1834AF56D1F2"
  ],
  [
    "KAON0901FB4C",
    "24E4CE46867A"
  ],
  [
    "KAON090071A9",
    "1834AF577CBA"
  ],
  [
    "KAON0902A460",
    "24E4CEEAF9AD"
  ],
  [
    "KAON090231A1",
    "24E4CE483922"
  ],
  [
    "KAON09021128",
    "24E4CE47355A"
  ],
  [
    "KAON09029518",
    "24E4CEEA7F6D"
  ],
  [
    "KAON0901D434",
    "24E4CE2E880A"
  ],
  [
    "KAON09020CAD",
    "24E4CE471182"
  ],
  [
    "KAON0901CA26",
    "24E4CE2E379A"
  ],
  [
    "KAON0901E909",
    "24E4CE2F2EB2"
  ],
  [
    "KAON09022BF8",
    "24E4CE480BDA"
  ],
  [
    "KAON0900F3B9",
    "1834AF5B8D3A"
  ],
  [
    "KAON09018FCC",
    "1834AFB329B1"
  ],
  [
    "KAON0902994B",
    "24E4CEEA9315"
  ],
  [
    "KAON09018879",
    "1834AFB2EF19"
  ],
  [
    "KAON09018F77",
    "1834AFB32709"
  ],
  [
    "KAON0900F1DD",
    "1834AF5B7E5A"
  ],
  [
    "KAON09022799",
    "24E4CE47E8E2"
  ],
  [
    "KAON09004508",
    "1834AF5617B2"
  ],
  [
    "KAON0901D662",
    "24E4CE2E997A"
  ],
  [
    "KAON0901C7EE",
    "24E4CE2E25DA"
  ],
  [
    "KAON09010F9C",
    "1834AF5C6C52"
  ],
  [
    "KAON09006140",
    "1834AF56F972"
  ],
  [
    "KAON09005133",
    "1834AF56790A"
  ],
  [
    "KAON09015483",
    "1834AF5E938A"
  ],
  [
    "KAON09013256",
    "1834AF5D8222"
  ],
  [
    "KAON090184C4",
    "1834AFB2D171"
  ],
  [
    "KAON09018C70",
    "1834AFB30ED1"
  ],
  [
    "KAON09002746",
    "1834AF53343A"
  ],
  [
    "KAON0900B167",
    "1834AF597AAA"
  ],
  [
    "KAON090087D3",
    "1834AF582E0A"
  ],
  [
    "KAON09010F14",
    "1834AF5C6812"
  ],
  [
    "KAON09000D7F",
    "1834AF526602"
  ],
  [
    "KAON09009D5F",
    "1834AF58DA6A"
  ],
  [
    "KAON09023E94",
    "24E4CE48A0BA"
  ],
  [
    "KAON09008671",
    "1834AF5822FA"
  ],
  [
    "KAON09015C67",
    "1834AF5ED2AA"
  ],
  [
    "KAON0901E687",
    "24E4CE2F1AA2"
  ],
  [
    "KAON09028DF2",
    "24E4CEEA463D"
  ],
  [
    "KAON09008874",
    "1834AF583312"
  ],
  [
    "KAON0900F99F",
    "1834AF5BBC6A"
  ],
  [
    "KAON09002B35",
    "1834AF5353B2"
  ],
  [
    "KAON09019A92",
    "1834AFB37FE1"
  ],
  [
    "KAON09007700",
    "1834AF57A772"
  ],
  [
    "KAON0900AD8F",
    "1834AF595BEA"
  ],
  [
    "KAON09010A27",
    "1834AF5C40AA"
  ],
  [
    "KAON09000CF6",
    "1834AF5261BA"
  ],
  [
    "KAON090283D7",
    "24E4CE8B5860"
  ],
  [
    "KAON09009596",
    "1834AF589C22"
  ],
  [
    "KAON09011FB4",
    "1834AF5CED12"
  ],
  [
    "KAON0900A7B5",
    "1834AF592D1A"
  ],
  [
    "KAON09003404",
    "1834AF539A2A"
  ],
  [
    "KAON0902A94A",
    "24E4CEEB20FD"
  ],
  [
    "KAON0900A76C",
    "1834AF592AD2"
  ],
  [
    "KAON090091E3",
    "1834AF587E8A"
  ],
  [
    "KAON090050F2",
    "1834AF567702"
  ],
  [
    "KAON09003C8F",
    "1834AF53DE82"
  ],
  [
    "KAON0900410F",
    "1834AF540282"
  ],
  [
    "KAON0901F5A5",
    "24E4CE465942"
  ],
  [
    "KAON09018705",
    "1834AFB2E379"
  ],
  [
    "KAON0901B8C9",
    "24E4CE2DACB2"
  ],
  [
    "KAON0900A4CF",
    "1834AF5915EA"
  ],
  [
    "KAON09014BA5",
    "1834AF5E4C9A"
  ],
  [
    "KAON090160C8",
    "1834AF5EF0D2"
  ],
  [
    "KAON09006385",
    "1834AF570B9A"
  ],
  [
    "KAON090042FE",
    "1834AF5411FA"
  ],
  [
    "KAON090097B5",
    "1834AF58AD1A"
  ],
  [
    "KAON09011769",
    "1834AF5CAABA"
  ],
  [
    "KAON0901C136",
    "24E4CE2DF01A"
  ],
  [
    "KAON09009D8B",
    "1834AF58DBCA"
  ],
  [
    "KAON0900F596",
    "1834AF5B9C22"
  ],
  [
    "KAON090191F1",
    "1834AFB33AD9"
  ],
  [
    "KAON0901F1DE",
    "24E4CE2F755A"
  ],
  [
    "KAON09005AC4",
    "1834AF56C592"
  ],
  [
    "KAON09020FAA",
    "24E4CE47296A"
  ],
  [
    "KAON0902194B",
    "24E4CE477672"
  ],
  [
    "KAON0902AAB1",
    "24E4CEEB2C35"
  ],
  [
    "KAON090288EF",
    "24E4CE8B8120"
  ],
  [
    "KAON090049EA",
    "1834AF563EC2"
  ],
  [
    "KAON09006858",
    "1834AF573232"
  ],
  [
    "KAON09022FA8",
    "24E4CE48295A"
  ],
  [
    "KAON0901D523",
    "24E4CE2E8F82"
  ],
  [
    "KAON0901252D",
    "1834AF5D18DA"
  ],
  [
    "KAON0901CEDB",
    "24E4CE2E5D42"
  ],
  [
    "KAON0901B593",
    "24E4CE2D9302"
  ],
  [
    "KAON0901ED80",
    "24E4CE2F526A"
  ],
  [
    "KAON090047CC",
    "1834AF562DD2"
  ],
  [
    "KAON0902A40A",
    "24E4CEEAF6FD"
  ],
  [
    "KAON09007C6F",
    "1834AF57D2EA"
  ],
  [
    "KAON09006C8E",
    "1834AF5753E2"
  ],
  [
    "KAON09012451",
    "1834AF5D11FA"
  ],
  [
    "KAON090055ED",
    "1834AF569EDA"
  ],
  [
    "KAON09029122",
    "24E4CEEA5FBD"
  ],
  [
    "KAON090225BA",
    "24E4CE47D9EA"
  ],
  [
    "KAON09009772",
    "1834AF58AB02"
  ],
  [
    "KAON09008F88",
    "1834AF586BB2"
  ],
  [
    "KAON09017394",
    "1834AF5F8C12"
  ],
  [
    "KAON0900B71A",
    "1834AF59A842"
  ],
  [
    "KAON0901CDC1",
    "24E4CE2E5472"
  ],
  [
    "KAON0901F96F",
    "24E4CE467792"
  ],
  [
    "KAON09004AF3",
    "1834AF56470A"
  ],
  [
    "KAON0902419D",
    "24E4CE48B902"
  ],
  [
    "KAON090251F7",
    "24E4CE89C960"
  ],
  [
    "KAON09005725",
    "1834AF56A89A"
  ],
  [
    "KAON09003D64",
    "1834AF53E52A"
  ],
  [
    "KAON090185BE",
    "1834AFB2D941"
  ],
  [
    "KAON09018B8D",
    "1834AFB307B9"
  ],
  [
    "KAON0902A708",
    "24E4CEEB0EED"
  ],
  [
    "KAON09007598",
    "1834AF579C32"
  ],
  [
    "KAON09003AA0",
    "1834AF53CF0A"
  ],
  [
    "KAON0900942A",
    "1834AF5890C2"
  ],
  [
    "KAON0901AF32",
    "24E4CE2D240E"
  ],
  [
    "KAON090128FC",
    "1834AF5D3752"
  ],
  [
    "KAON09024B92",
    "24E4CE899638"
  ],
  [
    "KAON090023DF",
    "1834AF531902"
  ],
  [
    "KAON09026AA8",
    "24E4CE8A8EE8"
  ],
  [
    "KAON09022ADA",
    "24E4CE4802EA"
  ],
  [
    "KAON0900BBE3",
    "1834AF59CE8A"
  ],
  [
    "KAON09023840",
    "24E4CE486E1A"
  ],
  [
    "KAON090043F4",
    "1834AF5419AA"
  ],
  [
    "KAON09013770",
    "1834AF5DAAF2"
  ],
  [
    "KAON09021B3D",
    "24E4CE478602"
  ],
  [
    "KAON09025EF7",
    "24E4CE8A3160"
  ],
  [
    "KAON09007B02",
    "1834AF57C782"
  ],
  [
    "KAON09000F94",
    "1834AF5276AA"
  ],
  [
    "KAON09006B00",
    "1834AF574772"
  ],
  [
    "KAON0901194D",
    "1834AF5CB9DA"
  ],
  [
    "KAON09008CC3",
    "1834AF58558A"
  ],
  [
    "KAON090150B6",
    "1834AF5E7522"
  ],
  [
    "KAON090123B2",
    "1834AF5D0D02"
  ],
  [
    "KAON09003AE2",
    "1834AF53D11A"
  ],
  [
    "KAON0902044F",
    "24E4CE46CE92"
  ],
  [
    "KAON09001863",
    "1834AF52BD22"
  ],
  [
    "KAON09005405",
    "1834AF568F9A"
  ],
  [
    "KAON0900140E",
    "1834AF529A7A"
  ],
  [
    "KAON09023335",
    "24E4CE4845C2"
  ],
  [
    "KAON0900AAAC",
    "1834AF5944D2"
  ],
  [
    "KAON09011ADA",
    "1834AF5CC642"
  ],
  [
    "KAON0901775A",
    "1834AF5FAA42"
  ],
  [
    "KAON09012D7F",
    "1834AF5D5B6A"
  ],
  [
    "KAON0900E1A2",
    "1834AF5AFC82"
  ],
  [
    "KAON09007868",
    "1834AF57B2B2"
  ],
  [
    "KAON090242DA",
    "24E4CE48C2EA"
  ],
  [
    "KAON09004D7F",
    "1834AF565B6A"
  ],
  [
    "KAON0901302F",
    "1834AF5D70EA"
  ],
  [
    "KAON0901E18F",
    "24E4CE2EF2E2"
  ],
  [
    "KAON090136DC",
    "1834AF5DA652"
  ],
  [
    "KAON090147CC",
    "1834AF5E2DD2"
  ],
  [
    "KAON090184E0",
    "1834AFB2D251"
  ],
  [
    "KAON09011C7C",
    "1834AF5CD352"
  ],
  [
    "KAON0900498C",
    "1834AF563BD2"
  ],
  [
    "KAON09004CA2",
    "1834AF565482"
  ],
  [
    "KAON09019C60",
    "1834AFB38E51"
  ],
  [
    "KAON0900AC30",
    "1834AF5950F2"
  ],
  [
    "KAON0901934C",
    "1834AFB345B1"
  ],
  [
    "KAON09012829",
    "1834AF5D30BA"
  ],
  [
    "KAON090278DE",
    "24E4CE8B0098"
  ],
  [
    "KAON0902B257",
    "24E4CEEB6965"
  ],
  [
    "KAON09017942",
    "1834AF5FB982"
  ],
  [
    "KAON09015FFF",
    "1834AF5EEF6A"
  ],
  [
    "KAON0900F0B7",
    "1834AF5B752A"
  ],
  [
    "KAON0901848F",
    "1834AFB2CFC9"
  ],
  [
    "KAON09019361",
    "1834AFB34659"
  ],
  [
    "KAON09027988",
    "24E4CE8B05E8"
  ],
  [
    "KAON0901F154",
    "24E4CE2F710A"
  ],
  [
    "KAON0900259A",
    "1834AF5326DA"
  ],
  [
    "KAON09014C47",
    "1834AF5E51AA"
  ],
  [
    "KAON090190D3",
    "1834AFB331E9"
  ],
  [
    "KAON09025521",
    "24E4CE89E2B0"
  ],
  [
    "KAON0901F229",
    "24E4CE2F77B2"
  ],
  [
    "KAON09028E3D",
    "24E4CEEA4895"
  ],
  [
    "KAON09005728",
    "1834AF56A8B2"
  ],
  [
    "KAON09012CEA",
    "1834AF5D56C2"
  ],
  [
    "KAON09021BBD",
    "24E4CE478A02"
  ],
  [
    "KAON090003D2",
    "1834AF17C486"
  ],
  [
    "KAON090037FA",
    "1834AF53B9DA"
  ],
  [
    "KAON09007FF9",
    "1834AF57EF3A"
  ],
  [
    "KAON09024D2A",
    "24E4CE89A2F8"
  ],
  [
    "KAON0901212E",
    "1834AF5CF8E2"
  ],
  [
    "KAON09020836",
    "24E4CE46EDCA"
  ],
  [
    "KAON090079C6",
    "1834AF57BDA2"
  ],
  [
    "KAON0902A571",
    "24E4CEEB0235"
  ],
  [
    "KAON09012620",
    "1834AF5D2072"
  ],
  [
    "KAON0901DAC2",
    "24E4CE2EBC7A"
  ],
  [
    "KAON090070E4",
    "1834AF577692"
  ],
  [
    "KAON0900D81A",
    "1834AF5AB042"
  ],
  [
    "KAON09018B88",
    "1834AFB30791"
  ],
  [
    "KAON09022174",
    "24E4CE47B7BA"
  ],
  [
    "KAON0901157A",
    "1834AF5C9B42"
  ],
  [
    "KAON0901540F",
    "1834AF5E8FEA"
  ],
  [
    "KAON0901AFF7",
    "24E4CE2D2A36"
  ],
  [
    "KAON09021333",
    "24E4CE4745B2"
  ],
  [
    "KAON09000842",
    "1834AF54301A"
  ],
  [
    "KAON09004E6E",
    "1834AF5662E2"
  ],
  [
    "KAON09000C6D",
    "1834AF525D72"
  ],
  [
    "KAON09008ECB",
    "1834AF5865CA"
  ],
  [
    "KAON0902509A",
    "24E4CE89BE78"
  ],
  [
    "KAON09014C28",
    "1834AF5E50B2"
  ],
  [
    "KAON090156E6",
    "1834AF5EA6A2"
  ],
  [
    "KAON09023344",
    "24E4CE48463A"
  ],
  [
    "KAON09014D65",
    "1834AF5E5A9A"
  ],
  [
    "KAON0901FAB7",
    "24E4CE4681D2"
  ],
  [
    "KAON09004888",
    "1834AF5633B2"
  ],
  [
    "KAON0901AEBC",
    "24E4CE2D205E"
  ],
  [
    "KAON09008CAB",
    "1834AF5854CA"
  ],
  [
    "KAON09023E4C",
    "24E4CE489E7A"
  ],
  [
    "KAON09027C39",
    "24E4CE8B1B70"
  ],
  [
    "KAON09000C19",
    "1834AF525AD2"
  ],
  [
    "KAON09011847",
    "1834AF5CB1AA"
  ],
  [
    "KAON090020B3",
    "1834AF52FFA2"
  ],
  [
    "KAON09004CB4",
    "1834AF565512"
  ],
  [
    "KAON0902058A",
    "24E4CE46D86A"
  ],
  [
    "KAON0901C214",
    "24E4CE2DF70A"
  ],
  [
    "KAON090009BD",
    "1834AF5247F2"
  ],
  [
    "KAON090246A9",
    "24E4CE896EF0"
  ],
  [
    "KAON0900BA79",
    "1834AF59C33A"
  ],
  [
    "KAON090049B3",
    "1834AF563D0A"
  ],
  [
    "KAON0901ACC7",
    "24E4CE2D10B6"
  ],
  [
    "KAON09017817",
    "1834AF5FB02A"
  ],
  [
    "KAON0900AD88",
    "1834AF595BB2"
  ],
  [
    "KAON09005259",
    "1834AF56823A"
  ],
  [
    "KAON09014068",
    "1834AF5DF2B2"
  ],
  [
    "KAON0900ECB0",
    "1834AF5B54F2"
  ],
  [
    "KAON09009E04",
    "1834AF58DF92"
  ],
  [
    "KAON090122DA",
    "1834AF5D0642"
  ],
  [
    "KAON09009428",
    "1834AF5890B2"
  ],
  [
    "KAON09025E2E",
    "24E4CE8A2B18"
  ],
  [
    "KAON0901605D",
    "1834AF5EF25A"
  ],
  [
    "KAON09025357",
    "24E4CE89D460"
  ],
  [
    "KAON09008342",
    "1834AF580982"
  ],
  [
    "KAON0900B2D5",
    "1834AF59861A"
  ],
  [
    "KAON0901A4C8",
    "1834AFB3D191"
  ],
  [
    "KAON090166BD",
    "1834AF5F255A"
  ],
  [
    "KAON0900DCA6",
    "1834AF5AD4A2"
  ],
  [
    "KAON09024CD8",
    "24E4CE89A068"
  ],
  [
    "KAON090272C6",
    "24E4CE8ACFD8"
  ],
  [
    "KAON0901F2A7",
    "24E4CE2F7BA2"
  ],
  [
    "KAON09014EBB",
    "1834AF5E654A"
  ],
  [
    "KAON0901AF50",
    "24E4CE2D24FE"
  ],
  [
    "KAON0902499E",
    "24E4CE898698"
  ],
  [
    "KAON09024004",
    "24E4CE48AC3A"
  ],
  [
    "KAON09001748",
    "1834AF52B44A"
  ],
  [
    "KAON0902554D",
    "24E4CE89E410"
  ],
  [
    "KAON0901D3EA",
    "24E4CE2E85BA"
  ],
  [
    "KAON09003B8B",
    "1834AF53D662"
  ],
  [
    "KAON0901FE44",
    "24E4CE469E3A"
  ],
  [
    "KAON0901D5BE",
    "24E4CE2E945A"
  ],
  [
    "KAON09001412",
    "1834AF529A9A"
  ],
  [
    "KAON0901991C",
    "1834AFB37431"
  ],
  [
    "KAON09007282",
    "1834AF578382"
  ],
  [
    "KAON090298AF",
    "24E4CEEA9C25"
  ],
  [
    "KAON0900C39F",
    "1834AF5A0C6A"
  ],
  [
    "KAON09020D15",
    "24E4CE4714C2"
  ],
  [
    "KAON090112A3",
    "1834AF5C848A"
  ],
  [
    "KAON09023498",
    "24E4CE4850DA"
  ],
  [
    "KAON090052DA",
    "1834AF568642"
  ],
  [
    "KAON0900AAE4",
    "1834AF594692"
  ],
  [
    "KAON090138FE",
    "1834AF5DB762"
  ],
  [
    "KAON0901F22E",
    "24E4CE2F77DA"
  ],
  [
    "KAON0900F3D1",
    "1834AF5B8DFA"
  ],
  [
    "KAON09028856",
    "24E4CE8B7C58"
  ],
  [
    "KAON0900B407",
    "1834AF598FAA"
  ],
  [
    "KAON09024572",
    "24E4CE896538"
  ],
  [
    "KAON09024043",
    "24E4CE48AE32"
  ],
  [
    "KAON0900DC12",
    "1834AF5AD002"
  ],
  [
    "KAON090172E4",
    "1834AF5F8692"
  ],
  [
    "KAON09013EAD",
    "1834AF5DE4DA"
  ],
  [
    "KAON09017A84",
    "1834AF5FC392"
  ],
  [
    "KAON0900F889",
    "1834AF5BB3BA"
  ],
  [
    "KAON09009AA2",
    "1834AF58C482"
  ],
  [
    "KAON090040B8",
    "1834AF53FFCA"
  ],
  [
    "KAON0901A9F6",
    "24E4CE2CFA2E"
  ],
  [
    "KAON090016EE",
    "1834AF52B17A"
  ],
  [
    "KAON09024513",
    "24E4CE896240"
  ],
  [
    "KAON09021DE5",
    "24E4CE479B42"
  ],
  [
    "KAON09000EB6",
    "1834AF526FBA"
  ],
  [
    "KAON0901B776",
    "24E4CE2DA21A"
  ],
  [
    "KAON09024971",
    "24E4CE898530"
  ],
  [
    "KAON0900097A",
    "1834AF5245DA"
  ],
  [
    "KAON09007BDD",
    "1834AF57CE5A"
  ],
  [
    "KAON090247F3",
    "24E4CE897940"
  ],
  [
    "KAON090200B6",
    "24E4CE46B1CA"
  ],
  [
    "KAON09019256",
    "1834AFB33F79"
  ],
  [
    "KAON0901FD66",
    "24E4CE46974A"
  ],
  [
    "KAON09005C2C",
    "1834AF56D0D2"
  ],
  [
    "KAON090200FD",
    "24E4CE46B402"
  ],
  [
    "KAON0900D3EE",
    "1834AF5A8EE2"
  ],
  [
    "KAON090198CC",
    "1834AFB371B1"
  ],
  [
    "KAON09019515",
    "1834AFB353F9"
  ],
  [
    "KAON0901C58D",
    "24E4CE2E12D2"
  ],
  [
    "KAON09016DEC",
    "1834AF5F5ED2"
  ],
  [
    "KAON09020E9A",
    "24E4CE4720EA"
  ],
  [
    "KAON0901F3A1",
    "24E4CE2F8372"
  ],
  [
    "KAON0900F5F4",
    "1834AF5B9F12"
  ],
  [
    "KAON09019C3F",
    "1834AFB38D49"
  ],
  [
    "KAON09025115",
    "24E4CE89C250"
  ],
  [
    "KAON0902A4B0",
    "24E4CEEAFC2D"
  ],
  [
    "KAON090036EA",
    "1834AF53B15A"
  ],
  [
    "KAON0901E0C9",
    "24E4CE2EECB2"
  ],
  [
    "KAON09029E48",
    "24E4CEEAC8ED"
  ],
  [
    "KAON09029783",
    "24E4CEEA92C5"
  ],
  [
    "KAON090267AD",
    "24E4CE8A7710"
  ],
  [
    "KAON090160F5",
    "1834AF5EF71A"
  ],
  [
    "KAON09002FCC",
    "1834AF53786A"
  ],
  [
    "KAON0900DB21",
    "1834AF5AC87A"
  ],
  [
    "KAON0900D4B1",
    "1834AF5A94FA"
  ],
  [
    "KAON0900E148",
    "1834AF5AF9B2"
  ],
  [
    "KAON0900EED0",
    "1834AF5B65F2"
  ],
  [
    "KAON09005F33",
    "1834AF56E90A"
  ],
  [
    "KAON0901FC86",
    "24E4CE46904A"
  ],
  [
    "KAON0900CED5",
    "1834AF5A661A"
  ],
  [
    "KAON09009B79",
    "1834AF58CB3A"
  ],
  [
    "KAON0900E8D7",
    "1834AF5B362A"
  ],
  [
    "KAON0901851A",
    "1834AFB2D421"
  ],
  [
    "KAON090045C9",
    "1834AF561DBA"
  ],
  [
    "KAON090011B2",
    "1834AF52879A"
  ],
  [
    "KAON0901DEEC",
    "24E4CE2EDDCA"
  ],
  [
    "KAON090210FB",
    "24E4CE4733F2"
  ],
  [
    "KAON09013139",
    "1834AF5D793A"
  ],
  [
    "KAON0901CF18",
    "24E4CE2E5F2A"
  ],
  [
    "KAON0901AD40",
    "24E4CE2D147E"
  ],
  [
    "KAON0901EE10",
    "24E4CE2F56EA"
  ],
  [
    "KAON09024F23",
    "24E4CE89B2C0"
  ],
  [
    "KAON09015E4B",
    "1834AF5EE1CA"
  ],
  [
    "KAON09020E02",
    "24E4CE471C2A"
  ],
  [
    "KAON090274BD",
    "24E4CE8ADF90"
  ],
  [
    "KAON0900FEA7",
    "1834AF5BE4AA"
  ],
  [
    "KAON0901BA7C",
    "24E4CE2DBA4A"
  ],
  [
    "KAON09000181",
    "1834AF17B1FE"
  ],
  [
    "KAON0902824A",
    "24E4CE8B4BF8"
  ],
  [
    "KAON09016283",
    "1834AF5F038A"
  ],
  [
    "KAON09017C47",
    "1834AF5FD1AA"
  ],
  [
    "KAON090026F0",
    "1834AF53318A"
  ],
  [
    "KAON09008CA0",
    "1834AF585472"
  ],
  [
    "KAON0901D8B8",
    "24E4CE2EAC2A"
  ],
  [
    "KAON0900C088",
    "1834AF59F3B2"
  ],
  [
    "KAON090018E3",
    "1834AF52C122"
  ],
  [
    "KAON09014153",
    "1834AF5DFA0A"
  ],
  [
    "KAON09005E46",
    "1834AF56E1A2"
  ],
  [
    "KAON0901385E",
    "1834AF5DB262"
  ],
  [
    "KAON0901F7BF",
    "24E4CE466A12"
  ],
  [
    "KAON09000525",
    "1834AF17CF1E"
  ],
  [
    "KAON0901A4C7",
    "1834AFB3D189"
  ],
  [
    "KAON09006AD9",
    "1834AF57463A"
  ],
  [
    "KAON09000E3A",
    "1834AF526BDA"
  ],
  [
    "KAON09006023",
    "1834AF56F08A"
  ],
  [
    "KAON0900479F",
    "1834AF562C6A"
  ],
  [
    "KAON090192E5",
    "1834AFB34279"
  ],
  [
    "KAON090027FD",
    "1834AF5339F2"
  ],
  [
    "KAON0901FF5B",
    "24E4CE46A6F2"
  ],
  [
    "KAON09007420",
    "1834AF579072"
  ],
  [
    "KAON090272AD",
    "24E4CE8ACF10"
  ],
  [
    "KAON09020F4D",
    "24E4CE472682"
  ],
  [
    "KAON0900ED9A",
    "1834AF5B5C42"
  ],
  [
    "KAON0902B118",
    "24E4CEEB5F6D"
  ],
  [
    "KAON0901E8A2",
    "24E4CE2F2B7A"
  ],
  [
    "KAON090223E5",
    "24E4CE47CB42"
  ],
  [
    "KAON09020DE8",
    "24E4CE471B5A"
  ],
  [
    "KAON09012AB9",
    "1834AF5D453A"
  ],
  [
    "KAON0900711B",
    "1834AF57784A"
  ],
  [
    "KAON0900C7CE",
    "1834AF5A2DE2"
  ],
  [
    "KAON09010281",
    "1834AF5C037A"
  ],
  [
    "KAON0901021C",
    "1834AF5C0052"
  ],
  [
    "KAON0902B8CB",
    "24E4CEEFB93E"
  ],
  [
    "KAON09005700",
    "1834AF56A772"
  ],
  [
    "KAON0901881C",
    "1834AFB2EC31"
  ],
  [
    "KAON09006EFB",
    "1834AF57674A"
  ],
  [
    "KAON09018FB1",
    "1834AFB328D9"
  ],
  [
    "KAON0900C67A",
    "1834AF5A2342"
  ],
  [
    "KAON0902A164",
    "24E4CEEAE1CD"
  ],
  [
    "KAON090287FB",
    "24E4CE8B7980"
  ],
  [
    "KAON0900E4BD",
    "1834AF5B155A"
  ],
  [
    "KAON0901F09E",
    "24E4CE2F6B5A"
  ],
  [
    "KAON09013A5D",
    "1834AF5DC25A"
  ],
  [
    "KAON09004462",
    "1834AF561282"
  ],
  [
    "KAON090115F3",
    "1834AF5C9F0A"
  ],
  [
    "KAON090272AC",
    "24E4CE8ACF08"
  ],
  [
    "KAON0900B0ED",
    "1834AF5976DA"
  ],
  [
    "KAON0901CDA1",
    "24E4CE2E5372"
  ],
  [
    "KAON09014793",
    "1834AF5E2C0A"
  ],
  [
    "KAON090288C5",
    "24E4CE8B7FD0"
  ],
  [
    "KAON09028823",
    "24E4CE8B7AC0"
  ],
  [
    "KAON090057D3",
    "1834AF56AE0A"
  ],
  [
    "KAON0902019D",
    "24E4CE46B902"
  ],
  [
    "KAON0902A563",
    "24E4CEEB01C5"
  ],
  [
    "KAON09007ECE",
    "1834AF57E5E2"
  ],
  [
    "KAON09026FB6",
    "24E4CE8AB758"
  ],
  [
    "KAON09017E79",
    "1834AFB29F19"
  ],
  [
    "KAON090201B1",
    "24E4CE46B9A2"
  ],
  [
    "KAON09023952",
    "24E4CE4876AA"
  ],
  [
    "KAON09028C21",
    "24E4CEEA37B5"
  ],
  [
    "KAON0901E196",
    "24E4CE2EF31A"
  ],
  [
    "KAON09003D40",
    "1834AF53E40A"
  ],
  [
    "KAON090140B7",
    "1834AF5DF52A"
  ],
  [
    "KAON09011F49",
    "1834AF5CE9BA"
  ],
  [
    "KAON09019D01",
    "1834AFB39359"
  ],
  [
    "KAON090237F6",
    "24E4CE486BCA"
  ],
  [
    "KAON09018E99",
    "1834AFB32019"
  ],
  [
    "KAON09024F92",
    "24E4CE89B638"
  ],
  [
    "KAON09012420",
    "1834AF5D1072"
  ],
  [
    "KAON09024542",
    "24E4CE8963B8"
  ],
  [
    "KAON0900E813",
    "1834AF5B300A"
  ],
  [
    "KAON0900256B",
    "1834AF532562"
  ],
  [
    "KAON0900E76E",
    "1834AF5B2AE2"
  ],
  [
    "KAON0900E3CF",
    "1834AF5B0DEA"
  ],
  [
    "KAON0902A4C9",
    "24E4CEEAFCF5"
  ],
  [
    "KAON09008324",
    "1834AF580892"
  ],
  [
    "KAON090042EC",
    "1834AF54116A"
  ],
  [
    "KAON0900C8A4",
    "1834AF5A3492"
  ],
  [
    "KAON09029DA9",
    "24E4CEEAC3F5"
  ],
  [
    "KAON09022537",
    "24E4CE47D5D2"
  ],
  [
    "KAON0901E930",
    "24E4CE2F2FEA"
  ],
  [
    "KAON0901D428",
    "24E4CE2E87AA"
  ],
  [
    "KAON0901CD33",
    "24E4CE2E5002"
  ],
  [
    "KAON0901D215",
    "24E4CE2E7712"
  ],
  [
    "KAON0900857B",
    "1834AF581B4A"
  ],
  [
    "KAON090234E0",
    "24E4CE48531A"
  ],
  [
    "KAON0901FD21",
    "24E4CE469522"
  ],
  [
    "KAON09014A4A",
    "1834AF5E41C2"
  ],
  [
    "KAON09005EAF",
    "1834AF56E4EA"
  ],
  [
    "KAON09029171",
    "24E4CEEA6235"
  ],
  [
    "KAON09025FF3",
    "24E4CE8A3940"
  ],
  [
    "KAON0900EB5E",
    "1834AF5B4A62"
  ],
  [
    "KAON0901DFA4",
    "24E4CE2EE38A"
  ],
  [
    "KAON0902845F",
    "24E4CE8B5CA0"
  ],
  [
    "KAON09029E2E",
    "24E4CEEAC81D"
  ],
  [
    "KAON0901F81F",
    "24E4CE466D12"
  ],
  [
    "KAON09019BF6",
    "1834AFB38B01"
  ],
  [
    "KAON0901D9C8",
    "24E4CE2EB4AA"
  ],
  [
    "KAON0900EF54",
    "1834AF5B6A12"
  ],
  [
    "KAON09027DA6",
    "24E4CE8B26D8"
  ],
  [
    "KAON09023438",
    "24E4CE484DDA"
  ],
  [
    "KAON0901E6D1",
    "24E4CE2F1CF2"
  ],
  [
    "KAON09012523",
    "1834AF5D188A"
  ],
  [
    "KAON0900453D",
    "1834AF56195A"
  ],
  [
    "KAON0901A87D",
    "24E4CE2CEE66"
  ],
  [
    "KAON09023E36",
    "24E4CE489DCA"
  ],
  [
    "KAON0901D289",
    "24E4CE2E7AB2"
  ],
  [
    "KAON09029ACC",
    "24E4CEEAAD0D"
  ],
  [
    "KAON0901BC63",
    "24E4CE2DC982"
  ],
  [
    "KAON09000880",
    "1834AF54320A"
  ],
  [
    "KAON0900BBDB",
    "1834AF59CE4A"
  ],
  [
    "KAON0901E134",
    "24E4CE2EF00A"
  ],
  [
    "KAON09012789",
    "1834AF5D2BBA"
  ],
  [
    "KAON09029063",
    "24E4CEEA59C5"
  ],
  [
    "KAON090102C8",
    "1834AF5C05B2"
  ],
  [
    "KAON09019C6B",
    "1834AFB38EA9"
  ],
  [
    "KAON09028A80",
    "24E4CE8B8DA8"
  ],
  [
    "KAON0901E25C",
    "24E4CE2EF94A"
  ],
  [
    "KAON0901133D",
    "1834AF5C895A"
  ],
  [
    "KAON09010F7C",
    "1834AF5C6B52"
  ],
  [
    "KAON0901E5E4",
    "24E4CE2F158A"
  ],
  [
    "KAON0901DA76",
    "24E4CE2EBA1A"
  ],
  [
    "KAON0901E8E5",
    "24E4CE2F2D92"
  ],
  [
    "KAON0901A3EC",
    "1834AFB3CAB1"
  ],
  [
    "KAON0900D06C",
    "1834AF5A72D2"
  ],
  [
    "KAON0900D4B2",
    "1834AF5A9502"
  ],
  [
    "KAON0901DC75",
    "24E4CE2ECA12"
  ],
  [
    "KAON0901F634",
    "24E4CE465DBA"
  ],
  [
    "KAON090009F3",
    "1834AF5249A2"
  ],
  [
    "KAON09009803",
    "1834AF58AF8A"
  ],
  [
    "KAON0901DC60",
    "24E4CE2EC96A"
  ],
  [
    "KAON0901733D",
    "1834AF5F895A"
  ],
  [
    "KAON0901ED11",
    "24E4CE2F4EF2"
  ],
  [
    "KAON0900D433",
    "1834AF5A910A"
  ],
  [
    "KAON090216D3",
    "24E4CE4762B2"
  ],
  [
    "KAON09019D2F",
    "1834AFB394C9"
  ],
  [
    "KAON09014986",
    "1834AF5E3BA2"
  ],
  [
    "KAON09021348",
    "24E4CE47465A"
  ],
  [
    "KAON09004439",
    "1834AF56113A"
  ],
  [
    "KAON0900EA23",
    "1834AF5B408A"
  ],
  [
    "KAON0901C5F3",
    "24E4CE2E1602"
  ],
  [
    "KAON0901AC0A",
    "24E4CE2D0ACE"
  ],
  [
    "KAON09003BFB",
    "1834AF53D9E2"
  ],
  [
    "KAON0902AE7A",
    "24E4CEEB4A7D"
  ],
  [
    "KAON0902B2FE",
    "24E4CEEF8AD6"
  ],
  [
    "KAON0901C4A8",
    "24E4CE2E0BAA"
  ],
  [
    "KAON09020F82",
    "24E4CE47282A"
  ],
  [
    "KAON09028AEC",
    "24E4CE8B9108"
  ],
  [
    "KAON09005C73",
    "1834AF56D30A"
  ],
  [
    "KAON0901B070",
    "24E4CE2D2DFE"
  ],
  [
    "KAON0901AED9",
    "24E4CE2D2146"
  ],
  [
    "KAON0900B57B",
    "1834AF599B4A"
  ],
  [
    "KAON0901AC14",
    "24E4CE2D0B1E"
  ],
  [
    "KAON090025D1",
    "1834AF532892"
  ],
  [
    "KAON0900518C",
    "1834AF567BD2"
  ],
  [
    "KAON09020FEF",
    "24E4CE472B92"
  ],
  [
    "KAON09006DB7",
    "1834AF575D2A"
  ],
  [
    "KAON09022FBF",
    "24E4CE482A12"
  ],
  [
    "KAON09021DEE",
    "24E4CE479B8A"
  ],
  [
    "KAON09022D24",
    "24E4CE48153A"
  ],
  [
    "KAON090075E3",
    "1834AF579E8A"
  ],
  [
    "KAON090049C2",
    "1834AF563D82"
  ],
  [
    "KAON09014D81",
    "1834AF5E5B7A"
  ],
  [
    "KAON0900D670",
    "1834AF5AA2F2"
  ],
  [
    "KAON0900BD63",
    "1834AF59DA8A"
  ],
  [
    "KAON0901FACB",
    "24E4CE468272"
  ],
  [
    "KAON0901F385",
    "24E4CE2F8292"
  ],
  [
    "KAON090276D6",
    "24E4CE8AF058"
  ],
  [
    "KAON09021894",
    "24E4CE4770BA"
  ],
  [
    "KAON0901900C",
    "1834AFB32BB1"
  ],
  [
    "KAON0901CF6E",
    "24E4CE2E61DA"
  ],
  [
    "KAON0902ACFF",
    "24E4CEEB3EA5"
  ],
  [
    "KAON090070D2",
    "1834AF577602"
  ],
  [
    "KAON0900C019",
    "1834AF59F03A"
  ],
  [
    "KAON09006E06",
    "1834AF575FA2"
  ],
  [
    "KAON09018E82",
    "1834AFB31F61"
  ],
  [
    "KAON0902276C",
    "24E4CE47E77A"
  ],
  [
    "KAON09022459",
    "24E4CE47CEE2"
  ],
  [
    "KAON0902ACD2",
    "24E4CEEB3D3D"
  ],
  [
    "KAON09012357",
    "1834AF5D0A2A"
  ],
  [
    "KAON09014C78",
    "1834AF5E5332"
  ],
  [
    "KAON09011D96",
    "1834AF5CDC22"
  ],
  [
    "KAON0902AC12",
    "24E4CEEB373D"
  ],
  [
    "KAON09017AFB",
    "1834AF5FC74A"
  ],
  [
    "KAON09008ADE",
    "1834AF584662"
  ],
  [
    "KAON09013844",
    "1834AF5DB192"
  ],
  [
    "KAON09006D7F",
    "1834AF575B6A"
  ],
  [
    "KAON090234E3",
    "24E4CE485332"
  ],
  [
    "KAON09011E8D",
    "1834AF5CE3DA"
  ],
  [
    "KAON0901C225",
    "24E4CE2DF792"
  ],
  [
    "KAON0901DEB1",
    "24E4CE2EDBF2"
  ],
  [
    "KAON09016402",
    "1834AF5F0F82"
  ],
  [
    "KAON0901E7AA",
    "24E4CE2F23BA"
  ],
  [
    "KAON0901AE5C",
    "1834AF5E0792"
  ],
  [
    "KAON0900F271",
    "1834AF5B82FA"
  ],
  [
    "KAON09016F37",
    "1834AF5F692A"
  ],
  [
    "KAON09001EBF",
    "1834AF52F002"
  ],
  [
    "KAON0901763D",
    "1834AF5FA15A"
  ],
  [
    "KAON0900C6AB",
    "1834AF5A24CA"
  ],
  [
    "KAON0901D47D",
    "24E4CE2E8A52"
  ],
  [
    "KAON090154A7",
    "1834AF5E94AA"
  ],
  [
    "KAON09007914",
    "1834AF57B812"
  ],
  [
    "KAON090216BE",
    "24E4CE47620A"
  ],
  [
    "KAON0901DFEB",
    "24E4CE2EE5C2"
  ],
  [
    "KAON0900EE7D",
    "1834AF5B635A"
  ],
  [
    "KAON0900ED0E",
    "1834AF5B57E2"
  ],
  [
    "KAON0902ADF3",
    "24E4CEEB4645"
  ],
  [
    "KAON09016970",
    "1834AF5F3AF2"
  ],
  [
    "KAON0901991A",
    "1834AFB37421"
  ],
  [
    "KAON09020A8B",
    "24E4CE470072"
  ],
  [
    "KAON09021FEB",
    "24E4CE47AB72"
  ],
  [
    "KAON0900AF13",
    "1834AF59680A"
  ],
  [
    "KAON0901BDB1",
    "24E4CE2DD3F2"
  ],
  [
    "KAON09014FCC",
    "1834AF5E6DD2"
  ],
  [
    "KAON09024595",
    "24E4CE896650"
  ],
  [
    "KAON09016318",
    "1834AF5F0832"
  ],
  [
    "KAON09024F87",
    "24E4CE89B5E0"
  ],
  [
    "KAON0901E432",
    "24E4CE2F07FA"
  ],
  [
    "KAON0900592D",
    "1834AF56B8DA"
  ],
  [
    "KAON09010DE2",
    "1834AF5C5E82"
  ],
  [
    "KAON09025EAD",
    "24E4CE8A2F10"
  ],
  [
    "KAON0900011E",
    "1834AF17AEE6"
  ],
  [
    "KAON09013FC6",
    "1834AF5DEDA2"
  ],
  [
    "KAON090220B8",
    "24E4CE47B1DA"
  ],
  [
    "KAON090079C2",
    "1834AF57BD82"
  ],
  [
    "KAON09014BC1",
    "1834AF5E4D7A"
  ],
  [
    "KAON09007850",
    "1834AF57B1F2"
  ],
  [
    "KAON090107FE",
    "1834AF5C2F62"
  ],
  [
    "KAON09014080",
    "1834AF5DF372"
  ],
  [
    "KAON09026D67",
    "24E4CE8AA4E0"
  ],
  [
    "KAON0900127F",
    "1834AF528E02"
  ],
  [
    "KAON0902808C",
    "24E4CE8B3E08"
  ],
  [
    "KAON090180A1",
    "1834AFB2B059"
  ],
  [
    "KAON0902B0F9",
    "24E4CEEB5E75"
  ],
  [
    "KAON090217DA",
    "24E4CE476AEA"
  ],
  [
    "KAON0900B17B",
    "1834AF597B4A"
  ],
  [
    "KAON0901AD8B",
    "24E4CE2D16D6"
  ],
  [
    "KAON0901CE3E",
    "24E4CE2E585A"
  ],
  [
    "KAON0900E74E",
    "1834AF5B29E2"
  ],
  [
    "KAON090257F0",
    "24E4CE89F928"
  ],
  [
    "KAON0901B21F",
    "24E4CE2D7762"
  ],
  [
    "KAON0900F4BE",
    "1834AF5B9562"
  ],
  [
    "KAON0900D125",
    "1834AF5A789A"
  ],
  [
    "KAON09027E68",
    "24E4CE8B2CE8"
  ],
  [
    "KAON090128C8",
    "1834AF5D35B2"
  ],
  [
    "KAON090272FA",
    "24E4CE8AD178"
  ],
  [
    "KAON090183B6",
    "1834AFB2C901"
  ],
  [
    "KAON0901EB36",
    "24E4CE2F401A"
  ],
  [
    "KAON0902481D",
    "24E4CE897A90"
  ],
  [
    "KAON090013F3",
    "1834AF5299A2"
  ],
  [
    "KAON0900015C",
    "1834AF17B0D6"
  ],
  [
    "KAON0901C005",
    "24E4CE2DE692"
  ],
  [
    "KAON0901E799",
    "24E4CE2F2332"
  ],
  [
    "KAON0901CDAB",
    "24E4CE2E53C2"
  ],
  [
    "KAON09016B07",
    "1834AF5F47AA"
  ],
  [
    "KAON0900BF24",
    "1834AF59E892"
  ],
  [
    "KAON0901C650",
    "24E4CE2E18EA"
  ],
  [
    "KAON0901EC2F",
    "24E4CE2F47E2"
  ],
  [
    "KAON09000335",
    "1834AF17BF9E"
  ],
  [
    "KAON09028EE8",
    "24E4CE47F38A"
  ],
  [
    "KAON09016DF3",
    "1834AF5F5F0A"
  ],
  [
    "KAON0900E00D",
    "1834AF5AEFDA"
  ],
  [
    "KAON0901791E",
    "1834AF5FB862"
  ],
  [
    "KAON09014A0B",
    "1834AF5E3FCA"
  ],
  [
    "KAON090132D5",
    "1834AF5D861A"
  ],
  [
    "KAON090276E7",
    "24E4CE8AF0E0"
  ],
  [
    "KAON0900BC8F",
    "1834AF59D3EA"
  ],
  [
    "KAON09025C0B",
    "24E4CE8A1A00"
  ],
  [
    "KAON09015040",
    "1834AF5E7172"
  ],
  [
    "KAON09028B6F",
    "24E4CE8B9520"
  ],
  [
    "KAON0900FA7E",
    "1834AF5BC362"
  ],
  [
    "KAON0902B7E5",
    "24E4CEEFB20E"
  ],
  [
    "KAON090029FA",
    "1834AF5349DA"
  ],
  [
    "KAON09028B9A",
    "24E4CEEA337D"
  ],
  [
    "KAON09020ACD",
    "24E4CE470282"
  ],
  [
    "KAON09002F9F",
    "1834AF537702"
  ],
  [
    "KAON09028040",
    "24E4CE8B3BA8"
  ],
  [
    "KAON09023A5A",
    "24E4CE487EEA"
  ],
  [
    "KAON09026DB4",
    "24E4CE8AA748"
  ],
  [
    "KAON0900011C",
    "1834AF17AED6"
  ],
  [
    "KAON09004999",
    "1834AF563C3A"
  ],
  [
    "KAON09012E8D",
    "1834AF5D63DA"
  ],
  [
    "KAON0900ACBF",
    "1834AF59556A"
  ],
  [
    "KAON09016035",
    "1834AF5EF11A"
  ],
  [
    "KAON090156E8",
    "1834AF5EA6B2"
  ],
  [
    "KAON090109E3",
    "1834AF5C3E8A"
  ],
  [
    "KAON09017E34",
    "1834AFB29Doc1"
  ],
  [
    "KAON0901CA63",
    "24E4CE2E3982"
  ],
  [
    "KAON09026928",
    "24E4CE8A82E8"
  ],
  [
    "KAON09011D62",
    "1834AF5CDA82"
  ],
  [
    "KAON090281EF",
    "24E4CE8B4920"
  ],
  [
    "KAON0900CB32",
    "1834AF5A4902"
  ],
  [
    "KAON0901A288",
    "1834AFB3BF91"
  ],
  [
    "KAON090233EC",
    "24E4CE484B7A"
  ],
  [
    "KAON09009FB4",
    "1834AF58ED12"
  ],
  [
    "KAON0900131D",
    "1834AF5292F2"
  ],
  [
    "KAON09016CFD",
    "1834AF5F575A"
  ],
  [
    "KAON09016C27",
    "1834AF5F50AA"
  ],
  [
    "KAON090223A5",
    "24E4CE47C942"
  ],
  [
    "KAON09024A51",
    "24E4CE898C30"
  ],
  [
    "KAON090287C4",
    "24E4CE8B77C8"
  ],
  [
    "KAON0901E04A",
    "24E4CE2EE8BA"
  ],
  [
    "KAON0900B4AC",
    "1834AF5994D2"
  ],
  [
    "KAON090012AF",
    "1834AF528F82"
  ],
  [
    "KAON0900A646",
    "1834AF5921A2"
  ],
  [
    "KAON0900657F",
    "1834AF5A295A"
  ],
  [
    "KAON0901C03F",
    "24E4CE2DE862"
  ],
  [
    "KAON0901A468",
    "1834AFB3CE91"
  ],
  [
    "KAON09015E89",
    "1834AF5EE3BA"
  ],
  [
    "KAON09025E83",
    "24E4CE8A2DC0"
  ],
  [
    "KAON0900E87F",
    "1834AF5B336A"
  ],
  [
    "KAON0901AA35",
    "24E4CE2CFC26"
  ],
  [
    "KAON09018EAA",
    "1834AFB320A1"
  ],
  [
    "KAON090040C2",
    "1834AF54001A"
  ],
  [
    "KAON090211B2",
    "24E4CE4739AA"
  ],
  [
    "KAON0901ADE9",
    "24E4CE2D19C6"
  ],
  [
    "KAON0901B407",
    "24E4CE2D86A2"
  ],
  [
    "KAON09027A0E",
    "24E4CE8B0A18"
  ],
  [
    "KAON0901BF1D",
    "24E4CE2DDF52"
  ],
  [
    "KAON0900ADAB",
    "1834AF595CCA"
  ],
  [
    "KAON09020ABC",
    "24E4CE4701FA"
  ],
  [
    "KAON09029C64",
    "24E4CEEAB9CD"
  ],
  [
    "KAON0901C776",
    "24E4CE2E221A"
  ],
  [
    "KAON09002B18",
    "1834AF5352CA"
  ],
  [
    "KAON09011D24",
    "1834AF5CD892"
  ],
  [
    "KAON09015795",
    "1834AF5EAC1A"
  ],
  [
    "KAON0900C62A",
    "1834AF5A20C2"
  ],
  [
    "KAON0901A103",
    "1834AFB3B369"
  ],
  [
    "KAON090215D1",
    "24E4CE475AA2"
  ],
  [
    "KAON0902A446",
    "24E4CEEAF8DD"
  ],
  [
    "KAON090199E3",
    "1834AFB37A69"
  ],
  [
    "KAON0902AEF6",
    "24E4CEEB4E5D"
  ],
  [
    "KAON09007B8F",
    "24E4CE4798A2"
  ],
  [
    "KAON0902268A",
    "24E4CE47E06A"
  ],
  [
    "KAON0902A939",
    "24E4CEEB2075"
  ],
  [
    "KAON0901EC24",
    "24E4CE2F478A"
  ],
  [
    "KAON0902AD97",
    "24E4CEEB4365"
  ],
  [
    "KAON09020A98",
    "24E4CE4700DA"
  ],
  [
    "KAON0902978C",
    "24E4CEEA930D"
  ],
  [
    "KAON09013BB9",
    "1834AF5DCD3A"
  ],
  [
    "KAON09029ECD",
    "24E4CEEACD15"
  ],
  [
    "KAON09022D94",
    "24E4CE4818BA"
  ],
  [
    "KAON0901CCBB",
    "24E4CE2E4C42"
  ],
  [
    "KAON09012388",
    "1834AF5D0BB2"
  ],
  [
    "KAON0902222F",
    "24E4CE47BD92"
  ],
  [
    "KAON09021116",
    "24E4CE4734CA"
  ],
  [
    "KAON0902B2A3",
    "24E4CEEF87FE"
  ],
  [
    "KAON09020560",
    "24E4CE46D71A"
  ],
  [
    "KAON090213B5",
    "24E4CE4749C2"
  ],
  [
    "KAON09008C38",
    "1834AF585132"
  ],
  [
    "KAON090084A2",
    "1834AF581482"
  ],
  [
    "KAON09004ADA",
    "1834AF564642"
  ],
  [
    "KAON0901FB5B",
    "24E4CE4686F2"
  ],
  [
    "KAON090247BE",
    "24E4CE897798"
  ],
  [
    "KAON0902ADCE",
    "24E4CEEB451D"
  ],
  [
    "KAON09017B92",
    "1834AF5FCC02"
  ],
  [
    "KAON0901E0C7",
    "24E4CE2EECA2"
  ],
  [
    "KAON0902A8EE",
    "24E4CEEB1E1D"
  ],
  [
    "KAON09019058",
    "1834AFB32E11"
  ],
  [
    "KAON09020CA5",
    "24E4CE471142"
  ],
  [
    "KAON09019E20",
    "1834AFB39C51"
  ],
  [
    "KAON09017B99",
    "1834AF5FCC3A"
  ],
  [
    "KAON09021EF9",
    "24E4CE47A3E2"
  ],
  [
    "KAON0901BCCA",
    "24E4CE2DCCBA"
  ],
  [
    "KAON0901250F",
    "1834AF5D17EA"
  ],
  [
    "KAON090290B5",
    "24E4CEEA5C55"
  ],
  [
    "KAON090275FA",
    "24E4CE8AE978"
  ],
  [
    "KAON090100D2",
    "1834AF5BF602"
  ],
  [
    "KAON090275F1",
    "24E4CE8AE930"
  ],
  [
    "KAON0900386E",
    "1834AF53BD7A"
  ],
  [
    "KAON09027D8E",
    "24E4CE8B2618"
  ],
  [
    "KAON0901DEB8",
    "24E4CE2EDC2A"
  ],
  [
    "KAON0902A157",
    "24E4CEEAE165"
  ],
  [
    "KAON0901DAC6",
    "24E4CE2EBC9A"
  ],
  [
    "KAON09022A44",
    "24E4CE47FE3A"
  ],
  [
    "KAON09029531",
    "24E4CEEA8035"
  ],
  [
    "KAON09020A6C",
    "24E4CE46FF7A"
  ],
  [
    "KAON0901394D",
    "1834AF5DB9DA"
  ],
  [
    "KAON09020CA2",
    "24E4CE47112A"
  ],
  [
    "KAON09019733",
    "1834AFB364E9"
  ],
  [
    "KAON090084B6",
    "1834AF581522"
  ],
  [
    "KAON0902A2F8",
    "24E4CEEAEE6D"
  ],
  [
    "KAON09003C93",
    "1834AF50DEA2"
  ],
  [
    "KAON09005AB6",
    "1834AF56C522"
  ],
  [
    "KAON0900EC6E",
    "1834AF5B52E2"
  ],
  [
    "KAON09007139",
    "1834AF57793A"
  ],
  [
    "KAON090198C0",
    "1834AFB37151"
  ],
  [
    "KAON0900DC9F",
    "1834AF5AD46A"
  ],
  [
    "KAON09006781",
    "1834AF572B7A"
  ],
  [
    "KAON090289CF",
    "24E4CE8B8820"
  ],
  [
    "KAON0900E8BC",
    "1834AF5B3552"
  ],
  [
    "KAON090263B1",
    "24E4CE8A5730"
  ],
  [
    "KAON090051DC",
    "1834AF567E52"
  ],
  [
    "KAON0900301C",
    "1834AF537AEA"
  ],
  [
    "KAON09014469",
    "1834AF5E12BA"
  ],
  [
    "KAON09023B7F",
    "24E4CE488812"
  ],
  [
    "KAON0902562C",
    "24E4CE89EB08"
  ],
  [
    "KAON09027979",
    "24E4CE8B0570"
  ],
  [
    "KAON0902049E",
    "24E4CE46D10A"
  ],
  [
    "KAON0900307B",
    "1834AF537DE2"
  ],
  [
    "KAON0900BE75",
    "1834AF59E31A"
  ],
  [
    "KAON0900150A",
    "1834AF52A25A"
  ],
  [
    "KAON0900CF5D",
    "1834AF5A6A5A"
  ],
  [
    "KAON09016D29",
    "1834AF5F58BA"
  ],
  [
    "KAON09024993",
    "24E4CE898640"
  ],
  [
    "KAON0900FF8C",
    "1834AF5BEBD2"
  ],
  [
    "KAON090192B5",
    "1834AFB340F9"
  ],
  [
    "KAON09023672",
    "24E4CE485FAA"
  ],
  [
    "KAON09011732",
    "1834AF5CA902"
  ],
  [
    "KAON09011D69",
    "1834AF5CDABA"
  ],
  [
    "KAON0901C088",
    "24E4CE2DEAAA"
  ],
  [
    "KAON0900159B",
    "1834AF52A6E2"
  ],
  [
    "KAON09017762",
    "1834AF5FAA82"
  ],
  [
    "KAON09011A14",
    "1834AF5CC012"
  ],
  [
    "KAON0901C6B1",
    "24E4CE2E1BF2"
  ],
  [
    "KAON09022E0C",
    "24E4CE481C7A"
  ],
  [
    "KAON090281D1",
    "24E4CE8B4830"
  ],
  [
    "KAON0900E2FB",
    "1834AF5B074A"
  ],
  [
    "KAON0900D593",
    "1834AF5A9C0A"
  ],
  [
    "KAON0900C703",
    "1834AF5A278A"
  ],
  [
    "KAON090208C1",
    "24E4CE46F222"
  ],
  [
    "KAON09028283",
    "24E4CE8B4DC0"
  ],
  [
    "KAON0902A48B",
    "24E4CEEAFB05"
  ],
  [
    "KAON0901E3EB",
    "24E4CE2F05C2"
  ],
  [
    "KAON0901902A",
    "1834AFB32CA1"
  ],
  [
    "KAON0901D096",
    "24E4CE2E6B1A"
  ],
  [
    "KAON09023B12",
    "24E4CE4884AA"
  ],
  [
    "KAON0900E9DE",
    "1834AF5B3E62"
  ],
  [
    "KAON0901AA16",
    "24E4CE2CFB2E"
  ],
  [
    "KAON0901B2BD",
    "24E4CE2D7C52"
  ],
  [
    "KAON09006A6B",
    "1834AF5742CA"
  ],
  [
    "KAON0901D23C",
    "24E4CE2E784A"
  ],
  [
    "KAON0901EE91",
    "24E4CE2F5AF2"
  ],
  [
    "KAON09015B2A",
    "1834AF5EC8C2"
  ],
  [
    "KAON0901A523",
    "1834AFB3D469"
  ],
  [
    "KAON0900FD1F",
    "1834AF5BD86A"
  ],
  [
    "KAON09029005",
    "24E4CEEA56D5"
  ],
  [
    "KAON09008C78",
    "1834AF585332"
  ],
  [
    "KAON090127B3",
    "1834AF5D2D0A"
  ],
  [
    "KAON0900CC4A",
    "1834AF5A51C2"
  ],
  [
    "KAON0900CAF9",
    "1834AF5A473A"
  ],
  [
    "KAON0902149A",
    "24E4CE4750EA"
  ],
  [
    "KAON09002C3A",
    "1834AF535BDA"
  ],
  [
    "KAON0901C2B8",
    "24E4CE2DFC2A"
  ],
  [
    "KAON090147B1",
    "1834AF5E2CFA"
  ],
  [
    "KAON09017C52",
    "1834AF5FD202"
  ],
  [
    "KAON0902188D",
    "24E4CE477082"
  ],
  [
    "KAON09020F74",
    "24E4CE4727BA"
  ],
  [
    "KAON09015797",
    "1834AF5EAC2A"
  ],
  [
    "KAON09028AB7",
    "24E4CE8B8F60"
  ],
  [
    "KAON0901A77D",
    "24E4CE2CE666"
  ],
  [
    "KAON09021FFB",
    "24E4CE47ABF2"
  ],
  [
    "KAON090017B8",
    "1834AF52B7CA"
  ],
  [
    "KAON09008ABA",
    "1834AF584542"
  ],
  [
    "KAON09003B74",
    "1834AF53D5AA"
  ],
  [
    "KAON09005A17",
    "1834AF56C02A"
  ],
  [
    "KAON09008649",
    "1834AF5821BA"
  ],
  [
    "KAON0900A5B9",
    "1834AF591D3A"
  ],
  [
    "KAON090113DF",
    "1834AF5C8E6A"
  ],
  [
    "KAON0902332F",
    "24E4CE484592"
  ],
  [
    "KAON09005BDC",
    "1834AF56CE52"
  ],
  [
    "KAON0901185B",
    "1834AF5CB24A"
  ],
  [
    "KAON09026775",
    "24E4CE8A7550"
  ],
  [
    "KAON0902689E",
    "24E4CE8A7E98"
  ],
  [
    "KAON090241C8",
    "24E4CE48BA5A"
  ],
  [
    "KAON0901FF26",
    "24E4CE46A54A"
  ],
  [
    "KAON09020DB4",
    "24E4CE4719BA"
  ],
  [
    "KAON09025795",
    "24E4CE89F650"
  ],
  [
    "KAON090229D9",
    "24E4CE47FAE2"
  ],
  [
    "KAON0901C008",
    "24E4CE2DE6AA"
  ],
  [
    "KAON09015E5F",
    "1834AF5EE26A"
  ],
  [
    "KAON09010AFC",
    "1834AF5C4752"
  ],
  [
    "KAON090291E1",
    "24E4CEEA65B5"
  ],
  [
    "KAON0902307E",
    "24E4CE48300A"
  ],
  [
    "KAON09027900",
    "24E4CE8B01A8"
  ],
  [
    "KAON0901AD5E",
    "24E4CE2D156E"
  ],
  [
    "KAON0900BDBA",
    "1834AF59DD42"
  ],
  [
    "KAON09006B96",
    "1834AF574C22"
  ],
  [
    "KAON09000B0B",
    "1834AF525262"
  ],
  [
    "KAON0900DC8B",
    "1834AF5AD3CA"
  ],
  [
    "KAON09015B4C",
    "1834AF5EC9D2"
  ],
  [
    "KAON0900858A",
    "1834AF581BC2"
  ],
  [
    "KAON09016842",
    "1834AF5F3182"
  ],
  [
    "KAON0901B45C",
    "24E4CE2D894A"
  ],
  [
    "KAON0900737F",
    "1834AF578B6A"
  ],
  [
    "KAON090296A3",
    "24E4CEEA8BC5"
  ],
  [
    "KAON09028BB0",
    "24E4CEEA342D"
  ],
  [
    "KAON09025997",
    "24E4CE8A0660"
  ],
  [
    "KAON0901817F",
    "1834AFB2B749"
  ],
  [
    "KAON090239BA",
    "24E4CE4879EA"
  ],
  [
    "KAON09004DE2",
    "1834AF565E82"
  ],
  [
    "KAON0900300E",
    "1834AF537A7A"
  ],
  [
    "KAON09009F28",
    "1834AF58E8B2"
  ],
  [
    "KAON0900BC82",
    "1834AF59D382"
  ],
  [
    "KAON0900BAA4",
    "1834AF59C492"
  ],
  [
    "KAON090130D1",
    "1834AF5D75FA"
  ],
  [
    "KAON09014DAA",
    "1834AF5E5CC2"
  ],
  [
    "KAON09014348",
    "1834AF5E09B2"
  ],
  [
    "KAON0900890C",
    "1834AF5837D2"
  ],
  [
    "KAON09014FFC",
    "1834AF5E6F52"
  ],
  [
    "KAON0900160A",
    "1834AF52AA5A"
  ],
  [
    "KAON090009B8",
    "1834AF5247CA"
  ],
  [
    "KAON090094D4",
    "1834AF589612"
  ],
  [
    "KAON0900AF5B",
    "1834AF596A4A"
  ],
  [
    "KAON09016575",
    "1834AF5F1B1A"
  ],
  [
    "KAON09017D29",
    "1834AFB29499"
  ],
  [
    "KAON090283E1",
    "24E4CE8B58B0"
  ],
  [
    "KAON0901DF7F",
    "24E4CE2EE262"
  ],
  [
    "KAON0902A7A6",
    "24E4CEEB13DD"
  ],
  [
    "KAON09022B96",
    "24E4CE4808CA"
  ],
  [
    "KAON0902746D",
    "24E4CE8ADD10"
  ],
  [
    "KAON0900D701",
    "1834AF5AA77A"
  ],
  [
    "KAON09027E13",
    "24E4CE8B2A40"
  ],
  [
    "KAON0900A24A",
    "1834AF5901C2"
  ],
  [
    "KAON09026785",
    "24E4CE8A75D0"
  ],
  [
    "KAON09020558",
    "24E4CE46D6DA"
  ],
  [
    "KAON090030AF",
    "1834AF537F82"
  ],
  [
    "KAON0901E207",
    "24E4CE2EF6A2"
  ],
  [
    "KAON09016F1A",
    "1834AF5F6842"
  ],
  [
    "KAON09029EE4",
    "24E4CEEACDCD"
  ],
  [
    "KAON0901A61B",
    "1834AFB3DC29"
  ],
  [
    "KAON09005A6A",
    "1834AF56C2C2"
  ],
  [
    "KAON0900FDE8",
    "1834AF5BDEB2"
  ],
  [
    "KAON09016F01",
    "1834AF5F677A"
  ],
  [
    "KAON0902743A",
    "24E4CE8ADB78"
  ],
  [
    "KAON090159F1",
    "1834AF5EBEFA"
  ],
  [
    "KAON09002B33",
    "1834AF5353A2"
  ],
  [
    "KAON0900663A",
    "1834AF572142"
  ],
  [
    "KAON090077D7",
    "1834AF57AE2A"
  ],
  [
    "KAON09025132",
    "24E4CE89C338"
  ],
  [
    "KAON09026362",
    "24E4CE8A54B8"
  ],
  [
    "KAON0901FA6F",
    "24E4CE467F92"
  ],
  [
    "KAON09007F4E",
    "1834AF57E9E2"
  ],
  [
    "KAON09009F6B",
    "1834AF58EACA"
  ],
  [
    "KAON090129AC",
    "1834AF5D3CD2"
  ],
  [
    "KAON0902A593",
    "24E4CEEB0345"
  ],
  [
    "KAON09024C0B",
    "24E4CE899A00"
  ],
  [
    "KAON09001657",
    "1834AF52ACC2"
  ],
  [
    "KAON09021AB9",
    "24E4CE4781E2"
  ],
  [
    "KAON0902834B",
    "24E4CE8B5400"
  ],
  [
    "KAON0900BEAD",
    "1834AF59E4DA"
  ],
  [
    "KAON09001D37",
    "1834AF52E3C2"
  ],
  [
    "KAON09020168",
    "24E4CE46B75A"
  ],
  [
    "KAON090110D0",
    "1834AF5C75F2"
  ],
  [
    "KAON0900C0FD",
    "1834AF59F75A"
  ],
  [
    "KAON0902036F",
    "24E4CE46C792"
  ],
  [
    "KAON09002C0F",
    "1834AF535A82"
  ],
  [
    "KAON09002DD1",
    "1834AF536892"
  ],
  [
    "KAON0901A5EA",
    "1834AF33DAA1"
  ],
  [
    "KAON09009A74",
    "1834AF58C312"
  ],
  [
    "KAON090239B2",
    "24E4CE4879AA"
  ],
  [
    "KAON0901ED6D",
    "24E4CE2F51D2"
  ],
  [
    "KAON0900F7F7",
    "1834AF5BAF2A"
  ],
  [
    "KAON09014D8D",
    "1834AF5E5BDA"
  ],
  [
    "KAON09016087",
    "1834AF5EF3AA"
  ],
  [
    "KAON0901449F",
    "1834AF5E146A"
  ],
  [
    "KAON090187BE",
    "1834AFB2E941"
  ],
  [
    "KAON0901C520",
    "24E4CE2E0F6A"
  ],
  [
    "KAON09012159",
    "1834AF5CFA3A"
  ],
  [
    "KAON09006823",
    "1834AF57308A"
  ],
  [
    "KAON0902379D",
    "24E4CE486902"
  ],
  [
    "KAON09001251",
    "1834AF528C92"
  ],
  [
    "KAON0900084D",
    "1834AF543072"
  ],
  [
    "KAON0900D1CB",
    "1834AF5A7DCA"
  ],
  [
    "KAON09025F3A",
    "24E4CE8A3378"
  ],
  [
    "KAON0901430A",
    "1834AF5E07C2"
  ],
  [
    "KAON0901448D",
    "1834AF5E13DA"
  ],
  [
    "KAON09011C84",
    "1834AF5CD392"
  ],
  [
    "KAON09016F4B",
    "1834AF5F69CA"
  ],
  [
    "KAON0901AA72",
    "24E4CE2CFE0E"
  ],
  [
    "KAON090061D4",
    "1834AF56FE12"
  ],
  [
    "KAON09028174",
    "24E4CE8B4548"
  ],
  [
    "KAON09028C30",
    "24E4CEEA382D"
  ],
  [
    "KAON0902835B",
    "24E4CE8B5480"
  ],
  [
    "KAON09029A29",
    "24E4CEEAA7F5"
  ],
  [
    "KAON09018437",
    "1834AFB2CD09"
  ],
  [
    "KAON09004D05",
    "1834AF56579A"
  ],
  [
    "KAON09010652",
    "1834AF5C2202"
  ],
  [
    "KAON0901661B",
    "1834AF5F204A"
  ],
  [
    "KAON09012CD4",
    "1834AF5D5612"
  ],
  [
    "KAON09027C65",
    "24E4CE8B1CD0"
  ],
  [
    "KAON0901554C",
    "1834AF5E99D2"
  ],
  [
    "KAON0902AFA1",
    "24E4CEEB53B5"
  ],
  [
    "KAON090006E5",
    "1834AF542532"
  ],
  [
    "KAON09011C58",
    "1834AF5CD232"
  ],
  [
    "KAON09000DFF",
    "1834AF526A02"
  ],
  [
    "KAON090075D9",
    "1834AF579E3A"
  ],
  [
    "KAON09028E7D",
    "24E4CEEA4A95"
  ],
  [
    "KAON09015261",
    "1834AF5E827A"
  ],
  [
    "KAON09004D29",
    "1834AF5658BA"
  ],
  [
    "KAON0900ECE9",
    "1834AF5B56BA"
  ],
  [
    "KAON09012953",
    "1834AF5D3A0A"
  ],
  [
    "KAON090125D3",
    "1834AF5D1E0A"
  ],
  [
    "KAON09024CD3",
    "24E4CE89A040"
  ],
  [
    "KAON09021E0B",
    "24E4CE479C72"
  ],
  [
    "KAON09013AB4",
    "1834AF5DC512"
  ],
  [
    "KAON0901F17C",
    "24E4CE2F724A"
  ],
  [
    "KAON09010FED",
    "1834AF5C6EDA"
  ],
  [
    "KAON0901FEFC",
    "1834AF52C461"
  ],
  [
    "KAON09020D16",
    "24E4CE4714CA"
  ],
  [
    "KAON09003A9A",
    "1834AF53CEDA"
  ],
  [
    "KAON0901616C",
    "1834AF5EFAD2"
  ],
  [
    "KAON090108E1",
    "1834AF5C367A"
  ],
  [
    "KAON09024A3E",
    "24E4CE898B98"
  ],
  [
    "KAON090149EE",
    "1834AF5E3EE2"
  ],
  [
    "KAON0901586A",
    "1834AF5EB2C2"
  ],
  [
    "KAON09016ECB",
    "1834AF5F65CA"
  ],
  [
    "KAON09025769",
    "24E4CE89F4F0"
  ],
  [
    "KAON0901A37B",
    "1834AFB3C729"
  ],
  [
    "KAON0902369F",
    "24E4CE486112"
  ],
  [
    "KAON0901016F",
    "1834AF5BFAEA"
  ],
  [
    "KAON09000735",
    "1834AF5427B2"
  ],
  [
    "KAON090087EF",
    "1834AF582EEA"
  ],
  [
    "KAON090197E0",
    "1834AFB36A51"
  ],
  [
    "KAON09027C7F",
    "24E4CE8B1DA0"
  ],
  [
    "KAON0901463C",
    "1834AF5E2152"
  ],
  [
    "KAON0901F395",
    "24E4CE2F8312"
  ],
  [
    "KAON0900D7A0",
    "1834AF5AAC72"
  ],
  [
    "KAON09026BD2",
    "24E4CE8A9838"
  ],
  [
    "KAON0901FD51",
    "24E4CE4696A2"
  ],
  [
    "KAON09003A8D",
    "1834AF53CE72"
  ],
  [
    "KAON0900CAA0",
    "1834AF5A4472"
  ],
  [
    "KAON09021F74",
    "24E4CE47A7BA"
  ],
  [
    "KAON0901A4FF",
    "1834AFB3D349"
  ],
  [
    "KAON09028275",
    "24E4CE8B4D50"
  ],
  [
    "KAON09006496",
    "1834AF571422"
  ],
  [
    "KAON0900BFD0",
    "1834AF59EDF2"
  ],
  [
    "KAON0901C29F",
    "24E4CE2DFB62"
  ],
  [
    "KAON09021432",
    "24E4CE474DAA"
  ],
  [
    "KAON09004D1B",
    "1834AF56584A"
  ],
  [
    "KAON0901DC2C",
    "24E4CE2EC7CA"
  ],
  [
    "KAON090185FA",
    "1834AFB2DB21"
  ],
  [
    "KAON09015B3A",
    "1834AF5EC942"
  ],
  [
    "KAON09002890",
    "1834AF533E8A"
  ],
  [
    "KAON09023A6D",
    "24E4CE487F82"
  ],
  [
    "KAON09016F5C",
    "1834AF5F6A52"
  ],
  [
    "KAON09004B53",
    "1834AF564A0A"
  ],
  [
    "KAON0900E777",
    "1834AF5B2B2A"
  ],
  [
    "KAON09014B90",
    "1834AF5E4BF2"
  ],
  [
    "KAON09012BCA",
    "1834AF5D4DC2"
  ],
  [
    "KAON09003265",
    "1834AF538D32"
  ],
  [
    "KAON0900F921",
    "1834AF5BB87A"
  ],
  [
    "KAON09027D46",
    "24E4CE8AE058"
  ],
  [
    "KAON09006BA8",
    "1834AF574CB2"
  ],
  [
    "KAON090226A9",
    "24E4CE47E162"
  ],
  [
    "KAON0901EB66",
    "24E4CE2F419A"
  ],
  [
    "KAON0901B9A1",
    "24E4CE2DB372"
  ],
  [
    "KAON09014FD2",
    "1834AF5E6E02"
  ],
  [
    "KAON0901568D",
    "1834AF5EA3DA"
  ],
  [
    "KAON0900353A",
    "1834AF53A3DA"
  ],
  [
    "KAON0902548D",
    "24E4CE89DE10"
  ],
  [
    "KAON09001BF7",
    "1834AF52D9C2"
  ],
  [
    "KAON09022909",
    "24E4CE47F462"
  ],
  [
    "KAON090269A0",
    "24E4CE8A86A8"
  ],
  [
    "KAON09019777",
    "1834AFB36709"
  ],
  [
    "KAON0902420F",
    "24E4CE48BC92"
  ],
  [
    "KAON09006152",
    "1834AF56FA02"
  ],
  [
    "KAON09015DE1",
    "1834AF5EDE7A"
  ],
  [
    "KAON090256B2",
    "24E4CE89EF38"
  ],
  [
    "KAON0901CCE8",
    "24E4CE2E4DAA"
  ],
  [
    "KAON0901EA00",
    "24E4CE2F366A"
  ],
  [
    "KAON09005F31",
    "1834AF56E8FA"
  ],
  [
    "KAON09014304",
    "1834AF5E0792"
  ],
  [
    "KAON0901AAE1",
    "24E4CE2D0186"
  ],
  [
    "KAON09020FF3",
    "24E4CE472BB2"
  ],
  [
    "KAON090240B7",
    "24E4CE48B1D2"
  ],
  [
    "KAON0902B315",
    "24E4CEEF8B8E"
  ],
  [
    "KAON09028B11",
    "24E4CE8B9230"
  ],
  [
    "KAON09025A29",
    "24E4CE8A0AF0"
  ],
  [
    "KAON09029B6B",
    "24E4CEEAB205"
  ],
  [
    "KAON0901586E",
    "1834AF5EB2E2"
  ],
  [
    "KAON09027D6C",
    "24E4CE8B2508"
  ],
  [
    "KAON0901C281",
    "24E4CE2DFA72"
  ],
  [
    "KAON0900052A",
    "1834AF17CF46"
  ],
  [
    "KAON09002B01",
    "1834AF535212"
  ],
  [
    "KAON090262F8",
    "24E4CE8A5168"
  ],
  [
    "KAON09024E64",
    "24E4CE89ACC8"
  ],
  [
    "KAON09015D6D",
    "1834AF5EDADA"
  ],
  [
    "KAON090006A9",
    "1834AF542352"
  ],
  [
    "KAON0901E5AE",
    "24E4CE2F13DA"
  ],
  [
    "KAON09026362",
    "24E4CE8A54B8"
  ],
  [
    "KAON090156B6",
    "1834AF5EA522"
  ],
  [
    "KAON0900AF52",
    "1834AF596A02"
  ],
  [
    "KAON09004CE9",
    "1834AF5656BA"
  ],
  [
    "KAON090136EC",
    "1834AF5DA6D2"
  ],
  [
    "KAON0900F89A",
    "1834AF5BB442"
  ],
  [
    "KAON09011EF1",
    "1834AF5CE6FA"
  ],
  [
    "KAON0901699A",
    "1834AF5F3C42"
  ],
  [
    "KAON0901B484",
    "24E4CE2D8A8A"
  ],
  [
    "KAON0901D3F3",
    "24E4CE2E8602"
  ],
  [
    "KAON09015D4B",
    "1834AF5ED9CA"
  ],
  [
    "KAON0900A836",
    "1834AF593122"
  ],
  [
    "KAON0900E05B",
    "1834AF5AF24A"
  ],
  [
    "KAON090008CA",
    "1834AF54345A"
  ],
  [
    "KAON090145CA",
    "1834AF5E1DC2"
  ],
  [
    "KAON0900D8AB",
    "1834AF5AB4CA"
  ],
  [
    "KAON0901B8DE",
    "24E4CE2DAD5A"
  ],
  [
    "KAON0902163C",
    "24E4CE475DFA"
  ],
  [
    "KAON0901DBE8",
    "24E4CE2EC5AA"
  ],
  [
    "KAON0902500C",
    "24E4CE89BA08"
  ],
  [
    "KAON0901D26F",
    "24E4CE2E79E2"
  ],
  [
    "KAON0900457B",
    "1834AF561B4A"
  ],
  [
    "KAON09006514",
    "1834AF571812"
  ],
  [
    "KAON0901199D",
    "1834AF5CBC5A"
  ],
  [
    "KAON09003DB3",
    "1834AF53E7A2"
  ],
  [
    "KAON09027A6F",
    "24E4CE8B0D20"
  ],
  [
    "KAON09025AC2",
    "24E4CE8A0FB8"
  ],
  [
    "KAON09027014",
    "24E4CE8ABA48"
  ],
  [
    "KAON09027658",
    "24E4CE8AEC68"
  ],
  [
    "KAON0900E73D",
    "1834AF5B295A"
  ],
  [
    "KAON09008492",
    "1834AF581402"
  ],
  [
    "KAON09022BD2",
    "24E4CE480AAA"
  ],
  [
    "KAON09025EA8",
    "24E4CE8A2EE8"
  ],
  [
    "KAON0901F478",
    "24E4CE2F8A2A"
  ],
  [
    "KAON09004EF1",
    "1834AF5666FA"
  ],
  [
    "KAON09018565",
    "1834AFB2D679"
  ],
  [
    "KAON090144DA",
    "1834AF5E1642"
  ],
  [
    "KAON09003299",
    "1834AF538ED2"
  ],
  [
    "KAON0901A1F1",
    "1834AFB3BAD9"
  ],
  [
    "KAON0901095B",
    "1834AF5C3A4A"
  ],
  [
    "KAON09010E09",
    "1834AF5C5FBA"
  ],
  [
    "KAON0901EA02",
    "24E4CE2F367A"
  ],
  [
    "KAON0900B597",
    "1834AF599C2A"
  ],
  [
    "KAON090201DA",
    "24E4CE46BAEA"
  ],
  [
    "KAON090133DA",
    "1834AF5D8E42"
  ],
  [
    "KAON090080C3",
    "1834AF57F58A"
  ],
  [
    "KAON09003B4E",
    "1834AF53D47A"
  ],
  [
    "KAON09025F76",
    "24E4CE8A3558"
  ],
  [
    "KAON0900AC29",
    "1834AF5950BA"
  ],
  [
    "KAON0900090D",
    "1834AF543672"
  ],
  [
    "KAON0900974B",
    "1834AF58A9CA"
  ],
  [
    "KAON0900FCDB",
    "1834AF5BD64A"
  ],
  [
    "KAON09018F57",
    "1834AFB32609"
  ],
  [
    "KAON090032E3",
    "1834AF539122"
  ],
  [
    "KAON090192A4",
    "1834AFB34071"
  ],
  [
    "KAON0900989C",
    "1834AF58B452"
  ],
  [
    "KAON0902448A",
    "24E4CE895DF8"
  ],
  [
    "KAON09004136",
    "1834AF5403BA"
  ],
  [
    "KAON09012EAC",
    "1834AF5D64D2"
  ],
  [
    "KAON0901F20D",
    "24E4CE2F76D2"
  ],
  [
    "KAON090045F2",
    "1834AF561F02"
  ],
  [
    "KAON0902A682",
    "24E4CEEB0ABD"
  ],
  [
    "KAON090148E6",
    "1834AF5E36A2"
  ],
  [
    "KAON09028012",
    "24E4CE8B3A38"
  ],
  [
    "KAON090085E8",
    "1834AF581EB2"
  ],
  [
    "KAON09002165",
    "1834AF530532"
  ],
  [
    "KAON0900B607",
    "1834AF599FAA"
  ],
  [
    "KAON09004984",
    "1834AF563B92"
  ],
  [
    "KAON09009574",
    "1834AF589B12"
  ],
  [
    "KAON090076B6",
    "1834AF57A522"
  ],
  [
    "KAON0900E5BF",
    "1834AF5B1D6A"
  ],
  [
    "KAON0900ADEB",
    "1834AF595ECA"
  ],
  [
    "KAON0901B5CA",
    "24E4CE2D94BA"
  ],
  [
    "KAON090249A6",
    "24E4CE8986D8"
  ],
  [
    "KAON0900A131",
    "1834AF58F8FA"
  ],
  [
    "KAON0900730D",
    "1834AF5787DA"
  ],
  [
    "KAON0901442D",
    "1834AF5E10DA"
  ],
  [
    "KAON09008585",
    "1834AF581B9A"
  ],
  [
    "KAON09003AD3",
    "1834AF53D0A2"
  ],
  [
    "KAON09000E62",
    "1834AF526D1A"
  ],
  [
    "KAON090219C9",
    "24E4CE477A62"
  ],
  [
    "KAON0901189D",
    "1834AF5CB45A"
  ],
  [
    "KAON0902633F",
    "24E4CE8A53A0"
  ],
  [
    "KAON0900070E",
    "1834AF54267A"
  ],
  [
    "KAON09008716",
    "1834AF582822"
  ],
  [
    "KAON09024DE8",
    "24E4CE89A8E8"
  ],
  [
    "KAON09014B18",
    "1834AF59E410"
  ],
  [
    "KAON0901C00F",
    "24E4CE2DE6E2"
  ],
  [
    "KAON0900A130",
    "1834AF58F8F2"
  ],
  [
    "KAON09012A94",
    "1834AF5D4412"
  ],
  [
    "KAON0902A46E",
    "24E4CEEAFA1D"
  ],
  [
    "KAON0901B320",
    "24E4CE2D7F6A"
  ],
  [
    "KAON09027C4C",
    "24E4CE8B1C08"
  ],
  [
    "KAON0902AF90",
    "24E4CEEB532D"
  ],
  [
    "KAON0901B1FB",
    "24E4CE2D7642"
  ],
  [
    "KAON0901FFB1",
    "24E4CE46A9A2"
  ],
  [
    "KAON0901EA38",
    "24E4CE2F382A"
  ],
  [
    "KAON0900685D",
    "1834AF57325A"
  ],
  [
    "KAON09004773",
    "1834AF562B0A"
  ],
  [
    "KAON0901364D",
    "1834AF5DA1DA"
  ],
  [
    "KAON090021B4",
    "1834AF5307AA"
  ]
];
    console.log(`[${dbName}] Verificando e corrigindo gpon_sn para ${mapping.length} registros Kaon...`);
    let updatedCount = 0;
    
    // Podemos rodar os updates de forma eficiente
    // Para evitar rodar centenas de queries individuais se nada mudou, podemos verificar
    // se existem registros que precisam ser atualizados
    for (const [correctGpon, mac] of mapping) {
      const res = await pool.query(
        "UPDATE etiquetas_scan_onu SET gpon_sn = $1 WHERE mac = $2 AND gpon_sn != $1",
        [correctGpon, mac]
      );
      if (res.rowCount && res.rowCount > 0) {
        updatedCount += res.rowCount;
      }
    }
    
    if (updatedCount > 0) {
      console.log(`[${dbName}] Migração MAC->KAON concluída: ${updatedCount} registros atualizados.`);
    }
  } catch (migErr: any) {
    console.error(`[${dbName}] Erro na migração MAC->KAON:`, migErr.message || migErr);
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
          password_router VARCHAR(100),
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

      // Migrate existing admins to master
      try {
        await dbPool.query("UPDATE usuarios_scan_onu SET role = 'master' WHERE role = 'admin'");
      } catch(err) { console.error('Erro ao migrar admins:', err); }


      // Garantir coluna operacao se não existir
      try {
        const checkCols = await dbPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='usuarios_scan_onu'");
        const cols = checkCols.rows.map(r => r.column_name);
        if (!cols.includes('operacao')) await dbPool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
        if (!cols.includes('permitir_gpon')) await dbPool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN permitir_gpon BOOLEAN DEFAULT TRUE");
        if (!cols.includes('permitir_reimpressao')) await dbPool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN permitir_reimpressao BOOLEAN DEFAULT TRUE");
        if (!cols.includes('tecnologias_permitidas')) await dbPool.query("ALTER TABLE usuarios_scan_onu ADD COLUMN tecnologias_permitidas VARCHAR(200) DEFAULT 'IPTV,GPON,EMTA,STB'");
      } catch (e) {
        console.error('Erro ao adicionar colunas em usuarios_scan_onu (initDb):', e);
      }

      // Criar a tabela de sessões
      const createSessionsTableQuery = `
        CREATE TABLE IF NOT EXISTS sessoes_scan_onu (
          token VARCHAR(100) PRIMARY KEY,
          email VARCHAR(150) NOT NULL,
          role VARCHAR(50) NOT NULL,
          operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ',
          data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          data_expiracao TIMESTAMP NOT NULL
        );
      `;
      await dbPool.query(createSessionsTableQuery);
      
      // Garantir operacao nas sessoes e etiquetas
      try {
        const checkSess = await dbPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='sessoes_scan_onu'");
        if (!checkSess.rows.some(r => r.column_name === 'operacao')) {
          await dbPool.query("ALTER TABLE sessoes_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
        }
        const checkEtiq = await dbPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu'");
        const etiqCols = checkEtiq.rows.map((r: any) => r.column_name.toLowerCase());
        if (!etiqCols.includes('operacao')) {
          await dbPool.query("ALTER TABLE etiquetas_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
        }
        try {
          await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS password_router VARCHAR(100) DEFAULT \'N/A\'');
          try {
            await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN IF EXISTS "PASSWORD_ROUTER"');
          } catch (dropErr) {}
          try {
            await dbPool.query("UPDATE etiquetas_scan_onu SET password_router = 'N/A' WHERE password_router = web_key");
          } catch (cleanErr) {}
        } catch (e) {
          console.error('Erro ao adicionar/limpar coluna password_router em etiquetas_scan_onu (initDb):', e);
        }
      } catch (e) {
        console.error('Erro ao adicionar operacao nas tabelas (initDb):', e);
      }

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

      // Criar tabela de modelos IPTV
      const createIptvModelsTableQuery = `
        CREATE TABLE IF NOT EXISTS modelos_zpl_iptv (
          id SERIAL PRIMARY KEY,
          nome_modelo VARCHAR(150) NOT NULL,
          codigo_zpl TEXT NOT NULL,
          campos_config JSONB NOT NULL,
          tecnologia VARCHAR(50) NOT NULL DEFAULT 'IPTV',
          data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await dbPool.query(createIptvModelsTableQuery);

      // Migração para adicionar a coluna tecnologia na tabela modelos_zpl_iptv se não existir
      try {
        const checkColumn = await dbPool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='modelos_zpl_iptv' AND column_name='tecnologia'"
        );
        if (checkColumn.rowCount === 0) {
          await dbPool.query("ALTER TABLE modelos_zpl_iptv ADD COLUMN tecnologia VARCHAR(50) NOT NULL DEFAULT 'IPTV'");
          console.log("Coluna 'tecnologia' adicionada com sucesso à tabela modelos_zpl_iptv (dbPool).");
        }
      } catch (err: any) {
        console.error("Erro ao rodar migração de tecnologia em modelos_zpl_iptv (dbPool):", err.message);
      }


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

      // Migração para mover data_leitura para a última posição
      try {
        const lastCol = await dbPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' ORDER BY ordinal_position DESC LIMIT 1");
        if (lastCol.rowCount && lastCol.rowCount > 0 && lastCol.rows[0].column_name !== 'data_leitura') {
          console.log('Movendo a coluna data_leitura para a ultima posicao no banco padrao');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN data_leitura TO data_leitura_old');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
          await dbPool.query('UPDATE etiquetas_scan_onu SET data_leitura = data_leitura_old');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN data_leitura_old');
        }
      } catch (e) {
        console.error('Erro ao mover a coluna data_leitura:', e);
      }

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
          "INSERT INTO usuarios_scan_onu (email, senha, role, operacao) VALUES ('admin@scanonu.com', 'admin123', 'master', 'CTDI MATRIZ')"
        );
        console.log('Usuário admin padrão (admin@scanonu.com / admin123) cadastrado com sucesso.');
      } else {
        await dbPool.query(
          "UPDATE usuarios_scan_onu SET senha = 'admin123', role = 'master', operacao = 'CTDI MATRIZ' WHERE email = 'admin@scanonu.com'"
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
        await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'Kaon' WHERE (fabricante ILIKE '%Kaon%' OR fabricante = 'KAO') AND fabricante != 'Kaon'");

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

        // Migração para mover GP0... ou GPO... de gpon_sn para cpe_sn no modelo PG2447
        try {
          const migrateGpoRes = await dbPool.query(
            "UPDATE etiquetas_scan_onu SET cpe_sn = gpon_sn, gpon_sn = 'N/A_' || UPPER(REPLACE(COALESCE(mac, 'N/A'), ':', '')) || '_' || substring(md5(random()::text) from 1 for 6) WHERE modelo = 'PG2447' AND (gpon_sn LIKE 'GPO%' OR gpon_sn LIKE 'gpo%' OR gpon_sn LIKE 'GP0%' OR gpon_sn LIKE 'gp0%')"
          );
          if (migrateGpoRes.rowCount !== null && migrateGpoRes.rowCount > 0) {
            console.log(`Migração GP0/GPO concluída na inicialização padrão: ${migrateGpoRes.rowCount} registros atualizados.`);
          }
        } catch (migErr: any) {
          console.error('Erro na migração de GP0/GPO no modelo PG2447 (boot):', migErr.message || migErr);
        }
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

function matchMacAndSsidSuffix(mac: string, ssid: string): boolean {
  if (!mac || !ssid) return false;
  const cleanMac = mac.replace(/[^0-9A-FA-F]/g, '');
  const cleanSsid = ssid.replace(/_(2G|5G)$/i, '').trim();
  if (cleanMac.length < 4 || cleanSsid.length < 4) return false;
  
  const macSuffix = cleanMac.slice(-4);
  const ssidSuffix = cleanSsid.slice(-4);
  
  const macVal = parseInt(macSuffix, 16);
  const ssidVal = parseInt(ssidSuffix, 16);
  
  if (isNaN(macVal) || isNaN(ssidVal)) return false;
  
  const diff = macVal - ssidVal;
  const normDiff = (diff + 0x10000) % 0x10000;
  // Offsets exatos Sagemcom F@ST 5670 / 5655V2 / 5676V2:
  // 0: MAC exatamente igual ao sufixo do SSID
  // 3: MAC - 3 = SSID (padrão LIVE TIM)
  // 7: MAC - 7 = SSID (padrão TIM ULTRAFIBRA)
  return normDiff === 0 || normDiff === 3 || normDiff === 7;
}

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

function normalizeFabricante(fabricante: string, modelo: string): string {
  const modelUpper = (modelo || '').toUpperCase().trim();
  if (modelUpper.includes('FGA2232TIB')) {
    return 'VANTIVA';
  }
  const mfgUpper = (fabricante || '').toUpperCase().trim();
  if (mfgUpper.includes('KAON') || mfgUpper === 'KAO') {
    return 'Kaon';
  }
  return fabricante || 'N/A';
}

function normalizeModel(modelo: string, fabricante: string): string {
  const modelNorm = (modelo || '').trim();
  const mfgUpper = (fabricante || '').toUpperCase();
  const modelClean = modelNorm.toUpperCase().replace(/[^A-Z0-9@]/g, '');
  // Kaon PG2447 / P82447 e todas as variações
  if (
    modelClean.includes('PG2447') ||
    modelClean.includes('P82447') ||
    modelClean.includes('2447') ||
    modelClean.includes('82447') ||
    (mfgUpper.includes('KAON') && (modelClean.includes('2447') || modelClean.includes('PG') || modelClean.includes('P8')))
  ) {
    return 'PG2447';
  }

  // Blu-Castle BC-UM221E / UM221E
  const modelCleanNoDashes = modelNorm.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (modelCleanNoDashes.includes('BCUM221E') || modelCleanNoDashes.includes('UM221E') || modelCleanNoDashes.includes('BCUM221') || modelCleanNoDashes.includes('UM221')) {
    return 'BC-UM221E';
  }

  // Blu-Castle BCSKV630 / BCSK
  if (modelClean.includes('BCSKV630') || modelClean.includes('BCSK') || modelClean.includes('630')) {
    return 'BCSKV630';
  }

  // NP5454T
  if (modelClean.includes('NP5454T') || modelClean.includes('5454T') || modelClean.includes('5454')) {
    return 'NP5454T';
  }

  // NP7287G
  if (modelClean.includes('NP7287G') || modelClean.includes('7287G') || modelClean.includes('7287')) {
    return 'NP7287G';
  }

  // ZTE ZXHN F680
  if (modelClean.includes('F680') || modelClean.includes('680')) {
    return 'ZXHN F680';
  }

  // ZTE ZXHN F6600P
  if (modelClean.includes('F6600') || modelClean.includes('6600P') || modelClean.includes('6600')) {
    return 'ZXHN F6600P';
  }

  // Sagemcom F@ST 5655V2
  if (
    modelClean.includes('FAST5655V2') || 
    modelClean.includes('F@ST5655V2') || 
    (modelClean.includes('5655V2') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5655'))
  ) {
    return 'F@ST 5655V2';
  }

  // Sagemcom F@ST 5657 TIM LIVE
  if (
    modelClean.includes('FAST5657') || 
    modelClean.includes('F@ST5657') || 
    (modelClean.includes('5657') && (modelClean.includes('FAST') || modelClean.includes('F@ST'))) ||
    (mfgUpper.includes('SAGEM') && modelClean.includes('5657'))
  ) {
    return 'F@ST 5657 TIM LIVE';
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
1. fabricante: Fabricante da ONU (ex: Huawei, ZTE, FiberHome, Intelbras, Nokia, Alcatel, SagemCOM). Se não encontrar na etiqueta, escreva 'N/A'.
2. modelo: Modelo exato da ONU (ex: F670L, HG8145V5, EG8145V5, F6600, F680, F673, XC-FIT-150, F@ST 5655V2, etc.). Se não encontrar na etiqueta, escreva 'N/A'.
3. cpe_sn: Serial CPE/Equipamento. Se não houver explicitamente o serial do equipamento (não confunda com PN ou SAP), escreva 'N/A'. Não capture PN ou SAP.
4. gpon_sn: Serial GPON (ex: SMBS12345678, ZTEG12345678, FHTT12345678, ALCL12345678, HWTC12345678). Se a etiqueta NÃO TIVER Gpon SN explícito, NÃO INVENTE. Escreva exatamente 'N/A'.
5. mac: Endereço MAC físico de 12 caracteres hexadecimais (ex: 8020DAD1D2D3). Se a etiqueta NÃO TIVER MAC explícito, NÃO INVENTE. Escreva exatamente 'N/A'.
6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única. CUIDADO EXTREMO com caracteres visualmente semelhantes: diferencie claramente 'B' e '8', 'O' (letra) e '0' (zero), 'I' e '1', 'Z' e '2', 'S' e '5', 'G' e '6', 'D' e '0'. Um erro nesses caracteres fará o sistema falhar. Se não achar, 'N/A'.
7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz. Aplique a mesma regra estrita do wifi_ssid para diferenciação de letras e números parecidos. Se não achar, 'N/A'.
8. wifi_key: Senha padrão do Wi-Fi. ATENÇÃO MÁXIMA À EXATIDÃO: Diferencie claramente letras maiúsculas de minúsculas. CUIDADO REDOBRADO: O modelo de IA tem um vício crônico em ler '!' como a letra 'I' maiúscula. As senhas de Wi-Fi de roteadores (Claro, Vivo, TIM, etc) frequentemente contêm o símbolo de exclamação '!'. Sempre que vir um traço vertical, preste muita atenção se não há um ponto embaixo dele caracterizando um '!'. Se a senha parecer ter um 'I' jogado aleatoriamente (ex: adminI123, TIM_wifiI, Yh6t*XID), o correto quase 100% das vezes é '!'. NUNCA converta '!' para 'I'. Se não achar a senha, 'N/A'.
9. usuario: Usuário padrão de acesso web (ex: admin). Se não achar, 'N/A'.
10. web_key: Senha de acesso web (Password/Senha). Aplique a mesma regra estrita do wifi_key para não confundir '!' com 'I'. Se não achar, 'N/A'.
11. reimpressa: Identifique se a etiqueta é uma reimpressão (geralmente não original, impressa em papel adesivo comum) retornando 'sim' ou 'nao'.

DIRETRIZES EXAUSTIVAS DE ASSERTIVIDADE VISUAL DE CARACTERES (APLIQUE A TODOS OS CAMPOS):
* TABELA DE MAIÚSCULAS VS MINÚSCULAS DE GRAFIA HOMÓLOGA (Ex: X/x, Z/z, C/c, O/o, S/s, V/v, W/w, P/p, K/k, U/u):
  - 'X' vs 'x': Se o topo do cruzamento atingir a linha superior das maiúsculas vizinhas, é 'X' MAIÚSCULO. Se alinhar com a linha média (x-height) dos caracteres adjacentes, é 'x' MINÚSCULO.
  - 'Z' vs 'z': Haste vertical de altura cheia = 'Z' MAIÚSCULO; meia altura = 'z' MINÚSCULO.
  - 'C' vs 'c': Abertura e altura inteira = 'C' MAIÚSCULO; meia altura = 'c' MINÚSCULO.
  - 'O' vs 'o': Circunferência total de topo alto = 'O' MAIÚSCULO; meia altura = 'o' MINÚSCULO.
  - 'S' vs 's': Curva cheia no topo = 'S' MAIÚSCULO; meia altura = 's' MINÚSCULO.
  - 'V' vs 'v': Vértice de altura inteira = 'V' MAIÚSCULO; meia altura = 'v' MINÚSCULO.
  - 'W' vs 'w': Largura e altura cheias = 'W' MAIÚSCULO; meia altura = 'w' MINÚSCULO.
  - 'P' vs 'p': Se a haste vertical assenta na linha de base de escrita (baseline) = 'P' MAIÚSCULO. Se a haste descer abaixo da linha de base (descender) = 'p' MINÚSCULO.
  - 'K' vs 'k': Haste vertical que supera os braços oblíquos = 'k' MINÚSCULO; braços abrindo exatamente da metade da haste = 'K' MAIÚSCULO.
  - 'U' vs 'u': Fundo em curva contínua sem perna = 'U' MAIÚSCULO; presença de perna vertical descendente no lado direito = 'u' MINÚSCULO.

* TABELA DE DISCRIMINAÇÃO RIGOROSA ENTRE NÚMEROS (0-9) E LETRAS (A-Z):
  - '0' (Zero) vs 'O' (Ó) vs 'Q': Em MAC, GPON e senhas hexadecimais, o padrão numérico é sempre o dígito '0' (Zero). O número zero tem formato mais estreito e vertical.
  - '1' (Um) vs 'I' (Í) vs 'l' (ele) vs '!': O número '1' possui serifa inclinada no topo. A letra 'I' possui haste reta (ou barras horizontais em topo e base). O símbolo '!' (exclamação) possui um ponto visível na base da haste vertical (em senhas de roteador, verifique sempre se há o ponto embaixo!).
  - '2' (Dois) vs 'Z' / 'z': O número '2' tem topo curvo e base plana reta. A letra 'Z' tem cantos retos e pontudos.
  - '3' (Três) vs 'E' / 'B': O número '3' é aberto no lado esquerdo com duas curvas fluidadas.
  - '5' (Cinco) vs 'S' / 's': O número '5' tem o topo horizontal 100% reto e um canto reto de 90° antes da curva. A letra 'S' é curva em todo o contorno.
  - '6' (Seis) vs 'G' / 'b': O número '6' tem laço fechado na base e topo curvo para a direita.
  - '8' (Oito) vs 'B': O número '8' é composto por dois laços redondos empilhados. A letra 'B' possui uma haste vertical reta no lado esquerdo.
  - '9' (Nove) vs 'g' / 'q': O número '9' assenta na linha de base com laço no topo. As letras 'g' e 'q' possuem hastes verticais que descem abaixo da linha de base.

* Validação por Contexto Cruzado:
  - Antes de finalizar a resposta, cruze as informações de forma lógica: se o SSID do Wi-Fi termina com um código de 4 dígitos hexadecimais (ex: '95C8'), compare com os últimos 4 dígitos do MAC Address lido. Use essa correspondência e similaridade visual para garantir que o MAC Address e os SSIDs estejam perfeitamente alinhados e corretos.`;

    let response: any;
    const maxAttempts = 1;
    const errorsMap: Record<string, string> = {};

    // Tentamos apenas os modelos Flash da série 3 em sequência: gemini-3.6-flash e gemini-3.5-flash
    for (const modelName of ['gemini-3.6-flash', 'gemini-3.5-flash']) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`Tentativa ${attempt} de escaneamento usando o modelo ${modelName}...`);
          
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout de 25s no modelo ${modelName}`)), 25000)
          );

          response = await Promise.race([
            ai.models.generateContent({
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
            }),
            timeoutPromise
          ]);
          scanSource = `gemini-vision (${modelName})`;
          break;
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          errorsMap[`${modelName}_attempt_${attempt}`] = errMsg;
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
      throw new Error(`Falha na leitura do Gemini. Detalhes dos erros por modelo: ${JSON.stringify(errorsMap)}`);
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
    else if (upperMfg.includes('BLU') || upperMfg.includes('CASTLE')) fabricanteNorm = 'Blu-Castle';
    else if (upperMfg.includes('KAON') || upperMfg === 'KAO' || (geminiData.modelo && String(geminiData.modelo).toUpperCase().includes('2447'))) fabricanteNorm = 'Kaon';

    let gponNorm = (geminiData.gpon_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
    if (gponNorm.startsWith('SMB8')) {
      gponNorm = 'SMBS' + gponNorm.substring(4);
    }

    let macNorm = (geminiData.mac || '').replace(/[^0-9A-F]/ig, '').toUpperCase();
    if (macNorm && macNorm.length === 12) {
      macNorm = correctMacPrefix(macNorm);
    } else {
      macNorm = 'N/A';
    }

    let cpeNorm = (geminiData.cpe_sn || '').replace(/[^A-Z0-9_-]/ig, '').toUpperCase();
    if (fabricanteNorm === 'SagemCOM' && cpeNorm && cpeNorm.length >= 14 && !cpeNorm.startsWith('N7')) {
      cpeNorm = 'N7' + cpeNorm.substring(2);
    }

    const modelNormTemp = normalizeModel(geminiData.modelo || '', fabricanteNorm);
    const modelUpper = modelNormTemp.toUpperCase();

    if (modelUpper.includes('PG2447') || modelUpper.includes('P82447') || fabricanteNorm.toUpperCase().includes('KAON')) {
      let actualGpon = '';
      if (gponNorm && (gponNorm.toUpperCase().startsWith('GPO') || gponNorm.toUpperCase().startsWith('GP0'))) {
        actualGpon = 'GPO' + gponNorm.substring(3);
      } else if (gponNorm && gponNorm.toUpperCase().startsWith('GP')) {
        actualGpon = 'GPO' + gponNorm.substring(2);
      } else if (geminiData.cpe_sn && (geminiData.cpe_sn.toUpperCase().startsWith('GPO') || geminiData.cpe_sn.toUpperCase().startsWith('GP0'))) {
        actualGpon = 'GPO' + geminiData.cpe_sn.substring(3);
      } else if (geminiData.cpe_sn && geminiData.cpe_sn.toUpperCase().startsWith('GP')) {
        actualGpon = 'GPO' + geminiData.cpe_sn.substring(2);
      } else if (cpeNorm && cpeNorm.toUpperCase().startsWith('N7')) {
        actualGpon = 'GPO' + cpeNorm.substring(2);
      } else if (gponNorm && gponNorm.toUpperCase().startsWith('N7')) {
        actualGpon = 'GPO' + gponNorm.substring(2);
      }

      if (actualGpon) {
        gponNorm = actualGpon.replace(/[^A-Z0-9]/ig, '').toUpperCase();
      }
      cpeNorm = 'N/A';
    }

    if (modelUpper.includes('PG2447') || modelUpper.includes('BCSKV630') || modelUpper.includes('BCSK') || modelUpper.includes('BC-UM221E') || modelUpper.includes('UM221E') || fabricanteNorm === 'Blu-Castle') {
      cpeNorm = 'N/A';
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

    // Converter a resposta da reimpressão ("sim"/"nao") para boolean
    const isReimpressa = String(scanResult.reimpressa).toLowerCase().trim() === 'sim';
    scanResult.reimpressa = isReimpressa;

    // VERIFICAÇÃO DE DUPLICIDADE: verifica se o GPON_SN já existe no banco de dados
    let existsInDb = false;
    let existingData = null;

    if (dbConnected && dbPool) {
      try {
        let checkRes: any = { rowCount: 0, rows: [] as any[] };
        const normModelo = normalizeModel(scanResult.modelo || '', scanResult.fabricante || '');
        const isReconcileModel = normModelo === 'NP5454T' || normModelo === 'F@ST 5670' || normModelo === 'F@ST 5670V2';
        if (isReconcileModel) {
          checkRes = await dbPool.query(
            "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE (modelo = 'NP5454T' OR modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND ((cpe_sn = $1 AND cpe_sn <> 'N/A' AND cpe_sn <> 'NA') OR (mac = $2 AND mac <> 'N/A'))",
            [scanResult.cpe_sn, scanResult.mac]
          );
        } else if (scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1 OR (cpe_sn = $2 AND cpe_sn <> \'N/A\' AND cpe_sn <> \'NA\') OR (mac = $3 AND mac <> \'N/A\')',
            [scanResult.gpon_sn, scanResult.cpe_sn, scanResult.mac]
          );
        } else if (scanResult.cpe_sn && scanResult.cpe_sn.toUpperCase() !== 'N/A' && scanResult.cpe_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE (cpe_sn = $1 AND cpe_sn <> \'N/A\' AND cpe_sn <> \'NA\') OR (mac = $2 AND mac <> \'N/A\')',
            [scanResult.cpe_sn, scanResult.mac]
          );
        } else if (scanResult.mac && scanResult.mac.toUpperCase() !== 'N/A' && scanResult.mac.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE mac = $1',
            [scanResult.mac]
          );
        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
              [scanResult.wifi_ssid]
            );
            if (checkRes.rowCount === 0) {
              const candidatesRes = await dbPool.query(
                "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL"
              );
              const matchingRows = candidatesRes.rows.filter((row: any) => {
                const normModel = row.modelo ? row.modelo.toUpperCase() : '';
                if (normModelo && normModel && !normModel.includes(normModelo.toUpperCase()) && !normModelo.toUpperCase().includes(normModel)) {
                  return false;
                }
                const isFast5670 = normModel.includes('5670');
                if (isFast5670) {
                  return matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid);
                } else {
                  const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
                  const cleanSsid = scanResult.wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
                  if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
                    const suffix = cleanSsid.slice(-4);
                    // Ignorar se o sufixo for o próprio número do modelo (ex: '2447', '5670', '6600', '5655') ou não for um hexadecimal de 4 dígitos válido
                    if (suffix === '2447' || suffix === '5670' || suffix === '6600' || suffix === '5655' || suffix === '5657' || !/^[0-9A-F]{4}$/.test(suffix)) {
                      return false;
                    }
                    return cleanMac.endsWith(suffix);
                  }
                  return false;
                }
              });

              if (matchingRows.length === 1) {
                checkRes.rows = [matchingRows[0]];
                checkRes.rowCount = 1;
              }
            }
          }

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          existsInDb = true;
          existingData = checkRes.rows[0];
          
          // Se o registro encontrado no banco é temporário (não tem GPON real)
          const isTempGpon = existingData.gpon_sn && existingData.gpon_sn.toUpperCase().startsWith('N/A');
          if (isTempGpon && scanResult.wifi_ssid) {
            // Tenta achar um registro real pré-carregado no banco que tenha o MAC compatível
            const candidatesRes = await dbPool.query(
              "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn NOT LIKE 'N/A%' AND (wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL)"
            );
            const realMatchedRow = candidatesRes.rows.find((row: any) => 
              matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid)
            );
            if (realMatchedRow) {
              // Mescla os dados do registro real (S/N, GPON, MAC) com os dados de senhas do registro temporário
              existingData = {
                ...existingData,
                gpon_sn: realMatchedRow.gpon_sn,
                mac: realMatchedRow.mac,
                cpe_sn: realMatchedRow.cpe_sn,
                fabricante: realMatchedRow.fabricante || existingData.fabricante,
                modelo: realMatchedRow.modelo || existingData.modelo
              };
            }
          }
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
app.post('/api/save-label', async (req: any, res: any) => {
  try {
    let { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, web_key, operador, overwrite, targetDb, imagem_url, operacao } = req.body;

    fabricante = normalizeFabricante(fabricante || 'N/A', modelo || '');
    // Gerar um GPON SN único se vier como N/A para não violar a UNIQUE constraint no PostgreSQL
    const normalizedModelo = normalizeModel(modelo, fabricante);
    const isFast5670 = normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';

    // Gerar um GPON SN unico se vier como N/A SEMPRE para não violar UNIQUE constraint
      if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
        const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
        gpon_sn = 'N/A_' + suffix;
      }

    const resolvedWebKey = senha !== undefined ? senha : web_key;
    let resolvedWifiSsid5g = wifi_ssid_5g || 'N/A';
    if (normalizedModelo.toUpperCase().includes('5676V2') || normalizedModelo.toUpperCase().includes('5676 V2')) {
      if (resolvedWifiSsid5g && resolvedWifiSsid5g !== 'N/A' && resolvedWifiSsid5g.trim() !== '') {
        if (!resolvedWifiSsid5g.toUpperCase().endsWith('_5G')) {
          resolvedWifiSsid5g = resolvedWifiSsid5g.trim() + '_5G';
        }
      }
    }

    if (isFast5670) {
      if (wifi_key && wifi_key.toUpperCase() !== 'N/A' && wifi_key.trim().length !== 10) {
        return res.status(400).json({ success: false, error: `A extração identificou caracteres a mais na Senha WIFI do F@ST 5670 (capturado: ${wifi_key.trim().length} caracteres). Por favor, digite a Senha WIFI manualmente na tela (esperado: 10 caracteres).` });
      }
      if (resolvedWebKey && resolvedWebKey.toUpperCase() !== 'N/A' && resolvedWebKey.trim().length !== 8 && resolvedWebKey.trim().length !== 9) {
        return res.status(400).json({ success: false, error: `A extração identificou caracteres a mais na Senha WEB do F@ST 5670 (capturado: ${resolvedWebKey.trim().length} caracteres). Por favor, digite a Senha WEB manualmente na tela (esperado: 8 ou 9 caracteres).` });
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
          const checkRes = await tempPool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE (gpon_sn = $1 AND gpon_sn <> \'N/A\' AND gpon_sn <> \'NA\') OR (mac = $2 AND mac <> \'N/A\' AND mac <> \'NA\')', [gpon_sn, mac]);
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

    let checkRes: any = { rowCount: 0 };
    let duplicateType = 'GPON Serial';

    const isReconcileModel = normalizedModelo === 'NP5454T' || normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';

    if (isReconcileModel) {
      checkRes = await pool.query(
        "SELECT * FROM etiquetas_scan_onu WHERE (modelo = 'NP5454T' OR modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND ((cpe_sn = $1 AND cpe_sn <> 'N/A' AND cpe_sn <> 'NA') OR (mac = $2 AND mac <> 'N/A'))",
        [cpe_sn, mac]
      );
      duplicateType = 'MAC ou S/N';
    } else if (gpon_sn && gpon_sn.toUpperCase() !== 'N/A' && gpon_sn.toUpperCase() !== 'NA') {
      if (mac && mac.toUpperCase() !== 'N/A' && mac.toUpperCase() !== 'NA') {
        checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = $1 OR mac = $2', [gpon_sn, mac]);
        duplicateType = 'GPON ou MAC';
      } else {
        checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
      }
    } else if (mac && mac.toUpperCase() !== 'N/A' && mac.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE mac = $1', [mac]);
      duplicateType = 'MAC';
    } else if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE wifi_ssid = $1', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }

    const exists = checkRes.rowCount && checkRes.rowCount > 0;

    if (exists && !overwrite && !isReconcileModel) {
      return res.status(400).json({
        success: false,
        error: `⚠️ Equipamento (${duplicateType}) já cadastrado no banco de dados! Operação ignorada para evitar duplicidade.`
      });
    }
    
    // NOVO: Lógica de reconciliação (IA -> Planilha)
    let reconciledGpon = null;
    let reconciledMac = null;
    let reconciledCpe = null;
      let reconciledModelo = null;
    if (!exists && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      const candidatesRes = await pool.query(
        "SELECT gpon_sn, mac, cpe_sn, fabricante, modelo FROM etiquetas_scan_onu WHERE wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL"
      );
      const matchingRows = candidatesRes.rows.filter((row: any) => {
          const normModel = row.modelo ? row.modelo.toUpperCase() : '';
          const normScanModelo = modelo ? modelo.toUpperCase() : '';
          if (normScanModelo && normModel && !normModel.includes(normScanModelo) && !normScanModelo.includes(normModel)) {
            return false;
          }
          const isFast5670 = normModel.includes('5670');
          if (isFast5670) {
            return matchMacAndSsidSuffix(row.mac, wifi_ssid);
          } else {
            const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
            const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
            if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
              const suffix = cleanSsid.slice(-4);
              // Ignorar se o sufixo for o próprio número do modelo (ex: '2447', '5670', '6600', '5655') ou não for um hexadecimal de 4 dígitos válido
              if (suffix === '2447' || suffix === '5670' || suffix === '6600' || suffix === '5655' || suffix === '5657' || !/^[0-9A-F]{4}$/.test(suffix)) {
                return false;
              }
              return cleanMac.endsWith(suffix);
            }
            return false;
          }
        });

        if (matchingRows.length === 1) {
          const matchedRow = matchingRows[0];
          reconciledGpon = matchedRow.gpon_sn;
          reconciledMac = matchedRow.mac;
          reconciledCpe = matchedRow.cpe_sn;
          if (matchedRow.fabricante) fabricante = matchedRow.fabricante;
          reconciledModelo = matchedRow.modelo;
        }
    }

    // Se estamos salvando um registro completo com GPON real, limpamos registros temporários duplicados com o mesmo SSID
    if (gpon_sn && !gpon_sn.toUpperCase().startsWith('N/A') && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A') {
      try {
        await pool.query(
          "DELETE FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND gpon_sn LIKE 'N/A%'",
          [wifi_ssid]
        );
      } catch (delErr) {
        console.error('Erro ao limpar registro temporario duplicado:', delErr);
      }
    }

    if (exists || reconciledGpon) {
        const dbRow = exists ? checkRes.rows[0] : null;

        // Função auxiliar para fundir dados da nova captura com os dados existentes do banco
        // Evita que campos válidos já preenchidos no banco sejam apagados com "N/A" ou vazio
        const getMergedValue = (newVal: any, dbVal: any) => {
          if (!newVal || newVal.toUpperCase() === 'N/A' || newVal.toUpperCase() === 'NA' || newVal.trim() === '') {
            return dbVal || 'N/A';
          }
          return newVal;
        };

        let finalFabricante = getMergedValue(fabricante, dbRow?.fabricante);
        let finalModelo = getMergedValue(reconciledModelo || normalizedModelo, dbRow?.modelo);
        let finalCpe = getMergedValue(reconciledCpe || cpe_sn, dbRow?.cpe_sn);
        let finalMac = getMergedValue(reconciledMac || mac, dbRow?.mac);
        let finalSsid = getMergedValue(wifi_ssid, dbRow?.wifi_ssid);
        let finalSsid5g = getMergedValue(resolvedWifiSsid5g, dbRow?.wifi_ssid_5g);
        let finalWifiKey = getMergedValue(wifi_key, dbRow?.wifi_key);
        let finalUsuario = getMergedValue(usuario, dbRow?.usuario);
        let finalWebKey = getMergedValue(resolvedWebKey, dbRow?.web_key);
        let finalGpon = exists ? dbRow.gpon_sn : (reconciledGpon || gpon_sn);

        const isNP5454T = dbRow?.modelo === 'NP5454T';
        const is5670 = dbRow?.modelo === 'F@ST 5670' || dbRow?.modelo === 'F@ST 5670V2';

        if (exists && dbRow && (isNP5454T || is5670)) {
          // Regras específicas do NP5454T e F@ST 5670:
          // Se for F@ST 5670, permitimos que o operador edite qualquer caractere se houver mudança.
          // Caso contrário, mantemos os dados originais do banco (regra padrão de reconciliação).
          if (is5670) {
            finalCpe = (cpe_sn && cpe_sn !== dbRow.cpe_sn) ? cpe_sn : (dbRow.cpe_sn || 'N/A');
            finalMac = (mac && mac !== dbRow.mac) ? mac : (dbRow.mac || 'N/A');
            finalFabricante = (fabricante && fabricante !== dbRow.fabricante) ? fabricante : (dbRow.fabricante || 'Sagemcom');
            finalModelo = (modelo && modelo !== dbRow.modelo) ? modelo : (dbRow.modelo || 'F@ST 5670');
            finalSsid = (wifi_ssid && wifi_ssid !== dbRow.wifi_ssid) ? wifi_ssid : (dbRow.wifi_ssid || wifi_ssid || 'N/A');
            finalSsid5g = (resolvedWifiSsid5g && resolvedWifiSsid5g !== dbRow.wifi_ssid_5g) ? resolvedWifiSsid5g : (dbRow.wifi_ssid_5g || resolvedWifiSsid5g || 'N/A');
            finalWifiKey = (wifi_key && wifi_key !== dbRow.wifi_key) ? wifi_key : ((dbRow.wifi_key && dbRow.wifi_key !== 'N/A' && dbRow.wifi_key !== 'NA') ? dbRow.wifi_key : (wifi_key || 'N/A'));
            finalWebKey = (resolvedWebKey && resolvedWebKey !== dbRow.web_key) ? resolvedWebKey : ((dbRow.web_key && dbRow.web_key !== 'N/A' && dbRow.web_key !== 'NA') ? dbRow.web_key : (resolvedWebKey || 'N/A'));
            finalUsuario = (usuario && usuario !== dbRow.usuario) ? usuario : (dbRow.usuario || 'N/A');

            if (gpon_sn && gpon_sn !== dbRow.gpon_sn) {
              finalGpon = gpon_sn;
            } else {
              // Cenário A vs B para o GPON
              const dbCpeClean = (dbRow.cpe_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
              const scanCpeClean = (cpe_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
              const dbMacClean = (dbRow.mac || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
              const scanMacClean = (mac || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();

              const cpeMatches = dbCpeClean === scanCpeClean && dbCpeClean !== '' && dbCpeClean !== 'NA' && dbCpeClean !== 'N/A';
              const macMatches = dbMacClean === scanMacClean && dbMacClean !== '' && dbMacClean !== 'NA' && dbMacClean !== 'N/A';
              const bothMatch = cpeMatches && macMatches;

              if (bothMatch) {
                finalGpon = (dbRow.gpon_sn && !dbRow.gpon_sn.toUpperCase().startsWith('N/A')) ? dbRow.gpon_sn : (gpon_sn || 'N/A');
              } else {
                finalGpon = dbRow.gpon_sn || 'N/A';
              }
            }
          } else {
            // NP5454T (Mantém 100% estrito do banco)
            finalCpe = dbRow.cpe_sn || 'N/A';
            finalMac = dbRow.mac || 'N/A';
            finalFabricante = dbRow.fabricante || 'Tellescom';
            finalModelo = dbRow.modelo || 'NP5454T';

            // Permitir editar e salvar no banco as informações de SENHA WEB e SENHA WIFI
            finalWifiKey = (wifi_key && wifi_key.trim() !== '' && wifi_key.toUpperCase() !== 'N/A' && wifi_key.toUpperCase() !== 'NA') ? wifi_key : (dbRow.wifi_key || 'N/A');
            finalWebKey = (resolvedWebKey && resolvedWebKey.trim() !== '' && resolvedWebKey.toUpperCase() !== 'N/A' && resolvedWebKey.toUpperCase() !== 'NA') ? resolvedWebKey : (dbRow.web_key || 'N/A');

            // Cenário A vs B para o GPON
            const dbCpeClean = (dbRow.cpe_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
            const scanCpeClean = (cpe_sn || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
            const dbMacClean = (dbRow.mac || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
            const scanMacClean = (mac || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();

            const cpeMatches = dbCpeClean === scanCpeClean && dbCpeClean !== '' && dbCpeClean !== 'NA' && dbCpeClean !== 'N/A';
            const macMatches = dbMacClean === scanMacClean && dbMacClean !== '' && dbMacClean !== 'NA' && dbMacClean !== 'N/A';
            const bothMatch = cpeMatches && macMatches;

            if (bothMatch) {
              // Cenário A: Completar GPON SN se não tiver no banco
              finalGpon = (dbRow.gpon_sn && !dbRow.gpon_sn.toUpperCase().startsWith('N/A')) ? dbRow.gpon_sn : (gpon_sn || 'N/A');
            } else {
              // Cenário B: Manter GPON SN inalterado (manter o que está no banco)
              finalGpon = dbRow.gpon_sn || 'N/A';
            }

            // SSIDs baseados nos 4 últimos dígitos do S/N final (apenas para o NP5454T)
            const cleanSn = finalCpe.replace(/[^A-Z0-9]/ig, '').toUpperCase();
            if (cleanSn.length >= 4 && cleanSn !== 'N/A') {
              const last4 = cleanSn.slice(-4);
              finalSsid = `TIM_ULTRAFIBRA_${last4}_2G`;
              finalSsid5g = `TIM_ULTRAFIBRA_${last4}_5G`;
            }
          }
        }

        if (exists) {
          const fieldsChanged = 
            finalFabricante.toUpperCase() !== (dbRow.fabricante || 'N/A').toUpperCase() ||
            finalModelo.toUpperCase() !== (dbRow.modelo || 'N/A').toUpperCase() ||
            finalCpe.toUpperCase() !== (dbRow.cpe_sn || 'N/A').toUpperCase() ||
            finalMac.toUpperCase() !== (dbRow.mac || 'N/A').toUpperCase() ||
            finalSsid.toUpperCase() !== (dbRow.wifi_ssid || 'N/A').toUpperCase() ||
            (finalSsid5g || 'N/A').toUpperCase() !== (dbRow.wifi_ssid_5g || 'N/A').toUpperCase() ||
            finalWifiKey !== (dbRow.wifi_key || 'N/A') ||
            finalUsuario !== (dbRow.usuario || 'N/A') ||
            finalWebKey !== (dbRow.web_key || 'N/A') ||
            finalGpon !== (dbRow.gpon_sn || 'N/A');

          if (!fieldsChanged) {
            return res.json({
              success: true,
              message: 'Dados identicos, nada foi alterado.'
            });
          }
        }

        const targetGpon = exists ? checkRes.rows[0].gpon_sn : (reconciledGpon || gpon_sn);

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
            operacao = $13,
            password_router = $14,
            gpon_sn = $15,
            data_leitura = CURRENT_TIMESTAMP
          WHERE gpon_sn = $11
      `;
      const finalPasswordRouter = (req.body.password_router !== undefined && req.body.password_router !== null && req.body.password_router.trim() !== '') ? req.body.password_router.trim() : 'N/A';

      const updateValues = [
        finalFabricante,
        finalModelo,
        finalCpe,
        finalMac,
        finalSsid,
        finalSsid5g,
        finalWifiKey,
        finalUsuario,
        finalWebKey,
        operador || 'sistema',
        targetGpon,
        zplUrl || imagem_url || null,
        operacao || 'CTDI MATRIZ',
        finalPasswordRouter,
        finalGpon
      ];
      await pool.query(updateQuery, updateValues);
      console.log(`Dados atualizados com sucesso no banco ${chosenDb}. Serial GPON alvo: ${targetGpon}`);
    } else {
      const insertQuery = `
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, password_router, operador_email, imagem_url, operacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `;
      if (!gpon_sn || gpon_sn.trim() === '' || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
          gpon_sn = 'N/A_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        }

        const finalPasswordRouter = (req.body.password_router !== undefined && req.body.password_router !== null && req.body.password_router.trim() !== '') ? req.body.password_router.trim() : 'N/A';

        const insertValues = [
          fabricante || 'N/A',
          normalizedModelo || 'N/A',
          cpe_sn || 'N/A',
          gpon_sn,
          mac || 'N/A',
          wifi_ssid || 'N/A',
          resolvedWifiSsid5g,
          wifi_key || 'N/A',
          usuario || 'N/A',
          resolvedWebKey || 'N/A',
          finalPasswordRouter,
          operador || 'sistema',
          zplUrl || imagem_url || null,
          operacao || 'CTDI MATRIZ'
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
      error: 'Erro BD: ' + (dbError.message || String(dbError)),
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
        existsInDb: true,
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
          user: { email, role: 'master' } 
        });
      }
      return res.status(401).json({ error: 'Banco desconectado. Credenciais inválidas.' });
    }

    const userRes = await dbPool.query(
      'SELECT email, role, operacao, permitir_gpon, permitir_reimpressao, tecnologias_permitidas FROM usuarios_scan_onu WHERE email = $1 AND senha = $2',
      [email.trim().toLowerCase(), senha]
    );

    if (userRes.rowCount && userRes.rowCount > 0) {
      const user = userRes.rows[0];
      
      // Gerar token de sessão criptograficamente seguro
      const token = crypto.randomBytes(32).toString('hex');
      
      // Salvar a sessão no banco com validade de 1 dia
      await dbPool.query(
        "INSERT INTO sessoes_scan_onu (token, email, role, operacao, data_expiracao) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
        [token, user.email, user.role, user.operacao || 'CTDI MATRIZ']
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
    const { email, senha, role, operacao, permitir_gpon, permitir_reimpressao, tecnologias_permitidas } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    if (req.user.role !== 'master' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem cadastrar usuários.' });
    }

    await dbPool.query(
      'INSERT INTO usuarios_scan_onu (email, senha, role, operacao, permitir_gpon, permitir_reimpressao, tecnologias_permitidas) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        email.trim().toLowerCase(), 
        senha, 
        role || 'operador', 
        operacao || 'CTDI MATRIZ',
        permitir_gpon !== undefined ? permitir_gpon : true,
        permitir_reimpressao !== undefined ? permitir_reimpressao : true,
        tecnologias_permitidas || 'IPTV,GPON,EMTA,STB'
      ]
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

// Rota para o próprio usuário alterar sua senha
app.put('/api/user/password', authenticateSession, async (req: any, res: any) => {
  try {
    const { novaSenha } = req.body;
    
    if (!novaSenha || novaSenha.trim() === '') {
      return res.status(400).json({ error: 'A nova senha não pode ser vazia.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // req.user.email was set by authenticateSession
    const email = req.user.email.trim().toLowerCase();

    await dbPool.query(
      'UPDATE usuarios_scan_onu SET senha = $1 WHERE email = $2',
      [novaSenha.trim(), email]
    );

    return res.json({ success: true, message: 'Senha alterada com sucesso!' });
  } catch (err: any) {
    console.error('Erro ao alterar senha do usuário:', err);
    return res.status(500).json({ error: 'Erro interno ao alterar senha.' });
  }
});

// Rota para editar e resetar senhas de usuários (somente Admin)
app.put('/api/admin/users', authenticateSession, async (req: any, res: any) => {
  try {
    const { id, email, senha, role, operacao, permitir_gpon, permitir_reimpressao, tecnologias_permitidas } = req.body;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    // Verificar se quem está requisitando é admin de verdade
    if (req.user.role !== 'master' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar usuários.' });
    }

    let queryText = '';
    let queryValues = [];

    if (senha && senha.trim() !== '') {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, senha = $2, role = $3, operacao = $4, permitir_gpon = $5, permitir_reimpressao = $6, tecnologias_permitidas = $7 WHERE id = $8';
      queryValues = [
        email.trim().toLowerCase(),
        senha.trim(),
        role,
        operacao || 'CTDI MATRIZ',
        permitir_gpon !== undefined ? permitir_gpon : true,
        permitir_reimpressao !== undefined ? permitir_reimpressao : true,
        tecnologias_permitidas || 'IPTV,GPON,EMTA,STB',
        id
      ];
    } else {
      queryText = 'UPDATE usuarios_scan_onu SET email = $1, role = $2, operacao = $3, permitir_gpon = $4, permitir_reimpressao = $5, tecnologias_permitidas = $6 WHERE id = $7';
      queryValues = [
        email.trim().toLowerCase(),
        role,
        operacao || 'CTDI MATRIZ',
        permitir_gpon !== undefined ? permitir_gpon : true,
        permitir_reimpressao !== undefined ? permitir_reimpressao : true,
        tecnologias_permitidas || 'IPTV,GPON,EMTA,STB',
        id
      ];
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
      return res.json({ success: true, users: [{ email: 'admin@scanonu.com', role: 'master', operacao: 'CTDI MATRIZ', permitir_gpon: true, permitir_reimpressao: true, tecnologias_permitidas: 'IPTV,GPON,EMTA,STB' }] });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const usersRes = await dbPool.query('SELECT id, email, role, operacao, permitir_gpon, permitir_reimpressao, tecnologias_permitidas FROM usuarios_scan_onu ORDER BY email ASC');
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
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
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
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
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
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
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
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
    await dbPool.query('DELETE FROM impressoras_scan_onu WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao remover impressora.' });
  }
});
// --- FIM ROTAS IMPRESSORAS ---


// --- ROTA DE IMPRESSÃO ZPL IPTV ---
app.post('/api/print-iptv', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco de dados offline.' });

    const { modelId, printerId, fieldsData, printSpeed, printDarkness } = req.body;
    if (!modelId || !printerId || !fieldsData) {
      return res.status(400).json({ error: 'Dados incompletos para impressão.' });
    }

    // 1. Obter impressora
    const printerRes = await dbPool.query('SELECT ip, porta FROM impressoras_scan_onu WHERE id = $1', [printerId]);
    if (printerRes.rowCount === 0) return res.status(404).json({ error: 'Impressora não encontrada.' });
    const printer = printerRes.rows[0];

    // 2. Obter modelo
    const modelRes = await dbPool.query('SELECT codigo_zpl, campos_config FROM modelos_zpl_iptv WHERE id = $1', [modelId]);
    if (modelRes.rowCount === 0) return res.status(404).json({ error: 'Modelo não encontrado.' });
    const model = modelRes.rows[0];

    // 3. Substituir variáveis no código ZPL
    let zpl = model.codigo_zpl;

    // Substituir velocidade e escuridão se enviados pelo client
    if (printSpeed) {
      zpl = zpl.replace(/\^PR\d+,\d+/g, `^PR${printSpeed},${printSpeed}`);
    }
    if (printDarkness) {
      zpl = zpl.replace(/~SD\d+/g, `~SD${printDarkness}`);
    }

    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato ${chave} ou \${chave\}
      const regex = new RegExp('\\$\\\{\\s*' + key + '\\s*\\\}', 'g');
      zpl = zpl.replace(regex, val);

      // Nova variável automatizada: ${campo_clean} (remove dois-pontos e espaços, ideal para código de barras)
      const valClean = val.replace(/[^A-Za-z0-9]/g, '');
      const regexClean = new RegExp('\\$\\\{\\s*' + key + '_clean\\s*\\\}', 'g');
      zpl = zpl.replace(regexClean, valClean);
    }

    // 4. Enviar para a impressora via Socket TCP
    const client = new net.Socket();
    client.setTimeout(5000); // 5 segundos timeout

    client.connect(printer.porta || 9100, printer.ip, () => {
      console.log('Conectado à impressora ' + printer.ip + ':' + printer.porta);
      client.write(zpl, 'utf8', () => {
        client.destroy(); // Fecha a conexão após enviar
        res.json({ success: true, message: 'Enviado para impressão!' });
      });
    });

    client.on('timeout', () => {
      client.destroy();
      res.status(504).json({ error: 'Timeout de conexão com a impressora.' });
    });

    client.on('error', (err: any) => {
      client.destroy();
      console.error('Erro de socket:', err);
      res.status(500).json({ error: 'Erro na impressora: ' + err.message });
    });

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao imprimir etiqueta IPTV.' });
  }
});



// --- ROTAS DE MODELOS IPTV (ADMIN E OPERADOR) ---
app.get('/api/iptv-models', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.json({ success: true, models: [] });
    const modelsRes = await dbPool.query('SELECT * FROM modelos_zpl_iptv ORDER BY nome_modelo ASC');
    return res.json({ success: true, models: modelsRes.rows });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar modelos IPTV.' });
  }
});

app.post('/api/admin/iptv-models', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { nome_modelo, codigo_zpl, campos_config, tecnologia } = req.body;
    if (!nome_modelo || !codigo_zpl || !campos_config) return res.status(400).json({ error: 'Preencha todos os campos.' });

    const insertQuery = `
      INSERT INTO modelos_zpl_iptv (nome_modelo, codigo_zpl, campos_config, tecnologia)
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
    const result = await dbPool.query(insertQuery, [nome_modelo, codigo_zpl, JSON.stringify(campos_config), tecnologia || 'IPTV']);
    return res.json({ success: true, model: result.rows[0] });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar modelo IPTV.' });
  }
});

app.put('/api/admin/iptv-models/:id', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { nome_modelo, codigo_zpl, campos_config, tecnologia } = req.body;
    
    const updateQuery = `
      UPDATE modelos_zpl_iptv 
      SET nome_modelo = $1, codigo_zpl = $2, campos_config = $3, tecnologia = $4
      WHERE id = $5 RETURNING *
    `;
    const result = await dbPool.query(updateQuery, [nome_modelo, codigo_zpl, JSON.stringify(campos_config), tecnologia || 'IPTV', req.params.id]);
    return res.json({ success: true, model: result.rows[0] });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar modelo IPTV.' });
  }
});

app.delete('/api/admin/iptv-models/:id', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco off.' });
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso negado.' });
    
    await dbPool.query('DELETE FROM modelos_zpl_iptv WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao deletar modelo IPTV.' });
  }
});



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

    if (req.user.role !== 'master' && req.user.role !== 'admin') {
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
    const { serialNumber, mac, startDate, endDate, modelo, targetDb } = req.query;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
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
    const etiquetasRes = await pool.query(queryText, queryValues);
    
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
    const { search, startDate, endDate, modelo, targetDb } = req.query;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
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
    const etiquetasRes = await pool.query(queryText, queryValues);

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

// Rota para consultar as etiquetas do banco de dados em JSON (Preview de Tabela)
app.get('/api/admin/query-labels', authenticateSession, async (req: any, res: any) => {
  try {
    const { search, startDate, endDate, modelo, targetDb } = req.query;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado.' });
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

    queryText += ' ORDER BY data_leitura DESC LIMIT 200';
    const etiquetasRes = await pool.query(queryText, queryValues);

    return res.json({ success: true, labels: etiquetasRes.rows });
  } catch (err: any) {
    console.error('Erro ao buscar etiquetas:', err);
    return res.status(500).json({ error: 'Erro ao consultar banco de dados.' });
  }
});

// Rota para deletar um registro de leitura de etiqueta
app.delete('/api/admin/scans/:gpon_sn', authenticateSession, async (req: any, res: any) => {
  try {
    const { targetDb } = req.query;
    const { gpon_sn } = req.params;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem excluir registros.' });
    }

    await pool.query('DELETE FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
    return res.json({ success: true, message: 'Leitura excluída com sucesso!' });
  } catch (err: any) {
    console.error('Erro ao excluir etiqueta:', err);
    return res.status(500).json({ error: 'Erro ao excluir registro.' });
  }
});

// Rota para importar etiquetas a partir de uma planilha Excel (somente Admin)
app.post('/api/admin/import-excel', authenticateSession, async (req: any, res: any) => {
  try {
    if (req.user.role !== 'master' && req.user.role !== 'admin') {
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
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const matchingKey = rowKeys.find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
        if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) {
          return String(row[matchingKey]).trim();
        }
      }
      return '';
    };

    for (const row of rows) {
      // Mapeamento tolerante dos cabeçalhos
      const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']);
        const modelo = modeloRaw || 'N/A';
        const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
        const fabricante = normalizeFabricante(fabricanteRaw || 'N/A', modelo);

      const cpe_sn_raw = getVal(row, ['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE', 'HOST_SERIAL_NO']);
      const cpe_sn = cpe_sn_raw || 'N/A';

      const macRaw = getVal(row, ['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr', 'MACADDR_ETHNET']);
      const mac = macRaw ? macRaw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : 'N/A';

      const wifi_ssid_raw = getVal(row, ['SSID Wi-Fi 2.4G / Único', 'SSID', 'wifi_ssid', 'SSID Wi-Fi', 'SSID Wifi', 'SSIDName', 'Rede Wi-Fi', 'Rede Wifi', 'wifi']);
      const wifi_ssid = wifi_ssid_raw || 'N/A';

      const wifi_ssid_5g_raw = getVal(row, ['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5', 'SSID2']);
      const wifi_ssid_5g = wifi_ssid_5g_raw || 'N/A';

      const wifi_key_raw = getVal(row, ['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key', 'WPA_PSK2']);
      const wifi_key = wifi_key_raw || 'N/A';

      const usuario_raw = getVal(row, ['Usuário', 'usuario', 'User', 'Usuario', 'Username', 'login', 'Login']);
      const usuario = usuario_raw || 'N/A';

      const web_key_raw = getVal(row, ['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web', 'ACCESS_KEY1', 'WPA_PSK2']);
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
      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'GPON ID', 'Serial', 'S/N', 'serial', 'CUSN']);
      let gpon_sn = gpon_sn_raw ? gpon_sn_raw.toUpperCase().trim() : '';
      if (!gpon_sn) {
        const suffix = mac !== 'N/A' ? mac : (wifi_ssid !== 'N/A' ? wifi_ssid : Math.random().toString(36).substring(7).toUpperCase());
        gpon_sn = 'N/A_' + suffix;
      }

      // NOVO: Lógica de reconciliação (Planilha -> IA)
      let reconciledWifiSsid = null;
      let reconciledWifiSsid5g = null;
      let reconciledWifiKey = null;
      let reconciledWebKey = null;

      const isFast5670 = normalizedModelo.toUpperCase() === 'F@ST 5670' || normalizedModelo.toUpperCase() === 'F@ST 5670V2';
      if (isFast5670 && mac !== 'N/A' && mac.length >= 4) {
        const macSuffix = mac.slice(-4);
        
        const orphanRes = await pool.query(
          "SELECT gpon_sn, wifi_ssid, wifi_ssid_5g, wifi_key, web_key FROM etiquetas_scan_onu WHERE (modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND UPPER(wifi_ssid) LIKE '%' || $1 || '%' AND (mac = 'N/A' OR mac = 'NA' OR mac IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          const orphanGpon = orphanRes.rows[0].gpon_sn;
          reconciledWifiSsid = orphanRes.rows[0].wifi_ssid;
          reconciledWifiSsid5g = orphanRes.rows[0].wifi_ssid_5g;
          reconciledWifiKey = orphanRes.rows[0].wifi_key;
          reconciledWebKey = orphanRes.rows[0].web_key;
          
          await pool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn = $1", [orphanGpon]);
          console.log(`Registro órfão ${orphanGpon} deletado para reconciliação com o MAC ${mac}`);
        }
      }

      try {
        const query = `
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email, operacao)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = COALESCE(NULLIF(EXCLUDED.cpe_sn, 'N/A'), etiquetas_scan_onu.cpe_sn),
            mac = COALESCE(NULLIF(EXCLUDED.mac, 'N/A'), etiquetas_scan_onu.mac),
            wifi_ssid = COALESCE(NULLIF(EXCLUDED.wifi_ssid, 'N/A'), etiquetas_scan_onu.wifi_ssid),
            wifi_ssid_5g = COALESCE(NULLIF(EXCLUDED.wifi_ssid_5g, 'N/A'), etiquetas_scan_onu.wifi_ssid_5g),
            wifi_key = COALESCE(NULLIF(EXCLUDED.wifi_key, 'N/A'), etiquetas_scan_onu.wifi_key),
            usuario = COALESCE(NULLIF(EXCLUDED.usuario, 'N/A'), etiquetas_scan_onu.usuario),
            web_key = COALESCE(NULLIF(EXCLUDED.web_key, 'N/A'), etiquetas_scan_onu.web_key),
            operador_email = EXCLUDED.operador_email,
            operacao = EXCLUDED.operacao,
            data_leitura = CURRENT_TIMESTAMP
        `;
        const values = [
          fabricante,
          normalizedModelo,
          cpe_sn,
          gpon_sn,
          mac,
          reconciledWifiSsid || wifi_ssid,
          reconciledWifiSsid5g || finalWifiSsid5g,
          reconciledWifiKey || wifi_key,
          usuario,
          reconciledWebKey || web_key,
          operador_email,
          req.user.operacao || 'CTDI MATRIZ'
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
    if (req.user.role !== 'master' && req.user.role !== 'admin') {
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
    
        const rows = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'A planilha está vazia ou não pôde ser lida.' });
    }

    console.log('--- DEBUG IMPORT EXCEL ---');
    console.log('Headers encontrados:', Object.keys(rows[0]));
    console.log('Primeira linha:', rows[0]);
    console.log('--------------------------');

    const getVal = (row: any, keys: string[]) => {
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const matchingKey = rowKeys.find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
        if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) {
          return String(row[matchingKey]).trim();
        }
      }
      return '';
    };

    const parsedRows = [];
    for (const row of rows) {
      const modeloRaw = getVal(row, ['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']);
        const modelo = modeloRaw || 'N/A';
        const fabricanteRaw = getVal(row, ['Fabricante', 'fabricante', 'Manufacturer', 'manufacturer', 'Brand', 'brand']);
        const fabricante = normalizeFabricante(fabricanteRaw || 'N/A', modelo);

      const cpe_sn_raw = getVal(row, ['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE', 'HOST_SERIAL_NO']);
      const cpe_sn = cpe_sn_raw || 'N/A';

      const macRaw = getVal(row, ['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr', 'MACADDR_ETHNET']);
      const mac = macRaw ? macRaw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : 'N/A';

      const wifi_ssid_raw = getVal(row, ['SSID Wi-Fi 2.4G / Único', 'SSID', 'wifi_ssid', 'SSID Wi-Fi', 'SSID Wifi', 'SSIDName', 'Rede Wi-Fi', 'Rede Wifi', 'wifi']);
      const wifi_ssid = wifi_ssid_raw || 'N/A';

      const wifi_ssid_5g_raw = getVal(row, ['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5', 'SSID2']);
      const wifi_ssid_5g = wifi_ssid_5g_raw || 'N/A';

      const wifi_key_raw = getVal(row, ['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key', 'WPA_PSK2']);
      const wifi_key = wifi_key_raw || 'N/A';

      const usuario_raw = getVal(row, ['Usuário', 'usuario', 'User', 'Usuario', 'Username', 'login', 'Login']);
      const usuario = usuario_raw || 'N/A';

      const web_key_raw = getVal(row, ['Senha WEB', 'web_key', 'Senha Web', 'Web_Key', 'WebKey', 'Web Key', 'senha_web', 'ACCESS_KEY1', 'WPA_PSK2', 'Senha', 'senha', 'Password', 'Pass']);
      const web_key = web_key_raw || 'N/A';

      const password_router_raw = getVal(row, ['PASSWORD_ROUTER', 'password_router', 'Password Router', 'Password_Router', 'Router Password', 'router_password']);
      const password_router = password_router_raw || 'N/A';

      const normalizedModelo = normalizeModel(modelo, fabricante);

      let finalWifiSsid5g = wifi_ssid_5g;
      if (normalizedModelo.toUpperCase().includes('5676V2') || normalizedModelo.toUpperCase().includes('5676 V2')) {
        if (finalWifiSsid5g && finalWifiSsid5g !== 'N/A' && finalWifiSsid5g.trim() !== '') {
          if (!finalWifiSsid5g.toUpperCase().endsWith('_5G')) {
            finalWifiSsid5g = finalWifiSsid5g.trim() + '_5G';
          }
        }
      }

      const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'GPON ID', 'Serial', 'S/N', 'serial', 'CUSN']);
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
        password_router,
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
    if (req.user.role !== 'master' && req.user.role !== 'admin') {
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
      let reconciledWifiSsid = null;
      let reconciledWifiSsid5g = null;
      let reconciledWifiKey = null;
      let reconciledWebKey = null;
      
      const normalizedModelo = row.modelo || 'N/A';
      const mac = row.mac || 'N/A';
      
      const isFast5670 = normalizedModelo.toUpperCase() === 'F@ST 5670' || normalizedModelo.toUpperCase() === 'F@ST 5670V2';
      if (isFast5670 && mac !== 'N/A' && mac.length >= 4) {
        const macSuffix = mac.slice(-4);
        
        const orphanRes = await pool.query(
          "SELECT gpon_sn, wifi_ssid, wifi_ssid_5g, wifi_key, web_key FROM etiquetas_scan_onu WHERE (modelo = 'F@ST 5670' OR modelo = 'F@ST 5670V2') AND UPPER(wifi_ssid) LIKE '%' || $1 || '%' AND (mac = 'N/A' OR mac = 'NA' OR mac IS NULL)",
          [macSuffix]
        );
        if (orphanRes.rowCount && orphanRes.rowCount > 0) {
          const orphanGpon = orphanRes.rows[0].gpon_sn;
          reconciledWifiSsid = orphanRes.rows[0].wifi_ssid;
          reconciledWifiSsid5g = orphanRes.rows[0].wifi_ssid_5g;
          reconciledWifiKey = orphanRes.rows[0].wifi_key;
          reconciledWebKey = orphanRes.rows[0].web_key;
          
          await pool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn = $1", [orphanGpon]);
          console.log(`Registro órfão ${orphanGpon} deletado para reconciliação no lote com o MAC ${mac}`);
        }
      }

      const rowPasswordRouter = (row.password_router !== undefined && row.password_router !== null && String(row.password_router).trim() !== '') ? String(row.password_router).trim() : 'N/A';

      try {
        const query = `
          INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, password_router, operador_email, operacao)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (gpon_sn) DO UPDATE SET
            fabricante = EXCLUDED.fabricante,
            modelo = EXCLUDED.modelo,
            cpe_sn = COALESCE(NULLIF(EXCLUDED.cpe_sn, 'N/A'), etiquetas_scan_onu.cpe_sn),
            mac = COALESCE(NULLIF(EXCLUDED.mac, 'N/A'), etiquetas_scan_onu.mac),
            wifi_ssid = COALESCE(NULLIF(EXCLUDED.wifi_ssid, 'N/A'), etiquetas_scan_onu.wifi_ssid),
            wifi_ssid_5g = COALESCE(NULLIF(EXCLUDED.wifi_ssid_5g, 'N/A'), etiquetas_scan_onu.wifi_ssid_5g),
            wifi_key = COALESCE(NULLIF(EXCLUDED.wifi_key, 'N/A'), etiquetas_scan_onu.wifi_key),
            usuario = COALESCE(NULLIF(EXCLUDED.usuario, 'N/A'), etiquetas_scan_onu.usuario),
            web_key = COALESCE(NULLIF(EXCLUDED.web_key, 'N/A'), etiquetas_scan_onu.web_key),
            password_router = COALESCE(NULLIF(EXCLUDED.password_router, 'N/A'), etiquetas_scan_onu.password_router),
            operador_email = EXCLUDED.operador_email,
            operacao = EXCLUDED.operacao,
            data_leitura = CURRENT_TIMESTAMP
        `;
        const values = [
          row.fabricante || 'N/A',
          row.modelo || 'N/A',
          row.cpe_sn || 'N/A',
          row.gpon_sn,
          row.mac || 'N/A',
          reconciledWifiSsid || row.wifi_ssid || 'N/A',
          reconciledWifiSsid5g || row.wifi_ssid_5g || 'N/A',
          reconciledWifiKey || row.wifi_key || 'N/A',
          row.usuario || 'N/A',
          reconciledWebKey || row.web_key || 'N/A',
          rowPasswordRouter,
          operatorEmail,
          req.user.operacao || 'CTDI MATRIZ'
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

app.post('/api/external/fix-models', async (req, res) => {
  try {
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedApiKey = process.env.EXTERNAL_API_KEY;

    if (!expectedApiKey || expectedApiKey.trim() === '') {
      return res.status(503).json({ success: false, error: 'EXTERNAL_API_KEY não configurada.' });
    }

    if (apiKeyHeader !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave inválida.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    const query = `
      UPDATE etiquetas_scan_onu 
      SET modelo = 'PG2447', 
          fabricante = 'Kaon' 
      WHERE modelo ILIKE '%2447%' 
         OR modelo ILIKE '%P82447%' 
         OR modelo ILIKE '%PG2447%' 
         OR (fabricante ILIKE '%KAON%' AND (modelo ILIKE '%PG%' OR modelo ILIKE '%P8%' OR modelo ILIKE '%2447%'));
    `;

    const result = await dbPool.query(query);
    res.json({ success: true, updatedCount: result.rowCount, message: 'Modelos PG2447 padronizados no banco de dados com sucesso.' });
  } catch (err: any) {
    console.error('Erro ao padronizar modelos no banco:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao tentar padronizar modelos.' });
  }
});

app.delete('/api/external/duplicates', async (req, res) => {
  try {
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedApiKey = process.env.EXTERNAL_API_KEY;

    if (!expectedApiKey || expectedApiKey.trim() === '') {
      return res.status(503).json({ success: false, error: 'EXTERNAL_API_KEY não configurada.' });
    }

    if (apiKeyHeader !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave inválida.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    const query = `
      DELETE FROM etiquetas_scan_onu 
      WHERE gpon_sn IN (
          SELECT gpon_sn 
          FROM (
              SELECT gpon_sn,
                     ROW_NUMBER() OVER(PARTITION BY mac ORDER BY data_leitura DESC) as rn
              FROM etiquetas_scan_onu
              WHERE mac IS NOT NULL AND mac != 'N/A' AND mac != ''
          ) t
          WHERE t.rn > 1
      );
    `;

    const result = await dbPool.query(query);
    res.json({ success: true, deletedCount: result.rowCount, message: 'Duplicatas removidas com sucesso.' });
  } catch (err: any) {
    console.error('Erro ao deletar duplicatas:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao tentar apagar duplicatas.' });
  }
});

app.post('/api/external/delete-manufacturer', async (req, res) => {
  try {
    const apiKeyHeader = req.headers['x-api-key'];
    const expectedApiKey = process.env.EXTERNAL_API_KEY;

    if (!expectedApiKey || expectedApiKey.trim() === '') {
      return res.status(503).json({ success: false, error: 'EXTERNAL_API_KEY não configurada.' });
    }

    if (apiKeyHeader !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave inválida.' });
    }

    if (!dbConnected || !dbPool) {
      return res.status(503).json({ success: false, error: 'Banco de dados não está conectado.' });
    }

    const targetMfg = (req.body.fabricante || 'TELLESCOM').trim().toUpperCase();

    const query = `
      DELETE FROM etiquetas_scan_onu 
      WHERE UPPER(fabricante) LIKE '%' || $1 || '%';
    `;

    let totalDeleted = 0;
    const databases = ['db-scanonu', 'ScanONU_Claro'];
    for (const dbName of databases) {
      try {
        const pool = getPoolForDatabase(dbName);
        if (pool) {
          const result = await pool.query(query, [targetMfg]);
          totalDeleted += (result.rowCount || 0);
          console.log(`Deletados ${result.rowCount} registros do fabricante ${targetMfg} no banco ${dbName}`);
        }
      } catch (err) {
        console.error(`Erro ao deletar registros no banco ${dbName}:`, err);
      }
    }

    res.json({ success: true, deletedCount: totalDeleted, message: `Deletados ${totalDeleted} registros do fabricante ${targetMfg} nos bancos de dados.` });
  } catch (err: any) {
    console.error('Erro ao deletar fabricante no banco:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao tentar deletar fabricante.' });
  }
});

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

    let queryText = 'SELECT ROW_NUMBER() OVER (ORDER BY data_leitura ASC)::integer AS id, fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, COALESCE(password_router, web_key) AS password_router, web_key AS senha, operador_email, data_leitura FROM etiquetas_scan_onu WHERE 1=1';
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

