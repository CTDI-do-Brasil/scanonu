const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `  app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
  });`;

const replacement = `  app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
  });

  // Rota temporária para limpar o lixo do banco
  app.get('/api/admin/limpar-lixo', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn LIKE 'N/A_%'");
      res.send('Limpeza concluída com sucesso! ' + result.rowCount + ' linhas apagadas. Você já pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update exact complete');
} else {
  console.log('Target not found');
}
