/**
 * ============================================================================
 * MÓDULO: TABLE MANAGER
 * ============================================================================
 * 
 * Gestiona funcionalidades avanzadas de la tabla de producción:
 * - Ordenamiento por columnas (sorting)
 * - Visibilidad de columnas (Lógica Centralizada)
 * - Filtrado de valores nulos/ceros
 * - Estado persistente de configuración
 * - Redimensionamiento de columnas (V4)
 * - Balance Neto Personalizado (V4)
 * 
 * Funcionalidades estilo Excel para análisis profesional de datos.
 * 
 * @author Sistema LAMDA
 * @version 2.0.0
 */

class TableManager {
    constructor(onVisibilityChange) {
        this.onVisibilityChange = onVisibilityChange; // Callback para sync
        // Estado de la tabla
        this.estado = {
            columnasVisibles: {
                codigo: true,
                articulo: true,
            },
            ordenamiento: {
                columna: null,
                direccion: 'asc'
            },
            filtrarCerosPorColumna: {},
            anchosColumnas: {} // Nuevo: Para resizing
        };

        // Elementos del DOM
        this.menuColumnas = null;
        this.btnConfigColumnas = null;

        // Estado dinámico (Tipos y Periodos)
        this.periodosActivos = [];
        this.tiposMovimientoUI = {}; // Estado de los checkboxes del sidebar

        // Configuración Balance V4
        this.balanceConfig = {
            mostrar: false,
            componentes: {}
        };

        // Estado Resizing
        this.isResizing = false;
        this.currentResizingCol = null;
        this.startPageX = 0;
        this.startWidth = 0;

        // Clave para localStorage
        // Clave para localStorage
        this.storageKey = 'informe-produccion-table-state-v8'; // Bump version v8 for box-sizing fix
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('📊 [TABLE-MANAGER] Inicializando módulo V4...');

        // Cargar estado guardado
        this.cargarEstado();

        // Crear controles de UI
        this.crearControlesUI();

        // Configurar event listeners
        this.setupEventListeners();

        console.log('✅ [TABLE-MANAGER] Módulo inicializado correctamente');
    }

    /**
     * Setters para estado dinámico
     */
    setTiposMovimientoUI(uiState) {
        this.isUpdating = true; // Prevent notification loop

        this.tiposMovimientoUI = uiState || {};

        // Sincronización Bidireccional:
        Object.keys(this.tiposMovimientoUI).forEach(key => {
            const shouldBeVisible = !!this.tiposMovimientoUI[key];
            // Solo logica, no triggers externos
            this.estado.columnasVisibles[key] = shouldBeVisible;
        });

        this.guardarEstado();
        this.actualizarMenuColumnas();

        // Re-render sin notificar
        if (window.informeProduccion) {
            window.informeProduccion.actualizarEncabezadosTabla();
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }

        this.isUpdating = false;
    }

    // Legacy support
    setTiposMovimiento(tipos) {
        // Convierte array de valores a estado UI simple
        // Esto es un fallback, idealmente se debe usar setTiposMovimientoUI
        console.warn('⚠️ [TABLE-MANAGER] setTiposMovimiento (Legacy) utilizado');
    }

    setBalanceConfig(config) {
        this.balanceConfig = config || { mostrar: false, componentes: {} };
        this.actualizarMenuColumnas();
    }

    // Legacy support
    setMostrarBalance(mostrar) {
        this.balanceConfig.mostrar = mostrar;
        this.actualizarMenuColumnas();
    }

