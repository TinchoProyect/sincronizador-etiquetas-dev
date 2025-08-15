const cron = require('node-cron');
const { readSheetWithHeaders } = require('../services/gsheets/client');
require('dotenv').config();

console.log('🔍 [SYNC-JOB] Configurando job de sincronización Google Sheets...');

/**
 * Función para ejecutar sincronización una vez
 */
async function syncOnce() {
    console.log('🔄 [SYNC-JOB] Iniciando sincronización única...');
    
    const startTime = Date.now();
    const result = {
        timestamp: new Date().toISOString(),
        success: false,
        presupuestos: 0,
        detalles: 0,
        errors: [],
        duration: 0
    };
    
    try {
        // Verificar configuración
        if (!process.env.SPREADSHEET_ID) {
            throw new Error('SPREADSHEET_ID no configurado en .env');
        }
        
        if (!process.env.SHEET_PRESUPUESTOS) {
            throw new Error('SHEET_PRESUPUESTOS no configurado en .env');
        }
        
        if (!process.env.SHEET_DETALLES) {
            throw new Error('SHEET_DETALLES no configurado en .env');
        }
        
        console.log('📋 [SYNC-JOB] Configuración verificada:');
        console.log('   - Spreadsheet ID:', process.env.SPREADSHEET_ID);
        console.log('   - Hoja Presupuestos:', process.env.SHEET_PRESUPUESTOS);
        console.log('   - Hoja Detalles:', process.env.SHEET_DETALLES);
        
        // 1. Leer datos de Presupuestos
        console.log('📊 [SYNC-JOB] Leyendo hoja Presupuestos...');
        const presupuestosData = await readSheetWithHeaders(
            process.env.SPREADSHEET_ID,
            'A1:Z1000', // Rango amplio para capturar todos los datos
            process.env.SHEET_PRESUPUESTOS
        );
        
        console.log(`✅ [SYNC-JOB] Presupuestos leídos: ${presupuestosData.totalRows} filas`);
        console.log('📋 [SYNC-JOB] Encabezados Presupuestos:', presupuestosData.headers);
        
        // 2. Leer datos de Detalles
        console.log('📊 [SYNC-JOB] Leyendo hoja DetallesPresupuestos...');
        const detallesData = await readSheetWithHeaders(
            process.env.SPREADSHEET_ID,
            'A1:Z1000', // Rango amplio para capturar todos los datos
            process.env.SHEET_DETALLES
        );
        
        console.log(`✅ [SYNC-JOB] Detalles leídos: ${detallesData.totalRows} filas`);
        console.log('📋 [SYNC-JOB] Encabezados Detalles:', detallesData.headers);
        
        // 3. TODO: Hooks para persistir datos
        console.log('🔄 [SYNC-JOB] Ejecutando hooks de persistencia...');
        
        // TODO: Implementar upsertPresupuestos(presupuestosData.rows)
        const presupuestosResult = await upsertPresupuestos(presupuestosData.rows);
        console.log('✅ [SYNC-JOB] Hook Presupuestos ejecutado:', presupuestosResult);
        
        // TODO: Implementar upsertDetalles(detallesData.rows)
        const detallesResult = await upsertDetalles(detallesData.rows);
        console.log('✅ [SYNC-JOB] Hook Detalles ejecutado:', detallesResult);
        
        // 4. Actualizar resultado
        result.success = true;
        result.presupuestos = presupuestosData.totalRows;
        result.detalles = detallesData.totalRows;
        result.duration = Date.now() - startTime;
        
        console.log('🎉 [SYNC-JOB] Sincronización completada exitosamente');
        console.log('📊 [SYNC-JOB] Estadísticas:', {
            presupuestos: result.presupuestos,
            detalles: result.detalles,
            duration: `${result.duration}ms`
        });
        
        return result;
        
    } catch (error) {
        console.error('❌ [SYNC-JOB] Error en sincronización:', error.message);
        
        result.success = false;
        result.errors.push({
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        result.duration = Date.now() - startTime;
        
        throw error;
    }
}

/**
 * Hook TODO para insertar/actualizar Presupuestos
 * @param {Array} rows - Filas de datos de Presupuestos
 */
async function upsertPresupuestos(rows) {
    console.log('🔄 [SYNC-JOB] TODO: upsertPresupuestos - Procesando', rows.length, 'registros');
    
    // TODO: Implementar lógica de persistencia
    // Ejemplo de estructura esperada:
    /*
    for (const row of rows) {
        // Mapear columnas de Google Sheets a campos de BD
        const presupuesto = {
            id: row['ID'] || row['id'],
            cliente: row['Cliente'] || row['cliente'],
            fecha: row['Fecha'] || row['fecha'],
            monto: parseFloat(row['Monto'] || row['monto'] || 0),
            estado: row['Estado'] || row['estado'],
            // ... otros campos según estructura de la hoja
        };
        
        // Insertar o actualizar en base de datos
        await db.query(`
            INSERT INTO presupuestos (id, cliente, fecha, monto, estado, ...)
            VALUES ($1, $2, $3, $4, $5, ...)
            ON CONFLICT (id) DO UPDATE SET
                cliente = EXCLUDED.cliente,
                fecha = EXCLUDED.fecha,
                monto = EXCLUDED.monto,
                estado = EXCLUDED.estado,
                updated_at = NOW()
        `, [presupuesto.id, presupuesto.cliente, ...]);
    }
    */
    
    // Por ahora, solo simular el procesamiento
    console.log('⚠️ [SYNC-JOB] TODO: Implementar lógica de persistencia para Presupuestos');
    console.log('📋 [SYNC-JOB] Primeros 3 registros de ejemplo:', rows.slice(0, 3));
    
    return {
        processed: rows.length,
        inserted: 0, // TODO: contar inserciones reales
        updated: 0,  // TODO: contar actualizaciones reales
        errors: 0
    };
}

/**
 * Hook TODO para insertar/actualizar Detalles
 * @param {Array} rows - Filas de datos de DetallesPresupuestos
 */
async function upsertDetalles(rows) {
    console.log('🔄 [SYNC-JOB] TODO: upsertDetalles - Procesando', rows.length, 'registros');
    
    // TODO: Implementar lógica de persistencia
    // Ejemplo de estructura esperada:
    /*
    for (const row of rows) {
        // Mapear columnas de Google Sheets a campos de BD
        const detalle = {
            id: row['ID'] || row['id'],
            presupuesto_id: row['PresupuestoID'] || row['presupuesto_id'],
            articulo: row['Articulo'] || row['articulo'],
            cantidad: parseInt(row['Cantidad'] || row['cantidad'] || 0),
            precio_unitario: parseFloat(row['PrecioUnitario'] || row['precio_unitario'] || 0),
            // ... otros campos según estructura de la hoja
        };
        
        // Insertar o actualizar en base de datos
        await db.query(`
            INSERT INTO detalles_presupuestos (id, presupuesto_id, articulo, cantidad, precio_unitario, ...)
            VALUES ($1, $2, $3, $4, $5, ...)
            ON CONFLICT (id) DO UPDATE SET
                presupuesto_id = EXCLUDED.presupuesto_id,
                articulo = EXCLUDED.articulo,
                cantidad = EXCLUDED.cantidad,
                precio_unitario = EXCLUDED.precio_unitario,
                updated_at = NOW()
        `, [detalle.id, detalle.presupuesto_id, ...]);
    }
    */
    
    // Por ahora, solo simular el procesamiento
    console.log('⚠️ [SYNC-JOB] TODO: Implementar lógica de persistencia para Detalles');
    console.log('📋 [SYNC-JOB] Primeros 3 registros de ejemplo:', rows.slice(0, 3));
    
    return {
        processed: rows.length,
        inserted: 0, // TODO: contar inserciones reales
        updated: 0,  // TODO: contar actualizaciones reales
        errors: 0
    };
}

/**
 * Configurar y ejecutar job programado
 */
function startScheduledSync() {
    const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5;
    const cronExpression = `*/${intervalMinutes} * * * *`; // Cada N minutos
    
    console.log('⏰ [SYNC-JOB] Configurando job programado...');
    console.log(`⏰ [SYNC-JOB] Intervalo: cada ${intervalMinutes} minutos`);
    console.log(`⏰ [SYNC-JOB] Expresión cron: ${cronExpression}`);
    
    const task = cron.schedule(cronExpression, async () => {
        console.log('🔔 [CRON] Disparo de sincronización');
        
        try {
            const result = await syncOnce();
            console.log('✅ [CRON] Sincronización programada completada:', {
                presupuestos: result.presupuestos,
                detalles: result.detalles,
                duration: `${result.duration}ms`
            });
        } catch (error) {
            console.error('❌ [CRON] Error en sincronización programada:', error.message);
        }
    }, {
        scheduled: false // No iniciar automáticamente
    });
    
    return task;
}

// Manejo de argumentos de línea de comandos
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--once')) {
        // Ejecutar una sola vez
        console.log('🚀 [SYNC-JOB] Ejecutando sincronización única...');
        
        syncOnce()
            .then(result => {
                console.log('✅ [SYNC-JOB] Sincronización única completada:', result);
                process.exit(0);
            })
            .catch(error => {
                console.error('❌ [SYNC-JOB] Error en sincronización única:', error.message);
                process.exit(1);
            });
            
    } else {
        // Ejecutar job programado
        console.log('🚀 [SYNC-JOB] Iniciando job programado...');
        
        const task = startScheduledSync();
        task.start();
        
        console.log('✅ [SYNC-JOB] Job programado iniciado');
        console.log('⏰ [SYNC-JOB] Presiona Ctrl+C para detener');
        
        // Manejo de cierre graceful
        process.on('SIGINT', () => {
            console.log('🔄 [SYNC-JOB] Deteniendo job programado...');
            task.stop();
            console.log('✅ [SYNC-JOB] Job detenido exitosamente');
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('🔄 [SYNC-JOB] Deteniendo job programado...');
            task.stop();
            console.log('✅ [SYNC-JOB] Job detenido exitosamente');
            process.exit(0);
        });
    }
}

console.log('✅ [SYNC-JOB] Módulo de sincronización configurado');

module.exports = {
    syncOnce,
    startScheduledSync,
    upsertPresupuestos,
    upsertDetalles
};
