console.log('🔍 [PRESUPUESTOS-CREATE] Cargando módulo de creación de presupuestos...');

// Variables globales
let detalleCounter = 0;
let clienteSeleccionado = null;
let currentRequest = null;
let selectedIndex = -1;
let modoBusqueda = 'descripcion'; // 'descripcion' | 'codigo'

// Exponer funciones usadas por atributos inline (onclick)
window.agregarDetalle = agregarDetalle;
window.removerDetalle = removerDetalle;
window.seleccionarArticuloPorClick = seleccionarArticuloPorClick;
window.seleccionarArticulo = seleccionarArticulo;
window.seleccionarClientePorClick = seleccionarClientePorClick;
window.toggleModoBusqueda = toggleModoBusqueda;

/**
 * Toggle entre modo descripción y modo código de barras
 */
function toggleModoBusqueda() {
    const btn = document.getElementById('btn-toggle-busqueda');
    if (!btn) return;

    if (modoBusqueda === 'descripcion') {
        modoBusqueda = 'codigo';
        btn.textContent = '📟 Modo: Código de Barras';
        btn.classList.add('modo-codigo');
        console.log('[MODO-BUSQUEDA] Cambiado a: Código de Barras');

        // AUTO-FOCUS: Poner foco en el campo de código de barras
        setTimeout(() => {
            enfocarCampoCodigoBarras();
        }, 100);
    } else {
        modoBusqueda = 'descripcion';
        btn.textContent = '🔍 Modo: Descripción';
        btn.classList.remove('modo-codigo');
        console.log('[MODO-BUSQUEDA] Cambiado a: Descripción');
    }
}

/**
 * Enfocar el campo de código de barras apropiado
 * Busca el primer input vacío o el de la última fila
 */
function enfocarCampoCodigoBarras() {
    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) {
        console.warn('[MODO-CODIGO] No se encontró tbody para enfocar');
        return;
    }

    const inputs = tbody.querySelectorAll('input[name*="[articulo]"]');
    if (inputs.length === 0) {
        console.warn('[MODO-CODIGO] No hay inputs de artículo disponibles');
        return;
    }

    // Buscar primer input vacío
    let inputToFocus = null;
    for (let input of inputs) {
        if (!input.value || input.value.trim() === '') {
            inputToFocus = input;
            break;
        }
    }

    // Si todos tienen valor, usar el último
    if (!inputToFocus) {
        inputToFocus = inputs[inputs.length - 1];
    }

    if (inputToFocus) {
        inputToFocus.focus();
        inputToFocus.select();
        console.log('[MODO-CODIGO] Foco puesto en campo de código de barras');
    }
}

function getClienteIdActivo() {
    if (clienteSeleccionado && clienteSeleccionado.cliente_id) {
        return String(clienteSeleccionado.cliente_id);
    }
    const raw = (document.getElementById('id_cliente')?.value || '').trim();
    const m = raw.match(/^\d+/);
    return m ? m[0] : '0';
}

// === Modo IVA según tipo de comprobante ===
function isRemitoActivo() {
    const sel = document.getElementById('tipo_comprobante');
    return !!sel && sel.value === 'Remito-Efectivo';
}
function ivaObjetivoDesdeBase(baseIva) {
    const b = Number(baseIva) || 0;
    return isRemitoActivo() ? (b / 2) : b;
}
function applyIvaModeToRow(row) {
    if (!row) return;
    const ivaInput = row.querySelector('input[name*="[iva1]"]');
    if (!ivaInput) return;

    // Si no hay base guardada, uso el valor actual como base
    const base = Number(ivaInput.dataset.ivaBase ?? ivaInput.value ?? 0);
    const target = ivaObjetivoDesdeBase(base);

    setNumeric(ivaInput, target, 2, target);

    const cantOrIva = row.querySelector('input[name*="[cantidad]"]') || ivaInput;
    const detalleId = getDetalleIdFromInput(cantOrIva);
    if (detalleId != null) calcularPrecio(detalleId);
}
// Detección de Modo Retiro
const urlParams = new URLSearchParams(window.location.search);
const MODO_RETIRO = urlParams.get('modo') === 'retiro';

function applyIvaModeToAllRows() {
    document.querySelectorAll('#detalles-tbody tr').forEach(applyIvaModeToRow);
    recalcTotales();
}

document.addEventListener('DOMContentLoaded', function () {
    console.log('📋 [PRESUPUESTOS-CREATE] Inicializando página de creación...');

    if (MODO_RETIRO) {
        console.log('📦 [MODO RETIRO] Activado');
        activarModoRetiro();
    }

    // --- FECHA base primero (evita TDZ) ---
    const fechaInput = document.getElementById('fecha');
    const today = new Date().toISOString().split('T')[0];
    if (fechaInput) {
        fechaInput.value = fechaInput.value || today;
    } else {
        console.warn('⚠️ [PRESUPUESTOS-CREATE] Input #fecha no encontrado; se enviará fecha del día desde JS');
    }

    // === 1.3 Defaults visibles (solo si corresponde) ===
    const tipoSel = document.getElementById('tipo_comprobante');
    if (tipoSel && (tipoSel.value === 'Presupuesto' || !tipoSel.value)) {
        tipoSel.value = 'Factura';
    }

    // === Helpers IVA (Remito-Efectivo = mitad) ===
    function esRemitoActivo() {
        return !!tipoSel && tipoSel.value === 'Remito-Efectivo';
    }
    function objetivoIVA(baseIva) {
        const b = Number(baseIva) || 0;
        return esRemitoActivo() ? (b / 2) : b;
    }
    function asegurarBaseIVA(ivaInput) {
        if (!ivaInput) return;
        if (ivaInput.dataset.ivaBase == null || ivaInput.dataset.ivaBase === '') {
            ivaInput.dataset.ivaBase = String(Number(ivaInput.value) || 0);
        }
    }
    function applyIvaModeToRow(row) {
        if (!row) return;
        const ivaInput = row.querySelector('input[name*="[iva1]"]');
        if (!ivaInput) return;
        asegurarBaseIVA(ivaInput);
        const target = objetivoIVA(ivaInput.dataset.ivaBase);
        ivaInput.value = Number(target).toFixed(2);
        ivaInput.dispatchEvent(new Event('input', { bubbles: true }));
        ivaInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function applyIvaModeToAllRows() {
        document.querySelectorAll('#detalles-tbody tr').forEach(applyIvaModeToRow);
        if (typeof recalcTotales === 'function') recalcTotales();
    }
    if (tipoSel) {
        tipoSel.addEventListener('change', () => {
            console.log('[PRESUPUESTOS-CREATE] Tipo comprobante →', tipoSel.value);
            applyIvaModeToAllRows();
        });
    }

    const agenteInput = document.getElementById('agente');
    if (agenteInput && !agenteInput.value.trim()) {
        agenteInput.value = 'Martin';
    }

    const puntoInput = document.getElementById('punto_entrega');
    if (puntoInput && !puntoInput.value.trim()) {
        puntoInput.value = 'Sin dirección';
    }

    const estadoSel = document.getElementById('estado');
    if (estadoSel && !estadoSel.value) {
        estadoSel.value = 'Presupuesto/Orden';
    }

    // Establecer valor predeterminado para secuencia
    const secuenciaSelect = document.getElementById('secuencia');
    if (secuenciaSelect && !secuenciaSelect.value) {
        secuenciaSelect.value = 'Imprimir';
    }

    const fechaEntregaInput = document.getElementById('fecha_entrega');
    // usar misma fecha que 'fecha' si está vacío
    if (fechaEntregaInput && !fechaEntregaInput.value) {
        fechaEntregaInput.value = (fechaInput ? (fechaInput.value || today) : today);
    }

    // Mantener fecha_entrega = fecha mientras el usuario no la toque
    if (fechaInput && fechaEntregaInput) {
        fechaInput.addEventListener('change', () => {
            if (!fechaEntregaInput.dataset.touched) {
                fechaEntregaInput.value = fechaInput.value;
            }
        });
        fechaEntregaInput.addEventListener('input', () => {
            fechaEntregaInput.dataset.touched = '1';
        });
    }

    // Agregar primera fila de detalle (si existe la tabla)
    const tbody = document.getElementById('detalles-tbody');
    if (tbody) {
        agregarDetalle();
        // observar altas de filas para setear base IVA y aplicar modo actual
        new MutationObserver((muts) => {
            muts.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (n.nodeType === 1) {
                        const ivaInput = n.querySelector('input[name*="[iva1]"]');
                        if (ivaInput) asegurarBaseIVA(ivaInput);
                        applyIvaModeToRow(n);
                    }
                });
            });
        }).observe(tbody, { childList: true });
    } else {
        console.error('❌ [PRESUPUESTOS-CREATE] No se encontró #detalles-tbody. No se pueden agregar filas de detalle.');
    }

    // Al editar IVA a mano, actualizar la base solo si es input del usuario
    document.addEventListener('input', (e) => {
        const name = e.target?.name || '';
        if (/\[iva1\]/.test(name) && e.isTrusted) {
            const ivaInput = e.target;
            const val = Number(ivaInput.value) || 0;
            ivaInput.dataset.ivaBase = String(esRemitoActivo() ? (val * 2) : val);
        }
    }, true);

    // Configurar formulario
    const form = document.getElementById('form-crear-presupuesto');
    if (form) {
        form.addEventListener('submit', handleSubmit);
    } else {
        console.error('❌ [PRESUPUESTOS-CREATE] Formulario #form-crear-presupuesto no encontrado');
    }

    // Configurar autocompletar de clientes
    setupClienteAutocomplete();

    // Configurar autocompletar para artículos
    setupArticuloAutocomplete();
    // precarga deshabilitada: la API de sugerencias exige ?q=; evitamos 400 innecesarios
    // precargarArticulosAll().catch(()=>{});

    // Aplicar IVA según tipo de comprobante al iniciar
    applyIvaModeToAllRows();

    console.log('✅ [PRESUPUESTOS-CREATE] Página inicializada correctamente');
});


/**
 * Agregar nueva fila de detalle
 */
function agregarDetalle() {
    console.log('📦 [PRESUPUESTOS-CREATE] Agregando nueva fila de detalle...');

    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) {
        console.error('❌ [PRESUPUESTOS-CREATE] #detalles-tbody no existe, no se puede agregar detalle');
        return;
    }

    detalleCounter++;
    const row = document.createElement('tr');
    row.id = `detalle-${detalleCounter}`;

    row.innerHTML = `
                <td>
                    <input type="text" name="detalles[${detalleCounter}][articulo]"
                        placeholder="Código o descripción del artículo"
                        autocomplete="off">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][cantidad]"
                        min="0.01" step="0.01" placeholder="1"
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][valor1]"
                        min="0" step="0.01" placeholder="0.00"
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][iva1]"
                        min="0" max="100" step="0.01" placeholder="21.00"
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <!-- Hidden numérico que se envía al backend -->
                    <input type="hidden" name="detalles[${detalleCounter}][precio1]" class="precio1-hidden">
                    <!-- Display formateado para el usuario -->
                    <input type="text" class="precio-calculado" data-precio-display="${detalleCounter}" value="$ 0,00" readonly>
                </td>

                <!-- NUEVA CELDA: Subtotal (solo visual) -->
                <td>
                    <input type="text"
                        class="subtotal-display"
                        data-subtotal-display="${detalleCounter}"
                        value="$ 0,00"
                        readonly>
                </td>

                <td>
                    <button type="button" class="btn-remove-detalle"
                            onclick="removerDetalle(this)"
                            title="Eliminar línea">
                    🗑️
                    </button>
                </td>
                `;

    tbody.appendChild(row);

    // Establecer valores por defecto
    const ivaInput = row.querySelector(`input[name="detalles[${detalleCounter}][iva1]"]`);
    if (ivaInput) ivaInput.value = '21.00';

    const cantidadInput = row.querySelector(`input[name="detalles[${detalleCounter}][cantidad]"]`);
    if (cantidadInput) cantidadInput.value = '1';

    console.log(`✅ [PRESUPUESTOS-CREATE] Detalle ${detalleCounter} agregado`);
}

