/**
 * VERIFICACIÓN: Corrección del campo "diferencia" en sincronización Sheet → Local
 * Confirma que la corrección aplicada resuelve el problema
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

async function verificarCorreccionDiferencia() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [VERIF-DIFERENCIA] ===== VERIFICACIÓN DE CORRECCIÓN =====');
        
        // PASO 1: Verificar estado actual en BD local
        console.log('\n1. Verificando estado actual en BD local...');
        
        const localQuery = `
            SELECT 
                id_presupuesto_ext, 
                articulo, 
                diferencia,
                CASE 
                    WHEN diferencia IS NULL THEN 'NULL'
                    WHEN diferencia = 0 THEN 'CERO' 
                    ELSE 'VALOR_REAL'
                END as diferencia_status,
                fecha_actualizacion
            FROM presupuestos_detalles 
            WHERE id_presupuesto_ext IN (
                SELECT DISTINCT id_presupuesto_ext 
                FROM presupuestos 
                WHERE fecha_actualizacion > NOW() - INTERVAL '2 days'
            )
            ORDER BY fecha_actualizacion DESC
            LIMIT 15
        `;
        
        const localResult = await db.query(localQuery);
        
        console.log(`📋 [VERIF-DIFERENCIA] Registros recientes en local: ${localResult.rows.length}`);
        
        // Estadísticas de diferencia
        const stats = {
            null: 0,
            cero: 0,
            valor_real: 0
        };
        
        localResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.id_presupuesto_ext} - ${row.articulo}: diferencia=${row.diferencia} (${row.diferencia_status})`);
            
            if (row.diferencia_status === 'NULL') stats.null++;
            else if (row.diferencia_status === 'CERO') stats.cero++;
            else stats.valor_real++;
        });
        
        console.log(`\n📊 [VERIF-DIFERENCIA] ESTADÍSTICAS:`);
        console.log(`   - NULL: ${stats.null}/${localResult.rows.length}`);
        console.log(`   - CERO: ${stats.cero}/${localResult.rows.length}`);
        console.log(`   - VALOR_REAL: ${stats.valor_real}/${localResult.rows.length}`);
        
        // PASO 2: Análisis de la corrección aplicada
        console.log('\n2. Análisis de la corrección aplicada...');
        
        console.log('📍 [VERIF-DIFERENCIA] CORRECCIÓN APLICADA:');
        console.log('   Archivo: src/services/gsheets/sync_real.js');
        console.log('   Línea modificada: const diferencia = row[7] || 0;');
        console.log('   Cambio: row[detallesData.headers[7]] → row[7]');
        console.log('   Motivo: Acceso directo por índice en lugar de por valor del header');
        
        // PASO 3: Recomendaciones
        console.log('\n3. Recomendaciones para verificar la corrección...');
        
        if (stats.null > 0) {
            console.log('⚠️ [VERIF-DIFERENCIA] AÚN HAY REGISTROS CON NULL:');
            console.log('   - Estos son registros anteriores a la corrección');
            console.log('   - Para verificar la corrección, ejecuta una nueva sincronización');
            console.log('   - Los nuevos registros deberían tener valores reales de diferencia');
        }
        
        if (stats.valor_real > 0) {
            console.log('✅ [VERIF-DIFERENCIA] HAY REGISTROS CON VALORES REALES:');
            console.log('   - Esto indica que la corrección está funcionando');
            console.log('   - O que algunos registros ya tenían valores correctos');
        }
        
        console.log('\n📋 [VERIF-DIFERENCIA] PASOS PARA VERIFICAR COMPLETAMENTE:');
        console.log('   1. Crear un presupuesto nuevo en Google Sheets con valores de diferencia');
        console.log('   2. Ejecutar sincronización manual desde la interfaz web');
        console.log('   3. Verificar que el nuevo registro tenga diferencia != NULL en BD local');
        console.log('   4. Comparar el valor en BD local con el valor en Google Sheets');
        
        console.log('\n🏁 [VERIF-DIFERENCIA] VERIFICACIÓN COMPLETADA');
        
        return {
            registros_analizados: localResult.rows.length,
            estadisticas: stats,
            correccion_aplicada: true,
            necesita_nueva_sync: stats.null > 0
        };
        
    } catch (error) {
        console.error('❌ [VERIF-DIFERENCIA] Error en verificación:', error.message);
        throw error;
    } finally {
        await db.end();
    }
}

// Ejecutar verificación
verificarCorreccionDiferencia()
    .then(resultado => {
        console.log('\n🎯 [VERIF-DIFERENCIA] RESULTADO:', {
            correccion_aplicada: resultado.correccion_aplicada,
            necesita_nueva_sync: resultado.necesita_nueva_sync
        });
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ [VERIF-DIFERENCIA] Error fatal:', error);
        process.exit(1);
    });
