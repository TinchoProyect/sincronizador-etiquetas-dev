/**
 * Lógica Frontend del Búnker Transaccional
 */

// ✅ Helper Estructural v5.6: Escape Seguro para Atributos HTML
window.escapeHtmlAttr = function(val) {
    if (val === null || val === undefined) return '';
    const str = (typeof val === 'object') ? JSON.stringify(val) : String(val);
    return str
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

document.addEventListener('DOMContentLoaded', async () => {
    await window.cargarFamiliasBunker();
    await cargarListasDinamicas();
    await cargarRubrosTaxonomia();
    if (typeof window.cargarCatalogoPackaging === 'function') {
        await window.cargarCatalogoPackaging();
    }
    if (typeof window.cargarColaboradoresTarifas === 'function') {
        await window.cargarColaboradoresTarifas();
    }
    if (typeof window.cargarCatalogoIngredientesMP === 'function') {
        await window.cargarCatalogoIngredientesMP();
    }
    if (typeof window.inicializarEventosReceta === 'function') {
        window.inicializarEventosReceta();
    }

    // ⚖️ Listener reactivo para sobrescritura manual de Costo Base
    const costoBaseInput = document.getElementById('costo_base');
    if (costoBaseInput) {
        costoBaseInput.addEventListener('input', () => {
            const kilos = parseInputValue(document.getElementById('kilos_unidad')) || 0;
            const cantPack = parseInt(document.getElementById('cantidad_pack').value) || 1;
            const enUnidades = document.getElementById('expresar_unidades') ? document.getElementById('expresar_unidades').checked : false;
            const manualCost = parseInputValue(costoBaseInput) || 0;

            if (enUnidades && cantPack > 0 && manualCost > 0) {
                window.referenteCostoUnitario = manualCost / cantPack;
            } else if (!enUnidades && kilos > 0 && manualCost > 0) {
                window.referenteCostoUnitario = manualCost / kilos;
            }
            const avisoCosto = document.getElementById('aviso_costo_proporcional');
            if (avisoCosto) avisoCosto.style.display = 'none';
        });
    }

    // 🌐 Inicializar Autocomplete para Artículo Principal
    const pInput = document.getElementById('descripcion_principal_input');
    const pResultados = document.getElementById('descripcion_principal_resultados');
    const pHidden = document.getElementById('descripcion_principal');
    
    if (pInput && pResultados && pHidden) {
        let timeoutPrincipal = null;
        
        pInput.addEventListener('input', () => {
            clearTimeout(timeoutPrincipal);
            const query = pInput.value.trim();
            
            if (query.length < 2) {
                pResultados.style.display = 'none';
                return;
            }
            
            timeoutPrincipal = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/logistica/bunker/diccionario?q=${encodeURIComponent(query)}`);
                    const data = await res.json();
                    
                    pResultados.innerHTML = '';
                    if (data.success && data.data.length > 0) {
                        data.data.forEach(item => {
                            const div = document.createElement('div');
                            div.style.display = 'flex';
                            div.style.justifyContent = 'space-between';
                            div.style.alignItems = 'center';
                            div.style.padding = '10px 12px';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid #f1f5f9';
                            div.style.fontSize = '0.95em';
                            if (item.en_revision) div.style.backgroundColor = '#fffbeb';
                            div.onmouseover = () => div.style.backgroundColor = item.en_revision ? '#fef3c7' : '#f8fafc';
                            div.onmouseout = () => div.style.backgroundColor = item.en_revision ? '#fffbeb' : 'transparent';
                            
                            div.innerHTML = `
                                <span>
                                    <strong>${item.termino}</strong> 
                                    <span style="color:#64748b; font-size:0.85em; margin-left: 5px;">[${item.abreviatura}]</span>
                                    ${item.en_revision ? '<span style="background:#f59e0b; color:#fff; font-size:0.75em; padding:1px 5px; border-radius:3px; font-weight:bold; margin-left:5px;">🟡 REVISIÓN</span>' : ''}
                                </span>
                                <label style="font-size:0.8em; color:#b45309; cursor:pointer; font-weight:bold; margin-left:10px;" onmousedown="event.preventDefault(); event.stopPropagation();" onclick="event.stopPropagation();">
                                    <input type="checkbox" ${item.en_revision ? 'checked' : ''} onchange="window.toggleRevisionDesdeDropdown(event, ${item.id}, this.checked)"> 🟡 En Revisión
                                </label>
                            `;
                            div.onclick = () => {
                                pInput.value = `${item.termino} [${item.abreviatura}]`;
                                pHidden.value = item.termino;
                                asignarTerminoDict('descripcion_principal', item.termino, item.abreviatura);
                                pResultados.style.display = 'none';
                                actualizarLivePreview();
                            };
                            pResultados.appendChild(div);
                        });

                        // Agregar siempre opción de "Crear nuevo Artículo Principal" al final
                        const divNuevo = document.createElement('div');
                        divNuevo.style.padding = '10px 12px';
                        divNuevo.style.cursor = 'pointer';
                        divNuevo.style.borderTop = '1px dashed #3b82f6';
                        divNuevo.style.fontSize = '0.95em';
                        divNuevo.style.color = '#2563eb';
                        divNuevo.style.fontWeight = 'bold';
                        divNuevo.onmouseover = () => divNuevo.style.backgroundColor = '#eff6ff';
                        divNuevo.onmouseout = () => divNuevo.style.backgroundColor = 'transparent';
                        divNuevo.innerHTML = `✨ [+] Registrar "${query}" como nuevo Artículo Principal...`;
                        divNuevo.onclick = () => {
                            window.crearNuevoArticuloPrincipalDesdeQuery(query);
                        };
                        pResultados.appendChild(divNuevo);

                        pResultados.style.display = 'block';
                    } else {
                        // Si no hay resultados, mostrar únicamente la opción de crear nuevo
                        const divNuevo = document.createElement('div');
                        divNuevo.style.padding = '10px 12px';
                        divNuevo.style.cursor = 'pointer';
                        divNuevo.style.fontSize = '0.95em';
                        divNuevo.style.color = '#2563eb';
                        divNuevo.style.fontWeight = 'bold';
                        divNuevo.onmouseover = () => divNuevo.style.backgroundColor = '#eff6ff';
                        divNuevo.onmouseout = () => divNuevo.style.backgroundColor = 'transparent';
                        divNuevo.innerHTML = `✨ [+] Registrar "${query}" como nuevo Artículo Principal...`;
                        divNuevo.onclick = () => {
                            window.crearNuevoArticuloPrincipalDesdeQuery(query);
                        };
                        pResultados.appendChild(divNuevo);
                        pResultados.style.display = 'block';
                    }
                } catch (e) {
                    console.error(e);
                }
            }, 300);
        });
        
        pInput.addEventListener('blur', () => {
            setTimeout(async () => {
                pResultados.style.display = 'none';
                let queryTemp = pInput.value.trim();
                let abrev = queryTemp;
                
                if (queryTemp.includes(' [')) {
                    const parts = queryTemp.split(' [');
                    queryTemp = parts[0].trim();
                    abrev = parts[1].replace(']', '').trim();
                }
                
                if (!queryTemp) {
                    pHidden.value = '';
                    limpiarTerminoDict('descripcion_principal');
                    actualizarLivePreview();
                    return;
                }
                
                pHidden.value = queryTemp;
                asignarTerminoDict('descripcion_principal', queryTemp, abrev);
                pInput.value = abrev !== queryTemp ? `${queryTemp} [${abrev}]` : queryTemp;
                actualizarLivePreview();
                
                if (typeof handleDescripcionPrincipalBlur === 'function') {
                    await handleDescripcionPrincipalBlur();
                }
            }, 250);
        });
    }

    // 🌐 Inicializar Autocomplete para Código de Artículo Hijo
    const hijoInput = document.getElementById('pack_hijo_codigo');
    const hijoSugerencias = document.getElementById('pack_hijo_sugerencias');
    
    if (hijoInput && hijoSugerencias) {
        hijoSugerencias.style.position = 'absolute';
        hijoSugerencias.style.top = '100%';
        hijoSugerencias.style.left = '0';
        hijoSugerencias.style.right = '0';
        hijoSugerencias.style.background = 'white';
        hijoSugerencias.style.border = '1px solid #cbd5e1';
        hijoSugerencias.style.borderRadius = '0 0 6px 6px';
        hijoSugerencias.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        hijoSugerencias.style.zIndex = '10000';
        hijoSugerencias.style.maxHeight = '220px';
        hijoSugerencias.style.overflowY = 'auto';
        hijoSugerencias.style.boxSizing = 'border-box';
        
        let timeoutHijo = null;
        
        hijoInput.addEventListener('input', () => {
            clearTimeout(timeoutHijo);
            const query = hijoInput.value.trim();
            
            if (query.length < 2) {
                hijoSugerencias.style.display = 'none';
                return;
            }
            
            timeoutHijo = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/logistica/bunker/buscar-hijos?q=${encodeURIComponent(query)}`);
                    const data = await res.json();
                    
                    hijoSugerencias.innerHTML = '';
                    if (data.success && data.data.length > 0) {
                        data.data.forEach(item => {
                            const div = document.createElement('div');
                            div.style.padding = '10px 12px';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid #f1f5f9';
                            div.style.fontSize = '0.95em';
                            div.onmouseover = () => div.style.backgroundColor = '#f8fafc';
                            div.onmouseout = () => div.style.backgroundColor = 'transparent';
                            
                            div.innerHTML = `<strong>${item.id}</strong> <span style="color:#64748b; font-size:0.85em; margin-left: 5px;">${item.descripcion || item.descripcion_generada || ''}</span>`;
                            div.onclick = () => {
                                hijoInput.value = item.id;
                                hijoSugerencias.style.display = 'none';
                            };
                            hijoSugerencias.appendChild(div);
                        });
                        hijoSugerencias.style.display = 'block';
                    } else {
                        hijoSugerencias.style.display = 'none';
                    }
                } catch (e) {
                    console.error(e);
                }
            }, 300);
        });
        
        hijoInput.addEventListener('blur', () => {
            setTimeout(() => {
                hijoSugerencias.style.display = 'none';
            }, 250);
        });
    }
    
    // Interceptar Modo Edición, Modo Clonación o Modo Enriquecimiento Directo Legacy (?enrich=)
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const cloneId = urlParams.get('clone');
    const enrichId = urlParams.get('enrich');

    if (editId) {
        // Ocultar buscador de Enriquecimiento y panel de clonación para evitar confusiones de estado
        const panelClon = document.getElementById('panel_clonacion');
        if (panelClon) panelClon.style.display = 'none';
        const panelEnriq = document.getElementById('panel_enriquecimiento') || document.querySelector('.bunker-panel');
        if (panelEnriq && panelEnriq.innerHTML.includes('Enriquecer')) {
            panelEnriq.style.display = 'none';
        }
        
        // UX: Cambiar título del header para denotar edición
        const headerTitle = document.querySelector('.header-left h1');
        if (headerTitle) {
            headerTitle.innerHTML = '🛡️ Edición de Artículos';
        }
 
        // UX: Dynamic Return Button
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.innerHTML = `
                <button class="btn-secondary" onclick="window.location.href='listado-bunker.html'" style="background-color: #3b82f6; color: white; border: none; cursor: pointer;">
                    ← Volver a Gestión de Artículos
                </button>
                <button class="btn-secondary" onclick="window.location.href='http://localhost:3000'" style="cursor: pointer;">
                    ← Volver al Menú Principal
                </button>
            `;
        }
 
        await hidratarFormularioEdicion(editId);
    } else if (cloneId) {
        const headerTitle = document.querySelector('.header-left h1');
        if (headerTitle) {
            headerTitle.innerHTML = '📋 Crear Variante a Imagen y Semejanza';
        }

        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.innerHTML = `
                <button class="btn-secondary" onclick="window.location.href='listado-bunker.html'" style="background-color: #8b5cf6; color: white; border: none; cursor: pointer;">
                    ← Volver a Gestión de Artículos
                </button>
                <button class="btn-secondary" onclick="window.location.href='http://localhost:3000'" style="cursor: pointer;">
                    ← Volver al Menú Principal
                </button>
            `;
        }

        await window.hidratarFormularioClon(cloneId);
    } else {
        const famSelectInit = document.getElementById('bunker_familia_id');
        if (famSelectInit && famSelectInit.value && typeof window.cambiarFamiliaArticulo === 'function') {
            await window.cambiarFamiliaArticulo(famSelectInit.value);
        }

        if (enrichId) {
            const headerTitle = document.querySelector('.header-left h1');
            if (headerTitle) {
                headerTitle.innerHTML = '🏛️ Alta en Búnker desde Stock Legacy';
            }

            const headerRight = document.querySelector('.header-right');
            if (headerRight) {
                headerRight.innerHTML = `
                    <button class="btn-secondary" onclick="window.location.href='listado-bunker.html'" style="background-color: #7c3aed; color: white; border: none; cursor: pointer;">
                        ← Volver a Gestión de Artículos
                    </button>
                    <button class="btn-secondary" onclick="window.location.href='http://localhost:3000'" style="cursor: pointer;">
                        ← Volver al Menú Principal
                    </button>
                `;
            }

            try {
                const resEnrich = await fetch(`/api/logistica/bunker/buscar-consolidado?exact_id=${encodeURIComponent(enrichId)}`);
                const dataEnrich = await resEnrich.json();
                if (dataEnrich.success && Array.isArray(dataEnrich.data) && dataEnrich.data.length > 0) {
                    const itemLegacy = dataEnrich.data[0];
                    const inputCons = document.getElementById('buscador_consolidado');
                    if (inputCons) inputCons.value = itemLegacy.descripcion || itemLegacy.id;
                    await seleccionarArticuloConsolidado(itemLegacy);
                }
            } catch (errEnrich) {
                console.error('Error precargando artículo Legacy por ?enrich=', errEnrich);
            }
        }
    }
});

/**
 * Estado Nomenclador Vivo
 */
let dictLocal = {
    principal: null,
    propiedades: [] // Array of { idContainer, categoria, termino, abreviatura }
};
let nuevosTerminosPendientes = [];
let isPrompting = false;
let timeoutBusqueda = null;
let pendingPregenerarPromise = null;

let articuloConsolidadoSeleccionado = null;
let timeoutConsolidado = null;

// =========================================================================
// MOTOR DE BÚSQUEDA UNIVERSAL (Fase 49) Y CLONACIÓN INTEGRAL DE ARTÍCULOS
// =========================================================================

window.obtenerTextoBusquedaArticulo = function(art) {
    if (!art) return '';

    const tokens = [];

    // 1. Descripciones y nomenclador
    if (art.descripcion_generada) tokens.push(art.descripcion_generada);
    if (art.descripcion && art.descripcion !== art.descripcion_generada) {
        tokens.push(art.descripcion);
    }
    if (art.description && art.description !== art.descripcion_generada) {
        tokens.push(art.description);
    }
    if (art.descripcion_legacy) {
        tokens.push(art.descripcion_legacy);
    }

    // 2. Identificadores clave
    if (art.articulo_id) tokens.push(art.articulo_id);
    if (art.articulo_numero) tokens.push(art.articulo_numero);
    if (art.codigo_barras) tokens.push(art.codigo_barras);

    // 3. Taxonomía de Familia y Rubros
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || (art.propiedades_dinamicas && art.propiedades_dinamicas.familia_nombre);
    if (famNombre) tokens.push(famNombre);
    if (art.rubro) tokens.push(art.rubro);
    if (art.sub_rubro) tokens.push(art.sub_rubro);
    if (art.articulo_principal_nombre) tokens.push(art.articulo_principal_nombre);

    // 4. Atributos descriptivos completos (incluyendo silenciosos, abreviaturas y posiciones)
    let pd = art.propiedades_dinamicas;
    if (typeof pd === 'string') {
        try { pd = JSON.parse(pd); } catch (e) {}
    }

    if (pd && typeof pd === 'object') {
        if (pd.articulo_principal) tokens.push(pd.articulo_principal);
        if (pd.familia_nombre) tokens.push(pd.familia_nombre);
        if (pd.posiciones && typeof pd.posiciones === 'object') {
            Object.values(pd.posiciones).forEach(pos => {
                if (pos && pos.valor) tokens.push(pos.valor);
                if (pos && pos.abreviatura) tokens.push(pos.abreviatura);
                if (pos && pos.eje) tokens.push(pos.eje);
            });
        }
    }

    return tokens.join(' ').toLowerCase();
};

let catalogoBunkerCache = null;
let timeoutBusquedaReferente = null;
window.articuloReferenteClonadoId = null;

async function buscarReferenteEnVivo(inputEl) {
    clearTimeout(timeoutBusquedaReferente);
    const query = inputEl.value.trim().toLowerCase();
    const listId = "autocomplete-list-" + inputEl.id;
    const listContainer = document.getElementById(listId);
    if (!listContainer) return;

    if (query.length < 2) {
        listContainer.style.display = 'none';
        return;
    }

    timeoutBusquedaReferente = setTimeout(async () => {
        try {
            if (!catalogoBunkerCache) {
                const res = await fetch('/api/logistica/bunker/listado');
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    catalogoBunkerCache = json.data;
                } else {
                    catalogoBunkerCache = [];
                }
            }

            const terms = query.split(/\s+/).filter(Boolean);
            const filtrados = catalogoBunkerCache.filter(art => {
                const searchHaystack = window.obtenerTextoBusquedaArticulo(art);
                return terms.every(term => searchHaystack.includes(term));
            }).slice(0, 15);

            listContainer.innerHTML = '';
            if (filtrados.length === 0) {
                const div = document.createElement('div');
                div.style.padding = '8px 12px';
                div.style.color = '#94a3b8';
                div.style.fontStyle = 'italic';
                div.innerText = 'No se encontraron artículos en el Búnker con ese criterio.';
                listContainer.appendChild(div);
                listContainer.style.display = 'block';
                return;
            }

            filtrados.forEach(art => {
                const div = document.createElement('div');
                div.style.padding = '8px 12px';
                div.style.cursor = 'pointer';
                div.style.borderBottom = '1px solid #f1f5f9';
                div.style.backgroundColor = '#ffffff';

                div.innerHTML = `
                    <div style="font-weight: 600; color: #1e293b;">${art.descripcion_generada || art.descripcion}</div>
                    <div style="font-size: 0.8em; color: #64748b; display: flex; gap: 10px; margin-top: 2px;">
                        <span><strong>ID:</strong> ${art.articulo_id}</span>
                        <span><strong>Familia:</strong> ${art.familia_nombre || 'General'}</span>
                        <span><strong>Kilos:</strong> ${art.kilos_unidad || 0} kg</span>
                        ${art.pack_hijo_codigo ? `<span style="color:#b45309; font-weight:bold;">📦 Insumo Padre: ${art.pack_hijo_codigo}</span>` : ''}
                    </div>
                `;

                div.onmouseover = () => { div.style.backgroundColor = '#f5f3ff'; };
                div.onmouseout = () => { div.style.backgroundColor = '#ffffff'; };

                div.onclick = async () => {
                    inputEl.value = `[${art.articulo_id}] ${art.descripcion_generada || art.descripcion}`;
                    listContainer.style.display = 'none';
                    await window.hidratarFormularioClon(art.articulo_id);
                };
                listContainer.appendChild(div);
            });
            listContainer.style.display = 'block';
        } catch (e) {
            console.error('Error buscando referente para clonación:', e);
        }
    }, 200);
}

window.limpiarReferente = function() {
    window.articuloReferenteClonadoId = null;
    window.referenteCostoUnitario = 0;
    const avisoCosto = document.getElementById('aviso_costo_proporcional');
    if (avisoCosto) {
        avisoCosto.innerHTML = '';
        avisoCosto.style.display = 'none';
    }
    const inputReferente = document.getElementById('buscador_referente');
    if (inputReferente) inputReferente.value = '';
    const badgeClon = document.getElementById('badge_clon_activo');
    if (badgeClon) badgeClon.style.display = 'none';
    const btnLimpiar = document.getElementById('btn_limpiar_referente');
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    const avisoInfo = document.getElementById('aviso_referente_info');
    if (avisoInfo) {
        avisoInfo.innerHTML = '';
        avisoInfo.style.display = 'none';
    }
    const btnSubmit = document.querySelector('.btn-submit');
    if (btnSubmit) {
        btnSubmit.innerHTML = '💾 Guardar y Generar Artículo Pivote';
        btnSubmit.style.background = '';
    }
    const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
    if (descLegacyEl) {
        descLegacyEl.innerText = (articuloConsolidadoSeleccionado && articuloConsolidadoSeleccionado.descripcion)
            ? `Legacy: ${articuloConsolidadoSeleccionado.descripcion}`
            : '';
    }

    // Resetear estado y ocultar panel de receta de fraccionamiento
    window.referenteTeniaReceta = false;
    if (window.estadoRecetaArticulo) {
        window.estadoRecetaArticulo.activa = false;
        window.estadoRecetaArticulo.materiaPrima = null;
        window.estadoRecetaArticulo.packaging = null;
        window.estadoRecetaArticulo.manoObra = null;
        window.estadoRecetaArticulo.costoTiempo = 0;
    }
    const panelReceta = document.getElementById('panel_receta_fraccionamiento');
    if (panelReceta) panelReceta.style.display = 'none';
    const chkReceta = document.getElementById('chk_activar_receta');
    if (chkReceta) chkReceta.checked = false;
};

window.hidratarFormularioClon = async function(id) {
    return await window.hidratarFormularioEdicion(id, { esModoClon: true });
};

/**
 * Autocomplete Consolidado (Fase 3)
 */
function renderizarItemsConsolidadoAutocomplete(items, listContainer, inputEl) {
    listContainer.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.padding = '8px 12px';
        emptyDiv.style.color = '#94a3b8';
        emptyDiv.style.fontStyle = 'italic';
        emptyDiv.innerText = 'No se encontraron artículos en Stock Legacy con ese criterio.';
        listContainer.appendChild(emptyDiv);
        listContainer.style.display = 'block';
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        const badgeDesfasado = item.estructura_desfasada 
            ? `<span class="badge-desfasado" style="background:#fef3c7; color:#b45309; border:1px solid #f59e0b; padding:2px 6px; border-radius:4px; font-size:0.75em; font-weight:bold; margin-left:6px;" title="Este artículo posee atributos grabados con una versión previa de la plantilla. Al editar y guardar, se actualizará automáticamente.">⚠️ Revisar Plantilla</span>` 
            : '';
        const stockUn = parseFloat(item.stock_consolidado || 0);
        const kilosUn = parseFloat(item.kilos_unidad || 0);
        const badgeStock = stockUn > 0
            ? `<span style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:1px 6px; border-radius:8px; font-size:0.75em; font-weight:800; margin-left:6px;">📦 Stock: ${stockUn} un${kilosUn > 0 ? ' (' + (stockUn * kilosUn).toFixed(1) + ' kg)' : ''}</span>`
            : `<span style="background:#f1f5f9; color:#94a3b8; padding:1px 6px; border-radius:8px; font-size:0.73em; margin-left:6px;">Stock: 0</span>`;
        const badgePeso = kilosUn > 0
            ? `<span style="color:#475569; font-weight:700; margin-left:6px; font-size:0.8em;">⚖️ ${kilosUn} kg</span>`
            : '';
        
        if (item.ya_enriquecido) {
            div.style.opacity = '0.5';
            div.style.cursor = 'not-allowed';
            div.style.backgroundColor = '#f8fafc';
            div.innerHTML = `<strong>${item.descripcion}</strong> ${badgeDesfasado} ${badgeStock} <span class="badge" style="background-color: #64748b; color: white; margin-left: 8px; font-size: 0.75em;">🔒 Ya en Búnker</span><br><span style="color:#666; font-size:0.85em;">ID: ${item.id} | EAN: ${item.codigo_barras || 'N/A'} ${badgePeso}</span>`;
            div.onclick = (e) => {
                e.stopPropagation();
                Swal.fire({
                    icon: 'warning',
                    title: 'Artículo Bloqueado',
                    text: 'Este artículo ya posee inteligencia Búnker. Para realizar modificaciones sobre él, búscalo en la solapa de Gestión de Artículos y oprime "Editar".'
                });
            };
        } else {
            div.innerHTML = `<strong>${item.descripcion}</strong> ${badgeDesfasado} ${badgeStock} <br><span style="color:#666; font-size:0.85em;">ID: <strong>${item.id}</strong> | EAN: ${item.codigo_barras || 'N/A'} ${badgePeso}</span>`;
            div.onclick = () => {
                seleccionarArticuloConsolidado(item);
                if (inputEl) inputEl.value = item.descripcion;
                listContainer.style.display = 'none';
            };
        }
        listContainer.appendChild(div);
    });
    listContainer.style.display = 'block';
}

async function buscarConsolidadoEnVivo(inputEl) {
    clearTimeout(timeoutConsolidado);
    const query = inputEl.value.trim();
    const listId = "autocomplete-list-" + inputEl.id;
    const listContainer = document.getElementById(listId);
    const chkSoloStock = document.getElementById('chk_consolidado_solo_stock');
    const soloConStock = chkSoloStock ? chkSoloStock.checked : false;
    
    if (!listContainer) return;

    if (query.length < 2) {
        listContainer.style.display = 'none';
        return;
    }

    timeoutConsolidado = setTimeout(async () => {
        try {
            const url = `/api/logistica/bunker/buscar-consolidado?q=${encodeURIComponent(query)}${soloConStock ? '&solo_con_stock=true' : ''}`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.success) {
                renderizarItemsConsolidadoAutocomplete(data.data, listContainer, inputEl);
            } else {
                listContainer.style.display = 'none';
            }
        } catch (e) {
            console.error(e);
        }
    }, 300);
}

window.mostrarPendientesLegacyConStock = async function() {
    const inputEl = document.getElementById('buscador_consolidado');
    const listContainer = document.getElementById('autocomplete-list-buscador_consolidado');
    if (!listContainer) return;

    try {
        const res = await fetch('/api/logistica/bunker/legacy-con-stock-pendientes');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
            const q = inputEl ? inputEl.value.trim().toLowerCase() : '';
            const items = q.length >= 2
                ? data.data.filter(i => `${i.id} ${i.descripcion || ''} ${i.codigo_barras || ''}`.toLowerCase().includes(q))
                : data.data;
            renderizarItemsConsolidadoAutocomplete(items, listContainer, inputEl);
        }
    } catch (e) {
        console.error('Error listando pendientes Legacy con stock:', e);
    }
};

async function seleccionarArticuloConsolidado(item) {
    articuloConsolidadoSeleccionado = item;
    
    document.getElementById('bunker_id_pivote').value = item.id;
    document.getElementById('bunker_codigo_barras').value = item.codigo_barras || item.id;
    
    const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
    if (descLegacyEl) {
        if (window.articuloReferenteClonadoId) {
            descLegacyEl.innerText = `✨ Clonando desde [${window.articuloReferenteClonadoId}] | Vinculado a Legacy: [${item.id}] ${item.descripcion || ''}`;
        } else {
            descLegacyEl.innerText = item.descripcion ? `Legacy: ${item.descripcion}` : '';
        }
    }

    const badgeEnrich = document.getElementById('badge_enrich_activo');
    if (badgeEnrich) badgeEnrich.style.display = 'inline-block';

    const avisoEnrich = document.getElementById('aviso_enriquecimiento_legacy_info');
    if (avisoEnrich) {
        const stockVal = parseFloat(item.stock_consolidado || 0);
        const kilosVal = parseFloat(item.kilos_unidad || 0);
        const costoVal = parseFloat(item.costo_base || 0);
        avisoEnrich.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                    <strong>🏛️ Artículo Legacy Seleccionado:</strong> <span style="font-family:monospace; font-weight:bold; background:#fef08a; padding:1px 6px; border-radius:4px;">[${item.id}]</span> <strong>${item.descripcion || ''}</strong>
                </div>
                <div style="display:flex; gap:10px; font-weight:700; font-size:0.92em;">
                    <span style="color:#166534;">📦 Stock: ${stockVal} un${kilosVal > 0 ? ' (' + (stockVal * kilosVal).toFixed(1) + ' kg)' : ''}</span>
                    <span>⚖️ Peso: ${kilosVal} kg</span>
                    <span>💰 Costo Legacy: $ ${costoVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </div>
            <div style="font-size:0.86em; color:#854d0e; margin-top:4px;">
                💡 Podés completar su nomenclatura manualmente abajo o usar <strong>"📋 Clonar desde Referente"</strong> arriba para copiar la estructura de otro artículo similar manteniendo este código Legacy <strong>[${item.id}]</strong>.
            </div>
        `;
        avisoEnrich.style.display = 'block';
    }

    // Al seleccionar un artículo del buscador consolidado (Lomasoft), desactivar automáticamente "Crear en Local"
    const chkLocal = document.getElementById('chk_crear_local');
    if (chkLocal && chkLocal.checked) {
        chkLocal.checked = false;
        if (typeof window.toggleCrearLocalMode === 'function') {
            await window.toggleCrearLocalMode(chkLocal);
        }
    }
    
    // Inyectar la descripción del artículo legacy en el campo de texto legacy
    const inputDescLegacy = document.getElementById('bunker_descripcion_legacy');
    if (inputDescLegacy) {
        inputDescLegacy.value = item.descripcion || '';
    }
    
    try {
        const res = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(item.id)}`);
        const data = await res.json();
        if (data.success && data.data) {
           if (!window.articuloReferenteClonadoId) {
               await cargarDatosBunkerExistentes(data.data);
               Swal.fire({
                    toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                    icon: 'info', title: 'Artículo existente en Búnker. Datos cargados.'
               });
           } else {
               // En modo clon, advertir amigablemente si el SKU destino ya tenía ficha Búnker previa
               Swal.fire({
                    icon: 'info',
                    title: 'Vinculación a SKU existente',
                    text: `El SKU [${item.id}] ya posee registro en Búnker. Al guardar, se actualizará su taxonomía y precios con la estructura del referente.`
               });
           }
        } else {
           // Precargar info financiera heredada de Lomasoft si existe
           if (item.costo_base !== undefined && (!window.articuloReferenteClonadoId || parseFloat(item.costo_base) > 0)) {
               document.getElementById('costo_base').value = item.costo_base;
           }
           if (item.porcentaje_iva !== undefined && !window.articuloReferenteClonadoId) {
               document.getElementById('porcentaje_iva').value = item.porcentaje_iva;
           }
           if (item.kilos_unidad !== undefined && (!window.articuloReferenteClonadoId || parseFloat(item.kilos_unidad) > 0)) {
               document.getElementById('kilos_unidad').value = item.kilos_unidad;
           }
           if (item.rubro && !window.articuloReferenteClonadoId) {
               const elRubro = document.getElementById('rubro');
               if (elRubro) {
                   elRubro.value = item.rubro;
                   if (typeof window.rubroSeleccionadoContexto === 'function') {
                       await window.rubroSeleccionadoContexto(elRubro);
                   }
                   if (item.sub_rubro && document.getElementById('sub_rubro')) {
                       document.getElementById('sub_rubro').value = item.sub_rubro;
                   }
               }
           }
           if (typeof window.recalcularTodaLaGrilla === 'function') {
               window.recalcularTodaLaGrilla();
           }
           
           Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'success', title: `Artículo Legacy [${item.id}] vinculado para alta en Búnker.`
           });
        }
    } catch(e) { }
}

function limpiarSeleccionConsolidado() {
    articuloConsolidadoSeleccionado = null;
    const inputConsolidado = document.getElementById('buscador_consolidado');
    if (inputConsolidado) inputConsolidado.value = '';

    const badgeEnrich = document.getElementById('badge_enrich_activo');
    if (badgeEnrich) badgeEnrich.style.display = 'none';
    const avisoEnrich = document.getElementById('aviso_enriquecimiento_legacy_info');
    if (avisoEnrich) {
        avisoEnrich.innerHTML = '';
        avisoEnrich.style.display = 'none';
    }

    const chkLocal = document.getElementById('chk_crear_local');
    const isLocal = chkLocal ? chkLocal.checked : false;

    const pivoteEl = document.getElementById('bunker_id_pivote');
    const barrasEl = document.getElementById('bunker_codigo_barras');

    if (isLocal) {
        if (pivoteEl) pivoteEl.value = 'Se generará EMB-XXXXXX';
        if (barrasEl) barrasEl.value = 'Se generará de 10 dígitos';
    } else {
        if (pivoteEl) pivoteEl.value = window.articuloReferenteClonadoId ? 'Seleccione desde el buscador Legacy arriba' : 'Generado Automáticamente';
        if (barrasEl) barrasEl.value = window.articuloReferenteClonadoId ? 'Seleccione desde el buscador Legacy arriba' : 'Generado Automáticamente';
    }

    const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
    if (descLegacyEl) {
        if (window.articuloReferenteClonadoId) {
            descLegacyEl.innerText = `✨ Clonando estructura desde SKU [${window.articuloReferenteClonadoId}]`;
        } else {
            descLegacyEl.innerText = '';
        }
    }

    // Solo limpiar costo y márgenes si NO estamos en modo clon
    if (!window.articuloReferenteClonadoId) {
        const costoBase = document.getElementById('costo_base');
        if (costoBase) costoBase.value = '';
        document.querySelectorAll('.input-margen-dinamico').forEach(i => i.value = '');
    }
}