/**
 * Remover fila de detalle (Refactorizado para QA Phase 2.4)
 * - Acepta ID o Elemento (this)
 * - Si es la última fila, limpia los inputs en lugar de bloquear
 */
function removerDetalle(arg) {
    let row;
    if (typeof arg === 'object' && arg.tagName) {
        // Es un elemento HTML (botón)
        row = arg.closest('tr');
    } else {
        // Es un ID numérico (Legacy)
        row = document.getElementById(`detalle-${arg}`);
    }

    const tbody = document.getElementById('detalles-tbody');

    if (!tbody || !row) {
        console.error('❌ [PRESUPUESTOS-CREATE] No se pudo identificar la fila a eliminar');
        return;
    }

    console.log(`🗑️ [PRESUPUESTOS-CREATE] Intentando remover fila... Filas restantes: ${tbody.children.length}`);

    // Si es la última fila, limpiar en vez de borrar
    if (tbody.children.length <= 1) {
        console.log('⚠️ Última fila detectada: Limpiando inputs en lugar de eliminar.');

        // Limpiar inputs
        const inputs = row.querySelectorAll('input');
        inputs.forEach(input => {
            if (input.type === 'number' || input.type === 'text' || input.type === 'hidden') {
                if (input.name && input.name.includes('[iva1]')) {
                    input.value = '21.00'; // Reset IVA default
                } else if (input.name && input.name.includes('[cantidad]')) {
                    input.value = '1'; // Reset cantidad default
                } else {
                    input.value = '';
                }
                // Limpiar dataset custom
                delete input.dataset.codigoBarras;
                delete input.dataset.articuloNumero;
                delete input.dataset.origenValidado;
            }
        });

        // Reset visuales de precio
        const displays = row.querySelectorAll('.precio-calculado, .subtotal-display');
        displays.forEach(d => d.value = '$ 0,00');

        // Foco
        const firstInput = row.querySelector('input[type="text"]');
        if (firstInput) firstInput.focus();

        mostrarMensaje('Fila limpiada (Se requiere al menos un artículo)', 'success');
        return;
    }

    // Eliminación normal
    row.remove();
    recalcTotales(); // Asegurar recalculo global
    console.log(`✅ [PRESUPUESTOS-CREATE] Fila removida exitosamente.`);
}

/**
 * Calcular precio con IVA
 */
function calcularPrecio(detalleId) {
    const cantidadInput = document.querySelector(`input[name="detalles[${detalleId}][cantidad]"]`);
    const valor1Input = document.querySelector(`input[name="detalles[${detalleId}][valor1]"]`);
    const iva1Input = document.querySelector(`input[name="detalles[${detalleId}][iva1]"]`);
    const precio1Input = document.querySelector(`input[name="detalles[${detalleId}][precio1]"]`);

    if (!cantidadInput || !valor1Input || !iva1Input || !precio1Input) return;

    const cantidad = parseFloat(cantidadInput.value) || 0;
    const valor1 = parseFloat(valor1Input.value) || 0;
    const iva1 = parseFloat(iva1Input.value) || 0;

    // Calcular precio unitario con IVA
    const precioUnitario = valor1 * (1 + iva1 / 100);

    // El precio1 es el precio unitario con IVA (no total)
    precio1Input.value = precioUnitario.toFixed(2);
    updatePrecioDisplay(detalleId, precioUnitario);
    // NEW: subtotal visible = precio unitario c/IVA * cantidad
    const subtotal = precioUnitario * cantidad;
    updateSubtotalDisplay(detalleId, subtotal);

    console.log(`💰 [PRESUPUESTOS-CREATE] Precio calculado para detalle ${detalleId}: ${precioUnitario.toFixed(2)}`);
}

// ===== Helpers numéricos + utilidades (NUEVO) =====

// === Formateo moneda ARS ===
const fmtARS = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
function formatARS(n) {
    const x = Number(n);
    return Number.isFinite(x) ? fmtARS.format(x) : '$ 0,00';
}

// Actualiza el input de display (el visible) para un detalle dado
function updatePrecioDisplay(detalleId, precioUnitario) {
    const display = document.querySelector(`input[data-precio-display="${detalleId}"]`);
    if (display) {
        display.value = formatARS(precioUnitario);
    }
}

function updateSubtotalDisplay(detalleId, subtotal) {
    const display = document.querySelector(`input[data-subtotal-display="${detalleId}"]`);
    if (display) {
        display.value = formatARS(subtotal);
    }
}

function dispatchRecalc(el) {
    try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) { }
}

function setNumeric(el, val, dec = 2, fallback = 0) {
    const n = Number(val);
    el.value = Number.isFinite(n) ? n.toFixed(dec) : Number(fallback).toFixed(dec);
    dispatchRecalc(el);
}

function setCantidad(el, val) {
    setNumeric(el, val, 2, 1);
}

function getDetalleIdFromInput(input) {
    const m = (input.name || '').match(/\[(\d+)\]\[/);
    return m ? parseInt(m[1], 10) : null;
}

/* === 1.4 Totales en vivo (subtotal, descuento, total) === */
function setTextInto(selectors, text) {
    let wrote = false;
    (selectors || []).forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value = text;
            } else {
                el.textContent = text;
            }
            wrote = true;
        });
    });
    return wrote;
}

function getDescuentoPorcentaje() {
    const el = document.getElementById('descuento');
    const raw = el ? parseFloat(el.value) : 0;
    const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    return [pct, el];
}

function recalcTotales() {
    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) return;

    let subtotalBruto = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        const cant = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
        const pvu = parseFloat(row.querySelector('input[name*="[precio1]"]')?.value) || 0; // precio unit. con IVA
        subtotalBruto += cant * pvu;
    });

    const [pct] = getDescuentoPorcentaje();
    const montoDesc = subtotalBruto * (pct / 100);
    const totalFinal = subtotalBruto - montoDesc;

    // Actualiza displays (tolerante: IDs o data-attrs)
    setTextInto(['#total-bruto', '[data-total="bruto"]'], formatARS(subtotalBruto));
    setTextInto(['#total-descuento', '[data-total="descuento"]'], formatARS(montoDesc));
    setTextInto(['#total-final', '[data-total="final"]'], formatARS(totalFinal));
}

// Listener de inputs de detalle + descuento
document.addEventListener('input', (e) => {
    const name = e.target?.name || '';
    if (/\[(cantidad|valor1|iva1)\]/.test(name)) {
        const id = getDetalleIdFromInput(e.target);
        if (id != null) calcularPrecio(id);
        recalcTotales();
        return;
    }
    if (e.target?.id === 'descuento') {
        recalcTotales();
    }
});

// Observa altas/bajas de filas para mantener totales
(() => {
    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) return;
    new MutationObserver(() => recalcTotales()).observe(tbody, { childList: true });
})();

// Recalc inicial
document.addEventListener('DOMContentLoaded', recalcTotales);


