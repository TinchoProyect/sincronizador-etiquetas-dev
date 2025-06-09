// Función para actualizar la visibilidad de los botones según el estado del carro
export async function actualizarVisibilidadBotones() {
    const carroId = localStorage.getItem('carroActivo');
    const btnCarroPreparado = document.getElementById('carro-preparado');
    const btnFinalizarProduccion = document.getElementById('finalizar-produccion');
    const btnAgregarArticulo = document.getElementById('agregar-articulo');
    const btnImprimirEtiquetas = document.getElementById('imprimir-etiquetas');
    
    if (!carroId) {
        // No hay carro activo - ocultar todos los botones de acción
        if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
        if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
        if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
        if (btnImprimirEtiquetas) btnImprimirEtiquetas.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`/api/produccion/carro/${carroId}/estado`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Estado del carro:', data);

        // Manejar visibilidad según el estado
        switch (data.estado) {
            case 'en_preparacion':
                // Carro en preparación - mostrar botón de preparar y agregar artículos
                if (btnCarroPreparado) {
                    btnCarroPreparado.style.display = 'inline-block';
                    btnCarroPreparado.disabled = false;
                    btnCarroPreparado.textContent = 'Carro listo para producir';
                    btnCarroPreparado.classList.remove('procesando');
                }
                if (btnFinalizarProduccion) {
                    btnFinalizarProduccion.style.display = 'none';
                }
                if (btnAgregarArticulo) {
                    btnAgregarArticulo.style.display = 'inline-block';
                }
                break;

            case 'preparado':
                // Carro preparado - mostrar botón de finalizar, ocultar agregar artículos
                if (btnCarroPreparado) {
                    btnCarroPreparado.style.display = 'none';
                }
                if (btnFinalizarProduccion) {
                    btnFinalizarProduccion.style.display = 'inline-block';
                    btnFinalizarProduccion.disabled = false;
                    btnFinalizarProduccion.textContent = 'Asentar producción';
                    btnFinalizarProduccion.classList.remove('procesando');
                }
                if (btnAgregarArticulo) {
                    btnAgregarArticulo.style.display = 'none';
                }
                break;

            case 'confirmado':
                // Producción confirmada - mostrar solo el botón de imprimir etiquetas
                if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
                if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
                if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
                if (btnImprimirEtiquetas) btnImprimirEtiquetas.style.display = 'inline-block';
                break;

            default:
                console.warn('Estado de carro desconocido:', data.estado);
                // Por defecto, ocultar todos los botones
                if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
                if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
                if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
        }

    } catch (error) {
        console.error('Error al verificar estado del carro:', error);
        // En caso de error, ocultar todos los botones
        if (btnCarroPreparado) btnCarroPreparado.style.display = 'none';
        if (btnFinalizarProduccion) btnFinalizarProduccion.style.display = 'none';
        if (btnAgregarArticulo) btnAgregarArticulo.style.display = 'none';
    }
}

// Función para marcar un carro como preparado
export async function marcarCarroPreparado(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnCarroPreparado = document.getElementById('carro-preparado');
    if (!btnCarroPreparado) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnCarroPreparado.disabled = true;
        btnCarroPreparado.classList.add('procesando');
        btnCarroPreparado.textContent = 'Procesando...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }
        
        const response = await fetch(`/api/produccion/carro/${carroId}/preparado`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Carro marcado como preparado exitosamente');
        
        // Actualizar la visibilidad de los botones
        await actualizarVisibilidadBotones();
        
        // Actualizar el estado del carro en la interfaz si es necesario
        if (window.actualizarEstadoCarro) {
            window.actualizarEstadoCarro();
        }

    } catch (error) {
        console.error('Error al marcar carro como preparado:', error);
        btnCarroPreparado.disabled = false;
        btnCarroPreparado.classList.remove('procesando');
        btnCarroPreparado.textContent = 'Carro listo para producir';
        mostrarNotificacion(`Error: ${error.message}`, true);
    }
}

