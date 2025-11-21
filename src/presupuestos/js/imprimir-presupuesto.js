/**
 * MÓDULO DE IMPRESIÓN DE PRESUPUESTOS
 * Gestiones Lamda - Vista de impresión profesional
 */

console.log('🖨️ [IMPRIMIR-PRESUPUESTO] Inicializando módulo de impresión...');

// Configuración
const CONFIG = {
    API_BASE_URL: '/api/presupuestos'
};

// Estado de la aplicación
let presupuestoData = null;
let presupuestoId = null;
let formatoActual = null; // 'IVA_DISCRIMINADO' | 'IVA_INCLUIDO'

/**
 * Inicialización al cargar el DOM
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('📋 [IMPRIMIR-PRESUPUESTO] DOM cargado, inicializando...');
    
    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');
    
    if (!presupuestoId) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No se proporcionó ID de presupuesto');
        mostrarError('No se especificó qué presupuesto imprimir');
        return;
    }
    
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] ID de presupuesto: ${presupuestoId}`);
    
    // Cargar datos del presupuesto
    cargarPresupuesto(presupuestoId);
});

/**
 * Determinar formato por defecto según condición IVA del cliente
 */
function determinarFormatoPorDefecto(condicionIva) {
    console.log(`🔍 [FORMATO] Determinando formato por defecto para condición IVA: "${condicionIva}"`);
    
    // Si es "Responsable Inscripto" → IVA_DISCRIMINADO
    if (condicionIva && condicionIva.trim() === 'Responsable Inscripto') {
        console.log('📊 [FORMATO] Formato por defecto: IVA_DISCRIMINADO (Responsable Inscripto)');
        return 'IVA_DISCRIMINADO';
    }
    
    // Para cualquier otro caso → IVA_INCLUIDO
    console.log(`💰 [FORMATO] Formato por defecto: IVA_INCLUIDO (condición: "${condicionIva || 'sin especificar'}")`);
    return 'IVA_INCLUIDO';
}

/**
 * Cargar datos del presupuesto desde la API
 */