/**
 * Generar UUID v4 para Idempotency-Key
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function handleSubmit(event) {
    event.preventDefault();

    console.log('📤 [PRESUPUESTOS-CREATE] Iniciando envío de formulario...');

    const btnGuardar = document.getElementById('btn-guardar');
    const spinner = btnGuardar ? btnGuardar.querySelector('.loading-spinner') : null;

    if (!btnGuardar) {
        console.error('❌ [PRESUPUESTOS-CREATE] Botón guardar no encontrado');
        mostrarMensaje('No se encontró el botón de guardado', 'error');
        return;
    }

    // Mostrar loading (si hay spinner)
    btnGuardar.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    console.log('🔄 [PRESUPUESTOS-CREATE] Botón deshabilitado y spinner (si existe) mostrado');

    try {
        // Recopilar datos del formulario
        const formData = new FormData(event.target);

        // Extraer ID de cliente: usar cliente seleccionado o parsear del input
        let idClienteRaw = (formData.get('id_cliente') || '').toString();
        let idCliente = '0'; // Tolerar vacío -> Consumidor final
        if (clienteSeleccionado && clienteSeleccionado.cliente_id) {
            idCliente = clienteSeleccionado.cliente_id.toString();
        } else if (idClienteRaw) {
            const match = idClienteRaw.match(/^\d+/);
            if (match) idCliente = parseInt(match[0], 10).toString();
        }

        // Fecha: si no vino desde el form, usar hoy
        let fechaForm = (formData.get('fecha') || '').toString();
        if (!fechaForm) {
            fechaForm = new Date().toISOString().split('T')[0];
        }

        // ---- valores pre-leídos con defaults seguros ----
        const estadoValorRaw = (formData.get('estado') || 'Presupuesto/Orden').toString();
        let tipoComprobanteValor = (formData.get('tipo_comprobante') || 'Factura').toString();
        if (/^PRESUPUESTO$/i.test(tipoComprobanteValor)) tipoComprobanteValor = 'Factura'; // saneo explícito
        const agenteValor = ((formData.get('agente') || '').toString().trim()) || 'Martin';
        const puntoEntregaValor = ((formData.get('punto_entrega') || '').toString().trim()) || 'Sin dirección';

        let fechaEntregaValor = (formData.get('fecha_entrega') || '').toString().trim();
        if (!fechaEntregaValor) fechaEntregaValor = fechaForm; // default = misma fecha

        // descuento ingresado como % (0..100) -> guardar proporción (0..1)
        let descuentoPct = parseFloat(formData.get('descuento'));
        descuentoPct = Number.isFinite(descuentoPct) ? Math.min(Math.max(descuentoPct, 0), 100) : 0;
        const descuentoValor = parseFloat((descuentoPct / 100).toFixed(2)); // ej 5 -> 0.05
        const informeGeneradoValor = (document.getElementById('informe_generado')?.value || 'Pendiente').toString();

        // Secuencia (nuevo campo)
        let secuenciaValor = (formData.get('secuencia') || '').toString().trim();

        // AUTOMÁTICO: Si se usó modo código de barras, establecer secuencia = "Pedido_Listo"
        if (modoBusqueda === 'codigo') {
            secuenciaValor = 'Pedido_Listo';
            console.log('📟 [PRESUPUESTOS-CREATE] Modo código de barras detectado → secuencia automática: "Pedido_Listo"');
        }


        // ---- payload final ----
        // ---- payload final ----
        const data = {
            id_cliente: idCliente,
            fecha: fechaForm,
            fecha_entrega: fechaEntregaValor,
            agente: agenteValor,
            // BLINDAJE DEBUG: Leer del panel si es retiro, sino usar lógica estándar
            tipo_comprobante: MODO_RETIRO ? 'Remito-Efectivo' : tipoComprobanteValor,

            estado: MODO_RETIRO
                ? (document.getElementById('debug_estado')?.value || 'Orden de Retiro')
                : estadoValorRaw,

            estado_logistico: MODO_RETIRO
                ? (document.getElementById('debug_estado_logistico')?.value || 'PENDIENTE_ASIGNAR')
                : null,

            informe_generado: MODO_RETIRO
                ? (document.getElementById('debug_informe')?.value || 'Pendiente')
                : informeGeneradoValor,

            nota: (formData.get('nota') || '').toString(),
            punto_entrega: puntoEntregaValor,

            descuento: MODO_RETIRO
                ? parseFloat(document.getElementById('debug_descuento')?.value || 0)
                : descuentoValor,

            secuencia: MODO_RETIRO
                ? (document.getElementById('debug_secuencia')?.value || 'Pedido_Listo')
                : secuenciaValor,

            detalles: []
        };

        // Log de Debug
        if (MODO_RETIRO) {
            console.log('📦 [DEBUG-SUBMIT] Valores leídos del panel de configuración:', {
                estado: data.estado,
                logistica: data.estado_logistico,
                secuencia: data.secuencia,
                descuento: data.descuento
            });
        }
        // Recopilar detalles
        const tbody = document.getElementById('detalles-tbody');
        if (!tbody) throw new Error('No se encontró la tabla de detalles');

        const rows = tbody.querySelectorAll('tr');
        console.log(`📋 [PRESUPUESTOS-CREATE] Total de filas encontradas: ${rows.length}`);

        let detallesEncontrados = 0;
        let detallesValidos = 0;
        let detallesDescartados = 0;

        rows.forEach((row, index) => {
            const inputs = row.querySelectorAll('input');
            const detalle = {};
            let articuloInput = null;

            inputs.forEach(input => {
                const name = input.name || '';

                if (name.includes('[articulo]')) {
                    articuloInput = input;
                    // priorizar el código real (dataset.codigoBarras) si existe
                    const real = (input.dataset && input.dataset.codigoBarras)
                        ? input.dataset.codigoBarras
                        : (input.value || '');
                    detalle.articulo = real.toString().trim();

                } else if (name.includes('[cantidad]')) {
                    detalle.cantidad = parseFloat(input.value) || 0;

                } else if (name.includes('[valor1]')) {
                    detalle.valor1 = parseFloat(input.value) || 0;

                } else if (name.includes('[precio1]')) {
                    detalle.precio1 = parseFloat(input.value) || 0;

                } else if (name.includes('[iva1]')) {
                    detalle.iva1 = parseFloat(input.value) || 0;
                }
            });

            detallesEncontrados++;

            // VALIDACIÓN MEJORADA: Filtrar detalles vacíos o inválidos
            // Un detalle es válido si:
            // 1. Tiene código de barras en dataset (artículo seleccionado correctamente)
            // 2. Tiene cantidad mayor a 0
            // 3. Tiene texto de artículo
            const tieneCodigoBarras = articuloInput && articuloInput.dataset && articuloInput.dataset.codigoBarras && articuloInput.dataset.codigoBarras.trim() !== '';
            const tieneCantidadValida = detalle.cantidad > 0;
            const tieneArticuloTexto = detalle.articulo && detalle.articulo.trim() !== '';

            if (tieneCodigoBarras && tieneCantidadValida && tieneArticuloTexto) {
                data.detalles.push(detalle);
                detallesValidos++;
                console.log(`✅ [PRESUPUESTOS-CREATE] Detalle ${index + 1} válido: ${detalle.articulo} (cantidad: ${detalle.cantidad})`);
            } else {
                detallesDescartados++;
                console.log(`⚠️ [PRESUPUESTOS-CREATE] Detalle ${index + 1} descartado (campo vacío del lector):`, {
                    tieneCodigoBarras,
                    tieneCantidadValida,
                    tieneArticuloTexto,
                    articulo: detalle.articulo,
                    cantidad: detalle.cantidad
                });
            }
        });

        console.log(`📊 [PRESUPUESTOS-CREATE] Resumen de detalles:`, {
            encontrados: detallesEncontrados,
            validos: detallesValidos,
            descartados: detallesDescartados
        });

        // Validar que hay detalles válidos después del filtrado
        if (data.detalles.length === 0) {
            throw new Error('Debe agregar al menos un artículo válido. Asegúrese de seleccionar artículos desde el autocompletar y que tengan cantidad mayor a 0.');
        }

        // LogData para ver defaults efectivos (incluye estado)
        console.log('🧾 [PRESUPUESTOS-CREATE] LogData (payload):', data);

        // Generar Idempotency-Key
        const idempotencyKey = generateUUID();
        console.log(`🔑 [PRESUPUESTOS-CREATE] Idempotency-Key generada: ${idempotencyKey}`);

        // Enviar a la API con timeout y mejor manejo de errores
        console.log('🌐 [PRESUPUESTOS-CREATE] Enviando request a /api/presupuestos...');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 segundos timeout

        let response;
        try {
            response = await fetch('/api/presupuestos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify(data),
                signal: controller.signal
            });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('❌ [PRESUPUESTOS-CREATE] Error en fetch:', fetchError);

            if (fetchError.name === 'AbortError') {
                throw new Error('Timeout: El servidor tardó demasiado en responder');
            } else {
                throw new Error('Error de conexión con el servidor');
            }
        }

        clearTimeout(timeoutId);

        console.log(`📡 [PRESUPUESTOS-CREATE] Response status: ${response.status} ${response.statusText}`);

        let result;
        try {
            const responseText = await response.text();
            console.log(`📄 [PRESUPUESTOS-CREATE] Response text: ${responseText.substring(0, 200)}...`);

            if (!responseText.trim()) {
                throw new Error('Respuesta vacía del servidor');
            }

            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ [PRESUPUESTOS-CREATE] Error parsing JSON:', parseError);
            console.error('❌ [PRESUPUESTOS-CREATE] Response status:', response.status);
            console.error('❌ [PRESUPUESTOS-CREATE] Response headers:', [...response.headers.entries()]);

            if (response.status >= 500) {
                throw new Error('Error interno del servidor (500)');
            } else if (response.status >= 400) {
                throw new Error(`Error de validación (${response.status})`);
            } else {
                throw new Error('Respuesta inválida del servidor');
            }
        }

        console.log('📥 [PRESUPUESTOS-CREATE] Respuesta recibida:', result);

        if (response.ok && result && result.success) {
            mostrarMensaje(`✅ Presupuesto guardado en BD (PENDIENTE)`, 'success');

            console.log(`✅ [PRESUPUESTOS-CREATE] Presupuesto creado: ${result.data?.id_presupuesto || 'N/A'} - Estado: ${result.data?.estado || 'N/A'}`);

            setTimeout(() => {
                window.location.href = '/pages/presupuestos.html';
            }, 1200);

        } else {
            const errorMsg = result?.error || result?.message || `Error HTTP ${response.status}: ${response.statusText}`;
            console.error(`❌ [PRESUPUESTOS-CREATE] Error del servidor: ${errorMsg}`);
            throw new Error(errorMsg);
        }

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-CREATE] Error al crear presupuesto:', error);

        let errorMessage = 'Error desconocido';
        if (error.name === 'AbortError') {
            errorMessage = 'Timeout: El servidor tardó demasiado en responder';
        } else if (error.message) {
            errorMessage = error.message;
        }

        mostrarMensaje(`❌ Error al crear presupuesto: ${errorMessage}`, 'error');

    } finally {
        console.log('🔄 [PRESUPUESTOS-CREATE] Ejecutando finally - re-habilitando botón...');

        try {
            if (btnGuardar) {
                btnGuardar.disabled = false;
                console.log('✅ [PRESUPUESTOS-CREATE] Botón re-habilitado');
            }
            if (spinner) {
                spinner.style.display = 'none';
                console.log('✅ [PRESUPUESTOS-CREATE] Spinner ocultado');
            }
        } catch (finallyError) {
            console.error('❌ [PRESUPUESTOS-CREATE] Error en finally:', finallyError);
            setTimeout(() => {
                const btn = document.getElementById('btn-guardar');
                const spn = btn?.querySelector('.loading-spinner');
                if (btn) btn.disabled = false;
                if (spn) spn.style.display = 'none';
                console.log('🔧 [PRESUPUESTOS-CREATE] Re-habilitación forzada ejecutada');
            }, 100);
        }
    }
}

/**
 * Mostrar mensaje al usuario
 */
function mostrarMensaje(texto, tipo = 'info') {
    console.log(`💬 [PRESUPUESTOS-CREATE] Mostrando mensaje: ${texto}`);

    const container = document.getElementById('message-container');

    if (!container) {
        console.warn('⚠️ [PRESUPUESTOS-CREATE] #message-container no encontrado, usando alert()');
        if (tipo === 'error') {
            alert(texto);
        } else {
            // Info/success -> no molestar con alert si no es crítico
            console.log(`[MSG ${tipo}] ${texto}`);
        }
        return;
    }

    // Limpiar mensajes anteriores
    container.innerHTML = '';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${tipo}`;
    messageDiv.textContent = texto;
    messageDiv.style.display = 'block';

    container.appendChild(messageDiv);

    // Auto-ocultar después de 5 segundos (excepto errores)
    if (tipo !== 'error') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
}

// ===== FUNCIONES DE AUTOCOMPLETAR DE CLIENTES =====

/**
 * Configurar autocompletar de clientes
 */
function setupClienteAutocomplete() {
    console.log('🔍 [NuevoPresupuesto] Configurando autocompletar de clientes...');

    const input = document.getElementById('id_cliente');
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');

    if (!input || !sugerenciasContainer) {
        console.error('❌ [NuevoPresupuesto] Elementos de autocompletar no encontrados');
        return;
    }

    // Event listeners
    input.addEventListener('input', debounce(handleClienteInput, 300));
    input.addEventListener('keydown', handleClienteKeydown);
    input.addEventListener('blur', handleClienteBlur);

    // Cerrar con click fuera
    document.addEventListener('click', (event) => {
        if (!input.contains(event.target) && !sugerenciasContainer.contains(event.target)) {
            ocultarSugerencias();
        }
    });

    console.log('✅ [NuevoPresupuesto] Autocompletar configurado correctamente');
}

/**
 * Debounce function para evitar requests excesivos
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Manejar input de cliente
 */
async function handleClienteInput(event) {
    const query = event.target.value.trim();

    console.log(`🔍 [NuevoPresupuesto] Búsqueda de cliente: "${query}"`);

    // Cancelar request anterior si existe
    if (currentRequest) {
        currentRequest.abort();
        currentRequest = null;
    }

    // Reset estado
    selectedIndex = -1;
    clienteSeleccionado = null;

    // Si query muy corto, ocultar sugerencias
    if (query.length < 1) {
        ocultarSugerencias();
        return;
    }

    try {
        // Mostrar loading
        mostrarLoading();

        // Crear AbortController para cancelar request
        const controller = new AbortController();
        currentRequest = controller;

        // Hacer request al endpoint existente
        const response = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`, {
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log(`📋 [NuevoPresupuesto] Sugerencias recibidas: ${result.data.length} clientes`);

        // Mostrar sugerencias
        mostrarSugerencias(result.data);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('🔄 [NuevoPresupuesto] Request cancelado');
            return;
        }

        console.error('❌ [NuevoPresupuesto] Error al buscar clientes:', error);
        mostrarError('Error al buscar clientes. Podés escribir el ID manualmente.');

    } finally {
        currentRequest = null;
    }
}

/**
 * Manejar teclas especiales
 */
function handleClienteKeydown(event) {
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    const items = sugerenciasContainer ? sugerenciasContainer.querySelectorAll('.cliente-sugerencia-item') : [];

    if (!items || items.length === 0) return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelection(items);
            break;

        case 'ArrowUp':
            event.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection(items);
            break;

        case 'Enter':
            event.preventDefault(); // ✅ Evitar submit del formulario

            // Si hay un índice seleccionado (navegación con flechas), usar ese
            if (selectedIndex >= 0 && items[selectedIndex]) {
                seleccionarCliente(items[selectedIndex]);
            }
            // Si no hay índice seleccionado pero hay resultados, auto-seleccionar el primero
            else if (items.length > 0) {
                console.log('🔍 [NuevoPresupuesto] Auto-seleccionando primer resultado al presionar Enter');
                seleccionarCliente(items[0]);
            }
            break;

        case 'Escape':
            event.preventDefault();
            ocultarSugerencias();
            break;
    }
}

/**
 * Manejar blur del input
 */
function handleClienteBlur() {
    // Delay para permitir click en sugerencias
    setTimeout(() => {
        const sugerenciasContainer = document.getElementById('cliente-sugerencias');
        if (sugerenciasContainer && !sugerenciasContainer.matches(':hover')) {
            ocultarSugerencias();
        }
    }, 150);
}

/**
 * Mostrar loading
 */
