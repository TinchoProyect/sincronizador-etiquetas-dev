/**
 * Modal Draggable - Funcionalidad de ventana arrastrable estilo Windows
 * Hace que los modales se comporten como ventanas de escritorio
 * VERSIÓN CORREGIDA: Backdrop estático + arrastre fluido con top/left
 */

class ModalDraggable {
    constructor(modalId) {
        this.modal = document.getElementById(modalId);
        if (!this.modal) {
            console.warn(`Modal ${modalId} no encontrado`);
            return;
        }

        this.modalContent = this.modal.querySelector('.modal-content');
        if (!this.modalContent) {
            console.warn(`Modal content no encontrado en ${modalId}`);
            return;
        }

        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.startTop = 0;
        this.startLeft = 0;

        this.init();
    }

    init() {
        // CRÍTICO: Permitir interacción y scroll con el fondo (Workspace) mientras el modal flota
        this.modal.style.pointerEvents = 'none';
        
        // Garantizar que el contenido del modal sí capture eventos
        this.modalContent.style.pointerEvents = 'auto';

        // Prevenir cierre con tecla ESC si el usuario está trabajando en el modal
        this.modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Configurar modal-content para posicionamiento absoluto
        this.modalContent.style.position = 'fixed';
        this.modalContent.style.margin = '0';
        
        // Buscar el header del modal (zona de arrastre)
        const header = this.modalContent.querySelector('.modal-header') || this.modalContent.querySelector('h2');
        if (header) {
            this.setupDraggable(header);
        }

        // Opcional: Hacer el modal redimensionable
        this.makeResizable();

        console.log(`✅ Modal ${this.modal.id} configurado como arrastrable (backdrop estático)`);
    }

    setupDraggable(dragHandle) {
        // Cambiar cursor para indicar que es arrastrable
        dragHandle.style.cursor = 'move';
        dragHandle.style.userSelect = 'none';

        // Event listeners para arrastre
        dragHandle.addEventListener('mousedown', this.onMouseDown.bind(this));
        
        // Los eventos de movimiento y soltar se agregan al document
        // para que funcionen incluso si el mouse sale del header
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
    }

    onMouseDown(e) {
        // Solo iniciar arrastre si se hace clic en el header o en sus hijos (excepto botones)
        if (!e.target.closest('.modal-header') && !e.target.closest('h2')) {
            return;
        }

        // No arrastrar si presiona un botón (como X para cerrar)
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('close-modal')) {
            return;
        }

        this.isDragging = true;
        
        // Cambiar cursor a grabbing
        document.body.style.cursor = 'grabbing';
        e.target.style.cursor = 'grabbing';
        
        // 🎯 Si el modal está centrado con transform: translate(-50%, -50%), hornear las coordenadas relativas a posiciones absolutas antes de arrastrar
        if (window.getComputedStyle(this.modalContent).transform !== 'none' || this.modalContent.style.transform.includes('translate')) {
            const rect = this.modalContent.getBoundingClientRect();
            this.modalContent.style.transform = 'none';
            this.modalContent.style.top = `${rect.top}px`;
            this.modalContent.style.left = `${rect.left}px`;
        }
        
        // Guardar posición inicial del mouse
        this.startX = e.clientX;
        this.startY = e.clientY;
        
        // Obtener posición actual del modal (ya con top/left absolutos correctos)
        const rect = this.modalContent.getBoundingClientRect();
        this.startTop = rect.top;
        this.startLeft = rect.left;
        
        // Deshabilitar transiciones durante el arrastre
        this.modalContent.style.transition = 'none';
        
