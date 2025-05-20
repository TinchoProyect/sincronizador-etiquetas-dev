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
 * @returns {Promise<Array>} Lista de artículos en el carro
 */
async function obtenerArticulosDeCarro(carroId) {
    try {
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

module.exports = {
    crearCarro,
    agregarArticulo,
    obtenerArticulos,
    obtenerArticulosDeCarro
};
