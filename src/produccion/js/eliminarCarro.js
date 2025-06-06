/**
 * Módulo especializado para la eliminación segura de carros desde el frontend
 * Maneja confirmaciones, validaciones y mensajes informativos
 */

import { mostrarError } from './utils.js';

/**
 * Obtiene información detallada sobre qué se eliminará con un carro
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Object>} Información de eliminación
 */
async function obtenerInformacionEliminacion(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/info-eliminacion?usuarioId=${usuarioId}`);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'No se pudo obtener información del carro');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error al obtener información de eliminación:', error);
        throw error;
    }
}

/**
 * Muestra un modal de confirmación con información detallada sobre la eliminación
 * @param {Object} infoEliminacion - Información sobre qué se eliminará
 * @returns {Promise<boolean>} true si el usuario confirma, false si cancela
 */
async function mostrarConfirmacionEliminacion(infoEliminacion) {
    return new Promise((resolve) => {
        // Crear modal de confirmación
        const modal = document.createElement('div');
        modal.className = 'modal-eliminacion-carro';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
        `;

        const contenido = document.createElement('div');
        contenido.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const { conteos, mensaje } = infoEliminacion;
        const tieneRegistros = conteos.ingredientes > 0 || conteos.stockVentas > 0;

        contenido.innerHTML = `
            <h3 style="color: #dc3545; margin-bottom: 20px;">
                ⚠️ Confirmar eliminación de carro
            </h3>
            <div style="margin-bottom: 20px; line-height: 1.6;">
                <p><strong>Carro ID:</strong> ${infoEliminacion.carroId}</p>
                <p><strong>Registros que se eliminarán:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>${conteos.articulos} artículos del carro</li>
                    <li>${conteos.ingredientes} movimientos de ingredientes</li>
                    <li>${conteos.stockVentas} movimientos de stock de ventas</li>
                </ul>
                ${tieneRegistros ? 
                    '<p style="color: #dc3545; font-weight: bold;">⚠️ ATENCIÓN: Esta acción eliminará permanentemente todos los registros relacionados.</p>' :
                    '<p style="color: #28a745;">✅ Este carro no tiene movimientos registrados.</p>'
                }
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancelar-eliminacion" style="
                    padding: 10px 20px;
                    border: 1px solid #6c757d;
                    background: white;
                    color: #6c757d;
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancelar</button>
                <button id="confirmar-eliminacion" style="
                    padding: 10px 20px;
                    border: none;
                    background: #dc3545;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                ">Eliminar definitivamente</button>
            </div>
        `;

        modal.appendChild(contenido);
        document.body.appendChild(modal);

        // Event listeners para los botones
        const btnCancelar = contenido.querySelector('#cancelar-eliminacion');
        const btnConfirmar = contenido.querySelector('#confirmar-eliminacion');

        btnCancelar.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(false);
        });

        btnConfirmar.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(true);
        });

        // Cerrar con ESC
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                document.removeEventListener('keydown', handleKeydown);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleKeydown);
    });
}

/**
 * Ejecuta la eliminación del carro en el backend
 * @param {number} carroId - ID del carro a eliminar
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Object>} Resultado de la eliminación
 */
async function ejecutarEliminacionCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}?usuarioId=${usuarioId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'No se pudo eliminar el carro');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al eliminar carro:', error);
        throw error;
    }
}

/**
 * Muestra el resultado de la eliminación al usuario
 * @param {Object} resultado - Resultado de la eliminación
 */
function mostrarResultadoEliminacion(resultado) {
    const notification = document.createElement('div');
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
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        font-family: Arial, sans-serif;
        line-height: 1.4;
    `;
    
    notification.innerHTML = `
        <strong>✅ Carro eliminado exitosamente</strong><br>
        <small>${resultado.mensaje}</small>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.transition = 'opacity 0.3s ease-out';
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 4000);
}

/**
 * Función principal para eliminar un carro con confirmación y validaciones
 * @param {number} carroId - ID del carro a eliminar
 * @param {Function} onSuccess - Callback a ejecutar después de eliminación exitosa
 */
export async function eliminarCarroConConfirmacion(carroId, onSuccess = null) {
    try {
        // Obtener datos del colaborador activo
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);

        // Mostrar indicador de carga
        const loadingIndicator = document.createElement('div');
        loadingIndicator.textContent = 'Obteniendo información del carro...';
        loadingIndicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            z-index: 9999;
        `;
        document.body.appendChild(loadingIndicator);

        try {
            // Obtener información sobre qué se eliminará
            const infoEliminacion = await obtenerInformacionEliminacion(carroId, colaborador.id);
            
            // Remover indicador de carga
            document.body.removeChild(loadingIndicator);

            // Mostrar confirmación al usuario
            const confirmado = await mostrarConfirmacionEliminacion(infoEliminacion);
            
            if (!confirmado) {
                return; // Usuario canceló
            }

            // Mostrar nuevo indicador de carga para la eliminación
            const deletingIndicator = document.createElement('div');
            deletingIndicator.textContent = 'Eliminando carro...';
            deletingIndicator.style.cssText = loadingIndicator.style.cssText;
            document.body.appendChild(deletingIndicator);

            try {
                // Ejecutar eliminación
                const resultado = await ejecutarEliminacionCarro(carroId, colaborador.id);
                
                // Remover indicador de carga
                document.body.removeChild(deletingIndicator);

                // Mostrar resultado exitoso
                mostrarResultadoEliminacion(resultado);

                // Ejecutar callback de éxito si se proporcionó
                if (onSuccess && typeof onSuccess === 'function') {
                    onSuccess(resultado);
                }

            } catch (error) {
                document.body.removeChild(deletingIndicator);
                throw error;
            }

        } catch (error) {
            if (loadingIndicator.parentNode) {
                document.body.removeChild(loadingIndicator);
            }
            throw error;
        }

    } catch (error) {
        console.error('Error en proceso de eliminación:', error);
        mostrarError(`Error al eliminar carro: ${error.message}`);
    }
}

/**
 * Función de utilidad para limpiar el carro activo si fue eliminado
 * @param {number} carroIdEliminado - ID del carro que fue eliminado
 */
export function limpiarCarroActivoSiEliminado(carroIdEliminado) {
    const carroActivo = localStorage.getItem('carroActivo');
    if (carroActivo === carroIdEliminado.toString()) {
        localStorage.removeItem('carroActivo');
        
        // Limpiar interfaz
        const listaArticulos = document.getElementById('lista-articulos');
        if (listaArticulos) {
            listaArticulos.innerHTML = '<p>No hay carro activo</p>';
        }
        
        // Limpiar resumen de ingredientes
        const contenedorIngredientes = document.getElementById('tabla-resumen-ingredientes');
        if (contenedorIngredientes) {
            contenedorIngredientes.innerHTML = '<p>No hay carro activo</p>';
        }
        
        // Limpiar resumen de mixes
        const contenedorMixes = document.getElementById('tabla-resumen-mixes');
        if (contenedorMixes) {
            contenedorMixes.innerHTML = '<p>No hay carro activo</p>';
        }
    }
}
