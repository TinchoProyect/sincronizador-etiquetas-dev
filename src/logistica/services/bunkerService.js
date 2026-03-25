/**
 * Servicio de Búnker (Core Financiero)
 * Maneja la lógica de negocio y base de datos para los artículos del Búnker
 */

class BunkerService {
    /**
     * Obtener todas las listas activas
     */
    static async getListasActivas(db) {
        const query = `
            SELECT id, nombre, activa 
            FROM public.tipos_listas 
            WHERE activa = true 
            ORDER BY id ASC
        `;
        const result = await db.query(query);
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
                propiedades_dinamicas
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
                    propiedades_dinamicas
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
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
                    propiedades_dinamicas = EXCLUDED.propiedades_dinamicas
            `;
            await client.query(queryBunker, [
                articulo_id, descripcion, descFinal, costo_base || 0, porcentaje_iva || 21.00, moneda || '($)Pesos', redondeo || 'Ninguno',
                mantener_utilidad || false, rubro || null, sub_rubro || null, no_producido_por_lambda || false,
                kilos_unidad || 0, es_pack || false, pack_hijo_codigo || null,
                propiedades_dinamicas ? JSON.stringify(propiedades_dinamicas) : '{}'
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

            // Update del esqueleto en articulos legacy (Eliminado en Shadow Mode - Fase 5/7)
            // if (articuloData.descripcion) {
            //     await client.query(`UPDATE public.articulos SET descripcion = $2 WHERE numero = $1`, [articulo_id, articuloData.descripcion]);
            // }

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
     * Obtener el dashboard completo de Búnker
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
                (
                    SELECT json_agg(json_build_object('lista_id', m.lista_id, 'margen_porcentaje', m.margen_porcentaje))
                    FROM public.bunker_margenes m 
                    WHERE m.articulo_id = b.articulo_id
                ) as margenes
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
        return result.rows;
    }
}

module.exports = BunkerService;
