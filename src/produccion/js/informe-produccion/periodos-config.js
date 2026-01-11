/**
 * ============================================================================
 * MÓDULO: CONFIGURACIÓN DE PERIODOS
 * ============================================================================
 * 
 * Gestiona la configuración de periodos para comparación de producción.
 * Permite agregar múltiples rangos de fechas y generar columnas comparativas
 * en la tabla principal.
 * 
 * Funcionalidades:
 * - Agregar periodos con nombre y rango de fechas
 * - Eliminar periodos
 * - Validación de fechas
 * - Gestión de acordeón
 * - Comunicación con módulo principal para actualizar tabla
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

class PeriodosConfig {
    constructor(dataFetcher, onPeriodosChange) {
        this.dataFetcher = dataFetcher;
        this.onPeriodosChange = onPeriodosChange; // Callback para notificar cambios
        this.periodos = [];
        this.nextId = 1;
        
        // Elementos del DOM
        this.accordionHeader = null;
        this.accordionContent = null;
        this.inputNombre = null;
        this.inputFechaInicio = null;
        this.inputFechaFin = null;
        this.btnAgregar = null;
        this.periodosLista = null;
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('📅 [PERIODOS-CONFIG] Inicializando módulo...');
        
        // Obtener elementos del DOM
        this.accordionHeader = document.getElementById('accordion-periodos-header');
        this.accordionContent = document.getElementById('accordion-periodos-content');
        this.inputNombre = document.getElementById('periodo-nombre');
        this.inputFechaInicio = document.getElementById('periodo-fecha-inicio');
        this.inputFechaFin = document.getElementById('periodo-fecha-fin');
        this.btnAgregar = document.getElementById('btn-agregar-periodo');
        this.periodosLista = document.getElementById('periodos-lista');
        
        if (!this.accordionHeader || !this.accordionContent) {
            console.error('❌ [PERIODOS-CONFIG] No se encontraron elementos del acordeón');
            return;
        }
        
        // Configurar event listeners
        this.setupEventListeners();
        
        // Expandir acordeón por defecto
        this.toggleAccordion();
        
        console.log('✅ [PERIODOS-CONFIG] Módulo inicializado correctamente');
    }

    /**
     * Configurar event listeners
     */
    setupEventListeners() {
        // Acordeón
        this.accordionHeader.addEventListener('click', () => this.toggleAccordion());
        
        // Validación de campos
        this.inputNombre.addEventListener('input', () => this.validateForm());
        this.inputFechaInicio.addEventListener('change', () => this.validateForm());
        this.inputFechaFin.addEventListener('change', () => this.validateForm());
        
        // Botón agregar periodo
        this.btnAgregar.addEventListener('click', () => this.agregarPeriodo());
        
        console.log('✅ [PERIODOS-CONFIG] Event listeners configurados');
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
     * Validar formulario de periodo
     */
    validateForm() {
        const nombre = this.inputNombre.value.trim();
        const fechaInicio = this.inputFechaInicio.value;
        const fechaFin = this.inputFechaFin.value;
        
        // Validar que todos los campos estén completos
        const isValid = nombre && fechaInicio && fechaFin;
        
        // Validar que fecha fin sea mayor o igual a fecha inicio
        let fechasValidas = true;
        if (fechaInicio && fechaFin) {
            fechasValidas = new Date(fechaFin) >= new Date(fechaInicio);
        }
        
        this.btnAgregar.disabled = !isValid || !fechasValidas;
        
        return isValid && fechasValidas;
    }

    /**
     * Agregar un nuevo periodo
     */
    async agregarPeriodo() {
        if (!this.validateForm()) {
            console.warn('⚠️ [PERIODOS-CONFIG] Formulario inválido');
            return;
        }
        
        const nombre = this.inputNombre.value.trim();
        const fechaInicio = this.inputFechaInicio.value;
        const fechaFin = this.inputFechaFin.value;
        
        console.log(`📅 [PERIODOS-CONFIG] Agregando periodo: ${nombre} (${fechaInicio} - ${fechaFin})`);
        
        try {
            // Mostrar loading en el botón
            const btnTextoOriginal = this.btnAgregar.textContent;
            this.btnAgregar.textContent = 'Cargando...';
            this.btnAgregar.disabled = true;
            
            // Obtener datos del periodo desde la API
            const datos = await this.dataFetcher.obtenerProduccionPorPeriodo(fechaInicio, fechaFin);
            
            // Crear objeto de periodo
            const periodo = {
                id: this.nextId++,
                nombre: nombre,
                fechaInicio: fechaInicio,
                fechaFin: fechaFin,
                datos: datos.data,
                estadisticas: datos.estadisticas
            };
            
            // Agregar a la lista
            this.periodos.push(periodo);
            
            // Renderizar en la UI
            this.renderPeriodo(periodo);
            
            // Limpiar formulario
            this.limpiarFormulario();
            
            // Notificar cambio
            if (this.onPeriodosChange) {
                this.onPeriodosChange(this.periodos);
            }
            
            console.log(`✅ [PERIODOS-CONFIG] Periodo agregado exitosamente: ${nombre}`);
            
            // Restaurar botón
            this.btnAgregar.textContent = btnTextoOriginal;
            
        } catch (error) {
            console.error('❌ [PERIODOS-CONFIG] Error al agregar periodo:', error);
            alert(`Error al agregar periodo: ${error.message}`);
            
            // Restaurar botón
            this.btnAgregar.textContent = 'Agregar Periodo';
            this.btnAgregar.disabled = false;
        }
    }

    /**
     * Renderizar un periodo en la lista
     * 
     * @param {Object} periodo - Objeto de periodo
     */
    renderPeriodo(periodo) {
        const periodoElement = document.createElement('div');
        periodoElement.className = 'periodo-item';
        periodoElement.dataset.periodoId = periodo.id;
        
        periodoElement.innerHTML = `
            <div class="periodo-info">
                <div class="periodo-nombre">${periodo.nombre}</div>
                <div class="periodo-fechas">
                    ${this.formatearFecha(periodo.fechaInicio)} - ${this.formatearFecha(periodo.fechaFin)}
                </div>
            </div>
            <button class="btn-eliminar-periodo" onclick="window.periodosConfig.eliminarPeriodo(${periodo.id})">
                ✕ Eliminar
            </button>
        `;
        
        this.periodosLista.appendChild(periodoElement);
    }

    /**
     * Eliminar un periodo
     * 
     * @param {number} periodoId - ID del periodo a eliminar
     */
    eliminarPeriodo(periodoId) {
        console.log(`🗑️ [PERIODOS-CONFIG] Eliminando periodo ID: ${periodoId}`);
        
        // Confirmar eliminación
        if (!confirm('¿Está seguro de eliminar este periodo?')) {
            return;
        }
        
        // Eliminar del array
        this.periodos = this.periodos.filter(p => p.id !== periodoId);
        
        // Eliminar del DOM
        const elemento = this.periodosLista.querySelector(`[data-periodo-id="${periodoId}"]`);
        if (elemento) {
            elemento.remove();
        }
        
        // Notificar cambio
        if (this.onPeriodosChange) {
            this.onPeriodosChange(this.periodos);
        }
        
        console.log(`✅ [PERIODOS-CONFIG] Periodo eliminado: ${periodoId}`);
    }

    /**
     * Limpiar formulario
     */
    limpiarFormulario() {
        this.inputNombre.value = '';
        this.inputFechaInicio.value = '';
        this.inputFechaFin.value = '';
        this.btnAgregar.disabled = true;
    }

    /**
     * Formatear fecha para visualización
     * 
     * @param {string} fecha - Fecha en formato YYYY-MM-DD
     * @returns {string} Fecha formateada
     */
    formatearFecha(fecha) {
        const date = new Date(fecha + 'T00:00:00');
        return date.toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    /**
     * Obtener todos los periodos configurados
     * 
     * @returns {Array} Lista de periodos
     */
    getPeriodos() {
        return this.periodos;
    }

    /**
     * Limpiar todos los periodos
     */
    limpiarTodosPeriodos() {
        if (this.periodos.length === 0) {
            return;
        }
        
        if (!confirm('¿Está seguro de eliminar todos los periodos?')) {
            return;
        }
        
        this.periodos = [];
        this.periodosLista.innerHTML = '';
        
        // Notificar cambio
        if (this.onPeriodosChange) {
            this.onPeriodosChange(this.periodos);
        }
        
        console.log('🗑️ [PERIODOS-CONFIG] Todos los periodos eliminados');
    }
}

// Exportar para uso global
window.PeriodosConfig = PeriodosConfig;
