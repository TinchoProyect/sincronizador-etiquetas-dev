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
        const { estado, id_chofer, fecha_desde, fecha_hasta } = filtros;
        
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
                COUNT(p.id) as cantidad_presupuestos,
                SUM(CASE WHEN p.estado_logistico = 'ENTREGADO' THEN 1 ELSE 0 END) as presupuestos_entregados
            FROM rutas r
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            LEFT JOIN presupuestos p ON p.id_ruta = r.id
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
        
        query += ` GROUP BY r.id, r.nombre_ruta, r.fecha_salida, r.id_chofer, u.nombre_completo, 
                   r.id_vehiculo, r.estado, r.distancia_total_km, r.tiempo_estimado_min,
                   r.fecha_creacion, r.fecha_finalizacion, r.usuario_creador_id
                   ORDER BY r.fecha_salida DESC, r.id DESC`;
        
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
                r.usuario_creador_id
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
                p.id_cliente,
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
                COALESCE(
                    (SELECT SUM(pd.cantidad * pd.precio1)
                     FROM presupuestos_detalles pd
                     WHERE pd.id_presupuesto = p.id),
                    0
                ) as total
            FROM presupuestos p
            INNER JOIN clientes c ON p.id_cliente = c.cliente_id::text
            LEFT JOIN clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
            WHERE p.id_ruta = $1
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `;
        
        const resultadoPresupuestos = await pool.query(queryPresupuestos, [id]);
        
        ruta.presupuestos = resultadoPresupuestos.rows;
        ruta.total_presupuestos = resultadoPresupuestos.rows.length;
        
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
            
            // Validar que los presupuestos existen y están disponibles
            const presupuestosQuery = await client.query(
                `SELECT id, id_ruta, id_domicilio_entrega, bloqueo_entrega, estado_logistico
                 FROM presupuestos 
                 WHERE id = ANY($1::int[])
                 FOR UPDATE`,
                [ids_presupuestos]
            );
            
            if (presupuestosQuery.rows.length !== ids_presupuestos.length) {
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
                [ids_presupuestos]
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
                [id_ruta, ids_presupuestos]
            );
            
            // Registrar en historial de estados
            // Sanitizar usuario_id para evitar NaN
            const usuario_id_sanitizado = (usuario_id && parseInt(usuario_id)) || 1;
            
            console.log('[RUTAS-MODEL] usuario_id_sanitizado:', usuario_id_sanitizado, 'tipo:', typeof usuario_id_sanitizado);
            
            for (const id_presupuesto of ids_presupuestos) {
                console.log('[RUTAS-MODEL] Insertando historial para presupuesto:', id_presupuesto);
                console.log('  Parámetros INSERT:', [id_presupuesto, JSON.stringify({ id_ruta }), usuario_id_sanitizado]);
                
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
                fecha_finalizacion = CASE WHEN $1 = 'FINALIZADA' THEN NOW() ELSE fecha_finalizacion END
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
