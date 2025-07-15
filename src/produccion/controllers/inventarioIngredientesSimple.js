const pool = require('../config/database');

/**
 * Inicia una nueva sesión de inventario de ingredientes
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function iniciarSesionInventario(req, res) {
    try {
        console.log('🚀 [INVENTARIO] Iniciando nueva sesión de inventario de ingredientes');
        const { usuario_id, session_id } = req.body;
        
        if (!usuario_id || !session_id) {
            console.error('❌ [INVENTARIO] Faltan datos requeridos:', { usuario_id, session_id });
            return res.status(400).json({ error: 'Se requieren usuario_id y session_id' });
        }
        
        console.log('📋 [INVENTARIO] Datos recibidos:', { usuario_id, session_id });
        
        // Verificar que el usuario existe
        const usuarioQuery = `SELECT id, nombre_completo FROM usuarios WHERE id = $1 AND activo = true`;
        const usuarioResult = await pool.query(usuarioQuery, [usuario_id]);
        
        if (usuarioResult.rows.length === 0) {
            console.error('❌ [INVENTARIO] Usuario no encontrado o inactivo:', usuario_id);
            return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });
        }
        
        const usuario = usuarioResult.rows[0];
        console.log('👤 [INVENTARIO] Usuario validado:', usuario.nombre_completo);
        
        // Crear sesión de inventario
        const insertQuery = `
            INSERT INTO inventario_ingredientes_sesiones (session_id, usuario_id)
            VALUES ($1, $2)
            ON CONFLICT (session_id) 
            DO UPDATE SET 
                usuario_id = $2,
                fecha_inicio = NOW(),
                estado = 'activo',
                ingredientes_contados = '[]'::jsonb
            RETURNING id, session_id, fecha_inicio, estado
        `;
        
        const result = await pool.query(insertQuery, [session_id, usuario_id]);
        const sesion = result.rows[0];
        
        console.log('✅ [INVENTARIO] Sesión creada exitosamente:', {
            id: sesion.id,
            session_id: sesion.session_id,
            usuario: usuario.nombre_completo,
            fecha_inicio: sesion.fecha_inicio
        });
        
        res.json({ 
            success: true, 
            sesion: {
                ...sesion,
                usuario_nombre: usuario.nombre_completo
            }
        });
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al iniciar sesión:', error);
        res.status(500).json({ 
            error: 'Error al iniciar sesión de inventario',
            detalle: error.message 
        });
    }
}

/**
 * Registra un ingrediente contado en la sesión activa
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarIngredienteContado(req, res) {
    try {
        console.log('📝 [INVENTARIO] Registrando ingrediente contado');
        const { session_id, ingrediente_id, stock_contado, codigo_barras } = req.body;
        
        if (!session_id || !ingrediente_id || stock_contado === undefined || stock_contado === null) {
            console.error('❌ [INVENTARIO] Faltan datos requeridos:', req.body);
            return res.status(400).json({ error: 'Se requieren session_id, ingrediente_id y stock_contado' });
        }
        
        console.log('📋 [INVENTARIO] Datos del ingrediente:', {
            session_id,
            ingrediente_id,
            stock_contado,
            codigo_barras
        });
        
        // Verificar que la sesión existe y está activa
        const sesionQuery = `
            SELECT id, usuario_id, ingredientes_contados 
            FROM inventario_ingredientes_sesiones 
            WHERE session_id = $1 AND estado = 'activo'
        `;
        const sesionResult = await pool.query(sesionQuery, [session_id]);
        
        if (sesionResult.rows.length === 0) {
            console.error('❌ [INVENTARIO] Sesión no encontrada o inactiva:', session_id);
            return res.status(404).json({ error: 'Sesión no encontrada o inactiva' });
        }
        
        // Obtener información del ingrediente
        const ingredienteQuery = `
            SELECT id, nombre, unidad_medida, stock_actual 
            FROM ingredientes 
            WHERE id = $1
        `;
        const ingredienteResult = await pool.query(ingredienteQuery, [ingrediente_id]);
        
        if (ingredienteResult.rows.length === 0) {
            console.error('❌ [INVENTARIO] Ingrediente no encontrado:', ingrediente_id);
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }
        
        const ingrediente = ingredienteResult.rows[0];
        console.log('🧪 [INVENTARIO] Ingrediente validado:', {
            nombre: ingrediente.nombre,
            stock_actual: ingrediente.stock_actual,
            unidad_medida: ingrediente.unidad_medida
        });
        
        // Preparar datos del ingrediente contado
        const ingredienteContado = {
            ingrediente_id: parseInt(ingrediente_id),
            nombre: ingrediente.nombre,
            unidad_medida: ingrediente.unidad_medida,
            stock_actual: parseFloat(ingrediente.stock_actual) || 0,
            stock_contado: parseFloat(stock_contado),
            codigo_barras: codigo_barras || null,
            fecha_conteo: new Date().toISOString(),
            diferencia: parseFloat(stock_contado) - (parseFloat(ingrediente.stock_actual) || 0)
        };
        
        // Obtener ingredientes ya contados
        const ingredientesActuales = sesionResult.rows[0].ingredientes_contados || [];
        
        // Buscar si el ingrediente ya fue contado
        const indiceExistente = ingredientesActuales.findIndex(ing => ing.ingrediente_id === parseInt(ingrediente_id));
        
        if (indiceExistente >= 0) {
            // Actualizar ingrediente existente
            ingredientesActuales[indiceExistente] = ingredienteContado;
            console.log('🔄 [INVENTARIO] Actualizando ingrediente existente');
        } else {
            // Agregar nuevo ingrediente
            ingredientesActuales.push(ingredienteContado);
            console.log('➕ [INVENTARIO] Agregando nuevo ingrediente');
        }
        
        // Actualizar la sesión con los ingredientes contados
        const updateQuery = `
            UPDATE inventario_ingredientes_sesiones 
            SET ingredientes_contados = $2::jsonb
            WHERE session_id = $1 AND estado = 'activo'
            RETURNING id
        `;
        
        await pool.query(updateQuery, [session_id, JSON.stringify(ingredientesActuales)]);
        
        console.log('✅ [INVENTARIO] Ingrediente registrado exitosamente:', {
            ingrediente: ingrediente.nombre,
            stock_contado: stock_contado,
            diferencia: ingredienteContado.diferencia,
            total_ingredientes: ingredientesActuales.length
        });
        
        res.json({ 
            success: true,
            ingrediente: ingredienteContado,
            total_contados: ingredientesActuales.length
        });
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al registrar ingrediente:', error);
        res.status(500).json({ 
            error: 'Error al registrar ingrediente contado',
            detalle: error.message 
        });
    }
}

/**
 * Calcula las diferencias entre stock contado y stock actual
 * @param {string} session_id - ID de la sesión
 * @returns {Array} Array de diferencias calculadas
 */
