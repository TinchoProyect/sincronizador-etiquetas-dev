/**
 * Modelo de Rutas
 * Capa de acceso a datos para la tabla rutas
 */

const { pool } = require('../config/database');

class RutasModel {

    /**
     * Obtener todas las rutas con filtros opcionales
     * @param {Object} filtros - Filtros de búsqueda
     * @returns {Promise<Array>} Lista de rutas
     */
    static async obtenerTodas(filtros = {}) {
        const { estado, id_chofer, fecha_desde, fecha_hasta, busqueda } = filtros;

        let query = `
            SELECT 
                r.id,
                r.nombre_ruta,
                r.fecha_salida,
                r.id_chofer,
                u.nombre_completo as chofer_nombre,
                r.id_vehiculo,
                r.estado,
                r.distancia_total_km,
                r.tiempo_estimado_min,
                r.fecha_creacion,
                r.fecha_finalizacion,
                r.usuario_creador_id,
                r.en_pausa,
                r.tiempo_pausado_minutos,
                r.duracion_neta_minutos,
                EXISTS (SELECT 1 FROM rutas_auditorias a WHERE a.id_ruta = r.id) as auditada,
                (SELECT COUNT(*) FROM presupuestos p WHERE p.id_ruta = r.id AND p.activo = true AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO')) + 
                (SELECT COUNT(*) FROM ordenes_tratamiento t WHERE t.id_ruta = r.id) +
                (SELECT COUNT(*) FROM public.factura_pagos_efectivo s WHERE s.id_ruta = r.id) +
                (SELECT COUNT(*) FROM public.bunker_prospectos pr WHERE pr.id_ruta = r.id AND pr.activo = true) as cantidad_presupuestos,
                (SELECT COUNT(*) FROM presupuestos p WHERE p.id_ruta = r.id AND p.estado_logistico IN ('ENTREGADO', 'RETIRADO')) +
                (SELECT COUNT(*) FROM ordenes_tratamiento t WHERE t.id_ruta = r.id AND t.estado_logistico IN ('ENTREGADO', 'RETIRADO')) +
                (SELECT COUNT(*) FROM public.factura_pagos_efectivo s WHERE s.id_ruta = r.id AND s.estado IN ('EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO')) +
                (SELECT COUNT(*) FROM public.bunker_prospectos pr WHERE pr.id_ruta = r.id AND pr.activo = true AND pr.estado_ruta IN ('VISITADO', 'NO_ENCONTRADO', 'NO_CONCRETADA')) as presupuestos_entregados
            FROM rutas r
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        if (estado) {
            query += ` AND r.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        if (id_chofer) {
            query += ` AND r.id_chofer = $${paramIndex}`;
            params.push(id_chofer);
            paramIndex++;
        }

        if (fecha_desde) {
            query += ` AND r.fecha_salida >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND r.fecha_salida <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        if (busqueda) {
            query += ` AND EXISTS (
                SELECT 1 FROM presupuestos p_search
                LEFT JOIN clientes c_search ON ltrim(p_search.id_cliente, '0') = c_search.cliente_id::text
                LEFT JOIN presupuestos_detalles pd_search ON pd_search.id_presupuesto = p_search.id
                WHERE p_search.id_ruta = r.id
                AND (
                    c_search.nombre ILIKE $${paramIndex} OR
                    c_search.apellido ILIKE $${paramIndex} OR
                    c_search.cliente_id::text ILIKE $${paramIndex} OR
                    pd_search.articulo ILIKE $${paramIndex}
                )
            )`;
            params.push(`%${busqueda}%`);
            paramIndex++;
        }

        query += ` ORDER BY r.fecha_salida DESC, r.id DESC`;

        const resultado = await pool.query(query, params);
        return resultado.rows;
    }

    /**
     * Obtener una ruta por ID con sus presupuestos
     * @param {number} id - ID de la ruta
     * @returns {Promise<Object|null>} Ruta encontrada o null
     */
    static async obtenerPorId(id) {
        // Obtener datos de la ruta
        const queryRuta = `
            SELECT 
                r.id,
                r.nombre_ruta,
                r.fecha_salida,
                r.id_chofer,
                u.nombre_completo as chofer_nombre,
                NULL as chofer_telefono,
                r.id_vehiculo,
                r.estado,
                r.distancia_total_km,
                r.tiempo_estimado_min,
                r.fecha_creacion,
                r.fecha_finalizacion,
                r.usuario_creador_id,
                r.en_pausa,
                r.tiempo_pausado_minutos,
                r.duracion_neta_minutos
            FROM rutas r
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            WHERE r.id = $1
        `;

        const resultadoRuta = await pool.query(queryRuta, [id]);

        if (resultadoRuta.rows.length === 0) {
            return null;
        }

        const ruta = resultadoRuta.rows[0];

        // Obtener presupuestos asignados a la ruta
        const queryPresupuestos = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.estado,
                COALESCE(c.cliente_id::text, ltrim(p.id_cliente, '0'), p.id_cliente) as id_cliente,
                c.cliente_id,
                c.nombre as cliente_nombre,
                p.id_domicilio_entrega,
                cd.alias as domicilio_alias,
                cd.direccion as domicilio_direccion,
                cd.latitud,
                cd.longitud,
                p.orden_entrega,
                p.estado_logistico,
                p.bloqueo_entrega,
                p.fecha_asignacion_ruta,
                p.fecha_entrega_real,
                p.comprobante_lomasoft,
                p.id_factura_lomasoft,
                COALESCE(
                    (SELECT SUM(pd.cantidad * pd.precio1)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto = p.id),
                    0
                ) as subtotal_bruto,
                COALESCE(p.descuento, 0) as descuento_aplicado,
                (COALESCE(
                    (SELECT SUM(pd.cantidad * pd.precio1)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto = p.id),
                    0
                ) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END))) as total,
                (SELECT f.estado FROM public.factura_facturas f WHERE f.presupuesto_id = p.id ORDER BY f.id DESC LIMIT 1) as factura_estado,
                EXISTS(SELECT 1 FROM public.factura_facturas f WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')) as esta_facturado
            FROM presupuestos p
            INNER JOIN clientes c ON ltrim(p.id_cliente, '0') = c.cliente_id::text
            LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
            WHERE p.id_ruta = $1
              AND p.activo = true
              AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO')
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `;

        const resultadoPresupuestos = await pool.query(queryPresupuestos, [id]);
        
        const queryTratamientos = `
            SELECT 
                'RT-' || p.id as id,
                p.id as id_presupuesto_ext,
                'Orden de Tratamiento' as estado,
                p.id_cliente::text as id_cliente,
                c.cliente_id,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                cd.id as id_domicilio_entrega,
                'Domicilio Cliente' as domicilio_alias,
                COALESCE(cd.direccion, 'Retiro Mantenimiento') as domicilio_direccion,
                cd.latitud,
                cd.longitud,
                p.orden_entrega,
                p.estado_logistico,
                p.estado_tratamiento,
                false as bloqueo_entrega,
                p.fecha_creacion as fecha_asignacion_ruta,
                NULL as comprobante_lomasoft,
                NULL as id_factura_lomasoft,
                0 as subtotal_bruto,
                0 as descuento_aplicado,
                0 as total,
                p.codigo_qr_hash as hash,
                EXISTS(SELECT 1 FROM ordenes_tratamiento_detalles otd WHERE otd.id_orden_tratamiento = p.id) as tiene_checkin
            FROM ordenes_tratamiento p
            LEFT JOIN clientes c ON p.id_cliente = c.cliente_id
            LEFT JOIN clientes_domicilios cd ON cd.id = COALESCE(
                p.id_domicilio_entrega,
                (
                    SELECT id 
                    FROM clientes_domicilios 
                    WHERE id_cliente = c.id AND activo = true
                    ORDER BY es_predeterminado DESC, id ASC
                    LIMIT 1
                )
            )
            WHERE p.id_ruta = $1
            ORDER BY id ASC
        `;

        const resultadoTratamientos = await pool.query(queryTratamientos, [id]);

        const querySobres = `
            SELECT 
                'SOB-' || p.id as id,
                p.codigo_sobre as id_presupuesto_ext,
                'Sobre de Efectivo' as estado,
                COALESCE(c.cliente_id::text, NULLIF(LTRIM(TRIM(bc.lomas_soft_id), '0'), ''), p.cliente_id) as id_cliente,
                c.cliente_id as cliente_id,
                COALESCE(c.nombre, bc.cliente_nombre, bc.razon_social, p.cliente_id) as cliente_nombre,
                cd.id as id_domicilio_entrega,
                COALESCE(cd.alias, 'Domicilio Cliente') as domicilio_alias,
                COALESCE(cd.direccion, bc.domicilio_fiscal, 'Retiro de Sobre') as domicilio_direccion,
                cd.latitud,
                cd.longitud,
                p.orden_entrega,
                CASE 
                    WHEN p.estado IN ('EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO') THEN 'RETIRADO'
                    ELSE 'ASIGNADO'
                END as estado_logistico,
                NULL as estado_tratamiento,
                false as bloqueo_entrega,
                p.fecha_actualizacion as fecha_asignacion_ruta,
                p.fecha_retiro_chofer as fecha_entrega_real,
                NULL as comprobante_lomasoft,
                NULL as id_factura_lomasoft,
                0 as subtotal_bruto,
                0 as descuento_aplicado,
                COALESCE(p.monto_declarado, 0) as total,
                true as esta_facturado,
                true as es_sobre_efectivo,
                p.id as sobre_id_numerico,
                p.codigo_sobre,
                p.cliente_id as codigo_bunker_cliente,
                COALESCE(p.monto_declarado, 0) as monto_declarado,
                p.foto_frente_url,
                p.foto_dorso_url,
                p.estado as estado_sobre
            FROM public.factura_pagos_efectivo p
            LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.cliente_id OR bc.lomas_soft_id = p.cliente_id
            LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                        OR (bc.id IS NULL AND c.cliente_id::text = ltrim(p.cliente_id, '0'))
            LEFT JOIN public.clientes_domicilios cd ON cd.id = COALESCE(
                p.id_domicilio_entrega,
                (
                    SELECT cd_sub.id 
                    FROM public.clientes_domicilios cd_sub
                    WHERE (
                        cd_sub.id_cliente = bc.id
                        OR cd_sub.id_cliente = c.id
                        OR cd_sub.id_cliente::text = bc.lomas_soft_id
                        OR cd_sub.id_cliente::text = c.cliente_id::text
                    ) AND cd_sub.activo = true
                    ORDER BY cd_sub.es_predeterminado DESC, cd_sub.fecha_creacion ASC, cd_sub.id ASC
                    LIMIT 1
                )
            )
            WHERE p.id_ruta = $1
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `;

        const resultadoSobres = await pool.query(querySobres, [id]);

        const queryProspectos = `
            SELECT 
                'PR-' || p.id as id,
                p.codigo_prospecto as id_presupuesto_ext,
                'Visita Comercial' as estado,
                p.codigo_prospecto as id_cliente,
                p.codigo_prospecto as cliente_id,
                p.nombre_fantasia as cliente_nombre,
                p.id as id_domicilio_entrega,
                COALESCE(p.zona, p.localidad, 'Preventa') as domicilio_alias,
                COALESCE(p.direccion, 'Presentación Comercial') as domicilio_direccion,
                p.latitud,
                p.longitud,
                p.orden_entrega,
                CASE 
                    WHEN p.estado_ruta = 'VISITADO' THEN 'ENTREGADO'
                    WHEN p.estado_ruta IN ('NO_ENCONTRADO', 'NO_CONCRETADA') THEN 'RECHAZADO'
                    ELSE 'ASIGNADO'
                END as estado_logistico,
                p.estado_ruta,
                NULL as estado_tratamiento,
                false as bloqueo_entrega,
                p.updated_at as fecha_asignacion_ruta,
                p.fecha_visita_ruta as fecha_entrega_real,
                NULL as comprobante_lomasoft,
                NULL as id_factura_lomasoft,
                0 as subtotal_bruto,
                0 as descuento_aplicado,
                0 as total,
                true as esta_facturado,
                true as es_visita_preventa,
                p.id as prospecto_id_numerico,
                p.codigo_prospecto,
                p.origen_contacto,
                p.cliente_activo_id,
                p.cliente_domicilio_id,
                p.rubro,
                p.contacto_nombre,
                p.contacto_rol,
                p.telefono_whatsapp,
                p.email,
                p.notas,
                p.estado as estado_prospecto
            FROM public.bunker_prospectos p
            WHERE p.id_ruta = $1 AND p.activo = true
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `;
        const resultadoProspectos = await pool.query(queryProspectos, [id]);

        // Sort them together in memory by their synchronized orden_entrega
        const presupuestosHibridos = [...resultadoPresupuestos.rows, ...resultadoTratamientos.rows, ...resultadoSobres.rows, ...resultadoProspectos.rows];
        presupuestosHibridos.sort((a, b) => {
            const ordenA = a.orden_entrega ?? 999;
            const ordenB = b.orden_entrega ?? 999;
            if (ordenA === ordenB) return a.id < b.id ? -1 : 1;
            return ordenA - ordenB;
        });

        ruta.presupuestos = presupuestosHibridos;
        ruta.total_presupuestos = ruta.presupuestos.length;

        return ruta;
    }

    /**
     * Crear una nueva ruta
     * @param {Object} datos - Datos de la ruta
     * @returns {Promise<Object>} Ruta creada
     */
    static async crear(datos) {
        const {
            nombre_ruta,
            fecha_salida,
            id_chofer,
            id_vehiculo,
            usuario_creador_id
        } = datos;

        const query = `
            INSERT INTO rutas (
                nombre_ruta,
                fecha_salida,
                id_chofer,
                id_vehiculo,
                estado,
                usuario_creador_id,
                fecha_creacion
            ) VALUES ($1, $2, $3, $4, 'ARMANDO', $5, NOW())
            RETURNING *
        `;

        const params = [
            nombre_ruta,
            fecha_salida,
            id_chofer,
            id_vehiculo,
            usuario_creador_id
        ];

        const resultado = await pool.query(query, params);
        return resultado.rows[0];
    }

    /**
     * Actualizar una ruta existente
     * @param {number} id - ID de la ruta
     * @param {Object} datos - Datos a actualizar
     * @returns {Promise<Object>} Ruta actualizada
     */
    static async actualizar(id, datos) {
        const {
            nombre_ruta,
            fecha_salida,
            id_chofer,
            id_vehiculo,
            estado,
            distancia_total_km,
            tiempo_estimado_min
        } = datos;

        // Sanitizar valores numéricos para evitar NaN
        const id_chofer_sanitizado = id_chofer !== undefined ? (parseInt(id_chofer) || null) : null;
        const distancia_sanitizada = distancia_total_km !== undefined ? (parseFloat(distancia_total_km) || null) : null;
        const tiempo_sanitizado = tiempo_estimado_min !== undefined ? (parseInt(tiempo_estimado_min) || null) : null;

        const query = `
            UPDATE rutas SET
                nombre_ruta = COALESCE($1, nombre_ruta),
                fecha_salida = COALESCE($2, fecha_salida),
                id_chofer = COALESCE($3, id_chofer),
                id_vehiculo = COALESCE($4, id_vehiculo),
                estado = COALESCE($5, estado),
                distancia_total_km = COALESCE($6, distancia_total_km),
                tiempo_estimado_min = COALESCE($7, tiempo_estimado_min)
            WHERE id = $8
            RETURNING *
        `;

        const params = [
            nombre_ruta || null,
            fecha_salida || null,
            id_chofer_sanitizado,
            id_vehiculo || null,
            estado || null,
            distancia_sanitizada,
            tiempo_sanitizado,
            id
        ];

        const resultado = await pool.query(query, params);
        return resultado.rows[0];
    }

    /**
     * Asignar presupuestos a una ruta
     * @param {number} id_ruta - ID de la ruta
     * @param {Array<number>} ids_presupuestos - IDs de presupuestos a asignar
     * @param {number} usuario_id - ID del usuario que realiza la asignación
     * @returns {Promise<Object>} Resultado de la asignación
     */
    static async asignarPresupuestos(id_ruta, ids_presupuestos, usuario_id) {
        const client = await pool.connect();

        // DEBUG: Log de parámetros recibidos
        console.log('[RUTAS-MODEL] asignarPresupuestos - Parámetros recibidos:');
        console.log('  id_ruta:', id_ruta, 'tipo:', typeof id_ruta);
        console.log('  ids_presupuestos:', ids_presupuestos);
        console.log('  usuario_id:', usuario_id, 'tipo:', typeof usuario_id);

        try {
            await client.query('BEGIN');

            // Auto-asignar domicilios a presupuestos huérfanos antes de validar
            const { autoAsignarDomicilios } = require('./presupuestosModel');
            await autoAsignarDomicilios(client);

            // Validar que la ruta existe y está en estado ARMANDO
            const rutaQuery = await client.query(
                'SELECT id, estado FROM rutas WHERE id = $1 FOR UPDATE',
                [id_ruta]
            );

            if (rutaQuery.rows.length === 0) {
                throw new Error('Ruta no encontrada');
            }

            if (rutaQuery.rows[0].estado !== 'ARMANDO') {
                throw new Error('Solo se pueden asignar presupuestos a rutas en estado ARMANDO');
            }

            const idsNormales = ids_presupuestos.filter(id => Number.isInteger(id) || (!String(id).toUpperCase().startsWith('RT-') && !String(id).toUpperCase().startsWith('SOB-') && !String(id).toUpperCase().startsWith('PR-'))).map(id => parseInt(id));
            const idsRetiros = ids_presupuestos.filter(id => String(id).toUpperCase().startsWith('RT-')).map(id => parseInt(String(id).toUpperCase().replace('RT-', '')));
            const idsSobres = ids_presupuestos.filter(id => String(id).toUpperCase().startsWith('SOB-')).map(id => parseInt(String(id).toUpperCase().replace('SOB-', '')));
            const idsProspectos = ids_presupuestos.filter(id => String(id).toUpperCase().startsWith('PR-')).map(id => parseInt(String(id).toUpperCase().replace('PR-', '')));

            // FASE 5: Asignar Visitas Comerciales de Preventa
            if (idsProspectos.length > 0) {
                await client.query(
                    `UPDATE public.bunker_prospectos
                     SET id_ruta = $1,
                         en_pool_logistica = true,
                         estado_ruta = 'PENDIENTE',
                         updated_at = NOW()
                     WHERE id = ANY($2::int[])`,
                    [id_ruta, idsProspectos]
                );
            }

            // FASE 3: Asignar Retiros de Inmunización (Sin validación de coordenadas estrictas)
            if (idsRetiros.length > 0) {
                await client.query(
                    `UPDATE ordenes_tratamiento 
                     SET id_ruta = $1,
                         estado_logistico = CASE 
                             WHEN estado_tratamiento = 'COMPLETADO' THEN 'PENDIENTE_DEVOLUCION_CLIENTE'
                             ELSE estado_logistico
                         END
                     WHERE id = ANY($2::int[])`,
                    [id_ruta, idsRetiros]
                );
            }

            // FASE 4: Asignar Sobres de Efectivo Cerrados
            if (idsSobres.length > 0) {
                const sobresQuery = await client.query(
                    `SELECT id, codigo_sobre, id_ruta, estado, modalidad_entrega
                     FROM public.factura_pagos_efectivo
                     WHERE id = ANY($1::int[])
                     FOR UPDATE`,
                    [idsSobres]
                );

                if (sobresQuery.rows.length !== idsSobres.length) {
                    throw new Error('Algunos sobres de efectivo seleccionados no existen');
                }

                for (const s of sobresQuery.rows) {
                    if (s.id_ruta && s.id_ruta !== id_ruta) {
                        throw new Error(`El sobre ${s.codigo_sobre} ya está asignado a otra ruta`);
                    }
                    if (!['PREPARADO', 'EN_TRANSITO'].includes(s.estado)) {
                        throw new Error(`El sobre ${s.codigo_sobre} no está en estado PREPARADO (Estado actual: ${s.estado})`);
                    }
                }

                await client.query(
                    `UPDATE public.factura_pagos_efectivo
                     SET id_ruta = $1,
                         fecha_actualizacion = NOW()
                     WHERE id = ANY($2::int[])`,
                    [id_ruta, idsSobres]
                );
            }

            if (idsNormales.length > 0) {
                // Validar que los presupuestos existen y están disponibles
                const presupuestosQuery = await client.query(
                    `SELECT id, id_ruta, id_domicilio_entrega, bloqueo_entrega, estado_logistico
                     FROM presupuestos 
                     WHERE id = ANY($1::int[])
                     FOR UPDATE`,
                    [idsNormales]
                );

                if (presupuestosQuery.rows.length !== idsNormales.length) {
                    throw new Error('Algunos presupuestos no existen');
                }

                // Validar cada presupuesto
                for (const p of presupuestosQuery.rows) {
                    if (p.id_ruta && p.id_ruta !== id_ruta) {
                        throw new Error(`Presupuesto ${p.id} ya está asignado a otra ruta`);
                    }

                    if (!p.id_domicilio_entrega) {
                        throw new Error(`Presupuesto ${p.id} no tiene domicilio de entrega`);
                    }

                    if (p.bloqueo_entrega) {
                        throw new Error(`Presupuesto ${p.id} tiene bloqueo de entrega (pago pendiente)`);
                    }
                }

                // Validar que los domicilios tienen coordenadas
                const domiciliosQuery = await client.query(
                    `SELECT cd.id, cd.latitud, cd.longitud
                     FROM clientes_domicilios cd
                     INNER JOIN presupuestos p ON p.id_domicilio_entrega = cd.id
                     WHERE p.id = ANY($1::int[])`,
                    [idsNormales]
                );

                for (const d of domiciliosQuery.rows) {
                    if (!d.latitud || !d.longitud) {
                        throw new Error(`Domicilio ${d.id} no tiene coordenadas`);
                    }
                }

                // Asignar presupuestos a la ruta
                await client.query(
                    `UPDATE presupuestos 
                     SET id_ruta = $1,
                         estado_logistico = 'ASIGNADO',
                         secuencia = 'Asignado_Ruta',
                         fecha_asignacion_ruta = NOW()
                     WHERE id = ANY($2::int[])`,
                    [id_ruta, idsNormales]
                );

                // Registrar en historial de estados
                const usuario_id_sanitizado = (usuario_id && parseInt(usuario_id)) || 1;

                for (const id_presupuesto of idsNormales) {
                    await client.query(
                        `INSERT INTO presupuestos_estados_historial 
                         (id_presupuesto, estado_anterior, estado_nuevo, metadata, usuario_id, fecha_cambio)
                         VALUES ($1, 'PENDIENTE_ASIGNAR', 'ASIGNADO', $2, $3, NOW())`,
                        [
                            id_presupuesto,
                            JSON.stringify({ id_ruta }),
                            usuario_id_sanitizado
                        ]
                    );
                }
            }

            // Sincronizar id_domicilio_entrega y orden_entrega de sobres en la ruta cuando el mismo cliente ya tiene un presupuesto en la ruta
            await client.query(`
                UPDATE public.factura_pagos_efectivo s
                SET id_domicilio_entrega = COALESCE(sub.id_domicilio_entrega, s.id_domicilio_entrega),
                    orden_entrega = COALESCE(sub.orden_entrega, s.orden_entrega)
                FROM (
                    SELECT DISTINCT ON (s2.id)
                        s2.id as sobre_id,
                        p.id_domicilio_entrega,
                        p.orden_entrega
                    FROM public.factura_pagos_efectivo s2
                    LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = s2.cliente_id OR bc.lomas_soft_id = s2.cliente_id
                    INNER JOIN public.presupuestos p ON p.id_ruta = s2.id_ruta
                        AND ltrim(p.id_cliente, '0') = COALESCE(NULLIF(LTRIM(TRIM(bc.lomas_soft_id), '0'), ''), LTRIM(TRIM(s2.cliente_id), '0'))
                    WHERE s2.id_ruta = $1
                    ORDER BY s2.id, p.orden_entrega ASC NULLS LAST, p.id ASC
                ) sub
                WHERE s.id = sub.sobre_id
            `, [id_ruta]);

            await client.query('COMMIT');

            return {
                success: true,
                presupuestos_asignados: ids_presupuestos.length
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Verificar si un chofer existe
     * @param {number} id_chofer - ID del chofer
     * @returns {Promise<boolean>} True si existe
     */
    static async choferExiste(id_chofer) {
        const query = 'SELECT id FROM usuarios WHERE id = $1';
        const resultado = await pool.query(query, [id_chofer]);
        return resultado.rowCount > 0;
    }

    /**
     * Cambiar estado de una ruta
     * @param {number} id - ID de la ruta
     * @param {string} nuevoEstado - Nuevo estado
     * @returns {Promise<Object>} Ruta actualizada
     */
    static async cambiarEstado(id, nuevoEstado) {
        const query = `
            UPDATE rutas 
            SET estado = $1,
                fecha_finalizacion = CASE WHEN $1 = 'FINALIZADA' THEN NOW() ELSE fecha_finalizacion END,
                duracion_neta_minutos = CASE WHEN $1 = 'FINALIZADA' THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - fecha_salida))/60) - COALESCE(tiempo_pausado_minutos, 0) ELSE duracion_neta_minutos END
            WHERE id = $2
            RETURNING *
        `;

        const resultado = await pool.query(query, [nuevoEstado, id]);
        return resultado.rows[0];
    }

    /**
     * Eliminar una ruta con restauración automática de presupuestos
     * @param {number} id - ID de la ruta
     * @returns {Promise<Object>} Resultado de la eliminación
     */
    static async eliminar(id) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Obtener cantidad de presupuestos asignados
            const countQuery = await client.query(
                'SELECT COUNT(*) as total FROM presupuestos WHERE id_ruta = $1',
                [id]
            );

            const cantidadPresupuestos = parseInt(countQuery.rows[0].total);

            console.log('[RUTAS-MODEL] Eliminando ruta:', id);
            console.log('[RUTAS-MODEL] Presupuestos a restaurar:', cantidadPresupuestos);

            // 2. Restaurar presupuestos (desvincular y resetear estados)
            if (cantidadPresupuestos > 0) {
                await client.query(
                    `UPDATE presupuestos 
                     SET id_ruta = NULL,
                         secuencia = 'Pedido_Listo',
                         estado = CASE 
                             WHEN estado = 'Entregado' THEN 'Presupuesto/Orden'
                             ELSE estado
                         END,
                         estado_logistico = 'PENDIENTE_ASIGNAR',
                         orden_entrega = NULL,
                         fecha_asignacion_ruta = NULL,
                         fecha_actualizacion = NOW()
                     WHERE id_ruta = $1`,
                    [id]
                );

                console.log('[RUTAS-MODEL] ✅ Presupuestos restaurados:', cantidadPresupuestos);
            }

            // 2b. Restaurar ordenes de tratamiento (desvincular de la ruta eliminada)
            const countTratamientos = await client.query(
                'SELECT COUNT(*) as total FROM ordenes_tratamiento WHERE id_ruta = $1',
                [id]
            );
            const cantidadTratamientos = parseInt(countTratamientos.rows[0].total);

            if (cantidadTratamientos > 0) {
                await client.query(
                    `UPDATE ordenes_tratamiento 
                     SET id_ruta = NULL,
                         estado_logistico = CASE 
                             WHEN estado_logistico IN ('EN_CAMINO', 'PENDIENTE_VALIDACION') THEN 'PENDIENTE_CLIENTE'
                             WHEN estado_logistico = 'PENDIENTE_DEVOLUCION_CLIENTE' THEN 'INGRESADO_LOCAL'
                             ELSE estado_logistico
                         END,
                         orden_entrega = 999
                     WHERE id_ruta = $1`,
                    [id]
                );
                console.log('[RUTAS-MODEL] ✅ Órdenes de tratamiento restauradas:', cantidadTratamientos);
            }

            // 2c. Restaurar sobres de efectivo (desvincular de la ruta eliminada)
            const resSobresRest = await client.query(
                `UPDATE public.factura_pagos_efectivo 
                 SET id_ruta = NULL,
                     orden_entrega = 999,
                     fecha_actualizacion = NOW()
                 WHERE id_ruta = $1`,
                [id]
            );
            if (resSobresRest.rowCount > 0) {
                console.log('[RUTAS-MODEL] ✅ Sobres de efectivo restaurados:', resSobresRest.rowCount);
            }

            // 2d. Restaurar visitas de preventa (desvincular de la ruta eliminada)
            await client.query(
                `UPDATE public.bunker_prospectos
                 SET id_ruta = NULL,
                     orden_entrega = 999,
                     estado_ruta = 'PENDIENTE',
                     updated_at = NOW()
                 WHERE id_ruta = $1`,
                [id]
            );

            // 3. Eliminar la ruta
            const deleteQuery = await client.query(
                'DELETE FROM rutas WHERE id = $1 RETURNING *',
                [id]
            );

            if (deleteQuery.rows.length === 0) {
                throw new Error('Ruta no encontrada');
            }

            await client.query('COMMIT');

            console.log('[RUTAS-MODEL] ✅ Ruta eliminada exitosamente');

            return {
                success: true,
                ruta_eliminada: deleteQuery.rows[0],
                presupuestos_restaurados: cantidadPresupuestos
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[RUTAS-MODEL] ❌ Error al eliminar ruta:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = RutasModel;
