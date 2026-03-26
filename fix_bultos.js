const pool = require('./src/produccion/config/database');

async function run() {
    try {
        const query1 = "ALTER TABLE public.mantenimiento_tratamientos ADD COLUMN IF NOT EXISTS bultos_fisicos INTEGER DEFAULT 0";
        await pool.query(query1);
        console.log('Altered table mantenimiento_tratamientos.');
    } catch(ex) {
        console.error('E', ex);
    } finally {
        pool.end();
    }
}
run();
