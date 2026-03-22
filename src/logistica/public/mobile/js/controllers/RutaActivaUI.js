// --- RutaActivaUI.js ---

function renderizarEntregas() {
    const container = document.getElementById('entregas-container');

    if (!state.entregas || state.entregas.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <h2>Ruta Sin Entregas</h2>
                <p>Esta ruta no tiene entregas asignadas.</p>
            </div>
        `;
        return;
    }

    const paradas = agruparEntregasEnParadas(state.entregas);

    container.innerHTML = paradas.map((parada, index) => {
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
                <select class="form-control" onchange="window.cambiarDomicilio(${primerEntrega.cliente.id}, this.value)" style="margin-top: 0.75rem; width: 100%; border-radius: 4px; padding: 6px; font-size: 0.85rem; background-color: #f8fafc; border: 1px solid #cbd5e1; outline: none; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    ${primerEntrega.domicilios_alternativos.map(d => `<option value="${d.id}" ${parseInt(d.id) === parseInt(primerEntrega.domicilio.id) ? 'selected' : ''}>${d.direccion} ${d.localidad ? '('+d.localidad+')' : ''}</option>`).join('')}
                </select>
            `;
        }

        const pedidosListHTML = parada.entregas.map(entrega => {
            const esItemRetiro = entrega.estado === 'Orden de Retiro';
            const completado = entrega.estado_logistico === 'ENTREGADO' || entrega.estado_logistico === 'RETIRADO';

            const textoBoton = completado ? (esItemRetiro ? '✓ Retirado' : '✓ Entregado') : (esItemRetiro ? 'Retirar' : 'Entregar');
            const backgroundBoton = completado ? '#dcfce7' : (esItemRetiro ? '#e67e22' : '#2563eb');
            const colorTextoBoton = completado ? '#166534' : 'white';

            return `
                <div class="pedido-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #475569;">${esItemRetiro ? '↩️' : ''} Pedido #${entrega.id_presupuesto}</div>
                        ${entrega.total ? `<div style="font-size: 0.85rem; color: #059669;">💰 $${parseFloat(entrega.total).toFixed(2)}</div>` : ''}
                    </div>
                    <div>
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
            <div class="${claseCard}" data-parada-key="${parada.key}" draggable="true" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondragenter="dragEnter(event)" ondragleave="dragLeave(event)" ondrop="dropAndSave(event)" style="${estiloBorde} box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 1.5rem; cursor: grab; transition: all 0.2s ease;">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 12px; display: flex; justify-content: center; align-items: center; cursor: grab; background: #f8fafc; border-top-left-radius: 0.5rem; border-top-right-radius: 0.5rem;">
                    <div style="width: 30px; height: 4px; border-radius: 2px; background: #cbd5e1;"></div>
                </div>
                <div class="entrega-header" style="margin-top: 8px;">
                    <div class="entrega-numero" style="background: ${esRetiro ? '#d35400' : '#1e3a8a'}; opacity: 0.9;">
                        ${esRetiro ? '↩️' : index + 1}
                    </div>
                    <div>${headerBadgeHTML}</div>
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

window.dragStart = (e) => {
    e.dataTransfer.setData('text/plain', e.target.closest('.entrega-card').dataset.paradaKey);
    e.target.closest('.entrega-card').style.opacity = '0.4';
    e.target.closest('.entrega-card').style.transform = 'scale(0.98)';
};
window.dragOver = (e) => {
    e.preventDefault();
};
window.dragEnter = (e) => {
    e.preventDefault();
    const card = e.target.closest('.entrega-card');
    if(card) {
        card.style.borderTop = '4px solid #2563eb';
    }
};
window.dragLeave = (e) => {
    e.preventDefault();
    const card = e.target.closest('.entrega-card');
    if(card) {
        card.style.borderTop = 'none';
    }
};
window.dropAndSave = async (e) => {
    e.preventDefault();
    
    // Restaurar estilos globales de drag
    document.querySelectorAll('.entrega-card').forEach(c => {
        c.style.opacity = '1';
        c.style.transform = 'none';
        c.style.borderTop = 'none';
    });

    const draggedKey = e.dataTransfer.getData('text/plain');
    const dropTarget = e.target.closest('.entrega-card');
    if (!dropTarget) return;
    
    const targetKey = dropTarget.dataset.paradaKey;
    if (draggedKey === targetKey) return;

    // Recalcular orden en local state vector
    const paradas = agruparEntregasEnParadas(state.entregas);
    const draggedIndex = paradas.findIndex(p => p.key === draggedKey);
    const targetIndex = paradas.findIndex(p => p.key === targetKey);
    
    const [draggedParada] = paradas.splice(draggedIndex, 1);
    paradas.splice(targetIndex, 0, draggedParada);
    
    state.entregas = paradas.flatMap(p => p.entregas);
    renderizarEntregas(); // Re-render for visual immediate feedback

    // Persistir orden en DB
    const nuevoOrdenIds = state.entregas.map(e => parseInt(e.id_presupuesto));
    try {
        await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/reordenar`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: nuevoOrdenIds })
        });
    } catch(err) { 
        console.error('Fallo de Red al guardar reordenamiento en base:', err); 
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

    import('./modules/confirmacion.js').then(module => {
        module.mostrarModalOpciones(presupuestoId, tipoPedido);
    }).catch(error => {
        console.error('[ENTREGA] Error al cargar módulo:', error);
        alert('❌ Error crítico al cargar módulo de confirmación: ' + (error.message || error));
    });
}

function finalizarRutaDelDia() {
    import('./modules/ruta.js').then(module => {
        module.finalizarRutaDelDia();
    }).catch(error => {
        console.error('[RUTA] Error al cargar módulo:', error);
        alert('Error al cargar módulo de ruta');
    });
}
