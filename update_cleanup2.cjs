const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /app\.get\('\/api\/version',\s*\(req,\s*res\)\s*=>\s*\{\s*res\.json\(\{ version: APP_VERSION \}\);\s*\}\);/;

const replacement = `app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// Rota temporária para limpar o lixo do banco
app.get('/api/admin/limpar-lixo', async (req, res) => {
  try {
    if (!dbPool) return res.send('Banco não conectado.');
    const result = await dbPool.query("DELETE FROM etiquetas_scan_onu WHERE gpon_sn LIKE 'N/A_%'");
    res.send('Limpeza concluida com sucesso! ' + result.rowCount + ' linhas apagadas. Voce ja pode fechar esta aba.');
  } catch (e: any) {
    res.send('Erro: ' + e.message);
  }
});`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex complete');
} else {
  console.log('Target not found');
}
