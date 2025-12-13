console.log('📄 [PREVIEW-HISTORIAL] Cargando módulo de previsualización...');

// Variables globales
let datosCliente = null;
let datosHistorial = null;

/**
 * Formateador de moneda argentina (ARS)
 * Formato: $ 1.500,50 (punto para miles, coma para decimales)
 */
const formatearMoneda = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

/**
 * Helper: Formatear número como moneda argentina
 * @param {number} valor - Valor numérico a formatear
 * @returns {string} Valor formateado (ej: "$ 1.500,50")
 */
function formatearPrecio(valor) {
    const numero = parseFloat(valor);
    if (!Number.isFinite(numero)) {
        return '$ 0,00';
    }
    return formatearMoneda.format(numero);
}

/**
 * Inicializar página al cargar
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔍 [PREVIEW-HISTORIAL] Inicializando página...');
    
    // Obtener ID del cliente desde URL
    const urlParams = new URLSearchParams(window.location.search);
    const clienteId = urlParams.get('cliente_id');
    
    if (!clienteId) {
        mostrarError('No se especificó un cliente');
        return;
    }
    
    console.log(`📊 [PREVIEW-HISTORIAL] Cliente ID: ${clienteId}`);
    
    // Cargar datos del cliente y historial
    await cargarDatos(clienteId);
    
    // Renderizar informe inicial
    renderizarInforme();
    
    console.log('✅ [PREVIEW-HISTORIAL] Página inicializada correctamente');
});

/**
 * Cargar datos del cliente y su historial
 */
async function cargarDatos(clienteId) {
    try {
        console.log(`🔄 [PREVIEW-HISTORIAL] Cargando datos del cliente ${clienteId}...`);
        
        // Cargar historial de entregas
        const response = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);
        
        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            throw new Error('No se pudieron cargar los datos del historial');
        }
        
        datosHistorial = result.data;
        
        console.log(`✅ [PREVIEW-HISTORIAL] Datos cargados:`, {
            total_productos: datosHistorial.total_productos_unicos,
            grupos: datosHistorial.grupos?.length || 0
        });
        
    } catch (error) {
        console.error('❌ [PREVIEW-HISTORIAL] Error al cargar datos:', error);
        mostrarError(`Error al cargar datos: ${error.message}`);
        throw error;
    }
}

/**
 * Renderizar informe según configuración actual
 */
