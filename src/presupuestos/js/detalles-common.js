console.log('🔧 [DETALLES-COMMON] Cargando módulo común de detalles de artículos...');

// Namespace para el módulo común de detalles
window.Detalles = {
    // Variables del módulo
    detalleCounter: 0,
    clienteSeleccionado: null,
    currentRequest: null,
    selectedIndex: -1,
    initialized: false,
    mode: 'crear', // 'crear' | 'editar'

    // Funciones públicas
    init: initDetallesCommon,
    agregarDetalle: agregarDetalle,
    removerDetalle: removerDetalle,
    seleccionarArticuloPorClick: seleccionarArticuloPorClick,
    seleccionarArticulo: seleccionarArticulo,
    seleccionarClientePorClick: seleccionarClientePorClick,
    mostrarMensaje: mostrarMensaje,
    recalcTotales: recalcTotales,
    calcularPrecio: calcularPrecio,
    setupClienteAutocomplete: setupClienteAutocomplete,
    setupArticuloAutocomplete: setupArticuloAutocomplete,
    toggleSinStock: toggleSinStock,
    toggleClearButton: toggleClearButton,
    limpiarInputArticulo: limpiarInputArticulo,
    renderPriceBadge: renderPriceBadge,
    togglePriceSource: togglePriceSource
};

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

// ===== FUNCIONES DE MANEJO DE DETALLES =====

/**
 * Agregar nueva fila de detalle
 */
function agregarDetalle() {
    console.log('📦 [DETALLES-COMMON] Agregando nueva fila de detalle...');

    const tbody = document.getElementById('detalles-tbody');
    if (!tbody) {
        console.error('❌ [DETALLES-COMMON] #detalles-tbody no existe, no se puede agregar detalle');
        return;
    }

    window.Detalles.detalleCounter++;
    const row = document.createElement('tr');
    row.id = `detalle-${window.Detalles.detalleCounter}`;

    row.innerHTML = `
                <td>
                    <div class="articulo-input-container" style="position: relative; display: flex; align-items: center;">
                        <input type="text" name="detalles[${window.Detalles.detalleCounter}][articulo]"
                            placeholder="Código o descripción del artículo" required
                            autocomplete="off" style="padding-right: 30px; width: 100%;"
                            oninput="window.Detalles.toggleClearButton(this)">
                        <button type="button" class="btn-clear-articulo" 
                            onclick="window.Detalles.limpiarInputArticulo(this)"
                            style="position: absolute; right: 5px; background: none; border: none; font-size: 18px; cursor: pointer; color: #999; display: none;"
                            title="Limpiar campo">&times;</button>
                    </div>
                    <div class="price-source-container" id="price-source-container-${window.Detalles.detalleCounter}" style="margin-top: 4px; display: none;"></div>
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][cantidad]"
                        min="0.001" step="any" placeholder="1" required
                        onchange="window.Detalles.calcularPrecio(${window.Detalles.detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][valor1]"
                        min="0" step="0.01" placeholder="0.00" required
                        onchange="window.Detalles.calcularPrecio(${window.Detalles.detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][descuento_adicional]"
                        min="0" max="100" step="0.01" placeholder="0.00" value="0.00"
                        title="Descuento adicional para este artículo (%)"
                        style="text-align: right;"
                        onchange="window.Detalles.recalcTotales()">
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][iva1]"
                        min="0" max="100" step="0.01" placeholder="21.00"
                        onchange="window.Detalles.calcularPrecio(${window.Detalles.detalleCounter})">
                </td>
                <td>
                    <!-- Hidden numérico que se envía al backend -->
                    <input type="hidden" name="detalles[${window.Detalles.detalleCounter}][precio1]" class="precio1-hidden">
                    <!-- Display formateado para el usuario -->
                    <input type="text" class="precio-calculado" data-precio-display="${window.Detalles.detalleCounter}" value="$ 0,00" readonly>
                </td>

                <!-- NUEVA CELDA: Subtotal (solo visual) -->
                <td>
                    <input type="text"
                        class="subtotal-display"
                        data-subtotal-display="${window.Detalles.detalleCounter}"
                        value="$ 0,00"
                        readonly>
                </td>

                <td style="white-space: nowrap;">
                    ${(typeof window.MODO_RETIRO !== 'undefined' && window.MODO_RETIRO) ? '' : `<button type="button" class="btn-saldo-ingrediente" style="margin-right: 5px;" onclick="window.abrirModalSaldoIngrediente(this)" title="Cargar Saldo de Ingrediente (Fracción por Kilos)">⚖️</button><button type="button" class="btn-sin-stock" style="margin-right: 5px;" onclick="window.Detalles.toggleSinStock(this)" title="Marcar artículo como Faltante">🚫</button>`}
                    <button type="button" class="btn-remove-detalle"
                            onclick="window.Detalles.removerDetalle(${window.Detalles.detalleCounter})">
                    🗑️
                    </button>
                </td>
                `;

    tbody.appendChild(row);

    // Establecer valores por defecto
    const ivaInput = row.querySelector(`input[name="detalles[${window.Detalles.detalleCounter}][iva1]"]`);
    if (ivaInput) ivaInput.value = '21.00';

    const cantidadInput = row.querySelector(`input[name="detalles[${window.Detalles.detalleCounter}][cantidad]"]`);
    if (cantidadInput) cantidadInput.value = '1';

    console.log(`✅ [DETALLES-COMMON] Detalle ${window.Detalles.detalleCounter} agregado`);
}

/**
 * Remover fila de detalle
 * CORREGIDO: Permite eliminar cualquier fila, incluyendo la primera
 * La validación de "al menos 1 detalle" se hace al guardar, no aquí
 */
function removerDetalle(id) {
    console.log(`🗑️ [DETALLES-COMMON] Removiendo detalle ${id}...`);
    console.log(`[EDIT-DETALLE] Click en eliminar fila`, { id_detalle: id });

    const row = document.getElementById(`detalle-${id}`);
    const tbody = document.getElementById('detalles-tbody');

    if (!tbody) {
        console.error('❌ [DETALLES-COMMON] #detalles-tbody no existe');
        return;
    }

    // Log del estado actual
    console.log(`[EDIT-DETALLE] Estado antes de eliminar:`, {
        id_detalle: id,
        filas_totales: tbody.children.length,
        fila_existe: !!row
    });

    if (!row) {
        console.error(`❌ [DETALLES-COMMON] Fila detalle-${id} no encontrada en el DOM`);
        return;
    }

    // CORRECCIÓN: Eliminar sin restricciones
    // La validación de "al menos 1 detalle" se hace al guardar el presupuesto
    row.remove();
    
    console.log(`✅ [DETALLES-COMMON] Detalle ${id} removido correctamente`);
    console.log(`[EDIT-DETALLE] Estado después de eliminar:`, {
        id_detalle: id,
        filas_restantes: tbody.children.length
    });

    // Recalcular totales después de eliminar
    recalcTotales();
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

    console.log(`💰 [DETALLES-COMMON] Precio calculado para detalle ${detalleId}: ${precioUnitario.toFixed(2)}`);
}

// ===== HELPERS NUMÉRICOS + UTILIDADES =====

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
  const n = Number(val);
  const dec = (Number.isFinite(n) && Math.round(n * 100) !== Math.round(n * 1000) / 10) ? 3 : 2;
  setNumeric(el, val, dec, 1);
}

