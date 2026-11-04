// --- RutaActivaUI.js ---

function renderizarEntregas() {
    const container = document.getElementById('entregas-container');

    if (!state.entregas || state.entregas.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <h2>Ruta Sin Entregas</h2>
                <p>Esta ruta no tiene entregas asignadas.</p>
                ${state.ruta ? `
                <button onclick="window.abrirModalAgregarPedidos()" style="margin-top: 1.5rem; padding: 12px 20px; background: #8b5cf6; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; width: 100%; box-shadow: 0 4px 6px rgba(139,92,246,0.2);">
                    ➕ Agregar Pedidos
                </button>
                <button onclick="window.eliminarRutaActiva()" style="margin-top: 0.75rem; padding: 12px 20px; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; width: 100%; box-shadow: 0 4px 6px rgba(239,68,68,0.2);">
                    🗑️ Eliminar Hoja de Ruta
                </button>
                ` : ''}
            </div>
        `;
        return;
    }

    const paradas = agruparEntregasEnParadas(state.entregas);

    const totalPedidos = state.entregas.length;
    const estadosFinalizados = ['ENTREGADO', 'RETIRADO', 'RECHAZADO', 'REPROGRAMADO'];
    const completados = state.entregas.filter(e => estadosFinalizados.includes(e.estado_logistico)).length;
    const ruta100Porciento = (totalPedidos > 0 && completados === totalPedidos);

    let routeHeaderHTML = '';
    if (state.ruta) {
        const isArmando = state.ruta.estado === 'ARMANDO';
        
        let headerActionsHTML = '';
        if (ruta100Porciento) {
            headerActionsHTML = `
                <button onclick="finalizarRutaDelDia()" style="background: #dc2626; color: white; padding: 14px 16px; border: none; border-radius: 8px; font-weight: 800; font-size: 1.1rem; box-shadow: 0 4px 6px rgba(220,38,38,0.3); width: 100%; animation: pulse 2s infinite;">
                    🏁 FINALIZAR HOJA DE RUTA
                </button>
            `;
        } else {
            headerActionsHTML = `
                <button onclick="window.toggleEstadoRuta('${isArmando ? 'EN_CAMINO' : 'ARMANDO'}')" style="background: ${isArmando ? '#059669' : '#f59e0b'}; color: white; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%;">
                    ${isArmando ? '🚀 Iniciar Ruta' : '⏹ Detener Ruta'}
                </button>
                ${!isArmando ? `
                <button onclick="window.togglePausaRuta(${!state.ruta.en_pausa})" style="background: ${state.ruta.en_pausa ? '#059669' : '#ea580c'}; color: white; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%;">
                    ${state.ruta.en_pausa ? '▶️ Reanudar Ruta' : '⏸ Pausar Ruta'}
                </button>
                ` : ''}
                ${isArmando ? `
                <button onclick="window.abrirModalAgregarPedidos()" style="background: #8b5cf6; color: white; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%;">
                    ➕ Agregar Pedidos
                </button>` : ''}
                <button onclick="window.abrirModalAcomodar()" style="background: #3b82f6; color: white; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%;">
                    🗺️ Acomodar Ruta
                </button>
            `;
        }

        const bgColor = state.ruta.en_pausa ? '#fffbeb' : 'white';
        const borderColor = state.ruta.en_pausa ? '#ea580c' : (ruta100Porciento ? '#dc2626' : (isArmando ? '#d97706' : '#059669'));
        const textColor = state.ruta.en_pausa ? '#ea580c' : (ruta100Porciento ? '#dc2626' : (isArmando ? '#d97706' : '#059669'));
        const estadoTexto = state.ruta.en_pausa ? '⏸ RUTA EN PAUSA' : (ruta100Porciento ? '100% Completado' : (isArmando ? 'Modo Armado' : '▶ Ruta Iniciada'));

        routeHeaderHTML = `
            <style>
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                    100% { transform: scale(1); }
                }
            </style>
            <div style="margin-bottom: 1.5rem; padding: 12px; background: ${bgColor}; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; flex-direction: ${ruta100Porciento ? 'column' : 'row'}; justify-content: space-between; align-items: ${ruta100Porciento ? 'stretch' : 'center'}; gap: 12px; border-left: 4px solid ${borderColor};">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.8rem; color: #64748b; font-weight: bold; text-transform: uppercase;">Estado Actual</span>
                    <span style="font-weight: 800; color: ${textColor}; font-size: 1.1rem;">
                        ${estadoTexto}
                    </span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${headerActionsHTML}
                </div>
            </div>
        `;
    }

    container.innerHTML = routeHeaderHTML + paradas.map((parada, index) => {
        const esCompletadaTotal = parada.entregas.every(e => ['ENTREGADO', 'RETIRADO', 'RECHAZADO', 'REPROGRAMADO'].includes(e.estado_logistico));
        // Preferir una entrega con dirección válida como cabecera de la parada
        const primerEntrega = parada.entregas.find(e => !(e.es_sobre_efectivo || String(e.id_presupuesto).startsWith('SOB-')) && e.domicilio?.direccion)
            || parada.entregas.find(e => e.domicilio?.direccion)
            || parada.entregas[0];

        const sobresParada = parada.entregas.filter(e => e.es_sobre_efectivo || String(e.id_presupuesto).startsWith('SOB-'));
        const itemsNoSobre = parada.entregas.filter(e => !(e.es_sobre_efectivo || String(e.id_presupuesto).startsWith('SOB-')));
        const tieneSobre = sobresParada.length > 0;
        const esSoloSobre = tieneSobre && itemsNoSobre.length === 0;
        const esVisitaPreventaParada = parada.entregas.some(e => e.es_visita_preventa === true || String(e.id_presupuesto).startsWith('PR-') || e.estado === 'Visita Comercial');

        const esOrdenTratamiento = !esSoloSobre && !esVisitaPreventaParada && primerEntrega.estado === 'Orden de Tratamiento';
        const esOrdenRetiro = !esSoloSobre && !esVisitaPreventaParada && primerEntrega.estado === 'Orden de Retiro';
        const esEntregaTratamientoParada = esOrdenTratamiento && primerEntrega.estado_tratamiento === 'COMPLETADO';
        const esRetiro = !esSoloSobre && !esVisitaPreventaParada && ((esOrdenTratamiento && !esEntregaTratamientoParada) || esOrdenRetiro);

        const claseCard = esCompletadaTotal ? 'entrega-card completada' : 'entrega-card';
        const pendientes = parada.entregas.filter(e => !['ENTREGADO', 'RETIRADO', 'RECHAZADO', 'REPROGRAMADO'].includes(e.estado_logistico)).length;
        const estiloBorde = !esCompletadaTotal
            ? (esVisitaPreventaParada ? 'border-left: 5px solid #ea580c; background: #fff7ed;' : (esSoloSobre ? 'border-left: 5px solid #7c3aed; background: #faf5ff;' : (esRetiro ? 'border-left: 5px solid #d35400;' : (tieneSobre ? 'border-left: 5px solid #7c3aed;' : ''))))
            : '';

        let headerBadgeHTML = esCompletadaTotal 
            ? '<div class="entrega-badge badge-completada">Completada</div>'
            : `<div class="entrega-badge badge-pendiente">${pendientes} Pendiente(s)</div>`;

        let dropdownDomicilios = '';
        if (primerEntrega.domicilios_alternativos && primerEntrega.domicilios_alternativos.length > 1) {
            dropdownDomicilios = `
                <div style="margin-top: 1rem; padding: 10px; background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; box-shadow: 0 2px 4px rgba(59,130,246,0.15);">
                    <label style="display: block; font-size: 0.8rem; color: #1e3a8a; font-weight: 800; margin-bottom: 6px; text-transform: uppercase;">🔄 Destino Alternativo Disponible:</label>
                    <div style="position: relative;">
                        <select onchange="window.cambiarDomicilio(${primerEntrega.cliente.id}, this.value)" style="width: 100%; padding: 12px 35px 12px 12px; font-size: 0.95rem; font-weight: bold; background-color: white; color: #1e3a8a; border: 1px solid #bfdbfe; border-radius: 6px; appearance: none; outline: none; cursor: pointer;">
                            ${primerEntrega.domicilios_alternativos.map(d => `<option value="${d.id}" ${parseInt(d.id) === parseInt(primerEntrega.domicilio.id) ? 'selected' : ''}>📍 ${d.direccion} ${d.localidad ? '('+d.localidad+')' : ''}</option>`).join('')}
                        </select>
                        <div style="position: absolute; right: 12px; top: 14px; pointer-events: none; color: #3b82f6; font-size: 0.9rem; font-weight: bold;">▼</div>
                    </div>
                </div>
            `;
        }

        const pedidosListHTML = parada.entregas.map(entrega => {
            const esSobreItem = entrega.es_sobre_efectivo === true || String(entrega.id_presupuesto).startsWith('SOB-') || entrega.estado === 'Sobre de Efectivo';
            const esVisitaItem = entrega.es_visita_preventa === true || String(entrega.id_presupuesto).startsWith('PR-') || entrega.estado === 'Visita Comercial';
            const completado = ['ENTREGADO', 'RETIRADO', 'RECHAZADO', 'REPROGRAMADO'].includes(entrega.estado_logistico);

            if (esVisitaItem) {
                const codProsp = entrega.codigo_prospecto || entrega.cliente?.id || String(entrega.id_presupuesto);
                const idProspReal = entrega.id_prospecto_real || String(entrega.id_presupuesto).replace('PR-', '');
                const esClienteActivoVisita = entrega.origen_contacto === 'CLIENTE_ACTIVO' || String(entrega.rubro || '').includes('Cliente Activo');
                const enPausa = Boolean(state.ruta && state.ruta.en_pausa);
                const esNoEncontrada = entrega.estado_logistico === 'RECHAZADO'
                    || ['NO_ENCONTRADO', 'NO_CONCRETADA'].includes(entrega.estado_ruta)
                    || entrega.estado_prospecto === 'DESCARTADO'
                    || String(entrega.notas || '').includes('No concretada:');
                const disableVisitaBtn = completado || enPausa;
                const txtVisitaBtn = completado
                    ? (esNoEncontrada ? '🚫 No Encontrado' : '✅ Visitado')
                    : (enPausa ? 'Pausado' : (esClienteActivoVisita ? '✅ Registrar Paso' : '🤝 Registrar Visita'));
                const bgVisitaBtn = completado ? (esNoEncontrada ? '#fee2e2' : '#dcfce7') : (enPausa ? '#cbd5e1' : '#0d9488');
                const colVisitaBtn = completado ? (esNoEncontrada ? '#991b1b' : '#166534') : (enPausa ? '#94a3b8' : 'white');

                return `
                    <div class="pedido-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0.65rem; margin-top: 0.35rem; border-radius: 8px; background: #f0fdfa; border: 1px solid #99f6e4; flex-wrap: wrap; gap: 8px;">
                        <div style="flex: 1; min-width: 160px;">
                            <div style="font-weight: 800; color: #0f766e; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                                <span>${esClienteActivoVisita ? `⭐ Visita a Cliente Activo (${codProsp})` : `🎯 Visita Contacto (${codProsp})`}</span>
                                <span style="font-size: 0.7rem; color: ${completado ? (esNoEncontrada ? '#991b1b' : '#166534') : '#115e59'}; background: ${completado ? (esNoEncontrada ? '#fee2e2' : '#dcfce7') : '#ccfbf1'}; border: 1px solid ${completado ? (esNoEncontrada ? '#fca5a5' : '#bbf7d0') : '#5eead4'}; padding: 2px 6px; border-radius: 4px; font-weight: bold;">
                                    ${completado ? (esNoEncontrada ? '🚫 LOCAL NO ENCONTRADO' : '✅ VISITADO') : (esClienteActivoVisita ? '⭐ Servicio / Sin Pedido' : `🏷️ ${entrega.rubro || 'Comercio'}`)}
                                </span>
                            </div>
                            ${entrega.contacto_nombre || entrega.telefono_whatsapp ? `
                                <div style="font-size: 0.8rem; color: #7c2d12; margin-top: 4px; font-weight: 600;">
                                    ${entrega.contacto_nombre ? `👤 ${entrega.contacto_nombre} (${entrega.contacto_rol || 'Contacto'}) ` : ''}
                                    ${entrega.telefono_whatsapp ? `📱 ${entrega.telefono_whatsapp}` : ''}
                                </div>
                            ` : ''}
                            ${entrega.notas ? `
                                <div style="font-size: 0.76rem; color: #9a3412; margin-top: 4px; background: rgba(255,255,255,0.65); padding: 4px 7px; border-radius: 5px; line-height: 1.3;">
                                    💡 <i>${entrega.notas}</i>
                                </div>
                            ` : ''}
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
                            ${!completado ? `
                            <button class="btn-confirmar-sm" 
                                    onclick="window.quitarPedido('${entrega.id_presupuesto}')" 
                                    style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5;">
                                ❌ Quitar
                            </button>
                            <button class="btn-confirmar-sm" 
                                    onclick="window.registrarVisitaNoConcretadaEnRuta('${idProspReal}')" 
                                    ${enPausa ? 'disabled' : ''}
                                    style="padding: 0.5rem 0.75rem; font-weight: bold; border-radius: 0.5rem; background: #fff1f2; color: #be123c; border: 1px solid #fda4af; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                🚫 No Encontrado
                            </button>
                            ` : ''}
                            <button class="btn-confirmar-sm" 
                                     onclick="window.abrirModalVisitaPreventaEnRuta('${idProspReal}')" 
                                    ${disableVisitaBtn ? 'disabled' : ''}
                                    style="padding: 0.5rem 1rem; font-weight: bold; border-radius: 0.5rem; background: ${bgVisitaBtn}; color: ${colVisitaBtn}; border: none; min-width: 135px; box-shadow: 0 2px 4px rgba(234,88,12,0.2);">
                                ${txtVisitaBtn}
                            </button>
                        </div>
                    </div>
                `;
            }

            if (esSobreItem) {
                const codSobre = entrega.codigo_sobre || String(entrega.id_presupuesto).replace('SOB-', '');
                const idSobreReal = entrega.id_sobre_real || String(entrega.id_presupuesto).replace('SOB-', '');
                const montoSobre = parseFloat(entrega.monto_declarado || 0);
                const tieneFotos = Boolean(entrega.foto_frente_url || entrega.foto_dorso_url);
                const enPausa = Boolean(state.ruta && state.ruta.en_pausa);
                const disableSobreBtn = completado || enPausa;
                const txtSobreBtn = completado ? '✓ Sobre Retirado' : (enPausa ? 'Pausado' : '💵 Retirar Sobre');
                const bgSobreBtn = completado ? '#dcfce7' : (enPausa ? '#cbd5e1' : '#7c3aed');
                const colSobreBtn = completado ? '#166534' : (enPausa ? '#94a3b8' : 'white');

                return `
                    <div class="pedido-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0.6rem; margin-top: 0.35rem; border-radius: 8px; background: #f5f3ff; border: 1px solid #ddd6fe; flex-wrap: wrap; gap: 8px;">
                        <div style="flex: 1; min-width: 150px;">
                            <div style="font-weight: 800; color: #5b21b6; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                                <span>💵 Sobre #${codSobre}</span>
                                <span style="font-size: 0.7rem; color: ${completado ? '#166534' : '#6d28d9'}; background: ${completado ? '#dcfce7' : '#ede9fe'}; border: 1px solid ${completado ? '#bbf7d0' : '#c4b5fd'}; padding: 2px 6px; border-radius: 4px; font-weight: bold;">
                                    ${completado ? '✅ RETIRADO' : '⏳ LISTO P/ RETIRAR'}
                                </span>
                            </div>
                            <div style="font-size: 0.9rem; font-weight: 800; color: #6d28d9; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
                                <span>💰 $${montoSobre.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                ${tieneFotos ? `<button type="button" onclick="window.verFotosSobreMovil('${codSobre}', '${entrega.foto_frente_url || ''}', '${entrega.foto_dorso_url || ''}')" style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; font-weight: bold; cursor: pointer;">📷 Fotos</button>` : ''}
                            </div>
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
                            ${!completado ? `
                            <button class="btn-confirmar-sm" 
                                    onclick="window.quitarPedido('${entrega.id_presupuesto}')" 
                                    style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                ❌ Quitar
                            </button>
                            ` : `
                            <button class="btn-confirmar-sm" 
                                    onclick="window.enviarAvisoSobreRetirado('${idSobreReal}', '${codSobre}')" 
                                    style="padding: 0.5rem 0.75rem; font-weight: bold; border-radius: 0.5rem; background: #25d366; color: white; border: none; box-shadow: 0 2px 4px rgba(37,211,102,0.25);">
                                📲 Avisar WhatsApp
                            </button>
                            `}
                            <button class="btn-confirmar-sm" 
                                    onclick="window.confirmarRetiroSobreEnRuta('${idSobreReal}', '${codSobre}')" 
                                    ${disableSobreBtn ? 'disabled' : ''}
                                    style="padding: 0.5rem 1rem; font-weight: bold; border-radius: 0.5rem; background: ${bgSobreBtn}; color: ${colSobreBtn}; border: none; min-width: 120px; box-shadow: 0 2px 4px rgba(124,58,237,0.2);">
                                ${txtSobreBtn}
                            </button>
                        </div>
                    </div>
                `;
            }

            const esOrdenTratamiento = entrega.estado === 'Orden de Tratamiento';
            const esOrdenRetiro = entrega.estado === 'Orden de Retiro';
            const esEntregaTratamiento = esOrdenTratamiento && entrega.estado_tratamiento === 'COMPLETADO';
            const esItemRetiro = (esOrdenTratamiento && !esEntregaTratamiento) || esOrdenRetiro;
            
            const lomasoft = entrega.comprobante_lomasoft || entrega.id_factura_lomasoft;
            let badgeBillingHTML = '';
            if (!esOrdenTratamiento && !esOrdenRetiro) {
                if (entrega.esta_facturado || lomasoft || entrega.factura_estado === 'APROBADA') {
                    badgeBillingHTML = `<span style="font-size: 0.70rem; color: white; background: #10b981; padding: 2px 6px; border-radius: 4px; font-weight: bold;">🧾 Facturado</span>`;
                } else if (entrega.factura_estado === 'BORRADOR' || entrega.estado === 'Enviado a Facturación') {
                    badgeBillingHTML = `<span style="font-size: 0.70rem; color: white; background: #f59e0b; padding: 2px 6px; border-radius: 4px; font-weight: bold;">📄 Enviado</span>`;
                } else {
                    badgeBillingHTML = `<span style="font-size: 0.70rem; color: white; background: #475569; padding: 2px 6px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="event.stopPropagation(); Swal.fire('Pendiente', 'Pedido pendiente de facturar', 'info')">⏳ Pte. Facturación</span>`;
                }
            }
            const badgeLomasoft = badgeBillingHTML;

            let textoBoton = completado ? (esItemRetiro ? '✓ Retirado' : '✓ Entregado') : (esItemRetiro ? 'Retirar' : 'Entregar');
            let backgroundBoton = completado ? '#dcfce7' : (esItemRetiro ? '#e67e22' : '#2563eb');
            let colorTextoBoton = completado ? '#166534' : 'white';
            
            let detalleRetiroHTML = '';
            let btnCompletarCargaHTML = '';
            let disableMainBtn = completado;

            // Bloqueo táctil por Pausa de Telemetría (Regla de Negocio)
            if (state.ruta && state.ruta.en_pausa) {
                disableMainBtn = true;
                backgroundBoton = '#cbd5e1';
                colorTextoBoton = '#94a3b8';
                textoBoton = 'Pausado';
            }

            if (esOrdenTratamiento) {
                const tieneCheckin = entrega.detalles && entrega.detalles.length > 0;
                
                if (tieneCheckin) {
                    const d = entrega.detalles[0]; // Aggregate array has the JSON payload
                    detalleRetiroHTML = `
                        <div style="font-size: 0.8rem; color: ${esEntregaTratamiento ? '#1e40af' : '#15803d'}; background: ${esEntregaTratamiento ? '#dbeafe' : '#dcfce7'}; padding: 4px 8px; border-radius: 4px; margin-top: 4px; display: inline-block;">
                            ${esEntregaTratamiento ? '📦 Entrega de Tratamiento' : '✅ Check-in Completado'}: <span style="font-weight: normal;">${d.bultos} bulto(s) (${d.kilos}kg) de ${d.descripcion_externa}</span>
                        </div>
                    `;
                    if (!completado && !esEntregaTratamiento) {
                        btnCompletarCargaHTML = `
                            <button class="btn-confirmar-sm" 
                                    onclick="window.abrirModalContingencia('${entrega.hash}', true)" 
                                    style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                ✏️ Modificar
                            </button>
                        `;
                    }
                } else {
                    detalleRetiroHTML = `
                        <div style="font-size: 0.8rem; color: #b45309; background: #fef3c7; padding: 4px 8px; border-radius: 4px; margin-top: 4px; display: inline-block;">
                            ⏳ Check-in Pendiente
                        </div>
                    `;
                    btnCompletarCargaHTML = `
                        <button class="btn-confirmar-sm" 
                                onclick="window.abrirModalContingencia('${entrega.hash}', false)" 
                                style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fef08a; color: #854d0e; border: 1px solid #fde047; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            📝 Completar Carga
                        </button>
                    `;
                    disableMainBtn = true;
                    backgroundBoton = '#cbd5e1';
                    colorTextoBoton = '#94a3b8';
                }
            }

            return `
                <div class="pedido-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; gap: 8px;">
                    <div style="flex: 1; min-width: 140px;">
                        <div style="font-weight: 600; color: #475569; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                            <span>${esOrdenTratamiento ? (esEntregaTratamiento ? '📦 Entrega de Tratamiento #' : '↩️ Orden de Tratamiento #') : (esOrdenRetiro ? '↩️ ORDEN DE RETIRO #' : '📦 Pedido #')}${entrega.id_presupuesto.toString().replace('RT-', '')}</span>
                            ${badgeLomasoft}
                        </div>
                        ${entrega.total ? `<div style="font-size: 0.85rem; color: #059669; margin-top: 4px;">💰 $${parseFloat(entrega.total).toFixed(2)}</div>` : ''}
                        ${detalleRetiroHTML}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
                        ${btnCompletarCargaHTML}
                        ${!completado ? `
                        <button class="btn-confirmar-sm" 
                                onclick="window.quitarPedido('${entrega.id_presupuesto}')" 
                                style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            ❌ Quitar
                        </button>
                        ${!esOrdenTratamiento && !esOrdenRetiro ? `
                        <button class="btn-confirmar-sm" 
                                onclick="window.registrarIncidencia('${entrega.id_presupuesto}')" 
                                style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #ffedd5; color: #ea580c; border: 1px solid #fed7aa; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            ⚠️ No Entregado
                        </button>
                        ` : ''}
                        ` : `
                        ${!esOrdenTratamiento && !esOrdenRetiro ? `
                        <button class="btn-confirmar-sm" 
                                onclick="confirmarEntrega('${entrega.id_presupuesto}', 'entrega')" 
                                style="padding: 0.5rem 0.75rem; font-weight: bold; border-radius: 0.5rem; background: #25d366; color: white; border: none; box-shadow: 0 2px 4px rgba(37,211,102,0.25);">
                            📲 Avisar WhatsApp
                        </button>
                        ` : ''}
                        `}
                        <button class="btn-confirmar-sm" 
                                onclick="confirmarEntrega('${entrega.id_presupuesto}', '${esOrdenTratamiento && !esItemRetiro ? 'entrega_tratamiento' : (esItemRetiro ? 'retiro' : 'entrega')}')" 
                                ${disableMainBtn ? 'disabled' : ''}
                                style="padding: 0.5rem 1rem; font-weight: bold; border-radius: 0.5rem; background: ${backgroundBoton}; color: ${colorTextoBoton}; border: none; min-width: 100px;">
                            ${textoBoton}
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="${claseCard}" data-parada-key="${parada.key}" style="${estiloBorde} box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 1.5rem; transition: all 0.2s ease;">
                <div class="entrega-header" style="margin-top: 8px;">
                    <div class="entrega-numero" style="background: ${esVisitaPreventaParada ? '#ea580c' : (esSoloSobre ? '#7c3aed' : (esRetiro ? '#d35400' : (esEntregaTratamientoParada ? '#2563eb' : '#1e3a8a')))}; opacity: 0.9;">
                        ${index + 1}
                    </div>
                    <div style="flex: 1;">${headerBadgeHTML}</div>
                    <div style="display: flex; gap: 0.25rem;">
                        <button onclick="window.moverParada('${parada.key}', -1)" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↑</button>
                        <button onclick="window.moverParada('${parada.key}', 1)" ${index === paradas.length - 1 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↓</button>
                    </div>
                </div>
                
                <div class="entrega-cliente" style="margin-top: 0.75rem;">
                    <div style="font-size: 1.1rem; font-weight: 800; color: ${esVisitaPreventaParada ? '#c2410c' : '#1e40af'}; margin-bottom: 0.25rem;">
                        [${primerEntrega.cliente.id || 'S/N'}] ${primerEntrega.cliente.nombre || 'Cliente sin nombre'}
                    </div>
                    ${esVisitaPreventaParada ? '<div style="background: #ea580c; color: white; padding: 2px 7px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; display: inline-block; font-weight: bold;">🎯 VISITA DE PREVENTA / PRESENTACIÓN EMPRESA</div>' : ''}
                    ${esSoloSobre ? '<div style="background: #7c3aed; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; display: inline-block; font-weight: bold;">💵 PASO A RETIRAR SOBRE</div>' : ''}
                    ${(!esSoloSobre && tieneSobre) ? '<div style="background: #7c3aed; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; margin-right: 4px; display: inline-block; font-weight: bold;">💵 + RETIRAR SOBRE</div>' : ''}
                    ${esRetiro ? '<div style="background: #e67e22; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; display: inline-block;">RETIRAR</div>' : ''}
                    ${esEntregaTratamientoParada ? '<div style="background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; display: inline-block;">ENTREGA MANTENIMIENTO</div>' : ''}
                </div>
                
                <div class="entrega-direccion" style="margin-top: 0.5rem; padding-bottom: 0.75rem; border-bottom: 2px dashed #e2e8f0; font-size: 0.9rem;">
                    📍 ${primerEntrega.domicilio.direccion || 'Sin dirección'}
                    ${primerEntrega.domicilio.localidad ? `<br><small style="color: #64748b; margin-left: 1.5rem;">${primerEntrega.domicilio.localidad}</small>` : ''}
                    ${dropdownDomicilios}
                </div>
                
                <div class="entregas-lista-interna" style="margin-bottom: 1rem;">
                    ${pedidosListHTML}
                </div>
                
                <div class="entrega-actions">
                    <button class="btn-navegar" onclick="navegarAEntrega(${primerEntrega.domicilio.latitud || 'null'}, ${primerEntrega.domicilio.longitud || 'null'}, '${encodeURIComponent(primerEntrega.domicilio.direccion || '')}')"
                            style="width: 100%; padding: 0.85rem; background: #f8fafc; color: #2563eb; border: 2px solid #bfdbfe; border-radius: 0.5rem; font-weight: bold; font-size: 1rem;">
                        🗺️ Abrir GPS al Domicilio
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.classList.add('fade-in');
}

function agruparEntregasEnParadas(entregas) {
    if (!entregas || entregas.length === 0) return [];

    const normCid = (e) => String(e.cliente?.id || '').trim().replace(/^0+/, '');

    // Mapa auxiliar: vincular sobres con la parada principal del mismo cliente en la ruta
    const domPrincipalPorCliente = new Map();
    entregas.forEach(e => {
        const cid = normCid(e);
        const esSobre = e.es_sobre_efectivo === true || String(e.id_presupuesto).startsWith('SOB-');
        if (cid && e.domicilio?.id && (!domPrincipalPorCliente.has(cid) || !esSobre)) {
            domPrincipalPorCliente.set(cid, e.domicilio.id);
        }
    });

    const paradas = [];
    const mapaParadas = new Map();

    entregas.forEach(entrega => {
        const cid = normCid(entrega);
        const esSobre = entrega.es_sobre_efectivo === true || String(entrega.id_presupuesto).startsWith('SOB-');
        const domId = (esSobre && domPrincipalPorCliente.has(cid))
            ? domPrincipalPorCliente.get(cid)
            : (entrega.domicilio?.id || domPrincipalPorCliente.get(cid) || 'sin_dom');
        const key = `${cid}_${domId}`;

        if (!mapaParadas.has(key)) {
            const nuevaParada = {
                key: key,
                entregas: []
            };
            paradas.push(nuevaParada);
            mapaParadas.set(key, nuevaParada);
        }

        mapaParadas.get(key).entregas.push(entrega);
    });

    return paradas;
}

async function despacharWhatsAppSobreRetiradoMovil(idSobreReal, codigoSobre) {
    // 1. Intentar endpoint directo de móvil
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/sobres-efectivo/${idSobreReal}/notificar-retiro`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.status !== 404) {
            const data = await response.json();
            return {
                enviado: Boolean(data.success && data.whatsapp_enviado),
                destinatarios: data.destinatarios || [],
                error: data.error || null
            };
        }
    } catch (e) {
        console.warn('[SOBRE-WA] Fallback a resolución directa:', e.message);
    }

    // 2. Fallback directo vía /api/logistica/pagos-efectivo/:id + /api/facturacion/whatsapp/enviar-mensaje
    const resSobre = await fetch(`${API_BASE_URL}/api/logistica/pagos-efectivo/${encodeURIComponent(codigoSobre || idSobreReal)}`);
    const dataSobre = await resSobre.json();
    if (!dataSobre.success || !dataSobre.sobre) {
        return { enviado: false, destinatarios: [], error: 'No se pudo obtener la información del sobre.' };
    }

    const sobre = dataSobre.sobre;
    const codFinal = sobre.codigo_sobre || codigoSobre;
    const nombreCliente = sobre.cliente_nombre_fantasia || sobre.cliente_razon_social || sobre.colaborador_nombre || 'Cliente';

    let telefonos = [];
    if (sobre.cliente_telefono) {
        try {
            const parsed = typeof sobre.cliente_telefono === 'string' && sobre.cliente_telefono.trim().startsWith('[')
                ? JSON.parse(sobre.cliente_telefono)
                : null;
            if (Array.isArray(parsed)) {
                parsed.forEach(c => {
                    if (c && c.numero && c.enviar_alerta !== false) {
                        telefonos.push(String(c.numero).trim());
                    }
                });
                if (telefonos.length === 0) {
                    parsed.forEach(c => {
                        if (c && c.numero) telefonos.push(String(c.numero).trim());
                    });
                }
            } else {
                const digits = String(sobre.cliente_telefono).replace(/\D/g, '');
                if (digits.length >= 8) telefonos.push(digits);
            }
        } catch (errP) {
            const digits = String(sobre.cliente_telefono).replace(/\D/g, '');
            if (digits.length >= 8) telefonos.push(digits);
        }
    }
    if (telefonos.length === 0 && sobre.colaborador_telefono) {
        const digits = String(sobre.colaborador_telefono).replace(/\D/g, '');
        if (digits.length >= 8) telefonos.push(digits);
    }

    if (telefonos.length === 0) {
        return { enviado: false, destinatarios: [], error: 'El cliente no tiene número de WhatsApp configurado.' };
    }

    const mensajeTexto = `💵 *Sobre Retirado*\n\nHola *${nombreCliente}*, te avisamos que ya fue retirado el sobre *#${codFinal}*.\n\n¡Muchas gracias!\n*LAMDA*`;
    let enviados = 0;
    const errores = [];

    for (const destino of telefonos) {
        try {
            const resWa = await fetch(`${API_BASE_URL}/api/facturacion/whatsapp/enviar-mensaje`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destino,
                    mensajeTexto
                })
            });
            const dataWa = await resWa.json().catch(() => ({}));
            if (resWa.ok && dataWa.success) {
                enviados++;
            } else {
                errores.push(dataWa.error || dataWa.message || `Error HTTP ${resWa.status}`);
            }
        } catch (errWa) {
            errores.push(errWa.message);
        }
    }

    return {
        enviado: enviados > 0,
        destinatarios: telefonos,
        error: errores.join(' | ') || null
    };
}

