let diccionarioGlobal = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarDiccionario();
});

async function cargarDiccionario() {
    try {
        const res = await fetch('/api/logistica/bunker-diccionario');
        const json = await res.json();
        if(json.success) {
            diccionarioGlobal = json.data;
            renderizarGrilla(diccionarioGlobal);
        } else {
            Swal.fire('Error', 'Fallo al cargar el diccionario', 'error');
        }
    } catch(err) {
        Swal.fire('Error', 'No se pudo contactar al servidor', 'error');
    }
}

function renderizarGrilla(data) {
    const tbody = document.getElementById('tbody-diccionario');
    tbody.innerHTML = '';
    
    if(data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">El diccionario está vacío o no se encontraron coincidencias.</td></tr>';
        return;
    }
    
    // Sort array in memory just in case (though DB gives it ordered)
    data.sort((a,b) => {
        let catA = a.categoria || 'zzzz';
        let catB = b.categoria || 'zzzz';
        if (catA === catB) {
            return (a.termino || '').localeCompare(b.termino || '');
        }
        return catA.localeCompare(catB);
    });

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500; color: #475569; text-transform: uppercase; font-size: 0.9em;">${item.categoria || 'GENERAL'}</td>
            <td><strong>${item.termino}</strong></td>
            <td style="font-family: monospace; font-size: 1.1em; color: #b91c1c; font-weight: bold;">${item.abreviatura}</td>
            <td style="text-align: center; display: flex; gap: 5px; justify-content: center;">
                <button class="btn-action btn-edit" title="Editar Valores" onclick="editarTermino(${item.id})">✏️ Editar</button>
                <button class="btn-action btn-delete" title="Borrar del Sistema" onclick="eliminarTermino(${item.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filtrarGrilla() {
    const texto = document.getElementById('buscador-local').value.toLowerCase();
    const filtrados = diccionarioGlobal.filter(d => 
        (d.termino && d.termino.toLowerCase().includes(texto)) || 
        (d.abreviatura && d.abreviatura.toLowerCase().includes(texto)) ||
        (d.categoria && d.categoria.toLowerCase().includes(texto))
    );
    renderizarGrilla(filtrados);
}

window.editarTermino = async function(id) {
    const item = diccionarioGlobal.find(d => d.id === id);
    if(!item) return;
    
    const { value: formValues } = await Swal.fire({
        title: 'Editar Término',
        html:
            `<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Término Original</label>
                <input id="swal-term" class="swal2-input" style="margin:0;" value="${item.termino}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Abreviatura de Impresión</label>
                <input id="swal-abrev" class="swal2-input" style="margin:0; text-transform:uppercase;" value="${item.abreviatura}">
                <label style="font-weight:bold; font-size:0.9em; color:#475569;">Categoría / Familia (Mínusculas)</label>
                <input id="swal-cat" class="swal2-input" style="margin:0; text-transform:lowercase;" value="${item.categoria || ''}">
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
            Swal.fire('Atención', 'El término y la abreviatura son totalmente obligatorios para la nomenclatura.', 'warning');
            return;
        }
        
        try {
            Swal.fire({title: 'Guardando Sistema...', didOpen: () => Swal.showLoading()});
            const res = await fetch(`/api/logistica/bunker-diccionario/${id}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(formValues)
            });
            const json = await res.json();
            if(json.success) {
                Swal.fire({ title:'Guardado', text: 'El término ha sido actualizado con éxito.', icon: 'success', timer: 1500, showConfirmButton: false});
                cargarDiccionario();
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
        text: '¿Está seguro que desea eliminar este término? Desaparecerá de las sugerencias inteligentes de Nomenclatura del Búnker, pero no afectará a los artículos que ya lo usaron.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, Pulverizar',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if(result.isConfirmed) {
            try {
                Swal.fire({title: 'Procesando Baja...', didOpen: () => Swal.showLoading()});
                const res = await fetch(`/api/logistica/bunker-diccionario/${id}`, { method: 'DELETE' });
                const json = await res.json();
                if(json.success) {
                    Swal.fire({title:'Eliminado', text: 'El registro ha sido borrado.', icon: 'success', timer: 1500, showConfirmButton: false});
                    cargarDiccionario();
                } else {
                    Swal.fire('Error', json.error || 'No se pudo purgar la entrada', 'error');
                }
            } catch(e) {
                Swal.fire('Error', 'Fallo de conectividad al servidor', 'error');
            }
        }
    });
};
