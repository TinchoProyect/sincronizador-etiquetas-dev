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
                <button onclick="window.eliminarRutaActiva()" style="margin-top: 1.5rem; padding: 12px 20px; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; width: 100%; box-shadow: 0 4px 6px rgba(239,68,68,0.2);">
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
                    ${isArmando ? '🚀 Iniciar Ruta' : '⏸ Detener Ruta'}
                </button>
                ${isArmando ? `
                <button onclick="window.abrirModalAcomodar()" style="background: #3b82f6; color: white; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%;">
                    🗺️ Acomodar Ruta
                </button>` : ''}
            `;
        }

        routeHeaderHTML = `
            <style>
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                    100% { transform: scale(1); }
                }
            </style>
            <div style="margin-bottom: 1.5rem; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; flex-direction: ${ruta100Porciento ? 'column' : 'row'}; justify-content: space-between; align-items: ${ruta100Porciento ? 'stretch' : 'center'}; gap: 12px; border-left: 4px solid ${ruta100Porciento ? '#dc2626' : (isArmando ? '#d97706' : '#059669')};">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.8rem; color: #64748b; font-weight: bold; text-transform: uppercase;">Estado Actual</span>
                    <span style="font-weight: 800; color: ${ruta100Porciento ? '#dc2626' : (isArmando ? '#d97706' : '#059669')}; font-size: 1.1rem;">
                        ${ruta100Porciento ? '100% Completado' : (isArmando ? 'Modo Armado' : '▶ Ruta Iniciada')}
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
        const esRetiro = primerEntrega.estado === 'Orden de Retiro';

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
            const esItemRetiro = entrega.estado === 'Orden de Retiro';
            const completado = entrega.estado_logistico === 'ENTREGADO' || entrega.estado_logistico === 'RETIRADO';
            
            const isReconciled = entrega.comprobante_lomasoft || entrega.id_factura_lomasoft;
            const badgeLomasoft = isReconciled
                ? `<span style="font-size: 0.70rem; color: white; background: #10b981; padding: 2px 6px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="event.stopPropagation(); Swal.fire('Lomasoft', 'Comprobante: ${entrega.comprobante_lomasoft || entrega.id_factura_lomasoft}', 'info')">✅ Lomasoft</span>`
                : `<span style="font-size: 0.70rem; color: white; background: #475569; padding: 2px 6px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="event.stopPropagation(); Swal.fire('Pendiente', 'No posee factura Lomasoft', 'info')">⏳ Pte. Facturación</span>`;

            const textoBoton = completado ? (esItemRetiro ? '✓ Retirado' : '✓ Entregado') : (esItemRetiro ? 'Retirar' : 'Entregar');
            const backgroundBoton = completado ? '#dcfce7' : (esItemRetiro ? '#e67e22' : '#2563eb');
            const colorTextoBoton = completado ? '#166534' : 'white';

            return `
                <div class="pedido-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; gap: 8px;">
                    <div style="flex: 1; min-width: 140px;">
                        <div style="font-weight: 600; color: #475569; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                            <span>${esItemRetiro ? '↩️' : ''} Pedido #${entrega.id_presupuesto}</span>
                            ${badgeLomasoft}
                        </div>
                        ${entrega.total ? `<div style="font-size: 0.85rem; color: #059669; margin-top: 4px;">💰 $${parseFloat(entrega.total).toFixed(2)}</div>` : ''}
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn-confirmar-sm" 
                                onclick="window.quitarPedido(${entrega.id_presupuesto})" 
                                style="padding: 0.5rem; font-weight: bold; border-radius: 0.5rem; background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            ❌ Quitar
                        </button>
                        <button class="btn-confirmar-sm" 
                                onclick="confirmarEntrega(${entrega.id_presupuesto}, '${esItemRetiro ? 'retiro' : 'entrega'}')" 
                                ${completado ? 'disabled' : ''}
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
                    <div class="entrega-numero" style="background: ${esRetiro ? '#d35400' : '#1e3a8a'}; opacity: 0.9;">
                        ${index + 1}
                    </div>
                    <div style="flex: 1;">${headerBadgeHTML}</div>
                    <div style="display: flex; gap: 0.25rem;">
                        <button onclick="window.moverParada('${parada.key}', -1)" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↑</button>
                        <button onclick="window.moverParada('${parada.key}', 1)" ${index === paradas.length - 1 ? 'disabled style="opacity:0.3;"' : ''} class="btn-ordenar" style="padding: 6px 14px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">↓</button>
                    </div>
                </div>
                
                <div class="entrega-cliente" style="margin-top: 0.75rem;">
                    <div style="font-size: 1.25rem; font-weight: 800; color: #1e40af; margin-bottom: 0.25rem;">
                        #${primerEntrega.cliente.id || 'S/N'}
                    </div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #1e293b;">
                        ${primerEntrega.cliente.nombre || 'Cliente sin nombre'}
                    </div>
                    ${esRetiro ? '<div style="background: #e67e22; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-top: 4px; display: inline-block;">RETIRAR</div>' : ''}
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
    try {
        const payload = { estado: nuevoEstado };
        const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/estado`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            state.ruta.estado = nuevoEstado;
            renderizarEntregas(); 
        } else alert("Error: " + data.error);
    } catch(err) { alert("Error de red."); }
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
