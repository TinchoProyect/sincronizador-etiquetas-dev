/**
 * ============================================================================
 * MÓDULO PRINCIPAL: INFORME DE PRODUCCIÓN INTERNA
 * ============================================================================
 * 
 * Coordina todos los módulos del informe de producción interna.
 * Este es el punto de entrada principal que inicializa y gestiona
 * la comunicación entre los diferentes componentes.
 * 
 * Responsabilidades:
 * - Inicializar todos los módulos
 * - Cargar datos iniciales
 * - Renderizar tabla principal
 * - Coordinar actualizaciones entre módulos
 * - Gestionar estado de la aplicación
 * 
 * @author Sistema LAMDA
 * @version 2.0.0
 */

class InformeProduccionInterna {
    constructor() {
        this.dataFetcher = null;
        this.sidebarResizer = null;
        this.tiposMovimientoConfig = null;
        this.periodosConfig = null;
        this.tableManager = null; // Gestor de tabla

        // Estado de la aplicación
        this.datosBase = null; // Historial completo
        this.periodosActivos = []; // Periodos para comparación
        this.tiposMovimientoActivos = null; // Tipos de movimiento seleccionados
        this.tablaElement = null;
        this.currentFechaFiltro = { desde: null, hasta: null, descripcion: null }; // INITIALIZE STATE
    }

    /**
     * Inicializar la aplicación
     */
    async init() {
        console.log('🚀 [INFORME-PROD] ===== INICIANDO MÓDULO DE INFORMES =====');

        try {
            // Obtener elementos del DOM (CRÍTICO: Antes de initModules para evitar race conditions)
            this.tablaElement = document.getElementById('tabla-produccion-body');

            if (!this.tablaElement) {
                throw new Error('No se encontró el elemento de la tabla');
            }

            // Inicializar módulos
            this.initModules();

            // Cargar datos iniciales
            await this.cargarDatosIniciales();

            console.log('✅ [INFORME-PROD] Aplicación inicializada correctamente');

        } catch (error) {
            console.error('❌ [INFORME-PROD] Error al inicializar:', error);
            this.mostrarError('Error al inicializar el módulo: ' + error.message);
        }
    }

    /**
     * Inicializar módulos
     */
    initModules() {
        console.log('🔧 [INFORME-PROD] Inicializando módulos...');

        // Inicializar DataFetcher
        this.dataFetcher = new DataFetcher();

        // Inicializar SidebarResizer
        this.sidebarResizer = new SidebarResizer();
        this.sidebarResizer.init();

        // Inicializar TableManager con callback de sync
        this.tableManager = new TableManager(
            (colId, visible) => {
                if (this.tiposMovimientoConfig) {
                    this.tiposMovimientoConfig.setExternalState(colId, visible);
                }
            }
        );
        this.tableManager.init();

        // Inicializar TiposMovimientoConfig
        this.tiposMovimientoConfig = new TiposMovimientoConfig(
            (data) => this.onTiposMovimientoActualizados(data),
            (config) => this.onBalanceConfigUpdate(config)
        );
        this.tiposMovimientoConfig.init();

        // Inicializar PeriodosConfig
        // Inicializar PeriodosConfig
        this.periodosConfig = new PeriodosConfig(
            this.dataFetcher,
            () => this.tiposMovimientoConfig.getTiposSeleccionados(),
            (periodos) => this.onPeriodosActualizados(periodos),
            (filtro) => this.onFiltroGlobal(filtro) // ✅ Argumento 4: Callback Global
        );
        this.periodosConfig.init();

        console.log('✅ [INFORME-PROD] Módulos inicializados');
    }

