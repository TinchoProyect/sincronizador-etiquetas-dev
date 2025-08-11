const pool = require('./config/database');

/**
 * Script de prueba para verificar que la impresión de remitos funciona correctamente
 */
async function probarImpresionRemito() {
    console.log('🧪 [TEST] Iniciando prueba de impresión de remito...\n');
    
    try {
        // 1. Buscar un cliente con presupuestos confirmados
        console.log('🔍 [TEST] Buscando cliente con presupuestos confirmados...');
        
        const buscarClienteQuery = `
            SELECT 
                CAST(p.id_cliente AS integer) as cliente_id,
                c.nombre,
                c.apellido,
                COUNT(*) as total_presupuestos
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(p.id_cliente AS integer)
            WHERE p.activo = true 
              AND LOWER(TRIM(p.estado)) ILIKE '%presupuesto%orden%'
            GROUP BY p.id_cliente, c.nombre, c.apellido
            ORDER BY total_presupuestos DESC
            LIMIT 1
        `;
        
        const clienteResult = await pool.query(buscarClienteQuery);
        
        if (clienteResult.rows.length === 0) {
            console.log('❌ [TEST] No se encontraron clientes con presupuestos confirmados');
            return;
        }
        
        const clienteTest = clienteResult.rows[0];
        console.log(`✅ [TEST] Cliente encontrado: ${clienteTest.nombre} ${clienteTest.apellido || ''} (ID: ${clienteTest.cliente_id})`);
        console.log(`📊 [TEST] Total presupuestos: ${clienteTest.total_presupuestos}`);
        
        // 2. Simular la consulta del controlador
        console.log('\n🔍 [TEST] Ejecutando consulta del controlador...');
        
        const query = `
            WITH presupuestos_cliente AS (
                SELECT 
                    p.id_presupuesto_ext,
                    p.fecha,
                    p.estado
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND CAST(p.id_cliente AS integer) = $1
                  AND LOWER(TRIM(p.estado)) ILIKE '%presupuesto%orden%'
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
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id_presupuesto_ext', pc.id_presupuesto_ext,
                        'fecha', pc.fecha,
                        'estado', pc.estado,
                        'articulos', (
                            SELECT JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'articulo_numero', pd.articulo,
                                    'descripcion', COALESCE(
                                        NULLIF(TRIM(a.nombre), ''),
                                        NULLIF(TRIM(pd.articulo), ''),
                                        'Artículo ' || pd.articulo
                                    ),
                                    'cantidad', COALESCE(pd.cantidad, 0)
                                ) ORDER BY pd.articulo
                            )
                            FROM public.presupuestos_detalles pd
                            LEFT JOIN public.articulos a ON a.numero = pd.articulo
                            WHERE pd.id_presupuesto_ext = pc.id_presupuesto_ext
                        )
                    ) ORDER BY pc.fecha DESC
                ) as presupuestos
            FROM public.clientes c
            JOIN presupuestos_cliente pc ON true
            WHERE c.cliente_id = $1
            GROUP BY c.cliente_id, c.nombre, c.apellido, c.telefono, c.email, c.domicilio;
        `;
        
        const result = await pool.query(query, [clienteTest.cliente_id]);
        
        if (result.rows.length === 0) {
            console.log('❌ [TEST] La consulta del controlador no devolvió resultados');
            return;
        }
        
        const clienteData = result.rows[0];
        console.log(`✅ [TEST] Consulta exitosa - Cliente: ${clienteData.cliente_nombre}`);
        console.log(`📊 [TEST] Presupuestos encontrados: ${clienteData.presupuestos.length}`);
        
        // 3. Mostrar detalles de los presupuestos
        console.log('\n📋 [TEST] Detalles de presupuestos:');
        clienteData.presupuestos.forEach((presupuesto, index) => {
            console.log(`\n  Presupuesto ${index + 1}:`);
            console.log(`    - ID: ${presupuesto.id_presupuesto_ext}`);
            console.log(`    - Fecha: ${new Date(presupuesto.fecha).toLocaleDateString('es-AR')}`);
            console.log(`    - Estado: ${presupuesto.estado}`);
            console.log(`    - Artículos: ${presupuesto.articulos ? presupuesto.articulos.length : 0}`);
            
            if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                presupuesto.articulos.slice(0, 3).forEach((articulo, artIndex) => {
                    console.log(`      ${artIndex + 1}. ${articulo.articulo_numero} - ${articulo.descripcion} (Cant: ${articulo.cantidad})`);
                });
                if (presupuesto.articulos.length > 3) {
                    console.log(`      ... y ${presupuesto.articulos.length - 3} artículos más`);
                }
            }
        });
        
        // 4. Generar URLs de prueba
        console.log('\n🔗 [TEST] URLs para probar en el navegador:');
        console.log(`📄 HTML: /api/produccion/impresion-presupuesto?cliente_id=${clienteTest.cliente_id}&formato=html`);
        console.log(`📑 PDF:  /api/produccion/impresion-presupuesto?cliente_id=${clienteTest.cliente_id}&formato=pdf`);
        
        console.log('\n✅ [TEST] Prueba completada exitosamente');
        console.log('💡 [TEST] El controlador debería funcionar correctamente con este cliente');
        
    } catch (error) {
        console.error('❌ [TEST] Error durante la prueba:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        await pool.end();
    }
}

// Ejecutar prueba si se llama directamente
if (require.main === module) {
    probarImpresionRemito();
}

module.exports = { probarImpresionRemito };