window.confirmarRetiroSobreEnRuta = async (idSobreReal, codigoSobre) => {
    const resConfirm = await Swal.fire({
        title: `💵 Retirar Sobre #${codigoSobre}`,
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #334155;">
                <p style="margin: 0 0 10px 0;">¿Confirma que recibió el sobre físico de efectivo en el domicilio del cliente?</p>
                <div style="background: #f5f3ff; border: 1px dashed #c4b5fd; border-radius: 6px; padding: 8px 10px; font-size: 0.8rem; color: #5b21b6;">
                    📲 <strong>Aviso corto por WhatsApp:</strong><br>
                    <em>"💵 Sobre Retirado — Hola, te avisamos que ya fue retirado el sobre #${codigoSobre}. ¡Muchas gracias! LAMDA"</em>
                </div>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '📢 Retirar y Avisar WhatsApp',
        denyButtonText: '💾 Solo Retirar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#7c3aed',
        denyButtonColor: '#059669',
        cancelButtonColor: '#64748b'
    });
    if (!resConfirm.isConfirmed && !resConfirm.isDenied) return;

    const notificarWa = resConfirm.isConfirmed;

    Swal.fire({
        title: notificarWa ? 'Retirando sobre y avisando...' : 'Registrando retiro...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/sobres-efectivo/${idSobreReal}/retirar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notificar: notificarWa })
        });
        const data = await response.json();
        if (data.success) {
            let waOk = Boolean(data.whatsapp_enviado);
            let waErr = (data.whatsapp_errores || []).join(', ');
            if (notificarWa && data.whatsapp_enviado === undefined) {
                const fallbackWa = await despacharWhatsAppSobreRetiradoMovil(idSobreReal, codigoSobre);
                waOk = fallbackWa.enviado;
                waErr = fallbackWa.error || '';
            }
            await Swal.fire({
                icon: 'success',
                title: '💵 ¡Sobre Retirado!',
                text: notificarWa
                    ? (waOk
                        ? `El sobre #${codigoSobre} quedó retirado y se envió el aviso por WhatsApp al cliente.`
                        : `El sobre #${codigoSobre} quedó retirado (no se pudo enviar WhatsApp: ${waErr || 'sin número'}).`)
                    : `El sobre #${codigoSobre} quedó registrado como retirado en ruta.`,
                timer: 2300,
                showConfirmButton: false
            });
            await cargarRutaActiva();
        } else {
            Swal.fire('Error', data.error || 'No se pudo registrar el retiro del sobre.', 'error');
        }
    } catch (err) {
        console.error('[SOBRE] Error al retirar sobre:', err);
        Swal.fire('Error de Red', 'No se pudo conectar con el servidor.', 'error');
    }
};

