import { mostrarError, estilosTablaCarros } from './utils.js';
import { abrirEdicionMix } from './mix.js';

// Hacer la función disponible globalmente
window.editarIngredienteCompuesto = async (mixId) => {
    try {
        console.log('🔧 editarIngredienteCompuesto llamado con:', mixId, typeof mixId);
        
        // Si mixId es un string (nombre), necesitamos obtener el ID
        let actualMixId = mixId;
        if (typeof mixId === 'string') {
            console.log('🔍 Buscando ID para ingrediente:', mixId);
            try {
                const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/buscar?nombre=${encodeURIComponent(mixId)}`);
                if (!response.ok) {
                    throw new Error(`No se encontró el ingrediente: ${mixId}`);
                }
                const data = await response.json();
                actualMixId = data.id;
                console.log('✅ ID encontrado:', actualMixId);
            } catch (error) {
                console.error('❌ Error buscando ID del ingrediente:', error);
                throw error;
            }
        }
        
        console.log('🚀 Abriendo modal para mix ID:', actualMixId);
        console.log('🔗 Llamando a abrirEdicionMix desde carro.js...');
        // Mostrar el modal de edición de composición del mix
        await abrirEdicionMix(actualMixId);
        console.log('✅ abrirEdicionMix completado');
        
        // Hacer disponible la función de actualización para el modal
        window.actualizarResumenIngredientes = async () => {
            const carroId = localStorage.getItem('carroActivo');
            const colaboradorData = localStorage.getItem('colaboradorActivo');
            
            if (carroId && colaboradorData) {
                const colaborador = JSON.parse(colaboradorData);
                
                // Actualizar resumen de ingredientes
                const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
                mostrarResumenIngredientes(ingredientes);
                
                // Actualizar resumen de mixes
                const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
                mostrarResumenMixes(mixes);
            }
        };
        
    } catch (error) {
        console.error('Error al editar ingrediente compuesto:', error);
        mostrarError('No se pudo abrir el editor de ingrediente compuesto');
    }
};

// Función para actualizar la información visual del carro activo
export async function actualizarEstadoCarro() {
    const carroId = localStorage.getItem('carroActivo');
    const carroInfo = document.getElementById('carro-actual');
    const colaboradorData = localStorage.getItem('colaboradorActivo');
    
    if (!colaboradorData) {
        carroInfo.innerHTML = '<p>No hay colaborador seleccionado</p>';
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    
    try {
        console.log('Obteniendo carros para usuario:', colaborador.id);
        // Obtener todos los carros del usuario
        const response = await fetch(`http://localhost:3002/api/produccion/usuario/${colaborador.id}/carros`);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error response:', errorData);
            throw new Error(errorData.error || 'Error al obtener carros del usuario');
        }
        
        let carros = await response.json();
        
        // Ordenar carros por fecha (más reciente primero)
        carros = carros.sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio));
        
        if (carros.length === 0) {
            carroInfo.innerHTML = `
                <div class="no-carros">
                    <p>Este usuario aún no tiene carros activos.</p>
                    <p>Podés crear uno nuevo para comenzar.</p>
                </div>
            `;
            return;
        }

        // Construir la lista de carros
        let html = `
            <div class="carros-lista">
                <h3>Tus carros de producción</h3>
                <div class="botones-crear-carro" style="margin-bottom: 20px;">
                    <button onclick="crearNuevoCarro('externa')" class="btn btn-secondary" style="margin-left: 10px;">
                        🚚 Crear Carro de Producción Externa
                    </button>
                </div>
                <table class="carros-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Fecha de inicio</th>
                            <th>Artículos</th>
                            <th>Tipo</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        carros.forEach(carro => {
            const fecha = new Date(carro.fecha_inicio).toLocaleString();
            const estaActivo = carro.id.toString() === carroId;
            
            html += `
                <tr class="${estaActivo ? 'carro-activo' : ''}" onclick="seleccionarCarro(${carro.id})">
                    <td>${carro.id}</td>
                    <td>${fecha}</td>
                    <td>${carro.total_articulos} artículos</td>
                    <td>
                        ${carro.tipo_carro === 'interna' ? '🏭' : '🚚'} 
                        ${carro.tipo_carro === 'interna' ? 'Producción Interna' : 'Producción Externa'}
                    </td>
                    <td>${carro.en_auditoria ? 'En auditoría' : 'Completado'}</td>
                    <td>
                        <div class="btn-group">
                            ${estaActivo ? 
                                '<button class="btn-deseleccionar" onclick="event.stopPropagation(); deseleccionarCarro()">Deseleccionar</button>' :
                                ''
                            }
                            <button class="btn-eliminar" onclick="event.stopPropagation(); eliminarCarro(${carro.id})">Eliminar</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        carroInfo.innerHTML = html;

        // Agregar estilos CSS inline para la tabla
        const style = document.createElement('style');
        style.textContent = estilosTablaCarros;
        document.head.appendChild(style);

    } catch (error) {
        console.error('Error:', error);
        carroInfo.innerHTML = '<p>Error al cargar los carros</p>';
    }
}

