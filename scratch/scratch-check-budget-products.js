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
        console.log('--- BUSCANDO DETALLES Y ARTÍCULOS ASOCIADOS ---');
        const res = await pool.query(`
            SELECT 
                pd.articulo as codigo_barras, 
                pd.cantidad, 
                pd.precio1,
                a.nombre as articulo_nombre,
                a.codigo_barras as articulo_barras
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
            WHERE pd.id_presupuesto = 8234393;
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
