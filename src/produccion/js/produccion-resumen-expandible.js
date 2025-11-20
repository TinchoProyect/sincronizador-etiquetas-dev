// ===== FUNCIONALIDAD DE FILAS EXPANDIBLES PARA ARTÍCULOS COMPUESTOS =====

// Almacenar información de pack mappings (caché local)
const packMappingsCache = new Map();

// Control para evitar bucles infinitos en actualizarIconosExpansion
let isUpdatingIcons = false;
let updateIconsTimeout = null;

// Set para mantener estado de padres expandidos (preservar tras re-render)
const expandedParents = new Set();

/**
 * Función para obtener información de pack mapping desde stock_real_consolidado
 */
async function obtenerPackMapping(codigoPadre) {
    if (packMappingsCache.has(codigoPadre)) {
        return packMappingsCache.get(codigoPadre);
    }
    
    try {
        console.log(`🔍 [PACK] Consultando pack mapping para: ${codigoPadre}`);
        
        const response = await fetch(`/api/produccion/pedidos-articulos?include_pack=true&q=${encodeURIComponent(codigoPadre)}`);
        
        if (!response.ok) {
            console.log(`ℹ️ [PACK] Error en consulta: ${response.status}`);
            return null;
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data || result.data.length === 0) {
            console.log(`ℹ️ [PACK] No se encontró artículo: ${codigoPadre}`);
            return null;
        }
        
        const articulo = result.data.find(art => art.articulo_numero === codigoPadre);
        
        if (!articulo || !articulo.es_pack || !articulo.pack_hijo_codigo) {
            console.log(`ℹ️ [PACK] No hay pack configurado para: ${codigoPadre}`);
            return null;
        }
        
        let hijoNombre = 'Artículo hijo';
        let hijoDescripcion = null;
        let hijoNumeroAlfanumerico = articulo.pack_hijo_codigo;
        let hijoCodigoBarras = articulo.pack_hijo_codigo;
        
        try {
            console.log(`🔍 [PACK] Buscando info completa del hijo: ${articulo.pack_hijo_codigo}`);
            
            const hijoResponse = await fetch(`/api/produccion/pedidos-articulos?include_pack=true&q=${encodeURIComponent(articulo.pack_hijo_codigo)}`);
            if (hijoResponse.ok) {
                const hijoResult = await hijoResponse.json();
                console.log(`📊 [PACK] Respuesta hijo:`, hijoResult);
                
                if (hijoResult.success && hijoResult.data && hijoResult.data.length > 0) {
                    // Buscar por código de barras O código alfanumérico
                    const hijoData = hijoResult.data.find(art => 
                        art.codigo_barras === articulo.pack_hijo_codigo || 
                        art.articulo_numero === articulo.pack_hijo_codigo
                    );
                    
                    if (hijoData) {
                        hijoDescripcion = hijoData.descripcion || hijoData.nombre || hijoData.articulo_descripcion;
                        hijoNumeroAlfanumerico = hijoData.articulo_numero || articulo.pack_hijo_codigo;
                        hijoCodigoBarras = hijoData.codigo_barras || articulo.pack_hijo_codigo;
                        
                        console.log(`✅ [PACK] Info hijo encontrada:`, {
                            descripcion: hijoDescripcion,
                            numero: hijoNumeroAlfanumerico,
                            barras: hijoCodigoBarras
                        });
                    }
                }
            }
            
            if (!hijoDescripcion) {
                console.log(`⚠️ [PACK] Búsqueda específica falló, probando búsqueda general...`);
                const hijoResponse2 = await fetch(`/api/produccion/pedidos-articulos`);
                if (hijoResponse2.ok) {
                    const hijoResult2 = await hijoResponse2.json();
                    if (hijoResult2.success && hijoResult2.data && hijoResult2.data.length > 0) {
                        const hijoData2 = hijoResult2.data.find(art => 
                            art.codigo_barras === articulo.pack_hijo_codigo || 
                            art.articulo_numero === articulo.pack_hijo_codigo
                        );
                        
                        if (hijoData2) {
                            hijoDescripcion = hijoData2.descripcion || hijoData2.nombre || hijoData2.articulo_descripcion;
                            hijoNumeroAlfanumerico = hijoData2.articulo_numero || articulo.pack_hijo_codigo;
                            hijoCodigoBarras = hijoData2.codigo_barras || articulo.pack_hijo_codigo;
                            
                            console.log(`✅ [PACK] Info hijo encontrada (búsqueda general):`, {
                                descripcion: hijoDescripcion,
                                numero: hijoNumeroAlfanumerico,
                                barras: hijoCodigoBarras
                            });
                        }
                    }
                }
            }
            
            if (hijoDescripcion) {
                hijoNombre = hijoDescripcion;
            } else {
                console.warn(`⚠️ [PACK] No se pudo obtener descripción del hijo ${articulo.pack_hijo_codigo}, usando fallback`);
            }
            
        } catch (hijoError) {
            console.error(`❌ [PACK] Error al obtener info del hijo:`, hijoError);
        }

        const packMapping = {
            articulo_produccion_codigo: codigoPadre,
            articulo_kilo_codigo: hijoCodigoBarras,
            articulo_kilo_numero: hijoNumeroAlfanumerico,
            articulo_kilo_nombre: hijoNombre,
            articulo_kilo_codigo_barras: hijoCodigoBarras,
            unidades: articulo.pack_unidades || 1,
            multiplicador_ingredientes: articulo.pack_unidades || 1
        };
        
        console.log(`✅ [PACK] Pack mapping encontrado:`, packMapping);
        packMappingsCache.set(codigoPadre, packMapping);
        return packMapping;
    } catch (error) {
        console.error(`❌ [PACK] Error al obtener pack mapping para ${codigoPadre}:`, error);
        return null;
    }
}