async function calcularDiferencias(session_id) {
    try {
        console.log('🧮 [INVENTARIO] Calculando diferencias para sesión:', session_id);
        
        // Obtener ingredientes contados de la sesión
        const sesionQuery = `
            SELECT ingredientes_contados, usuario_id
            FROM inventario_ingredientes_sesiones 
            WHERE session_id = $1 AND estado = 'activo'
        `;
        const sesionResult = await pool.query(sesionQuery, [session_id]);
        
        if (sesionResult.rows.length === 0) {
            throw new Error('Sesión no encontrada o inactiva');
        }
        
        const ingredientesContados = sesionResult.rows[0].ingredientes_contados || [];
        const usuario_id = sesionResult.rows[0].usuario_id;
        
        console.log(`📊 [INVENTARIO] Procesando ${ingredientesContados.length} ingredientes contados`);
        
        const diferencias = [];
        
        for (const ingrediente of ingredientesContados) {
            const diferencia = ingrediente.diferencia || 0;
            
            // Solo incluir si hay diferencia significativa (mayor a 0.001)
            if (Math.abs(diferencia) > 0.001) {
                diferencias.push({
                    ingrediente_id: ingrediente.ingrediente_id,
                    nombre: ingrediente.nombre,
                    stock_actual: ingrediente.stock_actual,
                    stock_contado: ingrediente.stock_contado,
                    diferencia: diferencia,
                    usuario_id: usuario_id,
                    session_id: session_id
                });
                
                console.log(`📈 [INVENTARIO] Diferencia detectada - ${ingrediente.nombre}: ${diferencia}`);
            }
        }
        
        console.log(`✅ [INVENTARIO] Diferencias calculadas: ${diferencias.length} ajustes necesarios`);
        return diferencias;
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al calcular diferencias:', error);
        throw error;
    }
}

