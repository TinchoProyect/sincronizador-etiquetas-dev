/**
 * ============================================================================
 * SERVICIO: PLANIFICACIÓN Y DIAGNÓSTICO DETERMINISTA DE PRODUCCIÓN ("INFORME DEL LUNES")
 * ============================================================================
 * 
 * Módulo de inteligencia operacional que cruza en tiempo real:
 * 1. Ventas recientes (demanda diaria promedio por SKU)
 * 2. Stock consolidado disponible (bultos y fracciones)
 * 3. Producibilidad y stock físico de materias primas (fábrica y bultos)
 * 4. Clasificación estricta en las 6 Líneas de Negocio (LDN 1 a 6)
 * 5. Trazabilidad y cadencia histórica de carros (internos y externos)
 * 
 * Genera el reporte determinista para la toma de decisiones del lunes por la mañana.
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

const pool = require('../config/database');

// Mapeo determinista de tostados / UP a su materia prima cruda comprada a proveedor (con merma de tostado)
const TOSTADOS_A_MATERIA_PRIMA_CRUDA = new Map([
    [18, { crudo_sku: 'EMB-MN4UM1', crudo_skus_alt: ['CCW4X22,68'], merma: 1.05, merma_pct: 5.0, bulto_kg: 22.68, nombre_crudo: 'Castañas de Caju W4/W5 x 22.68kg', up_sku: 'CCTGXKUP' }],
    [41, { crudo_sku: 'EMB-MN4UM1', crudo_skus_alt: ['CCW4X22,68'], merma: 1.05, merma_pct: 5.0, bulto_kg: 22.68, nombre_crudo: 'Castañas de Caju W4/W5 x 22.68kg', up_sku: 'CCTSGXKUP' }],
    [166, { crudo_sku: 'CCP3X22.68', crudo_skus_alt: [], merma: 1.05, merma_pct: 5.0, bulto_kg: 22.68, nombre_crudo: 'Castañas de Caju P3 x 22.68kg', up_sku: 'EMB-3RMHD2' }],
    [57, { crudo_sku: 'APN27/30X22,68', crudo_skus_alt: ['EMB-7RVGWW', 'APN25/27X10', 'AGRX10Q', 'EMB-KVAHDE'], merma: 1.07, merma_pct: 7.0, bulto_kg: 10.0, nombre_crudo: 'Almendra Pelada NP / Guara x 10kg', up_sku: 'APTPGUP' }],
    [123, { crudo_sku: 'APN27/30X22,68', crudo_skus_alt: ['EMB-XBN4S5', 'EMB-7RVGWW', 'APN25/27X10', 'AGRX10Q', 'EMB-KVAHDE'], merma: 1.07, merma_pct: 7.0, bulto_kg: 10.0, nombre_crudo: 'Almendra Pelada NP / Guara x 10kg', up_sku: 'APTSPGUP' }],
    [38, { crudo_sku: 'AGRX10Q', crudo_skus_alt: ['EMB-7RVGWW', 'EMB-KVAHDE', 'APN25/27X10'], merma: 1.07, merma_pct: 7.0, bulto_kg: 10.0, nombre_crudo: 'Almendra Guara Ramillada x 10kg', up_sku: 'APTSPGUPPM' }]
]);

// Mapeo inverso de códigos UP a ingredientes intermedios tostados
const UP_A_INGREDIENTE_TOSTADO = new Map([
    ['APTPGUP', 57],
    ['APTPGXK', 57],
    ['APTSPGUP', 123],
    ['APTSPGXK', 123],
    ['APTSPGUPPM', 38],
    ['APTSPGXKPM', 38],
    ['CCTGXKUP', 18],
    ['CCTGXK', 18],
    ['CCTSGXKUP', 41],
    ['CCTSGXK', 41],
    ['EMB-3RMHD2', 166],
    ['EMB-GZ6U9K', 166]
]);

// Diccionario maestro de vinculación para ingredientes sin SKU asignado en tabla maestra
const INGREDIENTES_SIN_VINCULO_MAP = new Map([
    [128, 'SBX25'],       // Sesamo Blanco -> SEM Sesamo Blanco x 25kg
    [20, 'SNIX25'],       // Sesamo Integral -> SEM Sesamo Integral x 25kg
    [156, 'HMAX5'],       // Harina de Maiz -> Harina de Maiz Paraguaya x 5kg
    [186, 'LNX5'],        // Lenteja Nacional -> Lenteja Nacional x 5kg
    [187, 'HIOX5'],       // Harina de Trigo Integral -> HIOX5
    [165, 'PKX2'],        // Panko -> Panko x 2kg
    [104, 'PPX25'],       // Poroto Pallares -> Porotos Pallares Peru x 25kg
    [90, 'PALUX5'],       // Poroto Alubia -> Porotos Alubia x 5kg
    [188, 'HTLN4X5'],     // Higo Turco -> Higo LDA Turco N4 x 5kg
    [121, 'ABX10'],       // Arroz Basmati -> Arroz Basmati x 10kg
    [88, 'GLX25'],        // Garbanzo -> Garbanzo Lechoso x 25kg
    [86, 'ACX25'],        // Arroz Carnaroli -> Arroz Carnaroli x 25kg
    [95, 'AYX25'],        // Arroz Yamani -> Arroz IGRAL Yamani x 25kg
    [136, 'M6X1'],        // Miel -> Miel Pura 6 x 1kg
    [56, 'PTSX10'],       // Pistacho con Cascara -> PTSx10
    [50, 'PPCXK'],        // Pistacho Pelado -> PPCXK
    [93, 'PAX5'],         // Poroto Aduki -> PAx5
    [80, 'HAX5'],         // Harina de Arroz -> HAx5
    [164, 'ADAX5'],       // Salvado de Avena -> ADAX5
    [81, 'SLX5'],         // Semilla de Lino -> SLX5
    [82, 'HASPX1'],       // Harina de Almendra sp -> HASPx1
    [91, 'HSX1'],         // Hongo Seco -> HSX1
    [78, 'HDAX5'],        // Harina de Avena -> HDAX5
    [97, 'SQRX25'],       // Semilla de Quinoa -> SQRx25
    [46, 'CHB10X1'],      // Chip Banana -> CHB10x1
    [51, 'CCP3X22.68'],   // Castaña de Caju Partida -> Castañas de Caju P3 x 22.68kg
    [45, 'MRSSCJX25'],    // Mani Repelado s/sal Grande -> Mani REP s/sal Grande x 25kg
    [98, 'MCR50/60X5'],   // Maiz Pisingallo -> Maiz Pisingallo Butterfly x 5kg
    [184, 'SGPX25']       // Semilla de Girasol Pelado -> SEM Girasol Pelado x 25kg
]);

// Bultos alternativos equivalentes en depósito cuando el SKU primario no tiene stock
const INGREDIENTES_BULTO_ALTERNATIVO_MAP = new Map([
    [16, ['CCW4X22,68']]  // Castaña de Caju Entera: contempla tanto W5 (EMB-MN4UM1) como W4 (CCW4X22,68)
]);

// IDs de ingredientes que representan Mixes a granel (compuestos o simples puente)
const IDS_INGREDIENTES_MIX = new Set([30, 31, 40, 77, 92, 107, 118, 124, 125, 148, 149, 150, 151, 154, 155, 158, 159]);

/**
 * Obtiene el diagnóstico y plan de acción semanal determinista
 * 
 * @param {Object} params
 * @param {number} params.ventanaDias - Ventana de análisis de ventas (7, 14, 30 días, default 14)
 * @param {number} params.diasObjetivo - Días objetivo de cobertura de stock (default 21)
 * @param {Object} [dbPool] - Conexión de pool opcional
 * @returns {Promise<Object>} Plan consolidado, KPIs y desglose por LDN
 */
