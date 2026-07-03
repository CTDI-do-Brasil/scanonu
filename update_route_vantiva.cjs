const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regex = /app\.get\('\/api\/admin\/padronizar-5657',[\s\S]*?\}\);\r?\n\r?\n/g;

const target = `  // Rota temporária para padronizar F@ST 5657 TIM LIVE no banco
  app.get('/api/admin/padronizar-5657', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("UPDATE etiquetas_scan_onu SET modelo = 'F@ST 5657 TIM LIVE' WHERE modelo ILIKE '%5657%'");
      res.send('Padronização concluida com sucesso! ' + result.rowCount + ' modelos atualizados para F@ST 5657 TIM LIVE. Voce ja pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });`;

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

  // Rota temporária para padronizar fabricante VANTIVA no banco
  app.get('/api/admin/padronizar-vantiva', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'VANTIVA' WHERE modelo ILIKE '%FGA2232TIB%'");
      res.send('Padronização concluida com sucesso! ' + result.rowCount + ' fabricantes atualizados para VANTIVA. Voce ja pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  // Let's use loose replace with regex just in case
  const looseRegex = /app\.get\('\/api\/admin\/padronizar-5657',[\s\S]*?\}\);/g;
  if (looseRegex.test(code)) {
    code = code.replace(looseRegex, (match) => {
      return match + `\n\n  // Rota temporária para padronizar fabricante VANTIVA no banco
  app.get('/api/admin/padronizar-vantiva', async (req, res) => {
    try {
      if (!dbPool) return res.send('Banco não conectado.');
      const result = await dbPool.query("UPDATE etiquetas_scan_onu SET fabricante = 'VANTIVA' WHERE modelo ILIKE '%FGA2232TIB%'");
      res.send('Padronização concluida com sucesso! ' + result.rowCount + ' fabricantes atualizados para VANTIVA. Voce ja pode fechar esta aba.');
    } catch (e: any) {
      res.send('Erro: ' + e.message);
    }
  });`;
    });
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Update backend server.ts via loose regex complete');
  } else {
    console.log('Target for padronizar-vantiva not found');
  }
}
