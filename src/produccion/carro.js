const pool = require('../usuarios/pool');

/**
 * Crea un nuevo carro de producción para el usuario especificado
 * @param {number} usuarioId - ID del usuario que crea el carro
 * @param {boolean} enAuditoria - Indica si el carro está en auditoría
 * @returns {Promise<number>} ID del carro creado
 */
async function crearCarro(usuarioId, enAuditoria = true) {
    try {
        const query = `
            INSERT INTO carros_produccion (usuario_id, fecha_inicio, en_auditoria)
            VALUES ($1, CURRENT_TIMESTAMP, $2)
            RETURNING id
        `;
        
        const result = await pool.query(query, [usuarioId, enAuditoria]);
        return result.rows[0].id;
    } catch (error) {
        console.error('Error al crear carro de producción:', error);
        throw new Error('No se pudo crear el carro de producción');
    }
}

/**
 * Valida si un carro pertenece a un usuario específico
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<boolean>}
 */
async function validarPropiedadCarro(carroId, usuarioId) {
    try {
        const query = `
            SELECT COUNT(*) as count 
            FROM carros_produccion 
            WHERE id = $1 AND usuario_id = $2
        `;
        const result = await pool.query(query, [carroId, usuarioId]);
        return result.rows[0].count > 0;
    } catch (error) {
        console.error('Error al validar propiedad del carro:', error);
        return false;
    }
}

/**
 * Agrega un artículo al carro de producción especificado
 * @param {number} carroId - ID del carro de producción
 * @param {string} articuloNumero - Código del artículo
 * @param {string} descripcion - Descripción del artículo
 * @param {number} cantidad - Cantidad del artículo
 * @returns {Promise<void>}
 */
async function agregarArticulo(carroId, articuloNumero, descripcion, cantidad) {
    try {
        const query = `
            INSERT INTO carros_articulos (carro_id, articulo_numero, descripcion, cantidad)
            VALUES ($1, $2, $3, $4)
        `;
        
        await pool.query(query, [carroId, articuloNumero, descripcion, cantidad]);
    } catch (error) {
        console.error('Error al agregar artículo al carro:', error);
        throw new Error('No se pudo agregar el artículo al carro');
    }
}

/**
 * Obtiene la lista de todos los artículos disponibles
 * @returns {Promise<Array>} Lista de artículos
 */
async function obtenerArticulos() {
    try {
        const query = `
            SELECT 
                numero,
                nombre,
                codigo_barras
            FROM articulos
            ORDER BY nombre ASC
        `;
        
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error al obtener artículos:', error);
        throw new Error('No se pudo obtener la lista de artículos');
    }
}

/**
 * Obtiene todos los artículos agregados a un carro específico
 * @param {number} carroId - ID del carro de producción
 * @param {number} usuarioId - ID del usuario que solicita los artículos
 * @returns {Promise<Array>} Lista de artículos en el carro
 */
async function obtenerArticulosDeCarro(carroId, usuarioId) {
    try {
        // Primero validar que el carro pertenezca al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        const query = `
            SELECT 
                ca.articulo_numero as numero,
                ca.descripcion,
                a.codigo_barras,
                ca.cantidad
            FROM carros_articulos ca
            LEFT JOIN articulos a ON a.numero = ca.articulo_numero
            WHERE ca.carro_id = $1
            ORDER BY ca.id DESC
        `;
        
        const result = await pool.query(query, [carroId]);
        return result.rows;
    } catch (error) {
        console.error('Error al obtener artículos del carro:', error);
        throw new Error('No se pudo obtener la lista de artículos del carro');
    }
}

/**
 * Obtiene todos los carros de producción de un usuario específico
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Array>} Lista de carros del usuario
 */
async function obtenerCarrosDeUsuario(usuarioId) {
    try {
        const query = `
            SELECT 
                cp.id,
                cp.fecha_inicio,
                cp.en_auditoria,
                (SELECT COUNT(*) FROM carros_articulos ca WHERE ca.carro_id = cp.id) as total_articulos
            FROM carros_produccion cp
            WHERE cp.usuario_id = $1
            ORDER BY cp.fecha_inicio DESC
        `;
        
        const result = await pool.query(query, [usuarioId]);
        return result.rows;
    } catch (error) {
        console.error('Error al obtener carros del usuario:', error);
        throw new Error('No se pudo obtener la lista de carros');
    }
}

/**
 * Elimina un carro de producción y sus artículos asociados
 * @param {number} carroId - ID del carro a eliminar
 * @param {number} usuarioId - ID del usuario que intenta eliminar el carro
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
async function eliminarCarro(carroId, usuarioId) {
    try {
        // Primero validar que el carro pertenezca al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Eliminar primero los artículos del carro
        await pool.query('DELETE FROM carros_articulos WHERE carro_id = $1', [carroId]);
        
        // Luego eliminar el carro
        await pool.query('DELETE FROM carros_produccion WHERE id = $1 AND usuario_id = $2', [carroId, usuarioId]);
        
        return true;
    } catch (error) {
        console.error('Error al eliminar carro:', error);
        throw new Error('No se pudo eliminar el carro');
    }
}

module.exports = {
    crearCarro,
    agregarArticulo,
    obtenerArticulos,
    obtenerArticulosDeCarro,
    validarPropiedadCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro
};
