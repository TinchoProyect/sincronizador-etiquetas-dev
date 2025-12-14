/**
 * Módulo de Drag & Drop para Reordenamiento de Rubros
 * Implementa drag & drop nativo HTML5 para reordenar elementos
 */

console.log('🎯 [DRAG-DROP] Cargando módulo de drag & drop...');

/**
 * Estado del drag actual
 */
let dragState = {
    elementoArrastrado: null,
    contenedorOrigen: null,
    indexOrigen: null,
    mesKey: null
};

/**
 * Inicializar drag & drop en un contenedor
 * @param {HTMLElement} contenedor - Contenedor con elementos draggables
 * @param {Function} onReorder - Callback cuando se reordena (rubro1, rubro2, mesKey)
 */
function inicializarDragDrop(contenedor, onReorder) {
    if (!contenedor) {
        console.warn('⚠️ [DRAG-DROP] Contenedor no encontrado');
        return;
    }
    
    const items = contenedor.querySelectorAll('[draggable="true"]');
    
    items.forEach(item => {
        // Eventos de drag
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        
        // Eventos de drop
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', (e) => handleDrop(e, onReorder));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
    
    console.log(`✅ [DRAG-DROP] Inicializado en ${items.length} elementos`);
}

/**
 * Handler: Inicio del arrastre
 */
function handleDragStart(e) {
    dragState.elementoArrastrado = e.target;
    dragState.contenedorOrigen = e.target.parentElement;
    dragState.mesKey = e.target.dataset.mesKey || null;
    
    e.target.classList.add('dragging');
    e.target.style.opacity = '0.4';
    
    // Configurar datos de transferencia
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
    
    console.log(`🎯 [DRAG-DROP] Arrastrando: ${e.target.dataset.rubro}`);
}

/**
 * Handler: Fin del arrastre
 */
function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    e.target.style.opacity = '1';
    
    // Limpiar estilos de todos los elementos
    document.querySelectorAll('.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    console.log(`✅ [DRAG-DROP] Arrastre finalizado`);
}

/**
 * Handler: Elemento sobre zona de drop
 */
function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    
    e.dataTransfer.dropEffect = 'move';
    return false;
}

/**
 * Handler: Entrada a zona de drop
 */
function handleDragEnter(e) {
    const target = e.target.closest('[draggable="true"]');
    if (target && target !== dragState.elementoArrastrado) {
        // Verificar si están en el mismo contenedor (mismo mes)
        if (target.parentElement === dragState.contenedorOrigen) {
            target.classList.add('drag-over');
        }
    }
}

/**
 * Handler: Salida de zona de drop
 */
function handleDragLeave(e) {
    const target = e.target.closest('[draggable="true"]');
    if (target) {
        target.classList.remove('drag-over');
    }
}

/**
 * Handler: Drop del elemento
 */
function handleDrop(e, onReorder) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    e.preventDefault();
    
    const target = e.target.closest('[draggable="true"]');
    
    if (!target || target === dragState.elementoArrastrado) {
        return false;
    }
    
    // Verificar que estén en el mismo contenedor (mismo mes)
    if (target.parentElement !== dragState.contenedorOrigen) {
        console.warn('⚠️ [DRAG-DROP] No se puede mover entre diferentes meses');
        return false;
    }
    
    // Obtener rubros
    const rubro1 = dragState.elementoArrastrado.dataset.rubro;
    const rubro2 = target.dataset.rubro;
    const mesKey = dragState.mesKey;
    
    console.log(`🔄 [DRAG-DROP] Drop: ${rubro1} → ${rubro2} (Mes: ${mesKey || 'N/A'})`);
    
    // Intercambiar visualmente
    const contenedor = target.parentElement;
    const todosItems = Array.from(contenedor.children);
    const indexTarget = todosItems.indexOf(target);
    const indexDragged = todosItems.indexOf(dragState.elementoArrastrado);
    
    if (indexDragged < indexTarget) {
        target.parentNode.insertBefore(dragState.elementoArrastrado, target.nextSibling);
    } else {
        target.parentNode.insertBefore(dragState.elementoArrastrado, target);
    }
    
    // Llamar callback para actualizar estado
    if (onReorder) {
        onReorder(rubro1, rubro2, mesKey);
    }
    
    target.classList.remove('drag-over');
    
    return false;
}

/**
 * Limpiar event listeners de un contenedor
 */
function limpiarDragDrop(contenedor) {
    if (!contenedor) return;
    
    const items = contenedor.querySelectorAll('[draggable="true"]');
    
    items.forEach(item => {
        item.removeEventListener('dragstart', handleDragStart);
        item.removeEventListener('dragend', handleDragEnd);
        item.removeEventListener('dragover', handleDragOver);
        item.removeEventListener('drop', handleDrop);
        item.removeEventListener('dragenter', handleDragEnter);
        item.removeEventListener('dragleave', handleDragLeave);
    });
    
    console.log(`🧹 [DRAG-DROP] Limpiado ${items.length} elementos`);
}

/**
 * Reinicializar drag & drop (útil después de re-renderizar)
 */
function reinicializarDragDrop(contenedor, onReorder) {
    limpiarDragDrop(contenedor);
    inicializarDragDrop(contenedor, onReorder);
}

console.log('✅ [DRAG-DROP] Módulo cargado correctamente');

// Exportar funciones
export {
    inicializarDragDrop,
    limpiarDragDrop,
    reinicializarDragDrop
};