async function cargarDatosBunkerExistentes(data) {
    document.getElementById('costo_base').value = data.costo_base || '';
    document.getElementById('porcentaje_iva').value = data.porcentaje_iva || 21;
    document.getElementById('kilos_unidad').value = data.kilos_unidad || 0;
    document.getElementById('moneda').value = data.moneda || '($)Pesos';
    document.getElementById('mantener_utilidad').checked = data.mantener_utilidad || false;
    
    if (data.rubro) {
        document.getElementById('rubro').value = data.rubro;
        await window.rubroSeleccionadoContexto(document.getElementById('rubro'));
        if (data.sub_rubro) {
            document.getElementById('sub_rubro').value = data.sub_rubro;
        }
    }
    
    // Margenes
    if (data.margenes && data.margenes.length > 0) {
        data.margenes.forEach(m => {
            const input = document.querySelector(`.input-margen-dinamico[data-listaid="${m.lista_id}"]`);
            if (input) input.value = m.margen_porcentaje;
        });
    }
    
    // Disparar las proyecciones visuales de todos los inputs llenados
    if (typeof recalcularTodaLaGrilla === 'function') {
        recalcularTodaLaGrilla();
    }
}

/**
 * TAXONOMÍA DINÁMICA (RUBROS & SUBRUBROS)
 */
let rubrosGlobales = [];
let subrubrosGlobales = [];

window.cargarRubrosTaxonomia = async function(preselectRubroName = null) {
    try {
        const res = await fetch('/api/logistica/bunker-taxonomia/rubros');
        const json = await res.json();
        const select = document.getElementById('rubro');
        
        if (json.success) {
            rubrosGlobales = json.data;
            select.innerHTML = '<option value="" disabled selected>Seleccione Rubro...</option>';
            rubrosGlobales.forEach(r => {
                select.innerHTML += `<option value="${r.nombre}" data-id="${r.id}">${r.nombre}</option>`;
            });
            select.innerHTML += `<option value="CREAR_NUEVO" style="font-weight:bold; color:#2563eb;">✨ [+] Crear Nuevo Rubro...</option>`;
            
            if (preselectRubroName) {
                select.value = preselectRubroName;
                await window.rubroSeleccionadoContexto(select);
            }
        }
    } catch(e) { console.error(e); }
};

window.rubroSeleccionadoContexto = async function(selectEl) {
    const val = selectEl.value;
    const subRubroSelect = document.getElementById('sub_rubro');
    
    if (val === "CREAR_NUEVO") {
        selectEl.value = ""; 
        const { value: nuevoNombre } = await Swal.fire({
            title: 'Nuevo Rubro',
            input: 'text',
            inputPlaceholder: 'Ej: Bebidas, Lácteos...',
            showCancelButton: true,
            confirmButtonText: 'Guardar',
            cancelButtonText: 'Cancelar'
        });
        
        if (nuevoNombre) {
            try {
                Swal.fire({title:'Guardando...', didOpen:()=>Swal.showLoading()});
                const res = await fetch('/api/logistica/bunker-taxonomia/rubros', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ nombre: nuevoNombre })
                });
                const json = await res.json();
                if (json.success) {
                    Swal.fire({title:'Creado', icon:'success', timer:1500, showConfirmButton:false});
                    await window.cargarRubrosTaxonomia(json.data.nombre);
                    return;
                } else {
                    Swal.fire('Error', json.error, 'error');
                }
            } catch(e) { Swal.fire('Error', 'Fallo de red', 'error'); }
        }
        return;
    }
    
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    const rubroId = selectedOpt ? selectedOpt.getAttribute('data-id') : null;
    
    if (rubroId) {
        subRubroSelect.disabled = false;
        await window.cargarSubrubrosTaxonomia(rubroId);
    } else {
        subRubroSelect.disabled = true;
    }
};

window.cargarSubrubrosTaxonomia = async function(rubroId, preselectSubrubroName = null) {
    try {
        const res = await fetch(`/api/logistica/bunker-taxonomia/${rubroId}/subrubros`);
        const json = await res.json();
        const select = document.getElementById('sub_rubro');
        
        if (json.success) {
            subrubrosGlobales = json.data;
            select.innerHTML = '<option value="" disabled selected>Seleccione Subrubro...</option>';
            subrubrosGlobales.forEach(s => {
                select.innerHTML += `<option value="${s.nombre}">${s.nombre}</option>`;
            });
            select.innerHTML += `<option value="CREAR_NUEVO" style="font-weight:bold; color:#2563eb;">✨ [+] Crear Nuevo Subrubro...</option>`;
            
            if (preselectSubrubroName) {
                select.value = preselectSubrubroName;
            }
        }
    } catch(e) { console.error(e); }
};

window.subrubroSeleccionadoContexto = async function(selectEl) {
    const val = selectEl.value;
    if (val === "CREAR_NUEVO") {
        selectEl.value = ""; 
        const rubroSelect = document.getElementById('rubro');
        const rubroOpt = rubroSelect.options[rubroSelect.selectedIndex];
        const rubroId = rubroOpt.getAttribute('data-id');
        
        const { value: nuevoNombre } = await Swal.fire({
            title: 'Nuevo Subrubro',
            input: 'text',
            inputPlaceholder: 'Ej: Gaseosas, Jugos...',
            showCancelButton: true,
            confirmButtonText: 'Guardar',
            cancelButtonText: 'Cancelar'
        });
        
        if (nuevoNombre) {
            try {
                Swal.fire({title:'Guardando...', didOpen:()=>Swal.showLoading()});
                const res = await fetch(`/api/logistica/bunker-taxonomia/${rubroId}/subrubros`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ nombre: nuevoNombre })
                });
                const json = await res.json();
                if (json.success) {
                    Swal.fire({title:'Creado', icon:'success', timer:1500, showConfirmButton:false});
                    await window.cargarSubrubrosTaxonomia(rubroId, json.data.nombre);
                } else {
                    Swal.fire('Error', json.error, 'error');
                }
            } catch(e) { Swal.fire('Error', 'Fallo de red', 'error'); }
        }
    }
};

/**
 * Autocomplete y Búsqueda en el Diccionario
 */
async function buscarDiccionarioEnVivo(inputEl) {
    clearTimeout(timeoutBusqueda);
    const query = inputEl.value.trim();
    const listId = "autocomplete-list-" + inputEl.id;
    const listContainer = document.getElementById(listId);
    
    if (!listContainer) return;

    if (query.length < 2) {
        listContainer.style.display = 'none';
        return;
    }

    timeoutBusqueda = setTimeout(async () => {
        try {
            const res = await fetch(`/api/logistica/bunker/diccionario?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            listContainer.innerHTML = '';
            if (data.success && data.data.length > 0) {
                data.data.forEach(item => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.justifyContent = 'space-between';
                    div.style.alignItems = 'center';
                    div.style.padding = '8px 12px';
                    div.style.borderBottom = '1px solid #f1f5f9';
                    div.style.cursor = 'pointer';
                    if (item.en_revision) div.style.backgroundColor = '#fffbeb';

                    div.innerHTML = `
                        <span>
                            <strong>${item.termino}</strong> 
                            <span style="color:#666; font-size:0.85em;">[${item.abreviatura}]</span>
                            ${item.en_revision ? '<span style="background:#f59e0b; color:#fff; font-size:0.75em; padding:1px 5px; border-radius:3px; font-weight:bold; margin-left:5px;">🟡 REVISIÓN</span>' : ''}
                        </span>
                        <label style="font-size:0.8em; color:#b45309; cursor:pointer; font-weight:bold; margin-left:10px;" onmousedown="event.preventDefault(); event.stopPropagation();" onclick="event.stopPropagation();">
                            <input type="checkbox" ${item.en_revision ? 'checked' : ''} onchange="window.toggleRevisionDesdeDropdown(event, ${item.id}, this.checked)"> 🟡 En Revisión
                        </label>
                    `;

                    div.onclick = () => {
                        inputEl.value = `${item.termino} [${item.abreviatura}]`;
                        asignarTerminoDict(inputEl.id, item.termino, item.abreviatura);
                        listContainer.style.display = 'none';
                    };
                    listContainer.appendChild(div);
                });
                listContainer.style.display = 'block';
            } else {
                listContainer.style.display = 'none';
            }
        } catch (e) {
            console.error(e);
        }
    }, 300);
}

document.addEventListener('click', (e) => {
    // Cerrar autocompletes si hace click fuera
    if (!e.target.matches('.autocomplete-items') && !e.target.matches('input')) {
        document.querySelectorAll('.autocomplete-items').forEach(el => el.style.display = 'none');
    }
});

async function validarDiccionarioBlur(inputEl, categoria) {
    let queryTemp = inputEl.value.trim();
    if (queryTemp.includes(' [')) {
        queryTemp = queryTemp.split(' [')[0].trim();
    }

    // EXCEPCIÓN DE VALIDACIÓN: El Artículo Principal no interrumpe el flujo y conserva su nombre descriptivo largo
    if (inputEl.id === 'descripcion_principal') {
        if (!queryTemp) {
            limpiarTerminoDict(inputEl.id);
            return;
        }
        asignarTerminoDict('descripcion_principal', queryTemp, queryTemp);
        inputEl.value = queryTemp;
        return;
    }

    if (isPrompting) return;
    
    // Pequeño delay por si hicicieron click en autocomplete
    setTimeout(async () => {
        let query = inputEl.value.trim();
        
        if (query.includes(' [')) {
            query = query.split(' [')[0].trim();
        }

        if (!query) {
            limpiarTerminoDict(inputEl.id);
            return;
        }

        // Ya fue asignado por click en autocomplete?
        if (terminoYaAsignado(inputEl.id, query)) {
            const prop = inputEl.id === 'descripcion_principal' ? dictLocal.principal : dictLocal.propiedades.find(p => p.idContainer === inputEl.id);
            if (prop && prop.abreviatura && !inputEl.value.includes(`[${prop.abreviatura}]`)) {
                 inputEl.value = `${query} [${prop.abreviatura}]`;
            }
            return;
        }

        isPrompting = true;
        
        // Consultar servidor antes de abrumar al usuario
        try {
            const res = await fetch(`/api/logistica/bunker/diccionario?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (data.success && data.data.length > 0) {
                // Existe coincidencia exacta
                const match = data.data.find(d => d.termino && String(d.termino).toLowerCase() === query.toLowerCase()) || data.data[0];
                asignarTerminoDict(inputEl.id, match.termino, match.abreviatura);
                inputEl.value = `${match.termino} [${match.abreviatura}]`;
                isPrompting = false;
                return;
            }
        } catch(e) {}
        
        // Modal para pedir abreviatura
        const { value: abrev } = await Swal.fire({
            title: 'Nuevo Término Detectado',
            text: `"${query}" no existe en el diccionario. Ingrese su Abreviatura oficial:`,
            input: 'text',
            inputPlaceholder: 'Ej: PEC',
            showCancelButton: true,
            confirmButtonText: 'Guardar en Diccionario',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || value.trim() === '') return 'Debe ingresar una abreviatura!';
                if (value.length > 10) return 'Abreviatura muy larga (Máximo 10 caracteres)';
            }
        });

        if (abrev) {
            const finalAbrev = abrev.trim().toUpperCase();
            // Guardar en pendientes
            nuevosTerminosPendientes.push({ termino: query, abreviatura: finalAbrev, categoria });
            asignarTerminoDict(inputEl.id, query, finalAbrev);
            inputEl.value = `${query} [${finalAbrev}]`;
        } else {
            // Canceló, limpiamos input
            inputEl.value = '';
            limpiarTerminoDict(inputEl.id);
        }
        isPrompting = false;
        document.querySelectorAll('.autocomplete-items').forEach(el => el.style.display = 'none');
    }, 200);
}

function asignarTerminoDict(inputId, termino, abreviatura, id = null) {
    if (inputId === 'descripcion_principal') {
        const prevSilencioso = dictLocal.principal ? (dictLocal.principal.silencioso === true) : false;
        const prevModo = dictLocal.principal ? (dictLocal.principal.modo_display || 'COMPLETO') : (window.modoDisplayPrincipal || 'COMPLETO');
        const prevId = dictLocal.principal ? dictLocal.principal.id : null;
        dictLocal.principal = { 
            id: id ? parseInt(id) : prevId, 
            termino, 
            abreviatura, 
            silencioso: prevSilencioso, 
            modo_display: prevModo 
        };
        if (typeof obtenerPlantillaParaArticulo === 'function') obtenerPlantillaParaArticulo(termino);
    } else {
        const propIndex = dictLocal.propiedades.findIndex(p => p.idContainer === inputId);
        if (propIndex >= 0) {
            dictLocal.propiedades[propIndex].termino = termino;
            dictLocal.propiedades[propIndex].abreviatura = abreviatura;
        } else {
            // No deberia pasar, pero fallback
            dictLocal.propiedades.push({ idContainer: inputId, termino, abreviatura, silencioso: false });
        }
    }
    actualizarLivePreview();
}
function limpiarTerminoDict(inputId) {
    if (inputId === 'descripcion_principal') {
        dictLocal.principal = null;
    } else {
        const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
        if (prop) {
            prop.termino = '';
            prop.abreviatura = '';
        }
    }
    actualizarLivePreview();
}

window.toggleVisibilidadPrincipal = function(forceSilencioso = null) {
    if (!dictLocal.principal) dictLocal.principal = { id: null, termino: '', abreviatura: '', silencioso: false, modo_display: window.modoDisplayPrincipal || 'COMPLETO' };
    if (forceSilencioso !== null) {
        dictLocal.principal.silencioso = forceSilencioso;
    } else {
        dictLocal.principal.silencioso = !dictLocal.principal.silencioso;
    }
    
    const btn = document.getElementById('toggle_attr_principal');
    if (btn) {
        if (dictLocal.principal.silencioso) {
            btn.innerHTML = '🙈';
            btn.title = "Silencioso (Nombre Principal no se concatena al Nomenclador)";
            btn.style.color = "#94a3b8";
        } else {
            btn.innerHTML = '👁️';
            btn.title = "Visible en Nomenclador";
            btn.style.color = "#3b82f6";
        }
    }
    actualizarLivePreview();
};

window.toggleVisibilidadAtributo = function(inputId, forceSilencioso = null) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop) return;
    
    if (forceSilencioso !== null) {
        prop.silencioso = forceSilencioso;
    } else {
        prop.silencioso = !prop.silencioso;
    }
    
    const btn = document.getElementById(`toggle_attr_${inputId}`);
    if (btn) {
        if (prop.silencioso) {
            btn.innerHTML = '🙈';
            btn.title = "Silencioso (No se concatena al Nomenclador)";
            btn.style.color = "#94a3b8";
        } else {
            btn.innerHTML = '👁️';
            btn.title = "Visible en Nomenclador";
            btn.style.color = "#3b82f6";
        }
    }
    actualizarLivePreview();
};

function terminoYaAsignado(inputId, query) {
    if (inputId === 'descripcion_principal') {
        return dictLocal.principal && dictLocal.principal.termino && String(dictLocal.principal.termino).toLowerCase() === query.toLowerCase();
    }
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    return prop && prop.termino && String(prop.termino).toLowerCase() === query.toLowerCase();
}

window.conmutarModoUnidades = function() {
    const kilosEl = document.getElementById('kilos_unidad');
    const gramosEl = document.getElementById('expresar_gramos');
    const unidadesEl = document.getElementById('expresar_unidades');
    const enUnidades = unidadesEl ? unidadesEl.checked : false;

    if (enUnidades) {
        if (gramosEl) {
            gramosEl.checked = false;
            gramosEl.disabled = true;
        }
        if (kilosEl) {
            kilosEl.value = '0.000';
            kilosEl.disabled = true;
            kilosEl.style.backgroundColor = '#e2e8f0';
            kilosEl.style.cursor = 'not-allowed';
        }
    } else {
        if (gramosEl) {
            gramosEl.disabled = false;
        }
        if (kilosEl) {
            kilosEl.disabled = false;
            kilosEl.style.backgroundColor = '';
            kilosEl.style.cursor = '';
        }
    }
    actualizarLivePreview();
};

window.setModoDisplayPrincipal = function(modo) {
    window.modoDisplayPrincipal = modo;
    if (!dictLocal.principal) dictLocal.principal = { id: null, termino: '', abreviatura: '', silencioso: false };
    dictLocal.principal.modo_display = modo;
    
    const btnComp = document.getElementById('btn_principal_mode_comp');
    const btnAbrev = document.getElementById('btn_principal_mode_abrev');
    if (btnComp && btnAbrev) {
        if (modo === 'COMPLETO') {
            btnComp.style.background = '#3b82f6';
            btnComp.style.color = 'white';
            btnAbrev.style.background = 'transparent';
            btnAbrev.style.color = '#64748b';
        } else {
            btnAbrev.style.background = '#3b82f6';
            btnAbrev.style.color = 'white';
            btnComp.style.background = 'transparent';
            btnComp.style.color = '#64748b';
        }
    }

    if (typeof window.actualizarDescripcionGenerada === 'function') {
        window.actualizarDescripcionGenerada();
    } else if (typeof actualizarLivePreview === 'function') {
        actualizarLivePreview();
    }
};

window.toggleRevisionDesdeDropdown = async function(event, itemDictId, estadoNuevo) {
    if (event) event.stopPropagation();
    try {
        Swal.fire({title: 'Actualizando marcado...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/logistica/bunker-diccionario/${itemDictId}/marcado`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ en_revision: estadoNuevo })
        });
        const json = await res.json();
        if (json.success) {
            Swal.fire({title: estadoNuevo ? '🟡 Marcado En Revisión' : '🟢 Estado Normal', icon: 'success', timer: 1000, showConfirmButton: false});
        } else {
            Swal.fire('Error', json.error || 'No se pudo actualizar marcado.', 'error');
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de conectividad', 'error');
    }
};

window.cambiarFamiliaArticulo = async function(familiaId) {
    console.log('🏷️ [BUNKER] Cambiando familia de artículo a ID:', familiaId);
    
    // 🔑 PURGA TRANSACCIONAL ABSOLUTA DE ESTADO v5.8
    const container = document.getElementById('atributos-container');
    if (container) {
        container.innerHTML = '';
    }
    dictLocal.propiedades = [];

    try {
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        if (jsonFam.success && Array.isArray(jsonFam.data)) {
            const curFam = jsonFam.data.find(f => String(f.id) === String(familiaId));
            const abrevServer = curFam ? (curFam.abreviatura || '') : '';
            window.lastKnownAbreviaturaFamilia = abrevServer;
            const inputAbrev = document.getElementById('bunker_abrev_familia');
            if (inputAbrev) inputAbrev.value = abrevServer;
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error obteniendo datos de familias para abreviatura:', e);
    }

    // Cargar y repoblar el selector Nivel 2 (#bunker_principal_id) con los consolidados de la nueva familia
    if (typeof window.cargarPrincipalesBunker === 'function') {
        await window.cargarPrincipalesBunker(familiaId);
    }
    
    let ejesSugeridos = [];
    try {
        const resTax = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`);
        const jsonTax = await resTax.json();
        if (jsonTax.success && Array.isArray(jsonTax.data) && jsonTax.data.length > 0) {
            ejesSugeridos = jsonTax.data
                .map(item => item.categoria)
                .filter(c => c && c.toLowerCase() !== 'articulo_principal' && c.toLowerCase() !== 'pos_1');
        }
    } catch(e) {
        console.warn('⚠️ [BUNKER] Fallo al consultar taxonomia para familia:', e);
    }

    if (ejesSugeridos.length === 0) {
        const ejesPorFamilia = {
            1: ['conformacion', 'variedad', 'calibre'],
            2: ['proceso', 'variedad', 'calibre'],
            3: ['proceso', 'base', 'mezcla'],
            4: ['extraccion', 'tipo', 'variedad'],
            5: ['estado', 'variedad', 'origen'],
            6: ['tipo', 'variedad']
        };
        ejesSugeridos = ejesPorFamilia[parseInt(familiaId)] || ['tipo', 'variedad'];
    }
    
    // Forzar actualización fresca del diccionario desde el servidor al cambiar de familia
    if (typeof obtenerPlantillaParaArticulo === 'function') {
        const termActual = dictLocal.principal ? (dictLocal.principal.termino || '') : '';
        await obtenerPlantillaParaArticulo(termActual, true);
    }

    // Inyectar los ejes posicionales limpios del nuevo molde en orden canónico
    for (const eje of ejesSugeridos) {
        const inputId = agregarAtributoUI(eje);
        if (inputId) {
            const selectEl = document.querySelector(`select[onchange*="${inputId}"]`);
            if (selectEl) {
                selectEl.value = eje;
                await window.actualizarCategoriaAtributo(inputId, selectEl);
            }
        }
    }
    
    if (typeof window.aplicarOrdenamientoEspejoTaxonomia === 'function') {
        await window.aplicarOrdenamientoEspejoTaxonomia(familiaId);
    }
    actualizarLivePreview();
};

window.incluirFamilia = false;
window.lastKnownAbreviaturaFamilia = '';

window.toggleInyeccionFamilia = function(forzadoVal = null) {
    if (forzadoVal !== null) {
        window.incluirFamilia = Boolean(forzadoVal);
    } else {
        window.incluirFamilia = !window.incluirFamilia;
    }

    const btnToggle = document.getElementById('btn_toggle_familia');
    const panelOpciones = document.getElementById('panel_opciones_familia');

    if (btnToggle) {
        if (window.incluirFamilia) {
            btnToggle.innerHTML = '👁️ Familia Visible en Nomenclatura';
            btnToggle.style.backgroundColor = '#2563eb';
            btnToggle.style.color = '#ffffff';
            btnToggle.style.borderColor = '#1d4ed8';
        } else {
            btnToggle.innerHTML = '🙈 Familia Oculta en Nomenclatura';
            btnToggle.style.backgroundColor = '#e2e8f0';
            btnToggle.style.color = '#475569';
            btnToggle.style.borderColor = '#cbd5e1';
        }
    }

    if (panelOpciones) {
        panelOpciones.style.display = window.incluirFamilia ? 'flex' : 'none';
    }

    actualizarLivePreview();
};

window.sincronizarAbreviaturaFamiliaEnCaliente = async function() {
    const inputEl = document.getElementById('bunker_abrev_familia');
    const famSelect = document.getElementById('bunker_familia_id');
    const famId = famSelect ? parseInt(famSelect.value, 10) : null;
    const nuevaAbrev = inputEl ? inputEl.value.trim().toUpperCase() : '';

    if (!famId || isNaN(famId) || nuevaAbrev === (window.lastKnownAbreviaturaFamilia || '')) {
        return;
    }

    try {
        const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}/abreviatura`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ abreviatura: nuevaAbrev })
        });
        const json = await res.json();
        if (res.ok && json.success) {
            window.lastKnownAbreviaturaFamilia = nuevaAbrev;
            actualizarLivePreview();
        } else {
            throw new Error((json && json.error) ? json.error : 'Rechazo del servidor');
        }
    } catch (err) {
        console.error('❌ [FRONTEND BUNKER] Fallo en sincronización de abreviatura en caliente:', err);
        // 🛡️ REVERSIÓN AUTOMÁTICA Y ALERTA VISIBLE DE BLOQUEO
        if (inputEl) inputEl.value = window.lastKnownAbreviaturaFamilia || '';
        actualizarLivePreview();
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Fallo al Guardar Abreviatura',
                text: `No se pudo actualizar la abreviatura de la familia en el maestro: ${err.message}. Se restauró el valor anterior.`,
                confirmButtonColor: '#ef4444'
            });
        }
    }
};

function actualizarLivePreview() {
    let parts = [];
    let primaryTermText = '';

    // Configuración de Inyección Optativa de Familia
    const famSelect = document.getElementById('bunker_familia_id');
    const famNombre = famSelect && famSelect.selectedIndex >= 0 ? famSelect.options[famSelect.selectedIndex].text.replace(/^🌳\s*/, '') : '';
    const posFamSelect = document.getElementById('bunker_posicion_familia');
    const posFam = posFamSelect ? posFamSelect.value : 'ANTES';
    const modoFamSelect = document.getElementById('bunker_modo_familia');
    const modoFam = modoFamSelect ? modoFamSelect.value : 'COMPLETO';
    const abrevFamInput = document.getElementById('bunker_abrev_familia');
    const abrevFamText = abrevFamInput ? abrevFamInput.value.trim().toUpperCase() : '';

    const txtFamiliaInyectar = (modoFam === 'ABREVIADO' && abrevFamText) ? abrevFamText : famNombre;

    // 1. Inyección de Familia ANTES del Nombre Principal (si está activada)
    if (window.incluirFamilia && posFam === 'ANTES' && txtFamiliaInyectar && !txtFamiliaInyectar.includes('General / Sin Clasificar')) {
        parts.push(txtFamiliaInyectar);
    }

    // 2. Nivel 2: Nombre Principal (Respetando Visibilidad 👁️/🙈 y Modo Completo/Abreviado)
    if (dictLocal.principal && (dictLocal.principal.termino || dictLocal.principal.abreviatura)) {
        let baseAb = (dictLocal.principal.modo_display === 'ABREVIADO' && dictLocal.principal.abreviatura) 
            ? dictLocal.principal.abreviatura 
            : (dictLocal.principal.termino || dictLocal.principal.abreviatura);
        baseAb = baseAb.toString().replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]?/g, '').trim();
        if (baseAb) {
            primaryTermText = baseAb.toLowerCase();
            if (!dictLocal.principal.silencioso) {
                parts.push(baseAb);
            }
        }
    }

    // 3. Inyección de Familia DESPUÉS del Nombre Principal (si está activada)
    if (window.incluirFamilia && posFam === 'DESPUES' && txtFamiliaInyectar && !txtFamiliaInyectar.includes('General / Sin Clasificar')) {
        parts.push(txtFamiliaInyectar);
    }
    
    dictLocal.propiedades.forEach(p => {
        if (!p.silencioso) {
            const valDisplay = (p.modo_display === 'ABREVIADO' && p.abreviatura) ? p.abreviatura : (p.termino || p.valor);
            if (valDisplay) parts.push(valDisplay.toString().trim());
        }
    });
    
    // Lógica QA Fase 3: Cantidad y Kilos Sufijos (Formato Presentation)
    let sufijoFisico = "";
    const kilosEl = document.getElementById('kilos_unidad');
    const cantEl  = document.getElementById('cantidad_pack');
    const gramosEl = document.getElementById('expresar_gramos');
    const enGramos = gramosEl ? gramosEl.checked : false;
    const unidadesEl = document.getElementById('expresar_unidades');
    const enUnidades = unidadesEl ? unidadesEl.checked : false;

    if (enUnidades && cantEl) {
        const cantidad = parseInt(cantEl.value) || 1;
        if (cantidad === 1) {
            sufijoFisico = ` x 1 unidad`;
        } else {
            sufijoFisico = ` x ${cantidad} unidades`;
        }
    } else if (kilosEl && cantEl) {
        const kilos = parseInputValue(kilosEl) || 0;
        const cantidad = parseInt(cantEl.value) || 1;
        
        if (kilos > 0) {
            if (cantidad === 1) {
                if (enGramos) {
                    sufijoFisico = ` x ${Math.round(kilos * 1000)}g`;
                } else {
                    sufijoFisico = ` x ${kilos}kg`;
                }
            } else if (cantidad > 1) {
                const pesoUnitario = parseFloat((kilos / cantidad).toFixed(3));
                if (enGramos) {
                    sufijoFisico = ` ${cantidad} x ${Math.round(pesoUnitario * 1000)}g`;
                } else {
                    sufijoFisico = ` ${cantidad} x ${pesoUnitario}kg`;
                }
            }
        }
    }

    // 🏭 Soporte Nomenclador Dinámico para Artículos WIP (Fase 50)
    const wipChk = document.getElementById('presentacion_variable_wip');
    const sufijoWipInput = document.getElementById('sufijo_wip');
    if (wipChk && wipChk.checked) {
        const sufijoVal = sufijoWipInput ? sufijoWipInput.value.trim() : '';
        sufijoFisico = sufijoVal ? ` - ${sufijoVal}` : ` - WIP`;
    }

    const finalDesc = parts.join(' ') + sufijoFisico;
    document.getElementById('live_preview').value = finalDesc;
    return finalDesc;
}

window.togglePresentacionVariableWIP = function(isChecked) {
    const kilosEl = document.getElementById('kilos_unidad');
    const gramosEl = document.getElementById('expresar_gramos');
    const unidadesEl = document.getElementById('expresar_unidades');
    const containerSufijo = document.getElementById('container_sufijo_wip');

    if (isChecked) {
        if (kilosEl) {
            kilosEl.removeAttribute('required');
            kilosEl.value = '0,000';
            kilosEl.disabled = true;
        }
        if (gramosEl) { gramosEl.checked = false; gramosEl.disabled = true; }
        if (unidadesEl) { unidadesEl.checked = false; unidadesEl.disabled = true; }
        if (containerSufijo) containerSufijo.style.display = 'block';
        window.cargarSufijosWIPHistorico();
        window.cargarArticulosPuente();
    } else {
        if (kilosEl) {
            kilosEl.setAttribute('required', 'required');
            kilosEl.disabled = false;
        }
        if (gramosEl) gramosEl.disabled = false;
        if (unidadesEl) unidadesEl.disabled = false;
        if (containerSufijo) containerSufijo.style.display = 'none';
        const puenteEl = document.getElementById('articulo_puente_codigo');
        if (puenteEl) puenteEl.value = '';
    }
    actualizarLivePreview();
};

window.cargarArticulosPuente = async function() {
    const datalist = document.getElementById('list_articulos_puente');
    if (!datalist) return;
    try {
        const res = await fetch('/api/logistica/bunker/listado');
        const json = await res.json();
        const articulos = json.data || json || [];
        if (Array.isArray(articulos)) {
            datalist.innerHTML = '';
            articulos.forEach(art => {
                const id = art.articulo_id || art.id || art.numero;
                const nombre = art.descripcion_generada || art.descripcion || art.nombre || '';
                if (id) {
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = `${id} - ${nombre}`;
                    datalist.appendChild(opt);
                }
            });
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error al cargar lista de artículos puente:', e);
    }
};

window.cargarSufijosWIPHistorico = async function() {
    const datalist = document.getElementById('list_sufijos_wip');
    if (!datalist) return;
    try {
        const res = await fetch('/api/logistica/bunker/sufijos-wip-historico');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            datalist.innerHTML = '';
            json.data.forEach(suf => {
                if (suf) {
                    const opt = document.createElement('option');
                    opt.value = suf;
                    datalist.appendChild(opt);
                }
            });
        }
    } catch(e) {
        console.warn('⚠️ [BUNKER] Error al cargar sufijos WIP históricos:', e);
    }
};

/**
 * Atributos Dinámicos
 */