window.enviarAvisoSobreRetirado = async (idSobreReal, codigoSobre) => {
    const resConfirm = await Swal.fire({
        title: `📲 Avisar Sobre Retirado`,
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #334155;">
                <p style="margin: 0 0 10px 0;">Se enviará el aviso corto por WhatsApp al cliente confirmando el retiro del sobre <strong>#${codigoSobre}</strong> (sin mencionar montos):</p>
                <div style="background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 6px; padding: 10px; font-size: 0.85rem; color: #065f46;">
                    💵 <strong>Sobre Retirado</strong><br>
                    Hola, te avisamos que ya fue retirado el sobre <strong>#${codigoSobre}</strong>.<br>
                    ¡Muchas gracias! <strong>LAMDA</strong>
                </div>
            </div>
        `,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: '📲 Enviar WhatsApp Ahora',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#25d366',
        cancelButtonColor: '#64748b'
    });
    if (!resConfirm.isConfirmed) return;

    Swal.fire({
        title: 'Enviando WhatsApp...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const resultadoWa = await despacharWhatsAppSobreRetiradoMovil(idSobreReal, codigoSobre);
        if (resultadoWa.enviado) {
            await Swal.fire({
                icon: 'success',
                title: '📲 ¡WhatsApp Enviado!',
                text: `Se envió el aviso de Sobre Retirado (#${codigoSobre}) a ${(resultadoWa.destinatarios || []).join(', ')}.`,
                timer: 2200,
                showConfirmButton: false
            });
        } else {
            Swal.fire('No se pudo enviar', resultadoWa.error || 'Verifique que el cliente tenga WhatsApp cargado y el servicio activo.', 'warning');
        }
    } catch (err) {
        console.error('[SOBRE-WA] Error al enviar aviso:', err);
        Swal.fire('Error de Red', 'No se pudo conectar con el servidor.', 'error');
    }
};

