const pool = require('../config/database');

/**
 * Obtener stock actual en mantenimiento (Cuarentena)
 * Fuente: public.stock_real_consolidado
 */
async function getStockMantenimiento(req, res) {
    try {
        console.log('🔍 [MANTENIMIENTO] Consultando stock en cuartena...');

        const query = `
            SELECT 
                s.articulo_numero,
                s.descripcion, -- Agregado para frontend
                s.stock_mantenimiento,
                s.stock_lomasoft,
                s.stock_movimientos,
                s.stock_ajustes,
                s.ultima_actualizacion,
                s.kilos_unidad, 
                origin.cliente_id,
                origin.estado,
                origin.cliente_nombre
            FROM public.stock_real_consolidado s
            LEFT JOIN LATERAL (
                SELECT 
                    c.cliente_id,
                    mm.estado, -- Necesario para saber si ya esta conciliado
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Desconocido') as cliente_nombre
                FROM public.mantenimiento_movimientos mm
                JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                JOIN public.clientes c ON p.id_cliente::text = c.cliente_id::text
                WHERE mm.articulo_numero = s.articulo_numero
                  AND mm.tipo_movimiento = 'INGRESO'
                ORDER BY mm.fecha_movimiento DESC
                LIMIT 1
            ) origin ON true
            WHERE s.stock_mantenimiento > 0
            ORDER BY s.articulo_numero ASC
        `;

        const result = await pool.query(query);
        res.json(result.rows);

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al obtener stock:', error.message);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Obtener historial de movimientos de mantenimiento
 */
/**
 * Obtener historial de movimientos de mantenimiento
 */
async function getHistorialMantenimiento(req, res) {
    try {
        const limit = req.query.limit || 50;
        const ocultarAnulados = req.query.ocultar_anulados === 'true';

        // 1. Obtener historial base (Sin Joins complejos que fallen)
        let query = `
            SELECT 
                mm.id,
                mm.articulo_numero,
                mm.cantidad,
                mm.usuario,
                mm.tipo_movimiento,
                mm.observaciones,
                mm.fecha_movimiento,
                mm.estado
            FROM public.mantenimiento_movimientos mm
        `;

        if (ocultarAnulados) {
            query += " WHERE mm.estado != 'REVERTIDO' ";
        }

        query += ` ORDER BY mm.fecha_movimiento DESC LIMIT $1`;

        const result = await pool.query(query, [limit]);
        const rows = result.rows;

        // 2. Enriquecimiento manual en JS (Mucho más seguro que SQL Regex)
        // Extraemos IDs de ingredientes de las observaciones
        const ingredientIds = new Set();
        const rowsToEnrich = [];

        rows.forEach(row => {
            if (row.tipo_movimiento === 'TRANSF_INGREDIENTE' && row.observaciones) {
                const match = row.observaciones.match(/ID: (\d+)/);
                if (match && match[1]) {
                    const id = parseInt(match[1]);
                    ingredientIds.add(id);
                    // Guardamos referencia temp para luego asignar
                    row._tempIngId = id;
                }
            }
        });

        // 3. Consultar Ingredientes si hay alguno
        let ingredientesMap = {};
        if (ingredientIds.size > 0) {
            const idsArray = Array.from(ingredientIds);
            const ingQuery = `
                SELECT 
                    i.id, 
                    i.nombre, 
                    i.codigo, 
                    s.nombre as sector_nombre,
                    s.descripcion as sector_descripcion
                FROM public.ingredientes i
                LEFT JOIN public.sectores_ingredientes s ON i.sector_id = s.id
                WHERE i.id = ANY($1::int[])
            `;
            const ingResult = await pool.query(ingQuery, [idsArray]);

            // Función auxiliar inline para extraer letra (replicada de guardadoIngredientes.js)
            const extraerLetra = (desc, nombre) => {
                if (desc) {
                    const match = desc.match(/["']([^"']+)["']/);
                    if (match && match[1]) return match[1].toUpperCase();
                }
                if (nombre) {
                    const matchNombre = nombre.match(/Sector\s*["']?([A-Z0-9]{1,2})["']?/i);
                    if (matchNombre && matchNombre[1]) return matchNombre[1].toUpperCase();
                }
                return null;
            };

            ingResult.rows.forEach(ing => {
                // Procesamos el sector para dejar solo la letra (o el nombre si falla)
                ing.sector_letra = extraerLetra(ing.sector_descripcion, ing.sector_nombre) || ing.sector_nombre;
                ingredientesMap[ing.id] = ing;
            });
        }

        // 4. Mezclar resultados
        const finalRows = rows.map(row => {
            if (row._tempIngId && ingredientesMap[row._tempIngId]) {
                const ing = ingredientesMap[row._tempIngId];
                return {
                    ...row,
                    ingrediente_id: ing.id,
                    ingrediente_nombre: ing.nombre,
                    ingrediente_codigo: ing.codigo,
                    ingrediente_sector: ing.sector_letra // Enviamos la letra procesada
                };
            }
            return row;
        });

        res.json(finalRows);

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al obtener historial:', error.message);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Motor de Diagnóstico "Vigía Auditor"
 * Busca comprobantes candidatos y genera un diagnóstico detallado comparativo.
 */
async function diagnosticoVigiaAuditor(req, res) {
    const debugLog = [];

    try {
        const { cliente, articulo, cantidad, fecha } = req.query;
        const fechaRef = fecha || new Date().toISOString().split('T')[0];
        const cantidadLocal = parseFloat(cantidad || 0);

        console.log(`👁️ [VIGIA AUDITOR] Analizando candidato: Cliente=${cliente}, Art=${articulo}, Cant=${cantidadLocal}, Fecha=${fechaRef}`);
        debugLog.push(`Inicio Vigía: ${new Date().toISOString()}`);

        if (!cliente || !articulo) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos', debug: { log: debugLog } });
        }

        const baseUrl = 'https://api.lamdaser.com/devoluciones';
        const url = new URL(baseUrl);
        url.searchParams.append('cliente', cliente);
        url.searchParams.append('articulo', articulo);
        // NOTA: Se omiten intencionalmente 'cantidad' y 'fecha'
        // Dejamos que Lomasoft devuelva todo el historial del artículo para este cliente.

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url.toString(), {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Tunnel respondió ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const resultados = Array.isArray(data) ? data : (data.data || []);

        // Mapa de candidatos con diagnóstico individual
        const candidatosBrutos = resultados.map(r => {
            const candidatoCantidad = Math.abs(parseFloat(r.cantidad || r.item_cantidad || 0)); // Absoluto porque la NC puede venir negativa
            const candidatoFecha = r.fecha || r.fecha_emision;

            // 1. Análisis de Diferencia de Monto/Cantidad
            let alertaCantidad = null;
            let diferenciaCantidad = 0;
            if (candidatoCantidad !== cantidadLocal) {
                // Cálculo simple aritmético
                diferenciaCantidad = candidatoCantidad - cantidadLocal;
                alertaCantidad = diferenciaCantidad > 0
                    ? `Sobra en NC: +${Math.abs(diferenciaCantidad).toFixed(3)} u.`
                    : `Falta en NC: -${Math.abs(diferenciaCantidad).toFixed(3)} u.`;
            }

            // 2. Análisis de Lag de Fechas
            let alertaFecha = null;
            let difDias = 0;
            if (candidatoFecha && fechaRef) {
                const f1 = new Date(fechaRef);
                const f2 = new Date(candidatoFecha);
                difDias = Math.round((f2 - f1) / (1000 * 60 * 60 * 24));
                if (difDias !== 0) {
                    alertaFecha = difDias > 0 ? `Emitida ${difDias} días después` : `Emitida ${Math.abs(difDias)} días antes`;
                }
            }

            // 3. Match de Artículo
            const nombreArticuloCandidato = (r.articulo || r.item_descripcion || '').toUpperCase();
            let alertaArticulo = null;
            if (articulo && !nombreArticuloCandidato.includes(articulo.toUpperCase()) && nombreArticuloCandidato) {
                alertaArticulo = `Código de artículo difiere (${nombreArticuloCandidato})`;
            }

            // Determinar color/estado general del diagnóstico
            let nivelRiesgo = 'verde';
            if (Math.abs(diferenciaCantidad) > 0 || Math.abs(difDias) > 0 || alertaArticulo) {
                if (Math.abs(diferenciaCantidad) >= 5 || Math.abs(difDias) > 10) {
                    nivelRiesgo = 'rojo'; // Muy lejos temporalmente o en monto
                } else {
                    nivelRiesgo = 'amarillo'; // Diferencia tolerable
                }
            }

            return {
                comprobante: {
                    tipo_comprobante: r.tipo_comprobante || 'N/C',
                    pto_vta: r.punto_venta || 0,
                    numero_comprobante: r.numero_comprobante || 0,
                    imp_neto: r.importe_neto || r.imp_neto || 0,
                    fecha_emision: candidatoFecha,
                    item_descripcion: r.articulo || r.item_descripcion,
                    item_cantidad: candidatoCantidad // Guardamos siempre en positivo para UI
                },
                diagnostico: {
                    riesgo: nivelRiesgo,
                    alertas: [alertaCantidad, alertaFecha, alertaArticulo].filter(Boolean),
                    _score_diferencia: Math.abs(diferenciaCantidad),
                    _score_dias: Math.abs(difDias)
                }
            };
        });

        // FILTRADO DE SEGURIDAD (Ignorar devoluciones con más de 45 días de antigüedad respecto al retiro)
        const candidatosConDiagnostico = candidatosBrutos
            .filter(c => c.diagnostico._score_dias <= 45)
            // ORDENAR: Los matches más cercanos en cantidad primero, luego en fecha
            .sort((a, b) => {
                if (a.diagnostico._score_diferencia !== b.diagnostico._score_diferencia) {
                    return a.diagnostico._score_diferencia - b.diagnostico._score_diferencia;
                }
                return a.diagnostico._score_dias - b.diagnostico._score_dias;
            });

        debugLog.push(`Candidatos post-filtro (<45 días): ${candidatosConDiagnostico.length}`);

        // Diagnóstico global
        let diagnosticoGlobal = 'Comprobante Físico Encontrado';
        if (candidatosConDiagnostico.length === 0) {
            diagnosticoGlobal = 'No se encontraron coincidencias válidas';
        } else if (candidatosConDiagnostico.some(c => c.diagnostico.riesgo === 'rojo')) {
            diagnosticoGlobal = 'Coincidencias con alto riesgo de discrepancia';
        } else if (candidatosConDiagnostico.some(c => c.diagnostico.riesgo === 'amarillo')) {
            diagnosticoGlobal = 'Coincidencias con posibles discrepancias menores';
        }

        res.json({
            success: true,
            candidatos: candidatosConDiagnostico,
            diagnostico_global: diagnosticoGlobal,
            debug: {
                log: debugLog,
                source: baseUrl
            }
        });

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error conciliarDevolucion:', error.message);
        debugLog.push(`❌ EXCEPCIÓN: ${error.message}`);

        res.status(200).json({
            success: false,
            error: 'Error conectando con Facturación (Tunnel)',
            message: error.message,
            debug: { log: debugLog }
        });
    }
}

/**
 * Confirmar y Guardar Conciliación
 * ACCIÓN ATÓMICA:
 * 1. Insertar Cabecera en mantenimiento_conciliaciones
 * 2. Insertar Detalle en mantenimiento_conciliacion_items
 * 3. Actualizar movimiento de origen a estado 'CONCILIADO'
 */
async function confirmarConciliacion(req, res) {
    const client = await pool.connect();

    try {
        const {
            articulo,
            cliente_id,
            cantidad,
            comprobante
        } = req.body;

        console.log(`💾 [MANTENIMIENTO] Iniciando Transacción de Conciliación (V2 - Strong Link) para Art: ${articulo}`);

        await client.query('BEGIN');

        // 1. Identificar Movimiento Pendiente (Lock Row)
        // Lo buscamos ANTES de insertar para obtener su ID y asegurar consistencia
        const findMovSql = `
            SELECT mm.id 
            FROM public.mantenimiento_movimientos mm
            JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
            WHERE mm.articulo_numero = $1
              AND p.id_cliente = $2
              AND mm.tipo_movimiento = 'INGRESO'
              AND mm.estado != 'CONCILIADO'
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
            FOR UPDATE
        `;
        const resMov = await client.query(findMovSql, [articulo, cliente_id]);

        if (resMov.rowCount === 0) {
            throw new Error('No se encontró movimiento pendiente para conciliar (o ya fue conciliado por otro usuario).');
        }

        const idMovimiento = resMov.rows[0].id;

        // 2. Insertar Cabecera de Conciliación
        const insertCabecera = `
            INSERT INTO public.mantenimiento_conciliaciones
            (id_cliente, nro_comprobante_externo, tipo_comprobante, fecha_comprobante, importe_neto, importe_iva, importe_total, usuario_consolidacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;

        const usuario = req.user ? req.user.username : 'SISTEMA';
        const neto = parseFloat(comprobante.imp_neto || 0);
        const iva = neto * 0.21;
        const total = neto + iva;

        const resCabecera = await client.query(insertCabecera, [
            cliente_id,
            `${comprobante.pto_vta}-${comprobante.numero_comprobante}`,
            comprobante.tipo_comprobante,
            comprobante.fecha_emision,
            neto,
            iva,
            total,
            usuario
        ]);

        const idConciliacion = resCabecera.rows[0].id;

        // 3. Insertar Item de Conciliación con Vínculo Fuerte (FK)
        const insertItem = `
            INSERT INTO public.mantenimiento_conciliacion_items
            (id_conciliacion, articulo_numero, cantidad_conciliada, id_movimiento_origen)
            VALUES ($1, $2, $3, $4)
        `;
        await client.query(insertItem, [idConciliacion, articulo, cantidad, idMovimiento]);

        // 4. Actualizar Estado del Movimiento
        const updateMov = `
            UPDATE public.mantenimiento_movimientos
            SET estado = 'CONCILIADO', 
                observaciones = observaciones || ' [Conciliado con NC ' || $1 || ']'
            WHERE id = $2
        `;

        await client.query(updateMov, [
            `${comprobante.pto_vta}-${comprobante.numero_comprobante}`,
            idMovimiento
        ]);

        await client.query('COMMIT');
        console.log(`✅ [MANTENIMIENTO] Conciliación Exitosa. Link V2: Conciliacion #${idConciliacion} <-> Movimiento #${idMovimiento}`);

        res.json({ success: true, id_conciliacion: idConciliacion });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO] Error en transacción:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

/**
 * Liberar Stock de Mantenimiento a Ventas
 * Ejecuta la función SQL de infraestructura que mueve el stock y audita.
 */
async function liberarStock(req, res) {
    try {
        const { articulo, cantidad, observaciones } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        console.log(`📦 [MANTENIMIENTO] Liberando stock para Art: ${articulo}, Cant: ${cantidad}`);

        const query = `SELECT public.liberar_stock_mantenimiento($1, $2, $3, $4) as resultado`;
        const values = [articulo, cantidad || 1, usuario, observaciones || 'Reintegro a Ventas tras Conciliación'];

        const result = await pool.query(query, values);
        const data = result.rows[0].resultado;

        if (data.success) {
            console.log(`✅ Stock liberado exitosamente: ${articulo}`);
            res.json(data);
        } else {
            console.warn(`⚠️ Falló liberación de stock: ${data.error}`);
            res.status(400).json(data);
        }

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al liberar stock:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Transferir Stock de Mantenimiento a Ingredientes
 * 1. Da de baja en mantenimiento (stock_real_consolidado) por el TOTAL del peso original.
 * 2. Da de alta en ingredientes por la CANTIDAD REAL ingresada.
 * 3. Registra la merma/diferencia en el movimiento de salida.
 */
async function transferirAIngredientes(req, res) {
    const client = await pool.connect();

    try {
        const { articulo, ingrediente_id, cantidad_real, observaciones } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        if (!articulo || !ingrediente_id || !cantidad_real) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios.' });
        }

        console.log(`🧪 [MANTENIMIENTO -> INGREDIENTES] Iniciando transferencia. Art: ${articulo} -> Ing: ${ingrediente_id}`);

        await client.query('BEGIN');

        // 1. Obtener Stock Actual en Mantenimiento (Peso Original)
        // Bloqueamos la fila para evitar concurrencia
        const stockQuery = `
            SELECT stock_mantenimiento 
            FROM public.stock_real_consolidado 
            WHERE articulo_numero = $1
            FOR UPDATE
        `;
        const resStock = await client.query(stockQuery, [articulo]);

        if (resStock.rows.length === 0) {
            throw new Error(`Artículo ${articulo} no encontrado en stock consolidado.`);
        }

        const pesoOriginal = parseFloat(resStock.rows[0].stock_mantenimiento || 0);
        const pesoIngreso = parseFloat(cantidad_real);

        if (pesoOriginal <= 0) {
            throw new Error(`El artículo ${articulo} no tiene stock en mantenimiento.`);
        }

        // Calculamos la MERMA (Diferencia de peso)
        // Merma = Peso teòrico (sistema) - Peso real (balanza)
        const merma = pesoOriginal - pesoIngreso;

        console.log(`📊 Cálculo: Original=${pesoOriginal}, Real=${pesoIngreso}, Merma=${merma}`);

        // 2. DAR DE BAJA EN MANTENIMIENTO (Todo el stock)
        // Usamos la lógica de actualización directa para no depender de la función PL/SQL si queremos atomicidad controlada aquí
        // O podríamos llamar a la función, pero aquí es una operación compuesta compleja. Haremos update manual.

        const updateMantenimiento = `
            UPDATE public.stock_real_consolidado
            SET 
                stock_mantenimiento = 0, -- Se vacía
                -- Ajustamos el consolidado restando lo que estaba en mantenimiento
                stock_consolidado = stock_consolidado - $1, 
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $2
        `;
        await client.query(updateMantenimiento, [pesoOriginal, articulo]);

        // 3. REGISTRAR MOVIMIENTO DE SALIDA (AUDITORÍA)
        // Registramos que salieron X kilos, y en observaciones detallamos la merma
        const obsFinal = `${observaciones || ''} | Transferencia a Ingredientes (ID: ${ingrediente_id}). Peso Orig: ${pesoOriginal}, Real: ${pesoIngreso}, Merma: ${merma.toFixed(3)}`;

        const insertMov = `
            INSERT INTO public.mantenimiento_movimientos (
                articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento
            ) VALUES (
                $1, $2, $3, 'TRANSF_INGREDIENTE', $4, NOW()
            )
        `;
        await client.query(insertMov, [articulo, pesoOriginal, usuario, obsFinal]);

        // 4. DAR DE ALTA EN INGREDIENTES
        // Incrementamos stock_actual
        const updateIngrediente = `
            UPDATE ingredientes
            SET stock_actual = stock_actual + $1
            WHERE id = $2
            RETURNING nombre
        `;
        const resIng = await client.query(updateIngrediente, [pesoIngreso, ingrediente_id]);

        if (resIng.rowCount === 0) {
            throw new Error(`Ingrediente destino ${ingrediente_id} no encontrado.`);
        }

        // Opcional: Registrar en historial de ingredientes si existe tabla. 
        // Por ahora asumimos que el update es suficiente, o el usuario lo pedirá si falta.
        // Pero intentaremos registrar en 'ingredientes_stock_usuarios' como 'Produccion' si se usa ese modelo
        // Para no romper nada, nos limitamos al update simple que es lo solicitado.

        await client.query('COMMIT');

        console.log('✅ Transferencia completada exitosamente.');
        res.json({
            success: true,
            mensaje: 'Transferencia realizada',
            merma: merma.toFixed(3),
            ingrediente: resIng.rows[0].nombre
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en transferencia:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

/**
 * Revertir Movimiento (Undo)
 * Principalmente para "Enviar a Ventas" (LIBERACION) realizado por error.
 */
async function revertirMovimiento(req, res) {
    const client = await pool.connect();
    try {
        const { id_movimiento } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        if (!id_movimiento) {
            return res.status(400).json({ success: false, error: 'ID de movimiento requerido' });
        }

        await client.query('BEGIN');

        // 1. Obtener el movimiento original
        const movQuery = `
            SELECT * FROM public.mantenimiento_movimientos 
            WHERE id = $1 FOR UPDATE
        `;
        const resMov = await client.query(movQuery, [id_movimiento]);

        if (resMov.rows.length === 0) throw new Error('Movimiento no encontrado');
        const mov = resMov.rows[0];

        if (mov.estado === 'REVERTIDO') throw new Error('Este movimiento ya fue revertido anteriormente.');

        // Solo permitimos revertir LIBERACION por ahora (lo solicitado)
        if (mov.tipo_movimiento !== 'LIBERACION') {
            throw new Error('Solo se pueden revertir envíos a Ventas (LIBERACION) por el momento.');
        }

        const cantidad = parseFloat(mov.cantidad);
        const articulo = mov.articulo_numero;

        console.log(`↩️ [MANTENIMIENTO] Revirtiendo cambio ${mov.tipo_movimiento} ID: ${id_movimiento} Art: ${articulo}`);

        // 2. Revertir cambios en Stock
        // Si fue LIBERACION: Restó de mantenimiento y sumó a ajustes/consolidado.
        // Hacemos lo opuesto: Sumar a mantenimiento, Restar de ajustes.

        const updateStock = `
            UPDATE public.stock_real_consolidado
            SET 
                stock_mantenimiento = stock_mantenimiento + $1,
                stock_ajustes = stock_ajustes - $1,
                stock_consolidado = stock_consolidado - $1,
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $2
        `;
        await client.query(updateStock, [cantidad, articulo]);

        // 3. Marcar movimiento como REVERTIDO
        await client.query(`UPDATE public.mantenimiento_movimientos SET estado = 'REVERTIDO', observaciones = observaciones || ' [REVERTIDO]' WHERE id = $1`, [id_movimiento]);

        // 4. Registrar movimiento de Contra-asiento (Opcional, pero bueno para auditoría clara)
        // Lo registramos como un INGRESO por corrección
        const insertReversion = `
            INSERT INTO public.mantenimiento_movimientos (
                articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento, estado
            ) VALUES (
                $1, $2, $3, 'REVERSION', $4, NOW(), 'AUTOMATICO'
            )
        `;
        await client.query(insertReversion, [articulo, cantidad, usuario, `Reversión de mov #${id_movimiento}`]);

        await client.query('COMMIT');

        res.json({ success: true, message: 'Operación revertida exitosamente.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error revirtiendo movimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

module.exports = {
    getStockMantenimiento,
    getHistorialMantenimiento,
    diagnosticoVigiaAuditor,
    confirmarConciliacion,
    liberarStock,
    transferirAIngredientes,
    revertirMovimiento
};
