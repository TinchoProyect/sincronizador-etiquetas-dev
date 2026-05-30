let articulosBunkerGlobal = [];
let listaSeleccionadaGlobal = 1; // Default a Lista 1

document.addEventListener('DOMContentLoaded', async () => {
    initColumnToggler();
    await cargarListasPreciosFiltro();
    await cargarDataGrid();
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
        } else {
            select.innerHTML = '<option value="1">L1 Base</option>';
        }
    } catch(e) {
        console.error('Error cargando listas:', e);
    }
}

window.cambiarListaPreciosDataGrid = function(nuevaListaId) {
    listaSeleccionadaGlobal = parseInt(nuevaListaId);
    renderizarGrid(articulosBunkerGlobal);
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
    { id: 11, name: 'Total Entrante (Kg)', defaultVisible: true }
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
    const search = document.getElementById('filtro-busqueda').value.trim();
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;">Cargando Búnker...</td></tr>';
    
    try {
        const query = search ? `?search=${encodeURIComponent(search)}` : '';
        const res = await fetch(`/api/logistica/bunker/listado${query}`);
        const result = await res.json();
        
        if (res.ok && result.success) {
            articulosBunkerGlobal = result.data;
            renderizarGrid(result.data);
        } else {
            throw new Error(result.error);
        }
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="13" style="color: red; text-align: center;">Error de conexión: ${e.message}</td></tr>`;
    }
}

function renderizarGrid(articulos) {
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '';
    
    if (articulos.length === 0) {
         tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;">No se encontraron artículos en el Búnker.</td></tr>';
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
        
        trMain.innerHTML = `
            <td style="font-family: monospace; font-weight: bold; color: #3b82f6;">${art.articulo_id}</td>
            <td>
                <strong>${art.descripcion}</strong><br>
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
            <td style="text-align: center;">
                <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
                    <button type="button" style="background: #8e4785; color: white; padding: 8px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9em; display: flex; gap: 5px; align-items: center; box-shadow: 0 2px 4px rgba(142,71,133,0.15);" onclick="abrirGestorPrecios('${art.articulo_id}', '${art.descripcion_generada || art.descripcion}', ${iva})" title="Gestor de Precios Independiente">
                        💰 Finanzas
                    </button>
                    <button class="btn-edit" onclick="editarArticulo('${art.articulo_id}')">✏️ Editar</button>
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
                <td colspan="13" style="padding: 10px 40px; background-color: #f1f5f9;">
                    <div style="margin-bottom: 5px; font-weight: 600; color: #334155; font-size: 0.9em;">👇 Desglose Financiero de Listas de Precios Búnker</div>
                    ${expandedGridHtml}
                </td>
            `;
            tbody.appendChild(trDetails);
        }
    });
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

window.abrirGestorPrecios = async function(articulo_id, descripcion, iva) {
    document.getElementById('gp-producto').innerText = descripcion;
    document.getElementById('gp-articulo-id').value = articulo_id;
    gp_ivaGlobal = parseFloat(iva) || 21;
    gp_activeTabIdx = 0;
    
    // UI Reset
    document.getElementById('gp-costo-vivo-val').innerText = '$ 0,00';
    document.getElementById('gp-costo-manual').value = '';
    document.getElementById('gp-buscar-insumo').value = '';
    document.getElementById('gp-insumos-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando...</td></tr>';
    document.getElementById('gp-receta-ingredientes').innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic;">Cargando estructura de receta...</div>';
    document.getElementById('gp-tabs-container').innerHTML = '<span style="color:#64748b; font-style:italic; padding: 5px;">Cargando listas...</span>';
    document.getElementById('gp-alerta-desactualizado').style.display = 'none';

    document.getElementById('modal-gestor-precios').style.display = 'flex';
    
    try {
        const res = await fetch(`/api/logistica/bunker/finanzas/${encodeURIComponent(articulo_id)}`);
        const result = await res.json();
        
        if (res.ok && result.success) {
            const data = result.data;
            gp_loteVal = data.lote;
            gp_stockUnidadesVal = data.stock_unidades || 0;
            gp_stockKilosVal = data.stock_kilos || 0;
            gp_factorPresentacion = parseFloat(data.kilos_unidad) > 0 ? parseFloat(data.kilos_unidad) : 1.00;
            
            const factorEl = document.getElementById('gp-factor-presentacion');
            if (factorEl) {
                factorEl.innerText = `${gp_factorPresentacion.toFixed(2)} kg`;
            }
            
            // Calcular Costo de Ingrediente en Vivo por KILO
            let rawIngredienteCost = 0;
            if (data.receta_id && data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                let recipeTotalCost = 0;
                data.receta_ingredientes.forEach(ing => {
                    const cKilo = parseFloat(ing.costo_kilo_lote) || 0;
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
            
            document.getElementById('gp-costo-vivo-val').innerText = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(gp_liveIngredienteCost);

            // Despliegue Informativo y Normalizado de Costo Lomasoft (Fase 1: Multi-Fuente)
            // Decisión de diseño: Se formatea el bulto y se divide por el factor para tener el costo por kilo normalizado.
            const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
            const costoLomasoftBulto = parseFloat(data.costo_lomasoft) || 0;
            const costoLomasoftKilo = gp_factorPresentacion > 0 ? (costoLomasoftBulto / gp_factorPresentacion) : 0;

            const lomaValEl = document.getElementById('gp-costo-lomasoft-val');
            const lomaBultoEl = document.getElementById('gp-costo-lomasoft-bulto');
            if (lomaValEl && lomaBultoEl) {
                lomaValEl.innerText = costoLomasoftKilo > 0 ? currencyFormatter.format(costoLomasoftKilo) : 'N/A';
                lomaBultoEl.innerText = costoLomasoftBulto > 0 ? currencyFormatter.format(costoLomasoftBulto) : 'N/A';
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
                        data.receta_ingredientes.forEach(ing => {
                            const costoKilo = parseFloat(ing.costo_kilo_lote || 0);
                            const cantidad = parseFloat(ing.cantidad || 0);
                            const costoRef = cantidad * costoKilo;
                            html += `
                                <div style="display: flex; flex-direction: column; padding: 8px 10px; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; font-size: 0.82em; box-shadow: 0 1px 2px rgba(0,0,0,0.02); gap: 4px;" title="${ing.lote_id_ref ? 'Lote de referencia: ' + ing.lote_id_ref : 'Sin lote vinculado'}">
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                                        <span style="font-weight: 700; color: #0369a1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${ing.nombre_ingrediente}</span>
                                        <span style="font-weight: 800; color: #0369a1; font-family: monospace; background: white; padding: 1px 4px; border-radius: 4px; border: 1px solid #bae6fd; white-space: nowrap;">
                                            ${cantidad.toLocaleString('es-AR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} ${ing.unidad_medida}
                                        </span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed rgba(3, 105, 161, 0.15); padding-top: 3px;">
                                        <span style="color: #64748b;">${costoKilo > 0 ? currencyFormatter.format(costoKilo) + '/kg' : 'N/A'}</span>
                                        <strong style="color: #0284c7;">${costoKilo > 0 ? currencyFormatter.format(costoRef) : 'N/A'}</strong>
                                    </div>
                                </div>
                            `;
                        });
                    }
                    recetaIngredientes.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic; padding: 10px;">La receta no posee ingredientes configurados.</div>';
                } else {
                    recetaInfoBadge.innerText = 'Sin Receta';
                    recetaInfoBadge.style.background = '#fef3c7';
                    recetaInfoBadge.style.color = '#d97706';
                    recetaIngredientes.innerHTML = `
                        <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 6px; color: #b45309; font-weight: 500; font-size: 0.9em;">
                            ⚠️ Este artículo no posee una receta de producción activa.
                        </div>
                    `;
                }
            }
            
            gp_listasFinancieras = data.listas_margenes;
            renderTabs();
            selectTab(0);
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

window.cerrarGestorPrecios = function() {
    document.getElementById('modal-gestor-precios').style.display = 'none';
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
        totalInsumos += subtotal;
        
        // Alerta de desfase en insumo
        const liveCost = parseFloat(ins.costo_unitario_en_vivo || uCost);
        const isDiff = Math.abs(liveCost - uCost) > 0.01;
        const diffBadge = isDiff ? ` <span style="color:#d97706; cursor:help;" title="Live cost: ${formatter.format(liveCost)} (Discrepancia detectada)">⚠️</span>` : '';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${ins.descripcion || ins.insumo_articulo_numero}</strong><br>
                <span style="font-family: monospace; font-size: 0.8em; color: #64748b;">${ins.insumo_articulo_numero}</span>
            </td>
            <td>
                <input type="number" step="0.0001" value="${qty}" style="width: 100%; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:center;" oninput="actualizarInsumoQty(${subIdx}, this.value)">
            </td>
            <td style="text-align: right;">
                <div style="display:flex; justify-content: flex-end; align-items:center; gap: 4px;">
                    <input type="number" step="0.01" value="${uCost.toFixed(2)}" style="width: 70px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align:right;" oninput="actualizarInsumoCost(${subIdx}, this.value)">
                    ${diffBadge}
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
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.actualizarInsumoCost = function(idx, val) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos && list.insumos[idx]) {
        list.insumos[idx].costo_unitario_capturado = parseFloat(val) || 0;
        renderInsumosGrid();
        recalcularPreciosGestor();
    }
};

window.removerInsumo = function(idx) {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (list && list.insumos) {
        list.insumos.splice(idx, 1);
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
        costo_unitario_en_vivo: parseFloat(art.costo_base || 0)
    });
    
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
            cInsumos += parseFloat(ins.cantidad || 1) * parseFloat(ins.costo_unitario_capturado || 0);
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

    if (list.modo_calculo === 'AUTOMATIC') {
        // Evitar sobreescritura si el usuario está enfocado
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margen.toFixed(2);
        }
        
        // Precio Final del Bulto = [ Costo Total Bulto * (1 + Margen/100) + Costo Tiempo ] * (1 + IVA)
        const precioS_iva = cBulto * (1 + (margen / 100)) + cTiempo;
        const precioFinal = precioS_iva * ivaCoeff;
        
        list.precio_final = precioFinal;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinal.toFixed(2);
        }
        
        // Métricas secundarias (basadas en bulto)
        const iibb = precioFinal * 0.04;
        const gananciaNeta = precioS_iva - cTiempo - cBulto;
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_iva);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        document.getElementById('gp-ganancia-neta').innerText = formatter.format(gananciaNeta);
        document.getElementById('gp-ganancia-neta').style.color = gananciaNeta >= 0 ? '#15803d' : '#ef4444';
    } else {
        // Modo MANUAL
        const precioFinal = parseFloat(list.precio_final) || 0;
        if (document.activeElement.id !== 'gp-precio-final') {
            document.getElementById('gp-precio-final').value = precioFinal.toFixed(2);
        }
        
        // Margen Implícito = ( (Precio Final / (1+IVA) - Costo Tiempo) / Costo Total Bulto - 1 ) * 100
        const precioS_iva = precioFinal / ivaCoeff;
        let margenImplicito = 0;
        if (cBulto > 0) {
            margenImplicito = ((precioS_iva - cTiempo) / cBulto - 1) * 100;
        }
        
        list.margen_porcentaje = margenImplicito; // compatibilidad
        list.margen_ganancia = margenImplicito;
        if (document.activeElement.id !== 'gp-margen' && margenInput) {
            margenInput.value = margenImplicito.toFixed(2);
        }
        
        // Métricas secundarias (basadas en bulto)
        const iibb = precioFinal * 0.04;
        const gananciaNeta = precioS_iva - cTiempo - cBulto;
        
        document.getElementById('gp-precio-sin-iva').innerText = formatter.format(precioS_iva);
        document.getElementById('gp-iibb').innerText = formatter.format(iibb);
        document.getElementById('gp-ganancia-neta').innerText = formatter.format(gananciaNeta);
        document.getElementById('gp-ganancia-neta').style.color = gananciaNeta >= 0 ? '#15803d' : '#ef4444';
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
            costo_unitario_capturado: parseFloat(ins.costo_unitario_capturado) || 0
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
window.guardarConfiguracionColumnas = function() {
    try {
        const getChecked = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : true;
        };
        const configs = {
            codigo: getChecked('p-col-codigo'),
            descripcion: getChecked('p-col-descripcion'),
            presentacion: getChecked('p-col-presentacion'),
            kilo: getChecked('p-col-kilo'),
            bulto: getChecked('p-col-bulto'),
            final_kilo: getChecked('p-col-final-kilo'),
            final_bulto: getChecked('p-col-final-bulto')
        };
        localStorage.setItem('bunker_pdf_columns_config', JSON.stringify(configs));
    } catch (e) {
        console.error("Error guardando configuración de columnas:", e);
    }
};

window.cargarConfiguracionColumnas = function() {
    try {
        const stored = localStorage.getItem('bunker_pdf_columns_config');
        if (stored) {
            const configs = JSON.parse(stored);
            if (configs && typeof configs === 'object') {
                if (document.getElementById('p-col-codigo')) document.getElementById('p-col-codigo').checked = configs.codigo !== undefined ? !!configs.codigo : true;
                if (document.getElementById('p-col-descripcion')) document.getElementById('p-col-descripcion').checked = configs.descripcion !== undefined ? !!configs.descripcion : true;
                if (document.getElementById('p-col-presentacion')) document.getElementById('p-col-presentacion').checked = configs.presentacion !== undefined ? !!configs.presentacion : true;
                if (document.getElementById('p-col-kilo')) document.getElementById('p-col-kilo').checked = configs.kilo !== undefined ? !!configs.kilo : true;
                if (document.getElementById('p-col-bulto')) document.getElementById('p-col-bulto').checked = configs.bulto !== undefined ? !!configs.bulto : true;
                if (document.getElementById('p-col-final-kilo')) document.getElementById('p-col-final-kilo').checked = configs.final_kilo !== undefined ? !!configs.final_kilo : true;
                if (document.getElementById('p-col-final-bulto')) document.getElementById('p-col-final-bulto').checked = configs.final_bulto !== undefined ? !!configs.final_bulto : true;
            }
        }
    } catch (e) {
        console.error("Error cargando configuración de columnas:", e);
    }
};

window.abrirPrevisualizadorPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list || !list.lista_id) {
        Swal.fire('Error', 'No se pudo determinar la lista activa en el Gestor de Precios.', 'error');
        return;
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
    
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'flex';
    }
    
    window.actualizarPrevisualizacionPDF();
};

window.cerrarPrevisualizadorPDF = function() {
    const modalEl = document.getElementById('modal-preimpresion-pdf');
    if (modalEl) {
        modalEl.style.display = 'none';
    }
};

window.actualizarPrevisualizacionPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;
    
    // Guardar estado actual de columnas
    window.guardarConfiguracionColumnas();
    
    const isChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : true;
    };
    
    // 1. Obtener Columnas Activas
    const cols = [];
    if (isChecked('p-col-codigo')) cols.push({ id: 'codigo', label: 'Código', align: 'left', baseWidth: 65 });
    if (isChecked('p-col-descripcion')) cols.push({ id: 'descripcion', label: 'Descripción', align: 'left', baseWidth: 190 });
    if (isChecked('p-col-presentacion')) cols.push({ id: 'presentacion', label: 'Presentación', align: 'left', baseWidth: 100 });
    if (isChecked('p-col-kilo')) cols.push({ id: 'kilo', label: 'Precio Kilo (Neto)', align: 'right', baseWidth: 70 });
    if (isChecked('p-col-bulto')) cols.push({ id: 'bulto', label: 'Precio Bulto (Neto)', align: 'right', baseWidth: 70 });
    if (isChecked('p-col-final-kilo')) cols.push({ id: 'final_kilo', label: 'Precio Kilo Final', align: 'right', baseWidth: 70 });
    if (isChecked('p-col-final-bulto')) cols.push({ id: 'final_bulto', label: 'Precio Bulto Final', align: 'right', baseWidth: 70 });
    
    if (cols.length === 0) {
        cols.push({ id: 'descripcion', label: 'Descripción', align: 'left', baseWidth: 190 });
    }
    
    // 2. Calcular anchos elásticos proporcionales (ancho total de tabla es 100%)
    let totalBase = cols.reduce((sum, c) => sum + c.baseWidth, 0);
    cols.forEach(c => {
        c.percentWidth = ((c.baseWidth / totalBase) * 100).toFixed(2) + '%';
    });
    
    // 3. Renderizar thead con anchos adaptativos
    const thead = document.getElementById('pdf-prev-table-thead');
    let theadHtml = '<tr>';
    cols.forEach(c => {
        theadHtml += `<th style="width: ${c.percentWidth}; text-align: ${c.align}; padding: 8px; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.5px;">${c.label}</th>`;
    });
    theadHtml += '</tr>';
    thead.innerHTML = theadHtml;
    
    // 4. Renderizar tbody con datos reales de la lista
    const tbody = document.getElementById('pdf-prev-table-tbody');
    tbody.innerHTML = '';
    
    // Filtrar los artículos que tienen esta lista en `articulosBunkerGlobal`
    const articulosFiltrados = articulosBunkerGlobal.filter(art => {
        return art.margenes && art.margenes.some(m => m.lista_id === listaId);
    });
    
    if (articulosFiltrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align: center; padding: 20px; color: #94a3b8; font-style: italic;">No hay artículos asociados a esta lista para previsualizar.</td></tr>`;
        return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    
    articulosFiltrados.forEach((art, index) => {
        // Encontrar configuración del artículo para esta lista
        const mFocused = art.margenes.find(m => m.lista_id === listaId);
        if (!mFocused) return;
        
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
    });
};

window.confirmarEImprimirPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    
    // Obtener columnas activas
    const cols = [];
    if (document.getElementById('p-col-codigo').checked) cols.push('codigo');
    if (document.getElementById('p-col-descripcion').checked) cols.push('descripcion');
    if (document.getElementById('p-col-presentacion').checked) cols.push('presentacion');
    if (document.getElementById('p-col-kilo').checked) cols.push('kilo');
    if (document.getElementById('p-col-bulto').checked) cols.push('bulto');
    if (document.getElementById('p-col-final-kilo').checked) cols.push('final_kilo');
    if (document.getElementById('p-col-final-bulto').checked) cols.push('final_bulto');
    
    if (cols.length === 0) {
        cols.push('descripcion');
    }
    
    const colsQuery = cols.join(',');
    
    // Cerrar previsualizador para mejorar UX
    cerrarPrevisualizadorPDF();
    
    // Abrir descarga en nueva pestaña
    window.open(`/api/logistica/bunker/exportar-pdf/${list.lista_id}?columns=${colsQuery}`, '_blank');
};
