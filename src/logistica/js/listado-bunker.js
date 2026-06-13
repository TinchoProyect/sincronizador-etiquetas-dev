let articulosBunkerGlobal = [];
let listaSeleccionadaGlobal = 1; // Default a Lista 1
window.articulosSeleccionadosMasa = new Set();
window.articulosVisiblesActualmente = [];

window.filtroCapas = [ { id: 1, propiedad: '', exclusions: [] } ]; // Inicializar con capa 1 estática
window.capaCounter = 1;
window.propSortAscending = true;  // Dirección de ordenamiento

document.addEventListener('DOMContentLoaded', async () => {
    initColumnToggler();
    await cargarListasPreciosFiltro();
    await cargarDataGrid();
    initScannerExpressListener();
    initTableResizableColumns('tabla-bunker');
});

// Click outside to close column settings dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('col-toggler-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
    const insumoResults = document.getElementById('gp-insumo-resultados');
    if (insumoResults && !insumoResults.contains(e.target) && e.target.id !== 'gp-buscar-insumo') {
        insumoResults.style.display = 'none';
    }
});

async function cargarListasPreciosFiltro() {
    try {
        const res = await fetch('/api/logistica/bunker/listas');
        const result = await res.json();
        const select = document.getElementById('filtro-lista-precios');
        
        if (res.ok && result.success && result.data.length > 0) {
            select.innerHTML = '';
            result.data.forEach(lista => {
                const opt = document.createElement('option');
                opt.value = lista.id;
                opt.textContent = lista.nombre;
                select.appendChild(opt);
            });
            listaSeleccionadaGlobal = parseInt(select.value) || 1;
            
            // Inicializar gp_listasFinancieras con datos base para permitir previsualizar/imprimir directamente
            gp_listasFinancieras = result.data.map(lista => ({
                lista_id: lista.id,
                nombre_lista: lista.nombre
            }));
            gp_activeTabIdx = 0;
        } else {
            select.innerHTML = '<option value="1">L1 Base</option>';
        }
    } catch(e) {
        console.error('Error cargando listas:', e);
    }
}

window.cambiarListaPreciosDataGrid = async function(nuevaListaId) {
    listaSeleccionadaGlobal = parseInt(nuevaListaId);
    
    // Sincronizar el tab activo del gestor financiero
    if (gp_listasFinancieras && gp_listasFinancieras.length > 0) {
        const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(nuevaListaId));
        if (idx !== -1) {
            gp_activeTabIdx = idx;
        }
    }
    
    await cargarDataGrid();
};

// --- LOGICA DE VISIBILIDAD DE COLUMNAS ---
const BUNKER_COLUMNS = [
    { id: 0, name: 'ID Pivote', defaultVisible: true },
    { id: 1, name: 'Art. Principal / Rubro', defaultVisible: true },
    { id: 2, name: 'Nomenclatura (Prod)', defaultVisible: true },
    { id: 3, name: 'Propiedades (Intel)', defaultVisible: true },
    { id: 4, name: '% IVA', defaultVisible: false },
    { id: 5, name: 'Costo s/IVA', defaultVisible: false },
    { id: 6, name: 'IIBB (4%)', defaultVisible: false },
    { id: 7, name: 'Ganancia Neta', defaultVisible: false },
    { id: 8, name: 'Precio Final c/IVA', defaultVisible: true },
    { id: 9, name: 'Margen Base', defaultVisible: true },
    { id: 10, name: 'Total Entrante (Un)', defaultVisible: true },
    { id: 11, name: 'Total Entrante (Kg)', defaultVisible: true },
    { id: 12, name: 'Stock Tradicional (Lomas Soft)', defaultVisible: true }
];

let bunkerGridPreferences = {};

function initColumnToggler() {
    const saved = localStorage.getItem('bunker_grid_preferences');
    if (saved) {
        try { bunkerGridPreferences = JSON.parse(saved); } catch(e) {}
    }

    const container = document.getElementById('col-toggler-list');
    if (!container) return;

    BUNKER_COLUMNS.forEach(col => {
        if (bunkerGridPreferences[col.id] === undefined) {
            bunkerGridPreferences[col.id] = col.defaultVisible;
        }

        const isVisible = bunkerGridPreferences[col.id];
        aplicarVisibilidadColumna(col.id, isVisible);

        const label = document.createElement('label');
        label.className = 'settings-dropdown-label';
        label.innerHTML = `
            <input type="checkbox" value="${col.id}" ${isVisible ? 'checked' : ''} onchange="toggleBunkerColumn(${col.id}, this.checked)">
            ${col.name}
        `;
        container.appendChild(label);
    });
}

window.toggleBunkerColumn = function(colId, isVisible) {
    bunkerGridPreferences[colId] = isVisible;
    localStorage.setItem('bunker_grid_preferences', JSON.stringify(bunkerGridPreferences));
    aplicarVisibilidadColumna(colId, isVisible);
};

function aplicarVisibilidadColumna(colId, isVisible) {
    const table = document.getElementById('tabla-bunker');
    if (!table) return;
    const hideClass = `hide-col-${colId}`;
    if (isVisible) {
        table.classList.remove(hideClass);
    } else {
        table.classList.add(hideClass);
    }
}
// ------------------------------------------

async function cargarDataGrid() {
    window.articulosSeleccionadosMasa.clear();
    const search = document.getElementById('filtro-busqueda').value.trim();
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; padding: 20px;">Cargando Búnker...</td></tr>';
    
    try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (listaSeleccionadaGlobal) params.append('lista_id', listaSeleccionadaGlobal);
        
        const res = await fetch(`/api/logistica/bunker/listado?${params.toString()}`);
        const result = await res.json();
        
        if (res.ok && result.success) {
            articulosBunkerGlobal = result.data;
            window.actualizarCheckboxesTodasLasCapas();
            window.aplicarFiltrosYOrdenamiento();
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="16" style="color: red; text-align: center;">Error de conexión: ${e.message}</td></tr>`;
    }
}

function renderizarGrid(articulos) {
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '';
    
    if (articulos.length === 0) {
         tbody.innerHTML = '<tr><td colspan="16" style="text-align: center; padding: 20px;">No se encontraron artículos en el Búnker.</td></tr>';
         const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
         if (masterCheckbox) masterCheckbox.checked = false;
         window.actualizarEstadoBotonMasivo();
         return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    const stockFormatter = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    articulos.forEach((art, rowIndex) => {
        const costo = parseFloat(art.costo_base || 0);
        const iva = parseFloat(art.porcentaje_iva || 21);
        
        // Parsear JSONB a Tooltip
        let propSummary = '<span style="color:#94a3b8; font-size: 0.8em;">Sin Propiedades</span>';
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            const keys = Object.keys(art.propiedades_dinamicas);
            if (keys.length > 0) {
                if (keys.length === 1) {
                    const rawVal = art.propiedades_dinamicas[keys[0]];
                    const valStr = typeof rawVal === 'object' ? rawVal.valor : rawVal;
                    propSummary = `<span style="font-size: 0.9em;">${keys[0].toUpperCase()}: ${valStr}</span>`;
                } else {
                    propSummary = `<span style="font-size: 0.9em;">[ ${keys.length} Propiedades ]</span>`;
                }

                let badgesHtml = '';
                keys.forEach((key, index) => {
                    const rawVal = art.propiedades_dinamicas[key];
                    const valStr = typeof rawVal === 'object' ? rawVal.valor : rawVal;
                    const isVisible = typeof rawVal === 'object' ? (rawVal.visible !== false) : true;
                    const eyeIcon = isVisible ? '' : ' 🙈';
                    const colorClass = `color-${index % 6}`;
                    badgesHtml += `<span class="badge ${colorClass}">
                        <span class="badge-cat">${key.toUpperCase()}:</span> ${valStr}${eyeIcon}
                    </span>`;
                });

                propSummary = `
                    <div class="badge-tooltip-container">
                        ${propSummary}
                        <div class="tooltip-content" style="width: auto; max-width: 400px; display: flex; flex-wrap: wrap;">${badgesHtml}</div>
                    </div>
                `;
            }
        }
        
        let disponibleActiva = true;
        let margenPrincipalText = 'N/A';
        let precioFinalDinamicoHtml = `<span style="color:#94a3b8;">N/D</span>`;
        let ivaStr = `${iva.toFixed(2)}%`;
        let costoSivaStr = `<span style="color:#94a3b8;">N/D</span>`;
        let iibbStr = `<span style="color:#94a3b8;">N/D</span>`;
        let gananciaNetaStr = `<span style="color:#94a3b8;">N/D</span>`;
        let expandedGridHtml = '';
        
        let isOutdated = false;
        
        if (art.margenes && Array.isArray(art.margenes) && art.margenes.length > 0) {
            art.margenes.sort((a,b) => a.lista_id - b.lista_id);
            
            // Buscar el margen de la lista enfocada globalmente
            const mFocused = art.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) || art.margenes[0];
            if (mFocused) {
                disponibleActiva = mFocused.disponible !== false;
            }
            const pctMargen = parseFloat(mFocused.margen_porcentaje);
            margenPrincipalText = `${pctMargen.toFixed(2)} %`;
            
            // Si el costo está desactualizado, se tiñe la fila
            if (mFocused && mFocused.costo_desactualizado === true) {
                isOutdated = true;
            }
            
            const precioC_iva = parseFloat(mFocused.precio_final || 0);
            const dynamicIva = parseFloat(mFocused.iva || iva);
            const precioS_iva = precioC_iva / (1 + (dynamicIva / 100));
            ivaStr = `${dynamicIva.toFixed(2)}%`;
            
            // Costo real (para visualizaciones del dashboard)
            const cTiempo = parseFloat(mFocused.costo_tiempo || 0);
            const cBase = mFocused.costo_base_sobrescrito !== null ? parseFloat(mFocused.costo_base_sobrescrito) : parseFloat(mFocused.costo_ingrediente_en_vivo || costo);
            const cInsumos = parseFloat(mFocused.costo_insumos_en_vivo || 0);
            const cIntegrado = cBase + cInsumos;
            
            // Cálculos financieros derivados
            const montoIibb = (precioC_iva * 4) / 100; // Impuestos Brutos 4%
            const gananciaNeta = (precioS_iva - cTiempo) - cIntegrado;

            precioFinalDinamicoHtml = `<span style="font-weight:bold; color: #15803d; font-size: 1.1em;">${formatter.format(precioC_iva)}</span>`;
            if (isOutdated) {
                precioFinalDinamicoHtml += ` <span style="cursor:help; font-size:1.15em; color:#d97706;" title="Alerta: Costo base o receta cambió. Margen implícito disminuido en esta lista. Click en Finanzas para recalibrar.">⚠️</span>`;
            }
            
            costoSivaStr = formatter.format(precioS_iva);
            iibbStr = formatter.format(montoIibb);
            gananciaNetaStr = formatter.format(gananciaNeta);
            
            expandedGridHtml = `
                <table class="mini-grid">
                    <thead>
                        <tr>
                            <th>Lista de Venta</th>
                            <th>Modo</th>
                            <th>Margen Ganancia</th>
                            <th>Costo Integrado</th>
                            <th>Costo Tiempo</th>
                            <th>Precio c/IVA (Final)</th>
                            <th>Estado Costo</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            art.margenes.forEach(m => {
                const isSel = m.lista_id === listaSeleccionadaGlobal;
                const rowStyle = isSel ? 'background-color: #fef08a;' : '';
                const fwStyle = isSel ? 'font-weight:bold;' : '';
                const lBase = m.costo_base_sobrescrito !== null ? parseFloat(m.costo_base_sobrescrito) : parseFloat(m.costo_ingrediente_en_vivo || costo);
                const lInsumos = parseFloat(m.costo_insumos_en_vivo || 0);
                
                expandedGridHtml += `
                    <tr style="${rowStyle}">
                        <td style="text-align:center; ${fwStyle}">Lista ${m.lista_id}</td>
                        <td style="${fwStyle}">${m.modo_calculo}</td>
                        <td style="${fwStyle}">${parseFloat(m.margen_porcentaje).toFixed(2)} %</td>
                        <td style="${fwStyle}">${formatter.format(lBase + lInsumos)}</td>
                        <td style="${fwStyle}">${formatter.format(parseFloat(m.costo_tiempo || 0))}</td>
                        <td style="font-weight:bold; color: #15803d;">${formatter.format(parseFloat(m.precio_final))}</td>
                        <td style="${fwStyle}">${m.costo_desactualizado ? '<span style="color:#d97706; font-weight:bold;">⚠️ Outdated</span>' : '<span style="color:#16a34a;">🟢 OK</span>'}</td>
                    </tr>
                `;
            });
            expandedGridHtml += `</tbody></table>`;
        }

        const hasMargins = expandedGridHtml !== '';
        const toggleIcon = hasMargins ? `<span class="toggle-icon" onclick="toggleRow('details_${rowIndex}', this)">▶</span>` : '';

        const trMain = document.createElement('tr');
        if (isOutdated) {
            trMain.style.cssText = 'background-color: #fffbeb; border-left: 4px solid #d97706;';
        }
        if (!disponibleActiva) {
            trMain.classList.add('articulo-excluido');
        }
        
        const badgeExcluido = disponibleActiva ? '' : ' <span class="badge" style="background-color: #64748b; color: white; padding: 2px 6px; font-size: 0.75em; border-radius: 4px; vertical-align: middle; margin-left: 5px;">🚫 Excluido</span>';
        
        trMain.innerHTML = `
            <td style="text-align: center; width: 40px;">
                <input type="checkbox" class="chk-articulo-masa" data-articulo-id="${art.articulo_id}" ${window.articulosSeleccionadosMasa.has(art.articulo_id) ? 'checked' : ''} onchange="window.toggleSeleccionArticuloMasa('${art.articulo_id}', this.checked)" style="width: 18px; height: 18px; cursor: pointer;">
            </td>
            <td style="font-family: monospace; font-weight: bold; color: #3b82f6;">${art.articulo_id}</td>
            <td>
                <strong>${art.descripcion}</strong>${badgeExcluido}<br>
                <span style="font-size: 0.8em; color: #64748b;">${art.rubro || 'Sin Rubro'} > ${art.sub_rubro || ''}</span>
            </td>
            <td style="font-family: monospace; font-size: 0.9em;">${art.descripcion_generada || '-'}</td>
            <td>${propSummary}</td>
            <td style="text-align: center; color: #475569;">${ivaStr}</td>
            <td style="text-align: right; color: #0f172a;">${costoSivaStr}</td>
            <td style="text-align: right; color: #ea580c;">${iibbStr}</td>
            <td style="text-align: right; color: #16a34a; font-weight: bold;">${gananciaNetaStr}</td>
            <td style="text-align: right; background-color: #f8fafc;">
                ${precioFinalDinamicoHtml}
            </td>
            <td style="text-align: right; border-left: 1px dashed #cbd5e1;" title="Click en flecha para ver Desglose Financiero">
                ${toggleIcon} ${margenPrincipalText}
            </td>
            <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${art.stock_unidades > 0 ? 'color: #3b82f6;' : 'color: #ef4444; opacity: 0.7;'}">
                ${stockFormatter.format(art.stock_unidades || 0)}
            </td>
            <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${art.stock_kilos > 0 ? 'color: #10b981;' : 'color: #ef4444; opacity: 0.7;'}">
                ${stockFormatter.format(art.stock_kilos || 0)}
            </td>
            <td style="text-align: center; font-weight: bold; font-size: 1.1em; ${art.stock_legacy > 0 ? 'color: #7c3aed;' : 'color: #ef4444; opacity: 0.7;'}">
                ${stockFormatter.format(art.stock_legacy || 0)}
            </td>
            <td style="text-align: center;">
                <button type="button" class="btn-edit" style="background-color: #64748b; padding: 6px 10px; font-size: 0.85em;" onclick="window.mostrarPopoverListas(event, '${art.articulo_id}')">📋 Listas</button>
            </td>
            <td style="text-align: center;">
                <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
                    <button type="button" style="background: #8e4785; color: white; padding: 8px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; display: flex; gap: 5px; align-items: center; box-shadow: 0 2px 4px rgba(142,71,133,0.15);" onclick="abrirGestorPrecios('${art.articulo_id}', '${art.descripcion_generada || art.descripcion}', ${iva})" title="Gestor de Precios Independiente">
                        💰 Finanzas
                    </button>
                    <button class="btn-edit" onclick="editarArticulo('${art.articulo_id}')">✏️ Editar</button>
                    <button class="btn-edit" style="background-color: #10b981;" onclick="imprimirEtiquetaBunker('${art.articulo_id}')" title="Imprimir Etiqueta Asimétrica Doble (Zebra)">🖨️ Imprimir</button>
                    <button type="button" style="background: transparent; border: none; cursor: pointer; font-size: 1.3em; padding: 0; display: flex; transition: transform 0.2s; color: #ef4444;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="Eliminar del Búnker" onclick="eliminarArticuloBunker('${art.articulo_id}')">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(trMain);

        if (hasMargins) {
            const trDetails = document.createElement('tr');
            trDetails.id = `details_${rowIndex}`;
            trDetails.className = 'expandable-row';
            trDetails.innerHTML = `
                <td colspan="16" style="padding: 10px 40px; background-color: #f1f5f9;">
                    <div style="margin-bottom: 5px; font-weight: 600; color: #334155; font-size: 0.9em;">👇 Desglose Financiero de Listas de Precios Búnker</div>
                    ${expandedGridHtml}
                </td>
            `;
            tbody.appendChild(trDetails);
        }
    });

    // Actualizar checkbox maestro basado en artículos elegibles visibles
    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
    if (masterCheckbox) {
        const eligibleIds = articulos.filter(a => {
            const mFocused = a.margenes ? a.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) : null;
            const disponibleActiva = mFocused ? (mFocused.disponible !== false) : true;
            const isBaja = a._estado_delta === 'BAJA' || a.estado === 'BAJA';
            return disponibleActiva && !isBaja;
        }).map(a => a.articulo_id);
        const allChecked = eligibleIds.length > 0 && eligibleIds.every(id => window.articulosSeleccionadosMasa.has(id));
        masterCheckbox.checked = allChecked;
    }
    window.actualizarEstadoBotonMasivo();
}

window.toggleRow = function(targetId, elIcon) {
    const row = document.getElementById(targetId);
    if (!row) return;
    if (row.classList.contains('open')) {
        row.classList.remove('open');
        elIcon.innerText = '▶';
    } else {
        row.classList.add('open');
        elIcon.innerText = '▼';
    }
};

window.editarArticulo = function(id) {
    window.location.href = `bunker.html?edit=${encodeURIComponent(id)}`;
};

window.eliminarArticuloBunker = async function(id) {
    Swal.fire({
        title: 'Baja del Búnker',
        text: '¿Está seguro que desea eliminar este artículo del Búnker? Esta acción no afectará al sistema Lomasoft, pero se perderán los atributos y márgenes configurados localmente.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar Definitivamente',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Procesando Baja...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const response = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(id)}`, {
                    method: 'DELETE'
                });
                const res = await response.json();
                
                if (response.ok && res.success) {
                    Swal.fire({
                        title: 'Eliminado',
                        text: 'El artículo ha sido purgado del ecosistema Búnker.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', res.error || 'No se pudo eliminar el artículo', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar comunicarse con el servidor.', 'error');
            }
        }
    });
};

// ==========================================
// MÓDULO: GESTOR DE PRECIOS PARALELO (AVANZADO)
// ==========================================

let gp_listasFinancieras = [];
let gp_activeTabIdx = 0;
let gp_ivaGlobal = 21;
let gp_liveIngredienteCost = 0;
let gp_loteVal = null;
let gp_stockUnidadesVal = 0;
let gp_stockKilosVal = 0;
let gp_factorPresentacion = 1.00;

// Utilidad de Debounce estándar en español
function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

const debouncedRecalcular = debounce(() => {
    recalcularPreciosGestor();
}, 500);

let gp_costoLomasoftKilo = 0;
let gp_reposicionOfertas = [];

// Variables globales del artículo padre (ingrediente base - Fase 4)
let gp_packHijoCodigo = null;
let gp_parentLote = null;
let gp_parentCostoBaseManual = null;
let gp_parentCostoLomasoft = null;
let gp_parentKilosUnidad = 1;
let gp_parentDescripcion = '';