let attrCounter = 0;
window.agregarAtributoUI = function(defaultCategoria = '') {
    attrCounter++;
    const container = document.getElementById('atributos-container');
    const rowId = `attr_row_${attrCounter}`;
    const inputId = `attr_val_${attrCounter}`;
    
    // Añadir al store virtual
    dictLocal.propiedades.push({ idContainer: inputId, categoria: '', termino: '', abreviatura: '', silencioso: false });

    // Inyectar categorías dinámicas desde el diccionario global y la taxonomía que no sean las base ni internas
    const categoriasBase = ['otro', '', 'general', 'propiedad_dinamica', 'tipo', 'articulo_principal', 'pos_1'];
    let opcionesExtraHtml = '';
    const catsDict = window.diccionarioCategorizado ? window.diccionarioCategorizado.map(d => d.categoria) : [];
    const catsTax = window.todasLasCategoriasMaestras || ['conformacion', 'variedad', 'calibre', 'color', 'procedencia', 'presentacion', 'tratamiento'];
    const categoriasUnicas = [...new Set([...catsTax, ...catsDict])];

    categoriasUnicas.forEach(cat => {
        if (cat && !categoriasBase.includes(cat.toLowerCase())) {
            let catCleaned = cat.replaceAll('_', ' ');
            const catLabel = catCleaned.charAt(0).toUpperCase() + catCleaned.slice(1);
            opcionesExtraHtml += `<option value="${cat}">${catLabel}</option>`;
        }
    });

    const div = document.createElement('div');
    div.className = 'attr-row';
    div.id = rowId;
    div.innerHTML = `
        <div style="display:flex; align-items:center; gap:3px; flex-shrink:0;">
            <select class="select-cat-eje" style="width: 135px; font-weight: 700; color: #1e293b; background: #f8fafc; padding: 8px 6px;" onchange="actualizarCategoriaAtributo('${inputId}', this)" title="Categoría / Eje Comercial Posicional">
                <option value="" selected>Categoría...</option>
                ${opcionesExtraHtml}
                <option value="otro" style="font-weight:bold; color:#2563eb;">➕ Nueva Categoría...</option>
            </select>
            <button type="button" onclick="window.editarNombreCategoriaEnFilaBunker('${inputId}')" style="background:#f59e0b; color:#fff; border:none; border-radius:4px; padding:5px 6px; font-size:0.72em; cursor:pointer;" title="Renombrar esta Categoría / Eje Posicional">✏️</button>
            <button type="button" onclick="window.desvincularCategoriaEnFilaBunker('${inputId}')" style="background:#ef4444; color:#fff; border:none; border-radius:4px; padding:5px 6px; font-size:0.72em; cursor:pointer;" title="Quitar esta Categoría / Eje de la plantilla de la Familia">🗑️</button>
        </div>
        <div id="container_texto_${inputId}" style="position: relative; flex: 1; display: flex; align-items: center; gap: 5px;">
            <select id="${inputId}" disabled onchange="seleccionarOpcionInteligente('${inputId}', this.value)" style="flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 9px 10px; font-size: 0.95em; background: #f8fafc; color: #94a3b8;">
                <option value="" selected>🔒 Seleccione una Categoría primero...</option>
            </select>
        </div>
        <div style="display:inline-flex; background:#e2e8f0; border-radius:6px; padding:2px; font-size:0.75em; font-weight:bold; flex-shrink:0;">
            <button type="button" id="btn_mode_comp_${inputId}" class="btn-mode-display active" onclick="setModoDisplayAtributo('${inputId}', 'COMPLETO')" style="border:none; background:#3b82f6; color:white; border-radius:4px; padding:4px 6px; cursor:pointer;" title="Usar palabra completa">COMPLETO</button>
            <button type="button" id="btn_mode_abrev_${inputId}" class="btn-mode-display" onclick="setModoDisplayAtributo('${inputId}', 'ABREVIADO')" style="border:none; background:transparent; color:#64748b; border-radius:4px; padding:4px 6px; cursor:pointer;" title="Usar abreviatura">ABREV</button>
        </div>
        <button type="button" id="btn_rev_${inputId}" onclick="toggleRevisionInContext('${inputId}')" style="border:1px solid #10b981; background:#d1fae5; color:#065f46; border-radius:4px; padding:4px 8px; font-size:0.8em; font-weight:bold; cursor:pointer; transition: all 0.2s; flex-shrink:0;" title="Estado Normal (Haga clic para marcar En Revisión)">🟢</button>
        <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; flex-shrink:0;">
            <button type="button" title="Mover Categoría Arriba" onclick="moverAtributo('${rowId}', 'arriba')" style="border:none; background:transparent; cursor:pointer; font-size: 0.85em; padding:0; line-height:1; opacity: 0.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⬆️</button>
            <button type="button" title="Mover Categoría Abajo" onclick="moverAtributo('${rowId}', 'abajo')" style="border:none; background:transparent; cursor:pointer; font-size: 0.85em; padding:0; line-height:1; opacity: 0.6; margin-top:2px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⬇️</button>
        </div>
        <button type="button" class="btn-icon" id="toggle_attr_${inputId}" style="color: #3b82f6; font-size: 1.2em; border:none; background:transparent; cursor:pointer; margin-left:2px; flex-shrink:0;" onclick="toggleVisibilidadAtributo('${inputId}')" title="Visible en Nomenclador (👁️ Visible / 🙈 Silencioso)">👁️</button>
        <button type="button" class="btn-icon" style="color:#64748b; font-size:0.95em; border:none; background:transparent; cursor:pointer; flex-shrink:0;" title="Limpiar selección de este eje para el artículo actual" onclick="eliminarAtributoUI('${rowId}', '${inputId}')">✖</button>
    `;
    container.appendChild(div);

    if (defaultCategoria) {
        let catNombreHuman = String(defaultCategoria).trim();
        
        // Bloqueo Absoluto: Jamás renderizar articulo_principal como fila secundaria
        if (catNombreHuman.toLowerCase() === 'articulo_principal' || catNombreHuman.toLowerCase() === 'pos_1') {
            div.remove();
            dictLocal.propiedades = dictLocal.propiedades.filter(p => p.idContainer !== inputId);
            return null;
        }

        let catLabel = catNombreHuman.replaceAll('_', ' ');
        catLabel = catLabel.charAt(0).toUpperCase() + catLabel.slice(1);

        const selectCat = div.querySelector('select.select-cat-eje') || div.querySelector('select');
        const normTarget = catNombreHuman.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let matchedOpt = Array.from(selectCat.options).find(opt => {
            const optNorm = opt.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return optNorm === normTarget;
        });

        if (matchedOpt) {
            selectCat.value = matchedOpt.value;
        } else {
            const newOpt = document.createElement('option');
            newOpt.value = catNombreHuman;
            newOpt.text = catLabel;
            selectCat.add(newOpt, selectCat.options[selectCat.options.length - 1]);
            selectCat.value = catNombreHuman;
        }
        actualizarCategoriaAtributo(inputId, selectCat);
    }
    if (typeof window.actualizarNumeracionPosicionalFilas === 'function') {
        window.actualizarNumeracionPosicionalFilas();
    }
    return inputId;
};

window.setModoDisplayAtributo = function(inputId, modo) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (prop) {
        prop.modo_display = modo;
        const btnComp = document.getElementById(`btn_mode_comp_${inputId}`);
        const btnAbrev = document.getElementById(`btn_mode_abrev_${inputId}`);
        if (btnComp && btnAbrev) {
            if (modo === 'COMPLETO') {
                btnComp.style.background = '#3b82f6';
                btnComp.style.color = 'white';
                btnAbrev.style.background = 'transparent';
                btnAbrev.style.color = '#64748b';
            } else {
                btnAbrev.style.background = '#3b82f6';
                btnAbrev.style.color = 'white';
                btnComp.style.background = 'transparent';
                btnComp.style.color = '#64748b';
            }
        }
        actualizarLivePreview();
    }
};

