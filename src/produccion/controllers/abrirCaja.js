/**
 * Controlador para la funcionalidad "Abrir Caja"
 * Permite transformar stock de cajas a unidades mediante movimientos simples
 * 
 * @module controllers/abrirCaja
 */

const pool = require('../config/database');

/**
 * Obtener sugerencias inteligentes de cajas basadas en historial
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function obtenerSugerenciasCajas(req, res) {
    try {
        const { articulo_unidad } = req.query;
        
        if (!articulo_unidad) {
            return res.status(400).json({ 
                error: 'Se requiere el código del artículo unidad' 
            });
        }

        console.log(`🔍 [ABRIR-CAJA] Buscando sugerencias para unidad: ${articulo_unidad}`);

        // Consultar historial de aperturas previas
        const query = `
            SELECT DISTINCT
                svm.origen_ingreso as codigo_caja,
                COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, src.descripcion) as descripcion_caja,
                COALESCE(a.codigo_barras, src.codigo_barras) as codigo_barras,
                ROUND(CAST(src.stock_consolidado AS NUMERIC), 2) as stock_actual,
                COALESCE(src.pack_unidades, ba.pack_unidades, 0) as pack_unidades,
                MAX(svm.fecha) as ultima_apertura,
                COUNT(*) as veces_usado
            FROM stock_ventas_movimientos svm
            LEFT JOIN stock_real_consolidado src ON src.articulo_numero = svm.origen_ingreso
            LEFT JOIN articulos a ON a.numero = svm.origen_ingreso
            LEFT JOIN bunker_articulos ba ON ba.articulo_id = svm.origen_ingreso
            WHERE svm.articulo_numero = $1
              AND svm.tipo = 'apertura_caja_entrada'
              AND svm.origen_ingreso IS NOT NULL
              AND svm.origen_ingreso != ''
            GROUP BY svm.origen_ingreso, ba.descripcion_generada, ba.descripcion, a.nombre, src.descripcion, a.codigo_barras, src.codigo_barras, src.stock_consolidado, src.pack_unidades, ba.pack_unidades
            HAVING ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
            ORDER BY MAX(svm.fecha) DESC, COUNT(*) DESC
            LIMIT 5
        `;

        const result = await pool.query(query, [articulo_unidad]);

        console.log(`✅ [ABRIR-CAJA] Encontradas ${result.rows.length} sugerencias con stock`);

        res.json({
            success: true,
            sugerencias: result.rows
        });

    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al obtener sugerencias:', error);
        res.status(500).json({
            error: 'Error al obtener sugerencias de cajas',
            detalle: error.message
        });
    }
}

/**
 * Buscar cajas por código de barras o descripción
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function buscarCajas(req, res) {
    try {
        const { codigo_barras, descripcion } = req.query;

        if (!codigo_barras && !descripcion) {
            return res.status(400).json({
                error: 'Se requiere código de barras o descripción para buscar'
            });
        }

        let query;
        let params;

        if (codigo_barras) {
            // Búsqueda por código de barras (exacta)
            console.log(`🔍 [ABRIR-CAJA] Buscando por código de barras: ${codigo_barras}`);
            
            query = `
                SELECT 
                    COALESCE(ba.articulo_id, a.numero, src.articulo_numero) as articulo_numero,
                    COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, src.descripcion) as descripcion,
                    COALESCE(a.codigo_barras, src.codigo_barras) as codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) as stock_actual,
                    COALESCE(src.pack_unidades, ba.pack_unidades, 0) as pack_unidades
                FROM stock_real_consolidado src
                LEFT JOIN articulos a ON (a.numero = src.articulo_numero OR a.codigo_barras = src.codigo_barras)
                LEFT JOIN bunker_articulos ba ON (ba.articulo_id = src.articulo_numero)
                WHERE (src.codigo_barras = $1 OR a.codigo_barras = $1)
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                LIMIT 1
            `;
            params = [codigo_barras];

        } else {
            // Búsqueda por descripción (múltiples palabras)
            console.log(`🔍 [ABRIR-CAJA] Buscando por descripción: ${descripcion}`);
            
            // Dividir descripción en palabras y crear condiciones ILIKE
            const palabras = descripcion.trim().split(/\s+/).filter(p => p.length > 0);
            const condiciones = palabras.map((_, idx) => `(COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, src.descripcion) ILIKE $${idx + 1} OR src.articulo_numero ILIKE $${idx + 1})`).join(' AND ');
            const valores = palabras.map(p => `%${p}%`);

            query = `
                SELECT 
                    COALESCE(ba.articulo_id, a.numero, src.articulo_numero) as articulo_numero,
                    COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, src.descripcion) as descripcion,
                    COALESCE(a.codigo_barras, src.codigo_barras) as codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) as stock_actual,
                    COALESCE(src.pack_unidades, ba.pack_unidades, 0) as pack_unidades
                FROM stock_real_consolidado src
                LEFT JOIN articulos a ON (a.numero = src.articulo_numero OR a.codigo_barras = src.codigo_barras)
                LEFT JOIN bunker_articulos ba ON (ba.articulo_id = src.articulo_numero)
                WHERE ${condiciones}
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                ORDER BY descripcion
                LIMIT 20
            `;
            params = valores;
        }

        const result = await pool.query(query, params);

        console.log(`✅ [ABRIR-CAJA] Encontrados ${result.rows.length} resultados`);

        res.json({
            success: true,
            resultados: result.rows
        });

    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al buscar cajas:', error);
        res.status(500).json({
            error: 'Error al buscar cajas',
            detalle: error.message
        });
    }
}

/**
 * Obtener o generar lote sugerido para apertura de caja
 * GET /api/produccion/abrir-caja/lote-sugerido?codigo_caja=XXX
 */
