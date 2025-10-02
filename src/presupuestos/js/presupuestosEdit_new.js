console.log('🔍 [PRESUPUESTOS-EDIT] Cargando módulo de edición de presupuestos...');

// Variables globales
let presupuestoId = null;
let presupuestoData = null;
let detallesData = [];
let detalleCounter = 0;
let clienteSeleccionado = null;
let currentRequest = null;
let selectedIndex = -1;

// Exponer funciones usadas por atributos inline (onclick)
window.agregarDetalle = agregarDetalle;
window.removerDetalle = removerDetalle;
window.seleccionarArticuloPorClick = seleccionarArticuloPorClick;
window.seleccionarArticulo = seleccionarArticulo;
window.seleccionarClientePorClick = seleccionarClientePorClick;

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
function applyIvaModeToAllRows() {
  document.querySelectorAll('#detalles-tbody tr').forEach(applyIvaModeToRow);
  recalcTotales();
}

function getClienteIdActivo() {
  if (clienteSeleccionado && clienteSeleccionado.cliente_id) {
    return String(clienteSeleccionado.cliente_id);
  }
  const raw = (document.getElementById('id_cliente')?.value || '').trim();
  const m = raw.match(/^\d+/);
  return m ? m[0] : '0';
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('📋 [PRESUPUESTOS-EDIT] Inicializando página de edición...');

    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');

    if (!presupuestoId) {
        mostrarMensaje('❌ No se especificó el ID del presupuesto a editar', 'error');
        setTimeout(() => {
            window.location.href = '/pages/presupuestos.html';
        }, 3000);
        return;
    }

    console.log(`📋 [PRESUPUESTOS-EDIT] ID del presupuesto: ${presupuestoId}`);

    // --- FECHA base primero (evita TDZ) ---
    const fechaInput = document.getElementById('fecha');
    const today = new Date().toISOString().split('T')[0];
    if (fechaInput) {
        fechaInput.value = fechaInput.value || today;
    } else {
        console.warn('⚠️ [PRESUPUESTOS-EDIT] Input #fecha no encontrado; se enviará fecha del día desde JS');
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
            console.log('[PRESUPUESTOS-EDIT] Tipo comprobante →', tipoSel.value);
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

    // Configurar formulario
    const form = document.getElementById('form-editar-presupuesto');
    if (form) {
        form.addEventListener('submit', handleSubmit);
    } else {
        console.error('❌ [PRESUPUESTOS-EDIT] Formulario #form-editar-presupuesto no encontrado');
    }

    // Configurar autocompletar de clientes
    setupClienteAutocomplete();

    // Configurar autocompletar para artículos
    setupArticuloAutocomplete();

    // Cargar datos del presupuesto
    cargarPresupuesto();

    console.log('✅ [PRESUPUESTOS-EDIT] Página inicializada correctamente');
});

/**
 * Cargar datos del presupuesto
 */
async function cargarPresupuesto() {
    console.log(`📥 [PRESUPUESTOS-EDIT] Cargando datos del presupuesto ${presupuestoId}...`);

    try {
        // Obtener datos del presupuesto
        const response = await fetch(`/api/presupuestos/${presupuestoId}`);
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al cargar el presupuesto');
        }

        presupuestoData = result.data;
        console.log('📋 [PRESUPUESTOS-EDIT] Datos del presupuesto cargados:', presupuestoData);

        // Llenar información de solo lectura
        llenarInformacionPresupuesto();

        // Llenar campos editables
        llenarCamposEditables();

        // Obtener detalles del presupuesto
        await cargarDetallesPresupuesto();

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar presupuesto:', error);
        mostrarMensaje(`❌ Error al cargar el presupuesto: ${error.message}`, 'error');
    }
}

/**
 * Cargar detalles del presupuesto
 */
async function cargarDetallesPresupuesto() {
    console.log(`📦 [PRESUPUESTOS-EDIT] Cargando detalles del presupuesto ${presupuestoId}...`);

    try {
        const response = await fetch(`/api/presupuestos/${presupuestoId}/detalles`);
        const result = await response.json();

        if (response.ok && result.success) {
            detallesData = result.data || [];
            const detallesCount = detallesData.length;
            document.getElementById('info-detalles').textContent = `${detallesCount} artículos`;
            console.log(`📦 [PRESUPUESTOS-EDIT] Detalles cargados: ${detallesCount} artículos`);
            renderDetallesTable();
        } else {
            console.warn('⚠️ [PRESUPUESTOS-EDIT] No se pudieron cargar los detalles');
            document.getElementById('info-detalles').textContent = 'No disponible';
        }

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar detalles:', error);
        document.getElementById('info-detalles').textContent = 'Error al cargar';
    }
}

