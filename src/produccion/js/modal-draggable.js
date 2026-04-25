/**
 * Modal Draggable - Funcionalidad de ventana arrastrable estilo Windows
 * Hace que los modales se comporten como ventanas de escritorio
 * VERSIÓN CORREGIDA: Backdrop estático + arrastre fluido con top/left
 */

class ModalDraggable {
    constructor(modalId, persistState = false) {
        this.modalId = modalId;
        this.persistState = persistState;
        this.modalStorageKey = `LAMDA_MODAL_STATE_${modalId}`;

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
        
        const rect = this.modalContent.getBoundingClientRect();
        
        // Calcular offset interno estricto (coordenada de clic relatiivo al borde superior izquierdo del modal)
        this.offsetX = e.clientX - rect.left;
        this.offsetY = e.clientY - rect.top;

        // Limpiar cualquier regla CSS limitante y anclar top/left a la vista gráfica absoluta actual
        this.modalContent.style.margin = '0';
        this.modalContent.style.transform = 'none';
        this.modalContent.style.position = 'fixed';
        this.modalContent.style.top = `${e.clientY - this.offsetY}px`;
        this.modalContent.style.left = `${e.clientX - this.offsetX}px`;
        
        // Deshabilitar transiciones durante el arrastre
        this.modalContent.style.transition = 'none';
        
        // Prevenir selección de texto
        e.preventDefault();
    }

    onMouseMove(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        
        if (this.dragRafId) cancelAnimationFrame(this.dragRafId);

        this.dragRafId = requestAnimationFrame(() => {
            let newLeft = e.clientX - this.offsetX;
            let newTop = e.clientY - this.offsetY;
            
            // Aplicar límites para mantener el modal dentro de la ventana
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            newLeft = Math.max(0, Math.min(viewportWidth - 100, newLeft));
            newTop = Math.max(0, Math.min(viewportHeight - 50, newTop));
            
            // Aplicar nueva posición usando top y left
            this.modalContent.style.top = `${newTop}px`;
            this.modalContent.style.left = `${newLeft}px`;
        });
    }

    onMouseUp(e) {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        
        // Restaurar cursor
        document.body.style.cursor = '';
        const header = this.modalContent.querySelector('.modal-header') || this.modalContent.querySelector('h2');
        if (header) {
            header.style.cursor = 'move';
        }
        
        if (this.persistState) {
            this.saveState();
        }
    }