window.registrarVisitaNoConcretadaEnRuta = async (idProspectoReal) => {
    const item = state.entregas.find(e => String(e.id_prospecto_real) === String(idProspectoReal) || String(e.id_presupuesto) === `PR-${idProspectoReal}`);
    const nombreComercio = item?.cliente?.nombre || 'Comercio';
    const notasPrevias = (item?.notas || '').trim();

    const { value: formNoConcretada } = await Swal.fire({
        title: `🚫 Visita No Concretada`,
        html: `
            <div style="text-align: left; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.88rem;">
                <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 0.5rem; padding: 0.6rem 0.75rem; color: #9f1239;">
                    🏪 <b>${nombreComercio}</b><br>
                    📍 <span style="font-size: 0.8rem;">${item?.domicilio?.direccion || 'Sin dirección'}</span>
                </div>

                <div>
                    <label style="font-weight: 700; color: #334155; font-size: 0.8rem; display: block; margin-bottom: 4px;">Motivo por el que no se concretó la visita:</label>
                    <select id="swal-no-visita-motivo" style="width: 100%; padding: 0.65rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.9rem; font-weight: 700; color: #1e293b; background: white;">
                        <option value="No encontré físicamente el local" selected>📍 No encontré físicamente el local</option>
                        <option value="Local cerrado / Sin atención en este horario">🔒 Local cerrado / Sin atención en este horario</option>
                        <option value="El comercio ya no existe / Cerró definitivamente">🏚️ El comercio ya no existe / Cerró</option>
                        <option value="Rubro distinto / No trabaja nuestra línea">🏷️ Rubro distinto / No corresponde</option>
                    </select>
                </div>

                <div>
                    <label style="font-weight: 700; color: #334155; font-size: 0.8rem; display: block; margin-bottom: 4px;">📝 Observación adicional (opcional):</label>
                    <input id="swal-no-visita-notas" type="text" placeholder="Ej: En esa numeración hay una casa particular..." style="width: 100%; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.85rem; box-sizing: border-box;">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '🚫 Asentar como No Encontrado',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        preConfirm: () => {
            const motivoSel = document.getElementById('swal-no-visita-motivo').value;
            const obsExtra = document.getElementById('swal-no-visita-notas').value.trim();
            const fechaHoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const prefijo = `[Visita en Ruta ${fechaHoyStr} - No concretada: ${motivoSel}]`;
            const notasCompuestas = [prefijo, obsExtra, notasPrevias].filter(Boolean).join(' | ');
            return {
                no_concretada: true,
                motivo_no_concretada: motivoSel,
                estado: 'DESCARTADO',
                notas: notasCompuestas,
                enviar_catalogo_whatsapp: false
            };
        }
    });

    if (!formNoConcretada) return;

    Swal.fire({
        title: 'Asentando parada...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/prospectos/${idProspectoReal}/visita-ruta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formNoConcretada)
        });
        const data = await res.json();
        if (data.success) {
            await Swal.fire({
                icon: 'success',
                title: '🚫 Parada Asentada',
                text: `Se registró "${formNoConcretada.motivo_no_concretada}" para ${nombreComercio}. La parada quedó asentada en la Hoja de Ruta.`,
                timer: 2200,
                showConfirmButton: false
            });
            await cargarRutaActiva();
        } else {
            Swal.fire('Error', data.error || 'No se pudo asentar la parada.', 'error');
        }
    } catch (err) {
        Swal.fire('Error de Red', err.message, 'error');
    }
};

window.abrirModalVisitaPreventaEnRuta = async (idProspectoReal) => {
    const item = state.entregas.find(e => String(e.id_prospecto_real) === String(idProspectoReal) || String(e.id_presupuesto) === `PR-${idProspectoReal}`);
    const nombreComercio = item?.cliente?.nombre || 'Comercio';
    const esClienteActivoVisita = item?.origen_contacto === 'CLIENTE_ACTIVO' || String(item?.rubro || '').includes('Cliente Activo');
    const contactoActual = item?.contacto_nombre || '';
    const rolActual = item?.contacto_rol || 'ENCARGADO';
    const telActual = item?.telefono_whatsapp || '';
    const emailActual = item?.email || '';
    const notasActuales = item?.notas || '';

    if (esClienteActivoVisita) {
        const { value: formCliValues } = await Swal.fire({
            title: `⭐ Visita a Cliente: ${nombreComercio}`,
            html: `
                <div style="text-align: left; display: flex; flex-direction: column; gap: 0.65rem; font-size: 0.86rem;">
                    <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 0.5rem; padding: 0.6rem 0.75rem; color: #0f766e; font-size: 0.8rem;">
                        📍 <b>${item?.domicilio?.direccion || 'Domicilio del Cliente'}</b><br>
                        <span style="color: #115e59;">🤝 Visita de atención comercial / servicio (Sin pedido activo, sin factura ni retiro)</span>
                    </div>
                    <div>
                        <label style="font-weight: 700; color: #334155; font-size: 0.78rem;">📝 Nota u observación de la visita (opcional)</label>
                        <textarea id="swal-visita-notas" rows="3" placeholder="Ej: Pasé por el local a saludar y ver si necesitaban mercadería..." style="width: 100%; padding: 0.55rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.84rem; margin-top: 4px; box-sizing: border-box;">${notasActuales}</textarea>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '✅ Registrar que pasé por el Cliente',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0d9488',
            cancelButtonColor: '#64748b',
            preConfirm: () => {
                return {
                    contacto_nombre: contactoActual || 'Cliente Activo',
                    contacto_rol: 'CLIENTE',
                    telefono_whatsapp: telActual,
                    email: emailActual,
                    notas: document.getElementById('swal-visita-notas').value.trim() || 'Visita de servicio / contacto realizada en ruta.',
                    fecha_revisita: null,
                    enviar_catalogo_whatsapp: false
                };
            }
        });
        if (!formCliValues) return;

        Swal.fire({
            title: 'Registrando paso por cliente...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const res = await fetch(`${API_BASE_URL}/api/logistica/prospectos/${idProspectoReal}/visita-ruta`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formCliValues)
            });
            const data = await res.json();
            if (data.success) {
                await Swal.fire({
                    icon: 'success',
                    title: '⭐ ¡Paso por Cliente Registrado!',
                    text: `Se dejó constancia en la Hoja de Ruta que pasaste por "${nombreComercio}".`,
                    timer: 2000,
                    showConfirmButton: false
                });
                await cargarRutaActiva();
            } else {
                Swal.fire('Error', data.error || 'No se pudo registrar la visita.', 'error');
            }
        } catch (err) {
            Swal.fire('Error de Red', err.message, 'error');
        }
        return;
    }

    const { value: formValues } = await Swal.fire({
        title: `🎯 Visita: ${nombreComercio}`,
        html: `
            <div style="text-align: left; display: flex; flex-direction: column; gap: 0.65rem; font-size: 0.85rem;">
                <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 0.5rem; padding: 0.5rem 0.65rem; color: #9a3412; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span>📍 <b>${item?.domicilio?.direccion || 'Sin dirección'}</b> • 🏷️ ${item?.rubro || 'Comercio'}</span>
                    <button type="button" onclick="Swal.close(); window.registrarVisitaNoConcretadaEnRuta('${idProspectoReal}');" style="background: #fee2e2; color: #be123c; border: 1px solid #fda4af; border-radius: 5px; padding: 4px 8px; font-size: 0.74rem; font-weight: 800; cursor: pointer;">
                        🚫 No encontré el local
                    </button>
                </div>

                <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 0.45rem;">
                    <div>
                        <label style="font-weight: 700; color: #334155; font-size: 0.75rem;">👤 ¿Quién te atendió?</label>
                        <input id="swal-visita-contacto" type="text" value="${contactoActual.replace(/"/g, '&quot;')}" placeholder="Ej: Lucía / Fiambrería" style="width: 100%; padding: 0.55rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.85rem; margin-top: 2px;">
                    </div>
                    <div>
                        <label style="font-weight: 700; color: #334155; font-size: 0.75rem;">Rol / Sector</label>
                        <select id="swal-visita-rol" style="width: 100%; padding: 0.55rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.82rem; margin-top: 2px;">
                            <option value="ENCARGADO" ${rolActual === 'ENCARGADO' ? 'selected' : ''}>Encargado/a</option>
                            <option value="DUEÑO" ${rolActual === 'DUEÑO' ? 'selected' : ''}>Dueño/a</option>
                            <option value="FIAMBRERIA_MOSTRADOR" ${rolActual === 'FIAMBRERIA_MOSTRADOR' ? 'selected' : ''}>Fiambrería / Mostrador</option>
                            <option value="COMPRADOR" ${rolActual === 'COMPRADOR' ? 'selected' : ''}>Compras</option>
                            <option value="EMPLEADO" ${rolActual === 'EMPLEADO' ? 'selected' : ''}>Empleado/a</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label style="font-weight: 700; color: #334155; font-size: 0.75rem;">📱 WhatsApp / Teléfono (para enviar Lista PDF)</label>
                    <input id="swal-visita-tel" type="tel" value="${telActual.replace(/"/g, '&quot;')}" placeholder="Ej: 221 555-1234" style="width: 100%; padding: 0.55rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.9rem; font-weight: 700; margin-top: 2px;">
                </div>

                <label style="display: flex; align-items: center; gap: 0.5rem; background: #ecfdf5; border: 1px solid #6ee7b7; padding: 0.55rem 0.65rem; border-radius: 0.5rem; cursor: pointer; color: #065f46; font-weight: 700; font-size: 0.8rem;">
                    <input type="checkbox" id="swal-visita-enviar-wa" checked style="width: 18px; height: 18px; accent-color: #059669;">
                    <span>📄 Enviar Lista Mayorista PDF por WhatsApp al guardar (si tiene N°)</span>
                </label>

                <div>
                    <label style="font-weight: 700; color: #334155; font-size: 0.75rem;">📝 Notas de la visita / Qué productos buscan</label>
                    <textarea id="swal-visita-notas" rows="3" placeholder="Ej: Pasé hoy, me atendió la chica de fiambrería. Dejé lista, volver martes a la mañana..." style="width: 100%; padding: 0.55rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.82rem; margin-top: 2px;">${notasActuales}</textarea>
                </div>

                <div>
                    <label style="font-weight: 700; color: #334155; font-size: 0.75rem;">📅 Agendar próxima visita (opcional)</label>
                    <input id="swal-visita-fecha" type="datetime-local" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.45rem; font-size: 0.82rem; margin-top: 2px;">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '✅ Confirmar Visita Realizada',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ea580c',
        cancelButtonColor: '#64748b',
        preConfirm: () => {
            return {
                contacto_nombre: document.getElementById('swal-visita-contacto').value.trim(),
                contacto_rol: document.getElementById('swal-visita-rol').value,
                telefono_whatsapp: document.getElementById('swal-visita-tel').value.trim(),
                email: emailActual,
                notas: document.getElementById('swal-visita-notas').value.trim(),
                fecha_revisita: document.getElementById('swal-visita-fecha').value || null,
                enviar_catalogo_whatsapp: document.getElementById('swal-visita-enviar-wa').checked
            };
        }
    });

    if (!formValues) return;

    Swal.fire({
        title: 'Guardando visita...',
        html: formValues.enviar_catalogo_whatsapp && formValues.telefono_whatsapp
            ? 'Registrando visita y enviando Catálogo PDF por WhatsApp...'
            : 'Actualizando Hoja de Ruta...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/prospectos/${idProspectoReal}/visita-ruta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formValues)
        });
        const data = await res.json();
        if (data.success) {
            await Swal.fire({
                icon: 'success',
                title: '🤝 ¡Visita Registrada!',
                text: data.whatsapp_enviado
                    ? 'Se marcó la parada como visitada y se envió el catálogo PDF por WhatsApp.'
                    : 'La visita comercial quedó asentada en la Hoja de Ruta y en Preventa.',
                timer: 2200,
                showConfirmButton: false
            });
            await cargarRutaActiva();
        } else {
            Swal.fire('Error', data.error || 'No se pudo registrar la visita.', 'error');
        }
    } catch (err) {
        Swal.fire('Error de Red', err.message, 'error');
    }
};

window.cambiarDomicilio = (clienteId, nuevoDomicilioId) => {
    state.entregas.forEach(e => {
        if (parseInt(e.cliente.id) === parseInt(clienteId) && e.domicilios_alternativos) {
            const nuevoObj = e.domicilios_alternativos.find(d => parseInt(d.id) === parseInt(nuevoDomicilioId));
            if (nuevoObj) {
                e.domicilio = nuevoObj;

                // Fire & Forget: Alertar en background al server del persist
                fetch(`${API_BASE_URL}/api/logistica/movil/pedidos/${e.id_presupuesto}/domicilio`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_domicilio_entrega: nuevoObj.id })
                }).catch(err => console.error("Error silencioso mutando domicilio físico", err));
            }
        }
    });
    renderizarEntregas();
};

window.moverParada = async (paradaKey, direccion) => {
    const paradas = agruparEntregasEnParadas(state.entregas);
    const index = paradas.findIndex(p => p.key === paradaKey);
    
    if (index === -1) return;
    if (direccion === -1 && index === 0) return;
    if (direccion === 1 && index === paradas.length - 1) return;
    
    // Intercambiar
    const nuevaPosicion = index + direccion;
    const temp = paradas[index];
    paradas[index] = paradas[nuevaPosicion];
    paradas[nuevaPosicion] = temp;
    
    // Aplicar a vector y renderizar
    state.entregas = paradas.flatMap(p => p.entregas);
    renderizarEntregas();
    
    // Guardar vía backend silencioso
    const nuevoOrdenIds = state.entregas.map(e => {
        const val = String(e.id_presupuesto);
        return (val.startsWith('RT-') || val.startsWith('SOB-') || val.startsWith('PR-')) ? val : parseInt(val);
    });
    try {
        await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/reordenar`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: nuevoOrdenIds })
        });
    } catch(err) { 
        console.error('Fallo Network en Reordenamiento:', err); 
    }
};

function navegarAEntrega(latitud, longitud, direccion) {
    if (!latitud || !longitud || latitud === 'null' || longitud === 'null') {
        alert('❌ Esta entrega no tiene coordenadas GPS válidas para navegar.');
        return;
    }

    const direccionEncoded = encodeURIComponent(decodeURIComponent(direccion));
    const link = `https://www.google.com/maps/dir/?api=1&destination=${latitud},${longitud}&destination_place_id=${direccionEncoded}`;

    console.log('[NAVEGACION] Abriendo Google Maps:', link);
    window.open(link, '_blank');
}

function confirmarEntrega(presupuestoId, tipoPedido = 'entrega') {
    console.log('[ENTREGA] Confirmar', tipoPedido, 'de presupuesto:', presupuestoId);

    // FASE 3 Intercepción: Retiros de Mantenimiento
    if (tipoPedido === 'retiro' && String(presupuestoId).startsWith('RT-')) {
        const idOrden = presupuestoId.replace('RT-', '');
        const ordenData = state.entregas.find(e => e.id_presupuesto === presupuestoId);
        
        if (ordenData.estado_logistico === 'PENDIENTE_CLIENTE') {
            // Carga Manual (Contingencia)
            window.abrirContingenciaRetiro(idOrden, ordenData);
            return;
        } else if (ordenData.estado_logistico === 'PENDIENTE_VALIDACION') {
            // Validar Visualmente
            window.abrirValidarRetiro(idOrden, ordenData);
            return;
        }
    }

    // Para entregas de pedidos estándar, unificar con el flujo completo de Registro de Conformidad + Aviso WhatsApp (igual al escaneo QR)
    if (tipoPedido === 'entrega' && !String(presupuestoId).startsWith('RT-')) {
        onScanSuccess(String(presupuestoId));
        return;
    }

    import('../modules/confirmacion.js').then(module => {
        module.mostrarModalOpciones(presupuestoId, tipoPedido);
    }).catch(error => {
        console.error('[ENTREGA] Error al cargar módulo:', error);
        alert('❌ Error crítico al cargar módulo de confirmación: ' + (error.message || error));
    });
}

function finalizarRutaDelDia() {
    import('../modules/ruta.js').then(module => {
        module.finalizarRutaDelDia();
    }).catch(error => {
        console.error('[RUTA] Error al cargar módulo:', error);
        alert('Error al cargar módulo de ruta');
    });
}

// -------------------------------------------------------------
// Controladores de Vida Operativa de Ruta (Fase 11)
// -------------------------------------------------------------