function renderOfertasReposicion(ofertas) {
    gp_reposicionOfertas = ofertas || [];
    
    // Actualizar el contador dinámico en la cabecera del gestor
    const contadorEl = document.getElementById('gp-reposicion-contador');
    if (contadorEl) {
        const count = gp_reposicionOfertas.length;
        contadorEl.innerText = count > 0 ? `• ${count} oferta${count > 1 ? 's' : ''} seleccionada${count > 1 ? 's' : ''}` : '';
    }

    const container = document.getElementById('gp-ofertas-reposicion-container');
    if (!container) return;

    if (!ofertas || ofertas.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: #64748b; font-style: italic; font-size: 0.82em; padding: 15px;">
                Sin ofertas de reposición vigentes
            </div>
        `;
        return;
    }

    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    let html = '';
    
    ofertas.forEach(of => {
        const costoKilo = of.precio_unitario || 0;
        const costoBulto = gp_factorPresentacion > 0 ? (costoKilo * gp_factorPresentacion) : 0;
        
        const dias = of.dias_antiguedad;
        const badgeText = dias === 0 ? 'Hoy' : `Hace ${dias} día${dias > 1 ? 's' : ''}`;
        
        const heredadoBadge = of.heredado ? `<span style="font-size: 0.76em; background: #fef3c7; color: #d97706; border: 1px solid #fde68a; padding: 0px 4px; border-radius: 3px; font-weight: 700; margin-left: 5px;">Heredado</span>` : '';
        
        html += `
            <div class="reposicion-offer-card" onclick="window.aplicarCostoBaseManual(${costoKilo})" style="display: flex; flex-direction: column; gap: 4px; padding: 8px; background: white; border: 1px solid #e9d5ff; border-radius: 6px; font-size: 0.82em; box-shadow: 0 1px 2px rgba(107, 33, 168, 0.05);" title="Haga clic para inyectar este costo ($${costoKilo.toFixed(2)}/kg) en la calculadora">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: #6b21a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; display: flex; align-items: center;" title="${of.nombre_proveedor}">${of.nombre_proveedor}${heredadoBadge}</span>
                    <span class="badge" style="font-size: 0.78em; background: #faf5ff; color: #6b21a8; border: 1px solid #e9d5ff; padding: 1px 6px; border-radius: 4px; font-weight: 600;">
                        ${badgeText}
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-family: monospace; font-size: 1.15em; border-top: 1px dashed rgba(107, 33, 168, 0.15); padding-top: 4px;">
                    <span style="color: #64748b;">${costoKilo > 0 ? currencyFormatter.format(costoKilo) + '/kg' : 'N/A'}</span>
                    <strong style="color: #6b21a8;">${costoBulto > 0 ? currencyFormatter.format(costoBulto) + '/blt' : 'N/A'}</strong>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

window.abrirGestorPrecios = async function(articulo_id, descripcion, iva) {
    document.getElementById('gp-producto').innerText = descripcion;
    document.getElementById('gp-articulo-id').value = articulo_id;
    gp_ivaGlobal = parseFloat(iva) || 21;
    gp_activeTabIdx = 0;
    
    // Reset global parent variables (Fase 4)
    gp_packHijoCodigo = null;
    gp_parentLote = null;
    gp_parentCostoBaseManual = null;
    gp_parentCostoLomasoft = null;
    gp_parentKilosUnidad = 1;
    gp_parentDescripcion = '';
    
    const alertPadreDiv = document.getElementById('gp-alerta-ingrediente-padre');
    if (alertPadreDiv) alertPadreDiv.style.display = 'none';
    
    // UI Reset
    document.getElementById('gp-costo-integrado').innerText = '$ 0,00';
    document.getElementById('gp-costo-manual').value = '';
    document.getElementById('gp-buscar-insumo').value = '';
    document.getElementById('gp-insumos-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando...</td></tr>';
    document.getElementById('gp-receta-ingredientes').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic;">Cargando estructura de receta...</div>';
    document.getElementById('gp-tabs-container').innerHTML = '<span style="color:#64748b; font-style:italic; padding: 5px;">Cargando listas...</span>';
    document.getElementById('gp-alerta-desactualizado').style.display = 'none';
    const simDescEl = document.getElementById('gp-sim-descuento');
    if (simDescEl) simDescEl.value = '0';

    document.getElementById('modal-gestor-precios').style.display = 'flex';
    
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articulo_id)}`);
        const result = await res.json();
        
        if (res.ok && result.success) {
            const data = result.data;
            
            // Poblar variables globales del artículo padre (Fase 4)
            gp_packHijoCodigo = data.pack_hijo_codigo || null;
            gp_parentLote = data.parent_lote || null;
            gp_parentCostoBaseManual = data.parent_costo_base_manual !== undefined && data.parent_costo_base_manual !== null ? parseFloat(data.parent_costo_base_manual) : null;
            gp_parentCostoLomasoft = data.parent_costo_lomasoft !== undefined && data.parent_costo_lomasoft !== null ? parseFloat(data.parent_costo_lomasoft) : null;
            gp_parentKilosUnidad = parseFloat(data.parent_kilos_unidad) || 1;
            gp_parentDescripcion = data.parent_descripcion || '';

            gp_loteVal = data.lote;
            gp_stockUnidadesVal = data.stock_unidades || 0;
            gp_stockKilosVal = data.stock_kilos || 0;
            gp_factorPresentacion = parseFloat(data.kilos_unidad) > 0 ? parseFloat(data.kilos_unidad) : 1.00;
            
            const factorEl = document.getElementById('gp-factor-presentacion');
            if (factorEl) {
                factorEl.innerText = `${gp_factorPresentacion.toFixed(2)} kg`;
            }
            
            // Calcular Costo de Ingrediente en Vivo por KILO (Costo de Producción Origen) (Comentarios en español)
            let rawIngredienteCost = 0;
            if (data.receta_id && data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                let recipeTotalCost = 0;
                data.receta_ingredientes.forEach(ing => {
                    const cKilo = parseFloat(ing.costo_patron) || 0; // Utilizar costo patrón dinámico resuelto
                    const qty = parseFloat(ing.cantidad) || 0;
                    recipeTotalCost += cKilo * qty;
                });
                // La receta representa el costo del bulto total, lo dividimos por el factor para tener el costo por kilo
                rawIngredienteCost = recipeTotalCost / gp_factorPresentacion;
            }
            if (rawIngredienteCost === 0) {
                if (data.lote) {
                    // El costo del lote directo ya está expresado por kilogramo
                    rawIngredienteCost = parseFloat(data.lote.costo_kilo_al_momento) || 0;
                } else {
                    // El costo manual guardado representa el bulto total, por ende lo dividimos para obtener costo por kilo
                    rawIngredienteCost = (parseFloat(data.costo_base_manual) || 0) / gp_factorPresentacion;
                }
            }
            gp_liveIngredienteCost = rawIngredienteCost;

            // Despliegue Informativo y Normalizado de Costo Lomasoft (Fase 1: Multi-Fuente)
            // Decisión de diseño: Se formatea el bulto y se divide por el factor para tener el costo por kilo normalizado.
            // Se inyecta también la alícuota impositiva legacy en formato de porcentaje.
            const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
            const costoLomasoftBulto = parseFloat(data.costo_lomasoft) || 0;
            const costoLomasoftKilo = gp_factorPresentacion > 0 ? (costoLomasoftBulto / gp_factorPresentacion) : 0;
            gp_costoLomasoftKilo = costoLomasoftKilo;

            const lomaValEl = document.getElementById('gp-costo-lomasoft-val');
            const lomaBultoEl = document.getElementById('gp-costo-lomasoft-bulto');
            const lomaIvaEl = document.getElementById('gp-iva-lomasoft-val');
            if (lomaValEl && lomaBultoEl && lomaIvaEl) {
                lomaValEl.innerText = costoLomasoftKilo > 0 ? currencyFormatter.format(costoLomasoftKilo) : 'N/A';
                lomaBultoEl.innerText = costoLomasoftBulto > 0 ? currencyFormatter.format(costoLomasoftBulto) : 'N/A';
                
                const ivaLomasoftVal = parseFloat(data.iva_lomasoft);
                lomaIvaEl.innerText = !isNaN(ivaLomasoftVal) ? `${ivaLomasoftVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : 'N/A';
                
                // Click-to-Calculate interactivo
                if (costoLomasoftKilo > 0) {
                    lomaValEl.className = 'clickable-cost-val lomasoft';
                    lomaValEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${costoLomasoftKilo})`);
                    lomaValEl.title = `Haga clic para inyectar este costo ($${costoLomasoftKilo.toFixed(2)}/kg)`;
                } else {
                    lomaValEl.className = '';
                    lomaValEl.removeAttribute('onclick');
                    lomaValEl.removeAttribute('title');
                }
            }

            // Despliegue Informativo de Lote Reciente Embudo (Fase 2: Multi-Fuente)
            // Decisión de diseño: Si no existe el lote, mostramos 'Sin registros' de forma explícita.
            const loteValEl = document.getElementById('gp-costo-lote-val');
            const loteBultoEl = document.getElementById('gp-costo-lote-bulto');
            const loteIvaEl = document.getElementById('gp-iva-lote-val');
            const loteFechaEl = document.getElementById('gp-lote-fecha-val');

            if (loteValEl && loteBultoEl && loteIvaEl && loteFechaEl) {
                if (data.lote) {
                    const costoLoteKilo = parseFloat(data.lote.costo_kilo_al_momento) || 0;
                    const costoLoteBulto = gp_factorPresentacion > 0 ? (costoLoteKilo * gp_factorPresentacion) : 0;
                    const ivaLoteVal = parseFloat(data.lote.impuesto_iva);
                    
                    let fechaFmt = 'N/A';
                    if (data.lote.fecha_vinculacion) {
                        const dateObj = new Date(data.lote.fecha_vinculacion);
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const year = dateObj.getFullYear();
                        fechaFmt = `${day}/${month}/${year}`;
                    }

                    loteValEl.innerText = costoLoteKilo > 0 ? currencyFormatter.format(costoLoteKilo) : 'N/A';
                    loteBultoEl.innerText = costoLoteBulto > 0 ? currencyFormatter.format(costoLoteBulto) : 'N/A';
                    loteIvaEl.innerText = !isNaN(ivaLoteVal) ? `${ivaLoteVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : 'N/A';
                    loteFechaEl.innerText = fechaFmt;
                    
                    loteValEl.style.color = '#10b981';
                    loteBultoEl.style.color = '#10b981';
                    loteIvaEl.style.color = '#10b981';
                    loteFechaEl.style.color = '#10b981';
                    
                    // Click-to-Calculate interactivo
                    if (costoLoteKilo > 0) {
                        loteValEl.className = 'clickable-cost-val lote';
                        loteValEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${costoLoteKilo})`);
                        loteValEl.title = `Haga clic para inyectar este costo ($${costoLoteKilo.toFixed(2)}/kg)`;
                    } else {
                        loteValEl.className = '';
                        loteValEl.removeAttribute('onclick');
                        loteValEl.removeAttribute('title');
                    }
                } else {
                    loteValEl.innerText = 'Sin registros';
                    loteBultoEl.innerText = 'Sin registros';
                    loteIvaEl.innerText = 'Sin registros';
                    loteFechaEl.innerText = 'Sin registros';
                    
                    loteValEl.style.color = '#64748b';
                    loteBultoEl.style.color = '#64748b';
                    loteIvaEl.style.color = '#64748b';
                    loteFechaEl.style.color = '#64748b';
                    
                    loteValEl.className = '';
                    loteValEl.removeAttribute('onclick');
                    loteValEl.removeAttribute('title');
                }
            }

            // Sincronización Dinámica de Stock Físico (Ampliación Fase 2)
            // Decisión de diseño: Si el stock es mayor a 0, mostramos en badge verde. Si es 0, mostramos 'Stock: 0' en gris de control.
            const stockBadgeEl = document.getElementById('gp-lote-stock-badge');
            if (stockBadgeEl) {
                const stockUnidades = parseFloat(data.stock_unidades) || 0;
                const stockKilos = parseFloat(data.stock_kilos) || 0;
                
                if (stockUnidades > 0) {
                    stockBadgeEl.innerText = `Stock: ${stockUnidades.toLocaleString('es-AR', { maximumFractionDigits: 2 })} u. (${stockKilos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg)`;
                    stockBadgeEl.style.background = '#dcfce7';
                    stockBadgeEl.style.color = '#166534';
                    stockBadgeEl.style.borderColor = '#bbf7d0';
                } else {
                    stockBadgeEl.innerText = 'Stock: 0';
                    stockBadgeEl.style.background = '#f1f5f9';
                    stockBadgeEl.style.color = '#64748b';
                    stockBadgeEl.style.borderColor = '#cbd5e1';
                }
            }

            // Sincronización impositiva de IVA en la Calculadora de Precios superior
            const loteIvaCalcEl = document.getElementById('gp-iva-lote-val-calc');
            if (loteIvaCalcEl) {
                if (data.lote) {
                    const ivaVal = parseFloat(data.lote.impuesto_iva);
                    loteIvaCalcEl.innerText = !isNaN(ivaVal) ? `${ivaVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : 'N/A';
                } else {
                    const ivaVal = parseFloat(data.porcentaje_iva) || 21.00;
                    loteIvaCalcEl.innerText = `${ivaVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
                }
            }

            // TARJETA 3: COSTO COMPUESTO POR RECETA / INGREDIENTES (Fase 3)
            // Decisión de diseño: Renderizar el costo por receta de forma elástica en azul, o 'Sin registros' si no posee receta.
            const recKiloEl = document.getElementById('gp-costo-receta-kilo');
            const recBultoEl = document.getElementById('gp-costo-receta-bulto');
            const recTipoEl = document.getElementById('gp-receta-tipo-val');
            const recBadgeEl = document.getElementById('gp-receta-origen-badge');

            if (recKiloEl && recBultoEl && recTipoEl && recBadgeEl) {
                const hasRecipe = !!data.receta_id;
                const hasParentIng = !!data.costo_referencia_lote || !!data.pack_hijo_codigo;

                if (hasRecipe || hasParentIng) {
                    let recKiloVal = gp_liveIngredienteCost;
                    let estructuraTipo = hasRecipe ? 'Receta' : 'Insumo Padre';
                    let origenTexto = hasRecipe ? `ID: ${data.receta_id}` : `PADRE: ${data.nombre_ingrediente_ref || 'Granel'}`;

                    // Exposición del artículo ingrediente base padre en la Tarjeta 3 si es una fracción derivada (Fase 4)
                    if (!hasRecipe && data.pack_hijo_codigo) {
                        let parentCost = 0;
                        if (data.parent_lote) {
                            parentCost = parseFloat(data.parent_lote.costo_kilo_al_momento) || 0;
                        } else if (data.parent_costo_base_manual !== null) {
                            parentCost = parseFloat(data.parent_costo_base_manual) / parseFloat(data.parent_kilos_unidad || 1);
                        } else if (data.parent_costo_lomasoft !== null) {
                            parentCost = parseFloat(data.parent_costo_lomasoft) / parseFloat(data.parent_kilos_unidad || 1);
                        }
                        
                        recKiloVal = parentCost;
                        estructuraTipo = 'Ingrediente Base';
                        origenTexto = `PADRE: ${data.parent_descripcion || data.pack_hijo_codigo}`;
                    }

                    const recBultoVal = recKiloVal * gp_factorPresentacion;

                    recKiloEl.innerText = recKiloVal > 0 ? currencyFormatter.format(recKiloVal) : 'N/A';
                    recBultoEl.innerText = recBultoVal > 0 ? currencyFormatter.format(recBultoVal) : 'N/A';
                    recTipoEl.innerText = estructuraTipo;
                    recBadgeEl.innerText = origenTexto;

                    recKiloEl.style.color = '#0284c7';
                    recBultoEl.style.color = '#0284c7';
                    recTipoEl.style.color = '#0284c7';
                    
                    recBadgeEl.style.background = '#e0f2fe';
                    recBadgeEl.style.color = '#0369a1';
                    recBadgeEl.style.borderColor = '#bae6fd';
                    
                    // Click-to-Calculate interactivo
                    if (recKiloVal > 0) {
                        recKiloEl.className = 'clickable-cost-val receta';
                        recKiloEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${recKiloVal})`);
                        recKiloEl.title = `Haga clic para inyectar este costo ($${recKiloVal.toFixed(2)}/kg) en la calculadora`;
                    } else {
                        recKiloEl.className = '';
                        recKiloEl.removeAttribute('onclick');
                        recKiloEl.removeAttribute('title');
                    }
                } else {
                    recKiloEl.innerText = 'Sin registros';
                    recBultoEl.innerText = 'Sin registros';
                    recTipoEl.innerText = 'N/A';
                    recBadgeEl.innerText = 'Sin registros';

                    recKiloEl.style.color = '#64748b';
                    recBultoEl.style.color = '#64748b';
                    recTipoEl.style.color = '#64748b';

                    recBadgeEl.style.background = '#f1f5f9';
                    recBadgeEl.style.color = '#64748b';
                    recBadgeEl.style.borderColor = '#cbd5e1';
                    
                    recKiloEl.className = '';
                    recKiloEl.removeAttribute('onclick');
                    recKiloEl.removeAttribute('title');
                }
            }

            // Renderizar la Receta Activa de Origen
            const recetaInfoBadge = document.getElementById('gp-receta-info-badge');
            const recetaIngredientes = document.getElementById('gp-receta-ingredientes');
            if (recetaInfoBadge && recetaIngredientes) {
                if (data.receta_id) {
                    recetaInfoBadge.innerText = `RECETA ID: ${data.receta_id}`;
                    recetaInfoBadge.style.background = '#dbeafe';
                    recetaInfoBadge.style.color = '#1e40af';
                    
                    let html = '';
                    if (data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
                        let rowsHtml = '';
                        let recetaTotalCost = 0;
                        
                        data.receta_ingredientes.forEach(ing => {
                            const costoUnitario = parseFloat(ing.costo_patron || 0);
                            const cantidad = parseFloat(ing.cantidad || 0);
                            const subtotal = cantidad * costoUnitario;
                            recetaTotalCost += subtotal;
                            
                            rowsHtml += `
                                <tr style="border-bottom: 1px solid #cbd5e1;">
                                    <td style="padding: 10px 12px; text-align: left; font-weight: 600; color: #1e293b;">
                                        ${ing.nombre_ingrediente}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: center; font-family: monospace; font-weight: bold; color: #475569; background: #f8fafc;">
                                        ${cantidad.toLocaleString('es-AR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} ${ing.unidad_medida}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #475569;">
                                        ${costoUnitario > 0 ? currencyFormatter.format(costoUnitario) + '/' + (ing.unidad_medida === 'u' ? 'u' : 'kg') : 'N/A'}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: bold; color: #1e3a8a; background: #f8fafc;">
                                        ${subtotal > 0 ? currencyFormatter.format(subtotal) : 'N/A'}
                                    </td>
                                </tr>
                            `;
                        });

                        recetaIngredientes.style.display = 'block'; // Quitar grid layout para compatibilidad de tabla
                        html = `
                            <table class="tabla-financiera" style="width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                                <thead>
                                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                                        <th style="text-align: left; padding: 10px 12px; color: #475569; font-weight: 700; font-size: 0.88em;">Componente de Receta</th>
                                        <th style="text-align: center; padding: 10px 12px; width: 130px; color: #475569; font-weight: 700; font-size: 0.88em;">Cantidad</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 165px; color: #475569; font-weight: 700; font-size: 0.88em;">Costo Unitario (Patrón)</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 170px; color: #475569; font-weight: 700; font-size: 0.88em;">Subtotal de Línea</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                                <tfoot>
                                    <tr style="background-color: #e2e8f0; font-weight: 800; border-top: 2px solid #94a3b8; font-size: 1.02em;">
                                        <td colspan="3" style="text-align: left; padding: 12px; color: #1e293b;">
                                            💰 Costo Total de Producción (Origen)
                                        </td>
                                        <td id="gp-receta-total-cost-origen" onclick="window.aplicarCostoBaseManual(${recetaTotalCost / gp_factorPresentacion})" class="clickable-cost-val receta" style="text-align: right; padding: 12px; color: #1e3a8a; font-family: monospace; font-size: 1.15em; cursor: pointer;" title="Haga clic para inyectar este costo equivalente ($${(recetaTotalCost / gp_factorPresentacion).toFixed(2)}/kg) en la calculadora">
                                            ${currencyFormatter.format(recetaTotalCost)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        `;
                    }
                    recetaIngredientes.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic; padding: 10px;">La receta no posee ingredientes configurados.</div>';
                } else {
                    recetaInfoBadge.innerText = 'Sin Receta';
                    recetaInfoBadge.style.background = '#fef3c7';
                    recetaInfoBadge.style.color = '#d97706';
                    recetaIngredientes.style.display = 'block'; // Quitar grid
                    recetaIngredientes.innerHTML = `
                        <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 6px; color: #b45309; font-weight: 500; font-size: 0.9em;">
                            ⚠️ Este artículo no posee una receta de producción activa.
                        </div>
                    `;
                }
            }
            
            gp_listasFinancieras = data.listas_margenes;
            renderTabs();
            
            // Sincronizar solapa con la lista activa en la grilla principal (listaSeleccionadaGlobal)
            let targetTabIdx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaSeleccionadaGlobal));
            if (targetTabIdx === -1) {
                targetTabIdx = 0;
            }
            selectTab(targetTabIdx);

            // FASE 4: Costo de Reposición Vivo (Mapeo Manual Curado)
            renderOfertasReposicion(data.reposicion_ofertas || []);
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        console.error("Error opening financial manager:", e);
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};

window.actualizarUiBotonPatron = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    const btn = document.getElementById('gp-btn-patron');
    if (!btn || !list) return;
    
    if (list.es_patron === true || list.es_patron === 'true') {
        btn.innerHTML = '<span>⭐ Patrón Activo</span>';
        btn.style.background = '#8e4785';
        btn.style.color = 'white';
        btn.style.borderColor = '#8e4785';
        btn.style.boxShadow = '0 2px 5px rgba(142, 71, 133, 0.2)';
    } else {
        btn.innerHTML = '<span>☆ Setear como Patrón</span>';
        btn.style.background = 'transparent';
        btn.style.color = '#64748b';
        btn.style.borderColor = '#cbd5e1';
        btn.style.boxShadow = 'none';
    }
};

window.toggleArticuloPatron = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.es_patron = !list.es_patron;
    actualizarUiBotonPatron();
    
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: list.es_patron ? 'Establecido como Artículo Patrón' : 'Quitado estado de Artículo Patrón'
    });
};

window.actualizarTratamientoIva = function(modo) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.modo_iva = modo;
    recalcularPreciosGestor();
};

window.toggleMaximizarGestorPrecios = function() {
    const modalContent = document.getElementById('gp-modal-content');
    const btnMaximizar = document.getElementById('gp-btn-maximizar');
    if (!modalContent || !btnMaximizar) return;
    
    const isMaximized = modalContent.getAttribute('data-maximized') === 'true';
    if (isMaximized) {
        // Restaurar
        modalContent.style.width = '95%';
        modalContent.style.maxWidth = '1150px';
        modalContent.style.height = '';
        modalContent.style.maxHeight = '90vh';
        modalContent.style.borderRadius = '12px';
        btnMaximizar.innerHTML = '🗖';
        btnMaximizar.title = 'Maximizar';
        modalContent.setAttribute('data-maximized', 'false');
    } else {
        // Maximizar
        modalContent.style.width = '100vw';
        modalContent.style.maxWidth = '100vw';
        modalContent.style.height = '100vh';
        modalContent.style.maxHeight = '100vh';
        modalContent.style.borderRadius = '0';
        btnMaximizar.innerHTML = '🗗';
        btnMaximizar.title = 'Restaurar';
        modalContent.setAttribute('data-maximized', 'true');
    }
};

window.cerrarGestorPrecios = function() {
    document.getElementById('modal-gestor-precios').style.display = 'none';
    const modalContent = document.getElementById('gp-modal-content');
    const btnMaximizar = document.getElementById('gp-btn-maximizar');
    if (modalContent && modalContent.getAttribute('data-maximized') === 'true') {
        modalContent.style.width = '95%';
        modalContent.style.maxWidth = '1150px';
        modalContent.style.height = '';
        modalContent.style.maxHeight = '90vh';
        modalContent.style.borderRadius = '12px';
        if (btnMaximizar) {
            btnMaximizar.innerHTML = '🗖';
            btnMaximizar.title = 'Maximizar';
        }
        modalContent.setAttribute('data-maximized', 'false');
    }
};

/**
 * MÓDULO INTERACTIVO BÚNKER - CLICK-TO-CALCULATE
 * Inyecta un costo base seleccionado por el operador directamente en la calculadora superior.
 */
window.aplicarCostoBaseManual = function(costVal) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // Blindaje de nulos
    if (costVal === undefined || costVal === null || isNaN(costVal) || costVal <= 0) return;
    
    // Desactivar la herencia automática
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    if (heredarCheckbox) {
        heredarCheckbox.checked = false;
    }
    
    // Guardar y poblar valor manual
    list.costo_base_sobrescrito = parseFloat(costVal);
    
    const manualInput = document.getElementById('gp-costo-manual');
    if (manualInput) {
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
        manualInput.value = parseFloat(costVal).toFixed(2);
        
        // Efecto visual premium glow verde instantáneo
        manualInput.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.6)';
        manualInput.style.borderColor = '#10b981';
        setTimeout(() => {
            manualInput.style.boxShadow = 'none';
            manualInput.style.borderColor = '#cbd5e1';
        }, 1500);
    }
    
    // Cadena polinómica de recálculo reactivo en tiempo real
    recalcularPreciosGestor();
    
    // Confirmación visual Toast
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: `Costo Kilo Base aplicado: $${parseFloat(costVal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg`
    });
};

/**
 * MÓDULO INTERACTIVO BÚNKER - DEFAULT PINNING
 * Alterna y fija la fuente de costos predeterminada para la lista de precios activa.
 */
