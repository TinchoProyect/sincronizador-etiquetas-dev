const { pool } = require('../config/database');

async function checkFacturasSchema() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA DE COLUMNAS DE LA TABLA public.factura_facturas');
    console.log('================================================================================\n');

    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'factura_facturas'
            ORDER BY ordinal_position
        `);

        console.table(res.rows);

        // Probar si existen facturas en borrador y facturas aprobadas
        const resStats = await pool.query(`
            SELECT estado, COUNT(*) as cantidad 
            FROM public.factura_facturas 
            GROUP BY estado
        `);
        console.log('\nEstadísticas por estado:');
        console.table(resStats.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkFacturasSchema();
