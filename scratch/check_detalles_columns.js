const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkCols() {
  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'presupuestos_detalles';
  `);
  console.log('📋 Columnas de presupuestos_detalles:');
  res.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type}`));
  process.exit(0);
}

checkCols();
