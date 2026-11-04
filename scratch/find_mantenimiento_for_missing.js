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
    const client = await pool.connect();
    try {
        console.log('--- BUSCANDO MOVIMIENTOS DE MANTENIMIENTO PARA LOS IDs FALTANTES ---');
        const ids = [8232972, 8232977, 8232979, 8232980, 8232976, 8232978, 8232970, 8232971, 8232973, 8232974, 8232967, 8232968, 8232966, 8232964];
        const res = await client.query(`
            SELECT id, articulo_numero, cantidad, tipo_movimiento, fecha_movimiento, estado, id_presupuesto_origen, observaciones 
            FROM mantenimiento_movimientos 
            WHERE id_presupuesto_origen = ANY($1);
        `, [ids]);
        console.log('Filas encontradas:', res.rows.length);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