/**
 * Función para toggle expandir artículo (firma robusta con parentTr)
 */
async function toggleExpandirArticulo(parentTr) {
    if (!parentTr || !parentTr.dataset) {
        console.error(`❌ [EXPAND] parentTr inválido`);
        return;
    }
    
    const codigo = parentTr.dataset.articulo;
    if (!codigo) {
        console.error(`❌ [EXPAND] No se encontró data-articulo en parentTr`);
        return;
    }
    
    console.log(`🔄 [EXPAND] Toggle para artículo: ${codigo}`);
    
    const childRow = document.getElementById(`child-for-${codigo}`);
    const expandIcon = parentTr.querySelector('.expand-icon');
    const descripcionCell = parentTr.querySelector('td:nth-child(2)');
    
    if (childRow) {
        // La fila ya existe, solo alternar visibilidad
        const isVisible = childRow.classList.contains('visible');
        const debeMostrar = !isVisible;
        
        childRow.classList.toggle('visible', debeMostrar);
        
        if (debeMostrar) {
            expandedParents.add(codigo);
            if (expandIcon) expandIcon.style.transform = 'rotate(90deg)';
            if (descripcionCell) descripcionCell.setAttribute('aria-expanded', 'true');
            console.log(`➕ [EXPAND] Expandiendo hijo de: ${codigo}`);
        } else {
            expandedParents.delete(codigo);
            if (expandIcon) expandIcon.style.transform = 'rotate(0deg)';
            if (descripcionCell) descripcionCell.setAttribute('aria-expanded', 'false');
            console.log(`➖ [EXPAND] Colapsando hijo de: ${codigo}`);
        }
    } else {
        // La fila no existe, crearla
        console.log(`🆕 [EXPAND] Creando fila hija para: ${codigo}`);
        
        // Obtener datos del padre
        const datosPadre = obtenerDatosPadre(parentTr, codigo);
        
        // Obtener mapping
        const mapping = await obtenerPackMapping(codigo);
        if (!mapping) {
            console.log(`ℹ️ [EXPAND] No hay pack configurado para ${codigo}`);
            return;
        }
        
        // Crear fila hija
        await crearFilaHija(parentTr, datosPadre, mapping);
        expandedParents.add(codigo);
        
        if (descripcionCell) descripcionCell.setAttribute('aria-expanded', 'true');
    }
}

/**
 * Obtener datos del padre desde fuentes disponibles
 */