function mostrarLoading() {
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    if (!sugerenciasContainer) return;
    sugerenciasContainer.innerHTML = '<div class="cliente-loading">Buscando clientes</div>';
    sugerenciasContainer.style.display = 'block';
}

/**
 * Mostrar sugerencias
 */
function mostrarSugerencias(clientes) {
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    if (!sugerenciasContainer) return;

    if (!Array.isArray(clientes) || clientes.length === 0) {
        sugerenciasContainer.innerHTML = '<div class="cliente-sin-resultados">Sin resultados</div>';
        sugerenciasContainer.style.display = 'block';
        return;
    }

    // Limitar a 10 resultados máximo
    const clientesLimitados = clientes.slice(0, 10);

    const html = clientesLimitados.map((cliente) => {
        // Formatear número con ceros (mínimo 4 dígitos, no cortar si es más largo)
        const numeroFormateado = formatearNumeroCliente(cliente.id);

        // Formatear nombre (evitar "undefined")
        const nombreCompleto = formatearNombreCliente(cliente.nombre, cliente.apellido);

        // CUIT opcional
        const cuitInfo = cliente.cuit ? `<span class="cliente-cuit">CUIT: ${cliente.cuit}</span>` : '';

        return `
            <div class="cliente-sugerencia-item"
                 data-cliente-id="${cliente.id}"
                 data-cliente-numero="${numeroFormateado}"
                 data-cliente-nombre="${nombreCompleto}"
                 data-cliente-cuit="${cliente.cuit || ''}"
                 onclick="seleccionarClientePorClick(this)">
                <span class="cliente-numero">${numeroFormateado}</span>
                <span class="cliente-nombre">— ${nombreCompleto}</span>
                ${cuitInfo}
            </div>
        `;
    }).join('');

    sugerenciasContainer.innerHTML = html;
    sugerenciasContainer.style.display = 'block';
    selectedIndex = -1; // Reset selección
}

/**
 * Mostrar error
 */
function mostrarError(mensaje) {
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    if (!sugerenciasContainer) return;
    sugerenciasContainer.innerHTML = `<div class="cliente-sin-resultados">${mensaje}</div>`;
    sugerenciasContainer.style.display = 'block';
}

/**
 * Ocultar sugerencias
 */
function ocultarSugerencias() {
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    if (sugerenciasContainer) {
        sugerenciasContainer.style.display = 'none';
    }
    selectedIndex = -1;
}

/**
 * Actualizar selección visual
 */
function updateSelection(items) {
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
    });

    // Scroll al elemento seleccionado
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

/**
 * Seleccionar cliente por click
 */
function seleccionarClientePorClick(element) {
    seleccionarCliente(element);
}

/**
 * Seleccionar cliente
 */
function seleccionarCliente(element) {
    const clienteId = element.dataset.clienteId;
    const numeroFormateado = element.dataset.clienteNumero;
    const nombreCompleto = element.dataset.clienteNombre;
    const cuit = element.dataset.clienteCuit;

    // Guardar cliente seleccionado
    clienteSeleccionado = {
        cliente_id: parseInt(clienteId, 10),
        numero_fmt: numeroFormateado,
        nombre: nombreCompleto,
        cuit: cuit
    };

    // Hook para Modo Retiro (Fase 2)
    if (typeof hookSeleccionCliente === 'function') {
        hookSeleccionCliente(clienteSeleccionado);
    }

    // Actualizar input con número formateado
    const input = document.getElementById('id_cliente');
    if (input) input.value = numeroFormateado;

    // Log según especificación
    console.log(`✅ [NuevoPresupuesto] Cliente seleccionado`, clienteSeleccionado);

    // Mostrar nombre del cliente en grande
    if (typeof window.mostrarNombreCliente === 'function') {
        window.mostrarNombreCliente({
            nombre: nombreCompleto,
            cuit: cuit
        });
    }

    // Ocultar sugerencias
    ocultarSugerencias();

    // ✅ NUEVO: Cargar historial de entregas del cliente
    cargarHistorialEntregas(clienteId);
}

/**
 * Formatear número de cliente con ceros
 */
function formatearNumeroCliente(clienteId) {
    const numero = parseInt(clienteId, 10);
    if (isNaN(numero)) return (clienteId ?? '').toString();

    // Mínimo 4 dígitos, no cortar si es más largo
    return numero.toString().padStart(4, '0');
}

/**
 * Formatear nombre completo evitando "undefined"
 */
function formatearNombreCliente(nombre, apellido) {
    const partes = [];

    if (apellido && apellido.trim() && apellido !== 'undefined') {
        partes.push(apellido.trim());
    }

    if (nombre && nombre.trim() && nombre !== 'undefined') {
        partes.push(nombre.trim());
    }

    return partes.length > 0 ? partes.join(', ') : 'Sin nombre';
}

/**
 * Normalizar texto para búsqueda (tolerancia a acentos, PRESERVANDO caracteres especiales)
 * NUEVA LÓGICA: Mantiene símbolos como /, +, - para coincidencias exactas
 */
function normalizarTexto(texto) {
    return (texto ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remover acentos
        // NO reemplazar caracteres especiales - los mantenemos para búsqueda exacta
        .replace(/\s+/g, ' ') // Normalizar espacios múltiples a uno solo
        .trim();
}
// === Cache opcional de artículos + helpers ===
window.__articulosCache = window.__articulosCache || [];
window.__articulosCacheLoaded = window.__articulosCacheLoaded || false;

async function precargarArticulosAll() {
    // Precarga global deshabilitada: la API de sugerencias requiere ?q=
    // Devolvemos vacío para no generar errores ni peticiones innecesarias.
    return [];
}

/**
 * Filtrar artículos localmente con lógica de TOKENS ESTRICTOS
 * NUEVA LÓGICA: Búsqueda exacta de subcadenas preservando caracteres especiales
 * 
 * Ejemplo: "nuez cas/36+" genera tokens ["nuez", "cas/36+"]
 * - Debe encontrar artículos que contengan AMBOS tokens como subcadenas exactas
 * - "Nuez/Cas/34-36" NO coincide porque "cas/36+" no está presente (tiene "34-36" en su lugar)
 * - "Nuez Cas/36+ x 5" SÍ coincide porque contiene ambos tokens exactos
 */
function filtrarArticulosLocal(query, items) {
    // Tokenizar: dividir por espacios, preservando caracteres especiales dentro de cada token
    const terms = normalizarTexto(query).split(/\s+/).filter(Boolean);

    console.log('[ARTICULOS-FILTER] Iniciando filtrado ESTRICTO...', {
        modo: modoBusqueda,
        query_original: query,
        query_normalizado: normalizarTexto(query),
        tokens_generados: terms,
        items_recibidos: items.length
    });

    const out = (items || []).filter(a => {
        let cumple = false;

        if (modoBusqueda === 'codigo') {
            // MODO CÓDIGO DE BARRAS: Búsqueda exacta en código de barras
            const codigoBarras = (a.codigo_barras || '').toString().toLowerCase();
            const queryLower = query.toLowerCase();
            cumple = codigoBarras.includes(queryLower);

            // Log detallado para los primeros 3 artículos (debug)
            if (items.indexOf(a) < 3) {
                console.log('[ARTICULOS-FILTER] [MODO-CODIGO] Evaluando artículo:', {
                    descripcion: a.description ?? a.descripcion,
                    codigo_barras: a.codigo_barras,
                    query_buscado: queryLower,
                    cumple: cumple
                });
            }
        } else {
            // MODO DESCRIPCIÓN: Búsqueda ESTRICTA por tokens exactos
            const descripcionNormalizada = normalizarTexto(a.description ?? a.descripcion ?? '');

            // ✅ LÓGICA ESTRICTA: TODOS los tokens deben estar presentes como SUBCADENAS EXACTAS
            // Esto significa que "cas/36+" debe aparecer literalmente en la descripción
            // NO coincidirá con "cas/34-36" porque los caracteres no son idénticos
            cumple = terms.every(token => descripcionNormalizada.includes(token));

            // Log detallado para los primeros 3 artículos (debug)
            if (items.indexOf(a) < 3) {
                console.log('[ARTICULOS-FILTER] [MODO-DESCRIPCION-ESTRICTO] Evaluando artículo:', {
                    descripcion_original: a.description ?? a.descripcion,
                    descripcion_normalizada: descripcionNormalizada,
                    tokens_buscados: terms,
                    cumple_todos: cumple,
                    detalles_coincidencia: terms.map(token => ({
                        token: token,
                        encontrado: descripcionNormalizada.includes(token),
                        posicion: descripcionNormalizada.indexOf(token)
                    }))
                });
            }
        }

        return cumple;
    });

    // Orden: stock>0 primero, luego descripción
    out.sort((A, B) => {
        const pa = Number(A.stock_consolidado || 0) > 0 ? 0 : 1;
        const pb = Number(B.stock_consolidado || 0) > 0 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const la = (A.description ?? A.descripcion ?? '').toString();
        const lb = (B.description ?? B.descripcion ?? '').toString();
        return la.localeCompare(lb);
    });

    // Log de depuración final
    console.log('[ARTICULOS-FILTER] Filtrado ESTRICTO completado:', {
        modo: modoBusqueda,
        query_original: query,
        tokens: terms,
        items_recibidos: items.length,
        resultados_filtrados: out.length
    });

    // Limite visual
    return out.slice(0, 50);
}
// ===== FUNCIONES DE AUTOCOMPLETAR DE ARTÍCULOS =====

/**
 * Configurar autocompletar para artículos
 */
function setupArticuloAutocomplete() {
    console.log('🔧 [PRESUPUESTOS-CREATE] Configurando autocompletar de artículos...');

    // Usar delegación de eventos para manejar inputs dinámicos
    document.addEventListener('input', function (event) {
        // Verificar si el input es de artículo
        if (event.target.name && event.target.name.includes('[articulo]')) {
            handleArticuloInput(event);
        }
    });

    // Manejar teclas especiales para navegación
    document.addEventListener('keydown', function (event) {
        if (event.target.name && event.target.name.includes('[articulo]')) {
            handleArticuloKeydown(event);
        }
    });

    // Cerrar sugerencias al hacer click fuera
    document.addEventListener('click', function (event) {
        const sugerenciasContainer = document.querySelector('.articulo-sugerencias');
        if (sugerenciasContainer && !event.target.closest('.articulo-input-container')) {
            ocultarSugerenciasArticulo();
        }
    });

    console.log('✅ [PRESUPUESTOS-CREATE] Autocompletar de artículos configurado');
}

/**
 * Manejar input de artículo con debounce
 */
const handleArticuloInput = debounce(async function (event) {
    const input = event.target;
    const query = (input.value || '').trim();

    console.log(`[ARTICULOS] Búsqueda de artículo: "${query}"`);

    if (query.length < 1) {
        ocultarSugerenciasArticulo();
        return;
    }

    // EN MODO CÓDIGO: No mostrar sugerencias, solo esperar Enter
    if (modoBusqueda === 'codigo') {
        console.log('[MODO-CODIGO] Input detectado, esperando Enter para procesar');
        return;
    }

    try {
        mostrarLoadingArticulo(input);

        let items = [];
        // 1) Si hay cache completa, filtrar localmente (trae TODAS las coincidencias)
        if (window.__articulosCacheLoaded && Array.isArray(window.__articulosCache) && window.__articulosCache.length) {
            items = filtrarArticulosLocal(query, window.__articulosCache);
        } else {
            // 2) Fallback: pedir al endpoint existente por query
            const isFileProtocol = window.location.protocol === 'file:';
            if (isFileProtocol) {
                const sim = await simularBusquedaArticulos(query);
                items = filtrarArticulosLocal(query, sim.data || []);
            } else {
                // CORRECCIÓN: Usar solo el primer término para el servidor (más amplio)
                // y luego filtrar localmente con AND estricto
                const primerTermino = query.split(/\s+/)[0] || query;
                const queryParaServidor = primerTermino;

                console.log(`[ARTICULOS] Query para servidor: "${queryParaServidor}" (filtrado local aplicará AND completo)`);

                const response = await fetch(`/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(queryParaServidor)}&limit=500`);
                if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
                const body = await response.json();
                const arr = Array.isArray(body) ? body : (body.data || body.items || []);

                // Aplicar filtro local con TODOS los términos del query original
                items = filtrarArticulosLocal(query, arr);
            }
        }

        console.log(`[ARTICULOS] Sugerencias preparadas: ${items.length} artículos`);
        mostrarSugerenciasArticulo(input, items);

    } catch (error) {
        console.error('Error al buscar artículos:', error);
        mostrarErrorArticulo(input, 'Error al buscar artículos');
    }
}, 300);

/**
 * Simular búsqueda de artículos para modo desarrollo
 */
async function simularBusquedaArticulos(query) {
    // Simular delay de red
    await new Promise(resolve => setTimeout(resolve, 200));

    // Datos de ejemplo
    const articulosEjemplo = [
        {
            codigo_barras: '7790001234567',
            articulo_numero: 'ART001',
            description: 'Producto de Ejemplo A - Descripción larga del producto',
            stock_consolidado: 50,
            etiquetas: []
        },
        {
            codigo_barras: '7790001234568',
            articulo_numero: 'ART002',
            description: 'Producto de Ejemplo B - Otro producto de prueba',
            stock_consolidado: 25,
            etiquetas: ['PACK']
        },
        {
            codigo_barras: '7790001234569',
            articulo_numero: 'ART003',
            description: 'Producto de Ejemplo C - Sin stock disponible',
            stock_consolidado: 0,
            etiquetas: ['PRODUCCIÓN']
        },
        {
            codigo_barras: '7790001234570',
            articulo_numero: 'ART004',
            description: 'Producto de Ejemplo D - Con múltiples etiquetas',
            stock_consolidado: 100,
            etiquetas: ['PACK', 'PRODUCCIÓN']
        },
        {
            codigo_barras: '7790001234571',
            articulo_numero: 'ART005',
            description: 'Producto de Ejemplo E - Stock medio',
            stock_consolidado: 15,
            etiquetas: []
        }
    ];

    // Filtrar por query
    const queryLower = query.toLowerCase();
    const resultados = articulosEjemplo.filter(articulo =>
        articulo.description.toLowerCase().includes(queryLower) ||
        articulo.articulo_numero.toLowerCase().includes(queryLower) ||
        articulo.codigo_barras.includes(query)
    );

    // Formatear como respuesta de API
    const data = resultados.map(articulo => ({
        ...articulo,
        text: `${articulo.description} — [${articulo.articulo_numero}] (stock: ${Math.floor(articulo.stock_consolidado)})${articulo.etiquetas.length > 0 ? ` ${articulo.etiquetas.join(' ')}` : ''}`
    }));

    return {
        success: true,
        data: data,
        query: query,
        total: data.length,
        timestamp: new Date().toISOString()
    };
}

/**
 * Manejar teclas especiales para artículos
 */
function handleArticuloKeydown(event) {
    // MODO CÓDIGO DE BARRAS: Detectar Enter para carga directa
    if (event.key === 'Enter' && modoBusqueda === 'codigo') {
        event.preventDefault();
        const input = event.target;
        const query = (input.value || '').trim();

        if (query.length > 0) {
            console.log('[MODO-CODIGO] Enter detectado, procesando código:', query);
            handleCodigoBarrasEnter(input, query);
        }
        return;
    }

    // MODO DESCRIPCIÓN: Comportamiento normal con sugerencias
    const sugerenciasContainer = document.querySelector('.articulo-sugerencias');
    if (!sugerenciasContainer || sugerenciasContainer.style.display === 'none') return;

    const items = sugerenciasContainer.querySelectorAll('.articulo-sugerencia-item');
    if (items.length === 0) return;

    let selectedIndex = parseInt(sugerenciasContainer.dataset.selectedIndex || '-1', 10);

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateArticuloSelection(items, selectedIndex);
            break;

        case 'ArrowUp':
            event.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateArticuloSelection(items, selectedIndex);
            break;

        case 'Enter':
            event.preventDefault();
            if (selectedIndex >= 0 && items[selectedIndex]) {
                seleccionarArticulo(event.target, items[selectedIndex]);
            }
            break;

        case 'Escape':
            event.preventDefault();
            ocultarSugerenciasArticulo();
            break;
    }
}