window.toggleEstadoRuta = async (nuevoEstado) => {
    if (!state.ruta) return;

    if (nuevoEstado !== 'EN_CAMINO') {
        // Detener ruta / Volver a modo armado
        const resConfirm = await Swal.fire({
            title: '⏹ Detener Ruta',
            text: '¿Desea detener la ruta y regresar a MODO ARMADO para editar pedidos?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, Detener Ruta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#f59e0b',
            cancelButtonColor: '#64748b'
        });
        if (!resConfirm.isConfirmed) return;

        try {
            const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/estado`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });
            const data = await res.json();
            if (data.success) {
                state.ruta.estado = nuevoEstado;
                renderizarEntregas(); 
            } else Swal.fire('Error', data.error || 'No se pudo cambiar el estado', 'error');
        } catch(err) {
            console.error('[TOGGLE ESTADO] Error de red:', err);
            Swal.fire('Error de Red', 'No se pudo conectar con el servidor. Verifique su conexión.', 'error');
        }
        return;
    }

    // Caso INICIAR RUTA (nuevoEstado === 'EN_CAMINO'):
    // 1. Consultar clientes y destinatarios para el modal de inicio
    Swal.fire({
        title: 'Preparando ruta...',
        html: '<div style="font-size:0.9rem; color:#64748b;">Obteniendo clientes y datos de contacto...</div>',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    let clientesRuta = [];
    try {
        const resp = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/destinatarios-inicio`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const d = await resp.json();
        if (d.success && Array.isArray(d.clientes)) {
            clientesRuta = d.clientes;
        }
    } catch (e) {
        console.warn('[INICIAR-RUTA] Error consultando destinatarios de inicio:', e.message);
    }

    // Si no hay clientes cargados en la ruta
    if (clientesRuta.length === 0) {
        const resSimple = await Swal.fire({
            title: '🚀 Iniciar Ruta',
            text: '¿Desea iniciar la ruta de reparto ahora?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, Iniciar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            cancelButtonColor: '#64748b'
        });
        if (!resSimple.isConfirmed) return;

        try {
            const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/estado`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: 'EN_CAMINO', notificar_clientes: false })
            });
            const data = await res.json();
            if (data.success) {
                state.ruta.estado = 'EN_CAMINO';
                renderizarEntregas();
            } else Swal.fire('Error', data.error || 'No se pudo iniciar la ruta', 'error');
        } catch(err) {
            Swal.fire('Error de Red', err.message, 'error');
        }
        return;
    }

    // 2. Construir modal interactivo con selección de clientes
    const conWhatsApp = clientesRuta.filter(c => c.tiene_whatsapp);
    let cantSeleccionados = conWhatsApp.length;

    const listaHtml = clientesRuta.map((c, idx) => {
        const partesBadge = [];
        if (Array.isArray(c.pedidos) && c.pedidos.length > 0) partesBadge.push(`📦 Pedido #${c.pedidos.join(', #')}`);
        if (Array.isArray(c.retiros) && c.retiros.length > 0) partesBadge.push(`🔄 Retiro #${c.retiros.join(', #')}`);
        if (Array.isArray(c.sobres) && c.sobres.length > 0) partesBadge.push(`💵 Sobre #${c.sobres.join(', #')}`);
        if (c.tipo_parada === 'VISITA_COMERCIAL') partesBadge.push(`🎯 Presentación Empresa`);

        let badgeStyle = 'background: #dcfce7; color: #166534;';
        if (c.tipo_parada === 'VISITA_COMERCIAL') badgeStyle = 'background: #ffedd5; color: #c2410c; border: 1px solid #fdba74;';
        else if (c.tipo_parada === 'SOLO_SOBRE') badgeStyle = 'background: #ede9fe; color: #5b21b6;';
        else if (c.tipo_parada === 'SOLO_RETIRO') badgeStyle = 'background: #ffedd5; color: #c2410c;';
        else if (partesBadge.length > 1) badgeStyle = 'background: #e0e7ff; color: #3730a3;';

        const badgeTipo = `<span style="${badgeStyle} padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold;">${partesBadge.join(' + ')}</span>`;

        const asuntoMail = encodeURIComponent(`Presentación LAMDA - Distribuidora Mayorista (${c.nombre})`);
        const cuerpoMail = encodeURIComponent(`Hola equipo de ${c.nombre},\n\nLes escribimos de LAMDA (Elaboradores y Distribuidores Mayoristas de Frutos Secos, Granolas, Barritas y Cereales en Gran La Plata).\n\nHoy vamos a andar recorriendo la zona de ${c.zona || 'su barrio'} y teníamos pensado pasar unos minutos por el local para saludarlos, presentarles brevemente la empresa y acercarles nuestra lista mayorista.\n\n¡Quedamos atentos, muchas gracias!\nEquipo LAMDA`);

        const infoContacto = c.tiene_whatsapp
            ? `<div style="font-size: 0.75rem; color: #059669; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                 <span>📱</span> <span>${c.destinatarios.map(d => `${d.nombre}: ${d.numero}`).join(' • ')}</span>
                 ${c.tiene_email ? `<a href="mailto:${c.email}?subject=${asuntoMail}&body=${cuerpoMail}" style="color:#2563eb; text-decoration:underline; margin-left:4px;">✉️ ${c.email}</a>` : ''}
               </div>`
            : (c.tiene_email
                ? `<div style="font-size: 0.74rem; color: #2563eb; font-weight: bold; margin-top: 2px;">
                     ✉️ Sin WhatsApp • <a href="mailto:${c.email}?subject=${asuntoMail}&body=${cuerpoMail}" style="color:#2563eb; text-decoration:underline;">Enviar correo a ${c.email}</a>
                   </div>`
                : `<div style="font-size: 0.72rem; color: #dc2626; font-weight: bold; margin-top: 2px;">
                     ⚠️ ${c.tipo_parada === 'VISITA_COMERCIAL' ? 'Visita presencial en frío (sin teléfono aún)' : 'Sin WhatsApp configurado'}
                   </div>`);

        return `
            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-bottom: 1px solid #f1f5f9; background: ${c.tiene_whatsapp ? '#ffffff' : '#f8fafc'}; text-align: left;">
                <input type="checkbox" 
                       class="chk-cliente-inicio" 
                       data-id="${c.cliente_id}" 
                       ${c.tiene_whatsapp ? 'checked' : 'disabled'}
                       style="margin-top: 3px; width: 18px; height: 18px; cursor: pointer; accent-color: #059669; flex-shrink: 0;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="font-weight: 700; font-size: 0.88rem; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${idx + 1}. ${c.nombre}
                        </span>
                        ${badgeTipo}
                    </div>
                    <div style="font-size: 0.76rem; color: #64748b; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        📍 ${c.direccion}
                    </div>
                    ${infoContacto}
                </div>
            </div>
        `;
    }).join('');

    const modalHtml = `
        <div style="font-family: inherit; width: 100%; box-sizing: border-box;">
            <p style="font-size: 0.88rem; color: #475569; margin: 0 0 12px 0; text-align: center;">
                Seleccione a qué clientes desea notificar por WhatsApp que la logística está en camino:
            </p>

            <div style="display: flex; justify-content: space-between; align-items: center; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px;">
                <span id="txt-contador-modal" style="font-size: 0.8rem; font-weight: bold; color: #334155;">
                    Notificar: ${cantSeleccionados} de ${clientesRuta.length} clientes
                </span>
                <div style="display: flex; gap: 6px;">
                    <button type="button" id="btn-modal-sel-todos" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; color: #334155; cursor: pointer;">
                        Todos
                    </button>
                    <button type="button" id="btn-modal-des-todos" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; color: #334155; cursor: pointer;">
                        Ninguno
                    </button>
                </div>
            </div>

            <div style="max-height: 240px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
                ${listaHtml}
            </div>

            <div style="margin-top: 10px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 8px; font-size: 0.75rem; color: #64748b; text-align: left;">
                💬 <strong>Mensaje corto a enviar:</strong><br>
                <em>"Hola {Cliente}, le avisamos que nuestro chofer ya inició el recorrido de entregas de hoy y su orden se encuentra en camino. ¡Pronto estaremos allí!"</em>
            </div>
        </div>
    `;

    const result = await Swal.fire({
        title: '🚀 Iniciar Hoja de Ruta',
        html: modalHtml,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: `🚀 Iniciar y Notificar (${cantSeleccionados})`,
        denyButtonText: '⏩ Iniciar sin Notificar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#059669',
        denyButtonColor: '#64748b',
        cancelButtonColor: '#94a3b8',
        customClass: {
            confirmButton: 'swal2-confirm swal2-styled',
            denyButton: 'swal2-deny swal2-styled',
            cancelButton: 'swal2-cancel swal2-styled'
        },
        didOpen: () => {
            const getCheckboxes = () => document.querySelectorAll('.chk-cliente-inicio:not(:disabled)');
            const updateCount = () => {
                const checked = document.querySelectorAll('.chk-cliente-inicio:checked');
                cantSeleccionados = checked.length;
                const txtCont = document.getElementById('txt-contador-modal');
                if (txtCont) txtCont.innerText = `Notificar: ${cantSeleccionados} de ${clientesRuta.length} clientes`;
                
                const btnConfirm = Swal.getConfirmButton();
                if (btnConfirm) {
                    btnConfirm.innerText = `🚀 Iniciar y Notificar (${cantSeleccionados})`;
                }
            };

            document.querySelectorAll('.chk-cliente-inicio').forEach(chk => {
                chk.addEventListener('change', updateCount);
            });

            document.getElementById('btn-modal-sel-todos')?.addEventListener('click', () => {
                getCheckboxes().forEach(c => c.checked = true);
                updateCount();
            });

            document.getElementById('btn-modal-des-todos')?.addEventListener('click', () => {
                getCheckboxes().forEach(c => c.checked = false);
                updateCount();
            });
        }
    });

    if (!result.isConfirmed && !result.isDenied) {
        // Cancelado
        return;
    }

    const notificar = result.isConfirmed;
    const selectedIds = notificar 
        ? Array.from(document.querySelectorAll('.chk-cliente-inicio:checked')).map(el => el.getAttribute('data-id'))
        : [];

    Swal.fire({
        title: 'Iniciando ruta...',
        html: notificar && selectedIds.length > 0
            ? 'Actualizando estado y despachando avisos de WhatsApp en segundo plano...'
            : 'Actualizando estado de la ruta...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/estado`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: 'EN_CAMINO',
                notificar_clientes: notificar,
                clientes_ids: selectedIds
            })
        });
        const data = await res.json();
        
        if (data.success) {
            state.ruta.estado = 'EN_CAMINO';
            renderizarEntregas();

            Swal.fire({
                icon: 'success',
                title: '🚀 ¡Ruta Iniciada!',
                text: notificar && selectedIds.length > 0 
                    ? `Ruta en camino. Notificando por WhatsApp a ${selectedIds.length} clientes en segundo plano.` 
                    : 'Ruta iniciada correctamente sin emitir notificaciones.',
                timer: 2500,
                showConfirmButton: false
            });
        } else {
            Swal.fire('Error', data.error || 'No se pudo iniciar la ruta', 'error');
        }
    } catch(err) {
        console.error('[INICIAR RUTA] Error de red:', err);
        Swal.fire('Error de Red', 'No se pudo conectar con el servidor. Verifique su conexión.', 'error');
    }
};

window.quitarPedido = async (idPresupuesto) => {
    if (!confirm("¿Está seguro que desea devolver este pedido a PENDIENTES? (Se desvinculará de la hoja de ruta)")) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/pedidos/${idPresupuesto}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const data = await res.json();
        if (data.success) {
            // Eliminar de state local y renderizar
            state.entregas = state.entregas.filter(e => e.id_presupuesto != idPresupuesto);
            renderizarEntregas();
        } else alert("Error: " + data.error);
    } catch(err) { alert("Error de red."); }
};

window.registrarIncidencia = async (idPresupuesto) => {
    const { value: motivo } = await Swal.fire({
        title: '❌ Registrar Incidencia',
        input: 'select',
        inputOptions: {
            'Local Cerrado/Ausente': 'Local Cerrado/Ausente',
            'Rechazo Total': 'Rechazo Total',
            'Siniestro/Problema Técnico': 'Siniestro/Problema Técnico',
            'Reprogramado': 'Reprogramado'
        },
        inputPlaceholder: 'Seleccione un motivo...',
        showCancelButton: true,
        confirmButtonText: 'Registrar Incidencia',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ea580c',
        cancelButtonColor: '#64748b',
        inputValidator: (value) => {
            return new Promise((resolve) => {
                if (value) {
                    resolve();
                } else {
                    resolve('Debe seleccionar un motivo obligatoriamente');
                }
            });
        }
    });

    if (!motivo) return;

    let latitud = null;
    let longitud = null;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                latitud = pos.coords.latitude;
                longitud = pos.coords.longitude;
            },
            err => console.warn('[GPS] Error en gps de incidencia:', err.message),
            { timeout: 2000, enableHighAccuracy: true }
        );
    }

    Swal.fire({
        title: 'Registrando incidencia...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/entregas/incidencia`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_presupuesto: idPresupuesto,
                motivo: motivo,
                latitud: latitud,
                longitud: longitud
            })
        });

        const resData = await response.json();
        Swal.close();

        if (resData.success) {
            await Swal.fire({
                icon: 'success',
                title: '¡Incidencia Registrada!',
                text: 'El pedido fue devuelto a la base con su motivo registrado.',
                confirmButtonColor: '#ea580c'
            });
            if (typeof window.cargarRutaActiva === 'function') {
                await window.cargarRutaActiva();
            } else if (typeof cargarRutaActiva === 'function') {
                await cargarRutaActiva();
            } else {
                state.entregas = state.entregas.filter(e => e.id_presupuesto != idPresupuesto);
                renderizarEntregas();
            }
        } else {
            Swal.fire('Error', resData.error || 'No se pudo registrar la incidencia', 'error');
        }
    } catch (err) {
        Swal.close();
        console.error('[INCIDENCIA] Error de red:', err);
        Swal.fire('Error de Red', 'No se pudo conectar con el servidor.', 'error');
    }
};

window.eliminarRutaActiva = async () => {
    if (!confirm("⚠️ ATENCIÓN: ¿Está absolutamente seguro de ELIMINAR toda la hora de ruta? Solo se permite si no hay pedidos adosados.")) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const data = await res.json();
        if (data.success) {
            alert("Ruta eliminada con éxito.");
            window.location.reload(); // Hard reset
        } else alert("Error: " + data.error);
    } catch(err) { alert("Error de red."); }
};

// ==========================================
// FEATURE: Agregar Pedidos desde Ruta Activa
// Permite inyectar pedidos pendientes sin
// abandonar la vista de la ruta actual.
// ==========================================

