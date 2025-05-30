/**
 * Funciones para gestionar la composición de ingredientes (mixes)
 */

// Variable compartida para la lista de ingredientes
let ingredientesLista = [];

// Función para actualizar la lista de ingredientes
export function actualizarListaIngredientes(lista) {
    ingredientesLista = lista;
}

// Verifica si un ingrediente es un mix consultando si tiene composición
export async function esMix(ingredienteId) {
    try {
        // Verificar si tiene composición
        const response = await fetch(`/api/produccion/mixes/${ingredienteId}/ingredientes`);
        if (!response.ok) {
            if (response.status === 404) {
                return false;
            }
            throw new Error('Error al verificar composición');
        }
        const data = await response.json();
        
        // Verificar si tiene padre_id
        const ingredienteResponse = await fetch(`/api/produccion/ingredientes/${ingredienteId}`);
        if (!ingredienteResponse.ok) {
            throw new Error('Error al obtener ingrediente');
        }
        const ingrediente = await ingredienteResponse.json();
        
        // Es mix si tiene composición y no tiene padre_id
        return (data.composicion && data.composicion.length > 0) && !ingrediente.padre_id;
    } catch (error) {
        console.error('Error al verificar si es mix:', error);
        return false;
    }
}

// Actualiza el estado visual de "es mix" y el botón de gestión para cada ingrediente
export async function actualizarEstadoMix(ingredienteId) {
    const tr = document.querySelector(`tr[data-id="${ingredienteId}"]`);
    if (!tr) return;

    const esMixStatus = tr.querySelector('.es-mix-status');
    const btnGestionar = tr.querySelector('.btn-gestionar-composicion');
    
    try {
        const tieneMix = await esMix(ingredienteId);
        const ingrediente = ingredientesLista.find(i => i.id === parseInt(ingredienteId));
        
        // Actualizar texto de estado
        if (esMixStatus) {
            esMixStatus.textContent = tieneMix ? 'Sí' : 'No (aún)';
        }
        
        // Mostrar botón si es mix o si puede ser mix (no es hijo de otro)
        if (btnGestionar && ingrediente) {
            btnGestionar.style.display = (!ingrediente.padre_id) ? 'inline-block' : 'none';
        }
    } catch (error) {
        console.error('Error al actualizar estado mix:', error);
        if (esMixStatus) esMixStatus.textContent = 'Error';
    }
}

