/**
 * SERVICIO: Historial de Cambios de Precios y Notificaciones a Clientes
 * Núcleo de Inteligencia Comercial LAMDA
 * 
 * Arquitectura de Normalización Universal de Clientes:
 * Resuelve y unifica clientes a través de múltiples esquemas (Búnker Clientes, Legacy Clientes, LomasSoft).
 * Soporta códigos con ceros a la izquierda ('0387' == 387), códigos Búnker (CB-XXXX),
 * parseo de arrays JSON de contactos telefónicos y descarte estricto de comprobantes anulados.
 */
const path = require('path');
const fs = require('fs');
const { getSharedPool } = require('../../shared/pgPoolFactory');

let puppeteer = null;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn('Puppeteer no se pudo cargar:', e.message);
}

function getPool() {
    return getSharedPool({ defaultMax: 15 });
}

/**
 * Helper para limpiar y extraer números de teléfono (soporta arrays JSON de contactos Búnker)
 */
function limpiarTelefono(raw) {
    if (!raw) return 'Sin teléfono';
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
                const def = arr.find(c => c.default || c.default_resumen || c.enviar_alerta) || arr[0];
                return def.numero || def.telefono || 'Sin teléfono';
            }
        } catch (e) {}
    }
    const str = String(raw).trim();
    return str.length > 0 ? str : 'Sin teléfono';
}

/**
 * MOTOR DE NORMALIZACIÓN Y CATÁLOGO UNIVERSAL DE CLIENTES
 * Construye en memoria el grafo relacional entre bunker_clientes y clientes legacy
 * eliminando cruces falsos por ID autonumérico y garantizando correspondencia por LomasSoft ID y CUIT.
 */
async function buildClientCatalog(db) {
    // 1. Obtener bunker_clientes con sus listas de precios
    const resBunker = await db.query(`
        SELECT 
            bc.id as bunker_id,
            bc.codigo_bunker_cliente,
            bc.cliente_nombre,
            bc.razon_social,
            bc.lomas_soft_id,
            bc.whatsapp_facturas,
            bc.email_facturas,
            bc.cuit_cuil as cuit,
            bcl.bunker_lista_precio_id,
            lp.nombre as lista_nombre
        FROM public.bunker_clientes bc
        LEFT JOIN public.bunker_cliente_listas_precios bcl ON bcl.bunker_cliente_id = bc.id
        LEFT JOIN public.bunker_listas_precios lp ON lp.id = bcl.bunker_lista_precio_id
    `);

    // 2. Obtener clientes legacy
    const resLegacy = await db.query(`
        SELECT 
            c.id as serial_id,
            c.cliente_id as legacy_id,
            c.nombre,
            c.apellido,
            c.otros,
            TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')) as nombre_completo,
            c.celular,
            c.telefono,
            c.telefono_2,
            c.email,
            c.cuit,
            c.lista_precios
        FROM public.clientes c
    `);

    // 3. Obtener nombres de listas de precios
    const resListas = await db.query('SELECT id, nombre FROM public.bunker_listas_precios');
    const mapaListas = new Map();
    resListas.rows.forEach(l => mapaListas.set(l.id, l.nombre));

    const map = new Map();
    const clientesProcesadosBunker = new Set();

    // Mapas de indexación previa para match estricto
    const bunkerByCuit = new Map();
    const bunkerByLomas = new Map();

    resBunker.rows.forEach(b => {
        if (b.cuit) {
            const cleanC = b.cuit.replace(/\D/g, '');
            if (cleanC.length >= 8) bunkerByCuit.set(cleanC, b);
        }
        if (b.lomas_soft_id) {
            const lStr = String(b.lomas_soft_id).trim();
            bunkerByLomas.set(lStr, b);
            if (/^\d+$/.test(lStr)) {
                bunkerByLomas.set(String(parseInt(lStr, 10)), b);
            }
        }
    });

    // Procesar clientes legacy vinculándolos con Búnker por lomas_soft_id o CUIT (NUNCA por serial_id)
    resLegacy.rows.forEach(leg => {
        const legCuitLimpio = leg.cuit ? leg.cuit.replace(/\D/g, '') : '';
        const legIdStr = leg.legacy_id ? String(leg.legacy_id).trim() : '';

        let bunker = null;
        if (legIdStr && bunkerByLomas.has(legIdStr)) {
            bunker = bunkerByLomas.get(legIdStr);
        } else if (legCuitLimpio && legCuitLimpio.length >= 8 && bunkerByCuit.has(legCuitLimpio)) {
            bunker = bunkerByCuit.get(legCuitLimpio);
        }

        const canonicalKey = bunker ? `b_${bunker.bunker_id}` : `l_${leg.legacy_id || leg.serial_id}`;

        let nombre = bunker?.razon_social || bunker?.cliente_nombre;
        if (!nombre || nombre.trim() === '') nombre = leg.nombre_completo;
        if (!nombre || nombre.trim() === '') nombre = leg.nombre || leg.apellido || leg.otros || `Cliente #${leg.legacy_id}`;
        nombre = nombre.trim();

        const rawTel = bunker?.whatsapp_facturas || leg.celular || leg.telefono || leg.telefono_2 || '';
        const telLimpio = limpiarTelefono(rawTel);

        const listaId = bunker?.bunker_lista_precio_id || parseInt(leg.lista_precios) || 1;
        const listaNombre = bunker?.lista_nombre || mapaListas.get(listaId) || 'Lista General';

        const clientObj = {
            canonical_key: canonicalKey,
            serial_id: leg.serial_id,
            legacy_id: leg.legacy_id,
            bunker_id: bunker?.bunker_id || null,
            codigo_bunker_cliente: bunker?.codigo_bunker_cliente || null,
            nombre_cliente: nombre,
            cliente_nombre: nombre,
            telefono: telLimpio,
            email: bunker?.email_facturas || leg.email || '',
            cuit: bunker?.cuit || leg.cuit || '',
            lista_id: listaId,
            lista_nombre: listaNombre,
            matching_ids: []
        };

        const mIds = new Set();
        if (leg.serial_id) mIds.add(String(leg.serial_id));
        if (leg.legacy_id) {
            mIds.add(String(leg.legacy_id));
            if (/^\d+$/.test(String(leg.legacy_id))) {
                mIds.add(String(parseInt(leg.legacy_id, 10)).padStart(4, '0'));
            }
        }
        if (bunker) {
            mIds.add(String(bunker.bunker_id));
            if (bunker.codigo_bunker_cliente) mIds.add(bunker.codigo_bunker_cliente);
            if (bunker.lomas_soft_id) mIds.add(bunker.lomas_soft_id);
            clientesProcesadosBunker.add(bunker.bunker_id);
        }
        clientObj.matching_ids = Array.from(mIds);

        // Indexaciones: el serial_id se indexa con prefijo y directo solo si no choca
        if (leg.serial_id) {
            map.set(`s_${leg.serial_id}`, clientObj);
            if (!map.has(String(leg.serial_id))) {
                map.set(String(leg.serial_id), clientObj);
            }
        }

        // El legacy_id comercial tiene máxima prioridad
        if (leg.legacy_id) {
            map.set(legIdStr, clientObj);
            if (/^\d+$/.test(legIdStr)) {
                const num = parseInt(legIdStr, 10);
                map.set(String(num), clientObj);
                map.set(String(num).padStart(4, '0'), clientObj);
                map.set(String(num).padStart(6, '0'), clientObj);
            }
        }

        if (bunker) {
            map.set(`b_${bunker.bunker_id}`, clientObj);
            if (bunker.codigo_bunker_cliente) {
                map.set(bunker.codigo_bunker_cliente.toLowerCase(), clientObj);
                map.set(bunker.codigo_bunker_cliente.toUpperCase(), clientObj);
            }
            if (bunker.lomas_soft_id) {
                const lStr = String(bunker.lomas_soft_id).trim();
                map.set(lStr, clientObj);
                if (/^\d+$/.test(lStr)) {
                    map.set(String(parseInt(lStr, 10)), clientObj);
                    map.set(String(parseInt(lStr, 10)).padStart(4, '0'), clientObj);
                }
            }
        }

        if (legCuitLimpio && legCuitLimpio.length >= 8) {
            map.set(legCuitLimpio, clientObj);
        }
    });

    // Agregar clientes Búnker que no tienen cuenta Legacy
    resBunker.rows.forEach(b => {
        if (!clientesProcesadosBunker.has(b.bunker_id)) {
            const rawTel = b.whatsapp_facturas || '';
            const telLimpio = limpiarTelefono(rawTel);
            const clientObj = {
                canonical_key: `b_${b.bunker_id}`,
                serial_id: null,
                legacy_id: b.lomas_soft_id ? (parseInt(b.lomas_soft_id, 10) || null) : null,
                bunker_id: b.bunker_id,
                codigo_bunker_cliente: b.codigo_bunker_cliente,
                nombre_cliente: b.razon_social || b.cliente_nombre || `Cliente Búnker #${b.bunker_id}`,
                cliente_nombre: b.razon_social || b.cliente_nombre || `Cliente Búnker #${b.bunker_id}`,
                telefono: telLimpio,
                email: b.email_facturas || '',
                cuit: b.cuit || '',
                lista_id: b.bunker_lista_precio_id || 1,
                lista_nombre: b.lista_nombre || mapaListas.get(b.bunker_lista_precio_id) || 'Lista General',
                matching_ids: [String(b.bunker_id)]
            };
            if (b.codigo_bunker_cliente) clientObj.matching_ids.push(b.codigo_bunker_cliente);
            if (b.lomas_soft_id) clientObj.matching_ids.push(b.lomas_soft_id);

            map.set(`b_${b.bunker_id}`, clientObj);
            if (b.codigo_bunker_cliente) {
                map.set(b.codigo_bunker_cliente.toLowerCase(), clientObj);
                map.set(b.codigo_bunker_cliente.toUpperCase(), clientObj);
            }
            if (b.lomas_soft_id) {
                const lStr = String(b.lomas_soft_id).trim();
                map.set(lStr, clientObj);
                if (/^\d+$/.test(lStr)) {
                    map.set(String(parseInt(lStr, 10)), clientObj);
                    map.set(String(parseInt(lStr, 10)).padStart(4, '0'), clientObj);
                }
            }
            if (b.cuit) {
                const cLimpio = b.cuit.replace(/\D/g, '');
                if (cLimpio.length >= 8) map.set(cLimpio, clientObj);
            }
        }
    });

    function resolveClient(ref) {
        if (!ref) return null;
        const refStr = String(ref).trim();
        if (!refStr) return null;

        let found = map.get(refStr) || map.get(refStr.toLowerCase()) || map.get(refStr.toUpperCase());
        if (found) return found;

        if (/^\d+$/.test(refStr)) {
            const num = parseInt(refStr, 10);
            found = map.get(String(num)) || map.get(String(num).padStart(4, '0')) || map.get(String(num).padStart(6, '0'));
            if (found) return found;
        }

        const digits = refStr.replace(/\D/g, '');
        if (digits.length >= 8) {
            found = map.get(digits);
            if (found) return found;
        }

        return null;
    }

    return { map, resolveClient };
}

/**
 * Registra un lote de variaciones de precios atómicamente.
 * Solo inserta si hubo una diferencia real en precio_final o costo.
 */
