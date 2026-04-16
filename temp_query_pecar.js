const pool = require('./src/produccion/config/database');

async function fixDuplicate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Move the conciliation link to the new record
        await client.query(`
            UPDATE mantenimiento_conciliacion_items 
            SET id_movimiento_origen = 243 
            WHERE id = 49 AND id_movimiento_origen = 197
        `);
        
        // 2. Set the old record back to FINALIZADO
        await client.query(`
            UPDATE mantenimiento_movimientos 
            SET estado = 'FINALIZADO'
            WHERE id = 197
        `);
        
        // 3. Set the active record to CONCILIADO
        await client.query(`
            UPDATE mantenimiento_movimientos 
            SET estado = 'CONCILIADO'
            WHERE id = 243
        `);
        
        await client.query('COMMIT');
        console.log('✅ Clean up successful');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error in cleanup:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

fixDuplicate();
