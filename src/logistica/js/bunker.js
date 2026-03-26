/**
 * Lógica Frontend del Búnker Transaccional
 */

document.addEventListener('DOMContentLoaded', async () => {
    await cargarListasDinamicas();
    await cargarRubrosTaxonomia();
    
    // Interceptar Modo Edición (Fase 7)
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) {
        // Ocultar buscador de Enriquecimiento para evitar confusiones de estado
        const searchPanels = document.querySelectorAll('.bunker-panel');
        if (searchPanels.length > 0 && searchPanels[0].innerHTML.includes('Enriquecer')) {
            searchPanels[0].style.display = 'none';
        }
        
        // UX: Dynamic Return Button
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.innerHTML = `
                <button class="btn-secondary" onclick="window.location.href='/pages/listado-bunker.html'" style="background-color: #3b82f6; color: white; border: none;">
                    ← Volver a Gestión de Artículos
                </button>
            `;
        }

        await hidratarFormularioEdicion(editId);
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

let articuloConsolidadoSeleccionado = null;
let timeoutConsolidado = null;

/**
 * Autocomplete Consolidado (Fase 3)
 */
async function buscarConsolidadoEnVivo(inputEl) {
    clearTimeout(timeoutConsolidado);
    const query = inputEl.value.trim();
    const listId = "autocomplete-list-" + inputEl.id;
    const listContainer = document.getElementById(listId);
    
    if (!listContainer) return;

    if (query.length < 3) {
        listContainer.style.display = 'none';
        return;
    }

    timeoutConsolidado = setTimeout(async () => {
        try {
            const res = await fetch(`/api/logistica/bunker/buscar-consolidado?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            listContainer.innerHTML = '';
            if (data.success && data.data.length > 0) {
                data.data.forEach(item => {
                    const div = document.createElement('div');
                    
                    if (item.ya_enriquecido) {
                        div.style.opacity = '0.5';
                        div.style.cursor = 'not-allowed';
                        div.style.backgroundColor = '#f8fafc';
                        div.innerHTML = `<strong>${item.descripcion}</strong> <span class="badge" style="background-color: #64748b; color: white; margin-left: 8px; font-size: 0.75em;">🔒 Ya en Búnker</span><br><span style="color:#666; font-size:0.85em;">ID: ${item.id} | EAN: ${item.codigo_barras || 'N/A'}</span>`;
                        div.onclick = (e) => {
                            e.stopPropagation();
                            Swal.fire({
                                icon: 'warning',
                                title: 'Artículo Bloqueado',
                                text: 'Este artículo ya posee inteligencia Búnker. Para realizar modificaciones sobre él, búscalo en la solapa de Gestión de Artículos y oprime "Editar".'
                            });
                        };
                    } else {
                        div.innerHTML = `<strong>${item.descripcion}</strong> <br><span style="color:#666; font-size:0.85em;">ID: ${item.id} | EAN: ${item.codigo_barras || 'N/A'}</span>`;
                        div.onclick = () => {
                            seleccionarArticuloConsolidado(item);
                            inputEl.value = item.descripcion;
                            listContainer.style.display = 'none';
                        };
                    }
                    listContainer.appendChild(div);
                });
                listContainer.style.display = 'block';
            } else {
                listContainer.style.display = 'none';
            }
        } catch (e) {
            console.error(e);
        }
    }, 400);
}

async function seleccionarArticuloConsolidado(item) {
    articuloConsolidadoSeleccionado = item;
    
    document.getElementById('bunker_id_pivote').value = item.id;
    document.getElementById('bunker_codigo_barras').value = item.codigo_barras || item.id;
    
    try {
        const res = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(item.id)}`);
        const data = await res.json();
        if (data.success && data.data) {
           await cargarDatosBunkerExistentes(data.data);
           Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'info', title: 'Artículo existente en Búnker. Datos cargados.'
           });
        } else {
           // Precargar info financiera heredada de Lomasoft si existe
           if (item.costo_base !== undefined) document.getElementById('costo_base').value = item.costo_base;
           if (item.porcentaje_iva !== undefined) document.getElementById('porcentaje_iva').value = item.porcentaje_iva;
           if (item.kilos_unidad !== undefined) document.getElementById('kilos_unidad').value = item.kilos_unidad;
           
           Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
                icon: 'success', title: 'Artículo vinculado exitosamente.'
           });
        }
    } catch(e) { }
}

