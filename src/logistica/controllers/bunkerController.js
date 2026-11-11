const BunkerService = require('../services/bunkerService');
const PDFDocument = require('pdfkit');
const { triggerB2BSync } = require('../../actualizaPrecios/b2bAutoSyncTrigger');

console.log('📦 [BUNKER-CONTROLLER] Cargando controlador del Búnker...');

exports.getListas = async (req, res) => {
    try {
        const listas = await BunkerService.getListasActivas(req.db);
        res.json({ success: true, data: listas });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo listas:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listas' });
    }
};

exports.crearLista = async (req, res) => {
    try {
        const lista = await BunkerService.crearLista(req.db, req.body);
        res.status(201).json({ success: true, data: lista, message: 'Lista de precios creada exitosamente.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error creando lista de precios:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno creando lista' });
    }
};

exports.actualizarLista = async (req, res) => {
    try {
        const { id } = req.params;
        const lista = await BunkerService.actualizarLista(req.db, id, req.body);
        res.json({ success: true, data: lista, message: 'Lista de precios actualizada exitosamente.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error actualizando lista de precios:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno actualizando lista' });
    }
};

exports.eliminarLista = async (req, res) => {
    try {
        const { id } = req.params;
        await BunkerService.eliminarLista(req.db, id);
        res.json({ success: true, message: 'Lista de precios eliminada exitosamente.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error eliminando lista de precios:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno eliminando lista' });
    }
};

exports.obtenerPlantillaPorTermino = async (req, res) => {
    try {
        const { termino, familia_id, articulo_principal_id } = req.query;
        const db = req.db;

        const famIdNum = parseInt(familia_id) || null;
        const princIdNum = parseInt(articulo_principal_id) || null;

        // Consulta SQL 100% Relacional sobre IDs enteros nativos (Sin Cadenas, Sin Regex, Sin LOWER)
        const sqlRelacional = `
            SELECT DISTINCT ON (d.id, COALESCE(r.categoria, d.categoria))
                d.id,
                COALESCE(r.categoria, d.categoria) AS categoria,
                d.termino,
                d.abreviatura,
                COALESCE(d.en_revision, false) AS en_revision,
                CASE 
                    WHEN r.id IS NOT NULL THEN true 
                    ELSE false 
                END AS relacional
            FROM public.bunker_diccionario d
            LEFT JOIN public.bunker_relacion_atributo_principal r 
                ON r.termino_id = d.id
               AND r.familia_id = $1::integer
               AND r.articulo_principal_id = $2::integer
            WHERE d.obsoleto IS NOT TRUE
              AND d.categoria NOT LIKE 'asistente_%'
              AND d.categoria NOT LIKE 'rendimiento_%'
              AND d.termino IS NOT NULL AND TRIM(d.termino) != ''
            ORDER BY d.id, COALESCE(r.categoria, d.categoria), relacional DESC, d.termino ASC;
        `;
        const resRel = await db.query(sqlRelacional, [famIdNum, princIdNum]);
        const resultDictRows = resRel.rows;

        let categoriasUsadas = [];
        if (termino && termino.trim() !== '') {
            const cleanTerm = termino.trim();
            const sqlPlantilla = `
                SELECT categoria, count(*) as uso
                FROM (
                    SELECT jsonb_object_keys(propiedades_dinamicas->'posiciones') as categoria
                    FROM public.bunker_articulos
                    WHERE (propiedades_dinamicas->>'articulo_principal') = $1 
                       OR descripcion = $1 
                       OR descripcion_generada = $1
                ) sub
                WHERE categoria IS NOT NULL 
                  AND categoria NOT LIKE 'asistente_%'
                  AND categoria NOT LIKE 'rendimiento_%'
                  AND categoria != 'codigo_barras_local'
                GROUP BY categoria
                ORDER BY uso DESC
            `;
            const resultPlantilla = await db.query(sqlPlantilla, [cleanTerm]);
            categoriasUsadas = resultPlantilla.rows.map(r => r.categoria);
        }

        console.log(`🚨 [VIGÍA SERVIDOR - PLANTILLA API POR IDs ESTRUCTURAL]: Total devueltos = ${resultDictRows.length}, Relacionales = ${resultDictRows.filter(r => r.relacional).length}`);

        res.json({
            success: true,
            categorias_sugeridas: categoriasUsadas,
            diccionario_categorizado: resultDictRows
        });

    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo plantilla relacional por IDs:', error);
        res.status(500).json({ success: false, error: `Error obteniendo plantilla relacional: ${error.message}` });
    }
};

exports.buscarDiccionario = async (req, res) => {
    try {
        const { q, categoria } = req.query;
        const terminos = await BunkerService.buscarDiccionario(req.db, q || '', categoria);
        res.json({ success: true, data: terminos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando en diccionario:', error);
        res.status(500).json({ success: false, error: 'Error interno consultando diccionario' });
    }
};

/**
 * 🔑 EVALUADOR DE ESTRUCTURA DESFASADA v5.15 (Performance O(1) - Sin N+1 Queries)
 * Carga la taxonomía maestra activa de todas las familias en una sola query SQL (O(1))
 * y audita las claves posicionales del JSONB discriminando metadatos y vacíos.
 */
async function evaluarEstructuraDesfasadaArticulos(db, articulos) {
    if (!Array.isArray(articulos) || articulos.length === 0) return articulos;

    try {
        // Single Query SQL para pre-cargar la plantilla maestra activa por familia (O(1) RAM Map)
        const taxRes = await db.query(`
            SELECT familia_id, categoria
            FROM public.bunker_familia_categorias
            ORDER BY familia_id, orden_posicional ASC
        `);

        const mapTaxonomiaFamilias = {};
        taxRes.rows.forEach(r => {
            if (!mapTaxonomiaFamilias[r.familia_id]) mapTaxonomiaFamilias[r.familia_id] = new Set();
            const norm = r.categoria.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            mapTaxonomiaFamilias[r.familia_id].add(norm);
        });

        articulos.forEach(art => {
            const famId = art.familia_id;
            const masterSet = mapTaxonomiaFamilias[famId] || new Set();
            const propsJSON = art.propiedades_dinamicas || {};

            let tieneResidualesHuerfanos = false;
            let ejesHuerfanos = [];

            if (propsJSON.posiciones && typeof propsJSON.posiciones === 'object') {
                Object.values(propsJSON.posiciones).forEach(p => {
                    if (p && p.eje) {
                        const ejeStr = String(p.eje).trim();
                        const ejeNorm = ejeStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                        if (!masterSet.has(ejeNorm)) {
                            tieneResidualesHuerfanos = true;
                            ejesHuerfanos.push({ eje: ejeStr, valor: p.valor || '' });
                        }
                    }
                });
            }

            // Discriminación Estricta: Se activa ÚNICAMENTE si existen residuales huérfanos
            art.estructura_desfasada = tieneResidualesHuerfanos;
            art.ejes_desfasados = ejesHuerfanos;
        });
    } catch (e) {
        console.warn('⚠️ [BUNKER] Fallo al evaluar estructura desfasada de artículos:', e);
    }
    return articulos;
}

exports.buscarConsolidado = async (req, res) => {
    try {
        const { q, exact_id, solo_con_stock } = req.query;
        if (!q && !exact_id && solo_con_stock !== 'true') {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q o exact_id)' });
        }
        let articulos = await BunkerService.buscarConsolidado(req.db, q || '', {
            exactId: exact_id,
            soloConStock: solo_con_stock === 'true'
        });
        articulos = await evaluarEstructuraDesfasadaArticulos(req.db, articulos);
        res.json({ success: true, data: articulos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando consolidado:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando stock consolidado' });
    }
};

exports.obtenerLegacyConStockPendientes = async (req, res) => {
    try {
        const articulos = await BunkerService.obtenerLegacyConStockPendientes(req.db);
        res.json({ success: true, data: articulos });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo artículos Legacy con stock sin Búnker:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo artículos Legacy con stock pendientes' });
    }
};

exports.buscarTablaMaestra = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const cotizaciones = await BunkerService.buscarTablaMaestra(req.db, q);
        res.json({ success: true, data: cotizaciones });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando en tabla maestra de proveedores:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando cotizaciones de proveedores' });
    }
};

exports.obtenerArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        let articulo = await BunkerService.obtenerArticulo(req.db, id);
        if (!articulo) {
            return res.status(200).json({ success: false, error: 'Artículo no encontrado' });
        }
        const evaluatedArr = await evaluarEstructuraDesfasadaArticulos(req.db, [articulo]);
        res.json({ success: true, data: evaluatedArr[0] });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo artículo:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo artículo' });
    }
};

exports.obtenerTarifasRendimientoColaborador = async (req, res) => {
    try {
        const { colaborador_id } = req.params;
        if (!colaborador_id) {
            return res.status(400).json({ success: false, error: 'Falta el ID del colaborador' });
        }
        
        const query = `
            SELECT 
                ctr.id, 
                ctr.articulo_numero, 
                ctr.valor_por_unidad, 
                ctr.unidad_medida,
                CASE 
                    WHEN LOWER(ctr.unidad_medida) IN ('hr', 'hora', 'horas') OR ctr.articulo_numero = 'HORA' 
                        THEN 'Tarifa Base por Hora'
                    ELSE COALESCE(
                        ba.descripcion_generada,
                        ba.descripcion, 
                        a.nombre, 
                        src.descripcion, 
                        ctr.articulo_numero, 
                        'Servicio Parametrizado General'
                    )
                END AS descripcion
            FROM public.colaboradores_tarifas_rendimiento ctr
            LEFT JOIN public.bunker_articulos ba ON ctr.articulo_numero = CAST(ba.articulo_id AS VARCHAR)
            LEFT JOIN public.articulos a ON ctr.articulo_numero = a.numero
            LEFT JOIN public.stock_real_consolidado src ON ctr.articulo_numero = src.articulo_numero
            WHERE ctr.usuario_id = $1 AND ctr.activo = true
            ORDER BY ctr.articulo_numero ASC
        `;
        const result = await req.db.query(query, [colaborador_id]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo lista de tarifas de rendimiento:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo lista de tarifas de rendimiento' });
    }
};

exports.obtenerTarifaRendimiento = async (req, res) => {
    try {
        const { colaborador_id, sku } = req.query;
        if (!colaborador_id || !sku) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros' });
        }
        const query = `
            SELECT t.id, t.valor_por_unidad, t.unidad_medida, t.articulo_numero, a.nombre as articulo_nombre
            FROM public.colaboradores_tarifas_rendimiento t
            LEFT JOIN public.articulos a ON a.numero = t.articulo_numero
            WHERE t.usuario_id = $1 AND t.articulo_numero = $2 AND t.activo = true
            LIMIT 1
        `;
        let result = await req.db.query(query, [colaborador_id, sku]);
        
        // Fallback: Si no se encuentra tarifa exacta para el SKU de empaque/pack, buscar por prefijo de familia
        if (result.rows.length === 0) {
            let prefix = '';
            if (sku.startsWith('BF')) prefix = 'BF';
            else if (sku.startsWith('APTPG')) prefix = 'APTPG';
            else if (sku.startsWith('APTSPG')) prefix = 'APTSPG';
            else if (sku.startsWith('CCT')) prefix = 'CCT';
            else if (sku.startsWith('GSG')) prefix = 'GSG';
            else if (sku.startsWith('GFG')) prefix = 'GFG';
            
            if (prefix) {
                const queryFallback = `
                    SELECT t.id, t.valor_por_unidad, t.unidad_medida, t.articulo_numero, a.nombre as articulo_nombre
                    FROM public.colaboradores_tarifas_rendimiento t
                    LEFT JOIN public.articulos a ON a.numero = t.articulo_numero
                    WHERE t.usuario_id = $1 AND t.articulo_numero LIKE $2 AND t.activo = true
                    ORDER BY t.id DESC
                    LIMIT 1
                `;
                result = await req.db.query(queryFallback, [colaborador_id, prefix + '%']);
                if (result.rows.length > 0) {
                    console.log(`ℹ️ [BUNKER] Tarifa exacta no encontrada para SKU ${sku}. Usando fallback por prefijo ${prefix}: ${result.rows[0].articulo_numero}`);
                }
            }
        }
        
        if (result.rows.length === 0) {
            return res.json({ success: true, data: null });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo tarifa de rendimiento:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo tarifa de rendimiento' });
    }
};

exports.generarIdentidadLocal = async (req, res) => {
    try {
        const db = req.db;
        const code = await BunkerService.generarCodigoAlfanumericoUnico(db);
        const barcode = await BunkerService.generarCodigoBarrasUnico(db);
        res.json({ success: true, data: { articulo_id: code, codigo_barras: barcode } });
    } catch (error) {
        console.error('❌ [BUNKER] Error generando identidad local:', error);
        res.status(500).json({ success: false, error: error.message || 'Error generando identidad local' });
    }
};

exports.crearArticulo = async (req, res) => {
    try {
        const db = req.db;
        const { articuloData, listasMargenes, nuevos_terminos_diccionario, solo_taxonomia } = req.body;

        if (!articuloData || !articuloData.descripcion) {
            return res.status(400).json({ success: false, error: 'Datos de artículo inválidos o faltantes' });
        }

        // Lógica QA Backend (Fase 3): Autodetectar pack
        const kilos = Number(articuloData.kilos_unidad) || 0;
        const cantidad = Number(articuloData.pack_unidades) || 1;
        articuloData.es_pack = (cantidad > 1 && kilos > 0);

        // Generar IDs locales SI NO VIENEN en el payload o si se solicita crear en local
        let articulo_id = articuloData.articulo_id;
        let codigo_barras = articuloData.codigo_barras;

        const esMarcador = (val) => {
            if (!val) return true;
            const str = String(val).trim();
            return str === '' || str.startsWith('Se generará') || str.includes('Generado') || str.startsWith('Seleccione');
        };

        if (articuloData.crear_local) {
            // Si ya viene pre-generado desde la UI, lo conservamos. Si no, lo aprovisionamos.
            if (esMarcador(articulo_id)) {
                articulo_id = await BunkerService.generarCodigoAlfanumericoUnico(db);
            }
            if (esMarcador(codigo_barras)) {
                codigo_barras = await BunkerService.generarCodigoBarrasUnico(db);
            }
        } else if (esMarcador(articulo_id)) {
            const timestamp = Date.now().toString().slice(-6); 
            const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            articulo_id = `LAMDA-${timestamp}${rnd}`;
            if (esMarcador(codigo_barras)) codigo_barras = `LAMDCB${timestamp}${rnd}`;
        }

        articuloData.articulo_id = articulo_id;
        articuloData.codigo_barras = esMarcador(codigo_barras) ? articulo_id : codigo_barras;

        const esLocal = (articuloData.crear_local || (articulo_id && articulo_id.startsWith('EMB-')));
        if (esLocal && articuloData.codigo_barras) {
            articuloData.propiedades_dinamicas = articuloData.propiedades_dinamicas || {};
            if (typeof articuloData.propiedades_dinamicas === 'string') {
                try {
                    articuloData.propiedades_dinamicas = JSON.parse(articuloData.propiedades_dinamicas);
                } catch (e) {
                    articuloData.propiedades_dinamicas = {};
                }
            }
            articuloData.propiedades_dinamicas.codigo_barras_local = articuloData.codigo_barras;
        }

        // PARCHE CRÍTICO: Asegurar que el Artículo Principal se registre SIEMPRE en el diccionario (categoria = 'articulo_principal')
        let terminosAsegurados = nuevos_terminos_diccionario || [];
        const terminoPrimarioStr = articuloData.descripcion_abreviada || articuloData.descripcion;
        if (terminoPrimarioStr) {
             let baseNombre = terminoPrimarioStr.split('.')[0].trim();
             baseNombre = baseNombre.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]/g, '').trim();
             if (baseNombre && !terminosAsegurados.some(t => t.termino.toLowerCase() === baseNombre.toLowerCase())) {
                  terminosAsegurados.push({
                      termino: baseNombre,
                      abreviatura: baseNombre.substring(0, 3).toUpperCase(),
                      categoria: 'articulo_principal'
                  });
             }
        }

        const resultado = await BunkerService.crearArticuloTransaccional(db, articuloData, listasMargenes, terminosAsegurados, solo_taxonomia);
        if (!solo_taxonomia && articuloData && articuloData.articulo_id) {
            try {
                const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
                await sincronizarCatalogoNodoDesdeBunker(articuloData.articulo_id);
            } catch (syncErr) {
                console.warn('[BUNKER->NODOS] Aviso sincronizando crearArticulo:', syncErr.message);
            }
        }
        triggerB2BSync('precios', `bunker:crearArticulo:${articuloData.articulo_id || ''}`);

        res.status(201).json({
            success: true,
            data: resultado,
            message: 'Artículo creado en el Búnker exitosamente.'
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error creando artículo:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al crear artículo' });
    }
};

exports.eliminarArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await BunkerService.eliminarArticuloTransaccional(req.db, id);
        if (result) {
            try {
                const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
                await sincronizarCatalogoNodoDesdeBunker(id);
            } catch (syncErr) {
                console.warn('[BUNKER->NODOS] Aviso sincronizando eliminarArticulo:', syncErr.message);
            }
            triggerB2BSync('precios', `bunker:eliminarArticulo:${id}`);
            res.json({ success: true, message: 'Artículo eliminado del Búnker exitosamente' });
        } else {
            res.status(404).json({ success: false, error: 'Artículo no encontrado en el Búnker' });
        }
    } catch (error) {
        console.error(`❌ [BUNKER] Error eliminando artículo ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno eliminando artículo' });
    }
};

exports.obtenerTodosLosArticulos = async (req, res) => {
    try {
        const filtros = { 
            search: req.query.search,
            lista_id: req.query.lista_id ? parseInt(req.query.lista_id, 10) : null
        };
        const data = await BunkerService.obtenerTodosLosArticulos(req.db, filtros);
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo grid:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listado' });
    }
};

exports.actualizarArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const { articuloData, listasMargenes, solo_taxonomia } = req.body;

        await BunkerService.actualizarArticuloTransaccional(req.db, id, articuloData, listasMargenes, solo_taxonomia);
        try {
            const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
            await sincronizarCatalogoNodoDesdeBunker(id);
        } catch (syncErr) {
            console.warn('[BUNKER->NODOS] Aviso sincronizando actualizarArticulo:', syncErr.message);
        }
        triggerB2BSync('precios', `bunker:actualizarArticulo:${id}`);

        res.json({ success: true, message: 'Artículo actualizado exitosamente' });
    } catch (error) {
        console.error(`❌ [BUNKER] Error actualizando artículo ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al actualizar artículo' });
    }
};