    /**
     * Cargar datos iniciales
     */
    async cargarDatosIniciales() {
        console.log('📊 [INFORME-PROD] Cargando datos iniciales...');

        this.mostrarLoading();

        try {
            // Obtener tipos de movimiento seleccionados
            this.tiposMovimientoActivos = this.tiposMovimientoConfig.getTiposSeleccionados();

            // Obtener historial completo con tipos de movimiento
            // Obtener historial completo con tipos de movimiento y filtros de fecha
            const resultado = await this.dataFetcher.obtenerHistorialProduccion(
                this.tiposMovimientoActivos ? this.tiposMovimientoActivos.join(',') : null,
                this.currentFechaFiltro.desde,
                this.currentFechaFiltro.hasta
            );

            this.datosBase = resultado.data;

            // Actualizar estadísticas en el header
            this.actualizarEstadisticas(resultado.estadisticas);

            // Sincronizar tabla por primera vez
            this.actualizarEncabezadosTabla();
            this.renderizarTabla(this.datosBase);

            console.log(`✅ [INFORME-PROD] Datos iniciales cargados: ${this.datosBase.length} artículos`);

        } catch (error) {
            console.error('❌ [INFORME-PROD] Error al cargar datos iniciales:', error);
            this.mostrarError('Error al cargar datos: ' + error.message);
        }
    }

    /**
     * Callback cuando se actualizan los tipos de movimiento
     * ✅ MEJORA: Refresca también los periodos existentes para mantener coherencia
     */
    /**
     * Callback cuando se actualizan los tipos de movimiento
     * ✅ UPDATE V4: Recibe objeto { backendValues, uiState }
     */
    async onTiposMovimientoActualizados(data) {
        console.log(`🔍 [INFORME-PROD] Movimientos actualizados:`, data);

        // 1. Backend Values (para fetcher)
        // Soporte legacy por si llega array directo
        const backendValues = Array.isArray(data) ? data : (data.backendValues || []);
        const uiState = Array.isArray(data) ? null : data.uiState;

        this.tiposMovimientoActivos = backendValues;

        // 2. UI State (para columnas de TableManager)
        if (this.tableManager && uiState) {
            this.tableManager.setTiposMovimientoUI(uiState);
        } else if (this.tableManager && Array.isArray(data)) {
            // Fallback legacy
            this.tableManager.setTiposMovimiento(data);
        }

        // Usar la función de refresco total
        await this.refrescarDatos();
    }

    /**
     * Callback cuando cambia la opción de Balance Neto
     */
    /**
     * Callback cuando cambia la configuración de Balance
     * ✅ UPDATE V4: Recibe objeto de configuración completo
     */
    onBalanceConfigUpdate(config) {
        console.log(`⚖️ [INFORME-PROD] Config Balance Updated:`, config);

        if (this.tableManager) {
            this.tableManager.setBalanceConfig(config);

            // 🔥 CRITICAL FIX: Reactividad inmediata
            // No necesitamos hacer fetch de nuevo porque los datos base (ingresos, salidas, ajustes) ya están en memoria.
            // Solo necesitamos decirle al TableManager que recalcule y renderizar de nuevo.

            this.actualizarEncabezadosTabla(); // Actualizar visibilidad de columna Balance
            this.renderizarTabla(this.datosBase); // Recalcular valores de celdas
        }
    }

    /**
     * Callback cuando se actualizan los periodos
     * ✅ ACTUALIZADO: Notifica al TableManager
     */
    onPeriodosActualizados(periodos) {
        console.log(`📅 [INFORME-PROD] Periodos seleccionados actualizados: ${periodos.length}`);

        // Filtrar solo seleccionados para la tabla
        this.periodosActivos = periodos.filter(p => p.seleccionado !== false);

        console.log(`📊 [INFORME-PROD] Mostrando ${this.periodosActivos.length} columnas de periodos`);

        // Notificar al TableManager (Fuente de verdad)
        if (this.tableManager) {
            this.tableManager.actualizarPeriodos(this.periodosActivos);
        }

        // Headers y Tabla se actualizan dentro de tableManager.actualizarPeriodos -> actualizarMenuColumnas -> (pero aquí forzamos para asegurar)
        this.actualizarEncabezadosTabla();
        this.renderizarTabla(this.datosBase);
    }

