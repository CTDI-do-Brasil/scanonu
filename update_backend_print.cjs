const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

if (!code.includes("import net from 'net';")) {
  code = code.replace(/import express from 'express';/, "import express from 'express';\nimport net from 'net';");
}

const printEndpoint = `
// --- ROTA DE IMPRESSÃO ZPL IPTV ---
app.post('/api/print-iptv', authenticateSession, async (req: any, res: any) => {
  try {
    if (!dbConnected || !dbPool) return res.status(500).json({ error: 'Banco de dados offline.' });

    const { modelId, printerId, fieldsData } = req.body;
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
    for (const key of Object.keys(model.campos_config)) {
      const val = fieldsData[key] || '';
      // Substituir a chave no formato \${chave} ou \$\\{chave\\}
      const regex = new RegExp('\\\\$\\\\\\{\\\\s*' + key + '\\\\s*\\\\\\}', 'g');
      zpl = zpl.replace(regex, val);
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
`;

if (!code.includes("/api/print-iptv")) {
  code = code.replace(
    /\/\/ --- FIM ROTAS IMPRESSORAS ---/,
    `// --- FIM ROTAS IMPRESSORAS ---\n\n${printEndpoint}`
  );
  fs.writeFileSync(file, code, 'utf8');
  console.log('server.ts updated with print endpoint.');
} else {
  console.log('Print endpoint already exists.');
}
