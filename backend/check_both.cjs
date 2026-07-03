const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/scanonu_master' });
pool.query("SELECT cpe_sn, gpon_sn, mac, data_leitura FROM etiquetas_scan_onu WHERE mac = 'E4C0E2BEB277'", (err, res) => {
  console.log(res.rows);
  pool.end();
});
