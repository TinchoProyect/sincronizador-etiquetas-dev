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
        console.log('--- RESTAURACIÓN DE PRESUPUESTOS HISTÓRICOS ---');
        
        // 1. Obtener la configuración actual para guardarla en logs
        const configAntesRes = await client.query('SELECT * FROM presupuestos_config WHERE activo = true');
        if (configAntesRes.rows.length === 0) {
            console.error('Error: No se encontró una configuración activa en presupuestos_config');
            return;
        }
        const activeConfigBefore = configAntesRes.rows[0];
        console.log('Configuración activa antes del cambio:', JSON.stringify(activeConfigBefore, null, 2));

        // 2. Actualizar cutoff_at a '2020-01-01' para forzar la descarga de TODO el historial
        console.log('Actualizando cutoff_at a 2020-01-01...');
        await client.query(`
            UPDATE presupuestos_config 
            SET cutoff_at = '2020-01-01 00:00:00-03' 
            WHERE id = $1
        `, [activeConfigBefore.id]);
        
        console.log('Cutoff actualizado correctamente.');

        // 3. Consultar la configuración actualizada
        const configNuevaRes = await client.query('SELECT * FROM presupuestos_config WHERE activo = true');
        const activeConfigUpdated = configNuevaRes.rows[0];
        console.log('Configuración activa actualizada:', JSON.stringify(activeConfigUpdated, null, 2));

        // 4. Importar e invocar la función de sincronización bidireccional quota safe
        console.log('Importando ejecutarSincronizacionBidireccionalQuotaSafe...');
        const { ejecutarSincronizacionBidireccionalQuotaSafe } = require('../src/services/gsheets/syncQuotaSafe');

        const onProgress = async (progressInfo) => {
            console.log(`[PROGRESS] Fase: ${progressInfo.fase} | Mensaje: ${progressInfo.mensaje || ''} | Progreso: ${progressInfo.progressPercent || 0}% | Lote: ${progressInfo.currentBatch || 0}/${progressInfo.totalBatches || 0}`);
        };

        console.log('Iniciando sincronización con Google Sheets (puede tardar un momento)...');
        // Usamos pool como el db client
        const summary = await ejecutarSincronizacionBidireccionalQuotaSafe(
            activeConfigUpdated,
            pool,
            onProgress
        );
        
        console.log('--- SINCRONIZACIÓN COMPLETADA ---');
        console.log('Resumen de Métricas:', JSON.stringify(summary.metrics, null, 2));
        console.log('Resumen de Cuotas:', JSON.stringify(summary.quotaStats, null, 2));
        console.log('Duración:', summary.duration, 'segundos');

        // 5. Verificar la cantidad de filas en las tablas
        const countPresupuestos = await client.query('SELECT COUNT(*) FROM presupuestos');
        const countDetalles = await client.query('SELECT COUNT(*) FROM presupuestos_detalles');
        console.log('\n--- VERIFICACIÓN DE BASE DE DATOS POST-RESTAURACIÓN ---');
        console.log(`Registros en la tabla 'presupuestos': ${countPresupuestos.rows[0].count}`);
        console.log(`Registros en la tabla 'presupuestos_detalles': ${countDetalles.rows[0].count}`);

    } catch (e) {
        console.error('Error crítico durante la restauración:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
