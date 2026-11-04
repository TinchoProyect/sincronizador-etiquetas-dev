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
window.toggleSinStock = toggleSinStock;
window.toggleClearButton = toggleClearButton;
window.limpiarInputArticulo = limpiarInputArticulo;

/**
 * Establecer modo de búsqueda de artículos
 */
function setModoBusqueda(modo) {
    if (modo === modoBusqueda) return;
    modoBusqueda = modo;
    const btn = document.getElementById('btn-toggle-busqueda');
    if (btn) {
        if (modo === 'codigo') {
            btn.textContent = '📟 Modo: Código de Barras';
            btn.classList.add('modo-codigo');
        } else {
            btn.textContent = '🔍 Modo: Descripción';
            btn.classList.remove('modo-codigo');
        }
    }
    console.log(`[MODO-BUSQUEDA] Cambiado a: ${modo}`);
}

/**
 * Toggle entre modo descripción y modo código de barras
 */
function toggleModoBusqueda() {
    if (modoBusqueda === 'descripcion') {
        setModoBusqueda('codigo');
        // AUTO-FOCUS: Poner foco en el campo de código de barras
        setTimeout(() => {
            enfocarCampoCodigoBarras();
        }, 100);
    } else {
        setModoBusqueda('descripcion');
    }
}

/**
 * Verificar si un string es un código de barras (numérico de 5 a 20 dígitos)
 */
