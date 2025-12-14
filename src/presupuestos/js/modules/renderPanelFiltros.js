/**
 * Módulo de Renderizado del Panel de Filtros
 * Genera el HTML dinámico del panel según el modo (plano o jerárquico)
 */

console.log('🎨 [RENDER-PANEL] Cargando módulo de renderizado...');

/**
 * Renderizar panel de filtros completo
 * @param {Object} estructura - Estructura de rubros (plana o jerárquica)
 * @param {string} modo - 'plano' o 'jerarquico'
 * @param {Function} onToggleVisibilidad - Callback para toggle de visibilidad
 * @param {Function} onReordenar - Callback para reordenamiento
 * @returns {string} HTML del panel
 */
function renderizarPanelFiltros(estructura, modo, onToggleVisibilidad, onReordenar) {
    if (!estructura || Object.keys(estructura).length === 0) {
        return `
            <div class="filtro-empty">
                No hay rubros para filtrar
            </div>
        `;
    }
    
    if (modo === 'plano') {
        return renderizarPanelPlano(estructura, onToggleVisibilidad, onReordenar);
    } else {
        return renderizarPanelJerarquico(estructura, onToggleVisibilidad, onReordenar);
    }
}

/**
 * Renderizar panel en modo plano (solo rubros)
 */
function renderizarPanelPlano(estructura, onToggleVisibilidad, onReordenar) {
    console.log('🎨 [RENDER-PANEL] Renderizando modo PLANO');
    
    // Ordenar rubros por su orden actual
    const rubrosOrdenados = Object.entries(estructura)
        .sort((a, b) => a[1].orden - b[1].orden);
    
    let html = `
        <div style="margin-bottom: 10px; padding: 8px; background: #e8f4f8; border-radius: 4px; font-size: 0.85em; color: #666;">
            <strong>💡 Tip:</strong> Arrastra los rubros para reordenarlos
        </div>
        <div id="filtros-rubros-plano" class="filtros-container">
    `;
    
    rubrosOrdenados.forEach(([rubro, data]) => {
        const checked = data.visible ? 'checked' : '';
        const rubroEscapado = rubro.replace(/'/g, "\\'");
        
        html += `
            <div class="filtro-item" 
                 draggable="true" 
                 data-rubro="${rubroEscapado}"
                 data-modo="plano">
                <span class="filtro-item-drag-handle">⋮⋮</span>
                <input type="checkbox" 
                       ${checked}
                       onchange="window.handleToggleRubro('${rubroEscapado}', null)"
                       onclick="event.stopPropagation()">
                <span class="filtro-item-label">${rubro}</span>
            </div>
        `;
    });
    
    html += `
        </div>
    `;
    
    return html;
}

/**
 * Renderizar panel en modo jerárquico (meses → rubros)
 */
function renderizarPanelJerarquico(estructura, onToggleVisibilidad, onReordenar) {
    console.log('🎨 [RENDER-PANEL] Renderizando modo JERÁRQUICO');
    
    // Ordenar meses por su orden
    const mesesOrdenados = Object.entries(estructura)
        .sort((a, b) => a[1].orden - b[1].orden);
    
    let html = `
        <div style="margin-bottom: 10px; padding: 8px; background: #e8f4f8; border-radius: 4px; font-size: 0.85em; color: #666;">
            <strong>💡 Tip:</strong> Arrastra rubros dentro de cada mes para reordenarlos
        </div>
    `;
    
    mesesOrdenados.forEach(([mesKey, mesData]) => {
        const mesChecked = mesData.visible ? 'checked' : '';
        const mesKeyEscapado = mesKey.replace(/'/g, "\\'");
        
        // ✅ FIX: Icono especial para "Más de 6 meses"
        const iconoMes = mesKey === 'historico' ? '📦' : '📅';
        
        html += `
            <div class="filtro-mes">
                <div class="filtro-mes-header" style="${mesKey === 'historico' ? 'background: #7f8c8d;' : ''}">
                    <input type="checkbox" 
                           ${mesChecked}
                           onchange="window.handleToggleMes('${mesKeyEscapado}')"
                           onclick="event.stopPropagation()">
                    <span>${iconoMes} ${mesData.nombre}</span>
                </div>
                <div class="filtro-mes-rubros" id="filtros-mes-${mesKey}" data-mes-key="${mesKeyEscapado}">
        `;
        
        // Ordenar rubros dentro del mes
        const rubrosOrdenados = Object.entries(mesData.rubros)
            .sort((a, b) => a[1].orden - b[1].orden);
        
        rubrosOrdenados.forEach(([rubro, rubroData]) => {
            const checked = rubroData.visible ? 'checked' : '';
            const rubroEscapado = rubro.replace(/'/g, "\\'");
            
            html += `
                <div class="filtro-item" 
                     draggable="true" 
                     data-rubro="${rubroEscapado}"
                     data-mes-key="${mesKeyEscapado}"
                     data-modo="jerarquico">
                    <span class="filtro-item-drag-handle">⋮⋮</span>
                    <input type="checkbox" 
                           ${checked}
                           onchange="window.handleToggleRubro('${rubroEscapado}', '${mesKeyEscapado}')"
                           onclick="event.stopPropagation()">
                    <span class="filtro-item-label">${rubro}</span>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    return html;
}

/**
 * Actualizar panel de filtros en el DOM
 */
function actualizarPanelFiltros(estructura, modo) {
    const contenedor = document.getElementById('panel-filtros-rubros');
    
    if (!contenedor) {
        console.warn('⚠️ [RENDER-PANEL] Contenedor no encontrado');
        return;
    }
    
    const html = renderizarPanelFiltros(
        estructura, 
        modo,
        null, // Los callbacks se manejan via window.handleXXX
        null
    );
    
    contenedor.innerHTML = html;
    
    console.log(`✅ [RENDER-PANEL] Panel actualizado (modo: ${modo})`);
}

console.log('✅ [RENDER-PANEL] Módulo cargado correctamente');

// Exportar funciones
export {
    renderizarPanelFiltros,
    actualizarPanelFiltros
};
