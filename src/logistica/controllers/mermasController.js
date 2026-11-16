const BunkerService = require('../services/bunkerService');

exports.obtenerHistorialMermas = async (req, res) => {
    try {
        const { sku_salida } = req.query;
        if (!sku_salida) {
            return res.status(400).json({ success: false, error: 'Falta parámetro sku_salida' });
        }

        // 1. Detección Relacional Determinista de 4 Niveles (filtrando siempre auto-vínculos UP <> AP)
        const queryRelDura = `
            SELECT 
                ba_up.articulo_id AS sku_up,
                COALESCE(ba_up.descripcion_generada, ba_up.descripcion) AS descripcion_up_generada,
                ba_up.kilos_unidad AS kilos_unidad_entrada,
                ba_nexo.articulo_id AS sku_nexo_ingrediente,
                COALESCE(ba_nexo.descripcion_generada, ba_nexo.descripcion) AS descripcion_nexo_generada,
                COALESCE(NULLIF(ba_nexo.kilos_unidad, 0), NULLIF(src_nexo.kilos_unidad, 0), 1.00) AS nexo_kilos_unidad,
                COALESCE(ba_nexo.costo_base, 0) AS nexo_costo_base,
                COALESCE(src_nexo.stock_consolidado, 0) AS nexo_stock_bultos,
                COALESCE(
                    NULLIF(BTRIM(ba_nexo.propiedades_dinamicas->>'articulo_principal'), ''),
                    NULLIF(BTRIM(ba_ap.propiedades_dinamicas->'posiciones'->'pos_3'->>'valor'), '')
                ) AS materia_prima_principal,
                ba_ap.propiedades_dinamicas->'tostadero_simulacion' AS tostadero_simulacion,
                r.ingredientes_custom,
                COALESCE(r.multiplicador_ingredientes, 1.0000) AS factor_conversion,
                ing_esp.id AS ingrediente_espejo_id,
                ing_esp.codigo AS ingrediente_espejo_codigo,
                ing_esp.nombre AS ingrediente_espejo_nombre,
                COALESCE(ing_esp.costo_patron, 0) AS ingrediente_espejo_costo,
                TRUE AS is_unidad_productiva
            FROM public.articulos_produccion_externa_relacion r
            JOIN public.bunker_articulos ba_up ON (ba_up.articulo_id = r.articulo_produccion_codigo)
            LEFT JOIN public.bunker_articulos ba_ap ON (ba_ap.articulo_id = r.articulo_kilo_codigo)
            LEFT JOIN public.recetas rec ON (rec.articulo_numero = ba_up.articulo_id)
            LEFT JOIN public.receta_articulos ra ON (ra.receta_id = rec.id)
            LEFT JOIN public.bunker_articulos ba_nexo ON (ba_nexo.articulo_id = ra.articulo_numero)
            LEFT JOIN public.stock_real_consolidado src_nexo ON (src_nexo.articulo_numero = ba_nexo.articulo_id)
            LEFT JOIN public.ingredientes ing_esp ON (UPPER(BTRIM(COALESCE(ing_esp.articulo_vinculado_numero, ''))) = UPPER(BTRIM(r.articulo_kilo_codigo)))
            WHERE r.articulo_kilo_codigo = $1
              AND UPPER(BTRIM(r.articulo_produccion_codigo)) <> UPPER(BTRIM(r.articulo_kilo_codigo))
            ORDER BY r.id ASC
            LIMIT 1;
        `;

        const directRes = await req.db.query(`
            SELECT EXISTS (
                SELECT 1 FROM public.articulos_produccion_externa_relacion r
                WHERE (r.articulo_kilo_codigo = $1 OR r.articulo_produccion_codigo = $1)
                  AND UPPER(BTRIM(r.articulo_produccion_codigo)) <> UPPER(BTRIM(r.articulo_kilo_codigo))
            ) AS vinculo_directo;
        `, [sku_salida]);
        const vinculo_directo = !!(directRes.rows[0] && directRes.rows[0].vinculo_directo);

        const relRes = await req.db.query(queryRelDura, [sku_salida]);

        let sku_up = null;
        let descripcion_up_generada = '';
        let sku_nexo_ingrediente = null;
        let descripcion_nexo_generada = '';
        let nexo_kilos_unidad = 1.00;
        let nexo_costo_base = 0;
        let nexo_stock_bultos = 0;
        let materia_prima_principal = null;
        let tostadero_simulacion = null;
        let ingrediente_espejo = null;
        let factor_conversion = 1.0000;
        let is_unidad_productiva = false;
        let ingredientes_custom = null;
        let sku_entrada = null;
        let descripcion_entrada = '';
        let kilos_unidad_entrada = 1.00;

        if (relRes.rows.length > 0) {
            const row = relRes.rows[0];
            sku_up = row.sku_up;
            descripcion_up_generada = row.descripcion_up_generada;
            kilos_unidad_entrada = parseFloat(row.kilos_unidad_entrada) || 1.00;
            sku_nexo_ingrediente = row.sku_nexo_ingrediente;
            descripcion_nexo_generada = row.descripcion_nexo_generada;
            nexo_kilos_unidad = parseFloat(row.nexo_kilos_unidad) || 1.00;
            nexo_costo_base = parseFloat(row.nexo_costo_base) || 0;
            nexo_stock_bultos = parseFloat(row.nexo_stock_bultos) || 0;
            materia_prima_principal = row.materia_prima_principal || null;
            tostadero_simulacion = row.tostadero_simulacion || null;
            ingredientes_custom = row.ingredientes_custom || null;
            factor_conversion = parseFloat(row.factor_conversion) || 1.0000;
            is_unidad_productiva = true;
            if (row.ingrediente_espejo_id) {
                ingrediente_espejo = {
                    id: row.ingrediente_espejo_id,
                    codigo: row.ingrediente_espejo_codigo,
                    nombre: row.ingrediente_espejo_nombre,
                    costo_patron: parseFloat(row.ingrediente_espejo_costo) || 0
                };
            }

            sku_entrada = sku_nexo_ingrediente || sku_up;
            descripcion_entrada = descripcion_nexo_generada || descripcion_up_generada;
        }

        if (!sku_entrada) {
            return res.json({
                success: true,
                enlazado: false,
                vinculo_directo: false,
                sku_salida,
                sku_entrada: null,
                descripcion_entrada: 'Sin vincular',
                merma_promedio: 0,
                ultima_merma: 0,
                historial: [],
                ingredientes_extra: [],
                bultos_comparativos: []
            });
        }

        let sku_entrada_original = sku_up || sku_entrada;
        let sku_entrada_resuelto = sku_entrada;

        if (is_unidad_productiva && sku_nexo_ingrediente) {
            sku_entrada_resuelto = sku_nexo_ingrediente;
            descripcion_entrada = descripcion_nexo_generada || sku_nexo_ingrediente;
        } else {
            const queryRecetaUP = `
                SELECT 
                    ra.articulo_numero as sku_real,
                    s.descripcion as descripcion_real,
                    ba.articulo_id as bunker_id,
                    COALESCE(ba.descripcion_generada, ba.descripcion) as bunker_desc,
                    COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(s.kilos_unidad, 0), 1.00) as kilos_u,
                    COALESCE(ba.costo_base, 0) as costo_b,
                    COALESCE(s.stock_consolidado, 0) as stock_b
                FROM public.recetas r
                JOIN public.receta_articulos ra ON r.id = ra.receta_id
                LEFT JOIN public.stock_real_consolidado s ON s.articulo_numero = ra.articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                WHERE r.articulo_numero = $1
                LIMIT 1
            `;
            const recetaUPRes = await req.db.query(queryRecetaUP, [sku_entrada_original]);

            if (recetaUPRes.rows.length > 0 && recetaUPRes.rows[0].sku_real) {
                sku_entrada_resuelto = recetaUPRes.rows[0].sku_real;
                sku_nexo_ingrediente = sku_nexo_ingrediente || sku_entrada_resuelto;
                nexo_kilos_unidad = parseFloat(recetaUPRes.rows[0].kilos_u) || 1.00;
                nexo_costo_base = parseFloat(recetaUPRes.rows[0].costo_b) || 0;
                nexo_stock_bultos = parseFloat(recetaUPRes.rows[0].stock_b) || 0;
                const bDesc = recetaUPRes.rows[0].bunker_desc;
                const lDesc = (recetaUPRes.rows[0].descripcion_real || sku_entrada_resuelto).trim();
                descripcion_entrada = bDesc || `Sin alta Búnker (${lDesc})`;
                descripcion_nexo_generada = descripcion_nexo_generada || descripcion_entrada;
            }
        }

        sku_entrada = sku_entrada_resuelto;

        // 2. Detección canónica de Línea de Negocio Externa (Flujos 4, 5 y 6)
        let lineaNegocioDetectada = 4;
        let nombreLineaNegocioDetectada = 'Línea de Negocio 4: Tostadero (UP Externa Simple)';
        let iconoLineaNegocio = '🥜';

        const skuParaLdn = (sku_up || sku_salida || sku_entrada || '').toUpperCase();
        const descParaLdn = (descripcion_up_generada || descripcion_entrada || '').toUpperCase();

        if (skuParaLdn.startsWith('BF') || descParaLdn.includes('BARRA')) {
            lineaNegocioDetectada = 5;
            nombreLineaNegocioDetectada = 'Línea de Negocio 5: Barritas (Mezcla Interna + UP Externa)';
            iconoLineaNegocio = '🍫';
        } else if (skuParaLdn.includes('GN') || descParaLdn.includes('GRANA') || descParaLdn.includes('GRANOLA')) {
            lineaNegocioDetectada = 6;
            nombreLineaNegocioDetectada = 'Línea de Negocio 6: Granolas (Doble Mezcla / UP Externa)';
            iconoLineaNegocio = '🥣';
        }

        // 3. Ingredientes extra deterministas por ID (con fallback por nombre solo para registros legacy sin ID)
        let ingredientesExtra = [];
        if (ingredientes_custom && Array.isArray(ingredientes_custom) && ingredientes_custom.length > 0) {
            const idsCustom = ingredientes_custom
                .map(i => parseInt(i.ingrediente_id, 10))
                .filter(n => Number.isInteger(n) && n > 0);
            const nombresFallback = ingredientes_custom
                .map(i => String(i.nombre_ingrediente || '').trim())
                .filter(Boolean);

            const ingsRes = await req.db.query(
                `SELECT id, nombre, costo_patron, unidad_medida
                 FROM public.ingredientes
                 WHERE (cardinality($1::int[]) > 0 AND id = ANY($1::int[]))
                    OR (cardinality($2::text[]) > 0 AND LOWER(BTRIM(nombre)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($2::text[]) AS x))`,
                [idsCustom, nombresFallback]
            );
            const ingsById = new Map(ingsRes.rows.map(i => [Number(i.id), i]));
            const ingsByName = new Map(ingsRes.rows.map(i => [String(i.nombre || '').toLowerCase().trim(), i]));

            ingredientesExtra = ingredientes_custom.map(i => {
                const idInt = parseInt(i.ingrediente_id, 10);
                const matched = (Number.isInteger(idInt) && idInt > 0 ? ingsById.get(idInt) : null)
                    || ingsByName.get(String(i.nombre_ingrediente || '').toLowerCase().trim());
                return {
                    ingrediente_id: matched ? matched.id : (Number.isInteger(idInt) && idInt > 0 ? idInt : null),
                    nombre_ingrediente: matched ? matched.nombre : i.nombre_ingrediente,
                    cantidad: parseFloat(i.cantidad) || 0,
                    unidad_medida: matched ? matched.unidad_medida : (i.unidad_medida || 'Kilo'),
                    costo_patron: matched ? (parseFloat(matched.costo_patron) || 0) : 0,
                    fase_produccion: i.fase_produccion || 'interna'
                };
            });
        } else {
            const recRes = await req.db.query(`
                SELECT 
                    ri.ingrediente_id,
                    ri.cantidad,
                    i.nombre as nombre_ingrediente,
                    i.unidad_medida,
                    i.costo_patron
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                WHERE r.articulo_numero = $1
            `, [sku_salida]);
            ingredientesExtra = recRes.rows.map(i => ({
                ingrediente_id: i.ingrediente_id,
                nombre_ingrediente: i.nombre_ingrediente,
                cantidad: parseFloat(i.cantidad) || 0,
                unidad_medida: i.unidad_medida || 'Kilo',
                costo_patron: parseFloat(i.costo_patron) || 0
            }));
        }

        // 4. Historial de mermas reconstruyendo kilos_entrada reales desde stock_ventas_movimientos ('egreso por receta externa')
        // En Línea 4 NUNCA se usa el peso actual de la receta de la UP para reconstruir carros viejos sin entrada registrada.
        const queryHistorialAll = `
            WITH skus_circuito AS (
                SELECT r.articulo_produccion_codigo AS sku
                FROM public.articulos_produccion_externa_relacion r
                WHERE (r.articulo_kilo_codigo = $1 OR r.articulo_produccion_codigo = $1)
                  AND UPPER(BTRIM(r.articulo_produccion_codigo)) <> UPPER(BTRIM(r.articulo_kilo_codigo))
                UNION
                SELECT r.articulo_kilo_codigo AS sku
                FROM public.articulos_produccion_externa_relacion r
                WHERE (r.articulo_kilo_codigo = $1 OR r.articulo_produccion_codigo = $1)
                  AND UPPER(BTRIM(r.articulo_produccion_codigo)) <> UPPER(BTRIM(r.articulo_kilo_codigo))
                UNION
                SELECT $1 AS sku
            ),
            blueprint_por_up AS (
                SELECT 
                    r.articulo_numero AS up_sku,
                    COALESCE(
                        (SELECT SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(NULLIF(CAST(src.kilos_unidad AS DECIMAL(20, 10)), 0), NULLIF(ba.kilos_unidad, 0), 1.00))
                         FROM public.receta_articulos ra
                         LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                         LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                         WHERE ra.receta_id = r.id), 
                        0
                    ) AS masa_base_blueprint,
                    COALESCE(
                        (SELECT SUM(CAST(ri.cantidad AS DECIMAL(20, 10)))
                         FROM public.receta_ingredientes ri
                         WHERE ri.receta_id = r.id), 
                        0
                    ) AS masa_agregados_blueprint
                FROM public.recetas r
                WHERE r.articulo_numero IN (SELECT sku FROM skus_circuito)
            )
            SELECT 
                peh.id,
                peh.carro_id,
                peh.fecha_registro,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id,
                COALESCE(
                    peh.linea_negocio,
                    CASE 
                        WHEN peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%' THEN 5
                        WHEN peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%' THEN 6
                        ELSE 4
                    END
                ) AS linea_negocio,
                COALESCE(
                    peh.nombre_linea_negocio,
                    CASE 
                        WHEN peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%' THEN 'Línea de Negocio 5: Barritas (Mezcla Interna + UP Externa)'
                        WHEN peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%' THEN 'Línea de Negocio 6: Granolas (Doble Mezcla / UP Externa)'
                        ELSE 'Línea de Negocio 4: Tostadero (UP Externa Simple)'
                    END
                ) AS nombre_linea_negocio,
                NULLIF(peh.kilos_entrada, 0) AS kilos_entrada_original,
                svm_rec.kilos_egresados_reales,
                isu_rec.kilos_domicilio_reales,
                svm_rec.sku_egresado_real,
                CASE
                    WHEN NOT (peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%' OR peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%')
                    THEN COALESCE(NULLIF(svm_rec.kilos_egresados_reales, 0), NULLIF(peh.kilos_entrada, 0))
                    WHEN (peh.articulo_padre_id ILIKE 'G%GN%' OR peh.articulo_fraccionado_id ILIKE 'G%GN%')
                    THEN CASE
                        WHEN COALESCE(peh.kilos_entrada, 0) > COALESCE(svm_rec.kilos_egresados_reales, 0) + 0.01
                        THEN peh.kilos_entrada
                        WHEN COALESCE(svm_rec.kilos_egresados_reales, 0) > 0
                        THEN svm_rec.kilos_egresados_reales + COALESCE(NULLIF(isu_rec.kilos_domicilio_reales, 0), NULLIF(bp.masa_agregados_blueprint, 0), 2.78)
                        ELSE NULLIF(COALESCE(bp.masa_base_blueprint, 0) + COALESCE(bp.masa_agregados_blueprint, 0), 0)
                    END
                    ELSE COALESCE(
                        NULLIF(peh.kilos_entrada, 0),
                        CASE
                            WHEN COALESCE(svm_rec.kilos_egresados_reales, 0) > 0 AND COALESCE(isu_rec.kilos_domicilio_reales, 0) > 0
                            THEN svm_rec.kilos_egresados_reales + isu_rec.kilos_domicilio_reales
                            ELSE NULLIF(svm_rec.kilos_egresados_reales, 0)
                        END,
                        CASE
                            WHEN (peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%')
                                 AND COALESCE(bp.masa_base_blueprint, 0) > 0 AND CAST(peh.kilos_producidos AS DECIMAL(20,10)) > 0
                            THEN (COALESCE(bp.masa_base_blueprint, 0) + COALESCE(bp.masa_agregados_blueprint, 0)) * (CAST(peh.kilos_producidos AS DECIMAL(20,10)) / 4.80)
                            ELSE NULL
                        END
                    )
                END AS kilos_entrada_resuelta,
                COALESCE(NULLIF(peh.kilos_salida, 0), peh.kilos_producidos) AS kilos_salida,
                peh.kilos_producidos
            FROM public.produccion_externa_historial peh
            LEFT JOIN blueprint_por_up bp ON bp.up_sku = peh.articulo_padre_id
            LEFT JOIN LATERAL (
                SELECT 
                    SUM(
                        CASE
                            WHEN ABS(COALESCE(svm.kilos, 0)) > 0 THEN ABS(svm.kilos)
                            ELSE ABS(COALESCE(svm.cantidad, 0)) * COALESCE(NULLIF(ba_s.kilos_unidad, 0), NULLIF(src_s.kilos_unidad, 0), 1.00)
                        END
                    ) AS kilos_egresados_reales,
                    MAX(svm.articulo_numero) AS sku_egresado_real
                FROM public.stock_ventas_movimientos svm
                LEFT JOIN public.bunker_articulos ba_s ON ba_s.articulo_id = svm.articulo_numero
                LEFT JOIN public.stock_real_consolidado src_s ON src_s.articulo_numero = svm.articulo_numero
                WHERE svm.carro_id = peh.carro_id
                  AND LOWER(COALESCE(svm.tipo, '')) LIKE '%egreso por receta externa%'
            ) svm_rec ON true
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(ABS(isu.cantidad)), 0) AS kilos_domicilio_reales
                FROM public.ingredientes_stock_usuarios isu
                WHERE isu.origen_carro_id = peh.carro_id
                  AND isu.cantidad < 0
            ) isu_rec ON true
            WHERE (peh.articulo_padre_id IN (SELECT sku FROM skus_circuito)
               OR peh.articulo_fraccionado_id IN (SELECT sku FROM skus_circuito))
              AND UPPER(BTRIM(COALESCE(peh.articulo_padre_id, ''))) <> UPPER(BTRIM(COALESCE(peh.articulo_fraccionado_id, '')))
            ORDER BY peh.fecha_registro DESC
        `;
        const histRes = await req.db.query(queryHistorialAll, [sku_salida]);

        let sumMermas = 0;
        let countMermas = 0;
        let ultimaMermaValida = null;
        const mappedHistorial = [];

        histRes.rows.forEach((h, index) => {
            const entParsed = h.kilos_entrada_resuelta !== null && h.kilos_entrada_resuelta !== undefined
                ? parseFloat(h.kilos_entrada_resuelta)
                : NaN;
            const entTotal = Number.isFinite(entParsed) && entParsed > 0 ? Number(entParsed.toFixed(4)) : 0;
            const salParsed = parseFloat(h.kilos_salida) || parseFloat(h.kilos_producidos) || 0;
            const sal = salParsed > 0 ? Number(salParsed.toFixed(4)) : 0;
            const prodOrig = parseFloat(h.kilos_producidos) || sal;

            // Regla estricta: inválida si falta entrada válida, si salida > entrada, en Línea 4 fuera de [0%, 25%], o en Línea 6 fuera de [0%, 30%]
            const faltaEntrada = !(entTotal > 0);
            const salidaExcedeEntrada = entTotal > 0 && (prodOrig > entTotal + 0.0001 || sal > entTotal + 0.0001);
            const mermaRaw = (entTotal > 0 && sal > 0) ? Number((((entTotal - sal) / entTotal) * 100).toFixed(2)) : null;
            const ldnHistNum = Number(h.linea_negocio || 4);
            const fueraRangoL4 = ldnHistNum === 4 && mermaRaw !== null && (mermaRaw < 0 || mermaRaw > 25);
            const fueraRangoL6 = ldnHistNum === 6 && mermaRaw !== null && (mermaRaw < 0 || mermaRaw > 30);
            const esInvalida = faltaEntrada || salidaExcedeEntrada || !(sal > 0) || fueraRangoL4 || fueraRangoL6;

            const item = {
                id: h.id,
                carro_id: h.carro_id,
                fecha_registro: h.fecha_registro,
                articulo_padre_id: h.articulo_padre_id,
                articulo_fraccionado_id: h.articulo_fraccionado_id,
                linea_negocio: h.linea_negocio,
                nombre_linea_negocio: h.nombre_linea_negocio,
                kilos_entrada: entTotal > 0 ? entTotal : null,
                kilos_salida: sal,
                kilos_producidos: prodOrig,
                reconstruido_movimientos: !!(entTotal > 0 && (!h.kilos_entrada_original || Math.abs(parseFloat(h.kilos_entrada_original) - entTotal) > 0.001)),
                sku_egresado_real: h.sku_egresado_real || null,
                es_invalida: esInvalida,
                motivo_invalida: faltaEntrada
                    ? 'Falta entrada válida registrada'
                    : (salidaExcedeEntrada
                        ? (ldnHistNum === 6
                            ? 'Kilos producidos superan Masa Pre-Horno (posible carga de Masa Final con coco/pasas)'
                            : 'Salida supera kilos de entrada (merma negativa)')
                        : (fueraRangoL4
                            ? `Merma (${mermaRaw}%) fuera del rango válido de Tostadero (0% a 25%)`
                            : (fueraRangoL6 ? `Merma (${mermaRaw}%) fuera del rango válido de Granolas (0% a 30%)` : null))),
                porcentaje_merma: null
            };

            if (!esInvalida && mermaRaw !== null) {
                item.porcentaje_merma = mermaRaw;
                sumMermas += mermaRaw;
                countMermas++;
                if (ultimaMermaValida === null) {
                    ultimaMermaValida = mermaRaw;
                }
            }

            if (index < 8) {
                mappedHistorial.push(item);
            }
        });

        const merma_promedio = countMermas > 0 ? Number((sumMermas / countMermas).toFixed(2)) : 0;
        const total_carros = countMermas;
        const ultima_merma = ultimaMermaValida !== null ? ultimaMermaValida : 0;

        let costoVivoNexoObj = { costo_kilo_crudo: 0, kilos_bulto: nexo_kilos_unidad || 1, fuente_aplicada: 'N/A' };
        if (sku_nexo_ingrediente) {
            costoVivoNexoObj = await BunkerService.obtenerCostoVivoNexo(req.db, sku_nexo_ingrediente);
        }

        // 5. Bultos comparativos deterministas (bulto crudo actual de la UP + bultos industriales crudos o tostados comprados como EMB-XBN4S5)
        let bultosComparativos = [];
        if (lineaNegocioDetectada === 4) {
            const bultosQuery = `
                SELECT 
                    ba.articulo_id AS sku,
                    COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                    COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00) AS kilos_unidad,
                    COALESCE(ba.costo_base, 0) AS costo_base_bulto,
                    ROUND(
                        CASE
                            WHEN COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00) > 0
                            THEN COALESCE(ba.costo_base, 0) / COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00)
                            ELSE 0
                        END,
                        2
                    ) AS costo_kilo,
                    COALESCE(src.stock_consolidado, 0) AS stock_bultos,
                    ROUND(COALESCE(src.stock_consolidado, 0) * COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00), 2) AS stock_kilos,
                    COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda,
                    COALESCE(
                        ba.propiedades_dinamicas->'posiciones'->'pos_5'->>'valor',
                        ba.propiedades_dinamicas->'posiciones'->'pos_4'->>'valor',
                        'Natural'
                    ) AS tratamiento
                FROM public.bunker_articulos ba
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                WHERE (
                    ba.articulo_id = $1
                    OR (
                        $2::text IS NOT NULL
                        AND UPPER(BTRIM(COALESCE(ba.propiedades_dinamicas->>'articulo_principal', ''))) = UPPER(BTRIM($2))
                        AND COALESCE(ba.familia_id, 0) <> 42
                        AND COALESCE(ba.es_pack, false) = false
                        AND NULLIF(BTRIM(COALESCE(ba.pack_hijo_codigo, '')), '') IS NULL
                        AND COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 0) >= 5
                        AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
                        AND NOT EXISTS (SELECT 1 FROM public.recetas r_chk WHERE r_chk.articulo_numero = ba.articulo_id)
                    )
                )
                ORDER BY
                    CASE WHEN ba.articulo_id = $1 THEN 0 ELSE 1 END,
                    COALESCE(src.stock_consolidado, 0) DESC,
                    ba.articulo_id ASC
            `;
            const bultosRes = await req.db.query(bultosQuery, [sku_nexo_ingrediente || '', materia_prima_principal]);
            bultosComparativos = bultosRes.rows.map(b => {
                const tratUpper = String(b.tratamiento || '').toUpperCase();
                const esTostadoComprado = tratUpper.includes('TOST') || tratUpper.includes('SAL') || tratUpper.includes('FRIT') || Boolean(b.no_producido_por_lambda);
                return {
                    sku: b.sku,
                    descripcion: b.descripcion,
                    kilos_unidad: parseFloat(b.kilos_unidad) || 1,
                    costo_base_bulto: parseFloat(b.costo_base_bulto) || 0,
                    costo_kilo: parseFloat(b.costo_kilo) || 0,
                    stock_bultos: parseFloat(b.stock_bultos) || 0,
                    stock_kilos: parseFloat(b.stock_kilos) || 0,
                    tratamiento: b.tratamiento || 'Natural',
                    es_actual_up: String(b.sku).trim().toUpperCase() === String(sku_nexo_ingrediente || '').trim().toUpperCase(),
                    es_tostado_comprado: esTostadoComprado
                };
            });
        }

        const kilosBultoEntrada = costoVivoNexoObj.kilos_bulto || nexo_kilos_unidad || 1.00;
        const costoKiloCrudoVivo = costoVivoNexoObj.costo_kilo_crudo || (nexo_kilos_unidad > 0 ? Number((nexo_costo_base / nexo_kilos_unidad).toFixed(2)) : 0);

        res.json({
            success: true,
            enlazado: is_unidad_productiva,
            is_unidad_productiva,
            linea_negocio: lineaNegocioDetectada,
            nombre_linea_negocio: nombreLineaNegocioDetectada,
            icono_linea_negocio: iconoLineaNegocio,
            up_context: {
                sku: sku_up,
                nombre_oficial: descripcion_up_generada
            },
            nexo_insumo_entrada: {
                sku: sku_nexo_ingrediente,
                nombre_oficial: descripcion_nexo_generada,
                kilos_unidad: kilosBultoEntrada,
                stock_bultos: nexo_stock_bultos,
                stock_kilos: Number((nexo_stock_bultos * kilosBultoEntrada).toFixed(2)),
                costo_kilo: costoKiloCrudoVivo,
                costo_bulto: Number((costoKiloCrudoVivo * kilosBultoEntrada).toFixed(2))
            },
            ingrediente_espejo,
            tostadero_simulacion,
            bultos_comparativos: bultosComparativos,
            ingesta_financiera_caja_2: {
                costo_kilo_sugerido: costoKiloCrudoVivo,
                costo_kilo_insumos_puro: costoVivoNexoObj.costo_kilo_insumos_puro || costoKiloCrudoVivo,
                costo_tiempo_mo_kilo: costoVivoNexoObj.costo_tiempo_mo_kilo || 0,
                kilos_bulto: kilosBultoEntrada,
                costo_bulto_total: Number((costoKiloCrudoVivo * kilosBultoEntrada).toFixed(2)),
                stock_bultos: nexo_stock_bultos,
                stock_kilos: Number((nexo_stock_bultos * kilosBultoEntrada).toFixed(2)),
                fuente_aplicada: costoVivoNexoObj.fuente_aplicada
            },
            sku_up,
            descripcion_up_generada,
            sku_nexo_ingrediente,
            descripcion_nexo_generada,
            vinculo_directo,
            sku_salida,
            sku_entrada: sku_nexo_ingrediente || sku_up || sku_salida,
            descripcion_entrada: descripcion_nexo_generada || descripcion_up_generada || sku_salida,
            descripcion_salida: descripcion_up_generada || sku_salida,
            factor_conversion,
            merma_promedio,
            ultima_merma,
            total_carros,
            historial: mappedHistorial,
            ingredientes_extra: ingredientesExtra
        });

    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo historial de mermas:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo mermas' });
    }
};