    /**
     * Callback cuando cambia el Filtro Global (Desde Configuración de Periodos)
     * ✅ IMPLEMENTED: Maneja actualización de estado y recarga de datos
     */
    async onFiltroGlobal(filtro) {
        console.log(`📅 [INFORME-PROD] Filtro Global recibido:`, filtro);

        // 1. Actualizar Estado
        this.currentFechaFiltro = {
            desde: filtro.desde,
            hasta: filtro.hasta,
            descripcion: filtro.descripcion
        };

        // 2. Actualizar Título de Tabla (Visual)
        this.actualizarTituloTabla();

        // 3. Recargar Datos (Fetcher usará this.currentFechaFiltro)
        await this.refrescarDatos();
    }

    /**
     * Actualizar Título de la Tabla según filtro activo
     */
    actualizarTituloTabla() {
        // Buscamos el H2 del panel principal
        const titleEl = document.querySelector('.main-panel-header h2');
        if (!titleEl) return;

        if (this.currentFechaFiltro.descripcion) {
            titleEl.innerHTML = `📈 Historial: <span style="font-weight:400; font-size: 0.9em; color: #666;">${this.currentFechaFiltro.descripcion}</span>`;
        } else {
            titleEl.textContent = '📈 Historial de Producción Interna';
        }
    }

    /**
     * Renderizar tabla principal
     * ✅ ACTUALIZADO: Usa definiciones centralizadas
     */
    renderizarTabla(datos) {
        // Saneamiento del DOM
        if (!this.tablaElement) return;
        this.tablaElement.innerHTML = ''; // Limpiar contenido previo

        if (!datos || datos.length === 0) {
            this.mostrarMensajeVacio();
            return;
        }

        // 1. Procesar datos (Filtrar y Ordenar) usando TableManager
        const datosProcesados = this.tableManager ?
            this.tableManager.procesarDatos(datos) : datos;

        // 2. Agrupar
        const agrupado = this.agruparPorJerarquia(datosProcesados);

        // 3. Renderizar filas
        for (const [rubro, subrubros] of Object.entries(agrupado)) {
            // Header: Rubro
            this.renderizarHeaderRubro(rubro);

            for (const [subrubro, articulos] of Object.entries(subrubros)) {
                // Header: Subrubro
                this.renderizarHeaderSubrubro(subrubro);

                // Artículos ya vienen ordenados del procesarDatos, 
                // pero al agrupar perdimos el orden global si es que era por rubro/subrubro implícitamente.
                // Si el ordenamiento es por columna numérica, TableManager ya lo hizo.
                // Aquí solo iteramos.

                articulos.forEach(articulo => {
                    this.renderizarFilaArticulo(articulo);
                });
            }
        }

        // Restaurar estado de ordenamiento visual en headers
        if (this.tableManager) {
            const thead = document.querySelector('.tabla-produccion thead tr');
            if (thead) this.tableManager.setupSorting(thead);
        }
    }

    /**
     * Agrupar datos por jerarquía
     */
    agruparPorJerarquia(datos) {
        const agrupado = {};
        datos.forEach(articulo => {
            const rubro = articulo.rubro || 'Sin Rubro';
            const subrubro = articulo.subrubro || 'Sin Subrubro';

            if (!agrupado[rubro]) agrupado[rubro] = {};
            if (!agrupado[rubro][subrubro]) agrupado[rubro][subrubro] = [];

            agrupado[rubro][subrubro].push(articulo);
        });
        return agrupado;
    }

    /**
     * Renderizar header de Rubro
     * ✅ ACTUALIZADO: Colspan calculado desde Definitions
     */
    renderizarHeaderRubro(rubro) {
        const tr = document.createElement('tr');
        tr.className = 'rubro-header';

        const colspan = this.calcularColspanTotal();

        tr.innerHTML = `
            <td colspan="${colspan}" style="font-weight: 700; font-size: 1rem;">
                📁 ${rubro}
            </td>
        `;
        this.tablaElement.appendChild(tr);
    }

