// MĂłdulo de ediciĂłn de presupuestos - Integrado con detalles-common.js
(function() {
  console.log('[EDIT] Cargando mĂłdulo de ediciĂłn integrado...');

  // Variables globales del editor
  let presupuestoId = null;
  let presupuestoData = null;
  let detallesData = [];

  // Cache para descripciones de artĂ­culos por cĂłdigo de barras
  const descripcionCache = new Map();

  /**
   * Buscar descripciĂłn de artĂ­culo por cĂłdigo de barras
   */
  async function buscarDescripcionPorCodigo(codigoBarras) {
    if (!codigoBarras || !codigoBarras.trim()) return null;

    // Verificar cache primero
    if (descripcionCache.has(codigoBarras)) {
      console.log(`đ [PRESUPUESTOS-EDIT] DescripciĂłn cacheada para cĂłdigo: ${codigoBarras}`);
      return descripcionCache.get(codigoBarras);
    }

    try {
      console.log(`đ [PRESUPUESTOS-EDIT] Buscando descripciĂłn para cĂłdigo: ${codigoBarras}`);
      const response = await fetch(`/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(codigoBarras)}&limit=1`);
      const result = await response.json();

      if (response.ok && result.success && result.data && result.data.length > 0) {
        const articulo = result.data[0];
        const descripcion = articulo.descripcion || articulo.nombre || '';
        // Guardar en cache
        descripcionCache.set(codigoBarras, descripcion);
        console.log(`â [PRESUPUESTOS-EDIT] DescripciĂłn encontrada: ${descripcion}`);
        return descripcion;
      } else {
        console.log(`â ď¸ [PRESUPUESTOS-EDIT] No se encontrĂł descripciĂłn para cĂłdigo: ${codigoBarras}`);
        // Guardar null en cache para evitar bĂşsquedas repetidas
        descripcionCache.set(codigoBarras, null);
        return null;
      }
    } catch (error) {
      console.error(`â [PRESUPUESTOS-EDIT] Error al buscar descripciĂłn para cĂłdigo ${codigoBarras}:`, error);
      return null;
    }
  }

  // NO sobrescribir funciones del mĂłdulo comĂşn
  // El mĂłdulo comĂşn ya expone window.Detalles.agregarDetalle, window.Detalles.removerDetalle, etc.
  // Solo crear wrappers si NO existen (para compatibilidad con onclick sin namespace)
  
  if (!window.agregarDetalle) {
    window.agregarDetalle = function() {
      if (window.Detalles && window.Detalles.agregarDetalle) {
        window.Detalles.agregarDetalle();
      } else {
        console.error('â [PRESUPUESTOS-EDIT] MĂłdulo comĂşn no disponible');
      }
    };
  }

  if (!window.removerDetalle) {
    window.removerDetalle = function(id) {
      if (window.Detalles && window.Detalles.removerDetalle) {
        window.Detalles.removerDetalle(id);
      } else {
        console.error('â [PRESUPUESTOS-EDIT] MĂłdulo comĂşn no disponible');
      }
    };
  }

  // Exponer funciones para compatibilidad con handlers inline (solo si no existen)
  if (!window.calcularPrecio) {
    window.calcularPrecio = function(detalleId) {
      if (window.Detalles && window.Detalles.calcularPrecio) {
        window.Detalles.calcularPrecio(detalleId);
      }
    };
  }

  if (!window.recalcTotales) {
    window.recalcTotales = function() {
      if (window.Detalles && window.Detalles.recalcTotales) {
        window.Detalles.recalcTotales();
      }
    };
  }

  // Funciones de utilidad locales
  function toNum(x) {
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (typeof x === 'string') {
      const s = x.trim().replace(/\./g, '').replace(',', '.'); // quita miles y cambia coma por punto
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  function setNumeric(el, val, dec = 2, fallback = 0) {
    const n = Number(val);
    el.value = Number.isFinite(n) ? n.toFixed(dec) : Number(fallback).toFixed(dec);
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  function setCantidad(el, val) {
    setNumeric(el, val, 2, 1);
  }

  // InicializaciĂłn
document.addEventListener('DOMContentLoaded', function() {
    console.log('đ [PRESUPUESTOS-EDIT] Inicializando pĂĄgina de ediciĂłn...');

    // Loguear estado del mĂłdulo comĂşn para debugging
    console.log('đ [PRESUPUESTOS-EDIT] Estado del mĂłdulo Detalles:', {
        disponible: !!window.Detalles,
        calcularPrecio: typeof window.Detalles?.calcularPrecio,
        recalcTotales: typeof window.Detalles?.recalcTotales
    });

    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');

    if (!presupuestoId) {
        console.log('[EDIT] Falta id en querystring y no se puede continuar');
        mostrarMensaje('â No se especificĂł el ID del presupuesto a editar', 'error');
        return;
    }

    console.log(`đ [PRESUPUESTOS-EDIT] ID del presupuesto: ${presupuestoId}`);

    // --- FECHA base primero (evita TDZ) ---
    const fechaInput = document.getElementById('fecha');
    const today = new Date().toISOString().split('T')[0];
    if (fechaInput) {
        fechaInput.value = fechaInput.value || today;
    } else {
        console.warn('â ď¸ [PRESUPUESTOS-EDIT] Input #fecha no encontrado; se enviarĂĄ fecha del dĂ­a desde JS');
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
            console.log('[PRESUPUESTOS-EDIT] Tipo comprobante â', tipoSel.value);
            applyIvaModeToAllRows();
        });
    }

    const agenteInput = document.getElementById('agente');
    if (agenteInput && !agenteInput.value.trim()) {
        agenteInput.value = 'Martin';
    }

    const puntoInput = document.getElementById('punto_entrega');
    if (puntoInput && !puntoInput.value.trim()) {
        puntoInput.value = 'Sin direcciĂłn';
    }

    const estadoSel = document.getElementById('estado');
    if (estadoSel && !estadoSel.value) {
        estadoSel.value = 'Presupuesto/Orden';
    }

    const fechaEntregaInput = document.getElementById('fecha_entrega');
    // usar misma fecha que 'fecha' si estĂĄ vacĂ­o
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
        console.error('â [PRESUPUESTOS-EDIT] Formulario #form-editar-presupuesto no encontrado');
    }

    // Configurar autocompletar de clientes
    if (typeof setupClienteAutocomplete === 'function') {
        setupClienteAutocomplete();
    }

    // Configurar autocompletar para artĂ­culos usando mĂłdulo comĂşn
    if (window.Detalles && window.Detalles.setupArticuloAutocomplete) {
        window.Detalles.setupArticuloAutocomplete();
    } else if (typeof setupArticuloAutocomplete === 'function') {
        setupArticuloAutocomplete();
    }

    // NUEVO: Exponer funciĂłn de selecciĂłn para compatibilidad con autocompletar
    window.seleccionarArticulo = seleccionarArticulo;

    // Cargar datos del presupuesto y detalles en paralelo
    Promise.all([cargarPresupuesto(), cargarDetallesPresupuesto()]).then(() => {
        console.log('[EDIT] encabezado OK');
        console.log(`[EDIT] detalles: ${detallesData.length} filas`);

        // Renderizar detalles usando mĂłdulo comĂşn
        renderDetallesConModuloComun();

        // Aplicar modo IVA y recalcular totales
        applyIvaModeToAllRows();
        if (typeof recalcTotales === 'function') recalcTotales();
    }).catch(error => {
        console.error('[EDIT] Error cargando datos:', error);
    });

    console.log('â [PRESUPUESTOS-EDIT] PĂĄgina inicializada correctamente');
});

/**
 * Cargar datos del presupuesto
 */
async function cargarPresupuesto() {
    console.log(`đĽ [PRESUPUESTOS-EDIT] Cargando datos del presupuesto ${presupuestoId}...`);

    try {
        // Obtener datos del presupuesto
        const response = await fetch(`/api/presupuestos/${presupuestoId}`);
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al cargar el presupuesto');
        }

        presupuestoData = result.data;
        console.log('🔍 [PRESUPUESTOS-EDIT] Datos del presupuesto cargados:', presupuestoData);

        // Actualizar información principal (nombre del cliente)
        if (typeof window.actualizarInfoPrincipal === 'function') {
            window.actualizarInfoPrincipal(presupuestoData);
        }

        // Llenar información de solo lectura
        llenarInformacionPresupuesto();

        // Llenar campos editables
        llenarCamposEditables();

        // NUEVO: Actualizar botón de facturación según estado
        const estaFacturado = presupuestoData.esta_facturado || false;
        const facturaId = presupuestoData.factura_id || null;
        
        console.log(`[FACTURAR] Estado de facturación: estaFacturado=${estaFacturado}, facturaId=${facturaId}`);
        
        if (typeof actualizarBotonFacturacion === 'function') {
            actualizarBotonFacturacion(estaFacturado, facturaId);
        } else {
            console.warn('[FACTURAR] ⚠️ Función actualizarBotonFacturacion no disponible');
        }

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar presupuesto:', error);
        mostrarMensaje(`❌ Error al cargar el presupuesto: ${error.message}`, 'error');
    }
}

/**
 * Normalizar detalle del backend al formato esperado por el frontend
 */
  function normalizarDetalle(d) {
    // dentro de normalizarDetalle(d)
    const netoRaw = d?.valor1 ?? d?.neto ?? d?.valor_neto ?? d?.precio_neto ?? 0;
    const neto = toNum(netoRaw);

    const pvuRaw = d?.precio1 ?? d?.pvu ?? d?.precio_final;
    const pvu = toNum(pvuRaw);

    // 1) Usar camp2 primero (en tu BD viene 0.21)
    const camp2 = toNum(d?.camp2);
    let ivaDecimal;

    if (camp2 > 0) {
      // si viniera "21" lo pasamos a decimal, si viniera "0.21" lo dejamos igual
      ivaDecimal = camp2 <= 1 ? camp2 : camp2 / 100;
    } else {
      // 2) Fallbacks seguros
      const ivaRaw = toNum(d?.iva1 ?? d?.iva ?? d?.iva_porcentaje ?? 0);
      if (ivaRaw <= 1)          ivaDecimal = ivaRaw;                 // ya es decimal
      else if (ivaRaw <= 100)   ivaDecimal = ivaRaw / 100;           // porcentaje
      else                      ivaDecimal = neto ? ivaRaw / neto : 0; // importe IVA
    }

    // precio unitario con IVA
    const precioUnit = pvu || (neto * (1 + ivaDecimal));

    return {
      // cĂłdigos
      codigo_barras: d?.codigo_barras ?? d?.cod_barra ?? d?.codigo ?? d?.articulo ?? d?.articulo_numero ?? '',
      articulo_numero: d?.articulo_numero ?? d?.articulo ?? '',
      // descripciĂłn (probamos varias claves comunes)
      descripcion: d?.detalle ?? d?.descripcion ?? d?.articulo_descripcion ?? d?.nombre ?? '',
      // nĂşmeros
      cantidad: toNum(d?.cantidad),
      valor1: neto,            // neto sin IVA
      iva1: ivaDecimal,        // đ SIEMPRE decimal (0.21)
      precio1: precioUnit      // unitario con IVA
    };
  }

/**
 * Cargar detalles del presupuesto
 */
async function cargarDetallesPresupuesto() {
    console.log(`đŚ [PRESUPUESTOS-EDIT] Cargando detalles del presupuesto ${presupuestoId}...`);

    try {
        const response = await fetch(`/api/presupuestos/${presupuestoId}/detalles`);
        const result = await response.json();

        if (response.ok && result.success) {
            const data = result.data;
            const lista = Array.isArray(data) ? data : (Array.isArray(data?.detalles) ? data.detalles : []);
            detallesData = lista.map(normalizarDetalle);

            const detallesCount = detallesData.length;
            document.getElementById('info-detalles').textContent = `${detallesCount} artĂ­culos`;
            console.log(`đŚ [PRESUPUESTOS-EDIT] Detalles cargados: ${detallesCount} artĂ­culos`);
        } else {
            console.warn('â ď¸ [PRESUPUESTOS-EDIT] No se pudieron cargar los detalles');
            document.getElementById('info-detalles').textContent = 'No disponible';
        }

    } catch (error) {
        console.error('â [PRESUPUESTOS-EDIT] Error al cargar detalles:', error);
        document.getElementById('info-detalles').textContent = 'Error al cargar';
    }
}

/**
 * Llenar informaciĂłn de solo lectura
 */
function llenarInformacionPresupuesto() {
    console.log('đ [PRESUPUESTOS-EDIT] Llenando informaciĂłn del presupuesto...');
    
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

    // nota
    document.getElementById('nota').value = presupuestoData.nota ?? '';

    // punto de entrega
    document.getElementById('punto_entrega').value = 
        (presupuestoData.punto_entrega && presupuestoData.punto_entrega.trim()) ? presupuestoData.punto_entrega : 'Sin direcciĂłn';

    // descuento: si viene 0.05 mostrar 5
    const d = Number(presupuestoData.descuento);
    document.getElementById('descuento').value = 
        Number.isFinite(d) ? (d <= 1 ? d * 100 : d) : 0;

    // Otros campos
    document.getElementById('id_cliente').value = presupuestoData.id_cliente || '';
    document.getElementById('fecha').value = presupuestoData.fecha ? presupuestoData.fecha.split('T')[0] : '';
    document.getElementById('tipo_comprobante').value = presupuestoData.tipo_comprobante || 'Factura';
    document.getElementById('estado').value = presupuestoData.estado || 'Presupuesto/Orden';
    document.getElementById('agente').value = presupuestoData.agente || '';
    
    // Secuencia (nuevo campo) - usar "Imprimir" como fallback
    document.getElementById('secuencia').value = presupuestoData.secuencia || 'Imprimir';

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
 * Renderizar detalles desde BD usando el mĂłdulo comĂşn
 * CORREGIDO: Igualar comportamiento con creaciĂłn
 */
async function renderDetallesConModuloComun(){
  const tbody = document.getElementById('detalles-tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  
  // Resetear contador del mĂłdulo comĂşn
  if (window.Detalles) {
    window.Detalles.detalleCounter = 0;
  }

  const tipoSel = document.getElementById('tipo_comprobante');
  const esRemito = () => tipoSel && tipoSel.value === 'Remito-Efectivo';

  // Procesar cada detalle de forma asĂ­ncrona
  for (const det of detallesData) {
    console.log(`đŚ [PRESUPUESTOS-EDIT] Renderizando detalle:`, det);

    // CORRECCIĂN: Usar camp2 (alĂ­cuota decimal) en lugar de iva1 (monto)
    // camp2 contiene la alĂ­cuota correcta (0.21 para 21%)
    const ivaPctBase = ((det.iva1 || 0) * 100);
    const ivaPctVisible = esRemito() ? (ivaPctBase / 2) : ivaPctBase;

    // Usar funciĂłn del mĂłdulo comĂşn para agregar fila vacĂ­a
    agregarDetalle();
    const idx = window.Detalles ? window.Detalles.detalleCounter : 1;

    const row = document.getElementById(`detalle-${idx}`);
    if (!row) continue;

    const artInput   = row.querySelector(`input[name="detalles[${idx}][articulo]"]`);
    const cantInput  = row.querySelector(`input[name="detalles[${idx}][cantidad]"]`);
    const valorInput = row.querySelector(`input[name="detalles[${idx}][valor1]"]`);
    const ivaInput   = row.querySelector(`input[name="detalles[${idx}][iva1]"]`);

    // Mostrar DESCRIPCIĂN al usuario y guardar CODIGO DE BARRAS en dataset (igual que Crear)
    if (artInput){
      let descripcionVisible = det.descripcion || '';

      // Si no hay descripciĂłn pero sĂ­ hay cĂłdigo de barras, buscar descripciĂłn
      if (!descripcionVisible && det.codigo_barras) {
        console.log(`đ [PRESUPUESTOS-EDIT] Buscando descripciĂłn para cĂłdigo: ${det.codigo_barras}`);
        const descripcionEncontrada = await buscarDescripcionPorCodigo(det.codigo_barras);
        if (descripcionEncontrada) {
          descripcionVisible = descripcionEncontrada;
          console.log(`â [PRESUPUESTOS-EDIT] DescripciĂłn encontrada: ${descripcionVisible}`);
        } else {
          // Si no se encuentra descripciĂłn, mostrar el cĂłdigo de barras
          descripcionVisible = det.codigo_barras;
          console.log(`â ď¸ [PRESUPUESTOS-EDIT] Usando cĂłdigo de barras como descripciĂłn: ${descripcionVisible}`);
        }
      } else if (!descripcionVisible) {
        // Si no hay ni descripciĂłn ni cĂłdigo, usar cĂłdigo de barras como fallback
        descripcionVisible = det.codigo_barras || '';
      }

      artInput.value = descripcionVisible;
      artInput.dataset.codigoBarras = det.codigo_barras || '';
      artInput.dataset.articuloNumero = det.articulo_numero || '';
    }

    // CORRECCIĂN: Setear valores UNITARIOS (igual que en creaciĂłn)
    if (cantInput)  setCantidad(cantInput, det.cantidad || 1);
    if (valorInput) setNumeric(valorInput, det.valor1 || 0, 2, 0);  // Precio unitario SIN IVA
    
    // CORRECCIĂN: Guardar base IVA y setear porcentaje visible
    if (ivaInput){
      ivaInput.dataset.ivaBase = String(ivaPctBase);  // Guardar base para modo Remito
      setNumeric(ivaInput, ivaPctVisible, 2, 21);     // Mostrar porcentaje
    }

    // CORRECCIĂN: NO setear precio1 manualmente, dejar que calcularPrecio() lo haga
    // Esto asegura que el cĂĄlculo sea idĂŠntico al de creaciĂłn
    
    // Llamar a calcularPrecio() para que calcule precio1 y subtotal
    // (igual que en creaciĂłn cuando se cambia un valor)
    if (window.Detalles && window.Detalles.calcularPrecio) {
      window.Detalles.calcularPrecio(idx);
    }
    
    console.log(`â [PRESUPUESTOS-EDIT] Detalle ${idx} renderizado correctamente`);
  }

  // Recalcular totales finales
  if (window.Detalles && window.Detalles.recalcTotales) {
    window.Detalles.recalcTotales();
  }
  
  console.log(`â [PRESUPUESTOS-EDIT] Todos los detalles renderizados: ${detallesData.length} Ă­tems`);
}

/**
 * Formatear fecha para mostrar
 */
function formatearFecha(fecha) {
    if (!fecha) return null;

    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return fecha; // Si no es vĂĄlida, devolver original

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
 * Seleccionar artĂ­culo del autocompletar - CORREGIDO para igualar comportamiento de creaciĂłn
 * SIGNATURA COMPATIBLE: (input, element) como en creaciĂłn
 */
function seleccionarArticulo(input, element) {
    // Si se llama con la signatura antigua (articulo, detalleIndex), adaptarla
    if (typeof input === 'object' && input.descripcion && typeof element === 'number') {
        const articulo = input;
        const detalleIndex = element;
        return seleccionarArticuloLegacy(articulo, detalleIndex);
    }

    // NUEVA IMPLEMENTACIĂN: Signatura compatible con creaciĂłn (input, element)
    const codigoBarras = (element.dataset.codigoBarras || '').toString();
    const articuloNumero = (element.dataset.articuloNumero || '').toString();
    const description = (element.dataset.description || '').toString();
    const stock = parseFloat(element.dataset.stock || 0);

    console.log(`đŚ [PRESUPUESTOS-EDIT] Seleccionando artĂ­culo: ${description} [${articuloNumero}] (Stock: ${stock})`);

    // Mostrar descripciĂłn al usuario y guardar cĂłdigos reales para el submit
    input.value = description;
    input.dataset.codigoBarras = codigoBarras;
    input.dataset.articuloNumero = articuloNumero;

    // Remover cualquier estilo que cause texto azul
    input.style.color = '';
    input.classList.remove('articulo-codigo');

    console.log(`â [PRESUPUESTOS-EDIT] ArtĂ­culo seleccionado: ${description}`);
    
    // Ocultar sugerencias
    const container = document.querySelector('.articulo-sugerencias');
    if (container) {
        container.style.display = 'none';
        container.dataset.selectedIndex = '-1';
    }

    // Ubicar fila/inputs
    const row = input.closest('tr');
    const cantidadInput = row?.querySelector('input[name*="[cantidad]"]');
    const valor1Input = row?.querySelector('input[name*="[valor1]"]');
    const iva1Input = row?.querySelector('input[name*="[iva1]"]');
    const detalleId = getDetalleIdFromInput(cantidadInput || input);

    // Establecer valores por defecto
    if (cantidadInput && (!cantidadInput.value || parseFloat(cantidadInput.value) <= 0)) {
        setCantidad(cantidadInput, 1);
    }
    if (iva1Input && (iva1Input.value === '' || isNaN(parseFloat(iva1Input.value)))) {
        setNumeric(iva1Input, 21, 2, 21);
    }
    if (valor1Input && (valor1Input.value === '' || isNaN(parseFloat(valor1Input.value)))) {
        setNumeric(valor1Input, 0, 2, 0);
    }

    if (detalleId != null && window.Detalles && window.Detalles.calcularPrecio) {
        window.Detalles.calcularPrecio(detalleId);
    }

    // BUSCAR PRECIOS AUTOMĂTICAMENTE (igual que en creaciĂłn)
    const clienteId = parseInt(getClienteIdActivo(), 10) || 0;

    const fetchPrecios = async (params) => {
        const url = `/api/presupuestos/precios?${params.toString()}`;
        console.log('[PRESUPUESTOS-EDIT] GET precios ->', url);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    };

    (async () => {
        let valor, iva;

        // 1) Por cĂłdigo de barras
        try {
            const p = new URLSearchParams();
            p.set('cliente_id', String(clienteId));
            if (codigoBarras) p.set('codigo_barras', codigoBarras);
            let body = await fetchPrecios(p);
            valor = Number(body?.data?.valor1);
            iva = Number(body?.data?.iva);
        } catch (e1) {
            console.warn('â ď¸ [PRESUPUESTOS-EDIT] No respondiĂł por cĂłdigo de barras. Probando por descripciĂłnâŚ', e1);
        }

        // 2) Fallback por descripciĂłn
        if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(iva)) {
            try {
                const p2 = new URLSearchParams();
                p2.set('cliente_id', String(clienteId));
                if (description) p2.set('descripcion', description);
                const body2 = await fetchPrecios(p2);
                valor = Number(body2?.data?.valor1);
                iva = Number(body2?.data?.iva);
            } catch (e2) {
                console.warn('â ď¸ [PRESUPUESTOS-EDIT] Tampoco por descripciĂłn:', e2);
            }
        }

        // Setear valores si se encontraron
        if (Number.isFinite(valor) && valor1Input) {
            setNumeric(valor1Input, valor, 2, 0);
        }
        
        if (Number.isFinite(iva) && iva1Input) {
            // Guardar la base real del IVA que vino del backend
            iva1Input.dataset.ivaBase = String(iva);
            // Mostrar mitad si el tipo es Remito-Efectivo
            const tipoSel = document.getElementById('tipo_comprobante');
            const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
            setNumeric(iva1Input, visibleIva, 2, 21);
        }

        if (detalleId != null && window.Detalles && window.Detalles.calcularPrecio) {
            window.Detalles.calcularPrecio(detalleId);
        }
        
        // Enfocar siguiente campo
        setTimeout(() => (valor1Input || cantidadInput)?.focus(), 50);
        
        console.log('â [PRESUPUESTOS-EDIT] Precios actualizados automĂĄticamente');
    })();
}

/**
 * FunciĂłn legacy para compatibilidad con signatura antigua
 */
function seleccionarArticuloLegacy(articulo, detalleIndex) {
    console.log('đŚ [PRESUPUESTOS-EDIT] Seleccionando artĂ­culo (legacy):', articulo, 'para detalle:', detalleIndex);

    // Encontrar la fila correspondiente usando el detalleIndex como ID de fila
    const row = document.getElementById(`detalle-${detalleIndex}`);
    if (!row) {
        console.error('â [PRESUPUESTOS-EDIT] Fila de detalle no encontrada:', detalleIndex);
        return;
    }

    // Actualizar inputs de la fila
    const artInput = row.querySelector(`input[name="detalles[${detalleIndex}][articulo]"]`);
    const valorInput = row.querySelector(`input[name="detalles[${detalleIndex}][valor1]"]`);
    const ivaInput = row.querySelector(`input[name="detalles[${detalleIndex}][iva1]"]`);
    const cantInput = row.querySelector(`input[name="detalles[${detalleIndex}][cantidad]"]`);

    if (artInput) {
        // CORREGIDO: Mostrar descripciĂłn al usuario y guardar cĂłdigo de barras
        artInput.value = articulo.descripcion || articulo.description || articulo.nombre || '';
        artInput.dataset.codigoBarras = articulo.codigo_barras || '';
        artInput.dataset.articuloNumero = articulo.articulo_numero || '';
        
        // Remover cualquier estilo que cause texto azul
        artInput.style.color = '';
        artInput.classList.remove('articulo-codigo');
    }

    // CORREGIDO: Usar los mismos valores que en creaciĂłn
    if (valorInput) {
        const precio = parseFloat(articulo.precio) || parseFloat(articulo.valor1) || 0;
        setNumeric(valorInput, precio, 2, 0);
    }

    if (ivaInput) {
        const iva = parseFloat(articulo.iva) || parseFloat(articulo.iva1) || 21;
        // Guardar la base real del IVA
        ivaInput.dataset.ivaBase = String(iva);
        // Mostrar mitad si el tipo es Remito-Efectivo
        const tipoSel = document.getElementById('tipo_comprobante');
        const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
        setNumeric(ivaInput, visibleIva, 2, 21);
    }

    if (cantInput && (!cantInput.value || parseFloat(cantInput.value) <= 0)) {
        setCantidad(cantInput, 1);
    }

    console.log('â [PRESUPUESTOS-EDIT] ArtĂ­culo seleccionado y datos actualizados (legacy)');

    // Recalcular precio para esta fila
    if (window.Detalles && window.Detalles.calcularPrecio) {
        window.Detalles.calcularPrecio(detalleIndex);
    }
    if (window.Detalles && window.Detalles.recalcTotales) {
        window.Detalles.recalcTotales();
    }

    // NUEVO: Buscar precios automĂĄticamente como en creaciĂłn
    buscarPreciosAutomaticamente(articulo, detalleIndex);
}

/**
 * Buscar precios automĂĄticamente como en el flujo de creaciĂłn
 */
async function buscarPreciosAutomaticamente(articulo, detalleIndex) {
    try {
        const clienteId = parseInt(getClienteIdActivo(), 10) || 0;
        const codigoBarras = articulo.codigo_barras || '';
        const descripcion = articulo.descripcion || articulo.description || '';

        console.log(`đ [PRESUPUESTOS-EDIT] Buscando precios para cliente ${clienteId}, cĂłdigo: ${codigoBarras}`);

        const fetchPrecios = async (params) => {
            const url = `/api/presupuestos/precios?${params.toString()}`;
            console.log('[PRESUPUESTOS-EDIT] GET precios ->', url);
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        };

        let valor, iva;

        // 1) Buscar por cĂłdigo de barras
        try {
            const p = new URLSearchParams();
            p.set('cliente_id', String(clienteId));
            if (codigoBarras) p.set('codigo_barras', codigoBarras);
            let body = await fetchPrecios(p);
            valor = Number(body?.data?.valor1);
            iva = Number(body?.data?.iva);
        } catch (e1) {
            console.warn('â ď¸ [PRESUPUESTOS-EDIT] No respondiĂł por cĂłdigo de barras. Probando por descripciĂłnâŚ', e1);
        }

        // 2) Fallback por descripciĂłn
        if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(iva)) {
            try {
                const p2 = new URLSearchParams();
                p2.set('cliente_id', String(clienteId));
                if (descripcion) p2.set('descripcion', descripcion);
                const body2 = await fetchPrecios(p2);
                valor = Number(body2?.data?.valor1);
                iva = Number(body2?.data?.iva);
            } catch (e2) {
                console.warn('â ď¸ [PRESUPUESTOS-EDIT] Tampoco por descripciĂłn:', e2);
            }
        }

        // Actualizar valores si se encontraron
        const row = document.getElementById(`detalle-${detalleIndex}`);
        if (row) {
            const valorInput = row.querySelector(`input[name="detalles[${detalleIndex}][valor1]"]`);
            const ivaInput = row.querySelector(`input[name="detalles[${detalleIndex}][iva1]"]`);

            if (Number.isFinite(valor) && valorInput) {
                setNumeric(valorInput, valor, 2, 0);
            }
            
            if (Number.isFinite(iva) && ivaInput) {
                // Guardar la base real del IVA
                ivaInput.dataset.ivaBase = String(iva);
                // Mostrar mitad si el tipo es Remito-Efectivo
                const tipoSel = document.getElementById('tipo_comprobante');
                const visibleIva = (tipoSel && tipoSel.value === 'Remito-Efectivo') ? (iva / 2) : iva;
                setNumeric(ivaInput, visibleIva, 2, 21);
            }

            // Recalcular despuĂŠs de actualizar precios
            if (window.Detalles && window.Detalles.calcularPrecio) {
                window.Detalles.calcularPrecio(detalleIndex);
            }
        }

        console.log('â [PRESUPUESTOS-EDIT] Precios actualizados automĂĄticamente');

    } catch (error) {
        console.warn('â ď¸ [PRESUPUESTOS-EDIT] Error buscando precios automĂĄticamente:', error);
    }
}

/**
 * Obtener ID del cliente activo
 */
function getClienteIdActivo() {
    const clienteInput = document.getElementById('id_cliente');
    if (!clienteInput) return '0';
    
    const raw = (clienteInput.value || '').trim();
    const match = raw.match(/^\d+/);
    return match ? match[0] : '0';
}

/**
 * Obtener ID de detalle desde input (funciĂłn auxiliar)
 */
function getDetalleIdFromInput(input) {
    if (!input || !input.name) return null;
    const match = input.name.match(/\[(\d+)\]\[/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Seleccionar artĂ­culo por click (funciĂłn legacy para compatibilidad)
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

    // Obtener el ID de detalle desde el botĂłn mĂĄs cercano
    const detalleId = getDetalleIdFromInput(event.target.closest('tr')?.querySelector('input[name*="articulo"]'));
    if (detalleId !== null) {
        seleccionarArticulo(articulo, detalleId);
    }
}

/**
 * Remover detalle (funciĂłn legacy para compatibilidad)
 */
function removerDetalle(detalleId) {
    const row = document.getElementById(`detalle-${detalleId}`);
    if (row) {
        row.remove();
        recalcTotales();
    }
}

/**
 * Seleccionar cliente por click (funciĂłn legacy para compatibilidad)
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
 * Manejar envĂ­o del formulario
 */
async function handleSubmit(event) {
    event.preventDefault();
    
    console.log('đ¤ [PRESUPUESTOS-EDIT] Iniciando envĂ­o de formulario...');
    
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
        
        // Normalizar descuento (aceptar 5 o 0.05) y mandarlo siempre como decimal
        const descUI = Number(formData.get('descuento')) || 0;
        const descuento = Number.isFinite(descUI)
            ? (descUI > 1 ? descUI / 100 : descUI)
            : 0;
        data.descuento = +descuento.toFixed(4);
        console.log(`[EDIT] Descuento normalizado ->`, { input: descUI, output: data.descuento });
        
        data.fecha_entrega = formData.get('fecha_entrega') || null;
        data.nota = formData.get('nota');

        // Validar campos obligatorios
        if (!data.id_cliente) throw new Error('ID Cliente es obligatorio');
        if (!data.fecha) throw new Error('Fecha es obligatoria');
        if (!data.estado) throw new Error('Estado es obligatorio');

        // Validar detalles desde el DOM
        const tbody = document.getElementById('detalles-tbody');
        if (!tbody || tbody.querySelectorAll('tr').length === 0) {
            throw new Error('Debe agregar al menos un detalle de artĂ­culo');
        }

        // Validar cada fila del DOM
        const rows = tbody.querySelectorAll('tr');
        for (const row of rows) {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            const cantInput = row.querySelector('input[name*="[cantidad]"]');
            const valorInput = row.querySelector('input[name*="[valor1]"]');
            const ivaInput = row.querySelector('input[name*="[iva1]"]');

            if (!artInput || !artInput.value.trim()) {
                throw new Error('Todos los detalles deben tener un artĂ­culo vĂĄlido');
            }
            // Validar que el artĂ­culo tenga cĂłdigo de barras (seleccionado desde autocompletar)
            if (!artInput.dataset.codigoBarras || !artInput.dataset.codigoBarras.trim()) {
                throw new Error(`El artĂ­culo "${artInput.value}" no es vĂĄlido. SelecciĂłnalo desde el autocompletar.`);
            }
            if (!cantInput || parseFloat(cantInput.value) <= 0) {
                throw new Error('Todos los detalles deben tener una cantidad mayor a cero');
            }
            if (!valorInput || parseFloat(valorInput.value) < 0) {
                throw new Error('Todos los detalles deben tener un valor unitario vĂĄlido');
            }
            if (!ivaInput || parseFloat(ivaInput.value) < 0) {
                throw new Error('Todos los detalles deben tener un IVA vĂĄlido');
            }
        }

        // Serializar detalles del DOM con el mismo formato que espera el POST
        const detalles = [];
        rows.forEach(row => {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            const cantInput = row.querySelector('input[name*="[cantidad]"]');
            const valorInput = row.querySelector('input[name*="[valor1]"]');
            const ivaInput = row.querySelector('input[name*="[iva1]"]');

            if (artInput && artInput.dataset.codigoBarras) {
                detalles.push({
                    articulo: artInput.dataset.codigoBarras.trim(),  // CĂłdigo de barras
                    cantidad: parseFloat(cantInput.value) || 0,      // Cantidad
                    valor1: parseFloat(valorInput.value) || 0,       // Neto unitario
                    iva1: parseFloat(ivaInput.value) || 0            // IVA (% o decimal, backend normaliza)
                });
            }
        });

        console.log(`[PUT-FRONT] detalles serializados:`, detalles.length, detalles[0]);

        // Enviar actualizaciĂłn del presupuesto (cabecera + detalles)
        const updateData = {
            // Campos existentes (ya funcionan)
            agente: data.agente,
            punto_entrega: data.punto_entrega,
            descuento: data.descuento,
            fecha_entrega: data.fecha_entrega,
            nota: data.nota,
            
            // NUEVOS: Campos del encabezado que faltaban
            tipo_comprobante: data.tipo_comprobante,
            estado: data.estado,
            id_cliente: data.id_cliente,
            fecha: data.fecha,
            secuencia: formData.get('secuencia') || null,
            
            // Detalles
            detalles: detalles
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

        // Restaurar descripciones visibles en los inputs de artĂ­culos
        rows.forEach(row => {
            const artInput = row.querySelector('input[name*="[articulo]"]');
            if (artInput && artInput.dataset.descripcionVisible) {
                artInput.value = artInput.dataset.descripcionVisible;
            }
        });

        // TODO: Actualizar detalles (no implementado en backend segĂşn lectura previa)
        // AquĂ­ se podrĂ­a implementar llamada para actualizar detalles si la API lo soporta

        mostrarMensaje('â Presupuesto actualizado exitosamente', 'success');

        console.log('â [PRESUPUESTOS-EDIT] Presupuesto actualizado correctamente');

        // Redirigir despuĂŠs de 2 segundos
        setTimeout(() => {
            window.location.href = '/pages/presupuestos.html';
        }, 2000);

    } catch (error) {
        console.error('â [PRESUPUESTOS-EDIT] Error al actualizar presupuesto:', error);
        mostrarMensaje(`â Error al actualizar presupuesto: ${error.message}`, 'error');
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
    console.log(`đŹ [PRESUPUESTOS-EDIT] Mostrando mensaje: ${texto}`);
    
    const container = document.getElementById('message-container');
    
    // Limpiar mensajes anteriores
    container.innerHTML = '';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${tipo}`;
    messageDiv.textContent = texto;
    messageDiv.style.display = 'block';
    
    container.appendChild(messageDiv);
    
    // Auto-ocultar despuĂŠs de 5 segundos (excepto errores)
    if (tipo !== 'error') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
}

  console.log('â [PRESUPUESTOS-EDIT] MĂłdulo de ediciĂłn cargado correctamente');

})(); // Cerrar IIFE
/**
 * Actualizar estado del botón Facturar/Ver factura según estado de facturación
 */
function actualizarBotonFacturacion(estaFacturado, facturaId) {
    const btn = document.getElementById("btn-facturar");
    if (!btn) return;

    console.log(`[FACTURAR] Actualizando botón: estaFacturado=${estaFacturado}, facturaId=${facturaId}`);

    if (estaFacturado && facturaId) {
        // Presupuesto ya facturado - mostrar "Ver factura"
        btn.textContent = "👁️ Ver Factura";
        btn.className = "btn btn-secondary";
        btn.onclick = () => {
            window.location.href = `http://localhost:3004/pages/ver-factura.html?id=${facturaId}`;
        };
        console.log(`[FACTURAR] ✅ Botón configurado como "Ver Factura" (ID: ${facturaId})`);
    } else {
        // Presupuesto no facturado - mostrar "Facturar"
        btn.textContent = "💳 Facturar";
        btn.className = "btn btn-primary";
        btn.onclick = () => manejarFacturacion();
        console.log('[FACTURAR] ✅ Botón configurado como "Facturar"');
    }
}

/**
 * Manejar proceso de facturación
 */
async function manejarFacturacion() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get("id");
    
    if (!id) {
        alert("⚠️ No se encontró el ID de presupuesto.");
        return;
    }

    const btn = document.getElementById("btn-facturar");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Facturando...";

    try {
        const resp = await fetch(`http://localhost:3004/facturacion/presupuestos/${id}/facturar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        
        const data = await resp.json().catch(() => ({}));
        
        if (!resp.ok) {
            const msg = (data && (data.message || data.error)) || `Error HTTP ${resp.status}`;
            throw new Error(msg);
        }

        console.log('[FACTURAR] ✅ Facturación exitosa:', data);
        alert("✅ Presupuesto facturado correctamente.");

        // IMPORTANTE: Actualizar botón con el factura_id recibido
        if (data.factura_id) {
            actualizarBotonFacturacion(true, data.factura_id);
        } else {
            // Fallback: recargar página completa para obtener factura_id actualizado
            console.log('[FACTURAR] ⚠️ factura_id no recibido, recargando página...');
            window.location.reload();
        }

    } catch (e) {
        console.error('[FACTURAR] ❌ Error al facturar:', e);
        alert("❌ Error al facturar: " + (e?.message || e));
        
        // Restaurar botón en caso de error
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// Configurar botón al cargar página
document.addEventListener("DOMContentLoaded", () => {
    // El botón se configurará automáticamente al cargar el presupuesto
    console.log('[FACTURAR] Inicialización del botón de facturación lista');
});
