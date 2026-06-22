import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Pool } from 'pg';
import { create } from 'xmlbuilder2';

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

      // Criar a tabela de etiquetas
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS etiquetas_scan_onu (
          id SERIAL PRIMARY KEY,
          fabricante VARCHAR(100) NOT NULL,
          modelo VARCHAR(100) NOT NULL,
          cpe_sn VARCHAR(100),
          gpon_sn VARCHAR(100) UNIQUE, -- Adicionado UNIQUE para validação de duplicidade
          mac VARCHAR(100),
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

      // Garantir que a constraint UNIQUE exista caso a tabela já tenha sido criada anteriormente sem ela
      try {
        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD CONSTRAINT unique_gpon_sn UNIQUE (gpon_sn)');
        console.log('Constraint UNIQUE (gpon_sn) adicionada.');
      } catch (e) {}

      // Cadastrar o admin padrão se não houver usuários cadastrados no banco
      const userCountRes = await dbPool.query('SELECT COUNT(*) FROM usuarios_scan_onu');
      if (parseInt(userCountRes.rows[0].count) === 0) {
        await dbPool.query(
          "INSERT INTO usuarios_scan_onu (email, senha, role) VALUES ('admin@scanonu.com', 'admin123', 'admin')"
        );
        console.log('Usuário admin padrão (admin@scanonu.com / admin123) cadastrado com sucesso.');
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
    let scanResult: any = null;
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
      // VERIFICAÇÃO DE DUPLICIDADE: antes de retornar, verificamos se o GPON_SN já existe no banco de dados
      let existsInDb = false;
      let existingData = null;

      if (dbConnected && dbPool && scanResult.gpon_sn) {
        try {
          const checkRes = await dbPool.query(
            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_key, usuario, senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',
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

      return res.json({ 
        success: true, 
        data: scanResult,
        existsInDb,
        existingData
      });
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

// Nova rota para salvar ou atualizar (sobrescrever) os dados no banco PostgreSQL
app.post('/api/save-label', async (req, res) => {
  try {
    const { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_key, usuario, senha, operador, overwrite } = req.body;

    if (!dbConnected || !dbPool) {
      console.warn("PostgreSQL não está conectado. Simulando gravação com sucesso.");
      return res.json({ 
        success: true, 
        message: 'Dados simulados com sucesso (PostgreSQL desativado no momento).',
        savedData: req.body
      });
    }

    // Se não for pedido explicitamente para sobrescrever (overwrite = true), vamos verificar novamente
    if (!overwrite) {
      const checkRes = await dbPool.query('SELECT id FROM etiquetas_scan_onu WHERE gpon_sn = $1', [gpon_sn]);
      if (checkRes.rowCount && checkRes.rowCount > 0) {
        return res.status(409).json({
          success: false,
          conflict: true,
          error: 'Equipamento com este GPON Serial já existe no banco de dados.'
        });
      }
    }

    // Usamos a sintaxe INSERT ... ON CONFLICT (gpon_sn) DO UPDATE para atualizar os valores se overwrite for verdadeiro
    const query = `
      INSERT INTO etiquetas_scan_onu (fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_key, usuario, senha, operador_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (gpon_sn) 
      DO UPDATE SET 
        fabricante = EXCLUDED.fabricante,
        modelo = EXCLUDED.modelo,
        cpe_sn = EXCLUDED.cpe_sn,
        mac = EXCLUDED.mac,
        wifi_key = EXCLUDED.wifi_key,
        usuario = EXCLUDED.usuario,
        senha = EXCLUDED.senha,
        operador_email = EXCLUDED.operador_email,
        data_leitura = CURRENT_TIMESTAMP
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
    console.log(`Dados salvos/sobrescritos com sucesso no banco de dados. Serial GPON: ${gpon_sn}`);
    
    return res.json({ 
      success: true, 
      message: overwrite 
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

    queryText += ' ORDER BY data_leitura DESC';
    const etiquetasRes = await dbPool.query(queryText, queryValues);
    
    // Construção do XML usando xmlbuilder2
    const root = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('scanonu')
        .ele('etiquetas');

    etiquetasRes.rows.forEach((row) => {
      root.ele('onu')
        .ele('id').txt(String(row.id)).up()
        .ele('fabricante').txt(row.fabricante || '').up()
        .ele('modelo').txt(row.modelo || '').up()
        .ele('cpe_sn').txt(row.cpe_sn || '').up()
        .ele('gpon_sn').txt(row.gpon_sn || '').up()
        .ele('mac').txt(row.mac || '').up()
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

// Todas as outras rotas GET servem o index.html do React em produção
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.listen(PORT, () => {
  console.log(`Servidor ScanONU rodando na porta http://localhost:${PORT}`);
});