function esCodigoBarras(query) {
    if (!query) return false;
    const clean = query.trim();
    return /^\d{5,20}$/.test(clean);
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
window.MODO_RETIRO = MODO_RETIRO;

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

    // Configurar botón "Guardar en Standby"
    const btnGuardarStandby = document.getElementById('btn-guardar-standby');
    if (btnGuardarStandby) {
        btnGuardarStandby.addEventListener('click', () => {
            const estadoSelect = document.getElementById('estado');
            if (estadoSelect) {
                estadoSelect.value = 'Sin Confirmar';
            }
            const secuenciaSelect = document.getElementById('secuencia');
            if (secuenciaSelect) {
                secuenciaSelect.value = 'Standby';
            }
            if (form) {
                if (form.checkValidity && !form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                if (form.requestSubmit) {
                    form.requestSubmit();
                } else {
                    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
            }
        });
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
                    <div class="articulo-input-container" style="position: relative; display: flex; align-items: center;">
                        <input type="text" name="detalles[${detalleCounter}][articulo]"
                            placeholder="Código o descripción del artículo"
                            autocomplete="off" style="padding-right: 30px; width: 100%;"
                            oninput="toggleClearButton(this)">
                        <button type="button" class="btn-clear-articulo" 
                            onclick="limpiarInputArticulo(this)"
                            style="position: absolute; right: 5px; background: none; border: none; font-size: 18px; cursor: pointer; color: #999; display: none;"
                            title="Limpiar campo">&times;</button>
                    </div>
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][cantidad]"
                        min="0.001" step="any" placeholder="1"
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][valor1]"
                        min="0" step="0.01" placeholder="0.00"
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][descuento_adicional]"
                        min="0" max="100" step="0.01" placeholder="0.00" value="0.00"
                        title="Descuento adicional para este artículo (%)"
                        style="text-align: right;"
                        onchange="recalcTotales()">
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

                <td style="white-space: nowrap;">
                    ${MODO_RETIRO ? '' : `<button type="button" class="btn-saldo-ingrediente" style="margin-right: 5px;" onclick="window.abrirModalSaldoIngrediente(this)" title="Cargar Saldo de Ingrediente (Fracción por Kilos)">⚖️</button><button type="button" class="btn-sin-stock" style="margin-right: 5px;" onclick="toggleSinStock(this)" title="Marcar artículo como Faltante">🚫</button>`}
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

        if (typeof window.quitarSaldoIngredienteFila === 'function') {
            window.quitarSaldoIngredienteFila(row);
        }

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
 * Toggle estado Sin Stock
 */
function toggleSinStock(btn) {
    const row = btn.closest('tr');
    if (!row) return;
    row.classList.toggle('out-of-stock-row');
    btn.classList.toggle('active');
    
    if (row.classList.contains('out-of-stock-row')) {
        btn.textContent = '✅';
        // Nullify the visible subtotal display but keep data intact
        const subtotalInput = row.querySelector('.subtotal-display');
        if (subtotalInput) subtotalInput.value = '$ 0,00';
        mostrarMensaje('Artículo marcado como Sin Stock (excluido de totales)', 'success');
    } else {
        btn.textContent = '🚫';
        // Recalculate precisely
        const id = getDetalleIdFromInput(row.querySelector('input'));
        if (id != null) calcularPrecio(id);
    }
    recalcTotales();
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

    if (typeof recalcTotales === 'function') {
        recalcTotales();
    }

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
    const n = Number(val);
    const dec = (Number.isFinite(n) && Math.round(n * 100) !== Math.round(n * 1000) / 10) ? 3 : 2;
    setNumeric(el, val, dec, 1);
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

    // Determinar formato IVA según cliente
    const condicionIva = (typeof clienteSeleccionado !== 'undefined' && clienteSeleccionado && clienteSeleccionado.condicion_iva) || 'Consumidor Final';
    const formatoActual = (condicionIva === 'Responsable Inscripto') ? 'IVA_DISCRIMINADO' : 'IVA_INCLUIDO';

    // Badge UI
    const badgeElement = document.getElementById('badge-tipo-factura');
    if (badgeElement) {
        badgeElement.style.display = 'inline-block';
        badgeElement.textContent = formatoActual === 'IVA_DISCRIMINADO' ? 'Factura A (Iva Discriminado)' : 'Factura B (Iva Incluido)';
    }

    let subtotalGeneralNeto = 0;
    let montoDescEspeciales = 0;
    let iva21Total = 0;
    let iva105Total = 0;
    let gananciaTotal = 0;
    let tieneGananciaBunker = false;
    const [pct] = getDescuentoPorcentaje();

    // Calcular Subtotal Neto Inicial, Descuentos Especiales y Ganancia Real (Búnker)
    tbody.querySelectorAll('tr').forEach(row => {
        if (row.classList.contains('out-of-stock-row')) return;
        
        const cant = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
        const netoUnitario = parseFloat(row.querySelector('input[name*="[valor1]"]')?.value) || 0;
        const ivaPorcentaje = parseFloat(row.querySelector('input[name*="[iva1]"]')?.value) || 0;
        const pvuInput = parseFloat(row.querySelector('input[name*="[precio1]"]')?.value) || 0;
        const pvu = pvuInput > 0 ? pvuInput : (netoUnitario * (1 + ivaPorcentaje / 100));
        const descEsp = parseFloat(row.querySelector('input[name*="[descuento_adicional]"]')?.value) || 0;

        const subtotalLineaNeto = cant * netoUnitario;
        subtotalGeneralNeto += subtotalLineaNeto;
        if (descEsp > 0) {
            montoDescEspeciales += subtotalLineaNeto * (descEsp / 100);
        }

        // Cálculo en vivo de Ganancia Real (Rentabilidad Estimada Búnker) — idéntico a Editar Presupuesto y Artículos Búnker
        const gananciaUnitBase = parseFloat(row.dataset.gananciaBunker) || 0;
        const costoBultoUnit = parseFloat(row.dataset.costoBunker) || 0;
        const costoTiempoUnit = parseFloat(row.dataset.costoTiempoBunker) || 0;
        const costoOperativoUnit = costoBultoUnit + costoTiempoUnit;

        if (costoOperativoUnit > 0 && cant > 0) {
            const pvuConDesc = pvu * (1 - (pct + descEsp) / 100);
            const netoConDesc = pvuConDesc / (1 + (ivaPorcentaje / 100));

            const iibb = pvuConDesc * 0.04;
            const ivaVenta = netoConDesc * (ivaPorcentaje / 100);
            const ivaCompra = costoBultoUnit * 0.21;
            const diferenciaIva = Math.max(0, ivaVenta - ivaCompra);

            const gananciaUnitFila = netoConDesc - costoOperativoUnit - iibb - diferenciaIva;
            const ganFila = gananciaUnitFila * cant;

            gananciaTotal += ganFila;
            tieneGananciaBunker = true;
        } else if (gananciaUnitBase !== 0 && cant > 0) {
            const ganFila = gananciaUnitBase * cant;
            const subFilaBruto = cant * pvu;
            const descFilaBruto = subFilaBruto * ((pct + descEsp) / 100);
            const descFilaNeto = descFilaBruto / (1 + (ivaPorcentaje / 100));

            gananciaTotal += (ganFila - descFilaNeto);
            tieneGananciaBunker = true;
        }
    });

    // 🏷️ Evaluación reactiva de Política Comercial por Volumen
    if (window.EvaluadorPoliticas && typeof window.EvaluadorPoliticas.evaluarYActualizarUI === 'function') {
        window.EvaluadorPoliticas.evaluarYActualizarUI(subtotalGeneralNeto, subtotalGeneralNeto * 1.21);
    }

    // Descuentos
    const descuentoDecimal = pct / 100;
    const montoDesc = subtotalGeneralNeto * descuentoDecimal;
    const baseConDescuento = subtotalGeneralNeto - montoDesc - montoDescEspeciales;

    // Calcular IVA sobre base con descuento aditivo (general + especial de línea)
    tbody.querySelectorAll('tr').forEach(row => {
        if (row.classList.contains('out-of-stock-row')) return;

        const cant = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
        const netoUnitario = parseFloat(row.querySelector('input[name*="[valor1]"]')?.value) || 0;
        const ivaPorcentaje = parseFloat(row.querySelector('input[name*="[iva1]"]')?.value) || 0;
        const ivaDecimal = ivaPorcentaje / 100;
        const descEsp = parseFloat(row.querySelector('input[name*="[descuento_adicional]"]')?.value) || 0;

        const subtotalLineaNeto = cant * netoUnitario;
        const descTotalLineaDecimal = (pct + descEsp) / 100;
        const baseLinea = descTotalLineaDecimal > 0 ? subtotalLineaNeto * (1 - descTotalLineaDecimal) : subtotalLineaNeto;
        const ivaLinea = baseLinea * ivaDecimal;

        if (Math.abs(ivaDecimal - 0.210) < 0.001) iva21Total += ivaLinea;
        else if (Math.abs(ivaDecimal - 0.105) < 0.001) iva105Total += ivaLinea;
    });

    const totalFinal = baseConDescuento + iva21Total + iva105Total;

    // Render displays
    setTextInto(['.total-neto', '[data-total="neto"]'], formatARS(subtotalGeneralNeto));

    const labelDescuento = document.getElementById('label-descuento');
    if (labelDescuento) labelDescuento.textContent = `Descuento (${pct.toFixed(2)}%):`;
    setTextInto(['.total-descuento', '[data-total="descuento"]'], `-$${formatARS(montoDesc).replace('$', '')}`);

    const rowDescEsp = document.getElementById('row-descuentos-especiales');
    if (rowDescEsp) {
        if (montoDescEspeciales > 0) {
            rowDescEsp.style.display = 'flex';
            setTextInto(['.total-descuentos-especiales', '[data-total="descuentos-especiales"]'], `-$${formatARS(montoDescEspeciales).replace('$', '')}`);
        } else {
            rowDescEsp.style.display = 'none';
        }
    }

    setTextInto(['.total-base', '[data-total="base"]'], formatARS(baseConDescuento));

    const rowIva21 = document.getElementById('row-iva21');
    const rowIva105 = document.getElementById('row-iva105');

    if (iva21Total > 0) {
        if (rowIva21) rowIva21.style.display = 'flex';
        setTextInto(['[data-total="iva21"]'], formatARS(iva21Total));
    } else {
        if (rowIva21) rowIva21.style.display = 'none';
    }

    if (iva105Total > 0) {
        if (rowIva105) rowIva105.style.display = 'flex';
        setTextInto(['[data-total="iva105"]'], formatARS(iva105Total));
    } else {
        if (rowIva105) rowIva105.style.display = 'none';
    }

    setTextInto(['.total-final', '[data-total="final"]'], formatARS(totalFinal));

    // Actualizar indicador de Rentabilidad Estimada (Búnker) / Ganancia Real
    let divGanancia = document.getElementById('seccion-ganancia-bunker');
    if (!divGanancia) {
        const panel = document.getElementById('live-totales-body') || document.querySelector('.totales-panel') || document.querySelector('.totales-container');
        if (panel) {
            divGanancia = document.createElement('div');
            divGanancia.id = 'seccion-ganancia-bunker';
            divGanancia.style.display = 'none';
            divGanancia.style.alignItems = 'center';
            divGanancia.style.justifyContent = 'space-between';
            divGanancia.style.marginTop = '10px';
            divGanancia.style.paddingTop = '10px';
            divGanancia.style.borderTop = '1px dashed #cbd5e1';
            divGanancia.style.fontSize = '0.88em';
            divGanancia.style.color = '#64748b';
            divGanancia.style.gap = '8px';

            divGanancia.innerHTML = `
                <span>Rentabilidad Estimada (Búnker):</span>
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                    <span id="ganancia-bunker-valor" style="font-weight: bold; cursor: pointer; filter: blur(4px); transition: filter 0.2s ease-in-out; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; user-select: none;" title="Haz clic para ver/ocultar ganancia" onclick="window.conmutarReveladoGanancia(this)">$ 0,00</span>
                    <button type="button" id="btn-info-ganancia-bunker" onclick="window.abrirModalAuditoriaRentabilidadBunker()" title="Ver desglose detallado, planilla y trazabilidad de costos (PDF / Excel)" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 5px; padding: 2px 8px; font-size: 0.85em; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;">
                        ℹ️ Info
                    </button>
                </div>
            `;
            panel.appendChild(divGanancia);

            const elVal = divGanancia.querySelector('#ganancia-bunker-valor');
            if (elVal) {
                elVal.addEventListener('mouseleave', () => {
                    elVal.style.filter = 'blur(4px)';
                    elVal.style.background = '#e2e8f0';
                    elVal.style.color = '#64748b';
                    if (window.timerDifuminarGanancia) clearTimeout(window.timerDifuminarGanancia);
                });
            }
        }
    }

    const spanGananciaVal = document.getElementById('ganancia-bunker-valor');
    if (divGanancia && spanGananciaVal) {
        if (tieneGananciaBunker) {
            divGanancia.style.display = 'flex';
            spanGananciaVal.textContent = formatARS(gananciaTotal);
        } else {
            divGanancia.style.display = 'none';
        }
    }
}

// Listener de inputs de detalle + descuento
document.addEventListener('input', (e) => {
    const name = e.target?.name || '';
    if (/\[(cantidad|valor1|iva1|descuento_adicional)\]/.test(name)) {
        const id = getDetalleIdFromInput(e.target);
        if (name.includes('[descuento_adicional]')) {
            const row = e.target.closest('tr');
            const switchOferta = row?.querySelector('.btn-toggle-oferta');
            if (switchOferta) {
                const origPct = parseFloat(switchOferta.dataset.descPct) || 0;
                const currentVal = parseFloat(e.target.value) || 0;
                const iconSpan = switchOferta.querySelector('.icon-oferta');
                const estadoSpan = switchOferta.querySelector('.estado-oferta');
                if (Math.abs(currentVal - origPct) < 0.01) {
                    switchOferta.classList.add('active');
                    switchOferta.style.background = '#ecfdf5';
                    switchOferta.style.borderColor = '#10b981';
                    switchOferta.style.color = '#047857';
                    if (iconSpan) iconSpan.textContent = '🔥';
                    if (estadoSpan) {
                        estadoSpan.style.background = '#10b981';
                        estadoSpan.textContent = '✓ Aplicado';
                    }
                } else if (currentVal === 0) {
                    switchOferta.classList.remove('active');
                    switchOferta.style.background = '#f1f5f9';
                    switchOferta.style.borderColor = '#cbd5e1';
                    switchOferta.style.color = '#64748b';
                    if (iconSpan) iconSpan.textContent = '⏸️';
                    if (estadoSpan) {
                        estadoSpan.style.background = '#94a3b8';
                        estadoSpan.textContent = 'Desactivado';
                    }
                } else {
                    switchOferta.classList.remove('active');
                    switchOferta.style.background = '#fef3c7';
                    switchOferta.style.borderColor = '#f59e0b';
                    switchOferta.style.color = '#b45309';
                    if (iconSpan) iconSpan.textContent = '✏️';
                    if (estadoSpan) {
                        estadoSpan.style.background = '#f59e0b';
                        estadoSpan.textContent = `${currentVal}% Manual`;
                    }
                }
            }
        }
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
        // BUGFIX (Fallo 1): Leer forzosamente el elemento DOM para evadir desgarros de FormData con atributos `value` programáticos
        let rawDescuento = document.getElementById('descuento')?.value || formData.get('descuento');
        let descuentoPct = parseFloat(rawDescuento);
        descuentoPct = Number.isFinite(descuentoPct) ? Math.min(Math.max(descuentoPct, 0), 100) : 0;
        const descuentoValor = parseFloat((descuentoPct / 100).toFixed(4)); // ej 2.5 -> 0.0250
        const informeGeneradoValor = (document.getElementById('informe_generado')?.value || 'Pendiente').toString();

        // Secuencia (nuevo campo)
        let secuenciaValor = (formData.get('secuencia') || '').toString().trim();

        // Si el estado es "Sin Confirmar", forzar secuencia = "Standby"
        if (estadoValorRaw === 'Sin Confirmar') {
            secuenciaValor = 'Standby';
        }

        // AUTOMÁTICO: Si se usó modo código de barras, establecer secuencia = "Pedido_Listo"
        if (modoBusqueda === 'codigo') {
            secuenciaValor = 'Pedido_Listo';
            console.log('📟 [PRESUPUESTOS-CREATE] Modo código de barras detectado → secuencia automática: "Pedido_Listo"');
        }

        // LECTURA DEL MÉTODO DE RETIRO (LOGÍSTICA INVERSA)
        let overrideLogistico = null;
        let origenFacturacionValor = 'PENDIENTE'; // Default FASE 2
        let origenPuntoVentaValor = '';
        let origenNumeroFacturaValor = '';
        
        if (MODO_RETIRO) {
            const radioMostrador = document.querySelector('input[name="metodo_retiro"][value="mostrador"]');
            if (radioMostrador && radioMostrador.checked) {
                overrideLogistico = 'ESPERANDO_MOSTRADOR';
            }
            origenFacturacionValor = document.getElementById('origen_facturacion')?.value || 'PENDIENTE';
            origenPuntoVentaValor = document.getElementById('origen_punto_venta')?.value || '';
            origenNumeroFacturaValor = document.getElementById('origen_numero_factura')?.value || '';

            // Validación básica si se ingresó uno pero no el otro
            if ((origenPuntoVentaValor && !origenNumeroFacturaValor) || (!origenPuntoVentaValor && origenNumeroFacturaValor)) {
                throw new Error('Debe completar tanto el Punto de Venta como el Número de Factura para registrar el origen de la venta.');
            }
        }

        // ---- payload final ----
        const data = {
            id_cliente: idCliente,
            fecha: fechaForm,
            fecha_entrega: fechaEntregaValor,
            agente: agenteValor,
            // BLINDAJE DEBUG: Garantizar persistencia estructural del TIPO de comprobante para las solapas
            tipo_comprobante: MODO_RETIRO ? 'Orden de Retiro' : tipoComprobanteValor,

            estado: MODO_RETIRO
                ? (document.getElementById('chk_tramite_administrativo')?.checked ? 'Administrativa NC' : (document.getElementById('debug_estado')?.value || 'Orden de Retiro'))
                : estadoValorRaw,

            estado_logistico: overrideLogistico ? overrideLogistico : (MODO_RETIRO
                ? (document.getElementById('chk_tramite_administrativo')?.checked ? 'OMITIDO' : (document.getElementById('debug_estado_logistico')?.value || 'PENDIENTE_ASIGNAR'))
                : 'SIN_ESTADO'),

            informe_generado: MODO_RETIRO
                ? (document.getElementById('debug_informe')?.value || 'Pendiente')
                : informeGeneradoValor,
                
            origen_facturacion: origenFacturacionValor, // NUEVO FASE 2
            origen_punto_venta: origenPuntoVentaValor,
            origen_numero_factura: origenNumeroFacturaValor,
            usar_precios_bunker: document.getElementById('usar_precios_bunker')?.checked || false,

            nota: (formData.get('nota') || '').toString(),
            punto_entrega: puntoEntregaValor,

            // Usamos descuentoValor (0..1) que ya captura el input HTML real, incluyendo la herencia de devoluciones
            descuento: descuentoValor,

            secuencia: MODO_RETIRO
                ? (document.getElementById('debug_secuencia')?.value || 'Pedido_Listo')
                : secuenciaValor,

            detalles: [],
            detalles_sin_stock: []
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

                } else if (name.includes('[descuento_adicional]')) {
                    detalle.descuento_adicional = parseFloat(input.value) || 0;
                }
            });

            if (row.dataset.esSaldoIngrediente === 'true') {
                detalle.es_saldo_ingrediente = true;
                detalle.ingrediente_id_saldo = parseInt(row.dataset.ingredienteIdSaldo, 10) || null;
                detalle.kilos_saldo = parseFloat(row.dataset.kilosSaldo) || null;
            } else {
                detalle.es_saldo_ingrediente = false;
                detalle.ingrediente_id_saldo = null;
                detalle.kilos_saldo = null;
            }

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
                // Ruteo condicional si está Sin Stock
                if (row.classList.contains('out-of-stock-row')) {
                    const detalleSinStock = {
                        articulo: detalle.articulo,
                        descripcion: articuloInput.value || '',
                        cantidad: detalle.cantidad,
                        motivo_falta: 'Sin Stock en mostrador'
                    };
                    data.detalles_sin_stock.push(detalleSinStock);
                    console.log(`🚫 [PRESUPUESTOS-CREATE] Detalle Faltante agregado: ${detalle.articulo} (cantidad: ${detalle.cantidad})`);
                } else {
                    data.detalles.push(detalle);
                    detallesValidos++;
                    console.log(`✅ [PRESUPUESTOS-CREATE] Detalle ${index + 1} válido: ${detalle.articulo} (cantidad: ${detalle.cantidad})`);
                }
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
                // UX: Pre-seleccionar la solapa correcta basada en el modo
                if (typeof MODO_RETIRO !== 'undefined' && MODO_RETIRO) {
                    sessionStorage.setItem('active_tab_presupuestos', 'retiros');
                } else {
                    sessionStorage.setItem('active_tab_presupuestos', 'ventas');
                }
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
    if (event.key === 'Enter') {
        event.preventDefault(); // Evitar submit del formulario en todos los casos al presionar Enter en cliente
    }

    const sugerenciasContainer = document.getElementById('cliente-sugerencias');
    if (!sugerenciasContainer) return;

    const items = sugerenciasContainer.querySelectorAll('.cliente-sugerencia-item');

    if (event.key === 'Enter') {
        if (items.length > 0) {
            // Si hay un índice seleccionado (navegación con flechas), usar ese, si no el primero
            const indexToSelect = (selectedIndex >= 0 && selectedIndex < items.length) ? selectedIndex : 0;
            console.log(`🔍 [NuevoPresupuesto] Auto-seleccionando cliente de la lista (índice ${indexToSelect})`);
            seleccionarCliente(items[indexToSelect]);
        }
        return;
    }

    if (items.length === 0) return;

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
                 data-cliente-condicion-iva="${cliente.condicion_iva || ''}"
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
    const condicion_iva = element.dataset.clienteCondicionIva;

    // Guardar cliente seleccionado
    clienteSeleccionado = {
        cliente_id: parseInt(clienteId, 10),
        numero_fmt: numeroFormateado,
        nombre: nombreCompleto,
        cuit: cuit,
        condicion_iva: condicion_iva
    };

    // Limpiar caché local de artículos para garantizar precios y promociones actualizadas del cliente
    window.__articulosSearchCache = {};

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

    // Verificar si el cliente tiene listas de precios Bunker (Fase 3)
    (async () => {
        try {
            const res = await fetch(`/api/presupuestos/clientes/${clienteId}`);
            if (res.ok) {
                const body = await res.json();
                const clienteData = body?.data;
                const wrapper = document.getElementById('bunker-switch-wrapper');
                const switchInput = document.getElementById('usar_precios_bunker');
                const label = document.getElementById('bunker-switch-label');
                const badge = document.getElementById('bunker-lista-badge');

                if (wrapper) wrapper.style.display = 'inline-flex';

                if (clienteData?.tiene_listas_bunker) {
                    if (switchInput) {
                        switchInput.disabled = false;
                        switchInput.checked = true; // 🛡️ Predeterminado Activo
                    }
                    if (label) {
                        label.innerText = 'Activo';
                        label.style.color = '#166534';
                    }
                    if (badge) {
                        badge.style.display = 'inline-flex';
                        badge.textContent = `📋 Lista: ${clienteData.bunker_lista_nombre || 'Asignada'}`;
                        badge.dataset.listaNombre = clienteData.bunker_lista_nombre || 'Asignada';
                        badge.style.background = '#dcfce7';
                        badge.style.color = '#15803d';
                        badge.style.border = '1px solid #86efac';
                    }
                    if (wrapper) {
                        wrapper.style.background = '#f0fdf4';
                        wrapper.style.borderColor = '#bbf7d0';
                    }
                    // Si ya había artículos en la grilla antes de seleccionar el cliente, recalcular con precios Búnker
                    if (typeof window.conmutarModoBunker === 'function') {
                        await window.conmutarModoBunker();
                    }
                } else {
                    if (switchInput) {
                        switchInput.checked = false;
                        switchInput.disabled = true;
                    }
                    if (label) {
                        label.innerText = 'Inactivo';
                        label.style.color = '#92400e';
                    }
                    if (badge) {
                        badge.style.display = 'inline-flex';
                        badge.textContent = '⚠️ Sin lista asignada';
                        badge.dataset.listaNombre = '';
                        badge.style.background = '#fef3c7';
                        badge.style.color = '#b45309';
                        badge.style.border = '1px solid #fcd34d';
                    }
                    if (wrapper) {
                        wrapper.style.background = '#fffbeb';
                        wrapper.style.borderColor = '#fde68a';
                    }
                    // Si ya había artículos en la grilla, forzar recálculo a Legacy
                    if (typeof window.conmutarModoBunker === 'function') {
                        await window.conmutarModoBunker();
                    }
                }
            }
        } catch (err) {
            console.error('Error al verificar listas Bunker del cliente:', err);
        }

        // 🏷️ Cargar Política Comercial asignada al cliente y evaluar
        try {
            if (window.EvaluadorPoliticas && typeof window.EvaluadorPoliticas.cargarPoliticaCliente === 'function') {
                await window.EvaluadorPoliticas.cargarPoliticaCliente(clienteId);
                recalcTotales();
            }
        } catch (errPol) {
            console.warn('⚠️ No se pudo cargar política comercial del cliente:', errPol);
        }
    })();
}

// Nueva función de conmutación del Modo Bunker
// Nueva función de conmutación del Modo Bunker - Recálculo dinámico en caliente (sin vaciar grilla)
window.conmutarModoBunker = async function() {
    const switchInput = document.getElementById('usar_precios_bunker');
    const label = document.getElementById('bunker-switch-label');
    const badge = document.getElementById('bunker-lista-badge');
    const wrapper = document.getElementById('bunker-switch-wrapper');
    
    if (!switchInput) return;
    
    const usarPreciosBunker = switchInput.checked;
    
    if (label) {
        label.innerText = usarPreciosBunker ? 'Activo' : 'Inactivo';
        label.style.color = usarPreciosBunker ? '#166534' : '#475569';
    }

    if (badge && badge.dataset.listaNombre) {
        if (usarPreciosBunker) {
            badge.style.background = '#dcfce7';
            badge.style.color = '#15803d';
            badge.style.border = '1px solid #86efac';
            if (wrapper) {
                wrapper.style.background = '#f0fdf4';
                wrapper.style.borderColor = '#bbf7d0';
            }
        } else {
            badge.style.background = '#f1f5f9';
            badge.style.color = '#64748b';
            badge.style.border = '1px solid #cbd5e1';
            if (wrapper) {
                wrapper.style.background = '#f8fafc';
                wrapper.style.borderColor = '#e2e8f0';
            }
        }
    }

    const clienteIdInput = document.getElementById('id_cliente');
    const clienteId = clienteIdInput ? parseInt(clienteIdInput.value, 10) || 0 : 0;
    if (clienteId <= 0) return;

    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr[id^="detalle-"]'));
    if (rows.length === 0) return;

    console.log(`🛡️ [PRESUPUESTOS] Recalculando grilla globalmente en Modo ${usarPreciosBunker ? 'Búnker' : 'Legacy'}`);

    // Limpiar caché local de búsqueda para forzar refresco
    window.__articulosSearchCache = {};

    // Mostrar loader o aviso visual si es necesario (ej. cambiar opacidad temporalmente)
    tbody.style.opacity = '0.6';

    const promises = rows.map(async (row) => {
        if (row.classList.contains('child-row')) return; // Skip child rows (ingredients)

        const artInput = row.querySelector('input[name*="[articulo]"]');
        if (!artInput || !artInput.value.trim()) return;

        const codigoBarras = artInput.dataset.codigoBarras || artInput.dataset.articuloNumero || '';
        const description = artInput.value.trim();

        let valor = 0;
        let iva = 21;
        
        try {
            const p = new URLSearchParams({ cliente_id: String(clienteId) });
            if (codigoBarras) p.set('codigo_barras', codigoBarras);
            else if (description) p.set('descripcion', description);
            
            if (usarPreciosBunker) p.set('usar_precios_bunker', 'true');

            const url = `/api/presupuestos/precios?${p.toString()}`;
            const res = await fetch(url).then(r => r.json());
            if (res.success && res.data) {
                valor = Number(res.data.valor1) || 0;
                iva = Number(res.data.iva) || 21;
                const cBulto = res.data.costo_bulto !== undefined ? res.data.costo_bulto : (res.data.costo_operativo || 0);
                const cTiempo = res.data.costo_tiempo !== undefined ? res.data.costo_tiempo : 0;
                row.dataset.costoBunker = String(cBulto);
                row.dataset.costoTiempoBunker = String(cTiempo);
                row.dataset.gananciaBunker = String(res.data.ganancia_real || 0);
            }
        } catch (e) {
            console.error(`Error al recuperar precio para la fila:`, e);
        }

        // Recuperar la descripción amistosa asociada al modo
        let friendlyDesc = description;
        if (codigoBarras) {
            try {
                let sugUrl = `/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(codigoBarras)}&limit=1&cliente_id=${clienteId}`;
                if (usarPreciosBunker) sugUrl += '&usar_precios_bunker=true';
                
                const sugRes = await fetch(sugUrl).then(r => r.json());
                const arr = Array.isArray(sugRes) ? sugRes : (sugRes.data || sugRes.items || []);
                if (arr.length > 0) {
                    friendlyDesc = arr[0].descripcion || arr[0].nombre || description;
                }
            } catch (e) {
                console.error(`Error al recuperar descripción amistosa:`, e);
            }
        }

        const valor1Input = row.querySelector('input[name*="[valor1]"]');
        const iva1Input = row.querySelector('input[name*="[iva1]"]');
        const cantidadInput = row.querySelector('input[name*="[cantidad]"]');
        const detalleId = getDetalleIdFromInput(cantidadInput || artInput);

        artInput.value = friendlyDesc;
        
        if (valor1Input) setNumeric(valor1Input, valor, 2, 0);
        if (iva1Input) {
            iva1Input.dataset.ivaBase = String(iva);
            const tipoSel = document.getElementById('tipo_comprobante');
            const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
            setNumeric(iva1Input, visibleIva, 2, 21);
        }

        if (detalleId != null) {
            calcularPrecio(detalleId);
        }
    });

    await Promise.all(promises);
    tbody.style.opacity = '1';

    if (typeof recalcTotales === 'function') {
        recalcTotales();
    }
};

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
    const rawTokens = normalizarTexto(query).split(/\s+/).filter(Boolean);

    // Parsear tokens distinguiendo números aislados marcados con almohadilla (#)
    const terms = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const t = rawTokens[i];
        // Caso: token "#" y el anterior era un número
        if (t === '#' && terms.length > 0) {
            const prev = terms[terms.length - 1];
            if (typeof prev === 'string' && /^\d+([.,]\d+)?$/.test(prev)) {
                const num = terms.pop();
                terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
                continue;
            }
        }
        // Caso: token "#" y el siguiente es un número
        if (t === '#' && i + 1 < rawTokens.length && /^\d+([.,]\d+)?$/.test(rawTokens[i + 1])) {
            const num = rawTokens[i + 1];
            i++;
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
            continue;
        }
        // Caso: número pegado con almohadilla: "1#" o "#1"
        const m1 = t.match(/^(\d+([.,]\d+)?)#$/);
        const m2 = t.match(/^#(\d+([.,]\d+)?)$/);
        if (m1) {
            const num = m1[1];
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
        } else if (m2) {
            const num = m2[1];
            terms.push({ type: 'isolated_num', value: num, regex: new RegExp(`(?<!\\d)${num.replace('.', '\\.')}(?!\\d)`, 'i') });
        } else {
            const cleanT = t.replace(/#/g, '').trim();
            if (cleanT) terms.push(cleanT);
        }
    }

    console.log('[ARTICULOS-FILTER] Iniciando filtrado ESTRICTO...', {
        modo: typeof modoBusqueda !== 'undefined' ? modoBusqueda : 'descripcion',
        query_original: query,
        query_normalizado: normalizarTexto(query),
        tokens_generados: terms,
        items_recibidos: items.length
    });

    const out = (items || []).filter(a => {
        let cumple = false;

        if (typeof modoBusqueda !== 'undefined' && modoBusqueda === 'codigo') {
            const codigoBarras = (a.codigo_barras || '').toString().toLowerCase();
            const queryLower = query.toLowerCase();
            cumple = codigoBarras.includes(queryLower);

            if (items.indexOf(a) < 3) {
                console.log('[ARTICULOS-FILTER] [MODO-CODIGO] Evaluando artículo:', {
                    descripcion: a.description ?? a.descripcion,
                    codigo_barras: a.codigo_barras,
                    query_buscado: queryLower,
                    cumple: cumple
                });
            }
        } else {
            const tokens = [];

            // 1. Descripciones y nomenclador
            if (a.descripcion_generada) tokens.push(a.descripcion_generada);
            if (a.descripcion && a.descripcion !== a.descripcion_generada) tokens.push(a.descripcion);
            if (a.description && a.description !== a.descripcion_generada) tokens.push(a.description);
            if (a.descripcion_legacy) tokens.push(a.descripcion_legacy);

            // 2. Identificadores clave
            if (a.articulo_numero) tokens.push(a.articulo_numero);
            if (a.codigo_barras) tokens.push(a.codigo_barras);
            if (a.articulo_id) tokens.push(a.articulo_id);

            // 3. Taxonomía de familia y rubros
            const famNombre = a.familia_nombre || a.familia || a.nombre_familia || a.propiedades_dinamicas?.familia_nombre;
            if (famNombre) tokens.push(famNombre);
            if (a.rubro) tokens.push(a.rubro);
            if (a.sub_rubro) tokens.push(a.sub_rubro);

            // 4. Atributos descriptivos completos (incluyendo silenciosos y abreviaturas)
            let pd = a.propiedades_dinamicas;
            if (typeof pd === 'string') {
                try { pd = JSON.parse(pd); } catch (e) {}
            }

            if (pd && typeof pd === 'object') {
                if (pd.articulo_principal) tokens.push(pd.articulo_principal);
                if (pd.familia_nombre) tokens.push(pd.familia_nombre);

                const posObj = pd.posiciones || pd;
                if (posObj && typeof posObj === 'object') {
                    Object.keys(posObj).forEach(key => {
                        if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) return;
                        const item = posObj[key];
                        if (item && typeof item === 'object') {
                            if (item.valor) {
                                tokens.push(item.valor);
                                if (/\s+/.test(item.valor)) {
                                    tokens.push(item.valor.replace(/\s+/g, ''));
                                }
                                const words = String(item.valor).split(/\s+/);
                                words.forEach(w => {
                                    if (w.length > 4) {
                                        if (w.endsWith('o') || w.endsWith('os')) {
                                            tokens.push(w.slice(0, -1) + 'a');
                                            tokens.push(w.slice(0, -1) + 'as');
                                        } else if (w.endsWith('a') || w.endsWith('as')) {
                                            tokens.push(w.slice(0, -1) + 'o');
                                            tokens.push(w.slice(0, -1) + 'os');
                                        }
                                    }
                                });
                            }
                            if (item.abreviatura) tokens.push(item.abreviatura);
                            if (item.eje) tokens.push(item.eje);
                        } else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') {
                            tokens.push(item);
                        }
                    });
                }
            }

            const searchableText = tokens
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            cumple = terms.every(term => {
                if (typeof term === 'object' && term.type === 'isolated_num') {
                    return term.regex.test(searchableText);
                }
                return searchableText.includes(term);
            });

            if (items.indexOf(a) < 3) {
                console.log('[ARTICULOS-FILTER] [MODO-DESCRIPCION] Evaluando artículo:', {
                    descripcion_original: a.description ?? a.descripcion,
                    searchable_text: searchableText,
                    tokens_buscados: terms,
                    cumple_todos: cumple
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

    console.log('[ARTICULOS-FILTER] Filtrado ESTRICTO completado:', {
        modo: typeof modoBusqueda !== 'undefined' ? modoBusqueda : 'descripcion',
        query_original: query,
        total_resultados: out.length
    });

    // Limite visual para sugerencias
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
 * Mostrar u ocultar el botón "X" de limpieza
 */
function toggleClearButton(input) {
    const container = input.closest('.articulo-input-container');
    if (container) {
        const btn = container.querySelector('.btn-clear-articulo');
        if (btn) {
            btn.style.display = input.value.length > 0 ? 'inline-block' : 'none';
        }
    }
}

/**
 * Limpiar el input de artículo completamente
 */
function limpiarInputArticulo(btn) {
    const container = btn.closest('.articulo-input-container');
    if (!container) return;
    
    // Cancelar cualquier request en vuelo para que no reabra el menú de sugerencias
    if (window.__articulosCurrentRequest) {
        window.__articulosCurrentRequest.abort();
        window.__articulosCurrentRequest = null;
    }
    
    const input = container.querySelector('input[name*="[articulo]"]');
    if (input) {
        input.value = '';
        delete input.dataset.codigoBarras;
        delete input.dataset.articuloNumero;
        delete input.dataset.origenValidado;
        delete input.dataset.descripcionVisible;
        input.focus();
        toggleClearButton(input);
        
        if (typeof ocultarSugerenciasArticulo === 'function') {
            ocultarSugerenciasArticulo();
        }
    }
}

/**
 * Manejar input de artículo con debounce
 */
window.__articulosCurrentRequest = window.__articulosCurrentRequest || null;
window.__articulosSearchCache = window.__articulosSearchCache || {};

const handleArticuloInput = debounce(async function (event) {
    const input = event.target;
    const rawValue = input.value || '';
    
    // REQUERIMIENTO ESTRICTO #026: La búsqueda solo debe gatillarse cuando se presiona la tecla espacio.
    if (!rawValue.includes(' ') && modoBusqueda !== 'codigo') {
        if (window.__articulosCurrentRequest) {
            window.__articulosCurrentRequest.abort();
            window.__articulosCurrentRequest = null;
        }
        ocultarSugerenciasArticulo();
        return;
    }

    const query = rawValue.trim();

    console.log(`[ARTICULOS] Búsqueda de artículo: "${query}"`);

    // Cancelar request anterior si existe
    if (window.__articulosCurrentRequest) {
        window.__articulosCurrentRequest.abort();
        window.__articulosCurrentRequest = null;
    }

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
                // y luego filtrar localmente con AND estricto (limpiando # para la búsqueda base en BD)
                const primerTermino = (query.split(/\s+/)[0] || query).replace(/#/g, '').trim();
                const queryParaServidor = (primerTermino || query.replace(/#/g, '').trim()).toLowerCase();

                const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;
                const clienteId = getClienteIdActivo() || 0;
                const cacheKey = `${clienteId}_${usarPreciosBunker ? 'bkr' : 'leg'}_${queryParaServidor}`;

                if (window.__articulosSearchCache[cacheKey]) {
                    console.log(`[ARTICULOS] Caché local encontrada para "${cacheKey}". Filtrando sin fetch.`);
                    items = filtrarArticulosLocal(query, window.__articulosSearchCache[cacheKey]);
                } else {
                    console.log(`[ARTICULOS] Fetch para servidor: "${queryParaServidor}" (cliente: ${clienteId}, bkr: ${usarPreciosBunker})`);

                    const controller = new AbortController();
                    window.__articulosCurrentRequest = controller;

                    let url = `/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(queryParaServidor)}&limit=500&cliente_id=${clienteId}`;
                    if (usarPreciosBunker) url += '&usar_precios_bunker=true';
                    
                    const response = await fetch(url, {
                        signal: controller.signal
                    });
                    
                    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
                    const body = await response.json();
                    const arr = Array.isArray(body) ? body : (body.data || body.items || []);

                    window.__articulosSearchCache[cacheKey] = arr;

                    // Aplicar filtro local con TODOS los términos del query original
                    items = filtrarArticulosLocal(query, arr);
                }
            }
        }

        console.log(`[ARTICULOS] Sugerencias preparadas: ${items.length} artículos`);
        mostrarSugerenciasArticulo(input, items);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('🔄 [ARTICULOS] Request cancelado para evitar superposición');
            return;
        }
        console.error('Error al buscar artículos:', error);
        mostrarErrorArticulo(input, 'Error al buscar artículos');
    } finally {
        if (window.__articulosCurrentRequest && !window.__articulosCurrentRequest.signal.aborted) {
             window.__articulosCurrentRequest = null;
        }
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
    if (event.key === 'Enter') {
        event.preventDefault(); // Evitar submit del formulario en todos los casos al presionar Enter en artículos
        
        const input = event.target;
        const query = (input.value || '').trim();
        
        if (query.length > 0) {
            // Caso auto-switch o modo código activo
            if (modoBusqueda === 'codigo' || esCodigoBarras(query)) {
                if (modoBusqueda !== 'codigo') {
                    console.log('[AUTO-SWITCH] Detectado código de barras en modo descripción. Cambiando a modo código de barras.');
                    setModoBusqueda('codigo');
                }
                console.log('[MODO-CODIGO] Enter detectado, procesando código:', query);
                handleCodigoBarrasEnter(input, query);
                return;
            }
        }

        // Caso modo descripción normal con sugerencias
        if (modoBusqueda === 'descripcion') {
            const sugerenciasContainer = document.querySelector('.articulo-sugerencias');
            if (sugerenciasContainer && sugerenciasContainer.style.display !== 'none') {
                const items = sugerenciasContainer.querySelectorAll('.articulo-sugerencia-item');
                let selectedIndex = parseInt(sugerenciasContainer.dataset.selectedIndex || '-1', 10);
                if (selectedIndex >= 0 && items[selectedIndex]) {
                    seleccionarArticulo(input, items[selectedIndex]);
                }
            }
        }
        return;
    }

    // Navegación con flechas / Escape para modo descripción
    if (modoBusqueda === 'descripcion') {
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

            case 'Escape':
                event.preventDefault();
                ocultarSugerenciasArticulo();
                break;
        }
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

            // Limpiar campo donde se escaneó y mantener foco
            input.value = '';
            input.focus();
        } else {
            // Artículo nuevo: agregar fila con cantidad 1
            console.log('[MODO-CODIGO] Artículo nuevo, agregando al detalle');
            await agregarArticuloAlDetalle(articulo, input);

            // Agregar una nueva fila vacía al final para el siguiente escaneo
            agregarDetalle();

            // Poner el foco en el nuevo input creado
            const tbody = document.getElementById('detalles-tbody');
            if (tbody) {
                const rows = tbody.querySelectorAll('tr');
                if (rows.length > 0) {
                    const lastRow = rows[rows.length - 1];
                    const lastInput = lastRow.querySelector('input[name*="[articulo]"]');
                    if (lastInput) {
                        lastInput.value = '';
                        lastInput.focus();
                    }
                }
            }
        }

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
        const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;
        const clienteId = getClienteIdActivo() || 0;
        let url = `/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(codigoBarras)}&limit=100&cliente_id=${clienteId}`;
        if (usarPreciosBunker) url += '&usar_precios_bunker=true';
        
        const response = await fetch(url);

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

    // Buscar la fila del input original si fue provisto
    const filaActual = inputOriginal ? inputOriginal.closest('tr') : null;
    const articuloInputActual = filaActual?.querySelector('input[name*="[articulo]"]');

    // Modificamos la condición para considerar la fila como "vacía/usable" si:
    // 1. El input del artículo no tiene valor, O
    // 2. No tiene un código de barras real en dataset (está vacío de datos reales) AND estamos en modo código (el valor del input es solo el barcode escaneado temporal)
    const tieneArticuloReal = articuloInputActual && (
        (articuloInputActual.dataset.codigoBarras && articuloInputActual.dataset.codigoBarras.trim() !== '') ||
        (articuloInputActual.value && articuloInputActual.value.trim() !== '' && modoBusqueda !== 'codigo')
    );
    const usarFilaActual = articuloInputActual && !tieneArticuloReal;

    let targetRow;
    let targetInput;

    if (usarFilaActual) {
        console.log('[MODO-CODIGO] Usando fila actual (vacía)');
        targetRow = filaActual;
        targetInput = articuloInputActual;
    } else {
        // Verificar si existe alguna fila vacía en la tabla
        const tbody = document.getElementById('detalles-tbody');
        const rows = tbody ? tbody.querySelectorAll('tr') : [];
        let filaVaciaExistente = null;
        for (const r of rows) {
            const inp = r.querySelector('input[name*="[articulo]"]');
            if (inp && !inp.value && (!inp.dataset.codigoBarras || inp.dataset.codigoBarras.trim() === '')) {
                filaVaciaExistente = r;
                break;
            }
        }

        if (filaVaciaExistente) {
            console.log('[MODO-CODIGO] Usando fila vacía existente');
            targetRow = filaVaciaExistente;
            targetInput = targetRow.querySelector('input[name*="[articulo]"]');
        } else {
            console.log('[MODO-CODIGO] Creando nueva fila');
            agregarDetalle();

            // Obtener la última fila agregada
            const tbodyActual = document.getElementById('detalles-tbody');
            const rowsActual = tbodyActual.querySelectorAll('tr');
            targetRow = rowsActual[rowsActual.length - 1];
            targetInput = targetRow.querySelector('input[name*="[articulo]"]');
        }
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

            if (body?.data && targetRow) {
                const cBulto = body.data.costo_bulto !== undefined ? body.data.costo_bulto : (body.data.costo_operativo || 0);
                const cTiempo = body.data.costo_tiempo !== undefined ? body.data.costo_tiempo : 0;
                targetRow.dataset.costoBunker = String(cBulto);
                targetRow.dataset.costoTiempoBunker = String(cTiempo);
                targetRow.dataset.gananciaBunker = String(body.data.ganancia_real || 0);
            }

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

    // -------------------------------------------------------------
    // LÓGICA DE SSOT: VERIFICAR SI EL ARTÍCULO TIENE KIT NATIVO (UP)
    // -------------------------------------------------------------
    const articuloBaseParaKit = articuloNumero || targetInput.dataset.articuloNumero || codigoBarras || description;
    console.log('[KIT-FRONT-DEBUG] Evaluando Kit para (Modo Código):', {articuloNumero, codigoBarras, description, seleccionado: articuloBaseParaKit});
    if (articuloBaseParaKit) {
        try {
            const kitRes = await fetch(`/api/produccion/recetas/hibridas/nativa/${encodeURIComponent(articuloBaseParaKit)}`);
            if (kitRes.ok) {
                const kitData = await kitRes.json();
                if (kitData.enlazado && kitData.ingredientes && kitData.ingredientes.length > 0) {
                    console.log('[KIT] Artículo base tiene UP enlazada. Agregando botón de Kit (Modo Código).');
                    const tdArticulo = targetInput.closest('td');
                    if (tdArticulo) {
                        const btnPrev = tdArticulo.querySelector('.btn-kit-toggle');
                        if (btnPrev) btnPrev.remove();

                        const btnKit = document.createElement('button');
                        btnKit.type = 'button';
                        btnKit.className = 'btn-kit-toggle';
                        btnKit.dataset.recetaId = kitData.receta_id;
                        btnKit.dataset.ingredientes = JSON.stringify(kitData.ingredientes);
                        btnKit.dataset.multiplicadorBase = kitData.multiplicador_base || 1;
                        btnKit.dataset.isAdded = "false";
                        btnKit.innerHTML = '📦 Añadir Kit Insumos';

                        btnKit.onclick = function() {
                            if (this.dataset.isAdded === "true") return;
                            this.dataset.isAdded = "true";
                            this.style.display = 'none';
                            
                            if (!targetRow.id) targetRow.id = 'row_' + Math.random().toString(36).substr(2, 9);
                            const parentRowId = targetRow.id;
                            
                            const baseQtyInput = targetRow.querySelector('input[name*="[cantidad]"]');
                            const baseQty = baseQtyInput ? (parseFloat(String(baseQtyInput.value).replace(',','.')) || 1) : 1;
                            
                            if (typeof window.inyectarFilasHijasKit === 'function') {
                                window.inyectarFilasHijasKit(targetRow, kitData.ingredientes, parentRowId, baseQty);
                            } else {
                                console.error('[KIT] Error: window.inyectarFilasHijasKit no está definido');
                            }
                        };
                        tdArticulo.appendChild(btnKit);
                    }
                }
            }
        } catch(e) {
            console.error('[KIT] Error al buscar UP del artículo base', e);
        }
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

        const sf = Math.floor(parseFloat(articulo.stock_fisico || 0));
        const sr = Math.floor(parseFloat(articulo.stock_reservado || 0));
        const sd = Math.floor(parseFloat(articulo.stock_disponible !== undefined ? articulo.stock_disponible : (articulo.stock_consolidado || 0)));

        let stockClass = 'con-stock';
        if (sd <= 0) stockClass = 'sin-stock';
        const stockLabel = sr > 0 ? `Disp: ${sd} (Fís: ${sf}, Res: ${sr})` : `Stock: ${sd}`;

        const safeLabel = label.replace(/"/g, '&quot;');

        let etiquetas = '';
        if (articulo.etiquetas && Array.isArray(articulo.etiquetas) && articulo.etiquetas.length > 0) {
            etiquetas = `<span class="articulo-etiquetas">${articulo.etiquetas.join(' ')}</span>`;
        }

        // Renderizado especial de Oferta Activa si aplica a este cliente
        let badgePromo = '';
        let infoPrecioPromo = '';
        let dataOfertaAttr = '';

        if (articulo.oferta_activa) {
            const ofr = articulo.oferta_activa;
            const descPct = parseFloat(ofr.descuento_porcentaje) || 0;
            const textoBadge = descPct > 0 ? `${descPct}% OFF` : (ofr.precio_fijo_oferta ? `$${ofr.precio_fijo_oferta}` : 'OFERTA');
            badgePromo = `<span class="badge-promo-sugerencia" style="background: linear-gradient(135deg, #f59e0b, #ef4444); color: white; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 0.72rem; margin-left: 6px; box-shadow: 0 1px 3px rgba(239,68,68,0.3); display: inline-flex; align-items: center; gap: 3px;">🔥 PROMO ${textoBadge}</span>`;
            
            if (ofr.precio_oferta_neto != null && articulo.precio_venta != null) {
                infoPrecioPromo = `<span style="margin-left: 8px; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 4px;">
                    <span style="text-decoration: line-through; color: #94a3b8; font-size: 0.78rem;">$${parseFloat(articulo.precio_venta).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    <strong style="color: #10b981; font-weight: 700;">$${parseFloat(ofr.precio_oferta_neto).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
                </span>`;
            }
            dataOfertaAttr = `data-oferta-activa="${encodeURIComponent(JSON.stringify(ofr))}"`;
        }

        return `
      <div class="articulo-sugerencia-item"
           data-codigo-barras="${articulo.codigo_barras || ''}"
           data-articulo-numero="${articulo.articulo_numero || ''}"
           data-description="${safeLabel}"
           data-stock="${sd}"
           data-stock-fisico="${sf}"
           data-stock-reservado="${sr}"
           data-precio-venta="${articulo.precio_venta != null ? articulo.precio_venta : ''}"
           data-precio-final="${articulo.precio_final != null ? articulo.precio_final : ''}"
           data-iva="${articulo.iva != null ? articulo.iva : ''}"
           ${dataOfertaAttr}
           onclick="seleccionarArticuloPorClick(this, event)">
        <div class="articulo-description">${label} ${badgePromo}</div>
        <div class="articulo-details">
          <span class="articulo-numero">[${articulo.articulo_numero || ''}]</span>
          <span class="articulo-stock ${stockClass}" title="Físico: ${sf} | Reservado en pedidos: ${sr} | Disponible: ${sd}">${stockLabel}</span>
          ${infoPrecioPromo}
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
 * VERSIÓN MEJORADA: Buscador en tiempo real (Política LAMDA), colapsado por mes,
 * precio actual, fecha y agregado rápido con botón ➕
 */
function renderizarHistorialEntregas(data) {
    const content = document.getElementById('historial-entregas-content');
    const btnPDF = document.getElementById('btn-imprimir-lista-precios');

    if (!content) return;

    // Guardar referencia en memoria
    window._historialEntregasData = data;

    // Botón SIEMPRE visible cuando hay cliente seleccionado
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

    const totalProductos = data.total_productos_unicos || 
        (data.grupos ? data.grupos.reduce((acc, g) => acc + (g.productos?.length || 0), 0) : 0);

    // Encabezado con Toolbar de búsqueda interactiva
    let html = `
        <div class="historial-toolbar">
            <div class="historial-filtro-wrapper">
                <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 14px; color: #64748b; pointer-events: none;">🔍</span>
                <input type="text" id="filtro-historial-input" class="historial-filtro-input"
                    placeholder="Filtrar productos del historial (ej: ciruela, almendra, 5kg)..." 
                    autocomplete="off"
                    oninput="window.filtrarHistorialProductos(this.value)">
                <button type="button" id="btn-limpiar-filtro-historial" class="btn-limpiar-filtro-historial"
                    onclick="window.limpiarFiltroHistorial()"
                    style="display: none;" title="Limpiar búsqueda">✕</button>
            </div>
            <div id="historial-resumen-filtrado" style="font-size: 12px; color: #475569; font-weight: 500;">
                ${totalProductos} productos en ${data.grupos.length} períodos
            </div>
        </div>

        <!-- Aviso si la búsqueda no arroja coincidencias -->
        <div id="historial-no-matches" class="historial-no-matches" style="display: none;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #b45309; font-size: 14px;">
                🔍 No se encontraron entregas de "<span id="historial-termino-buscado"></span>" para este cliente
            </p>
            <p style="margin: 0; font-size: 12px; color: #92400e;">
                Este cliente nunca recibió este producto en sus entregas anteriores registradas. Podés buscarlo y agregarlo desde la sección <strong>Artículos del Presupuesto</strong> más abajo.
            </p>
        </div>

        <div id="historial-grupos-container">
    `;

    // Construir HTML para cada grupo de mes
    data.grupos.forEach((grupo, idx) => {
        html += `
            <div class="historial-grupo" data-grupo-index="${idx}">
                <div class="historial-grupo-header" onclick="window.toggleHistorialGrupo(this)" title="Clic para plegar/desplegar este período">
                    <div style="display: flex; align-items: center;">
                        <span class="historial-grupo-toggle-icon">▼</span>
                        <span>${grupo.label}</span>
                    </div>
                    <span class="historial-grupo-badge" data-total="${grupo.productos.length}">${grupo.productos.length}</span>
                </div>
                <ul class="historial-productos-list">
        `;

        grupo.productos.forEach(producto => {
            const fechaFormateada = formatearFechaHistorial(producto.fecha_entrega);
            const precioActual = producto.precio_actual || 0;

            // Bolsa de texto para búsqueda LAMDA (RULE 3)
            const searchableTokens = [
                producto.descripcion || '',
                producto.codigo_barras || '',
                producto.articulo_numero || '',
                producto.rubro || '',
                producto.sub_rubro || ''
            ];
            if (typeof window.obtenerTextoBusquedaArticulo === 'function') {
                searchableTokens.push(window.obtenerTextoBusquedaArticulo(producto));
            }
            const searchText = searchableTokens.join(' ').toLowerCase();

            const safeDesc = (producto.descripcion || '').replace(/"/g, '&quot;');
            const safeCodigo = (producto.codigo_barras || '').replace(/"/g, '&quot;');
            const safeNumero = (producto.articulo_numero || '').replace(/"/g, '&quot;');

            html += `
                <li class="historial-producto-item" data-search="${searchText.replace(/"/g, '&quot;')}">
                    <div class="historial-producto-info">
                        <div class="historial-producto-descripcion" title="${safeDesc}">${producto.descripcion}</div>
                        ${producto.codigo_barras ? `<span style="font-size: 0.75em; color: #94a3b8; font-family: monospace;">Cod: ${producto.codigo_barras}</span>` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                        <span class="historial-producto-cantidad" title="Última cantidad entregada">×${producto.cantidad}</span>
                        <span class="historial-producto-precio" style="font-weight: 600; color: #10b981; min-width: 80px; text-align: right;" title="Precio actual de lista">
                            $${precioActual.toFixed(2)}
                        </span>
                        <span class="historial-producto-fecha" title="Fecha de última entrega">${fechaFormateada}</span>
                        <button type="button" class="btn-agregar-desde-historial"
                            data-codigo="${safeCodigo}"
                            data-numero="${safeNumero}"
                            data-descripcion="${safeDesc}"
                            data-cantidad="${producto.cantidad || 1}"
                            onclick="window.agregarArticuloHistorialClick(this)"
                            title="Agregar este producto al presupuesto actual">
                            ➕ Agregar
                        </button>
                    </div>
                </li>
            `;
        });

        html += `
                </ul>
            </div>
        `;
    });

    html += `</div>`;
    content.innerHTML = html;

    console.log(`✅ [HISTORIAL] Historial renderizado: ${totalProductos} productos en ${data.grupos.length} grupos`);
}

/**
 * Filtrar productos del historial en tiempo real según la Política Universal LAMDA
 */
function filtrarHistorialProductos(query) {
    const cleanQuery = (query || '').trim().toLowerCase();
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    const container = document.getElementById('historial-grupos-container');
    const noMatchesBox = document.getElementById('historial-no-matches');
    const terminoSpan = document.getElementById('historial-termino-buscado');
    const btnLimpiar = document.getElementById('btn-limpiar-filtro-historial');
    const resumenDiv = document.getElementById('historial-resumen-filtrado');

    if (btnLimpiar) {
        btnLimpiar.style.display = tokens.length > 0 ? 'inline-block' : 'none';
    }

    const grupos = container ? container.querySelectorAll('.historial-grupo') : [];
    let totalItemsEncontrados = 0;
    let totalItemsGeneral = 0;

    grupos.forEach(grupo => {
        const items = grupo.querySelectorAll('.historial-producto-item');
        const badge = grupo.querySelector('.historial-grupo-badge');
        const totalOriginal = parseInt(badge?.dataset.total || items.length, 10);
        let itemsVisiblesEnGrupo = 0;

        items.forEach(item => {
            totalItemsGeneral++;
            const itemSearchText = item.dataset.search || '';
            const coincide = tokens.length === 0 || tokens.every(token => itemSearchText.includes(token));

            if (coincide) {
                item.style.display = '';
                itemsVisiblesEnGrupo++;
                totalItemsEncontrados++;
            } else {
                item.style.display = 'none';
            }
        });

        if (itemsVisiblesEnGrupo > 0) {
            grupo.style.display = '';
            if (badge) {
                badge.textContent = tokens.length > 0 ? `${itemsVisiblesEnGrupo} / ${totalOriginal}` : `${totalOriginal}`;
            }
        } else {
            grupo.style.display = 'none';
        }
    });

    if (tokens.length > 0) {
        if (totalItemsEncontrados === 0) {
            if (noMatchesBox) {
                noMatchesBox.style.display = 'block';
                if (terminoSpan) terminoSpan.textContent = query;
            }
            if (container) container.style.display = 'none';
        } else {
            if (noMatchesBox) noMatchesBox.style.display = 'none';
            if (container) container.style.display = '';
        }
        if (resumenDiv) {
            resumenDiv.textContent = `${totalItemsEncontrados} producto(s) encontrado(s) para "${query}"`;
        }
    } else {
        if (noMatchesBox) noMatchesBox.style.display = 'none';
        if (container) container.style.display = '';
        if (resumenDiv) {
            const totalGrupos = window._historialEntregasData?.grupos?.length || grupos.length;
            resumenDiv.textContent = `${totalItemsGeneral} productos en ${totalGrupos} períodos`;
        }
    }
}
window.filtrarHistorialProductos = filtrarHistorialProductos;

/**
 * Limpiar filtro de búsqueda del historial
 */
function limpiarFiltroHistorial() {
    const input = document.getElementById('filtro-historial-input');
    if (input) {
        input.value = '';
        input.focus();
    }
    filtrarHistorialProductos('');
}
window.limpiarFiltroHistorial = limpiarFiltroHistorial;

/**
 * Plegar / desplegar un grupo mensual en el historial
 */
function toggleHistorialGrupo(header) {
    const list = header.nextElementSibling;
    const icon = header.querySelector('.historial-grupo-toggle-icon');
    if (!list) return;

    if (list.style.display === 'none') {
        list.style.display = '';
        if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
        list.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(-90deg)';
    }
}
window.toggleHistorialGrupo = toggleHistorialGrupo;

/**
 * Agregar artículo al presupuesto actual directamente desde el botón del historial
 */
async function agregarArticuloHistorialClick(btn) {
    const codigoBarras = btn.dataset.codigo || '';
    const articuloNumero = btn.dataset.numero || '';
    const descripcion = btn.dataset.descripcion || '';
    const cantidad = parseFloat(btn.dataset.cantidad) || 1;

    console.log('➕ [HISTORIAL] Agregando artículo desde historial:', {
        codigoBarras,
        articuloNumero,
        descripcion,
        cantidad
    });

    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ Agregado';
    btn.style.backgroundColor = '#047857';
    btn.disabled = true;

    try {
        await agregarArticuloAlDetalle({
            codigo_barras: codigoBarras,
            articulo_numero: articuloNumero,
            descripcion: descripcion,
            description: descripcion
        });

        if (typeof mostrarMensaje === 'function') {
            mostrarMensaje(`✅ "${descripcion}" agregado al presupuesto`, 'success');
        }
    } catch (err) {
        console.error('❌ Error al agregar desde historial:', err);
        if (typeof mostrarMensaje === 'function') {
            mostrarMensaje(`❌ Error al agregar artículo: ${err.message}`, 'error');
        }
    } finally {
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.backgroundColor = '';
            btn.disabled = false;
        }, 1200);
    }
}
window.agregarArticuloHistorialClick = agregarArticuloHistorialClick;

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

    // Asignación instantánea si el artículo ya trajo precio en la lista de sugerencias (0ms latencia)
    const sugPrecioVenta = parseFloat(element.dataset.precioVenta);
    const sugIva = parseFloat(element.dataset.iva);
    const tipoSel = document.getElementById('tipo_comprobante');

    if (Number.isFinite(sugPrecioVenta) && sugPrecioVenta > 0) {
        if (valor1Input) setNumeric(valor1Input, sugPrecioVenta, 2, 0);
    } else if (valor1Input && (valor1Input.value === '' || isNaN(parseFloat(valor1Input.value)))) {
        setNumeric(valor1Input, 0, 2, 0);
    }

    if (Number.isFinite(sugIva) && iva1Input) {
        iva1Input.dataset.ivaBase = String(sugIva);
        const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (sugIva / 2) : sugIva;
        setNumeric(iva1Input, visibleIva, 2, 21);
    } else if (iva1Input && (iva1Input.value === '' || isNaN(parseFloat(iva1Input.value)))) {
        setNumeric(iva1Input, 21, 2, 21);
    }

    // Detección y aplicación automática de Oferta Activa por defecto (Fase Ofertas Dinámicas)
    const ofertaDataRaw = element.dataset.ofertaActiva;
    let ofertaActiva = null;
    if (ofertaDataRaw) {
        try {
            ofertaActiva = JSON.parse(decodeURIComponent(ofertaDataRaw));
        } catch (e) {
            console.warn('⚠️ [OFERTAS] Error parseando ofertaActiva:', e);
        }
    }

    const descInput = row?.querySelector('input[name*="[descuento_adicional]"]');
    if (ofertaActiva && descInput) {
        let descPct = parseFloat(ofertaActiva.descuento_porcentaje) || 0;
        if (descPct === 0 && ofertaActiva.precio_fijo_oferta && sugPrecioVenta > 0) {
            const netoOferta = parseFloat(ofertaActiva.precio_oferta_neto) || 0;
            descPct = Math.max(0, ((sugPrecioVenta - netoOferta) / sugPrecioVenta) * 100);
        }

        // Aplicar el beneficio por default en Desc. Esp. %
        setNumeric(descInput, descPct, 2, 0);

        // Renderizar / actualizar el switch/badge interactivo en la fila
        renderOfertaBadgeFila(row, detalleId, ofertaActiva, descPct);
    } else {
        // Si no tiene oferta activa, remover cualquier badge residual
        row?.querySelector('.switch-oferta-container')?.remove();
    }

    if (detalleId != null) calcularPrecio(detalleId);
    recalcTotales();

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

        const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;

        // 1) por artículo número o código de barras
        try {
            const p = new URLSearchParams();
            p.set('cliente_id', String(clienteId));
            if (articuloNumero) p.set('articulo_numero', articuloNumero);
            if (codigoBarras) p.set('codigo_barras', codigoBarras);
            if (description) p.set('descripcion', description);
            if (usarPreciosBunker) p.set('usar_precios_bunker', 'true');
            let body = await fetchPrecios(p);
            valor = Number(body?.data?.valor1);
            iva = Number(body?.data?.iva);
            if (body?.data && row) {
                const cBulto = body.data.costo_bulto !== undefined ? body.data.costo_bulto : (body.data.costo_operativo || 0);
                const cTiempo = body.data.costo_tiempo !== undefined ? body.data.costo_tiempo : 0;
                row.dataset.costoBunker = String(cBulto);
                row.dataset.costoTiempoBunker = String(cTiempo);
                row.dataset.gananciaBunker = String(body.data.ganancia_real || 0);
            }
        } catch (e1) {
            console.warn('⚠️ [ARTICULOS] No respondió por código. Probando por descripción…', e1);
        }

        // 2) fallback por descripción (si aún no tengo datos válidos)
        if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(iva)) {
            try {
                const p2 = new URLSearchParams();
                p2.set('cliente_id', String(clienteId));
                if (articuloNumero) p2.set('articulo_numero', articuloNumero);
                if (description) p2.set('descripcion', description);
                if (usarPreciosBunker) p2.set('usar_precios_bunker', 'true');
                const body2 = await fetchPrecios(p2);
                valor = Number(body2?.data?.valor1);
                iva = Number(body2?.data?.iva);
                if (body2?.data && row) {
                    const cBulto = body2.data.costo_bulto !== undefined ? body2.data.costo_bulto : (body2.data.costo_operativo || 0);
                    const cTiempo = body2.data.costo_tiempo !== undefined ? body2.data.costo_tiempo : 0;
                    row.dataset.costoBunker = String(cBulto);
                    row.dataset.costoTiempoBunker = String(cTiempo);
                    row.dataset.gananciaBunker = String(body2.data.ganancia_real || 0);
                }
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
        
        // -------------------------------------------------------------
        // LÓGICA DE SSOT: VERIFICAR SI EL ARTÍCULO TIENE KIT NATIVO (UP)
        // -------------------------------------------------------------
        const articuloBaseParaKit = articuloNumero || input.dataset.articuloNumero || codigoBarras || description || element.dataset.id;
        console.log('[KIT-FRONT-DEBUG] Evaluando Kit para:', {articuloNumero, dataArticuloNumero: input.dataset.articuloNumero, codigoBarras, description, seleccionado: articuloBaseParaKit});
        if (articuloBaseParaKit) {
            try {
                const kitRes = await fetch(`/api/produccion/recetas/hibridas/nativa/${encodeURIComponent(articuloBaseParaKit)}`);
                if (kitRes.ok) {
                    const kitData = await kitRes.json();
                    if (kitData.enlazado && kitData.ingredientes && kitData.ingredientes.length > 0) {
                        console.log('[KIT] Artículo base tiene UP enlazada. Agregando botón de Kit.');
                        const tdArticulo = input.closest('td');
                        if (tdArticulo) {
                            const btnPrev = tdArticulo.querySelector('.btn-kit-toggle');
                            if (btnPrev) btnPrev.remove();

                            const btnKit = document.createElement('button');
                            btnKit.type = 'button';
                            btnKit.className = 'btn-kit-toggle';
                            btnKit.dataset.recetaId = kitData.receta_id;
                            btnKit.dataset.ingredientes = JSON.stringify(kitData.ingredientes);
                            btnKit.dataset.multiplicadorBase = kitData.multiplicador_base || 1;
                            btnKit.dataset.isAdded = "false";
                            btnKit.innerHTML = '📦 Añadir Kit Insumos';
                            

                            // Vinculamos la cantidad base
                            btnKit.onclick = function() {
                                if (this.dataset.isAdded === "true") return; // Ya agregado
                                this.dataset.isAdded = "true";
                                this.style.display = 'none'; // Ocultar botón tras agregar
                                
                                // Determinar ID de fila padre
                                const targetRow = input.closest('tr');
                                if (!targetRow.id) targetRow.id = 'row_' + Math.random().toString(36).substr(2, 9);
                                const parentRowId = targetRow.id;
                                
                                const baseQtyInput = targetRow.querySelector('input[name*="[cantidad]"]');
                                const baseQty = baseQtyInput ? (parseFloat(String(baseQtyInput.value).replace(',','.')) || 1) : 1;
                                
                                if (typeof window.inyectarFilasHijasKit === 'function') {
                                    window.inyectarFilasHijasKit(targetRow, kitData.ingredientes, parentRowId, baseQty);
                                } else {
                                    console.error('[KIT] Error: window.inyectarFilasHijasKit no está definido');
                                }
                            };

                            tdArticulo.appendChild(btnKit);
                        }
                    }
                }
            } catch(e) {
                console.error('[KIT] Error al buscar UP del artículo base', e);
            }
        }
        // Foco preservado: no forzar focus a valor1Input para respetar la interacción del operador
    })();
}

/**
 * Renderiza o actualiza el switch interactivo de Oferta Activa en la fila del presupuesto
 */
function renderOfertaBadgeFila(row, detalleId, ofertaActiva, descPct) {
    if (!row) return;
    const tdArticulo = row.querySelector('td');
    if (!tdArticulo) return;

    let container = tdArticulo.querySelector('.switch-oferta-container');
    if (container) container.remove();

    container = document.createElement('div');
    container.className = 'switch-oferta-container';
    container.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap;';

    const descFormat = descPct.toFixed(2).replace(/\.00$/, '');
    const tituloOferta = ofertaActiva.titulo || 'Promo Activa';

    container.innerHTML = `
        <button type="button" class="btn-toggle-oferta active" 
                data-desc-pct="${descPct}"
                data-detalle-id="${detalleId}"
                title="Haga clic para activar o pausar el descuento de la promoción en esta línea"
                style="background: #ecfdf5; border: 1px solid #10b981; color: #047857; padding: 2px 8px; border-radius: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-weight: 600; font-size: 0.74rem; transition: all 0.2s; box-shadow: 0 1px 2px rgba(16,185,129,0.15);">
            <span class="icon-oferta">🔥</span>
            <span class="texto-oferta">${tituloOferta}: <strong>${descFormat}% OFF</strong></span>
            <span class="estado-oferta" style="background: #10b981; color: white; border-radius: 8px; padding: 1px 5px; font-size: 0.68rem; font-weight: 700;">✓ Aplicado</span>
        </button>
    `;

    const btnToggle = container.querySelector('.btn-toggle-oferta');
    btnToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const descInput = row.querySelector('input[name*="[descuento_adicional]"]');
        if (!descInput) return;

        const isCurrentlyActive = btnToggle.classList.contains('active');
        if (isCurrentlyActive) {
            // Desactivar beneficio
            btnToggle.classList.remove('active');
            btnToggle.style.background = '#f1f5f9';
            btnToggle.style.borderColor = '#cbd5e1';
            btnToggle.style.color = '#64748b';
            btnToggle.style.boxShadow = 'none';
            btnToggle.querySelector('.icon-oferta').textContent = '⏸️';
            btnToggle.querySelector('.estado-oferta').style.background = '#94a3b8';
            btnToggle.querySelector('.estado-oferta').textContent = 'Desactivado';
            
            setNumeric(descInput, 0, 2, 0);
        } else {
            // Reactivar beneficio
            btnToggle.classList.add('active');
            btnToggle.style.background = '#ecfdf5';
            btnToggle.style.borderColor = '#10b981';
            btnToggle.style.color = '#047857';
            btnToggle.style.boxShadow = '0 1px 2px rgba(16,185,129,0.15)';
            btnToggle.querySelector('.icon-oferta').textContent = '🔥';
            btnToggle.querySelector('.estado-oferta').style.background = '#10b981';
            btnToggle.querySelector('.estado-oferta').textContent = '✓ Aplicado';

            setNumeric(descInput, descPct, 2, 0);
        }

        if (detalleId != null) {
            if (typeof calcularPrecio === 'function') calcularPrecio(detalleId);
            if (window.Detalles && typeof window.Detalles.calcularPrecio === 'function') window.Detalles.calcularPrecio(detalleId);
        }
        if (typeof recalcTotales === 'function') recalcTotales();
    });

    tdArticulo.appendChild(container);
}
window.renderOfertaBadgeFila = renderOfertaBadgeFila;

// ============================================
// LÓGICA DE MODO RETIRO (FASE 2)
// ============================================

function activarModoRetiro() {
    window.MODO_RETIRO = true;
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

    const panelOpciones = document.getElementById('contenedor-opciones-retiro');
    if (panelOpciones) panelOpciones.style.display = 'block';

    const panelFecha = document.getElementById('fecha-retiro-container');
    if (panelFecha) panelFecha.style.display = 'block';

    const fechaComprobante = document.getElementById('fecha_comprobante');
    const fechaInput = document.getElementById('fecha');
    const today = new Date().toISOString().split('T')[0];
    if (fechaComprobante && fechaInput) {
        fechaComprobante.value = fechaInput.value || today;
        fechaComprobante.addEventListener('change', () => {
            fechaInput.value = fechaComprobante.value;
            fechaInput.dispatchEvent(new Event('change'));
        });
    }

    const panelAdmin = document.getElementById('admin-retiro-container');
    if (panelAdmin) panelAdmin.style.display = 'block';

    const panelMetodo = document.getElementById('seccion-metodo-retiro');
    if (panelMetodo) panelMetodo.style.display = 'block';

    // FASE 3: Lógica de exclusión mutua para Opciones de Retiro
    setupRetiroMutex();
}

/**
 * Configura la exclusión mutua entre Trámite Administrativo y Método de Retiro Físico
 */
function setupRetiroMutex() {
    if (window._retiroMutexSetup) return; // Evitar multiples listeners
    window._retiroMutexSetup = true;

    const radioOperacion = document.querySelectorAll('input[name="tipo_operacion_retiro"]');
    const chkAdminHidden = document.getElementById('chk_tramite_administrativo');
    const radiosSubmetodos = document.querySelectorAll('input.subopcion-retiro');
    const containerLeyenda = document.getElementById('subopciones-logistica');

    if (radioOperacion.length === 0 || !chkAdminHidden) return;

    // Escuchar cambios en la Opcion Principal (A vs B)
    radioOperacion.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const isAdministrativo = (e.target.value === 'administrativo');

            // Sincronizar el checkbox oculto que lee el backend original
            chkAdminHidden.checked = isAdministrativo;

            if (isAdministrativo) {
                // Deshabilitar las sub-opciones logísticas (Método físico)
                radiosSubmetodos.forEach(r => {
                    r.disabled = true;
                    // Opcionalmente podemos deseleccionar form inputs
                    r.checked = false;
                });
                if (containerLeyenda) containerLeyenda.style.opacity = '0.4';
                
            } else {
                // Habilitar las sub-opciones logísticas
                radiosSubmetodos.forEach(r => {
                    r.disabled = false;
                    // Reseleccionar chofer por defecto al volver a método físico
                    if (r.value === 'chofer') r.checked = true;
                });
                if (containerLeyenda) containerLeyenda.style.opacity = '1';
            }
        });
    });
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
        // QA Modification: Solo traer comprobantes válidos para devolución y excluir explícitamente "Orden de Retiro".
        const params = new URLSearchParams({
            cliente_id: clienteId,
            limit: 50,
            // Agregamos 'APROBADA' (facturas AFIP) y 'Conciliado' (Lomasoft) para permitir NC administrativas sin entrega física
            estado: 'FACTURADO,Entregado,Confirmado,APROBADA,Conciliado',
            excluir_tipo: 'Orden de Retiro'
        });

        const res = await fetch(`/api/presupuestos?${params.toString()}`);
        if (!res.ok) throw new Error('Error al buscar historial');

        const data = await res.json();
        const presupuestos = data.data || [];

        if (presupuestos.length === 0) {
            if (container) container.innerHTML = '<div style="text-align: center; padding: 20px;">No se encontraron entregas recientes.</div>';
            return;
        }

        if (container) container.innerHTML = '';
        const list = document.createElement('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';

        // Agrupar por Mes y Año
        const grupos = {};

        presupuestos.forEach(p => {
            // Arreglo del "Invalid Date" usando fecha_registro que viene del backend
            const validDate = p.fecha_registro ? new Date(p.fecha_registro) : new Date();
            const anio = validDate.getFullYear();
            const mesNombre = validDate.toLocaleString('es-ES', { month: 'long' });
            const mesCapitalizado = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);
            const grupoKey = `${mesCapitalizado} ${anio}`;

            if (!grupos[grupoKey]) {
                grupos[grupoKey] = [];
            }
            // Agregamos la fecha formateada al objeto para facilidad de render
            p.fechaFormateada = validDate.toLocaleDateString('es-ES');
            grupos[grupoKey].push(p);
        });

        // Renderizar por grupo
        Object.keys(grupos).forEach(grupoKey => {
            const grupoDiv = document.createElement('div');
            grupoDiv.style.cssText = 'border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #fff;';

            const grupoHeader = document.createElement('div');
            grupoHeader.style.cssText = 'background: #f8f9fa; padding: 10px 15px; font-weight: bold; color: #2c3e50; border-bottom: 2px solid #3498db;';
            grupoHeader.innerHTML = `📅 ${grupoKey} <span style="float:right; font-weight:normal; font-size: 0.9em; background: #e9ecef; padding: 2px 8px; border-radius: 12px;">${grupos[grupoKey].length} entregas</span>`;

            grupoDiv.appendChild(grupoHeader);

            const itemsContainer = document.createElement('div');

            grupos[grupoKey].forEach(p => {
                const itemWrapper = document.createElement('div');
                itemWrapper.style.cssText = 'border-bottom: 1px solid #eee; display: flex; flex-direction: column;';

                const item = document.createElement('div');
                item.style.cssText = `
                    padding: 12px 15px; 
                    cursor: pointer; 
                    display: flex; 
                    justify-content: space-between;
                    align-items: center;
                    transition: background 0.2s;
                `;
                item.onmouseover = () => item.style.background = '#f1f8ff';
                item.onmouseout = () => item.style.background = 'transparent';

                const totalFmt = (typeof formatARS === 'function') ? formatARS(p.total || 0) : `$ ${p.total || 0}`;

                item.innerHTML = `
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <strong style="color: #2c3e50; font-size: 1.1em;">#${p.id}</strong> 
                            <span style="color: #7f8c8d; font-size: 0.9em;">${p.fechaFormateada}</span>
                            <span style="background: #e1f5fe; color: #0288d1; font-size: 0.75em; padding: 2px 6px; border-radius: 4px;">${p.estado}</span>
                        </div>
                    </div>
                    <div style="text-align: right; display: flex; gap: 10px; align-items: center;">
                        <button class="btn btn-sm btn-secondary btn-ver-detalles" style="padding: 4px 10px; font-size: 0.8em; background: #95a5a6; border: none; color: white; border-radius: 4px; cursor: pointer;">
                            👁️ Ver Ítems
                        </button>
                        <button class="btn btn-sm btn-primary btn-importar-total" style="padding: 6px 14px; font-size: 0.85em; font-weight: bold; background: #27ae60; border: none; color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                            📋 Clonar Todo
                        </button>
                    </div>
                `;

                // Contenedor expandible para los detalles
                const detallesContainer = document.createElement('div');
                detallesContainer.id = `detalles-preview-${p.id}`;
                detallesContainer.style.cssText = 'display: none; padding: 15px; background: #fdfdfd; border-top: 1px dashed #ccc;';

                // Eventos de botones
                const btnVer = item.querySelector('.btn-ver-detalles');
                btnVer.onclick = (e) => {
                    e.stopPropagation();
                    toggleDetallesPresupuesto(p.id, detallesContainer, btnVer);
                };

                const btnImportar = item.querySelector('.btn-importar-total');
                btnImportar.onclick = (e) => {
                    e.stopPropagation();
                    confirmarImportacion(p.id, p.descuento || 0);
                };

                // Clic en la fila también expande
                item.onclick = () => {
                    toggleDetallesPresupuesto(p.id, detallesContainer, btnVer);
                };

                itemWrapper.appendChild(item);
                itemWrapper.appendChild(detallesContainer);
                itemsContainer.appendChild(itemWrapper);
            });

            grupoDiv.appendChild(itemsContainer);
            list.appendChild(grupoDiv);
        });

        if (container) container.appendChild(list);

    } catch (e) {
        console.error(e);
        if (container) container.innerHTML = `<div class="message error">Error: ${e.message}</div>`;
    }
}

// Nueva función para toggle y carga asíncrona de detalles
async function toggleDetallesPresupuesto(idPresupuesto, containerEl, btnEl) {
    const isVisible = containerEl.style.display === 'block';

    // Toggle UI state
    if (isVisible) {
        containerEl.style.display = 'none';
        btnEl.innerHTML = '👁️ Ver Ítems';
        btnEl.style.background = '#95a5a6';
        return;
    }

    containerEl.style.display = 'block';
    btnEl.innerHTML = '🔼 Ocultar';
    btnEl.style.background = '#7f8c8d';

    // Si ya están cargados, no volver a hacer fetch
    if (containerEl.dataset.loaded === 'true') return;

    containerEl.innerHTML = '<div style="text-align: center; color: #666; font-size: 0.9em; padding: 10px;">⏳ Cargando artículos...</div>';

    try {
        const res = await fetch(`/api/presupuestos/${idPresupuesto}/detalles`);
        if (!res.ok) throw new Error('Error al cargar detalle');

        const data = await res.json();

        let detalles = [];
        if (data.data && Array.isArray(data.data.detalles)) {
            detalles = data.data.detalles;
        } else if (Array.isArray(data.data)) {
            detalles = data.data;
        } else if (Array.isArray(data.detalles)) {
            detalles = data.detalles;
        } else if (Array.isArray(data)) {
            detalles = data;
        }

        if (detalles.length === 0) {
            containerEl.innerHTML = '<div style="color: #e74c3c; font-size: 0.9em;">⚠️ Este presupuesto no tiene artículos.</div>';
            containerEl.dataset.loaded = 'true';
            return;
        }

        // Construir tabla de preview compacta
        let html = `
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
                <thead style="background: #f1f3f5; color: #495057;">
                    <tr>
                        <th style="padding: 6px; text-align: left; border-bottom: 2px solid #dee2e6;">Artículo</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 2px solid #dee2e6; width: 60px;">Cant</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 2px solid #dee2e6; width: 80px;">P.Unitario</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 2px solid #dee2e6; width: 80px;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let subtotalGlobal = 0;

        detalles.forEach(d => {
            const artCodigo = d.codigo_barras || d.articulo_numero || d.articulo_codigo || d.articulo || '';
            const artNombre = d.articulo_nombre || d.descripcion_articulo || d.descripcion || d.detalle || 'Art. Desconocido';
            const cantidad = Number(d.cantidad) || 0;
            const precioUnitario = Number(d.precio_unitario) || Number(d.valor_unitario) || Number(d.valor1) || Number(d.neto) || 0;
            const subtotal = Number(d.total) || (Number(d.precio1) * cantidad) || (cantidad * precioUnitario);

            subtotalGlobal += subtotal;

            const precioFmt = (typeof formatARS === 'function') ? formatARS(precioUnitario) : `$${precioUnitario.toFixed(2)}`;
            const subtotalFmt = (typeof formatARS === 'function') ? formatARS(subtotal) : `$${subtotal.toFixed(2)}`;

            html += `
                <tr style="border-bottom: 1px solid #e9ecef;">
                    <td style="padding: 6px; color: #34495e;"><strong>${artCodigo}</strong> - ${artNombre}</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold; color: #27ae60;">${cantidad}</td>
                    <td style="padding: 6px; text-align: right; color: #7f8c8d;">${precioFmt}</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold;">${subtotalFmt}</td>
                </tr>
            `;
        });

        let fetchedDescuento = 0;
        if (data.data && data.data.presupuesto && data.data.presupuesto.descuento) {
            fetchedDescuento = parseFloat(data.data.presupuesto.descuento) * 100;
        }

        // Fila de descuento (Si existe en la cabecera original)
        if (fetchedDescuento > 0) {
            const montoDescuento = subtotalGlobal * (fetchedDescuento / 100);
            subtotalGlobal -= montoDescuento;
            const descFmt = (typeof formatARS === 'function') ? formatARS(montoDescuento) : `$${montoDescuento.toFixed(2)}`;
            html += `
                <tr style="background: #f8dbdb;">
                    <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold; color: #d9534f;">🏷️ Descuento Global Original (${fetchedDescuento.toFixed(2)}%):</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold; color: #d9534f; font-size: 1.1em;">-${descFmt}</td>
                </tr>
            `;
        }

        // Fila total
        const totalGlobalFmt = (typeof formatARS === 'function') ? formatARS(subtotalGlobal) : `$${subtotalGlobal.toFixed(2)}`;
        html += `
                <tr style="background: #f8f9fa;">
                    <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">TOTAL FINAL:</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold; color: #2c3e50; font-size: 1.1em;">${totalGlobalFmt}</td>
                </tr>
                </tbody>
            </table>
        `;

        containerEl.innerHTML = html;
        containerEl.dataset.loaded = 'true';

    } catch (e) {
        console.error(e);
        containerEl.innerHTML = `<div style="color: #e74c3c; font-size: 0.9em;">Error: ${e.message}</div>`;
    }
}

async function confirmarImportacion(idPresupuesto, descuentoPorcentaje = 0) {
    if (!confirm('¿Importar todos los artículos de este presupuesto? Se reemplazarán las filas actuales de la orden de retiro.')) return;

    const modal = document.getElementById('modal-paginator-presupuestos');
    if (modal) modal.style.display = 'none';

    const tbody = document.getElementById('detalles-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">⏳ Clonando artículos...</td></tr>';

    try {
        const res = await fetch(`/api/presupuestos/${idPresupuesto}/detalles`);
        if (!res.ok) throw new Error('Error al cargar detalle');

        const data = await res.json();

        // AUTOFILL DE CAMPOS ORIGEN DE FACTURACIÓN (REGLA GRANÍTICA 1:1) PARA CLONACIÓN COMPLETA
        try {
            const origenFactSelect = document.getElementById('origen_facturacion');
            const origenPuntoVentaInput = document.getElementById('origen_punto_venta');
            const origenNumFacturaInput = document.getElementById('origen_numero_factura');
            
            if (origenFactSelect && origenPuntoVentaInput && origenNumFacturaInput) {
                let compLomasoft = null;
                if (data.data && data.data.presupuesto && data.data.presupuesto.comprobante_lomasoft) {
                    compLomasoft = data.data.presupuesto.comprobante_lomasoft;
                }
                
                if (compLomasoft && String(compLomasoft).trim() !== '') {
                    // Es de Lomasoft
                    origenFactSelect.value = 'LOMASOFT';
                    const partes = String(compLomasoft).split('-');
                    if (partes.length === 3) {
                        origenPuntoVentaInput.value = parseInt(partes[1], 10);
                        origenNumFacturaInput.value = parseInt(partes[2], 10);
                    } else if (partes.length === 2) {
                        origenPuntoVentaInput.value = parseInt(partes[0], 10);
                        origenNumFacturaInput.value = parseInt(partes[1], 10);
                    }
                } else if (idPresupuesto) {
                    // Es de LAMDA
                    origenFactSelect.value = 'LAMDA';
                    const ptoVta = (data.data && data.data.presupuesto && data.data.presupuesto.pto_vta) ? parseInt(data.data.presupuesto.pto_vta, 10) : null;
                    origenPuntoVentaInput.value = ptoVta || 32;
                    origenNumFacturaInput.value = parseInt(idPresupuesto, 10);
                }
                
                // Bloquear inputs para cumplir con requerimiento (Read-Only estricto tras autocompletar)
                origenFactSelect.style.pointerEvents = 'none';
                origenFactSelect.style.backgroundColor = '#ecf0f1';
                origenFactSelect.tabIndex = -1;
            }
        } catch(err) {
            console.warn("No se pudieron autocompletar los campos de origen en la clonación masiva", err);
        }

        let detalles = [];
        let fetchedDescuento = 0; // QA Fix: Extraer desde la API
        if (data.data && Array.isArray(data.data.detalles)) {
            detalles = data.data.detalles;
            if (data.data.presupuesto && data.data.presupuesto.descuento) {
                // El endpoint /detalles devuelve la fracción original (ej: 0.02)
                fetchedDescuento = parseFloat(data.data.presupuesto.descuento) * 100;
            }
        } else if (Array.isArray(data.data)) {
            detalles = data.data;
        } else if (Array.isArray(data.detalles)) {
            detalles = data.detalles;
        } else if (Array.isArray(data)) {
            detalles = data;
        }

        if (tbody) tbody.innerHTML = '';
        detalleCounter = 0;

        if (detalles.length === 0) {
            agregarDetalle();
            if (typeof mostrarMensaje === 'function') mostrarMensaje('⚠️ El presupuesto original no tenía artículos.', 'error');
            return;
        }

        detalles.forEach(d => {
            agregarDetalle();
            const id = detalleCounter;
            const row = document.getElementById(`detalle-${id}`);
            if (!row) return;

            const inpArt = row.querySelector(`input[name="detalles[${id}][articulo]"]`) || row.querySelector(`input[name*="[articulo]"]`);
            const inpCant = row.querySelector(`input[name="detalles[${id}][cantidad]"]`) || row.querySelector(`input[name*="[cantidad]"]`);
            const inpVal = row.querySelector(`input[name="detalles[${id}][valor1]"]`) || row.querySelector(`input[name*="[valor1]"]`);
            const inpIva = row.querySelector(`input[name="detalles[${id}][iva1]"]`) || row.querySelector(`input[name*="[iva1]"]`);

            const artCodigo = d.codigo_barras || d.articulo_numero || d.articulo_codigo || d.articulo || '';
            const artNombre = d.articulo_nombre || d.descripcion_articulo || d.descripcion || d.detalle || artCodigo;

            if (inpArt) {
                inpArt.value = artNombre;
                if (artCodigo) inpArt.dataset.codigoBarras = artCodigo;
                // Marcar como validado para que no salte de nuevo la intercepción al clonar
                inpArt.dataset.origenValidado = 'true';
            }

            if (inpCant) {
                // Forzamos el input value y llamamos a setCantidad si existe
                inpCant.value = d.cantidad || 1;
                if (typeof setCantidad === 'function') setCantidad(inpCant, d.cantidad || 1);
            }

            // Valor y Precio
            const precioUnitario = Number(d.precio_unitario) || Number(d.valor_unitario) || Number(d.valor1) || Number(d.neto) || 0;
            if (inpVal) {
                inpVal.value = precioUnitario;
                if (typeof setNumeric === 'function') setNumeric(inpVal, precioUnitario, 2, 0);
            }

            // IVA
            let alicuotaIva = Number(d.alicuota_iva);
            if (!alicuotaIva && d.camp2) {
                alicuotaIva = Number(d.camp2) * 100;
            }
            if (!alicuotaIva) alicuotaIva = 21;

            if (inpIva) {
                inpIva.value = alicuotaIva;
                if (typeof setNumeric === 'function') setNumeric(inpIva, alicuotaIva, 2, 21);
            }

            if (typeof calcularPrecio === 'function') calcularPrecio(id);
        });

        // Aplicar Iva Global mode por si acaso (para remitos)
        if (typeof applyIvaModeToAllRows === 'function') applyIvaModeToAllRows();

        // Aplicar descuento heredado (Pilar logístico corregido para importaciones masivas)
        const finalDescuento = fetchedDescuento > 0 ? fetchedDescuento : (parseFloat(descuentoPorcentaje) || 0);

        const inpDescuento = document.getElementById('descuento');
        if (inpDescuento && finalDescuento > 0) {
            inpDescuento.value = finalDescuento.toFixed(2);
            inpDescuento.style.backgroundColor = '#d4edda'; // Verde suave (Feedback visual)
            if (window.EvaluadorPoliticas?.setManualOverride) {
                window.EvaluadorPoliticas.setManualOverride(true);
            }
            if (window.EvaluadorPoliticas?.mostrarBannerRetiro) {
                window.EvaluadorPoliticas.mostrarBannerRetiro(finalDescuento);
            }
            console.log(`[CLONADO] Descuento heredado aplicado: ${finalDescuento}%`);
        }

        // Disparar total final
        if (typeof recalcTotales === 'function') setTimeout(recalcTotales, 200);

        if (typeof mostrarMensaje === 'function') mostrarMensaje(`✅ ${detalles.length} artículos clonados correctamente. Verifique la orden antes de confirmar.`, 'success');

    } catch (e) {
        console.error(e);
        if (typeof mostrarMensaje === 'function') mostrarMensaje('Error al importar artículos: ' + e.message, 'error');
        // Si falló, al menos dejar una fila vacía para seguir iterando
        if (tbody && tbody.children.length === 0) agregarDetalle();
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

        const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked ? 'true' : 'false';

        const paramsHistorial = new URLSearchParams({
            cliente_id: clienteId,
            articulo_codigo: itemData.codigoBarras || itemData.articuloNumero || '',
            descripcion: itemData.description || ''
        });

        const paramsPrecios = new URLSearchParams({
            cliente_id: clienteId,
            codigo_barras: itemData.codigoBarras || '',
            articulo_numero: itemData.articuloNumero || '',
            descripcion: itemData.description || '',
            usar_precios_bunker: usarPreciosBunker
        });

        // 1. Fetch Historial y Precio Actual en Paralelo
        const [resHistorial, resPrecios] = await Promise.all([
            fetch(`/api/presupuestos/historial-articulo?${paramsHistorial}`),
            fetch(`/api/presupuestos/precios?${paramsPrecios}`)
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
function resumeSeleccionArticulo(input, element, precioOverride = null, descuentoOverride = null, descuentoAdicionalOverride = null) {
    // Marcar como validado para saltar la intercepción esta vez
    element.dataset.origenValidado = 'true';

    // Ejecutar selección normal
    seleccionarArticulo(input, element);

    // Si hubo override de precio o descuentos (desde historial), aplicarlo POST selección
    if (precioOverride !== null || descuentoOverride !== null || descuentoAdicionalOverride !== null) {
        setTimeout(() => {
            const row = input.closest('tr');
            if (!row) return;

            if (precioOverride !== null) {
                const valorInput = row.querySelector('input[name*="[valor1]"]');
                if (valorInput) {
                    setNumeric(valorInput, precioOverride, 2, 0);
                    valorInput.classList.add('precio-vinculado'); // Efecto visual opcional
                    // Visual feedback
                    valorInput.style.backgroundColor = '#d4edda'; // Verde suave
                }
            }

            if (descuentoOverride !== null && descuentoOverride > 0) {
                const globalDescuentoInput = document.getElementById('descuento');
                if (globalDescuentoInput) {
                    const currentDesc = parseFloat(globalDescuentoInput.value) || 0;
                    if (descuentoOverride > currentDesc) {
                        globalDescuentoInput.value = descuentoOverride;
                        globalDescuentoInput.style.backgroundColor = '#d4edda'; // Verde suave
                        if (window.EvaluadorPoliticas?.setManualOverride) {
                            window.EvaluadorPoliticas.setManualOverride(true);
                        }
                        if (window.EvaluadorPoliticas?.mostrarBannerRetiro) {
                            window.EvaluadorPoliticas.mostrarBannerRetiro(descuentoOverride);
                        }
                    }
                }
            }

            if (descuentoAdicionalOverride !== null && descuentoAdicionalOverride > 0) {
                const descInput = row.querySelector('input[name*="[descuento_adicional]"]');
                if (descInput) {
                    setNumeric(descInput, descuentoAdicionalOverride, 2, 0);
                    descInput.style.backgroundColor = '#d4edda'; // Verde suave
                }
            }

            // Recalcular con el nuevo precio y descuento
            const valorInputForEval = row.querySelector('input[name*="[valor1]"]');
            if (valorInputForEval) dispatchRecalc(valorInputForEval);

            // Asegurar disparo de recálculo total si módulo común está presente
            const detalleId = getDetalleIdFromInput(valorInputForEval || input);
            if (window.Detalles) {
                if (window.Detalles.calcularPrecio && detalleId) {
                    window.Detalles.calcularPrecio(detalleId);
                }
                if (window.Detalles.calcularTotalesGenerales) {
                    window.Detalles.calcularTotalesGenerales();
                }
            }

        }, 120); // Pequeño delay para asegurar que el fetch de precios normal haya terminado (race condition fix simple)
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
                    badgeDiff = `<span style="background: #d4edda; color: #155724; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600;">⚖️ Mismo Precio</span>`;
                } else if (diff > 0) {
                    badgeDiff = `<span style="background: #fff3cd; color: #856404; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600;">Subió ${diffPercent}% (+$${diff.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>`;
                } else {
                    badgeDiff = `<span style="background: #cce5ff; color: #004085; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600;">Bajó ${Math.abs(diffPercent)}% (-$${Math.abs(diff).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>`;
                }

                const descuentoPct = parseFloat(h.descuento_porcentaje || 0);
                const descAdicional = parseFloat(h.descuento_adicional || 0);
                const descTotal = descuentoPct + descAdicional;

                let descBadgeHTML = '';
                if (descuentoPct > 0 && descAdicional > 0) {
                    descBadgeHTML = `<div style="font-size: 0.85em; color: #b91c1c; margin-top: 4px; font-weight: bold; background: #fee2e2; border: 1px solid #fca5a5; display: inline-block; padding: 3px 8px; border-radius: 4px;">🏷️ Descuento: ${descuentoPct.toFixed(2)}% general + ${descAdicional.toFixed(2)}% especial en este ítem (Total: ${descTotal.toFixed(2)}%)</div>`;
                } else if (descuentoPct > 0) {
                    descBadgeHTML = `<div style="font-size: 0.85em; color: #b91c1c; margin-top: 4px; font-weight: bold; background: #fee2e2; border: 1px solid #fca5a5; display: inline-block; padding: 3px 8px; border-radius: 4px;">🏷️ Tiene ${descuentoPct.toFixed(2)}% de Descuento Global</div>`;
                } else if (descAdicional > 0) {
                    descBadgeHTML = `<div style="font-size: 0.85em; color: #b91c1c; margin-top: 4px; font-weight: bold; background: #fee2e2; border: 1px solid #fca5a5; display: inline-block; padding: 3px 8px; border-radius: 4px;">🏷️ Bonificación especial en este ítem: ${descAdicional.toFixed(2)}%</div>`;
                }

                let subComprobante = '';
                if (h.comprobante_lomasoft) {
                    subComprobante = `<span style="margin-left: 8px; color: #00796b;">📄 Fac Lomasoft: ${h.comprobante_lomasoft}</span>`;
                } else if (h.cbte_nro) {
                    subComprobante = `<span style="margin-left: 8px; color: #155724; font-weight: 600;">📄 Factura AFIP #${h.cbte_nro} (Pto ${h.pto_vta || 32})</span>`;
                }
                const tituloPresupuesto = `Presupuesto #${h.id_presupuesto} ${subComprobante}`;

                itemDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            <div style="font-weight: bold; color: #2c3e50;">${tituloPresupuesto} <span style="font-weight: normal; color: #888; font-size: 0.9em;">(${fecha})</span></div>
                            <div style="font-size: 0.85em; margin-top: 4px; padding: 2px 6px; border-radius: 4px; display: inline-block; background-color: ${(h.origen_facturacion||'').includes('LOMASOFT') ? '#e0f7fa' : ((h.origen_facturacion||'').includes('LAMDA') ? '#e8f5e9' : '#f8f9fa')}; border: 1px solid ${(h.origen_facturacion||'').includes('LOMASOFT') ? '#4dd0e1' : ((h.origen_facturacion||'').includes('LAMDA') ? '#81c784' : '#ddd')}; color: ${(h.origen_facturacion||'').includes('LOMASOFT') ? '#006064' : ((h.origen_facturacion||'').includes('LAMDA') ? '#1b5e20' : '#666')};">
                                🏢 <strong>${h.origen_facturacion || 'NO FACTURADO'}</strong>
                            </div>
                            <div style="font-size: 0.85em; color: #28a745; margin-top: 4px;">🕒 ${tiempoRel}</div>
                            ${descBadgeHTML}
                        </div>
                        <div style="text-align: right;">
                             <div style="font-size: 0.9em; color: #666;">Cant: <strong>${h.cantidad}</strong></div>
                        </div>
                    </div>
                    
                    <div style="background: #fafafa; padding: 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div style="font-size: 0.9em;">
                            <div style="margin-bottom: 4px;">Histórico (Neto): <strong>$${precioHist.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                            <div style="color: #666;">Actual (Neto): <strong>$${precioAct.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                            <div style="margin-top: 4px;">${badgeDiff}</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-smart-action btn-historico" style="background: #2c3e50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em; font-weight: 600;">
                                ↩️ Retomar Histórico ($${precioHist.toLocaleString('es-AR', { maximumFractionDigits: 0 })})
                            </button>
                            ${Math.abs(diff) > 0.01 ? `
                            <button class="btn-smart-action btn-actual" style="background: white; color: #2c3e50; border: 1px solid #2c3e50; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">
                                🆕 Usar Actual ($${precioAct.toLocaleString('es-AR', { maximumFractionDigits: 0 })})
                            </button>` : ''}
                        </div>
                    </div>
                `;

                // Event Listeners para los botones
                const btnHist = itemDiv.querySelector('.btn-historico');
                btnHist.onclick = (e) => { 
                    e.stopPropagation(); 
                    seleccionarOrigenConfirmed(
                        precioHist, 
                        h.descuento_porcentaje || 0, 
                        descAdicional, 
                        h.id_presupuesto, 
                        h.comprobante_lomasoft, 
                        h.pto_vta,
                        h.cbte_nro,
                        h.factura_id
                    ); 
                };

                const btnAct = itemDiv.querySelector('.btn-actual');
                if (btnAct) btnAct.onclick = (e) => { 
                    e.stopPropagation(); 
                    seleccionarOrigenConfirmed(
                        null, 
                        0, 
                        0, 
                        h.id_presupuesto, 
                        h.comprobante_lomasoft, 
                        h.pto_vta,
                        h.cbte_nro,
                        h.factura_id
                    ); 
                };

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
            // Sort months descending by pulling the timestamp of the first item
            const dateA = new Date(a.items[0].fecha).getTime();
            const dateB = new Date(b.items[0].fecha).getTime();
            return dateB - dateA;
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
function seleccionarOrigenConfirmed(precioHistorico, descuentoPorcentaje = 0, descuentoAdicional = 0, origenId = null, comprobanteLomasoft = null, ptoVta = null, cbteNro = null, facturaId = null) {
    modalOrigen.hide();
    
    // AUTOFILL DE CAMPOS ORIGEN DE FACTURACIÓN (REGLA GRANÍTICA 1:1)
    try {
        const origenFactSelect = document.getElementById('origen_facturacion');
        const origenPuntoVentaInput = document.getElementById('origen_punto_venta');
        const origenNumFacturaInput = document.getElementById('origen_numero_factura');
        
        if (origenFactSelect && origenPuntoVentaInput && origenNumFacturaInput) {
            if (comprobanteLomasoft && String(comprobanteLomasoft).trim() !== '') {
                // Es de Lomasoft ("0004-00001234")
                origenFactSelect.value = 'LOMASOFT';
                const partes = String(comprobanteLomasoft).split('-');
                if (partes.length === 3) {
                    origenPuntoVentaInput.value = parseInt(partes[1], 10);
                    origenNumFacturaInput.value = parseInt(partes[2], 10);
                } else if (partes.length === 2) {
                    origenPuntoVentaInput.value = parseInt(partes[0], 10);
                    origenNumFacturaInput.value = parseInt(partes[1], 10);
                }
            } else if (origenId) {
                // Es de LAMDA
                origenFactSelect.value = 'LAMDA';
                origenPuntoVentaInput.value = ptoVta ? parseInt(ptoVta, 10) : 32; // Usar ptoVta del histórico o fallback a 32 para LAMDA
                // Si tenemos el número fiscal de factura real (cbteNro), usarlo; si no, fallback a origenId
                origenNumFacturaInput.value = cbteNro ? parseInt(cbteNro, 10) : parseInt(origenId, 10);
            }
        }
    } catch(err) {
        console.warn("No se pudieron autocompletar los campos de origen de facturación", err);
    }

    if (currentSelectionContext) {
        const { inputElement, suggestionElement } = currentSelectionContext;
        resumeSeleccionArticulo(inputElement, suggestionElement, precioHistorico, descuentoPorcentaje, descuentoAdicional);
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

// --------------------------------------------------------------------------------------
// KIT DE INSUMOS ANIDADOS (SSOT)
// --------------------------------------------------------------------------------------
window.inyectarFilasHijasKit = function(parentRow, ingredientesKit, parentRowId, baseQty) {
    const tbody = document.getElementById('detalles-tbody');
    
    parentRow.dataset.isParent = "true";
    parentRow.dataset.parentRowId = parentRowId;

    ingredientesKit.forEach(ing => {
        agregarDetalle();
        
        const rows = tbody.querySelectorAll('tr');
        const newRow = rows[rows.length - 1];
        
        newRow.classList.add('child-row');
        newRow.dataset.childOf = parentRowId;

        // Limpiar estilos innecesarios
        const targetInput = newRow.querySelector('input[name*="[articulo]"]');
        if (targetInput) {
            targetInput.value = ing.descripcion;
            targetInput.dataset.articuloNumero = ing.articulo_id || '';
            targetInput.dataset.codigoBarras = ing.articulo_id || ''; // Requerido por handleSubmit
            targetInput.readOnly = true; // El artículo no se puede cambiar, pero cantidades sí
            targetInput.style.backgroundColor = '#f1f5f9';
            targetInput.style.fontWeight = 'bold';
            targetInput.style.color = '#475569';
            targetInput.dataset.ignoreHistorico = "true"; // Opcional, para no buscar historial del insumo
        }

        const cantidadInput = newRow.querySelector('input[name*="[cantidad]"]');
        if (cantidadInput) {
            const qtyCalculada = parseFloat(ing.cantidad_por_kilo_base) * baseQty;
            setCantidad(cantidadInput, qtyCalculada);
            cantidadInput.dataset.baseRatio = ing.cantidad_por_kilo_base;
        }

        const iva1Input = newRow.querySelector('input[name*="[iva1]"]');
        if (iva1Input) {
            setNumeric(iva1Input, parseFloat(ing.iva_porcentaje) || 21, 2, 21);
            iva1Input.readOnly = true;
        }

        const valor1Input = newRow.querySelector('input[name*="[valor1]"]');
        if (valor1Input) {
            const valorSinIva = parseFloat(ing.costo_base) || 0;
            setNumeric(valor1Input, valorSinIva, 2, 0);
            valor1Input.readOnly = true;
        }

        // Remover el listener del input artículo para no abrir buscador
        const newTargetId = getDetalleIdFromInput(targetInput);
        if (newTargetId != null) {
            calcularPrecio(newTargetId);
        }
    });

    // Sincronizar cantidad del padre con los hijos
    const parentQtyInput = parentRow.querySelector('input[name*="[cantidad]"]');
    if (parentQtyInput) {
        parentQtyInput.addEventListener('input', function() {
            const currentParentQty = parseFloat(String(this.value).replace(',', '.')) || 1;
            const childRows = tbody.querySelectorAll(`tr.child-row[data-child-of="${parentRowId}"]`);
            childRows.forEach(crow => {
                const cQtyInput = crow.querySelector('input[name*="[cantidad]"]');
                if (cQtyInput && cQtyInput.dataset.baseRatio) {
                    const ratio = parseFloat(cQtyInput.dataset.baseRatio);
                    setCantidad(cQtyInput, currentParentQty * ratio);
                    
                    const cid = getDetalleIdFromInput(cQtyInput);
                    if (cid != null) calcularPrecio(cid);
                }
            });
        });
    }
};

// Mutation Observer para auto-eliminar filas hijas si se elimina el padre
document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('detalles-tbody');
    if (tbody) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.tagName === 'TR' && node.dataset.isParent === "true") {
                        const parentId = node.dataset.parentRowId;
                        const childRows = tbody.querySelectorAll(`tr.child-row[data-child-of="${parentId}"]`);
                        childRows.forEach(crow => crow.remove());
                        calcularTotales();
                    }
                });
            });
        });
        observer.observe(tbody, { childList: true });
    }

    // =========================================================================
    // MODO FACTURA DIRECTA / PRECARGA DESDE GESTIÓN COMERCIAL O BANDEJA ARCA
    // =========================================================================
    setTimeout(async () => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const modoUrl = urlParams.get('modo');
            const clienteUrl = urlParams.get('cliente');
            const precargarUrl = urlParams.get('precargar');
            const facturaOrigenUrl = urlParams.get('factura_origen');

            if (modoUrl === 'factura_directa' || precargarUrl) {
                const banner = document.getElementById('banner-modo-factura-directa');
                if (banner) banner.style.display = 'flex';
            }

            if (facturaOrigenUrl) {
                const notaInput = document.getElementById('nota');
                if (notaInput && !notaInput.value.trim()) {
                    notaInput.value = `Refacturación / Comprobante administrativo ref. Factura ID #${facturaOrigenUrl}`;
                }
            }

            // 1. Si vienen artículos para precargar (ej. ?precargar=MPX5:1,ART2:2), poblar las filas primero
            if (precargarUrl) {
                const pares = precargarUrl.split(',').map(s => s.trim()).filter(Boolean);
                const tbodyEl = document.getElementById('detalles-tbody');
                if (tbodyEl && pares.length > 0) {
                    for (let i = 0; i < pares.length; i++) {
                        const [codRaw, qtyRaw] = pares[i].split(':');
                        const cod = (codRaw || '').trim();
                        const qty = Math.max(0.01, parseFloat(qtyRaw) || 1);
                        if (!cod) continue;

                        let rows = tbodyEl.querySelectorAll('tr[id^="detalle-"]');
                        if (i >= rows.length) {
                            agregarDetalle();
                            rows = tbodyEl.querySelectorAll('tr[id^="detalle-"]');
                        }
                        const row = rows[i];
                        if (!row) continue;

                        const artInput = row.querySelector('input[name*="[articulo]"]');
                        const cantInput = row.querySelector('input[name*="[cantidad]"]');
                        if (artInput) {
                            artInput.value = cod;
                            artInput.dataset.codigoBarras = cod;
                            artInput.dataset.articuloNumero = cod;
                        }
                        if (cantInput) {
                            cantInput.value = qty;
                        }
                    }
                }
            }

            // 2. Si viene cliente por URL (ej. ?cliente=642), seleccionarlo automáticamente
            if (clienteUrl) {
                const resCli = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(clienteUrl)}`);
                if (resCli.ok) {
                    const dataCli = await resCli.json();
                    const listaCli = Array.isArray(dataCli?.data) ? dataCli.data : [];
                    const matchCli = listaCli.find(c => String(c.id) === String(clienteUrl)) || listaCli[0];
                    if (matchCli) {
                        const dummyEl = document.createElement('div');
                        dummyEl.dataset.clienteId = String(matchCli.id);
                        dummyEl.dataset.clienteNumero = formatearNumeroCliente(matchCli.id);
                        dummyEl.dataset.clienteNombre = formatearNombreCliente(matchCli.nombre, matchCli.apellido);
                        dummyEl.dataset.clienteCuit = matchCli.cuit || '';
                        dummyEl.dataset.clienteCondicionIva = matchCli.condicion_iva || '';
                        seleccionarCliente(dummyEl);
                    }
                }
            }
        } catch (errPreload) {
            console.warn('⚠️ [PRESUPUESTOS-CREATE] Error en precarga por URL:', errPreload);
        }
    }, 250);
});

window.enviarDirectoABandejaFacturas = async function() {
    const btn = document.getElementById('btn-enviar-bandeja-facturas');
    const originalText = btn ? btn.innerHTML : '';

    try {
        let idCliente = '0';
        if (clienteSeleccionado && clienteSeleccionado.cliente_id) {
            idCliente = String(clienteSeleccionado.cliente_id);
        } else {
            const rawCli = (document.getElementById('id_cliente')?.value || '').trim();
            const match = rawCli.match(/^\d+/);
            if (match) idCliente = String(parseInt(match[0], 10));
        }

        if (!idCliente || idCliente === '0') {
            alert('Por favor seleccione un cliente antes de enviar la factura a la Bandeja.');
            document.getElementById('id_cliente')?.focus();
            return;
        }

        const tbody = document.getElementById('detalles-tbody');
        const rows = tbody ? Array.from(tbody.querySelectorAll('tr[id^="detalle-"]')) : [];
        const itemsPayload = [];

        rows.forEach((row) => {
            if (row.classList.contains('out-of-stock-row') || row.classList.contains('child-row')) return;
            const artInput = row.querySelector('input[name*="[articulo]"]');
            const cantInput = row.querySelector('input[name*="[cantidad]"]');
            const val1Input = row.querySelector('input[name*="[valor1]"]');
            const iva1Input = row.querySelector('input[name*="[iva1]"]');
            const descAdicInput = row.querySelector('input[name*="[descuento_adicional]"]');

            const codigo = (artInput?.dataset?.codigoBarras || artInput?.dataset?.articuloNumero || '').trim();
            const descripcion = (artInput?.value || '').trim();
            const qty = parseFloat(cantInput?.value) || 0;
            const valorNeto = parseFloat(val1Input?.value) || 0;
            const ivaPct = parseFloat(iva1Input?.value) || 21;
            const descAdicPct = parseFloat(descAdicInput?.value) || 0;

            if (codigo && descripcion && qty > 0 && valorNeto > 0) {
                const pUnitNetoEfectivo = Math.round(valorNeto * (1 - (descAdicPct / 100)) * 100) / 100;
                const alicIvaId = Math.abs(ivaPct - 10.5) < 0.5 ? 2 : (ivaPct === 0 ? 3 : 1);
                itemsPayload.push({
                    articulo_id: codigo,
                    descripcion: descAdicPct > 0 ? `${descripcion} (Bonif. ${descAdicPct}%)` : descripcion,
                    qty: qty,
                    p_unit: pUnitNetoEfectivo,
                    alic_iva_id: alicIvaId
                });
            }
        });

        if (itemsPayload.length === 0) {
            alert('Agregue al menos un artículo válido con precio mayor a $0 para enviar a la Bandeja de Facturas.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Enviando a Bandeja...';
        }

        let docTipo = 80;
        let docNro = '';
        let condicionIvaId = 1;
        let tipoCbte = 1;

        const urlParams = new URLSearchParams(window.location.search);
        const facturaOrigenId = urlParams.get('factura_origen');

        try {
            let facRef = null;
            if (facturaOrigenId) {
                const rOrig = await fetch(`http://localhost:3004/facturacion/facturas/${encodeURIComponent(facturaOrigenId)}`);
                const dOrig = await rOrig.json();
                if (rOrig.ok && dOrig?.data) facRef = dOrig.data;
            }
            if (!facRef) {
                const rList = await fetch(`http://localhost:3004/facturacion/facturas?cliente_id=${encodeURIComponent(idCliente)}&limit=1`);
                const dList = await rList.json();
                if (rList.ok && Array.isArray(dList?.data) && dList.data.length > 0) {
                    facRef = dList.data[0];
                }
            }
            if (facRef && facRef.doc_nro) {
                docTipo = parseInt(facRef.doc_tipo, 10) || 80;
                docNro = String(facRef.doc_nro).replace(/\D/g, '');
                condicionIvaId = parseInt(facRef.condicion_iva_id, 10) || 1;
                const origTipo = parseInt(facRef.tipo_cbte, 10) || 1;
                tipoCbte = origTipo === 3 ? 1 : (origTipo === 8 ? 6 : (origTipo === 13 ? 11 : origTipo));
            }
        } catch (errRef) {
            console.warn('⚠️ No se pudo consultar referencia previa en 3004, usando datos del selector de cliente:', errRef);
        }

        if (!docNro) {
            const rawCuit = String(clienteSeleccionado?.cuit || '').replace(/\D/g, '');
            const condStr = String(clienteSeleccionado?.condicion_iva || '').toLowerCase();
            if (rawCuit.length === 11) {
                docTipo = 80;
                docNro = rawCuit;
            } else if (rawCuit.length >= 7) {
                docTipo = 96;
                docNro = rawCuit;
            } else {
                docTipo = 99;
                docNro = '0';
            }

            if (condStr.includes('inscripto')) {
                condicionIvaId = 1;
                tipoCbte = 1;
            } else if (condStr.includes('monotrib')) {
                condicionIvaId = 6;
                tipoCbte = 6;
            } else if (condStr.includes('exento')) {
                condicionIvaId = 4;
                tipoCbte = 6;
            } else {
                condicionIvaId = 5;
                tipoCbte = 6;
            }
        }

        const rawDescuento = document.getElementById('descuento')?.value || '0';
        const descuentoPct = Math.min(Math.max(parseFloat(rawDescuento) || 0, 0), 100);
        const descuentoFraccion = parseFloat((descuentoPct / 100).toFixed(4));
        const moverStock = Boolean(document.getElementById('chk-factura-directa-stock')?.checked);
        const hoyYmd = (document.getElementById('fecha')?.value || new Date().toISOString().split('T')[0]).trim();

        // Crear registro administrativo (OMITIDO en depósito) para trazabilidad fiscal
        const detallesPres = rows.map(row => {
            if (row.classList.contains('out-of-stock-row') || row.classList.contains('child-row')) return null;
            const artInput = row.querySelector('input[name*="[articulo]"]');
            const cantInput = row.querySelector('input[name*="[cantidad]"]');
            const val1Input = row.querySelector('input[name*="[valor1]"]');
            const pre1Input = row.querySelector('input[name*="[precio1]"]');
            const iva1Input = row.querySelector('input[name*="[iva1]"]');
            const descAdicInput = row.querySelector('input[name*="[descuento_adicional]"]');
            const cod = (artInput?.dataset?.codigoBarras || artInput?.dataset?.articuloNumero || '').trim();
            const qty = parseFloat(cantInput?.value) || 0;
            if (!cod || qty <= 0) return null;
            return {
                articulo: cod,
                cantidad: qty,
                valor1: parseFloat(val1Input?.value) || 0,
                precio1: parseFloat(pre1Input?.value) || 0,
                iva1: parseFloat(iva1Input?.value) || 21,
                descuento_adicional: parseFloat(descAdicInput?.value) || 0
            };
        }).filter(Boolean);

        const resPres = await fetch('/api/presupuestos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': generateUUID()
            },
            body: JSON.stringify({
                id_cliente: idCliente,
                fecha: hoyYmd,
                fecha_entrega: hoyYmd,
                agente: document.getElementById('agente')?.value || 'Martin',
                tipo_comprobante: 'Factura',
                estado: 'Enviado a Facturación',
                estado_logistico: 'OMITIDO',
                informe_generado: 'Generado',
                secuencia: 'Pedido_Listo',
                usar_precios_bunker: document.getElementById('usar_precios_bunker')?.checked || false,
                nota: (document.getElementById('nota')?.value || 'Comprobante Administrativo Directo (Sin Pedido en Depósito)').toString(),
                punto_entrega: 'Operación Administrativa Directa',
                descuento: descuentoFraccion,
                detalles: detallesPres,
                detalles_sin_stock: []
            })
        });
        const dataPres = await resPres.json();
        if (!resPres.ok || !dataPres.success || !dataPres.data?.id) {
            throw new Error(dataPres.error || dataPres.message || 'No se pudo inicializar el comprobante administrativo.');
        }
        const presupuestoId = dataPres.data.id;

        const payloadFactura = {
            usar_facturador_nuevo: true,
            fecha_presupuesto: hoyYmd,
            presupuesto_id: presupuestoId,
            pto_vta: 32,
            tipo_cbte: tipoCbte,
            concepto: 1,
            requiere_afip: true,
            precio_modo: 'NETO',
            descuento: descuentoPct,
            mover_stock: moverStock,
            stock_descontado: !moverStock,
            cliente: {
                cliente_id: parseInt(idCliente, 10),
                razon_social: clienteSeleccionado?.nombre || 'Cliente',
                doc_tipo: docTipo,
                doc_nro: docNro,
                condicion_iva_id: condicionIvaId
            },
            items: itemsPayload
        };

        const resFac = await fetch('http://localhost:3004/facturacion/facturas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadFactura)
        });
        const dataFac = await resFac.json();

        if (!resFac.ok || !dataFac.success) {
            throw new Error(dataFac.message || dataFac.error || 'No se pudo crear el borrador en la Bandeja de Facturas.');
        }

        const nuevaFacturaId = dataFac.data?.id;
        const totalFmt = Number(dataFac.data?.imp_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        mostrarMensaje(`✅ Factura Borrador #${nuevaFacturaId} ($${totalFmt}) enviada directo a la Bandeja de Facturas (sin pedido en depósito).`, 'success');

        if (confirm(`✅ Factura Borrador #${nuevaFacturaId} ($${totalFmt}) creada en la Bandeja de Facturas ARCA.\n\n¿Desea abrir la Bandeja de Facturas ahora para verificarla o emitir el CAE?`)) {
            window.open('http://localhost:3004/pages/facturas.html', '_blank');
        }
    } catch (err) {
        console.error('❌ [FACTURA-DIRECTA] Error:', err);
        mostrarMensaje(`❌ Error al enviar a Bandeja de Facturas: ${err.message}`, 'error');
        alert(`Error al enviar a Bandeja de Facturas:\n${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

// ======================================================================================
// RENTABILIDAD ESTIMADA (BÚNKER) — REVELADO Y AUDITORÍA COMPLETA EN CREAR PRESUPUESTO
// ======================================================================================
window.conmutarReveladoGanancia = function(el) {
    if (el.style.filter === 'blur(4px)' || el.style.filter === '') {
        el.style.filter = 'none';
        el.style.background = 'transparent';
        el.style.color = '#15803d';

        if (window.timerDifuminarGanancia) clearTimeout(window.timerDifuminarGanancia);
        window.timerDifuminarGanancia = setTimeout(() => {
            el.style.filter = 'blur(4px)';
            el.style.background = '#e2e8f0';
            el.style.color = '#64748b';
        }, 5000);
    } else {
        el.style.filter = 'blur(4px)';
        el.style.background = '#e2e8f0';
        el.style.color = '#64748b';
        if (window.timerDifuminarGanancia) clearTimeout(window.timerDifuminarGanancia);
    }
};

window.__ultimaAuditoriaRentabilidadBunker = null;

function fmtMonedaARCreate(val, dec = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '$ 0,00';
    return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtNumARCreate(val, dec = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '0,00';
    return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function escHtmlAuditCreate(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseNumAuditCreate(val, fallback = 0) {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
    const str = String(val).trim().replace(/\$/g, '').replace(/\s+/g, '');
    const normalized = (str.includes(',') && str.includes('.'))
        ? str.replace(/\./g, '').replace(',', '.')
        : str.replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : fallback;
}

window.recolectarPayloadAuditoriaRentabilidad = function () {
    const clienteId = document.getElementById('id_cliente')?.value || (typeof clienteSeleccionado !== 'undefined' && clienteSeleccionado?.id) || '';
    const clienteNombre = (
        document.getElementById('info-cliente-nombre')?.textContent ||
        document.getElementById('cliente_nombre')?.value ||
        document.getElementById('cliente-nombre-display')?.textContent ||
        (typeof clienteSeleccionado !== 'undefined' && clienteSeleccionado?.nombre) ||
        ''
    ).trim();
    const tipoComprobante = document.getElementById('tipo_comprobante')?.value || 'Factura';
    const fecha = document.getElementById('fecha')?.value || '';
    const [descuentoGeneral] = typeof getDescuentoPorcentaje === 'function'
        ? getDescuentoPorcentaje()
        : [parseNumAuditCreate(document.getElementById('descuento')?.value, 0)];
    const chkBunker = document.getElementById('usar_precios_bunker');
    const usarPreciosBunker = chkBunker ? chkBunker.checked : true;

    const tbody = document.getElementById('detalles-tbody');
    const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];

    const items = rows.map((row, idx) => {
        const inpArt = row.querySelector('input[name*="[articulo]"]');
        const inpDesc = row.querySelector('input[name*="[descripcion]"]');
        const inpCant = row.querySelector('input[name*="[cantidad]"]');
        const inpValor = row.querySelector('input[name*="[valor1]"]');
        const inpPrecio = row.querySelector('input[name*="[precio1]"]');
        const inpIva = row.querySelector('select[name*="[iva1]"], input[name*="[iva1]"]');
        const inpDescEsp = row.querySelector('input[name*="[descuento_adicional]"]');

        const textoArt = inpArt ? inpArt.value.trim() : '';
        const codBarras = (inpArt?.dataset?.codigoBarras || '').trim();
        const artNum = (inpArt?.dataset?.articuloNumero || '').trim();
        const descTexto = inpDesc ? inpDesc.value.trim() : textoArt;

        return {
            orden: idx + 1,
            articulo: artNum || codBarras || textoArt,
            codigo_barras: codBarras || artNum || textoArt,
            articulo_numero: artNum || codBarras || textoArt,
            descripcion: descTexto,
            cantidad: parseNumAuditCreate(inpCant?.value, 0),
            valor1: parseNumAuditCreate(inpValor?.value, 0),
            precio1: parseNumAuditCreate(inpPrecio?.value, 0),
            iva1: parseNumAuditCreate(inpIva?.value, 21),
            descuento_adicional: parseNumAuditCreate(inpDescEsp?.value, 0),
            out_of_stock: row.classList.contains('out-of-stock-row'),
            sin_stock: row.classList.contains('out-of-stock-row'),
            costo_bunker: row.dataset.costoBunker !== undefined ? parseFloat(row.dataset.costoBunker) : undefined,
            costo_tiempo_bunker: row.dataset.costoTiempoBunker !== undefined ? parseFloat(row.dataset.costoTiempoBunker) : undefined,
            ganancia_bunker_base: row.dataset.gananciaBunker !== undefined ? parseFloat(row.dataset.gananciaBunker) : undefined
        };
    }).filter(it => it.articulo || it.descripcion || it.cantidad > 0);

    return {
        presupuesto_id: 'Nuevo (En creación)',
        id_cliente: clienteId,
        cliente_id: clienteId,
        cliente_nombre: clienteNombre,
        tipo_comprobante: tipoComprobante,
        fecha,
        descuento_general: descuentoGeneral,
        descuento_general_pct: descuentoGeneral,
        usar_precios_bunker: usarPreciosBunker,
        items
    };
};

window.construirHTMLContenidoAuditoriaBunker = function (data) {
    const enc = data.cabecera || data.encabezado || {};
    const tot = data.totales || {};
    const filas = Array.isArray(data.filas) ? data.filas : (Array.isArray(data.items) ? data.items : []);
    const fechaGen = enc.fecha_auditoria ? new Date(enc.fecha_auditoria).toLocaleString('es-AR') : new Date().toLocaleString('es-AR');
    const totalUnidades = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0);

    const etiquetaFlujo = (f) => {
        const trz = f.trazabilidad || {};
        const rec = trz.receta_ingredientes || [];
        if (rec.some(r => r.detalle_origen?.articulo_puente?.sub_receta?.some(sr => sr.composicion_mix?.length > 0))) {
            return 'Flujo 3: Mezcla Interna (Mix) → Fraccionado';
        }
        if (rec.length > 0) {
            return 'Flujo 2: Fraccionado Local c/Receta';
        }
        if (trz.lote_vinculado) {
            return 'Flujo 1: Bulto Cerrado (Lote Directo)';
        }
        return trz.metodo_costo_base || 'Costo Base Búnker';
    };

    const rowsTablaHTML = filas.map(f => {
        const trz = f.trazabilidad || {};
        const obs = Array.isArray(trz.observaciones) ? trz.observaciones : [];
        const trStyle = f.orden % 2 === 0 ? 'background:#f8fafc;' : 'background:#ffffff;';
        const ganColor = f.ganancia_total_fila >= 0 ? '#15803d' : '#dc2626';
        const codigoMostrar = f.articulo_id_bunker || f.articulo_numero || f.codigo_barras || '-';
        const subCodigo = (f.codigo_barras && f.codigo_barras !== codigoMostrar) ? ` (${f.codigo_barras})` : '';
        const alertasBadge = obs.length > 0
            ? `<div style="margin-top:3px;"><span style="background:#fef3c7; color:#92400e; border:1px solid #f59e0b; border-radius:4px; padding:1px 5px; font-size:0.72rem; font-weight:600;">⚠️ ${obs.length} nota(s) de auditoría</span></div>`
            : '';

        const lineaCostoBulto = (Number(f.costo_bulto_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaCostoMO = (Number(f.costo_tiempo_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaIvaVenta = (Number(f.iva_venta_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaIvaCompra = (Number(f.iva_compra_unitario) || 0) * (Number(f.cantidad) || 0);

        return `
            <tr style="${trStyle} border-bottom:1px solid #e2e8f0;">
                <td style="padding:7px 6px; text-align:center; font-weight:600; color:#475569;">${f.orden}</td>
                <td style="padding:7px 8px;">
                    <div style="font-weight:700; color:#0f172a; font-family:monospace; font-size:0.86rem;">${escHtmlAuditCreate(codigoMostrar)}<span style="color:#64748b; font-weight:400; font-size:0.75rem;">${escHtmlAuditCreate(subCodigo)}</span></div>
                    <div style="color:#334155; font-size:0.8rem;">${escHtmlAuditCreate(f.descripcion)}</div>
                    <div style="color:#64748b; font-size:0.72rem; margin-top:2px;">
                        Bulto: <strong>${fmtNumARCreate(f.kilos_unidad, 2)} kg</strong> | ${escHtmlAuditCreate(etiquetaFlujo(f))}
                    </div>
                    ${alertasBadge}
                </td>
                <td style="padding:7px 6px; text-align:right; font-weight:700;">${fmtNumARCreate(f.cantidad, 2)}</td>
                <td style="padding:7px 6px; text-align:right;">${fmtMonedaARCreate(f.precio_unitario_c_iva_sin_desc)}</td>
                <td style="padding:7px 6px; text-align:right; color:#b45309;">${fmtNumARCreate(f.descuento_total_pct, 2)}%</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600;">${fmtMonedaARCreate(f.subtotal_c_iva_con_desc)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600; color:#0369a1; background:#f0f9ff;">${fmtMonedaARCreate(f.subtotal_neto_s_iva_con_desc)}</td>
                <td style="padding:7px 6px; text-align:right; color:#be123c; background:#fff1f2;">${fmtMonedaARCreate(lineaCostoBulto)}</td>
                <td style="padding:7px 6px; text-align:right; color:#9f1239; background:#fff1f2;">${fmtMonedaARCreate(lineaCostoMO)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600; color:#881337; background:#ffe4e6;">${fmtMonedaARCreate(f.costo_operativo_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; color:#6d28d9;">${fmtMonedaARCreate(f.iibb_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; color:#7c2d12;" title="IVA Venta (${fmtMonedaARCreate(lineaIvaVenta)}) - IVA Compra 21% s/Bulto (${fmtMonedaARCreate(lineaIvaCompra)})">${fmtMonedaARCreate(f.diferencia_iva_total_fila)}</td>
                <td style="padding:7px 8px; text-align:right; font-weight:800; color:${ganColor}; background:#f0fdf4; font-size:0.9rem;">${fmtMonedaARCreate(f.ganancia_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:700; color:${ganColor};">${fmtNumARCreate(f.margen_real_sobre_neto_pct, 2)}%</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="auditoria-bunker-report" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#0f172a;">
            <div style="background:#0f172a; color:#ffffff; padding:14px 18px; border-radius:8px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:0.74rem; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; font-weight:700;">
                        Sistema LAMDA — Auditoría y Trazabilidad de Rentabilidad Estimada (Búnker)
                    </div>
                    <div style="font-size:1.15rem; font-weight:800; margin-top:2px;">
                        Cliente: ${escHtmlAuditCreate(enc.cliente_nombre || 'Sin especificar')}
                        ${enc.cliente_id ? `<span style="font-weight:400; color:#cbd5e1; font-size:0.9rem;">(ID #${escHtmlAuditCreate(enc.cliente_id)})</span>` : ''}
                    </div>
                    <div style="font-size:0.82rem; color:#cbd5e1; margin-top:4px;">
                        Presupuesto: <strong>${escHtmlAuditCreate(enc.presupuesto_id || 'En creación')}</strong> |
                        Comprobante: <strong>${escHtmlAuditCreate(enc.tipo_comprobante || '-')}</strong> |
                        Lista Búnker Aplicada: <strong>#${escHtmlAuditCreate(enc.lista_bunker_id || '-')} (${escHtmlAuditCreate(enc.lista_bunker_nombre || '-')})</strong> |
                        Descuento General: <strong>${fmtNumARCreate(enc.descuento_general_pct, 2)}%</strong>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.75rem; color:#94a3b8;">RENTABILIDAD NETA ESTIMADA (BÚNKER)</div>
                    <div style="font-size:1.55rem; font-weight:900; color:#4ade80;">${fmtMonedaARCreate(tot.rentabilidad_estimada_bunker)}</div>
                    <div style="font-size:0.75rem; color:#cbd5e1;">
                        Margen: <strong>${fmtNumARCreate(tot.margen_neto_sobre_venta_neta_pct, 2)}%</strong> s/Venta Neta (${fmtNumARCreate(tot.margen_neto_sobre_total_final_pct, 2)}% s/Total c/IVA)
                    </div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:14px;">
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#64748b; font-weight:700;">SUBTOTAL BRUTO (c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#334155;">${fmtMonedaARCreate(tot.subtotal_bruto_c_iva)}</div>
                    <div style="font-size:0.71rem; color:#b45309;">Desc: -${fmtMonedaARCreate((tot.descuento_general_monto || 0) + (tot.descuentos_especiales_monto || 0))}</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#64748b; font-weight:700;">TOTAL PRESUPUESTO (c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#0f172a;">${fmtMonedaARCreate(tot.total_final_c_iva)}</div>
                    <div style="font-size:0.71rem; color:#64748b;">IVA Venta: ${fmtMonedaARCreate(tot.total_iva_venta)}</div>
                </div>
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#0369a1; font-weight:700;">(+) VENTA NETA (s/IVA c/Desc)</div>
                    <div style="font-size:1rem; font-weight:800; color:#0369a1;">${fmtMonedaARCreate(tot.total_neto_s_iva_con_desc)}</div>
                    <div style="font-size:0.71rem; color:#0284c7;">Base real de ingreso</div>
                </div>
                <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#be123c; font-weight:700;">(-) COSTO OPERATIVO TOTAL</div>
                    <div style="font-size:1rem; font-weight:800; color:#be123c;">-${fmtMonedaARCreate(tot.total_costo_operativo)}</div>
                    <div style="font-size:0.7rem; color:#9f1239;">Bultos: ${fmtMonedaARCreate(tot.total_costo_bulto)} | MO: ${fmtMonedaARCreate(tot.total_costo_tiempo)}</div>
                </div>
                <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#6d28d9; font-weight:700;">(-) IIBB (4% s/Final c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#6d28d9;">-${fmtMonedaARCreate(tot.total_iibb)}</div>
                    <div style="font-size:0.7rem; color:#7c3aed;">4% sobre ${fmtMonedaARCreate(tot.total_final_c_iva)}</div>
                </div>
                <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#9a3412; font-weight:700;">(-) DIFERENCIA IVA</div>
                    <div style="font-size:1rem; font-weight:800; color:#9a3412;">-${fmtMonedaARCreate(tot.total_diferencia_iva)}</div>
                    <div style="font-size:0.7rem; color:#c2410c;">IVA Vta (${fmtMonedaARCreate(tot.total_iva_venta)}) - Cpra (${fmtMonedaARCreate(tot.total_iva_compra)})</div>
                </div>
                <div style="background:#f0fdf4; border:2px solid #22c55e; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#15803d; font-weight:800;">(=) RENTABILIDAD BÚNKER</div>
                    <div style="font-size:1.08rem; font-weight:900; color:#15803d;">${fmtMonedaARCreate(tot.rentabilidad_estimada_bunker)}</div>
                    <div style="font-size:0.7rem; color:#166534;">Emitido: ${escHtmlAuditCreate(fechaGen)}</div>
                </div>
            </div>

            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-left:4px solid #0284c7; border-radius:6px; padding:8px 12px; margin-bottom:14px; font-size:0.79rem; color:#334155;">
                <strong>📐 Fórmula Exacta del Motor de Rentabilidad Búnker (por línea):</strong><br>
                <code>Rentabilidad Fila = Venta Neta s/IVA (c/Desc) − Costo Bulto (Mercadería + Envase) − Mano de Obra Directa − IIBB (4% s/Precio Final c/IVA) − Máx(0, IVA Venta − IVA Compra 21% s/Costo Bulto)</code>
            </div>

            <h3 style="margin:0 0 8px 0; font-size:0.95rem; color:#0f172a; border-bottom:2px solid #0f172a; padding-bottom:4px;">
                Planilla de Desglose por Producto (Conciliación de los ${fmtMonedaARCreate(tot.rentabilidad_estimada_bunker)})
            </h3>
            <div style="overflow-x:auto; margin-bottom:18px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.78rem; border:1px solid #cbd5e1;">
                    <thead>
                        <tr style="background:#1e293b; color:#ffffff;">
                            <th style="padding:7px 6px; text-align:center;">#</th>
                            <th style="padding:7px 8px; text-align:left;">Artículo / Flujo</th>
                            <th style="padding:7px 6px; text-align:right;">Cant.</th>
                            <th style="padding:7px 6px; text-align:right;">P.Unit Lista (c/IVA)</th>
                            <th style="padding:7px 6px; text-align:right;">Desc.%</th>
                            <th style="padding:7px 6px; text-align:right;">Total Final (c/IVA)</th>
                            <th style="padding:7px 6px; text-align:right; background:#0c4a6e;">(+) Venta Neta (s/IVA)</th>
                            <th style="padding:7px 6px; text-align:right; background:#881337;">(-) Costo Bulto</th>
                            <th style="padding:7px 6px; text-align:right; background:#881337;">(-) Mano Obra</th>
                            <th style="padding:7px 6px; text-align:right; background:#4c0519;">(=) Costo Oper.</th>
                            <th style="padding:7px 6px; text-align:right;">(-) IIBB 4%</th>
                            <th style="padding:7px 6px; text-align:right;">(-) Dif. IVA</th>
                            <th style="padding:7px 8px; text-align:right; background:#14532d;">(=) Ganancia Fila</th>
                            <th style="padding:7px 6px; text-align:right;">Margen</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsTablaHTML}
                    </tbody>
                    <tfoot>
                        <tr style="background:#0f172a; color:#ffffff; font-weight:800; font-size:0.82rem;">
                            <td colspan="2" style="padding:8px; text-align:left;">TOTALES CONCILIADOS DEL PRESUPUESTO</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtNumARCreate(totalUnidades, 2)}</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtMonedaARCreate(tot.subtotal_bruto_c_iva)}</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtNumARCreate(enc.descuento_general_pct, 2)}%</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtMonedaARCreate(tot.total_final_c_iva)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#7dd3fc;">${fmtMonedaARCreate(tot.total_neto_s_iva_con_desc)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fda4af;">${fmtMonedaARCreate(tot.total_costo_bulto)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fda4af;">${fmtMonedaARCreate(tot.total_costo_tiempo)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fecdd3;">${fmtMonedaARCreate(tot.total_costo_operativo)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#ddd6fe;">${fmtMonedaARCreate(tot.total_iibb)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fed7aa;">${fmtMonedaARCreate(tot.total_diferencia_iva)}</td>
                            <td style="padding:8px 8px; text-align:right; color:#4ade80; font-size:0.95rem;">${fmtMonedaARCreate(tot.rentabilidad_estimada_bunker)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#4ade80;">${fmtNumARCreate(tot.margen_neto_sobre_venta_neta_pct, 2)}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
};

window.abrirModalAuditoriaRentabilidadBunker = async function () {
    let modal = document.getElementById('modal-auditoria-rentabilidad-bunker');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-auditoria-rentabilidad-bunker';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.72); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(2px);';
        modal.innerHTML = `
            <div style="background:#ffffff; width:96%; max-width:1360px; max-height:92vh; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.45); display:flex; flex-direction:column; overflow:hidden; border:1px solid #cbd5e1;">
                <div style="background:#1e293b; color:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid #334155;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:1.3rem;">🔎</span>
                        <div>
                            <div style="font-weight:800; font-size:1rem;">Auditoría y Trazabilidad de Rentabilidad Estimada (Búnker)</div>
                            <div style="font-size:0.76rem; color:#94a3b8;">Desglose línea por línea de ingresos netos, recetas, lotes, mano de obra e impuestos</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <button type="button" onclick="document.getElementById('modal-auditoria-rentabilidad-bunker').style.display='none'" style="background:#475569; color:#ffffff; border:none; border-radius:6px; padding:7px 12px; font-weight:700; font-size:0.82rem; cursor:pointer;">
                            ✕ Cerrar
                        </button>
                    </div>
                </div>
                <div id="modal-auditoria-rentabilidad-body" style="padding:16px 20px; overflow-y:auto; flex:1; background:#f8fafc;">
                    <div style="text-align:center; padding:40px; color:#475569;">⏳ Calculando trazabilidad de costos y rentabilidad Búnker...</div>
                </div>
            </div>
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
        document.body.appendChild(modal);
    }

    const bodyEl = document.getElementById('modal-auditoria-rentabilidad-body');
    modal.style.display = 'flex';
    bodyEl.innerHTML = `<div style="text-align:center; padding:40px; color:#475569; font-weight:600;">⏳ Auditando artículos, recetas, lotes y costos operativos del presupuesto...</div>`;

    try {
        const payload = window.recolectarPayloadAuditoriaRentabilidad();
        const resp = await fetch('/api/presupuestos/auditoria-rentabilidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
            throw new Error(json.message || json.error || 'No se pudo obtener la auditoría de rentabilidad');
        }
        window.__ultimaAuditoriaRentabilidadBunker = json.data;
        bodyEl.innerHTML = window.construirHTMLContenidoAuditoriaBunker(json.data, false);
    } catch (err) {
        console.error('❌ [AUDITORIA-RENTABILIDAD] Error:', err);
        bodyEl.innerHTML = `
            <div style="background:#fef2f2; border:1px solid #ef4444; color:#991b1b; padding:16px; border-radius:8px;">
                <strong>❌ Error al generar el informe de auditoría:</strong> ${escHtmlAuditCreate(err.message)}
            </div>
        `;
    }
};

