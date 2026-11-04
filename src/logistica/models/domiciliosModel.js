/**
 * Modelo de Domicilios
 * Capa de acceso a datos para la tabla clientes_domicilios
 */

const { pool } = require('../config/database');

class DomiciliosModel {
    
    /**
     * Obtener todos los IDs posibles asociados a un cliente (bunker_clientes.id, lomas_soft_id, clientes.id, clientes.cliente_id)
     * @param {string|number} id_cliente - ID, código búnker o ID legacy del cliente
     * @returns {Promise<{intIds: number[], strIds: string[]}>} Lista de IDs numéricos y cadenas
     */
    /**
     * Obtener estrictamente los IDs propios asociados a UN cliente Búnker (su lomas_soft_id o su bunker_clientes.id si no tiene legacy)
     * para evitar cualquier cruzamiento con otros clientes legacy que compartan la misma secuencia de PK.
     * @param {string|number} id_cliente - ID interno (PK), código Búnker o ID legacy (lomas_soft_id)
     * @returns {Promise<{intIds: number[], strIds: string[]}>} Colección estricta de IDs propios del cliente
     */
    static async obtenerTodosLosIdsCliente(id_cliente) {
        if (id_cliente === undefined || id_cliente === null) {
            return { intIds: [], strIds: [] };
        }

        const rawStr = String(id_cliente).trim();
        if (!rawStr) return { intIds: [], strIds: [] };

        const intVal = parseInt(rawStr, 10);
        const hasInt = !isNaN(intVal);

        const bunkerIds = new Set();
        const legacyIds = new Set();
        const lomasSoftIds = new Set();

        // 1. Intentar buscar en bunker_clientes por ID primario o código de Búnker
        let queryBunker = `
            SELECT id, codigo_bunker_cliente, lomas_soft_id 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1
        `;
        const paramsBunker = [rawStr];
        if (hasInt) {
            queryBunker += ` OR id = $2`;
            paramsBunker.push(intVal);
        }

        let encontradoBunkerDirecto = false;
        try {
            const resBunker = await pool.query(queryBunker, paramsBunker);
            if (resBunker.rowCount > 0) {
                encontradoBunkerDirecto = true;
                resBunker.rows.forEach(r => {
                    if (r.id) bunkerIds.add(parseInt(r.id, 10));
                    if (r.lomas_soft_id) {
                        const cleanLomas = r.lomas_soft_id.trim();
                        lomasSoftIds.add(cleanLomas);
                        const lomasInt = parseInt(cleanLomas, 10);
                        if (!isNaN(lomasInt)) lomasSoftIds.add(String(lomasInt));
                    }
                });
            }
        } catch (e) {
            console.error('[DOMICILIOS-MODEL] Error al consultar bunker_clientes por PK:', e.message);
        }

        // 2. Si se encontró por PK de Búnker, buscar en legacy clientes ÚNICAMENTE usando los lomasSoftIds resueltos
        if (encontradoBunkerDirecto) {
            if (lomasSoftIds.size > 0) {
                try {
                    const arrLomas = Array.from(lomasSoftIds);
                    const queryLegacy = `
                        SELECT id, cliente_id 
                        FROM clientes 
                        WHERE cliente_id::text = ANY($1::text[])
                           OR cliente_id::text = ANY(SELECT ltrim(x, '0') FROM unnest($1::text[]) x)
                    `;
                    const resLegacy = await pool.query(queryLegacy, [arrLomas]);
                    resLegacy.rows.forEach(r => {
                        if (r.id) legacyIds.add(parseInt(r.id, 10));
                        if (r.cliente_id) {
                            const cleanCId = String(r.cliente_id).trim();
                            lomasSoftIds.add(cleanCId);
                            const cleanCIdInt = parseInt(cleanCId, 10);
                            if (!isNaN(cleanCIdInt)) lomasSoftIds.add(String(cleanCIdInt));
                        }
                    });
                } catch (e) {
                    console.error('[DOMICILIOS-MODEL] Error al consultar clientes legacy por lomasSoftId:', e.message);
                }
            }
        } else {
            // 3. Si no se encontró por Búnker directo, el input es un identificador legacy (PK o cliente_id)
            try {
                const queryLegacy = `
                    SELECT id, cliente_id 
                    FROM clientes 
                    WHERE id = $1 OR cliente_id = $1 OR cliente_id::text = $2
                `;
                const paramsLegacy = [hasInt ? intVal : -1, rawStr];
                const resLegacy = await pool.query(queryLegacy, paramsLegacy);
                resLegacy.rows.forEach(r => {
                    if (r.id) legacyIds.add(parseInt(r.id, 10));
                    if (r.cliente_id) {
                        const cleanCId = String(r.cliente_id).trim();
                        lomasSoftIds.add(cleanCId);
                        const cleanCIdInt = parseInt(cleanCId, 10);
                        if (!isNaN(cleanCIdInt)) lomasSoftIds.add(String(cleanCIdInt));
                    }
                });
            } catch (e) {
                console.error('[DOMICILIOS-MODEL] Error al consultar clientes legacy por ID legacy:', e.message);
            }

            // Mapear de vuelta a bunker_clientes
            if (lomasSoftIds.size > 0) {
                try {
                    const arrLomas = Array.from(lomasSoftIds);
                    const resBunkerBack = await pool.query(
                        `SELECT id, lomas_soft_id 
                         FROM public.bunker_clientes 
                         WHERE lomas_soft_id = ANY($1::text[]) 
                            OR (lomas_soft_id ~ '^[0-9]+$' AND lomas_soft_id::integer = ANY($2::int[]))`,
                        [arrLomas, arrLomas.map(x => parseInt(x, 10)).filter(x => !isNaN(x))]
                    );
                    resBunkerBack.rows.forEach(r => {
                        if (r.id) bunkerIds.add(parseInt(r.id, 10));
                    });
                } catch (e) {
                    console.error('[DOMICILIOS-MODEL] Error en retro-búsqueda bunker_clientes:', e.message);
                }
            }
        }

        const intIdsSet = new Set();
        const strIdsSet = new Set();

        bunkerIds.forEach(id => {
            intIdsSet.add(id);
            strIdsSet.add(String(id));
        });
        legacyIds.forEach(id => {
            intIdsSet.add(id);
            strIdsSet.add(String(id));
        });

        intIdsSet.add(intVal);
        strIdsSet.add(rawStr);

        return {
            intIds: Array.from(intIdsSet).filter(x => !isNaN(x)),
            strIds: Array.from(strIdsSet).filter(Boolean)
        };
    }