    /**
     * Genera la definición completa de columnas V4
     */
    getColumnDefinitions() {
        // 1. Columnas Fijas
        const definitions = [
            {
                id: 'codigo',
                label: 'Código',
                type: 'base',
                key: 'articulo_codigo',
                isNumeric: false,
                sortable: true,
                width: 100 // V7 Default
            },
            {
                id: 'articulo',
                label: 'Artículo',
                type: 'base',
                key: 'articulo_nombre',
                isNumeric: false,
                sortable: true,
            }
        ];

        // 2. Columnas Dinámicas por Tipos (Usando estado UI)
        if (this.tiposMovimientoUI['ingresos']) {
            definitions.push({
                id: 'ingresos',
                label: 'Ingresos',
                type: 'base',
                key: 'cantidad_ingresos',
                isNumeric: true,
                sortable: true
            });
        }

        if (this.tiposMovimientoUI['salidas']) {
            definitions.push({
                id: 'salidas',
                label: 'Salidas',
                type: 'base',
                key: 'cantidad_salidas',
                isNumeric: true,
                sortable: true
            });
        }

        if (this.tiposMovimientoUI['ajustes_pos']) {
            definitions.push({
                id: 'ajustes_pos',
                label: 'Ajustes (+)',
                type: 'base',
                key: 'cantidad_ajustes_pos',
                isNumeric: true,
                sortable: true
            });
        }

        if (this.tiposMovimientoUI['ajustes_neg']) {
            definitions.push({
                id: 'ajustes_neg',
                label: 'Ajustes (-)',
                type: 'base',
                key: 'cantidad_ajustes_neg',
                isNumeric: true,
                sortable: true
            });
        }

        // 3. Balance Neto Personalizado
        if (this.balanceConfig.mostrar) {
            definitions.push({
                id: 'balance',
                label: 'Balance',
                type: 'calculated', // Nuevo tipo V4
                key: 'balance_custom', // Clave virtual
                isNumeric: true,
                sortable: true
            });
        }

        // 4. Periodos
        this.periodosActivos.forEach(periodo => {
            definitions.push({
                id: `periodo-${periodo.id}`,
                label: periodo.nombre,
                subLabel: `${this.formatearFechaCorta(periodo.fechaInicio)} - ${this.formatearFechaCorta(periodo.fechaFin)}`,
                type: 'periodo',
                periodoId: periodo.id,
                key: 'cantidad_producida',
                isNumeric: true,
                sortable: true
            });
        });

        // 5. Kilos al final
        definitions.push({
            id: 'kilos',
            label: 'Peso Total (kg)',
            type: 'base',
            key: 'kilos_totales_producidos',
            isNumeric: true,
            sortable: true
        });

        // Merge con estado
        return definitions.map(def => ({
            ...def,
            visible: this.estado.columnasVisibles[def.id] !== false,
            filtroCerosActivo: !!this.estado.filtrarCerosPorColumna[def.id],
            isSorted: this.estado.ordenamiento.columna === def.id,
            sortDir: this.estado.ordenamiento.columna === def.id ? this.estado.ordenamiento.direccion : null,
            width: this.estado.anchosColumnas[def.id] || 'auto' // Resizing
        }));
    }

    formatearFechaCorta(fechaStr) {
        if (!fechaStr) return '';
        const [año, mes, dia] = fechaStr.split('-');
        return `${dia}/${mes}`;
    }

    crearControlesUI() {
        const headerPanel = document.querySelector('.main-panel-header');
        if (!headerPanel) return;

        // Limpiar contenedor existente
        const existing = document.getElementById('table-controls-container');
        if (existing) existing.remove();

        const controlesContainer = document.createElement('div');
        controlesContainer.className = 'table-controls';
        controlesContainer.id = 'table-controls-container';
        controlesContainer.innerHTML = `
            <div class="control-group">
                <button id="btn-config-columnas" class="btn-control" title="Configurar columnas visibles">
                    <i class="fas fa-columns"></i> Columnas
                </button>
                <div id="menu-columnas" class="menu-columnas" style="display: none;"></div>
            </div>
        `;

        headerPanel.appendChild(controlesContainer);
        this.btnConfigColumnas = document.getElementById('btn-config-columnas');
        this.menuColumnas = document.getElementById('menu-columnas');
        this.actualizarMenuColumnas();
    }