window.establecerFuenteDefault = function(event, fuente) {
    if (event) event.stopPropagation(); // Evitar cascada de clics
    
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // Validar si la fuente tiene registros válidos (Anti-Erreores)
    if (fuente === 'LOMASOFT' && !(gp_costoLomasoftKilo > 0)) return;
    if (fuente === 'LOTE' && !gp_loteVal) return;
    if (fuente === 'RECETA' && !(gp_liveIngredienteCost > 0)) return;
    if (fuente === 'REPOSICION' && !(gp_reposicionOfertas && gp_reposicionOfertas.length > 0)) return;
    
    // Alternar selección (Toggle)
    if (list.fuente_costo_default === fuente) {
        list.fuente_costo_default = null;
    } else {
        list.fuente_costo_default = fuente;
    }
    
    // Sincronizar visual de pines
    window.actualizarUiPines();
    
    // Toast de convalidación
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    Toast.fire({
        icon: 'success',
        title: list.fuente_costo_default 
          ? `Fuente '${fuente}' fijada como predeterminada`
          : 'Fijación de fuente desmarcada'
    });
};

/**
 * Sincroniza visualmente el estado de los pines 📌 activos y pasivos.
 */
window.actualizarUiPines = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const activeFuente = list.fuente_costo_default;
    
    const syncPin = (pinId, fuenteName, isValid) => {
        const el = document.getElementById(pinId);
        if (!el) return;
        
        if (!isValid) {
            el.className = 'gp-pin-btn disabled';
            return;
        }
        
        if (activeFuente === fuenteName) {
            el.className = 'gp-pin-btn active';
            el.title = `Fijado como predeterminado (${fuenteName})`;
        } else {
            el.className = 'gp-pin-btn';
            el.title = `Fijar '${fuenteName}' como predeterminado`;
        }
    };
    
    syncPin('gp-pin-lomasoft', 'LOMASOFT', gp_costoLomasoftKilo > 0);
    syncPin('gp-pin-lote', 'LOTE', !!gp_loteVal);
    syncPin('gp-pin-receta', 'RECETA', gp_liveIngredienteCost > 0);
    syncPin('gp-pin-reposicion', 'REPOSICION', gp_reposicionOfertas && gp_reposicionOfertas.length > 0);
};

/**
 * Obtiene el valor numérico en caliente de la fuente default seleccionada.
 */
window.obtenerValorFuenteDefault = function(fuente) {
    if (fuente === 'LOMASOFT' && gp_costoLomasoftKilo > 0) {
        return gp_costoLomasoftKilo;
    }
    if (fuente === 'LOTE' && gp_loteVal) {
        return parseFloat(gp_loteVal.costo_kilo_al_momento);
    }
    if (fuente === 'RECETA' && gp_liveIngredienteCost > 0) {
        return gp_liveIngredienteCost;
    }
    if (fuente === 'REPOSICION' && gp_reposicionOfertas && gp_reposicionOfertas.length > 0) {
        return parseFloat(gp_reposicionOfertas[0].precio_unitario);
    }
    return null;
};

function renderTabs() {
    const tabsContainer = document.getElementById('gp-tabs-container');
    tabsContainer.innerHTML = '';
    
    gp_listasFinancieras.forEach((list, idx) => {
        const tab = document.createElement('button');
        tab.className = `btn-secondary`;
        tab.style.cssText = `padding: 8px 16px; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s; border-bottom: 2px solid transparent;`;
        
        if (idx === gp_activeTabIdx) {
            tab.style.background = '#8e4785';
            tab.style.color = 'white';
        } else {
            tab.style.background = '#f1f5f9';
            tab.style.color = '#475569';
        }
        tab.innerText = list.nombre_lista;
        tab.onclick = () => selectTab(idx);
        tabsContainer.appendChild(tab);
    });
}

function selectTab(idx) {
    gp_activeTabIdx = idx;
    renderTabs();
    
    const list = gp_listasFinancieras[idx];
    if (!list) return;
    
    // Ciclo de Apertura Inteligente: Autocompletado desde la fuente predeterminada
    // NO INTERVENCIÓN AUTOMÁTICA EN FRACCIONES: Si es una fracción (gp_packHijoCodigo no es nulo), omitimos el autocompletado para mantener intactos los valores.
    if (list.fuente_costo_default && !gp_packHijoCodigo) {
        const valDefault = window.obtenerValorFuenteDefault(list.fuente_costo_default);
        if (valDefault !== null && valDefault > 0) {
            list.costo_base_sobrescrito = valDefault;
        }
    }
    
    // Configurar Disponibilidad en Catálogo
    const dispCheckbox = document.getElementById('gp-disponibilidad-lista');
    if (dispCheckbox) {
        dispCheckbox.checked = list.disponible !== false;
    }

    // Configurar Exención Operativa de Costos
    const exencionCheckbox = document.getElementById('gp-exencion-operativa');
    if (exencionCheckbox) {
        exencionCheckbox.checked = list.exencion_operativa === true;
    }

    // Configurar Costo Base
    const inherits = list.costo_base_sobrescrito === null;
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    heredarCheckbox.checked = inherits;
    
    const manualInput = document.getElementById('gp-costo-manual');
    if (inherits) {
        manualInput.value = gp_liveIngredienteCost.toFixed(2);
        manualInput.disabled = true;
        manualInput.style.backgroundColor = '#f1f5f9';
    } else {
        manualInput.value = parseFloat(list.costo_base_sobrescrito).toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }
    
    // Configurar Insumos
    renderInsumosGrid();
    
    // Configurar Costo Tiempo
    document.getElementById('gp-costo-tiempo').value = parseFloat(list.costo_tiempo || 0).toFixed(2);
    
    // Configurar IVA y tratamiento impositivo
    const ivaLoteEl = document.getElementById('gp-iva-lote-val');
    if (ivaLoteEl) {
        ivaLoteEl.innerText = `${gp_ivaGlobal.toFixed(2)}%`;
    }
    const modoIvaSelect = document.getElementById('gp-modo-iva-select');
    if (modoIvaSelect) {
        modoIvaSelect.value = list.modo_iva || 'COMPLETO';
    }

    // Configurar estado del botón de Artículo Patrón
    actualizarUiBotonPatron();
    
    // Sincronizar visual de pines 📌
    window.actualizarUiPines();
    
    // Recalcular & renderizar precios
    recalcularPreciosGestor();
}

window.toggleHeredarCosto = function(checked) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const manualInput = document.getElementById('gp-costo-manual');
    if (checked) {
        list.costo_base_sobrescrito = null;
        manualInput.value = gp_liveIngredienteCost.toFixed(2);
        manualInput.disabled = true;
        manualInput.style.backgroundColor = '#f1f5f9';
    } else {
        list.costo_base_sobrescrito = gp_liveIngredienteCost;
        manualInput.value = gp_liveIngredienteCost.toFixed(2);
        manualInput.disabled = false;
        manualInput.style.backgroundColor = 'white';
    }
    recalcularPreciosGestor();
};

function renderInsumosGrid() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    const tbody = document.getElementById('gp-insumos-tbody');
    tbody.innerHTML = '';
    
    let totalInsumos = 0;
    
    if (!list.insumos || list.insumos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8; font-style:italic;">Sin insumos cargados</td></tr>';
        document.getElementById('gp-insumos-total-badge').innerText = '$ 0,00';
        return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    list.insumos.forEach((ins, subIdx) => {
        const qty = parseFloat(ins.cantidad || 1);
        const uCost = parseFloat(ins.costo_unitario_capturado || 0);
        const subtotal = qty * uCost;
        
        const isIncluido = (ins.incluido === true || ins.incluido === 'true');
        if (isIncluido) {
            totalInsumos += subtotal;
        }
        
        // Alerta de desfase en insumo
        const liveCost = parseFloat(ins.costo_unitario_en_vivo || uCost);
        const isDiff = Math.abs(liveCost - uCost) > 0.01;
        const diffBadge = isDiff ? ` <span style="color:#d97706; cursor:help;" title="Live cost: ${formatter.format(liveCost)} (Discrepancia detectada)">⚠️</span>` : '';
        
        const activeText = isIncluido ? 'Incluido' : 'Excluido';
        const activeColor = isIncluido ? '#15803d' : '#ef4444';
        const activeBg = isIncluido ? '#dcfce7' : '#fef2f2';
        const activeBorder = isIncluido ? '#bbf7d0' : '#fecaca';

        const tr = document.createElement('tr');
        tr.style.opacity = isIncluido ? '1' : '0.75';
        tr.style.backgroundColor = isIncluido ? 'transparent' : '#f8fafc';
        
        tr.innerHTML = `
            <td>
                <strong>${ins.descripcion || ins.insumo_articulo_numero}</strong><br>
                <span style="font-family: monospace; font-size: 0.8em; color: #64748b;">${ins.insumo_articulo_numero}</span>
            </td>
            <td>
                <input type="number" step="0.0001" value="${qty}" style="width: 100%; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:center;" oninput="actualizarInsumoQty(${subIdx}, this.value)">
            </td>
            <td style="text-align: right;">
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap: 3px;">
                    <div style="display:flex; justify-content: flex-end; align-items:center; gap: 4px;">
                        <input type="number" step="0.01" value="${uCost.toFixed(2)}" style="width: 70px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:right; font-family: monospace; ${isIncluido ? 'background-color:#f0fdf4;' : 'background-color:#f1f5f9; color:#94a3b8;'}" oninput="actualizarInsumoCost(${subIdx}, this.value)">
                        ${diffBadge}
                    </div>
                    <span onclick="window.toggleInsumoInclusion(${subIdx})" style="cursor:pointer; font-size:0.75em; padding: 2px 6px; border-radius: 4px; font-weight:bold; border: 1px solid ${activeBorder}; background-color:${activeBg}; color:${activeColor}; user-select:none;" title="Haz clic para alternar inclusión de este costo en la calculadora financiera">
                        ${activeText}
                    </span>
                </div>
            </td>
            <td style="text-align: center;">
                <button type="button" style="background:transparent; border:none; cursor:pointer; color:#ef4444; font-size:1.1em;" onclick="removerInsumo(${subIdx})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById('gp-insumos-total-badge').innerText = formatter.format(totalInsumos);
}

window.actualizarInsumoQty = function(idx, val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        list.insumos[idx].cantidad = parseFloat(val) || 0;
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.actualizarInsumoCost = function(idx, val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        list.insumos[idx].costo_unitario_capturado = parseFloat(val) || 0;
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.toggleInsumoInclusion = function(idx) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        const current = list.insumos[idx].incluido;
        list.insumos[idx].incluido = !(current === true || current === 'true');
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.removerInsumo = function(idx) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos) {
        list.insumos.splice(idx, 1);
        propagarCostosOperativos();
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

// Autocomplete buscador de insumos
let insumoTimer = null;
window.buscarInsumoInput = function(val) {
    clearTimeout(insumoTimer);
    const resultsDiv = document.getElementById('gp-insumo-resultados');
    
    if (val.trim().length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    
    insumoTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/api/logistica/bunker/buscar-insumos?q=${encodeURIComponent(val)}`);
            const result = await res.json();
            
            if (res.ok && result.success && result.data.length > 0) {
                resultsDiv.innerHTML = '';
                result.data.forEach(art => {
                    const row = document.createElement('div');
                    row.style.cssText = 'padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e2e8f0; hover: background-color: #f8fafc;';
                    row.innerHTML = `<strong>${art.descripcion}</strong> <span style="font-family:monospace; color:#64748b;">(${art.id})</span>`;
                    row.onclick = () => selectInsumoParaAgregar(art);
                    resultsDiv.appendChild(row);
                });
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.style.display = 'none';
            }
        } catch(e) {
            console.error('Error fetching insumos:', e);
        }
    }, 300);
};

function selectInsumoParaAgregar(art) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    if (!list.insumos) list.insumos = [];
    
    // Evitar duplicados en el mismo artículo
    if (list.insumos.some(ins => ins.insumo_articulo_numero === art.id)) {
        Swal.fire('Insumo ya agregado', 'El insumo secundario ya figura cargado en esta lista.', 'info');
        document.getElementById('gp-buscar-insumo').value = '';
        document.getElementById('gp-insumo-resultados').style.display = 'none';
        return;
    }
    
    list.insumos.push({
        insumo_articulo_numero: art.id,
        descripcion: art.descripcion,
        cantidad: 1.0000,
        costo_unitario_capturado: parseFloat(art.costo_base || 0),
        costo_unitario_en_vivo: parseFloat(art.costo_base || 0),
        incluido: false // HITL: Desactivado por defecto al agregarlo
    });
    
    propagarCostosOperativos();
    document.getElementById('gp-buscar-insumo').value = '';
    document.getElementById('gp-insumo-resultados').style.display = 'none';
    renderInsumosGrid();
    recalcularPreciosGestor();
}

// Lógica de cálculo bidireccional y alertas
window.recalcularPreciosGestor = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    // 1. Obtener Costos
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    const isHeredar = heredarCheckbox.checked;
    
    const manualInputVal = parseFloat(document.getElementById('gp-costo-manual').value) || 0;
    if (isHeredar) {
        list.costo_base_sobrescrito = null;
    } else {
        list.costo_base_sobrescrito = manualInputVal;
    }
    
    const cBase = isHeredar ? gp_liveIngredienteCost : manualInputVal;
    
    // Sumar insumos secundarios (a nivel bulto)
    let cInsumos = 0;
    if (list.insumos && list.insumos.length > 0) {
        list.insumos.forEach(ins => {
            if (ins.incluido === true || ins.incluido === 'true') {
                cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
            }
        });
    }
    
    const cTiempo = parseFloat(document.getElementById('gp-costo-tiempo').value) || 0;
    list.costo_tiempo = cTiempo;
    
    // Costo base por kilo
    document.getElementById('gp-costo-integrado').innerText = formatter.format(cBase);
    
    // Costo Total de la Presentación (Costo Bulto Base: Costo Kilo * Factor)
    const cTotalPresentacion = cBase * gp_factorPresentacion;
    
    // Costo Total del Bulto Integrado (sumando insumos secundarios)
    const cBulto = cTotalPresentacion + cInsumos;
    const bultoEl = document.getElementById('gp-costo-bulto-val');
    if (bultoEl) {
        bultoEl.innerText = formatter.format(cBulto);
    }
    
    const modoIva = document.getElementById('gp-modo-iva-select').value || 'COMPLETO';
    list.modo_iva = modoIva;
    let ivaVal = gp_ivaGlobal;
    if (modoIva === 'MEDIO') {
        ivaVal = gp_ivaGlobal / 2;
    } else if (modoIva === 'SIN') {
        ivaVal = 0.00;
    }
    list.iva = ivaVal;
    const ivaCoeff = 1 + (ivaVal / 100);
    
    // 2. Modos de cálculo bidireccionales
    const margenInput = document.getElementById('gp-margen');
    let margen = parseFloat(list.margen_ganancia) || parseFloat(list.margen_porcentaje) || 0;
    let usandoHeredado = false;
    
    // Aplicar herencia parental del patrón si el margen de este es 0 y posee patrón (solo si es AUTOMÁTICO y no fue sobrescrito a mano)
    if (list.modo_calculo === 'AUTOMATIC' && !list.has_manual_override && margen === 0 && list.margen_patron_heredado !== null && list.margen_patron_heredado !== undefined) {
        margen = parseFloat(list.margen_patron_heredado);
        usandoHeredado = true;
    }

    const advertenciaEl = document.getElementById('gp-margen-advertencia');
    if (margenInput) {
        if (usandoHeredado) {
            margenInput.style.border = '2px solid #8e4785';
            margenInput.style.backgroundColor = '#faeef7';
            margenInput.title = `Margen heredado del artículo patrón (${margen.toFixed(2)}%)`;
            if (advertenciaEl) {
                advertenciaEl.innerText = `⚠️ Margen prescrito por Artículo Patrón (${list.descripcion_patron || 'Bolsa 25kg'})`;
                advertenciaEl.style.display = 'block';
            }
        } else {
            margenInput.style.border = '1px solid #cbd5e1';
            margenInput.style.backgroundColor = 'white';
            margenInput.title = '';
            if (advertenciaEl) {
                advertenciaEl.style.display = 'none';
            }
        }
    }

    // Simulación de Descuento
    const simDescEl = document.getElementById('gp-sim-descuento');
    const simDescuentoVal = simDescEl ? (parseFloat(simDescEl.value) || 0) : 0;

    if (list.modo_calculo === 'AUTOMATIC') {
        // Evitar sobreescritura si el usuario está enfocado
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margen.toFixed(2);
        }
        
        // Precio Final del Bulto = [ Costo Total Bulto * (1 + Margen/100) + Costo Tiempo ] * (1 + IVA)
        const precioS_ivaBase = cBulto * (1 + (margen / 100)) + cTiempo;
        const precioFinalBase = precioS_ivaBase * ivaCoeff;
        
        list.precio_final = precioFinalBase;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinalBase.toFixed(2);
        }
        
        // Simulación de Descuento Venta (Casillero Interactivo)
        const precioFinalDescontado = precioFinalBase * (1 - simDescuentoVal / 100);
        const precioS_ivaDescontado = precioFinalDescontado / ivaCoeff;
        
        // Métricas secundarias basadas en el precio descontado
        const iibb = precioFinalDescontado * 0.04;
        const gananciaNeta = precioS_ivaDescontado - cTiempo - cBulto;
        const gananciaSinIIBB = gananciaNeta - iibb;
        
        // Cálculo complementario de IVA y Diferencia a rendir (AFIP)
        const ivaVenta = precioS_ivaDescontado * (ivaVal / 100);
        const ivaCompra = cBulto * (gp_ivaGlobal / 100);
        const diferenciaIva = ivaVenta - ivaCompra;
        const diferenciaARendir = Math.max(0, diferenciaIva);
        const gananciaReal = gananciaSinIIBB - diferenciaARendir;
        
        const simFacturadoEl = document.getElementById('gp-precio-facturado-simulado');
        if (simFacturadoEl) {
            simFacturadoEl.innerText = formatter.format(precioFinalDescontado);
        }
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_ivaDescontado);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        
        const gNetaEl = document.getElementById('gp-ganancia-neta');
        if (gNetaEl) {
            gNetaEl.innerText = formatter.format(gananciaNeta);
            gNetaEl.style.color = gananciaNeta >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gSinIibbEl = document.getElementById('gp-ganancia-sin-iibb');
        if (gSinIibbEl) {
            gSinIibbEl.innerText = formatter.format(gananciaSinIIBB);
            gSinIibbEl.style.color = gananciaSinIIBB >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gRealEl = document.getElementById('gp-ganancia-real');
        if (gRealEl) {
            gRealEl.innerText = formatter.format(gananciaReal);
            gRealEl.style.color = gananciaReal >= 0 ? '#15803d' : '#ef4444'; // Destacado verde si es positivo
        }
    } else {
        // Modo MANUAL
        const precioFinalBase = parseFloat(list.precio_final) || 0;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinalBase.toFixed(2);
        }
        
        // Margen Implícito = ( (Precio Final / (1+IVA) - Costo Tiempo) / Costo Total Bulto - 1 ) * 100
        const precioS_ivaBase = precioFinalBase / ivaCoeff;
        let margenImplicito = 0;
        if (cBulto > 0) {
            margenImplicito = ((precioS_ivaBase - cTiempo) / cBulto - 1) * 100;
        }
        
        list.margen_porcentaje = margenImplicito; // compatibilidad
        list.margen_ganancia = margenImplicito;
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margenImplicito.toFixed(2);
        }
        
        // Simulación de Descuento Venta (Casillero Interactivo)
        const precioFinalDescontado = precioFinalBase * (1 - simDescuentoVal / 100);
        const precioS_ivaDescontado = precioFinalDescontado / ivaCoeff;
        
        // Métricas secundarias basadas en el precio descontado
        const iibb = precioFinalDescontado * 0.04;
        const gananciaNeta = precioS_ivaDescontado - cTiempo - cBulto;
        const gananciaSinIIBB = gananciaNeta - iibb;
        
        // Cálculo complementario de IVA y Diferencia a rendir (AFIP)
        const ivaVenta = precioS_ivaDescontado * (ivaVal / 100);
        const ivaCompra = cBulto * (gp_ivaGlobal / 100);
        const diferenciaIva = ivaVenta - ivaCompra;
        const diferenciaARendir = Math.max(0, diferenciaIva);
        const gananciaReal = gananciaSinIIBB - diferenciaARendir;
        
        const simFacturadoEl = document.getElementById('gp-precio-facturado-simulado');
        if (simFacturadoEl) {
            simFacturadoEl.innerText = formatter.format(precioFinalDescontado);
        }
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_ivaDescontado);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        
        const gNetaEl = document.getElementById('gp-ganancia-neta');
        if (gNetaEl) {
            gNetaEl.innerText = formatter.format(gananciaNeta);
            gNetaEl.style.color = gananciaNeta >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gSinIibbEl = document.getElementById('gp-ganancia-sin-iibb');
        if (gSinIibbEl) {
            gSinIibbEl.innerText = formatter.format(gananciaSinIIBB);
            gSinIibbEl.style.color = gananciaSinIIBB >= 0 ? '#475569' : '#ef4444'; // Color neutro si es positivo
        }
        
        const gRealEl = document.getElementById('gp-ganancia-real');
        if (gRealEl) {
            gRealEl.innerText = formatter.format(gananciaReal);
            gRealEl.style.color = gananciaReal >= 0 ? '#15803d' : '#ef4444'; // Destacado verde si es positivo
        }
    }
    
    // 3. Evaluar alerta de desactualización (costos en vivo vs costo calibrado)
    let liveInsumosCost = 0;
    if (list.insumos) {
        list.insumos.forEach(ins => {
            liveInsumosCost += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado);
        });
    }
    
    // Costo total bulto en caliente: (Costo Ingrediente Kilo * Factor) + Insumos
    const liveCostoTotalBulto = (gp_liveIngredienteCost * gp_factorPresentacion) + liveInsumosCost;
    
    // Calculamos el margen implícito en caliente
    const pS_iva = parseFloat(list.precio_final) / ivaCoeff;
    let margenImplicitoVivo = 0;
    if (liveCostoTotalBulto > 0) {
        margenImplicitoVivo = ((pS_iva - cTiempo) / liveCostoTotalBulto - 1) * 100;
    }
    
    const targetMargen = parseFloat(list.margen_ganancia || list.margen_porcentaje);
    const diff = targetMargen - margenImplicitoVivo;
    const isOutdated = Math.abs(diff) > 0.1;
    
    const alertaDiv = document.getElementById('gp-alerta-desactualizado');
    if (isOutdated && liveCostoTotalBulto > 0) {
        document.getElementById('gp-margen-implicito-val').innerText = margenImplicitoVivo.toFixed(2);
        alertaDiv.style.display = 'flex';
    } else {
        alertaDiv.style.display = 'none';
    }

    // 4. Evaluar alerta de nuevo costo en ingrediente base padre (Fase 4)
    const alertPadreDiv = document.getElementById('gp-alerta-ingrediente-padre');
    if (alertPadreDiv) {
        if (gp_packHijoCodigo) {
            let parentLiveCostKilo = 0;
            if (gp_parentLote) {
                parentLiveCostKilo = parseFloat(gp_parentLote.costo_kilo_al_momento) || 0;
            } else if (gp_parentCostoBaseManual !== null) {
                parentLiveCostKilo = parseFloat(gp_parentCostoBaseManual) / gp_parentKilosUnidad;
            } else if (gp_parentCostoLomasoft !== null) {
                parentLiveCostKilo = parseFloat(gp_parentCostoLomasoft) / gp_parentKilosUnidad;
            }

            // Umbral estricto de desvío de $0.05/kg
            const diffPadre = Math.abs(cBase - parentLiveCostKilo);
            if (parentLiveCostKilo > 0 && diffPadre > 0.05) {
                const pNombreEl = document.getElementById('gp-ingrediente-padre-nombre');
                const fCostoEl = document.getElementById('gp-fraccion-costo-actual-val');
                const pCostoEl = document.getElementById('gp-ingrediente-padre-nuevo-val');
                const btnAplicarPadre = document.getElementById('gp-btn-aplicar-padre');

                if (pNombreEl) pNombreEl.innerText = gp_parentDescripcion || gp_packHijoCodigo;
                if (fCostoEl) fCostoEl.innerText = formatter.format(cBase);
                if (pCostoEl) pCostoEl.innerText = formatter.format(parentLiveCostKilo);
                if (btnAplicarPadre) {
                    btnAplicarPadre.onclick = () => window.aplicarCostoBaseManual(parentLiveCostKilo);
                }

                alertPadreDiv.style.display = 'flex';
            } else {
                alertPadreDiv.style.display = 'none';
            }
        } else {
            alertPadreDiv.style.display = 'none';
        }
    }

    // FASE 4: Actualizar las filas de advertencia y costos en la Tarjeta 3 de ingredientes en caliente
    if (typeof window.actualizarAlertasIngredienteBase === 'function') {
        window.actualizarAlertasIngredienteBase();
    }
};