function renderizarInforme() {
    console.log('🎨 [PREVIEW-HISTORIAL] Renderizando informe...');
    
    if (!datosHistorial) {
        console.warn('⚠️ [PREVIEW-HISTORIAL] No hay datos para renderizar');
        return;
    }
    
    // Leer configuración actual
    const agruparMeses = document.getElementById('config-agrupar-meses')?.checked || false;
    const mostrarPrecioKilo = document.getElementById('config-precio-kilo')?.checked || false;
    const modoIva = document.querySelector('input[name="config-modo-iva"]:checked')?.value || 'incluido';
    
    console.log('⚙️ [PREVIEW-HISTORIAL] Configuración actual:', {
        agruparMeses,
        mostrarPrecioKilo,
        modoIva
    });
    
    // Obtener todos los productos de todos los grupos
    const todosProductos = datosHistorial.grupos?.flatMap(g => g.productos) || [];
    
    // Agrupar por rubro
    const productosPorRubro = {};
    todosProductos.forEach(p => {
        const rubro = p.rubro || 'Sin categoría';
        if (!productosPorRubro[rubro]) {
            productosPorRubro[rubro] = [];
        }
        productosPorRubro[rubro].push(p);
    });
    
    const rubros = Object.keys(productosPorRubro).sort();
    
    // Construir HTML del informe
    let html = '';
    
    // Header del informe
    html += `
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
    
    // Totales acumulados
    let totalProductos = 0;
    let sumaPreciosFinal = 0;
    let sumaPreciosSinIva = 0;
    let sumaIva = 0;
    
    // Renderizar cada rubro
    rubros.forEach(rubro => {
        const productos = productosPorRubro[rubro];
        
        html += `
            <div class="rubro-grupo">
                <div class="rubro-header">📦 ${rubro}</div>
                <table class="productos-table">
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th class="text-center">Cant.</th>
                            <th class="text-right">Precio</th>
                            ${modoIva === 'discriminado' ? '<th class="text-center">IVA%</th>' : ''}
                            ${mostrarPrecioKilo ? '<th class="text-right">$/Kg</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        productos.forEach(producto => {
            // Calcular precios según modo IVA
            const precioBase = producto.precio_actual || 0;
            const ivaValor = producto.iva_actual || 0;
            
            let precioMostrar, precioConIva;
            if (modoIva === 'incluido') {
                // Ya viene con IVA incluido desde el backend
                precioMostrar = precioBase;
                precioConIva = precioBase;
            } else {
                // Discriminado: mostrar sin IVA
                precioMostrar = precioBase / (1 + ivaValor / 100);
                precioConIva = precioBase;
            }
            
            const precioPorKilo = producto.precio_por_kilo || 0;
            
            html += `
                <tr>
                    <td>${producto.descripcion}</td>
                    <td class="text-center">${producto.cantidad.toFixed(1)}</td>
                    <td class="text-right precio-verde">${formatearPrecio(precioMostrar)}</td>
                    ${modoIva === 'discriminado' ? `<td class="text-center iva-naranja">${ivaValor.toFixed(0)}%</td>` : ''}
                    ${mostrarPrecioKilo && precioPorKilo > 0 ? `<td class="text-right precio-kilo">${formatearPrecio(precioPorKilo)}</td>` : (mostrarPrecioKilo ? '<td class="text-right">-</td>' : '')}
                </tr>
            `;
            
            // Acumular totales
            totalProductos++;
            sumaPreciosFinal += precioConIva;
            sumaPreciosSinIva += precioMostrar;
            sumaIva += (precioConIva - precioMostrar);
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
    });
    
    // Sección de totales
    html += `
        <div class="totales-section">
            <div class="total-row">
                <span>Total de productos:</span>
                <span><strong>${totalProductos}</strong></span>
            </div>
    `;
    
    if (modoIva === 'discriminado') {
        html += `
            <div class="total-row">
                <span>Subtotal (sin IVA):</span>
                <span><strong>${formatearPrecio(sumaPreciosSinIva)}</strong></span>
            </div>
            <div class="total-row">
                <span>IVA:</span>
                <span><strong>${formatearPrecio(sumaIva)}</strong></span>
            </div>
        `;
    }
    
    html += `
            <div class="total-row final">
                <span>TOTAL:</span>
                <span>${formatearPrecio(sumaPreciosFinal)}</span>
            </div>
        </div>
    `;
    
    // Notas finales
    html += `
        <div style="margin-top: 25px; padding: 12px; background: #e8f4f8; border-left: 4px solid #3498db; border-radius: 4px;">
            <p style="font-size: 0.85em; color: #666; margin-bottom: 8px;">
                <strong>Nota:</strong> Esta lista muestra los productos que el cliente compró en los últimos 6 meses con sus precios actualizados
                ${modoIva === 'incluido' ? '(IVA incluido)' : '(IVA discriminado)'}.
            </p>
            ${mostrarPrecioKilo ? '<p style="font-size: 0.85em; color: #666;">Los precios por kilogramo ($/Kg) se muestran cuando están disponibles.</p>' : ''}
        </div>
    `;
    
    // Insertar en la hoja
    const hoja = document.getElementById('hoja-informe');
    if (hoja) {
        hoja.innerHTML = html;
        console.log('✅ [PREVIEW-HISTORIAL] Informe renderizado exitosamente');
    }
}

/**
 * Imprimir informe
 */
function imprimirInforme() {
    console.log('🖨️ [PREVIEW-HISTORIAL] Iniciando impresión...');
    window.print();
}

/**
 * Volver a la página anterior
 * Intenta cerrar la ventana si fue abierta con window.open()
 * Si no puede cerrar, usa history.back()
 */
function volverAtras() {
    console.log('← [PREVIEW-HISTORIAL] Intentando volver/cerrar...');
    
    // Intentar cerrar la ventana (funciona si fue abierta con window.open)
    try {
        window.close();
        
        // Si después de 100ms la ventana sigue abierta, usar history.back()
        setTimeout(() => {
            if (!window.closed) {
                console.log('← [PREVIEW-HISTORIAL] No se pudo cerrar ventana, usando history.back()');
                window.history.back();
            }
        }, 100);
    } catch (error) {
        console.log('← [PREVIEW-HISTORIAL] Error al cerrar, usando history.back():', error);
        window.history.back();
    }
}

/**
 * Mostrar error en la hoja
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

// Exponer funciones globalmente
window.renderizarInforme = renderizarInforme;
window.imprimirInforme = imprimirInforme;
window.volverAtras = volverAtras;

console.log('✅ [PREVIEW-HISTORIAL] Módulo cargado correctamente');
