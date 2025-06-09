import { eliminarCarroConConfirmacion, limpiarCarroActivoSiEliminado } from './eliminarCarro.js';

/**
 * Inicializa los manejadores de eventos para la interfaz de carros
 */
document.addEventListener('DOMContentLoaded', () => {
    // Buscar botones de eliminación existentes
    const botonesEliminar = document.querySelectorAll('[data-accion="eliminar-carro"]');
    botonesEliminar.forEach(boton => {
        configurarBotonEliminar(boton);
    });
});

/**
 * Configura el manejador de eventos para un botón de eliminación
 * @param {HTMLElement} boton - Elemento del botón a configurar
 */
function configurarBotonEliminar(boton) {
    boton.addEventListener('click', async (e) => {
        e.preventDefault();
        const carroId = boton.dataset.carroId;
        if (!carroId) {
            console.error('No se encontró el ID del carro');
            return;
        }

        try {
            // Ejecutar eliminación con confirmación
            await eliminarCarroConConfirmacion(parseInt(carroId), () => {
                // Callback de éxito: eliminar fila de la tabla y limpiar carro activo si corresponde
                const fila = boton.closest('tr');
                if (fila) {
                    fila.remove();
                }
                limpiarCarroActivoSiEliminado(parseInt(carroId));
            });
        } catch (error) {
            console.error('Error al eliminar carro:', error);
        }
    });
}

/**
 * Agrega el manejador de eventos a un nuevo botón de eliminación
 * @param {HTMLElement} nuevoBoton - Nuevo botón de eliminación agregado dinámicamente
 */
export function agregarManejadorEliminar(nuevoBoton) {
    configurarBotonEliminar(nuevoBoton);
}
