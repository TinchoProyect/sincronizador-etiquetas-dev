/**
 * MÓDULO PRINCIPAL - Preview de Historial con Filtros Avanzados
 * Arquitectura Modular ES6
 */

console.log('📄 [PREVIEW-HISTORIAL] Cargando módulo principal con ES6...');

// ============================================
// IMPORTACIONES DE MÓDULOS
// ============================================
import {
    inicializarFiltros,
    toggleVisibilidadRubro,
    toggleVisibilidadMes,
    reordenarRubros,
    esRubroVisible,
    esMesVisible,
    obtenerRubrosOrdenados,
    obtenerMesesOrdenados,
    estadoFiltros
} from './modules/filtroRubros.js';

import {
    inicializarDragDrop,
    reinicializarDragDrop
} from './modules/dragAndDrop.js';

import {
    renderizarPanelFiltros,
    actualizarPanelFiltros
} from './modules/renderPanelFiltros.js';

// ============================================
// VARIABLES GLOBALES
// ============================================
let datosCliente = null;
let datosHistorial = null;

// ============================================
// UTILIDADES BÁSICAS
// ============================================

const formatearMoneda = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

function formatearPrecio(valor) {
    const numero = parseFloat(valor);
    return Number.isFinite(numero) ? formatearMoneda.format(numero) : '$ 0,00';
}

function toggleAccordion(id) {
    const content = document.getElementById(`accordion-${id}`);
    const header = content.previousElementSibling;
    
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        header.classList.remove('collapsed');
    } else {
        content.classList.add('collapsed');
        header.classList.add('collapsed');
    }
}

// ============================================
// GESTIÓN DE CONFIGURACIÓN
// ============================================

function leerConfiguracion() {
    return {
        tipoInforme: document.querySelector('input[name="tipo-informe"]:checked')?.value || 'historico',
        agruparMes: document.getElementById('agrupar-mes')?.checked || false,
        agruparRubro: document.getElementById('agrupar-rubro')?.checked || false,
        agruparSubrubro: document.getElementById('agrupar-subrubro')?.checked || false,
        columnas: {
            descripcion: true,
            cantidad: document.getElementById('col-cantidad')?.checked || false,
            stockVisual: document.getElementById('col-stock-visual')?.checked || false,
            stockNumerico: document.getElementById('col-stock-numerico')?.checked || false,
            alicuotaIva: document.getElementById('col-alicuota-iva')?.checked || false,
            precioSinIva: document.getElementById('col-precio-sin-iva')?.checked || false,
            precioConIva: document.getElementById('col-precio-con-iva')?.checked || false,
            precioKgSinIva: document.getElementById('col-precio-kg-sin-iva')?.checked || false,
            precioKgConIva: document.getElementById('col-precio-kg-con-iva')?.checked || false,
            valorIva: document.getElementById('col-valor-iva')?.checked || false,
            valorIvaKg: document.getElementById('col-valor-iva-kg')?.checked || false
        }
    };
}

const COLUMNAS_DISPONIBLES = [
    { id: 'descripcion', label: 'Producto', align: 'left', siempreVisible: true },
    { id: 'cantidad', label: 'Cant.', align: 'center' },
    { id: 'stockVisual', label: 'Stock', align: 'center' },
    { id: 'stockNumerico', label: 'Stock #', align: 'center' },
    { id: 'alicuotaIva', label: 'IVA%', align: 'center' },
    { id: 'precioSinIva', label: 'Precio s/IVA', align: 'right' },
    { id: 'precioConIva', label: 'Precio c/IVA', align: 'right' },
    { id: 'precioKgSinIva', label: '$/Kg s/IVA', align: 'right' },
    { id: 'precioKgConIva', label: '$/Kg c/IVA', align: 'right' },
    { id: 'valorIva', label: 'Valor IVA', align: 'right' },
    { id: 'valorIvaKg', label: 'IVA/Kg', align: 'right' }
];

// ============================================
// GESTIÓN DE CHECKBOXES Y DEPENDENCIAS
// ============================================

function inicializarEstadoCheckboxes() {
    const checkRubro = document.getElementById('agrupar-rubro');
    const checkSubRubro = document.getElementById('agrupar-subrubro');
    
    if (checkRubro && checkSubRubro) {
        if (checkRubro.checked) {
            checkSubRubro.disabled = false;
            console.log('✅ [INIT] Sub-rubro habilitado');
        } else {
            checkSubRubro.disabled = true;
            checkSubRubro.checked = false;
            console.log('ℹ️ [INIT] Sub-rubro deshabilitado');
        }
    }
}

