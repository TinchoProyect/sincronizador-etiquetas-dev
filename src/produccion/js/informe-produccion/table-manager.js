/**
 * ============================================================================
 * MÓDULO: TABLE MANAGER
 * ============================================================================
 * 
 * Gestiona funcionalidades avanzadas de la tabla de producción:
 * - Ordenamiento por columnas (sorting)
 * - Visibilidad de columnas
 * - Filtrado de valores nulos/ceros
 * - Estado persistente de configuración
 * 
 * Funcionalidades estilo Excel para análisis profesional de datos.
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

class TableManager {
    constructor() {
        // Estado de la tabla
        this.estado = {
            columnasVisibles: {
                codigo: true,
                articulo: true,
                unidades: true,
                kilos: true
                // Las columnas de periodos se agregarán dinámicamente
            },
            ordenamiento: {
                columna: null,
                direccion: 'asc' // 'asc' o 'desc'
            },
            filtrarCerosPorColumna: {} // { 'periodo-1': true, 'unidades': false, ... }
        };
        
        // Elementos del DOM
        this.menuColumnas = null;
        this.btnConfigColumnas = null;
        
        // Periodos activos (se actualizará desde main.js)
        this.periodosActivos = [];
        
        // Clave para localStorage
        this.storageKey = 'informe-produccion-table-state';
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('📊 [TABLE-MANAGER] Inicializando módulo...');
        
        // Cargar estado guardado
        this.cargarEstado();
        
        // Crear controles de UI
        this.crearControlesUI();
        
        // Configurar event listeners
        this.setupEventListeners();
        
        console.log('✅ [TABLE-MANAGER] Módulo inicializado correctamente');
    }

    /**
     * Crear controles de UI
     */
    crearControlesUI() {
        // Crear botón de configurar columnas
        const headerPanel = document.querySelector('.main-panel-header');
        if (!headerPanel) return;
        
        const controlesContainer = document.createElement('div');
        controlesContainer.className = 'table-controls';
        controlesContainer.id = 'table-controls-container';
        controlesContainer.innerHTML = `
            <div class="control-group">
                <button id="btn-config-columnas" class="btn-control" title="Configurar columnas visibles">
                    ⚙️ Columnas
                </button>
                <div id="menu-columnas" class="menu-columnas" style="display: none;">
                    <!-- El contenido se generará dinámicamente -->
                </div>
            </div>
        `;
        
        headerPanel.appendChild(controlesContainer);
        
        // Obtener referencias
        this.btnConfigColumnas = document.getElementById('btn-config-columnas');
        this.menuColumnas = document.getElementById('menu-columnas');
        
        // Generar menú inicial
        this.actualizarMenuColumnas();
    }

    /**
     * Configurar event listeners
     */
    setupEventListeners() {
        // Botón de configurar columnas
        if (this.btnConfigColumnas) {
            this.btnConfigColumnas.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenuColumnas();
            });
        }
        
        // Cerrar menú al hacer click fuera
        document.addEventListener('click', (e) => {
            if (this.menuColumnas && 
                !this.menuColumnas.contains(e.target) && 
                !this.btnConfigColumnas.contains(e.target)) {
                this.menuColumnas.style.display = 'none';
            }
        });
        
        console.log('✅ [TABLE-MANAGER] Event listeners configurados');
    }

    /**
     * Alternar menú de columnas
     */
    toggleMenuColumnas() {
        if (!this.menuColumnas) return;
        
        const isVisible = this.menuColumnas.style.display !== 'none';
        this.menuColumnas.style.display = isVisible ? 'none' : 'block';
    }

    /**
     * Manejar cambio de visibilidad de columna
     * 
     * @param {string} columna - Nombre de la columna
     * @param {boolean} visible - Estado de visibilidad
     */
    onColumnaVisibilidadChange(columna, visible) {
        console.log(`📊 [TABLE-MANAGER] Columna '${columna}' ${visible ? 'visible' : 'oculta'}`);
        
        this.estado.columnasVisibles[columna] = visible;
        this.guardarEstado();
        
        // Notificar cambio para re-renderizar tabla
        if (window.informeProduccion) {
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }
    }

    /**
     * Actualizar menú de columnas con periodos dinámicos
     */
    actualizarMenuColumnas() {
        if (!this.menuColumnas) return;
        
        console.log('📊 [TABLE-MANAGER] Actualizando menú de columnas...');
        
        let html = '<div class="menu-header">Columnas Visibles</div>';
        
        // Columnas base
        const columnasBase = [
            { id: 'codigo', label: 'Código' },
            { id: 'articulo', label: 'Artículo' },
            { id: 'unidades', label: 'Unidades Producidas' },
            { id: 'kilos', label: 'Peso Total (kg)' }
        ];
        
        columnasBase.forEach(col => {
            const checked = this.estado.columnasVisibles[col.id] !== false;
            html += `
                <label class="menu-item">
                    <input type="checkbox" 
                           class="col-checkbox" 
                           data-col-id="${col.id}" 
                           ${checked ? 'checked' : ''}>
                    <span>${col.label}</span>
                </label>
            `;
        });
        
        // Separador si hay periodos
        if (this.periodosActivos.length > 0) {
            html += '<div class="menu-separator"></div>';
            html += '<div class="menu-subheader">Periodos</div>';
        }
        
        // Columnas de periodos
        this.periodosActivos.forEach(periodo => {
            const colId = `periodo-${periodo.id}`;
            const checked = this.estado.columnasVisibles[colId] !== false;
            html += `
                <label class="menu-item">
                    <input type="checkbox" 
                           class="col-checkbox" 
                           data-col-id="${colId}" 
                           ${checked ? 'checked' : ''}>
                    <span>${periodo.nombre}</span>
                </label>
            `;
        });
        
        this.menuColumnas.innerHTML = html;
        
        // Configurar event listeners para los checkboxes
        const checkboxes = this.menuColumnas.querySelectorAll('.col-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const colId = e.target.dataset.colId;
                this.onColumnaVisibilidadChange(colId, e.target.checked);
            });
        });
        
        console.log(`✅ [TABLE-MANAGER] Menú actualizado con ${this.periodosActivos.length} periodos`);
    }

    /**
     * Configurar ordenamiento en headers de tabla
     * ✅ ACTUALIZADO: Incluye periodos y filtros
     * 
     * @param {HTMLElement} thead - Elemento thead de la tabla
     */
    setupSorting(thead) {
        if (!thead) return;
        
        const headers = thead.querySelectorAll('th');
        const columnasBase = ['codigo', 'articulo', 'unidades', 'kilos'];
        
        headers.forEach((th, index) => {
            th.style.cursor = 'pointer';
            th.style.userSelect = 'none';
            
            // Determinar ID de columna
            let colId;
            if (index < columnasBase.length) {
                colId = columnasBase[index];
            } else {
                // Es una columna de periodo
                const periodoIndex = index - columnasBase.length;
                if (periodoIndex < this.periodosActivos.length) {
                    colId = `periodo-${this.periodosActivos[periodoIndex].id}`;
                }
            }
            
            if (!colId) return;
            
            // Agregar indicador de ordenamiento
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator';
            sortIndicator.innerHTML = ' ⇅';
            th.appendChild(sortIndicator);
            
            // Agregar icono de filtro para columnas numéricas
            if (colId === 'unidades' || colId === 'kilos' || colId.startsWith('periodo-')) {
                this.agregarIconoFiltro(th, colId);
            }
            
            // Event listener para ordenar
            th.addEventListener('click', (e) => {
                // No ordenar si se hizo click en el icono de filtro
                if (e.target.classList.contains('filtro-icon')) {
                    return;
                }
                this.onHeaderClick(colId, th);
            });
        });
    }

    /**
     * Manejar click en header para ordenar
     * ✅ ACTUALIZADO: Soporta periodos
     * 
     * @param {string} colId - ID de la columna
     * @param {HTMLElement} headerElement - Elemento del header
     */
    onHeaderClick(colId, headerElement) {
        // Alternar dirección si es la misma columna
        if (this.estado.ordenamiento.columna === colId) {
            this.estado.ordenamiento.direccion = 
                this.estado.ordenamiento.direccion === 'asc' ? 'desc' : 'asc';
        } else {
            this.estado.ordenamiento.columna = colId;
            this.estado.ordenamiento.direccion = 'asc';
        }
        
        console.log(`📊 [TABLE-MANAGER] Ordenando por '${colId}' ${this.estado.ordenamiento.direccion}`);
        
        // Actualizar indicadores visuales
        this.actualizarIndicadoresOrdenamiento();
        
        // Guardar estado
        this.guardarEstado();
        
        // Notificar cambio para re-renderizar tabla
        if (window.informeProduccion) {
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }
    }

    /**
     * Actualizar indicadores visuales de ordenamiento
     * ✅ ACTUALIZADO: Soporta periodos
     */
    actualizarIndicadoresOrdenamiento() {
        const thead = document.querySelector('.tabla-produccion thead tr');
        if (!thead) return;
        
        const headers = thead.querySelectorAll('th');
        const columnasBase = ['codigo', 'articulo', 'unidades', 'kilos'];
        
        headers.forEach((th, index) => {
            const indicator = th.querySelector('.sort-indicator');
            if (!indicator) return;
            
            // Determinar ID de columna
            let colId;
            if (index < columnasBase.length) {
                colId = columnasBase[index];
            } else {
                const periodoIndex = index - columnasBase.length;
                if (periodoIndex < this.periodosActivos.length) {
                    colId = `periodo-${this.periodosActivos[periodoIndex].id}`;
                }
            }
            
            if (!colId) return;
            
            if (this.estado.ordenamiento.columna === colId) {
                indicator.innerHTML = this.estado.ordenamiento.direccion === 'asc' ? ' ▲' : ' ▼';
                th.style.backgroundColor = '#0056b3';
            } else {
                indicator.innerHTML = ' ⇅';
                th.style.backgroundColor = '';
            }
            
            // Actualizar icono de filtro
            const filtroIcon = th.querySelector('.filtro-icon');
            if (filtroIcon) {
                filtroIcon.innerHTML = this.estado.filtrarCerosPorColumna[colId] ? ' 🔍' : ' ⊙';
            }
        });
    }

    /**
     * Ordenar datos según configuración actual
     * ✅ ACTUALIZADO: Soporta periodos
     * 
     * @param {Array} datos - Datos a ordenar
     * @returns {Array} Datos ordenados
     */
    ordenarDatos(datos) {
        if (!this.estado.ordenamiento.columna || !datos) {
            return datos;
        }
        
        const colId = this.estado.ordenamiento.columna;
        const direccion = this.estado.ordenamiento.direccion;
        
        // Mapeo de columnas base a propiedades
        const propMap = {
            'codigo': 'articulo_codigo',
            'articulo': 'articulo_nombre',
            'unidades': 'cantidad_total_producida',
            'kilos': 'kilos_totales_producidos'
        };
        
        return [...datos].sort((a, b) => {
            let valA, valB;
            
            // Determinar valores según tipo de columna
            if (propMap[colId]) {
                // Columna base
                valA = a[propMap[colId]];
                valB = b[propMap[colId]];
                
                // Convertir a números si es columna numérica
                if (colId === 'unidades' || colId === 'kilos') {
                    valA = parseFloat(valA) || 0;
                    valB = parseFloat(valB) || 0;
                } else {
                    // Convertir a string para comparación alfabética
                    valA = String(valA || '').toLowerCase();
                    valB = String(valB || '').toLowerCase();
                }
            } else if (colId.startsWith('periodo-')) {
                // Columna de periodo
                const periodoId = parseInt(colId.replace('periodo-', ''));
                const periodo = this.periodosActivos.find(p => p.id === periodoId);
                
                if (periodo && periodo.datos) {
                    const datoA = periodo.datos.find(d => d.articulo_codigo === a.articulo_codigo);
                    const datoB = periodo.datos.find(d => d.articulo_codigo === b.articulo_codigo);
                    
                    valA = datoA ? (parseFloat(datoA.cantidad_producida) || 0) : 0;
                    valB = datoB ? (parseFloat(datoB.cantidad_producida) || 0) : 0;
                } else {
                    valA = 0;
                    valB = 0;
                }
            }
            
            let comparacion = 0;
            if (valA > valB) comparacion = 1;
            if (valA < valB) comparacion = -1;
            
            return direccion === 'asc' ? comparacion : -comparacion;
        });
    }

    /**
     * Actualizar periodos activos
     * 
     * @param {Array} periodos - Lista de periodos activos
     */
    actualizarPeriodos(periodos) {
        console.log(`📊 [TABLE-MANAGER] Actualizando periodos: ${periodos.length}`);
        
        this.periodosActivos = periodos;
        
        // Asegurar que los periodos nuevos estén visibles por defecto
        periodos.forEach(periodo => {
            const colId = `periodo-${periodo.id}`;
            if (this.estado.columnasVisibles[colId] === undefined) {
                this.estado.columnasVisibles[colId] = true;
            }
        });
        
        // Actualizar menú de columnas
        this.actualizarMenuColumnas();
        
        // Guardar estado
        this.guardarEstado();
    }
    
    /**
     * Agregar icono de filtro en header de columna
     * 
     * @param {HTMLElement} th - Elemento th del header
     * @param {string} colId - ID de la columna
     */
    agregarIconoFiltro(th, colId) {
        const filtroIcon = document.createElement('span');
        filtroIcon.className = 'filtro-icon';
        filtroIcon.innerHTML = this.estado.filtrarCerosPorColumna[colId] ? ' 🔍' : ' ⊙';
        filtroIcon.title = 'Filtrar ceros en esta columna';
        filtroIcon.style.cursor = 'pointer';
        filtroIcon.style.marginLeft = '5px';
        filtroIcon.style.fontSize = '0.8rem';
        
        filtroIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFiltroColumna(colId);
        });
        
        th.appendChild(filtroIcon);
    }
    
    /**
     * Alternar filtro de ceros en una columna específica
     * 
     * @param {string} colId - ID de la columna
     */
    toggleFiltroColumna(colId) {
        this.estado.filtrarCerosPorColumna[colId] = !this.estado.filtrarCerosPorColumna[colId];
        
        console.log(`📊 [TABLE-MANAGER] Filtro de ceros en '${colId}': ${this.estado.filtrarCerosPorColumna[colId] ? 'ON' : 'OFF'}`);
        
        this.guardarEstado();
        
        // Notificar cambio para re-renderizar tabla
        if (window.informeProduccion) {
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }
    }
    
    /**
     * Filtrar datos según configuración actual
     * 
     * @param {Array} datos - Datos a filtrar
     * @param {Array} periodosActivos - Periodos activos para filtrar
     * @returns {Array} Datos filtrados
     */
    filtrarDatos(datos, periodosActivos = []) {
        if (!datos) return datos;
        
        // Asegurar que filtrarCerosPorColumna existe
        if (!this.estado.filtrarCerosPorColumna) {
            this.estado.filtrarCerosPorColumna = {};
        }
        
        // Verificar si hay algún filtro activo
        const hayFiltrosActivos = Object.values(this.estado.filtrarCerosPorColumna).some(v => v);
        
        if (!hayFiltrosActivos) {
            return datos;
        }
        
        return datos.filter(item => {
            // Verificar cada columna con filtro activo
            for (const [colId, filtroActivo] of Object.entries(this.estado.filtrarCerosPorColumna)) {
                if (!filtroActivo) continue;
                
                let valor = 0;
                
                // Determinar el valor según la columna
                if (colId === 'unidades') {
                    valor = parseFloat(item.cantidad_total_producida) || 0;
                } else if (colId === 'kilos') {
                    valor = parseFloat(item.kilos_totales_producidos) || 0;
                } else if (colId.startsWith('periodo-')) {
                    // Buscar valor en el periodo correspondiente
                    const periodoId = parseInt(colId.replace('periodo-', ''));
                    const periodo = periodosActivos.find(p => p.id === periodoId);
                    if (periodo && periodo.datos) {
                        const datoPeriodo = periodo.datos.find(d => d.articulo_codigo === item.articulo_codigo);
                        valor = datoPeriodo ? (parseFloat(datoPeriodo.cantidad_producida) || 0) : 0;
                    }
                }
                
                // Si el valor es 0 y el filtro está activo, excluir este item
                if (valor === 0) {
                    return false;
                }
            }
            
            // Si pasó todos los filtros, incluir el item
            return true;
        });
    }

    /**
     * Procesar datos (filtrar y ordenar)
     * 
     * @param {Array} datos - Datos originales
     * @param {Array} periodosActivos - Periodos activos
     * @returns {Array} Datos procesados
     */
    procesarDatos(datos, periodosActivos = []) {
        if (!datos) return datos;
        
        // Primero filtrar
        let datosProcesados = this.filtrarDatos(datos, periodosActivos);
        
        // Luego ordenar
        datosProcesados = this.ordenarDatos(datosProcesados);
        
        return datosProcesados;
    }

    /**
     * Obtener columnas visibles
     * 
     * @returns {Object} Estado de columnas visibles
     */
    getColumnasVisibles() {
        return this.estado.columnasVisibles;
    }

    /**
     * Guardar estado en localStorage
     */
    guardarEstado() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.estado));
            console.log('💾 [TABLE-MANAGER] Estado guardado');
        } catch (error) {
            console.error('❌ [TABLE-MANAGER] Error al guardar estado:', error);
        }
    }

    /**
     * Cargar estado desde localStorage
     */
    cargarEstado() {
        try {
            const estadoGuardado = localStorage.getItem(this.storageKey);
            if (estadoGuardado) {
                const estadoParsed = JSON.parse(estadoGuardado);
                
                // Asegurar que todas las propiedades existan
                this.estado = {
                    columnasVisibles: estadoParsed.columnasVisibles || {
                        codigo: true,
                        articulo: true,
                        unidades: true,
                        kilos: true
                    },
                    ordenamiento: estadoParsed.ordenamiento || {
                        columna: null,
                        direccion: 'asc'
                    },
                    filtrarCerosPorColumna: estadoParsed.filtrarCerosPorColumna || {}
                };
                
                console.log('💾 [TABLE-MANAGER] Estado cargado:', this.estado);
            }
        } catch (error) {
            console.error('❌ [TABLE-MANAGER] Error al cargar estado:', error);
            // Resetear a valores por defecto en caso de error
            this.estado.filtrarCerosPorColumna = {};
        }
    }

    /**
     * Resetear estado a valores por defecto
     */
    resetearEstado() {
        this.estado = {
            columnasVisibles: {
                codigo: true,
                articulo: true,
                unidades: true,
                kilos: true
            },
            ordenamiento: {
                columna: null,
                direccion: 'asc'
            },
            filtrarCeros: false
        };
        
        this.guardarEstado();
        
        console.log('🔄 [TABLE-MANAGER] Estado reseteado');
    }
}

// Exportar para uso global
window.TableManager = TableManager;
