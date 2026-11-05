const { supabaseFetch } = require('../../produccion/utils/supabaseHelper');

/**
 * Servicio de Búnker (Core Financiero)
 * Maneja la lógica de negocio y base de datos para los artículos del Búnker
 */

class BunkerService {
    /**
     * Verifica si un código alfanumérico existe en las tablas del sistema local
     */
    static async esCodigoAlfaUnico(db, code) {
        const queryBunker = 'SELECT 1 FROM public.bunker_articulos WHERE articulo_id = $1';
        const resBunker = await db.query(queryBunker, [code]);
        if (resBunker.rows.length > 0) return false;

        const queryArticulos = 'SELECT 1 FROM public.articulos WHERE numero = $1';
        const resArticulos = await db.query(queryArticulos, [code]);
        if (resArticulos.rows.length > 0) return false;

        const queryPrecios = 'SELECT 1 FROM public.precios_articulos WHERE articulo = $1';
        const resPrecios = await db.query(queryPrecios, [code]);
        if (resPrecios.rows.length > 0) return false;

        return true;
    }

    /**
     * Verifica si un código de barras existe en las tablas del sistema local
     */
    static async esCodigoBarrasUnico(db, barcode) {
        const queryArticulos = 'SELECT 1 FROM public.articulos WHERE codigo_barras = $1';
        const resArticulos = await db.query(queryArticulos, [barcode]);
        if (resArticulos.rows.length > 0) return false;

        const queryConsolidado = 'SELECT 1 FROM public.stock_real_consolidado WHERE codigo_barras = $1';
        const resConsolidado = await db.query(queryConsolidado, [barcode]);
        if (resConsolidado.rows.length > 0) return false;

        return true;
    }

    /**
     * Genera un código alfanumérico único que inicia con EMB- seguido de 6 caracteres aleatorios
     */
    static async generarCodigoAlfanumericoUnico(db) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        let esUnico = false;
        let intentos = 0;

        while (!esUnico && intentos < 100) {
            code = 'EMB-';
            for (let i = 0; i < 6; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            esUnico = await BunkerService.esCodigoAlfaUnico(db, code);
            intentos++;
        }

        if (!esUnico) {
            throw new Error('No se pudo generar un código alfanumérico único del búnker después de 100 intentos.');
        }

        return code;
    }

    /**
     * Genera un código de barras numérico único de 10 dígitos (sin cero inicial)
     */
    static async generarCodigoBarrasUnico(db) {
        let barcode = '';
        let esUnico = false;
        let intentos = 0;

        while (!esUnico && intentos < 100) {
            barcode = (Math.floor(Math.random() * 9) + 1).toString();
            for (let i = 0; i < 9; i++) {
                barcode += Math.floor(Math.random() * 10).toString();
            }
            esUnico = await BunkerService.esCodigoBarrasUnico(db, barcode);
            intentos++;
        }

        if (!esUnico) {
            throw new Error('No se pudo generar un código de barras único del búnker después de 100 intentos.');
        }

        return barcode;
    }

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
     * Buscar artículos de insumos en la Tabla Maestra de Supabase (Fase 5 - HITL)
     */
    static async buscarInsumosBunker(db, query) {
        const tokens = query.split(' ').filter(t => t.trim() !== '');
        if (tokens.length === 0) return [];

        try {
            // 1. Buscar en catálogo interno de insumos y materias primas (public.ingredientes)
            let sqlIng = `
                SELECT 
                    id::text as id,
                    nombre as descripcion,
                    costo_patron as costo_base,
                    es_insumo,
                    unidad_medida
                FROM public.ingredientes
                WHERE 1=1
            `;
            const paramsIng = [];
            tokens.forEach((token, i) => {
                const pIdx = i + 1;
                sqlIng += ` AND (nombre ILIKE $${pIdx} OR id::text = $${pIdx}_exact)`;
                paramsIng.push(`%${token}%`);
            });
            // Reemplazar _exact por token limpio
            const cleanParamsIng = [];
            let sqlIngFinal = `SELECT id::text as id, nombre as descripcion, costo_patron as costo_base, es_insumo, unidad_medida FROM public.ingredientes WHERE 1=1`;
            tokens.forEach((token, i) => {
                const pIdx = (i * 2) + 1;
                const pExact = (i * 2) + 2;
                sqlIngFinal += ` AND (nombre ILIKE $${pIdx} OR id::text = $${pExact})`;
                cleanParamsIng.push(`%${token}%`, token.trim());
            });
            sqlIngFinal += ` ORDER BY es_insumo DESC, nombre ASC LIMIT 30`;

            const resIng = await db.query(sqlIngFinal, cleanParamsIng);

            const resultados = resIng.rows.map(row => ({
                id: row.id,
                descripcion: `${row.descripcion} [Insumo #${row.id}]`,
                costo_base: parseFloat(row.costo_base || 0)
            }));

            // 2. Buscar también en artículos del Búnker (envases, frascos, cajas o bultos registrados)
            const cleanParamsBunker = [];
            let sqlBunker = `
                SELECT b.articulo_id as id, b.descripcion, b.descripcion_generada, b.costo_base
                FROM public.bunker_articulos b
                WHERE 1=1
            `;
            tokens.forEach((token, i) => {
                const pIdx = (i * 3) + 1;
                const pGen = (i * 3) + 2;
                const pArt = (i * 3) + 3;
                sqlBunker += ` AND (b.descripcion ILIKE $${pIdx} OR b.descripcion_generada ILIKE $${pGen} OR b.articulo_id ILIKE $${pArt})`;
                cleanParamsBunker.push(`%${token}%`, `%${token}%`, `%${token}%`);
            });
            sqlBunker += ` ORDER BY b.descripcion_generada ASC LIMIT 20`;

            const resBunker = await db.query(sqlBunker, cleanParamsBunker);
            resBunker.rows.forEach(b => {
                // Evitar duplicar si ya vino por ingrediente
                if (!resultados.some(r => r.id === b.id)) {
                    resultados.push({
                        id: b.id,
                        descripcion: `${b.descripcion_generada || b.descripcion} [${b.id}]`,
                        costo_base: parseFloat(b.costo_base || 0)
                    });
                }
            });

            return resultados;
        } catch (error) {
            console.error('❌ [BUNKER-SERVICES] Error al buscar insumos locales en PostgreSQL:', error);
            return [];
        }
    }

    /**
     * Buscar términos en el diccionario ("On-The-Fly")
     */
    static async buscarDiccionario(db, query, categoria) {
        let sql = `
            SELECT id, termino, abreviatura, categoria 
            FROM public.bunker_diccionario 
        `;
        const conditions = [];
        const params = [];
        let pIndex = 1;

        if (query) {
            conditions.push(`(termino ILIKE $${pIndex} OR abreviatura ILIKE $${pIndex})`);
            params.push(`%${query}%`);
            pIndex++;
        }
        if (categoria) {
            if (categoria === 'articulo_principal') {
                conditions.push(`categoria IN ('articulo_principal', 'general')`);
            } else {
                conditions.push(`categoria = $${pIndex}`);
                params.push(categoria);
                pIndex++;
            }
        }

        if (conditions.length > 0) {
            sql += ` WHERE ` + conditions.join(' AND ');
        }

        sql += ` ORDER BY termino ASC LIMIT 50`;
        const result = await db.query(sql, params);
        return result.rows;
    }

    /**
     * Buscar artículos candidatos para vincular como Hijo (Bunker + Consolidado)
     */
    static async buscarArticulosHijos(db, query) {
        const tokens = query.split(' ').filter(t => t.trim() !== '');
        if (tokens.length === 0) return [];
        
        let subQueryWhere = 'WHERE 1=1';
        let params = [];
        tokens.forEach((token, i) => {
            const paramIdx = i + 1;
            subQueryWhere += ` AND (descripcion ILIKE $${paramIdx} OR codigo_barras ILIKE $${paramIdx} OR id ILIKE $${paramIdx})`;
            params.push(`%${token}%`);
        });

        const sql = `
            WITH ranked_articles AS (
                SELECT 
                    id, 
                    codigo_barras, 
                    descripcion, 
                    costo_base,
                    ROW_NUMBER() OVER (PARTITION BY id ORDER BY origen ASC) as rn
                FROM (
                    SELECT 
                        ba.articulo_id AS id, 
                        COALESCE(s.codigo_barras, ba.articulo_id) AS codigo_barras, 
                        COALESCE(ba.descripcion_generada, ba.descripcion) AS descripcion,
                        COALESCE(ba.costo_base, 0.00) AS costo_base,
                        1 AS origen
                    FROM public.bunker_articulos ba
                    LEFT JOIN public.stock_real_consolidado s ON s.articulo_numero = ba.articulo_id
                    UNION ALL
                    SELECT 
                        s.articulo_numero AS id, 
                        s.codigo_barras, 
                        s.descripcion,
                        COALESCE(p.costo, 0.00) AS costo_base,
                        2 AS origen
                    FROM public.stock_real_consolidado s
                    LEFT JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
                ) sub
                ${subQueryWhere}
            )
            SELECT id, codigo_barras, descripcion, costo_base
            FROM ranked_articles
            WHERE rn = 1
            ORDER BY descripcion ASC
            LIMIT 50
        `;
        
        const result = await db.query(sql, params);
        return result.rows;
    }

    /**
     * Buscar artículos en stock_real_consolidado (Fase 3 - Multi-token UAT con Join Financiero y Stock)
     */
    static async buscarConsolidado(db, query, options = {}) {
        const exactId = options.exactId ? String(options.exactId).trim() : null;
        const soloConStock = options.soloConStock === true;
        const tokens = (query || '').split(' ').filter(t => t.trim() !== '');
        if (!exactId && tokens.length === 0 && !soloConStock) return [];

        let sql = `
            SELECT 
                s.articulo_numero as id, 
                s.codigo_barras, 
                COALESCE(NULLIF(TRIM(p.descripcion), ''), NULLIF(TRIM(s.descripcion), ''), a.nombre) as descripcion,
                COALESCE(s.kilos_unidad, 1.00) as kilos_unidad,
                COALESCE(s.stock_consolidado, 0) as stock_consolidado,
                p.costo as costo_base,
                p.iva as porcentaje_iva,
                CASE WHEN b.articulo_id IS NOT NULL THEN true ELSE false END as ya_enriquecido
            FROM public.stock_real_consolidado s
            LEFT JOIN public.precios_articulos p ON UPPER(TRIM(p.articulo)) = UPPER(TRIM(s.articulo_numero))
            LEFT JOIN public.articulos a ON UPPER(TRIM(a.numero)) = UPPER(TRIM(s.articulo_numero))
            LEFT JOIN public.bunker_articulos b ON UPPER(TRIM(b.articulo_id)) = UPPER(TRIM(s.articulo_numero))
            WHERE UPPER(TRIM(s.articulo_numero)) != 'ART-TEST'
        `;

        let params = [];
        if (exactId) {
            params.push(exactId);
            sql += ` AND UPPER(TRIM(s.articulo_numero)) = UPPER(TRIM($1))`;
        } else {
            if (soloConStock) {
                sql += ` AND COALESCE(s.stock_consolidado, 0) > 0`;
            }
            tokens.forEach((token) => {
                params.push(`%${token}%`);
                const paramIdx = params.length;
                sql += ` AND (s.descripcion ILIKE $${paramIdx} OR p.descripcion ILIKE $${paramIdx} OR a.nombre ILIKE $${paramIdx} OR s.codigo_barras ILIKE $${paramIdx} OR s.articulo_numero ILIKE $${paramIdx})`;
            });
        }

        sql += ` ORDER BY (CASE WHEN b.articulo_id IS NULL THEN 0 ELSE 1 END) ASC, (CASE WHEN COALESCE(s.stock_consolidado, 0) > 0 THEN 0 ELSE 1 END) ASC, COALESCE(s.kilos_unidad, 1.00) DESC, COALESCE(NULLIF(p.descripcion, ''), s.descripcion) ASC LIMIT 65`;
        const result = await db.query(sql, params);
        return result.rows;
    }

    /**
     * Obtener todos los artículos de Legacy (stock_real_consolidado) con stock > 0 que aún NO existen en bunker_articulos
     */
    static async obtenerLegacyConStockPendientes(db) {
        const sql = `
            SELECT 
                s.articulo_numero AS id,
                s.articulo_numero AS articulo_id,
                s.codigo_barras,
                COALESCE(NULLIF(TRIM(p.descripcion), ''), NULLIF(TRIM(s.descripcion), ''), a.nombre) AS descripcion,
                COALESCE(s.kilos_unidad, 1.00) AS kilos_unidad,
                COALESCE(s.stock_consolidado, 0) AS stock_consolidado,
                COALESCE(p.costo, 0.00) AS costo_base,
                COALESCE(p.iva, 21.00) AS porcentaje_iva
            FROM public.stock_real_consolidado s
            LEFT JOIN public.precios_articulos p ON UPPER(TRIM(p.articulo)) = UPPER(TRIM(s.articulo_numero))
            LEFT JOIN public.articulos a ON UPPER(TRIM(a.numero)) = UPPER(TRIM(s.articulo_numero))
            LEFT JOIN public.bunker_articulos b ON UPPER(TRIM(b.articulo_id)) = UPPER(TRIM(s.articulo_numero))
            WHERE b.articulo_id IS NULL
              AND COALESCE(s.stock_consolidado, 0) > 0
              AND UPPER(TRIM(s.articulo_numero)) != 'ART-TEST'
              AND COALESCE(NULLIF(TRIM(p.descripcion), ''), NULLIF(TRIM(s.descripcion), ''), a.nombre) IS NOT NULL
            ORDER BY COALESCE(s.kilos_unidad, 1.00) DESC, s.stock_consolidado DESC, s.articulo_numero ASC
        `;
        const result = await db.query(sql);
        return result.rows;
    }

