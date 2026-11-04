const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

/**
 * Formatea una duración en segundos a una cadena legible (ej: "1h 15m 30s", "18 min 42 seg", "45 seg")
 */
function formatearDuracionSegundos(totalSegundos) {
    const s = parseInt(totalSegundos) || 0;
    if (s <= 0) return '0 seg';
    const horas = Math.floor(s / 3600);
    const minutos = Math.floor((s % 3600) / 60);
    const segs = s % 60;
    if (horas > 0) {
        return `${horas}h ${minutos}m ${segs}s`;
    }
    if (minutos > 0) {
        return `${minutos} min ${segs} seg`;
    }
    return `${segs} seg`;
}

/**
 * Normaliza cualquier entrada numérica a float estándar, admitiendo tanto coma como punto
 */
function normalizarDecimalUniversal(valor) {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;
    let str = String(valor).trim().replace(/,/g, '.');
    if (str === '') return 0;
    const partes = str.split('.');
    if (partes.length > 2) str = partes[0] + '.' + partes.slice(1).join('');
    str = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

/**
 * Valida si un string tiene el formato estándar de UUID (PostgreSQL)
 */
function esUUIDValido(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

/**
 * Inicia una nueva sesion de inventario de ingredientes
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function iniciarSesionInventario(req, res) {
    try {
        console.log('🚀 [INVENTARIO] Iniciando nueva sesion de inventario de ingredientes');
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
        
        // Crear sesion de inventario
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
        
        console.log('✅ [INVENTARIO] Sesion creada exitosamente:', {
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
        console.error('❌ [INVENTARIO] Error al iniciar sesion:', error);
        res.status(500).json({ 
            error: 'Error al iniciar sesion de inventario',
            detalle: error.message 
        });
    }
}

/**
 * Registra un ingrediente contado en la sesion activa (Soporte Dual: Kilos + Lotes/Cajas)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarIngredienteContado(req, res) {
    try {
        console.log('📝 [INVENTARIO] Registrando ingrediente contado (Dual)');
        const session_id = req.params.session_id || req.body.session_id;
        const { 
            ingrediente_id, 
            stock_contado, 
            kilos_sueltos_contados,
            lotes_contados,
            total_bultos_contados,
            stock_potencial_contado,
            codigo_barras 
        } = req.body;
        
        if (!session_id || !ingrediente_id) {
            console.error('❌ [INVENTARIO] Faltan datos requeridos:', req.body);
            return res.status(400).json({ error: 'Se requieren session_id e ingrediente_id' });
        }
        
        // Verificar que la sesion existe y esta activa
        const sesionQuery = `
            SELECT id, usuario_id, ingredientes_contados 
            FROM inventario_ingredientes_sesiones 
            WHERE session_id = $1 AND estado = 'activo'
        `;
        const sesionResult = await pool.query(sesionQuery, [session_id]);
        
        if (sesionResult.rows.length === 0) {
            console.error('❌ [INVENTARIO] Sesion no encontrada o inactiva:', session_id);
            return res.status(404).json({ error: 'Sesion no encontrada o inactiva' });
        }
        
        // Obtener informacion del ingrediente
        const ingredienteQuery = `
            SELECT id, nombre, unidad_medida, stock_actual, COALESCE(stock_bultos, 0) as stock_bultos 
            FROM ingredientes 
            WHERE id = $1
        `;
        const ingredienteResult = await pool.query(ingredienteQuery, [ingrediente_id]);
        
        if (ingredienteResult.rows.length === 0) {
            console.error('❌ [INVENTARIO] Ingrediente no encontrado:', ingrediente_id);
            return res.status(404).json({ error: 'Ingrediente no encontrado' });
        }
        
        const ingrediente = ingredienteResult.rows[0];
        const stockActualKilos = normalizarDecimalUniversal(ingrediente.stock_actual);
        const stockActualBultos = normalizarDecimalUniversal(ingrediente.stock_bultos);
        const rawKilos = kilos_sueltos_contados !== undefined ? kilos_sueltos_contados : stock_contado;
        const kilosContados = normalizarDecimalUniversal(rawKilos);
        const bultosContados = total_bultos_contados !== undefined ? normalizarDecimalUniversal(total_bultos_contados) : stockActualBultos;
        
        // Preparar datos del ingrediente contado
        const ingredienteContado = {
            ingrediente_id: parseInt(ingrediente_id),
            nombre: ingrediente.nombre,
            unidad_medida: ingrediente.unidad_medida,
            stock_actual: stockActualKilos,
            stock_bultos: stockActualBultos,
            stock_contado: kilosContados,
            kilos_sueltos_contados: kilosContados,
            lotes_contados: lotes_contados || [],
            total_bultos_contados: bultosContados,
            stock_potencial_contado: stock_potencial_contado !== undefined ? normalizarDecimalUniversal(stock_potencial_contado) : kilosContados,
            codigo_barras: codigo_barras || null,
            fecha_conteo: new Date().toISOString(),
            diferencia: Math.round((kilosContados - stockActualKilos) * 1000) / 1000,
            diferencia_bultos: Math.round((bultosContados - stockActualBultos) * 1000) / 1000
        };
        
        // Obtener ingredientes ya contados
        const ingredientesActuales = sesionResult.rows[0].ingredientes_contados || [];
        
        // Buscar si el ingrediente ya fue contado
        const indiceExistente = ingredientesActuales.findIndex(ing => ing.ingrediente_id === parseInt(ingrediente_id));
        
        if (indiceExistente >= 0) {
            ingredientesActuales[indiceExistente] = ingredienteContado;
            console.log('🔄 [INVENTARIO] Actualizando ingrediente existente');
        } else {
            ingredientesActuales.push(ingredienteContado);
            console.log('➕ [INVENTARIO] Agregando nuevo ingrediente');
        }
        
        // Actualizar la sesion con los ingredientes contados
        const updateQuery = `
            UPDATE inventario_ingredientes_sesiones 
            SET ingredientes_contados = $2::jsonb
            WHERE session_id = $1 AND estado = 'activo'
            RETURNING id
        `;
        
        await pool.query(updateQuery, [session_id, JSON.stringify(ingredientesActuales)]);
        
        console.log('✅ [INVENTARIO] Ingrediente registrado exitosamente:', {
            ingrediente: ingrediente.nombre,
            kilos_contados: kilosContados,
            bultos_contados: bultosContados,
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
 * @param {string} session_id - ID de la sesion
 * @returns {Array} Array de diferencias calculadas
 */
async function calcularDiferencias(session_id) {
    try {
        console.log('🧮 [INVENTARIO] Calculando diferencias para sesion:', session_id);
        
        const sesionQuery = `
            SELECT ingredientes_contados, usuario_id
            FROM inventario_ingredientes_sesiones 
            WHERE session_id = $1 AND estado = 'activo'
        `;
        const sesionResult = await pool.query(sesionQuery, [session_id]);
        
        if (sesionResult.rows.length === 0) {
            throw new Error('Sesion no encontrada o inactiva');
        }
        
        const ingredientesContados = sesionResult.rows[0].ingredientes_contados || [];
        const usuario_id = sesionResult.rows[0].usuario_id;
        
        const diferencias = [];
        
        for (const ingrediente of ingredientesContados) {
            const kCont = normalizarDecimalUniversal(ingrediente.kilos_sueltos_contados !== undefined ? ingrediente.kilos_sueltos_contados : ingrediente.stock_contado);
            const kAct = normalizarDecimalUniversal(ingrediente.stock_actual);
            const bCont = normalizarDecimalUniversal(ingrediente.total_bultos_contados !== undefined ? ingrediente.total_bultos_contados : 0);
            const bAct = normalizarDecimalUniversal(ingrediente.stock_bultos);
            const diffKilos = Math.round((kCont - kAct) * 1000) / 1000;
            const diffBultos = Math.round((bCont - bAct) * 1000) / 1000;
            
            if (Math.abs(diffKilos) > 0.001 || Math.abs(diffBultos) > 0.001) {
                diferencias.push({
                    ingrediente_id: ingrediente.ingrediente_id,
                    nombre: ingrediente.nombre,
                    stock_actual: kAct,
                    stock_bultos: bAct,
                    stock_contado: kCont,
                    kilos_sueltos_contados: kCont,
                    lotes_contados: ingrediente.lotes_contados || [],
                    total_bultos_contados: ingrediente.total_bultos_contados || 0,
                    diferencia: diffKilos,
                    diferencia_bultos: diffBultos,
                    usuario_id: usuario_id,
                    session_id: session_id
                });
            }
        }
        
        return diferencias;
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al calcular diferencias:', error);
        throw error;
    }
}

/**
 * Aplica los ajustes de inventario procesando datos directos del frontend (Soporte Dual: Kilos + Bultos/Lotes)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function aplicarAjustesInventario(req, res) {
    try {
        console.log('🔧 [INVENTARIO] ===== INICIANDO APLICACION DE AJUSTES DUAL (KILOS + LOTES) =====');
        const { session_id } = req.params;
        const { ingredientes_contados } = req.body;
        const usuario_id = parseInt(req.body.usuario_id) || 1;
        
        if (!session_id) {
            return res.status(400).json({ error: 'Se requiere session_id' });
        }
        if (!ingredientes_contados || !Array.isArray(ingredientes_contados)) {
            return res.status(400).json({ error: 'Se requiere un array de ingredientes_contados' });
        }
        
        // Iniciar transaccion
        const client = await pool.connect();
        await client.query('BEGIN');
        
        try {
            // 0. IDEMPOTENCIA: Asegurar que la fila existe para que SELECT FOR UPDATE bloquee concurrentemente
            await client.query(`
                INSERT INTO inventario_ingredientes_sesiones (session_id, usuario_id, estado, fecha_inicio)
                VALUES ($1, $2, 'activo', NOW())
                ON CONFLICT (session_id) DO NOTHING
            `, [session_id, usuario_id]);

            const checkSesionQuery = `
                SELECT id, estado, ingredientes_contados, observaciones, duracion_segundos, fecha_inicio, fecha_finalizacion
                FROM inventario_ingredientes_sesiones
                WHERE session_id = $1
                FOR UPDATE
            `;
            const checkSesionRes = await client.query(checkSesionQuery, [session_id]);
            if (checkSesionRes.rows.length > 0 && checkSesionRes.rows[0].estado === 'finalizado') {
                const sesionExistente = checkSesionRes.rows[0];
                console.log(`⚠️ [INVENTARIO IDEMPOTENTE] Sesión ${session_id} ya fue finalizada. Retornando resultado consolidado.`);
                await client.query('COMMIT');
                client.release();

                const userRes = await pool.query('SELECT nombre_completo FROM usuarios WHERE id = $1', [usuario_id]);
                const usuarioNombre = userRes.rows[0]?.nombre_completo || 'Operario';
                const itemsGuardados = sesionExistente.ingredientes_contados || [];
                let ajustesContados = 0;
                if (Array.isArray(itemsGuardados)) {
                    ajustesContados = itemsGuardados.filter(it => it.ajustado).length;
                }

                return res.json({
                    success: true,
                    message: 'Sesión ya finalizada previamente (resultado consolidado)',
                    ajustes_aplicados: ajustesContados,
                    total_procesados: itemsGuardados.length,
                    session_id: session_id,
                    usuario_nombre: usuarioNombre,
                    fecha_inicio: sesionExistente.fecha_inicio,
                    fecha_finalizacion: sesionExistente.fecha_finalizacion,
                    duracion_segundos: sesionExistente.duracion_segundos,
                    duracion_texto: formatearDuracionSegundos(sesionExistente.duracion_segundos),
                    sectores: sesionExistente.observaciones || 'Sector General',
                    resumen_items: itemsGuardados
                });
            }

            let ajustesAplicados = 0;
            const resumenItems = [];

            // MERGE DE SEGURIDAD DETERMINISTA: Cruzar datos recibidos con los pesajes guardados en PostgreSQL durante la sesión
            const itemsPreviamenteRegistrados = checkSesionRes.rows[0]?.ingredientes_contados || [];
            const mapaRegistradosBD = new Map();
            if (Array.isArray(itemsPreviamenteRegistrados)) {
                itemsPreviamenteRegistrados.forEach(it => {
                    const id = parseInt(it.ingrediente_id || it.id);
                    if (id) mapaRegistradosBD.set(id, it);
                });
            }

            // Para cada item en ingredientes_contados, si vino como no_tocado pero fue pesado/registrado en BD, rescatar su conteo real:
            const listaConsolidada = ingredientes_contados.map(item => {
                const id = parseInt(item.ingrediente_id || item.id);
                const registradoBD = mapaRegistradosBD.get(id);

                if (registradoBD && (item.no_tocado || !item.contado)) {
                    console.log(`🛡️ [MERGE BD] Rescatando item ${registradoBD.nombre || id} registrado previamente en sesión (${registradoBD.kilos_sueltos_contados} kg)`);
                    return {
                        ...item,
                        ...registradoBD,
                        ingrediente_id: id,
                        no_tocado: false,
                        contado: true,
                        kilos_sueltos_contados: registradoBD.kilos_sueltos_contados !== undefined ? registradoBD.kilos_sueltos_contados : registradoBD.stock_contado,
                        stock_contado: registradoBD.stock_contado !== undefined ? registradoBD.stock_contado : registradoBD.kilos_sueltos_contados,
                        lotes_contados: registradoBD.lotes_contados || item.lotes_contados || [],
                        total_bultos_contados: registradoBD.total_bultos_contados !== undefined ? registradoBD.total_bultos_contados : (item.total_bultos_contados || 0)
                    };
                }
                return item;
            });

            // Añadir items que estuviesen registrados en la BD pero ausentes en el array enviado
            const idsEnviados = new Set(ingredientes_contados.map(it => parseInt(it.ingrediente_id || it.id)));
            mapaRegistradosBD.forEach((regItem, id) => {
                if (!idsEnviados.has(id)) {
                    console.log(`🛡️ [MERGE BD] Añadiendo item registrado en BD ausente en body: ${regItem.nombre || id}`);
                    listaConsolidada.push({
                        ...regItem,
                        ingrediente_id: id,
                        no_tocado: false,
                        contado: true
                    });
                }
            });

            for (const item of listaConsolidada) {
                const ingredienteId = parseInt(item.ingrediente_id);
                const rawKilos = item.kilos_sueltos_contados !== undefined ? item.kilos_sueltos_contados : item.stock_contado;
                const stockKilosNuevo = normalizarDecimalUniversal(rawKilos);
                const lotesContados = Array.isArray(item.lotes_contados) ? item.lotes_contados : [];
                
                // Obtener datos actuales del ingrediente en BD con bloqueo
                const ingQuery = `
                    SELECT id, nombre, codigo, unidad_medida, stock_actual, COALESCE(stock_bultos, 0) as stock_bultos
                    FROM ingredientes
                    WHERE id = $1
                    FOR UPDATE
                `;
                const ingRes = await client.query(ingQuery, [ingredienteId]);
                if (ingRes.rows.length === 0) continue;
                
                const ingActual = ingRes.rows[0];
                // Preservar el stock base original con el que inició el inventario si vino en item.stock_actual
                const stockKilosAnterior = (item.stock_actual !== undefined && item.stock_actual !== null && item.stock_actual !== '')
                    ? normalizarDecimalUniversal(item.stock_actual)
                    : normalizarDecimalUniversal(ingActual.stock_actual);
                const stockBultosAnterior = (item.stock_bultos !== undefined && item.stock_bultos !== null && item.stock_bultos !== '')
                    ? normalizarDecimalUniversal(item.stock_bultos)
                    : normalizarDecimalUniversal(ingActual.stock_bultos);
                
                // Si el item fue marcado como no encontrado o no tocado en el sector auditado: se ajusta a 0 kg y 0 bultos por falta de existencia física
                if (item.no_tocado || item.no_encontrado_cero) {
                    item.kilos_sueltos_contados = 0;
                    item.stock_contado = 0;
                    item.total_bultos_contados = 0;
                    item.lotes_contados = [];
                    item.forzar_ajuste = true;
                }
                
                // 1. Procesar Ajuste de Lotes en bunker_lotes_destinos
                let totalBultosFinal = 0;
                
                if (lotesContados.length > 0) {
                    const vinculosProcesados = [];
                    for (const loteItem of lotesContados) {
                        const vinculoId = loteItem.vinculo_id;
                        const cajasContadas = normalizarDecimalUniversal(loteItem.cajas_contadas);
                        
                        // Si el lote no tiene UUID válido de base de datos y sus cajas contadas son 0 o menos, ignorarlo
                        if (!esUUIDValido(vinculoId) && cajasContadas <= 0) {
                            continue;
                        }
                        
                        totalBultosFinal += cajasContadas;
                        
                        // Blindaje Estructural: Solo consultar bunker_lotes_destinos si el vinculoId es un UUID válido de BD
                        if (vinculoId && esUUIDValido(vinculoId)) {
                            vinculosProcesados.push(vinculoId);
                            const destQuery = `
                                SELECT id, cantidad_asignada, COALESCE(cantidad_abierta, 0) as cantidad_abierta, kilos_asignados
                                FROM public.bunker_lotes_destinos
                                WHERE vinculo_id = $1 AND destino_id = $2 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                                FOR UPDATE
                            `;
                            const destRes = await client.query(destQuery, [vinculoId, String(ingredienteId)]);
                            
                            if (destRes.rows.length > 0) {
                                const destRow = destRes.rows[0];
                                const cantAsignada = normalizarDecimalUniversal(destRow.cantidad_asignada);
                                
                                let nuevaCantidadAbierta = 0;
                                let nuevaCantidadAsignada = cantAsignada;
                                
                                if (cajasContadas <= cantAsignada) {
                                    nuevaCantidadAbierta = cantAsignada - cajasContadas;
                                } else {
                                    nuevaCantidadAsignada = cajasContadas;
                                    nuevaCantidadAbierta = 0;
                                }
                                
                                await client.query(`
                                    UPDATE public.bunker_lotes_destinos
                                    SET cantidad_asignada = $1, cantidad_abierta = $2
                                    WHERE id = $3
                                `, [nuevaCantidadAsignada, nuevaCantidadAbierta, destRow.id]);
                            }
                        } else if (vinculoId) {
                            console.warn(`🛡️ [INVENTARIO BLINDAJE] Omitiendo búsqueda en bunker_lotes_destinos para vinculo_id sintético/no-UUID: "${vinculoId}" (${cajasContadas} cj)`);
                        }
                    }

                    // Si hay otros lotes asignados a este ingrediente no incluidos en el conteo, cerrarlos
                    // Solo pasar vinculosProcesados garantizando tipo uuid[]
                    if (vinculosProcesados.length > 0) {
                        await client.query(`
                            UPDATE public.bunker_lotes_destinos
                            SET cantidad_abierta = cantidad_asignada
                            WHERE destino_id = $1 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                              AND NOT (vinculo_id = ANY($2::uuid[]))
                        `, [String(ingredienteId), vinculosProcesados]);
                    }
                } else if (item.total_bultos_contados !== undefined) {
                    totalBultosFinal = normalizarDecimalUniversal(item.total_bultos_contados);
                    if (totalBultosFinal === 0) {
                        await client.query(`
                            UPDATE public.bunker_lotes_destinos
                            SET cantidad_abierta = cantidad_asignada
                            WHERE destino_id = $1 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                        `, [String(ingredienteId)]);
                    }
                } else {
                    totalBultosFinal = 0;
                    await client.query(`
                        UPDATE public.bunker_lotes_destinos
                        SET cantidad_abierta = cantidad_asignada
                        WHERE destino_id = $1 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                    `, [String(ingredienteId)]);
                }
                
                const diffKilos = Math.round((stockKilosNuevo - stockKilosAnterior) * 1000) / 1000;
                const diffBultos = Math.round((totalBultosFinal - stockBultosAnterior) * 1000) / 1000;
                const fueAjustado = Math.abs(diffKilos) > 0.001 || Math.abs(diffBultos) > 0.001 || Boolean(item.forzar_ajuste);
                
                resumenItems.push({
                    ingrediente_id: ingredienteId,
                    nombre: ingActual.nombre,
                    codigo: ingActual.codigo || '',
                    unidad_medida: ingActual.unidad_medida || 'kg',
                    stock_anterior_kilos: stockKilosAnterior,
                    stock_nuevo_kilos: stockKilosNuevo,
                    diff_kilos: diffKilos,
                    stock_anterior_bultos: stockBultosAnterior,
                    stock_nuevo_bultos: totalBultosFinal,
                    diff_bultos: diffBultos,
                    kilos_sistema: stockKilosAnterior,
                    kilos_contados: stockKilosNuevo,
                    diferencia_kilos: diffKilos,
                    bultos_sistema: stockBultosAnterior,
                    bultos_contados: totalBultosFinal,
                    total_bultos_contados: totalBultosFinal,
                    diferencia_bultos: diffBultos,
                    lotes_contados: lotesContados,
                    ajustado: fueAjustado
                });
                
                if (fueAjustado) {
                    await client.query(`
                        UPDATE ingredientes
                        SET stock_actual = $1,
                            stock_bultos = $2
                        WHERE id = $3
                    `, [stockKilosNuevo, totalBultosFinal, ingredienteId]);
                    
                    const observacion = `Inventario Session: ${session_id} | Kilos: ${stockKilosAnterior} -> ${stockKilosNuevo} | Bultos: ${stockBultosAnterior} -> ${totalBultosFinal}`;
                    await client.query(`
                        INSERT INTO ingredientes_ajustes 
                        (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    `, [
                        ingredienteId,
                        usuario_id,
                        'inventario',
                        stockKilosAnterior,
                        stockKilosNuevo,
                        observacion
                    ]);
                    
                    ajustesAplicados++;
                    console.log(`✅ [INVENTARIO DUAL] Ajustado ${ingActual.nombre}: Kilos (${stockKilosAnterior} -> ${stockKilosNuevo}), Bultos (${stockBultosAnterior} -> ${totalBultosFinal})`);
                }
            }
            
            // Seguridad: asegurar que todos los ingredientes de los sectores auditados queden en la foto del inventario
            if (req.body.sectores) {
                let sectorIds = [];
                if (req.body.sectores !== 'TODOS') {
                    if (Array.isArray(req.body.sectores)) {
                        sectorIds = req.body.sectores.map(s => typeof s === 'object' ? (s.id || s.sector_id) : parseInt(s)).filter(id => !isNaN(id));
                    } else if (!isNaN(parseInt(req.body.sectores))) {
                        sectorIds = [parseInt(req.body.sectores)];
                    }
                }

                const yaProcesadosIds = resumenItems.map(r => r.ingrediente_id);
                let restantesQuery = '';
                let queryParams = [];

                if (req.body.sectores === 'TODOS') {
                    restantesQuery = `
                        SELECT id, nombre, codigo, unidad_medida, stock_actual, COALESCE(stock_bultos, 0) as stock_bultos
                        FROM ingredientes
                        WHERE NOT (id = ANY($1))
                        ORDER BY nombre ASC
                    `;
                    queryParams = [yaProcesadosIds.length > 0 ? yaProcesadosIds : [-1]];
                } else if (sectorIds.length > 0) {
                    restantesQuery = `
                        SELECT id, nombre, codigo, unidad_medida, stock_actual, COALESCE(stock_bultos, 0) as stock_bultos
                        FROM ingredientes
                        WHERE sector_id = ANY($1) AND NOT (id = ANY($2))
                        ORDER BY nombre ASC
                    `;
                    queryParams = [sectorIds, yaProcesadosIds.length > 0 ? yaProcesadosIds : [-1]];
                }

                if (restantesQuery) {
                    const restantesRes = await client.query(restantesQuery, queryParams);
                    for (const ing of restantesRes.rows) {
                        const kg = normalizarDecimalUniversal(ing.stock_actual);
                        const cj = normalizarDecimalUniversal(ing.stock_bultos);
                        const diffKg = Math.round((0 - kg) * 1000) / 1000;
                        const diffCj = Math.round((0 - cj) * 1000) / 1000;
                        const fueAjustado = Math.abs(diffKg) > 0.001 || Math.abs(diffCj) > 0.001;

                        if (fueAjustado) {
                            await client.query(`
                                UPDATE ingredientes
                                SET stock_actual = 0,
                                    stock_bultos = 0
                                WHERE id = $1
                            `, [ing.id]);

                            // Liberar/cerrar lotes asignados en bunker
                            await client.query(`
                                UPDATE public.bunker_lotes_destinos
                                SET cantidad_abierta = cantidad_asignada
                                WHERE destino_id = $1 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
                            `, [String(ing.id)]);

                            const observacion = `Inventario Session: ${session_id} | Kilos: ${kg} -> 0 | Bultos: ${cj} -> 0 | Sin existencia física en sector auditado`;
                            await client.query(`
                                INSERT INTO ingredientes_ajustes 
                                (ingrediente_id, usuario_id, tipo_ajuste, stock_anterior, stock_nuevo, observacion, fecha)
                                VALUES ($1, $2, 'inventario', $3, $4, $5, NOW())
                            `, [ing.id, usuario_id, kg, 0, observacion]);

                            ajustesAplicados++;
                        }

                        resumenItems.push({
                            ingrediente_id: ing.id,
                            nombre: ing.nombre,
                            codigo: ing.codigo || '',
                            unidad_medida: ing.unidad_medida || 'kg',
                            stock_anterior_kilos: kg,
                            stock_nuevo_kilos: 0,
                            diff_kilos: diffKg,
                            stock_anterior_bultos: cj,
                            stock_nuevo_bultos: 0,
                            diff_bultos: diffCj,
                            kilos_sistema: kg,
                            kilos_contados: 0,
                            diferencia_kilos: diffKg,
                            bultos_sistema: cj,
                            bultos_contados: 0,
                            total_bultos_contados: 0,
                            diferencia_bultos: diffCj,
                            lotes_contados: [],
                            ajustado: fueAjustado
                        });
                    }
                }
            }

            // Ordenar alfabéticamente para presentación prolija en modales y PDF
            resumenItems.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            
            // Obtener nombre del usuario responsable
            const userRes = await client.query('SELECT nombre_completo FROM usuarios WHERE id = $1', [usuario_id]);
            const usuarioNombre = userRes.rows[0]?.nombre_completo || 'Operario';

            // Formatear texto de sectores
            let textoSectores = 'Sector General';
            if (req.body.sectores) {
                if (req.body.sectores === 'TODOS') {
                    textoSectores = 'Todos los Sectores';
                } else if (Array.isArray(req.body.sectores)) {
                    textoSectores = req.body.sectores.map(s => typeof s === 'object' ? (s.descripcion || s.nombre || s.id) : ('Sector ' + s)).join(', ');
                } else {
                    textoSectores = String(req.body.sectores);
                }
            }

            // Procesar métricas de tiempo
            const duracionSegundosReq = parseInt(req.body.duracion_segundos);
            const fechaInicioReq = req.body.fecha_inicio ? new Date(req.body.fecha_inicio) : null;

            // UPSERT en inventario_ingredientes_sesiones para guardar la "foto" completa, duración y tiempos
            const sesionFinalRes = await client.query(`
                INSERT INTO inventario_ingredientes_sesiones (
                    session_id, usuario_id, fecha_inicio, fecha_finalizacion, estado, ingredientes_contados, observaciones, duracion_segundos
                )
                VALUES (
                    $1, 
                    $2, 
                    COALESCE($5, NOW() - INTERVAL '15 minutes'), 
                    NOW(), 
                    'finalizado', 
                    $3, 
                    $4,
                    COALESCE($6, 0)
                )
                ON CONFLICT (session_id) DO UPDATE SET
                    usuario_id = EXCLUDED.usuario_id,
                    fecha_inicio = COALESCE($5, inventario_ingredientes_sesiones.fecha_inicio),
                    fecha_finalizacion = NOW(),
                    estado = 'finalizado',
                    ingredientes_contados = EXCLUDED.ingredientes_contados,
                    observaciones = COALESCE(EXCLUDED.observaciones, inventario_ingredientes_sesiones.observaciones),
                    duracion_segundos = COALESCE(
                        $6, 
                        EXTRACT(EPOCH FROM (NOW() - COALESCE($5, inventario_ingredientes_sesiones.fecha_inicio)))::int,
                        0
                    )
                RETURNING fecha_inicio, fecha_finalizacion, duracion_segundos
            `, [
                session_id,
                usuario_id,
                JSON.stringify(resumenItems),
                textoSectores,
                fechaInicioReq,
                !isNaN(duracionSegundosReq) ? duracionSegundosReq : null
            ]);

            const duracionFinalSeg = sesionFinalRes.rows[0]?.duracion_segundos || (!isNaN(duracionSegundosReq) ? duracionSegundosReq : 0);
            const fechaInicioFinal = sesionFinalRes.rows[0]?.fecha_inicio || fechaInicioReq || new Date();
            const fechaFinFinal = sesionFinalRes.rows[0]?.fecha_finalizacion || new Date();
            const duracionTexto = formatearDuracionSegundos(duracionFinalSeg);

            await client.query('COMMIT');
            
            console.log(`🎉 [INVENTARIO DUAL] Finalizado exitosamente. Ajustes: ${ajustesAplicados}/${ingredientes_contados.length} | Duración: ${duracionTexto}`);
            
            res.json({ 
                success: true, 
                message: 'Ajustes de inventario dual aplicados correctamente',
                ajustes_aplicados: ajustesAplicados,
                total_procesados: ingredientes_contados.length,
                session_id: session_id,
                usuario_nombre: usuarioNombre,
                fecha_inicio: fechaInicioFinal,
                fecha_finalizacion: fechaFinFinal,
                duracion_segundos: duracionFinalSeg,
                duracion_texto: duracionTexto,
                sectores: textoSectores,
                resumen_items: resumenItems
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [INVENTARIO] Error en transaccion rollback:', error);
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ [INVENTARIO] Error general al aplicar ajustes:', error);
        res.status(500).json({ 
            error: 'Error al aplicar ajustes de inventario',
            detalle: error.message 
        });
    }
}

/**
 * Obtiene el estado actual de una sesion de inventario
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
            return res.status(404).json({ error: 'Sesion no encontrada' });
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
        console.error('❌ [INVENTARIO] Error al obtener estado de sesion:', error);
        res.status(500).json({ 
            error: 'Error al obtener estado de sesion',
            detalle: error.message 
        });
    }
}

/**
 * Obtiene el historial de inventarios finalizados
 */
async function obtenerHistorialInventarios(req, res) {
    try {
        console.log('📜 [INVENTARIO] Consultando historial de inventarios');
        const query = `
            SELECT 
                s.id,
                s.session_id,
                s.fecha_inicio,
                s.fecha_finalizacion,
                s.estado,
                s.observaciones as sectores,
                COALESCE(s.duracion_segundos, EXTRACT(EPOCH FROM (s.fecha_finalizacion - s.fecha_inicio))::int, 0) as duracion_segundos,
                u.nombre_completo as usuario_nombre,
                jsonb_array_length(COALESCE(s.ingredientes_contados, '[]'::jsonb)) as total_items,
                jsonb_array_length(COALESCE(s.ingredientes_contados, '[]'::jsonb)) as total_articulos,
                (
                    SELECT COUNT(*) 
                    FROM jsonb_array_elements(COALESCE(s.ingredientes_contados, '[]'::jsonb)) elem 
                    WHERE (elem->>'ajustado')::boolean = true
                ) as items_ajustados,
                (
                    SELECT COUNT(*) 
                    FROM jsonb_array_elements(COALESCE(s.ingredientes_contados, '[]'::jsonb)) elem 
                    WHERE (elem->>'ajustado')::boolean = true
                ) as total_ajustes
            FROM inventario_ingredientes_sesiones s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.estado = 'finalizado'
            ORDER BY s.fecha_finalizacion DESC NULLS LAST, s.id DESC
            LIMIT 50
        `;
        const result = await pool.query(query);
        const historialEnriquecido = result.rows.map(r => {
            const seg = parseInt(r.duracion_segundos) || 0;
            return {
                ...r,
                duracion_segundos: seg,
                duracion_texto: formatearDuracionSegundos(seg)
            };
        });
        res.json({
            success: true,
            historial: historialEnriquecido
        });
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al obtener historial:', error);
        res.status(500).json({ error: 'Error al obtener historial de inventarios', detalle: error.message });
    }
}

/**
 * Obtiene el detalle completo de una sesión de inventario con todos sus items auditados
 */
async function obtenerDetalleSesionInventario(req, res) {
    try {
        const { session_id } = req.params;
        console.log('🔍 [INVENTARIO] Consultando detalle de sesión:', session_id);
        const query = `
            SELECT 
                s.id,
                s.session_id,
                s.fecha_inicio,
                s.fecha_finalizacion,
                s.estado,
                s.observaciones as sectores,
                s.ingredientes_contados,
                COALESCE(s.duracion_segundos, EXTRACT(EPOCH FROM (s.fecha_finalizacion - s.fecha_inicio))::int, 0) as duracion_segundos,
                u.nombre_completo as usuario_nombre
            FROM inventario_ingredientes_sesiones s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.session_id = $1
        `;
        const result = await pool.query(query, [session_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sesión de inventario no encontrada' });
        }
        const ses = result.rows[0];
        const seg = parseInt(ses.duracion_segundos) || 0;
        res.json({
            success: true,
            sesion: {
                ...ses,
                duracion_segundos: seg,
                duracion_texto: formatearDuracionSegundos(seg)
            }
        });
    } catch (error) {
        console.error('❌ [INVENTARIO] Error al obtener detalle de sesión:', error);
        res.status(500).json({ error: 'Error al obtener detalle de sesión', detalle: error.message });
    }
}

/**
 * Genera el informe oficial de inventario en formato PDF (Landscape A4 con PDFKit)
 */
async function generarInformePDFInventario(req, res) {
    try {
        const { session_id } = req.params;
        const PDFDocument = require('pdfkit');

        console.log('🖨️ [INVENTARIO-PDF] Generando informe para sesión:', session_id);

        const query = `
            SELECT 
                s.id,
                s.session_id,
                s.fecha_inicio,
                s.fecha_finalizacion,
                s.estado,
                s.observaciones as sectores,
                s.ingredientes_contados,
                COALESCE(s.duracion_segundos, EXTRACT(EPOCH FROM (s.fecha_finalizacion - s.fecha_inicio))::int, 0) as duracion_segundos,
                u.nombre_completo as usuario_nombre
            FROM inventario_ingredientes_sesiones s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.session_id = $1
        `;
        const result = await pool.query(query, [session_id]);
        let sesion = result.rows[0];
        let items = (sesion && Array.isArray(sesion.ingredientes_contados)) ? sesion.ingredientes_contados : [];

        // Fallback: si no hay items guardados en la sesión, buscar en ingredientes_ajustes
        if (items.length === 0) {
            const ajRes = await pool.query(`
                SELECT a.*, i.nombre, i.codigo, i.unidad_medida
                FROM ingredientes_ajustes a
                LEFT JOIN ingredientes i ON i.id = a.ingrediente_id
                WHERE a.observacion LIKE '%' || $1 || '%'
                ORDER BY i.nombre ASC
            `, [session_id]);

            if (ajRes.rows.length > 0) {
                items = ajRes.rows.map(r => {
                    let bultosAnt = 0, bultosNue = 0;
                    const matchBultos = (r.observacion || '').match(/Bultos:\s*(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)/);
                    if (matchBultos) {
                        bultosAnt = parseFloat(matchBultos[1]);
                        bultosNue = parseFloat(matchBultos[2]);
                    }
                    let kilosAnt = parseFloat(r.stock_anterior || 0);
                    let kilosNue = parseFloat(r.stock_nuevo || 0);
                    const matchKilos = (r.observacion || '').match(/Kilos:\s*(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)/);
                    if (matchKilos) {
                        kilosAnt = parseFloat(matchKilos[1]);
                        kilosNue = parseFloat(matchKilos[2]);
                    }
                    return {
                        ingrediente_id: r.ingrediente_id,
                        nombre: r.nombre || ('Ingrediente #' + r.ingrediente_id),
                        codigo: r.codigo || '',
                        unidad_medida: r.unidad_medida || 'kg',
                        stock_anterior_kilos: kilosAnt,
                        stock_nuevo_kilos: kilosNue,
                        diff_kilos: kilosNue - kilosAnt,
                        stock_anterior_bultos: bultosAnt,
                        stock_nuevo_bultos: bultosNue,
                        diff_bultos: bultosNue - bultosAnt,
                        lotes_contados: [],
                        ajustado: Math.abs(kilosNue - kilosAnt) > 0.001 || Math.abs(bultosNue - bultosAnt) > 0.001
                    };
                });
            }
        }

        if (!sesion && items.length === 0) {
            return res.status(404).send('Sesión de inventario no encontrada o sin registros.');
        }

        const usuarioNombre = sesion?.usuario_nombre || 'Operario';
        const sectoresTexto = sesion?.sectores || 'General';
        const fechaCierre = sesion?.fecha_finalizacion
            ? new Date(sesion.fecha_finalizacion).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
            : new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

        // Cálculo y formateo de duración para el encabezado
        const duracionSeg = parseInt(sesion?.duracion_segundos) || 0;
        const duracionTexto = formatearDuracionSegundos(duracionSeg);
        let rangoHorarioTexto = '';
        if (sesion?.fecha_inicio && sesion?.fecha_finalizacion) {
            const hInicio = new Date(sesion.fecha_inicio).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const hFin = new Date(sesion.fecha_finalizacion).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            rangoHorarioTexto = ` (${hInicio} a ${hFin})`;
        }

        const totalItems = items.length;
        const totalAjustados = items.filter(i => {
            const dKg = Math.abs(normalizarDecimalUniversal(i.diff_kilos !== undefined ? i.diff_kilos : ((i.stock_nuevo_kilos || i.kilos_contados || 0) - (i.stock_anterior_kilos || i.kilos_sistema || 0))));
            const dCj = Math.abs(normalizarDecimalUniversal(i.diff_bultos !== undefined ? i.diff_bultos : ((i.stock_nuevo_bultos || i.total_bultos_contados || 0) - (i.stock_anterior_bultos || i.bultos_sistema || 0))));
            return i.ajustado || dKg > 0.001 || dCj > 0.001;
        }).length;
        const totalSinCambio = totalItems - totalAjustados;
        const totalKilos = items.reduce((acc, i) => acc + normalizarDecimalUniversal(i.stock_nuevo_kilos !== undefined ? i.stock_nuevo_kilos : (i.kilos_contados || 0)), 0);
        const totalBultos = items.reduce((acc, i) => acc + normalizarDecimalUniversal(i.stock_nuevo_bultos !== undefined ? i.stock_nuevo_bultos : (i.total_bultos_contados || 0)), 0);

        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: 30,
            info: {
                Title: `Informe_Inventario_${session_id}`,
                Author: 'LAMDA Sistema Integral'
            },
            bufferPages: true
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="informe_inventario_${session_id}.pdf"`);
        doc.pipe(res);

        // Encabezado con Logo Oficial LAMDA
        const logoPath = path.join(__dirname, '../img/logo_LAMDA_grande.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 30, 22, { width: 110 });
        } else {
            doc.fillColor('#1e40af').fontSize(18).font('Helvetica-Bold').text('LAMDA', 30, 25);
        }
        doc.fillColor('#334155').fontSize(11).font('Helvetica-Bold').text('INFORME OFICIAL DE AUDITORÍA Y RESULTADOS DE INVENTARIO', 150, 32);

        // Info en cabecera derecha con Tiempos y Duración
        doc.fontSize(8).font('Helvetica').fillColor('#475569');
        doc.text(`Fecha: ${fechaCierre}`, 560, 16, { align: 'right', width: 250 });
        doc.text(`Responsable: ${usuarioNombre}`, 560, 27, { align: 'right', width: 250 });
        doc.text(`Sectores: ${sectoresTexto}`, 560, 38, { align: 'right', width: 250 });
        doc.text(`Duración Conteo: ${duracionTexto}${rangoHorarioTexto}`, 560, 49, { align: 'right', width: 250 });
        doc.text(`Sesión: ${session_id}`, 560, 60, { align: 'right', width: 250 });

        // Línea divisoria
        doc.moveTo(30, 73).lineTo(812, 73).strokeColor('#cbd5e1').lineWidth(1).stroke();

        // Bloque Resumen KPIs
        doc.rect(30, 78, 782, 34).fillAndStroke('#f8fafc', '#e2e8f0');
        
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1e293b');
        doc.text('TOTAL ARTÍCULOS:', 40, 90);
        doc.font('Helvetica').fillColor('#0f172a').text(`${totalItems}`, 145, 90);

        doc.font('Helvetica-Bold').fillColor('#b91c1c').text('CON AJUSTE / DIF:', 200, 90);
        doc.font('Helvetica').fillColor('#b91c1c').text(`${totalAjustados}`, 305, 90);

        doc.font('Helvetica-Bold').fillColor('#15803d').text('SIN DIFERENCIAS:', 360, 90);
        doc.font('Helvetica').fillColor('#15803d').text(`${totalSinCambio}`, 465, 90);

        doc.font('Helvetica-Bold').fillColor('#1e40af').text('KILOS FINALES:', 530, 90);
        doc.font('Helvetica').fillColor('#1e40af').text(`${totalKilos.toFixed(2)} kg`, 620, 90);

        doc.font('Helvetica-Bold').fillColor('#7e22ce').text('BULTOS FINALES:', 690, 90);
        doc.font('Helvetica').fillColor('#7e22ce').text(`${totalBultos} cj`, 775, 90);

        // Tabla de Resultados
        const tableTop = 120;
        let currentY = tableTop;

        const dibujarEncabezadoTabla = (y) => {
            doc.rect(30, y, 782, 20).fill('#1e293b');
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
            doc.text('INGREDIENTE', 35, y + 6, { width: 175 });
            doc.text('CÓDIGO', 215, y + 6, { width: 50 });
            doc.text('KG SIS.', 270, y + 6, { width: 55, align: 'right' });
            doc.text('KG CONT.', 330, y + 6, { width: 55, align: 'right' });
            doc.text('DIF. KG', 390, y + 6, { width: 55, align: 'right' });
            doc.text('CJ SIS.', 450, y + 6, { width: 45, align: 'right' });
            doc.text('CJ CONT.', 500, y + 6, { width: 45, align: 'right' });
            doc.text('DIF. CJ', 550, y + 6, { width: 45, align: 'right' });
            doc.text('DETALLE LOTES', 605, y + 6, { width: 135 });
            doc.text('ESTADO', 745, y + 6, { width: 60, align: 'center' });
            return y + 20;
        };

        currentY = dibujarEncabezadoTabla(currentY);

        items.forEach((it, index) => {
            if (currentY > 525) {
                doc.addPage();
                currentY = dibujarEncabezadoTabla(30);
            }

            const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc.rect(30, currentY, 782, 17).fill(rowBg);

            doc.fontSize(7.5).font('Helvetica').fillColor('#0f172a');
            const nombreClean = (it.nombre || '').substring(0, 36);
            doc.font('Helvetica-Bold').text(nombreClean, 35, currentY + 4, { width: 175, ellipsis: true });
            
            doc.font('Helvetica').fillColor('#64748b');
            doc.text(it.codigo ? String(it.codigo) : '-', 215, currentY + 4, { width: 50 });

            // Kilos
            const kgSis = normalizarDecimalUniversal(it.stock_anterior_kilos !== undefined ? it.stock_anterior_kilos : (it.kilos_sistema !== undefined ? it.kilos_sistema : (it.stock_anterior || 0)));
            const kgCont = normalizarDecimalUniversal(it.stock_nuevo_kilos !== undefined ? it.stock_nuevo_kilos : (it.kilos_contados !== undefined ? it.kilos_contados : (it.stock_nuevo || 0)));
            const diffKg = normalizarDecimalUniversal(it.diff_kilos !== undefined ? it.diff_kilos : (it.diferencia_kilos !== undefined ? it.diferencia_kilos : (kgCont - kgSis)));

            doc.fillColor('#334155').text(kgSis.toFixed(2), 270, currentY + 4, { width: 55, align: 'right' });
            doc.text(kgCont.toFixed(2), 330, currentY + 4, { width: 55, align: 'right' });

            if (Math.abs(diffKg) > 0.001) {
                doc.fillColor(diffKg > 0 ? '#15803d' : '#dc2626').font('Helvetica-Bold');
                doc.text(`${diffKg > 0 ? '+' : ''}${diffKg.toFixed(2)}`, 390, currentY + 4, { width: 55, align: 'right' });
            } else {
                doc.fillColor('#94a3b8').font('Helvetica');
                doc.text('0.00', 390, currentY + 4, { width: 55, align: 'right' });
            }

            // Bultos
            const cjSis = normalizarDecimalUniversal(it.stock_anterior_bultos !== undefined ? it.stock_anterior_bultos : (it.bultos_sistema !== undefined ? it.bultos_sistema : 0));
            const cjCont = normalizarDecimalUniversal(it.stock_nuevo_bultos !== undefined ? it.stock_nuevo_bultos : (it.total_bultos_contados !== undefined ? it.total_bultos_contados : (it.bultos_contados !== undefined ? it.bultos_contados : 0)));
            const diffCj = normalizarDecimalUniversal(it.diff_bultos !== undefined ? it.diff_bultos : (it.diferencia_bultos !== undefined ? it.diferencia_bultos : (cjCont - cjSis)));

            doc.fillColor('#334155').font('Helvetica');
            doc.text(String(cjSis), 450, currentY + 4, { width: 45, align: 'right' });
            doc.text(String(cjCont), 500, currentY + 4, { width: 45, align: 'right' });

            if (Math.abs(diffCj) > 0.001) {
                doc.fillColor(diffCj > 0 ? '#15803d' : '#dc2626').font('Helvetica-Bold');
                doc.text(`${diffCj > 0 ? '+' : ''}${diffCj}`, 550, currentY + 4, { width: 45, align: 'right' });
            } else {
                doc.fillColor('#94a3b8').font('Helvetica');
                doc.text('0', 550, currentY + 4, { width: 45, align: 'right' });
            }

            // Lotes detalle
            doc.font('Helvetica').fillColor('#6b21a8');
            let lotesStr = '-';
            if (Array.isArray(it.lotes_contados) && it.lotes_contados.length > 0) {
                const conCajas = it.lotes_contados.filter(l => (parseFloat(l.cajas_contadas) || 0) > 0);
                if (conCajas.length > 0) {
                    lotesStr = conCajas.map(l => `#${l.id_corto || l.lote_codigo_corto || 'L'}: ${l.cajas_contadas}cj`).join(', ');
                }
            } else if (it.detalle_lotes) {
                lotesStr = it.detalle_lotes;
            }
            doc.text(lotesStr, 605, currentY + 4, { width: 135, ellipsis: true });

            // Estado
            const esAjustado = it.ajustado !== undefined ? Boolean(it.ajustado) : (Math.abs(diffKg) > 0.001 || Math.abs(diffCj) > 0.001);
            if (esAjustado) {
                doc.fillColor('#dc2626').font('Helvetica-Bold').text('AJUSTADO', 745, currentY + 4, { width: 60, align: 'center' });
            } else {
                doc.fillColor('#15803d').font('Helvetica').text('OK', 745, currentY + 4, { width: 60, align: 'center' });
            }

            doc.moveTo(30, currentY + 17).lineTo(812, currentY + 17).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            currentY += 17;
        });

        // Paginación limpia sin desbordar margen
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(i);
            doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8');
            doc.text(`LAMDA — Sistema de Producción e Inventario Integral`, 30, 550, { lineBreak: false });
            doc.text(`Página ${i + 1} de ${range.count}`, 700, 550, { align: 'right', width: 112, lineBreak: false });
        }

        doc.end();

    } catch (error) {
        console.error('❌ [INVENTARIO-PDF] Error al generar PDF de inventario:', error);
        if (!res.headersSent) {
            res.status(500).send('Error interno al generar el informe de inventario.');
        }
    }
}

module.exports = {
    iniciarSesionInventario,
    registrarIngredienteContado,
    aplicarAjustesInventario,
    obtenerEstadoSesion,
    calcularDiferencias,
    obtenerHistorialInventarios,
    obtenerDetalleSesionInventario,
    generarInformePDFInventario
};