    setupEventListeners() {
        if (this.btnConfigColumnas) {
            const newBtn = this.btnConfigColumnas.cloneNode(true);
            this.btnConfigColumnas.parentNode.replaceChild(newBtn, this.btnConfigColumnas);
            this.btnConfigColumnas = newBtn;
            this.btnConfigColumnas.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenuColumnas();
            });
        }

        document.addEventListener('click', (e) => {
            if (this.menuColumnas && !this.menuColumnas.contains(e.target) && !this.btnConfigColumnas.contains(e.target)) {
                this.menuColumnas.style.display = 'none';
            }
        });

        // Listeners Globales para Resizing
        // Se agregan dinámicamente en handleResizeStart para mejor higiene

        // Anti-conflict click (prevent sort after resize)
        document.addEventListener('click', (e) => {
            if (this.justResized) {
                e.stopPropagation();
                this.justResized = false;
            }
        }, true); // Capture phase!
    }

    toggleMenuColumnas() {
        if (!this.menuColumnas) return;
        const isVisible = this.menuColumnas.style.display !== 'none';
        this.menuColumnas.style.display = isVisible ? 'none' : 'block';
    }

    onColumnaVisibilidadChange(colId, visible) {
        this.estado.columnasVisibles[colId] = visible;
        this.guardarEstado();

        // Re-render
        if (window.informeProduccion) {
            window.informeProduccion.actualizarEncabezadosTabla();
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }

        // Notificar sync a main -> sidebar (Solo si es interacción usuario)
        if (this.onVisibilityChange && !this.isUpdating) {
            this.onVisibilityChange(colId, visible);
        }
    }

    actualizarMenuColumnas() {
        if (!this.menuColumnas) return;
        const cols = this.getColumnDefinitions();
        let html = '<div class="menu-header">Columnas Visibles</div>';
        const baseCols = cols.filter(c => c.type !== 'periodo');
        const periodCols = cols.filter(c => c.type === 'periodo');

        baseCols.forEach(col => html += this.renderMenuOption(col));
        if (periodCols.length > 0) {
            html += '<div class="menu-separator"></div><div class="menu-subheader">Periodos</div>';
            periodCols.forEach(col => html += this.renderMenuOption(col));
        }

        this.menuColumnas.innerHTML = html;
        this.menuColumnas.querySelectorAll('.col-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.onColumnaVisibilidadChange(e.target.dataset.colId, e.target.checked);
            });
        });
    }

    renderMenuOption(col) {
        return `
            <label class="menu-item">
                <input type="checkbox" class="col-checkbox" data-col-id="${col.id}" ${col.visible ? 'checked' : ''}>
                <span>${col.label}</span>
            </label>
        `;
    }

    // --- SORTING & RESIZING ---

    setupSorting(thead) {
        if (!thead) return;

        const currentCols = this.getColumnDefinitions().filter(c => c.visible);
        const headers = thead.querySelectorAll('th');

        headers.forEach((th, index) => {
            const colDef = currentCols[index];
            if (!colDef) return;

            // Saneamiento y Reseteo
            const newTh = th.cloneNode(true);
            th.parentNode.replaceChild(newTh, th);
            const cleanTh = newTh;

            // Aplicar ancho guardado o default
            if (this.estado.anchosColumnas[colDef.id]) {
                cleanTh.style.width = this.estado.anchosColumnas[colDef.id] + 'px';
            } else if (colDef.width) {
                cleanTh.style.width = colDef.width + 'px';
            }

            cleanTh.dataset.colId = colDef.id;
            cleanTh.style.position = 'relative'; // Necesario para resizer

            // Contenido Interno
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'th-content';
            contentWrapper.style.display = 'flex';
            contentWrapper.style.alignItems = 'center';
            contentWrapper.style.justifyContent = 'space-between';
            contentWrapper.style.pointerEvents = 'none';
            contentWrapper.style.height = '100%';
            contentWrapper.style.overflow = 'hidden';

            const textSpan = document.createElement('span');
            textSpan.textContent = cleanTh.textContent; // Texto original
            cleanTh.textContent = '';
            contentWrapper.appendChild(textSpan);

            // Iconos
            const iconsSpan = document.createElement('span');
            iconsSpan.className = 'th-icons';
            iconsSpan.style.display = 'flex';
            iconsSpan.style.gap = '5px';
            iconsSpan.style.pointerEvents = 'auto';

            if (colDef.sortable) {
                const sortIndicator = document.createElement('span');
                sortIndicator.className = 'sort-indicator';
                sortIndicator.innerHTML = colDef.isSorted ? (colDef.sortDir === 'asc' ? '▲' : '▼') : '<span style="opacity:0.3">⇅</span>';
                iconsSpan.appendChild(sortIndicator);

                cleanTh.style.cursor = 'pointer';
                cleanTh.onclick = (e) => {
                    // Ignorar si clic en resizer
                    if (e.target.classList.contains('col-resizer')) return;
                    this.onHeaderClick(colDef.id);
                };
            }

            if (colDef.isNumeric) {
                const filterIcon = document.createElement('span');
                filterIcon.className = `filtro-icon ${colDef.filtroCerosActivo ? 'activo' : ''}`;
                filterIcon.innerHTML = colDef.filtroCerosActivo ? '<i class="fas fa-filter"></i>' : '<i class="far fa-circle" style="opacity:0.3"></i>';
                filterIcon.onclick = (e) => { e.stopPropagation(); this.toggleFiltroColumna(colDef.id); };
                iconsSpan.appendChild(filterIcon);
            }

            contentWrapper.appendChild(iconsSpan);
            cleanTh.appendChild(contentWrapper);

            // --- AGREGAR RESIZER ---
            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            resizer.style.position = 'absolute';
            resizer.style.right = '0';
            resizer.style.top = '0';
            resizer.style.bottom = '0';
            resizer.style.width = '8px'; // Área sensible amplia
            resizer.style.cursor = 'col-resize';
            resizer.style.zIndex = '10';
            resizer.style.userSelect = 'none';

            resizer.addEventListener('mousedown', (e) => {
                // Stop propagation para evitar sort
                e.stopPropagation();
                // Prevent default para evitar selección de texto
                e.preventDefault();
                this.handleResizeStart(e, cleanTh, colDef.id);
            });

            cleanTh.appendChild(resizer);
        });
    }

    handleResizeStart(e, th, colId) {
        this.isResizing = true;
        this.currentResizingCol = colId;

        // V6: Absolute Calculation Strategy
        this.currentHeaderLeft = th.getBoundingClientRect().left;
        this.currentHeaderStartWidth = th.getBoundingClientRect().width;

        // V7: Table Growth Strategy
        // Capture table element and its current width
        this.tableElement = th.closest('table');
        this.startTableWidth = this.tableElement.getBoundingClientRect().width;

        // V8: GRID LOCKING STRATEGY
        // Congelar TODOS los anchos actuales explícitamente en píxeles.
        // V9: STRICT LOCKING - Usar min-width y max-width para evitar cualquier reflujo
        const allThs = this.tableElement.querySelectorAll('th');
        allThs.forEach(header => {
            const currentW = header.getBoundingClientRect().width;
            header.style.width = currentW + 'px';
            header.style.minWidth = currentW + 'px'; // V9 Strict
            header.style.maxWidth = currentW + 'px'; // V9 Strict
        });

        // Desbloquear la columna actual para permitir resize
        th.style.minWidth = '2px';
        th.style.maxWidth = 'none';

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // Evitar selección durante arrastre

        // V5.2: Higiene de Eventos - Agregar listeners solo durante el drag
        this.boundHandleResizeMove = this.handleResizeMove.bind(this);
        this.boundHandleResizeEnd = this.handleResizeEnd.bind(this);

        document.addEventListener('mousemove', this.boundHandleResizeMove);
        document.addEventListener('mouseup', this.boundHandleResizeEnd);
    }

    handleResizeMove(e) {
        if (!this.isResizing) return;

        // V6: Cálculo Lineal Absoluto
        // Ancho = Posición Mouse - Borde Izquierdo Header
        // Esto elimina cualquier "delta" acumulado o error de margen.
        // + SCROLL: Si la tabla tiene scroll horizontal, getBoundingClientRect es relativo al viewport,
        // al igual que e.clientX. Usamos clientX para consistencia con getBoundingClientRect.

        const rawWidth = e.clientX - this.currentHeaderLeft;

        // V6: Sin límites reales (2px para que no desaparezca el resizer)
        const newWidth = Math.max(2, rawWidth);

        const th = document.querySelector(`th[data-col-id="${this.currentResizingCol}"]`);
        if (th) {
            th.style.width = newWidth + 'px';

            // V7: TRUE INDEPENDENCE - Actualizar ancho de tabla
            // Delta = Nuevo Ancho - Ancho Inicial de Columna
            const delta = newWidth - this.currentHeaderStartWidth;

            // Nuevo Ancho Tabla = Ancho Inicial Tabla + Delta
            if (this.tableElement) {
                this.tableElement.style.width = (this.startTableWidth + delta) + 'px';
            }
        }
    }

    handleResizeEnd(e) {
        if (!this.isResizing) return;

        // Limpiar listeners globales inmediatamente
        document.removeEventListener('mousemove', this.boundHandleResizeMove);
        document.removeEventListener('mouseup', this.boundHandleResizeEnd);

        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // V9: Cleanup Locking
        // Debemos limpiar min-width y max-width para no interferir con futuros resizes,
        // PERO mantener el width explícito (la persistencia).
        if (this.tableElement) {
            const allThs = this.tableElement.querySelectorAll('th');
            allThs.forEach(header => {
                header.style.minWidth = ''; // Remove strict lock
                header.style.maxWidth = ''; // Remove strict lock
                // width se mantiene
            });
        }

        // Guardar estado final

        // Guardar estado final
        const th = document.querySelector(`th[data-col-id="${this.currentResizingCol}"]`);
        if (th) {
            // Guardar el ancho computado real final
            const finalWidth = th.getBoundingClientRect().width;
            this.estado.anchosColumnas[this.currentResizingCol] = finalWidth;
            this.guardarEstado();
        }

        this.isResizing = false;
        this.currentResizingCol = null;

        // Flag para prevenir sort inmediato
        this.justResized = true;
        setTimeout(() => this.justResized = false, 100);
    }

    onHeaderClick(colId) {
        if (this.justResized) return; // Abort if resized

        if (this.estado.ordenamiento.columna === colId) {
            this.estado.ordenamiento.direccion = this.estado.ordenamiento.direccion === 'asc' ? 'desc' : 'asc';
        } else {
            this.estado.ordenamiento.columna = colId;
            this.estado.ordenamiento.direccion = 'asc';
        }
        this.guardarEstado();
        if (window.informeProduccion) {
            window.informeProduccion.actualizarEncabezadosTabla();
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }
    }

    toggleFiltroColumna(colId) {
        this.estado.filtrarCerosPorColumna[colId] = !this.estado.filtrarCerosPorColumna[colId];
        this.guardarEstado();
        if (window.informeProduccion) {
            window.informeProduccion.actualizarEncabezadosTabla();
            window.informeProduccion.renderizarTabla(window.informeProduccion.datosBase);
        }
    }

    procesarDatos(datos) {
        if (!datos) return [];
        const cols = this.getColumnDefinitions();

        let resultado = datos.filter(item => {
            for (const col of cols) {
                if (col.filtroCerosActivo) {
                    const valor = this.extraerValor(item, col);
                    if (valor === 0) return false;
                }
            }
            return true;
        });

        const sortDef = cols.find(c => c.isSorted);
        if (sortDef) {
            const dir = sortDef.sortDir === 'asc' ? 1 : -1;
            resultado.sort((a, b) => {
                const valA = this.extraerValor(a, sortDef);
                const valB = this.extraerValor(b, sortDef);
                if (sortDef.isNumeric) return (valA - valB) * dir;
                return String(valA).localeCompare(String(valB)) * dir;
            });
        }
        return resultado;
    }

    extraerValor(item, colDef) {
        if (colDef.type === 'base') {
            const val = item[colDef.key];
            if (colDef.isNumeric) return parseFloat(val) || 0;
            return val;
        }
        else if (colDef.type === 'calculated' && colDef.id === 'balance') {
            // ✅ CÁLCULO DINÁMICO DE BALANCE
            let balance = 0;
            const comps = this.balanceConfig.componentes;

            // Nota: Se asume que los valores en 'item' son magnitudes POSITIVAS
            // El backend ya los envía separados y (idealmente) positivos.

            if (comps.ingresos) balance += (parseFloat(item.cantidad_ingresos) || 0);
            if (comps.salidas) balance -= (parseFloat(item.cantidad_salidas) || 0); // Resta
            if (comps.ajustes_pos) balance += (parseFloat(item.cantidad_ajustes_pos) || 0);
            if (comps.ajustes_neg) balance -= (parseFloat(item.cantidad_ajustes_neg) || 0); // Resta

            return balance;
        }
        else if (colDef.type === 'periodo') {
            const periodo = this.periodosActivos.find(p => p.id === colDef.periodoId);
            if (!periodo || !periodo.datos) return 0;
            const datoArticulo = periodo.datos.find(d => d.articulo_codigo === item.articulo_codigo);
            return datoArticulo ? (parseFloat(datoArticulo[colDef.key]) || 0) : 0;
        }
        return 0;
    }

    guardarEstado() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.estado));
        } catch (e) { console.error('Error saving state', e); }
    }

    cargarEstado() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                this.estado = { ...this.estado, ...parsed };
            }
        } catch (e) { console.error('Error loading state', e); }
    }
}

// Exportar
window.TableManager = TableManager;
