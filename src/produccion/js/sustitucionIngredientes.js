/**
 * Módulo para gestionar la sustitución de ingredientes
 * Permite usar stock de un ingrediente para cubrir la necesidad de otro
 */

// Estado del modal
const estadoSustitucion = {
    ingredienteDestino: null,
    ingredienteOrigen: null,
    cantidadFaltante: 0,
    ingredientesDisponibles: [],
    carroId: null,
    usuarioId: null
};

/**
 * Abre el modal de sustitución de ingredientes
 * @param {number} ingredienteDestinoId - ID del ingrediente que necesita stock
 * @param {number} cantidadFaltante - Cantidad faltante del ingrediente
 * @param {string} nombreDestino - Nombre del ingrediente destino
 * @param {string} unidadDestino - Unidad de medida del ingrediente destino
 */
export async function abrirModalSustitucion(ingredienteDestinoId, cantidadFaltante, nombreDestino, unidadDestino) {
    try {
        console.log('🔄 Abriendo modal de sustitución:', {
            ingredienteDestinoId,
            cantidadFaltante,
            nombreDestino,
            unidadDestino
        });

        // Obtener carro y usuario activos
        const carroId = localStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');

        if (!carroId || !colaboradorData) {
            mostrarError('No hay carro activo o usuario seleccionado');
            return;
        }

        const colaborador = JSON.parse(colaboradorData);

        // Guardar estado
        estadoSustitucion.ingredienteDestino = {
            id: ingredienteDestinoId,
            nombre: nombreDestino,
            unidad: unidadDestino
        };
        estadoSustitucion.cantidadFaltante = cantidadFaltante;
        estadoSustitucion.carroId = carroId;
        estadoSustitucion.usuarioId = colaborador.id;
        estadoSustitucion.ingredienteOrigen = null;

        // Actualizar UI del modal
        document.getElementById('sustitucion-ingrediente-destino-nombre').textContent = nombreDestino;
        document.getElementById('sustitucion-cantidad-faltante').textContent = cantidadFaltante.toFixed(2);
        document.getElementById('sustitucion-unidad-destino').textContent = unidadDestino;

        // Limpiar búsqueda y selección
        // NOTA: Aquí sí limpiamos al abrir de cero
        document.getElementById('sustitucion-buscar-origen').value = '';
        document.getElementById('sustitucion-cantidad-container').style.display = 'none';
        document.getElementById('sustitucion-btn-confirmar').disabled = true;
        limpiarMensajeValidacion();

        // Cargar ingredientes disponibles
        await cargarIngredientesDisponibles();

        // Mostrar modal
        const modal = document.getElementById('modal-sustitucion-ingredientes');
        modal.classList.add('show');

        // Bloquear scroll del body (UX MEJORADA)
        document.body.style.overflow = 'hidden';
        console.log('🔒 Scroll del body bloqueado');

    } catch (error) {
        console.error('Error al abrir modal de sustitución:', error);
        mostrarError('No se pudo abrir el modal de sustitución');
    }
}

/**
 * Cierra el modal de sustitución
 */
function cerrarModalSustitucion() {
    const modal = document.getElementById('modal-sustitucion-ingredientes');
    modal.classList.remove('show');

    // Desbloquear scroll del body (UX MEJORADA)
    document.body.style.overflow = '';
    console.log('🔓 Scroll del body desbloqueado');

    // Limpiar estado
    estadoSustitucion.ingredienteDestino = null;
    estadoSustitucion.ingredienteOrigen = null;
    estadoSustitucion.cantidadFaltante = 0;
    estadoSustitucion.ingredientesDisponibles = [];

    // Limpiar UI
    document.getElementById('sustitucion-buscar-origen').value = '';
    document.getElementById('sustitucion-cantidad-input').value = '';
    document.getElementById('sustitucion-cantidad-container').style.display = 'none';
    limpiarMensajeValidacion();
}

