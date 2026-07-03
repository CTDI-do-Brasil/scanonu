const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const migrationCode1 = `
  // Migração para mover data_leitura para a última posição
  try {
    const lastCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' ORDER BY ordinal_position DESC LIMIT 1");
    if (lastCol.rowCount && lastCol.rowCount > 0 && lastCol.rows[0].column_name !== 'data_leitura') {
      console.log('Movendo a coluna data_leitura para a ultima posicao no banco', dbName);
      await pool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN data_leitura TO data_leitura_old');
      await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      await pool.query('UPDATE etiquetas_scan_onu SET data_leitura = data_leitura_old');
      await pool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN data_leitura_old');
    }
  } catch (e) {
    console.error('Erro ao mover a coluna data_leitura:', e);
  }
`;

const migrationCode2 = `
      // Migração para mover data_leitura para a última posição
      try {
        const lastCol = await dbPool.query("SELECT column_name FROM information_schema.columns WHERE table_name='etiquetas_scan_onu' ORDER BY ordinal_position DESC LIMIT 1");
        if (lastCol.rowCount && lastCol.rowCount > 0 && lastCol.rows[0].column_name !== 'data_leitura') {
          console.log('Movendo a coluna data_leitura para a ultima posicao no banco padrao');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu RENAME COLUMN data_leitura TO data_leitura_old');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
          await dbPool.query('UPDATE etiquetas_scan_onu SET data_leitura = data_leitura_old');
          await dbPool.query('ALTER TABLE etiquetas_scan_onu DROP COLUMN data_leitura_old');
        }
      } catch (e) {
        console.error('Erro ao mover a coluna data_leitura:', e);
      }
`;

// Insert 1: in ensureDatabaseSchema right after "Garantir SSID e Imagem URL"
const target1 = "    await pool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS imagem_url VARCHAR(500)');\n  } catch (e) {}\n";
code = code.replace(target1, target1 + migrationCode1);

// Insert 2: in connectToDatabase right after "Garantir SSID e Imagem URL nas etiquetas"
const target2 = "        await dbPool.query('ALTER TABLE etiquetas_scan_onu ADD COLUMN IF NOT EXISTS imagem_url VARCHAR(500)');\n      } catch (e) {}\n";
code = code.replace(target2, target2 + migrationCode2);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update migrations complete.');
