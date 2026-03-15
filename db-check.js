const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ user: 'postgres', host: 'localhost', database: 'etiquetas_pruebas', password: 'ta3Mionga', port: 5432 });
pool.query(`SELECT table_name, column_name, character_maximum_length FROM information_schema.columns WHERE table_name IN ('mantenimiento_movimientos', 'stock_ventas_movimientos') AND character_maximum_length IS NOT NULL;`).then(res => { 
  fs.writeFileSync('schema.json', JSON.stringify(res.rows, null, 2)); 
  process.exit(0); 
}).catch(e => { console.error(e); process.exit(1); });
