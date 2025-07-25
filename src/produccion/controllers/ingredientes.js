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
 * Obtiene todos los ingredientes con información de sector
 * @returns {Promise<Array>} Lista de ingredientes con sector
 */
async function obtenerIngredientes() {
    try {
        console.log('🔍 [SECTORES] Ejecutando consulta de ingredientes con sectores...');
        const query = `
            SELECT 
                i.id,
                i.codigo,
                i.nombre,
                i.descripcion,
                i.unidad_medida,
                i.categoria,
                i.stock_actual,
                i.sector_id,
                s.nombre as sector_nombre
            FROM ingredientes i
            LEFT JOIN sectores_ingredientes s ON i.sector_id = s.id
            ORDER BY i.nombre ASC;
        `;
        
        const result = await pool.query(query);
        console.log(`✅ [SECTORES] Encontrados ${result.rows.length} ingredientes`);
        
        // Log de depuración para sectores
        const conSector = result.rows.filter(ing => ing.sector_id !== null).length;
        const sinSector = result.rows.length - conSector;
        console.log(`📊 [SECTORES] Ingredientes con sector: ${conSector}, sin sector: ${sinSector}`);
        
        return result.rows;
    } catch (error) {
        console.error('❌ [SECTORES] Error en obtenerIngredientes:', error);
        throw new Error('No se pudo obtener la lista de ingredientes');
    }
}

/**
 * Obtiene un ingrediente por su ID con información de sector
 * @param {number} id - ID del ingrediente
 * @returns {Promise<Object>} Datos del ingrediente con sector
 */
async function obtenerIngrediente(id) {
    try {
        console.log(`🔍 [SECTORES] Obteniendo ingrediente ${id} con información de sector...`);
        const query = `
            SELECT 
                i.id,
                i.codigo,
                i.nombre,
                i.descripcion,
                i.unidad_medida,
                i.categoria,
                i.stock_actual,
                i.receta_base_kg,
                i.sector_id,
                s.nombre as sector_nombre
            FROM ingredientes i
            LEFT JOIN sectores_ingredientes s ON i.sector_id = s.id
            WHERE i.id = $1;
        `;
        
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            throw new Error('Ingrediente no encontrado');
        }
        
        const ingrediente = result.rows[0];
        console.log(`✅ [SECTORES] Ingrediente obtenido: ${ingrediente.nombre}, sector: ${ingrediente.sector_nombre || 'Sin asignar'}`);
        
        return ingrediente;
    } catch (error) {
        console.error('❌ [SECTORES] Error en obtenerIngrediente:', error);
        throw new Error('No se pudo obtener el ingrediente');
    }
}

/**
 * Crea un nuevo ingrediente con soporte para sectores
 * @param {Object} datos - Datos del ingrediente
 * @returns {Promise<Object>} Ingrediente creado
 */