// Función para finalizar la producción de un carro
export async function finalizarProduccion(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnFinalizarProduccion = document.getElementById('finalizar-produccion');
    if (!btnFinalizarProduccion) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnFinalizarProduccion.disabled = true;
        btnFinalizarProduccion.classList.add('procesando');
        btnFinalizarProduccion.textContent = 'Procesando...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }
        
        const response = await fetch(`/api/produccion/carro/${carroId}/finalizar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Producción finalizada exitosamente');
        
        // Actualizar la visibilidad de los botones
        await actualizarVisibilidadBotones();
        
        // Actualizar el estado del carro en la interfaz si es necesario
        if (window.actualizarEstadoCarro) {
            window.actualizarEstadoCarro();
        }

    } catch (error) {
        console.error('Error al finalizar producción:', error);
        btnFinalizarProduccion.disabled = false;
        btnFinalizarProduccion.classList.remove('procesando');
        btnFinalizarProduccion.textContent = 'Asentar producción';
        mostrarNotificacion(`Error: ${error.message}`, true);
    }
}

// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, esError = false) {
    const notificacion = document.createElement('div');
    notificacion.className = esError ? 'preparado-error' : 'preparado-success';
    notificacion.textContent = mensaje;
    document.body.appendChild(notificacion);

    // Remover la notificación después de 3 segundos
    setTimeout(() => {
        notificacion.remove();
    }, 3000);
}

// Hacer disponibles las funciones globalmente
window.marcarCarroPreparado = marcarCarroPreparado;
window.finalizarProduccion = finalizarProduccion;

// Función para imprimir etiquetas del carro
export async function imprimirEtiquetasCarro(carroId) {
    if (!carroId) {
        console.error('No hay carro seleccionado');
        return;
    }

    const btnImprimirEtiquetas = document.getElementById('imprimir-etiquetas');
    if (!btnImprimirEtiquetas) return;

    try {
        // Deshabilitar el botón y mostrar estado de procesamiento
        btnImprimirEtiquetas.disabled = true;
        btnImprimirEtiquetas.classList.add('procesando');
        btnImprimirEtiquetas.textContent = 'Imprimiendo...';

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;
        
        if (!colaborador || !colaborador.id) {
            throw new Error('No se encontró información del colaborador activo');
        }

        // Obtener los artículos del carro para imprimir etiquetas
        const response = await fetch(`/api/produccion/carro/${carroId}/articulos-etiquetas`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        const articulos = await response.json();

        // Imprimir etiquetas para cada artículo según su cantidad
        for (const articulo of articulos) {
            const imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo: {
                        numero: articulo.articulo_numero,
                        nombre: articulo.descripcion,
                        codigo_barras: articulo.codigo_barras
                    },
                    cantidad: articulo.cantidad
                })
            });

            if (!imprimirResponse.ok) {
                throw new Error(`Error al imprimir etiqueta para ${articulo.descripcion}`);
            }
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Etiquetas impresas correctamente');

    } catch (error) {
        console.error('Error al imprimir etiquetas:', error);
        mostrarNotificacion(`Error: ${error.message}`, true);
    } finally {
        // Restaurar el botón
        if (btnImprimirEtiquetas) {
            btnImprimirEtiquetas.disabled = false;
            btnImprimirEtiquetas.classList.remove('procesando');
            btnImprimirEtiquetas.textContent = 'Imprimir etiquetas';
        }
    }
}

// Hacer disponibles las funciones globalmente
window.marcarCarroPreparado = marcarCarroPreparado;
window.finalizarProduccion = finalizarProduccion;
window.imprimirEtiquetasCarro = imprimirEtiquetasCarro;

// Mantener compatibilidad con el nombre anterior
export const actualizarVisibilidadBotonPreparado = actualizarVisibilidadBotones;
