const pool = require('../config/database');

/**
 * Determina si un artículo interno pertenece a la Línea de Negocio 3 (Artículo Puente / Mix a Granel)
 * o a la Línea de Negocio 2 (Fraccionado Comercial).
 */
async function determinarLineaNegocioArticuloInterno(articuloNumero, dbConnection = null) {
    try {
        const db = dbConnection || pool;
        const query = `
            SELECT 
                a.numero,
                COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, '') as descripcion,
                ba.familia_id,
                EXISTS (
                    SELECT 1 FROM public.recetas r2
                    JOIN public.receta_ingredientes ri2 ON ri2.receta_id = r2.id
                    JOIN public.ingrediente_composicion ic ON ic.mix_id = ri2.ingrediente_id
                    WHERE r2.articulo_numero = a.numero
                ) as tiene_ingrediente_compuesto,
                EXISTS (
                    SELECT 1 FROM public.recetas r3
                    WHERE r3.articulo_sugerido_numero = a.numero
                ) as es_articulo_sugerido
            FROM public.articulos a
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
            WHERE a.numero = $1
            LIMIT 1
        `;
        const res = await db.query(query, [articuloNumero]);
        if (res.rows.length === 0) return 2;
        const row = res.rows[0];
        const descUp = (row.descripcion || '').toUpperCase();
        if (
            row.es_articulo_sugerido === true ||
            row.tiene_ingrediente_compuesto === true ||
            descUp.includes('PROD AP INTERNO') ||
            descUp.startsWith('MEZCLA ') ||
            (Number(row.familia_id) === 42 && !descUp.includes('PROD AP EXT'))
        ) {
            return 3;
        }
        return 2;
    } catch (e) {
        console.warn('No se pudo determinar línea de negocio del artículo interno:', e.message);
        return 2;
    }
}

function obtenerNombreLineaNegocio(lineaNum) {
    if (lineaNum === 2) return 'Producción de Fracciones';
    if (lineaNum === 3) return 'Producción de Artículos Puente (Mixes)';
    if (lineaNum === 4) return 'Producción de Tostadero';
    if (lineaNum === 5) return 'Producción de Barritas';
    if (lineaNum === 6) return 'Producción de Granolas';
    return null;
}

/**
 * Crea un nuevo carro de producción para el usuario especificado
 * @param {number} usuarioId - ID del usuario que crea el carro
 * @param {boolean} enAuditoria - Indica si el carro está en auditoría
 * @returns {Promise<number>} ID del carro creado
 */
