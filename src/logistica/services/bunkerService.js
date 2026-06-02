/**
 * Servicio de Búnker (Core Financiero)
 * Maneja la lógica de negocio y base de datos para los artículos del Búnker
 */

class BunkerService {
    /**
     * Obtener todas las listas activas de bunker_listas_precios
     */
    static async getListasActivas(db) {
        const query = `
            SELECT id, nombre, activa, descripcion 
            FROM public.bunker_listas_precios 
            WHERE activa = true 
            ORDER BY id ASC
        `;
        const result = await db.query(query);
        return result.rows;
    }

    /**
     * Crear una nueva lista de precios
     */
    static async crearLista(db, payload) {
        const { nombre, descripcion, activa } = payload;
        const sql = `
            INSERT INTO public.bunker_listas_precios (nombre, descripcion, activa)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await db.query(sql, [nombre, descripcion, activa !== undefined ? activa : true]);
        return result.rows[0];
    }

    /**
     * Actualizar una lista de precios
     */
    static async actualizarLista(db, id, payload) {
        const { nombre, descripcion, activa } = payload;
        const sql = `
            UPDATE public.bunker_listas_precios
            SET nombre = COALESCE($2, nombre),
                descripcion = COALESCE($3, descripcion),
                activa = COALESCE($4, activa),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        const result = await db.query(sql, [id, nombre, descripcion, activa]);
        return result.rows[0];
    }

    /**
     * Eliminar una lista de precios
     */
    static async eliminarLista(db, id) {
        const sql = `DELETE FROM public.bunker_listas_precios WHERE id = $1`;
        const result = await db.query(sql, [id]);
        return result.rowCount > 0;
    }

    /**
     * Buscar artículos de insumos restringidos al entorno Búnker (Fase 1)
     */
    static async buscarInsumosBunker(db, query) {
        const tokens = query.split(' ').filter(t => t.trim() !== '');
        if (tokens.length === 0) return [];
        
        let sql = `
            SELECT 
                b.articulo_id as id, 
                b.descripcion, 
                b.descripcion_generada, 
                b.costo_base
            FROM public.bunker_articulos b
            WHERE 1=1
        `;
        
        let params = [];
        tokens.forEach((token, i) => {
            const paramIdx = i + 1;
            sql += ` AND (b.descripcion ILIKE $${paramIdx} OR b.descripcion_generada ILIKE $${paramIdx} OR b.articulo_id ILIKE $${paramIdx})`;
            params.push(`%${token}%`);
        });
        
        sql += ` ORDER BY b.descripcion_generada ASC LIMIT 30`;
        const result = await db.query(sql, params);
        return result.rows;
    }

    /**
     * Buscar términos en el diccionario ("On-The-Fly")
     */
    static async buscarDiccionario(db, query) {
        const sql = `
            SELECT id, termino, abreviatura, categoria 
            FROM public.bunker_diccionario 
            WHERE termino ILIKE $1 OR abreviatura ILIKE $1
            ORDER BY termino ASC LIMIT 50
        `;
        const result = await db.query(sql, [`%${query}%`]);
        return result.rows;
    }

    /**
     * Buscar artículos en stock_real_consolidado (Fase 3 - Multi-token UAT con Join Financiero)
     */
    static async buscarConsolidado(db, query) {
        const tokens = query.split(' ').filter(t => t.trim() !== '');
        if (tokens.length === 0) return [];
        
        let sql = `
            SELECT 
                s.articulo_numero as id, 
                s.codigo_barras, 
                s.descripcion,
                s.kilos_unidad,
                p.costo as costo_base,
                p.iva as porcentaje_iva,
                CASE WHEN b.articulo_id IS NOT NULL THEN true ELSE false END as ya_enriquecido
            FROM public.stock_real_consolidado s
            LEFT JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
            LEFT JOIN public.bunker_articulos b ON b.articulo_id = s.articulo_numero
            WHERE 1=1
        `;
        
        let params = [];
        tokens.forEach((token, i) => {
            const paramIdx = i + 1;
            sql += ` AND (s.descripcion ILIKE $${paramIdx} OR s.codigo_barras ILIKE $${paramIdx} OR s.articulo_numero ILIKE $${paramIdx})`;
            params.push(`%${token}%`);
        });
        
        sql += ` ORDER BY s.descripcion ASC LIMIT 50`;
        const result = await db.query(sql, params);
        return result.rows;
    }

