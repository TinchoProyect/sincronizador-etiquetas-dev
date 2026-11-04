exports.obtenerDiccionario = async (req, res) => {
    try {
        const { q, categoria, solo_atributos } = req.query;
        let whereClauses = ['d.obsoleto IS NOT TRUE'];
        let params = [];
        let pIndex = 1;

        if (solo_atributos === 'true') {
            whereClauses.push("d.categoria IS NOT NULL AND LOWER(TRIM(d.categoria)) NOT IN ('general', 'articulo_principal', 'pos_1')");
        }

        if (categoria) {
            whereClauses.push(`(LOWER(d.categoria) = LOWER($${pIndex++}) OR d.categoria IS NULL OR LOWER(d.categoria) = 'general')`);
            params.push(categoria.trim());
        }

        if (q && q.trim()) {
            whereClauses.push(`(d.termino ILIKE '%' || $${pIndex} || '%' OR d.abreviatura ILIKE '%' || $${pIndex} || '%')`);
            params.push(q.trim());
            pIndex++;
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
            SELECT 
                d.id, 
                d.termino, 
                d.abreviatura, 
                LOWER(TRIM(d.categoria)) AS categoria,
                COALESCE(d.en_revision, false) as en_revision,
                COALESCE(d.obsoleto, false) as obsoleto,
                (
                    SELECT COUNT(*)::int 
                    FROM public.bunker_articulos a 
                    WHERE a.descripcion ILIKE '%' || d.termino || '%' 
                       OR a.descripcion_generada ILIKE '%' || d.termino || '%'
                       OR a.propiedades_dinamicas::text ILIKE '%' || d.termino || '%'
                ) as articulos_asociados_count,
                COALESCE(
                    JSONB_AGG(
                        DISTINCT jsonb_build_object(
                            'familia_id', f_rel.familia_id,
                            'categoria', LOWER(TRIM(f_rel.categoria))
                        )
                    ) FILTER (WHERE f_rel.familia_id IS NOT NULL),
                    '[]'::jsonb
                ) AS vinculaciones_relacionales
            FROM public.bunker_diccionario d
            LEFT JOIN (
                SELECT termino_id, familia_id, categoria 
                FROM public.bunker_relacion_atributo_principal 
                WHERE termino_id IS NOT NULL AND familia_id IS NOT NULL AND categoria IS NOT NULL
                UNION
                SELECT articulo_principal_id AS termino_id, familia_id, 'articulo_principal' AS categoria 
                FROM public.bunker_relacion_atributo_principal 
                WHERE articulo_principal_id IS NOT NULL AND familia_id IS NOT NULL
            ) f_rel ON f_rel.termino_id = d.id
            ${whereSQL}
            GROUP BY d.id, d.termino, d.abreviatura, d.categoria, d.en_revision, d.obsoleto
            ORDER BY d.categoria ASC, d.termino ASC
        `;
        const result = await req.db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo diccionario:', error);
        res.status(500).json({ success: false, error: 'Error conectando a la base de datos' });
    }
};

exports.actualizarTermino = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { id } = req.params;
        const { termino, abreviatura, categoria } = req.body;
        
        console.log(`🚨 [VIGÍA BACKEND UPDATE TÉRMINO POR ID]:`, { id, body: req.body });

        if (!termino || !termino.trim()) {
            client.release();
            return res.status(400).json({ success: false, error: 'El término es obligatorio.' });
        }

        const termIdNum = parseInt(id, 10);
        if (isNaN(termIdNum)) {
            client.release();
            return res.status(400).json({ success: false, error: 'ID de término inválido.' });
        }

        const termClean = termino.trim();
        const abrevClean = (abreviatura && abreviatura.trim()) 
            ? abreviatura.trim().toUpperCase() 
            : termClean.substring(0, 5).toUpperCase();

        await client.query('BEGIN');

        // 1. Obtener término existente por su ID nativo
        const oldRes = await client.query(`SELECT id, termino, categoria FROM public.bunker_diccionario WHERE id = $1`, [termIdNum]);

        if (oldRes.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, error: `Término ID ${termIdNum} no localizado en bunker_diccionario` });
        }

        let catInput = (categoria || '').trim().toLowerCase();
        if (catInput === 'undefined') catInput = '';
        let oldCatClean = (oldRes.rows[0].categoria || '').trim().toLowerCase();
        if (oldCatClean === 'undefined') oldCatClean = '';

        const isPrinc = oldCatClean === 'articulo_principal' || catInput === 'articulo_principal';
        const catClean = isPrinc 
            ? 'articulo_principal' 
            : (catInput || oldCatClean || 'general');

        // 2. Actualización determinista por Primary Key ID nativo (Cero fusiones / Cero borrados colaterales)
        const queryDict = `
            UPDATE public.bunker_diccionario 
            SET termino = $1, abreviatura = $2, categoria = $3, obsoleto = false
            WHERE id = $4
            RETURNING *
        `;
        const result = await client.query(queryDict, [termClean, abrevClean, catClean, termIdNum]);

        // 3. Sincronizar el texto descriptivo de las relaciones vinculadas EXCLUSIVAMENTE por el ID entero
        if (isPrinc) {
            await client.query(`
                UPDATE public.bunker_relacion_atributo_principal
                SET articulo_principal_texto = $1
                WHERE articulo_principal_id = $2
            `, [termClean, termIdNum]);
        } else {
            await client.query(`
                UPDATE public.bunker_relacion_atributo_principal
                SET termino_texto = $1,
                    categoria = CASE WHEN $2::text != '' AND $2::text != 'general' AND $2::text != 'undefined' THEN $2::text ELSE categoria END
                WHERE termino_id = $3
            `, [termClean, catClean, termIdNum]);
        }

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND UPDATE TÉRMINO EXITO]: ID=${termIdNum} actualizado a "${termClean}" [${abrevClean}]`);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error(`🚨 [VIGÍA BACKEND UPDATE TÉRMINO ERROR]:`, error);
        res.status(500).json({ success: false, error: `Fallo interno al actualizar término: ${error.message}` });
    }
};

