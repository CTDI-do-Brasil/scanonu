const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /app\.get\('\/api\/admin\/limpar-lixo',/;
const replacement = `app.get('/api/admin/padronizar-5657', async (req, res) => {
  try {
    if (!dbPool) return res.send('Banco não conectado.');
    const result = await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5657 TIM LIVE' WHERE modelo ILIKE '%5657%'");
    res.send('Padronização concluida com sucesso! ' + result.rowCount + ' modelos atualizados. Voce ja pode fechar esta aba.');
  } catch (e: any) {
    res.send('Erro: ' + e.message);
  }
});

app.get('/api/admin/limpar-lixo',`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update regex 5657 complete');
} else {
  console.log('Target regex 5657 not found');
}
