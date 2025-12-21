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
            descuento5Kg: document.getElementById('col-descuento-5-kg')?.checked || false,
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
    { id: 'precioSinIva', label: 'Precio s/I', align: 'right' },
    { id: 'precioConIva', label: 'Precio c/I', align: 'right' },
    { id: 'precioKgSinIva', label: '$/Kg/u s/I', align: 'right' },
    { id: 'precioKgConIva', label: '$/Kg/u c/I', align: 'right' },
    { id: 'descuento5Kg', label: '5% U/K c/I', align: 'right' },
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

/**
 * Handler para reordenar rubros
 * ✅ MEJORADO: Recibe parámetro insertarAntes para inserción con desplazamiento
 */
function handleReordenarRubros(rubro1, rubro2, mesKey, insertarAntes) {
    console.log(`🔄 [FILTROS] Reordenar: ${rubro1} ${insertarAntes ? 'ANTES' : 'DESPUÉS'} de ${rubro2}`);
    reordenarRubros(rubro1, rubro2, mesKey, insertarAntes);
    
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
        // Cargar historial de entregas (ya incluye datos del cliente desde el backend)
        const responseHistorial = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);
        
        if (!responseHistorial.ok) {
            throw new Error(`Error HTTP ${responseHistorial.status}`);
        }
        
        const resultHistorial = await responseHistorial.json();
        
        if (!resultHistorial.success || !resultHistorial.data) {
            throw new Error('No se pudieron cargar los datos');
        }
        
        datosHistorial = resultHistorial.data;
        
        console.log(`✅ Datos cargados: ${datosHistorial.total_productos_unicos} productos`);
        console.log(`👤 Cliente: ${datosHistorial.cliente_apellido || ''} ${datosHistorial.cliente_nombre || ''} (ID: ${datosHistorial.cliente_id})`);
        
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
    // ✅ CORRECCIÓN CRÍTICA: precio_actual del backend es el PRECIO NETO (sin IVA)
    const precioNeto = parseFloat(producto.precio_actual) || 0;  // ← NETO desde BD
    const ivaAlicuota = parseFloat(producto.iva_actual) || 0;
    const kilos = parseFloat(producto.kilos_unidad) || 0;
    const stock = parseFloat(producto.stock_consolidado) || 0;
    const esProducible = producto.es_producible === true;
    
    // ✅ CÁLCULO CORRECTO: Aplicar IVA sobre el neto (igual que presupuestosCreate.js)
    const precioSinIva = precioNeto;  // ← El neto ES el precio sin IVA
    const precioConIva = precioNeto * (1 + ivaAlicuota / 100);  // ← Aplicar IVA
    const valorIva = precioConIva - precioSinIva;  // ← Diferencia = monto del IVA
    
    // ✅ CÁLCULO CORRECTO: Precios por Kg/Unidad
    const precioKgSinIva = kilos > 0 ? precioSinIva / kilos : 0;
    const precioKgConIva = kilos > 0 ? precioConIva / kilos : 0;
    const valorIvaKg = kilos > 0 ? valorIva / kilos : 0;
    
    // ✅ CORRECTO: Precio con 5% de descuento sobre precio x Kg/u con IVA
    const descuento5PorKg = kilos > 0 ? precioKgConIva * 0.95 : 0;
    
    // ✅ NUEVO: Stock Inteligente - Determinar visualización según stock y producibilidad
    let stockVisual;
    let stockColor;
    let stockTooltip;
    
    if (stock > 0) {
        stockVisual = '✅';
        stockColor = '#27ae60';
        stockTooltip = 'En stock';
    } else if (esProducible) {
        stockVisual = '🛠️ Req. Prod.';
        stockColor = '#d35400';
        stockTooltip = 'Sin stock - Ingredientes disponibles para producir';
    } else {
        stockVisual = 's/Stk-Consultar';
        stockColor = '#e74c3c';
        stockTooltip = 'Sin stock';
    }
    
    return {
        precioConIva,
        precioSinIva,
        valorIva,
        precioKgConIva,
        precioKgSinIva,
        valorIvaKg,
        descuento5PorKg,
        ivaAlicuota,
        kilos,
        stock,
        stockVisual,
        stockColor,
        stockTooltip
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
            return `<td class="${clase}" style="color: ${valores.stockColor}; font-weight: 600;" title="${valores.stockTooltip}">${valores.stockVisual}</td>`;
        case 'stockNumerico':
            return `<td class="${clase}">${Math.floor(valores.stock)}</td>`;
        case 'alicuotaIva':
            return `<td class="${clase}" style="color: #2c3e50;">${valores.ivaAlicuota.toFixed(1)}%</td>`;
        case 'precioSinIva':
            return `<td class="${clase}" style="color: #666; font-weight: 500;">${formatearPrecio(valores.precioSinIva)}</td>`;
        case 'precioConIva':
            return `<td class="${clase}" style="color: #2c3e50; font-weight: 600;">${formatearPrecio(valores.precioConIva)}</td>`;
        case 'precioKgSinIva':
            return valores.kilos > 0 ? `<td class="${clase}" style="color: #666; font-weight: 500;">${formatearPrecio(valores.precioKgSinIva)}</td>` : `<td class="${clase}">-</td>`;
        case 'precioKgConIva':
            if (valores.kilos > 0) {
                return `<td class="${clase}" style="color: #2c3e50; font-weight: 600;">${formatearPrecio(valores.precioKgConIva)}</td>`;
            } else {
                return `<td class="${clase}">
                    <button onclick="cargarPesoArticulo(event, '${producto.articulo_numero}', '${producto.descripcion.replace(/'/g, "\\'")}')" 
                            style="background: #f39c12; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85em;"
                            title="Cargar peso del artículo">⚖️ Cargar</button>
                </td>`;
            }
        case 'descuento5Kg':
            return valores.kilos > 0 ? `<td class="${clase}" style="color: #e67e22; font-weight: 700;">${formatearPrecio(valores.descuento5PorKg)}</td>` : `<td class="${clase}">-</td>`;
        case 'valorIva':
            return `<td class="${clase}" style="color: #2c3e50;">${formatearPrecio(valores.valorIva)}</td>`;
        case 'valorIvaKg':
            return valores.kilos > 0 ? `<td class="${clase}" style="color: #2c3e50;">${formatearPrecio(valores.valorIvaKg)}</td>` : `<td class="${clase}">-</td>`;
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
    
    // ✅ NUEVO: Agregar glosario dinámico de referencias
    html += generarGlosarioReferencias(columnasActivas);
    
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
        
        // ✅ NUEVO: Si es un PACK, agregar sub-fila con precio UNITARIO alineado a columnas $/Kg/u
        if (producto.es_pack && producto.pack_unidades > 0) {
            const pesoUnidad = valores.kilos > 0 ? (valores.kilos / producto.pack_unidades) : 0;
            const precioUnidadConIva = valores.precioConIva / producto.pack_unidades;
            const precioUnidadSinIva = valores.precioSinIva / producto.pack_unidades;
            const precioUnidadConDescuento = precioUnidadConIva * 0.95; // 5% de descuento
            
            html += '<tr class="pack-info-row" style="background-color: #f9f9f9;">';
            
            columnasActivas.forEach(col => {
                const alineacion = col.align;
                const clase = `text-${alineacion}`;
                
                if (col.id === 'descripcion') {
                    // Mostrar etiqueta descriptiva con indentación y peso formateado
                    let pesoTexto = '';
                    if (pesoUnidad > 0) {
                        if (pesoUnidad >= 1) {
                            // 1 Kg o más: mostrar en Kg
                            pesoTexto = ` (${parseFloat(pesoUnidad.toFixed(3))} Kg)`;
                        } else {
                            // Menos de 1 Kg: mostrar en gramos
                            pesoTexto = ` (${Math.round(pesoUnidad * 1000)} g)`;
                        }
                    }
                    html += `<td style="padding-left: 30px; font-size: 0.9em; color: #546e7a; font-style: italic;">↳ Precio x Unidad${pesoTexto}:</td>`;
                } else if (col.id === 'precioKgSinIva') {
                    // Precio unitario SIN IVA (alineado con columna $/Kg/u s/I)
                    html += `<td class="${clase}" style="font-weight: 700; color: #666; font-size: 0.9em;">${formatearPrecio(precioUnidadSinIva)}</td>`;
                } else if (col.id === 'precioKgConIva') {
                    // Precio unitario CON IVA (alineado con columna $/Kg/u c/I)
                    html += `<td class="${clase}" style="font-weight: 700; color: #17a2b8; font-size: 0.9em;">${formatearPrecio(precioUnidadConIva)}</td>`;
                } else if (col.id === 'descuento5Kg') {
                    // Precio unitario CON 5% de descuento (alineado con columna 5% U/K c/I)
                    html += `<td class="${clase}" style="font-weight: 700; color: #e67e22; font-size: 0.9em;">${formatearPrecio(precioUnidadConDescuento)}</td>`;
                } else {
                    // Celda vacía para otras columnas
                    html += '<td></td>';
                }
            });
            
            html += '</tr>';
        }
        
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
            
            // ✅ NUEVO: Si es un PACK, agregar sub-fila con precio UNITARIO alineado a columnas $/Kg/u
            if (producto.es_pack && producto.pack_unidades > 0) {
                const pesoUnidad = valores.kilos > 0 ? (valores.kilos / producto.pack_unidades) : 0;
                const precioUnidadConIva = valores.precioConIva / producto.pack_unidades;
                const precioUnidadSinIva = valores.precioSinIva / producto.pack_unidades;
                const precioUnidadConDescuento = precioUnidadConIva * 0.95; // 5% de descuento
                
                html += '<tr class="pack-info-row" style="background-color: #f9f9f9;">';
                
                columnasActivas.forEach(col => {
                    const alineacion = col.align;
                    const clase = `text-${alineacion}`;
                    
                    if (col.id === 'descripcion') {
                        // Mostrar etiqueta descriptiva con indentación y peso formateado
                        let pesoTexto = '';
                        if (pesoUnidad > 0) {
                            if (pesoUnidad >= 1) {
                                // 1 Kg o más: mostrar en Kg
                                pesoTexto = ` (${parseFloat(pesoUnidad.toFixed(3))} Kg)`;
                            } else {
                                // Menos de 1 Kg: mostrar en gramos
                                pesoTexto = ` (${Math.round(pesoUnidad * 1000)} g)`;
                            }
                        }
                        html += `<td style="padding-left: 30px; font-size: 0.9em; color: #546e7a; font-style: italic;">↳ Precio x Unidad${pesoTexto}:</td>`;
                    } else if (col.id === 'precioKgSinIva') {
                        // Precio unitario SIN IVA (alineado con columna $/Kg/u s/I)
                        html += `<td class="${clase}" style="font-weight: 700; color: #666; font-size: 0.9em;">${formatearPrecio(precioUnidadSinIva)}</td>`;
                    } else if (col.id === 'precioKgConIva') {
                        // Precio unitario CON IVA (alineado con columna $/Kg/u c/I)
                        html += `<td class="${clase}" style="font-weight: 700; color: #17a2b8; font-size: 0.9em;">${formatearPrecio(precioUnidadConIva)}</td>`;
                    } else if (col.id === 'descuento5Kg') {
                        // Precio unitario CON 5% de descuento (alineado con columna 5% U/K c/I)
                        html += `<td class="${clase}" style="font-weight: 700; color: #e67e22; font-size: 0.9em;">${formatearPrecio(precioUnidadConDescuento)}</td>`;
                    } else {
                        // Celda vacía para otras columnas
                        html += '<td></td>';
                    }
                });
                
                html += '</tr>';
            }
            
            totales.productos++;
            totales.preciosConIva += valores.precioConIva;
            totales.preciosSinIva += valores.precioSinIva;
            totales.iva += valores.valorIva;
        });
    });
    
    html += `</tbody></table></div>`;
    
    return { html, totales };
}