window.toggleRevisionInContext = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop || !prop.termino) {
        Swal.fire('Atención', 'Seleccione o ingrese un término primero para poder marcarlo en revisión.', 'warning');
        return;
    }

    const propCatNorm = (prop.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const propTermNorm = (prop.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    let dictMatch = window.diccionarioCategorizado ? window.diccionarioCategorizado.find(d => {
        const dCatNorm = (d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const dTermNorm = (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return dTermNorm === propTermNorm && (dCatNorm === propCatNorm || dCatNorm === 'general');
    }) : null;

    if (!dictMatch || !dictMatch.id) {
        try {
            const resLookup = await fetch('/api/logistica/bunker-diccionario');
            const jsonLookup = await resLookup.json();
            if (jsonLookup.success && Array.isArray(jsonLookup.data)) {
                const found = jsonLookup.data.find(d => {
                    const dCatNorm = (d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const dTermNorm = (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return dTermNorm === propTermNorm && (dCatNorm === propCatNorm || dCatNorm === 'general');
                });
                if (found) dictMatch = found;
            }
        } catch(e) {}
    }

    if (!dictMatch || !dictMatch.id) {
        Swal.fire('Atención', `El término "${prop.termino}" aún no está guardado en el diccionario.`, 'info');
        return;
    }

    const estadoNuevo = !dictMatch.en_revision;
    try {
        Swal.fire({title: 'Actualizando marcado...', didOpen: () => Swal.showLoading()});
        const res = await fetch(`/api/logistica/bunker-diccionario/${dictMatch.id}/marcado`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ en_revision: estadoNuevo })
        });
        const json = await res.json();
        if (json.success) {
            dictMatch.en_revision = estadoNuevo;
            prop.en_revision = estadoNuevo;
            
            // Actualizar sincrónicamente la pastilla visual (🟢 Verde vs 🟡 Amarillo)
            const btnRev = document.getElementById(`btn_rev_${inputId}`);
            if (btnRev) {
                btnRev.style.background = estadoNuevo ? '#fef3c7' : '#d1fae5';
                btnRev.style.borderColor = estadoNuevo ? '#f59e0b' : '#10b981';
                btnRev.style.color = estadoNuevo ? '#b45309' : '#065f46';
                btnRev.innerText = estadoNuevo ? '🟡' : '🟢';
                btnRev.title = estadoNuevo ? 'En Revisión (Haga clic para pasar a Normal)' : 'Estado Normal (Haga clic para marcar En Revisión)';
            }
            actualizarLivePreview();
            Swal.fire({title: estadoNuevo ? '🟡 Marcado En Revisión' : '🟢 Estado Normal', icon: 'success', timer: 1000, showConfirmButton: false});
        } else {
            Swal.fire('Error', json.error || 'No se pudo actualizar marcado.', 'error');
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de conectividad al servidor', 'error');
    }
};

window.actualizarNumeracionPosicionalFilas = function() {
    const container = document.getElementById('atributos-container');
    if (!container) return;
    const rows = container.querySelectorAll('.attr-row');
    rows.forEach((row, idx) => {
        const posNum = idx + 3; // Posición 1 = Familia, Posición 2 = Nombre Principal, Posición 3+ = Secundarios
        let badge = row.querySelector('.pos-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'pos-badge';
            badge.style.cssText = 'background:#1e293b; color:#fbbf24; font-size:0.75em; font-weight:bold; padding:6px 10px; border-radius:4px; margin-right:6px; white-space:nowrap; display:inline-flex; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.1);';
            row.insertBefore(badge, row.firstChild);
        }
        badge.innerHTML = `Posición ${posNum}`;
    });
};

window.aplicarOrdenamientoEspejoTaxonomia = async function(familiaId) {
    if (!familiaId) {
        const famEl = document.getElementById('bunker_familia_id');
        familiaId = famEl ? famEl.value : 1;
    }
    const container = document.getElementById('atributos-container');
    if (!container) return;

    let taxOrder = [];
    try {
        const url = `/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias?_t=${Date.now()}`;
        console.log(`🚨 [VIGÍA EDICIÓN - SOLICITANDO TAXONOMÍA]: ${url}`);
        const res = await fetch(url);
        const json = await res.json();
        console.log(`🚨 [VIGÍA EDICIÓN - RESPUESTA BACKEND TAXONOMÍA]:`, json.data);
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            window.taxonomiaCategoriasMap = {};
            json.data.forEach(item => {
                const catNorm = (item.categoria || '').toLowerCase().trim();
                window.taxonomiaCategoriasMap[catNorm] = item.orden_posicional || 1;
            });
            taxOrder = json.data.map(item => item.categoria.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
        }
    } catch(e) {
        console.warn('⚠️ [BUNKER] Error obteniendo taxonomia en aplicarOrdenamientoEspejoTaxonomia:', e);
    }

    console.log(`🚨 [VIGÍA EDICIÓN - SECUENCIA CANÓNICA taxOrder]:`, taxOrder);
    if (taxOrder.length === 0) return;

    dictLocal.propiedades.forEach(p => {
        const rowEl = document.getElementById(p.idContainer.replace('val', 'row'));
        if (rowEl) {
            const selectCat = rowEl.querySelector('select');
            if (selectCat && selectCat.value) {
                p.categoria = selectCat.value;
            }
        }
    });

    // 🛡️ SANITY GUARD CANÓNICO v5.18: Destrucción física en el DOM de filas sobrantes no pertenecientes a la taxonomía activa
    const masterSet = new Set(taxOrder.map(c => c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")));

    dictLocal.propiedades = dictLocal.propiedades.filter(p => {
        const pNorm = (p.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        const isMaster = masterSet.has(pNorm);
        if (!isMaster && p.idContainer) {
            const rowId = p.idContainer.replace('val', 'row');
            const rowEl = document.getElementById(rowId);
            if (rowEl) rowEl.remove(); // ✂️ Destrucción física en el DOM
        }
        return isMaster;
    });

    console.log(`🚨 [VIGÍA EDICIÓN - ANTES DE SORT]:`, dictLocal.propiedades.map(p => p.categoria));

    dictLocal.propiedades.sort((a, b) => {
        const aNorm = (a.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const bNorm = (b.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const idxA = taxOrder.indexOf(aNorm) >= 0 ? taxOrder.indexOf(aNorm) : 99;
        const idxB = taxOrder.indexOf(bNorm) >= 0 ? taxOrder.indexOf(bNorm) : 99;
        return idxA - idxB;
    });

    console.log(`🚨 [VIGÍA EDICIÓN - DESPUÉS DE SORT]:`, dictLocal.propiedades.map(p => p.categoria));

    dictLocal.propiedades.forEach(p => {
        const rowId = p.idContainer.replace('val', 'row');
        const rowEl = document.getElementById(rowId);
        if (rowEl) container.appendChild(rowEl);
    });

    window.actualizarNumeracionPosicionalFilas();
    
    const domOrder = Array.from(container.querySelectorAll('.attr-row')).map(row => {
        const sel = row.querySelector('select');
        return sel ? sel.value : 'N/A';
    });
    console.log(`🚨 [VIGÍA EDICIÓN - ORDEN FINAL EN DOM RESULTANTE]:`, domOrder);
};

window.moverAtributo = async function(rowId, direccion) {
    const row = document.getElementById(rowId);
    if (!row) return;
    
    // Find the inputId associated with this row (e.g. attr_row_1 -> attr_val_1)
    const inputId = rowId.replace('row', 'val');
    const index = dictLocal.propiedades.findIndex(p => p.idContainer === inputId);
    if (index === -1) return;

    if (direccion === 'arriba' && index > 0) {
        // Swap in DOM
        row.parentNode.insertBefore(row, row.previousElementSibling);
        // Swap in dictLocal array
        const temp = dictLocal.propiedades[index];
        dictLocal.propiedades[index] = dictLocal.propiedades[index - 1];
        dictLocal.propiedades[index - 1] = temp;
    } else if (direccion === 'abajo' && index < dictLocal.propiedades.length - 1) {
        // Swap in DOM
        row.parentNode.insertBefore(row.nextElementSibling, row);
        // Swap in dictLocal array
        const temp = dictLocal.propiedades[index];
        dictLocal.propiedades[index] = dictLocal.propiedades[index + 1];
        dictLocal.propiedades[index + 1] = temp;
    }
    
    // Re-secuenciar y guardar el nuevo ordenamiento espejado en PostgreSQL (v5.82)
    const famEl = document.getElementById('bunker_familia_id');
    const famIdVal = famEl ? famEl.value : null;
    if (famIdVal && Array.isArray(dictLocal.propiedades)) {
        const ordenamiento = [];
        dictLocal.propiedades.forEach((p, i) => {
            if (p.categoria) {
                ordenamiento.push({ categoria: p.categoria, orden: i + 1 });
            }
        });
        if (ordenamiento.length > 0) {
            try {
                await fetch(`/api/logistica/bunker-taxonomia/familias/${famIdVal}/reordenar`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ordenamiento })
                });
                // Actualizar mapa local de taxonomía
                if (!window.taxonomiaCategoriasMap) window.taxonomiaCategoriasMap = {};
                ordenamiento.forEach(item => {
                    window.taxonomiaCategoriasMap[item.categoria.toLowerCase()] = item.orden;
                });
            } catch(e) {
                console.warn('⚠️ Error guardando reordenamiento en taxonomia:', e);
            }
        }
    }

    window.actualizarNumeracionPosicionalFilas();
    actualizarLivePreview();
};

window.actualizarCategoriaAtributo = async function(inputId, selectEl) {
    const cat = selectEl.value;
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop) return;

    if (cat === 'otro') {
        selectEl.value = prop.categoria || '';
        await window.crearNuevaCategoriaModalBunker(inputId);
    } else {
        prop.categoria = cat;
        if (window.diccionarioCategorizado) {
            window.cargarOpcionesDeCategoria(inputId, cat);
        }
    }
};

window.obtenerPlantillaParaArticulo = async function(termino, isEditMode = false) {
    try {
        const famSelect = document.getElementById('bunker_familia_id');
        const famId = famSelect ? famSelect.value : null;
        let princId = dictLocal.principal ? dictLocal.principal.id : null;
        const selectPrincEl = document.getElementById('bunker_principal_id');
        if (!princId && selectPrincEl && selectPrincEl.value && selectPrincEl.value !== '__NUEVO_PRINCIPAL__') {
            princId = parseInt(selectPrincEl.value, 10) || null;
            if (princId && dictLocal.principal) dictLocal.principal.id = princId;
        }
        
        let url = `/api/logistica/bunker/plantilla?termino=${encodeURIComponent(termino || '')}`;
        if (famId) url += `&familia_id=${encodeURIComponent(famId)}`;
        if (princId) url += `&articulo_principal_id=${encodeURIComponent(princId)}`;

        const targetFamId = famId || 1;
        const [res, resTax, resJer] = await Promise.all([
            fetch(url),
            fetch(`/api/logistica/bunker-taxonomia/familias/${targetFamId}/categorias`).catch(() => null),
            (famId && princId)
                ? fetch(`/api/logistica/bunker-diccionario/jerarquia/${encodeURIComponent(princId)}?familia_id=${encodeURIComponent(famId)}`).catch(() => null)
                : Promise.resolve(null)
        ]);

        const data = await res.json();
        if (data.success) {
            window.diccionarioCategorizado = data.diccionario_categorizado || [];

            if (resTax) {
                try {
                    const dataTax = await resTax.json();
                    if (dataTax.success && Array.isArray(dataTax.data)) {
                        window.taxonomiaFamiliaActual = dataTax.data;
                        window.todasLasCategoriasMaestras = dataTax.data.map(c => c.categoria);
                    }
                } catch (eTax) {}
            }

            if (resJer) {
                try {
                    const dataJer = await resJer.json();
                    if (dataJer.success && dataJer.data && typeof dataJer.data === 'object') {
                        window.jerarquiaPrincipalActual = dataJer.data;
                        const catByIdMap = {};
                        (window.taxonomiaFamiliaActual || []).forEach(c => {
                            if (c && c.id) catByIdMap[String(c.id)] = c.categoria;
                        });

                        Object.entries(dataJer.data).forEach(([catIdKey, items]) => {
                            const catCanon = catByIdMap[String(catIdKey)] || (items[0] && items[0].categoria_nombre) || '';
                            if (!catCanon || !Array.isArray(items)) return;
                            const catCanonNorm = catCanon.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                            items.forEach(item => {
                                const existing = window.diccionarioCategorizado.find(d =>
                                    (d.id && item.id && Number(d.id) === Number(item.id) &&
                                     (d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === catCanonNorm) ||
                                    ((d.termino || '').toLowerCase().trim() === (item.termino || '').toLowerCase().trim() &&
                                     (d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === catCanonNorm)
                                );
                                if (existing) {
                                    existing.id = item.id || existing.id;
                                    existing.relacional = true;
                                    existing.prioritario = true;
                                    existing.categoria = catCanon;
                                    existing.abreviatura = item.abreviatura || existing.abreviatura;
                                    existing.en_revision = item.en_revision === true;
                                } else {
                                    window.diccionarioCategorizado.push({
                                        id: item.id,
                                        termino: item.termino,
                                        abreviatura: item.abreviatura || item.termino,
                                        categoria: catCanon,
                                        en_revision: item.en_revision === true,
                                        relacional: true,
                                        prioritario: true
                                    });
                                }
                            });
                        });
                    }
                } catch (eJer) {}
            } else {
                window.jerarquiaPrincipalActual = {};
            }

            // Re-renderizar todos los selectores posicionales activos preservando su selección actual
            if (Array.isArray(dictLocal.propiedades) && dictLocal.propiedades.length > 0) {
                dictLocal.propiedades.forEach(prop => {
                    if (prop.idContainer && prop.categoria) {
                        window.cargarOpcionesDeCategoria(prop.idContainer, prop.categoria, true);
                    }
                });
            }

            if (!isEditMode && data.categorias_sugeridas && data.categorias_sugeridas.length > 0 && dictLocal.propiedades.length === 0) {
                data.categorias_sugeridas.forEach(cat => {
                    if (cat) agregarAtributoUI(cat);
                });
            }
        }
    } catch (err) {
        console.error("Error obteniendo plantilla:", err);
    }
};

window.cargarOpcionesDeCategoria = function(inputId, categoria, preventReset = false) {
    const contenedorTexto = document.getElementById(`container_texto_${inputId}`);
    if (!contenedorTexto || !window.diccionarioCategorizado) return;
    
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    const prevTermino = (preventReset && prop && prop.termino) ? String(prop.termino).trim() : '';
    const prevAbrev = (preventReset && prop && prop.abreviatura) ? String(prop.abreviatura).trim() : '';

    if (prop && !preventReset) { 
        prop.termino = ''; 
        prop.abreviatura = ''; 
        actualizarLivePreview(); 
    }

    const catCleaned = (categoria || '').replaceAll('_', ' ');
    const catLabel = catCleaned ? (catCleaned.charAt(0).toUpperCase() + catCleaned.slice(1)) : 'Categoría';
    const catTargetNorm = (categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const opcionesAll = window.diccionarioCategorizado.filter(d => {
        const dCatNorm = (d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return dCatNorm === catTargetNorm;
    });

    // Deduplicar por término (priorizando el relacional)
    const mapTerms = new Map();
    opcionesAll.forEach(o => {
        const key = (o.termino || '').trim().toLowerCase();
        if (!key) return;
        const prev = mapTerms.get(key);
        if (!prev || (!prev.relacional && !prev.prioritario && (o.relacional || o.prioritario))) {
            mapTerms.set(key, o);
        }
    });
    const uniqueOpciones = Array.from(mapTerms.values());

    const opcionesRelacionales = uniqueOpciones
        .filter(o => o.prioritario || o.relacional)
        .sort((a, b) => (a.termino || '').localeCompare(b.termino || ''));
    const opcionesOtras = uniqueOpciones
        .filter(o => !o.prioritario && !o.relacional)
        .sort((a, b) => (a.termino || '').localeCompare(b.termino || ''));

    const princNombre = (dictLocal.principal && dictLocal.principal.termino) ? dictLocal.principal.termino : 'Familia';

    let placeholderText = `— Sin especificar (${catLabel} vacío) —`;
    if (opcionesRelacionales.length === 0 && opcionesOtras.length === 0) {
        placeholderText = `— Sin especificar (0 términos en ${catLabel}) —`;
    } else if (opcionesRelacionales.length === 0 && opcionesOtras.length > 0) {
        placeholderText = `— Sin especificar (0 vinculados a ${princNombre} en ${catLabel}) —`;
    }

    let html = `<select id="${inputId}" onchange="seleccionarOpcionInteligente('${inputId}', this.value)" style="flex: 1; min-width: 180px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 9px 10px; font-size: 0.95em; background: #fffbeeb3; color: #1e293b; font-weight: 600;">`;
    html += `<option value="" selected>${placeholderText}</option>`;

    if (opcionesRelacionales.length > 0) {
        html += `<optgroup label="⭐ Vinculados a ${princNombre} (${opcionesRelacionales.length})">`;
        opcionesRelacionales.forEach(opt => {
            const revTag = opt.en_revision ? ' 🟡 [En Revisión]' : '';
            const valJsonEscapado = window.escapeHtmlAttr({ id: opt.id || null, t: opt.termino, a: opt.abreviatura });
            html += `<option value="${valJsonEscapado}">⭐ ${opt.termino} [${opt.abreviatura}]${revTag}</option>`;
        });
        html += `</optgroup>`;
    }

    if (opcionesOtras.length > 0) {
        html += `<optgroup label="── Otros términos de ${catLabel} en Diccionario (${opcionesOtras.length}) ──">`;
        opcionesOtras.forEach(opt => {
            const revTag = opt.en_revision ? ' 🟡 [En Revisión]' : '';
            const valJsonEscapado = window.escapeHtmlAttr({ id: opt.id || null, t: opt.termino, a: opt.abreviatura });
            html += `<option value="${valJsonEscapado}">${opt.termino} [${opt.abreviatura}]${revTag}</option>`;
        });
        html += `</optgroup>`;
    }

    html += `</select>`;

    // Botonera de Diccionario en vivo para esta Categoría Posicional (Espejo exacto de diccionario-bunker.html)
    html += `
        <button type="button" onclick="window.agregarAtributoACategoriaModalBunker('${inputId}')" style="background:#10b981; color:#fff; border:none; border-radius:4px; padding:7px 10px; font-size:0.78em; font-weight:bold; cursor:pointer; white-space:nowrap; flex-shrink:0; box-shadow:0 1px 2px rgba(0,0,0,0.08);" title="Vincular o dar de alta un nuevo atributo en ${catLabel} (ej: Cranberry)">➕ Atributo</button>
        <button type="button" onclick="window.editarTerminoEnFilaBunker('${inputId}')" style="background:#eab308; color:#fff; border:none; border-radius:4px; padding:7px 8px; font-size:0.78em; font-weight:bold; cursor:pointer; flex-shrink:0;" title="Editar nombre o abreviatura del término seleccionado en ${catLabel}">✏️</button>
        <button type="button" onclick="window.desvincularTerminoEnFilaBunker('${inputId}')" style="background:#dc2626; color:#fff; border:none; border-radius:4px; padding:7px 8px; font-size:0.78em; font-weight:bold; cursor:pointer; flex-shrink:0;" title="Desvincular el término seleccionado de ${princNombre} (${catLabel})">🔗❌</button>
    `;

    contenedorTexto.innerHTML = html;

    // Si preventReset === true y había un término seleccionado en esta fila, restaurarlo visualmente
    if (preventReset && prevTermino) {
        const selectEl = document.getElementById(inputId);
        if (selectEl) {
            const prevNorm = prevTermino.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            let matchedOpt = Array.from(selectEl.options).find(opt => {
                if (!opt.value) return false;
                try {
                    const parsed = JSON.parse(opt.value);
                    const tNorm = String(parsed.t || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return tNorm === prevNorm;
                } catch (e) {
                    return opt.value.toLowerCase() === prevNorm;
                }
            });
            if (matchedOpt) {
                selectEl.value = matchedOpt.value;
            } else {
                const newOpt = document.createElement('option');
                newOpt.value = JSON.stringify({ t: prevTermino, a: prevAbrev || prevTermino });
                newOpt.text = `${prevTermino} [${prevAbrev || prevTermino}]`;
                selectEl.appendChild(newOpt);
                selectEl.value = newOpt.value;
            }
        }
    }
};

window.seleccionarOpcionInteligente = async function(inputId, valStr) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop) return;

    if (valStr === "NUEVO") {
        const sel = document.getElementById(inputId);
        if (sel) sel.value = "";
        await window.agregarAtributoACategoriaModalBunker(inputId);
        return;
    }

    if (!valStr || valStr === '') {
        limpiarTerminoDict(inputId);
        return;
    }

    try {
        let obj = null;
        if (typeof valStr === 'string' && valStr.trim().startsWith('{')) {
            obj = JSON.parse(valStr);
        } else {
            obj = { t: valStr, a: '' };
        }

        const terminoLimpio = String(obj.t || '').replace(/\s*\[.*?\]/g, '').trim();
        const abrevLimpia = String(obj.a || '').trim();

        asignarTerminoDict(inputId, terminoLimpio, abrevLimpia);

        // Actualizar el estado del botón de revisión sincrónicamente según el término seleccionado
        const dictMatch = window.diccionarioCategorizado ? window.diccionarioCategorizado.find(d => {
            const dTermNorm = (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const objTermNorm = (terminoLimpio || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return dTermNorm === objTermNorm;
        }) : null;
        const isRev = dictMatch ? (dictMatch.en_revision === true) : false;
        prop.en_revision = isRev;

        const btnRev = document.getElementById(`btn_rev_${inputId}`);
        if (btnRev) {
            btnRev.style.background = isRev ? '#fef3c7' : '#d1fae5';
            btnRev.style.borderColor = isRev ? '#f59e0b' : '#10b981';
            btnRev.style.color = isRev ? '#b45309' : '#065f46';
            btnRev.innerText = isRev ? '🟡' : '🟢';
            btnRev.title = isRev ? 'En Revisión (Haga clic para pasar a Normal)' : 'Estado Normal (Haga clic para marcar En Revisión)';
        }
    } catch (e) {
        console.error('❌ [BUNKER] Error parseando payload de atributo en seleccionarOpcionInteligente:', e, valStr);
        const terminoLimpio = String(valStr || '').replace(/\s*\[.*?\]/g, '').trim();
        asignarTerminoDict(inputId, terminoLimpio, '');
    }
};

// =========================================================================
// HERRAMIENTAS DE DICCIONARIO Y TAXONOMÍA EN VIVO (ESPEJO DE DICCIONARIO)
// =========================================================================

window.agregarAtributoACategoriaModalBunker = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop || !prop.categoria) {
        Swal.fire('Atención', 'Seleccione primero una Categoría / Eje en la fila.', 'warning');
        return;
    }

    const famSelect = document.getElementById('bunker_familia_id');
    const familiaId = famSelect ? parseInt(famSelect.value, 10) || null : null;
    const familiaActivaNombre = (famSelect && famSelect.selectedIndex >= 0)
        ? famSelect.options[famSelect.selectedIndex].text.replace(/^🌳\s*/, '')
        : 'Familia Activa';

    const selectPrinc = document.getElementById('bunker_principal_id');
    let articuloPrincipalId = (dictLocal.principal && dictLocal.principal.id) ? parseInt(dictLocal.principal.id, 10) : null;
    if (!articuloPrincipalId && selectPrinc && selectPrinc.value && selectPrinc.value !== '__NUEVO_PRINCIPAL__') {
        articuloPrincipalId = parseInt(selectPrinc.value, 10) || null;
    }

    const selectedOptPrinc = (selectPrinc && selectPrinc.selectedIndex >= 0) ? selectPrinc.options[selectPrinc.selectedIndex] : null;
    const articuloPrincipalTexto = (dictLocal.principal && dictLocal.principal.termino)
        ? dictLocal.principal.termino
        : (selectedOptPrinc ? (selectedOptPrinc.getAttribute('data-termino') || selectedOptPrinc.text.replace(/^⭐\s*/, '')) : '');

    if (!familiaId || !articuloPrincipalId) {
        Swal.fire(
            'Seleccione el Nombre Principal (Nivel 2)',
            'Antes de vincular o dar de alta un atributo en esta categoría (ej: Cranberry en Variedad), seleccione el Nombre Principal en el Nivel 2 (ej: Porotos).',
            'warning'
        );
        return;
    }

    const categoria = prop.categoria;
    const catCleaned = categoria.replaceAll('_', ' ');
    const labelCategoria = catCleaned.charAt(0).toUpperCase() + catCleaned.slice(1);
    const catNorm = categoria.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    let categoriaId = null;
    if (Array.isArray(window.taxonomiaFamiliaActual)) {
        const foundCat = window.taxonomiaFamiliaActual.find(c =>
            (c.categoria || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === catNorm
        );
        if (foundCat && foundCat.id) categoriaId = foundCat.id;
    }

    try {
        Swal.fire({ title: 'Obteniendo catálogo de términos...', didOpen: () => Swal.showLoading() });
        const resDict = await fetch('/api/logistica/bunker-diccionario?solo_atributos=true');
        const jsonDict = await resDict.json();

        const todosLosTerminosRaw = jsonDict.success && Array.isArray(jsonDict.data) ? jsonDict.data : [];
        const todosLosTerminos = todosLosTerminosRaw.filter(t =>
            t.obsoleto !== true &&
            t.categoria &&
            !['general', 'articulo_principal', 'pos_1'].includes((t.categoria || '').trim().toLowerCase())
        );

        const renderOptions = (termFilter = '') => {
            const queryNorm = termFilter.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 0);

            const filtered = todosLosTerminos.filter(t => {
                if (queryWords.length === 0) return true;
                const searchableText = `${t.termino || ''} ${t.abreviatura || ''} ${t.categoria || ''}`
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "");
                return queryWords.every(word => searchableText.includes(word));
            });

            if (filtered.length === 0) {
                const termClean = termFilter.trim();
                if (termClean.length > 0) {
                    return `<option value="__CREAR_NUEVO__" data-newterm="${window.escapeHtmlAttr(termClean)}" style="color:#2563eb; font-weight:bold;">✨ [+] Usar "${termClean}" para crear este nuevo atributo</option>`;
                }
                return `<option value="" disabled style="color:#94a3b8;">⚠️ No se hallaron términos que coincidan</option>`;
            }

            const catClean = (categoria || '').trim().toLowerCase();
            const nivel1_familiaActiva = [];
            const nivel2_otrasFamilias = [];
            const nivel3_restoGlobal = [];

            filtered.forEach(t => {
                const tCatClean = (t.categoria || '').trim().toLowerCase();
                const esDeEstaCategoriaNativa = (tCatClean === catClean);
                const vinculaciones = Array.isArray(t.vinculaciones_relacionales) ? t.vinculaciones_relacionales : [];

                const registradoEnFamiliaYCategoria = vinculaciones.some(v =>
                    Number(v.familia_id) === Number(familiaId) &&
                    (v.categoria || '').trim().toLowerCase() === catClean
                );
                const registradoEnOtrasFamiliasMismaCategoria = vinculaciones.some(v =>
                    (v.categoria || '').trim().toLowerCase() === catClean
                );

                if (registradoEnFamiliaYCategoria) {
                    nivel1_familiaActiva.push(t);
                } else if (esDeEstaCategoriaNativa || registradoEnOtrasFamiliasMismaCategoria) {
                    nivel2_otrasFamilias.push(t);
                } else if (tCatClean && tCatClean !== 'general') {
                    nivel3_restoGlobal.push(t);
                }
            });

            let htmlOptions = '';
            if (nivel1_familiaActiva.length > 0) {
                htmlOptions += `<optgroup label="🔥 Frecuentes en ${familiaActivaNombre}">`;
                htmlOptions += nivel1_familiaActiva.map(t =>
                    `<option value="${window.escapeHtmlAttr(t.termino)}" data-id="${t.id}" data-abrev="${window.escapeHtmlAttr(t.abreviatura || '')}" style="font-weight:bold; background-color:#fef9c3; color:#854d0e;">🔥 ${t.termino} [${t.abreviatura || 'S/A'}] (🔥 Usado en ${familiaActivaNombre})</option>`
                ).join('');
                htmlOptions += `</optgroup>`;
            }
            if (nivel2_otrasFamilias.length > 0) {
                htmlOptions += `<optgroup label="⭐ Términos de ${labelCategoria} (Otras Familias)">`;
                htmlOptions += nivel2_otrasFamilias.map(t =>
                    `<option value="${window.escapeHtmlAttr(t.termino)}" data-id="${t.id}" data-abrev="${window.escapeHtmlAttr(t.abreviatura || '')}" style="font-weight:bold; background-color:#f0fdf4; color:#166534;">⭐ ${t.termino} [${t.abreviatura || 'S/A'}] (⭐ Usado en Otras Familias)</option>`
                ).join('');
                htmlOptions += `</optgroup>`;
            }
            if (nivel3_restoGlobal.length > 0) {
                htmlOptions += `<optgroup label="🌐 Atributos de Otras Categorías Posicionales">`;
                htmlOptions += nivel3_restoGlobal.map(t => {
                    const catInfo = t.categoria ? ` (${t.categoria})` : '';
                    return `<option value="${window.escapeHtmlAttr(t.termino)}" data-id="${t.id}" data-abrev="${window.escapeHtmlAttr(t.abreviatura || '')}" style="color:#475569;">${t.termino} [${t.abreviatura || 'S/A'}]${catInfo}</option>`;
                }).join('');
                htmlOptions += `</optgroup>`;
            }
            return htmlOptions;
        };

        window.modalSelectedTermIdBunker = null;

        const { value: formValues } = await Swal.fire({
            title: `➕ Vincular o Crear Atributo (${labelCategoria})`,
            html: `
                <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
                    <div style="font-size:0.85em; background:#f0fdf4; padding:8px 12px; border-radius:6px; border:1px solid #bbf7d0; color:#166534;">
                        📍 Vinculando a: <strong>${familiaActivaNombre}</strong> &rarr; <strong>${articuloPrincipalTexto}</strong> &rarr; Eje: <strong>${labelCategoria}</strong>
                    </div>
                    <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:12px; border-radius:8px;">
                        <label style="font-weight:bold; font-size:0.88em; color:#1e3a8a; display:block; margin-bottom:6px;">
                            🔍 1. Buscar en Catálogo Global (Fase 49)
                        </label>
                        <input id="swal-bunker-search-input" class="swal2-input" placeholder="Escriba para filtrar o buscar (ej. Cranberry, Mariposa, Pelada...)" style="margin:0 0 8px 0; width:100%; box-sizing:border-box; font-size:0.95em;">
                        <select id="swal-bunker-select-existente" class="swal2-select" style="width:100%; margin:0; padding:8px; box-sizing:border-box;">
                            <option value="" selected>-- Seleccione un término del catálogo --</option>
                            ${renderOptions('')}
                        </select>
                    </div>

                    <div style="text-align:center; font-size:0.8em; font-weight:bold; color:#2563eb;">— O ESCRIBA ABAJO PARA DAR DE ALTA UN NUEVO TÉRMINO —</div>

                    <div style="display:flex; flex-direction:column; gap:8px; background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #cbd5e1;">
                        <label style="font-weight:bold; font-size:0.88em; color:#1e293b;">2. Término (Nombre del Atributo) *</label>
                        <input id="swal-bunker-attr-term" class="swal2-input" placeholder="Ej: Cranberry, Pelada, Mariposa..." style="margin:0; width:100%; box-sizing:border-box;">
                        <label style="font-weight:bold; font-size:0.88em; color:#475569;">3. Abreviatura de Impresión *</label>
                        <input id="swal-bunker-attr-abrev" class="swal2-input" placeholder="Ej: CRB, PEL (Si lo deja vacío se auto-genera)" style="margin:0; width:100%; box-sizing:border-box; text-transform:uppercase;">
                    </div>
                </div>
            `,
            width: '580px',
            showCancelButton: true,
            confirmButtonText: '💾 Vincular y Seleccionar Atributo',
            cancelButtonText: 'Cancelar',
            didOpen: () => {
                const searchInput = document.getElementById('swal-bunker-search-input');
                const selectEl = document.getElementById('swal-bunker-select-existente');
                const termInput = document.getElementById('swal-bunker-attr-term');
                const abrevInput = document.getElementById('swal-bunker-attr-abrev');
                const confirmBtn = Swal.getConfirmButton();

                const actualizarEstadoBotonVisual = () => {
                    if (!confirmBtn) return;
                    const termVal = termInput ? termInput.value.trim() : '';
                    const selectedOpt = selectEl ? selectEl.options[selectEl.selectedIndex] : null;
                    const isNewOpt = selectedOpt && selectedOpt.value === '__CREAR_NUEVO__';

                    const existeEnCatalogoGlobalActive = todosLosTerminos.some(
                        t => (t.termino || '').toLowerCase().trim() === termVal.toLowerCase()
                    );

                    if (isNewOpt || (!existeEnCatalogoGlobalActive && termVal.length > 0)) {
                        confirmBtn.innerHTML = '✨ Crear, Vincular y Seleccionar Término';
                        confirmBtn.style.backgroundColor = '#2563eb';
                    } else if (termVal.length > 0) {
                        confirmBtn.innerHTML = '🔗 Vincular y Seleccionar Término';
                        confirmBtn.style.backgroundColor = '#16a34a';
                    } else {
                        confirmBtn.innerHTML = '💾 Vincular y Seleccionar Atributo';
                        confirmBtn.style.backgroundColor = '#2563eb';
                    }
                };

                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        const filterVal = e.target.value;
                        selectEl.innerHTML = `<option value="" selected>-- Seleccione un término del catálogo --</option>` + renderOptions(filterVal);
                        // Si la búsqueda muestra __CREAR_NUEVO__ (no existe en el catálogo), pre-llenar el campo 2 automáticamente para ahorrar pasos
                        const optCrear = selectEl.querySelector('option[value="__CREAR_NUEVO__"]');
                        if (optCrear && termInput) {
                            const formatted = filterVal.trim().charAt(0).toUpperCase() + filterVal.trim().slice(1);
                            termInput.value = formatted;
                            window.modalSelectedTermIdBunker = null;
                        }
                        actualizarEstadoBotonVisual();
                    });
                }

                if (selectEl) {
                    selectEl.addEventListener('change', () => {
                        const selectedOpt = selectEl.options[selectEl.selectedIndex];
                        if (selectedOpt && selectedOpt.value === '__CREAR_NUEVO__') {
                            const newTerm = selectedOpt.getAttribute('data-newterm') || '';
                            if (termInput) termInput.value = newTerm.charAt(0).toUpperCase() + newTerm.slice(1);
                            if (abrevInput) abrevInput.focus();
                            window.modalSelectedTermIdBunker = null;
                        } else if (selectedOpt && selectedOpt.value) {
                            if (termInput) termInput.value = selectedOpt.value;
                            if (abrevInput) abrevInput.value = selectedOpt.getAttribute('data-abrev') || '';
                            window.modalSelectedTermIdBunker = parseInt(selectedOpt.getAttribute('data-id'), 10) || null;
                        } else {
                            window.modalSelectedTermIdBunker = null;
                        }
                        actualizarEstadoBotonVisual();
                    });
                }

                if (termInput) {
                    termInput.addEventListener('input', () => {
                        window.modalSelectedTermIdBunker = null;
                        actualizarEstadoBotonVisual();
                    });
                }

                actualizarEstadoBotonVisual();
            },
            preConfirm: () => {
                const termInputVal = (document.getElementById('swal-bunker-attr-term') ? document.getElementById('swal-bunker-attr-term').value : '').trim();
                const abrevInputVal = (document.getElementById('swal-bunker-attr-abrev') ? document.getElementById('swal-bunker-attr-abrev').value : '').trim().toUpperCase();
                if (!termInputVal) {
                    Swal.showValidationMessage('Debe seleccionar un término del catálogo o escribir el nombre del nuevo término.');
                    return false;
                }
                const finalAbrev = abrevInputVal || termInputVal.substring(0, 3).toUpperCase();
                return {
                    termino: termInputVal,
                    abreviatura: finalAbrev,
                    termino_id: window.modalSelectedTermIdBunker || null
                };
            }
        });

        if (formValues) {
            Swal.fire({ title: 'Vinculando atributo...', didOpen: () => Swal.showLoading() });

            const payloadData = {
                familia_id: parseInt(familiaId, 10),
                articulo_principal_id: parseInt(articuloPrincipalId, 10),
                articulo_principal_texto: articuloPrincipalTexto,
                termino_id: formValues.termino_id || null,
                categoria_id: parseInt(categoriaId, 10) || null,
                categoria: categoria,
                termino: formValues.termino,
                abreviatura: formValues.abreviatura
            };

            const resPost = await fetch('/api/logistica/bunker-diccionario/crear-termino-en-categoria', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadData)
            });

            const jsonPost = await resPost.json();
            if (jsonPost.success) {
                // Refrescar plantilla y jerarquía desde el servidor preservando las demás filas
                await window.obtenerPlantillaParaArticulo(articuloPrincipalTexto, true);

                // Auto-seleccionar el término recién creado/vinculado en esta fila
                const selectRecreado = document.getElementById(inputId);
                if (selectRecreado) {
                    const targetNorm = formValues.termino.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const matchedOpt = Array.from(selectRecreado.options).find(opt => {
                        if (!opt.value) return false;
                        try {
                            const parsed = JSON.parse(opt.value);
                            return String(parsed.t || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === targetNorm;
                        } catch (e) {
                            return false;
                        }
                    });
                    if (matchedOpt) {
                        selectRecreado.value = matchedOpt.value;
                        await window.seleccionarOpcionInteligente(inputId, matchedOpt.value);
                    }
                }

                Swal.fire({
                    title: 'Atributo Vinculado y Seleccionado',
                    text: `"${formValues.termino}" [${formValues.abreviatura}] ya está vinculado a ${articuloPrincipalTexto} (${labelCategoria}) y seleccionado en el artículo.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });
            } else {
                Swal.fire('Error', jsonPost.error || 'No se pudo vincular el atributo.', 'error');
            }
        }
    } catch (e) {
        console.error('Error en agregarAtributoACategoriaModalBunker:', e);
        Swal.fire('Error', 'Fallo de red al procesar el catálogo de atributos.', 'error');
    }
};

window.editarTerminoEnFilaBunker = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    const selectEl = document.getElementById(inputId);
    if (!prop || !prop.termino || !selectEl || !selectEl.value) {
        Swal.fire('Atención', 'Seleccione primero un término en el desplegable de esta categoría para editarlo.', 'warning');
        return;
    }

    let termId = null;
    try {
        const parsed = JSON.parse(selectEl.value);
        if (parsed.id) termId = parseInt(parsed.id, 10);
    } catch (e) {}

    if (!termId && window.diccionarioCategorizado) {
        const catNorm = (prop.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const termNorm = (prop.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const found = window.diccionarioCategorizado.find(d =>
            (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === termNorm &&
            ((d.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === catNorm || d.relacional)
        ) || window.diccionarioCategorizado.find(d =>
            (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === termNorm
        );
        if (found && found.id) termId = parseInt(found.id, 10);
    }

    if (!termId) {
        Swal.fire('Error', 'No se pudo localizar el ID del término en el diccionario maestro.', 'error');
        return;
    }

    const { value: formValues } = await Swal.fire({
        title: `✏️ Editar Término (${prop.categoria})`,
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Nombre del Término *</label>
                <input id="swal-edit-term-bunker" class="swal2-input" style="margin:0;" value="${window.escapeHtmlAttr(prop.termino)}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión *</label>
                <input id="swal-edit-abrev-bunker" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${window.escapeHtmlAttr(prop.abreviatura || '')}">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '💾 Guardar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const termino = document.getElementById('swal-edit-term-bunker').value.trim();
            const abreviatura = document.getElementById('swal-edit-abrev-bunker').value.trim().toUpperCase();
            if (!termino || !abreviatura) {
                Swal.showValidationMessage('El término y la abreviatura son obligatorios.');
                return false;
            }
            return { termino, abreviatura, categoria: prop.categoria };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-diccionario/${termId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success) {
                prop.termino = formValues.termino;
                prop.abreviatura = formValues.abreviatura;
                const princTerm = (dictLocal.principal && dictLocal.principal.termino) ? dictLocal.principal.termino : '';
                await window.obtenerPlantillaParaArticulo(princTerm, true);
                actualizarLivePreview();
                Swal.fire({ title: 'Término Actualizado', icon: 'success', timer: 1200, showConfirmButton: false });
            } else {
                Swal.fire('Error', json.error || 'No se pudo actualizar el término.', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de red al actualizar el término.', 'error');
        }
    }
};

window.desvincularTerminoEnFilaBunker = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    const selectEl = document.getElementById(inputId);
    if (!prop || !prop.termino || !selectEl || !selectEl.value) {
        Swal.fire('Atención', 'Seleccione primero un término en el desplegable de esta categoría para desvincularlo.', 'warning');
        return;
    }

    const famSelect = document.getElementById('bunker_familia_id');
    const familiaId = famSelect ? parseInt(famSelect.value, 10) || null : null;
    const selectPrinc = document.getElementById('bunker_principal_id');
    const articuloPrincipalId = (dictLocal.principal && dictLocal.principal.id)
        ? parseInt(dictLocal.principal.id, 10)
        : (selectPrinc ? parseInt(selectPrinc.value, 10) || null : null);

    if (!familiaId || !articuloPrincipalId) {
        Swal.fire('Atención', 'Debe tener una Familia y un Nombre Principal seleccionados.', 'warning');
        return;
    }

    let termId = null;
    try {
        const parsed = JSON.parse(selectEl.value);
        if (parsed.id) termId = parseInt(parsed.id, 10);
    } catch (e) {}

    if (!termId && window.diccionarioCategorizado) {
        const termNorm = (prop.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const found = window.diccionarioCategorizado.find(d =>
            (d.termino || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === termNorm
        );
        if (found && found.id) termId = parseInt(found.id, 10);
    }

    if (!termId) {
        Swal.fire('Error', 'No se encontró el ID del término para desvincular.', 'error');
        return;
    }

    const confirmRes = await Swal.fire({
        title: '¿Desvincular Término de esta Jerarquía?',
        html: `Se desvinculará <strong>"${prop.termino}"</strong> de la categoría <strong>"${prop.categoria}"</strong> para el principal actual.<br><small style="color:#64748b;">El término permanecerá intacto en el diccionario global.</small>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: '🔗❌ Sí, Desvincular',
        cancelButtonText: 'Cancelar'
    });

    if (confirmRes.isConfirmed) {
        try {
            Swal.fire({ title: 'Desvinculando...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-diccionario/jerarquia/desvincular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    familia_id: familiaId,
                    articulo_principal_id: articuloPrincipalId,
                    termino_id: termId,
                    categoria: prop.categoria
                })
            });
            const json = await res.json();
            if (json.success) {
                limpiarTerminoDict(inputId);
                const princTerm = (dictLocal.principal && dictLocal.principal.termino) ? dictLocal.principal.termino : '';
                await window.obtenerPlantillaParaArticulo(princTerm, true);
                Swal.fire({ title: 'Desvinculado', text: json.message, icon: 'success', timer: 1200, showConfirmButton: false });
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular el término.', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de red al desvincular término.', 'error');
        }
    }
};

window.crearNuevaCategoriaModalBunker = async function(targetInputId = null) {
    const famSelect = document.getElementById('bunker_familia_id');
    const familiaId = famSelect ? (Number(famSelect.value) || 1) : 1;
    const familiaNombre = (famSelect && famSelect.selectedIndex >= 0)
        ? famSelect.options[famSelect.selectedIndex].text.replace(/^🌳\s*/, '')
        : 'Familia Seleccionada';

    Swal.fire({ title: 'Cargando catálogo global de categorías...', didOpen: () => Swal.showLoading() });

    let catsGlobalesEnriquecidas = [];
    try {
        const [resDict, resTaxFam] = await Promise.all([
            fetch('/api/logistica/bunker-taxonomia/categorias-globales'),
            fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`)
        ]);
        const jsonDict = await resDict.json();
        if (jsonDict.success && Array.isArray(jsonDict.data)) {
            catsGlobalesEnriquecidas = jsonDict.data;
        }
        const jsonTaxFam = await resTaxFam.json();
        if (jsonTaxFam.success && Array.isArray(jsonTaxFam.data)) {
            window.taxonomiaFamiliaActual = jsonTaxFam.data;
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error obteniendo lista global de categorías:', e);
    }

    const setCatsFamilia = new Set(
        (Array.isArray(window.taxonomiaFamiliaActual) ? window.taxonomiaFamiliaActual : [])
            .map(item => (item.categoria || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );

    const estadoA_bloqueadas = [];
    const estadoB_enUsoFamilia = [];
    const estadoC_restoGlobal = [];

    catsGlobalesEnriquecidas.forEach(catObj => {
        const cat = (catObj.categoria || '').trim().toLowerCase();
        const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const label = cat.replaceAll('_', ' ').charAt(0).toUpperCase() + cat.replaceAll('_', ' ').slice(1);
        const yaIncluida = setCatsFamilia.has(catNorm);

        const familiasNums = Array.isArray(catObj.familias_ids)
            ? catObj.familias_ids.map(id => Number(id)).filter(id => !isNaN(id))
            : [];
        const usadaEnFamiliaActiva = familiasNums.includes(familiaId);

        if (yaIncluida) {
            estadoA_bloqueadas.push({ cat, label });
        } else if (usadaEnFamiliaActiva) {
            estadoB_enUsoFamilia.push({ cat, label });
        } else {
            estadoC_restoGlobal.push({ cat, label });
        }
    });

    let opcionesSelectHtml = `<option value="">-- Seleccione una Categoría Preexistente --</option>`;

    if (estadoB_enUsoFamilia.length > 0) {
        opcionesSelectHtml += `<optgroup label="🔥 Categorías en Uso en ${familiaNombre}">`;
        opcionesSelectHtml += estadoB_enUsoFamilia.map(c =>
            `<option value="${window.escapeHtmlAttr(c.cat)}" style="font-weight:bold; background-color:#fef9c3; color:#854d0e;">🔥 ${c.label} (🔥 Usada en ${familiaNombre})</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    if (estadoC_restoGlobal.length > 0) {
        opcionesSelectHtml += `<optgroup label="🌐 Resto del Catálogo Global">`;
        opcionesSelectHtml += estadoC_restoGlobal.map(c =>
            `<option value="${window.escapeHtmlAttr(c.cat)}" style="font-weight:bold; color:#1e293b;">${c.label} (Preexistente - Disponible)</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    if (estadoA_bloqueadas.length > 0) {
        opcionesSelectHtml += `<optgroup label="✔ Ya Incluidas en ${familiaNombre}">`;
        opcionesSelectHtml += estadoA_bloqueadas.map(c =>
            `<option value="${window.escapeHtmlAttr(c.cat)}" disabled style="color:#94a3b8; font-style:italic;">${c.label} (✔ Ya incluida en ${familiaNombre})</option>`
        ).join('');
        opcionesSelectHtml += `</optgroup>`;
    }

    opcionesSelectHtml += `<option value="__NUEVA__" style="color:#2563eb; font-weight:bold;">➕ Crear Nueva Categoría desde Cero...</option>`;

    const { value: formValues } = await Swal.fire({
        title: '➕ Vincular o Crear Categoría / Eje Comercial',
        html: `
            <div style="display:flex; flex-direction:column; gap:12px; text-align:left;">
                <div style="font-size:0.85em; background:#f0fdf4; padding:8px 12px; border-radius:6px; border:1px solid #bbf7d0; color:#166534;">
                    📍 Familia Activa: <strong>${familiaNombre}</strong>
                </div>

                <label style="font-weight:bold; font-size:0.9em; color:#1e293b;">1. Seleccionar Categoría Preexistente del Diccionario Global</label>
                <select id="swal-bunker-cat-select" class="swal2-select" style="margin:0; width:100%; box-sizing:border-box;" onchange="
                    const isNueva = this.value === '__NUEVA__';
                    document.getElementById('swal-bunker-seccion-nueva-cat').style.display = isNueva ? 'flex' : 'none';
                ">
                    ${opcionesSelectHtml}
                </select>

                <div id="swal-bunker-seccion-nueva-cat" style="display:none; flex-direction:column; gap:10px; border-top:1px dashed #cbd5e1; padding-top:10px; margin-top:5px;">
                    <label style="font-weight:bold; font-size:0.9em; color:#2563eb;">2. Alta de Nueva Categoría (Si no existe previamente)</label>
                    <input id="swal-bunker-cat-nombre" class="swal2-input" placeholder="Ej: procesamiento, envase, cosecha..." style="margin:0; width:100%; box-sizing:border-box;">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Vincular / Crear Categoría',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const selectVal = document.getElementById('swal-bunker-cat-select').value;
            if (!selectVal) {
                Swal.showValidationMessage('Debe seleccionar una categoría preexistente o elegir "Crear Nueva".');
                return false;
            }
            if (selectVal === '__NUEVA__') {
                const nombreNuevo = document.getElementById('swal-bunker-cat-nombre').value.trim().toLowerCase();
                if (!nombreNuevo) {
                    Swal.showValidationMessage('Debe ingresar el nombre de la nueva categoría.');
                    return false;
                }
                return { modo: 'NUEVA', categoria: nombreNuevo };
            } else {
                return { modo: 'REUTILIZAR', categoria: selectVal };
            }
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Vinculando categoría a la familia...', didOpen: () => Swal.showLoading() });

            let ok = false;
            let errMsg = '';
            if (formValues.modo === 'REUTILIZAR') {
                const resAdd = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoria: formValues.categoria, orden_posicional: 99 })
                });
                const jsonAdd = await resAdd.json();
                ok = jsonAdd.success;
                errMsg = jsonAdd.error;
            } else {
                const resNew = await fetch('/api/logistica/bunker-taxonomia/categorias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categoria: formValues.categoria, familiaId: familiaId, ordenPosicional: 99 })
                });
                const jsonNew = await resNew.json();
                ok = jsonNew.success;
                errMsg = jsonNew.error;
            }

            if (ok) {
                const catKey = formValues.categoria.trim().toLowerCase();
                const princTerm = (dictLocal.principal && dictLocal.principal.termino) ? dictLocal.principal.termino : '';
                await window.obtenerPlantillaParaArticulo(princTerm, true);

                // Si fue invocado desde una fila específica o desde el botón superior, inyectar/actualizar la fila sin perder selecciones previas
                const yaTieneFila = dictLocal.propiedades.some(p =>
                    (p.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") ===
                    catKey.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                );

                if (!yaTieneFila) {
                    if (targetInputId) {
                        const rowEl = document.getElementById(targetInputId.replace('val', 'row'));
                        const selCat = rowEl ? (rowEl.querySelector('select.select-cat-eje') || rowEl.querySelector('select')) : null;
                        if (selCat) {
                            let catLabel = catKey.replaceAll('_', ' ');
                            catLabel = catLabel.charAt(0).toUpperCase() + catLabel.slice(1);
                            const newOpt = document.createElement('option');
                            newOpt.value = catKey;
                            newOpt.text = catLabel;
                            selCat.add(newOpt, selCat.options[selCat.options.length - 1]);
                            selCat.value = catKey;
                            await window.actualizarCategoriaAtributo(targetInputId, selCat);
                        }
                    } else {
                        window.agregarAtributoUI(catKey);
                    }
                }

                if (typeof window.aplicarOrdenamientoEspejoTaxonomia === 'function') {
                    await window.aplicarOrdenamientoEspejoTaxonomia(familiaId);
                }
                actualizarLivePreview();

                Swal.fire({
                    title: 'Categoría Vinculada',
                    text: `El eje "${formValues.categoria}" fue incorporado a la plantilla de ${familiaNombre}.`,
                    icon: 'success',
                    timer: 1400,
                    showConfirmButton: false
                });
            } else {
                Swal.fire('Error', errMsg || 'No se pudo vincular la categoría.', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de red al procesar categoría.', 'error');
        }
    }
};

window.editarNombreCategoriaEnFilaBunker = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop || !prop.categoria) {
        Swal.fire('Atención', 'Seleccione una categoría válida para renombrarla.', 'warning');
        return;
    }
    const catActual = prop.categoria;
    const labelActual = catActual.replaceAll('_', ' ').charAt(0).toUpperCase() + catActual.replaceAll('_', ' ').slice(1);

    const { value: nuevoNombre } = await Swal.fire({
        title: '✏️ Editar Nombre de Categoría / Eje',
        text: `Ingrese el nuevo nombre para la categoría "${labelActual}":`,
        input: 'text',
        inputValue: labelActual,
        showCancelButton: true,
        confirmButtonText: '💾 Guardar Cambios',
        cancelButtonText: 'Cancelar',
        inputValidator: (val) => {
            if (!val || !val.trim()) return 'Debe ingresar un nombre válido.';
        }
    });

    if (nuevoNombre) {
        const newExact = nuevoNombre.trim().toLowerCase();
        if (newExact === catActual.trim().toLowerCase()) return;

        try {
            Swal.fire({ title: 'Renombrando categoría en cascada...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-taxonomia/categorias/renombrar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoriaActual: catActual, categoriaNueva: newExact })
            });
            const json = await res.json();
            if (json.success) {
                prop.categoria = newExact;
                const rowEl = document.getElementById(inputId.replace('val', 'row'));
                const selCat = rowEl ? (rowEl.querySelector('select.select-cat-eje') || rowEl.querySelector('select')) : null;
                if (selCat) {
                    const opt = Array.from(selCat.options).find(o => o.value.toLowerCase() === catActual.toLowerCase());
                    const newLabel = newExact.replaceAll('_', ' ').charAt(0).toUpperCase() + newExact.replaceAll('_', ' ').slice(1);
                    if (opt) {
                        opt.value = newExact;
                        opt.text = newLabel;
                    }
                    selCat.value = newExact;
                }
                const princTerm = (dictLocal.principal && dictLocal.principal.termino) ? dictLocal.principal.termino : '';
                await window.obtenerPlantillaParaArticulo(princTerm, true);
                Swal.fire({ title: 'Categoría Renombrada', text: json.message, icon: 'success', timer: 1400, showConfirmButton: false });
            } else {
                Swal.fire('Error', json.error || 'No se pudo renombrar la categoría.', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de red al renombrar la categoría.', 'error');
        }
    }
};

window.desvincularCategoriaEnFilaBunker = async function(inputId) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop || !prop.categoria) return;

    const famSelect = document.getElementById('bunker_familia_id');
    const familiaId = famSelect ? famSelect.value : null;
    const familiaNombre = (famSelect && famSelect.selectedIndex >= 0)
        ? famSelect.options[famSelect.selectedIndex].text.replace(/^🌳\s*/, '')
        : 'la familia';

    const cat = prop.categoria;
    const label = cat.replaceAll('_', ' ').charAt(0).toUpperCase() + cat.replaceAll('_', ' ').slice(1);

    const result = await Swal.fire({
        title: '¿Quitar Categoría de esta Familia?',
        html: `¿Está seguro de quitar el eje posicional <strong>"${label}"</strong> de la plantilla de <strong>${familiaNombre}</strong>?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: '🗑️ Sí, quitar eje de la familia',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            Swal.fire({ title: 'Desvinculando eje...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias/${encodeURIComponent(cat)}`, {
                method: 'DELETE'
            });
            const json = await res.json();
            if (json.success) {
                const rowEl = document.getElementById(inputId.replace('val', 'row'));
                if (rowEl) rowEl.remove();
                dictLocal.propiedades = dictLocal.propiedades.filter(p => p.idContainer !== inputId);
                window.actualizarNumeracionPosicionalFilas();
                actualizarLivePreview();
                Swal.fire({ title: 'Eje Desvinculado', text: json.message, icon: 'success', timer: 1300, showConfirmButton: false });
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular la categoría.', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Fallo de conexión al desvincular categoría.', 'error');
        }
    }
};

window.abrirGestorTaxonomiaModalBunker = async function() {
    const famSelect = document.getElementById('bunker_familia_id');
    const familiaId = famSelect ? (famSelect.value || 1) : 1;
    const familiaNombre = (famSelect && famSelect.selectedIndex >= 0)
        ? famSelect.options[famSelect.selectedIndex].text.replace(/^🌳\s*/, '')
        : 'Familia Seleccionada';

    try {
        Swal.fire({ title: 'Cargando plantilla de categorías...', didOpen: () => Swal.showLoading() });
        const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/categorias`);
        const json = await res.json();

        if (!json.success) {
            Swal.fire('Error', 'No se pudo obtener la plantilla de categorías.', 'error');
            return;
        }

        window.taxonomiaTempArrayBunker = [...(json.data || [])];

        const renderRowsHtml = () => window.taxonomiaTempArrayBunker.map((item, idx) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px; font-weight: bold; color: #475569; text-align: center;">Posición ${idx + 3}</td>
                <td style="padding: 8px; font-weight: bold; color: #1e293b; text-transform: capitalize;">${item.categoria}</td>
                <td style="padding: 8px; text-align: center;">
                    <button type="button" style="padding:4px 8px; cursor:pointer; border:1px solid #cbd5e1; border-radius:4px;" onclick="window.moverCatModalBunker(${idx}, -1)">⬆️ Subir</button>
                    <button type="button" style="padding:4px 8px; cursor:pointer; border:1px solid #cbd5e1; border-radius:4px;" onclick="window.moverCatModalBunker(${idx}, 1)">⬇️ Bajar</button>
                </td>
            </tr>
        `).join('');

        window.moverCatModalBunker = (idx, delta) => {
            const targetIdx = idx + delta;
            if (targetIdx >= 0 && targetIdx < window.taxonomiaTempArrayBunker.length) {
                const temp = window.taxonomiaTempArrayBunker[idx];
                window.taxonomiaTempArrayBunker[idx] = window.taxonomiaTempArrayBunker[targetIdx];
                window.taxonomiaTempArrayBunker[targetIdx] = temp;
                const tbody = document.getElementById('tbody-taxonomia-bunker');
                if (tbody) tbody.innerHTML = renderRowsHtml();
            }
        };

        const { isConfirmed } = await Swal.fire({
            title: `⚙️ Orden de Ejes Posicionales (${familiaNombre})`,
            html: `
                <div style="font-size:0.9em; color:#64748b; margin-bottom:10px;">
                    Defina la secuencia de categorías para <strong>${familiaNombre}</strong>.
                    <strong>Posición 1</strong> (Familia) y <strong>Posición 2</strong> (Nombre Principal) son fijas.
                </div>
                <table style="width:100%; border-collapse:collapse; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px;">
                    <thead>
                        <tr style="background:#e2e8f0; text-align:left;">
                            <th style="padding:8px; text-align:center;">Secuencia</th>
                            <th style="padding:8px;">Categoría Posicional</th>
                            <th style="padding:8px; text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-taxonomia-bunker">
                        ${renderRowsHtml()}
                    </tbody>
                </table>
            `,
            width: '600px',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Nuevo Orden Posicional',
            cancelButtonText: 'Cancelar'
        });

        if (isConfirmed) {
            const ordenamientoPayload = window.taxonomiaTempArrayBunker.map((item, idx) => ({
                categoria: item.categoria,
                orden: idx + 1
            }));

            Swal.fire({ title: 'Guardando secuencia posicional...', didOpen: () => Swal.showLoading() });
            const resSave = await fetch(`/api/logistica/bunker-taxonomia/familias/${familiaId}/reordenar`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordenamiento: ordenamientoPayload })
            });
            const jsonSave = await resSave.json();

            if (jsonSave.success) {
                if (typeof window.aplicarOrdenamientoEspejoTaxonomia === 'function') {
                    await window.aplicarOrdenamientoEspejoTaxonomia(familiaId);
                }
                actualizarLivePreview();
                Swal.fire({ title: 'Orden Actualizado', text: jsonSave.message, icon: 'success', timer: 1300, showConfirmButton: false });
            } else {
                Swal.fire('Error', jsonSave.error || 'No se pudo actualizar el orden.', 'error');
            }
        }
    } catch (e) {
        Swal.fire('Error', 'Fallo de red al obtener la plantilla posicional.', 'error');
    }
};