    makeResizable() {
        const bSize = 8; // Grosor de las zonas sensibles de los bordes
        const directions = [
            { class: 'r-n', cursor: 'ns-resize', style: `top: -${bSize/2}px; left: 0; width: 100%; height: ${bSize}px;` },
            { class: 'r-s', cursor: 'ns-resize', style: `bottom: -${bSize/2}px; left: 0; width: 100%; height: ${bSize}px;` },
            { class: 'r-e', cursor: 'ew-resize', style: `top: 0; right: -${bSize/2}px; width: ${bSize}px; height: 100%;` },
            { class: 'r-w', cursor: 'ew-resize', style: `top: 0; left: -${bSize/2}px; width: ${bSize}px; height: 100%;` },
            { class: 'r-ne', cursor: 'nesw-resize', style: `top: -${bSize/2}px; right: -${bSize/2}px; width: ${bSize*2}px; height: ${bSize*2}px;` },
            { class: 'r-nw', cursor: 'nwse-resize', style: `top: -${bSize/2}px; left: -${bSize/2}px; width: ${bSize*2}px; height: ${bSize*2}px;` },
            { class: 'r-se', cursor: 'nwse-resize', style: `bottom: -${bSize/2}px; right: -${bSize/2}px; width: ${bSize*2}px; height: ${bSize*2}px;` },
            { class: 'r-sw', cursor: 'nesw-resize', style: `bottom: -${bSize/2}px; left: -${bSize/2}px; width: ${bSize*2}px; height: ${bSize*2}px;` }
        ];

        let isResizing = false;
        let currentDir = '';
        let startX, startY, startW, startH, startTop, startLeft;

        directions.forEach(dir => {
            const handle = document.createElement('div');
            handle.style.cssText = `position: absolute; ${dir.style} cursor: ${dir.cursor}; z-index: 1001; background: transparent;`;
            
            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                currentDir = dir.class;
                startX = e.clientX;
                startY = e.clientY;
                const rect = this.modalContent.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                startTop = rect.top;
                startLeft = rect.left;
                
                // Asegurar modo fixed y eliminar interferencias (auto-centro o márgenes) al momento del click
                this.modalContent.style.margin = '0';
                this.modalContent.style.transform = 'none';
                this.modalContent.style.top = `${startTop}px`;
                this.modalContent.style.left = `${startLeft}px`;
                
                e.preventDefault();
                e.stopPropagation();
            });
            this.modalContent.appendChild(handle);
        });

        let rafId = null;

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Bloquea transiciones CSS para evitar retardo/lag durante el resize
            this.modalContent.style.transition = 'none';

            if (rafId) cancelAnimationFrame(rafId);

            rafId = requestAnimationFrame(() => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                let finalW = startW, finalH = startH, finalT = startTop, finalL = startLeft;
                const minW = 350, minH = 200;

                const isVertical = currentDir.includes('n') || currentDir.includes('s');
                const isHorizontal = currentDir.includes('e') || currentDir.includes('w');

                if (currentDir.includes('e')) finalW = Math.max(minW, startW + dx);
                if (currentDir.includes('s')) finalH = Math.max(minH, startH + dy);
                
                if (currentDir.includes('w')) {
                    finalW = Math.max(minW, startW - dx);
                    if (finalW > minW) finalL = startLeft + dx;
                }
                if (currentDir.includes('n')) {
                    finalH = Math.max(minH, startH - dy);
                    if (finalH > minH) finalT = startTop + dy;
                }

                if (isHorizontal) {
                    this.modalContent.style.width = `${finalW}px`;
                    this.modalContent.style.left = `${finalL}px`;
                    this.modalContent.style.maxWidth = 'none';
                }
                if (isVertical) {
                    this.modalContent.style.height = `${finalH}px`;
                    this.modalContent.style.top = `${finalT}px`;
                    this.modalContent.style.maxHeight = 'none';
                }
            });
        });

        document.addEventListener('mouseup', () => {
            if (isResizing && this.persistState) this.saveState();
            isResizing = false;
        });

        console.log(`✅ Modal ${this.modalId} re-configurado con motor Resizable Perimetral (360°)`);
    }

    centerModal() {
        // Centrar usando CSS puro para que se autoajuste si el contenido crece de forma asíncrona
        this.modalContent.style.top = '50%';
        this.modalContent.style.left = '50%';
        this.modalContent.style.transform = 'translate(-50%, -50%)';
    }

    saveState() {
        const state = {
            top: this.modalContent.style.top,
            left: this.modalContent.style.left,
            width: this.modalContent.style.width,
            height: this.modalContent.style.height,
            transform: this.modalContent.style.transform
        };
        localStorage.setItem(this.modalStorageKey, JSON.stringify(state));
    }

    loadState() {
        if (!this.persistState) return false;
        const stateRaw = localStorage.getItem(this.modalStorageKey);
        if (!stateRaw) return false;
        try {
            const state = JSON.parse(stateRaw);
            if (state.top) this.modalContent.style.top = state.top;
            if (state.left) this.modalContent.style.left = state.left;
            if (state.width) this.modalContent.style.width = state.width;
            if (state.height) this.modalContent.style.height = state.height;
            if (state.transform !== undefined) this.modalContent.style.transform = state.transform;
            return true;
        } catch (e) {
            console.error("Fallo aplicando caché visual del modal", e);
            return false;
        }
    }

    reset() {
        if (this.persistState) {
            const fueCargado = this.loadState();
            if (fueCargado) return; // Rompe la cadena si el localStorage suplió la data
        }
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
    const modalesParaArrastrar = ['modal-articulos', 'modal-editar-vinculo', 'modal-receta', 'modalAbastecimientoExterno'];
    const instancias = {};

    modalesParaArrastrar.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) {
            // Se habilita la persistencia dimensional y de posición para todos
            instancias[id] = new ModalDraggable(id, true);
            
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