// ==========================================
// GESTOR DE PRECIOS PARALELO
// ==========================================

exports.obtenerRadiografiaFinanciera = async (req, res) => {
    try {
        const { id } = req.params;
        const finanzas = await BunkerService.obtenerRadiografiaFinanciera(req.db, id);
        res.json({ success: true, data: finanzas });
    } catch (error) {
        console.error(`❌ [BUNKER] Error obteniendo radiografía financiera ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo datos financieros' });
    }
};

exports.actualizarEstructuraFinanciera = async (req, res) => {
    try {
        const { id } = req.params;
        const { costo_base, margenes, configs, asistente_colaborador_id, asistente_minutos, rendimiento_colaborador_id, rendimiento_tarifa_id, rendimiento_cantidad, tostadero_simulacion, pack_unidades, kilos_unidad } = req.body;
        
        await BunkerService.actualizarEstructuraFinancieraTransaccional(req.db, id, { 
            costo_base, 
            margenes, 
            configs, 
            asistente_colaborador_id, 
            asistente_minutos,
            rendimiento_colaborador_id,
            rendimiento_tarifa_id,
            rendimiento_cantidad,
            tostadero_simulacion,
            pack_unidades,
            kilos_unidad
        });
        try {
            const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
            await sincronizarCatalogoNodoDesdeBunker(id);
        } catch (syncErr) {
            console.warn('[BUNKER->NODOS] Aviso sincronizando actualizarEstructuraFinanciera:', syncErr.message);
        }
        triggerB2BSync('precios', `bunker:actualizarEstructuraFinanciera:${id}`);
        res.json({ success: true, message: 'Estructura financiera actualizada exitosamente' });
    } catch (error) {
        console.error(`❌ [BUNKER] Error actualizando finanzas ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno actualizando estructura financiera' });
    }
};

exports.actualizarDisponibilidadArticulo = async (req, res) => {
    try {
        const { articuloId, listaId, disponible } = req.body;
        if (!articuloId || !listaId) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos (articuloId, listaId)' });
        }
        await BunkerService.actualizarDisponibilidadArticulo(req.db, articuloId, listaId, disponible);
        try {
            const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
            await sincronizarCatalogoNodoDesdeBunker(articuloId);
        } catch (syncErr) {
            console.warn('[BUNKER->NODOS] Aviso sincronizando actualizarDisponibilidadArticulo:', syncErr.message);
        }
        triggerB2BSync('precios', `bunker:actualizarDisponibilidadArticulo:${articuloId}`);
        res.json({ success: true, message: 'Disponibilidad del artículo actualizada con éxito en la lista.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error actualizando disponibilidad de artículo:', error);
        res.status(500).json({ success: false, error: 'Error interno actualizando disponibilidad' });
    }
};

exports.buscarInsumosBunker = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const insumos = await BunkerService.buscarInsumosBunker(req.db, q);
        res.json({ success: true, data: insumos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando insumos en bunker:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando insumos en bunker' });
    }
};

exports.obtenerCatalogoPackaging = async (req, res) => {
    try {
        const query = `
            SELECT id, nombre, unidad_medida, COALESCE(costo_patron, 0) as costo_patron, es_insumo
            FROM public.ingredientes
            WHERE es_insumo = true 
               OR nombre ILIKE '%bolsa%' 
               OR nombre ILIKE '%caja%'
               OR nombre ILIKE '%pack%'
            ORDER BY nombre ASC
        `;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo catálogo de packaging:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo catálogo de packaging' });
    }
};

exports.obtenerCatalogoIngredientes = async (req, res) => {
    try {
        const { q } = req.query;
        let sql = `
            SELECT id, nombre, unidad_medida, COALESCE(costo_patron, 0) as costo_patron, es_insumo, articulo_vinculado_numero
            FROM public.ingredientes
            WHERE (es_insumo IS FALSE OR es_insumo IS NULL)
              AND nombre NOT ILIKE '%bolsa%'
              AND nombre NOT ILIKE '%caja%'
              AND nombre NOT ILIKE '%pack%'
        `;
        const sqlParams = [];
        if (q && q.trim()) {
            const tokens = q.trim().split(/\s+/).filter(t => t.length > 0);
            tokens.forEach((token, idx) => {
                sql += ` AND (nombre ILIKE $${idx + 1} OR id::text = $${idx + 1})`;
                sqlParams.push(`%${token}%`);
            });
            sql += ` ORDER BY nombre ASC LIMIT 50`;
            const result = await req.db.query(sql, sqlParams);
            return res.json({ success: true, data: result.rows });
        } else {
            sql += ` ORDER BY nombre ASC LIMIT 300`;
            const result = await req.db.query(sql);
            return res.json({ success: true, data: result.rows });
        }
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo catálogo de materias primas/ingredientes:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo catálogo de ingredientes' });
    }
};

exports.buscarArticulosHijos = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const articulos = await BunkerService.buscarArticulosHijos(req.db, q);
        res.json({ success: true, data: articulos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando artículos hijos:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando artículos hijos' });
    }
};


function obtenerValorOrdenamientoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 0;
    // Soporta tanto objeto parseado como string JSON
    let props = art.propiedades_dinamicas;
    if (typeof props === 'string') {
        try {
            props = JSON.parse(props);
        } catch (e) {
            props = {};
        }
    }
    const prop = props[attribute];
    if (!prop) return 0;
    const val = typeof prop === 'object' ? prop.valor : prop;
    if (!val) return 0;

    // 1. Intentar extraer número de presentación (ej: "10 kg", "envases por 10 kg", "500 g")
    const match = String(val).match(/(\d+(?:\.\d+)?)\s*(kg|g|u|l|ml|unidad)?/i);
    if (match) {
        let num = parseFloat(match[1]);
        let unit = (match[2] || '').toLowerCase();
        if (unit === 'g' || unit === 'ml') {
            num = num / 1000.0; // Normalizar gramos/mililitros
        }
        return num;
    }

    // 2. Fallback semántico cualitativo para ordenamiento de variables nominales comerciales
    const valStr = String(val).toLowerCase();
    if (valStr.includes('grande') || valStr.includes('mayor')) {
        return 100;
    } else if (valStr.includes('medio') || valStr.includes('mediano')) {
        return 50;
    } else if (valStr.includes('chico') || valStr.includes('pequeño')) {
        return 10;
    }

    return String(val); // Fallback a ordenamiento alfabético
}

function obtenerValorFormateadoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 'Sin Especificar';
    let props = art.propiedades_dinamicas;
    if (typeof props === 'string') {
        try {
            props = JSON.parse(props);
        } catch (e) {
            props = {};
        }
    }
    const prop = props[attribute];
    if (!prop) return 'Sin Especificar';
    return typeof prop === 'object' ? prop.valor : prop;
}

