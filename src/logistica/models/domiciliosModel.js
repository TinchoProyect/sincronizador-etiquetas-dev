/**
 * Modelo de Domicilios
 * Capa de acceso a datos para la tabla clientes_domicilios
 */

const { pool } = require('../config/database');
const ClientesBunkerModel = require('./clientesBunkerModel');

class DomiciliosModel {
    /**
     * Resuelve de forma determinista y sin colisiones la identidad de un cliente
     * (Búnker y/o Legacy) a partir de su PK Búnker, código CB-XXXX, lomas_soft_id o PK/cliente_id legacy.
     *
     * @param {string|number} id_cliente
     * @returns {Promise<{bunkerClienteId: number|null, codigoBunker: string|null, clienteNombre: string|null, legacyClientesPk: number|null, legacyClienteId: number|null, intIds: number[], strIds: string[]}>}
     */
    static async resolverIdentidadCliente(id_cliente) {
        const vacio = {
            bunkerClienteId: null,
            codigoBunker: null,
            clienteNombre: null,
            legacyClientesPk: null,
            legacyClienteId: null,
            intIds: [],
            strIds: []
        };
        if (id_cliente === undefined || id_cliente === null) return vacio;

        const rawStr = String(id_cliente).trim();
        if (!rawStr) return vacio;

        const intVal = parseInt(rawStr, 10);
        const hasInt = /^\d+$/.test(rawStr) && !isNaN(intVal) && rawStr.length < 10;

        let bunkerRow = null;
        try {
            let queryBunker = `
                SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id,
                       cuit_cuil, dni, condicion_iva, domicilio_fiscal, provincia,
                       whatsapp_facturas, email_facturas, email_portal, preferencia_facturacion
                FROM public.bunker_clientes
                WHERE codigo_bunker_cliente = $1
                   OR lomas_soft_id = $1
            `;
            const paramsBunker = [rawStr];
            if (hasInt) {
                queryBunker += `
                   OR id = $2
                   OR (lomas_soft_id ~ '^[0-9]+$' AND LENGTH(lomas_soft_id) < 10 AND lomas_soft_id::integer = $2)
                `;
                paramsBunker.push(intVal);
            }
            queryBunker += `
                ORDER BY
                    CASE
                        WHEN codigo_bunker_cliente = $1 THEN 0
                        WHEN lomas_soft_id = $1 THEN 1
                        ${hasInt ? 'WHEN id = $2 THEN 2' : ''}
                        ELSE 3
                    END ASC
                LIMIT 1
            `;
            const resBunker = await pool.query(queryBunker, paramsBunker);
            if (resBunker.rowCount > 0) {
                bunkerRow = resBunker.rows[0];
            }
        } catch (e) {
            console.error('[DOMICILIOS-MODEL] Error al consultar bunker_clientes en resolverIdentidadCliente:', e.message);
        }

        const intIdsSet = new Set();
        const strIdsSet = new Set();
        let legacyClientesPk = null;
        let legacyClienteId = null;

        if (bunkerRow) {
            const rawLomas = String(bunkerRow.lomas_soft_id || '').trim();
            if (/^\d+$/.test(rawLomas) && rawLomas.length < 10) {
                const lomasInt = parseInt(rawLomas, 10);
                if (lomasInt > 0) {
                    try {
                        let resLegacy = await pool.query(
                            `SELECT id, cliente_id FROM public.clientes WHERE cliente_id = $1 LIMIT 1`,
                            [lomasInt]
                        );
                        if (resLegacy.rowCount === 0) {
                            await ClientesBunkerModel.sincronizarConClientesLegacy(bunkerRow, pool, { preservarExistentes: true });
                            resLegacy = await pool.query(
                                `SELECT id, cliente_id FROM public.clientes WHERE cliente_id = $1 LIMIT 1`,
                                [lomasInt]
                            );
                        }
                        if (resLegacy.rowCount > 0) {
                            legacyClientesPk = parseInt(resLegacy.rows[0].id, 10);
                            legacyClienteId = parseInt(resLegacy.rows[0].cliente_id, 10);
                            intIdsSet.add(legacyClientesPk);
                            intIdsSet.add(legacyClienteId);
                            strIdsSet.add(String(legacyClientesPk));
                            strIdsSet.add(String(legacyClienteId));
                            strIdsSet.add(rawLomas);
                        }
                    } catch (e) {
                        console.error('[DOMICILIOS-MODEL] Error resolviendo espejo legacy para Búnker:', e.message);
                    }
                }
            }

            // Compatibilidad histórica controlada: filas legadas sin bunker_cliente_id que usaron bunker_clientes.id
            // siempre que ese ID no pertenezca a una fila legacy de OTRO cliente Búnker
            let idBunkerChocaConOtroLegacy = false;
            try {
                const chkCol = await pool.query(
                    `SELECT bc.id
                     FROM public.clientes c
                     JOIN public.bunker_clientes bc
                       ON bc.lomas_soft_id IS NOT NULL
                      AND bc.lomas_soft_id ~ '^[0-9]+$'
                      AND LENGTH(bc.lomas_soft_id) < 10
                      AND bc.lomas_soft_id::integer = c.cliente_id
                     WHERE c.id = $1
                       AND bc.id <> $2
                     LIMIT 1`,
                    [bunkerRow.id, bunkerRow.id]
                );
                idBunkerChocaConOtroLegacy = chkCol.rowCount > 0;
            } catch (_) {}

            if (!idBunkerChocaConOtroLegacy) {
                intIdsSet.add(parseInt(bunkerRow.id, 10));
                strIdsSet.add(String(bunkerRow.id));
            }
            if (bunkerRow.codigo_bunker_cliente) {
                strIdsSet.add(String(bunkerRow.codigo_bunker_cliente).trim());
            }

            return {
                bunkerClienteId: parseInt(bunkerRow.id, 10),
                codigoBunker: bunkerRow.codigo_bunker_cliente || null,
                clienteNombre: bunkerRow.cliente_nombre || bunkerRow.razon_social || null,
                legacyClientesPk,
                legacyClienteId,
                intIds: Array.from(intIdsSet).filter(x => Number.isFinite(x)),
                strIds: Array.from(strIdsSet).filter(Boolean)
            };
        }

        // Fallback legacy puro (no existe en bunker_clientes)
        try {
            const resLegacy = await pool.query(
                `SELECT id, cliente_id, nombre, apellido FROM public.clientes WHERE id = $1 OR cliente_id = $1 OR cliente_id::text = $2 LIMIT 1`,
                [hasInt ? intVal : -1, rawStr]
            );
            if (resLegacy.rowCount > 0) {
                const row = resLegacy.rows[0];
                legacyClientesPk = parseInt(row.id, 10);
                legacyClienteId = parseInt(row.cliente_id, 10);
                intIdsSet.add(legacyClientesPk);
                intIdsSet.add(legacyClienteId);
                strIdsSet.add(String(legacyClientesPk));
                strIdsSet.add(String(legacyClienteId));
                return {
                    bunkerClienteId: null,
                    codigoBunker: null,
                    clienteNombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || null,
                    legacyClientesPk,
                    legacyClienteId,
                    intIds: Array.from(intIdsSet).filter(x => Number.isFinite(x)),
                    strIds: Array.from(strIdsSet).filter(Boolean)
                };
            }
        } catch (e) {
            console.error('[DOMICILIOS-MODEL] Error en búsqueda legacy:', e.message);
        }

        return vacio;
    }

