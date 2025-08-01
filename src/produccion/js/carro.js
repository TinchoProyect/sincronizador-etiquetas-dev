

import { mostrarError, estilosTablaCarros, agruparCarrosPorSemanas, agruparCarrosPorSemanasYMeses } from './utils.js';
import { abrirEdicionMix } from './mix.js';
import { limpiarIngresosManualesDelCarro, limpiarInformeIngresosManuales } from './ingresoManual.js';

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

        // Verificar permisos para mostrar botón de producción externa
        let botonProduccionExterna = '';
        try {
            const response = await fetch(`/api/roles/${colaborador.rol_id}/permisos`);
            if (response.ok) {
                const permisos = await response.json();
                const tienePermisoExterno = permisos.some(p => p.nombre === 'ProduccionesExternas');
                
                if (tienePermisoExterno) {
                    botonProduccionExterna = `
                        <button onclick="crearNuevoCarro('externa')" class="btn btn-primary" style="margin-left: 10px;">
                            🚚 Crear Carro de Producción Externa
                        </button>
                    `;
                }
            }
        } catch (error) {
            console.error('Error al verificar permisos:', error);
        }

        // Agrupar carros por semanas y meses (nueva funcionalidad mixta)
        const gruposMixtos = agruparCarrosPorSemanasYMeses(carros);

        // Construir HTML con agrupación mixta
        let html = `
            <div class="carros-lista">
                <h3>Tus carros de producción</h3>
                <div class="botones-crear-carro" style="margin-bottom: 20px;">
                    ${botonProduccionExterna}
                </div>
        `;

        gruposMixtos.forEach((grupo, indiceGrupo) => {
            const claseGrupo = grupo.esActual ? 'semana-actual' : '';
            const totalCarros = grupo.carros.length;
            const esGrupoMensual = grupo.anio !== undefined; // Los grupos mensuales tienen propiedades anio y mes
            
            // 🔍 DEPURACIÓN: Determinar si el grupo debe estar expandido por defecto
            const esEstaSemanaSoloExpandida = grupo.etiqueta.includes('Esta semana');
            console.log(`🔍 DEBUG EXPANSIÓN - Grupo: "${grupo.etiqueta}" | Es "Esta semana": ${esEstaSemanaSoloExpandida}`);
            
            const estaExpandido = esEstaSemanaSoloExpandida;
            const indicadorColapso = estaExpandido ? '▼' : '▶';
            const displayTabla = estaExpandido ? 'table' : 'none';
            const claseColapsado = estaExpandido ? '' : 'colapsado';
            
            console.log(`🔍 DEBUG EXPANSIÓN - Resultado: expandido=${estaExpandido}, display=${displayTabla}, clase="${claseColapsado}"`);
            
            html += `
                <div class="grupo-temporal ${claseGrupo} ${esGrupoMensual ? 'grupo-mensual' : 'grupo-semanal'} ${claseColapsado}" data-grupo="${indiceGrupo}">
                    <div class="header-grupo-temporal" onclick="toggleGrupoTemporal(${indiceGrupo})">
                        <div class="etiqueta-temporal">
                            ${grupo.etiqueta}
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="contador-carros">${totalCarros} carro${totalCarros !== 1 ? 's' : ''}</span>
                            <span class="indicador-colapso">${indicadorColapso}</span>
                        </div>
                    </div>
                    <table class="tabla-carros-grupo" style="display: ${displayTabla};">
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

            grupo.carros.forEach(carro => {
                const fecha = new Date(carro.fecha_inicio).toLocaleString();
                const estaActivo = carro.id.toString() === carroId;
                const esExterno = carro.tipo_carro === 'externa';
                const esFinalizado = carro.fecha_confirmacion !== null;
                const esHoy = carro.esHoy;
                
                // Aplicar clases CSS para diferenciación visual
                let clasesFila = '';
                if (estaActivo) {
                    clasesFila += 'carro-activo ';
                }
                if (esExterno) {
                    clasesFila += 'carro-externo ';
                }
                if (esFinalizado) {
                    clasesFila += 'carro-finalizado ';
                }
                if (esHoy) {
                    clasesFila += 'carro-hoy ';
                }
                
                html += `
                    <tr class="${clasesFila.trim()}" onclick="seleccionarCarro(${carro.id})">
                        <td>${carro.id}</td>
                        <td>${fecha}</td>
                        <td>${carro.total_articulos} artículos</td>
                        <td>
                            ${carro.tipo_carro === 'interna' ? '🏭' : '🚚'} 
                            ${carro.tipo_carro === 'interna' ? 'Producción Interna' : 'Producción Externa'}
                        </td>
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
        });

        html += `</div>`; // cerrar carros-lista

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
                const cantidadCalculada = Number((cantidadBase * nuevaCantidad).toPrecision(10));
                cantidadCell.textContent = cantidadCalculada.toFixed(2);
                cantidadCell.dataset.valor = cantidadCalculada;
            });
        }

        // Hacer la llamada al servidor en segundo plano
        await modificarCantidadArticulo(numeroArticulo, nuevaCantidad);
        // Actualizar resumen de artículos externos también
        await actualizarResumenArticulos();
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        inputElement.value = inputElement.dataset.lastValue || 1;
    }
}, 300);

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('input-cantidad-articulo')) {
        const numeroArticulo = e.target.dataset.numero;
        const nuevaCantidad = parseFloat(e.target.value);
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

// Función para actualizar el resumen de artículos vinculados (carros externos)
export async function actualizarResumenArticulos() {
    const carroId = localStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!carroId || !colaboradorData) {
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    try {
        const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
        mostrarResumenArticulos(articulos);
    } catch (error) {
        console.error('Error al actualizar resumen de artículos:', error);
    }
}

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
        // También actualizar el resumen de artículos para carros externos
        await actualizarResumenArticulos();
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
        
        // Buscar el artículo vinculado (si existe)
        let articuloVinculado = null;
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            // El artículo vinculado estaría después del contenedor de ingredientes
            articuloVinculado = ingredientesContainer.nextElementSibling;
            if (articuloVinculado && !articuloVinculado.classList.contains('articulo-vinculado')) {
                articuloVinculado = null;
            }
        } else {
            // Si no hay ingredientes expandidos, el artículo vinculado estaría directamente después
            articuloVinculado = articulo.nextElementSibling;
            if (articuloVinculado && !articuloVinculado.classList.contains('articulo-vinculado')) {
                articuloVinculado = null;
            }
        }

        // También buscar por atributo data-articulo-padre como respaldo
        if (!articuloVinculado) {
            articuloVinculado = document.querySelector(`.articulo-vinculado[data-articulo-padre="${numeroArticulo}"]`);
        }
        
        // Eliminar con animación suave
        articulo.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        articulo.style.opacity = '0';
        articulo.style.transform = 'translateX(-100%)';
        
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            ingredientesContainer.style.transition = 'opacity 0.3s ease-out';
            ingredientesContainer.style.opacity = '0';
        }

        // Animar también el artículo vinculado si existe
        if (articuloVinculado) {
            console.log(`🔗 Eliminando también artículo vinculado para ${numeroArticulo}`);
            articuloVinculado.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
            articuloVinculado.style.opacity = '0';
            articuloVinculado.style.transform = 'translateX(-100%)';
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
                if (articuloVinculado && articuloVinculado.parentNode) {
                    console.log(`✅ Artículo vinculado eliminado del DOM para ${numeroArticulo}`);
                    articuloVinculado.parentNode.removeChild(articuloVinculado);
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
                <td data-valor="${cantidadTotal}">${cantidadTotal.toFixed(2)}</td>
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

// Función para alternar la visibilidad de grupos temporales (semanas y meses)
window.toggleGrupoTemporal = function(indiceGrupo) {
    const grupo = document.querySelector(`[data-grupo="${indiceGrupo}"]`);
    if (!grupo) return;
    
    const tabla = grupo.querySelector('.tabla-carros-grupo');
    const indicador = grupo.querySelector('.indicador-colapso');
    
    if (!tabla || !indicador) return;
    
    // Alternar visibilidad de la tabla
    if (tabla.style.display === 'none') {
        tabla.style.display = 'table';
        indicador.textContent = '▼';
        grupo.classList.remove('colapsado');
    } else {
        tabla.style.display = 'none';
        indicador.textContent = '▶';
        grupo.classList.add('colapsado');
    }
};

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

        // Limpiar datos del carro anterior
        limpiarIngresosManualesDelCarro();

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
        
        // Cargar y mostrar resumen de artículos externos (si aplica)
        const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
        if (articulos && articulos.length > 0) {
            mostrarResumenArticulos(articulos);
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'block';
            }
        } else {
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'none';
            }
        }
        
        // Actualizar ingresos manuales realizados para el carro seleccionado
        if (typeof window.actualizarInformeIngresosManuales === 'function') {
            console.log('Actualizando ingresos manuales después de seleccionar carro...');
            await window.actualizarInformeIngresosManuales();
        }
        
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
    
    // Limpiar resumen de artículos externos
    const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
    if (contenedorArticulos) {
        contenedorArticulos.innerHTML = '<p>No hay carro activo</p>';
    }
    
    // Ocultar sección de artículos externos
    const seccionArticulos = document.getElementById('resumen-articulos');
    if (seccionArticulos) {
        seccionArticulos.style.display = 'none';
    }
    
    // Limpiar informe de ingresos manuales
    console.log('🧹 Limpiando informe de ingresos manuales al deseleccionar carro...');
    limpiarInformeIngresosManuales();
    
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
        console.log(`🚀 INICIANDO obtenerResumenIngredientesCarro para carro ${carroId}, usuario ${usuarioId}`);
        
        // Primero verificar el tipo de carro
        console.log('🔍 Verificando tipo de carro...');
        const responseTipoCarro = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        let tipoCarro = 'interna';
        if (responseTipoCarro.ok) {
            const dataTipoCarro = await responseTipoCarro.json();
            tipoCarro = dataTipoCarro.tipo_carro || 'interna';
            console.log(`🔍 Tipo de carro detectado: ${tipoCarro}`);
        } else {
            console.warn('⚠️ No se pudo obtener el tipo de carro, asumiendo interna');
        }
        
        // Obtener ingredientes base
        console.log('📦 Obteniendo ingredientes base...');
        const responseBase = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`);
        if (!responseBase.ok) {
            throw new Error('No se pudo obtener el resumen de ingredientes');
        }
        const ingredientesBase = await responseBase.json();
        console.log(`📦 Ingredientes base obtenidos: ${ingredientesBase.length}`);

        // Obtener ingredientes de artículos vinculados (solo para carros externos)
        console.log(`🔗 Iniciando obtención de ingredientes vinculados para carro tipo: ${tipoCarro}...`);
        
        let ingredientesVinculados = [];
        
        if (tipoCarro === 'externa') {
            console.log('🔗 Es carro externo, procediendo a obtener ingredientes vinculados...');
            const responseVinculados = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${usuarioId}`);
            console.log('🔗 Response status ingredientes vinculados:', responseVinculados.status);
            
            if (responseVinculados.ok) {
                ingredientesVinculados = await responseVinculados.json();
                console.log('🔗 Ingredientes vinculados RAW obtenidos:', ingredientesVinculados);
                console.log('🔗 Cantidad de ingredientes vinculados:', ingredientesVinculados.length);
                
                // Log detallado de cada ingrediente vinculado
                ingredientesVinculados.forEach((ing, index) => {
                    console.log(`🔗 Ingrediente vinculado ${index + 1}:`, {
                        id: ing.id,
                        nombre: ing.nombre,
                        cantidad: ing.cantidad,
                        stock_actual: ing.stock_actual,
                        unidad_medida: ing.unidad_medida,
                        tipo_stock_actual: typeof ing.stock_actual,
                        valor_stock_actual: ing.stock_actual
                    });
                });
            } else {
                const errorText = await responseVinculados.text();
                console.warn('❌ No se pudieron obtener ingredientes de artículos vinculados:', responseVinculados.status, errorText);
            }
        } else {
            console.log('🔗 Es carro interno, saltando ingredientes vinculados');
        }

        // Marcar ingredientes vinculados para diferenciarlos en UI
        ingredientesVinculados = ingredientesVinculados.map(ing => ({
            ...ing,
            es_de_articulo_vinculado: true
        }));

        // Combinar ambos arrays
        const ingredientesAntesCombinat = [...ingredientesBase];
        const ingredientesCombinados = [...ingredientesBase, ...ingredientesVinculados];

        console.log('🔗 Ingredientes ANTES de combinar:', ingredientesAntesCombinat.length);
        console.log('🔗 Ingredientes vinculados a agregar:', ingredientesVinculados.length);
        console.log('🔗 Ingredientes DESPUÉS de combinar:', ingredientesCombinados.length);
        console.log('🔍 DEPURACIÓN - Ingredientes combinados completos:', ingredientesCombinados);
        console.log('🔍 DEPURACIÓN - Cantidad total de ingredientes:', ingredientesCombinados.length);

        return ingredientesCombinados;
    } catch (error) {
        console.error('❌ Error al obtener resumen de ingredientes:', error);
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

    ingredientes.forEach((ing, index) => {
        // 🔍 LOG DE DEPURACIÓN 3: Justo antes del procesamiento
        console.log(`🔍 PROCESANDO INGREDIENTE ${index + 1}: ${ing.nombre}`, {
            cantidadRaw: ing.cantidad,
            tipoCantidadRaw: typeof ing.cantidad,
            esNull: ing.cantidad === null,
            esUndefined: ing.cantidad === undefined,
            esString: typeof ing.cantidad === 'string',
            valorString: ing.cantidad?.toString(),
            stockActualRaw: ing.stock_actual,
            tipoStockRaw: typeof ing.stock_actual,
            objetoCompleto: ing
        });

        const deshabilitado = (window.carroIdGlobal == null);
        const boton = deshabilitado
            ? `<button disabled title="Seleccioná un carro primero">Ingreso manual</button>`
            : `<button onclick="abrirModalIngresoManual(${ing.id}, window.carroIdGlobal)">Ingreso manual</button>`;

        // Validación robusta para evitar errores con .toFixed()
        const stockActualRaw = ing.stock_actual;
        const cantidadNecesariaRaw = ing.cantidad;
        
        // Convertir a números de forma segura
        let stockActual = 0;
        let cantidadNecesaria = 0;
        
        if (stockActualRaw !== null && stockActualRaw !== undefined && stockActualRaw !== '') {
            const stockParsed = parseFloat(stockActualRaw);
            stockActual = isNaN(stockParsed) ? 0 : stockParsed;
        }
        
        if (cantidadNecesariaRaw !== null && cantidadNecesariaRaw !== undefined && cantidadNecesariaRaw !== '') {
            const cantidadParsed = parseFloat(cantidadNecesariaRaw);
            cantidadNecesaria = isNaN(cantidadParsed) ? 0 : cantidadParsed;
        }
        
        // 🔍 LOG DE DEPURACIÓN 4: Después de la conversión
        console.log(`🔍 CONVERSIÓN COMPLETADA para ${ing.nombre}:`, {
            stockActualFinal: stockActual,
            cantidadNecesariaFinal: cantidadNecesaria,
            conversionExitosa: !isNaN(stockActual) && !isNaN(cantidadNecesaria)
        });
        
        // Log para diagnóstico
        if (cantidadNecesaria === 0 && cantidadNecesariaRaw !== 0) {
            console.warn(`⚠️ Cantidad inválida para ingrediente ${ing.nombre}:`, {
                raw: cantidadNecesariaRaw,
                type: typeof cantidadNecesariaRaw,
                parsed: cantidadNecesaria
            });
        }

        const diferencia = stockActual - cantidadNecesaria;
        const tieneStock = diferencia >= -0.01; // Tolerancia de 0.01 para diferencias decimales
        const faltante = tieneStock ? 0 : Math.abs(diferencia);

        // Generar indicador visual
        let indicadorEstado = '';
        if (tieneStock) {
            indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
        } else {
            indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)} ${ing.unidad_medida || ''}</span>`;
        }

        // Determinar clases CSS para la fila
        let clasesFila = tieneStock ? 'stock-ok' : 'stock-faltante';
        if (ing.es_de_articulo_vinculado) {
            clasesFila += ' ingrediente-vinculado';
        }

        html += `
            <tr class="${clasesFila}">
                <td>${ing.nombre || 'Sin nombre'}</td>
                <td>${cantidadNecesaria.toFixed(2)}</td>
                <td>${stockActual.toFixed(2)}</td>
                <td>${indicadorEstado}</td>
                <td>${ing.unidad_medida || ''}</td>
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
                    <th>Stock Actual</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
    `;

    mixes.forEach(mix => {
        const deshabilitado = (window.carroIdGlobal == null);
        const boton = deshabilitado
            ? `<button disabled title="Seleccioná un carro primero">Ingreso manual</button>`
            : `<button onclick="abrirModalIngresoManual(${mix.id}, window.carroIdGlobal, true)">Ingreso manual</button>`;

        // Calcular estado del stock con tolerancia para diferencias decimales
        const stockActual = mix.stock_actual || 0;
        const cantidadNecesaria = mix.cantidad;
        const diferencia = stockActual - cantidadNecesaria;
        const tieneStock = diferencia >= -0.01; // Tolerancia de 0.01 para diferencias decimales

        html += `
            <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'}">
                <td>
                    <span class="mix-nombre" 
                          style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                          onclick="editarIngredienteCompuesto(${mix.id})">${mix.nombre}</span>
                </td>
                <td>${mix.cantidad.toFixed(2)}</td>
                <td>${mix.unidad_medida}</td>
                <td>${stockActual.toFixed(2)}</td>
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

// Función para obtener el resumen consolidado de artículos de un carro (solo para carros externos)
export async function obtenerResumenArticulosCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            if (response.status === 404) {
                // No hay artículos o no es un carro externo
                return [];
            }
            throw new Error('No se pudo obtener el resumen de artículos');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener resumen de artículos:', error);
        return [];
    }
}

