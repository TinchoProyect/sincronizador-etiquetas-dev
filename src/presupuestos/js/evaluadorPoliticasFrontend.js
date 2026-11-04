// filepath: src/presupuestos/js/evaluadorPoliticasFrontend.js
'use strict';

/**
 * Motor Frontend Universal de Políticas Comerciales (LAMDA)
 * Brinda reactividad en tiempo real y auto-aplicación determinista en Presupuestos Create y Edit.
 * El bloqueo por saldo pendiente actúa como alerta preventiva informativa para el operador local,
 * permitiéndole confirmar y autorizar un descuento manualmente cuando lo requiera.
 */
window.EvaluadorPoliticas = (function () {
    let politicaActual = null;
    let excepcionActual = null;
    let saldoClienteActual = 0;
    let descuentoAutoAplicado = null;
    let manualOverride = false;
    let desbloqueoPorOperador = false;
    let isEvaluating = false;
    let confirmModalOpen = false;
    let debounceConfirmTimer = null;
    let ultimoSubtotalNeto = 0;
    let ultimoSubtotalBruto = 0;

    // Detección robusta de Modo Orden de Retiro / Nota de Crédito
    function esModoRetiro() {
        if (typeof window !== 'undefined' && window.MODO_RETIRO === true) return true;
        try {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('modo') === 'retiro') return true;
        } catch (_) {}
        const tipoComp = document.getElementById('tipo_comprobante')?.value;
        if (tipoComp === 'Orden de Retiro' || tipoComp === 'Nota de Crédito') return true;
        const estadoVal = document.getElementById('estado')?.value;
        if (estadoVal === 'Orden de Retiro' || estadoVal === 'Administrativa NC') return true;
        const panelRetiro = document.getElementById('contenedor-opciones-retiro');
        if (panelRetiro && (panelRetiro.style.display === 'block' || panelRetiro.style.display === 'flex')) return true;
        const panelAdmin = document.getElementById('admin-retiro-container');
        if (panelAdmin && (panelAdmin.style.display === 'block' || panelAdmin.style.display === 'flex')) return true;
        return false;
    }

    function estaBloqueadoPorSaldo() {
        if (!politicaActual) return false;
        const exigeSaldo = politicaActual.exige_saldo_cero !== false;
        const tolerancia = parseFloat(politicaActual.tolerancia_saldo) || 150.00;
        return exigeSaldo && saldoClienteActual > tolerancia;
    }

    function obtenerPorcentajeSugerido(subtotalNeto, subtotalBruto) {
        if (excepcionActual && excepcionActual.tipo_excepcion === 'PORCENTAJE_FIJO') {
            return parseFloat(excepcionActual.descuento_fijo) || 5;
        }
        if (!politicaActual || !Array.isArray(politicaActual.tramos) || politicaActual.tramos.length === 0) {
            return 5;
        }
        const montoBase = (politicaActual.aplica_sobre === 'BRUTO')
            ? (parseFloat(subtotalBruto) || 0)
            : (parseFloat(subtotalNeto) || 0);
        const tramos = [...politicaActual.tramos].sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(b.monto_minimo));
        let tramoAlcanzado = null;
        for (const t of tramos) {
            const min = parseFloat(t.monto_minimo) || 0;
            const max = (t.monto_maximo !== null && t.monto_maximo !== undefined && t.monto_maximo !== '')
                ? parseFloat(t.monto_maximo) : Infinity;
            if (montoBase >= min && (montoBase <= max || max === Infinity)) {
                tramoAlcanzado = t;
            }
        }
        if (tramoAlcanzado) {
            return parseFloat(tramoAlcanzado.descuento_porcentaje) || 5;
        }
        return parseFloat(tramos[0]?.descuento_porcentaje) || 5;
    }

    function dispararRecalculoGlobal() {
        const inputDesc = document.getElementById('descuento');
        if (inputDesc) {
            try {
                inputDesc.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (_) {}
        }
        if (window.Detalles && typeof window.Detalles.recalcTotales === 'function') {
            window.Detalles.recalcTotales();
        }
    }

    // Modal de confirmación para que el operador autorice el descuento con saldo pendiente
    function solicitarConfirmacionDesbloqueo(porcentajeDeseado, origen = 'manual') {
        if (confirmModalOpen) return;
        confirmModalOpen = true;
        if (debounceConfirmTimer) {
            clearTimeout(debounceConfirmTimer);
            debounceConfirmTimer = null;
        }

        const pct = parseFloat(porcentajeDeseado) || obtenerPorcentajeSugerido(ultimoSubtotalNeto, ultimoSubtotalBruto) || 5;
        const tolerancia = parseFloat(politicaActual?.tolerancia_saldo) || 150.00;
        const saldoFmt = saldoClienteActual.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const tolFmt = tolerancia.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        let overlay = document.getElementById('modal-confirm-desbloqueo-descuento');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'modal-confirm-desbloqueo-descuento';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(2px);
            display: flex; align-items: center; justify-content: center; padding: 16px;
        `;

        overlay.innerHTML = `
            <div style="background: #ffffff; border-radius: 12px; max-width: 460px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.25); border: 1px solid #fecaca; overflow: hidden; font-family: system-ui, -apple-system, sans-serif;">
                <div style="background: #fef2f2; border-bottom: 1px solid #fecaca; padding: 14px 18px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.35rem;">⚠️</span>
                    <h3 style="margin: 0; font-size: 1.02rem; font-weight: 700; color: #991b1b;">
                        Confirmar Descuento con Saldo Pendiente
                    </h3>
                </div>
                <div style="padding: 18px; color: #334155; font-size: 0.92rem; line-height: 1.5;">
                    <p style="margin: 0 0 10px 0;">
                        El cliente registra un saldo pendiente en cuenta corriente de
                        <strong style="color: #b91c1c;">$${saldoFmt}</strong>
                        <span style="color: #64748b; font-size: 0.85em;">(tolerancia de política: $${tolFmt})</span>.
                    </p>
                    <p style="margin: 0 0 12px 0; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 12px; border-radius: 8px; font-size: 0.88rem;">
                        Por política comercial automática la bonificación se encuentra bloqueada, pero <b>como operador puede autorizar su aplicación</b> en este presupuesto.
                    </p>
                    <p style="margin: 0; font-weight: 600; color: #0f172a;">
                        ¿Confirma aplicar el <span style="color: #15803d; font-size: 1.05em;">${pct}% de descuento</span> de todos modos?
                    </p>
                </div>
                <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 12px 18px; display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" id="btn-cancelar-desbloqueo-desc" style="padding: 8px 14px; border-radius: 7px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; font-weight: 600; font-size: 0.88rem; cursor: pointer;">
                        Cancelar (Mantener 0%)
                    </button>
                    <button type="button" id="btn-confirmar-desbloqueo-desc" style="padding: 8px 16px; border-radius: 7px; border: none; background: #16a34a; color: #ffffff; font-weight: 700; font-size: 0.88rem; cursor: pointer; box-shadow: 0 1px 3px rgba(22,163,74,0.3);">
                        ✅ Sí, autorizar ${pct}%
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cerrarYCancelar = () => {
            confirmModalOpen = false;
            overlay.remove();
            desbloqueoPorOperador = false;
            manualOverride = false;
            const inputDesc = document.getElementById('descuento');
            if (inputDesc) {
                inputDesc.value = '0.00';
            }
            dispararRecalculoGlobal();
        };

        const confirmarYAplicar = () => {
            confirmModalOpen = false;
            overlay.remove();
            desbloqueoPorOperador = true;
            manualOverride = true;
            const inputDesc = document.getElementById('descuento');
            if (inputDesc) {
                inputDesc.value = Number(pct).toFixed(2);
            }
            console.log(`[POLITICA-FRONT] 🔓 Descuento del ${pct}% autorizado manualmente por el operador (con saldo pendiente).`);
            dispararRecalculoGlobal();
        };

        overlay.querySelector('#btn-cancelar-desbloqueo-desc')?.addEventListener('click', cerrarYCancelar);
        overlay.querySelector('#btn-confirmar-desbloqueo-desc')?.addEventListener('click', confirmarYAplicar);
    }

    function revertirDesbloqueoOperador() {
        if (debounceConfirmTimer) {
            clearTimeout(debounceConfirmTimer);
            debounceConfirmTimer = null;
        }
        desbloqueoPorOperador = false;
        manualOverride = false;
        const inputDesc = document.getElementById('descuento');
        if (inputDesc) {
            inputDesc.value = '0.00';
        }
        console.log('[POLITICA-FRONT] 🔒 Descuento revertido a 0% por el operador.');
        dispararRecalculoGlobal();
    }

    // Listener en fase de captura (capture: true) para ejecutarse ANTES que recalcTotales() de detalles-common / presupuestosCreate
    function initListeners() {
        if (window.__evaluadorPoliticasListenersInit) return;
        window.__evaluadorPoliticasListenersInit = true;

        document.addEventListener('input', function (e) {
            if (!e || e.target?.id !== 'descuento') return;
            if (isEvaluating || e.isTrusted === false) return;

            const inputDesc = e.target;
            const val = parseFloat(inputDesc.value) || 0;

            if (esModoRetiro()) {
                manualOverride = true;
                if (val > 0) {
                    mostrarBannerRetiro(val);
                } else {
                    ocultarBanner();
                }
                return;
            }

            if (val > 0) {
                // Cualquier valor positivo ingresado manualmente por el operador activa manualOverride inmediatamente
                // para que evaluarYActualizarUI() NO lo pise a 0.00 mientras escribe.
                manualOverride = true;

                if (estaBloqueadoPorSaldo() && !desbloqueoPorOperador) {
                    if (debounceConfirmTimer) clearTimeout(debounceConfirmTimer);
                    debounceConfirmTimer = setTimeout(() => {
                        const currentVal = parseFloat(document.getElementById('descuento')?.value) || 0;
                        if (currentVal > 0 && estaBloqueadoPorSaldo() && !desbloqueoPorOperador) {
                            solicitarConfirmacionDesbloqueo(currentVal, 'input');
                        }
                    }, 650);
                } else {
                    console.log(`[POLITICA-FRONT] Sobreescritura manual de descuento detectada: ${val}% (Auto era: ${descuentoAutoAplicado}%)`);
                    mostrarBannerOverride(val);
                }
            } else {
                // Si el operador puso 0%
                if (debounceConfirmTimer) {
                    clearTimeout(debounceConfirmTimer);
                    debounceConfirmTimer = null;
                }
                if (estaBloqueadoPorSaldo()) {
                    manualOverride = false;
                    desbloqueoPorOperador = false;
                } else if (descuentoAutoAplicado !== null && descuentoAutoAplicado > 0) {
                    // El operador decidió forzar 0% aunque había un descuento automático activo
                    manualOverride = true;
                    mostrarBannerOverride(0);
                } else {
                    manualOverride = false;
                }
            }
        }, true);

        document.addEventListener('change', function (e) {
            if (!e || e.target?.id !== 'descuento') return;
            if (isEvaluating || e.isTrusted === false) return;
            const val = parseFloat(e.target.value) || 0;
            if (!esModoRetiro() && val > 0 && estaBloqueadoPorSaldo() && !desbloqueoPorOperador) {
                if (debounceConfirmTimer) {
                    clearTimeout(debounceConfirmTimer);
                    debounceConfirmTimer = null;
                }
                solicitarConfirmacionDesbloqueo(val, 'change');
            }
        }, true);
    }

    initListeners();

    /**
     * Cargar la política correspondiente a un cliente
     */
    async function cargarPoliticaCliente(clienteId) {
        if (!clienteId) {
            politicaActual = null;
            excepcionActual = null;
            saldoClienteActual = 0;
            descuentoAutoAplicado = null;
            manualOverride = false;
            desbloqueoPorOperador = false;
            ocultarBanner();
            return null;
        }

        try {
            const res = await fetch(`/api/presupuestos/politicas/cliente/${clienteId}`);
            const body = await res.json();
            if (body.success && body.data) {
                politicaActual = body.data.politica;
                excepcionActual = body.data.excepcion;
                saldoClienteActual = parseFloat(body.data.saldo_cuenta_corriente) || 0;
                manualOverride = false;
                desbloqueoPorOperador = false;
                descuentoAutoAplicado = null;
                console.log(`[POLITICA-FRONT] Política cargada para cliente #${clienteId}:`, {
                    lista: body.data.lista_nombre,
                    politica: politicaActual?.nombre,
                    saldo_cc: saldoClienteActual,
                    excepcion: excepcionActual
                });
                return body.data;
            }
        } catch (err) {
            console.warn('[POLITICA-FRONT] Error al cargar política del cliente:', err);
        }
        return null;
    }

    /**
     * Cargar política directamente por lista de precios
     */
    async function cargarPoliticaPorLista(listaId) {
        if (!listaId) {
            politicaActual = null;
            excepcionActual = null;
            descuentoAutoAplicado = null;
            manualOverride = false;
            desbloqueoPorOperador = false;
            ocultarBanner();
            return null;
        }

        try {
            const res = await fetch(`/api/presupuestos/politicas/lista/${listaId}`);
            const body = await res.json();
            if (body.success && body.data) {
                politicaActual = body.data;
                excepcionActual = null;
                manualOverride = false;
                desbloqueoPorOperador = false;
                descuentoAutoAplicado = null;
                console.log(`[POLITICA-FRONT] Política cargada por lista #${listaId}:`, politicaActual?.nombre);
                return body.data;
            }
        } catch (err) {
            console.warn('[POLITICA-FRONT] Error al cargar política de lista:', err);
        }
        return null;
    }

    /**
     * Preservar descuento ya existente al abrir un presupuesto en modo Edición
     */
    function autorizarDescuentoExistente(porcentajeExistente) {
        const pct = parseFloat(porcentajeExistente) || 0;
        if (pct > 0) {
            manualOverride = true;
            desbloqueoPorOperador = true;
            const inputDesc = document.getElementById('descuento');
            if (inputDesc) {
                inputDesc.value = pct;
            }
            console.log(`[POLITICA-FRONT] Descuento preexistente preservado en edición: ${pct}%`);
        }
    }

    /**
     * Evaluar y actualizar UI en tiempo real
     */
    function evaluarYActualizarUI(subtotalNeto, subtotalBruto, onDescuentoCambio = null) {
        if (isEvaluating) return;
        isEvaluating = true;

        ultimoSubtotalNeto = parseFloat(subtotalNeto) || 0;
        ultimoSubtotalBruto = parseFloat(subtotalBruto) || 0;

        try {
            const inputDesc = document.getElementById('descuento');

            // 🛡️ REGLA NOTA DE CRÉDITO / ORDEN DE RETIRO:
            // En notas de crédito u órdenes de retiro NO aplica el bloqueo comercial por saldo pendiente.
            if (esModoRetiro()) {
                const descActual = parseFloat(inputDesc?.value) || 0;
                if (descActual > 0) {
                    mostrarBannerRetiro(descActual);
                } else {
                    ocultarBanner();
                }
                return;
            }

            if (!politicaActual || !politicaActual.tramos || politicaActual.tramos.length === 0) {
                ocultarBanner();
                return;
            }

            // Caso 0: Bloqueo comercial informativo si el cliente tiene saldo activo (mayor a la tolerancia configurada)
            const exigeSaldo = politicaActual.exige_saldo_cero !== false;
            const tolerancia = parseFloat(politicaActual.tolerancia_saldo) || 150.00;
            if (exigeSaldo && saldoClienteActual > tolerancia) {
                const descActual = parseFloat(inputDesc?.value) || 0;
                if ((manualOverride || desbloqueoPorOperador) && descActual > 0) {
                    mostrarBannerDesbloqueadoPorOperador(descActual, saldoClienteActual, tolerancia);
                    return;
                }
                const pctSugerido = obtenerPorcentajeSugerido(subtotalNeto, subtotalBruto);
                mostrarBannerBloqueadoPorSaldo(saldoClienteActual, tolerancia, pctSugerido);
                if (!manualOverride && inputDesc) {
                    inputDesc.value = '0.00';
                    descuentoAutoAplicado = null;
                    if (typeof onDescuentoCambio === 'function') onDescuentoCambio(0);
                }
                return;
            }

            // Caso 1: Excepción de exclusión
            if (excepcionActual && excepcionActual.tipo_excepcion === 'EXCLUIDO') {
                mostrarBannerExcluido(excepcionActual.motivo);
                if (!manualOverride && inputDesc && descuentoAutoAplicado !== null) {
                    inputDesc.value = '0.00';
                    descuentoAutoAplicado = null;
                    if (typeof onDescuentoCambio === 'function') onDescuentoCambio(0);
                } else if (manualOverride && inputDesc) {
                    const descActual = parseFloat(inputDesc.value) || 0;
                    if (descActual > 0) mostrarBannerOverride(descActual);
                }
                return;
            }

            // Caso 2: Excepción de porcentaje fijo
            if (excepcionActual && excepcionActual.tipo_excepcion === 'PORCENTAJE_FIJO') {
                const fijo = parseFloat(excepcionActual.descuento_fijo) || 0;
                mostrarBannerFijo(fijo, excepcionActual.motivo);
                if (!manualOverride && inputDesc) {
                    const actual = parseFloat(inputDesc.value) || 0;
                    if (Math.abs(actual - fijo) > 0.001) {
                        inputDesc.value = fijo.toFixed(2);
                        descuentoAutoAplicado = fijo;
                        if (typeof onDescuentoCambio === 'function') onDescuentoCambio(fijo);
                    }
                }
                return;
            }

            // Caso 3: Política con tramos
            const montoBase = (politicaActual.aplica_sobre === 'BRUTO')
                ? (parseFloat(subtotalBruto) || 0)
                : (parseFloat(subtotalNeto) || 0);

            const tramos = [...politicaActual.tramos].sort((a, b) => parseFloat(a.monto_minimo) - parseFloat(b.monto_minimo));

            let tramoActual = null;
            let proximoTramo = null;

            for (const t of tramos) {
                const min = parseFloat(t.monto_minimo);
                const max = (t.monto_maximo !== null && t.monto_maximo !== undefined && t.monto_maximo !== '')
                    ? parseFloat(t.monto_maximo) : Infinity;

                if (montoBase >= min) {
                    if (montoBase <= max || max === Infinity) {
                        tramoActual = t;
                    }
                } else if (!proximoTramo && montoBase < min) {
                    proximoTramo = t;
                }
            }

            if (tramoActual) {
                const descPct = parseFloat(tramoActual.descuento_porcentaje) || 0;
                const faltaProximo = proximoTramo ? Math.max(0, parseFloat(proximoTramo.monto_minimo) - montoBase) : 0;

                // Aplicar automáticamente si el usuario no hizo override manual
                if (!manualOverride && inputDesc) {
                    const actual = parseFloat(inputDesc.value) || 0;
                    if (Math.abs(actual - descPct) > 0.001) {
                        inputDesc.value = descPct.toFixed(2);
                        descuentoAutoAplicado = descPct;
                        if (typeof onDescuentoCambio === 'function') onDescuentoCambio(descPct);
                    }
                }

                const pctMostrar = manualOverride ? (parseFloat(inputDesc?.value) || 0) : descPct;
                mostrarBannerAlcanzado(tramoActual, pctMostrar, proximoTramo, faltaProximo, manualOverride);
            } else {
                // No alcanza el primer tramo
                const primer = tramos[0];
                const falta = primer ? Math.max(0, parseFloat(primer.monto_minimo) - montoBase) : 0;

                // Si se había auto-aplicado un descuento y ahora cayó por debajo del mínimo
                if (!manualOverride && inputDesc && descuentoAutoAplicado !== null) {
                    inputDesc.value = '0.00';
                    descuentoAutoAplicado = null;
                    if (typeof onDescuentoCambio === 'function') onDescuentoCambio(0);
                }

                mostrarBannerFaltante(primer, falta);
                if (manualOverride && inputDesc) {
                    const descActual = parseFloat(inputDesc.value) || 0;
                    if (descActual > 0) mostrarBannerOverride(descActual);
                }
            }

        } finally {
            isEvaluating = false;
        }
    }

    // --- Helpers de Renderizado del Banner en Totales Panel ---

    function getOrCreateBannerContainer() {
        let el = document.getElementById('politica-comercial-banner');
        if (!el) {
            const finalRow = document.querySelector('.final-row, .totales-final');
            if (finalRow && finalRow.parentNode) {
                el = document.createElement('div');
                el.id = 'politica-comercial-banner';
                el.style.margin = '8px 0';
                el.style.borderRadius = '6px';
                el.style.padding = '8px 12px';
                el.style.fontSize = '0.85em';
                el.style.transition = 'all 0.3s ease';
                finalRow.parentNode.insertBefore(el, finalRow);
            } else {
                const panel = document.querySelector('.totales-panel, .panel-body');
                if (panel) {
                    el = document.createElement('div');
                    el.id = 'politica-comercial-banner';
                    el.style.margin = '8px 0';
                    el.style.borderRadius = '6px';
                    el.style.padding = '8px 12px';
                    el.style.fontSize = '0.85em';
                    el.style.transition = 'all 0.3s ease';
                    panel.appendChild(el);
                }
            }
        }
        return el;
    }

    function mostrarBannerRetiro(descPct) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#f0fdf4';
        el.style.border = '1px solid #bbf7d0';
        el.style.color = '#166534';

        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:1.15em;">📄</span>
                <div>
                    <b>Nota de Crédito / Orden de Retiro:</b> Bonificación comercial del <b>${descPct}%</b> respetada del comprobante de origen (sin bloqueo por saldo).
                </div>
            </div>
        `;
    }

    function mostrarBannerBloqueadoPorSaldo(saldo, tolerancia, pctSugerido = 5) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#fef2f2';
        el.style.border = '1px solid #fecaca';
        el.style.color = '#991b1b';

        el.innerHTML = `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div style="display:flex; align-items:flex-start; gap:8px; flex:1; min-width:220px;">
                    <span style="font-size:1.15em;">⛔</span>
                    <div style="flex:1;">
                        <strong style="display:block; margin-bottom:2px; color:#b91c1c;">Descuento comercial bloqueado por saldo pendiente</strong>
                        <div style="font-size:0.85em; line-height:1.35; color:#7f1d1d;">
                            El cliente registra un saldo en cuenta corriente de <b>$${saldo.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b> (tolerancia: $${tolerancia.toLocaleString('es-AR')}).
                            Como operador puede autorizar igualmente la bonificación o ingresarla en <i>Opciones Avanzadas</i>.
                        </div>
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <button type="button" id="btn-operador-desbloquear-descuento"
                        style="background:#ffffff; color:#b91c1c; border:1px solid #f87171; border-radius:6px; padding:5px 10px; font-size:0.82em; font-weight:700; cursor:pointer; white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,0.05);"
                        title="Autorizar y aplicar bonificación manualmente como operador">
                        🔓 Autorizar ${pctSugerido}% como operador
                    </button>
                </div>
            </div>
        `;

        const btn = el.querySelector('#btn-operador-desbloquear-descuento');
        if (btn) {
            btn.onclick = () => solicitarConfirmacionDesbloqueo(pctSugerido, 'banner');
        }
    }

    function mostrarBannerDesbloqueadoPorOperador(descPct, saldo, tolerancia) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#f0fdf4';
        el.style.border = '1px solid #86efac';
        el.style.color = '#166534';

        el.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                <div style="display:flex; align-items:flex-start; gap:8px; flex:1; min-width:220px;">
                    <span style="font-size:1.15em;">🔓</span>
                    <div style="flex:1;">
                        <strong style="display:block; margin-bottom:2px; color:#15803d;">
                            Bonificación comercial del ${descPct}% autorizada por operador
                        </strong>
                        <div style="font-size:0.84em; line-height:1.35; color:#166534;">
                            Aplicada manualmente sobre cliente con saldo pendiente en Cta. Cte. ($${saldo.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}).
                        </div>
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <button type="button" id="btn-operador-revertir-descuento"
                        style="background:#ffffff; color:#475569; border:1px solid #cbd5e1; border-radius:6px; padding:4px 9px; font-size:0.8em; font-weight:600; cursor:pointer; white-space:nowrap;"
                        title="Quitar el descuento y volver al bloqueo por defecto (0%)">
                        🔒 Quitar descuento (0%)
                    </button>
                </div>
            </div>
        `;

        const btnRev = el.querySelector('#btn-operador-revertir-descuento');
        if (btnRev) {
            btnRev.onclick = () => revertirDesbloqueoOperador();
        }
    }

    function mostrarBannerAlcanzado(tramo, descPct, proximoTramo, faltaProximo, override) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#dcfce7';
        el.style.border = '1px solid #86efac';
        el.style.color = '#15803d';

        let textoProximo = '';
        if (proximoTramo) {
            textoProximo = ` <span style="display:block; font-size:0.85em; color:#166534; margin-top:2px;">↳ Faltan <b>$${faltaProximo.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b> para el próximo escalón del <b>${proximoTramo.descuento_porcentaje}%</b></span>`;
        }

        let textoOverride = '';
        if (override) {
            textoOverride = ` <span style="display:inline-block; font-size:0.8em; background:#fef08a; color:#854d0e; padding:1px 6px; border-radius:4px; margin-left:6px;">Manual</span>`;
        }

        el.innerHTML = `
            <div style="display:flex; align-items:flex-start; gap:6px;">
                <span>🎉</span>
                <div style="flex:1;">
                    <b>Bonificación comercial: ${descPct}%</b> (${escapeHtml(tramo.etiqueta || politicaActual.nombre)})${textoOverride}
                    ${textoProximo}
                </div>
            </div>
        `;
    }

    function mostrarBannerFaltante(primerTramo, falta) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#fef9c3';
        el.style.border = '1px solid #fde047';
        el.style.color = '#854d0e';

        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <span>💡</span>
                <div>
                    Faltan <b>$${falta.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</b> para alcanzar el <b>${primerTramo ? primerTramo.descuento_porcentaje : 5}% de descuento</b> por volumen.
                </div>
            </div>
        `;
    }

    function mostrarBannerExcluido(motivo) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#f1f5f9';
        el.style.border = '1px solid #cbd5e1';
        el.style.color = '#64748b';

        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <span>ℹ️</span>
                <div>
                    Cliente con <b>exclusión de bonificación comercial</b>${motivo ? ': ' + escapeHtml(motivo) : ''}.
                </div>
            </div>
        `;
    }

    function mostrarBannerFijo(porcentaje, motivo) {
        const el = getOrCreateBannerContainer();
        if (!el) return;

        el.style.display = 'block';
        el.style.background = '#e0e7ff';
        el.style.border = '1px solid #c7d2fe';
        el.style.color = '#3730a3';

        el.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <span>⭐</span>
                <div>
                    <b>Bonificación fija acordada: ${porcentaje}%</b>${motivo ? ' (' + escapeHtml(motivo) + ')' : ''}.
                </div>
            </div>
        `;
    }

    function mostrarBannerOverride(val) {
        const el = getOrCreateBannerContainer();
        if (!el || el.style.display === 'none') return;
        const span = el.querySelector('.tag-override');
        if (!span) {
            const tag = document.createElement('span');
            tag.className = 'tag-override';
            tag.style.cssText = 'font-size:0.8em; background:#fef08a; color:#854d0e; padding:1px 6px; border-radius:4px; margin-left:6px;';
            tag.textContent = `Manual: ${val}%`;
            el.appendChild(tag);
        } else {
            span.textContent = `Manual: ${val}%`;
        }
    }

    function ocultarBanner() {
        const el = document.getElementById('politica-comercial-banner');
        if (el) el.style.display = 'none';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    return {
        cargarPoliticaCliente,
        cargarPoliticaPorLista,
        evaluarYActualizarUI,
        getPoliticaActual: () => politicaActual,
        getExcepcionActual: () => excepcionActual,
        setManualOverride: (val) => { manualOverride = !!val; },
        autorizarDescuentoExistente,
        solicitarConfirmacionDesbloqueo,
        esModoRetiro,
        mostrarBannerRetiro
    };
})();