/**
 * Manejar escaneo de código de barras (Enter en modo código)
 * Busca el artículo, verifica si ya existe en el detalle, y suma cantidad o agrega nuevo
 */
async function handleCodigoBarrasEnter(input, codigoBarras) {
    console.log('[MODO-CODIGO] Procesando código de barras:', codigoBarras);

    try {
        // Ocultar sugerencias si están visibles
        ocultarSugerenciasArticulo();

        // Buscar artículo por código exacto
        const articulo = await buscarArticuloPorCodigoExacto(codigoBarras);

        if (!articulo) {
            console.warn('[MODO-CODIGO] No se encontró artículo con código:', codigoBarras);
            mostrarMensaje(`No se encontró artículo con código: ${codigoBarras}`, 'error');

            // Limpiar campo y mantener foco
            input.value = '';
            input.focus();
            return;
        }

        console.log('[MODO-CODIGO] Artículo encontrado:', articulo);

        // Verificar si el artículo ya existe en el detalle
        const filaExistente = buscarArticuloEnDetalle(articulo.codigo_barras);

        if (filaExistente) {
            // Artículo ya existe: sumar 1 a la cantidad
            console.log('[MODO-CODIGO] Artículo ya existe en detalle, sumando cantidad');
            incrementarCantidadArticulo(filaExistente);
        } else {
            // Artículo nuevo: agregar fila con cantidad 1
            console.log('[MODO-CODIGO] Artículo nuevo, agregando al detalle');
            await agregarArticuloAlDetalle(articulo, input);
        }

        // Limpiar campo y mantener foco para siguiente escaneo
        input.value = '';
        input.focus();

        console.log('[MODO-CODIGO] Código procesado exitosamente, listo para siguiente escaneo');

    } catch (error) {
        console.error('[MODO-CODIGO] Error al procesar código de barras:', error);
        mostrarMensaje(`Error al procesar código: ${error.message}`, 'error');

        // Limpiar campo y mantener foco
        input.value = '';
        input.focus();
    }
}

/**
 * Buscar artículo por código de barras exacto
 */