// Función para mostrar el resumen de artículos en la UI (solo para carros externos)
export function mostrarResumenArticulos(articulos) {
    const contenedor = document.getElementById('tabla-resumen-articulos');
    if (!contenedor) return;

    console.log('\n📦 VERIFICACIÓN FINAL DEL INFORME DE ARTÍCULOS');
    console.log('==========================================');
    console.log('Array final de artículos recibido para mostrar en la UI:');
    console.log('Cantidad de artículos únicos:', articulos?.length || 0);
    
    if (articulos && articulos.length > 0) {
        console.log('\n📋 ARTÍCULOS FINALES PARA EL INFORME:');
        articulos.forEach((art, index) => {
            console.log(`${index + 1}. ${art.articulo_numero} - ${art.nombre}: ${art.cantidad_total}`);
        });
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay artículos para mostrar en el informe');
    }

    if (!articulos || articulos.length === 0) {
        contenedor.innerHTML = '<p>No hay artículos de producción externa para mostrar</p>';
        return;
    }

    let html = `
        <table class="tabla-resumen">
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Artículo</th>
                    <th>Cantidad Total</th>
                    <th>Stock Actual</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>
    `;

    articulos.forEach((art, index) => {
        // 🔍 LOG DE DEPURACIÓN: Inspeccionar artículo antes del procesamiento
        console.log(`🔍 PROCESANDO ARTÍCULO ${index + 1}: ${art.articulo_numero}`, {
            cantidadTotalRaw: art.cantidad_total,
            tipoCantidadTotal: typeof art.cantidad_total,
            stockActualRaw: art.stock_actual,
            tipoStockActual: typeof art.stock_actual,
            objetoCompleto: art
        });

        // Validación robusta para evitar errores con .toFixed()
        const stockActualRaw = art.stock_actual;
        const cantidadTotalRaw = art.cantidad_total;
        
        // Convertir a números de forma segura
        let stockActual = 0;
        let cantidadNecesaria = 0;
        
        if (stockActualRaw !== null && stockActualRaw !== undefined && stockActualRaw !== '') {
            const stockParsed = parseFloat(stockActualRaw);
            stockActual = isNaN(stockParsed) ? 0 : stockParsed;
        }
        
        if (cantidadTotalRaw !== null && cantidadTotalRaw !== undefined && cantidadTotalRaw !== '') {
            const cantidadParsed = parseFloat(cantidadTotalRaw);
            cantidadNecesaria = isNaN(cantidadParsed) ? 0 : cantidadParsed;
        }
        
        // 🔍 LOG DE DEPURACIÓN: Después de la conversión
        console.log(`🔍 CONVERSIÓN COMPLETADA para artículo ${art.articulo_numero}:`, {
            stockActualFinal: stockActual,
            cantidadNecesariaFinal: cantidadNecesaria,
            conversionExitosa: !isNaN(stockActual) && !isNaN(cantidadNecesaria)
        });
        
        // Log para diagnóstico
        if (cantidadNecesaria === 0 && cantidadTotalRaw !== 0) {
            console.warn(`⚠️ Cantidad total inválida para artículo ${art.articulo_numero}:`, {
                raw: cantidadTotalRaw,
                type: typeof cantidadTotalRaw,
                parsed: cantidadNecesaria
            });
        }

        const diferencia = stockActual - cantidadNecesaria;
        const tieneStock = diferencia >= -0.01; // Tolerancia de 0.01 para diferencias decimales
        const faltante = tieneStock ? 0 : Math.abs(diferencia);

        // Generar indicador visual
        let indicadorEstado = '';
        if (tieneStock) {
            indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
        } else {
            indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)}</span>`;
        }

        html += `
            <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'}">
                <td>${art.articulo_numero}</td>
                <td>${art.nombre || 'Sin descripción'}</td>
                <td>${cantidadNecesaria.toFixed(2)}</td>
                <td>${stockActual.toFixed(2)}</td>
                <td>${indicadorEstado}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    contenedor.innerHTML = html;
}

// Función para obtener artículos de recetas de un carro (solo para carros externos)
async function obtenerArticulosDeRecetas(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos-recetas?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            if (response.status === 404) {
                // No hay artículos de receta o no es un carro externo
                return [];
            }
            throw new Error('No se pudieron obtener los artículos de recetas');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener artículos de recetas:', error);
        return [];
    }
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
 * incluyendo sus ingredientes expandidos y botones de relación para carros externos
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

        // Obtener tipo de carro para condicionar mostrar artículos de receta
        const responseTipoCarro = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        let tipoCarro = 'interna';
        if (responseTipoCarro.ok) {
            const dataTipoCarro = await responseTipoCarro.json();
            tipoCarro = dataTipoCarro.tipo_carro || 'interna';
        }

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);

        if (!response.ok) {
            throw new Error('Error al obtener artículos del carro');
        }

        const articulos = await response.json();

        // Obtener relaciones existentes para carros externos
        let relacionesExistentes = {};
        if (tipoCarro === 'externa') {
            try {
                const relacionesResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/relaciones-articulos?usuarioId=${colaborador.id}`);
                if (relacionesResponse.ok) {
                    const relaciones = await relacionesResponse.json();
                    relaciones.forEach(rel => {
                        relacionesExistentes[rel.articulo_produccion_codigo] = rel;
                    });
                }
            } catch (error) {
                console.warn('Error al obtener relaciones:', error);
            }
        }

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
            const relacion = relacionesExistentes[art.numero];
            const tieneRelacion = !!relacion;

            // Artículo original (siempre se muestra)
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
                    <div class="articulo-controls">
                        <button class="toggle-ingredientes">Ver</button>
                        ${tipoCarro === 'externa' ? generarBotonesRelacion(art.numero, tieneRelacion, relacion) : ''}
                    </div>
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
                <td data-base="${ing.cantidad}" data-valor="${cantidadTotal}">${parseFloat(cantidadTotal.toFixed(2))}</td>
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

            // Si hay relación, agregar fila del artículo vinculado
            if (tieneRelacion && relacion.articulo_kilo_codigo) {
                html += generarFilaArticuloVinculado(art.numero, relacion);
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

/**
 * Genera los botones de relación para un artículo específico
 * @param {string} articuloCodigo - Código del artículo
 * @param {boolean} tieneRelacion - Si ya tiene una relación establecida
 * @param {Object} relacion - Objeto de relación existente (si existe)
 * @returns {string} HTML de los botones
 */
function generarBotonesRelacion(articuloCodigo, tieneRelacion, relacion) {
    if (tieneRelacion) {
        return ''; // No mostrar botones en el artículo original si ya tiene relación
    } else {
        return `
            <div class="botones-relacion">
                <button class="btn-vincular-articulo" 
                        data-articulo="${articuloCodigo}"
                        title="Vincular con artículo por kilo">
                    ➕ Vincular artículo por kilo
                </button>
            </div>
        `;
    }
}

/**
 * Genera la fila del artículo vinculado (visualmente atenuada)
 * @param {string} articuloProduccionCodigo - Código del artículo de producción
 * @param {Object} relacion - Objeto de relación con datos del artículo vinculado
 * @returns {string} HTML de la fila del artículo vinculado
 */
function generarFilaArticuloVinculado(articuloProduccionCodigo, relacion) {
    // Obtener el multiplicador, por defecto 1 si no existe
    const multiplicador = relacion.multiplicador_ingredientes || 1;
    const multiplicadorTexto = multiplicador === 1 ? '' : ` (×${multiplicador})`;
    
    // Obtener descripción y código de barras del artículo vinculado
    const descripcionVinculado = relacion.articulo_kilo_nombre || 'Artículo vinculado por kilo';
    const codigoBarrasVinculado = relacion.articulo_kilo_codigo_barras || '';
    
    return `
        <div class="articulo-vinculado" data-articulo-padre="${articuloProduccionCodigo}">
            <div class="articulo-info">
                <span class="vinculo-icono">🔗</span>
                <span class="articulo-codigo">${relacion.articulo_kilo_codigo}</span>
                <span class="articulo-descripcion" title="${descripcionVinculado}">${descripcionVinculado}</span>
                ${codigoBarrasVinculado ? `<span class="codigo-barras" title="Código de barras: ${codigoBarrasVinculado}">📊 ${codigoBarrasVinculado}</span>` : ''}
                <span class="vinculo-etiqueta">Artículo vinculado${multiplicadorTexto}</span>
            </div>
            <div class="articulo-actions">
                <span class="cantidad-vinculada">Cantidad automática</span>
                ${multiplicador !== 1 ? `<span class="multiplicador-info" title="Multiplicador de ingredientes">🔢 ${multiplicador}x</span>` : ''}
            </div>
            <div class="articulo-controls">
                <button class="btn-editar-relacion-simple" 
                        data-articulo="${articuloProduccionCodigo}" 
                        data-relacion-id="${relacion.id}"
                        title="Editar vínculo con artículo por kilo">
                    ✏️ Editar vínculo
                </button>
                <button class="btn-eliminar-relacion" 
                        data-articulo="${articuloProduccionCodigo}" 
                        data-relacion-id="${relacion.id}"
                        title="Eliminar vínculo con artículo por kilo">
                    🗑️ Eliminar vínculo
                </button>
            </div>
        </div>
    `;
}

// ==========================================
// FUNCIONES PARA GESTIÓN DE RELACIONES
// ==========================================

/**
 * Abre el modal simplificado para vincular un artículo de producción externa con un artículo por kilo
 * @param {string} articuloCodigo - Código del artículo de producción externa
 */
async function abrirModalVincularArticulo(articuloCodigo) {
    try {
        console.log(`🔗 Abriendo modal simplificado para vincular artículo: ${articuloCodigo}`);
        
        // Obtener información del artículo padre
        const articuloInfo = await obtenerInfoArticulo(articuloCodigo);
        
        // Abrir el modal simplificado en modo crear
        await abrirModalEditarVinculoSimplificado(articuloCodigo, null, articuloInfo);
        
        // Cambiar el título del modal para reflejar que es para vincular
        const modal = document.getElementById('modal-editar-vinculo');
        if (modal) {
            const titulo = modal.querySelector('h2');
            if (titulo) {
                titulo.textContent = '➕ Vincular Artículo por Kilo';
            }
            
            // Configurar el modal para modo crear
            modal.dataset.modo = 'crear';
            delete modal.dataset.relacionId; // No hay relación existente
        }
        
    } catch (error) {
        console.error('Error al abrir modal de vinculación:', error);
        mostrarError('No se pudo abrir el modal de vinculación');
    }
}

/**
 * Abre el modal simplificado para editar una relación existente
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación existente
 */
async function abrirModalEditarRelacion(articuloCodigo, relacionId) {
    try {
        console.log(`✏️ Abriendo modal simplificado para editar relación: ${articuloCodigo} (ID: ${relacionId})`);
        
        // Obtener información del artículo padre
        const articuloInfo = await obtenerInfoArticulo(articuloCodigo);
        
        // Abrir el modal simplificado
        await abrirModalEditarVinculoSimplificado(articuloCodigo, relacionId, articuloInfo);
        
    } catch (error) {
        console.error('Error al abrir modal de edición:', error);
        mostrarError('No se pudo abrir el modal de edición');
    }
}

/**
 * Obtiene información de un artículo por su código
 * @param {string} articuloCodigo - Código del artículo
 * @returns {Object} Información del artículo
 */
async function obtenerInfoArticulo(articuloCodigo) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/articulos`);
        if (!response.ok) {
            throw new Error('Error al obtener información del artículo');
        }
        
        const articulos = await response.json();
        const articulo = articulos.find(art => art.numero === articuloCodigo);
        
        return articulo || { numero: articuloCodigo, nombre: 'Artículo no encontrado' };
    } catch (error) {
        console.error('Error al obtener info del artículo:', error);
        return { numero: articuloCodigo, nombre: 'Error al cargar información' };
    }
}

