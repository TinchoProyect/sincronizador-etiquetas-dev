const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
    try {
        console.log("Updating article EMB-67EZ0G kilos_unidad to 4.00...");
        const res = await pool.query(`
            UPDATE public.stock_real_consolidado
            SET kilos_unidad = 4.00, ultima_actualizacion = NOW()
            WHERE articulo_numero = 'EMB-67EZ0G'
            RETURNING *
        `);
        console.log("Result:", JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
