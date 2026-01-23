const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function forceTable() {
    try {
        console.log('🔨 Forzando CREATE TABLE mantenimiento_movimientos...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.mantenimiento_movimientos (
                id SERIAL PRIMARY KEY,
                articulo_id INTEGER NOT NULL REFERENCES public.articulos(id),
                cantidad NUMERIC(10,3) NOT NULL,
                id_presupuesto_origen INTEGER, 
                fecha_movimiento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                usuario VARCHAR(100) NOT NULL,
                tipo_movimiento VARCHAR(50) NOT NULL CHECK (tipo_movimiento IN ('INGRESO', 'LIBERACION', 'AJUSTE', 'DESCARTE')),
                observaciones TEXT,
                estado VARCHAR(20) DEFAULT 'FINALIZADO' CHECK (estado IN ('PENDIENTE', 'FINALIZADO', 'CANCELADO'))
            );
        `);
        console.log('✅ TABLE CREATED (Query executed).');

        await pool.query(`COMMENT ON TABLE public.mantenimiento_movimientos IS 'Auditoría de todos los movimientos de entrada y salida del almacén de mantenimiento.';`);
        console.log('✅ COMMENT ADDED.');

    } catch (error) {
        console.error('❌ Error forzando tabla:', error);
    } finally {
        pool.end();
    }
}

forceTable();
