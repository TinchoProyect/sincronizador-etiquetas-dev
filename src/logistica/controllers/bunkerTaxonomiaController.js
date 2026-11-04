exports.obtenerRubros = async (req, res) => {
    try {
        const query = `SELECT id, nombre FROM public.bunker_rubros ORDER BY nombre ASC`;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [TAXONOMIA] Error obteniendo rubros:', error);
        res.status(500).json({ success: false, error: 'Error de SQL o BD no inicializada.' });
    }
};

exports.crearRubro = async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'El nombre del Rubro es mandatorio.' });
        
        const query = `INSERT INTO public.bunker_rubros (nombre) VALUES ($1) RETURNING id, nombre`;
        const result = await req.db.query(query, [nombre.trim().toUpperCase()]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // Violación Constraints PGSQL
            return res.status(400).json({ success: false, error: 'Ese Rubro ya existe en el sistema.' });
        }
        console.error('❌ [TAXONOMIA] Error creando rubro en BD:', error);
        res.status(500).json({ success: false, error: 'Fallo guardando el Rubro.' });
    }
};

exports.obtenerSubrubros = async (req, res) => {
    try {
        const { rubroId } = req.params;
        const query = `SELECT id, rubro_id, nombre FROM public.bunker_subrubros WHERE rubro_id = $1 ORDER BY nombre ASC`;
        const result = await req.db.query(query, [rubroId]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(`❌ [TAXONOMIA] Error obteniendo subrubros (Rubro: ${req.params.rubroId}):`, error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo dependencias.' });
    }
};

exports.crearSubrubro = async (req, res) => {
    try {
        const { rubroId } = req.params;
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'El nombre del Subrubro es mandatorio.' });
        
        const query = `INSERT INTO public.bunker_subrubros (rubro_id, nombre) VALUES ($1, $2) RETURNING id, rubro_id, nombre`;
        const result = await req.db.query(query, [rubroId, nombre.trim().toUpperCase()]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // Unique(rubro_id, nombre)
            return res.status(400).json({ success: false, error: 'Este Subrubro ya pertenece al Rubro actual.' });
        }
        console.error(`❌ [TAXONOMIA] Error creando subrubro (Rubro: ${req.params.rubroId}):`, error);
        res.status(500).json({ success: false, error: 'Fallo guardando el Subrubro.' });
    }
};