window.eliminarAtributoUI = function(rowId, inputId) {
    // En el Editor de SKUs (bunker.html), los ejes posicionales son gobernados por la Plantilla de Familia.
    // El botón ✖ desasigna el término y marca el atributo como Silencioso (🙈) para este SKU.
    limpiarTerminoDict(inputId);
    window.toggleVisibilidadAtributo(inputId, true);
    const container = document.getElementById(`container_texto_${inputId}`);
    if (container) {
        const select = container.querySelector('select');
        if (select) select.value = '';
        const textInput = document.getElementById(inputId);
        if (textInput && textInput.tagName === 'INPUT') textInput.value = '';
    }
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            icon: 'info',
            title: 'Atributo omitido para este SKU (🙈 Silencioso)'
        });
    }
};

let listasGlobales = [];

async function cargarListasDinamicas() {
    const container = document.getElementById('dynamic-lists');
    try {
        const response = await fetch('/api/logistica/bunker/listas');
        if (!response.ok) throw new Error('Error al obtener listas');
        
        const resJson = await response.json();
        listasGlobales = resJson.data || [];

        // 🌐 Renderizar checklist de asignación comercial a listas vigentes
        const checklistContainer = document.getElementById('listas-checklist-container');
        if (checklistContainer) {
            checklistContainer.innerHTML = ''; // Limpiar loader
            listasGlobales.forEach(lista => {
                const label = document.createElement('label');
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.gap = '6px';
                label.style.cursor = 'pointer';
                label.style.background = 'white';
                label.style.padding = '6px 12px';
                label.style.border = '1px solid #cbd5e1';
                label.style.borderRadius = '4px';
                label.style.fontSize = '0.9em';
                
                label.innerHTML = `
                    <input type="checkbox" name="listas_asignadas" value="${lista.id}" checked style="width: auto;">
                    <span>${lista.nombre}</span>
                `;
                
                const chk = label.querySelector('input');
                chk.addEventListener('change', () => {
                    const rowInputMargen = document.querySelector(`.input-margen-dinamico[data-listaid="${lista.id}"]`);
                    const rowInputPrecio = document.querySelector(`.input-precio-final[data-listaid="${lista.id}"]`);
                    if (rowInputMargen) rowInputMargen.disabled = !chk.checked;
                    if (rowInputPrecio) rowInputPrecio.disabled = !chk.checked;
                    
                    if (!chk.checked) {
                        if (rowInputMargen) rowInputMargen.value = '0,00';
                        if (rowInputPrecio) rowInputPrecio.value = '0,00';
                        if (typeof recalcularFilaPorMargen === 'function') {
                            recalcularFilaPorMargen(lista.id);
                        }
                    }
                });
                
                checklistContainer.appendChild(label);
            });
        }

        container.innerHTML = ''; // Limpiar loader
        
        if (listasGlobales.length === 0) {
            container.innerHTML = '<div style="color: #dc3545;">⚠️ No hay listas de precios activas configuradas en la BD.</div>';
            return;
        }

        // Generar la grilla bidireccional
        const table = document.createElement('table');
        table.className = "tabla-financiera";
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Lista</th>
                    <th title="Edite para recalcular Precio Final">Margen (%) ✏️</th>
                    <th>Precio s/IVA</th>
                    <th>IIBB (4%)</th>
                    <th>Ganancia Neta ($)</th>
                    <th title="Edite forzar Precio Final y ajustar Margen">Precio Final c/IVA ✏️</th>
                    <th title="Limpiar y resetear a cero">Acción</th>
                </tr>
            </thead>
            <tbody id="tbody-margenes"></tbody>
        `;
        
        const tbody = table.querySelector('#tbody-margenes');
        
        listasGlobales.forEach(lista => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${lista.nombre}</td>
                <td><input type="text" class="input-margen-dinamico" data-listaid="${lista.id}" value="0,00" placeholder="0,00" oninput="recalcularFilaPorMargen(${lista.id})" onfocus="limpiarFormatoInputFocus(this)" onblur="aplicarFormatoInputBlur(this)" data-decimals="2"></td>
                <td id="s_iva_${lista.id}">$ 0,00</td>
                <td id="iibb_${lista.id}">$ 0,00</td>
                <td id="neta_${lista.id}" style="color: #15803d; font-weight: bold;">$ 0,00</td>
                <td><input type="text" class="input-precio-final" id="precio_final_${lista.id}" data-listaid="${lista.id}" value="0,00" placeholder="0,00" oninput="recalcularFilaPorPrecioFinal(${lista.id})" onfocus="limpiarFormatoInputFocus(this)" onblur="aplicarFormatoInputBlur(this)" data-decimals="2"></td>
                <td style="text-align: center;"><button type="button" class="btn-icon" style="color: #ef4444; font-size: 1.2em; border: none; background: transparent; cursor: pointer;" title="Resetear Valores" onclick="limpiarFilaFinanciera(${lista.id})">🗑️</button></td>
            `;
            tbody.appendChild(tr);
        });

        container.appendChild(table);

    } catch (error) {
        console.error('Error:', error);
        container.innerHTML = '<div style="color: #dc3545;">❌ Error de conexión al cargar las listas.</div>';
        Swal.fire('Error', 'No se pudieron comunicar con el búnker para obtener las listas de precios.', 'error');
    }
}

window.marcarTodasLasListas = function(checked) {
    const checkboxes = document.querySelectorAll('input[name="listas_asignadas"]');
    checkboxes.forEach(chk => {
        chk.checked = checked;
        const rowInputMargen = document.querySelector(`.input-margen-dinamico[data-listaid="${chk.value}"]`);
        const rowInputPrecio = document.querySelector(`.input-precio-final[data-listaid="${chk.value}"]`);
        if (rowInputMargen) rowInputMargen.disabled = !checked;
        if (rowInputPrecio) rowInputPrecio.disabled = !checked;
        
        if (!checked) {
            if (rowInputMargen) rowInputMargen.value = '0,00';
            if (rowInputPrecio) rowInputPrecio.value = '0,00';
            if (typeof recalcularFilaPorMargen === 'function') {
                recalcularFilaPorMargen(chk.value);
            }
        }
    });
    if (typeof recalcularTodaLaGrilla === 'function') {
        recalcularTodaLaGrilla();
    }
};

// Motor de Hidratación Frontend (Fase 7 & Fase Clonación Integral)
window.hidratarFormularioEdicion = async function(id, options = {}) {
    const esModoClon = options && options.esModoClon === true;
    try {
        Swal.fire({ 
            title: esModoClon ? 'Clonando Estructura Búnker...' : 'Recuperando Búnker...', 
            didOpen: () => Swal.showLoading(), 
            allowOutsideClick: false 
        });
        
        const res = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(id)}`);
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error);
        
        const art = result.data;
        
        // 1. Structural Identity Setup
        const legacyPrevio = (esModoClon && articuloConsolidadoSeleccionado && articuloConsolidadoSeleccionado.id && articuloConsolidadoSeleccionado.id !== art.articulo_id)
            ? articuloConsolidadoSeleccionado
            : null;

        if (esModoClon) {
            window.articuloReferenteClonadoId = art.articulo_id;
            articuloConsolidadoSeleccionado = legacyPrevio; // 🛡️ Preservar artículo Legacy si ya estaba seleccionado (ej. vía ?enrich=)

            // Poblar el buscador de referente y activar indicadores visuales de clonación
            const inputReferente = document.getElementById('buscador_referente');
            if (inputReferente) {
                inputReferente.value = `[${art.articulo_id}] ${art.descripcion_generada || art.descripcion}`;
            }
            const badgeClon = document.getElementById('badge_clon_activo');
            if (badgeClon) badgeClon.style.display = 'inline-block';
            const btnLimpiar = document.getElementById('btn_limpiar_referente');
            if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
            const avisoInfo = document.getElementById('aviso_referente_info');
            if (avisoInfo) {
                avisoInfo.innerHTML = `<strong>Referente Activo:</strong> Clonando estructura desde <strong>[${art.articulo_id}] ${art.descripcion_generada || art.descripcion}</strong>.<br><span style="font-size:0.9em; color:#6d28d9;">Se ha heredado la taxonomía, empaque, listas asignadas y márgenes financieros${legacyPrevio ? ` hacia el código Legacy <strong>[${legacyPrevio.id}]</strong>` : ''}.</span>`;
                avisoInfo.style.display = 'block';
            }
            const btnSubmit = document.querySelector('.btn-submit');
            if (btnSubmit) {
                btnSubmit.innerHTML = legacyPrevio
                    ? `✨ Guardar Alta Búnker para [${legacyPrevio.id}]`
                    : '✨ Crear Nuevo Artículo Clonado';
                btnSubmit.style.background = '#8b5cf6';
            }

            if (legacyPrevio) {
                const chkLocal = document.getElementById('chk_crear_local');
                if (chkLocal && chkLocal.checked) {
                    chkLocal.checked = false;
                    if (typeof window.toggleCrearLocalMode === 'function') {
                        await window.toggleCrearLocalMode(chkLocal);
                    }
                }
                const pivoteEl = document.getElementById('bunker_id_pivote');
                if (pivoteEl) pivoteEl.value = legacyPrevio.id;
                const barrasEl = document.getElementById('bunker_codigo_barras');
                if (barrasEl) barrasEl.value = legacyPrevio.codigo_barras || legacyPrevio.id;
                const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
                if (descLegacyEl) {
                    descLegacyEl.innerText = `✨ Clonando desde [${art.articulo_id}] | Vinculado a Legacy: [${legacyPrevio.id}] ${legacyPrevio.descripcion || ''}`;
                }
                const inputDescLegacy = document.getElementById('bunker_descripcion_legacy');
                if (inputDescLegacy) {
                    inputDescLegacy.value = legacyPrevio.descripcion || '';
                }
            } else {
                // Activar por defecto "Crear en Local" para aprovisionar nueva identidad limpia
                const chkLocal = document.getElementById('chk_crear_local');
                if (chkLocal) {
                    chkLocal.checked = true;
                    if (typeof window.toggleCrearLocalMode === 'function') {
                        await window.toggleCrearLocalMode(chkLocal);
                    }
                }
                const pivoteEl = document.getElementById('bunker_id_pivote');
                if (pivoteEl) pivoteEl.value = 'Se generará EMB-XXXXXX';
                const barrasEl = document.getElementById('bunker_codigo_barras');
                if (barrasEl) barrasEl.value = 'Se generará de 10 dígitos';

                const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
                if (descLegacyEl) {
                    descLegacyEl.innerText = `✨ Clonando estructura desde SKU [${art.articulo_id}]`;
                }
                const inputDescLegacy = document.getElementById('bunker_descripcion_legacy');
                if (inputDescLegacy) {
                    inputDescLegacy.value = art.descripcion_legacy || art.descripcion_generada || art.descripcion || '';
                }
            }
        } else {
            window.articuloReferenteClonadoId = null;
            document.getElementById('bunker_id_pivote').value = art.articulo_id;
            document.getElementById('bunker_codigo_barras').value = art.codigo_barras || art.articulo_id;
            
            const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
            if (descLegacyEl) {
                descLegacyEl.innerText = art.descripcion_legacy ? `Legacy: ${art.descripcion_legacy}` : '';
            }
            
            // Trick to enable UPDATE branch when saving
            articuloConsolidadoSeleccionado = { id: art.articulo_id, codigo_barras: art.codigo_barras || art.articulo_id }; 
        } 
        
        // 2. Principal (Desacoplado de Texto Legacy)
        let propsJSON = art.propiedades_dinamicas || {};
        const terminoAnclaLimpio = (propsJSON && propsJSON.articulo_principal) 
            ? String(propsJSON.articulo_principal).trim() 
            : (art.descripcion || '').replace(/\s*\[.*?\]/g, '').trim();

        document.getElementById('descripcion_principal').value = terminoAnclaLimpio;
        
        // Extraer abreviatura del string compilado generada si es posible
        let abrevPrincipal = 'N/A';
        if (art.descripcion_generada && art.descripcion_generada.includes('.')) {
            abrevPrincipal = art.descripcion_generada.split('.')[0];
        } else if (art.descripcion_generada) {
            abrevPrincipal = art.descripcion_generada;
        }

        let princIdNumEdit = (propsJSON && propsJSON.articulo_principal_id) ? parseInt(propsJSON.articulo_principal_id) : null;
        if (!princIdNumEdit && window.diccionarioCategorizado) {
            const foundPrinc = window.diccionarioCategorizado.find(d => 
                (d.categoria === 'articulo_principal' || d.categoria === 'general') && 
                (d.termino || '').toLowerCase().trim() === terminoAnclaLimpio.toLowerCase()
            );
            if (foundPrinc) princIdNumEdit = foundPrinc.id;
        }

        dictLocal.principal = { id: princIdNumEdit, termino: terminoAnclaLimpio, abreviatura: abrevPrincipal, modo_display: 'COMPLETO' };
        
        const pInput = document.getElementById('descripcion_principal_input');
        if (pInput) {
            pInput.value = terminoAnclaLimpio;
        }
        
        // A. Poblar Selector de Familia si existe en el DOM
        const famIdSelect = document.getElementById('bunker_familia_id');
        const famIdVal = art.familia_id || (typeof propsJSON === 'object' ? propsJSON.familia_id : null) || 6;
        if (famIdSelect) {
            famIdSelect.value = String(famIdVal);
        }

        // Fetch Dictionary Template for the Principal with relational IDs
        if (typeof obtenerPlantillaParaArticulo === 'function') {
            await obtenerPlantillaParaArticulo(terminoAnclaLimpio, true);
        }
        
        // 3. Financial and Reglas (Fuente Única de Verdad v5.29)
        const costoBaseEl = document.getElementById('costo_base');
        const costoVigenteFinanzas = parseFloat(art.costo_base_finanzas || art.costo_real_vigente || art.costo_base || 0);
        const costoLegacyPrevio = legacyPrevio ? parseFloat(legacyPrevio.costo_base || 0) : 0;
        const kilosLegacyPrevio = legacyPrevio ? parseFloat(legacyPrevio.kilos_unidad || 0) : 0;

        costoBaseEl.value = (costoLegacyPrevio > 0 ? costoLegacyPrevio : costoVigenteFinanzas).toFixed(2);
        aplicarFormatoInputBlur(costoBaseEl);

        const porcentajeIvaEl = document.getElementById('porcentaje_iva');
        porcentajeIvaEl.value = parseFloat((legacyPrevio && legacyPrevio.porcentaje_iva) ? legacyPrevio.porcentaje_iva : (art.porcentaje_iva || 21)).toFixed(2);
        aplicarFormatoInputBlur(porcentajeIvaEl);

        const kilosUnidadEl = document.getElementById('kilos_unidad');
        kilosUnidadEl.value = (kilosLegacyPrevio > 0 ? kilosLegacyPrevio : parseFloat(art.kilos_unidad || 0)).toFixed(3);
        aplicarFormatoInputBlur(kilosUnidadEl);
        document.getElementById('cantidad_pack').value = art.pack_unidades || 1;
        if (document.getElementById('expresar_gramos')) {
            document.getElementById('expresar_gramos').checked = art.expresado_en_gramos || false;
        }
        if (document.getElementById('expresar_unidades')) {
            document.getElementById('expresar_unidades').checked = art.expresado_en_unidades || false;
        }
        conmutarModoUnidades();
        
        // ⚖️ Tasa unitaria para reescalado reactivo de costos por presentación (Fase Clonación Integral)
        const kRef = parseFloat(art.kilos_unidad || 0);
        const pRef = parseInt(art.pack_unidades || 1);
        const enUnidadesRef = art.expresado_en_unidades === true;

        if (enUnidadesRef && pRef > 0 && costoVigenteFinanzas > 0) {
            window.referenteCostoUnitario = costoVigenteFinanzas / pRef;
            window.referenteEsUnidades = true;
        } else if (!enUnidadesRef && kRef > 0 && costoVigenteFinanzas > 0) {
            window.referenteCostoUnitario = costoVigenteFinanzas / kRef;
            window.referenteEsUnidades = false;
        } else {
            window.referenteCostoUnitario = 0;
            window.referenteEsUnidades = false;
        }
        const avisoCosto = document.getElementById('aviso_costo_proporcional');
        if (avisoCosto) avisoCosto.style.display = 'none';
        
        document.getElementById('moneda').value = art.moneda || '($)Pesos';
        
        if (art.rubro) {
            document.getElementById('rubro').value = art.rubro;
            await window.rubroSeleccionadoContexto(document.getElementById('rubro'));
            if (art.sub_rubro) {
                document.getElementById('sub_rubro').value = art.sub_rubro;
            }
        }
        
        document.getElementById('pack_hijo_codigo').value = art.pack_hijo_codigo || '';
        document.getElementById('no_producido_por_lambda').checked = art.no_producido_por_lambda || false;
        document.getElementById('mantener_utilidad').checked = art.mantener_utilidad !== false;
        
        // 4. Margins
        // Desmarcar todos los checkboxes de asignación comercial primero y deshabilitar inputs por defecto
        const checkboxes = document.querySelectorAll('input[name="listas_asignadas"]');
        checkboxes.forEach(chk => {
            chk.checked = false;
            const rowInputMargen = document.querySelector(`.input-margen-dinamico[data-listaid="${chk.value}"]`);
            const rowInputPrecio = document.querySelector(`.input-precio-final[data-listaid="${chk.value}"]`);
            if (rowInputMargen) rowInputMargen.disabled = true;
            if (rowInputPrecio) rowInputPrecio.disabled = true;
        });

        if (art.margenes && Array.isArray(art.margenes)) {
            art.margenes.forEach(m => {
                const isDisponible = m.disponible !== false;
                
                const inputMargen = document.querySelector(`.input-margen-dinamico[data-listaid="${m.lista_id}"]`);
                if (inputMargen) {
                    inputMargen.value = parseFloat(m.margen_porcentaje).toFixed(2);
                    aplicarFormatoInputBlur(inputMargen);
                    inputMargen.disabled = !isDisponible;
                }
                const chk = document.querySelector(`input[name="listas_asignadas"][value="${m.lista_id}"]`);
                if (chk) {
                    chk.checked = isDisponible;
                }
                const rowInputPrecio = document.querySelector(`.input-precio-final[data-listaid="${m.lista_id}"]`);
                if (rowInputPrecio) {
                    rowInputPrecio.disabled = !isDisponible;
                }
            });
        }
        recalcularTodaLaGrilla();

        // 5. JSONB Re-construction & Positional Normalization
        propsJSON = art.propiedades_dinamicas || {};

        // A. Selector de Familia ya fue poblado al inicio de la hidratación (v5.82)
        if (famIdSelect) {
            famIdSelect.value = String(famIdVal);
        }

        // B. Aislar el mapa de propiedades comerciales (posiciones dinámicas o plano)
        let mapComercial = {};
        if (propsJSON.posiciones && typeof propsJSON.posiciones === 'object') {
            // Estructura Migrada Posicional: { pos_1: { eje: 'Tratamiento', valor: 'Cuarto', ... } }
            Object.values(propsJSON.posiciones).forEach(p => {
                if (p && p.eje) {
                    const ejeNombre = String(p.eje).trim();
                    mapComercial[ejeNombre] = {
                        valor: p.valor,
                        abreviatura: p.abreviatura || p.valor,
                        visible: p.silencioso !== true,
                        modo_display: p.modo_display || 'COMPLETO',
                        orden: p.posicion || 99
                    };
                }
            });
        } else {
            // Estructura Plano Retrocompatible
            mapComercial = propsJSON;
        }

        // C. Pre-poblar el esqueleto posicional maestro y selector Nivel 2 de la familia para preseleccionar el Atributo Principal guardado
        if (famIdVal && typeof window.cambiarFamiliaArticulo === 'function') {
            console.log(`🚨 [VIGÍA EDICIÓN - INICIALIZANDO MOLDE GRANÍTICO Y ATRIBUTO PRINCIPAL PARA FAMILIA ${famIdVal}]`);
            await window.cambiarFamiliaArticulo(famIdVal);

            // Preselección defensiva por ID entero relacional o nombre de término como fallback
            const targetPrincipalVal = princIdNumEdit || terminoAnclaLimpio;
            if (typeof window.cargarPrincipalesBunker === 'function') {
                await window.cargarPrincipalesBunker(famIdVal, targetPrincipalVal);
            }
            if (typeof window.cambiarPrincipalArticulo === 'function') {
                await window.cambiarPrincipalArticulo(targetPrincipalVal);
            }
            if (propsJSON.silencioso_principal !== undefined) {
                window.toggleVisibilidadPrincipal(propsJSON.silencioso_principal === true);
            }
            if (propsJSON.modo_display_principal) {
                window.setModoDisplayPrincipal(propsJSON.modo_display_principal);
            }

            // Hidratar configuración de Inyección Optativa de Familia
            if (propsJSON.incluir_familia !== undefined) {
                window.toggleInyeccionFamilia(propsJSON.incluir_familia === true);
            } else {
                window.toggleInyeccionFamilia(false);
            }
            if (propsJSON.posicion_familia) {
                const posFamSelect = document.getElementById('bunker_posicion_familia');
                if (posFamSelect) posFamSelect.value = propsJSON.posicion_familia;
            }
            if (propsJSON.modo_display_familia) {
                const modoFamSelect = document.getElementById('bunker_modo_familia');
                if (modoFamSelect) modoFamSelect.value = propsJSON.modo_display_familia;
            }
            if (propsJSON.abreviatura_familia !== undefined) {
                const abrevFamInput = document.getElementById('bunker_abrev_familia');
                if (abrevFamInput) abrevFamInput.value = propsJSON.abreviatura_familia || '';
                window.lastKnownAbreviaturaFamilia = propsJSON.abreviatura_familia || '';
            }
        }

        // Hidratar configuración de Presentación Variable WIP (Artículos de Unidad Productiva / Enrutamiento)
        const isWipSaved = propsJSON.presentacion_variable_wip === true;
        const sufijoWipSaved = propsJSON.sufijo_wip || '';

        const chkWip = document.getElementById('presentacion_variable_wip');
        const inputSufijo = document.getElementById('sufijo_wip');
        const inputPuente = document.getElementById('articulo_puente_codigo');

        if (chkWip) {
            chkWip.checked = isWipSaved;
        }
        if (inputSufijo) {
            inputSufijo.value = sufijoWipSaved;
        }
        if (inputPuente) {
            inputPuente.value = art.articulo_puente_codigo || '';
        }
        if (typeof window.togglePresentacionVariableWIP === 'function') {
            window.togglePresentacionVariableWIP(isWipSaved);
        }

        // Consultar secuencia posicional canónica para la familia
        let taxOrder = [];
        try {
            const resTax = await fetch(`/api/logistica/bunker-taxonomia/familias/${famIdVal}/categorias`);
            const jsonTax = await resTax.json();
            if (jsonTax.success && Array.isArray(jsonTax.data)) {
                taxOrder = jsonTax.data.map(item => item.categoria.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
            }
        } catch (e) {
            console.warn('⚠️ [BUNKER] Error obteniendo secuencia de taxonomia para articulo:', e);
        }

        // Extraer claves comerciales reales excluyendo llaves de sistema y el articulo_principal (Nivel 2)
        const keys = Object.keys(mapComercial)
            .filter(key => key !== 'familia_id' && key !== 'familia_nombre' && key !== 'posiciones' &&
                           key !== 'articulo_principal' && key !== 'pos_1' &&
                           key !== 'silencioso_principal' && key !== 'modo_display_principal' &&
                           !key.startsWith('asistente_') && !key.startsWith('rendimiento_') && 
                           !key.startsWith('tostadero_') && key !== 'codigo_barras_local' && 
                           key !== 'exencion_operativa' && !key.startsWith('_meta'))
            .sort((a, b) => {
                const aNorm = a.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const bNorm = b.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const idxA = taxOrder.indexOf(aNorm) >= 0 ? taxOrder.indexOf(aNorm) : 99;
                const idxB = taxOrder.indexOf(bNorm) >= 0 ? taxOrder.indexOf(bNorm) : 99;
                if (idxA !== idxB) return idxA - idxB;
                const propA = mapComercial[a];
                const propB = mapComercial[b];
                const ordA = (typeof propA === 'object' && propA !== null && propA.orden !== undefined) ? propA.orden : 99;
                const ordB = (typeof propB === 'object' && propB !== null && propB.orden !== undefined) ? propB.orden : 99;
                return ordA - ordB;
            });
        
        const ejesHuerfanosRelegados = [];

        for (const cat of keys) {
            const propData = mapComercial[cat];
            
            const val = typeof propData === 'object' && propData !== null ? propData.valor : propData;
            const isVisible = typeof propData === 'object' && propData !== null ? (propData.visible !== false) : true;
            
            // Re-use auto-generated UI container from active master template (Búsqueda por normalización NFD)
            const catNorm = (cat || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            let existingProp = dictLocal.propiedades.find(p => {
                const pCatNorm = (p.categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                return pCatNorm === catNorm;
            });
            let targetInputId = existingProp ? existingProp.idContainer : null;
            
            // 🔑 AISLAMIENTO ESTRICTO v5.17: Prohibido inyectar filas mutantes en el DOM durante hidratación
            if (!targetInputId) {
                if (val && !cat.startsWith('pos_')) {
                    ejesHuerfanosRelegados.push({ eje: cat, valor: val });
                }
                continue; // 🚫 PROHIBIDO inyectar fila desbordada
            }

            // At this point, the innerHTML is either a text input or a Smart <select>
            // Let's attempt to look up its historical Abbreviation since it's missing from JSONB mapping
            let abrevReconstructed = 'XXX';
            if (window.diccionarioCategorizado && val) {
                 const valStr = String(val).toLowerCase();
                 const matchDict = window.diccionarioCategorizado.find(d => d.termino && String(d.termino).toLowerCase() === valStr);
                 if (matchDict) abrevReconstructed = matchDict.abreviatura;
            }

            // ✅ REEMPLAZO ESTRUCTURAL v5.5: Coincidencia Determinista Limpia y Saneamiento de Cadenas
            const elContainer = document.getElementById(`container_texto_${targetInputId}`);
            let targetTerminoFinal = String(val || '').replace(/\s*\[.*?\]/g, '').trim();
            let targetAbrevFinal = abrevReconstructed;

            if (elContainer) {
                const selectEl = elContainer.querySelector('select');
                if (selectEl) {
                    // 1. Extraer y sanear el valor del atributo guardado en el JSONB
                    const valorAtributoGuardado = typeof propData === 'object' && propData !== null ? propData.valor : propData;
                    const valorLimpioSinCorchetes = String(valorAtributoGuardado || '').replace(/\s*\[.*?\]/g, '').trim();
                    const atributoNormMatch = valorLimpioSinCorchetes.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                    // 2. Coincidencia determinista multi-criterio contra las opciones del desplegable
                    let foundOpt = Array.from(selectEl.options).find(opt => {
                        let optTermino = '';
                        let optAbrev = '';
                        try {
                            const parsed = JSON.parse(opt.value);
                            optTermino = parsed.t || opt.text;
                            optAbrev = parsed.a || '';
                        } catch(e) {
                            optTermino = opt.value || opt.text;
                        }
                        const optNorm = String(optTermino || '').replace(/\s*\[.*?\]/g, '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        const abrevNorm = String(optAbrev || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        return optNorm === atributoNormMatch || abrevNorm === atributoNormMatch || (optNorm && atributoNormMatch.includes(optNorm));
                    });

                    // 3. Preselección en el DOM o inyección dinámica de la opción si es un atributo nuevo
                    if (foundOpt) {
                        selectEl.value = foundOpt.value;
                        try {
                            const parsedOpt = JSON.parse(foundOpt.value);
                            if (parsedOpt.t) targetTerminoFinal = parsedOpt.t;
                            if (parsedOpt.a) targetAbrevFinal = parsedOpt.a;
                        } catch(e) {}
                    } else {
                        const targetJSONStr = JSON.stringify({ t: targetTerminoFinal, a: abrevReconstructed });
                        const newOpt = document.createElement('option');
                        newOpt.value = targetJSONStr;
                        newOpt.text = `${targetTerminoFinal} [${abrevReconstructed}]`;
                        selectEl.add(newOpt, selectEl.options[selectEl.options.length - 1]);
                        selectEl.value = targetJSONStr;
                        if (window.diccionarioCategorizado) {
                            window.diccionarioCategorizado.push({ termino: targetTerminoFinal, abreviatura: abrevReconstructed, categoria: cat });
                        }
                    }
                } else {
                    const textEl = document.getElementById(targetInputId);
                    if (textEl) textEl.value = `${targetTerminoFinal} [${abrevReconstructed}]`;
                }
            }

            // Hard inject into dictLocal so updating live preview works
            const pIndex = dictLocal.propiedades.findIndex(p => p.idContainer === targetInputId);
            if (pIndex >= 0) {
                dictLocal.propiedades[pIndex].termino = targetTerminoFinal;
                dictLocal.propiedades[pIndex].abreviatura = targetAbrevFinal;
                const modoDisp = typeof propData === 'object' && propData !== null ? (propData.modo_display || 'COMPLETO') : 'COMPLETO';
                dictLocal.propiedades[pIndex].modo_display = modoDisp;
                if (typeof window.setModoDisplayAtributo === 'function') {
                    window.setModoDisplayAtributo(targetInputId, modoDisp);
                }
                window.toggleVisibilidadAtributo(targetInputId, !isVisible);
            }
        }
        
        // Reasegurar la fijación del Atributo Principal Nivel 2 en el selector
        const selectPrincFinal = document.getElementById('bunker_principal_id');
        if (selectPrincFinal && terminoAnclaLimpio) {
            if (Array.from(selectPrincFinal.options).some(o => o.value === terminoAnclaLimpio)) {
                selectPrincFinal.value = terminoAnclaLimpio;
            }
        }
        // 🔑 PANEL INFORMATIVO DE ATRIBUTOS HUÉRFANOS v5.15 (Garantía Cero Pérdida Silenciosa)
        const containerAtributos = document.getElementById('atributos-container');
        const oldAlert = document.getElementById('alert-datos-desfasados-bunker');
        if (oldAlert) oldAlert.remove();

        const todosEjesDesfasados = [
            ...(Array.isArray(art.ejes_desfasados) ? art.ejes_desfasados : []),
            ...ejesHuerfanosRelegados
        ];

        if (todosEjesDesfasados.length > 0 && containerAtributos) {
            const listHtml = todosEjesDesfasados.map(d => `
                <span style="font-family:monospace; background:#fef3c7; color:#78350f; padding:3px 8px; border-radius:4px; font-weight:600; font-size:0.88em; margin-right:6px; display:inline-block; margin-top:4px;">
                    Eje: ${window.escapeHtmlAttr ? window.escapeHtmlAttr(d.eje) : d.eje} ➔ Valor: "${window.escapeHtmlAttr ? window.escapeHtmlAttr(d.valor) : d.valor}"
                </span>
            `).join('');

            const alertDiv = document.createElement('div');
            alertDiv.id = 'alert-datos-desfasados-bunker';
            alertDiv.style.cssText = 'background:#fffbeb; border:1px solid #fde047; border-radius:6px; padding:10px 14px; margin-bottom:12px; font-size:0.9em;';
            alertDiv.innerHTML = `
                <span style="color:#b45309; font-weight:bold; display:block; margin-bottom:4px;">
                    ⚠️ Atributo grabado en versión previa de la plantilla:
                </span>
                ${listHtml}
                <p style="font-size:0.82em; color:#92400e; margin:6px 0 0 0;">
                    💡 Si desea conservar este valor, puede reasignarlo en alguno de los selectores de la plantilla vigente abajo antes de presionar Guardar.
                </p>
            `;
            containerAtributos.parentNode.insertBefore(alertDiv, containerAtributos);
        }

        // 🥣 Hidratación de Receta y Estructura de Fraccionamiento (Fase Clonación Integral)
        try {
            if (typeof window.hidratarRecetaArticulo === 'function') {
                await window.hidratarRecetaArticulo(id, { esModoClon });
            }
        } catch (errRec) {
            console.warn('⚠️ [BUNKER] Error hidratando receta de fraccionamiento:', errRec);
        }

        actualizarLivePreview();

        if (esModoClon) {
            // Configurar UI para Modo Clon
            const badgeClon = document.getElementById('badge_clon_activo');
            if (badgeClon) badgeClon.style.display = 'inline-block';
            const btnLimpiar = document.getElementById('btn_limpiar_referente');
            if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
            const inputReferente = document.getElementById('buscador_referente');
            if (inputReferente) {
                inputReferente.value = `[${art.articulo_id}] ${art.descripcion_generada || art.descripcion}`;
            }

            const btnSubmit = document.querySelector('.btn-submit');
            if (btnSubmit) {
                btnSubmit.innerHTML = '✨ Crear Nuevo Artículo Clonado';
                btnSubmit.style.background = '#7c3aed';
            }

            window.ultimoReferenteClonadoId = art.articulo_id;
            const ldnRef = window.determinarLineaDeNegocio(art);

            const avisoInfo = document.getElementById('aviso_referente_info');
            if (avisoInfo) {
                let advertenciasFlujo = '';
                if (ldnRef.id === 1) {
                    advertenciasFlujo += `
                        <div style="margin-top: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; color: #166534;">
                            <strong>🌾 Flujo 1 (Bulto Cerrado Directo):</strong> El artículo referente se adquiere cerrado a proveedor (sin receta ni insumos). Si este nuevo clon es una fracción comercial (Flujo 2), puede activar la receta en el panel de Fraccionamiento más abajo para vincular la materia prima y bolsa/caja.
                        </div>
                    `;
                } else if (ldnRef.id === 2) {
                    advertenciasFlujo += `
                        <div style="margin-top: 8px; padding: 8px 12px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; color: #92400e;">
                            <strong>📦 Flujo 2 (Fraccionados de Bulto Cerrado):</strong> Se ha heredado la receta (materia prima mono-ingrediente y envase). Si esta nueva fracción utiliza otra presentación de bolsa o insumo padre diferente, actualice el envase o el código de insumo padre en los campos correspondientes.
                        </div>
                    `;
                }
                if (art.pack_hijo_codigo && ldnRef.id !== 2) {
                    advertenciasFlujo += `
                        <div style="margin-top: 8px; padding: 8px 12px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; color: #92400e;">
                            <strong>📦 Vínculo Padre/Hijo:</strong> Este SKU referencia al código <code>${art.pack_hijo_codigo}</code>. Si esta variante se abastece de un bulto diferente, recuerde actualizar el campo <em>"Código Artículo Hijo (Si es Pack / Insumo)"</em> más abajo.
                        </div>
                    `;
                }
                if ((art.receta_id || (propsJSON && propsJSON.receta_id)) && ldnRef.id > 2) {
                    advertenciasFlujo += `
                        <div style="margin-top: 8px; padding: 8px 12px; background: #eff6ff; border: 1px solid #3b82f6; border-radius: 6px; color: #1e40af;">
                            <strong>🥣 Producción / Recetas Compuestas:</strong> El artículo referente cuenta con una formulación de producción activa. Al guardar, el backend duplicará automáticamente la receta y sus ingredientes para este nuevo SKU en la base de datos de Producción.
                        </div>
                    `;
                }
                if (propsJSON && propsJSON.presentacion_variable_wip) {
                    advertenciasFlujo += `
                        <div style="margin-top: 8px; padding: 8px 12px; background: #e0e7ff; border: 1px solid #6366f1; border-radius: 6px; color: #3730a3;">
                            <strong>🏭 Flujo 4 (Unidad Productiva Externa - WIP):</strong> Se clonaron los parámetros de presentación variable. Verifique o asigne el Artículo Puente (AP) de salida comercial.
                        </div>
                    `;
                }

                avisoInfo.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
                        <div style="font-weight: bold; font-size: 1.05em; color: #4c1d95;">
                            📋 Clonando a partir de SKU [${art.articulo_id}] — ${art.descripcion_generada || art.descripcion}
                        </div>
                        <span class="badge-ldn" style="font-size: 0.8em; font-weight: 700; padding: 2px 8px; border-radius: 4px; border: 1px solid ${ldnRef.borderColor}; background: ${ldnRef.bgColor}; color: ${ldnRef.color};">
                            ${ldnRef.nombre}
                        </span>
                    </div>
                    <div style="color: #4b5563;">
                        Se han copiado todos los atributos posicionales, familia, costos, listas activas y márgenes. Modifique únicamente los atributos necesarios (ej: Calibre) y guarde para registrar el nuevo SKU sin alterar el artículo referente.
                    </div>
                    ${advertenciasFlujo}
                `;
                avisoInfo.style.display = 'block';
            }

            Swal.fire({
                icon: 'success',
                title: '✨ Estructura Clonada',
                html: `Se cargó la configuración de <b>${art.descripcion_generada || art.descripcion}</b>.<br><small>Modifique los atributos deseados y guarde para crear el nuevo artículo.</small>`,
                timer: 2500,
                showConfirmButton: false
            });
        } else {
            Swal.close();
        }
        
    } catch(e) {
        Swal.fire('Error', 'Fallo al Hidratar el Formulario: ' + e.message, 'error');
    }
}

