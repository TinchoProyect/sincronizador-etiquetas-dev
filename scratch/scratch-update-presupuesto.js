const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
    console.log('🏁 INICIANDO ACTUALIZACIÓN DEL PRESUPUESTO 8234393');
    if (DRY_RUN) {
        console.log('⚠️ MODO SIMULACIÓN (DRY RUN): No se realizarán cambios permanentes.');
    } else {
        console.log('🔥 MODO REAL: Aplicando cambios permanentes en la base de datos.');
    }
    console.log('================================================================');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Mostrar valores actuales
        console.log('\n--- VALORES ACTUALES ---');
        const current = await client.query(
            `SELECT id, id_presupuesto_ext, fecha, estado FROM public.presupuestos WHERE id = 8234393`
        );
        console.log(current.rows);

        // 2. Definir nuevos valores
        const nuevaFecha = '2026-05-22';
        const nuevoEstado = 'Entregado';

        console.log('\n--- VALORES PROPUESTOS ---');
        console.log(`- Fecha: ${nuevaFecha}`);
        console.log(`- Estado: ${nuevoEstado}`);

        // 3. Ejecutar update
        console.log('\n🔄 Aplicando update...');
        const updateRes = await client.query(`
            UPDATE public.presupuestos 
            SET fecha = $1, estado = $2 
            WHERE id = 8234393
            RETURNING id, id_presupuesto_ext, fecha, estado
        `, [nuevaFecha, nuevoEstado]);

        console.log('Fila actualizada:');
        console.log(updateRes.rows);

        // 4. Confirmar o revertir
        if (DRY_RUN) {
            await client.query('ROLLBACK');
            console.log('\n✅ Simulación completada con éxito. Transacción revertida (ROLLBACK).');
        } else {
            await client.query('COMMIT');
            console.log('\n✅ Base de datos actualizada con éxito. Transacción confirmada (COMMIT).');
        }

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('\n❌ ERROR DURANTE LA ACTUALIZACIÓN:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