/**
 * Llenar información de solo lectura
 */
function llenarInformacionPresupuesto() {
    console.log('📋 [PRESUPUESTOS-EDIT] Llenando información del presupuesto...');

    document.getElementById('info-id').textContent = presupuestoData.id_presupuesto_ext || presupuestoData.id || '-';
    document.getElementById('info-cliente').textContent = presupuestoData.id_cliente || '-';
    document.getElementById('info-fecha').textContent = formatearFecha(presupuestoData.fecha) || '-';
    document.getElementById('info-estado').textContent = presupuestoData.estado || '-';
    document.getElementById('info-tipo').textContent = presupuestoData.tipo_comprobante || '-';
}

/**
 * Llenar campos editables con datos actuales
 */
function llenarCamposEditables() {
    console.log('✏️ [PRESUPUESTOS-EDIT] Llenando campos editables...');

    document.getElementById('id_cliente').value = presupuestoData.id_cliente || '';
    document.getElementById('fecha').value = presupuestoData.fecha ? presupuestoData.fecha.split('T')[0] : '';
    document.getElementById('tipo_comprobante').value = presupuestoData.tipo_comprobante || 'Factura';
    document.getElementById('estado').value = presupuestoData.estado || 'Presupuesto/Orden';
    document.getElementById('agente').value = presupuestoData.agente || '';
    document.getElementById('punto_entrega').value = presupuestoData.punto_entrega || '';
    document.getElementById('descuento').value = presupuestoData.descuento || '';
    document.getElementById('nota').value = presupuestoData.nota || '';

    // Fecha de entrega (convertir formato si es necesario)
    if (presupuestoData.fecha_entrega) {
        const fechaEntrega = new Date(presupuestoData.fecha_entrega);
        if (!isNaN(fechaEntrega.getTime())) {
            document.getElementById('fecha_entrega').value = fechaEntrega.toISOString().split('T')[0];
        }
    }
}

/**
 * Formatear fecha para mostrar
 */
function formatearFecha(fecha) {
    if (!fecha) return null;

    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return fecha; // Si no es válida, devolver original

        return date.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch (error) {
        return fecha;
    }
}

/**
 * Renderizar tabla de detalles con inputs editables
 */
function renderDetallesTable() {
    const tbody = document.getElementById('detalles-tbody');
    tbody.innerHTML = '';

    detallesData.forEach((detalle, index) => {
        const tr = document.createElement('tr');

        // Artículo (input text)
        const tdArticulo = document.createElement('td');
        const inputArticulo = document.createElement('input');
        inputArticulo.type = 'text';
        inputArticulo.value = detalle.articulo || '';
        inputArticulo.required = true;
        inputArticulo.dataset.index = index;
        inputArticulo.name = `articulo_${index}`;
        inputArticulo.addEventListener('change', handleDetalleChange);
        tdArticulo.appendChild(inputArticulo);
        tr.appendChild(tdArticulo);

        // Cantidad (input number)
        const tdCantidad = document.createElement('td');
        const inputCantidad = document.createElement('input');
        inputCantidad.type = 'number';
        inputCantidad.min = '0';
        inputCantidad.step = 'any';
        inputCantidad.value = detalle.cantidad || 0;
        inputCantidad.required = true;
        inputCantidad.dataset.index = index;
        inputCantidad.name = `cantidad_${index}`;
        inputCantidad.addEventListener('change', handleDetalleChange);
        tdCantidad.appendChild(inputCantidad);
        tr.appendChild(tdCantidad);

        // Valor Unitario (input number)
        const tdValorUnitario = document.createElement('td');
        const inputValorUnitario = document.createElement('input');
        inputValorUnitario.type = 'number';
        inputValorUnitario.min = '0';
        inputValorUnitario.step = 'any';
        inputValorUnitario.value = detalle.valor1 || 0;
        inputValorUnitario.required = true;
        inputValorUnitario.dataset.index = index;
        inputValorUnitario.name = `valor1_${index}`;
        inputValorUnitario.addEventListener('change', handleDetalleChange);
        tdValorUnitario.appendChild(inputValorUnitario);
        tr.appendChild(tdValorUnitario);

        // IVA % (input number)
        const tdIva = document.createElement('td');
        const inputIva = document.createElement('input');
        inputIva.type = 'number';
        inputIva.min = '0';
        inputIva.max = '100';
        inputIva.step = 'any';
        inputIva.value = detalle.iva1 ? (detalle.iva1 * 100).toFixed(2) : '0.00';
        inputIva.required = true;
        inputIva.dataset.index = index;
        inputIva.name = `iva1_${index}`;
        inputIva.addEventListener('change', handleDetalleChange);
        tdIva.appendChild(inputIva);
        tr.appendChild(tdIva);

        // Precio c/IVA (calculado, read-only)
        const tdPrecioConIva = document.createElement('td');
        tdPrecioConIva.className = 'precio-calculado';
        const precioConIva = calcularPrecioConIva(detalle.valor1, detalle.iva1);
        tdPrecioConIva.textContent = precioConIva.toFixed(2);
        tr.appendChild(tdPrecioConIva);

        // Subtotal (calculado, read-only)
        const tdSubtotal = document.createElement('td');
        tdSubtotal.className = 'precio-calculado';
        const subtotal = calcularSubtotal(detalle.cantidad, detalle.valor1, detalle.iva1);
        tdSubtotal.textContent = subtotal.toFixed(2);
        tr.appendChild(tdSubtotal);

        // Acciones (botón eliminar)
        const tdAcciones = document.createElement('td');
        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.className = 'btn-remove-detalle';
        btnEliminar.textContent = 'Eliminar';
        btnEliminar.dataset.index = index;
        btnEliminar.addEventListener('click', eliminarDetalle);
        tdAcciones.appendChild(btnEliminar);
        tr.appendChild(tdAcciones);

        tbody.appendChild(tr);
    });
}