function getDetalleIdFromInput(input) {
  const m = (input.name || '').match(/\[(\d+)\]\[/);
  return m ? parseInt(m[1], 10) : null;
}

// ===== FUNCIONES DE TOTALES =====

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
  let montoDescEspeciales = 0;
  let gananciaTotal = 0;
  let tieneGananciaBunker = false;
  const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;
  const [pct] = getDescuentoPorcentaje();

  tbody.querySelectorAll('tr').forEach(row => {
    if (row.classList.contains('out-of-stock-row')) return; // IGNORAR FILAS SIN STOCK
    const cant = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
    const pvu  = parseFloat(row.querySelector('input[name*="[precio1]"]')?.value) || 0; // precio unit. con IVA
    const descEsp = parseFloat(row.querySelector('input[name*="[descuento_adicional]"]')?.value) || 0;
    const subFila = cant * pvu;
    subtotalBruto += subFila;
    if (descEsp > 0) {
      montoDescEspeciales += subFila * (descEsp / 100);
    }

    const gananciaUnitBase = parseFloat(row.dataset.gananciaBunker) || 0;
    const costoBultoUnit = parseFloat(row.dataset.costoBunker) || 0;
    const costoTiempoUnit = parseFloat(row.dataset.costoTiempoBunker) || 0;
    const costoOperativoUnit = costoBultoUnit + costoTiempoUnit;
    
    if (costoOperativoUnit > 0) {
      // Precio unitario con IVA tipeado o cargado actualmente en la fila del presupuesto (pvu)
      const pvuActual = pvu;
      const pvuConDesc = pvuActual * (1 - (pct + descEsp) / 100);
      const ivaEl = row.querySelector('select[name*="[iva1]"], input[name*="[iva1]"]');
      const ivaVal = ivaEl ? (parseFloat(ivaEl.value) || 0) : 21;
      const netoConDesc = pvuConDesc / (1 + (ivaVal / 100));

      const iibb = pvuConDesc * 0.04;
      const ivaVenta = netoConDesc * (ivaVal / 100);
      const ivaCompra = costoBultoUnit * 0.21;
      const diferenciaIva = Math.max(0, ivaVenta - ivaCompra);

      const gananciaUnitFila = netoConDesc - costoOperativoUnit - iibb - diferenciaIva;
      const ganFila = gananciaUnitFila * cant;

      gananciaTotal += ganFila;
      tieneGananciaBunker = true;
    } else if (gananciaUnitBase !== 0) {
      const ganFila = gananciaUnitBase * cant;
      const descFilaBruto = subFila * ((pct + descEsp) / 100);
      const ivaEl = row.querySelector('select[name*="[iva1]"], input[name*="[iva1]"]');
      const ivaVal = ivaEl ? (parseFloat(ivaEl.value) || 0) : 21;
      const descFilaNeto = descFilaBruto / (1 + (ivaVal / 100));

      gananciaTotal += (ganFila - descFilaNeto);
      tieneGananciaBunker = true;
    }
  });

  // 🏷️ Evaluación reactiva de Política Comercial por Volumen (con neto exacto de línea)
  if (window.EvaluadorPoliticas && typeof window.EvaluadorPoliticas.evaluarYActualizarUI === 'function') {
    let subtotalNetoCalculado = 0;
    tbody.querySelectorAll('tr').forEach(row => {
      if (row.classList.contains('out-of-stock-row')) return;
      const cant = parseFloat(row.querySelector('input[name*="[cantidad]"]')?.value) || 0;
      const pvu  = parseFloat(row.querySelector('input[name*="[precio1]"]')?.value) || 0;
      const ivaEl = row.querySelector('select[name*="[iva1]"], input[name*="[iva1]"]');
      const ivaVal = ivaEl ? (parseFloat(ivaEl.value) || 0) : 21;
      subtotalNetoCalculado += (cant * pvu) / (1 + (ivaVal / 100));
    });
    window.EvaluadorPoliticas.evaluarYActualizarUI(subtotalNetoCalculado, subtotalBruto);
  }

  const [pctFinal] = getDescuentoPorcentaje();
  const montoDescGeneral = subtotalBruto * (pctFinal / 100);
  const montoDescTotal = montoDescGeneral + montoDescEspeciales;
  const totalFinal = subtotalBruto - montoDescTotal;

  // Actualiza displays (tolerante: IDs o data-attrs)
  setTextInto(['#total-bruto', '[data-total="bruto"]'], formatARS(subtotalBruto));
  setTextInto(['#total-descuento', '[data-total="descuento"]'], formatARS(montoDescGeneral));

  const rowDescEsp = document.getElementById('row-descuentos-especiales');
  if (rowDescEsp) {
    if (montoDescEspeciales > 0) {
      rowDescEsp.style.display = 'flex';
      setTextInto(['#total-descuentos-especiales', '[data-total="descuentos-especiales"]'], `-${formatARS(montoDescEspeciales)}`);
    } else {
      rowDescEsp.style.display = 'none';
    }
  }

  setTextInto(['#total-final', '[data-total="final"]'], formatARS(totalFinal));

  // Actualizar indicador discreto de ganancia
  let divGanancia = document.getElementById('seccion-ganancia-bunker');
  if (!divGanancia) {
    const panel = document.querySelector('.totales-panel') || document.querySelector('.totales-container');
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
  } else if (!divGanancia.querySelector('#btn-info-ganancia-bunker')) {
    const spanExistente = divGanancia.querySelector('#ganancia-bunker-valor');
    if (spanExistente) {
      const btnInfo = document.createElement('button');
      btnInfo.type = 'button';
      btnInfo.id = 'btn-info-ganancia-bunker';
      btnInfo.onclick = () => window.abrirModalAuditoriaRentabilidadBunker();
      btnInfo.title = 'Ver desglose detallado, planilla y trazabilidad de costos (PDF / Excel)';
      btnInfo.style.cssText = 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 5px; padding: 2px 8px; font-size: 0.85em; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; transition: all 0.15s ease;';
      btnInfo.innerHTML = 'ℹ️ Info';
      spanExistente.insertAdjacentElement('afterend', btnInfo);
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

// ===== FUNCIONES DE AUTOCOMPLETAR DE CLIENTES =====

/**
 * Configurar autocompletar de clientes
 */
function setupClienteAutocomplete() {
    console.log('🔍 [DETALLES-COMMON] Configurando autocompletar de clientes...');

    const input = document.getElementById('id_cliente');
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');

    if (!input || !sugerenciasContainer) {
        console.log('ℹ️ [DETALLES-COMMON] Elementos de autocompletar de clientes no encontrados (normal en página de edición)');
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

    console.log('✅ [DETALLES-COMMON] Autocompletar configurado correctamente');
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

    console.log(`🔍 [DETALLES-COMMON] Búsqueda de cliente: "${query}"`);

    // Cancelar request anterior si existe
    if (window.Detalles.currentRequest) {
        window.Detalles.currentRequest.abort();
        window.Detalles.currentRequest = null;
    }

    // Reset estado
    window.Detalles.selectedIndex = -1;
    window.Detalles.clienteSeleccionado = null;

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
        window.Detalles.currentRequest = controller;

        // Hacer request al endpoint existente
        const response = await fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`, {
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log(`📋 [DETALLES-COMMON] Sugerencias recibidas: ${result.data.length} clientes`);

        // Mostrar sugerencias
        mostrarSugerencias(result.data);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('🔄 [DETALLES-COMMON] Request cancelado');
            return;
        }

        console.error('❌ [DETALLES-COMMON] Error al buscar clientes:', error);
        mostrarError('Error al buscar clientes. Podés escribir el ID manualmente.');

    } finally {
        window.Detalles.currentRequest = null;
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
            window.Detalles.selectedIndex = Math.min(window.Detalles.selectedIndex + 1, items.length - 1);
            updateSelection(items);
            break;

        case 'ArrowUp':
            event.preventDefault();
            window.Detalles.selectedIndex = Math.max(window.Detalles.selectedIndex - 1, -1);
            updateSelection(items);
            break;

        case 'Enter':
            event.preventDefault(); // ✅ Evitar submit del formulario
            
            // Si hay un índice seleccionado (navegación con flechas), usar ese
            if (window.Detalles.selectedIndex >= 0 && items[window.Detalles.selectedIndex]) {
                seleccionarCliente(items[window.Detalles.selectedIndex]);
            } 
            // Si no hay índice seleccionado pero hay resultados, auto-seleccionar el primero
            else if (items.length > 0) {
                console.log('🔍 [DETALLES-COMMON] Auto-seleccionando primer resultado al presionar Enter');
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
    window.Detalles.selectedIndex = -1; // Reset selección
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
    window.Detalles.selectedIndex = -1;
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
        nombre: nombreCompleto.split(' ')[0] || '',
        apellido: nombreCompleto.split(' ').slice(1).join(' ') || '',
        cuit: cuit
    };

    // Actualizar input con número formateado
    const input = document.getElementById('id_cliente');
    if (input) input.value = numeroFormateado;

    // Log según especificación
    console.log(`✅ [DETALLES-COMMON] Cliente seleccionado`, clienteSeleccionado);

    // Ocultar sugerencias
    ocultarSugerencias();
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

// ===== FUNCIONES DE AUTOCOMPLETAR DE ARTÍCULOS =====

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
    query_original: query,
    query_normalizado: normalizarTexto(query),
    tokens_generados: terms, 
    items_recibidos: items.length 
  });

  const out = (items || []).filter(a => {
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

    const cumple = terms.every(term => {
      if (typeof term === 'object' && term.type === 'isolated_num') {
        return term.regex.test(searchableText);
      }
      return searchableText.includes(term);
    });
    
    if (items.indexOf(a) < 3) {
      console.log('[ARTICULOS-FILTER] Evaluando artículo:', {
        descripcion_original: a.description ?? a.descripcion,
        searchable_text: searchableText,
        tokens_buscados: terms,
        cumple_todos: cumple
      });
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
    query_original: query, 
    tokens: terms, 
    items_recibidos: items.length,
    resultados_filtrados: out.length 
  });

  // Limite visual
  return out.slice(0, 50);
}

/**
 * Configurar autocompletar para artículos
 */
function setupArticuloAutocomplete() {
    console.log('🔧 [DETALLES-COMMON] Configurando autocompletar de artículos...');

    // Usar delegación de eventos para manejar inputs dinámicos
    document.addEventListener('input', function(event) {
        // Verificar si el input es de artículo
        if (event.target.name && event.target.name.includes('[articulo]')) {
            handleArticuloInput(event);
        }
    });

    // Manejar teclas especiales para navegación
    document.addEventListener('keydown', function(event) {
        if (event.target.name && event.target.name.includes('[articulo]')) {
            handleArticuloKeydown(event);
        }
    });

    // Cerrar sugerencias al hacer click fuera
    document.addEventListener('click', function(event) {
        const sugerenciasContainer = document.querySelector('.articulo-sugerencias');
        if (sugerenciasContainer && !event.target.closest('.articulo-input-container')) {
            ocultarSugerenciasArticulo();
        }
    });

    console.log('✅ [DETALLES-COMMON] Autocompletar de artículos configurado');
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

const handleArticuloInput = debounce(async function(event) {
  const input = event.target;
  const rawValue = input.value || '';

  // REQUERIMIENTO ESTRICTO #026: La búsqueda solo debe gatillarse cuando se presiona la tecla espacio.
  // IMPORTANTE: En detalles-common.js no tenemos garantizado que "modoBusqueda" exista globalmente, pero 
  // si es necesario lo contemplamos (por defecto asume undefined !== 'codigo').
  if (!rawValue.includes(' ') && (typeof modoBusqueda === 'undefined' || modoBusqueda !== 'codigo')) {
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
        const primerTermino = (query.split(/\s+/)[0] || query).replace(/#/g, '').trim();
        const queryParaServidor = (primerTermino || query.replace(/#/g, '').trim()).toLowerCase();

        const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;
        const clienteIdInput = document.getElementById('id_cliente');
        const clienteId = clienteIdInput ? parseInt(clienteIdInput.value, 10) || 0 : 0;
        const cacheKey = `${queryParaServidor}_bunker_${usarPreciosBunker}_client_${clienteId}`;

        if (window.__articulosSearchCache[cacheKey]) {
            console.log(`[ARTICULOS] Caché local encontrada para raíz "${queryParaServidor}" (Bunker: ${usarPreciosBunker}). Filtrando sin fetch.`);
            items = filtrarArticulosLocal(query, window.__articulosSearchCache[cacheKey]);
        } else {
            console.log(`[ARTICULOS] Fetch para servidor: "${queryParaServidor}" (Bunker: ${usarPreciosBunker}).`);

            let url = `/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(queryParaServidor)}&limit=500&cliente_id=${clienteId}`;
            if (usarPreciosBunker) url += '&usar_precios_bunker=true';
            
            const controller = new AbortController();
            window.__articulosCurrentRequest = controller;

            const response = await fetch(url, {
                signal: controller.signal
            });
            
            if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
            const body = await response.json();
            const arr = Array.isArray(body) ? body : (body.data || body.items || []);

            window.__articulosSearchCache[cacheKey] = arr;
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
 * Mostrar loading para artículos
 */
function mostrarLoadingArticulo(input) {
    const container = getOrCreateSugerenciasContainer();
    container.innerHTML = '<div class="articulo-loading">🔍 Buscando artículos...</div>';
    container.style.display = 'block';
    posicionarSugerenciasArticulo(input, container);
}

/**
 * Mostrar sugerencias de artículos
 */
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

  const html = articulosLimitados.map((articulo) => {
    const sf = Math.floor(parseFloat(articulo.stock_fisico || 0));
    const sr = Math.floor(parseFloat(articulo.stock_reservado || 0));
    const sd = Math.floor(parseFloat(articulo.stock_disponible !== undefined ? articulo.stock_disponible : (articulo.stock_consolidado || 0)));

    const stockClass = sd <= 0 ? 'sin-stock' : 'con-stock';
    const stockLabel = sr > 0 ? `Disp: ${sd} (Fís: ${sf}, Res: ${sr})` : `Stock: ${sd}`;
    const label = (articulo.description ?? articulo.descripcion ?? '').toString();
    const safeLabel = label.replace(/"/g, '"');

    const etiquetas = (articulo.etiquetas && articulo.etiquetas.length > 0)
      ? `<span class="articulo-etiquetas">${articulo.etiquetas.join(' ')}</span>`
      : '';

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
        console.error('❌ [DETALLES-COMMON] No se pudo encontrar input de artículo para selección');
    }
}

/**
 * Seleccionar artículo
 */
function seleccionarArticulo(input, element) {
  const codigoBarras   = (element.dataset.codigoBarras   || '').toString();
  const articuloNumero = (element.dataset.articuloNumero || '').toString();
  const description    = (element.dataset.description    || '').toString();
  const stock          = parseFloat(element.dataset.stock || 0);

  // mostrar al usuario + guardar códigos reales para el submit
  input.value = description;
  input.dataset.codigoBarras = codigoBarras;
  input.dataset.articuloNumero = articuloNumero;

  console.log(`[ARTICULOS] Seleccionado: ${description} [${articuloNumero}] (Stock: ${stock})`);
  ocultarSugerenciasArticulo();

  // ubicar fila/inputs
  const row           = input.closest('tr');
  const cantidadInput = row?.querySelector('input[name*="[cantidad]"]');
  const valor1Input   = row?.querySelector('input[name*="[valor1]"]');
  const iva1Input     = row?.querySelector('input[name*="[iva1]"]');
  const detalleId     = getDetalleIdFromInput(cantidadInput || input);

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

  const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;

  (async () => {
    let valor, iva;
    let valorBunker = null, ivaBunker = null;
    let valorLegacy = null, ivaLegacy = null;

    try {
      const pBunker = new URLSearchParams({ cliente_id: String(clienteId), usar_precios_bunker: 'true' });
      const pLegacy = new URLSearchParams({ cliente_id: String(clienteId) });
      if (articuloNumero) {
        pBunker.set('articulo_numero', articuloNumero);
        pLegacy.set('articulo_numero', articuloNumero);
      }
      if (codigoBarras) {
        pBunker.set('codigo_barras', codigoBarras);
        pLegacy.set('codigo_barras', codigoBarras);
      }
      if (description) {
        pBunker.set('descripcion', description);
        pLegacy.set('descripcion', description);
      }

      const [resBunker, resLegacy] = await Promise.all([
        fetchPrecios(pBunker).catch(e => { console.warn('Bunker price fetch failed:', e); return null; }),
        fetchPrecios(pLegacy).catch(e => { console.warn('Legacy price fetch failed:', e); return null; })
      ]);

      let gananciaBunker = 0;
      let costoBultoBunker = 0;
      let costoTiempoBunker = 0;
      if (resBunker && resBunker.data) {
        valorBunker = Number(resBunker.data.valor1);
        ivaBunker = Number(resBunker.data.iva);
        gananciaBunker = Number(resBunker.data.ganancia_real) || 0;
        costoBultoBunker = resBunker.data.costo_bulto !== undefined ? Number(resBunker.data.costo_bulto) : (Number(resBunker.data.costo_operativo) || 0);
        costoTiempoBunker = resBunker.data.costo_tiempo !== undefined ? Number(resBunker.data.costo_tiempo) : 0;
      }
      if (resLegacy && resLegacy.data) {
        valorLegacy = Number(resLegacy.data.valor1);
        ivaLegacy = Number(resLegacy.data.iva);
      }
    } catch (e) {
      console.error('Error fetching prices in parallel:', e);
    }

    const activeSource = usarPreciosBunker ? 'bunker' : 'legacy';
    if (row) {
      row.dataset.priceBunker = valorBunker !== null ? String(valorBunker) : '';
      row.dataset.ivaBunker = ivaBunker !== null ? String(ivaBunker) : '21';
      row.dataset.gananciaBunker = String(gananciaBunker);
      row.dataset.costoBunker = String(costoBultoBunker);
      row.dataset.costoTiempoBunker = String(costoTiempoBunker);
      row.dataset.priceLegacy = valorLegacy !== null ? String(valorLegacy) : '';
      row.dataset.ivaLegacy = ivaLegacy !== null ? String(ivaLegacy) : '21';
      row.dataset.priceSource = activeSource;
    }

    valor = activeSource === 'bunker' ? valorBunker : valorLegacy;
    iva = activeSource === 'bunker' ? ivaBunker : ivaLegacy;

    // Fallback si el precio activo no tiene valor
    if ((valor === null || isNaN(valor) || valor <= 0) && activeSource === 'bunker' && valorLegacy > 0) {
      valor = valorLegacy;
      iva = ivaLegacy;
      if (row) row.dataset.priceSource = 'legacy';
    } else if ((valor === null || isNaN(valor) || valor <= 0) && activeSource === 'legacy' && valorBunker > 0) {
      valor = valorBunker;
      iva = ivaBunker;
      if (row) row.dataset.priceSource = 'bunker';
    }

    if (valor === null || isNaN(valor)) {
      valor = 0;
      iva = 21;
    }

    if (Number.isFinite(valor) && valor1Input) setNumeric(valor1Input, valor, 2, 0);
    if (Number.isFinite(iva) && iva1Input) {
      iva1Input.dataset.ivaBase = String(iva);
      const tipoSel = document.getElementById('tipo_comprobante');
      const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
      setNumeric(iva1Input, visibleIva, 2, 21);
    }

    if (detalleId != null) {
      renderPriceBadge(detalleId);
      calcularPrecio(detalleId);
    }
    
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

// ===== FUNCIONES DE UTILIDADES =====

/**
 * Normalizar texto para búsqueda (tolerancia a acentos, PRESERVANDO caracteres especiales)
 * NUEVA LÓGICA: Mantiene símbolos como /, +, - para coincidencias exactas
 */
function normalizarTexto(texto) {
  return (texto || '').toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    // NO reemplazar caracteres especiales - los mantenemos para búsqueda exacta
    .replace(/\s+/g, ' ') // Normalizar espacios múltiples a uno solo
    .trim();
}

/**
 * Mostrar mensaje al usuario
 */
function mostrarMensaje(mensaje, tipo = 'info') {
  const container = document.getElementById('message-container');
  if (!container) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${tipo}`;
  messageDiv.innerHTML = `
    <span>${mensaje}</span>
    <button type="button" onclick="this.parentElement.remove()" style="float: right; margin-left: 10px;">×</button>
  `;

  container.appendChild(messageDiv);

  // Auto-remover después de 5 segundos
  setTimeout(() => {
    if (messageDiv.parentElement) {
      messageDiv.remove();
    }
  }, 5000);
}

// ===== INICIALIZACIÓN =====

/**
 * Inicializar módulo común de detalles
 */
function initDetallesCommon() {
  console.log('🚀 [DETALLES-COMMON] Inicializando módulo común de detalles...');

  // Configurar autocompletar de clientes
  setupClienteAutocomplete();

  // Configurar autocompletar de artículos
  setupArticuloAutocomplete();

  // Configurar listener para tipo de comprobante (IVA mode)
  const tipoComprobanteSelect = document.getElementById('tipo_comprobante');
  if (tipoComprobanteSelect) {
    tipoComprobanteSelect.addEventListener('change', function() {
      console.log(`📄 [DETALLES-COMMON] Tipo de comprobante cambiado a: ${this.value}`);
      applyIvaModeToAllRows();
    });
  }

  console.log('✅ [DETALLES-COMMON] Módulo común inicializado correctamente');
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initDetallesCommon);

// Exponer función de inicialización manual
window.initDetallesCommon = initDetallesCommon;

console.log('📦 [DETALLES-COMMON] Módulo cargado correctamente');

/**
 * Dibujar el badge de origen de precio para un renglón
 */
function renderPriceBadge(detalleId) {
    const row = document.getElementById(`detalle-${detalleId}`);
    if (!row) return;

    const container = document.getElementById(`price-source-container-${detalleId}`);
    if (!container) return;

    const source = row.dataset.priceSource || 'bunker';
    const isBunker = source === 'bunker';
    
    const priceBunker = parseFloat(row.dataset.priceBunker) || 0;
    const priceLegacy = parseFloat(row.dataset.priceLegacy) || 0;
    
    container.innerHTML = `
        <span class="price-source-badge ${isBunker ? 'badge-bunker' : 'badge-legacy'}" 
              onclick="window.Detalles.togglePriceSource(this)" 
              title="Click para cambiar a lista ${isBunker ? 'Legacy' : 'Búnker'} (Búnker: $${priceBunker.toFixed(2)} | Legacy: $${priceLegacy.toFixed(2)})">
            ${isBunker ? 'Búnker' : 'Legacy'}
        </span>
    `;
    container.style.display = 'none';
}

/**
 * Alternar origen de precios de la fila
 */
async function togglePriceSource(badgeElement) {
    const row = badgeElement.closest('tr');
    if (!row) return;

    const id = getDetalleIdFromInput(row.querySelector('input[name*="[cantidad]"]'));
    if (id === null) return;

    const currentSource = row.dataset.priceSource || 'bunker';
    const nextSource = currentSource === 'bunker' ? 'legacy' : 'bunker';

    let priceBunker = parseFloat(row.dataset.priceBunker);
    let priceLegacy = parseFloat(row.dataset.priceLegacy);
    let ivaBunker = parseFloat(row.dataset.ivaBunker);
    let ivaLegacy = parseFloat(row.dataset.ivaLegacy);

    if (isNaN(priceBunker) || isNaN(priceLegacy)) {
        badgeElement.classList.add('price-source-loading');
        badgeElement.innerText = 'Cargando...';

        const clienteId = parseInt(getClienteIdActivo(), 10) || 0;
        const codigoBarras = row.querySelector('input[name*="[articulo]"]')?.dataset.codigoBarras || '';
        const description = row.querySelector('input[name*="[articulo]"]')?.value || '';

        try {
            const pBunker = new URLSearchParams({ cliente_id: String(clienteId), usar_precios_bunker: 'true' });
            const pLegacy = new URLSearchParams({ cliente_id: String(clienteId) });
            if (codigoBarras) {
                pBunker.set('codigo_barras', codigoBarras);
                pLegacy.set('codigo_barras', codigoBarras);
            } else if (description) {
                pBunker.set('descripcion', description);
                pLegacy.set('descripcion', description);
            }

            const [resBunker, resLegacy] = await Promise.all([
                fetch(`/api/presupuestos/precios?${pBunker.toString()}`).then(r => r.json()).catch(() => null),
                fetch(`/api/presupuestos/precios?${pLegacy.toString()}`).then(r => r.json()).catch(() => null)
            ]);

            priceBunker = resBunker?.data?.valor1 !== undefined ? Number(resBunker.data.valor1) : 0;
            ivaBunker = resBunker?.data?.iva !== undefined ? Number(resBunker.data.iva) : 21;
            const gananciaBunker = resBunker?.data?.ganancia_real !== undefined ? Number(resBunker.data.ganancia_real) : 0;
            priceLegacy = resLegacy?.data?.valor1 !== undefined ? Number(resLegacy.data.valor1) : 0;
            ivaLegacy = resLegacy?.data?.iva !== undefined ? Number(resLegacy.data.iva) : 21;

            row.dataset.priceBunker = String(priceBunker);
            row.dataset.ivaBunker = String(ivaBunker);
            row.dataset.gananciaBunker = String(gananciaBunker);
            if (resBunker?.data) {
                const cBulto = resBunker.data.costo_bulto !== undefined ? resBunker.data.costo_bulto : (resBunker.data.costo_operativo || 0);
                const cTiempo = resBunker.data.costo_tiempo !== undefined ? resBunker.data.costo_tiempo : 0;
                row.dataset.costoBunker = String(cBulto);
                row.dataset.costoTiempoBunker = String(cTiempo);
            }
            row.dataset.priceLegacy = String(priceLegacy);
            row.dataset.ivaLegacy = String(ivaLegacy);
        } catch (err) {
            console.error('Error fetching alternative prices:', err);
            badgeElement.classList.remove('price-source-loading');
            renderPriceBadge(id);
            return;
        }
        badgeElement.classList.remove('price-source-loading');
    }

    row.dataset.priceSource = nextSource;
    const nextPrice = nextSource === 'bunker' ? priceBunker : priceLegacy;
    const nextIva = nextSource === 'bunker' ? ivaBunker : ivaLegacy;

    const valor1Input = row.querySelector('input[name*="[valor1]"]');
    const iva1Input = row.querySelector('input[name*="[iva1]"]');

    if (valor1Input) setNumeric(valor1Input, nextPrice, 2, 0);
    if (iva1Input) {
        iva1Input.dataset.ivaBase = String(nextIva);
        const tipoSel = document.getElementById('tipo_comprobante');
        const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (nextIva / 2) : nextIva;
        setNumeric(iva1Input, visibleIva, 2, 21);
    }

    renderPriceBadge(id);
    calcularPrecio(id);
    recalcTotales();
}

// Función global de conmutación de Modo Bunker para Edición / Creación
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

    console.log(`🛡️ [PRESUPUESTOS-COMMON] Conmutando instantánea de grilla a Modo ${usarPreciosBunker ? 'Búnker' : 'Legacy'}`);

    // Limpiar caché local de búsqueda si existiera
    window.__articulosSearchCache = {};

    tbody.style.opacity = '0.6';

    const promises = rows.map(async (row) => {
        if (row.classList.contains('child-row')) return; // Skip child rows (ingredients)

        const artInput = row.querySelector('input[name*="[articulo]"]');
        if (!artInput || !artInput.value.trim()) return;

        const codigoBarras = artInput.dataset.codigoBarras || artInput.dataset.articuloNumero || '';
        const description = artInput.value.trim();
        const valor1Input = row.querySelector('input[name*="[valor1]"]');
        const iva1Input = row.querySelector('input[name*="[iva1]"]');
        const cantidadInput = row.querySelector('input[name*="[cantidad]"]');
        const detalleId = getDetalleIdFromInput(cantidadInput || artInput);

        const isOriginalSnapshot = row.dataset.isOriginalBudgetRow === "true";

        let valor = 0;
        let iva = 21;
        
        if (isOriginalSnapshot) {
            // 🛡️ REGLA ESTRUCTURAL DE ECOSISTEMA CONGELADO:
            // Para filas pertenecientes a la instantánea histórica del presupuesto, NO consultar la API viva de catálogo para alterar precios.
            // Alternar únicamente entre los dataset congelados en este presupuesto.
            if (usarPreciosBunker) {
                valor = row.dataset.priceBunker !== undefined ? parseFloat(row.dataset.priceBunker) : parseFloat(row.dataset.initialPrice || (valor1Input ? valor1Input.value : 0));
                iva = row.dataset.ivaBunker !== undefined ? parseFloat(row.dataset.ivaBunker) : parseFloat(row.dataset.initialIva || 21);
                row.dataset.priceSource = 'bunker';
            } else {
                valor = row.dataset.priceLegacy !== undefined ? parseFloat(row.dataset.priceLegacy) : parseFloat(row.dataset.initialPrice || (valor1Input ? valor1Input.value : 0));
                iva = row.dataset.ivaLegacy !== undefined ? parseFloat(row.dataset.ivaLegacy) : parseFloat(row.dataset.initialIva || 21);
                row.dataset.priceSource = 'legacy';
            }

            // Si aún no se han cargado los datasets financieros de costo/ganancia para esta fila histórica, obtenerlos una vez para habilitar el visor de ganancia
            if (!row.dataset.costoBunker) {
                try {
                    const pFin = new URLSearchParams({ cliente_id: String(clienteId), usar_precios_bunker: 'true' });
                    if (codigoBarras) pFin.set('codigo_barras', codigoBarras);
                    else if (description) pFin.set('descripcion', description);
                    
                    const resFin = await fetch(`/api/presupuestos/precios?${pFin.toString()}`).then(r => r.json());
                    if (resFin.success && resFin.data) {
                        row.dataset.gananciaBunker = resFin.data.ganancia_real !== undefined ? String(resFin.data.ganancia_real) : '0';
                        const cBultoVal = resFin.data.costo_bulto !== undefined ? resFin.data.costo_bulto : (resFin.data.costo_operativo || 0);
                        row.dataset.costoBunker = String(cBultoVal);
                        row.dataset.costoTiempoBunker = resFin.data.costo_tiempo !== undefined ? String(resFin.data.costo_tiempo) : '0';
                    }
                } catch (e) {
                    console.warn(`Error al recuperar datos financieros históricos para la fila:`, e);
                }
            }
        } else {
            // 🚀 FILA NUEVA INGRESADA EN LA SESIÓN ACTUAL:
            // Consultar el precio en vivo del catálogo global según el modo activo
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

                    if (usarPreciosBunker) {
                        row.dataset.priceBunker = String(valor);
                        row.dataset.ivaBunker = String(iva);
                        row.dataset.gananciaBunker = res.data.ganancia_real !== undefined ? String(res.data.ganancia_real) : '0';
                        const cBultoVal = res.data.costo_bulto !== undefined ? res.data.costo_bulto : (res.data.costo_operativo || 0);
                        row.dataset.costoBunker = String(cBultoVal);
                        row.dataset.costoTiempoBunker = res.data.costo_tiempo !== undefined ? String(res.data.costo_tiempo) : '0';
                        row.dataset.priceSource = 'bunker';
                    } else {
                        row.dataset.priceLegacy = String(valor);
                        row.dataset.ivaLegacy = String(iva);
                        if (res.data.costo_bulto !== undefined || res.data.costo_operativo !== undefined) {
                            const cBultoVal = res.data.costo_bulto !== undefined ? res.data.costo_bulto : (res.data.costo_operativo || 0);
                            row.dataset.costoBunker = String(cBultoVal);
                            row.dataset.costoTiempoBunker = res.data.costo_tiempo !== undefined ? String(res.data.costo_tiempo) : '0';
                            row.dataset.gananciaBunker = res.data.ganancia_real !== undefined ? String(res.data.ganancia_real) : '0';
                        }
                        row.dataset.priceSource = 'legacy';
                    }
                }
            } catch (e) {
                console.error(`Error al recuperar precio para la nueva fila:`, e);
            }
        }

        // Recuperar descripción según el modo (Búnker o Legacy) únicamente si es fila nueva
        let friendlyDesc = description;
        if (codigoBarras && !isOriginalSnapshot) {
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

    recalcTotales();
};

// 🟢 VINCULACIÓN DINÁMICA DE GANANCIA BUNKER DISCRETA
window.conmutarReveladoGanancia = function(el) {
    if (el.style.filter === 'blur(4px)' || el.style.filter === '') {
        el.style.filter = 'none';
        el.style.background = 'transparent';
        el.style.color = '#15803d'; // Verde ganancia
        
        // Auto-difuminar tras 5 segundos por seguridad
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

// Inyectar el panel de ganancia de forma dinámica al cargar
document.addEventListener('DOMContentLoaded', () => {
    // Buscar panel de totales
    const panel = document.querySelector('.totales-panel') || document.querySelector('.totales-container');
    if (panel && !document.getElementById('seccion-ganancia-bunker')) {
        const div = document.createElement('div');
        div.id = 'seccion-ganancia-bunker';
        div.style.display = 'none';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.marginTop = '10px';
        div.style.paddingTop = '10px';
        div.style.borderTop = '1px dashed #cbd5e1';
        div.style.fontSize = '0.88em';
        div.style.color = '#64748b';
        div.style.gap = '8px';
        
        div.innerHTML = `
            <span>Rentabilidad Estimada (Búnker):</span>
            <div style="display: inline-flex; align-items: center; gap: 6px;">
                <span id="ganancia-bunker-valor" style="font-weight: bold; cursor: pointer; filter: blur(4px); transition: filter 0.2s ease-in-out; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; user-select: none;" title="Haz clic para ver/ocultar ganancia" onclick="window.conmutarReveladoGanancia(this)">$ 0,00</span>
                <button type="button" id="btn-info-ganancia-bunker" onclick="window.abrirModalAuditoriaRentabilidadBunker()" title="Ver desglose detallado, planilla y trazabilidad de costos (PDF / Excel)" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 5px; padding: 2px 8px; font-size: 0.85em; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;">
                    ℹ️ Info
                </button>
            </div>
        `;
        panel.appendChild(div);
        
        // Ocultar también al retirar el cursor (mouseleave)
        const elVal = div.querySelector('#ganancia-bunker-valor');
        if (elVal) {
            elVal.addEventListener('mouseleave', () => {
                elVal.style.filter = 'blur(4px)';
                elVal.style.background = '#e2e8f0';
                elVal.style.color = '#64748b';
                if (window.timerDifuminarGanancia) clearTimeout(window.timerDifuminarGanancia);
            });
        }
    }
});

// --------------------------------------------------------------------------------------
// KIT DE INSUMOS ANIDADOS (SSOT)
// --------------------------------------------------------------------------------------
window.inyectarFilasHijasKit = function(parentRow, ingredientesKit, parentRowId, baseQty) {
    const tbody = document.getElementById('detalles-tbody') || parentRow.closest('tbody');
    
    parentRow.dataset.isParent = "true";
    parentRow.dataset.parentRowId = parentRowId;

    ingredientesKit.forEach(ing => {
        if (typeof window.agregarDetalle === 'function') {
            window.agregarDetalle();
        } else if (typeof window.Detalles !== 'undefined' && typeof window.Detalles.agregarDetalle === 'function') {
            window.Detalles.agregarDetalle();
        }
        
        const rows = tbody.querySelectorAll('tr');
        const newRow = rows[rows.length - 1];
        
        newRow.classList.add('child-row');
        newRow.dataset.childOf = parentRowId;

        // Limpiar estilos innecesarios
        const targetInput = newRow.querySelector('input[name*="[articulo]"]');
        if (targetInput) {
            targetInput.value = ing.descripcion;
            targetInput.dataset.articuloNumero = ing.articulo_id || ''; // Backend envía articulo_id
            targetInput.dataset.codigoBarras = ing.articulo_id || ''; // Requerido por handleSubmit de presupuestosCreate.js
            targetInput.readOnly = true; // El artículo no se puede cambiar, pero cantidades sí
            targetInput.style.backgroundColor = '#f1f5f9';
            targetInput.style.fontWeight = 'bold';
            targetInput.style.color = '#475569';
            targetInput.dataset.ignoreHistorico = "true"; // Opcional, para no buscar historial del insumo
        }

        const cantidadInput = newRow.querySelector('input[name*="[cantidad]"]');
        if (cantidadInput) {
            const qtyCalculada = parseFloat(ing.cantidad_por_kilo_base) * baseQty;
            
            // Set numeric safely
            const n = Number(qtyCalculada);
            cantidadInput.value = Number.isFinite(n) ? n.toFixed(2) : Number(1).toFixed(2);
            try {
                cantidadInput.dispatchEvent(new Event('input', { bubbles: true }));
                cantidadInput.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_) { }

            cantidadInput.dataset.baseRatio = ing.cantidad_por_kilo_base;
        }

        const iva1Input = newRow.querySelector('input[name*="[iva1]"]');
        if (iva1Input) {
            const val = parseFloat(ing.iva_porcentaje) || 21;
            iva1Input.value = Number(val).toFixed(2);
            try { iva1Input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { }
            iva1Input.readOnly = true;
        }

        const valor1Input = newRow.querySelector('input[name*="[valor1]"]');
        if (valor1Input) {
            const valorSinIva = parseFloat(ing.costo_base) || 0;
            valor1Input.value = Number(valorSinIva).toFixed(2);
            try { valor1Input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { }
            valor1Input.readOnly = true;
        }

        // Remover el listener del input artículo para no abrir buscador
        let newTargetId = null;
        if (targetInput) {
            const match = targetInput.name.match(/detalles\[(\d+)\]/);
            newTargetId = match ? parseInt(match[1], 10) : null;
        }
        if (newTargetId != null) {
            if (typeof window.calcularPrecio === 'function') window.calcularPrecio(newTargetId);
            else if (typeof window.Detalles !== 'undefined' && typeof window.Detalles.calcularPrecio === 'function') window.Detalles.calcularPrecio(newTargetId);
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
                    
                    const n = Number(currentParentQty * ratio);
                    cQtyInput.value = Number.isFinite(n) ? n.toFixed(2) : Number(1).toFixed(2);
                    try {
                        cQtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                        cQtyInput.dispatchEvent(new Event('change', { bubbles: true }));
                    } catch (_) { }
                    
                    let cid = null;
                    const match = cQtyInput.name.match(/detalles\[(\d+)\]/);
                    cid = match ? parseInt(match[1], 10) : null;

                    if (cid != null) {
                        if (typeof window.calcularPrecio === 'function') window.calcularPrecio(cid);
                        else if (typeof window.Detalles !== 'undefined' && typeof window.Detalles.calcularPrecio === 'function') window.Detalles.calcularPrecio(cid);
                    }
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
                        
                        if (typeof window.recalcTotales === 'function') window.recalcTotales();
                        else if (typeof window.Detalles !== 'undefined' && typeof window.Detalles.recalcTotales === 'function') window.Detalles.recalcTotales();
                    }
                });
            });
        });
        observer.observe(tbody, { childList: true });
    }
});

/**
 * Renderiza o actualiza el switch interactivo de Oferta Activa en la fila del presupuesto
 */
if (typeof window.renderOfertaBadgeFila !== 'function') {
    window.renderOfertaBadgeFila = function(row, detalleId, ofertaActiva, descPct) {
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
                
                if (typeof setNumeric === 'function') setNumeric(descInput, 0, 2, 0);
                else descInput.value = '0.00';
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

                if (typeof setNumeric === 'function') setNumeric(descInput, descPct, 2, 0);
                else descInput.value = descPct.toFixed(2);
            }

            if (detalleId != null) {
                if (typeof calcularPrecio === 'function') calcularPrecio(detalleId);
                if (window.Detalles && typeof window.Detalles.calcularPrecio === 'function') window.Detalles.calcularPrecio(detalleId);
            }
            if (typeof recalcTotales === 'function') recalcTotales();
            else if (window.Detalles && typeof window.Detalles.recalcTotales === 'function') window.Detalles.recalcTotales();
        });

        tdArticulo.appendChild(container);
    };
}