function limpiarSeleccionConsolidado() {
    articuloConsolidadoSeleccionado = null;
    document.getElementById('buscador_consolidado').value = '';
    document.getElementById('bunker_id_pivote').value = 'Generado Automáticamente';
    document.getElementById('bunker_codigo_barras').value = 'Generado Automáticamente';
    // Limpiar form visual
    document.getElementById('costo_base').value = '';
    document.querySelectorAll('.input-margen-dinamico').forEach(i => i.value = '');
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
                    div.innerHTML = `<strong>${item.termino}</strong> <span style="color:#666; font-size:0.85em;">[${item.abreviatura}]</span>`;
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
                const match = data.data.find(d => d.termino.toLowerCase() === query.toLowerCase()) || data.data[0];
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

function asignarTerminoDict(inputId, termino, abreviatura) {
    if (inputId === 'descripcion_principal') {
        dictLocal.principal = { termino, abreviatura };
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
        dictLocal.propiedades = dictLocal.propiedades.filter(p => p.idContainer !== inputId);
    }
    actualizarLivePreview();
}

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
        return dictLocal.principal && dictLocal.principal.termino.toLowerCase() === query.toLowerCase();
    }
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    return prop && prop.termino.toLowerCase() === query.toLowerCase();
}

function actualizarLivePreview() {
    let parts = [];
    if (dictLocal.principal && dictLocal.principal.abreviatura) {
        let baseAb = dictLocal.principal.abreviatura.toString();
        // Regex para eliminar strings estilo "x 10kg" o "1 x 10kg" cargados por legacy
        baseAb = baseAb.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]?/g, '').trim();
        if (baseAb) parts.push(baseAb);
    }
    dictLocal.propiedades.forEach(p => {
        if (p.abreviatura && !p.silencioso) parts.push(p.abreviatura);
    });
    
    // Lógica QA Fase 3: Cantidad y Kilos Sufijos (Formato Presentation)
    let sufijoFisico = "";
    const kilosEl = document.getElementById('kilos_unidad');
    const cantEl  = document.getElementById('cantidad_pack');
    if (kilosEl && cantEl) {
        const kilos = parseFloat(kilosEl.value) || 0;
        const cantidad = parseInt(cantEl.value) || 1;
        
        if (kilos > 0) {
            if (cantidad === 1) {
                sufijoFisico = ` x ${kilos}kg`;
            } else if (cantidad > 1) {
                const pesoUnitario = parseFloat((kilos / cantidad).toFixed(3));
                sufijoFisico = ` ${cantidad} x ${pesoUnitario}kg`;
            }
        }
    }

    const finalDesc = parts.join('.') + sufijoFisico;
    document.getElementById('live_preview').value = finalDesc;
    return finalDesc;
}

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

    // Inyectar categorías dinámicas desde el diccionario global que no sean las base ni las internas del sistema
    const categoriasBase = ['otro', '', 'general', 'propiedad_dinamica', 'tipo', 'articulo_principal'];
    let opcionesExtraHtml = '';
    if (window.diccionarioCategorizado) {
        const categoriasUnicas = [...new Set(window.diccionarioCategorizado.map(d => d.categoria))];
        categoriasUnicas.forEach(cat => {
            if (cat && !categoriasBase.includes(cat.toLowerCase())) {
                let catCleaned = cat.replaceAll('_', ' ');
                const catLabel = catCleaned.charAt(0).toUpperCase() + catCleaned.slice(1);
                opcionesExtraHtml += `<option value="${cat}">${catLabel}</option>`;
            }
        });
    }

    const div = document.createElement('div');
    div.className = 'attr-row';
    div.id = rowId;
    div.innerHTML = `
        <select style="width: 150px;" onchange="actualizarCategoriaAtributo('${inputId}', this)" required>
            <option value="" disabled selected>Familia...</option>
            ${opcionesExtraHtml}
            <option value="otro">✨ Crear nueva Familia...</option>
        </select>
        </select>
        <div id="container_texto_${inputId}" style="position: relative; flex: 1;">
            <select id="${inputId}" disabled onchange="seleccionarOpcionInteligente('${inputId}', this.value)" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; font-size: 1em; background: #f8fafc; color: #94a3b8;" required>
                <option value="" disabled selected>🔒 Seleccione una Familia primero...</option>
            </select>
        </div>
        <div style="display:flex; flex-direction:column; justify-content:center; align-items:center;">
            <button type="button" title="Mover Arriba" onclick="moverAtributo('${rowId}', 'arriba')" style="border:none; background:transparent; cursor:pointer; font-size: 0.85em; padding:0; line-height:1; opacity: 0.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⬆️</button>
            <button type="button" title="Mover Abajo" onclick="moverAtributo('${rowId}', 'abajo')" style="border:none; background:transparent; cursor:pointer; font-size: 0.85em; padding:0; line-height:1; opacity: 0.6; margin-top:2px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">⬇️</button>
        </div>
        <button type="button" class="btn-icon" id="toggle_attr_${inputId}" style="color: #3b82f6; font-size: 1.2em; border:none; background:transparent; cursor:pointer; margin-left:5px;" onclick="toggleVisibilidadAtributo('${inputId}')" title="Visible en Nomenclador">👁️</button>
        <button type="button" class="btn-icon" style="color:red;" onclick="eliminarAtributoUI('${rowId}', '${inputId}')">✖</button>
    `;
    container.appendChild(div);

    if (defaultCategoria) {
        const selectCat = div.querySelector('select');
        let optionExists = Array.from(selectCat.options).some(opt => opt.value === defaultCategoria);
        if (!optionExists) {
            const newOpt = document.createElement('option');
            newOpt.value = defaultCategoria;
            newOpt.text = defaultCategoria;
            selectCat.add(newOpt, selectCat.options[selectCat.options.length - 1]);
        }
        selectCat.value = defaultCategoria;
        actualizarCategoriaAtributo(inputId, selectCat);
    }
    
    return inputId;
};

