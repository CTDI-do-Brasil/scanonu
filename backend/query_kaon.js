const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/scanonu_master' });
pool.query("SELECT * FROM etiquetas_scan_onu WHERE mac = '24E4CE8AF780' OR gpon_sn = 'GP02023120184066'", (err, res) => {
  if (err) {
    console.error(err);
  } else {
    console.log("SEARCH RESULT:", res.rows);
  }
  pool.end();
});
