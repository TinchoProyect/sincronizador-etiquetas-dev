const BunkerService = require('../services/bunkerService');
const PDFDocument = require('pdfkit');

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
        const { termino } = req.query;
        if (!termino) {
            return res.status(400).json({ success: false, error: 'Falta el término principal.' });
        }

        const db = req.db;
        
        const sqlPlantilla = `
            SELECT jsonb_object_keys(propiedades_dinamicas) as categoria, count(*) as uso
            FROM public.bunker_articulos
            WHERE descripcion ILIKE $1 OR descripcion_generada ILIKE $1
            GROUP BY categoria
            ORDER BY uso DESC
        `;
        const resultPlantilla = await db.query(sqlPlantilla, [`%${termino}%`]);
        const categoriasUsadas = resultPlantilla.rows.map(r => r.categoria);

        const sqlDict = `
            SELECT categoria, termino, abreviatura 
            FROM public.bunker_diccionario 
            WHERE categoria NOT IN ('general', 'articulo_principal', '')
            ORDER BY categoria, termino
        `;
        const resultDict = await db.query(sqlDict);
        
        res.json({
            success: true,
            categorias_sugeridas: categoriasUsadas,
            diccionario_categorizado: resultDict.rows
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo plantilla:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo plantilla inteligente' });
    }
};

exports.buscarDiccionario = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const terminos = await BunkerService.buscarDiccionario(req.db, q);
        res.json({ success: true, data: terminos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando en diccionario:', error);
        res.status(500).json({ success: false, error: 'Error interno consultando diccionario' });
    }
};

exports.buscarConsolidado = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const articulos = await BunkerService.buscarConsolidado(req.db, q);
        res.json({ success: true, data: articulos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando consolidado:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando stock consolidado' });
    }
};

exports.obtenerArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const articulo = await BunkerService.obtenerArticulo(req.db, id);
        if (!articulo) {
            return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        }
        res.json({ success: true, data: articulo });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo artículo:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo artículo' });
    }
};

exports.crearArticulo = async (req, res) => {
    try {
        const db = req.db;
        const { articuloData, listasMargenes, nuevos_terminos_diccionario } = req.body;

        if (!articuloData || !articuloData.descripcion) {
            return res.status(400).json({ success: false, error: 'Datos de artículo inválidos o faltantes' });
        }

        // Lógica QA Backend (Fase 3): Autodetectar pack
        const kilos = Number(articuloData.kilos_unidad) || 0;
        const cantidad = Number(articuloData.pack_unidades) || 1;
        articuloData.es_pack = (cantidad > 1 && kilos > 0);

        // Generar IDs locales SI NO VIENEN en el payload (Fase 3 Upsert)
        let articulo_id = articuloData.articulo_id;
        let codigo_barras = articuloData.codigo_barras;

        if (!articulo_id) {
            const timestamp = Date.now().toString().slice(-6); 
            const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            articulo_id = `LAMDA-${timestamp}${rnd}`;
            if (!codigo_barras) codigo_barras = `LAMDCB${timestamp}${rnd}`;
        }

        articuloData.articulo_id = articulo_id;
        articuloData.codigo_barras = codigo_barras || articulo_id;

        // PARCHE CRÍTICO: Asegurar que el Artículo Principal se registre SIEMPRE en el diccionario (categoria = 'general')
        let terminosAsegurados = nuevos_terminos_diccionario || [];
        const terminoPrimarioStr = articuloData.descripcion_abreviada || articuloData.descripcion;
        if (terminoPrimarioStr) {
             let baseNombre = terminoPrimarioStr.split('.')[0].trim();
             baseNombre = baseNombre.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]/g, '').trim();
             if (baseNombre && !terminosAsegurados.some(t => t.termino.toLowerCase() === baseNombre.toLowerCase())) {
                  terminosAsegurados.push({
                      termino: baseNombre,
                      abreviatura: baseNombre.substring(0, 3).toUpperCase(),
                      categoria: 'general'
                  });
             }
        }

        const resultado = await BunkerService.crearArticuloTransaccional(db, articuloData, listasMargenes, terminosAsegurados);

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
        const filtros = { search: req.query.search };
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
        const { articuloData, listasMargenes } = req.body;

        await BunkerService.actualizarArticuloTransaccional(req.db, id, articuloData, listasMargenes);

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
        const { costo_base, margenes, configs } = req.body;
        
        await BunkerService.actualizarEstructuraFinancieraTransaccional(req.db, id, { costo_base, margenes, configs });
        res.json({ success: true, message: 'Estructura financiera actualizada exitosamente' });
    } catch (error) {
        console.error(`❌ [BUNKER] Error actualizando finanzas ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno actualizando estructura financiera' });
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

        // 2. Obtener los artículos asociados a esta lista
        const resArticulos = await db.query(
            `SELECT 
                 la.articulo_numero,
                 COALESCE(b.descripcion_generada, b.descripcion) as descripcion,
                 b.kilos_unidad,
                 la.precio_final,
                 la.iva,
                 b.propiedades_dinamicas,
                 b.rubro,
                 b.sub_rubro
             FROM public.bunker_lista_articulos la
             JOIN public.bunker_articulos b ON b.articulo_id = la.articulo_numero
             WHERE la.lista_id = $1
             ORDER BY COALESCE(b.descripcion_generada, b.descripcion) ASC`,
            [listaId]
        );

        if (resArticulos.rows.length === 0) {
            return res.status(404).send('La lista de precios seleccionada no posee artículos asociados para exportar.');
        }

        // 3. Configurar respuesta HTTP para descarga del PDF
        const sanitizeNombre = listaNombre.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
        const hoyFmt = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        const filename = `Lista_Bunker_${sanitizeNombre}_${hoyFmt}.pdf`;

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
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e293b').text('Lista de precios', 50, yStartText);
        
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

        let currentY = doc.y;

        // Función para validar espacio disponible y evitar cabeceras huérfanas
        const checkEspacioDisponible = (requiredHeight) => {
            if (currentY + requiredHeight > doc.page.height - 70) {
                doc.addPage();
                currentY = 50;
                return true;
            }
            return false;
        };

        // Renderizado por Bloques (Ruptura de Rubro y Sub-rubro)
        for (const rubro of orderedRubros) {
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
            let rubroImpreso = false;

            for (const subRubro of subRubros) {
                const articulos = grouped[rubro][subRubro];
                if (articulos.length === 0) continue;

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

                            // Si no cabe en la página actual, agregamos página y redibujamos cabeceras
                            if (currentY + subHeaderHeight > doc.page.height - 70) {
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
                    if (currentY + rowHeight > doc.page.height - 70) {
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
                
                doc.moveDown(0.8);
                currentY = doc.y;
            }
        }

        let pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            doc.fontSize(7.5).fillColor('#94a3b8').text(
                `LAMDA • El presente es un documento de simulación interna comercial. • Página ${i + 1} de ${pages.count}`,
                50,
                doc.page.height - 40,
                { align: 'center', width: 495 }
            );
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

console.log('✅ [BUNKER-CONTROLLER] Controlador de búnker configurado');

