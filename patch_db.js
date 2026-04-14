const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function main() {
    try {
        console.log('Alter table ordenes_tratamiento adding columns...');
        await pool.query(`
            ALTER TABLE ordenes_tratamiento 
            ADD COLUMN IF NOT EXISTS responsable_nombre VARCHAR(100),
            ADD COLUMN IF NOT EXISTS responsable_apellido VARCHAR(100),
            ADD COLUMN IF NOT EXISTS responsable_celular VARCHAR(50),
            ADD COLUMN IF NOT EXISTS chofer_nombre VARCHAR(100);
        `);
        console.log('Columns added successfully.');
    } catch (e) {
        console.error('Error alterando DB:', e);
    } finally {
        pool.end();
    }
}
main();