exports.obtenerCategoriasPorFamilia = async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const { familiaId } = req.params;
        const famIdNum = parseInt(familiaId) || 1;

        const query = `
            SELECT id, familia_id, categoria, orden_posicional
            FROM public.bunker_familia_categorias
            WHERE familia_id = $1
            ORDER BY orden_posicional ASC
        `;
        const result = await req.db.query(query, [famIdNum]);

        return res.json({ success: true, data: result.rows || [] });
    } catch (error) {
        console.error(`❌ [TAXONOMIA] Error obteniendo categorías por familia ${req.params.familiaId}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo plantilla de categorías' });
    }
};

exports.obtenerCategoriasGlobales = async (req, res) => {
    try {
        const query = `
            SELECT 
                LOWER(TRIM(REGEXP_REPLACE(cat_list.categoria, '\\s+', ' ', 'g'))) AS categoria,
                COALESCE(
                    ARRAY_AGG(DISTINCT cat_fam.familia_id) FILTER (WHERE cat_fam.familia_id IS NOT NULL),
                    '{}'::integer[]
                ) AS familias_ids
            FROM (
                SELECT categoria FROM public.bunker_diccionario WHERE obsoleto IS NOT TRUE AND categoria IS NOT NULL
                UNION
                SELECT categoria FROM public.bunker_familia_categorias WHERE categoria IS NOT NULL
                UNION
                SELECT categoria FROM public.bunker_relacion_atributo_principal WHERE categoria IS NOT NULL
            ) cat_list
            LEFT JOIN (
                SELECT categoria, familia_id FROM public.bunker_familia_categorias WHERE familia_id IS NOT NULL AND categoria IS NOT NULL
                UNION
                SELECT categoria, familia_id FROM public.bunker_relacion_atributo_principal WHERE familia_id IS NOT NULL AND categoria IS NOT NULL
            ) cat_fam ON LOWER(TRIM(REGEXP_REPLACE(cat_fam.categoria, '\\s+', ' ', 'g'))) = LOWER(TRIM(REGEXP_REPLACE(cat_list.categoria, '\\s+', ' ', 'g')))
            WHERE LOWER(TRIM(REGEXP_REPLACE(cat_list.categoria, '\\s+', ' ', 'g'))) NOT IN ('articulo_principal', 'general', '')
            GROUP BY LOWER(TRIM(REGEXP_REPLACE(cat_list.categoria, '\\s+', ' ', 'g')))
            ORDER BY categoria ASC;
        `;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [TAXONOMIA] Error obteniendo categorías globales superset enriquecidas:', error);
        res.status(500).json({ success: false, error: 'Error conectando a la base de datos' });
    }
};

exports.agregarCategoriaAFamilia = async (req, res) => {
    try {
        const { familiaId } = req.params;
        const { categoria, orden_posicional } = req.body;

        if (!categoria || !categoria.trim()) {
            return res.status(400).json({ success: false, error: 'La categoría es obligatoria.' });
        }

        const catClean = categoria.trim().toLowerCase();
        let ordenNum = parseInt(orden_posicional);
        if (isNaN(ordenNum) || ordenNum === 99) {
            const resMax = await req.db.query(
                `SELECT COALESCE(MAX(orden_posicional), 0) + 1 AS proximo_orden FROM public.bunker_familia_categorias WHERE familia_id = $1`,
                [parseInt(familiaId)]
            );
            ordenNum = parseInt(resMax.rows[0].proximo_orden) || 1;
        }

        const query = `
            INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
            VALUES ($1, $2, $3)
            ON CONFLICT (familia_id, categoria) DO UPDATE SET orden_posicional = EXCLUDED.orden_posicional
            RETURNING *
        `;
        const result = await req.db.query(query, [parseInt(familiaId), catClean, ordenNum]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(`❌ [TAXONOMIA] Error agregando categoría a familia:`, error);
        res.status(500).json({ success: false, error: 'Error guardando categoría en familia' });
    }
};

exports.reordenarCategoriasFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId } = req.params;
        const { ordenamiento } = req.body; // Array: [{ categoria: 'conformacion', orden: 2 }, ...]

        if (!Array.isArray(ordenamiento)) {
            return res.status(400).json({ success: false, error: 'El cuerpo debe ser un array de ordenamiento.' });
        }

        await client.query('BEGIN');
        for (const item of ordenamiento) {
            await client.query(`
                INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
                VALUES ($1, $2, $3)
                ON CONFLICT (familia_id, categoria) DO UPDATE SET orden_posicional = EXCLUDED.orden_posicional
            `, [parseInt(familiaId), item.categoria.toLowerCase(), parseInt(item.orden)]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: 'Orden posicional actualizado exitosamente.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ [TAXONOMIA] Error reordenando categorías:`, error);
        res.status(500).json({ success: false, error: 'Fallo al reordenar posiciones' });
    } finally {
        client.release();
    }
};

exports.crearCategoriaMaestra = async (req, res) => {
    try {
        const { categoria, familiaId, ordenPosicional } = req.body;
        if (!categoria || !categoria.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre de la nueva categoría es obligatorio.' });
        }
        const catClean = categoria.trim().toLowerCase();

        // 🔑 ALTA LIMPIA v5.7: Las categorías son metadatos taxonómicos.
        // Se vinculan directamente a bunker_familia_categorias si se provee familiaId,
        // sin inyectar registros ficticios en bunker_diccionario.
        if (familiaId) {
            const famIdNum = parseInt(familiaId) || 1;
            const ordenNum = parseInt(ordenPosicional) || 99;
            const query = `
                INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
                VALUES ($1, $2, $3)
                ON CONFLICT (familia_id, categoria) DO UPDATE SET orden_posicional = EXCLUDED.orden_posicional
                RETURNING *
            `;
            const result = await req.db.query(query, [famIdNum, catClean, ordenNum]);
            return res.json({ success: true, message: `Categoría "${catClean}" registrada en la plantilla de familia.`, data: result.rows[0] });
        }

        res.json({ success: true, message: `Categoría "${catClean}" definida exitosamente como Eje Posicional.`, data: { categoria: catClean } });
    } catch (error) {
        console.error(`❌ [TAXONOMIA] Error creando categoría maestra:`, error);
        res.status(500).json({ success: false, error: 'Fallo creando categoría maestra' });
    }
};

