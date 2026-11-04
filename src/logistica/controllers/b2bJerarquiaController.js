const { pool } = require('../../facturacion/config/database');
const { fork } = require('child_process');
const path = require('path');

/**
 * GET /api/logistica/b2b-jerarquia
 * Obtiene el árbol completo de Familias y Artículos Principales con los ejes dinámicos detectados,
 * las subcategorías por rama y la configuración actual de Nivel 3, Nivel 4 y Nivel 5.
 */
exports.obtenerJerarquiaB2B = async (req, res) => {
    try {
        // 1. Obtener todas las configuraciones guardadas
        const configsRes = await pool.query('SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5 FROM bunker_portal_b2b_jerarquia');
        const configMap = new Map();
        for (const row of configsRes.rows) {
            const key = `${row.familia_id}___${(row.articulo_principal || '').trim().toLowerCase()}`;
            const rawEjeN3 = row.eje_nivel_3 ? String(row.eje_nivel_3).trim() : '';
            const ejesN3 = rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
            configMap.set(key, {
                eje_nivel_3: rawEjeN3,
                ejes_nivel_3: ejesN3,
                reglas_nivel_4: row.reglas_nivel_4 && typeof row.reglas_nivel_4 === 'object' ? row.reglas_nivel_4 : {},
                reglas_nivel_5: row.reglas_nivel_5 && typeof row.reglas_nivel_5 === 'object' ? row.reglas_nivel_5 : {}
            });
        }

        // 2. Obtener todos los artículos con sus familias, artículo principal y posiciones dinámicas
        const articulosRes = await pool.query(`
            SELECT 
                COALESCE(ba.familia_id, 0) as familia_id,
                COALESCE(bf.nombre, ba.rubro, 'General') as familia_nombre,
                ba.propiedades_dinamicas->>'articulo_principal' as articulo_principal,
                ba.propiedades_dinamicas->'posiciones' as posiciones
            FROM bunker_articulos ba
            LEFT JOIN bunker_familias bf ON bf.id = ba.familia_id
            WHERE ba.propiedades_dinamicas->>'articulo_principal' IS NOT NULL 
              AND TRIM(ba.propiedades_dinamicas->>'articulo_principal') != ''
            ORDER BY familia_nombre ASC, articulo_principal ASC
        `);

        // 3. Agrupar por Familia -> Artículo Principal -> Artículos
        const familiasMap = new Map();

        for (const row of articulosRes.rows) {
            const famId = row.familia_id;
            const famNombre = row.familia_nombre;
            const artPrincipal = (row.articulo_principal || '').trim();
            if (!artPrincipal) continue;

            if (!familiasMap.has(famId)) {
                familiasMap.set(famId, {
                    familia_id: famId,
                    familia_nombre: famNombre,
                    articulos_principales: new Map()
                });
            }

            const famObj = familiasMap.get(famId);
            if (!famObj.articulos_principales.has(artPrincipal)) {
                const confKey = `${famId}___${artPrincipal.toLowerCase()}`;
                const savedConf = configMap.get(confKey) || { eje_nivel_3: null, ejes_nivel_3: [], reglas_nivel_4: {}, reglas_nivel_5: {} };

                famObj.articulos_principales.set(artPrincipal, {
                    articulo_principal: artPrincipal,
                    eje_nivel_3: savedConf.eje_nivel_3,
                    ejes_nivel_3: savedConf.ejes_nivel_3 || [],
                    reglas_nivel_4: savedConf.reglas_nivel_4,
                    reglas_nivel_5: savedConf.reglas_nivel_5,
                    raw_articulos: []
                });
            }

            const artObj = famObj.articulos_principales.get(artPrincipal);
            artObj.raw_articulos.push(row.posiciones || {});
        }

        // 4. Para cada Artículo Principal, analizar los ejes globales, sub-ramas (N4) y sub-sub-ramas (N5)
        const resultado = Array.from(familiasMap.values()).map(fam => ({
            familia_id: fam.familia_id,
            familia_nombre: fam.familia_nombre,
            articulos_principales: Array.from(fam.articulos_principales.values()).map(art => {
                // Mapear ejes globales
                const ejesGlobalesMap = new Map(); // eje -> Set of valores
                
                art.raw_articulos.forEach(posiciones => {
                    if (posiciones && typeof posiciones === 'object') {
                        for (const posKey of Object.keys(posiciones)) {
                            const pos = posiciones[posKey];
                            if (pos && pos.eje && pos.valor) {
                                const ejeKey = String(pos.eje).trim().toLowerCase();
                                const valStr = String(pos.valor).trim();
                                if (ejeKey && valStr) {
                                    if (!ejesGlobalesMap.has(ejeKey)) {
                                        ejesGlobalesMap.set(ejeKey, new Set());
                                    }
                                    ejesGlobalesMap.get(ejeKey).add(valStr);
                                }
                            }
                        }
                    }
                });

                // Si tiene ejes_nivel_3 configurado, analizar sub-ramas de Nivel 4 y Nivel 5
                const currentEjesN3 = Array.isArray(art.ejes_nivel_3) && art.ejes_nivel_3.length > 0
                    ? art.ejes_nivel_3
                    : (art.eje_nivel_3 ? String(art.eje_nivel_3).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []);
                const hasEjesN3 = currentEjesN3.length > 0;
                const subramasMap = new Map(); // subcatValor -> { rawProds, ramaEjes: Map(eje -> Set) }

                if (hasEjesN3) {
                    art.raw_articulos.forEach(posiciones => {
                        if (posiciones && typeof posiciones === 'object') {
                            let subcatVal = null;
                            let matchedEjeN3 = null;
                            for (const targetEjeN3 of currentEjesN3) {
                                for (const posKey of Object.keys(posiciones)) {
                                    const pos = posiciones[posKey];
                                    if (pos && pos.eje && String(pos.eje).trim().toLowerCase() === targetEjeN3) {
                                        if (pos.valor && String(pos.valor).trim() !== '') {
                                            subcatVal = String(pos.valor).trim();
                                            matchedEjeN3 = targetEjeN3;
                                            break;
                                        }
                                    }
                                }
                                if (subcatVal) break;
                            }

                            if (!subcatVal) subcatVal = 'General';

                            if (!subramasMap.has(subcatVal)) {
                                subramasMap.set(subcatVal, {
                                    subcategoria: subcatVal,
                                    rawProds: [],
                                    ramaEjes: new Map(),
                                    ejeOrigenN3: matchedEjeN3
                                });
                            }
                            const ramaData = subramasMap.get(subcatVal);
                            ramaData.rawProds.push(posiciones);

                            // Detectar otros ejes disponibles dentro de esta sub-rama (Nivel 4),
                            // excluyendo únicamente el eje que dio origen a esta rama en N3
                            for (const posKey of Object.keys(posiciones)) {
                                const pos = posiciones[posKey];
                                if (pos && pos.eje && pos.valor) {
                                    const otherEje = String(pos.eje).trim().toLowerCase();
                                    const otherVal = String(pos.valor).trim();
                                    const ejeAExcluir = ramaData.ejeOrigenN3 || '';
                                    if (otherEje !== ejeAExcluir && otherVal) {
                                        if (!ramaData.ramaEjes.has(otherEje)) {
                                            ramaData.ramaEjes.set(otherEje, new Set());
                                        }
                                        ramaData.ramaEjes.get(otherEje).add(otherVal);
                                    }
                                }
                            }
                        }
                    });
                }

                // Formatear subramas de Nivel 4 y analizar Nivel 5 para cada una
                const subramas = Array.from(subramasMap.values()).map(ramaData => {
                    const subcatVal = ramaData.subcategoria;
                    const configuredEjeN4 = art.reglas_nivel_4 ? art.reglas_nivel_4[subcatVal] || null : null;
                    const currentEjesN4 = Array.isArray(configuredEjeN4) && configuredEjeN4.length > 0
                        ? configuredEjeN4.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                        : (configuredEjeN4 ? String(configuredEjeN4).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []);
                    const hasEjesN4 = currentEjesN4.length > 0;

                    // Si esta subrama de Nivel 4 tiene eje configurado, analizar sub-sub-ramas para Nivel 5
                    const subSubramasMap = new Map(); // subSubcatVal -> { rawProds, subSubEjes: Map(eje -> Set) }

                    if (hasEjesN4) {
                        ramaData.rawProds.forEach(posiciones => {
                            let subSubcatVal = null;
                            let matchedEjeN4 = null;
                            for (const targetEjeN4 of currentEjesN4) {
                                for (const posKey of Object.keys(posiciones)) {
                                    const pos = posiciones[posKey];
                                    if (pos && pos.eje && String(pos.eje).trim().toLowerCase() === targetEjeN4) {
                                        if (pos.valor && String(pos.valor).trim() !== '') {
                                            subSubcatVal = String(pos.valor).trim();
                                            matchedEjeN4 = targetEjeN4;
                                            break;
                                        }
                                    }
                                }
                                if (subSubcatVal) break;
                            }

                            if (!subSubcatVal) subSubcatVal = 'General';

                            if (!subSubramasMap.has(subSubcatVal)) {
                                subSubramasMap.set(subSubcatVal, {
                                    sub_subcategoria: subSubcatVal,
                                    rawProds: [],
                                    subSubEjes: new Map(),
                                    ejeOrigenN4: matchedEjeN4
                                });
                            }
                            const subSubData = subSubramasMap.get(subSubcatVal);
                            subSubData.rawProds.push(posiciones);

                            // Detectar otros ejes disponibles para Nivel 5 (excluyendo N3 y N4 de este producto)
                            for (const posKey of Object.keys(posiciones)) {
                                const pos = posiciones[posKey];
                                if (pos && pos.eje && pos.valor) {
                                    const otherEje = String(pos.eje).trim().toLowerCase();
                                    const otherVal = String(pos.valor).trim();
                                    const ejeAExcluirN3 = ramaData.ejeOrigenN3 || '';
                                    const ejeAExcluirN4 = subSubData.ejeOrigenN4 || '';
                                    if (otherEje !== ejeAExcluirN3 && otherEje !== ejeAExcluirN4 && otherVal) {
                                        if (!subSubData.subSubEjes.has(otherEje)) {
                                            subSubData.subSubEjes.set(otherEje, new Set());
                                        }
                                        subSubData.subSubEjes.get(otherEje).add(otherVal);
                                    }
                                }
                            }
                        });
                    }

                    // Formatear sub-subramas de Nivel 5
                    const subSubramas = Array.from(subSubramasMap.values()).map(subSubData => {
                        const subSubcatVal = subSubData.sub_subcategoria;
                        const pathKey = `${subcatVal}___${subSubcatVal}`;
                        const configuredEjeN5 = art.reglas_nivel_5 ? art.reglas_nivel_5[pathKey] || null : null;
                        const currentEjesN5 = Array.isArray(configuredEjeN5) && configuredEjeN5.length > 0
                            ? configuredEjeN5.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                            : (configuredEjeN5 ? String(configuredEjeN5).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []);

                        return {
                            sub_subcategoria: subSubcatVal,
                            path_key: pathKey,
                            eje_nivel_5: Array.isArray(configuredEjeN5) ? configuredEjeN5.join(',') : configuredEjeN5,
                            ejes_nivel_5: currentEjesN5,
                            ejes_disponibles: Array.from(subSubData.subSubEjes.entries()).map(([eje, valSet]) => ({
                                eje: eje,
                                valores: Array.from(valSet)
                            }))
                        };
                    });

                    return {
                        subcategoria: subcatVal,
                        eje_nivel_4: Array.isArray(configuredEjeN4) ? configuredEjeN4.join(',') : configuredEjeN4,
                        ejes_nivel_4: currentEjesN4,
                        ejes_disponibles: Array.from(ramaData.ramaEjes.entries()).map(([eje, valSet]) => ({
                            eje: eje,
                            valores: Array.from(valSet)
                        })),
                        sub_subramas: subSubramas
                    };
                });

                return {
                    articulo_principal: art.articulo_principal,
                    eje_nivel_3: art.eje_nivel_3,
                    ejes_nivel_3: currentEjesN3,
                    reglas_nivel_4: art.reglas_nivel_4 || {},
                    reglas_nivel_5: art.reglas_nivel_5 || {},
                    ejes_disponibles: Array.from(ejesGlobalesMap.entries()).map(([eje, valSet]) => ({
                        eje: eje,
                        valores: Array.from(valSet)
                    })),
                    subramas: subramas
                };
            })
        }));

        res.json({
            success: true,
            familias: resultado
        });
    } catch (err) {
        console.error('❌ Error al obtener jerarquía B2B:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/logistica/b2b-jerarquia
 * Guarda o actualiza el eje de Nivel 3, las reglas de Nivel 4 y las reglas de Nivel 5 para una familia y artículo principal.
 */
exports.guardarJerarquiaB2B = async (req, res) => {
    try {
        const { familia_id, articulo_principal, eje_nivel_3, ejes_nivel_3, reglas_nivel_4, reglas_nivel_5 } = req.body;

        if (!articulo_principal) {
            return res.status(400).json({ success: false, error: 'articulo_principal es obligatorio' });
        }

        const famId = familia_id ? parseInt(familia_id) : null;
        const artPrinc = articulo_principal.trim();

        // Normalizar ejes_nivel_3: puede ser array o string separado por comas
        let normalEjesN3 = [];
        if (Array.isArray(ejes_nivel_3)) {
            normalEjesN3 = ejes_nivel_3.map(s => String(s).trim().toLowerCase()).filter(Boolean);
        } else if (eje_nivel_3 && typeof eje_nivel_3 === 'string' && eje_nivel_3.trim() !== '') {
            normalEjesN3 = eje_nivel_3.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        }

        // Eliminar duplicados manteniendo orden de prioridad
        normalEjesN3 = Array.from(new Set(normalEjesN3));
        const ejeN3ToSave = normalEjesN3.length > 0 ? normalEjesN3.join(',') : null;

        // Normalizar reglas_nivel_4 y reglas_nivel_5 (admitir arrays o strings con comas)
        const cleanReglasN4 = {};
        if (reglas_nivel_4 && typeof reglas_nivel_4 === 'object') {
            for (const [k, v] of Object.entries(reglas_nivel_4)) {
                if (Array.isArray(v)) {
                    const cleanArr = Array.from(new Set(v.map(s => String(s).trim().toLowerCase()).filter(Boolean)));
                    if (cleanArr.length > 0) cleanReglasN4[k] = cleanArr.join(',');
                } else if (typeof v === 'string' && v.trim() !== '') {
                    const cleanArr = Array.from(new Set(v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)));
                    if (cleanArr.length > 0) cleanReglasN4[k] = cleanArr.join(',');
                }
            }
        }

        const cleanReglasN5 = {};
        if (reglas_nivel_5 && typeof reglas_nivel_5 === 'object') {
            for (const [k, v] of Object.entries(reglas_nivel_5)) {
                if (Array.isArray(v)) {
                    const cleanArr = Array.from(new Set(v.map(s => String(s).trim().toLowerCase()).filter(Boolean)));
                    if (cleanArr.length > 0) cleanReglasN5[k] = cleanArr.join(',');
                } else if (typeof v === 'string' && v.trim() !== '') {
                    const cleanArr = Array.from(new Set(v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)));
                    if (cleanArr.length > 0) cleanReglasN5[k] = cleanArr.join(',');
                }
            }
        }

        await pool.query(`
            INSERT INTO bunker_portal_b2b_jerarquia (familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (familia_id, articulo_principal)
            DO UPDATE SET 
                eje_nivel_3 = EXCLUDED.eje_nivel_3,
                reglas_nivel_4 = EXCLUDED.reglas_nivel_4,
                reglas_nivel_5 = EXCLUDED.reglas_nivel_5,
                updated_at = NOW()
        `, [famId, artPrinc, ejeN3ToSave, JSON.stringify(cleanReglasN4), JSON.stringify(cleanReglasN5)]);

        res.json({
            success: true,
            mensaje: 'Configuración de jerarquía guardada exitosamente'
        });
    } catch (err) {
        console.error('❌ Error al guardar jerarquía B2B:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/logistica/b2b-jerarquia/listas-iva
 * Obtiene todas las listas de precios y su estado de permitir_toggle_iva
 */
exports.obtenerListasConfigIva = async (req, res) => {
    try {
        const query = `
            SELECT 
                lp.id,
                lp.nombre,
                lp.descripcion,
                COALESCE(cfg.permitir_toggle_iva, false) as permitir_toggle_iva
            FROM bunker_listas_precios lp
            LEFT JOIN bunker_portal_b2b_listas_config cfg ON cfg.lista_id = lp.id
            WHERE lp.activa = true
            ORDER BY lp.id ASC;
        `;
        const result = await pool.query(query);
        res.json({
            success: true,
            listas: result.rows
        });
    } catch (err) {
        console.error('❌ Error al obtener configuración de IVA por lista:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/logistica/b2b-jerarquia/listas-iva
 * Guarda la activación/desactivación del toggle de IVA para una lista de precios
 */
exports.guardarListaConfigIva = async (req, res) => {
    try {
        const { lista_id, permitir_toggle_iva } = req.body;
        if (!lista_id) {
            return res.status(400).json({ success: false, error: 'lista_id es obligatorio' });
        }

        await pool.query(`
            INSERT INTO bunker_portal_b2b_listas_config (lista_id, permitir_toggle_iva, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (lista_id)
            DO UPDATE SET 
                permitir_toggle_iva = EXCLUDED.permitir_toggle_iva,
                updated_at = NOW();
        `, [parseInt(lista_id), Boolean(permitir_toggle_iva)]);

        res.json({
            success: true,
            mensaje: 'Configuración de IVA actualizada exitosamente'
        });
    } catch (err) {
        console.error('❌ Error al guardar configuración de IVA por lista:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/logistica/b2b-jerarquia/sincronizar
 * Dispara directamente el proceso de sincronización a Supabase Cloud (Precios y Listas)
 */
exports.sincronizarCatalogoB2B = async (req, res) => {
    try {
        console.log('🚀 [JERARQUIA-SYNC] Iniciando sincronización de catálogo B2B a Supabase...');
        const syncPreciosPath = path.resolve(__dirname, '../../actualizaPrecios/syncB2BPrecios.js');
        const syncListasPath = path.resolve(__dirname, '../../actualizaPrecios/syncB2BClientesListas.js');

        // 1. Sincronizar Catálogo y Jerarquía
        const codePrecios = await new Promise((resolve) => {
            const child = fork(syncPreciosPath, [], {
                env: { ...process.env, NODE_ENV: 'production' }
            });
            child.on('close', (code) => resolve(code));
            child.on('error', (err) => {
                console.error('💥 [JERARQUIA-SYNC] Error ejecutando syncB2BPrecios:', err);
                resolve(-1);
            });
        });

        // 2. Sincronizar Perfiles y Listas (Permisos de IVA)
        const codeListas = await new Promise((resolve) => {
            const child = fork(syncListasPath, [], {
                env: { ...process.env, NODE_ENV: 'production' }
            });
            child.on('close', (code) => resolve(code));
            child.on('error', (err) => {
                console.error('💥 [JERARQUIA-SYNC] Error ejecutando syncB2BClientesListas:', err);
                resolve(-1);
            });
        });

        if (codePrecios === 0 && codeListas === 0) {
            console.log('✅ [JERARQUIA-SYNC] Sincronización integral exitosa.');
            res.json({ success: true, message: 'Catálogo y configuración de listas sincronizados exitosamente con la nube.' });
        } else {
            console.warn(`⚠️ [JERARQUIA-SYNC] Sincronizadores finalizaron con códigos: precios=${codePrecios}, listas=${codeListas}`);
            res.status(500).json({ success: false, error: `El proceso finalizó con códigos: precios=${codePrecios}, listas=${codeListas}` });
        }
    } catch (err) {
        console.error('❌ Error en sincronización:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