async function buscarArticuloPorCodigoExacto(codigoBarras) {
    console.log('[MODO-CODIGO] Buscando artículo por código exacto:', codigoBarras);

    try {
        const response = await fetch(`/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(codigoBarras)}&limit=100`);

        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status}`);
        }

        const body = await response.json();
        const articulos = Array.isArray(body) ? body : (body.data || body.items || []);

        // Buscar coincidencia exacta en código de barras
        const articuloExacto = articulos.find(a => {
            const codigo = (a.codigo_barras || '').toString().toLowerCase();
            return codigo === codigoBarras.toLowerCase();
        });

        if (articuloExacto) {
            console.log('[MODO-CODIGO] Coincidencia exacta encontrada:', articuloExacto);
            return articuloExacto;
        }

        // Si no hay coincidencia exacta, buscar que contenga el código
        const articuloContiene = articulos.find(a => {
            const codigo = (a.codigo_barras || '').toString().toLowerCase();
            return codigo.includes(codigoBarras.toLowerCase());
        });

        if (articuloContiene) {
            console.log('[MODO-CODIGO] Coincidencia parcial encontrada:', articuloContiene);
            return articuloContiene;
        }
    } catch (e) {
        console.error(e);
        mostrarMensaje('Error al importar: ' + e.message, 'error');
        agregarDetalle();
    }

    console.log('[MODO-CODIGO] No se encontró artículo con código:', codigoBarras);
    return null;
}

/**
 * Buscar si un artículo ya existe en el detalle del presupuesto
 * Retorna la fila (tr) si existe, null si no
 */
function buscarArticuloEnDetalle(codigoBarras) {
    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) return null;

    const rows = tbody.querySelectorAll('tr');

    for (let row of rows) {
        const articuloInput = row.querySelector('input[name*="[articulo]"]');
        if (!articuloInput) continue;

        // Verificar por código de barras guardado en dataset
        const codigoGuardado = (articuloInput.dataset.codigoBarras || '').toString().toLowerCase();
        const codigoBuscado = (codigoBarras || '').toString().toLowerCase();

        if (codigoGuardado && codigoGuardado === codigoBuscado) {
            console.log('[MODO-CODIGO] Artículo encontrado en detalle:', row.id);
            return row;
        }
    }

    console.log('[MODO-CODIGO] Artículo no existe en detalle');
    return null;
}

/**
 * Incrementar cantidad de un artículo existente en el detalle
 */
function incrementarCantidadArticulo(row) {
    const cantidadInput = row.querySelector('input[name*="[cantidad]"]');
    if (!cantidadInput) {
        console.error('[MODO-CODIGO] No se encontró input de cantidad en la fila');
        return;
    }

    const cantidadActual = parseFloat(cantidadInput.value) || 0;
    const nuevaCantidad = cantidadActual + 1;

    console.log(`[MODO-CODIGO] Incrementando cantidad: ${cantidadActual} -> ${nuevaCantidad}`);

    setCantidad(cantidadInput, nuevaCantidad);

    // Recalcular precio
    const detalleId = getDetalleIdFromInput(cantidadInput);
    if (detalleId != null) {
        calcularPrecio(detalleId);
    }

    // Efecto visual: resaltar fila brevemente
    row.style.backgroundColor = '#d4edda';
    setTimeout(() => {
        row.style.backgroundColor = '';
    }, 500);
}

/**
 * Agregar artículo al detalle (nueva fila)
 */
async function agregarArticuloAlDetalle(articulo, inputOriginal) {
    console.log('[MODO-CODIGO] Agregando artículo al detalle:', articulo);

    // Buscar la fila del input original
    const filaActual = inputOriginal.closest('tr');
    const articuloInputActual = filaActual?.querySelector('input[name*="[articulo]"]');

    // Si la fila actual está vacía, usarla; si no, crear nueva
    const usarFilaActual = articuloInputActual && (!articuloInputActual.value || articuloInputActual.value.trim() === '');

    let targetRow;
    let targetInput;

    if (usarFilaActual) {
        console.log('[MODO-CODIGO] Usando fila actual (vacía)');
        targetRow = filaActual;
        targetInput = articuloInputActual;
    } else {
        console.log('[MODO-CODIGO] Creando nueva fila');
        agregarDetalle();

        // Obtener la última fila agregada
        const tbody = document.getElementById('detalles-tbody');
        const rows = tbody.querySelectorAll('tr');
        targetRow = rows[rows.length - 1];
        targetInput = targetRow.querySelector('input[name*="[articulo]"]');
    }

    if (!targetInput) {
        console.error('[MODO-CODIGO] No se pudo obtener input de artículo');
        return;
    }

    // Llenar datos del artículo
    const description = (articulo.description || articulo.descripcion || '').toString();
    const codigoBarras = (articulo.codigo_barras || '').toString();
    const articuloNumero = (articulo.articulo_numero || '').toString();

    targetInput.value = description;
    targetInput.dataset.codigoBarras = codigoBarras;
    targetInput.dataset.articuloNumero = articuloNumero;

    // Establecer cantidad = 1
    const cantidadInput = targetRow.querySelector('input[name*="[cantidad]"]');
    if (cantidadInput) {
        setCantidad(cantidadInput, 1);
    }

    // Establecer IVA por defecto
    const iva1Input = targetRow.querySelector('input[name*="[iva1]"]');
    if (iva1Input && (iva1Input.value === '' || isNaN(parseFloat(iva1Input.value)))) {
        setNumeric(iva1Input, 21, 2, 21);
    }

    // Obtener precios del backend
    const clienteId = parseInt(getClienteIdActivo(), 10) || 0;
    const detalleId = getDetalleIdFromInput(cantidadInput || targetInput);

    try {
        const params = new URLSearchParams();
        params.set('cliente_id', String(clienteId));
        if (codigoBarras) params.set('codigo_barras', codigoBarras);

        const url = `/api/presupuestos/precios?${params.toString()}`;
        console.log('[MODO-CODIGO] Obteniendo precios:', url);

        const response = await fetch(url);
        if (response.ok) {
            const body = await response.json();
            const valor = Number(body?.data?.valor1);
            const iva = Number(body?.data?.iva);

            const valor1Input = targetRow.querySelector('input[name*="[valor1]"]');

            if (Number.isFinite(valor) && valor1Input) {
                setNumeric(valor1Input, valor, 2, 0);
            }

            if (Number.isFinite(iva) && iva1Input) {
                iva1Input.dataset.ivaBase = String(iva);
                const tipoSel = document.getElementById('tipo_comprobante');
                const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
                setNumeric(iva1Input, visibleIva, 2, 21);
            }

            if (detalleId != null) {
                calcularPrecio(detalleId);
            }
        }
    } catch (error) {
        console.warn('[MODO-CODIGO] Error al obtener precios:', error);
    }

    // Efecto visual: resaltar fila brevemente
    targetRow.style.backgroundColor = '#d1ecf1';
    setTimeout(() => {
        targetRow.style.backgroundColor = '';
    }, 500);

    console.log('[MODO-CODIGO] Artículo agregado exitosamente');
}

/**
 * Mostrar loading para artículos
 */
function mostrarLoadingArticulo(input) {
    const container = getOrCreateSugerenciasContainer();
    posicionarSugerenciasArticulo(input, container);
    return;
}


function mostrarSugerenciasArticulo(input, articulos) {
    const container = getOrCreateSugerenciasContainer();

    if (!Array.isArray(articulos) || articulos.length === 0) {
        container.innerHTML = '<div class="articulo-sin-resultados">No se encontraron artículos</div>';
        container.style.display = 'block';
        posicionarSugerenciasArticulo(input, container);
        return;
    }

    // Re-asegurar orden por si vinieron sin ordenar
    articulos.sort((A, B) => {
        const pa = Number(A.stock_consolidado || 0) > 0 ? 0 : 1;
        const pb = Number(B.stock_consolidado || 0) > 0 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const la = (A.description ?? A.descripcion ?? '').toString();
        const lb = (B.description ?? B.descripcion ?? '').toString();
        return la.localeCompare(lb);
    });

    // Mostrar más de 8 (50 máx) para no cortar resultados
    const articulosLimitados = articulos.slice(0, 50);

    const html = articulosLimitados.map((articulo, index) => {
        const label = (articulo.description ?? articulo.descripcion ?? '').toString();
        // const selectedClass = index === selectedIndex ? 'selected' : ''; // selectedIndex no está definido aquí

        let stockClass = 'con-stock';
        if ((articulo.stock_consolidado ?? 0) <= 0) stockClass = 'sin-stock';
        // else if (articulo.stock_consolidado < 10) stockClass = 'stock-low'; // No existe en el original

        const safeLabel = label.replace(/"/g, '&quot;');

        let etiquetas = '';
        if (articulo.etiquetas && Array.isArray(articulo.etiquetas) && articulo.etiquetas.length > 0) {
            etiquetas = `<span class="articulo-etiquetas">${articulo.etiquetas.join(' ')}</span>`;
        }

        return `
      <div class="articulo-sugerencia-item"
           data-codigo-barras="${articulo.codigo_barras || ''}"
           data-articulo-numero="${articulo.articulo_numero || ''}"
           data-description="${safeLabel}"
           data-stock="${articulo.stock_consolidado || 0}"
           onclick="seleccionarArticuloPorClick(this, event)">
        <div class="articulo-description">${label}</div>
        <div class="articulo-details">
          <span class="articulo-numero">[${articulo.articulo_numero || ''}]</span>
          <span class="articulo-stock ${stockClass}">Stock: ${Math.floor(articulo.stock_consolidado || 0)}</span>
          ${etiquetas}
        </div>
      </div>
    `;
    }).join('');

    container.innerHTML = html;
    container.style.display = 'block';
    container.dataset.selectedIndex = '-1';
    posicionarSugerenciasArticulo(input, container);
}

function mostrarErrorArticulo(input, mensaje) {
    const container = getOrCreateSugerenciasContainer();
    container.innerHTML = `<div class="articulo-sin-resultados">${mensaje}</div>`;
    container.style.display = 'block';
    posicionarSugerenciasArticulo(input, container);
}

/**
 * Ocultar sugerencias de artículos
 */
function ocultarSugerenciasArticulo() {
    const container = document.querySelector('.articulo-sugerencias');
    if (container) {
        container.style.display = 'none';
        container.dataset.selectedIndex = '-1';
    }
}

/**
 * Obtener o crear contenedor de sugerencias
 */
function getOrCreateSugerenciasContainer() {
    let container = document.querySelector('.articulo-sugerencias');

    if (!container) {
        container = document.createElement('div');
        container.className = 'articulo-sugerencias';
        container.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            min-width: 300px;
        `;
        document.body.appendChild(container);
    }

    return container;
}

/**
 * Posicionar sugerencias relativo al input
 */
function posicionarSugerenciasArticulo(input, container) {
    if (!input || !container) return;
    const rect = input.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    container.style.left = (rect.left + scrollLeft) + 'px';
    container.style.top = (rect.bottom + scrollTop + 2) + 'px';
    container.style.width = Math.max(rect.width, 300) + 'px';
}

/**
 * Actualizar selección visual de artículos
 */
function updateArticuloSelection(items, selectedIndex) {
    const container = document.querySelector('.articulo-sugerencias');
    if (container) container.dataset.selectedIndex = selectedIndex;

    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedIndex);
    });

    // Scroll al elemento seleccionado
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

/**
 * Seleccionar artículo por click
 */
function seleccionarArticuloPorClick(element, event) {
    // Encontrar el input activo (el que activó las sugerencias)
    let input = document.querySelector('input[name*="[articulo]"]:focus');

    // Si no hay input enfocado, buscar el último input de artículo que se usó
    if (!input) {
        // Buscar todos los inputs de artículo y tomar el que tenga contenido parcial
        const inputs = document.querySelectorAll('input[name*="[articulo]"]');
        for (let i = inputs.length - 1; i >= 0; i--) {
            if (inputs[i].value && inputs[i].value.trim().length > 0) {
                input = inputs[i];
                break;
            }
        }
    }

    // Si aún no encontramos input, tomar el primero disponible
    if (!input) {
        input = document.querySelector('input[name*="[articulo]"]');
    }

    if (input) {
        seleccionarArticulo(input, element);
    } else {
        console.error('❌ [ARTICULOS] No se pudo encontrar input de artículo para selección');
    }
}

// ===== FUNCIONES DE HISTORIAL DE ENTREGAS =====

/**
 * Cargar historial de entregas del cliente
 */
async function cargarHistorialEntregas(clienteId) {
    if (MODO_RETIRO) return;
    console.log(`📦 [HISTORIAL] Cargando historial de entregas para cliente: ${clienteId}`);

    const section = document.getElementById('historial-entregas-section');
    const content = document.getElementById('historial-entregas-content');

    if (!section || !content) {
        console.warn('⚠️ [HISTORIAL] Elementos del historial no encontrados');
        return;
    }

    // Mostrar sección y estado de carga
    section.style.display = 'block';
    content.innerHTML = '<div class="historial-loading"><p>🔍 Cargando historial de entregas...</p></div>';

    try {
        const response = await fetch(`/api/presupuestos/clientes/${clienteId}/historial-entregas`);

        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log(`✅ [HISTORIAL] Historial recibido:`, result.data);

        // Renderizar historial
        renderizarHistorialEntregas(result.data);

    } catch (error) {
        console.error('❌ [HISTORIAL] Error al cargar historial:', error);
        content.innerHTML = `
            <div class="historial-error">
                <p>⚠️ Error al cargar el historial de entregas</p>
                <p style="font-size: 0.9em; margin-top: 5px;">${error.message}</p>
            </div>
        `;
    }
}

/**
 * Renderizar historial de entregas agrupado por meses
 * VERSIÓN MEJORADA: Descripción, cantidad, PRECIO ACTUAL y fecha
 */
function renderizarHistorialEntregas(data) {
    const content = document.getElementById('historial-entregas-content');
    const btnPDF = document.getElementById('btn-imprimir-lista-precios');

    if (!content) return;

    // ✅ CAMBIO: Botón SIEMPRE visible cuando hay cliente seleccionado
    if (btnPDF) btnPDF.style.display = 'inline-flex';

    // Si no hay historial
    if (data.sin_historial || !data.grupos || data.grupos.length === 0) {
        content.innerHTML = `
            <div class="historial-sin-datos">
                <p>📭 Este cliente no tiene entregas previas registradas</p>
                <p style="font-size: 0.9em; color: #666; margin-top: 10px;">
                    💡 Puede generar una lista de precios desde el catálogo general
                </p>
            </div>
        `;

        return;
    }

    // Construir HTML para cada grupo de mes
    let html = '';

    data.grupos.forEach(grupo => {
        html += `
            <div class="historial-grupo">
                <div class="historial-grupo-header">
                    <span>${grupo.label}</span>
                    <span class="historial-grupo-badge">${grupo.productos.length}</span>
                </div>
                <ul class="historial-productos-list">
        `;

        grupo.productos.forEach(producto => {
            const fechaFormateada = formatearFechaHistorial(producto.fecha_entrega);
            const precioActual = producto.precio_actual || 0;

            // ✅ VERSIÓN MEJORADA: Descripción, cantidad, PRECIO ACTUAL y fecha
            html += `
                <li class="historial-producto-item">
                    <div class="historial-producto-info">
                        <div class="historial-producto-descripcion" title="${producto.descripcion}">${producto.descripcion}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span class="historial-producto-cantidad">×${producto.cantidad}</span>
                        <span class="historial-producto-precio" style="font-weight: 600; color: #10b981; min-width: 80px; text-align: right;">
                            $${precioActual.toFixed(2)}
                        </span>
                        <span class="historial-producto-fecha">${fechaFormateada}</span>
                    </div>
                </li>
            `;
        });

        html += `
                </ul>
            </div>
        `;
    });

    content.innerHTML = html;

    console.log(`✅ [HISTORIAL] Historial renderizado: ${data.total_productos_unicos} productos únicos en ${data.grupos.length} grupos`);
}

/**
 * Imprimir lista de precios personalizada
 * Ahora abre la página de previsualización en lugar del modal
 */
async function imprimirListaPreciosPersonalizada() {
    console.log('[HISTORIAL-PREVIEW] Abriendo página de previsualización...');

    if (!clienteSeleccionado || !clienteSeleccionado.cliente_id) {
        mostrarMensaje('Debe seleccionar un cliente primero', 'error');
        return;
    }

    // Abrir página de previsualización en nueva ventana
    const previewUrl = `/pages/imprimir-historial.html?cliente_id=${clienteSeleccionado.cliente_id}`;
    window.open(previewUrl, '_blank');

    console.log('[HISTORIAL-PREVIEW] Página de previsualización abierta');
}

// Exponer función globalmente
window.imprimirListaPreciosPersonalizada = imprimirListaPreciosPersonalizada;

/**
 * Formatear fecha para mostrar en el historial
 */
function formatearFechaHistorial(fecha) {
    if (!fecha) return '-';

    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return fecha;

        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        return fecha;
    }
}

// ===== FIN FUNCIONES DE HISTORIAL DE ENTREGAS =====

