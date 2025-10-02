/**
 * Diagnóstico de sincronización masiva
 * Analizar por qué hay 80 presupuestos con el mismo LastModified
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

async function diagnosticoSincronizacionMasiva() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-SYNC-MASIVA] ===== DIAGNÓSTICO SINCRONIZACIÓN MASIVA =====');
        
        // 1. Obtener cutoff_at y última sincronización
        console.log('\n1. Analizando fechas de sincronización...');
        
        const configQuery = `
            SELECT cutoff_at,
                   TO_CHAR(cutoff_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as cutoff_ar
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await db.query(configQuery);
        const cutoffAt = new Date(configResult.rows[0].cutoff_at);
        const cutoffAR = configResult.rows[0].cutoff_ar;
        
        const syncLogQuery = `
            SELECT fecha_sync, registros_procesados, registros_actualizados,
                   TO_CHAR(fecha_sync AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as sync_ar
            FROM presupuestos_sync_log 
            WHERE exitoso = true 
            ORDER BY fecha_sync DESC 
            LIMIT 3
        `;
        
        const syncLogResult = await db.query(syncLogQuery);
        
        console.log('📅 Fechas de sincronización:');
        console.log(`   cutoff_at: ${cutoffAR}`);
        
        if (syncLogResult.rows.length > 0) {
            console.log('   Últimas sincronizaciones:');
            syncLogResult.rows.forEach((sync, i) => {
                console.log(`     ${i+1}. ${sync.sync_ar} - Procesados: ${sync.registros_procesados}, Actualizados: ${sync.registros_actualizados}`);
            });
        }
        
        // 2. Analizar el patrón de LastModified en Sheets
        console.log('\n2. Analizando patrón de LastModified...');
        
        // Simular los 80 presupuestos detectados con LastModified: 29/09/2025 22:29:59
        const lastModifiedProblematico = '29/09/2025 22:29:59';
        
        // Función de parseo
        function parseLastModifiedRobust(value) {
            if (!value) return new Date(0);
            
            try {
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
        }
        
        const timestampProblematico = parseLastModifiedRobust(lastModifiedProblematico);
        const diferenciaCutoff = timestampProblematico.getTime() - cutoffAt.getTime();
        const diferenciaSegundos = Math.round(diferenciaCutoff / 1000);
        
        console.log('🔍 Análisis del patrón problemático:');
        console.log(`   LastModified problemático: ${lastModifiedProblematico}`);
        console.log(`   Parseado: ${timestampProblematico.toISOString()}`);
        console.log(`   cutoff_at: ${cutoffAt.toISOString()}`);
        console.log(`   Diferencia: ${diferenciaSegundos} segundos`);
        console.log(`   Es posterior: ${timestampProblematico > cutoffAt}`);
        
        // 3. Verificar si esto corresponde a una sincronización automática
        console.log('\n3. Verificando origen de la sincronización masiva...');
        
        // Buscar sincronización que coincida con el timestamp problemático
        const syncCercanaQuery = `
            SELECT fecha_sync, registros_procesados, tipo_sync, origen,
                   TO_CHAR(fecha_sync AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as sync_ar,
                   ABS(EXTRACT(EPOCH FROM fecha_sync) - EXTRACT(EPOCH FROM $1::timestamp)) as diff_seconds
            FROM presupuestos_sync_log 
            WHERE exitoso = true 
              AND ABS(EXTRACT(EPOCH FROM fecha_sync) - EXTRACT(EPOCH FROM $1::timestamp)) < 300  -- 5 minutos
            ORDER BY diff_seconds ASC
            LIMIT 3
        `;
        
        const syncCercana = await db.query(syncCercanaQuery, [timestampProblematico]);
        
        if (syncCercana.rows.length > 0) {
            console.log('🎯 SINCRONIZACIONES CERCANAS AL TIMESTAMP PROBLEMÁTICO:');
            syncCercana.rows.forEach((sync, i) => {
                console.log(`   ${i+1}. ${sync.sync_ar}`);
                console.log(`      Tipo: ${sync.tipo_sync || 'N/A'}`);
                console.log(`      Origen: ${sync.origen || 'N/A'}`);
                console.log(`      Procesados: ${sync.registros_procesados}`);
                console.log(`      Diferencia: ${Math.round(sync.diff_seconds)} segundos`);
            });
        } else {
            console.log('❌ No se encontraron sincronizaciones cercanas al timestamp problemático');
        }
        
        // 4. Conclusión y recomendación
        console.log('\n4. 📊 CONCLUSIÓN:');
        
        if (diferenciaSegundos > 0 && diferenciaSegundos < 60) {
            console.log('🎯 PROBLEMA IDENTIFICADO:');
            console.log('   Los 80 presupuestos tienen LastModified muy cercano al cutoff_at');
            console.log('   Esto sugiere que fueron actualizados por una sincronización previa');
            console.log('   El filtro LWW los detecta como "posteriores" por pocos segundos');
            
            console.log('\n💡 RECOMENDACIÓN:');
            console.log('   1. Ajustar cutoff_at para ser POSTERIOR a esta sincronización masiva');
            console.log('   2. O agregar margen de tolerancia en el filtro LWW');
            console.log(`   3. Actualizar cutoff_at a: ${new Date(timestampProblematico.getTime() + 60000).toISOString()}`);
        } else {
            console.log('✅ El filtro LWW está funcionando correctamente');
        }
        
        console.log('\n🏁 [DIAG-SYNC-MASIVA] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico sincronización masiva:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticoSincronizacionMasiva()
    .then(() => {
        console.log('\n✅ Diagnóstico sincronización masiva completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
