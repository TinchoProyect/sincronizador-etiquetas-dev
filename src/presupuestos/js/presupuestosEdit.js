// Encapsular todo el código del editor en IIFE para evitar conflictos con el módulo común
(function() {
  console.log('[EDIT] Cargando módulo de edición...');

  // Variables globales del editor
  let presupuestoId = null;
  let presupuestoData = null;
  let detallesData = [];
  let clienteSeleccionado = null;
  let currentRequest = null;
  let selectedIndex = -1;
  let detalleCounter = 0; // Contador para IDs de detalles

  // Exponer funciones para compatibilidad
  window.agregarDetalle = agregarDetalle;
  window.removerDetalle = removerDetalle;
  window.seleccionarArticuloPorClick = seleccionarArticuloPorClick;
  window.seleccionarArticulo = seleccionarArticulo;
  window.seleccionarClientePorClick = seleccionarClientePorClick;

  // --- EXPORTS necesarios para handlers inline ---
  window.calcularPrecio = calcularPrecio;     // onchange="calcularPrecio(id)"
  window.recalcTotales = recalcTotales;       // por si lo usás desde fuera

  // --- Render helper llamado después de cargar datos ---
  function renderDetallesConModuloComun() {
    // Si más adelante exponés un render del módulo común, usalo acá.
    // Por ahora hacemos fallback al renderer propio:
    renderDetallesDesdeBD();
  }

  // === UI core compartido con "Crear" (copiado y reducido) ===

  // Moneda ARS
  const fmtARS = new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', minimumFractionDigits:2, maximumFractionDigits:2 });
  const formatARS = n => Number.isFinite(+n) ? fmtARS.format(+n) : '$ 0,00';

  function dispatchRecalc(el){ try{ el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }catch(_){ } }
  function setNumeric(el,val,dec=2,fallback=0){ const n=Number(val); el.value=Number.isFinite(n)?n.toFixed(dec):Number(fallback).toFixed(dec); dispatchRecalc(el); }
  function setCantidad(el,val){ setNumeric(el,val,2,1); }
  function getDetalleIdFromInput(input){ const m=(input?.name||'').match(/\[(\d+)\]\[/); return m?parseInt(m[1],10):null; }

  function updatePrecioDisplay(id, pvu){ const d=document.querySelector(`input[data-precio-display="${id}"]`); if(d) d.value = formatARS(pvu); }
  function updateSubtotalDisplay(id, st){ const d=document.querySelector(`input[data-subtotal-display="${id}"]`); if(d) d.value = formatARS(st); }

  // Convierte "10.940,92" -> 10940.92, "21,00" -> 21,  "21" -> 21
  function toNum(x) {
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (typeof x === 'string') {
      const s = x.trim().replace(/\./g, '').replace(',', '.'); // quita miles y cambia coma por punto
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  // Igual a Crear: agrega una fila con mismos names/estructura
  function agregarDetalle(){
    const tbody = document.getElementById('detalles-tbody');
    if(!tbody) return;
    detalleCounter++;
    const row = document.createElement('tr');
    row.id = `detalle-${detalleCounter}`;
    row.innerHTML = `
      <td><input type="text" class="articulo-input" name="detalles[${detalleCounter}][articulo]" placeholder="Código o descripción del artículo" required></td>
      <td><input type="number" name="detalles[${detalleCounter}][cantidad]" min="0.01" step="0.01" placeholder="1" required onchange="calcularPrecio(${detalleCounter})"></td>
      <td><input type="number" name="detalles[${detalleCounter}][valor1]" min="0" step="0.01" placeholder="0.00" required onchange="calcularPrecio(${detalleCounter})"></td>
      <td><input type="number" name="detalles[${detalleCounter}][iva1]" min="0" max="100" step="0.01" placeholder="21.00" onchange="calcularPrecio(${detalleCounter})"></td>
      <td>
        <input type="hidden" name="detalles[${detalleCounter}][precio1]" class="precio1-hidden">
        <input type="text" class="precio-calculado" data-precio-display="${detalleCounter}" value="$ 0,00" readonly>
      </td>
      <td><input type="text" class="subtotal-display" data-subtotal-display="${detalleCounter}" value="$ 0,00" readonly></td>
      <td><button type="button" class="btn-remove-detalle" onclick="removerDetalle(${detalleCounter})">🗑️</button></td>
    `;
    tbody.appendChild(row);
    row.querySelector(`[name="detalles[${detalleCounter}][iva1]"]`).value = '21.00';
    row.querySelector(`[name="detalles[${detalleCounter}][cantidad]"]`).value = '1';
  }

  function calcularPrecio(detalleId){
    const q = +document.querySelector(`input[name="detalles[${detalleId}][cantidad]"]`)?.value || 0;
    const v = +document.querySelector(`input[name="detalles[${detalleId}][valor1]"]`)?.value || 0;
    const ivaPct = +document.querySelector(`input[name="detalles[${detalleId}][iva1]"]`)?.value || 0;
    const precio1El = document.querySelector(`input[name="detalles[${detalleId}][precio1]"]`);
    const pvu = v * (1 + ivaPct/100);
    if(precio1El) precio1El.value = pvu.toFixed(2);
    updatePrecioDisplay(detalleId, pvu);
    updateSubtotalDisplay(detalleId, pvu*q);
  }

  function recalcTotales(){
    const tbody = document.getElementById('detalles-tbody'); if(!tbody) return;
    let bruto = 0;
    tbody.querySelectorAll('tr').forEach(row=>{
      const q = +row.querySelector('input[name*="[cantidad]"]')?.value || 0;
      const p = +row.querySelector('input[name*="[precio1]"]')?.value || 0;
      bruto += q*p;
    });
    const dEl = document.getElementById('descuento'); const pct = Math.max(0, Math.min(100, +(dEl?.value||0)));
    const desc = bruto * (pct/100);
    const total = bruto - desc;
    const set = (sel, val)=>{ document.querySelectorAll(sel).forEach(el=> el.tagName==='INPUT'? el.value=val: el.textContent=val); };
    set('#total-bruto,[data-total="bruto"]', formatARS(bruto));
    set('#total-descuento,[data-total="descuento"]', formatARS(desc));
    set('#total-final,[data-total="final"]', formatARS(total));
  }

  // listeners para recalcular como en Crear
  document.addEventListener('input', (e)=>{
    const n = e.target?.name || '';
    if (/\[(cantidad|valor1|iva1)\]/.test(n)){
      const id = getDetalleIdFromInput(e.target);
      if(id!=null){ calcularPrecio(id); recalcTotales(); }
    } else if (e.target?.id === 'descuento'){ recalcTotales(); }
  });
  (() => {
    const tbody = document.getElementById('detalles-tbody');
    if(!tbody) return;
    new MutationObserver(()=>recalcTotales()).observe(tbody,{childList:true});
  })();

  // Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('📋 [PRESUPUESTOS-EDIT] Inicializando página de edición...');

    // Loguear estado del módulo común para debugging
    console.log('🔍 [PRESUPUESTOS-EDIT] Estado del módulo Detalles:', {
        disponible: !!window.Detalles,
        calcularPrecio: typeof window.Detalles?.calcularPrecio,
        recalcTotales: typeof window.Detalles?.recalcTotales
    });

    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');

    if (!presupuestoId) {
        console.log('[EDIT] Falta id en querystring y no se puede continuar');
        mostrarMensaje('❌ No se especificó el ID del presupuesto a editar', 'error');
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
        ivaInput.value = (Number(target) || 0).toFixed(2);

        // Recalcular precio para esta fila
        const idx = Number(row.id?.split('-')[1]);
        if (!Number.isNaN(idx)) {
            calcularPrecio(idx);
        }
    }
    function applyIvaModeToAllRows() {
        document.querySelectorAll('#detalles-tbody tr').forEach(applyIvaModeToRow);
        recalcTotales();
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
    if (typeof setupClienteAutocomplete === 'function') {
        setupClienteAutocomplete();
    }

    // Configurar autocompletar para artículos usando módulo común
    if (typeof setupArticuloAutocomplete === 'function') {
        setupArticuloAutocomplete();
    }

    // Cargar datos del presupuesto y detalles en paralelo
    Promise.all([cargarPresupuesto(), cargarDetallesPresupuesto()]).then(() => {
        console.log('[EDIT] encabezado OK');
        console.log(`[EDIT] detalles: ${detallesData.length} filas`);

        // Renderizar detalles usando módulo común
        renderDetallesConModuloComun();

        // Aplicar modo IVA y recalcular totales
        applyIvaModeToAllRows();
        if (typeof recalcTotales === 'function') recalcTotales();
    }).catch(error => {
        console.error('[EDIT] Error cargando datos:', error);
    });

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

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar presupuesto:', error);
        mostrarMensaje(`❌ Error al cargar el presupuesto: ${error.message}`, 'error');
    }
}

/**
 * Normalizar detalle del backend al formato esperado por el frontend
 */
  function normalizarDetalle(d) {
    // mapeos tolerantes a nombres distintos que pueden venir del back
    const ivaRaw = d?.iva1 ?? d?.iva ?? d?.iva_porcentaje ?? 0;
    const ivaPct = toNum(ivaRaw);
    const ivaDecimal = ivaPct > 1 ? ivaPct / 100 : ivaPct; // 21 -> 0.21, 0.21 queda igual

    const netoRaw = d?.valor1 ?? d?.neto ?? d?.valor_neto ?? d?.precio_neto ?? 0;
    const neto = toNum(netoRaw);

    const pvuRaw = d?.precio1 ?? d?.pvu ?? d?.precio_final;
    const pvu = toNum(pvuRaw) || (neto * (1 + ivaDecimal));

    return {
      // códigos
      codigo_barras: d?.codigo_barras ?? d?.cod_barra ?? d?.codigo ?? d?.articulo ?? d?.articulo_numero ?? '',
      articulo_numero: d?.articulo_numero ?? d?.articulo ?? '',
      // descripción (probamos varias claves comunes)
      descripcion: d?.detalle ?? d?.descripcion ?? d?.articulo_descripcion ?? d?.nombre ?? '',
      // números
      cantidad: toNum(d?.cantidad),
      valor1: neto,            // neto sin IVA
      iva1: ivaDecimal,        // decimal (0.21)
      precio1: pvu             // unitario con IVA
    };
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
            const data = result.data;
            const lista = Array.isArray(data) ? data : (Array.isArray(data?.detalles) ? data.detalles : []);
            detallesData = lista.map(normalizarDetalle);

            const detallesCount = detallesData.length;
            document.getElementById('info-detalles').textContent = `${detallesCount} artículos`;
            console.log(`📦 [PRESUPUESTOS-EDIT] Detalles cargados: ${detallesCount} artículos`);
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
    console.log('[EDIT] Llenando campos editables...');

    // Normalizar descuento a número
    const descuentoNormalizado = parseFloat(presupuestoData.descuento) || 0;

    document.getElementById('id_cliente').value = presupuestoData.id_cliente || '';
    document.getElementById('fecha').value = presupuestoData.fecha ? presupuestoData.fecha.split('T')[0] : '';
    document.getElementById('tipo_comprobante').value = presupuestoData.tipo_comprobante || 'Factura';
    document.getElementById('estado').value = presupuestoData.estado || 'Presupuesto/Orden';
    document.getElementById('agente').value = presupuestoData.agente || '';
    document.getElementById('punto_entrega').value = presupuestoData.punto_entrega || '';
    document.getElementById('descuento').value = descuentoNormalizado;
    document.getElementById('nota').value = presupuestoData.nota || '';

    // Fecha de entrega (convertir formato si es necesario)
    if (presupuestoData.fecha_entrega) {
        const fechaEntrega = new Date(presupuestoData.fecha_entrega);
        if (!isNaN(fechaEntrega.getTime())) {
            document.getElementById('fecha_entrega').value = fechaEntrega.toISOString().split('T')[0];
        }
    }

    console.log('[EDIT] Campos editables llenados');
}

/**
 * Renderizar detalles desde BD usando la nueva estructura
 */
function renderDetallesDesdeBD(){
  const tbody = document.getElementById('detalles-tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  detalleCounter = 0;

  const tipoSel = document.getElementById('tipo_comprobante');
  const esRemito = () => tipoSel && tipoSel.value === 'Remito-Efectivo';

  detallesData.forEach(det=>{
    // det.iva1 viene decimal (0.21) desde normalizarDetalle => convertir a %
    const ivaPctBase = (det.iva1 > 1 ? det.iva1 : det.iva1*100) || 0;
    const ivaPctVisible = esRemito()? (ivaPctBase/2) : ivaPctBase;

    agregarDetalle();
    const idx = detalleCounter; // el que acaba de agregarse

    const row = document.getElementById(`detalle-${idx}`);
    const artInput   = row.querySelector(`input[name="detalles[${idx}][articulo]"]`);
    const cantInput  = row.querySelector(`input[name="detalles[${idx}][cantidad]"]`);
    const valorInput = row.querySelector(`input[name="detalles[${idx}][valor1]"]`);
    const ivaInput   = row.querySelector(`input[name="detalles[${idx}][iva1]"]`);
    const precio1El  = row.querySelector(`input[name="detalles[${idx}][precio1]"]`);

    // Mostrar DESCRIPCIÓN al usuario y guardar CODIGO DE BARRAS en dataset (igual que Crear)
    if (artInput){
      artInput.value = det.descripcion || det.codigo_barras || '';
      artInput.dataset.codigoBarras = det.codigo_barras || '';
      artInput.dataset.articuloNumero = det.articulo_numero || '';
    }

    if (cantInput)  setCantidad(cantInput, det.cantidad || 1);
    if (valorInput) setNumeric(valorInput, det.valor1 || 0, 2, 0);
    if (ivaInput){
      ivaInput.dataset.ivaBase = String(ivaPctBase);  // base real para Remito
      setNumeric(ivaInput, ivaPctVisible, 2, 21);
    }

    // Precio unit. con IVA (si vino) o lo recalculamos
    const pvu = (det.precio1 && det.precio1>0)
      ? det.precio1
      : (det.valor1||0) * (1 + (ivaPctBase/100));
    if (precio1El) precio1El.value = (+pvu).toFixed(2);

    calcularPrecio(idx); // también actualiza displays y subtotal
  });

  recalcTotales();
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
 * Seleccionar artículo del autocompletar
 */
function seleccionarArticulo(articulo, detalleIndex) {
    console.log('📦 [PRESUPUESTOS-EDIT] Seleccionando artículo:', articulo, 'para detalle:', detalleIndex);

    // Encontrar la fila correspondiente usando el detalleIndex como ID de fila
    const row = document.getElementById(`detalle-${detalleIndex}`);
    if (!row) {
        console.error('❌ [PRESUPUESTOS-EDIT] Fila de detalle no encontrada:', detalleIndex);
        return;
    }

    // Actualizar inputs de la fila
    const artInput = row.querySelector(`input[name="detalles[${detalleIndex}][articulo]"]`);
    const valorInput = row.querySelector(`input[name="detalles[${detalleIndex}][valor1]"]`);
    const ivaInput = row.querySelector(`input[name="detalles[${detalleIndex}][iva1]"]`);
    const cantInput = row.querySelector(`input[name="detalles[${detalleIndex}][cantidad]"]`);

    if (artInput) {
        artInput.value = articulo.descripcion || articulo.nombre || '';
        artInput.dataset.codigoBarras = articulo.codigo_barras || '';
        artInput.dataset.articuloNumero = articulo.articulo_numero || '';
    }

    if (valorInput) {
        setNumeric(valorInput, parseFloat(articulo.precio) || 0, 2, 0);
    }

    if (ivaInput) {
        setNumeric(ivaInput, parseFloat(articulo.iva) || 0, 2, 21);
    }

    if (cantInput && (!cantInput.value || parseFloat(cantInput.value) <= 0)) {
        setCantidad(cantInput, 1);
    }

    console.log('✅ [PRESUPUESTOS-EDIT] Artículo seleccionado y datos actualizados');

    // Recalcular precio para esta fila
    calcularPrecio(detalleIndex);
    recalcTotales();
}

/**
 * Seleccionar artículo por click (función legacy para compatibilidad)
 */
function seleccionarArticuloPorClick(event) {
    const articuloData = event.target.closest('.articulo-sugerencia-item')?.dataset;
    if (!articuloData) return;

    const articulo = {
        descripcion: articuloData.descripcion || '',
        precio: parseFloat(articuloData.precio) || 0,
        iva: parseFloat(articuloData.iva) || 0,
        codigo_barras: articuloData.codigo_barras || '',
        articulo_numero: articuloData.articulo_numero || ''
    };

    // Obtener el ID de detalle desde el botón más cercano
    const detalleId = getDetalleIdFromInput(event.target.closest('tr')?.querySelector('input[name*="articulo"]'));
    if (detalleId !== null) {
        seleccionarArticulo(articulo, detalleId);
    }
}

/**
 * Remover detalle (función legacy para compatibilidad)
 */
function removerDetalle(detalleId) {
    const row = document.getElementById(`detalle-${detalleId}`);
    if (row) {
        row.remove();
        recalcTotales();
    }
}

/**
 * Seleccionar cliente por click (función legacy para compatibilidad)
 */
function seleccionarClientePorClick(event) {
    const clienteData = event.target.closest('.cliente-sugerencia-item')?.dataset;
    if (!clienteData) return;

    const cliente = {
        id: clienteData.id || '',
        nombre: clienteData.nombre || '',
        cliente_id: clienteData.id || ''
    };

    // Actualizar campo de cliente
    const clienteInput = document.getElementById('id_cliente');
    if (clienteInput) {
        clienteInput.value = cliente.id;
        clienteInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    console.log('Cliente seleccionado:', cliente);
}

/**
 * Manejar envío del formulario
 */
async function handleSubmit(event) {
    event.preventDefault();
    
    console.log('📤 [PRESUPUESTOS-EDIT] Iniciando envío de formulario...');
    
    const btnGuardar = document.getElementById('btn-guardar');
    const spinner = btnGuardar.querySelector('.loading-spinner');
    
    // Mostrar loading
    btnGuardar.disabled = true;
    spinner.style.display = 'inline-block';

    try {
        // Recopilar datos del formulario
        const form = event.target;
        const formData = new FormData(form);
        const data = {};

        // Campos principales
        data.id_cliente = formData.get('id_cliente');
        data.fecha = formData.get('fecha');
        data.tipo_comprobante = formData.get('tipo_comprobante');
        data.estado = formData.get('estado');
        data.agente = formData.get('agente');
        data.punto_entrega = formData.get('punto_entrega');
        data.descuento = parseFloat(formData.get('descuento')) || 0;
        data.fecha_entrega = formData.get('fecha_entrega') || null;
        data.nota = formData.get('nota');

        // Validar campos obligatorios
        if (!data.id_cliente) throw new Error('ID Cliente es obligatorio');
        if (!data.fecha) throw new Error('Fecha es obligatoria');
        if (!data.estado) throw new Error('Estado es obligatorio');

        // Validar detalles desde el DOM
        const tbody = document.getElementById('detalles-tbody');
        if (!tbody || tbody.querySelectorAll('tr').length === 0) {
            throw new Error('Debe agregar al menos un detalle de artículo');
        }

        // Validar cada fila del DOM
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            const cantInput = row.querySelector('input[name*="[cantidad]"]');
            const valorInput = row.querySelector('input[name*="[valor1]"]');
            const ivaInput = row.querySelector('input[name*="[iva1]"]');

            if (!artInput || !artInput.value.trim()) {
                throw new Error('Todos los detalles deben tener un artículo válido');
            }
            // Validar que el artículo tenga código de barras (seleccionado desde autocompletar)
            if (!artInput.dataset.codigoBarras || !artInput.dataset.codigoBarras.trim()) {
                throw new Error(`El artículo "${artInput.value}" no es válido. Selecciónalo desde el autocompletar.`);
            }
            if (!cantInput || parseFloat(cantInput.value) <= 0) {
                throw new Error('Todos los detalles deben tener una cantidad mayor a cero');
            }
            if (!valorInput || parseFloat(valorInput.value) < 0) {
                throw new Error('Todos los detalles deben tener un valor unitario válido');
            }
            if (!ivaInput || parseFloat(ivaInput.value) < 0) {
                throw new Error('Todos los detalles deben tener un IVA válido');
            }
        }

        // Reemplazar descripción visible por código de barras antes de serializar
        rows.forEach(row => {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            if (artInput && artInput.dataset.codigoBarras) {
                // Guardar descripción visible para restaurar después
                artInput.dataset.descripcionVisible = artInput.value;
                // Enviar código al backend
                artInput.value = artInput.dataset.codigoBarras.trim();
            }
        });

        // Enviar actualización del presupuesto (sin detalles, solo campos editables)
        const updateData = {
            agente: data.agente,
            punto_entrega: data.punto_entrega,
            descuento: data.descuento,
            fecha_entrega: data.fecha_entrega,
            nota: data.nota
        };

        // Enviar PUT para actualizar presupuesto
        const response = await fetch(`/api/presupuestos/${presupuestoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || result.message || 'Error al actualizar presupuesto');
        }

        // Restaurar descripciones visibles en los inputs de artículos
        rows.forEach(row => {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            if (artInput && artInput.dataset.descripcionVisible) {
                artInput.value = artInput.dataset.descripcionVisible;
            }
        });

        // TODO: Actualizar detalles (no implementado en backend según lectura previa)
        // Aquí se podría implementar llamada para actualizar detalles si la API lo soporta

        mostrarMensaje('✅ Presupuesto actualizado exitosamente', 'success');

        console.log('✅ [PRESUPUESTOS-EDIT] Presupuesto actualizado correctamente');

        // Redirigir después de 2 segundos
        setTimeout(() => {
            window.location.href = '/pages/presupuestos.html';
        }, 2000);

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al actualizar presupuesto:', error);
        mostrarMensaje(`❌ Error al actualizar presupuesto: ${error.message}`, 'error');
    } finally {
        // Ocultar loading
        btnGuardar.disabled = false;
        spinner.style.display = 'none';
    }
}

/**
 * Mostrar mensaje al usuario
 */
function mostrarMensaje(texto, tipo = 'info') {
    console.log(`💬 [PRESUPUESTOS-EDIT] Mostrando mensaje: ${texto}`);
    
    const container = document.getElementById('message-container');
    
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

  console.log('✅ [PRESUPUESTOS-EDIT] Módulo de edición cargado correctamente');

})(); // Cerrar IIFE