async function cargarPresupuesto(id) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Cargando presupuesto ID: ${id}...`);
    
    try {
        // Mostrar loading
        mostrarLoading();
        
        // Cargar datos del presupuesto
        const responsePresupuesto = await fetch(`${CONFIG.API_BASE_URL}/${id}`);
        if (!responsePresupuesto.ok) {
            throw new Error(`Error HTTP ${responsePresupuesto.status}: ${responsePresupuesto.statusText}`);
        }
        
        const dataPresupuesto = await responsePresupuesto.json();
        if (!dataPresupuesto.success) {
            throw new Error(dataPresupuesto.message || 'Error al cargar presupuesto');
        }
        
        // Cargar detalles de artículos
        const responseDetalles = await fetch(`${CONFIG.API_BASE_URL}/${id}/detalles`);
        if (!responseDetalles.ok) {
            throw new Error(`Error HTTP ${responseDetalles.status}: ${responseDetalles.statusText}`);
        }
        
        const dataDetalles = await responseDetalles.json();
        if (!dataDetalles.success) {
            throw new Error(dataDetalles.message || 'Error al cargar detalles');
        }
        
        // Combinar datos
        presupuestoData = {
            presupuesto: dataPresupuesto.data,
            detalles: dataDetalles.data.detalles || [],
            totales: dataDetalles.data.totales || {}
        };
        
        console.log('✅ [IMPRIMIR-PRESUPUESTO] Datos cargados:', presupuestoData);
        
        // Validar que hay datos mínimos
        if (!presupuestoData.detalles || presupuestoData.detalles.length === 0) {
            console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Presupuesto sin artículos');
            // Continuar de todas formas, mostrar presupuesto vacío
        }
        
        // DETERMINAR FORMATO DE IMPRESIÓN
        const presupuesto = presupuestoData.presupuesto;
        
        if (presupuesto.formato_impresion) {
            // Si ya tiene formato guardado, usarlo
            formatoActual = presupuesto.formato_impresion;
            console.log(`📋 [FORMATO] Usando formato guardado: ${formatoActual}`);
        } else {
            // Si no tiene formato, determinarlo por condición IVA
            const condicionIva = presupuesto.condicion_iva;
            formatoActual = determinarFormatoPorDefecto(condicionIva);
            console.log(`📋 [FORMATO] Formato determinado automáticamente: ${formatoActual}`);
        }
        
        // Actualizar UI del selector
        actualizarSelectorFormato(formatoActual);
        
        // Renderizar presupuesto con el formato determinado
        renderizarPresupuesto(presupuestoData);
        
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al cargar presupuesto:', error);
        mostrarError(`Error al cargar el presupuesto: ${error.message}`);
    }
}

/**
 * Actualizar UI del selector de formato
 */
function actualizarSelectorFormato(formato) {
    const btnDiscriminado = document.getElementById('btn-formato-discriminado');
    const btnIncluido = document.getElementById('btn-formato-incluido');
    
    if (!btnDiscriminado || !btnIncluido) {
        console.warn('⚠️ [FORMATO] Botones de formato no encontrados');
        return;
    }
    
    if (formato === 'IVA_DISCRIMINADO') {
        btnDiscriminado.classList.add('active');
        btnIncluido.classList.remove('active');
    } else {
        btnDiscriminado.classList.remove('active');
        btnIncluido.classList.add('active');
    }
    
    console.log(`✅ [FORMATO] Selector actualizado a: ${formato}`);
}

/**
 * Cambiar formato de impresión
 */
async function cambiarFormato(nuevoFormato) {
    console.log(`🔄 [FORMATO] Cambiando formato a: ${nuevoFormato}`);
    
    if (formatoActual === nuevoFormato) {
        console.log(`ℹ️ [FORMATO] Ya está en formato: ${nuevoFormato}`);
        return;
    }
    
    // Actualizar formato actual
    formatoActual = nuevoFormato;
    
    // Actualizar UI del selector
    actualizarSelectorFormato(nuevoFormato);
    
    // Re-renderizar presupuesto con nuevo formato
    renderizarPresupuesto(presupuestoData);
    
    // Guardar formato en BD (fire-and-forget)
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/${presupuestoId}/formato-impresion`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ formato_impresion: nuevoFormato })
        });
        
        if (response.ok) {
            console.log(`✅ [FORMATO] Formato guardado en BD: ${nuevoFormato}`);
        } else {
            console.warn(`⚠️ [FORMATO] No se pudo guardar formato en BD (no crítico)`);
        }
    } catch (error) {
        console.warn(`⚠️ [FORMATO] Error al guardar formato (no crítico):`, error);
    }
}

/**
 * Normalizar texto para nombre de archivo (eliminar caracteres inválidos de Windows)
 */