    /**
     * Buscar cotizaciones en la Tabla Maestra de Supabase por texto (Fase 4 - Enmienda)
     */
    static async buscarTablaMaestra(db, query) {
        try {
            const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
            const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
            
            // Reemplazar espacios por ilike y codificar adecuadamente
            const cleanQuery = String(query).trim().replace(/%/g, '');
            const encodedQuery = `%${cleanQuery}%`;
            
            const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&or=(datos_maestros->>descripcion.ilike.${encodeURIComponent(encodedQuery)},datos_maestros->>código.ilike.${encodeURIComponent(encodedQuery)},datos_maestros->>codigo.ilike.${encodeURIComponent(encodedQuery)})&limit=25`;
            
            const response = await supabaseFetch(url, { headers });
            if (!response.ok) {
                throw new Error(`Supabase API error: ${response.statusText}`);
            }
            
            const cotizaciones = await response.json();
            const normalizadas = cotizaciones.map(row => {
                const dm = row.datos_maestros || {};
                let precioUnitarioVal = 0;
                if (dm.precio) {
                    const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                    precioUnitarioVal = parseFloat(cleanPrice) || 0;
                }
                return {
                    id: row.id,
                    proveedor_id: row.proveedor_id,
                    nombre_proveedor: row.nombre_proveedor,
                    sku_proveedor: dm.codigo || dm.sku || dm.código || '',
                    descripcion: dm.descripcion || 'Sin descripción',
                    precio_unitario: precioUnitarioVal,
                    unidad_medida: dm.unidad || 'kg',
                    timestamp_extraccion: row.timestamp_extraccion
                };
            });
            
            return normalizadas;
        } catch (error) {
            console.error("❌ [BUNKER-SERVICE] Error en buscarTablaMaestra:", error);
            throw error;
        }
    }

    /**
     * Alta o Actualización Transaccional (Búnker y legacy tabla `articulos` UPSERT)
     */
    static async crearArticuloTransaccional(db, articuloData, listasMargenes, nuevosTerminos = [], solo_taxonomia = false) {
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
                expresado_en_gramos,
                expresado_en_unidades,
                crear_local,
                descripcion_legacy,
                pack_unidades
            } = articuloData;

            // 1. Guardar términos nuevos "On-The-Fly" preservando intacto el estado en_revision de términos existentes (v5.72)
            if (nuevosTerminos && Array.isArray(nuevosTerminos)) {
                for (const term of nuevosTerminos) {
                    const termName = BunkerService.normalizarCadenaDict(term.termino);
                    if (!termName) continue;
                    const abrevName = term.abreviatura ? String(term.abreviatura).trim().toUpperCase() : termName.substring(0, 5).toUpperCase();
                    const catName = term.categoria || 'general';

                    const resExist = await client.query(
                        `SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) = LOWER($1) LIMIT 1`,
                        [termName]
                    );
                    if (resExist.rows.length === 0) {
                        await client.query(`
                            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                            VALUES ($1, $2, $3, false, false)
                        `, [termName, abrevName, catName]);
                    }
                }
            }

            // 2. Insertar o Actualizar en la tabla core del búnker: `bunker_articulos` (Shadow Mode FASE 5)
            const descFinal = descripcion_abreviada || descripcion;

            let finalProps = propiedades_dinamicas || {};
            if (typeof finalProps === 'string') {
                try {
                    finalProps = JSON.parse(finalProps);
                } catch (e) {
                    finalProps = {};
                }
            }

            // Preservar metadatos técnicos del asistente desde la base de datos si ya existen
            try {
                const resExisting = await client.query(
                    `SELECT propiedades_dinamicas FROM public.bunker_articulos WHERE articulo_id = $1`,
                    [articulo_id]
                );
                if (resExisting.rows.length > 0) {
                    let existingProps = resExisting.rows[0].propiedades_dinamicas || {};
                    if (typeof existingProps === 'string') {
                        try {
                            existingProps = JSON.parse(existingProps);
                        } catch (e) {
                            existingProps = {};
                        }
                    }
                    for (const key of Object.keys(existingProps)) {
                        if (key.startsWith('asistente_') || key === 'tostadero_simulacion') {
                            finalProps[key] = existingProps[key];
                        }
                    }
                }
            } catch (errDb) {
                console.error('⚠️ [BUNKER-SERVICE] Error recuperando propiedades existentes para fusionar asistente:', errDb);
            }

            // Sobreescribir con los nuevos valores de mano de obra si vienen en articuloData
            if (articuloData.asistente_minutos !== undefined && articuloData.asistente_minutos !== null) {
                finalProps.asistente_minutos = parseFloat(articuloData.asistente_minutos) || 0;
            }
            if (articuloData.asistente_colaborador_id !== undefined && articuloData.asistente_colaborador_id !== null) {
                finalProps.asistente_colaborador_id = articuloData.asistente_colaborador_id ? parseInt(articuloData.asistente_colaborador_id) : null;
            }

            const queryBunker = `
                INSERT INTO public.bunker_articulos (
                    articulo_id, descripcion, descripcion_generada, costo_base, porcentaje_iva, moneda, redondeo, mantener_utilidad,
                    rubro, sub_rubro, no_producido_por_lambda, kilos_unidad, es_pack, pack_hijo_codigo,
                    propiedades_dinamicas, expresado_en_gramos, expresado_en_unidades, pack_unidades, familia_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
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
                    expresado_en_gramos = EXCLUDED.expresado_en_gramos,
                    expresado_en_unidades = EXCLUDED.expresado_en_unidades,
                    pack_unidades = EXCLUDED.pack_unidades,
                    familia_id = EXCLUDED.familia_id
            `;
            await client.query(queryBunker, [
                articulo_id, descripcion, descFinal, costo_base || 0, porcentaje_iva || 21.00, moneda || '($)Pesos', redondeo || 'Ninguno',
                mantener_utilidad || false, rubro || null, sub_rubro || null, no_producido_por_lambda || false,
                kilos_unidad || 0, es_pack || false, pack_hijo_codigo || null,
                JSON.stringify(finalProps),
                expresado_en_gramos || false,
                expresado_en_unidades || false,
                parseInt(pack_unidades) || 1,
                parseInt(articuloData.familia_id) || 6
            ]);

            // Auto-poblar de forma orgánica el Diccionario Maestro con salvaguarda de SAVEPOINT
            try {
                await client.query('SAVEPOINT auto_poblado_savepoint');
                await BunkerService.autoPoblarDiccionarioOrganico(client, finalProps);
                await client.query('RELEASE SAVEPOINT auto_poblado_savepoint');
            } catch (errDict) {
                await client.query('ROLLBACK TO SAVEPOINT auto_poblado_savepoint');
                console.error('⚠️ [BUNKER-SERVICE] Inserción orgánica capturada con SAVEPOINT sin abortar transacción:', errDict);
            }

            // 3. Sincronización Determinista con las tablas locales stock_real_consolidado y articulos
            const isUP = (finalProps && finalProps.presentacion_variable_wip === true) || 
                         (articuloData && articuloData.solo_produccion_externa === true) ||
                         (parseInt(articuloData.familia_id) === 42 && finalProps && finalProps.articulo_principal === 'Unidad Productiva');

            const descLegacy = descripcion_legacy || descFinal;
            const kilosVal = kilos_unidad !== undefined && kilos_unidad !== null ? parseFloat(kilos_unidad) : 1.0000;
            const soloExternaVal = isUP === true;
            const noProducidoVal = no_producido_por_lambda || false;

            // A. Upsert determinista en stock_real_consolidado
            const resUpdateSRC = await client.query(
                `UPDATE public.stock_real_consolidado
                 SET descripcion = $1, 
                     codigo_barras = $2, 
                     no_producido_por_lambda = $3, 
                     solo_produccion_externa = $4,
                     kilos_unidad = $5, 
                     es_pack = $6, 
                     pack_hijo_codigo = $7, 
                     pack_unidades = $8, 
                     ultima_actualizacion = NOW()
                 WHERE articulo_numero = $9`,
                [descLegacy, codigo_barras, noProducidoVal, soloExternaVal, kilosVal, es_pack || false, pack_hijo_codigo || null, parseInt(pack_unidades) || 1, articulo_id]
            );
            
            if (resUpdateSRC.rowCount === 0) {
                await client.query(
                    `INSERT INTO public.stock_real_consolidado (
                        articulo_numero, descripcion, codigo_barras, stock_lomasoft, stock_movimientos, 
                        stock_ajustes, stock_consolidado, ultima_actualizacion, no_producido_por_lambda, solo_produccion_externa,
                        kilos_unidad, es_pack, pack_hijo_codigo, pack_unidades
                    ) VALUES ($1, $2, $3, 0, 0, 0, 0, NOW(), $4, $5, $6, $7, $8, $9)`,
                    [articulo_id, descLegacy, codigo_barras, noProducidoVal, soloExternaVal, kilosVal, es_pack || false, pack_hijo_codigo || null, parseInt(pack_unidades) || 1]
                );
            }

            // B. Upsert en la tabla legacy articulos (numero, nombre, codigo_barras, stock_ventas)
            const resUpdateArt = await client.query(
                `UPDATE public.articulos
                 SET nombre = $1, codigo_barras = $2
                 WHERE numero = $3`,
                [descLegacy, codigo_barras, articulo_id]
            );
            
            if (resUpdateArt.rowCount === 0) {
                await client.query(
                    `INSERT INTO public.articulos (numero, nombre, codigo_barras, stock_ventas)
                     VALUES ($1, $2, $3, 0)`,
                    [articulo_id, descLegacy, codigo_barras]
                );
            }

            // C. Sincronización de Relación UP -> AP (articulos_produccion_externa_relacion)
            if (isUP && articuloData.articulo_puente_codigo && String(articuloData.articulo_puente_codigo).trim() !== '') {
                const apCodigo = String(articuloData.articulo_puente_codigo).trim();
                await client.query(
                    `DELETE FROM public.articulos_produccion_externa_relacion WHERE articulo_produccion_codigo = $1`,
                    [articulo_id]
                );
                await client.query(
                    `INSERT INTO public.articulos_produccion_externa_relacion (
                        articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes
                    ) VALUES ($1, $2, 1.00)`,
                    [articulo_id, apCodigo]
                );
                console.log(`🔗 [BUNKER-SERVICE] Relación UP -> AP consolidada: ${articulo_id} -> ${apCodigo}`);
            } else if (!isUP) {
                // Si el artículo dejó de ser UP, limpiar relaciones de producción externa
                await client.query(
                    `DELETE FROM public.articulos_produccion_externa_relacion WHERE articulo_produccion_codigo = $1`,
                    [articulo_id]
                );
            }

            // 4. Upsert Iterativo en los márgenes: `bunker_margenes` y `bunker_lista_articulos`
            const isSoloTaxonomia = solo_taxonomia === true || (articuloData && articuloData.solo_taxonomia === true);
            if (!isSoloTaxonomia && listasMargenes && Array.isArray(listasMargenes) && listasMargenes.length > 0) {
                for (const item of listasMargenes) {
                    const queryMargen = `
                        INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (articulo_id, lista_id) 
                        DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                    `;
                    await client.query(queryMargen, [articulo_id, item.lista_id, item.margen_porcentaje]);

                    // Guardar/Actualizar en bunker_lista_articulos con cálculo automático
                    const queryExist = `
                        SELECT id, costo_base_sobrescrito, costo_tiempo, iva, modo_calculo, modo_iva, es_patron, fuente_costo_default, disponible
                        FROM public.bunker_lista_articulos
                        WHERE lista_id = $1 AND articulo_numero = $2
                    `;
                    const resExist = await client.query(queryExist, [item.lista_id, articulo_id]);
                    
                    let costoBaseSobrescrito = null;
                    let costoTiempo = (articuloData.costo_tiempo !== undefined && articuloData.costo_tiempo !== null)
                        ? (parseFloat(articuloData.costo_tiempo) || 0)
                        : 0;
                    const baseIvaVal = porcentaje_iva !== undefined && porcentaje_iva !== null ? parseFloat(porcentaje_iva) : 21.00;
                    let modoCalculo = 'AUTOMATIC';
                    let modoIva = 'COMPLETO';
                    let esPatron = false;
                    let fuenteCostoDefault = null;
                    let disponible = item.disponible !== undefined ? item.disponible : true;

                    if (resExist.rows.length > 0) {
                        const existing = resExist.rows[0];
                        costoBaseSobrescrito = existing.costo_base_sobrescrito;
                        if (articuloData.costo_tiempo === undefined || articuloData.costo_tiempo === null) {
                            costoTiempo = parseFloat(existing.costo_tiempo) || 0;
                        }
                        modoCalculo = existing.modo_calculo || 'AUTOMATIC';
                        modoIva = existing.modo_iva || 'COMPLETO';
                        esPatron = existing.es_patron || false;
                        fuenteCostoDefault = existing.fuente_costo_default;
                        if (item.disponible === undefined) {
                            disponible = existing.disponible !== undefined ? existing.disponible : true;
                        }
                    }

                    const factorKilos = (kilosVal > 0 && !expresado_en_unidades) ? kilosVal : 1;
                    const bultoCostoBase = parseFloat(costo_base) || 0;
                    const cBase = bultoCostoBase > 0
                        ? bultoCostoBase
                        : (costoBaseSobrescrito !== null ? (parseFloat(costoBaseSobrescrito) * factorKilos) : 0);
                    if (bultoCostoBase > 0 && costoBaseSobrescrito !== null) {
                        costoBaseSobrescrito = Number((bultoCostoBase / factorKilos).toFixed(4));
                    }
                    const nuevoMargen = parseFloat(item.margen_porcentaje) || 0;

                    let ivaAplicado = baseIvaVal;
                    if (modoIva === 'MEDIO') {
                        ivaAplicado = baseIvaVal / 2;
                    } else if (modoIva === 'SIN') {
                        ivaAplicado = 0;
                    }
                    const ivaCoeff = 1 + (ivaAplicado / 100);

                    let precioFinal = 0;
                    if (item.precio_final !== undefined && item.precio_final !== null && !isNaN(parseFloat(item.precio_final)) && parseFloat(item.precio_final) > 0) {
                        precioFinal = parseFloat(item.precio_final);
                        modoCalculo = 'AUTOMATIC';
                    } else if (modoCalculo === 'AUTOMATIC') {
                        precioFinal = (cBase * (1 + (nuevoMargen / 100)) + costoTiempo) * ivaCoeff;
                    } else {
                        if (resExist.rows.length > 0) {
                            precioFinal = parseFloat(resExist.rows[0].precio_final) || 0;
                        } else {
                            precioFinal = (cBase * (1 + (nuevoMargen / 100)) + costoTiempo) * ivaCoeff;
                        }
                    }

                    const isManoObraActiva = (costoTiempo > 0);
                    const queryLA = `
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito, 
                            costo_tiempo, mano_obra_activa, iva, precio_final, modo_calculo, modo_iva, es_patron, fuente_costo_default, disponible, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP
                        ) ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                            margen_ganancia = EXCLUDED.margen_ganancia,
                            costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                            costo_tiempo = EXCLUDED.costo_tiempo,
                            mano_obra_activa = EXCLUDED.mano_obra_activa,
                            iva = EXCLUDED.iva,
                            precio_final = EXCLUDED.precio_final,
                            modo_calculo = EXCLUDED.modo_calculo,
                            modo_iva = EXCLUDED.modo_iva,
                            es_patron = EXCLUDED.es_patron,
                            fuente_costo_default = EXCLUDED.fuente_costo_default,
                            disponible = EXCLUDED.disponible,
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    await client.query(queryLA, [
                        item.lista_id,
                        articulo_id,
                        nuevoMargen,
                        costoBaseSobrescrito,
                        costoTiempo,
                        isManoObraActiva,
                        ivaAplicado,
                        precioFinal,
                        modoCalculo,
                        modoIva,
                        esPatron,
                        fuenteCostoDefault,
                        disponible
                    ]);
                }
            }


            // 5. Herencia Transaccional para Modo Clonación (Fase Clonación Integral)
            const clonarDeId = articuloData.clonar_de_articulo_id;
            if (clonarDeId) {
                console.log(`📋 [BUNKER-SERVICE] Procesando herencia profunda desde referente ID=${clonarDeId} para nuevo artículo ID=${articulo_id}`);
                
                // A. Clonar mapeos de reposición (proveedores asociados)
                try {
                    const resMapeos = await client.query(
                        `SELECT proveedor_id, proveedor_producto_codigo 
                         FROM public.bunker_articulos_reposicion_mapeo 
                         WHERE LOWER(bunker_articulo_id) = LOWER($1)`,
                        [clonarDeId]
                    );
                    if (resMapeos.rows.length > 0) {
                        for (const m of resMapeos.rows) {
                            await client.query(
                                `INSERT INTO public.bunker_articulos_reposicion_mapeo (bunker_articulo_id, proveedor_id, proveedor_producto_codigo)
                                 VALUES ($1, $2, $3)`,
                                [articulo_id, m.proveedor_id, m.proveedor_producto_codigo]
                            );
                        }
                        console.log(`📋 [BUNKER-SERVICE] Clonados ${resMapeos.rows.length} mapeos de reposición de ${clonarDeId} -> ${articulo_id}`);
                    }
                } catch (errMapeo) {
                    console.error('⚠️ [BUNKER-SERVICE] Error clonando mapeos de reposición:', errMapeo);
                }
            }

            // 6. Gestión Integral de Receta de Producción (Fase Clonación e Integración de Receta)
            try {
                const recetaPayload = articuloData.receta;
                
                if (recetaPayload && recetaPayload.activa === true && Array.isArray(recetaPayload.ingredientes) && recetaPayload.ingredientes.length > 0) {
                    // 1. Purgar recetas previas si existían en el artículo destino
                    const resRecetasDestino = await client.query(
                        `SELECT id FROM public.recetas WHERE articulo_numero = $1`,
                        [articulo_id]
                    );
                    if (resRecetasDestino.rows.length > 0) {
                        for (const rOld of resRecetasDestino.rows) {
                            await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.recetas WHERE id = $1`, [rOld.id]);
                        }
                    }

                    // 2. Insertar nueva receta personalizada
                    const resNuevaReceta = await client.query(
                        `INSERT INTO public.recetas (articulo_numero, descripcion, fecha_creacion, enlazado_externo)
                         VALUES ($1, $2, NOW(), false)
                         RETURNING id`,
                        [articulo_id, 'Receta de Búnker para ' + (descFinal || articuloData.descripcion || articulo_id)]
                    );
                    const nuevaRecetaId = resNuevaReceta.rows[0].id;

                    for (const ing of recetaPayload.ingredientes) {
                        const cantNum = parseFloat(ing.cantidad) || 0;
                        if (ing.ingrediente_id && cantNum > 0) {
                            await client.query(
                                `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad, fase_produccion)
                                 VALUES ($1, $2, $3, $4, $5, 'externa')`,
                                [nuevaRecetaId, parseInt(ing.ingrediente_id), ing.nombre_ingrediente, ing.unidad_medida || 'Kilo', cantNum]
                            );
                        }
                    }
                    console.log(`📋 [BUNKER-SERVICE] Receta personalizada #${nuevaRecetaId} guardada para SKU ${articulo_id} con ${recetaPayload.ingredientes.length} componentes`);
                } else if (recetaPayload && recetaPayload.activa === false) {
                    const resRecetasDestino = await client.query(
                        `SELECT id FROM public.recetas WHERE articulo_numero = $1`,
                        [articulo_id]
                    );
                    if (resRecetasDestino.rows.length > 0) {
                        for (const rOld of resRecetasDestino.rows) {
                            await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.recetas WHERE id = $1`, [rOld.id]);
                        }
                        console.log(`📋 [BUNKER-SERVICE] Recetas purgadas para SKU ${articulo_id} por desactivación explícita`);
                    }
                } else if (clonarDeId) {
                    // Fallback tradicional de clonación automática si no se especificó un payload de receta
                    const resReceta = await client.query(
                        `SELECT id, descripcion, enlazado_externo 
                         FROM public.recetas 
                         WHERE articulo_numero = $1 
                         ORDER BY fecha_creacion DESC 
                         LIMIT 1`,
                        [clonarDeId]
                    );

                    const resRecetasDestino = await client.query(
                        `SELECT id FROM public.recetas WHERE articulo_numero = $1`,
                        [articulo_id]
                    );
                    if (resRecetasDestino.rows.length > 0) {
                        for (const rOld of resRecetasDestino.rows) {
                            await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.recetas WHERE id = $1`, [rOld.id]);
                        }
                        console.log(`📋 [BUNKER-SERVICE] Purgadas ${resRecetasDestino.rows.length} recetas preexistentes en SKU ${articulo_id}`);
                    }

                    if (resReceta.rows.length > 0) {
                        const recetaOrig = resReceta.rows[0];
                        const resNuevaReceta = await client.query(
                            `INSERT INTO public.recetas (articulo_numero, descripcion, fecha_creacion, enlazado_externo)
                             VALUES ($1, $2, NOW(), $3)
                             RETURNING id`,
                            [articulo_id, descFinal || recetaOrig.descripcion, recetaOrig.enlazado_externo === true]
                        );
                        const nuevaRecetaId = resNuevaReceta.rows[0].id;

                        // Duplicar receta_ingredientes (reescalando materia prima a kilos_unidad si corresponde)
                        const resIngs = await client.query(
                            `SELECT ingrediente_id, nombre_ingrediente, unidad_medida, cantidad
                             FROM public.receta_ingredientes 
                             WHERE receta_id = $1`,
                            [recetaOrig.id]
                        );
                        const kVal = parseFloat(kilos_unidad) || 0;
                        for (const ing of resIngs.rows) {
                            let cantToUse = parseFloat(ing.cantidad) || 0;
                            if (ing.unidad_medida && ing.unidad_medida.toLowerCase() === 'kilo' && kVal > 0) {
                                cantToUse = kVal;
                            }
                            await client.query(
                                `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad, fase_produccion)
                                 VALUES ($1, $2, $3, $4, $5, 'externa')`,
                                [nuevaRecetaId, ing.ingrediente_id, ing.nombre_ingrediente, ing.unidad_medida, cantToUse]
                            );
                        }

                        // Duplicar receta_articulos si existen
                        try {
                            const resArts = await client.query(
                                `SELECT articulo_numero, cantidad
                                 FROM public.receta_articulos
                                 WHERE receta_id = $1`,
                                [recetaOrig.id]
                            );
                            for (const rArt of resArts.rows) {
                                await client.query(
                                    `INSERT INTO public.receta_articulos (receta_id, articulo_numero, cantidad)
                                     VALUES ($1, $2, $3)`,
                                    [nuevaRecetaId, rArt.articulo_numero, rArt.cantidad]
                                );
                            }
                        } catch (eArts) {}

                        console.log(`📋 [BUNKER-SERVICE] Clonada receta #${recetaOrig.id} -> #${nuevaRecetaId} para nuevo artículo ${articulo_id}`);
                    }
                }
            } catch (errReceta) {
                console.error('⚠️ [BUNKER-SERVICE] Error en gestión de receta:', errReceta);
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

        // 1. Obtener todas las listas activas
        const resListas = await db.query("SELECT id, nombre FROM public.bunker_listas_precios WHERE activa = true ORDER BY id ASC");
        const listasActivas = resListas.rows;

        // 2. Obtener configuraciones de este artículo en bunker_lista_articulos
        const queryConfigs = `
            SELECT id, lista_id, margen_ganancia as margen_porcentaje, disponible, precio_final
            FROM public.bunker_lista_articulos 
            WHERE articulo_numero = $1
        `;
        const resConfigs = await db.query(queryConfigs, [articulo_id]);
        const artConfigs = resConfigs.rows;

        // 3. Obtener márgenes legacy para fallback
        const queryLegacy = `SELECT lista_id, margen_porcentaje FROM public.bunker_margenes WHERE articulo_id = $1`;
        const resLegacy = await db.query(queryLegacy, [articulo_id]);
        const legacyMargenes = resLegacy.rows;

        const laL1 = artConfigs.find(c => Number(c.lista_id) === 1);

        articulo.margenes = listasActivas.map(list => {
            const la = artConfigs.find(c => Number(c.lista_id) === Number(list.id));
            if (la) {
                return {
                    lista_id: la.lista_id,
                    asignado: true,
                    margen_porcentaje: la.margen_porcentaje,
                    disponible: la.disponible === true || la.disponible === 'true',
                    precio_final: la.precio_final
                };
            } else {
                const lm = legacyMargenes.find(m => Number(m.lista_id) === Number(list.id));
                if (lm) {
                    return {
                        lista_id: list.id,
                        asignado: false,
                        margen_porcentaje: lm.margen_porcentaje,
                        disponible: true,
                        precio_final: 0
                    };
                } else if (laL1) {
                    return {
                        lista_id: list.id,
                        asignado: false,
                        margen_porcentaje: laL1.margen_porcentaje,
                        disponible: true,
                        precio_final: laL1.precio_final
                    };
                } else {
                    return {
                        lista_id: list.id,
                        asignado: false,
                        margen_porcentaje: 0,
                        disponible: false,
                        precio_final: 0
                    };
                }
            }
        });

        // También buscamos en articulos consolidados para recuperar el código de barras y descripción legacy unificada (v5.73-rev2)
        const queryLegacySec = `
            SELECT 
                COALESCE(NULLIF(p.descripcion, ''), s.descripcion) as descripcion, 
                s.codigo_barras 
            FROM public.stock_real_consolidado s
            LEFT JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
            WHERE s.articulo_numero = $1
        `;
        const resLegacySec = await db.query(queryLegacySec, [articulo_id]);
        if (resLegacySec.rows.length > 0) {
            articulo.descripcion_legacy = resLegacySec.rows[0].descripcion;
            if (!articulo.descripcion) articulo.descripcion = resLegacySec.rows[0].descripcion;
            articulo.codigo_barras = resLegacySec.rows[0].codigo_barras;
        } else {
            articulo.descripcion_legacy = null;
            let props = articulo.propiedades_dinamicas;
            if (typeof props === 'string') {
                try {
                    props = JSON.parse(props);
                } catch (e) {
                    props = {};
                }
            }
            if (props && props.codigo_barras_local) {
                articulo.codigo_barras = props.codigo_barras_local;
            }
        }

        // Inyectar Fuente Única de Verdad de Costos (v5.31)
        let costoVigenteReal = parseFloat(articulo.costo_base) || 0;
        try {
            const resLA = await db.query(
                `SELECT costo_base_sobrescrito FROM public.bunker_lista_articulos WHERE articulo_numero = $1 AND costo_base_sobrescrito IS NOT NULL AND costo_base_sobrescrito > 0 LIMIT 1`,
                [articulo_id]
            );
            if (resLA.rows.length > 0) {
                const kUnidad = parseFloat(articulo.kilos_unidad) || 1.0;
                const costoKiloSob = parseFloat(resLA.rows[0].costo_base_sobrescrito);
                // Si el artículo se comercializa por peso (kilos_unidad > 0) y no es exclusivamente por unidades,
                // el costo base del bulto se obtiene multiplicando el costo por kilo por los kilos de la unidad/bulto
                costoVigenteReal = (kUnidad > 0 && !articulo.expresado_en_unidades) ? (costoKiloSob * kUnidad) : costoKiloSob;
            } else {
                const resLote = await db.query(
                    `SELECT d.costo_kilo_al_momento FROM public.bunker_lotes_destinos d JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id WHERE d.destino_id = $1 ORDER BY v.fecha_vinculacion DESC LIMIT 1`,
                    [articulo_id]
                );
                if (resLote.rows.length > 0 && parseFloat(resLote.rows[0].costo_kilo_al_momento) > 0) {
                    const kUnidad = parseFloat(articulo.kilos_unidad) || 1.0;
                    costoVigenteReal = parseFloat(resLote.rows[0].costo_kilo_al_momento) * kUnidad;
                }
            }
        } catch (e) {}

        // Recuperar relación de producción externa (Artículo Puente vinculado)
        try {
            const queryRelacion = `
                SELECT aper.articulo_kilo_codigo, COALESCE(ba_ap.descripcion_generada, ba_ap.descripcion, a_ap.nombre) as articulo_kilo_nombre
                FROM public.articulos_produccion_externa_relacion aper
                LEFT JOIN public.bunker_articulos ba_ap ON ba_ap.articulo_id = aper.articulo_kilo_codigo
                LEFT JOIN public.articulos a_ap ON a_ap.numero = aper.articulo_kilo_codigo
                WHERE aper.articulo_produccion_codigo = $1
                LIMIT 1
            `;
            const resRelacion = await db.query(queryRelacion, [articulo_id]);
            if (resRelacion.rows.length > 0) {
                articulo.articulo_puente_codigo = resRelacion.rows[0].articulo_kilo_codigo;
                articulo.articulo_puente_nombre = resRelacion.rows[0].articulo_kilo_nombre;
            } else {
                articulo.articulo_puente_codigo = null;
                articulo.articulo_puente_nombre = null;
            }
        } catch (eRel) {
            console.error('Error recuperando relación de producción externa en obtenerArticulo:', eRel);
            articulo.articulo_puente_codigo = null;
            articulo.articulo_puente_nombre = null;
        }

        articulo.costo_real_vigente = costoVigenteReal;
        articulo.costo_base_finanzas = costoVigenteReal;

        return articulo;
    }

    /**
     * Actualizar artículo en Búnker y UPSERT de márgenes
     */
    static async actualizarArticuloTransaccional(db, articulo_id, articuloData, listasMargenes, solo_taxonomia = false) {
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
                pack_hijo_codigo,
                propiedades_dinamicas,
                pack_unidades,
                expresado_en_gramos,
                expresado_en_unidades
            } = articuloData;

            let finalProps = propiedades_dinamicas || {};
            if (typeof finalProps === 'string') {
                try {
                    finalProps = JSON.parse(finalProps);
                } catch (e) {
                    finalProps = {};
                }
            }

            // Preservar metadatos técnicos y tostadero_simulacion existentes
            try {
                const resExisting = await client.query(
                    `SELECT propiedades_dinamicas FROM public.bunker_articulos WHERE articulo_id = $1`,
                    [articulo_id]
                );
                if (resExisting.rows.length > 0) {
                    let existingProps = resExisting.rows[0].propiedades_dinamicas || {};
                    if (typeof existingProps === 'string') {
                        try {
                            existingProps = JSON.parse(existingProps);
                        } catch (e) {
                            existingProps = {};
                        }
                    }
                    for (const key of Object.keys(existingProps)) {
                        if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key === 'codigo_barras_local') {
                            finalProps[key] = existingProps[key];
                        }
                    }
                }
            } catch (errDb) {
                console.error('⚠️ [BUNKER-SERVICE] Error recuperando propiedades existentes para fusionar en actualizar:', errDb);
            }

            // Sobreescribir con los nuevos valores de mano de obra si vienen en articuloData
            if (articuloData.asistente_minutos !== undefined && articuloData.asistente_minutos !== null) {
                finalProps.asistente_minutos = parseFloat(articuloData.asistente_minutos) || 0;
            }
            if (articuloData.asistente_colaborador_id !== undefined && articuloData.asistente_colaborador_id !== null) {
                finalProps.asistente_colaborador_id = articuloData.asistente_colaborador_id ? parseInt(articuloData.asistente_colaborador_id) : null;
            }

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
                    pack_hijo_codigo = COALESCE($12, pack_hijo_codigo),
                    propiedades_dinamicas = $13,
                    pack_unidades = COALESCE($14, pack_unidades),
                    expresado_en_gramos = COALESCE($15, expresado_en_gramos),
                    expresado_en_unidades = COALESCE($16, expresado_en_unidades),
                    familia_id = COALESCE($17, familia_id)
                WHERE articulo_id = $1
            `;
            await client.query(queryBunker, [
                articulo_id, costo_base, porcentaje_iva, moneda, redondeo,
                mantener_utilidad, rubro, sub_rubro, no_producido_por_lambda,
                kilos_unidad, es_pack, pack_hijo_codigo, JSON.stringify(finalProps),
                parseInt(pack_unidades) || 1, expresado_en_gramos || false, expresado_en_unidades || false,
                parseInt(articuloData.familia_id) || null
            ]);

            // Auto-poblar de forma orgánica el Diccionario Maestro con salvaguarda de SAVEPOINT
            try {
                await client.query('SAVEPOINT auto_poblado_savepoint');
                await BunkerService.autoPoblarDiccionarioOrganico(client, finalProps);
                await client.query('RELEASE SAVEPOINT auto_poblado_savepoint');
            } catch (errDict) {
                await client.query('ROLLBACK TO SAVEPOINT auto_poblado_savepoint');
                console.error('⚠️ [BUNKER-SERVICE] Inserción orgánica capturada con SAVEPOINT sin abortar transacción:', errDict);
            }

            // Obtener el artículo actual para tener costo_base, porcentaje_iva y kilos_unidad actualizados
            const resArt = await client.query(
                `SELECT costo_base, porcentaje_iva, kilos_unidad, expresado_en_unidades FROM public.bunker_articulos WHERE articulo_id = $1`,
                [articulo_id]
            );
            let currentCostoBase = 0;
            let currentPorcentajeIva = 21.00;
            let currentKilosUnidad = 1;
            let currentExpresadoEnUnidades = false;
            if (resArt.rows.length > 0) {
                currentCostoBase = parseFloat(resArt.rows[0].costo_base) || 0;
                currentPorcentajeIva = parseFloat(resArt.rows[0].porcentaje_iva) || 21.00;
                currentKilosUnidad = parseFloat(resArt.rows[0].kilos_unidad) || 1;
                currentExpresadoEnUnidades = resArt.rows[0].expresado_en_unidades === true;
            }
            const finalCostoBase = costo_base !== undefined && costo_base !== null ? parseFloat(costo_base) : currentCostoBase;
            const finalPorcentajeIva = porcentaje_iva !== undefined && porcentaje_iva !== null ? parseFloat(porcentaje_iva) : currentPorcentajeIva;
            const finalKilosUnidad = kilos_unidad !== undefined && kilos_unidad !== null ? (parseFloat(kilos_unidad) || 1) : currentKilosUnidad;
            const finalExpresadoEnUnidades = expresado_en_unidades !== undefined && expresado_en_unidades !== null ? Boolean(expresado_en_unidades) : currentExpresadoEnUnidades;
            const factorKilos = (finalKilosUnidad > 0 && !finalExpresadoEnUnidades) ? finalKilosUnidad : 1;

            // Upsert en bunker_margenes y bunker_lista_articulos
            if (listasMargenes && Array.isArray(listasMargenes)) {
                for (const item of listasMargenes) {
                    const queryMargen = `
                        INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (articulo_id, lista_id) 
                        DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                    `;
                    await client.query(queryMargen, [articulo_id, item.lista_id, item.margen_porcentaje]);

                    // Guardar/Actualizar en bunker_lista_articulos con cálculo automático
                    const queryExist = `
                        SELECT id, costo_base_sobrescrito, costo_tiempo, iva, modo_calculo, modo_iva, es_patron, fuente_costo_default, disponible
                        FROM public.bunker_lista_articulos
                        WHERE lista_id = $1 AND articulo_numero = $2
                    `;
                    const resExist = await client.query(queryExist, [item.lista_id, articulo_id]);
                    
                    let costoBaseSobrescrito = null;
                    let costoTiempo = (articuloData.costo_tiempo !== undefined && articuloData.costo_tiempo !== null)
                        ? (parseFloat(articuloData.costo_tiempo) || 0)
                        : 0;
                    let modoCalculo = 'AUTOMATIC';
                    let modoIva = 'COMPLETO';
                    let esPatron = false;
                    let fuenteCostoDefault = null;
                    let disponible = item.disponible !== undefined ? item.disponible : true;

                    if (resExist.rows.length > 0) {
                        const existing = resExist.rows[0];
                        costoBaseSobrescrito = existing.costo_base_sobrescrito;
                        if (articuloData.costo_tiempo === undefined || articuloData.costo_tiempo === null) {
                            costoTiempo = parseFloat(existing.costo_tiempo) || 0;
                        }
                        modoCalculo = existing.modo_calculo || 'AUTOMATIC';
                        modoIva = existing.modo_iva || 'COMPLETO';
                        esPatron = existing.es_patron || false;
                        fuenteCostoDefault = existing.fuente_costo_default;
                        if (item.disponible === undefined) {
                            disponible = existing.disponible !== undefined ? existing.disponible : true;
                        }
                    }

                    const cBase = finalCostoBase > 0
                        ? finalCostoBase
                        : (costoBaseSobrescrito !== null ? (parseFloat(costoBaseSobrescrito) * factorKilos) : 0);
                    if (finalCostoBase > 0 && costoBaseSobrescrito !== null) {
                        costoBaseSobrescrito = Number((finalCostoBase / factorKilos).toFixed(4));
                    }
                    const nuevoMargen = parseFloat(item.margen_porcentaje) || 0;

                    let ivaAplicado = finalPorcentajeIva;
                    if (modoIva === 'MEDIO') {
                        ivaAplicado = finalPorcentajeIva / 2;
                    } else if (modoIva === 'SIN') {
                        ivaAplicado = 0;
                    }
                    const ivaCoeff = 1 + (ivaAplicado / 100);

                    let precioFinal = 0;
                    if (item.precio_final !== undefined && item.precio_final !== null && !isNaN(parseFloat(item.precio_final)) && parseFloat(item.precio_final) > 0) {
                        precioFinal = parseFloat(item.precio_final);
                        modoCalculo = 'AUTOMATIC';
                    } else if (modoCalculo === 'AUTOMATIC') {
                        precioFinal = (cBase * (1 + (nuevoMargen / 100)) + costoTiempo) * ivaCoeff;
                    } else {
                        if (resExist.rows.length > 0) {
                            precioFinal = parseFloat(resExist.rows[0].precio_final) || 0;
                        } else {
                            precioFinal = (cBase * (1 + (nuevoMargen / 100)) + costoTiempo) * ivaCoeff;
                        }
                    }

                    const isManoObraActiva = (costoTiempo > 0);
                    const queryLA = `
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito, 
                            costo_tiempo, mano_obra_activa, iva, precio_final, modo_calculo, modo_iva, es_patron, fuente_costo_default, disponible, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP
                        ) ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                            margen_ganancia = EXCLUDED.margen_ganancia,
                            costo_base_sobrescrito = EXCLUDED.costo_base_sobrescrito,
                            costo_tiempo = EXCLUDED.costo_tiempo,
                            mano_obra_activa = EXCLUDED.mano_obra_activa,
                            iva = EXCLUDED.iva,
                            precio_final = EXCLUDED.precio_final,
                            modo_calculo = EXCLUDED.modo_calculo,
                            modo_iva = EXCLUDED.modo_iva,
                            es_patron = EXCLUDED.es_patron,
                            fuente_costo_default = EXCLUDED.fuente_costo_default,
                            disponible = EXCLUDED.disponible,
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    await client.query(queryLA, [
                        item.lista_id,
                        articulo_id,
                        nuevoMargen,
                        costoBaseSobrescrito,
                        costoTiempo,
                        isManoObraActiva,
                        ivaAplicado,
                        precioFinal,
                        modoCalculo,
                        modoIva,
                        esPatron,
                        fuenteCostoDefault,
                        disponible
                    ]);
                }
            }

            // Gestión Integral de Receta de Producción (Fase Clonación e Integración de Receta)
            try {
                const recetaPayload = articuloData.receta;
                
                if (recetaPayload && recetaPayload.activa === true && Array.isArray(recetaPayload.ingredientes) && recetaPayload.ingredientes.length > 0) {
                    // 1. Purgar recetas previas si existían en el artículo
                    const resRecetasDestino = await client.query(
                        `SELECT id FROM public.recetas WHERE articulo_numero = $1`,
                        [articulo_id]
                    );
                    if (resRecetasDestino.rows.length > 0) {
                        for (const rOld of resRecetasDestino.rows) {
                            await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.recetas WHERE id = $1`, [rOld.id]);
                        }
                    }

                    // 2. Insertar nueva receta personalizada
                    const resNuevaReceta = await client.query(
                        `INSERT INTO public.recetas (articulo_numero, descripcion, fecha_creacion, enlazado_externo)
                         VALUES ($1, $2, NOW(), false)
                         RETURNING id`,
                        [articulo_id, 'Receta de Búnker para ' + (articuloData.descripcion_abreviada || articuloData.descripcion || articulo_id)]
                    );
                    const nuevaRecetaId = resNuevaReceta.rows[0].id;

                    for (const ing of recetaPayload.ingredientes) {
                        const cantNum = parseFloat(ing.cantidad) || 0;
                        if (ing.ingrediente_id && cantNum > 0) {
                            await client.query(
                                `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad, fase_produccion)
                                 VALUES ($1, $2, $3, $4, $5, 'externa')`,
                                [nuevaRecetaId, parseInt(ing.ingrediente_id), ing.nombre_ingrediente, ing.unidad_medida || 'Kilo', cantNum]
                            );
                        }
                    }
                    console.log(`📋 [BUNKER-SERVICE] Receta personalizada #${nuevaRecetaId} guardada para SKU ${articulo_id} con ${recetaPayload.ingredientes.length} componentes`);
                } else if (recetaPayload && recetaPayload.activa === false) {
                    const resRecetasDestino = await client.query(
                        `SELECT id FROM public.recetas WHERE articulo_numero = $1`,
                        [articulo_id]
                    );
                    if (resRecetasDestino.rows.length > 0) {
                        for (const rOld of resRecetasDestino.rows) {
                            await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [rOld.id]);
                            await client.query(`DELETE FROM public.recetas WHERE id = $1`, [rOld.id]);
                        }
                        console.log(`📋 [BUNKER-SERVICE] Recetas purgadas para SKU ${articulo_id} por desactivación explícita`);
                    }
                }
            } catch (errReceta) {
                console.error('⚠️ [BUNKER-SERVICE] Error en gestión de receta (actualizar):', errReceta);
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
     * Resuelve de forma recursiva el costo patrón de un ingrediente.
     * Si el ingrediente es de tipo "Mix" (posee composición), sumará el costo compuesto de sus
     * subcomponentes y lo dividirá por su receta_base_kg.
     * Incluye control de ciclos para evitar bucles.
     * (Comentarios en español)
     */
    static async resolverCostoIngrediente(db, ingredienteId, visited = new Set()) {
        if (!ingredienteId) return 0;
        const idStr = String(ingredienteId).trim();
        if (visited.has(idStr)) return 0;
        visited.add(idStr);

        try {
            let ingRes;
            if (/^\d+$/.test(idStr)) {
                ingRes = await db.query(
                    'SELECT id, costo_patron, receta_base_kg FROM public.ingredientes WHERE id = $1',
                    [parseInt(idStr)]
                );
            } else {
                ingRes = await db.query(
                    'SELECT id, costo_patron, receta_base_kg FROM public.ingredientes WHERE id::text = $1 OR LOWER(nombre_ingrediente) = LOWER($1) LIMIT 1',
                    [idStr]
                );
            }

            if (ingRes.rows.length === 0) return 0;
            const ingrediente = ingRes.rows[0];
            const numId = ingrediente.id;

            const compRes = await db.query(
                'SELECT ingrediente_id, cantidad FROM public.ingrediente_composicion WHERE mix_id = $1',
                [numId]
            );

            if (compRes.rows.length === 0) {
                return parseFloat(ingrediente.costo_patron || 0);
            }

            let total = 0;
            for (const comp of compRes.rows) {
                const costoComp = await this.resolverCostoIngrediente(db, comp.ingrediente_id, new Set(visited));
                total += parseFloat(comp.cantidad || 0) * costoComp;
            }

            const baseKg = parseFloat(ingrediente.receta_base_kg || 1);
            return baseKg > 0 ? (total / baseKg) : total;
        } catch (err) {
            console.error("❌ [resolverCostoIngrediente] Exception for ID:", ingredienteId, err.message);
            return 0;
        }
    }

    /**
     * Helper de alto rendimiento para resolver costos "En Vivo" por receta, lote o manual
     */
    static async resolverCostosEnVivo(db) {
        // 1. Obtener costos unitarios de precios_articulos
        const resPrecios = await db.query("SELECT articulo, costo FROM public.precios_articulos");
        const preciosMap = new Map();
        resPrecios.rows.forEach(r => preciosMap.set(String(r.articulo).trim(), parseFloat(r.costo || 0)));

        // Enriquecer con insumos de public.ingredientes (bolsas, empaques, etc.)
        try {
            const resIngCostos = await db.query("SELECT id, costo_patron FROM public.ingredientes");
            resIngCostos.rows.forEach(r => {
                preciosMap.set(String(r.id).trim(), parseFloat(r.costo_patron || 0));
            });
        } catch(err) {
            console.error("❌ [BUNKER-COSTS] Error al cargar costos de ingredientes en preciosMap:", err);
        }

        // Enriquecer con artículos bunker (semielaborados / insumos propios)
        try {
            const resBunkerCostos = await db.query("SELECT articulo_id, costo_base FROM public.bunker_articulos");
            resBunkerCostos.rows.forEach(r => {
                const k = String(r.articulo_id).trim();
                if (!preciosMap.has(k)) {
                    preciosMap.set(k, parseFloat(r.costo_base || 0));
                }
            });
        } catch(err) {
            console.error("❌ [BUNKER-COSTS] Error al cargar costos de bunker_articulos en preciosMap:", err);
        }

        // Enriquecer con insumos de Supabase
        try {
            const resUniqueInsumos = await db.query("SELECT DISTINCT insumo_articulo_numero FROM public.bunker_lista_insumos WHERE insumo_articulo_numero IS NOT NULL");
            const uuidInsumos = resUniqueInsumos.rows
                .map(r => String(r.insumo_articulo_numero).trim())
                .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
            
            if (uuidInsumos.length > 0) {
                const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
                const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
                const queryUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,datos_maestros&id=in.(${uuidInsumos.join(',')})`;
                
                const resBatch = await fetch(queryUrl, { headers });
                if (resBatch.ok) {
                    const data = await resBatch.json();
                    data.forEach(row => {
                        let priceVal = 0;
                        if (row.datos_maestros && row.datos_maestros.precio) {
                            const cleanPrice = String(row.datos_maestros.precio).replace(/\./g, '').replace(',', '.');
                            priceVal = parseFloat(cleanPrice) || 0;
                        }
                        preciosMap.set(row.id, priceVal);
                    });
                }
            }
        } catch (err) {
            console.error("❌ [BUNKER-COSTS] Error al resolver costos de insumos Supabase en lote:", err);
        }

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

        // 5. Cargar ingredientes y composiciones en memoria para resolver costo_patron dinámico (Comentarios en español)
        const resIng = await db.query("SELECT id, costo_patron, receta_base_kg FROM public.ingredientes");
        const resComp = await db.query("SELECT mix_id, ingrediente_id, cantidad FROM public.ingrediente_composicion");

        const ingredientsMap = new Map();
        resIng.rows.forEach(r => {
            ingredientsMap.set(String(r.id), {
                costo_patron: parseFloat(r.costo_patron || 0),
                receta_base_kg: parseFloat(r.receta_base_kg || 1),
                resolved_cost: null
            });
        });

        const compositionsMap = new Map();
        resComp.rows.forEach(r => {
            const mixId = String(r.mix_id);
            if (!compositionsMap.has(mixId)) {
                compositionsMap.set(mixId, []);
            }
            compositionsMap.get(mixId).push({
                ingrediente_id: String(r.ingrediente_id),
                cantidad: parseFloat(r.cantidad || 0)
            });
        });

        function resolveCost(idStr, visited = new Set()) {
            const ing = ingredientsMap.get(idStr);
            if (!ing) return 0;
            if (ing.resolved_cost !== null) return ing.resolved_cost;

            if (visited.has(idStr)) {
                // Control de ciclos en memoria
                return ing.costo_patron;
            }
            visited.add(idStr);

            const components = compositionsMap.get(idStr);
            if (!components || components.length === 0) {
                ing.resolved_cost = ing.costo_patron;
            } else {
                let total = 0;
                components.forEach(comp => {
                    total += comp.cantidad * resolveCost(comp.ingrediente_id, new Set(visited));
                });
                const baseKg = ing.receta_base_kg || 1;
                ing.resolved_cost = baseKg > 0 ? (total / baseKg) : total;
            }
            return ing.resolved_cost;
        }

        const resolvedCostsMap = new Map();
        for (const idStr of ingredientsMap.keys()) {
            resolvedCostsMap.set(idStr, resolveCost(idStr));
        }

        // 6. Cargar kilos_unidad de todos los artículos para resolución precisa de factores
        const resKilos = await db.query("SELECT articulo_id, kilos_unidad FROM public.bunker_articulos");
        const kilosMap = new Map();
        resKilos.rows.forEach(r => {
            kilosMap.set(String(r.articulo_id).trim().toLowerCase(), parseFloat(r.kilos_unidad || 1));
        });

        return { preciosMap, lotesMap, recetaMap, ingredientesPorReceta, resolvedCostsMap, kilosMap };
    }

    /**
     * Calcula el costo de ingrediente en vivo basándose en recetas o lotes vinculados (Estrictamente POR KILOGRAMO)
     */
    static calcularCostoIngredienteEnVivo(articulo_id, pack_hijo_codigo, costo_base_manual, context, kilos_unidad = 1) {
        const { lotesMap, recetaMap, ingredientesPorReceta, resolvedCostsMap, kilosMap } = context;
        const codigoBase = pack_hijo_codigo || articulo_id;
        const recetaId = recetaMap.get(codigoBase);
        
        // Si el código base es un hijo de pack, la receta corresponde al tamaño del hijo, NO al del pack padre
        const codigoBaseKey = String(codigoBase).trim().toLowerCase();
        const factorReceta = (pack_hijo_codigo && kilosMap && kilosMap.has(codigoBaseKey))
            ? (kilosMap.get(codigoBaseKey) || 1)
            : (parseFloat(kilos_unidad) > 0 ? parseFloat(kilos_unidad) : 1);

        if (recetaId && ingredientesPorReceta.has(recetaId)) {
            const ingredientes = ingredientesPorReceta.get(recetaId);
            let costoTotalReceta = 0;
            ingredientes.forEach(ing => {
                const ingIdStr = String(ing.ingrediente_id);
                // Usar el costo_patron resolved (de ingredientes) en lugar de lote
                const costoPatron = resolvedCostsMap ? (resolvedCostsMap.get(ingIdStr) || 0) : 0;
                costoTotalReceta += parseFloat(ing.cantidad) * costoPatron;
            });
            if (costoTotalReceta > 0) {
                // La receta representa la producción del bulto del codigoBase, por ende la dividimos por su factor para tener el costo por kilo
                return costoTotalReceta / factorReceta;
            }
        }

        // Fallback 1: Último lote shadow directo
        const loteDirecto = lotesMap.get(codigoBase);
        if (loteDirecto) {
            // El costo del lote directo ya está expresado por kilogramo
            return loteDirecto.costo_kilo;
        }

        // Fallback 2: Costo manual del búnker (guardado a nivel bulto, lo dividimos por el factor)
        const factorManual = parseFloat(kilos_unidad) > 0 ? parseFloat(kilos_unidad) : 1;
        return parseFloat(costo_base_manual || 0) / factorManual;
    }

    /**
     * Calcula el costo de insumos en vivo
     */
    static calcularCostoInsumosEnVivo(insumos, context) {
        const { preciosMap } = context;
        let totalInsumos = 0;
        if (insumos && Array.isArray(insumos)) {
            insumos.forEach(ins => {
                // Solo sumar al costo si el operador explícitamente lo incluyó (HITL)
                if (ins.incluido === true || ins.incluido === 'true') {
                    const key = String(ins.insumo_articulo_numero || '').trim();
                    const liveCost = (preciosMap && preciosMap.has(key)) 
                        ? preciosMap.get(key) 
                        : parseFloat(ins.costo_unitario_capturado || 0);
                    totalInsumos += parseFloat(ins.cantidad || 0) * liveCost;
                }
            });
        }
        return totalInsumos;
    }

    /**
     * Auxiliar de Normalización de Cadenas (Title Case y Trim para eliminar suciedad de tipeo)
     */
    static normalizarCadenaDict(str) {
        if (!str) return '';
        const s = String(str).trim().toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /**
     * Auxiliar de Inserción Orgánica en el Diccionario Maestro (public.bunker_diccionario)
     * Inserta automáticamente términos posicionales no existentes asignados a en_revision = true
     */
    static async autoPoblarDiccionarioOrganico(client, finalProps) {
        if (!finalProps) return;

        try {
            // 1. Auto-poblar el Atributo Ancla en bunker_diccionario si existe (v5.72)
            let anclaId = null;
            if (finalProps.articulo_principal) {
                const terminoAncla = BunkerService.normalizarCadenaDict(finalProps.articulo_principal);
                if (terminoAncla) {
                    const abrevAncla = terminoAncla.substring(0, 5).toUpperCase();
                    const resSearchAncla = await client.query(
                        `SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) = LOWER($1) LIMIT 1`,
                        [terminoAncla]
                    );
                    if (resSearchAncla.rows.length > 0) {
                        anclaId = resSearchAncla.rows[0].id;
                    } else {
                        const resDictAncla = await client.query(`
                            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                            VALUES ($1, $2, 'articulo_principal', false, false)
                            RETURNING id
                        `, [terminoAncla, abrevAncla]);
                        if (resDictAncla.rows.length > 0) {
                            anclaId = resDictAncla.rows[0].id;
                        }
                    }
                }
            }

            if (!finalProps.posiciones || typeof finalProps.posiciones !== 'object') {
                return;
            }
            
            // 2. Auto-poblar los Atributos de Categoría Posicionales (v5.72)
            for (const posKey of Object.keys(finalProps.posiciones)) {
                const pos = finalProps.posiciones[posKey];
                if (!pos || !pos.eje || !pos.valor) continue;

                const terminoVal = BunkerService.normalizarCadenaDict(pos.valor);
                const categoriaVal = String(pos.eje).trim();
                if (!terminoVal || !categoriaVal) continue;

                let abrevVal = pos.abreviatura ? String(pos.abreviatura).trim() : '';
                if (!abrevVal || abrevVal.toLowerCase() === terminoVal.toLowerCase()) {
                    abrevVal = terminoVal.toUpperCase().substring(0, 10);
                }

                const resSearchVal = await client.query(
                    `SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) = LOWER($1) AND LOWER(categoria) = LOWER($2) LIMIT 1`,
                    [terminoVal, categoriaVal]
                );
                if (resSearchVal.rows.length === 0) {
                    await client.query(`
                        INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                        VALUES ($1, $2, $3, false, false)
                    `, [terminoVal, abrevVal, categoriaVal]);
                }
            }

            // 3. Auto-poblar la Red Relacional Determinista por IDs Numéricos Garantizados
            if (finalProps.articulo_principal && finalProps.familia_id) {
                const termAnclaText = BunkerService.normalizarCadenaDict(finalProps.articulo_principal);
                const famIdNum = parseInt(finalProps.familia_id) || 6;

                // Recuperar ID numérico del ancla si no se obtuvo previamente
                if (!anclaId) {
                    const resAnclaSearch = await client.query(
                        `SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) = LOWER($1) AND categoria IN ('articulo_principal', 'general') LIMIT 1`,
                        [termAnclaText]
                    );
                    if (resAnclaSearch.rows.length > 0) {
                        anclaId = resAnclaSearch.rows[0].id;
                    }
                }

                for (const posKey of Object.keys(finalProps.posiciones || {})) {
                    const pos = finalProps.posiciones[posKey];
                    if (!pos || !pos.eje || !pos.valor) continue;
                    const valTermText = BunkerService.normalizarCadenaDict(pos.valor);
                    const catText = String(pos.eje).trim().toLowerCase();

                    // Recuperar ID numérico del término de categoría (o crearlo si no existe)
                    let termId = null;
                    const resTermSearch = await client.query(
                        `SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) = LOWER($1) LIMIT 1`,
                        [valTermText]
                    );
                    if (resTermSearch.rows.length > 0) {
                        termId = resTermSearch.rows[0].id;
                    } else {
                        const abrevVal = pos.abreviatura ? String(pos.abreviatura).trim().toUpperCase() : valTermText.substring(0, 5).toUpperCase();
                        const insTermRes = await client.query(`
                            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                            VALUES ($1, $2, $3, false, false)
                            RETURNING id
                        `, [valTermText, abrevVal, catText]);
                        termId = insTermRes.rows[0].id;
                    }

                    // Resolver categoria_id numérico entero
                    let catIdNum = null;
                    const fcRes = await client.query(`
                        SELECT id FROM public.bunker_familia_categorias
                        WHERE familia_id = $1 AND LOWER(TRIM(categoria)) = LOWER(TRIM($2))
                        LIMIT 1
                    `, [famIdNum, catText]);
                    if (fcRes.rows.length > 0) {
                        catIdNum = fcRes.rows[0].id;
                    }

                    // Inserción relacional determinista con claves numéricas (ON CONFLICT id index)
                    await client.query(`
                        INSERT INTO public.bunker_relacion_atributo_principal 
                            (familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria, categoria_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (familia_id, articulo_principal_id, termino_id, LOWER(categoria)) 
                        DO UPDATE SET 
                            articulo_principal_texto = EXCLUDED.articulo_principal_texto,
                            termino_texto = EXCLUDED.termino_texto,
                            categoria_id = COALESCE(EXCLUDED.categoria_id, public.bunker_relacion_atributo_principal.categoria_id)
                    `, [famIdNum, anclaId, termAnclaText, termId, valTermText, catText, catIdNum]);

                    console.log(`🚨 [VIGÍA AUTO-POBLAR DICCIONARIO] Vínculo relacional registrado/promovido por IDs: FamiliaID=${famIdNum}, PrincipalID=${anclaId} ("${termAnclaText}"), TerminoID=${termId} ("${valTermText}"), Categoria="${catText}"`);
                }
            }
        } catch (errDict) {
            console.error('❌ [BUNKER-SERVICE - AUTO-POBLAR EXCEPCIÓN]:', errDict);
            throw errDict;
        }
    }

    static async obtenerTodosLosArticulos(db, filtros = {}) {
        let query = `
            WITH reservas_crudas AS (
              SELECT
                COALESCE(src_res.articulo_numero, ba_res.articulo_id, a_res.numero, pd.articulo) AS articulo_numero,
                SUM(pd.cantidad) AS cantidad_reservada
              FROM public.presupuestos_detalles pd
              JOIN public.presupuestos p ON p.id = pd.id_presupuesto
              LEFT JOIN public.stock_real_consolidado src_res ON (src_res.articulo_numero = pd.articulo OR src_res.codigo_barras = pd.articulo)
              LEFT JOIN public.bunker_articulos ba_res ON (ba_res.articulo_id = pd.articulo OR ba_res.codigo_barras = pd.articulo)
              LEFT JOIN public.articulos a_res ON (a_res.numero = pd.articulo OR a_res.codigo_barras = pd.articulo)
              WHERE p.activo = true
                AND COALESCE(p.archivado, false) = false
                AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
                AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
                AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Entregado', 'Finalizado', 'Cancelado')
                AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
                AND p.factura_id IS NULL
                AND p.id_factura_lomasoft IS NULL
                AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
              GROUP BY COALESCE(src_res.articulo_numero, ba_res.articulo_id, a_res.numero, pd.articulo)
            )
            SELECT 
                b.articulo_id, 
                b.descripcion, 
                b.descripcion_generada, 
                b.costo_base, 
                b.porcentaje_iva,
                b.propiedades_dinamicas,
                b.familia_id,
                COALESCE(f.nombre, b.rubro, 'Sin Familia') AS familia_nombre,
                COALESCE(
                    (b.propiedades_dinamicas->>'articulo_principal_id')::integer,
                    r_princ.articulo_principal_id,
                    d_direct.id,
                    0
                ) AS articulo_principal_id,
                COALESCE(
                    d_direct.termino,
                    r_princ.articulo_principal_texto,
                    b.propiedades_dinamicas->>'articulo_principal',
                    b.sub_rubro,
                    'Sin Atributo Principal'
                ) AS articulo_principal_nombre,
                b.rubro,
                b.sub_rubro,
                b.pack_hijo_codigo,
                b.es_pack,
                b.pack_unidades,
                b.kilos_unidad,
                b.expresado_en_unidades,
                COALESCE(b.no_producido_por_lambda, false) AS no_producido_por_lambda,
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
                0) as total_mapeos_reposicion,
                -- Stock Físico (Consolidado)
                CASE
                  WHEN (COALESCE(b.es_pack, false) = true OR b.pack_hijo_codigo IS NOT NULL)
                       AND COALESCE(b.pack_unidades, 1) > 1
                  THEN
                    COALESCE(src_stock.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(b.pack_unidades, 1))
                  ELSE
                    COALESCE(src_stock.stock_consolidado, 0)
                END AS stock_fisico,
                -- Stock Reservado (en pedidos activos)
                CASE
                  WHEN (COALESCE(b.es_pack, false) = true OR b.pack_hijo_codigo IS NOT NULL)
                       AND COALESCE(b.pack_unidades, 1) > 1
                  THEN
                    COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(b.pack_unidades, 1)::numeric)
                  ELSE
                    COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
                END AS stock_reservado,
                -- Stock Disponible Real
                CASE
                  WHEN (COALESCE(b.es_pack, false) = true OR b.pack_hijo_codigo IS NOT NULL)
                       AND COALESCE(b.pack_unidades, 1) > 1
                  THEN
                    GREATEST(0, COALESCE(src_stock.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                    FLOOR(
                      GREATEST(0, 
                        COALESCE(src_hijo.stock_consolidado, 0) - (
                          COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(b.pack_unidades, 1))
                        )
                      ) / COALESCE(b.pack_unidades, 1)
                    )
                  ELSE
                    GREATEST(0, COALESCE(src_stock.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                END AS stock_disponible,
                -- Stock Legacy: Disponible para retrocompatibilidad
                CASE
                  WHEN (COALESCE(b.es_pack, false) = true OR b.pack_hijo_codigo IS NOT NULL)
                       AND COALESCE(b.pack_unidades, 1) > 1
                  THEN
                    GREATEST(0, COALESCE(src_stock.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
                    FLOOR(
                      GREATEST(0, 
                        COALESCE(src_hijo.stock_consolidado, 0) - (
                          COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(b.pack_unidades, 1))
                        )
                      ) / COALESCE(b.pack_unidades, 1)
                    )
                  ELSE
                    GREATEST(0, COALESCE(src_stock.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
                END AS stock_legacy
            FROM public.bunker_articulos b
            LEFT JOIN public.articulos a ON b.articulo_id = a.numero
            LEFT JOIN public.bunker_familias f ON f.id = b.familia_id
            LEFT JOIN public.bunker_relacion_atributo_principal r_princ 
                ON r_princ.familia_id = b.familia_id 
               AND LOWER(TRIM(r_princ.articulo_principal_texto)) = LOWER(TRIM(COALESCE(b.propiedades_dinamicas->>'articulo_principal', b.sub_rubro, '')))
               AND r_princ.categoria = 'articulo_principal'
            LEFT JOIN public.bunker_diccionario d_direct
                ON d_direct.id = COALESCE((b.propiedades_dinamicas->>'articulo_principal_id')::integer, r_princ.articulo_principal_id)
            LEFT JOIN public.stock_real_consolidado src_stock ON (src_stock.articulo_numero = b.articulo_id OR src_stock.codigo_barras = b.articulo_id)
            LEFT JOIN public.stock_real_consolidado src_hijo ON (
                src_hijo.articulo_numero = b.pack_hijo_codigo
                OR src_hijo.codigo_barras = b.pack_hijo_codigo
            )
            LEFT JOIN reservas_crudas res_art ON (res_art.articulo_numero = b.articulo_id)
            LEFT JOIN reservas_crudas res_hijo ON (res_hijo.articulo_numero = src_hijo.articulo_numero)
            LEFT JOIN LATERAL (
                SELECT SUM(rc_padre.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
                FROM public.bunker_articulos bp
                JOIN reservas_crudas rc_padre ON rc_padre.articulo_numero = bp.articulo_id
                WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
                  AND (bp.pack_hijo_codigo = b.articulo_id OR bp.pack_hijo_codigo = a.codigo_barras)
            ) res_padres ON true
            WHERE 1=1
        `;
        let params = [];
        let pIndex = 1;

        if (filtros.search) {
            const searchTerm = filtros.search.trim();
            const isEmb = searchTerm.toUpperCase().startsWith('EMB-');
            const isTenDigits = /^\d{10}$/.test(searchTerm);
            
            let isLot = false;
            try {
                const lotCheck = await db.query(
                    `SELECT 1 FROM public.bunker_lotes_vinculos 
                     WHERE LOWER(lote_id_supabase) = LOWER($1) 
                        OR LOWER(lote_codigo_corto) = LOWER($1)
                        OR LOWER(id::text) = LOWER($1) 
                     LIMIT 1`, 
                    [searchTerm]
                );
                isLot = lotCheck.rows.length > 0;
            } catch (e) {
                console.error('Error verificando lote en buscador omnicanal:', e);
            }

            if (isEmb) {
                query += ` AND LOWER(b.articulo_id) = LOWER($${pIndex})`;
                params.push(searchTerm);
                pIndex++;
            } else if (isTenDigits) {
                query += ` AND (
                    LOWER(a.codigo_barras) = LOWER($${pIndex}) 
                    OR LOWER(b.propiedades_dinamicas->>'codigo_barras_local') = LOWER($${pIndex})
                )`;
                params.push(searchTerm);
                pIndex++;
            } else if (isLot) {
                query += ` AND b.articulo_id IN (
                    SELECT d.destino_id
                    FROM public.bunker_lotes_destinos d
                    JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                    WHERE (LOWER(v.lote_id_supabase) = LOWER($${pIndex}) OR LOWER(v.lote_codigo_corto) = LOWER($${pIndex}) OR LOWER(v.id::text) = LOWER($${pIndex}))
                      AND d.tipo_destino = 'ARTICULO_BUNKER'
                )`;
                params.push(searchTerm);
                pIndex++;
            } else {
                // Búsqueda multipalabra aditiva (AND por cada término separado por espacio)
                const words = searchTerm.split(/\s+/).filter(Boolean);
                if (words.length > 0) {
                    words.forEach(word => {
                        query += ` AND (b.descripcion_generada ILIKE $${pIndex} OR b.descripcion ILIKE $${pIndex} OR b.articulo_id ILIKE $${pIndex} OR jsonb_path_query_array(b.propiedades_dinamicas, '$.*.valor')::text ILIKE $${pIndex})`;
                        params.push(`%${word}%`);
                        pIndex++;
                    });
                }
            }
        }
        
        query += ` ORDER BY b.descripcion_generada ASC LIMIT 1000`;
        const result = await db.query(query, params);
        const articles = result.rows;

        if (articles.length === 0) return [];

        // 1. Obtener contexto de costos en vivo
        const context = await this.resolverCostosEnVivo(db);

        // 1b. Obtener todas las listas de precios activas para asegurar correspondencia
        const resListasActivas = await db.query("SELECT id, nombre FROM public.bunker_listas_precios WHERE activa = true ORDER BY id ASC");
        const listasActivas = resListasActivas.rows.length > 0 ? resListasActivas.rows : [{ id: 1, nombre: 'Lista Nico' }];

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
                COALESCE(la.es_patron, false) as es_patron,
                COALESCE(la.disponible, true) as disponible,
                COALESCE(la.exencion_operativa, false) as exencion_operativa,
                COALESCE(la.rendimiento_activo, true) as rendimiento_activo,
                COALESCE(la.mano_obra_activa, true) as mano_obra_activa
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
            SELECT li.lista_articulo_id, li.insumo_articulo_numero, li.cantidad, li.costo_unitario_capturado, li.incluido
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

            art.margenes = listasActivas.map(list => {
                const la = artConfigs.find(c => c.lista_id === list.id);
                if (la) {
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
                        asignado: true,
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
                        descripcion_patron: descripcionPatron,
                        disponible: la.disponible,
                        exencion_operativa: la.exencion_operativa === true || la.exencion_operativa === 'true',
                        rendimiento_activo: la.rendimiento_activo !== false,
                        mano_obra_activa: la.mano_obra_activa !== false
                    };
                } else {
                    // Si no tiene configuración en la nueva lista, intentar heredar del fallback
                    const legacyMargenes = legacyPorArt.get(art.articulo_id) || [];
                    const lm = legacyMargenes.find(m => m.lista_id === list.id);
                    
                    if (lm) {
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
                            asignado: false,
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
                            descripcion_patron: descripcionPatron,
                            disponible: true,
                            exencion_operativa: false,
                            rendimiento_activo: true,
                            mano_obra_activa: true
                        };
                    } else {
                        // Intentar heredar de la configuración de Lista 1 (Lista Nico) si existe
                        const laL1 = artConfigs.find(c => c.lista_id === 1) || artConfigs[0];
                        if (laL1) {
                            const laInsumos = insumosPorLA.get(laL1.id) || [];
                            const liveInsumoCost = BunkerService.calcularCostoInsumosEnVivo(laInsumos, context);
                            
                            const cBase = laL1.costo_base_sobrescrito !== null ? parseFloat(laL1.costo_base_sobrescrito) : liveIngredienteCost;
                            const baseCostoVivo = (cBase * factor) + liveInsumoCost;

                            const ivaCoeff = 1 + (parseFloat(laL1.iva) / 100);
                            const precioS_iva = parseFloat(laL1.precio_final) / ivaCoeff;
                            const costoOperativo = parseFloat(laL1.costo_tiempo);

                            let margenImplicito = 0;
                            if (baseCostoVivo > 0) {
                                margenImplicito = ((precioS_iva - costoOperativo) / baseCostoVivo - 1) * 100;
                            }

                            const targetMargen = parseFloat(laL1.margen_ganancia);
                            const diffMargen = targetMargen - margenImplicito;
                            const costo_desactualizado = Math.abs(diffMargen) > 0.1;

                            const keyPatron = `${list.id}_${baseIng}`;
                            const patronInfo = patronesMap.get(keyPatron);
                            let margenHeredado = null;
                            let descripcionPatron = null;
                            if (patronInfo && patronInfo.articulo_id !== art.articulo_id) {
                                margenHeredado = patronInfo.margen_ganancia;
                                descripcionPatron = patronInfo.descripcion_patron;
                            }

                            return {
                                lista_id: list.id,
                                asignado: false,
                                margen_porcentaje: laL1.margen_ganancia,
                                costo_base_sobrescrito: laL1.costo_base_sobrescrito,
                                costo_tiempo: laL1.costo_tiempo,
                                iva: laL1.iva,
                                precio_final: laL1.precio_final,
                                modo_calculo: laL1.modo_calculo,
                                costo_desactualizado: costo_desactualizado,
                                costo_ingrediente_en_vivo: liveIngredienteCost,
                                costo_insumos_en_vivo: liveInsumoCost,
                                margen_implicito: margenImplicito,
                                modo_iva: laL1.modo_iva,
                                es_patron: false,
                                margen_patron_heredado: margenHeredado,
                                descripcion_patron: descripcionPatron,
                                disponible: true,
                                exencion_operativa: laL1.exencion_operativa === true || laL1.exencion_operativa === 'true',
                                rendimiento_activo: laL1.rendimiento_activo !== false,
                                mano_obra_activa: laL1.mano_obra_activa !== false
                            };
                        } else {
                            // Fallback por defecto usando margen 0%
                            const keyPatron = `${list.id}_${baseIng}`;
                            const patronInfo = patronesMap.get(keyPatron);
                            let margenHeredado = null;
                            let descripcionPatron = null;
                            if (patronInfo && patronInfo.articulo_id !== art.articulo_id) {
                                margenHeredado = patronInfo.margen_ganancia;
                                descripcionPatron = patronInfo.descripcion_patron;
                            }

                            const lm1 = legacyMargenes.find(m => m.lista_id === 1) || legacyMargenes[0];
                            const defMargen = lm1 ? parseFloat(lm1.margen_porcentaje) : 0;

                            return {
                                lista_id: list.id,
                                asignado: false,
                                margen_porcentaje: defMargen,
                                costo_base_sobrescrito: null,
                                costo_tiempo: 0,
                                iva: art.porcentaje_iva || 21.00,
                                precio_final: (liveIngredienteCost * factor) * (1 + (defMargen / 100)) * (1 + ((art.porcentaje_iva || 21.00) / 100)),
                                modo_calculo: 'AUTOMATIC',
                                costo_desactualizado: false,
                                costo_ingrediente_en_vivo: liveIngredienteCost,
                                costo_insumos_en_vivo: 0,
                                margen_implicito: defMargen,
                                modo_iva: 'COMPLETO',
                                es_patron: false,
                                margen_patron_heredado: margenHeredado,
                                descripcion_patron: descripcionPatron,
                                disponible: true,
                                exencion_operativa: false,
                                rendimiento_activo: false,
                                mano_obra_activa: false
                            };
                        }
                    }
                }
            });
        }

        return articles;
    }

    /**
     * Obtener Radiografía Financiera con Listas de Precios Búnker y Gestión de Insumos Secundarios
     */
    /**
     * 🌲 Motor de Resolución Financiera Jerárquico BOM (3 Niveles con Detección Anti-Circular) - Fase 51
     */
    static async resolverCostoJerarquico(db, articuloId, visitedSet = new Set(), depth = 0, opciones = {}) {
        const idClean = String(articuloId || '').trim();
        if (!idClean || depth > 5 || visitedSet.has(idClean)) {
            return { costo_kilo: 0, fuente: 'CIRCULAR_PREVENTED' };
        }
        visitedSet.add(idClean);

        // 1. Obtener artículo de Búnker o Fallback por ID / descripción
        let art = null;
        try {
            if (/^\d+$/.test(idClean)) {
                art = await this.obtenerArticulo(db, parseInt(idClean));
            }
            if (!art) {
                const resF = await db.query(
                    `SELECT articulo_id, descripcion, descripcion_generada, kilos_unidad, costo_base, propiedades_dinamicas
                     FROM public.bunker_articulos
                     WHERE articulo_id::text = $1 OR LOWER(descripcion) = LOWER($1) OR LOWER(descripcion_generada) = LOWER($1)
                     LIMIT 1`,
                    [idClean]
                );
                if (resF.rows.length > 0) art = resF.rows[0];
            }
        } catch(e) {}

        if (!art) {
            return { costo_kilo: 0, fuente: 'NOT_FOUND' };
        }

        const kUnidad = parseFloat(art.kilos_unidad) || 1.0;
        const props = typeof art.propiedades_dinamicas === 'string' ? (JSON.parse(art.propiedades_dinamicas || '{}')) : (art.propiedades_dinamicas || {});
        const isWIP = props.presentacion_variable_wip === true;

        // NIVEL 1: Cotizaciones activas de proveedores externos en Supabase u ofertas mapeadas
        try {
            const resMapeo = await db.query(
                `SELECT proveedor_producto_codigo FROM public.bunker_articulos_reposicion_mapeo WHERE LOWER(bunker_articulo_id) = LOWER($1)`,
                [String(art.articulo_id)]
            );
            if (!opciones.solo_local && resMapeo.rows.length > 0) {
                const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
                const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
                const cod = String(resMapeo.rows[0].proveedor_producto_codigo).trim();
                const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&or=(datos_maestros->>codigo.eq."${cod}",datos_maestros->>sku.eq."${cod}")&limit=1`;
                const resp = await supabaseFetch(url, { headers });
                if (resp.ok) {
                    const cotData = await resp.json();
                    if (cotData.length > 0 && cotData[0].datos_maestros && cotData[0].datos_maestros.precio) {
                        const cleanPrice = String(cotData[0].datos_maestros.precio).replace(/\./g, '').replace(',', '.');
                        const pVal = parseFloat(cleanPrice) || 0;
                        if (pVal > 0) {
                            return { costo_kilo: pVal / kUnidad, fuente: 'NIVEL_1_OFERTA_EXTERNA' };
                        }
                    }
                }
            }
        } catch(eN1) {}

        // NIVEL 2: Insumo WIP / Búnker con Receta Madre Activa
        try {
            const resReceta = await db.query(
                `SELECT id, kilos_salida FROM public.recetas WHERE articulo_numero = $1 ORDER BY fecha_creacion DESC LIMIT 1`,
                [art.articulo_id]
            );
            if (resReceta.rows.length > 0) {
                const recId = resReceta.rows[0].id;
                const kilosSalidaReceta = parseFloat(resReceta.rows[0].kilos_salida) || kUnidad || 1.0;

                const resIngs = await db.query(
                    `SELECT ingrediente_id, cantidad FROM public.receta_ingredientes WHERE receta_id = $1`,
                    [recId]
                );
                if (resIngs.rows.length > 0) {
                    let costoTotalReceta = 0;
                    for (const ing of resIngs.rows) {
                        const cantKilos = parseFloat(ing.cantidad) || 0;
                        const subRes = await this.resolverCostoJerarquico(db, ing.ingrediente_id, new Set(visitedSet), depth + 1);
                        costoTotalReceta += cantKilos * subRes.costo_kilo;
                    }
                    if (costoTotalReceta > 0) {
                        return { costo_kilo: costoTotalReceta / kilosSalidaReceta, fuente: 'NIVEL_2_RECETA_MADRE_WIP' };
                    }
                }
            }
        } catch(eN2) {}

        // NIVEL 3: Fallback a costo_base estático registrado en bunker_articulos
        const costoBaseVal = parseFloat(art.costo_base) || 0;
        const costoKiloFinal = isWIP ? costoBaseVal : (costoBaseVal > 0 ? (costoBaseVal / kUnidad) : 0);

        return { costo_kilo: costoKiloFinal, fuente: 'NIVEL_3_COSTO_BASE_MANUAL' };
    }

    /**
     * HITO A (Fase 3 - v5.44): Extraer Costo Vivo por Kilo de Materia Prima Nexo
     */
    static async obtenerCostoVivoNexo(db, sku_nexo) {
        if (!sku_nexo) return { costo_kilo_crudo: 0, kilos_bulto: 1, fuente_aplicada: 'SIN_SKU' };

        try {
            const finData = await this.obtenerRadiografiaFinanciera(db, sku_nexo);
            if (!finData) return { costo_kilo_crudo: 0, kilos_bulto: 1, fuente_aplicada: 'NO_ENCONTRADO' };

            const kgBulto = parseFloat(finData.kilos_unidad) || 1.00;
            let costoKiloCrudo = 0;
            let costoTiempoTotal = 0;
            let fuenteAplicada = 'LEGACY_FALLBACK';

            // Prioridad 1: Buscar costo_base_sobrescrito en listas_margenes
            if (Array.isArray(finData.listas_margenes) && finData.listas_margenes.length > 0) {
                const listaActiva = finData.listas_margenes.find(l => l.disponible === true || l.es_patron === true) 
                    || finData.listas_margenes[0];

                if (listaActiva && parseFloat(listaActiva.costo_base_sobrescrito) > 0) {
                    costoKiloCrudo = parseFloat(listaActiva.costo_base_sobrescrito);
                    costoTiempoTotal = parseFloat(listaActiva.costo_tiempo) || 0;
                    fuenteAplicada = `LISTA_${listaActiva.nombre_lista.toUpperCase()}`;
                }
            }

            // Prioridad 2: Sumatoria ponderada de receta_ingredientes
            if (costoKiloCrudo === 0 && Array.isArray(finData.receta_ingredientes) && finData.receta_ingredientes.length > 0) {
                let sumaIngs = 0;
                let tieneCostos = false;
                finData.receta_ingredientes.forEach(ing => {
                    const cIng = parseFloat(ing.costo_patron_directo || ing.costo_patron) || 0;
                    if (cIng > 0) {
                        sumaIngs += cIng;
                        tieneCostos = true;
                    }
                });
                if (tieneCostos && sumaIngs > 0) {
                    costoKiloCrudo = sumaIngs / kgBulto;
                    fuenteAplicada = 'RECETA_INGREDIENTES_SUM';
                }
            }

            // Prioridad 3: Artículo Simple / Camino 3 (Almendras/Castañas sin receta)
            if (costoKiloCrudo === 0) {
                if (parseFloat(finData.costo_base_manual) > 0) {
                    costoKiloCrudo = parseFloat(finData.costo_base_manual) / kgBulto;
                    fuenteAplicada = 'CATALOGO_DIRECTO_COMMODITY';
                } else if (parseFloat(finData.costo_por_kilo_normalizado) > 0) {
                    costoKiloCrudo = parseFloat(finData.costo_por_kilo_normalizado);
                    fuenteAplicada = 'NORMALIZADO_RAIZ';
                }
            }

            // 🔑 FASE 3 ETAPA 2 (v5.45): Composición de Costo Base Operativo Neto (Insumos + MO Intrínseca)
            // $7.907,27 / kg + ($1.166,67 / 4 kg) = $7.907,27 + $291,67 = $8.198,94 / kg ($32.795,75 para bulto 4kg)
            const costoTiempoPorKilo = kgBulto > 0 ? (costoTiempoTotal / kgBulto) : 0;
            const costoKiloOperativo = costoKiloCrudo + costoTiempoPorKilo;

            return {
                sku_nexo,
                costo_kilo_crudo: Number(costoKiloOperativo.toFixed(2)),
                costo_kilo_insumos_puro: Number(costoKiloCrudo.toFixed(2)),
                costo_tiempo_mo_kilo: Number(costoTiempoPorKilo.toFixed(2)),
                kilos_bulto: kgBulto,
                fuente_aplicada: fuenteAplicada
            };
        } catch (err) {
            console.error(`⚠️ Error extrayendo costo vivo nexo para ${sku_nexo}:`, err);
            return { costo_kilo_crudo: 0, kilos_bulto: 1, fuente_aplicada: 'ERROR_EXCEPCION' };
        }
    }

    static async obtenerRadiografiaFinanciera(db, articulo_id, opciones = {}) {
        let articulo = await this.obtenerArticulo(db, articulo_id);
        if (!articulo) {
            // Fallback 1: Buscar por ID o descripción parcial en stock_real_consolidado y precios_articulos
            const resFallback = await db.query(
                `SELECT s.articulo_numero as articulo_id, s.descripcion, s.codigo_barras, s.kilos_unidad, p.costo as costo_base, p.iva as porcentaje_iva
                 FROM public.stock_real_consolidado s
                 LEFT JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
                 WHERE s.articulo_numero = $1 OR LOWER(s.descripcion) ILIKE $2
                 LIMIT 1`,
                [articulo_id, `%${articulo_id}%`]
            );
            if (resFallback.rows.length > 0) {
                const rowF = resFallback.rows[0];
                articulo = {
                    articulo_id: rowF.articulo_id,
                    descripcion: rowF.descripcion,
                    descripcion_generada: rowF.descripcion,
                    codigo_barras: rowF.codigo_barras,
                    kilos_unidad: parseFloat(rowF.kilos_unidad || 1.0),
                    costo_base: parseFloat(rowF.costo_base || 0),
                    porcentaje_iva: parseFloat(rowF.porcentaje_iva || 21.00),
                    moneda: '($)Pesos',
                    redondeo: 'Ninguno',
                    mantener_utilidad: true,
                    pack_unidades: 1,
                    es_pack: false,
                    propiedades_dinamicas: {}
                };
            } else {
                // Fallback 2: Buscar en la tabla de ingredientes / mezclas de producción
                let resIng = { rows: [] };
                try {
                    resIng = await db.query(
                        `SELECT id as articulo_id, nombre_ingrediente as descripcion, 1.0 as kilos_unidad, COALESCE(costo_patron, 0) as costo_base
                         FROM public.ingredientes
                         WHERE id::text = $1 OR LOWER(nombre_ingrediente) ILIKE $2
                         LIMIT 1`,
                        [articulo_id, `%${articulo_id}%`]
                    );
                } catch(errIng) {}

                if (resIng.rows.length > 0) {
                    const rowI = resIng.rows[0];
                    articulo = {
                        articulo_id: rowI.articulo_id,
                        descripcion: rowI.descripcion,
                        descripcion_generada: rowI.descripcion,
                        codigo_barras: '',
                        kilos_unidad: 1.0,
                        costo_base: parseFloat(rowI.costo_base || 0),
                        porcentaje_iva: 21.0,
                        moneda: '($)Pesos',
                        redondeo: 'Ninguno',
                        mantener_utilidad: true,
                        pack_unidades: 1,
                        es_pack: false,
                        propiedades_dinamicas: {}
                    };
                } else {
                    // Fallback 3: Retornar perfil financiero sintético por defecto para evitar HTTP 500
                    articulo = {
                        articulo_id: articulo_id,
                        descripcion: articulo_id,
                        descripcion_generada: articulo_id,
                        codigo_barras: '',
                        kilos_unidad: 1.0,
                        costo_base: 0,
                        porcentaje_iva: 21.0,
                        moneda: '($)Pesos',
                        redondeo: 'Ninguno',
                        mantener_utilidad: true,
                        pack_unidades: 1,
                        es_pack: false,
                        propiedades_dinamicas: {}
                    };
                }
            }
        }

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
                COALESCE(la.es_patron, false) as es_patron,
                COALESCE(la.disponible, true) as disponible,
                COALESCE(la.exencion_operativa, false) as exencion_operativa,
                COALESCE(la.rendimiento_activo, false) as rendimiento_activo,
                COALESCE(la.mano_obra_activa, false) as mano_obra_activa
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

        // Recopilar todos los UUIDs de insumos de Supabase cargados para este artículo
        const allUuidInsumos = [];
        for (const row of resListas.rows) {
            if (row.lista_articulo_id) {
                const resIns = await db.query(`
                    SELECT DISTINCT insumo_articulo_numero 
                    FROM public.bunker_lista_insumos 
                    WHERE lista_articulo_id = $1
                `, [row.lista_articulo_id]);
                resIns.rows.forEach(ins => {
                    const idClean = String(ins.insumo_articulo_numero).trim();
                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idClean)) {
                        allUuidInsumos.push(idClean);
                    }
                });
            }
        }

        // Consultar Supabase en lote para obtener las descripciones y precios en vivo de los insumos
        const supabaseInsumosMap = new Map();
        if (!opciones.solo_local && allUuidInsumos.length > 0) {
            try {
                const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
                const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
                const queryUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,nombre_proveedor,datos_maestros&id=in.(${[...new Set(allUuidInsumos)].join(',')})`;
                
                const resBatch = await supabaseFetch(queryUrl, { headers });
                if (resBatch.ok) {
                    const data = await resBatch.json();
                    data.forEach(item => {
                        const dm = item.datos_maestros || {};
                        let priceVal = 0;
                        if (dm.precio) {
                            const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                            priceVal = parseFloat(cleanPrice) || 0;
                        }
                        supabaseInsumosMap.set(item.id, {
                            descripcion: `${dm.descripcion || 'Sin descripción'} (${item.nombre_proveedor || 'Sin proveedor'})`,
                            costo_unitario_en_vivo: priceVal
                        });
                    });
                }
            } catch (err) {
                console.error("❌ [BUNKER-RADIOGRAFIA] Error cargando insumos Supabase:", err);
            }
        }

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
                    SELECT li.id, li.insumo_articulo_numero, li.cantidad, li.costo_unitario_capturado, li.incluido,
                           COALESCE(ing.costo_patron, ba.costo_base, p.costo, li.costo_unitario_capturado, 0) as costo_unitario_en_vivo,
                           COALESCE(ing.nombre, ba.descripcion_generada, ba.descripcion, a.nombre, li.insumo_articulo_numero) as descripcion
                    FROM public.bunker_lista_insumos li
                    LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                    LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                    LEFT JOIN public.precios_articulos p ON p.articulo = li.insumo_articulo_numero
                    LEFT JOIN public.articulos a ON a.numero = li.insumo_articulo_numero
                    WHERE li.lista_articulo_id = $1
                `, [row.lista_articulo_id]);
                
                listObj.insumos = resIns.rows.map(ins => {
                    const insObj = { ...ins };
                    const idClean = String(insObj.insumo_articulo_numero).trim();
                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idClean)) {
                        // Insumo de Supabase: cruzar con el mapa enriquecido en lote
                        const sbData = supabaseInsumosMap.get(idClean);
                        if (sbData) {
                            insObj.descripcion = sbData.descripcion;
                            insObj.costo_unitario_en_vivo = sbData.costo_unitario_en_vivo;
                        } else {
                            insObj.descripcion = `Insumo Supabase (${insObj.insumo_articulo_numero})`;
                            insObj.costo_unitario_en_vivo = parseFloat(insObj.costo_unitario_capturado || 0);
                        }
                    }
                    return insObj;
                });
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
        let receta_enlazado_externo = false;
        let receta_ingredientes = [];
        let receta_articulos = [];
        let receta_heredada = false;

        try {
            let codigoBase = articulo.articulo_id;

            const queryReceta = `
                SELECT id, COALESCE(enlazado_externo, false) as enlazado_externo 
                FROM public.recetas 
                WHERE articulo_numero = $1 
                ORDER BY fecha_creacion DESC 
                LIMIT 1
            `;
            let resReceta = await db.query(queryReceta, [codigoBase]);
            
            // Si el artículo no posee receta directa, intentar con su código de empaque padre (herencia)
            // Guardarraíl: Evitar heredar la receta del padre si el artículo actual es un pack comercial (pack_unidades > 1)
            const esPackComercial = parseInt(articulo.pack_unidades || 0) > 1;
            if (resReceta.rows.length === 0 && articulo.pack_hijo_codigo && !esPackComercial) {
                codigoBase = articulo.pack_hijo_codigo;
                resReceta = await db.query(queryReceta, [codigoBase]);
                if (resReceta.rows.length > 0) {
                    receta_heredada = true;
                }
            }
            
            if (resReceta.rows.length > 0) {
                const recetaId = resReceta.rows[0].id;
                receta_id = recetaId;
                receta_enlazado_externo = resReceta.rows[0].enlazado_externo;

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
                // Resolver el costo_patron dinámico para cada ingrediente (Comentarios en español)
                for (const row of resIngredientes.rows) {
                    try {
                        row.costo_patron = await this.resolverCostoIngrediente(db, row.ingrediente_id);
                        
                        let ingRes = { rows: [] };
                        const ingIdClean = String(row.ingrediente_id || '').trim();
                        if (/^\d+$/.test(ingIdClean)) {
                            ingRes = await db.query('SELECT costo_patron FROM public.ingredientes WHERE id = $1', [parseInt(ingIdClean)]);
                        } else if (ingIdClean.length > 0) {
                            ingRes = await db.query('SELECT costo_patron FROM public.ingredientes WHERE id::text = $1 OR LOWER(nombre_ingrediente) = LOWER($1) LIMIT 1', [ingIdClean]);
                        }
                        row.costo_patron_directo = ingRes.rows.length > 0 ? parseFloat(ingRes.rows[0].costo_patron || 0) : 0;
                        
                        let compRes = { rows: [{ count: 0 }] };
                        if (/^\d+$/.test(ingIdClean)) {
                            compRes = await db.query('SELECT COUNT(*) FROM public.ingrediente_composicion WHERE mix_id = $1', [parseInt(ingIdClean)]);
                        }
                        row.es_mix = parseInt(compRes.rows[0].count || 0) > 0;
                    } catch (rowErr) {
                        console.error("❌ [bunkerService] Exception enriching ingredient row:", rowErr.message);
                        row.costo_patron = parseFloat(row.costo_patron || 0);
                        row.costo_patron_directo = parseFloat(row.costo_patron_directo || 0);
                        row.es_mix = false;
                    }
                }
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

        // Si se encontró un ID de receta pero la receta no posee ingredientes ni artículos asociados, considerarla inexistente
        if (receta_id && receta_ingredientes.length === 0 && receta_articulos.length === 0) {
            receta_id = null;
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
        if (!opciones.saltar_reposicion && !opciones.solo_local) {
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

                    const response = await supabaseFetch(url, { headers });
                    if (response.ok) {
                        const cotizaciones = await response.json();

                        // Cargar excepciones de curaduría
                        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
                        let excepciones = [];
                        if (proveedoresIds.length > 0) {
                            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
                            const excRes = await supabaseFetch(excUrl, { headers });
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

                            let cantBultVal = 1;
                            if (dm.cant_bult !== undefined && dm.cant_bult !== null) {
                                if (typeof dm.cant_bult === 'number') {
                                    cantBultVal = dm.cant_bult;
                                } else {
                                    cantBultVal = parseFloat(String(dm.cant_bult).replace(',', '.')) || 1;
                                }
                            }

                            let cantValorVal = 1;
                            if (dm.cant_valor !== undefined && dm.cant_valor !== null) {
                                if (typeof dm.cant_valor === 'number') {
                                    cantValorVal = dm.cant_valor;
                                } else {
                                    cantValorVal = parseFloat(String(dm.cant_valor).replace(',', '.')) || 1;
                                }
                            }

                            return {
                                oferta_id: row.id,
                                proveedor_id: row.proveedor_id,
                                nombre_proveedor: row.nombre_proveedor,
                                sku_proveedor: skuProveedorRaw,
                                descripcion: dm.descripcion || 'Sin descripción',
                                precio_unitario: precioUnitarioVal,
                                unidad_medida: dm.unidad,
                                cant_bult: cantBultVal,
                                cant_valor: cantValorVal,
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

        let child_lists_costs = [];
        let childIdForPadre = null;
        let relationType = null;

        // Buscar si algún artículo tiene como pack_hijo_codigo a este artículo (nosotros somos el Padre/Granel)
        const resHijo = await db.query(
            `SELECT articulo_id, kilos_unidad FROM public.bunker_articulos WHERE pack_hijo_codigo = $1 LIMIT 1`,
            [articulo_id]
        );

        const isHijo = !!articulo.pack_hijo_codigo;
        const isPadre = resHijo.rows.length > 0;

        if (isHijo || isPadre) {
            try {
                const targetRelationId = isHijo ? articulo.pack_hijo_codigo : resHijo.rows[0].articulo_id;
                relationType = isHijo ? 'HIJO_A_PADRE' : 'PADRE_A_HIJO';
                
                // 1. Obtener configuraciones de lista del artículo relacionado
                const queryRelatedLists = `
                    SELECT 
                        lp.id as lista_id,
                        la.costo_base_sobrescrito,
                        COALESCE(la.costo_tiempo, 0) as costo_tiempo,
                        COALESCE(la.iva, 21.00) as iva
                    FROM public.bunker_listas_precios lp
                    LEFT JOIN public.bunker_lista_articulos la ON la.lista_id = lp.id AND la.articulo_numero = $1
                    WHERE lp.activa = true
                    ORDER BY lp.id ASC
                `;
                const resRelatedLists = await db.query(queryRelatedLists, [targetRelationId]);
                
                // 2. Calcular costo de ingrediente en vivo por KILO para el relacionado
                let relatedLiveIngredienteCost = 0;
                
                // Check receta del relacionado
                const queryRelatedReceta = `
                    SELECT id 
                    FROM public.recetas 
                    WHERE articulo_numero = $1 
                    ORDER BY fecha_creacion DESC 
                    LIMIT 1
                `;
                const resRelatedRec = await db.query(queryRelatedReceta, [targetRelationId]);
                
                const relatedKilosUnidad = isHijo ? parent_kilos_unidad : parseFloat(resHijo.rows[0].kilos_unidad || 1);
                
                if (resRelatedRec.rows.length > 0) {
                    const relatedRecetaId = resRelatedRec.rows[0].id;
                    const queryRelatedIngs = `
                        SELECT ri.cantidad, ri.ingrediente_id
                        FROM public.receta_ingredientes ri
                        WHERE ri.receta_id = $1
                    `;
                    const resRelatedIngs = await db.query(queryRelatedIngs, [relatedRecetaId]);
                    let relatedRecipeTotalCost = 0;
                    for (const ing of resRelatedIngs.rows) {
                        const cPatron = await this.resolverCostoIngrediente(db, ing.ingrediente_id);
                        relatedRecipeTotalCost += parseFloat(ing.cantidad) * cPatron;
                    }
                    if (relatedRecipeTotalCost > 0) {
                        relatedLiveIngredienteCost = relatedRecipeTotalCost / (relatedKilosUnidad || 1);
                    }
                }
                
                if (relatedLiveIngredienteCost === 0) {
                    if (isHijo) {
                        if (parent_lote) {
                            relatedLiveIngredienteCost = parseFloat(parent_lote.costo_kilo_al_momento) || 0;
                        } else {
                            relatedLiveIngredienteCost = (parseFloat(parent_costo_base_manual) || 0) / (parent_kilos_unidad || 1);
                        }
                    } else {
                        // Si somos el padre, el relacionado es el hijo
                        const queryLoteHijo = `
                            SELECT d.costo_kilo_al_momento
                            FROM public.bunker_lotes_destinos d
                            JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                            WHERE d.destino_id = $1
                            ORDER BY v.fecha_vinculacion DESC
                            LIMIT 1
                        `;
                        const resLoteHijo = await db.query(queryLoteHijo, [targetRelationId]);
                        if (resLoteHijo.rows.length > 0) {
                            relatedLiveIngredienteCost = parseFloat(resLoteHijo.rows[0].costo_kilo_al_momento) || 0;
                        } else {
                            const resHijoArt = await db.query(`SELECT costo_base FROM public.bunker_articulos WHERE articulo_id = $1`, [targetRelationId]);
                            const hijoCBase = resHijoArt.rows.length > 0 ? parseFloat(resHijoArt.rows[0].costo_base) : 0;
                            relatedLiveIngredienteCost = hijoCBase / (relatedKilosUnidad || 1);
                        }
                    }
                }
                
                // 3. Resolver insumos del relacionado para cada lista y calcular costo total
                for (const row of resRelatedLists.rows) {
                    let relatedInsumosCost = 0;
                    
                    const resRelatedLA = await db.query(
                        `SELECT id FROM public.bunker_lista_articulos WHERE lista_id = $1 AND articulo_numero = $2`,
                        [row.lista_id, targetRelationId]
                    );
                    if (resRelatedLA.rows.length > 0) {
                        const relatedLAId = resRelatedLA.rows[0].id;
                        const resRelatedIns = await db.query(`
                            SELECT li.insumo_articulo_numero, li.cantidad, li.incluido,
                                   COALESCE(ing.costo_patron, ba.costo_base, p.costo, li.costo_unitario_capturado, 0) as costo_unitario_en_vivo
                            FROM public.bunker_lista_insumos li
                            LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                            LEFT JOIN public.precios_articulos p ON p.articulo = li.insumo_articulo_numero
                            WHERE li.lista_articulo_id = $1
                        `, [relatedLAId]);
                        
                        for (const ins of resRelatedIns.rows) {
                            if (ins.incluido === true || ins.incluido === 'true') {
                                const idClean = String(ins.insumo_articulo_numero).trim();
                                let liveCost = 0;
                                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idClean)) {
                                    const sbData = supabaseInsumosMap.get(idClean);
                                    liveCost = sbData ? sbData.costo_unitario_en_vivo : 0;
                                } else {
                                    liveCost = parseFloat(ins.costo_unitario_en_vivo || 0);
                                }
                                relatedInsumosCost += parseFloat(ins.cantidad) * liveCost;
                            }
                        }
                    }
                    
                    const relatedCBase = (row.costo_base_sobrescrito !== null ? parseFloat(row.costo_base_sobrescrito) : relatedLiveIngredienteCost) * relatedKilosUnidad;
                    const relatedTotalCost = relatedCBase + parseFloat(row.costo_tiempo) + relatedInsumosCost;
                    
                    child_lists_costs.push({
                        lista_id: row.lista_id,
                        costo_base: relatedCBase,
                        costo_tiempo: parseFloat(row.costo_tiempo || 0),
                        insumos_costo: relatedInsumosCost,
                        costo_total: relatedTotalCost,
                        iva: parseFloat(row.iva || 21)
                    });
                }
                
                if (isPadre) {
                    childIdForPadre = targetRelationId;
                }
            } catch (childErr) {
                console.error("❌ [BUNKER-HIJO-RELACION] Error al calcular costos relacionados:", childErr);
            }
        }

        // CÁLCULO CORE DE GANANCIA REAL (DRY)
        const factor = parseFloat(articulo.kilos_unidad) > 0 ? parseFloat(articulo.kilos_unidad) : 1;
        let costoKiloIngrediente = 0;
        
        if (receta_ingredientes && receta_ingredientes.length > 0) {
            const costoTotalReceta = receta_ingredientes.reduce((sum, ing) => sum + (parseFloat(ing.cantidad) * parseFloat(ing.costo_patron || 0)), 0);
            costoKiloIngrediente = costoTotalReceta / factor;
        } else if (resLote.rows.length > 0) {
            costoKiloIngrediente = parseFloat(resLote.rows[0].costo_kilo_al_momento) || 0;
        } else {
            costoKiloIngrediente = parseFloat(articulo.costo_base || 0) / factor;
        }

        listasConInsumos.forEach(row => {
            const valSob = row.costo_base_sobrescrito !== null ? parseFloat(row.costo_base_sobrescrito) : null;
            const precioFinal = parseFloat(row.precio_final || 0);
            const ivaRate = parseFloat(row.iva || 21);
            const precioS_iva = precioFinal / (1 + ivaRate / 100);

            let cBultoBase = 0;
            if (valSob !== null && valSob > 0) {
                if (factor > 1 && (valSob * factor) > (precioS_iva * 0.95)) {
                    cBultoBase = valSob;
                } else {
                    cBultoBase = valSob * factor;
                }
            } else {
                cBultoBase = costoKiloIngrediente * factor;
            }

            const costoInsumos = (row.insumos || []).reduce((sum, ins) => {
                if (ins.incluido === true || ins.incluido === 'true') {
                    const priceVal = parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado || 0);
                    return sum + (parseFloat(ins.cantidad) * priceVal);
                }
                return sum;
            }, 0);

            const costoBulto = cBultoBase + costoInsumos;
            const costoOperativo = parseFloat(row.costo_tiempo || 0);
            
            // Fórmula exacta del Gestor de Precios Búnker (listado-bunker.js):
            const iibb = precioFinal * 0.04; // IIBB es el 4% del precio con IVA
            const gananciaNeta = precioS_iva - costoOperativo - costoBulto;
            const gananciaSinIIBB = gananciaNeta - iibb;
            
            const ivaVenta = precioS_iva * (ivaRate / 100);
            const ivaCompra = costoBulto * 0.21; // gp_ivaGlobal por defecto es 21%
            const diferenciaIva = ivaVenta - ivaCompra;
            const diferenciaARendir = Math.max(0, diferenciaIva);
            
            row.costo_operativo = Number((costoOperativo + costoBulto).toFixed(4));
            row.ganancia_real = Number((gananciaSinIIBB - diferenciaARendir).toFixed(4));
        });

        let props = articulo.propiedades_dinamicas || {};
        if (typeof props === 'string') {
            try {
                props = JSON.parse(props);
            } catch (e) {
                props = {};
            }
        }

        // 🌲 Motor de Resolución Jerárquico (Fase 51)
        const jerarquiaRes = await this.resolverCostoJerarquico(db, articulo.articulo_id || articulo_id, new Set(), 0, opciones);
        const costo_por_kilo_normalizado = jerarquiaRes.costo_kilo > 0
            ? jerarquiaRes.costo_kilo
            : (costoKiloIngrediente || (parseFloat(articulo.costo_base || 0) / factor));
        const fuente_costo_aplicada = jerarquiaRes.fuente;

        return {
            articulo_id,
            codigo_barras: articulo.codigo_barras || null,
            pack_hijo_codigo: articulo.pack_hijo_codigo || childIdForPadre || null,
            pack_unidades: articulo.pack_unidades || 0,
            relation_type: relationType,
            costo_base_manual: articulo.costo_base,
            costo_reposicion: parseFloat(articulo.costo_base || costoKiloIngrediente || 0),
            costo_por_kilo_normalizado: Number(costo_por_kilo_normalizado.toFixed(4)),
            fuente_costo_aplicada,
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
            receta_heredada: receta_heredada || false,
            receta_enlazado_externo,
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
            parent_kilos_unidad,
            child_lists_costs,
            propiedades_dinamicas: props
        };
    }

    /**
     * Guardar/Calibrar Estructura Financiera Transaccional (Bajo acoplamiento, alta precisión)
     */
    static async actualizarEstructuraFinancieraTransaccional(db, articulo_id, payload) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const { costo_base, margenes, configs, asistente_colaborador_id, asistente_minutos, rendimiento_colaborador_id, rendimiento_tarifa_id, rendimiento_cantidad, tostadero_simulacion, pack_unidades, kilos_unidad } = payload;

            // Obtener el pack_hijo_codigo y propiedades_dinamicas de este articulo
            const resArtInfo = await client.query(
                `SELECT pack_hijo_codigo, propiedades_dinamicas FROM public.bunker_articulos WHERE articulo_id = $1`,
                [articulo_id]
            );
            const packHijoCodigo = resArtInfo.rows.length > 0 ? resArtInfo.rows[0].pack_hijo_codigo : null;

            // Actualizar propiedades_dinamicas con el asistente, rendimiento y simulación de tostadero si viene
            if (asistente_colaborador_id !== undefined || asistente_minutos !== undefined || rendimiento_colaborador_id !== undefined || rendimiento_tarifa_id !== undefined || rendimiento_cantidad !== undefined || tostadero_simulacion !== undefined) {
                let props = {};
                if (resArtInfo.rows.length > 0 && resArtInfo.rows[0].propiedades_dinamicas) {
                    props = resArtInfo.rows[0].propiedades_dinamicas;
                    if (typeof props === 'string') {
                        try {
                            props = JSON.parse(props);
                        } catch (e) {
                            props = {};
                        }
                    }
                }
                
                if (asistente_colaborador_id !== undefined) {
                    props.asistente_colaborador_id = asistente_colaborador_id;
                }
                if (asistente_minutos !== undefined) {
                    props.asistente_minutos = asistente_minutos;
                }
                if (rendimiento_colaborador_id !== undefined) {
                    props.rendimiento_colaborador_id = rendimiento_colaborador_id;
                }
                if (rendimiento_tarifa_id !== undefined) {
                    props.rendimiento_tarifa_id = rendimiento_tarifa_id;
                }
                if (rendimiento_cantidad !== undefined) {
                    props.rendimiento_cantidad = rendimiento_cantidad;
                }
                if (tostadero_simulacion !== undefined) {
                    props.tostadero_simulacion = tostadero_simulacion;
                }
                
                await client.query(
                    `UPDATE public.bunker_articulos SET propiedades_dinamicas = $2 WHERE articulo_id = $1`,
                    [articulo_id, JSON.stringify(props)]
                );
            }

            // 0. Actualizar pack_unidades y kilos_unidad si vienen
            if (pack_unidades !== undefined && pack_unidades !== null) {
                await client.query(
                    `UPDATE public.bunker_articulos SET pack_unidades = $2 WHERE articulo_id = $1`,
                    [articulo_id, pack_unidades]
                );
            }
            if (kilos_unidad !== undefined && kilos_unidad !== null) {
                await client.query(
                    `UPDATE public.bunker_articulos SET kilos_unidad = $2 WHERE articulo_id = $1`,
                    [articulo_id, kilos_unidad]
                );
            }

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
                        fuente_costo_default,
                        exencion_operativa,
                        rendimiento_activo,
                        mano_obra_activa
                    } = conf;

                    const exencionOperativa = exencion_operativa === true || exencion_operativa === 'true';

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
                            costo_tiempo, iva, precio_final, modo_calculo, modo_iva, es_patron, fuente_costo_default, disponible, exencion_operativa, rendimiento_activo, mano_obra_activa, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, true), $13, $14, $15, CURRENT_TIMESTAMP
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
                            disponible = COALESCE(EXCLUDED.disponible, bunker_lista_articulos.disponible),
                            exencion_operativa = EXCLUDED.exencion_operativa,
                            rendimiento_activo = EXCLUDED.rendimiento_activo,
                            mano_obra_activa = EXCLUDED.mano_obra_activa,
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
                        fuente_costo_default || null,
                        conf.disponible !== undefined ? (conf.disponible === true || conf.disponible === 'true') : null,
                        exencionOperativa,
                        rendimiento_activo !== undefined ? (rendimiento_activo === true || rendimiento_activo === 'true') : false,
                        mano_obra_activa !== undefined ? (mano_obra_activa === true || mano_obra_activa === 'true') : false
                    ]);

                    const listaArticuloId = resLA.rows[0].id;

                    // Purgar insumos anteriores
                    await client.query(`DELETE FROM public.bunker_lista_insumos WHERE lista_articulo_id = $1`, [listaArticuloId]);

                    // Insertar insumos nuevos
                    if (insumos && Array.isArray(insumos)) {
                        for (const ins of insumos) {
                            const queryIns = `
                                INSERT INTO public.bunker_lista_insumos (
                                    lista_articulo_id, insumo_articulo_numero, cantidad, costo_unitario_capturado, incluido
                                ) VALUES ($1, $2, $3, $4, $5)
                            `;
                            await client.query(queryIns, [
                                listaArticuloId,
                                ins.insumo_articulo_numero,
                                ins.cantidad || 1.0000,
                                ins.costo_unitario_capturado || 0,
                                ins.incluido === true || ins.incluido === 'true'
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

    /**
     * Obtener costos operativos universales de un artículo (mano de obra e insumos de la primera lista no exenta)
     */
    static async obtenerCostosUniversalesDeArticulo(db, articuloId) {
        const query = `
            SELECT id, costo_tiempo 
            FROM public.bunker_lista_articulos 
            WHERE articulo_numero = $1 AND COALESCE(exencion_operativa, false) = false
            ORDER BY lista_id ASC
            LIMIT 1
        `;
        const res = await db.query(query, [articuloId]);
        if (res.rows.length > 0) {
            const row = res.rows[0];
            const resIns = await db.query(
                `SELECT insumo_articulo_numero, cantidad, costo_unitario_capturado, incluido 
                 FROM public.bunker_lista_insumos 
                 WHERE lista_articulo_id = $1`,
                [row.id]
            );
            return {
                costo_tiempo: parseFloat(row.costo_tiempo) || 0,
                insumos: resIns.rows
            };
        }
        return null;
    }

    /**
     * Actualiza la disponibilidad de un artículo para una lista de precios específica
     */
    static async actualizarDisponibilidadArticulo(db, articuloId, listaId, disponible) {
        // Verificar si ya existe la configuración
        const resExist = await db.query(
            `SELECT id FROM public.bunker_lista_articulos WHERE lista_id = $1 AND articulo_numero = $2`,
            [listaId, articuloId]
        );

        if (resExist.rows.length === 0) {
            // No existe, buscar costos universales no exentos
            const universalCostObj = await this.obtenerCostosUniversalesDeArticulo(db, articuloId);
            const cTiempo = universalCostObj ? universalCostObj.costo_tiempo : 0.00;
            
            const queryInsert = `
                INSERT INTO public.bunker_lista_articulos (
                    lista_id, 
                    articulo_numero, 
                    disponible,
                    costo_tiempo,
                    updated_at
                ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                RETURNING *
            `;
            const result = await db.query(queryInsert, [listaId, articuloId, disponible, cTiempo]);
            const newLA = result.rows[0];

            // Insertar insumos heredados
            if (universalCostObj && universalCostObj.insumos && universalCostObj.insumos.length > 0) {
                for (const ins of universalCostObj.insumos) {
                    await db.query(
                        `INSERT INTO public.bunker_lista_insumos (
                            lista_articulo_id, insumo_articulo_numero, cantidad, costo_unitario_capturado, incluido
                         ) VALUES ($1, $2, $3, $4, $5)`,
                        [
                            newLA.id,
                            ins.insumo_articulo_numero,
                            ins.cantidad || 1.0000,
                            ins.costo_unitario_capturado || 0,
                            ins.incluido === true || ins.incluido === 'true'
                        ]
                    );
                }
            }
            return newLA;
        } else {
            // Ya existe, solo actualizar disponible
            const queryUpdate = `
                UPDATE public.bunker_lista_articulos 
                SET disponible = $3, updated_at = CURRENT_TIMESTAMP 
                WHERE lista_id = $1 AND articulo_numero = $2
                RETURNING *
            `;
            const result = await db.query(queryUpdate, [listaId, articuloId, disponible]);
            return result.rows[0];
        }
    }

    /**
     * Actualiza en masa el margen de ganancia para un conjunto de artículos en una lista de precios específica,
     * recalculando de manera exacta los precios correspondientes y conservando las configuraciones preexistentes.
     * Soporta opcionalmente la actualización en masa del tratamiento de IVA (nuevoModoIva).
     */
    static async actualizarMargenesEnMasa(db, listaId, articuloIds, nuevoMargen, nuevoModoIva = null) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // 1. Obtener contexto de costos en vivo
            const context = await this.resolverCostosEnVivo(client);

            // 2. Iterar sobre cada artículo y recalcular el precio final
            for (const articuloId of articuloIds) {
                // Obtener datos estructurales del artículo
                const resArt = await client.query(
                    `SELECT articulo_id, costo_base, porcentaje_iva, kilos_unidad, pack_hijo_codigo 
                     FROM public.bunker_articulos 
                     WHERE articulo_id = $1`,
                    [articuloId]
                );

                if (resArt.rows.length === 0) {
                    continue;
                }

                const art = resArt.rows[0];
                const factor = parseFloat(art.kilos_unidad) > 0 ? parseFloat(art.kilos_unidad) : 1;

                // Obtener la configuración actual para esta lista (si existe)
                const resLA = await client.query(
                    `SELECT id, costo_base_sobrescrito, costo_tiempo, iva, modo_iva, modo_calculo, es_patron, fuente_costo_default, disponible 
                     FROM public.bunker_lista_articulos 
                     WHERE lista_id = $1 AND articulo_numero = $2`,
                    [listaId, articuloId]
                );

                let la = resLA.rows[0] || {};
                
                // Resolver el costo base
                const liveIngredienteCost = this.calcularCostoIngredienteEnVivo(
                    art.articulo_id, 
                    art.pack_hijo_codigo, 
                    art.costo_base, 
                    context, 
                    factor
                );

                const cBase = la.costo_base_sobrescrito !== null && la.costo_base_sobrescrito !== undefined
                    ? parseFloat(la.costo_base_sobrescrito)
                    : liveIngredienteCost;

                // Resolver costo de insumos secundarios
                let cInsumos = 0;
                let cTiempo = 0;
                let universalCostObj = null;

                if (la.id) {
                    const resIns = await client.query(
                        `SELECT insumo_articulo_numero, cantidad, incluido 
                         FROM public.bunker_lista_insumos 
                         WHERE lista_articulo_id = $1`,
                        [la.id]
                    );
                    cInsumos = this.calcularCostoInsumosEnVivo(resIns.rows, context);
                    cTiempo = la.costo_tiempo !== undefined && la.costo_tiempo !== null ? parseFloat(la.costo_tiempo) : 0;
                } else {
                    // Si no existe, heredar costos universales
                    universalCostObj = await this.obtenerCostosUniversalesDeArticulo(client, articuloId);
                    if (universalCostObj) {
                        cTiempo = universalCostObj.costo_tiempo;
                        cInsumos = this.calcularCostoInsumosEnVivo(universalCostObj.insumos, context);
                    }
                }

                const ivaValDefault = art.porcentaje_iva || 21.00;
                
                // Asignar modo_iva: si viene un valor nuevo y no es MANTENER, lo aplicamos; de lo contrario mantenemos el actual
                const modoIva = (nuevoModoIva && nuevoModoIva !== 'MANTENER') ? nuevoModoIva : (la.modo_iva || 'COMPLETO');

                // Costo Total del Bulto Integrado (Costo Kilo * Factor + Insumos Secundarios)
                const cBulto = (cBase * factor) + cInsumos;

                // Calcular IVA real aplicado a partir de la alícuota nativa del artículo
                let ivaAplicado;
                if (nuevoModoIva === 'MANTENER') {
                    ivaAplicado = la.iva !== undefined && la.iva !== null ? parseFloat(la.iva) : ivaValDefault;
                } else {
                    if (modoIva === 'MEDIO') {
                        ivaAplicado = ivaValDefault / 2;
                    } else if (modoIva === 'SIN') {
                        ivaAplicado = 0;
                    } else {
                        ivaAplicado = ivaValDefault;
                    }
                }
                const ivaCoeff = 1 + (ivaAplicado / 100);

                // Calcular precio final
                // Precio Final del Bulto = [ Costo Total Bulto * (1 + Margen/100) + Costo Tiempo ] * (1 + IVA)
                const precioS_ivaBase = cBulto * (1 + (nuevoMargen / 100)) + cTiempo;
                const precioFinal = precioS_ivaBase * ivaCoeff;

                // Upsert
                const queryUpsert = `
                    INSERT INTO public.bunker_lista_articulos (
                        lista_id, 
                        articulo_numero, 
                        margen_ganancia, 
                        costo_base_sobrescrito, 
                        costo_tiempo, 
                        iva, 
                        precio_final, 
                        modo_calculo, 
                        modo_iva, 
                        es_patron, 
                        fuente_costo_default, 
                        disponible, 
                        updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP
                    ) ON CONFLICT (lista_id, articulo_numero) DO UPDATE SET
                        margen_ganancia = EXCLUDED.margen_ganancia,
                        iva = EXCLUDED.iva,
                        precio_final = EXCLUDED.precio_final,
                        modo_iva = EXCLUDED.modo_iva,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id
                `;

                const resUpsert = await client.query(queryUpsert, [
                    listaId,
                    articuloId,
                    nuevoMargen,
                    la.costo_base_sobrescrito !== undefined && la.costo_base_sobrescrito !== null ? la.costo_base_sobrescrito : null,
                    cTiempo,
                    ivaAplicado,
                    precioFinal,
                    la.modo_calculo || 'AUTOMATIC',
                    modoIva,
                    la.es_patron || false,
                    la.fuente_costo_default || null,
                    la.disponible !== undefined ? la.disponible : true
                ]);

                const targetId = resUpsert.rows[0].id;

                // Si se creó un nuevo registro, heredar también las asociaciones de insumos
                if (resLA.rows.length === 0 && universalCostObj && universalCostObj.insumos && universalCostObj.insumos.length > 0) {
                    for (const ins of universalCostObj.insumos) {
                        await client.query(
                            `INSERT INTO public.bunker_lista_insumos (
                                lista_articulo_id, insumo_articulo_numero, cantidad, costo_unitario_capturado, incluido
                             ) VALUES ($1, $2, $3, $4, $5)`,
                            [
                                targetId,
                                ins.insumo_articulo_numero,
                                ins.cantidad || 1.0000,
                                ins.costo_unitario_capturado || 0,
                                ins.incluido === true || ins.incluido === 'true'
                            ]
                        );
                    }
                }

                // For legacy compatibility
                const queryLegacy = `
                    INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (articulo_id, lista_id) 
                    DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje
                `;
                await client.query(queryLegacy, [articuloId, listaId, nuevoMargen]);
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

    static async actualizarHabilitacionEnMasa(db, listaId, articuloIds, disponible) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const query = `
                INSERT INTO public.bunker_lista_articulos (
                    lista_id, articulo_numero, disponible, margen_ganancia, costo_tiempo, iva, precio_final, modo_calculo, modo_iva, updated_at
                ) 
                SELECT 
                    $1, ba.articulo_id, $2, 0.00, 0.00, COALESCE(ba.porcentaje_iva, 21.00), 0.00, 'AUTOMATIC', 'COMPLETO', CURRENT_TIMESTAMP
                FROM public.bunker_articulos ba
                WHERE ba.articulo_id = ANY($3)
                ON CONFLICT (lista_id, articulo_numero) 
                DO UPDATE SET 
                    disponible = EXCLUDED.disponible,
                    updated_at = CURRENT_TIMESTAMP
            `;
            await client.query(query, [listaId, disponible, articuloIds]);

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
