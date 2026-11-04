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
    console.log('🏁 INICIANDO ACTUALIZACIÓN DEL TICKET RT 22');
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
        
        const currentOtd = await client.query(
            `SELECT id, kilos, bultos FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = 22`
        );
        console.log('ordenes_tratamiento_detalles:', currentOtd.rows);

        const currentMm = await client.query(
            `SELECT id, cantidad, observaciones FROM mantenimiento_movimientos WHERE id_orden_tratamiento = 22`
        );
        console.log('mantenimiento_movimientos:', currentMm.rows);

        // 2. Definir nuevos valores
        const nuevosKilos = 4.785;
        const nuevosBultos = 1;
        const nuevasObservaciones = JSON.stringify([{
            desc: "Avena gruesa",
            kilos: nuevosKilos,
            bultos: nuevosBultos,
            motivo: "Olor a humedad"
        }]);

        console.log('\n--- VALORES PROPUESTOS ---');
        console.log(`- Kilos: ${nuevosKilos}`);
        console.log(`- Bultos: ${nuevosBultos}`);
        console.log(`- Observaciones: ${nuevasObservaciones}`);

        // 3. Ejecutar updates
        console.log('\n🔄 Aplicando updates...');

        const updateOtd = await client.query(`
            UPDATE ordenes_tratamiento_detalles 
            SET kilos = $1, bultos = $2 
            WHERE id_orden_tratamiento = 22
            RETURNING *
        `, [nuevosKilos, nuevosBultos]);
        console.log(`  - Filas actualizadas en ordenes_tratamiento_detalles: ${updateOtd.rowCount}`);

        const updateMm = await client.query(`
            UPDATE mantenimiento_movimientos 
            SET cantidad = $1, observaciones = $2 
            WHERE id_orden_tratamiento = 22
            RETURNING *
        `, [nuevosBultos, nuevasObservaciones]);
        console.log(`  - Filas actualizadas en mantenimiento_movimientos: ${updateMm.rowCount}`);

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