    /**
     * Obtener ID interno del cliente para relaciones de base de datos
     * @param {string|number} id_cliente - ID del cliente (puede ser cliente_id, codigo_bunker_cliente, etc.)
     * @returns {Promise<number|null>} ID interno del cliente
     */
    static async obtenerIdInternoCliente(id_cliente) {
        if (id_cliente === undefined || id_cliente === null) return null;
        
        const rawStr = String(id_cliente).trim();
        if (!rawStr) return null;
        
        const clienteIdInt = parseInt(rawStr, 10);
        
        // 1. Buscar en public.bunker_clientes (por id, codigo_bunker_cliente o lomas_soft_id)
        let queryBunker = `
            SELECT id, lomas_soft_id 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente = $1 
               OR lomas_soft_id = $1
        `;
        const paramsBunker = [rawStr];
        if (!isNaN(clienteIdInt)) {
            queryBunker += ` OR id = $2 OR (lomas_soft_id ~ '^[0-9]+$' AND lomas_soft_id::integer = $2)`;
            paramsBunker.push(clienteIdInt);
        }

        try {
            const resBunker = await pool.query(queryBunker, paramsBunker);
            if (resBunker.rowCount > 0) {
                const r = resBunker.rows[0];
                return r.id;
            }
        } catch (e) {
            console.error('[DOMICILIOS-MODEL] Error al consultar bunker_clientes en obtenerIdInternoCliente:', e.message);
        }

        // 2. Buscar en clientes legacy si no está en bunker_clientes
        if (!isNaN(clienteIdInt)) {
            try {
                const resLegacy = await pool.query('SELECT id, cliente_id FROM clientes WHERE id = $1 OR cliente_id = $1', [clienteIdInt]);
                if (resLegacy.rowCount > 0) {
                    return resLegacy.rows[0].cliente_id || resLegacy.rows[0].id;
                }
            } catch (e) {
                console.error('[DOMICILIOS-MODEL] Error al consultar clientes legacy en obtenerIdInternoCliente:', e.message);
            }
            // Fallback de resguardo: retornar el ID numérico recibido
            return clienteIdInt;
        }

        return null;
    }

