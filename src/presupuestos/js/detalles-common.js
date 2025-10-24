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
    setupArticuloAutocomplete: setupArticuloAutocomplete
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
                    <input type="text" name="detalles[${window.Detalles.detalleCounter}][articulo]"
                        placeholder="Código o descripción del artículo" required>
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][cantidad]"
                        min="0.01" step="0.01" placeholder="1" required
                        onchange="window.Detalles.calcularPrecio(${window.Detalles.detalleCounter})">
                </td>
                <td>
                    <input type="number" name="detalles[${window.Detalles.detalleCounter}][valor1]"
                        min="0" step="0.01" placeholder="0.00" required
                        onchange="window.Detalles.calcularPrecio(${window.Detalles.detalleCounter})">
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

                <td>
                    <button type="button" class="btn-remove-detalle"
                            onclick="window.Detalles.removerDetalle(${window.Detalles.detalleCounter})"
                            ${tbody.children.length === 0 ? 'disabled' : ''}>
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
 */
function removerDetalle(id) {
    console.log(`🗑️ [DETALLES-COMMON] Removiendo detalle ${id}...`);

    const row = document.getElementById(`detalle-${id}`);
    const tbody = document.getElementById('detalles-tbody');

    if (!tbody) {
        console.error('❌ [DETALLES-COMMON] #detalles-tbody no existe');
        return;
    }

    // No permitir eliminar si es la única fila
    if (tbody.children.length <= 1) {
        window.Detalles.mostrarMensaje('Debe mantener al menos un artículo en el presupuesto', 'error');
        return;
    }

    if (row) {
        row.remove();
        console.log(`✅ [DETALLES-COMMON] Detalle ${id} removido`);
    }
}

/**
 * Calcular precio con IVA
 */
function calcularPrecio(detalleId) {
    const cantidadInput = document.querySelector(`input[name="detalles[${detalleId}][cantidad]"]`);
    const valor1Input = document.querySelector(`input[name="detalles[${detalleId}][valor1]"]`);
    const iva1Input = document.querySelector(`input[name="detalles[${detalleId}][iva1]"]`);
    const precio1Input = document.querySelector(`input[name="detalles[${detalleId}][precio1]`);

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
  setNumeric(el, val, 2, 1);
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

// ===== FUNCIONES DE AUTOCOMPLETAR DE CLIENTES =====

/**
 * Configurar autocompletar de clientes
 */
function setupClienteAutocomplete() {
    console.log('🔍 [DETALLES-COMMON] Configurando autocompletar de clientes...');

    const input = document.getElementById('id_cliente');
    const sugerenciasContainer = document.getElementById('cliente-sugerencias');

    if (!input || !sugerenciasContainer) {
        console.error('❌ [DETALLES-COMMON] Elementos de autocompletar no encontrados');
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
            event.preventDefault();
            if (window.Detalles.selectedIndex >= 0 && items[window.Detalles.selectedIndex]) {
                seleccionarCliente(items[window.Detalles.selectedIndex]);
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

function filtrarArticulosLocal(query, items) {
  const terms = normalizarTexto(query).split(/\s+/).filter(Boolean);

  const out = (items || []).filter(a => {
    const blob = normalizarTexto(
      [a.description ?? a.descripcion ?? '', a.articulo_numero ?? '', a.codigo_barras ?? ''].join(' ')
    );
    // AND: todos los términos deben estar
    return terms.every(t => blob.includes(t));
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

  // Limite visual (podés subirlo a 100 si querés)
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
 * Manejar input de artículo con debounce
 */
const handleArticuloInput = debounce(async function(event) {
  const input = event.target;
  const query = (input.value || '').trim();

  console.log(`[ARTICULOS] Búsqueda de artículo: "${query}"`);

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
        const response = await fetch(`/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(query)}&limit=200`);
        if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
        const body = await response.json();
        const arr = Array.isArray(body) ? body : (body.data || body.items || []);
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
    const stockClass = (articulo.stock_consolidado ?? 0) <= 0 ? 'sin-stock' : 'con-stock';
    const label = (articulo.description ?? articulo.descripcion ?? '').toString();
    const safeLabel = label.replace(/"/g, '"');

    const etiquetas = (articulo.etiquetas && articulo.etiquetas.length > 0)
      ? `<span class="articulo-etiquetas">${articulo.etiquetas.join(' ')}</span>`
      : '';

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
  if (iva1Input && (iva1Input.value === '' || isNaN(parseFloat(iva1Input.value))))   setNumeric(iva1Input, 21, 2, 21);
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
      iva   = Number(body?.data?.iva);
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
        iva   = Number(body2?.data?.iva);
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

// ===== FUNCIONES DE UTILIDADES =====

/**
 * Normalizar texto para búsqueda
 */
function normalizarTexto(texto) {
  return (texto || '').toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    .replace(/[^\w\s]/g, ' ') // Reemplazar caracteres especiales por espacios
    .replace(/\s+/g, ' ') // Normalizar espacios múltiples
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