window.actualizarPorMargen = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.modo_calculo = 'AUTOMATIC';
    list.margen_ganancia = parseFloat(val) || 0;
    list.margen_porcentaje = parseFloat(val) || 0; // compatibilidad
    list.has_manual_override = true; // Desactivar herencia de patrón permanentemente para esta sesión
    
    // UI instant feedback when overriding inheritance
    const margenInput = document.getElementById('gp-margen');
    const advertenciaEl = document.getElementById('gp-margen-advertencia');
    if (margenInput) {
        margenInput.style.border = '1px solid #cbd5e1';
        margenInput.style.backgroundColor = 'white';
        margenInput.title = '';
    }
    if (advertenciaEl) {
        advertenciaEl.style.display = 'none';
    }
    
    debouncedRecalcular();
};

window.actualizarPorPrecio = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.modo_calculo = 'MANUAL';
    list.precio_final = parseFloat(val) || 0;
    list.has_manual_override = true; // Desactivar herencia de patrón permanentemente para esta sesión
    
    debouncedRecalcular();
};

window.actualizarPorCostoTiempo = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.costo_tiempo = parseFloat(val) || 0;
    propagarCostosOperativos();
    debouncedRecalcular();
};

window.actualizarPorCostoManual = function(val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    list.costo_base_sobrescrito = parseFloat(val) || 0;
    debouncedRecalcular();
};

window.sincronizarCostoAlerta = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // 1. Sincronizar Insumos Secundarios a sus costos vivos
    if (list.insumos) {
        list.insumos.forEach(ins => {
            ins.costo_unitario_capturado = parseFloat(ins.costo_unitario_en_vivo || ins.costo_unitario_capturado);
        });
    }
    
    // 2. Si no estaba heredando (costo sobrescrito), forzar la herencia o actualizar al vivo
    const heredarCheckbox = document.getElementById('gp-heredar-costo');
    heredarCheckbox.checked = true;
    list.costo_base_sobrescrito = null;
    document.getElementById('gp-costo-manual').disabled = true;
    document.getElementById('gp-costo-manual').value = gp_liveIngredienteCost.toFixed(2);
    document.getElementById('gp-costo-manual').style.backgroundColor = '#f1f5f9';
    
    // 3. Recalcular precio basándonos en el target de margen original
    list.modo_calculo = 'AUTOMATIC';
    
    Swal.fire({
        title: 'Costo Sincronizado',
        text: 'Los costos base e insumos secundarios han sido sincronizados a sus valores en caliente. Se restableció la rentabilidad original en el cálculo del precio.',
        icon: 'success',
        timer: 3000,
        showConfirmButton: false
    });
    
    propagarCostosOperativos();
    renderInsumosGrid();
    recalcularPreciosGestor();
};

window.guardarEstructuraFinanciera = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    
    // Mapear configuraciones completas para backend
    const configsPayload = gp_listasFinancieras.map(l => {
        // Sincronizar insumos a enviar
        const insPayload = (l.insumos || []).map(ins => ({
            insumo_articulo_numero: ins.insumo_articulo_numero,
            cantidad: parseFloat(ins.cantidad) || 1.0000,
            costo_unitario_capturado: parseFloat(ins.costo_unitario_capturado) || 0,
            incluido: ins.incluido === true || ins.incluido === 'true'
        }));
        
        return {
            lista_id: l.lista_id,
            margen_ganancia: parseFloat(l.margen_ganancia || l.margen_porcentaje) || 0,
            costo_base_sobrescrito: l.costo_base_sobrescrito !== undefined && l.costo_base_sobrescrito !== null ? parseFloat(l.costo_base_sobrescrito) : null,
            costo_tiempo: parseFloat(l.costo_tiempo) || 0,
            iva: parseFloat(l.iva || gp_ivaGlobal) || 21,
            precio_final: parseFloat(l.precio_final) || 0,
            modo_calculo: l.modo_calculo || 'AUTOMATIC',
            modo_iva: l.modo_iva || 'COMPLETO',
            es_patron: l.es_patron === true || l.es_patron === 'true',
            fuente_costo_default: l.fuente_costo_default || null,
            disponible: l.disponible !== false,
            exencion_operativa: l.exencion_operativa === true,
            insumos: insPayload
        };
    });
    
    Swal.fire({ title: 'Guardando Estructuras Financieras...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articulo_id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: configsPayload })
        });
        const result = await res.json();
        
        if (res.ok && result.success) {
            Swal.fire('Guardado Exitoso', 'Estructura financiera y calibración de precios guardada en el Búnker.', 'success');
            cerrarGestorPrecios();
            await cargarDataGrid(); // Refrescar grilla general
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};