function manejarCambioRubro() {
    const checkRubro = document.getElementById('agrupar-rubro');
    const checkSubRubro = document.getElementById('agrupar-subrubro');
    
    if (checkRubro.checked) {
        checkSubRubro.disabled = false;
    } else {
        checkSubRubro.disabled = true;
        checkSubRubro.checked = false;
    }
    
    // Actualizar panel de filtros
    actualizarPanelFiltrosCompleto();
    
    // Renderizar informe
    renderizarInforme();
}

/**
 * Manejar cambio en checkbox de Agrupar por Mes
 * ✅ FIX: Actualiza el panel de filtros para sincronizar con el informe
 */
function manejarCambioAgrupacion() {
    // Actualizar panel de filtros (cambia entre plano y jerárquico)
    actualizarPanelFiltrosCompleto();
    
    // Renderizar informe
    renderizarInforme();
}

// ============================================
// GESTIÓN DEL PANEL DE FILTROS
// ============================================

function actualizarPanelFiltrosCompleto() {
    const config = leerConfiguracion();
    
    // Si no está agrupando por rubro, mostrar mensaje
    if (!config.agruparRubro) {
        const contenedor = document.getElementById('panel-filtros-rubros');
        if (contenedor) {
            contenedor.innerHTML = `
                <div class="filtro-empty">
                    Selecciona "Agrupar por Rubro" para activar filtros
                </div>
            `;
        }
        return;
    }
    
    if (!datosHistorial) return;
    
    // Obtener todos los productos
    const todosProductos = datosHistorial.grupos?.flatMap(g => g.productos) || [];
    
    // Determinar modo
    const incluirMeses = config.agruparMes && config.agruparRubro;
    
    // ✅ FIX: Solo inicializar si el estado está vacío o cambió el modo
    const modoActual = estadoFiltros.modo;
    const nuevoModo = incluirMeses ? 'jerarquico' : 'plano';
    
    if (modoActual !== nuevoModo || Object.keys(estadoFiltros[nuevoModo === 'plano' ? 'rubrosPlanos' : 'rubrosJerarquicos']).length === 0) {
        // Inicializar filtros solo si es necesario
        inicializarFiltros(todosProductos, incluirMeses);
    }
    
    // Renderizar panel con el estado actual (preservado)
    renderizarPanelSinReinicializar();
    
    console.log(`✅ [FILTROS] Panel actualizado (modo: ${estadoFiltros.modo})`);
}

/**
 * Renderizar panel sin reinicializar el estado
 * ✅ FIX: Preserva visibilidad y orden personalizados
 */
function renderizarPanelSinReinicializar() {
    const estructura = estadoFiltros.modo === 'plano' 
        ? estadoFiltros.rubrosPlanos 
        : estadoFiltros.rubrosJerarquicos;
    
    const html = renderizarPanelFiltros(estructura, estadoFiltros.modo);
    
    const contenedor = document.getElementById('panel-filtros-rubros');
    if (contenedor) {
        contenedor.innerHTML = html;
        
        // Inicializar drag & drop después de renderizar
        setTimeout(() => {
            if (estadoFiltros.modo === 'plano') {
                const container = document.getElementById('filtros-rubros-plano');
                if (container) {
                    inicializarDragDrop(container, handleReordenarRubros);
                }
            } else {
                // Inicializar en cada mes
                document.querySelectorAll('.filtro-mes-rubros').forEach(container => {
                    inicializarDragDrop(container, handleReordenarRubros);
                });
            }
        }, 100);
    }
}

// ============================================
// HANDLERS DE FILTROS (Expuestos Globalmente)
// ============================================

function handleToggleRubro(rubro, mesKey) {
    console.log(`👁️ [FILTROS] Toggle rubro: ${rubro} (mes: ${mesKey || 'N/A'})`);
    toggleVisibilidadRubro(rubro, mesKey);
    renderizarInforme();
}

function handleToggleMes(mesKey) {
    console.log(`👁️ [FILTROS] Toggle mes: ${mesKey}`);
    toggleVisibilidadMes(mesKey);
    renderizarInforme();
}