// Abre el modal de edición de mix
export async function abrirEdicionMix(mixId) {
    const modal = document.getElementById('modal-mix');
    if (!modal) return;

    try {
        // Llenar el selector de ingredientes disponibles
        const select = modal.querySelector('#selector-ingrediente-mix');
        if (select) {
            select.innerHTML = '';
            for (const ing of ingredientesLista) {
                if (ing.id !== parseInt(mixId)) {
                    const isMixIngred = await esMix(ing.id);
                    if (!isMixIngred) {
                        const opt = document.createElement('option');
                        opt.value = ing.id;
                        opt.textContent = `${ing.nombre} - ${ing.categoria}`;
                        select.appendChild(opt);
                    }
                }
            }
        }


        // Cargar la composición actual

        const response = await fetch(`/api/produccion/mixes/${mixId}/ingredientes`);
        if (!response.ok) {
            throw new Error('Error al cargar la composición del mix');
        }
        
        const data = await response.json();
        const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
        if (!tbody) return;


        // Limpiar tabla
        tbody.innerHTML = '';

        // Mostrar ingredientes actuales
        data.composicion.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.nombre_ingrediente}</td>
                <td>${item.cantidad} ${item.unidad_medida || ''}</td>
                <td>
                    <button class="btn-editar-cantidad" 
                            data-id="${item.ingrediente_id}"
                            style="background-color: #0275d8; color: white; border: none; 
                                   padding: 4px 8px; border-radius: 4px; margin-right: 5px;">
                        Editar
                    </button>
                    <button class="btn-eliminar-ingrediente"
                            data-id="${item.ingrediente_id}"
                            style="background-color: #dc3545; color: white; border: none;
                                   padding: 4px 8px; border-radius: 4px;">
                        Eliminar
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Configurar botón de agregar
        const btnAgregar = modal.querySelector('#btn-agregar-a-mix');
        if (btnAgregar) {
            btnAgregar.onclick = async () => {
                const select = document.getElementById('selector-ingrediente-mix');
                const cantidad = document.getElementById('cantidad-ingrediente-mix');
                
                if (!select.value || !cantidad.value) {
                    alert('Seleccione un ingrediente y especifique la cantidad');
                    return;
                }

                try {
                    // Agregar ingrediente a la composición
                    const response = await fetch(`/api/produccion/mixes/${mixId}/ingredientes`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            ingrediente_id: parseInt(select.value),
                            cantidad: parseFloat(cantidad.value)
                        })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Error al agregar ingrediente');
                    }

                    // Actualizar padre_id del ingrediente
                    const updateResponse = await fetch(`/api/produccion/ingredientes/${select.value}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            padre_id: mixId
                        })
                    });

                    if (!updateResponse.ok) {
                        const error = await updateResponse.json();
                        throw new Error(error.error || 'Error al actualizar padre_id');
                    }

                    // Recargar la composición
                    abrirEdicionMix(mixId);
                    
                    // Limpiar campos
                    select.value = '';
                    cantidad.value = '';
                } catch (error) {
                    alert(error.message);
                }
            };
        }

        // Configurar botones de editar y eliminar
        tbody.querySelectorAll('.btn-editar-cantidad').forEach(btn => {
            btn.onclick = async () => {
                const ingredienteId = btn.dataset.id;
                const nuevaCantidad = prompt('Ingrese la nueva cantidad:');
                if (!nuevaCantidad) return;

                try {
                    const response = await fetch(
                        `/api/produccion/mixes/${mixId}/ingredientes/${ingredienteId}`,
                        {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                cantidad: parseFloat(nuevaCantidad)
                            })
                        }
                    );

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Error al actualizar cantidad');
                    }

                    // Recargar la composición
                    abrirEdicionMix(mixId);
                } catch (error) {
                    alert(error.message);
                }
            };
        });

        tbody.querySelectorAll('.btn-eliminar-ingrediente').forEach(btn => {
            btn.onclick = async () => {
                if (!confirm('¿Está seguro de eliminar este ingrediente del mix?')) return;

                const ingredienteId = btn.dataset.id;
                try {
                    // Eliminar de la composición
                    const response = await fetch(
                        `/api/produccion/mixes/${mixId}/ingredientes/${ingredienteId}`,
                        {
                            method: 'DELETE'
                        }
                    );

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Error al eliminar ingrediente');
                    }

                    // Limpiar padre_id del ingrediente
                    const updateResponse = await fetch(`/api/produccion/ingredientes/${ingredienteId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            padre_id: null
                        })
                    });

                    if (!updateResponse.ok) {
                        const error = await updateResponse.json();
                        throw new Error(error.error || 'Error al actualizar padre_id');
                    }

                    // Recargar la composición
                    abrirEdicionMix(mixId);
                } catch (error) {
                    alert(error.message);
                }
            };
        });

        // Mostrar modal
        modal.style.display = 'block';

        // Manejar el nuevo botón "Guardar Receta"
        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        if (btnGuardarMix) {
            btnGuardarMix.onclick = () => {
                alert('Las cantidades y los ingredientes agregados han sido guardados correctamente.');
                // Cierra modal Mix (opcional)
                modal.style.display = 'none';
            };
        }

    } catch (error) {
        console.error('Error al abrir edición de mix:', error);
        alert(error.message);
    }

}

// Cerrar modal al hacer clic en la X o fuera del modal
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modal-mix');
    if (!modal) return;

    const closeBtn = modal.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
});

// Exponer funciones necesarias globalmente
window.esMix = esMix;
window.abrirEdicionMix = abrirEdicionMix;
window.actualizarEstadoMix = actualizarEstadoMix;
window.actualizarListaIngredientes = actualizarListaIngredientes;
