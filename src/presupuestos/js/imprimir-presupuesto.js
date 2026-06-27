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
document.addEventListener('DOMContentLoaded', function () {
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
            detalles_sin_stock: dataDetalles.data.detalles_sin_stock || [],
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

        const urlParamsOverride = new URLSearchParams(window.location.search);
        
        if (urlParamsOverride.has('formato')) {
            // Override absoluto vía PWA Móvil
            formatoActual = urlParamsOverride.get('formato');
            console.log(`📱 [FORMATO] Override por PWA URL: ${formatoActual}`);
        } else if (presupuesto.formato_impresion) {
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

        // PWA Override: Modo Solo Lista Automático
        if (urlParamsOverride.get('sololista') === 'true') {
            const chk = document.getElementById('chk-solo-lista');
            if(chk) {
                chk.checked = true;
                if(typeof window.toggleSoloLista === 'function') window.toggleSoloLista();
            }
        }

        // Override: Modo Faltantes Automático (Default es true en HTML, se puede desactivar con ?faltantes=false)
        if (urlParamsOverride.get('faltantes') === 'false') {
            const chk = document.getElementById('chk-faltantes');
            if(chk) {
                chk.checked = false;
                if(typeof window.toggleFaltantes === 'function') window.toggleFaltantes();
            }
        }

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
 * Alternar visibilidad del bloque de totales (Modo Solo Lista)
 */
window.toggleSoloLista = function() {
    const isChecked = document.getElementById('chk-solo-lista')?.checked;
    const totalesSection = document.getElementById('totales-section-container') || document.querySelector('.totales-section');
    
    if (totalesSection) {
        if (isChecked) {
            totalesSection.style.display = 'none';
            console.log('👁️ [UI] Modo Solo Lista: Totales ocultos');
        } else {
            totalesSection.style.display = 'block'; // Block es el display original por defecto allí
            console.log('👁️ [UI] Modo Normal: Totales visibles');
        }
    }
};

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

    // Obtener datos necesarios (NUEVO FORMATO: incluye número de cliente)
    const numeroCliente = presupuesto.id_cliente || 'SIN';
    const numeroPresupuesto = presupuesto.id_presupuesto || presupuesto.id || 'SN';
    const nombreCliente = presupuesto.nombre_cliente || presupuesto.concepto || 'Sin-Cliente';
    const fechaPresupuesto = presupuesto.fecha || null;

    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos originales para nombre de archivo:');
    console.log(`   - Número de cliente: ${numeroCliente}`);
    console.log(`   - Número de presupuesto: ${numeroPresupuesto}`);
    console.log(`   - Nombre del cliente (original): "${nombreCliente}"`);
    console.log(`   - Fecha del presupuesto (original): "${fechaPresupuesto}"`);

    // Normalizar datos
    // Número de cliente: rellenar con ceros a la izquierda (3 dígitos)
    const numeroClienteNormalizado = String(numeroCliente).padStart(3, '0');
    const numeroPresupuestoNormalizado = String(numeroPresupuesto);
    const clienteNormalizado = normalizarNombreArchivo(nombreCliente);
    const fechaNormalizada = normalizarFechaArchivo(fechaPresupuesto);

    console.log('📊 [IMPRIMIR-PRESUPUESTO] Datos normalizados para nombre de archivo:');
    console.log(`   - Número de cliente (normalizado): ${numeroClienteNormalizado}`);
    console.log(`   - Número de presupuesto: ${numeroPresupuestoNormalizado}`);
    console.log(`   - Nombre del cliente (normalizado): "${clienteNormalizado}"`);
    console.log(`   - Fecha del presupuesto (normalizada): "${fechaNormalizada}"`);

    // Construir nombre de archivo con NUEVO FORMATO:
    // Número de Cliente - Presu - Nombre del Cliente - Número de Presupuesto - Fecha
    const nombreArchivo = `${numeroClienteNormalizado}-Presu-${clienteNormalizado}-${numeroPresupuestoNormalizado}-${fechaNormalizada}`;

    console.log('📄 [IMPRIMIR-PRESUPUESTO] Nombre de archivo final sugerido (NUEVO FORMATO):');
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

    // Título dinámico: "PRESUPUESTO" o "ORDEN DE RETIRO / DEVOLUCIÓN"
    const tituloDoc = presupuesto.estado === 'Orden de Retiro'
        ? 'ORDEN DE RETIRO / DEVOLUCIÓN'
        : 'PRESUPUESTO';

    const docTipoEl = document.getElementById('documento-tipo');
    if (docTipoEl) docTipoEl.textContent = tituloDoc;

    const cabeceraTituloEl = document.getElementById('cabecera-titulo');
    if (cabeceraTituloEl) {
        cabeceraTituloEl.textContent = tituloDoc;
    }

    // Opcional: Estilo diferenciado
    if (presupuesto.estado === 'Orden de Retiro') {
        if (docTipoEl) docTipoEl.style.color = '#d35400'; // Naranja oscuro para diferenciar
        if (cabeceraTituloEl) cabeceraTituloEl.style.color = '#d35400';
    } else {
        if (docTipoEl) docTipoEl.style.color = ''; // Reset
        if (cabeceraTituloEl) cabeceraTituloEl.style.color = ''; // Reset (use CSS Petrol default)
    }

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
    
    // Renderizar faltantes si los hay
    if (data.detalles_sin_stock && data.detalles_sin_stock.length > 0) {
        renderizarFaltantes(data.detalles_sin_stock);
        document.getElementById('faltantes-section').style.display = 'block';
    } else {
        document.getElementById('faltantes-section').style.display = 'none';
        // Hide the checkbox UI if no missing items exist
        const chkContainer = document.getElementById('chk-faltantes')?.closest('.formato-selector');
        if(chkContainer) chkContainer.style.display = 'none';
    }

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

        // Generar código de barras CODE128 (Principal del Presupuesto)
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
        
        // ==========================================
        // INYECCIÓN RELATIVA HARDWARE (SIN ROMPER PAGINACIÓN)
        // ==========================================
        const barcodeContainer = barcodeElement.parentElement;
        
        // Evitar inyecciones duplicadas si la función se llama varias veces para el mismo remito
        if (barcodeContainer && !barcodeContainer.parentElement.querySelector('.comandos-hardware-relativos')) {
            const footerRelativo = document.createElement('div');
            footerRelativo.className = 'comandos-hardware-relativos';
            // Verificar contexto para inyectar comandos ON/OFF de hardware
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('contexto') === 'produccion') {
                // Se incrementó 1cm extra a pedido de QA (Ahora 3cm total)
                footerRelativo.style.marginTop = '3cm';
                footerRelativo.style.display = 'flex';
                footerRelativo.style.justifyContent = 'space-between';
                footerRelativo.style.padding = '0 1cm';
                footerRelativo.style.boxSizing = 'border-box';
                footerRelativo.style.width = '100%';
                footerRelativo.style.pageBreakInside = 'avoid';

                // Contenedor IZQUIERDO (ON)
                const wrapperON = document.createElement('div');
                wrapperON.style.textAlign = 'center';
                
                const imgON = document.createElement('img');
                imgON.style.height = '25px';
                imgON.id = 'barcode-cmd-iniciar'; // Vigía depurador
                
                const textON = document.createElement('div');
                textON.textContent = 'ON';
                textON.style.fontSize = '8pt';
                textON.style.fontWeight = 'bold';

                wrapperON.appendChild(imgON);
                wrapperON.appendChild(textON);

                // Contenedor DERECHO (OFF)
                const wrapperOFF = document.createElement('div');
                wrapperOFF.style.textAlign = 'center';
                
                const imgOFF = document.createElement('img');
                imgOFF.style.height = '25px';
                imgOFF.id = 'barcode-cmd-finalizar'; // Vigía depurador
                
                const textOFF = document.createElement('div');
                textOFF.textContent = 'OFF';
                textOFF.style.fontSize = '8pt';
                textOFF.style.fontWeight = 'bold';

                wrapperOFF.appendChild(imgOFF);
                wrapperOFF.appendChild(textOFF);

                // Armar estructura
                footerRelativo.appendChild(wrapperON);
                footerRelativo.appendChild(wrapperOFF);
                
                // Inyectar justo después del contenedor del código de barras principal
                barcodeContainer.parentElement.appendChild(footerRelativo);

                // Renderizar Barcodes estandarizados a tamaño principal
                JsBarcode(imgON, "CMD-ON", {
                    format: 'CODE128',
                    width: 2, 
                    height: 60, 
                    displayValue: false, 
                    margin: 0
                });

                JsBarcode(imgOFF, "CMD-OFF", {
                    format: 'CODE128',
                    width: 2, 
                    height: 60, 
                    displayValue: false, 
                    margin: 0
                });
                
                console.log('✅ [IMPRIMIR-PRESUPUESTO] Footer relativo inyectado correctamente');
            } else {
                console.log('✅ [IMPRIMIR-PRESUPUESTO] Footer de comandos omitido (No es contexto de Producción)');
            }

        }

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
 * Renderiza la sección de Faltantes (Sin Disponibilidad)
 */
function renderizarFaltantes(detallesSinStock) {
    console.log('🎨 [IMPRIMIR-PRESUPUESTO] Renderizando faltantes...');
    const tbodyFaltantes = document.getElementById('articulos-tbody-faltantes');
    if (!tbodyFaltantes) return;

    if (!detallesSinStock || detallesSinStock.length === 0) {
        tbodyFaltantes.innerHTML = '<tr><td colspan="3" class="text-center">No hay artículos faltantes registrados.</td></tr>';
        return;
    }

    tbodyFaltantes.innerHTML = detallesSinStock.map(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        const descripcion = item.descripcion || item.articulo || 'Sin descripción';

        return `
            <tr>
                <td>
                    <span class="articulo-descripcion" style="color:#d35400;">${escapeHtml(descripcion)}</span>
                </td>
                <td class="text-center" style="color:#d35400;">${cantidad}</td>
                <td class="text-right" style="color:#7f8c8d; font-style: italic; font-size: 0.9em;">Sin disponibilidad</td>
            </tr>
        `;
    }).join('');
}

/**
 * Toggle section faltantes via checkbox
 */
window.toggleFaltantes = function() {
    const chk = document.getElementById('chk-faltantes');
    const seccionFaltantes = document.getElementById('faltantes-section');
    if (!chk || !seccionFaltantes) return;

    if (chk.checked && presupuestoData && presupuestoData.detalles_sin_stock && presupuestoData.detalles_sin_stock.length > 0) {
        seccionFaltantes.style.display = 'block';
    } else {
        seccionFaltantes.style.display = 'none';
    }
};

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

    // Delay controlado (500ms) para garantizar el dibujo y flush (Race-condition / batch fixes)
    setTimeout(() => {
        // --- VIGÍA DEPURADOR DE REDERIZADO DE COMANDOS (EVIDENCIA QA) ---
        console.log('🔍 [VIGÍA DEPURADOR] ESTADO DEL DOM ANTES DE IMPRESIÓN');
        
        const header = document.querySelector('.empresa-header');
        if (header) {
            console.log('📌 HEADER (Comando ON):', header.innerHTML.substring(0, 300) + '...');
            const imgStart = document.getElementById('barcode-cmd-iniciar');
            console.log('   -> Imagen START Base64 (Validez):', imgStart ? (imgStart.src.startsWith('data:image') ? 'OK (Base64 Generado)' : 'FALLA (Mala fuente)') : 'NO EXISTE');
        }

        const totalsContainer = document.querySelector('.totales-barcode-container .barcode-left');
        if (totalsContainer) {
            console.log('📌 FOOTER/TOTALES (Comando OFF):', totalsContainer.innerHTML.substring(0, 300) + '...');
            const imgEnd = document.getElementById('barcode-cmd-finalizar');
            console.log('   -> Imagen END Base64 (Validez):', imgEnd ? (imgEnd.src.startsWith('data:image') ? 'OK (Base64 Generado)' : 'FALLA (Mala fuente)') : 'NO EXISTE');
        }
        console.log('========================================================');

        // Disparar diálogo de impresión del navegador
        window.print();
        console.log('✅ [IMPRIMIR-PRESUPUESTO] Diálogo de impresión abierto');
    }, 500);
}

