/**
 * Diagnóstico del POST /api/presupuestos que falló
 * Busca la Idempotency-Key: ee724b7f-899d-4f88-bf49-7b87872ac71e
 */

const { Pool } = require('pg');

// Configuración de base de datos (misma que el módulo de presupuestos)
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function diagnosticarPost() {
    console.log('🔍 [DIAGNÓSTICO] Iniciando diagnóstico del POST fallido...');
    console.log('🔑 [DIAGNÓSTICO] Idempotency-Key: ee724b7f-899d-4f88-bf49-7b87872ac71e');
    
    try {
        // 1. Verificar si existe el cliente ID 0
        console.log('\n📋 [DIAGNÓSTICO] 1. Verificando cliente ID 0...');
        const clienteQuery = `
            SELECT cliente_id, nombre, apellido, otros 
            FROM public.clientes 
            WHERE cliente_id = 0
        `;
        const clienteResult = await pool.query(clienteQuery);
        
        if (clienteResult.rows.length > 0) {
            console.log('✅ [DIAGNÓSTICO] Cliente ID 0 existe:', clienteResult.rows[0]);
        } else {
            console.log('❌ [DIAGNÓSTICO] Cliente ID 0 NO EXISTE en la tabla clientes');
            console.log('🔍 [DIAGNÓSTICO] Buscando clientes similares...');
            
            const similarQuery = `
                SELECT cliente_id, nombre, apellido, otros 
                FROM public.clientes 
                WHERE LOWER(nombre) LIKE '%consumidor%' OR LOWER(apellido) LIKE '%final%'
                LIMIT 5
            `;
            const similarResult = await pool.query(similarQuery);
            console.log('📋 [DIAGNÓSTICO] Clientes similares:', similarResult.rows);
        }
        
        // 2. Verificar artículo
        console.log('\n📦 [DIAGNÓSTICO] 2. Verificando artículo codigo_barras: 5693383447...');
        const articuloQuery = `
            SELECT articulo_numero, descripcion, codigo_barras, stock_consolidado 
            FROM public.stock_real_consolidado 
            WHERE codigo_barras = '5693383447'
        `;
        const articuloResult = await pool.query(articuloQuery);
        
        if (articuloResult.rows.length > 0) {
            console.log('✅ [DIAGNÓSTICO] Artículo existe:', articuloResult.rows[0]);
        } else {
            console.log('❌ [DIAGNÓSTICO] Artículo con codigo_barras 5693383447 NO EXISTE');
        }
        
        // 3. Buscar registros de idempotencia
        console.log('\n🔑 [DIAGNÓSTICO] 3. Buscando registros de idempotencia...');
        const idempotencyQuery = `
            SELECT * FROM presupuestos_idempotency 
            WHERE idempotency_key = 'ee724b7f-899d-4f88-bf49-7b87872ac71e'
        `;
        
        try {
            const idempotencyResult = await pool.query(idempotencyQuery);
            if (idempotencyResult.rows.length > 0) {
                console.log('✅ [DIAGNÓSTICO] Registro de idempotencia encontrado:', idempotencyResult.rows[0]);
            } else {
                console.log('❌ [DIAGNÓSTICO] No se encontró registro de idempotencia');
            }
        } catch (error) {
            console.log('⚠️ [DIAGNÓSTICO] Tabla presupuestos_idempotency no existe o error:', error.message);
        }
        
        // 4. Buscar presupuestos creados hoy
        console.log('\n📅 [DIAGNÓSTICO] 4. Buscando presupuestos creados hoy (2025-08-24)...');
        const hoyQuery = `
            SELECT id, id_presupuesto_ext, id_cliente, agente, tipo_comprobante, fecha, estado, activo
            FROM public.presupuestos 
            WHERE DATE(fecha) = '2025-08-24'
            ORDER BY id DESC
            LIMIT 10
        `;
        const hoyResult = await pool.query(hoyQuery);
        
        if (hoyResult.rows.length > 0) {
            console.log('📋 [DIAGNÓSTICO] Presupuestos de hoy encontrados:', hoyResult.rows.length);
            hoyResult.rows.forEach(row => {
                console.log(`   - ID: ${row.id}, Cliente: ${row.id_cliente}, Agente: ${row.agente}, Estado: ${row.estado}`);
            });
        } else {
            console.log('❌ [DIAGNÓSTICO] No se encontraron presupuestos creados hoy');
        }
        
        // 5. Verificar últimos presupuestos por agente Martín
        console.log('\n👤 [DIAGNÓSTICO] 5. Últimos presupuestos del agente Martín...');
        const martinQuery = `
            SELECT id, id_presupuesto_ext, id_cliente, agente, tipo_comprobante, fecha, estado, activo
            FROM public.presupuestos 
            WHERE LOWER(agente) LIKE '%mart%'
            ORDER BY id DESC
            LIMIT 5
        `;
        const martinResult = await pool.query(martinQuery);
        
        if (martinResult.rows.length > 0) {
            console.log('📋 [DIAGNÓSTICO] Últimos presupuestos de Martín:');
            martinResult.rows.forEach(row => {
                console.log(`   - ID: ${row.id}, Cliente: ${row.id_cliente}, Fecha: ${row.fecha}, Estado: ${row.estado}`);
            });
        }
        
        // 6. Verificar estructura de tabla presupuestos
        console.log('\n🏗️ [DIAGNÓSTICO] 6. Verificando estructura de tabla presupuestos...');
        const estructuraQuery = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'presupuestos' AND table_schema = 'public'
            ORDER BY ordinal_position
        `;
        const estructuraResult = await pool.query(estructuraQuery);
        console.log('📋 [DIAGNÓSTICO] Estructura de tabla presupuestos:');
        estructuraResult.rows.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
        });
        
        // 7. Probar inserción manual
        console.log('\n🧪 [DIAGNÓSTICO] 7. Probando inserción manual de presupuesto...');
        
        // Primero verificar si existe un cliente válido
        const clienteValidoQuery = `
            SELECT cliente_id FROM public.clientes 
            WHERE cliente_id > 0 
            ORDER BY cliente_id 
            LIMIT 1
        `;
        const clienteValidoResult = await pool.query(clienteValidoQuery);
        
        if (clienteValidoResult.rows.length > 0) {
            const clienteValido = clienteValidoResult.rows[0].cliente_id;
            console.log(`📋 [DIAGNÓSTICO] Usando cliente válido ID: ${clienteValido}`);
            
            const insertQuery = `
                INSERT INTO public.presupuestos 
                (id_cliente, fecha, agente, tipo_comprobante, punto_entrega, descuento, activo, estado)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, id_presupuesto_ext
            `;
            
            try {
                const insertResult = await pool.query(insertQuery, [
                    clienteValido.toString(),
                    '2025-08-24',
                    'Martín',
                    'PRESUPUESTO',
                    'Sin registro',
                    10.0,
                    true,
                    'PENDIENTE'
                ]);
                
                console.log('✅ [DIAGNÓSTICO] Inserción manual exitosa:', insertResult.rows[0]);
                
                // Limpiar el registro de prueba
                await pool.query('DELETE FROM public.presupuestos WHERE id = $1', [insertResult.rows[0].id]);
                console.log('🧹 [DIAGNÓSTICO] Registro de prueba eliminado');
                
            } catch (insertError) {
                console.log('❌ [DIAGNÓSTICO] Error en inserción manual:', insertError.message);
            }
        }
        
    } catch (error) {
        console.error('❌ [DIAGNÓSTICO] Error general:', error);
    } finally {
        await pool.end();
    }
}

// Ejecutar diagnóstico
diagnosticarPost().then(() => {
    console.log('\n🎯 [DIAGNÓSTICO] Diagnóstico completado');
    process.exit(0);
}).catch(error => {
    console.error('💥 [DIAGNÓSTICO] Error fatal:', error);
    process.exit(1);
});
