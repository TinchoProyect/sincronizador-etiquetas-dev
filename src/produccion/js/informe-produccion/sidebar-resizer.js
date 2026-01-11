/**
 * ============================================================================
 * MÓDULO: SIDEBAR RESIZER
 * ============================================================================
 * 
 * Funcionalidad para redimensionar y colapsar el sidebar del informe.
 * Permite al usuario ajustar el ancho del panel de configuración
 * arrastrando el borde derecho, y guardar sus preferencias.
 * 
 * Características:
 * - Redimensionamiento por arrastre del mouse
 * - Colapsar/expandir con botón
 * - Guardar preferencias en localStorage
 * - Límites mínimo y máximo de ancho
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

class SidebarResizer {
    constructor() {
        this.sidebar = null;
        this.resizer = null;
        this.toggleBtn = null;
        this.isResizing = false;
        this.isCollapsed = false;
        this.currentWidth = 320; // Ancho por defecto
        this.minWidth = 250;
        this.maxWidth = 600;
        
        // Clave para localStorage
        this.storageKey = 'informe-produccion-sidebar-width';
        this.collapsedKey = 'informe-produccion-sidebar-collapsed';
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('📐 [SIDEBAR-RESIZER] Inicializando módulo...');
        
        // Obtener elementos del DOM
        this.sidebar = document.querySelector('.sidebar');
        this.resizer = document.querySelector('.sidebar-resizer');
        this.toggleBtn = document.querySelector('.sidebar-toggle');
        
        if (!this.sidebar || !this.resizer || !this.toggleBtn) {
            console.error('❌ [SIDEBAR-RESIZER] No se encontraron elementos necesarios');
            return;
        }
        
        // Cargar preferencias guardadas
        this.loadPreferences();
        
        // Configurar event listeners
        this.setupEventListeners();
        
        console.log('✅ [SIDEBAR-RESIZER] Módulo inicializado correctamente');
    }

    /**
     * Configurar event listeners
     */
    setupEventListeners() {
        // Eventos de redimensionamiento
        this.resizer.addEventListener('mousedown', (e) => this.startResize(e));
        document.addEventListener('mousemove', (e) => this.resize(e));
        document.addEventListener('mouseup', () => this.stopResize());
        
        // Evento de colapsar/expandir
        this.toggleBtn.addEventListener('click', () => this.toggleCollapse());
        
        console.log('✅ [SIDEBAR-RESIZER] Event listeners configurados');
    }

    /**
     * Iniciar redimensionamiento
     */
    startResize(e) {
        if (this.isCollapsed) return;
        
        this.isResizing = true;
        this.resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        console.log('📐 [SIDEBAR-RESIZER] Iniciando redimensionamiento');
    }

    /**
     * Redimensionar sidebar
     */
    resize(e) {
        if (!this.isResizing) return;
        
        const newWidth = e.clientX;
        
        // Aplicar límites
        if (newWidth >= this.minWidth && newWidth <= this.maxWidth) {
            this.currentWidth = newWidth;
            this.sidebar.style.width = `${newWidth}px`;
        }
    }

    /**
     * Detener redimensionamiento
     */
    stopResize() {
        if (!this.isResizing) return;
        
        this.isResizing = false;
        this.resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Guardar preferencia
        this.savePreferences();
        
        console.log(`📐 [SIDEBAR-RESIZER] Redimensionamiento finalizado: ${this.currentWidth}px`);
    }

    /**
     * Alternar estado colapsado/expandido
     */
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        
        if (this.isCollapsed) {
            this.sidebar.classList.add('collapsed');
            this.toggleBtn.innerHTML = '▶';
            console.log('📐 [SIDEBAR-RESIZER] Sidebar colapsado');
        } else {
            this.sidebar.classList.remove('collapsed');
            this.toggleBtn.innerHTML = '◀';
            console.log('📐 [SIDEBAR-RESIZER] Sidebar expandido');
        }
        
        // Guardar preferencia
        this.savePreferences();
    }

    /**
     * Guardar preferencias en localStorage
     */
    savePreferences() {
        try {
            localStorage.setItem(this.storageKey, this.currentWidth.toString());
            localStorage.setItem(this.collapsedKey, this.isCollapsed.toString());
            console.log('💾 [SIDEBAR-RESIZER] Preferencias guardadas');
        } catch (error) {
            console.error('❌ [SIDEBAR-RESIZER] Error al guardar preferencias:', error);
        }
    }

    /**
     * Cargar preferencias desde localStorage
     */
    loadPreferences() {
        try {
            // Cargar ancho
            const savedWidth = localStorage.getItem(this.storageKey);
            if (savedWidth) {
                this.currentWidth = parseInt(savedWidth);
                this.sidebar.style.width = `${this.currentWidth}px`;
            }
            
            // Cargar estado colapsado
            const savedCollapsed = localStorage.getItem(this.collapsedKey);
            if (savedCollapsed === 'true') {
                this.isCollapsed = true;
                this.sidebar.classList.add('collapsed');
                this.toggleBtn.innerHTML = '▶';
            } else {
                this.toggleBtn.innerHTML = '◀';
            }
            
            console.log('💾 [SIDEBAR-RESIZER] Preferencias cargadas:', {
                width: this.currentWidth,
                collapsed: this.isCollapsed
            });
        } catch (error) {
            console.error('❌ [SIDEBAR-RESIZER] Error al cargar preferencias:', error);
        }
    }
}

// Exportar para uso global
window.SidebarResizer = SidebarResizer;