function handleReordenarRubros(rubro1, rubro2, mesKey) {
    console.log(`🔄 [FILTROS] Reordenar: ${rubro1} ↔ ${rubro2}`);
    reordenarRubros(rubro1, rubro2, mesKey);
    
    // ✅ FIX: Solo re-renderizar el panel SIN reinicializar el estado
    renderizarPanelSinReinicializar();
    
    // Re-renderizar informe
    renderizarInforme();
}

// ============================================
// CARGA DE DATOS
// ============================================

async function cargarDatos(clienteId) {
    try {
        // Cargar historial de entregas
        const responseHistorial = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);
        
        if (!responseHistorial.ok) {
            throw new Error(`Error HTTP ${responseHistorial.status}`);
        }
        
        const resultHistorial = await responseHistorial.json();
        
        if (!resultHistorial.success || !resultHistorial.data) {
            throw new Error('No se pudieron cargar los datos');
        }
        
        datosHistorial = resultHistorial.data;
        
        // Cargar datos del cliente
        try {
            const responseCliente = await fetch(`/api/presupuestos/clientes/${clienteId}/datos`);
            if (responseCliente.ok) {
                const resultCliente = await responseCliente.json();
                if (resultCliente.success && resultCliente.data) {
                    const cliente = resultCliente.data;
                    datosHistorial.cliente_nombre = `${cliente.apellido || ''} ${cliente.nombre || ''}`.trim() || null;
                }
            }
        } catch (errorCliente) {
            console.warn('⚠️ No se pudieron cargar datos del cliente, usando solo ID');
        }
        
        console.log(`✅ Datos cargados: ${datosHistorial.total_productos_unicos} productos`);
        
    } catch (error) {
        console.error('❌ Error al cargar datos:', error);
        mostrarError(`Error: ${error.message}`);
        throw error;
    }
}

// ============================================
// CÁLCULOS DE PRODUCTOS
// ============================================

function calcularValoresProducto(producto) {
    const precioBase = parseFloat(producto.precio_actual) || 0;
    const ivaAlicuota = parseFloat(producto.iva_actual) || 0;
    const kilos = parseFloat(producto.kilos_unidad) || 0;
    const stock = parseFloat(producto.stock_consolidado) || 0;
    
    const precioConIva = precioBase;
    const precioSinIva = precioBase / (1 + ivaAlicuota / 100);
    const valorIva = precioConIva - precioSinIva;
    
    const precioKgConIva = kilos > 0 ? precioConIva / kilos : 0;
    const precioKgSinIva = kilos > 0 ? precioSinIva / kilos : 0;
    const valorIvaKg = kilos > 0 ? valorIva / kilos : 0;
    
    return {
        precioConIva,
        precioSinIva,
        valorIva,
        precioKgConIva,
        precioKgSinIva,
        valorIvaKg,
        ivaAlicuota,
        kilos,
        stock,
        stockVisual: stock > 0 ? '✅' : 'Sin Stock'
    };
}

function generarCeldaProducto(columnaId, producto, valores) {
    const alineacion = COLUMNAS_DISPONIBLES.find(c => c.id === columnaId)?.align || 'left';
    const clase = `text-${alineacion}`;
    
    switch (columnaId) {
        case 'descripcion':
            return `<td>${producto.descripcion}</td>`;
        case 'cantidad':
            return `<td class="${clase}">${parseFloat(producto.cantidad || 0).toFixed(1)}</td>`;
        case 'stockVisual':
            return `<td class="${clase}" style="color: ${valores.stock > 0 ? '#27ae60' : '#e74c3c'}; font-weight: 600;">${valores.stockVisual}</td>`;
        case 'stockNumerico':
            return `<td class="${clase}">${Math.floor(valores.stock)}</td>`;
        case 'alicuotaIva':
            return `<td class="${clase} iva-naranja">${valores.ivaAlicuota.toFixed(1)}%</td>`;
        case 'precioSinIva':
            return `<td class="${clase} precio-verde">${formatearPrecio(valores.precioSinIva)}</td>`;
        case 'precioConIva':
            return `<td class="${clase} precio-verde">${formatearPrecio(valores.precioConIva)}</td>`;
        case 'precioKgSinIva':
            return valores.kilos > 0 ? `<td class="${clase} precio-kilo">${formatearPrecio(valores.precioKgSinIva)}</td>` : `<td class="${clase}">-</td>`;
        case 'precioKgConIva':
            if (valores.kilos > 0) {
                return `<td class="${clase} precio-kilo">${formatearPrecio(valores.precioKgConIva)}</td>`;
            } else {
                return `<td class="${clase}">
                    <button onclick="cargarPesoArticulo(event, '${producto.articulo_numero}', '${producto.descripcion.replace(/'/g, "\\'")}')" 
                            style="background: #f39c12; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85em;"
                            title="Cargar peso del artículo">⚖️ Cargar</button>
                </td>`;
            }
        case 'valorIva':
            return `<td class="${clase} iva-naranja">${formatearPrecio(valores.valorIva)}</td>`;
        case 'valorIvaKg':
            return valores.kilos > 0 ? `<td class="${clase} iva-naranja">${formatearPrecio(valores.valorIvaKg)}</td>` : `<td class="${clase}">-</td>`;
        default:
            return `<td class="${clase}">-</td>`;
    }
}