window.crearNuevaListaDesdeUI = async function(abrirEnModal = false) {
    Swal.fire({
        title: 'Crear Nueva Lista de Precios Búnker',
        text: 'Ingrese el nombre para la nueva lista de simulación:',
        input: 'text',
        inputPlaceholder: 'Ej: Simulación Trigo, Mayorista Mayo...',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Crear Lista',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'El nombre de la lista no puede estar vacío.';
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const nombre = result.value.trim();
            try {
                Swal.fire({ title: 'Creando Lista...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch('/api/logistica/bunker/listas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, descripcion: 'Simulación dinámica creada desde la UI', activa: true })
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Lista Creada',
                        text: `La lista "${nombre}" ha sido creada exitosamente.`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Refrescar el selector general en la grilla
                    await cargarListasPreciosFiltro();
                    await cargarDataGrid(); // Recargar grilla
                    
                    // Si estamos dentro del modal de finanzas, recargamos la radiografía financiera y enfocamos la nueva pestaña
                    if (abrirEnModal) {
                        const articulo_id = document.getElementById('gp-articulo-id').value;
                        const gp_producto = document.getElementById('gp-producto').innerText;
                        const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                        await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                        
                        // Enfocar la lista recién creada
                        const nuevaListaIdx = gp_listasFinancieras.findIndex(l => l.nombre_lista.toLowerCase() === nombre.toLowerCase());
                        if (nuevaListaIdx !== -1) {
                            selectTab(nuevaListaIdx);
                        }
                    }
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo crear la lista', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

window.renombrarListaActiva = async function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    Swal.fire({
        title: 'Renombrar Lista de Precios',
        text: `Ingrese el nuevo nombre para la lista "${list.nombre_lista}":`,
        input: 'text',
        inputValue: list.nombre_lista,
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Renombrar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
            if (!value || !value.trim()) {
                return 'El nombre no puede estar vacío.';
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const nuevoNombre = result.value.trim();
            if (nuevoNombre === list.nombre_lista) return;
            
            try {
                Swal.fire({ title: 'Actualizando Nombre...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch(`/api/logistica/bunker/listas/${list.lista_id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: nuevoNombre })
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Actualizado',
                        text: 'La lista ha sido renombrada exitosamente.',
                        icon: 'success',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    
                    const articulo_id = document.getElementById('gp-articulo-id').value;
                    const gp_producto = document.getElementById('gp-producto').innerText;
                    const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                    
                    const activeTabBackup = gp_activeTabIdx;
                    await cargarListasPreciosFiltro();
                    await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                    selectTab(activeTabBackup);
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo actualizar el nombre', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

window.eliminarListaActiva = async function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    Swal.fire({
        title: '¿Eliminar Lista de Precios?',
        text: `Esta acción eliminará de forma permanente la lista "${list.nombre_lista}" y todas sus calibraciones de precios e insumos secundarios de artículos. ¿Desea proceder?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar Lista',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Eliminando Lista...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch(`/api/logistica/bunker/listas/${list.lista_id}`, {
                    method: 'DELETE'
                });
                const resJson = await res.json();
                
                if (res.ok && resJson.success) {
                    Swal.fire({
                        title: 'Eliminada',
                        text: 'La lista de precios ha sido purgada.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    const articulo_id = document.getElementById('gp-articulo-id').value;
                    const gp_producto = document.getElementById('gp-producto').innerText;
                    const rawIva = parseFloat(document.getElementById('gp-iva-select').value) || 21;
                    
                    await cargarListasPreciosFiltro();
                    await abrirGestorPrecios(articulo_id, gp_producto, rawIva);
                    // Regresar al primer tab disponible
                    selectTab(0);
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', resJson.error || 'No se pudo eliminar la lista', 'error');
                }
            } catch (e) {
                Swal.fire('Error', 'Fallo de red al intentar conectarse al servidor.', 'error');
            }
        }
    });
};

// --- Persistencia del Configurador en localStorage (LAMDA Work Policy Compliance) ---
let pdfColumnsOrder = [
    { id: 'codigo', label: 'Código', checked: true, align: 'left', baseWidth: 65 },
    { id: 'descripcion', label: 'Descripción', checked: true, align: 'left', baseWidth: 190 },
    { id: 'presentacion', label: 'Presentación', checked: true, align: 'left', baseWidth: 100 },
    { id: 'kilo', label: 'Precio Kilo (Neto)', checked: true, align: 'right', baseWidth: 70 },
    { id: 'bulto', label: 'Precio Bulto (Neto)', checked: true, align: 'right', baseWidth: 70 },
    { id: 'final_kilo', label: 'Precio Kilo Final', checked: true, align: 'right', baseWidth: 70 },
    { id: 'final_bulto', label: 'Precio Bulto Final', checked: true, align: 'right', baseWidth: 70 }
];

window.guardarConfiguracionColumnas = function() {
    try {
        const toSave = pdfColumnsOrder.map(c => ({ id: c.id, checked: c.checked }));
        localStorage.setItem('bunker_pdf_columns_config_v2', JSON.stringify(toSave));
    } catch (e) {
        console.error("Error guardando configuración de columnas:", e);
    }
};

window.cargarConfiguracionColumnas = function() {
    try {
        const stored = localStorage.getItem('bunker_pdf_columns_config_v2');
        if (stored) {
            const loaded = JSON.parse(stored);
            if (Array.isArray(loaded)) {
                const merged = [];
                loaded.forEach(item => {
                    const original = pdfColumnsOrder.find(o => o.id === item.id);
                    if (original) {
                        merged.push({
                            ...original,
                            checked: item.checked !== undefined ? !!item.checked : original.checked
                        });
                    }
                });
                pdfColumnsOrder.forEach(o => {
                    if (!merged.some(m => m.id === o.id)) {
                        merged.push(o);
                    }
                });
                pdfColumnsOrder = merged;
            }
        }
    } catch (e) {
        console.error("Error cargando configuración de columnas:", e);
    }
};

window.renderConfiguradorColumnas = function() {
    const listContainer = document.getElementById('pdf-columns-order-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    
    pdfColumnsOrder.forEach((col, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: white; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9em; box-shadow: 0 1px 2px rgba(0,0,0,0.02); gap: 10px;';
        
        // Izquierda: checkbox + label
        const left = document.createElement('label');
        left.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; color: #334155; margin: 0; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = col.checked;
        chk.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';
        chk.onchange = (e) => {
            col.checked = e.target.checked;
            window.actualizarPrevisualizacionPDF();
        };
        
        const labelSpan = document.createElement('span');
        labelSpan.innerText = col.label;
        
        left.appendChild(chk);
        left.appendChild(labelSpan);
        
        // Derecha: Controles de Flecha Arriba/Abajo 🔼/🔽
        const right = document.createElement('div');
        right.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '🔼';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.9em; padding: 2px; transition: transform 0.1s; outline: none;';
        btnUp.disabled = idx === 0;
        if (idx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverColumnaPDF(idx, idx - 1);
        };
        
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '🔽';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.9em; padding: 2px; transition: transform 0.1s; outline: none;';
        btnDown.disabled = idx === pdfColumnsOrder.length - 1;
        if (idx === pdfColumnsOrder.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverColumnaPDF(idx, idx + 1);
        };
        
        right.appendChild(btnUp);
        right.appendChild(btnDown);
        
        item.appendChild(left);
        item.appendChild(right);
        listContainer.appendChild(item);
    });
};

window.moverColumnaPDF = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= pdfColumnsOrder.length) return;
    
    // Intercambiar
    const temp = pdfColumnsOrder[fromIdx];
    pdfColumnsOrder[fromIdx] = pdfColumnsOrder[toIdx];
    pdfColumnsOrder[toIdx] = temp;
    
    window.renderConfiguradorColumnas();
    window.actualizarPrevisualizacionPDF();
};

window.pdfRubrosState = [];
window.pdfCapaCState = null; // Guardará el estado detallado granular
window.pdfCapaCExpanded = { legacy: false, lotes: false, receta: false, reposicion: false };

// Helper robusto para extracción de valor de ordenamiento Capa D
function obtenerValorOrdenamientoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 0;
    const prop = art.propiedades_dinamicas[attribute];
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

// Helper para obtener el valor formateado comercial de la Capa D
function obtenerValorFormateadoCapaD(art, attribute) {
    if (!art.propiedades_dinamicas) return 'Sin Especificar';
    const prop = art.propiedades_dinamicas[attribute];
    if (!prop) return 'Sin Especificar';
    return typeof prop === 'object' ? prop.valor : prop;
}

// Inicializar el estado de los acordeones y los artículos individuales de la Capa C
window.inicializarCapaCState = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;

    // Obtener artículos asociados a esta lista de precios
    const articulosDeLista = articulosBunkerGlobal.filter(art => {
        return art.margenes && art.margenes.some(m => Number(m.lista_id) === Number(listaId));
    });

    const oldState = window.pdfCapaCState || {
        legacy: { checked: true, items: [] },
        lotes: { checked: true, items: [] },
        receta: { checked: true, items: [] },
        reposicion: { checked: true, items: [] }
    };

    const categories = {
        legacy: [],
        lotes: [],
        receta: [],
        reposicion: []
    };

    articulosDeLista.forEach(art => {
        const isLegacyOnly = parseFloat(art.costo_base) > 0 &&
                             parseInt(art.total_lotes_historicos || 0) === 0 &&
                             parseInt(art.total_recetas || 0) === 0 &&
                             parseInt(art.total_mapeos_reposicion || 0) === 0;

        const hasLotes = parseInt(art.total_lotes_historicos || 0) > 0;
        const hasRecetas = parseInt(art.total_recetas || 0) > 0;
        const hasReposicion = parseInt(art.total_mapeos_reposicion || 0) > 0;

        const artItem = {
            articulo_id: art.articulo_id,
            descripcion: art.descripcion_generada || art.descripcion,
            costo_base: parseFloat(art.costo_base)
        };

        if (isLegacyOnly) categories.legacy.push(artItem);
        if (hasLotes) categories.lotes.push(artItem);
        if (hasRecetas) categories.receta.push(artItem);
        if (hasReposicion) categories.reposicion.push(artItem);
    });

    const syncCategory = (catKey) => {
        const oldCat = oldState[catKey] || { checked: true, items: [] };
        const newItems = categories[catKey].map(item => {
            const oldItem = oldCat.items.find(i => i.articulo_id === item.articulo_id);
            return {
                ...item,
                checked: oldItem ? oldItem.checked : true
            };
        });
        
        // El estado maestro de la categoría debe sincronizarse con si todos están checkeados
        const allChecked = newItems.length > 0 && newItems.every(i => i.checked);
        return {
            checked: oldCat.items.length > 0 ? allChecked : oldCat.checked,
            items: newItems
        };
    };

    window.pdfCapaCState = {
        legacy: syncCategory('legacy'),
        lotes: syncCategory('lotes'),
        receta: syncCategory('receta'),
        reposicion: syncCategory('reposicion')
    };
};

window.inicializarArbolCategorias = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;
    
    // Si no está inicializado el estado de la Capa C, lo creamos
    if (!window.pdfCapaCState) {
        window.inicializarCapaCState();
    }



    // Filtrar los artículos que tienen esta lista activa y cumplen los filtros individuales de la Capa C
    const articulosFiltrados = articulosBunkerGlobal.filter(art => {
        const hasMargin = art.margenes && art.margenes.some(m => Number(m.lista_id) === Number(listaId));
        if (!hasMargin) return false;

        const isLegacyOnly = parseFloat(art.costo_base) > 0 &&
                             parseInt(art.total_lotes_historicos || 0) === 0 &&
                             parseInt(art.total_recetas || 0) === 0 &&
                             parseInt(art.total_mapeos_reposicion || 0) === 0;

        const hasLotes = parseInt(art.total_lotes_historicos || 0) > 0;
        const hasRecetas = parseInt(art.total_recetas || 0) > 0;
        const hasReposicion = parseInt(art.total_mapeos_reposicion || 0) > 0;

        // Comprobación granular
        if (isLegacyOnly) {
            const item = window.pdfCapaCState.legacy.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasLotes) {
            const item = window.pdfCapaCState.lotes.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasRecetas) {
            const item = window.pdfCapaCState.receta.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }
        if (hasReposicion) {
            const item = window.pdfCapaCState.reposicion.items.find(i => i.articulo_id === art.articulo_id);
            if (item && !item.checked) return false;
        }

        return true;
    });

    // Agrupar por Rubro y Sub-rubro
    const rawMap = {};
    articulosFiltrados.forEach(art => {
        const rName = (art.rubro || 'SIN RUBRO').trim();
        const sName = (art.sub_rubro || 'SIN SUB-RUBRO').trim();
        
        if (!rawMap[rName]) {
            rawMap[rName] = {};
        }
        if (!rawMap[rName][sName]) {
            rawMap[rName][sName] = [];
        }
        rawMap[rName][sName].push(art);
    });

    // Mantener la persistencia del estado previo de checks y secuencias de rubros
    const oldState = window.pdfRubrosState || [];
    const newState = [];

    const oldRubrosOrder = oldState.map(r => r.name);
    const allNewRubros = Object.keys(rawMap);
    
    // Respetar la secuencia geométrica previa de rubros
    let orderedRubros = [];
    oldRubrosOrder.forEach(rName => {
        if (allNewRubros.includes(rName)) {
            orderedRubros.push(rName);
        }
    });
    allNewRubros.forEach(rName => {
        if (!orderedRubros.includes(rName)) {
            orderedRubros.push(rName);
        }
    });

    orderedRubros.forEach(rName => {
        const oldR = oldState.find(r => r.name === rName);
        const rChecked = oldR ? oldR.checked : true;

        const subRubrosList = [];
        const oldSubRubrosOrder = oldR ? oldR.subRubros.map(s => s.name) : [];
        const allNewSubRubros = Object.keys(rawMap[rName]);
        
        let orderedSubRubros = [];
        oldSubRubrosOrder.forEach(sName => {
            if (allNewSubRubros.includes(sName)) {
                orderedSubRubros.push(sName);
            }
        });
        allNewSubRubros.forEach(sName => {
            if (!orderedSubRubros.includes(sName)) {
                orderedSubRubros.push(sName);
            }
        });

        orderedSubRubros.forEach(sName => {
            const oldS = oldR ? oldR.subRubros.find(s => s.name === sName) : null;
            const sChecked = oldS ? oldS.checked : true;
            
            // Copiar los artículos y aplicar ordenamiento por múltiples atributos prioritarios de la Capa D
            const sortedItems = [...rawMap[rName][sName]];
            const activeAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id) : [];
            
            if (activeAttrs.length > 0) {
                sortedItems.sort((a, b) => {
                    for (const attr of activeAttrs) {
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

            subRubrosList.push({
                name: sName,
                checked: sChecked,
                items: sortedItems
            });
        });

        newState.push({
            name: rName,
            checked: rChecked,
            subRubros: subRubrosList
        });
    });

    window.pdfRubrosState = newState;
};

window.renderArbolCategorias = function() {
    const treeContainer = document.getElementById('pdf-category-tree');
    if (!treeContainer) return;
    
    treeContainer.innerHTML = '';
    
    window.pdfRubrosState.forEach((rubro, rIdx) => {
        const rContainer = document.createElement('div');
        rContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px; border-bottom: 1px solid #f1f5f9;';

        const rHeader = document.createElement('div');
        rHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

        // Checkbox + Nombre de Rubro Padre
        const left = document.createElement('label');
        left.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: bold; color: #8e4785; font-size: 0.85em; margin: 0; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = rubro.checked;
        chk.style.cssText = 'width: 14px; height: 14px; cursor: pointer;';
        chk.onchange = (e) => {
            rubro.checked = e.target.checked;
            // Sincronizar todos sus subrubros hijos
            rubro.subRubros.forEach(s => {
                s.checked = e.target.checked;
            });
            window.renderArbolCategorias();
            window.actualizarPrevisualizacionPDF();
        };

        const span = document.createElement('span');
        span.innerText = `■ ${rubro.name.toUpperCase()}`;

        left.appendChild(chk);
        left.appendChild(span);

        // Controles de Posición (🔼/🔽) para Rubros
        const right = document.createElement('div');
        right.style.cssText = 'display: flex; align-items: center; gap: 2px;';

        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '🔼';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.8em; padding: 1px; outline: none;';
        btnUp.disabled = rIdx === 0;
        if (rIdx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverRubroPDF(rIdx, rIdx - 1);
        };

        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '🔽';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.8em; padding: 1px; outline: none;';
        btnDown.disabled = rIdx === window.pdfRubrosState.length - 1;
        if (rIdx === window.pdfRubrosState.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverRubroPDF(rIdx, rIdx + 1);
        };

        right.appendChild(btnUp);
        right.appendChild(btnDown);

        rHeader.appendChild(left);
        rHeader.appendChild(right);
        rContainer.appendChild(rHeader);

        // Sub-rubros
        const subList = document.createElement('div');
        subList.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-left: 15px; margin-top: 2px;';

        rubro.subRubros.forEach((sub, sIdx) => {
            const sHeader = document.createElement('div');
            sHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px;';

            const sLeft = document.createElement('label');
            sLeft.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 500; color: #475569; font-size: 0.8em; margin: 0; flex: 1;';

            const sChk = document.createElement('input');
            sChk.type = 'checkbox';
            sChk.checked = sub.checked;
            sChk.style.cssText = 'width: 12px; height: 12px; cursor: pointer;';
            sChk.onchange = (e) => {
                sub.checked = e.target.checked;
                if (e.target.checked) {
                    rubro.checked = true;
                } else {
                    const anyChecked = rubro.subRubros.some(s => s.checked);
                    if (!anyChecked) {
                        rubro.checked = false;
                    }
                }
                window.renderArbolCategorias();
                window.actualizarPrevisualizacionPDF();
            };

            const sSpan = document.createElement('span');
            sSpan.innerText = `↳ ${sub.name}`;

            sLeft.appendChild(sChk);
            sLeft.appendChild(sSpan);

            // Controles posicionales para Subrubros
            const sRight = document.createElement('div');
            sRight.style.cssText = 'display: flex; align-items: center; gap: 2px;';

            const sBtnUp = document.createElement('button');
            sBtnUp.type = 'button';
            sBtnUp.innerHTML = '▲';
            sBtnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
            sBtnUp.disabled = sIdx === 0;
            if (sIdx === 0) sBtnUp.style.opacity = '0.2';
            sBtnUp.onclick = () => {
                window.moverSubrubroPDF(rIdx, sIdx, sIdx - 1);
            };

            const sBtnDown = document.createElement('button');
            sBtnDown.type = 'button';
            sBtnDown.innerHTML = '▼';
            sBtnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
            sBtnDown.disabled = sIdx === rubro.subRubros.length - 1;
            if (sIdx === rubro.subRubros.length - 1) sBtnDown.style.opacity = '0.2';
            sBtnDown.onclick = () => {
                window.moverSubrubroPDF(rIdx, sIdx, sIdx + 1);
            };

            sRight.appendChild(sBtnUp);
            sRight.appendChild(sBtnDown);

            sHeader.appendChild(sLeft);
            sHeader.appendChild(sRight);
            subList.appendChild(sHeader);
        });

        rContainer.appendChild(subList);
        treeContainer.appendChild(rContainer);
    });
};

window.moverRubroPDF = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= window.pdfRubrosState.length) return;
    
    const temp = window.pdfRubrosState[fromIdx];
    window.pdfRubrosState[fromIdx] = window.pdfRubrosState[toIdx];
    window.pdfRubrosState[toIdx] = temp;
    
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.moverSubrubroPDF = function(rubroIdx, fromIdx, toIdx) {
    const rubro = window.pdfRubrosState[rubroIdx];
    if (!rubro || toIdx < 0 || toIdx >= rubro.subRubros.length) return;
    
    const temp = rubro.subRubros[fromIdx];
    rubro.subRubros[fromIdx] = rubro.subRubros[toIdx];
    rubro.subRubros[toIdx] = temp;
    
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.moverCapaDAttr = function(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= window.pdfCapaDAttributes.length) return;
    const temp = window.pdfCapaDAttributes[fromIdx];
    window.pdfCapaDAttributes[fromIdx] = window.pdfCapaDAttributes[toIdx];
    window.pdfCapaDAttributes[toIdx] = temp;
    
    window.renderCapaDPriorityList();
    window.actualizarPrevisualizacionPDF();
};

window.renderCapaDPriorityList = function() {
    const container = document.getElementById('pdf-capad-priority-list');
    if (!container) return;
    container.innerHTML = '';
    
    window.pdfCapaDAttributes.forEach((attr, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;';
        
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.85em; color: #334155; margin: 0; font-weight: 500; flex: 1;';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = attr.checked;
        chk.style.cssText = 'width: 14px; height: 14px; cursor: pointer;';
        chk.onchange = (e) => {
            attr.checked = e.target.checked;
            window.actualizarPrevisualizacionPDF();
        };
        
        const span = document.createElement('span');
        span.innerHTML = attr.label;
        
        label.appendChild(chk);
        label.appendChild(span);
        
        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 2px;';
        
        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.innerHTML = '▲';
        btnUp.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
        btnUp.disabled = idx === 0;
        if (idx === 0) btnUp.style.opacity = '0.2';
        btnUp.onclick = () => {
            window.moverCapaDAttr(idx, idx - 1);
        };
        
        const btnDown = document.createElement('button');
        btnDown.type = 'button';
        btnDown.innerHTML = '▼';
        btnDown.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 0.75em; padding: 1px; outline: none;';
        btnDown.disabled = idx === window.pdfCapaDAttributes.length - 1;
        if (idx === window.pdfCapaDAttributes.length - 1) btnDown.style.opacity = '0.2';
        btnDown.onclick = () => {
            window.moverCapaDAttr(idx, idx + 1);
        };
        
        controls.appendChild(btnUp);
        controls.appendChild(btnDown);
        
        item.appendChild(label);
        item.appendChild(controls);
        container.appendChild(item);
    });
};

window.toggleColapsarSidebar = function(event) {
    if (event) event.stopPropagation();
    const sidebar = document.getElementById('pdf-config-sidebar');
    const btn = document.getElementById('pdf-btn-collapse-sidebar');
    if (!sidebar || !btn) return;
    
    const isCollapsed = sidebar.style.width === '0px';
    if (isCollapsed) {
        sidebar.style.width = '320px';
        sidebar.style.padding = '15px';
        sidebar.style.opacity = '1';
        sidebar.style.marginRight = '0px';
        btn.innerHTML = '◀';
        btn.style.left = '-6px';
    } else {
        sidebar.style.width = '0px';
        sidebar.style.padding = '0px';
        sidebar.style.opacity = '0';
        sidebar.style.marginRight = '-12px';
        btn.innerHTML = '▶';
        btn.style.left = '0px';
    }
    window.guardarDisenoPDF();
};

window.inicializarSplitterDrag = function() {
    const splitter = document.getElementById('pdf-sidebar-splitter');
    const sidebar = document.getElementById('pdf-config-sidebar');
    if (!splitter || !sidebar) return;
    if (splitter.dataset.dragInitialized) return;
    splitter.dataset.dragInitialized = 'true';
    
    let startX, startWidth;
    
    splitter.addEventListener('mousedown', function(e) {
        if (e.target.id === 'pdf-btn-collapse-sidebar') return;
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(sidebar).width, 10);
        
        sidebar.style.transition = 'none';
        
        function doDrag(e) {
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth >= 200 && newWidth <= 500) {
                sidebar.style.width = newWidth + 'px';
            }
        }
        
        function stopDrag() {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
            sidebar.style.transition = 'width 0.3s ease, padding 0.3s ease, margin 0.3s ease, opacity 0.3s ease';
            window.guardarDisenoPDF();
        }
        
        document.documentElement.addEventListener('mousemove', doDrag, false);
        document.documentElement.addEventListener('mouseup', stopDrag, false);
    });
    
    splitter.addEventListener('dblclick', function(e) {
        if (e.target.id === 'pdf-btn-collapse-sidebar') return;
        window.toggleColapsarSidebar();
    });
};

window.guardarDisenoPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) return;
    const listaId = list.lista_id;
    
    const capaA = pdfColumnsOrder.map(c => ({ id: c.id, checked: c.checked }));
    
    const capaB = window.pdfRubrosState ? window.pdfRubrosState.map(r => ({
        name: r.name,
        checked: r.checked,
        subRubros: r.subRubros.map(s => ({ name: s.name, checked: s.checked }))
    })) : [];
    
    const capaC = window.pdfCapaCState ? {
        legacy: { checked: window.pdfCapaCState.legacy.checked, items: window.pdfCapaCState.legacy.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        lotes: { checked: window.pdfCapaCState.lotes.checked, items: window.pdfCapaCState.lotes.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        receta: { checked: window.pdfCapaCState.receta.checked, items: window.pdfCapaCState.receta.items.map(i => ({ id: i.articulo_id, checked: i.checked })) },
        reposicion: { checked: window.pdfCapaCState.reposicion.checked, items: window.pdfCapaCState.reposicion.items.map(i => ({ id: i.articulo_id, checked: i.checked })) }
    } : null;
    
    const capaD = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.map(a => ({ id: a.id, checked: a.checked })) : [];
    
    const sidebar = document.getElementById('pdf-config-sidebar');
    const sidebarWidth = sidebar ? sidebar.style.width : '320px';
    const sidebarCollapsed = sidebar ? (sidebar.style.width === '0px') : false;
    
    const designState = {
        capaA,
        capaB,
        capaC,
        capaD,
        sidebarWidth,
        sidebarCollapsed
    };
    
    localStorage.setItem(`pdf_design_state_${listaId}`, JSON.stringify(designState));
};

window.cargarDisenoPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) return;
    const listaId = list.lista_id;
    
    const saved = localStorage.getItem(`pdf_design_state_${listaId}`);
    if (!saved) {
        window.pdfCapaDAttributes = [
            { id: 'variedad', label: '🌾 Variedad comercial', checked: false },
            { id: 'presentacion', label: '📦 Presentación del empaque', checked: true },
            { id: 'marca', label: '🏷️ Marca comercial', checked: false },
            { id: 'origen', label: '🌍 Origen / Procedencia', checked: false }
        ];
        return;
    }
    
    try {
        const state = JSON.parse(saved);
        
        if (state.capaA) {
            state.capaA.forEach(savedCol => {
                const col = pdfColumnsOrder.find(c => c.id === savedCol.id);
                if (col) col.checked = savedCol.checked;
            });
        }
        
        if (state.capaB) {
            const restoredRubros = [];
            state.capaB.forEach(savedRubro => {
                const origRubro = window.pdfRubrosState ? window.pdfRubrosState.find(r => r.name === savedRubro.name) : null;
                if (origRubro) {
                    const restoredSubRubros = [];
                    savedRubro.subRubros.forEach(savedSub => {
                        const origSub = origRubro.subRubros.find(s => s.name === savedSub.name);
                        if (origSub) {
                            origSub.checked = savedSub.checked;
                            restoredSubRubros.push(origSub);
                        }
                    });
                    origRubro.subRubros.forEach(s => {
                        if (!restoredSubRubros.some(rs => rs.name === s.name)) {
                            restoredSubRubros.push(s);
                        }
                    });
                    origRubro.checked = savedRubro.checked;
                    origRubro.subRubros = restoredSubRubros;
                    restoredRubros.push(origRubro);
                }
            });
            if (window.pdfRubrosState) {
                window.pdfRubrosState.forEach(r => {
                    if (!restoredRubros.some(rr => rr.name === r.name)) {
                        restoredRubros.push(r);
                    }
                });
                window.pdfRubrosState = restoredRubros;
            }
        }
        
        if (state.capaC && window.pdfCapaCState) {
            const syncCapaCCategory = (catKey) => {
                const savedCat = state.capaC[catKey];
                const origCat = window.pdfCapaCState[catKey];
                if (savedCat && origCat) {
                    origCat.checked = savedCat.checked;
                    savedCat.items.forEach(savedItem => {
                        const origItem = origCat.items.find(i => i.articulo_id === savedItem.id);
                        if (origItem) origItem.checked = savedItem.checked;
                    });
                }
            };
            syncCapaCCategory('legacy');
            syncCapaCCategory('lotes');
            syncCapaCCategory('receta');
            syncCapaCCategory('reposicion');
        }
        
        if (state.capaD) {
            const restoredCapaD = [];
            state.capaD.forEach(savedAttr => {
                restoredCapaD.push({
                    id: savedAttr.id,
                    label: savedAttr.id === 'variedad' ? '🌾 Variedad comercial' :
                           savedAttr.id === 'presentacion' ? '📦 Presentación del empaque' :
                           savedAttr.id === 'marca' ? '🏷️ Marca comercial' : '🌍 Origen / Procedencia',
                    checked: savedAttr.checked
                });
            });
            const attrs = ['variedad', 'presentacion', 'marca', 'origen'];
            attrs.forEach(id => {
                if (!restoredCapaD.some(a => a.id === id)) {
                    restoredCapaD.push({
                        id,
                        label: id === 'variedad' ? '🌾 Variedad comercial' :
                               id === 'presentacion' ? '📦 Presentación del empaque' :
                               id === 'marca' ? '🏷️ Marca comercial' : '🌍 Origen / Procedencia',
                        checked: id === 'presentacion'
                    });
                }
            });
            window.pdfCapaDAttributes = restoredCapaD;
        } else {
            window.pdfCapaDAttributes = [
                { id: 'variedad', label: '🌾 Variedad comercial', checked: false },
                { id: 'presentacion', label: '📦 Presentación del empaque', checked: true },
                { id: 'marca', label: '🏷️ Marca comercial', checked: false },
                { id: 'origen', label: '🌍 Origen / Procedencia', checked: false }
            ];
        }
        
        const sidebar = document.getElementById('pdf-config-sidebar');
        if (sidebar) {
            if (state.sidebarWidth) {
                sidebar.style.width = state.sidebarWidth;
            }
            if (state.sidebarCollapsed) {
                sidebar.style.width = '0px';
                sidebar.style.padding = '0px';
                sidebar.style.opacity = '0';
                sidebar.style.marginRight = '-12px';
                const btn = document.getElementById('pdf-btn-collapse-sidebar');
                if (btn) {
                    btn.innerHTML = '▶';
                    btn.style.left = '0px';
                }
            }
        }
    } catch (e) {
        console.error("VIGÍA: Error cargando diseño", e);
    }
};

window.renderCapaCMatrix = function() {
    const container = document.getElementById('pdf-capac-matrix');
    if (!container) return;

    if (!window.pdfCapaCState) {
        window.inicializarCapaCState();
    }

    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    const sources = [
        { key: 'legacy', label: '🕰️ Historial Legacy (Lomas)', icon: '🕰️' },
        { key: 'lotes', label: '📦 Compra Física de Lotes', icon: '📦' },
        { key: 'receta', label: '📜 Estructura de Recetas (Ingr.)', icon: '📜' },
        { key: 'reposicion', label: '📡 Ofertas de Reposición', icon: '📡' }
    ];

    let html = '';
    sources.forEach(src => {
        const cat = window.pdfCapaCState[src.key];
        if (!cat) return;

        const isExpanded = window.pdfCapaCExpanded && window.pdfCapaCExpanded[src.key];
        const arrow = isExpanded ? '▼' : '▶';
        const displayStyle = isExpanded ? 'block' : 'none';
        const itemsCount = cat.items.length;

        // Comprobar si todos los hijos están marcados para poner el master checkbox
        const allChecked = cat.items.length > 0 && cat.items.every(i => i.checked);
        const masterChecked = cat.checked && allChecked;

        html += `
            <div class="capac-card" style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 6px; background: #f8fafc; transition: all 0.2s ease;">
                <!-- Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: #e2e8f0; cursor: pointer; user-select: none;" onclick="window.toggleCapaCAccordion(event, '${src.key}')">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.75em; color: #64748b; font-family: monospace; width: 12px; text-align: center;">${arrow}</span>
                        <input type="checkbox" id="capac-master-${src.key}" ${masterChecked ? 'checked' : ''} onclick="window.toggleCapaCMaster(event, '${src.key}', this.checked)" style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
                        <span style="font-size: 0.82em; font-weight: bold; color: #1e293b;">${src.label}</span>
                    </div>
                    <span style="background: #cbd5e1; color: #475569; font-size: 0.72em; padding: 2px 6px; border-radius: 10px; font-weight: bold;">${itemsCount}</span>
                </div>
                <!-- Items Drawer -->
                <div id="capac-drawer-${src.key}" style="display: ${displayStyle}; max-height: 150px; overflow-y: auto; background: white; padding: 6px 10px; border-top: 1px solid #cbd5e1;">
                    ${itemsCount === 0 ? `
                        <div style="text-align: center; color: #94a3b8; font-style: italic; padding: 6px; font-size: 0.78em;">No hay artículos</div>
                    ` : cat.items.map(item => `
                        <label style="display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 0.78em; color: #475569; cursor: pointer; border-bottom: 1px dashed #f1f5f9; transition: color 0.2s;" onmouseover="this.style.color='#8e4785'" onmouseout="this.style.color='#475569'">
                            <input type="checkbox" id="capac-item-${src.key}-${item.articulo_id}" ${item.checked ? 'checked' : ''} onchange="window.toggleCapaCItemChild('${src.key}', '${item.articulo_id}', this.checked)" style="cursor: pointer; width: 13px; height: 13px; margin: 0;">
                            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.descripcion}">${item.descripcion}</span>
                            <strong style="color: #64748b; font-family: monospace;">(${formatter.format(item.costo_base)})</strong>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
};

window.toggleCapaCAccordion = function(e, key) {
    if (e.target.type === 'checkbox') return;
    window.pdfCapaCExpanded[key] = !window.pdfCapaCExpanded[key];
    window.renderCapaCMatrix();
};

window.toggleCapaCMaster = function(e, key, checked) {
    e.stopPropagation();
    const cat = window.pdfCapaCState[key];
    if (cat) {
        cat.checked = checked;
        cat.items.forEach(item => {
            item.checked = checked;
        });
        window.renderCapaCMatrix();
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.actualizarPrevisualizacionPDF();
    }
};

window.toggleCapaCItemChild = function(key, articulo_id, checked) {
    const cat = window.pdfCapaCState[key];
    if (cat) {
        const item = cat.items.find(i => i.articulo_id === articulo_id);
        if (item) {
            item.checked = checked;
        }
        
        const allChecked = cat.items.every(i => i.checked);
        cat.checked = allChecked;
        
        window.renderCapaCMatrix();
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.actualizarPrevisualizacionPDF();
    }
};

window.cambiarFiltroCostosCapaC = function() {
    window.inicializarArbolCategorias();
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.cambiarAtributoCapaD = function() {
    window.inicializarArbolCategorias();
    window.renderArbolCategorias();
    window.actualizarPrevisualizacionPDF();
};

window.abrirPrevisualizadorPDFGlobal = function() {
    if (gp_listasFinancieras && gp_listasFinancieras.length > 0) {
        const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaSeleccionadaGlobal));
        if (idx !== -1) {
            gp_activeTabIdx = idx;
        }
    }
    window.abrirPrevisualizadorPDF();
};

window.abrirPrevisualizadorPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) {
        Swal.fire('Error', 'No se pudo determinar la lista activa en el Gestor de Precios.', 'error');
        return;
    }

    // Poblar de manera dinámica el dropdown del selector de lista comercial activa del previsualizador
    const pdfSelect = document.getElementById('pdf-seleccion-lista');
    if (pdfSelect) {
        pdfSelect.innerHTML = '';
        gp_listasFinancieras.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.lista_id;
            opt.textContent = l.nombre_lista;
            pdfSelect.appendChild(opt);
        });
        pdfSelect.value = list.lista_id;
    }
    
    if (document.getElementById('pdf-prev-lista-nombre')) {
        document.getElementById('pdf-prev-lista-nombre').innerText = list.nombre_lista;
    }
    
    const hoy = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    if (document.getElementById('pdf-prev-emision-fecha')) {
        document.getElementById('pdf-prev-emision-fecha').innerText = hoy;
    }
    
    // Cargar la configuración guardada de columnas desde localStorage antes de renderizar
    window.cargarConfiguracionColumnas();
    
    // Renderizar las opciones y orden de las columnas dinámicamente
    window.renderConfiguradorColumnas();
    
    // Inicializar y renderizar Capa C y Capa B con persistencia atómica
    window.inicializarCapaCState();
    window.inicializarArbolCategorias();
    window.cargarDisenoPDF(); // Carga la memoria del localStorage indexada por ID de lista
    window.inicializarArbolCategorias(); // Re-inicializa con el orden y estados cargados
    window.renderCapaCMatrix();
    window.renderArbolCategorias();
    window.renderCapaDPriorityList();
    window.inicializarSplitterDrag();
    
    // Asegurar Higiene Clean Slate para el maximizado
    const contentEl = document.getElementById('pdf-modal-content');
    if (contentEl) {
        contentEl.classList.remove('vr-maximized');
    }
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (btnMax) {
        btnMax.innerHTML = '🗖';
        btnMax.title = 'Maximizar';
    }
    
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'flex';
    }
    
    window.actualizarPrevisualizacionPDF();
};

window.cerrarPrevisualizadorPDF = function() {
    // Limpieza de maximizado al cerrar
    const contentEl = document.getElementById('pdf-modal-content');
    if (contentEl) {
        contentEl.classList.remove('vr-maximized');
    }
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (btnMax) {
        btnMax.innerHTML = '🗖';
        btnMax.title = 'Maximizar';
    }
    
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'none';
    }
};

window.cambiarListaPreciosPDF = function(listaId) {
    console.log("=== VIGÍA DEPURADOR: INICIO DE CAMBIO DE LISTA EN PREVISUALIZADOR PDF ===");
    // 1. Guardar el diseño actual de la lista que se está abandonando
    window.guardarDisenoPDF();

    // 2. Resolver el índice de la nueva lista seleccionada
    const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(listaId));
    if (idx !== -1) {
        gp_activeTabIdx = idx;
        const list = gp_listasFinancieras[idx];
        console.log(`VIGÍA: Cambiando a listaId ${listaId} (${list.nombre_lista}) en gp_activeTabIdx: ${gp_activeTabIdx}`);

        // 3. Actualizar la cabecera de la hoja simulada
        if (document.getElementById('pdf-prev-lista-nombre')) {
            document.getElementById('pdf-prev-lista-nombre').innerText = list.nombre_lista;
        }

        // 4. Cargar el diseño de columnas/categorías específico de la nueva lista
        window.cargarDisenoPDF();

        // 5. Re-inicializar y renderizar las capas comerciales
        window.inicializarArbolCategorias();
        window.renderArbolCategorias();
        window.renderCapaCMatrix();
        window.renderCapaDPriorityList();

        // 6. Forzar actualización de la previsualización adaptativa
        window.actualizarPrevisualizacionPDF();
    } else {
        console.error(`VIGÍA: No se encontró la listaId ${listaId} en gp_listasFinancieras`);
    }
};

window.actualizarPrevisualizacionPDF = function() {
    console.log("=== VIGÍA DEPURADOR: INICIO DE ACTUALIZAR PREVISUALIZACIÓN ===");
    const list = gp_listasFinancieras[gp_activeTabIdx];
    console.log("VIGÍA: Active list object:", list, "at gp_activeTabIdx:", gp_activeTabIdx);
    if (!list) {
        console.warn("VIGÍA: No list found in gp_listasFinancieras at active tab index", gp_activeTabIdx);
        return;
    }
    const listaId = list.lista_id;
    console.log("VIGÍA: Active listaId:", listaId);
    
    // Guardar estado actual de columnas y diseño con persistencia atómica
    window.guardarConfiguracionColumnas();
    window.guardarDisenoPDF();
    
    // 1. Obtener Columnas Activas de Capa A
    const cols = pdfColumnsOrder.filter(c => c.checked);
    console.log("VIGÍA: Columnas activas (cols):", cols.map(c => c.id));
    
    if (cols.length === 0) {
        const descCol = pdfColumnsOrder.find(c => c.id === 'descripcion');
        if (descCol) {
            cols.push(descCol);
        } else {
            cols.push({ id: 'descripcion', label: 'Descripción', align: 'left', baseWidth: 190 });
        }
        console.log("VIGÍA: cols was empty, pushed fallback:", cols.map(c => c.id));
    }
    
    // 2. Calcular anchos elásticos proporcionales (ancho total de tabla es 100%)
    let totalBase = cols.reduce((sum, c) => sum + c.baseWidth, 0);
    cols.forEach(c => {
        c.percentWidth = ((c.baseWidth / totalBase) * 100).toFixed(2) + '%';
    });
    console.log("VIGÍA: Calculated percent widths:", cols.map(c => `${c.id}: ${c.percentWidth}`));
    
    // 3. Renderizar el visor central dinamico agrupado en `#pdf-prev-table-container`
    const prevContainer = document.getElementById('pdf-prev-table-container');
    if (!prevContainer) {
        console.error("VIGÍA: #pdf-prev-table-container NOT FOUND in DOM!");
        return;
    }
    prevContainer.innerHTML = '';
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    // Filtrar rubros activos
    const activeRubros = window.pdfRubrosState.filter(r => r.checked);
    console.log("VIGÍA: Active Rubros (Capa B):", activeRubros.map(r => r.name));
    
    if (activeRubros.length === 0) {
        console.warn("VIGÍA: No active rubros to previsualize.");
        prevContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-style: italic;">No hay rubros activos para previsualizar. Seleccione al menos un rubro en la Capa B.</div>`;
        return;
    }

    activeRubros.forEach(rubro => {
        console.log(`VIGÍA: Processing Rubro: ${rubro.name}`);
        // Filtrar sub-rubros activos para este rubro
        const activeSubRubros = rubro.subRubros.filter(s => s.checked);
        console.log(`VIGÍA: Active SubRubros for ${rubro.name}:`, activeSubRubros.map(s => s.name));
        if (activeSubRubros.length === 0) return;

        // Banner del Rubro Principal
        const rubroTitle = document.createElement('div');
        rubroTitle.style.cssText = 'font-size: 1.1em; font-weight: bold; color: #8e4785; margin-top: 15px; border-bottom: 2px solid #8e4785; padding-bottom: 4px; text-transform: uppercase; text-align: left;';
        rubroTitle.innerText = `■ ${rubro.name}`;
        prevContainer.appendChild(rubroTitle);

        activeSubRubros.forEach(sub => {
            console.log(`VIGÍA: Processing Sub-Rubro ${sub.name} (items count: ${sub.items.length})`);
            if (sub.items.length === 0) {
                console.log(`VIGÍA: Sub-Rubro ${sub.name} has 0 items, skipping table.`);
                return;
            }

            // Sub-divisor de Categoría
            const subTitle = document.createElement('div');
            subTitle.style.cssText = 'font-size: 0.9em; font-weight: bold; font-style: italic; color: #475569; margin-left: 10px; margin-top: 8px; margin-bottom: 6px; text-align: left;';
            subTitle.innerText = `↳ ${sub.name}`;
            prevContainer.appendChild(subTitle);

            try {
                // Tabla para esta sección
                const tableWrapper = document.createElement('div');
                tableWrapper.style.cssText = 'width: 100%; overflow-x: auto; margin-left: 10px; width: calc(100% - 10px);';

                const table = document.createElement('table');
                table.className = 'tabla-financiera';
                table.style.cssText = 'width: 100%; box-shadow: none; border: 1px solid #e2e8f0; font-size: 0.85em; border-collapse: collapse; margin-bottom: 15px;';

                // thead
                const thead = document.createElement('thead');
                thead.style.cssText = 'background-color: #8e4785; color: white;';
                let theadHtml = '<tr>';
                cols.forEach(c => {
                    theadHtml += `<th style="width: ${c.percentWidth}; text-align: ${c.align}; padding: 8px; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px;">${c.label}</th>`;
                });
                theadHtml += '</tr>';
                thead.innerHTML = theadHtml;
                table.appendChild(thead);

                // tbody
                const tbody = document.createElement('tbody');
                let renderedRowsCount = 0;
                
                // Atributos activos prioritarios de la Capa D
                const activeAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id) : [];
                let lastAttrVals = {};
                
                sub.items.forEach((art, index) => {
                    try {
                        // Comprobar si cambian los valores de los atributos activos
                        let changedIdx = -1;
                        const currentAttrVals = {};
                        activeAttrs.forEach((attr, idx) => {
                            const val = obtenerValorFormateadoCapaD(art, attr);
                            currentAttrVals[attr] = val;
                            if (changedIdx === -1 && val !== lastAttrVals[attr]) {
                                changedIdx = idx;
                            }
                        });
                        
                        if (changedIdx !== -1) {
                            // Al menos uno cambió. Dibujamos sub-cabeceras para los niveles de prioridad modificados
                            for (let i = changedIdx; i < activeAttrs.length; i++) {
                                const attr = activeAttrs[i];
                                const attrVal = currentAttrVals[attr];
                                lastAttrVals[attr] = attrVal;
                                
                                // Anular los valores de los sub-atributos siguientes para forzar su re-dibujo
                                for (let j = i + 1; j < activeAttrs.length; j++) {
                                    lastAttrVals[activeAttrs[j]] = null;
                                }
                                
                                const level = i + 1;
                                const indent = 24 * level;
                                
                                const subHeaderTr = document.createElement('tr');
                                subHeaderTr.style.backgroundColor = 'transparent';
                                subHeaderTr.innerHTML = `
                                    <td colspan="${cols.length}" style="padding: 6px 12px 6px ${indent}px; font-style: italic; font-weight: 600; color: #64748b; font-size: 0.8em; text-align: left; border: none;">
                                        ${attrVal}
                                    </td>
                                `;
                                tbody.appendChild(subHeaderTr);
                            }
                        }
                        if (!art.margenes) {
                            console.warn(`VIGÍA: Article ${art.articulo_id} lacks 'margenes' array!`);
                            return;
                        }
                        // Encontrar configuración del artículo para esta lista con casting robusto
                        const mFocused = art.margenes.find(m => Number(m.lista_id) === Number(listaId));
                        if (!mFocused) {
                            console.warn(`VIGÍA: Article ${art.articulo_id} has no margin config for listId ${listaId}`);
                            return;
                        }
                        
                        const pFinal = parseFloat(mFocused.precio_final || 0);
                        const ivaVal = parseFloat(mFocused.iva || 21.00);
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
                        
                        const tr = document.createElement('tr');
                        if (index % 2 === 1) {
                            tr.style.backgroundColor = '#f8fafc';
                        }
                        
                        let rowHtml = '';
                        cols.forEach(c => {
                            let val = '';
                            if (c.id === 'codigo') val = art.articulo_id;
                            else if (c.id === 'descripcion') val = art.descripcion_generada || art.descripcion;
                            else if (c.id === 'presentacion') val = presentacionText;
                            else if (c.id === 'kilo') val = formatter.format(precioKiloNeto);
                            else if (c.id === 'bulto') val = formatter.format(precioBultoNeto);
                            else if (c.id === 'final_kilo') val = formatter.format(precioKiloFinal);
                            else if (c.id === 'final_bulto') val = formatter.format(precioBultoFinal);
                            
                            rowHtml += `<td style="padding: 8px; text-align: ${c.align}; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 0.9em;">${val}</td>`;
                        });
                        
                        tr.innerHTML = rowHtml;
                        tbody.appendChild(tr);
                        renderedRowsCount++;
                    } catch (artErr) {
                        console.error(`VIGÍA: Error processing article ${art ? art.articulo_id : 'unknown'}:`, artErr);
                    }
                });

                console.log(`VIGÍA: Sub-Rubro ${sub.name} - Rendered rows in tbody: ${renderedRowsCount}`);
                table.appendChild(tbody);
                tableWrapper.appendChild(table);
                prevContainer.appendChild(tableWrapper);
                console.log(`VIGÍA: Successfully appended tableWrapper for ${sub.name} to DOM.`);
            } catch (tableErr) {
                console.error(`VIGÍA: Critical error building table for Sub-Rubro ${sub.name}:`, tableErr);
            }
        });
    });
    console.log("=== VIGÍA DEPURADOR: FIN DE ACTUALIZAR PREVISUALIZACIÓN ===");
};

window.confirmarEImprimirPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // 1. Obtener columnas activas secuenciales de Capa A
    const cols = pdfColumnsOrder.filter(c => c.checked).map(c => c.id);
    if (cols.length === 0) {
        cols.push('descripcion');
    }
    const colsQuery = cols.join(',');
    
    // 2. Obtener la secuencia ordenada de Rubros Activos de Capa B
    const rubrosActivos = window.pdfRubrosState.filter(r => r.checked).map(r => r.name);
    const rubrosQuery = encodeURIComponent(rubrosActivos.join(','));

    // 3. Obtener la lista de Sub-rubros Ocultos de Capa B
    const subrubrosOcultos = [];
    window.pdfRubrosState.forEach(rubro => {
        rubro.subRubros.forEach(sub => {
            if (!sub.checked) {
                subrubrosOcultos.push(sub.name);
            }
        });
    });
    const subrubrosQuery = encodeURIComponent(subrubrosOcultos.join(','));

    // 4. Obtener artículos excluidos de la Capa C basado en el estado granular de cada categoría
    const excludedCapaC = [];
    if (window.pdfCapaCState) {
        const categoriesKeys = ['legacy', 'lotes', 'receta', 'reposicion'];
        articulosBunkerGlobal.forEach(art => {
            let isPresentInSomeCategory = false;
            let isExcluded = false;

            categoriesKeys.forEach(catKey => {
                const cat = window.pdfCapaCState[catKey];
                if (cat) {
                    const item = cat.items.find(i => i.articulo_id === art.articulo_id);
                    if (item) {
                        isPresentInSomeCategory = true;
                        if (!item.checked) {
                            isExcluded = true;
                        }
                    }
                }
            });

            if (isPresentInSomeCategory && isExcluded) {
                excludedCapaC.push(art.articulo_id);
            }
        });
    }
    const excludeQuery = encodeURIComponent(excludedCapaC.join(','));

    // 5. Obtener los atributos activos prioritarios de la Capa D
    const capadActiveAttrs = window.pdfCapaDAttributes ? window.pdfCapaDAttributes.filter(a => a.checked).map(a => a.id).join(',') : 'none';

    // 6. Obtener la secuencia posicional personalizada de todos los Sub-rubros de la Capa B
    const subrubrosOrder = [];
    window.pdfRubrosState.forEach(rubro => {
        rubro.subRubros.forEach(sub => {
            subrubrosOrder.push(sub.name);
        });
    });
    const subrubrosOrderQuery = encodeURIComponent(subrubrosOrder.join(','));

    // Cerrar previsualizador para mejorar UX
    cerrarPrevisualizadorPDF();
    
    // Abrir descarga en nueva pestaña transmitiendo los parámetros de capas, reordenación posicional y anidamiento
    window.open(`/api/logistica/bunker/exportar-pdf/${list.lista_id}?columns=${colsQuery}&rubros_order=${rubrosQuery}&hidden_subrubros=${subrubrosQuery}&exclude_articles=${excludeQuery}&capa_d_attributes=${capadActiveAttrs}&subrubros_order=${subrubrosOrderQuery}`, '_blank');
};

window.toggleMaximizarPrevisualizador = function() {
    const contentEl = document.getElementById('pdf-modal-content');
    const btnMax = document.getElementById('pdf-btn-maximize');
    if (!contentEl) return;
    
    const isMaximized = contentEl.classList.toggle('vr-maximized');
    if (btnMax) {
        if (isMaximized) {
            btnMax.innerHTML = '🗗';
            btnMax.title = 'Restaurar';
        } else {
            btnMax.innerHTML = '🗖';
            btnMax.title = 'Maximizar';
        }
    }
};

// ==========================================
// VINCULADOR MANUAL DE OFERTAS DE REPOSICION
// ==========================================

let vr_todasOfertas = [];
let vr_mapeosActivos = [];
let currentExternalFilter = 'VIVOS'; // 'VIVOS', 'NUEVOS', 'MODIFICADOS', 'DISCONTINUADOS'
let currentProveedorFilter = 'ALL'; // Filtro de proveedor seleccionado en combo

// ✅ ESTRUCTURA DE COLUMNAS PARA AG GRID (GRILLA V4.1)
const columnDefs = [
    {
        headerName: '',
        width: 50,
        pinned: 'left',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        suppressHeaderMenuButton: true,
        suppressMovable: true,
        resizable: false,
        sortable: false
    },
    {
        headerName: 'Código',
        field: 'sku_proveedor',
        colId: 'sku_proveedor',
        width: 120,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Proveedor',
        field: 'nombre_proveedor',
        colId: 'nombre_proveedor',
        width: 160,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Descripción',
        field: 'descripcion',
        colId: 'descripcion',
        width: 320,
        sortable: true,
        resizable: true,
        cellRenderer: (params) => {
            if (!params.value) return '';
            const isBaja = params.data && params.data._estado_delta === 'BAJA';
            if (isBaja) {
                return `<span class="badge" style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 0.75em; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-right: 8px;">DISCONTINUADO</span>${params.value}`;
            }
            return params.value;
        }
    },
    {
        headerName: 'Rubro',
        field: 'rubro',
        colId: 'rubro',
        width: 130,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Cant. Bulto',
        field: 'cant_bult',
        colId: 'cant_bult',
        width: 115,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Cant. Valor',
        field: 'cant_valor',
        colId: 'cant_valor',
        width: 115,
        sortable: true,
        resizable: true
    },
    {
        headerName: 'Costo Kilo',
        field: 'precio_unitario',
        colId: 'precio_unitario',
        width: 125,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        valueFormatter: (params) => {
            if (params.value == null) return '';
            return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(params.value);
        }
    },
    {
        headerName: 'Antigüedad',
        field: 'dias_antiguedad',
        colId: 'dias_antiguedad',
        width: 115,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        cellRenderer: (params) => {
            if (params.value == null) return '';
            const dias = params.value;
            let badgeColor = '';
            if (dias === 0) badgeColor = 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;';
            else if (dias <= 5) badgeColor = 'background: #fef9c3; color: #713f12; border: 1px solid #fef08a;';
            else badgeColor = 'background: #fee2e2; color: #991b1b; border: 1px solid #fecaca;';
            
            const badgeFmt = dias === 0 ? 'Hoy' : `Hace ${dias} d`;
            return `<span class="badge" style="font-size: 0.85em; padding: 2px 8px; border-radius: 4px; font-weight: bold; ${badgeColor}">${badgeFmt}</span>`;
        }
    },
    {
        headerName: 'Última Actualización',
        field: 'dias_actualizacion',
        colId: 'dias_actualizacion',
        width: 155,
        sortable: true,
        resizable: true,
        filter: 'agNumberColumnFilter',
        cellRenderer: (params) => {
            if (params.value == null) return '';
            const dias = params.value;
            let badgeStyle = 'display: inline-flex; align-items: center; font-size: 0.82em; padding: 4px 10px; border-radius: 6px; font-weight: bold; gap: 6px; border: 1px solid; ';
            let dotHtml = '';
            
            if (dias <= 30) {
                // Rango Verde (0 a 30 días)
                badgeStyle += 'background-color: rgba(16, 185, 129, 0.1); color: #34d399; border-color: rgba(16, 185, 129, 0.3);';
                dotHtml = '<span style="width: 6px; height: 6px; border-radius: 50%; display: inline-block; background-color: #34d399;"></span>';
            } else if (dias <= 45) {
                // Rango Ámbar (31 a 45 días)
                badgeStyle += 'background-color: rgba(245, 158, 11, 0.1); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);';
                dotHtml = '<span style="width: 6px; height: 6px; border-radius: 50%; display: inline-block; background-color: #fbbf24;"></span>';
            } else {
                // Rango Rojo con Pulso Animado (Mayor a 45 días)
                badgeStyle += 'background-color: rgba(244, 63, 94, 0.1); color: #fb7185; border-color: rgba(244, 63, 94, 0.3); box-shadow: 0 0 8px rgba(239, 68, 68, 0.1);';
                dotHtml = `
                    <span style="position: relative; display: inline-flex; width: 6px; height: 6px; align-items: center;">
                        <span style="animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; position: absolute; display: inline-flex; height: 100%; width: 100%; border-radius: 50%; background-color: #fb7185; opacity: 0.75;"></span>
                        <span style="position: relative; display: inline-flex; border-radius: 50%; height: 6px; width: 6px; background-color: #f43f5e;"></span>
                    </span>
                `;
            }
            
            const text = dias === 0 ? 'Hoy' : (dias === 1 ? 'Ayer' : `${dias} días`);
            return `<span style="${badgeStyle}">${dotHtml} • ${text}</span>`;
        }
    }
];

// ✅ DEFINICIÓN POR DEFECTO CON MOTOR DE FILTRADO MULTI-TOKEN UNICODE AVANZADO (DEBOUNCE 500MS)
const defaultColDef = {
    flex: 1,
    minWidth: 50,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    filterParams: {
        debounceMs: 500, // Cortafuegos de Rendimiento (Debounce)
        textFormatter: (r) => {
            if (r == null) return null;
            return String(r).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        },
        textMatcher: (params) => {
            const filterOption = params.filterOption || params.type;
            const cleanStr = (s) => {
                if (s == null) return "";
                return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            };
            
            const cellValue = cleanStr(params.value);
            const filterText = cleanStr(params.filterText);
            
            if (!filterText) return true;
            if (!cellValue && !filterText.includes('[vacio]')) return false;
            
            if (filterOption === 'contains') {
                const processedFText = filterText.replace(/#/g, ' #');
                const rawTokens = processedFText.split(/\s+/).filter(t => t.length > 0);
                
                for (const rawToken of rawTokens) {
                    if (rawToken === '#') continue;
                    
                    const isNeg = rawToken.startsWith('#');
                    let effectiveToken = rawToken;
                    if (isNeg) effectiveToken = effectiveToken.substring(1);
                    effectiveToken = effectiveToken.replace(/#/g, '');
                    if (effectiveToken.length === 0) continue;
                    
                    if (effectiveToken === '[vacio]') {
                        if (isNeg) {
                            if (cellValue === "") return false;
                        } else {
                            if (cellValue !== "") return false;
                        }
                    } else {
                        let matchFound = false;
                        if (effectiveToken.includes('%')) {
                            let escapedToken = effectiveToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            let regexStr = escapedToken.replace(/%/g, '(?:^|\\s|$)');
                            let regex = new RegExp(regexStr);
                            matchFound = regex.test(cellValue);
                        } else {
                            matchFound = cellValue.includes(effectiveToken);
                        }
                        
                        if (isNeg) {
                            if (matchFound) return false;
                        } else {
                            if (!matchFound) return false;
                        }
                    }
                }
                return true;
            }
            if (filterOption === 'equals') return cellValue === filterText;
            if (filterOption === 'notEqual') return cellValue !== filterText;
            if (filterOption === 'startsWith') return cellValue.startsWith(filterText);
            if (filterOption === 'endsWith') return cellValue.endsWith(filterText);
            
            return false;
        }
    }
};

// ✅ CONFIGURACIÓN GENERAL DEL AG GRID
const gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    rowSelection: 'multiple',
    rowMultiSelectWithClick: true,
    suppressRowClickSelection: false,
    getRowStyle: (params) => {
        if (params.data && params.data._estado_delta === 'BAJA') {
            return { opacity: 0.5, 'text-decoration': 'line-through' };
        }
        return null;
    },
    
    // Filtro Externo para Pills
    isExternalFilterPresent: () => {
        return true; 
    },
    doesExternalFilterPass: (node) => {
        if (!node.data) return true;
        
        // 1. Intersección por Estado Delta (Pills)
        const estado = node.data._estado_delta || 'INTACTO';
        let passEstado = true;
        if (currentExternalFilter === 'VIVOS') {
            passEstado = (estado !== 'BAJA');
        } else if (currentExternalFilter === 'NUEVOS') {
            passEstado = (estado === 'ALTA');
        } else if (currentExternalFilter === 'MODIFICADOS') {
            passEstado = (estado === 'MODIFICADO');
        } else if (currentExternalFilter === 'DISCONTINUADOS') {
            passEstado = (estado === 'BAJA');
        }
        
        if (!passEstado) return false;
        
        // 2. Intersección por Proveedor (Combo #vr-filtro-proveedor)
        if (currentProveedorFilter && currentProveedorFilter !== 'ALL') {
            const proveedor = node.data._proveedor || node.data.nombre_proveedor || '';
            if (String(proveedor).trim() !== String(currentProveedorFilter).trim()) {
                return false;
            }
        }
        
        return true;
    },
    
    // Persistencia Geométrica (Column State)
    onColumnResized: () => window.guardarGridState(),
    onColumnMoved: () => window.guardarGridState(),
    onColumnVisible: () => window.guardarGridState(),
    onSortChanged: () => window.guardarGridState(),
    
    // Ganchos del Barómetro & Contador
    onFilterChanged: () => {
        window.updateFmtStatusBar();
    },
    onModelUpdated: () => {
        window.updateFmtStatusBar();
    },
    onSelectionChanged: () => {
        if (window.v4GridApi) {
            const count = window.v4GridApi.getSelectedNodes().length;
            document.getElementById('vr-contador-seleccionados').innerText = count;
        }
    }
};


// ✅ APERTURA DEL VINCULADOR (ABRIR & CARGAR DATOS)
window.abrirVinculadorReposicion = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    const articulo_nombre = document.getElementById('gp-producto').innerText;
    
    if (!articulo_id) {
        Swal.fire('Error', 'No hay ningún artículo seleccionado en el gestor.', 'error');
        return;
    }

    // Setear títulos en el modal
    document.getElementById('vr-articulo-nombre-titulo').innerText = articulo_nombre;
    document.getElementById('vr-articulo-id-titulo').innerText = articulo_id;
    
    // Higiene Obligatoria (Clean Slate):
    localStorage.removeItem('lamda_v4_filter_state');
    currentExternalFilter = 'VIVOS';
    currentProveedorFilter = 'ALL';

    // Limpiar maximizado residual en modal content
    const modalContent = document.getElementById('vr-modal-content');
    const maximizeBtn = document.getElementById('vr-btn-maximize');
    if (modalContent) modalContent.classList.remove('vr-maximized');
    if (maximizeBtn) {
        maximizeBtn.innerHTML = '🗖';
        maximizeBtn.title = 'Maximizar';
    }
    
    // Sincronizar pills de UI
    document.querySelectorAll('.vr-pill').forEach(pill => {
        pill.classList.remove('active');
        if (pill.getAttribute('data-filter') === 'VIVOS') {
            pill.classList.add('active');
        }
    });

    // Mostrar modal
    const modal = document.getElementById('modal-vinculador-reposicion');
    modal.style.display = 'flex';

    const gridDiv = document.getElementById('vr-ag-grid');
    gridDiv.innerHTML = '<div style="color: #cbd5e1; text-align: center; padding: 40px; font-style: italic;">Cargando catálogo de ofertas de reposición en vivo...</div>';

    try {
        // 1. Obtener mapeos activos locales para este artículo
        const mapeoRes = await fetch(`/api/logistica/bunker/reposicion/mapeo/${encodeURIComponent(articulo_id)}`);
        if (!mapeoRes.ok) throw new Error('Error al cargar vinculaciones locales');
        const mapeoPayload = await mapeoRes.json();
        vr_mapeosActivos = mapeoPayload.data || [];

        // 2. Obtener todas las cotizaciones del proxy remoto
        const todasRes = await fetch('/api/supabase/reposicion/todas');
        if (!todasRes.ok) throw new Error('Error al cargar ofertas remotas de Supabase');
        vr_todasOfertas = await todasRes.json();
        
        // Agregar campo cant_value mapeando a cant_valor para robustez técnica total
        vr_todasOfertas.forEach(o => {
            o.cant_value = o.cant_valor;
        });

        // Poblar dinámicamente selector de proveedores (#vr-filtro-proveedor)
        const selectProveedor = document.getElementById('vr-filtro-proveedor');
        if (selectProveedor) {
            // Extraer lista única y ordenada de proveedores activos (evitando nulos)
            const proveedoresUnicos = [...new Set(vr_todasOfertas.map(o => o.nombre_proveedor || o._proveedor).filter(Boolean))].sort();
            selectProveedor.innerHTML = '<option value="ALL">-- Todos los Proveedores --</option>';
            proveedoresUnicos.forEach(prov => {
                const opt = document.createElement('option');
                opt.value = prov;
                opt.textContent = prov;
                selectProveedor.appendChild(opt);
            });
            selectProveedor.value = 'ALL';
        }

        // 1. Destruir instancia anterior de forma segura antes de tocar el DOM para evitar excepciones NotFoundError
        if (window.v4GridApi) {
            try {
                window.v4GridApi.destroy();
            } catch (err) {
                console.warn("[AG-GRID] Error destruyendo instancia anterior:", err);
            }
            window.v4GridApi = null;
        }

        // 2. Limpiar spinner o contenido
        gridDiv.innerHTML = '';

        // Crear grilla de AG Grid
        window.v4GridApi = agGrid.createGrid(gridDiv, gridOptions);
        
        // Cargar datos
        window.v4GridApi.setGridOption('rowData', vr_todasOfertas);
        
        // Restaurar estado geométrico (Persistencia)
        window.cargarGridState();
        
        // Aplicar Clean Slate ( filterModel en null )
        window.v4GridApi.setFilterModel(null);
        
        // Pre-seleccionar mapeados
        window.v4GridApi.forEachNode(node => {
            const of = node.data;
            const estaMapeado = vr_mapeosActivos.some(m => 
                String(m.proveedor_id).trim() === String(of.proveedor_id).trim() && 
                String(m.proveedor_producto_codigo).trim().toLowerCase() === String(of.sku_proveedor).trim().toLowerCase()
            );
            if (estaMapeado) {
                node.setSelected(true);
            }
        });

        // Sincronizar UI de checkboxes de columnas
        sincronizarDropdownCampos();

        // Actualizar Barómetro
        window.updateFmtStatusBar();

    } catch (err) {
        console.error("Error abriendo vinculador manual AG Grid:", err);
        gridDiv.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 40px; font-weight: bold;">
                ❌ Error de conexión: ${err.message}
            </div>
        `;
    }
};

// ✅ CONTROL DEL SELECTOR DE PROVEEDORES
window.onProveedorFilterChanged = function() {
    const selectProveedor = document.getElementById('vr-filtro-proveedor');
    if (selectProveedor) {
        currentProveedorFilter = selectProveedor.value;
        if (window.v4GridApi) {
            window.v4GridApi.onFilterChanged();
        }
    }
};

// ✅ CONTROL DEL TOGGLE DE MAXIMIZADO DE PANTALLA COMPLETA
window.toggleMaximizarVinculador = function() {
    const modalContent = document.getElementById('vr-modal-content');
    const maximizeBtn = document.getElementById('vr-btn-maximize');
    if (!modalContent || !maximizeBtn) return;
    
    const isMaximized = modalContent.classList.toggle('vr-maximized');
    if (isMaximized) {
        maximizeBtn.innerHTML = '🗗';
        maximizeBtn.title = 'Restaurar';
    } else {
        maximizeBtn.innerHTML = '🗖';
        maximizeBtn.title = 'Maximizar';
    }
};

window.cerrarVinculadorReposicion = function() {
    // Higiene Obligatoria (Clean Slate) al cerrar
    localStorage.removeItem('lamda_v4_filter_state');
    if (window.v4GridApi) {
        window.v4GridApi.setFilterModel(null);
    }
    document.getElementById('modal-vinculador-reposicion').style.display = 'none';
};

// ✅ GUARDAR VINCULACIÓN EN BASE DE DATOS
window.guardarVinculacionReposicion = async function() {
    const articulo_id = document.getElementById('gp-articulo-id').value;
    if (!articulo_id) return;

    if (!window.v4GridApi) {
        Swal.fire('Error', 'La grilla no está inicializada.', 'error');
        return;
    }

    // Recopilar selección usando API nativa
    const selectedNodes = window.v4GridApi.getSelectedNodes();
    const mapeos = selectedNodes.map(node => ({
        proveedor_id: node.data.proveedor_id,
        proveedor_producto_codigo: node.data.sku_proveedor
    }));

    try {
        const res = await fetch(`/api/logistica/bunker/reposicion/mapeo/${encodeURIComponent(articulo_id)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mapeos })
        });

        if (!res.ok) throw new Error('Error al guardar vinculación en base de datos');
        const resJson = await res.json();

        if (resJson.success) {
            Swal.fire({
                title: '¡Guardado!',
                text: 'Las equivalencias de reposición se guardaron exitosamente.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
            
            // Higiene Obligatoria (Clean Slate) al guardar
            localStorage.removeItem('lamda_v4_filter_state');
            window.v4GridApi.setFilterModel(null);
            
            // Cerrar el vinculador
            cerrarVinculadorReposicion();
            
            // Refrescar el modal principal (Radiografía Financiera)
            const desc = document.getElementById('gp-producto').innerText;
            abrirGestorPrecios(articulo_id, desc);
        } else {
            throw new Error(resJson.error || 'Error desconocido');
        }

    } catch (err) {
        console.error("Error al guardar vinculación:", err);
        Swal.fire('Error', `No se pudo guardar la vinculación: ${err.message}`, 'error');
    }
};

// ✅ PERSISTENCIA DE PREFERENCIAS GEOMÉTRICAS (localStorage)
window.guardarGridState = function() {
    if (!window.v4GridApi) return;
    const state = window.v4GridApi.getColumnState();
    localStorage.setItem('lamda_v4_grid_state', JSON.stringify(state));
};

window.cargarGridState = function() {
    if (!window.v4GridApi) return;
    const stored = localStorage.getItem('lamda_v4_grid_state');
    if (stored) {
        try {
            const state = JSON.parse(stored);
            window.v4GridApi.applyColumnState({ state: state, applyOrder: true });
        } catch (e) {
            console.error('Error al restaurar firma geométrica de AG Grid:', e);
        }
    }
};

// ✅ CONFIGURADOR EN VIVO DE VISIBILIDAD DE CAMPOS (⚙️ Campos)
window.toggleColumnaVinculador = function(colId, isVisible) {
    if (window.v4GridApi) {
        window.v4GridApi.setColumnsVisible([colId], isVisible);
        window.guardarGridState();
    }
};

window.resetearVisibilidadColumnas = function() {
    if (window.v4GridApi) {
        const columns = ['sku_proveedor', 'nombre_proveedor', 'descripcion', 'rubro', 'cant_bult', 'cant_valor', 'precio_unitario', 'dias_antiguedad', 'dias_actualizacion'];
        window.v4GridApi.setColumnsVisible(columns, true);
        window.guardarGridState();
        sincronizarDropdownCampos();
    }
};

function sincronizarDropdownCampos() {
    if (!window.v4GridApi) return;
    const columns = ['sku_proveedor', 'nombre_proveedor', 'descripcion', 'rubro', 'cant_bult', 'cant_valor', 'precio_unitario', 'dias_antiguedad', 'dias_actualizacion'];
    
    const state = window.v4GridApi.getColumnState();
    
    columns.forEach(colId => {
        const colState = state.find(s => s.colId === colId);
        const isVisible = colState ? !colState.hide : true;
        
        let chkId = '';
        if (colId === 'sku_proveedor') chkId = 'chk-col-sku';
        else if (colId === 'nombre_proveedor') chkId = 'chk-col-prov';
        else if (colId === 'descripcion') chkId = 'chk-col-desc';
        else if (colId === 'rubro') chkId = 'chk-col-rubro';
        else if (colId === 'cant_bult') chkId = 'chk-col-cant-bult';
        else if (colId === 'cant_valor') chkId = 'chk-col-cant-valor';
        else if (colId === 'precio_unitario') chkId = 'chk-col-costo';
        else if (colId === 'dias_antiguedad') chkId = 'chk-col-ant';
        else if (colId === 'dias_actualizacion') chkId = 'chk-col-ultact';
        
        const chk = document.getElementById(chkId);
        if (chk) {
            chk.checked = isVisible;
        }
    });
}

window.toggleDropdownCampos = function(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('vr-dropdown-campos');
    const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
    dropdown.style.display = isHidden ? 'flex' : 'none';
};

// Cerrar dropdown al hacer click afuera
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('vr-dropdown-campos');
    if (dropdown && dropdown.style.display === 'flex') {
        const button = event.target.closest('button');
        const container = event.target.closest('#vr-dropdown-campos');
        if (!container && (!button || !button.innerText.includes('Campos'))) {
            dropdown.style.display = 'none';
        }
    }
});

// ✅ REACTIVIDAD DE PILLS EXTERNOS
window.setExternalFilter = function(filterType) {
    currentExternalFilter = filterType;
    
    document.querySelectorAll('.vr-pill').forEach(pill => {
        pill.classList.remove('active');
        if (pill.getAttribute('data-filter') === filterType) {
            pill.classList.add('active');
        }
    });
    
    if (window.v4GridApi) {
        window.v4GridApi.onFilterChanged();
    }
};

// ✅ SINCRONIZACIÓN DEL BARÓMETRO DE CONTROL (METRICAS)
window.updateFmtStatusBar = function() {
    if (!window.v4GridApi) return;
    
    const count = window.v4GridApi.getDisplayedRowCount();
    document.getElementById('fmtTotalVisualizados').innerText = count;
    
    let maxTimestamp = 0;
    let providerCount = new Set();
    
    window.v4GridApi.forEachNodeAfterFilterAndSort(node => {
        if (node.data && node.data._timestamp) {
            const ts = new Date(node.data._timestamp).getTime();
            if (ts > maxTimestamp) maxTimestamp = ts;
        }
        if (node.data && node.data._proveedor) {
            providerCount.add(node.data._proveedor);
        }
    });
    
    const txtDate = document.getElementById('fmtUltimaExtraccion');
    if (maxTimestamp > 0) {
        let diffDays = Math.floor((new Date() - maxTimestamp) / (1000 * 60 * 60 * 24));
        const dateStr = new Date(maxTimestamp).toLocaleDateString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const daysStr = diffDays === 0 ? "Hoy" : `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
        
        if (providerCount.size === 1) {
            txtDate.innerHTML = `
                <span class="text-blue-400 font-bold">${Array.from(providerCount)[0]}</span>: 
                <span class="tracking-wide">${dateStr}</span> 
                <span class="text-[9px] text-slate-500 font-normal">(${daysStr})</span> 
                <span class="ml-2 inline-flex items-center gap-1 bg-blue-900/40 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase">
                    ${count} registros
                </span>`;
        } else {
            txtDate.innerHTML = `${dateStr} <span class="text-[9px] text-slate-500 font-normal">(${daysStr})</span>`;
        }
    } else {
        txtDate.innerText = '--';
    }
};

// =========================================================================
// FASE 4: EXPOSICIÓN DE NUEVOS HITOS DE COSTOS DE INGREDIENTES EN FRACCIONES
// =========================================================================
window.actualizarAlertasIngredienteBase = function() {
    const parentLoteRow = document.getElementById('gp-parent-lote-row');
    const parentRepRow = document.getElementById('gp-parent-rep-row');
    const parentAlertEl = document.getElementById('gp-parent-alert');
    const parentLoteCostEl = document.getElementById('gp-costo-parent-lote');
    const parentRepCostEl = document.getElementById('gp-costo-parent-rep');

    if (!parentLoteRow || !parentRepRow || !parentAlertEl || !parentLoteCostEl || !parentRepCostEl) return;

    // Reset default hidden
    parentLoteRow.style.display = 'none';
    parentRepRow.style.display = 'none';
    parentAlertEl.style.display = 'none';

    // Si es un producto fraccionado/derivado (tiene pack_hijo_codigo activo)
    if (gp_packHijoCodigo) {
        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

        // 1. Costo Lote Padre (Kilo)
        let parentLoteKilo = 0;
        if (gp_parentLote) {
            parentLoteKilo = parseFloat(gp_parentLote.costo_kilo_al_momento) || 0;
        } else if (gp_parentCostoBaseManual !== null) {
            parentLoteKilo = parseFloat(gp_parentCostoBaseManual) / gp_parentKilosUnidad;
        } else if (gp_parentCostoLomasoft !== null) {
            parentLoteKilo = parseFloat(gp_parentCostoLomasoft) / gp_parentKilosUnidad;
        }

        if (parentLoteKilo > 0) {
            parentLoteRow.style.display = 'flex';
            parentLoteCostEl.innerText = currencyFormatter.format(parentLoteKilo);
            parentLoteCostEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${parentLoteKilo})`);
            parentLoteCostEl.title = `Haga clic para inyectar costo de lote de ingrediente base ($${parentLoteKilo.toFixed(2)}/kg)`;
        }

        // 2. Costo Reposición Padre (de Supabase cotizaciones)
        let parentRepKilo = 0;
        if (gp_reposicionOfertas && gp_reposicionOfertas.length > 0) {
            const validOffers = gp_reposicionOfertas.filter(o => o.precio_unitario > 0);
            if (validOffers.length > 0) {
                parentRepKilo = parseFloat(validOffers[0].precio_unitario) || 0;
            }
        }
        if (parentRepKilo > 0) {
            parentRepRow.style.display = 'flex';
            parentRepCostEl.innerText = currencyFormatter.format(parentRepKilo);
            parentRepCostEl.setAttribute('onclick', `window.aplicarCostoBaseManual(${parentRepKilo})`);
            parentRepCostEl.title = `Haga clic para inyectar costo de reposición de ingrediente base ($${parentRepKilo.toFixed(2)}/kg)`;
        }

        // 3. Alertas Contextuales de Advertencia (Comparar con el costo manual actual)
        const manualInput = document.getElementById('gp-costo-manual');
        if (manualInput) {
            const inputCostoManual = parseFloat(manualInput.value) || 0;
            let tieneVariacion = false;

            if (parentLoteKilo > 0 && Math.abs(parentLoteKilo - inputCostoManual) > 0.05) {
                tieneVariacion = true;
            }
            if (parentRepKilo > 0 && Math.abs(parentRepKilo - inputCostoManual) > 0.05) {
                tieneVariacion = true;
            }

            if (tieneVariacion) {
                parentAlertEl.style.display = 'block';
            }
        }
    }
};

// 🖨️ [FASE 4 - IMPRESIÓN ASIMÉTRICA] Envío directo de orden de impresión doble al backend
window.imprimirEtiquetaBunker = async function(id) {
    try {
        Swal.fire({
            title: 'Preparando Impresión',
            text: 'Enviando orden a la impresora Zebra...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const response = await fetch(`/api/logistica/bunker/articulos/${encodeURIComponent(id)}/imprimir`, {
            method: 'POST'
        });
        const res = await response.json();

        if (response.ok && res.success) {
            Swal.fire({
                title: '¡Impresión Enviada!',
                text: 'La etiqueta doble asimétrica se ha enviado a la Zebra con éxito.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            Swal.fire('Error al Imprimir', res.error || 'No se pudo enviar la orden a la impresora.', 'error');
        }
    } catch (e) {
        console.error('Error de red al imprimir:', e);
        Swal.fire('Error de Red', 'Fallo de comunicación con el servidor de logística.', 'error');
    }
};

// 📟 [FASE 4 - BUSCADOR OMNICANAL ESCÁNER]
window.procesarEscaneoBuscador = async function() {
    const input = document.getElementById('buscador-escaner');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    console.log(`📟 [ESCÁNER] Procesando código escaneado: "${val}"`);

    // Inyectar en el campo de búsqueda convencional para reflejar el estado actual
    const filtroBusqueda = document.getElementById('filtro-busqueda');
    if (filtroBusqueda) {
        filtroBusqueda.value = val;
    }

    // Refrescar el grid con el filtro aplicado
    await cargarDataGrid();

    // Limpiar el campo del escáner
    input.value = '';
    // Devolver el foco al campo del escáner para dejarlo listo para la siguiente lectura
    input.focus();
};

function initScannerExpressListener() {
    const scannerInput = document.getElementById('buscador-escaner');
    if (scannerInput) {
        // Enviar al presionar la tecla Enter (comportamiento por defecto de las lectoras de emulación de teclado)
        scannerInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.procesarEscaneoBuscador();
            }
        });

        // Asegurar que el foco vuelva al buscador de escáner tras des-enfoques accidentales
        // pero respetando la navegación a otros campos editables del listado
        scannerInput.addEventListener('blur', () => {
            setTimeout(() => {
                const active = document.activeElement;
                if (active && (
                    active.tagName === 'INPUT' || 
                    active.tagName === 'SELECT' || 
                    active.tagName === 'TEXTAREA' || 
                    active.tagName === 'BUTTON' ||
                    active.closest('.swal2-container') // No quitar foco si hay un SweetAlert2 abierto
                )) {
                    return;
                }
                scannerInput.focus();
            }, 150);
        });
    }
}

function initTableResizableColumns(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const cols = table.querySelectorAll('thead th');
    
    cols.forEach(col => {
        // Evitar duplicar resizers si ya existen, y no poner resizer en la columna Acciones
        if (col.querySelector('.resizer') || col.textContent.trim() === 'Acciones') return;
        
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        col.appendChild(resizer);
        
        let startX, startWidth;
        
        const mouseMoveHandler = (e) => {
            const width = startWidth + (e.pageX - startX);
            if (width > 50) { // Ancho mínimo de 50px
                col.style.width = `${width}px`;
            }
        };
        
        const mouseUpHandler = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            table.classList.remove('resizing');
        };

        resizer.addEventListener('mousedown', (e) => {
            startX = e.pageX;
            startWidth = col.offsetWidth;
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
            table.classList.add('resizing');
            e.preventDefault();
        });
    });
}

// =========================================================================
// 🚫 CONTROL DE EXCLUSIONES Y ORDENAMIENTO DE PROPIEDADES DINÁMICAS (FASE 4)
// =========================================================================

window.filtroCapas = [ { id: 1, propiedad: '', exclusions: [] } ]; // Inicializar con capa 1 estática
window.capaCounter = 1;

// Agrega una nueva capa de filtro dinámico
window.agregarCapaFiltro = function() {
    window.capaCounter++;
    const capaId = window.capaCounter;
    
    // Crear el objeto de estado de la capa
    window.filtroCapas.push({
        id: capaId,
        propiedad: '',
        exclusions: []
    });

    const container = document.getElementById('filtro-capas-container');
    if (!container) return;

    // Crear el elemento HTML
    const capaDiv = document.createElement('div');
    capaDiv.id = `capa-filtro-${capaId}`;
    capaDiv.className = 'capa-filtro-row';
    capaDiv.style.cssText = 'margin-top: 8px; width: 100%; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-weight: normal; text-align: left; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;';
    
    capaDiv.innerHTML = `
        <div style="display: flex; gap: 4px; align-items: center; justify-content: space-between;">
            <select class="select-propiedad-capa" data-capa-id="${capaId}" style="flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 4px; font-size: 0.8em; font-weight: normal; color: #1e293b; background: white;" onchange="window.cambiarPropiedadCapa(${capaId}, this.value)">
                <option value="">-- Seleccionar --</option>
                <option value="tipo">Tipo</option>
                <option value="color">Color</option>
                <option value="cosecha">Cosecha</option>
                <option value="variedad">Variedad</option>
                <option value="presentacion">Presentación</option>
            </select>
            <button type="button" class="btn-eliminar-capa" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 0.8em; font-weight: bold; height: 21px; display: flex; align-items: center; justify-content: center;" onclick="window.eliminarCapaFiltro(${capaId})" title="Eliminar Capa (➖)">
                ➖
            </button>
        </div>
        <div class="capa-calificativos-container" id="capa-calificativos-container-${capaId}" style="display: none;">
            <div style="font-size: 0.75em; font-weight: bold; color: #475569; text-transform: uppercase; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">
                <span>Calificativos:</span>
                <span style="color: #3b82f6; cursor: pointer; text-transform: none; font-size: 0.85em; font-weight: bold;" onclick="window.limpiarFiltrosCalificativosCapa(${capaId})" title="Mostrar Todo">🔄 Todo</span>
            </div>
            <div class="capa-checkboxes-list" id="capa-checkboxes-list-${capaId}" style="display: flex; flex-direction: column; gap: 4px; max-height: 100px; overflow-y: auto; padding-right: 4px;">
                <!-- Se poblará dinámicamente -->
            </div>
        </div>
    `;

    container.appendChild(capaDiv);
    window.actualizarDropdownsCapas();
};

// Elimina una capa de filtro y refresca la vista
window.eliminarCapaFiltro = function(capaId) {
    window.filtroCapas = window.filtroCapas.filter(c => c.id !== capaId);
    
    const capaDiv = document.getElementById(`capa-filtro-${capaId}`);
    if (capaDiv) {
        capaDiv.remove();
    }

    window.actualizarDropdownsCapas();
    window.aplicarFiltrosYOrdenamiento();
};

// Actualiza los dropdowns de propiedades excluyendo las que ya están seleccionadas
window.actualizarDropdownsCapas = function() {
    window.rebuildingDropdowns = true;
    try {
        const listadoPropiedades = [
            { value: 'tipo', label: 'Tipo' },
            { value: 'color', label: 'Color' },
            { value: 'cosecha', label: 'Cosecha' },
            { value: 'variedad', label: 'Variedad' },
            { value: 'presentacion', label: 'Presentación' }
        ];

        // Recopilar qué propiedades están seleccionadas en qué capas
        const seleccionadas = {};
        window.filtroCapas.forEach(capa => {
            if (capa.propiedad) {
                seleccionadas[capa.id] = capa.propiedad;
            }
        });

        // Para cada capa, re-generar las opciones de su select
        window.filtroCapas.forEach(capa => {
            const select = capa.id === 1
                ? document.getElementById('sort-propiedad')
                : document.querySelector(`.select-propiedad-capa[data-capa-id="${capa.id}"]`);
            if (!select) return;

            const valorActual = select.value || capa.propiedad;

            // Limpiar
            select.innerHTML = capa.id === 1 
                ? '<option value="">-- Sin Ordenar --</option>' 
                : '<option value="">-- Seleccionar --</option>';

            listadoPropiedades.forEach(item => {
                // Mostrar la propiedad si:
                // 1. No está seleccionada por ninguna otra capa
                // 2. O es la seleccionada por esta capa actual
                const estaEnOtraCapa = Object.entries(seleccionadas).some(([id, prop]) => parseInt(id) !== capa.id && prop === item.value);

                if (!estaEnOtraCapa) {
                    const opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    if (item.value === valorActual) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                }
            });

            // Forzar el valor seleccionado explícitamente para evitar pérdida de estado en la interfaz
            select.value = valorActual;
        });
    } finally {
        window.rebuildingDropdowns = false;
    }
};

// Cambia la propiedad asignada a una capa
window.cambiarPropiedadCapa = function(capaId, prop) {
    if (window.rebuildingDropdowns) return;

    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    if (capa.propiedad === prop) return;

    capa.propiedad = prop;
    capa.exclusions = []; // Limpiar exclusiones previas

    window.actualizarDropdownsCapas();
    window.aplicarFiltrosYOrdenamiento();
};

// Renderiza los checkboxes de calificativos de una capa específica (soporta cascada)
window.renderizarCheckboxesCapa = function(capaId, articulos) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    const subMenu = capa.id === 1
        ? document.getElementById('sub-menu-calificativos')
        : document.getElementById(`capa-calificativos-container-${capa.id}`);
    const listado = capa.id === 1
        ? document.getElementById('listado-calificativos-checkboxes')
        : document.getElementById(`capa-checkboxes-list-${capa.id}`);
    if (!subMenu || !listado) return;

    const prop = capa.propiedad;
    if (!prop) {
        subMenu.style.display = 'none';
        listado.innerHTML = '';
        return;
    }

    // Utilizar los artículos sobrevivientes de las capas superiores
    const dataset = articulos || articulosBunkerGlobal;

    const mapaValores = new Set();
    dataset.forEach(art => {
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            const rawVal = art.propiedades_dinamicas[prop];
            const valStr = typeof rawVal === 'object' ? rawVal.valor : rawVal;
            if (valStr !== undefined && valStr !== null && String(valStr).trim() !== '') {
                mapaValores.add(String(valStr).trim());
            }
        }
    });

    if (mapaValores.size === 0) {
        subMenu.style.display = 'none';
        listado.innerHTML = '';
        return;
    }

    subMenu.style.display = 'block';
    let html = '';
    const valoresOrdenados = Array.from(mapaValores).sort();

    valoresOrdenados.forEach(val => {
        const estaExcluido = capa.exclusions.includes(val);
        const isChecked = !estaExcluido;

        html += `
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.82em; color: #334155; cursor: pointer; user-select: none; margin: 0; padding: 2px 0;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.cambiarExclusionCalificativoCapa(${capaId}, '${val.replace(/'/g, "\\'")}', this.checked)" style="cursor: pointer; margin: 0;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${val}">${val}</span>
            </label>
        `;
    });

    listado.innerHTML = html;
};

// Alterna la exclusión de un calificativo en una capa
window.cambiarExclusionCalificativoCapa = function(capaId, val, isChecked) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    if (isChecked) {
        capa.exclusions = capa.exclusions.filter(v => v !== val);
    } else {
        if (!capa.exclusions.includes(val)) {
            capa.exclusions.push(val);
        }
    }

    window.aplicarFiltrosYOrdenamiento();
};

// Limpia todas las exclusiones de una capa
window.limpiarFiltrosCalificativosCapa = function(capaId) {
    const capa = window.filtroCapas.find(c => c.id === capaId);
    if (!capa) return;

    capa.exclusions = [];
    window.aplicarFiltrosYOrdenamiento();
};

// Sincroniza todos los checkboxes de todas las capas aplicando reactividad en cascada descendente
window.actualizarCheckboxesTodasLasCapas = function() {
    let articulosSurviving = [...articulosBunkerGlobal];

    window.filtroCapas.forEach((capa) => {
        // Renderizar los checkboxes de la capa usando solo los artículos que sobrevivieron a las capas superiores
        window.renderizarCheckboxesCapa(capa.id, articulosSurviving);

        // Filtrar los sobrevivientes para pasárselos a las capas de más abajo
        const prop = capa.propiedad;
        if (prop && capa.exclusions.length > 0) {
            articulosSurviving = articulosSurviving.filter(art => {
                if (!art.propiedades_dinamicas) return true;
                const rawVal = art.propiedades_dinamicas[prop];
                const valStr = typeof rawVal === 'object' ? rawVal.valor : rawVal;
                if (valStr !== undefined && valStr !== null) {
                    const valTrimmed = String(valStr).trim();
                    if (capa.exclusions.includes(valTrimmed)) {
                        return false;
                    }
                }
                return true;
            });
        }
    });
};

// Evento gatillado al cambiar el sub-atributo de ordenamiento en el dropdown de la cabecera
window.cambiarOrdenPropiedades = function(prop) {
    window.aplicarFiltrosYOrdenamiento();
};

// Alterna la dirección del ordenamiento (Ascendente / Descendente)
window.toggleSortDirectionPropiedades = function() {
    const btn = document.getElementById('btn-sort-dir');
    if (!btn) return;

    window.propSortAscending = !window.propSortAscending;
    if (window.propSortAscending) {
        btn.innerText = '🔼';
        btn.title = 'Alternar Dirección (Descendente)';
    } else {
        btn.innerText = '🔽';
        btn.title = 'Alternar Dirección (Ascendente)';
    }

    window.aplicarFiltrosYOrdenamiento();
};

// Aplica el filtrado de exclusiones y el ordenamiento secuencial por sub-atributos en el cliente,
// y procede a repintar la tabla del grid invocando renderizarGrid
window.aplicarFiltrosYOrdenamiento = function() {
    // 1. Recalcular y renderizar los checkboxes de cada capa reactivamente en cascada descendente
    window.actualizarCheckboxesTodasLasCapas();

    let articulosFiltrados = [...articulosBunkerGlobal];

    // 2. Filtrado por Exclusión en Cascada Cumulativa (AND entre capas)
    window.filtroCapas.forEach(capa => {
        const prop = capa.propiedad;
        if (!prop || capa.exclusions.length === 0) return;

        articulosFiltrados = articulosFiltrados.filter(art => {
            if (!art.propiedades_dinamicas) return true; // Si no posee atributos, no es excluido por valor específico

            const rawVal = art.propiedades_dinamicas[prop];
            const valStr = typeof rawVal === 'object' ? rawVal.valor : rawVal;
            if (valStr !== undefined && valStr !== null) {
                const valTrimmed = String(valStr).trim();
                if (capa.exclusions.includes(valTrimmed)) {
                    return false; // Excluido: Ocultar esta fila
                }
            }
            return true;
        });
    });

    // 3. Ordenamiento Secuencial por Sub-Atributo
    const sortPropSelect = document.getElementById('sort-propiedad');
    const sortProp = sortPropSelect ? sortPropSelect.value : '';

    if (sortProp) {
        const sortAsc = window.propSortAscending;
        articulosFiltrados.sort((a, b) => {
            let valA = obtenerValorOrdenamientoCapaD(a, sortProp);
            let valB = obtenerValorOrdenamientoCapaD(b, sortProp);

            // Si alguno es 0 (vacío/nulo), enviarlo al final independientemente de la dirección
            if (valA === 0 && valB !== 0) return 1;
            if (valB === 0 && valA !== 0) return -1;
            if (valA === 0 && valB === 0) return 0;

            // Comparar si ambos valores resueltos son numéricos (ej. pesos o kg normalizados)
            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortAsc ? valA - valB : valB - valA;
            }

            // Comparar de forma alfabética/semántica
            let strA = String(valA).toLowerCase();
            let strB = String(valB).toLowerCase();

            return sortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
    }

    // 4. Pintar en la tabla principal
    window.articulosVisiblesActualmente = articulosFiltrados;
    renderizarGrid(articulosFiltrados);
};

window.actualizarDisponibilidadListaModal = function(checked) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list) {
        list.disponible = checked;
    }
};