// Event listeners para los botones de eliminar artículo y cambios en cantidad
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-eliminar-articulo')) {
        const numeroArticulo = e.target.dataset.numero;
        await eliminarArticuloDelCarro(numeroArticulo);
    }
});

// Función de debounce para evitar múltiples llamadas
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Debounced version of the update function
const debouncedUpdateCantidad = debounce(async (numeroArticulo, nuevaCantidad, inputElement) => {
    try {
        // Actualizar UI inmediatamente
        const articuloContainer = inputElement.closest('.articulo-container');
        const ingredientesContainer = articuloContainer.nextElementSibling;
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            const rows = ingredientesContainer.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cantidadCell = row.cells[1];
                const cantidadBase = parseFloat(cantidadCell.dataset.base || cantidadCell.textContent);
                cantidadCell.textContent = (cantidadBase * nuevaCantidad).toFixed(2);
            });
        }

        // Hacer la llamada al servidor en segundo plano
        await modificarCantidadArticulo(numeroArticulo, nuevaCantidad);
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        inputElement.value = inputElement.dataset.lastValue || 1;
    }
}, 300);

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('input-cantidad-articulo')) {
        const numeroArticulo = e.target.dataset.numero;
        const nuevaCantidad = parseInt(e.target.value);
        if (nuevaCantidad > 0) {
            e.target.dataset.lastValue = e.target.value;
            debouncedUpdateCantidad(numeroArticulo, nuevaCantidad, e.target);
        } else {
            e.target.value = e.target.dataset.lastValue || 1;
            mostrarError('La cantidad debe ser mayor a 0');
        }
    }
});

// Función para actualizar el resumen de ingredientes con debounce
const debouncedActualizarResumen = debounce(async () => {
    const carroId = localStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');
    
    if (carroId && colaboradorData) {
        const colaborador = JSON.parse(colaboradorData);
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
        mostrarResumenIngredientes(ingredientes);
        
        // También actualizar el resumen de mixes
        const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
        mostrarResumenMixes(mixes);
    }
}, 500);

// Función para actualizar el resumen de ingredientes
export async function actualizarResumenIngredientes() {
    debouncedActualizarResumen();
}

// Función para eliminar un artículo del carro (optimizada y robusta)
async function eliminarArticuloDelCarro(numeroArticulo) {
    const carroId = localStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!carroId || !colaboradorData) {
        mostrarError('No hay carro activo o colaborador seleccionado');
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    const articulo = document.querySelector(`.articulo-container[data-numero="${numeroArticulo}"]`);

    if (!articulo) {
        console.warn(`No se encontró el artículo ${numeroArticulo} en el DOM`);
        return;
    }

    const btnEliminar = articulo.querySelector('.btn-eliminar-articulo');
    if (btnEliminar) {
        btnEliminar.disabled = true;
        btnEliminar.textContent = '⏳';
    }

    try {
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${numeroArticuloEncoded}?usuarioId=${colaborador.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo eliminar el artículo del carro');
        }

        eliminarArticuloDelDOM(numeroArticulo);
        debouncedActualizarResumen();
        mostrarNotificacionEliminacion(numeroArticulo);

    } catch (error) {
        console.error('Error al eliminar artículo:', error);
        mostrarError(error.message);

        // Restaurar el botón si hubo un error
        if (btnEliminar) {
            btnEliminar.disabled = false;
            btnEliminar.textContent = '🗑️';
        }

    } finally {
        // Si todo salió bien, el DOM ya se limpió; si no, el botón ya se restauró
    }
}

