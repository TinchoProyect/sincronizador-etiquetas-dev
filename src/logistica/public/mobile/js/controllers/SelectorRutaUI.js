// --- SelectorRutaUI.js ---
// Módulo para gestionar la selección de múltiples hojas de ruta activas

/**
 * Renderiza el selector de rutas en el header de la aplicación.
 * Muestra el dropdown con las rutas disponibles y el botón de creación rápida.
 */
function renderizarSelectorRuta() {
    const selectorContainer = document.getElementById('selector-ruta-container');
    
    // Si el contenedor no existe en el DOM, no hacemos nada (por ejemplo, si no estamos en la tab de ruta)
    if (!selectorContainer) return;

    // Obtener las rutas disponibles del estado global
    const rutas = state.rutasDisponibles || [];
    
    // Identificar cuál es la ruta actualmente seleccionada (activa en pantalla)
    const activeId = state.ruta ? parseInt(state.ruta.id) : null;

    if (rutas.length === 0) {
        // No hay rutas en absoluto. Limpiamos el contenedor (el empty state principal ya tiene su botón)
        selectorContainer.innerHTML = '';
        return;
    }

    // Construir las opciones del <select>
    const optionsHTML = rutas.map(r => {
        const isSelected = activeId === parseInt(r.id) ? 'selected' : '';
        const icon = r.estado === 'EN_CAMINO' ? '🟢' : '🟡'; // Verde para en camino, amarillo para armando
        return `<option value="${r.id}" ${isSelected}>${icon} ${r.nombre_ruta} (${r.total_entregas} pedidos)</option>`;
    }).join('');

    // HTML del Context Switcher y el botón "+" permanentemente accesible
    const switcherHTML = `
        <div style="display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 5px;">
            <div style="position: relative; flex: 1;">
                <select id="select-ruta-activa" 
                        onchange="cambiarRutaSeleccionada(this.value)"
                        style="width: 100%; padding: 8px 30px 8px 10px; font-size: 0.9rem; font-weight: bold; background-color: #f8fafc; color: #1e3a8a; border: 1px solid #cbd5e1; border-radius: 6px; appearance: none; outline: none; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                    ${optionsHTML}
                </select>
                <div style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #64748b; font-size: 0.8rem;">▼</div>
            </div>
            <button onclick="abrirModalNuevaRuta()" 
                    title="Crear Nueva Ruta"
                    style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background-color: #2563eb; color: white; border: none; border-radius: 6px; font-size: 1.2rem; cursor: pointer; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
                ➕
            </button>
        </div>
    `;

    selectorContainer.innerHTML = switcherHTML;
}

/**
 * Event Handler: Llamado cuando el usuario cambia la opción en el dropdown.
 * Desencadena la recarga completa del DOM para la nueva ruta.
 * 
 * @param {string} newRouteIdStr - El ID de la ruta seleccionada (como string desde el value del select)
 */
function cambiarRutaSeleccionada(newRouteIdStr) {
    const newRouteId = parseInt(newRouteIdStr);
    if (!newRouteId || isNaN(newRouteId)) return;
    
    console.log(`[SELECTOR] Cambiando contexto a Ruta ID: ${newRouteId}`);
    
    // Forzar la carga de esta ruta específica puenteando la auto-prioridad
    cargarRutaActiva(newRouteId);
}