exports.renombrarCategoria = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { categoriaActual, categoriaNueva } = req.body;
        if (!categoriaActual || !categoriaActual.trim() || !categoriaNueva || !categoriaNueva.trim()) {
            client.release();
            return res.status(400).json({ success: false, error: 'La categoría actual y el nuevo nombre son obligatorios.' });
        }

        const oldExact = categoriaActual.trim();
        const newExact = categoriaNueva.trim();

        // 🔑 REFACTOR v5.7.1: Comparación exacta sin sofocar mayúsculas/minúsculas
        if (oldExact === newExact) {
            client.release();
            return res.json({ success: true, message: 'No hubo cambios en la categoría.' });
        }

        await client.query('BEGIN');

        // 1. Actualizar en bunker_familia_categorias
        await client.query(`
            UPDATE public.bunker_familia_categorias
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($1, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        `, [oldExact, newExact]);

        // 2. Actualizar en bunker_diccionario
        await client.query(`
            UPDATE public.bunker_diccionario
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($1, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        `, [oldExact, newExact]);

        // 3. Actualizar en bunker_relacion_atributo_principal
        await client.query(`
            UPDATE public.bunker_relacion_atributo_principal
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($1, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        `, [oldExact, newExact]);

        await client.query('COMMIT');

        console.log(`✅ [TAXONOMIA] Categoría "${oldExact}" renombrada en cascada a "${newExact}" exitosamente.`);
        res.json({ success: true, message: `Categoría "${oldExact}" renombrada a "${newExact}" en cascada.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [TAXONOMIA] Error al renombrar categoría en cascada:', error);
        res.status(500).json({ success: false, error: 'Error interno al renombrar categoría' });
    } finally {
        client.release();
    }
};

exports.eliminarCategoriaDeFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId, categoria } = req.params;
        console.log(`🚨 [VIGÍA BACKEND DELETE CATEGORÍA - ENTRADA]:`, { familiaId, categoria, params: req.params });

        if (!categoria) {
            client.release();
            return res.status(400).json({ success: false, error: 'Categoría requerida.' });
        }
        
        const famIdNum = parseInt(familiaId) || 1;
        const catClean = categoria.trim().toLowerCase();
        console.log(`🚨 [VIGÍA BACKEND DELETE CATEGORÍA - PROCESANDO]:`, { famIdNum, catClean });

        await client.query('BEGIN');

        // Borrado relacional determinista en bunker_familia_categorias (v5.80-rev3)
        const delRes = await client.query(`
            DELETE FROM public.bunker_familia_categorias
            WHERE familia_id = $1 AND LOWER(categoria) = $2
        `, [famIdNum, catClean]);
        console.log(`🚨 [VIGÍA BACKEND DELETE CATEGORÍA - FILAS ELIMINADAS]:`, delRes.rowCount);

        await client.query('COMMIT');
        client.release();
        console.log(`🚨 [VIGÍA BACKEND DELETE CATEGORÍA - OPERACIÓN COMMIT EXITOSA]`);
        res.json({ success: true, message: `Categoría "${categoria}" desvinculada exitosamente de la plantilla de la familia.` });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error(`🚨 [VIGÍA BACKEND DELETE CATEGORÍA ERROR DETALLADO]:`, {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: `Error SQL al eliminar categoría: ${error.message} (code: ${error.code})` });
    }
};

exports.crearFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { nombre, codigo_familia, descripcion } = req.body;
        if (!nombre || !nombre.trim()) {
            client.release();
            return res.status(400).json({ success: false, error: 'El nombre de la familia es obligatorio.' });
        }

        const nombreClean = nombre.trim();
        let baseCode = (codigo_familia && codigo_familia.trim()) 
            ? codigo_familia.trim().toUpperCase() 
            : `FAM-${nombreClean.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')}`;

        if (!baseCode.startsWith('FAM-')) {
            baseCode = `FAM-${baseCode}`;
        }

        const descClean = (descripcion && descripcion.trim()) ? descripcion.trim() : `Familia ${nombreClean}`;

        await client.query('BEGIN');

        // Garantizar unicidad del código de familia resolviendo colisiones automáticamente
        let codeClean = baseCode;
        let counter = 1;
        while (true) {
            const checkCode = await client.query(`SELECT id FROM public.bunker_familias WHERE codigo_familia = $1`, [codeClean]);
            if (checkCode.rows.length === 0) break;
            codeClean = `${baseCode}_${counter++}`;
        }

        // 1. Insertar nueva familia maestra (Nace con 0 ejes posicionales en bunker_familia_categorias v5.80-rev3)
        const queryFam = `
            INSERT INTO public.bunker_familias (nombre, codigo_familia, descripcion)
            VALUES ($1, $2, $3)
            RETURNING id, nombre, codigo_familia, descripcion
        `;
        const resultFam = await client.query(queryFam, [nombreClean, codeClean, descClean]);
        const newFam = resultFam.rows[0];

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND CREAR FAMILIA]: Creada exitosamente ID=${newFam.id} Nombre="${newFam.nombre}"`);
        res.json({ success: true, message: `Familia "${newFam.nombre}" creada exitosamente.`, data: newFam });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        if (error.code === '23505') {
            return res.status(400).json({ success: false, error: 'Ya existe una familia registrada con ese nombre o código.' });
        }
        console.error('❌ [TAXONOMIA] Error creando familia:', error);
        res.status(500).json({ success: false, error: `Error creando familia: ${error.message}` });
    }
};

exports.actualizarFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId } = req.params;
        const { nombre, codigo_familia, descripcion } = req.body;
        const famIdNum = parseInt(familiaId);

        if (!famIdNum) {
            client.release();
            return res.status(400).json({ success: false, error: 'El ID de la familia es inválido.' });
        }

        if (!nombre || !nombre.trim()) {
            client.release();
            return res.status(400).json({ success: false, error: 'El nombre de la familia es obligatorio.' });
        }

        const nombreClean = nombre.trim();
        let baseCode = (codigo_familia && codigo_familia.trim()) 
            ? codigo_familia.trim().toUpperCase() 
            : `FAM-${nombreClean.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')}`;

        if (!baseCode.startsWith('FAM-')) {
            baseCode = `FAM-${baseCode}`;
        }

        const descClean = (descripcion && descripcion.trim()) ? descripcion.trim() : `Familia ${nombreClean}`;

        await client.query('BEGIN');

        // Garantizar unicidad del código de familia excluyendo la propia familia
        let codeClean = baseCode;
        let counter = 1;
        while (true) {
            const checkCode = await client.query(`SELECT id FROM public.bunker_familias WHERE codigo_familia = $1 AND id != $2`, [codeClean, famIdNum]);
            if (checkCode.rows.length === 0) break;
            codeClean = `${baseCode}_${counter++}`;
        }

        const queryUpd = `
            UPDATE public.bunker_familias
            SET nombre = $1, codigo_familia = $2, descripcion = $3
            WHERE id = $4
            RETURNING id, nombre, codigo_familia, descripcion
        `;
        const resultUpd = await client.query(queryUpd, [nombreClean, codeClean, descClean, famIdNum]);

        if (resultUpd.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, error: 'Familia no encontrada.' });
        }

        const updatedFam = resultUpd.rows[0];

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND ACTUALIZAR FAMILIA]: Modificada exitosamente ID=${famIdNum} Nombre="${updatedFam.nombre}" Código="${updatedFam.codigo_familia}"`);
        res.json({ success: true, message: `Familia "${updatedFam.nombre}" actualizada exitosamente.`, data: updatedFam });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [TAXONOMIA] Error actualizando familia:', error);
        res.status(500).json({ success: false, error: `Error actualizando familia: ${error.message}` });
    }
};

exports.eliminarFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId } = req.params;
        const famIdNum = parseInt(familiaId);

        if (!famIdNum) {
            client.release();
            return res.status(400).json({ success: false, error: 'El ID de la familia es inválido.' });
        }

        // BARRERA DE SEGURIDAD ESTRUCTURAL: Verificar dependencias activas en bunker_relacion_atributo_principal y bunker_articulos
        const checkRel = await client.query(`
            SELECT COUNT(*)::integer as count 
            FROM public.bunker_relacion_atributo_principal 
            WHERE familia_id = $1
        `, [famIdNum]);
        const relacionesCount = checkRel.rows[0].count;

        const checkArt = await client.query(`
            SELECT COUNT(*)::integer as count 
            FROM public.bunker_articulos 
            WHERE familia_id = $1 OR (propiedades_dinamicas->>'familia_id')::integer = $1
        `, [famIdNum]);
        const articulosCount = checkArt.rows[0].count;

        if (relacionesCount > 0 || articulosCount > 0) {
            client.release();
            console.warn(`🚨 [VIGÍA BACKEND BLOQUEO BAJA FAMILIA]: Bloqueada eliminación de Familia ID=${famIdNum} por tener ${relacionesCount} atributos relacionales y ${articulosCount} artículos vinculados.`);
            return res.status(409).json({ 
                success: false, 
                error: `No se puede eliminar la familia porque posee dependencias activas en el sistema.`,
                detalles: {
                    atributos_principales_vinculados: relacionesCount,
                    articulos_vinculados: articulosCount
                }
            });
        }

        await client.query('BEGIN');

        // 1. Eliminar la plantilla posicional de la familia
        await client.query(`DELETE FROM public.bunker_familia_categorias WHERE familia_id = $1`, [famIdNum]);

        // 2. Eliminar la familia maestra
        const resDel = await client.query(`DELETE FROM public.bunker_familias WHERE id = $1 RETURNING id, nombre`, [famIdNum]);

        if (resDel.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, error: 'Familia no encontrada.' });
        }

        const deletedFam = resDel.rows[0];

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND ELIMINAR FAMILIA]: Eliminada exitosamente ID=${deletedFam.id} Nombre="${deletedFam.nombre}"`);
        res.json({ success: true, message: `Familia "${deletedFam.nombre}" eliminada exitosamente.` });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [TAXONOMIA] Error eliminando familia:', error);
        res.status(500).json({ success: false, error: `Error eliminando familia: ${error.message}` });
    }
};