// ============================================
// AGRUPACIÓN DE PRODUCTOS
// ============================================

function calcularMesesAtras(fechaEntrega) {
    const ahora = new Date();
    const fecha = new Date(fechaEntrega);
    return (ahora.getFullYear() - fecha.getFullYear()) * 12 + (ahora.getMonth() - fecha.getMonth());
}

function obtenerNombreMes(fechaEntrega) {
    const fecha = new Date(fechaEntrega);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

function agruparPorMeses(productos) {
    const productosPorMes = {
        mes_0: { label: 'Mes Actual', productos: [] },
        mes_1: { label: 'Hace 1 mes', productos: [] },
        mes_2: { label: 'Hace 2 meses', productos: [] },
        mes_3: { label: 'Hace 3 meses', productos: [] },
        mes_4: { label: 'Hace 4 meses', productos: [] },
        mes_5: { label: 'Hace 5 meses', productos: [] },
        historico: { label: 'Más de 6 meses', productos: [] }
    };
    
    productos.forEach(p => {
        const mesesAtras = calcularMesesAtras(p.fecha_entrega);
        const key = mesesAtras <= 5 ? `mes_${mesesAtras}` : 'historico';
        productosPorMes[key].productos.push(p);
        
        if (mesesAtras <= 5 && productosPorMes[key].productos.length === 1) {
            productosPorMes[key].label = obtenerNombreMes(p.fecha_entrega);
        }
    });
    
    return Object.entries(productosPorMes)
        .filter(([key, mes]) => mes.productos.length > 0)
        .map(([key, mes]) => {
            // ✅ FIX: Usar 'historico' como mesKey para meses antiguos
            let mesKey;
            if (key === 'historico') {
                mesKey = 'historico';
            } else {
                const fecha = mes.productos[0].fecha_entrega;
                const fechaObj = new Date(fecha);
                mesKey = `${fechaObj.getFullYear()}-${String(fechaObj.getMonth() + 1).padStart(2, '0')}`;
            }
            
            return {
                tipo: 'mes',
                titulo: `📅 ${mes.label}`,
                productos: mes.productos,
                mesKey: mesKey
            };
        });
}

function agruparPorRubro(productos) {
    const porRubro = {};
    productos.forEach(p => {
        const rubro = p.rubro || 'Sin categoría';
        if (!porRubro[rubro]) porRubro[rubro] = [];
        porRubro[rubro].push(p);
    });
    return porRubro;
}

function agruparPorSubRubro(productos) {
    const porSubRubro = {};
    productos.forEach(p => {
        const subRubro = p.sub_rubro || 'Sin subcategoría';
        if (!porSubRubro[subRubro]) porSubRubro[subRubro] = [];
        porSubRubro[subRubro].push(p);
    });
    return porSubRubro;
}

function construirEstructuraAgrupacion(productos, config) {
    if (config.agruparMes) {
        return agruparPorMeses(productos);
    } else if (config.agruparRubro) {
        const productosPorRubro = agruparPorRubro(productos);
        
        // ✅ FIX: Usar orden personalizado del estado en modo plano
        let rubrosOrdenados;
        if (estadoFiltros.modo === 'plano' && Object.keys(estadoFiltros.rubrosPlanos).length > 0) {
            // Ordenar según el estado de filtros
            rubrosOrdenados = Object.keys(productosPorRubro)
                .map(rubro => ({
                    rubro,
                    orden: estadoFiltros.rubrosPlanos[rubro]?.orden ?? 999,
                    visible: estadoFiltros.rubrosPlanos[rubro]?.visible ?? true
                }))
                .filter(r => r.visible)
                .sort((a, b) => a.orden - b.orden)
                .map(r => r.rubro);
        } else {
            // Orden alfabético por defecto
            rubrosOrdenados = Object.keys(productosPorRubro).sort();
        }
        
        return rubrosOrdenados.map(rubro => ({
            tipo: 'rubro',
            titulo: `📦 ${rubro}`,
            productos: productosPorRubro[rubro]
        }));
    } else {
        return [{
            tipo: 'simple',
            titulo: 'Todos los productos',
            productos
        }];
    }
}

// ============================================
// APLICAR FILTROS A LA ESTRUCTURA
// ============================================

function aplicarFiltros(estructuraAgrupacion, config) {
    if (!config.agruparRubro) {
        return estructuraAgrupacion; // Sin filtros si no agrupa por rubro
    }
    
    if (estadoFiltros.modo === 'jerarquico') {
        // Filtrar meses y rubros
        return estructuraAgrupacion.filter(grupo => {
            if (grupo.tipo !== 'mes') return true;
            
            // Verificar si el mes es visible
            if (!esMesVisible(grupo.mesKey)) {
                return false;
            }
            
            return true;
        });
    }
    
    return estructuraAgrupacion;
}

function obtenerRubrosOrdenadosParaRenderizado(rubros, mesKey = null) {
    if (estadoFiltros.modo === 'plano') {
        // Obtener orden de rubros desde estado
        const rubrosConOrden = rubros.map(rubro => ({
            rubro,
            orden: estadoFiltros.rubrosPlanos[rubro]?.orden ?? 999,
            visible: estadoFiltros.rubrosPlanos[rubro]?.visible ?? true
        }));
        
        return rubrosConOrden
            .filter(r => r.visible)
            .sort((a, b) => a.orden - b.orden)
            .map(r => r.rubro);
    } else if (mesKey && estadoFiltros.rubrosJerarquicos[mesKey]) {
        // Obtener orden de rubros dentro del mes
        const rubrosDelMes = estadoFiltros.rubrosJerarquicos[mesKey].rubros;
        
        const rubrosConOrden = rubros.map(rubro => ({
            rubro,
            orden: rubrosDelMes[rubro]?.orden ?? 999,
            visible: rubrosDelMes[rubro]?.visible ?? true
        }));
        
        return rubrosConOrden
            .filter(r => r.visible)
            .sort((a, b) => a.orden - b.orden)
            .map(r => r.rubro);
    }
    
    return rubros;
}

// ============================================
// RENDERIZADO DEL INFORME
// ============================================

function renderizarInforme() {
    console.log('🎨 [PREVIEW-HISTORIAL] Renderizando informe con filtros...');
    
    if (!datosHistorial) {
        console.warn('⚠️ No hay datos para renderizar');
        return;
    }
    
    const config = leerConfiguracion();
    const columnasActivas = COLUMNAS_DISPONIBLES.filter(col => 
        col.siempreVisible || config.columnas[col.id]
    );
    
    const todosProductos = datosHistorial.grupos?.flatMap(g => g.productos) || [];
    let estructuraAgrupacion = construirEstructuraAgrupacion(todosProductos, config);
    
    // ✅ APLICAR FILTROS
    estructuraAgrupacion = aplicarFiltros(estructuraAgrupacion, config);
    
    let html = generarHeaderInforme();
    
    let totalProductos = 0;
    let sumaPreciosConIva = 0;
    let sumaPreciosSinIva = 0;
    let sumaIva = 0;
    
    // Renderizar cada grupo
    estructuraAgrupacion.forEach(grupo => {
        if (config.agruparMes && grupo.tipo === 'mes') {
            html += `
                <div style="margin: 30px 0 20px 0; padding: 12px 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; font-size: 1.2em; font-weight: 700; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    ${grupo.titulo}
                </div>
            `;
            
            if (config.agruparRubro) {
                const productosPorRubro = agruparPorRubro(grupo.productos);
                
                // ✅ APLICAR ORDEN Y FILTROS DE RUBROS
                const rubrosOrdenados = obtenerRubrosOrdenadosParaRenderizado(
                    Object.keys(productosPorRubro),
                    grupo.mesKey
                );
                
                rubrosOrdenados.forEach(rubro => {
                    if (config.agruparSubrubro) {
                        // ✅ NUEVA LÓGICA: Tabla unificada con sub-rubros integrados
                        const productosPorSubRubro = agruparPorSubRubro(productosPorRubro[rubro]);
                        const resultado = renderizarTablaConSubRubros(rubro, productosPorSubRubro, columnasActivas);
                        html += resultado.html;
                        totalProductos += resultado.totales.productos;
                        sumaPreciosConIva += resultado.totales.preciosConIva;
                        sumaPreciosSinIva += resultado.totales.preciosSinIva;
                        sumaIva += resultado.totales.iva;
                    } else {
                        const resultado = renderizarTablaProductos(rubro, productosPorRubro[rubro], columnasActivas);
                        html += resultado.html;
                        totalProductos += resultado.totales.productos;
                        sumaPreciosConIva += resultado.totales.preciosConIva;
                        sumaPreciosSinIva += resultado.totales.preciosSinIva;
                        sumaIva += resultado.totales.iva;
                    }
                });
            } else {
                const resultado = renderizarTablaProductos('Productos', grupo.productos, columnasActivas);
                html += resultado.html;
                totalProductos += resultado.totales.productos;
                sumaPreciosConIva += resultado.totales.preciosConIva;
                sumaPreciosSinIva += resultado.totales.preciosSinIva;
                sumaIva += resultado.totales.iva;
            }
        } else if (grupo.tipo === 'rubro') {
            // Modo plano: solo rubros
            const productosPorRubro = { [grupo.titulo.replace('📦 ', '')]: grupo.productos };
            
            // ✅ APLICAR ORDEN Y FILTROS
            const rubrosOrdenados = obtenerRubrosOrdenadosParaRenderizado(
                Object.keys(productosPorRubro),
                null
            );
            
            rubrosOrdenados.forEach(rubro => {
                if (config.agruparSubrubro) {
                    // ✅ NUEVA LÓGICA: Tabla unificada con sub-rubros integrados
                    const productosPorSubRubro = agruparPorSubRubro(productosPorRubro[rubro]);
                    const resultado = renderizarTablaConSubRubros(rubro, productosPorSubRubro, columnasActivas);
                    html += resultado.html;
                    totalProductos += resultado.totales.productos;
                    sumaPreciosConIva += resultado.totales.preciosConIva;
                    sumaPreciosSinIva += resultado.totales.preciosSinIva;
                    sumaIva += resultado.totales.iva;
                } else {
                    const resultado = renderizarTablaProductos(rubro, productosPorRubro[rubro], columnasActivas);
                    html += resultado.html;
                    totalProductos += resultado.totales.productos;
                    sumaPreciosConIva += resultado.totales.preciosConIva;
                    sumaPreciosSinIva += resultado.totales.preciosSinIva;
                    sumaIva += resultado.totales.iva;
                }
            });
        } else {
            const resultado = renderizarTablaProductos(grupo.titulo, grupo.productos, columnasActivas);
            html += resultado.html;
            totalProductos += resultado.totales.productos;
            sumaPreciosConIva += resultado.totales.preciosConIva;
            sumaPreciosSinIva += resultado.totales.preciosSinIva;
            sumaIva += resultado.totales.iva;
        }
    });
    
    html += generarSeccionTotales(totalProductos, sumaPreciosSinIva, sumaIva, sumaPreciosConIva, config);
    
    const hoja = document.getElementById('hoja-informe');
    if (hoja) {
        hoja.innerHTML = html;
        console.log('✅ Informe renderizado exitosamente');
    }
}

/**
 * Renderizar tabla de productos con sub-rubros integrados
 * ✅ NUEVA LÓGICA: Una sola tabla por rubro, sub-rubros como separadores internos
 */
function renderizarTablaProductos(titulo, productos, columnasActivas, esSubRubro = false) {
    // ✅ DISEÑO MINIMALISTA: Sin fondos de color, solo tipografía y líneas
    let html = `
        <div class="rubro-grupo">
            ${esSubRubro 
                ? `<div class="subrubro-header">${titulo}</div>` 
                : `<div class="rubro-header">${titulo}</div>`
            }
            <table class="productos-table">
                <thead><tr>
    `;
    
    columnasActivas.forEach(col => {
        html += `<th class="text-${col.align}">${col.label}</th>`;
    });
    
    html += `</tr></thead><tbody>`;
    
    let totales = {
        productos: 0,
        preciosConIva: 0,
        preciosSinIva: 0,
        iva: 0
    };
    
    productos.forEach(producto => {
        const valores = calcularValoresProducto(producto);
        html += '<tr>';
        columnasActivas.forEach(col => {
            html += generarCeldaProducto(col.id, producto, valores);
        });
        html += '</tr>';
        
        totales.productos++;
        totales.preciosConIva += valores.precioConIva;
        totales.preciosSinIva += valores.precioSinIva;
        totales.iva += valores.valorIva;
    });
    
    html += `</tbody></table></div>`;
    
    return { html, totales };
}

/**
 * Renderizar tabla unificada con sub-rubros como separadores internos
 * ✅ OPTIMIZACIÓN: Encabezados de columna UNA SOLA VEZ por rubro
 */
function renderizarTablaConSubRubros(tituloRubro, productosPorSubRubro, columnasActivas) {
    let html = `
        <div class="rubro-grupo">
            <div class="rubro-header">${tituloRubro}</div>
            <table class="productos-table">
                <thead><tr>
    `;
    
    // Encabezados de columna UNA SOLA VEZ
    columnasActivas.forEach(col => {
        html += `<th class="text-${col.align}">${col.label}</th>`;
    });
    
    html += `</tr></thead><tbody>`;
    
    let totales = {
        productos: 0,
        preciosConIva: 0,
        preciosSinIva: 0,
        iva: 0
    };
    
    // Ordenar sub-rubros alfabéticamente
    const subRubrosOrdenados = Object.keys(productosPorSubRubro).sort();
    
    subRubrosOrdenados.forEach((subRubro, index) => {
        const productosSubRubro = productosPorSubRubro[subRubro];
        
        // Insertar separador de sub-rubro (excepto el primero)
        if (index > 0 || subRubrosOrdenados.length > 1) {
            html += `
                <tr class="subrubro-separator">
                    <td colspan="${columnasActivas.length}">${subRubro}</td>
                </tr>
            `;
        }
        
        // Productos del sub-rubro
        productosSubRubro.forEach(producto => {
            const valores = calcularValoresProducto(producto);
            html += '<tr>';
            columnasActivas.forEach(col => {
                html += generarCeldaProducto(col.id, producto, valores);
            });
            html += '</tr>';
            
            totales.productos++;
            totales.preciosConIva += valores.precioConIva;
            totales.preciosSinIva += valores.precioSinIva;
            totales.iva += valores.valorIva;
        });
    });
    
    html += `</tbody></table></div>`;
    
    return { html, totales };
}

function generarHeaderInforme() {
    const fechaActual = new Date().toLocaleDateString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    });
    
    return `
        <div class="informe-header">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                <div>
                    <h2 style="font-size: 1.4em; font-weight: 700; color: #2c3e50; margin: 0;">LAMDA</h2>
                    <p style="font-size: 0.85em; color: #7f8c8d; margin: 2px 0 0 0;">Gestiones Integrales</p>
                </div>
                <div style="text-align: right;">
                    <p style="font-size: 0.85em; color: #7f8c8d; margin: 0;">Fecha: ${fechaActual}</p>
                </div>
            </div>
            
            <h1 style="font-size: 1.3em; font-weight: 600; color: #34495e; margin: 15px 0 10px 0; text-align: center;">
                Lista para actualizar precios
            </h1>
            
            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px 15px; margin: 15px 0 25px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <p style="font-size: 1.1em; font-weight: 700; color: #2c3e50; margin: 0 0 4px 0;">
                            Cliente: ${datosHistorial.cliente_nombre || 'Cliente ID: ' + datosHistorial.cliente_id}
                        </p>
                        <p style="font-size: 0.8em; color: #7f8c8d; margin: 0;">
                            N° Cliente: ${datosHistorial.cliente_id}
                        </p>
                    </div>
                </div>
            </div>
            
            <p style="font-size: 0.8em; color: #95a5a6; text-align: center; margin: 0 0 20px 0; font-style: italic;">
                Basado en historial de compras
            </p>
        </div>
    `;
}