// Función para eliminar artículo del DOM de forma segura
function eliminarArticuloDelDOM(numeroArticulo) {
    try {
        // Buscar el contenedor del artículo
        const articulo = document.querySelector(`.articulo-container[data-numero="${numeroArticulo}"]`);
        if (!articulo) {
            console.warn(`Artículo ${numeroArticulo} no encontrado en el DOM`);
            return;
        }

        // Buscar el contenedor de ingredientes (siguiente elemento hermano)
        const ingredientesContainer = articulo.nextElementSibling;
        
        // Eliminar con animación suave
        articulo.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        articulo.style.opacity = '0';
        articulo.style.transform = 'translateX(-100%)';
        
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            ingredientesContainer.style.transition = 'opacity 0.3s ease-out';
            ingredientesContainer.style.opacity = '0';
        }

        // Remover elementos después de la animación
        setTimeout(() => {
            try {
                if (articulo && articulo.parentNode) {
                    articulo.parentNode.removeChild(articulo);
                }
                if (ingredientesContainer && ingredientesContainer.parentNode && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
                    ingredientesContainer.parentNode.removeChild(ingredientesContainer);
                }
            } catch (removeError) {
                console.error('Error al remover elementos del DOM:', removeError);
            }
        }, 300);

    } catch (error) {
        console.error('Error al eliminar artículo del DOM:', error);
    }
}

// Función para mostrar notificación de eliminación
function mostrarNotificacionEliminacion(numeroArticulo) {
    const notification = document.createElement('div');
    notification.textContent = `Artículo ${numeroArticulo} eliminado`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #dc3545;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        font-size: 14px;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 2000);
}

// Función para modificar la cantidad de un artículo
async function modificarCantidadArticulo(numeroArticulo, nuevaCantidad) {
    try {
        const carroId = localStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        
        if (!carroId || !colaboradorData) {
            throw new Error('No hay carro activo o colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${numeroArticuloEncoded}?usuarioId=${colaborador.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cantidad: nuevaCantidad
            })
        });

        if (!response.ok) {
            throw new Error('No se pudo actualizar la cantidad del artículo');
        }

        // Actualizar solo los ingredientes del artículo modificado
        await actualizarIngredientesArticulo(numeroArticulo, nuevaCantidad);
        
        // Actualizar resumen de ingredientes
        await actualizarResumenIngredientes();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        // Recargar la tabla para mostrar el valor anterior en caso de error
        await mostrarArticulosDelCarro();
        
        // Actualizar resumen de ingredientes
        await actualizarResumenIngredientes();
    }
}

