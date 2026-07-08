const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/scanonu_master' });
pool.query("SELECT mac FROM etiquetas_scan_onu WHERE fabricante = 'KAON' OR modelo = 'PG2447' LIMIT 50", (err, res) => {
  if (err) {
    console.error(err);
  } else {
    console.log("KAON MACs:", res.rows.map(r => r.mac));
  }
  pool.end();
});
