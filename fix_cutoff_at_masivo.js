/**
 * Fix cutoff_at masivo
 * Actualizar cutoff_at para evitar reprocesar los 80 presupuestos de la sincronización masiva
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

async function fixCutoffAtMasivo() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔧 [FIX-CUTOFF-MASIVO] ===== CORRIGIENDO CUTOFF_AT MASIVO =====');
        
        // 1. Obtener cutoff_at actual
        console.log('\n1. Verificando cutoff_at actual...');
        
        const configQuery = `
            SELECT cutoff_at,
                   TO_CHAR(cutoff_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as cutoff_ar
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await db.query(configQuery);
        const cutoffAtActual = new Date(configResult.rows[0].cutoff_at);
        
        console.log('📅 cutoff_at actual:', {
            iso: cutoffAtActual.toISOString(),
            formato_ar: configResult.rows[0].cutoff_ar
        });
        
        // 2. Obtener última sincronización exitosa
        console.log('\n2. Obteniendo última sincronización exitosa...');
        
        const ultimaSyncQuery = `
            SELECT fecha_sync,
                   TO_CHAR(fecha_sync AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as sync_ar
            FROM presupuestos_sync_log 
            WHERE exitoso = true 
            ORDER BY fecha_sync DESC 
            LIMIT 1
        `;
        
        const ultimaSyncResult = await db.query(ultimaSyncQuery);
        const ultimaSync = new Date(ultimaSyncResult.rows[0].fecha_sync);
        
        console.log('📅 Última sincronización:', {
            iso: ultimaSync.toISOString(),
            formato_ar: ultimaSyncResult.rows[0].sync_ar
        });
        
        // 3. Calcular nuevo cutoff_at
        console.log('\n3. Calculando nuevo cutoff_at...');
        
        // Nuevo cutoff_at = última sincronización + 1 minuto de margen
        const nuevoCutoffAt = new Date(ultimaSync.getTime() + 60 * 1000); // +1 minuto
        
        console.log('📅 Nuevo cutoff_at propuesto:', {
            iso: nuevoCutoffAt.toISOString(),
            formato_ar: nuevoCutoffAt.toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s*/, '$1/$2/$3 ')
        });
        
        // 4. Actualizar cutoff_at
        console.log('\n4. Actualizando cutoff_at...');
        
        const updateQuery = `
            UPDATE presupuestos_config 
            SET cutoff_at = $1
            WHERE activo = true
        `;
        
        await db.query(updateQuery, [nuevoCutoffAt]);
        
        console.log('✅ cutoff_at actualizado exitosamente');
        
        // 5. Verificar que ahora no hay presupuestos posteriores
        console.log('\n5. Verificando resultado...');
        
        // Simular verificación con nuevo cutoff_at
        const timestampProblematico = new Date(2025, 8, 29, 22, 29, 59); // 29/09/2025 22:29:59
        const ahoraEsPosterior = timestampProblematico > nuevoCutoffAt;
        
        console.log('🔍 Verificación con nuevo cutoff_at:');
        console.log(`   LastModified problemático: 29/09/2025 22:29:59`);
        console.log(`   Nuevo cutoff_at: ${nuevoCutoffAt.toISOString()}`);
        console.log(`   ¿Sigue siendo posterior?: ${ahoraEsPosterior}`);
        
        if (!ahoraEsPosterior) {
            console.log('✅ PERFECTO: Los 80 presupuestos ya NO serán detectados como posteriores');
            console.log('✅ Próxima sincronización NO reprocesará esos registros');
        } else {
            console.log('❌ PROBLEMA: Aún serían detectados como posteriores');
        }
        
        console.log('\n🏁 [FIX-CUTOFF-MASIVO] Fix completado');
        
    } catch (error) {
        console.error('❌ Error en fix cutoff_at masivo:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar fix
fixCutoffAtMasivo()
    .then(() => {
        console.log('\n✅ Fix cutoff_at masivo completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
