const pool = require('../config/database');

/**
 * Sanitiza un valor numérico para stock
 * - Redondea a 4 decimales máximo
 * - Normaliza -0 a 0
 * @param {number} valor - Valor a sanitizar
 * @returns {number} - Valor sanitizado
 */
function sanitizarStock(valor) {
    // Redondear a 4 decimales
    let valorLimpio = Number(valor.toFixed(4));
    
    // Normalizar cero negativo a cero positivo
    if (valorLimpio === 0 || valorLimpio === -0) {
        valorLimpio = 0;
    }
    
    return valorLimpio;
}

/**
 * Finaliza un inventario de artículos aplicando la lógica completa especificada
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function finalizarInventarioArticulos(req, res) {
    try {
        console.log('🚀 [INVENTARIO-ARTICULOS] ===== INICIANDO FINALIZACIÓN DE INVENTARIO =====');
        const { usuario_id, articulos_inventariados } = req.body;
        
        console.log('📋 [INVENTARIO-ARTICULOS] Datos recibidos:');
        console.log('- Usuario ID:', usuario_id);
        console.log('- Artículos inventariados:', articulos_inventariados?.length || 0);
        
        // Validaciones básicas
        if (!usuario_id) {
            console.error('❌ [INVENTARIO-ARTICULOS] Error: Falta usuario_id');
            return res.status(400).json({ error: 'Se requiere usuario_id' });
        }
        
        if (!articulos_inventariados || !Array.isArray(articulos_inventariados)) {
            console.error('❌ [INVENTARIO-ARTICULOS] Error: articulos_inventariados debe ser un array');
            return res.status(400).json({ error: 'Se requiere un array de articulos_inventariados' });
        }
        
        if (articulos_inventariados.length === 0) {
            console.error('❌ [INVENTARIO-ARTICULOS] Error: Array vacío');
            return res.status(400).json({ error: 'No hay artículos para procesar' });
        }
        
        console.log('✅ [INVENTARIO-ARTICULOS] Validaciones básicas completadas');
        
        // Iniciar transacción
        const client = await pool.connect();
        await client.query('BEGIN');
        
        try {
            // 1. GENERAR INVENTARIO_ID ÚNICO
            console.log('🆔 [INVENTARIO-ARTICULOS] Generando inventario_id único...');
            const inventarioIdQuery = `
                SELECT COALESCE(MAX(inventario_id), 0) + 1 as nuevo_inventario_id 
                FROM inventario_general_articulos_registro
            `;
            const inventarioIdResult = await client.query(inventarioIdQuery);
            const inventario_id = inventarioIdResult.rows[0].nuevo_inventario_id;
            
            console.log(`🆔 [INVENTARIO-ARTICULOS] Inventario ID generado: ${inventario_id}`);
            
            let articulosRegistrados = 0;
            let diferenciasEncontradas = 0;
            let ajustesAplicados = 0;
            
            console.log('🔄 [INVENTARIO-ARTICULOS] Procesando artículos...');
            
            for (let i = 0; i < articulos_inventariados.length; i++) {
                const articulo = articulos_inventariados[i];
                console.log(`\n📦 [ARTICULO ${i + 1}/${articulos_inventariados.length}] ===== PROCESANDO =====`);
                console.log(`📦 [ARTICULO ${i + 1}] Datos:`, articulo);
                
                const { articulo_numero, stock_sistema, stock_contado } = articulo;
                
                if (!articulo_numero) {
                    console.error(`❌ [ARTICULO ${i + 1}] Error: Falta articulo_numero`);
                    continue;
                }
                
                let stockSistema = parseFloat(stock_sistema) || 0;
                let stockContado = parseFloat(stock_contado) || 0;
                
                // 🔧 LIMPIEZA DE RESIDUOS DE PRECISIÓN FLOTANTE
                // Redondear a 2 decimales
                stockSistema = Math.round(stockSistema * 100) / 100;
                stockContado = Math.round(stockContado * 100) / 100;
                
                // Si están muy cerca de un entero, redondearlo
                const enteroSistema = Math.round(stockSistema);
                const enteroContado = Math.round(stockContado);
                
                if (Math.abs(stockSistema - enteroSistema) < 0.01) {
                    console.log(`🧹 [INVENTARIO] Limpieza stock sistema: ${stock_sistema} → ${enteroSistema}`);
                    stockSistema = enteroSistema;
                }
                
                if (Math.abs(stockContado - enteroContado) < 0.01) {
                    console.log(`🧹 [INVENTARIO] Limpieza stock contado: ${stock_contado} → ${enteroContado}`);
                    stockContado = enteroContado;
                }
                
                let diferencia = stockContado - stockSistema;
                
                // 🧹 SANITIZAR DIFERENCIA ANTES DE GUARDAR
                diferencia = sanitizarStock(diferencia);
                
                console.log(`📊 [ARTICULO ${i + 1}] Análisis:`);
                console.log(`   - Artículo: ${articulo_numero}`);
                console.log(`   - Stock sistema: ${stockSistema}`);
                console.log(`   - Stock contado: ${stockContado}`);
                console.log(`   - Diferencia: ${diferencia}`);
                
                // 2. INSERTAR EN inventario_general_articulos_registro (SIEMPRE)
                console.log(`📝 [ARTICULO ${i + 1}] Insertando en inventario_general_articulos_registro...`);
                const insertRegistroQuery = `
                    INSERT INTO inventario_general_articulos_registro 
                    (inventario_id, usuario_id, fecha_hora, articulo_numero, stock_consolidado)
                    VALUES ($1, $2, NOW(), $3, $4)
                `;
                
                await client.query(insertRegistroQuery, [
                    inventario_id,
                    usuario_id,
                    articulo_numero,
                    stockSistema
                ]);
                
                console.log(`✅ [ARTICULO ${i + 1}] Registrado en inventario_general_articulos_registro`);
                articulosRegistrados++;
                
                // 3. SI HAY DIFERENCIA: Procesar ajuste
                const MARGEN_TOLERANCIA = 0.001;
                const hayDiferencia = Math.abs(diferencia) > MARGEN_TOLERANCIA;
                
                if (hayDiferencia) {
                    console.log(`🔍 [ARTICULO ${i + 1}] DIFERENCIA DETECTADA - Procesando ajuste...`);
                    diferenciasEncontradas++;
                    
                    // 3a. INSERTAR EN inventario_general_articulos_diferencias
                    console.log(`📝 [ARTICULO ${i + 1}] Insertando en inventario_general_articulos_diferencias...`);
                    const insertDiferenciaQuery = `
                        INSERT INTO inventario_general_articulos_diferencias 
                        (inventario_id, usuario_id, fecha_hora, articulo_numero, stock_antes, stock_contado, diferencia)
                        VALUES ($1, $2, NOW(), $3, $4, $5, $6)
                    `;
                    
                    await client.query(insertDiferenciaQuery, [
                        inventario_id,
                        usuario_id,
                        articulo_numero,
                        stockSistema,
                        stockContado,
                        diferencia
                    ]);
                    
                    console.log(`✅ [ARTICULO ${i + 1}] Diferencia registrada`);
                    
                    // 3b. ACTUALIZAR stock_real_consolidado
                    console.log(`🔄 [ARTICULO ${i + 1}] Actualizando stock_real_consolidado...`);
                    
                    // Verificar si existe el registro en stock_real_consolidado
                    const checkStockQuery = `
                        SELECT articulo_numero, stock_ajustes, stock_lomasoft, stock_movimientos 
                        FROM stock_real_consolidado 
                        WHERE articulo_numero = $1
                    `;
                    const checkStockResult = await client.query(checkStockQuery, [articulo_numero]);
                    
                    if (checkStockResult.rows.length === 0) {
                        // Crear registro si no existe
                        console.log(`➕ [ARTICULO ${i + 1}] Creando registro en stock_real_consolidado...`);
                        const insertStockQuery = `
                            INSERT INTO stock_real_consolidado 
                            (articulo_numero, stock_ajustes, stock_lomasoft, stock_movimientos, stock_consolidado, ultima_actualizacion)
                            VALUES ($1, $2::numeric(10,2), 0, 0, $2::numeric(10,2), NOW())
                        `;
                        await client.query(insertStockQuery, [articulo_numero, sanitizarStock(diferencia)]);
                        console.log(`✅ [ARTICULO ${i + 1}] Registro creado con stock_ajustes = ${diferencia}`);
                    } else {
                        // Actualizar registro existente
                        const stockActual = checkStockResult.rows[0];
                        let nuevoStockAjustes = (parseFloat(stockActual.stock_ajustes) || 0) + diferencia;
                        const stockLomasoft = parseFloat(stockActual.stock_lomasoft) || 0;
                        const stockMovimientos = parseFloat(stockActual.stock_movimientos) || 0;
                        let nuevoStockConsolidado = stockLomasoft + stockMovimientos + nuevoStockAjustes;
                        
                        // 🧹 SANITIZAR ANTES DE GUARDAR
                        nuevoStockAjustes = sanitizarStock(nuevoStockAjustes);
                        nuevoStockConsolidado = sanitizarStock(nuevoStockConsolidado);
                        
                        console.log(`🔄 [ARTICULO ${i + 1}] Actualizando registro existente:`);
                        console.log(`   - Stock ajustes anterior: ${stockActual.stock_ajustes}`);
                        console.log(`   - Diferencia a aplicar: ${diferencia}`);
                        console.log(`   - Nuevo stock ajustes: ${nuevoStockAjustes}`);
                        console.log(`   - Nuevo stock consolidado: ${nuevoStockConsolidado}`);
                        
                        const updateStockQuery = `
                            UPDATE stock_real_consolidado 
                            SET 
                                stock_ajustes = $2::numeric(10,2),
                                stock_consolidado = $3::numeric(10,2),
                                ultima_actualizacion = NOW()
                            WHERE articulo_numero = $1
                        `;
                        
                        await client.query(updateStockQuery, [
                            articulo_numero,
                            nuevoStockAjustes,
                            nuevoStockConsolidado
                        ]);
                        
                        console.log(`✅ [ARTICULO ${i + 1}] Stock actualizado correctamente`);
                    }
                    
                    ajustesAplicados++;
                } else {
                    console.log(`➖ [ARTICULO ${i + 1}] Sin diferencia significativa - No requiere ajuste`);
                }
                
                console.log(`✅ [ARTICULO ${i + 1}] Procesamiento completado`);
            }
            
            // Confirmar transacción
            await client.query('COMMIT');
            
            console.log(`\n🎉 [INVENTARIO-ARTICULOS] ===== INVENTARIO COMPLETADO EXITOSAMENTE =====`);
            console.log(`🎉 [INVENTARIO-ARTICULOS] Resumen:`);
            console.log(`   - Inventario ID: ${inventario_id}`);
            console.log(`   - Usuario ID: ${usuario_id}`);
            console.log(`   - Artículos registrados: ${articulosRegistrados}`);
            console.log(`   - Diferencias encontradas: ${diferenciasEncontradas}`);
            console.log(`   - Ajustes aplicados: ${ajustesAplicados}`);
            console.log(`   - Fecha: ${new Date().toISOString()}`);
            
            res.json({
                success: true,
                message: 'Inventario de artículos finalizado correctamente',
                inventario_id: inventario_id,
                articulos_registrados: articulosRegistrados,
                diferencias_encontradas: diferenciasEncontradas,
                ajustes_aplicados: ajustesAplicados,
                usuario_id: usuario_id,
                fecha: new Date().toISOString()
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [INVENTARIO-ARTICULOS] Error en transacción, rollback ejecutado:', error);
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ [INVENTARIO-ARTICULOS] Error al finalizar inventario:', error);
        console.error('❌ [INVENTARIO-ARTICULOS] Stack trace:', error.stack);
        res.status(500).json({
            error: 'Error al finalizar inventario de artículos',
            detalle: error.message
        });
    }
}

module.exports = {
    finalizarInventarioArticulos
};