/**
 * Abre un modal tipo slide-over con la lista de pedidos
 * pendientes disponibles para asignar a la ruta activa.
 * Reutiliza el endpoint GET /pedidos-pendientes y
 * PUT /rutas/:id/asignar del backend.
 */
window.abrirModalAgregarPedidos = async () => {
    if (!state.ruta) return alert('No hay una ruta activa para agregar pedidos.');

    // Crear el modal de carga inmediatamente para feedback visual
    const modalId = 'modal-agregar-pedidos';
    const modalHtml = `
    <div id="${modalId}" class="modal-mobile" style="display: flex;">
        <div class="modal-content-mobile" style="padding: 0; max-height: 90vh; display: flex; flex-direction: column;">
            <!-- Cabecera fija -->
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                <h2 style="font-size: 1.15rem; margin: 0; color: #1e293b;">➕ Agregar Pedidos a Ruta</h2>
                <button onclick="document.getElementById('${modalId}').remove()" style="background: none; border: none; font-size: 1.5rem; color: #64748b; cursor: pointer;">&times;</button>
            </div>
            <!-- Cuerpo scrollable -->
            <div id="agregar-pedidos-lista" style="flex: 1; overflow-y: auto; padding: 1rem;">
                <div class="loading-screen" style="padding: 2rem; text-align: center;"><div class="spinner"></div><p>Buscando pendientes...</p></div>
            </div>
            <!-- Pie fijo con botón de confirmar -->
            <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; flex-shrink: 0; background: #f8fafc;">
                <button id="btn-confirmar-agregar" onclick="window.ejecutarAgregarPedidos()" disabled style="width: 100%; padding: 0.875rem; background: #8b5cf6; color: white; border: none; border-radius: 0.5rem; font-weight: bold; font-size: 1rem; opacity: 0.5; box-shadow: 0 4px 6px -1px rgba(139, 92, 246, 0.2);">
                    📌 Agregar Seleccionados (0)
                </button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Obtener pendientes del servidor
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/pedidos-pendientes`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await response.json();
        const listaContainer = document.getElementById('agregar-pedidos-lista');

        if (result.success && result.data && result.data.length > 0) {
            // Filtrar pedidos que ya están en la ruta activa
            const idsEnRuta = new Set(state.entregas.map(e => String(e.id_presupuesto)));
            const disponibles = result.data.filter(p => !idsEnRuta.has(String(p.id)));

            if (disponibles.length === 0) {
                listaContainer.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: #64748b;">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">✅</div>
                        <p>Todos los pedidos ya están asignados a esta ruta.</p>
                    </div>`;
                return;
            }

            listaContainer.innerHTML = disponibles.map(p => {
                const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
                const esVisita = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
                const esIngreso = !esSobre && !esVisita && (p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
                const iconColor = esVisita ? '#ea580c' : (esSobre ? '#7c3aed' : (esIngreso ? '#dc2626' : '#2563eb'));
                const bgRow = esVisita ? 'background: #fff7ed;' : (esSobre ? 'background: #faf5ff;' : '');
                const labelTitulo = esVisita
                    ? `🎯 VISITA COMERCIAL (${p.codigo_prospecto || p.id}) • ${p.rubro || 'Comercio'}`
                    : (esSobre
                        ? `💵 SOBRE #${p.codigo_sobre || String(p.id).replace('SOB-', '')} ($${parseFloat(p.monto_declarado || p.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })})`
                        : `${esIngreso ? (p.estado === 'Orden de Retiro' ? '↩️ ORDEN DE RETIRO #' : '↩️ Orden de Tratamiento #') : '📦 Pedido #'}${p.id}`);
                return `
                <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-bottom: 1px solid #f1f5f9; ${bgRow}">
                    <input type="checkbox" class="chk-agregar-pedido" value="${p.id}" onchange="window.actualizarBtnAgregar()" style="width: 22px; height: 22px; accent-color: #8b5cf6; flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; color: ${iconColor}; font-size: 0.95rem;">${labelTitulo}</div>
                        <div style="font-size: 0.9rem; color: #334155; margin-top: 2px;">👤 <strong>[${p.cliente_id || p.id_cliente || 'S/N'}]</strong> ${p.cliente_nombre}</div>
                        <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">📍 ${p.domicilio_direccion || 'Sin domicilio'}</div>
                    </div>
                </div>`;
            }).join('');
        } else {
            listaContainer.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #64748b;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
                    <p>No hay pedidos pendientes disponibles.</p>
                </div>`;
        }
    } catch (error) {
        console.error('[AGREGAR] Error al obtener pendientes:', error);
        document.getElementById('agregar-pedidos-lista').innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #ef4444;">❌ Error de conexión</div>`;
    }
};

/**
 * Actualiza el texto y estado del botón "Agregar Seleccionados"
 * según la cantidad de checkboxes tildados en el modal.
 */
window.actualizarBtnAgregar = () => {
    const seleccionados = document.querySelectorAll('.chk-agregar-pedido:checked');
    const btn = document.getElementById('btn-confirmar-agregar');
    if (!btn) return;
    if (seleccionados.length > 0) {
        btn.innerHTML = `📌 Agregar Seleccionados (${seleccionados.length})`;
        btn.disabled = false;
        btn.style.opacity = '1';
    } else {
        btn.innerHTML = `📌 Agregar Seleccionados (0)`;
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }
};

/**
 * Ejecuta la asignación de los pedidos seleccionados a la ruta activa.
 * Llama al endpoint PUT /rutas/:id/asignar y recarga la vista.
 */
window.ejecutarAgregarPedidos = async () => {
    const seleccionados = Array.from(document.querySelectorAll('.chk-agregar-pedido:checked')).map(cb => {
        const val = String(cb.value);
        return (val.startsWith('RT-') || val.startsWith('SOB-') || val.startsWith('PR-')) ? val : parseInt(val);
    });
    if (seleccionados.length === 0) return;

    const btn = document.getElementById('btn-confirmar-agregar');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Asignando...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/asignar`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids_presupuestos: seleccionados })
        });
        const result = await response.json();

        if (result.success) {
            // Cerrar modal y recargar la ruta activa con los nuevos pedidos
            document.getElementById('modal-agregar-pedidos').remove();
            alert(`✅ Se agregaron ${seleccionados.length} pedido(s) a la ruta.`);
            cargarRutaActiva();
        } else {
            alert(result.error || 'No se pudieron asignar los pedidos.');
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    } catch (error) {
        console.error('[AGREGAR] Error al asignar:', error);
        alert('Error de conexión al asignar pedidos.');
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
};

// ==========================================
// FEATURE FASE 3: RETIROS DE MANTENIMIENTO
// ==========================================

window.descargarYCompartirPDF = async (hash, isShareContext = false) => {
    let btnId = isShareContext ? `btn-pdf-share-${hash}` : `btn-pdf-view-${hash}`;
    let btn = document.getElementById(btnId);
    let originalText = btn ? btn.innerHTML : '';
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Generando documento...';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/tratamientos/print/${hash}`);
        if (!response.ok) throw new Error('Fallo al obtener el documento PDF');
        
        const blob = await response.blob();
        const file = new File([blob], `Tratamiento_${hash}.pdf`, { type: 'application/pdf' });

        if (isShareContext) {
            // Contexto: Compartir vía WhatsApp o mail usando Web Share API
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Certificado de Retiro/Entrega`,
                    text: `Adjunto el informe de la Orden de Tratamiento referenciado.`
                });
            } else {
                // Fallback para navs sin soporte a Web Share con archivos
                Swal.fire({
                    title: 'Aviso',
                    text: 'Su navegador no soporta adjuntar archivos directamente a WhatsApp. Le descargaremos el PDF para que pueda enviarlo manualmente.',
                    icon: 'info'
                });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Tratamiento_${hash}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
            }
        } else {
            // Contexto: Generar y ver
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');
        }
    } catch (e) {
        Swal.fire('Error', 'No se pudo generar o compartir el informe. Verifique su red.', 'error');
        console.error(e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

window.abrirValidarRetiro = (idOrden, ordenData) => {
    let htmlDetalles = '<div style="margin-bottom: 1rem; color: #64748b; font-size: 0.9rem;">No hay detalles pre-cargados por el cliente. Deberá usar contingencia.</div>';
    
    if (ordenData.detalles && ordenData.detalles.length > 0) {
        htmlDetalles = ordenData.detalles.map(d => `
            <div style="background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #3b82f6;">
                <div style="font-weight: bold; color: #1e293b;">${d.descripcion_externa}</div>
                <div style="color: #64748b; font-size: 0.85rem; margin-top: 4px;">⚖️ ${d.kilos} Kg &nbsp;|&nbsp; 📦 ${d.bultos} Bultos</div>
            </div>
        `).join('');
    }

    Swal.fire({
        title: '✔️ Validar Retiro',
        html: `
            <div style="text-align: left;">
                <p><strong>Cliente:</strong> ${ordenData.cliente.nombre}</p>
                <div style="margin-top: 15px;">
                    <strong style="color: #475569; display: block; margin-bottom: 8px;">Mercadería a Retirar:</strong>
                    ${htmlDetalles}
                </div>
            </div>
        `,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Validar y Retirar',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            window.ejecutarValidacionRetiro(idOrden, ordenData.hash);
        }
    });
};

window.ejecutarValidacionRetiro = async (idOrden, hash) => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/retiros/${idOrden}/validar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const data = await response.json();
        if (data.success) {
            await Swal.fire({
                title: '✅ ¡Retirado!',
                html: `
                    <p style="margin-bottom: 20px;">El retiro ha sido marcado como EN CAMINO.</p>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button onclick="descargarYCompartirPDF('${hash}', false)" id="btn-pdf-view-${hash}"
                                style="padding: 12px; background: #dc2626; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
                            📄 Generar Informe PDF
                        </button>
                        <button onclick="descargarYCompartirPDF('${hash}', true)" id="btn-pdf-share-${hash}"
                                style="padding: 12px; background: #25D366; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
                            💬 Compartir Archivo por WhatsApp
                        </button>
                    </div>
                `,
                icon: 'success',
                showConfirmButton: true,
                confirmButtonText: 'Cerrar'
            });
            cargarRutaActiva();
        } else Swal.fire('Error', data.error || 'No se pudo validar el retiro', 'error');
    } catch(err) { Swal.fire('Error', 'Falla de conexión de Red', 'error'); }
};

window.abrirContingenciaRetiro = (idOrden, ordenData) => {
    Swal.fire({
        title: '⚠️ Carga Contingencia (Manual)',
        html: `
            <div style="text-align: left;">
                <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 1rem;">El cliente no completó el Pre-Checkin. Ingrese los bultos percibidos.</p>
                <input id="swal-desc" class="swal2-input" placeholder="Descripción de la mercancía" style="width: 80%; display: flex; box-sizing: border-box; margin: 0 auto 10px auto;">
                <div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 15px;">
                    <input id="swal-kilos" type="number" class="swal2-input" placeholder="Kilos (Ej: 21.5)" step="0.1" style="width: 45%; margin:0;">
                    <input id="swal-bultos" type="number" class="swal2-input" placeholder="Bultos" style="width: 45%; margin:0;">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar y Retirar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                desc: document.getElementById('swal-desc').value,
                kilos: document.getElementById('swal-kilos').value.replace(',', '.'),
                bultos: document.getElementById('swal-bultos').value
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const val = result.value;
            if (!val.kilos || !val.bultos) return Swal.fire('Error', 'Debe especificar Kilos y Bultos', 'error');
            try {
                const response = await fetch(`${API_BASE_URL}/api/logistica/movil/retiros/${idOrden}/contingencia`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ descripcion_externa: val.desc || 'S/D', kilos: parseFloat(val.kilos), bultos: parseFloat(val.bultos) })
                });
                const data = await response.json();
                if (data.success) {
                    Swal.fire('✅ Contingencia Exitosa', 'El retiro subió al camión.', 'success');
                    cargarRutaActiva();
                } else Swal.fire('Error', data.error, 'error');
            } catch(err) { Swal.fire('Error de Red', err.toString(), 'error'); }
        }
    });
};

// ==========================================
// FEATURE FASE 3: GENERAR QR (ASISTENTE)
// ==========================================

window.abrirAsistenteInmunizacionChofer = () => {
    window.cerrarSidebar();
    
    let htmlContent = `
        <div style="text-align: left;">
            <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 1rem;">Busque al cliente para crear el registro y enviarle el panel de Check-In a su celular.</p>
            <input id="swal-cliente-search" class="swal2-input" placeholder="Nombre del Cliente" style="width: 100%; box-sizing: border-box; margin: 0 auto 10px auto;" autocomplete="off">
            <div id="swal-cliente-results" style="max-height: 150px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: left; position: relative;"></div>
        </div>
    `;

    Swal.fire({
        title: '🦠 Generar QR Tratamiento',
        html: htmlContent,
        showCancelButton: true,
        showConfirmButton: false, // The user selects from the list directly
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const inputElement = document.getElementById('swal-cliente-search');
            let timeoutToken;
            inputElement.addEventListener('input', (e) => {
                clearTimeout(timeoutToken);
                const query = e.target.value.trim();
                if (query.length < 3) {
                    document.getElementById('swal-cliente-results').innerHTML = '';
                    return;
                }
                timeoutToken = setTimeout(async () => {
                    const resultsBox = document.getElementById('swal-cliente-results');
                    resultsBox.innerHTML = '<div style="padding: 10px; color:#64748b;">Buscando...</div>';
                    try {
                        const res = await fetch(`${API_BASE_URL}/api/logistica/tratamientos/clientes?q=${encodeURIComponent(query)}`);
                        const data = await res.json();
                        if (data.success && data.data.length > 0) {
                            resultsBox.innerHTML = data.data.map(c => `
                                <div onclick="window.generarQRChoferPayload(${c.id}, '${c.nombre.replace(/'/g, "\\'")}')" style="padding: 10px; border-bottom: 1px solid #e2e8f0; cursor: pointer; color:#1e293b; font-weight: bold;">
                                    ${c.nombre} ${c.apellido || ''} <span style="font-size: 0.75rem; color:#64748b; font-weight: normal;">[#${c.id}]</span>
                                </div>
                            `).join('');
                        } else {
                            resultsBox.innerHTML = '<div style="padding: 10px; color:#64748b;">Sin resultados</div>';
                        }
                    } catch(err) {
                        resultsBox.innerHTML = '<div style="padding: 10px; color:#ef4444;">Error de red</div>';
                    }
                }, 400);
            });
        }
    });
};