    /**
     * Renderizar header de Subrubro
     * ✅ ACTUALIZADO: Colspan calculado desde Definitions
     */
    renderizarHeaderSubrubro(subrubro) {
        const tr = document.createElement('tr');
        tr.className = 'subrubro-header';

        const colspan = this.calcularColspanTotal();

        tr.innerHTML = `
            <td colspan="${colspan}" style="padding-left: 30px; font-weight: 600;">
                📂 ${subrubro}
            </td>
        `;
        this.tablaElement.appendChild(tr);
    }

    /**
     * Helper para calcular colspan basado en columnas visibles
     */
    calcularColspanTotal() {
        if (!this.tableManager) return 4;
        const cols = this.tableManager.getColumnDefinitions();
        return cols.filter(c => c.visible).length;
    }

    /**
     * Renderizar fila de artículo
     * ✅ ACTUALIZADO: Itera sobre Definitions para garantizar orden
     */
    renderizarFilaArticulo(articulo) {
        const tr = document.createElement('tr');

        if (!this.tableManager) return; // Seguridad
        const cols = this.tableManager.getColumnDefinitions();

        // Iterar SOLO sobre columnas visibles
        cols.filter(c => c.visible).forEach(col => {
            const td = document.createElement('td');

            // Obtener valor (TableManager centraliza la lógica de extracción)
            const valor = this.tableManager.extraerValor(articulo, col);

            // Formatear
            if (col.isNumeric) {
                td.className = 'col-numero';
                td.textContent = this.formatearNumero(valor);
            } else {
                td.textContent = valor;
            }

            // TOOLTIP DEBUG PARA BALANCE (Solicitud de Transparencia)
            if (col.id === 'balance') {
                const i = parseFloat(articulo.cantidad_ingresos) || 0;
                const s = parseFloat(articulo.cantidad_salidas) || 0;
                const ap = parseFloat(articulo.cantidad_ajustes_pos) || 0;
                const an = parseFloat(articulo.cantidad_ajustes_neg) || 0;
                td.title = `Ingresos: ${i}\nSalidas: ${s}\nAjustes (+): ${ap}\nAjustes (-): ${an}`;
            }

            tr.appendChild(td);
        });

        this.tablaElement.appendChild(tr);
    }

    /**
     * Actualizar estadísticas
     */
    actualizarEstadisticas(estadisticas) {
        const update = (id, val, fmt = false) => {
            const el = document.getElementById(id);
            if (el) el.textContent = fmt ? this.formatearNumero(val || 0) : (val || 0);
        };

        update('stat-total-articulos', estadisticas.total_articulos);
        update('stat-total-registros', estadisticas.total_registros);
        update('stat-cantidad-total', estadisticas.cantidad_total, true);

        // Kilos con sufijo
        const kilosEl = document.getElementById('stat-kilos-totales');
        if (kilosEl) kilosEl.textContent = this.formatearNumero(estadisticas.kilos_totales || 0) + ' kg';
    }

    /**
     * Mostrar Loading
     */
    mostrarLoading() {
        const colspan = this.calcularColspanTotal();
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="${colspan}" class="loading-message">
                    <div class="loading-spinner"></div>
                    <p>Cargando datos de producción...</p>
                </td>
            </tr>
        `;
    }

    /**
     * Mostrar Error
     */
    mostrarError(mensaje) {
        const colspan = this.calcularColspanTotal();
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="${colspan}">
                    <div class="error-message">
                        ❌ ${mensaje}
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Mostrar Mensaje Vacío
     */
    mostrarMensajeVacio() {
        const colspan = this.calcularColspanTotal();
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="${colspan}" class="empty-message">
                    📭 No hay datos de producción disponibles
                </td>
            </tr>
        `;
    }

