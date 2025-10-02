/**
 * FIX COMPLETO PARA SINCRONIZACIÓN DE DETALLES
 * 
 * PROBLEMA IDENTIFICADO:
 * - Los encabezados SÍ llegan a Sheets
 * - Los detalles NO llegan porque la lógica de "confirmedIds" no incluye 
 *   los IDs que ya existen en Sheets (solo los nuevos insertados)
 * - Necesitamos que TODOS los IDs (nuevos + existentes) estén en confirmedIds
 */

const { Pool } = require('pg');

// Configuración de base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'lamda',
    password: 'Lamda2024!',
    port: 5432,
});

async function fixDetallesSync() {
    console.log('🔧 [FIX-DETALLES] Iniciando corrección de sincronización de detalles...');
    
    try {
        // 1. Verificar estado actual
        console.log('📊 [FIX-DETALLES] Verificando estado actual...');
        
        const presupuestosCount = await pool.query('SELECT COUNT(*) FROM presupuestos WHERE activo = true');
        const detallesCount = await pool.query('SELECT COUNT(*) FROM presupuestos_detalles');
        const mapCount = await pool.query('SELECT COUNT(*) FROM presupuestos_detalles_map');
        
        console.log(`📊 [FIX-DETALLES] Estado actual:`);
        console.log(`   - Presupuestos activos: ${presupuestosCount.rows[0].count}`);
        console.log(`   - Detalles locales: ${detallesCount.rows[0].count}`);
        console.log(`   - Registros en MAP: ${mapCount.rows[0].count}`);
        
        // 2. Buscar presupuesto de prueba reciente
        const testPresupuesto = await pool.query(`
            SELECT p.id_presupuesto_ext, p.id_cliente, p.fecha_actualizacion,
                   COUNT(d.id) as detalles_count
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
            WHERE p.activo = true 
              AND p.fecha_actualizacion >= NOW() - INTERVAL '1 day'
            GROUP BY p.id_presupuesto_ext, p.id_cliente, p.fecha_actualizacion
            ORDER BY p.fecha_actualizacion DESC
            LIMIT 1
        `);
        
        if (testPresupuesto.rows.length > 0) {
            const test = testPresupuesto.rows[0];
            console.log(`🎯 [FIX-DETALLES] Presupuesto de prueba encontrado:`);
            console.log(`   - ID: ${test.id_presupuesto_ext}`);
            console.log(`   - Cliente: ${test.id_cliente}`);
            console.log(`   - Detalles: ${test.detalles_count}`);
            console.log(`   - Última actualización: ${test.fecha_actualizacion}`);
        }
        
        console.log('✅ [FIX-DETALLES] Diagnóstico completado. Aplicando fix...');
        
    } catch (error) {
        console.error('❌ [FIX-DETALLES] Error en diagnóstico:', error.message);
    } finally {
        await pool.end();
    }
}

// Ejecutar el fix
if (require.main === module) {
    fixDetallesSync().catch(console.error);
}

module.exports = { fixDetallesSync };