    /**
     * Compatibilidad con llamadores existentes que esperan intIds y strIds
     */
    static async obtenerTodosLosIdsCliente(id_cliente) {
        const ident = await this.resolverIdentidadCliente(id_cliente);
        return { intIds: ident.intIds, strIds: ident.strIds };
    }

    /**
     * Compatibilidad con llamadores existentes: retorna PK legacy si existe o PK Búnker
     */
    static async obtenerIdInternoCliente(id_cliente) {
        const ident = await this.resolverIdentidadCliente(id_cliente);
        return ident.legacyClientesPk || ident.bunkerClienteId || null;
    }

    /**
     * Construye condición SQL segura para filtrar domicilios de un cliente sin colisiones
     */
    static _construirFiltroClienteSql(ident, paramStartIndex = 1) {
        const params = [];
        let idx = paramStartIndex;

        if (ident.bunkerClienteId) {
            params.push(ident.bunkerClienteId);
            const bunkerParam = `$${idx++}`;
            if (ident.intIds.length > 0 || ident.strIds.length > 0) {
                params.push(ident.intIds, ident.strIds);
                const intParam = `$${idx++}`;
                const strParam = `$${idx++}`;
                return {
                    clause: `(cd.bunker_cliente_id = ${bunkerParam} OR (cd.bunker_cliente_id IS NULL AND (cd.id_cliente = ANY(${intParam}::int[]) OR cd.id_cliente::text = ANY(${strParam}::text[]))))`,
                    params,
                    nextIndex: idx
                };
            }
            return {
                clause: `cd.bunker_cliente_id = ${bunkerParam}`,
                params,
                nextIndex: idx
            };
        }

        if (ident.intIds.length > 0 || ident.strIds.length > 0) {
            params.push(ident.intIds, ident.strIds);
            const intParam = `$${idx++}`;
            const strParam = `$${idx++}`;
            return {
                clause: `(cd.bunker_cliente_id IS NULL AND (cd.id_cliente = ANY(${intParam}::int[]) OR cd.id_cliente::text = ANY(${strParam}::text[])))`,
                params,
                nextIndex: idx
            };
        }

        return { clause: '1=0', params: [], nextIndex: idx };
    }