async function crearIngrediente(datos) {
    try {
        const { nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id, sector_id } = datos;

        console.log(`🔍 [SECTORES] Creando ingrediente: ${nombre}, sector_id: ${sector_id || 'null'}`);

        // Verificar si ya existe un ingrediente con el mismo nombre (sin distinguir mayúsculas/minúsculas)
        const checkQuery = 'SELECT id FROM ingredientes WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))';
        const checkResult = await pool.query(checkQuery, [nombre]);
        if (checkResult.rows.length > 0) {
            throw new Error('El ingrediente ya existe');
        }
        
        // Validar sector_id si se proporciona
        if (sector_id !== null && sector_id !== undefined && sector_id !== '') {
            const sectorQuery = 'SELECT id FROM sectores_ingredientes WHERE id = $1';
            const sectorResult = await pool.query(sectorQuery, [sector_id]);
            if (sectorResult.rows.length === 0) {
                console.warn(`⚠️ [SECTORES] Sector ${sector_id} no encontrado, creando ingrediente sin sector`);
            }
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
                padre_id,
                sector_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        
        // Convertir sector_id vacío a null
        const sectorIdFinal = (sector_id === '' || sector_id === undefined) ? null : sector_id;
        const values = [codigo, nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id, sectorIdFinal];
        const result = await pool.query(query, values);
        
        console.log(`✅ [SECTORES] Ingrediente creado: ${nombre}, sector_id: ${sectorIdFinal || 'null'}`);
        
        return result.rows[0];
    } catch (error) {
        console.error('❌ [SECTORES] Error en crearIngrediente:', error);
        throw new Error(error.message || 'No se pudo crear el ingrediente');
    }
}


/**
 * Actualiza un ingrediente existente con soporte para sectores
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
        
        // Manejar sector_id con compatibilidad para null
        let sector_id;
        if (datos.sector_id === undefined) {
            sector_id = existing.sector_id;
        } else if (datos.sector_id === '' || datos.sector_id === null) {
            sector_id = null;
        } else {
            sector_id = datos.sector_id;
        }

        console.log(`🔍 [SECTORES] Actualizando ingrediente ${id}: ${nombre}, sector_id: ${existing.sector_id} → ${sector_id}`);

        // Validar sector_id si se proporciona
        if (sector_id !== null && sector_id !== undefined) {
            const sectorQuery = 'SELECT id FROM sectores_ingredientes WHERE id = $1';
            const sectorResult = await pool.query(sectorQuery, [sector_id]);
            if (sectorResult.rows.length === 0) {
                console.warn(`⚠️ [SECTORES] Sector ${sector_id} no encontrado, manteniendo sector actual`);
                sector_id = existing.sector_id;
            }
        }

        const query = `
            UPDATE ingredientes
            SET nombre = $1,
                descripcion = $2,
                unidad_medida = $3,
                categoria = $4,
                stock_actual = $5,
                padre_id = $6,
                receta_base_kg = $7,
                sector_id = $8
            WHERE id = $9
            RETURNING *;
        `;
        
        const values = [nombre, descripcion, unidad_medida, categoria, stock_actual, padre_id, receta_base_kg, sector_id, id];
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            throw new Error('Ingrediente no encontrado');
        }
        
        console.log(`✅ [SECTORES] Ingrediente actualizado: ${nombre}, sector_id final: ${sector_id || 'null'}`);
        
        return result.rows[0];
    } catch (error) {
        console.error('❌ [SECTORES] Error en actualizarIngrediente:', error);
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

/**
 * Obtiene todos los sectores disponibles
 * @returns {Promise<Array>} Lista de sectores
 */
async function obtenerSectores() {
    try {
        console.log('🔍 [SECTORES] Obteniendo lista de sectores...');
        const query = `
            SELECT 
                id,
                nombre,
                descripcion
            FROM sectores_ingredientes
            ORDER BY nombre ASC;
        `;
        
        const result = await pool.query(query);
        console.log(`✅ [SECTORES] Encontrados ${result.rows.length} sectores`);
        return result.rows;
    } catch (error) {
        console.error('❌ [SECTORES] Error en obtenerSectores:', error);
        throw new Error('No se pudo obtener la lista de sectores');
    }
}

/**
 * Crea un nuevo sector
 * @param {Object} datos - Datos del sector (nombre, descripcion)
 * @returns {Promise<Object>} Sector creado
 */
async function crearSector(datos) {
    try {
        const { nombre, descripcion } = datos;
        
        if (!nombre || nombre.trim() === '') {
            throw new Error('El nombre del sector es requerido');
        }
        
        console.log('📝 [SECTORES] Creando nuevo sector:', { nombre, descripcion });
        
        // Verificar si ya existe un sector con ese nombre
        const existeQuery = 'SELECT id FROM sectores_ingredientes WHERE LOWER(nombre) = LOWER($1)';
        const existeResult = await pool.query(existeQuery, [nombre.trim()]);
        
        if (existeResult.rows.length > 0) {
            throw new Error('Ya existe un sector con ese nombre');
        }
        
        // Crear el nuevo sector
        const insertQuery = `
            INSERT INTO sectores_ingredientes (nombre, descripcion) 
            VALUES ($1, $2) 
            RETURNING id, nombre, descripcion
        `;
        
        const result = await pool.query(insertQuery, [nombre.trim(), descripcion?.trim() || null]);
        const nuevoSector = result.rows[0];
        
        console.log('✅ [SECTORES] Sector creado exitosamente:', nuevoSector);
        return nuevoSector;
        
    } catch (error) {
        console.error('❌ [SECTORES] Error en crearSector:', error);
        throw new Error(error.message || 'No se pudo crear el sector');
    }
}

/**
 * Actualiza un sector existente
 * @param {number} id - ID del sector
 * @param {Object} datos - Nuevos datos del sector
 * @returns {Promise<Object>} Sector actualizado
 */
async function actualizarSector(id, datos) {
    try {
        const { nombre, descripcion } = datos;
        
        if (!nombre || nombre.trim() === '') {
            throw new Error('El nombre del sector es requerido');
        }
        
        console.log('📝 [SECTORES] Actualizando sector:', { id, nombre, descripcion });
        
        // Verificar si existe otro sector con ese nombre
        const existeQuery = 'SELECT id FROM sectores_ingredientes WHERE LOWER(nombre) = LOWER($1) AND id != $2';
        const existeResult = await pool.query(existeQuery, [nombre.trim(), id]);
        
        if (existeResult.rows.length > 0) {
            throw new Error('Ya existe otro sector con ese nombre');
        }
        
        // Actualizar el sector
        const updateQuery = `
            UPDATE sectores_ingredientes 
            SET nombre = $1, descripcion = $2 
            WHERE id = $3 
            RETURNING id, nombre, descripcion
        `;
        
        const result = await pool.query(updateQuery, [nombre.trim(), descripcion?.trim() || null, id]);
        
        if (result.rows.length === 0) {
            throw new Error('Sector no encontrado');
        }
        
        const sectorActualizado = result.rows[0];
        console.log('✅ [SECTORES] Sector actualizado exitosamente:', sectorActualizado);
        return sectorActualizado;
        
    } catch (error) {
        console.error('❌ [SECTORES] Error en actualizarSector:', error);
        throw new Error(error.message || 'No se pudo actualizar el sector');
    }
}

/**
 * Elimina un sector
 * @param {number} id - ID del sector a eliminar
 * @returns {Promise<Object>} Mensaje de confirmación
 */
async function eliminarSector(id) {
    try {
        console.log('🗑️ [SECTORES] Eliminando sector:', id);
        
        // Verificar si hay ingredientes asignados a este sector
        const ingredientesQuery = 'SELECT COUNT(*) as count FROM ingredientes WHERE sector_id = $1';
        const ingredientesResult = await pool.query(ingredientesQuery, [id]);
        const cantidadIngredientes = parseInt(ingredientesResult.rows[0].count);
        
        if (cantidadIngredientes > 0) {
            throw new Error(`No se puede eliminar el sector porque tiene ${cantidadIngredientes} ingrediente(s) asignado(s)`);
        }
        
        // Eliminar el sector
        const deleteQuery = 'DELETE FROM sectores_ingredientes WHERE id = $1 RETURNING nombre';
        const result = await pool.query(deleteQuery, [id]);
        
        if (result.rows.length === 0) {
            throw new Error('Sector no encontrado');
        }
        
        const sectorEliminado = result.rows[0];
        console.log('✅ [SECTORES] Sector eliminado exitosamente:', sectorEliminado.nombre);
        return { message: `Sector "${sectorEliminado.nombre}" eliminado exitosamente` };
        
    } catch (error) {
        console.error('❌ [SECTORES] Error en eliminarSector:', error);
        throw new Error(error.message || 'No se pudo eliminar el sector');
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
    obtenerStockPorUsuario,
    obtenerSectores,
    crearSector,
    actualizarSector,
    eliminarSector
};