window.moverAtributo = function(rowId, direccion) {
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
    
    // Re-render live preview to reflect new order
    actualizarLivePreview();
};

window.actualizarCategoriaAtributo = async function(inputId, selectEl) {
    const cat = selectEl.value;
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop) return;

    if (cat === 'otro') {
        if (Swal.isVisible()) Swal.close(); // Previene collision con Toasts activos
        
        setTimeout(async () => {
            const { value: nuevoNombre } = await Swal.fire({
                title: 'Nueva Propiedad',
                text: 'Ingrese el nombre de la propiedad personalizada',
                input: 'text',
                inputPlaceholder: 'Ej: Humedad, Envase...',
                showCancelButton: true,
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                inputValidator: (value) => {
                    if (!value || value.trim() === '') return 'Debe ingresar un nombre!';
                }
            });

            if (nuevoNombre) {
                const keyName = nuevoNombre.trim().toLowerCase();
                prop.categoria = keyName;
                
                const newOpt = document.createElement('option');
                newOpt.value = keyName;
                newOpt.text = keyName + ' (Nuevo)';
                newOpt.selected = true;
                selectEl.add(newOpt, selectEl.options[selectEl.options.length - 1]);
                
                if (window.diccionarioCategorizado) cargarOpcionesDeCategoria(inputId, keyName);
            } else {
                selectEl.value = "";
                prop.categoria = "";
            }
        }, 50);
    } else {
        prop.categoria = cat;
        if (window.diccionarioCategorizado) cargarOpcionesDeCategoria(inputId, cat);
    }
};