exports.actualizarMarcadoRevision = async (req, res) => {
    try {
        const { id } = req.params;
        const { en_revision, obsoleto } = req.body;
        
        let updates = [];
        let params = [];
        let pIndex = 1;

        if (en_revision !== undefined) {
            updates.push(`en_revision = $${pIndex++}`);
            params.push(Boolean(en_revision));
        }
        if (obsoleto !== undefined) {
            updates.push(`obsoleto = $${pIndex++}`);
            params.push(Boolean(obsoleto));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No se enviaron campos para actualizar.' });
        }

        params.push(parseInt(id));
        const query = `
            UPDATE public.bunker_diccionario 
            SET ${updates.join(', ')}
            WHERE id = $${pIndex}
            RETURNING *
        `;
        const result = await req.db.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error actualizando marcado ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Fallo interno al actualizar marcado' });
    }
};

exports.buscarArticulosPrincipalesDiccionario = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || !q.trim()) {
            return res.json({ success: true, data: [] });
        }
        
        // Política Universal LAMDA: Términos separados por espacios -> AND acumulativo
        const terms = q.trim().split(/\s+/).filter(Boolean);
        const whereConditions = ['obsoleto IS NOT TRUE', "(categoria IN ('articulo_principal', 'general') OR categoria IS NULL)"];
        const params = [];

        terms.forEach((term, index) => {
            params.push(`%${term}%`);
            whereConditions.push(`(termino ILIKE $${index + 1} OR abreviatura ILIKE $${index + 1})`);
        });

        const query = `
            SELECT id, termino, abreviatura, LOWER(TRIM(categoria)) as categoria
            FROM public.bunker_diccionario
            WHERE ${whereConditions.join(' AND ')}
            ORDER BY (LOWER(TRIM(categoria)) = 'articulo_principal') DESC, termino ASC
            LIMIT 30;
        `;
        const result = await req.db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error en búsqueda determinista de principales:', error);
        res.status(500).json({ success: false, error: 'Error realizando búsqueda en diccionario' });
    }
};

