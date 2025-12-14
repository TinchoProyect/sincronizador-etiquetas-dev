console.log('📄 [PREVIEW-HISTORIAL] Cargando módulo de previsualización REFACTORIZADO...');

// Variables globales
let datosCliente = null;
let datosHistorial = null;

/**
 * Formateador de moneda argentina (ARS)
 */
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

/**
 * Toggle de acordeón
 */
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

/**
 * Manejar cambio en checkbox de Rubro
 * Habilita/deshabilita Sub-rubro según estado de Rubro
 */
function manejarCambioRubro() {
    const checkRubro = document.getElementById('agrupar-rubro');
    const checkSubRubro = document.getElementById('agrupar-subrubro');
    
    if (checkRubro.checked) {
        // Habilitar sub-rubro
        checkSubRubro.disabled = false;
    } else {
        // Deshabilitar y destildar sub-rubro
        checkSubRubro.disabled = true;
        checkSubRubro.checked = false;
    }
    
    // Renderizar con nueva configuración
    renderizarInforme();
}

/**
 * Leer configuración actual del panel
 */
function leerConfiguracion() {
    return {
        // Tipo de informe
        tipoInforme: document.querySelector('input[name="tipo-informe"]:checked')?.value || 'historico',
        
        // Agrupaciones
        agruparMes: document.getElementById('agrupar-mes')?.checked || false,
        agruparRubro: document.getElementById('agrupar-rubro')?.checked || false,
        agruparSubrubro: document.getElementById('agrupar-subrubro')?.checked || false,
        
        // Columnas visibles
        columnas: {
            descripcion: true, // Siempre visible
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

/**
 * Definición de columnas disponibles
 */
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

/**
 * Calcular valores derivados de un producto
 */
function calcularValoresProducto(producto) {
    const precioBase = parseFloat(producto.precio_actual) || 0;
    const ivaAlicuota = parseFloat(producto.iva_actual) || 0;
    const kilos = parseFloat(producto.kilos_unidad) || 0;
    const stock = parseFloat(producto.stock_consolidado) || 0;
    
    // Cálculos base
    const precioConIva = precioBase;
    const precioSinIva = precioBase / (1 + ivaAlicuota / 100);
    const valorIva = precioConIva - precioSinIva;
    
    // Cálculos por kilo
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

/**
 * Generar HTML de celda según columna
 */
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
            // ✅ FIX: Mostrar decimales (ej: 10.5%)
            return `<td class="${clase} iva-naranja">${valores.ivaAlicuota.toFixed(1)}%</td>`;
        
        case 'precioSinIva':
            return `<td class="${clase} precio-verde">${formatearPrecio(valores.precioSinIva)}</td>`;
        
        case 'precioConIva':
            return `<td class="${clase} precio-verde">${formatearPrecio(valores.precioConIva)}</td>`;
        
        case 'precioKgSinIva':
            return valores.kilos > 0 
                ? `<td class="${clase} precio-kilo">${formatearPrecio(valores.precioKgSinIva)}</td>`
                : `<td class="${clase}">-</td>`;
        
        case 'precioKgConIva':
            if (valores.kilos > 0) {
                return `<td class="${clase} precio-kilo">${formatearPrecio(valores.precioKgConIva)}</td>`;
            } else {
                // Mostrar botón para cargar peso si falta
                return `<td class="${clase}">
                    <button 
                        onclick="cargarPesoArticulo(event, '${producto.articulo_numero}', '${producto.descripcion.replace(/'/g, "\\'")}')" 
                        style="background: #f39c12; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.85em; display: flex; align-items: center; gap: 4px;"
                        title="Cargar peso del artículo">
                        ⚖️ Cargar
                    </button>
                </td>`;
            }
        
        case 'valorIva':
            return `<td class="${clase} iva-naranja">${formatearPrecio(valores.valorIva)}</td>`;
        
        case 'valorIvaKg':
            return valores.kilos > 0 
                ? `<td class="${clase} iva-naranja">${formatearPrecio(valores.valorIvaKg)}</td>`
                : `<td class="${clase}">-</td>`;
        
        default:
            return `<td class="${clase}">-</td>`;
    }
}

/**
 * Helpers de agrupación temporal
 */
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

/**
 * Inicializar página
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔍 [PREVIEW-HISTORIAL] Inicializando página...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const clienteId = urlParams.get('cliente_id');
    
    if (!clienteId) {
        mostrarError('No se especificó un cliente');
        return;
    }
    
    await cargarDatos(clienteId);
    renderizarInforme();
    
    console.log('✅ [PREVIEW-HISTORIAL] Página inicializada');
});

/**
 * Cargar datos del cliente
 */
async function cargarDatos(clienteId) {
    try {
        const response = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);
        
        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            throw new Error('No se pudieron cargar los datos');
        }
        
        datosHistorial = result.data;
        console.log(`✅ Datos cargados: ${datosHistorial.total_productos_unicos} productos`);
        
    } catch (error) {
        console.error('❌ Error al cargar datos:', error);
        mostrarError(`Error: ${error.message}`);
        throw error;
    }
}