// Lógica Reactiva Bidireccional de Grilla Financiera
window.formatCurrencyARG = function(num) {
    if (isNaN(num)) num = 0;
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(num);
};

window.parseInputValue = function(inputEl) {
    if (!inputEl) return 0;
    let valStr = inputEl.value;
    if (!valStr || valStr.trim() === "") return NaN; // distinguish empty from 0
    
    // Clean string: remove $, spaces
    valStr = valStr.replace(/\$/g, '').trim();
    
    // Check if there is both dot and comma
    const hasComma = valStr.includes(',');
    const hasDot = valStr.includes('.');
    
    if (hasComma && hasDot) {
        // Assume standard format: dots are thousands, comma is decimal (e.g. 1.234,56)
        valStr = valStr.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
        // Only comma: it is the decimal separator (e.g. 12,34)
        valStr = valStr.replace(',', '.');
    } else {
        // Only dot or neither: it is the decimal separator (e.g. 12.34 or 12)
        // Keep it as is ( parseFloat accepts dot )
    }
    
    return parseFloat(valStr);
};

window.aplicarFormatoInputBlur = function(inputEl) {
    let val = parseInputValue(inputEl);
    if (isNaN(val)) return;
    inputEl.type = 'text';
    let decimals = parseInt(inputEl.getAttribute('data-decimals')) || 2;
    inputEl.value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);
};

window.limpiarFormatoInputFocus = function(inputEl) {
    let val = parseInputValue(inputEl);
    // Keep type="text" to allow typing point or comma fluently
    inputEl.type = 'text';
    let decimals = parseInt(inputEl.getAttribute('data-decimals')) || 2;
    inputEl.value = isNaN(val) ? "" : val.toFixed(decimals).replace('.', ',');
};

window.limpiarFilaFinanciera = function(listaId) {
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    
    // Hard UI Reset to 0
    if (margenInput) {
        margenInput.type = 'text';
        margenInput.value = '0,00';
    }
    if (precioInput) {
        precioInput.type = 'text';
        precioInput.value = '';
    }
    
    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
};

/**
 * Reescalado Proporcional Reactivo de Costo Base por Presentación (Kilos o Unidades)
 * Garantiza que al clonar o alterar la presentación (ej: de 12kg a 10kg o 2 x 5kg), el costo unitario
 * y el precio por kilo / unidad se mantengan exactamente constantes.
 */
window.recalcularCostoPresentacionReactivo = function() {
    // Si la estructura de receta está activa, delegar el cálculo al motor de receta transparente
    if (window.estadoRecetaArticulo && window.estadoRecetaArticulo.activa) {
        window.recalcularCostosReceta();
        window.aplicarCostoRecetaABaseYListas(false);
        return;
    }

    if (!window.referenteCostoUnitario || window.referenteCostoUnitario <= 0) return;

    const enUnidades = document.getElementById('expresar_unidades') ? document.getElementById('expresar_unidades').checked : false;
    const costoBaseEl = document.getElementById('costo_base');
    if (!costoBaseEl) return;

    let nuevoCostoBase = 0;
    if (enUnidades) {
        const cantPack = parseInt(document.getElementById('cantidad_pack').value) || 1;
        nuevoCostoBase = window.referenteCostoUnitario * cantPack;
    } else {
        const kilos = parseInputValue(document.getElementById('kilos_unidad')) || 0;
        if (kilos <= 0) return;
        nuevoCostoBase = window.referenteCostoUnitario * kilos;
    }

    if (nuevoCostoBase > 0) {
        costoBaseEl.value = nuevoCostoBase.toFixed(2);
        aplicarFormatoInputBlur(costoBaseEl);

        // Recalcular toda la grilla de listas de precios con el nuevo costo base del bulto
        if (typeof window.recalcularTodaLaGrilla === 'function') {
            window.recalcularTodaLaGrilla();
        }

        // Notificación visual informativa
        const avisoCosto = document.getElementById('aviso_costo_proporcional');
        if (avisoCosto) {
            const tasaFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(window.referenteCostoUnitario);
            const costoFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(nuevoCostoBase);
            avisoCosto.innerHTML = `⚖️ Costo base reescalado automáticamente a <strong>${costoFmt}</strong> (Tasa referente: ${tasaFmt}${enUnidades ? '/u' : '/kg'})`;
            avisoCosto.style.display = 'block';
        }
    }
};
window.actualizarCostoPackReactivo = window.recalcularCostoPresentacionReactivo;

// =========================================================================
// MÓDULO DE RECETA, PACKAGING Y MANO DE OBRA EN CLONACIÓN Y EDICIÓN
// =========================================================================

window.catalogoPackaging = [];
window.catalogoColaboradores = [];
window.catalogoIngredientesMP = [];
window.ultimoReferenteClonadoId = null;

// =========================================================================
// CLASIFICACIÓN UNIVERSAL DE LÍNEAS DE NEGOCIO (LDN 1 A 6) - TALLER LAMDA
// =========================================================================
window.determinarLineaDeNegocio = function(art) {
    if (!art) {
        return { id: 1, tag: 'LDN 1', nombre: 'LDN 1: Bulto Cerrado (Directo)', color: '#334155', bgColor: '#f1f5f9', borderColor: '#cbd5e1' };
    }
    const code = String(art.articulo_id || art.sku_proveedor || '').toLowerCase();
    const desc = String(art.descripcion_generada || art.descripcion || '').toLowerCase();
    const props = (typeof art.propiedades_dinamicas === 'object' && art.propiedades_dinamicas !== null) ? art.propiedades_dinamicas : {};
    const tieneReceta = !!(art.receta_id || (art.total_recetas && parseInt(art.total_recetas) > 0) || (Array.isArray(art.receta_ingredientes) && art.receta_ingredientes.length > 0));
    const tienePackHijo = !!(art.pack_hijo_codigo && String(art.pack_hijo_codigo).trim() !== '');
    const noProducido = art.no_producido_por_lambda === true || art.no_producido_por_lambda === 'true';

    // LDN 5: Barritas UP Externa
    if (code.startsWith('bf') || code.includes('bfx') || desc.includes('barrita') || desc.includes('barr.')) {
        return { id: 5, tag: 'LDN 5', nombre: 'LDN 5: Barritas (Bi-fásica UP)', color: '#9f1239', bgColor: '#fff1f2', borderColor: '#fecdd3' };
    }
    // LDN 6: Granolas Doble Mezcla
    if (code.startsWith('gr') || desc.includes('granola') || desc.includes('grana')) {
        return { id: 6, tag: 'LDN 6', nombre: 'LDN 6: Granolas (Doble Mezcla)', color: '#0369a1', bgColor: '#f0f9ff', borderColor: '#bae6fd' };
    }
    // LDN 4: UP Tostadero Simple
    if (code.startsWith('prod up') || code.includes('tostad') || desc.includes('tostad') || props.presentacion_variable_wip) {
        return { id: 4, tag: 'LDN 4', nombre: 'LDN 4: UP Tostadero', color: '#92400e', bgColor: '#fffbeb', borderColor: '#fde68a' };
    }
    // LDN 3: Mixes / Carros Granel
    if (code.startsWith('m') || desc.includes('mix') || (Array.isArray(art.receta_ingredientes) && art.receta_ingredientes.filter(i => !/bolsa|caja|pack/i.test(i.nombre_ingrediente || '')).length > 1)) {
        return { id: 3, tag: 'LDN 3', nombre: 'LDN 3: Mixes (Carro Granel)', color: '#5b21b6', bgColor: '#f5f3ff', borderColor: '#c4b5fd' };
    }
    // LDN 2: Fraccionado Mono-Ingrediente 100% Puro
    if ((tieneReceta || tienePackHijo) && !noProducido) {
        return { id: 2, tag: 'LDN 2', nombre: 'LDN 2: Fraccionado Mono-Ingrediente', color: '#15803d', bgColor: '#f0fdf4', borderColor: '#86efac' };
    }
    // LDN 1: Bulto Cerrado Directo (Default)
    return { id: 1, tag: 'LDN 1', nombre: 'LDN 1: Bulto Cerrado (Directo)', color: '#334155', bgColor: '#f1f5f9', borderColor: '#cbd5e1' };
};

window.cargarCatalogoIngredientesMP = async function(q = '') {
    try {
        const url = q ? `/api/logistica/bunker/catalogo-ingredientes?q=${encodeURIComponent(q)}` : '/api/logistica/bunker/catalogo-ingredientes';
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            window.catalogoIngredientesMP = json.data;
            return json.data;
        }
        return [];
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error cargando catálogo de ingredientes MP:', e);
        return [];
    }
};

window.activarBuscadorMP = function(abrir) {
    const box = document.getElementById('receta_mp_buscador_box');
    const input = document.getElementById('receta_mp_buscar_input');
    if (!box) return;
    if (abrir) {
        box.style.display = 'block';
        if (input) {
            input.focus();
            if (input.value.trim() === '') {
                window.buscarMateriaPrimaEnVivo('');
            }
        }
    } else {
        box.style.display = 'none';
        const sug = document.getElementById('receta_mp_sugerencias');
        if (sug) sug.style.display = 'none';
    }
};

window.buscarMateriaPrimaEnVivo = async function(query) {
    const sug = document.getElementById('receta_mp_sugerencias');
    if (!sug) return;

    let items = [];
    if (window.catalogoIngredientesMP && window.catalogoIngredientesMP.length > 0 && (!query || query.length < 2)) {
        items = window.catalogoIngredientesMP.slice(0, 30);
    } else {
        items = await window.cargarCatalogoIngredientesMP(query);
    }

    if (!items || items.length === 0) {
        sug.innerHTML = '<div style="padding: 10px; color: #64748b; font-size: 0.85em; text-align: center;">No se encontraron materias primas</div>';
        sug.style.display = 'block';
        return;
    }

    sug.innerHTML = '';
    items.forEach(ing => {
        const row = document.createElement('div');
        row.style.cssText = 'padding: 8px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s; font-size: 0.88em;';
        row.onmouseover = () => { row.style.background = '#f0fdf4'; };
        row.onmouseout = () => { row.style.background = '#ffffff'; };
        
        const cPatron = parseFloat(ing.costo_patron || 0);
        row.innerHTML = `
            <div>
                <strong style="color: #0f172a;">${ing.nombre}</strong>
                <span style="font-size: 0.75em; color: #64748b; margin-left: 6px;">[#${ing.id}]</span>
            </div>
            <div style="font-weight: 700; color: #166534;">
                ${window.formatCurrencyARG(cPatron)} <span style="font-weight: normal; font-size: 0.8em; color: #64748b;">/${ing.unidad_medida || 'kg'}</span>
            </div>
        `;
        row.onclick = () => {
            window.seleccionarMateriaPrimaReceta(ing);
        };
        sug.appendChild(row);
    });
    sug.style.display = 'block';
};

window.seleccionarMateriaPrimaReceta = function(ing) {
    if (!ing) return;
    const cPatron = parseFloat(ing.costo_patron || 0);
    window.estadoRecetaArticulo.materiaPrima = {
        id: ing.id,
        nombre: ing.nombre,
        costo_kilo: cPatron
    };
    const idEl = document.getElementById('receta_ingrediente_id');
    if (idEl) idEl.value = ing.id;
    const nomEl = document.getElementById('receta_ingrediente_nombre');
    if (nomEl) {
        nomEl.innerText = ing.nombre;
        nomEl.title = ing.nombre;
    }
    const cLbl = document.getElementById('receta_mp_costo_kilo_lbl');
    if (cLbl) cLbl.innerText = window.formatCurrencyARG(cPatron);

    window.activarBuscadorMP(false);
    window.recalcularCostosReceta();
    window.aplicarCostoRecetaABaseYListas(false);
};

window.estadoRecetaArticulo = {
    activa: false,
    materiaPrima: null,   // { id, nombre, costo_kilo }
    packaging: null,      // { id, nombre, cantidad, costo_unitario }
    manoObra: null,       // { activa, colaborador_id, minutos, tarifa_hora }
    costoTiempo: 0
};
window.referenteTeniaReceta = false;

window.cargarCatalogoPackaging = async function() {
    try {
        const res = await fetch('/api/logistica/bunker/catalogo-empaque');
        const json = await res.json();
        const select = document.getElementById('receta_packaging_select');
        if (!select) return;

        if (json.success && Array.isArray(json.data)) {
            window.catalogoPackaging = json.data;
            select.innerHTML = '<option value="">(Sin packaging / A granel)</option>';
            json.data.forEach(item => {
                const costo = parseFloat(item.costo_patron || 0);
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.dataset.costo = costo;
                opt.dataset.unidad = item.unidad_medida || 'Unidades';
                opt.textContent = `${item.nombre} (${window.formatCurrencyARG(costo)})`;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error cargando catálogo de packaging:', e);
    }
};

window.cargarColaboradoresTarifas = async function() {
    try {
        const res = await fetch('/api/logistica/usuarios/tarifas');
        const json = await res.json();
        const select = document.getElementById('receta_mo_colaborador');
        if (!select) return;

        if (json.success && Array.isArray(json.data)) {
            window.catalogoColaboradores = json.data;
            select.innerHTML = '<option value="">Seleccione Colaborador / Tarifa...</option>';
            json.data.forEach(item => {
                const tarifa = parseFloat(item.valor_hora || 0);
                const opt = document.createElement('option');
                opt.value = item.usuario_id;
                opt.dataset.tarifa = tarifa;
                opt.textContent = `${item.nombre_completo || item.usuario} (${window.formatCurrencyARG(tarifa)}/h)`;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error cargando tarifas de colaboradores:', e);
    }
};

window.recalcularCostosReceta = function() {
    const chkActivar = document.getElementById('chk_activar_receta');
    const panel = document.getElementById('panel_receta_fraccionamiento');
    if (!panel || panel.style.display === 'none') return { subtotalMP: 0, subtotalPkg: 0, subtotalMO: 0, costoInsumosBulto: 0, totalBultoConMO: 0, costoKiloResultante: 0 };

    const activa = chkActivar ? chkActivar.checked : false;
    window.estadoRecetaArticulo.activa = activa;

    // 1. Kilos de Materia Prima
    const kilosInput = document.getElementById('kilos_unidad');
    const kilos = kilosInput ? (parseInputValue(kilosInput) || 0) : 0;
    const recetaKilosInput = document.getElementById('receta_ingrediente_kilos');
    if (recetaKilosInput) {
        recetaKilosInput.value = kilos > 0 ? kilos.toFixed(3) : '0.000';
    }

    const costoKiloMP = window.estadoRecetaArticulo?.materiaPrima?.costo_kilo || 0;
    const subtotalMP = costoKiloMP * kilos;
    const subtotalMpEl = document.getElementById('receta_subtotal_mp');
    if (subtotalMpEl) subtotalMpEl.innerText = window.formatCurrencyARG(subtotalMP);

    // 2. Packaging / Empaque
    const pkgSelect = document.getElementById('receta_packaging_select');
    let subtotalPkg = 0;
    if (pkgSelect && pkgSelect.value) {
        const opt = pkgSelect.options[pkgSelect.selectedIndex];
        const costoUnit = opt ? (parseFloat(opt.dataset.costo) || 0) : 0;
        const cantPkg = parseFloat(document.getElementById('receta_packaging_cant')?.value) || 0;
        subtotalPkg = costoUnit * cantPkg;
    }
    const subtotalPkgEl = document.getElementById('receta_subtotal_packaging');
    if (subtotalPkgEl) subtotalPkgEl.innerText = window.formatCurrencyARG(subtotalPkg);

    // 3. Mano de Obra
    const chkMO = document.getElementById('receta_mo_activa');
    const moActiva = chkMO ? chkMO.checked : true;
    const colabSelect = document.getElementById('receta_mo_colaborador');
    let subtotalMO = 0;
    if (moActiva && colabSelect && colabSelect.value) {
        const opt = colabSelect.options[colabSelect.selectedIndex];
        const tarifaHora = opt ? (parseFloat(opt.dataset.tarifa) || 0) : 0;
        const minutos = parseFloat(document.getElementById('receta_mo_minutos')?.value) || 0;
        if (tarifaHora > 0 && minutos > 0) {
            subtotalMO = (tarifaHora * minutos) / 60;
        }
    }
    const subtotalMoEl = document.getElementById('receta_subtotal_mo');
    if (subtotalMoEl) subtotalMoEl.innerText = window.formatCurrencyARG(subtotalMO);
    window.estadoRecetaArticulo.costoTiempo = subtotalMO;

    // 4. Totales y Ecuación
    const costoInsumosBulto = subtotalMP + subtotalPkg;
    const totalBultoConMO = costoInsumosBulto + subtotalMO;
    const costoKiloResultante = kilos > 0 ? (totalBultoConMO / kilos) : totalBultoConMO;

    const eqMpEl = document.getElementById('eq_mp_lbl');
    if (eqMpEl) eqMpEl.innerText = window.formatCurrencyARG(subtotalMP);
    const eqPkgEl = document.getElementById('eq_pkg_lbl');
    if (eqPkgEl) eqPkgEl.innerText = window.formatCurrencyARG(subtotalPkg);
    const eqMoEl = document.getElementById('eq_mo_lbl');
    if (eqMoEl) eqMoEl.innerText = window.formatCurrencyARG(subtotalMO);
    const eqTotalEl = document.getElementById('eq_total_bulto_lbl');
    if (eqTotalEl) eqTotalEl.innerText = window.formatCurrencyARG(totalBultoConMO);
    const eqKiloEl = document.getElementById('eq_costo_kilo_lbl');
    if (eqKiloEl) eqKiloEl.innerText = `${window.formatCurrencyARG(costoKiloResultante)} /kg`;

    return { subtotalMP, subtotalPkg, subtotalMO, costoInsumosBulto, totalBultoConMO, costoKiloResultante };
};

window.aplicarCostoRecetaABaseYListas = function(mostrarToast = false) {
    if (!window.estadoRecetaArticulo || !window.estadoRecetaArticulo.activa) return;

    const res = window.recalcularCostosReceta();
    const costoBaseInput = document.getElementById('costo_base');
    if (costoBaseInput) {
        costoBaseInput.value = res.costoInsumosBulto.toFixed(2);
        window.aplicarFormatoInputBlur(costoBaseInput);
    }

    if (typeof window.recalcularTodaLaGrilla === 'function') {
        window.recalcularTodaLaGrilla();
    }

    if (mostrarToast) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `Costo Bulto (${window.formatCurrencyARG(res.costoInsumosBulto)}) y MO (${window.formatCurrencyARG(res.subtotalMO)}) inyectados a listas.`,
            showConfirmButton: false,
            timer: 2200
        });
    }
};

window.inicializarEventosReceta = function() {
    const chkActivar = document.getElementById('chk_activar_receta');
    if (chkActivar) {
        chkActivar.addEventListener('change', () => {
            const cont = document.getElementById('receta_contenedor_campos');
            if (cont) cont.style.opacity = chkActivar.checked ? '1' : '0.4';
            window.estadoRecetaArticulo.activa = chkActivar.checked;

            const badgeLdn = document.getElementById('badge_receta_ldn');
            if (badgeLdn) {
                if (chkActivar.checked) {
                    badgeLdn.innerText = 'LDN 2: Fraccionado';
                    badgeLdn.style.background = '#dcfce7';
                    badgeLdn.style.color = '#15803d';
                    badgeLdn.style.borderColor = '#86efac';
                } else {
                    badgeLdn.innerText = 'Receta Desactivada (LDN 1)';
                    badgeLdn.style.background = '#f1f5f9';
                    badgeLdn.style.color = '#64748b';
                    badgeLdn.style.borderColor = '#cbd5e1';
                }
            }

            // Si se acaba de activar y no hay materia prima seleccionada, abrir buscador
            if (chkActivar.checked && (!window.estadoRecetaArticulo.materiaPrima || !window.estadoRecetaArticulo.materiaPrima.id)) {
                window.activarBuscadorMP(true);
            }

            window.recalcularCostosReceta();
            if (chkActivar.checked) {
                window.aplicarCostoRecetaABaseYListas(false);
            }
        });
    }

    // Cerrar sugerencias al hacer clic fuera
    document.addEventListener('click', (e) => {
        const box = document.getElementById('receta_mp_buscador_box');
        const sug = document.getElementById('receta_mp_sugerencias');
        const btnCambiar = document.getElementById('btn_cambiar_mp');
        if (box && sug && box.style.display !== 'none') {
            if (!box.contains(e.target) && (!btnCambiar || !btnCambiar.contains(e.target))) {
                window.activarBuscadorMP(false);
            }
        }
    });

    const pkgSelect = document.getElementById('receta_packaging_select');
    if (pkgSelect) {
        pkgSelect.addEventListener('change', () => {
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        });
    }

    const pkgCant = document.getElementById('receta_packaging_cant');
    if (pkgCant) {
        pkgCant.addEventListener('input', () => {
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        });
    }

    const chkMO = document.getElementById('receta_mo_activa');
    if (chkMO) {
        chkMO.addEventListener('change', () => {
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        });
    }

    const colabSelect = document.getElementById('receta_mo_colaborador');
    if (colabSelect) {
        colabSelect.addEventListener('change', () => {
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        });
    }

    const moMin = document.getElementById('receta_mo_minutos');
    if (moMin) {
        moMin.addEventListener('input', () => {
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        });
    }

    const btnAplicar = document.getElementById('btn_aplicar_costo_receta');
    if (btnAplicar) {
        btnAplicar.addEventListener('click', () => {
            window.aplicarCostoRecetaABaseYListas(true);
        });
    }

    // Reactividad desde el input de Kilos Unidad
    const kilosInput = document.getElementById('kilos_unidad');
    if (kilosInput) {
        kilosInput.addEventListener('input', () => {
            if (window.estadoRecetaArticulo && window.estadoRecetaArticulo.activa) {
                window.recalcularCostosReceta();
                window.aplicarCostoRecetaABaseYListas(false);
            }
        });
    }
};

window.hidratarRecetaArticulo = async function(articuloId, options = {}) {
    const esModoClon = options && options.esModoClon === true;
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articuloId)}`);
        const json = await res.json();
        if (!json.success || !json.data) return;

        const fin = json.data;
        const panel = document.getElementById('panel_receta_fraccionamiento');
        const chkActivar = document.getElementById('chk_activar_receta');
        const badgeOrigen = document.getElementById('badge_receta_origen');
        const badgeLdn = document.getElementById('badge_receta_ldn');
        const avisoLdn1 = document.getElementById('aviso_receta_ldn1_a_ldn2');
        const cont = document.getElementById('receta_contenedor_campos');

        const tieneReceta = fin.receta_id || (Array.isArray(fin.receta_ingredientes) && fin.receta_ingredientes.length > 0);

        if (tieneReceta && panel) {
            window.referenteTeniaReceta = true;
            window.estadoRecetaArticulo.activa = true;
            panel.style.display = 'block';
            if (cont) cont.style.opacity = '1';
            if (chkActivar) chkActivar.checked = true;
            if (avisoLdn1) avisoLdn1.style.display = 'none';

            if (badgeOrigen) {
                badgeOrigen.innerText = esModoClon ? `Heredada de Referente [${articuloId}]` : `Receta Activa #${fin.receta_id || 'Autónoma'}`;
            }
            if (badgeLdn) {
                badgeLdn.innerText = 'LDN 2: Fraccionado';
                badgeLdn.style.background = '#dcfce7';
                badgeLdn.style.color = '#15803d';
                badgeLdn.style.borderColor = '#86efac';
            }

            const ings = fin.receta_ingredientes || [];
            // Separar packaging vs materia prima
            const pkgIng = ings.find(i => (i.unidad_medida && i.unidad_medida.toLowerCase() === 'unidades') || /bolsa|caja/i.test(i.nombre_ingrediente));
            const mpIng = ings.find(i => i !== pkgIng) || ings[0];

            if (mpIng) {
                const cMP = parseFloat(mpIng.costo_patron || mpIng.costo_patron_directo || mpIng.costo_kilo_lote || 0);
                window.estadoRecetaArticulo.materiaPrima = {
                    id: mpIng.ingrediente_id,
                    nombre: mpIng.nombre_ingrediente,
                    costo_kilo: cMP
                };
                const idEl = document.getElementById('receta_ingrediente_id');
                if (idEl) idEl.value = mpIng.ingrediente_id;
                const nomEl = document.getElementById('receta_ingrediente_nombre');
                if (nomEl) {
                    nomEl.innerText = mpIng.nombre_ingrediente;
                    nomEl.title = mpIng.nombre_ingrediente;
                }
                const cLbl = document.getElementById('receta_mp_costo_kilo_lbl');
                if (cLbl) cLbl.innerText = window.formatCurrencyARG(cMP);
            }

            if (pkgIng) {
                const pkgSelect = document.getElementById('receta_packaging_select');
                if (pkgSelect) {
                    pkgSelect.value = String(pkgIng.ingrediente_id);
                    // Si no estaba en el select, agregarlo como opción
                    if (pkgSelect.value !== String(pkgIng.ingrediente_id)) {
                        const opt = document.createElement('option');
                        opt.value = pkgIng.ingrediente_id;
                        const cPkg = parseFloat(pkgIng.costo_patron || pkgIng.costo_patron_directo || 0);
                        opt.dataset.costo = cPkg;
                        opt.dataset.unidad = pkgIng.unidad_medida || 'Unidades';
                        opt.textContent = `${pkgIng.nombre_ingrediente} (${window.formatCurrencyARG(cPkg)})`;
                        pkgSelect.appendChild(opt);
                        pkgSelect.value = String(pkgIng.ingrediente_id);
                    }
                }
                const pkgCant = document.getElementById('receta_packaging_cant');
                if (pkgCant) {
                    pkgCant.value = parseFloat(pkgIng.cantidad) || 1;
                }
            }

            // Mano de obra
            const colabId = fin.propiedades_dinamicas?.asistente_colaborador_id || null;
            const minutos = parseFloat(fin.propiedades_dinamicas?.asistente_minutos) || 0;
            const colabSelect = document.getElementById('receta_mo_colaborador');
            if (colabSelect && colabId) {
                colabSelect.value = String(colabId);
            }
            const moMin = document.getElementById('receta_mo_minutos');
            if (moMin) {
                moMin.value = minutos;
            }
            const chkMO = document.getElementById('receta_mo_activa');
            if (chkMO) {
                chkMO.checked = minutos > 0;
            }

            // Recalcular y aplicar a Costo Base y Listas Comerciales
            window.recalcularCostosReceta();
            window.aplicarCostoRecetaABaseYListas(false);
        } else if (panel) {
            window.referenteTeniaReceta = false;
            window.estadoRecetaArticulo.activa = false;
            window.estadoRecetaArticulo.materiaPrima = null;

            if (esModoClon) {
                // MODO CLON DESDE LDN 1: Mostrar el panel disponible pero inactivo, listo para activar
                panel.style.display = 'block';
                if (cont) cont.style.opacity = '0.4';
                if (chkActivar) chkActivar.checked = false;

                if (badgeLdn) {
                    badgeLdn.innerText = 'LDN 1 (Bulto Referente)';
                    badgeLdn.style.background = '#f1f5f9';
                    badgeLdn.style.color = '#475569';
                    badgeLdn.style.borderColor = '#cbd5e1';
                }
                if (badgeOrigen) {
                    badgeOrigen.innerText = 'Sin Receta (Opcional crear LDN 2)';
                }
                if (avisoLdn1) avisoLdn1.style.display = 'block';

                // Limpiar campos de MP por defecto
                const idEl = document.getElementById('receta_ingrediente_id');
                if (idEl) idEl.value = '';
                const nomEl = document.getElementById('receta_ingrediente_nombre');
                if (nomEl) nomEl.innerText = 'Seleccione materia prima alimenticia...';
                const cLbl = document.getElementById('receta_mp_costo_kilo_lbl');
                if (cLbl) cLbl.innerText = '$0.00';
            } else {
                panel.style.display = 'none';
                if (chkActivar) chkActivar.checked = false;
                if (avisoLdn1) avisoLdn1.style.display = 'none';
            }
        }
    } catch (e) {
        console.warn('⚠️ [BUNKER] Error en hidratarRecetaArticulo:', e);
    }
};

