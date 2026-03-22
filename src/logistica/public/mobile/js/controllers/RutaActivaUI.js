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
            <div class="${claseCard}" data-parada-key="${parada.key}" style="${estiloBorde} box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 1.5rem;">
                <div class="entrega-header">
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
                </div>
                
                <div class="entregas-lista-interna" style="margin-bottom: 1rem;">
                    ${pedidosListHTML}
                </div>
                
                <div class="entrega-actions">
                    <button class="btn-navegar" onclick="navegarAEntrega(${primerEntrega.domicilio.latitud}, ${primerEntrega.domicilio.longitud}, '${encodeURIComponent(primerEntrega.domicilio.direccion || '')}')"
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

function navegarAEntrega(latitud, longitud, direccion) {
    if (!latitud || !longitud) {
        mostrarError('Esta entrega no tiene coordenadas GPS');
        return;
    }

    // Generar link de Google Maps con navegación
    const direccionEncoded = encodeURIComponent(decodeURIComponent(direccion));
    const link = `https://www.google.com/maps/dir/?api=1&destination=${latitud},${longitud}&destination_place_id=${direccionEncoded}`;

    console.log('[NAVEGACION] Abriendo Google Maps:', link);

    // Abrir en nueva pestaña/app
    window.open(link, '_blank');
}

function confirmarEntrega(presupuestoId, tipoPedido = 'entrega') {
    console.log('[ENTREGA] Confirmar', tipoPedido, 'de presupuesto:', presupuestoId);

    // Importar dinámicamente el módulo de confirmación
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
