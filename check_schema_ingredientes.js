const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

client.connect();

client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ingredientes';", (err, res) => {
  if (err) {
    console.error(err);
  } else {
    console.table(res.rows);
  }
  client.end();
});