exports.exportarPDFListado = async (req, res) => {
    try {
        const { listaId } = req.params;
        const db = req.db;
        const path = require('path');
        const fs = require('fs');

        // 1. Obtener datos de la lista de precios
        const resLista = await db.query(
            'SELECT nombre, descripcion FROM public.bunker_listas_precios WHERE id = $1',
            [listaId]
        );
        if (resLista.rows.length === 0) {
            return res.status(404).send('La lista de precios simulada especificada no existe.');
        }
        const listaNombre = resLista.rows[0].nombre;

        // 2. Obtener todos los artículos del búnker enriquecidos y resolver precios unificados
        const todosLosArticulos = await BunkerService.obtenerTodosLosArticulos(db, {});

        // Mapear al formato esperado por el generador de PDF para la lista especificada,
        // aplicando las reglas de herencia y fallbacks calculadas unificadamente en el servicio.
        const filasArticulos = [];
        for (const art of todosLosArticulos) {
            const mFocused = art.margenes ? art.margenes.find(m => Number(m.lista_id) === Number(listaId)) : null;
            if (!mFocused) continue;
            if (mFocused.disponible === false) continue;

            filasArticulos.push({
                articulo_numero: art.articulo_id,
                descripcion: art.descripcion_generada || art.descripcion,
                kilos_unidad: art.kilos_unidad,
                precio_final: mFocused.precio_final,
                iva: mFocused.iva,
                propiedades_dinamicas: art.propiedades_dinamicas,
                rubro: art.rubro,
                sub_rubro: art.sub_rubro
            });
        }

        // Ordenar alfabéticamente por descripción para mantener consistencia
        filasArticulos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

        if (filasArticulos.length === 0) {
            return res.status(404).send('La lista de precios seleccionada no posee artículos asociados para exportar.');
        }

        const resArticulos = { rows: filasArticulos };

        // 3. Configurar respuesta HTTP para descarga del PDF (Sin exponer nombres internos de lista al cliente)
        const hoyFmt = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        const filename = `Lista_de_Precios_LAMDA_${hoyFmt}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // 4. Procesar columnas activas, categorías, reordenamientos y escalado elástico de anchos (495pt en total)
        const activeColsParam = req.query.columns;
        const rubrosOrderParam = req.query.rubros_order;
        const subrubrosOrderParam = req.query.subrubros_order;
        const hiddenSubrubrosParam = req.query.hidden_subrubros;
        const excludeArticlesParam = req.query.exclude_articles;
        const capaDAttributesParam = req.query.capa_d_attributes;

        let excludeArticlesList = excludeArticlesParam ? excludeArticlesParam.split(',').map(id => id.trim().toLowerCase()) : [];
        let activeCapaDAttributes = capaDAttributesParam && capaDAttributesParam !== 'none' ? capaDAttributesParam.split(',').map(a => a.trim()) : [];
        let subrubrosOrderList = subrubrosOrderParam ? subrubrosOrderParam.split(',').map(s => s.trim()) : null;

        let activeColumns = ['codigo', 'descripcion', 'presentacion', 'kilo', 'bulto']; // default
        if (activeColsParam) {
            activeColumns = activeColsParam.split(',').map(c => c.trim().toLowerCase());
        }

        let rubrosOrderList = rubrosOrderParam ? rubrosOrderParam.split(',').map(r => r.trim()) : null;
        let hiddenSubrubrosList = hiddenSubrubrosParam ? hiddenSubrubrosParam.split(',').map(s => s.trim()) : [];

        // Purgamos definitivamente las columnas de rubros del diccionario de anchos comerciales para la redistribución elástica
        const baseWidthsDict = {
            codigo: 65,
            descripcion: 190,
            presentacion: 100,
            kilo: 70,
            bulto: 70,
            final_kilo: 70,
            final_bulto: 70
        };
        const columnsMeta = {
            codigo: { header: 'Código', align: 'left' },
            descripcion: { header: 'Descripción', align: 'left' },
            presentacion: { header: 'Presentación', align: 'left' },
            kilo: { header: 'Precio Kilo (Neto)', align: 'right' },
            bulto: { header: 'Precio Bulto (Neto)', align: 'right' },
            final_kilo: { header: 'Precio Kilo Final', align: 'right' },
            final_bulto: { header: 'Precio Bulto Final', align: 'right' }
        };

        const activeKeys = activeColumns.filter(k => baseWidthsDict[k] !== undefined);
        if (activeKeys.length === 0) {
            activeKeys.push('descripcion');
        }

        let totalBaseWidth = 0;
        activeKeys.forEach(k => {
            totalBaseWidth += baseWidthsDict[k];
        });

        const colWidths = activeKeys.map(k => {
            const baseW = baseWidthsDict[k];
            return Math.round((baseW / totalBaseWidth) * 495);
        });

        const sumWidths = colWidths.reduce((a, b) => a + b, 0);
        if (sumWidths !== 495 && colWidths.length > 0) {
            colWidths[colWidths.length - 1] += (495 - sumWidths);
        }

        const colAlign = activeKeys.map(k => columnsMeta[k].align);
        const colHeaders = activeKeys.map(k => columnsMeta[k].header);
        const padding = 6;

        // 5. Crear documento PDF
        const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true, info: { Title: filename } });
        doc.pipe(res);

        // Header Institucional: Logo Oficial
        const headerY = doc.y;
        const logoPath = path.join(__dirname, '../img/logo_LAMDA_grande.png');

        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, headerY, { width: 110 });
        } else {
            doc.fontSize(24).font('Helvetica-Bold').fillColor('#8e4785').text('LAMDA', 50, headerY);
        }

        
        // Ajustar posición vertical y agregar título limpio "Lista de precios"
        let yStartText = headerY + 40;
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e293b').text('Lista de Precios', 50, yStartText);

        // Dibujar la fecha/hora de emisión en el extremo superior derecho (sin mostrar el nombre interno de la lista)
        const hoyFmtStr = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(`Emisión: ${hoyFmtStr}`, 350, yStartText + 3, { align: 'right', width: 195 });
        
        doc.y = yStartText + 28;
        
        // Línea divisoria
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1.5).stroke();
        doc.moveDown(1.2);

        // Función para dibujar la cabecera de la tabla
        const dibujarCabeceraTabla = (y) => {
            doc.rect(50, y, 495, 24).fill('#8e4785');
            
            let currentX = 50;
            colHeaders.forEach((h, i) => {
                doc.fontSize(8.5)
                   .font('Helvetica-Bold')
                   .fillColor('#ffffff')
                   .text(h, currentX + padding, y + padding + 1, {
                       width: colWidths[i] - (padding * 2),
                       align: colAlign[i]
                   });
                currentX += colWidths[i];
            });
            
            return y + 24;
        };

        const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

        // Agrupar los artículos en memoria bajo la jerarquía Rubro -> Sub-rubro -> Artículos
        const grouped = {};
        for (const art of resArticulos.rows) {
            const rubroName = (art.rubro || 'SIN RUBRO').trim();
            const subRubroName = (art.sub_rubro || 'SIN SUB-RUBRO').trim();

            // Filtrar si el artículo fue excluido (deseleccionado en la Capa C)
            if (excludeArticlesList.includes(String(art.articulo_numero).trim().toLowerCase())) {
                continue;
            }

            // Filtrar si el sub-rubro está oculto
            if (hiddenSubrubrosList.includes(subRubroName)) {
                continue;
            }

            if (!grouped[rubroName]) {
                grouped[rubroName] = {};
            }
            if (!grouped[rubroName][subRubroName]) {
                grouped[rubroName][subRubroName] = [];
            }
            grouped[rubroName][subRubroName].push(art);
        }

        // Filtrar rubros ocultos (los que no están en la lista de rubrosOrderList si está definida)
        if (rubrosOrderList) {
            for (const r in grouped) {
                if (!rubrosOrderList.includes(r)) {
                    delete grouped[r];
                }
            }
        }

        // Obtener la secuencia ordenada de rubros
        let orderedRubros = [];
        if (rubrosOrderList) {
            orderedRubros = rubrosOrderList.filter(r => grouped[r] !== undefined);
        } else {
            orderedRubros = Object.keys(grouped).sort();
        }
        const activeRubros = orderedRubros.filter(r => grouped[r] !== undefined);

        let currentY = doc.y;

        // Función para validar espacio disponible y evitar cabeceras huérfanas
        const checkEspacioDisponible = (requiredHeight) => {
            if (currentY + requiredHeight > doc.page.height - 78) {
                doc.addPage();
                currentY = 50;
                return true;
            }
            return false;
        };

        // Renderizado por Bloques (Ruptura de Rubro y Sub-rubro)
        const totalRubros = activeRubros.length;
        for (let rIdx = 0; rIdx < totalRubros; rIdx++) {
            const rubro = activeRubros[rIdx];
            let subRubros = Object.keys(grouped[rubro]);
            if (subrubrosOrderList) {
                const orderedSub = subrubrosOrderList.filter(s => subRubros.includes(s));
                subRubros.forEach(s => {
                    if (!orderedSub.includes(s)) {
                        orderedSub.push(s);
                    }
                });
                subRubros = orderedSub;
            } else {
                subRubros.sort();
            }
            
            const activeSubRubros = subRubros.filter(sr => grouped[rubro][sr] && grouped[rubro][sr].length > 0);
            let rubroImpreso = false;
            const totalSubRubros = activeSubRubros.length;

            for (let sIdx = 0; sIdx < totalSubRubros; sIdx++) {
                const subRubro = activeSubRubros[sIdx];
                const articulos = grouped[rubro][subRubro];

                // Aplicar ordenamiento secundario por los múltiples atributos prioritarios de la Capa D
                if (activeCapaDAttributes.length > 0) {
                    articulos.sort((a, b) => {
                        for (const attr of activeCapaDAttributes) {
                            const valA = obtenerValorOrdenamientoCapaD(a, attr);
                            const valB = obtenerValorOrdenamientoCapaD(b, attr);
                            if (valA !== valB) {
                                if (typeof valA === 'number' && typeof valB === 'number') {
                                    return valB - valA; // Descendente por tamaño/peso
                                }
                                return String(valA).localeCompare(String(valB));
                            }
                        }
                        return 0;
                    });
                }

                // Estimar espacio requerido para Rubro, Sub-rubro, Cabecera y al menos la primera fila
                let requiredHeight = 0;
                if (!rubroImpreso) requiredHeight += 25;
                requiredHeight += 20; // Sub-rubro
                requiredHeight += 24; // Cabecera
                requiredHeight += 32; // Primera fila aproximada

                checkEspacioDisponible(requiredHeight);

                // A. Dibujar banner de Rubro Principal
                if (!rubroImpreso) {
                    doc.moveDown(0.5);
                    doc.fontSize(11)
                       .font('Helvetica-Bold')
                       .fillColor('#8e4785')
                       .text(`${rubro.toUpperCase()}`, 50, doc.y);
                    doc.moveDown(0.2);
                    currentY = doc.y;
                    rubroImpreso = true;
                }

                // B. Dibujar sub-divisor de Sub-rubro
                doc.fontSize(9.5)
                   .font('Helvetica-BoldOblique')
                   .fillColor('#475569')
                   .text(`    ${subRubro}`, 50, doc.y);
                doc.moveDown(0.3);
                currentY = doc.y;

                // C. Dibujar Cabecera de la Tabla
                currentY = dibujarCabeceraTabla(currentY);

                // D. Dibujar Artículos de este grupo
                let lastAttrVals = {};
                articulos.forEach((art, index) => {
                    // Comprobar si cambian los valores de los atributos activos de la Capa D
                    let changedIdx = -1;
                    const currentAttrVals = {};
                    activeCapaDAttributes.forEach((attr, idx) => {
                        const val = obtenerValorFormateadoCapaD(art, attr);
                        currentAttrVals[attr] = val;
                        if (changedIdx === -1 && val !== lastAttrVals[attr]) {
                            changedIdx = idx;
                        }
                    });

                    if (changedIdx !== -1) {
                        const subHeaderHeight = 18;
                        
                        // Si al menos un sub-header cambia, dibujamos la cascada
                        for (let i = changedIdx; i < activeCapaDAttributes.length; i++) {
                            const attr = activeCapaDAttributes[i];
                            const attrVal = currentAttrVals[attr];
                            lastAttrVals[attr] = attrVal;
                            
                            // Forzar re-dibujado de los niveles siguientes
                            for (let j = i + 1; j < activeCapaDAttributes.length; j++) {
                                lastAttrVals[activeCapaDAttributes[j]] = null;
                            }
                            
                            const level = i + 1;
                            const indentX = 50 + (25 * level); // Sangría proporcional: Nivel 1 -> X=75, Nivel 2 -> X=100, etc.

                            // Si no cabe en la página actual, agregamos página y redibujamos cabeceras (necesitamos subHeaderHeight + una fila aproximada de 32pt)
                            if (currentY + subHeaderHeight + 32 > doc.page.height - 78) {
                                doc.addPage();
                                currentY = 50;
                                
                                doc.fontSize(11)
                                   .font('Helvetica-Bold')
                                   .fillColor('#8e4785')
                                   .text(`${rubro.toUpperCase()} (Continuación)`, 50, currentY);
                                doc.moveDown(0.2);
                                currentY = doc.y;

                                doc.fontSize(9.5)
                                   .font('Helvetica-BoldOblique')
                                   .fillColor('#475569')
                                   .text(`    ${subRubro} (Continuación)`, 50, currentY);
                                doc.moveDown(0.3);
                                currentY = doc.y;

                                currentY = dibujarCabeceraTabla(currentY);
                            }
                            
                            // Dibujar sub-cabecera divisoria minimalista desalineada con sangrado por nivel
                            doc.fontSize(8)
                               .font('Helvetica-Oblique')
                               .fillColor('#64748b')
                               .text(attrVal, indentX, currentY + 5);
                            
                            currentY += subHeaderHeight;
                        }
                    }

                    const pFinal = parseFloat(art.precio_final || 0);
                    const ivaVal = parseFloat(art.iva || 21.00);
                    const factorKilos = parseFloat(art.kilos_unidad || 0);
                    
                    const precioBultoNeto = pFinal / (1 + (ivaVal / 100));
                    const precioKiloNeto = factorKilos > 0 ? (precioBultoNeto / factorKilos) : precioBultoNeto;
                    const precioBultoFinal = pFinal;
                    const precioKiloFinal = factorKilos > 0 ? (pFinal / factorKilos) : pFinal;

                    let presentacionText = '';
                    if (art.propiedades_dinamicas && art.propiedades_dinamicas.presentacion) {
                        const pres = art.propiedades_dinamicas.presentacion;
                        const presVal = typeof pres === 'object' ? pres.valor : pres;
                        presentacionText = `${presVal} x ${factorKilos.toFixed(2)} kg`;
                    } else {
                        presentacionText = `Bulto x ${factorKilos.toFixed(2)} kg`;
                    }

                    const rowData = [];
                    activeKeys.forEach(key => {
                        if (key === 'codigo') rowData.push(art.articulo_numero);
                        else if (key === 'descripcion') rowData.push(art.descripcion);
                        else if (key === 'presentacion') rowData.push(presentacionText);
                        else if (key === 'kilo') rowData.push(formatter.format(precioKiloNeto));
                        else if (key === 'bulto') rowData.push(formatter.format(precioBultoNeto));
                        else if (key === 'final_kilo') rowData.push(formatter.format(precioKiloFinal));
                        else if (key === 'final_bulto') rowData.push(formatter.format(precioBultoFinal));
                    });

                    let maxHeight = 0;
                    rowData.forEach((text, i) => {
                        const textHeight = doc.heightOfString(text || '', { width: colWidths[i] - (padding * 2) });
                        if (textHeight > maxHeight) maxHeight = textHeight;
                    });
                    const rowHeight = maxHeight + (padding * 2);

                    // Si no cabe, agregamos página y dibujamos cabeceras de continuación
                    if (currentY + rowHeight > doc.page.height - 78) {
                        doc.addPage();
                        currentY = 50;
                        
                        doc.fontSize(11)
                           .font('Helvetica-Bold')
                           .fillColor('#8e4785')
                           .text(`${rubro.toUpperCase()} (Continuación)`, 50, currentY);
                        doc.moveDown(0.2);
                        currentY = doc.y;

                        doc.fontSize(9.5)
                           .font('Helvetica-BoldOblique')
                           .fillColor('#475569')
                           .text(`    ${subRubro} (Continuación)`, 50, currentY);
                        doc.moveDown(0.3);
                        currentY = doc.y;

                        currentY = dibujarCabeceraTabla(currentY);
                    }

                    // Alternancia de color de fila
                    if (index % 2 === 1) {
                        doc.rect(50, currentY, 495, rowHeight).fill('#f8fafc');
                    }

                    let currentX = 50;
                    rowData.forEach((text, i) => {
                        doc.fontSize(8.5)
                           .font('Helvetica')
                           .fillColor('#334155')
                           .text(text, currentX + padding, currentY + padding, {
                               width: colWidths[i] - (padding * 2),
                               align: colAlign[i]
                           });
                        currentX += colWidths[i];
                    });

                    doc.moveTo(50, currentY + rowHeight).lineTo(545, currentY + rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
                    currentY += rowHeight;
                    doc.y = currentY;
                });
                
                const isLast = (rIdx === totalRubros - 1) && (sIdx === totalSubRubros - 1);
                if (!isLast) {
                    doc.moveDown(0.8);
                    currentY = doc.y;
                }
            }
        }

        let pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            const oldBottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.fontSize(7.5).fillColor('#94a3b8').text(
                `LAMDA • Lista de Precios • Página ${i + 1} de ${pages.count}`,
                50,
                doc.page.height - 40,
                { align: 'center', width: 495 }
            );
            doc.page.margins.bottom = oldBottomMargin;
        }

        doc.end();

    } catch (error) {
        console.error('❌ [BUNKER-PDF] Error en exportación PDF comercial:', error);
        res.status(500).send('Falló la generación de la lista de precios comercial en formato PDF.');
    }
};

exports.obtenerMapeoReposicion = async (req, res) => {
    try {
        const { bunker_articulo_id } = req.params;
        const db = req.db;

        // Normalización case-insensitive y redirección transparente si es un artículo fraccionado (pack_hijo_codigo)
        const artRes = await db.query(
            'SELECT articulo_id, pack_hijo_codigo FROM public.bunker_articulos WHERE LOWER(articulo_id) = LOWER($1)',
            [bunker_articulo_id]
        );
        let targetId = bunker_articulo_id;
        if (artRes.rows.length > 0) {
            targetId = artRes.rows[0].pack_hijo_codigo || artRes.rows[0].articulo_id;
        }

        console.log(`🔍 [BUNKER-MAPEO-GET] Recuperando mapeo para ID=${bunker_articulo_id} (Normalizado=${targetId})`);
        const result = await db.query(
            'SELECT proveedor_id, proveedor_producto_codigo FROM public.bunker_articulos_reposicion_mapeo WHERE LOWER(bunker_articulo_id) = LOWER($1)',
            [targetId]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo mapeos de reposición:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo mapeos de reposición' });
    }
};

exports.guardarMapeoReposicion = async (req, res) => {
    const db = req.db;
    try {
        const { bunker_articulo_id } = req.params;
        const { mapeos } = req.body; // array de { proveedor_id, proveedor_producto_codigo }

        if (!Array.isArray(mapeos)) {
            return res.status(400).json({ success: false, error: 'Se esperaba un array de mapeos' });
        }

        // Normalización case-insensitive y redirección transparente si es un artículo fraccionado (pack_hijo_codigo)
        const artRes = await db.query(
            'SELECT articulo_id, pack_hijo_codigo FROM public.bunker_articulos WHERE LOWER(articulo_id) = LOWER($1)',
            [bunker_articulo_id]
        );
        let targetId = bunker_articulo_id;
        if (artRes.rows.length > 0) {
            targetId = artRes.rows[0].pack_hijo_codigo || artRes.rows[0].articulo_id;
        }

        console.log(`💾 [BUNKER-MAPEO-POST] Guardando ${mapeos.length} mapeos para ID=${bunker_articulo_id} (Normalizado=${targetId})`);

        await db.query('BEGIN');

        // Purgar los mapeos existentes para este artículo
        await db.query(
            'DELETE FROM public.bunker_articulos_reposicion_mapeo WHERE LOWER(bunker_articulo_id) = LOWER($1)',
            [targetId]
        );

        // Insertar los nuevos elegidos
        if (mapeos.length > 0) {
            for (const map of mapeos) {
                await db.query(
                    'INSERT INTO public.bunker_articulos_reposicion_mapeo (bunker_articulo_id, proveedor_id, proveedor_producto_codigo) VALUES ($1, $2, $3)',
                    [targetId, map.proveedor_id, map.proveedor_producto_codigo]
                );
            }
        }

        await db.query('COMMIT');
        res.json({ success: true, message: 'Vinculaciones de reposición guardadas exitosamente' });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('❌ [BUNKER] Error guardando mapeos de reposición:', error);
        res.status(500).json({ success: false, error: 'Error interno guardando mapeos de reposición' });
    }
};

// ✅ [FASE 4 - VINCULACIÓN INGREDIENTES] Resolutor atómico de identidades de ingredientes a artículos de búnker
exports.resolverArticuloParaMapeo = async (req, res) => {
    try {
        const { sku, nombre } = req.query;
        const db = req.db;

        if (!sku && !nombre) {
            return res.status(400).json({ success: false, error: 'Se requiere sku o nombre para resolver el mapeo' });
        }

        // Criterio A: Búsqueda ordenada por relevancia estricta en el catálogo directo de Búnker
        const query = `
            SELECT articulo_id, descripcion, descripcion_generada, pack_hijo_codigo
            FROM public.bunker_articulos
            WHERE (articulo_id = $1 AND $1::VARCHAR IS NOT NULL)
               OR (pack_hijo_codigo = $1 AND $1::VARCHAR IS NOT NULL)
               OR (LOWER(descripcion) = LOWER($2) AND $2::VARCHAR IS NOT NULL)
               OR (LOWER(descripcion_generada) = LOWER($2) AND $2::VARCHAR IS NOT NULL)
            ORDER BY 
               CASE WHEN articulo_id = $1 THEN 1
                    WHEN pack_hijo_codigo = $1 THEN 2
                    WHEN LOWER(descripcion) = LOWER($2) THEN 3
                    ELSE 4 END ASC
            LIMIT 1
        `;
        const result = await db.query(query, [sku || null, nombre || null]);

        if (result.rows.length > 0) {
            console.log(`🎯 [BUNKER-RESOLVER] Traducido ingrediente SKU=${sku} Nombre="${nombre}" -> ArticuloID=${result.rows[0].articulo_id}`);
            return res.json({ 
                success: true, 
                articulo_id: result.rows[0].articulo_id, 
                descripcion: result.rows[0].descripcion_generada || result.rows[0].descripcion 
            });
        }

        // Criterio B: Cruce bidireccional secundario por recetas preexistentes (Ingrediente -> receta_ingredientes -> recetas -> bunker_articulos)
        // Evita el falso negativo en ingredientes que no están dados de alta como artículos individuales pero sí forman parte de recetas.
        console.log(`🔍 [BUNKER-RESOLVER] Criterio directo falló para SKU=${sku} Nombre="${nombre}". Iniciando búsqueda por cruce de recetas...`);
        const recetaQuery = `
            SELECT b.articulo_id, b.descripcion, b.descripcion_generada, b.pack_hijo_codigo
            FROM public.bunker_articulos b
            JOIN public.recetas r ON b.articulo_id = r.articulo_numero
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            WHERE (ri.ingrediente_id::VARCHAR = $1 AND $1::VARCHAR IS NOT NULL)
               OR (ri.ingrediente_id::VARCHAR = (SELECT id::VARCHAR FROM public.ingredientes WHERE codigo::VARCHAR = $1 AND $1::VARCHAR IS NOT NULL))
               OR (LOWER(ri.nombre_ingrediente) = LOWER($2) AND $2::VARCHAR IS NOT NULL)
            ORDER BY 
               CASE WHEN ri.ingrediente_id::VARCHAR = $1 THEN 1
                    WHEN LOWER(ri.nombre_ingrediente) = LOWER($2) THEN 2
                    ELSE 3 END ASC
            LIMIT 1
        `;
        const recipeResult = await db.query(recetaQuery, [sku || null, nombre || null]);

        if (recipeResult.rows.length > 0) {
            console.log(`🎯 [BUNKER-RESOLVER] Traducido ingrediente SKU=${sku} Nombre="${nombre}" a través de RECETAS -> ArticuloID=${recipeResult.rows[0].articulo_id}`);
            return res.json({ 
                success: true, 
                articulo_id: recipeResult.rows[0].articulo_id, 
                descripcion: recipeResult.rows[0].descripcion_generada || recipeResult.rows[0].descripcion 
            });
        }

        console.warn(`⚠️ [BUNKER-RESOLVER] No se pudo resolver coincidencia directa ni por recetas para ingrediente SKU=${sku} Nombre="${nombre}"`);
        res.json({ success: false, error: 'No se encontró un artículo correspondiente en el Búnker' });
    } catch (error) {
        console.error('❌ [BUNKER-RESOLVER] Error resolviendo artículo para mapeo:', error);
        res.status(500).json({ success: false, error: 'Error interno resolviendo artículo para mapeo' });
    }
};

// 🖨️ [FASE 4 - IMPRESIÓN ASIMÉTRICA] Invocación directa del motor Zebra para etiqueta doble (comercial + lote)
exports.imprimirEtiquetaDobleBunker = async (req, res) => {
    try {
        const id = req.body?.destino_id || req.body?.articulo_id || req.params.id || req.params[0];
        const db = req.db;

        console.log(`🖨️ [BUNKER-IMPRIMIR] Solicitud recibida para artículo: ${id}`);

        // A. Consultar los datos del artículo búnker y legacy
        const artQuery = `
            SELECT b.articulo_id, b.descripcion_generada, a.codigo_barras
            FROM public.bunker_articulos b
            LEFT JOIN public.articulos a ON b.articulo_id = a.numero
            WHERE b.articulo_id = $1
        `;
        const artRes = await db.query(artQuery, [id]);
        if (artRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Artículo búnker no encontrado' });
        }

        const articulo = artRes.rows[0];

        // B. Consultar el lote a utilizar (si viene en req.body usar ese, si no consultar el último lote activo)
        const { lote_id_supabase, lote_codigo_corto, cantidad } = req.body || {};

        let loteId = lote_id_supabase;
        let loteCodigoCorto = lote_codigo_corto;

        if (!loteId) {
            const loteQuery = `
                SELECT v.lote_id_supabase, v.lote_codigo_corto
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE d.destino_id = $1 AND d.tipo_destino = 'ARTICULO_BUNKER'
                ORDER BY v.fecha_vinculacion DESC
                LIMIT 1
            `;
            const loteRes = await db.query(loteQuery, [id]);
            loteId = loteRes.rows.length > 0 ? loteRes.rows[0].lote_id_supabase : null;
            loteCodigoCorto = loteRes.rows.length > 0 ? loteRes.rows[0].lote_codigo_corto : null;
        }

        // C. Invocar el script de impresión
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiquetaBunker.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const uniqueId = Date.now() + Math.random().toString(36).substring(7);
        const tempFileName = `temp-bunker-${uniqueId}.json`;
        const tempDataPath = path.join(tempDir, tempFileName);

        const datosImpresion = {
            articulo_id: articulo.articulo_id,
            descripcion_generada: articulo.descripcion_generada || 'Sin Descripción',
            codigo_barras: articulo.codigo_barras || '',
            lote_id: loteId, // puede venir null/vacío
            lote_codigo_corto: loteCodigoCorto // puede venir null/vacío
        };

        fs.writeFileSync(tempDataPath, JSON.stringify(datosImpresion, null, 2));

        const cantidadImpresion = parseInt(cantidad, 10) || 2;
        const command = `cd "${path.dirname(path.dirname(__dirname))}" && node "${scriptPath}" ${cantidadImpresion} "${tempDataPath}"`;

        exec(command, (error, stdout, stderr) => {
            // Limpieza
            try {
                if (fs.existsSync(tempDataPath)) {
                    fs.unlinkSync(tempDataPath);
                }
            } catch (e) {
                console.error("Error eliminando temporal:", e);
            }

            if (error) {
                console.error('❌ Error al ejecutar script de impresión:', error);
                return res.status(500).json({ success: false, error: 'Error al enviar orden a la impresora' });
            }

            console.log(`✅ Impresión enviada con éxito para artículo: ${id}`);
            res.json({ success: true, message: 'Impresión de etiqueta doble enviada a la Zebra con éxito' });
        });

    } catch (error) {
        console.error('❌ Error en imprimirEtiquetaDobleBunker:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor procesando la impresión' });
    }
};

// 🖨️ [FASE 4 - IMPRESIÓN ASIMÉTRICA] Invocación directa del motor Zebra para etiqueta doble (ingrediente + lote)
exports.imprimirEtiquetaDobleIngrediente = async (req, res) => {
    try {
        const id = req.body?.destino_id || req.body?.ingrediente_id || req.params.id || req.params[0];
        const db = req.db;

        console.log(`🖨️ [BUNKER-IMPRIMIR-ING] Solicitud recibida para ingrediente: ${id}`);

        // A. Consultar los datos del ingrediente y su sector
        const ingQuery = `
            SELECT i.id, i.nombre, i.codigo, s.nombre as sector_nombre, s.descripcion as sector_descripcion
            FROM public.ingredientes i
            LEFT JOIN public.sectores_ingredientes s ON i.sector_id = s.id
            WHERE i.id = $1
        `;
        const ingRes = await db.query(ingQuery, [id]);
        if (ingRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Ingrediente no encontrado' });
        }

        const ingrediente = ingRes.rows[0];

        // B. Consultar el lote a utilizar (si viene en req.body usar ese, si no consultar el último lote activo)
        const { lote_id_supabase, lote_codigo_corto, cantidad, factor_pack } = req.body || {};

        let loteId = lote_id_supabase;
        let loteCodigoCorto = lote_codigo_corto;
        let factorPackNum = factor_pack !== undefined && factor_pack !== null ? parseFloat(factor_pack) : null;

        if (!loteId) {
            const loteQuery = `
                SELECT v.lote_id_supabase, v.lote_codigo_corto, d.cantidad_asignada, d.kilos_asignados
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE d.destino_id = $1::text AND d.tipo_destino = 'INGREDIENTE_PRODUCCION'
                ORDER BY v.fecha_vinculacion DESC
                LIMIT 1
            `;
            const loteRes = await db.query(loteQuery, [String(id)]);
            if (loteRes.rows.length > 0) {
                loteId = loteRes.rows[0].lote_id_supabase;
                loteCodigoCorto = loteRes.rows[0].lote_codigo_corto;
                if (!factorPackNum) {
                    const cAsig = parseFloat(loteRes.rows[0].cantidad_asignada || 0);
                    const kAsig = parseFloat(loteRes.rows[0].kilos_asignados || 0);
                    if (cAsig > 0 && kAsig > 0) factorPackNum = kAsig / cAsig;
                }
            }
        } else if (!factorPackNum) {
            const destRes = await db.query(`
                SELECT d.cantidad_asignada, d.kilos_asignados
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE v.lote_id_supabase = $1 AND d.destino_id = $2::text AND d.tipo_destino = 'INGREDIENTE_PRODUCCION'
                ORDER BY d.id DESC
                LIMIT 1
            `, [loteId, String(id)]);
            if (destRes.rows.length > 0) {
                const cAsig = parseFloat(destRes.rows[0].cantidad_asignada || 0);
                const kAsig = parseFloat(destRes.rows[0].kilos_asignados || 0);
                if (cAsig > 0 && kAsig > 0) factorPackNum = kAsig / cAsig;
            }
        }

        // C. Normalizar la letra del sector
        let sectorLetra = '';
        const descSector = ingrediente.sector_descripcion || ingrediente.sector_nombre || '';
        if (descSector) {
            const match = descSector.match(/["']([^"']+)["']/);
            if (match) {
                sectorLetra = match[1];
            } else if (descSector.includes('Sector')) {
                sectorLetra = descSector.replace('Sector', '').replace(/["']/g, '').trim();
            } else {
                sectorLetra = descSector;
            }
        }
        if (sectorLetra && sectorLetra.includes('-')) {
            sectorLetra = sectorLetra.split('-')[0].trim();
        }
        sectorLetra = sectorLetra.toUpperCase();

        // Formatear el nombre impreso si existe un factor de agrupación por pack > 1 (ej. x 20)
        let nombreImpresion = (ingrediente.nombre || 'Sin Descripción').trim();
        if (factorPackNum && !isNaN(factorPackNum) && factorPackNum > 1) {
            const factorStr = factorPackNum % 1 === 0 ? factorPackNum.toFixed(0) : factorPackNum.toFixed(2);
            // Detectar si termina en presentación "x 1", "x1", "x 1u", etc. (sin confundir con 3ra dimensión "20 x 20 x 1")
            const matchPorUno = nombreImpresion.match(/^(.*?)\s+(x\s*1(?:\s*(?:u|un|unid|unidad|unidades|kg|kilos))?)\s*$/i);
            const esTerceraDimension = matchPorUno && /\d+\s*x\s*\d+\s*$/i.test(matchPorUno[1]) && !/\d+\s*x\s*\d+\s*x\s*\d+\s*$/i.test(matchPorUno[1]);
            if (matchPorUno && !esTerceraDimension) {
                nombreImpresion = `${matchPorUno[1]} x ${factorStr}`;
            } else {
                const regexYaTiene = new RegExp(`(\\bx\\s*${factorStr}|\\(x\\s*${factorStr}\\))\\s*$`, 'i');
                if (!regexYaTiene.test(nombreImpresion)) {
                    nombreImpresion = `${nombreImpresion} x ${factorStr}`;
                }
            }
        }

        // D. Invocar el script de impresión
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiquetaIngredienteLote.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const uniqueId = Date.now() + Math.random().toString(36).substring(7);
        const tempFileName = `temp-ingrediente-lote-${uniqueId}.json`;
        const tempDataPath = path.join(tempDir, tempFileName);

        const datosImpresion = {
            nombre: nombreImpresion,
            codigo: ingrediente.codigo || '',
            sector: sectorLetra,
            lote_id: loteId,
            lote_codigo_corto: loteCodigoCorto,
            factor_pack: factorPackNum
        };

        fs.writeFileSync(tempDataPath, JSON.stringify(datosImpresion, null, 2));

        const cantidadImpresion = parseInt(cantidad, 10) || 2;
        const command = `cd "${path.dirname(path.dirname(__dirname))}" && node "${scriptPath}" ${cantidadImpresion} "${tempDataPath}"`;

        exec(command, (error, stdout, stderr) => {
            // Limpieza
            try {
                if (fs.existsSync(tempDataPath)) {
                    fs.unlinkSync(tempDataPath);
                }
            } catch (e) {
                console.error("Error eliminando temporal:", e);
            }

            if (error) {
                console.error('❌ Error al ejecutar script de impresión de ingrediente+lote:', error);
                return res.status(500).json({ success: false, error: 'Error al enviar orden a la impresora' });
            }

            console.log(`✅ Impresión enviada con éxito para ingrediente: ${id}`);
            res.json({ success: true, message: 'Impresión de etiqueta doble de ingrediente enviada a la Zebra con éxito' });
        });

    } catch (error) {
        console.error('❌ Error en imprimirEtiquetaDobleIngrediente:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor procesando la impresión' });
    }
};

exports.actualizarMargenesEnMasa = async (req, res) => {
    try {
        const db = req.db;
        const { lista_id, articulo_ids, margen_ganancia, modo_iva, porcentaje_iva } = req.body;

        if (!lista_id || !articulo_ids || !Array.isArray(articulo_ids) || articulo_ids.length === 0 || margen_ganancia === undefined || margen_ganancia === null) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos o formato inválido.' });
        }

        const margenVal = parseFloat(margen_ganancia);
        if (isNaN(margenVal)) {
            return res.status(400).json({ success: false, error: 'El margen debe ser un valor numérico.' });
        }

        // Mapear y sanitizar parámetro impositivo opcional (modo_iva o porcentaje_iva)
        let modoIvaMapped = 'MANTENER';
        const inputIva = modo_iva !== undefined && modo_iva !== null ? modo_iva : porcentaje_iva;
        if (inputIva !== undefined && inputIva !== null) {
            const s = String(inputIva).trim().toUpperCase();
            if (s === '100' || s === '100%' || s === 'COMPLETO') {
                modoIvaMapped = 'COMPLETO';
            } else if (s === '50' || s === '50%' || s === 'MEDIO') {
                modoIvaMapped = 'MEDIO';
            } else if (s === '0' || s === '0%' || s === 'SIN' || s === 'EXENTO') {
                modoIvaMapped = 'SIN';
            } else if (s === 'MANTENER' || s === 'MANTENER ACTUAL' || s === 'KEEP') {
                modoIvaMapped = 'MANTENER';
            }
        }

        await BunkerService.actualizarMargenesEnMasa(db, parseInt(lista_id, 10), articulo_ids, margenVal, modoIvaMapped);
        try {
            const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
            for (const artId of articulo_ids) {
                await sincronizarCatalogoNodoDesdeBunker(artId);
            }
        } catch (syncErr) {
            console.warn('[BUNKER->NODOS] Aviso sincronizando actualizarMargenesEnMasa:', syncErr.message);
        }
        triggerB2BSync('precios', `bunker:actualizarMargenesEnMasa:${lista_id}`);

        res.json({ success: true, message: 'Márgenes actualizados en masa exitosamente.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error en actualización en masa de márgenes:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al actualizar márgenes en masa.' });
    }
};

exports.actualizarHabilitacionEnMasa = async (req, res) => {
    try {
        const db = req.db;
        const { lista_id, articulo_ids, disponible } = req.body;

        if (!lista_id || !articulo_ids || !Array.isArray(articulo_ids) || articulo_ids.length === 0 || disponible === undefined) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos o formato inválido.' });
        }

        const isDisponible = !!disponible;

        await BunkerService.actualizarHabilitacionEnMasa(db, parseInt(lista_id, 10), articulo_ids, isDisponible);
        try {
            const { sincronizarCatalogoNodoDesdeBunker } = require('../../produccion/services/nodosBarrialesService');
            for (const artId of articulo_ids) {
                await sincronizarCatalogoNodoDesdeBunker(artId);
            }
        } catch (syncErr) {
            console.warn('[BUNKER->NODOS] Aviso sincronizando actualizarHabilitacionEnMasa:', syncErr.message);
        }
        triggerB2BSync('precios', `bunker:actualizarHabilitacionEnMasa:${lista_id}`);

        res.json({ success: true, message: 'Disponibilidad de catálogo actualizada en masa exitosamente.' });
    } catch (error) {
        console.error('❌ [BUNKER] Error en actualización en masa de catálogo:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al actualizar catálogo en masa.' });
    }
};

/**
 * 🏭 Obtener sufijos WIP históricos registrados en public.bunker_articulos
 */
exports.obtenerSufijosWIPHistorico = async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT (propiedades_dinamicas->>'sufijo_wip') AS sufijo
            FROM public.bunker_articulos
            WHERE (propiedades_dinamicas->>'presentacion_variable_wip')::boolean = true
              AND propiedades_dinamicas->>'sufijo_wip' IS NOT NULL
              AND TRIM(propiedades_dinamicas->>'sufijo_wip') <> ''
            ORDER BY sufijo ASC;
        `;
        const result = await req.db.query(query);
        const sufijos = result.rows.map(r => r.sufijo);
        res.json({ success: true, data: sufijos });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo sufijos WIP históricos:', error);
        res.json({ success: true, data: ['UP Variable', 'A Granel', 'Sub-Producto Tostado'] });
    }
};

