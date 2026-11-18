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
            WITH carros_u AS (
                SELECT
                    cp.id,
                    cp.fecha_inicio,
                    cp.en_auditoria,
                    cp.tipo_carro,
                    cp.linea_negocio,
                    cp.nombre_linea_negocio,
                    cp.fecha_preparado,
                    cp.fecha_confirmacion
                FROM carros_produccion cp
                WHERE cp.usuario_id = $1
            ),
            ba_norm AS (
                SELECT DISTINCT ON (UPPER(BTRIM(ba.articulo_id)))
                    UPPER(BTRIM(ba.articulo_id)) AS cod_norm,
                    NULLIF(BTRIM(ba.descripcion_generada), '') AS desc_gen,
                    NULLIF(BTRIM(ba.descripcion), '') AS desc_base,
                    NULLIF(ba.kilos_unidad, 0) AS kilos_unidad
                FROM bunker_articulos ba
                WHERE ba.articulo_id IS NOT NULL
                ORDER BY UPPER(BTRIM(ba.articulo_id))
            ),
            src_norm AS (
                SELECT DISTINCT ON (UPPER(BTRIM(src.articulo_numero)))
                    UPPER(BTRIM(src.articulo_numero)) AS cod_norm,
                    NULLIF(BTRIM(src.descripcion), '') AS desc_src,
                    NULLIF(src.kilos_unidad, 0) AS kilos_unidad
                FROM stock_real_consolidado src
                WHERE src.articulo_numero IS NOT NULL
                ORDER BY UPPER(BTRIM(src.articulo_numero))
            ),
            art_norm AS (
                SELECT DISTINCT ON (UPPER(BTRIM(a.numero)))
                    UPPER(BTRIM(a.numero)) AS cod_norm,
                    NULLIF(BTRIM(a.nombre), '') AS nombre_art
                FROM articulos a
                WHERE a.numero IS NOT NULL
                ORDER BY UPPER(BTRIM(a.numero))
            ),
            aper_unico AS (
                SELECT DISTINCT ON (UPPER(BTRIM(r_ext.articulo_produccion_codigo)))
                    UPPER(BTRIM(r_ext.articulo_produccion_codigo)) AS prod_norm,
                    r_ext.articulo_kilo_codigo,
                    UPPER(BTRIM(r_ext.articulo_kilo_codigo)) AS kilo_norm
                FROM articulos_produccion_externa_relacion r_ext
                WHERE UPPER(BTRIM(r_ext.articulo_produccion_codigo)) <> UPPER(BTRIM(r_ext.articulo_kilo_codigo))
                ORDER BY UPPER(BTRIM(r_ext.articulo_produccion_codigo)), r_ext.id ASC
            ),
            resumen_por_carro AS (
                SELECT
                    ca.carro_id,
                    COUNT(*) AS total_articulos,
                    json_agg(
                        json_build_object(
                            'numero', ca.articulo_numero,
                            'descripcion', COALESCE(ba.desc_gen, ba.desc_base, src.desc_src, an.nombre_art, ca.articulo_numero),
                            'cantidad', ca.cantidad,
                            'ap_codigo', ap.articulo_kilo_codigo,
                            'ap_descripcion', COALESCE(ba_ap.desc_gen, ba_ap.desc_base, ap.articulo_kilo_codigo)
                        ) ORDER BY ca.id ASC
                    ) AS resumen_articulos
                FROM carros_articulos ca
                JOIN carros_u cu ON cu.id = ca.carro_id
                LEFT JOIN ba_norm ba ON ba.cod_norm = UPPER(BTRIM(ca.articulo_numero))
                LEFT JOIN src_norm src ON src.cod_norm = UPPER(BTRIM(ca.articulo_numero))
                LEFT JOIN art_norm an ON an.cod_norm = UPPER(BTRIM(ca.articulo_numero))
                LEFT JOIN aper_unico ap ON ap.prod_norm = UPPER(BTRIM(ca.articulo_numero))
                LEFT JOIN ba_norm ba_ap ON ba_ap.cod_norm = ap.kilo_norm
                GROUP BY ca.carro_id
            ),
            insumos_prep AS (
                SELECT
                    mov.carro_id,
                    json_agg(
                        json_build_object(
                            'sku', mov.articulo_numero,
                            'descripcion', mov.descripcion,
                            'cantidad', mov.cantidad_total,
                            'kilos', mov.kilos_totales,
                            'confirmado_retiro', true
                        ) ORDER BY mov.articulo_numero
                    ) AS insumos_json
                FROM (
                    SELECT
                        svm.carro_id,
                        svm.articulo_numero,
                        COALESCE(ba_s.desc_gen, ba_s.desc_base, src_s.desc_src, a_s.nombre_art, svm.articulo_numero) AS descripcion,
                        ROUND(SUM(ABS(COALESCE(svm.cantidad, 0)))::numeric, 3) AS cantidad_total,
                        ROUND(SUM(
                            CASE
                                WHEN ABS(COALESCE(svm.kilos, 0)) > 0 THEN ABS(svm.kilos)
                                ELSE ABS(COALESCE(svm.cantidad, 0)) * COALESCE(ba_s.kilos_unidad, src_s.kilos_unidad, 1.0)
                            END
                        )::numeric, 3) AS kilos_totales
                    FROM stock_ventas_movimientos svm
                    JOIN carros_u cu ON cu.id = svm.carro_id
                    LEFT JOIN ba_norm ba_s ON ba_s.cod_norm = UPPER(BTRIM(svm.articulo_numero))
                    LEFT JOIN src_norm src_s ON src_s.cod_norm = UPPER(BTRIM(svm.articulo_numero))
                    LEFT JOIN art_norm a_s ON a_s.cod_norm = UPPER(BTRIM(svm.articulo_numero))
                    WHERE cu.tipo_carro = 'externa'
                      AND cu.fecha_preparado IS NOT NULL
                      AND LOWER(COALESCE(svm.tipo, '')) LIKE '%egreso por receta externa%'
                    GROUP BY svm.carro_id, svm.articulo_numero, ba_s.desc_gen, ba_s.desc_base, src_s.desc_src, a_s.nombre_art
                ) mov
                GROUP BY mov.carro_id
            ),
            recetas_norm AS (
                SELECT r.id, UPPER(BTRIM(r.articulo_numero)) AS art_norm
                FROM recetas r
                WHERE r.articulo_numero IS NOT NULL
            ),
            insumos_prev AS (
                SELECT
                    prev.carro_id,
                    json_agg(
                        json_build_object(
                            'sku', prev.articulo_numero,
                            'descripcion', prev.descripcion,
                            'cantidad', prev.cantidad_total,
                            'kilos', prev.kilos_totales,
                            'confirmado_retiro', false
                        ) ORDER BY prev.articulo_numero
                    ) AS insumos_json
                FROM (
                    SELECT
                        ca.carro_id,
                        ra.articulo_numero,
                        COALESCE(ba_r.desc_gen, ba_r.desc_base, src_r.desc_src, a_r.nombre_art, ra.articulo_numero) AS descripcion,
                        ROUND(SUM(ra.cantidad * ca.cantidad)::numeric, 3) AS cantidad_total,
                        ROUND(SUM(ra.cantidad * ca.cantidad * COALESCE(ba_r.kilos_unidad, src_r.kilos_unidad, 1.0))::numeric, 3) AS kilos_totales
                    FROM carros_articulos ca
                    JOIN carros_u cu ON cu.id = ca.carro_id
                    JOIN recetas_norm rn ON rn.art_norm = UPPER(BTRIM(ca.articulo_numero))
                    JOIN receta_articulos ra ON ra.receta_id = rn.id
                    LEFT JOIN ba_norm ba_r ON ba_r.cod_norm = UPPER(BTRIM(ra.articulo_numero))
                    LEFT JOIN src_norm src_r ON src_r.cod_norm = UPPER(BTRIM(ra.articulo_numero))
                    LEFT JOIN art_norm a_r ON a_r.cod_norm = UPPER(BTRIM(ra.articulo_numero))
                    WHERE cu.tipo_carro = 'externa'
                      AND cu.fecha_preparado IS NULL
                    GROUP BY ca.carro_id, ra.articulo_numero, ba_r.desc_gen, ba_r.desc_base, src_r.desc_src, a_r.nombre_art
                ) prev
                GROUP BY prev.carro_id
            )
            SELECT
                cu.id,
                cu.fecha_inicio,
                cu.en_auditoria,
                cu.tipo_carro,
                cu.linea_negocio,
                cu.nombre_linea_negocio,
                cu.fecha_preparado,
                cu.fecha_confirmacion,
                COALESCE(rpc.total_articulos, 0)::text AS total_articulos,
                COALESCE(rpc.resumen_articulos, '[]'::json) AS resumen_articulos,
                CASE
                    WHEN cu.tipo_carro = 'externa' AND cu.fecha_preparado IS NOT NULL THEN COALESCE(ip.insumos_json, '[]'::json)
                    WHEN cu.tipo_carro = 'externa' THEN COALESCE(iprev.insumos_json, '[]'::json)
                    ELSE '[]'::json
                END AS insumos_externos
            FROM carros_u cu
            LEFT JOIN resumen_por_carro rpc ON rpc.carro_id = cu.id
            LEFT JOIN insumos_prep ip ON ip.carro_id = cu.id
            LEFT JOIN insumos_prev iprev ON iprev.carro_id = cu.id
            ORDER BY cu.fecha_inicio DESC
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
