const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `  // Rota temporária para limpar o lixo do banco
  app.get('/api/admin/limpar-lixo', async (req, res) => {`;

const replacement = `  // Rota temporária para padronizar F@ST 5657 TIM LIVE no banco
  app.get('/api/admin/padronizar-5657', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5657 TIM LIVE' WHERE modelo ILIKE '%5657%'");
      res.send('Padronização concluida com sucesso! ' + result.rowCount + ' modelos atualizados para F@ST 5657 TIM LIVE. Voce ja pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });

  // Rota temporária para limpar o lixo do banco
  app.get('/api/admin/limpar-lixo', async (req, res) => {`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update padronizar-5657 complete');
} else {
  console.log('Target padronizar-5657 not found');
}
