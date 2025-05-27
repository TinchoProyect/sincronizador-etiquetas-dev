const pool = require('../config/database');

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
            SELECT COUNT(*)::integer AS count 
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
        console.log('Iniciando obtención de artículos...');
        
        const query = `
            SELECT 
                a.numero,
                a.nombre,
                a.codigo_barras
            FROM public.articulos a
            ORDER BY a.nombre ASC
        `;
        
        console.log('Ejecutando query:', query);
        const result = await pool.query(query);
        
        console.log(`Se encontraron ${result.rows.length} artículos`);
        if (result.rows.length === 0) {
            console.log('La consulta no retornó resultados. Verificar la tabla articulos.');
        } else {
            console.log('Muestra del primer artículo:', result.rows[0]);
        }
        
        return result.rows;
    } catch (error) {
        console.error('Error detallado al obtener artículos:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        
        if (error.code === '42P01') {
            throw new Error('La tabla articulos no existe en la base de datos');
        }
        
        throw new Error(`No se pudo obtener la lista de artículos: ${error.message}`);
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
            LEFT JOIN public.articulos a ON a.numero = ca.articulo_numero
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
        await pool.query('DELETE FROM carros_produccion WHERE id = $1', [carroId]);
        
        return true;
    } catch (error) {
        console.error('Error al eliminar carro:', error);
        throw new Error('No se pudo eliminar el carro');
    }
}

async function eliminarArticuloDeCarro(carroId, articuloId, usuarioId) {
    try {
        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Eliminar el artículo del carro
        const query = `
            DELETE FROM carros_articulos
            WHERE carro_id = $1 AND articulo_numero = $2
        `;
        await pool.query(query, [carroId, articuloId]);
    } catch (error) {
        console.error('Error al eliminar artículo del carro:', error);
        throw new Error('No se pudo eliminar el artículo del carro');
    }
}

/**
 * Modifica la cantidad de un artículo en un carro específico
 * @param {number} carroId - ID del carro
 * @param {string} articuloId - ID del artículo
 * @param {number} usuarioId - ID del usuario
 * @param {number} cantidad - Nueva cantidad del artículo
 * @returns {Promise<void>}
 */
async function modificarCantidadDeArticulo(carroId, articuloId, usuarioId, cantidad) {
    try {
        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Actualizar la cantidad del artículo
        const query = `
            UPDATE carros_articulos
            SET cantidad = $1
            WHERE carro_id = $2 AND articulo_numero = $3
        `;
        
        const result = await pool.query(query, [cantidad, carroId, articuloId]);
        
        if (result.rowCount === 0) {
            throw new Error('No se encontró el artículo en el carro');
        }
    } catch (error) {
        console.error('Error al modificar cantidad del artículo:', error);
        throw new Error('No se pudo modificar la cantidad del artículo');
    }
}

module.exports = {
    crearCarro,
    agregarArticulo,
    obtenerArticulos,
    obtenerArticulosDeCarro,
    validarPropiedadCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro,
    eliminarArticuloDeCarro,
    modificarCantidadDeArticulo
};