function obtenerDatosPadre(parentTr, codigo) {
    let padreData = null;
    
    // Buscar en datosArticulosCompartidos
    if (window.datosArticulosCompartidos && Array.isArray(window.datosArticulosCompartidos)) {
        padreData = window.datosArticulosCompartidos.find(art => 
            art.articulo_numero === codigo || art.codigo === codigo || art.articulo === codigo
        );
    }
    
    // Fallback: buscar en caché del resumen
    if (!padreData && window.__resumenFaltantesDatos && Array.isArray(window.__resumenFaltantesDatos)) {
        padreData = window.__resumenFaltantesDatos.find(art => 
            art.articulo_numero === codigo || art.codigo === codigo || art.articulo === codigo
        );
    }
    
    // Último recurso: extraer del DOM
    if (!padreData) {
        console.warn(`⚠️ [EXPAND] No se encontró en datos compartidos, extrayendo del DOM`);
        const celdas = parentTr.querySelectorAll('td');
        padreData = {
            codigo: codigo,
            articulo_numero: codigo,
            descripcion: celdas[1]?.textContent?.trim() || '',
            pedido_total: parseFloat(celdas[2]?.textContent?.replace(',', '.') || '0'),
            stock_disponible: parseFloat(celdas[3]?.textContent?.replace(',', '.') || '0'),
            faltante: parseFloat(celdas[4]?.textContent?.replace(',', '.') || '0')
        };
    }
    
    // Normalizar datos numéricos
    return {
        codigo: codigo,
        articulo_numero: codigo,
        descripcion: padreData.descripcion || padreData.nombre || '',
        pedido_total: Number(padreData.pedido_total || 0),
        stock_disponible: Number(padreData.stock_disponible || padreData.stock || 0),
        faltante: Number(padreData.faltante || padreData.cantidad_faltante || 0)
    };
}

/**
 * Función para crear y mostrar la fila hija (firma robusta)
 */
async function crearFilaHija(parentTr, datosPadre, mapping) {
    const codigo = datosPadre.codigo;
    const expandIcon = parentTr.querySelector('.expand-icon');
    
    try {
        console.log(`📊 [EXPAND] Datos normalizados padre:`, datosPadre);
        console.log(`🔧 [EXPAND] Pack mapping:`, mapping);
        
        const unidadesPorPack = Number(mapping.unidades || mapping.multiplicador_ingredientes || 1);
        
        // Calcular cantidades del hijo
        const cantidadesHijo = {
            pedido_total: Math.round((datosPadre.pedido_total * unidadesPorPack) * 100) / 100,
            stock_disponible: Math.round((datosPadre.stock_disponible * unidadesPorPack) * 100) / 100,
            faltante: Math.round(((datosPadre.faltante || (datosPadre.pedido_total - datosPadre.stock_disponible)) * unidadesPorPack) * 100) / 100
        };
        
        console.log(`🧮 [EXPAND] Mapping y cálculo:`, { 
            unidades_por_pack: unidadesPorPack,
            pedido_padre: datosPadre.pedido_total,
            stock_padre: datosPadre.stock_disponible,
            faltante_padre: datosPadre.faltante,
            pedido_hijo: cantidadesHijo.pedido_total,
            stock_hijo: cantidadesHijo.stock_disponible,
            faltante_hijo: cantidadesHijo.faltante
        });
        
        const hijoData = {
            codigo_padre: codigo,
            codigo_hijo: mapping.articulo_kilo_codigo || mapping.hijo_codigo_barras,
            descripcion: mapping.articulo_kilo_nombre || 'Artículo hijo',
            unidades_por_pack: mapping.unidades || mapping.multiplicador_ingredientes
        };
        
        // Crear fila hijo usando createElement
        const childRow = document.createElement('tr');
        childRow.className = 'child-row';
        childRow.id = `child-for-${codigo}`;
        childRow.setAttribute('data-parent', codigo);
        
        // Construir el HTML interno con los tres valores escalados
        childRow.innerHTML = `
            <td colspan="1000" style="padding: 15px 12px; background-color: #f8f9fa; border-left: 4px solid #17a2b8;">
                <div class="detalle-pack-hijo">
                    <div style="font-size: 15px; font-weight: 500; color: #2c5f6f; margin-bottom: 4px;">
                        ${hijoData.descripcion}
                    </div>
                    <div style="font-size: 12px; color: #6c757d; font-family: monospace; margin-bottom: 10px;">
                        Cód. barras: ${hijoData.codigo_hijo}
                    </div>
                    <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-weight: bold; color: #007bff; font-size: 13px;">Pedido:</span>
                            <span style="font-size: 13px;">${formatearNumeroResumen(cantidadesHijo.pedido_total)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-weight: bold; color: #17a2b8; font-size: 13px;">Stock:</span>
                            <span style="font-size: 13px;">${formatearNumeroResumen(cantidadesHijo.stock_disponible)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-weight: bold; color: #dc3545; font-size: 13px;">Faltante:</span>
                            <span style="font-weight: bold; color: #dc3545; font-size: 13px;">${formatearNumeroResumen(cantidadesHijo.faltante)}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
                            <span style="font-weight: bold; color: #6c757d; font-size: 13px;">Unidades/Pack:</span>
                            <span style="font-size: 13px;">${hijoData.unidades_por_pack}</span>
                        </div>
                    </div>
                </div>
            </td>
        `;
        
        console.info(`[EXPAND] Creando fila hija para: ${codigo}`);
        console.log(`📝 [EXPAND] Fila hija renderizada → hijo: "${hijoData.descripcion}", pedido: ${cantidadesHijo.pedido_total}, stock: ${cantidadesHijo.stock_disponible}, faltante: ${cantidadesHijo.faltante}`);
        
        // Inserción robusta con fallback
        try {
            parentTr.insertAdjacentElement('afterend', childRow);
            console.info(`[EXPAND] Insertada afterend del padre: ${codigo}`);
        } catch (e) {
            console.warn(`[EXPAND-ERR] insertAdjacentElement falló, usando fallback`);
            const tbody = parentTr.closest('tbody');
            if (!tbody) {
                console.error(`[EXPAND-ERR] sin tbody, abortando`);
                return;
            }
            tbody.insertBefore(childRow, parentTr.nextSibling);
            console.info(`[EXPAND] Insertada con insertBefore: ${codigo}`);
        }
        
        // Agregar clase visible
        requestAnimationFrame(() => {
            childRow.classList.add('visible');
            console.info(`[EXPAND] Toggle visible=true para: ${codigo}`);
        });
        
        if (expandIcon) {
            expandIcon.style.transform = 'rotate(90deg)';
        }
        
        console.log(`✅ [EXPAND] Fila hija creada exitosamente para: ${codigo}`);
        
    } catch (error) {
        console.error(`❌ [EXPAND] Error al crear fila hija:`, error);
    }
}

