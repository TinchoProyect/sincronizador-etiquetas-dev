/**
 * RESIZER - Divisor Vertical Ajustable
 * Permite redimensionar las columnas izquierda y derecha arrastrando el divisor
 */

document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('resizer');
    const container = document.getElementById('workspace-container');
    
    if (!resizer || !container) {
        console.warn('Resizer: No se encontraron los elementos necesarios');
        return;
    }
    
    const leftPanel = container.querySelector('.workspace-left');
    const rightPanel = container.querySelector('.workspace-right');
    
    if (!leftPanel || !rightPanel) {
        console.warn('Resizer: No se encontraron los paneles');
        return;
    }
    
    let isResizing = false;
    let startX = 0;
    let startLeftWidth = 0;

    // Iniciar redimensionamiento
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startLeftWidth = leftPanel.offsetWidth;
        
        // Feedback visual
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        e.preventDefault();
    });

    // Redimensionar mientras se arrastra
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const newLeftWidth = startLeftWidth + deltaX;
        const containerWidth = container.offsetWidth;
        const minWidth = 300; // Ancho mínimo para cada panel
        const resizerWidth = 10;

        // Calcular ancho del panel derecho
        const newRightWidth = containerWidth - newLeftWidth - resizerWidth;

        // Validar anchos mínimos
        if (newLeftWidth >= minWidth && newRightWidth >= minWidth) {
            container.style.gridTemplateColumns = `${newLeftWidth}px ${resizerWidth}px 1fr`;
        }
    });

    // Finalizar redimensionamiento
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    // Prevenir selección de texto durante el arrastre
    resizer.addEventListener('selectstart', (e) => {
        e.preventDefault();
    });
});

/**
 * ACORDEONES - Toggle de secciones
 * Permite colapsar/expandir las secciones de resumen
 */
window.toggleSeccion = function(seccionId) {
    const seccion = document.getElementById(seccionId);
    if (!seccion) return;
    
    seccion.classList.toggle('collapsed');
};