/**
 * Seleccionar artículo
 */
function seleccionarArticulo(input, element) {
    const codigoBarras = (element.dataset.codigoBarras || '').toString();
    const articuloNumero = (element.dataset.articuloNumero || '').toString(); // lo guardo, pero no lo uso en la query
    const description = (element.dataset.description || '').toString();
    const stock = parseFloat(element.dataset.stock || 0);



    // === FASE 2.3: INTERCEPCIÓN MODO RETIRO ===
    // Si estamos en modo retiro y NO venimos de una validación previa (propiedad custom)
    if (MODO_RETIRO && !element.dataset.origenValidado) {
        console.log('🛑 [MODO RETIRO] Interceptando selección para verificar historial...');
        verificarHistorialParaRetiro(input, element, {
            codigoBarras,
            articuloNumero,
            description,
            stock
        });
        return; // Detener flujo normal hasta que el usuario elija origen
    }

    // mostrar al usuario + guardar códigos reales para el submit
    input.value = description;
    input.dataset.codigoBarras = codigoBarras;
    input.dataset.articuloNumero = articuloNumero;

    console.log(`[ARTICULOS] Seleccionado: ${description} [${articuloNumero}] (Stock: ${stock})`);
    ocultarSugerenciasArticulo();

    // ubicar fila/inputs
    const row = input.closest('tr');
    const cantidadInput = row?.querySelector('input[name*="[cantidad]"]');
    const valor1Input = row?.querySelector('input[name*="[valor1]"]');
    const iva1Input = row?.querySelector('input[name*="[iva1]"]');
    const detalleId = getDetalleIdFromInput(cantidadInput || input);

    // defaults
    if (cantidadInput && (!cantidadInput.value || parseFloat(cantidadInput.value) <= 0)) setCantidad(cantidadInput, 1);
    if (iva1Input && (iva1Input.value === '' || isNaN(parseFloat(iva1Input.value)))) setNumeric(iva1Input, 21, 2, 21);
    if (valor1Input && (valor1Input.value === '' || isNaN(parseFloat(valor1Input.value)))) setNumeric(valor1Input, 0, 2, 0);

    if (detalleId != null) calcularPrecio(detalleId);

    // --- pedir precios ---
    const clienteId = parseInt(getClienteIdActivo(), 10) || 0;

    const fetchPrecios = async (params) => {
        const url = `/api/presupuestos/precios?${params.toString()}`;
        console.log('[ARTICULOS] GET precios ->', url);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    };

    (async () => {
        let valor, iva;

        // 1) por código de barras
        try {
            const p = new URLSearchParams();
            p.set('cliente_id', String(clienteId));
            if (codigoBarras) p.set('codigo_barras', codigoBarras);
            let body = await fetchPrecios(p);
            valor = Number(body?.data?.valor1);
            iva = Number(body?.data?.iva);
        } catch (e1) {
            console.warn('⚠️ [ARTICULOS] No respondió por código de barras. Probando por descripción…', e1);
        }

        // 2) fallback por descripción (si aún no tengo datos válidos)
        if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(iva)) {
            try {
                const p2 = new URLSearchParams();
                p2.set('cliente_id', String(clienteId));
                if (description) p2.set('descripcion', description);
                const body2 = await fetchPrecios(p2);
                valor = Number(body2?.data?.valor1);
                iva = Number(body2?.data?.iva);
            } catch (e2) {
                console.warn('⚠️ [ARTICULOS] Tampoco por descripción:', e2);
            }
        }

        // setear si hay datos
        if (Number.isFinite(valor) && valor1Input) setNumeric(valor1Input, valor, 2, 0);
        if (Number.isFinite(iva) && iva1Input) {
            // guardar la base real del IVA que vino del backend
            iva1Input.dataset.ivaBase = String(iva);
            // mostrar mitad si el tipo es Remito-Efectivo
            const tipoSel = document.getElementById('tipo_comprobante');
            const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
            setNumeric(iva1Input, visibleIva, 2, 21);
        }

        if (detalleId != null) calcularPrecio(detalleId);
        setTimeout(() => (valor1Input || cantidadInput)?.focus(), 50);
    })();
}

// ============================================
// LÓGICA DE MODO RETIRO (FASE 2)
// ============================================

function activarModoRetiro() {
    // 1. Cambio Visual
    const header = document.querySelector('header h1');
    if (header) header.innerHTML = '📦 Generar Orden de Retiro';
    document.title = 'Nueva Orden de Retiro';

    // Cambiar botón guardar
    const btnGuardar = document.getElementById('btn-guardar');
    if (btnGuardar) {
        btnGuardar.innerHTML = 'Confirmar Orden de Retiro';
        btnGuardar.classList.remove('btn-primary');
        btnGuardar.classList.add('btn-warning');
        btnGuardar.style.backgroundColor = '#f39c12';
        btnGuardar.style.color = '#fff';
    }

    // Ocultar opciones irrelevantes
    const headers = document.querySelectorAll('.accordion-header h3');
    headers.forEach(h3 => {
        if (h3.textContent.includes('Opciones Avanzadas')) {
            const section = h3.closest('.accordion-section');
            if (section) section.style.display = 'none';
        }
    });

    // 2. Ajustes UI específicos FASE 2.3
    // Cambiar título de sección
    const sectionTitle = document.getElementById('titulo-seccion-articulos');
    if (sectionTitle) {
        sectionTitle.textContent = '📦 Artículos de la Orden de Retiro';
    }

    // Cambiar título de tabla
    const tableHeader = document.querySelector('#tabla-detalles thead th:first-child');
    if (tableHeader) {
        tableHeader.textContent = 'Artículos de la orden de retiro';
        tableHeader.style.textTransform = 'none';
    }

    // Ocultar panel lateral de historial (ya que usaremos vinculacion inteligente)
    const historyPanel = document.getElementById('historial-entregas-section');
    if (historyPanel) {
        historyPanel.style.display = 'none';
        historyPanel.classList.add('hidden-force'); // CSS helper si necesario
    }

    // 3. Mostrar Panel de Debug (Configuración Interna)
    const debugPanel = document.getElementById('debug-panel-container');
    if (debugPanel) debugPanel.style.display = 'block';

    // 3.1 Asegurar defaults en los inputs de debug (por si acaso el HTML no cargó bien)
    const setDebugVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = val;
    };
    setDebugVal('debug_estado', 'Orden de Retiro');
    setDebugVal('debug_estado_logistico', 'PENDIENTE_ASIGNAR');
    setDebugVal('debug_secuencia', 'Pedido_Listo');
    setDebugVal('debug_informe', 'Pendiente');
    setDebugVal('debug_descuento', '0');
}

// Hook para mostrar botón de vincular al seleccionar cliente
function hookSeleccionCliente(cliente) {
    if (!MODO_RETIRO) return;

    const container = document.querySelector('.cliente-section');
    if (document.getElementById('btn-vincular-retiro')) return;

    const btnVincular = document.createElement('button');
    btnVincular.id = 'btn-vincular-retiro';
    btnVincular.type = 'button';
    btnVincular.className = 'btn';
    btnVincular.style.cssText = 'background: #fff3cd; color: #856404; border: 1px solid #ffeeba; margin-top: 10px; width: 100%; justify-content: center;';
    btnVincular.innerHTML = '🔗 Vincular con Entrega Anterior';

    btnVincular.onclick = () => abrirModalVinculacion(cliente.cliente_id);

    container.appendChild(btnVincular);
}

