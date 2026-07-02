const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

const iptvTable1 = `
  // Criar tabela de modelos IPTV
  const createIptvModelsTableQuery = \`
    CREATE TABLE IF NOT EXISTS modelos_zpl_iptv (
      id SERIAL PRIMARY KEY,
      nome_modelo VARCHAR(150) NOT NULL,
      codigo_zpl TEXT NOT NULL,
      campos_config JSONB NOT NULL,
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  \`;
  await pool.query(createIptvModelsTableQuery);
`;

const iptvTable2 = `
      // Criar tabela de modelos IPTV
      const createIptvModelsTableQuery = \`
        CREATE TABLE IF NOT EXISTS modelos_zpl_iptv (
          id SERIAL PRIMARY KEY,
          nome_modelo VARCHAR(150) NOT NULL,
          codigo_zpl TEXT NOT NULL,
          campos_config JSONB NOT NULL,
          data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      \`;
      await dbPool.query(createIptvModelsTableQuery);
`;

code = code.replace(
  /await pool\.query\(createPrintersTableQuery\);/,
  `await pool.query(createPrintersTableQuery);\n${iptvTable1}`
);

code = code.replace(
  /await dbPool\.query\(createPrintersTableQuery\);/,
  `await dbPool.query(createPrintersTableQuery);\n${iptvTable2}`
);

const iptvRoutes = `
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
    
    const { nome_modelo, codigo_zpl, campos_config } = req.body;
    if (!nome_modelo || !codigo_zpl || !campos_config) return res.status(400).json({ error: 'Preencha todos os campos.' });

    const insertQuery = \`
      INSERT INTO modelos_zpl_iptv (nome_modelo, codigo_zpl, campos_config)
      VALUES ($1, $2, $3) RETURNING *
    \`;
    const result = await dbPool.query(insertQuery, [nome_modelo, codigo_zpl, JSON.stringify(campos_config)]);
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
    
    const { nome_modelo, codigo_zpl, campos_config } = req.body;
    
    const updateQuery = \`
      UPDATE modelos_zpl_iptv 
      SET nome_modelo = $1, codigo_zpl = $2, campos_config = $3
      WHERE id = $4 RETURNING *
    \`;
    const result = await dbPool.query(updateQuery, [nome_modelo, codigo_zpl, JSON.stringify(campos_config), req.params.id]);
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

`;

code = code.replace(
  /\/\/ --- FIM ROTAS IMPRESSORAS ---/,
  `// --- FIM ROTAS IMPRESSORAS ---\n\n${iptvRoutes}`
);

fs.writeFileSync(file, code, 'utf8');
console.log('server.ts updated with IPTV models table and routes.');