    /**
     * Obtener todos los domicilios con filtros opcionales
     * @param {Object} filtros - Filtros de búsqueda
     * @returns {Promise<Array>} Lista de domicilios
     */
    static async obtenerTodos(filtros = {}) {
        const { id_cliente, activo = true, es_predeterminado } = filtros;

        let query = `
            SELECT 
                cd.id,
                cd.id_cliente,
                cd.bunker_cliente_id,
                COALESCE(
                    bc_dir.cliente_nombre,
                    (
                        SELECT COALESCE(bc.cliente_nombre, c.nombre)
                        FROM public.bunker_clientes bc 
                        LEFT JOIN clientes c ON c.cliente_id::text = LTRIM(bc.lomas_soft_id, '0')
                        WHERE (bc.lomas_soft_id ~ '^[0-9]+$' AND c.id = cd.id_cliente)
                           OR bc.id = cd.id_cliente
                        LIMIT 1
                    ),
                    c_dir.nombre
                ) as cliente_nombre,
                cd.alias,
                cd.tipo_lugar,
                cd.direccion,
                cd.localidad,
                cd.provincia,
                cd.codigo_postal,
                cd.latitud,
                cd.longitud,
                cd.coordenadas_validadas,
                cd.es_predeterminado,
                cd.telefono_contacto,
                cd.instrucciones_entrega,
                cd.horario_atencion_desde,
                cd.horario_atencion_hasta,
                cd.origen_carga,
                cd.verificado_por_cliente,
                cd.fecha_verificacion_cliente,
                cd.solicitud_id,
                cd.gps_precision_metros,
                cd.activo,
                cd.fecha_creacion,
                cd.fecha_modificacion
            FROM clientes_domicilios cd
            LEFT JOIN public.bunker_clientes bc_dir ON bc_dir.id = cd.bunker_cliente_id
            LEFT JOIN public.clientes c_dir ON c_dir.id = cd.id_cliente
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        if (id_cliente !== undefined && id_cliente !== null && String(id_cliente).trim() !== '') {
            const ident = await this.resolverIdentidadCliente(id_cliente);
            const built = this._construirFiltroClienteSql(ident, paramIndex);
            query += ` AND ${built.clause}`;
            params.push(...built.params);
            paramIndex = built.nextIndex;
        }

        if (activo !== undefined) {
            query += ` AND cd.activo = $${paramIndex}`;
            params.push(activo);
            paramIndex++;
        }

        if (es_predeterminado !== undefined) {
            query += ` AND cd.es_predeterminado = $${paramIndex}`;
            params.push(es_predeterminado);
            paramIndex++;
        }

        query += ` ORDER BY cd.es_predeterminado DESC, cd.alias ASC, cd.id ASC`;

        const resultado = await pool.query(query, params);
        return resultado.rows;
    }

    /**
     * Obtener un domicilio por ID
     * @param {number} id - ID del domicilio
     * @returns {Promise<Object|null>} Domicilio encontrado o null
     */
    static async obtenerPorId(id) {
        const query = `
            SELECT 
                cd.id,
                cd.id_cliente,
                cd.bunker_cliente_id,
                COALESCE(bc.cliente_nombre, c.nombre) as cliente_nombre,
                cd.alias,
                cd.tipo_lugar,
                cd.direccion,
                cd.localidad,
                cd.provincia,
                cd.codigo_postal,
                cd.latitud,
                cd.longitud,
                cd.coordenadas_validadas,
                cd.es_predeterminado,
                cd.telefono_contacto,
                cd.instrucciones_entrega,
                cd.horario_atencion_desde,
                cd.horario_atencion_hasta,
                cd.origen_carga,
                cd.verificado_por_cliente,
                cd.fecha_verificacion_cliente,
                cd.solicitud_id,
                cd.gps_precision_metros,
                cd.activo,
                cd.fecha_creacion,
                cd.fecha_modificacion
            FROM clientes_domicilios cd
            LEFT JOIN public.bunker_clientes bc ON bc.id = cd.bunker_cliente_id
            LEFT JOIN clientes c ON cd.id_cliente = c.id
            WHERE cd.id = $1
        `;

        const resultado = await pool.query(query, [id]);
        return resultado.rows[0] || null;
    }

    /**
     * Crear un nuevo domicilio
     * @param {Object} datos - Datos del domicilio
     * @param {Object|null} dbClient - Cliente de transacción opcional
     * @returns {Promise<Object>} Domicilio creado
     */
    static async crear(datos, dbClient = null) {
        const db = dbClient || pool;
        const {
            id_cliente = null,
            bunker_cliente_id = null,
            alias,
            tipo_lugar = null,
            direccion,
            localidad = null,
            provincia = null,
            codigo_postal = null,
            latitud = null,
            longitud = null,
            coordenadas_validadas = false,
            es_predeterminado = false,
            telefono_contacto = null,
            instrucciones_entrega = null,
            horario_atencion_desde = null,
            horario_atencion_hasta = null,
            origen_carga = 'INTERNO',
            verificado_por_cliente = false,
            fecha_verificacion_cliente = null,
            solicitud_id = null,
            gps_precision_metros = null
        } = datos;

        const identRef = bunker_cliente_id || id_cliente;
        const ident = await this.resolverIdentidadCliente(identRef);
        const bunkerIdFinal = bunker_cliente_id || ident.bunkerClienteId || null;
        const legacyPkFinal = ident.legacyClientesPk || (bunkerIdFinal ? null : id_cliente);

        const filtro = this._construirFiltroClienteSql(
            bunkerIdFinal
                ? { ...ident, bunkerClienteId: bunkerIdFinal }
                : ident,
            1
        );

        let esPredeterminadoFinal = Boolean(es_predeterminado);

        if (!esPredeterminadoFinal && filtro.clause !== '1=0') {
            const countRes = await db.query(
                `SELECT COUNT(*) FROM clientes_domicilios cd WHERE ${filtro.clause} AND cd.activo = TRUE`,
                filtro.params
            );
            if (parseInt(countRes.rows[0].count, 10) === 0) {
                esPredeterminadoFinal = true;
            }
        }

        if (esPredeterminadoFinal && filtro.clause !== '1=0') {
            await db.query(
                `UPDATE clientes_domicilios cd SET es_predeterminado = FALSE WHERE ${filtro.clause}`,
                filtro.params
            );
        }

        const query = `
            INSERT INTO clientes_domicilios (
                id_cliente,
                bunker_cliente_id,
                alias,
                tipo_lugar,
                direccion,
                localidad,
                provincia,
                codigo_postal,
                latitud,
                longitud,
                coordenadas_validadas,
                es_predeterminado,
                telefono_contacto,
                instrucciones_entrega,
                horario_atencion_desde,
                horario_atencion_hasta,
                origen_carga,
                verificado_por_cliente,
                fecha_verificacion_cliente,
                solicitud_id,
                gps_precision_metros,
                activo,
                fecha_creacion,
                fecha_modificacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, TRUE, NOW(), NOW())
            RETURNING *
        `;

        const params = [
            legacyPkFinal,
            bunkerIdFinal,
            alias,
            tipo_lugar,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            Boolean(coordenadas_validadas),
            esPredeterminadoFinal,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta,
            origen_carga || 'INTERNO',
            Boolean(verificado_por_cliente),
            fecha_verificacion_cliente,
            solicitud_id,
            gps_precision_metros
        ];

        const resultado = await db.query(query, params);
        return resultado.rows[0];
    }

    /**
     * Actualizar un domicilio existente
     * @param {number} id - ID del domicilio
     * @param {Object} datos - Datos a actualizar
     * @param {Object|null} dbClient - Cliente de transacción opcional
     * @returns {Promise<Object>} Domicilio actualizado
     */
    static async actualizar(id, datos, dbClient = null) {
        const db = dbClient || pool;
        const {
            alias,
            tipo_lugar,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            coordenadas_validadas,
            es_predeterminado,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta,
            origen_carga,
            verificado_por_cliente,
            fecha_verificacion_cliente,
            solicitud_id,
            gps_precision_metros
        } = datos;

        const domicilioActual = await this.obtenerPorId(id);
        if (!domicilioActual) {
            throw new Error('Domicilio no encontrado');
        }

        if (es_predeterminado) {
            const refCliente = domicilioActual.bunker_cliente_id || domicilioActual.id_cliente;
            const ident = await this.resolverIdentidadCliente(refCliente);
            const filtro = this._construirFiltroClienteSql(ident, 1);
            if (filtro.clause !== '1=0') {
                await db.query(
                    `UPDATE clientes_domicilios cd SET es_predeterminado = FALSE WHERE (${filtro.clause}) AND cd.id != $${filtro.nextIndex}`,
                    [...filtro.params, id]
                );
            }
        }

        const query = `
            UPDATE clientes_domicilios SET
                alias = COALESCE($1, alias),
                tipo_lugar = COALESCE($2, tipo_lugar),
                direccion = COALESCE($3, direccion),
                localidad = COALESCE($4, localidad),
                provincia = COALESCE($5, provincia),
                codigo_postal = COALESCE($6, codigo_postal),
                latitud = COALESCE($7, latitud),
                longitud = COALESCE($8, longitud),
                coordenadas_validadas = COALESCE($9, coordenadas_validadas),
                es_predeterminado = COALESCE($10, es_predeterminado),
                telefono_contacto = COALESCE($11, telefono_contacto),
                instrucciones_entrega = COALESCE($12, instrucciones_entrega),
                horario_atencion_desde = COALESCE($13, horario_atencion_desde),
                horario_atencion_hasta = COALESCE($14, horario_atencion_hasta),
                origen_carga = COALESCE($15, origen_carga),
                verificado_por_cliente = COALESCE($16, verificado_por_cliente),
                fecha_verificacion_cliente = COALESCE($17, fecha_verificacion_cliente),
                solicitud_id = COALESCE($18, solicitud_id),
                gps_precision_metros = COALESCE($19, gps_precision_metros),
                fecha_modificacion = NOW()
            WHERE id = $20
            RETURNING *
        `;

        const params = [
            alias ?? null,
            tipo_lugar ?? null,
            direccion ?? null,
            localidad ?? null,
            provincia ?? null,
            codigo_postal ?? null,
            latitud ?? null,
            longitud ?? null,
            coordenadas_validadas ?? null,
            es_predeterminado ?? null,
            telefono_contacto ?? null,
            instrucciones_entrega ?? null,
            horario_atencion_desde ?? null,
            horario_atencion_hasta ?? null,
            origen_carga ?? null,
            verificado_por_cliente ?? null,
            fecha_verificacion_cliente ?? null,
            solicitud_id ?? null,
            gps_precision_metros ?? null,
            id
        ];

        const resultado = await db.query(query, params);
        return resultado.rows[0];
    }

    /**
     * Eliminar un domicilio (soft delete)
     * @param {number} id - ID del domicilio
     * @returns {Promise<boolean>} True si se eliminó correctamente
     */
    static async eliminar(id) {
        const query = `
            UPDATE clientes_domicilios 
            SET activo = FALSE, fecha_modificacion = NOW()
            WHERE id = $1
            RETURNING id
        `;

        const resultado = await pool.query(query, [id]);
        return resultado.rowCount > 0;
    }

    /**
     * Verificar si un cliente existe
     * @param {string|number} id_cliente - ID del cliente
     * @returns {Promise<boolean>} True si existe
     */
    static async clienteExiste(id_cliente) {
        const ident = await this.resolverIdentidadCliente(id_cliente);
        return Boolean(ident.bunkerClienteId || ident.legacyClientesPk);
    }

    /**
     * Validar coordenadas (rango Argentina)
     * @param {number} latitud - Latitud
     * @param {number} longitud - Longitud
     * @returns {boolean} True si las coordenadas son válidas
     */
    static validarCoordenadasArgentina(latitud, longitud) {
        return (
            Number.isFinite(latitud) &&
            Number.isFinite(longitud) &&
            latitud >= -55 && latitud <= -21 &&
            longitud >= -73 && longitud <= -53
        );
    }
}

module.exports = DomiciliosModel;