window.actualizarExencionOperativaModal = function(checked) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    list.exencion_operativa = checked;
    
    // Si desmarca la exención, sincronizar en caliente copiando los costos de otra lista no exenta
    if (!checked) {
        const otherNoExempt = gp_listasFinancieras.find((l, idx) => idx !== gp_activeTabIdx && !l.exencion_operativa);
        if (otherNoExempt) {
            list.costo_tiempo = otherNoExempt.costo_tiempo;
            list.insumos = JSON.parse(JSON.stringify(otherNoExempt.insumos || []));
            // Actualizar campos
            document.getElementById('gp-costo-tiempo').value = parseFloat(list.costo_tiempo || 0).toFixed(2);
            renderInsumosGrid();
        }
    }
    recalcularPreciosGestor();
};

function recalcularValoresDeListaEnMemoria(l) {
    const cBase = l.costo_base_sobrescrito !== null ? parseFloat(l.costo_base_sobrescrito) : gp_liveIngredienteCost;
    
    let cInsumos = 0;
    if (l.insumos && l.insumos.length > 0) {
        l.insumos.forEach(ins => {
            if (ins.incluido === true || ins.incluido === 'true') {
                cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
            }
        });
    }
    
    const cTiempo = parseFloat(l.costo_tiempo || 0);
    const cTotalPresentacion = cBase * gp_factorPresentacion;
    const cBulto = cTotalPresentacion + cInsumos;
    
    const modoIva = l.modo_iva || 'COMPLETO';
    let ivaVal = gp_ivaGlobal;
    if (modoIva === 'MEDIO') {
        ivaVal = gp_ivaGlobal / 2;
    } else if (modoIva === 'SIN') {
        ivaVal = 0.00;
    }
    l.iva = ivaVal;
    const ivaCoeff = 1 + (ivaVal / 100);
    
    let margen = parseFloat(l.margen_ganancia) || parseFloat(l.margen_porcentaje) || 0;
    if (l.modo_calculo === 'AUTOMATIC' && !l.has_manual_override && margen === 0 && l.margen_patron_heredado !== null && l.margen_patron_heredado !== undefined) {
        margen = parseFloat(l.margen_patron_heredado);
    }
    
    if (l.modo_calculo === 'AUTOMATIC') {
        const precioS_ivaBase = cBulto * (1 + (margen / 100)) + cTiempo;
        const precioFinalBase = precioS_ivaBase * ivaCoeff;
        l.precio_final = precioFinalBase;
    } else {
        // Modo MANUAL
        const precioFinalBase = parseFloat(l.precio_final) || 0;
        let margenImplicito = 0;
        if (cBulto > 0) {
            margenImplicito = (((precioFinalBase / ivaCoeff) - cTiempo) / cBulto - 1) * 100;
        }
        l.margen_porcentaje = margenImplicito;
        l.margen_ganancia = margenImplicito;
    }
}

