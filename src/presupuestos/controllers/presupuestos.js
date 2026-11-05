console.log('🔍 [PRESUPUESTOS] Cargando controlador de presupuestos...');

/**
 * Resuelve un presupuesto por ID o id_presupuesto_ext
 * @param {Object} client - Cliente de PostgreSQL
 * @param {string} idParam - ID del parámetro (numérico o string)
 * @returns {Object|null} Registro del presupuesto o null si no existe
 */
async function resolvePresupuesto(client, idParam) {
    // Si es todo dígitos, lo tratamos como id (integer); si no, como ext
    const isNumeric = /^\d+$/.test(idParam);
    const { rows } = await client.query(
        `SELECT id, id_presupuesto_ext
       FROM public.presupuestos
      WHERE ${isNumeric ? 'id = $1' : 'id_presupuesto_ext = $1'}
      LIMIT 1`,
        [isNumeric ? Number(idParam) : idParam]
    );
    return rows[0] || null;
}

/**
 * Función auxiliar para analizar datos de fechas
 * Extrae tipos, formatos y fechas futuras de un array de filas
 * @param {Array} rows - Filas con campo fecha_registro
 * @returns {Object} Objeto con tiposDetectados, formatosDetectados, fechasFuturas, ejemplosFechasFuturas
 */
function analyzeDateData(rows) {
    const tiposDetectados = new Set();
    const formatosDetectados = new Set();
    const fechasFuturas = [];
    const ahora = new Date();
    const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());

    rows.forEach(row => {
        const fechaValue = row.fecha_registro;
        if (!fechaValue) return;

        const tipoDetectado = typeof fechaValue;
        tiposDetectados.add(tipoDetectado);

        // Detectar formato específico
        if (fechaValue instanceof Date) {
            formatosDetectados.add('Date object');
        } else if (typeof fechaValue === 'string') {
            if (fechaValue.includes('T') && fechaValue.includes('Z')) {
                formatosDetectados.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
            } else if (fechaValue.includes('T')) {
                formatosDetectados.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
            } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                formatosDetectados.add('YYYY-MM-DD (solo fecha)');
            } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                formatosDetectados.add('DD/MM/YYYY');
            } else {
                formatosDetectados.add('Otro formato string');
            }
        } else if (typeof fechaValue === 'number') {
            formatosDetectados.add('Timestamp numérico');
        }

        // Detectar fechas futuras (más de 1 año)
        const fechaObj = new Date(fechaValue);
        if (fechaObj > unAñoFuturo) {
            fechasFuturas.push({ id: row.id, fecha: fechaValue, fechaObj });
        }
    });

    return {
        tiposDetectados: Array.from(tiposDetectados),
        formatosDetectados: Array.from(formatosDetectados),
        fechasFuturas: fechasFuturas.length,
        ejemplosFechasFuturas: fechasFuturas.slice(0, 5)
    };
}

/**
 * Controlador principal para la gestión de presupuestos
 * Maneja la lógica de negocio del módulo con CRUD completo
 */

/**
 * Obtener todos los presupuestos con filtros avanzados
 */