exports.obtenerImpactoEliminacion = async (req, res) => {
    try {
        const { id } = req.params;
        const db = req.db;

        const termRes = await db.query(`SELECT id, termino, categoria FROM public.bunker_diccionario WHERE id = $1`, [id]);
        if (termRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        const { termino, categoria } = termRes.rows[0];

        // Buscar artículos donde la posición contenga este valor
        const artRes = await db.query(`
            SELECT articulo_id, descripcion, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE (propiedades_dinamicas->'posiciones')::text ILIKE $1
               OR propiedades_dinamicas::text ILIKE $1
            LIMIT 10
        `, [`%${termino}%`]);

        res.json({
            success: true,
            id: parseInt(id),
            termino,
            categoria,
            cnt: artRes.rows.length,
            articulos: artRes.rows.map(a => ({ id: a.articulo_id, descripcion: a.descripcion }))
        });
    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error calculando impacto de eliminación ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo impacto de eliminación' });
    }
};

exports.eliminarTerminoForzado = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { id } = req.params;
        
        await client.query('BEGIN');

        const termRes = await client.query(`SELECT id, termino, categoria FROM public.bunker_diccionario WHERE id = $1`, [id]);
        if (termRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        const { termino, categoria } = termRes.rows[0];

        // 1. Vaciar el atributo en los artículos afectados dentro de propiedades_dinamicas->'posiciones'
        await client.query(`
            UPDATE public.bunker_articulos
            SET propiedades_dinamicas = jsonb_set(
                propiedades_dinamicas,
                '{posiciones}',
                COALESCE(
                    (
                        SELECT jsonb_object_agg(
                            key,
                            CASE 
                                WHEN (value->>'valor_id')::int = $1 OR LOWER(value->>'valor') = LOWER($2) THEN NULL
                                ELSE value
                            END
                        )
                        FROM jsonb_each(propiedades_dinamicas->'posiciones')
                    ),
                    '{}'::jsonb
                )
            )
            WHERE propiedades_dinamicas->'posiciones' IS NOT NULL
              AND (propiedades_dinamicas->'posiciones')::text ILIKE $3
        `, [id, termino, `%${termino}%`]);

        // 2. Eliminar relaciones en bunker_relacion_atributo_principal
        await client.query(`
            DELETE FROM public.bunker_relacion_atributo_principal
            WHERE termino_id = $1 
               OR (LOWER(termino_texto) = LOWER($2) AND LOWER(categoria) = LOWER($3))
        `, [id, termino, categoria]);

        // 3. Eliminar físicamente el término en bunker_diccionario
        await client.query(`DELETE FROM public.bunker_diccionario WHERE id = $1`, [id]);

        await client.query('COMMIT');
        res.json({ success: true, message: `Término "${termino}" eliminado y vaciado en artículos exitosamente.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ [DICCIONARIO] Error en eliminación forzada ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Fallo al ejecutar eliminación forzada en cascada' });
    } finally {
        client.release();
    }
};

exports.eliminarTermino = async (req, res) => {
    try {
        const { id } = req.params;
        
        const termRes = await req.db.query(`SELECT id, termino, categoria FROM public.bunker_diccionario WHERE id = $1`, [id]);
        if (termRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        const { termino, categoria } = termRes.rows[0];

        const relRes = await req.db.query(`
            SELECT COUNT(*)::int as cnt
            FROM public.bunker_relacion_atributo_principal
            WHERE termino_id = $1 OR (LOWER(termino_texto) = LOWER($2) AND LOWER(categoria) = LOWER($3))
        `, [id, termino, categoria]);

        const cnt = relRes.rows[0].cnt;
        if (cnt > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `No se puede eliminar el término "${termino}" porque tiene relaciones activas (${cnt}). Utilice la eliminación asistida para vaciarlo en artículos.` 
            });
        }

        await req.db.query(`DELETE FROM public.bunker_diccionario WHERE id = $1`, [id]);
        res.json({ success: true, message: 'Término eliminado exitosamente' });
    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error eliminando término ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message || 'Fallo interno al procesar baja' });
    }
};

exports.crearTerminoEnCategoria = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { 
            familia_id, 
            articulo_principal_id, 
            articulo_principal_texto, 
            termino_id, 
            categoria,
            categoria_id, 
            termino, 
            abreviatura 
        } = req.body;

        const famId = parseInt(familia_id);
        const princIdNum = parseInt(articulo_principal_id);
        const inputTermId = parseInt(termino_id) || null;
        const catIdNum = parseInt(categoria_id) || null;
        const catClean = (categoria || '').toLowerCase().trim();
        const termClean = (termino || '').trim();
        const abrevClean = (abreviatura && abreviatura.trim()) ? abreviatura.trim().toUpperCase() : termClean.substring(0, 5).toUpperCase();

        if (!famId || !princIdNum || (!categoria && !catIdNum) || !termClean || !catClean || catClean === 'undefined') {
            client.release();
            return res.status(400).json({ success: false, error: 'Los IDs de familia, artículo principal, categoría válida y término son obligatorios.' });
        }

        await client.query('BEGIN');

        let finalTerminoId = inputTermId;

        // REGLA ARQUITECTÓNICA: SI VIENE termino_id EXPLÍCITO, SE PROHIBE BÚSQUEDA POR TEXTO.
        if (finalTerminoId) {
            // Verificación estricta por Primary Key ID entero
            const resById = await client.query(`
                SELECT id, termino FROM public.bunker_diccionario 
                WHERE id = $1 AND obsoleto IS NOT TRUE 
                LIMIT 1
            `, [finalTerminoId]);
            if (resById.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(404).json({ success: false, error: `Término ID ${finalTerminoId} no localizado en el diccionario.` });
            }
        } else {
            // Alta de nuevo término como Identidad Primaria Pura por ID (v5.70-rev3)
            const dictRes = await client.query(`
                INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                VALUES ($1, $2, $3, false, false)
                RETURNING id, termino
            `, [termClean, abrevClean, catClean]);
            finalTerminoId = dictRes.rows[0].id;
        }

        // Determinar categoria_id numérico si no vino en el body (Sincronización Canónica v5.82)
        let finalCatId = catIdNum;
        if (!finalCatId && catClean) {
            const fcRes = await client.query(`
                SELECT id FROM public.bunker_familia_categorias
                WHERE familia_id = $1 AND LOWER(TRIM(categoria)) = LOWER(TRIM($2))
                LIMIT 1
            `, [famId, catClean]);
            if (fcRes.rows.length > 0) {
                finalCatId = fcRes.rows[0].id;
            } else if (catClean !== 'articulo_principal' && catClean !== 'general') {
                const resMax = await client.query(
                    `SELECT COALESCE(MAX(orden_posicional), 0) + 1 AS proximo_orden FROM public.bunker_familia_categorias WHERE familia_id = $1`,
                    [famId]
                );
                const nextOrden = parseInt(resMax.rows[0].proximo_orden) || 1;
                const insFc = await client.query(`
                    INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (familia_id, categoria) DO UPDATE SET orden_posicional = EXCLUDED.orden_posicional
                    RETURNING id
                `, [famId, catClean, nextOrden]);
                finalCatId = insFc.rows[0].id;
            }
        }

        const insertResult = await client.query(`
            INSERT INTO public.bunker_relacion_atributo_principal 
                (familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria, categoria_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (familia_id, articulo_principal_id, termino_id, LOWER(categoria)) 
            DO UPDATE SET 
                articulo_principal_texto = EXCLUDED.articulo_principal_texto,
                termino_texto = EXCLUDED.termino_texto,
                categoria_id = EXCLUDED.categoria_id
            RETURNING id, familia_id, articulo_principal_id, termino_id, categoria, categoria_id
        `, [famId, princIdNum, articulo_principal_texto, finalTerminoId, termClean, catClean, finalCatId]);

        await client.query('COMMIT');
        client.release();

        res.json({ 
            success: true, 
            message: `Atributo "${termClean}" (ID ${finalTerminoId}) vinculado exitosamente.`,
            data: insertResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [DICCIONARIO] Error creando/vinculando término por ID:', error);
        res.status(500).json({ success: false, error: `Error creando término: ${error.message}` });
    }
};


exports.obtenerFamilias = async (req, res) => {
    try {
        const query = `
            SELECT id, nombre, codigo_familia, abreviatura, descripcion
            FROM public.bunker_familias
            ORDER BY id ASC
        `;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo familias:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo familias' });
    }
};


exports.obtenerArticulosPrincipales = async (req, res) => {
    try {
        const { familia_id } = req.query;
        const famIdNum = parseInt(familia_id) || null;

        const query = `
            SELECT DISTINCT ON (d.id)
                d.id, 
                d.termino, 
                d.abreviatura,
                LOWER(TRIM(d.categoria)) AS categoria,
                CASE 
                    WHEN r_actual.id IS NOT NULL THEN 1
                    WHEN r_otras.id IS NOT NULL THEN 2
                    ELSE 3
                END AS nivel_prioridad,
                CASE 
                    WHEN r_actual.id IS NOT NULL THEN true 
                    ELSE false 
                END AS prioritario
            FROM public.bunker_diccionario d
            LEFT JOIN public.bunker_relacion_atributo_principal r_actual 
                ON (r_actual.articulo_principal_id = d.id OR r_actual.termino_id = d.id) 
               AND (r_actual.familia_id = $1 OR $1 IS NULL) 
               AND r_actual.categoria = 'articulo_principal'
            LEFT JOIN public.bunker_relacion_atributo_principal r_otras 
                ON (r_otras.articulo_principal_id = d.id OR r_otras.termino_id = d.id) 
               AND (r_otras.familia_id != $1 OR $1 IS NULL) 
               AND r_otras.categoria = 'articulo_principal'
            WHERE d.obsoleto IS NOT TRUE
              AND (
                  r_actual.id IS NOT NULL 
                  OR r_otras.id IS NOT NULL
                  OR (
                      d.termino NOT LIKE '%/%' 
                      AND d.termino NOT LIKE '%x %' 
                      AND d.termino NOT LIKE '%X %'
                      AND d.termino NOT LIKE '% 11%'
                      AND d.termino NOT LIKE '% 27%'
                  )
              )
            ORDER BY d.id ASC
        `;
        const result = await req.db.query(query, [famIdNum]);

        // Ordenar determinísticamente por nivel_prioridad ASC (1: Familia, 2: Principales otorgados a otras familias, 3: Resto) y termino ASC
        const sorted = result.rows.sort((a, b) => {
            if (a.nivel_prioridad !== b.nivel_prioridad) return a.nivel_prioridad - b.nivel_prioridad;
            return a.termino.localeCompare(b.termino);
        });

        res.json({ success: true, data: sorted });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo artículos principales:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listado principal' });
    }
};

exports.obtenerJerarquiaPorPrincipal = async (req, res) => {
    try {
        const { terminoPrincipal } = req.params;
        const { familia_id } = req.query;
        const db = req.db;

        const famIdNum = parseInt(familia_id) || null;
        const princIdNum = (terminoPrincipal && terminoPrincipal !== 'TODOS') ? parseInt(terminoPrincipal) || null : null;

        if (!princIdNum || !famIdNum) {
            return res.json({ success: true, data: {} });
        }

        const sqlRelacional = `
            SELECT 
                fc.id AS categoria_id,
                fc.categoria AS categoria_nombre,
                COALESCE(fc.orden_posicional, 99) AS orden_posicional,
                d.id,
                d.termino,
                d.abreviatura,
                d.en_revision
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_diccionario d ON r.termino_id = d.id
            LEFT JOIN public.bunker_familia_categorias fc 
                   ON (fc.id = r.categoria_id OR (fc.familia_id = r.familia_id AND LOWER(TRIM(fc.categoria)) = LOWER(TRIM(r.categoria))))
            WHERE r.familia_id = $2::integer
              AND r.articulo_principal_id = $1::integer
              AND d.obsoleto IS NOT TRUE
            ORDER BY COALESCE(fc.orden_posicional, 99) ASC, d.termino ASC;
        `;
        const resRel = await db.query(sqlRelacional, [princIdNum, famIdNum]);

        let rowsDict = resRel.rows;

        const jerarquia = {};
        rowsDict.forEach(item => {
            const catIdKey = String(item.categoria_id);
            if (!jerarquia[catIdKey]) jerarquia[catIdKey] = [];
            jerarquia[catIdKey].push(item);
        });

        res.json({ success: true, data: jerarquia });

    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo jerarquía relacional por IDs:', error);
        res.status(500).json({ success: false, error: `Error interno en consulta relacional: ${error.message}` });
    }
};

exports.crearArticuloPrincipal = async (req, res) => {
    const { familia_id, termino, abreviatura, termino_id } = req.body || {};
    const famIdNum = parseInt(familia_id, 10);
    if (!famIdNum || isNaN(famIdNum)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Debe seleccionar una Familia válida para vincular el Atributo Principal.' 
        });
    }

    const termIdNum = parseInt(termino_id, 10) || null;

    if (!termIdNum && (!termino || !termino.trim())) {
        return res.status(400).json({ 
            success: false, 
            error: 'El nombre o el ID del Atributo Principal es obligatorio.' 
        });
    }

    const client = await req.db.connect();
    try {
        await client.query('BEGIN');

        let termRow = null;

        if (termIdNum) {
            // 1A. Si se proveyó termino_id nativo numérico desde el desplegable
            const idRes = await client.query(`
                SELECT id, termino, abreviatura, categoria
                FROM public.bunker_diccionario
                WHERE id = $1 AND obsoleto IS NOT TRUE
            `, [termIdNum]);

            if (idRes.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(404).json({ success: false, error: 'Término no encontrado en el diccionario.' });
            }

            termRow = idRes.rows[0];
            const abrevClean = (abreviatura && abreviatura.trim()) 
                ? abreviatura.trim().toUpperCase() 
                : termRow.abreviatura;

            const updateRes = await client.query(`
                UPDATE public.bunker_diccionario 
                SET categoria = 'articulo_principal', 
                    abreviatura = COALESCE(NULLIF($2, ''), abreviatura) 
                WHERE id = $1 
                RETURNING id, termino, abreviatura, categoria
            `, [termRow.id, abrevClean]);
            termRow = updateRes.rows[0];
            console.log(`🚨 [VIGÍA BACKEND CREAR ARTÍCULO PRINCIPAL]: Promovida categoría por termino_id=${termRow.id} "${termRow.termino}" a articulo_principal`);
        } else {
            // 1B. Buscar o insertar por texto limpio
            const termClean = termino.trim();
            const abrevClean = (abreviatura && abreviatura.trim()) 
                ? abreviatura.trim().toUpperCase() 
                : termClean.substring(0, 5).toUpperCase();

            const existingRes = await client.query(`
                SELECT id, termino, abreviatura, categoria 
                FROM public.bunker_diccionario 
                WHERE LOWER(termino) = LOWER($1) AND obsoleto IS NOT TRUE 
                LIMIT 1
            `, [termClean]);

            if (existingRes.rows.length > 0) {
                termRow = existingRes.rows[0];
                const updateRes = await client.query(`
                    UPDATE public.bunker_diccionario 
                    SET categoria = 'articulo_principal', 
                        abreviatura = COALESCE(NULLIF($2, ''), abreviatura) 
                    WHERE id = $1 
                    RETURNING id, termino, abreviatura, categoria
                `, [termRow.id, abrevClean]);
                termRow = updateRes.rows[0];
            } else {
                const insertRes = await client.query(`
                    INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
                    VALUES ($1, $2, 'articulo_principal', false, false)
                    RETURNING id, termino, abreviatura, categoria
                `, [termClean, abrevClean]);
                termRow = insertRes.rows[0];
            }
        }

        // 2. Vincular en bunker_relacion_atributo_principal por Primary Key ID nativo (v5.75)
        await client.query(`
            INSERT INTO public.bunker_relacion_atributo_principal (familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria)
            VALUES ($1, $2, $3, $2, $3, 'articulo_principal')
            ON CONFLICT DO NOTHING
        `, [famIdNum, termRow.id, termRow.termino]);

        await client.query('COMMIT');
        client.release();

        res.json({ 
            success: true, 
            message: `Atributo Principal "${termRow.termino}" registrado y vinculado exitosamente por ID ${termRow.id}.`, 
            data: { id: termRow.id, termino: termRow.termino, abreviatura: termRow.abreviatura, familia_id: famIdNum } 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [DICCIONARIO] Error creando artículo principal:', error);
        res.status(500).json({ success: false, error: `Error creando Atributo Principal: ${error.message}` });
    }
};

exports.desvincularArticuloPrincipal = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familia_id, articulo_principal_id, termino_id, termino } = req.body || req.query;
        
        const famIdNum = parseInt(familia_id, 10) || null;
        const princIdNum = parseInt(articulo_principal_id, 10) || parseInt(termino_id, 10) || (parseInt(termino, 10) ? parseInt(termino, 10) : null);

        if (!princIdNum) {
            client.release();
            return res.status(400).json({ 
                success: false, 
                error: 'El ID relacional (articulo_principal_id) es obligatorio para el borrado determinista.' 
            });
        }

        await client.query('BEGIN');

        // 🛡️ 1. BARRERA DE INTEGRIDAD RELACIONAL (RESTRICT LÓGICO v5.22)
        // Auditar si existen categorías posicionales hijas vinculadas a esta combinación (familia_id, articulo_principal_id)
        const checkQuery = `
            SELECT COUNT(*)::integer as total_hijos
            FROM public.bunker_relacion_atributo_principal
            WHERE ($1::integer IS NULL OR familia_id = $1::integer)
              AND (articulo_principal_id = $2::integer OR termino_id = $2::integer)
              AND LOWER(categoria) NOT IN ('articulo_principal', 'general');
        `;
        const checkRes = await client.query(checkQuery, [famIdNum, princIdNum]);
        const totalHijos = checkRes.rows[0] ? checkRes.rows[0].total_hijos : 0;

        if (totalHijos > 0) {
            await client.query('ROLLBACK');
            console.warn(`⚠️ [RESTRICT DICCIONARIO] Bloqueo de desvinculación para PrincipalID=${princIdNum} en FamiliaID=${famIdNum}. Contiene ${totalHijos} eje(s) posicional(es) activo(s).`);
            return res.status(400).json({ 
                success: false, 
                error: `No se puede desvincular el Atributo Principal porque contiene ${totalHijos} eje(s) posicional(es) activo(s) vinculado(s) a esta familia. Debe vaciar o desvincular los ejes primero.` 
            });
        }

        // 🛡️ 2. BORRADO RELACIONAL PURO POR INTEGER IDs (CERO HUÉRFANOS GARANTIZADO)
        const deleteQuery = `
            DELETE FROM public.bunker_relacion_atributo_principal
            WHERE ($1::integer IS NULL OR familia_id = $1::integer)
              AND (articulo_principal_id = $2::integer OR termino_id = $2::integer);
        `;
        const result = await client.query(deleteQuery, [famIdNum, princIdNum]);

        await client.query('COMMIT');

        console.log(`🚨 [VIGÍA BACKEND DESVINCULAR ARTÍCULO PRINCIPAL]: Borrado relacional exitoso. FamiliaID=${famIdNum}, PrincipalID=${princIdNum}. Filas eliminadas: ${result.rowCount}`);

        res.json({ 
            success: true, 
            message: `El Atributo Principal (ID ${princIdNum}) fue desvinculado exitosamente de la familia. Filas eliminadas: ${result.rowCount}.`,
            data: { familia_id: famIdNum, articulo_principal_id: princIdNum, filas_eliminadas: result.rowCount }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [DICCIONARIO] Error en borrado relacional determinista:', error);
        res.status(500).json({ success: false, error: `Error en borrado relacional: ${error.message}` });
    } finally {
        client.release();
    }
};

exports.desvincularTerminoJerarquia = async (req, res) => {
    const client = await req.db.connect();
    try {
        const { familia_id, articulo_principal_id, termino_id, categoria } = req.body || req.query;
        const famIdNum = parseInt(familia_id) || null;
        const princIdNum = parseInt(articulo_principal_id) || null;
        const termIdNum = parseInt(termino_id) || null;

        if (!termIdNum || !famIdNum || !princIdNum) {
            client.release();
            return res.status(400).json({ 
                success: false, 
                error: 'Los IDs numéricos de familia, artículo principal y término son obligatorios.' 
            });
        }

        await client.query('BEGIN');

        // Borrado atómico relacional con coincidencia tolerante a acentos en categoría (v5.11)
        const deleteQuery = `
            DELETE FROM public.bunker_relacion_atributo_principal
            WHERE familia_id = $1
              AND articulo_principal_id = $2
              AND termino_id = $3
              AND (LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = LOWER(TRANSLATE($4, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) OR $4 IS NULL)
        `;
        const result = await client.query(deleteQuery, [famIdNum, princIdNum, termIdNum, categoria || null]);

        // BLINDAJE ESTRUCTURAL ANTI-FALSOS POSITIVOS: Exigir rowCount > 0
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            client.release();
            console.warn(`⚠️ [VIGÍA BACKEND DESVINCULAR JERARQUÍA]: 0 filas eliminadas en bunker_relacion_atributo_principal para familia_id=${famIdNum}, articulo_principal_id=${princIdNum}, termino_id=${termIdNum}.`);
            return res.status(404).json({
                success: false,
                error: `No se encontró ninguna relación activa para el Atributo Principal ID ${princIdNum} y Término ID ${termIdNum} en la base de datos.`
            });
        }

        await client.query('COMMIT');
        client.release();

        console.log(`🚨 [VIGÍA BACKEND DESVINCULAR JERARQUÍA]: Desvinculación exitosa por IDs. Filas eliminadas: ${result.rowCount}`);
        res.json({
            success: true,
            message: 'Término desvinculado de la jerarquía exitosamente.',
            data: { familia_id: famIdNum, articulo_principal_id: princIdNum, termino_id: termIdNum, filas_eliminadas: result.rowCount }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        client.release();
        console.error('❌ [DICCIONARIO] Error desvinculando término de jerarquía:', error);
        res.status(500).json({ success: false, error: `Error desvinculando término de jerarquía: ${error.message}` });
    }
};