function volverALista() {
    console.log('🔙 [IMPRIMIR-PRESUPUESTO] Volviendo a lista de presupuestos...');

    // Soporte PWA: Volver al menú móvil si vinimos de ahí
    if (new URLSearchParams(window.location.search).get('origen') === 'mobile') {
        window.history.back();
        return;
    }

    // Volver a la página de presupuestos (modo Desktop)
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
window.enviarPresupuestoWhatsApp = enviarPresupuestoOmnicanal;
window.enviarPresupuestoOmnicanal = enviarPresupuestoOmnicanal;

/**
 * Resuelve el teléfono de WhatsApp del cliente
 */
function resolverTelefonoCliente(presupuesto) {
    let telefono = '';
    
    // 1. Preferir whatsapp configurado en Bunker
    if (presupuesto.whatsapp_bunker) {
        telefono = presupuesto.whatsapp_bunker;
    } else {
        // 2. Si no, celular o telefono de lomasoft
        telefono = presupuesto.celular || presupuesto.telefono || '';
    }

    // 3. Si es un JSON array de contactos múltiples
    if (telefono && telefono.trim().startsWith('[')) {
        try {
            const contactos = JSON.parse(telefono);
            telefono = contactos.map(c => c.numero || c.celular || '').filter(n => n && n.trim()).join(', ');
        } catch (e) {
            console.error('Error parseando JSON de contactos:', e);
        }
    }

    return telefono.trim();
}

/**
 * Genera el PDF del presupuesto en el backend y lo envía por WhatsApp y/o Email usando los servicios del puerto 3004/3003
 */
async function enviarPresupuestoOmnicanal() {
    console.log('📤 [OMNICANAL-FRONT] Iniciando flujo de despacho omnicanal...');

    if (!presupuestoData || !presupuestoData.presupuesto) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No hay datos de presupuesto cargados'
        });
        return;
    }

    const presupuesto = presupuestoData.presupuesto;

    // 1. Recuperar y parsear contactos de WhatsApp
    let contacts = [];
    const rawWp = (presupuesto.whatsapp_bunker || '').trim();
    if (rawWp.startsWith('[')) {
        try {
            contacts = JSON.parse(rawWp);
        } catch(e) {}
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
        const rawPhone = rawWp || presupuesto.celular || presupuesto.telefono || '';
        contacts = rawPhone.split(',').map(num => ({
            numero: num.trim(),
            nombre: '',
            cargo: ''
        })).filter(c => c.numero);
    }

    // 2. Recuperar y parsear contactos de Email
    let emails = [];
    const rawEmail = (presupuesto.email_bunker || '').trim();
    if (rawEmail.startsWith('[')) {
        try {
            emails = JSON.parse(rawEmail);
        } catch(e) {}
    }
    if (!Array.isArray(emails) || emails.length === 0) {
        const rawEmailStr = rawEmail || presupuesto.email || '';
        emails = rawEmailStr.split(',').map(em => ({
            email: em.trim(),
            nombre: '',
            cargo: ''
        })).filter(e => e.email);
    }

    // 3. Evaluar destinatarios predeterminados para el tildado inicial
    const hasTypeDefaultWp = contacts.some(c => c.default_presupuesto === true);
    const hasGeneralDefaultWp = !hasTypeDefaultWp && contacts.some(c => c.default === true);

    const hasTypeDefaultEmail = emails.some(e => e.default_presupuesto === true);
    const hasGeneralDefaultEmail = !hasTypeDefaultEmail && emails.some(e => e.default === true);

    // 4. Construir contenido HTML de selección (Diseño doble columna indexado por checkboxes)
    let htmlContent = `
        <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <p style="margin-bottom: 15px; font-size: 14px; color: #4b5563; font-weight: 500;">
                Seleccione los canales y destinatarios para enviar el presupuesto:
            </p>
            <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                <!-- Columna WhatsApp -->
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 8px; border-bottom: 2px solid #10b981; padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>📱 WhatsApp</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f9fafb;">
    `;

    if (contacts.length === 0) {
        htmlContent += `
            <div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                No hay contactos de WhatsApp cargados.
            </div>
        `;
    } else {
        contacts.forEach((c, index) => {
            const isChecked = hasTypeDefaultWp ? (c.default_presupuesto === true) : (hasGeneralDefaultWp ? (c.default === true) : true);
            const formattedNum = c.numero.replace(/\D/g, '');
            let displayNum = c.numero;
            if (formattedNum.length === 10) {
                displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
            } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
            }
            
            const labelText = c.nombre 
                ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                : `Contacto #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <input type="checkbox" class="swal-contact-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280;">📱 ${displayNum}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
                    </div>
                </div>
                
                <!-- Columna Correo -->
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase; margin-bottom: 8px; border-bottom: 2px solid #6366f1; padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>📧 Correo</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f9fafb;">
    `;

    if (emails.length === 0) {
        htmlContent += `
            <div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">
                No hay correos cargados.
            </div>
        `;
    } else {
        emails.forEach((e, index) => {
            const isChecked = hasTypeDefaultEmail ? (e.default_presupuesto === true) : (hasGeneralDefaultEmail ? (e.default === true) : true);
            const labelText = e.nombre 
                ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #e0e7ff; color: #4338ca; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                : `Correo #${index + 1}`;

            htmlContent += `
                <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; margin-bottom: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <input type="checkbox" class="swal-contact-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 3px; cursor: pointer; width: 15px; height: 15px;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                        <div style="font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📧 ${e.email}</div>
                    </div>
                </label>
            `;
        });
    }

    htmlContent += `
                    </div>
                </div>
            </div>
            
            <!-- Campos adicionales -->
            <div style="display: flex; gap: 20px; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                <div style="flex: 1;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro número (opcional):
                    </label>
                    <input type="text" id="swal-custom-phone" placeholder="Ej: 2216615746" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
                <div style="flex: 1;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro correo (opcional):
                    </label>
                    <input type="text" id="swal-custom-email" placeholder="Ej: admin@cliente.com" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
            </div>
            
            <p style="margin-top: 8px; font-size: 10.5px; color: #94a3b8; font-style: italic; line-height: 1.2; margin-bottom: 0;">
                * Si no selecciona ningún destinatario, se procederá con la descarga local directa del documento.
            </p>
    `;

    if (presupuesto && presupuesto.bunker_cliente_id) {
        htmlContent += `
            <label style="display: flex; align-items: center; gap: 8px; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1; cursor: pointer; font-size: 12px; color: #475569;">
                <input type="checkbox" id="swal-save-default" style="width: 16px; height: 16px; cursor: pointer;">
                <span>Guardar esta selección como contactos predeterminados para presupuestos</span>
            </label>
        `;
    }

    htmlContent += `</div>`;

    // 5. Mostrar SweetAlert2 Modal
    const { value: modalResult } = await Swal.fire({
        title: 'Enviar Presupuesto',
        html: htmlContent,
        icon: 'question',
        width: '650px',
        showCancelButton: true,
        confirmButtonText: '📤 Enviar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#6366f1',
        cancelButtonColor: '#6b7280',
        preConfirm: () => {
            const selectedWp = Array.from(document.querySelectorAll('.swal-contact-wp-chk:checked')).map(el => el.value);
            const selectedEmail = Array.from(document.querySelectorAll('.swal-contact-email-chk:checked')).map(el => el.value);
            const customPhone = document.getElementById('swal-custom-phone').value.trim();
            const customEmail = document.getElementById('swal-custom-email').value.trim();
            const saveDefaultCheckbox = document.getElementById('swal-save-default');
            const saveDefault = saveDefaultCheckbox ? saveDefaultCheckbox.checked : false;

            const finalWp = [...selectedWp];
            if (customPhone) {
                const cleaned = customPhone.replace(/[^\d,]/g, '');
                if (cleaned) {
                    cleaned.split(',').forEach(num => {
                        if (num.trim()) finalWp.push(num.trim());
                    });
                }
            }

            const finalEmail = [...selectedEmail];
            if (customEmail) {
                customEmail.split(',').forEach(em => {
                    if (em.trim()) finalEmail.push(em.trim());
                });
            }

            return {
                destinatariosWp: finalWp,
                destinatariosEmail: finalEmail,
                saveDefault,
                selectedWpRaw: selectedWp,
                selectedEmailRaw: selectedEmail
            };
        }
    });

    if (!modalResult) return;

    const { destinatariosWp, destinatariosEmail, saveDefault, selectedWpRaw, selectedEmailRaw } = modalResult;

    // 6. Si no hay destinatarios seleccionados, descargar localmente
    if (destinatariosWp.length === 0 && destinatariosEmail.length === 0) {
        console.log('📥 [OMNICANAL-FRONT] Sin destinatarios. Iniciando descarga local...');
        Swal.fire({
            icon: 'info',
            title: 'Descarga Local',
            text: 'Preparando la impresión/descarga del documento...',
            timer: 1500,
            showConfirmButton: false
        });
        imprimirPresupuesto();
        return;
    }

    // 7. Si se marca guardar por defecto, actualizar en base de datos
    if (saveDefault && presupuesto && presupuesto.bunker_cliente_id) {
        try {
            const updatedWpContacts = contacts.map(c => {
                const isSelected = selectedWpRaw.includes(c.numero);
                return {
                    ...c,
                    default_presupuesto: isSelected
                };
            });
            presupuesto.whatsapp_bunker = JSON.stringify(updatedWpContacts);

            const updatedEmailContacts = emails.map(e => {
                const isSelected = selectedEmailRaw.includes(e.email);
                return {
                    ...e,
                    default_presupuesto: isSelected
                };
            });
            presupuesto.email_bunker = JSON.stringify(updatedEmailContacts);

            await fetch(`/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    whatsapp_facturas: presupuesto.whatsapp_bunker,
                    email_facturas: presupuesto.email_bunker
                })
            });
            console.log('✅ [OMNICANAL-FRONT] Contactos predeterminados de WhatsApp y Email actualizados.');
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error al guardar contactos predeterminados:', err);
        }
    }

    // 8. Despachar a los servicios
    const destinatariosWpStr = destinatariosWp.join(', ');
    const destinatariosEmailStr = destinatariosEmail.join(', ');

    // Mostrar spinner de carga
    Swal.fire({
        title: 'Generando y enviando...',
        text: 'Por favor espera un momento.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    let wpOk = false;
    let emailOk = false;
    let wpAttempted = destinatariosWp.length > 0;
    let emailAttempted = destinatariosEmail.length > 0;
    let errors = [];

    const sololista = document.getElementById('chk-solo-lista')?.checked || false;
    const faltantes = document.getElementById('chk-faltantes')?.checked || false;

    // A. Enviar por WhatsApp
    if (wpAttempted) {
        try {
            console.log(`📱 [OMNICANAL-FRONT] Despachando WhatsApp a: ${destinatariosWpStr}`);
            const response = await fetch(`/api/presupuestos/${presupuestoId}/whatsapp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destinatariosWpStr,
                    formato: formatoActual,
                    sololista: sololista,
                    faltantes: faltantes,
                    nombreCliente: presupuesto.nombre_cliente || presupuesto.concepto || '',
                    estado: presupuesto.estado
                })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                wpOk = true;
            } else {
                errors.push(`WhatsApp: ${data.message || data.error || 'Error desconocido'}`);
            }
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error en WhatsApp:', err);
            errors.push(`WhatsApp: ${err.message}`);
        }
    }

    // B. Enviar por Email
    if (emailAttempted) {
        try {
            console.log(`📧 [OMNICANAL-FRONT] Despachando Email a: ${destinatariosEmailStr}`);
            const response = await fetch(`/api/presupuestos/${presupuestoId}/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destinatariosEmailStr,
                    formato: formatoActual,
                    sololista: sololista,
                    faltantes: faltantes
                })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                emailOk = true;
            } else {
                errors.push(`Correo: ${data.message || data.error || 'Error desconocido'}`);
            }
        } catch (err) {
            console.error('❌ [OMNICANAL-FRONT] Error en Email:', err);
            errors.push(`Correo: ${err.message}`);
        }
    }

    // 9. Informar al usuario
    const totalAttempted = (wpAttempted ? 1 : 0) + (emailAttempted ? 1 : 0);
    const totalSuccess = (wpOk ? 1 : 0) + (emailOk ? 1 : 0);

    if (totalSuccess === totalAttempted) {
        let msgExito = 'El presupuesto fue enviado con éxito ';
        if (wpOk && emailOk) {
            msgExito += `por WhatsApp (${destinatariosWpStr}) y Correo (${destinatariosEmailStr}).`;
        } else if (wpOk) {
            msgExito += `por WhatsApp a: ${destinatariosWpStr}`;
        } else {
            msgExito += `por Correo a: ${destinatariosEmailStr}`;
        }

        Swal.fire({
            icon: 'success',
            title: '¡Enviado!',
            text: msgExito,
            confirmButtonColor: '#334155'
        });
        console.log('✅ [OMNICANAL-FRONT] Envío omnicanal completado con éxito.');
    } else if (totalSuccess > 0) {
        let partialMsg = 'Envío parcial:\n';
        if (wpOk) partialMsg += `✅ WhatsApp: Enviado a ${destinatariosWpStr}\n`;
        else if (wpAttempted) partialMsg += `❌ WhatsApp: Falló (${errors.filter(e => e.startsWith('WhatsApp')).join(', ')})\n`;
        
        if (emailOk) partialMsg += `✅ Correo: Enviado a ${destinatariosEmailStr}\n`;
        else if (emailAttempted) partialMsg += `❌ Correo: Falló (${errors.filter(e => e.startsWith('Correo')).join(', ')})\n`;

        Swal.fire({
            icon: 'warning',
            title: 'Envío Parcial',
            text: partialMsg,
            confirmButtonColor: '#f59e0b'
        });
        console.warn('⚠️ [OMNICANAL-FRONT] Envío parcial registrado:', errors);
    } else {
        Swal.fire({
            icon: 'error',
            title: 'Fallo al enviar',
            text: 'No se pudo enviar por ningún canal. Detalles de errores:\n' + errors.join('\n'),
            confirmButtonColor: '#e74c3c'
        });
        console.error('❌ [OMNICANAL-FRONT] Envío fallido totalmente:', errors);
    }
}

console.log('✅ [IMPRIMIR-PRESUPUESTO] Módulo de impresión inicializado con sistema de formatos e indexación omnicanal');
