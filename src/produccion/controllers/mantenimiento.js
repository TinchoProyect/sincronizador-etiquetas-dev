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
                origin.cliente_nombre,
                nc.nro_comprobante_externo as nc_nro,
                nc.tipo_comprobante as nc_tipo,
                nc.fecha_comprobante as nc_fecha
            FROM public.stock_real_consolidado s
            LEFT JOIN LATERAL (
                SELECT 
                    mm.id as id_movimiento,
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
            LEFT JOIN LATERAL (
                SELECT 
                    mc.nro_comprobante_externo,
                    mc.tipo_comprobante,
                    mc.fecha_comprobante
                FROM public.mantenimiento_conciliacion_items mci
                JOIN public.mantenimiento_conciliaciones mc ON mci.id_conciliacion = mc.id
                WHERE mci.id_movimiento_origen = origin.id_movimiento
                LIMIT 1
            ) nc ON origin.estado = 'CONCILIADO'
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
        let resultados = Array.isArray(data) ? data : (data.data || []);

        debugLog.push(`Resultados crudos de Lomasoft: ${resultados.length}`);

        // O.T. 1 - FILTRO DE NCs "LIBRES"
        // Buscar Notas de Crédito que ya hemos conciliado para ignorarlas en los resultados
        // REGLA: Una nota de crédito puede tener varios artículos devueltos. 
        // Solo ignoramos la clave compuesta (Comprobante + Articulo)
        let itemsYaConciliados = new Set();
        try {
            const queryConciliadas = `
                SELECT mc.nro_comprobante_externo, mci.articulo_numero 
                FROM public.mantenimiento_conciliaciones mc
                JOIN public.mantenimiento_conciliacion_items mci ON mc.id = mci.id_conciliacion
                WHERE mc.id_cliente = $1
            `;
            const resultConciliadas = await pool.query(queryConciliadas, [cliente]);
            resultConciliadas.rows.forEach(row => {
                // Creamos una firma única combinando Nro Comprobante y Código Original Articulo
                // Ojo: En afip/lomasoft r.articulo es la descripcion, pero r.item_descripcion es tambien la descripción.
                // Necesitamos chequear el item de Lomasoft frente a nuestro artículo.
                itemsYaConciliados.add(`${row.nro_comprobante_externo}|${row.articulo_numero.toUpperCase()}`);
            });
            debugLog.push(`Encontrados ${itemsYaConciliados.size} items-comprobante ya conciliados para este cliente.`);
        } catch (e) {
            console.error('⚠️ [VIGIA AUDITOR] No se pudo consultar historial de conciliaciones', e);
            debugLog.push(`⚠️ Error leyendo NCs locales: ${e.message}`);
        }

        // Remover comprobantes ocupados de los resultados
        resultados = resultados.filter(r => {
            const numeroCompleto = `${r.punto_venta || 0}-${r.numero_comprobante || 0}`;

            // Verificamos si la firma (Comprobante|ArticuloLocalQueBuscamos) ya está en set
            // NOTA: Como lomasoft devuelve TODO el historial, y nosotros filtramos sobre la marcha contra
            // el articulo de este endpoint, comparamos directamente contra el parametro `articulo`
            const firmaSearch = `${numeroCompleto}|${articulo.toUpperCase()}`;

            return !itemsYaConciliados.has(firmaSearch);
        });

        debugLog.push(`Resultados tras remover NCs "Ocupadas": ${resultados.length}`);

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
              AND (mm.estado IS NULL OR mm.estado != 'CONCILIADO')
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
    const client = await pool.connect();
    try {
        const { articulo, cantidad, observaciones } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        console.log(`📦 [MANTENIMIENTO] Liberando stock para Art: ${articulo}, Cant: ${cantidad}`);

        await client.query('BEGIN');

        const query = `SELECT public.liberar_stock_mantenimiento($1, $2, $3, $4) as resultado`;
        const values = [articulo, cantidad, usuario, observaciones || 'Reintegro a Ventas tras Conciliacion'];

        const result = await client.query(query, values);
        const data = result.rows[0].resultado;

        if (!data.success) {
            throw new Error(data.error);
        }

        // Actualizar el estado del movimiento de ingreso original para que no vuelva a aparecer como CONCILIADO trabado
        const updateMov = `
            UPDATE public.mantenimiento_movimientos
            SET estado = 'FINALIZADO',
                observaciones = observaciones || ' [Transferido Mantenimiento -> Ventas]'
            WHERE articulo_numero = $1 AND tipo_movimiento = 'INGRESO' AND estado = 'CONCILIADO'
        `;
        await client.query(updateMov, [articulo]);

        await client.query('COMMIT');
        console.log(`✅ Stock liberado exitosamente y estado actualizado: ${articulo}`);
        res.json(data);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO] Error al liberar stock:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
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

/**
 * Deshacer / Anular Conciliación
 * 1. Recupera el movimiento origen ('INGRESO') desde el artículo.
 * 2. Borra el item de conciliación de mantenimiento_conciliacion_items.
 * 3. Limpia la cabecera en mantenimiento_conciliaciones si queda huérfana.
 * 4. Pone el estado del movimiento en null o original y limpia observaciones.
 */
async function deshacerConciliacion(req, res) {
    const client = await pool.connect();
    try {
        const { articulo } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        if (!articulo) {
            return res.status(400).json({ success: false, error: 'Se requiere el artículo para deshacer la conciliación.' });
        }

        console.log(`🔗 [MANTENIMIENTO] Deshaciendo conciliacion de Art: ${articulo}`);

        await client.query('BEGIN');

        // Buscar el movimiento de ingreso más reciente CONCILIADO
        const findMovSql = `
            SELECT mm.id, mm.observaciones 
            FROM public.mantenimiento_movimientos mm
            WHERE mm.articulo_numero = $1
              AND mm.tipo_movimiento = 'INGRESO'
              AND mm.estado = 'CONCILIADO'
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
            FOR UPDATE
        `;
        const resMov = await client.query(findMovSql, [articulo]);

        if (resMov.rowCount === 0) {
            throw new Error('No se encontró movimiento conciliado para revertir.');
        }

        const idMovimiento = resMov.rows[0].id;
        const obsActual = resMov.rows[0].observaciones || '';

        // Buscar items de conciliación vinculados a este movimiento
        const findItemSql = `
            SELECT id_conciliacion 
            FROM public.mantenimiento_conciliacion_items
            WHERE id_movimiento_origen = $1
        `;
        const resItem = await client.query(findItemSql, [idMovimiento]);

        let idConciliacion = null;
        if (resItem.rowCount > 0) {
            idConciliacion = resItem.rows[0].id_conciliacion;

            // Borrar item vinculante
            await client.query(`DELETE FROM public.mantenimiento_conciliacion_items WHERE id_movimiento_origen = $1`, [idMovimiento]);

            // Si la conciliación quedó huérfana (sin otros items), borrar cabecera
            const checkHuerfana = await client.query(`SELECT count(1) as cant FROM public.mantenimiento_conciliacion_items WHERE id_conciliacion = $1`, [idConciliacion]);
            if (parseInt(checkHuerfana.rows[0].cant) === 0) {
                await client.query(`DELETE FROM public.mantenimiento_conciliaciones WHERE id = $1`, [idConciliacion]);
            }
        }

        // Limpiar etiqueta de nota en observaciones ` [Conciliado con NC ...]`
        const obsLimpia = obsActual.replace(/ \[Conciliado con NC [^\]]+\]/g, '').trim();

        // Actualizar el estado del movimiento a vacío (null) que equivale a estado original (pendiente de conciliar en stock)
        const updateMov = `
            UPDATE public.mantenimiento_movimientos
            SET estado = NULL, 
                observaciones = $1
            WHERE id = $2
        `;
        await client.query(updateMov, [obsLimpia, idMovimiento]);

        // Registrar acción en bitácora (opcional, dejamos rastro suave usando log en REVERSION)
        const insertReversion = `
            INSERT INTO public.mantenimiento_movimientos (
                articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento, estado
            ) VALUES (
                $1, 0, $2, 'REVERSION', $3, NOW(), 'AUTOMATICO'
            )
        `;
        await client.query(insertReversion, [articulo, usuario, `Desvinculación manual de NC`]);

        await client.query('COMMIT');
        console.log(`✅ [MANTENIMIENTO] Conciliación revertida. Link roto para el movimiento #${idMovimiento}`);
        res.json({ success: true, message: 'Vínculo de factura deshecho exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO] Error al revertir conciliacion:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

/**
 * Trazar Factura Original y Determinar Tipo de Nota de Crédito
 * Requisito: Automatización de UI
 */
async function trazarFacturaOriginal(req, res) {
    try {
        const { articulo, cliente_id } = req.query;

        if (!articulo || !cliente_id) {
            return res.status(400).json({ error: 'Artículo y Cliente requeridos' });
        }

        console.log(`🔍 [MANTENIMIENTO] Trazando Factura Original para Art: ${articulo}, Cliente: ${cliente_id}`);

        const query = `
            SELECT 
                f.id as factura_id,
                f.tipo_cbte,
                f.pto_vta,
                f.cbte_nro,
                f.imp_total,
                f.fecha_emision,
                f.estado,
                pd.precio_unitario,
                pd.iva_alicuota
            FROM public.factura_facturas f
            LEFT JOIN public.mantenimiento_movimientos mm 
              ON f.presupuesto_id = mm.id_presupuesto_origen 
                 AND mm.articulo_numero = $1 
                 AND mm.tipo_movimiento = 'INGRESO'
            -- JOIN to extract historical pricing for the AFIP NC payload
            LEFT JOIN public.presupuestos_detalles pd
              ON f.presupuesto_id = pd.id_presupuesto_ext
                 AND pd.articulo = $1
            WHERE f.cliente_id::text = $2::text
              AND f.estado = 'APROBADA'
            ORDER BY 
              -- Prioritize the exact match if trace is successful
              (CASE WHEN mm.id_presupuesto_origen IS NOT NULL THEN 1 ELSE 0 END) DESC,
              f.fecha_emision DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [articulo, cliente_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No se encontró una Factura original APROBADA trazable para este ingreso.' });
        }

        const factura = result.rows[0];

        // Derivar tipo de Nota de Crédito de forma estricta
        // Factura A (1) -> NC A (3)
        // Factura B (6) -> NC B (8)
        // Factura C (11) -> NC C (13)
        let nc_tipo_cbte = null;
        let nc_tipo_nombre = '';

        switch (parseInt(factura.tipo_cbte)) {
            case 1:
                nc_tipo_cbte = 3;
                nc_tipo_nombre = 'Nota de Crédito A (03)';
                break;
            case 6:
                nc_tipo_cbte = 8;
                nc_tipo_nombre = 'Nota de Crédito B (08)';
                break;
            case 11:
                nc_tipo_cbte = 13;
                nc_tipo_nombre = 'Nota de Crédito C (13)';
                break;
            default:
                return res.status(400).json({ success: false, message: `Tipo de comprobante original (${factura.tipo_cbte}) no soportado para Notas de Crédito automatizadas.` });
        }

        const tipoLetra = parseInt(factura.tipo_cbte) === 1 ? 'A' : (parseInt(factura.tipo_cbte) === 6 ? 'B' : 'C');

        // Map the historical IVA string to the internal AFIP dictionary ID
        // Note: these mappings should match the application's actual IVA constants list (e.g. 5 = 21%, 4 = 10.5%)
        let afipIvaId = 5; // Default 21%
        if (factura.iva_alicuota) {
            const alicuota = factura.iva_alicuota.toString();
            if (alicuota.includes('10.5')) afipIvaId = 4;
            else if (alicuota.includes('27')) afipIvaId = 6;
            else if (alicuota === '0' || alicuota === '0.00' || alicuota.toLowerCase() === 'exento') afipIvaId = 3;
        }

        res.json({
            success: true,
            factura: {
                ...factura,
                factura_nombre: `Factura ${tipoLetra} - Nro ${factura.pto_vta}-${factura.cbte_nro}`
            },
            nota_credito: {
                tipo_cbte: nc_tipo_cbte,
                nombre: nc_tipo_nombre,
                precio_historico: factura.precio_unitario,
                alic_iva_id: afipIvaId
            }
        });

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al trazar factura original:', error.message);
        res.status(500).json({ success: false, error: 'Error interno al trazar la factura origen.' });
    }
}

// =========================================================================
// NUEVOS ENDPOINTS: LÓGICA INVERSA Y DEVOLUCIONES
// =========================================================================

/**
 * Escenario A: Obtener retiros que el cliente traerá por mostrador.
 * Filtro: Orden de Retiro, sin ruta asignada, PENDIENTE_ASIGNAR.
 */
async function getRetirosLocal(req, res) {
    try {
        const query = `
            SELECT 
                p.id, p.id_presupuesto_ext, p.fecha, p.nota as observaciones,
                c.cliente_id, c.nombre as cliente_nombre, c.apellido as cliente_apellido
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON p.id_cliente::text = c.cliente_id::text
            WHERE p.tipo_comprobante = 'Orden de Retiro' 
              AND p.id_ruta IS NULL 
              AND p.estado_logistico = 'ESPERANDO_MOSTRADOR'
              AND p.activo = true
            ORDER BY p.fecha DESC
        `;
        const result = await pool.query(query);

        for (let row of result.rows) {
            const detQuery = `
                SELECT pd.articulo, pd.cantidad, COALESCE(a.nombre, pd.articulo) as descripcion, a.numero as articulo_numero
                FROM public.presupuestos_detalles pd
                LEFT JOIN public.articulos a ON pd.articulo = a.codigo_barras
                WHERE pd.id_presupuesto_ext = $1
            `;
            const detResult = await pool.query(detQuery, [row.id_presupuesto_ext]);
            row.items = detResult.rows;
        }

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error getRetirosLocal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Escenario B: Obtener retiros asignados a un chofer que están en la calle.
 * Filtro: Orden de Retiro, con ruta asignada (ARMANDO o EN_CAMINO). Solo lectura.
 */
async function getRetirosRuta(req, res) {
    try {
        const query = `
            SELECT 
                p.id, p.id_presupuesto_ext, p.fecha, p.estado_logistico,
                c.cliente_id, c.nombre as cliente_nombre, c.apellido as cliente_apellido,
                r.id as ruta_id, r.nombre_ruta, r.estado as ruta_estado,
                u.nombre_completo as chofer_nombre
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON p.id_cliente::text = c.cliente_id::text
            INNER JOIN public.rutas r ON p.id_ruta = r.id
            LEFT JOIN public.usuarios u ON r.id_chofer = u.id
            WHERE p.tipo_comprobante = 'Orden de Retiro' 
              AND p.id_ruta IS NOT NULL 
              AND r.estado IN ('ARMANDO', 'EN_CAMINO')
              AND p.activo = true
            ORDER BY r.fecha_salida DESC, p.fecha DESC
        `;
        const result = await pool.query(query);

        for (let row of result.rows) {
            const detQuery = `
                SELECT pd.articulo, pd.cantidad, COALESCE(a.nombre, pd.articulo) as descripcion, a.numero as articulo_numero
                FROM public.presupuestos_detalles pd
                LEFT JOIN public.articulos a ON pd.articulo = a.codigo_barras
                WHERE pd.id_presupuesto_ext = $1
            `;
            const detResult = await pool.query(detQuery, [row.id_presupuesto_ext]);
            row.items = detResult.rows;
        }

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ Error getRetirosRuta:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Escenario A (Acción): Recepción de mercadería por mostrador.
 * Transfiere el stock de la Orden de Retiro al stock de Mantenimiento.
 */
async function recibirRetiroLocal(req, res) {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const usuario = req.user ? req.user.username : 'MOSTRADOR';

        await client.query('BEGIN');

        const orderQuery = `
            SELECT id, id_presupuesto_ext, estado_logistico 
            FROM public.presupuestos 
            WHERE id = $1 AND tipo_comprobante = 'Orden de Retiro'
            FOR UPDATE
        `;
        const orderResult = await client.query(orderQuery, [id]);

        if (orderResult.rows.length === 0) {
            throw new Error('Orden de Retiro no encontrada.');
        }

        const orden = orderResult.rows[0];
        if (orden.estado_logistico !== 'PENDIENTE_ASIGNAR') {
            throw new Error(`La orden no puede recibirse localmente porque su estado es: ${orden.estado_logistico}`);
        }

        const itemsQuery = `
            SELECT pd.articulo as codigo_barras, pd.cantidad, a.numero as articulo_numero, a.nombre
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.articulos a ON pd.articulo = a.codigo_barras
            WHERE pd.id_presupuesto_ext = $1
        `;
        const itemsResult = await client.query(itemsQuery, [orden.id_presupuesto_ext]);

        for (let item of itemsResult.rows) {
            const artAudit = item.articulo_numero || item.codigo_barras || 'UNKNOWN';

            await client.query(`
                INSERT INTO mantenimiento_movimientos
                (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
            `, [
                artAudit,
                item.cantidad,
                orden.id,
                usuario,
                `Ingreso Local Mostrador - Pendiente de Conciliación`
            ]);

            if (item.articulo_numero) {
                const stockCheck = await client.query('SELECT 1 FROM stock_real_consolidado WHERE articulo_numero = $1', [item.articulo_numero]);
                if (stockCheck.rowCount > 0) {
                    await client.query(`
                        UPDATE stock_real_consolidado
                        SET stock_mantenimiento = COALESCE(stock_mantenimiento, 0) + $1, ultima_actualizacion = NOW()
                        WHERE articulo_numero = $2
                    `, [item.cantidad, item.articulo_numero]);
                } else {
                    await client.query(`
                        INSERT INTO stock_real_consolidado 
                        (articulo_numero, descripcion, codigo_barras, stock_consolidado, stock_mantenimiento, ultima_actualizacion, no_producido_por_lambda, solo_produccion_externa)
                        VALUES ($1, $2, $3, 0, $4, NOW(), false, false)
                    `, [item.articulo_numero, item.nombre, item.codigo_barras, item.cantidad]);
                }
            }
        }

        // CERRAR LA VENTA SATISFACTORIAMENTE PARA UNA DEVOLUCION DE MOSTRADOR
        // ESTADO_LOGISTICO: 'RECIBIDO_MANTENIMIENTO' (Carga a cuarentena en planta)
        // ESTADO GENERAL: 'ANULADO' (Retorno mitigado)
        await client.query(`
            UPDATE public.presupuestos
            SET estado_logistico = 'RECIBIDO_MANTENIMIENTO', estado = 'ANULADO', fecha_entrega_real = NOW(), fecha_actualizacion = NOW()
            WHERE id = $1
        `, [orden.id]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Mercadería ingresada exitosamente al Stock de Mantenimiento.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en recibirRetiroLocal:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

module.exports = {
    getStockMantenimiento,
    diagnosticoVigiaAuditor,
    confirmarConciliacion,
    getHistorialMantenimiento,
    liberarStock,
    transferirAIngredientes,
    revertirMovimiento,
    deshacerConciliacion,
    trazarFacturaOriginal,
    getRetirosLocal,
    getRetirosRuta,
    recibirRetiroLocal
};
