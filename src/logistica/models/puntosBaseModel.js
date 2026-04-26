/**
 * Modelo de Puntos Base (Nodos Cero)
 * Capa de acceso a datos para la tabla puntos_base
 */

const { pool } = require('../config/database');

class PuntosBaseModel {
    /**
     * Obtener todos los puntos base activos
     * @returns {Promise<Array>} Lista de puntos base
     */
    static async obtenerTodos() {
        const query = `
            SELECT id, nombre, alias, latitud, longitud, radio_tolerancia_metros, activo
            FROM puntos_base
            WHERE activo = true
            ORDER BY nombre ASC
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    /**
     * Obtener un punto base por ID
     * @param {number} id - ID del punto base
     * @returns {Promise<Object|null>}
     */
    static async obtenerPorId(id) {
        const query = `
            SELECT id, nombre, alias, latitud, longitud, radio_tolerancia_metros, activo
            FROM puntos_base
            WHERE id = $1
        `;
        const result = await pool.query(query, [id]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Crear un nuevo punto base
     * @param {Object} datos - Datos del punto base
     * @returns {Promise<Object>}
     */
    static async crear(datos) {
        const { nombre, alias, latitud, longitud, radio_tolerancia_metros } = datos;
        const query = `
            INSERT INTO puntos_base (nombre, alias, latitud, longitud, radio_tolerancia_metros, activo)
            VALUES ($1, $2, $3, $4, COALESCE($5, 50), true)
            RETURNING *
        `;
        const result = await pool.query(query, [nombre, alias, latitud, longitud, radio_tolerancia_metros]);
        return result.rows[0];
    }

    /**
     * Actualizar un punto base
     * @param {number} id - ID
     * @param {Object} datos - Nuevos datos
     * @returns {Promise<Object>}
     */
    static async actualizar(id, datos) {
        const { nombre, alias, latitud, longitud, radio_tolerancia_metros, activo } = datos;
        const query = `
            UPDATE puntos_base SET
                nombre = COALESCE($1, nombre),
                alias = COALESCE($2, alias),
                latitud = COALESCE($3, latitud),
                longitud = COALESCE($4, longitud),
                radio_tolerancia_metros = COALESCE($5, radio_tolerancia_metros),
                activo = COALESCE($6, activo)
            WHERE id = $7
            RETURNING *
        `;
        const result = await pool.query(query, [nombre, alias, latitud, longitud, radio_tolerancia_metros, activo, id]);
        return result.rows[0];
    }

    /**
     * Eliminar (Soft Delete) un punto base
     * @param {number} id - ID
     */
    static async eliminar(id) {
        const query = `UPDATE puntos_base SET activo = false WHERE id = $1 RETURNING *`;
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }
}

module.exports = PuntosBaseModel;
