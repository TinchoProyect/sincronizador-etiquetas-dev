const pool = require('../config/database');

/**
 * Obtiene un nuevo código único para un ingrediente
 * @returns {Promise<string>} Código único de 8 dígitos
 */
async function obtenerNuevoCodigo() {
    try {
        // Obtener el último código generado
        const query = `
            SELECT codigo 
            FROM ingredientes 
            WHERE codigo IS NOT NULL 
            ORDER BY codigo DESC 
            LIMIT 1;
        `;
        const result = await pool.query(query);
        
        // Si no hay códigos, empezar desde 10000000
        let ultimoCodigo = result.rows.length > 0 ? parseInt(result.rows[0].codigo) : 9999999;
        let nuevoCodigo = (ultimoCodigo + 1).toString();
        
        // Asegurar que tenga 8 dígitos
        while (nuevoCodigo.length < 8) {
            nuevoCodigo = '0' + nuevoCodigo;
        }
        
        return nuevoCodigo;
    } catch (error) {
        console.error('Error en obtenerNuevoCodigo:', error);
        throw new Error('No se pudo generar un nuevo código');
    }
}

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
                codigo,
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
                codigo,
                nombre,
                descripcion,
                unidad_medida,
                categoria,
                stock_actual,
                receta_base_kg
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

        // Verificar si ya existe un ingrediente con el mismo nombre (sin distinguir mayúsculas/minúsculas)
        const checkQuery = 'SELECT id FROM ingredientes WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))';
        const checkResult = await pool.query(checkQuery, [nombre]);
        if (checkResult.rows.length > 0) {
            throw new Error('El ingrediente ya existe');
        }
        
        // Obtener nuevo código
        const codigo = await obtenerNuevoCodigo();
        
        const query = `
            INSERT INTO ingredientes (
                codigo,
                nombre,
                descripcion,
                unidad_medida,
                categoria,
                stock_actual,
                padre_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;
        
        const values = [codigo, nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id];
        const result = await pool.query(query, values);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error en crearIngrediente:', error);
        throw new Error(error.message || 'No se pudo crear el ingrediente');
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
        const receta_base_kg = (datos.receta_base_kg === undefined) ? existing.receta_base_kg : datos.receta_base_kg;

        const query = `
            UPDATE ingredientes
            SET nombre = $1,
                descripcion = $2,
                unidad_medida = $3,
                categoria = $4,
                stock_actual = $5,
                padre_id = $6,
                receta_base_kg = $7
            WHERE id = $8
            RETURNING *;
        `;
        
        const values = [nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id, receta_base_kg, id];
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

/**
 * Obtiene la lista de usuarios que tienen stock en ingredientes_stock_usuarios
 * @returns {Promise<Array>} Lista de usuarios con stock
 */
async function obtenerUsuariosConStock() {
    try {
        console.log('🔍 Obteniendo usuarios con stock de ingredientes...');
        const query = `
            SELECT DISTINCT 
                u.id as usuario_id,
                u.nombre_completo
            FROM usuarios u
            INNER JOIN ingredientes_stock_usuarios isu ON u.id = isu.usuario_id
            GROUP BY u.id, u.nombre_completo
            HAVING SUM(isu.cantidad) != 0
            ORDER BY u.nombre_completo ASC;
        `;
        
        const result = await pool.query(query);
        console.log(`✅ Encontrados ${result.rows.length} usuarios con stock de ingredientes`);
        return result.rows;
    } catch (error) {
        console.error('❌ Error en obtenerUsuariosConStock:', error);
        throw new Error('No se pudo obtener la lista de usuarios con stock');
    }
}

/**
 * Obtiene el stock consolidado de ingredientes para un usuario específico
 * Separa correctamente por origen_mix_id según los requisitos
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Array>} Lista de ingredientes con stock del usuario
 */
async function obtenerStockPorUsuario(usuarioId) {
    try {
        console.log(`🔍 Obteniendo stock de ingredientes para usuario ${usuarioId}...`);
        const query = `
            SELECT 
                i.id as ingrediente_id,
                i.codigo,
                i.nombre as nombre_ingrediente,
                i.descripcion,
                i.unidad_medida,
                i.categoria,
                SUM(isu.cantidad) as stock_total,
                isu.origen_mix_id,
                CASE 
                    WHEN isu.origen_mix_id IS NULL THEN 'Simple'
                    ELSE 'Sobrante de Mix'
                END as tipo_origen,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM ingrediente_composicion ic 
                        WHERE ic.mix_id = i.id
                    ) THEN 'Mix'
                    ELSE 'Simple'
                END as tipo
            FROM public.ingredientes i
            INNER JOIN public.ingredientes_stock_usuarios isu ON i.id = isu.ingrediente_id
            WHERE isu.usuario_id = $1
            GROUP BY i.id, i.codigo, i.nombre, i.descripcion, i.unidad_medida, i.categoria, isu.origen_mix_id
            HAVING SUM(isu.cantidad) > 0
            ORDER BY i.nombre ASC, isu.origen_mix_id ASC NULLS FIRST;
        `;
        
        const result = await pool.query(query, [usuarioId]);
        console.log(`✅ Encontrados ${result.rows.length} registros de stock para usuario ${usuarioId}`);
        
        // Log detallado para debugging
        result.rows.forEach(row => {
            console.log(`📦 ${row.nombre_ingrediente}: ${row.stock_total} (${row.tipo_origen})`);
        });
        
        return result.rows;
    } catch (error) {
        console.error(`❌ Error en obtenerStockPorUsuario para usuario ${usuarioId}:`, error);
        throw new Error('No se pudo obtener el stock del usuario');
    }
}

module.exports = {
    obtenerIngredientes,
    obtenerIngrediente,
    crearIngrediente,
    actualizarIngrediente,
    eliminarIngrediente,
    obtenerNuevoCodigo,
    obtenerUsuariosConStock,
    obtenerStockPorUsuario
};
