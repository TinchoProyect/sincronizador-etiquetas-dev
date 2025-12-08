/**
 * Modelo de Domicilios
 * Capa de acceso a datos para la tabla clientes_domicilios
 */

const { pool } = require('../config/database');

class DomiciliosModel {
    
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
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (id_cliente) {
            query += ` AND cd.id_cliente = $${paramIndex}`;
            params.push(parseInt(id_cliente));
            paramIndex++;
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
        
        query += ` ORDER BY cd.es_predeterminado DESC, cd.alias ASC`;
        
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
        
        // Si es predeterminado, desmarcar otros domicilios del mismo cliente
        if (es_predeterminado) {
            await pool.query(
                'UPDATE clientes_domicilios SET es_predeterminado = FALSE WHERE id_cliente = $1',
                [id_cliente]
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
            es_predeterminado,
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
            await pool.query(
                'UPDATE clientes_domicilios SET es_predeterminado = FALSE WHERE id_cliente = $1 AND id != $2',
                [domicilioActual.id_cliente, id]
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
     * Verificar si un cliente existe
     * @param {string} id_cliente - ID del cliente (TEXT)
     * @returns {Promise<boolean>} True si existe
     */
    static async clienteExiste(id_cliente) {
        const query = 'SELECT id FROM clientes WHERE id = $1';
        const resultado = await pool.query(query, [parseInt(id_cliente)]);
        return resultado.rowCount > 0;
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