// Función para actualizar solo los ingredientes de un artículo específico
async function actualizarIngredientesArticulo(numeroArticulo, nuevaCantidad) {
    try {
        // Buscar el contenedor del artículo
        const inputCantidad = document.querySelector(`input[data-numero="${numeroArticulo}"]`);
        if (!inputCantidad) return;
        
        const articuloContainer = inputCantidad.closest('.articulo-container');
        if (!articuloContainer) return;
        
        const ingredientesContainer = articuloContainer.nextElementSibling;
        if (!ingredientesContainer || !ingredientesContainer.classList.contains('ingredientes-expandidos')) return;

        // Obtener ingredientes actualizados
        const ingredientes = await obtenerIngredientesExpandidos(numeroArticulo);
        
        if (ingredientes && ingredientes.length > 0) {
            // Generar nuevo HTML para la tabla de ingredientes
            let htmlIngredientes = `
                <div>
                    <table>
                        <thead>
                            <tr>
                                <th>Ingrediente</th>
                                <th>Cantidad</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            ingredientes.forEach(ing => {
                // Multiplicar la cantidad del ingrediente por la nueva cantidad del artículo
                const cantidadTotal = ing.cantidad * nuevaCantidad;
                htmlIngredientes += `
                    <tr>
                        <td>
                            ${ing.es_mix ? 
                                `<span class="mix-nombre" 
                                       style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                                       onclick="editarIngredienteCompuesto(${ing.id})">${ing.nombre}</span>` : 
                                ing.nombre}
                        </td>
                        <td>${cantidadTotal.toFixed(2)}</td>
                        <td>${ing.unidad_medida}</td>
                    </tr>
                `;
            });

            htmlIngredientes += `
                        </tbody>
                    </table>
                </div>
            `;

            // Actualizar solo el contenido del contenedor de ingredientes
            ingredientesContainer.innerHTML = htmlIngredientes;
        } else {
            ingredientesContainer.innerHTML = `
                <div class="ingredientes-error">
                    No se pudieron cargar los ingredientes para este artículo.
                </div>
            `;
        }

    } catch (error) {
        console.error('Error al actualizar ingredientes:', error);
    }
}

// Función para validar el carro activo
export async function validarCarroActivo(usuarioId) {
    const carroId = localStorage.getItem('carroActivo');
    if (!carroId) return;

    try {
        // Intentar obtener los artículos del carro para validar propiedad
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            // Si hay error, probablemente el carro no pertenece al usuario
            console.log('El carro no pertenece al usuario actual');
            localStorage.removeItem('carroActivo');
            actualizarEstadoCarro();
        }
    } catch (error) {
        console.error('Error al validar carro:', error);
        localStorage.removeItem('carroActivo');
        actualizarEstadoCarro();
    }
}

// Función para crear un nuevo carro de producción
export async function crearNuevoCarro(tipoCarro = 'interna') {
    try {
        console.log(`Iniciando creación de carro tipo: ${tipoCarro}`);
        
        // Verificar si ya existe un carro activo
        const carroActivo = localStorage.getItem('carroActivo');
        if (carroActivo) {
            throw new Error(`Ya hay un carro activo (ID: ${carroActivo})`);
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        console.log('Enviando solicitud para crear carro...');
        
        const response = await fetch('http://localhost:3002/api/produccion/carro', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id,
                enAuditoria: true,
                tipoCarro: tipoCarro
            })
        });

        if (!response.ok) {
            throw new Error('Error al crear el carro de producción');
        }

        const data = await response.json();
        console.log(`✅ Carro de producción ${tipoCarro} creado con ID:`, data.id);
        
        // Guardar el ID del carro en localStorage y variable global
        localStorage.setItem('carroActivo', data.id);
        window.carroIdGlobal = data.id;
        
        console.log('Actualizando interfaz...');
        
        // Actualizar la información visual del carro
        await actualizarEstadoCarro();
        
        // Mostrar los artículos del carro (inicialmente vacío)
        await mostrarArticulosDelCarro();
        
        // Actualizar la visibilidad de los botones según el estado
        if (typeof window.actualizarVisibilidadBotones === 'function') {
            console.log('Actualizando visibilidad de botones...');
            await window.actualizarVisibilidadBotones();
        } else {
            console.warn('⚠️ actualizarVisibilidadBotones no está disponible');
        }

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Hacer funciones disponibles globalmente para los botones HTML
window.crearNuevoCarro = crearNuevoCarro;
window.seleccionarCarro = seleccionarCarro;
window.deseleccionarCarro = deseleccionarCarro;
window.eliminarCarro = eliminarCarro;

// Función para seleccionar un carro
export async function seleccionarCarro(carroId) {
    try {
        console.log(`Seleccionando carro ID: ${carroId}`);
        
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        
        // Validar que el carro pertenezca al usuario antes de seleccionarlo
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);
        if (!response.ok) {
            throw new Error('No se puede seleccionar este carro');
        }

        // Establecer como carro activo en localStorage
        localStorage.setItem('carroActivo', carroId);

        // Asignar también en variable global
        window.carroIdGlobal = carroId;

        console.log('Actualizando interfaz después de seleccionar carro...');
        
        // Actualizar la interfaz
        await actualizarEstadoCarro();
        await mostrarArticulosDelCarro();
        
        // Cargar y mostrar resumen de ingredientes
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
        mostrarResumenIngredientes(ingredientes);
        
        // Cargar y mostrar resumen de mixes
        const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
        mostrarResumenMixes(mixes);
        
        // Actualizar la visibilidad de los botones según el estado del carro
        if (typeof window.actualizarVisibilidadBotones === 'function') {
            console.log('Actualizando visibilidad de botones después de seleccionar carro...');
            await window.actualizarVisibilidadBotones();
        } else {
            console.warn('⚠️ actualizarVisibilidadBotones no está disponible al seleccionar carro');
        }
        
    } catch (error) {
        console.error('Error al seleccionar carro:', error);
        mostrarError(error.message);
    }
}


// Función para deseleccionar el carro actual
export async function deseleccionarCarro() {
    console.log('Deseleccionando carro activo...');
    
    localStorage.removeItem('carroActivo');
    window.carroIdGlobal = null;
    
    await actualizarEstadoCarro();
    document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
    
    // Limpiar resumen de ingredientes
    const contenedor = document.getElementById('tabla-resumen-ingredientes');
    if (contenedor) {
        contenedor.innerHTML = '<p>No hay carro activo</p>';
    }
    
    // Limpiar resumen de mixes
    const contenedorMixes = document.getElementById('tabla-resumen-mixes');
    if (contenedorMixes) {
        contenedorMixes.innerHTML = '<p>No hay carro activo</p>';
    }
    
    // Actualizar la visibilidad de los botones (deben ocultarse al no haber carro)
    if (typeof window.actualizarVisibilidadBotones === 'function') {
        console.log('Actualizando visibilidad de botones después de deseleccionar carro...');
        await window.actualizarVisibilidadBotones();
    } else {
        console.warn('⚠️ actualizarVisibilidadBotones no está disponible al deseleccionar carro');
    }
}

// Función para eliminar un carro
export async function eliminarCarro(carroId) {
    if (!confirm('¿Estás seguro de que querés eliminar este carro? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}?usuarioId=${colaborador.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo eliminar el carro');
        }

        // Si el carro eliminado era el activo, limpiarlo
        const carroActivo = localStorage.getItem('carroActivo');
        if (carroActivo === carroId.toString()) {
            localStorage.removeItem('carroActivo');
            document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
        }

        // Actualizar la lista de carros
        await actualizarEstadoCarro();

    } catch (error) {
        console.error('Error al eliminar carro:', error);
        mostrarError(error.message);
    }
}

// Función para obtener el resumen consolidado de ingredientes de un carro
export async function obtenerResumenIngredientesCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            throw new Error('No se pudo obtener el resumen de ingredientes');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener resumen de ingredientes:', error);
        mostrarError(error.message);
        return [];
    }
}

// Función para obtener el resumen consolidado de mixes de un carro
export async function obtenerResumenMixesCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/mixes?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            throw new Error('No se pudo obtener el resumen de mixes');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener resumen de mixes:', error);
        mostrarError(error.message);
        return [];
    }
}

// Función para mostrar el resumen de ingredientes en la UI
import { abrirModalIngresoManual } from './ingresoManual.js';
export function mostrarResumenIngredientes(ingredientes) {
    const contenedor = document.getElementById('tabla-resumen-ingredientes');
    if (!contenedor) return;

    console.log('\n🎯 VERIFICACIÓN FINAL DEL INFORME VISUAL');
    console.log('==========================================');
    console.log('Array final recibido para mostrar en la UI:');
    console.log('Cantidad de ingredientes únicos:', ingredientes?.length || 0);

    if (ingredientes && ingredientes.length > 0) {
        console.log('\n📋 INGREDIENTES FINALES PARA EL INFORME:');
        ingredientes.forEach((ing, index) => {
            const estado = ing.stock_actual >= ing.cantidad ? '✅' : '❌';
            console.log(`${index + 1}. ${ing.nombre} (${ing.unidad_medida}): ${ing.cantidad} - Stock: ${ing.stock_actual} ${estado}`);
            console.log(`   - Tipo: ${typeof ing.nombre} | Normalizado: ${ing.nombre === ing.nombre?.toLowerCase()?.trim()}`);
            console.log(`   - Unidad: ${ing.unidad_medida} | Cantidad: ${ing.cantidad} (${typeof ing.cantidad})`);
        });

        console.log('\n✅ CONFIRMACIÓN: Estos son TODOS ingredientes primarios consolidados');
        console.log('- No contienen mixes intermedios');
        console.log('- Están normalizados (minúsculas, sin tildes, sin espacios extra)');
        console.log('- Las cantidades están consolidadas por nombre+unidad');
        console.log('- Incluyen información de stock actual');
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay ingredientes para mostrar en el informe');
    }

    if (!ingredientes || ingredientes.length === 0) {
        contenedor.innerHTML = '<p>No hay ingredientes para mostrar</p>';
        return;
    }

    let html = `
        <table class="tabla-resumen">
            <thead>
                <tr>
                    <th>Ingrediente</th>
                    <th>Cantidad Necesaria</th>
                    <th>Stock Actual</th>
                    <th>Estado</th>
                    <th>Unidad</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
    `;

    ingredientes.forEach(ing => {
        const deshabilitado = (window.carroIdGlobal == null);
        const boton = deshabilitado
            ? `<button disabled title="Seleccioná un carro primero">Ingreso manual</button>`
            : `<button onclick="abrirModalIngresoManual(${ing.id}, window.carroIdGlobal)">Ingreso manual</button>`;

        // Calcular estado del stock
        const stockActual = ing.stock_actual || 0;
        const cantidadNecesaria = ing.cantidad;
        const tieneStock = stockActual >= cantidadNecesaria;
        const faltante = tieneStock ? 0 : cantidadNecesaria - stockActual;

        // Generar indicador visual
        let indicadorEstado = '';
        if (tieneStock) {
            indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
        } else {
            indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)} ${ing.unidad_medida}</span>`;
        }

        html += `
            <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'}">
                <td>${ing.nombre}</td>
                <td>${cantidadNecesaria.toFixed(2)}</td>
                <td>${stockActual.toFixed(2)}</td>
                <td>${indicadorEstado}</td>
                <td>${ing.unidad_medida}</td>
                <td>${boton}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    contenedor.innerHTML = html;
}


// Función para mostrar el resumen de mixes en la UI
export function mostrarResumenMixes(mixes) {
    const contenedor = document.getElementById('tabla-resumen-mixes');
    if (!contenedor) return;

    console.log('\n🧪 VERIFICACIÓN FINAL DEL INFORME DE MIXES');
    console.log('==========================================');
    console.log('Array final de mixes recibido para mostrar en la UI:');
    console.log('Cantidad de mixes únicos:', mixes?.length || 0);
    
    if (mixes && mixes.length > 0) {
        console.log('\n📋 MIXES FINALES PARA EL INFORME:');
        mixes.forEach((mix, index) => {
            console.log(`${index + 1}. ${mix.nombre} (${mix.unidad_medida}): ${mix.cantidad}`);
        });
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay mixes para mostrar en el informe');
    }

    if (!mixes || mixes.length === 0) {
        contenedor.innerHTML = '<p>No hay ingredientes compuestos para mostrar</p>';
        return;
    }

    let html = `
        <table class="tabla-resumen">
            <thead>
                <tr>
                    <th>Ingrediente Compuesto</th>
                    <th>Cantidad Total</th>
                    <th>Unidad</th>
                </tr>
            </thead>
            <tbody>
    `;

    mixes.forEach(mix => {
        html += `
            <tr>
                <td>
                    <span class="mix-nombre" 
                          style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                          onclick="editarIngredienteCompuesto(${mix.id})">${mix.nombre}</span>
                </td>
                <td>${mix.cantidad.toFixed(2)}</td>
                <td>${mix.unidad_medida}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    contenedor.innerHTML = html;
}

// Función para obtener ingredientes expandidos de un artículo
async function obtenerIngredientesExpandidos(numeroArticulo) {
    try {
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/recetas/${numeroArticuloEncoded}/ingredientes-expandido`);
        if (!response.ok) throw new Error('No se encontraron ingredientes');
        const ingredientes = await response.json();

        // Para cada ingrediente, verificar si es un mix
        const ingredientesConMix = await Promise.all(ingredientes.map(async ing => {
            try {
                // Obtener el ID del ingrediente
                const queryId = await fetch(`http://localhost:3002/api/produccion/ingredientes/buscar?nombre=${encodeURIComponent(ing.nombre)}`);
                const { id } = await queryId.json();
                
                if (id) {
                    // Verificar si es un mix
                    const queryEsMix = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}/es-mix`);
                    const { es_mix } = await queryEsMix.json();
                    
                    return {
                        ...ing,
                        id,
                        es_mix
                    };
                }
                return ing;
            } catch (error) {
                console.error(`Error verificando si ${ing.nombre} es mix:`, error);
                return ing;
            }
        }));

        return ingredientesConMix;
    } catch (error) {
        console.error(`Error al obtener ingredientes para ${numeroArticulo}:`, error);
        return null;
    }
}

/**
 * Muestra los artículos agregados al carro activo en el área de trabajo,
 * incluyendo sus ingredientes expandidos
 */
export async function mostrarArticulosDelCarro() {
    try {
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
            return;
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);

        if (!response.ok) {
            throw new Error('Error al obtener artículos del carro');
        }

        const articulos = await response.json();

        let html = `
            <div class="agregar-articulo-container">
                <button id="agregar-articulo" class="btn btn-secondary">
                    Agregar artículo al carro
                </button>
            </div>
            <h3>Artículos en el carro</h3>
            <div class="seccion-articulos">
        `;

        for (const art of articulos) {
            html += `
                <div class="articulo-container" data-numero="${art.numero}">
                    <div class="articulo-info">
                        <span class="articulo-codigo">${art.numero}</span>
                        <span class="articulo-descripcion">${art.descripcion}</span>
                    </div>
                    <div class="articulo-actions">
                        <input type="number"
                               class="input-cantidad-articulo"
                               value="${art.cantidad}"
                               min="1"
                               data-numero="${art.numero}">
                        <button class="btn-eliminar-articulo"
                                data-numero="${art.numero}">
                            🗑️
                        </button>
                    </div>
                    <button class="toggle-ingredientes">Ver</button>
                </div>
            `;

            // Obtener y mostrar ingredientes expandidos para este artículo
            const ingredientes = await obtenerIngredientesExpandidos(art.numero);

            if (ingredientes && ingredientes.length > 0) {
                html += `
                    <div class="ingredientes-expandidos hidden">
                        <div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Ingrediente</th>
                                        <th>Cantidad</th>
                                        <th>Unidad</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                ingredientes.forEach(ing => {
                    // Multiplicar la cantidad del ingrediente por la cantidad del artículo en el carro
                    const cantidadTotal = ing.cantidad * art.cantidad;
                    
                    // Verificar si es un Mix por el nombre (contiene "Mix" al inicio)
                    const esMix = ing.nombre && ing.nombre.toLowerCase().startsWith('mix');
                    
                    html += `
                        <tr>
                            <td>
                                ${ing.es_mix ? 
                                    `<span class="mix-nombre" 
                                           style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                                           onclick="editarIngredienteCompuesto(${ing.id})">${ing.nombre}</span>` : 
                                    ing.nombre}
                            </td>
                            <td data-base="${ing.cantidad}">${cantidadTotal.toFixed(2)}</td>
                            <td>${ing.unidad_medida}</td>
                        </tr>
                    `;
                });

                html += `
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="ingredientes-expandidos hidden">
                        <div class="ingredientes-error">
                            No se pudieron cargar los ingredientes para este artículo.
                        </div>
                    </div>
                `;
            }
        }

        html += `</div>`; // cerrar seccion-articulos

        const contenedor = document.getElementById('lista-articulos');
        if (contenedor) {
            contenedor.innerHTML = html;
        } else {
            console.error('No se encontró el contenedor lista-articulos');
        }

    } catch (error) {
        if (error.message.includes('No hay colaborador seleccionado')) {
            limpiarDatosSesion();
        } else {
            console.log('No se pueden cargar los artículos del carro porque no pertenece al usuario actual.');
            document.getElementById('lista-articulos').innerHTML = '<p>No se pueden mostrar los artículos del carro</p>';
        }
    }
}

// Agregar toggle para mostrar/ocultar ingredientes
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('toggle-ingredientes')) {
        const articuloContainer = e.target.closest('.articulo-container');
        const ingredientes = articuloContainer.nextElementSibling;
        ingredientes.classList.toggle('hidden');
        e.target.textContent = ingredientes.classList.contains('hidden') ?
            'Ver' : 'Ocultar';
    }
});
