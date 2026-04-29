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
        const esCompletadaTotal = parada.entregas.every(e => e.estado_logistico === 'ENTREGADO' || e.estado_logistico === 'RETIRADO');
        const primerEntrega = parada.entregas[0];
        const esOrdenTratamiento = primerEntrega.estado === 'Orden de Tratamiento';
        const esOrdenRetiro = primerEntrega.estado === 'Orden de Retiro';
        const esEntregaTratamientoParada = esOrdenTratamiento && primerEntrega.estado_tratamiento === 'COMPLETADO';
        const esRetiro = (esOrdenTratamiento && !esEntregaTratamientoParada) || esOrdenRetiro;

        const claseCard = esCompletadaTotal ? 'entrega-card completada' : 'entrega-card';
        const pendientes = parada.entregas.filter(e => e.estado_logistico !== 'ENTREGADO' && e.estado_logistico !== 'RETIRADO').length;
        const estiloBorde = esRetiro && !esCompletadaTotal ? 'border-left: 5px solid #d35400;' : '';

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
            const esOrdenTratamiento = entrega.estado === 'Orden de Tratamiento';
            const esOrdenRetiro = entrega.estado === 'Orden de Retiro';
            const esEntregaTratamiento = esOrdenTratamiento && entrega.estado_tratamiento === 'COMPLETADO';
            const esItemRetiro = (esOrdenTratamiento && !esEntregaTratamiento) || esOrdenRetiro;
            const completado = entrega.estado_logistico === 'ENTREGADO' || entrega.estado_logistico === 'RETIRADO';
            
            const lomasoft = entrega.comprobante_lomasoft || entrega.id_factura_lomasoft;
            const labelPteFac = (!esOrdenTratamiento && !esOrdenRetiro ? `<span style="font-size: 0.70rem; color: white; background: #475569; padding: 2px 6px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="event.stopPropagation(); Swal.fire('Pendiente', 'No posee factura Lomasoft', 'info')">⏳ Pte. Facturación</span>` : '');
            const badgeLomasoft = lomasoft ? `<span style="font-size: 0.70rem; color: white; background: #10b981; padding: 2px 6px; border-radius: 4px; font-weight: bold;">Lomasoft: ${lomasoft}</span>` : labelPteFac;

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
                    // Si ya está completado el retiro, o es un ciclo de entrega, ocultamos el botón de Modificar Carga para evitar inconsistencias mutables post-retiro.
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
                    // Bloquear botón de Retirar (Regla de Negocio)
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
                        <button class="btn-confirmar-sm" 
                                onclick="window.quitarPedido('${entrega.id_presupuesto}')" 
                                style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            ❌ Quitar
                        </button>
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
                    <div class="entrega-numero" style="background: ${esRetiro ? '#d35400' : (esEntregaTratamientoParada ? '#2563eb' : '#1e3a8a')}; opacity: 0.9;">
                        ${index + 1}
                    </div>
                    <div style="flex: 1;">${headerBadgeHTML}</div>
                    <div style="display: flex; gap: 0.25rem;">
                        <button onclick="window.moverParada('${parada.key}', -1)" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↑</button>
                        <button onclick="window.moverParada('${parada.key}', 1)" ${index === paradas.length - 1 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↓</button>
                    </div>
                </div>
                
                <div class="entrega-cliente" style="margin-top: 0.75rem;">
                    <div style="font-size: 1.1rem; font-weight: 800; color: #1e40af; margin-bottom: 0.25rem;">
                        [#${primerEntrega.cliente.id || 'S/N'}] ${primerEntrega.cliente.nombre || 'Cliente sin nombre'}
                    </div>
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

    const paradas = [];
    const mapaParadas = new Map();

    entregas.forEach(entrega => {
        // Clave única: cliente + domicilio
        const key = `${entrega.cliente.id}_${entrega.domicilio.id || 'sin_dom'}`;

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
    const nuevoOrdenIds = state.entregas.map(e => parseInt(e.id_presupuesto));
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
    if (!confirm(`¿Confirmar cambio de estado a ${nuevoEstado === 'EN_CAMINO' ? 'INICIAR RUTA' : 'DETENER RUTA'}?`)) return;
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
                const esIngreso = p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro';
                const iconColor = esIngreso ? '#dc2626' : '#2563eb';
                return `
                <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-bottom: 1px solid #f1f5f9;">
                    <input type="checkbox" class="chk-agregar-pedido" value="${p.id}" onchange="window.actualizarBtnAgregar()" style="width: 22px; height: 22px; accent-color: #8b5cf6; flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; color: ${iconColor}; font-size: 0.95rem;">${esIngreso ? (p.estado === 'Orden de Retiro' ? '↩️ ORDEN DE RETIRO #' : '↩️ Orden de Tratamiento #') : '📦 Pedido #'}${p.id}</div>
                        <div style="font-size: 0.9rem; color: #334155; margin-top: 2px;">👤 <strong>[#${p.cliente_id || 'S/N'}]</strong> ${p.cliente_nombre}</div>
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
    const seleccionados = Array.from(document.querySelectorAll('.chk-agregar-pedido:checked')).map(cb => String(cb.value).startsWith('RT-') ? cb.value : parseInt(cb.value));
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