const obtenerPresupuestos = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Iniciando obtención de presupuestos...');

        // Extraer parámetros de filtrado y paginación - Filtro cliente + Typeahead + Fechas + Estado – 2024-12-19
        const {
            categoria,
            concepto,
            fecha_desde,
            fecha_hasta,
            monto_min,
            monto_max,
            sheet_id,
            // Nuevos parámetros de filtro de cliente
            clienteId,
            cliente_id, // Añadimos compatibilidad con llamadas legacy front-end
            clienteName,
            presupuestoId, // Nuevo filtro por PK numérica
            articulo, // Nuevo filtro por artículo (búsqueda universal LAMDA)
            articulo_search,
            // Nuevo parámetro de filtro por estado
            estado,
            // Nuevos filtros modernos: Canal Origen (Portal B2B vs Local) y Canal Facturación
            canal_origen,
            canal_facturacion,
            // Parámetros de paginación nuevos
            page = 1,
            pageSize = 100,
            sortBy = 'fecha',
            order = 'desc',
            // Parámetros legacy para compatibilidad
            limit,
            offset,
            order_by,
            order_dir,
            // Nuevo parámetro para excluir estados y categorías
            estado_exclude,
            categoria_exclude,
            // Parámetro específico para ocultar Documentos (Ej: Orden de Retiro)
            excluir_tipo
        } = req.query;

        // Validamos cual parámetro de cliente prevalece
        const finalClienteId = clienteId || cliente_id;
        const finalArticulo = articulo || articulo_search;

        // Convertir parámetros de paginación nueva a formato interno
        const currentPage = parseInt(page);
        const itemsPerPage = parseInt(pageSize);
        const calculatedOffset = (currentPage - 1) * itemsPerPage;
        const calculatedLimit = itemsPerPage;

        // Usar parámetros nuevos o legacy para compatibilidad
        const finalLimit = limit ? parseInt(limit) : calculatedLimit;
        const finalOffset = offset !== undefined ? parseInt(offset) : calculatedOffset;
        const finalSortBy = sortBy || order_by || 'fecha';
        const finalOrder = order || order_dir || 'desc';

        console.log('📋 [PRESUPUESTOS] Filtros aplicados:', {
            categoria, concepto, finalClienteId, clienteName, finalArticulo, estado, fecha_desde, fecha_hasta,
            monto_min, monto_max, sheet_id,
            page: currentPage, pageSize: itemsPerPage, sortBy: finalSortBy, order: finalOrder
        });

        // Construir consulta dinámica con JOIN a clientes según relaciones confirmadas - 2024-12-19
        let query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                CASE 
                    WHEN p.tipo_comprobante = 'Orden de Retiro' THEN 'Orden de Retiro'
                    WHEN p.estado IN ('Orden de Retiro', 'Retirado', 'Pendiente de Retiro', 'Recibido', 'En Auditoría', 'Conciliado') THEN 'Orden de Retiro'
                    ELSE p.tipo_comprobante 
                END as categoria,
                c.condicion_iva,
                p.id_cliente as cliente_id,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto,
                COALESCE((
                    SELECT ROUND(SUM( 
                        (d.cantidad * COALESCE(d.precio1, d.valor1 * (1 + COALESCE(d.camp2, 0.21)), 0)) 
                        * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END) - (COALESCE(d.descuento_adicional, 0) / 100.0))
                    ), 2)
                    FROM public.presupuestos_detalles d 
                    WHERE d.id_presupuesto = p.id
                ), 0) as total_final,
                (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) ELSE COALESCE(p.descuento, 0) * 100 END) as descuento,
                p.nota,
                0 as monto,
                p.fecha as fecha_registro,
                p.activo,
                p.estado,
                p.estado_logistico,
                p.agente,
                EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')) as esta_facturado,
                (
                    SELECT CASE 
                        WHEN f.estado = 'APROBADA' THEN 'ARCA'
                        WHEN f.estado = 'APROBADA_LOCAL' THEN 'LOCAL'
                        ELSE 'LOCAL'
                    END
                    FROM public.factura_facturas f 
                    WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    LIMIT 1
                ) as origen_factura_canal,
                (draft.last_draft_id IS NOT NULL) as tiene_borrador,
                draft.last_draft_id as id_borrador,
                (COALESCE(p.fecha_actualizacion, p.fecha) > draft.draft_date) as borrador_desincronizado,
                p.comprobante_lomasoft,
                p.origen_facturacion,
                p.origen_punto_venta,
                p.origen_numero_factura,
                p.modificado_portal,
                (
                    SELECT f.id FROM public.factura_facturas f
                    WHERE (f.presupuesto_id = p.id OR f.presupuesto_id = (CASE WHEN p.origen_numero_factura ~ '^[0-9]+$' THEN CAST(p.origen_numero_factura AS INTEGER) ELSE NULL END))
                      AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    LIMIT 1
                ) AS factura_asociada_id
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            LEFT JOIN (
                SELECT presupuesto_id, MAX(id) as last_draft_id, MAX(COALESCE(updated_at, created_at)) as draft_date
                FROM public.factura_facturas
                WHERE cae IS NULL AND estado IN ('BORRADOR', 'PENDIENTE_FACTURACION')
                GROUP BY presupuesto_id
            ) draft ON draft.presupuesto_id = p.id
            WHERE p.activo = true AND (p.archivado IS NULL OR p.archivado = false)
        `;

        const params = [];
        let paramCount = 0;

        // Aplicar filtros dinámicos
        if (categoria) {
            if (categoria === 'Orden de Retiro') {
                query += ` AND (p.tipo_comprobante = 'Orden de Retiro' OR p.estado IN ('Orden de Retiro', 'Retirado', 'Pendiente de Retiro', 'Recibido', 'En Auditoría', 'Conciliado'))`;
            } else {
                paramCount++;
                query += ` AND LOWER(p.tipo_comprobante) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }
        }

        if (categoria_exclude) {
            if (categoria_exclude === 'Orden de Retiro') {
                query += ` AND (p.tipo_comprobante != 'Orden de Retiro' AND p.estado NOT IN ('Orden de Retiro', 'Retirado', 'Pendiente de Retiro', 'Recibido', 'En Auditoría', 'Conciliado'))`;
            } else {
                paramCount++;
                query += ` AND LOWER(p.tipo_comprobante) NOT LIKE LOWER($${paramCount})`;
                params.push(`%${categoria_exclude}%`);
            }
        }

        // Filtro de cliente mejorado - Filtro cliente + Typeahead + Fechas – 2024-12-19
        if (finalClienteId) {
            // Filtro por ID de cliente exacto (número de 3 cifras)
            paramCount++;
            query += ` AND c.cliente_id = $${paramCount}`;
            params.push(parseInt(finalClienteId));
        } else if (clienteName) {
            // Filtro por nombre/apellido/razon_social del cliente
            paramCount++;
            query += ` AND LOWER(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '') || ' ' || COALESCE(c.otros, '') || ' ' || COALESCE(c.razon_social, '')) LIKE LOWER($${paramCount})`;
            params.push(`%${clienteName}%`);
        } else if (concepto) {
            // Filtro legacy por concepto (mantener compatibilidad)
            paramCount++;
            query += ` AND (LOWER(c.nombre) LIKE LOWER($${paramCount}) OR LOWER(c.apellido) LIKE LOWER($${paramCount}) OR LOWER(c.otros) LIKE LOWER($${paramCount}))`;
            params.push(`%${concepto}%`);
        }

        if (fecha_desde) {
            paramCount++;
            query += ` AND p.fecha >= $${paramCount}`;
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            paramCount++;
            query += ` AND p.fecha <= $${paramCount}`;
            params.push(fecha_hasta);
        }

        if (monto_min) {
            paramCount++;
            query += ` AND 0 >= $${paramCount}`;
            params.push(parseFloat(monto_min));
        }

        if (monto_max) {
            paramCount++;
            query += ` AND 0 <= $${paramCount}`;
            params.push(parseFloat(monto_max));
        }

        if (sheet_id) {
            paramCount++;
            query += ` AND p.id_presupuesto_ext = $${paramCount}`;
            params.push(sheet_id);
        }

        if (presupuestoId) {
            paramCount++;
            query += ` AND p.id = $${paramCount}`;
            params.push(parseInt(presupuestoId));
        }

        // Filtro por Canal / Origen (Portal B2B vs Local)
        if (canal_origen) {
            if (canal_origen === 'portal') {
                query += ` AND (p.agente = 'Portal B2B' OR p.modificado_portal = true)`;
            } else if (canal_origen === 'local') {
                query += ` AND (COALESCE(p.agente, '') != 'Portal B2B' AND (p.modificado_portal IS NULL OR p.modificado_portal = false))`;
            }
        }

        // Filtro por Estado / Canal de Facturación
        if (canal_facturacion) {
            if (canal_facturacion === 'arca') {
                query += ` AND (EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado = 'APROBADA') OR p.origen_facturacion IN ('AFIP/ARCA', 'LAMDA'))`;
            } else if (canal_facturacion === 'local') {
                query += ` AND (EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado = 'APROBADA_LOCAL') OR p.origen_facturacion = 'LAMDA INTERNO')`;
            } else if (canal_facturacion === 'pendiente') {
                query += ` AND NOT EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')) AND (p.origen_facturacion IS NULL OR p.origen_facturacion = 'PENDIENTE') AND (p.comprobante_lomasoft IS NULL OR TRIM(p.comprobante_lomasoft) = '')`;
            } else if (canal_facturacion === 'lomasoft') {
                query += ` AND ((p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '') OR p.origen_facturacion = 'LOMASOFT')`;
            }
        }

        // Filtro acumulativo por artículo (Universal Search LAMDA: AND por cada término separado por espacios)
        if (finalArticulo && typeof finalArticulo === 'string' && finalArticulo.trim().length > 0) {
            const terminos = finalArticulo.trim().toLowerCase().split(/\s+/).filter(Boolean);
            if (terminos.length > 0) {
                const subCondiciones = [];
                terminos.forEach(term => {
                    paramCount++;
                    subCondiciones.push(`LOWER(COALESCE(vpd.descripcion, '') || ' ' || COALESCE(vpd.articulo, '') || ' ' || COALESCE(vpd.articulo_numero, '')) LIKE $${paramCount}`);
                    params.push(`%${term}%`);
                });

                query += ` AND EXISTS (
                    SELECT 1 
                    FROM public.v_presupuestos_detalles_resueltos vpd
                    WHERE vpd.id_presupuesto = p.id
                      AND ${subCondiciones.join(' AND ')}
                )`;
            }
        }

        // Filtro por estado - Filtro por Estado – 2024-12-19
        if (estado) {
            // Soportar múltiples estados (array o string separado por comas)
            let estadosArray = [];
            if (Array.isArray(estado)) {
                estadosArray = estado;
            } else if (typeof estado === 'string') {
                estadosArray = estado.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }

            if (estadosArray.length > 0) {
                // QA Bugfix 2: Estado 'Facturado' comprensivo
                const includesFacturado = estadosArray.some(e => e.toUpperCase() === 'FACTURADO');
                const realStates = estadosArray.filter(e => e.toUpperCase() !== 'FACTURADO');

                let stateConditions = [];

                if (realStates.length > 0) {
                    const placeholders = realStates.map((_, index) => `$${paramCount + index + 1}`).join(', ');
                    paramCount += realStates.length;
                    stateConditions.push(`UPPER(TRIM(p.estado)) IN (SELECT UPPER(UNNEST(ARRAY[${placeholders}]::text[])))`);
                    params.push(...realStates);
                }

                if (includesFacturado) {
                    stateConditions.push(`(
                        UPPER(TRIM(p.estado)) = 'FACTURADO'
                        OR EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL'))
                        OR (p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '')
                        OR p.origen_facturacion IN ('AFIP/ARCA', 'LAMDA INTERNO', 'LAMDA')
                    )`);
                }

                if (stateConditions.length > 0) {
                    query += ` AND (${stateConditions.join(' OR ')})`;
                }

                console.log(`🔍 [PRESUPUESTOS] Ruta GET / - Filtro estado procesado: [${estadosArray.join(', ')}]`);
            }
        }

        // Nuevo: Excluir estados específicos (para separar Ventas de Retiros)
        if (estado_exclude) {
            let estadosExcludeArray = [];
            if (Array.isArray(estado_exclude)) {
                estadosExcludeArray = estado_exclude;
            } else if (typeof estado_exclude === 'string') {
                estadosExcludeArray = estado_exclude.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }

            if (estadosExcludeArray.length > 0) {
                const excludePlaceholders = estadosExcludeArray.map((_, index) => `$${paramCount + index + 1}`).join(', ');
                paramCount += estadosExcludeArray.length;
                query += ` AND p.estado NOT IN (${excludePlaceholders})`;
                params.push(...estadosExcludeArray);

                console.log(`🔍 [PRESUPUESTOS] Ruta GET / - Excluyendo estados: [${estadosExcludeArray.join(', ')}]`);
            }
        }

        // Nuevo: Excluir tipos de comprobante (para ocultar Órdenes de Retiro en vinculaciones directas)
        if (excluir_tipo) {
            let tiposExcludeArray = [];
            if (Array.isArray(excluir_tipo)) {
                tiposExcludeArray = excluir_tipo;
            } else if (typeof excluir_tipo === 'string') {
                tiposExcludeArray = excluir_tipo.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }

            if (tiposExcludeArray.length > 0) {
                const excludePlaceholders = tiposExcludeArray.map((_, index) => `$${paramCount + index + 1}`).join(', ');
                paramCount += tiposExcludeArray.length;
                query += ` AND p.tipo_comprobante NOT IN (${excludePlaceholders})`;
                params.push(...tiposExcludeArray);

                console.log(`🔍 [PRESUPUESTOS] Ruta GET / - Excluyendo tipos: [${tiposExcludeArray.join(', ')}]`);
            }
        }

        // Ordenamiento - Orden por fecha DESC + paginación – 2024-12-19
        const validOrderFields = ['fecha', 'fecha_registro', 'categoria', 'concepto', 'monto'];
        let orderField;
        if (finalSortBy === 'fecha' || finalSortBy === 'fecha_registro') {
            orderField = 'p.fecha';
        } else if (finalSortBy === 'categoria') {
            orderField = 'p.tipo_comprobante';
        } else if (finalSortBy === 'concepto') {
            orderField = 'COALESCE(c.nombre, c.apellido, c.otros)';
        } else if (finalSortBy === 'monto') {
            orderField = '0';
        } else {
            orderField = 'p.fecha'; // Default: ordenar por fecha
        }
        const orderDirection = finalOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Manejo de fecha DATE (YYYY-MM-DD) sin UTC; orden servidor – [YYYY-MM-DD] – 2024-12-19
        query += ` ORDER BY ${orderField} ${orderDirection} NULLS LAST, p.id DESC`;

        // Paginación - Orden por fecha DESC + paginación – 2024-12-19
        if (finalLimit) {
            paramCount++;
            query += ` LIMIT $${paramCount}`;
            params.push(finalLimit);
        }

        if (finalOffset) {
            paramCount++;
            query += ` OFFSET $${paramCount}`;
            params.push(finalOffset);
        }

        console.log('📋 [PRESUPUESTOS] Consulta SQL:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);

        // VIGÍA DEPURADOR: Trámite Administrativo (Modal de vinculación de presupuesto)
        const isAdminNCWatcherActive = estado && (estado.includes('APROBADA') || estado.includes('Conciliado'));
        if (isAdminNCWatcherActive) {
            console.log('\n======================================================');
            console.log('🚨 VIGÍA DEPURADOR: Búsqueda Presupuesto (Trámite Admin NC)');
            console.log('------------------------------------------------------');
            console.log('➡️ Query cruda a DB:\n', query);
            console.log('➡️ Parámetros inyectados:', params);
        }

        const result = await req.db.query(query, params);

        if (isAdminNCWatcherActive) {
            console.log(`➡️ Registros devueltos por DB (crudas): ${result.rows.length}`);
            console.log('➡️ Resultados (primeros 3):', result.rows.slice(0, 3).map(r => ({id: r.id, concepto: r.concepto, estado: r.estado, esta_facturado: r.esta_facturado})));
            console.log('======================================================\n');
        }

        // AUDITORÍA DE FECHAS - Instrumentación completa de logs inteligentes
        const auditoriaDeFechas = process.env.DEBUG_FECHAS === 'true' || req.query.debug_fechas === 'true';

        if (auditoriaDeFechas && result.rows.length > 0) {
            console.log('\n🔍 [AUDITORÍA-FECHAS] ===== PASO 1: LECTURA DESDE BASE DE DATOS =====');

            // Generar ID único para correlacionar logs de toda la solicitud
            const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            console.log(`[AUDITORÍA-FECHAS] Request ID de correlación: ${requestId}`);

            // Análisis de muestra distribuida (máximo 20 registros representativos)
            const totalRegistros = result.rows.length;
            const muestraSize = Math.min(20, totalRegistros);
            const indices = [];

            if (totalRegistros <= 20) {
                // Si hay 20 o menos, tomar todos
                for (let i = 0; i < totalRegistros; i++) indices.push(i);
            } else {
                // Distribuir muestra: primeros 5, últimos 5, y hasta 10 intermedios
                for (let i = 0; i < 5; i++) indices.push(i);
                for (let i = totalRegistros - 5; i < totalRegistros; i++) indices.push(i);
                const step = Math.max(1, Math.floor((totalRegistros - 10) / 10));
                for (let i = 5; i < totalRegistros - 5; i += step) {
                    if (indices.length < 20) indices.push(i);
                }
            }

            // Análisis de la muestra
            const muestraFechas = indices.map(i => result.rows[i]);
            const fechasValidas = muestraFechas.filter(row => row.fecha_registro);

            if (fechasValidas.length > 0) {
                const { tiposDetectados, formatosDetectados, fechasFuturas, ejemplosFechasFuturas } = analyzeDateData(fechasValidas);
                // Ordenar fechas para análisis
                const fechasOrdenadas = fechasValidas
                    .map(row => ({ ...row, fechaObj: new Date(row.fecha_registro) }))
                    .sort((a, b) => a.fechaObj - b.fechaObj);

                const fechaMinima = fechasOrdenadas[0];
                const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];

                // PASO 1: RESUMEN DE LECTURA DESDE BD
                console.log(`[AUDITORÍA-FECHAS] 📊 RESUMEN PASO 1 - LECTURA BD (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Total registros consultados: ${totalRegistros}`);
                console.log(`[AUDITORÍA-FECHAS] - Muestra analizada: ${muestraSize} registros`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha mínima en BD: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha máxima en BD: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Tipos de datos detectados: ${Array.from(tiposDetectados).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Formatos detectados: ${Array.from(formatosDetectados).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Fechas futuras detectadas: ${fechasFuturas.length}`);

                // Ejemplos de fechas futuras (máximo 5)
                if (fechasFuturas.length > 0) {
                    console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS (hasta 5):`);
                    fechasFuturas.slice(0, 5).forEach((item, idx) => {
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                    });
                }

                // Ejemplos representativos de la muestra (máximo 10)
                console.log(`[AUDITORÍA-FECHAS] 📋 EJEMPLOS PASO 1 - VALORES CRUDOS BD (hasta 10):`);
                muestraFechas.slice(0, 10).forEach((row, idx) => {
                    const fechaValue = row.fecha_registro;
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${row.id}, valor_crudo="${fechaValue}", tipo=${typeof fechaValue}, formato_detectado=${fechaValue instanceof Date ? 'Date object' :
                        typeof fechaValue === 'string' && fechaValue.includes('T') ? 'ISO con hora' :
                            typeof fechaValue === 'string' && fechaValue.match(/^\d{4}-\d{2}-\d{2}$/) ? 'YYYY-MM-DD' :
                                'Otro'
                        }`);
                });

                // Guardar datos para correlación con pasos siguientes
                result.auditData = {
                    requestId,
                    paso1: {
                        totalRegistros,
                        muestraSize,
                        fechaMinima: fechaMinima.fecha_registro,
                        fechaMaxima: fechaMaxima.fecha_registro,
                        tiposDetectados: Array.from(tiposDetectados),
                        formatosDetectados: Array.from(formatosDetectados),
                        fechasFuturas: fechasFuturas.length,
                        ejemplosFechasFuturas: fechasFuturas.slice(0, 5)
                    }
                };
            }
        }

        // Consulta para total de registros (sin paginación) - Ajuste según relaciones confirmadas - 2024-12-19
        let countQuery = `
            SELECT COUNT(*) as total
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            WHERE p.activo = true AND (p.archivado IS NULL OR p.archivado = false)
        `;

        // Aplicar mismos filtros para el conteo
        let countParams = [];
        let countParamCount = 0;

        if (categoria) {
            if (categoria === 'Orden de Retiro') {
                countQuery += ` AND (p.tipo_comprobante = 'Orden de Retiro' OR p.estado IN ('Orden de Retiro', 'Retirado', 'Pendiente de Retiro', 'Recibido', 'En Auditoría', 'Conciliado'))`;
            } else {
                countParamCount++;
                countQuery += ` AND LOWER(p.tipo_comprobante) LIKE LOWER($${countParamCount})`;
                countParams.push(`%${categoria}%`);
            }
        }

        if (categoria_exclude) {
            if (categoria_exclude === 'Orden de Retiro') {
                countQuery += ` AND (p.tipo_comprobante != 'Orden de Retiro' AND p.estado NOT IN ('Orden de Retiro', 'Retirado', 'Pendiente de Retiro', 'Recibido', 'En Auditoría', 'Conciliado'))`;
            } else {
                countParamCount++;
                countQuery += ` AND LOWER(p.tipo_comprobante) NOT LIKE LOWER($${countParamCount})`;
                countParams.push(`%${categoria_exclude}%`);
            }
        }

        // Aplicar mismo filtro de cliente para el conteo - Filtro cliente + Typeahead + Fechas – 2024-12-19
        if (finalClienteId) {
            countParamCount++;
            countQuery += ` AND c.cliente_id = $${countParamCount}`;
            countParams.push(parseInt(finalClienteId));
        } else if (clienteName) {
            countParamCount++;
            countQuery += ` AND LOWER(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '') || ' ' || COALESCE(c.otros, '') || ' ' || COALESCE(c.razon_social, '')) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${clienteName}%`);
        } else if (concepto) {
            countParamCount++;
            countQuery += ` AND (LOWER(c.nombre) LIKE LOWER($${countParamCount}) OR LOWER(c.apellido) LIKE LOWER($${countParamCount}) OR LOWER(c.otros) LIKE LOWER($${countParamCount}))`;
            countParams.push(`%${concepto}%`);
        }

        if (fecha_desde) {
            countParamCount++;
            countQuery += ` AND p.fecha >= $${countParamCount}`;
            countParams.push(fecha_desde);
        }

        if (fecha_hasta) {
            countParamCount++;
            countQuery += ` AND p.fecha <= $${countParamCount}`;
            countParams.push(fecha_hasta);
        }

        if (monto_min) {
            countParamCount++;
            countQuery += ` AND 0 >= $${countParamCount}`;
            countParams.push(parseFloat(monto_min));
        }

        if (monto_max) {
            countParamCount++;
            countQuery += ` AND 0 <= $${countParamCount}`;
            countParams.push(parseFloat(monto_max));
        }

        if (sheet_id) {
            countParamCount++;
            countQuery += ` AND p.id_presupuesto_ext = $${countParamCount}`;
            countParams.push(sheet_id);
        }

        if (presupuestoId) {
            countParamCount++;
            countQuery += ` AND p.id = $${countParamCount}`;
            countParams.push(parseInt(presupuestoId));
        }

        // Filtro por Canal / Origen (Portal B2B vs Local) para el conteo
        if (canal_origen) {
            if (canal_origen === 'portal') {
                countQuery += ` AND (p.agente = 'Portal B2B' OR p.modificado_portal = true)`;
            } else if (canal_origen === 'local') {
                countQuery += ` AND (COALESCE(p.agente, '') != 'Portal B2B' AND (p.modificado_portal IS NULL OR p.modificado_portal = false))`;
            }
        }

        // Filtro por Estado / Canal de Facturación para el conteo
        if (canal_facturacion) {
            if (canal_facturacion === 'arca') {
                countQuery += ` AND (EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado = 'APROBADA') OR p.origen_facturacion IN ('AFIP/ARCA', 'LAMDA'))`;
            } else if (canal_facturacion === 'local') {
                countQuery += ` AND (EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado = 'APROBADA_LOCAL') OR p.origen_facturacion = 'LAMDA INTERNO')`;
            } else if (canal_facturacion === 'pendiente') {
                countQuery += ` AND NOT EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')) AND (p.origen_facturacion IS NULL OR p.origen_facturacion = 'PENDIENTE') AND (p.comprobante_lomasoft IS NULL OR TRIM(p.comprobante_lomasoft) = '')`;
            } else if (canal_facturacion === 'lomasoft') {
                countQuery += ` AND ((p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '') OR p.origen_facturacion = 'LOMASOFT')`;
            }
        }

        // Filtro acumulativo por artículo para el conteo
        if (finalArticulo && typeof finalArticulo === 'string' && finalArticulo.trim().length > 0) {
            const terminos = finalArticulo.trim().toLowerCase().split(/\s+/).filter(Boolean);
            if (terminos.length > 0) {
                const subCondiciones = [];
                terminos.forEach(term => {
                    countParamCount++;
                    subCondiciones.push(`LOWER(COALESCE(vpd.descripcion, '') || ' ' || COALESCE(vpd.articulo, '') || ' ' || COALESCE(vpd.articulo_numero, '')) LIKE $${countParamCount}`);
                    countParams.push(`%${term}%`);
                });

                countQuery += ` AND EXISTS (
                    SELECT 1 
                    FROM public.v_presupuestos_detalles_resueltos vpd
                    WHERE vpd.id_presupuesto = p.id
                      AND ${subCondiciones.join(' AND ')}
                )`;
            }
        }

        // Aplicar mismo filtro de estado para el conteo - Filtro por Estado – 2024-12-19
        if (estado) {
            let estadosArray = [];
            if (Array.isArray(estado)) {
                estadosArray = estado;
            } else if (typeof estado === 'string') {
                estadosArray = estado.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }

            if (estadosArray.length > 0) {
                const includesFacturado = estadosArray.some(e => e.toUpperCase() === 'FACTURADO');
                const realStates = estadosArray.filter(e => e.toUpperCase() !== 'FACTURADO');

                let stateConditions = [];

                if (realStates.length > 0) {
                    const placeholders = realStates.map((_, index) => `$${countParamCount + index + 1}`).join(', ');
                    countParamCount += realStates.length;
                    stateConditions.push(`UPPER(TRIM(p.estado)) IN (SELECT UPPER(UNNEST(ARRAY[${placeholders}]::text[])))`);
                    countParams.push(...realStates);
                }

                if (includesFacturado) {
                    stateConditions.push(`(
                        UPPER(TRIM(p.estado)) = 'FACTURADO'
                        OR EXISTS (SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL'))
                        OR (p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '')
                        OR p.origen_facturacion IN ('AFIP/ARCA', 'LAMDA INTERNO', 'LAMDA')
                    )`);
                }

                if (stateConditions.length > 0) {
                    countQuery += ` AND (${stateConditions.join(' OR ')})`;
                }
            }
        }

        // Aplicar exclusión de estados para el conteo
        if (estado_exclude) {
            let estadosExcludeArray = [];
            if (Array.isArray(estado_exclude)) {
                estadosExcludeArray = estado_exclude;
            } else if (typeof estado_exclude === 'string') {
                estadosExcludeArray = estado_exclude.split(',').map(e => e.trim()).filter(e => e.length > 0);
            }

            if (estadosExcludeArray.length > 0) {
                const excludePlaceholders = estadosExcludeArray.map((_, index) => `$${countParamCount + index + 1}`).join(', ');
                countParamCount += estadosExcludeArray.length;
                countQuery += ` AND p.estado NOT IN (${excludePlaceholders})`;
                countParams.push(...estadosExcludeArray);
            }
        }

        const countResult = await req.db.query(countQuery, countParams);
        const totalRecords = parseInt(countResult.rows[0].total);

        console.log(`✅ [PRESUPUESTOS] Presupuestos obtenidos: ${result.rows.length} de ${totalRecords} registros`);

        // Log de categorías encontradas para debugging
        const categorias = [...new Set(result.rows.map(row => row.categoria))];
        console.log('📊 [PRESUPUESTOS] Tipos de comprobante encontrados:', categorias);
        console.log('📊 [PRESUPUESTOS] Muestra de datos:', result.rows.slice(0, 3));

        // AUDITORÍA DE FECHAS - PASO 2: Transformaciones en backend (si las hay)
        if (auditoriaDeFechas && result.auditData) {
            const { requestId } = result.auditData;
            console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 2: TRANSFORMACIONES EN BACKEND (${requestId}) =====`);

            // En este punto, verificamos si hay transformaciones entre la lectura de BD y la preparación para envío
            // Como estamos usando el resultado directo de la BD sin transformaciones adicionales,
            // documentamos que no hay transformaciones en el backend
            console.log(`[AUDITORÍA-FECHAS] 📋 ANÁLISIS PASO 2 - TRANSFORMACIONES BACKEND (${requestId}):`);
            console.log(`[AUDITORÍA-FECHAS] - Motivo: Sin transformaciones - datos enviados tal como se leen de BD`);
            console.log(`[AUDITORÍA-FECHAS] - Proceso: Los valores de fecha se mantienen en su formato original`);
            console.log(`[AUDITORÍA-FECHAS] - Zona horaria: Sin manipulación de zona horaria`);
            console.log(`[AUDITORÍA-FECHAS] - Formateo: Sin formateo adicional aplicado`);
            console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones en el backend`);

            // Actualizar datos de auditoría
            result.auditData.paso2 = {
                transformacionesDetectadas: false,
                motivo: 'Sin transformaciones - datos enviados tal como se leen de BD',
                procesoAplicado: 'Ninguno',
                zonaHoraria: 'Sin manipulación',
                formateoAplicado: 'Ninguno'
            };
        }

        // AUDITORÍA DE FECHAS - PASO 3: Serialización de la API (antes de enviar respuesta)
        if (auditoriaDeFechas && result.rows.length > 0) {
            const requestId = result.auditData?.requestId || 'NO-ID';
            console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 3: SERIALIZACIÓN DE LA API (${requestId}) =====`);

            // Analizar fechas que se van a enviar al frontend
            const fechasParaEnviar = result.rows.filter(row => row.fecha_registro);

            if (fechasParaEnviar.length > 0) {
                // Análisis de muestra para serialización (máximo 10 registros)
                const muestraEnvio = fechasParaEnviar.slice(0, 10);

                const fechasOrdenadas = fechasParaEnviar
                    .map(row => ({ ...row, fechaObj: new Date(row.fecha_registro) }))
                    .sort((a, b) => a.fechaObj - b.fechaObj);

                const fechaMinima = fechasOrdenadas[0];
                const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];

                // Detectar tipos y formatos en la serialización
                const tiposEnvio = new Set();
                const formatosEnvio = new Set();
                const fechasFuturasEnvio = [];
                const ahora = new Date();
                const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());

                fechasParaEnviar.forEach(row => {
                    const fechaValue = row.fecha_registro;
                    const tipoDetectado = typeof fechaValue;
                    tiposEnvio.add(tipoDetectado);

                    // Detectar formato específico en serialización
                    if (fechaValue instanceof Date) {
                        formatosEnvio.add('Date object');
                    } else if (typeof fechaValue === 'string') {
                        if (fechaValue.includes('T') && fechaValue.includes('Z')) {
                            formatosEnvio.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
                        } else if (fechaValue.includes('T')) {
                            formatosEnvio.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
                        } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            formatosEnvio.add('YYYY-MM-DD (solo fecha)');
                        } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                            formatosEnvio.add('DD/MM/YYYY');
                        } else {
                            formatosEnvio.add('Otro formato string');
                        }
                    } else if (typeof fechaValue === 'number') {
                        formatosEnvio.add('Timestamp numérico');
                    }

                    // Detectar fechas futuras en serialización
                    const fechaObj = new Date(fechaValue);
                    if (fechaObj > unAñoFuturo) {
                        fechasFuturasEnvio.push({ id: row.id, fecha: fechaValue, fechaObj });
                    }
                });

                // PASO 3: RESUMEN DE SERIALIZACIÓN API
                console.log(`[AUDITORÍA-FECHAS] 📤 RESUMEN PASO 3 - SERIALIZACIÓN API (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Total registros a enviar: ${result.rows.length}`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha mínima a enviar: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha máxima a enviar: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Tipos en serialización: ${Array.from(tiposEnvio).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Formatos en serialización: ${Array.from(formatosEnvio).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Fechas futuras en serialización: ${fechasFuturasEnvio.length}`);

                // Ejemplos de fechas futuras en serialización (máximo 5)
                if (fechasFuturasEnvio.length > 0) {
                    console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS EN SERIALIZACIÓN (hasta 5):`);
                    fechasFuturasEnvio.slice(0, 5).forEach((item, idx) => {
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura_api="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                    });
                }

                // Ejemplos de lo que se va a enviar (máximo 10)
                console.log(`[AUDITORÍA-FECHAS] 📤 EJEMPLOS PASO 3 - VALORES A ENVIAR (hasta 10):`);
                muestraEnvio.forEach((row, idx) => {
                    const fechaValue = row.fecha_registro;
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${row.id}, valor_a_enviar="${fechaValue}", tipo=${typeof fechaValue}, será_serializado_como=${fechaValue instanceof Date ? 'ISO string por JSON.stringify' :
                        typeof fechaValue === 'string' ? 'string (sin cambios)' :
                            typeof fechaValue === 'number' ? 'number (sin cambios)' :
                                'unknown'
                        }`);
                });

                // Comparar con paso anterior para detectar transformaciones
                const datosAnterior = result.auditData?.paso1;
                if (datosAnterior) {
                    const transformacionDetectada = (
                        tiposEnvio.size !== datosAnterior.tiposDetectados.length ||
                        formatosEnvio.size !== datosAnterior.formatosDetectados.length ||
                        fechasFuturasEnvio.length !== datosAnterior.fechasFuturas
                    );

                    if (transformacionDetectada) {
                        console.log(`[AUDITORÍA-FECHAS] ⚠️ TRANSFORMACIÓN DETECTADA ENTRE PASO 1 Y PASO 3:`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en tipos: ${datosAnterior.tiposDetectados.join(', ')} → ${Array.from(tiposEnvio).join(', ')}`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en formatos: ${datosAnterior.formatosDetectados.join(', ')} → ${Array.from(formatosEnvio).join(', ')}`);
                        console.log(`[AUDITORÍA-FECHAS] - Cambio en fechas futuras: ${datosAnterior.fechasFuturas} → ${fechasFuturasEnvio.length}`);
                    } else {
                        console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones entre Paso 1 y Paso 3`);
                    }
                }

                // Actualizar datos de auditoría para el paso 3
                if (result.auditData) {
                    result.auditData.paso3 = {
                        totalRegistrosEnviar: result.rows.length,
                        fechaMinima: fechaMinima.fecha_registro,
                        fechaMaxima: fechaMaxima.fecha_registro,
                        tiposEnSerializacion: Array.from(tiposEnvio),
                        formatosEnSerializacion: Array.from(formatosEnvio),
                        fechasFuturasEnSerializacion: fechasFuturasEnvio.length,
                        ejemplosFechasFuturas: fechasFuturasEnvio.slice(0, 5)
                    };
                }
            }
        }

        // Respuesta con formato de paginación mejorado - Orden por fecha DESC + paginación – 2024-12-19
        res.json({
            success: true,
            data: result.rows,
            total: totalRecords,
            page: currentPage,
            pageSize: itemsPerPage,
            items: result.rows, // Alias para compatibilidad
            pagination: {
                total: totalRecords,
                page: currentPage,
                pageSize: itemsPerPage,
                pages: Math.ceil(totalRecords / itemsPerPage),
                hasNext: currentPage < Math.ceil(totalRecords / itemsPerPage),
                hasPrev: currentPage > 1,
                // Legacy para compatibilidad
                limit: finalLimit,
                offset: finalOffset
            },
            sorting: {
                sortBy: finalSortBy,
                order: finalOrder
            },
            filters: {
                categoria, concepto, clienteId, clienteName, estado, fecha_desde, fecha_hasta,
                monto_min, monto_max, sheet_id
            },
            categorias: categorias,
            timestamp: new Date().toISOString(),
            // Incluir requestId para correlación con frontend
            ...(auditoriaDeFechas && result.requestId && { auditRequestId: result.requestId })
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuestos:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener sugerencias de clientes para typeahead - Filtro cliente + Typeahead + Fechas – 2024-12-19
 */
const obtenerSugerenciasClientes = async (req, res) => {
    try {
        const qRaw = (req.query.q || '').trim();
        if (!qRaw) {
            return res.json({
                success: true,
                data: [],
                message: 'Query muy corto para sugerencias',
                timestamp: new Date().toISOString()
            });
        }

        const limitParam = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10;

        // ¿Buscan por ID numérico corto?
        if (/^\d{1,6}$/.test(qRaw)) {
            const query = `
        SELECT DISTINCT
          c.cliente_id,
          c.nombre,
          c.apellido,
          c.otros,
          c.condicion_iva,
          COUNT(p.id) AS total_presupuestos
        FROM public.clientes c
        LEFT JOIN public.presupuestos p
          ON p.id_cliente = CAST(c.cliente_id AS text) AND p.activo = true
        WHERE c.cliente_id = $1
        GROUP BY c.cliente_id, c.nombre, c.apellido, c.otros, c.condicion_iva
        ORDER BY total_presupuestos DESC, c.nombre
        LIMIT $2
      `;
            const params = [parseInt(qRaw, 10), limit];

            const result = await req.db.query(query, params);
            const sugerencias = result.rows.map(cliente => ({
                id: cliente.cliente_id,
                text: `${cliente.cliente_id.toString().padStart(3, '0')} — ${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
                nombre: cliente.nombre,
                apellido: cliente.apellido,
                otros: cliente.otros,
                condicion_iva: cliente.condicion_iva,
                total_presupuestos: parseInt(cliente.total_presupuestos)
            }));

            return res.json({
                success: true,
                data: sugerencias,
                query: qRaw,
                total: sugerencias.length,
                timestamp: new Date().toISOString()
            });
        }

        // Texto libre → múltiples términos (AND), buscando en nombre + apellido + otros
        const tokens = qRaw
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

        let p = 0;
        const params = [];
        const andConds = tokens.map(t => {
            p += 1; const ph = `$${p}`; params.push(`%${t}%`);
            return `(LOWER(c.nombre) ILIKE ${ph} OR LOWER(c.apellido) ILIKE ${ph} OR LOWER(c.otros) ILIKE ${ph})`;
        });

        p += 1; params.push(limit);

        const query = `
      SELECT DISTINCT
        c.cliente_id,
        c.nombre,
        c.apellido,
        c.otros,
        c.condicion_iva,
        COUNT(pres.id) AS total_presupuestos
      FROM public.clientes c
      LEFT JOIN public.presupuestos pres
        ON pres.id_cliente = CAST(c.cliente_id AS text) AND pres.activo = true
      WHERE ${andConds.join(' AND ')}
      GROUP BY c.cliente_id, c.nombre, c.apellido, c.otros, c.condicion_iva
      ORDER BY total_presupuestos DESC, c.nombre
      LIMIT $${p}
    `;

        const result = await req.db.query(query, params);

        const sugerencias = result.rows.map(cliente => ({
            id: cliente.cliente_id,
            text: `${cliente.cliente_id.toString().padStart(3, '0')} — ${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
            nombre: cliente.nombre,
            apellido: cliente.apellido,
            otros: cliente.otros,
            condicion_iva: cliente.condicion_iva,
            total_presupuestos: parseInt(cliente.total_presupuestos)
        }));

        return res.json({
            success: true,
            data: sugerencias,
            query: qRaw,
            total: sugerencias.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener sugerencias de clientes:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al obtener sugerencias de clientes',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener sugerencias de artículos para autocompletar en detalles
 */
const obtenerSugerenciasArticulos = async (req, res) => {
    try {
        const qRaw = (req.query.q || '').trim();
        const qClienteRaw = String(req.query.cliente_id || '').trim();
        const qClienteLower = qClienteRaw.toLowerCase();
        const esProspectoQuery = qClienteLower === 'prospecto' || qClienteLower === 'libre';
        let clienteId = parseInt(qClienteRaw, 10);
        if (isNaN(clienteId)) clienteId = 0;
        const isAllRequested = req.query.all === 'true' || req.query.catalogo === 'true' || qRaw === '*' || qRaw.toLowerCase() === 'all';

        if (!qRaw && !isAllRequested) {
            return res.json({
                success: true,
                data: [],
                message: 'Escribí para buscar artículos...',
                timestamp: new Date().toISOString()
            });
        }

        // limit: default 50 (o 3000 para catálogo completo all=true)
        const isAll = (req.query.all === 'true' || req.query.all === '1');
        const limitParam = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 3000) : (isAll ? 3000 : 50);

        // Recuperar Lista de Precios basada en cliente_id
        let lista = 1;

        if (clienteId > 0) {
            try {
                const rLista = await req.db.query('SELECT lista_precios FROM public.clientes WHERE cliente_id = $1 LIMIT 1', [clienteId]);
                if (rLista.rows.length) {
                    const n = parseInt(rLista.rows[0].lista_precios, 10);
                    if (Number.isFinite(n) && n >= 1 && n <= 5) lista = n;
                }
            } catch (e) {
                console.warn('[PRESUPUESTOS] Error al leer lista_precios en sugerencias móviles:', e.message);
            }
        }

        const colPrecio = 
            lista === 1 ? 'pa.precio_neg' :
            lista === 2 ? 'pa.mayorista' :
            lista === 3 ? 'pa.especial_brus' :
            lista === 4 ? 'pa.consumidor_final' :
            lista === 5 ? 'pa.lista_5' : 'pa.precio_neg';

        // Tokenización (múltiples palabras)
        const tokens = (!isAllRequested && qRaw) ? qRaw
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .split(/\s+/)
            .map(t => t.replace(/#/g, '').trim())
            .filter(Boolean) : [];

        // Si parece código de barras (solo dígitos 8–14), lo priorizamos como igualdad exacta
        const isBarcode = /^\d{8,14}$/.test(qRaw);

        // Si no se especifica, y clienteId > 0 o se especifica lista_id o es prospecto, usar precios Bunker por defecto
        const usarBunker = req.query.usar_precios_bunker !== 'false' && (clienteId > 0 || !!req.query.lista_id || !!req.query.lista_bunker_id || esProspectoQuery || qClienteRaw.length > 0);

        let listaBunkerId = (req.query.lista_id || req.query.lista_bunker_id) ? parseInt(req.query.lista_id || req.query.lista_bunker_id, 10) : null;
        if (usarBunker && !listaBunkerId) {
            if (!esProspectoQuery && (clienteId > 0 || qClienteRaw.length > 0)) {
                const clientPId = String(clienteId > 0 ? clienteId : qClienteRaw).padStart(4, '0');
                const clientRawId = qClienteRaw;
                const clientIntId = clienteId > 0 ? clienteId : null;

                try {
                    // 1. Buscar lista asignada específicamente en bunker_cliente_listas_precios
                    const rBunkerList = await req.db.query(`
                        SELECT bclp.bunker_lista_precio_id
                        FROM public.bunker_clientes bc
                        INNER JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
                        WHERE bc.codigo_bunker_cliente ILIKE $1
                           OR bc.lomas_soft_id = $1
                           OR bc.lomas_soft_id = $2 
                           OR ($3::integer IS NOT NULL AND bc.id = $3::integer)
                        LIMIT 1
                    `, [clientRawId, clientPId, clientIntId]);

                    if (rBunkerList.rows.length && rBunkerList.rows[0].bunker_lista_precio_id) {
                        listaBunkerId = parseInt(rBunkerList.rows[0].bunker_lista_precio_id, 10);
                    }
                } catch (e) {
                    console.warn('[PRESUPUESTOS] Error buscando lista bunker personalizada:', e.message);
                }

                // 2. Si no tiene lista bunker personalizada, mapear según lista_precios del cliente o fallback a Dietética (5)
                if (!listaBunkerId) {
                    if (lista === 4) listaBunkerId = 6; // Consumidor Final
                    else if (lista === 2) listaBunkerId = 2; // Mayorista
                    else if (lista === 3) listaBunkerId = 7; // Gastronómicos
                    else if (lista === 1) listaBunkerId = 1; // Lista Nico
                    else listaBunkerId = 5; // Dietética por defecto
                }
            } else {
                listaBunkerId = 5; // Dietética por defecto para consultas libres / prospectos
            }
        }

        // Armado dinámico del WHERE con placeholders (incluye atributos completos, silenciosos y taxonomía)
        const fields = usarBunker
            ? [
                'COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion)',
                'bla.articulo_numero',
                'COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero)',
                'CAST(ba.propiedades_dinamicas AS TEXT)',
                'COALESCE(bf.nombre, \'\')',
                'COALESCE(ba.rubro, \'\')',
                'COALESCE(ba.sub_rubro, \'\')',
                'COALESCE(src.descripcion, \'\')'
              ]
            : [
                'src.descripcion', 
                'src.articulo_numero', 
                'src.codigo_barras',
                'CAST(ba.propiedades_dinamicas AS TEXT)',
                'COALESCE(ba.rubro, \'\')',
                'COALESCE(ba.sub_rubro, \'\')'
              ];

        const whereParts = [];
        const params = [];
        let p = 0;

        if (isBarcode) {
            p += 1;
            const barcodeField = usarBunker ? 'COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero)' : 'src.codigo_barras';
            whereParts.push(`${barcodeField} = $${p}`);
            params.push(qRaw);
        }

        if (tokens.length) {
            const andGroup = tokens.map(t => {
                p += 1;
                const ph = `$${p}`;
                params.push(`%${t}%`);
                return `(${fields.map(f => `${f} ILIKE ${ph}`).join(' OR ')})`;
            });
            if (isBarcode) {
                whereParts.push(`(${andGroup.join(' AND ')})`);
            } else {
                whereParts.push(...andGroup);
            }
        }

        let whereClause = '';
        if (whereParts.length > 0) {
            whereClause = isBarcode
                ? `WHERE (${whereParts[0]}) OR (${whereParts.slice(1).join(' AND ') || 'FALSE'})`
                : `WHERE ${whereParts.join(' AND ')}`;
        }

        let sql;

        const cteReservas = `
      WITH reservas_crudas AS (
        SELECT
          COALESCE(src_res.articulo_numero, ba_res.articulo_id, pd.articulo) AS articulo_numero,
          SUM(pd.cantidad) AS cantidad_reservada
        FROM public.presupuestos_detalles pd
        JOIN public.presupuestos p ON p.id = pd.id_presupuesto
        LEFT JOIN public.stock_real_consolidado src_res ON (src_res.articulo_numero = pd.articulo OR src_res.codigo_barras = pd.articulo)
        LEFT JOIN public.bunker_articulos ba_res ON (ba_res.articulo_id = pd.articulo)
        WHERE p.activo = true
          AND COALESCE(p.archivado, false) = false
          AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
          AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
          AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
          AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
          AND p.factura_id IS NULL
          AND p.id_factura_lomasoft IS NULL
          AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
        GROUP BY COALESCE(src_res.articulo_numero, ba_res.articulo_id, pd.articulo)
      )
        `;

        if (usarBunker) {
            p += 1;
            params.push(listaBunkerId);
            const pListaBunkerId = p;

            whereClause += (whereClause ? ' AND ' : 'WHERE ') + `bla.lista_id = $${pListaBunkerId} AND COALESCE(bla.disponible, false) = true AND COALESCE(bla.precio_final, 0) > 0`;

            sql = `
      ${cteReservas}
      SELECT
        COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero) AS codigo_barras,
        COALESCE(ba.articulo_id, src.articulo_numero, bla.articulo_numero) AS articulo_numero,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion) AS descripcion,
        -- Stock Físico (Consolidado)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(src.pack_unidades, ba.pack_unidades, 1))
          ELSE
            COALESCE(src.stock_consolidado, 0)
        END AS stock_fisico,
        -- Stock Reservado (en pedidos activos)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)::numeric)
          ELSE
            COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
        END AS stock_reservado,
        -- Stock Disponible Real
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
            FLOOR(
              GREATEST(0, 
                COALESCE(src_hijo.stock_consolidado, 0) - (
                  COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                )
              ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
            )
          ELSE
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
        END AS stock_disponible,
        -- Stock consolidado (disponible para retrocompatibilidad)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
            FLOOR(
              GREATEST(0, 
                COALESCE(src_hijo.stock_consolidado, 0) - (
                  COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                )
              ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
            )
          ELSE
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
        END AS stock_consolidado,
        COALESCE(bla.precio_final / (1 + COALESCE(bla.iva, ba.porcentaje_iva, 21) / 100.0), 0) AS precio_venta,
        COALESCE(bla.precio_final, 0) AS precio_final,
        COALESCE(bla.iva, ba.porcentaje_iva, 21) AS iva,
        COALESCE(ba.kilos_unidad, src.kilos_unidad, 1.0) AS kilos_unidad,
        COALESCE(src.es_pack, ba.es_pack, false) AS es_pack,
        COALESCE(src.pack_unidades, ba.pack_unidades, 1) AS pack_unidades,
        COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) AS pack_hijo_codigo,
        ba.familia_id,
        ba.rubro,
        ba.sub_rubro,
        bf.nombre AS familia_nombre,
        ba.propiedades_dinamicas AS propiedades_dinamicas,
        src.descripcion AS descripcion_legacy
      FROM public.bunker_lista_articulos bla
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
      LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
      LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = bla.articulo_numero OR src.codigo_barras = bla.articulo_numero)
      LEFT JOIN public.stock_real_consolidado src_sub ON (
          src_sub.articulo_numero = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)
          OR src_sub.codigo_barras = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)
      )
      LEFT JOIN LATERAL (
          SELECT src_sub.stock_consolidado, src_sub.articulo_numero
          LIMIT 1
      ) src_hijo ON true
      LEFT JOIN reservas_crudas res_art ON (res_art.articulo_numero = COALESCE(ba.articulo_id, src.articulo_numero, bla.articulo_numero))
      LEFT JOIN reservas_crudas res_hijo ON (res_hijo.articulo_numero = src_hijo.articulo_numero)
      LEFT JOIN LATERAL (
          SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
          FROM public.bunker_articulos bp
          JOIN reservas_crudas rc_padre ON rc_padre.articulo_numero = bp.articulo_id
          WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
            AND (bp.pack_hijo_codigo = COALESCE(ba.articulo_id, src.articulo_numero, bla.articulo_numero)
                 OR bp.pack_hijo_codigo = COALESCE(src.codigo_barras, ba.articulo_id, bla.articulo_numero))
      ) res_padres ON true
      ${whereClause}
      ORDER BY
        CASE
          WHEN (
            CASE
              WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
                   AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
              THEN
                GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                FLOOR(
                  GREATEST(0, 
                    COALESCE(src_hijo.stock_consolidado, 0) - (
                      COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                    )
                  ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
                )
              ELSE
                GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
            END
          ) > 0 THEN 0 ELSE 1 END ASC,
        COALESCE(ba.descripcion_generada, ba.descripcion, src.descripcion) ASC
      LIMIT $${p + 1}
    `;
        } else {
            sql = `
      ${cteReservas}
      SELECT
        src.codigo_barras,
        src.articulo_numero,
        src.descripcion,
        -- Stock Físico (Consolidado)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(src.pack_unidades, ba.pack_unidades, 1))
          ELSE
            COALESCE(src.stock_consolidado, 0)
        END AS stock_fisico,
        -- Stock Reservado (en pedidos activos)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)::numeric)
          ELSE
            COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
        END AS stock_reservado,
        -- Stock Disponible Real
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
            FLOOR(
              GREATEST(0, 
                COALESCE(src_hijo.stock_consolidado, 0) - (
                  COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                )
              ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
            )
          ELSE
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
        END AS stock_disponible,
        -- Stock consolidado (disponible para retrocompatibilidad)
        CASE
          WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
               AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
          THEN
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
            FLOOR(
              GREATEST(0, 
                COALESCE(src_hijo.stock_consolidado, 0) - (
                  COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                )
              ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
            )
          ELSE
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
        END AS stock_consolidado,
        COALESCE(${colPrecio}, 0) AS precio_venta,
        COALESCE(pa.iva, 21) AS iva,
        COALESCE(src.kilos_unidad, 1.0) AS kilos_unidad,
        COALESCE(src.es_pack, ba.es_pack, false) AS es_pack,
        COALESCE(src.pack_unidades, ba.pack_unidades, 1) AS pack_unidades,
        COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) AS pack_hijo_codigo,
        ba.familia_id,
        ba.rubro,
        ba.sub_rubro,
        ba.propiedades_dinamicas AS propiedades_dinamicas,
        src.descripcion AS descripcion_legacy
      FROM public.stock_real_consolidado src
      LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(src.descripcion)
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = src.articulo_numero
      LEFT JOIN public.stock_real_consolidado src_sub ON (
          src_sub.articulo_numero = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)
          OR src_sub.codigo_barras = COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo)
      )
      LEFT JOIN LATERAL (
          SELECT src_sub.stock_consolidado, src_sub.articulo_numero
          LIMIT 1
      ) src_hijo ON true
      LEFT JOIN reservas_crudas res_art ON (res_art.articulo_numero = COALESCE(ba.articulo_id, src.articulo_numero))
      LEFT JOIN reservas_crudas res_hijo ON (res_hijo.articulo_numero = src_hijo.articulo_numero)
      LEFT JOIN LATERAL (
          SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
          FROM public.bunker_articulos bp
          JOIN reservas_crudas rc_padre ON rc_padre.articulo_numero = bp.articulo_id
          WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
            AND (bp.pack_hijo_codigo = COALESCE(ba.articulo_id, src.articulo_numero)
                 OR bp.pack_hijo_codigo = src.codigo_barras)
      ) res_padres ON true
      ${whereClause}
      ORDER BY
        CASE
          WHEN (
            CASE
              WHEN (COALESCE(src.es_pack, ba.es_pack, false) = true OR COALESCE(src.pack_hijo_codigo, ba.pack_hijo_codigo) IS NOT NULL)
                   AND COALESCE(src.pack_unidades, ba.pack_unidades, 1) > 1
              THEN
                GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                FLOOR(
                  GREATEST(0, 
                    COALESCE(src_hijo.stock_consolidado, 0) - (
                      COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(src.pack_unidades, ba.pack_unidades, 1))
                    )
                  ) / COALESCE(src.pack_unidades, ba.pack_unidades, 1)
                )
              ELSE
                GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
            END
          ) > 0 THEN 0 ELSE 1 END ASC,
        src.descripcion ASC
      LIMIT $${p + 1}
    `;
        }
        params.push(limit);

        const result = await req.db.query(sql, params);

        // Cargar reglas de jerarquía B2B si existen
        let jerarquiaMap = new Map();
        try {
            const jRes = await req.db.query(`
                SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5 
                FROM public.bunker_portal_b2b_jerarquia 
                WHERE eje_nivel_3 IS NOT NULL AND TRIM(eje_nivel_3) != ''
            `);
            for (const jRow of jRes.rows) {
                const famId = jRow.familia_id !== null && jRow.familia_id !== undefined ? jRow.familia_id : 0;
                const artP = String(jRow.articulo_principal || '').trim().toLowerCase();
                const rawEjeN3 = jRow.eje_nivel_3 ? String(jRow.eje_nivel_3).trim().toLowerCase() : '';
                const ejesN3 = rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim()).filter(Boolean) : [];
                jerarquiaMap.set(`${famId}___${artP}`, {
                    eje_nivel_3: rawEjeN3,
                    ejes_nivel_3: ejesN3,
                    reglas_nivel_4: jRow.reglas_nivel_4 && typeof jRow.reglas_nivel_4 === 'object' ? jRow.reglas_nivel_4 : {},
                    reglas_nivel_5: jRow.reglas_nivel_5 && typeof jRow.reglas_nivel_5 === 'object' ? jRow.reglas_nivel_5 : {}
                });
            }
        } catch (jErr) {
            // Tabla opcional o vacía
        }

        // Cargar ofertas dinámicas activas para este contexto (cliente y lista de precios)
        let mapaOfertas = {};
        try {
            const OfertasDinamicasService = require('../services/ofertasDinamicasService');
            mapaOfertas = await OfertasDinamicasService.obtenerOfertasActivasParaContexto({
                clienteId: clienteId || qClienteRaw,
                listaPrecioId: listaBunkerId || lista
            }, req.db);
        } catch (eOfertas) {
            console.warn('[PRESUPUESTOS] Advertencia al obtener ofertas dinámicas para sugerencias:', eOfertas.message);
        }

        const sugerencias = result.rows.map(a => {
            let props = a.propiedades_dinamicas;
            if (props && typeof props === 'string') {
                try { props = JSON.parse(props); } catch (e) { props = null; }
            }

            let familia = a.familia_nombre ? String(a.familia_nombre).trim() : null;
            if (!familia && a.rubro) familia = String(a.rubro).trim();
            if (!familia) familia = 'General';

            let articuloPrincipal = null;
            if (props && props.articulo_principal) {
                const rawArtPrinc = props.articulo_principal;
                articuloPrincipal = (typeof rawArtPrinc === 'object' && rawArtPrinc.valor) 
                    ? String(rawArtPrinc.valor).trim() 
                    : String(rawArtPrinc).trim();
            }
            if (!articuloPrincipal && a.sub_rubro) articuloPrincipal = String(a.sub_rubro).trim();
            if (!articuloPrincipal && a.descripcion) articuloPrincipal = String(a.descripcion).trim();
            if (!articuloPrincipal) articuloPrincipal = 'General';

            // Subcategorías (Niveles 3, 4 y 5)
            let subCategoria = null;
            let subSubCategoria = null;
            let subSubSubCategoria = null;

            const famId = a.familia_id || 0;
            const jerarquiaKey = `${famId}___${articuloPrincipal.toLowerCase()}`;
            const confRule = jerarquiaMap.get(jerarquiaKey) || null;

            if (confRule && props && typeof props === 'object') {
                const posObj = props.posiciones || props;
                // 1. Resolver Nivel 3 (evaluando ejes configurados en cascada / orden de prioridad)
                const targetEjesN3 = Array.isArray(confRule.ejes_nivel_3) && confRule.ejes_nivel_3.length > 0
                    ? confRule.ejes_nivel_3
                    : (confRule.eje_nivel_3 ? [confRule.eje_nivel_3] : []);

                for (const targetEjeN3 of targetEjesN3) {
                    for (const key in posObj) {
                        if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                            const p = posObj[key];
                            if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN3) {
                                if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                    subCategoria = String(p.valor).trim();
                                    break;
                                }
                            }
                        }
                    }
                    if (subCategoria) break;
                }

                // Resguardo Nivel 3: si hay ejes configurados pero este producto no coincide con ninguno
                if (!subCategoria && targetEjesN3.length > 0) {
                    subCategoria = 'General';
                }

                if (subCategoria && confRule.reglas_nivel_4) {
                    const configuredEjeN4 = confRule.reglas_nivel_4[subCategoria] || null;
                    if (configuredEjeN4) {
                        const targetEjesN4 = Array.isArray(configuredEjeN4)
                            ? configuredEjeN4.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                            : String(configuredEjeN4).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                        for (const targetEjeN4 of targetEjesN4) {
                            for (const key in posObj) {
                                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                                    const p = posObj[key];
                                    if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN4) {
                                        if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                            subSubCategoria = String(p.valor).trim();
                                            break;
                                        }
                                    }
                                }
                            }
                            if (subSubCategoria) break;
                        }

                        // Resguardo Nivel 4: si la subrama tiene reglas pero este producto no coincide
                        if (!subSubCategoria && targetEjesN4.length > 0) {
                            subSubCategoria = 'General';
                        }
                    }
                }

                if (subCategoria && subSubCategoria && confRule.reglas_nivel_5) {
                    const pathKeyN5 = `${subCategoria}___${subSubCategoria}`;
                    const configuredEjeN5 = confRule.reglas_nivel_5[pathKeyN5] || null;
                    if (configuredEjeN5) {
                        const targetEjesN5 = Array.isArray(configuredEjeN5)
                            ? configuredEjeN5.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                            : String(configuredEjeN5).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                        for (const targetEjeN5 of targetEjesN5) {
                            for (const key in posObj) {
                                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                                    const p = posObj[key];
                                    if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN5) {
                                        if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                                            subSubSubCategoria = String(p.valor).trim();
                                            break;
                                        }
                                    }
                                }
                            }
                            if (subSubSubCategoria) break;
                        }

                        // Resguardo Nivel 5: si la sub-subrama tiene reglas pero este producto no coincide
                        if (!subSubSubCategoria && targetEjesN5.length > 0) {
                            subSubSubCategoria = 'General';
                        }
                    }
                }
            }

            const ivaPct = parseFloat(a.iva || 21);
            const kilos = parseFloat(a.kilos_unidad || 1.0) || 1.0;
            const precioVentaNeto = parseFloat(a.precio_venta || 0);
            const precioBrutoFinal = a.precio_final ? parseFloat(a.precio_final) : (precioVentaNeto * (1 + ivaPct / 100));
            const precioKiloBruto = kilos > 0 ? (precioBrutoFinal / kilos) : precioBrutoFinal;
            const precioKiloNeto = kilos > 0 ? (precioVentaNeto / kilos) : precioVentaNeto;

            const artNum = String(a.articulo_numero || '').trim();
            const ofertaActiva = mapaOfertas[artNum] || null;
            let precioOfertaNeto = null;
            let precioOfertaFinal = null;
            let precioKiloOfertaFinal = null;
            let precioKiloOfertaNeto = null;

            if (ofertaActiva) {
                const descPct = parseFloat(ofertaActiva.descuento_porcentaje) || 0;
                if (ofertaActiva.precio_fijo_oferta) {
                    precioOfertaFinal = parseFloat(ofertaActiva.precio_fijo_oferta);
                    precioOfertaNeto = Math.round((precioOfertaFinal / (1 + ivaPct / 100)) * 100) / 100;
                } else {
                    precioOfertaNeto = Math.round(precioVentaNeto * (1 - descPct / 100) * 100) / 100;
                    precioOfertaFinal = Math.round(precioBrutoFinal * (1 - descPct / 100) * 100) / 100;
                }
                precioKiloOfertaFinal = kilos > 0 ? (precioOfertaFinal / kilos) : precioOfertaFinal;
                precioKiloOfertaNeto = kilos > 0 ? (precioOfertaNeto / kilos) : precioOfertaNeto;
            }

            const sf = Math.floor(parseFloat(a.stock_fisico || 0));
            const sr = Math.floor(parseFloat(a.stock_reservado || 0));
            const sd = Math.floor(parseFloat(a.stock_disponible !== undefined ? a.stock_disponible : (a.stock_consolidado || 0)));
            const stockStr = sr > 0 ? `disp: ${sd} | fís: ${sf}, res: ${sr}` : `stock: ${sd}`;

            return {
                codigo_barras: a.codigo_barras,
                articulo_numero: a.articulo_numero,
                producto_codigo: a.articulo_numero,
                codigo_articulo: a.codigo_barras,
                numero: a.codigo_barras,
                descripcion: a.descripcion,
                producto_descripcion: a.descripcion,
                precio_venta: precioVentaNeto,
                precio_neto: precioVentaNeto,
                precio_final: precioBrutoFinal,
                precio_kilo: precioKiloBruto,
                precio_kilo_neto: precioKiloNeto,
                oferta_activa: ofertaActiva ? {
                    ...ofertaActiva,
                    precio_oferta_neto: precioOfertaNeto,
                    precio_oferta_final: precioOfertaFinal,
                    precio_kilo_oferta_final: precioKiloOfertaFinal,
                    precio_kilo_oferta_neto: precioKiloOfertaNeto
                } : null,
                kilos_unidad: kilos,
                stock_fisico: sf,
                stock_reservado: sr,
                stock_disponible: sd,
                stock_actual: sd,
                stock_consolidado: sd,
                iva: ivaPct,
                iva_porcentaje: ivaPct,
                alicuota_iva: ivaPct,
                familia: familia,
                articulo_principal: articuloPrincipal,
                sub_categoria: subCategoria,
                sub_sub_categoria: subSubCategoria,
                sub_sub_sub_categoria: subSubSubCategoria,
                es_pack: a.es_pack === true || a.es_pack === 't' || a.es_pack === 'true',
                pack_unidades: parseInt(a.pack_unidades || 1, 10),
                pack_hijo_codigo: a.pack_hijo_codigo || null,
                propiedades_dinamicas: a.propiedades_dinamicas || null,
                descripcion_legacy: a.descripcion_legacy || '',
                text: `${a.descripcion} — [${a.articulo_numero}] (${stockStr})`
            };
        });

        return res.json({
            success: true,
            data: sugerencias,
            query: qRaw,
            total: sugerencias.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener sugerencias de artículos:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al obtener sugerencias de artículos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener precio neto (valor1) e IVA para un artículo según la lista del cliente.
 * Mapas de listas:
 * 1 -> precio_neg | 2 -> mayorista | 3 -> especial_brus | 4 -> consumidor_final | 5 -> lista_5
 * Si no se encuentra, devolver 0s (pedido explícito).
 */
const obtenerPrecioArticuloCliente = async (req, res) => {
    try {
        const idCliente = parseInt(req.query.cliente_id, 10) || 0;
        const codigoBarras = (req.query.codigo_barras || req.query.articulo_codigo || '').trim();
        const articuloNumero = (req.query.articulo_numero || req.query.articulo_codigo || '').trim();
        let descripcion = (req.query.descripcion || '').trim();

        if (!codigoBarras && !descripcion && !articuloNumero) {
            return res.status(400).json({
                success: false,
                error: 'Falta codigo_barras, descripcion o articulo_numero',
                timestamp: new Date().toISOString()
            });
        }

        // 1) Resolver finanzas y estructura Búnker del artículo (para precios o rentabilidad)
        const usarPreciosBunker = req.query.usar_precios_bunker === 'true' || req.query.usar_precios_bunker === true;
        let listaId = req.query.lista_id ? parseInt(req.query.lista_id, 10) : null;
        if (!listaId && idCliente > 0) {
            try {
                const queryList = `
                    SELECT bclp.bunker_lista_precio_id 
                    FROM public.bunker_cliente_listas_precios bclp
                    JOIN public.bunker_clientes bc ON bc.id = bclp.bunker_cliente_id
                    WHERE bc.lomas_soft_id = LPAD($1, 4, '0')
                       OR bc.lomas_soft_id = $1
                       OR (CASE WHEN $1 ~ '^[0-9]+$' AND LENGTH($1) < 10 THEN bc.id = $1::integer ELSE false END)
                    LIMIT 1
                `;
                const rList = await req.db.query(queryList, [String(idCliente)]);
                if (rList.rows.length > 0) {
                    listaId = rList.rows[0].bunker_lista_precio_id;
                }
            } catch (errList) {
                console.warn('⚠️ [PRESUPUESTOS] Error buscando lista Bunker del cliente:', errList.message);
            }
        }

        let artIdBunker = null;
        let descResueltaBunker = '';
        let finanzasBunker = null;
        let listaFinanciera = null;

        try {
            const queryId = `
                SELECT ba.articulo_id, COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion_resuelta
                FROM public.bunker_articulos ba
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                WHERE ba.articulo_id = $1 
                   OR src.articulo_numero = $1
                   OR src.codigo_barras = $1
                   OR ($2 <> '' AND (LOWER(ba.descripcion) = LOWER($2)
                                  OR LOWER(ba.descripcion_generada) = LOWER($2)
                                  OR LOWER(src.descripcion) = LOWER($2)))
                LIMIT 1
            `;
            const rId = await req.db.query(queryId, [articuloNumero || codigoBarras || '', descripcion || '']);
            if (rId.rows.length > 0) {
                artIdBunker = rId.rows[0].articulo_id;
                descResueltaBunker = rId.rows[0].descripcion_resuelta;

                const BunkerService = require('../../logistica/services/bunkerService');
                finanzasBunker = await BunkerService.obtenerRadiografiaFinanciera(req.db, artIdBunker, { solo_local: true, saltar_reposicion: true });
                if (finanzasBunker && Array.isArray(finanzasBunker.listas_margenes)) {
                    if (listaId) {
                        listaFinanciera = finanzasBunker.listas_margenes.find(m => m.lista_id === listaId);
                    }
                    if (!listaFinanciera) {
                        listaFinanciera = finanzasBunker.listas_margenes.find(m => m.es_patron) || finanzasBunker.listas_margenes[0];
                    }
                }
            }
        } catch (eBunker) {
            console.warn('⚠️ [PRESUPUESTOS] Advertencia al calcular finanzas Búnker:', eBunker.message);
        }

        const costoOp = listaFinanciera ? Number(listaFinanciera.costo_operativo) || 0 : 0;
        const costoTiempo = listaFinanciera ? Number(listaFinanciera.costo_tiempo) || 0 : 0;
        const costoBulto = Number((costoOp - costoTiempo).toFixed(4)) || 0;
        const gananciaReal = listaFinanciera ? Number(listaFinanciera.ganancia_real) || 0 : 0;

        if (usarPreciosBunker && listaFinanciera) {
            const ivaRate = Number(listaFinanciera.iva) || 21;
            const finalPrice = Number(listaFinanciera.precio_final) || 0;
            const netPrice = finalPrice / (1 + ivaRate / 100);

            console.log(`✅ [PRESUPUESTOS] Precio Búnker real: Final ${finalPrice}, IVA ${ivaRate}, Neto ${netPrice}, CostoOp ${costoOp}, Ganancia ${gananciaReal}`);
            return res.json({
                success: true,
                data: {
                    valor1: Number(netPrice.toFixed(4)) || 0,
                    iva: ivaRate,
                    ganancia_real: gananciaReal,
                    costo_operativo: costoOp,
                    costo_bulto: costoBulto,
                    costo_tiempo: costoTiempo,
                    lista_precios: 'Búnker',
                    descripcion_resuelta: descResueltaBunker || descripcion
                },
                timestamp: new Date().toISOString()
            });
        }

        // 2) Lista de precios del cliente (default 1) - Legacy Fallback
        let lista = 1;
        if (idCliente > 0) {
            try {
                const rLista = await req.db.query(
                    'SELECT lista_precios FROM public.clientes WHERE cliente_id = $1 LIMIT 1',
                    [idCliente]
                );
                if (rLista.rows.length) {
                    const n = parseInt(rLista.rows[0].lista_precios, 10);
                    if (Number.isFinite(n) && n >= 1 && n <= 5) lista = n;
                }
            } catch (e) {
                console.warn('[PRECIOS] No se pudo leer lista_precios del cliente, usando 1 por defecto');
            }
        }

        // 2) Si no vino descripción y sí código de barras, resolverla
        if (!descripcion && codigoBarras) {
            const rDesc = await req.db.query(
                'SELECT descripcion FROM public.stock_real_consolidado WHERE codigo_barras = $1 OR articulo_numero = $1 LIMIT 1',
                [codigoBarras]
            );
            if (rDesc.rows.length) descripcion = rDesc.rows[0].descripcion;
        }

        if (!descripcion) {
            return res.json({
                success: true,
                data: { valor1: 0, iva: 0, lista_precios: lista },
                message: 'Artículo no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        // 3) Buscar precios por descripción (igual exacto → fallback ILIKE)
        let rPrecio = await req.db.query(`
      SELECT 
        COALESCE(iva,0)              AS iva,
        COALESCE(precio_neg,0)       AS precio_neg,
        COALESCE(mayorista,0)        AS mayorista,
        COALESCE(especial_brus,0)    AS especial_brus,
        COALESCE(consumidor_final,0) AS consumidor_final,
        COALESCE(lista_5,0)          AS lista_5
      FROM public.precios_articulos
      WHERE LOWER(descripcion) = LOWER($1)
      LIMIT 1
    `, [descripcion]);

        if (rPrecio.rows.length === 0) {
            rPrecio = await req.db.query(`
        SELECT 
          COALESCE(iva,0)              AS iva,
          COALESCE(precio_neg,0)       AS precio_neg,
          COALESCE(mayorista,0)        AS mayorista,
          COALESCE(especial_brus,0)    AS especial_brus,
          COALESCE(consumidor_final,0) AS consumidor_final,
          COALESCE(lista_5,0)          AS lista_5
        FROM public.precios_articulos
        WHERE descripcion ILIKE $1
        ORDER BY LENGTH(descripcion) ASC
        LIMIT 1
      `, [descripcion]);
        }

        if (rPrecio.rows.length === 0) {
            return res.json({
                success: true,
                data: { valor1: 0, iva: 0, lista_precios: lista },
                message: 'Sin precio para la descripción',
                timestamp: new Date().toISOString()
            });
        }

        const p = rPrecio.rows[0];
        const valor =
            lista === 1 ? p.precio_neg :
                lista === 2 ? p.mayorista :
                    lista === 3 ? p.especial_brus :
                        lista === 4 ? p.consumidor_final :
                            lista === 5 ? p.lista_5 : p.precio_neg;

        return res.json({
            success: true,
            data: {
                valor1: Number(valor) || 0,
                iva: Number(p.iva) || 0,
                lista_precios: lista,
                costo_operativo: costoOp,
                costo_bulto: costoBulto,
                costo_tiempo: costoTiempo,
                ganancia_real: gananciaReal,
                descripcion_resuelta: descResueltaBunker || descripcion
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en obtenerPrecioArticuloCliente:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al obtener precio/IVA',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};


/**
 * Obtener presupuestos por categoría
 */
const obtenerPresupuestosPorCategoria = async (req, res) => {
    try {
        const { categoria } = req.params;
        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuestos para categoría: ${categoria}`);

        const query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext as sheet_id,
                'Presupuestos' as sheet_name,
                p.tipo_comprobante as categoria,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto,
                0 as monto,
                p.fecha as fecha_registro,
                p.fecha as fecha_sincronizacion,
                p.activo
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            WHERE p.activo = true AND LOWER(p.tipo_comprobante) = LOWER($1)
            ORDER BY p.fecha DESC, concepto
        `;

        const result = await req.db.query(query, [categoria]);

        console.log(`✅ [PRESUPUESTOS] Presupuestos encontrados para '${categoria}': ${result.rows.length} registros`);

        res.json({
            success: true,
            data: result.rows,
            categoria: categoria,
            total: result.rows.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error al obtener presupuestos por categoría:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos por categoría',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas de presupuestos
 */
const obtenerEstadisticas = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Calculando estadísticas...');

        const query = `
            SELECT 
                COUNT(*) as total_registros,
                COUNT(DISTINCT tipo_comprobante) as total_categorias,
                0 as monto_total,
                0 as monto_promedio,
                0 as monto_minimo,
                0 as monto_maximo,
                COALESCE(
                    (SELECT MAX(fecha_sync) FROM public.presupuestos_sync_log WHERE exitoso = true),
                    (SELECT MAX(fecha) FROM public.presupuestos WHERE activo = true)
                ) as ultima_sincronizacion
            FROM public.presupuestos 
            WHERE activo = true
        `;

        const result = await req.db.query(query);
        const stats = result.rows[0];

        // Obtener distribución por categorías
        const categoriasQuery = `
            SELECT 
                tipo_comprobante as categoria,
                COUNT(*) as cantidad,
                0 as monto_categoria,
                0 as promedio_categoria
            FROM public.presupuestos 
            WHERE activo = true 
            GROUP BY tipo_comprobante 
            ORDER BY cantidad DESC
        `;

        const categoriasResult = await req.db.query(categoriasQuery);

        console.log('✅ [PRESUPUESTOS] Estadísticas calculadas exitosamente');
        console.log(`📊 [PRESUPUESTOS] Total registros: ${stats.total_registros}`);
        console.log(`💰 [PRESUPUESTOS] Monto total: $${parseFloat(stats.monto_total || 0).toFixed(2)}`);

        res.json({
            success: true,
            estadisticas: {
                total_registros: parseInt(stats.total_registros),
                total_categorias: parseInt(stats.total_categorias),
                monto_total: parseFloat(stats.monto_total || 0),
                monto_promedio: parseFloat(stats.monto_promedio || 0),
                monto_minimo: parseFloat(stats.monto_minimo || 0),
                monto_maximo: parseFloat(stats.monto_maximo || 0),
                ultima_sincronizacion: stats.ultima_sincronizacion
            },
            categorias: categoriasResult.rows,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al calcular estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al calcular estadísticas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener configuración actual
 */
const obtenerConfiguracion = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo configuración actual...');

        const query = `
            SELECT 
                id,
                sheet_url,
                sheet_id,
                range_datos,
                ultima_sincronizacion,
                activo,
                creado_por,
                fecha_creacion
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;

        const result = await req.db.query(query);

        if (result.rows.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No se encontró configuración activa');
            return res.json({
                success: true,
                data: null,
                message: 'No hay configuración activa',
                timestamp: new Date().toISOString()
            });
        }

        const config = result.rows[0];
        console.log('✅ [PRESUPUESTOS] Configuración encontrada:', config.sheet_id);

        res.json({
            success: true,
            data: config,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener configuración',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener presupuesto por ID
 */
const obtenerPresupuestoPorId = async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuesto por ID: ${id}`);

        // Validar formato de ID: numérico (legacy) o UUIDv7 con prefijo P-
        const isNumericId = /^\d+$/.test(id);
        const isUUIDv7Id = /^P-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

        if (!isNumericId && !isUUIDv7Id) {
            console.log('❌ [PRESUPUESTOS] ID inválido proporcionado:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido (debe ser numérico o P-{UUIDv7})',
                timestamp: new Date().toISOString()
            });
        }

        const query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.id_cliente,
                p.fecha,
                p.fecha_entrega,
                p.agente,
                p.tipo_comprobante,
                p.estado,
                p.secuencia,
                COALESCE(p.nota, '') AS nota,
                COALESCE(p.punto_entrega, 'Sin dirección') AS punto_entrega,
                COALESCE(p.descuento, 0) AS descuento,
                p.formato_impresion,
                p.activo,
                COALESCE(c.nombre || ' ' || c.apellido, bc.razon_social, bc.cliente_nombre, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto,
                COALESCE(bc.cuit_cuil, c.cuit, '') as cuit,
                COALESCE(c.dni, '') as dni,
                COALESCE(bc.condicion_iva, c.condicion_iva, 'Consumidor Final') as condicion_iva,
                COALESCE(c.telefono, c.celular, '') as telefono,
                COALESCE(c.email, '') as email,
                COALESCE(bc.preferencia_facturacion, c.preferencia_facturacion, 'PREGUNTAR') AS preferencia_facturacion,
                COALESCE(
                    p.factura_id,
                    (SELECT f.id FROM public.factura_facturas f 
                     WHERE f.presupuesto_id = p.id 
                     ORDER BY f.created_at DESC 
                     LIMIT 1)
                ) AS factura_id,
                CASE 
                    WHEN p.factura_id IS NOT NULL THEN true
                    WHEN EXISTS (
                        SELECT 1 FROM public.factura_facturas f 
                        WHERE f.presupuesto_id = p.id
                        LIMIT 1
                    ) THEN true
                    ELSE false
                END AS esta_facturado,
                 p.origen_facturacion,
                p.origen_punto_venta,
                p.origen_numero_factura,
                COALESCE(p.usar_precios_bunker, false) AS usar_precios_bunker,
                (
                    SELECT CASE 
                        WHEN f.estado = 'APROBADA' THEN 'ARCA'
                        WHEN f.estado = 'APROBADA_LOCAL' THEN 'LOCAL'
                        ELSE 'LOCAL'
                    END
                    FROM public.factura_facturas f 
                    WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    LIMIT 1
                ) as origen_factura_canal,
                (
                    SELECT f.id FROM public.factura_facturas f
                    WHERE (f.presupuesto_id = p.id OR f.presupuesto_id = (CASE WHEN p.origen_numero_factura ~ '^[0-9]+$' THEN CAST(p.origen_numero_factura AS INTEGER) ELSE NULL END))
                      AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    LIMIT 1
                ) AS factura_asociada_id,
                bc.id AS bunker_cliente_id,
                COALESCE(bc.whatsapp_facturas, '') AS whatsapp_bunker,
                COALESCE(bc.email_facturas, '') AS email_bunker,
                COALESCE(bc.canal_envio_preferido, 'ambos') AS canal_envio_preferido
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON (
                CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN c.cliente_id = CAST(p.id_cliente AS integer) ELSE false END
            )
            LEFT JOIN public.bunker_clientes bc ON (
                (c.cliente_id IS NOT NULL AND (bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') OR bc.lomas_soft_id = c.cliente_id::text OR bc.id = c.cliente_id))
                OR (p.id_cliente ~ '^[0-9]+$' AND (bc.lomas_soft_id = LPAD(p.id_cliente, 4, '0') OR bc.lomas_soft_id = p.id_cliente))
                OR bc.codigo_bunker_cliente = p.id_cliente
            )
            WHERE p.id = $1 AND p.activo = true
        `;

        const result = await req.db.query(query, [parseInt(id)]);

        if (result.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = result.rows[0];
        console.log(`[GET/:id] resp`, {
            id: presupuesto.id,
            descuento: presupuesto.descuento,
            nota: presupuesto.nota,
            punto_entrega: presupuesto.punto_entrega
        });

        res.json({
            success: true,
            data: presupuesto,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuesto por ID:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Crear nuevo presupuesto manualmente
 */
const crearPresupuesto = async (req, res) => {
    try {
        const { sheet_id, sheet_name, categoria, concepto, monto } = req.body;
        const usuario_id = req.user?.id || 1; // TODO: Obtener de sesión real

        console.log('🔍 [PRESUPUESTOS] Creando nuevo presupuesto:', { categoria, concepto, monto });

        // Validaciones
        if (!concepto || concepto.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Concepto requerido');
            return res.status(400).json({
                success: false,
                error: 'El concepto es requerido',
                timestamp: new Date().toISOString()
            });
        }

        if (monto === undefined || monto === null || isNaN(parseFloat(monto))) {
            console.log('❌ [PRESUPUESTOS] Monto inválido:', monto);
            return res.status(400).json({
                success: false,
                error: 'El monto debe ser un número válido',
                timestamp: new Date().toISOString()
            });
        }

        // Verificar duplicados
        const duplicateQuery = `
            SELECT p.id FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            WHERE LOWER(COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente')) = LOWER($1) 
            AND LOWER(p.tipo_comprobante) = LOWER($2) 
            AND p.id_presupuesto_ext = $3 
            AND p.activo = true
        `;

        const duplicateResult = await req.db.query(duplicateQuery, [
            concepto.trim(),
            (categoria || 'Sin categoría').trim(),
            sheet_id || 'manual'
        ]);

        if (duplicateResult.rows.length > 0) {
            console.log('⚠️ [PRESUPUESTOS] Presupuesto duplicado detectado');
            return res.status(409).json({
                success: false,
                error: 'Ya existe un presupuesto con el mismo concepto y categoría',
                timestamp: new Date().toISOString()
            });
        }

        // Insertar nuevo presupuesto
        const insertQuery = `
            INSERT INTO public.presupuestos 
            (id_presupuesto_ext, tipo_comprobante, id_cliente, fecha, agente, activo)
            VALUES ($1, $2, '999', NOW(), 'Manual', true)
            RETURNING *
        `;

        const insertResult = await req.db.query(insertQuery, [
            sheet_id || 'manual',
            sheet_name || 'Ingreso Manual',
            (categoria || 'Sin categoría').trim(),
            concepto.trim(),
            parseFloat(monto)
        ]);

        const nuevoPresupuesto = insertResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Presupuesto creado con ID: ${nuevoPresupuesto.id}`);
        console.log(`📋 [PRESUPUESTOS] Detalles: ${nuevoPresupuesto.concepto} - $${nuevoPresupuesto.monto}`);

        res.status(201).json({
            success: true,
            data: nuevoPresupuesto,
            message: 'Presupuesto creado exitosamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al crear presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al crear presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar presupuesto existente
 */
const actualizarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { categoria, concepto, monto } = req.body;

        console.log(`🔍 [PRESUPUESTOS] Actualizando presupuesto ID: ${id}`);
        console.log('📋 [PRESUPUESTOS] Nuevos datos:', { categoria, concepto, monto });

        if (!id || id.trim() === '') {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }

        // Usar resolvePresupuesto para encontrar el presupuesto por id o id_presupuesto_ext
        const presupuesto = await resolvePresupuesto(req.db, id);

        if (!presupuesto) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        // Construir consulta de actualización dinámica
        const updates = [];
        const params = [];
        let paramCount = 0;

        if (categoria !== undefined) {
            paramCount++;
            updates.push(`tipo_comprobante = $${paramCount}`);
            params.push((categoria || 'Sin categoría').trim());
        }

        if (concepto !== undefined && concepto.trim() !== '') {
            paramCount++;
            updates.push(`concepto = $${paramCount}`);
            params.push(concepto.trim());
        }

        if (monto !== undefined && !isNaN(parseFloat(monto))) {
            paramCount++;
            updates.push(`monto = $${paramCount}`);
            params.push(parseFloat(monto));
        }

        if (updates.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No hay campos válidos para actualizar');
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos válidos para actualizar',
                timestamp: new Date().toISOString()
            });
        }

        // Agregar fecha de sincronización
        paramCount++;
        updates.push(`fecha_sincronizacion = NOW()`);

        // Agregar ID numérico para WHERE
        paramCount++;
        params.push(presupuesto.id);

        const updateQuery = `
            UPDATE public.presupuestos
            SET ${updates.join(', ')}
            WHERE id = $${paramCount} AND activo = true
            RETURNING *
        `;

        console.log('📋 [PRESUPUESTOS] Query de actualización:', updateQuery);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);

        const updateResult = await req.db.query(updateQuery, params);
        const presupuestoActualizado = updateResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Presupuesto actualizado: ${presupuestoActualizado.concepto}`);

        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Eliminar presupuesto (soft delete)
 */
const eliminarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔍 [PRESUPUESTOS] Eliminando presupuesto ID: ${id}`);

        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }

        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT p.id, COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as concepto 
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            WHERE p.id = $1 AND p.activo = true
        `;

        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);

        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para eliminar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = existsResult.rows[0];

        // Soft delete
        const deleteQuery = `
            UPDATE public.presupuestos 
            SET activo = false
            WHERE id = $1
            RETURNING id, 'Presupuesto eliminado' as concepto
        `;

        const deleteResult = await req.db.query(deleteQuery, [parseInt(id)]);
        const presupuestoEliminado = deleteResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Presupuesto eliminado (soft delete): ${presupuestoEliminado.concepto}`);

        res.json({
            success: true,
            data: {
                id: presupuestoEliminado.id,
                concepto: presupuestoEliminado.concepto,
                eliminado: true
            },
            message: 'Presupuesto eliminado exitosamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al eliminar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener resumen por categoría o fecha
 */
const obtenerResumen = async (req, res) => {
    try {
        const {
            tipo = 'categoria',
            fecha_desde,
            fecha_hasta,
            categoria
        } = req.query;

        console.log(`🔍 [PRESUPUESTOS] Generando resumen por: ${tipo}`);
        console.log('📋 [PRESUPUESTOS] Filtros:', { fecha_desde, fecha_hasta, categoria });

        let query = '';
        let params = [];
        let paramCount = 0;

        if (tipo === 'categoria') {
            query = `
                SELECT 
                    categoria,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    MIN(monto) as monto_minimo,
                    MAX(monto) as monto_maximo,
                    MIN(fecha_registro) as fecha_primer_registro,
                    MAX(p.fecha) as ultima_actualizacion
                FROM public.presupuestos p
                WHERE p.activo = true
            `;

            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }

            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }

            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }

            query += `
                GROUP BY categoria
                ORDER BY monto_total DESC
            `;

        } else if (tipo === 'fecha') {
            query = `
                SELECT 
                    DATE(fecha_registro) as fecha,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    COUNT(DISTINCT p.tipo_comprobante) as categorias_distintas
                FROM public.presupuestos p
                WHERE p.activo = true
            `;

            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }

            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }

            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }

            query += `
                GROUP BY DATE(fecha_registro)
                ORDER BY fecha DESC
            `;

        } else {
            console.log('❌ [PRESUPUESTOS] Tipo de resumen inválido:', tipo);
            return res.status(400).json({
                success: false,
                error: 'Tipo de resumen inválido. Use "categoria" o "fecha"',
                timestamp: new Date().toISOString()
            });
        }

        console.log('📋 [PRESUPUESTOS] Query de resumen:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);

        const result = await req.db.query(query, params);

        // Calcular totales generales
        const totalesQuery = `
            SELECT 
                COUNT(*) as total_registros,
                SUM(monto) as monto_total,
                AVG(monto) as monto_promedio,
                COUNT(DISTINCT p.tipo_comprobante) as total_categorias
            FROM public.presupuestos p
            WHERE p.activo = true
            ${fecha_desde ? `AND fecha_registro >= '${fecha_desde}'` : ''}
            ${fecha_hasta ? `AND fecha_registro <= '${fecha_hasta}'` : ''}
            ${categoria ? `AND LOWER(categoria) LIKE LOWER('%${categoria}%')` : ''}
        `;

        const totalesResult = await req.db.query(totalesQuery);
        const totales = totalesResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Resumen generado: ${result.rows.length} grupos`);
        console.log(`📊 [PRESUPUESTOS] Totales: ${totales.total_registros} registros, $${parseFloat(totales.monto_total || 0).toFixed(2)}`);

        res.json({
            success: true,
            tipo: tipo,
            data: result.rows,
            totales: {
                total_registros: parseInt(totales.total_registros),
                monto_total: parseFloat(totales.monto_total || 0),
                monto_promedio: parseFloat(totales.monto_promedio || 0),
                total_categorias: parseInt(totales.total_categorias)
            },
            filtros: {
                fecha_desde,
                fecha_hasta,
                categoria
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al generar resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar resumen',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener detalles de artículos de un presupuesto
 */
const obtenerDetallesPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔍 [PRESUPUESTOS] Obteniendo detalles de artículos para presupuesto ID: ${id}`);

        // Validación de ID ya se hace en middleware validarIdPresupuesto
        if (!id) {
            console.log('❌ [PRESUPUESTOS] ID faltante:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto requerido',
                timestamp: new Date().toISOString()
            });
        }

        // Verificar que el presupuesto existe (soporta ID numérico o id_presupuesto_ext enviado desde el frontend)
        const idStr = String(id).trim();
        const isNumericId = /^\d+$/.test(idStr);
        const presupuestoQuery = `
            SELECT 
                p.id, 
                p.id_presupuesto_ext, 
                p.tipo_comprobante,
                p.descuento,
                p.nota,
                p.estado,
                p.id_cliente,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as cliente_nombre,
                c.condicion_iva,
                f.pto_vta
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            LEFT JOIN (
                SELECT presupuesto_id, pto_vta,
                       ROW_NUMBER() OVER(PARTITION BY presupuesto_id ORDER BY id DESC) as rn
                FROM public.factura_facturas 
                WHERE estado IN ('APROBADA', 'APROBADA_LOCAL')
            ) f ON f.presupuesto_id = p.id AND f.rn = 1
            WHERE (${isNumericId ? 'p.id = $1 OR p.id_presupuesto_ext = $2' : 'p.id_presupuesto_ext = $1'})
              AND p.activo = true
            ORDER BY p.id DESC
            LIMIT 1
        `;

        const presupuestoResult = await req.db.query(
            presupuestoQuery,
            isNumericId ? [parseInt(idStr, 10), idStr] : [idStr]
        );

        if (presupuestoResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = presupuestoResult.rows[0];

        // Micro-Etapa 2: Vínculo interno por clave entera (pd.id_presupuesto = $1) + Lectura Dual de artículos
        const detallesQuery = `
            SELECT 
                pd.id,
                pd.articulo,
                COALESCE(
                    NULLIF(TRIM(a.codigo_barras), ''),
                    NULLIF(TRIM(ba.codigo_barras::text), ''),
                    pd.articulo
                ) as codigo_barras_resuelto,
                COALESCE(
                    ba.articulo_id::text,
                    a.numero::text,
                    CASE WHEN ing.id IS NOT NULL THEN ing.id::text ELSE NULL END,
                    pd.articulo
                ) as articulo_numero_resuelto,
                COALESCE(
                    NULLIF(TRIM(ba.descripcion_generada), ''),
                    NULLIF(TRIM(ba.descripcion), ''),
                    NULLIF(TRIM(a.nombre), ''),
                    NULLIF(TRIM(ing.nombre), ''),
                    pd.articulo
                ) as descripcion_articulo,
                pd.cantidad,
                pd.valor1,
                pd.precio1,
                pd.iva1,
                pd.camp2,
                COALESCE(pd.descuento_adicional, 0) as descuento_adicional,
                COALESCE(pd.es_saldo_ingrediente, false) as es_saldo_ingrediente,
                pd.ingrediente_id_saldo,
                pd.kilos_saldo,
                ing_saldo.nombre as ingrediente_saldo_nombre,
                -- NETO = cantidad * valor1 (neto unitario)
                ROUND(pd.cantidad * COALESCE(pd.valor1, 0), 2) as neto_linea,
                -- IVA = cantidad * iva1 (IVA unitario directo de BD)
                ROUND(pd.cantidad * COALESCE(pd.iva1, 0), 2) as iva_linea,
                -- TOTAL = cantidad * precio1 (total unitario con IVA incluido)
                ROUND(pd.cantidad * COALESCE(pd.precio1, 0), 2) as total_linea
            FROM public.presupuestos_detalles pd
            LEFT JOIN LATERAL (
                SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                FROM public.articulos a_inner
                WHERE a_inner.codigo_barras = pd.articulo OR a_inner.numero = pd.articulo
                ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                LIMIT 1
            ) a ON true
            LEFT JOIN LATERAL (
                SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                FROM public.bunker_articulos ba_inner
                WHERE ba_inner.articulo_id::text = pd.articulo
                   OR ba_inner.codigo_barras::text = pd.articulo
                   OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                ORDER BY
                   (ba_inner.articulo_id::text = pd.articulo) DESC,
                   (ba_inner.codigo_barras::text = pd.articulo) DESC
                LIMIT 1
            ) ba ON true
            LEFT JOIN LATERAL (
                SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
                FROM public.ingredientes ing_inner
                WHERE a.numero IS NULL
                  AND ba.articulo_id IS NULL
                  AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
                ORDER BY (ing_inner.id::text = pd.articulo) DESC
                LIMIT 1
            ) ing ON true
            LEFT JOIN public.ingredientes ing_saldo ON (ing_saldo.id = pd.ingrediente_id_saldo)
            WHERE pd.id_presupuesto = $1
            ORDER BY pd.id
        `;

        const detallesResult = await req.db.query(detallesQuery, [presupuesto.id]);

        console.log(`✅ [PRESUPUESTOS] Detalles encontrados: ${detallesResult.rows.length} artículos para presupuesto ID ${presupuesto.id} (${presupuesto.id_presupuesto_ext})`);

        // Mapear resultados - CORRECCIÓN: Devolver valores UNITARIOS + TOTALES
        // El frontend de edición espera valores UNITARIOS en valor1/precio1/iva1
        // Los totales (neto/iva/total) son para el resumen
        const detallesConCalculos = detallesResult.rows.map(item => ({
            id: item.id,
            codigo_barras: item.articulo,
            articulo: item.articulo,
            articulo_numero: item.articulo,
            descripcion_articulo: item.descripcion_articulo,  // ✅ Agregar campo faltante
            detalle: item.descripcion_articulo,
            descripcion: item.descripcion_articulo,
            cantidad: parseFloat(item.cantidad || 0),
            // VALORES UNITARIOS (para edición)
            valor1: parseFloat(item.valor1 || 0),      // Precio unitario SIN IVA
            precio1: parseFloat(item.precio1 || 0),    // Precio unitario CON IVA
            iva1: parseFloat(item.iva1 || 0),          // Monto IVA unitario
            camp2: parseFloat(item.camp2 || 0),        // Alícuota decimal (0.21)
            descuento_adicional: parseFloat(item.descuento_adicional || 0),
            es_saldo_ingrediente: item.es_saldo_ingrediente === true,
            ingrediente_id_saldo: item.ingrediente_id_saldo ? parseInt(item.ingrediente_id_saldo, 10) : null,
            kilos_saldo: item.kilos_saldo !== null && item.kilos_saldo !== undefined ? parseFloat(item.kilos_saldo) : null,
            ingrediente_saldo_nombre: item.ingrediente_saldo_nombre || null,
            // VALORES TOTALES (para resumen/totales)
            neto: parseFloat(item.neto_linea || 0),
            iva: parseFloat(item.iva_linea || 0),
            total: parseFloat(item.total_linea || 0)
        }));

        // Calcular totales con redondeo por renglón antes de acumular
        const totales = detallesConCalculos.reduce((acc, item) => {
            acc.cantidad_total += item.cantidad;
            acc.neto_total += item.neto;
            acc.iva_total += item.iva;
            acc.total_general += item.total;
            return acc;
        }, {
            cantidad_total: 0,
            neto_total: 0,
            iva_total: 0,
            total_general: 0
        });

        // Redondear totales finales
        totales.cantidad_total = Math.round(totales.cantidad_total * 100) / 100;
        totales.neto_total = Math.round(totales.neto_total * 100) / 100;
        totales.iva_total = Math.round(totales.iva_total * 100) / 100;
        totales.total_general = Math.round(totales.total_general * 100) / 100;

        // Verificar que totalFinal = totalNeto + totalIVA
        const sumaCalculada = Math.round((totales.neto_total + totales.iva_total) * 100) / 100;
        const diferencia = Math.abs(totales.total_general - sumaCalculada);

        if (diferencia > 0.01) {
            console.log(`⚠️ [PRESUPUESTOS] Diferencia en totales detectada: ${diferencia.toFixed(2)}`);
        }

        // Log de control por presupuesto según especificación
        console.log(`[DETALLE] sumNeto= ${totales.neto_total.toFixed(2)} sumIVA= ${totales.iva_total.toFixed(2)} sumTotal= ${totales.total_general.toFixed(2)}`);

        // NUEVO: Obtener detalles sin stock (información histórica)
        let detallesSinStock = [];
        try {
            const sinStockQuery = `
                SELECT 
                    id, articulo, descripcion, cantidad, 
                    motivo_falta, fecha_registro as created_at
                FROM public.presupuestos_articulos_sin_stock
                WHERE id_presupuesto = $1
                ORDER BY id ASC
            `;
            const sinStockResult = await req.db.query(sinStockQuery, [presupuesto.id]);
            detallesSinStock = sinStockResult.rows;
            console.log(`✅ [PRESUPUESTOS] Detalles sin stock encontrados: ${detallesSinStock.length} artículos`);
        } catch (err) {
            console.warn(`⚠️ [PRESUPUESTOS] Error al obtener detalles sin stock (posible tabla no existente):`, err.message);
        }

        console.log('📊 [PRESUPUESTOS] Totales calculados:', totales);

        res.json({
            success: true,
            data: {
                presupuesto: {
                    id: presupuesto.id,
                    id_presupuesto: presupuesto.id_presupuesto_ext,
                    id_presupuesto_ext: presupuesto.id_presupuesto_ext,
                    tipo_comprobante: presupuesto.tipo_comprobante,
                    condicion_iva: presupuesto.condicion_iva,
                    descuento: parseFloat(presupuesto.descuento || 0) > 1 ? parseFloat(presupuesto.descuento) / 100 : parseFloat(presupuesto.descuento || 0),
                    nota: presupuesto.nota || '',
                    estado: presupuesto.estado || '',
                    id_cliente: presupuesto.id_cliente || '',
                    cliente_nombre: presupuesto.cliente_nombre || ''
                },
                detalles: detallesConCalculos,
                detalles_sin_stock: detallesSinStock,
                totales: totales,
                total_articulos: detallesConCalculos.length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener detalles:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener detalles del presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estados distintos de presupuestos - Filtro por Estado – 2024-12-19
 */
const obtenerEstados = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo estados distintos...');

        const query = `
            SELECT DISTINCT estado
            FROM public.presupuestos 
            WHERE activo = true 
            AND estado IS NOT NULL 
            AND TRIM(estado) != ''
            ORDER BY estado ASC
        `;

        const result = await req.db.query(query);

        // Filtrar, limpiar y deduplicar estados insensible a mayúsculas/minúsculas
        const estadosMap = new Map();
        result.rows.forEach(row => {
            const raw = (row.estado || '').trim();
            if (!raw) return;
            const key = raw.toUpperCase();
            if (!estadosMap.has(key)) {
                // Preservar formato canónico (ej: 'Anulado' en vez de 'ANULADO')
                const canonical = (raw === 'ANULADO') ? 'Anulado' : raw;
                estadosMap.set(key, canonical);
            }
        });

        const estados = Array.from(estadosMap.values()).sort();

        console.log(`🔍 [PRESUPUESTOS] Ruta GET /estados - estados distintos: ${estados.length}`);
        console.log('📊 [PRESUPUESTOS] Estados encontrados:', estados);

        res.json({
            success: true,
            estados: estados,
            total: estados.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener estados:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estados',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar estado de presupuesto
 */
const actualizarEstadoPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        console.log(`🔍 [PRESUPUESTOS] Actualizando estado de presupuesto ID: ${id} a: ${estado}`);

        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }

        if (!estado || estado.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Estado requerido');
            return res.status(400).json({
                success: false,
                error: 'El estado es requerido',
                timestamp: new Date().toISOString()
            });
        }

        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, estado, secuencia FROM presupuestos 
            WHERE id = $1 AND activo = true
        `;

        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);

        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar estado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }

        const registroActual = existsResult.rows[0];
        const nuevoEstado = estado.trim();
        let nuevaSecuencia = (req.body.secuencia !== undefined && req.body.secuencia !== null && req.body.secuencia !== '') 
            ? req.body.secuencia 
            : null;

        if (!nuevaSecuencia) {
            if (nuevoEstado === 'Sin Confirmar') {
                nuevaSecuencia = 'Standby';
            } else if (nuevoEstado === 'Presupuesto/Orden' && (registroActual.secuencia === 'Standby' || registroActual.estado === 'Sin Confirmar' || registroActual.estado === 'Standby')) {
                nuevaSecuencia = 'Imprimir';
            }
        }

        // Actualizar estado (y estado_logistico si viene en el body)
        let updateQuery;
        let queryParams;

        // Verificar si se envió estado_logistico
        const esEntregado = (nuevoEstado && nuevoEstado.toLowerCase() === 'entregado') || 
                            (req.body.estado_logistico && ['ENTREGADO', 'ENTREGADO_DEPOSITO'].includes(req.body.estado_logistico.toUpperCase()));

        if (req.body.estado_logistico !== undefined) {
            console.log(`📦 [PRESUPUESTOS] Actualizando también estado_logistico a: ${req.body.estado_logistico}`);
            updateQuery = `
                UPDATE presupuestos
                SET estado = $1, 
                    estado_logistico = $2,
                    secuencia = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE secuencia END,
                    fecha_entrega_real = CASE WHEN $4 = true THEN COALESCE(fecha_entrega_real, CURRENT_TIMESTAMP) ELSE fecha_entrega_real END,
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE id = $3 AND activo = true
                RETURNING *
            `;
            queryParams = [nuevoEstado, req.body.estado_logistico, parseInt(id), esEntregado, nuevaSecuencia];
        } else {
            updateQuery = `
                UPDATE presupuestos
                SET estado = $1,
                    secuencia = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE secuencia END,
                    fecha_entrega_real = CASE WHEN $3 = true THEN COALESCE(fecha_entrega_real, CURRENT_TIMESTAMP) ELSE fecha_entrega_real END,
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE id = $2 AND activo = true
                RETURNING *
            `;
            queryParams = [nuevoEstado, parseInt(id), esEntregado, nuevaSecuencia];
        }

        const updateResult = await req.db.query(updateQuery, queryParams);
        const presupuestoActualizado = updateResult.rows[0];

        console.log(`✅ [PRESUPUESTOS] Estado actualizado: ${presupuestoActualizado.estado} | Secuencia: ${presupuestoActualizado.secuencia}`);

        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Estado de presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar estado de presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener datos del cliente por ID (incluyendo condicion_iva)
 */
const obtenerDatosCliente = async (req, res) => {
    const requestId = `cliente-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Obteniendo datos del cliente`);

    try {
        const { id_cliente } = req.params;

        if (!id_cliente) {
            return res.status(400).json({
                success: false,
                error: 'ID de cliente requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Buscando cliente ID: ${id_cliente}`);

        const query = `
            SELECT 
                c.cliente_id as id_cliente,
                c.nombre,
                c.apellido,
                c.condicion_iva,
                c.lista_precios as legacy_lista_precios,
                bc.id as bunker_cliente_id,
                bc.codigo_bunker_cliente,
                (bc.id IS NOT NULL) as en_bunker,
                COALESCE(
                    (SELECT JSON_AGG(JSON_BUILD_OBJECT('id', lp.id, 'nombre', lp.nombre))
                     FROM public.bunker_cliente_listas_precios clp
                     JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                     WHERE clp.bunker_cliente_id = bc.id),
                    '[]'::json
                ) as bunker_listas,
                (SELECT lp.nombre
                 FROM public.bunker_cliente_listas_precios clp
                 JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                 WHERE clp.bunker_cliente_id = bc.id
                 LIMIT 1) as bunker_lista_nombre,
                (SELECT clp.bunker_lista_precio_id
                 FROM public.bunker_cliente_listas_precios clp
                 WHERE clp.bunker_cliente_id = bc.id
                 LIMIT 1) as bunker_lista_id,
                EXISTS (
                    SELECT 1 
                    FROM public.bunker_cliente_listas_precios clp
                    WHERE clp.bunker_cliente_id = bc.id
                ) as tiene_listas_bunker
            FROM public.clientes c
            LEFT JOIN public.bunker_clientes bc ON (
                bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') 
                OR bc.lomas_soft_id = c.cliente_id::text 
                OR bc.id = c.cliente_id
            )
            WHERE c.cliente_id = $1
            LIMIT 1
        `;

        const result = await req.db.query(query, [parseInt(id_cliente)]);

        if (result.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] ${requestId} - Cliente no encontrado: ${id_cliente}`);
            return res.status(404).json({
                success: false,
                error: 'Cliente no encontrado',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const cliente = result.rows[0];
        console.log(`✅ [PRESUPUESTOS] ${requestId} - Cliente encontrado:`, {
            id_cliente: cliente.id_cliente,
            nombre: cliente.nombre,
            condicion_iva: cliente.condicion_iva,
            en_bunker: cliente.en_bunker,
            tiene_listas_bunker: cliente.tiene_listas_bunker,
            bunker_lista_nombre: cliente.bunker_lista_nombre
        });

        res.json({
            success: true,
            data: cliente,
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error al obtener datos del cliente:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener datos del cliente',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener historial de entregas de un cliente
 * Devuelve productos únicos (última entrega) agrupados por mes
 */
const obtenerHistorialEntregasCliente = async (req, res) => {
    const requestId = `historial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Obteniendo historial de entregas del cliente`);

    try {
        const { id_cliente } = req.params;

        if (!id_cliente) {
            return res.status(400).json({
                success: false,
                error: 'ID de cliente requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Buscando entregas para cliente ID: ${id_cliente}`);

        // Consulta para obtener TODOS los detalles de presupuestos entregados del cliente
        // Incluimos fecha_entrega para ordenar por la más reciente
        // ✅ NUEVO: Incluir precios actuales de la tabla precios_articulos
        // ✅ ETAPA 2: Agregar rubro, sub_rubro y kilos_unidad para cálculo de precio por kilo
        // ✅ ETAPA 3: Cálculo inteligente de stock para packs (stock virtual)
        const query = `
            SELECT 
                pd.articulo as codigo_barras,
                pd.articulo as articulo_numero,
                COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo) as descripcion,
                pd.cantidad,
                COALESCE(p.fecha_entrega, p.fecha) as fecha_entrega,
                p.id as presupuesto_id,
                p.id_presupuesto_ext,
                
                -- ✅ NUEVO: Precios actuales del artículo (todas las listas)
                COALESCE(pa.precio_neg, 0) as precio_actual_lista1,
                COALESCE(pa.mayorista, 0) as precio_actual_lista2,
                COALESCE(pa.especial_brus, 0) as precio_actual_lista3,
                COALESCE(pa.consumidor_final, 0) as precio_actual_lista4,
                COALESCE(pa.lista_5, 0) as precio_actual_lista5,
                COALESCE(pa.iva, 0) as iva_actual,
                
                -- ✅ ETAPA 2: Rubro y Sub-rubro para agrupación
                COALESCE(pa.rubro, 'Sin categoría') as rubro,
                COALESCE(pa.sub_rubro, 'Sin subcategoría') as sub_rubro,
                
                -- ✅ ETAPA 2: Kilos por unidad para cálculo de precio por kilo
                COALESCE(src.kilos_unidad, 0) as kilos_unidad,
                
                -- ✅ ETAPA 3: Stock inteligente (considera packs)
                CASE
                    -- Si es un pack y tiene hijo asignado
                    WHEN src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 THEN
                        -- Calculamos cuántos packs podemos armar (StockHijo / Unidades)
                        FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / src.pack_unidades)
                    ELSE
                        -- Si es un artículo normal, usamos su stock directo
                        COALESCE(src.stock_consolidado, 0)
                END as stock_consolidado,
                
                -- ✅ NUEVO: Datos de PACK para visualización en historial de precios
                COALESCE(src.es_pack, false) as es_pack,
                COALESCE(src.pack_unidades, 0) as pack_unidades,
                
                -- ✅ NUEVO: Lista de precios del cliente (con CAST explícito para evitar error de tipos)
                CAST(COALESCE(NULLIF(TRIM(CAST(c.lista_precios AS text)), ''), '1') AS integer) as lista_precios_cliente,
                
                -- ✅ STOCK INTELIGENTE CON UMBRAL DE TOLERANCIA: Verificar producibilidad usando vistas de PostgreSQL
                COALESCE(
                    (
                        -- Verificar si tiene receta
                        SELECT 
                            CASE 
                                -- ✅ UMBRAL DE TOLERANCIA: Solo considerar stock si es > 0.001 (evitar residuos decimales)
                                WHEN COALESCE(src.stock_consolidado, 0) > 0.001 THEN false
                                -- Si no tiene stock significativo, verificar si es producible
                                WHEN COUNT(ri.id) = 0 THEN false
                                -- Verificar que TODOS los ingredientes tengan stock suficiente
                                WHEN COUNT(ri.id) = COUNT(
                                    CASE 
                                        -- Para ingredientes SIMPLES: usar v_potencial_ingredientes_simples
                                        WHEN NOT EXISTS (
                                            SELECT 1 FROM ingrediente_composicion ic 
                                            WHERE ic.mix_id = ri.ingrediente_id
                                        ) THEN
                                            CASE 
                                                WHEN COALESCE(
                                                    (SELECT potencial_total 
                                                      FROM v_potencial_ingredientes_simples 
                                                      WHERE ingrediente_id = ri.ingrediente_id),
                                                    0
                                                ) >= ri.cantidad THEN 1
                                            END
                                        -- Para ingredientes MIX: usar v_producibilidad_componentes_mix
                                        WHEN EXISTS (
                                            SELECT 1 FROM ingrediente_composicion ic 
                                            WHERE ic.mix_id = ri.ingrediente_id
                                        ) THEN
                                            CASE 
                                                WHEN COALESCE(
                                                    (SELECT MIN(kilos_mix_posibles) 
                                                      FROM v_producibilidad_componentes_mix 
                                                      WHERE mix_id = ri.ingrediente_id),
                                                    0
                                                ) >= ri.cantidad THEN 1
                                            END
                                    END
                                ) THEN true
                                ELSE false
                            END
                        FROM recetas r
                        LEFT JOIN receta_ingredientes ri ON ri.receta_id = r.id
                        WHERE r.articulo_numero = a.numero
                        GROUP BY r.id
                        LIMIT 1
                    ),
                    false
                ) as es_producible
                
            FROM public.presupuestos p
            INNER JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
            LEFT JOIN public.articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
            LEFT JOIN public.clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
            LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(COALESCE(a.nombre, ba.descripcion))
            LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = COALESCE(a.numero, ba.articulo_id) OR src.codigo_barras = pd.articulo)
            LEFT JOIN public.stock_real_consolidado src_hijo ON (src_hijo.codigo_barras = src.pack_hijo_codigo OR src_hijo.articulo_numero = src.pack_hijo_codigo)
            WHERE (p.id_cliente = $1 OR (p.id_cliente ~ '^[0-9]+$' AND CAST(p.id_cliente AS integer) = $2))
              AND p.activo = true
              AND LOWER(p.estado) = 'entregado'
            ORDER BY fecha_entrega DESC, p.id DESC
        `;

        const clienteIdParsed = parseInt(id_cliente, 10);
        const clienteIdInt = isNaN(clienteIdParsed) ? -1 : clienteIdParsed;
        const result = await req.db.query(query, [id_cliente.toString(), clienteIdInt]);

        console.log(`📦 [PRESUPUESTOS] ${requestId} - Total detalles encontrados: ${result.rows.length}`);

        if (result.rows.length === 0) {
            console.log(`ℹ️ [PRESUPUESTOS] ${requestId} - Cliente sin entregas previas`);
            return res.json({
                success: true,
                data: {
                    cliente_id: id_cliente,
                    total_productos: 0,
                    grupos: [],
                    sin_historial: true
                },
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        // PASO 1: Eliminar duplicados - quedarse con la entrega más reciente por producto
        // Clave única: codigo_barras + articulo_numero
        const productosUnicos = new Map();

        result.rows.forEach(item => {
            const clave = `${item.codigo_barras}|${item.articulo_numero}`;

            // Si no existe o la fecha actual es más reciente, actualizar
            if (!productosUnicos.has(clave)) {
                productosUnicos.set(clave, item);
            } else {
                const existente = productosUnicos.get(clave);
                const fechaExistente = new Date(existente.fecha_entrega);
                const fechaNueva = new Date(item.fecha_entrega);

                if (fechaNueva > fechaExistente) {
                    productosUnicos.set(clave, item);
                }
            }
        });

        const productosUnicosArray = Array.from(productosUnicos.values());
        console.log(`🔍 [PRESUPUESTOS] ${requestId} - Productos únicos (última entrega): ${productosUnicosArray.length}`);

        // PASO 2: Agrupar por buckets temporales
        const ahora = new Date();
        const mesActual = ahora.getMonth();
        const añoActual = ahora.getFullYear();

        // Función helper para calcular diferencia de meses
        const mesesDiferencia = (fecha) => {
            const f = new Date(fecha);
            const diffAnios = añoActual - f.getFullYear();
            const diffMeses = mesActual - f.getMonth();
            return diffAnios * 12 + diffMeses;
        };

        // Nombres de meses en español
        const nombresMeses = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        // Inicializar grupos
        const grupos = {
            mes_actual: { label: `${nombresMeses[mesActual]} ${añoActual}`, productos: [] },
            mes_1: { label: '', productos: [] },
            mes_2: { label: '', productos: [] },
            mes_3: { label: '', productos: [] },
            mes_4: { label: '', productos: [] },
            mes_5: { label: '', productos: [] },
            mes_6: { label: '', productos: [] },
            historico: { label: 'Más de 6 meses', productos: [] }
        };

        // Calcular labels para meses anteriores
        for (let i = 1; i <= 6; i++) {
            const fecha = new Date(añoActual, mesActual - i, 1);
            const mes = fecha.getMonth();
            const año = fecha.getFullYear();
            grupos[`mes_${i}`].label = `${nombresMeses[mes]} ${año}`;
        }

        // Clasificar productos en grupos
        productosUnicosArray.forEach(producto => {
            const mesesAtras = mesesDiferencia(producto.fecha_entrega);

            // Helper function para calcular precio según lista
            const calcularPrecioSegunLista = (lista, precios) => {
                const listaNum = parseInt(lista) || 1;

                switch (listaNum) {
                    case 1: return parseFloat(precios.precio_neg || 0);
                    case 2: return parseFloat(precios.mayorista || 0);
                    case 3: return parseFloat(precios.especial_brus || 0);
                    case 4: return parseFloat(precios.consumidor_final || 0);
                    case 5: return parseFloat(precios.lista_5 || 0);
                    default: return parseFloat(precios.precio_neg || 0);
                }
            };

            // Calcular precio actual según lista del cliente
            const precioActual = calcularPrecioSegunLista(
                producto.lista_precios_cliente,
                {
                    precio_neg: producto.precio_actual_lista1,
                    mayorista: producto.precio_actual_lista2,
                    especial_brus: producto.precio_actual_lista3,
                    consumidor_final: producto.precio_actual_lista4,
                    lista_5: producto.precio_actual_lista5
                }
            );

            // ✅ ETAPA 2: Calcular precio por kilo
            const kilosUnidad = parseFloat(producto.kilos_unidad || 0);
            const precioPorKilo = kilosUnidad > 0 ? parseFloat((precioActual / kilosUnidad).toFixed(2)) : 0;

            // ✅ AUDITORÍA: Log para casos específicos de debugging
            const stockConsolidado = parseFloat(producto.stock_consolidado || 0);
            const esProducible = producto.es_producible === true || producto.es_producible === 't';

            // Log de auditoría para artículos con "mariposa" en el nombre
            if (producto.descripcion && producto.descripcion.toLowerCase().includes('mariposa')) {
                console.log(`🕵️ [AUDITORÍA-STOCK] ${requestId} - Artículo Mariposa detectado:`, {
                    nombre: producto.descripcion,
                    stock_raw: producto.stock_consolidado,
                    stock_parseado: stockConsolidado,
                    es_producible_raw: producto.es_producible,
                    es_producible_parseado: esProducible,
                    tipo_dato_stock: typeof producto.stock_consolidado,
                    tiene_stock_significativo: stockConsolidado > 0.001
                });
            }

            const productoFormateado = {
                codigo_barras: producto.codigo_barras,
                articulo_numero: producto.articulo_numero,
                descripcion: producto.descripcion,
                cantidad: parseFloat(producto.cantidad || 0),
                fecha_entrega: producto.fecha_entrega,
                presupuesto_id: producto.presupuesto_id,

                // ✅ NUEVO: Precio actual según lista del cliente
                precio_actual: precioActual,
                iva_actual: parseFloat(producto.iva_actual || 0),
                lista_precios: parseInt(producto.lista_precios_cliente || 1),

                // ✅ ETAPA 2: Datos adicionales para agrupación y cálculos
                rubro: producto.rubro || 'Sin categoría',
                sub_rubro: producto.sub_rubro || 'Sin subcategoría',
                kilos_unidad: kilosUnidad,
                precio_por_kilo: precioPorKilo,

                // ✅ ETAPA 2: Stock consolidado para visualización (con umbral de tolerancia)
                stock_consolidado: stockConsolidado,

                // ✅ NUEVO: Datos de PACK para visualización en frontend
                es_pack: producto.es_pack === true || producto.es_pack === 't',
                pack_unidades: parseInt(producto.pack_unidades || 0),

                // ✅ NUEVO: Stock Inteligente - Indicador de producibilidad
                es_producible: esProducible
            };

            if (mesesAtras === 0) {
                grupos.mes_actual.productos.push(productoFormateado);
            } else if (mesesAtras === 1) {
                grupos.mes_1.productos.push(productoFormateado);
            } else if (mesesAtras === 2) {
                grupos.mes_2.productos.push(productoFormateado);
            } else if (mesesAtras === 3) {
                grupos.mes_3.productos.push(productoFormateado);
            } else if (mesesAtras === 4) {
                grupos.mes_4.productos.push(productoFormateado);
            } else if (mesesAtras === 5) {
                grupos.mes_5.productos.push(productoFormateado);
            } else if (mesesAtras === 6) {
                grupos.mes_6.productos.push(productoFormateado);
            } else {
                grupos.historico.productos.push(productoFormateado);
            }
        });

        // Convertir a array y filtrar grupos vacíos
        const gruposArray = [
            { key: 'mes_actual', ...grupos.mes_actual },
            { key: 'mes_1', ...grupos.mes_1 },
            { key: 'mes_2', ...grupos.mes_2 },
            { key: 'mes_3', ...grupos.mes_3 },
            { key: 'mes_4', ...grupos.mes_4 },
            { key: 'mes_5', ...grupos.mes_5 },
            { key: 'mes_6', ...grupos.mes_6 },
            { key: 'historico', ...grupos.historico }
        ].filter(grupo => grupo.productos.length > 0);

        console.log(`✅ [PRESUPUESTOS] ${requestId} - Historial agrupado en ${gruposArray.length} períodos`);
        console.log(`📊 [PRESUPUESTOS] ${requestId} - Distribución:`,
            gruposArray.map(g => `${g.label}: ${g.productos.length}`).join(', ')
        );

        // Obtener datos del cliente para el encabezado
        let datosCliente = {
            cliente_id: id_cliente,
            nombre: null,
            apellido: null
        };

        try {
            const clienteQuery = `
                SELECT cliente_id, nombre, apellido
                FROM public.clientes
                WHERE cliente_id = $1
                LIMIT 1
            `;
            const clienteResult = await req.db.query(clienteQuery, [parseInt(id_cliente)]);

            if (clienteResult.rows.length > 0) {
                datosCliente = {
                    cliente_id: clienteResult.rows[0].cliente_id,
                    nombre: clienteResult.rows[0].nombre,
                    apellido: clienteResult.rows[0].apellido
                };
            }
        } catch (errorCliente) {
            console.warn(`⚠️ [PRESUPUESTOS] ${requestId} - No se pudieron cargar datos del cliente`);
        }

        res.json({
            success: true,
            data: {
                cliente_id: datosCliente.cliente_id,
                cliente_nombre: datosCliente.nombre,
                cliente_apellido: datosCliente.apellido,
                total_productos_unicos: productosUnicosArray.length,
                total_registros_originales: result.rows.length,
                grupos: gruposArray
            },
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error al obtener historial de entregas:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial de entregas del cliente',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener catálogo general de productos con precios
 * Vista plana sin filtro de cliente específico
 * ✅ CORREGIDO: Consulta SQL simplificada y manejo robusto de errores
 */
const obtenerCatalogoGeneral = async (req, res) => {
    const requestId = `catalogo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Obteniendo catálogo general`);

    try {
        const { cliente_id, page = 1, pageSize = 50, search = '' } = req.query;

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Parámetros:`, {
            cliente_id,
            page,
            pageSize,
            search: search ? `"${search}"` : '(vacío)'
        });

        // Determinar lista de precios del cliente (default 1)
        let listaPrecios = 1;
        if (cliente_id) {
            try {
                console.log(`🔍 [PRESUPUESTOS] ${requestId} - Consultando lista de precios del cliente ${cliente_id}`);
                const clienteQuery = await req.db.query(
                    'SELECT lista_precios FROM public.clientes WHERE cliente_id = $1 LIMIT 1',
                    [parseInt(cliente_id)]
                );
                if (clienteQuery.rows.length > 0) {
                    const lista = parseInt(clienteQuery.rows[0].lista_precios);
                    if (!isNaN(lista) && lista >= 1 && lista <= 5) {
                        listaPrecios = lista;
                        console.log(`✅ [PRESUPUESTOS] ${requestId} - Lista de precios del cliente: ${listaPrecios}`);
                    }
                }
            } catch (error) {
                console.warn(`⚠️ [PRESUPUESTOS] ${requestId} - Error obteniendo lista de precios del cliente:`, error.message);
            }
        }

        const currentPage = parseInt(page);
        const itemsPerPage = parseInt(pageSize);
        const offset = (currentPage - 1) * itemsPerPage;

        console.log(`📄 [PRESUPUESTOS] ${requestId} - Paginación: página ${currentPage}, ${itemsPerPage} items por página`);

        // ✅ CONSULTA OPTIMIZADA: Incluye articulo_numero desde stock_real_consolidado
        // ✅ CRÍTICO: JOIN mejorado para obtener siempre el código alfanumérico correcto
        let query = `
            SELECT
                pa.descripcion,
                src.articulo_numero,
                pa.precio_neg as precio_lista1,
                pa.mayorista as precio_lista2,
                pa.especial_brus as precio_lista3,
                pa.consumidor_final as precio_lista4,
                pa.lista_5 as precio_lista5,
                pa.iva,
                pa.rubro,
                pa.sub_rubro,
                COALESCE(src.stock_consolidado, 0) as stock_consolidado,
                COALESCE(src.kilos_unidad, 0) as kilos_unidad,
                COALESCE(src.es_pack, false) as es_pack,
                COALESCE(src.pack_unidades, 0) as pack_unidades
            FROM public.precios_articulos pa
            INNER JOIN public.stock_real_consolidado src ON LOWER(pa.descripcion) = LOWER(src.descripcion)
            WHERE src.articulo_numero IS NOT NULL
        `;

        const params = [];
        let paramCount = 0;

        // Filtro de búsqueda
        if (search && search.trim()) {
            paramCount++;
            query += ` AND LOWER(pa.descripcion) ILIKE $${paramCount}`;
            params.push(`%${search.trim().toLowerCase()}%`);
            console.log(`🔍 [PRESUPUESTOS] ${requestId} - Aplicando filtro de búsqueda: "${search}"`);
        }

        // Consulta para totales
        console.log(`📊 [PRESUPUESTOS] ${requestId} - Ejecutando consulta de conteo...`);
        const countQuery = query.replace(/SELECT[\s\S]+FROM/, 'SELECT COUNT(*) as total FROM');

        let totalRecords = 0;
        try {
            const countResult = await req.db.query(countQuery, params);
            totalRecords = parseInt(countResult.rows[0].total);
            console.log(`✅ [PRESUPUESTOS] ${requestId} - Total de registros encontrados: ${totalRecords}`);
        } catch (countError) {
            console.error(`❌ [PRESUPUESTOS] ${requestId} - Error en consulta de conteo:`, countError.message);
            throw new Error(`Error al contar registros: ${countError.message}`);
        }

        // Agregar ordenamiento y paginación
        query += ` ORDER BY pa.descripcion ASC`;

        if (itemsPerPage > 0) {
            paramCount++;
            query += ` LIMIT $${paramCount}`;
            params.push(itemsPerPage);

            paramCount++;
            query += ` OFFSET $${paramCount}`;
            params.push(offset);
        }

        console.log(`📋 [PRESUPUESTOS] ${requestId} - Ejecutando consulta principal...`);
        console.log(`📋 [PRESUPUESTOS] ${requestId} - SQL:`, query.substring(0, 200) + '...');
        console.log(`📋 [PRESUPUESTOS] ${requestId} - Parámetros:`, params);

        let result;
        try {
            result = await req.db.query(query, params);
            console.log(`✅ [PRESUPUESTOS] ${requestId} - Consulta ejecutada: ${result.rows.length} filas obtenidas`);
        } catch (queryError) {
            console.error(`❌ [PRESUPUESTOS] ${requestId} - Error en consulta principal:`, queryError.message);
            console.error(`❌ [PRESUPUESTOS] ${requestId} - Stack:`, queryError.stack);
            throw new Error(`Error al ejecutar consulta: ${queryError.message}`);
        }

        // ✅ PROCESAMIENTO EN JAVASCRIPT: Calcular stock virtual aquí en lugar de SQL
        console.log(`🔄 [PRESUPUESTOS] ${requestId} - Procesando resultados...`);
        const productos = result.rows.map((producto, index) => {
            try {
                // Determinar precio según lista
                let precioActual = 0;
                switch (listaPrecios) {
                    case 1: precioActual = parseFloat(producto.precio_lista1 || 0); break;
                    case 2: precioActual = parseFloat(producto.precio_lista2 || 0); break;
                    case 3: precioActual = parseFloat(producto.precio_lista3 || 0); break;
                    case 4: precioActual = parseFloat(producto.precio_lista4 || 0); break;
                    case 5: precioActual = parseFloat(producto.precio_lista5 || 0); break;
                    default: precioActual = parseFloat(producto.precio_lista1 || 0);
                }

                // Calcular precio por kilo si aplica
                const kilosUnidad = parseFloat(producto.kilos_unidad || 0);
                const precioPorKilo = kilosUnidad > 0 ? parseFloat((precioActual / kilosUnidad).toFixed(2)) : 0;

                // ✅ CÁLCULO DE STOCK VIRTUAL EN JAVASCRIPT
                const stockConsolidado = parseFloat(producto.stock_consolidado || 0);
                const esPack = producto.es_pack === true || producto.es_pack === 't';
                const packUnidades = parseInt(producto.pack_unidades || 0);

                let stockVirtual = stockConsolidado;
                if (esPack && packUnidades > 0) {
                    stockVirtual = Math.floor(stockConsolidado / packUnidades);
                }

                return {
                    descripcion: producto.descripcion,
                    articulo_numero: producto.articulo_numero, // ✅ SIEMPRE viene del INNER JOIN
                    precio_actual: precioActual,
                    iva: parseFloat(producto.iva || 0),
                    lista_precios: listaPrecios,
                    rubro: producto.rubro || 'Sin categoría',
                    sub_rubro: producto.sub_rubro || 'Sin subcategoría',
                    stock_consolidado: stockVirtual,
                    kilos_unidad: kilosUnidad,
                    precio_por_kilo: precioPorKilo,
                    es_pack: esPack,
                    pack_unidades: packUnidades
                };
            } catch (processingError) {
                console.error(`❌ [PRESUPUESTOS] ${requestId} - Error procesando producto ${index}:`, processingError.message);
                console.error(`❌ [PRESUPUESTOS] ${requestId} - Producto problemático:`, producto);
                // Retornar producto con valores por defecto en caso de error
                return {
                    descripcion: producto.descripcion || 'Sin descripción',
                    precio_actual: 0,
                    iva: 0,
                    lista_precios: listaPrecios,
                    rubro: 'Sin categoría',
                    sub_rubro: 'Sin subcategoría',
                    stock_consolidado: 0,
                    kilos_unidad: 0,
                    precio_por_kilo: 0,
                    es_pack: false,
                    pack_unidades: 0
                };
            }
        });

        console.log(`✅ [PRESUPUESTOS] ${requestId} - Catálogo general obtenido: ${productos.length} productos de ${totalRecords} totales`);
        console.log(`📊 [PRESUPUESTOS] ${requestId} - Muestra de productos:`, productos.slice(0, 3).map(p => p.descripcion));

        res.json({
            success: true,
            data: productos,
            total: totalRecords,
            page: currentPage,
            pageSize: itemsPerPage,
            pages: Math.ceil(totalRecords / itemsPerPage),
            lista_precios_cliente: listaPrecios,
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error obteniendo catálogo general:`, error.message);
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Stack completo:`, error.stack);

        // ✅ RESPUESTA DE ERROR MÁS DESCRIPTIVA
        res.status(500).json({
            success: false,
            error: 'Error al obtener catálogo general',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener artículos excluidos de un cliente
 * Devuelve lista agrupada por rubro y sub-rubro
 */
const obtenerArticulosExcluidos = async (req, res) => {
    const requestId = `excluidos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Obteniendo artículos excluidos`);

    try {
        const { id_cliente } = req.params;

        if (!id_cliente) {
            return res.status(400).json({
                success: false,
                error: 'ID de cliente requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Buscando artículos excluidos para cliente ID: ${id_cliente}`);

        // Consulta para obtener artículos excluidos con información completa
        // ✅ OPTIMIZADO: JOIN robusto para obtener rubro y sub-rubro correctamente
        const query = `
            SELECT 
                ae.id,
                ae.cliente_id,
                ae.articulo_numero,
                ae.fecha_creacion,
                COALESCE(a.nombre, ae.articulo_numero) as descripcion,
                COALESCE(pa.rubro, 'Sin categoría') as rubro,
                COALESCE(pa.sub_rubro, 'Sin subcategoría') as sub_rubro,
                COALESCE(pa.precio_neg, 0) as precio_lista1,
                COALESCE(pa.mayorista, 0) as precio_lista2,
                COALESCE(pa.especial_brus, 0) as precio_lista3,
                COALESCE(pa.consumidor_final, 0) as precio_lista4,
                COALESCE(pa.lista_5, 0) as precio_lista5,
                COALESCE(pa.iva, 0) as iva
            FROM public.articulos_excluidos_config ae
            LEFT JOIN public.articulos a ON a.numero = ae.articulo_numero
            LEFT JOIN public.precios_articulos pa ON LOWER(pa.descripcion) = LOWER(a.nombre)
            WHERE ae.cliente_id = $1
            ORDER BY 
                CASE 
                    WHEN pa.rubro IS NULL THEN 1 
                    ELSE 0 
                END,
                pa.rubro ASC,
                pa.sub_rubro ASC,
                ae.fecha_creacion DESC
        `;

        const result = await req.db.query(query, [parseInt(id_cliente)]);

        console.log(`📦 [PRESUPUESTOS] ${requestId} - Artículos excluidos encontrados: ${result.rows.length}`);

        // Agrupar por rubro y sub-rubro
        const articulosAgrupados = {};

        result.rows.forEach(articulo => {
            const rubro = articulo.rubro || 'Sin categoría';
            const subRubro = articulo.sub_rubro || 'Sin subcategoría';

            if (!articulosAgrupados[rubro]) {
                articulosAgrupados[rubro] = {};
            }

            if (!articulosAgrupados[rubro][subRubro]) {
                articulosAgrupados[rubro][subRubro] = [];
            }

            articulosAgrupados[rubro][subRubro].push({
                id: articulo.id,
                articulo_numero: articulo.articulo_numero,
                descripcion: articulo.descripcion,
                rubro: articulo.rubro,
                sub_rubro: articulo.sub_rubro,
                fecha_creacion: articulo.fecha_creacion
            });
        });

        res.json({
            success: true,
            data: {
                cliente_id: parseInt(id_cliente),
                total_excluidos: result.rows.length,
                articulos_agrupados: articulosAgrupados,
                articulos_planos: result.rows
            },
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error al obtener artículos excluidos:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener artículos excluidos',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Excluir un artículo para un cliente
 */
const excluirArticulo = async (req, res) => {
    const requestId = `excluir-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Excluyendo artículo`);

    try {
        const { id_cliente } = req.params;
        const { articulo_numero } = req.body;

        if (!id_cliente || !articulo_numero) {
            return res.status(400).json({
                success: false,
                error: 'ID de cliente y código de artículo requeridos',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Excluyendo artículo ${articulo_numero} para cliente ${id_cliente}`);

        // Insertar en tabla de exclusiones (ON CONFLICT para evitar duplicados)
        const query = `
            INSERT INTO public.articulos_excluidos_config (cliente_id, articulo_numero)
            VALUES ($1, $2)
            ON CONFLICT (cliente_id, articulo_numero) DO NOTHING
            RETURNING id, cliente_id, articulo_numero, fecha_creacion
        `;

        const result = await req.db.query(query, [parseInt(id_cliente), articulo_numero.trim()]);

        if (result.rows.length === 0) {
            console.log(`ℹ️ [PRESUPUESTOS] ${requestId} - Artículo ya estaba excluido`);
            return res.json({
                success: true,
                message: 'El artículo ya estaba excluido',
                data: null,
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const articuloExcluido = result.rows[0];
        console.log(`✅ [PRESUPUESTOS] ${requestId} - Artículo excluido exitosamente:`, articuloExcluido);

        res.status(201).json({
            success: true,
            message: 'Artículo excluido exitosamente',
            data: articuloExcluido,
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error al excluir artículo:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al excluir artículo',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Re-incluir un artículo excluido (eliminar de exclusiones)
 */
const reincluirArticulo = async (req, res) => {
    const requestId = `reincluir-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔍 [PRESUPUESTOS] ${requestId} - Re-incluyendo artículo`);

    try {
        const { id_cliente, articulo_numero } = req.params;

        if (!id_cliente || !articulo_numero) {
            return res.status(400).json({
                success: false,
                error: 'ID de cliente y código de artículo requeridos',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📊 [PRESUPUESTOS] ${requestId} - Re-incluyendo artículo ${articulo_numero} para cliente ${id_cliente}`);

        // Eliminar de tabla de exclusiones
        const query = `
            DELETE FROM public.articulos_excluidos_config
            WHERE cliente_id = $1 AND articulo_numero = $2
            RETURNING id, cliente_id, articulo_numero
        `;

        const result = await req.db.query(query, [parseInt(id_cliente), articulo_numero.trim()]);

        if (result.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] ${requestId} - Artículo no estaba excluido`);
            return res.status(404).json({
                success: false,
                error: 'El artículo no estaba excluido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const articuloReincluido = result.rows[0];
        console.log(`✅ [PRESUPUESTOS] ${requestId} - Artículo re-incluido exitosamente:`, articuloReincluido);

        res.json({
            success: true,
            message: 'Artículo re-incluido exitosamente',
            data: articuloReincluido,
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] ${requestId} - Error al re-incluir artículo:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al re-incluir artículo',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS] Controlador de presupuestos configurado con CRUD completo');

/**
 * Obtener historial específico de un artículo para un cliente (Vinculación Retiro)
 */
const obtenerHistorialArticuloCliente = async (req, res) => {
    try {
        const { cliente_id, articulo_codigo, descripcion } = req.query;

        if (!cliente_id || (!articulo_codigo && !descripcion)) {
            return res.status(400).json({
                success: false,
                error: 'Faltan parámetros requeridos (cliente_id y articulo_codigo/descripcion)'
            });
        }

        console.log(`🔍 [PRESUPUESTOS] Buscando historial artículo: Cliente=${cliente_id}, Codigo=${articulo_codigo}`);

        // Buscar en detalles de presupuestos entregados/finalizados
        // Asumiendo que 'estado_logistico' = 'RETIRADO' o 'ENTREGADO' o el presupuesto 'estado' = 'Entregado'
        const query = `
            SELECT 
                p.id as id_presupuesto,
                p.fecha,
                d.cantidad,
                d.precio_unitario, -- Asegurarse si es precio_unitario o precio1/valor1 según tabla real
                d.articulo_codigo,
                d.articulo_nombre as descripcion
            FROM presupuestos p
            JOIN presupuestos_detalles d ON d.id_presupuesto = p.id
            WHERE p.id_cliente = $1::text 
              AND (d.articulo_codigo = $2 OR d.articulo_nombre ILIKE $3)
              AND (p.estado_logistico IN ('RETIRADO', 'ENTREGADO') OR p.estado = 'Entregado')
            ORDER BY p.fecha DESC
            LIMIT 10
        `;

        // Nota: Ajustar nombres de columnas según inspección real si difieren (confirmado: id_presupuesto, articulo_codigo en detalles?)
        // En inspection vi: id_presupuesto, articulo_codigo... Valor1?
        // Voy a usar un query más genérico o ajustado si falla, pero por ahora esto es el diseño.
        // Si precio_unitario no existe, usar valor1 * (1 + iva/100) si aplica, o simplemente mostrar el valor guardado.

        // Resolver el artículo tanto por SKU como por Código de Barras para garantizar coincidencias cruzadas
        let artNumero = articulo_codigo || '';
        let artBarcode = articulo_codigo || '';
        let artNombre = descripcion || '';

        try {
            const artInfo = await req.db.query(`
                SELECT numero, codigo_barras, nombre 
                FROM public.articulos 
                WHERE numero = $1 OR codigo_barras = $1 OR nombre ILIKE $2
                LIMIT 1
            `, [articulo_codigo, descripcion ? `%${descripcion}%` : '']);
            if (artInfo.rows.length > 0) {
                artNumero = artInfo.rows[0].numero || artNumero;
                artBarcode = artInfo.rows[0].codigo_barras || artBarcode;
                if (!artNombre && artInfo.rows[0].nombre) {
                    artNombre = artInfo.rows[0].nombre;
                }
            }
        } catch (eArt) {
            console.warn('⚠️ [PRESUPUESTOS] No se pudo resolver artículo extendido:', eArt.message);
        }

        const queryReal = `
            SELECT * FROM (
                SELECT DISTINCT ON (p.id)
                    p.id as id_presupuesto,
                    p.fecha,
                    p.comprobante_lomasoft,
                    -- Determinación robusta de Origen priorizando Lomas Soft (Ticket 14)
                    CASE 
                        WHEN p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '' THEN 
                            'LOMASOFT (Puesto ' || SPLIT_PART(p.comprobante_lomasoft, '-', 2) || ')'
                        WHEN f.pto_vta = 32 AND f.cbte_nro IS NOT NULL THEN 'LAMDA (Pto 32, Factura ' || f.cbte_nro || ')'
                        WHEN f.pto_vta = 32 THEN 'LAMDA (Puesto 32)'
                        WHEN f.pto_vta IS NOT NULL AND f.cbte_nro IS NOT NULL THEN 'LOMASOFT (Pto ' || f.pto_vta || ', Factura ' || f.cbte_nro || ')'
                        WHEN f.pto_vta IS NOT NULL THEN 'LOMASOFT (Puesto ' || f.pto_vta || ')'
                        WHEN p.origen_facturacion != 'PENDIENTE' THEN p.origen_facturacion
                        ELSE 'NO FACTURADO'
                    END as origen_facturacion,
                    f.pto_vta,
                    f.cbte_nro,
                    f.id as factura_id,
                    p.usar_precios_bunker,
                    d.cantidad,
                    d.precio1 as precio_unitario_historico, -- Precio con IVA guardado
                    d.valor1 as precio_neto_historico,      -- Precio NETO guardado (para comparativas)
                    d.camp2 as alic_iva,
                    COALESCE(d.descuento_adicional, 0) as descuento_adicional,
                    -- Usamos 'articulo' que contiene la descripción completa (o código en algunos casos)
                    d.articulo as descripcion,
                    CASE 
                        WHEN p.descuento > 1 THEN p.descuento 
                        ELSE COALESCE(p.descuento, 0) * 100 
                    END as descuento_porcentaje
                FROM presupuestos p
                JOIN presupuestos_detalles d ON d.id_presupuesto = p.id
                LEFT JOIN (
                    -- Subquery para traer la última factura aprobada por si hay múltiples
                    SELECT id, presupuesto_id, pto_vta, cbte_nro, estado,
                           ROW_NUMBER() OVER(PARTITION BY presupuesto_id ORDER BY id DESC) as rn
                    FROM factura_facturas 
                    WHERE estado IN ('APROBADA', 'APROBADA_LOCAL')
                ) f ON f.presupuesto_id = p.id AND f.rn = 1
                WHERE (p.id_cliente = $1::text OR LTRIM(p.id_cliente::text, '0') = LTRIM($1::text, '0'))
                  AND (
                      d.articulo = $2 
                      OR d.articulo = $3 
                      OR d.articulo ILIKE $4
                      OR (d.articulo ILIKE $5 AND $5 != '')
                      OR EXISTS (
                          SELECT 1 FROM public.articulos a_match
                          WHERE (a_match.numero = d.articulo OR a_match.codigo_barras = d.articulo)
                            AND (a_match.numero = $2 OR a_match.codigo_barras = $3)
                      )
                  )
                  -- QA Bugfix 2: Permitir devoluciones de historial FACTURADO
                  AND (
                      p.estado_logistico IN ('RETIRADO', 'ENTREGADO') 
                      OR p.estado IN ('Entregado', 'Confirmado')
                      OR f.pto_vta IS NOT NULL
                      OR (p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '')
                  )
                  -- QA Modification: Excluir explícitamente Órdenes de Retiro
                  AND p.tipo_comprobante != 'Orden de Retiro'
                ORDER BY p.id, p.fecha DESC
            ) sub
            ORDER BY sub.fecha DESC
            LIMIT 10
        `;

        const queryParams = [
            cliente_id,
            artNumero,
            artBarcode,
            `%${articulo_codigo || ''}%`,
            artNombre ? `%${artNombre}%` : ''
        ];

        // VIGÍA DEPURADOR: Trámite Administrativo (Modal de vinculación por artículo)
        console.log('\n======================================================');
        console.log('🚨 VIGÍA DEPURADOR: Búsqueda Artículo Historial (Posible Trámite Admin NC)');
        console.log('------------------------------------------------------');
        console.log('➡️ Query cruda a DB:\n', queryReal);
        console.log('➡️ Parámetros inyectados:', queryParams);

        // Usamos wildcards para ILIKE en ambos parámetros para maximizar probabilidad de match
        const result = await req.db.query(queryReal, queryParams);

        // MEJORA: Buscar los artículos de cada presupuesto devuelto para renderizar el desglose en el modal
        if (result.rows.length > 0) {
            const budgetIds = result.rows.map(r => parseInt(r.id_presupuesto)).filter(id => !isNaN(id));
            if (budgetIds.length > 0) {
                const itemsQuery = `
                    SELECT 
                        pd.id_presupuesto,
                        pd.articulo as codigo,
                        COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo) as nombre,
                        pd.cantidad
                    FROM public.presupuestos_detalles pd
                    LEFT JOIN public.articulos a ON (a.numero = pd.articulo OR a.codigo_barras = pd.articulo)
                    LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
                    WHERE pd.id_presupuesto = ANY($1)
                `;
                const itemsResult = await req.db.query(itemsQuery, [budgetIds]);
                
                // Mapear los ítems a cada fila de presupuesto
                result.rows.forEach(row => {
                    row.items_detalle = itemsResult.rows
                        .filter(item => parseInt(item.id_presupuesto) === parseInt(row.id_presupuesto))
                        .map(item => ({
                            codigo: item.codigo || 'N/A',
                            nombre: item.nombre || 'N/A',
                            cantidad: parseFloat(item.cantidad) || 0
                        }));
                });
            }
        }

        console.log(`➡️ Registros devueltos por DB (crudas): ${result.rows.length}`);
        console.log('➡️ Resultados (primeros 3):', result.rows.slice(0, 3).map(r => ({id_presupuesto: r.id_presupuesto, fecha: r.fecha, descripcion: r.descripcion})));
        console.log('======================================================\n');

        res.json({
            success: true,
            data: result.rows,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error historial articulo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Obtener artículos comprados habitualmente por el cliente (frecuencia y última fecha)
 * GET /api/presupuestos/clientes/:id_cliente/articulos-habituales
 */
const obtenerArticulosHabitualesCliente = async (req, res) => {
    try {
        const { id_cliente } = req.params;
        if (!id_cliente) {
            return res.status(400).json({ success: false, error: 'ID de cliente requerido' });
        }

        const ClientesBunkerModel = require('../../logistica/models/clientesBunkerModel');
        const data = await ClientesBunkerModel.obtenerArticulosComprados(id_cliente);

        return res.json({
            success: true,
            cliente_id: id_cliente,
            total: data.length,
            data: data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener artículos habituales del cliente:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al obtener artículos habituales del cliente',
            message: error.message
        });
    }
};

/**
 * Auditoría y Trazabilidad Completa de Rentabilidad Estimada (Búnker) para un Presupuesto
 * POST /api/presupuestos/auditoria-rentabilidad
 */
const obtenerAuditoriaRentabilidadBunker = async (req, res) => {
    try {
        const db = req.db || require('../config/database').pool;
        req.db = db;
        const body = req.body || {};
        const presupuestoId = body.presupuesto_id || null;
        const idCliente = parseInt(body.cliente_id || body.id_cliente, 10) || 0;
        const tipoComprobante = body.tipo_comprobante || 'Factura';
        const rawDescGen = body.descuento_general !== undefined ? body.descuento_general : body.descuento_general_pct;
        const descGenPct = Math.max(0, Math.min(100, parseFloat(rawDescGen) || 0));
        const usarPreciosBunker = body.usar_precios_bunker === true || body.usar_precios_bunker === 'true';
        const itemsInput = Array.isArray(body.items) ? body.items : [];

        // 1) Resolver lista de precios Búnker y nombre del cliente
        let listaId = body.lista_id ? parseInt(body.lista_id, 10) : null;
        let listaNombre = 'Lista Patrón / General';
        let clienteNombre = body.cliente_nombre || '';

        if (idCliente > 0) {
            try {
                const rCli = await req.db.query(`
                    SELECT COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, '') as nombre_completo
                    FROM public.clientes c
                    WHERE c.cliente_id = $1
                    LIMIT 1
                `, [idCliente]);
                if (rCli.rows.length > 0 && rCli.rows[0].nombre_completo.trim()) {
                    clienteNombre = rCli.rows[0].nombre_completo.trim();
                }

                const queryList = `
                    SELECT bclp.bunker_lista_precio_id, blp.nombre as lista_nombre, bc.razon_social
                    FROM public.bunker_cliente_listas_precios bclp
                    JOIN public.bunker_clientes bc ON bc.id = bclp.bunker_cliente_id
                    LEFT JOIN public.bunker_listas_precios blp ON blp.id = bclp.bunker_lista_precio_id
                    WHERE bc.lomas_soft_id = LPAD($1, 4, '0')
                       OR bc.lomas_soft_id = $1
                       OR (CASE WHEN $1 ~ '^[0-9]+$' AND LENGTH($1) < 10 THEN bc.id = $1::integer ELSE false END)
                    LIMIT 1
                `;
                const rList = await req.db.query(queryList, [String(idCliente)]);
                if (rList.rows.length > 0) {
                    if (!listaId) listaId = rList.rows[0].bunker_lista_precio_id;
                    if (rList.rows[0].lista_nombre) listaNombre = rList.rows[0].lista_nombre;
                    if (!clienteNombre && rList.rows[0].razon_social) clienteNombre = rList.rows[0].razon_social;
                }
            } catch (errCli) {
                console.warn('⚠️ [AUDITORIA-RENTABILIDAD] Error resolviendo cliente/lista:', errCli.message);
            }
        }

        // 2) Cargar tarifas horarias de colaboradores para trazabilidad de mano de obra
        const colaboradoresMap = new Map();
        try {
            const rColab = await req.db.query(`
                SELECT u.id as usuario_id, COALESCE(u.nombre_completo, u.usuario) as nombre,
                       ct.valor_hora
                FROM public.usuarios u
                LEFT JOIN LATERAL (
                    SELECT valor_hora
                    FROM public.colaboradores_tarifas ct2
                    WHERE ct2.usuario_id = u.id AND ct2.activo = true
                    ORDER BY ct2.id DESC
                    LIMIT 1
                ) ct ON true
            `);
            rColab.rows.forEach(r => {
                colaboradoresMap.set(Number(r.usuario_id), {
                    usuario_id: Number(r.usuario_id),
                    nombre: r.nombre || `Operario #${r.usuario_id}`,
                    valor_hora: parseFloat(r.valor_hora) || 0
                });
            });
        } catch (errColab) {
            console.warn('⚠️ [AUDITORIA-RENTABILIDAD] No se pudieron cargar colaboradores:', errColab.message);
        }

        const BunkerService = require('../../logistica/services/bunkerService');

        // Helper para enriquecer ingrediente (incluyendo si proviene de artículo puente o mix)
        const enriquecerIngredienteTrazabilidad = async (ing) => {
            const ingId = ing.ingrediente_id;
            const cant = parseFloat(ing.cantidad) || 0;
            const costoPatron = parseFloat(ing.costo_patron) || 0;
            const subtotal = cant * costoPatron;

            let detalleOrigen = null;
            if (ingId) {
                try {
                    const rIng = await req.db.query(`
                        SELECT id, nombre, unidad_medida, costo_patron, es_insumo, receta_base_kg, articulo_vinculado_numero
                        FROM public.ingredientes
                        WHERE id = $1
                        LIMIT 1
                    `, [parseInt(ingId, 10)]);
                    if (rIng.rows.length > 0) {
                        const rowIng = rIng.rows[0];
                        const artVinc = rowIng.articulo_vinculado_numero;
                        let composicionMix = [];
                        let puenteInfo = null;

                        // Verificar si el ingrediente directo es un mix en ingrediente_composicion
                        const rCompDirect = await req.db.query(`
                            SELECT ic.cantidad, i.nombre, i.unidad_medida, i.costo_patron
                            FROM public.ingrediente_composicion ic
                            JOIN public.ingredientes i ON i.id = ic.ingrediente_id
                            WHERE ic.mix_id = $1
                            ORDER BY ic.id ASC
                        `, [rowIng.id]);

                        if (rCompDirect.rows.length > 0) {
                            composicionMix = rCompDirect.rows.map(c => ({
                                nombre: c.nombre,
                                cantidad: parseFloat(c.cantidad) || 0,
                                unidad_medida: c.unidad_medida || 'Kilo',
                                costo_patron: parseFloat(c.costo_patron) || 0,
                                subtotal: (parseFloat(c.cantidad) || 0) * (parseFloat(c.costo_patron) || 0)
                            }));
                        }

                        // Si tiene artículo vinculado (ej. MSXK, HTLN4x5, CHB10X1), consultar su estructura
                        if (artVinc) {
                            const rArtVinc = await req.db.query(`
                                SELECT ba.articulo_id, COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion,
                                       ba.kilos_unidad, ba.costo_base, ba.propiedades_dinamicas,
                                       la.costo_base_sobrescrito, la.costo_tiempo, la.precio_final
                                FROM public.bunker_articulos ba
                                LEFT JOIN public.bunker_lista_articulos la ON la.articulo_numero = ba.articulo_id AND la.lista_id = $2
                                WHERE ba.articulo_id = $1
                                LIMIT 1
                            `, [artVinc, listaId || 1]);

                            if (rArtVinc.rows.length > 0) {
                                const av = rArtVinc.rows[0];
                                let avProps = av.propiedades_dinamicas || {};
                                if (typeof avProps === 'string') {
                                    try { avProps = JSON.parse(avProps); } catch (_) { avProps = {}; }
                                }
                                const avMin = parseFloat(avProps.asistente_minutos) || 0;
                                const avColab = avProps.asistente_colaborador_id ? colaboradoresMap.get(Number(avProps.asistente_colaborador_id)) : null;

                                // Buscar si el artículo vinculado tiene receta propia (ej. MSXK -> Mix Salado (Mix) id 40)
                                const rRecVinc = await req.db.query(`
                                    SELECT r.id as receta_id, ri.ingrediente_id, ri.nombre_ingrediente, ri.cantidad, ri.unidad_medida,
                                           i.receta_base_kg, i.costo_patron
                                    FROM public.recetas r
                                    JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                                    LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                                    WHERE r.articulo_numero = $1
                                    ORDER BY r.fecha_creacion DESC, ri.id ASC
                                `, [artVinc]);

                                let subRecetaItems = [];
                                for (const sr of rRecVinc.rows) {
                                    let subMixComp = [];
                                    let baseKgMix = parseFloat(sr.receta_base_kg) || 1;
                                    if (sr.ingrediente_id) {
                                        const rSubComp = await req.db.query(`
                                            SELECT ic.cantidad, i.nombre, i.unidad_medida, i.costo_patron
                                            FROM public.ingrediente_composicion ic
                                            JOIN public.ingredientes i ON i.id = ic.ingrediente_id
                                            WHERE ic.mix_id = $1
                                            ORDER BY ic.id ASC
                                        `, [sr.ingrediente_id]);
                                        if (rSubComp.rows.length > 0) {
                                            subMixComp = rSubComp.rows.map(c => ({
                                                nombre: c.nombre,
                                                cantidad: parseFloat(c.cantidad) || 0,
                                                unidad_medida: c.unidad_medida || 'Kilo',
                                                costo_patron: parseFloat(c.costo_patron) || 0,
                                                subtotal: (parseFloat(c.cantidad) || 0) * (parseFloat(c.costo_patron) || 0)
                                            }));
                                        }
                                    }
                                    const sumaSubMix = subMixComp.reduce((acc, x) => acc + x.subtotal, 0);
                                    subRecetaItems.push({
                                        ingrediente_id: sr.ingrediente_id,
                                        nombre_ingrediente: sr.nombre_ingrediente,
                                        cantidad: parseFloat(sr.cantidad) || 0,
                                        unidad_medida: sr.unidad_medida || 'Kilo',
                                        receta_base_kg: baseKgMix,
                                        composicion_mix: subMixComp,
                                        costo_total_batch_mix: sumaSubMix,
                                        costo_kilo_mix_actual: baseKgMix > 0 && sumaSubMix > 0 ? (sumaSubMix / baseKgMix) : (parseFloat(sr.costo_patron) || 0)
                                    });
                                }

                                const cBaseVinc = av.costo_base_sobrescrito !== null && av.costo_base_sobrescrito !== undefined
                                    ? parseFloat(av.costo_base_sobrescrito)
                                    : (parseFloat(av.costo_base) || 0) / (parseFloat(av.kilos_unidad) || 1);
                                const cTiempoVinc = parseFloat(av.costo_tiempo) || 0;

                                puenteInfo = {
                                    articulo_id: av.articulo_id,
                                    descripcion: av.descripcion,
                                    kilos_unidad: parseFloat(av.kilos_unidad) || 1,
                                    costo_base_bulto: parseFloat(av.costo_base) || 0,
                                    costo_base_kilo_lista: cBaseVinc,
                                    costo_tiempo_lista: cTiempoVinc,
                                    costo_operativo_kilo: cBaseVinc + (cTiempoVinc / (parseFloat(av.kilos_unidad) || 1)),
                                    mano_obra_minutos: avMin,
                                    mano_obra_operario: avColab ? avColab.nombre : null,
                                    mano_obra_valor_hora: avColab ? avColab.valor_hora : null,
                                    sub_receta: subRecetaItems
                                };
                            }
                        }

                        detalleOrigen = {
                            es_insumo: rowIng.es_insumo === true,
                            receta_base_kg: parseFloat(rowIng.receta_base_kg) || null,
                            articulo_vinculado_numero: artVinc || null,
                            composicion_mix: composicionMix,
                            articulo_puente: puenteInfo
                        };
                    }
                } catch (eIng) {
                    console.warn('⚠️ [AUDITORIA-RENTABILIDAD] Error enriqueciendo ingrediente:', eIng.message);
                }
            }

            return {
                ingrediente_id: ingId,
                nombre_ingrediente: ing.nombre_ingrediente,
                cantidad: cant,
                unidad_medida: ing.unidad_medida || 'Kilo',
                costo_patron: costoPatron,
                subtotal: Number(subtotal.toFixed(4)),
                lote_id_ref: ing.lote_id_ref || null,
                costo_kilo_lote: ing.costo_kilo_lote ? parseFloat(ing.costo_kilo_lote) : null,
                detalle_origen: detalleOrigen
            };
        };

        // 3) Procesar cada fila del presupuesto
        const filasAuditadas = [];
        let subtotalBrutoPresupuesto = 0;
        let montoDescEspecialesTotal = 0;
        let totalNetoSinIvaConDesc = 0;
        let totalCostoBulto = 0;
        let totalCostoTiempo = 0;
        let totalCostoOperativo = 0;
        let totalIibb = 0;
        let totalIvaVenta = 0;
        let totalIvaCompra = 0;
        let totalDiferenciaIva = 0;
        let gananciaTotalPresupuesto = 0;

        for (let i = 0; i < itemsInput.length; i++) {
            const item = itemsInput[i];
            if (item.sin_stock || item.out_of_stock) continue;

            const codigoBarras = String(item.codigo_barras || item.articulo || '').trim();
            const articuloNumero = String(item.articulo_numero || item.articulo || '').trim();
            const descripcionInput = String(item.descripcion || '').trim();
            const cant = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0;
            const ivaVal = item.iva1 !== undefined && item.iva1 !== null ? (parseFloat(item.iva1) || 0) : 21;
            const pvu = item.precio1 !== undefined && item.precio1 !== null && parseFloat(item.precio1) > 0
                ? parseFloat(item.precio1)
                : Number((valor1 * (1 + ivaVal / 100)).toFixed(2));
            const descEspPct = parseFloat(item.descuento_adicional) || 0;

            const subFila = cant * pvu;
            subtotalBrutoPresupuesto += subFila;
            if (descEspPct > 0) {
                montoDescEspecialesTotal += subFila * (descEspPct / 100);
            }

            // Resolver artículo en Búnker
            let artIdBunker = null;
            let descResueltaBunker = descripcionInput;
            let finanzasBunker = null;
            let listaFinanciera = null;

            try {
                const queryId = `
                    SELECT ba.articulo_id, COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion_resuelta
                    FROM public.bunker_articulos ba
                    LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                    WHERE ba.articulo_id = $1 
                       OR src.articulo_numero = $1
                       OR src.codigo_barras = $1
                       OR ($2 <> '' AND (ba.articulo_id = $2 OR src.articulo_numero = $2 OR src.codigo_barras = $2))
                       OR ($3 <> '' AND (LOWER(ba.descripcion) = LOWER($3)
                                      OR LOWER(ba.descripcion_generada) = LOWER($3)
                                      OR LOWER(src.descripcion) = LOWER($3)))
                    LIMIT 1
                `;
                const rId = await req.db.query(queryId, [
                    articuloNumero || codigoBarras || '',
                    codigoBarras || articuloNumero || '',
                    descripcionInput || ''
                ]);
                if (rId.rows.length > 0) {
                    artIdBunker = rId.rows[0].articulo_id;
                    descResueltaBunker = rId.rows[0].descripcion_resuelta || descripcionInput;
                    finanzasBunker = await BunkerService.obtenerRadiografiaFinanciera(req.db, artIdBunker, { solo_local: true, saltar_reposicion: true });
                    if (finanzasBunker && Array.isArray(finanzasBunker.listas_margenes)) {
                        if (listaId) {
                            listaFinanciera = finanzasBunker.listas_margenes.find(m => Number(m.lista_id) === Number(listaId));
                        }
                        if (!listaFinanciera) {
                            listaFinanciera = finanzasBunker.listas_margenes.find(m => m.es_patron) || finanzasBunker.listas_margenes[0];
                        }
                    }
                }
            } catch (errB) {
                console.warn('⚠️ [AUDITORIA-RENTABILIDAD] Error resolviendo artículo Búnker:', errB.message);
            }

            const costoOpBackend = listaFinanciera ? Number(listaFinanciera.costo_operativo) || 0 : 0;
            const costoTiempoBackend = listaFinanciera ? Number(listaFinanciera.costo_tiempo) || 0 : 0;
            const costoBultoBackend = Number((costoOpBackend - costoTiempoBackend).toFixed(4)) || 0;
            const gananciaRealBackend = listaFinanciera ? Number(listaFinanciera.ganancia_real) || 0 : 0;

            // Usar los valores que tiene la fila en el DOM si están presentes, o los del backend (son idénticos)
            const costoBultoUnit = (item.costo_bunker !== undefined && item.costo_bunker !== null && String(item.costo_bunker) !== '')
                ? (parseFloat(item.costo_bunker) || 0)
                : costoBultoBackend;
            const costoTiempoUnit = (item.costo_tiempo_bunker !== undefined && item.costo_tiempo_bunker !== null && String(item.costo_tiempo_bunker) !== '')
                ? (parseFloat(item.costo_tiempo_bunker) || 0)
                : costoTiempoBackend;
            const gananciaUnitBase = (item.ganancia_bunker_base !== undefined && item.ganancia_bunker_base !== null && String(item.ganancia_bunker_base) !== '')
                ? (parseFloat(item.ganancia_bunker_base) || 0)
                : gananciaRealBackend;
            const costoOperativoUnit = costoBultoUnit + costoTiempoUnit;

            // Desglose interno del Costo Bulto (Base vs Insumos Lista)
            const factorKilos = finanzasBunker && parseFloat(finanzasBunker.kilos_unidad) > 0
                ? parseFloat(finanzasBunker.kilos_unidad)
                : 1;
            const valSob = listaFinanciera && listaFinanciera.costo_base_sobrescrito !== null && listaFinanciera.costo_base_sobrescrito !== undefined
                ? parseFloat(listaFinanciera.costo_base_sobrescrito)
                : null;
            const precioListaFinal = listaFinanciera ? parseFloat(listaFinanciera.precio_final || 0) : pvu;
            const ivaLista = listaFinanciera ? parseFloat(listaFinanciera.iva || 21) : ivaVal;
            const precioListaSinIva = precioListaFinal / (1 + ivaLista / 100);

            // Enriquecer ingredientes de receta si existen
            const recetaIngredientesEnriquecidos = [];
            let costoTotalRecetaActual = 0;
            if (finanzasBunker && Array.isArray(finanzasBunker.receta_ingredientes) && finanzasBunker.receta_ingredientes.length > 0) {
                for (const ing of finanzasBunker.receta_ingredientes) {
                    const enr = await enriquecerIngredienteTrazabilidad(ing);
                    recetaIngredientesEnriquecidos.push(enr);
                    costoTotalRecetaActual += enr.subtotal;
                }
            }

            let costoKiloIngredienteCalculado = 0;
            let metodoCostoBase = 'SIN_COSTO_BUNKER';
            if (recetaIngredientesEnriquecidos.length > 0) {
                costoKiloIngredienteCalculado = costoTotalRecetaActual / factorKilos;
                metodoCostoBase = 'RECETA_PRODUCCION';
            } else if (finanzasBunker && finanzasBunker.lote && parseFloat(finanzasBunker.lote.costo_kilo_al_momento) > 0) {
                costoKiloIngredienteCalculado = parseFloat(finanzasBunker.lote.costo_kilo_al_momento);
                metodoCostoBase = 'LOTE_VINCULADO';
            } else if (finanzasBunker && parseFloat(finanzasBunker.costo_base_manual) > 0) {
                costoKiloIngredienteCalculado = parseFloat(finanzasBunker.costo_base_manual) / factorKilos;
                metodoCostoBase = 'COSTO_BASE_MANUAL_ARTICULO';
            }

            let cBultoBaseExplicado = 0;
            let usaSobrescrito = false;
            let modoMultiplicacionSobrescrito = 'POR_KILO';
            if (valSob !== null && valSob > 0) {
                usaSobrescrito = true;
                if (factorKilos > 1 && (valSob * factorKilos) > (precioListaSinIva * 0.95)) {
                    cBultoBaseExplicado = valSob;
                    modoMultiplicacionSobrescrito = 'BULTO_DIRECTO';
                } else {
                    cBultoBaseExplicado = valSob * factorKilos;
                    modoMultiplicacionSobrescrito = 'POR_KILO';
                }
            } else {
                cBultoBaseExplicado = costoKiloIngredienteCalculado * factorKilos;
            }

            const insumosListaDetalle = (listaFinanciera && Array.isArray(listaFinanciera.insumos))
                ? listaFinanciera.insumos.map(ins => {
                    const inc = ins.incluido === true || ins.incluido === 'true';
                    const pUnit = parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado || 0);
                    const cIns = parseFloat(ins.cantidad) || 0;
                    return {
                        id: ins.id,
                        codigo: ins.insumo_articulo_numero,
                        descripcion: ins.descripcion || ins.insumo_articulo_numero,
                        cantidad: cIns,
                        costo_unitario: pUnit,
                        subtotal: inc ? Number((cIns * pUnit).toFixed(4)) : 0,
                        incluido: inc
                    };
                })
                : [];
            const costoInsumosLista = insumosListaDetalle.reduce((acc, x) => acc + (x.incluido ? x.subtotal : 0), 0);

            // Trazabilidad de Mano de Obra
            const props = (finanzasBunker && finanzasBunker.propiedades_dinamicas) ? finanzasBunker.propiedades_dinamicas : {};
            const minutosMO = parseFloat(props.asistente_minutos) || 0;
            const colabId = props.asistente_colaborador_id ? Number(props.asistente_colaborador_id) : null;
            const colabInfo = colabId ? colaboradoresMap.get(colabId) : null;
            const manoObraActiva = listaFinanciera ? (listaFinanciera.mano_obra_activa === true || costoTiempoUnit > 0) : (costoTiempoUnit > 0);

            // Observaciones de Auditoría Automáticas
            const observaciones = [];
            if (usaSobrescrito && recetaIngredientesEnriquecidos.length > 0) {
                const diffReceta = Math.abs(cBultoBaseExplicado - costoTotalRecetaActual);
                if (diffReceta > 5) {
                    observaciones.push({
                        tipo: 'warning',
                        mensaje: `El costo base en Lista (${listaNombre}) está fijado en $${valSob.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg (Bulto: $${cBultoBaseExplicado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}), mientras que la suma actual de su Receta a costo patrón vigente es $${costoTotalRecetaActual.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ($${(costoTotalRecetaActual / factorKilos).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg).`
                    });
                }
            }
            if (costoInsumosLista > 0 && recetaIngredientesEnriquecidos.some(r => r.detalle_origen?.es_insumo || /bolsa|envase|caja|pote/i.test(r.nombre_ingrediente))) {
                observaciones.push({
                    tipo: 'info',
                    mensaje: `Este artículo suma $${costoInsumosLista.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de Insumos Adicionales de Lista sobre un Costo Base de Receta que ya incluye un insumo de empaque.`
                });
            }

            // Cálculos exactos de rentabilidad de la fila (espejo de recalcTotales en detalles-common.js)
            const descTotalPct = descGenPct + descEspPct;
            const pvuConDesc = pvu * (1 - descTotalPct / 100);
            const netoConDesc = pvuConDesc / (1 + (ivaVal / 100));

            let iibbUnit = 0;
            let ivaVentaUnit = 0;
            let ivaCompraUnit = 0;
            let diferenciaIvaUnit = 0;
            let gananciaUnitFila = 0;
            let ganFila = 0;
            let formulaAplicada = 'SIN_DATOS_BUNKER';

            if (costoOperativoUnit > 0) {
                iibbUnit = pvuConDesc * 0.04;
                ivaVentaUnit = netoConDesc * (ivaVal / 100);
                ivaCompraUnit = costoBultoUnit * 0.21;
                diferenciaIvaUnit = Math.max(0, ivaVentaUnit - ivaCompraUnit);
                gananciaUnitFila = netoConDesc - costoOperativoUnit - iibbUnit - diferenciaIvaUnit;
                ganFila = gananciaUnitFila * cant;
                formulaAplicada = 'COMPLETA_COSTO_OPERATIVO';
            } else if (gananciaUnitBase !== 0) {
                const ganBaseTotal = gananciaUnitBase * cant;
                const descFilaBruto = subFila * (descTotalPct / 100);
                const descFilaNeto = descFilaBruto / (1 + (ivaVal / 100));
                ganFila = ganBaseTotal - descFilaNeto;
                gananciaUnitFila = cant > 0 ? (ganFila / cant) : gananciaUnitBase;
                formulaAplicada = 'FALLBACK_GANANCIA_BASE';
            }

            totalNetoSinIvaConDesc += netoConDesc * cant;
            totalCostoBulto += costoBultoUnit * cant;
            totalCostoTiempo += costoTiempoUnit * cant;
            totalCostoOperativo += costoOperativoUnit * cant;
            totalIibb += iibbUnit * cant;
            totalIvaVenta += ivaVentaUnit * cant;
            totalIvaCompra += ivaCompraUnit * cant;
            totalDiferenciaIva += diferenciaIvaUnit * cant;
            gananciaTotalPresupuesto += ganFila;

            filasAuditadas.push({
                orden: i + 1,
                codigo_barras: codigoBarras,
                articulo_numero: articuloNumero,
                articulo_id_bunker: artIdBunker,
                descripcion: descripcionInput || descResueltaBunker,
                descripcion_bunker: descResueltaBunker,
                cantidad: cant,
                kilos_unidad: factorKilos,
                kilos_totales_linea: cant * factorKilos,

                // Precios de Venta
                valor_unitario_neto_sin_desc: valor1,
                iva_porcentaje: ivaVal,
                precio_unitario_c_iva_sin_desc: pvu,
                subtotal_bruto_c_iva: subFila,
                descuento_general_pct: descGenPct,
                descuento_especial_pct: descEspPct,
                descuento_total_pct: descTotalPct,
                precio_unitario_c_iva_con_desc: pvuConDesc,
                neto_unitario_s_iva_con_desc: netoConDesc,
                subtotal_c_iva_con_desc: pvuConDesc * cant,
                subtotal_neto_s_iva_con_desc: netoConDesc * cant,

                // Estructura de Costos Unitarios y Totales
                costo_bulto_unitario: costoBultoUnit,
                costo_bulto_base_unitario: cBultoBaseExplicado,
                costo_insumos_lista_unitario: costoInsumosLista,
                costo_tiempo_unitario: costoTiempoUnit,
                costo_operativo_unitario: costoOperativoUnit,
                costo_operativo_total_fila: costoOperativoUnit * cant,

                // Impuestos y Deducciones Unitarias y Totales
                iibb_unitario: iibbUnit,
                iibb_total_fila: iibbUnit * cant,
                iva_venta_unitario: ivaVentaUnit,
                iva_compra_unitario: ivaCompraUnit,
                diferencia_iva_unitario: diferenciaIvaUnit,
                diferencia_iva_total_fila: diferenciaIvaUnit * cant,

                // Rentabilidad
                ganancia_unitaria: gananciaUnitFila,
                ganancia_total_fila: ganFila,
                margen_real_sobre_neto_pct: netoConDesc > 0 ? (gananciaUnitFila / netoConDesc) * 100 : 0,
                margen_real_sobre_final_pct: pvuConDesc > 0 ? (gananciaUnitFila / pvuConDesc) * 100 : 0,
                markup_sobre_costo_op_pct: costoOperativoUnit > 0 ? ((netoConDesc - costoOperativoUnit) / costoOperativoUnit) * 100 : 0,
                margen_configurado_lista_pct: listaFinanciera ? parseFloat(listaFinanciera.margen_porcentaje || 0) : null,
                precio_final_lista_bunker: listaFinanciera ? parseFloat(listaFinanciera.precio_final || 0) : null,

                // Trazabilidad profunda del origen del costo
                trazabilidad: {
                    formula_aplicada: formulaAplicada,
                    metodo_costo_base: metodoCostoBase,
                    usa_costo_base_sobrescrito: usaSobrescrito,
                    costo_base_sobrescrito_valor: valSob,
                    modo_multiplicacion_sobrescrito: modoMultiplicacionSobrescrito,
                    costo_base_manual_bunker: finanzasBunker ? parseFloat(finanzasBunker.costo_base_manual || 0) : null,
                    costo_kilo_calculado: costoKiloIngredienteCalculado,
                    lote_vinculado: finanzasBunker && finanzasBunker.lote ? {
                        lote_id_supabase: finanzasBunker.lote.lote_id_supabase,
                        fecha_vinculacion: finanzasBunker.lote.fecha_vinculacion,
                        costo_kilo_al_momento: parseFloat(finanzasBunker.lote.costo_kilo_al_momento) || 0,
                        impuesto_iva: parseFloat(finanzasBunker.lote.impuesto_iva) || 21
                    } : null,
                    receta_id: finanzasBunker ? finanzasBunker.receta_id : null,
                    receta_heredada: finanzasBunker ? finanzasBunker.receta_heredada : false,
                    receta_ingredientes: recetaIngredientesEnriquecidos,
                    costo_total_receta_actual: Number(costoTotalRecetaActual.toFixed(4)),
                    insumos_lista: insumosListaDetalle,
                    mano_obra: {
                        activa: manoObraActiva,
                        minutos: minutosMO,
                        operario_id: colabId,
                        operario_nombre: colabInfo ? colabInfo.nombre : (colabId ? `Operario #${colabId}` : 'Estándar Taller'),
                        valor_hora: colabInfo ? colabInfo.valor_hora : (minutosMO > 0 && costoTiempoUnit > 0 ? Math.round((costoTiempoUnit / minutosMO) * 60) : 0),
                        costo_calculado: costoTiempoUnit
                    },
                    observaciones
                }
            });
        }

        const montoDescGeneral = subtotalBrutoPresupuesto * (descGenPct / 100);
        const totalFinalConIva = subtotalBrutoPresupuesto - montoDescGeneral - montoDescEspecialesTotal;

        return res.json({
            success: true,
            data: {
                cabecera: {
                    presupuesto_id: presupuestoId,
                    cliente_id: idCliente,
                    cliente_nombre: clienteNombre || `Cliente #${idCliente}`,
                    tipo_comprobante: tipoComprobante,
                    lista_bunker_id: listaId,
                    lista_bunker_nombre: listaNombre,
                    usar_precios_bunker: usarPreciosBunker,
                    descuento_general_pct: descGenPct,
                    fecha_auditoria: new Date().toISOString()
                },
                totales: {
                    subtotal_bruto_c_iva: Number(subtotalBrutoPresupuesto.toFixed(2)),
                    descuento_general_monto: Number(montoDescGeneral.toFixed(2)),
                    descuentos_especiales_monto: Number(montoDescEspecialesTotal.toFixed(2)),
                    total_final_c_iva: Number(totalFinalConIva.toFixed(2)),
                    total_neto_s_iva_con_desc: Number(totalNetoSinIvaConDesc.toFixed(2)),
                    total_costo_bulto: Number(totalCostoBulto.toFixed(2)),
                    total_costo_tiempo: Number(totalCostoTiempo.toFixed(2)),
                    total_costo_operativo: Number(totalCostoOperativo.toFixed(2)),
                    total_iibb: Number(totalIibb.toFixed(2)),
                    total_iva_venta: Number(totalIvaVenta.toFixed(2)),
                    total_iva_compra: Number(totalIvaCompra.toFixed(2)),
                    total_diferencia_iva: Number(totalDiferenciaIva.toFixed(2)),
                    rentabilidad_estimada_bunker: Number(gananciaTotalPresupuesto.toFixed(2)),
                    margen_neto_sobre_venta_neta_pct: totalNetoSinIvaConDesc > 0 ? Number(((gananciaTotalPresupuesto / totalNetoSinIvaConDesc) * 100).toFixed(2)) : 0,
                    margen_neto_sobre_total_final_pct: totalFinalConIva > 0 ? Number(((gananciaTotalPresupuesto / totalFinalConIva) * 100).toFixed(2)) : 0
                },
                filas: filasAuditadas
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [AUDITORIA-RENTABILIDAD] Error general:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al generar auditoría de rentabilidad Búnker',
            message: error.message
        });
    }
};

module.exports = {
    obtenerHistorialArticuloCliente, // Nuevo
    obtenerArticulosHabitualesCliente, // Artículos habituales del cliente
    obtenerAuditoriaRentabilidadBunker, // Auditoría y trazabilidad de rentabilidad Búnker

    obtenerPresupuestos,
    obtenerSugerenciasClientes,
    obtenerSugerenciasArticulos,
    obtenerPresupuestoPorId,
    obtenerDetallesPresupuesto,
    obtenerEstados,
    crearPresupuesto,
    actualizarPresupuesto,
    actualizarEstadoPresupuesto,
    eliminarPresupuesto,
    obtenerPresupuestosPorCategoria,
    obtenerEstadisticas,
    obtenerConfiguracion,
    obtenerResumen,
    obtenerPrecioArticuloCliente,
    obtenerDatosCliente,
    obtenerHistorialEntregasCliente,
    obtenerCatalogoGeneral,
    obtenerArticulosExcluidos,
    excluirArticulo,
    reincluirArticulo
};