/**
 * Función para manejar el clic en la fila expandible (delegación)
 */
async function handleFilaClick(codigoPadre, event) {
    if (event) {
        event.stopPropagation();
    }
    
    if (event && (event.target.tagName === 'BUTTON' || event.target.closest('button'))) {
        return;
    }
    
    const fila = document.querySelector(`[data-articulo="${codigoPadre}"]`);
    if (!fila || !fila.classList.contains('has-children')) {
        return;
    }
    
    await toggleExpandirArticulo(fila);
}

/**
 * Función para preservar expansión tras re-render del resumen
 */
async function preservarExpansion() {
    console.log(`[EXPAND] Preservando expansión para ${expandedParents.size} padres`);
    
    for (const codigoPadre of expandedParents) {
        const parentRow = document.querySelector(`[data-articulo="${codigoPadre}"]`);
        if (!parentRow) {
            console.warn(`[EXPAND] Padre ${codigoPadre} no encontrado tras re-render, removiendo del Set`);
            expandedParents.delete(codigoPadre);
            continue;
        }
        
        let childRow = document.getElementById(`child-for-${codigoPadre}`);
        
        if (!childRow) {
            // Recrear fila hija si no existe
            console.log(`[EXPAND] Recreando fila hija para: ${codigoPadre}`);
            const datosPadre = obtenerDatosPadre(parentRow, codigoPadre);
            const mapping = await obtenerPackMapping(codigoPadre);
            if (mapping) {
                await crearFilaHija(parentRow, datosPadre, mapping);
            }
            childRow = document.getElementById(`child-for-${codigoPadre}`);
        }
        
        if (childRow && !childRow.classList.contains('visible')) {
            childRow.classList.add('visible');
            console.log(`[EXPAND] Fila hija restaurada como visible: ${codigoPadre}`);
        }
    }
}

/**
 * Función para verificar y actualizar botones y estilos de artículos con pack
 */