/**
 * Calcular precio con IVA unitario
 */
function calcularPrecioConIva(valorUnitario, ivaDecimal) {
    const v = parseFloat(valorUnitario) || 0;
    const iva = parseFloat(ivaDecimal) || 0;
    return v + (v * iva);
}

/**
 * Calcular subtotal (cantidad * precio con IVA)
 */
function calcularSubtotal(cantidad, valorUnitario, ivaDecimal) {
    const c = parseFloat(cantidad) || 0;
    const precioConIva = calcularPrecioConIva(valorUnitario, ivaDecimal);
    return c * precioConIva;
}

/**
 * Manejar cambios en inputs de detalles para actualizar datos y recalcular
 */
function handleDetalleChange(event) {
    const index = parseInt(event.target.dataset.index);
    if (isNaN(index) || index < 0 || index >= detallesData.length) return;

    const name = event.target.name;
    const value = event.target.value;

    if (name.startsWith('articulo_')) {
        detallesData[index].articulo = value.trim();
    } else if (name.startsWith('cantidad_')) {
        detallesData[index].cantidad = parseFloat(value) || 0;
    } else if (name.startsWith('valor1_')) {
        detallesData[index].valor1 = parseFloat(value) || 0;
    } else if (name.startsWith('iva1_')) {
        detallesData[index].iva1 = (parseFloat(value) || 0) / 100;
    }

    renderDetallesTable();
}

/**
 * Agregar nuevo detalle vacío
 */
function agregarDetalle() {
    detallesData.push({
        articulo: '',
        cantidad: 0,
        valor1: 0,
        iva1: 0
    });
    renderDetallesTable();
}

/**
 * Eliminar detalle por índice
 */
function eliminarDetalle(event) {
    const index = parseInt(event.target.dataset.index);
    if (isNaN(index) || index < 0 || index >= detallesData.length) return;

    detallesData.splice(index, 1);
    renderDetallesTable();
}

/**
 * Agregar nueva fila de detalle
 */