async function obtenerLoteSugerido(req, res) {
    try {
        const { codigo_caja } = req.query;
        let loteSugerido = null;
        let origen = 'generado';

        // 1. Si se proporciona código de caja, buscar si tiene lote activo asignado en bunker_lotes_destinos
        if (codigo_caja) {
            const query = `
                SELECT v.lote_codigo_corto, v.lote_id_supabase
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                  AND d.destino_id = $1
                  AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                ORDER BY v.fecha_vinculacion ASC
                LIMIT 1
            `;
            const result = await pool.query(query, [codigo_caja]);
            if (result.rows.length > 0 && result.rows[0].lote_codigo_corto) {
                loteSugerido = result.rows[0].lote_codigo_corto;
                origen = 'lote_caja';
            }
        }

        // 2. Si no hay lote de caja asignado, generar un lote canónico con prefijo L y 7 caracteres
        if (!loteSugerido) {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let alias = 'L';
            for (let i = 0; i < 7; i++) {
                alias += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            loteSugerido = alias;
            origen = 'generado';
        }

        res.json({
            success: true,
            lote: loteSugerido,
            origen
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al sugerir lote:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Registrar apertura de caja (transacción completa)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarAperturaCaja(req, res) {
    const client = await pool.connect();
    
    try {
        const {
            codigo_caja,
            codigo_unidad,
            cantidad_unidades,
            usuario_id,
            kilos_caja,
            kilos_unidad,
            lote
        } = req.body;

        // Validaciones
        if (!codigo_caja || !codigo_unidad || !cantidad_unidades || !usuario_id) {
            return res.status(400).json({
                error: 'Faltan datos requeridos',
                requeridos: ['codigo_caja', 'codigo_unidad', 'cantidad_unidades', 'usuario_id']
            });
        }

        if (cantidad_unidades < 1) {
            return res.status(400).json({
                error: 'La cantidad de unidades debe ser al menos 1'
            });
        }

        console.log(`\n🔓 [ABRIR-CAJA] ===== INICIANDO APERTURA =====`);
        console.log(`📦 Caja: ${codigo_caja}`);
        console.log(`📦 Unidad: ${codigo_unidad}`);
        console.log(`🔢 Cantidad: ${cantidad_unidades}`);
        console.log(`👤 Usuario: ${usuario_id}`);
        console.log(`🏷️ Lote: ${lote || 'Sin lote'}`);

        // Iniciar transacción
        await client.query('BEGIN');

        // 1. Verificar stock de la caja
        const stockCajaQuery = `
            SELECT 
                articulo_numero,
                descripcion,
                stock_consolidado
            FROM stock_real_consolidado
            WHERE articulo_numero = $1
            FOR UPDATE
        `;
        const stockCajaResult = await client.query(stockCajaQuery, [codigo_caja]);

        if (stockCajaResult.rows.length === 0) {
            throw new Error(`Caja ${codigo_caja} no encontrada en stock`);
        }

        const stockCaja = parseFloat(stockCajaResult.rows[0].stock_consolidado) || 0;
        
        if (stockCaja < 1) {
            throw new Error(`Stock insuficiente de caja ${codigo_caja}. Stock actual: ${stockCaja}`);
        }

        console.log(`✅ [ABRIR-CAJA] Stock caja verificado: ${stockCaja}`);

        // Obtener kilos de caja y unidad si no fueron provistos en el request
        let kilosCajaFinal = parseFloat(kilos_caja) || 0;
        let kilosUnidadFinal = parseFloat(kilos_unidad) || 0;

        if (kilosUnidadFinal <= 0) {
            const resKu = await client.query('SELECT kilos_unidad FROM stock_real_consolidado WHERE articulo_numero = $1', [codigo_unidad]);
            if (resKu.rows.length > 0 && resKu.rows[0].kilos_unidad) {
                kilosUnidadFinal = parseFloat(resKu.rows[0].kilos_unidad) || 0;
            }
        }

        if (kilosCajaFinal <= 0) {
            const resKc = await client.query('SELECT kilos_unidad FROM stock_real_consolidado WHERE articulo_numero = $1', [codigo_caja]);
            if (resKc.rows.length > 0 && resKc.rows[0].kilos_unidad) {
                kilosCajaFinal = parseFloat(resKc.rows[0].kilos_unidad) || 0;
            }
        }

        // 2. Registrar ENTRADA de unidades (tipo='apertura_caja_entrada')
        const insertEntradaQuery = `
            INSERT INTO stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id,
                observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, $8)
            RETURNING id
        `;

        const entradaResult = await client.query(insertEntradaQuery, [
            codigo_unidad,                    // articulo_numero (unidad)
            null,                             // codigo_barras (puede ser null)
            kilosUnidadFinal,                 // kilos
            cantidad_unidades,                // cantidad (+N)
            'apertura_caja_entrada',          // tipo
            codigo_caja,                      // origen_ingreso (código de la caja)
            usuario_id,                       // usuario_id
            `Apertura de caja ${codigo_caja}${lote ? ' - Lote: ' + lote : ''}` // observaciones
        ]);

        const movimientoEntradaId = entradaResult.rows[0].id;
        console.log(`✅ [ABRIR-CAJA] Entrada registrada (ID: ${movimientoEntradaId})`);

        // 3. Registrar SALIDA de caja (tipo='apertura_caja_salida')
        const insertSalidaQuery = `
            INSERT INTO stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id,
                observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, $8)
            RETURNING id
        `;

        const salidaResult = await client.query(insertSalidaQuery, [
            codigo_caja,                      // articulo_numero (caja)
            null,                             // codigo_barras
            kilosCajaFinal,                   // kilos
            -1,                               // cantidad (-1)
            'apertura_caja_salida',           // tipo
            codigo_unidad,                    // origen_ingreso (código de la unidad)
            usuario_id,                       // usuario_id
            `Desempacada en ${cantidad_unidades} un. de ${codigo_unidad}${lote ? ' - Lote: ' + lote : ''}` // observaciones
        ]);

        const movimientoSalidaId = salidaResult.rows[0].id;
        console.log(`✅ [ABRIR-CAJA] Salida registrada (ID: ${movimientoSalidaId})`);

        // 4. Actualizar bunker_lotes_destinos si la caja tiene asignación activa de lote
        try {
            await client.query('SAVEPOINT sp_lote');

            let loteActualizado = false;

            // Prioridad 1: si vino un lote específico, actualizar esa asignación concreta
            if (lote) {
                const resLote = await client.query(`
                    UPDATE public.bunker_lotes_destinos
                    SET cantidad_abierta = COALESCE(cantidad_abierta, 0) + 1
                    WHERE id = (
                        SELECT d.id
                        FROM public.bunker_lotes_destinos d
                        JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                        WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                          AND d.destino_id = $1
                          AND (v.lote_codigo_corto = $2 OR v.lote_id_supabase = $2)
                          AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                        ORDER BY v.fecha_vinculacion ASC
                        LIMIT 1
                    )
                    RETURNING id
                `, [codigo_caja, lote]);

                if (resLote.rowCount > 0) {
                    loteActualizado = true;
                    console.log(`✅ [ABRIR-CAJA] bunker_lotes_destinos actualizado para lote asignado: ${lote}`);
                }
            }

            // Prioridad 2: si no hubo coincidencia por lote específico, actualizar por FIFO
            if (!loteActualizado) {
                const resFifo = await client.query(`
                    UPDATE public.bunker_lotes_destinos
                    SET cantidad_abierta = COALESCE(cantidad_abierta, 0) + 1
                    WHERE id = (
                        SELECT d.id
                        FROM public.bunker_lotes_destinos d
                        JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                        WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                          AND d.destino_id = $1
                          AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                        ORDER BY v.fecha_vinculacion ASC
                        LIMIT 1
                    )
                    RETURNING id
                `, [codigo_caja]);

                if (resFifo.rowCount > 0) {
                    console.log(`✅ [ABRIR-CAJA] bunker_lotes_destinos actualizado por FIFO para caja: ${codigo_caja}`);
                }
            }

            await client.query('RELEASE SAVEPOINT sp_lote');
        } catch (loteErr) {
            await client.query('ROLLBACK TO SAVEPOINT sp_lote').catch(() => {});
            console.warn('⚠️ [ABRIR-CAJA] Registro en bunker_lotes_destinos omitido:', loteErr.message);
        }

        // 5. Actualizar stock_real_consolidado para UNIDAD (sumar unidades)
        const updateStockUnidadQuery = `
            INSERT INTO stock_real_consolidado (
                articulo_numero,
                stock_movimientos,
                stock_lomasoft,
                stock_ajustes,
                stock_consolidado,
                ultima_actualizacion
            ) VALUES ($1, $2, 0, 0, $2, NOW())
            ON CONFLICT (articulo_numero)
            DO UPDATE SET
                stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                ultima_actualizacion = NOW()
        `;

        await client.query(updateStockUnidadQuery, [codigo_unidad, cantidad_unidades]);
        console.log(`✅ [ABRIR-CAJA] Stock unidad actualizado (+${cantidad_unidades})`);

        // 6. Actualizar stock_real_consolidado para CAJA (restar 1)
        const updateStockCajaQuery = `
            UPDATE stock_real_consolidado
            SET 
                stock_movimientos = COALESCE(stock_movimientos, 0) - 1,
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $1
        `;

        await client.query(updateStockCajaQuery, [codigo_caja]);
        console.log(`✅ [ABRIR-CAJA] Stock caja actualizado (-1)`);

        // 7. Recalcular stock_consolidado para ambos artículos
        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        
        await recalcularStockConsolidado(client, codigo_unidad);
        console.log(`✅ [ABRIR-CAJA] Stock consolidado recalculado para unidad`);
        
        await recalcularStockConsolidado(client, codigo_caja);
        console.log(`✅ [ABRIR-CAJA] Stock consolidado recalculado para caja`);

        // Confirmar transacción
        await client.query('COMMIT');

        console.log(`🎉 [ABRIR-CAJA] ===== APERTURA COMPLETADA =====\n`);

        res.json({
            success: true,
            mensaje: 'Caja abierta exitosamente',
            movimientos: {
                entrada_id: movimientoEntradaId,
                salida_id: movimientoSalidaId
            },
            cantidad_unidades: cantidad_unidades,
            lote: lote || null
        });

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        
        console.error('❌ [ABRIR-CAJA] Error al registrar apertura:', error);
        console.error('Stack:', error.stack);

        res.status(500).json({
            error: 'Error al abrir caja',
            detalle: error.message
        });

    } finally {
        client.release();
    }
}

module.exports = {
    obtenerSugerenciasCajas,
    buscarCajas,
    obtenerLoteSugerido,
    registrarAperturaCaja
};
