/**
 * ============================================================================
 * MÓDULO: CONFIGURACIÓN DE TIPOS DE MOVIMIENTO
 * ============================================================================
 * 
 * Gestiona la selección de tipos de movimiento para filtrar los datos
 * del informe de producción interna.
 * 
 * Funcionalidades:
 * - Checkboxes para seleccionar tipos de movimiento
 * - Por defecto: "Salidas" e "Ingresos" seleccionados
 * - Validación (al menos un tipo debe estar seleccionado)
 * - Comunicación con módulo principal para actualizar datos
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

class TiposMovimientoConfig {
    constructor(onTiposChange) {
        this.onTiposChange = onTiposChange; // Callback para notificar cambios
        
        // Tipos de movimiento disponibles
        this.tiposDisponibles = [
            { id: 'salidas', nombre: 'Salidas', valor: 'salida a ventas', checked: true },
            { id: 'ingresos', nombre: 'Ingresos', valor: 'ingreso a producción', checked: true },
            { id: 'ajustes', nombre: 'Ajustes', valor: 'registro de ajuste', checked: false }
        ];
        
        // Elementos del DOM
        this.accordionHeader = null;
        this.accordionContent = null;
        this.checkboxesContainer = null;
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('🔍 [TIPOS-MOVIMIENTO] Inicializando módulo...');
        
        // Obtener elementos del DOM
        this.accordionHeader = document.getElementById('accordion-tipos-header');
        this.accordionContent = document.getElementById('accordion-tipos-content');
        this.checkboxesContainer = document.getElementById('tipos-checkboxes');
        
        if (!this.accordionHeader || !this.accordionContent || !this.checkboxesContainer) {
            console.error('❌ [TIPOS-MOVIMIENTO] No se encontraron elementos necesarios');
            return;
        }
        
        // Renderizar checkboxes
        this.renderizarCheckboxes();
        
        // Configurar event listeners
        this.setupEventListeners();
        
        console.log('✅ [TIPOS-MOVIMIENTO] Módulo inicializado correctamente');
    }

    /**
     * Renderizar checkboxes de tipos de movimiento
     */
    renderizarCheckboxes() {
        this.checkboxesContainer.innerHTML = '';
        
        this.tiposDisponibles.forEach(tipo => {
            const checkboxDiv = document.createElement('div');
            checkboxDiv.className = 'checkbox-item';
            
            checkboxDiv.innerHTML = `
                <label class="checkbox-label">
                    <input 
                        type="checkbox" 
                        id="tipo-${tipo.id}" 
                        value="${tipo.valor}"
                        ${tipo.checked ? 'checked' : ''}
                    >
                    <span>${tipo.nombre}</span>
                </label>
            `;
            
            this.checkboxesContainer.appendChild(checkboxDiv);
        });
        
        console.log('✅ [TIPOS-MOVIMIENTO] Checkboxes renderizados');
    }

    /**
     * Configurar event listeners
     */
    setupEventListeners() {
        // Acordeón
        this.accordionHeader.addEventListener('click', () => this.toggleAccordion());
        
        // Checkboxes
        this.tiposDisponibles.forEach(tipo => {
            const checkbox = document.getElementById(`tipo-${tipo.id}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => this.onCheckboxChange(e));
            }
        });
        
        console.log('✅ [TIPOS-MOVIMIENTO] Event listeners configurados');
    }

    /**
     * Alternar estado del acordeón
     */
    toggleAccordion() {
        const isActive = this.accordionHeader.classList.contains('active');
        
        if (isActive) {
            this.accordionHeader.classList.remove('active');
            this.accordionContent.classList.remove('active');
        } else {
            this.accordionHeader.classList.add('active');
            this.accordionContent.classList.add('active');
        }
    }

    /**
     * Manejar cambio en checkbox
     */
    onCheckboxChange(event) {
        const checkbox = event.target;
        const tipoId = checkbox.id.replace('tipo-', '');
        
        // Actualizar estado en el array
        const tipo = this.tiposDisponibles.find(t => t.id === tipoId);
        if (tipo) {
            tipo.checked = checkbox.checked;
        }
        
        // Validar que al menos un tipo esté seleccionado
        const tiposSeleccionados = this.getTiposSeleccionados();
        
        if (tiposSeleccionados.length === 0) {
            // Revertir el cambio
            checkbox.checked = true;
            tipo.checked = true;
            alert('Debe seleccionar al menos un tipo de movimiento');
            return;
        }
        
        console.log('🔍 [TIPOS-MOVIMIENTO] Tipos seleccionados:', tiposSeleccionados);
        
        // Notificar cambio
        if (this.onTiposChange) {
            this.onTiposChange(tiposSeleccionados);
        }
    }

    /**
     * Obtener tipos de movimiento seleccionados
     * 
     * @returns {Array} Array de valores de tipos seleccionados
     */
    getTiposSeleccionados() {
        return this.tiposDisponibles
            .filter(tipo => tipo.checked)
            .map(tipo => tipo.valor);
    }

    /**
     * Obtener nombres de tipos seleccionados (para mostrar en UI)
     * 
     * @returns {Array} Array de nombres de tipos seleccionados
     */
    getNombresSeleccionados() {
        return this.tiposDisponibles
            .filter(tipo => tipo.checked)
            .map(tipo => tipo.nombre);
    }

    /**
     * Establecer tipos seleccionados programáticamente
     * 
     * @param {Array} valores - Array de valores a seleccionar
     */
    setTiposSeleccionados(valores) {
        this.tiposDisponibles.forEach(tipo => {
            tipo.checked = valores.includes(tipo.valor);
            const checkbox = document.getElementById(`tipo-${tipo.id}`);
            if (checkbox) {
                checkbox.checked = tipo.checked;
            }
        });
        
        // Notificar cambio
        if (this.onTiposChange) {
            this.onTiposChange(this.getTiposSeleccionados());
        }
    }

    /**
     * Resetear a valores por defecto
     */
    resetearDefecto() {
        this.tiposDisponibles.forEach(tipo => {
            // Por defecto: Salidas e Ingresos
            tipo.checked = (tipo.id === 'salidas' || tipo.id === 'ingresos');
            const checkbox = document.getElementById(`tipo-${tipo.id}`);
            if (checkbox) {
                checkbox.checked = tipo.checked;
            }
        });
        
        console.log('🔄 [TIPOS-MOVIMIENTO] Reseteado a valores por defecto');
        
        // Notificar cambio
        if (this.onTiposChange) {
            this.onTiposChange(this.getTiposSeleccionados());
        }
    }
}

// Exportar para uso global
window.TiposMovimientoConfig = TiposMovimientoConfig;