window.generarQRChoferPayload = async (idCliente, nombreCliente) => {
    Swal.close();
    Swal.fire({ title: 'Generando registro...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/tratamientos/generar-qr-chofer`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_cliente: idCliente, id_ruta: state.ruta ? state.ruta.id : null })
        });
        const data = await response.json();
        
        if (data.success) {
            Swal.fire({
                title: '⚡ ¡Link Generado!',
                icon: 'success',
                html: `
                    <div style="font-size: 1rem; color: #1e293b;">La sesión para <b>${nombreCliente}</b> está abierta.</div>
                    <div style="margin-top: 15px;">
                        <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(`Hola! Por favor confirma los datos de tu retiro de mercadería aquí: ${data.data.url}`)}" 
                           target="_blank" style="display:inline-block; padding: 10px 20px; background: #25d366; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; width: 80%;">
                           📱 Enviar por WhatsApp
                        </a>
                    </div>
                `,
                confirmButtonText: 'Cerrar'
            }).then(() => {
                cargarRutaActiva(); // Reload the route immediately so the new PENDIENTE_CLIENTE item shows up visually
            });
        } else {
            Swal.fire('Error', data.error, 'error');
        }
    } catch(err) { Swal.fire('Error', 'Fallo conexión con origen', 'error'); }
};


// --- Carga Contingente Dinámica (Check-in Chofer) ---