exports.reasignarYEliminarFamilia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId } = req.params;
        const { familia_destino_id } = req.body;

        const origenId = parseInt(familiaId, 10);
        const destinoId = parseInt(familia_destino_id, 10);

        if (!origenId || isNaN(origenId)) {
            client.release();
            return res.status(400).json({ success: false, error: 'ID de familia de origen inválido.' });
        }
        if (!destinoId || isNaN(destinoId)) {
            client.release();
            return res.status(400).json({ success: false, error: 'Debe seleccionar una familia de destino válida.' });
        }
        if (origenId === destinoId) {
            client.release();
            return res.status(400).json({ success: false, error: 'La familia de destino debe ser diferente a la familia de origen.' });
        }

        // Verificar existencia de familias origen y destino
        const checkFam = await client.query(`SELECT id, nombre FROM public.bunker_familias WHERE id IN ($1, $2)`, [origenId, destinoId]);
        if (checkFam.rows.length < 2) {
            client.release();
            return res.status(404).json({ success: false, error: 'No se encontraron las familias especificadas.' });
        }

        const famOrigen = checkFam.rows.find(f => f.id === origenId);
        const famDestino = checkFam.rows.find(f => f.id === destinoId);

        await client.query('BEGIN');

        // 1. Reasignar SKUs en bunker_articulos
        const resArt = await client.query(`
            UPDATE public.bunker_articulos
            SET familia_id = $2::integer,
                propiedades_dinamicas = jsonb_set(
                    COALESCE(propiedades_dinamicas, '{}'::jsonb), 
                    '{familia_id}', 
                    to_jsonb($2::integer)
                )
            WHERE familia_id = $1::integer OR (propiedades_dinamicas->>'familia_id')::integer = $1::integer
        `, [origenId, destinoId]);
        const skusReasignados = resArt.rowCount;

        // 2. Sincronizar bunker_relacion_atributo_principal: Eliminar duplicados en destino antes de reasignar
        await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal r1
            USING public.bunker_relacion_atributo_principal r2
            WHERE r1.familia_id = $1::integer
              AND r2.familia_id = $2::integer
              AND LOWER(r1.articulo_principal_texto) = LOWER(r2.articulo_principal_texto)
              AND LOWER(r1.categoria) = LOWER(r2.categoria)
              AND LOWER(r1.termino_texto) = LOWER(r2.termino_texto)
        `, [origenId, destinoId]);

        const resRel = await client.query(`
            UPDATE public.bunker_relacion_atributo_principal
            SET familia_id = $2::integer
            WHERE familia_id = $1::integer
        `, [origenId, destinoId]);
        const relacionesReasignadas = resRel.rowCount;

        // 3. Eliminar plantilla posicional de la familia de origen
        await client.query(`DELETE FROM public.bunker_familia_categorias WHERE familia_id = $1::integer`, [origenId]);

        // 4. Eliminar la familia de origen
        await client.query(`DELETE FROM public.bunker_familias WHERE id = $1::integer`, [origenId]);

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND REASIGNAR Y ELIMINAR FAMILIA]: Eliminada "${famOrigen.nombre}" (ID=${origenId}). Reasignados ${skusReasignados} SKUs y ${relacionesReasignadas} relaciones a "${famDestino.nombre}" (ID=${destinoId}).`);

        res.json({
            success: true,
            message: `La familia "${famOrigen.nombre}" fue eliminada. Se reasignaron ${skusReasignados} SKUs a "${famDestino.nombre}".`,
            data: {
                familia_eliminada: famOrigen.nombre,
                familia_destino: famDestino.nombre,
                skus_reasignados: skusReasignados,
                relaciones_reasignadas: relacionesReasignadas
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [TAXONOMIA] Error en reasignación y baja de familia:', error);
        res.status(500).json({ success: false, error: `Fallo en reasignación masiva: ${error.message}` });
    }
};

exports.actualizarAbreviaturaFamilia = async (req, res) => {
    const { id } = req.params;
    const { abreviatura } = req.body || {};
    const famIdNum = parseInt(id, 10);

    if (!famIdNum || isNaN(famIdNum)) {
        return res.status(400).json({ success: false, error: 'ID de familia inválido.' });
    }

    const abrevClean = (abreviatura && typeof abreviatura === 'string' && abreviatura.trim().length > 0) 
        ? abreviatura.trim().toUpperCase() 
        : null;

    const client = await req.db.connect();
    try {
        await client.query('BEGIN');

        const query = `
            UPDATE public.bunker_familias
            SET abreviatura = $1
            WHERE id = $2
            RETURNING id, nombre, codigo_familia, abreviatura
        `;
        const result = await client.query(query, [abrevClean, famIdNum]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: `Familia ID ${famIdNum} no localizada.` });
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Abreviatura de familia actualizada exitosamente.',
            data: result.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ [TAXONOMIA] Error actualizando abreviatura de familia ID ${famIdNum}:`, error);
        res.status(500).json({ success: false, error: `Fallo actualizando abreviatura de familia: ${error.message}` });
    } finally {
        client.release();
    }
};

/**
 * 🧹 HERRAMIENTA DE DEPURACIÓN DE EJES HISTÓRICOS v5.10
 * Audita bunker_articulos.propiedades_dinamicas (JSONB) identificando claves legacy o desnormalizadas
 * que no coincidan exactamente con la taxonomía maestra activa en bunker_familia_categorias.
 */
exports.auditarEjesHistoricos = async (req, res) => {
    try {
        // 1. Obtener la taxonomía maestra activa por familia
        const taxRes = await req.db.query(`
            SELECT familia_id, categoria
            FROM public.bunker_familia_categorias
            ORDER BY familia_id, orden_posicional ASC
        `);

        const taxMasterByFam = {};
        taxRes.rows.forEach(r => {
            if (!taxMasterByFam[r.familia_id]) taxMasterByFam[r.familia_id] = [];
            taxMasterByFam[r.familia_id].push(r.categoria);
        });

        // 2. Obtener los nombres de familias
        const famRes = await req.db.query(`SELECT id, nombre FROM public.bunker_familias`);
        const famMap = {};
        famRes.rows.forEach(f => famMap[f.id] = f.nombre);

        // 3. Escanear artículos con propiedades_dinamicas
        const artRes = await req.db.query(`
            SELECT ctid, descripcion, familia_id, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE propiedades_dinamicas IS NOT NULL
        `);

        const anomaliasMap = {}; // Key: familia_id + '||' + clave_detectada

        artRes.rows.forEach(art => {
            const famId = art.familia_id;
            const masterCats = taxMasterByFam[famId] || [];
            const propsJSON = art.propiedades_dinamicas || {};

            const extractedKeys = [];

            // A. Extraer claves desde estructura posicional
            if (propsJSON.posiciones && typeof propsJSON.posiciones === 'object') {
                Object.values(propsJSON.posiciones).forEach(p => {
                    if (p && p.eje) extractedKeys.push(String(p.eje).trim());
                });
            }

            // B. Extraer claves desde formato plano legacy
            Object.keys(propsJSON).forEach(k => {
                if (k !== 'familia_id' && k !== 'familia_nombre' && k !== 'posiciones' &&
                    k !== 'articulo_principal' && k !== 'pos_1' &&
                    !k.startsWith('asistente_') && !k.startsWith('rendimiento_') &&
                    !k.startsWith('tostadero_') && k !== 'codigo_barras_local' &&
                    k !== 'exencion_operativa' && !k.startsWith('_meta') &&
                    !k.startsWith('silencioso_') && !k.startsWith('modo_display_') &&
                    k !== 'presentacion_variable_wip' && k !== 'sufijo_wip' && k !== 'incluir_familia') {
                    extractedKeys.push(k.trim());
                }
            });

            extractedKeys.forEach(clave => {
                // Verificar si la clave coincide exactamente con alguna categoría maestra de la familia
                const esExacta = masterCats.some(mCat => mCat === clave);

                if (!esExacta) {
                    // Buscar sugerencia canónica con coincidencia tolerante (insensible a acentos/mayúsculas)
                    const claveNorm = clave.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                    const canonicMatch = masterCats.find(mCat => {
                        const mNorm = mCat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                        return mNorm === claveNorm;
                    }) || masterCats[0] || 'Desconocido';

                    const anomalyKey = `${famId}||${clave}`;
                    if (!anomaliasMap[anomalyKey]) {
                        anomaliasMap[anomalyKey] = {
                            familia_id: famId,
                            familia_nombre: famMap[famId] || `Familia ID ${famId}`,
                            clave_detectada: clave,
                            categoria_canonica_sugerida: canonicMatch,
                            articulos_afectados_count: 0,
                            ejemplos_skus: []
                        };
                    }
                    anomaliasMap[anomalyKey].articulos_afectados_count++;
                    if (anomaliasMap[anomalyKey].ejemplos_skus.length < 5) {
                        anomaliasMap[anomalyKey].ejemplos_skus.push(art.descripcion || `CTID ${art.ctid}`);
                    }
                }
            });
        });

        const anomaliasList = Object.values(anomaliasMap);
        console.log(`🚨 [VIGÍA DEPURACIÓN v5.10]: Total anomalías detectadas en JSONB = ${anomaliasList.length}`);
        res.json({ success: true, count: anomaliasList.length, anomalias: anomaliasList });
    } catch (error) {
        console.error('❌ [TAXONOMIA] Error en auditoría de ejes históricos:', error);
        res.status(500).json({ success: false, error: `Fallo en auditoría: ${error.message}` });
    }
};

/**
 * ⚡ MUTADOR DE CONSOLIDACIÓN MASIVA JSONB v5.10
 * Realiza un UPDATE transaccional sobre bunker_articulos.propiedades_dinamicas
 * reemplazando la clave histórica desnormalizada por la categoría maestra canónica.
 */
exports.consolidarEjeHistorico = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familiaId, claveDetectada, claveCanonica } = req.body;
        if (!familiaId || !claveDetectada || !claveCanonica) {
            client.release();
            return res.status(400).json({ success: false, error: 'familiaId, claveDetectada y claveCanonica son obligatorios.' });
        }

        const famIdNum = parseInt(familiaId, 10);
        const oldClean = String(claveDetectada).trim();
        const newClean = String(claveCanonica).trim();

        await client.query('BEGIN');

        let totalModificados = 0;

        // 1. Obtener los artículos pertenecientes a la familia por ctid
        const artRes = await client.query(`
            SELECT ctid, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE familia_id = $1 AND propiedades_dinamicas IS NOT NULL
        `, [famIdNum]);

        for (const art of artRes.rows) {
            let props = art.propiedades_dinamicas;
            let modified = false;

            // A. Consolidación en estructura posicional (posiciones.pos_X.eje)
            if (props.posiciones && typeof props.posiciones === 'object') {
                Object.keys(props.posiciones).forEach(posKey => {
                    const posObj = props.posiciones[posKey];
                    if (posObj && posObj.eje) {
                        const ejeCurrent = String(posObj.eje).trim();
                        const currentNorm = ejeCurrent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                        const oldNorm = oldClean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

                        if (currentNorm === oldNorm || ejeCurrent === oldClean) {
                            posObj.eje = newClean;
                            modified = true;
                        }
                    }
                });
            }

            // B. Consolidación en claves de formato plano legacy
            if (props[oldClean] !== undefined) {
                props[newClean] = props[oldClean];
                delete props[oldClean];
                modified = true;
            }

            if (modified) {
                await client.query(`
                    UPDATE public.bunker_articulos
                    SET propiedades_dinamicas = $1
                    WHERE ctid = $2
                `, [props, art.ctid]);
                totalModificados++;
            }
        }

        // 2. Sincronización en cascada sobre bunker_relacion_atributo_principal (v5.11)
        const relRes = await client.query(`
            UPDATE public.bunker_relacion_atributo_principal
            SET categoria = $1
            WHERE familia_id = $2
              AND LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($3, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        `, [newClean, famIdNum, oldClean]);

        // 3. Sincronización en cascada sobre bunker_diccionario (v5.11)
        const dictRes = await client.query(`
            UPDATE public.bunker_diccionario
            SET categoria = $1
            WHERE LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($2, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        `, [newClean, oldClean]);

        await client.query('COMMIT');
        console.log(`✅ [TAXONOMIA CONSOLIDACIÓN v5.11 MULTI-TABLA]: Saneamiento completado. Artículos JSONB: ${totalModificados}, Relaciones: ${relRes.rowCount}, Diccionario: ${dictRes.rowCount} ("${oldClean}" -> "${newClean}").`);

        res.json({
            success: true,
            message: `Consolidación exitosa. Se actualizaron ${totalModificados} artículos y ${relRes.rowCount} relaciones relacionales en la base de datos.`,
            articulos_modificados: totalModificados,
            relaciones_modificadas: relRes.rowCount
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [TAXONOMIA] Error en consolidación de eje histórico:', error);
        res.status(500).json({ success: false, error: `Fallo en consolidación: ${error.message}` });
    } finally {
        client.release();
    }
};
