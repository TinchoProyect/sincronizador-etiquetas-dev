/**
 * Lógica Frontend - Cuenta Corriente de Clientes Búnker
 * Controla la visualización del saldo consolidado, historial de movimientos,
 * apertura de nuevas cuentas y registro de cobros/ajustes mediante SweetAlert2.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Obtener parámetros de la URL
    const urlParams = new URLSearchParams(window.location.search);
    const codigoBunkerCliente = urlParams.get('cliente');

    if (!codigoBunkerCliente) {
        Swal.fire({
            icon: 'error',
            title: 'Cliente no especificado',
            text: 'Falta el identificador de cliente en la URL.',
            confirmButtonText: 'Volver a Clientes',
            confirmButtonColor: '#6b21a8'
        }).then(() => {
            window.location.href = 'listado-clientes.html';
        });
        return;
    }

    console.log(`🔌 [CC-FRONT] Inicializando Cuenta Corriente para cliente: ${codigoBunkerCliente}`);

    // Elementos del DOM
    const lblClienteNombre = document.getElementById('lbl-cliente-nombre');
    const lblRazonSocial = document.getElementById('lbl-razon-social');
    const lblCuit = document.getElementById('lbl-cuit');
    const lblCodigoBunker = document.getElementById('lbl-codigo-bunker');
    const comboCuentas = document.getElementById('combo-cuentas');
    const cuerpoTablaMovimientos = document.getElementById('cuerpo-tabla-movimientos');
    
    // Tarjeta de saldo
    const ccBalanceCard = document.getElementById('cc-balance-card');
    const ccBalanceTitle = document.getElementById('cc-balance-title');
    const ccBalanceValue = document.getElementById('cc-balance-value');
    const ccBalanceBadge = document.getElementById('cc-balance-badge');

    // Botones
    const btnNuevaCuenta = document.getElementById('btn-nueva-cuenta');
    const btnRegistrarPago = document.getElementById('btn-registrar-pago');
    const btnRegistrarAjuste = document.getElementById('btn-registrar-ajuste');
    const btnPrevisualizarReporte = document.getElementById('btn-previsualizar-reporte');
    const btnAjusteAutomatico = document.getElementById('btn-ajuste-automatico');


    // Variables de estado local
    let cuentasDelCliente = [];
    let cuentaSeleccionada = null;
    let umbralAjusteMinimo = 50.00;


    // --- CARGAR DATOS GENERALES DEL CLIENTE Y SUS CUENTAS ---
    async function inicializar() {
        try {
            const url = `/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunkerCliente)}`;
            const response = await fetch(url);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error al obtener cuentas corrientes.');
            }

            // Pintar cabecera de filiación del cliente
            const cliente = data.cliente;
            lblClienteNombre.textContent = cliente.cliente_nombre || 'Sin nombre';
            lblRazonSocial.textContent = cliente.razon_social || 'Sin razón social';
            
            // Formatear CUIT con guiones para mejor visualización
            let cuitRaw = cliente.cuit_cuil || '';
            let cuitFormateado = cuitRaw;
            if (cuitRaw.length === 11) {
                cuitFormateado = `${cuitRaw.substring(0, 2)}-${cuitRaw.substring(2, 10)}-${cuitRaw.substring(10)}`;
            }
            lblCuit.textContent = cuitFormateado || 'No declarado ⚠️';
            lblCodigoBunker.textContent = cliente.codigo_bunker_cliente || 'N/A';

            // Cargar combo de cuentas
            cuentasDelCliente = data.data;
            umbralAjusteMinimo = parseFloat(data.umbral_ajuste_minimo) || 50.00;
            actualizarComboCuentas();


        } catch (error) {
            console.error('❌ [CC-FRONT] Error de inicialización:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: error.message || 'No se pudieron recuperar los datos del cliente.',
                confirmButtonColor: '#6b21a8'
            });
        }
    }

    function actualizarComboCuentas(seleccionarUltimo = false) {
        comboCuentas.innerHTML = '';

        if (!cuentasDelCliente || cuentasDelCliente.length === 0) {
            comboCuentas.innerHTML = '<option value="">No hay cuentas abiertas</option>';
            return;
        }

        cuentasDelCliente.forEach(cc => {
            const option = document.createElement('option');
            option.value = cc.id;
            option.textContent = `${cc.nombre_cuenta} (${cc.moneda})`;
            comboCuentas.appendChild(option);
        });

        // Seleccionar cuenta (por defecto la primera, o la última creada si se solicita)
        const selectIndex = seleccionarUltimo ? cuentasDelCliente.length - 1 : 0;
        comboCuentas.selectedIndex = selectIndex;
        
        cargarDetalleCuenta(cuentasDelCliente[selectIndex].id);
    }

    // --- CARGAR MOVIMIENTOS Y SALDO DE UNA CUENTA SELECCIONADA ---
    async function cargarDetalleCuenta(cuentaId) {
        try {
            cuentaSeleccionada = cuentasDelCliente.find(c => c.id == cuentaId);
            if (!cuentaSeleccionada) return;

            console.log(`🔌 [CC-FRONT] Cargando movimientos de cuenta corriente ID: ${cuentaId}`);
            
            // Actualizar Saldo consolidado en la tarjeta
            const saldo = parseFloat(cuentaSeleccionada.saldo);
            ccBalanceTitle.textContent = `Estado de Cuenta: ${cuentaSeleccionada.nombre_cuenta}`;
            ccBalanceValue.textContent = formatCurrency(saldo);

            // Ajustar visual basado en saldo deudor
            if (saldo > 0) {
                ccBalanceCard.className = 'balance-hero-card in-debt';
                ccBalanceBadge.className = 'balance-badge';
                ccBalanceBadge.style.backgroundColor = 'var(--danger-color)';
                ccBalanceBadge.textContent = 'Posee saldo deudor ⚠️';
            } else if (saldo < 0) {
                // Saldo a favor del cliente
                ccBalanceCard.className = 'balance-hero-card clean';
                ccBalanceBadge.className = 'balance-badge';
                ccBalanceBadge.style.backgroundColor = 'var(--success-color)';
                ccBalanceBadge.textContent = 'Saldo a favor del cliente 💰';
            } else {
                ccBalanceCard.className = 'balance-hero-card clean';
                ccBalanceBadge.className = 'balance-badge';
                ccBalanceBadge.style.backgroundColor = 'var(--success-color)';
                ccBalanceBadge.textContent = 'Al día / Sin deuda ✅';
            }

            // Mostrar u ocultar botón de ajuste automático si el saldo está dentro del umbral
            const absSaldo = Math.abs(saldo);
            if (absSaldo > 0 && absSaldo <= umbralAjusteMinimo) {
                btnAjusteAutomatico.style.display = 'inline-flex';
                btnAjusteAutomatico.textContent = `⚡ Ajustar Saldo Mínimo (${saldo > 0 ? '-' : '+'}${formatCurrency(absSaldo)})`;
            } else {
                btnAjusteAutomatico.style.display = 'none';
            }


            // Cargar movimientos desde la API
            cuerpoTablaMovimientos.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">
                        ⏳ Cargando movimientos...
                    </td>
                </tr>
            `;

            const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/movimientos`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error al obtener movimientos.');
            }

            renderizarMovimientos(data.data);

            // Cargar presupuestos Puesto 007 pendientes
            cargarPresupuestosPendientes007(cuentaId);

        } catch (error) {
            console.error('❌ [CC-FRONT] Error al cargar detalle de cuenta:', error);
            cuerpoTablaMovimientos.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: #dc2626; font-weight: bold; padding: 20px;">
                        ⚠️ Error de conexión: ${error.message}
                    </td>
                </tr>
            `;
        }
    }

    function renderizarMovimientos(movimientos) {
        if (!movimientos || movimientos.length === 0) {
            cuerpoTablaMovimientos.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            📭 No hay movimientos registrados en esta cuenta corriente.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        cuerpoTablaMovimientos.innerHTML = '';
        movimientos.forEach(mov => {
            const tr = document.createElement('tr');
            
            // Formatear Fecha
            const fecha = new Date(mov.fecha_movimiento);
            const fechaStr = fecha.toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Determinar débitos / créditos
            const esDebito = mov.tipo_movimiento === 'DEBITO';
            const monto = parseFloat(mov.monto);
            const debitoStr = esDebito ? formatCurrency(monto) : '-';
            const creditoStr = !esDebito ? formatCurrency(monto) : '-';

            // Crear Badge del Comprobante
            let badgeComprobante = '<span class="badge-comp">Manual 📝</span>';
            if (mov.comprobante_id && (mov.tipo_comprobante === 'FACTURA' || mov.tipo_comprobante === 'FACTURA_A' || mov.tipo_comprobante === 'FACTURA_B')) {
                // Tiene factura asociada oficial (AFIP)
                const factId = mov.comprobante_id;
                const factUrl = `http://localhost:3004/pages/ver-factura.html?id=${factId}`;
                badgeComprobante = `<a href="${factUrl}" target="_blank" class="badge-comp has-link" title="Ver comprobante oficial de AFIP / LAMDA">🔍 Ver Comp.</a>`;
            } else if (!mov.comprobante_id && mov.tipo_comprobante === 'FACTURA') {
                // Factura Puesto 007 manual / presupuesto incorporado
                badgeComprobante = '<span class="badge-comp" style="background-color: #e0f2fe; color: #0369a1; border-color: #7dd3fc;">Puesto 007 📄</span>';
            } else if (mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') {
                badgeComprobante = '<span class="badge-comp" style="background-color: #fef3c7; color: #d97706; border-color: #fcd34d;">Auto ⚡</span>';
            }


            let descText = mov.descripcion || 'Sin concepto';
            if (mov.tipo_comprobante === 'RECIBO_PAGO') {
                if (mov.metadatos) {
                    try {
                        const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                        if (meta && meta.tipo_pago) {
                            if (meta.tipo_pago === 'Efectivo') {
                                descText = 'Rec/Pago - Efectivo';
                            } else if (meta.tipo_pago === 'Transferencia') {
                                descText = `Rec/Pago - Transferencia (${meta.banco_origen || ''} - Ref: ${meta.nro_operacion || ''})`;
                            } else if (meta.tipo_pago === 'Cheque') {
                                let fechaVtoFmt = '';
                                if (meta.fecha_vencimiento) {
                                    const parts = meta.fecha_vencimiento.split('-');
                                    if (parts.length === 3) {
                                        fechaVtoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
                                    } else {
                                        fechaVtoFmt = meta.fecha_vencimiento;
                                    }
                                }
                                descText = `Rec/Pago - Cheque (Nro: ${meta.nro_cheque || ''} - Banco: ${meta.banco_emisor || ''} - Vto: ${fechaVtoFmt})`;
                            }
                            
                            if (mov.descripcion && mov.descripcion.trim()) {
                                descText += ` [Nota: ${mov.descripcion.trim()}]`;
                            }
                        }
                    } catch (e) {
                        console.error('Error al parsear metadatos en renderizado:', e);
                        descText = 'Rec/Pago - Recibo';
                    }
                } else {
                    descText = 'Rec/Pago - Recibo';
                }
            } else {
                descText = descText.replace(/^Factura Puesto 007 - Nro\s+/, 'Fac ');
                descText = descText.replace(/^Cobro Banc?[ao]rio?\s+/, 'Bco ');
            }

            tr.innerHTML = `
                <td style="color: #475569; font-size: 0.9em;">${fechaStr}</td>
                <td style="font-weight: 600;">${descText}</td>
                <td>${badgeComprobante}</td>
                <td style="text-align: right;" class="monto-debito">${esDebito ? `+${debitoStr}` : '-'}</td>
                <td style="text-align: right;" class="monto-credito">${!esDebito ? `-${creditoStr}` : '-'}</td>
                <td style="text-align: right;" class="saldo-resultante">${formatCurrency(parseFloat(mov.saldo_resultante))}</td>
                <td style="text-align: center;">
                    <button class="btn-premium btn-red btn-eliminar-mov" data-id="${mov.id}" style="padding: 4px 8px; font-size: 0.8em; margin: 0; background-color: #dc2626; box-shadow: none; border: none; border-radius: 4px; color: white;">
                        🗑️
                    </button>
                </td>
            `;
            cuerpoTablaMovimientos.appendChild(tr);
        });

        // Vincular eventos de eliminación
        const botonesEliminar = cuerpoTablaMovimientos.querySelectorAll('.btn-eliminar-mov');
        botonesEliminar.forEach(btn => {
            btn.addEventListener('click', () => {
                const movId = btn.getAttribute('data-id');
                confirmarEliminarMovimiento(movId);
            });
        });
    }

    // Escuchar cambios de selección en el selector de cuentas
    comboCuentas.addEventListener('change', (e) => {
        if (e.target.value) {
            cargarDetalleCuenta(e.target.value);
        }
    });

    // --- ACCIÓN: ABRIR OTRA CUENTA CORRIENTE ---
    btnNuevaCuenta.addEventListener('click', () => {
        Swal.fire({
            title: 'Abrir Nueva Cuenta Corriente',
            text: 'Escriba un nombre descriptivo para identificar esta cuenta (ej: "Cuenta Sucursal Norte", "Cuenta Logística"):',
            input: 'text',
            inputPlaceholder: 'Ej: Cuenta Logística Especial',
            showCancelButton: true,
            confirmButtonText: 'Abrir Cuenta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#6b21a8',
            cancelButtonColor: '#64748b',
            inputValidator: (value) => {
                if (!value || !value.trim()) {
                    return 'El nombre de la cuenta es obligatorio.';
                }
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const response = await fetch('/api/logistica/bunker/cuentas-corrientes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            codigo_bunker_cliente: codigoBunkerCliente,
                            nombre_cuenta: result.value.trim()
                        })
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'No se pudo crear la cuenta.');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Apertura Exitosa',
                        text: data.message,
                        timer: 2000,
                        showConfirmButton: false
                    });

                    // Recargar inicialización para actualizar listas
                    await inicializarCuentasYSeleccionarUltima();

                } catch (error) {
                    console.error('❌ [CC-FRONT] Error al crear cuenta:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error de Apertura',
                        text: error.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    });

    async function inicializarCuentasYSeleccionarUltima() {
        const url = `/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunkerCliente)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success) {
            cuentasDelCliente = data.data;
            actualizarComboCuentas(true); // Selecciona la última cuenta recién creada
        }
    }

    // --- ACCIÓN: REGISTRAR COBRO / PAGO (CRÉDITO) ---
    btnRegistrarPago.addEventListener('click', () => {
        if (!cuentaSeleccionada) return;

        Swal.fire({
            title: '💵 Registrar Cobro / Pago Recibido',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Monto del Pago (ARS) <span style="color:red">*</span></label>
                        <input type="number" id="swal-monto" class="swal2-input" style="width: 85%; margin: 0; font-family: monospace; font-weight: 700;" placeholder="0.00" step="0.01" min="0.01">
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Tipo de Pago <span style="color:red">*</span></label>
                        <select id="swal-tipo-pago" class="swal2-select" style="width: 85%; margin: 0; box-sizing: border-box;">
                            <option value="Efectivo" selected>Efectivo</option>
                            <option value="Transferencia">Transferencia</option>
                            <option value="Cheque">Cheque</option>
                        </select>
                    </div>
                    
                    <!-- Campos condicionales para Transferencia -->
                    <div id="swal-campos-transferencia" style="display: none; border-left: 3px solid var(--primary-color, #8e4785); padding-left: 10px; margin-bottom: 12px;">
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px;">Banco Origen <span style="color:red">*</span></label>
                            <input type="text" id="swal-bco-origen" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: Banco Galicia">
                        </div>
                        <div style="margin-bottom: 4px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px;">Número de Referencia / Operación <span style="color:red">*</span></label>
                            <input type="text" id="swal-nro-operacion" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: 98124">
                        </div>
                    </div>
                    
                    <!-- Campos condicionales para Cheque -->
                    <div id="swal-campos-cheque" style="display: none; border-left: 3px solid var(--primary-color, #8e4785); padding-left: 10px; margin-bottom: 12px;">
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px;">Número de Cheque <span style="color:red">*</span></label>
                            <input type="text" id="swal-nro-cheque" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: 104829">
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px;">Banco Emisor <span style="color:red">*</span></label>
                            <input type="text" id="swal-bco-emisor" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: Banco Nación">
                        </div>
                        <div style="margin-bottom: 4px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px;">Fecha de Vencimiento / Cobro <span style="color:red">*</span></label>
                            <input type="date" id="swal-fecha-vto" class="swal2-input" style="width: 85%; margin: 0;">
                        </div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Concepto / Descripción <span style="color:gray">(Opcional)</span></label>
                        <input type="text" id="swal-desc" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: Nota interna o comentario de mostrador">
                    </div>
                    <div>
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Fecha de Transacción</label>
                        <input type="datetime-local" id="swal-fecha" class="swal2-input" style="width: 85%; margin: 0;">
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Registrar Cobro',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--success-color)',
            cancelButtonColor: '#64748b',
            didOpen: () => {
                // Setear fecha actual por defecto
                const tzoffset = (new Date()).getTimezoneOffset() * 60000; 
                const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
                document.getElementById('swal-fecha').value = localISOTime;

                // Alternar campos condicionales
                const selectTipo = document.getElementById('swal-tipo-pago');
                const divTransf = document.getElementById('swal-campos-transferencia');
                const divCheque = document.getElementById('swal-campos-cheque');

                selectTipo.addEventListener('change', () => {
                    const val = selectTipo.value;
                    if (val === 'Transferencia') {
                        divTransf.style.display = 'block';
                        divCheque.style.display = 'none';
                    } else if (val === 'Cheque') {
                        divTransf.style.display = 'none';
                        divCheque.style.display = 'block';
                    } else {
                        divTransf.style.display = 'none';
                        divCheque.style.display = 'none';
                    }
                });
            },
            preConfirm: () => {
                const monto = document.getElementById('swal-monto').value;
                const tipoPago = document.getElementById('swal-tipo-pago').value;
                const descripcion = document.getElementById('swal-desc').value;
                const fecha = document.getElementById('swal-fecha').value;

                if (!monto || parseFloat(monto) <= 0) {
                    Swal.showValidationMessage('Por favor, ingrese un monto válido mayor que cero.');
                    return false;
                }

                // Armar metadatos
                const metadatos = { tipo_pago: tipoPago };

                if (tipoPago === 'Transferencia') {
                    const bancoOrigen = document.getElementById('swal-bco-origen').value.trim();
                    const nroOperacion = document.getElementById('swal-nro-operacion').value.trim();

                    if (!bancoOrigen) {
                        Swal.showValidationMessage('El Banco Origen es obligatorio para transferencias.');
                        return false;
                    }
                    if (!nroOperacion) {
                        Swal.showValidationMessage('El Número de Referencia / Operación es obligatorio.');
                        return false;
                    }
                    metadatos.banco_origen = bancoOrigen;
                    metadatos.nro_operacion = nroOperacion;
                } else if (tipoPago === 'Cheque') {
                    const nroCheque = document.getElementById('swal-nro-cheque').value.trim();
                    const bancoEmisor = document.getElementById('swal-bco-emisor').value.trim();
                    const fechaVto = document.getElementById('swal-fecha-vto').value;

                    if (!nroCheque) {
                        Swal.showValidationMessage('El Número de Cheque es obligatorio.');
                        return false;
                    }
                    if (!bancoEmisor) {
                        Swal.showValidationMessage('El Banco Emisor es obligatorio.');
                        return false;
                    }
                    if (!fechaVto) {
                        Swal.showValidationMessage('La Fecha de Vencimiento es obligatoria.');
                        return false;
                    }

                    // Validación de coherencia de fecha de vencimiento (Alerta B)
                    const vtoParts = fechaVto.split('-');
                    if (vtoParts.length !== 3) {
                        Swal.showValidationMessage('Por favor, ingrese una fecha de vencimiento válida.');
                        return false;
                    }
                    const y = parseInt(vtoParts[0]);
                    const m = parseInt(vtoParts[1]) - 1;
                    const d = parseInt(vtoParts[2]);
                    const dVto = new Date(y, m, d);
                    
                    if (isNaN(dVto.getTime())) {
                        Swal.showValidationMessage('La fecha de vencimiento es inválida.');
                        return false;
                    }

                    const minDate = new Date();
                    minDate.setFullYear(minDate.getFullYear() - 1);
                    const maxDate = new Date();
                    maxDate.setFullYear(maxDate.getFullYear() + 10);

                    if (dVto < minDate || dVto > maxDate) {
                        Swal.showValidationMessage('La fecha de vencimiento del cheque no es coherente (rango permitido: de hace 1 año a 10 años en el futuro).');
                        return false;
                    }

                    metadatos.nro_cheque = nroCheque;
                    metadatos.banco_emisor = bancoEmisor;
                    metadatos.fecha_vencimiento = fechaVto;
                }

                return { monto, descripcion, fecha, metadatos };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const payload = {
                        tipo_movimiento: 'CREDITO', // El cobro reduce la deuda (Crédito)
                        monto: result.value.monto,
                        descripcion: result.value.descripcion.trim(),
                        tipo_comprobante: 'RECIBO_PAGO',
                        fecha_movimiento: result.value.fecha || new Date(),
                        metadatos: result.value.metadatos
                    };

                    const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/movimientos`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Error al guardar el pago.');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Pago Registrado',
                        text: 'El cobro ha sido guardado exitosamente y el saldo fue conciliado.',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    // Recargar datos
                    recargarDatosDeCuentaActiva();

                } catch (error) {
                    console.error('❌ [CC-FRONT] Error al registrar pago:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error de Cobro',
                        text: error.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    });

    // --- ACCIÓN: REGISTRAR AJUSTE MANUAL (DÉBITO / CRÉDITO) ---
    btnRegistrarAjuste.addEventListener('click', () => {
        if (!cuentaSeleccionada) return;

        Swal.fire({
            title: '⚙️ Registrar Ajuste Manual',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Tipo de Ajuste <span style="color:red">*</span></label>
                        <select id="swal-tipo-ajuste" class="swal2-select" style="width: 90%; margin: 0; padding: 10px; font-size: 1em;">
                            <option value="DEBITO">Débito (+) — Aumenta la deuda</option>
                            <option value="CREDITO">Crédito (-) — Reduce la deuda / Bonificación</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Monto del Ajuste (ARS) <span style="color:red">*</span></label>
                        <input type="number" id="swal-monto" class="swal2-input" style="width: 85%; margin: 0; font-family: monospace; font-weight: 700;" placeholder="0.00" step="0.01" min="0.01">
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Concepto / Detalle <span style="color:red">*</span></label>
                        <input type="text" id="swal-desc" class="swal2-input" style="width: 85%; margin: 0;" placeholder="Ej: Ajuste por redondeo centavos o bonificación">
                    </div>
                    <div>
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Fecha del Ajuste</label>
                        <input type="datetime-local" id="swal-fecha" class="swal2-input" style="width: 85%; margin: 0;">
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Registrar Ajuste',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--purple-primary)',
            cancelButtonColor: '#64748b',
            didOpen: () => {
                const tzoffset = (new Date()).getTimezoneOffset() * 60000; 
                const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
                document.getElementById('swal-fecha').value = localISOTime;
            },
            preConfirm: () => {
                const tipo_movimiento = document.getElementById('swal-tipo-ajuste').value;
                const monto = document.getElementById('swal-monto').value;
                const descripcion = document.getElementById('swal-desc').value;
                const fecha = document.getElementById('swal-fecha').value;

                if (!monto || parseFloat(monto) <= 0) {
                    Swal.showValidationMessage('Por favor, ingrese un monto válido mayor que cero.');
                    return false;
                }
                if (!descripcion || !descripcion.trim()) {
                    Swal.showValidationMessage('El concepto de ajuste es obligatorio.');
                    return false;
                }

                return { tipo_movimiento, monto, descripcion, fecha };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const payload = {
                        tipo_movimiento: result.value.tipo_movimiento,
                        monto: result.value.monto,
                        descripcion: result.value.descripcion.trim(),
                        tipo_comprobante: 'AJUSTE_MANUAL',
                        fecha_movimiento: result.value.fecha || new Date()
                    };

                    const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/movimientos`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Error al guardar el ajuste.');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Ajuste Procesado',
                        text: 'El ajuste manual se ha impactado en la cuenta corriente.',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    // Recargar datos
                    recargarDatosDeCuentaActiva();

                } catch (error) {
                    console.error('❌ [CC-FRONT] Error al registrar ajuste:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error de Ajuste',
                        text: error.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    });

    async function recargarDatosDeCuentaActiva() {
        if (!cuentaSeleccionada) return;
        
        // Recargar datos de cuentas del cliente para obtener el nuevo saldo cabecera
        const url = `/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunkerCliente)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            cuentasDelCliente = data.data;
            const updatedAcc = cuentasDelCliente.find(c => c.id == cuentaSeleccionada.id);
            if (updatedAcc) {
                cuentaSeleccionada = updatedAcc;
            }
            // Recargar movimientos y pintar saldo
            cargarDetalleCuenta(cuentaSeleccionada.id);
        }
    }

    // --- UTILERÍA: FORMATEAR MONEDA ---
    function formatCurrency(value) {
        return new Intl.NumberFormat('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: 2
        }).format(value);
    }

    // --- ACCIÓN: PREVISUALIZAR E IMPRIMIR/EXPORTAR REPORTE ---
    function abrirPrevisualizador(detalladoInicial = false) {
        if (!cuentaSeleccionada) {
            Swal.fire({
                icon: 'warning',
                title: 'Seleccione una cuenta',
                text: 'Debe seleccionar una cuenta corriente activa para previsualizar el informe.',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        let esDetallado = detalladoInicial;
        const queryParam = esDetallado ? '?detallado=true' : '';
        const reporteUrl = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf${queryParam}#view=FitH`;

        Swal.fire({
            title: `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box; padding-right: 10px;">
                    <span id="swal-preview-title" style="font-weight: 700; font-size: 0.85em; color: var(--purple-primary);">Previsualización de Informe${esDetallado ? ' Detallado' : ''}</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.55em; font-weight: 600; color: #475569; cursor: pointer; user-select: none; margin-right: 8px;">
                            <input type="checkbox" id="swal-chk-detallado" ${esDetallado ? 'checked' : ''} style="cursor: pointer; width: 13px; height: 13px; accent-color: var(--purple-primary);">
                            Detallado
                        </label>
                        <button id="swal-btn-whatsapp" class="btn-premium btn-green" style="padding: 6px 12px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                            💬 WhatsApp
                        </button>
                        <button id="swal-btn-download" class="btn-premium btn-blue" style="padding: 6px 12px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                            📥 Descargar
                        </button>
                        <button id="swal-btn-maximize" class="btn-premium btn-gray" style="padding: 6px 12px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--slate-border); border-radius: 4px; cursor: pointer; font-weight: 600;">
                            🖵 Maximizar
                        </button>
                        <button id="swal-btn-close" class="btn-premium btn-red" style="padding: 6px 12px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
                            ❌ Cerrar
                        </button>
                    </div>
                </div>
            `,
            html: `
                <div id="swal-iframe-container" style="width: 100%; height: 500px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #f8fafc; transition: all 0.2s ease;">
                    <iframe id="swal-iframe" src="${reporteUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
                </div>
            `,
            width: '900px',
            showConfirmButton: false,
            showDenyButton: false,
            showCancelButton: false,
            customClass: {
                popup: 'swal-preview-popup',
                htmlContainer: 'swal-pdf-container'
            },
            didOpen: () => {
                const btnMaximize = document.getElementById('swal-btn-maximize');
                const btnWhatsapp = document.getElementById('swal-btn-whatsapp');
                const btnDownload = document.getElementById('swal-btn-download');
                const btnClose = document.getElementById('swal-btn-close');
                const chkDetallado = document.getElementById('swal-chk-detallado');
                const titleSpan = document.getElementById('swal-preview-title');
                const iframe = document.getElementById('swal-iframe');
                const container = document.getElementById('swal-iframe-container');
                const popup = Swal.getPopup();
                const swalContainer = Swal.getContainer();
                
                let isMaximized = false;
                
                btnMaximize.addEventListener('click', () => {
                    isMaximized = !isMaximized;
                    if (isMaximized) {
                        popup.classList.add('swal-fullscreen-popup');
                        if (swalContainer) swalContainer.classList.add('swal-fullscreen-container');
                        container.style.height = ''; // Let CSS Flexbox rule handle it dynamically
                        btnMaximize.innerHTML = '🗗 Restaurar';
                    } else {
                        popup.classList.remove('swal-fullscreen-popup');
                        if (swalContainer) swalContainer.classList.remove('swal-fullscreen-container');
                        container.style.height = '500px';
                        btnMaximize.innerHTML = '🖵 Maximizar';
                    }
                });

                chkDetallado.addEventListener('change', () => {
                    esDetallado = chkDetallado.checked;
                    titleSpan.textContent = `Previsualización de Informe${esDetallado ? ' Detallado' : ''}`;
                    const nextParam = esDetallado ? '?detallado=true' : '';
                    iframe.src = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf${nextParam}#view=FitH`;
                });

                btnWhatsapp.addEventListener('click', () => {
                    enviarReportePorWhatsApp(esDetallado);
                });

                btnDownload.addEventListener('click', () => {
                    descargarReportePdf(esDetallado);
                });

                btnClose.addEventListener('click', () => {
                    Swal.close();
                });
            }
        });
    }

    btnPrevisualizarReporte.addEventListener('click', () => {
        abrirPrevisualizador(false);
    });

    async function enviarReportePorWhatsApp(detallado = false) {
        if (!cuentaSeleccionada) return;

        Swal.fire({
            title: 'Enviando por WhatsApp...',
            text: 'Por favor, espere mientras se despacha el reporte.',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const queryParam = detallado ? '?detallado=true' : '';
            const url = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp${queryParam}`;
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || data.error || 'Error desconocido.');
            }

            Swal.fire({
                icon: 'success',
                title: 'Envío Exitoso',
                text: 'El reporte de cuenta corriente se ha enviado por WhatsApp correctamente.',
                confirmButtonColor: '#6b21a8'
            });

        } catch (error) {
            console.error('❌ [CC-FRONT] Error al enviar WhatsApp:', error);
            Swal.fire({
                icon: 'error',
                title: 'Falla de Mensajería',
                text: error.message || 'No se pudo enviar el reporte por WhatsApp en este momento.',
                confirmButtonColor: '#6b21a8'
            });
        }
    }

    function descargarReportePdf(detallado = false) {
        if (!cuentaSeleccionada) return;
        const link = document.createElement('a');
        const queryParam = detallado ? '?detallado=true' : '';
        link.href = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf${queryParam}`;
        link.download = `cuenta_corriente_${codigoBunkerCliente}${detallado ? '_detallado' : ''}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // --- ACCIÓN: AJUSTE AUTOMÁTICO DE SALDO MÍNIMO ---
    btnAjusteAutomatico.addEventListener('click', () => {
        if (!cuentaSeleccionada) return;

        const saldo = parseFloat(cuentaSeleccionada.saldo);
        const absSaldo = Math.abs(saldo);
        const accion = saldo > 0 ? 'crédito (bonificación)' : 'débito (cargo)';

        Swal.fire({
            title: '¿Confirmar Ajuste Automático?',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    Se generará un movimiento de <strong>${accion}</strong> por un valor exacto de 
                    <strong style="color: var(--purple-primary);">${formatCurrency(absSaldo)}</strong> 
                    para neutralizar la cuenta y dejar el balance consolidado en exactamente <strong>$0,00</strong>.
                    <br><br>
                    El movimiento quedará registrado bajo el concepto de <strong>"Ajuste automático por saldo mínimo"</strong>.
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, Ajustar Cuenta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: 'var(--purple-primary)',
            cancelButtonColor: '#64748b'
        }).then(async (result) => {
            if (result.isConfirmed) {
                // Mostrar spinner
                Swal.fire({
                    title: 'Procesando Ajuste...',
                    text: 'Espere mientras se guarda la transacción y se recalcula el saldo.',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/ajuste-automatico`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            operador: 'Usuario de Desarrollo'
                        })
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Error al procesar el ajuste automático.');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Ajuste Completado',
                        text: 'El saldo remanente ha sido compensado y la cuenta se encuentra a cero.',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    // Recargar datos de la cuenta activa
                    await recargarDatosDeCuentaActiva();

                } catch (error) {
                    console.error('❌ [CC-FRONT] Error al realizar ajuste automático:', error);
                    Swal.fire({
                        icon: 'error',
                        title: 'Falla del Sistema',
                        text: error.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    });

    // --- NUEVO: COMPROBANTES PUESTO 007 ---
    const cardIncorporar007 = document.getElementById('card-incorporar-007');
    const comboPresupuestos007 = document.getElementById('combo-presupuestos-007');
    const btnIncorporar007 = document.getElementById('btn-incorporar-007');

    async function cargarPresupuestosPendientes007(cuentaId) {
        try {
            comboPresupuestos007.innerHTML = '<option value="">Cargando comprobantes disponibles...</option>';
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/presupuestos-pendientes`);
            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            const presupuestos = data.data;
            comboPresupuestos007.innerHTML = '';

            if (!presupuestos || presupuestos.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No hay comprobantes del Puesto 007 para incorporar';
                comboPresupuestos007.appendChild(opt);
                cardIncorporar007.style.display = 'none';
                return;
            }

            // Población del combo
            presupuestos.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                const fechaStr = new Date(p.fecha).toLocaleDateString('es-AR');
                opt.textContent = `${fechaStr} - Comp. ${p.comprobante_lomasoft} (Monto: ${formatCurrency(p.total)})`;
                comboPresupuestos007.appendChild(opt);
            });

            cardIncorporar007.style.display = 'block';

        } catch (err) {
            console.error('Error al cargar presupuestos del puesto 007:', err);
            comboPresupuestos007.innerHTML = '<option value="">Error al obtener comprobantes</option>';
            cardIncorporar007.style.display = 'none';
        }
    }

    btnIncorporar007.addEventListener('click', async () => {
        const presupuestoId = comboPresupuestos007.value;
        if (!presupuestoId) {
            Swal.fire({
                icon: 'warning',
                title: 'Seleccione un comprobante',
                text: 'Debe elegir un comprobante del listado para incorporarlo.',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        Swal.fire({
            title: 'Incorporando Comprobante...',
            text: 'Por favor, espere mientras se inyecta la factura y se recalcula el saldo.',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/incorporar-presupuesto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presupuesto_id: presupuestoId })
            });
            const data = await response.json();

            if (!data.success) throw new Error(data.error || 'No se pudo incorporar.');

            Swal.fire({
                icon: 'success',
                title: 'Incorporación Exitosa',
                text: 'El comprobante ha sido incorporado al historial comercial de la cuenta.',
                timer: 2000,
                showConfirmButton: false
            });

            // Recargar datos
            await recargarDatosDeCuentaActiva();

        } catch (err) {
            console.error('Error al incorporar presupuesto:', err);
            Swal.fire({
                icon: 'error',
                title: 'Falla del Sistema',
                text: err.message,
                confirmButtonColor: '#6b21a8'
            });
        }
    });

    // --- NUEVO: ELIMINACIÓN DE MOVIMIENTOS ---
    function confirmarEliminarMovimiento(movId) {
        Swal.fire({
            title: '¿Eliminar movimiento?',
            text: 'Esta acción purgará de forma permanente el movimiento y recalculará cronológicamente todos los saldos de la cuenta corriente. Esta acción es irreversible.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, Eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b'
        }).then(async (result) => {
            if (result.isConfirmed) {
                Swal.fire({
                    title: 'Eliminando y Recalculando...',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ motivo: 'Eliminación manual desde interfaz por el operador' })
                    });
                    const data = await response.json();

                    if (!data.success) throw new Error(data.error || 'No se pudo eliminar el movimiento.');

                    Swal.fire({
                        icon: 'success',
                        title: 'Movimiento Eliminado',
                        text: 'El movimiento ha sido purgado y el saldo se ha recalculado.',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    // Recargar datos
                    await recargarDatosDeCuentaActiva();

                } catch (err) {
                    console.error('Error al eliminar movimiento:', err);
                    Swal.fire({
                        icon: 'error',
                        title: 'Error de Eliminación',
                        text: err.message,
                        confirmButtonColor: '#6b21a8'
                    });
                }
            }
        });
    }

    // --- INICIALIZACIÓN ---
    inicializar();

});
