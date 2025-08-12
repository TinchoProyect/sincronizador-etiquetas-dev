const pool = require('./config/database');

/**
 * Script de diagnóstico para el problema de impresión de presupuestos
 * Analiza la estructura de la BD y los datos para identificar la causa raíz
 */
async function diagnosticarImpresionPresupuestos() {
    console.log('🔍 [DIAGNÓSTICO] Iniciando análisis de impresión de presupuestos...\n');
    
    try {
        // 1. Verificar existencia de tablas
        console.log('📋 [PASO 1] Verificando existencia de tablas...');
        
        const tablas = ['presupuestos', 'presupuestos_detalles', 'clientes'];
        for (const tabla of tablas) {
            const existeQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                )
            `;
            const result = await pool.query(existeQuery, [tabla]);
            const existe = result.rows[0].exists;
            console.log(`   ${existe ? '✅' : '❌'} Tabla public.${tabla}: ${existe ? 'EXISTE' : 'NO EXISTE'}`);
            
            if (existe) {
                // Contar registros
                const countQuery = `SELECT COUNT(*) as total FROM public.${tabla}`;
                const countResult = await pool.query(countQuery);
                console.log(`      📊 Total de registros: ${countResult.rows[0].total}`);
            }
        }
        
        // 2. Verificar estructura de presupuestos
        console.log('\n📋 [PASO 2] Analizando estructura de presupuestos...');
        
        const columnasPresupuestos = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'presupuestos'
            ORDER BY ordinal_position
        `);
        
        console.log('   Columnas de presupuestos:');
        columnasPresupuestos.rows.forEach(col => {
            console.log(`      - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
        });
        
        // 3. Verificar estados de presupuestos
        console.log('\n📋 [PASO 3] Analizando estados de presupuestos...');
        
        const estadosQuery = `
            SELECT estado, COUNT(*) as cantidad 
            FROM public.presupuestos 
            WHERE activo = true 
            GROUP BY estado 
            ORDER BY cantidad DESC
        `;
        const estadosResult = await pool.query(estadosQuery);
        
        console.log('   Estados encontrados:');
        estadosResult.rows.forEach(row => {
            console.log(`      - "${row.estado}": ${row.cantidad} presupuestos`);
        });
        
        // 4. Verificar relación presupuestos-detalles
        console.log('\n📋 [PASO 4] Verificando relación presupuestos-detalles...');
        
        const relacionQuery = `
            SELECT 
                COUNT(DISTINCT p.id) as presupuestos_con_detalles,
                COUNT(pd.id) as total_detalles,
                AVG(pd.cantidad) as cantidad_promedio
            FROM public.presupuestos p
            JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
            WHERE p.activo = true
        `;
        const relacionResult = await pool.query(relacionQuery);
        
        if (relacionResult.rows.length > 0) {
            const stats = relacionResult.rows[0];
            console.log(`   ✅ Presupuestos con detalles: ${stats.presupuestos_con_detalles}`);
            console.log(`   📊 Total de detalles: ${stats.total_detalles}`);
            console.log(`   📊 Cantidad promedio por detalle: ${parseFloat(stats.cantidad_promedio || 0).toFixed(2)}`);
        }
        
        // 5. Verificar relación con clientes
        console.log('\n📋 [PASO 5] Verificando relación con clientes...');
        
        const clientesQuery = `
            SELECT 
                COUNT(DISTINCT p.id_cliente) as clientes_en_presupuestos,
                COUNT(DISTINCT c.cliente_id) as clientes_en_tabla_clientes,
                COUNT(DISTINCT p.id) as presupuestos_con_cliente_valido
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.activo = true
        `;
        const clientesResult = await pool.query(clientesQuery);
        
        if (clientesResult.rows.length > 0) {
            const stats = clientesResult.rows[0];
            console.log(`   📊 Clientes únicos en presupuestos: ${stats.clientes_en_presupuestos}`);
            console.log(`   📊 Clientes en tabla clientes: ${stats.clientes_en_tabla_clientes}`);
            console.log(`   📊 Presupuestos con cliente válido: ${stats.presupuestos_con_cliente_valido}`);
        }
        
        // 6. Probar consulta específica del controlador
        console.log('\n📋 [PASO 6] Probando consulta del controlador actual...');
        
        // Buscar un cliente con presupuestos para probar
        const clienteTestQuery = `
            SELECT CAST(p.id_cliente AS integer) as cliente_id, COUNT(*) as presupuestos
            FROM public.presupuestos p
            WHERE p.activo = true 
              AND p.estado = 'presupuesto/orden'
            GROUP BY p.id_cliente
            LIMIT 1
        `;
        const clienteTestResult = await pool.query(clienteTestQuery);
        
        if (clienteTestResult.rows.length > 0) {
            const clienteTest = clienteTestResult.rows[0];
            console.log(`   🎯 Probando con cliente_id: ${clienteTest.cliente_id} (${clienteTest.presupuestos} presupuestos)`);
            
            // Ejecutar la consulta del controlador
            const consultaControlador = `
                WITH presupuestos_cliente AS (
                    SELECT 
                        p.id_presupuesto_ext,
                        p.fecha,
                        p.estado
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND CAST(p.id_cliente AS integer) = $1
                      AND p.estado = 'presupuesto/orden'
                )
                SELECT 
                    c.cliente_id,
                    COALESCE(
                        NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                        NULLIF(TRIM(c.nombre), ''),
                        'Cliente ' || c.cliente_id
                    ) as cliente_nombre,
                    c.telefono,
                    c.email,
                    c.domicilio,
                    COUNT(pc.id_presupuesto_ext) as total_presupuestos
                FROM public.clientes c
                JOIN presupuestos_cliente pc ON true
                WHERE c.cliente_id = $1
                GROUP BY c.cliente_id, c.nombre, c.apellido, c.telefono, c.email, c.domicilio
            `;
            
            try {
                const testResult = await pool.query(consultaControlador, [clienteTest.cliente_id]);
                if (testResult.rows.length > 0) {
                    console.log(`   ✅ Consulta exitosa - Cliente encontrado: ${testResult.rows[0].cliente_nombre}`);
                    console.log(`   📊 Total presupuestos: ${testResult.rows[0].total_presupuestos}`);
                } else {
                    console.log(`   ❌ Consulta no devolvió resultados para cliente_id: ${clienteTest.cliente_id}`);
                }
            } catch (queryError) {
                console.log(`   ❌ Error en consulta del controlador: ${queryError.message}`);
            }
        } else {
            console.log(`   ⚠️ No se encontraron presupuestos con estado 'presupuesto/orden'`);
        }
        
        // 7. Verificar datos de ejemplo
        console.log('\n📋 [PASO 7] Mostrando datos de ejemplo...');
        
        const ejemploQuery = `
            SELECT 
                p.id_presupuesto_ext,
                p.id_cliente,
                p.estado,
                p.fecha,
                COUNT(pd.id) as detalles
            FROM public.presupuestos p
            LEFT JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
            WHERE p.activo = true
            GROUP BY p.id_presupuesto_ext, p.id_cliente, p.estado, p.fecha
            ORDER BY p.fecha DESC
            LIMIT 5
        `;
        const ejemploResult = await pool.query(ejemploQuery);
        
        console.log('   Últimos 5 presupuestos:');
        ejemploResult.rows.forEach(row => {
            console.log(`      - ID: ${row.id_presupuesto_ext}, Cliente: ${row.id_cliente}, Estado: "${row.estado}", Detalles: ${row.detalles}`);
        });
        
        console.log('\n✅ [DIAGNÓSTICO] Análisis completado');
        
    } catch (error) {
        console.error('❌ [DIAGNÓSTICO] Error durante el análisis:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        await pool.end();
    }
}

// Ejecutar diagnóstico si se llama directamente
if (require.main === module) {
    diagnosticarImpresionPresupuestos();
}

module.exports = { diagnosticarImpresionPresupuestos };