window.obtenerPlantillaParaArticulo = async function(termino) {
    try {
        const res = await fetch(`/api/logistica/bunker/plantilla?termino=${encodeURIComponent(termino)}`);
        const data = await res.json();
        if (data.success) {
            window.diccionarioCategorizado = data.diccionario_categorizado || [];
            if (data.categorias_sugeridas && data.categorias_sugeridas.length > 0 && dictLocal.propiedades.length === 0) {
                data.categorias_sugeridas.forEach(cat => {
                    if(cat) agregarAtributoUI(cat);
                });
            }
        }
    } catch(err) {
        console.error("Error obteniendo plantilla:", err);
    }
};

window.cargarOpcionesDeCategoria = function(inputId, categoria, preventReset = false) {
    const contenedorTexto = document.getElementById(`container_texto_${inputId}`);
    if (!contenedorTexto || !window.diccionarioCategorizado) return;
    
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if(prop && !preventReset) { 
        prop.termino = ''; 
        prop.abreviatura = ''; 
        actualizarLivePreview(); 
    }

    const opciones = window.diccionarioCategorizado.filter(d => d.categoria === categoria);
    
    let html = `<select id="${inputId}" required onchange="seleccionarOpcionInteligente('${inputId}', this.value)" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; font-size: 1em; background: #fffbeeb3; color: #1e293b;">`;
    
    if (opciones.length > 0) {
        html += `<option value="" disabled selected>📋 Seleccione ${categoria} del diccionario...</option>`;
        opciones.forEach(opt => {
            html += `<option value='${JSON.stringify({t: opt.termino, a: opt.abreviatura})}'>${opt.termino} [${opt.abreviatura}]</option>`;
        });
    } else {
        html += `<option value="" disabled selected>⚠️ No hay términos registrados para ${categoria}.</option>`;
    }
    html += `<option value="NUEVO" style="font-weight:bold; color:#2563eb;">✨ [+] Crear nuevo término para ${categoria}...</option>`;
    html += `</select>`;
    
    contenedorTexto.innerHTML = html;
};

window.seleccionarOpcionInteligente = async function(inputId, valStr) {
    const prop = dictLocal.propiedades.find(p => p.idContainer === inputId);
    if (!prop) return;
    
    if (valStr === "NUEVO") {
         document.getElementById(inputId).value = ""; // Reset visualmente
         
         const formHtml = `
             <input id="swal-input-termino" class="swal2-input" placeholder="Nombre (Ej: Partida, Mediano...)">
             <input id="swal-input-abrev" class="swal2-input" placeholder="Abreviatura (Ej: PTA, MED...)">
         `;
         const { value: formValues } = await Swal.fire({
            title: `Nuevo Término para ${prop.categoria}`,
            html: formHtml,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Guardar',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const term = document.getElementById('swal-input-termino').value.trim();
                const abrv = document.getElementById('swal-input-abrev').value.trim().toUpperCase();
                if (!term || !abrv) Swal.showValidationMessage('Ambos campos son obligatorios');
                if (abrv.length > 10) Swal.showValidationMessage('Abreviatura muy larga (Máx 10 char)');
                return { term, abrv };
            }
         });
         
         if (formValues) {
             const keyName = prop.categoria;
             // Guardar in RAM para envio "on-the-fly" legacy
             nuevosTerminosPendientes.push({ termino: formValues.term, abreviatura: formValues.abrv, categoria: keyName });
             // Inyectar localmente para render
             window.diccionarioCategorizado.push({ termino: formValues.term, abreviatura: formValues.abrv, categoria: keyName });
             
             // Recargar el Select y autoseleccionar
             window.cargarOpcionesDeCategoria(inputId, keyName, true);
             
             setTimeout(() => {
                 const selectRecreado = document.getElementById(inputId);
                 const valJson = JSON.stringify({t: formValues.term, a: formValues.abrv});
                 if (selectRecreado) selectRecreado.value = valJson;
                 window.seleccionarOpcionInteligente(inputId, valJson);
             }, 50);
         }
         return;
    }
    
    try {
        const obj = JSON.parse(valStr);
        asignarTerminoDict(inputId, obj.t, obj.a);
    } catch(e) {}
};

