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
    toggleVisibilidadSubRubro,
    toggleVisibilidadMes,
    reordenarRubros,
    esRubroVisible,
    esSubRubroVisible,
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
let articulosExcluidos = [];
let clienteIdActual = null;
let politicaClienteActual = null;

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
    
    // ✅ NUEVO: Sincronizar controles según tipo de informe inicial
    sincronizarControlesPorTipoInforme();
}

/**
 * Sincronizar controles de configuración según el tipo de informe
 * ✅ NUEVO: Deshabilita "Agrupar por Mes" en modo Catálogo
 */
function sincronizarControlesPorTipoInforme() {
    const config = leerConfiguracion();
    const checkMes = document.getElementById('agrupar-mes');
    const labelMes = document.querySelector('label[for="agrupar-mes"]');
    
    if (!checkMes) return;
    
    if (config.tipoInforme === 'catalogo') {
        // ✅ MODO CATÁLOGO: Deshabilitar agrupación por mes
        checkMes.disabled = true;
        checkMes.checked = false;
        
        // Aplicar estilo visual de deshabilitado
        if (labelMes) {
            labelMes.style.opacity = '0.5';
            labelMes.style.cursor = 'not-allowed';
            labelMes.title = 'No disponible en modo Catálogo (los productos no tienen fechas de compra)';
        }
        
        console.log('🔒 [SYNC-CONTROLES] Agrupación por mes DESHABILITADA (modo Catálogo)');
    } else {
        // ✅ MODO HISTÓRICO: Habilitar agrupación por mes
        checkMes.disabled = false;
        
        // Restaurar estilo visual
        if (labelMes) {
            labelMes.style.opacity = '1';
            labelMes.style.cursor = 'pointer';
            labelMes.title = '';
        }
        
        console.log('🔓 [SYNC-CONTROLES] Agrupación por mes HABILITADA (modo Histórico)');
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
    
    // ✅ MEJORADO: Reinicializar filtros cuando cambia el tipo de informe o el modo
    const modoActual = estadoFiltros.modo;
    const nuevoModo = incluirMeses ? 'jerarquico' : 'plano';
    const esCatalogo = datosHistorial.es_catalogo === true;
    
    // Condiciones para reinicializar:
    // 1. Cambió el modo (plano ↔ jerárquico)
    // 2. Estado vacío
    // 3. Cambió el tipo de informe (histórico ↔ catálogo)
    const debeReinicializar = (
        modoActual !== nuevoModo ||
        Object.keys(estadoFiltros[nuevoModo === 'plano' ? 'rubrosPlanos' : 'rubrosJerarquicos']).length === 0 ||
        (esCatalogo && modoActual === 'plano') // Siempre reinicializar en catálogo para actualizar rubros
    );
    
    if (debeReinicializar) {
        console.log(`🔄 [FILTROS] Reinicializando filtros (modo: ${nuevoModo}, catálogo: ${esCatalogo})`);
        inicializarFiltros(todosProductos, incluirMeses);
    }
    
    // Renderizar panel con el estado actual (preservado)
    renderizarPanelSinReinicializar();
    
    console.log(`✅ [FILTROS] Panel actualizado (modo: ${estadoFiltros.modo}, productos: ${todosProductos.length})`);
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
 * Handler para toggle de sub-rubros
 * ✅ NUEVO: Permite filtrar sub-rubros individualmente
 */
function handleToggleSubRubro(rubro, subRubro, mesKey) {
    console.log(`👁️ [FILTROS] Toggle sub-rubro: ${rubro} → ${subRubro} (mes: ${mesKey || 'N/A'})`);
    toggleVisibilidadSubRubro(rubro, subRubro, mesKey);
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

async function cargarDatos(clienteId, preservarFiltros = false) {
    try {
        clienteIdActual = clienteId;
        const config = leerConfiguracion();

        // ✅ Cargar política comercial del cliente si aplica
        if (clienteId && String(clienteId) !== '0') {
            try {
                const polRes = await fetch(`/api/presupuestos/politicas/cliente/${clienteId}`);
                if (polRes.ok) {
                    const polData = await polRes.json();
                    if (polData.success && polData.data) {
                        politicaClienteActual = polData.data;
                        console.log('🏷️ [PREVIEW-HISTORIAL] Política comercial cargada:', politicaClienteActual);
                    } else {
                        politicaClienteActual = null;
                    }
                } else {
                    politicaClienteActual = null;
                }
            } catch (ePol) {
                console.warn('⚠️ [PREVIEW-HISTORIAL] No se pudo cargar política comercial del cliente:', ePol);
                politicaClienteActual = null;
            }
        } else {
            politicaClienteActual = null;
        }
        
        // ✅ PASO 1: Cargar artículos excluidos SOLO si es modo catálogo
        if (config.tipoInforme === 'catalogo') {
            await cargarArticulosExcluidos(clienteId);
        } else {
            // En modo histórico, limpiar lista de excluidos
            articulosExcluidos = [];
            renderizarPanelExcluidos({});
        }
        
        // ✅ PASO 2: Cargar datos según tipo de informe
        if (config.tipoInforme === 'catalogo') {
            // Cargar catálogo general (Vista Plana)
            await cargarCatalogoGeneral(clienteId);
        } else {
            // Cargar historial de entregas (modo histórico)
            await cargarHistorialCliente(clienteId);
        }
        
        // ✅ PASO 3: FILTRAR ARTÍCULOS EXCLUIDOS SOLO EN MODO CATÁLOGO
        if (config.tipoInforme === 'catalogo') {
            filtrarArticulosExcluidos();
        }
        
        console.log(`✅ [CARGA-DATOS] Datos cargados${config.tipoInforme === 'catalogo' ? ' y filtrados' : ''}. Productos finales: ${datosHistorial.total_productos_unicos}`);
        
    } catch (error) {
        console.error('❌ Error al cargar datos:', error);
        mostrarError(`Error: ${error.message}`);
        throw error;
    }
}

/**
 * Cargar artículos excluidos del cliente
 * ✅ NUEVO: Carga lista de exclusiones desde el backend
 */
async function cargarArticulosExcluidos(clienteId) {
    console.log(`🚫 [EXCLUIDOS] Cargando artículos excluidos para cliente: ${clienteId}`);
    
    try {
        const response = await fetch(`/api/presupuestos/clientes/${clienteId}/articulos-excluidos`);
        
        if (!response.ok) {
            console.warn(`⚠️ [EXCLUIDOS] Error al cargar excluidos: HTTP ${response.status}`);
            articulosExcluidos = [];
            return;
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            console.warn('⚠️ [EXCLUIDOS] No se pudieron cargar artículos excluidos');
            articulosExcluidos = [];
            return;
        }
        
        articulosExcluidos = result.data.articulos_planos || [];
        console.log(`✅ [EXCLUIDOS] Artículos excluidos cargados: ${articulosExcluidos.length}`);
        
        // Actualizar panel de excluidos
        renderizarPanelExcluidos(result.data.articulos_agrupados);
        
    } catch (error) {
        console.error('❌ [EXCLUIDOS] Error al cargar artículos excluidos:', error);
        articulosExcluidos = [];
    }
}

/**
 * Filtrar artículos excluidos de los datos cargados
 * ✅ CRÍTICO: Elimina artículos excluidos de la vista SIEMPRE
 * ✅ ROBUSTO: Normaliza IDs para evitar fallas por espacios o tipos
 */
function filtrarArticulosExcluidos() {
    if (!datosHistorial) {
        console.warn('⚠️ [EXCLUIDOS] No hay datos para filtrar');
        return;
    }
    
    if (articulosExcluidos.length === 0) {
        console.log('ℹ️ [EXCLUIDOS] No hay artículos excluidos para este cliente');
        return;
    }
    
    console.log(`🔍 [EXCLUIDOS] Filtrando ${articulosExcluidos.length} artículos excluidos`);
    
    // ✅ NORMALIZACIÓN: Crear Set con códigos normalizados (trim + lowercase)
    const articulosExcluidosSet = new Set(
        articulosExcluidos.map(a => String(a.articulo_numero).trim().toLowerCase())
    );
    
    // Log de artículos excluidos para debugging
    console.log(`🚫 [EXCLUIDOS] Artículos a filtrar (normalizados):`, Array.from(articulosExcluidosSet));
    
    // Contar productos antes de filtrar
    const productosAntes = datosHistorial.grupos.reduce((sum, g) => sum + g.productos.length, 0);
    
    // ✅ FILTRO GLOBAL ROBUSTO: Eliminar artículos excluidos de TODOS los grupos
    datosHistorial.grupos = datosHistorial.grupos.map(grupo => ({
        ...grupo,
        productos: grupo.productos.filter(p => {
            // ✅ NORMALIZACIÓN: Comparar IDs normalizados
            const articuloNormalizado = String(p.articulo_numero).trim().toLowerCase();
            const estaExcluido = articulosExcluidosSet.has(articuloNormalizado);
            
            if (estaExcluido) {
                console.log(`🚫 [EXCLUIDOS] Filtrando: "${p.descripcion}" (ID: "${p.articulo_numero}" → normalizado: "${articuloNormalizado}")`);
            }
            
            return !estaExcluido;
        })
    })).filter(grupo => grupo.productos.length > 0); // Eliminar grupos vacíos
    
    // Actualizar contadores
    const totalProductos = datosHistorial.grupos.reduce((sum, g) => sum + g.productos.length, 0);
    datosHistorial.total_productos_unicos = totalProductos;
    
    console.log(`✅ [EXCLUIDOS] Filtrado completado:`);
    console.log(`   - Productos antes: ${productosAntes}`);
    console.log(`   - Productos después: ${totalProductos}`);
    console.log(`   - Artículos filtrados: ${productosAntes - totalProductos}`);
}

/**
 * Cargar historial de entregas del cliente
 */
async function cargarHistorialCliente(clienteId) {
    console.log(`📦 [HISTORIAL] Cargando historial para cliente: ${clienteId}`);
    
    const responseHistorial = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);
    
    if (!responseHistorial.ok) {
        throw new Error(`Error HTTP ${responseHistorial.status}`);
    }
    
    const resultHistorial = await responseHistorial.json();
    
    if (!resultHistorial.success || !resultHistorial.data) {
        throw new Error('No se pudieron cargar los datos del historial');
    }
    
    datosHistorial = resultHistorial.data;
    
    console.log(`✅ Historial cargado: ${datosHistorial.total_productos_unicos} productos`);
    console.log(`👤 Cliente: ${datosHistorial.cliente_apellido || ''} ${datosHistorial.cliente_nombre || ''} (ID: ${datosHistorial.cliente_id})`);
}

/**
 * Cargar catálogo general de productos (Vista Plana)
 * ✅ OPTIMIZADO: Backend ya devuelve articulo_numero
 */
async function cargarCatalogoGeneral(clienteId) {
    console.log(`📋 [CATALOGO] Cargando catálogo general para cliente: ${clienteId}`);
    
    // Cargar datos del cliente primero
    const responseCliente = await fetch(`/api/presupuestos/clientes/${clienteId}`);
    
    if (!responseCliente.ok) {
        throw new Error(`Error al cargar datos del cliente: HTTP ${responseCliente.status}`);
    }
    
    const resultCliente = await responseCliente.json();
    
    if (!resultCliente.success || !resultCliente.data) {
        throw new Error('No se pudieron cargar los datos del cliente');
    }
    
    const cliente = resultCliente.data;
    
    // Cargar catálogo general con paginación (cargar todos los productos)
    const responseCatalogo = await fetch(`/api/presupuestos/catalogo-general?cliente_id=${clienteId}&pageSize=10000`);
    
    if (!responseCatalogo.ok) {
        throw new Error(`Error HTTP ${responseCatalogo.status}`);
    }
    
    const resultCatalogo = await responseCatalogo.json();
    
    if (!resultCatalogo.success || !resultCatalogo.data) {
        throw new Error('No se pudieron cargar los datos del catálogo');
    }
    
    // ✅ OPTIMIZADO: Backend ya devuelve articulo_numero, solo transformar formato
    const productosTransformados = resultCatalogo.data.map(producto => ({
        codigo_barras: producto.descripcion,
        articulo_numero: producto.articulo_numero || producto.descripcion, // ✅ Ya viene del backend
        descripcion: producto.descripcion,
        cantidad: 0,
        fecha_entrega: new Date().toISOString(),
        presupuesto_id: null,
        precio_actual: producto.precio_actual,
        iva_actual: producto.iva,
        lista_precios: producto.lista_precios,
        rubro: producto.rubro,
        sub_rubro: producto.sub_rubro,
        kilos_unidad: producto.kilos_unidad,
        precio_por_kilo: producto.precio_por_kilo,
        stock_consolidado: producto.stock_consolidado,
        es_pack: producto.es_pack,
        pack_unidades: producto.pack_unidades,
        es_producible: false
    }));
    
    // Crear estructura compatible con el renderizador
    datosHistorial = {
        cliente_id: cliente.id_cliente,
        cliente_nombre: cliente.nombre,
        cliente_apellido: cliente.apellido,
        total_productos_unicos: productosTransformados.length,
        total_registros_originales: productosTransformados.length,
        grupos: [{
            key: 'catalogo',
            label: 'Catálogo General',
            productos: productosTransformados
        }],
        sin_historial: false,
        es_catalogo: true
    };
    
    console.log(`✅ Catálogo cargado: ${productosTransformados.length} productos`);
    console.log(`👤 Cliente: ${cliente.apellido || ''} ${cliente.nombre || ''} (ID: ${cliente.id_cliente})`);
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
    
    // ✅ STOCK INTELIGENTE CON UMBRAL DE TOLERANCIA
    // Determinar visualización según stock y producibilidad
    let stockVisual;
    let stockColor;
    let stockTooltip;
    
    // ✅ UMBRAL DE TOLERANCIA: Solo considerar stock si es > 0.001 (evitar residuos decimales)
    if (stock > 0.001) {
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
    const config = leerConfiguracion();
    const esCatalogo = config.tipoInforme === 'catalogo';
    
    switch (columnaId) {
        case 'descripcion':
            // ✅ CONDICIONAL: Botón de exclusión SOLO en modo Catálogo
            if (esCatalogo) {
                return `<td style="position: relative; padding-left: 30px;">
                    <button 
                        class="btn-excluir no-print" 
                        onclick="event.stopPropagation(); excluirArticulo('${producto.articulo_numero}', '${producto.descripcion.replace(/'/g, "\\'")}')"
                        title="Excluir este artículo de la lista"
                        style="position: absolute; left: -8px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
                        ✖
                    </button>
                    <span>${producto.descripcion}</span>
                </td>`;
            } else {
                // Modo histórico: solo descripción, sin botón
                return `<td>${producto.descripcion}</td>`;
            }
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
                            class="no-print"
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
// GESTIÓN DE EXCLUSIONES
// ============================================

/**
 * Excluir un artículo (guardar en BD y refrescar vista)
 * ✅ MEJORADO: Sin confirmación, flujo rápido y quirúrgico
 */
async function excluirArticulo(articuloNumero, descripcion) {
    console.log(`🚫 [EXCLUIR] Excluyendo artículo: ${articuloNumero}`);
    
    if (!clienteIdActual) {
        mostrarNotificacion('❌ Error: No se pudo identificar el cliente', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/presupuestos/clientes/${clienteIdActual}/articulos-excluidos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulo_numero: articuloNumero })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al excluir artículo');
        }
        
        console.log(`✅ [EXCLUIR] Artículo excluido exitosamente`);
        
        // ✅ QUIRÚRGICO: Recargar solo datos y excluidos, SIN tocar panel de filtros
        await cargarDatos(clienteIdActual);
        
        // Solo renderizar informe (no actualizar panel de filtros)
        renderizarInforme();
        
        // Mostrar notificación de éxito
        mostrarNotificacion(`✅ "${descripcion}" excluido`, 'success');
        
    } catch (error) {
        console.error('❌ [EXCLUIR] Error:', error);
        mostrarNotificacion(`❌ Error al excluir: ${error.message}`, 'error');
    }
}

/**
 * Re-incluir un artículo excluido (eliminar de BD y refrescar vista)
 * ✅ MEJORADO: Flujo rápido y quirúrgico
 */
async function reincluirArticulo(articuloNumero, descripcion) {
    console.log(`✅ [REINCLUIR] Re-incluyendo artículo: ${articuloNumero}`);
    
    if (!clienteIdActual) {
        mostrarNotificacion('❌ Error: No se pudo identificar el cliente', 'error');
        return;
    }
    
    try {
        const response = await fetch(
            `/api/presupuestos/clientes/${clienteIdActual}/articulos-excluidos/${encodeURIComponent(articuloNumero)}`,
            { method: 'DELETE' }
        );
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al re-incluir artículo');
        }
        
        console.log(`✅ [REINCLUIR] Artículo re-incluido exitosamente`);
        
        // ✅ QUIRÚRGICO: Recargar solo datos y excluidos, SIN tocar panel de filtros
        await cargarDatos(clienteIdActual);
        
        // Solo renderizar informe (no actualizar panel de filtros)
        renderizarInforme();
        
        // Mostrar notificación de éxito
        mostrarNotificacion(`✅ "${descripcion}" re-incluido`, 'success');
        
    } catch (error) {
        console.error('❌ [REINCLUIR] Error:', error);
        mostrarNotificacion(`❌ Error al re-incluir: ${error.message}`, 'error');
    }
}

/**
 * Mostrar notificación toast (no intrusiva)
 * ✅ NUEVO: Notificaciones tipo toast para mejor UX
 */
function mostrarNotificacion(mensaje, tipo = 'info') {
    // Crear elemento de notificación
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensaje;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${tipo === 'success' ? '#27ae60' : tipo === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        font-weight: 500;
        font-size: 0.9em;
        animation: slideIn 0.3s ease, slideOut 0.3s ease 2.7s;
        max-width: 300px;
    `;
    
    // Agregar animaciones
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
    `;
    if (!document.getElementById('toast-animations')) {
        style.id = 'toast-animations';
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Eliminar después de 3 segundos
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

/**
 * Renderizar panel de artículos excluidos con estructura jerárquica
 * ✅ MEJORADO: Contador en título + scroll interno + visibilidad condicional
 */
function renderizarPanelExcluidos(articulosAgrupados) {
    const contenedor = document.getElementById('panel-articulos-excluidos');
    const accordionExcluidos = document.querySelector('#accordion-excluidos')?.parentElement;
    
    if (!contenedor) return;
    
    // Verificar si estamos en modo catálogo
    const config = leerConfiguracion();
    const esCatalogo = config.tipoInforme === 'catalogo';
    
    // Contar total de artículos excluidos
    let totalExcluidos = 0;
    if (articulosAgrupados && Object.keys(articulosAgrupados).length > 0) {
        Object.values(articulosAgrupados).forEach(subRubros => {
            Object.values(subRubros).forEach(articulos => {
                totalExcluidos += articulos.length;
            });
        });
    }
    
    // ✅ VISIBILIDAD CONDICIONAL: Mostrar/ocultar acordeón según modo
    if (accordionExcluidos) {
        if (esCatalogo) {
            accordionExcluidos.style.display = 'block';
        } else {
            accordionExcluidos.style.display = 'none';
            return; // No renderizar contenido en modo histórico
        }
    }
    
    // Actualizar título del acordeón con contador
    const accordionHeader = document.querySelector('#accordion-excluidos').previousElementSibling;
    if (accordionHeader) {
        const spanTexto = accordionHeader.querySelector('span:first-child');
        if (spanTexto) {
            spanTexto.textContent = `🚫 ARTÍCULOS EXCLUIDOS${totalExcluidos > 0 ? ` (${totalExcluidos})` : ''}`;
        }
    }
    
    if (!articulosAgrupados || Object.keys(articulosAgrupados).length === 0) {
        contenedor.innerHTML = `
            <div class="filtro-empty">
                No hay artículos excluidos
            </div>
        `;
        return;
    }
    
    let html = '';
    
    // Ordenar rubros alfabéticamente
    const rubros = Object.keys(articulosAgrupados).sort();
    
    rubros.forEach(rubro => {
        const subRubros = articulosAgrupados[rubro];
        
        html += `
            <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; color: #2c3e50; padding: 6px 0; border-bottom: 2px solid #34495e; margin-bottom: 6px; font-size: 0.9em;">
                    📦 ${rubro}
                </div>
        `;
        
        // Ordenar sub-rubros alfabéticamente
        const subRubrosOrdenados = Object.keys(subRubros).sort();
        
        subRubrosOrdenados.forEach(subRubro => {
            const articulos = subRubros[subRubro];
            
            html += `
                <div style="margin-left: 15px; margin-bottom: 8px;">
                    <div style="font-weight: 500; color: #546e7a; font-size: 0.85em; margin-bottom: 4px;">
                        ↳ ${subRubro}
                    </div>
            `;
            
            articulos.forEach(articulo => {
                html += `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 2px 0 2px 20px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 3px; font-size: 0.8em;">
                        <div style="flex: 1; color: #333;">
                            <div style="font-weight: 500;">${articulo.descripcion}</div>
                            <div style="font-size: 0.85em; color: #666;">Código: ${articulo.articulo_numero}</div>
                        </div>
                        <button 
                            onclick="reincluirArticulo('${articulo.articulo_numero}', '${articulo.descripcion.replace(/'/g, "\\'")}')"
                            style="background: #27ae60; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85em; white-space: nowrap;"
                            title="Re-incluir artículo en la lista">
                            ✅ Re-incluir
                        </button>
                    </div>
                `;
            });
            
            html += `</div>`;
        });
        
        html += `</div>`;
    });
    
    contenedor.innerHTML = html;
    console.log(`✅ [EXCLUIDOS] Panel de excluidos renderizado (${totalExcluidos} artículos)`);
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
                        const resultado = renderizarTablaConSubRubros(rubro, productosPorSubRubro, columnasActivas, grupo.mesKey);
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
                    const resultado = renderizarTablaConSubRubros(rubro, productosPorSubRubro, columnasActivas, null);
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
 * ✅ MEJORADO: Filas clicables para excluir artículos
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
        
        // ✅ MEJORADO: Fila normal sin onclick (el botón está en la celda de descripción)
        html += `<tr>`;
        
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
 * ✅ MEJORADO: Filtra sub-rubros según visibilidad
 */
function renderizarTablaConSubRubros(tituloRubro, productosPorSubRubro, columnasActivas, mesKey = null) {
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
    
    // ✅ NUEVO: Filtrar sub-rubros según visibilidad
    const subRubrosVisibles = subRubrosOrdenados.filter(subRubro => 
        esSubRubroVisible(tituloRubro, subRubro, mesKey)
    );
    
    subRubrosVisibles.forEach((subRubro, index) => {
        const productosSubRubro = productosPorSubRubro[subRubro];
        
        // Insertar separador de sub-rubro (excepto el primero)
        if (index > 0 || subRubrosVisibles.length > 1) {
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
    
    let bannerPoliticaHtml = '';
    if (politicaClienteActual && politicaClienteActual.tiene_politica && !politicaClienteActual.excepcion) {
        const tramos = politicaClienteActual.politica?.tramos || [];
        let textoTramos = '';
        if (tramos.length === 1) {
            const t = tramos[0];
            const montoMinFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parseFloat(t.monto_minimo));
            textoTramos = `Superando <strong>${montoMinFmt}</strong> accedés a una <strong>bonificación automática del ${parseFloat(t.descuento_porcentaje).toFixed(1)}%</strong> en tu pedido.`;
        } else if (tramos.length > 1) {
            const items = tramos.map(t => {
                const montoMinFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(parseFloat(t.monto_minimo));
                return `A partir de <strong>${montoMinFmt}</strong>: <strong>${parseFloat(t.descuento_porcentaje).toFixed(1)}% OFF</strong>`;
            }).join(' &nbsp;|&nbsp; ');
            textoTramos = `Escala por volumen: ${items}`;
        }
        
        if (textoTramos) {
            bannerPoliticaHtml = `
                <div style="background: #f0f4ff; border: 1px solid #c7d2fe; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 8px 12px; margin: 10px 0 14px 0;">
                    <p style="margin: 0; font-size: 0.82em; color: #3730a3; font-weight: 600; line-height: 1.4;">
                        🎉 <strong>Condición Comercial:</strong> ${textoTramos}
                    </p>
                </div>
            `;
        }
    } else {
        bannerPoliticaHtml = `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 6px; padding: 8px 12px; margin: 10px 0 14px 0;">
                <p style="margin: 0; font-size: 0.80em; color: #166534; font-weight: 500; line-height: 1.4;">
                    💡 <strong>Consulta Comercial:</strong> Consulte por bonificaciones y escalas de descuento comercial por volumen.
                </p>
            </div>
        `;
    }

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
            
            <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px 15px; margin: 15px 0 10px 0;">
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

            ${bannerPoliticaHtml}
            
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
        `Ingrese la cantidad de Kilos/Unidades por bulto:\n` +
        `(Puede usar coma o punto para decimales, ej: 1,5 o 0.2)`,
        ''
    );
    
    if (pesoStr === null) {
        console.log(`⚖️ [CARGAR-PESO] Usuario canceló`);
        return;
    }
    
    // ✅ SANITIZACIÓN: Reemplazar coma por punto para soportar formato español
    const valorLimpio = pesoStr.trim().replace(',', '.');
    const peso = parseFloat(valorLimpio);
    
    if (isNaN(peso) || peso <= 0) {
        alert('❌ Error: Debe ingresar un número positivo válido\n\nEjemplos válidos: 1.5, 0.2, 2,5');
        return;
    }
    
    console.log(`📊 [CARGAR-PESO] Valor sanitizado: "${pesoStr}" → ${peso} kg`);
    
    let originalText = '';
    if (event && event.target) {
        originalText = event.target.innerHTML;
        event.target.innerHTML = '⏳ Guardando...';
        event.target.disabled = true;
    }
    
    try {
        // ✅ CODIFICACIÓN: Usar encodeURIComponent para manejar caracteres especiales (/, espacios, etc.)
        const articuloNumeroEncoded = encodeURIComponent(articuloNumero);
        const response = await fetch(`http://localhost:3005/api/logistica/articulos/${articuloNumeroEncoded}/peso`, {
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
    
    // Agregar listener para cambio de tipo de informe
    document.querySelectorAll('input[name="tipo-informe"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            console.log(`🔄 [TIPO-INFORME] Cambiando a: ${radio.value}`);
            
            // ✅ PASO 1: Sincronizar controles ANTES de cargar datos
            sincronizarControlesPorTipoInforme();
            
            // Mostrar loading
            const hoja = document.getElementById('hoja-informe');
            if (hoja) {
                hoja.innerHTML = `
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <p>Cargando ${radio.value === 'catalogo' ? 'catálogo general' : 'historial del cliente'}...</p>
                    </div>
                `;
            }
            
            // ✅ PASO 2: Recargar datos según el tipo seleccionado
            await cargarDatos(clienteId);
            
            // ✅ PASO 3: Actualizar panel de filtros con los nuevos datos
            // Esto reinicializará los filtros con los rubros del catálogo o historial
            actualizarPanelFiltrosCompleto();
            
            // ✅ PASO 4: Renderizar informe
            renderizarInforme();
            
            console.log(`✅ [TIPO-INFORME] Cambio completado a: ${radio.value}`);
        });
    });
    
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
window.handleToggleSubRubro = handleToggleSubRubro;
window.handleToggleMes = handleToggleMes;
window.cambiarOrientacion = cambiarOrientacion;
window.excluirArticulo = excluirArticulo;
window.reincluirArticulo = reincluirArticulo;

console.log('✅ [PREVIEW-HISTORIAL] Módulo principal cargado correctamente');