window.recalcularTodaLaGrilla = function() {
    const inputsMargen = document.querySelectorAll('.input-margen-dinamico');
    inputsMargen.forEach(input => {
        recalcularFilaPorMargen(input.getAttribute('data-listaid'));
    });
};

window.recalcularFilaPorMargen = function(listaId) {
    const costoBase = parseInputValue(document.getElementById('costo_base')) || 0;
    const ivaPct = parseInputValue(document.getElementById('porcentaje_iva')) || 0;
    
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    if (!margenInput) return;
    
    let margen = parseInputValue(margenInput);

    if (isNaN(margen) || margen === 0) {
        document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
        const precioInput = document.getElementById(`precio_final_${listaId}`);
        if (precioInput) {
            precioInput.type = 'text';
            precioInput.value = '';
        }
        return;
    }

    const costoTiempo = (window.estadoRecetaArticulo && window.estadoRecetaArticulo.activa && window.estadoRecetaArticulo.costoTiempo) ? window.estadoRecetaArticulo.costoTiempo : 0;
    let precio_s_iva = (costoBase * (1 + (margen / 100))) + costoTiempo;
    let iibb = precio_s_iva * 0.04;
    let neta = precio_s_iva - costoBase - iibb;
    let precio_c_iva = precio_s_iva * (1 + (ivaPct / 100));

    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(precio_s_iva);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(iibb);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(neta);
    
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    if (precioInput) {
        precioInput.type = 'text';
        precioInput.value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(precio_c_iva);
    }
};

window.recalcularFilaPorPrecioFinal = function(listaId) {
    const costoBase = parseInputValue(document.getElementById('costo_base')) || 0;
    const ivaPct = parseInputValue(document.getElementById('porcentaje_iva')) || 0;
    
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    if (!precioInput) return;
    
    let precioFinal = parseInputValue(precioInput);
    
    if (isNaN(precioFinal) || precioFinal === 0) {
        document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
        const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
        if (margenInput) {
            margenInput.type = 'text';
            margenInput.value = '0,00';
        }
        return;
    }

    const costoTiempo = (window.estadoRecetaArticulo && window.estadoRecetaArticulo.activa && window.estadoRecetaArticulo.costoTiempo) ? window.estadoRecetaArticulo.costoTiempo : 0;
    let precio_s_iva = (precioFinal / (1 + (ivaPct / 100))) - costoTiempo;
    let iibb = (precio_s_iva + costoTiempo) * 0.04;
    let neta = (precio_s_iva + costoTiempo) - costoBase - iibb;

    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(precio_s_iva + costoTiempo);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(iibb);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(neta);
    
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    if (margenInput) {
        margenInput.type = 'text';
        if (costoBase <= 0) {
            margenInput.value = '0,00';
            return;
        }
        let nuevoMargen = ((precio_s_iva / costoBase) - 1) * 100;
        margenInput.value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(nuevoMargen);
    }
};

async function guardarArticuloBunker(event) {
    event.preventDefault();

    if (!dictLocal.principal) {
        Swal.fire('Atención', 'Debe seleccionar o ingresar un Artículo Principal válido.', 'warning');
        return;
    }

    const desc_abreviada = actualizarLivePreview();
    
    // Generar JSONB Propiedades Dinámicas con Estructura Posicional y Familia
    const famIdSelect = document.getElementById('bunker_familia_id');
    const famIdVal = famIdSelect ? parseInt(famIdSelect.value) || 6 : 6;
    const famNombreVal = famIdSelect && famIdSelect.selectedIndex >= 0 ? famIdSelect.options[famIdSelect.selectedIndex].text : 'General / Sin Clasificar';

    const posicionesObj = {};
    dictLocal.propiedades.forEach((p, idx) => {
        const valText = p.termino || p.valor;
        if (valText && p.categoria) {
            posicionesObj[`pos_${idx + 1}`] = {
                eje: p.categoria,
                valor: valText,
                abreviatura: p.abreviatura || valText,
                modo_display: p.modo_display || 'COMPLETO',
                silencioso: p.silencioso === true,
                posicion: idx + 1
            };
        }
    });

    const posFamSelect = document.getElementById('bunker_posicion_familia');
    const posFamVal = posFamSelect ? posFamSelect.value : 'ANTES';
    const modoFamSelect = document.getElementById('bunker_modo_familia');
    const modoFamVal = modoFamSelect ? modoFamSelect.value : 'COMPLETO';
    const abrevFamInput = document.getElementById('bunker_abrev_familia');
    const abrevFamVal = abrevFamInput ? abrevFamInput.value.trim().toUpperCase() : '';
    const isWIP = document.getElementById('presentacion_variable_wip') ? document.getElementById('presentacion_variable_wip').checked : false;
    const sufijoWIPVal = document.getElementById('sufijo_wip') ? document.getElementById('sufijo_wip').value.trim() : '';

    const terminoAnclaPrincipal = dictLocal.principal ? (dictLocal.principal.termino || '').trim() : '';

    const propsJSON = {
        articulo_principal: terminoAnclaPrincipal,
        familia_id: famIdVal,
        familia_nombre: famNombreVal.replace(/^🌳\s*/, ''),
        incluir_familia: window.incluirFamilia === true,
        posicion_familia: posFamVal,
        modo_display_familia: modoFamVal,
        abreviatura_familia: abrevFamVal || window.lastKnownAbreviaturaFamilia || '',
        silencioso_principal: dictLocal.principal ? (dictLocal.principal.silencioso === true) : false,
        modo_display_principal: dictLocal.principal ? (dictLocal.principal.modo_display || 'COMPLETO') : 'COMPLETO',
        posiciones: posicionesObj,
        presentacion_variable_wip: isWIP,
        sufijo_wip: isWIP ? (sufijoWIPVal || 'UP Variable') : null
    };

    const isCrearLocal = document.getElementById('chk_crear_local') ? document.getElementById('chk_crear_local').checked : false;

    let articulo_id = null;
    let codigo_barras = null;

    if (isCrearLocal) {
        const pivoteEl = document.getElementById('bunker_id_pivote');
        // Si el valor contiene placeholders, forzamos la pre-generación asíncrona de códigos y la esperamos
        if (pivoteEl && (pivoteEl.value.includes('Se generará') || pivoteEl.value.includes('Generado'))) {
            const idRes = await window.generarIdentidadLocalAsync();
            if (idRes && idRes.articulo_id) {
                articulo_id = idRes.articulo_id;
                codigo_barras = idRes.codigo_barras;
            }
        } else if (pivoteEl) {
            articulo_id = pivoteEl.value.trim();
            const barrasEl = document.getElementById('bunker_codigo_barras');
            codigo_barras = barrasEl ? barrasEl.value.trim() : articulo_id;
        }
    } else {
        const uiId = document.getElementById('bunker_id_pivote') ? document.getElementById('bunker_id_pivote').value.trim() : null;
        const uiBarras = document.getElementById('bunker_codigo_barras') ? document.getElementById('bunker_codigo_barras').value.trim() : null;
        if (uiId && !uiId.startsWith('Se generará') && !uiId.includes('Generado') && !uiId.startsWith('Seleccione')) {
            articulo_id = uiId;
        }
        if (uiBarras && !uiBarras.startsWith('Se generará') && !uiBarras.includes('Generado') && !uiBarras.startsWith('Seleccione')) {
            codigo_barras = uiBarras;
        }
    }

    if (!articulo_id && articuloConsolidadoSeleccionado) {
        articulo_id = articuloConsolidadoSeleccionado.id;
        codigo_barras = articuloConsolidadoSeleccionado.codigo_barras || articuloConsolidadoSeleccionado.id;
    }

    if (!isCrearLocal && (!articulo_id || articulo_id.startsWith('Seleccione') || articulo_id.startsWith('Se generará') || articulo_id.includes('Generado'))) {
        Swal.fire({
            icon: 'warning',
            title: 'Artículo Legacy no seleccionado',
            text: 'Ha desactivado "Crear en Local". Por favor, busque y seleccione un artículo en el buscador Legacy superior para vincularlo, o vuelva a activar "Crear en Local" para generar una nueva identidad.',
            confirmButtonColor: '#3085d6'
        });
        return;
    }

    const articuloData = {
        articulo_id,
        codigo_barras,
        familia_id: famIdVal,
        crear_local: isCrearLocal,
        descripcion: dictLocal.principal ? dictLocal.principal.termino : '',
        descripcion_abreviada: desc_abreviada,
        descripcion_legacy: (articuloConsolidadoSeleccionado && articuloConsolidadoSeleccionado.descripcion) 
            ? articuloConsolidadoSeleccionado.descripcion 
            : (document.getElementById('bunker_descripcion_legacy') ? document.getElementById('bunker_descripcion_legacy').value.trim() : null),
        propiedades_dinamicas: propsJSON,
        costo_base: parseInputValue(document.getElementById('costo_base')) || 0,
        porcentaje_iva: parseInputValue(document.getElementById('porcentaje_iva')) || 21,
        kilos_unidad: isWIP ? null : (parseInputValue(document.getElementById('kilos_unidad')) || 0),
        pack_unidades: parseInt(document.getElementById('cantidad_pack').value) || 1,
        expresado_en_gramos: isWIP ? false : (document.getElementById('expresar_gramos') ? document.getElementById('expresar_gramos').checked : false),
        expresado_en_unidades: isWIP ? false : (document.getElementById('expresar_unidades') ? document.getElementById('expresar_unidades').checked : false),
        moneda: document.getElementById('moneda').value,
        rubro: document.getElementById('rubro').value.trim(),
        sub_rubro: document.getElementById('sub_rubro').value.trim(),
        pack_hijo_codigo: document.getElementById('pack_hijo_codigo').value.trim(),
        no_producido_por_lambda: document.getElementById('no_producido_por_lambda').checked,
        solo_produccion_externa: isWIP,
        articulo_puente_codigo: isWIP && document.getElementById('articulo_puente_codigo') ? document.getElementById('articulo_puente_codigo').value.trim() : null,
        mantener_utilidad: document.getElementById('mantener_utilidad').checked
    };

    // 🥣 Gestión de Receta de Producción y Mano de Obra (Fase Clonación Integral)
    const panelReceta = document.getElementById('panel_receta_fraccionamiento');
    const isPanelRecetaVisible = panelReceta && panelReceta.style.display !== 'none';
    const chkReceta = document.getElementById('chk_activar_receta');
    if (isPanelRecetaVisible && chkReceta && chkReceta.checked) {
        if (!window.estadoRecetaArticulo || !window.estadoRecetaArticulo.materiaPrima || !window.estadoRecetaArticulo.materiaPrima.id) {
            Swal.fire({
                icon: 'warning',
                title: 'Materia Prima requerida',
                text: 'Ha activado la Receta de Fraccionamiento pero no ha seleccionado una Materia Prima. Por favor, busque y seleccione la Materia Prima en el panel de Receta antes de guardar.',
                confirmButtonColor: '#3085d6'
            });
            window.activarBuscadorMP(true);
            return;
        }
    }
    const isRecetaActiva = isPanelRecetaVisible && chkReceta && chkReceta.checked && window.estadoRecetaArticulo && window.estadoRecetaArticulo.activa;
    let recetaPayload = null;
    let asistenteMinutos = null;
    let asistenteColaboradorId = null;
    let costoTiempo = null;

    if (isRecetaActiva && window.estadoRecetaArticulo.materiaPrima) {
        // 🛡️ Blindaje Arquitectónico: Una fracción con receta NO es un Pack comercial
        articuloData.pack_hijo_codigo = null;
        
        // Garantizar que costo_base guardado en el Búnker y la grilla de precios reflejen con exactitud la fórmula del bulto
        const resRecetaCalculada = (typeof window.recalcularCostosReceta === 'function') ? window.recalcularCostosReceta() : null;
        if (resRecetaCalculada && resRecetaCalculada.costoInsumosBulto > 0) {
            articuloData.costo_base = resRecetaCalculada.costoInsumosBulto;
            const costoBaseInputEl = document.getElementById('costo_base');
            if (costoBaseInputEl) {
                costoBaseInputEl.value = resRecetaCalculada.costoInsumosBulto.toFixed(2);
                if (typeof window.aplicarFormatoInputBlur === 'function') window.aplicarFormatoInputBlur(costoBaseInputEl);
            }
            if (typeof window.recalcularTodaLaGrilla === 'function') {
                window.recalcularTodaLaGrilla();
            }
        }

        const kVal = parseInputValue(document.getElementById('kilos_unidad')) || 1;
        const ings = [{
            ingrediente_id: window.estadoRecetaArticulo.materiaPrima.id,
            nombre_ingrediente: window.estadoRecetaArticulo.materiaPrima.nombre,
            unidad_medida: 'Kilo',
            cantidad: kVal
        }];
        const pkgSelect = document.getElementById('receta_packaging_select');
        if (pkgSelect && pkgSelect.value) {
            const pkgOpt = pkgSelect.options[pkgSelect.selectedIndex];
            ings.push({
                ingrediente_id: parseInt(pkgSelect.value),
                nombre_ingrediente: pkgOpt.text.split(' ($')[0].trim(),
                unidad_medida: pkgOpt.dataset.unidad || 'Unidades',
                cantidad: parseFloat(document.getElementById('receta_packaging_cant').value) || 1
            });
        }
        recetaPayload = {
            activa: true,
            ingredientes: ings
        };
        asistenteMinutos = parseFloat(document.getElementById('receta_mo_minutos').value) || 0;
        const colabVal = document.getElementById('receta_mo_colaborador').value;
        asistenteColaboradorId = colabVal ? parseInt(colabVal) : null;
        costoTiempo = window.estadoRecetaArticulo.costoTiempo || 0;
    } else if (window.referenteTeniaReceta && (!chkReceta || !chkReceta.checked)) {
        recetaPayload = { activa: false, ingredientes: [] };
        asistenteMinutos = 0;
        asistenteColaboradorId = null;
        costoTiempo = 0;
    }

    if (recetaPayload) articuloData.receta = recetaPayload;
    if (asistenteMinutos !== null) articuloData.asistente_minutos = asistenteMinutos;
    if (asistenteColaboradorId !== null) articuloData.asistente_colaborador_id = asistenteColaboradorId;
    if (costoTiempo !== null) articuloData.costo_tiempo = costoTiempo;

    // Recolectar array de márgenes y precios finales
    const listasMargenes = [];
    const inputsMargen = document.querySelectorAll('.input-margen-dinamico');
    inputsMargen.forEach(input => {
        const listaId = parseInt(input.getAttribute('data-listaid'));
        const chk = document.querySelector(`input[name="listas_asignadas"][value="${listaId}"]`);
        const precioInput = document.getElementById(`precio_final_${listaId}`);
        const precioVal = precioInput ? parseInputValue(precioInput) : null;
        listasMargenes.push({
            lista_id: listaId,
            margen_porcentaje: parseInputValue(input) || 0,
            precio_final: precioVal && !isNaN(precioVal) ? precioVal : null,
            disponible: chk ? chk.checked : false
        });
    });

    if (window.articuloReferenteClonadoId) {
        articuloData.clonar_de_articulo_id = window.articuloReferenteClonadoId;
    }

    const payload = {
        articuloData,
        solo_taxonomia: false,
        listasMargenes,
        nuevos_terminos_diccionario: nuevosTerminosPendientes
    };

    try {
        Swal.fire({
            title: 'Validando Transacción Búnker...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const response = await fetch('/api/logistica/bunker/articulos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            console.log(`🚨 [VIGÍA DEPURADOR - AUDITORÍA F12] Guardado/Actualización de Artículo procesado exitosamente por la API. Atributos seleccionados auto-promovidos determinísticamente por IDs nativos a public.bunker_relacion_atributo_principal:`, result.data);
            
            let modalTitle = '';
            let modalHtml = '';
            let confirmText = '';
            
            if (window.articuloReferenteClonadoId) {
                // Escenario C: Variante clonada a imagen y semejanza
                modalTitle = '✨ Variante Clonada Creada';
                modalHtml = `
                    <p style="font-size: 1.1em; color: #1e293b;">El nuevo artículo ha sido creado exitosamente a imagen y semejanza de <strong>${window.articuloReferenteClonadoId}</strong>.</p>
                    <p style="color: #475569;">Nuevo Código Pivot: <strong style="font-family: monospace; font-size: 1.2em; color: #7c3aed; background: #ede9fe; padding: 2px 6px; border-radius: 4px;">${result.data.articulo_id}</strong> | EAN: <span style="font-family: monospace;">${result.data.codigo_barras}</span></p>
                    <div style="background-color: #f5f3ff; padding: 12px 15px; border-radius: 8px; border: 1px solid #c4b5fd; margin-top: 15px; text-align: left;">
                        <h4 style="margin: 0 0 6px 0; color: #6d28d9;">✔ Sincronización Integral Multiflujo</h4>
                        <ul style="margin: 0; padding-left: 20px; font-size: 0.88em; color: #5b21b6;">
                            <li>Taxonomía, plantilla posicional y familia asignadas.</li>
                            <li>Listas comerciales y márgenes de ganancia calculados.</li>
                            <li>Mapeos de reposición y recetas duplicadas (si correspondía).</li>
                            <li>Stock consolidado local inicializado en 0.</li>
                        </ul>
                    </div>
                `;
                confirmText = 'Continuar operando';
            } else if (articuloConsolidadoSeleccionado) {
                // Escenario A: Existente (Enriquecimiento)
                modalTitle = '✅ Artículo Enriquecido';
                modalHtml = `
                    <p style="font-size: 1.1em; color: #1e293b;">El artículo <strong>${result.data.articulo_id}</strong> ha sido enriquecido exitosamente.</p>
                    <p style="color: #475569;">La inteligencia financiera (Nomenclatura y JSONB) ha sido guardada en el Búnker sin alterar los sistemas legacy.</p>
                `;
                confirmText = 'Continuar operando';
            } else {
                // Escenario B: Nuevo desde cero
                modalTitle = '✅ Búnker Local Creado';
                modalHtml = `
                    <p style="font-size: 1.1em; color: #1e293b;">El artículo ha sido registrado satisfactoriamente en el ecosistema LAMDA Independiente.</p>
                    <div style="background-color: #fef9c3; padding: 15px; border-radius: 8px; border: 1px solid #fde047; margin-top: 20px; text-align: left;">
                        <h4 style="margin: 0 0 10px 0; color: #b45309;">⚠️ TAREA OBLIGATORIA (ESPEJO MANUAL)</h4>
                        <p style="margin: 0;">Paso Número 1 completado localmente. Su código pivot auto-generado es: <strong>${result.data.articulo_id}</strong><br><br>
                        Diríjase a Lomasoft <strong>AHORA MISMO</strong> y cree el artículo usando el Código exacto: <span style="font-family: monospace; font-size: 1.2em; background: #e2e8f0; padding: 2px 6px;">${result.data.articulo_id}</span> y el Código de Barras <span style="font-family: monospace; font-size: 1.2em; background: #e2e8f0; padding: 2px 6px;">${result.data.codigo_barras}</span>.<br><br>
                        Recuerde: Hasta que no se corra la sincronización final (Paso 3), el artículo no tendrá stock transaccional en el sistema LAMDA consolidado.</p>
                    </div>
                `;
                confirmText = 'Entendido. Proceder a Lomasoft.';
            }

            // Si es novedad local, inyectamos en el panel estático del tope y lo mostramos
            if (isCrearLocal) {
                document.getElementById('txt-generado-alfa').innerText = result.data.articulo_id;
                document.getElementById('txt-generado-barras').innerText = result.data.codigo_barras;
                document.getElementById('panel-codigos-generados').style.display = 'block';
                // Scroll suave al tope para visualización y copia inmediata
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }

            Swal.fire({
                icon: 'success',
                title: modalTitle,
                html: modalHtml,
                confirmButtonText: confirmText,
                confirmButtonColor: '#2c3e50',
                allowOutsideClick: false
            }).then(() => {
                // Limpiar formulario y resetear RAM
                document.getElementById('form-nuevo-articulo').reset();
                limpiarSeleccionConsolidado();
                window.limpiarReferente();
                document.getElementById('atributos-container').innerHTML = '';
                dictLocal = { principal: null, propiedades: [] };
                nuevosTerminosPendientes = [];
                actualizarLivePreview();
                recalcularTodaLaGrilla();

                // Asegurar que el switch de Crear en Local esté desactivado y la UI reestablecida
                const chk = document.getElementById('chk_crear_local');
                if (chk) {
                    chk.checked = false;
                    toggleCrearLocalMode(chk);
                }
            });
        } else {
            throw new Error(result.error || 'Falla desconocida en el servidor');
        }

    } catch (error) {
        console.error('Error guardando en Búnker:', error);
        Swal.fire({
            icon: 'error',
            title: 'Fallo Transaccional',
            text: error.message
        });
    }
}

/**
 * Control del modo de creación local (Sin Origen Legacy)
 */
window.toggleCrearLocalMode = async function(checkboxEl) {
    const isLocal = checkboxEl.checked;
    
    // El panel de enriquecimiento (color amarillo/naranja con borde eab308)
    const enrichmentPanel = document.getElementById('panel_enriquecimiento') || document.querySelector('.bunker-panel');

    const inputConsolidado = document.getElementById('buscador_consolidado');
    const pivoteEl = document.getElementById('bunker_id_pivote');
    const barrasEl = document.getElementById('bunker_codigo_barras');
    const descLegacyEl = document.getElementById('bunker_id_pivote_desc');
    const btnPregenerar = document.getElementById('btn_pregenerar_id');
    const costoBaseEl = document.getElementById('costo_base');
    
    if (isLocal) {
        // Limpiar selección previa
        limpiarSeleccionConsolidado();
        
        // Deshabilitar y opacar visualmente el panel de enriquecimiento
        if (enrichmentPanel) {
            enrichmentPanel.style.display = 'block';
            enrichmentPanel.style.opacity = '0.4';
            enrichmentPanel.style.pointerEvents = 'none';
        }
        if (inputConsolidado) {
            inputConsolidado.disabled = true;
        }
        
        // Indicar al operador que se autogenerarán con firma EMB- y 10 dígitos numéricos
        if (pivoteEl) pivoteEl.value = 'Se generará EMB-XXXXXX';
        if (barrasEl) barrasEl.value = 'Se generará de 10 dígitos';

        if (descLegacyEl) {
            if (window.articuloReferenteClonadoId) {
                descLegacyEl.innerText = `✨ Clonando estructura desde SKU [${window.articuloReferenteClonadoId}]`;
            } else {
                descLegacyEl.innerText = '';
            }
        }

        // Mostrar botón de pre-generación reactiva
        if (btnPregenerar) btnPregenerar.style.display = 'inline-block';

        // Hacer flexible la validación de costo base (Ajuste B)
        if (costoBaseEl) {
            costoBaseEl.removeAttribute('required');
        }

        // Mostrar y habilitar descripción legacy manual
        const groupDescLegacy = document.getElementById('group_descripcion_legacy');
        if (groupDescLegacy) groupDescLegacy.style.display = 'block';
        const inputDescLegacy = document.getElementById('bunker_descripcion_legacy');
        if (inputDescLegacy) {
            inputDescLegacy.disabled = false;
            inputDescLegacy.required = true;
        }

        // Si ya hay un Artículo Principal escrito, pre-generar de inmediato de forma reactiva (Ajuste A)
        const principalVal = document.getElementById('descripcion_principal') ? document.getElementById('descripcion_principal').value.trim() : '';
        if (principalVal) {
            await window.pregenerarCodigosLocal(true); // silencioso = true para no abrumar con toast
        }
    } else {
        // Restaurar panel de enriquecimiento
        if (enrichmentPanel) {
            enrichmentPanel.style.display = 'block';
            enrichmentPanel.style.opacity = '1';
            enrichmentPanel.style.pointerEvents = 'auto';
        }
        if (inputConsolidado) {
            inputConsolidado.disabled = false;
        }
        
        if (articuloConsolidadoSeleccionado) {
            if (pivoteEl) pivoteEl.value = articuloConsolidadoSeleccionado.id;
            if (barrasEl) barrasEl.value = articuloConsolidadoSeleccionado.codigo_barras || articuloConsolidadoSeleccionado.id;
            if (descLegacyEl) {
                descLegacyEl.innerText = window.articuloReferenteClonadoId 
                    ? `✨ Clonando desde [${window.articuloReferenteClonadoId}] | Vinculado a Legacy: [${articuloConsolidadoSeleccionado.id}] ${articuloConsolidadoSeleccionado.descripcion || ''}`
                    : `Legacy: ${articuloConsolidadoSeleccionado.descripcion || ''}`;
            }
        } else {
            if (pivoteEl) pivoteEl.value = window.articuloReferenteClonadoId ? 'Seleccione desde el buscador Legacy arriba' : 'Generado Automáticamente';
            if (barrasEl) barrasEl.value = window.articuloReferenteClonadoId ? 'Seleccione desde el buscador Legacy arriba' : 'Generado Automáticamente';
            if (descLegacyEl) {
                descLegacyEl.innerText = window.articuloReferenteClonadoId 
                    ? `✨ Clonando desde [${window.articuloReferenteClonadoId}] (Seleccione artículo Legacy arriba)`
                    : '';
            }
        }

        // Ocultar botón de pre-generación reactiva y panel estático
        if (btnPregenerar) btnPregenerar.style.display = 'none';
        window.cerrarPanelCodigos();

        // Restaurar campo requerido para costo base
        if (costoBaseEl) {
            costoBaseEl.setAttribute('required', 'required');
        }

        // Ocultar y deshabilitar descripción legacy manual
        const groupDescLegacy = document.getElementById('group_descripcion_legacy');
        if (groupDescLegacy) groupDescLegacy.style.display = 'none';
        const inputDescLegacy = document.getElementById('bunker_descripcion_legacy');
        if (inputDescLegacy) {
            inputDescLegacy.disabled = true;
            inputDescLegacy.required = false;
            inputDescLegacy.value = '';
        }
    }
};

/**
 * Evento click del botón secundario de pre-generación reactiva
 */
window.pregenerarIdentidadLocalClick = async function() {
    const principalVal = document.getElementById('descripcion_principal').value.trim();
    if (!principalVal) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            icon: 'warning',
            title: 'Debe escribir el Artículo Principal primero'
        });
        return;
    }
    await window.pregenerarCodigosLocal(false);
};

window.generarIdentidadLocalAsync = async function() {
    try {
        const res = await fetch('/api/logistica/bunker/generar-identidad-local');
        const result = await res.json();
        if (result.success && result.data) {
            return result.data;
        }
    } catch (e) {
        console.error('❌ [BUNKER] Error obteniendo identidad local asíncrona:', e);
    }
    return null;
};

/**
 * Invoca al backend de forma reactiva para aprovisionar los códigos en pantalla
 */
window.pregenerarCodigosLocal = function(silencioso = false) {
    pendingPregenerarPromise = new Promise(async (resolve, reject) => {
        try {
            const res = await fetch('/api/logistica/bunker/generar-identidad-local');
            const result = await res.json();
            if (result.success && result.data) {
                document.getElementById('bunker_id_pivote').value = result.data.articulo_id;
                document.getElementById('bunker_codigo_barras').value = result.data.codigo_barras;
                
                // Rellenar también el panel estático superior para que el operador pueda copiarlos
                document.getElementById('txt-generado-alfa').innerText = result.data.articulo_id;
                document.getElementById('txt-generado-barras').innerText = result.data.codigo_barras;
                document.getElementById('panel-codigos-generados').style.display = 'block';
                
                if (!silencioso) {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 2000,
                        icon: 'success',
                        title: 'Códigos pre-generados correctamente'
                    });
                }
                resolve(result.data);
            } else {
                resolve(null);
            }
        } catch (err) {
            console.error("❌ Error pre-generando códigos locales:", err);
            resolve(null);
        }
    });
    return pendingPregenerarPromise;
};

/**
 * Evento blur del Artículo Principal para pre-generar códigos automáticamente
 */
window.handleDescripcionPrincipalBlur = async function() {
    const isLocal = document.getElementById('chk_crear_local') ? document.getElementById('chk_crear_local').checked : false;
    const principalVal = document.getElementById('descripcion_principal').value.trim();
    const pivoteEl = document.getElementById('bunker_id_pivote');
    
    // Si es modo local, tiene Artículo Principal y no se han pre-generado aún los códigos (contiene placeholder)
    if (isLocal && principalVal && pivoteEl && pivoteEl.value.includes('Se generará')) {
        await window.pregenerarCodigosLocal(true);
    }
};

/**
 * Registrar un nuevo Artículo Principal en caliente
 */