/**
 * Carga la lista de ingredientes con stock disponible
 */
async function cargarIngredientesDisponibles() {
    try {
        const response = await fetch(
            `http://localhost:3002/api/produccion/ingredientes-con-stock?carroId=${estadoSustitucion.carroId}`
        );

        if (!response.ok) {
            throw new Error('Error al obtener ingredientes con stock');
        }

        const ingredientes = await response.json();

        // Filtrar ingredientes con la misma unidad de medida y stock > 0
        estadoSustitucion.ingredientesDisponibles = ingredientes.filter(ing =>
            ing.id !== estadoSustitucion.ingredienteDestino.id && // No incluir el mismo ingrediente
            ing.unidad_medida === estadoSustitucion.ingredienteDestino.unidad && // Misma unidad
            ing.stock_actual > 0 // Con stock disponible
        );

        console.log(`✅ ${estadoSustitucion.ingredientesDisponibles.length} ingredientes disponibles para sustitución`);

        renderizarListaIngredientes(estadoSustitucion.ingredientesDisponibles);

    } catch (error) {
        console.error('Error al cargar ingredientes disponibles:', error);
        mostrarError('No se pudieron cargar los ingredientes disponibles');
    }
}

/**
 * Renderiza la lista de ingredientes disponibles
 * @param {Array} ingredientes - Lista de ingredientes a mostrar
 */
function renderizarListaIngredientes(ingredientes) {
    const contenedor = document.getElementById('sustitucion-lista-ingredientes');

    if (!ingredientes || ingredientes.length === 0) {
        contenedor.innerHTML = `
            <div class="no-ingredientes-disponibles">
                <div class="icono">📦</div>
                <p>No hay ingredientes disponibles con la misma unidad de medida (${estadoSustitucion.ingredienteDestino.unidad})</p>
            </div>
        `;
        return;
    }

    let html = '';
    ingredientes.forEach(ing => {
        // Convertir stock_actual a número de forma segura
        const stockActual = parseFloat(ing.stock_actual) || 0;

        html += `
            <div class="ingrediente-origen-item" data-ingrediente-id="${ing.id}" onclick="seleccionarIngredienteOrigen(${ing.id})">
                <div>
                    <div class="nombre">${ing.nombre}${ing.sector_letra ? ` [Sector ${ing.sector_letra}]` : ''}</div>
                </div>
                <div>
                    <span class="stock">${stockActual.toFixed(2)}</span>
                    <span class="unidad">${ing.unidad_medida}</span>
                </div>
            </div>
        `;
    });

    contenedor.innerHTML = html;
}

/**
 * Selecciona un ingrediente origen para la sustitución
 * @param {number} ingredienteId - ID del ingrediente seleccionado
 */