function normalizarNombreArchivo(texto) {
    if (!texto) return 'Sin-Datos';
    
    // Convertir a string y eliminar espacios al inicio/final
    let normalizado = String(texto).trim();
    
    // Reemplazar caracteres inválidos en Windows: / \ : * ? " < > |
    normalizado = normalizado.replace(/[\/\\:*?"<>|]/g, '-');
    
    // Reemplazar múltiples espacios o guiones consecutivos por uno solo
    normalizado = normalizado.replace(/\s+/g, ' ').replace(/-+/g, '-');
    
    // Eliminar espacios y reemplazar por guiones
    normalizado = normalizado.replace(/\s/g, '-');
    
    // Limitar longitud para evitar nombres muy largos
    if (normalizado.length > 50) {
        normalizado = normalizado.substring(0, 50);
    }
    
    return normalizado;
}

/**
 * Normalizar fecha para nombre de archivo (formato YYYY-MM-DD)
 */
function normalizarFechaArchivo(fechaString) {
    if (!fechaString) return 'Sin-Fecha';
    
    try {
        // Si ya está en formato YYYY-MM-DD, usarlo directamente
        if (typeof fechaString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaString)) {
            return fechaString;
        }
        
        // Convertir a Date y formatear como YYYY-MM-DD
        const fecha = new Date(fechaString);
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al normalizar fecha:', error);
        return 'Fecha-Invalida';
    }
}

/**
 * Actualizar título del documento para nombre de archivo PDF
 */
function actualizarTituloDocumento(presupuesto) {
    console.log('📝 [IMPRIMIR-PRESUPUESTO] Actualizando título del documento para nombre de archivo...');
    
    // Obtener datos necesarios
    const numeroPresupuesto = presupuesto.id_presupuesto || presupuesto.id || 'SN';
    const nombreCliente = presupuesto.nombre_cliente || presupuesto.concepto || 'Sin-Cliente';
    const fechaPresupuesto = presupuesto.fecha || null;
    
    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos originales para nombre de archivo:');
    console.log(`   - Número de presupuesto: ${numeroPresupuesto}`);
    console.log(`   - Nombre del cliente (original): "${nombreCliente}"`);
    console.log(`   - Fecha del presupuesto (original): "${fechaPresupuesto}"`);
    
    // Normalizar datos
    const numeroNormalizado = String(numeroPresupuesto);
    const clienteNormalizado = normalizarNombreArchivo(nombreCliente);
    const fechaNormalizada = normalizarFechaArchivo(fechaPresupuesto);
    
    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos normalizados para nombre de archivo:');
    console.log(`   - Número de presupuesto: ${numeroNormalizado}`);
    console.log(`   - Nombre del cliente (normalizado): "${clienteNormalizado}"`);
    console.log(`   - Fecha del presupuesto (normalizada): "${fechaNormalizada}"`);
    
    // Construir nombre de archivo
    const nombreArchivo = `Presupuesto-${numeroNormalizado}-${clienteNormalizado}-${fechaNormalizada}`;
    
    console.log('📄 [IMPRIMIR-PRESUPUESTO] Nombre de archivo final sugerido:');
    console.log(`   "${nombreArchivo}.pdf"`);
    
    // Actualizar título del documento (esto es lo que usa el navegador para el nombre del archivo)
    document.title = nombreArchivo;
    
    console.log('✅ [IMPRIMIR-PRESUPUESTO] Título del documento actualizado correctamente');
    console.log(`   document.title = "${document.title}"`);
}

/**
 * Renderizar presupuesto en la vista
 */
function renderizarPresupuesto(data) {
    console.log('🎨 [IMPRIMIR-PRESUPUESTO] Renderizando presupuesto...');
    
    const { presupuesto, detalles, totales } = data;
    
    // Ocultar loading y mostrar contenido
    ocultarLoading();
    
    // Título siempre "PRESUPUESTO" (nunca "Factura")
    document.getElementById('documento-tipo').textContent = 'PRESUPUESTO';
    
    // NUEVO: Actualizar título del documento para nombre de archivo PDF
    actualizarTituloDocumento(presupuesto);
    
    // Número de presupuesto
    document.getElementById('presupuesto-numero').textContent = 
        presupuesto.id_presupuesto || presupuesto.id || '-';
    
    // Información del presupuesto (solo fecha)
    document.getElementById('presupuesto-fecha').textContent = 
        formatearFecha(presupuesto.fecha) || '-';
    
    // Información del cliente (solo número y nombre)
    document.getElementById('cliente-numero').textContent = 
        presupuesto.id_cliente || '-';
    
    // Obtener nombre del cliente desde concepto o campo específico
    const nombreCliente = presupuesto.nombre_cliente || 
                         presupuesto.concepto || 
                         'Sin nombre';
    document.getElementById('cliente-nombre').textContent = nombreCliente;
    
    // Renderizar artículos
    renderizarArticulos(detalles);
    
    // Renderizar totales
    renderizarTotales(presupuesto, totales);
    
    // Observaciones (si existen)
    if (presupuesto.nota && presupuesto.nota.trim()) {
        document.getElementById('observaciones-section').style.display = 'block';
        document.getElementById('presupuesto-nota').textContent = presupuesto.nota;
    }
    
    // Fecha de generación
    document.getElementById('fecha-generacion').textContent = 
        new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    
    // Generar código de barras
    generarCodigoBarras(presupuesto.id_presupuesto || presupuesto.id);
    
    console.log('✅ [IMPRIMIR-PRESUPUESTO] Presupuesto renderizado correctamente');
}

/**
 * Generar código de barras del número de presupuesto
 */
function generarCodigoBarras(numeroPresupuesto) {
    try {
        console.log('📊 [IMPRIMIR-PRESUPUESTO] Generando código de barras:', numeroPresupuesto);
        
        const barcodeElement = document.getElementById('barcode');
        
        if (!barcodeElement) {
            console.warn('⚠️ [IMPRIMIR-PRESUPUESTO] Elemento barcode no encontrado');
            return;
        }
        
        // Verificar que JsBarcode esté disponible
        if (typeof JsBarcode === 'undefined') {
            console.error('❌ [IMPRIMIR-PRESUPUESTO] JsBarcode no está cargado');
            return;
        }
        
        // Generar código de barras CODE128
        JsBarcode(barcodeElement, String(numeroPresupuesto), {
            format: 'CODE128',
            width: 2,
            height: 60,
            displayValue: true,
            fontSize: 14,
            margin: 10,
            background: '#ffffff',
            lineColor: '#000000'
        });
        
        console.log('✅ [IMPRIMIR-PRESUPUESTO] Código de barras generado correctamente');
        
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error generando código de barras:', error);
    }
}

/**
 * Renderizar tabla de artículos según formato
 */
function renderizarArticulos(detalles) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Renderizando ${detalles.length} artículos en formato: ${formatoActual}`);
    
    // Obtener referencias a ambas tablas
    const tablaDiscriminado = document.getElementById('tabla-discriminado');
    const tablaIncluido = document.getElementById('tabla-incluido');
    const tbodyDiscriminado = document.getElementById('articulos-tbody-discriminado');
    const tbodyIncluido = document.getElementById('articulos-tbody-incluido');
    
    if (!tablaDiscriminado || !tablaIncluido || !tbodyDiscriminado || !tbodyIncluido) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No se encontraron las tablas de artículos');
        return;
    }
    
    // Mostrar/ocultar tablas según formato
    if (formatoActual === 'IVA_DISCRIMINADO') {
        tablaDiscriminado.style.display = 'table';
        tablaIncluido.style.display = 'none';
    } else {
        tablaDiscriminado.style.display = 'none';
        tablaIncluido.style.display = 'table';
    }
    
    if (!detalles || detalles.length === 0) {
        const mensajeVacio = `
            <tr>
                <td colspan="${formatoActual === 'IVA_DISCRIMINADO' ? '5' : '4'}" class="text-center">
                    No hay artículos en este presupuesto
                </td>
            </tr>
        `;
        tbodyDiscriminado.innerHTML = mensajeVacio;
        tbodyIncluido.innerHTML = mensajeVacio;
        return;
    }
    
    if (formatoActual === 'IVA_DISCRIMINADO') {
        // FORMATO A: Con columna IVA
        tbodyDiscriminado.innerHTML = detalles.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0; // Precio SIN IVA
            const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA decimal
            
            // Convertir camp2 a porcentaje para mostrar
            const ivaPorcentaje = camp2 * 100; // 0.210 -> 21, 0.105 -> 10.5
            
            // Descripción del artículo
            const descripcion = item.descripcion_articulo || 
                              item.descripcion || 
                              item.articulo || 
                              'Sin descripción';
            
            // Precios SIN IVA
            const precioUnitario = valor1;
            const subtotalLinea = cantidad * valor1;
            
            console.log(`📊 [ARTICULO-DISCRIMINADO] ${descripcion.substring(0, 30)}: camp2=${camp2}, IVA=${ivaPorcentaje}%`);
            
            return `
                <tr>
                    <td>
                        <span class="articulo-descripcion">${escapeHtml(descripcion)}</span>
                    </td>
                    <td class="text-center">${formatearNumero(cantidad)}</td>
                    <td class="text-right">$ ${formatearNumero(precioUnitario)}</td>
                    <td class="text-center">${formatearNumero(ivaPorcentaje)}%</td>
                    <td class="text-right">$ ${formatearNumero(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');
        
    } else {
        // FORMATO B: Sin columna IVA
        tbodyIncluido.innerHTML = detalles.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0; // Precio SIN IVA
            const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA decimal
            
            // Descripción del artículo
            const descripcion = item.descripcion_articulo || 
                              item.descripcion || 
                              item.articulo || 
                              'Sin descripción';
            
            // Precios CON IVA incluido
            const precioUnitario = valor1 * (1 + camp2);
            const subtotalLinea = cantidad * precioUnitario;
            
            console.log(`💰 [ARTICULO-INCLUIDO] ${descripcion.substring(0, 30)}: precio con IVA=${precioUnitario.toFixed(2)}`);
            
            return `
                <tr>
                    <td>
                        <span class="articulo-descripcion">${escapeHtml(descripcion)}</span>
                    </td>
                    <td class="text-center">${formatearNumero(cantidad)}</td>
                    <td class="text-right">$ ${formatearNumero(precioUnitario)}</td>
                    <td class="text-right">$ ${formatearNumero(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');
    }
    
    console.log(`✅ [IMPRIMIR-PRESUPUESTO] Artículos renderizados en formato: ${formatoActual}`);
}

/**
 * Renderizar totales según formato seleccionado
 */
function renderizarTotales(presupuesto, totales) {
    console.log(`🔍 [IMPRIMIR-PRESUPUESTO] Renderizando totales en formato: ${formatoActual}`);
    
    const detalles = presupuestoData.detalles;
    
    if (formatoActual === 'IVA_DISCRIMINADO') {
        // FORMATO A: IVA DISCRIMINADO (modelo actual)
        renderizarTotalesDiscriminado(presupuesto, detalles);
    } else {
        // FORMATO B: IVA INCLUIDO (nuevo modelo)
        renderizarTotalesIncluido(presupuesto, detalles);
    }
}

/**
 * Renderizar totales con IVA DISCRIMINADO
 */
function renderizarTotalesDiscriminado(presupuesto, detalles) {
    console.log('📊 [TOTALES-DISCRIMINADO] Calculando totales con IVA discriminado...');
    
    // 1. SUBTOTAL GENERAL (suma de cantidad * valor1 de cada línea)
    const subtotalGeneral = detalles.reduce((total, item) => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        return total + (cantidad * valor1);
    }, 0);
    
    console.log('📊 [TOTALES-DISCRIMINADO] Subtotal General:', subtotalGeneral);
    
    // 2. DESCUENTO (si existe)
    const descuentoDecimal = parseFloat(presupuesto.descuento) || 0;
    const descuentoPorcentaje = descuentoDecimal * 100; // 0.05 -> 5%
    const montoDescuento = subtotalGeneral * descuentoDecimal;
    const baseConDescuento = subtotalGeneral - montoDescuento;
    
    console.log('📊 [TOTALES-DISCRIMINADO] Descuento:', {
        decimal: descuentoDecimal,
        porcentaje: descuentoPorcentaje,
        monto: montoDescuento,
        baseConDescuento
    });
    
    // 3. IVA POR ALÍCUOTA (21% y 10.5%)
    let iva21Total = 0;
    let iva105Total = 0;
    
    detalles.forEach(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const camp2 = parseFloat(item.camp2) || 0; // Alícuota IVA como decimal
        
        // Subtotal de la línea
        const subtotalLinea = cantidad * valor1;
        
        // Base de cálculo (con descuento aplicado proporcionalmente)
        const baseLinea = descuentoDecimal > 0 
            ? subtotalLinea * (1 - descuentoDecimal)
            : subtotalLinea;
        
        // IVA de la línea
        const ivaLinea = baseLinea * camp2;
        
        // Acumular por alícuota
        if (Math.abs(camp2 - 0.210) < 0.001) {
            // IVA 21%
            iva21Total += ivaLinea;
        } else if (Math.abs(camp2 - 0.105) < 0.001) {
            // IVA 10.5%
            iva105Total += ivaLinea;
        }
    });
    
    console.log('📊 [TOTALES-DISCRIMINADO] IVA:', {
        iva21: iva21Total,
        iva105: iva105Total
    });
    
    // 4. TOTAL FINAL
    const totalFinal = baseConDescuento + iva21Total + iva105Total;
    
    console.log('📊 [TOTALES-DISCRIMINADO] Total Final:', totalFinal);
    
    // ACTUALIZAR UI
    document.getElementById('total-subtotal').textContent = `$ ${formatearNumero(subtotalGeneral)}`;
    
    // Mostrar descuento solo si existe
    if (descuentoPorcentaje > 0) {
        document.getElementById('descuento-row').style.display = 'flex';
        document.getElementById('descuento-porcentaje').textContent = formatearNumero(descuentoPorcentaje);
        document.getElementById('total-descuento').textContent = `$ ${formatearNumero(montoDescuento)}`;
    } else {
        document.getElementById('descuento-row').style.display = 'none';
    }
    
    // Mostrar IVA 21% solo si existe
    if (iva21Total > 0) {
        document.getElementById('iva-21-row').style.display = 'flex';
        document.getElementById('total-iva-21').textContent = `$ ${formatearNumero(iva21Total)}`;
    } else {
        document.getElementById('iva-21-row').style.display = 'none';
    }
    
    // Mostrar IVA 10.5% solo si existe
    if (iva105Total > 0) {
        document.getElementById('iva-105-row').style.display = 'flex';
        document.getElementById('total-iva-105').textContent = `$ ${formatearNumero(iva105Total)}`;
    } else {
        document.getElementById('iva-105-row').style.display = 'none';
    }
    
    document.getElementById('total-final').textContent = `$ ${formatearNumero(totalFinal)}`;
    
    console.log('✅ [TOTALES-DISCRIMINADO] Totales renderizados correctamente');
}

/**
 * Renderizar totales con IVA INCLUIDO
 */
function renderizarTotalesIncluido(presupuesto, detalles) {
    console.log('💰 [TOTALES-INCLUIDO] Calculando totales con IVA incluido...');
    
    // 1. SUBTOTAL GENERAL CON IVA (suma de cantidad * valor1 * (1 + camp2))
    const subtotalGeneral = detalles.reduce((total, item) => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const valor1 = parseFloat(item.valor1) || 0;
        const camp2 = parseFloat(item.camp2) || 0;
        const precioConIva = valor1 * (1 + camp2);
        return total + (cantidad * precioConIva);
    }, 0);
    
    console.log('💰 [TOTALES-INCLUIDO] Subtotal General (con IVA):', subtotalGeneral);
    
    // 2. DESCUENTO (si existe)
    const descuentoDecimal = parseFloat(presupuesto.descuento) || 0;
    const descuentoPorcentaje = descuentoDecimal * 100; // 0.05 -> 5%
    const montoDescuento = subtotalGeneral * descuentoDecimal;
    const totalFinal = subtotalGeneral - montoDescuento;
    
    console.log('💰 [TOTALES-INCLUIDO] Descuento:', {
        decimal: descuentoDecimal,
        porcentaje: descuentoPorcentaje,
        monto: montoDescuento,
        totalFinal
    });
    
    // ACTUALIZAR UI (solo subtotal, descuento y total - SIN filas de IVA)
    document.getElementById('total-subtotal').textContent = `$ ${formatearNumero(subtotalGeneral)}`;
    
    // Mostrar descuento solo si existe
    if (descuentoPorcentaje > 0) {
        document.getElementById('descuento-row').style.display = 'flex';
        document.getElementById('descuento-porcentaje').textContent = formatearNumero(descuentoPorcentaje);
        document.getElementById('total-descuento').textContent = `$ ${formatearNumero(montoDescuento)}`;
    } else {
        document.getElementById('descuento-row').style.display = 'none';
    }
    
    // OCULTAR filas de IVA en formato incluido
    document.getElementById('iva-21-row').style.display = 'none';
    document.getElementById('iva-105-row').style.display = 'none';
    
    document.getElementById('total-final').textContent = `$ ${formatearNumero(totalFinal)}`;
    
    console.log('✅ [TOTALES-INCLUIDO] Totales renderizados correctamente');
}

/**
 * Disparar impresión del navegador
 */
function imprimirPresupuesto() {
    console.log('🖨️ [IMPRIMIR-PRESUPUESTO] Iniciando impresión...');
    
    // Verificar que hay datos cargados
    if (!presupuestoData) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] No hay datos para imprimir');
        alert('No hay datos cargados para imprimir');
        return;
    }
    
    // Disparar diálogo de impresión del navegador
    window.print();
    
    console.log('✅ [IMPRIMIR-PRESUPUESTO] Diálogo de impresión abierto');
}

/**
 * Volver a la lista de presupuestos
 */
function volverALista() {
    console.log('🔙 [IMPRIMIR-PRESUPUESTO] Volviendo a lista de presupuestos...');
    
    // Volver a la página de presupuestos
    window.location.href = '/pages/presupuestos.html';
}

/**
 * Mostrar loading
 */
function mostrarLoading() {
    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');
    const errorContainer = document.getElementById('error-container');
    
    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (contentContainer) contentContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'none';
}

/**
 * Ocultar loading y mostrar contenido
 */
function ocultarLoading() {
    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');
    
    if (loadingContainer) loadingContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'block';
}

/**
 * Mostrar error
 */
function mostrarError(mensaje) {
    console.error('❌ [IMPRIMIR-PRESUPUESTO] Mostrando error:', mensaje);
    
    const loadingContainer = document.getElementById('loading-container');
    const contentContainer = document.getElementById('presupuesto-content');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    
    if (loadingContainer) loadingContainer.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'flex';
    if (errorMessage) errorMessage.textContent = mensaje;
}

/**
 * Formatear fecha en formato DD/MM/YYYY
 */
function formatearFecha(fechaString) {
    if (!fechaString) return null;
    
    try {
        // Si es formato YYYY-MM-DD
        if (typeof fechaString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaString)) {
            const [year, month, day] = fechaString.split('-');
            return `${day}/${month}/${year}`;
        }
        
        // Fallback para otros formatos
        const fecha = new Date(fechaString);
        const day = String(fecha.getDate()).padStart(2, '0');
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const year = fecha.getFullYear();
        
        return `${day}/${month}/${year}`;
    } catch (error) {
        console.error('❌ [IMPRIMIR-PRESUPUESTO] Error al formatear fecha:', error);
        return fechaString;
    }
}

/**
 * Formatear número con separadores de miles y decimales
 */
function formatearNumero(numero) {
    const num = parseFloat(numero);
    
    if (isNaN(num)) return '0,00';
    
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

/**
 * Escapar HTML para prevenir XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Exponer funciones globalmente para uso en HTML
 */
window.imprimirPresupuesto = imprimirPresupuesto;
window.volverALista = volverALista;
window.cambiarFormato = cambiarFormato;

console.log('✅ [IMPRIMIR-PRESUPUESTO] Módulo de impresión inicializado con sistema de formatos');
