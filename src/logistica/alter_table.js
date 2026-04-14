const { pool } = require('./config/database');

async function alterTable() {
    try {
        console.log("Altering table...");
        await pool.query('ALTER TABLE ordenes_tratamiento ADD COLUMN IF NOT EXISTS orden_entrega INTEGER DEFAULT 999');
        console.log("Success!");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

alterTable();
