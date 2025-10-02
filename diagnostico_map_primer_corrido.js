/**
 * Diagnóstico específico para el problema del mapeo en primer corrido
 * Analiza por qué el map de detalles no se crea en la primera sincronización
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

async function diagnosticarMapPrimerCorrido() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-MAP] ===== DIAGNÓSTICO MAP PRIMER CORRIDO =====');
        
        // 1. Verificar último presupuesto creado (ID 105 según tu relato)
        console.log('\n1. Verificando último presupuesto creado...');
        
        const presupuestoQuery = `
            SELECT id, id_presupuesto_ext, id_cliente, agente, estado, fecha_actualizacion
            FROM presupuestos 
            WHERE id >= 105
            ORDER BY id DESC 
            LIMIT 5
        `;
        
        const presupuestoResult = await db.query(presupuestoQuery);
        console.log('📋 Últimos presupuestos creados:', presupuestoResult.rows);
        
        // 2. Verificar detalles creados (IDs 65 y 66 según tu relato)
        console.log('\n2. Verificando detalles creados...');
        
        const detallesQuery = `
            SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.precio1, d.diferencia,
                   p.id as presupuesto_local_id
            FROM presupuestos_detalles d
            LEFT JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
            WHERE d.id >= 65
            ORDER BY d.id DESC 
            LIMIT 10
        `;
        
        const detallesResult = await db.query(detallesQuery);
        console.log('📦 Últimos detalles creados:', detallesResult.rows);
        
        // 3. Verificar estado del mapeo (último registro 119 según tu relato)
        console.log('\n3. Verificando estado del mapeo...');
        
        const mapQuery = `
            SELECT m.id, m.local_detalle_id, m.id_detalle_presupuesto, m.fuente, m.fecha_asignacion,
                   d.id_presupuesto_ext, d.articulo
            FROM presupuestos_detalles_map m
            LEFT JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
            ORDER BY m.id DESC 
            LIMIT 10
        `;
        
        const mapResult = await db.query(mapQuery);
        console.log('🗺️ Últimos mapeos creados:', mapResult.rows);
        
        // 4. Verificar si hay detalles SIN mapeo
        console.log('\n4. Verificando detalles SIN mapeo...');
        
        const sinMapQuery = `
            SELECT d.id, d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion
            FROM presupuestos_detalles d
            LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
            WHERE m.local_detalle_id IS NULL
            ORDER BY d.id DESC
            LIMIT 10
        `;
        
        const sinMapResult = await db.query(sinMapQuery);
        console.log('❌ Detalles SIN mapeo:', sinMapResult.rows);
        
        // 5. Análisis específico del presupuesto 105 (si existe)
        const presupuesto105 = presupuestoResult.rows.find(p => p.id === 105);
        if (presupuesto105) {
            console.log('\n5. Análisis específico del presupuesto 105...');
            console.log('📋 Presupuesto 105:', presupuesto105);
            
            // Verificar sus detalles
            const detalles105Query = `
                SELECT d.id, d.articulo, d.cantidad, d.precio1, d.diferencia,
                       m.id as map_id, m.id_detalle_presupuesto
                FROM presupuestos_detalles d
                LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
                WHERE d.id_presupuesto_ext = $1
                ORDER BY d.id
            `;
            
            const detalles105Result = await db.query(detalles105Query, [presupuesto105.id_presupuesto_ext]);
            console.log('📦 Detalles del presupuesto 105:', detalles105Result.rows);
            
            // Verificar si tiene mapeo
            const conMapeo = detalles105Result.rows.filter(d => d.map_id !== null);
            const sinMapeo = detalles105Result.rows.filter(d => d.map_id === null);
            
            console.log(`✅ Detalles CON mapeo: ${conMapeo.length}`);
            console.log(`❌ Detalles SIN mapeo: ${sinMapeo.length}`);
            
            if (sinMapeo.length > 0) {
                console.log('🚨 PROBLEMA CONFIRMADO: Detalles sin mapeo en primer corrido');
                console.log('📋 Detalles sin mapeo:', sinMapeo.map(d => ({
                    id: d.id,
                    articulo: d.articulo,
                    cantidad: d.cantidad
                })));
            }
        }
        
        // 6. Verificar logs de sincronización recientes
        console.log('\n6. Verificando logs de sincronización recientes...');
        
        const logsQuery = `
            SELECT fecha_sync, exitoso, registros_procesados, registros_nuevos, 
                   registros_actualizados, tipo_sync, detalles
            FROM presupuestos_sync_log 
            ORDER BY fecha_sync DESC 
            LIMIT 5
        `;
        
        const logsResult = await db.query(logsQuery);
        console.log('📊 Logs de sincronización recientes:', logsResult.rows);
        
        // 7. Diagnóstico de la query que detecta presupuestos sin detalles/mapeo
        console.log('\n7. Ejecutando query de detección de presupuestos sin mapeo...');
        
        const deteccionQuery = `
            SELECT p.id_presupuesto_ext,
                   COUNT(d.id) as count_detalles,
                   COUNT(m.local_detalle_id) as count_mapeos,
                   CASE 
                       WHEN COUNT(d.id) = 0 THEN 'SIN_DETALLES'
                       WHEN COUNT(m.local_detalle_id) = 0 THEN 'SIN_MAPEO'
                       ELSE 'COMPLETO'
                   END as estado
            FROM public.presupuestos p
            LEFT JOIN public.presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
            LEFT JOIN public.presupuestos_detalles_map m ON m.local_detalle_id = d.id
            WHERE p.activo = true
              AND p.id >= 105  -- Últimos presupuestos
            GROUP BY p.id_presupuesto_ext, p.id
            ORDER BY p.id DESC
            LIMIT 10
        `;
        
        const deteccionResult = await db.query(deteccionQuery);
        console.log('🔍 Estado de mapeo de últimos presupuestos:', deteccionResult.rows);
        
        // 8. Resumen del diagnóstico
        console.log('\n8. RESUMEN DEL DIAGNÓSTICO:');
        
        const totalSinMapeo = sinMapResult.rows.length;
        const presupuestosSinMapeoCompleto = deteccionResult.rows.filter(r => r.estado === 'SIN_MAPEO');
        
        console.log(`📊 Total detalles sin mapeo: ${totalSinMapeo}`);
        console.log(`📊 Presupuestos con detalles pero sin mapeo: ${presupuestosSinMapeoCompleto.length}`);
        
        if (presupuestosSinMapeoCompleto.length > 0) {
            console.log('🚨 PRESUPUESTOS PROBLEMÁTICOS:');
            presupuestosSinMapeoCompleto.forEach(p => {
                console.log(`   - ${p.id_presupuesto_ext}: ${p.count_detalles} detalles, ${p.count_mapeos} mapeos`);
            });
        }
        
        console.log('\n🏁 [DIAG-MAP] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error.message);
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarMapPrimerCorrido()
    .then(() => {
        console.log('\n✅ Diagnóstico completado exitosamente');
        process.exit(0);
    })
    .catch(console.error);