    /**
     * Obtener todos los domicilios con filtros opcionales
     * @param {Object} filtros - Filtros de búsqueda
     * @returns {Promise<Array>} Lista de domicilios
     */
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
                (
                    SELECT COALESCE(bc.cliente_nombre, c.nombre)
                    FROM public.bunker_clientes bc 
                    LEFT JOIN clientes c ON c.cliente_id::text = bc.lomas_soft_id
                    WHERE bc.id = cd.id_cliente 
                       OR (bc.lomas_soft_id ~ '^[0-9]+$' AND cd.id_cliente = bc.lomas_soft_id::integer)
                    LIMIT 1
                ) as cliente_nombre,
                cd.alias,
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
                cd.activo,
                cd.fecha_creacion,
                cd.fecha_modificacion
            FROM clientes_domicilios cd
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (id_cliente) {
            const { intIds, strIds } = await this.obtenerTodosLosIdsCliente(id_cliente);
            if (intIds.length > 0 || strIds.length > 0) {
                query += ` AND (cd.id_cliente = ANY($${paramIndex}::int[]) OR cd.id_cliente::text = ANY($${paramIndex + 1}::text[]))`;
                params.push(intIds, strIds);
                paramIndex += 2;
            } else {
                query += ` AND 1=0`;
            }
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
                c.nombre as cliente_nombre,
                cd.alias,
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
                cd.activo,
                cd.fecha_creacion,
                cd.fecha_modificacion
            FROM clientes_domicilios cd
            LEFT JOIN clientes c ON cd.id_cliente = c.id
            WHERE cd.id = $1
        `;
        
        const resultado = await pool.query(query, [id]);
        return resultado.rows[0] || null;
    }
    
    /**
     * Crear un nuevo domicilio
     * @param {Object} datos - Datos del domicilio
     * @returns {Promise<Object>} Domicilio creado
     */
    static async crear(datos) {
        const {
            id_cliente,
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            coordenadas_validadas = false,
            es_predeterminado = false,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        } = datos;
        
        const { intIds, strIds } = await this.obtenerTodosLosIdsCliente(id_cliente);
        let esPredeterminadoFinal = es_predeterminado;
        
        // Si no se especificó predeterminado, verificar si es el primer domicilio activo del cliente
        if (!esPredeterminadoFinal) {
            const countRes = await pool.query(
                'SELECT COUNT(*) FROM clientes_domicilios WHERE (id_cliente = ANY($1::int[]) OR id_cliente::text = ANY($2::text[])) AND activo = TRUE',
                [intIds, strIds]
            );
            if (parseInt(countRes.rows[0].count, 10) === 0) {
                esPredeterminadoFinal = true;
            }
        }
        
        // Si es predeterminado, desmarcar otros domicilios del mismo cliente
        if (esPredeterminadoFinal) {
            await pool.query(
                'UPDATE clientes_domicilios SET es_predeterminado = FALSE WHERE (id_cliente = ANY($1::int[]) OR id_cliente::text = ANY($2::text[]))',
                [intIds, strIds]
            );
        }
        
        const query = `
            INSERT INTO clientes_domicilios (
                id_cliente,
                alias,
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
                activo,
                fecha_creacion,
                fecha_modificacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, NOW(), NOW())
            RETURNING *
        `;
        
        const params = [
            id_cliente,
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            coordenadas_validadas,
            esPredeterminadoFinal,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        ];
        
        const resultado = await pool.query(query, params);
        return resultado.rows[0];
    }
    
    /**
     * Actualizar un domicilio existente
     * @param {number} id - ID del domicilio
     * @param {Object} datos - Datos a actualizar
     * @returns {Promise<Object>} Domicilio actualizado
     */
    static async actualizar(id, datos) {
        const {
            alias,
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
            horario_atencion_hasta
        } = datos;
        
        // Obtener domicilio actual para saber el id_cliente
        const domicilioActual = await this.obtenerPorId(id);
        if (!domicilioActual) {
            throw new Error('Domicilio no encontrado');
        }
        
        // Si se marca como predeterminado, desmarcar otros del mismo cliente
        if (es_predeterminado) {
            const { intIds, strIds } = await this.obtenerTodosLosIdsCliente(domicilioActual.id_cliente);
            await pool.query(
                'UPDATE clientes_domicilios SET es_predeterminado = FALSE WHERE (id_cliente = ANY($1::int[]) OR id_cliente::text = ANY($2::text[])) AND id != $3',
                [intIds, strIds, id]
            );
        }
        
        const query = `
            UPDATE clientes_domicilios SET
                alias = COALESCE($1, alias),
                direccion = COALESCE($2, direccion),
                localidad = COALESCE($3, localidad),
                provincia = COALESCE($4, provincia),
                codigo_postal = COALESCE($5, codigo_postal),
                latitud = COALESCE($6, latitud),
                longitud = COALESCE($7, longitud),
                coordenadas_validadas = COALESCE($8, coordenadas_validadas),
                es_predeterminado = COALESCE($9, es_predeterminado),
                telefono_contacto = COALESCE($10, telefono_contacto),
                instrucciones_entrega = COALESCE($11, instrucciones_entrega),
                horario_atencion_desde = COALESCE($12, horario_atencion_desde),
                horario_atencion_hasta = COALESCE($13, horario_atencion_hasta),
                fecha_modificacion = NOW()
            WHERE id = $14
            RETURNING *
        `;
        
        const params = [
            alias,
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
            id
        ];
        
        const resultado = await pool.query(query, params);
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
     * Verificar si un cliente existe y obtener su ID interno
     * @param {string|number} id_cliente - ID del cliente (puede ser cliente_id o id)
     * @returns {Promise<number|null>} ID interno del cliente o null si no existe
     */
    static async obtenerIdInternoCliente(id_cliente) {
        if (id_cliente === undefined || id_cliente === null) return null;
        
        const rawStr = String(id_cliente).trim();
        if (!rawStr) return null;
        
        const clienteIdInt = parseInt(rawStr, 10);
        
        // 1. Si es numérico, buscar primero en clientes (legacy por id o cliente_id)
        if (!isNaN(clienteIdInt)) {
            const resLegacy = await pool.query('SELECT id FROM clientes WHERE id = $1 OR cliente_id = $1', [clienteIdInt]);
            if (resLegacy.rowCount > 0) {
                return resLegacy.rows[0].id;
            }

            // Buscar en public.bunker_clientes (por id o lomas_soft_id numérico)
            const resBunkerInt = await pool.query(
                "SELECT id FROM public.bunker_clientes WHERE id = $1 OR (lomas_soft_id ~ '^[0-9]+$' AND lomas_soft_id::integer = $1)",
                [clienteIdInt]
            );
            if (resBunkerInt.rowCount > 0) {
                return resBunkerInt.rows[0].id;
            }
        }

        // 2. Si es una cadena (ej: 'CB-0001' o '0745'), buscar en public.bunker_clientes
        const resBunkerStr = await pool.query(
            'SELECT id FROM public.bunker_clientes WHERE codigo_bunker_cliente = $1 OR lomas_soft_id = $1',
            [rawStr]
        );
        if (resBunkerStr.rowCount > 0) {
            return resBunkerStr.rows[0].id;
        }

        console.log(`[DOMICILIOS-MODEL] ⚠️ Cliente "${id_cliente}" no encontrado en ninguna tabla`);
        return null;
    }
    
    /**
     * Verificar si un cliente existe
     * @param {string|number} id_cliente - ID del cliente
     * @returns {Promise<boolean>} True si existe
     */
    static async clienteExiste(id_cliente) {
        const idInterno = await this.obtenerIdInternoCliente(id_cliente);
        return idInterno !== null;
    }
    
    /**
     * Validar coordenadas (rango Argentina)
     * @param {number} latitud - Latitud
     * @param {number} longitud - Longitud
     * @returns {boolean} True si las coordenadas son válidas
     */
    static validarCoordenadasArgentina(latitud, longitud) {
        // Argentina: lat -55 a -21, lng -73 a -53
        return (
            latitud >= -55 && latitud <= -21 &&
            longitud >= -73 && longitud <= -53
        );
    }
}

module.exports = DomiciliosModel;
