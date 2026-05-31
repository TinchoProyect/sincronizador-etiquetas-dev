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

window.cambiarListaPreciosDataGrid = function(nuevaListaId) {
    listaSeleccionadaGlobal = parseInt(nuevaListaId);
    
    // Sincronizar el tab activo del gestor financiero
    if (gp_listasFinancieras && gp_listasFinancieras.length > 0) {
        const idx = gp_listasFinancieras.findIndex(l => Number(l.lista_id) === Number(nuevaListaId));
        if (idx !== -1) {
            gp_activeTabIdx = idx;
        }
    }
    
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

let gp_costoLomasoftKilo = 0;
let gp_reposicionOfertas = [];

function renderOfertasReposicion(ofertas) {
    gp_reposicionOfertas = ofertas || [];
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
    
    // UI Reset
    document.getElementById('gp-costo-integrado').innerText = '$ 0,00';
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
                const hasParentIng = !!data.costo_referencia_lote;

                if (hasRecipe || hasParentIng) {
                    const recKiloVal = gp_liveIngredienteCost;
                    const recBultoVal = gp_liveIngredienteCost * gp_factorPresentacion;
                    const estructuraTipo = hasRecipe ? 'Receta' : 'Insumo Padre';
                    const origenTexto = hasRecipe ? `ID: ${data.receta_id}` : `PADRE: ${data.nombre_ingrediente_ref || 'Granel'}`;

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
                        recKiloEl.title = `Haga clic para inyectar este costo ($${recKiloVal.toFixed(2)}/kg)`;
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

window.cerrarGestorPrecios = function() {
    document.getElementById('modal-gestor-precios').style.display = 'none';
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
    if (list.fuente_costo_default) {
        const valDefault = window.obtenerValorFuenteDefault(list.fuente_costo_default);
        if (valDefault !== null && valDefault > 0) {
            list.costo_base_sobrescrito = valDefault;
        }
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
            fuente_costo_default: l.fuente_costo_default || null,
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

window.inicializarArbolCategorias = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;
    
    // Filtrar los artículos que tienen esta lista activa con casting robusto de lista_id
    const articulosFiltrados = articulosBunkerGlobal.filter(art => {
        return art.margenes && art.margenes.some(m => Number(m.lista_id) === Number(listaId));
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

    // Mantener la persistencia del estado previo de checks y secuencias de rubros en la sesión actual de la previsualización
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
        const allNewSubRubros = Object.keys(rawMap[rName]).sort();

        allNewSubRubros.forEach(sName => {
            const oldS = oldR ? oldR.subRubros.find(s => s.name === sName) : null;
            const sChecked = oldS ? oldS.checked : true;
            
            subRubrosList.push({
                name: sName,
                checked: sChecked,
                items: rawMap[rName][sName]
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
            sLeft.style.cssText = 'display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 500; color: #475569; font-size: 0.8em; margin: 0;';

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

            sHeader.appendChild(sLeft);
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
    
    // Renderizar las opciones y orden de las columnas dinámicamente
    window.renderConfiguradorColumnas();
    
    // Inicializar y renderizar Capa B: Árbol de Estructura de Mercado
    window.inicializarArbolCategorias();
    window.renderArbolCategorias();
    
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

window.actualizarPrevisualizacionPDF = function() {
    const list = gp_listasFinancieras[gp_activeTabIdx];
    if (!list) return;
    const listaId = list.lista_id;
    
    // Guardar estado actual de columnas
    window.guardarConfiguracionColumnas();
    
    // 1. Obtener Columnas Activas de Capa A
    const cols = pdfColumnsOrder.filter(c => c.checked);
    
    if (cols.length === 0) {
        const descCol = pdfColumnsOrder.find(c => c.id === 'descripcion');
        if (descCol) {
            cols.push(descCol);
        } else {
            cols.push({ id: 'descripcion', label: 'Descripción', align: 'left', baseWidth: 190 });
        }
    }
    
    // 2. Calcular anchos elásticos proporcionales (ancho total de tabla es 100%)
    let totalBase = cols.reduce((sum, c) => sum + c.baseWidth, 0);
    cols.forEach(c => {
        c.percentWidth = ((c.baseWidth / totalBase) * 100).toFixed(2) + '%';
    });
    
    // 3. Renderizar el visor central dinamico agrupado en `#pdf-prev-table-container`
    const prevContainer = document.getElementById('pdf-prev-table-container');
    if (!prevContainer) return;
    prevContainer.innerHTML = '';
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    // Filtrar rubros activos
    const activeRubros = window.pdfRubrosState.filter(r => r.checked);
    
    if (activeRubros.length === 0) {
        prevContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: #94a3b8; font-style: italic;">No hay rubros activos para previsualizar. Seleccione al menos un rubro en la Capa B.</div>`;
        return;
    }

    activeRubros.forEach(rubro => {
        // Filtrar sub-rubros activos para este rubro
        const activeSubRubros = rubro.subRubros.filter(s => s.checked);
        if (activeSubRubros.length === 0) return;

        // Banner del Rubro Principal
        const rubroTitle = document.createElement('div');
        rubroTitle.style.cssText = 'font-size: 1.1em; font-weight: bold; color: #8e4785; margin-top: 15px; border-bottom: 2px solid #8e4785; padding-bottom: 4px; text-transform: uppercase; text-align: left;';
        rubroTitle.innerText = `■ ${rubro.name}`;
        prevContainer.appendChild(rubroTitle);

        activeSubRubros.forEach(sub => {
            if (sub.items.length === 0) return;

            // Sub-divisor de Categoría
            const subTitle = document.createElement('div');
            subTitle.style.cssText = 'font-size: 0.9em; font-weight: bold; font-style: italic; color: #475569; margin-left: 10px; margin-top: 8px; margin-bottom: 6px; text-align: left;';
            subTitle.innerText = `↳ ${sub.name}`;
            prevContainer.appendChild(subTitle);

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
            
            sub.items.forEach((art, index) => {
                // Encontrar configuración del artículo para esta lista con casting robusto
                const mFocused = art.margenes.find(m => Number(m.lista_id) === Number(listaId));
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

            table.appendChild(tbody);
            tableWrapper.appendChild(table);
            prevContainer.appendChild(tableWrapper);
        });
    });
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

    // Cerrar previsualizador para mejorar UX
    cerrarPrevisualizadorPDF();
    
    // Abrir descarga en nueva pestaña transmitiendo los parámetros de capas y ordenamiento
    window.open(`/api/logistica/bunker/exportar-pdf/${list.lista_id}?columns=${colsQuery}&rubros_order=${rubrosQuery}&hidden_subrubros=${subrubrosQuery}`, '_blank');
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
let currentExternalFilter = 'TODOS'; // 'TODOS', 'NUEVOS', 'MODIFICADOS'
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
        resizable: true
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
    
    // Filtro Externo para Pills
    isExternalFilterPresent: () => {
        return true; 
    },
    doesExternalFilterPass: (node) => {
        if (!node.data) return true;
        
        // 1. Intersección por Estado Delta (Pills)
        const estado = node.data._estado_delta || 'INTACTO';
        let passEstado = true;
        if (currentExternalFilter === 'TODOS') {
            passEstado = (estado !== 'BAJA');
        } else if (currentExternalFilter === 'NUEVOS') {
            passEstado = (estado === 'ALTA');
        } else if (currentExternalFilter === 'MODIFICADOS') {
            passEstado = (estado === 'MODIFICADO');
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
    currentExternalFilter = 'TODOS';
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
        if (pill.getAttribute('data-filter') === 'TODOS') {
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
        const mapeoRes = await fetch(`/api/logistica/bunker/reposicion/mapeo/${articulo_id}`);
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

        // Limpiar spinner
        gridDiv.innerHTML = '';
        
        // Destruir instancia anterior si existe
        if (window.v4GridApi) {
            window.v4GridApi.destroy();
            window.v4GridApi = null;
        }

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
        const res = await fetch(`/api/logistica/bunker/reposicion/mapeo/${articulo_id}`, {
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
        const columns = ['sku_proveedor', 'nombre_proveedor', 'descripcion', 'rubro', 'cant_bult', 'cant_valor', 'precio_unitario', 'dias_antiguedad'];
        window.v4GridApi.setColumnsVisible(columns, true);
        window.guardarGridState();
        sincronizarDropdownCampos();
    }
};

function sincronizarDropdownCampos() {
    if (!window.v4GridApi) return;
    const columns = ['sku_proveedor', 'nombre_proveedor', 'descripcion', 'rubro', 'cant_bult', 'cant_valor', 'precio_unitario', 'dias_antiguedad'];
    
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