// ======================================================================================
// AUDITORÍA Y TRAZABILIDAD DE RENTABILIDAD ESTIMADA (BÚNKER) — MODAL + PDF + CSV
// ======================================================================================
window.__ultimaAuditoriaRentabilidadBunker = null;

function fmtMonedaAR(val, dec = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '$ 0,00';
    return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtNumAR(val, dec = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '0,00';
    return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function escHtmlAudit(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseNumAudit(val, fallback = 0) {
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
    const params = new URLSearchParams(window.location.search);
    const presupuestoId = params.get('id') || document.getElementById('id_presupuesto_ext')?.value || '';
    const clienteId = document.getElementById('id_cliente')?.value || getClienteIdActivo() || '';
    const clienteNombre = (
        document.getElementById('info-cliente-nombre')?.textContent ||
        document.getElementById('cliente_nombre')?.value ||
        document.getElementById('cliente-nombre-display')?.textContent ||
        ''
    ).trim();
    const tipoComprobante = document.getElementById('tipo_comprobante')?.value || 'Factura';
    const fecha = document.getElementById('fecha')?.value || '';
    const [descuentoGeneral] = typeof getDescuentoPorcentaje === 'function'
        ? getDescuentoPorcentaje()
        : [parseNumAudit(document.getElementById('descuento')?.value, 0)];
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
            cantidad: parseNumAudit(inpCant?.value, 0),
            valor1: parseNumAudit(inpValor?.value, 0),
            precio1: parseNumAudit(inpPrecio?.value, 0),
            iva1: parseNumAudit(inpIva?.value, 21),
            descuento_adicional: parseNumAudit(inpDescEsp?.value, 0),
            out_of_stock: row.classList.contains('out-of-stock-row'),
            sin_stock: row.classList.contains('out-of-stock-row'),
            costo_bunker: row.dataset.costoBunker !== undefined ? parseFloat(row.dataset.costoBunker) : undefined,
            costo_tiempo_bunker: row.dataset.costoTiempoBunker !== undefined ? parseFloat(row.dataset.costoTiempoBunker) : undefined,
            ganancia_bunker_base: row.dataset.gananciaBunker !== undefined ? parseFloat(row.dataset.gananciaBunker) : undefined
        };
    }).filter(it => it.articulo || it.descripcion || it.cantidad > 0);

    return {
        presupuesto_id: presupuestoId,
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

window.construirHTMLContenidoAuditoriaBunker = function (data, modoImpresion = false) {
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
                    <div style="font-weight:700; color:#0f172a; font-family:monospace; font-size:0.86rem;">${escHtmlAudit(codigoMostrar)}<span style="color:#64748b; font-weight:400; font-size:0.75rem;">${escHtmlAudit(subCodigo)}</span></div>
                    <div style="color:#334155; font-size:0.8rem;">${escHtmlAudit(f.descripcion)}</div>
                    <div style="color:#64748b; font-size:0.72rem; margin-top:2px;">
                        Bulto: <strong>${fmtNumAR(f.kilos_unidad, 2)} kg</strong> | ${escHtmlAudit(etiquetaFlujo(f))}
                    </div>
                    ${alertasBadge}
                </td>
                <td style="padding:7px 6px; text-align:right; font-weight:700;">${fmtNumAR(f.cantidad, 2)}</td>
                <td style="padding:7px 6px; text-align:right;">${fmtMonedaAR(f.precio_unitario_c_iva_sin_desc)}</td>
                <td style="padding:7px 6px; text-align:right; color:#b45309;">${fmtNumAR(f.descuento_total_pct, 2)}%</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600;">${fmtMonedaAR(f.subtotal_c_iva_con_desc)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600; color:#0369a1; background:#f0f9ff;">${fmtMonedaAR(f.subtotal_neto_s_iva_con_desc)}</td>
                <td style="padding:7px 6px; text-align:right; color:#be123c; background:#fff1f2;">${fmtMonedaAR(lineaCostoBulto)}</td>
                <td style="padding:7px 6px; text-align:right; color:#9f1239; background:#fff1f2;">${fmtMonedaAR(lineaCostoMO)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:600; color:#881337; background:#ffe4e6;">${fmtMonedaAR(f.costo_operativo_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; color:#6d28d9;">${fmtMonedaAR(f.iibb_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; color:#7c2d12;" title="IVA Venta (${fmtMonedaAR(lineaIvaVenta)}) - IVA Compra 21% s/Bulto (${fmtMonedaAR(lineaIvaCompra)})">${fmtMonedaAR(f.diferencia_iva_total_fila)}</td>
                <td style="padding:7px 8px; text-align:right; font-weight:800; color:${ganColor}; background:#f0fdf4; font-size:0.9rem;">${fmtMonedaAR(f.ganancia_total_fila)}</td>
                <td style="padding:7px 6px; text-align:right; font-weight:700; color:${ganColor};">${fmtNumAR(f.margen_real_sobre_neto_pct, 2)}%</td>
            </tr>
        `;
    }).join('');

    // Construir Fichas de Trazabilidad Profunda por cada Producto
    const fichasTrazabilidadHTML = filas.map(f => {
        const trz = f.trazabilidad || {};
        const mo = trz.mano_obra || {};
        const obs = Array.isArray(trz.observaciones) ? trz.observaciones : [];
        const ganColor = f.ganancia_total_fila >= 0 ? '#15803d' : '#dc2626';
        const codigoMostrar = f.articulo_id_bunker || f.articulo_numero || f.codigo_barras || '-';
        const lineaCostoBulto = (Number(f.costo_bulto_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaCostoMO = (Number(f.costo_tiempo_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaIvaVenta = (Number(f.iva_venta_unitario) || 0) * (Number(f.cantidad) || 0);
        const lineaIvaCompra = (Number(f.iva_compra_unitario) || 0) * (Number(f.cantidad) || 0);

        // Receta principal
        let bloqueReceta = '';
        if (Array.isArray(trz.receta_ingredientes) && trz.receta_ingredientes.length > 0) {
            const filasIng = trz.receta_ingredientes.map(ing => {
                const det = ing.detalle_origen || {};
                let subDetalleHTML = '';

                // Si tiene artículo puente (ej: MSXK o HTLN4x5)
                if (det.articulo_puente) {
                    const sp = det.articulo_puente;
                    let subRecetaBridge = '';
                    if (Array.isArray(sp.sub_receta) && sp.sub_receta.length > 0) {
                        const bloquesSubMix = sp.sub_receta.map(sr => {
                            let tablaComp = '';
                            if (Array.isArray(sr.composicion_mix) && sr.composicion_mix.length > 0) {
                                const filasComp = sr.composicion_mix.map(c => {
                                    const pctBatch = sr.receta_base_kg > 0 ? ((c.cantidad / sr.receta_base_kg) * 100) : 0;
                                    return `
                                        <tr style="border-bottom:1px solid #e2e8f0;">
                                            <td style="padding:3px 6px;">${escHtmlAudit(c.nombre)}</td>
                                            <td style="padding:3px 6px; text-align:right;">${fmtNumAR(c.cantidad, 3)} ${escHtmlAudit(c.unidad_medida)}</td>
                                            <td style="padding:3px 6px; text-align:right;">${fmtNumAR(pctBatch, 1)}%</td>
                                            <td style="padding:3px 6px; text-align:right;">${fmtMonedaAR(c.costo_patron)}/kg</td>
                                            <td style="padding:3px 6px; text-align:right; font-weight:600;">${fmtMonedaAR(c.subtotal)}</td>
                                        </tr>
                                    `;
                                }).join('');
                                tablaComp = `
                                    <div style="margin-top:5px; padding:6px 8px; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px;">
                                        <div style="font-weight:700; color:#334155; margin-bottom:4px;">
                                            🥣 Composición de Mezcla en Depósito: ${escHtmlAudit(sr.nombre_ingrediente)}
                                            (Batch Base: ${fmtNumAR(sr.receta_base_kg, 2)} kg | Total Batch a Costo Patrón: ${fmtMonedaAR(sr.costo_total_batch_mix)} → <strong>${fmtMonedaAR(sr.costo_kilo_mix_actual)}/kg</strong>)
                                        </div>
                                        <table style="width:100%; border-collapse:collapse; font-size:0.74rem;">
                                            <thead>
                                                <tr style="background:#e2e8f0; color:#334155;">
                                                    <th style="padding:3px 6px; text-align:left;">Ingrediente Base del Mix</th>
                                                    <th style="padding:3px 6px; text-align:right;">Kg en Batch</th>
                                                    <th style="padding:3px 6px; text-align:right;">% Mix</th>
                                                    <th style="padding:3px 6px; text-align:right;">Costo Patrón/Kg</th>
                                                    <th style="padding:3px 6px; text-align:right;">Subtotal Batch</th>
                                                </tr>
                                            </thead>
                                            <tbody>${filasComp}</tbody>
                                        </table>
                                    </div>
                                `;
                            }
                            return tablaComp;
                        }).join('');
                        subRecetaBridge = bloquesSubMix;
                    }

                    subDetalleHTML += `
                        <div style="margin-top:5px; padding:6px 8px; background:#eff6ff; border-left:3px solid #3b82f6; border-radius:4px; font-size:0.77rem;">
                            <div style="font-weight:700; color:#1e40af;">🔗 Artículo Puente / Insumo Madre: [${escHtmlAudit(sp.articulo_id)}] ${escHtmlAudit(sp.descripcion)} (${fmtNumAR(sp.kilos_unidad, 2)} kg)</div>
                            <div style="color:#1e3a8a; margin-top:2px;">
                                Costo Base Lista: <strong>${fmtMonedaAR(sp.costo_base_kilo_lista)}/kg</strong>
                                ${sp.costo_tiempo_lista > 0
                                    ? ` + Mano de Obra Mezclado: <strong>${fmtMonedaAR(sp.costo_tiempo_lista)}/kg</strong> (${escHtmlAudit(sp.mano_obra_operario || 'Operario')}, ${fmtNumAR(sp.mano_obra_minutos, 1)} min a ${fmtMonedaAR(sp.mano_obra_valor_hora)}/h) = Costo Operativo Puente: <strong>${fmtMonedaAR(sp.costo_operativo_kilo)}/kg</strong>`
                                    : ` (Bulto Madre: ${fmtMonedaAR(sp.costo_base_bulto)})`}
                            </div>
                            ${subRecetaBridge}
                        </div>
                    `;
                }

                return `
                    <tr style="border-bottom:1px solid #e2e8f0;">
                        <td style="padding:5px 8px;">
                            <div style="font-weight:600; color:#0f172a;">${escHtmlAudit(ing.nombre_ingrediente)}</div>
                            <div style="font-size:0.73rem; color:#64748b;">
                                ${det.es_insumo ? '🛍️ Insumo de Empaque' : '🌾 Materia Prima / Ingrediente'}
                                ${det.articulo_vinculado_numero ? ` | Art. Vinculado: <code>${escHtmlAudit(det.articulo_vinculado_numero)}</code>` : ''}
                                ${ing.lote_id_ref ? ` | Lote Ref: <code>${escHtmlAudit(ing.lote_id_ref)}</code>` : ''}
                            </div>
                            ${subDetalleHTML}
                        </td>
                        <td style="padding:5px 8px; text-align:right; vertical-align:top;">${fmtNumAR(ing.cantidad, 3)} ${escHtmlAudit(ing.unidad_medida)}</td>
                        <td style="padding:5px 8px; text-align:right; vertical-align:top;">${fmtMonedaAR(ing.costo_patron)}</td>
                        <td style="padding:5px 8px; text-align:right; vertical-align:top; font-weight:700;">${fmtMonedaAR(ing.subtotal)}</td>
                    </tr>
                `;
            }).join('');

            const costoKiloReceta = f.kilos_unidad > 0 ? (trz.costo_total_receta_actual / f.kilos_unidad) : trz.costo_total_receta_actual;
            bloqueReceta = `
                <div style="margin-top:8px;">
                    <div style="font-weight:700; font-size:0.8rem; color:#1e293b; margin-bottom:4px;">
                        📋 Receta Activa #${trz.receta_id || '-'}:
                        <span style="font-weight:500; color:#475569;">(Suma Receta a Costo Patrón: <strong>${fmtMonedaAR(trz.costo_total_receta_actual)}</strong> por bulto de ${fmtNumAR(f.kilos_unidad, 2)} kg = <strong>${fmtMonedaAR(costoKiloReceta)}/kg</strong>)</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:0.78rem; border:1px solid #cbd5e1;">
                        <thead>
                            <tr style="background:#f1f5f9; color:#334155;">
                                <th style="padding:4px 8px; text-align:left;">Ingrediente / Insumo en Receta</th>
                                <th style="padding:4px 8px; text-align:right;">Cantidad</th>
                                <th style="padding:4px 8px; text-align:right;">Costo Unit. Patrón</th>
                                <th style="padding:4px 8px; text-align:right;">Subtotal Receta</th>
                            </tr>
                        </thead>
                        <tbody>${filasIng}</tbody>
                    </table>
                </div>
            `;
        }

        // Lote entrante vinculado
        let bloqueLote = '';
        if (trz.lote_vinculado) {
            const l = trz.lote_vinculado;
            const fechaLote = l.fecha_vinculacion ? new Date(l.fecha_vinculacion).toLocaleDateString('es-AR') : '-';
            bloqueLote = `
                <div style="margin-top:6px; padding:6px 10px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; font-size:0.78rem; color:#166534;">
                    📦 <strong>Lote Entrante Supabase Vinculado:</strong> <code>${escHtmlAudit(l.lote_id_supabase)}</code> |
                    Fecha Vinculación: <strong>${fechaLote}</strong> |
                    Costo Kilo al Momento: <strong>${fmtMonedaAR(l.costo_kilo_al_momento)}/kg</strong> × ${fmtNumAR(f.kilos_unidad, 2)} kg = <strong>${fmtMonedaAR(l.costo_kilo_al_momento * f.kilos_unidad)}</strong>
                </div>
            `;
        }

        // Insumos adicionales de la lista
        let bloqueInsumosLista = '';
        if (Array.isArray(trz.insumos_lista) && trz.insumos_lista.length > 0) {
            const itemsIns = trz.insumos_lista.map(ins => `
                <li>
                    <strong>${escHtmlAudit(ins.descripcion)}</strong> (<code>${escHtmlAudit(ins.codigo)}</code>):
                    ${fmtNumAR(ins.cantidad, 2)} u. × ${fmtMonedaAR(ins.costo_unitario)} = <strong>${fmtMonedaAR(ins.subtotal)}</strong>
                    — <span style="font-weight:700; color:${ins.incluido ? '#15803d' : '#64748b'};">
                        ${ins.incluido ? '✓ Incluido en Costo Bulto de esta Lista' : '✗ Excluido en esta lista'}
                    </span>
                </li>
            `).join('');
            bloqueInsumosLista = `
                <div style="margin-top:6px; padding:6px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; font-size:0.78rem;">
                    <strong>🛍️ Insumos Adicionales Configurados en Lista Búnker (bunker_lista_insumos):</strong>
                    <ul style="margin:3px 0 0 18px; padding:0;">${itemsIns}</ul>
                </div>
            `;
        }

        // Alertas / observaciones de auditoría
        let bloqueAlertas = '';
        if (obs.length > 0) {
            const lis = obs.map(o => `<li style="margin:2px 0;">${escHtmlAudit(typeof o === 'string' ? o : o.mensaje)}</li>`).join('');
            bloqueAlertas = `
                <div style="margin-top:8px; padding:7px 10px; background:#fffbeb; border:1px solid #f59e0b; border-radius:5px; font-size:0.79rem; color:#92400e;">
                    <strong>🔎 Observación de Auditoría de Costos:</strong>
                    <ul style="margin:3px 0 0 18px; padding:0;">${lis}</ul>
                </div>
            `;
        }

        const origenCostoTexto = trz.usa_costo_base_sobrescrito
            ? `Costo Base Lista (${fmtMonedaAR(trz.costo_base_sobrescrito_valor)}/kg × ${fmtNumAR(f.kilos_unidad, 2)} kg)`
            : `${trz.metodo_costo_base || 'Costo Base'} (${fmtMonedaAR(trz.costo_kilo_calculado)}/kg × ${fmtNumAR(f.kilos_unidad, 2)} kg)`;

        return `
            <div style="border:1px solid #cbd5e1; border-radius:8px; margin-bottom:12px; background:#ffffff; overflow:hidden; page-break-inside:avoid;">
                <div style="background:#f1f5f9; padding:8px 12px; border-bottom:1px solid #cbd5e1; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <span style="background:#1e293b; color:#fff; border-radius:4px; padding:2px 6px; font-size:0.75rem; font-weight:700; margin-right:6px;">#${f.orden}</span>
                        <strong style="font-family:monospace; font-size:0.92rem; color:#0f172a;">${escHtmlAudit(codigoMostrar)}</strong>
                        <span style="color:#334155; font-weight:600; margin-left:6px;">— ${escHtmlAudit(f.descripcion)}</span>
                    </div>
                    <div style="font-size:0.82rem;">
                        Cant: <strong>${fmtNumAR(f.cantidad, 2)}</strong> |
                        Peso Bulto: <strong>${fmtNumAR(f.kilos_unidad, 2)} kg</strong> |
                        Ganancia Fila: <strong style="color:${ganColor}; font-size:0.92rem;">${fmtMonedaAR(f.ganancia_total_fila)}</strong>
                        (${fmtNumAR(f.margen_real_sobre_neto_pct, 2)}% s/Neto)
                    </div>
                </div>

                <div style="padding:10px 12px; font-size:0.8rem; color:#334155;">
                    <!-- Ecuación exacta de la fila -->
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap:8px; margin-bottom:8px; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
                        <div>
                            <div style="color:#64748b; font-size:0.72rem;">1. VENTA NETA (s/IVA c/Desc ${fmtNumAR(f.descuento_total_pct, 1)}%)</div>
                            <div style="font-weight:700; color:#0369a1; font-size:0.88rem;">+ ${fmtMonedaAR(f.subtotal_neto_s_iva_con_desc)}</div>
                            <div style="color:#64748b; font-size:0.71rem;">Final c/IVA: ${fmtMonedaAR(f.subtotal_c_iva_con_desc)}</div>
                        </div>
                        <div>
                            <div style="color:#64748b; font-size:0.72rem;">2. COSTO BULTO / INSUMOS</div>
                            <div style="font-weight:700; color:#be123c; font-size:0.88rem;">- ${fmtMonedaAR(lineaCostoBulto)}</div>
                            <div style="color:#64748b; font-size:0.71rem;">${escHtmlAudit(origenCostoTexto)}${f.costo_insumos_lista_unitario > 0 ? ` + Insumos Lista ${fmtMonedaAR(f.costo_insumos_lista_unitario)}` : ''}</div>
                        </div>
                        <div>
                            <div style="color:#64748b; font-size:0.72rem;">3. MANO DE OBRA DIRECTA</div>
                            <div style="font-weight:700; color:#9f1239; font-size:0.88rem;">- ${fmtMonedaAR(lineaCostoMO)}</div>
                            <div style="color:#64748b; font-size:0.71rem;">
                                ${mo.minutos > 0 && lineaCostoMO > 0
                                    ? `${escHtmlAudit(mo.operario_nombre)} (${fmtNumAR(mo.minutos, 1)} min a ${fmtMonedaAR(mo.valor_hora)}/h)`
                                    : 'Sin fraccionado local (Bulto cerrado)'}
                            </div>
                        </div>
                        <div>
                            <div style="color:#64748b; font-size:0.72rem;">4. IIBB (4% s/Final c/IVA)</div>
                            <div style="font-weight:700; color:#6d28d9; font-size:0.88rem;">- ${fmtMonedaAR(f.iibb_total_fila)}</div>
                            <div style="color:#64748b; font-size:0.71rem;">4% de ${fmtMonedaAR(f.subtotal_c_iva_con_desc)}</div>
                        </div>
                        <div>
                            <div style="color:#64748b; font-size:0.72rem;">5. DIFERENCIA IVA (Venta - Compra)</div>
                            <div style="font-weight:700; color:#7c2d12; font-size:0.88rem;">- ${fmtMonedaAR(f.diferencia_iva_total_fila)}</div>
                            <div style="color:#64748b; font-size:0.71rem;">IVA Vta ${fmtMonedaAR(lineaIvaVenta)} - Cpra ${fmtMonedaAR(lineaIvaCompra)}</div>
                        </div>
                        <div style="background:#f0fdf4; padding:4px 8px; border-radius:4px; border:1px solid #bbf7d0;">
                            <div style="color:#166534; font-size:0.72rem; font-weight:700;">= RENTABILIDAD NETA FILA</div>
                            <div style="font-weight:800; color:${ganColor}; font-size:0.95rem;">${fmtMonedaAR(f.ganancia_total_fila)}</div>
                            <div style="color:#15803d; font-size:0.71rem;">Unitario: ${fmtMonedaAR(f.ganancia_unitaria)}</div>
                        </div>
                    </div>

                    <!-- Comparativa de Costos Base -->
                    <div style="font-size:0.76rem; color:#475569; display:flex; flex-wrap:wrap; gap:14px; padding:4px 2px;">
                        <span><strong>Tipología:</strong> ${escHtmlAudit(etiquetaFlujo(f))}</span>
                        <span><strong>Costo Base Bulto Aplicado:</strong> ${fmtMonedaAR(f.costo_bulto_base_unitario)}</span>
                        ${f.costo_insumos_lista_unitario > 0 ? `<span><strong>+ Insumos Lista:</strong> ${fmtMonedaAR(f.costo_insumos_lista_unitario)} = <strong>${fmtMonedaAR(f.costo_bulto_unitario)}</strong></span>` : ''}
                        ${trz.usa_costo_base_sobrescrito ? `<span><strong>Costo Fijado en Lista:</strong> ${fmtMonedaAR(trz.costo_base_sobrescrito_valor)}/kg</span>` : ''}
                        ${trz.costo_base_manual_bunker > 0 ? `<span><strong>Costo Base Ficha Búnker:</strong> ${fmtMonedaAR(trz.costo_base_manual_bunker)}</span>` : ''}
                    </div>

                    ${bloqueLote}
                    ${bloqueReceta}
                    ${bloqueInsumosLista}
                    ${bloqueAlertas}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="auditoria-bunker-report" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#0f172a;">
            <!-- Cabecera del Informe -->
            <div style="background:#0f172a; color:#ffffff; padding:14px 18px; border-radius:8px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:0.74rem; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; font-weight:700;">
                        Sistema LAMDA — Auditoría y Trazabilidad de Rentabilidad Estimada (Búnker)
                    </div>
                    <div style="font-size:1.15rem; font-weight:800; margin-top:2px;">
                        Cliente: ${escHtmlAudit(enc.cliente_nombre || 'Sin especificar')}
                        ${enc.cliente_id ? `<span style="font-weight:400; color:#cbd5e1; font-size:0.9rem;">(ID #${escHtmlAudit(enc.cliente_id)})</span>` : ''}
                    </div>
                    <div style="font-size:0.82rem; color:#cbd5e1; margin-top:4px;">
                        Presupuesto: <strong>${escHtmlAudit(enc.presupuesto_id || 'En edición')}</strong> |
                        Comprobante: <strong>${escHtmlAudit(enc.tipo_comprobante || '-')}</strong> |
                        Lista Búnker Aplicada: <strong>#${escHtmlAudit(enc.lista_bunker_id || '-')} (${escHtmlAudit(enc.lista_bunker_nombre || '-')})</strong> |
                        Descuento General: <strong>${fmtNumAR(enc.descuento_general_pct, 2)}%</strong>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.75rem; color:#94a3b8;">RENTABILIDAD NETA ESTIMADA (BÚNKER)</div>
                    <div style="font-size:1.55rem; font-weight:900; color:#4ade80;">${fmtMonedaAR(tot.rentabilidad_estimada_bunker)}</div>
                    <div style="font-size:0.75rem; color:#cbd5e1;">
                        Margen: <strong>${fmtNumAR(tot.margen_neto_sobre_venta_neta_pct, 2)}%</strong> s/Venta Neta (${fmtNumAR(tot.margen_neto_sobre_total_final_pct, 2)}% s/Total c/IVA)
                    </div>
                </div>
            </div>

            <!-- Tarjetas KPI de Conciliación Financiera -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:14px;">
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#64748b; font-weight:700;">SUBTOTAL BRUTO (c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#334155;">${fmtMonedaAR(tot.subtotal_bruto_c_iva)}</div>
                    <div style="font-size:0.71rem; color:#b45309;">Desc: -${fmtMonedaAR((tot.descuento_general_monto || 0) + (tot.descuentos_especiales_monto || 0))}</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#64748b; font-weight:700;">TOTAL PRESUPUESTO (c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#0f172a;">${fmtMonedaAR(tot.total_final_c_iva)}</div>
                    <div style="font-size:0.71rem; color:#64748b;">IVA Venta: ${fmtMonedaAR(tot.total_iva_venta)}</div>
                </div>
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#0369a1; font-weight:700;">(+) VENTA NETA (s/IVA c/Desc)</div>
                    <div style="font-size:1rem; font-weight:800; color:#0369a1;">${fmtMonedaAR(tot.total_neto_s_iva_con_desc)}</div>
                    <div style="font-size:0.71rem; color:#0284c7;">Base real de ingreso</div>
                </div>
                <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#be123c; font-weight:700;">(-) COSTO OPERATIVO TOTAL</div>
                    <div style="font-size:1rem; font-weight:800; color:#be123c;">-${fmtMonedaAR(tot.total_costo_operativo)}</div>
                    <div style="font-size:0.7rem; color:#9f1239;">Bultos: ${fmtMonedaAR(tot.total_costo_bulto)} | MO: ${fmtMonedaAR(tot.total_costo_tiempo)}</div>
                </div>
                <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#6d28d9; font-weight:700;">(-) IIBB (4% s/Final c/IVA)</div>
                    <div style="font-size:1rem; font-weight:800; color:#6d28d9;">-${fmtMonedaAR(tot.total_iibb)}</div>
                    <div style="font-size:0.7rem; color:#7c3aed;">4% sobre ${fmtMonedaAR(tot.total_final_c_iva)}</div>
                </div>
                <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#9a3412; font-weight:700;">(-) DIFERENCIA IVA</div>
                    <div style="font-size:1rem; font-weight:800; color:#9a3412;">-${fmtMonedaAR(tot.total_diferencia_iva)}</div>
                    <div style="font-size:0.7rem; color:#c2410c;">IVA Vta (${fmtMonedaAR(tot.total_iva_venta)}) - Cpra (${fmtMonedaAR(tot.total_iva_compra)})</div>
                </div>
                <div style="background:#f0fdf4; border:2px solid #22c55e; border-radius:6px; padding:8px 10px;">
                    <div style="font-size:0.71rem; color:#15803d; font-weight:800;">(=) RENTABILIDAD BÚNKER</div>
                    <div style="font-size:1.08rem; font-weight:900; color:#15803d;">${fmtMonedaAR(tot.rentabilidad_estimada_bunker)}</div>
                    <div style="font-size:0.7rem; color:#166534;">Emitido: ${escHtmlAudit(fechaGen)}</div>
                </div>
            </div>

            <!-- Explicación de la Fórmula Aplicada -->
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-left:4px solid #0284c7; border-radius:6px; padding:8px 12px; margin-bottom:14px; font-size:0.79rem; color:#334155;">
                <strong>📐 Fórmula Exacta del Motor de Rentabilidad Búnker (por línea):</strong><br>
                <code>Rentabilidad Fila = Venta Neta s/IVA (c/Desc) − Costo Bulto (Mercadería + Envase) − Mano de Obra Directa − IIBB (4% s/Precio Final c/IVA) − Máx(0, IVA Venta − IVA Compra 21% s/Costo Bulto)</code>
            </div>

            <!-- 1. Planilla General Resumen -->
            <h3 style="margin:0 0 8px 0; font-size:0.95rem; color:#0f172a; border-bottom:2px solid #0f172a; padding-bottom:4px;">
                1. Planilla de Desglose por Producto (Conciliación de los ${fmtMonedaAR(tot.rentabilidad_estimada_bunker)})
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
                            <td style="padding:8px 6px; text-align:right;">${fmtNumAR(totalUnidades, 2)}</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtMonedaAR(tot.subtotal_bruto_c_iva)}</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtNumAR(enc.descuento_general_pct, 2)}%</td>
                            <td style="padding:8px 6px; text-align:right;">${fmtMonedaAR(tot.total_final_c_iva)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#7dd3fc;">${fmtMonedaAR(tot.total_neto_s_iva_con_desc)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fda4af;">${fmtMonedaAR(tot.total_costo_bulto)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fda4af;">${fmtMonedaAR(tot.total_costo_tiempo)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fecdd3;">${fmtMonedaAR(tot.total_costo_operativo)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#ddd6fe;">${fmtMonedaAR(tot.total_iibb)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#fed7aa;">${fmtMonedaAR(tot.total_diferencia_iva)}</td>
                            <td style="padding:8px 8px; text-align:right; color:#4ade80; font-size:0.95rem;">${fmtMonedaAR(tot.rentabilidad_estimada_bunker)}</td>
                            <td style="padding:8px 6px; text-align:right; color:#4ade80;">${fmtNumAR(tot.margen_neto_sobre_venta_neta_pct, 2)}%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <!-- 2. Trazabilidad Profunda por Producto -->
            <h3 style="margin:0 0 8px 0; font-size:0.95rem; color:#0f172a; border-bottom:2px solid #0f172a; padding-bottom:4px;">
                2. Trazabilidad Detallada de Costos por Producto (Recetas, Lotes, Mezclas y Mano de Obra)
            </h3>
            <div>
                ${fichasTrazabilidadHTML}
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
                        <button type="button" onclick="window.imprimirInformeAuditoriaRentabilidadBunker()" style="background:#2563eb; color:#ffffff; border:none; border-radius:6px; padding:7px 13px; font-weight:700; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 1px 2px rgba(0,0,0,0.2);">
                            📄 Informe PDF / Imprimir
                        </button>
                        <button type="button" onclick="window.exportarCSVAuditoriaRentabilidadBunker()" style="background:#059669; color:#ffffff; border:none; border-radius:6px; padding:7px 13px; font-weight:700; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 1px 2px rgba(0,0,0,0.2);">
                            📊 Descargar Planilla CSV (Excel)
                        </button>
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
                <strong>❌ Error al generar el informe de auditoría:</strong> ${escHtmlAudit(err.message)}
            </div>
        `;
    }
};

window.imprimirInformeAuditoriaRentabilidadBunker = function () {
    const data = window.__ultimaAuditoriaRentabilidadBunker;
    if (!data) {
        alert('Primero abra el informe de auditoría para cargar los datos.');
        return;
    }

    const contenidoHTML = window.construirHTMLContenidoAuditoriaBunker(data, true);
    const enc = data.cabecera || data.encabezado || {};
    const cliente = enc.cliente_nombre || 'Cliente';
    const presId = enc.presupuesto_id || '';
    const ventana = window.open('', '_blank', 'width=1200,height=850');
    if (!ventana) {
        alert('Por favor habilite las ventanas emergentes para generar el PDF.');
        return;
    }

    ventana.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Auditoría Rentabilidad Búnker - ${escHtmlAudit(cliente)} ${escHtmlAudit(presId)}</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                body { margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; color: #0f172a; }
                .no-print-bar {
                    background: #1e293b; color: #fff; padding: 10px 16px; margin-bottom: 14px; border-radius: 8px;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .no-print-bar button {
                    background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 16px;
                    font-weight: 700; cursor: pointer; font-size: 0.9rem;
                }
                @media print {
                    .no-print-bar { display: none !important; }
                    body { padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="no-print-bar">
                <div><strong>📄 Vista Previa de Informe PDF — Auditoría de Rentabilidad Búnker</strong> (Seleccione "Guardar como PDF" en el diálogo de impresión)</div>
                <div style="display:flex; gap:8px;">
                    <button onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
                    <button style="background:#475569;" onclick="window.close()">✕ Cerrar</button>
                </div>
            </div>
            ${contenidoHTML}
            <script>
                window.addEventListener('load', function() {
                    setTimeout(function() { window.print(); }, 350);
                });
            <\/script>
        </body>
        </html>
    `);
    ventana.document.close();
};

window.exportarCSVAuditoriaRentabilidadBunker = function () {
    const data = window.__ultimaAuditoriaRentabilidadBunker;
    if (!data) {
        alert('Primero abra el informe de auditoría para cargar los datos.');
        return;
    }

    const enc = data.cabecera || data.encabezado || {};
    const tot = data.totales || {};
    const filas = Array.isArray(data.filas) ? data.filas : [];
    const totalUnidades = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0);

    const fmtCSVNum = (n, dec = 2) => {
        const val = Number(n);
        if (!Number.isFinite(val)) return '0,00';
        return val.toFixed(dec).replace('.', ',');
    };
    const escCSV = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

    const lineas = [];
    lineas.push(['AUDITORIA Y TRAZABILIDAD DE RENTABILIDAD ESTIMADA (BUNKER) - SISTEMA LAMDA'].map(escCSV).join(';'));
    lineas.push([
        'Cliente', enc.cliente_nombre || '',
        'ID Cliente', enc.cliente_id || '',
        'Presupuesto', enc.presupuesto_id || '',
        'Comprobante', enc.tipo_comprobante || '',
        'Lista Bunker', `#${enc.lista_bunker_id || ''} (${enc.lista_bunker_nombre || ''})`,
        'Desc. General %', fmtCSVNum(enc.descuento_general_pct, 2)
    ].map(escCSV).join(';'));
    lineas.push('');

    // Encabezados de la planilla principal
    lineas.push([
        '#',
        'Codigo Bunker',
        'Codigo Barras / Input',
        'Descripcion',
        'Peso Bulto (Kg)',
        'Metodo Costo Base',
        'Cantidad',
        'P.Unit Lista (s/IVA)',
        'P.Unit Lista (c/IVA)',
        'Desc. Total %',
        'P.Unit c/Desc (c/IVA)',
        'P.Unit Neto c/Desc (s/IVA)',
        'Total Linea Final (c/IVA)',
        '(+) Venta Neta Linea (s/IVA)',
        '(-) Costo Bulto Linea',
        '(-) Mano Obra Linea',
        '(=) Costo Operativo Linea',
        '(-) IIBB 4% Linea',
        'IVA Venta Linea',
        'IVA Compra 21% Linea',
        '(-) Diferencia IVA Linea',
        '(=) Ganancia Neta Fila ($)',
        'Margen s/Neto (%)',
        'Operario Fraccionado',
        'Minutos Fraccionado',
        'Tarifa Hora Operario ($)',
        'Observaciones de Auditoria'
    ].map(escCSV).join(';'));

    filas.forEach(f => {
        const trz = f.trazabilidad || {};
        const mo = trz.mano_obra || {};
        const obs = (trz.observaciones || []).map(o => typeof o === 'string' ? o : o.mensaje).join(' | ');
        const cant = Number(f.cantidad) || 0;
        lineas.push([
            f.orden,
            f.articulo_id_bunker || f.articulo_numero || '',
            f.codigo_barras || '',
            f.descripcion,
            fmtCSVNum(f.kilos_unidad, 2),
            trz.metodo_costo_base || '',
            fmtCSVNum(cant, 2),
            fmtCSVNum(f.valor_unitario_neto_sin_desc, 2),
            fmtCSVNum(f.precio_unitario_c_iva_sin_desc, 2),
            fmtCSVNum(f.descuento_total_pct, 2),
            fmtCSVNum(f.precio_unitario_c_iva_con_desc, 2),
            fmtCSVNum(f.neto_unitario_s_iva_con_desc, 2),
            fmtCSVNum(f.subtotal_c_iva_con_desc, 2),
            fmtCSVNum(f.subtotal_neto_s_iva_con_desc, 2),
            fmtCSVNum((f.costo_bulto_unitario || 0) * cant, 2),
            fmtCSVNum((f.costo_tiempo_unitario || 0) * cant, 2),
            fmtCSVNum(f.costo_operativo_total_fila, 2),
            fmtCSVNum(f.iibb_total_fila, 2),
            fmtCSVNum((f.iva_venta_unitario || 0) * cant, 2),
            fmtCSVNum((f.iva_compra_unitario || 0) * cant, 2),
            fmtCSVNum(f.diferencia_iva_total_fila, 2),
            fmtCSVNum(f.ganancia_total_fila, 2),
            fmtCSVNum(f.margen_real_sobre_neto_pct, 2),
            mo.operario_nombre || '',
            fmtCSVNum(mo.minutos || 0, 2),
            fmtCSVNum(mo.valor_hora || 0, 2),
            obs
        ].map(escCSV).join(';'));
    });

    // Fila de Totales
    lineas.push([
        'TOTALES',
        '',
        '',
        'TOTALES CONCILIADOS',
        '',
        '',
        fmtCSVNum(totalUnidades, 2),
        '',
        fmtCSVNum(tot.subtotal_bruto_c_iva, 2),
        fmtCSVNum(enc.descuento_general_pct, 2),
        '',
        '',
        fmtCSVNum(tot.total_final_c_iva, 2),
        fmtCSVNum(tot.total_neto_s_iva_con_desc, 2),
        fmtCSVNum(tot.total_costo_bulto, 2),
        fmtCSVNum(tot.total_costo_tiempo, 2),
        fmtCSVNum(tot.total_costo_operativo, 2),
        fmtCSVNum(tot.total_iibb, 2),
        fmtCSVNum(tot.total_iva_venta, 2),
        fmtCSVNum(tot.total_iva_compra, 2),
        fmtCSVNum(tot.total_diferencia_iva, 2),
        fmtCSVNum(tot.rentabilidad_estimada_bunker, 2),
        fmtCSVNum(tot.margen_neto_sobre_venta_neta_pct, 2),
        '',
        '',
        '',
        ''
    ].map(escCSV).join(';'));

    lineas.push('');
    lineas.push(['DESGLOSE DE TRAZABILIDAD DE RECETAS, SUB-RECETAS Y LOTES POR PRODUCTO'].map(escCSV).join(';'));
    lineas.push([
        'Fila',
        'Codigo Producto',
        'Producto',
        'Tipo Componente',
        'Detalle / Ingrediente / Lote',
        'Cantidad',
        'Unidad',
        'Costo Unitario ($)',
        'Subtotal ($)'
    ].map(escCSV).join(';'));

    filas.forEach(f => {
        const trz = f.trazabilidad || {};
        const cod = f.articulo_id_bunker || f.articulo_numero || f.codigo_barras || '';
        if (trz.lote_vinculado) {
            const l = trz.lote_vinculado;
            lineas.push([
                f.orden,
                cod,
                f.descripcion,
                'Lote Entrante Supabase',
                `Lote ${l.lote_id_supabase} (${l.fecha_vinculacion ? new Date(l.fecha_vinculacion).toLocaleDateString('es-AR') : '-'})`,
                fmtCSVNum(f.kilos_unidad, 2),
                'kg',
                fmtCSVNum(l.costo_kilo_al_momento, 2),
                fmtCSVNum(l.costo_kilo_al_momento * f.kilos_unidad, 2)
            ].map(escCSV).join(';'));
        }
        if (Array.isArray(trz.receta_ingredientes)) {
            trz.receta_ingredientes.forEach(ing => {
                lineas.push([
                    f.orden,
                    cod,
                    f.descripcion,
                    `Receta #${trz.receta_id || '-'}`,
                    ing.nombre_ingrediente,
                    fmtCSVNum(ing.cantidad, 3),
                    ing.unidad_medida,
                    fmtCSVNum(ing.costo_patron, 2),
                    fmtCSVNum(ing.subtotal, 2)
                ].map(escCSV).join(';'));

                const sp = ing.detalle_origen?.articulo_puente;
                if (sp && Array.isArray(sp.sub_receta)) {
                    sp.sub_receta.forEach(sr => {
                        if (Array.isArray(sr.composicion_mix)) {
                            sr.composicion_mix.forEach(c => {
                                lineas.push([
                                    f.orden,
                                    cod,
                                    f.descripcion,
                                    `  ↳ Composicion Mix (${sr.nombre_ingrediente} via ${sp.articulo_id})`,
                                    c.nombre,
                                    fmtCSVNum(c.cantidad, 3),
                                    `${c.unidad_medida} (en batch ${sr.receta_base_kg}kg)`,
                                    fmtCSVNum(c.costo_patron, 2),
                                    fmtCSVNum(c.subtotal, 2)
                                ].map(escCSV).join(';'));
                            });
                        }
                    });
                }
            });
        }
        if (Array.isArray(trz.insumos_lista)) {
            trz.insumos_lista.forEach(ins => {
                lineas.push([
                    f.orden,
                    cod,
                    f.descripcion,
                    `Insumo Lista Bunker (${ins.incluido ? 'Incluido' : 'Excluido'})`,
                    `${ins.descripcion} (${ins.codigo})`,
                    fmtCSVNum(ins.cantidad, 2),
                    'u',
                    fmtCSVNum(ins.costo_unitario, 2),
                    fmtCSVNum(ins.subtotal, 2)
                ].map(escCSV).join(';'));
            });
        }
    });

    const csvContent = '\uFEFF' + lineas.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (enc.cliente_nombre || 'presupuesto').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.href = url;
    a.download = `Auditoria_Rentabilidad_Bunker_${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