function generarSeccionTotales(totalProductos, subtotal, iva, total, config) {
    // ✅ ELIMINADO: No se muestran totales ni notas finales
    return '';
}

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

function imprimirInforme() {
    console.log('🖨️ Iniciando impresión...');
    window.print();
}

function volverAtras() {
    console.log('← Volviendo...');
    try {
        window.close();
        setTimeout(() => {
            if (!window.closed) {
                window.history.back();
            }
        }, 100);
    } catch (error) {
        window.history.back();
    }
}

function mostrarError(mensaje) {
    const hoja = document.getElementById('hoja-informe');
    if (hoja) {
        hoja.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #e74c3c;">
                <h2 style="margin-bottom: 15px;">⚠️ Error</h2>
                <p>${mensaje}</p>
                <button onclick="volverAtras()" style="margin-top: 20px; padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    ← Volver
                </button>
            </div>
        `;
    }
}

async function cargarPesoArticulo(event, articuloNumero, descripcion) {
    console.log(`⚖️ [CARGAR-PESO] Iniciando carga de peso para: ${articuloNumero}`);
    
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    const pesoStr = prompt(
        `⚖️ Cargar Peso del Artículo\n\n` +
        `Producto: ${descripcion}\n` +
        `Código: ${articuloNumero}\n\n` +
        `Ingrese la cantidad de Kilos/Unidades por bulto:`,
        ''
    );
    
    if (pesoStr === null) {
        console.log(`⚖️ [CARGAR-PESO] Usuario canceló`);
        return;
    }
    
    const peso = parseFloat(pesoStr);
    
    if (isNaN(peso) || peso <= 0) {
        alert('❌ Error: Debe ingresar un número positivo válido');
        return;
    }
    
    let originalText = '';
    if (event && event.target) {
        originalText = event.target.innerHTML;
        event.target.innerHTML = '⏳ Guardando...';
        event.target.disabled = true;
    }
    
    try {
        const response = await fetch(`http://localhost:3005/api/logistica/articulos/${articuloNumero}/peso`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kilos_unidad: peso })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al actualizar el peso');
        }
        
        console.log(`✅ [CARGAR-PESO] Peso actualizado exitosamente`);
        
        alert(`✅ Peso actualizado correctamente\n\nArtículo: ${descripcion}\nPeso: ${peso} kg\n\nEl informe se recargará.`);
        
        const urlParams = new URLSearchParams(window.location.search);
        const clienteId = urlParams.get('cliente_id');
        
        await cargarDatos(clienteId);
        renderizarInforme();
        
    } catch (error) {
        console.error(`❌ [CARGAR-PESO] Error:`, error);
        alert(`❌ Error al actualizar el peso:\n\n${error.message}`);
        
        if (event && event.target) {
            event.target.innerHTML = originalText;
            event.target.disabled = false;
        }
    }
}