async function obtenerAnalisisPlanificacionLunes(params = {}, dbPool = null) {
    let ventanaDias = 14;
    let diasObjetivo = 21;
    let tandaMixKg = 10;
    let poolConexion = null;

    if (typeof params === 'number') {
        ventanaDias = params;
        if (typeof dbPool === 'number') diasObjetivo = dbPool;
        poolConexion = pool;
    } else if (params && typeof params === 'object') {
        ventanaDias = params.ventanaDias || 14;
        diasObjetivo = params.diasObjetivo || 21;
        tandaMixKg = params.tandaMixKg || 10;
        poolConexion = dbPool;
    }
    const db = poolConexion || pool;
    const dias = Math.max(1, parseInt(ventanaDias) || 14);
    const objetivo = Math.max(1, parseInt(diasObjetivo) || 21);
    const tandaKg = Math.max(1, parseInt(tandaMixKg) || 10);

    console.log(`\n🧠 [PLANIFICACIÓN-LUNES] Generando diagnóstico determinista (Ventana: ${dias}d, Objetivo: ${objetivo}d, Tanda Mix: ${tandaKg}kg)...`);

    try {
        // Ejecución concurrente de todas las fuentes maestras en PostgreSQL
        const [
            articulosRes,
            ventasRes,
            produccionCarrosRes,
            recetasRes,
            recetaIngredientesRes,
            composicionMixRes,
            ingredientesRes,
            potencialIngredientesRes,
            producibilidadMixRes,
            mermasHistorialRes,
            relacionesUpRes,
            presupuestosRes,
            diasHistoriaRes
        ] = await Promise.all([
            // 1. Catálogo Búnker + Stock Consolidado
            db.query(`
                SELECT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    ba.costo_base,
                    COALESCE(ba.kilos_unidad, src.kilos_unidad, 1.0) AS kilos_unidad,
                    ba.pack_hijo_codigo,
                    ba.pack_unidades,
                    ba.es_pack,
                    ba.familia_id,
                    ba.rubro,
                    ba.sub_rubro,
                    f.nombre AS familia_nombre,
                    COALESCE(src.stock_consolidado, 0) AS stock_consolidado,
                    COALESCE(src.stock_lomasoft, 0) AS stock_lomasoft,
                    COALESCE(src.stock_movimientos, 0) AS stock_movimientos,
                    EXISTS (SELECT 1 FROM public.recetas r WHERE UPPER(TRIM(r.articulo_numero)) = UPPER(TRIM(ba.articulo_id))) AS tiene_receta
                FROM public.bunker_articulos ba
                LEFT JOIN public.bunker_familias f ON ba.familia_id = f.id
                LEFT JOIN public.stock_real_consolidado src ON UPPER(TRIM(src.articulo_numero)) = UPPER(TRIM(ba.articulo_id))
                WHERE COALESCE(ba.familia_id, 0) != 46
                ORDER BY ba.articulo_id ASC
            `),

            // 2. Ventas reales de facturación en diferentes horizontes (neteadas de devoluciones/NC)
            db.query(`
                SELECT 
                    articulo_numero,
                    COUNT(id) AS total_operaciones,
                    GREATEST(0, SUM(CASE WHEN fecha >= NOW() - INTERVAL '7 days' THEN (CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END) ELSE 0 END)) AS ventas_7d,
                    GREATEST(0, SUM(CASE WHEN ($1 >= 999 OR fecha >= NOW() - ($1 || ' days')::interval) THEN (CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END) ELSE 0 END)) AS ventas_ventana,
                    GREATEST(0, SUM(CASE WHEN fecha >= NOW() - INTERVAL '30 days' THEN (CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END) ELSE 0 END)) AS ventas_30d,
                    GREATEST(0, SUM(CASE WHEN fecha >= NOW() - INTERVAL '60 days' THEN (CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END) ELSE 0 END)) AS ventas_60d,
                    GREATEST(0, SUM(CASE WHEN fecha >= NOW() - INTERVAL '90 days' THEN (CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END) ELSE 0 END)) AS ventas_90d,
                    COUNT(DISTINCT CASE WHEN fecha >= NOW() - INTERVAL '90 days' THEN DATE_TRUNC('week', fecha) END) AS semanas_activas_90d,
                    MAX(fecha) AS ultima_venta_fecha
                FROM public.stock_ventas_movimientos
                WHERE (
                    origen_ingreso ILIKE '%factura%'
                    OR (tipo ILIKE '%egreso%' 
                        AND origen_ingreso NOT IN ('abastecimiento_domicilio', 'mantenimiento') 
                        AND tipo NOT LIKE '%receta%')
                )
                GROUP BY articulo_numero
            `, [dias]),

            // 3. Producción real de carros (últimos 90 días)
            db.query(`
                SELECT 
                    ca.articulo_numero,
                    MAX(cp.fecha_confirmacion) AS ultima_produccion_fecha,
                    COUNT(DISTINCT cp.id) AS carros_realizados_90d,
                    ROUND(AVG(ca.cantidad), 2) AS lote_promedio_historico,
                    SUM(ca.cantidad) AS unidades_producidas_90d
                FROM public.carros_articulos ca
                JOIN public.carros_produccion cp ON cp.id = ca.carro_id
                WHERE cp.fecha_confirmacion >= NOW() - INTERVAL '90 days'
                GROUP BY ca.articulo_numero
            `),

            // 4. Recetas de artículos
            db.query(`SELECT id, articulo_numero, descripcion, enlazado_externo FROM public.recetas`),

            // 5. Ingredientes asignados por receta
            db.query(`
                SELECT ri.receta_id, ri.ingrediente_id, ri.cantidad, ri.unidad_medida, ri.fase_produccion,
                       i.nombre AS ingrediente_nombre, i.es_insumo, i.costo_patron
                FROM public.receta_ingredientes ri
                JOIN public.ingredientes i ON i.id = ri.ingrediente_id
            `),

            // 6. Composición de Mixes (ingredientes que forman un mix)
            db.query(`SELECT mix_id, ingrediente_id, cantidad FROM public.ingrediente_composicion`),

            // 7. Catálogo de Ingredientes y stocks con TRIPLE CAPA (Taller Abierto + Cajas Cerradas en Taller + Depósito)
            db.query(`
                SELECT 
                    i.id, 
                    i.nombre, 
                    i.stock_actual, 
                    COALESCE(i.stock_bultos, 0) AS stock_bultos_col, 
                    COALESCE(dest.cajas_disponibles, COALESCE(i.stock_bultos, 0)) AS bultos_taller,
                    COALESCE(dest.kilos_en_cajas, COALESCE(i.stock_bultos, 0) * CASE WHEN COALESCE(ba.kilos_unidad, 0) > 0 THEN ba.kilos_unidad ELSE 1.0 END) AS kg_bultos_taller,
                    COALESCE(src.stock_consolidado, 0) AS bultos_deposito,
                    COALESCE(src.stock_consolidado, 0) * CASE WHEN COALESCE(ba.kilos_unidad, 0) > 0 THEN ba.kilos_unidad ELSE 1.0 END AS kg_bultos_deposito,
                    CASE WHEN COALESCE(ba.kilos_unidad, 0) > 0 THEN ba.kilos_unidad ELSE 1.0 END AS kilos_por_bulto,
                    ba.descripcion_generada AS bulto_desc,
                    i.unidad_medida, 
                    i.costo_patron, 
                    i.es_insumo, 
                    sku_resuelto.sku AS articulo_vinculado_numero
                FROM public.ingredientes i
                LEFT JOIN LATERAL (
                    SELECT COALESCE(
                        i.articulo_vinculado_numero,
                        (
                            SELECT svm.articulo_numero
                            FROM public.stock_ventas_movimientos svm
                            JOIN public.ingredientes_movimientos im 
                              ON substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') = substring(im.observaciones from 'UUID: ([a-f0-9\\-]+)')
                             AND substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') IS NOT NULL
                            WHERE im.ingrediente_id = i.id
                              AND svm.articulo_numero IS NOT NULL
                              AND EXISTS (SELECT 1 FROM public.bunker_articulos ba2 WHERE UPPER(TRIM(ba2.articulo_id)) = UPPER(TRIM(svm.articulo_numero)))
                            ORDER BY svm.fecha DESC
                            LIMIT 1
                        )
                    ) AS sku
                ) sku_resuelto ON TRUE
                LEFT JOIN (
                    SELECT d.destino_id, 
                           SUM(d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) AS cajas_disponibles,
                           SUM((d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) * (COALESCE(d.kilos_asignados, 0) / NULLIF(d.cantidad_asignada, 0))) AS kilos_en_cajas
                    FROM public.bunker_lotes_destinos d
                    WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' 
                      AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                    GROUP BY d.destino_id
                ) dest ON dest.destino_id = i.id::text
                LEFT JOIN public.bunker_articulos ba ON UPPER(TRIM(ba.articulo_id)) = UPPER(TRIM(sku_resuelto.sku))
                LEFT JOIN public.stock_real_consolidado src ON UPPER(TRIM(src.articulo_numero)) = UPPER(TRIM(sku_resuelto.sku))
                ORDER BY i.id ASC
            `),

            // 8. Potencial total de ingredientes (stock en fábrica + stock en bultos cerrados de depósito)
            db.query(`
                SELECT ingrediente_id, nombre, stock_fisico, stock_en_bultos, potencial_total
                FROM public.v_potencial_ingredientes_simples
            `),

            // 9. Capacidad de mezcla de mixes y cuello de botella
            db.query(`
                SELECT mix_id, componente_id, componente_nombre, cantidad_requerida,
                       peso_total_receta, disponible_componente, kilos_mix_posibles
                FROM public.v_producibilidad_componentes_mix
            `),

            // 10. Mermas históricas de producción externa (UPs)
            db.query(`
                SELECT articulo_fraccionado_id, 
                       ROUND(AVG(porcentaje_merma), 2) AS merma_promedio,
                       COUNT(id) AS total_lotes_externos,
                       MAX(fecha_registro) AS ultima_recepcion_externa
                FROM public.produccion_externa_historial
                GROUP BY articulo_fraccionado_id
            `),

            // 11. Artículos Producción Externa Relación (Pareo UP <-> Kilo comercial)
            db.query(`
                SELECT articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes
                FROM public.articulos_produccion_externa_relacion
            `),

            // 12. Presupuestos Activos (Demanda Comprometida / Backlog real pendiente de armado)
            db.query(`
                SELECT 
                    COALESCE(ba.articulo_id, a.numero, pd.articulo) AS articulo_numero,
                    SUM(pd.cantidad) AS cantidad_comprometida,
                    COUNT(DISTINCT p.id) AS presupuestos_cant
                FROM public.presupuestos p
                JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
                LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero OR ba.articulo_id = pd.articulo
                WHERE p.activo = true
                  AND COALESCE(p.archivado, false) = false
                  AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
                  AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
                  AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
                  AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
                  AND p.factura_id IS NULL
                  AND p.id_factura_lomasoft IS NULL
                  AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
                  AND COALESCE(pd.es_saldo_ingrediente, false) = false
                GROUP BY COALESCE(ba.articulo_id, a.numero, pd.articulo)
            `),

            // 13. Días de historia real en BD (para ventana de "Todas las facturas")
            db.query(`
                SELECT GREATEST(30, ROUND(EXTRACT(DAY FROM NOW() - MIN(fecha)))) AS dias_historia_bd
                FROM public.stock_ventas_movimientos
                WHERE fecha IS NOT NULL
            `)
        ]);

        const diasHistoriaBd = (diasHistoriaRes && diasHistoriaRes.rows && diasHistoriaRes.rows[0]) ? (parseInt(diasHistoriaRes.rows[0].dias_historia_bd) || 365) : 365;
        const diasEfectivos = dias >= 999 ? diasHistoriaBd : dias;

        // Mapear estructuras auxiliares para búsqueda ultrarrápida O(1)
        const ventasMap = new Map();
        ventasRes.rows.forEach(r => ventasMap.set((r.articulo_numero || '').trim().toUpperCase(), r));

        const produccionMap = new Map();
        produccionCarrosRes.rows.forEach(r => produccionMap.set((r.articulo_numero || '').trim().toUpperCase(), r));

        const mermasMap = new Map();
        mermasHistorialRes.rows.forEach(r => mermasMap.set((r.articulo_fraccionado_id || '').trim().toUpperCase(), r));

        const presupuestosMap = new Map();
        presupuestosRes.rows.forEach(r => {
            const key = (r.articulo_numero || '').trim().toUpperCase();
            presupuestosMap.set(key, {
                cantidad_comprometida: parseFloat(r.cantidad_comprometida || 0),
                presupuestos_cant: parseInt(r.presupuestos_cant || 0)
            });
        });

        const articulosMap = new Map();
        articulosRes.rows.forEach(art => {
            articulosMap.set((art.articulo_id || '').trim().toUpperCase(), art);
        });

        // Mapeo bidireccional Padre-Hijo (Packs vs Fracciones Sueltas)
        const padrePorHijoMap = new Map(); // hijo_sku -> [{ padre_sku, pack_unidades, descripcion }]
        const hijoPorPadreMap = new Map(); // padre_sku -> { hijo_sku, pack_unidades, descripcion }

        articulosRes.rows.forEach(art => {
            const sku = (art.articulo_id || '').trim().toUpperCase();
            if (art.pack_hijo_codigo && parseInt(art.pack_unidades) > 1) {
                const hijoSku = art.pack_hijo_codigo.trim().toUpperCase();
                const unidades = parseInt(art.pack_unidades);
                hijoPorPadreMap.set(sku, { hijo_sku: hijoSku, pack_unidades: unidades, descripcion: art.descripcion_generada || art.descripcion });
                if (!padrePorHijoMap.has(hijoSku)) padrePorHijoMap.set(hijoSku, []);
                padrePorHijoMap.get(hijoSku).push({ padre_sku: sku, pack_unidades: unidades, descripcion: art.descripcion_generada || art.descripcion });
            }
        });

        const ingredientesMap = new Map();
        ingredientesRes.rows.forEach(r => {
            // 1. Vincular SKU de bulto maestro si no estaba enlazado en BD
            if (!r.articulo_vinculado_numero && INGREDIENTES_SIN_VINCULO_MAP.has(r.id)) {
                const fallbackSku = INGREDIENTES_SIN_VINCULO_MAP.get(r.id);
                const bultoArt = articulosMap.get(fallbackSku.toUpperCase());
                if (bultoArt) {
                    const kgBulto = parseFloat(bultoArt.kilos_unidad || 1.0) > 0 ? parseFloat(bultoArt.kilos_unidad) : 1.0;
                    const stockDepo = Math.max(0, parseFloat(bultoArt.stock_consolidado || 0));
                    r.articulo_vinculado_numero = bultoArt.articulo_id;
                    r.bulto_desc = bultoArt.descripcion_generada || bultoArt.descripcion;
                    r.kilos_por_bulto = kgBulto;
                    r.bultos_deposito = stockDepo;
                    r.kg_bultos_deposito = stockDepo * kgBulto;
                    r.kg_bultos_taller = parseFloat(r.bultos_taller || 0) * kgBulto;
                }
            }

            // 2. Sumar bultos equivalentes alternativos en depósito (ej: Castaña W4 cuando W5 está en 0)
            if (INGREDIENTES_BULTO_ALTERNATIVO_MAP.has(r.id)) {
                const altSkus = INGREDIENTES_BULTO_ALTERNATIVO_MAP.get(r.id) || [];
                altSkus.forEach(altSku => {
                    if ((r.articulo_vinculado_numero || '').toUpperCase() === altSku.toUpperCase()) return;
                    const altArt = articulosMap.get(altSku.toUpperCase());
                    if (altArt) {
                        const altDepo = Math.max(0, parseFloat(altArt.stock_consolidado || 0));
                        const altKgBulto = parseFloat(altArt.kilos_unidad || 1.0) > 0 ? parseFloat(altArt.kilos_unidad) : 1.0;
                        if (altDepo > 0) {
                            if (parseFloat(r.bultos_deposito || 0) <= 0) {
                                r.articulo_vinculado_numero = altArt.articulo_id;
                                r.bulto_desc = altArt.descripcion_generada || altArt.descripcion;
                                r.kilos_por_bulto = altKgBulto;
                            }
                            r.bultos_deposito = parseFloat(r.bultos_deposito || 0) + altDepo;
                            r.kg_bultos_deposito = parseFloat(r.kg_bultos_deposito || 0) + (altDepo * altKgBulto);
                        }
                    }
                });
            }

            const rawStockActual = Math.max(0, parseFloat(r.stock_actual || 0));
            const stockActualKg = rawStockActual < 0.005 ? 0 : parseFloat(rawStockActual.toFixed(2));
            r.stock_actual = stockActualKg;
            const kgBultosTaller = Math.max(0, parseFloat(r.kg_bultos_taller || 0));
            const kgBultosDepo = Math.max(0, parseFloat(r.kg_bultos_deposito || 0));
            r.stock_total_materia_prima_kg = parseFloat((stockActualKg + kgBultosTaller + kgBultosDepo).toFixed(2));
            r.bultos_taller_cant = Math.max(0, parseFloat(r.bultos_taller || 0));
            r.bultos_deposito_cant = Math.max(0, parseFloat(r.bultos_deposito || 0));
            r.total_bultos_cerrados = r.bultos_taller_cant + r.bultos_deposito_cant;
            ingredientesMap.set(r.id, r);
        });

        const potencialIngMap = new Map();
        potencialIngredientesRes.rows.forEach(r => potencialIngMap.set(r.ingrediente_id, r));

        // Cuellos de botella por Mix ID (calculados sobre el stock multicapa enriquecido)
        const cuelloBotellaPorMix = new Map();
        const compPorMixMap = new Map();
        composicionMixRes.rows.forEach(cm => {
            if (!compPorMixMap.has(cm.mix_id)) compPorMixMap.set(cm.mix_id, []);
            compPorMixMap.get(cm.mix_id).push(cm);
        });
        for (const [mixId, comps] of compPorMixMap.entries()) {
            const pesoTotalReceta = comps.reduce((s, c) => s + parseFloat(c.cantidad || 0), 0);
            if (pesoTotalReceta <= 0) continue;
            comps.forEach(c => {
                const cantReq = parseFloat(c.cantidad || 0);
                if (cantReq <= 0) return;
                const ingObj = ingredientesMap.get(c.ingrediente_id);
                const potObj = potencialIngMap.get(c.ingrediente_id);
                const dispComp = ingObj && ingObj.stock_total_materia_prima_kg !== undefined
                    ? parseFloat(ingObj.stock_total_materia_prima_kg)
                    : (potObj ? parseFloat(potObj.potencial_total || 0) : 0);
                const pos = (dispComp / cantReq) * pesoTotalReceta;
                if (!cuelloBotellaPorMix.has(mixId) || pos < cuelloBotellaPorMix.get(mixId).kilos_mix_posibles) {
                    cuelloBotellaPorMix.set(mixId, {
                        componente_id: c.ingrediente_id,
                        componente_nombre: ingObj ? ingObj.nombre : (potObj ? potObj.nombre : `Insumo #${c.ingrediente_id}`),
                        disponible_componente: dispComp,
                        cantidad_requerida: cantReq,
                        kilos_mix_posibles: parseFloat(pos.toFixed(2))
                    });
                }
            });
        }

        // Agrupar recetas e ingredientes por articulo_numero
        const recetasPorArticulo = new Map();
        const recetaIngredientesPorRecetaId = new Map();
        recetaIngredientesRes.rows.forEach(ri => {
            if (!recetaIngredientesPorRecetaId.has(ri.receta_id)) {
                recetaIngredientesPorRecetaId.set(ri.receta_id, []);
            }
            recetaIngredientesPorRecetaId.get(ri.receta_id).push(ri);
        });

        recetasRes.rows.forEach(rec => {
            if (rec.articulo_numero) {
                const sku = rec.articulo_numero.trim().toUpperCase();
                recetasPorArticulo.set(sku, {
                    ...rec,
                    ingredientes: recetaIngredientesPorRecetaId.get(rec.id) || []
                });
            }
        });

        const mixesIds = new Set(composicionMixRes.rows.map(cm => cm.mix_id));

        // Relaciones UP
        const upRelaciones = relacionesUpRes.rows;

        // Arrays de resultados clasificados
        const todosArticulosEvaluados = [];
        const ldn1_directos = [];
        const ldn2_fraccionados = [];
        const ldn3_mixes = [];
        const ldn4_tostaderos = [];
        const ldn5_barritas = [];
        const ldn6_granolas = [];

        // Insumos críticos bloqueantes
        const insumosBloqueantesMap = new Map();

        // Helper para eliminar residuos de coma flotante de IEEE 754 (ej: 0.9999999999974 -> 1)
        const redondearEnteroOFlotanteLimpio = (val, decimalesMax = 2) => {
            if (val === null || val === undefined || isNaN(val)) return 0;
            const num = Number(val);
            if (Math.abs(num - Math.round(num)) < 0.005) {
                return Math.round(num);
            }
            return parseFloat(num.toFixed(decimalesMax));
        };

        // ---------------------------------------------------------------------
        // EVALUACIÓN DETERMINISTA DE CADA ARTÍCULO
        // ---------------------------------------------------------------------
        articulosRes.rows.forEach(art => {
            const sku = (art.articulo_id || '').trim();
            const skuUpper = sku.toUpperCase();
            const stockActual = redondearEnteroOFlotanteLimpio(parseFloat(art.stock_consolidado || 0));
            const kilosUnidad = parseFloat(art.kilos_unidad || 1.0);
            const stockKilosTotales = parseFloat((stockActual * kilosUnidad).toFixed(2));

            // Identificar si es artículo Padre (Pack) o Hijo (Unidades fraccionadas)
            const esPadreInfo = hijoPorPadreMap.get(skuUpper);
            const padresList = padrePorHijoMap.get(skuUpper);

            // Datos de ventas directas
            const vData = ventasMap.get(sku) || ventasMap.get(skuUpper) || {
                ventas_7d: '0',
                ventas_ventana: '0',
                ventas_30d: '0',
                ventas_60d: '0',
                ventas_90d: '0',
                semanas_activas_90d: '0',
                total_operaciones: '0',
                ultima_venta_fecha: null
            };

            // Presupuestos activos directos
            const presData = presupuestosMap.get(skuUpper) || { cantidad_comprometida: 0, presupuestos_cant: 0 };
            const comprometidoDirecto = redondearEnteroOFlotanteLimpio(presData.cantidad_comprometida);
            const presupuestosDirectoCant = presData.presupuestos_cant;

            let stockFisico = stockActual;
            let stockConsolidadoTotal = stockFisico;
            let comprometidoTotal = comprometidoDirecto;
            let presupuestosTotalCant = presupuestosDirectoCant;
            let ventas7dTotal = parseFloat(vData.ventas_7d || 0);
            let ventasVentanaTotal = parseFloat(vData.ventas_ventana || 0);
            let ventas30dTotal = parseFloat(vData.ventas_30d || 0);
            let ventas60dTotal = parseFloat(vData.ventas_60d || 0);
            let ventas90dTotal = parseFloat(vData.ventas_90d || 0);
            let semanasActivas90d = parseInt(vData.semanas_activas_90d || 0);
            let esRotacionSemanal = semanasActivas90d >= 6;
            let esEsporadico = (semanasActivas90d <= 2 || ventas90dTotal <= 3);
            let cadenciaRotacion = esRotacionSemanal ? 'ALTA_SEMANAL' : (semanasActivas90d >= 3 ? 'MEDIA_QUINCENAL' : (semanasActivas90d >= 1 ? 'ESPORADICA_TRIMESTRAL' : 'SIN_ROTACION'));

            let ddp = 0;
            let diasCobertura = 999;
            let estadoAlarma = 'SIN_ROTACION';
            let prioridad = 5;
            let cantidadSugerida = 0;
            let accionRequerida = '';
            let packsArmables = 0;
            let stockNetoDisponible = stockFisico - comprometidoTotal;

            let packsAArmar = 0;

            if (esPadreInfo) {
                // =============================================================
                // EVALUACIÓN ARTÍCULO PADRE (PACK)
                // =============================================================
                const hijoArt = articulosMap.get(esPadreInfo.hijo_sku);
                const stockHijo = hijoArt ? parseFloat(hijoArt.stock_consolidado || 0) : 0;
                packsArmables = Math.floor(stockHijo / esPadreInfo.pack_unidades);
                const totalPacksDisp = stockFisico + packsArmables;
                stockConsolidadoTotal = stockFisico;
                stockNetoDisponible = totalPacksDisp - comprometidoTotal;
                ddp = ventasVentanaTotal / diasEfectivos;

                if (comprometidoTotal > 0 && stockFisico < comprometidoTotal) {
                    // Hay pedidos comprometidos pendientes de entrega que superan los packs físicos armados
                    const faltanArmar = comprometidoTotal - stockFisico;
                    if (totalPacksDisp >= comprometidoTotal) {
                        estadoAlarma = 'ARMABLE_EN_DEPOSITO';
                        prioridad = 2; // Alta prioridad: pedido pendiente
                        packsAArmar = faltanArmar;
                        accionRequerida = `📦 Armar ${faltanArmar} pack(s) p/ pedidos con ${(faltanArmar * esPadreInfo.pack_unidades)} bolsas de [${esPadreInfo.hijo_sku}] en depósito`;
                    } else {
                        estadoAlarma = 'CRITICO_SIN_STOCK';
                        prioridad = 1;
                        const faltanPacksTotal = comprometidoTotal - totalPacksDisp;
                        packsAArmar = packsArmables; // armar los que se puedan con stock disponible
                        accionRequerida = `🔴 Quiebre: Faltan ${faltanPacksTotal} packs. Envasar bolsas del hijo [${esPadreInfo.hijo_sku}]`;
                    }
                } else if (comprometidoTotal > 0 && totalPacksDisp < comprometidoTotal) {
                    estadoAlarma = 'CRITICO_SIN_STOCK';
                    prioridad = 1;
                    const faltanPacksTotal = comprometidoTotal - totalPacksDisp;
                    packsAArmar = 0;
                    accionRequerida = `🔴 Quiebre: Faltan ${faltanPacksTotal} packs. Envasar bolsas del hijo [${esPadreInfo.hijo_sku}]`;
                } else {
                    // NO hay pedidos comprometidos pendientes (o están cubiertos por los packs ya armados)
                    // Las bolsas del hijo ya están estokeadas en depósito. NO generar orden innecesaria al taller.
                    estadoAlarma = 'OPTIMO';
                    prioridad = 4;
                    packsAArmar = 0;
                    accionRequerida = totalPacksDisp > 0 
                        ? `✓ ${totalPacksDisp} pack(s) disponible(s) (${stockFisico} armados + ${packsArmables} en depósito de hijos)` 
                        : `Stock en rango (Sin stock de hijo en depósito)`;
                }

                diasCobertura = ddp > 0 ? (totalPacksDisp / ddp) : 999;
                cantidadSugerida = 0; // La producción en máquina se encomienda a las unidades hijas

            } else if (padresList) {
                // =============================================================
                // EVALUACIÓN ARTÍCULO HIJO (FRACCIÓN QUE ABSORBE DEMANDA DE PACKS)
                // =============================================================
                let ventas7dPadres = 0;
                let ventasVentanaPadres = 0;
                let ventas30dPadres = 0;
                let ventas60dPadres = 0;
                let ventas90dPadres = 0;
                let compPadres = 0;
                let presPadresCant = 0;
                let stockPadresEnUnidades = 0;

                padresList.forEach(p => {
                    const vp = ventasMap.get(p.padre_sku) || { ventas_7d: 0, ventas_ventana: 0, ventas_30d: 0, ventas_60d: 0, ventas_90d: 0, semanas_activas_90d: 0 };
                    const cp = presupuestosMap.get(p.padre_sku) || { cantidad_comprometida: 0, presupuestos_cant: 0 };
                    const artPadre = articulosMap.get(p.padre_sku);
                    const sp = artPadre ? parseFloat(artPadre.stock_consolidado || 0) : 0;

                    ventas7dPadres += (parseFloat(vp.ventas_7d || 0) * p.pack_unidades);
                    ventasVentanaPadres += (parseFloat(vp.ventas_ventana || 0) * p.pack_unidades);
                    ventas30dPadres += (parseFloat(vp.ventas_30d || 0) * p.pack_unidades);
                    ventas60dPadres += (parseFloat(vp.ventas_60d || 0) * p.pack_unidades);
                    ventas90dPadres += (parseFloat(vp.ventas_90d || 0) * p.pack_unidades);
                    semanasActivas90d = Math.max(semanasActivas90d, parseInt(vp.semanas_activas_90d || 0));
                    compPadres += (cp.cantidad_comprometida * p.pack_unidades);
                    presPadresCant += cp.presupuestos_cant;
                    stockPadresEnUnidades += (sp * p.pack_unidades);
                });

                ventas7dTotal += ventas7dPadres;
                ventasVentanaTotal += ventasVentanaPadres;
                ventas30dTotal += ventas30dPadres;
                ventas60dTotal += ventas60dPadres;
                ventas90dTotal += ventas90dPadres;
                comprometidoTotal += compPadres;
                presupuestosTotalCant += presPadresCant;
                stockConsolidadoTotal = redondearEnteroOFlotanteLimpio(stockFisico + stockPadresEnUnidades);
                stockNetoDisponible = redondearEnteroOFlotanteLimpio(stockConsolidadoTotal - comprometidoTotal);
                ddp = ventasVentanaTotal / diasEfectivos;

                esRotacionSemanal = semanasActivas90d >= 6;
                esEsporadico = (semanasActivas90d <= 2 || ventas90dTotal <= 3);
                cadenciaRotacion = esRotacionSemanal ? 'ALTA_SEMANAL' : (semanasActivas90d >= 3 ? 'MEDIA_QUINCENAL' : (semanasActivas90d >= 1 ? 'ESPORADICA_TRIMESTRAL' : 'SIN_ROTACION'));

                // Amortiguar DDP si es un artículo esporádico con una venta aislada reciente
                if (esEsporadico && ddp > (ventas90dTotal / 90)) {
                    ddp = parseFloat((ventas90dTotal / 90).toFixed(4));
                }

                if (ddp > 0) {
                    diasCobertura = Math.max(0, stockNetoDisponible) / ddp;
                } else if (stockNetoDisponible <= 0 && (comprometidoTotal > 0 || (esRotacionSemanal && ventas30dTotal > 0))) {
                    diasCobertura = 0;
                }

                if (stockNetoDisponible < 0) {
                    estadoAlarma = 'CRITICO_SIN_STOCK';
                    prioridad = 1;
                    const faltanteComp = Math.abs(stockNetoDisponible);
                    const stockDeseado = esEsporadico ? 0 : Math.ceil(ddp * objetivo);
                    cantidadSugerida = Math.round(faltanteComp + stockDeseado);
                    accionRequerida = `🚨 QUIEBRE ACTIVO: Faltan ${faltanteComp} bolsas p/ pedidos. Envasar ${cantidadSugerida} bolsas`;
                } else if (stockConsolidadoTotal <= 0 && (ventas30dTotal > 0 || (objetivo >= 15 && ventas90dTotal > 0))) {
                    // Si el stock en estantería llegó a CERO y el artículo tuvo ventas reales (30d o 90d),
                    // jamás debe ocultarse como "A pedido": hay que reponer el lote mínimo de estantería.
                    estadoAlarma = 'CRITICO_SIN_STOCK';
                    prioridad = ventas30dTotal >= 2 ? 1 : 2;
                    cantidadSugerida = Math.max(1, Math.round(Math.ceil(ddp * objetivo) || Math.ceil((ventas30dTotal / 30) * objetivo) || 1));
                    accionRequerida = `Envasar ${cantidadSugerida} bolsas (Sin stock físico)`;
                } else if (esEsporadico) {
                    // Artículos de demanda esporádica que YA TIENEN stock > 0 en estantería (o sin ventas en 90d):
                    estadoAlarma = stockConsolidadoTotal > 0 ? 'OPTIMO' : 'SIN_ROTACION';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = stockConsolidadoTotal > 0
                        ? 'Stock disponible (Demanda esporádica)'
                        : 'A pedido (Demanda esporádica sin pedidos activos)';
                } else if (ddp > 0 && diasCobertura <= 5) {
                    estadoAlarma = 'CRITICO';
                    prioridad = 2;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Envasar ${cantidadSugerida} bolsas (Cobertura ${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura <= Math.min(12, objetivo)) {
                    estadoAlarma = 'ATENCION';
                    prioridad = 3;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Envasar ${cantidadSugerida} bolsas (Preventivo ${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura < objetivo) {
                    estadoAlarma = 'PLANIFICADO';
                    prioridad = 4;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Envasar ${cantidadSugerida} bolsas (Planificado p/ ${objetivo}d - Cob. ${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura <= Math.max(30, objetivo * 1.3)) {
                    estadoAlarma = 'OPTIMO';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock en rango';
                } else if (ddp === 0 && stockConsolidadoTotal > 0) {
                    estadoAlarma = 'OPTIMO';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock estable sin ventas recientes';
                } else {
                    estadoAlarma = 'SOBRE_STOCK';
                    prioridad = 6;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock suficiente';
                }

            } else {
                // =============================================================
                // EVALUACIÓN ARTÍCULO ESTÁNDAR (SIN RELACIÓN PACK)
                // =============================================================
                stockNetoDisponible = redondearEnteroOFlotanteLimpio(stockFisico - comprometidoTotal);
                ddp = ventasVentanaTotal / diasEfectivos;

                esRotacionSemanal = semanasActivas90d >= 6;
                esEsporadico = (semanasActivas90d <= 2 || ventas90dTotal <= 3);
                cadenciaRotacion = esRotacionSemanal ? 'ALTA_SEMANAL' : (semanasActivas90d >= 3 ? 'MEDIA_QUINCENAL' : (semanasActivas90d >= 1 ? 'ESPORADICA_TRIMESTRAL' : 'SIN_ROTACION'));

                // Amortiguar DDP si es un artículo esporádico con una venta aislada reciente
                if (esEsporadico && ddp > (ventas90dTotal / 90)) {
                    ddp = parseFloat((ventas90dTotal / 90).toFixed(4));
                }

                if (ddp > 0) {
                    diasCobertura = Math.max(0, stockNetoDisponible) / ddp;
                } else if (stockNetoDisponible <= 0 && (comprometidoTotal > 0 || (esRotacionSemanal && ventas30dTotal > 0))) {
                    diasCobertura = 0;
                }

                if (stockNetoDisponible < 0) {
                    estadoAlarma = 'CRITICO_SIN_STOCK';
                    prioridad = 1;
                    const faltanteComp = Math.abs(stockNetoDisponible);
                    const stockDeseado = esEsporadico ? 0 : Math.ceil(ddp * objetivo);
                    cantidadSugerida = Math.round(faltanteComp + stockDeseado);
                    accionRequerida = `🚨 QUIEBRE ACTIVO: Faltan ${faltanteComp}u p/ pedidos. Reponer ${cantidadSugerida}u`;
                } else if (stockFisico <= 0 && (ventas30dTotal > 0 || (objetivo >= 15 && ventas90dTotal > 0))) {
                    // Si el stock en estantería llegó a CERO y el artículo se vendió en los últimos 30/90 días
                    // (ej. Sésamo Negro x 5kg SNX5, Coco en Escamas x 2kg CCDEX2, Higo Turco x 2kg, etc.),
                    // NUNCA debe silenciarse como "A pedido": debe reponerse su lote en estantería.
                    estadoAlarma = 'CRITICO_SIN_STOCK';
                    prioridad = ventas30dTotal >= 2 ? 1 : 2;
                    cantidadSugerida = Math.max(1, Math.round(Math.ceil(ddp * objetivo) || Math.ceil((ventas30dTotal / 30) * objetivo) || 1));
                    accionRequerida = `Reponer ${cantidadSugerida}u (Sin stock en estantería)`;
                } else if (esEsporadico) {
                    // Artículos de demanda esporádica que YA tienen stock > 0 en estantería (o 0 ventas en 90d)
                    estadoAlarma = stockFisico > 0 ? 'OPTIMO' : 'SIN_ROTACION';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = stockFisico > 0
                        ? 'Stock disponible (Demanda esporádica)'
                        : 'A pedido (Demanda esporádica sin pedidos activos)';
                } else if (ddp > 0 && stockNetoDisponible <= 1 && kilosUnidad < 20 && (stockNetoDisponible <= 0 || ddp >= 0.08 || kilosUnidad <= 2)) {
                    // Piso mínimo de estantería para artículos de rotación activa (!esEsporadico):
                    // Si queda 1 sola bolsa (o 0 libres tras pedidos comprometidos) en rotación frecuente (o bolsas chicas <=2kg),
                    // no puede darse por cubierta la semana porque cualquier pedido vacía la estantería.
                    estadoAlarma = stockNetoDisponible <= 0 ? 'CRITICO_SIN_STOCK' : 'CRITICO';
                    prioridad = stockNetoDisponible <= 0 ? 1 : 2;
                    const stockDeseadoMin = Math.max(2, Math.ceil(ddp * objetivo));
                    cantidadSugerida = Math.max(1, Math.round(stockDeseadoMin - stockNetoDisponible));
                    accionRequerida = `Reponer ${cantidadSugerida}u (Piso mínimo estantería · libre: ${stockNetoDisponible}u)`;
                } else if (ddp > 0 && diasCobertura <= 5) {
                    estadoAlarma = 'CRITICO';
                    prioridad = 2;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Reponer ${cantidadSugerida}u (Cobertura ${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura <= Math.min(12, objetivo)) {
                    estadoAlarma = 'ATENCION';
                    prioridad = 3;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Atención (${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura < objetivo) {
                    estadoAlarma = 'PLANIFICADO';
                    prioridad = 4;
                    cantidadSugerida = Math.max(0, Math.round(Math.ceil(ddp * objetivo) - stockNetoDisponible));
                    accionRequerida = `Planificado p/ ${objetivo}d (Cobertura actual ${diasCobertura.toFixed(1)}d)`;
                } else if (ddp > 0 && diasCobertura <= Math.max(30, objetivo * 1.3)) {
                    estadoAlarma = 'OPTIMO';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock en rango';
                } else if (ddp === 0 && stockFisico > 0) {
                    estadoAlarma = 'OPTIMO';
                    prioridad = 5;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock estable sin ventas recientes';
                } else {
                    estadoAlarma = 'SOBRE_STOCK';
                    prioridad = 6;
                    cantidadSugerida = 0;
                    accionRequerida = 'Stock suficiente';
                }
            }

            // Artículos intermedios de producción interna (familia_id === 42, ej: MPB, MPG1, MPG2, MPC)
            // no son ofertas comerciales directas: su requerimiento es absorbido por la demanda derivada de la oferta final
            const esInsumoIntermedioProduccion = parseInt(art.familia_id || 0) === 42 || skuUpper === 'MPB' || skuUpper.startsWith('MPG');
            if (esInsumoIntermedioProduccion) {
                cantidadSugerida = 0;
                estadoAlarma = 'OPTIMO';
                prioridad = 5;
                accionRequerida = 'Insumo intermedio de taller (Demanda derivada)';
            }

            // =================================================================
            // REDONDEO A MÚLTIPLOS DE PACK (No dejar unidades huérfanas en taller)
            // =================================================================
            let packUnidadesPresentacion = 1;
            if (padresList && padresList.length > 0) {
                packUnidadesPresentacion = padresList[0].pack_unidades || 1;
            } else if (art.pack_unidades && art.pack_unidades > 1 && !esPadreInfo && !art.es_pack) {
                packUnidadesPresentacion = art.pack_unidades;
            }
            // Regla comercial LAMDA: En presentaciones de 500g (ej. GSX500G / GDFX500G), el pack comercial real es de 5 x 500g (nunca de 10 x 500g)
            if (Math.abs(kilosUnidad - 0.5) < 0.02 && packUnidadesPresentacion === 10) {
                packUnidadesPresentacion = 5;
            }

            if (packUnidadesPresentacion > 1 && cantidadSugerida > 0) {
                const sugeridaMultiploPack = Math.max(
                    packUnidadesPresentacion,
                    Math.ceil(cantidadSugerida / packUnidadesPresentacion) * packUnidadesPresentacion
                );
                if (sugeridaMultiploPack !== cantidadSugerida) {
                    cantidadSugerida = sugeridaMultiploPack;
                    if (accionRequerida.includes('Envasar') || accionRequerida.includes('Reponer')) {
                        accionRequerida = accionRequerida.replace(/\d+ (bolsas|u)/, `${cantidadSugerida} $1 (Packs x${packUnidadesPresentacion})`);
                    }
                }
            }

            const kilosSugeridos = cantidadSugerida * kilosUnidad;

            // Datos de producción histórica
            const pData = produccionMap.get(sku) || produccionMap.get(skuUpper) || {
                ultima_produccion_fecha: null,
                carros_realizados_90d: '0',
                lote_promedio_historico: '0',
                unidades_producidas_90d: '0'
            };

            const ultimaProd = pData.ultima_produccion_fecha ? new Date(pData.ultima_produccion_fecha) : null;
            const diasDesdeUltimaProd = ultimaProd ? Math.floor((Date.now() - ultimaProd.getTime()) / (1000 * 60 * 60 * 24)) : null;

            // Identificar Receta (si es padre sin receta directa, heredar del hijo)
            let recetaObj = recetasPorArticulo.get(skuUpper) || null;
            if (!recetaObj && esPadreInfo) {
                recetaObj = recetasPorArticulo.get(esPadreInfo.hijo_sku) || null;
            }
            const tieneReceta = !!recetaObj || art.tiene_receta;
            const ingsReceta = recetaObj ? recetaObj.ingredientes : [];

            // Filtrar solo ingredientes alimenticios (excluir bolsas/etiquetas)
            const ingsAlimentos = ingsReceta.filter(ri => !ri.es_insumo && ri.unidad_medida !== 'Unidades');

            // -----------------------------------------------------------------
            // CLASIFICACIÓN RIGUROSA EN LAS 6 LÍNEAS DE NEGOCIO (LDN)
            // -----------------------------------------------------------------
            let ldn = 1;
            let tipoProceso = 'Compra Directa';
            if (!accionRequerida) {
                accionRequerida = cantidadSugerida > 0 ? 'Generar Orden de Compra' : 'Stock en Rango';
            }
            let factibilidad = { factible: true, detalle: 'Listo para pedir a proveedor' };
            let mermaEsperada = 0;
            let bultosDisponibles = 0;
            let bultosTallerCant = 0;
            let bultosDepoCant = 0;
            let totalKgMateriaPrima = 0;
            let kgSueltosFabrica = 0;
            let ingNombre = 'Insumo Puro';
            let crudoStockKg = 0;
            let crudoNombre = 'Materia Prima Cruda';
            let crudoSku = null;
            let crudoBultoKg = 1.0;
            let kilosCrudoNecesarios = 0;
            let bultosCrudosDespachar = 0;
            let ingTostId = null;

            const codeNorm = sku.toLowerCase();
            const descNorm = (art.descripcion_generada || art.descripcion || '').toLowerCase();

            // Detección de Barritas (LDN 5)
            const tieneIngBarrita = ingsAlimentos.some(ri => ri.ingrediente_id === 109 || ri.ingrediente_id === 141);
            const esBarrita = codeNorm.startsWith('bf') || descNorm.includes('barrita') || descNorm.includes('barr.') || descNorm.includes('barra') || codeNorm.includes('bfx') || tieneIngBarrita;

            // Detección de Granolas (LDN 6)
            const tieneIngGranola = ingsAlimentos.some(ri => [122, 131, 132, 134].includes(ri.ingrediente_id));
            const esGranola = descNorm.includes('granola') || codeNorm.startsWith('gr') || descNorm.includes('grana') || tieneIngGranola;

            // Detección de Tostaderos / UP Simple (LDN 4) — Relacional y Estructural
            const esUpTostaderoDirecto = UP_A_INGREDIENTE_TOSTADO.has(skuUpper) ||
                upRelaciones.some(r => (r.articulo_kilo_codigo === sku || r.articulo_produccion_codigo === sku) &&
                                       (UP_A_INGREDIENTE_TOSTADO.has(r.articulo_produccion_codigo) || UP_A_INGREDIENTE_TOSTADO.has(r.articulo_kilo_codigo)));

            const esFraccionMonoTostadero = ingsAlimentos.length === 1 && TOSTADOS_A_MATERIA_PRIMA_CRUDA.has(ingsAlimentos[0].ingrediente_id);

            const esTostadero = !esBarrita && !esGranola && (esUpTostaderoDirecto || esFraccionMonoTostadero);

            // Detección de Mixes / Recetas Compuestas (LDN 3)
            // IMPORTANTE: Nunca usar codeNorm.startsWith('m') porque clasifica erróneamente Maní y Maíz como Mixes
            const tieneComponenteMix = ingsAlimentos.some(ri => mixesIds.has(ri.ingrediente_id) || IDS_INGREDIENTES_MIX.has(ri.ingrediente_id));
            const esMixInterno = !esBarrita && !esGranola && !esTostadero && (ingsAlimentos.length > 1 || tieneComponenteMix || descNorm.includes('mix'));

            // Bultos industriales de >= 20kg (ej: SQRx25) o artículos sin receta / sin alimento y que no son packs pertenecen a LDN 1
            const esBultoCerradoIndustrial = !esPadreInfo && !padresList && kilosUnidad >= 20 && !esBarrita && !esGranola && !esTostadero && !esMixInterno;
            const sinRecetaAlimenticia = (!tieneReceta || ingsAlimentos.length === 0) && !esPadreInfo && !esTostadero && !esBarrita && !esGranola && !esMixInterno;

            if (sinRecetaAlimenticia || esBultoCerradoIndustrial) {
                // =============================================================
                // [LDN 1] Comercialización Directa (Bulto Cerrado Sin Receta)
                // =============================================================
                ldn = 1;
                tipoProceso = 'Compra Directa';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Generar Orden de Compra de Bulto Cerrado' : 'Stock en Rango';
                }
                factibilidad = {
                    factible: true,
                    detalle: 'No requiere producción en taller. Se adquiere cerrado a proveedor.'
                };
            } else if (esBarrita) {
                // =============================================================
                // [LDN 5] Barritas (Mezcla Interna + UP Externa)
                // =============================================================
                ldn = 5;
                tipoProceso = 'Bi-fásico (Taller + UP Barritas)';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Armar Carro de Mezcla en Taller y Despachar a UP' : 'Stock en Rango';
                }
                const mermaData = mermasMap.get(sku);
                mermaEsperada = mermaData ? parseFloat(mermaData.merma_promedio || 0) : 10.5;
                factibilidad = {
                    factible: true,
                    detalle: `Requiere mezcla previa en depósito y despacho a UP. Merma est.: ${mermaEsperada}%`
                };
            } else if (esGranola) {
                // =============================================================
                // [LDN 6] Granolas Complejas (Doble Mezcla)
                // =============================================================
                ldn = 6;
                tipoProceso = 'Doble Mezcla (Horneado UP + Ensamble Taller)';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Solicitar Horneado Base en UP y Ensamble Seco' : 'Stock en Rango';
                }
                const mermaData = mermasMap.get(sku);
                mermaEsperada = mermaData ? parseFloat(mermaData.merma_promedio || 0) : 12.0;
                factibilidad = {
                    factible: true,
                    detalle: `Circuito en 2 fases con horneado en UP y agregado de semillas/frutos en taller.`
                };
            } else if (esTostadero) {
                // =============================================================
                // [LDN 4] Tostaderos (UP Externa Simple)
                // =============================================================
                ldn = 4;
                tipoProceso = 'Producción Externa (UP Tostadero)';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Despachar Crudo a Tostadero Externo' : 'Stock en Rango';
                }

                // Resolver ingrediente tostado (desde receta directa o catálogo UP)
                ingTostId = null;
                if (ingsAlimentos.length > 0) {
                    const ingMatch = ingsAlimentos.find(ri => TOSTADOS_A_MATERIA_PRIMA_CRUDA.has(ri.ingrediente_id));
                    if (ingMatch) ingTostId = ingMatch.ingrediente_id;
                    else ingTostId = ingsAlimentos[0].ingrediente_id;
                }
                if (!ingTostId && UP_A_INGREDIENTE_TOSTADO.has(skuUpper)) {
                    ingTostId = UP_A_INGREDIENTE_TOSTADO.get(skuUpper);
                }

                const crudoInfo = ingTostId ? TOSTADOS_A_MATERIA_PRIMA_CRUDA.get(ingTostId) : null;
                const mermaData = mermasMap.get(sku);
                mermaEsperada = mermaData ? parseFloat(mermaData.merma_promedio || 0) : (crudoInfo ? crudoInfo.merma_pct : 6.5);

                if (crudoInfo) {
                    crudoSku = crudoInfo.crudo_sku;
                    crudoNombre = crudoInfo.nombre_crudo;
                    const artCrudo = articulosMap.get(crudoSku.toUpperCase());
                    if (artCrudo) {
                        crudoBultoKg = parseFloat(artCrudo.kilos_unidad || 1.0);
                        crudoStockKg = Math.max(0, parseFloat(artCrudo.stock_consolidado || 0)) * crudoBultoKg;
                    }
                    const altSkus = crudoInfo.crudo_skus_alt || (crudoInfo.crudo_sku_alt ? [crudoInfo.crudo_sku_alt] : []);
                    for (const altSku of altSkus) {
                        const artCrudoAlt = articulosMap.get(altSku.toUpperCase());
                        if (artCrudoAlt) {
                            const altBultoKg = parseFloat(artCrudoAlt.kilos_unidad || 1.0);
                            const altStockKg = Math.max(0, parseFloat(artCrudoAlt.stock_consolidado || 0)) * altBultoKg;
                            if (altStockKg > 0) {
                                if (crudoStockKg <= 0) {
                                    crudoSku = artCrudoAlt.articulo_id;
                                    crudoBultoKg = altBultoKg;
                                }
                                crudoStockKg += altStockKg;
                            }
                        }
                    }
                } else if (ingsAlimentos.length > 0) {
                    const ingCrudo = ingredientesMap.get(ingsAlimentos[0].ingrediente_id);
                    if (ingCrudo) {
                        crudoStockKg = ingCrudo.stock_total_materia_prima_kg !== undefined
                            ? parseFloat(ingCrudo.stock_total_materia_prima_kg)
                            : parseFloat(ingCrudo.stock_actual || 0);
                        crudoNombre = ingCrudo.nombre;
                        crudoSku = ingCrudo.articulo_vinculado_numero;
                        crudoBultoKg = parseFloat(ingCrudo.kilos_por_bulto || 1.0);
                    }
                }

                kilosCrudoNecesarios = kilosSugeridos * (1 + (mermaEsperada / 100));
                bultosCrudosDespachar = kilosCrudoNecesarios > 0 ? Math.ceil(kilosCrudoNecesarios / (crudoBultoKg > 0 ? crudoBultoKg : 1.0)) : 0;
                const crudoAlcanza = crudoStockKg >= kilosCrudoNecesarios;

                factibilidad = {
                    factible: crudoAlcanza,
                    detalle: crudoAlcanza 
                        ? `Disponible en depósito: ${crudoStockKg.toFixed(1)} kg de ${crudoNombre} (Requiere ~${kilosCrudoNecesarios.toFixed(1)} kg con merma ${mermaEsperada}%)`
                        : `CRÍTICO: Stock crudo insuficiente (${crudoStockKg.toFixed(1)} kg de ${crudoNombre}). Comprar crudo antes de despachar a UP.`
                };
            } else if (esMixInterno) {
                // =============================================================
                // [LDN 3] Mixes y Mezclas Internas (Carros Mix)
                // =============================================================
                ldn = 3;
                tipoProceso = 'Carro de Mezcla Interno';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Armar Carro de Mezcla Interna y Fraccionar' : 'Stock en Rango';
                }

                // Evaluar cuello de botella
                let mixIdEvaluado = null;
                const ingMix = ingsAlimentos.find(ri => mixesIds.has(ri.ingrediente_id));
                if (ingMix) {
                    mixIdEvaluado = ingMix.ingrediente_id;
                } else if (ingsAlimentos.length > 0) {
                    mixIdEvaluado = ingsAlimentos[0].ingrediente_id;
                }

                const cuello = cuelloBotellaPorMix.get(mixIdEvaluado);
                if (cuello) {
                    const kilosMixPosibles = cuello.kilos_mix_posibles;
                    const esFactible = kilosMixPosibles >= kilosSugeridos;
                    factibilidad = {
                        factible: esFactible,
                        cuello_botella: cuello.componente_nombre,
                        kilos_maximos_posibles: kilosMixPosibles,
                        detalle: esFactible
                            ? `Capacidad máxima: ${kilosMixPosibles.toFixed(1)} kg (Limitado por ${cuello.componente_nombre})`
                            : `BLOQUEO: Solo alcanzan insumos para ${kilosMixPosibles.toFixed(1)} kg de ${kilosSugeridos.toFixed(1)} kg sugeridos. Falta: ${cuello.componente_nombre}.`
                    };

                    if (!esFactible && cantidadSugerida > 0) {
                        if (!insumosBloqueantesMap.has(cuello.componente_id)) {
                            insumosBloqueantesMap.set(cuello.componente_id, {
                                ingrediente_id: cuello.componente_id,
                                ingrediente_nombre: cuello.componente_nombre,
                                disponible: cuello.disponible_componente,
                                productos_afectados: []
                            });
                        }
                        insumosBloqueantesMap.get(cuello.componente_id).productos_afectados.push(art.descripcion_generada || art.descripcion);
                    }
                } else {
                    factibilidad = {
                        factible: true,
                        detalle: 'Receta sin cuello de botella crítico registrado.'
                    };
                }
            } else {
                // =============================================================
                // [LDN 2] Fraccionados Mono-Ingrediente 100% Puros
                // =============================================================
                ldn = 2;
                tipoProceso = 'Fraccionamiento Interno';
                if (!accionRequerida) {
                    accionRequerida = cantidadSugerida > 0 ? 'Armar Carro de Fraccionamiento en Taller' : 'Stock en Rango';
                }

                // Verificar stock del bulto o ingrediente en fábrica y taller
                bultosDisponibles = 0;
                bultosTallerCant = 0;
                bultosDepoCant = 0;
                kgSueltosFabrica = 0;
                ingNombre = 'Insumo Puro';
                totalKgMateriaPrima = 0;

                if (ingsAlimentos.length > 0) {
                    const ingPuro = ingredientesMap.get(ingsAlimentos[0].ingrediente_id);
                    if (ingPuro) {
                        ingNombre = ingPuro.nombre;
                        kgSueltosFabrica = parseFloat(ingPuro.stock_actual || 0);
                        bultosTallerCant = parseFloat(ingPuro.bultos_taller_cant || 0);
                        bultosDepoCant = parseFloat(ingPuro.bultos_deposito_cant || 0);
                        bultosDisponibles = ingPuro.total_bultos_cerrados || 0;
                        totalKgMateriaPrima = parseFloat(ingPuro.stock_total_materia_prima_kg || 0);
                    }
                }

                if (totalKgMateriaPrima === 0) {
                    totalKgMateriaPrima = kgSueltosFabrica;
                }
                const esFactible = totalKgMateriaPrima >= kilosSugeridos;

                factibilidad = {
                    factible: esFactible,
                    detalle: esFactible
                        ? `Materia prima disponible: ${totalKgMateriaPrima.toFixed(1)} kg (${bultosTallerCant} cj taller + ${bultosDepoCant} cj depósito + ${kgSueltosFabrica.toFixed(1)} kg abiertos de ${ingNombre})`
                        : `ALERTA: Materia prima insuficiente (${totalKgMateriaPrima.toFixed(1)} kg disp. vs ${kilosSugeridos.toFixed(1)} kg req.). Abrir/comprar bulto de ${ingNombre}.`
                };
            }

            const itemResultado = {
                articulo_id: art.articulo_id,
                descripcion: art.descripcion_generada || art.descripcion,
                familia_id: art.familia_id,
                familia_nombre: art.familia_nombre || 'General',
                rubro: art.rubro || 'Sin Rubro',
                sub_rubro: art.sub_rubro || 'Sin Subrubro',
                kilos_unidad: kilosUnidad,
                costo_base: parseFloat(art.costo_base || 0),
                
                // Métricas de Stock y Demanda Comprometida
                stock_actual: redondearEnteroOFlotanteLimpio(stockActual),
                stock_kilos: parseFloat(stockKilosTotales.toFixed(1)),
                stock_consolidado_total: redondearEnteroOFlotanteLimpio(stockConsolidadoTotal),
                stock_neto_disponible: redondearEnteroOFlotanteLimpio(stockNetoDisponible, 1),
                comprometido_presupuestos: redondearEnteroOFlotanteLimpio(comprometidoTotal),
                presupuestos_cant: presupuestosTotalCant,

                // Relación Padre-Hijo Packs
                es_padre: !!esPadreInfo,
                es_hijo: !!padresList,
                packs_armables: redondearEnteroOFlotanteLimpio(packsArmables),
                packs_a_armar: redondearEnteroOFlotanteLimpio(packsAArmar),
                padres_vinculados: padresList ? padresList.map(p => p.padre_sku) : [],
                pack_padre_codigo: (padresList && padresList.length > 0) ? padresList[0].padre_sku : null,
                hijo_vinculado: esPadreInfo ? esPadreInfo.hijo_sku : null,
                pack_hijo_codigo: esPadreInfo ? esPadreInfo.hijo_sku : null,
                pack_unidades: esPadreInfo ? esPadreInfo.pack_unidades : (padresList && padresList.length > 0 ? padresList[0].pack_unidades : null),
                
                // Métricas de Ventas Consolidadas
                ventas_7d: ventas7dTotal,
                ventas_ventana: ventasVentanaTotal,
                ventas_30d: ventas30dTotal,
                ventas_60d: ventas60dTotal,
                ventas_90d: ventas90dTotal,
                semanas_activas_90d: semanasActivas90d,
                es_esporadico: esEsporadico,
                es_rotacion_semanal: esRotacionSemanal,
                cadencia_rotacion: cadenciaRotacion,
                demanda_diaria_promedio: parseFloat(ddp.toFixed(3)),
                dias_cobertura: diasCobertura === 999 ? 999 : parseFloat(diasCobertura.toFixed(1)),
                ultima_venta_fecha: vData.ultima_venta_fecha,
                
                // Estado y Prioridad
                estado_alarma: estadoAlarma,
                prioridad: prioridad,
                
                // Sugerencias
                cantidad_sugerida: redondearEnteroOFlotanteLimpio(cantidadSugerida),
                kilos_sugeridos: parseFloat((kilosSugeridos || 0).toFixed(1)),
                accion_requerida: accionRequerida,
                
                // Línea de Negocio y Factibilidad
                ldn: ldn,
                tipo_proceso: tipoProceso,
                merma_esperada: mermaEsperada,
                factibilidad: factibilidad,
                
                // Frecuencia de Producción
                dias_desde_ultima_produccion: diasDesdeUltimaProd,
                ultima_produccion_fecha: pData.ultima_produccion_fecha,
                lote_promedio_historico: parseFloat(pData.lote_promedio_historico || 0),
                carros_realizados_90d: parseInt(pData.carros_realizados_90d || 0)
            };

            // Metadatos de fraccionamiento puro para el colaborador
            if (ldn === 2) {
                const ingPuroRef = ingsAlimentos.length > 0 ? ingredientesMap.get(ingsAlimentos[0].ingrediente_id) : null;
                itemResultado.ingrediente_id = ingPuroRef ? ingPuroRef.id : null;
                itemResultado.kilos_por_bulto = ingPuroRef ? parseFloat(ingPuroRef.kilos_por_bulto || 25) : 25;
                itemResultado.bulto_desc = ingPuroRef ? (ingPuroRef.bulto_desc || null) : null;
                itemResultado.materia_prima_nombre = ingNombre;
                itemResultado.stock_taller_kg = kgSueltosFabrica;
                itemResultado.bultos_taller = bultosTallerCant;
                itemResultado.bultos_deposito = bultosDepoCant;
                itemResultado.total_bultos_cerrados = bultosDisponibles;
                itemResultado.stock_total_materia_prima_kg = totalKgMateriaPrima;
                itemResultado.ubicacion_sugerida = kgSueltosFabrica >= kilosSugeridos
                    ? `🟢 Bolsa abierta en taller (${kgSueltosFabrica.toFixed(1)} kg disp.)`
                    : (bultosTallerCant > 0
                        ? `📦 Taller: Abrir bulto cerrado (${bultosTallerCant} cj en taller)`
                        : (bultosDepoCant > 0
                            ? `🏢 Depósito: Pedir bulto cerrado (${bultosDepoCant} cj disp.)`
                            : `🔴 Sin materia prima (Pedir compra a proveedor)`
                        )
                    );
            }

            // Metadatos de tostadero / UP externa para el colaborador
            if (ldn === 4) {
                const ingTostRef = ingTostId ? ingredientesMap.get(ingTostId) : null;
                itemResultado.ingrediente_tostado_nombre = ingTostRef ? ingTostRef.nombre : null;
                itemResultado.stock_tostado_taller_kg = ingTostRef ? parseFloat(parseFloat(ingTostRef.stock_actual || 0).toFixed(2)) : 0;
                itemResultado.materia_prima_nombre = crudoNombre;
                itemResultado.materia_prima_cruda_codigo = crudoSku;
                itemResultado.merma_pct = mermaEsperada;
                itemResultado.kilos_tostados_sugeridos = kilosSugeridos;
                itemResultado.kilos_crudos_requeridos = parseFloat(kilosCrudoNecesarios.toFixed(1));
                itemResultado.bultos_crudos_despachar = bultosCrudosDespachar;
                itemResultado.stock_crudo_disponible_kg = parseFloat(crudoStockKg.toFixed(1));
                itemResultado.ingrediente_tostado_id = ingTostId;
            }

            todosArticulosEvaluados.push(itemResultado);

            // Clasificar en arrays de LDN
            if (ldn === 1) ldn1_directos.push(itemResultado);
            else if (ldn === 2) ldn2_fraccionados.push(itemResultado);
            else if (ldn === 3) ldn3_mixes.push(itemResultado);
            else if (ldn === 4) ldn4_tostaderos.push(itemResultado);
            else if (ldn === 5) ldn5_barritas.push(itemResultado);
            else if (ldn === 6) ldn6_granolas.push(itemResultado);
        });

        // ---------------------------------------------------------------------
        // AGREGACIÓN DE CARROS DE MEZCLA (LDN 3 - ARTÍCULOS PUENTE AP)
        // ---------------------------------------------------------------------
        const mapSimpleToMix = new Map([
            [148, { mix_id: 125, mix_nombre: 'Mix Tropical', ap_sku: 'MFSTXK' }],
            [149, { mix_id: 30, mix_nombre: 'Mix Frutos Secos Con Pasas', ap_sku: 'MFSXK' }],
            [150, { mix_id: 31, mix_nombre: 'Mix Premium', ap_sku: 'MFSPXK' }],
            [151, { mix_id: 40, mix_nombre: 'Mix Salado', ap_sku: 'MSXK' }],
            [154, { mix_id: 124, mix_nombre: 'Mix sin Pasas', ap_sku: 'MFSSOXK' }],
            [155, { mix_id: 118, mix_nombre: 'Mix Color Tropical', ap_sku: 'MCTXK' }],
            [158, { mix_id: 107, mix_nombre: 'Mix Almafrut', ap_sku: 'MFSAFXK' }],
            [159, { mix_id: 77, mix_nombre: 'Mix BK', ap_sku: 'MFSBKXK' }],
            [92,  { mix_id: 92,  mix_nombre: 'Mix Semilla', ap_sku: 'MSEGx5' }],
            [30,  { mix_id: 30, mix_nombre: 'Mix Frutos Secos Con Pasas', ap_sku: 'MFSXK' }],
            [31,  { mix_id: 31, mix_nombre: 'Mix Premium', ap_sku: 'MFSPXK' }],
            [40,  { mix_id: 40, mix_nombre: 'Mix Salado', ap_sku: 'MSXK' }],
            [118, { mix_id: 118, mix_nombre: 'Mix Color Tropical', ap_sku: 'MCTXK' }],
            [124, { mix_id: 124, mix_nombre: 'Mix sin Pasas', ap_sku: 'MFSSOXK' }],
            [125, { mix_id: 125, mix_nombre: 'Mix Tropical', ap_sku: 'MFSTXK' }]
        ]);

        const mixesMap = new Map();
        const mixesMaestros = [
            { mix_id: 30, mix_nombre: 'Mix Frutos Secos Con Pasas', ap_sku: 'MFSXK' },
            { mix_id: 31, mix_nombre: 'Mix Premium', ap_sku: 'MFSPXK' },
            { mix_id: 40, mix_nombre: 'Mix Salado', ap_sku: 'MSXK' },
            { mix_id: 118, mix_nombre: 'Mix Color Tropical', ap_sku: 'MCTXK' },
            { mix_id: 124, mix_nombre: 'Mix sin Pasas', ap_sku: 'MFSSOXK' },
            { mix_id: 125, mix_nombre: 'Mix Tropical', ap_sku: 'MFSTXK' },
            { mix_id: 77, mix_nombre: 'Mix BK', ap_sku: 'MFSBKXK' },
            { mix_id: 107, mix_nombre: 'Mix Almafrut', ap_sku: 'MFSAFXK' },
            { mix_id: 92, mix_nombre: 'Mix Semilla', ap_sku: 'MSEGx5' }
        ];

        mixesMaestros.forEach(m => {
            mixesMap.set(m.mix_id, {
                mix_id: m.mix_id,
                mix_nombre: m.mix_nombre,
                ap_sku: m.ap_sku,
                stock_granel_taller_kg: 0,
                kilos_totales_solicitados: 0,
                kilos_carro_sugeridos: 0,
                urgencia_maxima: 4,
                presentaciones: []
            });
        });

        // Asignar artículos comerciales de ldn3 a su mix
        ldn3_mixes.forEach(art => {
            if (art.articulo_id.includes('AP') || art.articulo_id.endsWith('XK')) return;

            const receta = recetasPorArticulo.get(art.articulo_id.toUpperCase());
            const ingId = receta && receta.ingredientes.length > 0 ? receta.ingredientes[0].ingrediente_id : null;
            const mixInfo = mapSimpleToMix.get(ingId);

            let mixObj = null;
            if (mixInfo && mixesMap.has(mixInfo.mix_id)) {
                mixObj = mixesMap.get(mixInfo.mix_id);
            } else {
                const desc = (art.descripcion || '').toLowerCase();
                if (desc.includes('salado')) mixObj = mixesMap.get(40);
                else if (desc.includes('premiun') || desc.includes('premium')) mixObj = mixesMap.get(31);
                else if (desc.includes('color tropical')) mixObj = mixesMap.get(118);
                else if (desc.includes('tropical')) mixObj = mixesMap.get(125);
                else if (desc.includes('sin pasas') || desc.includes('sinpsas')) mixObj = mixesMap.get(124);
                else if (desc.includes('bk')) mixObj = mixesMap.get(77);
                else if (desc.includes('almafrut')) mixObj = mixesMap.get(107);
                else if (desc.includes('semilla')) mixObj = mixesMap.get(92);
                else if (desc.includes('pasas') || desc.includes('frutos secos')) mixObj = mixesMap.get(30);
            }

            if (mixObj) {
                mixObj.presentaciones.push(art);
                mixObj.kilos_totales_solicitados += (art.kilos_sugeridos || 0);
                if (art.prioridad < mixObj.urgencia_maxima) {
                    mixObj.urgencia_maxima = art.prioridad;
                }
            }
        });

        // Mapeo Mix ID -> ID Insumo Simple Granel en ingredientes
        const mapMixToSimpleIngId = new Map([
            [30, 149],  // MFSXK -> ID 149
            [31, 150],  // MFSPXK -> ID 150
            [40, 151],  // MSXK -> ID 151
            [118, 155], // MCTXK -> ID 155
            [124, 154], // MFSSOXK -> ID 154
            [125, 148], // MFSTXK -> ID 148
            [77, 159],  // MFSBKXK -> ID 159
            [107, 158], // MFSAFXK -> ID 158
            [92, 92]    // MSEGx5 -> ID 92
        ]);

        // Calcular stock de granel y receta de pesaje para cada carro
        const carrosMixesFinales = [];
        for (const [mixId, m] of mixesMap.entries()) {
            const simpleIngId = mapMixToSimpleIngId.get(mixId) || mixId;
            const ingGranel = ingredientesMap.get(simpleIngId);
            const stockGranelKg = ingGranel ? parseFloat(ingGranel.stock_actual || 0) : 0;
            m.stock_granel_taller_kg = parseFloat(stockGranelKg.toFixed(1));

            // Secuencia en 2 fases: Verificar si el stock a granel en depósito cubre las fracciones
            m.tanda_kg = tandaKg;
            if (m.kilos_totales_solicitados <= 0) {
                m.granel_suficiente = true;
                m.kilos_faltantes_granel = 0;
                m.kilos_deficit_granel = 0;
                m.tandas_carro = 0;
                m.kilos_carro_sugeridos = 0;
                m.accion_taller = 'Stock comercial en rango';
                m.instruccion_operario = m.accion_taller;
            } else if (m.stock_granel_taller_kg >= m.kilos_totales_solicitados) {
                m.granel_suficiente = true;
                m.kilos_faltantes_granel = 0;
                m.kilos_deficit_granel = 0;
                m.tandas_carro = 0;
                m.kilos_carro_sugeridos = 0;
                m.accion_taller = `🟢 Granel suficiente en depósito (${m.stock_granel_taller_kg} kg disp.). Envasar directamente en fraccionamiento.`;
                m.instruccion_operario = m.accion_taller;
            } else {
                m.granel_suficiente = false;
                const deficitKg = m.kilos_totales_solicitados - m.stock_granel_taller_kg;
                m.kilos_faltantes_granel = parseFloat(deficitKg.toFixed(1));
                m.kilos_deficit_granel = m.kilos_faltantes_granel;
                const tandas = Math.max(1, Math.ceil(deficitKg / tandaKg));
                m.tandas_carro = tandas;
                m.kilos_carro_sugeridos = tandas * tandaKg;
                m.accion_taller = `🥣 Armar Carro de Mezcla: ${tandas} tanda(s) de ${tandaKg} kg = ${m.kilos_carro_sugeridos} kg (Déficit neto: ${m.kilos_faltantes_granel} kg, Granel disp: ${m.stock_granel_taller_kg} kg)`;
                m.instruccion_operario = m.accion_taller;

                // =============================================================
                // ABSORCIÓN TOTAL DEL CARRO: Distribuir excedente en presentaciones
                // Para que ningún kilo de mezcla quede huérfano en el artículo puente
                // y NUNCA dejar unidades sueltas de artículos hijos de pack (ej: 300g x 10)
                // =============================================================
                let kilosExcedentes = m.kilos_carro_sugeridos - m.kilos_totales_solicitados;
                if (kilosExcedentes < 0.8 && (m.stock_granel_taller_kg + m.kilos_carro_sugeridos - m.kilos_totales_solicitados) >= 1.0) {
                    kilosExcedentes = (m.stock_granel_taller_kg + m.kilos_carro_sugeridos) - m.kilos_totales_solicitados;
                }
                const presComerciales = m.presentaciones.filter(p => !p.articulo_id.includes('AP') && !p.articulo_id.endsWith('XK') && !p.es_padre && (p.kilos_unidad || 0) > 0);
                const presActivas = presComerciales.filter(p => (p.cantidad_sugerida || 0) > 0 || (!p.es_esporadico && (p.ventas_90d || 0) > 3));
                const candidatasAbsorcion = presActivas.length > 0 ? presActivas : presComerciales.filter(p => (p.cantidad_sugerida || 0) > 0);

                if (kilosExcedentes >= 0.8 && presComerciales.length > 0) {
                    // Ordenar candidatas: 1) Las que ya tienen sugerencia activa, 2) Menor cobertura, 3) Mayor rotación 90d, 4) Mayor peso por unidad
                    candidatasAbsorcion.sort((a, b) => {
                        const sugA = (a.cantidad_sugerida || 0) > 0 ? 1 : 0;
                        const sugB = (b.cantidad_sugerida || 0) > 0 ? 1 : 0;
                        if (sugA !== sugB) return sugB - sugA;
                        const cobDiff = (a.dias_cobertura || 0) - (b.dias_cobertura || 0);
                        if (Math.abs(cobDiff) > 0.5) return cobDiff;
                        const vDiff = (b.ventas_90d || 0) - (a.ventas_90d || 0);
                        if (vDiff !== 0) return vDiff;
                        return (b.kilos_unidad || 0) - (a.kilos_unidad || 0);
                    });

                    let iteraciones = 0;
                    while (kilosExcedentes >= 0.8 && iteraciones < 100) {
                        iteraciones++;
                        let asignado = false;
                        for (const art of candidatasAbsorcion) {
                            const uPack = (art.es_hijo || (art.pack_unidades && art.pack_unidades > 1)) ? (art.pack_unidades || 10) : 1;
                            const pesoLote = art.kilos_unidad * uPack;
                            if (pesoLote <= kilosExcedentes + 0.05) {
                                art.cantidad_sugerida = Math.round((art.cantidad_sugerida || 0) + uPack);
                                art.kilos_sugeridos = parseFloat((art.cantidad_sugerida * art.kilos_unidad).toFixed(1));
                                art.absorbe_excedente_puente = true;
                                kilosExcedentes -= pesoLote;
                                asignado = true;
                                if (kilosExcedentes < 0.8) break;
                            }
                        }
                        if (!asignado) {
                            // Si sobra por ej. 1 kg o 2 kg (como cuando se hacen 30 x 300g = 9 kg de un carro de 10 kg),
                            // absorber en presentaciones individuales sin pack (ej: bolsa de 1 kg o 2 kg) para dejar el artículo puente en 0 kg.
                            const presSinPack = presComerciales
                                .filter(p => !p.es_hijo && (p.pack_unidades || 1) <= 1 && p.kilos_unidad <= kilosExcedentes + 0.25)
                                .sort((a, b) => {
                                    // Preferir la presentación sin stock (stock=0) o la que calce exacto con el sobrante (ej: 1kg para 1kg sobrante)
                                    const calceA = Math.abs(kilosExcedentes - Math.round(kilosExcedentes / a.kilos_unidad) * a.kilos_unidad);
                                    const calceB = Math.abs(kilosExcedentes - Math.round(kilosExcedentes / b.kilos_unidad) * b.kilos_unidad);
                                    if (Math.abs(calceA - calceB) > 0.1) return calceA - calceB;
                                    if ((a.stock_actual || 0) !== (b.stock_actual || 0)) return (a.stock_actual || 0) - (b.stock_actual || 0);
                                    return a.kilos_unidad - b.kilos_unidad;
                                });

                            if (presSinPack.length > 0) {
                                const mejorIndividual = presSinPack[0];
                                const bolsasExtra = Math.max(1, Math.floor((kilosExcedentes + 0.15) / mejorIndividual.kilos_unidad));
                                mejorIndividual.cantidad_sugerida = Math.round((mejorIndividual.cantidad_sugerida || 0) + bolsasExtra);
                                mejorIndividual.kilos_sugeridos = parseFloat((mejorIndividual.cantidad_sugerida * mejorIndividual.kilos_unidad).toFixed(1));
                                mejorIndividual.es_fraccion_cierre_puente = true;
                                kilosExcedentes -= (bolsasExtra * mejorIndividual.kilos_unidad);
                            } else {
                                // Si sobra ej. 1 kg y el mix NO tiene bolsa de 1 kg (ej: Mix Salado solo tiene 300g, 2kg y 5kg):
                                // Rebalancear cambiando 1 bolsa de 5kg (+ 1kg sobrante = 6kg) por 3 bolsas de 2kg (6kg),
                                // o 1 pack de 10x300g (3kg + 1kg sobrante = 4kg) por 2 bolsas de 2kg (4kg).
                                const pres2kg = presComerciales.find(p => Math.abs((p.kilos_unidad || 0) - 2.0) < 0.1);
                                const pres5kgActiva = presComerciales.find(p => Math.abs((p.kilos_unidad || 0) - 5.0) < 0.1 && (p.cantidad_sugerida || 0) >= 1);
                                const presPack3kgActiva = presComerciales.find(p => Math.abs((p.kilos_unidad || 0) - 0.3) < 0.05 && (p.cantidad_sugerida || 0) >= 10);

                                if (pres2kg && Math.abs(kilosExcedentes - 1.0) < 0.3 && pres5kgActiva) {
                                    pres5kgActiva.cantidad_sugerida -= 1;
                                    pres5kgActiva.kilos_sugeridos = parseFloat((pres5kgActiva.cantidad_sugerida * pres5kgActiva.kilos_unidad).toFixed(1));
                                    pres2kg.cantidad_sugerida = Math.round((pres2kg.cantidad_sugerida || 0) + 3);
                                    pres2kg.kilos_sugeridos = parseFloat((pres2kg.cantidad_sugerida * pres2kg.kilos_unidad).toFixed(1));
                                    pres2kg.es_fraccion_cierre_puente = true;
                                    kilosExcedentes = 0;
                                } else if (pres2kg && Math.abs(kilosExcedentes - 1.0) < 0.3 && presPack3kgActiva) {
                                    presPack3kgActiva.cantidad_sugerida -= 10;
                                    presPack3kgActiva.kilos_sugeridos = parseFloat((presPack3kgActiva.cantidad_sugerida * presPack3kgActiva.kilos_unidad).toFixed(1));
                                    pres2kg.cantidad_sugerida = Math.round((pres2kg.cantidad_sugerida || 0) + 2);
                                    pres2kg.kilos_sugeridos = parseFloat((pres2kg.cantidad_sugerida * pres2kg.kilos_unidad).toFixed(1));
                                    pres2kg.es_fraccion_cierre_puente = true;
                                    kilosExcedentes = 0;
                                }
                            }
                            break;
                        }
                    }

                    // Recalcular kilos totales solicitados del mix tras absorber la tanda del carro
                    m.kilos_totales_solicitados = parseFloat(presComerciales.reduce((sum, p) => sum + (p.kilos_sugeridos || 0), 0).toFixed(1));
                }
            }

            // Propagar información determinista a cada presentación comercial
            m.presentaciones.forEach(art => {
                art.mix_granel_suficiente = m.granel_suficiente;
                art.mix_granel_disponible_kg = m.stock_granel_taller_kg;
                art.mix_carro_requerido_kg = m.kilos_carro_sugeridos;
                art.mix_tandas_requeridas = m.tandas_carro;
                if (m.granel_suficiente && art.cantidad_sugerida > 0) {
                    art.accion_requerida = `Envasar ${art.cantidad_sugerida} bolsas (Granel listo en depósito: ${m.stock_granel_taller_kg} kg)`;
                } else if (!m.granel_suficiente && art.cantidad_sugerida > 0) {
                    art.accion_requerida = `Envasar ${art.cantidad_sugerida} bolsas (Absorbe carro ${m.kilos_carro_sugeridos} kg)`;
                }
            });

            // Componentes de este mix en ingrediente_composicion
            const compRows = composicionMixRes.rows.filter(r => r.mix_id === mixId);
            const pesoTotalReceta = compRows.reduce((sum, r) => sum + parseFloat(r.cantidad || 0), 0);

            let factible = true;
            let cuelloBotella = null;
            let minKilosPosibles = 999999;

            const recetaPesaje = compRows.map(c => {
                const cant = parseFloat(c.cantidad || 0);
                const prop = pesoTotalReceta > 0 ? (cant / pesoTotalReceta) : 0;
                const baseCalculo = m.kilos_carro_sugeridos > 0 ? m.kilos_carro_sugeridos : tandaKg;
                const reqKg = parseFloat((baseCalculo * prop).toFixed(2));
                
                const ingComp = ingredientesMap.get(c.ingrediente_id);
                const potComp = potencialIngMap.get(c.ingrediente_id);
                const dispKg = ingComp && ingComp.stock_total_materia_prima_kg !== undefined
                    ? parseFloat(ingComp.stock_total_materia_prima_kg)
                    : (potComp ? parseFloat(potComp.potencial_total || 0) : (ingComp ? parseFloat(ingComp.stock_actual || 0) : 0));
                const alcanza = m.granel_suficiente || dispKg >= reqKg;

                const posiblesKg = prop > 0 ? (dispKg / prop) : 0;
                if (posiblesKg < minKilosPosibles) {
                    minKilosPosibles = posiblesKg;
                    cuelloBotella = ingComp ? ingComp.nombre : `Insumo #${c.ingrediente_id}`;
                }
                if (!alcanza && m.kilos_carro_sugeridos > 0) factible = false;

                return {
                    ingrediente_id: c.ingrediente_id,
                    componente_nombre: ingComp ? ingComp.nombre : `Insumo #${c.ingrediente_id}`,
                    proporcion_pct: (prop * 100).toFixed(1),
                    kilos_a_pesar: m.kilos_carro_sugeridos > 0 ? reqKg : 0,
                    kilos_referencia_tanda: reqKg,
                    stock_disponible_kg: parseFloat(dispKg.toFixed(1)),
                    alcanza: alcanza
                };
            });

            m.receta_pesaje = recetaPesaje;
            m.factibilidad = {
                factible: m.granel_suficiente || factible || m.kilos_carro_sugeridos === 0,
                cuello_botella: m.granel_suficiente ? null : cuelloBotella,
                kilos_max_posibles: parseFloat(minKilosPosibles.toFixed(1)),
                granel_suficiente: m.granel_suficiente
            };

            // Ordenar presentaciones por urgencia
            m.presentaciones.sort((a, b) => a.prioridad - b.prioridad);

            if (m.presentaciones.length > 0) {
                carrosMixesFinales.push(m);
            }
        }

        // Ordenar carros por urgencia máxima y kilos
        carrosMixesFinales.sort((a, b) => {
            if (a.urgencia_maxima !== b.urgencia_maxima) return a.urgencia_maxima - b.urgencia_maxima;
            return b.kilos_carro_sugeridos - a.kilos_carro_sugeridos;
        });

        // =====================================================================
        // PROPAGACIÓN DETERMINISTA: DEMANDA DERIVADA DE MIXES (LDN 3) A UP TOSTADERO (LDN 4)
        // Si un carro de mezcla requiere un insumo tostado y el stock terminado no alcanza,
        // se genera la orden de tostado externa en la UP con su despacho de bulto crudo correspondiente.
        // =====================================================================
        const deficitsTostadosMixes = new Map();
        carrosMixesFinales.forEach(c => {
            if (c.kilos_carro_sugeridos > 0 && !c.granel_suficiente) {
                (c.receta_pesaje || []).forEach(r => {
                    if (TOSTADOS_A_MATERIA_PRIMA_CRUDA.has(r.ingrediente_id) && !r.alcanza) {
                        const ingId = r.ingrediente_id;
                        if (!deficitsTostadosMixes.has(ingId)) {
                            deficitsTostadosMixes.set(ingId, {
                                requeridoTotal: 0,
                                disponible: r.stock_disponible_kg,
                                mixes: []
                            });
                        }
                        const entry = deficitsTostadosMixes.get(ingId);
                        entry.requeridoTotal += r.kilos_a_pesar;
                        entry.mixes.push(`${c.mix_nombre} (${r.kilos_a_pesar.toFixed(1)} kg)`);
                    }
                });
            }
        });

        for (const [ingId, data] of deficitsTostadosMixes.entries()) {
            const crudoInfo = TOSTADOS_A_MATERIA_PRIMA_CRUDA.get(ingId);
            const deficitKg = Math.max(0, data.requeridoTotal - data.disponible);
            if (deficitKg <= 0 || !crudoInfo) continue;

            // Buscar el artículo de UP correspondiente en ldn4_tostaderos
            let artTostadero = ldn4_tostaderos.find(a => 
                (crudoInfo.up_sku && a.articulo_id === crudoInfo.up_sku) ||
                (a.ingrediente_tostado_id === ingId && (a.articulo_id.includes('UP') || a.articulo_id.includes('PM')))
            );

            if (!artTostadero) {
                artTostadero = ldn4_tostaderos.find(a => a.ingrediente_tostado_id === ingId);
            }

            if (artTostadero) {
                const bultoKg = crudoInfo.bulto_kg || 10.0;
                const mermaPct = crudoInfo.merma_pct || 7.0;
                const rendimientoBulto = bultoKg * (1 - (mermaPct / 100));
                const bultosRequeridos = Math.max(1, Math.ceil(deficitKg / rendimientoBulto));
                const kgCrudosRequeridos = bultosRequeridos * bultoKg;
                const kgTostadosEsperados = parseFloat((bultosRequeridos * rendimientoBulto).toFixed(1));

                artTostadero.bultos_crudos_despachar = Math.max(artTostadero.bultos_crudos_despachar || 0, bultosRequeridos);
                artTostadero.kilos_crudos_requeridos = Math.max(artTostadero.kilos_crudos_requeridos || 0, kgCrudosRequeridos);
                artTostadero.kilos_tostados_sugeridos = Math.max(artTostadero.kilos_tostados_sugeridos || 0, kgTostadosEsperados);
                artTostadero.kilos_sugeridos = artTostadero.kilos_tostados_sugeridos;
                artTostadero.cantidad_sugerida = bultosRequeridos;
                artTostadero.estado_alarma = 'CRITICO';
                artTostadero.prioridad = 1;
                artTostadero.demanda_derivada_mixes = data.mixes;

                const stockCrudoDisp = artTostadero.stock_crudo_disponible_kg || 0;
                const crudoAlcanza = stockCrudoDisp >= artTostadero.kilos_crudos_requeridos;

                artTostadero.accion_requerida = `Despachar ${artTostadero.bultos_crudos_despachar} b. (${artTostadero.kilos_crudos_requeridos.toFixed(1)} kg de ${crudoInfo.nombre_crudo}) a Matías p/ abastecer: ${data.mixes.join(', ')}`;
                artTostadero.factibilidad = {
                    factible: crudoAlcanza,
                    detalle: crudoAlcanza
                        ? `Disponible en depósito: ${stockCrudoDisp.toFixed(1)} kg de ${crudoInfo.nombre_crudo} (Despacho: ${artTostadero.kilos_crudos_requeridos.toFixed(1)} kg)`
                        : `CRÍTICO: Stock crudo insuficiente (${stockCrudoDisp.toFixed(1)} kg de ${crudoInfo.nombre_crudo}). Comprar crudo antes de despachar a UP.`
                };
            }
        }

        // Ordenar plan semanal por prioridad (urgencia estricta de taller)
        todosArticulosEvaluados.sort((a, b) => {
            if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
            return a.dias_cobertura - b.dias_cobertura;
        });

        // Generar KPIs ejecutivos del Lunes
        const criticos = todosArticulosEvaluados.filter(a => a.estado_alarma === 'CRITICO' || a.estado_alarma === 'CRITICO_SIN_STOCK');
        const atencion = todosArticulosEvaluados.filter(a => a.estado_alarma === 'ATENCION');
        const optimos = todosArticulosEvaluados.filter(a => a.estado_alarma === 'OPTIMO');
        const sobreStock = todosArticulosEvaluados.filter(a => a.estado_alarma === 'SOBRE_STOCK');

        const sugerenciasInternas = todosArticulosEvaluados.filter(a => (a.ldn === 2 || a.ldn === 3) && a.cantidad_sugerida > 0);
        const sugerenciasExternas = todosArticulosEvaluados.filter(a => (a.ldn === 4 || a.ldn === 5 || a.ldn === 6) && a.cantidad_sugerida > 0);
        const sugerenciasCompras = todosArticulosEvaluados.filter(a => a.ldn === 1 && a.cantidad_sugerida > 0);

        const totalKilosSugeridosInternos = sugerenciasInternas.reduce((acc, a) => acc + a.kilos_sugeridos, 0);
        const totalKilosSugeridosExternos = sugerenciasExternas.reduce((acc, a) => acc + a.kilos_sugeridos, 0);

        // Sub-KPIs de Producción Interna (Puros vs Carros Mix)
        const fraccionadosPurosConSugerencia = ldn2_fraccionados.filter(a => a.cantidad_sugerida > 0);
        const totalKilosFraccionadosPuros = fraccionadosPurosConSugerencia.reduce((acc, a) => acc + a.kilos_sugeridos, 0);

        const carrosMixesConDemanda = carrosMixesFinales.filter(c => c.kilos_totales_solicitados > 0);
        const carrosMixesQueRequierenMezcla = carrosMixesFinales.filter(c => c.kilos_carro_sugeridos > 0);
        const carrosMixesGranelListo = carrosMixesFinales.filter(c => c.kilos_totales_solicitados > 0 && c.granel_suficiente);
        const totalKilosCarrosMixes = carrosMixesQueRequierenMezcla.reduce((acc, c) => acc + c.kilos_carro_sugeridos, 0);
        const carrosMixesListos = carrosMixesQueRequierenMezcla.filter(c => c.factibilidad.factible);
        const carrosMixesBloqueados = carrosMixesQueRequierenMezcla.filter(c => !c.factibilidad.factible);
        // ---------------------------------------------------------------------
        // UNIFICACIÓN DETERMINISTA: PRODUCCIÓN INTERNA TALLER (LDN 2 + LDN 3 + PACKS)
        // Agrupación canónica: LDN 2 Puros -> LDN 3 Mixes -> Packs Padre al final
        // Orden interno de cada grupo: Urgencia (Quiebres -> Críticos -> Atención) y Cantidad descendente
        // ---------------------------------------------------------------------
        const ldn3Comerciales = ldn3_mixes.filter(art => !art.articulo_id.includes('AP') && !art.articulo_id.endsWith('XK'));
        
        ldn3Comerciales.forEach(art => {
            if (!art.materia_prima_nombre) {
                art.materia_prima_nombre = art.mix_nombre || 'Mix Granel';
            }
            if (art.mix_granel_suficiente) {
                art.ubicacion_sugerida = `🟢 Granel listo en taller (${art.mix_granel_disponible_kg} kg disp.)`;
            } else if (art.mix_carro_requerido_kg > 0) {
                art.ubicacion_sugerida = `🥣 Requiere Carro de Mezcla (${art.mix_carro_requerido_kg} kg en ${art.mix_tandas_requeridas || 1} tanda/s)`;
            } else {
                art.ubicacion_sugerida = 'Granel en rango';
            }
        });

        const ordenarUrgenciaYCantidadBackend = (a, b) => {
            // 1. Apuro / Urgencia estricta
            const tieneAccionA = (a.cantidad_sugerida > 0 || (a.es_padre && a.packs_armables > 0) || a.comprometido_presupuestos > 0) ? 1 : 0;
            const tieneAccionB = (b.cantidad_sugerida > 0 || (b.es_padre && b.packs_armables > 0) || b.comprometido_presupuestos > 0) ? 1 : 0;
            if (tieneAccionA !== tieneAccionB) return tieneAccionB - tieneAccionA;

            if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;

            if ((a.stock_neto_disponible < 0) !== (b.stock_neto_disponible < 0)) {
                return (a.stock_neto_disponible < 0) ? -1 : 1;
            }

            // Pedidos comprometidos de clientes siempre van primero
            const compA = a.comprometido_presupuestos || 0;
            const compB = b.comprometido_presupuestos || 0;
            if ((compA > 0) !== (compB > 0)) {
                return (compB > 0) - (compA > 0);
            }

            // Si no hay pedidos comprometidos pendientes:
            // Artículos de ROTACIÓN SEMANAL REGULAR tienen prioridad sobre ESPORÁDICOS
            const semA = a.semanas_activas_90d || 0;
            const semB = b.semanas_activas_90d || 0;
            if ((semA >= 6) !== (semB >= 6)) {
                return (semB >= 6) ? 1 : -1;
            }

            // 2. Cantidad / Kilos descendente (de mayor a menor)
            const cantA = (a.kilos_sugeridos && a.kilos_sugeridos > 0) 
                ? a.kilos_sugeridos 
                : ((a.cantidad_sugerida || 0) * (a.kilos_unidad || 1)) || (a.packs_armables || 0);
            const cantB = (b.kilos_sugeridos && b.kilos_sugeridos > 0) 
                ? b.kilos_sugeridos 
                : ((b.cantidad_sugerida || 0) * (b.kilos_unidad || 1)) || (b.packs_armables || 0);
            if (cantB !== cantA) return cantB - cantA;

            // 3. Menor cobertura primero
            const cobA = a.dias_cobertura !== undefined ? a.dias_cobertura : 999;
            const cobB = b.dias_cobertura !== undefined ? b.dias_cobertura : 999;
            if (cobA !== cobB) return cobA - cobB;

            return (a.descripcion || '').localeCompare(b.descripcion || '');
        };

        const agruparYOrdenarPorIngredienteBackend = (items) => {
            if (!Array.isArray(items) || items.length === 0) return [];

            const gruposMap = new Map();
            items.forEach(art => {
                const rawMp = art.materia_prima_nombre || '';
                const mpKey = (rawMp.trim() !== '' && rawMp.trim() !== '-' && rawMp.trim() !== 'Insumo Puro')
                    ? rawMp.trim()
                    : (art.familia_nombre || 'General');

                if (!gruposMap.has(mpKey)) {
                    gruposMap.set(mpKey, []);
                }
                gruposMap.get(mpKey).push(art);
            });

            const calcularUrgenciaBackend = (art) => {
                // Pedidos comprometidos pendientes siempre tienen máxima urgencia
                if ((art.comprometido_presupuestos || 0) > 0 && (art.stock_neto_disponible !== undefined && art.stock_neto_disponible <= 0)) {
                    return 1;
                }
                // Si es esporádico (vende 1 vez cada 3 meses) y no tiene pedidos comprometidos:
                if (art.es_esporadico && (art.comprometido_presupuestos || 0) === 0) {
                    if (art.stock_actual <= 0 || art.estado_alarma === 'CRITICO_SIN_STOCK') {
                        return 3; // Nivel atención preventiva
                    }
                    return 4; // Óptimo
                }
                if (art.es_padre) {
                    return (art.packs_a_armar && art.packs_a_armar > 0) ? 2 : 4;
                }
                if (art.estado_alarma === 'CRITICO_SIN_STOCK' || 
                    (art.stock_neto_disponible !== undefined && art.stock_neto_disponible <= 0) ||
                    (art.stock_actual !== undefined && art.stock_actual <= 0)) {
                    return 1;
                }
                if (art.estado_alarma === 'CRITICO' || (art.dias_cobertura !== undefined && art.dias_cobertura <= 5)) {
                    return 2;
                }
                if (art.estado_alarma === 'ATENCION' || art.estado_alarma === 'ARMABLE_EN_DEPOSITO' || (art.dias_cobertura !== undefined && art.dias_cobertura <= 12)) {
                    return 3;
                }
                if (art.estado_alarma === 'OPTIMO') {
                    return 4;
                }
                return art.prioridad || 5;
            };

            const gruposArray = [];
            for (const [mpKey, artList] of gruposMap.entries()) {
                artList.sort((a, b) => {
                    const urgA = calcularUrgenciaBackend(a);
                    const urgB = calcularUrgenciaBackend(b);
                    if (urgA !== urgB) return urgA - urgB;

                    const kgUA = a.kilos_unidad || 0;
                    const kgUB = b.kilos_unidad || 0;
                    if (kgUB !== kgUA) return kgUB - kgUA;

                    return (b.kilos_sugeridos || 0) - (a.kilos_sugeridos || 0);
                });

                const urgMin = Math.min(...artList.map(a => calcularUrgenciaBackend(a)));
                const totalKg = artList.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);

                gruposArray.push({
                    materia_prima: mpKey,
                    items: artList,
                    urgencia_minima: urgMin,
                    total_kilos: totalKg
                });
            }

            gruposArray.sort((gA, gB) => {
                if (gA.urgencia_minima !== gB.urgencia_minima) {
                    return gA.urgencia_minima - gB.urgencia_minima;
                }
                if (gB.total_kilos !== gA.total_kilos) {
                    return gB.total_kilos - gA.total_kilos;
                }
                return gA.materia_prima.localeCompare(gB.materia_prima);
            });

            const resultadoPlano = [];
            gruposArray.forEach(g => {
                resultadoPlano.push(...g.items);
            });
            return resultadoPlano;
        };

        const ldn2SinPadre = agruparYOrdenarPorIngredienteBackend(ldn2_fraccionados.filter(a => !a.es_padre));
        const ldn3SinPadre = ldn3Comerciales.filter(a => !a.es_padre).sort(ordenarUrgenciaYCantidadBackend);
        const packsPadre = [...ldn2_fraccionados, ...ldn3Comerciales].filter(a => a.es_padre).sort(ordenarUrgenciaYCantidadBackend);

        const produccionInternaTaller = [...ldn2SinPadre, ...ldn3SinPadre, ...packsPadre];

        const itemsInternosConAccion = produccionInternaTaller.filter(a => a.cantidad_sugerida > 0 || (a.es_padre && (a.packs_a_armar || 0) > 0));
        const totalKilosProduccionInterna = itemsInternosConAccion.reduce((sum, a) => sum + (a.kilos_sugeridos || 0), 0);
        const quiebresInternos = produccionInternaTaller.filter(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || (a.stock_neto_disponible !== undefined ? a.stock_neto_disponible <= 0 : a.stock_actual <= 0));
        const criticosInternos = produccionInternaTaller.filter(a => a.estado_alarma === 'CRITICO');
        const packsArmablesCount = produccionInternaTaller.filter(a => a.es_padre && (a.packs_a_armar || 0) > 0).length;

        console.log(`✅ [PLANIFICACIÓN-LUNES] Análisis completado: ${todosArticulosEvaluados.length} artículos evaluados.`);
        console.log(`   - 🚨 Críticos: ${criticos.length} | 🟡 Atención: ${atencion.length} | 🟢 Óptimos: ${optimos.length}`);
        console.log(`   - 🏭 Producción Interna Taller: ${itemsInternosConAccion.length} a producir (${totalKilosProduccionInterna.toFixed(1)} kg) | ${carrosMixesQueRequierenMezcla.length} carros a mezclar`);
        console.log(`   - 🚚 Sugerencias Externas (LDN 4/5/6): ${sugerenciasExternas.length} (${totalKilosSugeridosExternos.toFixed(1)} kg)`);
        console.log(`   - 📦 Sugerencias Compras (LDN 1): ${sugerenciasCompras.length}`);

        return {
            success: true,
            timestamp: new Date().toISOString(),
            parametros: {
                ventana_dias_demanda: dias,
                dias_objetivo_cobertura: objetivo,
                tanda_mix_kg: tandaKg
            },
            resumen_kpi: {
                total_articulos: todosArticulosEvaluados.length,
                total_criticos: criticos.length,
                total_atencion: atencion.length,
                total_optimos: optimos.length,
                total_sobre_stock: sobreStock.length,
                sugerencias_internas_count: sugerenciasInternas.length,
                sugerencias_externas_count: sugerenciasExternas.length,
                sugerencias_compras_count: sugerenciasCompras.length,
                kilos_totales_internos: parseFloat(totalKilosSugeridosInternos.toFixed(1)),
                kilos_totales_externos: parseFloat(totalKilosSugeridosExternos.toFixed(1)),
                fraccionados_puros_count: fraccionadosPurosConSugerencia.length,
                kilos_fraccionados_puros: parseFloat(totalKilosFraccionadosPuros.toFixed(1)),
                carros_mixes_count: carrosMixesConDemanda.length,
                carros_mixes_requieren_mezcla_count: carrosMixesQueRequierenMezcla.length,
                carros_mixes_granel_suficiente_count: carrosMixesGranelListo.length,
                kilos_carros_mixes: parseFloat(totalKilosCarrosMixes.toFixed(1)),
                carros_mixes_listos: carrosMixesListos.length,
                carros_mixes_bloqueados: carrosMixesBloqueados.length,
                insumos_bloqueantes_count: insumosBloqueantesMap.size,
                
                // KPIs consolidados de Producción Interna Taller
                taller_items_a_producir: itemsInternosConAccion.length,
                taller_kilos_a_producir: parseFloat(totalKilosProduccionInterna.toFixed(1)),
                taller_quiebres_inmediatos: quiebresInternos.length,
                taller_criticos_semana: criticosInternos.length,
                taller_packs_armables: packsArmablesCount,
                taller_carros_a_mezclar: carrosMixesQueRequierenMezcla.length
            },
            insumos_bloqueantes: Array.from(insumosBloqueantesMap.values()),
            plan_semanal_priorizado: todosArticulosEvaluados,
            produccion_interna_taller: produccionInternaTaller,
            produccion_externa_ups: {
                resumen: {
                    total_items: sugerenciasExternas.length,
                    total_kilos_sugeridos: parseFloat(totalKilosSugeridosExternos.toFixed(1)),
                    kilos_crudos_a_despachar: parseFloat(ldn4_tostaderos.reduce((sum, a) => sum + (a.kilos_crudos_requeridos || 0), 0).toFixed(1)),
                    kilos_terminados_sugeridos: parseFloat(totalKilosSugeridosExternos.toFixed(1)),
                    quiebres_count: [...ldn4_tostaderos, ...ldn5_barritas, ...ldn6_granolas].filter(a => a.estado_alarma === 'CRITICO_SIN_STOCK' || a.stock_actual <= 0).length,
                    criticos_count: [...ldn4_tostaderos, ...ldn5_barritas, ...ldn6_granolas].filter(a => a.estado_alarma === 'CRITICO').length,
                    a_producir_count: sugerenciasExternas.length,
                    tostaderos_count: ldn4_tostaderos.length,
                    barritas_count: ldn5_barritas.length,
                    granolas_count: ldn6_granolas.length
                },
                items: [...ldn4_tostaderos, ...ldn5_barritas, ...ldn6_granolas].sort((a, b) => {
                    const actA = a.cantidad_sugerida > 0 ? 1 : 0;
                    const actB = b.cantidad_sugerida > 0 ? 1 : 0;
                    if (actA !== actB) return actB - actA;
                    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
                    return a.dias_cobertura - b.dias_cobertura;
                }),
                tostaderos: ldn4_tostaderos,
                barritas: ldn5_barritas,
                granolas: ldn6_granolas
            },
            lineas_de_negocio: {
                ldn1_directos: ldn1_directos,
                ldn2_fraccionados: ldn2_fraccionados,
                ldn3_mixes: ldn3_mixes,
                ldn4_tostaderos: ldn4_tostaderos,
                ldn5_barritas: ldn5_barritas,
                ldn6_granolas: ldn6_granolas
            },
            carros_mixes_detallados: carrosMixesFinales
        };

    } catch (error) {
        console.error('❌ [PLANIFICACIÓN-LUNES] Error generando diagnóstico:', error);
        throw error;
    }
}

/**
 * Genera el informe especializado para el Área de Compras a Proveedores.
 * Utiliza como base estadística las ventas del último trimestre (90 días) para capturar
 * clientes mensuales o recurrentes sin sesgo, y proyecta la cobertura para los próximos N días (por defecto 30).
 * 
 * @param {Object} params
 * @param {number} params.diasDemanda Ventana estadística hacia atrás (por defecto 90 días / trimestre)
 * @param {number} params.diasObjetivo Horizonte proyectado hacia adelante (por defecto 30 días / mes completo)
 * @param {boolean} params.soloFaltantes Si filtra únicamente ítems con necesidad de compra o en riesgo
 */
async function obtenerInformeComprasProveedores(params = {}, dbPool = null) {
    try {
        let diasDemanda = 90;
        let diasObjetivo = 30;
        let soloFaltantes = true;
        let poolConexion = null;

        if (typeof params === 'number') {
            diasDemanda = params;
            if (typeof dbPool === 'number') diasObjetivo = dbPool;
            poolConexion = pool;
        } else if (params && typeof params === 'object') {
            diasDemanda = params.diasDemanda || 90;
            diasObjetivo = params.diasObjetivo || 30;
            soloFaltantes = params.soloFaltantes !== undefined ? params.soloFaltantes : true;
            poolConexion = dbPool;
        }
        const db = poolConexion || pool;
        const dias = parseInt(diasDemanda) || 90;
        const objetivo = parseInt(diasObjetivo) || 30;

        console.log(`🛒 [INFORME-COMPRAS] Iniciando cálculo determinista MRP: Base ${dias} días (Trimestre) -> Proyección ${objetivo} días (Mes)`);

        // Ejecución paralela de las fuentes maestras
        const [articulosRes, ventasRes, ingsRes, compRes, recetasRes, presupuestosRes, diasHistoriaRes] = await Promise.all([
            // 1. Catálogo Búnker + Stock Consolidado (Físico Clampeado a 0 + Raw para Detección de Discrepancias + Disponibilidad en Listas + Stock Reservado y Disponible)
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
                )
                SELECT ba.articulo_id, ba.descripcion, ba.descripcion_generada, ba.costo_base,
                       COALESCE(ba.kilos_unidad, 1.0) AS kilos_unidad, ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades, ba.rubro,
                       -- Stock Físico (Consolidado) con Packs
                       CASE
                         WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                              AND COALESCE(ba.pack_unidades, 1) > 1
                         THEN
                           COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(ba.pack_unidades, 1))
                         ELSE
                           COALESCE(src.stock_consolidado, 0)
                       END AS stock_fisico,
                       -- Stock Reservado con Packs
                       CASE
                         WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                              AND COALESCE(ba.pack_unidades, 1) > 1
                         THEN
                           COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(ba.pack_unidades, 1)::numeric)
                         ELSE
                           COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
                       END AS stock_reservado,
                       -- Stock Disponible Real
                       CASE
                         WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                              AND COALESCE(ba.pack_unidades, 1) > 1
                         THEN
                           GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                           FLOOR(
                             GREATEST(0, 
                               COALESCE(src_hijo.stock_consolidado, 0) - (
                                 COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, 1))
                               )
                             ) / COALESCE(ba.pack_unidades, 1)
                           )
                         ELSE
                           GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                       END AS stock_disponible,
                       -- Stock Consolidado (disponible para compatibilidad)
                       CASE
                         WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL)
                              AND COALESCE(ba.pack_unidades, 1) > 1
                         THEN
                           GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                           FLOOR(
                             GREATEST(0, 
                               COALESCE(src_hijo.stock_consolidado, 0) - (
                                 COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, 1))
                               )
                             ) / COALESCE(ba.pack_unidades, 1)
                           )
                         ELSE
                           GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                       END AS stock_consolidado,
                       COALESCE(src.stock_consolidado, 0) AS stock_consolidado_raw,
                       EXISTS (SELECT 1 FROM public.recetas r WHERE r.articulo_numero = ba.articulo_id) AS tiene_receta,
                       EXISTS (
                           SELECT 1 
                           FROM public.bunker_lista_articulos bla 
                           JOIN public.bunker_listas_precios blp ON bla.lista_id = blp.id 
                           WHERE bla.articulo_numero = ba.articulo_id 
                             AND bla.disponible = true 
                             AND blp.activa = true
                       ) AS activa_en_listas
                FROM public.bunker_articulos ba
                LEFT JOIN public.articulos art ON ba.articulo_id = art.numero
                LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = ba.articulo_id OR src.codigo_barras = ba.articulo_id)
                LEFT JOIN public.stock_real_consolidado src_hijo ON (
                    src_hijo.articulo_numero = ba.pack_hijo_codigo
                    OR src_hijo.codigo_barras = ba.pack_hijo_codigo
                )
                LEFT JOIN reservas_crudas res_art ON (res_art.articulo_numero = ba.articulo_id)
                LEFT JOIN reservas_crudas res_hijo ON (res_hijo.articulo_numero = src_hijo.articulo_numero)
                LEFT JOIN LATERAL (
                    SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
                    FROM public.bunker_articulos bp
                    JOIN reservas_crudas rc_padre ON rc_padre.articulo_numero = bp.articulo_id
                    WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
                      AND (bp.pack_hijo_codigo = ba.articulo_id OR bp.pack_hijo_codigo = art.codigo_barras)
                ) res_padres ON true
                WHERE COALESCE(ba.familia_id, 0) != 46
            `),

            // 2. Ventas reales trimestrales comerciales a clientes (neteadas de devoluciones/NC)
            db.query(`
                SELECT articulo_numero, 
                       GREATEST(0, SUM(CASE WHEN tipo ILIKE '%ingreso%' THEN -ABS(cantidad) ELSE ABS(cantidad) END)) AS ventas_trimestre
                FROM public.stock_ventas_movimientos
                WHERE (
                    origen_ingreso ILIKE '%factura%'
                    OR (tipo ILIKE '%egreso%' 
                        AND origen_ingreso NOT IN ('abastecimiento_domicilio', 'mantenimiento') 
                        AND tipo NOT LIKE '%receta%')
                )
                  AND ($1 >= 999 OR fecha >= NOW() - ($1 || ' days')::interval)
                GROUP BY articulo_numero
            `, [dias]),

            // 3. Catálogo de Ingredientes y stocks con MULTICAPA INTEGRAL (Ingredientes Abiertos + Bultos Cerrados Ingredientes + Stock Satélite UP + Bultos Depósito)
            db.query(`
                SELECT i.id, i.nombre, i.unidad_medida, 
                       GREATEST(0, COALESCE(i.stock_actual, 0)) AS stock_fabrica_kg,
                       COALESCE(dest.cajas_disponibles, GREATEST(0, COALESCE(i.stock_bultos, 0))) AS bultos_taller,
                       COALESCE(dest.kilos_en_cajas, GREATEST(0, COALESCE(i.stock_bultos, 0)) * COALESCE(ba.kilos_unidad, 1.0)) AS kg_bultos_taller,
                       GREATEST(0, COALESCE(sat.stock_satelite_kg, 0)) AS stock_satelite_kg,
                       sku_resuelto.sku AS articulo_vinculado_numero, ba.descripcion_generada AS bulto_desc, ba.costo_base AS bulto_costo,
                       COALESCE(ba.kilos_unidad, 1.0) AS kilos_por_bulto, 
                       GREATEST(0, COALESCE(src.stock_consolidado, 0)) AS bultos_deposito,
                       COALESCE(src.stock_consolidado, 0) AS bultos_deposito_raw
                FROM public.ingredientes i
                LEFT JOIN LATERAL (
                    SELECT COALESCE(
                        i.articulo_vinculado_numero,
                        (
                            SELECT svm.articulo_numero
                            FROM public.stock_ventas_movimientos svm
                            JOIN public.ingredientes_movimientos im 
                              ON substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') = substring(im.observaciones from 'UUID: ([a-f0-9\\-]+)')
                             AND substring(svm.observaciones from 'UUID: ([a-f0-9\\-]+)') IS NOT NULL
                            WHERE im.ingrediente_id = i.id
                              AND svm.articulo_numero IS NOT NULL
                              AND EXISTS (SELECT 1 FROM public.bunker_articulos ba2 WHERE UPPER(TRIM(ba2.articulo_id)) = UPPER(TRIM(svm.articulo_numero)))
                            ORDER BY svm.fecha DESC
                            LIMIT 1
                        ),
                        (
                            SELECT svm.articulo_numero
                            FROM public.stock_ventas_movimientos svm
                            JOIN public.ingredientes_stock_usuarios isu
                              ON svm.carro_id = isu.origen_carro_id AND svm.usuario_id = isu.usuario_id
                            WHERE isu.ingrediente_id = i.id
                              AND svm.articulo_numero IS NOT NULL
                              AND EXISTS (SELECT 1 FROM public.bunker_articulos ba3 WHERE UPPER(TRIM(ba3.articulo_id)) = UPPER(TRIM(svm.articulo_numero)))
                            ORDER BY svm.fecha DESC
                            LIMIT 1
                        )
                    ) AS sku
                ) sku_resuelto ON TRUE
                LEFT JOIN (
                    SELECT d.destino_id, 
                           SUM(d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) AS cajas_disponibles,
                           SUM((d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) * (COALESCE(d.kilos_asignados, 0) / NULLIF(d.cantidad_asignada, 0))) AS kilos_en_cajas
                    FROM public.bunker_lotes_destinos d
                    WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' 
                      AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                    GROUP BY d.destino_id
                ) dest ON dest.destino_id = i.id::text
                LEFT JOIN (
                    SELECT isu.ingrediente_id,
                           SUM(isu.cantidad) AS stock_satelite_kg
                    FROM public.ingredientes_stock_usuarios isu
                    GROUP BY isu.ingrediente_id
                ) sat ON sat.ingrediente_id = i.id
                LEFT JOIN public.bunker_articulos ba ON UPPER(TRIM(ba.articulo_id)) = UPPER(TRIM(sku_resuelto.sku))
                LEFT JOIN public.stock_real_consolidado src ON UPPER(TRIM(src.articulo_numero)) = UPPER(TRIM(sku_resuelto.sku))
                WHERE i.es_insumo = FALSE
            `),

            // 4. Composición de mezclas
            db.query(`
                SELECT mix_id, ingrediente_id AS componente_id, cantidad AS cantidad_componente
                FROM public.ingrediente_composicion
            `),

            // 5. Recetas de productos comerciales
            db.query(`
                SELECT r.articulo_numero, ri.ingrediente_id, ri.cantidad AS cantidad_en_receta
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            `),

            // 6. Presupuestos Activos (Demanda Comprometida / Backlog real pendiente de armado)
            db.query(`
                SELECT 
                    COALESCE(ba.articulo_id, a.numero, pd.articulo) AS articulo_numero,
                    SUM(pd.cantidad) AS cantidad_comprometida,
                    COUNT(DISTINCT p.id) AS presupuestos_cant
                FROM public.presupuestos p
                JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
                LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero OR ba.articulo_id = pd.articulo
                WHERE p.activo = true
                  AND COALESCE(p.archivado, false) = false
                  AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
                  AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
                  AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
                  AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
                  AND p.factura_id IS NULL
                  AND p.id_factura_lomasoft IS NULL
                  AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
                GROUP BY COALESCE(ba.articulo_id, a.numero, pd.articulo)
            `),

            // 7. Días de historia real en BD (para ventana de "Todas las facturas")
            db.query(`
                SELECT GREATEST(30, ROUND(EXTRACT(DAY FROM NOW() - MIN(fecha)))) AS dias_historia_bd
                FROM public.stock_ventas_movimientos
                WHERE fecha IS NOT NULL
            `)
        ]);

        const diasHistoriaBd = (diasHistoriaRes && diasHistoriaRes.rows && diasHistoriaRes.rows[0]) ? (parseInt(diasHistoriaRes.rows[0].dias_historia_bd) || 365) : 365;
        const diasEfectivos = dias >= 999 ? diasHistoriaBd : dias;

        // Mapear presupuestos activos comprometidos por SKU
        const presupuestosMap = new Map();
        presupuestosRes.rows.forEach(r => {
            if (r.articulo_numero) {
                presupuestosMap.set(r.articulo_numero.trim().toUpperCase(), parseFloat(r.cantidad_comprometida || 0));
            }
        });

        // Mapear ventas trimestrales por SKU
        const ventasMap = new Map();
        ventasRes.rows.forEach(r => {
            if (r.articulo_numero) ventasMap.set(r.articulo_numero.trim().toUpperCase(), parseFloat(r.ventas_trimestre || 0));
        });

        // Mapear catálogo de Búnker (clave en mayúsculas)
        const bunkerMap = new Map();
        articulosRes.rows.forEach(r => bunkerMap.set(r.articulo_id.trim().toUpperCase(), r));

        // Mapear ingredientes (con bultos alternativos equivalentes)
        const ingsMap = new Map();
        ingsRes.rows.forEach(r => {
            if (INGREDIENTES_BULTO_ALTERNATIVO_MAP.has(r.id)) {
                const altSkus = INGREDIENTES_BULTO_ALTERNATIVO_MAP.get(r.id) || [];
                altSkus.forEach(altSku => {
                    if ((r.articulo_vinculado_numero || '').toUpperCase() === altSku.toUpperCase()) return;
                    const altArt = bunkerMap.get(altSku.toUpperCase());
                    if (altArt) {
                        const altDepo = Math.max(0, parseFloat(altArt.stock_consolidado_raw || altArt.stock_fisico || 0));
                        const altKgBulto = parseFloat(altArt.kilos_unidad || 1.0) > 0 ? parseFloat(altArt.kilos_unidad) : 1.0;
                        if (altDepo > 0) {
                            if (parseFloat(r.bultos_deposito || 0) <= 0) {
                                r.articulo_vinculado_numero = altArt.articulo_id;
                                r.bulto_desc = altArt.descripcion_generada || altArt.descripcion;
                                r.bulto_costo = altArt.costo_base;
                                r.kilos_por_bulto = altKgBulto;
                            }
                            r.bultos_deposito = parseFloat(r.bultos_deposito || 0) + altDepo;
                            r.bultos_deposito_raw = parseFloat(r.bultos_deposito_raw || 0) + altDepo;
                        }
                    }
                });
            }
            ingsMap.set(r.id, r);
        });

        // Mapear composición de mezclas
        const mixComposicionMap = new Map();
        compRes.rows.forEach(r => {
            if (!mixComposicionMap.has(r.mix_id)) mixComposicionMap.set(r.mix_id, []);
            mixComposicionMap.get(r.mix_id).push({
                componente_id: r.componente_id,
                cantidad: parseFloat(r.cantidad_componente || 0)
            });
        });

        // Mapeo determinista de tostados / UP a su materia prima cruda comprada a proveedor (con merma de tostado)
        const tostadosAMateriaPrimaCruda = TOSTADOS_A_MATERIA_PRIMA_CRUDA;

        // Mapeo de artículos terminados de UP a sus mezclas base
        const upProductosAMezclas = new Map([
            [141, 109], // Barrita 20x50 -> Mezcla Barrita
            [122, 134], // Grana de Flor -> Mezcla Grana de Flor
            [131, 132]  // Grana de Sol -> Mezcla Grana de Sol
        ]);

        // Diccionario de vinculación para ingredientes sin SKU asignado en tabla maestra
        const ingredientesSinVinculoMap = INGREDIENTES_SIN_VINCULO_MAP;

        // -------------------------------------------------------------------------
        // PRE-CÁLCULO: CAPA 1 - STOCK EN PRODUCTOS TERMINADOS FRACCIONADOS (DEPÓSITO)
        // Despiece inverso recursivo multicapa con DESCUENTO DE PRESUPUESTOS ACTIVOS (Backlog)
        // -------------------------------------------------------------------------
        const stockTerminadoNetoPorSkuKg = new Map();
        const stockTerminadoNetoPorIngKg = new Map();
        const deficitComprometidoPorSkuKg = new Map();
        const deficitComprometidoPorIngKg = new Map();

        function acumularTerminadoYComprometido(sku, ingId, kgTerminadoNeto, kgDeficitInmediato) {
            if (sku) {
                const k = sku.trim().toUpperCase();
                if (kgTerminadoNeto > 0) {
                    stockTerminadoNetoPorSkuKg.set(k, (stockTerminadoNetoPorSkuKg.get(k) || 0) + kgTerminadoNeto);
                }
                if (kgDeficitInmediato > 0) {
                    deficitComprometidoPorSkuKg.set(k, (deficitComprometidoPorSkuKg.get(k) || 0) + kgDeficitInmediato);
                }
            }
            if (ingId) {
                if (kgTerminadoNeto > 0) {
                    stockTerminadoNetoPorIngKg.set(ingId, (stockTerminadoNetoPorIngKg.get(ingId) || 0) + kgTerminadoNeto);
                }
                if (kgDeficitInmediato > 0) {
                    deficitComprometidoPorIngKg.set(ingId, (deficitComprometidoPorIngKg.get(ingId) || 0) + kgDeficitInmediato);
                }
            }
        }

        recetasRes.rows.forEach(rec => {
            const artSku = (rec.articulo_numero || '').trim().toUpperCase();
            const art = bunkerMap.get(artSku);
            if (!art) return;

            const stockFisico = parseFloat(art.stock_fisico !== undefined ? art.stock_fisico : (art.stock_consolidado || 0));
            const comprometido = parseFloat(art.stock_reservado !== undefined ? art.stock_reservado : (presupuestosMap.get(artSku) || 0));
            const stockNeto = stockFisico - comprometido;

            const cantEnReceta = parseFloat(rec.cantidad_en_receta || 0);
            const kgTerminadoNeto = stockNeto > 0 ? stockNeto * cantEnReceta : 0;
            const kgDeficitInmediato = stockNeto < 0 ? Math.abs(stockNeto) * cantEnReceta : 0;

            if (kgTerminadoNeto <= 0 && kgDeficitInmediato <= 0) return;

            let ingId = rec.ingrediente_id;

            // LDN 5 & 6: Producto de UP a mezcla base
            if (upProductosAMezclas.has(ingId)) {
                ingId = upProductosAMezclas.get(ingId);
            }

            // LDN 4: Ingrediente Tostado -> Materia prima cruda con merma
            if (tostadosAMateriaPrimaCruda.has(ingId)) {
                const infoTost = tostadosAMateriaPrimaCruda.get(ingId);
                acumularTerminadoYComprometido(infoTost.crudo_sku, null, kgTerminadoNeto * infoTost.merma, kgDeficitInmediato * infoTost.merma);
                return;
            }

            // LDN 3: Mezcla interna -> Desglose en sus componentes
            if (mixComposicionMap.has(ingId)) {
                const componentes = mixComposicionMap.get(ingId);
                const totalKgMix = componentes.reduce((acc, c) => acc + c.cantidad, 0) || 1.0;
                componentes.forEach(comp => {
                    const fraccion = comp.cantidad / totalKgMix;
                    const compKgTerminado = kgTerminadoNeto * fraccion;
                    const compKgDeficit = kgDeficitInmediato * fraccion;
                    let compIngId = comp.componente_id;

                    if (tostadosAMateriaPrimaCruda.has(compIngId)) {
                        const infoTost = tostadosAMateriaPrimaCruda.get(compIngId);
                        acumularTerminadoYComprometido(infoTost.crudo_sku, null, compKgTerminado * infoTost.merma, compKgDeficit * infoTost.merma);
                        return;
                    }

                    const compIng = ingsMap.get(compIngId);
                    if (compIng) {
                        let skuVinculado = compIng.articulo_vinculado_numero || ingredientesSinVinculoMap.get(compIngId);
                        acumularTerminadoYComprometido(skuVinculado, compIngId, compKgTerminado, compKgDeficit);
                    }
                });
                return;
            }

            // LDN 2: Fraccionado puro mono-ingrediente
            const ingSimple = ingsMap.get(ingId);
            if (ingSimple) {
                let skuVinculado = ingSimple.articulo_vinculado_numero || ingredientesSinVinculoMap.get(ingId);
                acumularTerminadoYComprometido(skuVinculado, ingId, kgTerminadoNeto, kgDeficitInmediato);
            }
        });

        // Bolsa consolidada MRP de materias primas y bultos directos a pedir a proveedores
        const comprasMRP = new Map();

        function registrarDemandaItemCompra({ 
            sku, ingId, descripcion, rubro, kilosPorBulto, 
            stockDepositoBultos, depositoNegativoRaw,
            stockTallerBultos, stockTallerBultosKg, stockSateliteKg, stockFabricaKg, stockTerminadoKg,
            deficitComprometidoKg,
            costoUnitario, consumoKgDiario, productoOrigen, tipoOrigen, nombreIngredienteFabrica 
        }) {
            const clave = sku ? sku.toUpperCase() : `ING-${ingId}`;
            if (!comprasMRP.has(clave)) {
                comprasMRP.set(clave, {
                    clave: clave,
                    sku: sku || 'S/VINCULO',
                    ing_id: ingId || null,
                    descripcion: descripcion,
                    nombre_ingrediente_fabrica: nombreIngredienteFabrica || null,
                    rubro: rubro || 'Materias Primas',
                    tipo_origen: tipoOrigen,
                    kilos_por_bulto: kilosPorBulto || 1.0,
                    stock_deposito_bultos: stockDepositoBultos || 0,
                    deposito_negativo_raw: depositoNegativoRaw || 0,
                    stock_taller_bultos: stockTallerBultos || 0,
                    stock_taller_bultos_kg: stockTallerBultosKg || 0,
                    stock_satelite_kg: stockSateliteKg || 0,
                    stock_fabrica_kg: stockFabricaKg || 0,
                    stock_terminado_kg: stockTerminadoKg || 0,
                    stockTerminadoKg: stockTerminadoKg || 0,
                    deficit_comprometido_kg: deficitComprometidoKg || 0,
                    costo_unitario: costoUnitario || 0,
                    consumo_diario_kg: 0,
                    demanda_independiente_kg: 0,
                    demanda_dependiente_kg: 0,
                    productos_afectados: new Set()
                });
            } else {
                const itemExistente = comprasMRP.get(clave);
                if (stockTerminadoKg && (!itemExistente.stock_terminado_kg || itemExistente.stock_terminado_kg === 0)) {
                    itemExistente.stock_terminado_kg = stockTerminadoKg;
                    itemExistente.stockTerminadoKg = stockTerminadoKg;
                }
                if (deficitComprometidoKg && deficitComprometidoKg > (itemExistente.deficit_comprometido_kg || 0)) {
                    itemExistente.deficit_comprometido_kg = deficitComprometidoKg;
                }
                if (stockTallerBultosKg && itemExistente.stock_taller_bultos_kg === 0) {
                    itemExistente.stock_taller_bultos = stockTallerBultos;
                    itemExistente.stock_taller_bultos_kg = stockTallerBultosKg;
                }
                if (stockSateliteKg && itemExistente.stock_satelite_kg === 0) {
                    itemExistente.stock_satelite_kg = stockSateliteKg;
                }
                if (stockFabricaKg && itemExistente.stock_fabrica_kg === 0) {
                    itemExistente.stock_fabrica_kg = stockFabricaKg;
                }
                if (depositoNegativoRaw < 0) {
                    itemExistente.deposito_negativo_raw = depositoNegativoRaw;
                }
            }
            const item = comprasMRP.get(clave);
            item.consumo_diario_kg += (consumoKgDiario || 0);
            if (deficitComprometidoKg && deficitComprometidoKg > (item.deficit_comprometido_kg || 0)) {
                item.deficit_comprometido_kg = deficitComprometidoKg;
            }
            if (tipoOrigen === 'LDN 1 (Bulto Directo)') {
                item.demanda_independiente_kg += consumoKgDiario;
            } else {
                item.demanda_dependiente_kg += consumoKgDiario;
            }
            if (productoOrigen) {
                item.productos_afectados.add(productoOrigen);
            }
        }

        // -------------------------------------------------------------------------
        // PASO 1: DEMANDA DEPENDIENTE (DESPIECE RECURSIVO DE RECETAS A MATERIAS PRIMAS)
        // -------------------------------------------------------------------------
        recetasRes.rows.forEach(row => {
            const artSku = (row.articulo_numero || '').trim().toUpperCase();
            const ventas = ventasMap.get(artSku) || 0;
            if (ventas <= 0) return;

            const ddp = ventas / diasEfectivos;
            let ingId = row.ingrediente_id;
            let cantKg = ddp * parseFloat(row.cantidad_en_receta || 0);

            // A. Producto de UP -> Traducir a su mezcla base
            if (upProductosAMezclas.has(ingId)) {
                ingId = upProductosAMezclas.get(ingId);
            }

            // B. Ingrediente tostado de UP -> Traducir a bulto de materia prima cruda con merma
            if (tostadosAMateriaPrimaCruda.has(ingId)) {
                const infoTost = tostadosAMateriaPrimaCruda.get(ingId);
                const bultoCrudo = bunkerMap.get(infoTost.crudo_sku);
                const kgCrudoRequerido = cantKg * infoTost.merma;

                if (bultoCrudo) {
                    const ingDeCrudo = ingsRes.rows.find(i => {
                        const v = i.articulo_vinculado_numero || ingredientesSinVinculoMap.get(i.id);
                        return v && v.trim().toUpperCase() === infoTost.crudo_sku.trim().toUpperCase();
                    });
                    const termKg = (infoTost.crudo_sku ? stockTerminadoNetoPorSkuKg.get(infoTost.crudo_sku.trim().toUpperCase()) : 0) || 0;
                    const defKg = (infoTost.crudo_sku ? deficitComprometidoPorSkuKg.get(infoTost.crudo_sku.trim().toUpperCase()) : 0) || 0;
                    registrarDemandaItemCompra({
                        sku: infoTost.crudo_sku,
                        descripcion: bultoCrudo.descripcion_generada || bultoCrudo.descripcion,
                        rubro: bultoCrudo.rubro,
                        kilosPorBulto: parseFloat(bultoCrudo.kilos_unidad || 1.0),
                        stockDepositoBultos: parseFloat(bultoCrudo.stock_consolidado || 0),
                        depositoNegativoRaw: parseFloat(bultoCrudo.stock_consolidado_raw || 0),
                        stockTallerBultos: ingDeCrudo ? parseFloat(ingDeCrudo.bultos_taller || 0) : 0,
                        stockTallerBultosKg: ingDeCrudo ? parseFloat(ingDeCrudo.kg_bultos_taller || 0) : 0,
                        stockSateliteKg: ingDeCrudo ? parseFloat(ingDeCrudo.stock_satelite_kg || 0) : 0,
                        stockFabricaKg: ingDeCrudo ? parseFloat(ingDeCrudo.stock_fabrica_kg || 0) : 0,
                        stockTerminadoKg: termKg,
                        deficitComprometidoKg: defKg,
                        costoUnitario: parseFloat(bultoCrudo.costo_base || 0),
                        consumoKgDiario: kgCrudoRequerido,
                        productoOrigen: artSku,
                        tipoOrigen: 'LDN 2-6 (Materia Prima)',
                        nombreIngredienteFabrica: infoTost.nombre_crudo
                    });
                }
                return;
            }

            // C. Mezcla interna -> Desglose proporcional de sus ingredientes
            if (mixComposicionMap.has(ingId)) {
                const componentes = mixComposicionMap.get(ingId);
                const totalKgMix = componentes.reduce((acc, c) => acc + c.cantidad, 0) || 1.0;

                componentes.forEach(comp => {
                    const fraccion = comp.cantidad / totalKgMix;
                    const kgCompDiario = cantKg * fraccion;
                    let compIngId = comp.componente_id;

                    // Si el componente de la mezcla es un ingrediente tostado
                    if (tostadosAMateriaPrimaCruda.has(compIngId)) {
                        const infoTost = tostadosAMateriaPrimaCruda.get(compIngId);
                        const bultoCrudo = bunkerMap.get(infoTost.crudo_sku);
                        if (bultoCrudo) {
                            const ingDeCrudo = ingsRes.rows.find(i => {
                                const v = i.articulo_vinculado_numero || ingredientesSinVinculoMap.get(i.id);
                                return v && v.trim().toUpperCase() === infoTost.crudo_sku.trim().toUpperCase();
                            });
                            const termKg = (infoTost.crudo_sku ? stockTerminadoNetoPorSkuKg.get(infoTost.crudo_sku.trim().toUpperCase()) : 0) || 0;
                            const defKg = (infoTost.crudo_sku ? deficitComprometidoPorSkuKg.get(infoTost.crudo_sku.trim().toUpperCase()) : 0) || 0;
                            registrarDemandaItemCompra({
                                sku: infoTost.crudo_sku,
                                descripcion: bultoCrudo.descripcion_generada || bultoCrudo.descripcion,
                                rubro: bultoCrudo.rubro,
                                kilosPorBulto: parseFloat(bultoCrudo.kilos_unidad || 1.0),
                                stockDepositoBultos: parseFloat(bultoCrudo.stock_consolidado || 0),
                                depositoNegativoRaw: parseFloat(bultoCrudo.stock_consolidado_raw || 0),
                                stockTallerBultos: ingDeCrudo ? parseFloat(ingDeCrudo.bultos_taller || 0) : 0,
                                stockTallerBultosKg: ingDeCrudo ? parseFloat(ingDeCrudo.kg_bultos_taller || 0) : 0,
                                stockSateliteKg: ingDeCrudo ? parseFloat(ingDeCrudo.stock_satelite_kg || 0) : 0,
                                stockFabricaKg: ingDeCrudo ? parseFloat(ingDeCrudo.stock_fabrica_kg || 0) : 0,
                                stockTerminadoKg: termKg,
                                deficitComprometidoKg: defKg,
                                costoUnitario: parseFloat(bultoCrudo.costo_base || 0),
                                consumoKgDiario: kgCompDiario * infoTost.merma,
                                productoOrigen: artSku,
                                tipoOrigen: 'LDN 2-6 (Materia Prima)',
                                nombreIngredienteFabrica: infoTost.nombre_crudo
                            });
                        }
                        return;
                    }

                    // Insumo directo de la mezcla
                    const compIng = ingsMap.get(compIngId);
                    if (compIng) {
                        let skuVinculado = compIng.articulo_vinculado_numero;
                        if (!skuVinculado && ingredientesSinVinculoMap.has(compIngId)) {
                            skuVinculado = ingredientesSinVinculoMap.get(compIngId);
                        }
                        const bultoBunker = skuVinculado ? bunkerMap.get(skuVinculado.trim().toUpperCase()) : null;
                        const bultoDesc = bultoBunker ? (bultoBunker.descripcion_generada || bultoBunker.descripcion) : compIng.nombre;

                        // Descartar categóricamente cualquier AP o mezcla que intente colarse
                        const texto = `${skuVinculado || ''} ${bultoDesc} ${compIng.nombre}`.toUpperCase();
                        const esIntermedio = texto.includes('PROD AP') || texto.includes('PROD UP') || texto.includes('MEZCLA') || texto.includes('MIX');
                        if (!esIntermedio) {
                            const kgPorBulto = bultoBunker ? parseFloat(bultoBunker.kilos_unidad || 1.0) : parseFloat(compIng.kilos_por_bulto || 1.0);
                            const stockBultos = bultoBunker ? parseFloat(bultoBunker.stock_consolidado || 0) : parseFloat(compIng.bultos_deposito || 0);
                            const rawDep = bultoBunker ? parseFloat(bultoBunker.stock_consolidado_raw || 0) : parseFloat(compIng.bultos_deposito_raw || 0);
                            const costo = bultoBunker ? parseFloat(bultoBunker.costo_base || 0) : parseFloat(compIng.bulto_costo || 0);
                            const termKg = (skuVinculado ? stockTerminadoNetoPorSkuKg.get(skuVinculado.trim().toUpperCase()) : 0) || (compIngId ? stockTerminadoNetoPorIngKg.get(compIngId) : 0) || 0;
                            const defKg = (skuVinculado ? deficitComprometidoPorSkuKg.get(skuVinculado.trim().toUpperCase()) : 0) || (compIngId ? deficitComprometidoPorIngKg.get(compIngId) : 0) || 0;

                            registrarDemandaItemCompra({
                                sku: skuVinculado ? skuVinculado.trim().toUpperCase() : null,
                                ingId: compIngId,
                                descripcion: bultoDesc,
                                rubro: bultoBunker ? bultoBunker.rubro : 'Materias Primas',
                                kilosPorBulto: kgPorBulto,
                                stockDepositoBultos: stockBultos,
                                depositoNegativoRaw: rawDep,
                                stockTallerBultos: parseFloat(compIng.bultos_taller || 0),
                                stockTallerBultosKg: parseFloat(compIng.kg_bultos_taller || 0),
                                stockSateliteKg: parseFloat(compIng.stock_satelite_kg || 0),
                                stockFabricaKg: parseFloat(compIng.stock_fabrica_kg || 0),
                                stockTerminadoKg: termKg,
                                deficitComprometidoKg: defKg,
                                costoUnitario: costo,
                                consumoKgDiario: kgCompDiario,
                                productoOrigen: artSku,
                                tipoOrigen: 'LDN 2-6 (Materia Prima)',
                                nombreIngredienteFabrica: compIng.nombre
                            });
                        }
                    }
                });
                return;
            }

            // D. Ingrediente mono-ingrediente directo
            const ingSimple = ingsMap.get(ingId);
            if (ingSimple) {
                let skuVinculado = ingSimple.articulo_vinculado_numero;
                if (!skuVinculado && ingredientesSinVinculoMap.has(ingId)) {
                    skuVinculado = ingredientesSinVinculoMap.get(ingId);
                }
                const bultoBunker = skuVinculado ? bunkerMap.get(skuVinculado.trim().toUpperCase()) : null;
                const bultoDesc = bultoBunker ? (bultoBunker.descripcion_generada || bultoBunker.descripcion) : ingSimple.nombre;

                const texto = `${skuVinculado || ''} ${bultoDesc} ${ingSimple.nombre}`.toUpperCase();
                const esIntermedio = texto.includes('PROD AP') || texto.includes('PROD UP') || texto.includes('MEZCLA') || texto.includes('MIX');
                if (!esIntermedio) {
                    const kgPorBulto = bultoBunker ? parseFloat(bultoBunker.kilos_unidad || 1.0) : parseFloat(ingSimple.kilos_por_bulto || 1.0);
                    const stockBultos = bultoBunker ? parseFloat(bultoBunker.stock_consolidado || 0) : parseFloat(ingSimple.bultos_deposito || 0);
                    const rawDep = bultoBunker ? parseFloat(bultoBunker.stock_consolidado_raw || 0) : parseFloat(ingSimple.bultos_deposito_raw || 0);
                    const costo = bultoBunker ? parseFloat(bultoBunker.costo_base || 0) : parseFloat(ingSimple.bulto_costo || 0);
                    const termKg = (skuVinculado ? stockTerminadoNetoPorSkuKg.get(skuVinculado.trim().toUpperCase()) : 0) || (ingId ? stockTerminadoNetoPorIngKg.get(ingId) : 0) || 0;
                    const defKg = (skuVinculado ? deficitComprometidoPorSkuKg.get(skuVinculado.trim().toUpperCase()) : 0) || (ingId ? deficitComprometidoPorIngKg.get(ingId) : 0) || 0;

                    registrarDemandaItemCompra({
                        sku: skuVinculado ? skuVinculado.trim().toUpperCase() : null,
                        ingId: ingId,
                        descripcion: bultoDesc,
                        rubro: bultoBunker ? bultoBunker.rubro : 'Materias Primas',
                        kilosPorBulto: kgPorBulto,
                        stockDepositoBultos: stockBultos,
                        depositoNegativoRaw: rawDep,
                        stockTallerBultos: parseFloat(ingSimple.bultos_taller || 0),
                        stockTallerBultosKg: parseFloat(ingSimple.kg_bultos_taller || 0),
                        stockSateliteKg: parseFloat(ingSimple.stock_satelite_kg || 0),
                        stockFabricaKg: parseFloat(ingSimple.stock_fabrica_kg || 0),
                        stockTerminadoKg: termKg,
                        deficitComprometidoKg: defKg,
                        costoUnitario: costo,
                        consumoKgDiario: cantKg,
                        productoOrigen: artSku,
                        tipoOrigen: 'LDN 2-6 (Materia Prima)',
                        nombreIngredienteFabrica: ingSimple.nombre
                    });
                }
            }
        });

        // -------------------------------------------------------------------------
        // PASO 2: DEMANDA INDEPENDIENTE (BULTOS CERRADOS DIRECTOS DE REVENTA LDN 1)
        // -------------------------------------------------------------------------
        bunkerMap.forEach((art, sku) => {
            const descNorm = (art.descripcion_generada || art.descripcion || '').toUpperCase();

            // Filtro estricto: descartar elaborados, fraccionados con receta, packs y artículos puente/producción
            const esElaborado = art.tiene_receta || art.pack_hijo_codigo ||
                                art.familia_id === 42 ||
                                UP_A_INGREDIENTE_TOSTADO.has(sku) ||
                                descNorm.includes('PROD AP') || descNorm.includes('PROD UP') || 
                                descNorm.includes('MEZCLA');

            if (esElaborado) return;

            // Determinismo puro: Si no está activa en al menos una lista de ventas comercial activa, descartar de Reventa Directa LDN 1
            if (!art.activa_en_listas) return;

            const ventas = ventasMap.get(sku) || 0;
            const stockFisicoBultos = parseFloat(art.stock_fisico !== undefined ? art.stock_fisico : (art.stock_consolidado || 0));
            const rawDep = parseFloat(art.stock_consolidado_raw || 0);
            const kilosUnidad = parseFloat(art.kilos_unidad || 1.0);
            const comprometidoBultos = parseFloat(art.stock_reservado !== undefined ? art.stock_reservado : (presupuestosMap.get(sku) || 0));
            const stockNetoBultos = stockFisicoBultos - comprometidoBultos;
            const defBultos = stockNetoBultos < 0 ? Math.abs(stockNetoBultos) : 0;
            const ddpBultos = ventas / diasEfectivos;
            const ddpKg = ddpBultos * kilosUnidad;

            // Si se vende directamente o tiene quiebre/compromiso pendiente
            if (ddpKg > 0 || defBultos > 0 || (ventas > 0 && stockFisicoBultos <= 0)) {
                const ingVinculado = ingsRes.rows.find(i => {
                    const v = i.articulo_vinculado_numero || ingredientesSinVinculoMap.get(i.id);
                    return v && v.trim().toUpperCase() === sku;
                });
                // Stock terminado: solo fracciones derivadas con receta (nunca duplicar stockNetoBultos del propio bulto)
                const termKg = (stockTerminadoNetoPorSkuKg.get(sku) || (ingVinculado ? stockTerminadoNetoPorIngKg.get(ingVinculado.id) : 0) || 0);
                const defRecetasKg = (deficitComprometidoPorSkuKg.get(sku) || (ingVinculado ? deficitComprometidoPorIngKg.get(ingVinculado.id) : 0) || 0);
                const defKg = defRecetasKg + (defBultos * kilosUnidad);

                registrarDemandaItemCompra({
                    sku: sku,
                    descripcion: art.descripcion_generada || art.descripcion,
                    rubro: art.rubro,
                    kilosPorBulto: kilosUnidad,
                    stockDepositoBultos: Math.max(0, stockNetoBultos),
                    depositoNegativoRaw: rawDep,
                    stockTallerBultos: ingVinculado ? parseFloat(ingVinculado.bultos_taller || 0) : 0,
                    stockTallerBultosKg: ingVinculado ? parseFloat(ingVinculado.kg_bultos_taller || 0) : 0,
                    stockSateliteKg: ingVinculado ? parseFloat(ingVinculado.stock_satelite_kg || 0) : 0,
                    stockFabricaKg: ingVinculado ? parseFloat(ingVinculado.stock_fabrica_kg || 0) : 0,
                    stockTerminadoKg: termKg,
                    deficitComprometidoKg: defKg,
                    costoUnitario: parseFloat(art.costo_base || 0),
                    consumoKgDiario: ddpKg,
                    productoOrigen: 'Comercialización directa al cliente',
                    tipoOrigen: 'LDN 1 (Bulto Directo)'
                });
            }
        });

        // -------------------------------------------------------------------------
        // PASO 3: CÁLCULO DETERMINISTA DE COBERTURA, FALTANTES Y PRIORIDAD INTEGRAL
        // -------------------------------------------------------------------------
        const itemsCompras = [];

        comprasMRP.forEach(item => {
            // Balance Consolidado de Masa en Kilos (5 Capas Físicas)
            const stockMateriaPrimaKg = (item.stock_fabrica_kg || 0) + (item.stock_taller_bultos_kg || 0) + (item.stock_satelite_kg || 0) + ((item.stock_deposito_bultos || 0) * (item.kilos_por_bulto || 1.0));
            const stockTotalDisponibleKg = (item.stock_terminado_kg || item.stockTerminadoKg || 0) + stockMateriaPrimaKg;
            const totalBultosCerrados = (item.stock_deposito_bultos || 0) + (item.stock_taller_bultos || 0);
            
            const ddpKg = item.consumo_diario_kg || 0;
            // Demanda total proyectada en el horizonte objetivo + déficit inmediato comprometido en presupuestos
            const kgDeseadosConsumo = ddpKg * objetivo;
            const kgDemandaTotal = kgDeseadosConsumo + (item.deficit_comprometido_kg || 0);
            
            // Faltante Neto real (descartando residuos menores a 0.05 kg que redondean a 0.0 kg en pantalla)
            const kgFaltantesRaw = Math.max(0, kgDemandaTotal - stockTotalDisponibleKg);
            const kgFaltantes = kgFaltantesRaw < 0.05 ? 0 : kgFaltantesRaw;
            
            // Cobertura neta considerando el déficit comprometido
            // Stock neto para rotación = stockTotalDisponibleKg - deficit_comprometido_kg
            const stockNetoParaRotacion = stockTotalDisponibleKg - (item.deficit_comprometido_kg || 0);
            const cobDias = ddpKg > 0 ? (stockNetoParaRotacion / ddpKg) : (stockNetoParaRotacion <= 0 ? 0 : 999);

            let urgencia = 4;
            let nivelUrgencia = `⚪ Planificado (16-${Math.max(30, objetivo)}d)`;
            let badgeColor = '#94a3b8';

            if (stockNetoParaRotacion <= 0 && (ddpKg > 0 || (item.deficit_comprometido_kg || 0) > 0)) {
                urgencia = 1;
                nivelUrgencia = '🔴 QUIEBRE INMEDIATO';
                badgeColor = '#ef4444';
            } else if (cobDias <= 7) {
                urgencia = 2;
                nivelUrgencia = '🟠 ALERTA CRÍTICA (≤7d)';
                badgeColor = '#f97316';
            } else if (cobDias <= 15) {
                urgencia = 3;
                nivelUrgencia = '🟡 ATENCIÓN (8-15d)';
                badgeColor = '#eab308';
            }

            let bultosAPedir = Math.ceil(kgFaltantes / item.kilos_por_bulto);
            if (stockNetoParaRotacion <= 0 && (ddpKg > 0 || (item.deficit_comprometido_kg || 0) > 0) && bultosAPedir === 0) {
                bultosAPedir = 1;
            }

            // Filtro de blindaje final contra cualquier AP o mezcla
            const textoIdentificador = `${item.sku} ${item.descripcion}`.toUpperCase();
            const esProducidoOIntermedio = textoIdentificador.includes('PROD AP') || 
                                           textoIdentificador.includes('PROD UP') || 
                                           textoIdentificador.includes('MEZCLA') || 
                                           UP_A_INGREDIENTE_TOSTADO.has(item.sku);

            if (esProducidoOIntermedio) return;

            // Si no rota, no hay déficit comprometido y hay stock, omitir
            if (ddpKg === 0 && (item.deficit_comprometido_kg || 0) === 0 && stockTotalDisponibleKg > 0) return;
            // Si está planificado y no faltan bultos, omitir
            if (soloFaltantes && bultosAPedir <= 0 && urgencia > 2) return;

            const costoTotalEstimado = bultosAPedir * item.costo_unitario;
            const listaProductosAfectados = Array.from(item.productos_afectados);
            let productosAfectadosStr = item.tipo_origen === 'LDN 1 (Bulto Directo)' && listaProductosAfectados.length === 1 && listaProductosAfectados[0] === 'Comercialización directa al cliente'
                ? 'Comercialización directa al cliente'
                : `Alimenta: ${listaProductosAfectados.slice(0, 4).join(', ')}${listaProductosAfectados.length > 4 ? ` (+${listaProductosAfectados.length - 4})` : ''}`;

            if (item.deficit_comprometido_kg > 0) {
                productosAfectadosStr += ` [🚨 ${item.deficit_comprometido_kg.toFixed(0)}kg comprometidos p/ pedidos]`;
            }

            itemsCompras.push({
                id_referencia: item.sku || `ING-${item.ing_id}`,
                tipo_origen: item.tipo_origen,
                categoria_item: item.tipo_origen === 'LDN 1 (Bulto Directo)' ? 'Reventa Directa' : 'Insumo de Receta / Ingredientes',
                articulo_codigo: item.sku,
                descripcion: item.descripcion,
                nombre_ingrediente_fabrica: item.nombre_ingrediente_fabrica,
                rubro: item.rubro,
                unidad_medida: item.tipo_origen === 'LDN 1 (Bulto Directo)' ? 'Bultos' : 'Bultos Industriales',
                kilos_por_bulto: item.kilos_por_bulto,
                unidad_bulto_kg: item.kilos_por_bulto,
                stock_actual_bultos: totalBultosCerrados,
                stock_deposito_bultos: item.stock_deposito_bultos,
                stock_taller_bultos: item.stock_taller_bultos,
                stock_actual_kg: parseFloat((stockTotalDisponibleKg || 0).toFixed(1)),
                stock_terminado_kg: parseFloat((item.stock_terminado_kg || 0).toFixed(1)),
                stock_materia_prima_kg: parseFloat((stockMateriaPrimaKg || 0).toFixed(1)),
                deficit_comprometido_kg: parseFloat((item.deficit_comprometido_kg || 0).toFixed(1)),
                stock_suelto_fabrica_kg: parseFloat((item.stock_fabrica_kg || 0).toFixed(1)),
                stock_taller_bultos_kg: parseFloat((item.stock_taller_bultos_kg || 0).toFixed(1)),
                stock_satelite_kg: parseFloat((item.stock_satelite_kg || 0).toFixed(1)),
                deposito_negativo: item.deposito_negativo_raw < 0,
                ventas_trimestre: parseFloat((ddpKg * dias).toFixed(1)),
                demanda_diaria: parseFloat(ddpKg.toFixed(3)),
                cobertura_dias: cobDias === 999 ? 999 : parseFloat(cobDias.toFixed(1)),
                cantidad_sugerida_bultos: bultosAPedir,
                kilos_sugeridos: parseFloat(kgFaltantes.toFixed(1)),
                costo_unitario: item.costo_unitario,
                costo_total_estimado: parseFloat(costoTotalEstimado.toFixed(2)),
                urgencia: urgencia,
                nivel_urgencia: nivelUrgencia,
                badge_color: badgeColor,
                productos_afectados: productosAfectadosStr
            });
        });

        // Orden estricto por urgencia y cobertura
        itemsCompras.sort((a, b) => {
            if (a.urgencia !== b.urgencia) return a.urgencia - b.urgencia;
            return a.cobertura_dias - b.cobertura_dias;
        });

        const quiebres = itemsCompras.filter(i => i.urgencia === 1);
        const criticos = itemsCompras.filter(i => i.urgencia === 2);
        const atencion = itemsCompras.filter(i => i.urgencia === 3);
        const planificados = itemsCompras.filter(i => i.urgencia === 4);

        const totalBultos = itemsCompras.reduce((acc, i) => acc + i.cantidad_sugerida_bultos, 0);
        const totalKg = itemsCompras.reduce((acc, i) => acc + i.kilos_sugeridos, 0);
        const inversionTotal = itemsCompras.reduce((acc, i) => acc + i.costo_total_estimado, 0);

        console.log(`✅ [INFORME-COMPRAS] Consolidación pura completada: ${itemsCompras.length} materias primas/bultos.`);
        console.log(`   - 🔴 Quiebres: ${quiebres.length} | 🟠 Críticos: ${criticos.length} | 🟡 Atención: ${atencion.length} | ⚪ Planificados: ${planificados.length}`);
        console.log(`   - 📦 Bultos: ${totalBultos} | ⚖️ Kilos: ${totalKg.toFixed(1)} kg | 💲 Inversión: $${inversionTotal.toLocaleString('es-AR')}`);

        return {
            success: true,
            timestamp: new Date().toISOString(),
            parametros: {
                ventana_dias_demanda: dias,
                dias_objetivo_cobertura: objetivo,
                base_estadistica: dias >= 999 ? 'Todas las facturas (Histórico Completo)' : (dias === 90 ? 'Último Trimestre (90 días)' : `Últimos ${dias} días`),
                horizonte_proyectado: `${objetivo} días`
            },
            resumen_kpi: {
                total_items_a_pedir: itemsCompras.length,
                quiebres_inmediatos_count: quiebres.length,
                criticos_semana_count: criticos.length,
                atencion_quincenal_count: atencion.length,
                planificados_mes_count: planificados.length,
                total_bultos_estimados: totalBultos,
                total_kilos_estimados: parseFloat(totalKg.toFixed(1)),
                inversion_estimada_total: parseFloat(inversionTotal.toFixed(2))
            },
            items_compras: itemsCompras
        };

    } catch (error) {
        console.error('❌ [INFORME-COMPRAS] Error consolidando compras a proveedores:', error);
        throw error;
    }
}

module.exports = {
    obtenerAnalisisPlanificacionLunes,
    obtenerInformeComprasProveedores
};