/**
 * Generar glosario dinámico de referencias
 * Solo muestra definiciones de columnas activas
 * Layout: Dos columnas usando CSS Grid
 */
function generarGlosarioReferencias(columnasActivas) {
    // Mapeo de columnas a sus definiciones
    const definiciones = {
        'precioSinIva': 'Precio s/I = Precio unitario sin IVA',
        'precioConIva': 'Precio c/I = Precio unitario con IVA',
        'precioKgSinIva': '$/Kg/u s/I = Precio por Kilo/Unidad sin IVA',
        'precioKgConIva': '$/Kg/u c/I = Precio por Kilo/Unidad con IVA',
        'descuento5Kg': '5% U/K c/I = Precio por Kilo/Unidad con IVA, con 5% de descuento',
        'alicuotaIva': 'IVA% = Alícuota del impuesto',
        'valorIva': 'Valor IVA = Monto del impuesto en pesos',
        'valorIvaKg': 'IVA/Kg = Valor del IVA por Kilo/Unidad'
    };
    
    // Filtrar solo las columnas activas que tienen definición
    const referenciasActivas = columnasActivas
        .filter(col => definiciones[col.id])
        .map(col => definiciones[col.id]);
    
    // Si no hay referencias, no mostrar nada
    if (referenciasActivas.length === 0) {
        return '';
    }
    
    // Generar items del grid (cada referencia es un div)
    const itemsHtml = referenciasActivas
        .map(ref => `<div style="font-size: 0.7rem; color: #546e7a; line-height: 1.4;">${ref}</div>`)
        .join('');
    
    // Generar HTML del glosario con CSS Grid
    return `
        <div style="background: #f8f9fa; border-left: 4px solid #3498db; padding: 12px 15px; margin: 0 0 25px 0; border-radius: 4px;">
            <p style="font-size: 0.75em; color: #2c3e50; margin: 0 0 8px 0; font-weight: 600;">
                Referencias:
            </p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px 20px;">
                ${itemsHtml}
            </div>
        </div>
    `;
}