async function abrirModalVinculacion(clienteId) {
    const modal = document.getElementById('modal-paginator-presupuestos');
    const container = document.getElementById('lista-presupuestos-vinculables');

    if (modal) modal.style.display = 'flex';
    if (container) container.innerHTML = '<div style="text-align: center; padding: 20px;">⏳ Buscando entregas anteriores...</div>';

    try {
        const res = await fetch(`/api/presupuestos?cliente_id=${clienteId}&limit=20`);
        if (!res.ok) throw new Error('Error al buscar historial');

        const data = await res.json();
        const presupuestos = data.data || [];

        if (presupuestos.length === 0) {
            if (container) container.innerHTML = '<div style="text-align: center; padding: 20px;">No se encontraron entregas recientes.</div>';
            return;
        }

        if (container) container.innerHTML = '';
        const list = document.createElement('div');

        presupuestos.forEach(p => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 10px; 
                border-bottom: 1px solid #eee; 
                cursor: pointer; 
                display: flex; 
                justify-content: space-between;
                align-items: center;
            `;
            item.onmouseover = () => item.style.background = '#f9f9f9';
            item.onmouseout = () => item.style.background = 'transparent';

            const totalFmt = (typeof formatARS === 'function') ? formatARS(p.total || 0) : `$ ${p.total}`;

            item.innerHTML = `
                <div>
                    <strong>#${p.id}</strong> - ${new Date(p.fecha).toLocaleDateString()}
                    <br>
                    <span style="font-size: 0.85em; color: #666;">${p.estado}</span>
                </div>
                <div style="text-align: right;">
                    <strong>${totalFmt}</strong>
                    <button class="btn btn-sm btn-primary" style="margin-left: 10px; padding: 4px 8px; font-size: 0.8em;">Importar</button>
                </div>
            `;

            item.onclick = () => confirmarImportacion(p.id);
            list.appendChild(item);
        });

        if (container) container.appendChild(list);

    } catch (e) {
        console.error(e);
        if (container) container.innerHTML = `<div class="message error">Error: ${e.message}</div>`;
    }
}

async function confirmarImportacion(idPresupuesto) {
    if (!confirm('¿Importar artículos de este presupuesto? Se reemplazarán las filas actuales.')) return;

    const modal = document.getElementById('modal-paginator-presupuestos');
    if (modal) modal.style.display = 'none';

    const tbody = document.getElementById('detalles-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Importando datos...</td></tr>';

    try {
        const res = await fetch(`/api/presupuestos/${idPresupuesto}`);
        if (!res.ok) throw new Error('Error al cargar detalle');

        const data = await res.json();
        const detalles = data.detalles || [];

        if (tbody) tbody.innerHTML = '';
        detalleCounter = 0;

        detalles.forEach(d => {
            agregarDetalle();
            const id = detalleCounter;
            const row = document.getElementById(`detalle-${id}`);

            const inpArt = row.querySelector(`input[name*="[articulo]"]`);
            const inpCant = row.querySelector(`input[name*="[cantidad]"]`);
            const inpVal = row.querySelector(`input[name*="[valor1]"]`);
            const inpIva = row.querySelector(`input[name*="[iva1]"]`);

            if (inpArt) {
                // Priorizar nombre guardado, sino codigo
                inpArt.value = d.articulo_nombre || d.descripcion || d.articulo_codigo;
                inpArt.dataset.codigoBarras = d.articulo_codigo;
            }

            if (inpCant) inpCant.value = d.cantidad;
            if (inpVal) inpVal.value = 0;
            if (inpIva) inpIva.value = d.alicuota_iva || 21;

            calcularPrecio(id);
        });

        if (typeof recalcTotales === 'function') recalcTotales();
        if (typeof mostrarMensaje === 'function') mostrarMensaje('✅ Artículos importados correctamente', 'success');

    } catch (e) {
        console.error(e);
        if (typeof mostrarMensaje === 'function') mostrarMensaje('Error al importar: ' + e.message, 'error');
        agregarDetalle();
    }
}

// ============================================
// FASE 2.3: LÓGICA DE VINCULACIÓN INTELIGENTE
// ============================================

const modalOrigen = {
    el: () => document.getElementById('modal-seleccion-origen'),
    list: () => document.getElementById('lista-origenes-articulos'),
    title: () => document.getElementById('modal-origen-articulo-nombre'),

    show: () => {
        const m = modalOrigen.el();
        if (m) m.style.display = 'flex';
    },
    hide: () => {
        const m = modalOrigen.el();
        if (m) m.style.display = 'none';
    }
};

let currentSelectionContext = null; // Guardar contexto para retomar tras modal

/**
 * Verificar si el artículo tiene historial de compras para este cliente
 */
/**
 * Verificar si el artículo tiene historial de compras para este cliente
 * REFACTOR FASE 2.4: Fetch de precio actual + UI avanzada
 */
async function verificarHistorialParaRetiro(inputElement, suggestionElement, itemData) {
    const clienteId = getClienteIdActivo();
    if (!clienteId || clienteId === '0') {
        // Sin cliente, pasar directo (o advertir) -> Pasamos directo asumiendo "Sin Referencia"
        console.log('⚠️ [MODO RETIRO] Sin cliente seleccionado, saltando verificación de historial.');
        resumeSeleccionArticulo(inputElement, suggestionElement);
        return;
    }

    try {
        mostrarLoadingArticulo(inputElement); // Reutilizar spinner visual si es posible o texto

        const params = new URLSearchParams({
            cliente_id: clienteId,
            articulo_codigo: itemData.codigoBarras || '',
            descripcion: itemData.description || ''
        });

        // 1. Fetch Historial y Precio Actual en Paralelo
        const [resHistorial, resPrecios] = await Promise.all([
            fetch(`/api/presupuestos/historial-articulo?${params}`),
            fetch(`/api/presupuestos/precios?${params}`) // Reutilizamos endpoint de precios
        ]);

        if (!resHistorial.ok) throw new Error('Error API Historial');

        const jsonHistorial = await resHistorial.json();
        const historial = jsonHistorial.data || [];

        // Procesar precio actual
        let precioActual = 0;
        if (resPrecios.ok) {
            const jsonPrecios = await resPrecios.json();
            precioActual = Number(jsonPrecios.data?.valor1) || 0;
        }

        if (historial.length > 0) {
            console.log(`📦 [MODO RETIRO] Encontrados ${historial.length} antecedentes. Precio Actual: $${precioActual}`);

            // Guardar contexto
            currentSelectionContext = { inputElement, suggestionElement, itemData };

            // Mostrar Modal con Smart Pricing
            presentarOpcionesDeOrigen(historial, itemData, precioActual);
        } else {
            console.log('📦 [MODO RETIRO] Sin antecedentes. Carga directa.');
            resumeSeleccionArticulo(inputElement, suggestionElement);
        }

    } catch (error) {
        console.error('❌ Error verificando historial:', error);
        // Fallback: permitir carga manual en caso de error
        resumeSeleccionArticulo(inputElement, suggestionElement);
    }
}

/**
 * Retomar la selección normal del artículo
 */
function resumeSeleccionArticulo(input, element, precioOverride = null) {
    // Marcar como validado para saltar la intercepción esta vez
    element.dataset.origenValidado = 'true';

    // Ejecutar selección normal
    seleccionarArticulo(input, element);

    // Si hubo override de precio (desde historial), aplicarlo POST selección
    if (precioOverride !== null) {
        setTimeout(() => {
            const row = input.closest('tr');
            const valorInput = row.querySelector('input[name*="[valor1]"]');
            if (valorInput) {
                valorInput.value = precioOverride; // Precio histórico o 0
                valorInput.classList.add('precio-vinculado'); // Efecto visual opcional
                dispatchRecalc(valorInput); // Recalcular con el nuevo precio

                // Visual feedback
                valorInput.style.backgroundColor = '#d4edda'; // Verde suave
            }
        }, 100); // Pequeño delay para asegurar que el fetch de precios normal haya terminado (race condition fix simple)
    }
}

/**
 * Renderizar opciones en el modal
 */
/**
 * Renderizar opciones en el modal con Acordeones y Smart Pricing
 */
function presentarOpcionesDeOrigen(historial, itemData, precioActual) {
    const list = modalOrigen.list();
    const title = modalOrigen.title(); // Elemento del DOM, no funcion

    const titleEl = document.getElementById('modal-origen-articulo-nombre');
    if (titleEl) titleEl.textContent = itemData.description;

    if (!list) return;
    list.innerHTML = '';

    // Agrupar por Año > Mes
    const grupos = agruparHistorialPorFecha(historial);

    grupos.forEach(anioGroup => {
        // Nivel 1: Año
        const anioDiv = document.createElement('div');
        anioDiv.style.cssText = 'margin-bottom: 10px; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;';

        const anioHeader = document.createElement('div');
        anioHeader.style.cssText = 'background: #f1f3f5; padding: 10px 15px; font-weight: bold; color: #495057; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;';
        anioHeader.innerHTML = `<span>📅 ${anioGroup.anio}</span> <span style="font-size: 0.9em; font-weight: normal; background: #dee2e6; padding: 2px 8px; border-radius: 10px;">${anioGroup.totalItems} entregas</span>`;

        const anioContent = document.createElement('div');
        anioContent.style.display = 'block'; // Default expandido

        // Toggle logic
        anioHeader.onclick = () => {
            const isHidden = anioContent.style.display === 'none';
            anioContent.style.display = isHidden ? 'block' : 'none';
            anioHeader.style.background = isHidden ? '#f1f3f5' : '#e9ecef';
        };

        anioGroup.meses.forEach(mesGroup => {
            // Nivel 2: Mes
            const mesDiv = document.createElement('div');
            mesDiv.style.cssText = 'border-top: 1px solid #e0e0e0;';

            const mesHeader = document.createElement('div');
            mesHeader.style.cssText = 'padding: 8px 15px; background: #f8f9fa; color: #666; font-size: 0.9em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
            mesHeader.textContent = mesGroup.mesNombre;

            mesDiv.appendChild(mesHeader);

            // Items del mes
            mesGroup.items.forEach(h => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'origen-option-item';
                itemDiv.style.cssText = 'padding: 12px 15px; border-top: 1px solid #eee; transition: background 0.2s;';

                const fecha = new Date(h.fecha).toLocaleDateString();
                const precioHist = parseFloat(h.precio_neto_historico || 0);
                const precioAct = parseFloat(precioActual || 0);
                const tiempoRel = tiempoRelativo(h.fecha);

                // Smart Pricing Logic
                let pricingHTML = '';
                const diff = precioAct - precioHist;
                const diffPercent = precioHist > 0 ? ((diff / precioHist) * 100).toFixed(1) : 0;

                let badgeDiff = '';
                if (Math.abs(diff) < 0.01) {
                    badgeDiff = `<span style="background: #d4edda; color: #155724; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">⚖️ Mismo Precio</span>`;
                } else if (diff > 0) {
                    badgeDiff = `<span style="background: #fff3cd; color: #856404; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">Subió ${diffPercent}% (+$${diff.toFixed(2)})</span>`;
                } else {
                    badgeDiff = `<span style="background: #cce5ff; color: #004085; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">Bajó ${Math.abs(diffPercent)}% (-$${Math.abs(diff).toFixed(2)})</span>`;
                }

                itemDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            <div style="font-weight: bold; color: #2c3e50;">Presupuesto #${h.id_presupuesto} <span style="font-weight: normal; color: #888; font-size: 0.9em;">(${fecha})</span></div>
                            <div style="font-size: 0.85em; color: #28a745; margin-top: 2px;">🕒 ${tiempoRel}</div>
                        </div>
                        <div style="text-align: right;">
                             <div style="font-size: 0.9em; color: #666;">Cant: <strong>${h.cantidad}</strong></div>
                        </div>
                    </div>
                    
                    <div style="background: #fafafa; padding: 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div style="font-size: 0.9em;">
                            <div style="margin-bottom: 4px;">Histórico: <strong>$${precioHist.toFixed(2)}</strong></div>
                            <div style="color: #666;">Actual: <strong>$${precioAct.toFixed(2)}</strong></div>
                            <div style="margin-top: 4px;">${badgeDiff}</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-smart-action btn-historico" style="background: #2c3e50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">
                                ↩️ Retomar Histórico ($${precioHist.toFixed(0)})
                            </button>
                            ${Math.abs(diff) > 0.01 ? `
                            <button class="btn-smart-action btn-actual" style="background: white; color: #2c3e50; border: 1px solid #2c3e50; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">
                                🆕 Usar Actual ($${precioAct.toFixed(0)})
                            </button>` : ''}
                        </div>
                    </div>
                `;

                // Event Listeners para los botones
                const btnHist = itemDiv.querySelector('.btn-historico');
                btnHist.onclick = (e) => { e.stopPropagation(); seleccionarOrigenConfirmed(precioHist); };

                const btnAct = itemDiv.querySelector('.btn-actual');
                if (btnAct) btnAct.onclick = (e) => { e.stopPropagation(); seleccionarOrigenConfirmed(null); }; // Null = Recalcula con precio actual

                mesDiv.appendChild(itemDiv);
            });

            anioContent.appendChild(mesDiv);
        });

        anioDiv.appendChild(anioHeader);
        anioDiv.appendChild(anioContent);
        list.appendChild(anioDiv);
    });

    modalOrigen.show();
}

/**
 * Helper: Agrupar historial por Año -> Mes
 */
function agruparHistorialPorFecha(historial) {
    const grupos = {};

    historial.forEach(item => {
        const d = new Date(item.fecha);
        const anio = d.getFullYear();
        const mesIndex = d.getMonth();
        const mesNombre = d.toLocaleString('es-ES', { month: 'long' });

        if (!grupos[anio]) grupos[anio] = { anio, meses: {}, totalItems: 0 };

        if (!grupos[anio].meses[mesIndex]) {
            grupos[anio].meses[mesIndex] = { mesNombre, items: [] };
        }

        grupos[anio].meses[mesIndex].items.push(item);
        grupos[anio].totalItems++;
    });

    // Convertir a arrays ordenados
    return Object.values(grupos).sort((a, b) => b.anio - a.anio).map(g => {
        g.meses = Object.values(g.meses).sort((a, b) => {
            // Ordenar meses desc (no tengo índice aquí fácil, pero puedo usar items[0])
            // Hack simple: orden natural de inserción suele ser desc si el query es desc.
            // Pero mejor si el backend manda ordenado. Backend ordena por fecha DESC.
            // Asi que el primer mes que encuentro es el más reciente.
            return 0;
        });
        return g;
    });
}

/**
 * Helper: Tiempo Relativo
 */
function tiempoRelativo(fechaISO) {
    const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
    const d = new Date(fechaISO);
    const now = new Date();
    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Hoy';
    if (diffDays === -1) return 'Ayer';
    if (diffDays > -30) return rtf.format(diffDays, 'day');
    if (diffDays > -365) return rtf.format(Math.ceil(diffDays / 30), 'month');
    return rtf.format(Math.ceil(diffDays / 365), 'year');
}

/**
 * Callback al seleccionar una opción del modal
 */
function seleccionarOrigenConfirmed(precioHistorico) {
    modalOrigen.hide();
    if (currentSelectionContext) {
        const { inputElement, suggestionElement } = currentSelectionContext;
        resumeSeleccionArticulo(inputElement, suggestionElement, precioHistorico);
        currentSelectionContext = null;
    }
}

/**
 * Callback al cancelar o cerrar modal (Opción "Sin Referencia")
 * Expuesto globalmente para el botón del HTML
 */
window.cerrarModalOrigen = function (usarManual = false) {
    modalOrigen.hide();
    if (currentSelectionContext) {
        const { inputElement, suggestionElement } = currentSelectionContext;
        // Si cancela, carga con precio 0 o lo que la logica standard diga (flujo normal)
        // Si "Sin Referencia", forzar precio 0? O dejar que cargue precio actual?
        // Prompt dice: "Agregar el artículo directamente (Precio $0 o manual, indicando 'Sin referencia')"
        const precio = usarManual ? 0 : null; // null = usa precio lista actual
        resumeSeleccionArticulo(inputElement, suggestionElement, precio);
        currentSelectionContext = null;
    }
};
