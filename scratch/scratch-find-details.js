const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log('--- BUSCANDO EN ordenes_tratamiento PARA ID = 22 ---');
        const otRes = await pool.query(`
            SELECT * FROM ordenes_tratamiento WHERE id = 22;
        `);
        console.log(JSON.stringify(otRes.rows, null, 2));

        console.log('\n--- BUSCANDO EN ordenes_tratamiento_detalles PARA id_orden_tratamiento = 22 ---');
        const otdRes = await pool.query(`
            SELECT * FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = 22;
        `);
        console.log(JSON.stringify(otdRes.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