async function registrarCambiosLote({ client, cambios, origen_cambio = 'SIMULACION', usuario = 'OPERADOR' }) {
    if (!cambios || cambios.length === 0) return { insertados: 0 };

    const db = client || getPool();

    // Obtener nombres de listas
    const resListas = await db.query(`SELECT id, nombre FROM public.bunker_listas_precios`);
    const mapListas = new Map();
    resListas.rows.forEach(l => mapListas.set(l.id, l.nombre));

    // Obtener datos maestros de los artículos involucrados
    const artNums = Array.from(new Set(cambios.map(c => String(c.articulo_numero).trim())));
    const resArts = await db.query(`
        SELECT 
            ba.articulo_id, 
            ba.descripcion_generada, 
            ba.descripcion, 
            ba.kilos_unidad, 
            ba.porcentaje_iva,
            a.codigo_barras
        FROM public.bunker_articulos ba
        LEFT JOIN public.articulos a ON TRIM(a.numero::text) = TRIM(ba.articulo_id)
        WHERE TRIM(ba.articulo_id) = ANY($1)
    `, [artNums]);

    const mapArts = new Map();
    resArts.rows.forEach(a => mapArts.set(String(a.articulo_id).trim().toLowerCase(), a));

    for (const c of cambios) {
        const artNum = String(c.articulo_numero).trim();
        const artObj = mapArts.get(artNum.toLowerCase()) || {};
        const listaId = parseInt(c.lista_id);
        const listaNombre = mapListas.get(listaId) || `Lista ${listaId}`;

        const pAnt = parseFloat(c.precio_anterior) || 0;
        const pNue = parseFloat(c.precio_nuevo) || 0;
        const cAnt = parseFloat(c.costo_anterior) || 0;
        const cNue = parseFloat(c.costo_nuevo) || 0;

        const varMonto = pNue - pAnt;
        const varPct = pAnt > 0 ? ((varMonto / pAnt) * 100) : 0;
        const varCostoMonto = cNue - cAnt;
        const varCostoPct = cAnt > 0 ? ((varCostoMonto / cAnt) * 100) : 0;

        if (Math.abs(varMonto) < 0.01 && Math.abs(varCostoMonto) < 0.01) {
            continue; // Evitar registrar variaciones nulas de 0 pesos
        }

        await db.query(`
            INSERT INTO public.bunker_historial_cambios_precios (
                articulo_numero,
                codigo_barras,
                descripcion,
                kilos_unidad,
                lista_id,
                lista_nombre,
                precio_anterior,
                precio_nuevo,
                variacion_monto,
                variacion_porcentaje,
                costo_anterior,
                costo_nuevo,
                origen_cambio,
                usuario
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
            artNum,
            artObj.codigo_barras || c.codigo_barras || null,
            artObj.descripcion_generada || artObj.descripcion || c.descripcion || artNum,
            parseFloat(artObj.kilos_unidad) || parseFloat(c.kilos_unidad) || 1,
            listaId,
            listaNombre,
            pAnt,
            pNue,
            varMonto,
            varPct,
            cAnt,
            cNue,
            origen_cambio,
            usuario
        ]);
    }

    return { insertados: cambios.length };
}

/**
 * Obtiene el historial de variaciones agrupado por artículo y evento de cambio.
 * Filtra automáticamente las listas que tienen el artículo desactivado (disponible = false).
 */
async function obtenerHistorial({ dias = 30, search = '' }) {
    const db = getPool();
    let query = `
        SELECT 
            h.id,
            h.articulo_numero,
            h.codigo_barras,
            h.descripcion,
            h.kilos_unidad,
            h.lista_id,
            h.lista_nombre,
            h.precio_anterior,
            h.precio_nuevo,
            h.variacion_monto,
            h.variacion_porcentaje,
            h.costo_anterior,
            h.costo_nuevo,
            (COALESCE(h.costo_nuevo, 0) - COALESCE(h.costo_anterior, 0)) as variacion_costo_monto,
            CASE WHEN COALESCE(h.costo_anterior, 0) > 0 
                 THEN ((COALESCE(h.costo_nuevo, 0) - COALESCE(h.costo_anterior, 0)) / h.costo_anterior) * 100 
                 ELSE 0 
            END as variacion_costo_porcentaje,
            h.origen_cambio,
            h.usuario,
            h.created_at,
            bla.disponible as lista_disponible
        FROM public.bunker_historial_cambios_precios h
        LEFT JOIN public.bunker_lista_articulos bla 
            ON bla.lista_id = h.lista_id 
            AND LOWER(TRIM(bla.articulo_numero)) = LOWER(TRIM(h.articulo_numero))
        WHERE COALESCE(bla.disponible, false) = true
          AND COALESCE(bla.precio_final, 0) > 0
          AND (ABS(h.variacion_monto) >= 0.01 OR ABS(COALESCE(h.costo_nuevo, 0) - COALESCE(h.costo_anterior, 0)) >= 0.01)
    `;

    const params = [];
    if (dias && dias !== 'all' && !isNaN(parseInt(dias))) {
        params.push(`${parseInt(dias)} days`);
        query += ` AND h.created_at >= NOW() - ($${params.length})::interval`;
    }

    if (search && search.trim() !== '') {
        params.push(`%${search.trim().toLowerCase()}%`);
        query += ` AND (
            LOWER(h.articulo_numero) LIKE $${params.length} OR 
            LOWER(h.descripcion) LIKE $${params.length} OR 
            LOWER(COALESCE(h.codigo_barras, '')) LIKE $${params.length}
        )`;
    }

    query += ` ORDER BY h.created_at DESC, h.articulo_numero ASC`;

    const res = await db.query(query, params);

    // Agrupar filas por artículo y fecha
    const agrupadosMap = new Map();

    res.rows.forEach(r => {
        const fechaDia = r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : 'fecha_desconocida';
        const claveAgrupacion = `${r.articulo_numero.trim().toLowerCase()}_${fechaDia}`;

        if (!agrupadosMap.has(claveAgrupacion)) {
            agrupadosMap.set(claveAgrupacion, {
                id: r.id,
                articulo_numero: r.articulo_numero,
                codigo_barras: r.codigo_barras,
                descripcion: r.descripcion,
                kilos_unidad: r.kilos_unidad,
                costo_anterior: parseFloat(r.costo_anterior) || 0,
                costo_nuevo: parseFloat(r.costo_nuevo) || 0,
                variacion_costo_monto: parseFloat(r.variacion_costo_monto) || 0,
                variacion_costo_porcentaje: parseFloat(r.variacion_costo_porcentaje) || 0,
                origen_cambio: r.origen_cambio,
                usuario: r.usuario,
                created_at: r.created_at,
                fecha_dia: fechaDia,
                listas_activas: []
            });
        }

        const articuloGroup = agrupadosMap.get(claveAgrupacion);
        articuloGroup.listas_activas.push({
            historial_id: r.id,
            lista_id: r.lista_id,
            lista_nombre: r.lista_nombre,
            precio_anterior: parseFloat(r.precio_anterior) || 0,
            precio_nuevo: parseFloat(r.precio_nuevo) || 0,
            variacion_monto: parseFloat(r.variacion_monto) || 0,
            variacion_porcentaje: parseFloat(r.variacion_porcentaje) || 0
        });
    });

    return Array.from(agrupadosMap.values());
}

/**
 * Cruza un artículo con las ventas reales (Facturas y Presupuestos) de los últimos N días.
 * Normaliza los compradores a través del Catálogo Universal de Clientes.
 */
async function obtenerClientesAfectadosPorArticulo({ articulo_numero, dias = 90 }) {
    const db = getPool();
    const sku = String(articulo_numero).trim();

    // 1. Obtener datos maestros del artículo y catálogo universal de clientes en paralelo
    const [resArt, catalog] = await Promise.all([
        db.query(`
            SELECT ba.articulo_id, a.codigo_barras, ba.descripcion_generada, ba.descripcion, ba.kilos_unidad
            FROM public.bunker_articulos ba
            LEFT JOIN public.articulos a ON TRIM(a.numero::text) = TRIM(ba.articulo_id)
            WHERE LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM($1))
            LIMIT 1
        `, [sku]),
        buildClientCatalog(db)
    ]);

    const art = resArt.rows[0] || {};
    const codBarras = art.codigo_barras ? String(art.codigo_barras).trim() : null;

    let filtroInterval = "90 days";
    if (dias && dias !== 'all' && !isNaN(parseInt(dias))) {
        filtroInterval = `${parseInt(dias)} days`;
    }

    // 2. Consulta de compras con indexación dinámica segura de parámetros
    const params = [sku];
    let codBarrasFacturas = '';
    let codBarrasPresupuestos = '';
    if (codBarras) {
        params.push(codBarras);
        const cbIdx = params.length;
        codBarrasFacturas = `OR TRIM(ffi.articulo_id) = TRIM($${cbIdx})`;
        codBarrasPresupuestos = `OR TRIM(pd.articulo) = TRIM($${cbIdx})`;
    }

    let dateFilterFacturas = '';
    let dateFilterPresupuestos = '';
    if (dias !== 'all') {
        params.push(filtroInterval);
        const dtIdx = params.length;
        dateFilterFacturas = `AND f.fecha_emision >= NOW() - ($${dtIdx})::interval`;
        dateFilterPresupuestos = `AND COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) >= NOW() - ($${dtIdx})::interval`;
    }

    const queryVentas = `
        WITH compras_unificadas AS (
            -- FACTURAS (Aprobadas / ARCA)
            SELECT 
                f.cliente_id::text AS cliente_ref_id,
                f.fecha_emision AS fecha_compra,
                'FACTURA' AS origen_comprobante,
                COALESCE(f.cbte_nro::text, f.nro_interno::text, f.id::text) AS nro_comprobante,
                ffi.qty::numeric AS cantidad,
                -- Precio unitario efectivo CON IVA (con descuentos aplicados)
                ROUND((ffi.imp_neto + COALESCE(ffi.imp_iva, 0)) / NULLIF(ffi.qty, 0), 2) AS precio_historico_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(ffi.imp_neto / NULLIF(ffi.qty, 0), 2) AS precio_historico_neto,
                CASE 
                    WHEN COALESCE(f.descuento, 0) > 1 THEN f.descuento 
                    ELSE COALESCE(f.descuento, 0) * 100 
                END AS descuento_pct,
                1 as prioridad_tipo
            FROM public.factura_factura_items ffi
            JOIN public.factura_facturas f ON f.id = ffi.factura_id
            WHERE f.estado IN ('APROBADA', 'APROBADA_LOCAL')
              AND f.estado != 'ANULADA'
              AND (
                  LOWER(TRIM(ffi.articulo_id)) = LOWER(TRIM($1)) 
                  ${codBarrasFacturas}
              )
              ${dateFilterFacturas}

            UNION ALL

            -- PRESUPUESTOS (Activos, no anulados, y no facturados previamente)
            SELECT 
                COALESCE(p.cliente_nuevo_id, p.id_cliente::text) AS cliente_ref_id,
                COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) AS fecha_compra,
                'PRESUPUESTO' AS origen_comprobante,
                COALESCE(p.id_presupuesto_ext::text, p.id::text) AS nro_comprobante,
                pd.cantidad::numeric AS cantidad,
                -- Precio unitario efectivo CON IVA (aplicando descuentos general y de línea)
                ROUND(pd.precio1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_historico_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(pd.valor1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_historico_neto,
                LEAST(100.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) ELSE COALESCE(p.descuento, 0) * 100.0 END) 
                    + COALESCE(pd.descuento_adicional, 0)
                ) AS descuento_pct,
                2 as prioridad_tipo
            FROM public.presupuestos_detalles pd
            JOIN public.presupuestos p ON p.id = pd.id_presupuesto
            WHERE p.activo = true 
              AND p.estado NOT ILIKE '%anulado%'
              AND p.estado NOT ILIKE '%facturado%'
              AND p.factura_id IS NULL
              AND (
                  LOWER(TRIM(pd.articulo)) = LOWER(TRIM($1))
                  ${codBarrasPresupuestos}
              )
              ${dateFilterPresupuestos}
        )
        SELECT 
            cu.cliente_ref_id,
            cu.fecha_compra,
            cu.cantidad,
            cu.precio_historico_unitario,
            cu.precio_historico_neto,
            cu.descuento_pct,
            cu.origen_comprobante,
            cu.nro_comprobante,
            cu.prioridad_tipo
        FROM compras_unificadas cu
        WHERE cu.cliente_ref_id IS NOT NULL AND cu.cliente_ref_id != ''
        ORDER BY cu.fecha_compra DESC, cu.prioridad_tipo ASC;
    `;

    const resVentas = await db.query(queryVentas, params);

    // 3. Pre-cargar precios actuales de este artículo por lista (estrictamente activos/disponibles en la lista)
    const resPreciosActuales = await db.query(`
        SELECT la.lista_id, lp.nombre as lista_nombre, la.precio_final
        FROM public.bunker_lista_articulos la
        JOIN public.bunker_listas_precios lp ON lp.id = la.lista_id
        WHERE LOWER(TRIM(la.articulo_numero)) = LOWER(TRIM($1))
          AND COALESCE(la.disponible, false) = true
          AND COALESCE(la.precio_final, 0) > 0
    `, [sku]);

    const mapPreciosLista = new Map();
    resPreciosActuales.rows.forEach(p => mapPreciosLista.set(Number(p.lista_id), p));

    // Pre-cargar notificaciones registradas
    const resNotifs = await db.query(`
        SELECT cliente_id, estado, canal, notificado_at, notas
        FROM public.bunker_notificaciones_cambios_clientes
        WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1))
    `, [sku]);
    const mapNotifs = new Map();
    resNotifs.rows.forEach(n => mapNotifs.set(String(n.cliente_id), n));

    // 4. Agrupar compradores canónicamente (evitando duplicar el mismo cliente por presupuestos y facturas)
    const compradoresMap = new Map();

    for (const v of resVentas.rows) {
        const refId = String(v.cliente_ref_id).trim();
        const info = catalog.resolveClient(refId);
        const canonKey = info ? info.canonical_key : `unknown_${refId}`;

        if (!compradoresMap.has(canonKey)) {
            const listaId = Number(info?.lista_id || 1);
            // Si el artículo NO está activo en la lista asignada de este cliente, no aplica a este cliente
            const infoLista = mapPreciosLista.get(listaId);
            if (!infoLista) continue;
            const precioActualListaPura = parseFloat(infoLista.precio_final) || 0;
            const precioPagado = parseFloat(v.precio_historico_unitario) || 0;
            const precioPagadoNeto = parseFloat(v.precio_historico_neto) || 0;
            const descPct = parseFloat(v.descuento_pct) || 0;
            const factorDesc = descPct > 0 ? (1 - (descPct / 100)) : 1;
            const precioActual = Math.round(precioActualListaPura * factorDesc * 100) / 100;
            const diff = Math.round((precioActual - precioPagado) * 100) / 100;
            const diffPct = precioPagado > 0 ? (diff / precioPagado) * 100 : 0;

            const cIdNotif = info?.legacy_id || (parseInt(refId) || refId);
            const notifInfo = mapNotifs.get(String(cIdNotif)) || mapNotifs.get(String(refId));

            compradoresMap.set(canonKey, {
                cliente_id: cIdNotif,
                legacy_id: info?.legacy_id || null,
                serial_id: info?.serial_id || null,
                codigo_bunker_cliente: info?.codigo_bunker_cliente || null,
                nombre_cliente: info?.nombre_cliente || `Cliente #${refId}`,
                cliente_nombre: info?.nombre_cliente || `Cliente #${refId}`,
                telefono: info?.telefono || 'Sin teléfono',
                email: info?.email || '',
                lista_id: listaId,
                lista_nombre: info?.lista_nombre || infoLista.lista_nombre,
                ultima_compra_fecha: v.fecha_compra,
                total_cantidad_comprada: 0,
                ultimo_precio_pagado: precioPagado,
                precio_pagado_anterior: precioPagado,
                precio_pagado_neto: precioPagadoNeto,
                descuento_aplicado_pct: descPct,
                precio_actual_lista: precioActual,
                precio_actual_lista_pura: precioActualListaPura,
                diferencia_monto: diff,
                diferencia_porcentaje: diffPct,
                tipo_comprobante: v.origen_comprobante,
                ultimo_comprobante_tipo: v.origen_comprobante,
                comprobante_id: v.nro_comprobante,
                ultimo_comprobante_nro: v.nro_comprobante,
                pedidos_count: 0,
                estado_notificacion: notifInfo ? notifInfo.estado : 'PENDIENTE',
                notificado_at: notifInfo ? notifInfo.notificado_at : null,
                compras_anteriores: []
            });
        }

        const entry = compradoresMap.get(canonKey);
        entry.total_cantidad_comprada += parseFloat(v.cantidad) || 0;
        entry.pedidos_count++;
        if (entry.pedidos_count > 1) {
            entry.compras_anteriores.push({
                fecha_compra: v.fecha_compra,
                origen_comprobante: v.origen_comprobante,
                nro_comprobante: v.nro_comprobante,
                cantidad: parseFloat(v.cantidad) || 0,
                precio_pagado: parseFloat(v.precio_historico_unitario) || 0,
                precio_pagado_neto: parseFloat(v.precio_historico_neto) || 0,
                descuento_aplicado_pct: parseFloat(v.descuento_pct) || 0
            });
        }
    }

    return {
        articulo: {
            articulo_id: sku,
            codigo_barras: codBarras,
            descripcion: art.descripcion_generada || art.descripcion || sku,
            kilos_unidad: parseFloat(art.kilos_unidad) || 1
        },
        clientes: Array.from(compradoresMap.values())
    };
}

/**
 * MOTOR DE JERARQUÍA COMERCIAL B2B (Niveles 1 a 5)
 * Replica con exactitud la clasificación del Portal B2B (Configurar Jerarquía)
 * para organizar los artículos tal como el cliente realiza sus pedidos.
 */
async function cargarMapaJerarquiaB2B(db) {
    const jerarquiaMap = new Map();
    try {
        const jerarquiaRes = await db.query(`
            SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5 
            FROM public.bunker_portal_b2b_jerarquia 
            WHERE eje_nivel_3 IS NOT NULL AND TRIM(eje_nivel_3) != ''
        `);
        for (const jRow of jerarquiaRes.rows) {
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
    } catch (err) {
        console.warn('⚠️ No se pudo cargar bunker_portal_b2b_jerarquia:', err.message);
    }
    return jerarquiaMap;
}

function resolverJerarquiaB2BArticulo(artMaestro, jerarquiaMap, fallbackDescripcion = '') {
    let props = artMaestro?.propiedades_dinamicas;
    if (props && typeof props === 'string') {
        try {
            props = JSON.parse(props);
        } catch (e) {
            props = null;
        }
    }

    let familia = artMaestro?.familia_nombre ? String(artMaestro.familia_nombre).trim() : null;
    if (!familia && artMaestro?.rubro) familia = String(artMaestro.rubro).trim();
    if (!familia) familia = 'General';

    let articuloPrincipal = null;
    if (props && props.articulo_principal) {
        const rawArtPrinc = props.articulo_principal;
        articuloPrincipal = (typeof rawArtPrinc === 'object' && rawArtPrinc.valor)
            ? String(rawArtPrinc.valor).trim()
            : String(rawArtPrinc).trim();
    }
    if (!articuloPrincipal && artMaestro?.sub_rubro) {
        articuloPrincipal = String(artMaestro.sub_rubro).trim();
    }
    if (!articuloPrincipal && fallbackDescripcion) {
        articuloPrincipal = String(fallbackDescripcion).split(' ')[0].trim();
    }
    if (!articuloPrincipal) {
        articuloPrincipal = 'General';
    }

    let subCategoria = null;
    let subSubCategoria = null;
    let subSubSubCategoria = null;

    const famId = artMaestro?.familia_id || 0;
    const jerarquiaKey = `${famId}___${articuloPrincipal.toLowerCase()}`;
    const confRule = jerarquiaMap ? (jerarquiaMap.get(jerarquiaKey) || null) : null;

    if (confRule && props && typeof props === 'object') {
        const posObj = props.posiciones || props;

        // 1. Nivel 3
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

        // 2. Nivel 4
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
            }
        }

        // 3. Nivel 5
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
            }
        }
    }

    // Formatear etiqueta legible de artículo principal (ej. "Pasas de" + "Uva" -> "Pasas de Uva")
    let articuloPrincipalDisplay = articuloPrincipal;
    let nivelesSub = [subCategoria, subSubCategoria, subSubSubCategoria].filter(Boolean);
    if (/\bde$/i.test(articuloPrincipalDisplay) && nivelesSub.length > 0) {
        articuloPrincipalDisplay = `${articuloPrincipalDisplay} ${nivelesSub[0]}`;
        nivelesSub = nivelesSub.slice(1);
    }
    const princDispLower = String(articuloPrincipalDisplay || '').trim().toLowerCase();
    nivelesSub = nivelesSub.filter(s => String(s || '').trim().toLowerCase() !== princDispLower);

    const rutaSubcategoria = nivelesSub.join(' › ');
    const rutaCompleta = [familia, articuloPrincipalDisplay, ...nivelesSub].filter(Boolean).join(' › ');

    return {
        familia_b2b: familia,
        articulo_principal_b2b: articuloPrincipal,
        articulo_principal_display: articuloPrincipalDisplay,
        subcategoria_b2b: subCategoria || null,
        sub_subcategoria_b2b: subSubCategoria || null,
        sub_sub_subcategoria_b2b: subSubSubCategoria || null,
        ruta_subcategoria_b2b: rutaSubcategoria,
        ruta_jerarquia_b2b: rutaCompleta
    };
}

