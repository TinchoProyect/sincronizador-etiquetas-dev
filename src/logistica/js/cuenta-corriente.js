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
    let cliente = null;


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
            cliente = data.cliente;
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
        window.currentMovimientos = movimientos;
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
            } else if (['RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE', 'AJUSTE_MANUAL'].includes(mov.tipo_comprobante)) {
                // Recibo de pago o ajuste manual - Abre modal interactivo de previsualización
                badgeComprobante = `<a href="javascript:void(0)" onclick="mostrarModalRecibo(${mov.id})" class="badge-comp has-link" title="Ver comprobante de pago oficial de LAMDA">🔍 Ver Comp.</a>`;
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
                        <button id="swal-btn-whatsapp" class="btn-premium btn-purple" style="padding: 6px 12px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);">
                            📤 Enviar
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

        // Recuperar y parsear contactos de WhatsApp
        let contacts = [];
        const rawWp = (cliente.whatsapp_facturas || '').trim();
        if (rawWp.startsWith('[')) {
            try {
                contacts = JSON.parse(rawWp);
            } catch(e) {}
        }
        if (!Array.isArray(contacts) || contacts.length === 0) {
            const rawPhone = rawWp || cliente.celular || cliente.telefono || '';
            contacts = rawPhone.split(',').map(num => ({
                numero: num.trim(),
                nombre: '',
                cargo: '',
                default_resumen: true
            })).filter(c => c.numero);
        }
        contacts = contacts.map(c => ({
            numero: c.numero ? c.numero.replace(/\D/g, '') : '',
            nombre: c.nombre || '',
            cargo: c.cargo || '',
            default_resumen: c.default_resumen === true || c.default === true
        })).filter(c => c.numero.length > 0);

        // Recuperar y parsear contactos de Email
        let emails = [];
        const rawEmail = (cliente.email_facturas || '').trim();
        if (rawEmail.startsWith('[')) {
            try {
                emails = JSON.parse(rawEmail);
            } catch(e) {}
        }
        if (!Array.isArray(emails) || emails.length === 0) {
            if (rawEmail) {
                emails = rawEmail.split(',').map(e => ({
                    email: e.trim(),
                    nombre: '',
                    cargo: '',
                    default_factura: true
                })).filter(e => e.email);
            }
        }
        emails = emails.map(e => ({
            email: e.email ? e.email.trim() : '',
            nombre: e.nombre || '',
            cargo: e.cargo || '',
            default_factura: e.default_factura !== false
        })).filter(e => e.email.length > 0);

        if (contacts.length === 0 && emails.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin contactos',
                text: 'El cliente no tiene números de WhatsApp ni direcciones de correo configuradas en su ficha.',
                confirmButtonColor: '#6b21a8'
            }).then(() => {
                abrirPrevisualizador(detallado);
            });
            return;
        }

        // Construir contenido HTML de selección
        let htmlContent = `
            <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                <p style="margin-bottom: 12px; font-size: 14px; color: #4b5563; font-weight: 500;">
                    Seleccione los destinatarios para enviar el reporte de cuenta corriente:
                </p>
        `;

        // Sección WhatsApp
        htmlContent += `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px;">
                    <span>📱 WhatsApp</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (contacts.length === 0) {
            htmlContent += `
                <div style="padding: 8px; font-size: 11px; color: #94a3b8; text-align: center;">
                    No hay contactos de WhatsApp cargados para este cliente.
                </div>
            `;
        } else {
            contacts.forEach((c, index) => {
                const isChecked = c.default_resumen === true;
                const formattedNum = c.numero.replace(/\D/g, '');
                let displayNum = c.numero;
                if (formattedNum.length === 10) {
                    displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
                } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                    displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
                } else if (formattedNum.length === 11 && formattedNum.startsWith('54')) {
                    displayNum = `+54 (${formattedNum.substring(2,5)}) ${formattedNum.substring(5,8)}-${formattedNum.substring(8,11)}`;
                }

                const labelText = c.nombre 
                    ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${c.cargo}</span>` : ''}`
                    : `Contacto #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-cc-contacto-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #10b981;">
                        <div style="flex: 1;">
                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="font-size: 11px; color: #6b7280;">📱 ${displayNum}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // Sección Email
        htmlContent += `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                    <span>📧 Correo Electrónico</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
        `;

        if (emails.length === 0) {
            htmlContent += `
                <div style="padding: 8px; font-size: 11px; color: #94a3b8; text-align: center;">
                    No hay contactos de correo cargados para este cliente.
                </div>
            `;
        } else {
            emails.forEach((e, index) => {
                const isChecked = e.default_factura === true;
                const labelText = e.nombre 
                    ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                    : `Contacto #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-cc-contacto-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #8b5cf6;">
                        <div style="flex: 1;">
                            <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="font-size: 11px; color: #6b7280; word-break: break-all;">📧 ${e.email}</div>
                        </div>
                    </label>
                `;
            });
        }

        htmlContent += `
                </div>
            </div>
        `;

        // Otro número u otro correo (opcional)
        htmlContent += `
            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro número (opcional):
                    </label>
                    <input type="text" id="swal-custom-phone" placeholder="Ej: 2216615746" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
                <div>
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">
                        Otro correo (opcional):
                    </label>
                    <input type="email" id="swal-custom-email" placeholder="Ej: admin@mail.com" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                </div>
            </div>
        `;

        if (cliente && cliente.id) {
            htmlContent += `
                <label style="display: flex; align-items: center; gap: 8px; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1; cursor: pointer; font-size: 12px; color: #475569;">
                    <input type="checkbox" id="swal-save-default" style="width: 16px; height: 16px; cursor: pointer;">
                    <span>Guardar selección como contactos predeterminados</span>
                </label>
            `;
        }

        htmlContent += `</div>`;

        const { value: modalResult } = await Swal.fire({
            title: 'Despacho de Reporte',
            html: htmlContent,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '📤 Enviar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7c3aed',
            cancelButtonColor: '#6b7280',
            preConfirm: () => {
                const selectedWps = Array.from(document.querySelectorAll('.swal-cc-contacto-wp-chk:checked')).map(el => el.value);
                const selectedEmails = Array.from(document.querySelectorAll('.swal-cc-contacto-email-chk:checked')).map(el => el.value);
                const customPhone = document.getElementById('swal-custom-phone').value.trim();
                const customEmail = document.getElementById('swal-custom-email').value.trim();
                const saveDefaultCheckbox = document.getElementById('swal-save-default');
                const saveDefault = saveDefaultCheckbox ? saveDefaultCheckbox.checked : false;

                if (customPhone) {
                    const cleaned = customPhone.replace(/[^\d,]/g, '');
                    if (cleaned) {
                        cleaned.split(',').forEach(num => {
                            if (num.trim()) selectedWps.push(num.trim());
                        });
                    }
                }
                if (customEmail) {
                    customEmail.split(',').forEach(em => {
                        if (em.trim() && em.includes('@')) selectedEmails.push(em.trim());
                    });
                }

                return {
                    whatsapp: selectedWps,
                    email: selectedEmails,
                    saveDefault: saveDefault
                };
            }
        });

        if (!modalResult) {
            abrirPrevisualizador(detallado);
            return;
        }

        // Guardar por defecto si se requiere
        if (modalResult.saveDefault && cliente && cliente.id) {
            try {
                const updatedWps = contacts.map(c => ({
                    ...c,
                    default_resumen: modalResult.whatsapp.includes(c.numero)
                }));
                const updatedEmails = emails.map(e => ({
                    ...e,
                    default_factura: modalResult.email.includes(e.email)
                }));

                cliente.whatsapp_facturas = JSON.stringify(updatedWps);
                cliente.email_facturas = JSON.stringify(updatedEmails);

                await fetch(`/api/logistica/bunker/clientes/${cliente.id}/whatsapp-contacts`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        whatsapp_facturas: cliente.whatsapp_facturas,
                        email_facturas: cliente.email_facturas
                    })
                });
                console.log('✅ [CC-FRONT] Contactos predeterminados actualizados.');
            } catch (err) {
                console.error('❌ [CC-FRONT] Error al guardar contactos predeterminados:', err);
            }
        }

        const sendWp = modalResult.whatsapp.length > 0;
        const sendEmail = modalResult.email.length > 0;

        if (!sendWp && !sendEmail) {
            descargarReportePdf(detallado);
            abrirPrevisualizador(detallado);
            return;
        }

        // Mostrar cargando
        Swal.fire({
            title: 'Procesando Envío...',
            text: 'Por favor, espere mientras se despacha el reporte.',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const attempts = [];
        if (sendWp) {
            const queryParam = detallado ? '?detallado=true' : '';
            const url = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp${queryParam}`;
            attempts.push(fetch(url, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinatarios: modalResult.whatsapp.join(', ') })
            }).then(async r => {
                const data = await r.json();
                if (!r.ok || !data.success) throw new Error(data.message || data.error || 'WhatsApp');
                return 'WhatsApp';
            }));
        }
        if (sendEmail) {
            const queryParam = detallado ? '?detallado=true' : '';
            const url = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/email${queryParam}`;
            attempts.push(fetch(url, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinatarios: modalResult.email.join(', ') })
            }).then(async r => {
                const data = await r.json();
                if (!r.ok || !data.success) throw new Error(data.message || data.error || 'Correo');
                return 'Correo';
            }));
        }

        try {
            const results = await Promise.all(attempts);
            Swal.fire({
                icon: 'success',
                title: 'Envío Exitoso',
                text: `El reporte se ha enviado correctamente a través de: ${results.join(' y ')}.`,
                confirmButtonColor: '#6b21a8'
            }).then(() => {
                abrirPrevisualizador(detallado);
            });
        } catch (error) {
            console.error('❌ [CC-FRONT] Error al enviar reporte:', error);
            Swal.fire({
                icon: 'error',
                title: 'Falla al Enviar',
                text: error.message || 'No se pudo enviar el reporte en este momento.',
                confirmButtonColor: '#6b21a8'
            }).then(() => {
                abrirPrevisualizador(detallado);
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
    const tbodyPresupuestosPendientes = document.getElementById('tbody-presupuestos-pendientes');

    async function cargarPresupuestosPendientes007(cuentaId) {
        try {
            if (!tbodyPresupuestosPendientes) return;
            tbodyPresupuestosPendientes.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: #94a3b8; padding: 16px;">
                        ⏳ Cargando comprobantes disponibles...
                    </td>
                </tr>
            `;
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/presupuestos-pendientes`);
            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            const presupuestos = data.data;
            tbodyPresupuestosPendientes.innerHTML = '';

            if (!presupuestos || presupuestos.length === 0) {
                tbodyPresupuestosPendientes.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #94a3b8; padding: 16px;">
                            No hay comprobantes de Lomasoft pendientes para incorporar
                        </td>
                    </tr>
                `;
                cardIncorporar007.style.display = 'none';
                return;
            }

            // Población de la tabla
            presupuestos.forEach(p => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #e2e8f0';
                
                const fechaStr = new Date(p.fecha).toLocaleDateString('es-AR');
                
                tr.innerHTML = `
                    <td style="padding: 10px 12px; color: #334155;">${fechaStr}</td>
                    <td style="padding: 10px 12px; text-align: center; font-weight: bold; color: #475569;">${p.letra || '-'}</td>
                    <td style="padding: 10px 12px; text-align: center; color: #475569;">${p.puesto || '-'}</td>
                    <td style="padding: 10px 12px; color: #475569; font-family: monospace; font-weight: bold;">${p.numero || '-'}</td>
                    <td style="padding: 10px 12px; text-align: right; font-weight: bold; color: #0f172a;">${formatCurrency(p.total)}</td>
                    <td style="padding: 6px 12px; text-align: center;">
                        <button class="btn-premium btn-incorporar-presupuesto" data-id="${p.id}" style="padding: 6px 12px; font-size: 0.8em; margin: 0; background-color: var(--purple-primary, #6b21a8); color: white; border: none; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                            🔗 Incorporar
                        </button>
                    </td>
                `;
                tbodyPresupuestosPendientes.appendChild(tr);
            });

            // Asignar listeners a los botones recién creados
            tbodyPresupuestosPendientes.querySelectorAll('.btn-incorporar-presupuesto').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const presupuestoId = e.currentTarget.getAttribute('data-id');
                    await ejecutarIncorporacion(presupuestoId);
                });
            });

            cardIncorporar007.style.display = 'block';

        } catch (err) {
            console.error('Error al cargar presupuestos del puesto 007:', err);
            if (tbodyPresupuestosPendientes) {
                tbodyPresupuestosPendientes.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #dc2626; padding: 16px; font-weight: bold;">
                            ⚠️ Error al obtener comprobantes: ${err.message}
                        </td>
                    </tr>
                `;
            }
            cardIncorporar007.style.display = 'none';
        }
    }

    async function ejecutarIncorporacion(presupuestoId) {
        if (!presupuestoId) return;

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
    }

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

    // Modal de Previsualización Interactivo de Recibo de Pago (RC) o Ajuste
    window.mostrarModalRecibo = (id) => {
        const mov = window.currentMovimientos ? window.currentMovimientos.find(m => m.id === id) : null;
        if (!mov) {
            Swal.fire('Error', 'No se encontró el movimiento.', 'error');
            return;
        }

        const isDebe = mov.tipo_movimiento === 'DEBITO';
        const montoDisplay = formatCurrency(parseFloat(mov.monto));
        
        const tipoLabel = mov.tipo_comprobante === 'RECIBO_PAGO' ? 'Recibo de Pago' :
                          mov.tipo_comprobante === 'COBRO_BANCARIO' ? 'Cobro Bancario' :
                          mov.tipo_comprobante === 'COBRO_CHEQUE' ? 'Cobro con Cheque' :
                          mov.tipo_comprobante === 'AJUSTE_MANUAL' ? 'Ajuste de Saldo' : 'Comprobante de Pago';
        
        // Determinar forma de cobro por defecto según el tipo de comprobante
        let defaultTipo = 'Efectivo';
        if (mov.tipo_comprobante === 'COBRO_BANCARIO') defaultTipo = 'Transferencia';
        else if (mov.tipo_comprobante === 'COBRO_CHEQUE') defaultTipo = 'Cheque';
        else if (mov.tipo_comprobante === 'AJUSTE_MANUAL' || mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') defaultTipo = 'Ajuste de Saldo';

        let tipoPago = defaultTipo;
        let banco = '';
        let operacion = '';

        if (mov.metadatos) {
            try {
                const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                if (meta) {
                    tipoPago = meta.tipo_pago || defaultTipo;
                    if (meta.banco_origen) banco = `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Banco de Origen:</span> ${meta.banco_origen}</div>`;
                    if (meta.nro_operacion) operacion = `<div style="margin-top: 0.35rem;"><span style="color: #64748b; font-weight: 600;">Operación:</span> #${meta.nro_operacion}</div>`;
                }
            } catch(e) {}
        }

        let metadataHtml = `
            <div style="background: #f8fafc; border-radius: 6px; padding: 0.65rem 0.85rem; font-size: 0.85rem; color: #475569; border: 1px solid #e2e8f0; margin-bottom: 1.25rem; text-align: left;">
                <div style="font-weight: 700; color: #8e4785; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem;">Información del Pago</div>
                <div><span style="color: #64748b; font-weight: 600;">Método:</span> ${tipoPago}</div>
                ${banco}
                ${operacion}
            </div>
        `;

        const pdfUrl = `/api/logistica/bunker/cuentas-corrientes/movimientos/${mov.id}/pdf`;

        Swal.fire({
            title: `<span style="color: #8e4785; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Detalle de Comprobante</span>`,
            html: `
                <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
                    <div style="background: hsl(185, 68%, 20%); color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${tipoLabel}</div>
                        <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${mov.numero_comprobante || `REC-PAGO-${String(mov.id).padStart(8, '0')}`}</div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA EMISIÓN</span>
                            <strong style="color: #1e293b;">${new Date(mov.fecha_movimiento).toLocaleDateString('es-AR')}</strong>
                        </div>
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">CÓDIGO CLIENTE</span>
                            <strong style="color: #1e293b;">${cliente ? cliente.codigo_bunker_cliente : 'N/D'}</strong>
                        </div>
                    </div>
                    ${metadataHtml}
                    <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Monto Recibido</span>
                            <span style="font-size: 1.4rem; font-weight: 750; color: #16a34a">${montoDisplay}</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo de Cuenta</span>
                            <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(parseFloat(mov.saldo_resultante))}</span>
                        </div>
                    </div>
                    <div style="font-size: 0.75rem; color: #64748b; text-align: center; line-height: 1.45; background: #f8fafc; border-radius: 6px; padding: 0.65rem; margin-bottom: 1.25rem;">
                        Este documento está almacenado en el sistema de administración LAMDA.
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.15rem;">
                        <button id="btn-swal-wa" class="swal-action-button wa-btn" style="display: flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.65rem 0.5rem; border-radius: 6px; border: none; background: #25d366; color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.5.953c-5.44 0-9.866 4.372-9.87 9.802 0 1.696.463 3.35 1.337 4.79L1.93 21.02l5.717-1.866zM17.487 14.39c-.3-.15-1.774-.875-2.05-.975-.275-.1-.475-.15-.675.15-.2.3-.775.975-.95 1.175-.175.2-.35.225-.65.075-.3-.15-1.267-.467-2.413-1.49-.893-.797-1.496-1.782-1.67-2.083-.175-.3-.018-.463.13-.612.135-.133.3-.35.45-.525.15-.175.2-.3.3-.5s.05-.375-.025-.525c-.075-.15-.675-1.625-.925-2.225-.244-.589-.492-.51-.675-.518-.173-.008-.373-.01-.573-.01-.2 0-.525.075-.8.375-.275.3-1.05 1.025-1.05 2.5s1.025 2.9 1.175 3.1c.15.2 2.013 3.074 4.877 4.31.683.295 1.218.472 1.635.604.686.218 1.312.187 1.806.114.55-.082 1.774-.725 2.025-1.425.25-.7.25-1.3 0-1.425-.075-.125-.275-.2-.575-.35z"/></svg>
                            <span>WhatsApp</span>
                        </button>
                        <button id="btn-swal-print" class="swal-action-button print-btn" style="display: flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.65rem 0.5rem; border-radius: 6px; border: none; background: #0284c7; color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                            <span>Imprimir</span>
                        </button>
                        <button id="btn-swal-download" class="swal-action-button dl-btn" style="display: flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.65rem 0.5rem; border-radius: 6px; border: none; background: #8e4785; color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>Descargar</span>
                        </button>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cerrar',
            cancelButtonColor: '#475569',
            background: '#ffffff',
            color: '#1e293b',
            customClass: {
                popup: 'swal-b2b-popup',
                cancelButton: 'swal-b2b-btn'
            },
            didOpen: () => {
                const btnWa = document.getElementById('btn-swal-wa');
                const btnPrint = document.getElementById('btn-swal-print');
                const btnDownload = document.getElementById('btn-swal-download');

                if (btnWa) {
                    btnWa.addEventListener('click', () => {
                        const cloudPdfUrl = `https://zysyxtbcvgswancxtpib.supabase.co/storage/v1/object/public/comprobantes/comprobante_${mov.id}.pdf`;
                        const text = encodeURIComponent(`Hola! Comparto el comprobante de pago de mi cuenta corriente en LAMDA: ${cloudPdfUrl}`);
                        window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
                    });
                }

                if (btnPrint) {
                    btnPrint.addEventListener('click', () => {
                        window.open(pdfUrl, '_blank');
                    });
                }

                if (btnDownload) {
                    btnDownload.addEventListener('click', () => {
                        const link = document.createElement('a');
                        link.href = pdfUrl;
                        link.download = `recibo-${mov.id}.pdf`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    });
                }
            }
        });
    };

    // --- INICIALIZACIÓN ---
    inicializar();

});
