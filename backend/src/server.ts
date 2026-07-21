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
    // Tentar rodar com o modelo padrão disponível (gemini-1.5-flash ou gemini-2.0-flash)
    for (const modelName of ['gemini-1.5-flash', 'gemini-2.0-flash']) {
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
    if (!checkEtiq.rows.some(r => r.column_name === 'operacao')) {
      await pool.query("ALTER TABLE etiquetas_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
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
        if (!checkEtiq.rows.some(r => r.column_name === 'operacao')) {
          await dbPool.query("ALTER TABLE etiquetas_scan_onu ADD COLUMN operacao VARCHAR(100) DEFAULT 'CTDI MATRIZ'");
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
  // Permite uma margem de offset de até 15 hex em qualquer direção (positivo ou negativo)
  return Math.abs(diff) <= 15;
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
  // Kaon PG2447 / P82447
  if (modelClean.includes('PG2447') || modelClean.includes('P82447') || modelClean.includes('82447') || (mfgUpper.includes('KAON') && modelClean.includes('2447'))) {
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

DIRETRIZES DE ASSERTIVIDADE VISUAL DE CARACTERES (APLIQUE A TODOS OS CAMPOS):
* Diferenciação de Letras e Números Semelhantes (Importante para GPON, MAC, CPE, Senhas e SSIDs):
  - '8' vs 'B' vs 'G': Olhe atentamente os contornos. Um erro aqui invalida o serial.
  - '0' (Zero) vs 'O' (letra) vs 'Q': Em campos hexadecimais (como MAC e a parte final de GPONs), o correto é sempre usar o número '0' (Zero).
  - '1' vs 'I' vs 'L' vs 'T': Verifique se há serifa ou se o traço é 100% vertical.
  - '5' vs 'S': Dobre a atenção nas curvas de cantos.
  - '2' vs 'Z': Analise se a base é reta ou curvada.
  - 'U' vs 'V': Verifique se o fundo da letra é arredondado ou pontiagudo.
* Diferenciação de Maiúsculas e Minúsculas com Grafia Idêntica (ex: X/x, C/c, O/o, S/s, Z/z, V/v):
  - Avalie com rigor a altura vertical relativa do caractere em comparação com os números ou caracteres adjacentes. Se o caractere tiver a mesma altura de topo de um número ou letra maiúscula adjacente, ele é MAIÚSCULO. Se tiver cerca de metade da altura vertical (x-height) de seus vizinhos, ele é MINÚSCULO.
* Validação por Contexto Cruzado:
  - Antes de finalizar a resposta, cruze as informações de forma lógica: se o SSID do Wi-Fi termina com um código de 4 dígitos hexadecimais (ex: '95C8'), compare com os últimos 4 dígitos do MAC Address lido. Use essa correspondência e similaridade visual para garantir que o MAC Address e os SSIDs estejam perfeitamente alinhados e corretos.`;

    let response: any;
    const maxAttempts = 2;
    let lastError: any = null;

    // Tentamos os modelos mais recentes e estáveis em sequência: gemini-1.5-flash e gemini-2.0-flash
    for (const modelName of ['gemini-1.5-flash', 'gemini-2.0-flash']) {
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
    else if (upperMfg.includes('BLU') || upperMfg.includes('CASTLE')) fabricanteNorm = 'Blu-Castle';
    else if (upperMfg.includes('KAON') || upperMfg === 'KAO') fabricanteNorm = 'Kaon';

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
      if (gponNorm && gponNorm.startsWith('GP')) {
        actualGpon = gponNorm;
      } else if (geminiData.cpe_sn && geminiData.cpe_sn.toUpperCase().startsWith('GP')) {
        actualGpon = geminiData.cpe_sn.toUpperCase();
      } else if (cpeNorm && cpeNorm.startsWith('N7')) {
        actualGpon = 'GP' + cpeNorm.substring(2);
      }

      if (actualGpon) {
        gponNorm = actualGpon.replace(/[^A-Z0-9]/ig, '');
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

    // Regra específica para o modelo 5670V2: a senha web (web_key) deve ter exatamente 8 caracteres
    const is5670v2 = scanResult.modelo && (scanResult.modelo.toUpperCase().includes('5670V2') || scanResult.modelo.toUpperCase().includes('5670 V2'));
    if (is5670v2) {
      const webKeyLength = (scanResult.web_key || '').length;
      if (webKeyLength !== 8 && webKeyLength !== 9) {
        throw new Error(`Erro de leitura OCR (SN: ${scanResult.gpon_sn}): O modelo ${scanResult.modelo} exige que a Senha Web tenha 8 ou 9 caracteres. O sistema extraiu ${webKeyLength} caracteres ("${scanResult.web_key}"). Por favor, tente focar melhor a câmera, ou digite os dados manualmente.`);
      }
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
        const isScanFast5670 = normModelo === 'F@ST 5670' || normModelo === 'F@ST 5670V2';
        
        if (scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1 OR (cpe_sn = $2 AND cpe_sn <> \'N/A\' AND cpe_sn <> \'NA\') OR (mac = $3 AND mac <> \'N/A\')',
            [scanResult.gpon_sn, scanResult.cpe_sn, scanResult.mac]
          );
        } else if (scanResult.cpe_sn && scanResult.cpe_sn.toUpperCase() !== 'N/A' && scanResult.cpe_sn.toUpperCase() !== 'NA') {
          checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE (cpe_sn = $1 AND cpe_sn <> \'N/A\' AND cpe_sn <> \'NA\') OR (mac = $2 AND mac <> \'N/A\')',
            [scanResult.cpe_sn, scanResult.mac]
          );
        } else if (scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {
            checkRes = await dbPool.query(
              'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1',
              [scanResult.wifi_ssid]
            );
            if (checkRes.rowCount === 0) {
              const candidatesRes = await dbPool.query(
                "SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = 'N/A' OR wifi_ssid = 'NA' OR wifi_ssid IS NULL"
              );
              const matchingRows = candidatesRes.rows.filter((row: any) => {
                const normModel = row.modelo ? row.modelo.toUpperCase() : '';
                const isFast5670 = normModel.includes('5670');
                if (isFast5670) {
                  return matchMacAndSsidSuffix(row.mac, scanResult.wifi_ssid);
                } else {
                  const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
                  const cleanSsid = scanResult.wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
                  if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
                    return cleanMac.endsWith(cleanSsid.slice(-4));
                  }
                  return false;
                }
              });

              if (matchingRows.length > 1) {
                return res.json({
                  success: false,
                  error: 'Separe esta unidade e entregue para o seu Líder'
                });
              } else if (matchingRows.length === 1) {
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
        return res.status(400).json({ success: false, error: `Senha WIFI inválida para F@ST 5670. Esperado: 10 caracteres. Capturado: ${wifi_key.trim().length} (${wifi_key})` });
      }
      if (resolvedWebKey && resolvedWebKey.toUpperCase() !== 'N/A' && resolvedWebKey.trim().length !== 8) {
        return res.status(400).json({ success: false, error: `Senha WEB inválida para F@ST 5670. Esperado: 8 caracteres. Capturado: ${resolvedWebKey.trim().length} (${resolvedWebKey})` });
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

    if (gpon_sn && gpon_sn.toUpperCase() !== 'N/A' && gpon_sn.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
    } else if (wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {
      checkRes = await pool.query('SELECT * FROM etiquetas_scan_onu WHERE wifi_ssid = $1', [wifi_ssid]);
      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';
    }

    const exists = checkRes.rowCount && checkRes.rowCount > 0;
    
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
          const isFast5670 = normModel.includes('5670');
          if (isFast5670) {
            return matchMacAndSsidSuffix(row.mac, wifi_ssid);
          } else {
            const cleanMac = row.mac ? row.mac.replace(/[^0-9A-FA-F]/g, '').toUpperCase() : '';
            const cleanSsid = wifi_ssid.replace(/_(2G|5G)$/i, '').trim().toUpperCase();
            if (cleanMac.length >= 4 && cleanSsid.length >= 4) {
              return cleanMac.endsWith(cleanSsid.slice(-4));
            }
            return false;
          }
        });

        if (matchingRows.length > 1) {
          return res.status(400).json({
            error: 'Separe esta unidade e entregue para o seu Líder'
          });
        } else if (matchingRows.length === 1) {
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

        const finalFabricante = getMergedValue(fabricante, dbRow?.fabricante);
        const finalModelo = getMergedValue(reconciledModelo || normalizedModelo, dbRow?.modelo);
        const finalCpe = getMergedValue(reconciledCpe || cpe_sn, dbRow?.cpe_sn);
        const finalMac = getMergedValue(reconciledMac || mac, dbRow?.mac);
        const finalSsid = getMergedValue(wifi_ssid, dbRow?.wifi_ssid);
        const finalSsid5g = getMergedValue(resolvedWifiSsid5g, dbRow?.wifi_ssid_5g);
        const finalWifiKey = getMergedValue(wifi_key, dbRow?.wifi_key);
        const finalUsuario = getMergedValue(usuario, dbRow?.usuario);
        const finalWebKey = getMergedValue(resolvedWebKey, dbRow?.web_key);

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
            finalWebKey !== (dbRow.web_key || 'N/A');

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
            data_leitura = CURRENT_TIMESTAMP
          WHERE gpon_sn = $11
      `;
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
        operacao || 'CTDI MATRIZ'
      ];
      await pool.query(updateQuery, updateValues);
      console.log(`Dados atualizados com sucesso no banco ${chosenDb}. Serial GPON alvo: ${targetGpon}`);
    } else {
      const insertQuery = `
        INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, operador_email, imagem_url, operacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `;
      if (!gpon_sn || gpon_sn.trim() === '' || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
          gpon_sn = 'N/A_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        }

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

      const web_key_raw = getVal(row, ['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web', 'ACCESS_KEY1', 'WPA_PSK2']);
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

