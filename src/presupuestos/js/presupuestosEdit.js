// MÄ‚Å‚dulo de ediciÄ‚Å‚n de presupuestos - Integrado con detalles-common.js
(function () {
    console.log('[EDIT] Cargando mÄ‚Å‚dulo de ediciÄ‚Å‚n integrado...');

    // Variables globales del editor
    let presupuestoId = null;
    let presupuestoData = null;
    let detallesData = [];

    // Cache para descripciones de artÄ‚Â­culos por cÄ‚Å‚digo de barras
    const descripcionCache = new Map();

    /**
     * Buscar descripciÄ‚Å‚n de artÄ‚Â­culo por cÄ‚Å‚digo de barras
     */
    async function buscarDescripcionPorCodigo(codigo, clienteId = 0, usarPreciosBunker = false) {
        if (!codigo || !codigo.trim()) return null;

        const cacheKey = `${codigo}_${clienteId}_${usarPreciosBunker}`;
        if (descripcionCache.has(cacheKey)) {
            console.log(`📦 [PRESUPUESTOS-EDIT] Descripción cacheada para clave: ${cacheKey}`);
            return descripcionCache.get(cacheKey);
        }

        try {
            console.log(`🔍 [PRESUPUESTOS-EDIT] Buscando descripción para código: ${codigo} (cliente=${clienteId}, bunker=${usarPreciosBunker})`);
            let url = `/api/presupuestos/articulos/sugerencias?q=${encodeURIComponent(codigo)}&limit=1`;
            if (clienteId > 0) url += `&cliente_id=${clienteId}`;
            if (usarPreciosBunker) url += `&usar_precios_bunker=true`;

            const response = await fetch(url);
            const result = await response.json();

            if (response.ok && result.success && result.data && result.data.length > 0) {
                const articulo = result.data[0];
                const descripcion = articulo.descripcion || articulo.nombre || '';
                // Guardar en cache
                descripcionCache.set(cacheKey, descripcion);
                console.log(`✅ [PRESUPUESTOS-EDIT] Descripción encontrada: ${descripcion}`);
                return descripcion;
            } else {
                console.log(`⚠️ [PRESUPUESTOS-EDIT] No se encontró descripción para código: ${codigo}`);
                // Guardar null en cache para evitar bÄ‚ÅŸsquedas repetidas
                descripcionCache.set(cacheKey, null);
                return null;
            }
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-EDIT] Error al buscar descripción para código ${codigo}:`, error);
            return null;
        }
    }

    // NO sobrescribir funciones del mÄ‚Å‚dulo comÄ‚ÅŸn
    // El mÄ‚Å‚dulo comÄ‚ÅŸn ya expone window.Detalles.agregarDetalle, window.Detalles.removerDetalle, etc.
    // Solo crear wrappers si NO existen (para compatibilidad con onclick sin namespace)

    if (!window.agregarDetalle) {
        window.agregarDetalle = function () {
            if (window.Detalles && window.Detalles.agregarDetalle) {
                window.Detalles.agregarDetalle();
            } else {
                console.error('Ã¢ÂÂŒ [PRESUPUESTOS-EDIT] MÄ‚Å‚dulo comÄ‚ÅŸn no disponible');
            }
        };
    }

    if (!window.removerDetalle) {
        window.removerDetalle = function (id) {
            if (window.Detalles && window.Detalles.removerDetalle) {
                window.Detalles.removerDetalle(id);
            } else {
                console.error('Ã¢ÂÂŒ [PRESUPUESTOS-EDIT] MÄ‚Å‚dulo comÄ‚ÅŸn no disponible');
            }
        };
    }

    // Exponer funciones para compatibilidad con handlers inline (solo si no existen)
    if (!window.calcularPrecio) {
        window.calcularPrecio = function (detalleId) {
            if (window.Detalles && window.Detalles.calcularPrecio) {
                window.Detalles.calcularPrecio(detalleId);
            }
        };
    }

    if (!window.recalcTotales) {
        window.recalcTotales = function () {
            if (window.Detalles && window.Detalles.recalcTotales) {
                window.Detalles.recalcTotales();
            }
        };
    }

    // Funciones de utilidad locales
    function toNum(x) {
        if (typeof x === 'number' && Number.isFinite(x)) return x;
        if (typeof x === 'string') {
            const trimmed = x.trim();
            // Si tiene coma, asumimos formato es-AR (ej. "1.234,56") -> quitamos puntos y reemplazamos coma por punto
            if (trimmed.includes(',')) {
                const s = trimmed.replace(/\./g, '').replace(',', '.');
                const n = parseFloat(s);
                return Number.isFinite(n) ? n : 0;
            }
            // Formato estándar JS/DB (ej. "1.00" o "1234.56")
            const n = parseFloat(trimmed);
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
        } catch (_) { }
    }

    function setCantidad(el, val) {
        const n = Number(val);
        const dec = (Number.isFinite(n) && Math.round(n * 100) !== Math.round(n * 1000) / 10) ? 3 : 2;
        setNumeric(el, val, dec, 1);
    }

    // InicializaciÄ‚Å‚n
    document.addEventListener('DOMContentLoaded', function () {
        console.log('Ä‘ÂŸÂ“Â‹ [PRESUPUESTOS-EDIT] Inicializando pÄ‚Ä„gina de ediciÄ‚Å‚n...');

        // Loguear estado del mÄ‚Å‚dulo comÄ‚ÅŸn para debugging
        console.log('Ä‘ÂŸÂ”Â [PRESUPUESTOS-EDIT] Estado del mÄ‚Å‚dulo Detalles:', {
            disponible: !!window.Detalles,
            calcularPrecio: typeof window.Detalles?.calcularPrecio,
            recalcTotales: typeof window.Detalles?.recalcTotales
        });

        // Obtener ID del presupuesto desde URL
        const urlParams = new URLSearchParams(window.location.search);
        presupuestoId = urlParams.get('id');

        if (!presupuestoId) {
            console.log('[EDIT] Falta id en querystring y no se puede continuar');
            mostrarMensaje('Ã¢ÂÂŒ No se especificÄ‚Å‚ el ID del presupuesto a editar', 'error');
            return;
        }

        console.log(`Ä‘ÂŸÂ“Â‹ [PRESUPUESTOS-EDIT] ID del presupuesto: ${presupuestoId}`);

        // --- FECHA base primero (evita TDZ) ---
        const fechaInput = document.getElementById('fecha');
        const today = new Date().toISOString().split('T')[0];
        if (fechaInput) {
            fechaInput.value = fechaInput.value || today;
        } else {
            console.warn('Ã¢ÂšÂ ÄÂ¸Â [PRESUPUESTOS-EDIT] Input #fecha no encontrado; se enviarÄ‚Ä„ fecha del dÄ‚Â­a desde JS');
        }

        // === MODO RETIRO: La detección por URL ha sido depreciada por riesgo de contaminación. 
        // El estado ahora se hidrata y define unívocamente vía backend en exp. presupuestoData.estado
        // para garantizar comportamiento inmutable.

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
                console.log('[PRESUPUESTOS-EDIT] Tipo comprobante Ã¢Â†Â’', tipoSel.value);
                applyIvaModeToAllRows();
            });
        }

        const agenteInput = document.getElementById('agente');
        if (agenteInput && !agenteInput.value.trim()) {
            agenteInput.value = 'Martin';
        }

        const puntoInput = document.getElementById('punto_entrega');
        if (puntoInput && !puntoInput.value.trim()) {
            puntoInput.value = 'Sin direcciÄ‚Å‚n';
        }

        const estadoSel = document.getElementById('estado');
        if (estadoSel && !estadoSel.value) {
            estadoSel.value = 'Presupuesto/Orden';
        }

        const fechaEntregaInput = document.getElementById('fecha_entrega');
        // usar misma fecha que 'fecha' si estÄ‚Ä„ vacÄ‚Â­o
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

        // Configurar botón "Guardar en Standby"
        const btnGuardarStandby = document.getElementById('btn-guardar-standby');
        if (btnGuardarStandby) {
            btnGuardarStandby.addEventListener('click', () => {
                const estadoSelect = document.getElementById('estado');
                if (estadoSelect) {
                    estadoSelect.value = 'Sin Confirmar';
                }
                const secuenciaInput = document.getElementById('secuencia');
                if (secuenciaInput) {
                    secuenciaInput.value = 'Standby';
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
        if (typeof setupClienteAutocomplete === 'function') {
            setupClienteAutocomplete();
        }

        // Configurar autocompletar para artÄ‚Â­culos usando mÄ‚Å‚dulo comÄ‚ÅŸn
        if (window.Detalles && window.Detalles.setupArticuloAutocomplete) {
            window.Detalles.setupArticuloAutocomplete();
        } else if (typeof setupArticuloAutocomplete === 'function') {
            setupArticuloAutocomplete();
        }

        // NUEVO: Exponer funciÄ‚Å‚n de selecciÄ‚Å‚n para compatibilidad con autocompletar
        window.seleccionarArticulo = seleccionarArticulo;

        // Cargar datos del presupuesto y detalles en paralelo
        Promise.all([cargarPresupuesto(), cargarDetallesPresupuesto()]).then(async () => {
            console.log('[EDIT] encabezado OK');
            console.log(`[EDIT] detalles: ${detallesData.length} filas`);

            // Renderizar detalles usando módulo común (con await!)
            await renderDetallesConModuloComun();

            // Aplicar modo IVA y recalcular totales
            applyIvaModeToAllRows();

            // Forzar la carga en caliente determinística de datasets financieros (incluyendo gananciaBunker) para todas las filas.
            if (window.conmutarModoBunker) {
                await window.conmutarModoBunker();
            } else {
                if (typeof recalcTotales === 'function') recalcTotales();
            }
        }).catch(error => {
            console.error('[EDIT] Error cargando datos:', error);
        });

        console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] PÄ‚Ä„gina inicializada correctamente');
    });

    /**
     * Cargar datos del presupuesto
     */
    async function cargarPresupuesto() {
        console.log(`Ä‘ÂŸÂ“Ä½ [PRESUPUESTOS-EDIT] Cargando datos del presupuesto ${presupuestoId}...`);

        try {
            // Obtener datos del presupuesto
            const response = await fetch(`/api/presupuestos/${presupuestoId}`);
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Error al cargar el presupuesto');
            }

            presupuestoData = result.data; // Line 283 match

            // AUTO-DETECCIÓN: Activar modo retiro si el estado lo indica
            if (presupuestoData.estado === 'Orden de Retiro') {
                console.log('📦 [EDIT] Estado "Orden de Retiro" detectado en datos -> Activando modo retiro');
                if (typeof activarModoRetiroEdicion === 'function') {
                    activarModoRetiroEdicion();
                }
            }
            console.log('ðŸ” [PRESUPUESTOS-EDIT] Datos del presupuesto cargados:', presupuestoData);

            // Actualizar informaciÃ³n principal (nombre del cliente)
            if (typeof window.actualizarInfoPrincipal === 'function') {
                window.actualizarInfoPrincipal(presupuestoData);
            }

            // Llenar informaciÃ³n de solo lectura
            llenarInformacionPresupuesto();

            // Llenar campos editables
            await llenarCamposEditables();

            // NUEVO: Actualizar botÃ³n de facturaciÃ³n segÃºn estado
            const estaFacturado = presupuestoData.esta_facturado || false;
            const facturaId = presupuestoData.factura_id || null;

            console.log(`[FACTURAR] Estado de facturaciÃ³n: estaFacturado=${estaFacturado}, facturaId=${facturaId}`);

            if (typeof actualizarBotonFacturacion === 'function') {
                actualizarBotonFacturacion(estaFacturado, facturaId);
            } else {
                console.warn('[FACTURAR] ⚠️ Función actualizarBotonFacturacion no disponible');
            }

        } catch (error) {
            console.error('âŒ [PRESUPUESTOS-EDIT] Error al cargar presupuesto:', error);
            mostrarMensaje(`âŒ Error al cargar el presupuesto: ${error.message}`, 'error');
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
            if (ivaRaw <= 1) ivaDecimal = ivaRaw;                 // ya es decimal
            else if (ivaRaw <= 100) ivaDecimal = ivaRaw / 100;           // porcentaje
            else ivaDecimal = neto ? ivaRaw / neto : 0; // importe IVA
        }

        // precio unitario con IVA
        const precioUnit = pvu || (neto * (1 + ivaDecimal));

        const descEspRaw = d?.descuento_adicional ?? d?.desc_adicional ?? d?.descuento_extra ?? 0;
        const descEsp = toNum(descEspRaw);

        return {
            // códigos
            codigo_barras: d?.codigo_barras ?? d?.cod_barra ?? d?.codigo ?? d?.articulo ?? d?.articulo_numero ?? '',
            articulo_numero: d?.articulo_numero ?? d?.articulo ?? '',
            // descripción (probamos varias claves comunes)
            descripcion: d?.descripcion_articulo ?? d?.detalle ?? d?.descripcion ?? d?.articulo_descripcion ?? d?.nombre ?? '',
            // números
            cantidad: toNum(d?.cantidad),
            valor1: neto,            // neto sin IVA
            iva1: ivaDecimal,        // SIEMPRE decimal (0.21)
            precio1: precioUnit,     // unitario con IVA
            descuento_adicional: descEsp,
            es_saldo_ingrediente: d?.es_saldo_ingrediente === true,
            ingrediente_id_saldo: d?.ingrediente_id_saldo || null,
            kilos_saldo: d?.kilos_saldo != null ? toNum(d?.kilos_saldo) : null,
            ingrediente_saldo_nombre: d?.ingrediente_saldo_nombre || ''
        };
    }

    /**
     * Cargar detalles del presupuesto
     */
    async function cargarDetallesPresupuesto() {
        console.log(`Ä‘ÂŸÂ“Åš [PRESUPUESTOS-EDIT] Cargando detalles del presupuesto ${presupuestoId}...`);

        try {
            const response = await fetch(`/api/presupuestos/${presupuestoId}/detalles`);
            const result = await response.json();

            if (response.ok && result.success) {
                const data = result.data;
                const lista = Array.isArray(data) ? data : (Array.isArray(data?.detalles) ? data.detalles : []);
                detallesData = lista.map(normalizarDetalle);
                
                // Merge detalles_sin_stock if present
                if (data && data.detalles_sin_stock && Array.isArray(data.detalles_sin_stock)) {
                    const sinStockMap = data.detalles_sin_stock.map(d => {
                        const nod = normalizarDetalle(d);
                        nod.is_out_of_stock = true;
                        return nod;
                    });
                    detallesData = detallesData.concat(sinStockMap);
                }

                const detallesCount = detallesData.length;
                document.getElementById('info-detalles').textContent = `${detallesCount} artÄ‚Â­culos`;
                console.log(`Ä‘ÂŸÂ“Åš [PRESUPUESTOS-EDIT] Detalles cargados: ${detallesCount} artÄ‚Â­culos`);
            } else {
                console.warn('Ã¢ÂšÂ ÄÂ¸Â [PRESUPUESTOS-EDIT] No se pudieron cargar los detalles');
                document.getElementById('info-detalles').textContent = 'No disponible';
            }

        } catch (error) {
            console.error('Ã¢ÂÂŒ [PRESUPUESTOS-EDIT] Error al cargar detalles:', error);
            document.getElementById('info-detalles').textContent = 'Error al cargar';
        }
    }

    /**
     * Llenar informaciÄ‚Å‚n de solo lectura
     */
    function llenarInformacionPresupuesto() {
        console.log('Ä‘ÂŸÂ“Â‹ [PRESUPUESTOS-EDIT] Llenando informaciÄ‚Å‚n del presupuesto...');

        document.getElementById('info-id').textContent = presupuestoData.id_presupuesto_ext || presupuestoData.id || '-';
        document.getElementById('info-cliente').textContent = presupuestoData.id_cliente || '-';
        document.getElementById('info-fecha').textContent = formatearFecha(presupuestoData.fecha) || '-';
        document.getElementById('info-estado').textContent = presupuestoData.estado || '-';
        document.getElementById('info-tipo').textContent = presupuestoData.tipo_comprobante || '-';
    }

    /**
     * Llenar campos editables con datos actuales
     */
    async function llenarCamposEditables() {
        console.log('[EDIT] Llenando campos editables...');

        // nota
        document.getElementById('nota').value = presupuestoData.nota ?? '';

        // punto de entrega
        document.getElementById('punto_entrega').value =
            (presupuestoData.punto_entrega && presupuestoData.punto_entrega.trim()) ? presupuestoData.punto_entrega : 'Sin direcciÄ‚Å‚n';

        // descuento: si viene 0.05 mostrar 5
        const d = Number(presupuestoData.descuento);
        document.getElementById('descuento').value =
            Number.isFinite(d) ? (d <= 1 ? d * 100 : d) : 0;

        // Otros campos
        document.getElementById('id_cliente').value = presupuestoData.id_cliente || '';
        document.getElementById('fecha').value = presupuestoData.fecha ? presupuestoData.fecha.split('T')[0] : '';
        document.getElementById('tipo_comprobante').value = presupuestoData.tipo_comprobante || 'Factura';
        document.getElementById('estado').value = presupuestoData.estado || 'Presupuesto/Orden';
        const secuenciaInput = document.getElementById('secuencia');
        if (secuenciaInput) {
            secuenciaInput.value = presupuestoData.secuencia || (presupuestoData.estado === 'Sin Confirmar' ? 'Standby' : 'Imprimir');
        }
        document.getElementById('agente').value = presupuestoData.agente || '';

        // Inicializar switch de precios Búnker desde el presupuesto cargado
        const usarPreciosBunker = presupuestoData.usar_precios_bunker === true || presupuestoData.usar_precios_bunker === 'true';
        const switchInput = document.getElementById('usar_precios_bunker');
        const label = document.getElementById('bunker-switch-label');
        if (switchInput) {
            switchInput.checked = usarPreciosBunker;
            if (label) {
                label.innerText = usarPreciosBunker ? 'Activo' : 'Inactivo';
                label.style.color = usarPreciosBunker ? '#166534' : '#475569';
            }
        }

        // Verificar si el cliente tiene listas de precios Búnker para mostrar/ocultar el switch
        const clienteIdForBunker = parseInt(presupuestoData.id_cliente, 10) || 0;
        if (clienteIdForBunker > 0) {
            try {
                const res = await fetch(`/api/presupuestos/clientes/${clienteIdForBunker}`);
                if (res.ok) {
                    const body = await res.json();
                    const clienteData = body?.data;
                    const wrapper = document.getElementById('bunker-switch-wrapper');
                    const switchInputEl = document.getElementById('usar_precios_bunker');
                    const labelEl = document.getElementById('bunker-switch-label');
                    const badgeEl = document.getElementById('bunker-lista-badge');

                    if (wrapper) wrapper.style.display = 'inline-flex';

                    if (clienteData?.tiene_listas_bunker || usarPreciosBunker) {
                        if (switchInputEl) switchInputEl.disabled = false;
                        if (badgeEl) {
                            badgeEl.style.display = 'inline-flex';
                            if (clienteData?.tiene_listas_bunker) {
                                badgeEl.textContent = `📋 Lista: ${clienteData.bunker_lista_nombre || 'Asignada'}`;
                                badgeEl.dataset.listaNombre = clienteData.bunker_lista_nombre || 'Asignada';
                                if (usarPreciosBunker) {
                                    badgeEl.style.background = '#dcfce7';
                                    badgeEl.style.color = '#15803d';
                                    badgeEl.style.border = '1px solid #86efac';
                                    if (wrapper) {
                                        wrapper.style.background = '#f0fdf4';
                                        wrapper.style.borderColor = '#bbf7d0';
                                    }
                                } else {
                                    badgeEl.style.background = '#f1f5f9';
                                    badgeEl.style.color = '#64748b';
                                    badgeEl.style.border = '1px solid #cbd5e1';
                                    if (wrapper) {
                                        wrapper.style.background = '#f8fafc';
                                        wrapper.style.borderColor = '#e2e8f0';
                                    }
                                }
                            } else {
                                badgeEl.textContent = '⚠️ Sin lista asignada';
                                badgeEl.dataset.listaNombre = '';
                                badgeEl.style.background = '#fef3c7';
                                badgeEl.style.color = '#b45309';
                                badgeEl.style.border = '1px solid #fcd34d';
                            }
                        }
                    } else {
                        if (switchInputEl) {
                            switchInputEl.checked = false;
                            switchInputEl.disabled = true;
                        }
                        if (labelEl) {
                            labelEl.innerText = 'Inactivo';
                            labelEl.style.color = '#92400e';
                        }
                        if (badgeEl) {
                            badgeEl.style.display = 'inline-flex';
                            badgeEl.textContent = '⚠️ Sin lista asignada';
                            badgeEl.dataset.listaNombre = '';
                            badgeEl.style.background = '#fef3c7';
                            badgeEl.style.color = '#b45309';
                            badgeEl.style.border = '1px solid #fcd34d';
                        }
                        if (wrapper) {
                            wrapper.style.background = '#fffbeb';
                            wrapper.style.borderColor = '#fde68a';
                        }
                    }
                }
            } catch (err) {
                console.error('Error al verificar listas Bunker del cliente:', err);
            }

            // 🏷️ Cargar Política Comercial asignada al cliente y evaluar
            try {
                if (window.EvaluadorPoliticas && typeof window.EvaluadorPoliticas.cargarPoliticaCliente === 'function') {
                    await window.EvaluadorPoliticas.cargarPoliticaCliente(clienteIdForBunker);
                    const pctGuardado = Number.isFinite(d) ? (d <= 1 ? d * 100 : d) : 0;
                    if (pctGuardado > 0 && typeof window.EvaluadorPoliticas.autorizarDescuentoExistente === 'function') {
                        window.EvaluadorPoliticas.autorizarDescuentoExistente(pctGuardado);
                    }
                    recalcTotales();
                }
            } catch (errPol) {
                console.warn('⚠️ No se pudo cargar política comercial del cliente en edición:', errPol);
            }
        }

        // Secuencia - Preservar "Standby" si el presupuesto está en Standby / Sin Confirmar
        const esStandbyActual = (presupuestoData.secuencia === 'Standby' || presupuestoData.estado === 'Sin Confirmar' || presupuestoData.estado === 'Standby');
        document.getElementById('secuencia').value = esStandbyActual ? 'Standby' : 'Imprimir';
        console.log(`[PRESUPUESTO-EDIT] Campo secuencia fijado en "${document.getElementById('secuencia').value}"`);

        // Fecha de entrega (convertir formato si es necesario)
        if (presupuestoData.fecha_entrega) {
            const fechaEntrega = new Date(presupuestoData.fecha_entrega);
            if (!isNaN(fechaEntrega.getTime())) {
                document.getElementById('fecha_entrega').value = fechaEntrega.toISOString().split('T')[0];
            }
        }

        // ===== Lógica de Edición de Retiros (Paridad) =====
        if (presupuestoData.estado === 'Orden de Retiro' || presupuestoData.estado === 'Administrativa NC') {
            const origenSelect = document.getElementById('origen_facturacion');
            if (origenSelect && presupuestoData.origen_facturacion) {
                // Seleccionar opcion LOMASOFT o LAMDA
                const options = Array.from(origenSelect.options);
                const hasMatch = options.some(opt => opt.value === presupuestoData.origen_facturacion);
                if (hasMatch) {
                    origenSelect.value = presupuestoData.origen_facturacion;
                }
                origenSelect.dispatchEvent(new Event('change')); // dispara handler de UI
            }

            if (presupuestoData.origen_punto_venta) {
                document.getElementById('origen_punto_venta').value = presupuestoData.origen_punto_venta;
            }
            if (presupuestoData.origen_numero_factura) {
                document.getElementById('origen_numero_factura').value = presupuestoData.origen_numero_factura;
            }

            // Marcar Trámite Administrativo si aplica
            if (presupuestoData.estado === 'Administrativa NC') {
                const optAdmin = document.getElementById('chk_tramite_administrativo_mock');
                if (optAdmin) {
                    optAdmin.click(); // dispara los checks de UI manuales
                }
            }
            
            // Logística
            if (presupuestoData.metodo_retiro) {
                const metodoRadio = document.querySelector(`input[name="metodo_retiro"][value="${presupuestoData.metodo_retiro}"]`);
                if (metodoRadio) metodoRadio.checked = true;
            }
        }

        console.log('[EDIT] Campos editables llenados');
    }

    /**
     * Renderizar detalles desde BD usando el mÄ‚Å‚dulo comÄ‚ÅŸn
     * CORREGIDO: Igualar comportamiento con creaciÄ‚Å‚n
     */
    async function renderDetallesConModuloComun() {
        const tbody = document.getElementById('detalles-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Resetear contador del módulo común
        if (window.Detalles) {
            window.Detalles.detalleCounter = 0;
        }

        const tipoSel = document.getElementById('tipo_comprobante');
        const esRemito = () => tipoSel && tipoSel.value === 'Remito-Efectivo';

        const switchInput = document.getElementById('usar_precios_bunker');
        const usarPreciosBunker = switchInput ? switchInput.checked : (typeof presupuestoData !== 'undefined' && (presupuestoData.usar_precios_bunker === true || presupuestoData.usar_precios_bunker === 'true'));

        // Tracking para filas hijas (Kit de insumos UP)
        let activeParentRowId = null;
        let activeKitIngredientCodes = [];

        // Procesar cada detalle de forma asíncrona
        for (const det of detallesData) {
            console.log(`📋 [PRESUPUESTOS-EDIT] Renderizando detalle:`, det);

            const ivaPctBase = ((det.iva1 || 0) * 100);
            const ivaPctVisible = esRemito() ? (ivaPctBase / 2) : ivaPctBase;

            agregarDetalle();
            const idx = window.Detalles ? window.Detalles.detalleCounter : 1;

            const row = document.getElementById(`detalle-${idx}`);
            if (!row) continue;

            const artInput = row.querySelector(`input[name="detalles[${idx}][articulo]"]`);
            const cantInput = row.querySelector(`input[name="detalles[${idx}][cantidad]"]`);
            const valorInput = row.querySelector(`input[name="detalles[${idx}][valor1]"]`);
            const ivaInput = row.querySelector(`input[name="detalles[${idx}][iva1]"]`);

            const searchCode = (det.codigo_barras || det.articulo_numero || det.articulo || '').trim();

            // 1. Detectar si este renglón es un insumo hijo del Kit del renglón anterior
            const isChildIngredient = activeParentRowId && activeKitIngredientCodes.includes(searchCode);

            if (isChildIngredient) {
                row.classList.add('child-row');
                row.dataset.childOf = activeParentRowId;
                if (artInput) {
                    artInput.readOnly = true;
                    artInput.style.backgroundColor = '#f1f5f9';
                    artInput.style.fontWeight = 'bold';
                    artInput.style.color = '#475569';
                }
            }

            // 2. Resolver descripción friendly
            if (artInput) {
                let descripcionVisible = (det.descripcion || '').trim();
                
                // Un valor se considera "código crudo" solo si la descripción está vacía, es igual al código, 
                // o si la descripción es idéntica a un código numérico largo de barras.
                const isRaw = !descripcionVisible ||
                    descripcionVisible === searchCode ||
                    (/^[0-9]{8,14}$/.test(descripcionVisible) && searchCode === descripcionVisible);

                if (isRaw && searchCode && !isChildIngredient) {
                    console.log(`🔍 [PRESUPUESTOS-EDIT] Detectado código crudo: "${descripcionVisible || searchCode}". Buscando descripción friendly...`);
                    const clienteId = parseInt(presupuestoData.id_cliente, 10) || 0;
                    
                    const descripcionEncontrada = await buscarDescripcionPorCodigo(searchCode, clienteId, usarPreciosBunker);
                    if (descripcionEncontrada) {
                        descripcionVisible = descripcionEncontrada;
                        console.log(`✅ [PRESUPUESTOS-EDIT] Reemplazo exitoso: ${descripcionVisible}`);
                    } else {
                        descripcionVisible = searchCode;
                    }
                } else if (!descripcionVisible) {
                    descripcionVisible = searchCode;
                }

                artInput.value = descripcionVisible;
                artInput.dataset.codigoBarras = det.codigo_barras || det.articulo || '';
                artInput.dataset.articuloNumero = det.articulo_numero || det.articulo || '';
            }

            // 3. Setear valores UNITARIOS (respetando precios guardados de la instantánea histórica)
            if (cantInput) setCantidad(cantInput, det.cantidad || 1);
            if (valorInput) setNumeric(valorInput, det.valor1 || 0, 2, 0);
            const descInput = row.querySelector(`input[name="detalles[${idx}][descuento_adicional]"]`);
            if (descInput) setNumeric(descInput, det.descuento_adicional || 0, 2, 0);
            if (ivaInput) {
                ivaInput.dataset.ivaBase = String(ivaPctBase);
                setNumeric(ivaInput, ivaPctVisible, 2, 21);
            }

            // Marcar fila como perteneciente al ecosistema del presupuesto cargado
            row.dataset.isOriginalBudgetRow = "true";
            row.dataset.initialPrice = String(det.valor1 || 0);
            row.dataset.initialIva = String(ivaPctBase);

            if (usarPreciosBunker) {
                row.dataset.priceBunker = String(det.valor1 || 0);
                row.dataset.ivaBunker = String(ivaPctBase);
                row.dataset.priceSource = 'bunker';
            } else {
                row.dataset.priceLegacy = String(det.valor1 || 0);
                row.dataset.ivaLegacy = String(ivaPctBase);
                row.dataset.priceSource = 'legacy';
            }

            if (window.Detalles && window.Detalles.calcularPrecio) {
                window.Detalles.calcularPrecio(idx);
            }

            // 4. Verificar si este renglón es un Artículo Base con Kit UP enlazado (para registrar sus insumos para los siguientes renglones)
            if (searchCode && !isChildIngredient) {
                try {
                    const kitRes = await fetch(`/api/produccion/recetas/hibridas/nativa/${encodeURIComponent(searchCode)}`);
                    if (kitRes.ok) {
                        const kitData = await kitRes.json();
                        if (kitData.enlazado && kitData.ingredientes && kitData.ingredientes.length > 0) {
                            activeParentRowId = row.id || `detalle-${idx}`;
                            activeKitIngredientCodes = kitData.ingredientes.map(i => String(i.articulo_id));
                        } else {
                            activeParentRowId = null;
                            activeKitIngredientCodes = [];
                        }
                    } else {
                        activeParentRowId = null;
                        activeKitIngredientCodes = [];
                    }
                } catch(e) {
                    console.error('[EDIT] Error al verificar Kit UP para renglón', e);
                    activeParentRowId = null;
                    activeKitIngredientCodes = [];
                }
            }

            if (det.es_saldo_ingrediente) {
                row.dataset.esSaldoIngrediente = 'true';
                row.dataset.ingredienteIdSaldo = String(det.ingrediente_id_saldo || '');
                row.dataset.kilosSaldo = String(det.kilos_saldo || '');
                row.dataset.ingredienteSaldoNombre = String(det.ingrediente_saldo_nombre || '');
                if (typeof window.renderCucardaSaldoIngrediente === 'function') {
                    window.renderCucardaSaldoIngrediente(row, det);
                }
            }

            if (det.is_out_of_stock && window.Detalles && window.Detalles.toggleSinStock) {
                const btn = row.querySelector('.btn-sin-stock');
                if (btn) {
                    window.Detalles.toggleSinStock(btn);
                }
            }

            console.log(`✅ [PRESUPUESTOS-EDIT] Detalle ${idx} renderizado correctamente`);
        }

        // Recalcular totales finales
        if (window.Detalles && window.Detalles.recalcTotales) {
            window.Detalles.recalcTotales();
        }

        console.log(`✅ [PRESUPUESTOS-EDIT] Todos los detalles renderizados: ${detallesData.length} ítems`);
    }

    /**
     * Formatear fecha para mostrar
     */
    function formatearFecha(fecha) {
        if (!fecha) return null;

        try {
            const date = new Date(fecha);
            if (isNaN(date.getTime())) return fecha; // Si no es vÄ‚Ä„lida, devolver original

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
     * Seleccionar artÄ‚Â­culo del autocompletar - CORREGIDO para igualar comportamiento de creaciÄ‚Å‚n
     * SIGNATURA COMPATIBLE: (input, element) como en creaciÄ‚Å‚n
     */
    function seleccionarArticulo(input, element) {
        // Si se llama con la signatura antigua (articulo, detalleIndex), adaptarla
        if (typeof input === 'object' && input.descripcion && typeof element === 'number') {
            const articulo = input;
            const detalleIndex = element;
            return seleccionarArticuloLegacy(articulo, detalleIndex);
        }

        // NUEVA IMPLEMENTACIÄ‚Â“N: Signatura compatible con creaciÄ‚Å‚n (input, element)
        const codigoBarras = (element.dataset.codigoBarras || '').toString();
        const articuloNumero = (element.dataset.articuloNumero || '').toString();
        const description = (element.dataset.description || '').toString();
        const stock = parseFloat(element.dataset.stock || 0);

        console.log(`Ä‘ÂŸÂ“Åš [PRESUPUESTOS-EDIT] Seleccionando artÄ‚Â­culo: ${description} [${articuloNumero}] (Stock: ${stock})`);

        // Mostrar descripciÄ‚Å‚n al usuario y guardar cÄ‚Å‚digos reales para el submit
        input.value = description;
        input.dataset.codigoBarras = codigoBarras;
        input.dataset.articuloNumero = articuloNumero;

        // Remover cualquier estilo que cause texto azul
        input.style.color = '';
        input.classList.remove('articulo-codigo');

        console.log(`Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] ArtÄ‚Â­culo seleccionado: ${description}`);

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
            if (typeof window.renderOfertaBadgeFila === 'function') {
                window.renderOfertaBadgeFila(row, detalleId, ofertaActiva, descPct);
            }
        } else {
            // Si no tiene oferta activa, remover cualquier badge residual
            row?.querySelector('.switch-oferta-container')?.remove();
        }

        if (detalleId != null && window.Detalles && window.Detalles.calcularPrecio) {
            window.Detalles.calcularPrecio(detalleId);
        }
        if (typeof recalcTotales === 'function') recalcTotales();

        // BUSCAR PRECIOS AUTOMÁTICAMENTE (igual que en creación) - Integrado con precios Búnker
        const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;
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
            let valorBunker = null, ivaBunker = null;
            let valorLegacy = null, ivaLegacy = null;
            let gananciaBunker = 0;

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

                if (resBunker && resBunker.data) {
                    valorBunker = Number(resBunker.data.valor1);
                    ivaBunker = Number(resBunker.data.iva);
                    gananciaBunker = Number(resBunker.data.ganancia_real) || 0;
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
                if (resBunker?.data) {
                    const cBulto = resBunker.data.costo_bulto !== undefined ? resBunker.data.costo_bulto : (resBunker.data.costo_operativo || 0);
                    const cTiempo = resBunker.data.costo_tiempo !== undefined ? resBunker.data.costo_tiempo : 0;
                    row.dataset.costoBunker = String(cBulto);
                    row.dataset.costoTiempoBunker = String(cTiempo);
                }
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
                if (window.Detalles.renderPriceBadge) {
                    window.Detalles.renderPriceBadge(detalleId);
                }
                window.Detalles.calcularPrecio(detalleId);
            }

            // -------------------------------------------------------------
            // LÓGICA DE SSOT: VERIFICAR SI EL ARTÍCULO TIENE KIT NATIVO (UP)
            // -------------------------------------------------------------
            const articuloBaseParaKit = articuloNumero || input.dataset.articuloNumero || codigoBarras || description || element.dataset.id;
            console.log('[KIT-FRONT-DEBUG] Evaluando Kit para (Edit):', {articuloNumero, codigoBarras, description, seleccionado: articuloBaseParaKit});
            if (articuloBaseParaKit) {
                try {
                    const kitRes = await fetch(`/api/produccion/recetas/hibridas/nativa/${encodeURIComponent(articuloBaseParaKit)}`);
                    if (kitRes.ok) {
                        const kitData = await kitRes.json();
                        if (kitData.enlazado && kitData.ingredientes && kitData.ingredientes.length > 0) {
                            console.log('[KIT] Artículo base tiene UP enlazada. Agregando botón de Kit en Edit.');
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
                                        console.error('[KIT] Error: window.inyectarFilasHijasKit no está definido en Edit');
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
            console.log('✅ [PRESUPUESTOS-EDIT] Precios actualizados automáticamente');
        })();
    }

    /**
     * FunciÄ‚Å‚n legacy para compatibilidad con signatura antigua
     */
    function seleccionarArticuloLegacy(articulo, detalleIndex) {
        console.log('Ä‘ÂŸÂ“Åš [PRESUPUESTOS-EDIT] Seleccionando artÄ‚Â­culo (legacy):', articulo, 'para detalle:', detalleIndex);

        // Encontrar la fila correspondiente usando el detalleIndex como ID de fila
        const row = document.getElementById(`detalle-${detalleIndex}`);
        if (!row) {
            console.error('Ã¢Â ÂŒ [PRESUPUESTOS-EDIT] Fila de detalle no encontrada:', detalleIndex);
            return;
        }

        // Actualizar inputs de la fila
        const artInput = row.querySelector(`input[name="detalles[${detalleIndex}][articulo]"]`);
        const valorInput = row.querySelector(`input[name="detalles[${detalleIndex}][valor1]"]`);
        const ivaInput = row.querySelector(`input[name="detalles[${detalleIndex}][iva1]"]`);
        const cantInput = row.querySelector(`input[name="detalles[${detalleIndex}][cantidad]"]`);

        if (artInput) {
            // CORREGIDO: Mostrar descripciÄ‚Å‚n al usuario y guardar cÄ‚Å‚digo de barras
            artInput.value = articulo.descripcion || articulo.description || articulo.nombre || '';
            artInput.dataset.codigoBarras = articulo.codigo_barras || '';
            artInput.dataset.articuloNumero = articulo.articulo_numero || '';

            // Remover cualquier estilo que cause texto azul
            artInput.style.color = '';
            artInput.classList.remove('articulo-codigo');
        }

        // CORREGIDO: Usar los mismos valores que en creaciÄ‚Å‚n
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

        console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] ArtÄ‚Â­culo seleccionado y datos actualizados (legacy)');

        // Recalcular precio para esta fila
        if (window.Detalles && window.Detalles.calcularPrecio) {
            window.Detalles.calcularPrecio(detalleIndex);
        }
        if (window.Detalles && window.Detalles.recalcTotales) {
            window.Detalles.recalcTotales();
        }

        // NUEVO: Buscar precios automÄ‚Ä„ticamente como en creaciÄ‚Å‚n
        buscarPreciosAutomaticamente(articulo, detalleIndex);
    }

    /**
     * Buscar precios automÄ‚Ä„ticamente como en el flujo de creaciÄ‚Å‚n
     */
    async function buscarPreciosAutomaticamente(articulo, detalleIndex) {
        try {
            const clienteId = parseInt(getClienteIdActivo(), 10) || 0;
            const codigoBarras = articulo.codigo_barras || '';
            const descripcion = articulo.descripcion || articulo.description || '';
            const usarPreciosBunker = document.getElementById('usar_precios_bunker')?.checked || false;

            console.log(`Ä‘ÂŸÂ”Â  [PRESUPUESTOS-EDIT] Buscando precios para cliente ${clienteId}, cÄ‚Å‚digo: ${codigoBarras}, usarPreciosBunker: ${usarPreciosBunker}`);

            const fetchPrecios = async (params) => {
                const url = `/api/presupuestos/precios?${params.toString()}`;
                console.log('[PRESUPUESTOS-EDIT] GET precios ->', url);
                const r = await fetch(url);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            };

            let valor, iva;
            let valorBunker = null, ivaBunker = null;
            let valorLegacy = null, ivaLegacy = null;
            let gananciaBunker = 0;

            try {
                const pBunker = new URLSearchParams({ cliente_id: String(clienteId), usar_precios_bunker: 'true' });
                const pLegacy = new URLSearchParams({ cliente_id: String(clienteId) });
                if (codigoBarras) {
                    pBunker.set('codigo_barras', codigoBarras);
                    pLegacy.set('codigo_barras', codigoBarras);
                } else if (descripcion) {
                    pBunker.set('descripcion', descripcion);
                    pLegacy.set('descripcion', descripcion);
                }

                const [resBunker, resLegacy] = await Promise.all([
                    fetchPrecios(pBunker).catch(e => { console.warn('Bunker price fetch failed:', e); return null; }),
                    fetchPrecios(pLegacy).catch(e => { console.warn('Legacy price fetch failed:', e); return null; })
                ]);

                if (resBunker && resBunker.data) {
                    valorBunker = Number(resBunker.data.valor1);
                    ivaBunker = Number(resBunker.data.iva);
                    gananciaBunker = Number(resBunker.data.ganancia_real) || 0;
                }
                if (resLegacy && resLegacy.data) {
                    valorLegacy = Number(resLegacy.data.valor1);
                    ivaLegacy = Number(resLegacy.data.iva);
                }
            } catch (e) {
                console.error('Error fetching prices in parallel:', e);
            }

            const activeSource = usarPreciosBunker ? 'bunker' : 'legacy';
            const row = document.getElementById(`detalle-${detalleIndex}`);
            if (row) {
                row.dataset.priceBunker = valorBunker !== null ? String(valorBunker) : '';
                row.dataset.ivaBunker = ivaBunker !== null ? String(ivaBunker) : '21';
                row.dataset.gananciaBunker = String(gananciaBunker);
                if (resBunker?.data) {
                    const cBulto = resBunker.data.costo_bulto !== undefined ? resBunker.data.costo_bulto : (resBunker.data.costo_operativo || 0);
                    const cTiempo = resBunker.data.costo_tiempo !== undefined ? resBunker.data.costo_tiempo : 0;
                    row.dataset.costoBunker = String(cBulto);
                    row.dataset.costoTiempoBunker = String(cTiempo);
                }
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

            // Actualizar valores si se encontraron
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

                // Recalcular después de actualizar precios
                if (window.Detalles && window.Detalles.calcularPrecio) {
                    if (window.Detalles.renderPriceBadge) {
                        window.Detalles.renderPriceBadge(detalleIndex);
                    }
                    window.Detalles.calcularPrecio(detalleIndex);
                }
            }

            console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] Precios actualizados automÄ‚Ä„ticamente');

        } catch (error) {
            console.warn('Ã¢ÂšÂ ÄÂ¸Â [PRESUPUESTOS-EDIT] Error buscando precios automÄ‚Ä„ticamente:', error);
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
     * Obtener ID de detalle desde input (funciÄ‚Å‚n auxiliar)
     */
    function getDetalleIdFromInput(input) {
        if (!input || !input.name) return null;
        const match = input.name.match(/\[(\d+)\]\[/);
        return match ? parseInt(match[1], 10) : null;
    }

    /**
     * Seleccionar artÄ‚Â­culo por click (funciÄ‚Å‚n legacy para compatibilidad)
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

        // Obtener el ID de detalle desde el botÄ‚Å‚n mÄ‚Ä„s cercano
        const detalleId = getDetalleIdFromInput(event.target.closest('tr')?.querySelector('input[name*="articulo"]'));
        if (detalleId !== null) {
            seleccionarArticulo(articulo, detalleId);
        }
    }

    /**
     * Remover detalle (funciÄ‚Å‚n legacy para compatibilidad)
     */
    function removerDetalle(detalleId) {
        const row = document.getElementById(`detalle-${detalleId}`);
        if (row) {
            row.remove();
            recalcTotales();
        }
    }

    /**
     * Seleccionar cliente por click (funciÄ‚Å‚n legacy para compatibilidad)
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
     * Manejar envÄ‚Â­o del formulario
     */
    async function handleSubmit(event) {
        event.preventDefault();

        console.log('Ä‘ÂŸÂ“Â¤ [PRESUPUESTOS-EDIT] Iniciando envÄ‚Â­o de formulario...');

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

            // CORRECCIÓN: Validar que haya al menos un detalle


            const tbody = document.getElementById('detalles-tbody');


            const filasDetalles = tbody ? tbody.querySelectorAll('tr') : [];





            console.log('[EDIT-DETALLE] Validación de detalles:', {


                tbody_existe: !!tbody,


                cantidad_filas: filasDetalles.length


            });





            if (!tbody || filasDetalles.length === 0) {


                console.error('[EDIT-DETALLE] ❌ Validación fallida: No hay detalles');


                throw new Error('El presupuesto debe tener al menos un artículo antes de guardar.');


            }





            console.log('[EDIT-DETALLE] ✅ Validación de detalles exitosa');

            // Validar cada fila del DOM
            const rows = tbody.querySelectorAll('tr');
            for (const row of rows) {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                const cantInput = row.querySelector('input[name*="[cantidad]"]');
                const valorInput = row.querySelector('input[name*="[valor1]"]');
                const ivaInput = row.querySelector('input[name*="[iva1]"]');

                if (!artInput || !artInput.value.trim()) {
                    throw new Error('Todos los detalles deben tener un artÄ‚Â­culo vÄ‚Ä„lido');
                }
                // Validar que el artÄ‚Â­culo tenga cÄ‚Å‚digo de barras (seleccionado desde autocompletar)
                if (!artInput.dataset.codigoBarras || !artInput.dataset.codigoBarras.trim()) {
                    throw new Error(`El artÄ‚Â­culo "${artInput.value}" no es vÄ‚Ä„lido. SelecciÄ‚Å‚nalo desde el autocompletar.`);
                }
                if (!cantInput || parseFloat(cantInput.value) <= 0) {
                    throw new Error('Todos los detalles deben tener una cantidad mayor a cero');
                }
                if (!valorInput || parseFloat(valorInput.value) < 0) {
                    throw new Error('Todos los detalles deben tener un valor unitario vÄ‚Ä„lido');
                }
                if (!ivaInput || parseFloat(ivaInput.value) < 0) {
                    throw new Error('Todos los detalles deben tener un IVA vÄ‚Ä„lido');
                }
            }

            // Serializar detalles del DOM con el mismo formato que espera el POST
            const detalles = [];
            const detalles_sin_stock = [];
            
            rows.forEach(row => {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                const cantInput = row.querySelector('input[name*="[cantidad]"]');
                const valorInput = row.querySelector('input[name*="[valor1]"]');
                const descInput = row.querySelector('input[name*="[descuento_adicional]"]');
                const ivaInput = row.querySelector('input[name*="[iva1]"]');

                const realCodigo = (artInput?.dataset?.codigoBarras || artInput?.dataset?.articuloNumero || artInput?.value || '').trim();
                if (artInput && realCodigo) {
                    const esSaldo = row.dataset.esSaldoIngrediente === 'true';
                    const rowData = {
                        articulo: realCodigo,
                        descripcion: artInput.value || '',
                        cantidad: parseFloat(cantInput.value) || 0,
                        valor1: parseFloat(valorInput.value) || 0,
                        descuento_adicional: parseFloat(descInput?.value) || 0,
                        iva1: parseFloat(ivaInput.value) || 0,
                        es_saldo_ingrediente: esSaldo,
                        ingrediente_id_saldo: esSaldo ? (parseInt(row.dataset.ingredienteIdSaldo, 10) || null) : null,
                        kilos_saldo: esSaldo ? (parseFloat(row.dataset.kilosSaldo) || null) : null
                    };
                    
                    if (row.classList.contains('out-of-stock-row')) {
                        const motivoInput = row.querySelector('input[name*="motivo"], .motivo-input, input.motivo');
                        rowData.motivo_falta = motivoInput ? motivoInput.value.trim() : 'Sin Stock en mostrador';
                        detalles_sin_stock.push(rowData);
                    } else {
                        detalles.push(rowData);
                    }
                }
            });

            console.log(`[PUT-FRONT] detalles serializados:`, detalles.length, 'faltantes:', detalles_sin_stock.length);

            // Enviar actualizaciÄ‚Å‚n del presupuesto (cabecera + detalles)
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
                secuencia: (data.estado === 'Orden de Retiro' || new URLSearchParams(window.location.search).get('modo') === 'retiro')
                    ? 'Pedido_Listo'
                    : ((data.estado === 'Sin Confirmar' || data.estado === 'Standby' || document.getElementById('secuencia')?.value === 'Standby') ? 'Standby' : 'Imprimir'),
                usar_precios_bunker: document.getElementById('usar_precios_bunker')?.checked || false,

                // Detalles
                detalles: detalles,
                detalles_sin_stock: detalles_sin_stock
            };

            console.log(`[PRESUPUESTO] Guardando presupuesto editado, forzando secuencia = 'Imprimir', id_presupuesto: ${presupuestoId}`);

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

            // Restaurar descripciones visibles en los inputs de artÄÂculos
            rows.forEach(row => {
                const artInput = row.querySelector('input[name*="[articulo]"]');
                if (artInput && artInput.dataset.descripcionVisible) {
                    artInput.value = artInput.dataset.descripcionVisible;
                }
            });

            // Manejo de Bloqueo Fiscal Parcial Parcial
            if (result.fiscalLock) {
                console.warn('🔒 [PRESUPUESTOS-EDIT] Bloqueo Fiscal Activo');
                mostrarMensaje(`⚠️ ${result.message}`, 'error'); // Usamos 'error' (rojo) para mayor visibilidad a pesar de ser success true.

                // Redirigir después de 4 segundos para que lean que los detalles no se guardaron
                setTimeout(() => {
                    window.location.href = '/pages/presupuestos.html';
                }, 4000);
                return;
            }

            mostrarMensaje('Ã¢ÂœÂ… Presupuesto actualizado exitosamente', 'success');

            console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] Presupuesto actualizado correctamente');

            // Redirigir despuÄÅs de 2 segundos
            setTimeout(() => {
                window.location.href = '/pages/presupuestos.html';
            }, 2000);

        } catch (error) {
            console.error('Ã¢ÂÂŒ [PRESUPUESTOS-EDIT] Error al actualizar presupuesto:', error);
            mostrarMensaje(`Ã¢ÂÂŒ Error al actualizar presupuesto: ${error.message}`, 'error');
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
        console.log(`Ä‘ÂŸÂ’Å¹ [PRESUPUESTOS-EDIT] Mostrando mensaje: ${texto}`);

        const container = document.getElementById('message-container');

        // Limpiar mensajes anteriores
        container.innerHTML = '';

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${tipo}`;
        messageDiv.textContent = texto;
        messageDiv.style.display = 'block';

        container.appendChild(messageDiv);

        // Auto-ocultar despuÄ‚Å s de 5 segundos (excepto errores)
        if (tipo !== 'error') {
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }

    console.log('Ã¢ÂœÂ… [PRESUPUESTOS-EDIT] MÄ‚Å‚dulo de ediciÄ‚Å‚n cargado correctamente');

})(); // Cerrar IIFE
/**
 * Actualizar estado del botÃ³n Facturar/Ver factura segÃºn estado de facturaciÃ³n
 */
