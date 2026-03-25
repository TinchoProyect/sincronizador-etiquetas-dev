let articulosBunkerGlobal = [];
let listaSeleccionadaGlobal = 1; // Default a Lista 1

document.addEventListener('DOMContentLoaded', async () => {
    await cargarListasPreciosFiltro();
    await cargarDataGrid();
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

async function cargarDataGrid() {
    const search = document.getElementById('filtro-busqueda').value.trim();
    const tbody = document.getElementById('tbody-bunker');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Cargando Búnker...</td></tr>';
    
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
         tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No se encontraron artículos en el Búnker.</td></tr>';
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
                    propSummary = `<span style="font-size: 0.9em;">${keys[0].toUpperCase()}: ${art.propiedades_dinamicas[keys[0]]}</span>`;
                } else {
                    propSummary = `<span style="font-size: 0.9em;">[ ${keys.length} Propiedades ]</span>`;
                }

                let badgesHtml = '';
                keys.forEach((key, index) => {
                    const val = art.propiedades_dinamicas[key];
                    const colorClass = `color-${index % 6}`;
                    badgesHtml += `<span class="badge ${colorClass}">
                        <span class="badge-cat">${key.toUpperCase()}:</span> ${val}
                    </span>`;
                });

                propSummary = `
                    <div class="badge-tooltip-container">
                        ${propSummary}
                        <div class="tooltip-content">${badgesHtml}</div>
                    </div>
                `;
            }
        }
        
        // Multi-tier Margins a Mini Grid y Precio Dinamico
        let margenPrincipalText = 'N/A';
        let precioFinalDinamicoHtml = `<span style="color:#94a3b8;">N/D</span>`;
        let expandedGridHtml = '';
        
        if (art.margenes && Array.isArray(art.margenes) && art.margenes.length > 0) {
            art.margenes.sort((a,b) => a.lista_id - b.lista_id);
            
            // Buscar el margen de la lista enfocada globalmente
            const mFocused = art.margenes.find(m => m.lista_id === listaSeleccionadaGlobal) || art.margenes[0];
            margenPrincipalText = `${parseFloat(mFocused.margen_porcentaje).toFixed(2)} %`;
            
            const precioS_iva = costo * (1 + (parseFloat(mFocused.margen_porcentaje)/100));
            const precioC_iva = precioS_iva * (1 + (iva/100));
            precioFinalDinamicoHtml = `<span style="font-weight:bold; color: #15803d; font-size: 1.1em;">${formatter.format(precioC_iva)}</span>`;
            
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
            <td style="text-align: right; background-color: #f8fafc;">
                ${precioFinalDinamicoHtml}
            </td>
            <td style="text-align: right; border-left: 1px dashed #cbd5e1;" title="Click en flecha para ver Desglose Financiero">
                ${toggleIcon} ${margenPrincipalText}
            </td>
            <td style="text-align: center;">
                <button class="btn-edit" onclick="editarArticulo('${art.articulo_id}')">✏️ Editar</button>
            </td>
        `;
        tbody.appendChild(trMain);

        if (hasMargins) {
            const trDetails = document.createElement('tr');
            trDetails.id = `details_${rowIndex}`;
            trDetails.className = 'expandable-row';
            trDetails.innerHTML = `
                <td colspan="7" style="padding: 10px 40px; background-color: #f1f5f9;">
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
