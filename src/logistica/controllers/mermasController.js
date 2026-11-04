const BunkerService = require('../services/bunkerService');

exports.obtenerHistorialMermas = async (req, res) => {
    try {
        const { sku_salida } = req.query;
        if (!sku_salida) {
            return res.status(400).json({ success: false, error: 'Falta parámetro sku_salida' });
        }

        console.log(`🔍 [SONDA UP BACKEND HARD-DEBUG] Request mermas-historicas sku_salida: "${sku_salida}"`);

        // 1. Detección Relacional Determinista de 4 Niveles por Claves Foráneas Puras (Fase 2 - v5.43)
        const queryRelDura = `
            SELECT 
                ba_up.articulo_id AS sku_up,
                COALESCE(ba_up.descripcion_generada, ba_up.descripcion) AS descripcion_up_generada,
                ba_up.kilos_unidad AS kilos_unidad_entrada,
                ba_nexo.articulo_id AS sku_nexo_ingrediente,
                COALESCE(ba_nexo.descripcion_generada, ba_nexo.descripcion) AS descripcion_nexo_generada,
                COALESCE(r.multiplicador_ingredientes, 1.0000) AS factor_conversion,
                TRUE AS is_unidad_productiva
            FROM public.articulos_produccion_externa_relacion r
            JOIN public.bunker_articulos ba_up ON (ba_up.articulo_id = r.articulo_produccion_codigo)
            JOIN public.recetas rec ON (rec.articulo_numero = ba_up.articulo_id)
            JOIN public.receta_articulos ra ON (ra.receta_id = rec.id)
            JOIN public.bunker_articulos ba_nexo ON (ba_nexo.articulo_id = ra.articulo_numero)
            WHERE r.articulo_kilo_codigo = $1
            ORDER BY r.id ASC
            LIMIT 1;
        `;
        // Check if sku_salida has a DIRECT, strict record in articulos_produccion_externa_relacion
        const directRes = await req.db.query(`
            SELECT EXISTS (
                SELECT 1 FROM public.articulos_produccion_externa_relacion
                WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
            ) AS vinculo_directo;
        `, [sku_salida]);
        const vinculo_directo = !!(directRes.rows[0] && directRes.rows[0].vinculo_directo);

        const relRes = await req.db.query(queryRelDura, [sku_salida]);
        console.log(`🔍 [SONDA UP BACKEND DETERMINISTA v5.43] relRes rows count: ${relRes.rows.length} (vinculo_directo: ${vinculo_directo})`, relRes.rows);
        
        let sku_up = null;
        let descripcion_up_generada = '';
        let sku_nexo_ingrediente = null;
        let descripcion_nexo_generada = '';
        let factor_conversion = 1.0000;
        let is_unidad_productiva = false;
        let ingredientes_custom = null;
        let sku_entrada = null;
        let descripcion_entrada = '';
        let kilos_unidad_entrada = 1.00;
        
        if (relRes.rows.length > 0) {
            sku_up = relRes.rows[0].sku_up;
            descripcion_up_generada = relRes.rows[0].descripcion_up_generada;
            kilos_unidad_entrada = parseFloat(relRes.rows[0].kilos_unidad_entrada) || 1.00;
            sku_nexo_ingrediente = relRes.rows[0].sku_nexo_ingrediente;
            descripcion_nexo_generada = relRes.rows[0].descripcion_nexo_generada;
            factor_conversion = parseFloat(relRes.rows[0].factor_conversion) || 1.0000;
            is_unidad_productiva = true;

            // 🎯 SEPARACIÓN ESTRUCTURAL DE DOMINIOS (v5.43c):
            // sku_entrada y descripcion_entrada corresponden al INSUMO FÍSICO NEXO (Mezcla BARRA Flor x 4kg / MPB)
            sku_entrada = sku_nexo_ingrediente || sku_up;
            descripcion_entrada = descripcion_nexo_generada || descripcion_up_generada;
        }

        // Si no hay relación configurada, devolvemos sin historial pero informando que no hay vínculo
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
                ingredientes_extra: []
            });
        }

        // 🎯 RESOLUCIÓN EN CASCADA PARA UNIDADES PRODUCTIVAS (UP)
        let sku_entrada_original = sku_entrada;
        let sku_entrada_resuelto = sku_entrada;

        if (is_unidad_productiva && sku_nexo_ingrediente) {
            sku_entrada_resuelto = sku_nexo_ingrediente;
            descripcion_entrada = descripcion_nexo_generada || sku_nexo_ingrediente;
        } else {
            // Intentamos resolver el crudo real desde receta_articulos (artículos de depósito)
            let queryRecetaUP = `
                SELECT 
                    ra.articulo_numero as sku_real,
                    s.descripcion as descripcion_real,
                    ba.articulo_id as bunker_id,
                    COALESCE(ba.descripcion_generada, ba.descripcion) as bunker_desc
                FROM public.recetas r
                JOIN public.receta_articulos ra ON r.id = ra.receta_id
                LEFT JOIN public.stock_real_consolidado s ON s.articulo_numero = ra.articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                WHERE r.articulo_numero = $1
                LIMIT 1
            `;
            let recetaUPRes = await req.db.query(queryRecetaUP, [sku_entrada_original]);

            if (recetaUPRes.rows.length > 0 && recetaUPRes.rows[0].sku_real) {
                console.log(`🔄 [BUNKER-MERMAS] Resolviendo UP ${sku_entrada_original} a crudo real (Artículo): ${recetaUPRes.rows[0].sku_real}`);
                sku_entrada_resuelto = recetaUPRes.rows[0].sku_real;
                const bDesc = recetaUPRes.rows[0].bunker_desc;
                const lDesc = (recetaUPRes.rows[0].descripcion_real || sku_entrada_resuelto).trim();
                if (bDesc) {
                    descripcion_entrada = bDesc;
                } else {
                    descripcion_entrada = `Sin alta Búnker (${lDesc})`;
                }
            }
        }

        // Devolvemos el crudo resuelto como entrada principal
        sku_entrada = sku_entrada_resuelto;

        // 2. Obtener el blueprint (peso total de la receta de la Unidad Productiva / sku_entrada_original)
        const queryBlueprint = `
            SELECT 
                r.id as receta_id,
                COALESCE(
                    (SELECT SUM(CAST(ri.cantidad AS DECIMAL(20, 10)))
                     FROM public.receta_ingredientes ri
                     WHERE ri.receta_id = r.id), 
                    0
                ) as sum_ingredientes,
                COALESCE(
                    (SELECT SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20, 10)), ba.kilos_unidad, 1.0000))
                     FROM public.receta_articulos ra
                     LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                     LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                     WHERE ra.receta_id = r.id),
                    0
                ) as sum_articulos
            FROM public.recetas r
            WHERE r.articulo_numero = $1
            LIMIT 1
        `;
        const bpRes = await req.db.query(queryBlueprint, [sku_entrada_original]);
        
        let baseMixWeight = parseFloat(kilos_unidad_entrada) || 7.00;
        let extraIngsWeight = 0;
        
        if (bpRes.rows.length > 0) {
            baseMixWeight = parseFloat(bpRes.rows[0].sum_articulos) || baseMixWeight;
            extraIngsWeight = parseFloat(bpRes.rows[0].sum_ingredientes) || 0;
        }
        
        const blueprintWeight = baseMixWeight + extraIngsWeight;

        // 3. Resolver los ingredientes extra e inyectar sus costos
        let ingredientesExtra = [];
        if (ingredientes_custom && Array.isArray(ingredientes_custom) && ingredientes_custom.length > 0) {
            const nombres = ingredientes_custom.map(i => i.nombre_ingrediente);
            const queryIngs = `
                SELECT id, nombre, costo_patron, unidad_medida 
                FROM public.ingredientes 
                WHERE nombre = ANY($1)
            `;
            const ingsRes = await req.db.query(queryIngs, [nombres]);
            const ingsMap = new Map(ingsRes.rows.map(i => [i.nombre.toLowerCase().trim(), i]));
            
            ingredientesExtra = ingredientes_custom.map(i => {
                const matched = ingsMap.get(String(i.nombre_ingrediente).toLowerCase().trim());
                return {
                    ingrediente_id: matched ? matched.id : i.ingrediente_id,
                    nombre_ingrediente: i.nombre_ingrediente,
                    cantidad: parseFloat(i.cantidad) || 0,
                    unidad_medida: matched ? matched.unidad_medida : (i.unidad_medida || 'Kilo'),
                    costo_patron: matched ? parseFloat(matched.costo_patron) : 0
                };
            });
        } else {
            // Buscar la receta por defecto de la salida
            const queryRecetaDefault = `
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
            `;
            const recRes = await req.db.query(queryRecetaDefault, [sku_salida]);
            ingredientesExtra = recRes.rows.map(i => ({
                ingrediente_id: i.ingrediente_id,
                nombre_ingrediente: i.nombre_ingrediente,
                cantidad: parseFloat(i.cantidad) || 0,
                unidad_medida: i.unidad_medida || 'Kilo',
                costo_patron: parseFloat(i.costo_patron) || 0
            }));
        }

        // 4. Obtener el historial completo con SQL 100% dinámico de alta velocidad (v5.61 - Cero Hardcodeo)
        const queryHistorialAll = `
            WITH skus_familia AS (
                SELECT articulo_produccion_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT articulo_kilo_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT $1 AS sku
                UNION
                SELECT $2 AS sku
            ),
            blueprint_por_up AS (
                SELECT 
                    r.articulo_numero AS up_sku,
                    COALESCE(
                        (SELECT SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20, 10)), ba.kilos_unidad, 1.00))
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
                WHERE r.articulo_numero IN (SELECT sku FROM skus_familia)
            )
            SELECT 
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
                COALESCE(
                    peh.kilos_entrada,
                    NULLIF((COALESCE(bp.masa_base_blueprint, 0) + COALESCE(bp.masa_agregados_blueprint, 0)) * (
                        CASE 
                            -- Solo en Barritas (LDN 5) el blueprint se define por batch estándar de 4.80 kg
                            WHEN (peh.articulo_padre_id ILIKE 'BF%' OR peh.articulo_fraccionado_id ILIKE 'BF%') 
                                 AND COALESCE(bp.masa_base_blueprint, 0) > 0 AND CAST(peh.kilos_producidos AS DECIMAL(20,10)) > 0
                            THEN CAST(peh.kilos_producidos AS DECIMAL(20,10)) / 4.80
                            -- En Tostadero (LDN 4) y Granolas (LDN 6), la masa base del blueprint es directa
                            ELSE 1.0 
                        END
                    ), 0),
                    0
                ) AS kilos_entrada,
                COALESCE(peh.kilos_salida, peh.kilos_producidos) AS kilos_salida,
                peh.kilos_producidos
            FROM public.produccion_externa_historial peh
            LEFT JOIN blueprint_por_up bp ON bp.up_sku = peh.articulo_padre_id
            WHERE peh.articulo_padre_id IN (SELECT sku FROM skus_familia)
               OR peh.articulo_fraccionado_id IN (SELECT sku FROM skus_familia)
            ORDER BY peh.fecha_registro DESC
        `;
        const histRes = await req.db.query(queryHistorialAll, [sku_salida, sku_entrada_resuelto]);

        let sumMermas = 0;
        let countMermas = 0;
        let mappedHistorial = [];

        histRes.rows.forEach((h, index) => {
            const entTotal = parseFloat(h.kilos_entrada) || 0;
            const sal = parseFloat(h.kilos_salida) || parseFloat(h.kilos_producidos) || 0;
            
            h.kilos_entrada = entTotal;
            h.kilos_salida = sal;
            
            let mermaCalc = 0;
            if (entTotal > 0) {
                mermaCalc = Number((((entTotal - sal) / entTotal) * 100).toFixed(2));
            }
            if (mermaCalc < 0) mermaCalc = 0;
            
            h.porcentaje_merma = mermaCalc;
            
            // Acumular mermas mayores a 0%
            if (mermaCalc > 0) {
                sumMermas += mermaCalc;
                countMermas++;
            }
            
            if (index < 5) {
                mappedHistorial.push(h);
            }
        });

        const merma_promedio = countMermas > 0 ? Number((sumMermas / countMermas).toFixed(2)) : 0;
        const total_carros = countMermas;
        const ultima_merma = mappedHistorial.length > 0 ? parseFloat(mappedHistorial[0].porcentaje_merma) : 0;

        let costoVivoNexoObj = { costo_kilo_crudo: 0, kilos_bulto: 1, fuente_aplicada: 'N/A' };
        if (sku_nexo_ingrediente) {
            costoVivoNexoObj = await BunkerService.obtenerCostoVivoNexo(req.db, sku_nexo_ingrediente);
        }

        // Detección canónica de Línea de Negocio Externa (Flujos 4, 5 y 6)
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
                nombre_oficial: descripcion_nexo_generada
            },
            ingesta_financiera_caja_2: {
                costo_kilo_sugerido: costoVivoNexoObj.costo_kilo_crudo,
                costo_kilo_insumos_puro: costoVivoNexoObj.costo_kilo_insumos_puro || costoVivoNexoObj.costo_kilo_crudo,
                costo_tiempo_mo_kilo: costoVivoNexoObj.costo_tiempo_mo_kilo || 0,
                kilos_bulto: costoVivoNexoObj.kilos_bulto || 1.00,
                costo_bulto_total: Number(((costoVivoNexoObj.costo_kilo_crudo || 0) * (costoVivoNexoObj.kilos_bulto || 1.00)).toFixed(2)),
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