exports.guardarSimulacionTostadero = async (req, res) => {
    try {
        const sku = String(req.params.sku || '').trim();
        if (!sku) {
            return res.status(400).json({ success: false, error: 'SKU requerido' });
        }
        const simPayload = req.body && typeof req.body === 'object' ? req.body : {};
        const cleanSim = {
            colaborador_id: simPayload.colaborador_id ?? null,
            colaborador_nombre: simPayload.colaborador_nombre ?? null,
            servicio_id: simPayload.servicio_id ?? null,
            servicio_descripcion: simPayload.servicio_descripcion ?? null,
            tarifa: Number.isFinite(parseFloat(simPayload.tarifa)) ? parseFloat(simPayload.tarifa) : 0,
            merma: Number.isFinite(parseFloat(simPayload.merma)) ? parseFloat(simPayload.merma) : 0,
            insumo_evaluado_sku: simPayload.insumo_evaluado_sku || null,
            insumo_evaluado_descripcion: simPayload.insumo_evaluado_descripcion || null,
            es_comparacion_bulto_comprado: Boolean(simPayload.es_comparacion_bulto_comprado),
            costo_crudo_kg: Number.isFinite(parseFloat(simPayload.costo_crudo_kg)) ? parseFloat(simPayload.costo_crudo_kg) : 0,
            costo_resultante_kg: Number.isFinite(parseFloat(simPayload.costo_resultante_kg)) ? parseFloat(simPayload.costo_resultante_kg) : 0,
            updated_at: new Date().toISOString()
        };

        const client = await req.db.connect();
        let updatedRow = null;
        try {
            await client.query('BEGIN');

            const tieneCostoValido = cleanSim.costo_resultante_kg > 0 && simPayload.sincronizar_costo_y_listas !== false;

            const upd = await client.query(
                `UPDATE public.bunker_articulos
                 SET propiedades_dinamicas = jsonb_set(
                     COALESCE(propiedades_dinamicas, '{}'::jsonb),
                     '{tostadero_simulacion}',
                     $1::jsonb,
                     true
                 ),
                 costo_base = CASE
                     WHEN $3::boolean THEN ROUND(($4::numeric * COALESCE(NULLIF(kilos_unidad, 0), 1.00)), 2)
                     ELSE costo_base
                 END,
                 updated_at = CURRENT_TIMESTAMP
                 WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($2))
                 RETURNING articulo_id, COALESCE(NULLIF(kilos_unidad, 0), 1.00) AS kilos_unidad, costo_base, propiedades_dinamicas->'tostadero_simulacion' AS tostadero_simulacion`,
                [JSON.stringify(cleanSim), sku, tieneCostoValido, cleanSim.costo_resultante_kg]
            );

            if (upd.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: `Artículo ${sku} no encontrado en Búnker` });
            }

            updatedRow = upd.rows[0];

            // Sincronizar también bunker_lista_articulos del AP cuando se inyecta un costo_resultante_kg válido
            if (tieneCostoValido) {
                const kilosU = parseFloat(updatedRow.kilos_unidad) || 1.00;
                const costoBultoBase = Number((cleanSim.costo_resultante_kg * kilosU).toFixed(2));
                const listasRes = await client.query(
                    `SELECT bla.id, bla.margen_ganancia, bla.costo_tiempo, bla.iva, bla.modo_iva, bla.mano_obra_activa,
                            COALESCE((
                                SELECT SUM(bli.cantidad * bli.costo_unitario_capturado)
                                FROM public.bunker_lista_insumos bli
                                WHERE bli.lista_articulo_id = bla.id AND COALESCE(bli.incluido, true) = true
                            ), 0) AS costo_insumos
                     FROM public.bunker_lista_articulos bla
                     WHERE UPPER(BTRIM(bla.articulo_numero)) = UPPER(BTRIM($1))`,
                    [updatedRow.articulo_id]
                );

                for (const lr of listasRes.rows) {
                    const margen = parseFloat(lr.margen_ganancia) || 0;
                    const mo = lr.mano_obra_activa !== false ? (parseFloat(lr.costo_tiempo) || 0) : 0;
                    const ivaPct = parseFloat(lr.iva) || 21;
                    const cIns = parseFloat(lr.costo_insumos) || 0;
                    const factorIva = lr.modo_iva === 'EXENTO'
                        ? 1
                        : (lr.modo_iva === 'MEDIO' ? (1 + (ivaPct / 200)) : (1 + (ivaPct / 100)));
                    const cBaseTotal = costoBultoBase + cIns;
                    const pFinal = Number((((cBaseTotal * (1 + margen / 100)) + mo) * factorIva).toFixed(2));

                    await client.query(
                        `UPDATE public.bunker_lista_articulos
                         SET costo_base_sobrescrito = $1,
                             precio_final = $2,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $3`,
                        [Number(cleanSim.costo_resultante_kg.toFixed(4)), pFinal, lr.id]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        res.json({
            success: true,
            articulo_id: updatedRow.articulo_id,
            costo_base: parseFloat(updatedRow.costo_base) || 0,
            tostadero_simulacion: updatedRow.tostadero_simulacion
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error guardando simulación de tostadero:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
