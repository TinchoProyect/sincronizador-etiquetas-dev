/**
 * Lógica Frontend - Cuenta Corriente de Clientes Búnker
 * Controla la visualización del saldo consolidado, historial de movimientos,
 * apertura de nuevas cuentas y registro de cobros/ajustes mediante SweetAlert2.
 */

// Función global para redirigir a Recepción de Efectivo manteniendo el cliente activo
window.irARecepcionEfectivo = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const c = urlParams.get('cliente') || sessionStorage.getItem('ultimo_cliente_bunker_cc') || localStorage.getItem('ultimo_cliente_bunker_cc') || '';
    if (c) {
        window.location.href = `recepcion-efectivo.html?cliente=${encodeURIComponent(c)}`;
    } else {
        window.location.href = 'recepcion-efectivo.html';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. Obtener parámetros de la URL
    const urlParams = new URLSearchParams(window.location.search);
    let codigoBunkerCliente = urlParams.get('cliente');

    if (!codigoBunkerCliente) {
        // Rescatar último cliente visitado en la sesión para evitar bloqueos
        const clientePrevio = sessionStorage.getItem('ultimo_cliente_bunker_cc') || localStorage.getItem('ultimo_cliente_bunker_cc');
        if (clientePrevio) {
            console.log(`🔌 [CC-FRONT] Rescatando cliente activo previo: ${clientePrevio}`);
            window.location.replace(`cuenta-corriente.html?cliente=${encodeURIComponent(clientePrevio)}`);
            return;
        }

        Swal.fire({
            icon: 'info',
            title: 'Seleccione un Cliente',
            text: 'Falta especificar el cliente. Lo redirigiremos al listado de clientes.',
            confirmButtonText: 'Ir a Clientes',
            confirmButtonColor: '#6b21a8'
        }).then(() => {
            window.location.href = 'listado-clientes.html';
        });
        return;
    }

    // Persistir cliente activo
    sessionStorage.setItem('ultimo_cliente_bunker_cc', codigoBunkerCliente);
    localStorage.setItem('ultimo_cliente_bunker_cc', codigoBunkerCliente);

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
    let movimientosCuentaSeleccionada = [];
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

            // Si el cliente está vinculado a un usuario colaborador (ej: Matías u otros)
            const btnVerJornadas = document.getElementById('btn-ver-jornadas-colaborador');
            if (btnVerJornadas && cliente.usuario_id) {
                btnVerJornadas.style.display = 'inline-flex';
                btnVerJornadas.onclick = () => {
                    window.open(`http://localhost:3000/pages/colaboradores-jornadas.html?usuario_id=${cliente.usuario_id}`, '_blank');
                };
            }

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

            // Mostrar u ocultar información del saldo de apertura en la tarjeta
            const saldoApertura = parseFloat(cuentaSeleccionada.saldo_apertura) || 0;
            const divSaldoAperturaInfo = document.querySelector('.saldo-apertura-info');
            const valSaldoApertura = document.getElementById('cc-saldo-apertura-val');
            
            if (divSaldoAperturaInfo && valSaldoApertura) {
                if (saldoApertura !== 0) {
                    valSaldoApertura.textContent = formatCurrency(saldoApertura);
                    divSaldoAperturaInfo.style.display = 'block';
                } else {
                    divSaldoAperturaInfo.style.display = 'none';
                }
            }

            // Inicializar valores de la barra de desglose contable
            const elAperturaInit = document.getElementById('lbl-total-apertura');
            const elDebitosInit = document.getElementById('lbl-total-debitos');
            const elCreditosInit = document.getElementById('lbl-total-creditos');
            const elSaldoFinalInit = document.getElementById('lbl-total-saldo-final');
            if (elAperturaInit) elAperturaInit.textContent = formatCurrency(saldoApertura);
            if (elDebitosInit) elDebitosInit.textContent = '...';
            if (elCreditosInit) elCreditosInit.textContent = '...';
            if (elSaldoFinalInit) elSaldoFinalInit.textContent = formatCurrency(saldo);

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
                    <td colspan="8" style="text-align: center; color: #94a3b8; padding: 20px;">
                        ⏳ Cargando movimientos...
                    </td>
                </tr>
            `;

            const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/movimientos`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error al obtener movimientos.');
            }

            movimientosCuentaSeleccionada = data.data || [];
            renderizarMovimientos(data.data);

            // Cargar presupuestos Puesto 007 pendientes
            cargarPresupuestosPendientes007(cuentaId);

            // Cargar composición de saldo y factor tiempo (Punto Cero Logístico)
            cargarComposicionSaldo(cuentaId);

            // Cargar proyección de financiación preferencial (Servicio Salvavidas - Modo Sombra)
            cargarSimulacionSalvavidas(cuentaId);

        } catch (error) {
            console.error('❌ [CC-FRONT] Error al cargar detalle de cuenta:', error);
            cuerpoTablaMovimientos.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #dc2626; font-weight: bold; padding: 20px;">
                        ⚠️ Error de conexión: ${error.message}
                    </td>
                </tr>
            `;
        }
    }

    // --- CARGAR COMPOSICIÓN DE SALDO Y FACTOR TIEMPO (PUNTO CERO LOGÍSTICO) ---
    async function cargarComposicionSaldo(cuentaId) {
        const panel = document.getElementById('panel-composicion-deuda');
        const contenedor = document.getElementById('contenedor-capas-deuda');
        const badgeCondicion = document.getElementById('badge-condicion-comercial');
        const badgeAntMax = document.getElementById('badge-antiguedad-maxima');
        const badgeAntProm = document.getElementById('badge-antiguedad-promedio');

        if (!panel || !contenedor) return;

        try {
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/composicion-saldo`);
            const data = await res.json();

            if (!data.success || !data.data) {
                panel.style.display = 'none';
                return;
            }

            const comp = data.data;
            window.currentComposicionSaldo = comp;

            // Actualizar mini chips en la card de saldo consolidado
            const containerMini = document.getElementById('cc-composicion-deuda-container');
            const listMini = document.getElementById('cc-composicion-deuda-list');

            // Si la cuenta está al día o tiene saldo a favor
            if (comp.estado_cuenta === 'AL_DIA' || comp.estado_cuenta === 'SALDO_A_FAVOR' || !comp.capas || comp.capas.length === 0) {
                if (containerMini) containerMini.style.display = 'none';
                panel.style.display = 'block';
                if (badgeCondicion) {
                    badgeCondicion.className = 'badge-condicion optimo';
                    badgeCondicion.textContent = comp.estado_texto || 'Al día / Sin deuda';
                }
                if (badgeAntMax) badgeAntMax.style.display = 'none';
                if (badgeAntProm) badgeAntProm.style.display = 'none';
                contenedor.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; color: #065f46; display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 0.95em;">
                        <span>✅</span>
                        <span>No registra comprobantes pendientes de pago. La cuenta corriente se encuentra totalmente regularizada y al día.</span>
                    </div>
                `;
                return;
            }

            if (containerMini && listMini) {
                containerMini.style.display = 'block';
                listMini.innerHTML = comp.capas.map(c => {
                    let badgeBg = '#059669'; // Verde <= 7d
                    let tag = '';
                    if (c.antiguedad_dias > 21) {
                        badgeBg = '#dc2626'; // Rojo > 21d
                        tag = ' (Vencido)';
                    } else if (c.antiguedad_dias > 7) {
                        badgeBg = '#d97706'; // Ámbar 8-21d
                    }
                    const nombreCbte = c.descripcion ? c.descripcion.split('(')[0].trim() : 'Comprobante';
                    const antiguedadStr = c.antiguedad_dias === 0 ? 'Hoy' : c.antiguedad_dias === 1 ? 'Hace 1 día' : `Hace ${c.antiguedad_dias} días`;
                    return `
                        <span style="display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.25); padding: 3px 8px; border-radius: 6px; font-size: 0.92em; backdrop-filter: blur(4px);">
                            <span><strong>${nombreCbte}</strong>: ${formatCurrency(c.monto_pendiente)}</span>
                            <span style="background: ${badgeBg}; color: white; padding: 1px 6px; border-radius: 9999px; font-size: 0.82em; font-weight: 700; margin-left: 2px;">
                                ${antiguedadStr}${tag}
                            </span>
                        </span>
                    `;
                }).join('');
            }

            panel.style.display = 'block';
            if (badgeAntMax) {
                badgeAntMax.style.display = 'inline-block';
                badgeAntMax.textContent = `Antigüedad máx: ${comp.antiguedad_maxima_dias} días`;
            }
            if (badgeAntProm) {
                badgeAntProm.style.display = 'inline-block';
                badgeAntProm.textContent = `Promedio ponderado: ${comp.antiguedad_promedio_dias} días`;
            }

            // Badges de condición comercial
            if (badgeCondicion) {
                const condClass = comp.condicion_comercial === 'MORA_ATRASO' ? 'mora' : (comp.condicion_comercial === 'REGULAR_ALERTA' ? 'alerta' : 'optimo');
                badgeCondicion.className = `badge-condicion ${condClass}`;
                badgeCondicion.textContent = comp.condicion_comercial_texto;
            }

            // Renderizar cada capa
            contenedor.innerHTML = comp.capas.map(c => {
                const fechaObj = new Date(c.punto_cero);
                const fechaFmt = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const horaFmt = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

                const porcentajePagado = Math.max(0, Math.min(100, Math.round((100 - c.porcentaje_impago) * 10) / 10));
                const semaforoClass = c.estado_semaforo === 'VENCIDO' ? 'vencido' : (c.estado_semaforo === 'ALERTA' ? 'alerta' : 'optimo');

                return `
                    <div class="capa-card ${semaforoClass}">
                        <div class="capa-top-row">
                            <span class="capa-comprobante">${c.descripcion || 'Comprobante'}</span>
                            <span class="capa-canal-badge">${c.icono} ${c.canal_logistico}</span>
                        </div>
                        <div class="capa-monto-row">
                            <span class="capa-monto-pendiente">${formatCurrency(c.monto_pendiente)}</span>
                            <span class="capa-monto-original">
                                ${c.porcentaje_impago >= 99.9 ? 'Total: ' + formatCurrency(c.monto_original) : `saldo de ${formatCurrency(c.monto_original)} (${c.porcentaje_impago}% impago)`}
                            </span>
                        </div>
                        <div class="capa-progress-container" title="${porcentajePagado}% cancelado">
                            <div class="capa-progress-fill" style="width: ${c.porcentaje_impago}%; background-color: ${c.estado_semaforo === 'VENCIDO' ? '#ef4444' : (c.estado_semaforo === 'ALERTA' ? '#f59e0b' : '#3b82f6')};"></div>
                        </div>
                        <div class="capa-footer-row">
                            <div title="${c.detalles_punto_cero || ''}">
                                <span>Punto Cero: <b>${fechaFmt} ${horaFmt} hs</b></span>
                            </div>
                            <span class="capa-tiempo-badge ${semaforoClass}">⏱️ ${c.antiguedad_texto}</span>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (err) {
            console.error('❌ [CC-FRONT] Error al cargar composición de saldo:', err);
            panel.style.display = 'none';
            const containerMini = document.getElementById('cc-composicion-deuda-container');
            if (containerMini) containerMini.style.display = 'none';
        }
    }

    // --- SERVICIO SALVAVIDAS: ASISTENCIA FINANCIERA (MODO SOMBRA / 3 VENTANAS) ---
    async function cargarSimulacionSalvavidas(cuentaId) {
        const card = document.getElementById('cc-salvavidas-card');
        if (!card) return;

        try {
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/salvavidas-simulacion`);
            const json = await res.json();

            if (!json.success || !json.data) {
                card.style.display = 'none';
                return;
            }

            const sim = json.data;
            window.currentSalvavidasSimulacion = sim;

            card.style.display = 'block';

            const elSaldoReal = document.getElementById('cc-salvavidas-saldo-real');
            const elCortesiaMonto = document.getElementById('cc-salvavidas-cortesia-monto');
            const elCortesiaBadge = document.getElementById('cc-salvavidas-cortesia-badge');
            const elFinanciacion = document.getElementById('cc-salvavidas-monto-financiacion');
            const elTasaDias = document.getElementById('cc-salvavidas-tasa-dias');
            const elSaldoProyectado = document.getElementById('cc-salvavidas-saldo-proyectado');
            const elCantComprobantes = document.getElementById('cc-salvavidas-cant-comprobantes');
            const elDescripcion = document.getElementById('cc-salvavidas-descripcion');
            const elBadgeModo = document.getElementById('cc-salvavidas-badge-modo');
            const elSwitchContainer = document.getElementById('cc-salvavidas-switch-container');
            const containerChips = document.getElementById('cc-salvavidas-detalles-container');
            const listChips = document.getElementById('cc-salvavidas-chips-list');
            const containerPagos = document.getElementById('cc-salvavidas-pagos-container');
            const listPagos = document.getElementById('cc-salvavidas-pagos-list');

            const reglas = sim.reglas_aplicadas || {};
            const modoSwitch = reglas.modo_switch || (reglas.habilitado === false ? 'EXCLUIDO' : 'ACTIVO');

            const saldoCapitalReal = Number(sim.saldo_contable_real || 0);
            const finCalcNeta = Number(sim.financiacion_calculada_neta ?? sim.financiacion_total ?? 0);
            const finCalcIva = Number(sim.financiacion_calculada_iva ?? sim.financiacion_iva ?? 0);
            const finCalcConIva = Number(sim.financiacion_calculada_con_iva ?? sim.financiacion_total_con_iva ?? 0);
            const finTotalNeta = Number(sim.financiacion_total || 0);
            const finTotalIva = Number(sim.financiacion_iva || 0);
            const finTotalConIva = Number(sim.financiacion_total_con_iva || 0);
            const totalRealHoyConIva = Number(sim.saldo_total_proyectado_con_iva || (saldoCapitalReal + finTotalConIva));
            const totalSimuladoSombra = Number((saldoCapitalReal + finCalcConIva).toFixed(2));

            if (elSaldoReal) elSaldoReal.textContent = formatCurrency(saldoCapitalReal);
            if (elSaldoProyectado) elSaldoProyectado.textContent = formatCurrency(totalRealHoyConIva);

            if (elBadgeModo) {
                if (modoSwitch === 'EXCLUIDO') {
                    elBadgeModo.textContent = '⚪ Modo Apagado (Excluido 0%)';
                    elBadgeModo.style.cssText = 'background: rgba(148, 163, 184, 0.22); border: 1px solid #94a3b8; color: #e2e8f0; font-size: 0.72em; font-weight: 700; padding: 2px 9px; border-radius: 9999px; text-transform: uppercase;';
                } else if (modoSwitch === 'SOMBRA') {
                    elBadgeModo.textContent = '🌓 Modo Sombra (Informativo)';
                    elBadgeModo.style.cssText = 'background: rgba(245, 158, 11, 0.22); border: 1px dashed #fbbf24; color: #fde68a; font-size: 0.72em; font-weight: 700; padding: 2px 9px; border-radius: 9999px; text-transform: uppercase;';
                } else {
                    elBadgeModo.textContent = '🛡️ Financiación Activa';
                    elBadgeModo.style.cssText = 'background: rgba(16, 185, 129, 0.22); border: 1px solid #34d399; color: #a7f3d0; font-size: 0.72em; font-weight: 700; padding: 2px 9px; border-radius: 9999px; text-transform: uppercase;';
                }
            }

            if (elSwitchContainer) {
                elSwitchContainer.innerHTML = `
                    <button type="button" onclick="window.cambiarModoSalvavidasDesdeCC('EXCLUIDO')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.78em; font-weight:800; padding:5px 11px; border-radius:9999px; transition:all 0.15s ease; ${modoSwitch === 'EXCLUIDO' ? 'background:#475569; color:#ffffff; box-shadow:0 1px 4px rgba(0,0,0,0.35);' : 'background:transparent; color:#94a3b8;'}">
                        ⚪ Apagado
                    </button>
                    <button type="button" onclick="window.cambiarModoSalvavidasDesdeCC('SOMBRA')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.78em; font-weight:800; padding:5px 11px; border-radius:9999px; transition:all 0.15s ease; ${modoSwitch === 'SOMBRA' ? 'background:rgba(245,158,11,0.25); border:1px dashed #fbbf24; color:#fde68a;' : 'background:transparent; color:#94a3b8;'}">
                        🌓 Sombra
                    </button>
                    <button type="button" onclick="window.cambiarModoSalvavidasDesdeCC('ACTIVO')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.78em; font-weight:800; padding:5px 11px; border-radius:9999px; transition:all 0.15s ease; ${modoSwitch === 'ACTIVO' ? 'background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; box-shadow:0 1px 6px rgba(16,185,129,0.4);' : 'background:transparent; color:#94a3b8;'}">
                        🛡️ Activo
                    </button>
                `;
            }

            const tasaDiariaNum = Number(reglas.tasa_diaria || 0.001);
            const cupoComodines = Number(reglas.cupo_cortesias_anual ?? 3);
            const comodinesDisp = Number(reglas.cortesias_disponibles_anio ?? 3);
            const capasSim = Array.isArray(sim.capas_simuladas) ? sim.capas_simuladas : [];
            const pagosConFin = Array.isArray(sim.pagos_con_financiacion) ? sim.pagos_con_financiacion : [];

            // Calcular interés acumulado exacto desde el Día 1 de entrega
            let interesBonificadoDesdeDia1 = 0;
            capasSim.forEach(c => {
                const cap = Number(c.capital_pendiente || 0);
                const diasD1 = Math.max(1, Number(c.antiguedad_dias || 1));
                const intD1 = Number(c.interes_acumulado_desde_dia_1 ?? (cap * tasaDiariaNum * diasD1));
                if (c.ventana_codigo !== 'ASISTENCIA_FORMALIZADA') {
                    interesBonificadoDesdeDia1 += intD1;
                }
            });

            if (elCortesiaMonto) {
                elCortesiaMonto.textContent = formatCurrency(interesBonificadoDesdeDia1);
            }
            if (elCortesiaBadge) {
                elCortesiaBadge.textContent = `100% Bonificado hasta Día ${ (reglas.dias_ventana_estandar || 7) + (reglas.dias_ventana_cortesia || 7) } · 🎟️ ${comodinesDisp}/${cupoComodines} comodines año`;
            }

            if (modoSwitch === 'EXCLUIDO' || reglas.habilitado === false) {
                if (elFinanciacion) {
                    elFinanciacion.textContent = '$0.00 (Apagado)';
                    elFinanciacion.style.opacity = '0.75';
                }
                if (elTasaDias) elTasaDias.textContent = '0% interés · Excluido del programa';
                if (elCantComprobantes) elCantComprobantes.textContent = 'Sin recargos financieros (0%)';
                if (elDescripcion) {
                    elDescripcion.innerHTML = `⚪ <strong>Financiación Apagada (Excluido):</strong> ${reglas.motivo_excepcion || 'Cliente excluido del programa de financiamiento'}. Esta cuenta no computa cargos de financiación.`;
                }
                if (containerChips) containerChips.style.display = 'none';
                if (containerPagos) containerPagos.style.display = 'none';
                return;
            }

            if (modoSwitch === 'SOMBRA') {
                if (elFinanciacion) {
                    elFinanciacion.textContent = finCalcConIva > 0 ? `+${formatCurrency(finCalcConIva)} (Sombra)` : '$0.00 (Sombra)';
                    elFinanciacion.style.opacity = '0.75';
                }
                if (elTasaDias) {
                    elTasaDias.textContent = finCalcConIva > 0
                        ? `🌓 Informativo: ${formatCurrency(finCalcNeta)} neto + ${formatCurrency(finCalcIva)} IVA 21% (${reglas.tasa_servicio_financiero || 3.0}% TEM)`
                        : `🌓 Modo Sombra (${reglas.tasa_servicio_financiero || 3.0}% TEM informativo)`;
                }
                if (elSaldoProyectado) {
                    elSaldoProyectado.textContent = formatCurrency(saldoCapitalReal);
                }
                if (elCantComprobantes) {
                    elCantComprobantes.textContent = finCalcConIva > 0
                        ? `🌓 Simulado c/IVA: ${formatCurrency(totalSimuladoSombra)} (Informativo)`
                        : `🌓 Modo Sombra activo (sin cargo informativo hoy)`;
                }
                if (elDescripcion) {
                    elDescripcion.innerHTML = `🌓 <strong>Modo Sombra (Informativo):</strong> El esquema de financiación se calcula e informa al cliente a modo educativo para que conozca los plazos y valores, pero <strong>sin aplicación efectiva</strong> sobre el saldo exigible hoy.`;
                }
            } else {
                if (elFinanciacion) {
                    elFinanciacion.textContent = finTotalConIva > 0 ? `+${formatCurrency(finTotalConIva)}` : '$0.00';
                    elFinanciacion.style.opacity = '1';
                }
                if (elTasaDias) {
                    elTasaDias.textContent = finTotalConIva > 0
                        ? `${formatCurrency(finTotalNeta)} neto + ${formatCurrency(finTotalIva)} IVA 21% (${reglas.tasa_servicio_financiero || 3.0}% TEM)`
                        : `Tasa ${reglas.tasa_servicio_financiero || 3.0}% TEM (0,1%/d + IVA desde Día 1)`;
                }
                if (elSaldoProyectado) {
                    elSaldoProyectado.textContent = formatCurrency(totalRealHoyConIva);
                }
                if (elCantComprobantes) {
                    const formalizados = sim.comprobantes_asistencia_formalizada || 0;
                    const cortesia = sim.comprobantes_cortesia || 0;
                    const estandar = sim.comprobantes_margen_estandar || 0;
                    if (formalizados > 0) {
                        elCantComprobantes.textContent = `${formalizados} con financiación activa | ${cortesia} en cortesía`;
                    } else if (cortesia > 0) {
                        elCantComprobantes.textContent = `${cortesia} en ventana de cortesía`;
                    } else {
                        elCantComprobantes.textContent = `${estandar} en margen operativo estándar`;
                    }
                }
                if (elDescripcion) {
                    elDescripcion.textContent = 'Imputación Proporcional Activa: Cada pago parcial cancela conjuntamente el capital y la financiación c/IVA devengada sobre esa porción; el resto impago continúa con su reloj independiente.';
                }
            }

            if (saldoCapitalReal <= 0.005) {
                if (containerChips) containerChips.style.display = 'none';
                if (containerPagos) containerPagos.style.display = 'none';
                return;
            }

            // 1) Chips detallados por comprobante abierto (qué continúa)
            const capas = sim.capas_simuladas || [];
            if (capas.length > 0 && containerChips && listChips) {
                containerChips.style.display = 'block';
                listChips.innerHTML = capas.map(c => {
                    const doc = c.descripcion ? c.descripcion.split('(')[0].trim() : 'Comprobante';
                    const cap = Number(c.capital_pendiente || 0);
                    const orig = Number(c.monto_original || cap);
                    const capPag = Number(c.capital_pagado || 0);
                    const finPag = Number(c.financiacion_pagada_con_iva || 0);
                    const diasD1 = Math.max(1, Number(c.antiguedad_dias || 1));
                    const intNeta = Number(c.interes_financiacion || 0);
                    const intIva = Number(c.iva_financiacion || 0);
                    const intConIva = Number(c.interes_financiacion_con_iva || 0);
                    const subTotHoy = Math.round((cap + intConIva) * 100) / 100;

                    const txtOrig = capPag > 0.01
                        ? `<span style="color: #cbd5e1; font-weight: 400;">(de ${formatCurrency(orig)} · ya canceló ${formatCurrency(capPag)} cap.${finPag > 0 ? ` + ${formatCurrency(finPag)} financ.` : ''})</span>`
                        : `<span style="color: #cbd5e1; font-weight: 400;">(100% de ${formatCurrency(orig)})</span>`;

                    let estiloBadge = 'background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7;';
                    let detalleTexto = `Plazo Normal (${diasD1}d) · 0% Financiación`;

                    if (c.ventana_codigo === 'ASISTENCIA_CORTESIA') {
                        estiloBadge = 'background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #7dd3fc;';
                        detalleTexto = `🎟️ Cortesía (Día ${diasD1}/14) · 0% Financiación Bonificada`;
                    } else if (c.ventana_codigo === 'ASISTENCIA_FORMALIZADA') {
                        estiloBadge = 'background: rgba(251, 191, 36, 0.2); border: 1px solid rgba(251, 191, 36, 0.4); color: #fde68a;';
                        detalleTexto = `Día ${diasD1} · +${formatCurrency(intConIva)} c/IVA (${formatCurrency(intNeta)} + IVA ${formatCurrency(intIva)}) → Subtotal hoy: ${formatCurrency(subTotHoy)}`;
                    } else if (c.ventana_codigo === 'EXCEPCION_COMERCIAL') {
                        estiloBadge = 'background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #d8b4fe;';
                        detalleTexto = 'Acuerdo Especial (0%)';
                    }

                    return `
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; width: 100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); padding: 7px 12px; border-radius: 6px; font-size: 0.85em;">
                            <div>
                                <span>${c.icono || '🧾'} <strong>${doc}</strong> — Capital que continúa: <strong style="color: #f8fafc; font-family: monospace; font-size: 1.05em;">${formatCurrency(cap)}</strong> ${txtOrig}</span>
                            </div>
                            <span style="${estiloBadge} padding: 2px 10px; border-radius: 9999px; font-size: 0.85em; font-weight: 700;">${detalleTexto}</span>
                        </div>
                    `;
                }).join('');
            } else if (containerChips) {
                containerChips.style.display = 'none';
            }

            // 2) Pagos parciales con imputación proporcional de Capital + Financiación y opción de facturación (Interna vs ARCA)
            if (pagosConFin.length > 0 && containerPagos && listPagos) {
                containerPagos.style.display = 'block';
                listPagos.innerHTML = pagosConFin.map(p => {
                    const fPago = p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString('es-AR') : '';
                    const refSobre = p.codigo_sobre ? `Sobre #${p.codigo_sobre}` : `Pago #${p.pago_mov_id}`;
                    const detDocs = (p.detalles_comprobantes || []).filter(d => d.con_financiacion).map(d => {
                        const nom = (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                        return `${nom} (${d.dias_al_pago}d)`;
                    }).join(' + ');

                    let accionesFacturacionHtml = '';
                    if (p.financiacion_facturada && p.factura_financiacion_id) {
                        const urlComp = `http://localhost:3004/pages/ver-factura.html?id=${p.factura_financiacion_id}`;
                        const nomComp = (p.factura_financiacion_descripcion || 'Comprobante').split('—')[0].trim();
                        if (p.modo_facturacion === 'ARCA') {
                            accionesFacturacionHtml = `
                                <span style="background: rgba(16, 185, 129, 0.22); border: 1px solid #34d399; color: #a7f3d0; padding: 3px 9px; border-radius: 6px; font-size: 0.82em; font-weight: 700;">
                                    🏛️ Factura Oficial ARCA: ${nomComp}
                                </span>
                                <a href="${urlComp}" target="_blank" style="background: #0284c7; color: white; text-decoration: none; padding: 4px 10px; border-radius: 5px; font-size: 0.8em; font-weight: 700;">
                                    🔍 Ver Factura
                                </a>
                            `;
                        } else {
                            accionesFacturacionHtml = `
                                <span style="background: rgba(16, 185, 129, 0.22); border: 1px solid #34d399; color: #a7f3d0; padding: 3px 9px; border-radius: 6px; font-size: 0.82em; font-weight: 700;">
                                    🏠 Facturado Interno (Sin ARCA): ${nomComp}
                                </span>
                                <a href="${urlComp}" target="_blank" style="background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.3); color: white; text-decoration: none; padding: 4px 10px; border-radius: 5px; font-size: 0.8em; font-weight: 700;">
                                    🔍 Ver Interno
                                </a>
                                <button type="button" onclick="window.facturarInteresPagoSalvavidas(${p.pago_mov_id}, 'ARCA')" style="background: #4f46e5; border: 1px solid #818cf8; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.8em; font-weight: 700; cursor: pointer;">
                                    🏛️ Oficializar en ARCA
                                </button>
                            `;
                        }
                    } else {
                        accionesFacturacionHtml = `
                            <span style="background: rgba(245, 158, 11, 0.22); border: 1px solid #fbbf24; color: #fde68a; padding: 3px 9px; border-radius: 6px; font-size: 0.82em; font-weight: 700;">
                                ⏳ Interés pendiente de facturar (${formatCurrency(p.financiacion_con_iva_cancelada)})
                            </span>
                            <button type="button" onclick="window.facturarInteresPagoSalvavidas(${p.pago_mov_id}, 'INTERNA')" style="background: #0d9488; border: 1px solid #2dd4bf; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.8em; font-weight: 700; cursor: pointer;">
                                🏠 Facturación Interna (Sin ARCA)
                            </button>
                            <button type="button" onclick="window.facturarInteresPagoSalvavidas(${p.pago_mov_id}, 'ARCA')" style="background: #4f46e5; border: 1px solid #818cf8; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.8em; font-weight: 700; cursor: pointer;">
                                🏛️ Factura Oficial ARCA
                            </button>
                        `;
                    }

                    return `
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: rgba(15, 23, 42, 0.55); border: 1px solid rgba(110, 231, 183, 0.35); padding: 9px 12px; border-radius: 6px; font-size: 0.85em;">
                            <div style="line-height: 1.4;">
                                <div>
                                    💵 <strong>${refSobre}</strong> (${fPago}) — Pago Total: <strong style="color: #6ee7b7; font-family: monospace;">${formatCurrency(p.monto_pago_total)}</strong>
                                    <span style="color: #94a3b8;">s/ ${detDocs}</span>
                                </div>
                                <div style="color: #e2e8f0; font-size: 0.94em;">
                                    ↳ Canceló Capital: <strong style="color: #38bdf8; font-family: monospace;">${formatCurrency(p.capital_cancelado_total)}</strong>
                                    &nbsp;+&nbsp; Canceló Financiación c/IVA: <strong style="color: #fbbf24; font-family: monospace;">${formatCurrency(p.financiacion_con_iva_cancelada)}</strong>
                                    <span style="color: #cbd5e1;">(${formatCurrency(p.financiacion_neta_cancelada)} neto + ${formatCurrency(p.financiacion_iva_cancelada)} IVA 21%)</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                ${accionesFacturacionHtml}
                            </div>
                        </div>
                    `;
                }).join('');
            } else if (containerPagos) {
                containerPagos.style.display = 'none';
            }

        } catch (err) {
            console.error('❌ [CC-FRONT] Error al cargar simulación salvavidas:', err);
            card.style.display = 'none';
        }
    }

    window.cambiarModoSalvavidasDesdeCC = async function(nuevoModo) {
        const codigo = (clienteActual && clienteActual.codigo_bunker_cliente) || codigoCliente;
        if (!codigo || !nuevoModo) return;
        try {
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-cliente/${encodeURIComponent(codigo)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ salvavidas_modo: nuevoModo })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || 'No se pudo actualizar el modo de financiación.');
            }
            if (clienteActual) {
                clienteActual.salvavidas_modo = nuevoModo;
                if (json.data && json.data.salvavidas_config) {
                    clienteActual.salvavidas_config = json.data.salvavidas_config;
                }
            }
            if (cuentaSeleccionada && cuentaSeleccionada.id) {
                await Promise.all([
                    cargarSimulacionSalvavidas(cuentaSeleccionada.id),
                    cargarComposicionSaldo(cuentaSeleccionada.id)
                ]);
            }
            const labelModo = nuevoModo === 'ACTIVO' ? '🛡️ Financiación Activa' : (nuevoModo === 'SOMBRA' ? '🌓 Modo Sombra (Informativo)' : '⚪ Modo Apagado (Excluido)');
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `Modo actualizado: ${labelModo}`,
                showConfirmButton: false,
                timer: 2000
            });
        } catch (err) {
            console.error('❌ [CC-FRONT] Error cambiando modo salvavidas:', err);
            Swal.fire('Error', err.message || 'No se pudo actualizar el modo de financiación.', 'error');
        }
    };

    window.facturarInteresPagoSalvavidas = async function(pagoMovId, modoFacturacion) {
        if (!cuentaSeleccionada || !cuentaSeleccionada.id) return;
        const esArca = modoFacturacion === 'ARCA';
        const confirm = await Swal.fire({
            title: esArca ? '🏛️ ¿Emitir Factura Oficial en ARCA?' : '🏠 ¿Emitir Facturación Interna (Sin ARCA)?',
            html: esArca
                ? 'Se emitirá una <strong>Factura Oficial Electrónica (Pto. Vta. 32 con CAE de ARCA)</strong> por el servicio de financiación cubierto en este pago y se asentará en la cuenta corriente.'
                : 'Se emitirá un <strong>Comprobante de Facturación Interna (Fac X0090, sin comunicar a ARCA)</strong> por el servicio de financiación cubierto en este pago y se dejará asentado en la cuenta corriente.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: esArca ? '🏛️ Emitir en ARCA' : '🏠 Emitir Facturación Interna',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: esArca ? '#4f46e5' : '#0d9488'
        });
        if (!confirm.isConfirmed) return;

        try {
            Swal.fire({ title: 'Procesando comprobante de financiación...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/movimientos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accion: 'FACTURAR_INTERES_PAGO',
                    pago_mov_id: pagoMovId,
                    modo_facturacion: modoFacturacion
                })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'No se pudo emitir el comprobante de financiación.');

            await Swal.fire({
                icon: 'success',
                title: esArca ? 'Factura Oficial ARCA Emitida' : 'Facturación Interna Registrada',
                text: json.message || 'El servicio de financiación quedó registrado en la cuenta corriente.',
                timer: 2200,
                showConfirmButton: false
            });

            await cargarMovimientos(cuentaSeleccionada.id);
            await cargarComposicionSaldo(cuentaSeleccionada.id);
            await cargarSimulacionSalvavidas(cuentaSeleccionada.id);
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    // Modal para editar la excepción comercial del cliente
    window.abrirModalExcepcionSalvavidas = async function() {
        if (!cliente || !cliente.codigo_bunker_cliente) {
            Swal.fire('Atención', 'No hay un cliente seleccionado.', 'warning');
            return;
        }

        const sim = window.currentSalvavidasSimulacion || {};
        const reglas = sim.reglas_aplicadas || {};

        const { value: formValues } = await Swal.fire({
            title: `🛡️ Configurar Servicio Salvavidas<br><span style="font-size: 0.65em; font-weight: 400; color: #64748b;">Cliente: ${cliente.cliente_nombre} (${cliente.codigo_bunker_cliente})</span>`,
            html: `
                <div style="text-align: left; font-size: 0.9em; display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
                    <div>
                        <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Régimen de Aplicación:</label>
                        <select id="swal-salvavidas-modo" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;">
                            <option value="ACTIVO" ${reglas.modo_switch === 'ACTIVO' || reglas.salvavidas_modo === 'ACTIVO' || reglas.salvavidas_modo === 'HABILITADO' ? 'selected' : ''}>🛡️ Financiación Activa (Implementación Efectiva)</option>
                            <option value="SOMBRA" ${reglas.modo_switch === 'SOMBRA' || reglas.salvavidas_modo === 'SOMBRA' || reglas.salvavidas_modo === 'HEREDAR_LISTA' ? 'selected' : ''}>🌓 Modo Sombra / Informativo (${reglas.lista_nombre || 'Estándar'})</option>
                            <option value="EXCLUIDO" ${reglas.modo_switch === 'EXCLUIDO' || reglas.salvavidas_modo === 'EXCLUIDO' ? 'selected' : ''}>⚪ Apagado / Excluido (0% Financiación)</option>
                        </select>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Margen Estándar:</label>
                            <input id="swal-salvavidas-estandar" type="number" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" placeholder="Días (ej: 7)" value="${cliente.salvavidas_dias_estandar !== undefined && cliente.salvavidas_dias_estandar !== null ? cliente.salvavidas_dias_estandar : ''}">
                        </div>
                        <div>
                            <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Ventana Cortesía:</label>
                            <input id="swal-salvavidas-cortesia" type="number" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" placeholder="Días (ej: 7)" value="${cliente.salvavidas_dias_cortesia !== undefined && cliente.salvavidas_dias_cortesia !== null ? cliente.salvavidas_dias_cortesia : ''}">
                        </div>
                        <div>
                            <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Tasa TEM (%):</label>
                            <input id="swal-salvavidas-tem" type="number" step="0.1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" placeholder="Ej: 3.0" value="${cliente.salvavidas_tasa_tem !== undefined && cliente.salvavidas_tasa_tem !== null ? cliente.salvavidas_tasa_tem : ''}">
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #eff6ff; padding: 10px; border-radius: 6px; border: 1px solid #bfdbfe;">
                        <div>
                            <label style="font-weight: 700; color: #1e3a8a; display: block; margin-bottom: 4px; font-size: 0.85em;">🎟️ Cupo Comodines Cortesía / Año:</label>
                            <input id="swal-salvavidas-cupo-comodines" type="number" min="0" max="12" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 36px; background: #fff;" value="${reglas.cupo_cortesias_anual ?? 3}">
                        </div>
                        <div>
                            <label style="font-weight: 700; color: #1e3a8a; display: block; margin-bottom: 4px; font-size: 0.85em;">🎟️ Comodines Usados este Año:</label>
                            <input id="swal-salvavidas-usados-comodines" type="number" min="0" max="12" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 36px; background: #fff;" value="${reglas.cortesias_usadas_anio ?? 0}">
                        </div>
                    </div>
                    <div>
                        <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Motivo de Excepción o Justificación:</label>
                        <textarea id="swal-salvavidas-motivo" class="swal2-textarea" style="width: 100%; margin: 0; box-sizing: border-box; height: 60px; font-size: 0.9em;" placeholder="Ej: Acuerdo de pago quincenal directo">${cliente.salvavidas_motivo_excepcion || ''}</textarea>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Regla',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#4f46e5',
            focusConfirm: false,
            preConfirm: () => {
                return {
                    salvavidas_modo: document.getElementById('swal-salvavidas-modo').value,
                    salvavidas_dias_estandar: document.getElementById('swal-salvavidas-estandar').value,
                    salvavidas_dias_cortesia: document.getElementById('swal-salvavidas-cortesia').value,
                    salvavidas_tasa_tem: document.getElementById('swal-salvavidas-tem').value,
                    salvavidas_cupo_cortesias_anual: document.getElementById('swal-salvavidas-cupo-comodines').value,
                    salvavidas_cortesias_usadas_anio: document.getElementById('swal-salvavidas-usados-comodines').value,
                    salvavidas_motivo_excepcion: document.getElementById('swal-salvavidas-motivo').value
                };
            }
        });

        if (formValues) {
            try {
                Swal.fire({ title: 'Actualizando regla...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-cliente/${cliente.codigo_bunker_cliente}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formValues)
                });
                const resJson = await res.json();
                if (!resJson.success) throw new Error(resJson.error || 'Error al guardar');

                cliente.salvavidas_modo = formValues.salvavidas_modo;
                cliente.salvavidas_dias_estandar = formValues.salvavidas_dias_estandar;
                cliente.salvavidas_dias_cortesia = formValues.salvavidas_dias_cortesia;
                cliente.salvavidas_tasa_tem = formValues.salvavidas_tasa_tem;
                cliente.salvavidas_motivo_excepcion = formValues.salvavidas_motivo_excepcion;

                await Swal.fire({
                    icon: 'success',
                    title: 'Regla Guardada',
                    text: 'La configuración de asistencia financiera se actualizó con éxito.',
                    timer: 2000,
                    showConfirmButton: false
                });

                if (cuentaSeleccionada) {
                    cargarSimulacionSalvavidas(cuentaSeleccionada.id);
                }
            } catch (err) {
                Swal.fire('Error', err.message, 'error');
            }
        }
    };

    // Modal para el Dashboard Global de Métricas Sombra (3 Ventanas)
    window.abrirModalDashboardSalvavidas = async function() {
        try {
            Swal.fire({ title: 'Cargando inteligencia de cartera...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker/cuentas-corrientes/salvavidas/dashboard-sombra');
            const json = await res.json();
            if (!json.success || !json.data) throw new Error(json.error || 'Error al obtener datos');

            const dash = json.data;
            const mg = dash.metricas_generales || {};
            const dist = mg.distribucion_cuentas || {};
            const cfg = dash.configuracion_vigente || {};

            let tablaRankingHtml = (dash.ranking_clientes_asistidos || []).map((c, i) => `
                <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.85em;">
                    <td style="padding: 8px 6px; font-weight: 700; color: #475569;">#${i + 1}</td>
                    <td style="padding: 8px 6px;"><strong>${c.cliente_nombre}</strong> <span style="font-size: 0.8em; color: #64748b;">(${c.codigo_bunker_cliente})</span></td>
                    <td style="padding: 8px 6px; font-size: 0.85em; color: #475569;">${c.lista_nombre}</td>
                    <td style="padding: 8px 6px; text-align: right; font-family: monospace;">${formatCurrency(c.saldo_real)}</td>
                    <td style="padding: 8px 6px; text-align: right; font-family: monospace; font-weight: 700; color: #0284c7;">${formatCurrency(c.cortesia_bonificada || 0)}</td>
                    <td style="padding: 8px 6px; text-align: right; font-family: monospace; font-weight: 700; color: #d97706;">+${formatCurrency(c.asistencia_devengada)}</td>
                    <td style="padding: 8px 6px; text-align: right; font-family: monospace; font-weight: 700; color: #4338ca;">${formatCurrency(c.saldo_total_asistido)}</td>
                </tr>
            `).join('');

            if (!tablaRankingHtml) {
                tablaRankingHtml = '<tr><td colspan="7" style="text-align: center; padding: 15px; color: #64748b;">No hay cuentas con asistencia formalizada. Todas están al día o en margen estándar.</td></tr>';
            }

            Swal.fire({
                title: '🛡️ Dashboard del Servicio Salvavidas<br><span style="font-size: 0.6em; color: #6366f1; font-weight: 600;">Auditoría de Impacto Financiero en Modo Sombra (3 Ventanas)</span>',
                width: '900px',
                html: `
                    <div style="text-align: left; font-size: 0.9em;">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
                            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
                                <div style="font-size: 0.75em; text-transform: uppercase; color: #64748b; font-weight: 700;">Capital Total de Deuda</div>
                                <div style="font-size: 1.35em; font-weight: 850; color: #1e293b; font-family: monospace;">${formatCurrency(mg.capital_total_deuda_real)}</div>
                                <div style="font-size: 0.78em; color: #64748b; margin-top: 3px;">${mg.total_cuentas_con_saldo} cuentas con saldo exigible</div>
                            </div>
                            <div style="background: #fefce8; border: 1px solid #fef08a; border-radius: 8px; padding: 12px 14px;">
                                <div style="font-size: 0.75em; text-transform: uppercase; color: #854d0e; font-weight: 700;">Asistencia Formal (15d+)</div>
                                <div style="font-size: 1.35em; font-weight: 850; color: #b45309; font-family: monospace;">+${formatCurrency(mg.asistencia_total_devengada)}</div>
                                <div style="font-size: 0.78em; color: #854d0e; margin-top: 3px;">Cortesía Bonificada: ${formatCurrency(mg.cortesia_total_bonificada)}</div>
                            </div>
                            <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px 14px;">
                                <div style="font-size: 0.75em; text-transform: uppercase; color: #3730a3; font-weight: 700;">Distribución de Clientes</div>
                                <div style="font-size: 0.82em; color: #1e293b; margin-top: 4px; line-height: 1.35;">
                                    <div>🟢 Margen estándar (1-7d): <strong>${dist.en_margen_estandar}</strong></div>
                                    <div>🤝 Ventana cortesía (8-14d): <strong>${dist.en_ventana_cortesia}</strong></div>
                                    <div>🛡️ Asistencia formal (15d+): <strong>${dist.en_asistencia_formalizada}</strong></div>
                                    <div>⭐ Excluidos / Acuerdo: <strong>${dist.excluidas_por_acuerdo}</strong></div>
                                </div>
                            </div>
                        </div>

                        <div style="background: #f1f5f9; padding: 10px 14px; border-radius: 6px; font-size: 0.82em; color: #475569; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <span>⚙️ <strong>Parámetros Base LAMDA:</strong> Tasa TEM: <strong>${cfg.tasa_servicio_financiero}%</strong> | Margen Estándar: <strong>${cfg.dias_ventana_estandar}d</strong> | Cortesía: <strong>${cfg.dias_ventana_cortesia}d</strong> | Modo: <strong>${cfg.modo_sistema} (Sin cobro real)</strong></span>
                            <button type="button" class="btn-premium" onclick="window.abrirModalConfigGlobalSalvavidas()" style="background: #3b82f6; color: white; padding: 4px 10px; font-size: 0.82em; border-radius: 4px; border: none; cursor: pointer;">
                                ✏️ Configurar Parámetros
                            </button>
                        </div>

                        <div style="font-size: 0.9em; font-weight: 700; color: #1e293b; margin-bottom: 8px;">Top Clientes en Asistencia Financiera / Cortesía:</div>
                        <div style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                            <table style="width: 100%; border-collapse: collapse; text-align: left;">
                                <thead style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 0.78em; text-transform: uppercase; color: #64748b;">
                                    <tr>
                                        <th style="padding: 6px;">#</th>
                                        <th style="padding: 6px;">Cliente</th>
                                        <th style="padding: 6px;">Lista</th>
                                        <th style="padding: 6px; text-align: right;">Deuda Real</th>
                                        <th style="padding: 6px; text-align: right;">Cortesía (Bonif.)</th>
                                        <th style="padding: 6px; text-align: right;">Asistencia (15d+)</th>
                                        <th style="padding: 6px; text-align: right;">Total Asistido</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tablaRankingHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `,
                confirmButtonText: 'Cerrar',
                confirmButtonColor: '#4f46e5'
            });
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    // Modal para editar Parámetros Globales del Servicio Salvavidas
    window.abrirModalConfigGlobalSalvavidas = async function() {
        try {
            Swal.fire({ title: 'Cargando parámetros globales...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await fetch('/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-global');
            const json = await res.json();
            if (!json.success || !json.data) throw new Error(json.error || 'Error al obtener parámetros');

            const cfg = json.data;

            const { value: formValues } = await Swal.fire({
                title: '⚙️ Parámetros Globales: Servicio Salvavidas',
                html: `
                    <div style="text-align: left; font-size: 0.9em; display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div>
                                <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Días Ventana Estándar:</label>
                                <input id="swal-global-estandar" type="number" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" value="${cfg.dias_ventana_estandar}">
                                <small style="color: #64748b;">Margen operativo inicial (0%)</small>
                            </div>
                            <div>
                                <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Días Ventana Cortesía:</label>
                                <input id="swal-global-cortesia" type="number" step="1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" value="${cfg.dias_ventana_cortesia}">
                                <small style="color: #64748b;">100% Bonificado (0%)</small>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div>
                                <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Tasa TEM Base (%):</label>
                                <input id="swal-global-tem" type="number" step="0.1" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" value="${cfg.tasa_servicio_financiero}">
                                <small style="color: #64748b;">Tasa mensual aplicable desde día 15</small>
                            </div>
                            <div>
                                <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Modo de Sistema:</label>
                                <select id="swal-global-modo" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;">
                                    <option value="SOMBRA" ${cfg.modo_sistema === 'SOMBRA' ? 'selected' : ''}>SOMBRA (Auditoría / Simulación)</option>
                                    <option value="ACTIVO" ${cfg.modo_sistema === 'ACTIVO' ? 'selected' : ''}>ACTIVO (Facturación y Débito)</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Descripción Institucional del Servicio:</label>
                            <input id="swal-global-desc" type="text" class="swal2-input" style="width: 100%; margin: 0; box-sizing: border-box; height: 38px;" value="${cfg.descripcion_servicio || ''}">
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: '💾 Guardar Parámetros Globales',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#4f46e5',
                focusConfirm: false,
                preConfirm: () => {
                    return {
                        dias_ventana_estandar: document.getElementById('swal-global-estandar').value,
                        dias_ventana_cortesia: document.getElementById('swal-global-cortesia').value,
                        tasa_servicio_financiero: document.getElementById('swal-global-tem').value,
                        modo_sistema: document.getElementById('swal-global-modo').value,
                        descripcion_servicio: document.getElementById('swal-global-desc').value
                    };
                }
            });

            if (formValues) {
                Swal.fire({ title: 'Actualizando parámetros...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const resUpdate = await fetch('/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-global', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formValues)
                });
                const updateJson = await resUpdate.json();
                if (!updateJson.success) throw new Error(updateJson.error || 'Error al actualizar');

                await Swal.fire({
                    icon: 'success',
                    title: 'Parámetros Actualizados',
                    text: 'La configuración global del Servicio Salvavidas se ha actualizado exitosamente.',
                    timer: 2000,
                    showConfirmButton: false
                });

                // Reabrir dashboard actualizado
                window.abrirModalDashboardSalvavidas();
            }
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    // Vincular botones de Salvavidas si existen en el DOM
    setTimeout(() => {
        const btnConfigCliente = document.getElementById('btn-salvavidas-config-cliente');
        if (btnConfigCliente) {
            btnConfigCliente.addEventListener('click', window.abrirModalExcepcionSalvavidas);
        }
        const btnDashGlobal = document.getElementById('btn-salvavidas-dashboard-general');
        if (btnDashGlobal) {
            btnDashGlobal.addEventListener('click', window.abrirModalDashboardSalvavidas);
        }
    }, 100);

    function renderizarMovimientos(movimientos) {
        window.currentMovimientos = movimientos;

        // Calcular totales de la ecuación contable
        const saldoApertura = cuentaSeleccionada ? (parseFloat(cuentaSeleccionada.saldo_apertura) || 0) : 0;
        let totalDebitos = 0;
        let totalCreditos = 0;

        if (movimientos && movimientos.length > 0) {
            movimientos.forEach(m => {
                const esApertura = String(m.id).startsWith('apertura-') || m.tipo_comprobante === 'AJUSTE_APERTURA';
                if (!esApertura) {
                    const monto = parseFloat(m.monto) || 0;
                    if (m.tipo_movimiento === 'DEBITO') {
                        totalDebitos += monto;
                    } else {
                        totalCreditos += monto;
                    }
                }
            });
        }

        const saldoFinalContable = Math.round((saldoApertura + totalDebitos - totalCreditos) * 100) / 100;

        const elApertura = document.getElementById('lbl-total-apertura');
        const elDebitos = document.getElementById('lbl-total-debitos');
        const elCreditos = document.getElementById('lbl-total-creditos');
        const elSaldoFinal = document.getElementById('lbl-total-saldo-final');

        if (elApertura) elApertura.textContent = formatCurrency(saldoApertura);
        if (elDebitos) elDebitos.textContent = formatCurrency(totalDebitos);
        if (elCreditos) elCreditos.textContent = formatCurrency(totalCreditos);
        if (elSaldoFinal) {
            elSaldoFinal.textContent = formatCurrency(saldoFinalContable);
            if (saldoFinalContable > 0) {
                elSaldoFinal.style.color = 'var(--danger-color)';
            } else if (saldoFinalContable < 0) {
                elSaldoFinal.style.color = 'var(--success-color)';
            } else {
                elSaldoFinal.style.color = 'var(--purple-primary)';
            }
        }

        if (!movimientos || movimientos.length === 0) {
            cuerpoTablaMovimientos.innerHTML = `
                <tr>
                    <td colspan="8">
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
            const esFactura = ['FACTURA', 'FACTURA_A', 'FACTURA_B'].includes(mov.tipo_comprobante);
            const esNC = ['NOTA_CREDITO', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B'].includes(mov.tipo_comprobante);

            if (mov.comprobante_id && (esFactura || esNC)) {
                // Tiene comprobante oficial asociado (AFIP)
                const factId = mov.comprobante_id;
                const factUrl = `http://localhost:3004/pages/ver-factura.html?id=${factId}`;
                const titleStr = esNC ? "Ver nota de crédito oficial de AFIP / LAMDA" : "Ver comprobante oficial de AFIP / LAMDA";
                badgeComprobante = `<a href="${factUrl}" target="_blank" class="badge-comp has-link" title="${titleStr}">🔍 Ver Comp.</a>`;
            } else if (!mov.comprobante_id && mov.presupuesto_id && (esFactura || esNC)) {
                // Factura/NC histórica (Lomasoft) vinculada a un presupuesto
                const pId = mov.presupuesto_id;
                const factUrl = `http://localhost:3004/pages/ver-factura.html?presupuesto_id=${pId}&numero_factura=${encodeURIComponent(mov.descripcion)}`;
                const titleStr = esNC ? "Ver desglose de nota de crédito histórica Lomasoft" : "Ver desglose de factura histórica Lomasoft";
                badgeComprobante = `<a href="${factUrl}" target="_blank" class="badge-comp has-link" title="${titleStr}">🔍 Ver Comp.</a>`;
            } else if (!mov.comprobante_id && mov.tipo_comprobante === 'FACTURA') {
                // Factura Puesto 007 manual / presupuesto incorporado
                badgeComprobante = '<span class="badge-comp" style="background-color: #e0f2fe; color: #0369a1; border-color: #7dd3fc;">Puesto 007 📄</span>';
            } else if (['RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE', 'AJUSTE_MANUAL'].includes(mov.tipo_comprobante)) {
                // Recibo de pago o cobro bancario - Abre modal interactivo de previsualización
                badgeComprobante = `<a href="javascript:void(0)" onclick="mostrarModalRecibo(${mov.id})" class="badge-comp has-link" title="Ver comprobante de cobro oficial de LAMDA">🔍 Ver Comp.</a>`;
            } else if (['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante)) {
                // Pago emitido a cliente/colaborador (Transferencia Banco Galicia)
                badgeComprobante = `<a href="javascript:void(0)" onclick="mostrarModalRecibo(${mov.id})" class="badge-comp has-link" style="background-color: #fee2e2; color: #b91c1c; border-color: #fca5a5; font-weight: bold;" title="Ver comprobante de pago emitido / transferencia Galicia">💳 Pago Galicia 🔍</a>`;
            } else if (mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') {
                badgeComprobante = '<span class="badge-comp" style="background-color: #fef3c7; color: #d97706; border-color: #fcd34d;">Auto ⚡</span>';
            } else if (mov.tipo_comprobante === 'PENDIENTE_FACTURACION') {
                const factId = mov.comprobante_id;
                const factUrl = factId ? `http://localhost:3004/pages/ver-factura.html?id=${factId}` : 'javascript:void(0)';
                badgeComprobante = `<a href="${factUrl}" target="_blank" class="badge-comp has-link" style="background-color: #e0f2fe; color: #0369a1; border-color: #7dd3fc; font-weight: bold;" title="Ver comprobante provisorio (Pendiente de Facturación ARCA)">⏳ Pend. Facturar</a>`;
            } else if (mov.tipo_comprobante === 'AJUSTE_APERTURA') {
                badgeComprobante = '<span class="badge-comp" style="background-color: #dbeafe; color: #1e40af; border-color: #bfdbfe;">Apertura 🔑</span>';
            } else if (mov.tipo_comprobante === 'CREDITO_HORAS') {
                badgeComprobante = `<a href="javascript:void(0)" onclick="mostrarModalJornadaCredito(${mov.id})" class="badge-comp has-link" style="background-color: #f3e8ff; color: #7e22ce; border-color: #d8b4fe; font-weight: bold;" title="Ver ticket de liquidación de horas">⏱️ Horas Depósito 🔍</a>`;
            } else if (mov.tipo_comprobante === 'CREDITO_RENDIMIENTO') {
                badgeComprobante = `<a href="javascript:void(0)" onclick="mostrarModalRendimientoCredito(${mov.id})" class="badge-comp has-link" style="background-color: #ecfdf5; color: #047857; border-color: #a7f3d0; font-weight: bold;" title="Ver ticket de rendimiento de producción externa">📦 Rendimiento Carro 🔍</a>`;
            }


            let descText = mov.descripcion || 'Sin concepto';
            if (mov.tipo_comprobante === 'RECIBO_PAGO') {
                if (mov.metadatos) {
                    try {
                        const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                        if (meta && (meta.es_pago_capital_separado || meta.es_pago_financiacion || meta.tipo_pago === 'Efectivo Ensobrado')) {
                            descText = mov.descripcion || `Rec/Pago Efectivo Ensobrado (Sobre #${meta.codigo_sobre || ''})`;
                        } else if (meta && meta.tipo_pago) {
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

            const esApertura = String(mov.id).startsWith('apertura-');
            const btnDesdeAqui = `
                <button class="btn-premium btn-desde-aqui" data-id="${mov.id}" title="Previsualizar informe desde este movimiento hacia adelante" style="padding: 4px 7px; font-size: 0.8em; margin: 0; background: linear-gradient(135deg, #6b21a8 0%, #7c3aed 100%); box-shadow: none; border: none; border-radius: 4px; color: white; cursor: pointer;">
                    🚩
                </button>
            `;
            const celdaAccion = esApertura ? `
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                    ${btnDesdeAqui}
                    <span title="Saldo de apertura virtual (No editable desde la grilla)" style="font-size: 1.1em; color: #94a3b8; cursor: default;">🔒</span>
                </div>
            ` : `
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                    ${btnDesdeAqui}
                    <button class="btn-premium btn-red btn-eliminar-mov" data-id="${mov.id}" style="padding: 4px 8px; font-size: 0.8em; margin: 0; background-color: #dc2626; box-shadow: none; border: none; border-radius: 4px; color: white;">
                        🗑️
                    </button>
                </div>
            `;

            tr.innerHTML = `
                <td style="text-align: center;"><input type="checkbox" class="chk-mov-select" data-id="${mov.id}" style="cursor: pointer; width: 15px; height: 15px; accent-color: #25d366;"></td>
                <td style="color: #475569; font-size: 0.9em;">${fechaStr}</td>
                <td style="font-weight: 600;">${descText}</td>
                <td>${badgeComprobante}</td>
                <td style="text-align: right;" class="monto-debito">${esDebito ? `+${debitoStr}` : '-'}</td>
                <td style="text-align: right;" class="monto-credito">${!esDebito ? `-${creditoStr}` : '-'}</td>
                <td style="text-align: right;" class="saldo-resultante">${formatCurrency(parseFloat(mov.saldo_resultante))}</td>
                <td style="text-align: center;">
                    ${celdaAccion}
                </td>
            `;
            cuerpoTablaMovimientos.appendChild(tr);
        });

        // Vincular eventos de selección individual de fila
        cuerpoTablaMovimientos.querySelectorAll('.chk-mov-select').forEach(chk => {
            chk.addEventListener('change', () => {
                actualizarBarraSeleccionMovimientos();
            });
        });
        actualizarBarraSeleccionMovimientos();

        // Vincular eventos de "Informe desde aquí"
        const botonesDesdeAqui = cuerpoTablaMovimientos.querySelectorAll('.btn-desde-aqui');
        botonesDesdeAqui.forEach(btn => {
            btn.addEventListener('click', () => {
                const movId = btn.getAttribute('data-id');
                abrirPrevisualizador(null, 'movimiento', null, movId);
            });
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

        const simActual = window.currentSalvavidasSimulacion || null;
        const finActivaConIva = Number(simActual?.financiacion_total_con_iva || window.currentComposicionSaldo?.totales?.financiacion_activa_con_iva || 0);
        const saldoCapActual = Number(cuentaSeleccionada.saldo || 0);

        Swal.fire({
            title: '💵 Registrar Cobro / Pago Recibido',
            html: `
                <div style="text-align: left; font-family: sans-serif; font-size: 0.95em;">
                    <div style="margin-bottom: 12px;">
                        <label style="display:block; font-weight:600; margin-bottom:4px;">Monto del Pago (ARS) <span style="color:red">*</span></label>
                        <input type="number" id="swal-monto" class="swal2-input" style="width: 85%; margin: 0; font-family: monospace; font-weight: 700;" placeholder="0.00" value="${saldoCapActual > 0 ? saldoCapActual.toFixed(2) : ''}" step="0.01" min="0.01">
                    </div>
                    ${finActivaConIva > 0 ? `
                    <div style="margin-bottom: 12px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
                        <div style="font-size: 12px; font-weight: 800; color: #b45309; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span>⏱️ Servicio de Financiación Devengado: ${formatCurrency(finActivaConIva)} c/IVA</span>
                            <a href="/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf?tipo_doc=politicas_financiacion&inline=1" target="_blank" style="font-size: 10.5px; color: #0284c7; text-decoration: underline;">👁️ Ver PDF Políticas</a>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px; font-size: 11.5px;">
                            <label style="display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 6px; cursor: pointer;">
                                <input type="radio" name="swal-cc-modo-fin" value="BONIFICAR" checked style="margin-top: 2px; accent-color: #10b981;">
                                <span><strong style="color: #065f46;">🎁 Bonificar 100% la financiación hoy e imputar todo a Capital</strong> (deja cuenta en $0,00 si cubre capital y adjunta PDF de Políticas)</span>
                            </label>
                            <label style="display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;">
                                <input type="radio" name="swal-cc-modo-fin" value="INTERNA" style="margin-top: 2px; accent-color: #f59e0b;">
                                <span><strong style="color: #92400e;">📋 Cobrar y separar Capital + Financiación → Aprobación Interna (Pto. Vta. 90)</strong></span>
                            </label>
                            <label style="display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;">
                                <input type="radio" name="swal-cc-modo-fin" value="ARCA" style="margin-top: 2px; accent-color: #4f46e5;">
                                <span><strong style="color: #1e40af;">🏛️ Cobrar y separar Capital + Financiación → Facturación ARCA (Pto. Vta. 32)</strong></span>
                            </label>
                        </div>
                    </div>
                    ` : ''}
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
                const radioFin = document.querySelector('input[name="swal-cc-modo-fin"]:checked');
                const modoFinanciacion = radioFin ? radioFin.value : 'BONIFICAR';

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

                return {
                    monto,
                    descripcion,
                    fecha,
                    metadatos,
                    modoFinanciacion,
                    finActivaConIva,
                    bonificado: Boolean(finActivaConIva > 0 && modoFinanciacion === 'BONIFICAR')
                };
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

                    if (
                        data.data &&
                        data.data.id &&
                        (result.value.modoFinanciacion === 'INTERNA' || result.value.modoFinanciacion === 'ARCA')
                    ) {
                        try {
                            await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/facturar-interes-pago`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    pago_mov_id: data.data.id,
                                    modo_facturacion: result.value.modoFinanciacion
                                })
                            });
                        } catch (errFact) {
                            console.warn('⚠️ [CC-FRONT] Error aplicando desglose de financiación:', errFact);
                        }
                    }

                    // Recargar datos
                    await recargarDatosDeCuentaActiva();

                    if (data.data && data.data.id) {
                        await enviarComprobantePorWhatsApp(data.data, {
                            bonificado: result.value.bonificado,
                            finActivaConIva: result.value.finActivaConIva
                        });
                    } else {
                        Swal.fire({
                            icon: 'success',
                            title: 'Pago Registrado',
                            text: 'El cobro ha sido guardado exitosamente y el saldo fue conciliado.',
                            timer: 2000,
                            showConfirmButton: false
                        });
                    }

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

    // --- UTILIDADES DE CONFIGURACIÓN PREDETERMINADA DE REPORTE ---
    function obtenerConfiguracionReportePredeterminada() {
        let config = null;
        if (cuentaSeleccionada && cuentaSeleccionada.configuracion_reporte) {
            if (typeof cuentaSeleccionada.configuracion_reporte === 'string') {
                try {
                    config = JSON.parse(cuentaSeleccionada.configuracion_reporte);
                } catch (e) {
                    config = null;
                }
            } else if (typeof cuentaSeleccionada.configuracion_reporte === 'object') {
                config = cuentaSeleccionada.configuracion_reporte;
            }
        }

        // Fallback a localStorage si la cuenta aún no tiene configuración en base de datos
        if (!config || typeof config !== 'object' || Object.keys(config).length === 0) {
            try {
                const lsKey = cuentaSeleccionada ? `cc_report_cfg_${cuentaSeleccionada.id}` : null;
                if (lsKey) {
                    const stored = localStorage.getItem(lsKey);
                    if (stored) config = JSON.parse(stored);
                }
            } catch (e) {}
        }

        const saldo = cuentaSeleccionada ? parseFloat(cuentaSeleccionada.saldo) : 0;
        return {
            detallado: config && typeof config.detallado === 'boolean' ? config.detallado : false,
            desde_ultimo_cero: config && typeof config.desde_ultimo_cero === 'boolean' ? config.desde_ultimo_cero : false,
            detallar_balance: true,
            modo_corte: config && config.modo_corte ? config.modo_corte : (config && config.desde_ultimo_cero ? 'ultimo_cero' : 'todo'),
            desde_movimiento_id: config && config.desde_movimiento_id ? config.desde_movimiento_id : null
        };
    }

    async function guardarConfiguracionReportePredeterminada(detallado, desdeCero, detallarBalance, modoCorte = null, desdeMovId = null) {
        if (!cuentaSeleccionada || !cuentaSeleccionada.id) return false;

        const payload = {
            detallado: !!detallado,
            desde_ultimo_cero: (modoCorte === 'ultimo_cero' || (desdeCero && modoCorte !== 'todo')),
            detallar_balance: !!detallarBalance,
            modo_corte: modoCorte || (desdeCero ? 'ultimo_cero' : 'todo'),
            desde_movimiento_id: desdeMovId || null
        };

        // Actualizar en memoria inmediatamente
        cuentaSeleccionada.configuracion_reporte = payload;

        // Espejar en localStorage
        try {
            localStorage.setItem(`cc_report_cfg_${cuentaSeleccionada.id}`, JSON.stringify(payload));
        } catch (e) {}

        try {
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/configuracion-reporte`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            return !!(data && data.success);
        } catch (err) {
            console.error('❌ [CC-FRONT] Error al guardar configuración de reporte:', err);
            return false;
        }
    }

    // --- ACCIÓN: PREVISUALIZAR E IMPRIMIR/EXPORTAR REPORTE ---
    function abrirPrevisualizador(detalladoInicial = null, corteInicial = null, detallarBalanceInicial = null, desdeMovIdInicial = null) {
        if (!cuentaSeleccionada) {
            Swal.fire({
                icon: 'warning',
                title: 'Seleccione una cuenta',
                text: 'Debe seleccionar una cuenta corriente activa para previsualizar el informe.',
                confirmButtonColor: '#6b21a8'
            });
            return;
        }

        const cfgPred = obtenerConfiguracionReportePredeterminada();
        let esDetallado = (detalladoInicial !== null) ? detalladoInicial : cfgPred.detallado;
        let esDetallarBalance = (detallarBalanceInicial !== null) ? detallarBalanceInicial : cfgPred.detallar_balance;

        let modoCorte = 'todo';
        let desdeMovId = desdeMovIdInicial || null;

        if (desdeMovIdInicial) {
            modoCorte = 'movimiento';
            desdeMovId = desdeMovIdInicial;
        } else if (corteInicial !== null) {
            if (typeof corteInicial === 'string') {
                modoCorte = corteInicial;
            } else if (corteInicial === true) {
                modoCorte = 'ultimo_cero';
            } else {
                modoCorte = 'todo';
            }
        } else if (cfgPred.modo_corte) {
            modoCorte = cfgPred.modo_corte;
            desdeMovId = cfgPred.desde_movimiento_id || null;
        } else if (cfgPred.desde_ultimo_cero) {
            modoCorte = 'ultimo_cero';
        }

        // Armar opciones de movimientos disponibles para el corte específico
        let opcionesMovimientosHtml = '';
        const listaMovs = (movimientosCuentaSeleccionada && movimientosCuentaSeleccionada.length > 0)
            ? movimientosCuentaSeleccionada
            : [];

        if (listaMovs.length > 0) {
            const movsSorted = [...listaMovs].sort((a, b) => {
                const d = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
                if (d !== 0) return d;
                return b.id - a.id;
            });

            opcionesMovimientosHtml = movsSorted.map(m => {
                const f = new Date(m.fecha_movimiento);
                const fechaStr = `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}`;
                let cpto = m.descripcion || m.tipo_comprobante || 'Movimiento';
                cpto = cpto.replace(/^Factura Puesto 007 - Nro\s+/, 'Fac ').replace(/^Cobro Banc?[ao]rio?\s+/, 'Bco ');
                if (cpto.length > 22) cpto = cpto.substring(0, 21) + '…';
                const sVal = parseFloat(m.saldo_resultante !== undefined ? m.saldo_resultante : (m.saldo_acumulado || 0));
                const isSel = (desdeMovId && String(m.id) === String(desdeMovId));
                return `<option value="${m.id}" ${isSel ? 'selected' : ''}>${fechaStr} · ${cpto} (${formatCurrency(sVal)})</option>`;
            }).join('');

            if (modoCorte === 'movimiento' && !desdeMovId && movsSorted.length > 0) {
                desdeMovId = movsSorted[0].id;
            }
        } else {
            opcionesMovimientosHtml = '<option value="">Sin movimientos</option>';
        }

        function buildReporteUrl() {
            const params = new URLSearchParams();
            if (esDetallado) params.set('detallado', 'true');
            params.set('detallar_balance', esDetallarBalance ? 'true' : 'false');

            if (modoCorte === 'ultimo_cero') {
                params.set('desde_ultimo_cero', 'true');
                params.set('modo_corte', 'ultimo_cero');
            } else if (modoCorte === 'movimiento' && desdeMovId) {
                params.set('modo_corte', 'movimiento');
                params.set('desde_movimiento_id', String(desdeMovId));
            } else {
                params.set('modo_corte', 'todo');
            }

            const q = params.toString() ? `?${params.toString()}` : '';
            return `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf${q}#view=FitH`;
        }

        Swal.fire({
            title: `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box; padding-right: 10px; flex-wrap: wrap; gap: 6px;">
                    <span id="swal-preview-title" style="font-weight: 700; font-size: 0.85em; color: var(--purple-primary);">Previsualización de Informe${esDetallado ? ' Detallado' : ''}</span>
                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                        <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.55em; font-weight: 700; color: #7c3aed; cursor: pointer; user-select: none; background: #fdf4ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #f0abfc;">
                            <input type="checkbox" id="swal-chk-detallar-balance" ${esDetallarBalance ? 'checked' : ''} style="cursor: pointer; width: 13px; height: 13px; accent-color: #7c3aed;">
                            ⏳ Detallar Balance
                        </label>
                        <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.55em; font-weight: 600; color: #475569; cursor: pointer; user-select: none; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1;">
                            <input type="checkbox" id="swal-chk-detallado" ${esDetallado ? 'checked' : ''} style="cursor: pointer; width: 13px; height: 13px; accent-color: var(--purple-primary);">
                            Detallado
                        </label>
                        <div style="display: inline-flex; align-items: center; gap: 4px; background: #f3e8ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #d8b4fe;">
                            <span style="font-size: 0.55em; font-weight: 700; color: #6b21a8;">Rango:</span>
                            <select id="swal-select-corte" style="font-size: 0.55em; font-weight: 600; color: #6b21a8; background: white; border: 1px solid #d8b4fe; border-radius: 3px; padding: 2px 4px; cursor: pointer; outline: none;">
                                <option value="todo" ${modoCorte === 'todo' ? 'selected' : ''}>🌐 Todo</option>
                                <option value="ultimo_cero" ${modoCorte === 'ultimo_cero' ? 'selected' : ''}>✂️ Saldo $0</option>
                                <option value="movimiento" ${modoCorte === 'movimiento' ? 'selected' : ''}>📌 Movimiento...</option>
                            </select>
                            <select id="swal-select-movimiento" style="display: ${modoCorte === 'movimiento' ? 'inline-block' : 'none'}; max-width: 175px; font-size: 0.55em; font-weight: 600; color: #1e293b; background: white; border: 1px solid #cbd5e1; border-radius: 3px; padding: 2px 4px; cursor: pointer; outline: none;">
                                ${opcionesMovimientosHtml}
                            </select>
                        </div>
                        <button id="swal-btn-guardar-formato" title="Guardar este formato como predeterminado para este cliente" class="btn-premium" style="padding: 6px 10px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #d8b4fe; border-radius: 4px; cursor: pointer; font-weight: 600; background: #fbf5ff; color: #6b21a8;">
                            💾 Guardar
                        </button>
                        <a href="/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/reporte-pdf?tipo_doc=politicas_financiacion&inline=1" target="_blank" title="Ver PDF de Políticas y Beneficio de Financiación LAMDA con caso práctico de esta cuenta" class="btn-premium" style="padding: 6px 10px; font-size: 0.55em; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #7dd3fc; border-radius: 4px; cursor: pointer; font-weight: 700; background: #f0f9ff; color: #0284c7; text-decoration: none;">
                            📘 PDF Políticas
                        </a>
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
                    <iframe id="swal-iframe" src="${buildReporteUrl()}" style="width: 100%; height: 100%; border: none;"></iframe>
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
                const btnGuardarFormato = document.getElementById('swal-btn-guardar-formato');
                const chkDetallado = document.getElementById('swal-chk-detallado');
                const chkDetallarBalance = document.getElementById('swal-chk-detallar-balance');
                const selectCorte = document.getElementById('swal-select-corte');
                const selectMov = document.getElementById('swal-select-movimiento');
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

                if (chkDetallarBalance) {
                    chkDetallarBalance.addEventListener('change', () => {
                        esDetallarBalance = chkDetallarBalance.checked;
                        iframe.src = buildReporteUrl();
                    });
                }

                if (chkDetallado) {
                    chkDetallado.addEventListener('change', () => {
                        esDetallado = chkDetallado.checked;
                        titleSpan.textContent = `Previsualización de Informe${esDetallado ? ' Detallado' : ''}`;
                        iframe.src = buildReporteUrl();
                    });
                }

                if (selectCorte) {
                    selectCorte.addEventListener('change', () => {
                        modoCorte = selectCorte.value;
                        if (modoCorte === 'movimiento') {
                            selectMov.style.display = 'inline-block';
                            if (!desdeMovId && selectMov.value) {
                                desdeMovId = selectMov.value;
                            }
                        } else {
                            selectMov.style.display = 'none';
                        }
                        iframe.src = buildReporteUrl();
                    });
                }

                if (selectMov) {
                    selectMov.addEventListener('change', () => {
                        desdeMovId = selectMov.value;
                        iframe.src = buildReporteUrl();
                    });
                }

                if (btnGuardarFormato) {
                    btnGuardarFormato.addEventListener('click', async () => {
                        btnGuardarFormato.disabled = true;
                        const originalText = btnGuardarFormato.innerHTML;
                        btnGuardarFormato.innerHTML = '⏳ Guardando...';
                        const ok = await guardarConfiguracionReportePredeterminada(esDetallado, modoCorte === 'ultimo_cero', esDetallarBalance, modoCorte, desdeMovId);
                        if (ok) {
                            btnGuardarFormato.innerHTML = '✅ ¡Guardado!';
                            btnGuardarFormato.style.backgroundColor = '#dcfce7';
                            btnGuardarFormato.style.color = '#15803d';
                            btnGuardarFormato.style.borderColor = '#86efac';
                        } else {
                            btnGuardarFormato.innerHTML = '❌ Error';
                        }
                        setTimeout(() => {
                            if (btnGuardarFormato) {
                                btnGuardarFormato.disabled = false;
                                btnGuardarFormato.innerHTML = originalText;
                                btnGuardarFormato.style.backgroundColor = '#fbf5ff';
                                btnGuardarFormato.style.color = '#6b21a8';
                                btnGuardarFormato.style.borderColor = '#d8b4fe';
                            }
                        }, 1800);
                    });
                }

                btnWhatsapp.addEventListener('click', () => {
                    enviarReportePorWhatsApp(esDetallado, modoCorte, esDetallarBalance, desdeMovId);
                });

                btnDownload.addEventListener('click', () => {
                    descargarReportePdf(esDetallado, modoCorte, esDetallarBalance, desdeMovId);
                });

                btnClose.addEventListener('click', () => {
                    Swal.close();
                });
            }
        });
    }

    btnPrevisualizarReporte.addEventListener('click', () => {
        abrirPrevisualizador();
    });

    async function enviarReportePorWhatsApp(detallado = false, modoCorte = 'todo', detallarBalance = true, desdeMovId = null) {
        if (!cuentaSeleccionada) return;

        // Mostrar cargando inicial mientras se trae el mensaje predeterminado
        Swal.fire({
            title: 'Preparando Despacho...',
            text: 'Cargando plantilla de mensaje...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        let mensajePredeterminado = '';
        try {
            const paramsMsg = new URLSearchParams();
            if (detallado) paramsMsg.set('detallado', 'true');
            if (modoCorte === 'ultimo_cero' || modoCorte === true) paramsMsg.set('desde_ultimo_cero', 'true');
            paramsMsg.set('modo_corte', (modoCorte === true) ? 'ultimo_cero' : (modoCorte || 'todo'));
            if (desdeMovId) paramsMsg.set('desde_movimiento_id', String(desdeMovId));
            if (!detallarBalance) paramsMsg.set('detallar_balance', 'false');
            const qMsg = paramsMsg.toString() ? `?${paramsMsg.toString()}` : '';
            const resMsg = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp/mensaje-predeterminado${qMsg}`);
            const dataMsg = await resMsg.json();
            if (dataMsg.success) {
                mensajePredeterminado = dataMsg.mensajeTexto;
                
                // Formatear saldo con convención de millares: punto (.) y decimales: coma (,)
                const numSaldo = parseFloat(cuentaSeleccionada.saldo) || 0;
                const parts = Math.abs(numSaldo).toFixed(2).split('.');
                const formattedInt = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                const sign = numSaldo < 0 ? '-' : '';
                const formattedSaldo = `${sign}$ ${formattedInt},${parts[1]}`;
                
                mensajePredeterminado = mensajePredeterminado.replace('[SALDO_PLACEHOLDER]', formattedSaldo);
            }
        } catch (err) {
            console.error('❌ [CC-FRONT] Error cargando mensaje predeterminado:', err);
        }

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
            id: c.id,
            numero: c.numero ? c.numero.replace(/\D/g, '') : '',
            nombre: c.nombre || '',
            cargo: c.cargo || '',
            enviar_alerta: c.enviar_alerta !== false,
            default_resumen: c.default_resumen === true || c.default === true,
            default: c.default_resumen === true || c.default === true
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
                abrirPrevisualizador(detallado, desdeCero, detallarBalance);
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
                <div id="swal-cc-wps-container" style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
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
                <div id="swal-cc-emails-container" style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px;">
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

        async function guardarPreferenciasYContactos(selectedWpsList, selectedEmailsList) {
            if (!cliente || !cliente.id) return;

            // 1. Mapear existentes sincronizando default_resumen y default
            const updatedWps = contacts.map((c, idx) => {
                const isSel = selectedWpsList.includes(c.numero);
                return {
                    ...c,
                    id: c.id || `cont_${Date.now().toString(36)}_${idx}`,
                    enviar_alerta: c.enviar_alerta !== false,
                    default_resumen: isSel,
                    default: isSel
                };
            });

            // Si hay números adicionales que no existían en la lista previa, agregarlos
            const existingNums = new Set(updatedWps.map(c => c.numero));
            selectedWpsList.forEach(num => {
                if (num && !existingNums.has(num)) {
                    updatedWps.push({
                        id: `cont_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
                        numero: num,
                        nombre: 'Contacto Adicional',
                        cargo: '',
                        enviar_alerta: true,
                        default_resumen: true,
                        default: true
                    });
                    existingNums.add(num);
                }
            });

            // 2. Mapear correos existentes
            const updatedEmails = emails.map(e => {
                const isSel = selectedEmailsList.includes(e.email);
                return {
                    ...e,
                    default_factura: isSel
                };
            });

            // Si hay correos adicionales que no existían en la lista previa, agregarlos
            const existingEmails = new Set(updatedEmails.map(e => e.email.toLowerCase()));
            selectedEmailsList.forEach(em => {
                if (em && !existingEmails.has(em.toLowerCase())) {
                    updatedEmails.push({
                        id: `email_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
                        email: em,
                        nombre: 'Contacto Adicional',
                        cargo: '',
                        default_factura: true
                    });
                    existingEmails.add(em.toLowerCase());
                }
            });

            contacts = updatedWps;
            emails = updatedEmails;
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

            // Guardar también la configuración del reporte como predeterminada
            await guardarConfiguracionReportePredeterminada(detallado, modoCorte === 'ultimo_cero' || modoCorte === true, detallarBalance, modoCorte, desdeMovId);
        }

        if (cliente && cliente.id) {
            htmlContent += `
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #475569; user-select: none;">
                        <input type="checkbox" id="swal-save-default" style="width: 16px; height: 16px; cursor: pointer; accent-color: #7c3aed;">
                        <span>Guardar selección como contactos predeterminados</span>
                    </label>
                    <button type="button" id="swal-btn-guardar-predeterminados-inmodal" class="btn-premium" style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 6px; padding: 6px 12px; font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s ease;">
                        💾 Guardar como Predeterminado
                    </button>
                </div>
                <div id="swal-feedback-guardar-predeterminados" style="display: none; font-size: 11px; font-weight: 600; color: #16a34a; text-align: right; margin-top: 4px;"></div>
            `;
        }

        const safeModoCorte = String(modoCorte || 'todo').replace(/[^a-zA-Z0-9_-]/g, '');
        const safeDesdeMovId = desdeMovId ? String(desdeMovId).replace(/[^0-9]/g, '') : '';

        // Cuadro de texto interactivo para WhatsApp (corto por defecto, ya que el detalle grueso va adentro del PDF)
        htmlContent += `
            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #cbd5e1; text-align: left;">
                <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 7px 10px; margin-bottom: 8px;">
                    <div style="font-size: 11px; font-weight: 800; color: #065f46; margin-bottom: 4px;">📄 El detalle grueso (comprobantes, plazos, pagos parciales, 5% OFF y CBU) ya va incluido dentro del PDF.</div>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #0f172a; font-weight: 700; cursor: pointer;">
                        <input type="checkbox" id="swal-cc-anexo-portal" checked onchange="window.actualizarMensajeConAnexosEnModalCC && window.actualizarMensajeConAnexosEnModalCC()">
                        <span>🔗 Incluir link del Portal de pedidos en el pie del mensaje</span>
                    </label>
                </div>
                <label style="display: block; font-size: 11px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; text-align: left;">
                    📝 Mensaje corto de WhatsApp que acompaña al PDF (Editable)
                </label>
                <textarea id="swal-mensaje-whatsapp" data-base-msg="${encodeURIComponent(mensajePredeterminado)}" rows="3" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box; resize: vertical; outline: none; background-color: #fcfcfc;">${mensajePredeterminado}</textarea>
                <div style="margin-top: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <span style="font-size: 11px; font-weight: 700; color: #92400e;">🧪 Probar antes en WhatsApp Empresa:</span>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <input type="text" id="swal-cc-tel-prueba" value="5492216615746" style="width: 120px; padding: 4px 6px; font-size: 11px; font-weight: 700; border: 1px solid #f59e0b; border-radius: 4px; color: #78350f;">
                        <button type="button" id="btn-swal-cc-enviar-prueba" onclick="window.enviarPruebaReporteDesdeModalCC && window.enviarPruebaReporteDesdeModalCC(${Boolean(detallado)}, '${safeModoCorte}', ${Boolean(detallarBalance)}, '${safeDesdeMovId}')" style="background: #d97706; color: white; border: none; border-radius: 5px; padding: 5px 10px; font-size: 11px; font-weight: 800; cursor: pointer;">
                            🧪 Enviar Prueba al 221 661 5746
                        </button>
                    </div>
                </div>
                <div id="swal-cc-prueba-feedback" style="display: none; margin-top: 5px; padding: 6px 8px; border-radius: 5px; font-size: 11px; font-weight: 700;"></div>
            </div>
        `;

        htmlContent += `</div>`;

        const { value: modalResult } = await Swal.fire({
            title: 'Despacho de Reporte',
            html: htmlContent,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: false,
            confirmButtonText: '📤 Enviar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7c3aed',
            cancelButtonColor: '#6b7280',
            didOpen: () => {
                const btnGuardarPred = document.getElementById('swal-btn-guardar-predeterminados-inmodal');
                const feedbackDiv = document.getElementById('swal-feedback-guardar-predeterminados');
                const chkSaveDefault = document.getElementById('swal-save-default');

                if (btnGuardarPred) {
                    btnGuardarPred.addEventListener('click', async () => {
                        btnGuardarPred.disabled = true;
                        const originalText = btnGuardarPred.innerHTML;
                        btnGuardarPred.innerHTML = '⏳ Guardando...';

                        const selectedWps = Array.from(document.querySelectorAll('.swal-cc-contacto-wp-chk:checked')).map(el => el.value);
                        const selectedEmails = Array.from(document.querySelectorAll('.swal-cc-contacto-email-chk:checked')).map(el => el.value);
                        const customPhoneInput = document.getElementById('swal-custom-phone');
                        const customEmailInput = document.getElementById('swal-custom-email');
                        const customPhone = customPhoneInput ? customPhoneInput.value.trim() : '';
                        const customEmail = customEmailInput ? customEmailInput.value.trim() : '';

                        if (customPhone) {
                            const cleaned = customPhone.replace(/\D/g, '');
                            if (cleaned && !selectedWps.includes(cleaned)) {
                                selectedWps.push(cleaned);
                            }
                        }
                        if (customEmail) {
                            const cleanedEm = customEmail.trim();
                            if (cleanedEm && cleanedEm.includes('@') && !selectedEmails.includes(cleanedEm)) {
                                selectedEmails.push(cleanedEm);
                            }
                        }

                        try {
                            await guardarPreferenciasYContactos(selectedWps, selectedEmails);
                            if (chkSaveDefault) chkSaveDefault.checked = true;

                            // Si se agregó un teléfono manual, representarlo visualmente en la lista
                            const wpContainer = document.getElementById('swal-cc-wps-container');
                            if (wpContainer && customPhone) {
                                const cleanNum = customPhone.replace(/\D/g, '');
                                const newLbl = document.createElement('label');
                                newLbl.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #86efac; border-radius: 6px; background: #f0fdf4; cursor: pointer; transition: background 0.2s; margin-bottom: 0;';
                                newLbl.innerHTML = `
                                    <input type="checkbox" class="swal-cc-contacto-wp-chk" value="${cleanNum}" checked style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #10b981;">
                                    <div style="flex: 1;">
                                        <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;"><strong>Contacto Adicional</strong> <span style="font-size: 9px; background: #dcfce7; color: #15803d; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase;">Guardado</span></div>
                                        <div style="font-size: 11px; color: #6b7280;">📱 ${customPhone}</div>
                                    </div>
                                `;
                                wpContainer.appendChild(newLbl);
                                if (customPhoneInput) customPhoneInput.value = '';
                            }

                            // Si se agregó un correo manual, representarlo visualmente en la lista
                            const emailContainer = document.getElementById('swal-cc-emails-container');
                            if (emailContainer && customEmail) {
                                const newLbl = document.createElement('label');
                                newLbl.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; padding: 8px; border: 1px solid #c4b5fd; border-radius: 6px; background: #f5f3ff; cursor: pointer; transition: background 0.2s; margin-bottom: 0;';
                                newLbl.innerHTML = `
                                    <input type="checkbox" class="swal-cc-contacto-email-chk" value="${customEmail.trim()}" checked style="margin-top: 2px; cursor: pointer; width: 15px; height: 15px; accent-color: #8b5cf6;">
                                    <div style="flex: 1;">
                                        <div style="font-size: 12px; color: #1f2937; margin-bottom: 1px;"><strong>Contacto Adicional</strong> <span style="font-size: 9px; background: #f3e8ff; color: #6b21a8; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase;">Guardado</span></div>
                                        <div style="font-size: 11px; color: #6b7280; word-break: break-all;">📧 ${customEmail.trim()}</div>
                                    </div>
                                `;
                                emailContainer.appendChild(newLbl);
                                if (customEmailInput) customEmailInput.value = '';
                            }

                            btnGuardarPred.innerHTML = '✅ ¡Guardado!';
                            btnGuardarPred.style.background = '#dcfce7';
                            btnGuardarPred.style.color = '#15803d';
                            btnGuardarPred.style.borderColor = '#86efac';

                            if (feedbackDiv) {
                                feedbackDiv.textContent = '✓ Contactos y formato guardados como predeterminados para este cliente.';
                                feedbackDiv.style.display = 'block';
                            }

                            setTimeout(() => {
                                if (btnGuardarPred) {
                                    btnGuardarPred.disabled = false;
                                    btnGuardarPred.innerHTML = originalText;
                                    btnGuardarPred.style.background = '#f3e8ff';
                                    btnGuardarPred.style.color = '#6b21a8';
                                    btnGuardarPred.style.borderColor = '#d8b4fe';
                                }
                            }, 2200);
                        } catch (err) {
                            console.error('❌ [CC-FRONT] Error al guardar preferencias:', err);
                            btnGuardarPred.innerHTML = '❌ Error al guardar';
                            setTimeout(() => {
                                if (btnGuardarPred) {
                                    btnGuardarPred.disabled = false;
                                    btnGuardarPred.innerHTML = originalText;
                                }
                            }, 2000);
                        }
                    });
                }
            },
            preConfirm: () => {
                const selectedWps = Array.from(document.querySelectorAll('.swal-cc-contacto-wp-chk:checked')).map(el => el.value);
                const selectedEmails = Array.from(document.querySelectorAll('.swal-cc-contacto-email-chk:checked')).map(el => el.value);
                const customPhone = document.getElementById('swal-custom-phone') ? document.getElementById('swal-custom-phone').value.trim() : '';
                const customEmail = document.getElementById('swal-custom-email') ? document.getElementById('swal-custom-email').value.trim() : '';
                const saveDefaultCheckbox = document.getElementById('swal-save-default');
                const saveDefault = saveDefaultCheckbox ? saveDefaultCheckbox.checked : false;
                const mensajeTexto = document.getElementById('swal-mensaje-whatsapp') ? document.getElementById('swal-mensaje-whatsapp').value : '';

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
                    saveDefault: saveDefault,
                    mensajeTexto: mensajeTexto
                };
            }
        });

        if (!modalResult) {
            abrirPrevisualizador(detallado, modoCorte, detallarBalance, desdeMovId);
            return;
        }

        // Guardar por defecto si se requiere al presionar Enviar
        if (modalResult.saveDefault && cliente && cliente.id) {
            try {
                await guardarPreferenciasYContactos(modalResult.whatsapp, modalResult.email);
                console.log('✅ [CC-FRONT] Contactos y configuración de reporte predeterminados actualizados.');
            } catch (err) {
                console.error('❌ [CC-FRONT] Error al guardar contactos predeterminados:', err);
            }
        }

        const sendWp = modalResult.whatsapp.length > 0;
        const sendEmail = modalResult.email.length > 0;

        if (!sendWp && !sendEmail) {
            descargarReportePdf(detallado, modoCorte, detallarBalance, desdeMovId);
            abrirPrevisualizador(detallado, modoCorte, detallarBalance, desdeMovId);
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
        const paramsDispatch = new URLSearchParams();
        if (detallado) paramsDispatch.set('detallado', 'true');
        if (modoCorte === 'ultimo_cero' || modoCorte === true) paramsDispatch.set('desde_ultimo_cero', 'true');
        paramsDispatch.set('modo_corte', (modoCorte === true) ? 'ultimo_cero' : (modoCorte || 'todo'));
        if (desdeMovId) paramsDispatch.set('desde_movimiento_id', String(desdeMovId));
        if (!detallarBalance) paramsDispatch.set('detallar_balance', 'false');
        const qDispatch = paramsDispatch.toString() ? `?${paramsDispatch.toString()}` : '';

        if (sendWp) {
            const url = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp${qDispatch}`;
            attempts.push(fetch(url, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    destinatarios: modalResult.whatsapp.join(', '),
                    mensajeTexto: modalResult.mensajeTexto,
                    desde_ultimo_cero: (modoCorte === 'ultimo_cero' || modoCorte === true),
                    modo_corte: (modoCorte === true) ? 'ultimo_cero' : (modoCorte || 'todo'),
                    desde_movimiento_id: desdeMovId || null,
                    detallar_balance: detallarBalance
                })
            }).then(async r => {
                const data = await r.json();
                if (!r.ok || !data.success) throw new Error(data.message || data.error || 'WhatsApp');
                return 'WhatsApp';
            }));
        }
        if (sendEmail) {
            const url = `/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/email${qDispatch}`;
            attempts.push(fetch(url, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    destinatarios: modalResult.email.join(', '),
                    desde_ultimo_cero: (modoCorte === 'ultimo_cero' || modoCorte === true),
                    modo_corte: (modoCorte === true) ? 'ultimo_cero' : (modoCorte || 'todo'),
                    desde_movimiento_id: desdeMovId || null,
                    detallar_balance: detallarBalance
                })
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
                abrirPrevisualizador(detallado, modoCorte, detallarBalance, desdeMovId);
            });
        } catch (error) {
            console.error('❌ [CC-FRONT] Error al enviar reporte:', error);
            Swal.fire({
                icon: 'error',
                title: 'Falla al Enviar',
                text: error.message || 'No se pudo enviar el reporte en este momento.',
                confirmButtonColor: '#6b21a8'
            }).then(() => {
                abrirPrevisualizador(detallado, modoCorte, detallarBalance, desdeMovId);
            });
        }
    }

    function descargarReportePdf(detallado = false, modoCorte = 'todo', detallarBalance = true, desdeMovId = null) {
        if (!cuentaSeleccionada) return;
        const link = document.createElement('a');
        const params = new URLSearchParams();
        if (detallado) params.set('detallado', 'true');
        if (!detallarBalance) params.set('detallar_balance', 'false');

        if (modoCorte === 'ultimo_cero' || modoCorte === true) {
            params.set('desde_ultimo_cero', 'true');
            params.set('modo_corte', 'ultimo_cero');
        } else if (modoCorte === 'movimiento' && desdeMovId) {
            params.set('modo_corte', 'movimiento');
            params.set('desde_movimiento_id', String(desdeMovId));
        } else {
            params.set('modo_corte', 'todo');
        }

        const queryParam = params.toString() ? `?${params.toString()}` : '';
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

        async function enviarComprobantePorWhatsApp(mov, opts = {}) {
        if (!cliente) return;

        const configKey = `cc_envio_comprobante_config_${cliente.codigo_bunker_cliente}`;
        let savedConfig = null;
        try {
            const raw = localStorage.getItem(configKey);
            if (raw) savedConfig = JSON.parse(raw);
        } catch(e) {}

        // Recuperar y parsear contactos de WhatsApp
        let contacts = [];
        const rawWp = (cliente.whatsapp_facturas || '').trim();
        if (rawWp.startsWith('[')) {
            try {
                contacts = JSON.parse(rawWp);
            } catch(e) {}
        }
        if (!Array.isArray(contacts) || contacts.length === 0) {
            const rawPhone = (!rawWp.startsWith('[') ? rawWp : '') || cliente.celular || cliente.telefono || '';
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
            const rawEmailVal = (!rawEmail.startsWith('[') ? rawEmail : '');
            if (rawEmailVal) {
                emails = rawEmailVal.split(',').map(e => ({
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

        const isFactura = ['FACTURA', 'FACTURA_A', 'FACTURA_B', 'NOTA_CREDITO', 'NOTA_DEBITO'].includes(mov.tipo_comprobante);
        const isPagoEmitido = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
        const esReciboPago = !isFactura && !isPagoEmitido;
        const ccIdActual = (cuentaSeleccionada && cuentaSeleccionada.id) ? cuentaSeleccionada.id : mov.cuenta_corriente_id;

        // Calcular el saldo consolidado actual de la cuenta corriente (incluyendo financiación activa si la hubiera)
        const currentAccountBalance = (typeof cuentaSeleccionada !== 'undefined' && cuentaSeleccionada && (cuentaSeleccionada.saldo !== undefined || cuentaSeleccionada.saldo_actual !== undefined))
            ? parseFloat(cuentaSeleccionada.saldo ?? cuentaSeleccionada.saldo_actual)
            : parseFloat(mov.saldo_resultante) || 0;
        const finActivaPost = Number(window.currentComposicionSaldo?.totales?.financiacion_activa_con_iva || window.currentSalvavidasSimulacion?.financiacion_total_con_iva || 0);
        const totalProyectadoPost = Number(window.currentComposicionSaldo?.totales?.total_proyectado_con_iva || (currentAccountBalance + finActivaPost));
        const finBonificadaReciente = Number(opts?.finActivaConIva || window.currentComposicionSaldo?.totales?.financiacion_bonificada_con_iva || 0);
        const autoCheckPoliticas = Boolean(esReciboPago && (opts?.bonificado || (finBonificadaReciente > 0 && Math.abs(currentAccountBalance) <= 0.01)));

        let saldoStatusText = '';
        if (currentAccountBalance >= -0.01 && currentAccountBalance <= 0.01) {
            saldoStatusText = 'Su cuenta corriente se encuentra al día ($0,00).';
        } else if (currentAccountBalance < -0.01) {
            const absSaldo = Math.abs(currentAccountBalance);
            const formattedSaldo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(absSaldo).replace(/\s+/g, ' ');
            saldoStatusText = `Ha quedado un saldo a favor de ${formattedSaldo}.`;
        } else {
            const formattedCap = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(currentAccountBalance).replace(/\s+/g, ' ');
            if (finActivaPost > 0) {
                const formattedTot = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(totalProyectadoPost).replace(/\s+/g, ' ');
                const formattedFin = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(finActivaPost).replace(/\s+/g, ' ');
                saldoStatusText = `Saldo total pendiente en cuenta corriente: ${formattedTot} (Capital: ${formattedCap} + Servicio de Financiación c/IVA: ${formattedFin}).`;
            } else {
                saldoStatusText = `Saldo pendiente en cuenta corriente: ${formattedCap}.`;
            }
        }

        // Construir contenido HTML con estilos premium y diseño de dos columnas
        let htmlContent = `
            <div style="text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; flex-direction: column; gap: 14px;">
                ${esReciboPago && ccIdActual ? `
                <!-- Documentos PDF Adjuntos (Recibo + Políticas y Beneficio de Financiación LAMDA) -->
                <div style="border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 12px; background: #f0f9ff;">
                    <div style="font-size: 12px; font-weight: 700; color: #0369a1; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                        <span>📎 Documentos PDF a Enviar al Cliente</span>
                        <a href="/api/logistica/bunker/cuentas-corrientes/${ccIdActual}/reporte-pdf?tipo_doc=politicas_financiacion&movimiento_id=${mov.id}&inline=1" target="_blank"
                           style="font-size: 10.5px; background: #ffffff; color: #0284c7; border: 1px solid #7dd3fc; padding: 3px 8px; border-radius: 5px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                           👁️ Ver PDF Políticas
                        </a>
                    </div>
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; background: #ffffff; border: 1px solid ${autoCheckPoliticas ? '#34d399' : '#bae6fd'}; border-radius: 6px; cursor: pointer; margin: 0;">
                        <input type="checkbox" id="swal-chk-adjuntar-politicas-pdf" ${autoCheckPoliticas ? 'checked' : ''} style="margin-top: 2px; width: 15px; height: 15px; accent-color: #0284c7; cursor: pointer;">
                        <div style="flex: 1; font-size: 11px; line-height: 1.35;">
                            <div style="font-weight: 700; color: #0f172a;">
                                📘 Adjuntar PDF: "Políticas y Beneficio de Financiación LAMDA" (con ejemplo práctico de su cuenta)
                            </div>
                            <div style="color: #475569; margin-top: 2px;">
                                ${finBonificadaReciente > 0
                                    ? `Explica las 4 etapas (0% hasta 7 días, +3 días gracia, comodines hasta 14 días, eCheq sin costo) e informa que hoy se bonificó el 100% dejando la cuenta en $0,00 para aplicarse desde próximas órdenes.`
                                    : `Explica las 4 etapas de financiación (0% hasta 7 días, +3 días gracia, comodines hasta 14 días, eCheq sin costo) y el ejemplo práctico de la cuenta.`}
                            </div>
                        </div>
                    </label>
                </div>
                ` : ''}
                
                <!-- Sección WhatsApp -->
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #16a34a; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                        \ud83d\udcf1 Enviar por WhatsApp
                    </h4>
        `;

        if (contacts.length === 0) {
            htmlContent += `
                <p style="font-size: 11px; color: #94a3b8; margin: 0 0 6px 0;">No hay contactos de WhatsApp configurados.</p>
            `;
        } else {
            htmlContent += `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 110px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: white;">
            `;

            contacts.forEach((c, index) => {
                let isChecked = false;
                if (savedConfig && savedConfig.selectedWps) {
                    isChecked = savedConfig.selectedWps.includes(c.numero);
                } else {
                    isChecked = c.default_resumen === true;
                }

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
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px; border: 1px solid #f1f5f9; border-radius: 4px; background: #fafafa; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-comp-contacto-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 14px; height: 14px; accent-color: #25d366;">
                        <div style="flex: 1; font-size: 11px;">
                            <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="color: #6b7280;">\u260e ${displayNum}</div>
                        </div>
                    </label>
                `;
            });

            htmlContent += `</div>`;
        }

        const savedCustomPhone = (savedConfig && savedConfig.customPhone) ? savedConfig.customPhone : '';

        htmlContent += `
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 3px;">Otro n\u00famero:</label>
                        <input type="text" id="swal-comp-custom-phone" placeholder="Ej: 2216615746" value="${savedCustomPhone}" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Sección Correo Electrónico -->
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #2563eb; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                        \u2709 Enviar por Correo Electrónico
                    </h4>
        `;

        if (emails.length === 0) {
            htmlContent += `
                <p style="font-size: 11px; color: #94a3b8; margin: 0 0 6px 0;">No hay contactos de email configurados.</p>
            `;
        } else {
            htmlContent += `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 110px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: white;">
            `;

            emails.forEach((e, index) => {
                let isChecked = false;
                if (savedConfig && savedConfig.selectedEmails) {
                    isChecked = savedConfig.selectedEmails.includes(e.email);
                } else {
                    isChecked = e.default_factura === true;
                }

                const labelText = e.nombre 
                    ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase; margin-left: 4px;">${e.cargo}</span>` : ''}`
                    : `Email #${index + 1}`;

                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px; border: 1px solid #f1f5f9; border-radius: 4px; background: #fafafa; cursor: pointer; transition: background 0.2s; margin-bottom: 0;">
                        <input type="checkbox" class="swal-comp-contacto-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; cursor: pointer; width: 14px; height: 14px; accent-color: #2563eb;">
                        <div style="flex: 1; font-size: 11px;">
                            <div style="color: #1f2937; margin-bottom: 1px;">${labelText}</div>
                            <div style="color: #6b7280; word-break: break-all;">@ ${e.email}</div>
                        </div>
                    </label>
                `;
            });

            htmlContent += `</div>`;
        }

        const savedCustomEmail = (savedConfig && savedConfig.customEmail) ? savedConfig.customEmail : '';

        htmlContent += `
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 3px;">Otro correo:</label>
                        <input type="text" id="swal-comp-custom-email" placeholder="Ej: administracion@cliente.com" value="${savedCustomEmail}" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Cuerpo del mensaje -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label style="font-size: 11.5px; font-weight: 600; color: #374151;">Cuerpo del Mensaje (Editable):</label>
                        <button type="button" id="btn-reset-cc-mensaje" style="background: none; border: none; color: #4f46e5; font-size: 10.5px; font-weight: 600; cursor: pointer; text-decoration: underline;">
                            🔄 Regenerar Mensaje Dinámico
                        </button>
                    </div>
                    <textarea id="swal-comp-mensaje" style="width: 100%; height: 85px; padding: 6px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 11.5px; box-sizing: border-box; resize: vertical; font-family: inherit; line-height: 1.4;"></textarea>
                </div>

                <!-- Botón de guardar configuración -->
                <button type="button" id="btn-save-cc-config" style="width: 100%; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 6px; padding: 7px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 5px;">
                    💾 Guardar Preferencias de Contacto
                </button>
            </div>
        `;

        const nroCompStr = mov.numero_comprobante || (isPagoEmitido ? `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}` : `REC-PAGO-${String(mov.id).padStart(8, '0')}`);

        const construirMensajeDinamico = (incluirPoliticas = false) => {
            if (isPagoEmitido) {
                return `Te adjunto en PDF el comprobante de transferencia (${nroCompStr}).\n\n${saldoStatusText}\nCualquier duda avisame!`;
            } else if (!isFactura) {
                if (incluirPoliticas) {
                    if (currentAccountBalance >= -0.01 && currentAccountBalance <= 0.01 && finBonificadaReciente > 0) {
                        return `Hola! Te adjuntamos en PDF el recibo de pago (${nroCompStr}). ${saldoStatusText}\n\nAdemás, adjuntamos las Políticas y Beneficios de Financiación de tu cuenta LAMDA (con el detalle del cargo de financiación bonificado al 100% en esta operación y su vigencia para próximas órdenes). ¡Muchas gracias!`;
                    }
                    return `Hola! Te adjuntamos en PDF el recibo de pago (${nroCompStr}). ${saldoStatusText}\n\nAdemás, adjuntamos las Políticas y Beneficios de Financiación de tu cuenta LAMDA. ¡Muchas gracias!`;
                }
                return `Te adjunto en PDF el recibo de pago (${nroCompStr}). Muchas gracias!\n\n${saldoStatusText}`;
            } else {
                return `Te adjunto en PDF el comprobante (${nroCompStr}) de tu cuenta corriente.\n${saldoStatusText}\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
            }
        };

        const defaultMessage = construirMensajeDinamico(autoCheckPoliticas);

        const { value: modalResult } = await Swal.fire({
            title: 'Enviar Comprobante',
            html: htmlContent,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '📤 Enviar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#6b21a8',
            cancelButtonColor: '#6b7280',
            didOpen: () => {
                const textarea = document.getElementById('swal-comp-mensaje');
                const chkPoliticas = document.getElementById('swal-chk-adjuntar-politicas-pdf');
                if (textarea) textarea.value = defaultMessage;

                if (chkPoliticas && textarea) {
                    chkPoliticas.addEventListener('change', () => {
                        textarea.value = construirMensajeDinamico(chkPoliticas.checked);
                    });
                }

                const btnReset = document.getElementById('btn-reset-cc-mensaje');
                if (btnReset && textarea) {
                    btnReset.addEventListener('click', () => {
                        const incPol = chkPoliticas ? chkPoliticas.checked : false;
                        textarea.value = construirMensajeDinamico(incPol);
                        console.log('🛡️ [VIGÍA DEPURADOR] Mensaje dinámico regenerado en caliente.');
                    });
                }

                const btnSave = document.getElementById('btn-save-cc-config');
                if (btnSave) {
                    btnSave.addEventListener('click', () => {
                        const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
                        const selectedEmails = Array.from(document.querySelectorAll('.swal-comp-contacto-email-chk:checked')).map(el => el.value);
                        const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();
                        const customEmail = document.getElementById('swal-comp-custom-email').value.trim();

                        const config = {
                            selectedWps,
                            selectedEmails,
                            customPhone,
                            customEmail
                        };

                        localStorage.setItem(configKey, JSON.stringify(config));

                        const originalText = btnSave.innerHTML;
                        btnSave.innerHTML = '✓ ¡Preferencias guardadas!';
                        btnSave.style.backgroundColor = '#dcfce7';
                        btnSave.style.color = '#15803d';
                        btnSave.style.borderColor = '#86efac';

                        setTimeout(() => {
                            btnSave.innerHTML = originalText;
                            btnSave.style.backgroundColor = '';
                            btnSave.style.color = '';
                            btnSave.style.borderColor = '';
                        }, 2500);
                    });
                }
            },
            preConfirm: () => {
                const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
                const selectedEmails = Array.from(document.querySelectorAll('.swal-comp-contacto-email-chk:checked')).map(el => el.value);
                const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();
                const customEmail = document.getElementById('swal-comp-custom-email').value.trim();
                const mensajeTexto = document.getElementById('swal-comp-mensaje').value;
                const chkPoliticas = document.getElementById('swal-chk-adjuntar-politicas-pdf');
                const adjuntarPoliticas = chkPoliticas ? chkPoliticas.checked : false;

                const wps = [...selectedWps];
                if (customPhone) {
                    customPhone.split(',').forEach(p => {
                        const clean = p.replace(/[^\d]/g, '');
                        if (clean) wps.push(clean);
                    });
                }

                const mails = [...selectedEmails];
                if (customEmail) {
                    customEmail.split(',').forEach(m => {
                        const clean = m.trim();
                        if (clean && clean.includes('@')) mails.push(clean);
                    });
                }

                if (wps.length === 0 && mails.length === 0) {
                    Swal.showValidationMessage('Debe seleccionar al menos un destinatario (WhatsApp o Correo).');
                    return false;
                }

                return { wps, mails, mensajeTexto, adjuntarPoliticas };
            }
        });

        if (modalResult) {
            const { wps, mails, mensajeTexto, adjuntarPoliticas } = modalResult;
            const promises = [];

            if (wps.length > 0) {
                promises.push(ejecutarEnvioComprobanteWp(mov, wps, mensajeTexto, adjuntarPoliticas));
            }

            if (mails.length > 0) {
                promises.push(ejecutarEnvioComprobanteEmail(mov, mails, mensajeTexto, adjuntarPoliticas));
            }

            if (promises.length > 0) {
                Swal.fire({
                    title: 'Enviando Comprobante...',
                    text: 'Por favor, espere mientras se despacha el documento.',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                Promise.all(promises)
                    .then(() => {
                        Swal.fire({
                            icon: 'success',
                            title: 'Enviado con Éxito',
                            text: adjuntarPoliticas
                                ? 'El comprobante y el PDF de Políticas y Beneficios de Financiación han sido enviados correctamente.'
                                : 'El comprobante ha sido enviado correctamente.',
                            confirmButtonColor: '#6b21a8'
                        });
                    })
                    .catch(error => {
                        console.error('Error al enviar:', error);
                        Swal.fire({
                            icon: 'error',
                            title: 'Error de Envío',
                            text: error.message || 'No se pudo enviar el comprobante.',
                            confirmButtonColor: '#6b21a8'
                        });
                    });
            }
        }
    }

    async function ejecutarEnvioComprobanteWp(mov, wps, mensajeTexto, adjuntarPoliticas = false) {
        const currentAccountBalance = (typeof cuentaSeleccionada !== 'undefined' && cuentaSeleccionada && (cuentaSeleccionada.saldo !== undefined || cuentaSeleccionada.saldo_actual !== undefined))
            ? parseFloat(cuentaSeleccionada.saldo ?? cuentaSeleccionada.saldo_actual)
            : parseFloat(mov.saldo_resultante) || 0;
        const documentosAdjuntos = adjuntarPoliticas ? ['recibo', 'politicas_financiacion'] : ['recibo'];

        console.group('🛡️ [VIGÍA DEPURADOR - CC COMPROBANTE WHATSAPP]');
        console.log('👤 Cliente:', {
            codigo_bunker: cliente ? cliente.codigo_bunker_cliente : 'N/D',
            nombre: cliente ? cliente.cliente_nombre : 'N/D'
        });
        console.log('📄 Movimiento Seleccionado:', {
            id: mov.id,
            numero_comprobante: mov.numero_comprobante || `REC-PAGO-${String(mov.id).padStart(8, '0')}`,
            tipo_comprobante: mov.tipo_comprobante,
            tipo_movimiento: mov.tipo_movimiento,
            monto: mov.monto,
            saldo_resultante: mov.saldo_resultante
        });
        console.log('💳 Saldo Consolidado Actual de Cuenta Corriente:', currentAccountBalance);
        console.log('📱 Destinatarios WhatsApp:', wps);
        console.log('💬 Mensaje Texto Enviado (Body):', mensajeTexto);
        console.log('📎 Documentos Adjuntos:', documentosAdjuntos);
        console.groupEnd();

        const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${mov.id}/whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: wps.join(', '),
                mensajeTexto: mensajeTexto,
                documentos_adjuntos: documentosAdjuntos,
                adjuntarPoliticasPdf: adjuntarPoliticas
            })
        });

        const data = await response.json();

        console.group('🛡️ [VIGÍA DEPURADOR - RESPUESTA SERVIDOR WHATSAPP]');
        console.log('HTTP Status:', response.status);
        console.log('Payload Respuesta:', data);
        console.groupEnd();

        if (!response.ok || !data.success) {
            throw new Error(data.message || data.error || 'Error al enviar por WhatsApp.');
        }
        return data;
    }

    async function ejecutarEnvioComprobanteEmail(mov, mails, mensajeTexto, adjuntarPoliticas = false) {
        const documentosAdjuntos = adjuntarPoliticas ? ['recibo', 'politicas_financiacion'] : ['recibo'];
        console.group('🛡️ [VIGÍA DEPURADOR - CC COMPROBANTE EMAIL]');
        console.log('👤 Cliente:', cliente ? cliente.codigo_bunker_cliente : 'N/D');
        console.log('✉️ Destinatarios Correo:', mails);
        console.log('💬 Mensaje Texto Enviado (Body):', mensajeTexto);
        console.log('📎 Documentos Adjuntos:', documentosAdjuntos);
        console.groupEnd();

        const response = await fetch(`/api/logistica/bunker/cuentas-corrientes/movimientos/${mov.id}/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: mails.join(', '),
                mensajeTexto: mensajeTexto,
                documentos_adjuntos: documentosAdjuntos,
                adjuntarPoliticasPdf: adjuntarPoliticas
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || data.error || 'Error al enviar por Correo Electrónico.');
        }
        return data;
    }

    // --- LÓGICA DE SELECCIÓN MÚLTIPLE Y ENVÍO AGRUPADO POR WHATSAPP ---
    function actualizarBarraSeleccionMovimientos() {
        const btnSendGroup = document.getElementById('btn-enviar-seleccionados-wp');
        const lblCount = document.getElementById('lbl-cant-seleccionados');
        const chks = document.querySelectorAll('.chk-mov-select');

        const selected = Array.from(chks).filter(c => c.checked);
        if (lblCount) lblCount.textContent = selected.length;

        if (btnSendGroup) {
            if (selected.length > 0) {
                btnSendGroup.style.display = 'inline-flex';
            } else {
                btnSendGroup.style.display = 'none';
            }
        }
    }

    // Escuchar Select All
    const chkSelectAll = document.getElementById('chk-select-all-movs');
    if (chkSelectAll) {
        chkSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.chk-mov-select').forEach(chk => {
                chk.checked = isChecked;
            });
            actualizarBarraSeleccionMovimientos();
        });
    }

    // Escuchar clic en botón de enviar agrupados
    const btnEnviarGroup = document.getElementById('btn-enviar-seleccionados-wp');
    if (btnEnviarGroup) {
        btnEnviarGroup.addEventListener('click', () => {
            enviarComprobantesAgrupadosPorWhatsApp();
        });
    }

    async function enviarComprobantesAgrupadosPorWhatsApp() {
        if (!cliente) return;

        const selectedChks = Array.from(document.querySelectorAll('.chk-mov-select:checked'));
        if (selectedChks.length === 0) {
            Swal.fire('Atención', 'Seleccione al menos un movimiento para enviar.', 'warning');
            return;
        }

        const selectedIds = selectedChks.map(c => c.getAttribute('data-id'));
        const selectedMovs = (window.currentMovimientos || []).filter(m => selectedIds.includes(String(m.id)));

        if (selectedMovs.length === 0) {
            Swal.fire('Error', 'No se pudieron recuperar los movimientos seleccionados.', 'error');
            return;
        }

        // Clasificadores de tipos de movimientos
        const esNC = (m) => ['NOTA_CREDITO', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B'].includes(m.tipo_comprobante) || (m.descripcion && /nota de cr[eé]dito/i.test(m.descripcion));
        const esFactura = (m) => (['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'PENDIENTE_FACTURACION', 'PRESUPUESTO'].includes(m.tipo_comprobante) || (m.descripcion && /factura|fac /i.test(m.descripcion))) && !esNC(m);
        const esPago = (m) => ['RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE', 'AJUSTE_MANUAL', 'AJUSTE_AUTOMATICO'].includes(m.tipo_comprobante) && !m.comprobante_id;

        // Clasificar y calcular subtotales
        let cantFacturas = 0;
        let cantNC = 0;
        let cantPagos = 0;
        let cantOtros = 0;
        let totalDebitos = 0;
        let totalCreditos = 0;

        selectedMovs.forEach((m) => {
            const mVal = parseFloat(m.monto) || 0;
            const esDeb = m.tipo_movimiento === 'DEBITO';
            if (esDeb) {
                totalDebitos += mVal;
            } else {
                totalCreditos += mVal;
            }

            if (esFactura(m)) cantFacturas++;
            else if (esNC(m)) cantNC++;
            else if (esPago(m)) cantPagos++;
            else cantOtros++;
        });

        // Saldo consolidado actual de la cuenta
        const saldoCC = parseFloat((cuentaSeleccionada && (cuentaSeleccionada.saldo !== undefined || cuentaSeleccionada.saldo_actual !== undefined)) 
            ? (cuentaSeleccionada.saldo ?? cuentaSeleccionada.saldo_actual) 
            : (selectedMovs[0] ? selectedMovs[0].saldo_resultante : 0)) || 0;
        const saldoFmt = formatCurrency(Math.abs(saldoCC));

        let saldoEstado = '';
        if (Math.abs(saldoCC) <= 0.01) {
            saldoEstado = `*${formatCurrency(0)} (Cuenta al día / Sin deuda)*`;
        } else if (saldoCC < -0.01) {
            saldoEstado = `*${saldoFmt} (Saldo a favor)*`;
        } else {
            saldoEstado = `*${saldoFmt} (Saldo pendiente)*`;
        }

        // Generador de mensaje corto según los comprobantes seleccionados (el detalle grueso va dentro del PDF)
        const construirMensajeDinamicoMulti = () => {
            let tipoDocTxt = 'los comprobantes correspondientes a tu cuenta corriente';
            if (cantFacturas > 0 && cantNC > 0 && cantPagos === 0 && cantOtros === 0) {
                tipoDocTxt = 'la factura y nota de crédito de tu cuenta corriente';
            } else if (cantFacturas > 0 && cantNC === 0 && cantPagos === 0 && cantOtros === 0) {
                tipoDocTxt = selectedMovs.length === 1
                    ? 'la factura correspondiente a tu cuenta corriente'
                    : 'las facturas correspondientes a tu cuenta corriente';
            } else if (cantNC > 0 && cantFacturas === 0 && cantPagos === 0 && cantOtros === 0) {
                tipoDocTxt = selectedMovs.length === 1
                    ? 'la nota de crédito de tu cuenta corriente'
                    : 'las notas de crédito de tu cuenta corriente';
            } else if (cantPagos > 0 && cantFacturas === 0 && cantNC === 0 && cantOtros === 0) {
                tipoDocTxt = selectedMovs.length === 1
                    ? 'el comprobante de pago de tu cuenta corriente'
                    : 'los comprobantes de pago de tu cuenta corriente';
            }

            if (cantPagos > 0 && cantFacturas === 0 && cantNC === 0) {
                return `Te adjunto en PDF ${tipoDocTxt}. Muchas gracias!`;
            }
            return `Te adjunto en PDF ${tipoDocTxt}.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
        };

        const defaultMessage = construirMensajeDinamicoMulti();

        const configKey = `cc_envio_comprobante_config_${cliente.codigo_bunker_cliente}`;
        let savedConfig = null;
        try {
            const raw = localStorage.getItem(configKey);
            if (raw) savedConfig = JSON.parse(raw);
        } catch(e) {}

        let contacts = [];
        const rawWp = (cliente.whatsapp_facturas || '').trim();
        if (rawWp.startsWith('[')) {
            try { contacts = JSON.parse(rawWp); } catch(e) {}
        }
        if (!Array.isArray(contacts) || contacts.length === 0) {
            const rawPhone = (!rawWp.startsWith('[') ? rawWp : '') || cliente.celular || cliente.telefono || '';
            contacts = rawPhone.split(',').map(num => ({ numero: num.trim(), nombre: '', cargo: '', default_resumen: true })).filter(c => c.numero);
        }
        contacts = contacts.map(c => ({
            numero: c.numero ? c.numero.replace(/\D/g, '') : '',
            nombre: c.nombre || '',
            cargo: c.cargo || '',
            default_resumen: c.default_resumen === true || c.default === true
        })).filter(c => c.numero.length > 0);

        // Armar subtotales del banner
        let resumenTotales = '';
        if (totalDebitos > 0 && totalCreditos > 0) {
            resumenTotales = `Débitos: <strong>+${formatCurrency(totalDebitos)}</strong> | Créditos: <strong>-${formatCurrency(totalCreditos)}</strong>`;
        } else if (totalDebitos > 0) {
            resumenTotales = `Total Facturado: <strong>${formatCurrency(totalDebitos)}</strong>`;
        } else {
            resumenTotales = `Total: <strong>${formatCurrency(totalCreditos)}</strong>`;
        }

        let tipoTitulo = 'Comprobantes';
        if (cantFacturas > 0 && cantNC > 0 && cantPagos === 0) tipoTitulo = 'Facturas y Notas de Crédito';
        else if (cantFacturas > 0 && cantNC === 0 && cantPagos === 0) tipoTitulo = 'Facturas';
        else if (cantNC > 0 && cantFacturas === 0 && cantPagos === 0) tipoTitulo = 'Notas de Crédito';
        else if (cantPagos > 0 && cantFacturas === 0 && cantNC === 0) tipoTitulo = 'Comprobantes de Pago';

        let htmlContent = `
            <div style="text-align: left; font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; gap: 14px;">
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; font-size: 12px; color: #166534;">
                    <strong>✨ ${selectedMovs.length} ${tipoTitulo} Seleccionado(s):</strong> ${resumenTotales}
                </div>
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #16a34a; font-weight: 600;">📱 Enviar por WhatsApp</h4>
        `;

        if (contacts.length === 0) {
            htmlContent += `<p style="font-size: 11px; color: #94a3b8; margin: 0 0 6px 0;">No hay contactos de WhatsApp configurados.</p>`;
        } else {
            htmlContent += `<div style="display: flex; flex-direction: column; gap: 6px; max-height: 110px; overflow-y: auto; padding: 2px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: white;">`;
            contacts.forEach((c, index) => {
                let isChecked = savedConfig && savedConfig.selectedWps ? savedConfig.selectedWps.includes(c.numero) : c.default_resumen === true;
                htmlContent += `
                    <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px; border: 1px solid #f1f5f9; border-radius: 4px; background: #fafafa; cursor: pointer; margin-bottom: 0;">
                        <input type="checkbox" class="swal-comp-contacto-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; width: 14px; height: 14px; accent-color: #25d366;">
                        <div style="flex: 1; font-size: 11px;">
                            <div><strong>${c.nombre || `Contacto #${index + 1}`}</strong></div>
                            <div style="color: #6b7280;">📞 ${c.numero}</div>
                        </div>
                    </label>
                `;
            });
            htmlContent += `</div>`;
        }

        const savedCustomPhone = (savedConfig && savedConfig.customPhone) ? savedConfig.customPhone : '';
        htmlContent += `
                    <div>
                        <label style="font-size: 11px; font-weight: 600; color: #6b7280;">Otro número:</label>
                        <input type="text" id="swal-comp-custom-phone" placeholder="Ej: 2216615746" value="${savedCustomPhone}" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
                    </div>
                </div>

                <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f9fafb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; font-size: 13px; color: #4f46e5; font-weight: 600;">📝 Mensaje de WhatsApp (Editable)</h4>
                        <button type="button" id="btn-reset-multi-mensaje" style="background: none; border: none; color: #4f46e5; font-size: 11px; font-weight: 600; cursor: pointer; text-decoration: underline;">
                            🔄 Regenerar Mensaje Dinámico
                        </button>
                    </div>
                    <textarea id="swal-comp-mensaje" rows="8" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 11.5px; font-family: monospace; box-sizing: border-box; resize: vertical; background: white; line-height: 1.4;"></textarea>
                    <button type="button" id="btn-save-cc-config-group" style="width: 100%; margin-top: 8px; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 6px; padding: 7px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;">
                        💾 Guardar esta configuración para futuros envíos
                    </button>
                </div>
            </div>
        `;

        const { value: modalResult } = await Swal.fire({
            title: `Enviar ${selectedMovs.length} Comprobantes Seleccionados`,
            html: htmlContent,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '🚀 Enviar Todos por WhatsApp',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#6b7280',
            didOpen: () => {
                const textarea = document.getElementById('swal-comp-mensaje');
                if (textarea) textarea.value = defaultMessage;

                const btnReset = document.getElementById('btn-reset-multi-mensaje');
                if (btnReset && textarea) {
                    btnReset.addEventListener('click', () => {
                        textarea.value = construirMensajeDinamicoMulti();
                    });
                }

                const btnSave = document.getElementById('btn-save-cc-config-group');
                if (btnSave) {
                    btnSave.addEventListener('click', () => {
                        const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
                        const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();
                        const mensajeTexto = document.getElementById('swal-comp-mensaje').value;

                        const config = { selectedWps, customPhone, mensajeTexto };
                        localStorage.setItem(configKey, JSON.stringify(config));

                        const originalText = btnSave.innerHTML;
                        btnSave.innerHTML = '✓ ¡Configuración guardada!';
                        btnSave.style.backgroundColor = '#dcfce7';
                        btnSave.style.color = '#15803d';

                        setTimeout(() => {
                            btnSave.innerHTML = originalText;
                            btnSave.style.backgroundColor = '';
                            btnSave.style.color = '';
                        }, 2500);
                    });
                }
            },
            preConfirm: () => {
                const selectedWps = Array.from(document.querySelectorAll('.swal-comp-contacto-wp-chk:checked')).map(el => el.value);
                const customPhone = document.getElementById('swal-comp-custom-phone').value.trim();
                const mensajeTexto = document.getElementById('swal-comp-mensaje').value;

                const wps = [...selectedWps];
                if (customPhone) {
                    customPhone.split(',').forEach(p => {
                        const clean = p.replace(/[^\d]/g, '');
                        if (clean) wps.push(clean);
                    });
                }

                if (wps.length === 0) {
                    Swal.showValidationMessage('Debe seleccionar al menos un número de WhatsApp.');
                    return false;
                }

                return { wps, mensajeTexto };
            }
        });

        if (modalResult) {
            const { wps, mensajeTexto } = modalResult;
            Swal.fire({
                title: 'Enviando Comprobantes Agrupados...',
                text: `Por favor espere mientras se despachan los ${selectedIds.length} comprobantes.`,
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                const response = await fetch('/api/logistica/bunker/cuentas-corrientes/movimientos/whatsapp-multi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        movimientoIds: selectedIds,
                        destinatarios: wps.join(', '),
                        mensajeTexto: mensajeTexto
                    })
                });

                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || data.error || 'Falla al enviar comprobantes agrupados.');
                }

                Swal.fire({
                    icon: 'success',
                    title: '¡Enviados con Éxito!',
                    text: `Los ${selectedIds.length} comprobantes han sido enviados correctamente por WhatsApp.`,
                    confirmButtonColor: '#16a34a'
                });
            } catch (err) {
                console.error('Error al enviar agrupados:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Envío',
                    text: err.message || 'No se pudieron enviar los comprobantes agrupados.',
                    confirmButtonColor: '#dc2626'
                });
            }
        }
    }

// Modal de Previsualización Interactivo de Recibo de Pago (RC) o Ajuste
    window.mostrarModalRecibo = (id) => {
        const mov = window.currentMovimientos ? window.currentMovimientos.find(m => m.id === id) : null;
        if (!mov) {
            Swal.fire('Error', 'No se encontró el movimiento.', 'error');
            return;
        }

        const isDebe = mov.tipo_movimiento === 'DEBITO';
        const montoDisplay = formatCurrency(parseFloat(mov.monto));
        
        const isPagoEmitido = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
        const tipoLabel = mov.tipo_comprobante === 'RECIBO_PAGO' ? 'Recibo de Pago' :
                          mov.tipo_comprobante === 'COBRO_BANCARIO' ? 'Cobro Bancario' :
                          mov.tipo_comprobante === 'COBRO_CHEQUE' ? 'Cobro con Cheque' :
                          isPagoEmitido ? 'Pago Emitido / Transferencia Bancaria' :
                          mov.tipo_comprobante === 'AJUSTE_MANUAL' ? 'Ajuste de Saldo' : 'Comprobante de Pago';
        
        // Determinar forma de cobro/pago por defecto según el tipo de comprobante
        let defaultTipo = 'Efectivo';
        if (mov.tipo_comprobante === 'COBRO_BANCARIO' || isPagoEmitido) defaultTipo = 'Transferencia Bancaria (Banco Galicia)';
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
            title: `<span style="color: ${isPagoEmitido ? '#991b1b' : '#8e4785'}; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">${isPagoEmitido ? 'Detalle de Comprobante de Pago' : 'Detalle de Comprobante'}</span>`,
            html: `
                <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
                    <div style="background: ${isPagoEmitido ? '#991b1b' : 'hsl(185, 68%, 20%)'}; color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${isPagoEmitido ? 'COMPROBANTE DE PAGO' : tipoLabel}</div>
                        <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${mov.numero_comprobante || (isPagoEmitido ? `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}` : `REC-PAGO-${String(mov.id).padStart(8, '0')}`)}</div>
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
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">${isPagoEmitido ? 'Monto Transferido (Pago)' : 'Monto Recibido'}</span>
                            <span style="font-size: 1.4rem; font-weight: 750; color: ${isPagoEmitido ? '#b91c1c' : '#16a34a'}">${isPagoEmitido ? '- ' : ''}${montoDisplay}</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo de Cuenta</span>
                            <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(parseFloat((typeof cuentaSeleccionada !== 'undefined' && cuentaSeleccionada && (cuentaSeleccionada.saldo !== undefined || cuentaSeleccionada.saldo_actual !== undefined)) ? (cuentaSeleccionada.saldo ?? cuentaSeleccionada.saldo_actual) : mov.saldo_resultante))}</span>
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
                        <button id="btn-swal-download" class="swal-action-button dl-btn" style="display: flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.65rem 0.5rem; border-radius: 6px; border: none; background: ${isPagoEmitido ? '#991b1b' : '#8e4785'}; color: white; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
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
                        enviarComprobantePorWhatsApp(mov);
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
                        link.download = isPagoEmitido ? `comprobante-pago-${mov.id}.pdf` : `recibo-${mov.id}.pdf`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    });
                }
            }
        });
    };

    // Modal de Ticket / Comprobante de Liquidación de Horas en Depósito
    window.mostrarModalJornadaCredito = (id) => {
        const mov = window.currentMovimientos ? window.currentMovimientos.find(m => m.id === id) : null;
        if (!mov) {
            Swal.fire('Error', 'No se encontró el movimiento.', 'error');
            return;
        }

        const montoDisplay = formatCurrency(parseFloat(mov.monto));
        let meta = {};
        if (mov.metadatos) {
            try {
                meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
            } catch(e) {}
        }

        const horasTexto = meta.horas_totales ? `${meta.horas_totales} hs` : 'Liquidación de horas';
        const colaboradorNombre = meta.colaborador || (cliente ? cliente.razon_social : 'Colaborador');
        const jornadasIds = Array.isArray(meta.jornadas_ids) ? meta.jornadas_ids.map(j => `#${j}`).join(', ') : '-';

        Swal.fire({
            title: `<span style="color: #7e22ce; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Ticket de Liquidación de Horas</span>`,
            html: `
                <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
                    <div style="background: #7e22ce; color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Comprobante de Horas en Depósito</div>
                        <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">LIQ-HORAS-${String(mov.id).padStart(6, '0')}</div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA DE LIQUIDACIÓN</span>
                            <strong style="color: #1e293b;">${new Date(mov.fecha_movimiento).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                        </div>
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">COLABORADOR / CLIENTE</span>
                            <strong style="color: #1e293b;">${colaboradorNombre}</strong>
                        </div>
                    </div>

                    <div style="background: #fdf4ff; border-radius: 6px; padding: 0.75rem 0.85rem; font-size: 0.85rem; color: #581c87; border: 1px solid #f0abfc; margin-bottom: 1.25rem; text-align: left;">
                        <div style="font-weight: 700; color: #7e22ce; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Detalle del Desempeño</div>
                        <div><span style="font-weight: 600;">Concepto:</span> ${mov.descripcion}</div>
                        ${meta.horas_totales ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Tiempo Liquidado:</span> ${horasTexto}</div>` : ''}
                        ${jornadasIds !== '-' ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Jornadas enlazadas:</span> ${jornadasIds}</div>` : ''}
                    </div>

                    <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Monto Acreditado (Haber)</span>
                            <span style="font-size: 1.4rem; font-weight: 750; color: #16a34a">${montoDisplay}</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo Resultante CC</span>
                            <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(parseFloat(mov.saldo_resultante))}</span>
                        </div>
                    </div>

                    <div style="text-align: center;">
                        <a href="/pages/colaboradores-jornadas.html" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; background: #f3e8ff; color: #7e22ce; font-weight: 600; font-size: 0.85rem; text-decoration: none; border: 1px solid #d8b4fe;">
                            ⏱️ Abrir Gestión de Horarios y Jornadas
                        </a>
                    </div>
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#7e22ce'
        });
    };

    // Modal de Ticket / Comprobante de Rendimiento de Carro Externo
    window.mostrarModalRendimientoCredito = (id) => {
        const mov = window.currentMovimientos ? window.currentMovimientos.find(m => m.id === id) : null;
        if (!mov) {
            Swal.fire('Error', 'No se encontró el movimiento.', 'error');
            return;
        }

        const montoDisplay = formatCurrency(parseFloat(mov.monto));
        let meta = {};
        if (mov.metadatos) {
            try {
                meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
            } catch(e) {}
        }

        // Extraer datos ya sea de metadatos o por regex de la descripción
        let nroCarro = meta.carro_id || null;
        let detalleProduccion = null;
        let articuloNombre = meta.articulo_nombre || null;
        if (meta.cantidad && meta.unidad_medida && meta.articulo_codigo) {
            detalleProduccion = `${meta.cantidad} ${meta.unidad_medida} de ${meta.articulo_codigo}`;
        }

        if (!nroCarro || !detalleProduccion) {
            const match = (mov.descripcion || '').match(/carro externo #(\d+)(?:\s*\(([^)]+)\))?/i);
            if (match) {
                if (!nroCarro) nroCarro = match[1];
                if (!detalleProduccion && match[2]) detalleProduccion = match[2];
            }
        }

        const productorNombre = meta.colaborador || (cliente ? cliente.razon_social : 'Productor Externo');
        const tarifaDetalle = meta.tarifa_unitaria ? `$${meta.tarifa_unitaria.toLocaleString('es-AR')}/${meta.unidad_medida || 'un'}` : null;

        Swal.fire({
            title: `<span style="color: #047857; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.35rem;">Ticket de Rendimiento Externo</span>`,
            html: `
                <div style="text-align: left; font-family: 'Inter', sans-serif; color: #1e293b; padding: 0.25rem;">
                    <div style="background: #047857; color: white; padding: 1.15rem; border-radius: 8px; margin-bottom: 1.25rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Liquidación de Carro Externo</div>
                        <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">LIQ-REND-${String(mov.id).padStart(6, '0')}</div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">FECHA LIQUIDACIÓN</span>
                            <strong style="color: #1e293b;">${new Date(mov.fecha_movimiento).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                        </div>
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.15rem;">PRODUCTOR / CLIENTE</span>
                            <strong style="color: #1e293b;">${productorNombre}</strong>
                        </div>
                    </div>

                    <div style="background: #ecfdf5; border-radius: 6px; padding: 0.75rem 0.85rem; font-size: 0.85rem; color: #065f46; border: 1px solid #a7f3d0; margin-bottom: 1.25rem; text-align: left;">
                        <div style="font-weight: 700; color: #047857; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Información del Lote / Carro</div>
                        <div><span style="font-weight: 600;">Concepto:</span> ${mov.descripcion}</div>
                        ${nroCarro ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Carro de Producción:</span> <strong>#${nroCarro}</strong></div>` : ''}
                        ${articuloNombre ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Producto Elaborado:</span> <strong style="color: #047857;">${articuloNombre}</strong></div>` : ''}
                        ${detalleProduccion ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Rendimiento Obtenido:</span> <strong>${detalleProduccion}</strong></div>` : ''}
                        ${tarifaDetalle ? `<div style="margin-top: 4px;"><span style="font-weight: 600;">Tarifa Aplicada:</span> ${tarifaDetalle}</div>` : ''}
                    </div>

                    <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 1rem 0; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Monto Acreditado (Haber)</span>
                            <span style="font-size: 1.4rem; font-weight: 750; color: #16a34a">${montoDisplay}</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: #64748b; display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 0.25rem;">Saldo Resultante CC</span>
                            <span style="font-size: 1.1rem; font-weight: 700; color: #1e293b">${formatCurrency(parseFloat(mov.saldo_resultante))}</span>
                        </div>
                    </div>

                    <div style="text-align: center;">
                        <a href="/pages/pizarra-produccion.html" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; background: #ecfdf5; color: #047857; font-weight: 600; font-size: 0.85rem; text-decoration: none; border: 1px solid #a7f3d0;">
                            🏭 Abrir Pizarra de Producción
                        </a>
                    </div>
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#047857'
        });
    };

    // --- APERTURA DE CUENTA: EDITAR SALDO INICIAL ---
    async function abrirModalAjustarApertura() {
        if (!cuentaSeleccionada) {
            Swal.fire('Error', 'Seleccione una cuenta corriente primero.', 'error');
            return;
        }
        
        const saldoActualApertura = parseFloat(cuentaSeleccionada.saldo_apertura) || 0;
        
        const { value: nuevoSaldo } = await Swal.fire({
            title: '🔑 Ajustar Saldo de Apertura',
            html: `
                <div style="text-align: left; font-family: 'Inter', sans-serif;">
                    <p style="font-size: 0.9em; color: #475569; margin-bottom: 12px; line-height: 1.4;">
                        Establezca el saldo inicial con el que comienza la cuenta corriente. Todos los saldos acumulados de los movimientos posteriores se recalcularán cronológicamente de forma automática.
                    </p>
                    <label style="display: block; font-size: 0.8em; font-weight: 600; color: #64748b; margin-bottom: 4px;">Monto Saldo Inicial ($)</label>
                    <input type="number" id="swal-saldo-apertura" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box;" step="0.01" value="${saldoActualApertura}">
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Guardar Ajuste',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            preConfirm: () => {
                const val = parseFloat(document.getElementById('swal-saldo-apertura').value);
                if (isNaN(val)) {
                    Swal.showValidationMessage('Debe ingresar un monto numérico válido');
                    return false;
                }
                return val;
            }
        });
        
        if (nuevoSaldo !== undefined) {
            try {
                Swal.fire({
                    title: 'Procesando...',
                    text: 'Recalculando la cuenta contable...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });
                
                const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/saldo-apertura`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ saldo_apertura: nuevoSaldo })
                });
                
                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.error || 'No se pudo guardar el saldo de apertura.');
                }
                
                await Swal.fire({
                    icon: 'success',
                    title: '¡Ajuste Guardado!',
                    text: 'El saldo de apertura y el historial fueron recalculados con éxito.',
                    confirmButtonColor: '#6b21a8'
                });
                
                // Recargar el cliente seleccionado para pintar los nuevos saldos
                window.location.reload();
            } catch (err) {
                console.error(err);
                Swal.fire('Error', err.message, 'error');
            }
        }
    }

    // Vincular botones de apertura
    const btnAjustarApertura = document.getElementById('btn-ajustar-apertura');
    const lnkEditarSaldoApertura = document.getElementById('lnk-editar-saldo-apertura');
    const lnkEditarSaldoAperturaBox = document.getElementById('lnk-editar-saldo-apertura-box');
    if (btnAjustarApertura) btnAjustarApertura.addEventListener('click', abrirModalAjustarApertura);
    if (lnkEditarSaldoApertura) {
        lnkEditarSaldoApertura.addEventListener('click', (e) => {
            e.preventDefault();
            abrirModalAjustarApertura();
        });
    }
    if (lnkEditarSaldoAperturaBox) {
        lnkEditarSaldoAperturaBox.addEventListener('click', (e) => {
            e.preventDefault();
            abrirModalAjustarApertura();
        });
    }

    // =========================================================================
    // ASISTENTE DE POLÍTICAS, FINANCIACIÓN Y PAGOS PARCIALES EN CUENTA CORRIENTE
    // =========================================================================
    let cachePoliticasClienteCC = null;
    let cacheSalvavidasClienteCC = null;

    async function cargarContextoPoliticasYFinanciacionCC() {
        if (!cuentaSeleccionada || !cliente) return { salvavidas: null, politicaInfo: null };
        const cod = cliente.codigo_bunker_cliente || codigoBunkerCliente || cliente.id;
        try {
            const [resSalv, resPol] = await Promise.all([
                fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/salvavidas-simulacion`).then(r => r.json()).catch(() => null),
                fetch(`http://localhost:3003/api/presupuestos/politicas/cliente/${encodeURIComponent(cod)}`).then(r => r.json()).catch(() => null)
            ]);
            if (resSalv?.ok && resSalv?.data) cacheSalvavidasClienteCC = resSalv.data;
            if (resPol?.success) cachePoliticasClienteCC = resPol;
        } catch (e) {
            console.warn('[CC-POLITICAS] Error consultando contexto:', e.message);
        }
        return { salvavidas: cacheSalvavidasClienteCC, politicaInfo: cachePoliticasClienteCC };
    }

    function construirBloquesPoliticasTextoCC(salvavidas, politicaInfo, opts = {}) {
        const reglas = salvavidas?.reglas_aplicadas || {};
        const diasV1 = Number(reglas.dias_ventana_estandar || 7);
        const diasCort = Number(reglas.dias_ventana_cortesia || 7);
        const finV2 = diasV1 + diasCort;
        const tasaMensual = Number(reglas.tasa_servicio_financiero || 3).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const tasaDiaria = Number((reglas.tasa_diaria || 0.001) * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

        const listaId = politicaInfo?.lista_id || cliente?.lista_asignada_id || null;
        const listaNombre = politicaInfo?.lista_nombre || reglas.lista_nombre || 'Mayorista LAMDA';
        const pol = politicaInfo?.politica || null;
        const tramo0 = (Array.isArray(pol?.tramos) && pol.tramos[0]) ? pol.tramos[0] : { monto_minimo: 300000, descuento_porcentaje: 5 };
        const montoMinTxt = Number(tramo0.monto_minimo || 300000).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
        const pctTxt = Number(tramo0.descuento_porcentaje || 5).toLocaleString('es-AR', { maximumFractionDigits: 1 });

        const bloques = [];
        if (opts.financiacion) {
            const diasGraciaNat = Number(reglas.dias_gracia_natural || 3);
            const topeSinComodin = diasV1 + diasGraciaNat;
            const cupoComodines = Number(reglas.cupo_cortesias_anual ?? 3);
            const comodinesDisp = Number(reglas.cortesias_disponibles_anio ?? 3);
            bloques.push(
                `🤝 *Esquema de Financiación, Gracia Natural, Comodines y Plazos LAMDA:*\n` +
                `• *🟢 Plazo Habitual (Días 1 a ${diasV1}):* Compromiso habitual del cliente desde la entrega de la mercadería (*0% de financiación*, sin uso de comodín).\n` +
                `• *⏳ +${diasGraciaNat} Días de Gracia Naturales (Días ${diasV1 + 1} a ${topeSinComodin}):* Contemplando transferencias de viernes o demoras bancarias que impactan el lunes, tenés *${diasGraciaNat} días naturales adicionales sin cargo de financiación (0%) y SIN consumir comodín*.\n` +
                `• *🎟️ Comodín Trimestral (Días ${topeSinComodin + 1} a ${finV2}):* Si una vez cada 3 meses necesitás extenderte unos días más, contás con *1 comodín por trimestre (${cupoComodines} al año; hoy tenés ${comodinesDisp}/${cupoComodines} disponibles)* que cubre hasta el *Día ${finV2} a 0% de financiación*.\n` +
                `• *🛡️ Servicio de Financiación (Día ${finV2 + 1} en adelante):* Superados los ${finV2} días (o si ya utilizaste el comodín del trimestre), se activa automáticamente el *Servicio de Financiación LAMDA al ${tasaMensual}% mensual + IVA* (${tasaDiaria}% diario + IVA computado desde el Día 1 de entrega únicamente sobre el saldo pendiente).\n` +
                `• *💸 Pagos Parciales:* Podés realizar pagos parciales en cualquier momento; cada pago descuenta capital en el acto sobre el comprobante más antiguo y reduce la financiación diaria futura, manteniendo tu *cuenta habilitada*.`
            );
        }
        if (opts.politicaLista) {
            const tituloLista = listaId ? `Lista #${listaId} (${listaNombre})` : `Lista ${listaNombre}`;
            bloques.push(
                `🏷️ *Política Comercial de tu ${tituloLista}:*\n` +
                `• Mientras utilices pagos parciales o el Servicio de Asistencia Financiera, seguís operando normalmente con los precios mayoristas de tu *${tituloLista}*.\n` +
                `• *Bonificación por Volumen (${pctTxt}% OFF):* Tu lista cuenta con un *${pctTxt}% de descuento directo* en compras superiores a *${montoMinTxt}* (neto).\n` +
                `• *Condición de Cuenta al Día (Saldo $ 0,00):* Tanto la bonificación del *${pctTxt}% por volumen* como las *ofertas promocionales especiales* se activan automáticamente cuando la cuenta corriente se encuentra al día (*Saldo $ 0,00*). Al completar los pagos parciales y quedar el saldo en cero, el sistema vuelve a habilitar todas las bonificaciones.`
            );
        }
        if (opts.mediosPago) {
            bloques.push(
                `💳 *Medios de Pago Habilitados:*\n` +
                `• 🏦 *Transferencia:* Banco Galicia | Alias: *LAMDA.SER.MARTIN* | CBU: *0070373230004007844141*\n` +
                `• 🏧 *Depósito en Efectivo 24 hs (Cajeros Galicia):* Sin sobre a la *Caja de Ahorro en Pesos N° 4007844-1 373-4* (Titular: Martin Ignacio Serrano).\n` +
                `• ✉️ *Efectivo Ensobrado:* Con el reparto o en depósito con registro asistido de arqueo.`
            );
        }
        return bloques;
    }

    window.actualizarMensajeConAnexosEnModalCC = async function () {
        const txtArea = document.getElementById('swal-mensaje-whatsapp');
        if (!txtArea) return;
        let baseMsg = decodeURIComponent(txtArea.getAttribute('data-base-msg') || '');
        const chkPortalEl = document.getElementById('swal-cc-anexo-portal');
        const chkPortal = chkPortalEl ? Boolean(chkPortalEl.checked) : true;
        const chkFin = Boolean(document.getElementById('swal-cc-anexo-financiacion')?.checked);
        const chkPol = Boolean(document.getElementById('swal-cc-anexo-politica-lista')?.checked);

        if (!chkPortal) {
            baseMsg = baseMsg
                .split('\n')
                .filter(l => !/portal\s+de\s+pedidos|https?:\/\//i.test(l))
                .join('\n')
                .trim();
        } else if (!/https?:\/\//i.test(baseMsg)) {
            const lineas = baseMsg.split('\n');
            lineas.splice(Math.max(1, lineas.length - 1), 0, 'Portal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/');
            baseMsg = lineas.join('\n');
        }

        if (!chkFin && !chkPol) {
            txtArea.value = baseMsg;
            return;
        }
        if (!cacheSalvavidasClienteCC && !cachePoliticasClienteCC) {
            await cargarContextoPoliticasYFinanciacionCC();
        }
        const bloques = construirBloquesPoliticasTextoCC(cacheSalvavidasClienteCC, cachePoliticasClienteCC, {
            financiacion: chkFin,
            politicaLista: chkPol,
            mediosPago: false
        });
        txtArea.value = [baseMsg.trim(), ...bloques].join('\n\n');
    };

    window.enviarPruebaReporteDesdeModalCC = async function (detallado, modoCorte, detallarBalance, desdeMovId = null) {
        if (!cuentaSeleccionada) return;
        const telInput = document.getElementById('swal-cc-tel-prueba');
        const btn = document.getElementById('btn-swal-cc-enviar-prueba');
        const feedback = document.getElementById('swal-cc-prueba-feedback');
        const txtArea = document.getElementById('swal-mensaje-whatsapp');
        const telPrueba = String(telInput?.value || '5492216615746').replace(/\D/g, '');

        if (telPrueba.length < 10) return;
        const origTxt = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Enviando prueba...';
        }
        if (feedback) {
            feedback.style.display = 'block';
            feedback.style.background = '#eff6ff';
            feedback.style.color = '#1e40af';
            feedback.innerHTML = `⏳ Enviando PDF y mensaje de prueba al +${telPrueba}...`;
        }

        try {
            const modoCorteNorm = typeof modoCorte === 'string' && modoCorte ? modoCorte : (modoCorte ? 'ultimo_cero' : 'todo');
            const resp = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: telPrueba,
                    detallado: Boolean(detallado) ? 'true' : 'false',
                    incluirDetalle: Boolean(detallado),
                    desde_ultimo_cero: (modoCorteNorm === 'ultimo_cero') ? 'true' : 'false',
                    desdeUltimoCero: modoCorteNorm === 'ultimo_cero',
                    modo_corte: modoCorteNorm,
                    modoCorte: modoCorteNorm,
                    desde_movimiento_id: desdeMovId || null,
                    detallar_balance: Boolean(detallarBalance) ? 'true' : 'false',
                    detallarBalance: Boolean(detallarBalance),
                    mensajeTexto: `🧪 [PRUEBA INTERNA LAMDA — Cliente: ${cliente?.cliente_nombre || ''}]\n\n` + (txtArea ? txtArea.value : '')
                })
            });
            const data = await resp.json();
            if (!resp.ok || (!data.success && !data.ok)) throw new Error(data.message || data.error || 'Error enviando prueba.');
            if (feedback) {
                feedback.style.display = 'block';
                feedback.style.background = '#ecfdf5';
                feedback.style.color = '#065f46';
                feedback.innerHTML = `✅ ¡Prueba enviada al +${telPrueba}! Revisá el WhatsApp de la empresa antes de enviar al cliente.`;
            }
        } catch (err) {
            if (feedback) {
                feedback.style.display = 'block';
                feedback.style.background = '#fef2f2';
                feedback.style.color = '#991b1b';
                feedback.innerHTML = `❌ Error: ${err.message}`;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origTxt;
            }
        }
    };

    window.abrirAsistentePoliticasDesdeCC = async function () {
        if (!cuentaSeleccionada || !cliente) {
            Swal.fire('Sin cuenta activa', 'Esperá a que termine de cargar la cuenta corriente del cliente.', 'info');
            return;
        }

        Swal.fire({
            title: '🛡️ Preparando Asistente de Políticas y Pagos Parciales...',
            text: 'Consultando reglas de Financiación y Lista de Precios asignada...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const { salvavidas, politicaInfo } = await cargarContextoPoliticasYFinanciacionCC();
        const reglas = salvavidas?.reglas_aplicadas || {};
        const listaId = politicaInfo?.lista_id || cliente?.lista_asignada_id || '-';
        const listaNombre = politicaInfo?.lista_nombre || reglas.lista_nombre || 'Mayorista LAMDA';
        const saldoCapital = Number(salvavidas?.saldo_contable_real ?? cuentaSeleccionada?.saldo ?? 0);
        const montoFin = Number(salvavidas?.financiacion_total_con_iva ?? 0);
        const saldoReal = montoFin > 0 ? Number(salvavidas?.saldo_total_proyectado_con_iva || (saldoCapital + montoFin)) : saldoCapital;
        const saldoFmt = saldoReal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
        const desgloseCF = montoFin > 0
            ? ` (C: ${saldoCapital.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} + F: ${montoFin.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })})`
            : '';

        // Extraer teléfono del cliente
        let telCliente = '';
        if (Array.isArray(cliente.contactos) && cliente.contactos.length > 0) {
            const cWp = cliente.contactos.find(c => c.recibe_whatsapp && (c.telefono || c.celular)) || cliente.contactos.find(c => c.telefono || c.celular);
            if (cWp) telCliente = String(cWp.telefono || cWp.celular || '').replace(/\D/g, '');
        }
        if (!telCliente && cliente.whatsapp_facturas) {
            telCliente = String(cliente.whatsapp_facturas).split(',')[0].replace(/\D/g, '');
        }
        if (!telCliente && cliente.telefono) {
            telCliente = String(cliente.telefono).replace(/\D/g, '');
        }
        if (telCliente && !telCliente.startsWith('54')) {
            telCliente = '549' + telCliente.replace(/^0+/, '');
        }

        const nombreCorto = (() => {
            const raw = String(cliente.cliente_nombre || '').trim();
            if (raw.includes(',')) {
                const p = (raw.split(',')[1] || '').trim().split(/\s+/)[0];
                if (p) return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
            }
            return raw;
        })();

        const armarTextoSugeridoCC = () => {
            const chkPdf = Boolean(document.getElementById('cc-pol-chk-pdf')?.checked);
            if (chkPdf) {
                return `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
            }
            const chkFin = document.getElementById('cc-pol-chk-fin') ? document.getElementById('cc-pol-chk-fin').checked : true;
            const chkLista = document.getElementById('cc-pol-chk-lista') ? document.getElementById('cc-pol-chk-lista').checked : true;
            const chkMedios = document.getElementById('cc-pol-chk-medios') ? document.getElementById('cc-pol-chk-medios').checked : false;
            const chkSaldo = document.getElementById('cc-pol-chk-saldo') ? document.getElementById('cc-pol-chk-saldo').checked : false;

            const partes = [
                `Hola *${nombreCorto}*, te paso en limpio cómo funciona nuestro sistema de *pagos parciales*, plazos de asistencia financiera y beneficios de tu lista de precios en *LAMDA* para tu tranquilidad:`
            ];
            if (chkSaldo) {
                partes.push(`📊 *Saldo total actual en Cuenta Corriente:* *${saldoFmt}*${desgloseCF}`);
            }
            const bloques = construirBloquesPoliticasTextoCC(salvavidas, politicaInfo, {
                financiacion: chkFin,
                politicaLista: chkLista,
                mediosPago: chkMedios
            });
            partes.push(...bloques);
            partes.push(`Cualquier duda o si querés que proyectemos cómo queda el saldo con un pago parcial determinado, avisanos por acá. Muchas gracias!`);
            return partes.join('\n\n');
        };

        window.regenerarTextoAsistenteCC = function () {
            const area = document.getElementById('cc-pol-textarea');
            if (area) area.value = armarTextoSugeridoCC();
        };

        window.enviarAsistentePoliticasCC = async function (esPrueba) {
            const area = document.getElementById('cc-pol-textarea');
            const chkPdf = Boolean(document.getElementById('cc-pol-chk-pdf')?.checked);
            const telDestino = esPrueba
                ? String(document.getElementById('cc-pol-tel-prueba')?.value || '5492216615746').replace(/\D/g, '')
                : String(document.getElementById('cc-pol-tel-cliente')?.value || '').replace(/\D/g, '');
            const feedback = document.getElementById('cc-pol-feedback');

            if (!telDestino || telDestino.length < 10) {
                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.style.background = '#fef2f2';
                    feedback.style.color = '#991b1b';
                    feedback.innerHTML = '⚠️ Ingresá un número de WhatsApp válido.';
                }
                return;
            }

            if (!esPrueba) {
                const ok = window.confirm(`¿Confirmás enviar esta explicación${chkPdf ? ' junto con el PDF de Cuenta Corriente' : ''} al cliente (+${telDestino})?`);
                if (!ok) return;
            }

            if (feedback) {
                feedback.style.display = 'block';
                feedback.style.background = '#eff6ff';
                feedback.style.color = '#1e40af';
                feedback.innerHTML = `⏳ Enviando ${esPrueba ? 'PRUEBA' : 'mensaje al cliente'} (+${telDestino})...`;
            }

            try {
                const textoFinal = (esPrueba ? `🧪 [PRUEBA INTERNA LAMDA — Cliente: ${cliente.cliente_nombre}]\n\n` : '') + (area ? area.value : '');
                if (chkPdf) {
                    const rPdf = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaSeleccionada.id}/whatsapp`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: telDestino,
                            incluirDetalle: true,
                            mensajeTexto: textoFinal
                        })
                    });
                    const dPdf = await rPdf.json();
                    if (!rPdf.ok || (!dPdf.success && !dPdf.ok)) throw new Error(dPdf.message || dPdf.error || 'No se pudo enviar el PDF y mensaje.');
                } else {
                    const rTxt = await fetch('http://localhost:3000/api/crm/seguimientos/enviar-prueba-directa', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            telefono_prueba: telDestino,
                            mensajes: [textoFinal]
                        })
                    });
                    const dTxt = await rTxt.json();
                    if (!rTxt.ok || !dTxt.success) throw new Error(dTxt.error || 'No se pudo enviar el mensaje.');
                }

                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.style.background = '#ecfdf5';
                    feedback.style.color = '#065f46';
                    feedback.innerHTML = esPrueba
                        ? `✅ <strong>¡Prueba enviada al +${telDestino}!</strong> Revisá el WhatsApp de la empresa para leer cómo queda antes de enviarlo al cliente.`
                        : `✅ <strong>¡Enviado con éxito al cliente (+${telDestino})!</strong>`;
                }
            } catch (err) {
                if (feedback) {
                    feedback.style.display = 'block';
                    feedback.style.background = '#fef2f2';
                    feedback.style.color = '#991b1b';
                    feedback.innerHTML = `❌ Error: ${err.message}`;
                }
            }
        };

        await Swal.fire({
            title: '🛡️ Asistente de Políticas, Financiación y Pagos Parciales',
            width: 820,
            showConfirmButton: false,
            showCloseButton: true,
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #1e293b;">
                    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <div style="font-size: 0.72rem; color: #64748b; font-weight: 700;">CLIENTE BÚNKER</div>
                            <div style="font-weight: 800; color: #0f172a;">${cliente.cliente_nombre} (${cliente.codigo_bunker_cliente || ''})</div>
                        </div>
                        <div>
                            <div style="font-size: 0.72rem; color: #0f766e; font-weight: 700;">LISTA ASIGNADA</div>
                            <div style="font-weight: 800; color: #0f766e;">Lista #${listaId} (${listaNombre})</div>
                        </div>
                        <div>
                            <div style="font-size: 0.72rem; color: #b91c1c; font-weight: 700;">SALDO ACTUAL</div>
                            <div style="font-weight: 900; color: #dc2626;">${saldoFmt}</div>
                        </div>
                    </div>

                    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px;">
                        <div style="font-weight: 800; color: #1e3a8a; font-size: 0.78rem; margin-bottom: 6px;">☑️ Seleccioná qué explicaciones incluir (combinables):</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 0.8rem;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700;">
                                <input type="checkbox" id="cc-pol-chk-fin" checked onchange="window.regenerarTextoAsistenteCC()">
                                <span>🤝 Pagos Parciales y Asistencia Financiera (Ventanas)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700;">
                                <input type="checkbox" id="cc-pol-chk-lista" checked onchange="window.regenerarTextoAsistenteCC()">
                                <span>🏷️ Política de su Lista (#${listaId}) y Descuento con Saldo $ 0,00</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700;">
                                <input type="checkbox" id="cc-pol-chk-medios" onchange="window.regenerarTextoAsistenteCC()">
                                <span>💳 Medios de Pago (CBU Galicia, Cajeros 24h y Ensobrado)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700;">
                                <input type="checkbox" id="cc-pol-chk-saldo" onchange="window.regenerarTextoAsistenteCC()">
                                <span>📊 Mencionar Saldo Actual (${saldoFmt}) en el texto</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 800; color: #0f766e; grid-column: span 2;">
                                <input type="checkbox" id="cc-pol-chk-pdf" onchange="window.regenerarTextoAsistenteCC()">
                                <span>📄 Adjuntar el PDF del Extracto de Cuenta Corriente (reemplaza el texto largo por un cuerpo corto ya que todo el detalle va adentro del PDF)</span>
                            </label>
                        </div>
                    </div>

                    <label style="font-weight: 800; color: #14532d; font-size: 0.8rem; display: block; margin-bottom: 4px;">✍️ Mensaje preparado para el operador (podés editarlo libremente):</label>
                    <textarea id="cc-pol-textarea" rows="11" style="width: 100%; padding: 9px 11px; border: 1px solid #86efac; border-radius: 8px; font-size: 0.82rem; font-family: inherit; line-height: 1.42; box-sizing: border-box; margin-bottom: 10px;"></textarea>

                    <div id="cc-pol-feedback" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 700; margin-bottom: 10px;"></div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 9px 12px;">
                            <div style="font-weight: 800; color: #92400e; font-size: 0.78rem; margin-bottom: 4px;">🧪 1. Probar en Teléfono de la Empresa</div>
                            <div style="display: flex; gap: 6px;">
                                <input type="text" id="cc-pol-tel-prueba" value="5492216615746" style="flex: 1; padding: 6px 8px; border: 1px solid #f59e0b; border-radius: 6px; font-size: 0.8rem; font-weight: 800; color: #78350f;">
                                <button type="button" onclick="window.enviarAsistentePoliticasCC(true)" style="background: #d97706; color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 0.78rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                                    🧪 Enviar Prueba
                                </button>
                            </div>
                        </div>
                        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 9px 12px;">
                            <div style="font-weight: 800; color: #065f46; font-size: 0.78rem; margin-bottom: 4px;">🚀 2. Enviar al WhatsApp del Cliente</div>
                            <div style="display: flex; gap: 6px;">
                                <input type="text" id="cc-pol-tel-cliente" value="${telCliente}" placeholder="Ej: 5492215602203" style="flex: 1; padding: 6px 8px; border: 1px solid #34d399; border-radius: 6px; font-size: 0.8rem; font-weight: 800; color: #065f46;">
                                <button type="button" onclick="window.enviarAsistentePoliticasCC(false)" style="background: #128c7e; color: white; border: none; border-radius: 6px; padding: 6px 14px; font-size: 0.8rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                                    🚀 Enviar al Cliente
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            didOpen: () => {
                window.regenerarTextoAsistenteCC();
            }
        });
    };

    // --- INICIALIZACIÓN ---
    inicializar();

});