/**
 * Abre el modal simplificado para editar vínculos
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación existente
 * @param {Object} articuloInfo - Información del artículo padre
 */
async function abrirModalEditarVinculoSimplificado(articuloCodigo, relacionId, articuloInfo) {
    try {
        const modal = document.getElementById('modal-editar-vinculo');
        if (!modal) {
            throw new Error('No se encontró el modal de edición de vínculos');
        }

        // Configurar información del artículo padre
        const codigoPadre = modal.querySelector('.articulo-codigo-padre');
        const descripcionPadre = modal.querySelector('.articulo-descripcion-padre');
        
        if (codigoPadre) codigoPadre.textContent = articuloCodigo;
        if (descripcionPadre) descripcionPadre.textContent = articuloInfo.nombre || 'Sin descripción';

        // Cargar artículos disponibles
        await cargarArticulosParaVinculo();

        // Si es edición, cargar datos existentes de la relación
        if (relacionId && relacionId !== 'null' && relacionId !== 'undefined') {
            console.log(`\n🔍 DEPURACIÓN CARGA DE RELACIÓN EXISTENTE:`);
            console.log('===============================================');
            console.log('- relacionId:', relacionId, typeof relacionId);
            console.log('- URL a consultar:', `http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`);
            
            try {
                const response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`);
                console.log('- Response status:', response.status);
                console.log('- Response ok:', response.ok);
                
                if (response.ok) {
                    const relacion = await response.json();
                    console.log(`\n📋 DATOS DE RELACIÓN RECIBIDOS DEL SERVIDOR:`);
                    console.log('- Objeto completo:', JSON.stringify(relacion, null, 2));
                    console.log('- articulo_kilo_codigo:', relacion.articulo_kilo_codigo);
                    console.log('- multiplicador_ingredientes RAW:', relacion.multiplicador_ingredientes, typeof relacion.multiplicador_ingredientes);
                    
                    // Preseleccionar el artículo vinculado
                    const selector = document.getElementById('selector-articulo-vinculo');
                    if (selector && relacion.articulo_kilo_codigo) {
                        selector.value = relacion.articulo_kilo_codigo;
                        console.log('✅ Artículo preseleccionado en selector:', relacion.articulo_kilo_codigo);
                    } else {
                        console.log('⚠️ No se pudo preseleccionar artículo - selector:', !!selector, 'codigo:', relacion.articulo_kilo_codigo);
                    }
                    
                    // Cargar el multiplicador existente
                    const inputMultiplicador = document.getElementById('multiplicador-ingredientes');
                    console.log('\n🔢 PROCESANDO MULTIPLICADOR:');
                    console.log('- Input multiplicador encontrado:', !!inputMultiplicador);
                    
                    if (inputMultiplicador) {
                        const valorMultiplicador = relacion.multiplicador_ingredientes || 1;
                        inputMultiplicador.value = valorMultiplicador;
                        console.log('- Valor asignado al input:', valorMultiplicador);
                        console.log('- Valor actual del input después de asignar:', inputMultiplicador.value);
                        console.log('✅ Multiplicador cargado en el input');
                    } else {
                        console.log('❌ No se encontró el input multiplicador-ingredientes');
                    }
                } else {
                    const errorText = await response.text();
                    console.warn('⚠️ No se pudieron cargar los datos de la relación existente');
                    console.warn('- Error response:', errorText);
                }
            } catch (error) {
                console.error('❌ Error al cargar datos de relación:', error);
                console.error('- Error completo:', error.message);
            }
        } else {
            console.log(`\n🔢 ESTABLECIENDO MULTIPLICADOR POR DEFECTO:`);
            console.log('- relacionId es null/undefined, estableciendo valor por defecto');
            
            // Para nuevas relaciones, establecer valor por defecto
            const inputMultiplicador = document.getElementById('multiplicador-ingredientes');
            if (inputMultiplicador) {
                inputMultiplicador.value = 1;
                console.log('✅ Multiplicador establecido por defecto: 1');
                console.log('- Valor actual del input:', inputMultiplicador.value);
            } else {
                console.log('❌ No se encontró el input multiplicador-ingredientes para valor por defecto');
            }
        }

        // Configurar datos del modal
        modal.dataset.articuloCodigo = articuloCodigo;
        modal.dataset.relacionId = relacionId;

        // Mostrar el modal
        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

    } catch (error) {
        console.error('Error al abrir modal simplificado:', error);
        mostrarError(error.message);
    }
}

/**
 * Carga la lista de artículos disponibles para vincular
 */
async function cargarArticulosParaVinculo() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/articulos');
        if (!response.ok) {
            throw new Error('Error al cargar artículos');
        }

        const articulos = await response.json();
        const selector = document.getElementById('selector-articulo-vinculo');
        
        if (!selector) return;

        // Limpiar opciones existentes
        selector.innerHTML = '<option value="">Seleccione un artículo...</option>';

        // Ordenar artículos alfabéticamente
        articulos.sort((a, b) => a.nombre.localeCompare(b.nombre));

        // Agregar opciones
        articulos.forEach(articulo => {
            const option = document.createElement('option');
            option.value = articulo.numero;
            option.textContent = `${articulo.numero} - ${articulo.nombre}`;
            option.dataset.nombre = articulo.nombre;
            selector.appendChild(option);
        });

        // Configurar búsqueda en tiempo real
        configurarBusquedaVinculo(articulos);

    } catch (error) {
        console.error('Error al cargar artículos:', error);
        const selector = document.getElementById('selector-articulo-vinculo');
        if (selector) {
            selector.innerHTML = '<option value="">Error al cargar artículos</option>';
        }
    }
}

/**
 * Configura la funcionalidad de búsqueda en tiempo real
 * @param {Array} articulos - Lista completa de artículos
 */
function configurarBusquedaVinculo(articulos) {
    const inputBusqueda = document.getElementById('buscar-articulo-vinculo');
    const selector = document.getElementById('selector-articulo-vinculo');
    
    if (!inputBusqueda || !selector) return;

    inputBusqueda.addEventListener('input', (e) => {
        const termino = e.target.value.toLowerCase().trim();
        
        // Limpiar selector
        selector.innerHTML = '<option value="">Seleccione un artículo...</option>';
        
        // Filtrar artículos
        const articulosFiltrados = articulos.filter(articulo => 
            articulo.numero.toLowerCase().includes(termino) ||
            articulo.nombre.toLowerCase().includes(termino)
        );

        // Agregar opciones filtradas
        articulosFiltrados.forEach(articulo => {
            const option = document.createElement('option');
            option.value = articulo.numero;
            option.textContent = `${articulo.numero} - ${articulo.nombre}`;
            option.dataset.nombre = articulo.nombre;
            selector.appendChild(option);
        });
    });
}

/**
 * Cierra el modal simplificado de edición de vínculos
 */
function cerrarModalEditarVinculo() {
    const modal = document.getElementById('modal-editar-vinculo');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
        
        // Limpiar datos
        delete modal.dataset.articuloCodigo;
        delete modal.dataset.relacionId;
        
        // Limpiar campos
        const inputBusqueda = document.getElementById('buscar-articulo-vinculo');
        const selector = document.getElementById('selector-articulo-vinculo');
        
        if (inputBusqueda) inputBusqueda.value = '';
        if (selector) selector.selectedIndex = 0;
    }
}

/**
 * Procesa el guardado del vínculo (crear nuevo o editar existente)
 */
async function procesarGuardadoVinculo() {
    try {
        console.log('\n🔍 DEPURACIÓN FRONTEND - procesarGuardadoVinculo():');
        console.log('=======================================================');
        
        const modal = document.getElementById('modal-editar-vinculo');
        const selector = document.getElementById('selector-articulo-vinculo');
        const inputMultiplicador = document.getElementById('multiplicador-ingredientes');
        
        console.log('\n📋 ELEMENTOS DEL MODAL:');
        console.log('- modal encontrado:', !!modal);
        console.log('- selector encontrado:', !!selector);
        console.log('- inputMultiplicador encontrado:', !!inputMultiplicador);
        
        if (!modal || !selector) {
            console.log('❌ ERROR: No se encontraron los elementos del modal');
            throw new Error('No se encontraron los elementos del modal');
        }

        const articuloCodigo = modal.dataset.articuloCodigo;
        const relacionId = modal.dataset.relacionId;
        const articuloKiloCodigo = selector.value;
        const multiplicadorIngredientesRaw = inputMultiplicador?.value;
        const multiplicadorIngredientes = parseFloat(multiplicadorIngredientesRaw || 1);

        console.log('\n📋 VALORES EXTRAÍDOS DEL MODAL:');
        console.log('- articuloCodigo:', articuloCodigo);
        console.log('- relacionId:', relacionId);
        console.log('- articuloKiloCodigo:', articuloKiloCodigo);
        console.log('- multiplicadorIngredientesRaw:', multiplicadorIngredientesRaw, typeof multiplicadorIngredientesRaw);
        console.log('- multiplicadorIngredientes (parseado):', multiplicadorIngredientes, typeof multiplicadorIngredientes);

        if (!articuloCodigo) {
            console.log('❌ ERROR: Código de artículo de producción no válido');
            throw new Error('Código de artículo de producción no válido');
        }

        if (!articuloKiloCodigo) {
            console.log('❌ ERROR: Debe seleccionar un artículo por kilo');
            mostrarError('Debe seleccionar un artículo por kilo');
            return;
        }

        // Validar multiplicador
        if (isNaN(multiplicadorIngredientes) || multiplicadorIngredientes <= 0) {
            console.log('❌ ERROR: Multiplicador inválido:', multiplicadorIngredientes);
            mostrarError('El multiplicador debe ser un número mayor a 0');
            return;
        }

        console.log(`\n🔗 PROCESANDO VÍNCULO: ${articuloCodigo} -> ${articuloKiloCodigo}`);
        console.log(`🔢 MULTIPLICADOR FINAL: ${multiplicadorIngredientes}`);
        console.log(`📋 MODO: ${relacionId ? 'editar' : 'crear'} | RelacionId: ${relacionId}`);

        let response;
        let mensaje;
        let requestBody;

        if (relacionId && relacionId !== 'undefined' && relacionId !== 'null') {
            // Editar relación existente
            requestBody = {
                articulo_kilo_codigo: articuloKiloCodigo,
                multiplicador_ingredientes: multiplicadorIngredientes
            };
            
            console.log(`\n✏️ EDITANDO RELACIÓN EXISTENTE:`);
            console.log('- URL:', `http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`);
            console.log('- Method: PUT');
            console.log('- Body:', JSON.stringify(requestBody, null, 2));
            
            response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            mensaje = 'Vínculo actualizado correctamente';
        } else {
            // Crear nueva relación
            requestBody = {
                articulo_produccion_codigo: articuloCodigo,
                articulo_kilo_codigo: articuloKiloCodigo,
                multiplicador_ingredientes: multiplicadorIngredientes
            };
            
            console.log(`\n➕ CREANDO NUEVA RELACIÓN:`);
            console.log('- URL:', 'http://localhost:3002/api/produccion/relacion-articulo');
            console.log('- Method: POST');
            console.log('- Body:', JSON.stringify(requestBody, null, 2));
            
            response = await fetch('http://localhost:3002/api/produccion/relacion-articulo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            mensaje = 'Vínculo creado correctamente';
        }

        console.log('\n📡 RESPUESTA DEL SERVIDOR:');
        console.log('- Status:', response.status);
        console.log('- OK:', response.ok);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('❌ ERROR EN RESPUESTA:', errorData);
            throw new Error(errorData.error || 'Error al procesar la relación');
        }

        const resultado = await response.json();
        console.log('✅ VÍNCULO PROCESADO EXITOSAMENTE:', JSON.stringify(resultado, null, 2));

        // Mostrar notificación de éxito
        mostrarNotificacionExito(mensaje);

        // Cerrar modal
        cerrarModalEditarVinculo();

        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();

    } catch (error) {
        console.error('❌ Error al guardar vínculo:', error);
        mostrarError(error.message);
    }
}

/**
 * Elimina una relación existente
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación a eliminar
 */
async function eliminarRelacionArticulo(articuloCodigo, relacionId) {
    try {
        const confirmar = confirm(`¿Está seguro de que desea eliminar el vínculo del artículo ${articuloCodigo}?`);
        if (!confirmar) return;
        
        console.log(`🗑️ Eliminando relación: ${articuloCodigo} (ID: ${relacionId})`);
        
        const response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar la relación');
        }
        
        // Mostrar notificación de éxito
        mostrarNotificacionExito('Vínculo eliminado correctamente');
        
        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();
        
    } catch (error) {
        console.error('Error al eliminar relación:', error);
        mostrarError(error.message);
    }
}

/**
 * Abre el modal de artículos sin aplicar filtros de producción externa
 */
async function abrirModalArticulosSinFiltros() {
    try {
        const modal = document.getElementById('modal-articulos');
        if (!modal) {
            throw new Error('No se encontró el modal de artículos');
        }

        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        // Cargar TODOS los artículos sin filtros
        const response = await fetch('http://localhost:3002/api/produccion/articulos');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener artículos');
        }

        const articulos = await response.json();
        
        if (articulos.length === 0) {
            mostrarError('No se encontraron artículos disponibles');
            return;
        }

        // Actualizar el título del modal
        const modalTitle = modal.querySelector('h2');
        if (modalTitle) {
            const tipoOperacion = window.modoVinculacion?.tipo === 'editar' ? 'Editar vínculo' : 'Vincular artículo';
            modalTitle.textContent = `🔗 ${tipoOperacion} - Seleccionar artículo por kilo`;
        }

        // Ocultar el switch de filtro de producción
        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        if (filtroProduccionSwitch) {
            filtroProduccionSwitch.checked = false;
            const formCheck = filtroProduccionSwitch.closest('.filtro-grupo');
            if (formCheck) {
                formCheck.style.display = 'none';
            }
        }

        // Actualizar la tabla con todos los artículos
        await actualizarTablaArticulosVinculacion(articulos);
        
    } catch (error) {
        console.error('Error al abrir modal sin filtros:', error);
        mostrarError(error.message);
        const modal = document.getElementById('modal-articulos');
        if (modal) {
            modal.style.display = 'none';
        }
    }
}

/**
 * Actualiza la tabla de artículos para el modo vinculación
 * @param {Array} articulos - Lista de artículos
 */
async function actualizarTablaArticulosVinculacion(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos disponibles</td></tr>';
        return;
    }

    // Ordenar artículos alfabéticamente
    articulos.sort((a, b) => a.nombre.localeCompare(b.nombre));

    articulos.forEach(articulo => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-numero', articulo.numero);

        tr.innerHTML = `
            <td>${articulo.numero}</td>
            <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
            <td style="text-align: center; font-weight: bold; color: ${articulo.stock_consolidado > 0 ? '#28a745' : '#dc3545'};">
                ${articulo.stock_consolidado || 0}
            </td>
            <td>
                <button class="btn-seleccionar-vinculacion" 
                        data-numero="${articulo.numero}" 
                        data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                        style="background-color: #007bff; color: white; border: none; padding: 6px 12px; border-radius: 4px;">
                    Seleccionar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Procesa la selección de un artículo para vinculación
 * @param {string} articuloKiloCodigo - Código del artículo por kilo seleccionado
 * @param {string} articuloKiloNombre - Nombre del artículo por kilo seleccionado
 */
async function procesarSeleccionVinculacion(articuloKiloCodigo, articuloKiloNombre) {
    try {
        if (!window.modoVinculacion || !window.modoVinculacion.activo) {
            throw new Error('No hay modo de vinculación activo');
        }

        const { articuloProduccion, relacionId, tipo } = window.modoVinculacion;
        
        console.log(`🔗 Procesando vinculación: ${articuloProduccion} -> ${articuloKiloCodigo}`);
        
        let response;
        
        if (tipo === 'crear') {
            // Crear nueva relación
            response = await fetch('http://localhost:3002/api/produccion/relacion-articulo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo_produccion_codigo: articuloProduccion,
                    articulo_kilo_codigo: articuloKiloCodigo
                })
            });
        } else if (tipo === 'editar') {
            // Actualizar relación existente
            response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo_kilo_codigo: articuloKiloCodigo
                })
            });
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al procesar la vinculación');
        }
        
        // Mostrar notificación de éxito
        const mensaje = tipo === 'crear' ? 'Vínculo creado correctamente' : 'Vínculo actualizado correctamente';
        mostrarNotificacionExito(mensaje);
        
        // Cerrar modal y limpiar modo vinculación
        cerrarModalVinculacion();
        
        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();
        
    } catch (error) {
        console.error('Error al procesar vinculación:', error);
        mostrarError(error.message);
    }
}

