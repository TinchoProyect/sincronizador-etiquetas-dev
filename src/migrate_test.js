const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas_pruebas',
    password: 'ta3Mionga',
    port: 5432,
});

async function run() {
  try {
    await pool.query("ALTER TABLE presupuestos ADD COLUMN origen_facturacion VARCHAR(20) DEFAULT 'PENDIENTE'");
    console.log("Column 'origen_facturacion' added successfully to etiquetas_pruebas.");
  } catch(e) {
    if (e.message.includes('already exists')) {
       console.log("Column already exists.");
    } else {
       console.error("Error:", e.message);
    }
  } finally {
    pool.end();
  }
}
run();
