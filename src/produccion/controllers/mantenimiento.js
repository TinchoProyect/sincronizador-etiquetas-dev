const pool = require('../config/database');

/**
 * Servicio modular de Higiene Visual para registros en Mantenimiento.
 * @param {object} client - Cliente PostgreSQL transaccional
 * @param {number|string} movimientoId - ID del registro original
 * @param {string} reason - Motivo del cierre (ej: "Mantenimiento -> Ventas")
 */
const cleanUpMaintenanceRecord = async (client, movimientoId, reason) => {
    const updateMov = `
        UPDATE public.mantenimiento_movimientos
        SET estado = 'FINALIZADO',
            observaciones = COALESCE(observaciones, '') || $2
        WHERE id = $1
    `;
    await client.query(updateMov, [movimientoId, ` [Limpieza: ${reason}]`]);
};

/**
 * Obtener stock actual en mantenimiento (Cuarentena)
 * Fuente: public.stock_real_consolidado
 */
async function getStockMantenimiento(req, res) {
    try {
        console.log('🔍 [MANTENIMIENTO] Consultando stock en cuartena...');

        const query = `
            WITH saldos_clientes AS (
                SELECT 
                    mm.id as id_movimiento,
                    mm.id_presupuesto_origen,
                    p.origen_facturacion,
                    mm.articulo_numero,
                    mm.ingrediente_id,
                    mm.id_orden_tratamiento,
                    COALESCE(p.id_cliente::text, ot.id_cliente::text) AS cliente_id,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Desconocido') as cliente_nombre,
                    p.id_ruta AS origen_ruta_id,
                    p.comprobante_lomasoft AS presup_comprobante_lomasoft,
                    p.fecha AS presup_fecha,
                    p.estado AS estado_presupuesto,
                    mm.cantidad AS stock_mantenimiento,
                    mm.fecha_movimiento as ultima_actualizacion,
                    mm.usuario AS usuario,
                    mm.tipo_movimiento,
                    mm.observaciones,
                    mm.historial_tratamientos::text AS historial_tratamientos,
                    mm.estado as transaccion_estado,
                    ot.codigo_qr_hash as hash
                FROM public.mantenimiento_movimientos mm
                LEFT JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                LEFT JOIN public.ordenes_tratamiento ot ON mm.id_orden_tratamiento = ot.id
                LEFT JOIN public.clientes c ON COALESCE(p.id_cliente::text, ot.id_cliente::text) = c.cliente_id::text
                WHERE mm.estado IN ('PENDIENTE', 'CONCILIADO', 'BORRADOR', 'EN_TRATAMIENTO')
                  AND mm.tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'RETORNO_TRATAMIENTO', 'RETIRO_TRATAMIENTO')
                  AND mm.cantidad > 0
            )
            SELECT 
                sc.id_movimiento AS id,
                sc.id_presupuesto_origen,
                sc.origen_facturacion,
                sc.articulo_numero,
                sc.ingrediente_id,
                sc.id_orden_tratamiento,
                sc.hash,
                COALESCE(a.nombre, i.nombre, sc.articulo_numero, sc.ingrediente_id::text) AS descripcion,
                sc.stock_mantenimiento,
                s.stock_lomasoft,
                s.stock_movimientos,
                s.stock_ajustes,
                sc.ultima_actualizacion,
                sc.tipo_movimiento,
                NULLIF(TRIM(sc.usuario), '') AS usuario_id,
                COALESCE(u_resp.nombre_completo, NULLIF(TRIM(sc.usuario), ''), 'SISTEMA') AS usuario,
                sc.historial_tratamientos,
                sc.origen_ruta_id,
                COALESCE(s.kilos_unidad, 1) as kilos_unidad, 
                sc.cliente_id,
                CASE 
                    WHEN sc.estado_presupuesto = 'Conciliado' THEN 'CONCILIADO'
                    WHEN nc.nro_comprobante_externo IS NOT NULL THEN 'CONCILIADO'
                    ELSE sc.transaccion_estado
                END as estado,
                sc.cliente_nombre,
                COALESCE(nc.nro_comprobante_externo, sc.presup_comprobante_lomasoft) as nc_nro,
                COALESCE(nc.tipo_comprobante, 'NC ERP') as nc_tipo,
                COALESCE(nc.fecha_comprobante, sc.presup_fecha) as nc_fecha,
                CASE 
                    WHEN nc_estado.fact_cae IS NOT NULL AND nc_estado.fact_cae != '' THEN 'COMPLETADO'
                    WHEN nc_estado.fact_estado IS NOT NULL THEN 'BORRADOR'
                    ELSE 'DISPONIBLE'
                END AS estado_nc,
                tto.tratamiento_estado,
                tto.tratamiento_id,
                tto.tipo_tratamiento,
                sc.observaciones
            FROM saldos_clientes sc
            LEFT JOIN public.articulos a ON sc.articulo_numero = a.numero
            LEFT JOIN public.ingredientes i ON sc.ingrediente_id = i.id
            LEFT JOIN public.stock_real_consolidado s ON sc.articulo_numero = s.articulo_numero
            LEFT JOIN public.usuarios u_resp ON u_resp.id::text = sc.usuario::text
            LEFT JOIN LATERAL (
                SELECT 
                    mc.nro_comprobante_externo,
                    mc.tipo_comprobante,
                    mc.fecha_comprobante
                FROM public.mantenimiento_conciliaciones mc
                JOIN public.mantenimiento_conciliacion_items mci ON mc.id = mci.id_conciliacion
                WHERE mci.id_movimiento_origen = sc.id_movimiento
                ORDER BY mc.fecha_comprobante DESC
                LIMIT 1
            ) nc ON true
            LEFT JOIN LATERAL (
                SELECT 
                    ff.estado AS fact_estado,
                    ff.cae AS fact_cae
                FROM public.mantenimiento_movimientos mm_nc
                LEFT JOIN public.factura_facturas ff ON ff.id = (SUBSTRING(mm_nc.observaciones FROM '\\[NC Generada ID: (\\d+)\\]'))::int
                WHERE mm_nc.id_presupuesto_origen = sc.id_presupuesto_origen
                  AND mm_nc.articulo_numero = sc.articulo_numero
                  AND mm_nc.tipo_movimiento = 'EMISION_NC'
                ORDER BY mm_nc.fecha_movimiento DESC
                LIMIT 1
            ) nc_estado ON true
            LEFT JOIN LATERAL (
                SELECT tt.estado as tratamiento_estado, tt.id as tratamiento_id, tt.tipo_tratamiento
                FROM public.mantenimiento_tratamientos_items tti
                JOIN public.mantenimiento_tratamientos tt ON tti.id_tratamiento = tt.id
                WHERE (tti.id_movimiento_origen = sc.id_movimiento 
                       OR (tti.id_movimiento_origen IS NULL AND (tti.articulo_numero = sc.articulo_numero OR (sc.articulo_numero IS NULL AND tti.articulo_numero IS NULL AND tti.ingrediente_id = sc.ingrediente_id))
                                                            AND (tti.id_cliente_origen::text = sc.cliente_id::text OR (sc.cliente_id IS NULL AND tti.id_cliente_origen IS NULL))
                          )
                      )
                  AND tt.estado IN ('ARMANDO', 'EN_CUARENTENA', 'EN_ACONDICIONAMIENTO')
                LIMIT 1
            ) tto ON true
            ORDER BY sc.ultima_actualizacion DESC
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
                COALESCE(a.nombre, i.nombre, mm.articulo_numero, mm.ingrediente_id::text) AS articulo_nombre,
                mm.cantidad,
                COALESCE(u.nombre_completo, NULLIF(TRIM(mm.usuario), ''), 'SISTEMA') AS usuario,
                mm.tipo_movimiento,
                mm.observaciones,
                mm.fecha_movimiento,
                mm.estado
            FROM public.mantenimiento_movimientos mm
            LEFT JOIN public.articulos a ON mm.articulo_numero = a.numero
            LEFT JOIN public.ingredientes i ON mm.ingrediente_id = i.id
            LEFT JOIN public.usuarios u ON u.id::text = mm.usuario::text
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

        // Obtener la descripción local del artículo para hacer un matching más inteligente
        let descripcionLocal = articulo;
        try {
            const resArt = await pool.query(`SELECT nombre FROM public.articulos WHERE numero = $1`, [articulo]);
            if (resArt.rowCount > 0) {
                descripcionLocal = resArt.rows[0].nombre.toUpperCase();
            }
        } catch (e) {
            console.error('⚠️ [VIGIA AUDITOR] No se pudo consultar la descripción del artículo', e);
        }
        
        // Función auxiliar para normalizar (quitar tildes, símbolos raros) y armar sets de palabras
        const normalizar = (str) => {
            return (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 ]/g, ' ').toUpperCase().split(' ').filter(w => w.length > 2);
        };
        const palabrasLocal = normalizar(descripcionLocal);

        // Remover comprobantes ocupados y filtrar por relevancia de producto
        resultados = resultados.filter(r => {
            const numeroCompleto = `${r.punto_venta || 0}-${r.numero_comprobante || 0}`;
            const firmaSearch = `${numeroCompleto}|${articulo.toUpperCase()}`;

            if (itemsYaConciliados.has(firmaSearch)) {
                return false;
            }

            // HARD FILTER: Aplicar filtro estricto de coincidencia de Artículo
            // Si el comprobante de Lomasoft pertenece a un producto TOTALMENTE distinto, lo descartamos
            const descLomasoft = (r.articulo || r.item_descripcion || '').toUpperCase();
            const palabrasLomasoft = normalizar(descLomasoft);
            
            // Chequear si alguna palabra clave de más de 2 letras coincide
            const interseccion = palabrasLocal.filter(p => palabrasLomasoft.includes(p));
            
            // Si no hay ninguna palabra en común (ej: 'AVENA' vs 'NUEZ'), significa que Lomasoft nos dio la basura del cliente
            if (interseccion.length === 0 && palabrasLocal.length > 0 && palabrasLomasoft.length > 0) {
                return false; // Descartar candidata
            }

            return true;
        });

        debugLog.push(`Resultados tras remover NCs "Ocupadas" y ajenas al producto: ${resultados.length}`);

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

            // 3. Match de Artículo (Generar alerta solo si es un match parcial bajo)
            const nombreArticuloCandidato = (r.articulo || r.item_descripcion || '').toUpperCase();
            let alertaArticulo = null;
            if (!nombreArticuloCandidato.includes(articulo.toUpperCase()) && !nombreArticuloCandidato.includes(descripcionLocal)) {
                alertaArticulo = `Código o nombre difiere parcialmente (${nombreArticuloCandidato})`;
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

            // Cálculo de montos con homologación de IVA para Tipo A
            let montoCandidato = Math.abs(parseFloat(r.importe_total || r.importe_neto || r.imp_neto || 0));
            const isTipoA = (r.tipo_comprobante || '').toUpperCase().includes(' A');
            if (isTipoA && !r.importe_total) {
                montoCandidato = montoCandidato * 1.21;
            }

            // Homologación de Padding para AFIP/Lomasoft
            const ptoStr = String(r.punto_venta || 0).padStart(4, '0');
            const numStr = String(r.numero_comprobante || 0).padStart(8, '0');

            return {
                comprobante: {
                    tipo_comprobante: r.tipo_comprobante || 'N/C',
                    pto_vta: ptoStr,
                    numero_comprobante: numStr,
                    imp_neto: r.importe_neto || r.imp_neto || 0,
                    importe_total: montoCandidato,
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
            comprobante,
            id_presupuesto_origen
        } = req.body;

        console.log(`💾 [MANTENIMIENTO] Iniciando Transacción de Conciliación (V2 - Strong Link) para Art: ${articulo}`);

        await client.query('BEGIN');

        // 1. Identificar Movimiento Pendiente (Lock Row)
        // Lo buscamos ANTES de insertar para obtener su ID y asegurar consistencia
        let findMovSql = `
            SELECT mm.id, p.id AS id_presupuesto, p.estado AS estado_presupuesto
            FROM public.mantenimiento_movimientos mm
            JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
            WHERE mm.articulo_numero = $1
              AND p.id_cliente = $2
              AND mm.tipo_movimiento IN ('INGRESO', 'RETORNO_TRATAMIENTO', 'RETIRO_TRATAMIENTO')
              AND mm.estado = 'PENDIENTE'
        `;
        const queryParams = [articulo, cliente_id];

        if (id_presupuesto_origen) {
            findMovSql += ` AND p.id = $3 `;
            queryParams.push(id_presupuesto_origen);
        }

        findMovSql += `
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
            FOR UPDATE
        `;
        const resMov = await client.query(findMovSql, queryParams);

        if (resMov.rowCount === 0) {
            throw new Error('No se encontró movimiento pendiente para conciliar (o ya fue conciliado por otro usuario).');
        }

        const idMovimiento = resMov.rows[0].id;
        const idPresupuesto = resMov.rows[0].id_presupuesto;
        const estadoPresupuesto = resMov.rows[0].estado_presupuesto;

        // 1.5. CHECK EXCLUSIÓN MUTUA: Verificar que ARCA no tenga un borrador en curso
        const arcaCheck = `
            SELECT 1 
            FROM public.mantenimiento_movimientos
            WHERE articulo_numero = $1
              AND observaciones LIKE $2
              AND tipo_movimiento = 'EMISION_NC'
            LIMIT 1
        `;
        const resArcaCheck = await client.query(arcaCheck, [articulo, '%Cliente #' + cliente_id + '%']);
        if (resArcaCheck.rowCount > 0) {
            throw new Error('Exclusión Mutua: Este artículo ya se encuentra en proceso de Nota de Crédito por circuito ARCA.');
        }

        // 2. Insertar Cabecera de Conciliación
        const insertCabecera = `
            INSERT INTO public.mantenimiento_conciliaciones
            (id_cliente, nro_comprobante_externo, tipo_comprobante, fecha_comprobante, importe_neto, importe_iva, importe_total, usuario_consolidacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;

        const usuario = req.user ? req.user.username : 'SISTEMA';
        const neto = parseFloat(comprobante.imp_neto || 0);
        const total = parseFloat(comprobante.importe_total || (neto * 1.21)); // Usa el total homologado desde Vigía
        const iva = total - neto;

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

        // 5. Sincronización Inversa: Actualizar la Orden de Retiro original (Presupuestos)
        const updatePresupuesto = `
            UPDATE public.presupuestos
            SET estado = 'Conciliado',
                comprobante_lomasoft = $1
            WHERE id = $2
        `;
        await client.query(updatePresupuesto, [
            `${comprobante.pto_vta}-${comprobante.numero_comprobante}`,
            idPresupuesto
        ]);

        // 6. Ajuste de Saldo Lomasoft (Sólo si NO es Administrativa NC)
        if (estadoPresupuesto !== 'Administrativa NC') {
            const updateStock = `
                UPDATE public.stock_real_consolidado
                SET stock_consolidado = stock_consolidado - $1,
                    stock_ajustes = COALESCE(stock_ajustes, 0) - $1, 
                    ultima_actualizacion = NOW()
                WHERE articulo_numero = $2
            `;
            await client.query(updateStock, [cantidad, articulo]);

            const insertAudit = `
                INSERT INTO public.mantenimiento_movimientos 
                (articulo_numero, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado, id_presupuesto_origen)
                VALUES ($1, $2, 'LIBERACION', NOW(), $3, '[Ajuste Automático] Reversión por Conciliación Lomasoft', 'FINALIZADO', $4)
            `;
            await client.query(insertAudit, [articulo, cantidad, usuario, idPresupuesto]);
        }

        await client.query('COMMIT');
        console.log(`✅ [MANTENIMIENTO] Conciliación Exitosa. Link V2: Conciliacion #${idConciliacion} <-> Movimiento #${idMovimiento} <-> Presupuesto #${idPresupuesto}`);

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
        const { cliente_id, articulo_origen, articulo_destino, cantidad, observaciones, responsable } = req.body;
        // Compatibilidad hacia atrás si sólo viene 'articulo'
        const origen = articulo_origen || req.body.articulo;
        const destino = articulo_destino || origen;
        const usuario = responsable || (req.user ? req.user.username : 'SISTEMA');

        if (!responsable || responsable === '-1') {
            throw new Error('Debe seleccionar obligatoriamente un responsable para enviar a ventas.');
        }

        console.log(`📦 [MANTENIMIENTO] Liberando stock para Ventas. Origen: ${origen} -> Destino: ${destino}, Cant: ${cantidad}, Resp: ${usuario}`);

        await client.query('BEGIN');

        // La bajada de Mantenimiento siempre ataca al origen
        let obsvAuditoria = observaciones || 'Reintegro a Ventas tras Conciliacion';
        if (origen !== destino) {
            obsvAuditoria = `[REENVASADO: Hacia Art. #${destino}] ` + obsvAuditoria;
        }

        // REEMPLAZO DETERMINISTA: Ejecutar baja global tolerante (GREATEST 0 para eludir errores asincronicos)
        await client.query(`
            UPDATE public.stock_real_consolidado
            SET 
                stock_mantenimiento = GREATEST(0, stock_mantenimiento - $1),
                stock_ajustes = COALESCE(stock_ajustes, 0) + $1,
                stock_consolidado = COALESCE(stock_lomasoft, 0) + COALESCE(stock_movimientos, 0) + (COALESCE(stock_ajustes, 0) + $1),
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $2
        `, [cantidad, origen]);
        
        // Registrar el movimiento de LIBERACION explícitamente para auditoría contable
        // (Debe indicarse como 'CONCILIADO' o estado válido del Check de la DB para que resista el filtro 'FINALIZADO' y
        // la query agrupada de getStockMantenimiento pueda sumar el negativo y dar 0)
        await client.query(`
            INSERT INTO public.mantenimiento_movimientos (
                articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento, estado
            ) VALUES ($1, $2, $3, 'LIBERACION', $4, NOW(), 'CONCILIADO')
        `, [origen, cantidad, usuario, obsvAuditoria]);

        // Cierre Definitivo del Lote (HIGIENE):
        // Actualizamos estrictamente el lote transaccional a 'FINALIZADO'
        if (req.body.movimiento_id) {
            await cleanUpMaintenanceRecord(client, req.body.movimiento_id, "Mantenimiento -> Ventas");
        }
        
        // Alta explícita en Ventas para el Destino
        try {
            const artQuery = await client.query('SELECT codigo_barras FROM articulos WHERE numero = $1', [destino]);
            const codigoBarras = artQuery.rows.length > 0 ? artQuery.rows[0].codigo_barras : '';

            // Sumamos el stock al articulo_destino en el historial de ventas
            await client.query(`
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, codigo_barras, kilos, cantidad, tipo, fecha, usuario_id, origen_ingreso
                ) VALUES ($1, $2, 0, $3, 'REVERSION_DESDE_MANTENIMIENTO', NOW(), $4, 'mantenimiento')
            `, [destino, codigoBarras || '', cantidad, null]);
        } catch (e) {
            console.error('⚠️ [MANTENIMIENTO] Error al hacer insert en stock_ventas_movimientos para el Destino. El trigger de la DB podría estar bloqueándolo o ya hizo el ingreso automático.', e.message);
        }

        await client.query('COMMIT');
        console.log(`✅ Stock liberado exitosamente. Origen: ${origen} Destino: ${destino}`);
        res.json({ success: true, message: 'Se ha liberado en Mantenimiento y reenvasado a Ventas correctamente' });

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
        const { cliente_id, articulo, ingrediente_id, cantidad_real, observaciones, responsable, unidades_origen, origen_ingrediente_id } = req.body;
        const usuario = responsable || (req.user ? req.user.username : 'SISTEMA');

        // Permitimos que articulo_numero y origen_ingrediente_id estén vacíos para procesar items huérfanos pre-fix
        if (!ingrediente_id || !cantidad_real) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (Ingrediente de Destino o Cantidad).' });
        }

        console.log(`🧪 [MANTENIMIENTO -> INGREDIENTES] Iniciando transferencia. Origen: (Art: ${articulo} / Ing: ${origen_ingrediente_id}) -> Ing_Destino: ${ingrediente_id}, Resp: ${usuario}`);

        await client.query('BEGIN');

        let cantidadUnidades = parseFloat(unidades_origen || 0);
        let kilosUnidad = 1;
        let pesoTeoricoTotal = cantidadUnidades;

        // 1. Obtener Stock Actual en Mantenimiento para KilosPorUnidad y validaciones secundarias
        if (articulo && articulo !== 'null' && articulo !== '') {
            const stockQuery = `
                SELECT stock_mantenimiento, kilos_unidad 
                FROM public.stock_real_consolidado 
                WHERE articulo_numero = $1
                FOR UPDATE
            `;
            const resStock = await client.query(stockQuery, [articulo]);

            if (resStock.rows.length === 0) {
                throw new Error(`Artículo ${articulo} no encontrado en stock consolidado.`);
            }

            if (!cantidadUnidades || cantidadUnidades <= 0) {
                cantidadUnidades = parseFloat(resStock.rows[0].stock_mantenimiento || 0);
            }

            kilosUnidad = parseFloat(resStock.rows[0].kilos_unidad || 1);
            pesoTeoricoTotal = cantidadUnidades * kilosUnidad;

            if (cantidadUnidades <= 0) {
                throw new Error(`El artículo ${articulo} no tiene stock asignado a transferir.`);
            }
        } else {
            // Es un ingrediente
            if (!cantidadUnidades || cantidadUnidades <= 0) {
                // Sacamos del historial si faltaran unidades origen
                throw new Error(`Faltan unidades originales definidas para el ingrediente en la UI.`);
            }
            pesoTeoricoTotal = cantidadUnidades; // 1 unidad = 1 kg para granel
        }

        const pesoIngreso = parseFloat(cantidad_real);

        // Calculamos la MERMA/SOBRANTE (Diferencia de peso)
        const diferencia = pesoIngreso - pesoTeoricoTotal;
        let deltaLabel = '';
        if (diferencia < 0) {
            deltaLabel = `[MERMA: ${Math.abs(diferencia).toFixed(2)} kg]`;
        } else if (diferencia > 0) {
            deltaLabel = `[SOBRANTE: +${diferencia.toFixed(2)} kg]`;
        } else {
            deltaLabel = `[EXACTO: 0.00 kg]`;
        }

        console.log(`📊 Cálculo: Unidades=${cantidadUnidades}, Kilos/U=${kilosUnidad}, Teorico=${pesoTeoricoTotal}, Real=${pesoIngreso}, Delta=${diferencia}`);

        // 2. DAR DE BAJA EN MANTENIMIENTO (Sustraccion Dinámica por unidades de origen)
        const updateMantenimiento = `
            UPDATE public.stock_real_consolidado
            SET 
                stock_mantenimiento = GREATEST(0, stock_mantenimiento - $2), -- Restamos únicamente la cantidad transferida iterada
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $1
        `;
        await client.query(updateMantenimiento, [articulo, cantidadUnidades]);

        // 3. REGISTRAR MOVIMIENTO DE SALIDA (AUDITORÍA)
        const obsAdicional = observaciones ? ` | Obs: ${observaciones}` : '';
        const obsFinal = `${deltaLabel} Transferencia a ingredientes. Peso original esperado: ${pesoTeoricoTotal.toFixed(2)} kg. Peso real ingresado: ${pesoIngreso.toFixed(2)} kg.${obsAdicional}`;

        if (articulo && articulo !== 'null' && articulo !== '') {
            const insertMov = `
                INSERT INTO public.mantenimiento_movimientos (
                    articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento
                ) VALUES (
                    $1, $2, $3, 'TRANSF_INGREDIENTE', $4, NOW()
                )
            `;
            await client.query(insertMov, [articulo, cantidadUnidades, usuario, obsFinal]);
        } else {
            const insertMov = `
                INSERT INTO public.mantenimiento_movimientos (
                    ingrediente_id, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento
                ) VALUES (
                    $1, $2, $3, 'TRANSF_INGREDIENTE', $4, NOW()
                )
            `;
            await client.query(insertMov, [origen_ingrediente_id, cantidadUnidades, usuario, obsFinal]);
        }

        // 4. DAR DE ALTA EN INGREDIENTES
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

        // 5. HIGIENE DE BASE DATOS
        if (req.body.movimiento_id) {
            await cleanUpMaintenanceRecord(client, req.body.movimiento_id, "Mantenimiento -> Ingredientes");
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
            deltaLabel: deltaLabel,
            merma: diferencia < 0 ? Math.abs(diferencia).toFixed(3) : (-diferencia).toFixed(3),
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
 * Orquestador: Genera Borrador de NC en Facturación y deduce stock local (Evita Doble Gasto)
 */
async function emitirNotaCreditoBorrador(req, res) {
    const client = await pool.connect();
    try {
        const payloadFacturacion = req.body;
        const itemsInfo = payloadFacturacion.items;
        const cliente_id = payloadFacturacion.cliente?.cliente_id;
        const idPresupuestoOrigen = payloadFacturacion.id_presupuesto_origen || null;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        if (!cliente_id || !itemsInfo || !Array.isArray(itemsInfo) || itemsInfo.length === 0) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios.' });
        }

        console.log(`🧾 [MANTENIMIENTO_ORQ] Iniciando orquestación de NC. Cliente: ${cliente_id}`);

        await client.query('BEGIN');

        // 0.5. RECUPERAR DESCUENTO GLOBAL DE LA ORDEN DE RETIRO (Fix Fuga Financiera NC)
        if (itemsInfo && itemsInfo.length > 0) {
            const primerArticulo = itemsInfo[0].articulo || (itemsInfo[0].descripcion?.match(/Devolución:\s*(.+)/)?.[1]?.trim());
            if (primerArticulo) {
                console.log(`[MANTENIMIENTO_ORQ] Intentando recuperar descuento de la Orden de Retiro origen para Art: ${primerArticulo}, Cliente: ${cliente_id}`);
                const descQuery = `
                    SELECT COALESCE(p.descuento, 0) as descuento_decimal
                    FROM public.mantenimiento_movimientos mm
                    JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                    WHERE p.id_cliente::text = $1
                      AND mm.articulo_numero = $2
                      AND mm.estado IS DISTINCT FROM 'REVERTIDO' 
                      AND mm.estado IS DISTINCT FROM 'FINALIZADO'
                      AND mm.estado IS DISTINCT FROM 'ANULADO'
                    ORDER BY mm.id DESC
                    LIMIT 1
                `;
                const resDesc = await client.query(descQuery, [cliente_id.toString(), primerArticulo]);

                if (resDesc.rowCount > 0) {
                    const descuentoDecimal = parseFloat(resDesc.rows[0].descuento_decimal) || 0; // ej: 0.04
                    if (descuentoDecimal > 0) {
                        const factorDescuento = 1 - descuentoDecimal; // ej: 0.96
                        console.log(`[MANTENIMIENTO_ORQ] Descuento activo detectado: ${descuentoDecimal * 100}%. Factor de prorrateo temporal Mantenimiento->Facturación: ${factorDescuento}`);

                        // 1. APLICAMOS LA MATEMÁTICA BRUTA A LOS ITEMS:
                        // Como Facturación y AFIP calculan basándose netamente en Suma(p_unit * qty), 
                        // debemos prorrater el precio unitario del payload antes de despacharlo.
                        itemsInfo.forEach(item => {
                            if (item.p_unit) {
                                item.p_unit = parseFloat((parseFloat(item.p_unit) * factorDescuento).toFixed(4));
                            }
                        });

                        // 2. Inyección Explícita de Variable en Payload JSON:
                        // Cumplimos la firma enviando el descuento original
                        payloadFacturacion.descuento = descuentoDecimal * 100;
                        console.log(`[MANTENIMIENTO_ORQ] Items prorrateados exitosamente en la memoria del orquestador.`);
                    }
                }
            }
        }

        // 1. Enviar a Facturación PRIMERO (Server-to-Server)
        console.log(`📡 [MANTENIMIENTO_ORQ] Solicitando Borrador a Facturación...`);
        let factura_generada_id = null;

        const facturacionUrl = process.env.FACTURACION_API_URL || 'http://localhost:3004';
        const fetchResponse = await fetch(`${facturacionUrl}/facturacion/facturas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadFacturacion)
        });

        const resultFacturacion = await fetchResponse.json();

        if (!fetchResponse.ok || !resultFacturacion.success) {
            throw new Error(resultFacturacion.error || resultFacturacion.message || 'Error del microservicio de Facturación');
        }

        factura_generada_id = resultFacturacion.data.id;
        console.log(`✅ [MANTENIMIENTO_ORQ] Facturación respondió con Borrador ID: ${factura_generada_id}`);

        for (const item of itemsInfo) {
            let articulo = item.articulo;

            // Fallback si no viene explícito
            if (!articulo && item.descripcion) {
                const match = item.descripcion.match(/Devolución:\s*(.+)/);
                if (match) articulo = match[1].trim();
            }

            if (!articulo) {
                throw new Error("No se pudo extraer el código del artículo en el payload.");
            }

            // 0. CHECK EXCLUSIÓN MUTUA: Verificar que Lomasoft no lo haya conciliado
            const lomaCheck = `
                SELECT 1
                FROM public.mantenimiento_conciliacion_items mci
                JOIN public.mantenimiento_conciliaciones mc ON mc.id = mci.id_conciliacion
                WHERE mci.articulo_numero = $1
                  AND mc.id_cliente::text = $2
                LIMIT 1
            `;
            const resLomaCheck = await client.query(lomaCheck, [articulo, cliente_id.toString()]);
            if (resLomaCheck.rowCount > 0) {
                throw new Error(`Exclusión Mutua: El artículo ${articulo} ya ha sido conciliado vía Lomasoft.`);
            }

            const cantidadEmitida = parseFloat(item.qty || 0);

            // 1. Obtener Stock Actual (SIN DEDUCIRLO: Modelo Lomasoft)
            const stockQuery = `
                SELECT stock_mantenimiento 
                FROM public.stock_real_consolidado 
                WHERE articulo_numero = $1
                FOR UPDATE
            `;
            const resStock = await client.query(stockQuery, [articulo]);

            if (resStock.rows.length > 0) {
                const pesoOriginal = parseFloat(resStock.rows[0].stock_mantenimiento || 0);

                if (pesoOriginal < cantidadEmitida) {
                    console.warn(`[ALERTA SOBRE-DEVOLUCION] ${articulo} Solo hay ${pesoOriginal} en mantenimiento, se emitió un borrador por ${cantidadEmitida}.`);
                }
                // ¡RESTA PREMATURA ELIMINADA!
                // El stock físico de Mantenimiento queda intacto.
                // Será deducido por liberarStock o transferirAIngredientes al asignar destino físico post-CAE.
            }

            // 2. REGISTRAR MOVIMIENTO DE SALIDA (AUDITORÍA LÓGICA / MUTEX)
            const obsFinal = `[NC Generada ID: ${factura_generada_id || 'SBD'}] Emisión de NC Borrador. Cliente #${cliente_id}`;

            const insertMov = `
                INSERT INTO public.mantenimiento_movimientos 
                (id_presupuesto_origen, articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, estado)
                VALUES ($1, $2, $3, $4, 'EMISION_NC', $5, 'FINALIZADO')
                RETURNING id
            `;
            await client.query(insertMov, [idPresupuestoOrigen, articulo, cantidadEmitida, usuario, obsFinal]);
        }

        // Sincronización Inversa: Marcar la Orden de Retiro como Conciliada para bloquear UI en Presupuestos
        if (idPresupuestoOrigen) {
            const updatePresupuesto = `
                UPDATE public.presupuestos
                SET estado = 'Conciliado'
                WHERE id = $1 AND (estado IS NULL OR estado != 'Conciliado')
            `;
            await client.query(updatePresupuesto, [idPresupuestoOrigen]);
            console.log(`🔒 [MANTENIMIENTO_ORQ] Orden de Retiro (Presupuesto #${idPresupuestoOrigen}) bloqueada como Conciliada.`);
        }

        await client.query('COMMIT');

        console.log(`✅ [MANTENIMIENTO_ORQ] Transacción completada con éxito. Stock deducido y borrador NC creado.`);
        res.json({
            success: true,
            message: 'Borrador generado y stock descontado exitosamente.',
            factura_id: factura_generada_id
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO_ORQ] Error en orquestación:', error.message);
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
        const { articulo, id_presupuesto_origen } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        if (!articulo) {
            return res.status(400).json({ success: false, error: 'Se requiere el artículo para deshacer la conciliación.' });
        }

        console.log(`🔗 [MANTENIMIENTO] Deshaciendo conciliacion de Art: ${articulo} | ID Presupuesto Origen: ${id_presupuesto_origen}`);

        await client.query('BEGIN');

        // Buscar el movimiento de ingreso (el estado puede ser null si se limpió parcialmente por error previo, así que confiamos en id_presupuesto_origen)
        let findMovSql = `
            SELECT mm.id, mm.observaciones, mm.id_presupuesto_origen 
            FROM public.mantenimiento_movimientos mm
            WHERE mm.articulo_numero = $1
              AND mm.tipo_movimiento = 'INGRESO'
              AND mm.estado IS DISTINCT FROM 'REVERTIDO' 
              AND mm.estado IS DISTINCT FROM 'FINALIZADO'
              AND mm.estado IS DISTINCT FROM 'ANULADO'
        `;
        const queryParams = [articulo];

        if (id_presupuesto_origen && id_presupuesto_origen !== 'null' && id_presupuesto_origen.toString().trim() !== '') {
            findMovSql += ` AND mm.id_presupuesto_origen = $2 `;
            queryParams.push(id_presupuesto_origen);
        }

        findMovSql += `
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
            FOR UPDATE
        `;
        const resMov = await client.query(findMovSql, queryParams);

        if (resMov.rowCount === 0) {
            console.error(`❌ [MANTENIMIENTO] No se encontró ingreso activo para AAIx5. Params:`, queryParams);
            throw new Error('No se encontró movimiento activo de ingreso para revertir, o ya fue procesado.');
        }

        const idMovimiento = resMov.rows[0].id;
        const obsActual = resMov.rows[0].observaciones || '';
        const idPresupuesto = resMov.rows[0].id_presupuesto_origen;

        // Buscar items de conciliación vinculados a este movimiento
        const findItemSql = `
            SELECT id_conciliacion 
            FROM public.mantenimiento_conciliacion_items
            WHERE id_movimiento_origen = $1
        `;
        const resItem = await client.query(findItemSql, [idMovimiento]);

        let idConciliacion = null;
        let movimientosAsociados = [];

        if (resItem.rowCount > 0) {
            idConciliacion = resItem.rows[0].id_conciliacion;

            // Obtener todos los movimientos asociados a esta misma conciliación
            const findAllItemsSql = `
                SELECT mci.id_movimiento_origen, mm.observaciones, mm.id_presupuesto_origen 
                FROM public.mantenimiento_conciliacion_items mci
                JOIN public.mantenimiento_movimientos mm ON mci.id_movimiento_origen = mm.id
                WHERE mci.id_conciliacion = $1
            `;
            const resAllItems = await client.query(findAllItemsSql, [idConciliacion]);
            movimientosAsociados = resAllItems.rows;

            // Borrar todos los items vinculantes de una vez
            await client.query(`DELETE FROM public.mantenimiento_conciliacion_items WHERE id_conciliacion = $1`, [idConciliacion]);
            // Borrar la cabecera
            await client.query(`DELETE FROM public.mantenimiento_conciliaciones WHERE id = $1`, [idConciliacion]);
        } else {
            // Si por algún motivo de datos corruptos no hay item de conciliación, operamos solo sobre el movimiento actual
            movimientosAsociados.push({
                id_movimiento_origen: idMovimiento,
                observaciones: obsActual,
                id_presupuesto_origen: idPresupuesto
            });
        }

        // Loop de reversión para todos los movimientos afectados por el vínculo
        for (const mov of movimientosAsociados) {
            // Limpiar etiqueta de nota en observaciones
            const obsLimpia = (mov.observaciones || '').replace(/ \[Conciliado con NC [^\]]+\]/g, '').trim();

            // Actualizar el estado del movimiento en mantenimiento
            const updateMov = `
                UPDATE public.mantenimiento_movimientos
                SET estado = NULL, 
                    observaciones = $1
                WHERE id = $2
            `;
            await client.query(updateMov, [obsLimpia, mov.id_movimiento_origen]);

            // Sincronización Inversa: Desbloquear la Orden de Retiro en Presupuestos
            if (mov.id_presupuesto_origen) {
                const updatePresupuesto = `
                    UPDATE public.presupuestos
                    SET estado = 'Orden de Retiro', comprobante_lomasoft = NULL
                    WHERE id = $1
                `;
                await client.query(updatePresupuesto, [mov.id_presupuesto_origen]);
                console.log(`🔓 [MANTENIMIENTO] Orden de Retiro (Presupuesto #${mov.id_presupuesto_origen}) restaurada a 'Orden de Retiro'.`);
            }
        }

        // Registrar acción en bitácora
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
                f.presupuesto_id,
                f.tipo_cbte,
                f.pto_vta,
                f.cbte_nro,
                f.imp_total,
                f.fecha_emision,
                f.estado,
                pd.valor1 as precio_unitario,
                pd.camp2 as iva_alicuota
            FROM public.factura_facturas f
            -- RESTORE STRICT TRACEABILITY: 
            -- Inner JOIN guarantees the invoice ACTUALLY sold the article being returned.
            -- This fixes the issue of blindly attaching to "the last invoice".
            JOIN public.presupuestos_detalles pd
              ON f.presupuesto_id = pd.id_presupuesto
                 AND (
                    pd.articulo = $1 
                    OR pd.articulo IN (SELECT codigo_barras FROM public.articulos WHERE numero = $1)
                 )
            WHERE f.cliente_id::text = $2::text
              AND f.estado = 'APROBADA'
            ORDER BY 
              f.fecha_emision DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [articulo, cliente_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No hay factura original trazable vinculada a este ingreso.' });
        }

        const factura = result.rows[0];

        // 2. Obtain all articles currently in Quarantine for this same invoice
        const queryItems = `
            WITH quarantine_stock AS (
                SELECT 
                    mm.articulo_numero,
                    SUM(CASE 
                        WHEN mm.tipo_movimiento = 'INGRESO' THEN mm.cantidad 
                        WHEN mm.tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') THEN -mm.cantidad
                        ELSE 0 
                    END) AS stock_actual
                FROM public.mantenimiento_movimientos mm
                LEFT JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                WHERE p.id_cliente::text = $1::text
                  AND mm.estado IS DISTINCT FROM 'REVERTIDO' 
                  AND mm.estado IS DISTINCT FROM 'FINALIZADO'
                  AND mm.estado IS DISTINCT FROM 'ANULADO'
                  AND mm.articulo_numero NOT IN (
                      -- Exclude items already conciliated with an ARCA Credit Note
                      SELECT mci.articulo_numero 
                      FROM public.mantenimiento_conciliaciones mc
                      JOIN public.mantenimiento_conciliacion_items mci ON mc.id = mci.id_conciliacion
                      WHERE mc.id_cliente::text = $1::text
                  )
                GROUP BY mm.articulo_numero
                HAVING SUM(CASE 
                    WHEN mm.tipo_movimiento = 'INGRESO' THEN mm.cantidad 
                    WHEN mm.tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') THEN -mm.cantidad
                    ELSE 0 
                END) > 0
            )
            SELECT 
                qs.articulo_numero,
                COALESCE(a.nombre, qs.articulo_numero) AS descripcion,
                qs.stock_actual as cantidad_devuelta,
                pd.valor1 as precio_historico,
                pd.camp2 as iva_alicuota,
                COALESCE(p.descuento, 0) as descuento_global,
                pd.cantidad as cantidad_original_facturada -- Trazabilidad de tope físico
            FROM quarantine_stock qs
            -- Join with original invoice details to get the historical price for EVERY returned item
            JOIN public.presupuestos_detalles pd 
              ON pd.id_presupuesto = $2
              AND (pd.articulo = qs.articulo_numero OR pd.articulo IN (SELECT codigo_barras FROM public.articulos WHERE numero = qs.articulo_numero))
            JOIN public.factura_facturas f ON f.presupuesto_id = pd.id_presupuesto
            JOIN public.presupuestos p ON p.id = f.presupuesto_id
            LEFT JOIN public.articulos a ON a.numero = qs.articulo_numero
            ORDER BY qs.articulo_numero ASC
        `;
        const resultItems = await pool.query(queryItems, [cliente_id, factura.presupuesto_id]);

        // Map items and their correct backend IVA ID
        const itemsAsociados = resultItems.rows.map(item => {
            let afipIvaId = 1; // Default 21% (Internal ID 1)
            if (item.iva_alicuota !== undefined && item.iva_alicuota !== null) {
                const alicNum = parseFloat(item.iva_alicuota);
                if (alicNum === 0.105 || alicNum === 10.5) afipIvaId = 2; // Internal ID 2 = 10.5%
                else if (alicNum === 0 || item.iva_alicuota.toString().toLowerCase() === 'exento') afipIvaId = 3; // Internal ID 3 = Exento
                else if (alicNum === 0.21 || alicNum === 21) afipIvaId = 1; // Internal ID 1 = 21%
            }

            const precioHistoricoPuro = parseFloat(item.precio_historico) || 0;
            // Eliminamos el prorrateo erróneo en el Frontend.
            // El backend orquestador (emitirNotaCreditoBorrador) se encargará 
            // de aplicar matemáticamente este porcentaje a cada ítem de forma precisa.

            return {
                articulo_numero: item.articulo_numero,
                descripcion: item.descripcion,
                cantidad: parseFloat(item.cantidad_devuelta),
                precio_historico: precioHistoricoPuro,
                alic_iva_id: afipIvaId,
                limite_fisico_facturado: parseFloat(item.cantidad_original_facturada) // Necesario para la doble alerta frontend
            };
        });

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

        res.json({
            success: true,
            factura: {
                ...factura,
                factura_nombre: `Factura ${tipoLetra} - Nro ${factura.pto_vta}-${factura.cbte_nro}`
            },
            nota_credito: {
                tipo_cbte: nc_tipo_cbte,
                nombre: nc_tipo_nombre
            },
            items_asociados: itemsAsociados
        });

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al trazar factura original:', error.stack);
        res.status(400).json({ success: false, message: `Falla en Trazabilidad ARCA: ${error.message}` });
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
            WHERE (p.tipo_comprobante = 'Orden de Retiro' OR p.estado = 'Orden de Retiro')
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
            LEFT JOIN public.rutas r ON p.id_ruta = r.id
            LEFT JOIN public.usuarios u ON r.id_chofer = u.id
            WHERE (p.tipo_comprobante = 'Orden de Retiro' OR p.estado = 'Orden de Retiro')
              AND p.activo = true
              AND (
                  (p.id_ruta IS NOT NULL AND r.estado IN ('ARMANDO', 'EN_CAMINO'))
                  OR 
                  (p.id_ruta IS NULL AND p.estado_logistico = 'PENDIENTE_ASIGNAR')
              )
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
            row.es_tratamiento = false;
        }

        // AGREGAR: Órdenes de Tratamiento In-Transit (Visibilidad Viva)
        const queryTto = `
            SELECT 
                ot.id, ot.codigo_qr_hash as id_presupuesto_ext, ot.fecha_creacion as fecha, ot.estado_logistico,
                c.cliente_id, c.nombre as cliente_nombre, c.apellido as cliente_apellido,
                r.id as ruta_id, r.nombre_ruta, r.estado as ruta_estado,
                u.nombre_completo as chofer_nombre
            FROM public.ordenes_tratamiento ot
            LEFT JOIN public.clientes c ON ot.id_cliente::text = c.cliente_id::text
            LEFT JOIN public.rutas r ON ot.id_ruta = r.id
            LEFT JOIN public.usuarios u ON r.id_chofer = u.id
            WHERE ot.estado_tratamiento = 'RETIRO_PENDIENTE'
              AND (
                  (ot.id_ruta IS NOT NULL AND r.estado IN ('ARMANDO', 'EN_CAMINO'))
                  OR 
                  ot.estado_logistico IN ('PENDIENTE_ASIGNAR', 'RETIRADO')
              )
        `;
        const resultTto = await pool.query(queryTto);

        for (let row of resultTto.rows) {
            const detQuery = `
                SELECT 
                    otd.articulo_numero as articulo, 
                    1 as cantidad, 
                    COALESCE(otd.descripcion_externa, a.nombre, 'Tratamiento P/D') || ' (' || otd.kilos || 'kg)' as descripcion, 
                    otd.articulo_numero
                FROM public.ordenes_tratamiento_detalles otd
                LEFT JOIN public.articulos a ON otd.articulo_numero = a.numero
                WHERE otd.id_orden_tratamiento = $1
            `;
            const detResult = await pool.query(detQuery, [row.id]);
            row.items = detResult.rows;
            row.es_tratamiento = true;
        }

        // Combinar y Ordenar por fecha cronológica inversa
        let combined = [...result.rows, ...resultTto.rows];
        combined.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        res.json({ success: true, data: combined });
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
            WHERE id = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado = 'Orden de Retiro')
            FOR UPDATE
        `;
        const orderResult = await client.query(orderQuery, [id]);

        if (orderResult.rows.length === 0) {
            throw new Error('Orden de Retiro no encontrada.');
        }

        const orden = orderResult.rows[0];
        if (orden.estado_logistico !== 'ESPERANDO_MOSTRADOR') {
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

/**
 * Revierte el Ingreso Local (Mostrador)
 * Borra los movimientos, ajusta el stock de cuarentena y retorna la Orden 
 * de Retiro a su estado "ESPERANDO_MOSTRADOR" original.
 */
async function revertirIngresoLocal(req, res) {
    const client = await pool.connect();
    try {
        const { cliente_id, articulo_numero } = req.body;

        if (!cliente_id || !articulo_numero) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros obligatorios (cliente_id, articulo_numero).' });
        }

        console.log(`↩️ [MANTENIMIENTO] Revirtiendo recepción local para Art: ${articulo_numero}, Cliente: ${cliente_id}`);

        await client.query('BEGIN');

        // 1. Encontrar los movimientos 'INGRESO' en estado 'PENDIENTE' o NULL para este artículo y cliente agrupados en Presupuestos
        const movQuery = `
            SELECT mm.id, mm.cantidad, mm.id_presupuesto_origen, p.id_ruta 
            FROM public.mantenimiento_movimientos mm
            JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
            WHERE p.id_cliente::text = $1
              AND mm.articulo_numero = $2
              AND mm.tipo_movimiento = 'INGRESO'
              AND (mm.estado = 'PENDIENTE' OR mm.estado IS NULL)
            FOR UPDATE
        `;
        const resMovs = await client.query(movQuery, [cliente_id.toString(), articulo_numero]);

        if (resMovs.rows.length === 0) {
            throw new Error(`No se encontró recepción física PENDIENTE para el artículo ${articulo_numero} de este cliente.`);
        }

        let totalSobrante = 0;
        let origenes_a_restaurar = new Map(); // id -> isRuta
        let movs_a_eliminar = [];

        resMovs.rows.forEach(mov => {
            totalSobrante += parseFloat(mov.cantidad);
            origenes_a_restaurar.set(mov.id_presupuesto_origen, mov.id_ruta !== null);
            movs_a_eliminar.push(mov.id);
        });

        // 2. Restar la cantidad acumulada del stock consolidado
        const restoreStockQuery = `
            UPDATE public.stock_real_consolidado
            SET stock_mantenimiento = stock_mantenimiento - $1, 
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $2
        `;
        await client.query(restoreStockQuery, [totalSobrante, articulo_numero]);

        // 3. Eliminar los movimientos 'INGRESO' de la auditoría (Hard Delete)
        // Eliminamos físicamente en lugar de Revertir lógicamente para prevenir basuras si la orden se borra después.
        const deleteMovs = `DELETE FROM public.mantenimiento_movimientos WHERE id = ANY($1::int[])`;
        await client.query(deleteMovs, [movs_a_eliminar]);

        // 4. Restaurar el estado Lógico de las Órdenes de Retiro originales en Presupuestos
        for (let [origenId, isRuta] of origenes_a_restaurar.entries()) {
            let estadoLogistico = isRuta ? 'PENDIENTE_ASIGNAR' : 'ESPERANDO_MOSTRADOR';
            let estadoBasico = 'Orden de Retiro';
            let extraUpdates = isRuta ? ', id_ruta = NULL, orden_entrega = NULL, fecha_asignacion_ruta = NULL' : '';
            
            const revertPresupuesto = `
                UPDATE public.presupuestos
                SET estado_logistico = $2, 
                    estado = $3, 
                    fecha_actualizacion = NOW(),
                    fecha_entrega_real = NULL
                    ${extraUpdates}
                WHERE id = $1
            `;
            await client.query(revertPresupuesto, [origenId, estadoLogistico, estadoBasico]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'La recepción de la Orden de Retiro se revirtió con éxito.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al revertir ingreso local:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}


const trasladoVentas = async (req, res) => {
    const { articulo, cantidad, motivo, responsable } = req.body;
    if (!articulo || !cantidad || cantidad <= 0) return res.status(400).json({ error: 'Datos inválidos' });
    const usuarioFinal = responsable && responsable.trim() !== '' ? responsable : (req.user ? req.user.username : 'SISTEMA');

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Reducir stock del artículo en ventas y pasarlo a cuarentena (usando la tabla real consolidada)
        // [Fase 23 Fix Matemático]: Se DEBE reflejar la resta en stock_ajustes para que la ecuación de Lomasoft + Movs + Ajustes se mantenga íntegra si luego se intenta devolver el stock.
        const updateArt = await client.query(
            "UPDATE public.stock_real_consolidado SET stock_consolidado = stock_consolidado - $1, stock_ajustes = COALESCE(stock_ajustes, 0) - $1, stock_mantenimiento = COALESCE(stock_mantenimiento, 0) + $1, ultima_actualizacion = NOW() WHERE articulo_numero = $2 RETURNING *",
            [cantidad, articulo]
        );
        if (updateArt.rowCount === 0) throw new Error('Artículo no encontrado en stock_real_consolidado');

        // 2. Registrar el ingreso en mantenimiento_movimientos (esquema auditado 100% verídico)
        const insertReq = await client.query(`
            INSERT INTO mantenimiento_movimientos 
            (articulo_numero, cantidad, estado, observaciones, tipo_movimiento, fecha_movimiento, usuario)
            VALUES ($1, $2, 'PENDIENTE', $3, 'TRASLADO_INTERNO_VENTAS', NOW(), $4)
            RETURNING id
        `, [articulo, cantidad, motivo || null, usuarioFinal]);

        // Obtener código de barras para el registro de movimiento
        const artQuery = await client.query('SELECT codigo_barras FROM articulos WHERE numero = $1', [articulo]);
        const codigoBarras = artQuery.rows.length > 0 ? artQuery.rows[0].codigo_barras : '';

        // Registrar en historial inventarios de ventas usando stock_ventas_movimientos
        await client.query(`
            INSERT INTO stock_ventas_movimientos (
                articulo_numero, codigo_barras, kilos, cantidad, tipo, fecha, usuario_id, origen_ingreso
            ) VALUES ($1, $2, 0, $3, 'ENVIO_A_MANTENIMIENTO', NOW(), $4, 'mantenimiento')
        `, [articulo, codigoBarras || '', -Math.abs(cantidad), null]); // null para usuario_id temporalmente, OJO req.user.id no existe


        await client.query('COMMIT');
        res.json({ success: true, movimiento_id: insertReq.rows[0].id });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const trasladoIngredientes = async (req, res) => {
    const { ingrediente_id, cantidad, motivo, responsable } = req.body;
    if (!ingrediente_id || !cantidad || cantidad <= 0) return res.status(400).json({ error: 'Datos inválidos' });
    const usuarioFinal = responsable && responsable.trim() !== '' ? responsable : (req.user ? req.user.username : 'SISTEMA');

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Obtener estado previo del ingrediente
        const ingStatus = await client.query('SELECT stock_actual, nombre FROM ingredientes WHERE id = $1', [ingrediente_id]);
        if (ingStatus.rowCount === 0) throw new Error('Ingrediente no encontrado');
        const stock_anterior = ingStatus.rows[0].stock_actual;

        // 2. Registrar movimiento en ingredientes_movimientos
        // Nota Arquitectónica: Insertaremos 'mantenimiento'. Se requiere un ALTER TABLE DROP/ADD CONSTRAINT previo.
        const kilosParaDescontar = -Math.abs(cantidad);
        const refMotivo = motivo ? ('Traslado a mantenimiento: ' + motivo) : 'Traslado interno a mantenimiento';
        await client.query(`
            INSERT INTO ingredientes_movimientos 
            (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
            VALUES ($1, $2, 'mantenimiento', NULL, $3, NOW(), $4)
        `, [ingrediente_id, kilosParaDescontar, refMotivo, stock_anterior]);

        // 3. Registrar el ingreso en mantenimiento_movimientos (esquema auditado 100% verídico)
        const insertReq = await client.query(`
            INSERT INTO mantenimiento_movimientos 
            (ingrediente_id, cantidad, estado, observaciones, tipo_movimiento, fecha_movimiento, usuario)
            VALUES ($1, $2, 'PENDIENTE', $3, 'TRASLADO_INTERNO_INGREDIENTES', NOW(), $4)
            RETURNING id
        `, [ingrediente_id, cantidad, motivo || null, usuarioFinal]);

        await client.query('COMMIT');
        res.json({ success: true, movimiento_id: insertReq.rows[0].id });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const anularTraslado = async (req, res) => {
    const { movimiento_id, motivo_anulacion } = req.body;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Buscar el movimiento original
        const { rows } = await client.query("SELECT * FROM mantenimiento_movimientos WHERE id = $1", [movimiento_id]);
        if (rows.length === 0) throw new Error('Movimiento no encontrado');
        
        const mov = rows[0];
        if (mov.estado === 'REVERTIDO' || mov.estado === 'ANULADO') throw new Error('Ya se encuentra revertido');
        if (mov.cantidad !== mov.stock_mantenimiento) throw new Error('El stock ya fue alterado en cuarentena, no se puede anular');

        // Restaurar según origen
        if (mov.tipo_movimiento === 'TRASLADO_INTERNO_VENTAS') {
            await client.query("UPDATE articulos SET stock_consolidado = stock_consolidado + $1 WHERE numero = $2", [mov.cantidad, mov.articulo_id]);
            await client.query(`
                INSERT INTO historial_inventarios (articulo_numero, accion, cantidad, fecha, modulo, observaciones)
                VALUES ($1, 'REVERSION_A_VENTAS', $2, NOW(), 'Mantenimiento', $3)
            `, [mov.articulo_id, mov.cantidad, motivo_anulacion]);

        } else if (mov.tipo_movimiento === 'TRASLADO_INTERNO_INGREDIENTES') {
            const ingStat = await client.query("SELECT stock_actual FROM ingredientes WHERE id = $1", [mov.ingrediente_id]);
            const stockAnterior = ingStat.rows[0].stock_actual;
            
            // NOTA: No hacemos UPDATE ingredientes manual porque el trigger de DB lo hace solo en base al INSERT
            await client.query(`
                INSERT INTO ingredientes_movimientos (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
                VALUES ($1, $2, 'mantenimiento', NULL, $3, NOW(), $4)
            `, [mov.ingrediente_id, mov.cantidad, 'Reversión desde mantenimiento: ' + motivo_anulacion, stockAnterior]);
        } else {
            throw new Error('Tipo de movimiento no reversible por esta vía');
        }

        // Marcar como anulado
        await client.query("UPDATE mantenimiento_movimientos SET estado = 'REVERTIDO', stock_mantenimiento = 0, observaciones = observaciones || ' [ANULADO: ' || $1 || ']' WHERE id = $2", [motivo_anulacion, movimiento_id]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const anularTrasladoAgrupado = async (req, res) => {
    const { articulo_numero, ingrediente_id, motivo_anulacion } = req.body;
    const usuario = req.user ? req.user.username : 'SISTEMA';

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Buscar movimientos pendientes según el parámetro enviado
        const param = ingrediente_id || articulo_numero;
        const whereCol = ingrediente_id ? "ingrediente_id" : "articulo_numero";

        const { rows } = await client.query(`
            SELECT * FROM mantenimiento_movimientos 
            WHERE ${whereCol} = $1 
              AND tipo_movimiento IN ('TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES')
              AND estado = 'PENDIENTE'
            FOR UPDATE
        `, [param]);

        if (rows.length === 0) throw new Error('No hay traslados internos pendientes para anular correspondientes a este ítem');

        for (const mov of rows) {
            const obsMotivo = motivo_anulacion ? motivo_anulacion : 'Deshecho por el usuario';

            // Restaurar según origen orgánico auditado
            if (mov.tipo_movimiento === 'TRASLADO_INTERNO_VENTAS') {
                const checkStock = await client.query("SELECT COALESCE(stock_mantenimiento, 0) as stock_mantenimiento FROM stock_real_consolidado WHERE articulo_numero = $1", [mov.articulo_numero]);
                if (checkStock.rows.length === 0 || parseFloat(checkStock.rows[0].stock_mantenimiento) < parseFloat(mov.cantidad)) {
                    throw new Error('Stock insuficiente en cuarentena, no se puede anular masivamente.');
                }
                
                await client.query("UPDATE stock_real_consolidado SET stock_consolidado = stock_consolidado + $1, stock_mantenimiento = stock_mantenimiento - $1 WHERE articulo_numero = $2", [mov.cantidad, mov.articulo_numero]);
                
                // Restaurar histórico de ventas usando stock_ventas_movimientos
                const artQuery = await client.query('SELECT codigo_barras FROM articulos WHERE numero = $1', [mov.articulo_numero]);
                const codigoBarras = artQuery.rows.length > 0 ? artQuery.rows[0].codigo_barras : '';

                await client.query(`
                    INSERT INTO stock_ventas_movimientos (
                        articulo_numero, codigo_barras, kilos, cantidad, tipo, fecha, usuario_id, origen_ingreso
                    ) VALUES ($1, $2, 0, $3, 'REVERSION_DESDE_MANTENIMIENTO', NOW(), $4, 'mantenimiento')
                `, [mov.articulo_numero, codigoBarras || '', mov.cantidad, null]); // Dejar usuario_id en null
                
            } else if (mov.tipo_movimiento === 'TRASLADO_INTERNO_INGREDIENTES') {
                const sumQuery = await client.query(`
                    SELECT SUM(CASE 
                        WHEN tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES') THEN cantidad 
                        WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') THEN -cantidad
                        ELSE 0 
                    END) AS current_stock
                    FROM public.mantenimiento_movimientos
                    WHERE ingrediente_id = $1 AND estado NOT IN ('REVERTIDO', 'FINALIZADO', 'ANULADO')
                `, [mov.ingrediente_id]);
                
                if (sumQuery.rows.length === 0 || parseFloat(sumQuery.rows[0].current_stock) < parseFloat(mov.cantidad)) {
                    throw new Error('Stock insuficiente en cuarentena, no se puede anular masivamente.');
                }

                // Restaurar stock en ingredientes (Solo audit)
                const ingStat = await client.query("SELECT stock_actual FROM ingredientes WHERE id = $1", [mov.ingrediente_id]);
                const stockAnterior = ingStat.rows[0].stock_actual;
                
                // Mapeo simétrico para la tabla de movimientos (requiere alterado de check maintenance en SQL previo de usuario)
                // NOTA: El trigger en Postgres interceptará este INSERT y efectuará el UPDATE stock + cantidad por su cuenta. 
                const anulaObs = `[ANULACIÓN] Movimiento a mantenimiento revertido por error operativo. Motivo: ${obsMotivo}`;
                await client.query(`
                    INSERT INTO ingredientes_movimientos (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
                    VALUES ($1, $2, 'mantenimiento', NULL, $3, NOW(), $4)
                `, [mov.ingrediente_id, mov.cantidad, anulaObs, stockAnterior]);
            }

            // Marcar como revertido en cuarentena auditada
            await client.query("UPDATE mantenimiento_movimientos SET estado = 'REVERTIDO', observaciones = observaciones || ' [ANULADO: ' || $1 || ']' WHERE id = $2", [obsMotivo, mov.id]);
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};


const retornarIngrediente = async (req, res) => {
    const { ingrediente_id, cantidad_real } = req.body;
    const usuario = req.user ? req.user.username : 'SISTEMA';

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Obtener stock actual en ingredientes para el log (trigger necesita esto si está implementado así, o es útil para el audit)
        const ingStat = await client.query("SELECT stock_actual, nombre FROM ingredientes WHERE id = $1 FOR UPDATE", [ingrediente_id]);
        if (ingStat.rows.length === 0) throw new Error('Ingrediente no encontrado.');
        const stockActual = ingStat.rows[0].stock_actual;
        const nombreIngrediente = ingStat.rows[0].nombre;

        // Sumar todos los pendientes en mantenimiento para este ingrediente para calcular el peso original esperado
        const currentData = await client.query(`
            SELECT SUM(CASE 
                WHEN tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'RETORNO_TRATAMIENTO') THEN cantidad 
                WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') THEN -cantidad
                ELSE 0 
            END) AS stock_mantenimiento
            FROM public.mantenimiento_movimientos
            WHERE ingrediente_id = $1 AND estado NOT IN ('REVERTIDO', 'FINALIZADO', 'ANULADO')
        `, [ingrediente_id]);

        const pesoTeoricoOrig = parseFloat(currentData.rows[0].stock_mantenimiento || 0);
        const pesoRetornoReal = parseFloat(cantidad_real);

        if (pesoTeoricoOrig <= 0) {
            throw new Error(`El ingrediente ${ingrediente_id} no tiene stock activo en mantenimiento para devolver.`);
        }

        // 1. Calculamos la Diferencia (Merma o Sobrante)
        // Delta = Peso real que retorna - Peso teórico prestado
        const diferencia = pesoRetornoReal - pesoTeoricoOrig;
        let deltaLabel = '';
        if (diferencia < 0) {
            deltaLabel = `[MERMA: ${Math.abs(diferencia).toFixed(2)} kg]`;
        } else if (diferencia > 0) {
            deltaLabel = `[SOBRANTE: +${diferencia.toFixed(2)} kg]`;
        } else {
            deltaLabel = `[EXACTO: 0.00 kg]`;
        }

        const obsAudit = `${deltaLabel} Retorno desde Mantenimiento. Esperado: ${pesoTeoricoOrig.toFixed(2)} kg. Real: ${pesoRetornoReal.toFixed(2)} kg.`;

        // 2. Insertar movimiento en ingredientes_movimientos
        // EL TRIGGER SE ENCARGARÁ DE HACER EL UPDATE A LA TABLA INGREDIENTES AÑADIENDO ESTOS KILOS (pesoRetornoReal)
        await client.query(`
            INSERT INTO ingredientes_movimientos (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
            VALUES ($1, $2, 'mantenimiento', NULL, $3, NOW(), $4)
        `, [ingrediente_id, pesoRetornoReal, obsAudit, stockActual]);

        // 3. Finalizar (Dar de baja) los registros en Mantenimiento preservando su observación original
        if (req.body.movimiento_id) {
            await cleanUpMaintenanceRecord(client, req.body.movimiento_id, "Retorno Ingrediente a Planta");
        }

        // Si no mandan movimiento_id (legacy fallback) finalizamos todo el stock pendiente de este ingrediente
        await client.query(`
            UPDATE public.mantenimiento_movimientos 
            SET estado = 'FINALIZADO'
            WHERE ingrediente_id = $1 AND estado NOT IN ('REVERTIDO', 'FINALIZADO', 'ANULADO')
        `, [ingrediente_id]);

        // 4. Insertar el movimiento de salida explícito para el historial (Mantenimiento)
        const obsHistorialSalida = `${deltaLabel} Retornado a Producción (${pesoRetornoReal}kg)`;
        
        await client.query(`
            INSERT INTO public.mantenimiento_movimientos 
            (ingrediente_id, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado)
            VALUES ($1, $2, 'TRANSF_INGREDIENTE', NOW(), $3, $4, 'FINALIZADO')
        `, [ingrediente_id, pesoRetornoReal, usuario, obsHistorialSalida]);

        await client.query('COMMIT');
        res.json({ success: true, deltaLabel });

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('Error en retornarIngrediente:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

// ==========================================
// MÓDULO DE TRATAMIENTOS (CARPAS)
// ==========================================

const iniciarTratamiento = async (req, res) => {
    let client;
    try {
        const { tipo_tratamiento, notas, usuario, items, bultos_fisicos } = req.body;
        
        if (!tipo_tratamiento || !items || items.length === 0) {
            return res.status(400).json({ error: 'Faltan datos obligatorios o no hay items seleccionados.' });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        let kilosBrutosTotales = 0;
        for (const item of items) {
            kilosBrutosTotales += parseFloat(item.cantidad || item.descuento_kilos || 0);
        }

        // 1. Crear la cabecera del Tratamiento
        const insertTratamiento = `
            INSERT INTO public.mantenimiento_tratamientos 
            (tipo_tratamiento, estado, usuario_armado, kilos_brutos_totales, notas, bultos_fisicos)
            VALUES ($1, 'ARMANDO', $2, $3, $4, $5)
            RETURNING id
        `;
        const resultTratamiento = await client.query(insertTratamiento, [tipo_tratamiento, usuario, kilosBrutosTotales, notas || '', parseFloat(bultos_fisicos) || 0]);
        const tratamientoId = resultTratamiento.rows[0].id;

        // 2. Insertar los items y descontar del stock de mantenimiento consolidado
        for (const item of items) {
            const kg = parseFloat(item.cantidad || item.descuento_kilos || 0);

            let kilosUnidad = 1;
            if (item.articulo_numero) {
                const artQ = await client.query('SELECT kilos_unidad FROM public.stock_real_consolidado WHERE articulo_numero = $1', [item.articulo_numero]);
                if (artQ.rows.length > 0 && artQ.rows[0].kilos_unidad) {
                    kilosUnidad = parseFloat(artQ.rows[0].kilos_unidad);
                }
            }
            const cantidadEnUnidades = kg / kilosUnidad;
            
            const insertItem = `
                INSERT INTO public.mantenimiento_tratamientos_items 
                (id_tratamiento, articulo_numero, ingrediente_id, id_cliente_origen, kilos_ingresados, id_movimiento_origen)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            await client.query(insertItem, [
                tratamientoId, 
                item.articulo_numero, 
                item.ingrediente_id || null, 
                item.cliente_origen || null, 
                kg, 
                item.id || null
            ]);

            // Descontar del stock consolidado
            const updateStock = `
                UPDATE public.stock_real_consolidado
                SET stock_mantenimiento = stock_mantenimiento - $1, 
                    ultima_actualizacion = NOW()
                WHERE articulo_numero = $2
            `;
            await client.query(updateStock, [cantidadEnUnidades, item.articulo_numero]);

            // Mutar el movimiento original para apagar el Bulto Listado
            if (item.id) {
                await client.query(`UPDATE public.mantenimiento_movimientos SET estado = 'EN_TRATAMIENTO', observaciones = CONCAT(COALESCE(observaciones, ''), ' -> Enviado a Tratamiento #', $1::text) WHERE id = $2`, [tratamientoId, item.id]);
            }

            // Insertar traza documental para el Historial
            const insertAuditoria = `
                INSERT INTO public.mantenimiento_movimientos 
                (articulo_numero, ingrediente_id, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado)
                VALUES ($1, $2, $3, 'ENVIO_TRATAMIENTO', NOW(), $4, $5, 'EN_TRATAMIENTO')
            `;
            const obsConCliente = item.cliente_origen 
                ? `[ENVIO CARPA #${tratamientoId}] ${tipo_tratamiento} | Cliente Origen: ${item.cliente_origen}`
                : `[ENVIO CARPA #${tratamientoId}] ${tipo_tratamiento}`;
                
            await client.query(insertAuditoria, [
                item.articulo_numero || null,
                item.ingrediente_id || null,
                item.articulo_numero ? cantidadEnUnidades : kg,
                usuario,
                obsConCliente
            ]);
        }

        await client.query('COMMIT');
        res.json({ success: true, tratamiento_id: tratamientoId, message: 'Tratamiento iniciado correctamente.' });

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al iniciar tratamiento:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const anularTratamiento = async (req, res) => {
    let client;
    try {
        const id = req.params.id;
        client = await pool.connect();
        await client.query('BEGIN');

        const check = await client.query('SELECT estado FROM public.mantenimiento_tratamientos WHERE id = $1', [id]);
        if (check.rowCount === 0) throw new Error('Tratamiento no encontrado.');
        if (check.rows[0].estado !== 'ARMANDO') throw new Error('Solo se pueden anular carpas en estado ARMANDO.');

        const items = await client.query('SELECT articulo_numero, kilos_ingresados FROM public.mantenimiento_tratamientos_items WHERE id_tratamiento = $1', [id]);
        
        await client.query('DELETE FROM public.mantenimiento_tratamientos_items WHERE id_tratamiento = $1', [id]);
        await client.query('DELETE FROM public.mantenimiento_tratamientos WHERE id = $1', [id]);

        for (const item of items.rows) {
            if (item.articulo_numero) {
                const kg = parseFloat(item.kilos_ingresados);
                let kilosUnidad = 1;
                const artQ = await client.query('SELECT kilos_unidad FROM public.articulos WHERE numero = $1', [item.articulo_numero]);
                if (artQ.rows.length > 0 && artQ.rows[0].kilos_unidad) {
                    kilosUnidad = parseFloat(artQ.rows[0].kilos_unidad);
                }
                const cantidadEnUnidades = kg / kilosUnidad;

                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET stock_mantenimiento = stock_mantenimiento + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [cantidadEnUnidades, item.articulo_numero]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Tratamiento anulado correctamente.' });
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al anular tratamiento:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const getTratamientosActivos = async (req, res) => {
    try {
        const query = `
            SELECT t.*, 
                   COALESCE(json_agg(json_build_object(
                       'id', i.id,
                       'articulo_numero', i.articulo_numero,
                       'kilos_ingresados', i.kilos_ingresados,
                       'id_cliente_origen', i.id_cliente_origen,
                       'ingrediente_id', i.ingrediente_id,
                       'item_nombre', COALESCE(a.nombre, ing.nombre),
                       'hash', ot.codigo_qr_hash
                   )) FILTER (WHERE i.id IS NOT NULL), '[]') as items
            FROM public.mantenimiento_tratamientos t
            LEFT JOIN public.mantenimiento_tratamientos_items i ON t.id = i.id_tratamiento
            LEFT JOIN public.mantenimiento_movimientos mm ON i.id_movimiento_origen = mm.id
            LEFT JOIN public.ordenes_tratamiento ot ON mm.id_orden_tratamiento = ot.id
            LEFT JOIN public.articulos a ON i.articulo_numero = a.numero
            LEFT JOIN public.ingredientes ing ON i.ingrediente_id = ing.id
            WHERE t.estado != 'FINALIZADO'
            GROUP BY t.id
            ORDER BY t.fecha_inicio_armado DESC
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error al obtener tratamientos:', e);
        res.status(500).json({ error: e.message });
    }
};

const sellarTratamiento = async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            UPDATE public.mantenimiento_tratamientos
            SET estado = 'EN_CUARENTENA', fecha_inicio_cuarentena = NOW()
            WHERE id = $1 AND estado = 'ARMANDO'
            RETURNING *
        `;
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) return res.status(400).json({ error: 'El tratamiento no existe o no está en estado ARMANDO.' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const abrirTratamiento = async (req, res) => {
    try {
        const { id } = req.params;
        const { usuario } = req.body;
        const query = `
            UPDATE public.mantenimiento_tratamientos
            SET estado = 'EN_ACONDICIONAMIENTO', fecha_apertura = NOW(), usuario_apertura = $2
            WHERE id = $1 AND estado = 'EN_CUARENTENA'
            RETURNING *
        `;
        const result = await pool.query(query, [id, usuario]);
        if (result.rowCount === 0) return res.status(400).json({ error: 'El tratamiento no está en cuarentena.' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const finalizarTratamiento = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Obtener tratamiento
        const trRes = await client.query(`SELECT * FROM public.mantenimiento_tratamientos WHERE id = $1 AND estado IN ('EN_ACONDICIONAMIENTO', 'EN_CUARENTENA', 'ARMANDO')`, [id]);
        if (trRes.rowCount === 0) throw new Error('Tratamiento no válido para finalizar.');
        const tratamiento = trRes.rows[0];

        // 2. Finalizar Master
        await client.query(`
            UPDATE public.mantenimiento_tratamientos
            SET estado = 'FINALIZADO'
            WHERE id = $1
        `, [id]);

        // 3. Quinto Flujo: Devolver a Cuarentena
        const itemsRes = await client.query(`SELECT * FROM public.mantenimiento_tratamientos_items WHERE id_tratamiento = $1`, [id]);
        
        let kilosDevueltosTotales = 0;

        for (const item of itemsRes.rows) {
            // Obtener el movimiento original para heredar su JSON historial_tratamientos si existe
            const originalMov = await client.query(`SELECT id_presupuesto_origen, id_orden_tratamiento, observaciones, historial_tratamientos FROM public.mantenimiento_movimientos WHERE id = $1`, [item.id_movimiento_origen]);
            
            let historialPrevio = '[]';
            let idPresupuestoOrigen = null;
            let idOrdenTratamiento = null;
            let obsOriginal = '';

            if (originalMov.rowCount > 0) {
                const movData = originalMov.rows[0];
                idPresupuestoOrigen = movData.id_presupuesto_origen;
                idOrdenTratamiento = movData.id_orden_tratamiento;
                historialPrevio = typeof movData.historial_tratamientos === 'string' ? movData.historial_tratamientos : JSON.stringify(movData.historial_tratamientos || []);
                obsOriginal = movData.observaciones || '';
            }

            // Parsear para armar el nuevo estado
            let historyArray = [];
            try { historyArray = JSON.parse(historialPrevio); } catch(e) {}
            
            // Agregar el tratamiento actual al historial
            historyArray.push({
                tratamiento_id: id,
                tipo_tratamiento: tratamiento.tipo_tratamiento,
                estado_cierre: 'FINALIZADO',
                fecha_inicio: tratamiento.fecha_inicio_armado,
                fecha_fin: new Date()
            });

            // Recuperar kilos_unidad y convertir a unidades
            const kg = parseFloat(item.kilos_ingresados);
            let kilosUnidad = 1;
            const esArticulo = !!item.articulo_numero;
            
            if (esArticulo) {
                const artQ = await client.query('SELECT kilos_unidad FROM public.stock_real_consolidado WHERE articulo_numero = $1', [item.articulo_numero]);
                if (artQ.rows.length > 0 && artQ.rows[0].kilos_unidad) {
                    kilosUnidad = parseFloat(artQ.rows[0].kilos_unidad);
                }
            }
            const cantidadEnUnidades = kg / kilosUnidad;

            // --- VIGÍA DE AUDITORÍA QA ---
            console.log(`\n============== [QA VIGIA] REINGRESO (BOLSA #${id}) ==============`);
            console.log(`| ITEM TIPO    : ${esArticulo ? 'ARTICULO COMERCIAL' : 'INGREDIENTE (GRANEL)'}`);
            console.log(`| ID DETECTADO : ${item.articulo_numero || 'Ing.#: ' + item.ingrediente_id}`);
            console.log(`| BOLSÓN NETO  : ${kg} kg`);
            if (esArticulo) {
                console.log(`| MAPEO        : División Comercial -> DIVISOR: ${kilosUnidad}`);
                console.log(`| UNIDADES     : ${cantidadEnUnidades.toFixed(2)} (A grilla Mantenimiento)`);
            } else {
                console.log(`| MAPEO        : Ingrediente -> Sin conversión. Proporción 1:1`);
                console.log(`| KILOS        : ${cantidadEnUnidades.toFixed(2)} (A grilla Mantenimiento)`);
            }
            console.log(`| ESTÁTICO BD  : ${esArticulo ? 'Suma comercial aprobada en código' : '⚠ ¡ALERTA! El backend NO está actualizando la tabla global ING.'}`);
            console.log(`=================================================================\n`);

            // 3.1 Insertar el nuevo movimiento de RETORNO en Mantenimiento (Quinto Flujo)
            await client.query(`
                INSERT INTO public.mantenimiento_movimientos
                (articulo_numero, ingrediente_id, id_presupuesto_origen, id_orden_tratamiento, cantidad, usuario, tipo_movimiento, estado, observaciones, historial_tratamientos)
                VALUES ($1, $2, $3, $4, $5, $6, 'RETORNO_TRATAMIENTO', 'PENDIENTE', $7, $8::jsonb)
            `, [
                item.articulo_numero, 
                item.ingrediente_id || null,
                idPresupuestoOrigen, 
                idOrdenTratamiento,
                cantidadEnUnidades, 
                usuario, 
                `[RETORNO TRATAMIENTO #${id}] ` + obsOriginal,
                JSON.stringify(historyArray)
            ]);

            // 3.2 NUEVO MODELO 1:1 - Cierre de Bulto Original (Desactivando visual)
            if (item.id_movimiento_origen) {
                await client.query(`
                    UPDATE public.mantenimiento_movimientos
                    SET estado = 'FINALIZADO',
                        observaciones = CONCAT(COALESCE(observaciones, ''), ' -> Tratamiento concluido. Bulto Retornado a Mesa.')
                    WHERE id = $1
                `, [item.id_movimiento_origen]);
            }

            // 3.3 Devolver el stock a mantenimiento consolidado
            if (item.articulo_numero) {
                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET stock_mantenimiento = stock_mantenimiento + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [cantidadEnUnidades, item.articulo_numero]);
            }

            kilosDevueltosTotales += kg;
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Tratamiento finalizado. ${kilosDevueltosTotales} kg retornados a Cuarentena.` });

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al finalizar tratamiento:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (client) client.release();
    }
};

const limpiarRegistroAdministrativo = async (req, res) => {
    const client = await pool.connect();
    try {
        const { movimiento_id } = req.body;
        if (!movimiento_id) throw new Error('ID de movimiento no proporcionado.');
        
        await cleanUpMaintenanceRecord(client, movimiento_id, "Administrativa Manual");
        
        res.json({ success: true, message: 'Registro ocultado exitosamente de la interfaz de activos.' });
    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error en limpieza administrativa:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

const retornoALogistica = async (req, res) => {
    const client = await pool.connect();
    try {
        const { movimiento_id, id_orden_tratamiento } = req.body;
        if (!movimiento_id || !id_orden_tratamiento) throw new Error('Parámetros incompletos. Se requiere ID de Movimiento y ID de Orden de Tratamiento.');

        await client.query('BEGIN');

        // 1. Cerrar el ciclo en Mantenimiento visualmente
        await client.query(`
            UPDATE public.mantenimiento_movimientos
            SET estado = 'FINALIZADO',
                observaciones = COALESCE(observaciones, '') || ' -> [Devuelto a Logística]'
            WHERE id = $1 AND estado != 'FINALIZADO'
        `, [movimiento_id]);

        // 2. Impactar atómicamente en Logística para reencolar el ruteo
        const logisticaUpdate = await client.query(`
            UPDATE public.ordenes_tratamiento
            SET id_ruta = NULL,
                estado_logistico = 'PENDIENTE_CLIENTE',
                estado_tratamiento = 'COMPLETADO',
                orden_entrega = 999
            WHERE id = $1
            RETURNING id
        `, [id_orden_tratamiento]);

        if (logisticaUpdate.rowCount === 0) {
            throw new Error(`La Orden de Tratamiento #${id_orden_tratamiento} no se pudo restaurar en Logística. Verifica integridad.`);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'La orden ha sido enviada exitosamente a Pendientes de Logística.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO] Error en retorno a logística:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

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
    emitirNotaCreditoBorrador,
    getRetirosLocal,
    getRetirosRuta,
    recibirRetiroLocal,
    revertirIngresoLocal,
    trasladoVentas,
    trasladoIngredientes,
    anularTraslado,
    anularTrasladoAgrupado,
    retornarIngrediente,
    iniciarTratamiento,
    anularTratamiento,
    getTratamientosActivos,
    sellarTratamiento,
    abrirTratamiento,
    finalizarTratamiento,
    limpiarRegistroAdministrativo,
    retornoALogistica
};
