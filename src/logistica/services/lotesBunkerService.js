class LotesBunkerService {
    /**
     * Busca artículos en el Búnker y también Ingredientes para ofrecer como destinos al vincular un lote.
     * Retorna un listado unificado.
     */
    static async buscarDestinos(db, query) {
        const sqlBunker = `
            SELECT 
                b.articulo_id as id, 
                b.descripcion, 
                b.descripcion_generada,
                'ARTICULO_BUNKER' as tipo_destino,
                COALESCE((
                    SELECT SUM(d.kilos_asignados) 
                    FROM public.bunker_lotes_destinos d 
                    WHERE d.destino_id = b.articulo_id AND d.tipo_destino = 'ARTICULO_BUNKER'
                ), 0) as stock_actual,
                COALESCE((
                    SELECT SUM(d.cantidad_asignada) 
                    FROM public.bunker_lotes_destinos d 
                    WHERE d.destino_id = b.articulo_id AND d.tipo_destino = 'ARTICULO_BUNKER'
                ), 0) as stock_bultos
            FROM public.bunker_articulos b
        `;
        
        const sqlIngredientes = `
            SELECT 
                id::text as id, 
                nombre as descripcion, 
                codigo::text as descripcion_generada,
                'INGREDIENTE_PRODUCCION' as tipo_destino,
                COALESCE(stock_actual, 0) as stock_actual,
                COALESCE(stock_bultos, 0) as stock_bultos
            FROM public.ingredientes
        `;

        const [resBunker, resIngredientes] = await Promise.all([
            db.query(sqlBunker),
            db.query(sqlIngredientes)
        ]);

        const allDestinos = [...resBunker.rows, ...resIngredientes.rows];

        // Función auxiliar para normalizar y quitar acentos/diacríticos de forma limpia
        const removeAccents = (str) => {
            if (!str) return '';
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        };

        if (!query || query.trim() === '') {
            return allDestinos;
        }

        const cleanQuery = removeAccents(query.trim().toLowerCase());
        const tokens = cleanQuery.split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
            return allDestinos;
        }

        // Filtro acumulativo multiparámetro por tokens (Lógica LAMDA)
        const filtered = allDestinos.filter(row => {
            const idText = String(row.id || '').toLowerCase();
            const descText = removeAccents(String(row.descripcion || '').toLowerCase());
            const descGenText = removeAccents(String(row.descripcion_generada || '').toLowerCase());
            
            // Cada token ingresado debe estar presente en al menos uno de los atributos del registro
            return tokens.every(token => {
                return idText.includes(token) || descText.includes(token) || descGenText.includes(token);
            });
        });

        return filtered;
    }

    /**
     * Guarda la vinculación transaccional entre un Lote de Supabase y sus destinos.
     */
    static async vincularLote(db, data) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // Generar alias corto de lote único
            const loteCodigoCorto = await this.generarAliasLoteCortoUnico(client);

            // 1. Insertar Cabecera (El vínculo matemático)
            const sqlVinculo = `
                INSERT INTO public.bunker_lotes_vinculos (
                    lote_id_supabase, costo_bruto_ingresado, costo_kilo_calculado, 
                    cantidad_total_lote, impuesto_iva, impuesto_iibb, usuario_vinculador,
                    lote_codigo_corto
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `;
            const valuesVinculo = [
                data.lote_id_supabase,
                data.costo_bruto_ingresado,
                data.costo_kilo_calculado,
                data.cantidad_total_lote,
                data.iva !== undefined ? data.iva : 0,
                data.iibb !== undefined ? data.iibb : 0,
                data.usuario || 'SISTEMA',
                loteCodigoCorto
            ];
            const resVinculo = await client.query(sqlVinculo, valuesVinculo);
            const vinculoId = resVinculo.rows[0].id;

            // 2. Insertar Destinos (Split)
            if (data.destinos && Array.isArray(data.destinos)) {
                for (const destino of data.destinos) {
                    const sqlDestino = `
                        INSERT INTO public.bunker_lotes_destinos (
                            vinculo_id, tipo_destino, destino_id, cantidad_asignada, kilos_asignados, costo_kilo_al_momento
                        ) VALUES ($1, $2, $3, $4, $5, $6)
                    `;
                    await client.query(sqlDestino, [
                        vinculoId,
                        destino.tipo_destino,
                        destino.id,
                        destino.cantidad_asignada,
                        destino.kilos_asignados,
                        data.costo_kilo_calculado // Costo congelado al momento del vínculo para el motor de alertas
                    ]);

                    // Si deriva al almacén de ingredientes, inyectamos el movimiento de CAJAS CERRADAS en fábrica (kilos = 0)
                    if (destino.tipo_destino === 'INGREDIENTE_PRODUCCION') {
                        const sqlMov = `
                            INSERT INTO public.ingredientes_movimientos (
                                ingrediente_id, kilos, bultos, tipo, observaciones, fecha, stock_anterior
                            ) VALUES ($1, $2, $3, $4, $5, NOW(), COALESCE((SELECT stock_actual FROM public.ingredientes WHERE id = $1), 0))
                        `;
                        await client.query(sqlMov, [
                            parseInt(destino.id),
                            0, // Kilos sueltos iniciales = 0 (permanece en cajas cerradas)
                            destino.cantidad_asignada, // Cajas cerradas ingresadas
                            'ingreso',
                            'Ingreso por vinculación de lote: ' + data.lote_id_supabase
                        ]);
                    }

                    // Si deriva a artículos búnker, inyectamos la cascada hacia el stock legacy de Lomas Soft
                    if (destino.tipo_destino === 'ARTICULO_BUNKER') {
                        // A. Recuperar mapeo desde bunker_articulos
                        const artRes = await client.query(
                            'SELECT articulo_id, kilos_unidad FROM public.bunker_articulos WHERE articulo_id = $1',
                            [destino.id]
                        );
                        if (artRes.rows.length > 0) {
                            const legacyCode = artRes.rows[0].articulo_id;

                            // B. Obtener detalles de articulos
                            const legacyArtRes = await client.query(
                                'SELECT nombre, codigo_barras FROM public.articulos WHERE numero = $1',
                                [legacyCode]
                            );
                            const nombreLegacy = legacyArtRes.rows.length > 0 ? legacyArtRes.rows[0].nombre : null;
                            const barcodeLegacy = legacyArtRes.rows.length > 0 ? legacyArtRes.rows[0].codigo_barras : null;

                            // C. Resolver usuario_id
                            let usuarioId = null;
                            if (data.usuario) {
                                const userRes = await client.query(
                                    'SELECT id FROM public.usuarios WHERE usuario = $1 OR nombre_completo = $1 LIMIT 1',
                                    [data.usuario]
                                );
                                if (userRes.rows.length > 0) {
                                    usuarioId = userRes.rows[0].id;
                                }
                            }

                            // D. Inyectar en stock_ventas_movimientos
                            const sqlMov = `
                                INSERT INTO public.stock_ventas_movimientos (
                                    articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha, cantidad, tipo, origen_ingreso, observaciones
                                ) VALUES ($1, $2, $3, NULL, $4, NOW(), $5, 'ingreso_lote', $6, $7)
                            `;
                            await client.query(sqlMov, [
                                legacyCode,
                                barcodeLegacy,
                                destino.kilos_asignados,
                                usuarioId,
                                destino.cantidad_asignada,
                                data.lote_id_supabase,
                                `Ingreso de lote por vinculación manual: ${data.lote_id_supabase}`
                            ]);

                            // E. Upsert en stock_real_consolidado
                            const sqlUpsertStock = `
                                INSERT INTO public.stock_real_consolidado (
                                    articulo_numero, descripcion, codigo_barras, stock_movimientos, stock_ajustes, stock_consolidado, no_producido_por_lambda, solo_produccion_externa, ultima_actualizacion
                                ) VALUES ($1, $2, $3, $4, 0, $4, false, false, NOW())
                                ON CONFLICT (articulo_numero)
                                DO UPDATE SET 
                                    stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $4,
                                    ultima_actualizacion = NOW()
                            `;
                            await client.query(sqlUpsertStock, [
                                legacyCode,
                                nombreLegacy,
                                barcodeLegacy,
                                destino.cantidad_asignada
                            ]);

                            // F. Recalcular stock_consolidado
                            const sqlRecalculo = `
                                UPDATE public.stock_real_consolidado
                                SET stock_consolidado = COALESCE(stock_lomasoft, 0) + 
                                                        COALESCE(stock_movimientos, 0) + 
                                                        COALESCE(stock_ajustes, 0),
                                    ultima_actualizacion = NOW()
                                WHERE articulo_numero = $1
                            `;
                            await client.query(sqlRecalculo, [legacyCode]);
                        }
                    }
                }
            }

            await client.query('COMMIT');
            return { success: true, vinculo_id: vinculoId };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error en vincularLote transaccional:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Guarda de forma atómica (en una única transacción) la vinculación de múltiples lotes.
     */
    static async vincularLotesBatch(db, data) {
        if (!data || !data.lotes || !Array.isArray(data.lotes)) {
            throw new Error("Datos de vinculación por bloques inválidos.");
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const vinculosCreados = [];

            for (const loteData of data.lotes) {
                // Generar alias corto de lote único
                const loteCodigoCorto = await this.generarAliasLoteCortoUnico(client);

                // 1. Insertar Cabecera
                const sqlVinculo = `
                    INSERT INTO public.bunker_lotes_vinculos (
                        lote_id_supabase, costo_bruto_ingresado, costo_kilo_calculado, 
                        cantidad_total_lote, impuesto_iva, impuesto_iibb, usuario_vinculador,
                        lote_codigo_corto
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `;
                const valuesVinculo = [
                    loteData.lote_id_supabase,
                    loteData.costo_bruto_ingresado,
                    loteData.costo_kilo_calculado,
                    loteData.cantidad_total_lote,
                    loteData.iva !== undefined ? loteData.iva : 0,
                    loteData.iibb !== undefined ? loteData.iibb : 0,
                    loteData.usuario || 'SISTEMA',
                    loteCodigoCorto
                ];
                const resVinculo = await client.query(sqlVinculo, valuesVinculo);
                const vinculoId = resVinculo.rows[0].id;
                vinculosCreados.push(vinculoId);

                // 2. Insertar Destinos (Split)
                if (loteData.destinos && Array.isArray(loteData.destinos)) {
                    for (const destino of loteData.destinos) {
                        const sqlDestino = `
                            INSERT INTO public.bunker_lotes_destinos (
                                vinculo_id, tipo_destino, destino_id, cantidad_asignada, kilos_asignados, costo_kilo_al_momento
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(sqlDestino, [
                            vinculoId,
                            destino.tipo_destino,
                            destino.id,
                            destino.cantidad_asignada,
                            destino.kilos_asignados,
                            loteData.costo_kilo_calculado
                        ]);

                        // Si deriva al almacén de ingredientes, inyectamos el movimiento de CAJAS CERRADAS
                        if (destino.tipo_destino === 'INGREDIENTE_PRODUCCION') {
                            const sqlMov = `
                                INSERT INTO public.ingredientes_movimientos (
                                    ingrediente_id, kilos, bultos, tipo, observaciones, fecha, stock_anterior
                                ) VALUES ($1, $2, $3, $4, $5, NOW(), COALESCE((SELECT stock_actual FROM public.ingredientes WHERE id = $1), 0))
                            `;
                            await client.query(sqlMov, [
                                parseInt(destino.id),
                                0, // Kilos sueltos iniciales = 0
                                destino.cantidad_asignada, // Cajas cerradas ingresadas
                                'ingreso',
                                'Ingreso por vinculación batch de lote: ' + loteData.lote_id_supabase
                            ]);
                        }

                        // Si deriva a artículos búnker, inyectamos la cascada hacia el stock legacy de Lomas Soft (Batch)
                        if (destino.tipo_destino === 'ARTICULO_BUNKER') {
                            // A. Recuperar mapeo desde bunker_articulos
                            const artRes = await client.query(
                                'SELECT articulo_id, kilos_unidad FROM public.bunker_articulos WHERE articulo_id = $1',
                                [destino.id]
                            );
                            if (artRes.rows.length > 0) {
                                const legacyCode = artRes.rows[0].articulo_id;

                                // B. Obtener detalles de articulos
                                const legacyArtRes = await client.query(
                                    'SELECT nombre, codigo_barras FROM public.articulos WHERE numero = $1',
                                    [legacyCode]
                                );
                                const nombreLegacy = legacyArtRes.rows.length > 0 ? legacyArtRes.rows[0].nombre : null;
                                const barcodeLegacy = legacyArtRes.rows.length > 0 ? legacyArtRes.rows[0].codigo_barras : null;

                                // C. Resolver usuario_id
                                let usuarioId = null;
                                const currentUsuario = loteData.usuario || data.usuario;
                                if (currentUsuario) {
                                    const userRes = await client.query(
                                        'SELECT id FROM public.usuarios WHERE usuario = $1 OR nombre_completo = $1 LIMIT 1',
                                        [currentUsuario]
                                    );
                                    if (userRes.rows.length > 0) {
                                        usuarioId = userRes.rows[0].id;
                                    }
                                }

                                // D. Inyectar en stock_ventas_movimientos
                                const sqlMov = `
                                    INSERT INTO public.stock_ventas_movimientos (
                                        articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha, cantidad, tipo, origen_ingreso, observaciones
                                    ) VALUES ($1, $2, $3, NULL, $4, NOW(), $5, 'ingreso_lote', $6, $7)
                                `;
                                await client.query(sqlMov, [
                                    legacyCode,
                                    barcodeLegacy,
                                    destino.kilos_asignados,
                                    usuarioId,
                                    destino.cantidad_asignada,
                                    loteData.lote_id_supabase,
                                    `Ingreso de lote por vinculación batch: ${loteData.lote_id_supabase}`
                                ]);

                                // E. Upsert en stock_real_consolidado
                                const sqlUpsertStock = `
                                    INSERT INTO public.stock_real_consolidado (
                                        articulo_numero, descripcion, codigo_barras, stock_movimientos, stock_ajustes, stock_consolidado, no_producido_por_lambda, solo_produccion_externa, ultima_actualizacion
                                    ) VALUES ($1, $2, $3, $4, 0, $4, false, false, NOW())
                                    ON CONFLICT (articulo_numero)
                                    DO UPDATE SET 
                                        stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $4,
                                        ultima_actualizacion = NOW()
                                `;
                                await client.query(sqlUpsertStock, [
                                    legacyCode,
                                    nombreLegacy,
                                    barcodeLegacy,
                                    destino.cantidad_asignada
                                ]);

                                // F. Recalcular stock_consolidado
                                const sqlRecalculo = `
                                    UPDATE public.stock_real_consolidado
                                    SET stock_consolidado = COALESCE(stock_lomasoft, 0) + 
                                                            COALESCE(stock_movimientos, 0) + 
                                                            COALESCE(stock_ajustes, 0),
                                        ultima_actualizacion = NOW()
                                    WHERE articulo_numero = $1
                                `;
                                await client.query(sqlRecalculo, [legacyCode]);
                            }
                        }
                    }
                }
            }

            await client.query('COMMIT');
            return { success: true, vinculo_ids: vinculosCreados };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error en vincularLotesBatch transaccional:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Abre una caja cerrada de un lote asignado a Ingredientes, transfiriendo su peso al stock de kilos libres.
     */
    static async abrirCajaDestino(db, vinculoId, destinoId, cantidad = 1) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // 1. Obtener la fila de asignación de destino con bloqueo FOR UPDATE
            const sqlDest = `
                SELECT d.*, v.lote_id_supabase 
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE d.vinculo_id = $1 AND d.destino_id = $2 AND d.tipo_destino = 'INGREDIENTE_PRODUCCION'
                FOR UPDATE
            `;
            const resDest = await client.query(sqlDest, [vinculoId, destinoId]);
            if (resDest.rows.length === 0) {
                throw new Error('No se encontró la asignación de lote correspondiente en Ingredientes.');
            }

            const destRow = resDest.rows[0];
            const asignadas = parseFloat(destRow.cantidad_asignada || 0);
            const abiertas = parseFloat(destRow.cantidad_abierta || 0);
            const cerradas = asignadas - abiertas;

            // 2. Validar que existan suficientes cajas cerradas
            if (cerradas <= 0) {
                throw new Error('Todas las cajas de este lote en este almacén ya han sido abiertas.');
            }
            if (cantidad > cerradas) {
                throw new Error(`Solo hay ${cerradas} caja(s) cerrada(s) disponible(s) para abrir en este lote.`);
            }

            // 3. Incrementar el contador de cajas abiertas
            const sqlUpdateDest = `
                UPDATE public.bunker_lotes_destinos 
                SET cantidad_abierta = COALESCE(cantidad_abierta, 0) + $3
                WHERE vinculo_id = $1 AND destino_id = $2 AND tipo_destino = 'INGREDIENTE_PRODUCCION'
            `;
            await client.query(sqlUpdateDest, [vinculoId, destinoId, cantidad]);

            // 4. Calcular el peso por bulto/caja para la conversión
            const kilosPorBulto = parseFloat(destRow.kilos_asignados || 0) / asignadas;

            // 5. Registrar el movimiento de conversión (restar N cajas, sumar peso equivalente en kilos)
            const sqlMov = `
                INSERT INTO public.ingredientes_movimientos (
                    ingrediente_id, kilos, bultos, tipo, observaciones, fecha, stock_anterior
                ) VALUES ($1, $2, $3, $4, $5, NOW(), COALESCE((SELECT stock_actual FROM public.ingredientes WHERE id = $1), 0))
            `;
            await client.query(sqlMov, [
                parseInt(destinoId),
                kilosPorBulto * cantidad, // Sumar kilos al stock_actual
                -cantidad, // Restar N bultos de stock_bultos
                'ingreso', // tipo permitido por check constraint
                `Apertura de ${cantidad} caja(s) - Lote: ` + destRow.lote_id_supabase
            ]);

            await client.query('COMMIT');
            return { success: true, nuevas_abiertas: abiertas + cantidad };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Obtiene el estado y trazabilidad inversa (Auditoría de Destinos) para múltiples lotes.
     */
    static async obtenerEstadosLotes(db, lotesIds) {
        if (!lotesIds || lotesIds.length === 0) return {};
        
        // 1. Obtener la cabecera (Vinculos) para saber el total
        const sqlVinculos = `
            SELECT id, lote_id_supabase, cantidad_total_lote, costo_bruto_ingresado, costo_kilo_calculado 
            FROM public.bunker_lotes_vinculos 
            WHERE lote_id_supabase = ANY($1)
        `;
        const resVinculos = await db.query(sqlVinculos, [lotesIds]);
        
        if (resVinculos.rows.length === 0) return {};

        const vinculos = resVinculos.rows;
        const vinculosIds = vinculos.map(v => v.id);

        // 2. Obtener todos los destinos asociados a estos vínculos
        const sqlDestinos = `
            SELECT 
                d.vinculo_id, 
                d.tipo_destino, 
                d.destino_id, 
                d.cantidad_asignada,
                d.kilos_asignados,
                COALESCE(d.cantidad_abierta, 0) as cantidad_abierta,
                CASE 
                    WHEN d.tipo_destino = 'ARTICULO_BUNKER' THEN b.descripcion_generada
                    WHEN d.tipo_destino = 'INGREDIENTE_PRODUCCION' THEN i.nombre
                    ELSE d.destino_id
                END as descripcion_destino,
                i.codigo as ingrediente_codigo,
                s.nombre as sector_nombre,
                s.descripcion as sector_descripcion
            FROM public.bunker_lotes_destinos d
            LEFT JOIN public.bunker_articulos b ON d.tipo_destino = 'ARTICULO_BUNKER' AND d.destino_id = b.articulo_id
            LEFT JOIN public.ingredientes i ON d.tipo_destino = 'INGREDIENTE_PRODUCCION' AND d.destino_id = i.id::text
            LEFT JOIN public.sectores_ingredientes s ON i.sector_id = s.id
            WHERE d.vinculo_id = ANY($1)
        `;
        const resDestinos = await db.query(sqlDestinos, [vinculosIds]);
        
        // Agrupar
        const resultado = {};
        
        vinculos.forEach(v => {
            const destinosLote = resDestinos.rows.filter(d => d.vinculo_id === v.id);
            const sumaAsignada = destinosLote.reduce((acc, curr) => acc + parseFloat(curr.kilos_asignados || curr.cantidad_asignada || 0), 0);
            const totalLote = parseFloat(v.cantidad_total_lote || 0);
            
            let estado = 'PENDIENTE';
            if (destinosLote.length > 0) {
                // Consideramos una pequeña tolerancia por problemas de punto flotante
                if (sumaAsignada >= (totalLote - 0.001)) {
                    estado = 'ASIGNADO_TOTAL';
                } else if (sumaAsignada > 0) {
                    estado = 'ASIGNADO_PARCIAL';
                }
            }
            
            resultado[v.lote_id_supabase] = {
                estado: estado,
                total_lote: totalLote, // En general son Kilos
                costo_bruto: parseFloat(v.costo_bruto_ingresado || 0),
                costo_kilo: parseFloat(v.costo_kilo_calculado || 0),
                suma_asignada: sumaAsignada,
                destinos: destinosLote.map(d => ({
                    tipo: d.tipo_destino,
                    id: d.destino_id,
                    descripcion: d.descripcion_destino || d.destino_id,
                    cantidad_bultos: parseFloat(d.cantidad_asignada || 0),
                    cantidad_kilos: parseFloat(d.kilos_asignados || 0),
                    cantidad_abierta: parseFloat(d.cantidad_abierta || 0),
                    codigo: d.ingrediente_codigo || '',
                    sector_nombre: d.sector_nombre || '',
                    sector_descripcion: d.sector_descripcion || ''
                }))
            };
        });
        
        return resultado;
    }

    static async generarAliasLoteCortoUnico(client) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let alias = '';
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 100) {
            alias = 'L';
            for (let i = 0; i < 7; i++) {
                alias += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const check = await client.query(
                'SELECT 1 FROM public.bunker_lotes_vinculos WHERE lote_codigo_corto = $1 LIMIT 1',
                [alias]
            );
            exists = check.rows.length > 0;
            attempts++;
        }
        if (exists) {
            throw new Error('No se pudo generar un alias de lote único después de 100 intentos.');
        }
        return alias;
    }

    /**
     * Retrotrae/desvincula un lote registrado, con la opción de revertir el stock afectado.
     */
    static async desvincularLote(db, lote_id_supabase, revertir_stock) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // 1. Obtener la cabecera del vínculo para verificar si existe
            const resVinculo = await client.query(
                'SELECT id FROM public.bunker_lotes_vinculos WHERE lote_id_supabase = $1',
                [lote_id_supabase]
            );
            if (resVinculo.rows.length === 0) {
                throw new Error('No se encontró ningún vínculo registrado para este lote.');
            }
            const vinculoId = resVinculo.rows[0].id;

            // 2. Obtener todos los destinos asociados a este vínculo
            const resDestinos = await client.query(
                'SELECT id, tipo_destino, destino_id, cantidad_asignada, kilos_asignados FROM public.bunker_lotes_destinos WHERE vinculo_id = $1',
                [vinculoId]
            );

            // 3. Revertir el stock para cada destino si está habilitada la bandera
            if (revertir_stock) {
                console.log(` Revertiendo stock de los destinos del vínculo ${vinculoId}...`);
                for (const dest of resDestinos.rows) {
                    if (dest.tipo_destino === 'ARTICULO_BUNKER') {
                        const legacyCode = dest.destino_id;

                        // A. Eliminar el movimiento de stock_ventas_movimientos
                        await client.query(
                            `DELETE FROM public.stock_ventas_movimientos 
                             WHERE articulo_numero = $1 AND tipo = 'ingreso_lote' AND origen_ingreso = $2`,
                            [legacyCode, lote_id_supabase]
                        );

                        // B. Restar de stock_real_consolidado.stock_movimientos
                        await client.query(
                            `UPDATE public.stock_real_consolidado 
                             SET stock_movimientos = COALESCE(stock_movimientos, 0) - $2,
                                 ultima_actualizacion = NOW()
                             WHERE articulo_numero = $1`,
                            [legacyCode, parseFloat(dest.cantidad_asignada)]
                        );

                        // C. Recalcular stock_consolidado
                        await client.query(
                            `UPDATE public.stock_real_consolidado
                             SET stock_consolidado = COALESCE(stock_lomasoft, 0) + 
                                                     COALESCE(stock_movimientos, 0) + 
                                                     COALESCE(stock_ajustes, 0),
                                 ultima_actualizacion = NOW()
                             WHERE articulo_numero = $1`,
                            [legacyCode]
                        );
                    } else if (dest.tipo_destino === 'INGREDIENTE_PRODUCCION') {
                        // A. Eliminar el movimiento de ingredientes_movimientos
                        // La eliminación disparará trigger_actualizar_stock que restará automáticamente del stock de ingredientes
                        await client.query(
                            `DELETE FROM public.ingredientes_movimientos 
                             WHERE ingrediente_id = $1 AND tipo = 'ingreso' AND observaciones = $2`,
                            [parseInt(dest.destino_id), 'Ingreso por vinculación de lote: ' + lote_id_supabase]
                        );
                    }
                }
            } else {
                console.log(` Desvinculando lote ${lote_id_supabase} SIN revertir stock.`);
            }

            // 4. Eliminar el vínculo de la cabecera (destinos se borrarán en cascada por FK ON DELETE CASCADE)
            await client.query(
                'DELETE FROM public.bunker_lotes_vinculos WHERE id = $1',
                [vinculoId]
            );

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = LotesBunkerService;