    /**
     * Formatear número
     */
    formatearNumero(numero) {
        if (numero === null || numero === undefined) return '0';
        const num = parseFloat(numero);
        if (isNaN(num)) return '0';
        return num.toLocaleString('es-AR', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        });
    }

    /**
     * Formatear fecha
     */
    formatearFecha(fecha) {
        if (!fecha) return '-';
        const date = new Date(fecha);
        return date.toLocaleDateString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
    }

    /**
     * Actualizar encabezados de tabla
     * ✅ ACTUALIZADO: Usa Definitions
     */
    actualizarEncabezadosTabla() {
        const thead = document.querySelector('.tabla-produccion thead tr');
        if (!thead || !this.tableManager) return;

        console.log('🔧 [INFORME-PROD] Reconstruyendo thead...');

        // Limpiar completamente
        thead.innerHTML = '';

        const cols = this.tableManager.getColumnDefinitions();

        // Renderizar Headers Visibles
        cols.filter(c => c.visible).forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            th.dataset.colId = col.id;

            if (col.isNumeric) {
                th.className = 'col-numero';
            }
            if (col.subLabel) {
                th.title = col.subLabel;
            }
            if (col.type === 'periodo') {
                th.classList.add('header-periodo');
            }

            thead.appendChild(th);
        });

        console.log(`✅ [INFORME-PROD] Thead reconstruido con ${thead.children.length} columnas`);

        // Configurar sorting
        this.tableManager.setupSorting(thead);
    }

    /**
     * Refrescar datos (forzar recarga desde API)
     * ✅ CRÍTICO: Recarga también los periodos para que coincidan con los nuevos filtros
     */
    async refrescarDatos() {
        console.log('🔄 [INFORME-PROD] Refrescando datos (Global + Periodos)...');
        this.mostrarLoading();

        try {
            // 1. Limpiar caché global
            this.dataFetcher.clearCache();

            // 2. Recargar datos principales (Datos Base)
            this.tiposMovimientoActivos = this.tiposMovimientoConfig.getTiposSeleccionados();

            // Pasar filtros de fecha al dataFetcher
            const resultado = await this.dataFetcher.obtenerHistorialProduccion( // Normalizamos nombre a obtenerHistorialProduccion
                this.tiposMovimientoActivos ? this.tiposMovimientoActivos.join(',') : null,
                this.currentFechaFiltro.desde,
                this.currentFechaFiltro.hasta
            );

            this.datosBase = resultado.data;
            this.actualizarEstadisticas(resultado.estadisticas);

            // 3. Recargar datos de cada periodo activo con el nuevo filtro de movimientos
            if (this.periodosActivos.length > 0) {
                console.log(`🔄 [INFORME-PROD] Recargando ${this.periodosActivos.length} periodos con nuevos filtros...`);

                // Usamos Promise.all para paralelo
                await Promise.all(this.periodosActivos.map(async (periodo) => {
                    const datosPeriodo = await this.dataFetcher.obtenerProduccionPorPeriodo(
                        periodo.fechaInicio,
                        periodo.fechaFin,
                        this.tiposMovimientoActivos // PASAR FILTRO ACTUAL
                    );
                    // Actualizar el objeto periodo en memoria (referencia compartida con PeriodosConfig)
                    periodo.datos = datosPeriodo.data;
                    periodo.estadisticas = datosPeriodo.estadisticas;
                }));
            }

            // 4. Re-renderizar todo
            this.actualizarEncabezadosTabla();
            this.renderizarTabla(this.datosBase);

            console.log('✅ [INFORME-PROD] Todo refrescado correctamente');

        } catch (error) {
            console.error('❌ [INFORME-PROD] Error al refrescar datos:', error);
            this.mostrarError('Error al refrescar: ' + error.message);
        }
    }
}

// ==========================================
// INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📄 [INFORME-PROD] DOM cargado, inicializando aplicación...');

    try {
        window.informeProduccion = new InformeProduccionInterna();
        await window.informeProduccion.init();

        // Exponer módulos globalmente
        window.periodosConfig = window.informeProduccion.periodosConfig;
        window.tiposMovimientoConfig = window.informeProduccion.tiposMovimientoConfig;

    } catch (error) {
        console.error('❌ [INFORME-PROD] Error fatal al inicializar:', error);
    }
});