    /**
     * Alta o Actualización Transaccional (Búnker y legacy tabla `articulos` UPSERT)
     */
    static async crearArticuloTransaccional(db, articuloData, listasMargenes, nuevosTerminos = []) {
        // Obtenemos el cliente para la transacción
        const client = await db.connect();
        
        try {
            await client.query('BEGIN');

            const {
                articulo_id,
                descripcion,
                codigo_barras,
                costo_base,
                porcentaje_iva,
                moneda,
                redondeo,
                mantener_utilidad,
                rubro,
                sub_rubro,
                no_producido_por_lambda,
                kilos_unidad,
                es_pack,
                pack_hijo_codigo,
                descripcion_abreviada,
                propiedades_dinamicas,
                expresado_en_gramos
            } = articuloData;

            // 1. Guardar términos nuevos "On-The-Fly"
            if (nuevosTerminos && Array.isArray(nuevosTerminos)) {
                for (const term of nuevosTerminos) {
                    const queryDict = `
                        INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (termino) DO NOTHING
                    `;
                    await client.query(queryDict, [term.termino, term.abreviatura, term.categoria || 'general']);
                }
            }

            // 2. Insertar o Actualizar en la tabla core del búnker: `bunker_articulos` (Shadow Mode FASE 5)
            const descFinal = descripcion_abreviada || descripcion;
            const queryBunker = `
                INSERT INTO public.bunker_articulos (
                    articulo_id, descripcion, descripcion_generada, costo_base, porcentaje_iva, moneda, redondeo, mantener_utilidad,
                    rubro, sub_rubro, no_producido_por_lambda, kilos_unidad, es_pack, pack_hijo_codigo,
                    propiedades_dinamicas, expresado_en_gramos
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
                )
                ON CONFLICT (articulo_id) DO UPDATE SET
                    descripcion = EXCLUDED.descripcion,
                    descripcion_generada = EXCLUDED.descripcion_generada,
                    costo_base = EXCLUDED.costo_base,
                    porcentaje_iva = EXCLUDED.porcentaje_iva,
                    moneda = EXCLUDED.moneda,
                    redondeo = EXCLUDED.redondeo,
                    mantener_utilidad = EXCLUDED.mantener_utilidad,
                    rubro = EXCLUDED.rubro,
                    sub_rubro = EXCLUDED.sub_rubro,
                    no_producido_por_lambda = EXCLUDED.no_producido_por_lambda,
                    kilos_unidad = EXCLUDED.kilos_unidad,
                    es_pack = EXCLUDED.es_pack,
                    pack_hijo_codigo = EXCLUDED.pack_hijo_codigo,
                    propiedades_dinamicas = EXCLUDED.propiedades_dinamicas,
                    expresado_en_gramos = EXCLUDED.expresado_en_gramos
            `;
            await client.query(queryBunker, [
                articulo_id, descripcion, descFinal, costo_base || 0, porcentaje_iva || 21.00, moneda || '($)Pesos', redondeo || 'Ninguno',
                mantener_utilidad || false, rubro || null, sub_rubro || null, no_producido_por_lambda || false,
                kilos_unidad || 0, es_pack || false, pack_hijo_codigo || null,
                propiedades_dinamicas ? JSON.stringify(propiedades_dinamicas) : '{}',
                expresado_en_gramos || false
            ]);

            // 4. Upsert Iterativo en los márgenes: `bunker_margenes`
            if (listasMargenes && Array.isArray(listasMargenes)) {
                for (const item of listasMargenes) {
                    const queryMargen = `
                        INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (articulo_id, lista_id) 
                        DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                    `;
                    await client.query(queryMargen, [articulo_id, item.lista_id, item.margen_porcentaje]);
                }
            }

            await client.query('COMMIT');
            return {
                articulo_id,
                descripcion,
                codigo_barras,
                status: 'Bunker Created'
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Consultar artículo fusionado
     */
    static async obtenerArticulo(db, articulo_id) {
        // En esta fase, obtenemos directamente del bunker y sus listas
        const queryArticulo = `
            SELECT * FROM public.bunker_articulos WHERE articulo_id = $1
        `;
        const resArticulo = await db.query(queryArticulo, [articulo_id]);
        
        if (resArticulo.rows.length === 0) {
            return null;
        }

        const articulo = resArticulo.rows[0];

        const queryMargenes = `
            SELECT id, lista_id, margen_porcentaje 
            FROM public.bunker_margenes 
            WHERE articulo_id = $1
        `;
        const resMargenes = await db.query(queryMargenes, [articulo_id]);
        
        articulo.margenes = resMargenes.rows;

        // También buscamos en articulos consolidados para recuperar el código de barras legacy si existe
        const queryLegacy = `SELECT descripcion, codigo_barras FROM public.stock_real_consolidado WHERE articulo_numero = $1`;
        const resLegacy = await db.query(queryLegacy, [articulo_id]);
        if (resLegacy.rows.length > 0) {
            if (!articulo.descripcion) articulo.descripcion = resLegacy.rows[0].descripcion;
            articulo.codigo_barras = resLegacy.rows[0].codigo_barras;
        }

        return articulo;
    }

    /**
     * Actualizar artículo en Búnker y UPSERT de márgenes
     */
    static async actualizarArticuloTransaccional(db, articulo_id, articuloData, listasMargenes) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const {
                costo_base,
                porcentaje_iva,
                moneda,
                redondeo,
                mantener_utilidad,
                rubro,
                sub_rubro,
                no_producido_por_lambda,
                kilos_unidad,
                es_pack,
                pack_hijo_codigo
            } = articuloData;

            // Update en bunker_articulos
            const queryBunker = `
                UPDATE public.bunker_articulos SET 
                    costo_base = COALESCE($2, costo_base),
                    porcentaje_iva = COALESCE($3, porcentaje_iva),
                    moneda = COALESCE($4, moneda),
                    redondeo = COALESCE($5, redondeo),
                    mantener_utilidad = COALESCE($6, mantener_utilidad),
                    rubro = COALESCE($7, rubro),
                    sub_rubro = COALESCE($8, sub_rubro),
                    no_producido_por_lambda = COALESCE($9, no_producido_por_lambda),
                    kilos_unidad = COALESCE($10, kilos_unidad),
                    es_pack = COALESCE($11, es_pack),
                    pack_hijo_codigo = COALESCE($12, pack_hijo_codigo)
                WHERE articulo_id = $1
            `;
            await client.query(queryBunker, [
                articulo_id, costo_base, porcentaje_iva, moneda, redondeo,
                mantener_utilidad, rubro, sub_rubro, no_producido_por_lambda,
                kilos_unidad, es_pack, pack_hijo_codigo
            ]);

            // Upsert en bunker_margenes
            if (listasMargenes && Array.isArray(listasMargenes)) {
                for (const item of listasMargenes) {
                    const queryMargen = `
                        INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (articulo_id, lista_id) 
                        DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                    `;
                    await client.query(queryMargen, [articulo_id, item.lista_id, item.margen_porcentaje]);
                }
            }

            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Eliminar artículo exclusivamente del Búnker
     */
    static async eliminarArticuloTransaccional(db, articulo_id) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            
            // Eliminar registros financieros asociados
            await client.query(`DELETE FROM public.bunker_margenes WHERE articulo_id = $1`, [articulo_id]);
            await client.query(`DELETE FROM public.bunker_lista_articulos WHERE articulo_numero = $1`, [articulo_id]);
            
            // Eliminar el artículo base del Búnker
            const result = await client.query(`DELETE FROM public.bunker_articulos WHERE articulo_id = $1`, [articulo_id]);
            
            await client.query('COMMIT');
            return result.rowCount > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Helper de alto rendimiento para resolver costos "En Vivo" por receta, lote o manual
     */
    static async resolverCostosEnVivo(db) {
        // 1. Obtener costos unitarios de precios_articulos
        const resPrecios = await db.query("SELECT articulo, costo FROM public.precios_articulos");
        const preciosMap = new Map();
        resPrecios.rows.forEach(r => preciosMap.set(r.articulo, parseFloat(r.costo || 0)));

        // 2. Obtener últimos lotes vinculados por destino_id
        const resLotes = await db.query(`
            SELECT DISTINCT ON (destino_id) destino_id, costo_kilo_al_momento, v.lote_id_supabase, v.fecha_vinculacion
            FROM public.bunker_lotes_destinos d
            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
            ORDER BY destino_id, v.fecha_vinculacion DESC
        `);
        const lotesMap = new Map();
        resLotes.rows.forEach(r => lotesMap.set(r.destino_id, {
            costo_kilo: parseFloat(r.costo_kilo_al_momento || 0),
            lote_id: r.lote_id_supabase,
            fecha: r.fecha_vinculacion
        }));

        // 3. Obtener recetas activas por artículo
        const resRecetas = await db.query(`
            SELECT r.id as receta_id, r.articulo_numero
            FROM public.recetas r
            ORDER BY r.fecha_creacion DESC
        `);
        
        // Agrupar recetas por articulo_numero (la primera es la más nueva)
        const recetaMap = new Map();
        resRecetas.rows.forEach(r => {
            if (!recetaMap.has(r.articulo_numero)) {
                recetaMap.set(r.articulo_numero, r.receta_id);
            }
        });

        // 4. Obtener todos los ingredientes de receta
        const resIngredientes = await db.query(`
            SELECT ri.receta_id, ri.nombre_ingrediente, ri.cantidad, ri.unidad_medida, ri.ingrediente_id
            FROM public.receta_ingredientes ri
            ORDER BY ri.id ASC
        `);
        
        const ingredientesPorReceta = new Map();
        resIngredientes.rows.forEach(ri => {
            if (!ingredientesPorReceta.has(ri.receta_id)) {
                ingredientesPorReceta.set(ri.receta_id, []);
            }
            ingredientesPorReceta.get(ri.receta_id).push(ri);
        });

        return { preciosMap, lotesMap, recetaMap, ingredientesPorReceta };
    }

    /**
     * Calcula el costo de ingrediente en vivo basándose en recetas o lotes vinculados (Estrictamente POR KILOGRAMO)
     */
    static calcularCostoIngredienteEnVivo(articulo_id, pack_hijo_codigo, costo_base_manual, context, kilos_unidad = 1) {
        const { lotesMap, recetaMap, ingredientesPorReceta } = context;
        const codigoBase = pack_hijo_codigo || articulo_id;
        const recetaId = recetaMap.get(codigoBase);
        const factor = parseFloat(kilos_unidad) > 0 ? parseFloat(kilos_unidad) : 1;

        if (recetaId && ingredientesPorReceta.has(recetaId)) {
            const ingredientes = ingredientesPorReceta.get(recetaId);
            let costoTotalReceta = 0;
            ingredientes.forEach(ing => {
                const ingIdStr = String(ing.ingrediente_id);
                const loteIng = lotesMap.get(ingIdStr);
                const costoKilo = loteIng ? loteIng.costo_kilo : 0;
                costoTotalReceta += parseFloat(ing.cantidad) * costoKilo;
            });
            if (costoTotalReceta > 0) {
                // La receta representa la producción del bulto total, por ende la dividimos por el factor para tener el costo por kilo
                return costoTotalReceta / factor;
            }
        }

        // Fallback 1: Último lote shadow directo
        const loteDirecto = lotesMap.get(codigoBase);
        if (loteDirecto) {
            // El costo del lote directo ya está expresado por kilogramo
            return loteDirecto.costo_kilo;
        }

        // Fallback 2: Costo manual del búnker (guardado a nivel bulto, lo dividimos por el factor)
        return parseFloat(costo_base_manual || 0) / factor;
    }

    /**
     * Calcula el costo de insumos en vivo
     */
    static calcularCostoInsumosEnVivo(insumos, context) {
        const { preciosMap } = context;
        let totalInsumos = 0;
        if (insumos && Array.isArray(insumos)) {
            insumos.forEach(ins => {
                const liveCost = preciosMap.get(ins.insumo_articulo_numero) || 0;
                totalInsumos += parseFloat(ins.cantidad) * liveCost;
            });
        }
        return totalInsumos;
    }

    /**
     * Obtener el dashboard completo de Búnker con Motor de Alertas e Integración de Listas Dinámicas
     */
    static async obtenerTodosLosArticulos(db, filtros = {}) {
        let query = `
            SELECT 
                b.articulo_id, 
                b.descripcion, 
                b.descripcion_generada, 
                b.costo_base, 
                b.porcentaje_iva,
                b.propiedades_dinamicas,
                b.rubro,
                b.sub_rubro,
                b.pack_hijo_codigo,
                b.kilos_unidad,
                CASE 
                    WHEN b.kilos_unidad > 0 THEN 
                        COALESCE(
                            (SELECT SUM(d.kilos_asignados) 
                             FROM public.bunker_lotes_destinos d 
                             WHERE d.destino_id = b.articulo_id), 
                        0) / b.kilos_unidad
                    ELSE 
                        COALESCE(
                            (SELECT SUM(d.cantidad_asignada) 
                             FROM public.bunker_lotes_destinos d 
                             WHERE d.destino_id = b.articulo_id), 
                        0)
                END as stock_unidades,
                COALESCE(
                    (SELECT SUM(d.kilos_asignados) 
                     FROM public.bunker_lotes_destinos d 
                     WHERE d.destino_id = b.articulo_id), 
                0) as stock_kilos,
                COALESCE(
                    (SELECT COUNT(*) 
                     FROM public.bunker_lotes_destinos d 
                     WHERE d.destino_id = b.articulo_id), 
                0) as total_lotes_historicos,
                COALESCE(
                    (SELECT COUNT(*) 
                     FROM public.recetas r 
                     WHERE r.articulo_numero = b.articulo_id), 
                0) as total_recetas,
                COALESCE(
                    (SELECT COUNT(*) 
                     FROM public.bunker_articulos_reposicion_mapeo m 
                     WHERE LOWER(m.bunker_articulo_id) = LOWER(b.articulo_id)
                        OR (b.pack_hijo_codigo IS NOT NULL AND LOWER(m.bunker_articulo_id) = LOWER(b.pack_hijo_codigo))), 
                0) as total_mapeos_reposicion
            FROM public.bunker_articulos b
            WHERE 1=1
        `;
        let params = [];
        let pIndex = 1;

        if (filtros.search) {
            query += ` AND (b.descripcion_generada ILIKE $${pIndex} OR b.descripcion ILIKE $${pIndex} OR b.articulo_id ILIKE $${pIndex})`;
            params.push(`%${filtros.search}%`);
            pIndex++;
        }
        
        query += ` ORDER BY b.descripcion_generada ASC LIMIT 1000`;
        const result = await db.query(query, params);
        const articles = result.rows;

        if (articles.length === 0) return [];

        // 1. Obtener contexto de costos en vivo
        const context = await this.resolverCostosEnVivo(db);

        // 2. Obtener todas las configuraciones de listas para todos los artículos
        const queryLA = `
            SELECT 
                la.id,
                la.lista_id,
                la.articulo_numero,
                la.margen_ganancia,
                la.costo_base_sobrescrito,
                la.costo_tiempo,
                la.iva,
                la.precio_final,
                la.modo_calculo,
                COALESCE(la.modo_iva, 'COMPLETO') as modo_iva,
                COALESCE(la.es_patron, false) as es_patron
            FROM public.bunker_lista_articulos la
        `;
        const resLA = await db.query(queryLA);
        
        // Agrupar configuraciones por articulo_numero
        const configsPorArt = new Map();
        resLA.rows.forEach(r => {
            if (!configsPorArt.has(r.articulo_numero)) {
                configsPorArt.set(r.articulo_numero, []);
            }
            configsPorArt.get(r.articulo_numero).push(r);
        });

        // 3. Obtener todos los insumos
        const queryInsumos = `
            SELECT li.lista_articulo_id, li.insumo_articulo_numero, li.cantidad, li.costo_unitario_capturado
            FROM public.bunker_lista_insumos li
        `;
        const resInsumos = await db.query(queryInsumos);
        const insumosPorLA = new Map();
        resInsumos.rows.forEach(r => {
            if (!insumosPorLA.has(r.lista_articulo_id)) {
                insumosPorLA.set(r.lista_articulo_id, []);
            }
            insumosPorLA.get(r.lista_articulo_id).push(r);
        });

        // 4. Obtener márgenes legacy para fallback
        const queryLegacy = `SELECT articulo_id, lista_id, margen_porcentaje FROM public.bunker_margenes`;
        const resLegacy = await db.query(queryLegacy);
        const legacyPorArt = new Map();
        resLegacy.rows.forEach(r => {
            if (!legacyPorArt.has(r.articulo_id)) {
                legacyPorArt.set(r.articulo_id, []);
            }
            legacyPorArt.get(r.articulo_id).push(r);
        });

        // 5. Pre-cargar artículos patrón para herencia de márgenes O(1)
        const queryPatrones = `
            SELECT la.lista_id, la.margen_ganancia, ba.articulo_id, ba.pack_hijo_codigo, COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion_patron
            FROM public.bunker_lista_articulos la
            JOIN public.bunker_articulos ba ON la.articulo_numero = ba.articulo_id
            WHERE la.es_patron = true
        `;
        const resPatrones = await db.query(queryPatrones);
        const patronesMap = new Map();
        resPatrones.rows.forEach(p => {
            const baseIng = p.pack_hijo_codigo || p.articulo_id;
            const key = `${p.lista_id}_${baseIng}`;
            patronesMap.set(key, {
                margen_ganancia: parseFloat(p.margen_ganancia),
                articulo_id: p.articulo_id,
                descripcion_patron: p.descripcion_patron
            });
        });

        // Enrich articles
        for (const art of articles) {
            const artConfigs = configsPorArt.get(art.articulo_id) || [];
            const factor = parseFloat(art.kilos_unidad) > 0 ? parseFloat(art.kilos_unidad) : 1;
            
            // Obtener el costo del ingrediente en vivo (POR KILO)
            const liveIngredienteCost = BunkerService.calcularCostoIngredienteEnVivo(art.articulo_id, art.pack_hijo_codigo, art.costo_base, context, factor);
            const baseIng = art.pack_hijo_codigo || art.articulo_id;

            if (artConfigs.length > 0) {
                // Mapear configuraciones nuevas
                art.margenes = artConfigs.map(la => {
                    const laInsumos = insumosPorLA.get(la.id) || [];
                    const liveInsumoCost = BunkerService.calcularCostoInsumosEnVivo(laInsumos, context);
                    
                    // Lógica del Bulto Comercial: Costo Bulto Base = Costo Kilo * Factor
                    const cBase = la.costo_base_sobrescrito !== null ? parseFloat(la.costo_base_sobrescrito) : liveIngredienteCost;
                    const baseCostoVivo = (cBase * factor) + liveInsumoCost;

                    // Calcular margen implícito en base al costo del bulto
                    const ivaCoeff = 1 + (parseFloat(la.iva) / 100);
                    const precioS_iva = parseFloat(la.precio_final) / ivaCoeff;
                    const costoOperativo = parseFloat(la.costo_tiempo);

                    let margenImplicito = 0;
                    if (baseCostoVivo > 0) {
                        margenImplicito = ((precioS_iva - costoOperativo) / baseCostoVivo - 1) * 100;
                    }

                    const targetMargen = parseFloat(la.margen_ganancia);
                    const diffMargen = targetMargen - margenImplicito;
                    const costo_desactualizado = Math.abs(diffMargen) > 0.1; // Desvío superior al 0.1% de margen

                    // Buscar margen heredado
                    const keyPatron = `${la.lista_id}_${baseIng}`;
                    const patronInfo = patronesMap.get(keyPatron);
                    let margenHeredado = null;
                    let descripcionPatron = null;
                    if (patronInfo && patronInfo.articulo_id !== art.articulo_id) {
                        margenHeredado = patronInfo.margen_ganancia;
                        descripcionPatron = patronInfo.descripcion_patron;
                    }

                    return {
                        lista_id: la.lista_id,
                        margen_porcentaje: la.margen_ganancia, // compatibilidad
                        costo_base_sobrescrito: la.costo_base_sobrescrito,
                        costo_tiempo: la.costo_tiempo,
                        iva: la.iva,
                        precio_final: la.precio_final,
                        modo_calculo: la.modo_calculo,
                        costo_desactualizado: costo_desactualizado,
                        costo_ingrediente_en_vivo: liveIngredienteCost, // Guarda costo por KILO
                        costo_insumos_en_vivo: liveInsumoCost,
                        margen_implicito: margenImplicito,
                        modo_iva: la.modo_iva,
                        es_patron: la.es_patron,
                        margen_patron_heredado: margenHeredado,
                        descripcion_patron: descripcionPatron
                    };
                });
            } else {
                // Fallback a legacy bunker_margenes
                const legacyMargenes = legacyPorArt.get(art.articulo_id) || [];
                art.margenes = legacyMargenes.map(lm => {
                    const keyPatron = `${lm.lista_id}_${baseIng}`;
                    const patronInfo = patronesMap.get(keyPatron);
                    let margenHeredado = null;
                    let descripcionPatron = null;
                    if (patronInfo && patronInfo.articulo_id !== art.articulo_id) {
                        margenHeredado = patronInfo.margen_ganancia;
                        descripcionPatron = patronInfo.descripcion_patron;
                    }

                    return {
                        lista_id: lm.lista_id,
                        margen_porcentaje: parseFloat(lm.margen_porcentaje),
                        costo_base_sobrescrito: null,
                        costo_tiempo: 0,
                        iva: art.porcentaje_iva || 21.00,
                        precio_final: (liveIngredienteCost * factor) * (1 + (parseFloat(lm.margen_porcentaje) / 100)) * (1 + ((art.porcentaje_iva || 21.00) / 100)),
                        modo_calculo: 'AUTOMATIC',
                        costo_desactualizado: false,
                        costo_ingrediente_en_vivo: liveIngredienteCost, // Guarda costo por KILO
                        costo_insumos_en_vivo: 0,
                        margen_implicito: parseFloat(lm.margen_porcentaje),
                        modo_iva: 'COMPLETO',
                        es_patron: false,
                        margen_patron_heredado: margenHeredado,
                        descripcion_patron: descripcionPatron
                    };
                });
            }
        }

        return articles;
    }

    /**
     * Obtener Radiografía Financiera con Listas de Precios Búnker y Gestión de Insumos Secundarios
     */
    static async obtenerRadiografiaFinanciera(db, articulo_id) {
        const articulo = await this.obtenerArticulo(db, articulo_id);
        if (!articulo) throw new Error('Artículo no encontrado en el Búnker');

        // Buscar el último lote recibido para el costo real
        const queryLote = `
            SELECT d.costo_kilo_al_momento, v.fecha_vinculacion, v.lote_id_supabase, v.impuesto_iva
            FROM public.bunker_lotes_destinos d
            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
            WHERE d.destino_id = $1
            ORDER BY v.fecha_vinculacion DESC
            LIMIT 1
        `;
        const resLote = await db.query(queryLote, [articulo_id]);
        
        // Obtener listas activas y hacer left join con márgenes actuales de bunker_lista_articulos
        const queryListas = `
            SELECT 
                lp.id as lista_id, 
                lp.nombre as nombre_lista,
                la.id as lista_articulo_id,
                COALESCE(la.margen_ganancia, 0) as margen_porcentaje, -- Para compatibilidad
                la.costo_base_sobrescrito,
                la.fuente_costo_default,
                COALESCE(la.costo_tiempo, 0) as costo_tiempo,
                COALESCE(la.iva, 21.00) as iva,
                COALESCE(la.precio_final, 0) as precio_final,
                COALESCE(la.modo_calculo, 'AUTOMATIC') as modo_calculo,
                COALESCE(la.modo_iva, 'COMPLETO') as modo_iva,
                COALESCE(la.es_patron, false) as es_patron
            FROM public.bunker_listas_precios lp
            LEFT JOIN public.bunker_lista_articulos la ON la.lista_id = lp.id AND la.articulo_numero = $1
            WHERE lp.activa = true
            ORDER BY lp.id ASC
        `;
        const resListas = await db.query(queryListas, [articulo_id]);

        // Consulta para buscar si existe algún hermano configurado como patrón en la lista activa
        const querySiblingPatron = `
            SELECT la.margen_ganancia, ba.articulo_id, COALESCE(ba.descripcion_generada, ba.descripcion) as descripcion_patron
            FROM public.bunker_lista_articulos la
            JOIN public.bunker_articulos ba ON la.articulo_numero = ba.articulo_id
            WHERE la.lista_id = $1
              AND la.es_patron = true
              AND ba.articulo_id != $2
              AND (
                (ba.pack_hijo_codigo IS NOT NULL AND $3::VARCHAR IS NOT NULL AND ba.pack_hijo_codigo = $3::VARCHAR)
                OR (ba.pack_hijo_codigo = $2)
                OR ($3::VARCHAR IS NOT NULL AND ba.articulo_id = $3::VARCHAR)
              )
            LIMIT 1
        `;

        // Cargar insumos adicionales para cada lista
        const listasConInsumos = [];
        for (const row of resListas.rows) {
            const listObj = { ...row };

            // Buscar si existe un patrón hermano para esta lista
            const resPatron = await db.query(querySiblingPatron, [
                row.lista_id, 
                articulo_id, 
                articulo.pack_hijo_codigo || null
            ]);
            if (resPatron.rows.length > 0) {
                listObj.margen_patron_heredado = parseFloat(resPatron.rows[0].margen_ganancia);
                listObj.articulo_patron_id = resPatron.rows[0].articulo_id;
                listObj.descripcion_patron = resPatron.rows[0].descripcion_patron;
            } else {
                listObj.margen_patron_heredado = null;
                listObj.articulo_patron_id = null;
                listObj.descripcion_patron = null;
            }

            if (row.lista_articulo_id) {
                const resIns = await db.query(`
                    SELECT li.id, li.insumo_articulo_numero, li.cantidad, li.costo_unitario_capturado,
                           p.costo as costo_unitario_en_vivo, a.nombre as descripcion
                    FROM public.bunker_lista_insumos li
                    LEFT JOIN public.precios_articulos p ON p.articulo = li.insumo_articulo_numero
                    LEFT JOIN public.articulos a ON a.numero = li.insumo_articulo_numero
                    WHERE li.lista_articulo_id = $1
                `, [row.lista_articulo_id]);
                listObj.insumos = resIns.rows;
            } else {
                // Fallback / Default vacío
                listObj.insumos = [];
            }
            listasConInsumos.push(listObj);
        }

        // Calcular stock físico (Ingresos por lotes)
        const queryStock = `
            SELECT SUM(cantidad_asignada) as stock_unidades, SUM(kilos_asignados) as stock_kilos
            FROM public.bunker_lotes_destinos
            WHERE destino_id = $1
        `;
        const resStock = await db.query(queryStock, [articulo_id]);
        const stockKilos = resStock.rows.length > 0 && resStock.rows[0].stock_kilos ? parseFloat(resStock.rows[0].stock_kilos) : 0;
        const stockUnidades = articulo.kilos_unidad > 0 ? (stockKilos / articulo.kilos_unidad) : (resStock.rows.length > 0 && resStock.rows[0].stock_unidades ? parseFloat(resStock.rows[0].stock_unidades) : 0);

        // Herencia de Costo y Receta
        let costo_referencia_lote = null;
        let costo_kilo_ingrediente = null;
        let nombre_ingrediente_ref = null;
        let lote_ingrediente_ref = null;
        let receta_id = null;
        let receta_ingredientes = [];
        let receta_articulos = [];

        try {
            let codigoBase = articulo.articulo_id;

            const queryReceta = `
                SELECT id 
                FROM public.recetas 
                WHERE articulo_numero = $1 
                ORDER BY fecha_creacion DESC 
                LIMIT 1
            `;
            let resReceta = await db.query(queryReceta, [codigoBase]);
            
            // Si el artículo no posee receta directa, intentar con su código de empaque padre (herencia)
            if (resReceta.rows.length === 0 && articulo.pack_hijo_codigo) {
                codigoBase = articulo.pack_hijo_codigo;
                resReceta = await db.query(queryReceta, [codigoBase]);
            }
            
            if (resReceta.rows.length > 0) {
                const recetaId = resReceta.rows[0].id;
                receta_id = recetaId;

                const queryIngredientes = `
                    SELECT 
                        ri.nombre_ingrediente, 
                        ri.cantidad, 
                        ri.unidad_medida, 
                        ri.ingrediente_id,
                        (
                            SELECT d.costo_kilo_al_momento
                            FROM public.bunker_lotes_destinos d
                            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                            WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' 
                              AND d.destino_id = ri.ingrediente_id::text
                            ORDER BY 
                              CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN 1 ELSE 2 END ASC,
                              v.fecha_vinculacion DESC
                            LIMIT 1
                        ) as costo_kilo_lote,
                        (
                            SELECT v.lote_id_supabase
                            FROM public.bunker_lotes_destinos d
                            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                            WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' 
                              AND d.destino_id = ri.ingrediente_id::text
                            ORDER BY 
                              CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN 1 ELSE 2 END ASC,
                              v.fecha_vinculacion DESC
                            LIMIT 1
                        ) as lote_id_ref
                    FROM public.receta_ingredientes ri
                    WHERE ri.receta_id = $1
                    ORDER BY ri.id ASC
                `;
                const resIngredientes = await db.query(queryIngredientes, [recetaId]);
                receta_ingredientes = resIngredientes.rows;

                const queryArticulos = `
                    SELECT ra.articulo_numero, ra.cantidad, a.nombre as descripcion
                    FROM public.receta_articulos ra
                    LEFT JOIN public.articulos a ON a.numero = ra.articulo_numero
                    WHERE ra.receta_id = $1
                    ORDER BY ra.id ASC
                `;
                const resArticulos = await db.query(queryArticulos, [recetaId]);
                receta_articulos = resArticulos.rows;

                // Si la receta posee exactamente 1 ingrediente directo, calculamos el costo
                if (resIngredientes.rows.length === 1) {
                    const ingrediente = resIngredientes.rows[0];
                    if (ingrediente.ingrediente_id) {
                        const queryLoteIng = `
                            SELECT d.costo_kilo_al_momento, v.lote_id_supabase, v.fecha_vinculacion
                            FROM public.bunker_lotes_destinos d
                            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                            WHERE d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = $1
                            ORDER BY 
                              CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN 1 ELSE 2 END ASC,
                              v.fecha_vinculacion DESC
                            LIMIT 1
                        `;
                        const resLoteIng = await db.query(queryLoteIng, [String(ingrediente.ingrediente_id)]);
                        
                        if (resLoteIng.rows.length > 0) {
                            const loteIng = resLoteIng.rows[0];
                            costo_kilo_ingrediente = parseFloat(loteIng.costo_kilo_al_momento);
                            costo_referencia_lote = parseFloat(ingrediente.cantidad) * costo_kilo_ingrediente;
                            nombre_ingrediente_ref = ingrediente.nombre_ingrediente;
                            lote_ingrediente_ref = loteIng.lote_id_supabase;
                        }
                    }
                }
            }
        } catch (err) {
            console.error("[BUNKER-HERENCIA] Error al procesar costo de herencia o receta:", err);
        }

        // Buscar el costo e IVA histórico de Lomasoft en la tabla precios_articulos
        // Decisión de diseño: Fase 1 de la Arquitectura de Costos Multi-Fuente (Costo e IVA Informativo Lomasoft)
        let costo_lomasoft = null;
        let iva_lomasoft = null;
        try {
            const queryLomasoft = `SELECT costo, iva FROM public.precios_articulos WHERE articulo = $1`;
            const resLomasoft = await db.query(queryLomasoft, [articulo_id]);
            if (resLomasoft.rows.length > 0) {
                costo_lomasoft = resLomasoft.rows[0].costo ? parseFloat(resLomasoft.rows[0].costo) : null;
                iva_lomasoft = resLomasoft.rows[0].iva ? parseFloat(resLomasoft.rows[0].iva) : null;
            }
        } catch (lomaErr) {
            console.error("[BUNKER-LOMASOFT] Error al recuperar costo e IVA histórico:", lomaErr);
        }

        // 4. Mapeos de reposición (Fase 4 - Enmienda Técnica)
        let reposicion_ofertas = [];
        try {
            let targetId = articulo_id;
            let esHeredado = false;
            if (articulo.pack_hijo_codigo) {
                targetId = articulo.pack_hijo_codigo;
                esHeredado = true;
            }

            let mappingsQuery = `SELECT proveedor_id, proveedor_producto_codigo FROM public.bunker_articulos_reposicion_mapeo WHERE LOWER(bunker_articulo_id) = LOWER($1)`;
            let resMappings = await db.query(mappingsQuery, [targetId]);
            let mappings = resMappings.rows;

            if (mappings.length > 0) {
                const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
                const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

                // Obtener códigos únicos mapeados
                const uniqueCodes = [...new Set(mappings.map(m => String(m.proveedor_producto_codigo).trim()))];
                if (uniqueCodes.length > 0) {
                    const inList = uniqueCodes.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',');
                    const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&or=(datos_maestros->>codigo.in.(${inList}),datos_maestros->>sku.in.(${inList}),datos_maestros->>código.in.(${inList}))`;

                    const response = await fetch(url, { headers });
                    if (response.ok) {
                        const cotizaciones = await response.json();

                        // Cargar excepciones de curaduría
                        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
                        let excepciones = [];
                        if (proveedoresIds.length > 0) {
                            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
                            const excRes = await fetch(excUrl, { headers });
                            if (excRes.ok) {
                                excepciones = await excRes.json();
                            }
                        }

                        const curaduriaMap = new Map();
                        excepciones.forEach(exc => {
                            const keyMap = `${exc.proveedor_id}_${String(exc.producto_codigo).trim().toLowerCase()}`;
                            curaduriaMap.set(keyMap, exc.unidad_fijada);
                        });

                        // Normalizar cotizaciones
                        const todasNormalizadas = cotizaciones.map(row => {
                            const dm = { ...row.datos_maestros };
                            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
                            const skuClean = String(skuProveedorRaw).trim().toLowerCase();
                            const keyMap = `${row.proveedor_id}_${skuClean}`;

                            if (curaduriaMap.has(keyMap) && curaduriaMap.get(keyMap)) {
                                dm.unidad = curaduriaMap.get(keyMap);
                            }

                            const fechaTarifa = new Date(dm.ultima_actualizacion_origen || row.timestamp_extraccion);
                            const diasAntiguedad = Math.floor((new Date() - fechaTarifa) / (1000 * 60 * 60 * 24));

                            let precioUnitarioVal = 0;
                            if (dm.precio) {
                                const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                                precioUnitarioVal = parseFloat(cleanPrice) || 0;
                            }

                            return {
                                oferta_id: row.id,
                                proveedor_id: row.proveedor_id,
                                nombre_proveedor: row.nombre_proveedor,
                                sku_proveedor: skuProveedorRaw,
                                descripcion: dm.descripcion,
                                precio_unitario: precioUnitarioVal,
                                unidad_medida: dm.unidad,
                                dias_antiguedad: diasAntiguedad >= 0 ? diasAntiguedad : 0,
                                valido_hasta: dm.ultima_actualizacion_origen || row.timestamp_extraccion,
                                timestamp_extraccion: row.timestamp_extraccion || dm.ultima_actualizacion_origen
                            };
                        });

                        // Filtrar cotizaciones para conservar solo las mapeadas exactamente por (proveedor_id, codigo)
                        const mappingsSet = new Set(mappings.map(m => `${m.proveedor_id}_${String(m.proveedor_producto_codigo).trim().toLowerCase()}`));
                        const mapeadasFiltradas = todasNormalizadas.filter(c => {
                            const skuClean = String(c.sku_proveedor).trim().toLowerCase();
                            const keyCheck = `${c.proveedor_id}_${skuClean}`;
                            return mappingsSet.has(keyCheck);
                        });

                        // De-duplicar cotizaciones: para un mismo proveedor y código, conservar únicamente la más reciente (mayor timestamp)
                        const deduplicadasMap = new Map();
                        mapeadasFiltradas.forEach(c => {
                            const skuClean = String(c.sku_proveedor).trim().toLowerCase();
                            const keyUnique = `${c.proveedor_id}_${skuClean}`;
                            
                            const tExist = deduplicadasMap.has(keyUnique) ? new Date(deduplicadasMap.get(keyUnique).timestamp_extraccion || deduplicadasMap.get(keyUnique).valido_hasta || 0).getTime() : -1;
                            const tNew = new Date(c.timestamp_extraccion || c.valido_hasta || 0).getTime();
                            if (tNew > tExist) {
                                deduplicadasMap.set(keyUnique, c);
                            }
                        });
                        const mapeadasFinales = Array.from(deduplicadasMap.values());

                        // Marcar como heredado si corresponde
                        reposicion_ofertas = mapeadasFinales.map(c => ({
                            ...c,
                            heredado: esHeredado
                        }));
                    }
                }
            }
        } catch (err) {
            console.error("❌ [BUNKER-REPOSICION] Error al procesar ofertas de reposición en radiografía:", err);
        }

        // Búsqueda en cascada de datos de costos del artículo ingrediente base padre (Fase 4)
        let parent_lote = null;
        let parent_costo_base_manual = null;
        let parent_costo_lomasoft = null;
        let parent_iva_lomasoft = null;
        let parent_descripcion = null;
        let parent_kilos_unidad = null;

        if (articulo.pack_hijo_codigo) {
            try {
                const parentId = articulo.pack_hijo_codigo;
                
                // 1. Buscar último lote físico del padre
                const queryLoteParent = `
                    SELECT d.costo_kilo_al_momento, v.fecha_vinculacion, v.lote_id_supabase, v.impuesto_iva
                    FROM public.bunker_lotes_destinos d
                    JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                    WHERE d.destino_id = $1
                    ORDER BY v.fecha_vinculacion DESC
                    LIMIT 1
                `;
                const resLoteParent = await db.query(queryLoteParent, [parentId]);
                if (resLoteParent.rows.length > 0) {
                    parent_lote = resLoteParent.rows[0];
                }

                // 2. Buscar costo base manual y descripción del padre
                const queryParentArt = `SELECT costo_base, descripcion, descripcion_generada, kilos_unidad FROM public.bunker_articulos WHERE articulo_id = $1`;
                const resParentArt = await db.query(queryParentArt, [parentId]);
                if (resParentArt.rows.length > 0) {
                    parent_costo_base_manual = resParentArt.rows[0].costo_base ? parseFloat(resParentArt.rows[0].costo_base) : null;
                    parent_descripcion = resParentArt.rows[0].descripcion_generada || resParentArt.rows[0].descripcion;
                    parent_kilos_unidad = resParentArt.rows[0].kilos_unidad ? parseFloat(resParentArt.rows[0].kilos_unidad) : 1;
                }

                // 3. Buscar costo e IVA de Lomasoft para el padre
                const queryLomasoftParent = `SELECT costo, iva FROM public.precios_articulos WHERE articulo = $1`;
                const resLomasoftParent = await db.query(queryLomasoftParent, [parentId]);
                if (resLomasoftParent.rows.length > 0) {
                    parent_costo_lomasoft = resLomasoftParent.rows[0].costo ? parseFloat(resLomasoftParent.rows[0].costo) : null;
                    parent_iva_lomasoft = resLomasoftParent.rows[0].iva ? parseFloat(resLomasoftParent.rows[0].iva) : null;
                }
            } catch (parentErr) {
                console.error("❌ [BUNKER-PADRE] Error al recuperar datos de costos del ingrediente base padre:", parentErr);
            }
        }

        return {
            articulo_id,
            codigo_barras: articulo.codigo_barras || null,
            pack_hijo_codigo: articulo.pack_hijo_codigo || null,
            costo_base_manual: articulo.costo_base,
            porcentaje_iva: articulo.porcentaje_iva,
            kilos_unidad: parseFloat(articulo.kilos_unidad || 0),
            lote: resLote.rows.length > 0 ? resLote.rows[0] : null,
            listas_margenes: listasConInsumos,
            stock_unidades: stockUnidades,
            stock_kilos: stockKilos,
            costo_referencia_lote,
            costo_kilo_ingrediente,
            nombre_ingrediente_ref,
            lote_ingrediente_ref,
            receta_id,
            receta_ingredientes,
            receta_articulos,
            costo_lomasoft,
            iva_lomasoft,
            reposicion_ofertas,
            parent_lote,
            parent_costo_base_manual,
            parent_costo_lomasoft,
            parent_iva_lomasoft,
            parent_descripcion,
            parent_kilos_unidad
        };
    }

    /**
     * Guardar/Calibrar Estructura Financiera Transaccional (Bajo acoplamiento, alta precisión)
     */
    static async actualizarEstructuraFinancieraTransaccional(db, articulo_id, payload) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const { costo_base, margenes, configs } = payload;

            // Obtener el pack_hijo_codigo de este articulo
            const resArtInfo = await client.query(
                `SELECT pack_hijo_codigo FROM public.bunker_articulos WHERE articulo_id = $1`,
                [articulo_id]
            );
            const packHijoCodigo = resArtInfo.rows.length > 0 ? resArtInfo.rows[0].pack_hijo_codigo : null;

            // 1. Actualizar el costo_base manual en bunker_articulos si viene
            if (costo_base !== undefined) {
                await client.query(`UPDATE public.bunker_articulos SET costo_base = $2 WHERE articulo_id = $1`, [articulo_id, costo_base]);
            }

            // 2. Si viene el payload nuevo 'configs' (Gestión Avanzada de Listas)
            if (configs && Array.isArray(configs)) {
                for (const conf of configs) {
                    const {
                        lista_id,
                        margen_ganancia,
                        costo_base_sobrescrito,
                        costo_tiempo,
                        iva,
                        precio_final,
                        modo_calculo,
                        insumos,
                        modo_iva,
                        es_patron,
                        fuente_costo_default
                    } = conf;

                    // Si se está seteando este artículo como patrón, limpiar el flag de los hermanos en la lista
                    if (es_patron === true || es_patron === 'true') {
                        const queryClearPatron = `
                            UPDATE public.bunker_lista_articulos
                            SET es_patron = false
                            WHERE lista_id = $1
                              AND articulo_numero IN (
                                  SELECT ba.articulo_id
                                  FROM public.bunker_articulos ba
                                  WHERE ba.articulo_id != $2
                                    AND (
                                      (ba.pack_hijo_codigo IS NOT NULL AND $3::VARCHAR IS NOT NULL AND ba.pack_hijo_codigo = $3::VARCHAR)
                                      OR (ba.pack_hijo_codigo = $2)
                                      OR ($3::VARCHAR IS NOT NULL AND ba.articulo_id = $3::VARCHAR)
                                    )
                              )
                        `;
                        await client.query(queryClearPatron, [lista_id, articulo_id, packHijoCodigo]);
                    }

                    // Upsert en bunker_lista_articulos
                    const queryLA = `
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito, 
                            costo_tiempo, iva, precio_final, modo_calculo, modo_iva, es_patron, fuente_costo_default, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
                        ) ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                            margen_ganancia = EXCLUDED.margen_ganancia,
                            costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                            costo_tiempo = EXCLUDED.costo_tiempo,
                            iva = EXCLUDED.iva,
                            precio_final = EXCLUDED.precio_final,
                            modo_calculo = EXCLUDED.modo_calculo,
                            modo_iva = EXCLUDED.modo_iva,
                            es_patron = EXCLUDED.es_patron,
                            fuente_costo_default = EXCLUDED.fuente_costo_default,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING id
                    `;
                    const resLA = await client.query(queryLA, [
                        lista_id,
                        articulo_id,
                        margen_ganancia || 0,
                        costo_base_sobrescrito !== undefined && costo_base_sobrescrito !== null ? costo_base_sobrescrito : null,
                        costo_tiempo || 0,
                        iva || 21,
                        precio_final || 0,
                        modo_calculo || 'AUTOMATIC',
                        modo_iva || 'COMPLETO',
                        es_patron === true || es_patron === 'true',
                        fuente_costo_default || null
                    ]);

                    const listaArticuloId = resLA.rows[0].id;

                    // Purgar insumos anteriores
                    await client.query(`DELETE FROM public.bunker_lista_insumos WHERE lista_articulo_id = $1`, [listaArticuloId]);

                    // Insertar insumos nuevos
                    if (insumos && Array.isArray(insumos)) {
                        for (const ins of insumos) {
                            const queryIns = `
                                INSERT INTO public.bunker_lista_insumos (
                                    lista_articulo_id, insumo_articulo_numero, cantidad, costo_unitario_capturado
                                ) VALUES ($1, $2, $3, $4)
                            `;
                            await client.query(queryIns, [
                                listaArticuloId,
                                ins.insumo_articulo_numero,
                                ins.cantidad || 1.0000,
                                ins.costo_unitario_capturado || 0
                            ]);
                        }
                    }
                }
            } 
            // 3. Backward Compatibility: Si viene el payload legacy 'margenes'
            else if (margenes && Array.isArray(margenes)) {
                for (const item of margenes) {
                    const queryLegacy = `
                        INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (articulo_id, lista_id) 
                        DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                    `;
                    await client.query(queryLegacy, [articulo_id, item.lista_id, item.margen_porcentaje]);

                    const cBase = costo_base !== undefined ? costo_base : 0;
                    const marg = parseFloat(item.margen_porcentaje) || 0;
                    const pFinal = cBase * (1 + (marg / 100)) * 1.21; // 21% default
                    
                    const queryLA = `
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, precio_final, modo_calculo
                        ) VALUES (
                            $1, $2, $3, $4, 'AUTOMATIC'
                        ) ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                            margen_ganancia = EXCLUDED.margen_ganancia,
                            precio_final = EXCLUDED.precio_final,
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    await client.query(queryLA, [item.lista_id, articulo_id, marg, pFinal]);
                }
            }

            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = BunkerService;
