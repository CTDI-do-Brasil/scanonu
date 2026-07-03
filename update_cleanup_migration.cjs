const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const target = `  initializedDatabases.add(dbName);
  console.log(\`Banco \${dbName} inicializado com sucesso.\`);
}`;

const replacement = `  // Migração para limpar chaves que terminam com _clean na tabela modelos_zpl_iptv
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
  console.log(\`Banco \${dbName} inicializado com sucesso.\`);
}`;

const normCode = code.replace(/\r?\n/g, '\n');
const normTarget = target.replace(/\r?\n/g, '\n');

if (normCode.includes(normTarget)) {
  const updatedCode = normCode.replace(normTarget, replacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(filePath, updatedCode, 'utf8');
  console.log('Update backend server.ts complete');
} else {
  console.log('Target initialization block not found');
}
