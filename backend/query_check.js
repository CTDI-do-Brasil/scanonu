const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/scanonu_master' });
pool.query("SELECT * FROM etiquetas_scan_onu WHERE gpon_sn = 'GP02023120184066'", (err, res) => {
  if (err) {
    console.error(err);
  } else {
    console.log("DB RESULT:", res.rows);
  }
  pool.end();
});
