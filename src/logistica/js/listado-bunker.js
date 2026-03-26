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
    { id: 9, name: 'Margen Base', defaultVisible: true }
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
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;">Cargando Búnker...</td></tr>';
    
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
        tbody.innerHTML = `<tr><td colspan="7" style="color: red; text-align: center;">Error de conexión: ${e.message}</td></tr>`;
    }
}

function renderizarGrid(articulos) {
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '';
    
    if (articulos.length === 0) {
         tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;">No se encontraron artículos en el Búnker.</td></tr>';
         return;
    }
    
    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

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
        
        if (art.margenes && Array.isArray(art.margenes) && art.margenes.length > 0) {
            art.margenes.sort((a,b) => a.lista_id - b.lista_id);
            
            // Buscar el margen de la lista enfocada globalmente
            const mFocused = art.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) || art.margenes[0];
            const pctMargen = parseFloat(mFocused.margen_porcentaje);
            margenPrincipalText = `${pctMargen.toFixed(2)} %`;
            
            const precioS_iva = costo * (1 + (pctMargen/100));
            const precioC_iva = precioS_iva * (1 + (iva/100));
            
            // Cálculos financieros derivados
            const montoIibb = (precioC_iva * 4) / 100; // Impuestos Brutos 4%
            const gananciaNeta = (precioS_iva - costo) - montoIibb;

            precioFinalDinamicoHtml = `<span style="font-weight:bold; color: #15803d; font-size: 1.1em;">${formatter.format(precioC_iva)}</span>`;
            
            costoSivaStr = formatter.format(precioS_iva);
            iibbStr = formatter.format(montoIibb);
            gananciaNetaStr = formatter.format(gananciaNeta);
            
            expandedGridHtml = `
                <table class="mini-grid">
                    <thead>
                        <tr>
                            <th>Lista ID</th>
                            <th>Margen (%)</th>
                            <th>Precio s/IVA</th>
                            <th>Precio c/IVA (Final)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            art.margenes.forEach(m => {
                const mPct = parseFloat(m.margen_porcentaje);
                const pS_iva = costo * (1 + (mPct/100));
                const pC_iva = pS_iva * (1 + (iva/100));
                
                // Highlight si es la lista seleccionada
                const isSelected = m.lista_id === listaSeleccionadaGlobal;
                const rowStyle = isSelected ? 'background-color: #fef08a;' : '';
                const fwStyle = isSelected ? 'font-weight:bold;' : '';

                expandedGridHtml += `
                    <tr style="${rowStyle}">
                        <td style="text-align:center; ${fwStyle}">Lista ${m.lista_id}</td>
                        <td style="${fwStyle}">${mPct.toFixed(2)} %</td>
                        <td style="${fwStyle}">${formatter.format(pS_iva)}</td>
                        <td style="font-weight:bold; color: #15803d;">${formatter.format(pC_iva)}</td>
                    </tr>
                `;
            });
            expandedGridHtml += `</tbody></table>`;
        }

        const hasMargins = expandedGridHtml !== '';
        const toggleIcon = hasMargins ? `<span class="toggle-icon" onclick="toggleRow('details_${rowIndex}', this)">▶</span>` : '';

        const trMain = document.createElement('tr');
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
            <td style="text-align: center;">
                <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
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
                <td colspan="11" style="padding: 10px 40px; background-color: #f1f5f9;">
                    <div style="margin-bottom: 5px; font-weight: 600; color: #334155; font-size: 0.9em;">👇 Desglose Financiero (Costo Base: ${formatter.format(costo)} | IVA Aplicado: ${iva}%)</div>
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
    window.location.href = `bunker.html?edit=${id}`;
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
