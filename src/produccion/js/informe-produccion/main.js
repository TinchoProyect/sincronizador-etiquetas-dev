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
 * @version 1.0.0
 */

class InformeProduccionInterna {
    constructor() {
        this.dataFetcher = null;
        this.sidebarResizer = null;
        this.tiposMovimientoConfig = null;
        this.periodosConfig = null;
        this.tableManager = null; // NUEVO: Gestor de tabla
        
        // Estado de la aplicación
        this.datosBase = null; // Historial completo
        this.periodosActivos = []; // Periodos para comparación
        this.tiposMovimientoActivos = null; // Tipos de movimiento seleccionados
        this.tablaElement = null;
    }

    /**
     * Inicializar la aplicación
     */
    async init() {
        console.log('🚀 [INFORME-PROD] ===== INICIANDO MÓDULO DE INFORMES =====');
        
        try {
            // Inicializar módulos
            this.initModules();
            
            // Obtener elementos del DOM
            this.tablaElement = document.getElementById('tabla-produccion-body');
            
            if (!this.tablaElement) {
                throw new Error('No se encontró el elemento de la tabla');
            }
            
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
        
        // Inicializar TableManager
        this.tableManager = new TableManager();
        this.tableManager.init();
        
        // Inicializar TiposMovimientoConfig
        this.tiposMovimientoConfig = new TiposMovimientoConfig(
            (tipos) => this.onTiposMovimientoActualizados(tipos)
        );
        this.tiposMovimientoConfig.init();
        
        // Inicializar PeriodosConfig
        this.periodosConfig = new PeriodosConfig(
            this.dataFetcher,
            () => this.tiposMovimientoConfig.getTiposSeleccionados(),
            (periodos) => this.onPeriodosActualizados(periodos)
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
            const resultado = await this.dataFetcher.obtenerHistorial(this.tiposMovimientoActivos);
            
            this.datosBase = resultado.data;
            
            // Actualizar estadísticas en el header
            this.actualizarEstadisticas(resultado.estadisticas);
            
            // Renderizar tabla con datos base
            this.renderizarTabla(this.datosBase);
            
            console.log(`✅ [INFORME-PROD] Datos iniciales cargados: ${this.datosBase.length} artículos`);
            
        } catch (error) {
            console.error('❌ [INFORME-PROD] Error al cargar datos iniciales:', error);
            this.mostrarError('Error al cargar datos: ' + error.message);
        }
    }

    /**
     * Callback cuando se actualizan los tipos de movimiento
     * 
     * @param {Array} tipos - Lista de tipos seleccionados
     */
    async onTiposMovimientoActualizados(tipos) {
        console.log(`🔍 [INFORME-PROD] Tipos de movimiento actualizados:`, tipos);
        
        this.tiposMovimientoActivos = tipos;
        
        // Recargar datos con nuevos tipos
        await this.cargarDatosIniciales();
    }

    /**
     * Callback cuando se actualizan los periodos
     * ✅ ACTUALIZADO: Notifica al TableManager
     * 
     * @param {Array} periodos - Lista de periodos seleccionados
     */
    onPeriodosActualizados(periodos) {
        console.log(`📅 [INFORME-PROD] Periodos seleccionados actualizados: ${periodos.length}`);
        
        // Solo guardar periodos seleccionados
        this.periodosActivos = periodos.filter(p => p.seleccionado !== false);
        
        console.log(`📊 [INFORME-PROD] Mostrando ${this.periodosActivos.length} columnas de periodos`);
        
        // Notificar al TableManager sobre los periodos actualizados
        if (this.tableManager) {
            this.tableManager.actualizarPeriodos(this.periodosActivos);
        }
        
        // Actualizar headers de la tabla
        this.actualizarEncabezadosTabla();
        
        // Re-renderizar tabla con columnas comparativas
        this.renderizarTabla(this.datosBase);
    }

    /**
     * Renderizar tabla principal
     * ✅ ACTUALIZADO: Con procesamiento de TableManager
     * 
     * @param {Array} datos - Datos a renderizar
     */
    renderizarTabla(datos) {
        console.log(`📊 [INFORME-PROD] Renderizando tabla con ${datos?.length || 0} artículos...`);
        
        if (!datos || datos.length === 0) {
            this.mostrarMensajeVacio();
            return;
        }
        
        // Procesar datos (filtrar y ordenar) con TableManager
        const datosProcesados = this.tableManager ? 
            this.tableManager.procesarDatos(datos, this.periodosActivos) : datos;
        
        console.log(`📊 [INFORME-PROD] Datos procesados: ${datosProcesados.length} artículos`);
        
        // Limpiar tabla
        this.tablaElement.innerHTML = '';
        
        // Agrupar por Rubro y Subrubro
        const agrupado = this.agruparPorJerarquia(datosProcesados);
        
        // Renderizar grupos
        for (const [rubro, subrubros] of Object.entries(agrupado)) {
            // Header de Rubro
            this.renderizarHeaderRubro(rubro);
            
            // Subrubros y artículos
            for (const [subrubro, articulos] of Object.entries(subrubros)) {
                // Header de Subrubro
                this.renderizarHeaderSubrubro(subrubro);
                
                // Ordenar artículos dentro del subrubro si hay ordenamiento activo
                const articulosOrdenados = this.tableManager ?
                    this.tableManager.ordenarDatos(articulos) : articulos;
                
                // Artículos
                articulosOrdenados.forEach(articulo => {
                    this.renderizarFilaArticulo(articulo);
                });
            }
        }
        
        // Configurar ordenamiento en headers
        if (this.tableManager) {
            const thead = document.querySelector('.tabla-produccion thead tr');
            this.tableManager.setupSorting(thead);
        }
        
        console.log('✅ [INFORME-PROD] Tabla renderizada correctamente');
    }

    /**
     * Agrupar datos por jerarquía Rubro > Subrubro
     * 
     * @param {Array} datos - Datos a agrupar
     * @returns {Object} Datos agrupados
     */
    agruparPorJerarquia(datos) {
        const agrupado = {};
        
        datos.forEach(articulo => {
            const rubro = articulo.rubro || 'Sin Rubro';
            const subrubro = articulo.subrubro || 'Sin Subrubro';
            
            if (!agrupado[rubro]) {
                agrupado[rubro] = {};
            }
            
            if (!agrupado[rubro][subrubro]) {
                agrupado[rubro][subrubro] = [];
            }
            
            agrupado[rubro][subrubro].push(articulo);
        });
        
        return agrupado;
    }

    /**
     * Renderizar header de Rubro
     * ✅ ACTUALIZADO: Colspan dinámico según columnas visibles
     * 
     * @param {string} rubro - Nombre del rubro
     */
    renderizarHeaderRubro(rubro) {
        const tr = document.createElement('tr');
        tr.className = 'rubro-header';
        
        // Calcular colspan según columnas visibles
        const columnasVisibles = this.tableManager ? 
            this.tableManager.getColumnasVisibles() : 
            { codigo: true, articulo: true, unidades: true, kilos: true };
        
        // Contar columnas base visibles
        const columnasBaseVisibles = ['codigo', 'articulo', 'unidades', 'kilos']
            .filter(col => columnasVisibles[col] !== false).length;
        
        // Contar periodos visibles
        const periodosVisibles = this.periodosActivos
            .filter(p => columnasVisibles[`periodo-${p.id}`] !== false).length;
        
        const colspan = columnasBaseVisibles + periodosVisibles;
        
        tr.innerHTML = `
            <td colspan="${colspan}" style="font-weight: 700; font-size: 1rem;">
                📁 ${rubro}
            </td>
        `;
        
        this.tablaElement.appendChild(tr);
    }

    /**
     * Renderizar header de Subrubro
     * ✅ ACTUALIZADO: Colspan dinámico según columnas visibles
     * 
     * @param {string} subrubro - Nombre del subrubro
     */
    renderizarHeaderSubrubro(subrubro) {
        const tr = document.createElement('tr');
        tr.className = 'subrubro-header';
        
        // Calcular colspan según columnas visibles
        const columnasVisibles = this.tableManager ? 
            this.tableManager.getColumnasVisibles() : 
            { codigo: true, articulo: true, unidades: true, kilos: true };
        
        const numColumnasBase = Object.values(columnasVisibles).filter(v => v).length;
        const colspan = numColumnasBase + this.periodosActivos.length;
        
        tr.innerHTML = `
            <td colspan="${colspan}" style="padding-left: 30px; font-weight: 600;">
                📂 ${subrubro}
            </td>
        `;
        
        this.tablaElement.appendChild(tr);
    }

    /**
     * Renderizar fila de artículo
     * ✅ ACTUALIZADO: Con visibilidad de columnas
     * 
     * @param {Object} articulo - Datos del artículo
     */
    renderizarFilaArticulo(articulo) {
        const tr = document.createElement('tr');
        
        // Obtener columnas visibles
        const columnasVisibles = this.tableManager ? 
            this.tableManager.getColumnasVisibles() : 
            { codigo: true, articulo: true, unidades: true, kilos: true };
        
        // Columnas base (respetando visibilidad)
        let html = '';
        
        if (columnasVisibles.codigo) {
            html += `<td>${articulo.articulo_codigo}</td>`;
        }
        
        if (columnasVisibles.articulo) {
            html += `<td>${articulo.articulo_nombre}</td>`;
        }
        
        if (columnasVisibles.unidades) {
            html += `<td class="col-numero">${this.formatearNumero(articulo.cantidad_total_producida)}</td>`;
        }
        
        if (columnasVisibles.kilos) {
            html += `<td class="col-numero">${this.formatearNumero(articulo.kilos_totales_producidos)}</td>`;
        }
        
        // Columnas de periodos (si hay periodos activos y visibles)
        this.periodosActivos.forEach(periodo => {
            const colId = `periodo-${periodo.id}`;
            const esVisible = columnasVisibles[colId] !== false;
            
            if (esVisible) {
                const datoPeriodo = this.buscarDatoEnPeriodo(articulo.articulo_codigo, periodo);
                html += `<td class="col-numero">${datoPeriodo ? this.formatearNumero(datoPeriodo.cantidad_producida) : '-'}</td>`;
            }
        });
        
        tr.innerHTML = html;
        this.tablaElement.appendChild(tr);
    }

    /**
     * Buscar dato de un artículo en un periodo específico
     * 
     * @param {string} articuloCodigo - Código del artículo
     * @param {Object} periodo - Objeto de periodo
     * @returns {Object|null} Dato encontrado o null
     */
    buscarDatoEnPeriodo(articuloCodigo, periodo) {
        if (!periodo.datos) return null;
        
        return periodo.datos.find(item => item.articulo_codigo === articuloCodigo);
    }

    /**
     * Actualizar estadísticas en el header
     * 
     * @param {Object} estadisticas - Objeto con estadísticas
     */
    actualizarEstadisticas(estadisticas) {
        const totalArticulos = document.getElementById('stat-total-articulos');
        const totalRegistros = document.getElementById('stat-total-registros');
        const cantidadTotal = document.getElementById('stat-cantidad-total');
        const kilosTotales = document.getElementById('stat-kilos-totales');
        
        if (totalArticulos) totalArticulos.textContent = estadisticas.total_articulos || 0;
        if (totalRegistros) totalRegistros.textContent = estadisticas.total_registros || 0;
        if (cantidadTotal) cantidadTotal.textContent = this.formatearNumero(estadisticas.cantidad_total || 0);
        if (kilosTotales) kilosTotales.textContent = this.formatearNumero(estadisticas.kilos_totales || 0);
    }

    /**
     * Mostrar mensaje de loading
     */
    mostrarLoading() {
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="10" class="loading-message">
                    <div class="loading-spinner"></div>
                    <p>Cargando datos de producción...</p>
                </td>
            </tr>
        `;
    }

    /**
     * Mostrar mensaje de error
     * 
     * @param {string} mensaje - Mensaje de error
     */
    mostrarError(mensaje) {
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="10">
                    <div class="error-message">
                        ❌ ${mensaje}
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Mostrar mensaje cuando no hay datos
     */
    mostrarMensajeVacio() {
        this.tablaElement.innerHTML = `
            <tr>
                <td colspan="10" class="empty-message">
                    📭 No hay datos de producción disponibles
                </td>
            </tr>
        `;
    }

    /**
     * Formatear número con separadores de miles
     * 
     * @param {number} numero - Número a formatear
     * @returns {string} Número formateado
     */
    formatearNumero(numero) {
        if (numero === null || numero === undefined) return '0';
        
        const num = parseFloat(numero);
        if (isNaN(num)) return '0';
        
        return num.toLocaleString('es-AR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    /**
     * Formatear fecha
     * 
     * @param {string} fecha - Fecha a formatear
     * @returns {string} Fecha formateada
     */
    formatearFecha(fecha) {
        if (!fecha) return '-';
        
        const date = new Date(fecha);
        return date.toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    /**
     * Actualizar encabezados de tabla según periodos activos
     * ✅ ACTUALIZADO: Con visibilidad de columnas
     */
    actualizarEncabezadosTabla() {
        const thead = document.querySelector('.tabla-produccion thead tr');
        
        if (!thead) return;
        
        // Obtener columnas visibles
        const columnasVisibles = this.tableManager ? 
            this.tableManager.getColumnasVisibles() : 
            { codigo: true, articulo: true, unidades: true, kilos: true };
        
        // Limpiar todos los headers
        thead.innerHTML = '';
        
        // Agregar headers base (respetando visibilidad)
        if (columnasVisibles.codigo) {
            const th = document.createElement('th');
            th.textContent = 'Código';
            thead.appendChild(th);
        }
        
        if (columnasVisibles.articulo) {
            const th = document.createElement('th');
            th.textContent = 'Artículo';
            thead.appendChild(th);
        }
        
        if (columnasVisibles.unidades) {
            const th = document.createElement('th');
            th.className = 'col-numero';
            th.textContent = 'Unidades Producidas';
            thead.appendChild(th);
        }
        
        if (columnasVisibles.kilos) {
            const th = document.createElement('th');
            th.className = 'col-numero';
            th.textContent = 'Peso Total (kg)';
            thead.appendChild(th);
        }
        
        // Agregar headers de periodos (solo visibles)
        this.periodosActivos.forEach(periodo => {
            const colId = `periodo-${periodo.id}`;
            const esVisible = columnasVisibles[colId] !== false;
            
            if (esVisible) {
                const th = document.createElement('th');
                th.className = 'header-periodo col-numero';
                th.textContent = periodo.nombre;
                th.title = `${periodo.fechaInicio} - ${periodo.fechaFin}`;
                thead.appendChild(th);
            }
        });
        
        // Configurar ordenamiento
        if (this.tableManager) {
            this.tableManager.setupSorting(thead);
        }
    }

    /**
     * Refrescar datos (forzar recarga desde API)
     */
    async refrescarDatos() {
        console.log('🔄 [INFORME-PROD] Refrescando datos...');
        
        try {
            // Limpiar caché
            this.dataFetcher.clearCache();
            
            // Recargar datos
            await this.cargarDatosIniciales();
            
            // Recargar periodos
            for (const periodo of this.periodosActivos) {
                const datos = await this.dataFetcher.obtenerProduccionPorPeriodo(
                    periodo.fechaInicio,
                    periodo.fechaFin,
                    true // Force refresh
                );
                periodo.datos = datos.data;
                periodo.estadisticas = datos.estadisticas;
            }
            
            // Re-renderizar
            this.renderizarTabla(this.datosBase);
            
            console.log('✅ [INFORME-PROD] Datos refrescados correctamente');
            
        } catch (error) {
            console.error('❌ [INFORME-PROD] Error al refrescar datos:', error);
            alert('Error al refrescar datos: ' + error.message);
        }
    }
}

// ==========================================
// INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📄 [INFORME-PROD] DOM cargado, inicializando aplicación...');
    
    try {
        // Crear instancia global
        window.informeProduccion = new InformeProduccionInterna();
        
        // Inicializar
        await window.informeProduccion.init();
        
        // Exponer módulos globalmente para los botones de eliminar
        window.periodosConfig = window.informeProduccion.periodosConfig;
        window.tiposMovimientoConfig = window.informeProduccion.tiposMovimientoConfig;
        
    } catch (error) {
        console.error('❌ [INFORME-PROD] Error fatal al inicializar:', error);
    }
});
