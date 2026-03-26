let jerarquiaGlobal = {};
let principalSeleccionado = '';

document.addEventListener('DOMContentLoaded', () => {
    cargarPrincipales();
});

async function cargarPrincipales() {
    try {
        const res = await fetch('/api/logistica/bunker-diccionario/principales');
        const json = await res.json();
        if(json.success && json.data) {
            const select = document.getElementById('filtro-principal');
            select.innerHTML = '<option value="" disabled selected>📦 Seleccione Artículo Principal...</option>';
            json.data.forEach(termino => {
                const opt = document.createElement('option');
                opt.value = termino;
                opt.text = termino;
                select.appendChild(opt);
            });
        }
    } catch(err) {
        Swal.fire('Error', 'Fallo al cargar la lista principal', 'error');
    }
}

window.cargarJerarquia = async function() {
    const select = document.getElementById('filtro-principal');
    const termino = select.value;
    if(!termino) return;
    
    principalSeleccionado = termino;
    const container = document.getElementById('diccionario-acordeon-container');
    container.innerHTML = '<div style="text-align: center; padding: 20px;">Cargando jerarquía...</div>';
    
    try {
        const res = await fetch(`/api/logistica/bunker-diccionario/jerarquia/${encodeURIComponent(termino)}`);
        const json = await res.json();
        
        if (json.success) {
            jerarquiaGlobal = json.data;
            renderizarAcordeon();
        } else {
            container.innerHTML = `<div style="color:red; text-align:center;">${json.error}</div>`;
        }
    } catch(e) {
        container.innerHTML = `<div style="color:red; text-align:center;">Fallo de conexión al cargar el árbol</div>`;
    }
};

function renderizarAcordeon() {
    const container = document.getElementById('diccionario-acordeon-container');
    container.innerHTML = '';
    
    const categorias = Object.keys(jerarquiaGlobal).sort();
    
    if (categorias.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; border: 2px dashed #cbd5e1; border-radius: 8px; color: #64748b;">
                <strong>${principalSeleccionado}</strong> no tiene propiedades dinámicas registradas aún en el sistema.
            </div>
        `;
        return;
    }
    
    categorias.forEach(cat => {
        let catCleaned = cat.replaceAll('_', ' ');
        const label = catCleaned.charAt(0).toUpperCase() + catCleaned.slice(1);
        
        const terms = jerarquiaGlobal[cat];
        
        // Render Acordeón Item
        const card = document.createElement('div');
        card.style.border = '1px solid #cbd5e1';
        card.style.borderRadius = '6px';
        card.style.overflow = 'hidden';
        card.style.background = '#fff';
        
        const header = document.createElement('div');
        header.style.background = '#334155';
        header.style.color = '#fff';
        header.style.padding = '12px 20px';
        header.style.fontWeight = 'bold';
        header.style.fontSize = '1.1em';
        header.innerHTML = `📂 Familia: <span style="color:#fbbf24;">${label}</span> <span style="float:right; font-size: 0.8em; background:#475569; padding: 3px 8px; border-radius:12px;">${terms.length} Términos</span>`;
        
        const body = document.createElement('div');
        body.style.padding = '0';
        
        let tableHtml = `
            <table class="grid-dict" style="margin:0; border:none; box-shadow:none; width: 100%;">
                <thead style="display:none;"><tr><th>Término</th><th>Abrev</th><th>Acciones</th></tr></thead>
                <tbody>
        `;
        
        // Sort terms alphabetically
        terms.sort((a,b) => a.termino.localeCompare(b.termino)).forEach(item => {
            tableHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="width: 50%; padding: 10px 20px;"><strong>${item.termino}</strong></td>
                    <td style="width: 20%; padding: 10px 20px; font-family: monospace; font-size: 1.1em; color: #b91c1c; font-weight: bold;">[${item.abreviatura}]</td>
                    <td style="width: 30%; padding: 10px 20px; text-align: right; display: flex; gap: 5px; justify-content: flex-end;">
                        <button class="btn-action btn-edit" title="Editar Valores" onclick="editarTerminoInfo(${item.id}, '${item.termino}', '${item.abreviatura}', '${item.categoria}')">✏️ Editar</button>
                        <button class="btn-action btn-delete" title="Borrar del Sistema" onclick="eliminarTermino(${item.id})">🗑️ Borrar</button>
                    </td>
                </tr>
            `;
        });
        
        tableHtml += `</tbody></table>`;
        body.innerHTML = tableHtml;
        
        card.appendChild(header);
        card.appendChild(body);
        container.appendChild(card);
    });
}

window.editarTerminoInfo = async function(id, term, abrev, cat) {
    const { value: formValues } = await Swal.fire({
        title: 'Editar Término',
        html:
            `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Término Original</label>
                <input id="swal-term" class="swal2-input" style="margin:0;" value="${term}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión</label>
                <input id="swal-abrev" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${abrev}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Familia (Inmutable desde aquí)</label>
                <input id="swal-cat" class="swal2-input" style="margin:0; text-transform:lowercase; background:#f1f5f9; cursor:not-allowed;" value="${cat}" disabled>
            </div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar Cambios',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                termino: document.getElementById('swal-term').value.trim(),
                abreviatura: document.getElementById('swal-abrev').value.trim().toUpperCase(),
                categoria: document.getElementById('swal-cat').value.trim().toLowerCase()
            };
        }
    });

    if (formValues) {
        if(!formValues.termino || !formValues.abreviatura) {
            Swal.fire('Atención', 'El término y la abreviatura son obligatorios.', 'warning');
            return;
        }
        
        try {
            Swal.fire({title: 'Guardando...', didOpen: () => Swal.showLoading()});
            const res = await fetch(`/api/logistica/bunker-diccionario/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if(json.success) {
                Swal.fire({ title:'Guardado', icon: 'success', timer: 1000, showConfirmButton: false});
                cargarJerarquia();
            } else {
                Swal.fire('Error', json.error || 'Fallo interno al actualizar.', 'error');
            }
        } catch(e) {
            Swal.fire('Error', 'Fallo de red al comunicarse con el servidor', 'error');
        }
    }
};

window.eliminarTermino = async function(id) {
    Swal.fire({
        title: 'Borrar Permanentemente',
        text: '¿Está seguro que desea eliminar este término? Desaparecerá de las sugerencias inteligentes de Nomenclatura del Búnker, pero no afectará a los artículos que ya lo usaron históricamente.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, Pulverizar',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if(result.isConfirmed) {
            try {
                Swal.fire({title: 'Procesando...', didOpen: () => Swal.showLoading()});
                const res = await fetch(`/api/logistica/bunker-diccionario/${id}`, { method: 'DELETE' });
                const json = await res.json();
                if(json.success) {
                    Swal.fire({title:'Eliminado', icon: 'success', timer: 1000, showConfirmButton: false});
                    cargarJerarquia();
                } else {
                    Swal.fire('Error', json.error || 'No se pudo purgar la entrada', 'error');
                }
            } catch(e) {
                Swal.fire('Error', 'Fallo de conectividad al servidor', 'error');
            }
        }
    });
};