function eliminarAtributoUI(rowId, inputId) {
    document.getElementById(rowId).remove();
    limpiarTerminoDict(inputId);
}

let listasGlobales = [];

async function cargarListasDinamicas() {
    const container = document.getElementById('dynamic-lists');
    try {
        const response = await fetch('/api/logistica/bunker/listas');
        if (!response.ok) throw new Error('Error al obtener listas');
        
        const resJson = await response.json();
        listasGlobales = resJson.data || [];

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
                <td><input type="number" step="0.01" class="input-margen-dinamico" data-listaid="${lista.id}" value="0.00" placeholder="0.00" oninput="recalcularFilaPorMargen(${lista.id})"></td>
                <td id="s_iva_${lista.id}">$ 0,00</td>
                <td id="iibb_${lista.id}">$ 0,00</td>
                <td id="neta_${lista.id}" style="color: #15803d; font-weight: bold;">$ 0,00</td>
                <td><input type="text" class="input-precio-final" id="precio_final_${lista.id}" data-listaid="${lista.id}" value="0,00" placeholder="0,00" oninput="recalcularFilaPorPrecioFinal(${lista.id})" onfocus="limpiarFormatoInputFocus(this)" onblur="aplicarFormatoInputBlur(this)"></td>
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

// Motor de Hidratación Frontend (Fase 7)
window.hidratarFormularioEdicion = async function(id) {
    try {
        Swal.fire({ title: 'Recuperando Búnker...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        
        const res = await fetch(`/api/logistica/bunker/articulos/${id}`);
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error);
        
        const art = result.data;
        
        // 1. Structural
        document.getElementById('bunker_id_pivote').value = art.articulo_id;
        document.getElementById('bunker_codigo_barras').value = art.codigo_barras || art.articulo_id;
        
        // Trick to enable UPDATE branch when saving
        articuloConsolidadoSeleccionado = { id: art.articulo_id, codigo_barras: art.codigo_barras || art.articulo_id }; 
        
        // 2. Principal
        document.getElementById('descripcion_principal').value = art.descripcion;
        
        // Extraer abreviatura del string compilado generada si es posible
        let abrevPrincipal = 'N/A';
        if (art.descripcion_generada && art.descripcion_generada.includes('.')) {
            abrevPrincipal = art.descripcion_generada.split('.')[0];
        } else if (art.descripcion_generada) {
            abrevPrincipal = art.descripcion_generada;
        }

        dictLocal.principal = { termino: art.descripcion, abreviatura: abrevPrincipal };
        
        // Fetch Dictionary Template for the Principal
        if (typeof obtenerPlantillaParaArticulo === 'function') {
            await obtenerPlantillaParaArticulo(art.descripcion);
        }
        
        // 3. Financial and Reglas
        document.getElementById('costo_base').value = parseFloat(art.costo_base || 0).toFixed(2);
        document.getElementById('porcentaje_iva').value = parseFloat(art.porcentaje_iva || 21).toFixed(2);
        document.getElementById('kilos_unidad').value = parseFloat(art.kilos_unidad || 0).toFixed(3);
        document.getElementById('cantidad_pack').value = art.pack_unidades || 1;
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
        if (art.margenes && Array.isArray(art.margenes)) {
            art.margenes.forEach(m => {
                const inputMargen = document.querySelector(`.input-margen-dinamico[data-listaid="${m.lista_id}"]`);
                if (inputMargen) {
                    inputMargen.value = parseFloat(m.margen_porcentaje).toFixed(2);
                }
            });
        }
        recalcularTodaLaGrilla();

        // 5. JSONB Re-construction
        // Note: Some properties might have been auto-added by `obtenerPlantillaParaArticulo`. We must map them.
        const propsJSON = art.propiedades_dinamicas || {};
        
        // Extraer claves y ordenarlas por el atributo interno 'orden' para mantener la estructura de la Nomenclatura
        const keys = Object.keys(propsJSON).sort((a, b) => {
            const propA = propsJSON[a];
            const propB = propsJSON[b];
            const ordA = (typeof propA === 'object' && propA !== null && propA.orden !== undefined) ? propA.orden : 99;
            const ordB = (typeof propB === 'object' && propB !== null && propB.orden !== undefined) ? propB.orden : 99;
            return ordA - ordB;
        });
        
        for (const cat of keys) {
            const propData = propsJSON[cat];
            
            const val = typeof propData === 'object' && propData !== null ? propData.valor : propData;
            const isVisible = typeof propData === 'object' && propData !== null ? (propData.visible !== false) : true;
            
            // Re-use auto-generated UI container or create new one
            let existingProp = dictLocal.propiedades.find(p => p.categoria === cat);
            let targetInputId = existingProp ? existingProp.idContainer : null;
            
            if (!targetInputId) {
                targetInputId = agregarAtributoUI(cat);
                const prop = dictLocal.propiedades.find(p => p.idContainer === targetInputId);
                if (prop) prop.categoria = cat;
                
                // Trigger Smart Dropdown logic to construct the innerHTML appropriately
                const selectElCat = document.querySelector(`select[onchange*="${targetInputId}"]`);
                if(selectElCat) {
                     selectElCat.value = cat; 
                     await window.actualizarCategoriaAtributo(targetInputId, selectElCat);
                }
            }

            // At this point, the innerHTML is either a text input or a Smart <select>
            // Let's attempt to look up its historical Abbreviation since it's missing from JSONB mapping
            let abrevReconstructed = 'XXX';
            if (window.diccionarioCategorizado) {
                 const matchDict = window.diccionarioCategorizado.find(d => d.termino.toLowerCase() === val.toLowerCase());
                 if (matchDict) abrevReconstructed = matchDict.abreviatura;
            }

            // Force visual selection on Select OR Text Input
            const elContainer = document.getElementById(`container_texto_${targetInputId}`);
            if (elContainer) {
                const selectEl = elContainer.querySelector('select');
                if (selectEl) {
                    const targetJSONStr = JSON.stringify({t: val, a: abrevReconstructed});
                    let foundOpt = Array.from(selectEl.options).find(opt => opt.value === targetJSONStr);
                    if (foundOpt) {
                        selectEl.value = targetJSONStr;
                    } else {
                        const newOpt = document.createElement('option');
                        newOpt.value = targetJSONStr;
                        newOpt.text = `${val} [${abrevReconstructed}]`;
                        selectEl.add(newOpt, selectEl.options[selectEl.options.length - 1]);
                        selectEl.value = targetJSONStr;
                        if(window.diccionarioCategorizado) {
                             window.diccionarioCategorizado.push({termino: val, abreviatura: abrevReconstructed, categoria: cat});
                        }
                    }
                } else {
                    const textEl = document.getElementById(targetInputId);
                    if (textEl) textEl.value = `${val} [${abrevReconstructed}]`;
                }
            }

            // Hard inject into dictLocal so updating live preview works
            const pIndex = dictLocal.propiedades.findIndex(p => p.idContainer === targetInputId);
            if (pIndex >= 0) {
                dictLocal.propiedades[pIndex].termino = val;
                dictLocal.propiedades[pIndex].abreviatura = abrevReconstructed;
                window.toggleVisibilidadAtributo(targetInputId, !isVisible);
            }
        }
        
        // REORDER DOM AND DICTLOCAL TO OVERRIDE TEMPLATE AUTO-FILLER
        const container = document.getElementById('atributos-container');
        dictLocal.propiedades.sort((a, b) => {
            const ordA = (propsJSON[a.categoria] && propsJSON[a.categoria].orden !== undefined) ? propsJSON[a.categoria].orden : 99;
            const ordB = (propsJSON[b.categoria] && propsJSON[b.categoria].orden !== undefined) ? propsJSON[b.categoria].orden : 99;
            return ordA - ordB;
        });
        
        dictLocal.propiedades.forEach(p => {
            const rowId = p.idContainer.replace('val', 'row');
            const rowEl = document.getElementById(rowId);
            if (rowEl) container.appendChild(rowEl);
        });

        actualizarLivePreview();
        Swal.close();
        
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
    if (inputEl.type === 'text') {
        valStr = valStr.replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
    }
    return parseFloat(valStr);
};

window.aplicarFormatoInputBlur = function(inputEl) {
    let val = parseInputValue(inputEl);
    if (isNaN(val)) return;
    inputEl.type = 'text';
    inputEl.value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

window.limpiarFormatoInputFocus = function(inputEl) {
    if (inputEl.type === 'number') return;
    let val = parseInputValue(inputEl);
    inputEl.type = 'number';
    inputEl.step = '0.01';
    inputEl.value = isNaN(val) ? "" : val.toFixed(2);
};

window.limpiarFilaFinanciera = function(listaId) {
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    
    // Hard UI Reset to 0
    if (margenInput) {
        margenInput.type = 'number';
        margenInput.value = '0.00';
    }
    if (precioInput) {
        precioInput.type = 'number';
        precioInput.value = '';
    }
    
    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
};

window.recalcularTodaLaGrilla = function() {
    const inputsMargen = document.querySelectorAll('.input-margen-dinamico');
    inputsMargen.forEach(input => {
        recalcularFilaPorMargen(input.getAttribute('data-listaid'));
    });
};

window.recalcularFilaPorMargen = function(listaId) {
    const costoBase = parseFloat(document.getElementById('costo_base').value) || 0;
    const ivaPct = parseFloat(document.getElementById('porcentaje_iva').value) || 0;
    
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    if (!margenInput) return;
    
    const margenText = (margenInput.type === 'text') ? margenInput.value.trim() : margenInput.value;
    let margen = parseInputValue(margenInput);

    if (isNaN(margen) || margen === 0) {
        document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
        const precioInput = document.getElementById(`precio_final_${listaId}`);
        if (precioInput) {
            precioInput.type = 'number';
            precioInput.value = '';
        }
        return;
    }

    let precio_s_iva = costoBase * (1 + (margen / 100));
    let iibb = precio_s_iva * 0.04;
    let neta = precio_s_iva - costoBase - iibb;
    let precio_c_iva = precio_s_iva * (1 + (ivaPct / 100));

    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(precio_s_iva);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(iibb);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(neta);
    
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    if (precioInput) {
        if (precioInput.type === 'text') {
            precioInput.value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(precio_c_iva);
        } else {
            precioInput.value = precio_c_iva.toFixed(2);
        }
    }
};

window.recalcularFilaPorPrecioFinal = function(listaId) {
    const costoBase = parseFloat(document.getElementById('costo_base').value) || 0;
    const ivaPct = parseFloat(document.getElementById('porcentaje_iva').value) || 0;
    
    const precioInput = document.getElementById(`precio_final_${listaId}`);
    if (!precioInput) return;
    
    let precioFinal = parseInputValue(precioInput);
    
    if (isNaN(precioFinal) || precioFinal === 0) {
        document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(0);
        document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(0);
        const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
        if (margenInput) {
            margenInput.type = 'number';
            margenInput.value = '0.00';
        }
        return;
    }

    let precio_s_iva = precioFinal / (1 + (ivaPct / 100));
    let iibb = precio_s_iva * 0.04;
    let neta = precio_s_iva - costoBase - iibb;

    document.getElementById(`s_iva_${listaId}`).innerText = formatCurrencyARG(precio_s_iva);
    document.getElementById(`iibb_${listaId}`).innerText = formatCurrencyARG(iibb);
    document.getElementById(`neta_${listaId}`).innerText = formatCurrencyARG(neta);
    
    const margenInput = document.querySelector(`.input-margen-dinamico[data-listaid="${listaId}"]`);
    if (margenInput) {
        if (costoBase <= 0) {
            margenInput.value = '0.00';
            return;
        }
        let nuevoMargen = ((precio_s_iva / costoBase) - 1) * 100;
        margenInput.value = nuevoMargen.toFixed(2);
    }
};

async function guardarArticuloBunker(event) {
    event.preventDefault();

    if (!dictLocal.principal) {
        Swal.fire('Atención', 'Debe seleccionar o ingresar un Artículo Principal válido.', 'warning');
        return;
    }

    const desc_abreviada = actualizarLivePreview();
    
    // Generar JSONB Propiedades Dinámicas respetando el orden de inserción visual
    const propsJSON = {};
    dictLocal.propiedades.forEach((p, idx) => {
        if (p.termino && p.categoria) {
            propsJSON[p.categoria] = {
                valor: p.termino,
                visible: !p.silencioso,
                orden: idx
            };
        }
    });

    // Recolectar datos estructurales y base del Búnker
    const articuloData = {
        articulo_id: articuloConsolidadoSeleccionado ? articuloConsolidadoSeleccionado.id : null,
        codigo_barras: articuloConsolidadoSeleccionado ? (articuloConsolidadoSeleccionado.codigo_barras || articuloConsolidadoSeleccionado.id) : null,
        descripcion: dictLocal.principal.termino,
        descripcion_abreviada: desc_abreviada,
        propiedades_dinamicas: propsJSON,
        costo_base: parseFloat(document.getElementById('costo_base').value) || 0,
        porcentaje_iva: parseFloat(document.getElementById('porcentaje_iva').value) || 21,
        kilos_unidad: parseFloat(document.getElementById('kilos_unidad').value) || 0,
        pack_unidades: parseInt(document.getElementById('cantidad_pack').value) || 1,
        kilos_unidad: parseFloat(document.getElementById('kilos_unidad').value) || 0,
        pack_unidades: parseInt(document.getElementById('cantidad_pack').value) || 1,
        moneda: document.getElementById('moneda').value,
        rubro: document.getElementById('rubro').value.trim(),
        sub_rubro: document.getElementById('sub_rubro').value.trim(),
        pack_hijo_codigo: document.getElementById('pack_hijo_codigo').value.trim(),
        no_producido_por_lambda: document.getElementById('no_producido_por_lambda').checked,
        mantener_utilidad: document.getElementById('mantener_utilidad').checked
    };

    // Recolectar array de márgenes
    const listasMargenes = [];
    const inputsMargen = document.querySelectorAll('.input-margen-dinamico');
    inputsMargen.forEach(input => {
        listasMargenes.push({
            lista_id: parseInt(input.getAttribute('data-listaid')),
            margen_porcentaje: parseFloat(input.value) || 0
        });
    });

    const payload = {
        articuloData,
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
            
            let modalTitle = '';
            let modalHtml = '';
            let confirmText = '';
            
            if (articuloConsolidadoSeleccionado) {
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
                document.getElementById('atributos-container').innerHTML = '';
                dictLocal = { principal: null, propiedades: [] };
                nuevosTerminosPendientes = [];
                actualizarLivePreview();
                recalcularTodaLaGrilla();
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