        // Prevenir selección de texto
        e.preventDefault();
    }

    onMouseMove(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        
        // Calcular desplazamiento
        const deltaX = e.clientX - this.startX;
        const deltaY = e.clientY - this.startY;
        
        // Calcular nueva posición
        let newLeft = this.startLeft + deltaX;
        let newTop = this.startTop + deltaY;
        
        // Aplicar límites para mantener el modal dentro de la ventana
        const rect = this.modalContent.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Límite izquierdo
        newLeft = Math.max(0, newLeft);
        // Límite derecho (dejar al menos 100px visibles)
        newLeft = Math.min(viewportWidth - 100, newLeft);
        // Límite superior
        newTop = Math.max(0, newTop);
        // Límite inferior (dejar al menos 50px visibles)
        newTop = Math.min(viewportHeight - 50, newTop);
        
        // Aplicar nueva posición usando top y left
        this.modalContent.style.top = `${newTop}px`;
        this.modalContent.style.left = `${newLeft}px`;
    }

    onMouseUp(e) {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        
        // Restaurar cursor
        document.body.style.cursor = '';
        const header = this.modalContent.querySelector('h2');
        if (header) {
            header.style.cursor = 'move';
        }
        
        // Las transiciones no deben restaurarse para evitar que reglas CSS de transform intenten interpolar las coordenadas fijadas por JS
    }

    makeResizable() {
        // Agregar handle de redimensionamiento en la esquina inferior derecha
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'modal-resize-handle';
        resizeHandle.style.cssText = `
            position: absolute;
            bottom: 0;
            right: 0;
            width: 20px;
            height: 20px;
            cursor: nwse-resize;
            background: linear-gradient(135deg, transparent 50%, #007bff 50%);
            opacity: 0.5;
            transition: opacity 0.2s;
            z-index: 1001;
        `;

        resizeHandle.addEventListener('mouseenter', () => {
            resizeHandle.style.opacity = '1';
        });

        resizeHandle.addEventListener('mouseleave', () => {
            resizeHandle.style.opacity = '0.5';
        });

        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = this.modalContent.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const width = startWidth + (e.clientX - startX);
            const height = startHeight + (e.clientY - startY);

            // Limitar tamaño mínimo y máximo
            const minWidth = 600;
            const minHeight = 400;
            const maxWidth = window.innerWidth - 40;
            const maxHeight = window.innerHeight - 40;

            this.modalContent.style.width = `${Math.max(minWidth, Math.min(width, maxWidth))}px`;
            this.modalContent.style.height = `${Math.max(minHeight, Math.min(height, maxHeight))}px`;
            this.modalContent.style.maxWidth = 'none';
            this.modalContent.style.maxHeight = 'none';
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });

        this.modalContent.style.position = 'fixed';
        this.modalContent.appendChild(resizeHandle);

        console.log(`✅ Modal ${this.modal.id} configurado como redimensionable`);
    }

    centerModal() {
        // Centrar usando CSS puro para que se autoajuste si el contenido crece de forma asíncrona
        this.modalContent.style.top = '50%';
        this.modalContent.style.left = '50%';
        this.modalContent.style.transform = 'translate(-50%, -50%)';
    }

    reset() {
        // Resetear posición y tamaño
        this.modalContent.style.width = '';
        this.modalContent.style.height = '';
        this.modalContent.style.maxWidth = '';
        this.modalContent.style.maxHeight = '';
        
        // Centrar modal
        setTimeout(() => {
            this.centerModal();
        }, 50);
    }
}

// Inicializar modales arrastrables cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    // 🪟 Modales arrastrables instanciados
    const modalesParaArrastrar = ['modal-articulos', 'modal-editar-vinculo', 'modal-receta'];
    const instancias = {};

    modalesParaArrastrar.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) {
            instancias[id] = new ModalDraggable(id);
            
            // 🎯 PREVENCIÓN DE SCROLL CHAINING: Bloquear fondo, resetear offsets al abrir
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                        const styleDisplay = window.getComputedStyle(elemento).display;
                        const hasShowClass = elemento.classList.contains('show');
                        
                        if (styleDisplay === 'block' || styleDisplay === 'flex' || hasShowClass) {
                            // Detener dragchaining (Scroll inhabilitado globalmente)
                            document.body.style.overflow = 'hidden';
                            
                            // Resetear
                            if (instancias[id]) {
                                setTimeout(() => instancias[id].reset(), 100);
                            }
                        } else {
                            // Liberar scroll del monitor principal solo si todos los modales están cerrados
                            const anyOpen = modalesParaArrastrar.some(mId => {
                                const mEl = document.getElementById(mId);
                                return mEl && (mEl.style.display === 'block' || mEl.classList.contains('show'));
                            });
                            if (!anyOpen) {
                                document.body.style.overflow = '';
                            }
                        }
                    }
                });
            });

            observer.observe(elemento, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
    });

    console.log('✅ Sistema de modales arrastrables y Anti-ScrollChaining inicializado');
});

// Exportar para uso en otros módulos si es necesario
export { ModalDraggable };