function agregarDetalle() {
    console.log('📦 [PRESUPUESTOS-EDIT] Agregando nueva fila de detalle...');

    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) {
        console.error('❌ [PRESUPUESTOS-EDIT] #detalles-tbody no existe, no se puede agregar detalle');
        return;
    }

    detalleCounter++;
    const row = document.createElement('tr');
    row.id = `detalle-${detalleCounter}`;

    row.innerHTML = `
                <td>
                    <input type="text" name="detalles[${detalleCounter}][articulo]"
                        placeholder="Código o descripción del artículo" required>
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][cantidad]"
                        min="0.01" step="0.01" placeholder="1" required
                        onchange="calcularPrecio(${detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${detalleCounter}][valor1]"
                        min="0" step="0.01" placeholder="0.00" required
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
                            onclick="removerDetalle(${detalleCounter})"
                            ${tbody.children.length === 0 ? 'disabled' : ''}>
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

    console.log(`✅ [PRESUPUESTOS-EDIT] Detalle ${detalleCounter} agregado`);
}

/**
 * Remover fila de detalle
 */
function removerDetalle(id) {
    console.log(`🗑️ [PRESUPUESTOS-EDIT] Removiendo detalle ${id}...`);

    const row = document.getElementById(`detalle-${id}`);
    const tbody = document.getElementById('detalles-tbody');

    if (!tbody) {
        console.error('❌ [PRESUPUESTOS-EDIT] #detalles-tbody no existe');
        return;
    }

    // No permitir eliminar si es la única fila
    if (tbody.children.length <= 1) {
        mostrarMensaje('Debe mantener al menos un artículo en el presupuesto', 'error');
        return;
    }

    if (row) {
        row.remove();
        console.log(`✅ [PRESUPUESTOS-EDIT] Detalle ${id} removido`);
    }
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

    console.log(`💰 [PRESUPUESTOS-EDIT] Precio calculado para detalle ${detalleId}: ${precioUnitario.toFixed(2)}`);
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
  } catch (_) {}
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
    const pvu  = parseFloat(row.querySelector('input[name*="[precio1]"]')?.value) || 0; // precio unit. con IVA
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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Configurar autocompletado de clientes
 */
function setupClienteAutocomplete() {
    console.log('👥 [PRESUPUESTOS-EDIT] Configurando autocompletado de clientes...');

    const input = document.getElementById('id_cliente');
    const sugerenciasDiv = document.getElementById('cliente-sugerencias');

    if (!input || !sugerenciasDiv) {
        console.warn('⚠️ [PRESUPUESTOS-EDIT] Elementos de autocompletado de clientes no encontrados');
        return;
    }

    let debounceTimer;

    input.addEventListener('input', function(e) {
        const query = e.target.value.trim();

        // Limpiar timer anterior
        clearTimeout(debounceTimer);

        // Ocultar sugerencias si está vacío
        if (!query) {
            sugerenciasDiv.style.display = 'none';
            return;
        }

        // Debounce para evitar demasiadas peticiones
        debounceTimer = setTimeout(async () => {
            try {
                console.log(`🔍 [PRESUPUESTOS-EDIT] Buscando clientes: "${query}"`);

                // Cancelar petición anterior si existe
                if (currentRequest) {
                    currentRequest.abort();
                }

                currentRequest = new AbortController();
                const response = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(query)}`, {
                    signal: currentRequest.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const result = await response.json();

                if (result.success && result.data && result.data.length > 0) {
                    mostrarSugerenciasClientes(result.data);
                } else {
                    mostrarSugerenciasClientes([]);
                }

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('❌ [PRESUPUESTOS-EDIT] Error al buscar clientes:', error);
                    mostrarSugerenciasClientes([]);
                }
            }
        }, 300);
    });

    // Ocultar sugerencias al hacer click fuera
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !sugerenciasDiv.contains(e.target)) {
            sugerenciasDiv.style.display = 'none';
        }
    });

    // Navegación por teclado
    input.addEventListener('keydown', function(e) {
        const items = sugerenciasDiv.querySelectorAll('.cliente-sugerencia-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            actualizarSeleccionCliente();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            actualizarSeleccionCliente();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            items[selectedIndex].click();
        } else if (e.key === 'Escape') {
            sugerenciasDiv.style.display = 'none';
            selectedIndex = -1;
        }
    });

    console.log('✅ [PRESUPUESTOS-EDIT] Autocompletado de clientes configurado');
}

/**
 * Mostrar sugerencias de clientes
 */
function mostrarSugerenciasClientes(clientes) {
    const sugerenciasDiv = document.getElementById('cliente-sugerencias');

    if (!clientes || clientes.length === 0) {
        sugerenciasDiv.innerHTML = '<div class="cliente-sin-resultados">No se encontraron clientes</div>';
        sugerenciasDiv.style.display = 'block';
        return;
    }

    sugerenciasDiv.innerHTML = clientes.map(cliente => `
        <div class="cliente-sugerencia-item" onclick="seleccionarClientePorClick('${cliente.cliente_id}', '${cliente.nombre || ''}', '${cliente.cuit || ''}')">
            <div class="cliente-numero">${cliente.cliente_id}</div>
            <div class="cliente-nombre">${cliente.nombre || 'Sin nombre'}</div>
            <div class="cliente-cuit">${cliente.cuit || 'Sin CUIT'}</div>
        </div>
    `).join('');

    sugerenciasDiv.style.display = 'block';
    selectedIndex = -1;
}