function actualizarBotonFacturacion(estaFacturado, facturaId) {
    const btn = document.getElementById("btn-facturar");
    if (!btn) return;

    console.log(`[FACTURAR] Actualizando botÃ³n: estaFacturado=${estaFacturado}, facturaId=${facturaId}`);

    if (estaFacturado && facturaId) {
        // Presupuesto ya facturado - mostrar "Ver factura"
        btn.textContent = "ðŸ‘ï¸ Ver Factura";
        btn.className = "btn btn-secondary";
        btn.onclick = () => {
            window.location.href = (window.LAMDA_RESOLVE_URL ? window.LAMDA_RESOLVE_URL(`http://localhost:3004/pages/ver-factura.html?id=${facturaId}`) : `http://localhost:3004/pages/ver-factura.html?id=${facturaId}`);
        };
        console.log(`[FACTURAR] âœ… BotÃ³n configurado como "Ver Factura" (ID: ${facturaId})`);
    } else {
        // Presupuesto no facturado - mostrar "Facturar"
        btn.textContent = "ðŸ’³ Facturar";
        btn.className = "btn btn-primary";
        btn.onclick = () => manejarFacturacion();
        console.log('[FACTURAR] âœ… BotÃ³n configurado como "Facturar"');
    }
}

/**
 * Manejar proceso de facturaciÃ³n
 */
