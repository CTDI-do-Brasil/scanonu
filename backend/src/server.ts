import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Pool } from 'pg';

dotenv.config();

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

// Tenta conectar ao banco de dados se a variável DATABASE_URL existir
async function connectToDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    try {
      console.log(`Tentando conectar ao PostgreSQL...`);
      dbPool = new Pool({
        connectionString: connectionString,
        ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
          ? false 
          : { rejectUnauthorized: false } // Habilita SSL para conexões de produção na nuvem
      });

      // Validar conexão rodando um SELECT simples
      await dbPool.query('SELECT NOW()');
      dbConnected = true;
      console.log('Conexão estabelecida com sucesso com o PostgreSQL.');

      // Criar a tabela automaticamente se não existir
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS etiquetas_scan_onu (
          id SERIAL PRIMARY KEY,
          fabricante VARCHAR(100) NOT NULL,
          modelo VARCHAR(100) NOT NULL,
          cpe_sn VARCHAR(100),
          gpon_sn VARCHAR(100),
          mac VARCHAR(100),
          wifi_key VARCHAR(100),
          usuario VARCHAR(100),
          senha VARCHAR(100),
          operador_email VARCHAR(150),
          data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await dbPool.query(createTableQuery);
      console.log('Tabela "etiquetas_scan_onu" validada/criada com sucesso no PostgreSQL.');

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

// Configuração do Schema do Gemini
const scanResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    fabricante: { type: Type.STRING, description: 'Fabricante do equipamento (ex: Huawei, ZTE, FiberHome, Intelbras)' },
    modelo: { type: Type.STRING, description: 'Modelo exato do equipamento' },
    cpe_sn: { type: Type.STRING, description: 'CPE Serial Number / S/N do equipamento se disponível' },
    gpon_sn: { type: Type.STRING, description: 'GPON Serial Number (S/N) ou ALCL/ZTEG... Serial Number' },
    mac: { type: Type.STRING, description: 'Endereço MAC da ONU' },
    wifi_key: { type: Type.STRING, description: 'Chave/Senha do Wi-Fi padrão impresso na etiqueta' },
    usuario: { type: Type.STRING, description: 'Usuário padrão de login/administração se houver' },
    senha: { type: Type.STRING, description: 'Senha padrão de login/administração (Pass/Password) se houver' }
  },
  required: ['fabricante', 'modelo', 'cpe_sn', 'gpon_sn', 'mac', 'wifi_key', 'usuario', 'senha']
};

const SYSTEM_INSTRUCTION = `Você é um sistema de leitura de etiquetas de equipamentos de rede (ONU).
Extraia com alta precisão os seguintes dados da imagem da etiqueta fornecida: fabricante, modelo, CPE S/N (cpe_sn), GPON S/N (gpon_sn), MAC, Wi-Fi Key (wifi_key), User name (usuario) e Password (senha).
Regras: Retorne apenas JSON válido conforme o esquema tipado. Não invente dados de placeholders. Preserve exatamente os caracteres como grafados. O campo Password é crítico e deve ser analisado com máxima atenção. Se algum campo não for encontrado na etiqueta, deixe como string vazia ("").`;

// Modelos do cascade em ordem de prioridade
const MODEL_CASCADE = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-3.5-flash'
];

app.post('/api/scan-label', async (req, res) => {
  try {
    const { image } = req.body; // Base64 image data: "data:image/jpeg;base64,..." ou apenas base64 string

    if (!image) {
      return res.status(400).json({ error: 'Nenhuma imagem foi fornecida no corpo da requisição.' });
    }

    // Extrair apenas os dados base64 brutos e o mimeType
    let base64Data = image;
    let mimeType = 'image/jpeg';

    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("Aviso: GEMINI_API_KEY não configurada no arquivo .env. Tentando usar variável de ambiente global.");
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey || process.env.GEMINI_API_KEY
    });

    let success = false;
    let scanResult = null;
    let errors: string[] = [];

    // Tentar processar a imagem utilizando cascata de modelos
    for (const modelName of MODEL_CASCADE) {
      try {
        console.log(`Tentando processar a imagem com o modelo: ${modelName}`);
        
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: SYSTEM_INSTRUCTION
                },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: scanResponseSchema,
            temperature: 0.1
          }
        });

        const responseText = response.text;
        if (responseText) {
          scanResult = JSON.parse(responseText);
          success = true;
          console.log(`Sucesso com o modelo ${modelName}!`);
          break;
        } else {
          throw new Error('Resposta vazia retornada pelo modelo.');
        }
      } catch (err: any) {
        console.error(`Falha no modelo ${modelName}:`, err.message || err);
        errors.push(`${modelName}: ${err.message || JSON.stringify(err)}`);
      }
    }

    if (success && scanResult) {
      return res.json({ success: true, data: scanResult });
    } else {
      console.error("Todos os modelos na cascata falharam:", errors);
      return res.status(502).json({
        success: false,
        error: 'Não foi possível extrair os dados da etiqueta. Todos os modelos de visão falharam.',
        details: errors
      });
    }

  } catch (globalError: any) {
    console.error('Erro interno do servidor:', globalError);
    return res.status(500).json({
      success: false,
      error: 'Erro interno no servidor ao processar a imagem.',
      details: globalError.message || String(globalError)
    });
  }
});

// Nova rota para salvar os dados no banco PostgreSQL
app.post('/api/save-label', async (req, res) => {
  try {
    const { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_key, usuario, senha, operador } = req.body;

    if (!dbConnected || !dbPool) {
      // Se o banco não estiver configurado/conectado, apenas simularemos o salvamento com sucesso
      console.warn("PostgreSQL não está conectado. Simulando gravação com sucesso.");
      return res.json({ 
        success: true, 
        message: 'Dados simulados com sucesso (PostgreSQL desativado no momento).',
        savedData: req.body
      });
    }

    const query = `
      INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_key, usuario, senha, operador_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const values = [
      fabricante || '',
      modelo || '',
      cpe_sn || '',
      gpon_sn || '',
      mac || '',
      wifi_key || '',
      usuario || '',
      senha || '',
      operador || 'sistema'
    ];

    await dbPool.query(query, values);
    console.log(`Nova ONU inserida com sucesso no banco de dados. Serial GPON: ${gpon_sn}`);
    
    return res.json({ 
      success: true, 
      message: 'Dados salvos com sucesso no PostgreSQL!' 
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

// Todas as outras rotas GET servem o index.html do React em produção
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.listen(PORT, () => {
  console.log(`Servidor ScanONU rodando na porta http://localhost:${PORT}`);
});

