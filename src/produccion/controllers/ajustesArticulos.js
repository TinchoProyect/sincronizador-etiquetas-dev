const pool = require('../config/database');

/**
 * Registra un ajuste manual de stock para un artículo
 * Este controlador maneja ajustes puntuales individuales con auditoría completa
 * 
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarAjusteManual(req, res) {
    try {
        console.log('🔧 [AJUSTE-MANUAL] ===== INICIANDO REGISTRO DE AJUSTE MANUAL =====');
        
        const { articulo_numero, stock_nuevo, observacion } = req.body;
        const usuario_id = req.user?.id || req.body.usuario_id;
        
        console.log('📋 [AJUSTE-MANUAL] Datos recibidos:');
        console.log('- Artículo:', articulo_numero);
        console.log('- Stock nuevo:', stock_nuevo);
        console.log('- Usuario ID:', usuario_id);
        console.log('- Observación:', observacion || 'Sin observación');
        
        // ========================================
        // VALIDACIONES BÁSICAS
        // ========================================
        
        if (!articulo_numero) {
            console.error('❌ [AJUSTE-MANUAL] Error: Falta articulo_numero');
            return res.status(400).json({ 
                error: 'Se requiere articulo_numero',
                detalle: 'El código del artículo es obligatorio'
            });
        }
        
        if (stock_nuevo === undefined || stock_nuevo === null) {
            console.error('❌ [AJUSTE-MANUAL] Error: Falta stock_nuevo');
            return res.status(400).json({ 
                error: 'Se requiere stock_nuevo',
                detalle: 'El nuevo valor de stock es obligatorio'
            });
        }
        
        if (!usuario_id) {
            console.error('❌ [AJUSTE-MANUAL] Error: Falta usuario_id');
            return res.status(400).json({ 
                error: 'Se requiere usuario_id',
                detalle: 'El ID del usuario es obligatorio para auditoría'
            });
        }
        
        // Validar que stock_nuevo sea un número válido
        const stockNuevoNumerico = parseFloat(stock_nuevo);
        if (isNaN(stockNuevoNumerico)) {
            console.error('❌ [AJUSTE-MANUAL] Error: stock_nuevo no es un número válido');
            return res.status(400).json({ 
                error: 'stock_nuevo debe ser un número válido',
                detalle: `Valor recibido: ${stock_nuevo}`
            });
        }
        
        // Validar que stock_nuevo no sea negativo
        if (stockNuevoNumerico < 0) {
            console.error('❌ [AJUSTE-MANUAL] Error: stock_nuevo no puede ser negativo');
            return res.status(400).json({ 
                error: 'El stock no puede ser negativo',
                detalle: `Valor recibido: ${stockNuevoNumerico}`
            });
        }
        
        console.log('✅ [AJUSTE-MANUAL] Validaciones básicas completadas');
        
        // ========================================
        // INICIAR TRANSACCIÓN
        // ========================================
        
        const client = await pool.connect();
        console.log('🔗 [AJUSTE-MANUAL] Conexión a base de datos establecida');
        
        try {
            await client.query('BEGIN');
            console.log('🔄 [AJUSTE-MANUAL] Transacción iniciada');
            
            // ========================================
            // 1. LEER STOCK ACTUAL CON LOCK
            // ========================================
            
            console.log('🔒 [AJUSTE-MANUAL] Bloqueando fila del artículo (FOR UPDATE)...');
            
            const stockQuery = `
                SELECT 
                    articulo_numero,
                    stock_lomasoft,
                    stock_movimientos,
                    stock_ajustes,
                    stock_consolidado,
                    ultima_actualizacion
                FROM stock_real_consolidado 
                WHERE articulo_numero = $1
                FOR UPDATE
            `;
            
            const stockResult = await client.query(stockQuery, [articulo_numero]);
            
            let stock_anterior;
            let registroExiste = false;
            
            if (stockResult.rows.length === 0) {
                // El artículo no existe en stock_real_consolidado
                console.log('⚠️ [AJUSTE-MANUAL] Artículo no encontrado en stock_real_consolidado');
                console.log('📝 [AJUSTE-MANUAL] Se creará nuevo registro con stock inicial');
                stock_anterior = 0;
                registroExiste = false;
            } else {
                // El artículo existe
                const stockActual = stockResult.rows[0];
                stock_anterior = parseFloat(stockActual.stock_consolidado) || 0;
                registroExiste = true;
                
                console.log('✅ [AJUSTE-MANUAL] Artículo encontrado en stock_real_consolidado:');
                console.log(`   - Stock lomasoft: ${stockActual.stock_lomasoft}`);
                console.log(`   - Stock movimientos: ${stockActual.stock_movimientos}`);
                console.log(`   - Stock ajustes: ${stockActual.stock_ajustes}`);
                console.log(`   - Stock consolidado: ${stockActual.stock_consolidado}`);
                console.log(`   - Última actualización: ${stockActual.ultima_actualizacion}`);
            }
            
            // ========================================
            // 2. CALCULAR DIFERENCIA
            // ========================================
            
            const diferencia = stockNuevoNumerico - stock_anterior;
            
            console.log('🧮 [AJUSTE-MANUAL] ===== CÁLCULO DE DIFERENCIA =====');
            console.log(`   - Stock anterior: ${stock_anterior}`);
            console.log(`   - Stock nuevo: ${stockNuevoNumerico}`);
            console.log(`   - Diferencia: ${diferencia}`);
            
            // Validar si realmente hay cambio
            const MARGEN_TOLERANCIA = 0.001;
            if (Math.abs(diferencia) < MARGEN_TOLERANCIA) {
                console.log('ℹ️ [AJUSTE-MANUAL] Diferencia insignificante (< 0.001), no se requiere ajuste');
                await client.query('ROLLBACK');
                client.release();
                
                return res.json({
                    success: true,
                    message: 'No se requiere ajuste (diferencia insignificante)',
                    articulo_numero,
                    stock_anterior,
                    stock_nuevo: stockNuevoNumerico,
                    diferencia: 0,
                    ajuste_aplicado: false
                });
            }
            
            // ========================================
            // 3. REGISTRAR EN TABLA DE AUDITORÍA
            // ========================================
            
            console.log('📝 [AJUSTE-MANUAL] Registrando en articulos_ajustes (auditoría)...');
            
            const insertAjusteQuery = `
                INSERT INTO articulos_ajustes (
                    articulo_numero,
                    usuario_id,
                    tipo_ajuste,
                    stock_anterior,
                    stock_nuevo,
                    diferencia,
                    observacion,
                    fecha
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING id, fecha
            `;
            
            const ajusteResult = await client.query(insertAjusteQuery, [
                articulo_numero,
                usuario_id,
                'ajuste_manual',
                stock_anterior,
                stockNuevoNumerico,
                diferencia,
                observacion || 'Ajuste manual desde interfaz de gestión'
            ]);
            
            const ajusteId = ajusteResult.rows[0].id;
            const fechaAjuste = ajusteResult.rows[0].fecha;
            
            console.log(`✅ [AJUSTE-MANUAL] Ajuste registrado en auditoría:`);
            console.log(`   - ID de ajuste: ${ajusteId}`);
            console.log(`   - Fecha: ${fechaAjuste}`);
            console.log(`   - Tipo: ajuste_manual`);
            console.log(`   - Usuario: ${usuario_id}`);
            
            // ========================================
            // 4. ACTUALIZAR STOCK_REAL_CONSOLIDADO
            // ========================================
            
            console.log('🔄 [AJUSTE-MANUAL] Actualizando stock_real_consolidado...');
            
            if (!registroExiste) {
                // INSERTAR nuevo registro
                console.log('➕ [AJUSTE-MANUAL] Creando nuevo registro en stock_real_consolidado...');
                
                const insertStockQuery = `
                    INSERT INTO stock_real_consolidado (
                        articulo_numero,
                        stock_lomasoft,
                        stock_movimientos,
                        stock_ajustes,
                        stock_consolidado,
                        ultima_actualizacion
                    ) VALUES ($1, 0, 0, $2, $2, NOW())
                `;
                
                await client.query(insertStockQuery, [
                    articulo_numero,
                    diferencia  // Como es nuevo, la diferencia es el stock_ajustes inicial
                ]);
                
                console.log(`✅ [AJUSTE-MANUAL] Registro creado:`);
                console.log(`   - stock_ajustes: ${diferencia}`);
                console.log(`   - stock_consolidado: ${diferencia}`);
                
            } else {
                // ACTUALIZAR registro existente (UPSERT)
                console.log('🔄 [AJUSTE-MANUAL] Actualizando registro existente...');
                
                const upsertStockQuery = `
                    INSERT INTO stock_real_consolidado (
                        articulo_numero,
                        stock_lomasoft,
                        stock_movimientos,
                        stock_ajustes,
                        stock_consolidado,
                        ultima_actualizacion
                    ) VALUES ($1, 0, 0, $2, $2, NOW())
                    ON CONFLICT (articulo_numero) 
                    DO UPDATE SET
                        stock_ajustes = COALESCE(stock_real_consolidado.stock_ajustes, 0) + $2,
                        stock_consolidado = COALESCE(stock_real_consolidado.stock_lomasoft, 0) +
                                          COALESCE(stock_real_consolidado.stock_movimientos, 0) +
                                          (COALESCE(stock_real_consolidado.stock_ajustes, 0) + $2),
                        ultima_actualizacion = NOW()
                `;
                
                await client.query(upsertStockQuery, [articulo_numero, diferencia]);
                
                console.log(`✅ [AJUSTE-MANUAL] Stock actualizado:`);
                console.log(`   - Diferencia aplicada: ${diferencia}`);
                console.log(`   - Nuevo stock_ajustes: stock_ajustes_anterior + ${diferencia}`);
            }
            
            // ========================================
            // 5. VERIFICACIÓN POST-AJUSTE
            // ========================================
            
            console.log('🔍 [AJUSTE-MANUAL] Verificando resultado final...');
            
            const verificacionQuery = `
                SELECT 
                    stock_lomasoft,
                    stock_movimientos,
                    stock_ajustes,
                    stock_consolidado
                FROM stock_real_consolidado 
                WHERE articulo_numero = $1
            `;
            
            const verificacionResult = await client.query(verificacionQuery, [articulo_numero]);
            const stockFinal = verificacionResult.rows[0];
            
            console.log('📊 [AJUSTE-MANUAL] Estado final del stock:');
            console.log(`   - Stock lomasoft: ${stockFinal.stock_lomasoft}`);
            console.log(`   - Stock movimientos: ${stockFinal.stock_movimientos}`);
            console.log(`   - Stock ajustes: ${stockFinal.stock_ajustes}`);
            console.log(`   - Stock consolidado: ${stockFinal.stock_consolidado}`);
            
            // Validar que el stock consolidado coincida con lo esperado
            const stockConsolidadoEsperado = 
                (parseFloat(stockFinal.stock_lomasoft) || 0) +
                (parseFloat(stockFinal.stock_movimientos) || 0) +
                (parseFloat(stockFinal.stock_ajustes) || 0);
            
            const stockConsolidadoReal = parseFloat(stockFinal.stock_consolidado) || 0;
            
            if (Math.abs(stockConsolidadoReal - stockConsolidadoEsperado) > MARGEN_TOLERANCIA) {
                console.error('❌ [AJUSTE-MANUAL] ERROR: Stock consolidado no coincide con la suma de componentes');
                console.error(`   - Esperado: ${stockConsolidadoEsperado}`);
                console.error(`   - Real: ${stockConsolidadoReal}`);
                throw new Error('Inconsistencia en cálculo de stock consolidado');
            }
            
            console.log('✅ [AJUSTE-MANUAL] Verificación exitosa: Stock consolidado es correcto');
            
            // ========================================
            // 6. CONFIRMAR TRANSACCIÓN
            // ========================================
            
            await client.query('COMMIT');
            console.log('✅ [AJUSTE-MANUAL] Transacción confirmada (COMMIT)');
            
            console.log('\n🎉 [AJUSTE-MANUAL] ===== AJUSTE COMPLETADO EXITOSAMENTE =====');
            console.log(`🎉 [AJUSTE-MANUAL] Resumen:`);
            console.log(`   - Artículo: ${articulo_numero}`);
            console.log(`   - Usuario: ${usuario_id}`);
            console.log(`   - Stock anterior: ${stock_anterior}`);
            console.log(`   - Stock nuevo: ${stockNuevoNumerico}`);
            console.log(`   - Diferencia: ${diferencia}`);
            console.log(`   - ID de ajuste: ${ajusteId}`);
            console.log(`   - Fecha: ${fechaAjuste}`);
            
            // Respuesta exitosa
            res.json({
                success: true,
                message: 'Ajuste de stock registrado correctamente',
                data: {
                    ajuste_id: ajusteId,
                    articulo_numero,
                    usuario_id,
                    stock_anterior,
                    stock_nuevo: stockNuevoNumerico,
                    diferencia,
                    stock_consolidado_final: stockConsolidadoReal,
                    observacion: observacion || 'Ajuste manual desde interfaz de gestión',
                    fecha: fechaAjuste
                }
            });
            
        } catch (error) {
            // Rollback en caso de error
            await client.query('ROLLBACK');
            console.error('❌ [AJUSTE-MANUAL] Error en transacción, rollback ejecutado');
            console.error('❌ [AJUSTE-MANUAL] Detalle del error:', error.message);
            console.error('❌ [AJUSTE-MANUAL] Stack trace:', error.stack);
            throw error;
            
        } finally {
            client.release();
            console.log('🔌 [AJUSTE-MANUAL] Conexión a base de datos liberada');
        }
        
    } catch (error) {
        console.error('❌ [AJUSTE-MANUAL] Error crítico al registrar ajuste manual:', error);
        
        // Determinar tipo de error para respuesta apropiada
        let statusCode = 500;
        let errorMessage = 'Error interno al registrar ajuste de stock';
        let errorDetail = error.message;
        
        // Errores de base de datos
        if (error.code) {
            switch (error.code) {
                case '23503': // Foreign key violation
                    statusCode = 400;
                    errorMessage = 'Error de integridad referencial';
                    errorDetail = 'El artículo o usuario especificado no existe';
                    break;
                case '23505': // Unique violation
                    statusCode = 409;
                    errorMessage = 'Conflicto de datos';
                    errorDetail = 'Ya existe un registro con estos datos';
                    break;
                case '22P02': // Invalid text representation
                    statusCode = 400;
                    errorMessage = 'Formato de datos inválido';
                    errorDetail = 'Uno o más valores tienen formato incorrecto';
                    break;
            }
        }
        
        res.status(statusCode).json({
            error: errorMessage,
            detalle: errorDetail,
            codigo_error: error.code || 'UNKNOWN'
        });
    }
}

/**
 * Registra múltiples ajustes manuales en lote (batch)
 * Útil para ajustes masivos desde interfaz de gestión
 * 
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarAjustesBatch(req, res) {
    try {
        console.log('🔧 [AJUSTE-BATCH] ===== INICIANDO REGISTRO DE AJUSTES EN LOTE =====');
        
        const { ajustes } = req.body;
        const usuario_id = req.user?.id || req.body.usuario_id;
        
        console.log('📋 [AJUSTE-BATCH] Datos recibidos:');
        console.log('- Usuario ID:', usuario_id);
        console.log('- Total ajustes:', ajustes?.length || 0);
        
        // Validaciones
        if (!usuario_id) {
            return res.status(400).json({ 
                error: 'Se requiere usuario_id',
                detalle: 'El ID del usuario es obligatorio para auditoría'
            });
        }
        
        if (!ajustes || !Array.isArray(ajustes) || ajustes.length === 0) {
            return res.status(400).json({ 
                error: 'Se requiere un array de ajustes',
                detalle: 'El array de ajustes está vacío o no es válido'
            });
        }
        
        console.log('✅ [AJUSTE-BATCH] Validaciones básicas completadas');
        
        // Procesar cada ajuste
        const resultados = {
            exitosos: [],
            fallidos: [],
            total: ajustes.length
        };
        
        for (let i = 0; i < ajustes.length; i++) {
            const ajuste = ajustes[i];
            console.log(`\n📦 [AJUSTE ${i + 1}/${ajustes.length}] Procesando...`);
            
            try {
                // Simular request para reutilizar la función individual
                const mockReq = {
                    body: {
                        articulo_numero: ajuste.articulo_numero,
                        stock_nuevo: ajuste.stock_nuevo,
                        observacion: ajuste.observacion,
                        usuario_id: usuario_id
                    },
                    user: { id: usuario_id }
                };
                
                // Crear un mock response para capturar el resultado
                let resultado = null;
                const mockRes = {
                    json: (data) => { resultado = data; },
                    status: (code) => ({
                        json: (data) => { resultado = { statusCode: code, ...data }; }
                    })
                };
                
                // Ejecutar ajuste individual
                await registrarAjusteManual(mockReq, mockRes);
                
                if (resultado && resultado.success) {
                    resultados.exitosos.push({
                        articulo_numero: ajuste.articulo_numero,
                        resultado: resultado.data
                    });
                    console.log(`✅ [AJUSTE ${i + 1}] Exitoso`);
                } else {
                    resultados.fallidos.push({
                        articulo_numero: ajuste.articulo_numero,
                        error: resultado?.error || 'Error desconocido'
                    });
                    console.log(`❌ [AJUSTE ${i + 1}] Fallido`);
                }
                
            } catch (error) {
                resultados.fallidos.push({
                    articulo_numero: ajuste.articulo_numero,
                    error: error.message
                });
                console.error(`❌ [AJUSTE ${i + 1}] Error:`, error.message);
            }
        }
        
        console.log('\n🎉 [AJUSTE-BATCH] ===== PROCESO COMPLETADO =====');
        console.log(`   - Total: ${resultados.total}`);
        console.log(`   - Exitosos: ${resultados.exitosos.length}`);
        console.log(`   - Fallidos: ${resultados.fallidos.length}`);
        
        res.json({
            success: true,
            message: `Proceso completado: ${resultados.exitosos.length}/${resultados.total} ajustes exitosos`,
            resultados
        });
        
    } catch (error) {
        console.error('❌ [AJUSTE-BATCH] Error crítico:', error);
        res.status(500).json({
            error: 'Error al procesar ajustes en lote',
            detalle: error.message
        });
    }
}

module.exports = {
    registrarAjusteManual,
    registrarAjustesBatch
};