/**
 * ✉️ Generar PDF de Cotización / Consulta de Precios personalizada para Cliente
 */
/**
 * 📄 Generar Buffer de Cotización / Catálogo PDF
 * Retorna { buffer, filename }
 */
exports.generarPDFCotizacionBuffer = async (params = {}, db = null) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!db) {
                db = require('../config/database').pool;
            }
            let {
                cliente_nombre,
                politica_texto,
                whatsapp,
                lista_nombre,
                lista_id,
                listaId,
                titulo_informe,
                modo_iva,
                modo_precio,
                mostrar_hijos,
                separar_packs,
                agrupar_por_atributo,
                ocultar_columna_iva,
                destacar_ofertas,
                bonificacion_volumen,
                mostrar_composicion_mixes,
                articulos
            } = params;

            const path = require('path');
            const fs = require('fs');
            const PDFDocument = require('pdfkit');

            // Si no se proporcionaron artículos manualmente, resolver automáticamente a partir de lista_id
            if (!articulos || !Array.isArray(articulos) || articulos.length === 0) {
                const targetListaId = parseInt(lista_id || listaId, 10);
                if (!isNaN(targetListaId) && targetListaId > 0) {
                    const BunkerService = require('../services/bunkerService');

                if (!lista_nombre) {
                    try {
                        const resLista = await db.query('SELECT nombre FROM public.bunker_listas_precios WHERE id = $1', [targetListaId]);
                        if (resLista.rows.length > 0) {
                            lista_nombre = resLista.rows[0].nombre;
                        }
                    } catch (eLista) {
                        console.warn('[BUNKER-PDF] Advertencia al obtener nombre de lista:', eLista.message);
                    }
                }

                const todosLosArticulos = await BunkerService.obtenerTodosLosArticulos(db, {});

                let ofertasActivas = [];
                try {
                    const OfertasDinamicasService = require('../../presupuestos/services/ofertasDinamicasService');
                    ofertasActivas = await OfertasDinamicasService.obtenerOfertas(db, true);
                } catch (eOf) {}

                let mixesComposicionMap = {};
                try {
                    const resMix = await db.query(`
                        WITH mix_ingredientes AS (
                            SELECT 
                                m.id AS mix_id,
                                LOWER(TRIM(REGEXP_REPLACE(m.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) AS clean_name,
                                STRING_AGG(sub.nombre, ', ' ORDER BY ic.id) AS composicion
                            FROM public.ingrediente_composicion ic
                            JOIN public.ingredientes m ON m.id = ic.mix_id
                            JOIN public.ingredientes sub ON sub.id = ic.ingrediente_id
                            GROUP BY m.id, m.nombre
                        )
                        SELECT 
                            ba.articulo_id,
                            mi.composicion
                        FROM public.bunker_articulos ba
                        JOIN public.recetas r ON r.articulo_numero = ba.articulo_id
                        JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                        JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                        JOIN mix_ingredientes mi ON (
                            i.id = mi.mix_id 
                            OR LOWER(TRIM(REGEXP_REPLACE(i.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) = mi.clean_name
                        )
                        GROUP BY ba.articulo_id, mi.composicion
                    `);
                    resMix.rows.forEach(r => {
                        mixesComposicionMap[r.articulo_id] = r.composicion;
                    });
                } catch (eMix) {}

                const articulosMapeados = [];
                for (const art of todosLosArticulos) {
                    const mFocused = art.margenes ? art.margenes.find(m => Number(m.lista_id) === targetListaId) : null;
                    if (!mFocused) continue;
                    if (mFocused.disponible === false) continue;

                    const pFinal = parseFloat(mFocused.precio_final || 0);
                    const ivaVal = parseFloat(mFocused.iva || 21.00);
                    const factorKg = parseFloat(art.kilos_unidad || 1.0);
                    const pKiloFinal = factorKg > 0 ? (pFinal / factorKg) : pFinal;

                    let presStr = factorKg >= 1.0 ? `${factorKg.toFixed(2)} kg` : `${Math.round(factorKg * 1000)} g`;
                    if (factorKg <= 0) presStr = 'Unidad';

                    let ofertaActiva = null;
                    if (ofertasActivas && ofertasActivas.length > 0) {
                        ofertaActiva = ofertasActivas.find(of => {
                            const matchesArt = String(of.articulo_id) === String(art.articulo_id);
                            const matchesLista = !of.lista_id || Number(of.lista_id) === targetListaId;
                            return matchesArt && matchesLista;
                        }) || null;
                    }

                    const padreItem = {
                        articulo_id: art.articulo_id,
                        nomenclatura: art.nomenclatura || art.descripcion_generada || art.descripcion || `Art #${art.articulo_id}`,
                        kilos_unidad: factorKg,
                        presentacion_str: presStr,
                        iva: ivaVal,
                        precio_bulto_final: pFinal,
                        precio_kilo_final: pKiloFinal,
                        es_hijo: false,
                        padre_id: null,
                        art_original: art,
                        composicion: mixesComposicionMap[art.articulo_id] || null,
                        oferta_activa: ofertaActiva
                    };
                    articulosMapeados.push(padreItem);

                    const packUnits = parseInt(art.pack_unidades || 1, 10);
                    const esPackFlag = art.es_pack === true || art.es_pack === 'true' || art.es_pack === 1 || art.es_pack === 't';
                    const esPackReal = esPackFlag && (packUnits > 1 || !!art.pack_hijo_codigo);

                    if (esPackReal && mostrar_hijos !== false && mostrar_hijos !== 'false') {
                        const hijoObjReal = art.pack_hijo_codigo ? todosLosArticulos.find(a => String(a.articulo_id).toLowerCase() === String(art.pack_hijo_codigo).toLowerCase()) : null;
                        const factorKgHijo = hijoObjReal ? parseFloat(hijoObjReal.kilos_unidad || (factorKg / packUnits)) : (factorKg / packUnits);
                        const pFinalHijo = factorKgHijo * pKiloFinal;
                        const presStrHijo = factorKgHijo < 1.0 ? `${Math.round(factorKgHijo * 1000)} g` : `${factorKgHijo.toFixed(2)} kg`;

                        let nomHijo = (hijoObjReal && hijoObjReal.nomenclatura) ? hijoObjReal.nomenclatura : padreItem.nomenclatura;
                        nomHijo = nomHijo.replace(/\b\d+\s*x\s*\d*\s*[a-zA-Z]*\b/gi, '').trim();
                        if (!nomHijo || nomHijo.length < 3) nomHijo = padreItem.nomenclatura;

                        articulosMapeados.push({
                            articulo_id: hijoObjReal ? hijoObjReal.articulo_id : `${art.articulo_id}_HIJO`,
                            nomenclatura: nomHijo,
                            kilos_unidad: factorKgHijo,
                            presentacion_str: presStrHijo,
                            iva: ivaVal,
                            precio_bulto_final: pFinalHijo,
                            precio_kilo_final: pKiloFinal,
                            es_hijo: true,
                            padre_id: art.articulo_id,
                            padre_nombre: padreItem.nomenclatura,
                            art_original: art,
                            composicion: null,
                            oferta_activa: null
                        });
                    }
                }

                const padres = articulosMapeados.filter(a => !a.es_hijo);
                const hijos = articulosMapeados.filter(a => a.es_hijo);
                padres.sort((a, b) => parseFloat(b.kilos_unidad || 0) - parseFloat(a.kilos_unidad || 0));

                const ordenados = [];
                padres.forEach(p => {
                    ordenados.push(p);
                    const hijasPadre = hijos.filter(h => String(h.padre_id) === String(p.articulo_id));
                    hijasPadre.forEach(h => ordenados.push(h));
                });

                const procesadosIds = new Set(ordenados.map(r => String(r.articulo_id)));
                articulosMapeados.forEach(item => {
                    if (!procesadosIds.has(String(item.articulo_id))) {
                        ordenados.push(item);
                    }
                });

                articulos = ordenados;
            }
        }

        if (!articulos || !Array.isArray(articulos) || articulos.length === 0) {
            const err = new Error('Debe seleccionar al menos un artículo o una lista de precios activa para generar la cotización.');
            err.status = 400;
            throw err;
        }

        // Sanitizador determinista para fuentes estándar PDFKit (WinAnsiEncoding / Latin-1)
        // Evita que glifos Unicode fuera de tabla (como ◆ U+25C6 -> %Æ o ↳ U+21B3) se corrompan en el PDF.
        const limpiarTextoWinAnsi = (txt) => {
            if (txt === null || txt === undefined) return '';
            return String(txt)
                .replace(/[\u25C6\u25C7\u25B8\u25B6\u21B3]/g, '»')
                .replace(/[\u25A0\u25AA\u25CF]/g, '•')
                .replace(/[\u2192\u2794\u279C]/g, '->')
                .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u203A\u20AC\u2122]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };

        // Garantía determinista de precios por artículo: ningún artículo puede salir en $ 0,00 si existe en la lista asignada
        const targetListaIdFallback = parseInt(lista_id || listaId || 1, 10) || 1;
        const requiereLookupDb = articulos.some(a => {
            const pB = parseFloat(a.precio_bulto_final || a.precio_nuevo_vigente || a.precio_nuevo_bulto || (a.precios && (a.precios[targetListaIdFallback] || a.precios[String(targetListaIdFallback)])) || 0);
            return !(pB > 0);
        });

        let mapaPreciosDbFallback = new Map();
        if (requiereLookupDb && db) {
            try {
                const todosLosArticulosDb = await BunkerService.obtenerTodosLosArticulos(db, {});
                for (const artDb of (todosLosArticulosDb || [])) {
                    const mFocused = (artDb.margenes || []).find(m => Number(m.lista_id) === Number(targetListaIdFallback) && m.disponible !== false);
                    const pFinalDb = mFocused ? parseFloat(mFocused.precio_final || 0) : 0;
                    if (pFinalDb > 0) {
                        const infoDb = {
                            precio_final: pFinalDb,
                            iva: parseFloat((mFocused && mFocused.iva) || 21),
                            kilos_unidad: parseFloat(artDb.kilos_unidad || 1) || 1,
                            nombre: artDb.descripcion_generada || artDb.descripcion || ''
                        };
                        if (artDb.articulo_id) {
                            mapaPreciosDbFallback.set(String(artDb.articulo_id).trim().toLowerCase(), infoDb);
                        }
                        if (artDb.id) {
                            mapaPreciosDbFallback.set(String(artDb.id).trim().toLowerCase(), infoDb);
                        }
                    }
                }
            } catch (eLookup) {
                console.warn('[BUNKER-PDF] Advertencia en lookup determinista de precios:', eLookup.message);
            }
        }

        articulos = articulos.map(a => {
            const skuKey = String(a.codigo || a.articulo_id || a.codigo_unico || a.articulo_numero || a.id || '').trim().toLowerCase();
            const dbInfo = skuKey ? mapaPreciosDbFallback.get(skuKey) : null;
            const factorKg = parseFloat(a.kilos_unidad || a.peso_bulto || (dbInfo && dbInfo.kilos_unidad) || 1) || 1;

            let pBulto = parseFloat(
                a.precio_bulto_final
                || a.precio_nuevo_vigente
                || a.precio_nuevo_bulto
                || (a.precios && (a.precios[targetListaIdFallback] || a.precios[String(targetListaIdFallback)]))
                || (dbInfo ? dbInfo.precio_final : 0)
                || 0
            );
            let pKilo = parseFloat(
                a.precio_kilo_final
                || a.precio_nuevo_kilo
                || (factorKg > 0 && pBulto > 0 ? (pBulto / factorKg) : pBulto)
                || 0
            );
            if (!(pBulto > 0) && pKilo > 0) {
                pBulto = pKilo * factorKg;
            }
            return {
                ...a,
                articulo_id: a.codigo || a.articulo_id || a.codigo_unico || a.articulo_numero || a.id,
                nomenclatura: limpiarTextoWinAnsi(a.nomenclatura || a.nombre_visible || a.descripcion_generada || a.nombre || a.descripcion || (dbInfo && dbInfo.nombre) || ''),
                kilos_unidad: factorKg,
                iva: parseFloat(a.iva || (dbInfo ? dbInfo.iva : 21) || 21),
                precio_bulto_final: pBulto,
                precio_kilo_final: pKilo
            };
        }).filter(a => a.precio_bulto_final > 0 || a.precio_kilo_final > 0);

        if (articulos.length === 0) {
            const err = new Error('Ninguno de los artículos seleccionados posee un precio mayor a $0 en la lista asignada.');
            err.status = 400;
            throw err;
        }

        const titulo = limpiarTextoWinAnsi(titulo_informe && titulo_informe.trim() ? titulo_informe.trim() : 'Lista de Precios');
        const clienteStr = limpiarTextoWinAnsi(cliente_nombre && cliente_nombre.trim() ? cliente_nombre.trim() : 'Consumidor Final');
        const sanitizeTitulo = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
        const sanitizeNombre = clienteStr.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
        const hoyFmt = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        const filename = `${sanitizeTitulo}_${sanitizeNombre}_${hoyFmt}.pdf`;

        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true, info: { Title: filename } });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve({ buffer, filename });
        });
        doc.on('error', err => reject(err));

        // Header Institucional
        const headerY = doc.y;
        const logoPath = path.join(__dirname, '../img/logo_LAMDA_grande.png');

        // Logo arriba a la izquierda + WhatsApp Empresa abajo del logo
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 40, headerY, { width: 110 });
        } else {
            doc.fontSize(22).font('Helvetica-Bold').fillColor('#8e4785').text('LAMDA', 40, headerY);
        }
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b').text('WhatsApp: +54 9 221 661-5746', 40, headerY + 42);

        // Título y Datos del Cliente arriba a la derecha con excelente espaciado
        let yStartText = headerY + 2;
        const rightWidth = 330;
        const rightX = 225;

        doc.fontSize(15).font('Helvetica-Bold').fillColor('#1e293b').text(titulo, rightX, yStartText, { align: 'right', width: rightWidth });
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#334155').text(`Cliente: ${clienteStr}`, rightX, yStartText + 22, { align: 'right', width: rightWidth });

        // Emisión
        const hoyFmtStr = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Emisión: ${hoyFmtStr}`, rightX, yStartText + 37, { align: 'right', width: rightWidth });

        let topTableY = headerY + 58;
        doc.y = topTableY;
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#8e4785').lineWidth(2).stroke();
        doc.moveDown(0.8);

        // Configuración de Columnas según modo_precio y modo_iva
        const hideIvaColumn = ocultar_columna_iva === true || ocultar_columna_iva === 'true';
        const showKilo = modo_precio === 'kilo' || modo_precio === 'por_kilo' || modo_precio === 'ambos' || modo_precio === 'kilo_y_bulto' || modo_precio === 'solo_kilo';
        const showBulto = modo_precio === 'bulto' || modo_precio === 'bulto_cerrado' || modo_precio === 'ambos' || modo_precio === 'kilo_y_bulto' || modo_precio === 'solo_bulto';

        let columnsMeta = [];
        columnsMeta.push({ key: 'nomenclatura', header: 'Artículo / Nomenclatura', align: 'left', width: showKilo && showBulto ? (hideIvaColumn ? 260 : 225) : (hideIvaColumn ? 335 : 290) });
        columnsMeta.push({ key: 'presentacion', header: 'Presentación', align: 'center', width: 75 });
        
        if (!hideIvaColumn) {
            columnsMeta.push({ key: 'iva', header: '% IVA', align: 'center', width: 45 });
        }

        if (showKilo) {
            const labelK = modo_iva === 'sin_iva' ? 'P. Kilo (Neto)' : (modo_iva === 'con_iva' ? (hideIvaColumn ? 'P. Kilo' : 'P. Kilo (c/IVA)') : 'P. Kilo');
            columnsMeta.push({ key: 'precio_kilo', header: labelK, align: 'right', width: 90 });
        }
        if (showBulto) {
            const labelB = modo_iva === 'sin_iva' ? 'P. Bulto / Ud. (Neto)' : (modo_iva === 'con_iva' ? (hideIvaColumn ? 'P. Bulto / Ud.' : 'P. Bulto / Ud. (c/IVA)') : 'P. Bulto / Ud.');
            columnsMeta.push({ key: 'precio_bulto', header: labelB, align: 'right', width: 95 });
        }

        // Recalcular anchos para que sumen 515
        const totalW = columnsMeta.reduce((sum, c) => sum + c.width, 0);
        const diff = 515 - totalW;
        if (diff !== 0) {
            columnsMeta[0].width += diff;
        }

        const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val || 0);

        // Cabecera Tabla
        let yCurrent = doc.y;
        const dibujarCabecera = (y) => {
            doc.rect(40, y, 515, 22).fill('#8e4785');
            let xAcc = 40;
            columnsMeta.forEach(col => {
                doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#FFFFFF')
                   .text(col.header, xAcc + 4, y + 6, { width: col.width - 8, align: col.align });
                xAcc += col.width;
            });
            return y + 22;
        };

        yCurrent = dibujarCabecera(yCurrent);

        const normalizeKey = (str) => {
            if (!str) return '';
            return String(str)
                .toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, '');
        };

        const obtenerValorAtributoServidor = (artInput, targetKeyInput) => {
            if (!artInput || !targetKeyInput) return null;
            const art = artInput.art_original || artInput;
            const pd = art.propiedades_dinamicas || artInput.propiedades_dinamicas || {};
            const targetNorm = normalizeKey(targetKeyInput);
            if (!targetNorm) return null;

            if (pd.posiciones && typeof pd.posiciones === 'object') {
                for (const posKey of Object.keys(pd.posiciones)) {
                    const posObj = pd.posiciones[posKey];
                    if (posObj && typeof posObj === 'object') {
                        const catName = String(posObj.eje || posObj.categoria || posObj.nombre_categoria || posObj.nombre || '').trim();
                        if (normalizeKey(catName) === targetNorm || normalizeKey(posKey) === targetNorm) {
                            const val = posObj.valor || posObj.termino || posObj.texto;
                            if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
                        }
                    }
                }
            }

            if (pd[targetKeyInput] !== undefined && pd[targetKeyInput] !== null) {
                const valObj = pd[targetKeyInput];
                const val = (typeof valObj === 'object' && valObj !== null) ? (valObj.valor || valObj.termino) : valObj;
                if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
            }

            const directMatchKey = Object.keys(pd).find(k => normalizeKey(k) === targetNorm);
            if (directMatchKey) {
                const valObj = pd[directMatchKey];
                const val = (typeof valObj === 'object' && valObj !== null) ? (valObj.valor || valObj.termino) : valObj;
                if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
            }

            return null;
        };

        const dibujarFilaArticulo = (art, index) => {
            const tieneComposicion = (mostrar_composicion_mixes === true || mostrar_composicion_mixes === 'true') && art.composicion && String(art.composicion).trim() !== '' && !art.es_hijo;
            const tieneOferta = (destacar_ofertas !== false && destacar_ofertas !== 'false') && art.oferta_activa;

            const factorKg = parseFloat(art.kilos_unidad || 1);
            const ivaPct = parseFloat(art.iva || 21);
            const ivaCoeff = 1 + (ivaPct / 100);

            // Calcular según modo_iva
            let pBultoVal = parseFloat(art.precio_bulto_final || 0);
            let pKiloVal = parseFloat(art.precio_kilo_final || 0);

            if (tieneOferta) {
                const promoPct = parseFloat(art.oferta_activa.descuento_porcentaje || 5);
                const discountFactor = (100 - promoPct) / 100;
                pBultoVal = pBultoVal * discountFactor;
                pKiloVal = pKiloVal * discountFactor;
            }

            if (modo_iva === 'sin_iva') {
                pBultoVal = pBultoVal / ivaCoeff;
                pKiloVal = pKiloVal / ivaCoeff;
            }

            let presStrVal = art.presentacion_str;
            if (!presStrVal) {
                presStrVal = factorKg > 0 ? (factorKg < 1.0 ? `${Math.round(factorKg * 1000)} g` : `${factorKg.toFixed(2)} kg`) : 'Unidad';
            }

            // Calcular alturas dinámicas precisas para evitar cualquier colisión visual
            const nomWidthAvailable = 235 - 8 - (tieneOferta ? 60 : 0);
            const nomText = limpiarTextoWinAnsi(art.es_hijo ? `» Unidad fraccionada por ${presStrVal}` : (art.nomenclatura || art.nombre || art.descripcion_generada || art.descripcion || ''));
            doc.fontSize(art.es_hijo ? 8 : 8.5).font(art.es_hijo ? 'Helvetica-Oblique' : 'Helvetica-Bold');
            const nomHeight = doc.heightOfString(nomText, { width: nomWidthAvailable - (art.es_hijo ? 10 : 0) });

            let compoHeight = 0;
            const rawCompo = limpiarTextoWinAnsi(art.composicion || '');
            const esNotaComparativa = /^(Últ\.?\s*compra|Ult\.?\s*compra|Precio\s*ant|Sin\s*stock|Alt\.|Nota:)/i.test(rawCompo);
            const compoText = tieneComposicion ? (esNotaComparativa ? rawCompo : `Composición: ${rawCompo}`) : '';
            if (tieneComposicion) {
                doc.fontSize(7.2).font('Helvetica-Oblique');
                compoHeight = doc.heightOfString(compoText, { width: 235 - 8 });
            }

            const rowHeight = tieneComposicion 
                ? Math.max(24, Math.ceil(4 + nomHeight + 2 + compoHeight + 4))
                : Math.max(20, Math.ceil(nomHeight + 8));

            if (yCurrent + rowHeight > 730) {
                doc.addPage();
                yCurrent = 40;
                yCurrent = dibujarCabecera(yCurrent);
            }

            const isOdd = index % 2 === 1;
            if (isOdd) {
                doc.rect(40, yCurrent, 515, rowHeight).fill('#f8fafc');
            }

            // Fondo destacado para filas hijas en el PDF
            if (art.es_hijo) {
                doc.rect(40, yCurrent, 515, rowHeight).fill('#faf5ff');
            }

            const cellY = yCurrent + 4;
            let xAcc = 40;
            columnsMeta.forEach(col => {
                let cellText = '';

                if (col.key === 'nomenclatura') {
                    if (art.es_hijo) {
                        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#6b21a8')
                           .text(nomText, xAcc + 4 + 10, cellY, { width: col.width - 18, align: col.align });
                    } else {
                        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1e293b')
                           .text(nomText, xAcc + 4, cellY, { width: nomWidthAvailable, align: col.align });

                        if (tieneOferta) {
                            const promoPct = art.oferta_activa.descuento_porcentaje || 5;
                            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#dc2626')
                               .text(`[${promoPct}% OFF]`, xAcc + col.width - 58, cellY, { width: 54, align: 'right' });
                        }

                        if (tieneComposicion) {
                            const yCompo = cellY + nomHeight + 2;
                            doc.fontSize(7.2).font('Helvetica-Oblique').fillColor('#64748b')
                               .text(compoText, xAcc + 4, yCompo, { width: col.width - 8 });
                        }
                    }
                } else {
                    if (col.key === 'presentacion') {
                        cellText = presStrVal;
                        doc.fontSize(8.5).font(art.es_hijo ? 'Helvetica-Bold' : 'Helvetica').fillColor(art.es_hijo ? '#7e22ce' : '#64748b');
                    } else if (col.key === 'iva') {
                        const ivaFormatted = ivaPct % 1 === 0 ? ivaPct.toFixed(0) : String(ivaPct).replace('.', ',');
                        cellText = `${ivaFormatted}%`;
                        doc.fontSize(8.5).font('Helvetica').fillColor('#64748b');
                    } else if (col.key === 'precio_kilo') {
                        cellText = art.es_hijo ? '—' : formatMoney(pKiloVal);
                        doc.fontSize(8.5).font(art.es_hijo ? 'Helvetica' : 'Helvetica-Bold').fillColor(art.es_hijo ? '#94a3b8' : (tieneOferta ? '#dc2626' : '#1e293b'));
                    } else if (col.key === 'precio_bulto') {
                        cellText = (art.es_hijo ? '(P. Ud.) ' : '') + formatMoney(pBultoVal);
                        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(art.es_hijo ? '#7e22ce' : (tieneOferta ? '#dc2626' : '#15803d'));
                    }

                    doc.text(cellText, xAcc + 4, cellY, { width: col.width - 8, align: col.align, ellipsis: true });
                }

                xAcc += col.width;
            });

            yCurrent += rowHeight;
            doc.moveTo(40, yCurrent).lineTo(555, yCurrent).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
        };

        let nivelesAgrupar = [];
        if (Array.isArray(agrupar_por_atributo)) {
            nivelesAgrupar = agrupar_por_atributo.map(s => String(s).trim().toLowerCase());
        } else if (typeof agrupar_por_atributo === 'string' && agrupar_por_atributo.trim() !== '') {
            nivelesAgrupar = agrupar_por_atributo.split(',').map(s => s.trim().toLowerCase());
        }

        const categoriasEstandar = [
            'variedad', 'tratamiento', 'conformacion', 'definicion', 
            'calibre', 'uso', 'color', 'procedencia', 'nom. fantasía', 'nom_fantasia', 'tamaño', 'tamano'
        ];

        if (nivelesAgrupar.length === 0 || nivelesAgrupar.includes('todos')) {
            const detectedSec = new Set();
            articulos.forEach(artInput => {
                const art = artInput.art_original || artInput;
                const pd = art.propiedades_dinamicas || {};
                if (pd.posiciones && typeof pd.posiciones === 'object') {
                    Object.keys(pd.posiciones).forEach(pk => {
                        const pObj = pd.posiciones[pk];
                        if (pObj && typeof pObj === 'object') {
                            const cat = pObj.eje || pObj.categoria || pObj.nombre_categoria || pObj.nombre;
                            if (cat && String(cat).trim() !== '') {
                                const cleanCat = String(cat).toLowerCase().trim();
                                if (!['articulo_principal', 'familia', 'familia_id', 'incluir_familia', 'posicion_familia'].includes(cleanCat)) {
                                    detectedSec.add(cleanCat);
                                }
                            }
                        }
                    });
                }
            });
            categoriasEstandar.forEach(c => detectedSec.add(c.toLowerCase()));
            nivelesAgrupar = ['familia', 'principal', ...Array.from(detectedSec)];
        } else if (nivelesAgrupar.includes('plana')) {
            nivelesAgrupar = [];
        }

        const nivelesSet = new Set(nivelesAgrupar);

        if (nivelesSet.size > 0) {
            const gruposMap = new Map();

            articulos.forEach(artInput => {
                const artObj = artInput.art_original || artInput;
                const pd = artObj.propiedades_dinamicas || artInput.propiedades_dinamicas || {};

                const famVal = nivelesSet.has('familia') ? (artObj.familia_nombre || artObj.familia || pd.familia_nombre || artInput.familia_nombre || 'General') : null;

                let princVal = null;
                if (nivelesSet.has('principal')) {
                    princVal = artObj.articulo_principal || pd.articulo_principal || artInput.articulo_principal;
                    if (typeof princVal === 'object' && princVal !== null) princVal = princVal.valor || princVal.termino;
                    if (!princVal && (artObj.descripcion_generada || artInput.descripcion_generada)) princVal = (artObj.descripcion_generada || artInput.descripcion_generada).split(' ')[0];
                    if (!princVal && (artObj.descripcion || artInput.descripcion)) princVal = (artObj.descripcion || artInput.descripcion).split(' ')[0];
                    if (!princVal) princVal = 'General';
                }

                const secKeys = Array.from(nivelesSet).filter(k => k !== 'familia' && k !== 'principal');
                const secVals = [];
                secKeys.forEach(secK => {
                    let v = obtenerValorAtributoServidor(artInput, secK);
                    if (v) {
                        v = limpiarTextoWinAnsi(v);
                        if (princVal) {
                            const pNorm = normalizeKey(princVal);
                            const parts = v.split(/\s*[›—-]\s*/).map(p => p.trim()).filter(Boolean);
                            const filtered = parts.filter((p, idx) => !(idx === 0 && normalizeKey(p) === pNorm));
                            v = filtered.join(' › ');
                        }
                        if (v && normalizeKey(v) !== 'estandar') secVals.push(v);
                    }
                });

                const groupKeyParts = [];
                if (famVal) groupKeyParts.push(`FAMILIA:${famVal}`);
                if (princVal) groupKeyParts.push(`PRINCIPAL:${princVal}`);
                if (secVals.length > 0) groupKeyParts.push(`SEC:${secVals.join(' — ')}`);

                const groupKey = groupKeyParts.join(' | ') || 'GENERAL';

                if (!gruposMap.has(groupKey)) {
                    gruposMap.set(groupKey, {
                        famVal: limpiarTextoWinAnsi(famVal),
                        princVal: limpiarTextoWinAnsi(princVal),
                        secValsStr: limpiarTextoWinAnsi(secVals.join(' — ')),
                        items: []
                    });
                }
                gruposMap.get(groupKey).items.push(artInput);
            });

            // Ordenar grupos determinísticamente por Jerarquía Taxonómica: Familia -> Principal -> Categorías Secundarias
            const gruposArray = Array.from(gruposMap.values());
            gruposArray.sort((a, b) => {
                if (a.famVal && b.famVal) {
                    const cmpFam = a.famVal.localeCompare(b.famVal, 'es', { sensitivity: 'base' });
                    if (cmpFam !== 0) return cmpFam;
                } else if (a.famVal && !b.famVal) return -1;
                else if (!a.famVal && b.famVal) return 1;

                if (a.princVal && b.princVal) {
                    const cmpPrinc = a.princVal.localeCompare(b.princVal, 'es', { sensitivity: 'base' });
                    if (cmpPrinc !== 0) return cmpPrinc;
                } else if (a.princVal && !b.princVal) return -1;
                else if (!a.princVal && b.princVal) return 1;

                if (a.secValsStr && b.secValsStr) {
                    return a.secValsStr.localeCompare(b.secValsStr, 'es', { sensitivity: 'base' });
                } else if (a.secValsStr && !b.secValsStr) return -1;
                else if (!a.secValsStr && b.secValsStr) return 1;

                return 0;
            });

            let globalRowIndex = 0;
            let currentFamShown = null;
            let currentPrincShown = null;

            gruposArray.forEach((dataGrupo) => {
                if (dataGrupo.famVal && dataGrupo.famVal !== currentFamShown) {
                    currentFamShown = dataGrupo.famVal;
                    currentPrincShown = null;

                    if (yCurrent > 710) {
                        doc.addPage();
                        yCurrent = 40;
                        yCurrent = dibujarCabecera(yCurrent);
                    }
                    // Fondo gris suave + recuadro/marco de línea fina con el gris sutil del logo (#94a3b8)
                    doc.lineWidth(1).rect(40, yCurrent, 515, 20).fillAndStroke('#f8fafc', '#94a3b8');
                    
                    let textX = 48;
                    const pathIsotipoL = path.join(__dirname, '../img/isotipo_L_LAMDA.png');
                    if (fs.existsSync(pathIsotipoL)) {
                        try {
                            doc.image(pathIsotipoL, 48, yCurrent + 3, { height: 14 });
                            textX = 66;
                        } catch (eImg) {
                            textX = 48;
                        }
                    }

                    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
                       .text(`${dataGrupo.famVal.toUpperCase()}`, textX, yCurrent + 5, { width: 500 - (textX - 48) });
                    yCurrent += 20;
                }

                if (dataGrupo.princVal && dataGrupo.princVal !== currentPrincShown) {
                    currentPrincShown = dataGrupo.princVal;

                    if (yCurrent > 710) {
                        doc.addPage();
                        yCurrent = 40;
                        yCurrent = dibujarCabecera(yCurrent);
                    }
                    doc.rect(46, yCurrent, 509, 17).fill('#e0f2fe');
                    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0369a1')
                       .text(`${dataGrupo.princVal.toUpperCase()}`, 54, yCurrent + 4, { width: 490 });
                    yCurrent += 17;
                }

                if (dataGrupo.secValsStr) {
                    if (yCurrent > 710) {
                        doc.addPage();
                        yCurrent = 40;
                        yCurrent = dibujarCabecera(yCurrent);
                    }
                    doc.rect(52, yCurrent, 503, 17).fill('#f1f5f9');
                    const artSuffix = dataGrupo.items.length === 1 ? 'ARTÍCULO' : 'ARTÍCULOS';
                    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#6b21a8')
                       .text(`» ${dataGrupo.secValsStr.toUpperCase()} (${dataGrupo.items.length} ${artSuffix})`, 62, yCurrent + 4, { width: 480 });
                    yCurrent += 17;
                }

                const ordenarArticulosCotizadorServidor = (artList) => {
                    if (!Array.isArray(artList)) return [];
                    const padres = artList.filter(a => !a.es_hijo);
                    const hijos = artList.filter(a => a.es_hijo);

                    padres.sort((a, b) => parseFloat(b.kilos_unidad || 0) - parseFloat(a.kilos_unidad || 0));

                    const resultado = [];
                    padres.forEach(padre => {
                        resultado.push(padre);
                        const hijasPadre = hijos.filter(h => String(h.padre_id) === String(padre.articulo_id));
                        hijasPadre.forEach(hijo => resultado.push(hijo));
                    });

                    const procesadosIds = new Set(resultado.map(r => String(r.articulo_id)));
                    artList.forEach(item => {
                        if (!procesadosIds.has(String(item.articulo_id))) resultado.push(item);
                    });
                    return resultado;
                };

                const itemsGrupoOrdenados = ordenarArticulosCotizadorServidor(dataGrupo.items);
                itemsGrupoOrdenados.forEach(art => {
                    dibujarFilaArticulo(art, globalRowIndex++);
                });
            });
        } else {
            const ordenarArticulosCotizadorServidor = (artList) => {
                if (!Array.isArray(artList)) return [];
                const padres = artList.filter(a => !a.es_hijo);
                const hijos = artList.filter(a => a.es_hijo);

                padres.sort((a, b) => parseFloat(b.kilos_unidad || 0) - parseFloat(a.kilos_unidad || 0));

                const resultado = [];
                padres.forEach(padre => {
                    resultado.push(padre);
                    const hijasPadre = hijos.filter(h => String(h.padre_id) === String(padre.articulo_id));
                    hijasPadre.forEach(hijo => resultado.push(hijo));
                });

                const procesadosIds = new Set(resultado.map(r => String(r.articulo_id)));
                artList.forEach(item => {
                    if (!procesadosIds.has(String(item.articulo_id))) resultado.push(item);
                });
                return resultado;
            };

            const articulosPlanosOrdenados = ordenarArticulosCotizadorServidor(articulos);
            articulosPlanosOrdenados.forEach((art, index) => {
                dibujarFilaArticulo(art, index);
            });
        }

        // Nota aclaratoria al pie
        yCurrent += 15;
        if (yCurrent > 700) {
            doc.addPage();
            yCurrent = 40;
        }

        const mostrarBonif = (bonificacion_volumen !== false && bonificacion_volumen !== 'false');
        const mostrarPromoPie = (destacar_ofertas !== false && destacar_ofertas !== 'false');
        const boxHeight = 52 + (mostrarBonif ? 10 : 0) + (mostrarPromoPie ? 10 : 0);

        doc.rect(40, yCurrent, 515, boxHeight).fillAndStroke('#faf5ff', '#e9d5ff');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#7e22ce').text('INFORMACIÓN DE COTIZACIÓN Y CONDICIONES COMERCIALES', 50, yCurrent + 6);
        const textoPreciosPie = hideIvaColumn 
            ? (modo_iva === 'sin_iva' ? 'NETOS' : 'FINALES')
            : (modo_iva === 'sin_iva' ? 'NETOS (sin IVA)' : 'FINALES (IVA incluido)');
        doc.fontSize(7.5).font('Helvetica').fillColor('#4b5563')
           .text(`• Los precios expuestos son ${textoPreciosPie}.`, 50, yCurrent + 18)
           .text(`• Cotización válida por 48 horas sujetas a disponibilidad de stock y variaciones del mercado.`, 50, yCurrent + 28);
        
        let yFooterLine = yCurrent + 38;
        if (mostrarBonif) {
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#2563eb')
               .text(`• Bonificación Comercial: 5% de descuento adicional en compras superiores a $300.000.`, 50, yFooterLine);
            yFooterLine += 10;
        }
        if (mostrarPromoPie) {
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#dc2626')
               .text(`• Promociones Vigentes: Artículos en oferta aplican con descuento hasta agotar stock asignado a la cuota.`, 50, yFooterLine);
            yFooterLine += 10;
        }
        const lineaPol = (politica_texto && String(politica_texto).trim())
           ? String(politica_texto).trim()
           : 'Consulte por bonificaciones y escalas de descuento comercial por volumen.';
        if (!mostrarBonif) {
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#4338ca')
               .text(`• ${lineaPol}`, 50, yFooterLine);
        }

        // Numeración de páginas (Sin gatillar saltos automáticos de página)
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
               .text(`Página ${i + 1} de ${pageCount} — LAMDA Sistema Búnker`, 40, 785, { align: 'center', width: 515, lineBreak: false });
        }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * 📄 Generar PDF de Cotización / Consulta de Precios personalizada para Cliente
 */
exports.exportarPDFCotizacionCliente = async (req, res) => {
    try {
        const { buffer, filename } = await exports.generarPDFCotizacionBuffer(req.body, req.db || require('../config/database').pool);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (error) {
        console.error('❌ [BUNKER] Error en exportarPDFCotizacionCliente:', error);
        if (!res.headersSent) {
            res.status(error.status || 500).send(error.message || 'Error al generar la cotización PDF.');
        }
    }
};

/**
 * 🗑️ Eliminar y desvincular receta de producción directamente en la BD del Búnker
 */
exports.eliminarRecetaBunker = async (req, res) => {
    const db = req.db || require('../config/database').pool;
    const client = await db.connect();
    try {
        const { articulo_numero } = req.params;
        if (!articulo_numero) {
            return res.status(400).json({ success: false, error: 'El SKU de artículo es requerido' });
        }

        await client.query('BEGIN');

        const recRes = await client.query('SELECT id FROM public.recetas WHERE articulo_numero = $1', [articulo_numero]);
        if (recRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'No existe receta vinculada para este artículo' });
        }

        const recetaId = recRes.rows[0].id;
        await client.query('DELETE FROM public.receta_ingredientes WHERE receta_id = $1', [recetaId]);
        await client.query('DELETE FROM public.receta_articulos WHERE receta_id = $1', [recetaId]);
        await client.query('DELETE FROM public.recetas WHERE id = $1', [recetaId]);

        await client.query('COMMIT');

        console.log(`🗑️ [BUNKER-RECETAS] Receta ID=${recetaId} desvinculada exitosamente del SKU=${articulo_numero}`);
        res.json({ success: true, message: 'Receta eliminada y desvinculada exitosamente', receta_id: recetaId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ [BUNKER-RECETAS] Error eliminando receta:', err);
        res.status(500).json({ success: false, error: err.message || 'Error interno al eliminar la receta' });
    } finally {
        client.release();
    }
};

/**
 * 🏷️ Obtener ofertas dinámicas activas (Single Source of Truth para Cotizador)
 */
exports.obtenerOfertasActivas = async (req, res) => {
    try {
        const OfertasDinamicasService = require('../../presupuestos/services/ofertasDinamicasService');
        const db = req.db || require('../config/database').pool;
        const ofertas = await OfertasDinamicasService.obtenerOfertas(db, true);
        res.json({ success: true, data: ofertas });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo ofertas activas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 🥣 Obtener mapeo de recetas e ingredientes de composición para mixes
 */
exports.obtenerMixesComposicion = async (req, res) => {
    try {
        const db = req.db || require('../config/database').pool;
        const query = `
          WITH mix_ingredientes AS (
            SELECT 
              m.id AS mix_id,
              LOWER(TRIM(REGEXP_REPLACE(m.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) AS clean_name,
              STRING_AGG(sub.nombre, ', ' ORDER BY ic.id) AS composicion
            FROM public.ingrediente_composicion ic
            JOIN public.ingredientes m ON m.id = ic.mix_id
            JOIN public.ingredientes sub ON sub.id = ic.ingrediente_id
            GROUP BY m.id, m.nombre
          )
          SELECT 
            ba.articulo_id,
            mi.composicion
          FROM public.bunker_articulos ba
          JOIN public.recetas r ON r.articulo_numero = ba.articulo_id
          JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
          JOIN public.ingredientes i ON i.id = ri.ingrediente_id
          JOIN mix_ingredientes mi ON (
            i.id = mi.mix_id 
            OR LOWER(TRIM(REGEXP_REPLACE(i.nombre, '\\s*\\((Mix|Simple|MIX)\\)', '', 'gi'))) = mi.clean_name
          )
          GROUP BY ba.articulo_id, mi.composicion
        `;
        const result = await db.query(query);
        const map = {};
        result.rows.forEach(r => {
            map[r.articulo_id] = r.composicion;
        });
        res.json({ success: true, data: map });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo composición de mixes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

let bunkerPrefsTableEnsured = false;
async function ensureBunkerPreferenciasTable(db) {
    if (bunkerPrefsTableEnsured) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS public.bunker_preferencias_ui (
            clave VARCHAR(100) PRIMARY KEY,
            valor JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await db.query(`
        DELETE FROM public.bunker_preferencias_ui WHERE clave IS NULL;
        DELETE FROM public.bunker_preferencias_ui a
        USING public.bunker_preferencias_ui b
        WHERE a.ctid < b.ctid AND a.clave = b.clave;
        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN clave SET NOT NULL;
        ALTER TABLE public.bunker_preferencias_ui ALTER COLUMN valor SET NOT NULL;
    `).catch(() => {});
    await db.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'public.bunker_preferencias_ui'::regclass
                  AND contype = 'p'
            ) THEN
                ALTER TABLE public.bunker_preferencias_ui
                ADD CONSTRAINT bunker_preferencias_ui_pkey PRIMARY KEY (clave);
            END IF;
        END $$;
    `).catch(() => {});
    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bunker_preferencias_ui_clave_unq
        ON public.bunker_preferencias_ui (clave);
    `).catch(() => {});
    bunkerPrefsTableEnsured = true;
}

exports.obtenerPreferenciasUI = async (req, res) => {
    try {
        const db = req.db || require('../config/database').pool;
        await ensureBunkerPreferenciasTable(db);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        const result = await db.query('SELECT clave, valor, updated_at FROM public.bunker_preferencias_ui');
        const data = {};
        result.rows.forEach(r => {
            data[r.clave] = r.valor;
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo preferencias UI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.guardarPreferenciasUI = async (req, res) => {
    try {
        const db = req.db || require('../config/database').pool;
        await ensureBunkerPreferenciasTable(db);
        const { clave, valor, preferencias } = req.body || {};

        if (preferencias && typeof preferencias === 'object') {
            for (const [k, v] of Object.entries(preferencias)) {
                if (!k) continue;
                await db.query(
                    `INSERT INTO public.bunker_preferencias_ui (clave, valor, updated_at)
                     VALUES ($1, $2::jsonb, NOW())
                     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
                    [String(k).slice(0, 100), JSON.stringify(v ?? {})]
                );
            }
        } else if (clave) {
            await db.query(
                `INSERT INTO public.bunker_preferencias_ui (clave, valor, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
                [String(clave).slice(0, 100), JSON.stringify(valor ?? {})]
            );
        } else {
            return res.status(400).json({ success: false, error: 'Se requiere clave o preferencias' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('❌ [BUNKER] Error guardando preferencias UI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

console.log('✅ [BUNKER-CONTROLLER] Controlador de búnker configurado');