function propagarCostosOperativos() {
    const activeList = gp_listasFinancieras[gp_activeTabIdx];
    if (!activeList || activeList.exencion_operativa) return;

    gp_listasFinancieras.forEach((l, idx) => {
        if (idx !== gp_activeTabIdx && !l.exencion_operativa) {
            l.costo_tiempo = activeList.costo_tiempo;
            // Clonar profundamente insumos para evitar referencias compartidas
            l.insumos = JSON.parse(JSON.stringify(activeList.insumos || []));
            recalcularValoresDeListaEnMemoria(l);
        }
    });
}

window.mostrarPopoverListas = function(event, articuloId) {
    event.stopPropagation();
    
    // Cerrar popover existente si hubiera
    const existing = document.getElementById('bunker-listas-popover');
    if (existing) {
        existing.remove();
    }
    
    // Buscar artículo en lista global
    const art = articulosBunkerGlobal.find(a => a.articulo_id === articuloId);
    if (!art) return;
    
    // Crear contenedor de popover
    const popover = document.createElement('div');
    popover.id = 'bunker-listas-popover';
    popover.style.cssText = `
        position: absolute;
        background: white;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 12px;
        z-index: 1100;
        min-width: 220px;
        font-family: inherit;
    `;
    
    // Posicionar el popover cerca del botón disparador
    const rect = event.target.getBoundingClientRect();
    popover.style.top = `${window.scrollY + rect.bottom + 5}px`;
    popover.style.left = `${window.scrollX + rect.left}px`;
    
    // Cabecera e inicio de lista
    let html = `
        <div style="font-weight: bold; font-size: 0.85em; color: #475569; margin-bottom: 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; user-select: none;">
            <span>Habilitar en Catálogos</span>
            <span style="cursor: pointer; font-size: 1.1em; font-weight: bold;" onclick="document.getElementById('bunker-listas-popover').remove()">×</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;">
    `;
    
    // Ordenar de forma que listaSeleccionadaGlobal sea el primero
    const reorderedListas = [...gp_listasFinancieras].sort((a, b) => {
        if (a.lista_id === listaSeleccionadaGlobal) return -1;
        if (b.lista_id === listaSeleccionadaGlobal) return 1;
        return a.lista_id - b.lista_id;
    });
    
    reorderedListas.forEach(lista => {
        const m = art.margenes ? art.margenes.find(x => Number(x.lista_id) === Number(lista.lista_id)) : null;
        const disponible = m ? (m.disponible !== false) : true;
        const star = lista.lista_id === listaSeleccionadaGlobal ? ' <span style="color: #eab308; font-size: 0.8em;" title="Lista Activa en Grid">★</span>' : '';
        
        html += `
            <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85em; color: #1e293b; cursor: pointer; user-select: none;">
                <input type="checkbox" data-lista-id="${lista.lista_id}" ${disponible ? 'checked' : ''} onchange="window.toggleDisponibilidadArticulo('${articuloId}', ${lista.lista_id}, this.checked)">
                <span>${lista.nombre_lista}${star}</span>
            </label>
        `;
    });
    
    html += '</div>';
    popover.innerHTML = html;
    document.body.appendChild(popover);
    
    // Cerrar al hacer click afuera
    const outsideClickListener = (e) => {
        if (!popover.contains(e.target) && e.target !== event.target) {
            popover.remove();
            document.removeEventListener('click', outsideClickListener);
        }
    };
    // Esperar al siguiente tick para registrar y no dispararse en este evento
    setTimeout(() => {
        document.addEventListener('click', outsideClickListener);
    }, 0);
};