/**
 * Aplica los ajustes de inventario usando la nueva tabla ingredientes_ajustes
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function aplicarAjustesInventario(req, res) {
    try {
        console.log('🔧 [INVENTARIO] Aplicando ajustes de inventario con nueva estrategia');
        const { session_id } = req.params;
        
        if (!session_id) {
            return res.status(400).json({ error: 'Se requiere session_id' });
        }
        
        console.log('📋 [INVENTARIO] Procesando ajustes para sesión:', session_id);
        
        // Calcular diferencias
        const diferencias = await calcularDiferencias(session_id);
        
        if (diferencias.length === 0) {
            console.log('ℹ️ [INVENTARIO] No hay ajustes necesarios');
            
            // Marcar sesión como finalizada
            await pool.query(
                `UPDATE inventario_ingredientes_sesiones SET estado = 'finalizado' WHERE session_id = $1`,
                [session_id]
            );
            
            return res.json({ 
                success: true, 
                message: 'No hay ajustes necesarios',
                ajustes_aplicados: 0 
            });
        }
        
        console.log(`🔄 [INVENTARIO] Aplicando ${diferencias.length} ajustes con nueva estrategia...`);
        
        // Iniciar transacción
        const client = await pool.connect();
        await client.query('BEGIN');
        
        try {
            let ajustesAplicados = 0;
            
            for (const diff of diferencias) {
                if (Math.abs(diff.diferencia) > 0.001) {
                    // Obtener información del ingrediente
                    const ingredienteQuery = `
                        SELECT nombre, unidad_medida, stock_actual 
                        FROM ingredientes 
                        WHERE id = $1
                    `;
                    const ingredienteResult = await client.query(ingredienteQuery, [diff.ingrediente_id]);
                    const ingredienteInfo = ingredienteResult.rows[0];
                    
                    console.log(`\n🔍 ===== NUEVA ESTRATEGIA - AJUSTE INVENTARIO =====`);
                    console.log(`📋 INGREDIENTE: ${ingredienteInfo.nombre} (ID: ${diff.ingrediente_id})`);
                    console.log(`📊 UNIDAD DE MEDIDA: ${ingredienteInfo.unidad_medida}`);
                    console.log(`📊 STOCK ACTUAL EN BD: ${ingredienteInfo.stock_actual}`);
                    console.log(`📊 STOCK CONTADO: ${diff.stock_contado}`);
                    console.log(`📊 DIFERENCIA CALCULADA: ${diff.diferencia}`);
                    
                    const stockActualReal = parseFloat(ingredienteInfo.stock_actual);
                    const stockNuevo = parseFloat(diff.stock_contado);
                    
                    console.log(`🔄 NUEVA ESTRATEGIA: ACTUALIZACIÓN DIRECTA + REGISTRO EN ingredientes_ajustes`);
                    console.log(`⚡ OPERACIÓN: ${stockActualReal} → ${stockNuevo}`);
                    
                    // 1. Actualizar directamente el stock_actual en la tabla ingredientes
                    const updateStockQuery = `
                        UPDATE ingredientes 
                        SET stock_actual = $1 
                        WHERE id = $2
                    `;
                    
                    await client.query(updateStockQuery, [stockNuevo, diff.ingrediente_id]);
                    console.log(`✅ Stock actualizado directamente: ${stockActualReal} → ${stockNuevo}`);
                    
                    // 2. Registrar el ajuste en la nueva tabla ingredientes_ajustes
                    const insertAjusteQuery = `
                        INSERT INTO ingredientes_ajustes 
                        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    `;
                    
                    const observacion = `Ajuste inventario - Session: ${session_id}`;
                    
                    await client.query(insertAjusteQuery, [
                        diff.ingrediente_id,
                        diff.usuario_id,
                        'inventario',
                        stockActualReal,
                        stockNuevo,
                        observacion
                    ]);
                    
                    console.log(`✅ Ajuste registrado en ingredientes_ajustes:`);
                    console.log(`   - Tipo: inventario`);
                    console.log(`   - Stock anterior: ${stockActualReal}`);
                    console.log(`   - Stock nuevo: ${stockNuevo}`);
                    console.log(`   - Diferencia: ${diff.diferencia}`);
                    console.log(`   - Usuario: ${diff.usuario_id}`);
                    
                    // 3. Verificación post-ajuste
                    const verificacionQuery = `SELECT stock_actual FROM ingredientes WHERE id = $1`;
                    const verificacionResult = await client.query(verificacionQuery, [diff.ingrediente_id]);
                    const stockFinal = verificacionResult.rows[0].stock_actual;
                    
                    console.log(`🔍 VERIFICACIÓN: Stock final en BD: ${stockFinal}`);
                    console.log(`🎯 ¿CORRECTO?: ${Math.abs(stockFinal - stockNuevo) < 0.001 ? 'SÍ ✅' : 'NO ❌'}`);
                    console.log(`===============================================\n`);
                    
                    ajustesAplicados++;
                }
            }
            
            // Marcar sesión como finalizada
            await client.query(
                `UPDATE inventario_ingredientes_sesiones SET estado = 'finalizado' WHERE session_id = $1`,
                [session_id]
            );
            
            await client.query('COMMIT');
            
            console.log(`🎉 [INVENTARIO] Inventario completado exitosamente con nueva estrategia: ${ajustesAplicados} ajustes aplicados`);
            
            res.json({ 
                success: true, 
                message: 'Ajustes aplicados correctamente con nueva estrategia',
                ajustes_aplicados: ajustesAplicados,
                diferencias_procesadas: diferencias.length
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [INVENTARIO] Error en transacción, rollback ejecutado:', error);
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al aplicar ajustes:', error);
        res.status(500).json({ 
            error: 'Error al aplicar ajustes de inventario',
            detalle: error.message 
        });
    }
}

/**
 * Obtiene el estado actual de una sesión de inventario
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function obtenerEstadoSesion(req, res) {
    try {
        const { session_id } = req.params;
        
        if (!session_id) {
            return res.status(400).json({ error: 'Se requiere session_id' });
        }
        
        const query = `
            SELECT 
                s.id,
                s.session_id,
                s.usuario_id,
                s.fecha_inicio,
                s.estado,
                s.ingredientes_contados,
                u.nombre_completo as usuario_nombre
            FROM inventario_ingredientes_sesiones s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.session_id = $1
        `;
        
        const result = await pool.query(query, [session_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sesión no encontrada' });
        }
        
        const sesion = result.rows[0];
        const ingredientesContados = sesion.ingredientes_contados || [];
        
        res.json({
            success: true,
            sesion: {
                ...sesion,
                total_ingredientes_contados: ingredientesContados.length,
                ingredientes_contados: ingredientesContados
            }
        });
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al obtener estado de sesión:', error);
        res.status(500).json({ 
            error: 'Error al obtener estado de sesión',
            detalle: error.message 
        });
    }
}

module.exports = {
    iniciarSesionInventario,
    registrarIngredienteContado,
    aplicarAjustesInventario,
    obtenerEstadoSesion,
    calcularDiferencias
};