function ordenarArticulosPorJerarquiaB2B(articulos) {
    return articulos.sort((a, b) => {
        const famCmp = (a.familia_b2b || 'ZZZ').localeCompare(b.familia_b2b || 'ZZZ', 'es', { sensitivity: 'base' });
        if (famCmp !== 0) return famCmp;

        const artPCmp = (a.articulo_principal_display || a.articulo_principal_b2b || 'ZZZ')
            .localeCompare(b.articulo_principal_display || b.articulo_principal_b2b || 'ZZZ', 'es', { sensitivity: 'base' });
        if (artPCmp !== 0) return artPCmp;

        const subCmp = (a.ruta_subcategoria_b2b || '')
            .localeCompare(b.ruta_subcategoria_b2b || '', 'es', { sensitivity: 'base', numeric: true });
        if (subCmp !== 0) return subCmp;

        return (a.descripcion || '').localeCompare(b.descripcion || '', 'es', { sensitivity: 'base', numeric: true });
    });
}

/**
 * Extrae los ejes normalizados de propiedades_dinamicas.posiciones de un artículo Búnker.
 */
function extraerPosicionesNormalizadas(propiedades_dinamicas) {
    const pd = propiedades_dinamicas && typeof propiedades_dinamicas === 'object' ? propiedades_dinamicas : {};
    const pos = pd.posiciones && typeof pd.posiciones === 'object' ? pd.posiciones : {};
    const ejesMap = {};
    for (const [k, item] of Object.entries(pos)) {
        if (item && typeof item === 'object') {
            const ejeKey = String(item.eje || k).trim().toLowerCase();
            if (item.valor !== undefined && item.valor !== null && String(item.valor).trim() !== '') {
                ejesMap[ejeKey] = String(item.valor).trim();
            }
        } else if (typeof item === 'string' && item.trim() !== '') {
            ejesMap[k.trim().toLowerCase()] = item.trim();
        }
    }
    return {
        articulo_principal: String(pd.articulo_principal || '').trim().toUpperCase(),
        articulo_principal_id: pd.articulo_principal_id ? Number(pd.articulo_principal_id) : null,
        conformacion: ejesMap['conformacion'] || '',
        tratamiento: ejesMap['tratamiento'] || '',
        variedad: ejesMap['variedad'] || '',
        definicion: ejesMap['definicion'] || '',
        calibre: ejesMap['calibre'] || '',
        origen: ejesMap['origen'] || ''
    };
}

/**
 * Carga en una sola consulta el estado real de disponibilidad física/productiva (Flujo 1 y Flujo 2)
 * y los precios vigentes por lista para poder detectar faltantes de stock y sugerir dinámicamente
 * la alternativa más cercana disponible en la misma lista del cliente.
 */
async function cargarCatalogoDisponibilidadYAlternativas(db) {
    const [resStockCat, resPreciosListas] = await Promise.all([
        db.query(`
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
            ),
            receta_mono AS (
              SELECT
                r.articulo_numero,
                r.id AS receta_id,
                COUNT(i.id) AS cant_ing_no_insumo,
                MAX(i.id) AS ingrediente_id,
                MAX(ri.cantidad) AS req_kg,
                MAX(i.nombre) AS ing_nombre,
                MAX(COALESCE(i.stock_actual, 0)) AS ing_suelto,
                MAX(i.articulo_vinculado_numero) AS articulo_vinculado_numero
              FROM public.recetas r
              JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
              JOIN public.ingredientes i ON i.id = ri.ingrediente_id AND COALESCE(i.es_insumo, false) = false
              WHERE r.id = (
                SELECT r2.id FROM public.recetas r2
                WHERE r2.articulo_numero = r.articulo_numero
                ORDER BY r2.fecha_creacion DESC LIMIT 1
              )
              GROUP BY r.articulo_numero, r.id
            )
            SELECT
                ba.articulo_id,
                a.codigo_barras,
                COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), NULLIF(TRIM(ba.descripcion), ''), ba.articulo_id) AS descripcion,
                ba.familia_id,
                ba.kilos_unidad,
                ba.propiedades_dinamicas,
                (COALESCE(ba.es_pack, false) = true OR COALESCE(src.es_pack, false) = true) AS es_pack,
                COALESCE(ba.pack_unidades, src.pack_unidades, 1) AS pack_unidades,
                COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')) AS pack_hijo_codigo,
                src_hijo.articulo_numero AS hijo_articulo_numero,
                CASE
                  WHEN (
                    COALESCE(ba.es_pack, false) = true
                    OR COALESCE(src.es_pack, false) = true
                    OR COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')) IS NOT NULL
                  ) AND COALESCE(ba.pack_unidades, src.pack_unidades, 1) > 1
                  THEN
                    GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                    FLOOR(
                      GREATEST(0, 
                        COALESCE(src_hijo.stock_consolidado, 0) - (
                          COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, src.pack_unidades, 1))
                        )
                      ) / COALESCE(ba.pack_unidades, src.pack_unidades, 1)
                    )
                  ELSE
                    GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                END AS stock_disponible,
                rm.receta_id,
                rm.cant_ing_no_insumo,
                rm.ingrediente_id,
                rm.req_kg,
                rm.ing_nombre,
                rm.ing_suelto,
                rm.articulo_vinculado_numero,
                (
                    SELECT COALESCE(SUM(
                        GREATEST(0, COALESCE(src2.stock_consolidado, 0) - COALESCE(res2.cantidad_reservada, 0)) * COALESCE(src2.kilos_unidad, 1)
                    ), 0)
                    FROM (
                        SELECT iba.bunker_articulo_id AS art_num FROM public.ingrediente_bunker_articulos iba WHERE iba.ingrediente_id = rm.ingrediente_id
                        UNION
                        SELECT rm.articulo_vinculado_numero AS art_num WHERE rm.articulo_vinculado_numero IS NOT NULL
                    ) vinc
                    JOIN public.stock_real_consolidado src2 ON src2.articulo_numero = vinc.art_num
                    LEFT JOIN reservas_crudas res2 ON res2.articulo_numero = vinc.art_num
                ) AS ing_bultos_disp_kg,
                (
                    SELECT COALESCE(SUM((d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) * (COALESCE(d.kilos_asignados, 0) / NULLIF(d.cantidad_asignada, 0))), 0)
                    FROM public.bunker_lotes_destinos d
                    WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = rm.ingrediente_id::text
                ) AS ing_lotes_kg,
                EXISTS (SELECT 1 FROM public.ingrediente_composicion ic WHERE ic.mix_id = rm.ingrediente_id) AS ing_es_mix,
                EXISTS (
                    SELECT 1 FROM public.recetas r_ap
                    JOIN public.receta_ingredientes ri_ap ON ri_ap.receta_id = r_ap.id
                    JOIN public.ingrediente_composicion ic_ap ON ic_ap.mix_id = ri_ap.ingrediente_id
                    WHERE r_ap.articulo_numero = rm.articulo_vinculado_numero
                ) AS ing_viene_de_ap_mix,
                EXISTS (
                    SELECT 1 FROM public.articulos_produccion_externa_relacion aper
                    WHERE aper.articulo_kilo_codigo = rm.articulo_vinculado_numero
                       OR aper.articulo_produccion_codigo = rm.articulo_vinculado_numero
                ) AS ing_es_up
            FROM public.bunker_articulos ba
            LEFT JOIN public.articulos a ON ba.articulo_id = a.numero
            LEFT JOIN public.stock_real_consolidado src ON (LOWER(src.articulo_numero) = LOWER(ba.articulo_id) OR LOWER(src.codigo_barras) = LOWER(ba.articulo_id))
            LEFT JOIN public.stock_real_consolidado src_hijo ON (
                COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')) IS NOT NULL
                AND (
                    LOWER(src_hijo.articulo_numero) = LOWER(COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')))
                    OR LOWER(src_hijo.codigo_barras) = LOWER(COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')))
                )
            )
            LEFT JOIN reservas_crudas res_art ON (LOWER(res_art.articulo_numero) = LOWER(ba.articulo_id))
            LEFT JOIN reservas_crudas res_hijo ON (LOWER(res_hijo.articulo_numero) = LOWER(src_hijo.articulo_numero))
            LEFT JOIN LATERAL (
                SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
                FROM public.bunker_articulos bp
                JOIN reservas_crudas rc_padre ON LOWER(rc_padre.articulo_numero) = LOWER(bp.articulo_id)
                WHERE (COALESCE(bp.es_pack, false) = true OR COALESCE(bp.pack_unidades, 1) > 1)
                  AND (LOWER(bp.pack_hijo_codigo) = LOWER(ba.articulo_id) OR LOWER(bp.pack_hijo_codigo) = LOWER(a.codigo_barras))
            ) res_padres ON true
            LEFT JOIN receta_mono rm ON rm.articulo_numero = ba.articulo_id
        `),
        db.query(`
            SELECT lista_id, articulo_numero, precio_final, disponible
            FROM public.bunker_lista_articulos
            WHERE COALESCE(disponible, false) = true AND COALESCE(precio_final, 0) > 0
        `)
    ]);

    const mapaDisponibilidad = new Map();
    const mapaCodigoBarras = new Map();
    for (const r of resStockCat.rows) {
        const skuClean = String(r.articulo_id || '').trim();
        if (!skuClean) continue;

        const packUnidades = Math.max(1, Number(r.pack_unidades) || 1);
        const packHijoCodigo = r.pack_hijo_codigo ? String(r.pack_hijo_codigo).trim() : null;
        const hijoArticuloNum = r.hijo_articulo_numero ? String(r.hijo_articulo_numero).trim() : packHijoCodigo;
        const esPackPadre = Boolean((r.es_pack || packHijoCodigo) && packUnidades > 1);

        const esDirecto = !r.receta_id || esPackPadre;
        const esMonoPuro = Boolean(
            r.receta_id &&
            Number(r.cant_ing_no_insumo) === 1 &&
            !r.ing_es_mix &&
            !r.ing_viene_de_ap_mix &&
            !r.ing_es_up
        );

        const stockDisp = Number(r.stock_disponible) || 0;
        const reqKg = Number(r.req_kg) || Number(r.kilos_unidad) || 1;
        const mpTotalKg = Math.max(0, Number(r.ing_suelto) || 0)
            + Math.max(0, Number(r.ing_bultos_disp_kg) || 0)
            + Math.max(0, Number(r.ing_lotes_kg) || 0);

        let sinStock = false;
        let unidadesPotenciales = 0;
        if (esDirecto) {
            unidadesPotenciales = Math.floor(stockDisp);
            if (esMonoPuro) {
                unidadesPotenciales = Math.max(unidadesPotenciales, Math.floor(mpTotalKg / reqKg));
            }
            sinStock = unidadesPotenciales <= 0;
        } else if (esMonoPuro) {
            unidadesPotenciales = Math.floor(mpTotalKg / reqKg);
            sinStock = unidadesPotenciales <= 0;
        }

        const itemObj = {
            articulo_id: skuClean,
            codigo_barras: r.codigo_barras ? String(r.codigo_barras).trim() : null,
            descripcion: r.descripcion,
            familia_id: r.familia_id ? Number(r.familia_id) : null,
            kilos_unidad: Number(r.kilos_unidad) || 1,
            es_pack: Boolean(r.es_pack),
            esPackPadre,
            pack_unidades: packUnidades,
            pack_hijo_codigo: packHijoCodigo,
            hijo_articulo_numero: hijoArticuloNum,
            stock_disponible: stockDisp,
            receta_id: r.receta_id ? Number(r.receta_id) : null,
            ingrediente_id: r.ingrediente_id ? Number(r.ingrediente_id) : null,
            ing_nombre: r.ing_nombre || null,
            articulo_vinculado_numero: r.articulo_vinculado_numero ? String(r.articulo_vinculado_numero).trim() : null,
            esDirecto,
            esMonoPuro,
            mpTotalKg,
            unidadesPotenciales,
            sinStock,
            attrs: extraerPosicionesNormalizadas(r.propiedades_dinamicas)
        };
        mapaDisponibilidad.set(skuClean.toLowerCase(), itemObj);
        if (itemObj.codigo_barras) {
            mapaCodigoBarras.set(itemObj.codigo_barras.toLowerCase(), itemObj);
        }
    }

    // Segunda pasada para artículos padre/pack: si el pack no alcanzó con el stock físico directo del hijo,
    // verificar si el artículo hijo tiene disponibilidad productiva (esMonoPuro) suficiente para cubrir el pack.
    for (const itemObj of mapaDisponibilidad.values()) {
        if (!itemObj.esPackPadre || !itemObj.sinStock) continue;
        const hijoKey = (itemObj.hijo_articulo_numero || itemObj.pack_hijo_codigo || '').toLowerCase();
        if (!hijoKey) continue;
        const hijoObj = mapaDisponibilidad.get(hijoKey) || mapaCodigoBarras.get(hijoKey);
        if (hijoObj && !hijoObj.sinStock && hijoObj.unidadesPotenciales >= itemObj.pack_unidades) {
            itemObj.unidadesPotenciales = Math.floor(hijoObj.unidadesPotenciales / itemObj.pack_unidades);
            itemObj.sinStock = itemObj.unidadesPotenciales <= 0;
        }
    }

    const mapaPreciosLista = new Map();
    for (const lp of resPreciosListas.rows) {
        const k = `${String(lp.articulo_numero || '').trim().toLowerCase()}_${Number(lp.lista_id)}`;
        mapaPreciosLista.set(k, {
            precio_final: Number(lp.precio_final) || 0,
            disponible: Boolean(lp.disponible)
        });
    }

    return { mapaDisponibilidad, mapaPreciosLista };
}

/**
 * Enriquece cada artículo afectado del cliente con diagnóstico de stock real/productivo
 * y, en caso de no contar con stock, resuelve dinámicamente la alternativa disponible más cercana
 * dentro de la misma lista de precios y con la misma bonificación comercial del cliente.
 */