async function manejarFacturacion() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get("id");

    if (!id) {
        alert("âš ï¸ No se encontrÃ³ el ID de presupuesto.");
        return;
    }

    const btn = document.getElementById("btn-facturar");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "â³ Facturando...";

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

        console.log('[FACTURAR] âœ… FacturaciÃ³n exitosa:', data);
        alert("âœ… Presupuesto facturado correctamente.");

        // IMPORTANTE: Actualizar botÃ³n con el factura_id recibido
        if (data.factura_id) {
            actualizarBotonFacturacion(true, data.factura_id);
        } else {
            // Fallback: recargar pÃ¡gina completa para obtener factura_id actualizado
            console.log('[FACTURAR] âš ï¸ factura_id no recibido, recargando pÃ¡gina...');
            window.location.reload();
        }

    } catch (e) {
        console.error('[FACTURAR] âŒ Error al facturar:', e);
        alert("âŒ Error al facturar: " + (e?.message || e));

        // Restaurar botÃ³n en caso de error
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


/**
 * Activar Modo Retiro en Edición (Cambios Visuales)
 */
function activarModoRetiroEdicion() {
    window.MODO_RETIRO = true;
    console.log('📦 [EDIT] Aplicando overrides visuales para Modo Retiro...');

    // 1. Título de la página
    document.title = 'Editar Orden de Retiro';
    const header = document.querySelector('header h1');
    if (header) header.textContent = '📦 Editar Orden de Retiro';

    // 2. Título de la sección de artículos
    const allH3 = document.querySelectorAll('h3');
    allH3.forEach(h => {
        if (h.textContent.includes('Artículos')) {
            h.textContent = '📦 Artículos de la Orden de Retiro';
        }
    });

    // 3. Título de la tabla
    const tableHeader = document.querySelector('table thead th:first-child');
    if (tableHeader) {
        tableHeader.textContent = 'Artículos de la orden de retiro';
    }

    // 4. Botón de Guardar
    const btnGuardar = document.getElementById('btn-guardar') || document.querySelector('button[type="submit"]');
    if (btnGuardar) {
        btnGuardar.textContent = 'Confirmar Orden de Retiro';
        btnGuardar.classList.remove('btn-primary');
        btnGuardar.classList.add('btn-warning');
        btnGuardar.style.backgroundColor = '#f39c12';
        btnGuardar.style.color = '#fff';
    }

    // 5. Mostrar Opciones Inversas (Paridad con Creación)
    const opcionesRetiro = document.getElementById('contenedor-opciones-retiro');
    if (opcionesRetiro) {
        opcionesRetiro.style.display = 'block';
    }
}

/**
 * Configurar Listeners UI para las Opciones de Retiro
 */
function setupRetirosUI() {
    const origenFacturacionSel = document.getElementById('origen_facturacion');
    const origenFacturaDetalle = document.getElementById('origen-factura-detalle');
    const origenPuntoVenta = document.getElementById('origen_punto_venta');
    const origenNroFactura = document.getElementById('origen_numero_factura');

    if (origenFacturacionSel) {
        origenFacturacionSel.addEventListener('change', function () {
            if (this.value === 'LOMASOFT' || this.value === 'LAMDA') {
                origenFacturaDetalle.style.display = 'flex';
                origenPuntoVenta.required = true;
                origenNroFactura.required = true;
                
                origenPuntoVenta.readOnly = false;
                origenPuntoVenta.style.backgroundColor = '#fff';
                origenPuntoVenta.style.cursor = 'text';
                
                origenNroFactura.readOnly = false;
                origenNroFactura.style.backgroundColor = '#fff';
                origenNroFactura.style.cursor = 'text';
            } else {
                // Ocultar Opciones PENDIENTE
                origenPuntoVenta.required = false;
                origenNroFactura.required = false;
                origenPuntoVenta.value = '';
                origenNroFactura.value = '';
                origenPuntoVenta.readOnly = true;
                origenPuntoVenta.style.backgroundColor = '#ecf0f1';
                origenNroFactura.readOnly = true;
                origenNroFactura.style.backgroundColor = '#ecf0f1';
                // Dejamos el contenedor visible para que sepan que existe, solo de solo-lectura
            }
        });
        
        // Trigger inicial
        origenFacturacionSel.dispatchEvent(new Event('change'));
    }

    // --- MANEJO EXCLUSIÓN MUTUA TIPO RETIRO ---
    const radioAdmin = document.getElementById('chk_tramite_administrativo_mock');
    const radioFisico = document.querySelector('input[name="tipo_operacion_retiro"][value="fisico"]');
    const chkOcultoAdmin = document.getElementById('chk_tramite_administrativo');
    const subopcionesLogistica = document.getElementById('subopciones-logistica');

    function syncRetiroLogic() {
        if (!radioAdmin || !radioFisico || !chkOcultoAdmin || !subopcionesLogistica) return;

        if (radioAdmin.checked) {
            // Administrativo
            chkOcultoAdmin.checked = true;
            subopcionesLogistica.style.opacity = "0.5";
            subopcionesLogistica.style.pointerEvents = "none";
            document.querySelectorAll('.subopcion-retiro').forEach(rb => {
                rb.required = false;
                rb.checked = false;
            });
            document.getElementById('estado').value = 'Administrativa NC';
        } else {
            // Físico
            chkOcultoAdmin.checked = false;
            subopcionesLogistica.style.opacity = "1";
            subopcionesLogistica.style.pointerEvents = "auto";
            const currentSub = document.querySelector('.subopcion-retiro:checked');
            if(!currentSub) {
                const chofer = document.getElementById('metodo_chofer');
                if(chofer) chofer.checked = true;
            }
            document.getElementById('estado').value = 'Orden de Retiro';
        }
    }

    if (radioAdmin) radioAdmin.addEventListener('change', syncRetiroLogic);
    if (radioFisico) radioFisico.addEventListener('change', syncRetiroLogic);
}

// Exponer globalmente
window.activarModoRetiroEdicion = activarModoRetiroEdicion;

// Configurar botón al cargar página
document.addEventListener("DOMContentLoaded", () => {
    // El botón se configurará automáticamente al cargar el presupuesto
    console.log('[FACTURAR] Inicialización del botón de facturación lista');
    
    // Configurar UI de retiro inmediatamente
    if (typeof setupRetirosUI === 'function') {
        setupRetirosUI();
    }
});

