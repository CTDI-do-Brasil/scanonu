const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'scanonu',
  password: 'postgres_password', // whatever it is, wait, we don't know it
  port: 5432,
});
