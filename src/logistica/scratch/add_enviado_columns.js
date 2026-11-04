const { pool } = require('../config/database');

async function addEnviadoColumns() {
    console.log('================================================================================');
    console.log('🚀 AGREGANDO COLUMNAS es_enviado Y enviado_at A public.factura_facturas');
    console.log('================================================================================\n');

    try {
        await pool.query(`
            ALTER TABLE public.factura_facturas 
            ADD COLUMN IF NOT EXISTS es_enviado BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS enviado_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS enviado_canal VARCHAR(100) DEFAULT NULL;
        `);

        console.log('✅ Columnas es_enviado, enviado_at y enviado_canal creadas/verificadas en factura_facturas.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

addEnviadoColumns();
