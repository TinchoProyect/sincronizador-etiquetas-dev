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
        console.log('🔍 Verificando si ingrediente es mix:', ingredienteId);
        
        // Verificar si tiene composición
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}/composicion`);
        if (!response.ok) {
            if (response.status === 404) {
                console.log('❌ No tiene composición (404)');
                return false;
            }
            throw new Error('Error al verificar composición');
        }
        const data = await response.json();
        
        // Verificar si tiene padre_id
        const ingredienteResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`);
        if (!ingredienteResponse.ok) {
            throw new Error('Error al obtener ingrediente');
        }
        const ingrediente = await ingredienteResponse.json();
        
        // Es mix si tiene composición y no tiene padre_id
        const result = (data.composicion && data.composicion.length > 0) && !ingrediente.padre_id;
        console.log('✅ Resultado esMix:', result);
        return result;
    } catch (error) {
        console.error('❌ Error al verificar si es mix:', error);
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
    console.log('🔧 abrirEdicionMix llamado con mixId:', mixId, typeof mixId);
    
    const modal = document.getElementById('modal-mix');
    console.log('🔍 Buscando modal:', modal ? 'Encontrado' : 'No encontrado');
    if (!modal) {
        console.error('❌ Modal no encontrado en el DOM');
        return;
    }

    try {
        // Cargar ingredientes si no están disponibles
        if (!ingredientesLista || ingredientesLista.length === 0) {
            console.log('📋 Cargando lista de ingredientes...');
            try {
                const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
                if (response.ok) {
                    ingredientesLista = await response.json();
                    console.log('✅ Ingredientes cargados:', ingredientesLista.length);
                } else {
                    console.error('❌ Error al cargar ingredientes:', response.status);
                    throw new Error('No se pudieron cargar los ingredientes');
                }
            } catch (error) {
                console.error('❌ Error cargando ingredientes:', error);
                alert('Error al cargar los ingredientes. Por favor, intente nuevamente.');
                return;
            }
        }
        
        console.log('🎯 Preparando contenedor principal...');
        let filtrosContainer = modal.querySelector('.filtros-categorias');
        if (!filtrosContainer) {
            filtrosContainer = document.createElement('div');
            filtrosContainer.className = 'filtros-categorias';
            const selectContainer = modal.querySelector('#selector-ingrediente-mix').parentElement;
            selectContainer.insertBefore(filtrosContainer, selectContainer.firstChild);
        }
        filtrosContainer.innerHTML = '';

        // Crear contenedor para botones globales (fila superior)
        const botonesGlobales = document.createElement('div');
        botonesGlobales.className = 'botones-globales';
        botonesGlobales.style.cssText = 'margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;';
        
        // Botón "Mostrar Todos"
        const btnTodos = document.createElement('button');
        btnTodos.textContent = 'Mostrar Todos';
        btnTodos.className = 'btn-filtro';
        btnTodos.style.cssText = 'margin: 0 5px 5px 0; padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc; background-color: #fff;';
        botonesGlobales.appendChild(btnTodos);

        // Botón "Ocultar Todos"
        const btnOcultar = document.createElement('button');
        btnOcultar.textContent = 'Ocultar Todos';
        btnOcultar.className = 'btn-filtro';
        btnOcultar.style.cssText = 'margin: 0 5px 5px 0; padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc; background-color: #fff;';
        botonesGlobales.appendChild(btnOcultar);

        // Insertar la fila de botones globales en filtrosContainer
        filtrosContainer.appendChild(botonesGlobales);

        // Contenedor para botones de categoría
        const categoriasBotones = document.createElement('div');
        categoriasBotones.className = 'categorias-botones';
        categoriasBotones.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px;';
        filtrosContainer.appendChild(categoriasBotones);

        // Obtener y ordenar categorías
        const categorias = [...new Set(ingredientesLista.map(ing => ing.categoria))]
            .filter(Boolean)
            .sort();

        // Crear botones de categoría
        const botonesCategorias = categorias.map(cat => {
            const btn = document.createElement('button');
            btn.textContent = cat;
            btn.className = 'btn-filtro activo';
            // Por defecto verde para indicar activo
            btn.style.cssText = 'padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; background-color: #5cb85c;';
            categoriasBotones.appendChild(btn);
            return btn;
        });

        // Estado de filtros activos
        let filtrosActivos = new Set(categorias);

        // Función para actualizar el select según filtros
        const actualizarSelect = async () => {
            const select = modal.querySelector('#selector-ingrediente-mix');
            select.innerHTML = '';

            for (const ing of ingredientesLista) {
                // No incluir el mismo mix en su composición
                if (ing.id === parseInt(mixId)) continue;

                // Excluir ingredientes que sean "Mix"
                const isMixIngred = await esMix(ing.id);
                if (isMixIngred) continue;

                // Agregar si coincide con filtros activos (o si no hay ninguno activo)
                if (filtrosActivos.size > 0 && !filtrosActivos.has(ing.categoria)) {
                    continue;
                }
                const opt = document.createElement('option');
                opt.value = ing.id;
                opt.textContent = `${ing.nombre} - ${ing.categoria}`;
                select.appendChild(opt);
            }

            // No preseleccionar nada
            select.selectedIndex = -1;
        };

        // Evento para "Mostrar Todos"
        btnTodos.onclick = () => {
            filtrosActivos = new Set(categorias);
            botonesCategorias.forEach(btn => {
                btn.classList.add('activo');
                btn.style.backgroundColor = '#5cb85c';
            });
            actualizarSelect();
        };

        // Evento para "Ocultar Todos"
        btnOcultar.onclick = () => {
            filtrosActivos.clear();
            botonesCategorias.forEach(btn => {
                btn.classList.remove('activo');
                btn.style.backgroundColor = '';
            });
            actualizarSelect();
        };

        // Eventos para cada botón de categoría
        botonesCategorias.forEach(btn => {
            btn.onclick = () => {
                if (btn.classList.contains('activo')) {
                    btn.classList.remove('activo');
                    btn.style.backgroundColor = '';
                    filtrosActivos.delete(btn.textContent);
                } else {
                    btn.classList.add('activo');
                    btn.style.backgroundColor = '#5cb85c';
                    filtrosActivos.add(btn.textContent);
                }
                actualizarSelect();
            };
        });

        // Inicializar el select con todos los filtros activos
        await actualizarSelect();

        // Cargar la composición actual
        console.log('🔄 Cargando composición para mix ID:', mixId);
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`);
        if (!response.ok) {
            console.error('❌ Error al cargar composición:', response.status, response.statusText);
            throw new Error('Error al cargar la composición del mix');
        }
        
        const data = await response.json();
        const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
        if (!tbody) return;

        // Limpiar tabla
        tbody.innerHTML = '';

        // Mostrar ingredientes actuales
        let totalKg = 0;
        data.composicion.forEach(item => {
            // Acumular la cantidad
            totalKg += parseFloat(item.cantidad || 0);

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

        // Obtener receta_base_kg actual del mix
        let recetaBaseActual = totalKg; 
        try {
            const mixResp = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}`);
            if (mixResp.ok) {
                const mixData = await mixResp.json();
                // Si ya hay un valor en receta_base_kg, usarlo; en caso contrario, usar la suma
                if (mixData.receta_base_kg !== null && mixData.receta_base_kg !== undefined) {
                    recetaBaseActual = parseFloat(mixData.receta_base_kg);
                }
            }
        } catch(e) {
            console.error('No se pudo obtener receta_base_kg, se usa totalKg');
        }

        // Mostrar campo para la receta base
        let recetaBaseContainer = modal.querySelector('.receta-base-container');
        if (!recetaBaseContainer) {
            recetaBaseContainer = document.createElement('div');
            recetaBaseContainer.className = 'receta-base-container';
            recetaBaseContainer.style.marginTop = '10px';
            // Insertar antes de los botones finales
            const subModalContent = modal.querySelector('.modal-content');
            if (subModalContent) {
                subModalContent.appendChild(recetaBaseContainer);
            }
        }
        recetaBaseContainer.innerHTML = `
            <label for="input-receta-base-kg" style="font-weight: bold;">Receta Base (Kg):</label>
            <input type="number" step="0.001" min="0" id="input-receta-base-kg" style="width: 100px; margin-left: 5px;" />
            <span id="lbl-suma-total" style="margin-left: 15px; color: #666;">
              Suma actual: ${totalKg.toFixed(3)} Kg
            </span>
        `;

        // Asignar valor inicial al input
        const inputRecetaBase = modal.querySelector('#input-receta-base-kg');
        if (inputRecetaBase) {
            inputRecetaBase.value = recetaBaseActual.toFixed(3);
        }

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
                    console.log('➕ Agregando ingrediente al mix:', select.value, cantidad.value);
                    
                    // Agregar ingrediente a la composición
                    const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`, {
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
                    const updateResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${select.value}`, {
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
                    console.log('✏️ Editando cantidad de ingrediente:', ingredienteId, nuevaCantidad);
                    
                    const response = await fetch(
                        `http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${ingredienteId}`,
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
                    console.log('🗑️ Eliminando ingrediente del mix:', ingredienteId);
                    
                    // Eliminar de la composición
                    const response = await fetch(
                        `http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${ingredienteId}`,
                        {
                            method: 'DELETE'
                        }
                    );

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Error al eliminar ingrediente');
                    }

                    // Limpiar padre_id del ingrediente
                    const updateResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`, {
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
        console.log('🎭 Intentando mostrar modal...');
        console.log('🔍 Estado del modal ANTES de mostrar:', {
            display: modal.style.display,
            computedDisplay: getComputedStyle(modal).display,
            visibility: getComputedStyle(modal).visibility,
            opacity: getComputedStyle(modal).opacity,
            zIndex: getComputedStyle(modal).zIndex,
            classList: Array.from(modal.classList),
            offsetWidth: modal.offsetWidth,
            offsetHeight: modal.offsetHeight,
            parentElement: modal.parentElement ? modal.parentElement.tagName : 'null'
        });
        
        modal.style.display = 'block';
        modal.classList.add('show');
        
        // Forzar un reflow
        modal.offsetHeight;
        
        console.log('✅ Modal display establecido a block y clase show agregada');
        console.log('🔍 Estado del modal DESPUÉS de mostrar:', {
            display: modal.style.display,
            computedDisplay: getComputedStyle(modal).display,
            visibility: getComputedStyle(modal).visibility,
            opacity: getComputedStyle(modal).opacity,
            zIndex: getComputedStyle(modal).zIndex,
            classList: Array.from(modal.classList),
            offsetWidth: modal.offsetWidth,
            offsetHeight: modal.offsetHeight,
            isVisible: modal.offsetWidth > 0 && modal.offsetHeight > 0
        });
        
        // Verificar si hay otros elementos que puedan estar ocultando el modal
        console.log('🔍 Verificando elementos padre:', {
            bodyOverflow: getComputedStyle(document.body).overflow,
            htmlOverflow: getComputedStyle(document.documentElement).overflow,
            modalPosition: getComputedStyle(modal).position,
            modalTop: getComputedStyle(modal).top,
            modalLeft: getComputedStyle(modal).left
        });

        // Manejar el botón "Guardar Receta"
        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        if (btnGuardarMix) {
            btnGuardarMix.onclick = async () => {
                try {
                    // Tomar el valor del input de receta base y enviarlo al servidor
                    const valRecetaBase = parseFloat(
                        document.getElementById('input-receta-base-kg').value
                    ) || 0;

                    console.log('💾 Guardando receta base:', valRecetaBase);
                    
                    const putResp = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            receta_base_kg: valRecetaBase
                        })
                    });

                    if (!putResp.ok) {
                        const error = await putResp.json();
                        throw new Error(error.error || 'Error al actualizar receta_base_kg');
                    }

                    // Mensaje de éxito
                    alert('Las cantidades, la composición y la receta base fueron guardadas correctamente.');
                    
                    // Actualizar los informes del carro activo si existe
                    if (window.actualizarResumenIngredientes) {
                        console.log('🔄 Actualizando informes del carro activo...');
                        await window.actualizarResumenIngredientes();
                        console.log('✅ Informes del carro actualizados');
                    }
                    
                    // Cierra modal Mix
                    modal.style.display = 'none';
                    modal.classList.remove('show');
                } catch (error) {
                    alert(error.message);
                }
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
            modal.classList.remove('show');
        };
    }

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
        }
    };
});

// Exponer funciones necesarias globalmente
window.esMix = esMix;
window.abrirEdicionMix = abrirEdicionMix;
window.actualizarEstadoMix = actualizarEstadoMix;
window.actualizarListaIngredientes = actualizarListaIngredientes;