function generarHeaderInforme() {
    const fechaActual = new Date().toLocaleDateString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    });
    
    // Construir nombre completo del cliente
    console.log('📋 [HEADER] Datos del cliente:', {
        cliente_id: datosHistorial.cliente_id,
        cliente_nombre: datosHistorial.cliente_nombre,
        cliente_apellido: datosHistorial.cliente_apellido
    });
    
    const nombreCompleto = `${datosHistorial.cliente_apellido || ''} ${datosHistorial.cliente_nombre || ''}`.trim();
    const nombreMostrar = nombreCompleto || `Cliente ID: ${datosHistorial.cliente_id}`;
    
    console.log('📋 [HEADER] Nombre a mostrar:', nombreMostrar);
    
    return `
        <div class="informe-header">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                <div>
                    <h2 style="font-size: 1.4em; font-weight: 700; color: #2c3e50; margin: 0;">LAMDA</h2>
                    <p style="font-size: 0.85em; color: #7f8c8d; margin: 2px 0 0 0;">Gestiones Integrales</p>
                    <p style="font-size: 0.9em; color: #27ae60; margin: 4px 0 0 0; font-weight: 600;">
                        📱 221 661-5746
                    </p>
                </div>
                <div style="text-align: right;">
                    <p style="font-size: 0.85em; color: #7f8c8d; margin: 0;">Fecha: ${fechaActual}</p>
                </div>
            </div>
            
            <h1 style="font-size: 1.3em; font-weight: 600; color: #34495e; margin: 15px 0 10px 0; text-align: center;">
                Lista personalizada
            </h1>
            
            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px 15px; margin: 15px 0 15px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <p style="font-size: 1.1em; font-weight: 700; color: #2c3e50; margin: 0 0 4px 0;">
                            Cliente: ${nombreMostrar}
                        </p>
                        <p style="font-size: 0.8em; color: #7f8c8d; margin: 0;">
                            N° Cliente: ${datosHistorial.cliente_id}
                        </p>
                    </div>
                </div>
            </div>
            
            <p style="font-size: 0.8em; color: #95a5a6; text-align: center; margin: 0 0 15px 0; font-style: italic;">
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
    
    // ✅ Actualizar título del documento para nombre de archivo PDF
    const tituloOriginal = document.title;
    
    if (datosHistorial) {
        const clienteId = datosHistorial.cliente_id || '';
        const nombreCompleto = `${datosHistorial.cliente_apellido || ''} ${datosHistorial.cliente_nombre || ''}`.trim();
        const nombreCliente = nombreCompleto || `Cliente ${clienteId}`;
        
        // Obtener fecha actual en formato DD-MM-YYYY
        const ahora = new Date();
        const dia = String(ahora.getDate()).padStart(2, '0');
        const mes = String(ahora.getMonth() + 1).padStart(2, '0');
        const anio = ahora.getFullYear();
        const fechaFormato = `${dia}-${mes}-${anio}`;
        
        // Formato: [Nro Cliente] [Nombre Cliente] - Precios Historial - Gestion-LAMDA - [DD-MM-YYYY]
        const nuevoTitulo = `${clienteId} ${nombreCliente} - Precios Historial - Gestion-LAMDA - ${fechaFormato}`;
        
        console.log(`📄 [IMPRIMIR] Título PDF: "${nuevoTitulo}"`);
        document.title = nuevoTitulo;
    }
    
    // Ejecutar impresión
    window.print();
    
    // Restaurar título original después de imprimir
    setTimeout(() => {
        document.title = tituloOriginal;
        console.log('📄 [IMPRIMIR] Título restaurado');
    }, 1000);
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
// GESTIÓN DE ORIENTACIÓN DE PÁGINA
// ============================================

/**
 * Cambiar orientación de página (Portrait/Landscape)
 * Actualiza tanto la vista previa como el CSS de impresión
 */
function cambiarOrientacion() {
    const orientacion = document.querySelector('input[name="orientacion"]:checked')?.value || 'portrait';
    const hoja = document.getElementById('hoja-informe');
    
    console.log(`📄 [ORIENTACION] Cambiando a: ${orientacion}`);
    
    if (!hoja) return;
    
    // Actualizar dimensiones de la vista previa
    if (orientacion === 'landscape') {
        // A4 Apaisada: 297mm x 210mm
        hoja.style.width = '297mm';
        hoja.style.minHeight = '210mm';
    } else {
        // A4 Vertical: 210mm x 297mm
        hoja.style.width = '210mm';
        hoja.style.minHeight = '297mm';
    }
    
    // Actualizar regla @page dinámicamente
    actualizarReglaPaginaImpresion(orientacion);
    
    console.log(`✅ [ORIENTACION] Vista previa actualizada a ${orientacion}`);
}

/**
 * Actualizar regla @page para impresión
 * Inyecta CSS dinámico para controlar la orientación de impresión
 */
function actualizarReglaPaginaImpresion(orientacion) {
    // Buscar o crear el elemento <style> para reglas dinámicas
    let styleElement = document.getElementById('dynamic-print-styles');
    
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'dynamic-print-styles';
        document.head.appendChild(styleElement);
    }
    
    // Definir regla @page según orientación
    const cssRule = orientacion === 'landscape'
        ? `@media print { @page { size: A4 landscape; margin: 10mm 15mm; } }`
        : `@media print { @page { size: A4 portrait; margin: 15mm 10mm; } }`;
    
    styleElement.textContent = cssRule;
    
    console.log(`📄 [ORIENTACION] Regla @page actualizada: ${orientacion}`);
}

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
window.cambiarOrientacion = cambiarOrientacion;

console.log('✅ [PREVIEW-HISTORIAL] Módulo principal cargado correctamente');
