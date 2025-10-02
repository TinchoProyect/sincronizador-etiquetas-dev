/**
 * Diagnóstico integral del flujo LWW (Last Writer Wins)
 * Analiza por qué la comparación de fechas no funciona correctamente
 */

const { Pool } = require('pg');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function diagnosticarLWWIntegral() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-LWW] ===== DIAGNÓSTICO INTEGRAL LWW =====');
        
        // 1. Verificar cutoff_at actual
        console.log('\n1. Verificando cutoff_at actual...');
        
        const configQuery = `
            SELECT hoja_id, hoja_url, cutoff_at, usuario_id
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await db.query(configQuery);
        if (configResult.rows.length > 0) {
            const config = configResult.rows[0];
            console.log('📋 Configuración actual:', {
                hoja_id: config.hoja_id,
                cutoff_at: config.cutoff_at,
                cutoff_iso: config.cutoff_at?.toISOString()
            });
            
            // 2. Verificar presupuestos que pasan el filtro cutoff_at
            console.log('\n2. Verificando presupuestos que pasan filtro cutoff_at...');
            
            const presupuestosCutoffQuery = `
                SELECT p.id, p.id_presupuesto_ext, p.fecha_actualizacion, p.activo,
                       p.fecha_actualizacion > $1 as pasa_cutoff
                FROM presupuestos p
                WHERE p.activo = true 
                  AND p.id_presupuesto_ext IS NOT NULL
                ORDER BY p.fecha_actualizacion DESC
                LIMIT 10
            `;
            
            const presupuestosCutoffResult = await db.query(presupuestosCutoffQuery, [config.cutoff_at]);
            console.log('📊 Presupuestos vs cutoff_at:', presupuestosCutoffResult.rows);
            
            // 3. Simular comparación LWW para presupuestos recientes
            console.log('\n3. Simulando comparación LWW...');
            
            // Función para parsear LastModified como en el código real
            const parseLastModifiedRobust = (value) => {
                if (!value) return new Date(0);
                
                try {
                    // Si es número (Excel serial date)
                    if (typeof value === 'number') {
                        const excelEpoch = new Date(1900, 0, 1);
                        const days = value - 2;
                        return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
                    }
                    
                    // Si es string, intentar parsear formato dd/mm/yyyy hh:mm:ss (AR)
                    if (typeof value === 'string') {
                        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
                        const match = value.match(ddmmyyyyRegex);
                        if (match) {
                            const [, day, month, year, hour, minute, second] = match;
                            return new Date(year, month - 1, day, hour, minute, second);
                        }
                    }
                    
                    return new Date(value);
                } catch (e) {
                    return new Date(0);
                }
            };
            
            // Simular datos de Sheets (ejemplo)
            const ejemplosSheets = [
                {
                    id: '2f209364',
                    lastModified: '29/09/2025 14:15:30' // Ejemplo de fecha reciente en Sheet
                },
                {
                    id: 'aca221e9',
                    lastModified: '29/09/2025 14:10:00'
                }
            ];
            
            console.log('📋 Simulando comparación LWW:');
            
            for (const sheetExample of ejemplosSheets) {
                // Buscar presupuesto local correspondiente
                const localQuery = `
                    SELECT id_presupuesto_ext, fecha_actualizacion
                    FROM presupuestos
                    WHERE id_presupuesto_ext = $1
                `;
                
                const localResult = await db.query(localQuery, [sheetExample.id]);
                
                if (localResult.rows.length > 0) {
                    const local = localResult.rows[0];
                    const localTimestamp = new Date(local.fecha_actualizacion);
                    const sheetTimestamp = parseLastModifiedRobust(sheetExample.lastModified);
                    
                    console.log(`\n🔍 Presupuesto ${sheetExample.id}:`);
                    console.log(`   Local: ${localTimestamp.toISOString()}`);
                    console.log(`   Sheet: ${sheetTimestamp.toISOString()}`);
                    console.log(`   Sheet > Local: ${sheetTimestamp > localTimestamp}`);
                    console.log(`   Diferencia (min): ${Math.round((sheetTimestamp - localTimestamp) / (1000 * 60))}`);
                    
                    if (sheetTimestamp > localTimestamp) {
                        console.log(`   ✅ DEBERÍA actualizar desde Sheet`);
                    } else {
                        console.log(`   ❌ NO debería actualizar (Local más reciente o igual)`);
                    }
                } else {
                    console.log(`\n⚠️ Presupuesto ${sheetExample.id} no encontrado en local`);
                }
            }
            
            // 4. Verificar logs de sincronización recientes
            console.log('\n4. Verificando logs de sincronización recientes...');
            
            const logsQuery = `
                SELECT fecha_sync, exitoso, registros_procesados, registros_nuevos, 
                       registros_actualizados, tipo_sync, detalles
                FROM presupuestos_sync_log 
                ORDER BY fecha_sync DESC 
                LIMIT 3
            `;
            
            const logsResult = await db.query(logsQuery);
            console.log('📊 Logs recientes:', logsResult.rows);
            
            // 5. Verificar si hay presupuestos que deberían actualizarse
            console.log('\n5. Verificando presupuestos que deberían actualizarse...');
            
            const shouldUpdateQuery = `
                SELECT p.id_presupuesto_ext, p.fecha_actualizacion,
                       CASE 
                           WHEN p.fecha_actualizacion > $1 THEN 'PASA_CUTOFF'
                           ELSE 'NO_PASA_CUTOFF'
                       END as estado_cutoff
                FROM presupuestos p
                WHERE p.activo = true 
                  AND p.id_presupuesto_ext IS NOT NULL
                  AND p.id_presupuesto_ext IN ('2f209364', 'aca221e9', '61378473')
                ORDER BY p.fecha_actualizacion DESC
            `;
            
            const shouldUpdateResult = await db.query(shouldUpdateQuery, [config.cutoff_at]);
            console.log('🎯 Presupuestos de prueba vs cutoff:', shouldUpdateResult.rows);
            
        } else {
            console.log('❌ No se encontró configuración activa');
        }
        
        console.log('\n🏁 [DIAG-LWW] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico LWW:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarLWWIntegral()
    .then(() => {
        console.log('\n✅ Diagnóstico LWW completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