async function crearCarro(usuarioId, enAuditoria = true, tipoCarro = 'interna', lineaNegocio = null) {
    try {
        let lineaNum = null;
        let lineaNom = null;
        if (lineaNegocio) {
            lineaNum = parseInt(lineaNegocio, 10);
            lineaNom = obtenerNombreLineaNegocio(lineaNum);
        }

        const query = `
            INSERT INTO carros_produccion (
                usuario_id, 
                fecha_inicio, 
                en_auditoria,
                fecha_preparado,
                tipo_carro,
                linea_negocio,
                nombre_linea_negocio
            )
            VALUES ($1, CURRENT_TIMESTAMP, $2, NULL, $3, $4, $5)
            RETURNING id
        `;
        
        const result = await pool.query(query, [usuarioId, enAuditoria, tipoCarro, lineaNum, lineaNom]);
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
 * @param {Object} db - Conexión de base de datos (opcional, usa pool por defecto)
 * @returns {Promise<boolean>}
 */
async function validarPropiedadCarro(carroId, usuarioId, db = null) {
    try {
        const query = `
            SELECT COUNT(*)::integer AS count 
            FROM carros_produccion 
            WHERE id = $1 AND usuario_id = $2
        `;
        const dbConnection = db || pool;
        const result = await dbConnection.query(query, [carroId, usuarioId]);
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
        // Verificar si el artículo ya existe en el carro
        const checkQuery = `
            SELECT COUNT(*)::integer AS count
            FROM carros_articulos
            WHERE carro_id = $1 AND articulo_numero = $2
        `;
        const checkResult = await pool.query(checkQuery, [carroId, articuloNumero]);
        if (checkResult.rows[0].count > 0) {
            throw new Error('Este artículo ya fue agregado al carro');
        }

        const query = `
            INSERT INTO carros_articulos (carro_id, articulo_numero, descripcion, cantidad)
            VALUES ($1, $2, $3, $4)
        `;
        
        await pool.query(query, [carroId, articuloNumero, descripcion, cantidad]);

        // Si el carro es interno y aún no tiene linea_negocio asignada, inferirla automáticamente del primer artículo
        const carroRes = await pool.query(`
            SELECT tipo_carro, linea_negocio
            FROM carros_produccion
            WHERE id = $1
        `, [carroId]);
        if (carroRes.rows.length > 0) {
            const cRow = carroRes.rows[0];
            if ((cRow.tipo_carro || 'interna') === 'interna' && !cRow.linea_negocio) {
                const lineaInferida = await determinarLineaNegocioArticuloInterno(articuloNumero, pool);
                const nombreInferido = obtenerNombreLineaNegocio(lineaInferida);
                await pool.query(`
                    UPDATE carros_produccion
                    SET linea_negocio = $1, nombre_linea_negocio = $2
                    WHERE id = $3
                `, [lineaInferida, nombreInferido, carroId]);
            }
        }
    } catch (error) {
        console.error('Error al agregar artículo al carro:', error);
        throw error;
    }
}

/**
 * Obtiene todos los artículos agregados a un carro específico
 * @param {number} carroId - ID del carro de producción
 * @param {number} usuarioId - ID del usuario que solicita los artículos
 * @param {Object} db - Conexión de base de datos (opcional, usa pool por defecto)
 * @returns {Promise<Array>} Lista de artículos en el carro
 */
async function obtenerArticulosDeCarro(carroId, usuarioId, db = null) {
    try {
        const dbConnection = db || pool;
        
        // Primero validar que el carro pertenezca al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId, dbConnection);
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
        
        const result = await dbConnection.query(query, [carroId]);
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
                cp.tipo_carro,
                cp.linea_negocio,
                cp.nombre_linea_negocio,
                cp.fecha_preparado,
                cp.fecha_confirmacion,
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
 * Elimina un carro de producción y todos sus registros relacionados
 * Utiliza el módulo especializado para eliminación segura
 * @param {number} carroId - ID del carro a eliminar
 * @param {number} usuarioId - ID del usuario que intenta eliminar el carro
 * @returns {Promise<Object>} Resultado de la eliminación
 */
async function eliminarCarro(carroId, usuarioId) {
    // Delegar la eliminación al módulo especializado
    const { eliminarCarroCompleto } = require('./eliminarCarro');
    return await eliminarCarroCompleto(carroId, usuarioId);
}

/**
 * Obtiene información sobre qué registros se eliminarán con un carro
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Object>} Información detallada de eliminación
 */
async function obtenerInfoEliminacion(carroId, usuarioId) {
    const { obtenerInformacionEliminacion } = require('./eliminarCarro');
    return await obtenerInformacionEliminacion(carroId, usuarioId);
}

async function eliminarArticuloDeCarro(carroId, articuloId, usuarioId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Validar que el carro pertenece al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Consultar si el artículo es padre y tiene artículo hijo vinculado
        const relacionQuery = `
            SELECT articulo_kilo_codigo
            FROM articulos_produccion_externa_relacion
            WHERE articulo_produccion_codigo = $1
        `;
        const relacionResult = await client.query(relacionQuery, [articuloId]);
        const articuloHijo = relacionResult.rows.length > 0 ? relacionResult.rows[0].articulo_kilo_codigo : null;

        // Eliminar artículo padre
        const articuloIdLimpio = articuloId.trim();
        const eliminarPadreQuery = `
            DELETE FROM carros_articulos
            WHERE carro_id = $1 AND articulo_numero = $2
        `;
        const resultDelete = await client.query(eliminarPadreQuery, [carroId, articuloIdLimpio]);
        
        if (resultDelete.rowCount === 0) {
            throw new Error(`Inconsistencia: El artículo ${articuloIdLimpio} no existía en el carro o falló el borrado interno.`);
        }

        // Si hay artículo hijo vinculado, eliminarlo también
        if (articuloHijo) {
            const eliminarHijoQuery = `
                DELETE FROM carros_articulos
                WHERE carro_id = $1 AND articulo_numero = $2
            `;
            await client.query(eliminarHijoQuery, [carroId, articuloHijo]);
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar artículo del carro:', error);
        throw new Error('No se pudo eliminar el artículo del carro');
    } finally {
        client.release();
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
    obtenerArticulosDeCarro,
    validarPropiedadCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro,
    eliminarArticuloDeCarro,
    modificarCantidadDeArticulo,
    obtenerInfoEliminacion
};