// ============================================
// PANEL RESIZABLE
// ============================================

function inicializarPanelResizable() {
    const panel = document.getElementById('panel-config');
    const resizer = document.getElementById('panel-resizer');
    
    if (!panel || !resizer) {
        console.warn('⚠️ [RESIZE] Elementos no encontrados');
        return;
    }
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    const minWidth = 250;
    const maxWidth = 600;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        console.log('🔧 [RESIZE] Iniciando resize del panel');
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        
        // Aplicar límites
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            panel.style.width = `${newWidth}px`;
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            console.log(`✅ [RESIZE] Panel redimensionado a: ${panel.offsetWidth}px`);
        }
    });
    
    console.log('✅ [RESIZE] Panel resizable inicializado');
}

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔍 [PREVIEW-HISTORIAL] Inicializando página...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const clienteId = urlParams.get('cliente_id');
    
    if (!clienteId) {
        mostrarError('No se especificó un cliente');
        return;
    }
    
    inicializarEstadoCheckboxes();
    inicializarPanelResizable();
    
    await cargarDatos(clienteId);
    
    // Inicializar panel de filtros
    actualizarPanelFiltrosCompleto();
    
    // Renderizar informe
    renderizarInforme();
    
    console.log('✅ [PREVIEW-HISTORIAL] Página inicializada con módulos ES6');
});

// ============================================
// EXPONER FUNCIONES GLOBALMENTE
// ============================================

window.toggleAccordion = toggleAccordion;
window.manejarCambioRubro = manejarCambioRubro;
window.manejarCambioAgrupacion = manejarCambioAgrupacion;
window.renderizarInforme = renderizarInforme;
window.imprimirInforme = imprimirInforme;
window.volverAtras = volverAtras;
window.cargarPesoArticulo = cargarPesoArticulo;
window.handleToggleRubro = handleToggleRubro;
window.handleToggleMes = handleToggleMes;

console.log('✅ [PREVIEW-HISTORIAL] Módulo principal cargado correctamente');