/**
 * Actualizar selección visual en sugerencias de clientes
 */
function actualizarSeleccionCliente() {
    const items = document.querySelectorAll('.cliente-sugerencia-item');
    items.forEach((item, index) => {
        if (index === selectedIndex) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

/**
 * Seleccionar cliente por click
 */
function seleccionarClientePorClick(clienteId, nombre, cuit) {
    console.log(`👥 [PRESUPUESTOS-EDIT] Cliente seleccionado: ${clienteId} - ${nombre}`);

    const input = document.getElementById('id_cliente');
    const sugerenciasDiv = document.getElementById('cliente-sugerencias');

    // Actualizar input con ID del cliente
    input.value = clienteId;

    // Guardar cliente seleccionado
    clienteSeleccionado = {
        cliente_id: clienteId,
        nombre: nombre,
        cuit: cuit
    };

    // Ocultar sugerencias
    sugerenciasDiv.style.display = 'none';

    // Mostrar mensaje de éxito
    mostrarMensaje(`Cliente seleccionado: ${nombre}`, 'success');
}

/**
 * Configurar autocompletado de artículos
 */
function setupArticuloAutocomplete() {
    console.log('📦 [PRESUPUESTOS-EDIT] Configurando autocompletado de artículos...');

    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) {
        console.warn('⚠️ [PRESUPUESTOS-EDIT] #detalles-tbody no encontrado para autocompletado de artículos');
        return;
    }

    // Usar event delegation para inputs de artículos
    tbody.addEventListener('input', function(e) {
        if (e.target.matches('input[name*="[articulo]"]')) {
            handleArticuloInput(e.target);
        }
    });

    tbody.addEventListener('keydown', function(e) {
        if (e.target.matches('input[name*="[articulo]"]')) {
            handleArticuloKeydown(e);
        }
    });

    // Ocultar sugerencias al hacer click fuera
    document.addEventListener('click', function(e) {
        if (!e.target.matches('input[name*="[articulo]"]')) {
            ocultarTodasLasSugerenciasArticulos();
        }
    });

    console.log('✅ [PRESUPUESTOS-EDIT] Autocompletado de artículos configurado');
}

/**
 * Manejar input en campo de artículo
 */
function handleArticuloInput(input) {
    const query = input.value.trim();
    const detalleId = getDetalleIdFromInput(input);

    // Limpiar timer anterior
    clearTimeout(input.debounceTimer);

    // Ocultar sugerencias si está vacío
    if (!query) {
        ocultarSugerenciasArticulo(detalleId);
        return;
    }

    // Debounce para evitar demasiadas peticiones
    input.debounceTimer = setTimeout(async () => {
        try {
            console.log(`🔍 [PRESUPUESTOS-EDIT] Buscando artículos: "${query}"`);

            // Cancelar petición anterior si existe
            if (currentRequest) {
                currentRequest.abort();
            }

            currentRequest = new AbortController();
            const response = await fetch(`/api/articulos/buscar?q=${encodeURIComponent(query)}`, {
                signal: currentRequest.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.success && result.data && result.data.length > 0) {
                mostrarSugerenciasArticulos(detalleId, result.data);
            } else {
                mostrarSugerenciasArticulos(detalleId, []);
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('❌ [PRESUPUESTOS-EDIT] Error al buscar artículos:', error);
                mostrarSugerenciasArticulos(detalleId, []);
            }
        }
    }, 300);
}

/**
 * Manejar navegación por teclado en artículos
 */
function handleArticuloKeydown(e) {
    const input = e.target;
    const detalleId = getDetalleIdFromInput(input);
    const sugerenciasDiv = document.getElementById(`articulo-sugerencias-${detalleId}`);

    if (!sugerenciasDiv || sugerenciasDiv.style.display === 'none') return;

    const items = sugerenciasDiv.querySelectorAll('.articulo-sugerencia-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        actualizarSeleccionArticulo(detalleId);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        actualizarSeleccionArticulo(detalleId);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        items[selectedIndex].click();
    } else if (e.key === 'Escape') {
        ocultarSugerenciasArticulo(detalleId);
        selectedIndex = -1;
    }
}