window.abrirModalContingencia = async (hash, esEdicion) => {
    try {
        // Guard: validate hash
        if (!hash || hash === 'null' || hash === 'undefined') {
            Swal.fire('Error de Datos', 'Esta orden no tiene un código QR/hash asociado. Contacte al administrador para regenerarlo.', 'error');
            return;
        }

        const modal = document.getElementById('modal-contingencia-checkin');
        const form = document.getElementById('form-contingencia-checkin');
        const hashInput = document.getElementById('checkin-hash');

        // Guard: DOM elements must exist
        if (!modal || !form || !hashInput) {
            console.error('[MODAL] Elemento(s) del modal no encontrado(s) en el DOM:', { modal: !!modal, form: !!form, hashInput: !!hashInput });
            Swal.fire('Error de UI', 'El formulario de Check-in no está disponible en esta vista.', 'error');
            return;
        }
        
        // ALWAYS load chofer dropdown first (before reset to avoid visual flash)
        const selectChofer = document.getElementById('checkin-chofer-nombre');
        try {
            if (!state.choferes || state.choferes.length === 0) {
                const sesion = JSON.parse(localStorage.getItem('sesion_chofer') || '{}');
                const resChoferes = await fetch(`${API_BASE_URL}/api/logistica/usuarios/choferes`, {
                    headers: sesion.token ? { 'Authorization': `Bearer ${sesion.token}` } : {}
                });
                const dataChoferes = await resChoferes.json();
                if (dataChoferes.success) state.choferes = dataChoferes.data;
            }
            if (state.choferes && state.choferes.length > 0) {
                selectChofer.innerHTML = '<option value="">Seleccione Chofer</option>' +
                    state.choferes.map(c => `<option value="${c.nombre_completo}">${c.nombre_completo}</option>`).join('');
            }
        } catch(e) { console.error('[MODAL] Error cargando dropdown choferes:', e); }

        if (esEdicion) {
            // EDIT MODE: fetch saved data first, then populate (no form.reset())
            Swal.fire({ title: 'Cargando datos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const response = await fetch(`${API_BASE_URL}/api/logistica/tratamientos/sesion/${hash}`);
            const data = await response.json();
            
            Swal.close();
            
            if (data.success && data.data) {
                const d = data.data;
                const det = d.detalles || {};
                // Populate all fields with saved values
                hashInput.value = hash;
                document.getElementById('checkin-descripcion').value = det.descripcion_externa || '';
                document.getElementById('checkin-kilos').value = det.kilos || '';
                document.getElementById('checkin-bultos').value = det.bultos || '';
                document.getElementById('checkin-motivo').value = det.motivo || '';
                document.getElementById('checkin-responsable-nombre').value = d.responsable_nombre || '';
                document.getElementById('checkin-responsable-apellido').value = d.responsable_apellido || '';
                document.getElementById('checkin-responsable-celular').value = d.responsable_celular || '';
                // Set chofer in dropdown
                if (d.chofer_nombre) selectChofer.value = d.chofer_nombre;
                // Set datetime from saved value, fallback to now
                if (d.fecha_validacion_chofer) {
                    const fd = new Date(d.fecha_validacion_chofer);
                    fd.setMinutes(fd.getMinutes() - fd.getTimezoneOffset());
                    document.getElementById('checkin-fecha').value = fd.toISOString().slice(0,16);
                } else {
                    const ahora = new Date();
                    ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
                    document.getElementById('checkin-fecha').value = ahora.toISOString().slice(0,16);
                }
            } else {
                // Fetch failed — reset and open blank for manual entry
                form.reset();
                hashInput.value = hash;
                const ahora = new Date();
                ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
                document.getElementById('checkin-fecha').value = ahora.toISOString().slice(0,16);
            }
        } else {
            // NEW CHECK-IN MODE: reset form, set defaults
            form.reset();
            hashInput.value = hash;
            const ahora = new Date();
            ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
            document.getElementById('checkin-fecha').value = ahora.toISOString().slice(0,16);
            // Pre-select the route's assigned chofer
            if (state.ruta && state.ruta.chofer) {
                selectChofer.value = state.ruta.chofer.nombre_completo;
            }
        }
        
        modal.style.display = 'flex';
    } catch (error) {
        Swal.fire('Error', 'Fallo al inicializar el modal de contingencia', 'error');
    }
};

window.cerrarModalContingencia = () => {
    document.getElementById('modal-contingencia-checkin').style.display = 'none';
};

window.guardarCheckinContingencia = async (event) => {
    event.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-contingencia');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    const hash = document.getElementById('checkin-hash').value;
    
    // Captura y Sanitización
    const kilosRaw = document.getElementById('checkin-kilos').value.trim();
    const kilosVal = parseFloat(kilosRaw.replace(',', '.'));
    const bultosVal = parseInt(document.getElementById('checkin-bultos').value);

    if (isNaN(kilosVal) || kilosVal <= 0) {
        Swal.fire('Atención', 'Los Kilos deben ser expresados en valores numéricos mayores a 0', 'warning');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
        return;
    }

    const payload = {
        descripcion_externa: document.getElementById('checkin-descripcion').value.trim(),
        kilos: kilosVal,
        bultos: bultosVal,
        motivo: document.getElementById('checkin-motivo').value.trim(),
        responsable_nombre: document.getElementById('checkin-responsable-nombre').value.trim(),
        responsable_apellido: document.getElementById('checkin-responsable-apellido').value.trim(),
        responsable_celular: document.getElementById('checkin-responsable-celular').value.trim(),
        chofer_nombre: document.getElementById('checkin-chofer-nombre').value.trim(),
        fecha_evento: document.getElementById('checkin-fecha').value
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/tratamientos/chofer/checkin/${hash}`, {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            window.cerrarModalContingencia();
            Swal.fire('¡Carga Completada!', 'El check-in se ha guardado exitosamente.', 'success');
            
            // Recargar Ruta Activa para refrescar visualmente las tarjetas y el estado de los botones
            cargarRutaActiva();
        } else {
            throw new Error(data.error || 'Error al persistir contingencia');
        }

    } catch (error) {
        Swal.fire('Falla de Red', error.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
    }
};

// ==========================================
// FEATURE: ESCÁNER DE CÓDIGO QR PARA ENTREGAS
// ==========================================
let html5QrcodeScanner = null;

window.abrirScanner = () => {
    document.getElementById('modal-scanner-qr').style.display = 'flex';
    
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("scanner-reader");
    }
    
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        console.error("No se pudo iniciar la cámara:", err);
        Swal.fire("Error de Cámara", "No se pudo acceder a la cámara trasera. Asegúrese de otorgar los permisos necesarios.", "error");
        window.cerrarScanner();
    });
};

window.cerrarScanner = () => {
    document.getElementById('modal-scanner-qr').style.display = 'none';
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().catch(err => console.error("Error al detener la cámara:", err));
    }
};

async function onScanSuccess(decodedText, decodedResult) {
    console.log(`[SCANNER] Código detectado: ${decodedText}`);
    
    // Cerrar escáner para evitar lecturas múltiples consecutivas
    window.cerrarScanner();
    
    // Buscar patrón UUID o extraer identificador desde URL/Query/Hash escaneado
    const uuidMatch = decodedText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    let token = uuidMatch ? uuidMatch[0] : decodedText.trim();
    if (!uuidMatch && (token.includes('http://') || token.includes('https://') || token.includes('/') || token.includes('?') || token.includes('='))) {
        try {
            const urlObj = new URL(token);
            const paramCandidate = urlObj.searchParams.get('id') || urlObj.searchParams.get('token') || urlObj.searchParams.get('hash') || urlObj.searchParams.get('pedido') || urlObj.searchParams.get('qr');
            if (paramCandidate) {
                token = paramCandidate.trim();
            } else if (urlObj.hash && urlObj.hash.length > 1) {
                token = urlObj.hash.substring(1).replace(/^\/+/, '').trim();
            } else {
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                if (pathParts.length > 0) token = pathParts[pathParts.length - 1].trim();
            }
        } catch (e) {
            const rawParts = token.split(/[/?&#=]/).filter(Boolean);
            if (rawParts.length > 0) token = rawParts[rawParts.length - 1].trim();
        }
    }
    
    // Normalizar token en cliente (quitar sufijo de bulto si existe)
    let baseToken = token;
    const packageMatch = token.match(/^([0-9]+)-[0-9]+$/);
    if (packageMatch) {
        baseToken = packageMatch[1];
    }

    // Resolver ID local del presupuesto (soportando id_presupuesto, id_presupuesto_ext y supabase_pedido_id de remito QR)
    let localBudgetId = null;
    const baseTokenLower = String(baseToken || '').toLowerCase();
    const foundEntrega = state.entregas.find(e => 
        String(e.id_presupuesto) === String(baseToken) || 
        (e.hash && String(e.hash).toLowerCase() === baseTokenLower) || 
        (e.id_presupuesto_ext && String(e.id_presupuesto_ext).toLowerCase() === baseTokenLower) ||
        (e.supabase_pedido_id && String(e.supabase_pedido_id).toLowerCase() === baseTokenLower)
    );
    if (foundEntrega) {
        localBudgetId = foundEntrega.id_presupuesto;
        if (foundEntrega.estado_logistico === 'ENTREGADO' || foundEntrega.estado_logistico === 'RECHAZADO' || foundEntrega.estado_logistico === 'PENDIENTE_CLIENTE') {
            const isConfirm = await Swal.fire({
                title: '⚠️ Pedido ya Procesado',
                html: `Este pedido ya fue registrado como <strong>${foundEntrega.estado_logistico}</strong>.<br>¿Desea volver a capturar las evidencias y editar el registro de entrega?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, Editar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#3b82f6',
                cancelButtonColor: '#64748b'
            });
            if (!isConfirm.isConfirmed) {
                return;
            }
        }
    } else if (/^\d+$/.test(baseToken)) {
        localBudgetId = parseInt(baseToken);
    }

    let items = [];
    const lookupToken = localBudgetId || baseToken;
    if (lookupToken) {
        try {
            const detailsResp = await fetch(`${API_BASE_URL}/api/logistica/movil/pedidos/${encodeURIComponent(lookupToken)}/detalles`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const detailsData = await detailsResp.json();
            if (detailsData.success) {
                items = detailsData.data;
            }
        } catch (err) {
            console.error('[SCANNER] Error recuperando detalles del pedido:', err);
        }
    }

    // Obtener ubicación GPS de forma rápida
    let latitud = null;
    let longitud = null;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                latitud = pos.coords.latitude;
                longitud = pos.coords.longitude;
                console.log('[GPS] Ubicación capturada:', latitud, longitud);
            },
            err => console.warn('[GPS] Error al obtener ubicación:', err.message),
            { timeout: 3000, enableHighAccuracy: true }
        );
    }
    
    let base64Remito = null;
    let base64Bulto = null;

    // Construir bloque HTML dinámico para la edición de cantidades
    let itemsHtml = '';
    if (items && items.length > 0) {
        itemsHtml = `
            <div style="width: 100%; border-top: 1.5px dashed #cbd5e1; padding-top: 15px; margin-top: 10px; text-align: left;">
                <h4 style="margin: 0 0 10px 0; font-size: 0.95rem; color: #1e3a8a; display: flex; align-items: center; gap: 6px;">
                    📋 Ajustar Cantidades (Entrega Parcial)
                </h4>
                <div style="max-height: 140px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; background: #f8fafc; margin-bottom: 10px;">
                    ${items.map(item => `
                        <div style="display: flex; flex-direction: column; margin-bottom: 8px; font-size: 0.85rem; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="flex: 1; font-weight: 500; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px;" title="${item.descripcion}">${item.descripcion}</span>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <input type="number" 
                                           class="input-cant-articulo" 
                                           data-codigo="${item.codigo_barras}" 
                                           data-max="${item.cantidad}" 
                                           value="${item.cantidad}" 
                                           min="0" 
                                           max="${item.cantidad}" 
                                           style="width: 65px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; text-align: center; font-weight: bold; color: #1e293b;">
                                    <span style="color: #64748b; font-size: 0.75rem;">/ ${parseFloat(item.cantidad)}</span>
                                </div>
                            </div>
                            <span id="badge-dev-${item.codigo_barras}" style="display: none; font-size: 0.7rem; color: #dc2626; background: #fee2e2; border: 1px solid #fca5a5; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-top: 4px; align-self: flex-start;">
                                ❌ Devuelve al camión: 0 u.
                            </span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 8px;">
                    <label style="font-size: 0.8rem; font-weight: bold; color: #475569; display: block; margin-bottom: 4px;">📝 Observaciones Chofer / Motivo de cambio:</label>
                    <textarea id="input-observaciones-chofer" 
                              placeholder="Ej: Cliente rechazó 2 cajas..." 
                              style="width: 100%; height: 50px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.8rem; box-sizing: border-box; resize: none;"></textarea>
                </div>
            </div>
        `;
    }
    
    // Mostrar modal interactivo "Registro de Conformidad"
    const headerPedidoHtml = foundEntrega
        ? `<div style="width: 100%; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 8px 10px; font-size: 0.85rem; color: #1e40af; font-weight: 700; text-align: center;">
               📦 Pedido #${foundEntrega.id_presupuesto} — ${foundEntrega.cliente?.nombre || 'Cliente'}
           </div>`
        : '';

    const result = await Swal.fire({
        title: '📋 Registro de Conformidad',
        html: `
            <div style="display: flex; flex-direction: column; gap: 15px; align-items: center; width: 100%; box-sizing: border-box; padding: 5px;">
                ${headerPedidoHtml}
                <input type="file" id="input-foto-remito" accept="image/*" capture="environment" style="display:none;">
                <input type="file" id="input-foto-bulto" accept="image/*" capture="environment" style="display:none;">
                <p style="margin: 0; font-size: 0.95rem; color: #475569; text-align: center;">
                    Seleccione evidencias fotográficas opcionales para la entrega del pedido.
                </p>
                
                <div style="display: flex; gap: 30px; justify-content: center; width: 100%; margin: 10px 0;">
                    <div id="status-remito" style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                        <div id="icon-remito" style="font-size: 2rem; opacity: 0.4; transition: all 0.3s ease;">📄</div>
                        <span id="label-remito" style="font-size: 0.75rem; font-weight: bold; color: #64748b;">Sin Remito</span>
                    </div>
                    <div id="status-bulto" style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                        <div id="icon-bulto" style="font-size: 2rem; opacity: 0.4; transition: all 0.3s ease;">📦</div>
                        <span id="label-bulto" style="font-size: 0.75rem; font-weight: bold; color: #64748b;">Sin Foto Bulto</span>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
                    <button id="btn-capture-remito" type="button" class="swal2-confirm swal2-styled" style="background-color: #3b82f6; margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                        📷 Tomar Foto Remito Firmado
                    </button>
                    <button id="btn-capture-bulto" type="button" class="swal2-confirm swal2-styled" style="background-color: #059669; margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                        📦 Tomar Foto Bulto/Entorno
                    </button>
                </div>
                
                ${itemsHtml}
            </div>
        `,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '📢 Guardar y Notificar',
        denyButtonText: '💾 Solo Guardar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#2563eb', // Azul primario
        denyButtonColor: '#10b981',    // Verde secundario
        cancelButtonColor: '#64748b',  // Gris cancelar
        customClass: {
            confirmButton: 'swal2-confirm swal2-styled',
            denyButton: 'swal2-deny swal2-styled',
            cancelButton: 'swal2-cancel swal2-styled'
        },
        didOpen: () => {
            const btnRemito = document.getElementById('btn-capture-remito');
            const btnBulto = document.getElementById('btn-capture-bulto');
            const inputRemito = document.getElementById('input-foto-remito');
            const inputBulto = document.getElementById('input-foto-bulto');

            btnRemito.addEventListener('click', () => inputRemito.click());
            btnBulto.addEventListener('click', () => inputBulto.click());

            // Listener para procesar foto de remito
            inputRemito.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    btnRemito.disabled = true;
                    btnRemito.innerText = '⏳ Procesando Remito...';
                    try {
                        base64Remito = await procesarImagen(file, 1000, 'grayscale');
                        document.getElementById('icon-remito').style.opacity = '1.0';
                        document.getElementById('icon-remito').innerText = '✅📄';
                        document.getElementById('label-remito').innerText = 'Capturado';
                        document.getElementById('label-remito').style.color = '#10b981';
                        btnRemito.innerText = '🔄 Recapturar Remito';
                        btnRemito.style.backgroundColor = '#2563eb';
                    } catch (err) {
                        console.error('Error procesando imagen remito:', err);
                        Swal.showValidationMessage(`Error al procesar la foto del remito: ${err.message}`);
                        btnRemito.innerText = '📷 Tomar Foto Remito Firmado';
                    } finally {
                        btnRemito.disabled = false;
                    }
                }
            };

            // Listener para procesar foto de bulto
            inputBulto.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    btnBulto.disabled = true;
                    btnBulto.innerText = '⏳ Procesando Bulto...';
                    try {
                        base64Bulto = await procesarImagen(file, 1000, 'color');
                        document.getElementById('icon-bulto').style.opacity = '1.0';
                        document.getElementById('icon-bulto').innerText = '✅📦';
                        document.getElementById('label-bulto').innerText = 'Capturado';
                        document.getElementById('label-bulto').style.color = '#10b981';
                        btnBulto.innerText = '🔄 Recapturar Bulto';
                        btnBulto.style.backgroundColor = '#047857';
                    } catch (err) {
                        console.error('Error procesando imagen bulto:', err);
                        Swal.showValidationMessage(`Error al procesar la foto del bulto: ${err.message}`);
                        btnBulto.innerText = '📦 Tomar Foto Bulto/Entorno';
                    } finally {
                        btnBulto.disabled = false;
                    }
                }
            };

            // Listener dinámico para actualización visual de devoluciones al camión
            document.querySelectorAll('.input-cant-articulo').forEach(input => {
                input.addEventListener('input', () => {
                    const codigo = input.getAttribute('data-codigo');
                    const maxVal = parseFloat(input.getAttribute('data-max') || 0);
                    const newVal = parseFloat(input.value || 0);
                    const badge = document.getElementById(`badge-dev-${codigo}`);
                    if (badge) {
                        const dev = Math.max(0, maxVal - newVal);
                        if (dev > 0) {
                            badge.style.display = 'inline-block';
                            badge.textContent = `❌ Devuelve al camión: ${dev} u.`;
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                });
            });
        }
    });

    if (!result.isConfirmed && !result.isDenied) {
        console.log('[SCANNER] Confirmación cancelada por el chofer.');
        return;
    }

    const notificar = result.isConfirmed; // true para Guardar y Notificar, false para Solo Guardar (isDenied)

    // Leer modificaciones de cantidades
    const itemsModificados = [];
    let hasQuantityError = false;
    document.querySelectorAll('.input-cant-articulo').forEach(input => {
        const codigo = input.getAttribute('data-codigo');
        const maxVal = parseFloat(input.getAttribute('data-max'));
        const newVal = parseFloat(input.value || 0);
        if (newVal < 0 || newVal > maxVal) {
            hasQuantityError = true;
        } else if (newVal < maxVal) {
            itemsModificados.push({ codigo_barras: codigo, cantidad: newVal });
        }
    });

    if (hasQuantityError) {
        Swal.fire('Error de validación', 'Las cantidades ingresadas deben ser mayores o iguales a 0 y menores o iguales a las originales.', 'error');
        return;
    }

    const obsChoferText = document.getElementById('input-observaciones-chofer')?.value || '';

    // Mostrar loading mientras el servidor procesa e impacta la base
    Swal.fire({
        title: 'Confirmando entrega...',
        html: 'Enviando confirmación de entrega y procesando evidencias...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/entregas/escanear-qr`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                uuid: foundEntrega?.supabase_pedido_id || token,
                foto_remito: base64Remito,
                foto_bulto: base64Bulto,
                latitud: latitud,
                longitud: longitud,
                notificar: notificar,
                itemsModificados: itemsModificados,
                observaciones_chofer: obsChoferText
            })
        });
        
        const resData = await response.json();
        Swal.close();

        // Limpiar inputs de archivo locales para evitar comportamientos extraños en siguientes fotos
        const ir = document.getElementById('input-foto-remito');
        const ib = document.getElementById('input-foto-bulto');
        if (ir) ir.value = '';
        if (ib) ib.value = '';
        
        if (resData.success) {
            // Confirmación exitosa de entrega
            await Swal.fire({
                title: '✅ Entrega Registrada',
                text: `El pedido #${resData.id_presupuesto} se ha marcado como ENTREGADO exitosamente.`,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
            
            // Recargar ruta activa
            if (typeof cargarRutaActiva === 'function') {
                await cargarRutaActiva();
            }
            
            // Si el cliente tiene retiros de mantenimiento pendientes
            if (resData.retirosPendientes && resData.retirosPendientes.length > 0) {
                const ret = resData.retirosPendientes[0];
                const count = resData.retirosPendientes.length;
                
                const confirmRetiro = await Swal.fire({
                    title: '⚠️ Retiro Pendiente Detectado',
                    html: `
                        <div style="text-align: left; font-size: 0.95rem;">
                            <p>El cliente <strong>${ret.cliente_nombre}</strong> posee <strong>${count}</strong> retiro(s) pendiente(s) de ejecución.</p>
                            <div style="background: #fffbeb; border-left: 4px solid #d97706; padding: 10px; border-radius: 6px; margin-top: 10px;">
                                <strong>Detalles del retiro:</strong><br>
                                • Orden: ${ret.orden_entrega}<br>
                                • Estado: ${ret.estado_logistico}<br>
                                • Fecha: ${new Date(ret.fecha_creacion).toLocaleDateString()}<br>
                                <ul style="margin: 5px 0 0 15px; padding: 0;">
                                    ${ret.detalles.map(d => `<li>${parseFloat(d.kilos)} kg / ${parseInt(d.bultos)} bultos - Art. ${d.articulo_numero}</li>`).join('')}
                                </ul>
                            </div>
                            <p style="margin-top: 10px;">¿Desea registrar la conformidad y retirar las bobinas en este momento?</p>
                        </div>
                    `,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#059669',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: 'Sí, gestionar ahora',
                    cancelButtonText: 'Más tarde'
                });
                
                if (confirmRetiro.isConfirmed) {
                    const idOrden = ret.id_orden;
                    // Buscar si ya lo tenemos adaptado en state.entregas
                    const localRetiro = state.entregas.find(e => e.id_presupuesto === `RT-${idOrden}`);
                    
                    if (localRetiro) {
                        if (localRetiro.estado_logistico === 'PENDIENTE_CLIENTE') {
                            window.abrirContingenciaRetiro(idOrden, localRetiro);
                        } else {
                            window.abrirValidarRetiro(idOrden, localRetiro);
                        }
                    } else {
                        // Crear mock para alimentar los modales de contingencia/validación si no está en la ruta
                        const mockRetiro = {
                            id_presupuesto: `RT-${idOrden}`,
                            hash: ret.codigo_qr_hash,
                            cliente: { id: ret.cliente_id, nombre: ret.cliente_nombre },
                            detalles: ret.detalles || [],
                            estado_logistico: ret.estado_logistico
                        };
                        if (ret.estado_logistico === 'PENDIENTE_CLIENTE') {
                            window.abrirContingenciaRetiro(idOrden, mockRetiro);
                        } else {
                            window.abrirValidarRetiro(idOrden, mockRetiro);
                        }
                    }
                }
            }
        } else {
            Swal.fire("Error al Confirmar", resData.error || "No se pudo procesar el código QR.", "error");
        }
    } catch (err) {
        Swal.close();
        console.error("Error al procesar escaneo QR:", err);
        Swal.fire("Error del Servidor", "Ocurrió un error al comunicarse con la API móvil.", "error");
    }
}

/**
 * Procesa y comprime una foto usando HTML5 Canvas
 */
function procesarImagen(file, maxDimension, colorMode) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Redimensionar proporcionalmente
                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Escala de grises + alto contraste para remitos
                if (colorMode === 'grayscale') {
                    const imgData = ctx.getImageData(0, 0, width, height);
                    const data = imgData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        // Luminancia
                        let v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                        
                        // Contraste agresivo
                        v = v > 128 ? Math.min(v * 1.2, 255) : v * 0.8;
                        
                        data[i] = v;     // R
                        data[i + 1] = v; // G
                        data[i + 2] = v; // B
                    }
                    ctx.putImageData(imgData, 0, 0);
                }

                // Compresión ligera JPEG a calidad 0.6
                const base64 = canvas.toDataURL('image/jpeg', 0.6);
                resolve(base64);
            };
            img.onerror = () => reject(new Error("Error al decodificar la imagen de la cámara."));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error("Error al leer el archivo de la cámara."));
        reader.readAsDataURL(file);
    });
}

function onScanFailure(error) {
    // Silenciar errores continuos de búsqueda de foco de QR
}