/**
 * RENDERIZAR INFORME - VERSIÓN REFACTORIZADA CON COLUMNAS DINÁMICAS
 */
function renderizarInforme() {
    console.log('🎨 [PREVIEW-HISTORIAL] Renderizando informe...');
    
    if (!datosHistorial) {
        console.warn('⚠️ No hay datos para renderizar');
        return;
    }
    
    const config = leerConfiguracion();
    console.log('⚙️ Configuración:', config);
    
    // Obtener columnas activas
    const columnasActivas = COLUMNAS_DISPONIBLES.filter(col => 
        col.siempreVisible || config.columnas[col.id]
    );
    
    console.log(`📊 Columnas activas: ${columnasActivas.length}`);
    
    // Obtener todos los productos
    const todosProductos = datosHistorial.grupos?.flatMap(g => g.productos) || [];
    
    // Construir estructura de agrupación
    let estructuraAgrupacion = construirEstructuraAgrupacion(todosProductos, config);
    
    // Construir HTML
    let html = generarHeaderInforme();
    
    // Totales acumulados
    let totalProductos = 0;
    let sumaPreciosConIva = 0;
    let sumaPreciosSinIva = 0;
    let sumaIva = 0;
    
    // Renderizar cada grupo
    estructuraAgrupacion.forEach(grupo => {
        if (config.agruparMes && grupo.tipo === 'mes') {
            // Título de mes
            html += `
                <div style="margin: 30px 0 20px 0; padding: 12px 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; font-size: 1.2em; font-weight: 700; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    ${grupo.titulo}
                </div>
            `;
            
            // Agrupar por rubro dentro del mes si está activo
            if (config.agruparRubro) {
                const productosPorRubro = agruparPorRubro(grupo.productos);
                Object.keys(productosPorRubro).sort().forEach(rubro => {
                    // Si sub-rubro está activo, crear tercer nivel de anidamiento
                    if (config.agruparSubrubro) {
                        // Título de rubro
                        html += `
                            <div class="rubro-header">📦 ${rubro}</div>
                        `;
                        
                        const productosPorSubRubro = agruparPorSubRubro(productosPorRubro[rubro]);
                        Object.keys(productosPorSubRubro).sort().forEach(subRubro => {
                            const resultado = renderizarTablaProductos(subRubro, productosPorSubRubro[subRubro], columnasActivas, true);
                            html += resultado.html;
                            totalProductos += resultado.totales.productos;
                            sumaPreciosConIva += resultado.totales.preciosConIva;
                            sumaPreciosSinIva += resultado.totales.preciosSinIva;
                            sumaIva += resultado.totales.iva;
                        });
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
            // Grupo de rubro SIN mes
            // Si sub-rubro está activo, crear segundo nivel de anidamiento
            if (config.agruparSubrubro) {
                // Título de rubro
                html += `
                    <div class="rubro-header">📦 ${grupo.titulo.replace('📦 ', '')}</div>
                `;
                
                const productosPorSubRubro = agruparPorSubRubro(grupo.productos);
                Object.keys(productosPorSubRubro).sort().forEach(subRubro => {
                    const resultado = renderizarTablaProductos(subRubro, productosPorSubRubro[subRubro], columnasActivas, true);
                    html += resultado.html;
                    totalProductos += resultado.totales.productos;
                    sumaPreciosConIva += resultado.totales.preciosConIva;
                    sumaPreciosSinIva += resultado.totales.preciosSinIva;
                    sumaIva += resultado.totales.iva;
                });
            } else {
                const resultado = renderizarTablaProductos(grupo.titulo.replace('📦 ', ''), grupo.productos, columnasActivas);
                html += resultado.html;
                totalProductos += resultado.totales.productos;
                sumaPreciosConIva += resultado.totales.preciosConIva;
                sumaPreciosSinIva += resultado.totales.preciosSinIva;
                sumaIva += resultado.totales.iva;
            }
        } else {
            // Grupo simple (sin agrupación)
            const resultado = renderizarTablaProductos(grupo.titulo, grupo.productos, columnasActivas);
            html += resultado.html;
            totalProductos += resultado.totales.productos;
            sumaPreciosConIva += resultado.totales.preciosConIva;
            sumaPreciosSinIva += resultado.totales.preciosSinIva;
            sumaIva += resultado.totales.iva;
        }
    });
    
    // Totales
    html += generarSeccionTotales(totalProductos, sumaPreciosSinIva, sumaIva, sumaPreciosConIva, config);
    
    // Insertar en la hoja
    const hoja = document.getElementById('hoja-informe');
    if (hoja) {
        hoja.innerHTML = html;
        console.log('✅ Informe renderizado exitosamente');
    }
}

/**
 * Construir estructura de agrupación
 */
function construirEstructuraAgrupacion(productos, config) {
    if (config.agruparMes) {
        return agruparPorMeses(productos);
    } else if (config.agruparRubro) {
        const productosPorRubro = agruparPorRubro(productos);
        return Object.keys(productosPorRubro).sort().map(rubro => ({
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

/**
 * Agrupar productos por meses
 */
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
        .map(([key, mes]) => ({
            tipo: 'mes',
            titulo: `📅 ${mes.label}`,
            productos: mes.productos
        }));
}

/**
 * Agrupar productos por rubro
 */
function agruparPorRubro(productos) {
    const porRubro = {};
    productos.forEach(p => {
        const rubro = p.rubro || 'Sin categoría';
        if (!porRubro[rubro]) porRubro[rubro] = [];
        porRubro[rubro].push(p);
    });
    return porRubro;
}

/**
 * Agrupar productos por sub-rubro
 */
function agruparPorSubRubro(productos) {
    const porSubRubro = {};
    productos.forEach(p => {
        const subRubro = p.sub_rubro || 'Sin subcategoría';
        if (!porSubRubro[subRubro]) porSubRubro[subRubro] = [];
        porSubRubro[subRubro].push(p);
    });
    return porSubRubro;
}

/**
 * Renderizar tabla de productos
 * @param {string} titulo - Título del grupo
 * @param {Array} productos - Array de productos
 * @param {Array} columnasActivas - Columnas a mostrar
 * @param {boolean} esSubRubro - Si es true, aplica estilos de sub-rubro (indentado)
 */
function renderizarTablaProductos(titulo, productos, columnasActivas, esSubRubro = false) {
    // Estilos diferentes para sub-rubro (más pequeño e indentado)
    const headerStyle = esSubRubro 
        ? 'background: #546e7a; color: white; padding: 6px 12px 6px 24px; font-weight: 500; font-size: 0.95em; border-radius: 4px; margin-bottom: 8px; margin-left: 15px;'
        : '';
    
    const grupoClass = esSubRubro ? 'style="margin-left: 15px;"' : '';
    
    let html = `
        <div class="rubro-grupo" ${grupoClass}>
            ${esSubRubro 
                ? `<div style="${headerStyle}">└─ ${titulo}</div>` 
                : `<div class="rubro-header">📦 ${titulo}</div>`
            }
            <table class="productos-table">
                <thead>
                    <tr>
    `;
    
    // Headers dinámicos
    columnasActivas.forEach(col => {
        html += `<th class="text-${col.align}">${col.label}</th>`;
    });
    
    html += `
                    </tr>
                </thead>
                <tbody>
    `;
    
    // Totales
    let totales = {
        productos: 0,
        preciosConIva: 0,
        preciosSinIva: 0,
        iva: 0
    };
    
    // Filas de productos
    productos.forEach(producto => {
        const valores = calcularValoresProducto(producto);
        
        html += '<tr>';
        columnasActivas.forEach(col => {
            html += generarCeldaProducto(col.id, producto, valores);
        });
        html += '</tr>';
        
        // Acumular totales
        totales.productos++;
        totales.preciosConIva += valores.precioConIva;
        totales.preciosSinIva += valores.precioSinIva;
        totales.iva += valores.valorIva;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    return { html, totales };
}

/**
 * Generar header del informe
 */
function generarHeaderInforme() {
    return `
        <div class="informe-header">
            <h1>LISTA DE PRECIOS PERSONALIZADA</h1>
            <div class="cliente-nombre">Cliente ID: ${datosHistorial.cliente_id}</div>
            <div class="fecha">Fecha: ${new Date().toLocaleDateString('es-AR', { 
                day: '2-digit', 
                month: 'long', 
                year: 'numeric' 
            })}</div>
            <p style="margin-top: 10px; font-size: 0.85em; color: #666;">
                Basado en historial de compras de los últimos 6 meses
            </p>
        </div>
    `;
}

/**
 * Generar sección de totales
 */
function generarSeccionTotales(totalProductos, subtotal, iva, total, config) {
    return `
        <div class="totales-section">
            <div class="total-row">
                <span>Total de productos:</span>
                <span><strong>${totalProductos}</strong></span>
            </div>
            <div class="total-row">
                <span>Subtotal (sin IVA):</span>
                <span><strong>${formatearPrecio(subtotal)}</strong></span>
            </div>
            <div class="total-row">
                <span>IVA:</span>
                <span><strong>${formatearPrecio(iva)}</strong></span>
            </div>
            <div class="total-row final">
                <span>TOTAL:</span>
                <span>${formatearPrecio(total)}</span>
            </div>
        </div>
        <div style="margin-top: 25px; padding: 12px; background: #e8f4f8; border-left: 4px solid #3498db; border-radius: 4px;">
            <p style="font-size: 0.85em; color: #666;">
                <strong>Nota:</strong> Esta lista muestra los productos con precios actualizados según la configuración seleccionada.
            </p>
        </div>
    `;
}

/**
 * Imprimir informe
 */
function imprimirInforme() {
    console.log('🖨️ Iniciando impresión...');
    window.print();
}

/**
 * Volver atrás
 */
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

/**
 * Mostrar error
 */
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

/**
 * Cargar peso de un artículo
 * Permite edición rápida del peso sin salir del informe
 */
async function cargarPesoArticulo(event, articuloNumero, descripcion) {
    console.log(`⚖️ [CARGAR-PESO] Iniciando carga de peso para: ${articuloNumero}`);
    
    // Prevenir comportamiento por defecto
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // Solicitar el peso al usuario
    const pesoStr = prompt(
        `⚖️ Cargar Peso del Artículo\n\n` +
        `Producto: ${descripcion}\n` +
        `Código: ${articuloNumero}\n\n` +
        `Ingrese la cantidad de Kilos/Unidades por bulto:`,
        ''
    );
    
    // Si el usuario cancela
    if (pesoStr === null) {
        console.log(`⚖️ [CARGAR-PESO] Usuario canceló la operación`);
        return;
    }
    
    // Validar el valor ingresado
    const peso = parseFloat(pesoStr);
    
    if (isNaN(peso) || peso <= 0) {
        alert('❌ Error: Debe ingresar un número positivo válido');
        console.log(`❌ [CARGAR-PESO] Valor inválido: ${pesoStr}`);
        return;
    }
    
    console.log(`⚖️ [CARGAR-PESO] Peso ingresado: ${peso} kg`);
    
    // Guardar referencia al botón y texto original
    let originalText = '';
    if (event && event.target) {
        originalText = event.target.innerHTML;
        event.target.innerHTML = '⏳ Guardando...';
        event.target.disabled = true;
    }
    
    try {
        
        // Llamar al endpoint de actualización
        const response = await fetch(`http://localhost:3005/api/logistica/articulos/${articuloNumero}/peso`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                kilos_unidad: peso
            })
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al actualizar el peso');
        }
        
        console.log(`✅ [CARGAR-PESO] Peso actualizado exitosamente:`, result.data);
        
        // Mostrar mensaje de éxito
        alert(`✅ Peso actualizado correctamente\n\n` +
              `Artículo: ${descripcion}\n` +
              `Peso: ${peso} kg\n\n` +
              `El informe se recargará para mostrar los nuevos precios por kilo.`);
        
        // Recargar los datos y renderizar nuevamente
        const urlParams = new URLSearchParams(window.location.search);
        const clienteId = urlParams.get('cliente_id');
        
        await cargarDatos(clienteId);
        renderizarInforme();
        
        console.log(`✅ [CARGAR-PESO] Informe actualizado`);
        
    } catch (error) {
        console.error(`❌ [CARGAR-PESO] Error:`, error);
        
        // Mensaje de error más específico
        let mensajeError = error.message;
        
        if (error.message.includes('Artículo no encontrado')) {
            mensajeError = `El artículo no existe en el sistema de stock.\n\n` +
                          `Código: ${articuloNumero}\n\n` +
                          `Esto puede ocurrir si:\n` +
                          `• El artículo es nuevo y aún no se sincronizó\n` +
                          `• El código de barras no coincide con el sistema\n\n` +
                          `Por favor, verifique el artículo en el ABM de Stock.`;
        }
        
        alert(`❌ Error al actualizar el peso:\n\n${mensajeError}`);
        
        // Restaurar el botón si existe
        if (event && event.target) {
            event.target.innerHTML = originalText;
            event.target.disabled = false;
        }
    }
}

// Exponer funciones globalmente
window.toggleAccordion = toggleAccordion;
window.manejarCambioRubro = manejarCambioRubro;
window.renderizarInforme = renderizarInforme;
window.imprimirInforme = imprimirInforme;
window.volverAtras = volverAtras;
window.cargarPesoArticulo = cargarPesoArticulo;

console.log('✅ [PREVIEW-HISTORIAL] Módulo REFACTORIZADO cargado correctamente');