function enriquecerArticulosConStockYAlternativas(articulos, listaId, stockCatalog) {
    if (!Array.isArray(articulos) || !stockCatalog) return articulos;
    const { mapaDisponibilidad, mapaPreciosLista } = stockCatalog;
    const todosCatalogo = Array.from(mapaDisponibilidad.values());
    const numLista = Number(listaId) || 1;

    for (const art of articulos) {
        const skuKey = String(art.articulo_numero || '').trim().toLowerCase();
        const info = mapaDisponibilidad.get(skuKey);

        art.sin_stock_actual = Boolean(info?.sinStock);
        art.unidades_disponibles_stock = info ? info.unidadesPotenciales : null;
        art.alternativa_sugerida = null;

        if (!info || !info.sinStock) continue;

        // Buscar candidatos con stock disponible dentro de la misma Familia y Artículo Principal
        const candidatos = [];
        for (const cand of todosCatalogo) {
            const candKey = cand.articulo_id.toLowerCase();
            if (candKey === skuKey) continue;
            if (cand.sinStock) continue;
            if (!cand.esDirecto && !cand.esMonoPuro) continue;
            if (cand.familia_id !== info.familia_id) continue;
            if (!cand.attrs.articulo_principal || cand.attrs.articulo_principal !== info.attrs.articulo_principal) continue;
            if (cand.attrs.tratamiento.toLowerCase() !== info.attrs.tratamiento.toLowerCase()) continue;
            if (cand.attrs.conformacion.toLowerCase() !== info.attrs.conformacion.toLowerCase()) continue;

            const precioEnLista = mapaPreciosLista.get(`${candKey}_${numLista}`);
            if (!precioEnLista || !precioEnLista.disponible || precioEnLista.precio_final <= 0) continue;

            let score = 0;
            if (cand.attrs.variedad.toLowerCase() === info.attrs.variedad.toLowerCase()) score += 100;
            if (cand.attrs.definicion.toLowerCase() === info.attrs.definicion.toLowerCase()) score += 80;
            if (cand.esMonoPuro === info.esMonoPuro) score += 60;
            const diffKg = Math.abs((cand.kilos_unidad || 1) - (info.kilos_unidad || 1));
            if (diffKg < 0.01) score += 50;
            score -= diffKg * 2;

            candidatos.push({
                cand,
                precio_lista_pura: precioEnLista.precio_final,
                score
            });
        }

        if (candidatos.length === 0) continue;

        candidatos.sort((a, b) => b.score - a.score);
        const mejor = candidatos[0];
        const bestCand = mejor.cand;

        // Detectar el atributo diferencial que distingue la alternativa (ej. Calibre 25/27)
        const diffs = [];
        if (bestCand.attrs.calibre && bestCand.attrs.calibre.toLowerCase() !== info.attrs.calibre.toLowerCase()) {
            diffs.push(`Calibre ${bestCand.attrs.calibre}`);
        }
        if (bestCand.attrs.variedad && bestCand.attrs.variedad.toLowerCase() !== info.attrs.variedad.toLowerCase()) {
            diffs.push(`Variedad ${bestCand.attrs.variedad}`);
        }
        if (bestCand.attrs.definicion && info.attrs.definicion && bestCand.attrs.definicion.toLowerCase() !== info.attrs.definicion.toLowerCase()) {
            diffs.push(bestCand.attrs.definicion);
        }
        if (diffs.length === 0 && Math.abs(bestCand.kilos_unidad - info.kilos_unidad) >= 0.01) {
            diffs.push(`Presentación x ${bestCand.kilos_unidad}kg`);
        }

        const descPct = parseFloat(art.descuento_aplicado_pct) || 0;
        const factorDesc = descPct > 0 ? (1 - (descPct / 100)) : 1;

        const calcularPreciosCliente = (precioListaPura, kilosUnidad) => {
            const ku = Number(kilosUnidad) || 1;
            const bulto = Math.round(precioListaPura * factorDesc * 100) / 100;
            const kilo = ku > 0 ? Math.round((bulto / ku) * 100) / 100 : bulto;
            return { bulto, kilo };
        };

        const preciosBest = calcularPreciosCliente(mejor.precio_lista_pura, bestCand.kilos_unidad);

        // Identificar otras presentaciones (ej. x 2kg, x 10kg) del mismo insumo/bulto alternativo
        const bestVincLower = (bestCand.articulo_vinculado_numero || '').toLowerCase();
        const bestSkuLower = bestCand.articulo_id.toLowerCase();
        const otrasPresentaciones = candidatos
            .filter(item => {
                const c = item.cand;
                if (c.articulo_id.toLowerCase() === bestSkuLower) return false;
                if (bestCand.ingrediente_id && c.ingrediente_id === bestCand.ingrediente_id) return true;
                if (bestVincLower && c.articulo_id.toLowerCase() === bestVincLower) return true;
                if (bestCand.esDirecto && (c.articulo_vinculado_numero || '').toLowerCase() === bestSkuLower) return true;
                return false;
            })
            .sort((a, b) => (a.cand.kilos_unidad || 1) - (b.cand.kilos_unidad || 1))
            .map(item => {
                const pr = calcularPreciosCliente(item.precio_lista_pura, item.cand.kilos_unidad);
                return {
                    articulo_numero: item.cand.articulo_id,
                    descripcion: item.cand.descripcion,
                    kilos_unidad: item.cand.kilos_unidad,
                    unidades_disponibles: item.cand.unidadesPotenciales,
                    precio_nuevo_vigente: pr.bulto,
                    precio_nuevo_kilo: pr.kilo
                };
            });

        art.alternativa_sugerida = {
            articulo_numero: bestCand.articulo_id,
            descripcion: bestCand.descripcion,
            kilos_unidad: bestCand.kilos_unidad,
            atributo_diferencial: diffs.join(' • ') || null,
            ingrediente_nombre: bestCand.ing_nombre || null,
            unidades_disponibles: bestCand.unidadesPotenciales,
            precio_nuevo_vigente: preciosBest.bulto,
            precio_nuevo_kilo: preciosBest.kilo,
            otras_presentaciones: otrasPresentaciones
        };
    }

    return articulos;
}

/**
 * CONFIGURACIÓN PERSONALIZADA DEL INFORME PDF POR CLIENTE ("De menos a más")
 */
const DEFAULT_CONFIG_INFORME_CLIENTE = {
    agrupar_jerarquia_b2b: true,
    niveles_agrupar_bunker: ['familia', 'principal'],
    mostrar_hijos_bunker: true,
    mostrar_composicion_mixes_bunker: false,
    mostrar_alternativas_stock: false,
    mostrar_precio_anterior: false,
    mostrar_porcentaje_variacion: false,
    mostrar_bulto: false,
    mostrar_ultima_compra: false,
    mostrar_diferencia_pesos: false,
    mostrar_codigos: false,
    mostrar_metricas_pie: false,
    mostrar_nombre_lista: false,
    modo_precio_bunker: 'kilo_y_bulto',
    destacar_ofertas_bunker: true,
    bonificacion_activa_bunker: true
};