window.toggleDisponibilidadArticulo = async function(articuloId, listaId, disponible) {
    try {
        const res = await fetch('/api/logistica/bunker/articulo/lista-disponibilidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articuloId, listaId, disponible })
        });
        const result = await res.json();
        
        if (res.ok && result.success) {
            // Actualizar estado en memoria local
            const art = articulosBunkerGlobal.find(a => a.articulo_id === articuloId);
            if (art && art.margenes) {
                let m = art.margenes.find(x => Number(x.lista_id) === Number(listaId));
                if (m) {
                    m.disponible = disponible;
                } else {
                    art.margenes.push({
                        lista_id: listaId,
                        margen_porcentaje: 0,
                        costo_base_sobrescrito: null,
                        costo_tiempo: 0,
                        iva: art.porcentaje_iva || 21,
                        precio_final: 0,
                        modo_calculo: 'AUTOMATIC',
                        costo_desactualizado: false,
                        disponible: disponible
                    });
                }
            }
            
            // Si coincide con la lista activa en la grilla, aplicar cambio visual en tiempo real
            if (Number(listaId) === Number(listaSeleccionadaGlobal)) {
                const rows = document.getElementById('tbody-bunker').children;
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.cells && row.cells.length > 0 && row.cells[0].textContent.trim() === articuloId) {
                        if (disponible) {
                            row.classList.remove('articulo-excluido');
                            const badgeEl = row.cells[1].querySelector('.badge');
                            if (badgeEl && badgeEl.textContent.includes('Excluido')) {
                                badgeEl.remove();
                            }
                        } else {
                            row.classList.add('articulo-excluido');
                            const descStrong = row.cells[1].querySelector('strong');
                            if (descStrong) {
                                const existingBadge = row.cells[1].querySelector('.badge');
                                if (!existingBadge || !existingBadge.textContent.includes('Excluido')) {
                                    const badgeSpan = document.createElement('span');
                                    badgeSpan.className = 'badge';
                                    badgeSpan.style.cssText = 'background-color: #64748b; color: white; padding: 2px 6px; font-size: 0.75em; border-radius: 4px; vertical-align: middle; margin-left: 5px;';
                                    badgeSpan.textContent = '🚫 Excluido';
                                    descStrong.after(badgeSpan);
                                }
                            }
                        }
                        break;
                    }
                }
            }
        } else {
            console.error('Error actualizando disponibilidad:', result.error);
            Swal.fire('Error', result.error || 'No se pudo actualizar la disponibilidad.', 'error');
        }
    } catch (e) {
        console.error('Error en fetch disponibilidad:', e);
        Swal.fire('Error', 'Fallo de red al intentar actualizar la disponibilidad.', 'error');
    }
};

// ==========================================
// SELECCIÓN Y ACTUALIZACIÓN EN LOTE (HITL)
// ==========================================
// ==========================================
// SELECCIÓN Y ACTUALIZACIÓN EN LOTE (HITL)
// ==========================================
function obtenerIdsElegiblesVisibles() {
    return (window.articulosVisiblesActualmente || []).filter(a => {
        const mFocused = a.margenes ? a.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) : null;
        const disponibleActiva = mFocused ? (mFocused.disponible !== false) : true;
        const isBaja = a._estado_delta === 'BAJA' || a.estado === 'BAJA';
        return disponibleActiva && !isBaja;
    }).map(a => a.articulo_id);
}

window.toggleSeleccionArticuloMasa = function(articuloId, checked) {
    if (checked) {
        window.articulosSeleccionadosMasa.add(articuloId);
    } else {
        window.articulosSeleccionadosMasa.delete(articuloId);
    }
    
    // Sincronizar checkbox maestro basado únicamente en artículos elegibles visibles
    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
    if (masterCheckbox) {
        const eligibleIds = obtenerIdsElegiblesVisibles();
        const allChecked = eligibleIds.length > 0 && eligibleIds.every(id => window.articulosSeleccionadosMasa.has(id));
        masterCheckbox.checked = allChecked;
    }
    
    window.actualizarEstadoBotonMasivo();
};

window.toggleSeleccionarTodoVisible = function(checked) {
    const eligibleIds = obtenerIdsElegiblesVisibles();
    const visibleIds = (window.articulosVisiblesActualmente || []).map(a => a.articulo_id);
    
    visibleIds.forEach(id => {
        if (checked) {
            // Solo agregar si es elegible
            if (eligibleIds.includes(id)) {
                window.articulosSeleccionadosMasa.add(id);
            }
        } else {
            // Si desmarcamos, removemos todos los visibles seleccionados
            window.articulosSeleccionadosMasa.delete(id);
        }
    });
    
    // Actualizar checkboxes del DOM a su estado correspondiente
    const inputs = document.querySelectorAll('.chk-articulo-masa');
    inputs.forEach(input => {
        const id = input.getAttribute('data-articulo-id');
        input.checked = window.articulosSeleccionadosMasa.has(id);
    });
    
    window.actualizarEstadoBotonMasivo();
};

window.actualizarEstadoBotonMasivo = function() {
    const btn = document.getElementById('btn-actualizar-margenes-masa');
    if (!btn) return;
    
    // Solo considerar seleccionados los artículos que además estén actualmente visibles
    const seleccionadosVisibles = Array.from(window.articulosSeleccionadosMasa).filter(id => 
        (window.articulosVisiblesActualmente || []).some(a => a.articulo_id === id)
    );
    
    const tieneSeleccionados = seleccionadosVisibles.length > 0;
    
    // Habilitado si hay al menos uno seleccionado y visible, sin acoplamiento a filtros
    if (tieneSeleccionados) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    }
};

window.abrirMinimodalMargenesMasa = function() {
    // Obtener artículos a actualizar
    const seleccionadosVisibles = Array.from(window.articulosSeleccionadosMasa).filter(id => 
        (window.articulosVisiblesActualmente || []).some(a => a.articulo_id === id)
    );
    
    if (seleccionadosVisibles.length === 0) {
        Swal.fire({
            title: 'Sin Selección',
            text: 'Debe seleccionar al menos un artículo visible en la grilla.',
            icon: 'warning'
        });
        return;
    }
    
    Swal.fire({
        title: 'Actualizar en Masa (Búnker)',
        html: `
            <p style="font-size: 0.92em; color: #475569; margin-bottom: 15px; text-align: left; line-height: 1.4;">
                Se actualizarán los <strong>${seleccionadosVisibles.length}</strong> artículos seleccionados. Los precios finales se recalcularán automáticamente en la base de datos.
            </p>
            <div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px; text-align: left;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-margen-masa" style="font-weight: bold; font-size: 0.9em; color: #1e293b;">
                        Nuevo Margen de Ganancia General (%):
                    </label>
                    <input type="number" id="swal-margen-masa" class="swal2-input" placeholder="Ej: 35.00" step="0.01" style="margin: 0; width: 100%; box-sizing: border-box;">
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="swal-iva-masa" style="font-weight: bold; font-size: 0.9em; color: #1e293b;">
                        Tratamiento de IVA a Aplicar:
                    </label>
                    <select id="swal-iva-masa" class="swal2-select" style="margin: 0; width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 1em; color: #1e293b; background: white; font-weight: 500;">
                        <option value="MANTENER" selected>Mantener actual de cada artículo</option>
                        <option value="COMPLETO">Completo (100% del IVA original)</option>
                        <option value="MEDIO">Medio IVA (50% del IVA original)</option>
                        <option value="SIN">Sin IVA / Exento (0%)</option>
                    </select>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Confirmar Actualización',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const val = document.getElementById('swal-margen-masa').value;
            const floatVal = parseFloat(val);
            const ivaVal = document.getElementById('swal-iva-masa').value;
            
            // Sanitización y blindaje de la entrada numérica (SweetAlert2)
            // Debe ser un número válido estrictamente mayor o igual a 0 (ej. permitir margen 0% para venta al costo)
            if (isNaN(floatVal)) {
                Swal.showValidationMessage('Debe ingresar un porcentaje numérico válido.');
                return false;
            }
            if (floatVal < 0) {
                Swal.showValidationMessage('El margen de ganancia no puede ser menor a 0%.');
                return false;
            }
            return { margen: floatVal, modoIva: ivaVal };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const { margen, modoIva } = result.value;
            
            Swal.fire({
                title: 'Actualizando artículos...',
                text: 'Procesando recálculo en lote y persistiendo en base de datos.',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
            
            try {
                const response = await fetch('/api/logistica/bunker/articulos/actualizar-margenes-masa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lista_id: listaSeleccionadaGlobal,
                        articulo_ids: seleccionadosVisibles,
                        margen_ganancia: margen,
                        modo_iva: modoIva
                    })
                });
                
                const resData = await response.json();
                
                if (response.ok && resData.success) {
                    Swal.fire({
                        title: 'Actualización Exitosa',
                        text: `Se actualizaron los márgenes y alícuotas para los ${seleccionadosVisibles.length} artículos.`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Limpiar selección tras la actualización exitosa (Pizarra Limpia)
                    window.articulosSeleccionadosMasa.clear();
                    
                    // Sincronizar/desmarcar checkbox maestro visualmente
                    const masterCheckbox = document.getElementById('chk-seleccionar-todo-visible');
                    if (masterCheckbox) {
                        masterCheckbox.checked = false;
                    }
                    
                    // Refrescar en caliente
                    await cargarDataGrid();
                } else {
                    Swal.fire('Error', resData.error || 'No se pudo realizar la actualización masiva.', 'error');
                }
            } catch (err) {
                console.error(err);
                Swal.fire('Error de Conexión', 'Fallo de red al intentar comunicarse con el servidor.', 'error');
            }
        }
    });
};




