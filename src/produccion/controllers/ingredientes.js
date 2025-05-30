const pool = require('../config/database');

/**
 * Obtiene todos los ingredientes
 * @returns {Promise<Array>} Lista de ingredientes
 */
async function obtenerIngredientes() {
    try {
        console.log('Ejecutando consulta de ingredientes...');
        const query = `
            SELECT 
                id,
                nombre,
                descripcion,
                unidad_medida,
                categoria,
                stock_actual
            FROM ingredientes
            ORDER BY nombre ASC;
        `;
        
        const result = await pool.query(query);
        console.log(`Encontrados ${result.rows.length} ingredientes`);
        return result.rows;
    } catch (error) {
        console.error('Error en obtenerIngredientes:', error);
        throw new Error('No se pudo obtener la lista de ingredientes');
    }
}

/**
 * Obtiene un ingrediente por su ID
 * @param {number} id - ID del ingrediente
 * @returns {Promise<Object>} Datos del ingrediente
 */
async function obtenerIngrediente(id) {
    try {
        const query = `
            SELECT 
                id,
                nombre,
                descripcion,
                unidad_medida,
                categoria,
                stock_actual
            FROM ingredientes
            WHERE id = $1;
        `;
        
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            throw new Error('Ingrediente no encontrado');
        }
        return result.rows[0];
    } catch (error) {
        console.error('Error en obtenerIngrediente:', error);
        throw new Error('No se pudo obtener el ingrediente');
    }
}

/**
 * Crea un nuevo ingrediente
 * @param {Object} datos - Datos del ingrediente
 * @returns {Promise<Object>} Ingrediente creado
 */
async function crearIngrediente(datos) {
    try {
        const { nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id } = datos;
        
        const query = `
            INSERT INTO ingredientes (
                nombre,
                descripcion,
                unidad_medida,
                categoria,
                stock_actual,
                padre_id
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        
        const values = [nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id];
        const result = await pool.query(query, values);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error en crearIngrediente:', error);
        throw new Error('No se pudo crear el ingrediente');
    }
}


/**
 * Actualiza un ingrediente existente
 * @param {number} id - ID del ingrediente
 * @param {Object} datos - Nuevos datos del ingrediente
 * @returns {Promise<Object>} Ingrediente actualizado
 */
async function actualizarIngrediente(id, datos) {
    try {
        const existing = await obtenerIngrediente(id);
        const nombre = (datos.nombre === undefined) ? existing.nombre : datos.nombre;
        const descripcion = (datos.descripcion === undefined) ? existing.descripcion : datos.descripcion;
        const unidad_medida = (datos.unidad_medida === undefined) ? existing.unidad_medida : datos.unidad_medida;
        const categoria = (datos.categoria === undefined) ? existing.categoria : datos.categoria;
        const stock_actual = (datos.stock_actual === undefined) ? existing.stock_actual : datos.stock_actual;
        const padre_id = (datos.padre_id === undefined) ? existing.padre_id : datos.padre_id;

        
        const query = `
            UPDATE ingredientes
            SET nombre = $1,
                descripcion = $2,
                unidad_medida = $3,
                categoria = $4,
                stock_actual = $5,
                padre_id = $6
            WHERE id = $7
            RETURNING *;
        `;
        
        const values = [nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id, id];
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            throw new Error('Ingrediente no encontrado');
        }
        
        return result.rows[0];
    } catch (error) {
        console.error('Error en actualizarIngrediente:', error);
        throw new Error('No se pudo actualizar el ingrediente');
    }
}


/**
 * Elimina un ingrediente
 * @param {number} id - ID del ingrediente a eliminar
 * @returns {Promise<void>}
 */
async function eliminarIngrediente(id) {
    try {
        const query = 'DELETE FROM ingredientes WHERE id = $1 RETURNING id;';
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            throw new Error('Ingrediente no encontrado');
        }
    } catch (error) {
        console.error('Error en eliminarIngrediente:', error);
        throw new Error('No se pudo eliminar el ingrediente');
    }
}

module.exports = {
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente
};
