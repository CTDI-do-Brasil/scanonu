const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/scanonu_master' });
pool.query("SELECT cpe_sn, gpon_sn, mac, data_leitura FROM etiquetas_scan_onu WHERE cpe_sn = 'N7221768L001025'", (err, res) => {
  console.log(res.rows);
  pool.end();
});