let tablaConfigInformeCreada = false;
async function asegurarTablaConfigInforme(db) {
    if (tablaConfigInformeCreada) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS public.bunker_config_informe_precios_cliente (
            cliente_id TEXT PRIMARY KEY,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    tablaConfigInformeCreada = true;
}

async function obtenerConfigInformeCliente(cliente_id) {
    const db = getPool();
    await asegurarTablaConfigInforme(db);
    const key = String(cliente_id || '').trim();
    if (!key) return { ...DEFAULT_CONFIG_INFORME_CLIENTE };

    let keysToCheck = [key];
    try {
        const catalog = await buildClientCatalog(db);
        const info = catalog.resolveClient ? (catalog.resolveClient(key) || catalog.resolveClient(`b_${key}`)) : null;
        if (info) {
            if (info.legacy_id) keysToCheck.unshift(String(info.legacy_id));
            if (info.codigo_bunker_cliente) keysToCheck.push(String(info.codigo_bunker_cliente));
            if (info.bunker_id) {
                keysToCheck.push(`b_${info.bunker_id}`);
                keysToCheck.push(String(info.bunker_id));
            }
        }
    } catch (_) {}
    keysToCheck = Array.from(new Set(keysToCheck.filter(Boolean)));

    const res = await db.query(
        'SELECT config FROM public.bunker_config_informe_precios_cliente WHERE cliente_id = ANY($1) ORDER BY updated_at DESC LIMIT 1',
        [keysToCheck]
    );
    const saved = res.rows[0]?.config || {};
    return {
        ...DEFAULT_CONFIG_INFORME_CLIENTE,
        ...(typeof saved === 'object' && saved !== null ? saved : {})
    };
}

async function guardarConfigInformeCliente(cliente_id, nuevaConfig = {}) {
    const db = getPool();
    await asegurarTablaConfigInforme(db);
    const rawKey = String(cliente_id || '').trim();
    if (!rawKey) throw new Error('cliente_id es requerido');

    let canonicalKey = rawKey;
    try {
        const catalog = await buildClientCatalog(db);
        const info = catalog.resolveClient ? (catalog.resolveClient(rawKey) || catalog.resolveClient(`b_${rawKey}`)) : null;
        if (info && info.legacy_id) {
            canonicalKey = String(info.legacy_id);
        }
    } catch (_) {}

    const actual = await obtenerConfigInformeCliente(rawKey);
    const merged = { ...actual };
    const booleanKeys = [
        'agrupar_jerarquia_b2b',
        'mostrar_hijos_bunker',
        'mostrar_composicion_mixes_bunker',
        'mostrar_alternativas_stock',
        'mostrar_precio_anterior',
        'mostrar_porcentaje_variacion',
        'mostrar_bulto',
        'mostrar_ultima_compra',
        'mostrar_diferencia_pesos',
        'mostrar_codigos',
        'mostrar_metricas_pie',
        'mostrar_nombre_lista',
        'destacar_ofertas_bunker',
        'bonificacion_activa_bunker',
        'adjuntar_pdf_default',
        'configurado_manualmente'
    ];
    for (const k of booleanKeys) {
        if (nuevaConfig[k] !== undefined) {
            merged[k] = Boolean(nuevaConfig[k]);
        } else if (merged[k] === undefined && DEFAULT_CONFIG_INFORME_CLIENTE[k] !== undefined) {
            merged[k] = Boolean(DEFAULT_CONFIG_INFORME_CLIENTE[k]);
        }
    }
    if (Array.isArray(nuevaConfig.niveles_agrupar_bunker) && nuevaConfig.niveles_agrupar_bunker.length > 0) {
        merged.niveles_agrupar_bunker = nuevaConfig.niveles_agrupar_bunker.map(x => String(x));
    }
    if (nuevaConfig.modo_precio_bunker !== undefined) {
        merged.modo_precio_bunker = String(nuevaConfig.modo_precio_bunker || 'kilo_y_bulto');
    }
    if (nuevaConfig.alcance_pdf_bunker !== undefined) {
        merged.alcance_pdf_bunker = String(nuevaConfig.alcance_pdf_bunker || 'LISTA_COMPLETA');
    }
    if (nuevaConfig.filtro_tipo_padre_bunker !== undefined) {
        merged.filtro_tipo_padre_bunker = String(nuevaConfig.filtro_tipo_padre_bunker || 'TODOS');
    }
    if (Array.isArray(nuevaConfig.filtro_ldn_bunker)) {
        merged.filtro_ldn_bunker = nuevaConfig.filtro_ldn_bunker.map(x => Number(x)).filter(n => n >= 1 && n <= 6);
    }
    if (nuevaConfig.filtro_fraccion_op_bunker !== undefined) {
        merged.filtro_fraccion_op_bunker = String(nuevaConfig.filtro_fraccion_op_bunker || '');
    }
    if (nuevaConfig.filtro_fraccion_kg_bunker !== undefined) {
        merged.filtro_fraccion_kg_bunker = String(nuevaConfig.filtro_fraccion_kg_bunker || '');
    }
    if (nuevaConfig.filtro_busqueda_bunker !== undefined) {
        merged.filtro_busqueda_bunker = String(nuevaConfig.filtro_busqueda_bunker || '');
    }
    if (Array.isArray(nuevaConfig.ids_excluidos_bunker)) {
        merged.ids_excluidos_bunker = nuevaConfig.ids_excluidos_bunker.map(x => String(x)).filter(Boolean);
    }
    if (Array.isArray(nuevaConfig.ids_seleccionados_pdf_bunker)) {
        merged.ids_seleccionados_pdf_bunker = nuevaConfig.ids_seleccionados_pdf_bunker.map(x => String(x)).filter(Boolean);
    }

    await db.query(`
        INSERT INTO public.bunker_config_informe_precios_cliente (cliente_id, config, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (cliente_id) DO UPDATE SET
            config = bunker_config_informe_precios_cliente.config || EXCLUDED.config,
            updated_at = NOW();
    `, [canonicalKey, JSON.stringify(merged)]);

    return merged;
}

/**
 * Obtiene el resumen de artículos que cambiaron filtrando por un cliente específico.
 */
async function obtenerArticulosAfectadosPorCliente({ cliente_id, dias = 90 }) {
    const db = getPool();
    const cId = String(cliente_id).trim();

    let filtroInterval = "90 days";
    if (dias && dias !== 'all' && !isNaN(parseInt(dias))) {
        filtroInterval = `${parseInt(dias)} days`;
    }

    const [catalog, resArts, jerarquiaMap, stockCatalog] = await Promise.all([
        buildClientCatalog(db),
        db.query(`
            SELECT 
                ba.articulo_id, 
                ba.descripcion_generada, 
                ba.descripcion, 
                ba.kilos_unidad, 
                ba.familia_id,
                ba.rubro,
                ba.sub_rubro,
                bf.nombre as familia_nombre,
                ba.propiedades_dinamicas,
                a.codigo_barras
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.articulos a ON TRIM(a.numero::text) = TRIM(ba.articulo_id)
        `),
        cargarMapaJerarquiaB2B(db),
        cargarCatalogoDisponibilidadYAlternativas(db)
    ]);

    const mapaArticuloCanonico = new Map();
    resArts.rows.forEach(a => {
        const skuCanon = a.articulo_id.trim();
        mapaArticuloCanonico.set(skuCanon.toLowerCase(), a);
        if (a.codigo_barras) {
            mapaArticuloCanonico.set(a.codigo_barras.trim().toLowerCase(), a);
        }
    });

    const infoCliente = catalog.resolveClient(cId);

    const matchingIds = infoCliente ? infoCliente.matching_ids : [cId];
    const listaAsignadaId = infoCliente?.lista_id || 1;
    const clienteNombre = infoCliente?.nombre_cliente || `Cliente #${cId}`;
    const codBunker = infoCliente?.codigo_bunker_cliente || null;
    const tel = infoCliente?.telefono || 'Sin teléfono';

    const params = [matchingIds];
    let dateFilterFacturas = '';
    let dateFilterPresupuestos = '';
    
    if (dias !== 'all') {
        params.push(filtroInterval);
        dateFilterFacturas = `AND f.fecha_emision >= NOW() - ($2)::interval`;
        dateFilterPresupuestos = `AND COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) >= NOW() - ($2)::interval`;
    }

    const queryVentas = `
        WITH compras_cliente AS (
            SELECT 
                ffi.articulo_id as ref_articulo,
                f.fecha_emision as fecha_compra,
                'FACTURA' as origen_comprobante,
                COALESCE(f.cbte_nro::text, f.nro_interno::text, f.id::text) as nro_comprobante,
                ffi.qty::numeric as cantidad,
                -- Precio unitario efectivo CON IVA (con descuentos de factura aplicados)
                ROUND((ffi.imp_neto + COALESCE(ffi.imp_iva, 0)) / NULLIF(ffi.qty, 0), 2) AS precio_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(ffi.imp_neto / NULLIF(ffi.qty, 0), 2) AS precio_neto,
                CASE 
                    WHEN COALESCE(f.descuento, 0) > 1 THEN f.descuento 
                    ELSE COALESCE(f.descuento, 0) * 100 
                END AS descuento_pct,
                1 as prioridad_tipo
            FROM public.factura_factura_items ffi
            JOIN public.factura_facturas f ON f.id = ffi.factura_id
            WHERE f.estado IN ('APROBADA', 'APROBADA_LOCAL')
              AND f.estado != 'ANULADA'
              AND f.cliente_id::text = ANY($1)
              ${dateFilterFacturas}

            UNION ALL

            SELECT 
                pd.articulo as ref_articulo,
                COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) as fecha_compra,
                'PRESUPUESTO' as origen_comprobante,
                COALESCE(p.id_presupuesto_ext::text, p.id::text) as nro_comprobante,
                pd.cantidad::numeric as cantidad,
                -- Precio unitario efectivo CON IVA (con descuentos aplicados)
                ROUND(pd.precio1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(pd.valor1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_neto,
                LEAST(100.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) ELSE COALESCE(p.descuento, 0) * 100.0 END) 
                    + COALESCE(pd.descuento_adicional, 0)
                ) AS descuento_pct,
                2 as prioridad_tipo
            FROM public.presupuestos_detalles pd
            JOIN public.presupuestos p ON p.id = pd.id_presupuesto
            WHERE p.activo = true 
              AND p.estado NOT ILIKE '%anulado%'
              AND p.estado NOT ILIKE '%facturado%'
              AND p.factura_id IS NULL
              AND (
                  p.id_cliente::text = ANY($1)
                  OR p.cliente_nuevo_id::text = ANY($1)
              )
              ${dateFilterPresupuestos}
        )
        SELECT 
            cc.ref_articulo,
            cc.fecha_compra,
            cc.origen_comprobante,
            cc.nro_comprobante,
            cc.cantidad,
            cc.precio_unitario,
            cc.precio_neto,
            cc.descuento_pct,
            cc.prioridad_tipo
        FROM compras_cliente cc
        ORDER BY cc.fecha_compra DESC, cc.prioridad_tipo ASC;
    `;

    const resVentas = await db.query(queryVentas, params);
    if (resVentas.rows.length === 0) {
        return {
            cliente: {
                id: infoCliente?.legacy_id || (parseInt(cId) || null),
                legacy_id: infoCliente?.legacy_id || null,
                codigo_bunker_cliente: codBunker,
                nombre: clienteNombre,
                cuit: infoCliente?.cuit || '',
                telefono: tel,
                lista_id: listaAsignadaId,
                lista_nombre: infoCliente?.lista_nombre || 'Lista General'
            },
            articulos: []
        };
    }

    const skusComprados = Array.from(new Set(resVentas.rows.map(r => {
        const ref = r.ref_articulo.trim().toLowerCase();
        const art = mapaArticuloCanonico.get(ref);
        return art ? art.articulo_id.trim().toLowerCase() : ref;
    })));

    const resCambios = await db.query(`
        SELECT 
            h.id as cambio_precio_id,
            h.articulo_numero,
            h.codigo_barras,
            h.descripcion,
            h.kilos_unidad,
            h.lista_id,
            h.lista_nombre,
            h.precio_anterior,
            h.precio_nuevo,
            h.variacion_monto,
            h.variacion_porcentaje,
            h.created_at as fecha_cambio
        FROM public.bunker_historial_cambios_precios h
        WHERE h.lista_id = $1
          AND ABS(h.variacion_monto) >= 0.01
          AND (
              LOWER(TRIM(h.articulo_numero)) = ANY($2)
              OR LOWER(TRIM(COALESCE(h.codigo_barras, ''))) = ANY($2)
          )
        ORDER BY h.created_at DESC
    `, [listaAsignadaId, skusComprados]);

    const mapaCambiosPorSku = new Map();
    resCambios.rows.forEach(c => {
        const kSku = c.articulo_numero.trim().toLowerCase();
        if (!mapaCambiosPorSku.has(kSku)) mapaCambiosPorSku.set(kSku, c);
        if (c.codigo_barras) {
            const kCb = c.codigo_barras.trim().toLowerCase();
            if (!mapaCambiosPorSku.has(kCb)) mapaCambiosPorSku.set(kCb, c);
        }
    });

    const articulosMap = new Map();
    for (const v of resVentas.rows) {
        const refLimpiada = v.ref_articulo.trim().toLowerCase();
        const artMaestro = mapaArticuloCanonico.get(refLimpiada);
        const skuCanonico = artMaestro ? artMaestro.articulo_id.trim() : v.ref_articulo.trim();
        const skuKey = skuCanonico.toLowerCase();

        const cambio = mapaCambiosPorSku.get(skuKey);
        if (!cambio) continue;
        // Respetar estrictamente el estado activo/disponible en Artículos Búnker para la lista del cliente
        if (!stockCatalog.mapaPreciosLista.has(`${skuKey}_${listaAsignadaId}`)) continue;

        const compraRecord = {
            fecha_compra: v.fecha_compra,
            origen_comprobante: v.origen_comprobante,
            nro_comprobante: v.nro_comprobante,
            cantidad: parseFloat(v.cantidad) || 0,
            precio_pagado: parseFloat(v.precio_unitario) || 0,
            precio_pagado_neto: parseFloat(v.precio_neto) || 0,
            descuento_aplicado_pct: parseFloat(v.descuento_pct) || 0
        };

        if (!articulosMap.has(skuKey)) {
            const precioPagado = compraRecord.precio_pagado;
            const precioNuevoListaPura = parseFloat(cambio.precio_nuevo) || 0;
            const descPct = compraRecord.descuento_aplicado_pct || 0;
            const factorDesc = descPct > 0 ? (1 - (descPct / 100)) : 1;
            const precioNuevo = Math.round(precioNuevoListaPura * factorDesc * 100) / 100;
            const diffMonto = Math.round((precioNuevo - precioPagado) * 100) / 100;
            const diffPct = precioPagado > 0 ? (diffMonto / precioPagado) * 100 : 0;

            const ku = parseFloat(cambio.kilos_unidad) || parseFloat(artMaestro?.kilos_unidad) || 1;
            const precioPagadoKilo = ku > 0 ? Math.round((precioPagado / ku) * 100) / 100 : precioPagado;
            const precioNuevoKilo = ku > 0 ? Math.round((precioNuevo / ku) * 100) / 100 : precioNuevo;
            const diffKilo = ku > 0 ? Math.round((diffMonto / ku) * 100) / 100 : diffMonto;

            const jerarquiaB2B = resolverJerarquiaB2BArticulo(artMaestro, jerarquiaMap, cambio.descripcion);

            articulosMap.set(skuKey, {
                cambio_precio_id: cambio.cambio_precio_id,
                articulo_numero: cambio.articulo_numero,
                codigo_barras: cambio.codigo_barras,
                descripcion: cambio.descripcion,
                kilos_unidad: cambio.kilos_unidad,
                ...jerarquiaB2B,
                ultima_compra_fecha: compraRecord.fecha_compra,
                ultimo_comprobante_tipo: compraRecord.origen_comprobante,
                ultimo_comprobante_nro: compraRecord.nro_comprobante,
                total_comprado: compraRecord.cantidad,
                precio_pagado_anterior: precioPagado,
                precio_pagado_kilo: precioPagadoKilo,
                precio_pagado_neto: compraRecord.precio_pagado_neto,
                descuento_aplicado_pct: compraRecord.descuento_aplicado_pct,
                precio_nuevo_vigente: precioNuevo,
                precio_nuevo_kilo: precioNuevoKilo,
                precio_nuevo_lista_pura: precioNuevoListaPura,
                diferencia_monto: diffMonto,
                diferencia_kilo: diffKilo,
                diferencia_porcentaje: diffPct,
                fecha_cambio: cambio.fecha_cambio,
                compras_anteriores: []
            });
        } else {
            const artEntry = articulosMap.get(skuKey);
            artEntry.total_comprado += compraRecord.cantidad;
            artEntry.compras_anteriores.push(compraRecord);
        }
    }

    const articulosOrdenados = ordenarArticulosPorJerarquiaB2B(
        enriquecerArticulosConStockYAlternativas(Array.from(articulosMap.values()), listaAsignadaId, stockCatalog)
    );

    return {
        cliente: {
            id: infoCliente?.legacy_id || (parseInt(cId) || null),
            legacy_id: infoCliente?.legacy_id || null,
            codigo_bunker_cliente: codBunker,
            nombre: clienteNombre,
            cuit: infoCliente?.cuit || '',
            telefono: tel,
            lista_id: listaAsignadaId,
            lista_nombre: infoCliente?.lista_nombre || 'Lista General'
        },
        articulos: articulosOrdenados
    };
}

/**
 * Registra o actualiza el estado de aviso a un cliente.
 */
async function actualizarEstadoNotificacion({ historial_cambio_id, articulo_numero, cliente_id, codigo_bunker_cliente, cliente_nombre, estado, canal, notas }) {
    const db = getPool();
    let cambioId = historial_cambio_id;
    if (!cambioId && articulo_numero) {
        const resUltimo = await db.query(`
            SELECT id FROM public.bunker_historial_cambios_precios
            WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1))
            ORDER BY created_at DESC LIMIT 1
        `, [articulo_numero]);
        if (resUltimo.rows.length > 0) {
            cambioId = resUltimo.rows[0].id;
        }
    }

    const query = `
        INSERT INTO public.bunker_notificaciones_cambios_clientes (
            historial_cambio_id, articulo_numero, cliente_id, codigo_bunker_cliente,
            cliente_nombre, estado, canal, notificado_at, notas
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
        ON CONFLICT (historial_cambio_id, cliente_id) DO UPDATE SET
            estado = EXCLUDED.estado,
            canal = EXCLUDED.canal,
            notificado_at = NOW(),
            notas = COALESCE(EXCLUDED.notas, bunker_notificaciones_cambios_clientes.notas);
    `;

    await db.query(query, [
        cambioId, articulo_numero, cliente_id, codigo_bunker_cliente,
        cliente_nombre, estado, canal || 'WHATSAPP', notas || null
    ]);

    return { success: true };
}

/**
 * Búsqueda unificada de clientes para el autocompletado en el filtro por cliente
 */
async function buscarClientes(queryTerm = '') {
    const db = getPool();
    const catalog = await buildClientCatalog(db);
    const term = (queryTerm || '').trim().toLowerCase();

    const vistos = new Set();
    const resultados = [];

    catalog.map.forEach(c => {
        if (vistos.has(c.canonical_key)) return;

        const match = !term ||
            c.nombre_cliente.toLowerCase().includes(term) ||
            (c.codigo_bunker_cliente && c.codigo_bunker_cliente.toLowerCase().includes(term)) ||
            (c.legacy_id && String(c.legacy_id).includes(term)) ||
            (c.cuit && c.cuit.includes(term));

        if (match) {
            vistos.add(c.canonical_key);
            resultados.push({
                id: c.legacy_id || c.serial_id,
                legacy_id: c.legacy_id,
                codigo_bunker_cliente: c.codigo_bunker_cliente,
                nombre: c.nombre_cliente,
                cuit: c.cuit,
                telefono: c.telefono,
                lista_id: c.lista_id,
                lista_nombre: c.lista_nombre
            });
        }
    });

    return resultados.slice(0, 25);
}

/**
 * ALIMENTADOR PROACTIVO DE CLIENTES AFECTADOS
 * Audita automáticamente quiénes compraron los artículos modificados en el período.
 * Normaliza y deduplica clientes usando el Catálogo Universal de Clientes.
 */
async function obtenerListadoClientesAfectados({ dias = 90, search = '' }) {
    const db = getPool();

    let filtroInterval = "90 days";
    if (dias && dias !== 'all' && !isNaN(parseInt(dias))) {
        filtroInterval = `${parseInt(dias)} days`;
    }

    // 1. Obtener artículos con variaciones registradas en el período
    let queryHistorial = `
        SELECT 
            h.id as historial_id,
            h.articulo_numero,
            h.codigo_barras,
            h.descripcion,
            h.kilos_unidad,
            h.lista_id,
            h.lista_nombre,
            h.precio_anterior,
            h.precio_nuevo,
            h.variacion_monto,
            h.variacion_porcentaje,
            h.created_at
        FROM public.bunker_historial_cambios_precios h
        WHERE ABS(h.variacion_monto) >= 0.01
    `;
    const paramsHistorial = [];
    if (dias !== 'all') {
        paramsHistorial.push(filtroInterval);
        queryHistorial += ` AND h.created_at >= NOW() - ($1)::interval`;
    }
    queryHistorial += ` ORDER BY h.created_at DESC`;

    const [resHistorial, catalog, resArts, jerarquiaMap, stockCatalog] = await Promise.all([
        db.query(queryHistorial, paramsHistorial),
        buildClientCatalog(db),
        db.query(`
            SELECT 
                ba.articulo_id, 
                ba.descripcion_generada, 
                ba.descripcion, 
                ba.kilos_unidad, 
                ba.familia_id,
                ba.rubro,
                ba.sub_rubro,
                bf.nombre as familia_nombre,
                ba.propiedades_dinamicas,
                a.codigo_barras
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.articulos a ON TRIM(a.numero::text) = TRIM(ba.articulo_id)
        `),
        cargarMapaJerarquiaB2B(db),
        cargarCatalogoDisponibilidadYAlternativas(db)
    ]);

    const articulosCambios = resHistorial.rows;
    if (articulosCambios.length === 0) return [];

    const mapaArticuloCanonico = new Map();
    resArts.rows.forEach(a => {
        const skuCanon = a.articulo_id.trim();
        mapaArticuloCanonico.set(skuCanon.toLowerCase(), a);
        if (a.codigo_barras) {
            mapaArticuloCanonico.set(a.codigo_barras.trim().toLowerCase(), a);
        }
    });

    const articulosSkus = Array.from(new Set(articulosCambios.map(a => a.articulo_numero.trim().toLowerCase())));
    const codBarrasSet = Array.from(new Set(articulosCambios.map(a => a.codigo_barras ? a.codigo_barras.trim() : null).filter(Boolean)));

    const mapaCambiosPorSkuLista = new Map();
    articulosCambios.forEach(ac => {
        const kSku = `${ac.articulo_numero.trim().toLowerCase()}_${ac.lista_id}`;
        if (!mapaCambiosPorSkuLista.has(kSku)) {
            mapaCambiosPorSkuLista.set(kSku, ac);
        }
        if (ac.codigo_barras) {
            const kCb = `${ac.codigo_barras.trim().toLowerCase()}_${ac.lista_id}`;
            if (!mapaCambiosPorSkuLista.has(kCb)) {
                mapaCambiosPorSkuLista.set(kCb, ac);
            }
        }
    });

    // 2. Buscar compras en Facturas aprobadas y Presupuestos activos no anulados ni ya facturados
    const queryVentas = `
        WITH compras_unificadas AS (
            -- FACTURAS (Aprobadas / ARCA / Internas) -> Máxima prioridad
            SELECT 
                f.cliente_id::text AS cliente_ref_id,
                ffi.articulo_id as ref_articulo,
                f.fecha_emision AS fecha_compra,
                'FACTURA' AS origen_comprobante,
                COALESCE(f.cbte_nro::text, f.nro_interno::text, f.id::text) AS nro_comprobante,
                ffi.qty::numeric AS cantidad,
                -- Precio unitario efectivo CON IVA (con descuentos de factura aplicados)
                ROUND((ffi.imp_neto + COALESCE(ffi.imp_iva, 0)) / NULLIF(ffi.qty, 0), 2) AS precio_historico_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(ffi.imp_neto / NULLIF(ffi.qty, 0), 2) AS precio_historico_neto,
                CASE 
                    WHEN COALESCE(f.descuento, 0) > 1 THEN f.descuento 
                    ELSE COALESCE(f.descuento, 0) * 100 
                END AS descuento_pct,
                1 as prioridad_tipo
            FROM public.factura_factura_items ffi
            JOIN public.factura_facturas f ON f.id = ffi.factura_id
            WHERE f.estado IN ('APROBADA', 'APROBADA_LOCAL')
              AND f.estado != 'ANULADA'
              AND (
                  LOWER(TRIM(ffi.articulo_id)) = ANY($1) 
                  OR TRIM(ffi.articulo_id) = ANY($2)
              )
              ${dias !== 'all' ? `AND f.fecha_emision >= NOW() - ('${filtroInterval}')::interval` : ''}

            UNION ALL

            -- PRESUPUESTOS (Activos, no anulados, y NO facturados)
            SELECT 
                COALESCE(p.cliente_nuevo_id, p.id_cliente::text) AS cliente_ref_id,
                pd.articulo as ref_articulo,
                COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) AS fecha_compra,
                'PRESUPUESTO' AS origen_comprobante,
                COALESCE(p.id_presupuesto_ext::text, p.id::text) AS nro_comprobante,
                pd.cantidad::numeric AS cantidad,
                -- Precio unitario efectivo CON IVA (con descuentos de presupuesto aplicados)
                ROUND(pd.precio1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_historico_unitario,
                -- Precio unitario efectivo NETO SIN IVA
                ROUND(pd.valor1 * (1.0 - LEAST(1.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) / 100.0 ELSE COALESCE(p.descuento, 0) END) 
                    + (COALESCE(pd.descuento_adicional, 0) / 100.0)
                )), 2) AS precio_historico_neto,
                LEAST(100.0, 
                    (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN COALESCE(p.descuento, 0) ELSE COALESCE(p.descuento, 0) * 100.0 END) 
                    + COALESCE(pd.descuento_adicional, 0)
                ) AS descuento_pct,
                2 as prioridad_tipo
            FROM public.presupuestos_detalles pd
            JOIN public.presupuestos p ON p.id = pd.id_presupuesto
            WHERE p.activo = true 
              AND p.estado NOT ILIKE '%anulado%'
              AND p.estado NOT ILIKE '%facturado%'
              AND p.factura_id IS NULL
              AND (
                  LOWER(TRIM(pd.articulo)) = ANY($1)
                  OR TRIM(pd.articulo) = ANY($2)
              )
              ${dias !== 'all' ? `AND COALESCE(p.fecha, p.fecha_actualizacion, p.fecha_entrega) >= NOW() - ('${filtroInterval}')::interval` : ''}
        )
        SELECT 
            cliente_ref_id,
            ref_articulo,
            fecha_compra,
            origen_comprobante,
            nro_comprobante,
            cantidad,
            precio_historico_unitario,
            precio_historico_neto,
            descuento_pct,
            prioridad_tipo
        FROM compras_unificadas
        WHERE cliente_ref_id IS NOT NULL AND cliente_ref_id != ''
        ORDER BY fecha_compra DESC, prioridad_tipo ASC;
    `;

    const [resVentas, resNotifs] = await Promise.all([
        db.query(queryVentas, [articulosSkus, codBarrasSet]),
        db.query('SELECT articulo_numero, cliente_id, estado, notificado_at FROM public.bunker_notificaciones_cambios_clientes')
    ]);

    const notifsMap = new Map();
    resNotifs.rows.forEach(n => notifsMap.set(`${n.articulo_numero.trim().toLowerCase()}_${n.cliente_id}`, n));

    const clientesAfectadosMap = new Map();

    for (const v of resVentas.rows) {
        const refId = String(v.cliente_ref_id).trim();
        const infoCliente = catalog.resolveClient(refId);

        const canonicalKey = infoCliente ? infoCliente.canonical_key : `unknown_${refId}`;

        if (!clientesAfectadosMap.has(canonicalKey)) {
            const nombre = infoCliente ? infoCliente.nombre_cliente : `Cliente #${refId}`;
            clientesAfectadosMap.set(canonicalKey, {
                cliente_id: infoCliente?.legacy_id || (parseInt(refId) || refId),
                legacy_id: infoCliente?.legacy_id || null,
                serial_id: infoCliente?.serial_id || null,
                bunker_id: infoCliente?.bunker_id || null,
                codigo_bunker_cliente: infoCliente?.codigo_bunker_cliente || null,
                nombre_cliente: nombre,
                cliente_nombre: nombre,
                telefono: infoCliente?.telefono || 'Sin teléfono',
                cuit: infoCliente?.cuit || '',
                lista_id: infoCliente?.lista_id || 1,
                lista_nombre: infoCliente?.lista_nombre || 'Lista General',
                articulos_map: new Map()
            });
        }

        const clienteObj = clientesAfectadosMap.get(canonicalKey);

        // Resolver SKU canónico a partir de ref_articulo (sea alfanumérico o código de barras)
        const refLimpiada = v.ref_articulo.trim().toLowerCase();
        const artMaestro = mapaArticuloCanonico.get(refLimpiada);
        const skuCanonico = artMaestro ? artMaestro.articulo_id.trim() : v.ref_articulo.trim();
        const skuKey = skuCanonico.toLowerCase();

        // Buscar el cambio de precio correspondiente estrictamente a este artículo y la lista del cliente (activo/disponible en la lista)
        const cambioArticulo = mapaCambiosPorSkuLista.get(`${skuKey}_${clienteObj.lista_id}`);
        if (!cambioArticulo) continue;
        if (!stockCatalog.mapaPreciosLista.has(`${skuKey}_${clienteObj.lista_id}`)) continue;

        const compraRecord = {
            fecha_compra: v.fecha_compra,
            origen_comprobante: v.origen_comprobante,
            nro_comprobante: v.nro_comprobante,
            cantidad: parseFloat(v.cantidad) || 0,
            precio_pagado: parseFloat(v.precio_historico_unitario) || 0,
            precio_pagado_neto: parseFloat(v.precio_historico_neto) || 0,
            descuento_pct: parseFloat(v.descuento_pct) || 0,
            descuento_aplicado_pct: parseFloat(v.descuento_pct) || 0
        };

        if (!clienteObj.articulos_map.has(skuKey)) {
            const precioPagado = compraRecord.precio_pagado;
            const precioNuevoListaPura = parseFloat(cambioArticulo.precio_nuevo) || 0;
            const descPct = compraRecord.descuento_pct || 0;
            const factorDesc = descPct > 0 ? (1 - (descPct / 100)) : 1;
            const precioNuevo = Math.round(precioNuevoListaPura * factorDesc * 100) / 100;
            const diffMonto = Math.round((precioNuevo - precioPagado) * 100) / 100;
            const diffPct = precioPagado > 0 ? (diffMonto / precioPagado) * 100 : 0;

            const ku = parseFloat(cambioArticulo.kilos_unidad) || parseFloat(artMaestro?.kilos_unidad) || 1;
            const precioPagadoKilo = ku > 0 ? Math.round((precioPagado / ku) * 100) / 100 : precioPagado;
            const precioNuevoKilo = ku > 0 ? Math.round((precioNuevo / ku) * 100) / 100 : precioNuevo;
            const diffKilo = ku > 0 ? Math.round((diffMonto / ku) * 100) / 100 : diffMonto;

            const jerarquiaB2B = resolverJerarquiaB2BArticulo(artMaestro, jerarquiaMap, cambioArticulo.descripcion);

            const notifKey = `${cambioArticulo.articulo_numero.trim().toLowerCase()}_${clienteObj.cliente_id}`;
            const notif = notifsMap.get(notifKey);

            clienteObj.articulos_map.set(skuKey, {
                cambio_precio_id: cambioArticulo.historial_id,
                articulo_numero: cambioArticulo.articulo_numero,
                codigo_barras: cambioArticulo.codigo_barras,
                descripcion: cambioArticulo.descripcion,
                kilos_unidad: cambioArticulo.kilos_unidad,
                ...jerarquiaB2B,
                ultima_compra_fecha: compraRecord.fecha_compra,
                ultimo_comprobante_tipo: compraRecord.origen_comprobante,
                ultimo_comprobante_nro: compraRecord.nro_comprobante,
                precio_pagado_anterior: precioPagado,
                precio_pagado_kilo: precioPagadoKilo,
                precio_pagado_neto: compraRecord.precio_pagado_neto,
                descuento_aplicado_pct: descPct,
                precio_nuevo_vigente: precioNuevo,
                precio_nuevo_kilo: precioNuevoKilo,
                precio_nuevo_lista_pura: precioNuevoListaPura,
                diferencia_monto: diffMonto,
                diferencia_kilo: diffKilo,
                diferencia_porcentaje: diffPct,
                total_comprado: compraRecord.cantidad,
                estado_notificacion: notif ? notif.estado : 'PENDIENTE',
                notificado_at: notif ? notif.notificado_at : null,
                compras_anteriores: []
            });
        } else {
            // Ya existe la compra más reciente: acumulamos como compra anterior
            const artEntry = clienteObj.articulos_map.get(skuKey);
            artEntry.total_comprado += compraRecord.cantidad;
            artEntry.compras_anteriores.push(compraRecord);
        }
    }

    clientesAfectadosMap.forEach(c => {
        c.articulos_afectados = ordenarArticulosPorJerarquiaB2B(
            enriquecerArticulosConStockYAlternativas(Array.from(c.articulos_map.values()), c.lista_id, stockCatalog)
        );
        delete c.articulos_map;
    });

    const resultado = Array.from(clientesAfectadosMap.values()).filter(c => c.articulos_afectados.length > 0);

    if (search && search.trim() !== '') {
        const s = search.trim().toLowerCase();
        return resultado.filter(c => 
            c.nombre_cliente.toLowerCase().includes(s) || 
            (c.codigo_bunker_cliente && c.codigo_bunker_cliente.toLowerCase().includes(s)) ||
            String(c.cliente_id).includes(s) ||
            (c.legacy_id && String(c.legacy_id).includes(s)) ||
            c.telefono.includes(s)
        );
    }

    return resultado;
}

/**
 * FORMATEADOR: Moneda Argentina
 */
function formatMonedaInforme(val) {
    const num = parseFloat(val) || 0;
    return '$ ' + num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * FORMATEADOR: Fecha DD/MM/AAAA
 */
function formatFechaInforme(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

let logoLamdaBase64 = null;
let isotipoLamdaBase64 = null;

function getLamdaLogosBase64() {
    if (!logoLamdaBase64 || !isotipoLamdaBase64) {
        const logoPath = path.join(__dirname, '../../app-etiquetas/img/logo_LAMDA.png');
        const isotipoPath = path.join(__dirname, '../../app-etiquetas/img/isotipo_L_LAMDA.png');
        
        if (fs.existsSync(logoPath)) {
            logoLamdaBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
        }
        if (fs.existsSync(isotipoPath)) {
            isotipoLamdaBase64 = `data:image/png;base64,${fs.readFileSync(isotipoPath).toString('base64')}`;
        }
    }
    return { logoLamdaBase64, isotipoLamdaBase64 };
}

/**
 * Genera el documento HTML completo y profesional del Informe Oficial de Precios LAMDA
 * Por defecto prioriza una lectura limpia, vertical, enfocada en el precio final por kilogramo
 * y agrupada según la Jerarquía y Subcategorías del Portal B2B ("De menos a más").
 */
async function generarHTMLInformePreciosCliente({ cliente_id, dias = 90, configOverride = null }) {
    const [data, savedConfig] = await Promise.all([
        obtenerArticulosAfectadosPorCliente({ cliente_id, dias }),
        obtenerConfigInformeCliente(cliente_id)
    ]);

    const cfg = {
        ...savedConfig,
        ...(configOverride && typeof configOverride === 'object' ? configOverride : {})
    };

    const cliente = data.cliente || {};
    const articulos = data.articulos || [];
    const { logoLamdaBase64, isotipoLamdaBase64 } = getLamdaLogosBase64();

    const fechaHoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
    const folioRef = `INF-LAMDA-${cliente.id || cliente.legacy_id || 'CLI'}-${Date.now().toString().slice(-6)}`;

    let sumPct = 0;
    articulos.forEach(a => sumPct += (parseFloat(a.diferencia_porcentaje) || 0));
    const promedioVar = articulos.length > 0 ? (sumPct / articulos.length) : 0;
    const descHabitual = articulos.find(a => (a.descuento_aplicado_pct || 0) > 0)?.descuento_aplicado_pct || 0;

    const totalCols = 3 + (cfg.mostrar_ultima_compra ? 1 : 0) + (cfg.mostrar_precio_anterior ? 1 : 0);

    let rowsHtml = '';
    let familiaActual = null;
    let artPrincipalActual = null;

    articulos.forEach(art => {
        const ku = parseFloat(art.kilos_unidad) || 1;
        const antBulto = parseFloat(art.precio_pagado_anterior) || 0;
        const antKilo = ku > 0 ? (antBulto / ku) : antBulto;
        const nuevoBulto = parseFloat(art.precio_nuevo_vigente) || 0;
        const nuevoKilo = ku > 0 ? (nuevoBulto / ku) : nuevoBulto;
        const diffBulto = parseFloat(art.diferencia_monto) || 0;
        const diffKilo = ku > 0 ? (diffBulto / ku) : diffBulto;
        const pct = parseFloat(art.diferencia_porcentaje) || 0;

        const esSuba = pct > 0.01;
        const esBaja = pct < -0.01;
        const badgeColor = esSuba ? '#dc2626' : (esBaja ? '#16a34a' : '#475569');
        const badgeBg = esSuba ? '#fef2f2' : (esBaja ? '#f0fdf4' : '#f8fafc');
        const badgeBorder = esSuba ? '#fca5a5' : (esBaja ? '#86efac' : '#cbd5e1');
        const flechaola = esSuba ? '▲' : (esBaja ? '▼' : '=');
        const iconoConSigno = esSuba ? '▲ +' : (esBaja ? '▼ -' : '= ');
        const varLabel = cfg.mostrar_porcentaje_variacion
            ? `${iconoConSigno}${Math.abs(pct).toFixed(1)}%`
            : flechaola;
        const signoKilo = diffKilo > 0 ? '+' : '';

        // Agrupamiento visual por Jerarquía B2B (Familia -> Artículo Principal)
        if (cfg.agrupar_jerarquia_b2b) {
            const fam = art.familia_b2b || 'General';
            const artP = art.articulo_principal_display || art.articulo_principal_b2b || 'General';

            if (fam !== familiaActual) {
                familiaActual = fam;
                artPrincipalActual = null;
                rowsHtml += `
                    <tr class="group-familia-row" style="background: #f1f5f9; border-top: 1.5px solid #cbd5e1; border-bottom: 1px solid #cbd5e1;">
                        <td colspan="${totalCols}" style="padding: 6px 12px; font-size: 10.5px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.06em;">
                            <span style="color: #8e4785; margin-right: 5px;">■</span> ${fam}
                        </td>
                    </tr>
                `;
            }

            if (artP !== artPrincipalActual) {
                artPrincipalActual = artP;
                rowsHtml += `
                    <tr class="group-artprincipal-row" style="background: #fdfafc; border-bottom: 1px solid #f1e4ef;">
                        <td colspan="${totalCols}" style="padding: 4px 12px 4px 22px; font-size: 10.5px; font-weight: 700; color: #73346b;">
                            ▸ ${artP}
                        </td>
                    </tr>
                `;
            }
        }

        const cbteStr = art.ultimo_comprobante_tipo && art.ultimo_comprobante_nro 
            ? `${art.ultimo_comprobante_tipo} #${art.ultimo_comprobante_nro}`
            : 'Última compra';

        const subcatBadge = (cfg.agrupar_jerarquia_b2b && art.ruta_subcategoria_b2b)
            ? `<span style="display: inline-block; margin-left: 6px; font-size: 9.5px; font-weight: 600; color: #64748b; background: #f8fafc; border: 1px solid #e2e8f0; padding: 1px 5px; border-radius: 4px; vertical-align: middle;">${art.ruta_subcategoria_b2b}</span>`
            : '';

        const mostrarStockInfo = cfg.mostrar_alternativas_stock !== false;
        const sinStockBadge = (mostrarStockInfo && art.sin_stock_actual)
            ? `<span style="display: inline-block; margin-left: 6px; font-size: 9px; font-weight: 700; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d; padding: 1px 6px; border-radius: 4px; vertical-align: middle;">⚠️ Sin stock actual</span>`
            : '';

        const tieneSubfilaAlternativa = Boolean(mostrarStockInfo && art.sin_stock_actual && art.alternativa_sugerida);

        rowsHtml += `
            <tr style="border-bottom: ${tieneSubfilaAlternativa ? '1px dashed #cbd5e1' : '1px solid #e2e8f0'};">
                <td style="padding: 7px 12px 7px ${cfg.agrupar_jerarquia_b2b ? '26px' : '12px'}; vertical-align: middle;">
                    <div style="font-weight: 700; color: #0f172a; font-size: 12.5px; line-height: 1.3;">
                        ${art.descripcion}${subcatBadge}${sinStockBadge}
                    </div>
                    ${cfg.mostrar_codigos ? `
                        <div style="font-family: Consolas, 'JetBrains Mono', monospace; font-size: 10px; color: #64748b; margin-top: 2px;">
                            SKU: <strong style="color: #8e4785;">${art.articulo_numero}</strong> ${art.codigo_barras ? `• CB: ${art.codigo_barras}` : ''} • Presentación: ${ku.toFixed(2)} kg
                        </div>
                    ` : ''}
                </td>
                ${cfg.mostrar_ultima_compra ? `
                <td style="padding: 7px 10px; vertical-align: middle; font-size: 10.5px; color: #475569;">
                    <div style="font-weight: 600; color: #1e293b;">${formatFechaInforme(art.ultima_compra_fecha)}</div>
                    <div style="color: #64748b; font-size: 9.5px;">${cbteStr}${art.total_comprado ? ` • Cant: ${art.total_comprado}` : ''}</div>
                </td>
                ` : ''}
                ${cfg.mostrar_precio_anterior ? `
                <td style="padding: 7px 12px; vertical-align: middle; text-align: right;">
                    <div style="font-size: 12.5px; font-weight: 700; color: #334155;">
                        ${formatMonedaInforme(antKilo)}<span style="font-size: 9.5px; color: #64748b; font-weight: 500;"> /kg</span>
                    </div>
                    ${cfg.mostrar_bulto ? `
                        <div style="font-size: 10px; color: #64748b; margin-top: 1px;">
                            Bulto (${ku}kg): ${formatMonedaInforme(antBulto)}
                        </div>
                    ` : ''}
                </td>
                ` : ''}
                <td style="padding: 7px 12px; vertical-align: middle; text-align: right; background: #fdfafc; border-left: 1px solid #f3d4ef; border-right: 1px solid #f3d4ef;">
                    <div style="font-size: 13px; font-weight: 800; color: #73346b;">
                        ${formatMonedaInforme(nuevoKilo)}<span style="font-size: 9.5px; color: #8e4785; font-weight: 600;"> /kg</span>
                    </div>
                    ${cfg.mostrar_bulto ? `
                        <div style="font-size: 10px; color: #8e4785; font-weight: 600; margin-top: 1px;">
                            Bulto (${ku}kg): ${formatMonedaInforme(nuevoBulto)}
                        </div>
                    ` : ''}
                </td>
                <td style="padding: 7px 12px; vertical-align: middle; text-align: center;">
                    <span style="display: inline-block; min-width: 28px; text-align: center; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 800; color: ${badgeColor}; background: ${badgeBg}; border: 1px solid ${badgeBorder};">
                        ${varLabel}
                    </span>
                    ${cfg.mostrar_diferencia_pesos ? `
                        <div style="font-size: 9.5px; font-weight: 600; color: ${badgeColor}; margin-top: 2px;">
                            ${signoKilo}${formatMonedaInforme(diffKilo)}/kg
                        </div>
                        ${cfg.mostrar_bulto ? `
                            <div style="font-size: 9px; color: #64748b;">
                                (${signoKilo}${formatMonedaInforme(diffBulto)} bulto)
                            </div>
                        ` : ''}
                    ` : ''}
                </td>
            </tr>
        `;

        if (tieneSubfilaAlternativa) {
            const alt = art.alternativa_sugerida;
            const altKu = parseFloat(alt.kilos_unidad) || 1;
            const diffTagHtml = alt.atributo_diferencial
                ? `<span style="display: inline-block; margin-left: 5px; font-size: 9px; font-weight: 700; color: #0369a1; background: #e0f2fe; border: 1px solid #bae6fd; padding: 0px 5px; border-radius: 3px; vertical-align: middle;">${alt.atributo_diferencial}</span>`
                : '';

            const otrasPresArr = Array.isArray(alt.otras_presentaciones) ? alt.otras_presentaciones : [];
            const otrasPresHtml = otrasPresArr.length > 0
                ? `<div style="font-size: 9.5px; color: #475569; margin-top: 2px; padding-left: 14px;">
                    También disponible en: ${otrasPresArr.map(op => `<strong>x ${Number(op.kilos_unidad)}kg</strong> (${formatMonedaInforme(op.precio_nuevo_kilo)} /kg)`).join(' • ')}
                   </div>`
                : '';

            rowsHtml += `
                <tr style="background: #f0fdf4; border-bottom: 1px solid #cbd5e1;">
                    <td colspan="${cfg.mostrar_ultima_compra ? 2 : 1}" style="padding: 5px 12px 6px ${cfg.agrupar_jerarquia_b2b ? '32px' : '18px'}; vertical-align: middle;">
                        <div style="font-size: 11px; color: #166534; line-height: 1.3;">
                            <span style="font-weight: 800; color: #15803d;">↳ Alternativa disponible:</span>
                            <strong style="color: #0f172a; font-size: 11.5px; margin-left: 3px;">${alt.descripcion}</strong>${diffTagHtml}
                        </div>
                        ${otrasPresHtml}
                    </td>
                    ${cfg.mostrar_precio_anterior ? `
                    <td style="padding: 5px 12px; vertical-align: middle; text-align: right; font-size: 9.5px; color: #64748b; font-style: italic;">
                        Sugerencia en stock
                    </td>
                    ` : ''}
                    <td style="padding: 5px 12px; vertical-align: middle; text-align: right; background: #dcfce7; border-left: 1px solid #86efac; border-right: 1px solid #86efac;">
                        <div style="font-size: 12.5px; font-weight: 800; color: #15803d;">
                            ${formatMonedaInforme(alt.precio_nuevo_kilo)}<span style="font-size: 9px; color: #166534; font-weight: 600;"> /kg</span>
                        </div>
                        ${cfg.mostrar_bulto ? `
                            <div style="font-size: 9.5px; color: #166534; font-weight: 600; margin-top: 1px;">
                                Bulto (${altKu}kg): ${formatMonedaInforme(alt.precio_nuevo_vigente)}
                            </div>
                        ` : ''}
                    </td>
                    <td style="padding: 5px 12px; vertical-align: middle; text-align: center;">
                        <span style="display: inline-block; min-width: 28px; text-align: center; padding: 2px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fcd34d;" title="Alternativa por Sin Stock">
                            S/S
                        </span>
                    </td>
                </tr>
            `;
        }
    });

    const tarjetasMetricasPie = cfg.mostrar_metricas_pie ? `
        <!-- TARJETAS DE RESUMEN Y MÉTRICAS CLAVE (OPCIONAL) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 12px; text-align: center;">
            <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase;">Artículos Informados</div>
            <div style="font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 2px;">${articulos.length} productos</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 12px; text-align: center;">
            <div style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase;">Variación Promedio</div>
            <div style="font-size: 15px; font-weight: 800; color: ${promedioVar > 0 ? '#b91c1c' : '#15803d'}; margin-top: 2px;">
              ${promedioVar > 0 ? '+' : ''}${promedioVar.toFixed(1)}%
            </div>
          </div>
          <div style="background: #fdfafc; border: 1px solid #f3d4ef; border-radius: 6px; padding: 9px 12px; text-align: center;">
            <div style="font-size: 9px; font-weight: 700; color: #8e4785; text-transform: uppercase;">Vigencia</div>
            <div style="font-size: 15px; font-weight: 800; color: #8e4785; margin-top: 2px;">Inmediata</div>
          </div>
        </div>
    ` : '';

    const tablaOContenidoVacio = articulos.length > 0 ? `
        <!-- TABLA VERTICAL CONCISA DE PRECIOS POR KILO -->
        <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 16px;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11.5px;">
            <thead>
              <tr style="background: #334155; color: #ffffff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">
                <th style="padding: 8px 12px; font-weight: 700;">Artículo</th>
                ${cfg.mostrar_ultima_compra ? `<th style="padding: 8px 10px; font-weight: 700;">Última Compra</th>` : ''}
                ${cfg.mostrar_precio_anterior ? `<th style="padding: 8px 12px; font-weight: 700; text-align: right; width: 150px;">Pagado Anterior (/kg)</th>` : ''}
                <th style="padding: 8px 12px; font-weight: 700; text-align: right; background: #1e293b; width: 155px;">Precio Actual (/kg)</th>
                <th style="padding: 8px 12px; font-weight: 700; text-align: center; width: ${cfg.mostrar_porcentaje_variacion || cfg.mostrar_diferencia_pesos ? '105px' : '82px'};">Variación</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>

        ${tarjetasMetricasPie}
    ` : `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 30px 20px; text-align: center; color: #64748b; margin-bottom: 20px;">
          <div style="font-size: 26px; margin-bottom: 8px;">✅</div>
          <div style="font-weight: 700; color: #0f172a; font-size: 14px; margin-bottom: 4px;">Precios Estables y Sin Modificaciones</div>
          <div style="font-size: 11.5px; color: #475569;">No se registraron variaciones de precios en los insumos habituales de este cliente en los últimos ${dias === 'all' ? 'meses' : dias + ' días'}.</div>
        </div>
    `;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe de Actualización de Precios — LAMDA — ${cliente.nombre || 'Cliente'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #f1f5f9;
      padding: 0;
      margin: 0;
      -webkit-font-smoothing: antialiased;
      line-height: 1.4;
      font-size: 12px;
    }
    .document-page {
      max-width: 820px;
      margin: 18px auto;
      background: #ffffff;
      padding: 28px 34px;
      border-radius: 6px;
      box-shadow: 0 3px 16px rgba(0,0,0,0.08);
    }
    @media print {
      body { background: #fff !important; }
      .document-page { max-width: 100%; padding: 0; margin: 0; box-shadow: none; border-radius: 0; }
      @page { size: A4 portrait; margin: 10mm 12mm 10mm 12mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <!-- BARRA DE ACCIÓN SUPERIOR NO IMPRIMIBLE -->
  <div class="no-print" style="background: #0f172a; padding: 9px 22px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; position: sticky; top: 0; z-index: 100;">
    <div style="display: flex; align-items: center; gap: 10px; color: #94a3b8; font-size: 11.5px;">
      <span style="font-weight: 800; color: #8e4785; font-size: 13px;">LAMDA</span>
      <span>•</span>
      <span>Reporte de Precios por Cliente</span>
    </div>
    <div style="display: flex; gap: 10px;">
      <button onclick="if (window.parent && window.parent.enviarInformePreciosOmnicanal) { window.parent.enviarInformePreciosOmnicanal('${cliente.legacy_id || cliente.id}'); }" style="background: #10b981; color: white; border: none; padding: 6px 15px; border-radius: 5px; font-weight: 700; cursor: pointer; font-size: 11.5px; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(16,185,129,0.3);">
        📤 Enviar por WhatsApp / Correo
      </button>
      <button onclick="window.print()" style="background: #8e4785; color: white; border: none; padding: 6px 15px; border-radius: 5px; font-weight: 600; cursor: pointer; font-size: 11.5px; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(142,71,133,0.3);">
        🖨️ Imprimir / Guardar PDF
      </button>
    </div>
  </div>

  <div class="document-page">
    
    <!-- HEADER CORPORATIVO OFICIAL LAMDA -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #8e4785; padding-bottom: 12px; margin-bottom: 14px;">
      <div style="display: flex; flex-direction: column; gap: 2px;">
        ${logoLamdaBase64 ? `
          <img src="${logoLamdaBase64}" alt="LAMDA" style="height: 36px; width: auto; object-fit: contain; margin-bottom: 2px; align-self: flex-start;">
        ` : `
          <h1 style="font-size: 22px; font-weight: 800; color: #8e4785; margin: 0; letter-spacing: -0.02em;">LAMDA</h1>
        `}
        <div style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
          Taller de Producción y Comercialización Mayorista
        </div>
        <div style="font-size: 9.5px; color: #475569; margin-top: 1px;">
          Av. 19 Nº 406 — La Plata • IVA Responsable Inscripto • CUIT: <strong>23-24892174-9</strong> • WhatsApp: <strong>(221) 6615746</strong>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="text-align: right;">
          <div style="font-size: 13px; font-weight: 800; color: #1e293b; letter-spacing: -0.01em;">
            ACTUALIZACIÓN DE PRECIOS
          </div>
          <div style="font-size: 10px; color: #475569; margin-top: 2px;">
            📅 Emisión: <strong>${fechaHoy}</strong>
          </div>
          <div style="font-size: 10px; color: #8e4785; font-weight: 700; margin-top: 2px;">
            Alias CBU: <span style="color: #1e293b; font-weight: 800;">LAMDA.SER.MARTIN</span>
          </div>
        </div>
        ${isotipoLamdaBase64 ? `
          <img src="${isotipoLamdaBase64}" alt="L" style="height: 40px; width: 40px; object-fit: contain;">
        ` : `
          <div style="width: 38px; height: 38px; border-radius: 8px; background: #faeefa; border: 1.5px solid #8e4785; color: #8e4785; font-size: 20px; font-weight: 800; display: flex; align-items: center; justify-content: center;">
            L
          </div>
        `}
      </div>
    </div>

    <!-- TARJETA DE DATOS DEL CLIENTE Y CONDICIONES COMERCIALES -->
    <div style="background: #fdfafc; border: 1px solid #e2e8f0; border-top: 3px solid #8e4785; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px;">
      <div style="display: grid; grid-template-columns: 2fr 1.2fr 1.5fr; gap: 12px; align-items: center;">
        <div>
          <div style="font-size: 9px; font-weight: 700; color: #8e4785; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1px;">
            Destinatario
          </div>
          <div style="font-size: 13.5px; font-weight: 800; color: #0f172a;">
            ${cliente.nombre || 'Cliente LAMDA'}
          </div>
          <div style="font-size: 10px; color: #475569; margin-top: 1px;">
            CUIT / DNI: <strong style="color: #1e293b;">${cliente.cuit || 'Consumidor Final'}</strong>
          </div>
        </div>

        <div>
          <div style="font-size: 9px; font-weight: 700; color: #8e4785; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1px;">
            Identificación Comercial
          </div>
          <div style="font-size: 11px; color: #1e293b; font-weight: 600;">
            Cuenta: <strong>#${cliente.legacy_id || cliente.id}</strong> ${cliente.codigo_bunker_cliente ? `<span style="color: #64748b; font-weight: 500;">(${cliente.codigo_bunker_cliente})</span>` : ''}
          </div>
          <div style="font-size: 10px; color: #64748b; margin-top: 1px;">
            WhatsApp: <strong>${cliente.telefono || 'Sin teléfono'}</strong>
          </div>
        </div>

        <div>
          <div style="font-size: 9px; font-weight: 700; color: #8e4785; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1px;">
            Condición Comercial
          </div>
          ${cfg.mostrar_nombre_lista ? `
            <div style="font-size: 11px; font-weight: 700; color: #8e4785;">
              ${cliente.lista_nombre || 'Lista Comercial Asignada'}
            </div>
          ` : ''}
          <div style="font-size: 11px; color: ${descHabitual > 0 ? '#15803d' : '#1e293b'}; font-weight: 700;">
            ${descHabitual > 0 ? `⭐ Bonificación habitual: ${descHabitual}% OFF` : 'Condición Mayorista Habitual'}
          </div>
          <div style="font-size: 9.5px; color: #64748b; margin-top: 1px;">
            Valores finales c/IVA y descuento incluidos
          </div>
        </div>
      </div>
    </div>

    <!-- NOTA BREVE DE REFERENCIA -->
    <div style="background: #f8fafc; border-left: 3px solid #8e4785; padding: 6px 10px; margin-bottom: 12px; font-size: 10.5px; color: #475569;">
      Valores finales expresados <strong>por kilogramo</strong> en las mismas condiciones comerciales de su cuenta (IVA y bonificación habitual incluidos)${cfg.mostrar_precio_anterior ? ', comparando el último precio abonado frente al valor actual vigente.' : '.'}
    </div>

    ${tablaOContenidoVacio}

    <!-- NOTA DE CIERRE Y FIRMA INSTITUCIONAL -->
    <div style="border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #64748b;">
      <div>
        Consultas y pedidos: WhatsApp <strong>(221) 6615746</strong> • Av. 19 Nº 406, La Plata
      </div>
      <div style="text-align: right; color: #8e4785; font-weight: 700;">
        LAMDA • Taller de Producción <span style="color: #94a3b8; font-weight: 400; font-family: Consolas, monospace; margin-left: 6px;">${folioRef}</span>
      </div>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Genera el Buffer binario del PDF oficial utilizando Puppeteer
 */
async function generarPDFInformePreciosBuffer(cliente_id, { dias = 90, configOverride = null } = {}) {
    if (!puppeteer) {
        throw new Error('El motor Puppeteer no está disponible en este servidor para generar el PDF.');
    }

    const html = await generarHTMLInformePreciosCliente({ cliente_id, dias, configOverride });
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
        try {
            await page.evaluateHandle('document.fonts.ready');
        } catch (fontErr) {
            // Continúa con fuentes del sistema si hay bloqueo de red externo
        }
        await page.emulateMediaType('print');

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '8mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });
        return pdfBuffer;
    } finally {
        await browser.close();
    }
}

/**
 * Obtiene los contactos de WhatsApp y Email de un cliente (combinando Búnker Clientes y Legacy Lomasoft)
 * para el modal de pre-envío omnicanal.
 */
async function obtenerContactosClienteOmnicanal(cliente_id) {
    const crypto = require('crypto');
    const db = getPool();
    await asegurarTablaConfigInforme(db);
    const catalog = await buildClientCatalog(db);

    const cId = String(cliente_id).trim();
    const infoCliente = catalog.resolveClient ? catalog.resolveClient(cId) : null;

    let bunkerId = infoCliente?.bunker_id || null;
    let legacyId = infoCliente?.legacy_id || (parseInt(cId, 10) || null);
    let codBunker = infoCliente?.codigo_bunker_cliente || null;
    let nombreCliente = infoCliente?.nombre_cliente || `Cliente #${cId}`;
    let cuit = infoCliente?.cuit || '';

    let whatsappBunker = '';
    let emailBunker = '';
    let canalPreferido = '';
    let celularLegacy = '';
    let telefonoLegacy = '';
    let emailLegacy = '';
    let localOnboardingCompletado = false;
    let tokenInvitacionVigente = null;
    let emailPortalRaw = '';
    let emailPortalNombreRaw = '';
    let emailPortalCargoRaw = '';

    // 1. Consultar bunker_clientes si existe o buscar por lomas_soft_id / cuit
    let resBunker = { rows: [] };
    const selectColsBunker = `
        id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id,
        whatsapp_facturas, email_facturas, email_portal, email_portal_nombre, email_portal_cargo,
        canal_envio_preferido, cuit_cuil,
        EXISTS (
            SELECT 1 FROM public.portal_invitaciones i
            WHERE i.cliente_id = bunker_clientes.codigo_bunker_cliente AND i.usado = true
        ) AS local_onboarding_completado,
        (
            SELECT token FROM public.portal_invitaciones i
            WHERE i.cliente_id = bunker_clientes.codigo_bunker_cliente
              AND i.usado = false
              AND i.expires_at > (NOW() + INTERVAL '12 hours')
            ORDER BY i.expires_at DESC
            LIMIT 1
        ) AS token_invitacion_vigente
    `;
    if (bunkerId) {
        resBunker = await db.query(`
            SELECT ${selectColsBunker}
            FROM public.bunker_clientes
            WHERE id = $1
            LIMIT 1
        `, [bunkerId]);
    } else if (legacyId) {
        resBunker = await db.query(`
            SELECT ${selectColsBunker}
            FROM public.bunker_clientes
            WHERE (CASE WHEN lomas_soft_id ~ '^\\d+$' THEN lomas_soft_id::integer ELSE NULL END) = $1
            LIMIT 1
        `, [parseInt(legacyId, 10)]);
    }

    if (resBunker.rows.length > 0) {
        const b = resBunker.rows[0];
        bunkerId = b.id;
        codBunker = b.codigo_bunker_cliente || codBunker;
        nombreCliente = b.razon_social || b.cliente_nombre || nombreCliente;
        cuit = b.cuit_cuil || cuit;
        whatsappBunker = b.whatsapp_facturas || '';
        emailBunker = b.email_facturas || '';
        canalPreferido = b.canal_envio_preferido || '';
        localOnboardingCompletado = b.local_onboarding_completado === true;
        tokenInvitacionVigente = b.token_invitacion_vigente || null;
        emailPortalRaw = b.email_portal || '';
        emailPortalNombreRaw = b.email_portal_nombre || '';
        emailPortalCargoRaw = b.email_portal_cargo || '';

        if ((!emailBunker || emailBunker.trim() === '[]') && b.email_portal && !String(b.email_portal).toLowerCase().trim().endsWith('@lamdaclientes.com')) {
            emailBunker = JSON.stringify([{
                email: b.email_portal.trim(),
                nombre: b.email_portal_nombre || nombreCliente,
                cargo: 'Portal B2B',
                default: true,
                default_presupuesto: true,
                default_informe_precios: true
            }]);
        }
    }

    // 1b. Verificar estado de Portal B2B (igual que Gestión Clientes Búnker) y preparar link / invitación
    const portalUrl = (process.env.B2B_PORTAL_URL || 'https://proud-darkness-ac3d.miserrano75.workers.dev').replace(/\/+$/, '');
    let plataformaB2bActiva = localOnboardingCompletado;
    let codigoActivacion = '';
    let linkInvitacion = '';

    const supaUrl = process.env.SUPABASE_B2B_URL;
    const supaKey = process.env.SUPABASE_B2B_SERVICE_KEY;

    if (codBunker) {
        // Consultar en Supabase si posee perfil activo en clientes_b2b_perfiles
        if (!plataformaB2bActiva && supaUrl && supaKey) {
            try {
                const respProf = await fetch(`${supaUrl}/rest/v1/clientes_b2b_perfiles?cliente_id=eq.${encodeURIComponent(codBunker)}&select=id,email&limit=1`, {
                    headers: {
                        'apikey': supaKey,
                        'Authorization': `Bearer ${supaKey}`
                    }
                });
                if (respProf.ok) {
                    const profRows = await respProf.json();
                    if (Array.isArray(profRows) && profRows.length > 0) {
                        plataformaB2bActiva = true;
                    }
                }
            } catch (eSupa) {
                console.warn('⚠️ [PRECIOS-B2B] Error verificando perfil en Supabase:', eSupa.message);
            }
        }

        // Asegurar token de invitación vigente (72hs) tanto en PostgreSQL local como en Supabase Cloud
        try {
            let token = tokenInvitacionVigente;
            const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
            if (!token) {
                token = crypto.randomBytes(32).toString('hex');
                await db.query(
                    `INSERT INTO public.portal_invitaciones (token, cliente_id, expires_at) VALUES ($1, $2, $3)`,
                    [token, codBunker, expiresAt]
                );
            }
            codigoActivacion = token.substring(0, 6);
            linkInvitacion = `${portalUrl}/?t=${codigoActivacion}#/onboarding?token=${token}`;

            if (supaUrl && supaKey) {
                const cleanPortalMail = (emailPortalRaw && !String(emailPortalRaw).toLowerCase().trim().endsWith('@lamdaclientes.com'))
                    ? String(emailPortalRaw).trim()
                    : '';
                await fetch(`${supaUrl}/rest/v1/clientes_b2b_invitaciones`, {
                    method: 'POST',
                    headers: {
                        'apikey': supaKey,
                        'Authorization': `Bearer ${supaKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates,return=minimal'
                    },
                    body: JSON.stringify({
                        token,
                        cliente_id: codBunker,
                        expires_at: expiresAt.toISOString(),
                        usado: false,
                        razon_social: nombreCliente,
                        email_portal: cleanPortalMail,
                        email_portal_nombre: emailPortalNombreRaw,
                        email_portal_cargo: emailPortalCargoRaw
                    })
                }).catch(() => {});
            }
        } catch (eInv) {
            console.warn('⚠️ [PRECIOS-B2B] Error preparando invitación B2B:', eInv.message);
        }
    }

    // 2. Consultar tabla legacy clientes para teléfonos/emails de respaldo
    if (legacyId) {
        const resLeg = await db.query(`
            SELECT celular, telefono, telefono_2, email
            FROM public.clientes
            WHERE cliente_id = $1
            LIMIT 1
        `, [parseInt(legacyId, 10)]);
        if (resLeg.rows.length > 0) {
            const l = resLeg.rows[0];
            celularLegacy = l.celular || '';
            telefonoLegacy = l.telefono || l.telefono_2 || '';
            emailLegacy = l.email || '';
        }
    }

    // 3. Consultar si hay contactos guardados en la tabla de configuración de informes (para clientes legacy sin fila en bunker_clientes)
    const keysToTry = [cId];
    if (legacyId) keysToTry.push(String(legacyId));
    if (bunkerId) keysToTry.push(`b_${bunkerId}`);
    const resCfg = await db.query(`
        SELECT config
        FROM public.bunker_config_informe_precios_cliente
        WHERE cliente_id = ANY($1)
        ORDER BY updated_at DESC
        LIMIT 1
    `, [keysToTry]);

    if (resCfg.rows.length > 0 && resCfg.rows[0].config) {
        const cj = resCfg.rows[0].config;
        if ((!whatsappBunker || whatsappBunker.trim() === '[]') && cj.whatsapp_facturas_override) {
            whatsappBunker = cj.whatsapp_facturas_override;
        }
        if ((!emailBunker || emailBunker.trim() === '[]') && cj.email_facturas_override) {
            emailBunker = cj.email_facturas_override;
        }
        if (!canalPreferido && cj.canal_envio_preferido_override) {
            canalPreferido = cj.canal_envio_preferido_override;
        }
    }

    return {
        cliente_id: legacyId || cId,
        bunker_cliente_id: bunkerId,
        codigo_bunker_cliente: codBunker,
        nombre_cliente: nombreCliente,
        cuit,
        whatsapp_bunker: whatsappBunker,
        email_bunker: emailBunker,
        celular: celularLegacy,
        telefono: telefonoLegacy,
        email: emailLegacy,
        canal_envio_preferido: canalPreferido,
        plataforma_b2b_activa: plataformaB2bActiva,
        portal_url: portalUrl,
        codigo_activacion: codigoActivacion,
        link_invitacion: linkInvitacion
    };
}

/**
 * Guarda los contactos predeterminados (WhatsApp y Email) de un cliente.
 * Actualiza directamente public.bunker_clientes (si el cliente existe en Búnker)
 * y respalda en bunker_config_informe_precios_cliente para soporte universal.
 */
async function guardarContactosClienteOmnicanal(cliente_id, { whatsapp_facturas, email_facturas, canal_envio_preferido } = {}) {
    const db = getPool();
    const info = await obtenerContactosClienteOmnicanal(cliente_id);

    let updatedBunker = false;
    if (info.bunker_cliente_id) {
        const fields = [];
        const values = [];
        let idx = 1;

        if (whatsapp_facturas !== undefined) {
            fields.push(`whatsapp_facturas = $${idx++}`);
            values.push(whatsapp_facturas);
        }
        if (email_facturas !== undefined) {
            fields.push(`email_facturas = $${idx++}`);
            values.push(email_facturas);
        }
        if (canal_envio_preferido !== undefined) {
            fields.push(`canal_envio_preferido = $${idx++}`);
            values.push(canal_envio_preferido);
        }

        if (fields.length > 0) {
            fields.push(`updated_at = NOW()`);
            values.push(parseInt(info.bunker_cliente_id, 10));
            await db.query(
                `UPDATE public.bunker_clientes SET ${fields.join(', ')} WHERE id = $${idx}`,
                values
            );
            updatedBunker = true;
        }
    }

    // Respaldar también en bunker_config_informe_precios_cliente para que persista aunque sea solo cliente Legacy
    await asegurarTablaConfigInforme(db);
    const currentCfg = await obtenerConfigInformeCliente(cliente_id);
    const mergedJson = {
        ...currentCfg,
        ...(whatsapp_facturas !== undefined ? { whatsapp_facturas_override: whatsapp_facturas } : {}),
        ...(email_facturas !== undefined ? { email_facturas_override: email_facturas } : {}),
        ...(canal_envio_preferido !== undefined ? { canal_envio_preferido_override: canal_envio_preferido } : {})
    };

    const key = String(info.cliente_id || cliente_id).trim();
    await db.query(`
        INSERT INTO public.bunker_config_informe_precios_cliente (cliente_id, config, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (cliente_id) DO UPDATE SET
            config = bunker_config_informe_precios_cliente.config || EXCLUDED.config,
            updated_at = NOW()
    `, [key, JSON.stringify(mergedJson)]);

    return {
        success: true,
        bunker_cliente_id: info.bunker_cliente_id,
        updated_bunker: updatedBunker
    };
}

/**
 * Genera el PDF oficial de actualización de precios para el cliente y lo despacha
 * por WhatsApp (puerto 3004) y/o Correo Electrónico (puerto 3004), marcando los artículos como NOTIFICADO.
 */
async function enviarInformePreciosOmnicanal(cliente_id, {
    dias = 90,
    configOverride = null,
    destinatariosWp = '',
    destinatariosEmail = '',
    mensajeTexto = '',
    marcarNotificado = true
} = {}) {
    const wpStr = Array.isArray(destinatariosWp) ? destinatariosWp.join(', ') : String(destinatariosWp || '').trim();
    const emailStr = Array.isArray(destinatariosEmail) ? destinatariosEmail.join(', ') : String(destinatariosEmail || '').trim();

    if (!wpStr && !emailStr) {
        throw new Error('Debe especificar al menos un destinatario de WhatsApp o Correo Electrónico.');
    }

    // 1. Obtener datos del cliente y sus artículos afectados + generar PDF Buffer
    const [datosInforme, pdfBuffer] = await Promise.all([
        obtenerArticulosAfectadosPorCliente({ cliente_id, dias }),
        generarPDFInformePreciosBuffer(cliente_id, { dias, configOverride })
    ]);

    const cliente = datosInforme.cliente || {};
    const articulos = datosInforme.articulos || [];
    const nombreCliente = cliente.nombre || `Cliente_${cliente_id}`;
    const cleanName = nombreCliente.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
    const filename = `Actualizacion_Precios_LAMDA_${cleanName}.pdf`;
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    const msgFinal = (mensajeTexto && mensajeTexto.trim())
        ? mensajeTexto.trim()
        : `Hola *${nombreCliente}*, te enviamos adjunto el informe actualizado de precios de *LAMDA* correspondiente a tus artículos habituales.\n\nQuedamos a tu entera disposición por cualquier consulta o pedido. ¡Saludos!`;

    let wpOk = false;
    let emailOk = false;
    const wpAttempted = wpStr.length > 0;
    const emailAttempted = emailStr.length > 0;
    const errors = [];
    let wpDetails = null;
    let emailDetails = null;

    // 2. Despachar por WhatsApp (servicio puerto 3004)
    if (wpAttempted) {
        try {
            const respWp = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: wpStr,
                    pdfBase64,
                    filename,
                    mensajeTexto: msgFinal
                })
            });
            const dataWp = await respWp.json().catch(() => ({}));
            if (respWp.ok && dataWp.success) {
                wpOk = true;
                wpDetails = dataWp.data || dataWp;
            } else {
                errors.push(`WhatsApp: ${dataWp.message || dataWp.error || 'No se pudo enviar por WhatsApp'}`);
            }
        } catch (errWp) {
            errors.push(`WhatsApp: ${errWp.message}`);
        }
    }

    // 3. Despachar por Correo Electrónico (servicio puerto 3004)
    if (emailAttempted) {
        try {
            const respEmail = await fetch('http://localhost:3004/facturacion/email/cotizaciones/enviar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clienteNombre: nombreCliente,
                    destinatarios: emailStr,
                    pdfBase64,
                    tituloInforme: 'Actualización de Precios',
                    mensajeTexto: msgFinal.replace(/\*/g, '')
                })
            });
            const dataEmail = await respEmail.json().catch(() => ({}));
            if (respEmail.ok && dataEmail.success) {
                emailOk = true;
                emailDetails = dataEmail.data || dataEmail;
            } else {
                errors.push(`Correo: ${dataEmail.message || dataEmail.error || 'No se pudo enviar por Correo'}`);
            }
        } catch (errEmail) {
            errors.push(`Correo: ${errEmail.message}`);
        }
    }

    // 4. Si al menos un canal tuvo éxito, marcar artículos del cliente como NOTIFICADO
    let articulosNotificadosCount = 0;
    if ((wpOk || emailOk) && marcarNotificado && articulos.length > 0) {
        const canalStr = (wpOk && emailOk) ? 'WHATSAPP, EMAIL' : (wpOk ? 'WHATSAPP' : 'EMAIL');
        const cIdTarget = cliente.legacy_id || cliente.id || cliente_id;
        for (const art of articulos) {
            try {
                await actualizarEstadoNotificacion({
                    historial_cambio_id: art.cambio_precio_id || null,
                    articulo_numero: art.articulo_numero,
                    cliente_id: cIdTarget,
                    codigo_bunker_cliente: cliente.codigo_bunker_cliente || null,
                    cliente_nombre: nombreCliente,
                    estado: 'NOTIFICADO',
                    canal: canalStr,
                    notas: `Informe PDF enviado (${canalStr})`
                });
                articulosNotificadosCount++;
            } catch (eNotif) {
                console.warn('⚠️ Error al marcar artículo notificado:', eNotif.message);
            }
        }
    }

    return {
        success: wpOk || emailOk,
        wpOk,
        emailOk,
        wpAttempted,
        emailAttempted,
        destinatariosWp: wpStr,
        destinatariosEmail: emailStr,
        articulosNotificadosCount,
        errors,
        wpDetails,
        emailDetails
    };
}

module.exports = {
    registrarCambiosLote,
    obtenerHistorial,
    obtenerClientesAfectadosPorArticulo,
    obtenerArticulosAfectadosPorCliente,
    obtenerListadoClientesAfectados,
    actualizarEstadoNotificacion,
    buscarClientes,
    limpiarTelefono,
    buildClientCatalog,
    obtenerConfigInformeCliente,
    guardarConfigInformeCliente,
    generarHTMLInformePreciosCliente,
    generarPDFInformePreciosBuffer,
    obtenerContactosClienteOmnicanal,
    guardarContactosClienteOmnicanal,
    enviarInformePreciosOmnicanal
};