async function actualizarIconosExpansion() {
    if (isUpdatingIcons) {
        console.log('⚠️ [PACK-CHECK] Ya hay una actualización en progreso, cancelando...');
        return;
    }
    
    if (updateIconsTimeout) {
        clearTimeout(updateIconsTimeout);
        updateIconsTimeout = null;
    }
    
    return new Promise((resolve) => {
        updateIconsTimeout = setTimeout(async () => {
            isUpdatingIcons = true;
            
            try {
                const filas = document.querySelectorAll('.expandible-row');
                console.log(`🔍 [PACK-CHECK] Verificando ${filas.length} artículos para configuración pack`);
                
                for (const fila of filas) {
                    const codigoArticulo = fila.getAttribute('data-articulo');
                    if (!codigoArticulo) continue;
                    
                    const packButton = fila.querySelector('.pack-config-btn');
                    const descripcionCell = fila.querySelector('td:nth-child(2)');
                    
                    if (!packButton) continue;
                    
                    const packMapping = await obtenerPackMapping(codigoArticulo);
                    
                    if (!packMapping) {
                        packButton.innerHTML = '🧩 Pack';
                        packButton.style.backgroundColor = '#6f42c1';
                        packButton.title = 'Configurar pack para este artículo';
                        
                        fila.classList.remove('has-children');
                        fila.style.cursor = 'default';
                        fila.style.borderLeft = 'none';
                        fila.style.backgroundColor = '';
                        
                        if (descripcionCell) {
                            const expandIcon = descripcionCell.querySelector('.expand-icon');
                            if (expandIcon) {
                                expandIcon.remove();
                            }
                            
                            descripcionCell.style.cursor = 'default';
                            descripcionCell.removeAttribute('tabindex');
                            descripcionCell.removeAttribute('role');
                            descripcionCell.removeAttribute('aria-expanded');
                            descripcionCell.onclick = null;
                            descripcionCell.onkeydown = null;
                        }
                    } else {
                        packButton.innerHTML = '✏️ Editar Pack';
                        packButton.style.backgroundColor = '#28a745';
                        packButton.title = `Pack configurado: ${packMapping.unidades || packMapping.multiplicador_ingredientes}x por pack`;
                        
                        fila.classList.add('has-children');
                        fila.style.borderLeft = '4px solid #17a2b8';
                        fila.style.backgroundColor = 'rgba(23, 162, 184, 0.05)';
                        
                        if (descripcionCell) {
                            if (!descripcionCell.querySelector('.expand-icon')) {
                                const expandIcon = document.createElement('span');
                                expandIcon.className = 'expand-icon';
                                expandIcon.textContent = '▶';
                                expandIcon.style.cssText = 'display: inline-block; margin-right: 8px; transition: transform 0.3s ease; font-weight: bold; color: #17a2b8;';
                                descripcionCell.insertBefore(expandIcon, descripcionCell.firstChild);
                            }
                            
                            const newDescripcionCell = descripcionCell.cloneNode(true);
                            descripcionCell.parentNode.replaceChild(newDescripcionCell, descripcionCell);
                            
                            newDescripcionCell.style.cursor = 'pointer';
                            newDescripcionCell.setAttribute('tabindex', '0');
                            newDescripcionCell.setAttribute('role', 'button');
                            newDescripcionCell.setAttribute('aria-expanded', 'false');
                            newDescripcionCell.title = 'Clic para expandir y ver componente hijo';
                            
                            newDescripcionCell.onclick = async function(e) {
                                e.stopPropagation();
                                await toggleExpandirArticulo(fila);
                            };
                            
                            newDescripcionCell.onkeydown = async function(e) {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await toggleExpandirArticulo(fila);
                                }
                            };
                        }
                    }
                }
                
                console.log(`✅ [PACK-CHECK] Botones y estilos actualizados`);
            } catch (error) {
                console.error('❌ [PACK-CHECK] Error:', error);
            } finally {
                isUpdatingIcons = false;
                resolve();
            }
        }, 800);
    });
}

// Función para invalidar cache de pack mappings
window.invalidarCachePackMappings = function(codigoPadre) {
    if (packMappingsCache.has(codigoPadre)) {
        packMappingsCache.delete(codigoPadre);
        console.log('🗑️ [PACK-CACHE] Cache invalidado para:', codigoPadre);
    }
};

// Exponer funciones globalmente
window.toggleExpandirArticulo = toggleExpandirArticulo;
window.actualizarIconosExpansion = actualizarIconosExpansion;
window.handleFilaClick = handleFilaClick;
window.obtenerPackMapping = obtenerPackMapping;
window.preservarExpansion = preservarExpansion;

// Función auxiliar para formatear números
if (typeof window.formatearNumeroResumen === 'undefined') {
    window.formatearNumeroResumen = function(valor) {
        if (valor === null || valor === undefined || valor === '') return '0.00';
        const numero = Number(valor);
        if (isNaN(numero)) return '0.00';
        return numero.toFixed(2);
    };
}

console.log('✅ [EXPAND] Módulo de filas expandibles cargado (v17.4 - con descripcion real de hijos)');