/**
 * Cierra el modal de vinculación y limpia el estado
 */
function cerrarModalVinculacion() {
    const modal = document.getElementById('modal-articulos');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
    
    // Limpiar campos de filtro
    const filtro1 = document.getElementById('filtro1');
    const filtro2 = document.getElementById('filtro2');
    const filtro3 = document.getElementById('filtro3');
    const codigoBarras = document.getElementById('codigo-barras');
    
    if (filtro1) filtro1.value = '';
    if (filtro2) filtro2.value = '';
    if (filtro3) filtro3.value = '';
    if (codigoBarras) codigoBarras.value = '';
    
    // Mostrar nuevamente el switch de filtro de producción
    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    if (filtroProduccionSwitch) {
        const formCheck = filtroProduccionSwitch.closest('.filtro-grupo');
        if (formCheck) {
            formCheck.style.display = 'block';
        }
    }
    
    // Limpiar modo vinculación
    window.modoVinculacion = null;
}

/**
 * Muestra una notificación de éxito
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarNotificacionExito(mensaje) {
    const notification = document.createElement('div');
    notification.textContent = mensaje;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #28a745;
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
    }, 3000);
}

// Event listeners para los botones de relación y vinculación
document.addEventListener('click', async (e) => {
    // Toggle para mostrar/ocultar ingredientes
    if (e.target.classList.contains('toggle-ingredientes')) {
        const articuloContainer = e.target.closest('.articulo-container');
        const ingredientes = articuloContainer.nextElementSibling;
        ingredientes.classList.toggle('hidden');
        e.target.textContent = ingredientes.classList.contains('hidden') ?
            'Ver' : 'Ocultar';
    }
    
    // Botón vincular artículo
    if (e.target.classList.contains('btn-vincular-articulo')) {
        const articuloCodigo = e.target.dataset.articulo;
        await abrirModalVincularArticulo(articuloCodigo);
    }
    
    // Botón editar relación
    if (e.target.classList.contains('btn-editar-relacion')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }
    
    // Botón editar relación simple
    if (e.target.classList.contains('btn-editar-relacion-simple')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }
    
    // Botón eliminar relación
    if (e.target.classList.contains('btn-eliminar-relacion')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await eliminarRelacionArticulo(articuloCodigo, relacionId);
    }
    
    // ✅ NUEVOS EVENT LISTENERS PARA ARTÍCULOS SECUNDARIOS
    
    // Botón editar vínculo secundario
    if (e.target.classList.contains('btn-editar-vinculo-secundario')) {
        const articuloCodigo = e.target.dataset.articuloPadre;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }
    
    // Botón eliminar vínculo secundario
    if (e.target.classList.contains('btn-eliminar-vinculo-secundario')) {
        const articuloCodigo = e.target.dataset.articuloPadre;
        const relacionId = e.target.dataset.relacionId;
        await eliminarRelacionArticulo(articuloCodigo, relacionId);
    }
    
    // Botón seleccionar en modo vinculación
    if (e.target.classList.contains('btn-seleccionar-vinculacion')) {
        const articuloKiloCodigo = e.target.dataset.numero;
        const articuloKiloNombre = e.target.dataset.nombre;
        await procesarSeleccionVinculacion(articuloKiloCodigo, articuloKiloNombre);
    }
});

// Exportar funciones para uso en módulos ES6
export {
    cerrarModalEditarVinculo,
    procesarGuardadoVinculo
};