window.crearNuevoArticuloPrincipalDesdeQuery = async function(query) {
    const pInput = document.getElementById('descripcion_principal_input');
    const pResultados = document.getElementById('descripcion_principal_resultados');
    const pHidden = document.getElementById('descripcion_principal');

    if (!pInput || !pHidden) return;

    if (Swal.isVisible()) Swal.close();

    const formHtml = `
        <div style="text-align: left; margin-bottom: 15px; font-family: inherit;">
            <label style="font-weight: bold; font-size: 13px; color: #475569;">Nombre Completo del Artículo Principal</label>
            <input id="swal-input-term-p" class="swal2-input" style="margin-top: 5px; width: 85%; box-sizing: border-box;" value="${query}" placeholder="Ej: Coco Rallado">
        </div>
        <div style="text-align: left; font-family: inherit;">
            <label style="font-weight: bold; font-size: 13px; color: #475569;">Abreviatura (en el nomenclador final)</label>
            <input id="swal-input-abrv-p" class="swal2-input" style="margin-top: 5px; width: 85%; box-sizing: border-box;" value="${query}" placeholder="Abreviatura o Nombre Completo">
            <small style="display: block; color: #64748b; margin-top: 4px; font-size: 0.82em; line-height: 1.4;">
                💡 Tip: Escriba el nombre completo si quiere que figure tal cual en la descripción final (ej: "Coco Rallado x 5kg").
            </small>
        </div>
    `;

    const { value: formValues } = await Swal.fire({
        title: 'Nuevo Artículo Principal',
        html: formHtml,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Registrar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const term = document.getElementById('swal-input-term-p').value.trim();
            const abrv = document.getElementById('swal-input-abrv-p').value.trim();
            if (!term || !abrv) {
                Swal.showValidationMessage('Ambos campos son obligatorios');
                return false;
            }
            return { term, abrv };
        }
    });

    if (formValues) {
        // Registrar en los términos pendientes para enviar al backend al guardar el artículo
        nuevosTerminosPendientes.push({
            termino: formValues.term,
            abreviatura: formValues.abrv,
            categoria: 'articulo_principal'
        });

        // Configurar en el store local y autocompletar el input
        pInput.value = formValues.term !== formValues.abrv ? `${formValues.term} [${formValues.abrv}]` : formValues.term;
        pHidden.value = formValues.term;
        asignarTerminoDict('descripcion_principal', formValues.term, formValues.abrv);
        
        if (pResultados) pResultados.style.display = 'none';
        
        if (typeof handleDescripcionPrincipalBlur === 'function') {
            await handleDescripcionPrincipalBlur();
        }
    }
};

/**
 * Utilidad ergonómica para copiar al portapapeles
 */
window.copiarAlPortapapeles = function(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        Swal.fire({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            icon: 'success',
            title: 'Copiado al portapapeles: ' + text
        });
    }).catch(err => {
        console.error('Error al copiar: ', err);
    });
};

/**
 * Cerrar visualmente el panel estático de códigos generados
 */
window.cargarFamiliasBunker = async function(selectValueToSet = null) {
    const selectFam = document.getElementById('bunker_familia_id');
    if (!selectFam) return;
    try {
        const res = await fetch('/api/logistica/bunker-diccionario/familias');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            const currentVal = selectValueToSet !== null ? String(selectValueToSet) : selectFam.value;
            selectFam.innerHTML = '';
            json.data.forEach(fam => {
                const opt = document.createElement('option');
                opt.value = String(fam.id);
                opt.text = fam.nombre;
                selectFam.appendChild(opt);
            });
            if (currentVal && Array.from(selectFam.options).some(o => o.value === currentVal)) {
                selectFam.value = currentVal;
            } else if (selectFam.options.length > 0) {
                selectFam.value = selectFam.options[0].value;
            }
        }
    } catch(err) {
        console.error('Error cargando familias en bunker.js:', err);
    }
};

window.principalesBunkerCache = [];

window.renderizarSelectorPrincipalBunker = function(lista = [], currentVal = '', autoSelectSingle = false) {
    const selectPrinc = document.getElementById('bunker_principal_id');
    if (!selectPrinc) return;

    selectPrinc.innerHTML = '<option value="">📦 Seleccione un Atributo Principal...</option>';

    let tienePrioritarios = false;
    let optGroupPrioritarios = document.createElement('optgroup');
    optGroupPrioritarios.label = '⭐ Vinculados a esta Familia (Nivel 2)';

    let optGroupOtros = document.createElement('optgroup');
    optGroupOtros.label = '── Resto del Diccionario Maestro ──';

    const seenTerms = new Set();
    const validOpts = [];

    lista.forEach(obj => {
        const termLower = (obj.termino || '').trim().toLowerCase();
        if (seenTerms.has(termLower)) return;
        seenTerms.add(termLower);

        const opt = document.createElement('option');
        opt.value = obj.id; // 🔑 Primary Key entera relacional
        opt.setAttribute('data-termino', obj.termino);
        opt.setAttribute('data-abrev', obj.abreviatura || obj.termino);

        if (obj.prioritario) {
            tienePrioritarios = true;
            opt.text = `⭐ ${obj.termino}`;
            opt.style.fontWeight = 'bold';
            opt.style.color = '#1e3a8a';
            optGroupPrioritarios.appendChild(opt);
        } else {
            opt.text = obj.termino;
            optGroupOtros.appendChild(opt);
        }
        validOpts.push(opt);
    });

    if (tienePrioritarios) {
        selectPrinc.appendChild(optGroupPrioritarios);
    }
    if (optGroupOtros.children.length > 0) {
        selectPrinc.appendChild(optGroupOtros);
    }

    const optNewPrincipal = document.createElement('option');
    optNewPrincipal.value = '__NUEVO_PRINCIPAL__';
    optNewPrincipal.text = '➕ [+] Buscar o crear nuevo artículo principal...';
    optNewPrincipal.style.fontWeight = 'bold';
    optNewPrincipal.style.color = '#1e3a8a';
    selectPrinc.appendChild(optNewPrincipal);

    let matchedOpt = Array.from(selectPrinc.options).find(o => String(o.value) === String(currentVal));
    if (!matchedOpt && currentVal) {
        matchedOpt = Array.from(selectPrinc.options).find(o => o.getAttribute('data-termino') === String(currentVal));
    }

    if (matchedOpt) {
        selectPrinc.value = matchedOpt.value;
    } else if (autoSelectSingle && validOpts.length === 1) {
        selectPrinc.value = validOpts[0].value;
    } else {
        selectPrinc.value = '';
    }
};

window.filtrarSelectorPrincipalBunker = async function(query) {
    const selectPrinc = document.getElementById('bunker_principal_id');
    if (!selectPrinc) return;
    const prevVal = selectPrinc.value;
    const tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const baseList = Array.isArray(window.principalesBunkerCache) ? window.principalesBunkerCache : [];

    const filtered = tokens.length === 0
        ? baseList
        : baseList.filter(obj => {
            const bag = `${obj.termino || ''} ${obj.abreviatura || ''}`.toLowerCase();
            return tokens.every(tk => bag.includes(tk));
        });

    window.renderizarSelectorPrincipalBunker(filtered, prevVal, tokens.length > 0);
    if (selectPrinc.value !== prevVal && selectPrinc.value && selectPrinc.value !== '__NUEVO_PRINCIPAL__') {
        await window.cambiarPrincipalArticulo(selectPrinc.value);
    }
};

window.cargarPrincipalesBunker = async function(familiaId = null, selectValToSet = null) {
    const selectPrinc = document.getElementById('bunker_principal_id');
    if (!selectPrinc) return;
    try {
        const buscadorInput = document.getElementById('buscador_principal_bunker');
        if (buscadorInput) buscadorInput.value = '';

        const famIdNum = familiaId || (document.getElementById('bunker_familia_id') ? document.getElementById('bunker_familia_id').value : null);
        const queryFam = famIdNum ? `?familia_id=${encodeURIComponent(famIdNum)}` : '';
        const res = await fetch(`/api/logistica/bunker-diccionario/principales${queryFam}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            window.principalesBunkerCache = json.data;
            const currentVal = selectValToSet !== null ? String(selectValToSet) : selectPrinc.value;
            window.renderizarSelectorPrincipalBunker(json.data, currentVal, false);
            await window.cambiarPrincipalArticulo(selectPrinc.value);
        }
    } catch(err) {
        console.error('Error cargando principales en bunker.js:', err);
    }
};

window.cambiarPrincipalArticulo = async function(val) {
    if (val === '__NUEVO_PRINCIPAL__') {
        const selectPrinc = document.getElementById('bunker_principal_id');
        if (selectPrinc) selectPrinc.value = '';
        window.crearNuevoArticuloPrincipalModal();
        return;
    }

    const selectPrinc = document.getElementById('bunker_principal_id');
    const selectedOpt = selectPrinc ? selectPrinc.options[selectPrinc.selectedIndex] : null;

    let idNum = parseInt(val) || null;
    let termino = '';
    let abreviatura = '';

    if (idNum && selectedOpt && String(selectedOpt.value) === String(idNum)) {
        termino = selectedOpt.getAttribute('data-termino') || selectedOpt.text.replace(/^⭐\s*/, '');
        abreviatura = selectedOpt.getAttribute('data-abrev') || termino;
    } else if (val) {
        try {
            const res = await fetch('/api/logistica/bunker-diccionario/principales');
            const json = await res.json();
            const list = json.success && Array.isArray(json.data) ? json.data : [];
            const found = list.find(p => String(p.id) === String(val) || p.termino === val);
            if (found) {
                idNum = found.id;
                termino = found.termino;
                abreviatura = found.abreviatura || found.termino;
            }
        } catch(e) {}
    }

    const pHidden = document.getElementById('descripcion_principal');
    const pInput = document.getElementById('descripcion_principal_input');
    if (pHidden) pHidden.value = termino;
    if (pInput) pInput.value = termino;

    if (idNum || termino) {
        const prevSilencioso = dictLocal.principal ? (dictLocal.principal.silencioso === true) : false;
        const prevModo = dictLocal.principal ? (dictLocal.principal.modo_display || 'COMPLETO') : (window.modoDisplayPrincipal || 'COMPLETO');
        dictLocal.principal = {
            id: idNum,
            termino,
            abreviatura,
            silencioso: prevSilencioso,
            modo_display: prevModo
        };
    } else {
        dictLocal.principal = null;
    }

    // Invocar la plantilla relacional por IDs al cambiar de Artículo Principal en Modo Alta
    if (typeof window.obtenerPlantillaParaArticulo === 'function' && termino) {
        await window.obtenerPlantillaParaArticulo(termino, false);
    }

    if (typeof window.actualizarDescripcionGenerada === 'function') {
        window.actualizarDescripcionGenerada();
    } else if (typeof actualizarLivePreview === 'function') {
        actualizarLivePreview();
    }
};

window.editarArticuloPrincipalModalBunker = async function() {
    const famSelect = document.getElementById('bunker_familia_id');
    const famId = famSelect ? famSelect.value : null;

    const selectPrinc = document.getElementById('bunker_principal_id');
    const terminoVal = selectPrinc ? selectPrinc.value : '';

    if (!terminoVal || terminoVal === '__NUEVO_PRINCIPAL__') {
        Swal.fire('Atención', 'Debe seleccionar un Atributo Principal activo para editarlo.', 'warning');
        return;
    }

    try {
        const resDict = await fetch('/api/logistica/bunker-diccionario/principales');
        const jsonDict = await resDict.json();
        const listDict = jsonDict.success && Array.isArray(jsonDict.data) ? jsonDict.data : [];
        const termObj = listDict.find(p => String(p.id) === String(terminoVal) || p.termino === terminoVal);

        if (!termObj) {
            Swal.fire('Error', 'No se encontraron los datos del Atributo Principal seleccionado.', 'error');
            return;
        }

        const { value: formValues } = await Swal.fire({
            title: '✏️ Editar Atributo Principal (Nivel 2)',
            html: `
                <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                    <label style="font-weight:bold; font-size:0.9em; color:#1e3a8a;">Nombre del Atributo Principal (*):</label>
                    <input id="swal-princ-edit-nombre-bunker" class="swal2-input" style="margin:0;" value="${termObj.termino}">
                    
                    <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión (*):</label>
                    <input id="swal-princ-edit-abrev-bunker" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${termObj.abreviatura || ''}">
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Cambios',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const termino = document.getElementById('swal-princ-edit-nombre-bunker').value.trim();
                const abreviatura = document.getElementById('swal-princ-edit-abrev-bunker').value.trim().toUpperCase();

                if (!termino || !abreviatura) {
                    Swal.showValidationMessage('El nombre y la abreviatura son obligatorios.');
                    return false;
                }
                return { termino, abreviatura };
            }
        });

        if (formValues) {
            Swal.fire({ title: 'Actualizando atributo...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-diccionario/${termObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    termino: formValues.termino,
                    abreviatura: formValues.abreviatura,
                    categoria: 'general'
                })
            });
            const json = await res.json();
            if (json.success && json.data) {
                await Swal.fire({
                    title: 'Atributo Actualizado',
                    text: `El atributo "${json.data.termino}" fue actualizado exitosamente.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });

                await window.cargarPrincipalesBunker(famId, json.data.id || json.data.termino);
            } else {
                Swal.fire('Error', json.error || 'No se pudo actualizar el atributo principal.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al actualizar el atributo principal.', 'error');
    }
};

window.crearNuevaFamiliaModal = async function() {
    const { value: formValues } = await Swal.fire({
        title: '🌳 Alta de Nueva Familia (Nivel 1)',
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; color:#166534; font-size:0.9em;">Nombre de la Familia *</label>
                <input id="swal-fam-nombre-bunker" class="swal2-input" style="margin:0;" placeholder="Ej: Especias y Condimentos">
                <label style="font-weight:bold; color:#475569; font-size:0.9em;">Código de Familia (Opcional - Se auto-generará si se deja en blanco)</label>
                <input id="swal-fam-codigo-bunker" class="swal2-input" style="margin:0; text-transform:uppercase;" placeholder="Auto-generado (ej: FAM-ESPECIAS)">
                <small style="color:#64748b; font-size:0.8em;">Deje el código en blanco para que el servidor lo genere automáticamente.</small>
                <label style="font-weight:bold; color:#475569; font-size:0.9em;">Descripción (Opcional)</label>
                <input id="swal-fam-desc-bunker" class="swal2-input" style="margin:0;" placeholder="Ej: Orégano, pimentón, comino y derivados">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Crear Familia',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const nombre = document.getElementById('swal-fam-nombre-bunker').value.trim();
            if (!nombre) {
                Swal.showValidationMessage('El nombre de la familia es obligatorio');
                return false;
            }
            return {
                nombre,
                codigo_familia: document.getElementById('swal-fam-codigo-bunker').value.trim().toUpperCase(),
                descripcion: document.getElementById('swal-fam-desc-bunker').value.trim()
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Creando nueva familia...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-taxonomia/familias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                Swal.fire('Familia Creada', `Familia "${json.data.nombre}" creada con código "${json.data.codigo_familia}".`, 'success');
                // Actualizar desplegable dinámico de familias en bunker.html
                await window.cargarFamiliasBunker(json.data.id);
                if (typeof window.cambiarFamiliaArticulo === 'function') {
                    await window.cambiarFamiliaArticulo(json.data.id);
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo crear la familia.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al crear la familia.', 'error');
        }
    }
};

window.editarFamiliaModalBunker = async function() {
    const selectFam = document.getElementById('bunker_familia_id');
    const famId = selectFam ? selectFam.value : null;

    if (!famId) {
        Swal.fire('Atención', 'Debe seleccionar una Familia de Producto para modificarla.', 'warning');
        return;
    }

    try {
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        const familiasList = jsonFam.success && Array.isArray(jsonFam.data) ? jsonFam.data : [];
        const famObj = familiasList.find(f => String(f.id) === String(famId));

        if (!famObj) {
            Swal.fire('Error', 'No se encontraron los datos de la familia seleccionada.', 'error');
            return;
        }

        const { value: formValues } = await Swal.fire({
            title: '✏️ Editar Familia de Producto',
            html: `
                <div style="text-align: left; font-size: 0.9em;">
                    <label style="font-weight: bold; display: block; margin-top: 8px;">Nombre de la Familia (*):</label>
                    <input id="swal-fam-edit-nombre-bunker" class="swal2-input" value="${famObj.nombre || ''}" style="margin: 4px 0 10px 0; width: 100%;">
                    
                    <label style="font-weight: bold; display: block; margin-top: 8px;">Código de Familia (estandarizado):</label>
                    <input id="swal-fam-edit-codigo-bunker" class="swal2-input" value="${famObj.codigo_familia || ''}" style="margin: 4px 0 10px 0; width: 100%;">
                    
                    <label style="font-weight: bold; display: block; margin-top: 8px;">Descripción:</label>
                    <textarea id="swal-fam-edit-desc-bunker" class="swal2-textarea" style="margin: 4px 0 10px 0; width: 100%; height: 60px;">${famObj.descripcion || ''}</textarea>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Cambios',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const nombre = document.getElementById('swal-fam-edit-nombre-bunker').value.trim();
                const codigo_familia = document.getElementById('swal-fam-edit-codigo-bunker').value.trim();
                const descripcion = document.getElementById('swal-fam-edit-desc-bunker').value.trim();

                if (!nombre) {
                    Swal.showValidationMessage('El nombre de la familia es obligatorio.');
                    return false;
                }
                return { nombre, codigo_familia, descripcion };
            }
        });

        if (formValues) {
            Swal.fire({ title: 'Guardando cambios...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                await Swal.fire({
                    title: 'Familia Actualizada',
                    text: `La familia "${json.data.nombre}" fue actualizada exitosamente.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                });

                await window.cargarFamiliasBunker(famId);
                if (typeof window.cambiarFamiliaArticulo === 'function') {
                    await window.cambiarFamiliaArticulo(famId);
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo actualizar la familia.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al actualizar la familia.', 'error');
    }
};

window.eliminarFamiliaModalBunker = async function() {
    const selectFam = document.getElementById('bunker_familia_id');
    const famId = selectFam ? selectFam.value : null;

    if (!famId) {
        Swal.fire('Atención', 'Debe seleccionar una Familia de Producto para eliminarla.', 'warning');
        return;
    }

    try {
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        const familiasList = jsonFam.success && Array.isArray(jsonFam.data) ? jsonFam.data : [];
        const famObj = familiasList.find(f => String(f.id) === String(famId));
        const famNombre = famObj ? famObj.nombre : 'la familia seleccionada';

        const result = await Swal.fire({
            title: '¿Eliminar Familia de Producto?',
            html: `
                <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                    <p>Se intentará eliminar la familia maestra <strong>"${famNombre}"</strong>.</p>
                    <div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:6px; padding:10px; margin-top:10px; color:#92400e;">
                        <strong>🛡️ Barrera de Seguridad:</strong> Si la familia posee Atributos Principales o artículos asignados, la eliminación será <strong>bloqueada automáticamente</strong> por el sistema para proteger los datos.
                    </div>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: '🗑️ Sí, Eliminar Familia',
            cancelButtonText: 'Cancelar'
        });

        if (result.isConfirmed) {
            Swal.fire({ title: 'Verificando dependencias y eliminando...', didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}`, {
                method: 'DELETE'
            });
            const json = await res.json();

            if (json.success) {
                await Swal.fire('Familia Eliminada', json.message, 'success');
                await window.cargarFamiliasBunker();
                if (selectFam && selectFam.options.length > 0) {
                    if (typeof window.cambiarFamiliaArticulo === 'function') {
                        await window.cambiarFamiliaArticulo(selectFam.value);
                    }
                }
            } else if (res.status === 409 || (json.detalles)) {
                const det = json.detalles || {};
                const result409 = await Swal.fire({
                    title: '🛑 Bloqueo de Seguridad Relacional',
                    html: `
                        <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                            <p style="color:#dc2626; font-weight:bold;">${json.error}</p>
                            <ul style="margin-top:8px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:12px 20px; color:#991b1b;">
                                <li><strong>Atributos Principales (Nivel 2) asociados:</strong> ${det.atributos_principales_vinculados || 0}</li>
                                <li><strong>Artículos (SKUs) asociados:</strong> ${det.articulos_vinculados || 0}</li>
                            </ul>
                            <p style="margin-top:10px; font-size:0.9em; color:#1e3a8a;">¿Desea transferir masivamente todos los SKUs a otra familia y eliminar esta familia residual?</p>
                        </div>
                    `,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#2563eb',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: '🔄 Reasignar SKUs y Eliminar',
                    cancelButtonText: 'Cancelar'
                });

                if (result409.isConfirmed) {
                    await window.mostrarModalReasignacionYBajaFamilia(famId, famNombre, det);
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo eliminar la familia.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al intentar eliminar la familia.', 'error');
    }
};

window.mostrarModalReasignacionYBajaFamilia = async function(famId, famNombre, detalles) {
    try {
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        const otrasFamilias = jsonFam.success && Array.isArray(jsonFam.data) 
            ? jsonFam.data.filter(f => String(f.id) !== String(famId))
            : [];

        if (otrasFamilias.length === 0) {
            Swal.fire('Bloqueo Absoluto', 'No hay otras familias registradas en la base de datos a las cuales transferir las dependencias.', 'warning');
            return;
        }

        let optionsHTML = otrasFamilias.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');

        const { value: destinoId } = await Swal.fire({
            title: '🔄 Reasignación Masiva y Baja de Familia',
            html: `
                <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                    <p style="color:#dc2626; font-weight:bold; margin-bottom:8px;">La familia "${famNombre}" posee dependencias activas:</p>
                    <ul style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px 20px; margin-bottom:12px; color:#991b1b;">
                        <li><strong>SKUs / Artículos a reasignar:</strong> ${detalles.articulos_vinculados || 0}</li>
                        <li><strong>Atributos Principales (Nivel 2) a reasignar:</strong> ${detalles.atributos_principales_vinculados || 0}</li>
                    </ul>
                    <label style="font-weight:bold; display:block; margin-bottom:4px; color:#1e3a8a;">Seleccione la Familia de Destino (*):</label>
                    <select id="swal-fam-destino-reasignar" class="swal2-select" style="width:100%; margin:0; padding:8px; font-weight:bold; border-color:#cbd5e1;">
                        ${optionsHTML}
                    </select>
                    <p style="margin-top:10px; font-size:0.8em; color:#64748b;">Todos los SKUs y relaciones de Nivel 2 serán transferidos atómicamente a la familia seleccionada y luego se eliminará la familia de origen.</p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#64748b',
            confirmButtonText: '🔄 Reasignar Dependencias y Eliminar',
            cancelButtonText: 'Cancelar',
            focusConfirm: false,
            preConfirm: () => {
                const selectDestino = document.getElementById('swal-fam-destino-reasignar');
                const val = selectDestino ? selectDestino.value : null;
                if (!val) {
                    Swal.showValidationMessage('Debe seleccionar una familia de destino.');
                    return false;
                }
                return val;
            }
        });

        if (destinoId) {
            Swal.fire({ title: 'Reasignando dependencias y eliminando familia...', didOpen: () => Swal.showLoading() });
            const resReasig = await fetch(`/api/logistica/bunker-taxonomia/familias/${famId}/reasignar-y-eliminar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familia_destino_id: parseInt(destinoId) })
            });
            const jsonReasig = await resReasig.json();
            if (jsonReasig.success) {
                await Swal.fire({
                    title: 'Reasignación y Baja Completada',
                    text: jsonReasig.message,
                    icon: 'success'
                });
                if (typeof window.cargarFamiliasBunker === 'function') {
                    await window.cargarFamiliasBunker();
                } else if (typeof window.cargarFamilias === 'function') {
                    await window.cargarFamilias();
                }
                const selectFam = document.getElementById('bunker_familia_id') || document.getElementById('filtro-familia');
                if (selectFam && selectFam.options.length > 0) {
                    selectFam.value = selectFam.options[0].value;
                    if (typeof window.cambiarFamiliaArticulo === 'function') {
                        await window.cambiarFamiliaArticulo(selectFam.value);
                    }
                }
            } else {
                Swal.fire('Error', jsonReasig.error || 'No se pudo realizar la reasignación masiva.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al ejecutar reasignación masiva: ' + e.message, 'error');
    }
};

window.crearNuevoArticuloPrincipalModal = async function() {
    const famSelect = document.getElementById('bunker_familia_id');
    const famId = famSelect ? famSelect.value : 1;

    const { value: formValues } = await Swal.fire({
        title: '📦 Vincular / Alta de Artículo Principal (Nivel 2)',
        html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; color:#1e3a8a; font-size:0.9em;">🔍 Buscador Vivo de Diccionario Maestro (Fase 49)</label>
                <input id="swal-princ-search-bunker" class="swal2-input" style="margin:0;" placeholder="Buscar término existente (ej: Aceite de coco, Nuez...)" autocomplete="off">
                <div id="swal-princ-results-bunker" style="display:none; max-height:140px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:4px;"></div>
                <div style="border-top:1px dashed #cbd5e1; margin-top:4px; padding-top:8px; display:flex; flex-direction:column; gap:8px;">
                    <label style="font-weight:bold; color:#1e293b; font-size:0.9em;">Nombre del Atributo Principal *</label>
                    <input id="swal-princ-nombre-bunker" class="swal2-input" style="margin:0;" placeholder="Seleccione un resultado o escriba uno nuevo...">
                    <label style="font-weight:bold; color:#475569; font-size:0.9em;">Abreviatura de Impresión</label>
                    <input id="swal-princ-abrev-bunker" class="swal2-input" style="margin:0; text-transform:uppercase;" placeholder="Abreviatura (ej: ORE, PIM, ACE...)">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Vincular a la Familia',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => {
            const inputSearch = document.getElementById('swal-princ-search-bunker');
            const divResults = document.getElementById('swal-princ-results-bunker');
            const inputNombre = document.getElementById('swal-princ-nombre-bunker');
            const inputAbrev = document.getElementById('swal-princ-abrev-bunker');
            let timer = null;

            if (inputSearch && divResults) {
                inputSearch.addEventListener('input', () => {
                    clearTimeout(timer);
                    const q = inputSearch.value.trim();
                    if (q.length < 2) {
                        divResults.style.display = 'none';
                        return;
                    }
                    timer = setTimeout(async () => {
                        try {
                            const res = await fetch(`/api/logistica/bunker/diccionario?q=${encodeURIComponent(q)}&categoria=articulo_principal`);
                            const json = await res.json();
                            divResults.innerHTML = '';
                            const filteredData = (json.success && Array.isArray(json.data)) 
                                ? json.data.filter(item => !item.categoria || item.categoria === 'articulo_principal' || item.categoria === 'general')
                                : [];

                            if (filteredData.length > 0) {
                                divResults.style.display = 'block';
                                filteredData.forEach(item => {
                                    const row = document.createElement('div');
                                    row.style.padding = '8px 10px';
                                    row.style.cursor = 'pointer';
                                    row.style.borderBottom = '1px solid #e2e8f0';
                                    row.style.display = 'flex';
                                    row.style.justifyContent = 'space-between';
                                    row.style.fontSize = '0.9em';
                                    row.innerHTML = `<strong>${item.termino}</strong> <span style="color:#64748b;">[${item.abreviatura || item.termino}]</span>`;
                                    row.onclick = () => {
                                        inputNombre.value = item.termino;
                                        inputAbrev.value = item.abreviatura || item.termino.substring(0, 5).toUpperCase();
                                        divResults.style.display = 'none';
                                    };
                                    divResults.appendChild(row);
                                });
                            } else {
                                divResults.style.display = 'block';
                                divResults.innerHTML = `<div style="padding:8px; color:#64748b; font-size:0.85em; text-align:center;">No hay coincidencias en la BD. Puede registrarlo abajo como nuevo.</div>`;
                            }
                        } catch(e) {
                            console.error('Error buscando en modal:', e);
                        }
                    }, 250);
                });
            }
        },
        preConfirm: () => {
            const termino = document.getElementById('swal-princ-nombre-bunker').value.trim();
            if (!termino) {
                Swal.showValidationMessage('El nombre del Artículo Principal es obligatorio');
                return false;
            }
            return {
                familia_id: famId ? parseInt(famId) : null,
                termino,
                abreviatura: document.getElementById('swal-princ-abrev-bunker').value.trim().toUpperCase()
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({ title: 'Vinculando artículo principal...', didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if (json.success && json.data) {
                Swal.fire('Artículo Principal Vinculado', json.message, 'success');
                const termVinculado = json.data.termino;
                const rawId = json.data ? (json.data.id || json.data.termino_id) : null;
                const termId = rawId ? parseInt(rawId, 10) : NaN;
                const targetVal = (!isNaN(termId) && termId > 0) ? String(termId) : termVinculado;
                await window.cargarPrincipalesBunker(famId, targetVal);
            } else {
                Swal.fire('Error', json.error || 'No se pudo vincular el artículo principal.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al vincular el artículo principal.', 'error');
        }
    }
};

window.desvincularArticuloPrincipalModalBunker = async function() {
    const famSelect = document.getElementById('bunker_familia_id');
    const famId = famSelect ? famSelect.value : null;

    const selectPrinc = document.getElementById('bunker_principal_id');
    const selectedOpt = selectPrinc && selectPrinc.selectedIndex >= 0 ? selectPrinc.options[selectPrinc.selectedIndex] : null;
    const pInput = document.getElementById('descripcion_principal_input');
    const pHidden = document.getElementById('descripcion_principal');

    const rawSelectVal = selectPrinc ? selectPrinc.value : '';
    const terminoVal = (selectedOpt && selectedOpt.getAttribute('data-termino'))
        ? selectedOpt.getAttribute('data-termino')
        : ((pHidden && pHidden.value) ? pHidden.value : (pInput ? pInput.value.replace(/\s*\[.*\]$/, '').trim() : ''));

    if (!terminoVal && (!rawSelectVal || rawSelectVal === '__NUEVO_PRINCIPAL__')) {
        Swal.fire('Atención', 'Debe seleccionar un Atributo Principal activo para desvincularlo de la familia.', 'warning');
        return;
    }

    try {
        const resFam = await fetch('/api/logistica/bunker-diccionario/familias');
        const jsonFam = await resFam.json();
        const familiasList = jsonFam.success && Array.isArray(jsonFam.data) ? jsonFam.data : [];
        const famObj = familiasList.find(f => String(f.id) === String(famId));
        const famNombre = famObj ? famObj.nombre : 'la familia seleccionada';

        const result = await Swal.fire({
            title: '¿Desvincular Atributo Principal (Nivel 2)?',
            html: `
                <div style="text-align:left; font-size:0.95em; color:#1e293b;">
                    <p>Se desvinculará el término <strong>"${terminoVal || rawSelectVal}"</strong> de la familia <strong>"${famNombre}"</strong>.</p>
                    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px; margin-top:10px; color:#991b1b;">
                        <strong>🛡️ Garantía de Seguridad:</strong> Esta acción elimina únicamente la relación de co-ocurrencia con esta familia. El término <strong>PERMANECERÁ INTACTO</strong> en el diccionario maestro global.
                    </div>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: '🔗❌ Sí, Desvincular de la Familia',
            cancelButtonText: 'Cancelar'
        });

        if (result.isConfirmed) {
            Swal.fire({ title: 'Desvinculando atributo de la familia...', didOpen: () => Swal.showLoading() });

            // Buscar ID de término en el diccionario maestro
            const resDict = await fetch('/api/logistica/bunker-diccionario/principales');
            const jsonDict = await resDict.json();
            const listDict = jsonDict.success && Array.isArray(jsonDict.data) ? jsonDict.data : [];
            const termObj = listDict.find(p => String(p.id) === String(rawSelectVal) || p.termino === terminoVal);
            const termId = termObj ? termObj.id : (parseInt(rawSelectVal) || null);
            const termName = termObj ? termObj.termino : terminoVal;

            const res = await fetch('/api/logistica/bunker-diccionario/articulos-principales/desvincular', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    familia_id: famId ? parseInt(famId) : null, 
                    termino: termName,
                    articulo_principal_id: termId
                })
            });
            const json = await res.json();
            if (json.success) {
                await Swal.fire('Atributo Desvinculado', json.message, 'success');
                if (pInput) pInput.value = '';
                if (pHidden) pHidden.value = '';
                if (selectPrinc) selectPrinc.value = '';
                if (typeof window.cambiarFamiliaArticulo === 'function') {
                    await window.cambiarFamiliaArticulo(famId);
                }
            } else {
                Swal.fire('Error', json.error || 'No se pudo desvincular el artículo principal.', 'error');
            }
        }
    } catch(e) {
        Swal.fire('Error', 'Fallo de red al desvincular el artículo principal.', 'error');
    }
};