window.seleccionarIngredienteOrigen = function (ingredienteId) {
    // Buscar el ingrediente en la lista
    const ingrediente = estadoSustitucion.ingredientesDisponibles.find(ing => ing.id === ingredienteId);

    if (!ingrediente) {
        console.error('Ingrediente no encontrado:', ingredienteId);
        return;
    }

    // Convertir stock_actual a número de forma segura
    const stockActual = parseFloat(ingrediente.stock_actual) || 0;

    // Guardar selección con stock parseado
    estadoSustitucion.ingredienteOrigen = {
        ...ingrediente,
        stock_actual: stockActual
    };

    // Actualizar UI - marcar como seleccionado
    document.querySelectorAll('.ingrediente-origen-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-ingrediente-id="${ingredienteId}"]`).classList.add('selected');

    // Mostrar input de cantidad
    const contenedorCantidad = document.getElementById('sustitucion-cantidad-container');
    contenedorCantidad.style.display = 'block';

    // Actualizar información de cantidad máxima
    document.getElementById('sustitucion-max-disponible').textContent = stockActual.toFixed(2);
    document.getElementById('sustitucion-unidad-max').textContent = ingrediente.unidad_medida;
    document.getElementById('sustitucion-unidad-input').textContent = ingrediente.unidad_medida;

    // Establecer valor sugerido (el menor entre faltante y disponible)
    const cantidadSugerida = Math.min(estadoSustitucion.cantidadFaltante, stockActual);
    document.getElementById('sustitucion-cantidad-input').value = cantidadSugerida.toFixed(2);
    document.getElementById('sustitucion-cantidad-input').max = stockActual;

    // Validar cantidad inicial
    validarCantidad();

    console.log('✅ Ingrediente origen seleccionado:', ingrediente.nombre);
};

/**
 * Valida la cantidad ingresada y actualiza el feedback visual
 */
function validarCantidad() {
    const input = document.getElementById('sustitucion-cantidad-input');
    const cantidad = parseFloat(input.value);
    const btnConfirmar = document.getElementById('sustitucion-btn-confirmar');

    limpiarMensajeValidacion();

    // Remover borde rojo si existe
    input.style.borderColor = '';

    // Validar que haya cantidad
    if (!cantidad || cantidad <= 0) {
        mostrarMensajeValidacion('Debe ingresar una cantidad mayor a 0', 'error');
        input.style.borderColor = '#dc3545';
        btnConfirmar.disabled = true;
        actualizarFaltanteRestante(0);
        return false;
    }

    // VALIDACIÓN BLOQUEANTE: No exceder el stock disponible
    if (cantidad > estadoSustitucion.ingredienteOrigen.stock_actual) {
        mostrarMensajeValidacion(
            `❌ La cantidad no puede exceder el stock disponible (${estadoSustitucion.ingredienteOrigen.stock_actual.toFixed(2)} ${estadoSustitucion.ingredienteOrigen.unidad_medida})`,
            'error'
        );
        input.style.borderColor = '#dc3545';
        btnConfirmar.disabled = true;
        actualizarFaltanteRestante(0);
        return false;
    }

    // Advertencia si la cantidad es mayor al faltante
    if (cantidad > estadoSustitucion.cantidadFaltante) {
        mostrarMensajeValidacion(
            `⚠️ La cantidad ingresada (${cantidad.toFixed(2)}) es mayor al faltante (${estadoSustitucion.cantidadFaltante.toFixed(2)}). Se asignará el excedente.`,
            'warning'
        );
    }

    // Actualizar feedback visual de faltante restante
    actualizarFaltanteRestante(cantidad);

    // Validación exitosa
    btnConfirmar.disabled = false;
    return true;
}

/**
 * Actualiza el feedback visual del faltante restante
 * @param {number} cantidadAsignada - Cantidad que se va a asignar
 */
function actualizarFaltanteRestante(cantidadAsignada) {
    const contenedor = document.getElementById('sustitucion-faltante-restante');
    const valorSpan = document.getElementById('sustitucion-faltante-restante-valor');
    const unidadSpan = document.getElementById('sustitucion-faltante-restante-unidad');

    if (!contenedor || !valorSpan || !unidadSpan) return;

    // Calcular faltante restante
    const faltanteRestante = Math.max(0, estadoSustitucion.cantidadFaltante - cantidadAsignada);

    // Actualizar valores
    valorSpan.textContent = faltanteRestante.toFixed(2);
    unidadSpan.textContent = estadoSustitucion.ingredienteDestino.unidad;

    // Mostrar/ocultar según si hay faltante restante
    if (cantidadAsignada > 0) {
        contenedor.style.display = 'flex';

        // Cambiar estilo según si está completo o no
        if (faltanteRestante <= 0.01) {
            contenedor.classList.add('completo');
            valorSpan.textContent = '0.00';
        } else {
            contenedor.classList.remove('completo');
        }
    } else {
        contenedor.style.display = 'none';
    }
}

/**
 * Muestra un mensaje de validación
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - Tipo de mensaje ('error' o 'warning')
 */
function mostrarMensajeValidacion(mensaje, tipo) {
    const contenedor = document.getElementById('sustitucion-mensaje-validacion');
    contenedor.textContent = mensaje;
    contenedor.className = `mensaje-validacion ${tipo}`;
}

/**
 * Limpia el mensaje de validación
 */
function limpiarMensajeValidacion() {
    const contenedor = document.getElementById('sustitucion-mensaje-validacion');
    contenedor.textContent = '';
    contenedor.className = 'mensaje-validacion';
}

/**
 * Confirma la sustitución y registra los movimientos
 * FLUJO CONTINUO: No cierra el modal, permite seguir asignando
 */
async function confirmarSustitucion() {
    try {
        // Validar antes de proceder
        if (!validarCantidad()) {
            console.warn('⚠️ Validación fallida, no se puede confirmar');
            return;
        }

        const cantidad = parseFloat(document.getElementById('sustitucion-cantidad-input').value);
        const ingredienteOrigenNombre = estadoSustitucion.ingredienteOrigen.nombre;
        const ingredienteOrigenId = estadoSustitucion.ingredienteOrigen.id;

        console.log('🔄 Confirmando sustitución:', {
            origen: ingredienteOrigenNombre,
            destino: estadoSustitucion.ingredienteDestino.nombre,
            cantidad: cantidad,
            carroId: estadoSustitucion.carroId
        });

        // Mostrar indicador de carga
        document.getElementById('sustitucion-loading').classList.add('show');
        document.getElementById('sustitucion-btn-confirmar').disabled = true;

        // Realizar la sustitución
        const response = await fetch('http://localhost:3002/api/produccion/sustituir-ingrediente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ingredienteOrigenId: ingredienteOrigenId,
                ingredienteDestinoId: estadoSustitucion.ingredienteDestino.id,
                cantidad: cantidad,
                carroId: estadoSustitucion.carroId,
                usuarioId: estadoSustitucion.usuarioId
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al realizar la sustitución');
        }

        const resultado = await response.json();
        console.log('✅ Sustitución realizada exitosamente:', resultado);

        // 🔧 CORRECCIÓN RACE CONDITION: Esperar a que la transacción se confirme completamente
        console.log('⏳ Esperando confirmación completa de la transacción en BD...');
        await new Promise(resolve => setTimeout(resolve, 800)); // 800ms para asegurar commit

        // 🔄 FLUJO CONTINUO: NO cerrar modal, actualizar en tiempo real

        // 1. Mostrar notificación de éxito DENTRO del modal
        mostrarNotificacionModalExito(
            `✅ Asignados ${cantidad.toFixed(2)} ${estadoSustitucion.ingredienteOrigen.unidad_medida} de "${ingredienteOrigenNombre}"`
        );

        // 2. Actualizar faltante en el header del modal
        estadoSustitucion.cantidadFaltante = Math.max(0, estadoSustitucion.cantidadFaltante - cantidad);
        document.getElementById('sustitucion-cantidad-faltante').textContent = estadoSustitucion.cantidadFaltante.toFixed(2);
        console.log(`📊 Nuevo faltante: ${estadoSustitucion.cantidadFaltante.toFixed(2)}`);

        // 3. Actualizar stock del ingrediente origen en la lista
        const ingredienteEnLista = estadoSustitucion.ingredientesDisponibles.find(ing => ing.id === ingredienteOrigenId);
        if (ingredienteEnLista) {
            ingredienteEnLista.stock_actual = Math.max(0, parseFloat(ingredienteEnLista.stock_actual) - cantidad);
            console.log(`📦 Stock actualizado de "${ingredienteOrigenNombre}": ${ingredienteEnLista.stock_actual.toFixed(2)}`);
        }

        // 4. Recargar lista de ingredientes (filtra los que quedaron sin stock)
        estadoSustitucion.ingredientesDisponibles = estadoSustitucion.ingredientesDisponibles.filter(ing =>
            parseFloat(ing.stock_actual) > 0
        );

        // --- UX MEJORADA: PERSISTENCIA DEL FILTRO ---
        // En lugar de renderizar todo, volvemos a llamar a filtrarIngredientes
        // para que respete lo que el usuario escribió en el buscador.
        filtrarIngredientes();

        // 5. Limpiar selección actual
        estadoSustitucion.ingredienteOrigen = null;
        document.getElementById('sustitucion-cantidad-container').style.display = 'none';
        document.getElementById('sustitucion-cantidad-input').value = '';
        document.getElementById('sustitucion-faltante-restante').style.display = 'none';

        // NO borramos el buscador (document.getElementById('sustitucion-buscar-origen').value = '')
        // para que persista el filtro.

        limpiarMensajeValidacion();

        // 6. Actualizar resumen de ingredientes en el fondo (sin cerrar modal)
        console.log('🔄 Actualizando resumen de ingredientes en segundo plano...');

        // 🔧 CORRECCIÓN: Llamar directamente a las funciones SIN debounce
        const carroId = localStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');

        if (carroId && colaboradorData) {
            const colaborador = JSON.parse(colaboradorData);

            // Llamar directamente a obtenerResumenIngredientesCarro y mostrarResumenIngredientes
            // SIN pasar por actualizarResumenIngredientes (que tiene debounce)
            if (typeof window.obtenerResumenIngredientesCarro === 'function' &&
                typeof window.mostrarResumenIngredientes === 'function') {
                console.log('📊 Obteniendo ingredientes actualizados del servidor...');
                const ingredientes = await window.obtenerResumenIngredientesCarro(carroId, colaborador.id);
                console.log('📊 Ingredientes recibidos:', ingredientes.length);
                window.mostrarResumenIngredientes(ingredientes);
                console.log('✅ Resumen de ingredientes actualizado DIRECTAMENTE');
            }

            // También actualizar resumen de mixes DIRECTAMENTE
            if (typeof window.obtenerResumenMixesCarro === 'function' &&
                typeof window.mostrarResumenMixes === 'function') {
                console.log('🧪 Obteniendo mixes actualizados del servidor...');
                const mixes = await window.obtenerResumenMixesCarro(carroId, colaborador.id);
                console.log('🧪 Mixes recibidos:', mixes.length);
                window.mostrarResumenMixes(mixes);
                console.log('✅ Resumen de mixes actualizado DIRECTAMENTE');
            }
        }

        // Actualizar tabla de "Ingresos Manuales Realizados"
        if (typeof window.actualizarInformeIngresosManuales === 'function') {
            await window.actualizarInformeIngresosManuales();
            console.log('✅ Tabla de ingresos manuales actualizada');
        }

        // 7. Si el faltante llegó a 0, mostrar mensaje de completado
        if (estadoSustitucion.cantidadFaltante <= 0.01) {
            mostrarNotificacionModalExito('🎉 ¡Faltante completamente cubierto!');
            console.log('🎉 Faltante completamente cubierto');
        }

    } catch (error) {
        console.error('Error al confirmar sustitución:', error);
        mostrarMensajeValidacion(error.message, 'error');
    } finally {
        // Ocultar indicador de carga
        document.getElementById('sustitucion-loading').classList.remove('show');
    }
}

/**
 * Muestra una notificación de éxito DENTRO del modal
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarNotificacionModalExito(mensaje) {
    const modalBody = document.querySelector('.modal-sustitucion-body');
    if (!modalBody) return;

    const notification = document.createElement('div');
    notification.textContent = mensaje;
    notification.style.cssText = `
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #28a745;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-size: 13px;
        font-weight: 600;
        animation: slideDown 0.3s ease-out;
    `;

    modalBody.style.position = 'relative';
    modalBody.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 2500);
}

/**
 * Filtra la lista de ingredientes según el término de búsqueda
 */
function filtrarIngredientes() {
    const input = document.getElementById('sustitucion-buscar-origen');
    if (!input) return;

    const termino = input.value.toLowerCase().trim();

    if (!termino) {
        renderizarListaIngredientes(estadoSustitucion.ingredientesDisponibles);
        return;
    }

    const ingredientesFiltrados = estadoSustitucion.ingredientesDisponibles.filter(ing =>
        ing.nombre.toLowerCase().includes(termino)
    );

    renderizarListaIngredientes(ingredientesFiltrados);
}

/**
 * Muestra una notificación de éxito global
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
        padding: 15px 20px;
        border-radius: 4px;
        z-index: 10000;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
        font-size: 14px;
        line-height: 1.4;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 4000);
}

/**
 * Muestra un mensaje de error
 */
function mostrarError(mensaje) {
    const notification = document.createElement('div');
    notification.textContent = mensaje;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #dc3545;
        color: white;
        padding: 15px 20px;
        border-radius: 4px;
        z-index: 10000;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-size: 14px;
        line-height: 1.4;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

/**
 * Hace el modal draggable (movible)
 */
function hacerModalDraggable() {
    const modal = document.querySelector('.modal-sustitucion-content');
    const header = document.querySelector('.modal-sustitucion-header');

    if (!modal || !header) return;

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.style.cursor = 'move';

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        // No iniciar drag si se hace clic en el botón de cerrar
        if (e.target.classList.contains('close-modal') || e.target.closest('.close-modal')) {
            return;
        }

        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        isDragging = true;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();

            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, modal);
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;

        isDragging = false;
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(${xPos}px, ${yPos}px)`;
    }
}

/**
 * Usa el máximo stock disponible
 */
function usarMaximo() {
    if (!estadoSustitucion.ingredienteOrigen) {
        return;
    }

    const stockActual = estadoSustitucion.ingredienteOrigen.stock_actual;
    const input = document.getElementById('sustitucion-cantidad-input');

    input.value = stockActual.toFixed(2);
    validarCantidad();

    console.log(`✅ Cantidad establecida al máximo: ${stockActual.toFixed(2)}`);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔧 [SUSTITUCION] Inicializando event listeners...');

    // Botón confirmar
    const btnConfirmar = document.getElementById('sustitucion-btn-confirmar');
    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', confirmarSustitucion);
        console.log('✅ [SUSTITUCION] Listener de confirmar agregado');
    }

    // Botones cerrar modal - SOLO con botón X, NO con clic fuera
    const modal = document.getElementById('modal-sustitucion-ingredientes');
    if (modal) {
        // Asignar a todos los botones con clase close-modal (la X del header)
        const closeButtons = modal.querySelectorAll('.close-modal');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                cerrarModalSustitucion();
            });
        });
        console.log('✅ [SUSTITUCION] Listeners de cerrar agregados');

        // NO cerramos al hacer clic en el backdrop (fondo oscuro)
    }

    // Input de búsqueda
    const inputBusqueda = document.getElementById('sustitucion-buscar-origen');
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', filtrarIngredientes);
        console.log('✅ [SUSTITUCION] Listener de búsqueda agregado');
    }

    // Input de cantidad
    const inputCantidad = document.getElementById('sustitucion-cantidad-input');
    if (inputCantidad) {
        inputCantidad.addEventListener('input', validarCantidad);
        inputCantidad.addEventListener('change', validarCantidad);
        console.log('✅ [SUSTITUCION] Listeners de cantidad agregados');
    }

    // Hacer el modal draggable
    setTimeout(() => {
        hacerModalDraggable();
        console.log('✅ [SUSTITUCION] Modal configurado como draggable');
    }, 100);
});

// Exportar funciones para uso global
window.abrirModalSustitucion = abrirModalSustitucion;
window.usarMaximo = usarMaximo;
window.seleccionarIngredienteOrigen = seleccionarIngredienteOrigen;

console.log('✅ Módulo de sustitución de ingredientes cargado');