/**
 * ============================================================================
 * INTEGRACIÓN NATIVA DE NODOS BARRIALES EN EL CIRCUITO OPERATIVO DE LAMDA
 * ============================================================================
 * Conecta los Canastos de Nodos Barriales con las ventanas operativas diarias:
 * 1. Pizarra Principal (http://localhost:3000)
 * 2. Producción: Resumen de Faltantes, Configurar Carros y Carro Personal (produccion_personal.html)
 * 3. Bandejas de Pedidos: 1. Imprimir -> 2. Armar Pedido + Chequeo -> 3. Pedido Listo -> 4. Retira por Depósito
 * 4. Reparto y Rutas del Día en Logística (http://localhost:3005)
 * 5. Entrega con QR Maestro y Liquidación en Cuenta Corriente (/liquidacion-nodos)
 */

(function () {
    let estadoCircuitoNodos = {
        canastos: [],
        resumen_deposito: null
    };

    function fmtMoneda(val) {
        return '$' + Math.round(Number(val || 0)).toLocaleString('es-AR');
    }

    function describirEtapaActual(canasto) {
        const sec = String(canasto.presup_secuencia || canasto.secuencia_operativa_lamda || 'Imprimir').trim();
        const estLog = String(canasto.presup_estado_logistico || '').toUpperCase();
        const estCan = String(canasto.estado_canasto || '').toUpperCase();

        if (estCan === 'ENTREGADO_AL_GESTOR' || sec === 'Entregado' || estLog.includes('ENTREGADO')) {
            return {
                codigo: 'ENTREGADO_GESTOR',
                paso: 5,
                badge: '🏁 5. Entregado al Gestor (Débito Cta. Cte. Aplicado)',
                colorBg: '#dcfce7',
                colorText: '#166534',
                colorBorder: '#86efac',
                seccionId: null,
                contenedorId: null
            };
        }
        if (sec === 'Retira_Deposito') {
            return {
                codigo: 'RETIRA_DEPOSITO',
                paso: 4,
                badge: '🏪 4. En "Retira por Depósito" (Listo para QR Maestro)',
                colorBg: '#cffafe',
                colorText: '#155e75',
                colorBorder: '#67e8f9',
                seccionId: 'pedidos-retira-section',
                contenedorId: 'pedidos-retira'
            };
        }
        if (sec === 'Pedido_Listo' || sec === 'Asignado_Ruta' || estCan === 'LISTO_ESTACION_NODOS') {
            const enRuta = canasto.presup_id_ruta ? ` · Ruta #${canasto.presup_id_ruta}` : ' · Disponible en Reparto (:3005)';
            return {
                codigo: 'PEDIDO_LISTO_REPARTO',
                paso: 4,
                badge: `✅ 3. En "Pedido Listo"${enRuta}`,
                colorBg: '#dbeafe',
                colorText: '#1e40af',
                colorBorder: '#93c5fd',
                seccionId: 'pedidos-listo-section',
                contenedorId: 'pedidos-listo'
            };
        }
        if (sec === 'Armar_Pedido') {
            return {
                codigo: 'ARMAR_CHEQUEO',
                paso: 3,
                badge: '📦 2. En "Armar Pedido" (Listo para 🔍 Verificar / Chequeo)',
                colorBg: '#fef3c7',
                colorText: '#92400e',
                colorBorder: '#fcd34d',
                seccionId: 'pedidos-armar-section',
                contenedorId: 'pedidos-armar'
            };
        }
        return {
            codigo: 'IMPRIMIR_CON_FALTANTES',
            paso: 1,
            badge: '📄 1. En Pizarra Principal + Faltantes Carro Personal + Bandeja Imprimir',
            colorBg: '#ffedd5',
            colorText: '#9a3412',
            colorBorder: '#fdba74',
            seccionId: 'pedidos-imprimir-section',
            contenedorId: 'pedidos-imprimir'
        };
    }

    async function cargarEstadoCircuitoNodos() {
        try {
            const res = await fetch('/api/produccion/nodos/circuito-lamda/estado');
            const data = await res.json();
            if (data && data.ok) {
                estadoCircuitoNodos = data;
                renderizarPanelCircuitoNodos();
            }
        } catch (err) {
            console.warn('⚠️ [NodosCircuito] No se pudo cargar el estado de Nodos:', err.message);
        }
    }

    function asegurarContenedorPanel() {
        let panel = document.getElementById('panel-circuito-nodos-lamda');
        if (panel) return panel;

        const reportsSection = document.querySelector('.reports-section');
        if (!reportsSection) return null;

        panel = document.createElement('section');
        panel.id = 'panel-circuito-nodos-lamda';
        panel.style.cssText = 'margin: 18px 0; background: #ffffff; border: 2px solid #16a34a; border-radius: 10px; box-shadow: 0 3px 10px rgba(22,163,74,0.08); overflow: hidden;';
        reportsSection.parentNode.insertBefore(panel, reportsSection);
        return panel;
    }

    function renderizarPanelCircuitoNodos() {
        const panel = asegurarContenedorPanel();
        if (!panel) return;

        const canastos = estadoCircuitoNodos.canastos || [];
        if (canastos.length === 0) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'block';

        const host = window.location.hostname || 'localhost';
        const urlPizarra = `http://${host}:3000`;
        const urlLogistica = `http://${host}:3005`;

        const tarjetasHtml = canastos.map(c => {
            const etapa = describirEtapaActual(c);
            const clienteIdNum = 9000 + Number(c.nodo_id);
            const bolsasArmadas = Number(c.bolsas_armadas || 0);
            const totalBolsas = Number(c.total_bolsas || 0);

            return `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid ${c.color_primario || '#16a34a'}; border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="background: #16a34a; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 99px;">CANASTO ${c.codigo_canasto}</span>
                                <strong style="font-size: 15px; color: #0f172a;">🏘️ ${c.nombre_marca}</strong>
                                <span style="font-size: 12.5px; color: #475569;">(Gestor: ${c.gestor_nombre} · Cliente #${clienteIdNum})</span>
                            </div>
                            <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                                📅 Entrega: <strong>${c.fecha_entrega_label}</strong> · 📦 <strong>${bolsasArmadas}/${totalBolsas} bolsas vecinales</strong> (${Number(c.total_kilos_lote || 0)} kg) · Base LAMDA: <strong>${fmtMoneda(c.total_base_lamda)}</strong> · Cta. Cte.: <strong style="color: ${Number(c.saldo_cuenta_corriente) < 0 ? '#dc2626' : '#15803d'};">${fmtMoneda(c.saldo_cuenta_corriente)}</strong>
                            </div>
                        </div>
                        <span style="background: ${etapa.colorBg}; color: ${etapa.colorText}; border: 1px solid ${etapa.colorBorder}; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 800;">
                            ${etapa.badge}
                        </span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            ${etapa.seccionId ? `
                                <button type="button" onclick="window.irABandejaCanastoLamda('${etapa.seccionId}', '${etapa.contenedorId}', ${clienteIdNum})"
                                    style="background: #0f172a; color: #fff; border: none; border-radius: 6px; padding: 6px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                                    👁️ Ver en Bandeja de Abajo
                                </button>
                            ` : ''}
                            <button type="button" onclick="window.abrirModalBolsasCanastoLamda('${c.codigo_canasto}')"
                                style="background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 6px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                                🏷️ Bolsas Vecinos y Etiquetas Zebra (${totalBolsas})
                            </button>
                            ${etapa.codigo === 'ARMAR_CHEQUEO' ? `
                                <button type="button" onclick="window.abrirChequeoDirectoCanastoLamda(${clienteIdNum}, '${c.codigo_canasto}')"
                                    style="background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 6px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                                    🔍 Abrir Chequeo de Pedido
                                </button>
                            ` : ''}
                            ${(etapa.codigo === 'PEDIDO_LISTO_REPARTO' || etapa.codigo === 'RETIRA_DEPOSITO') ? `
                                <button type="button" onclick="window.abrirModalEntregaQrCanastoLamda('${c.codigo_canasto}', ${clienteIdNum})"
                                    style="background: #0d9488; color: #fff; border: none; border-radius: 6px; padding: 6px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                                    📲 Escanear QR Maestro / Entregar al Gestor
                                </button>
                            ` : ''}
                        </div>

                        <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                            <span style="font-size: 11px; font-weight: 700; color: #64748b;">Situar en etapa para probar:</span>
                            <button type="button" onclick="window.cambiarEtapaCanastoLamda('${c.codigo_canasto}', 'IMPRIMIR_CON_FALTANTES')"
                                style="background: ${etapa.codigo === 'IMPRIMIR_CON_FALTANTES' ? '#ea580c' : '#f1f5f9'}; color: ${etapa.codigo === 'IMPRIMIR_CON_FALTANTES' ? '#fff' : '#334155'}; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;"
                                title="Pone el Canasto en Bandeja 1. Imprimir con 2 artículos en Faltante para probar Pizarra Principal y Carro Personal">
                                1. Pizarra / Carro / Imprimir
                            </button>
                            <button type="button" onclick="window.cambiarEtapaCanastoLamda('${c.codigo_canasto}', 'ARMAR_CHEQUEO')"
                                style="background: ${etapa.codigo === 'ARMAR_CHEQUEO' ? '#d97706' : '#f1f5f9'}; color: ${etapa.codigo === 'ARMAR_CHEQUEO' ? '#fff' : '#334155'}; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;"
                                title="Pone el Canasto en Bandeja 2. Armar Pedido con stock completo para probar 🔍 Verificar (Chequeo)">
                                2. Armar / Chequeo
                            </button>
                            <button type="button" onclick="window.cambiarEtapaCanastoLamda('${c.codigo_canasto}', 'PEDIDO_LISTO_REPARTO')"
                                style="background: ${etapa.codigo === 'PEDIDO_LISTO_REPARTO' ? '#2563eb' : '#f1f5f9'}; color: ${etapa.codigo === 'PEDIDO_LISTO_REPARTO' ? '#fff' : '#334155'}; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;"
                                title="Pone el Canasto en Bandeja 3. Pedido Listo y lo habilita en Logística (:3005) para asignar a Ruta de Reparto">
                                3. Listo / Reparto (:3005)
                            </button>
                            <button type="button" onclick="window.cambiarEtapaCanastoLamda('${c.codigo_canasto}', 'RETIRA_DEPOSITO')"
                                style="background: ${etapa.codigo === 'RETIRA_DEPOSITO' ? '#0891b2' : '#f1f5f9'}; color: ${etapa.codigo === 'RETIRA_DEPOSITO' ? '#fff' : '#334155'}; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;"
                                title="Pone el Canasto en Bandeja 4. Retira por Depósito para probar entrega en taller al Gestor">
                                4. Retira Depósito
                            </button>
                            <button type="button" onclick="window.cambiarEtapaCanastoLamda('${c.codigo_canasto}', 'ENTREGADO_GESTOR')"
                                style="background: ${etapa.codigo === 'ENTREGADO_GESTOR' ? '#16a34a' : '#f1f5f9'}; color: ${etapa.codigo === 'ENTREGADO_GESTOR' ? '#fff' : '#334155'}; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;"
                                title="Marca el Canasto como Entregado al Gestor, impactando el débito en Cuenta Corriente">
                                5. Entregado
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        panel.innerHTML = `
            <div style="background: linear-gradient(90deg, #14532d 0%, #166534 100%); color: #ffffff; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 20px;">🏘️</span>
                    <div>
                        <div style="font-size: 15px; font-weight: 800; letter-spacing: 0.2px;">Canastos de Nodos Barriales en el Circuito Operativo de LAMDA</div>
                        <div style="font-size: 12px; color: #bbf7d0;">Integrados en vivo con Pizarra Principal → Configurar Carros / Carro Personal → Imprimir → Armar y Chequeo → Reparto Logística</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <a href="${urlPizarra}" target="_blank" style="background: rgba(255,255,255,0.16); color: #fff; text-decoration: none; padding: 6px 11px; border-radius: 6px; font-size: 12px; font-weight: 700; border: 1px solid rgba(255,255,255,0.3);">
                        1️⃣ Pizarra Principal (:3000) ↗
                    </a>
                    <button type="button" onclick="window.irAConfigurarCarrosNodos()" style="background: rgba(255,255,255,0.16); color: #fff; padding: 6px 11px; border-radius: 6px; font-size: 12px; font-weight: 700; border: 1px solid rgba(255,255,255,0.3); cursor: pointer;">
                        2️⃣ Configurar Carros / Faltantes
                    </button>
                    <a href="/deposito-nodos" target="_blank" style="background: rgba(255,255,255,0.16); color: #fff; text-decoration: none; padding: 6px 11px; border-radius: 6px; font-size: 12px; font-weight: 700; border: 1px solid rgba(255,255,255,0.3);">
                        3️⃣ Mesa Canastos y Etiquetas Zebra ↗
                    </a>
                    <a href="${urlLogistica}" target="_blank" style="background: #fde047; color: #0f172a; text-decoration: none; padding: 6px 11px; border-radius: 6px; font-size: 12px; font-weight: 800;">
                        4️⃣ Reparto y Rutas (:3005) ↗
                    </a>
                    <a href="/liquidacion-nodos" target="_blank" style="background: rgba(255,255,255,0.16); color: #fff; text-decoration: none; padding: 6px 11px; border-radius: 6px; font-size: 12px; font-weight: 700; border: 1px solid rgba(255,255,255,0.3);">
                        5️⃣ Liquidación Cta. Cte. ↗
                    </a>
                </div>
            </div>
            <div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
                ${tarjetasHtml}
            </div>
        `;
    }

    window.irAConfigurarCarrosNodos = function () {
        if (typeof window.forzarExpandirSeccion === 'function') {
            window.forzarExpandirSeccion('carros-panel-content');
        }
        const el = document.querySelector('.carros-panel-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    window.irABandejaCanastoLamda = function (seccionId, contenedorId, clienteId) {
        if (typeof window.forzarExpandirSeccion === 'function') {
            window.forzarExpandirSeccion(seccionId);
        }
        setTimeout(() => {
            if (typeof window.abrirAcordeonEnSeccion === 'function') {
                window.abrirAcordeonEnSeccion(clienteId, contenedorId);
            }
            const cont = document.getElementById(seccionId);
            if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 250);
    };

    window.abrirChequeoDirectoCanastoLamda = function (clienteId, codigoCanasto) {
        if (typeof window.abrirModalArmarPedido === 'function') {
            window.abrirModalArmarPedido(Number(clienteId), String(codigoCanasto));
        }
    };

    window.cambiarEtapaCanastoLamda = async function (codigoCanasto, nuevaEtapa) {
        try {
            const res = await fetch(`/api/produccion/nodos/circuito-lamda/canastos/${encodeURIComponent(codigoCanasto)}/etapa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ etapa: nuevaEtapa })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'No se pudo cambiar la etapa del Canasto');
            }

            estadoCircuitoNodos = data;
            renderizarPanelCircuitoNodos();

            if (typeof window.cargarPedidosPorCliente === 'function') {
                await window.cargarPedidosPorCliente();
            }
            if (typeof window.cargarPedidosArticulos === 'function') {
                await window.cargarPedidosArticulos();
            }
            if (typeof window.actualizarResumenFaltantes === 'function') {
                window.actualizarResumenFaltantes();
            }

            if (typeof window.mostrarToast === 'function') {
                window.mostrarToast(`✅ Canasto ${codigoCanasto} situado en etapa: ${nuevaEtapa}`, 'success');
            }

            // Expandir automáticamente la bandeja correspondiente para que el usuario lo vea en pantalla
            const canastoObj = (data.canastos || []).find(c => c.codigo_canasto === codigoCanasto);
            if (canastoObj) {
                const infoEtapa = describirEtapaActual(canastoObj);
                const clienteIdNum = 9000 + Number(canastoObj.nodo_id);
                if (infoEtapa.seccionId) {
                    setTimeout(() => {
                        window.irABandejaCanastoLamda(infoEtapa.seccionId, infoEtapa.contenedorId, clienteIdNum);
                    }, 400);
                }
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    /**
     * Modal interactivo dentro de produccion.html para ver las bolsas individuales de los vecinos
     * que integran el Canasto, armar/desmarcar cada bolsa y previsualizar sus etiquetas térmicas Zebra + QR Maestro
     */
    window.abrirModalBolsasCanastoLamda = async function (codigoCanasto) {
        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(
            c => c.codigo_canasto === codigoCanasto || String(c.id) === String(codigoCanasto)
        );
        if (!canasto) {
            alert('No se encontró información del Canasto ' + codigoCanasto);
            return;
        }

        const pedidos = canasto.pedidos_vecinos || [];
        const filasPedidos = pedidos.map(p => {
            const itemsTxt = (p.items || []).map(i => `<strong>${i.cantidad}x</strong> ${i.nombre_publico}`).join(' · ');
            const lista = Boolean(p.bolsa_lista);
            return `
                <div style="border: 1px solid ${lista ? '#86efac' : '#cbd5e1'}; background: ${lista ? '#f0fdf4' : '#ffffff'}; border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="text-align: left; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="background: #0f172a; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 4px;">#${p.codigo_pedido}</span>
                            <strong style="font-size: 14px; color: #0f172a;">👤 ${p.vecino_nombre}</strong>
                            <span style="font-size: 11.5px; padding: 2px 8px; border-radius: 99px; font-weight: 700; background: ${lista ? '#dcfce7' : '#fef3c7'}; color: ${lista ? '#166534' : '#92400e'};">
                                ${lista ? '✅ Bolsa en Canasto (ESTACION_NODOS)' : '⏳ Pendiente de Armar'}
                            </span>
                        </div>
                        <div style="font-size: 12.5px; color: #334155; margin-top: 5px;">${itemsTxt}</div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 3px;">
                            ${p.modalidad_entrega === 'ENVIO_BARRIAL' ? `🛵 Envío Barrial (${p.direccion_entrega})` : '🏪 Retira en Nodo'} · Pago: <strong>${p.medio_pago}</strong> (${fmtMoneda(p.total_vecino)})
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <button type="button" onclick="window.armarYVerEtiquetaVecinoDesdeProduccion(${p.id}, '${canasto.codigo_canasto}')"
                            style="background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 7px 11px; font-size: 12px; font-weight: 700; cursor: pointer;">
                            🏷️ ${lista ? 'Ver Etiqueta Zebra Par' : 'Armar Bolsa + Etiqueta Zebra'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        Swal.fire({
            title: `🏘️ Canasto ${canasto.codigo_canasto} — ${canasto.nombre_marca}`,
            width: '820px',
            html: `
                <div style="text-align: left; font-size: 13px;">
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <div><strong>Gestor:</strong> ${canasto.gestor_nombre} · <strong>Ventana:</strong> ${canasto.fecha_entrega_label}</div>
                            <div style="color: #475569; margin-top: 2px;"><strong>4° Depósito Conceptual:</strong> <code>ESTACION_NODOS</code> · Avance: <strong>${canasto.bolsas_armadas}/${canasto.total_bolsas} bolsas listas</strong></div>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button type="button" onclick="window.verQrMaestroCanastoDesdeProduccion(${canasto.id})"
                                style="background: #0f172a; color: #fff; border: none; border-radius: 6px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">
                                🖨️ Ver Etiqueta QR Maestro Canasto
                            </button>
                        </div>
                    </div>
                    <h4 style="margin: 8px 0; color: #0f172a; font-size: 14px;">🛍️ Bolsas Individuales de Vecinos dentro de este Canasto:</h4>
                    <div style="max-height: 360px; overflow-y: auto; padding-right: 4px;">
                        ${filasPedidos || '<p>No hay pedidos vecinales en este canasto.</p>'}
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            confirmButtonText: '✅ Marcar Todas las Bolsas Listas en Canasto',
            cancelButtonText: 'Cerrar'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const res = await fetch(`/api/produccion/nodos/deposito/canastos/${canasto.id}/armar-todo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ operario: 'Equipo Producción LAMDA' })
                    });
                    const data = await res.json();
                    if (data && data.ok) {
                        await cargarEstadoCircuitoNodos();
                        if (typeof window.cargarPedidosPorCliente === 'function') window.cargarPedidosPorCliente();
                        if (data.etiqueta_canasto) {
                            mostrarPreviewEtiquetaZebraSwal(
                                `QR Maestro Canasto ${canasto.codigo_canasto}`,
                                data.etiqueta_canasto.preview_rollo_base64 || data.etiqueta_canasto.preview_data_url,
                                data.etiqueta_canasto.zpl || data.etiqueta_canasto.zpl_code
                            );
                        }
                    }
                } catch (err) {
                    alert('Error al armar bolsas: ' + err.message);
                }
            }
        });
    };

    window.armarYVerEtiquetaVecinoDesdeProduccion = async function (pedidoId, codigoCanasto) {
        try {
            const res = await fetch(`/api/produccion/nodos/deposito/pedidos/${pedidoId}/armar-bolsa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ desmarcar: false, operario: 'Equipo Producción LAMDA' })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al generar etiqueta');

            await cargarEstadoCircuitoNodos();
            if (typeof window.cargarPedidosPorCliente === 'function') window.cargarPedidosPorCliente();

            if (data.etiqueta) {
                mostrarPreviewEtiquetaZebraSwal(
                    `Etiqueta Zebra Par — Pedido #${data.codigo_pedido} (${data.vecino_nombre})`,
                    data.etiqueta.preview_rollo_base64 || data.etiqueta.preview_data_url,
                    data.etiqueta.zpl || data.etiqueta.zpl_code,
                    () => window.abrirModalBolsasCanastoLamda(codigoCanasto)
                );
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    window.verQrMaestroCanastoDesdeProduccion = async function (canastoId) {
        try {
            const res = await fetch(`/api/produccion/nodos/deposito/canastos/${canastoId}/etiqueta-qr`);
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar QR Maestro');

            mostrarPreviewEtiquetaZebraSwal(
                `Etiqueta QR Maestro — ${data.codigo_canasto || 'Canasto'}`,
                data.preview_rollo_base64 || data.preview_data_url,
                data.zpl || data.zpl_code
            );
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    function mostrarPreviewEtiquetaZebraSwal(titulo, previewDataUrl, zplCode, onBack) {
        Swal.fire({
            title: `🖨️ ${titulo}`,
            width: '780px',
            html: `
                <div style="text-align: center;">
                    <div style="background: #f1f5f9; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
                        <img src="${previewDataUrl}" alt="Preview Etiqueta Zebra" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.12);" />
                    </div>
                    <details style="text-align: left; font-size: 12px; color: #475569;">
                        <summary style="cursor: pointer; font-weight: 700;">Ver código térmico ZPL II generado</summary>
                        <pre style="background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; max-height: 160px; overflow-y: auto; font-size: 11px; margin-top: 6px;">${(zplCode || '').replace(/</g, '&lt;')}</pre>
                    </details>
                </div>
            `,
            confirmButtonColor: '#16a34a',
            confirmButtonText: onBack ? '⬅️ Volver al Canasto' : 'Cerrar'
        }).then(() => {
            if (typeof onBack === 'function') onBack();
        });
    }

    /**
     * Modal de Entrega por QR Maestro desde las bandejas "Pedido Listo" o "Retira por Depósito"
     */
    window.abrirModalEntregaQrCanastoLamda = async function (codigoCanasto, clienteId) {
        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(
            c => c.codigo_canasto === codigoCanasto || String(c.id) === String(codigoCanasto)
        );
        if (!canasto) {
            alert('Canasto no encontrado: ' + codigoCanasto);
            return;
        }

        const { value: formValues } = await Swal.fire({
            title: `📲 Entregar Canasto ${canasto.codigo_canasto} al Gestor`,
            width: '620px',
            html: `
                <div style="text-align: left; font-size: 13.5px;">
                    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                        <div><strong>Nodo:</strong> ${canasto.nombre_marca} (Gestor: <strong>${canasto.gestor_nombre}</strong>)</div>
                        <div style="margin-top: 4px;"><strong>Contenido:</strong> ${canasto.total_bolsas} bolsas vecinales (${Number(canasto.total_kilos_lote || 0)} kg)</div>
                        <div style="margin-top: 4px; color: #dc2626;"><strong>Impacto automático en Cuenta Corriente:</strong> Débito por Costo Base LAMDA de <strong>-${fmtMoneda(canasto.total_base_lamda)}</strong></div>
                    </div>
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Código QR Maestro escaneado:</label>
                    <input id="swal-qr-canasto" class="swal2-input" style="margin: 0 0 12px 0; width: 100%; font-family: monospace; font-size: 13px;" value="${canasto.qr_maestro_payload || canasto.codigo_canasto}" />
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Retirado / Recibido por:</label>
                    <input id="swal-retirado-por" class="swal2-input" style="margin: 0; width: 100%; font-size: 13px;" value="${canasto.gestor_nombre}" />
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            confirmButtonText: '✅ Confirmar Entrega y Registrar Débito en Cta. Cte.',
            cancelButtonText: 'Cancelar',
            preConfirm: () => ({
                qr_escaneado: document.getElementById('swal-qr-canasto').value,
                retirado_por: document.getElementById('swal-retirado-por').value
            })
        });

        if (formValues) {
            await window.cambiarEtapaCanastoLamda(canasto.codigo_canasto, 'ENTREGADO_GESTOR');
        }
    };

    /**
     * Inyecta el desglose de bolsas vecinales dentro del modal habitual de Chequeo (#modal-armar-pedido)
     * cuando el operario hace clic en "🔍 Verificar" sobre un Canasto de Nodo Barrial.
     */
    window.inyectarResumenVecinosEnModalChequeo = async function (presupuestoId) {
        const modalBody = document.querySelector('#modal-armar-pedido .modal-body');
        if (!modalBody) return;

        let banner = document.getElementById('banner-chequeo-nodo-barrial');
        if (!String(presupuestoId || '').startsWith('CAN-')) {
            if (banner) banner.style.display = 'none';
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'banner-chequeo-nodo-barrial';
            modalBody.insertBefore(banner, modalBody.firstChild);
        }

        await cargarEstadoCircuitoNodos();
        const canasto = (estadoCircuitoNodos.canastos || []).find(c => c.codigo_canasto === presupuestoId);
        if (!canasto) {
            banner.style.display = 'none';
            return;
        }

        const bolsasHtml = (canasto.pedidos_vecinos || []).map(p =>
            `<span style="background:#ffffff; border:1px solid #86efac; padding:3px 8px; border-radius:6px; font-size:12px;">
                <strong>#${p.codigo_pedido}</strong> ${p.vecino_nombre} (${(p.items || []).reduce((acc, it) => acc + Number(it.cantidad || 0), 0)} u.)
            </span>`
        ).join(' ');

        banner.style.cssText = 'display: block; background: #f0fdf4; border: 1.5px solid #16a34a; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;';
        banner.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                    <div style="font-weight: 800; color: #166534; font-size: 13.5px;">
                        🏘️ Chequeo de Canasto Nodo Barrial: ${canasto.nombre_marca} (${canasto.codigo_canasto})
                    </div>
                    <div style="font-size: 12px; color: #15803d; margin-top: 2px;">
                        Al confirmar el chequeo completo, las <strong>${canasto.total_bolsas} bolsas vecinales</strong> quedan alojadas en <code>ESTACION_NODOS</code> y el Canasto pasa a <strong>Pedido Listo / Reparto (:3005)</strong>.
                    </div>
                </div>
                <button type="button" onclick="window.abrirModalBolsasCanastoLamda('${canasto.codigo_canasto}')"
                    style="background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer;">
                    🏷️ Ver Etiquetas Zebra de Vecinos
                </button>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
                ${bolsasHtml}
            </div>
        `;
    };

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(cargarEstadoCircuitoNodos, 400);
    });

    window.recargarCircuitoNodosLamda = cargarEstadoCircuitoNodos;
})();
