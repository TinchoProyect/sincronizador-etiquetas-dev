// --- PendientesUI.js ---

async function cargarPendientes() {
    const container = document.getElementById('pendientes-container');
    if(!container) return;
    
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Buscando pendientes...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/pedidos-pendientes`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await response.json();
        
        if (result.success && result.data && result.data.length > 0) {
            container.innerHTML = `
                <div class="acciones-pendientes" style="display:flex; justify-content:space-between; margin-bottom: 1rem; padding: 0.5rem;">
                    <button onclick="abrirModalNuevaRuta()" style="background:#2563eb; color:white; padding:0.75rem 0.5rem; border:none; border-radius:0.5rem; font-weight:bold; flex:1; margin-right:0.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">🛣️ Crear Ruta</button>
                    <button onclick="asignarSeleccionados()" id="btn-asignar-sel" style="background:#10b981; color:white; padding:0.75rem 0.5rem; border:none; border-radius:0.5rem; font-weight:bold; flex:1; opacity:0.5; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);" disabled>📌 Asignar (0)</button>
                </div>
                ${result.data.map(p => {
                    const esIngreso = p.estado === 'Orden de Retiro';
                    const iconColor = esIngreso ? '#dc2626' : '#2563eb';
                    const borderColor = esIngreso ? '#fca5a5' : '#bfdbfe';
                    
                    // Badge Lomasoft
                    let badgeLomasoft = '';
                    if (p.comprobante_lomasoft) {
                        badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #10b981; border-radius: 4px; display: inline-block;">✅ Lomasoft: ${p.comprobante_lomasoft}</div>`;
                    } else if (p.id_factura_lomasoft) {
                        badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #10b981; border-radius: 4px; display: inline-block;">✅ Lomasoft: ${p.id_factura_lomasoft}</div>`;
                    } else {
                        badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #475569; border-radius: 4px; display: inline-block;">⏳ Pte. Facturación</div>`;
                    }
                    
                    return `
                    <div class="entrega-card" style="border-left-color: ${iconColor}; display: flex; align-items: stretch; gap: 0.75rem; padding-left: 0.75rem;">
                        <div style="display: flex; align-items: center; justify-content: center;">
                            <input type="checkbox" class="chk-pedido" value="${p.id}" onchange="actualizarBotonAsignar()" style="width: 24px; height: 24px; accent-color: #2563eb;">
                        </div>
                        <div style="flex: 1;">
                            <div class="entrega-header" style="margin-bottom: 0.5rem;">
                                <div style="font-weight: bold; color: #1e293b; font-size: 1.1rem;">${esIngreso?'↩️':''} Pedido #${p.id}</div>
                                <div class="entrega-badge badge-pendiente" style="background:${borderColor}; color:${iconColor};">${p.estado_logistico || 'Pendiente'}</div>
                            </div>
                            <div class="entrega-cliente" style="font-size: 0.95rem; margin-bottom: 0.25rem;">👤 ${p.cliente_nombre}</div>
                            <div class="entrega-direccion" style="margin-bottom: 0; font-size: 0.85rem;">
                                📍 ${p.domicilio_direccion || 'Sin domicilio'} <br>
                                <small style="margin-left: 1.25rem; color: #94a3b8;">${p.domicilio_localidad || ''}</small>
                            </div>
                            ${badgeLomasoft}
                            ${p.nota ? `<div style="font-size: 0.8rem; color: #b45309; padding: 0.5rem; background-color: #fffbeb; border-radius: 0.375rem; border-left: 3px solid #f59e0b; margin-top: 8px;">💡 ${p.nota}</div>` : ''}
                        </div>
                    </div>
                `}).join('')}`;
        } else {
            container.innerHTML = `
                <div class="header-acciones" style="display:flex; justify-content:center; margin-bottom: 1rem; padding: 0.5rem;">
                    <button onclick="abrirModalNuevaRuta()" style="background:#2563eb; color:white; padding:0.75rem 1rem; border:none; border-radius:0.5rem; font-weight:bold; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">🛣️ Crear Ruta Vacía</button>
                </div>
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h2>Todo Asignado</h2>
                    <p>No hay pedidos pendientes en la base.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[PENDIENTES] Error:', error);
        container.innerHTML = `<div class="empty-state"><p>Error cargando pendientes</p></div>`;
    }
}

function actualizarBotonAsignar() {
    const seleccionados = document.querySelectorAll('.chk-pedido:checked');
    const btn = document.getElementById('btn-asignar-sel');
    if(!btn) return;
    
    if (seleccionados.length > 0) {
        btn.innerHTML = `📌 Asignar (${seleccionados.length})`;
        btn.disabled = false;
        btn.style.opacity = '1';
    } else {
        btn.innerHTML = `📌 Asignar (0)`;
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }
}

async function abrirModalNuevaRuta() {
    let choferesHtml = '<option value="">Cargando choferes...</option>';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/logistica/usuarios/choferes`);
        const result = await resp.json();
        if(result.success) {
            choferesHtml = '<option value="">Seleccione un chofer...</option>';
            result.data.forEach(c => {
                choferesHtml += `<option value="${c.id}">${c.nombre_completo || c.usuario}</option>`;
            });
        }
    } catch(e) { console.error(e); }

    const modalHtml = `
    <div id="modal-dinamico-ruta" class="modal-mobile" style="display: flex;">
        <div class="modal-content-mobile" style="padding:1.5rem;">
            <div class="modal-header-mobile" style="padding:0; border:none; margin-bottom:1.5rem;">
                <h2 style="font-size: 1.25rem;">Crear Nueva Ruta</h2>
                <button onclick="document.getElementById('modal-dinamico-ruta').remove()" style="background:none; border:none; font-size:1.5rem;">&times;</button>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Nombre de Ruta</label>
                <input type="text" id="nueva-ruta-nombre" placeholder="Ej: Reparto Tarde CABA" class="form-control" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1rem; font-size:1rem;">
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Chofer Asignado</label>
                <select id="nueva-ruta-chofer" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1rem; background:white; font-size:1rem;">
                    ${choferesHtml}
                </select>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Fecha de Salida</label>
                <input type="datetime-local" id="nueva-ruta-fecha" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1.5rem; font-size:1rem;">
            </div>
            <button onclick="ejecutarCrearRuta(event)" style="width:100%; padding:1rem; background:#2563eb; color:white; border:none; border-radius:0.5rem; font-weight:bold; font-size:1.1rem; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Guardar y Crear</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('nueva-ruta-fecha').value = now.toISOString().slice(0,16);
}

async function ejecutarCrearRuta(event) {
    const nombre = document.getElementById('nueva-ruta-nombre').value;
    const id_chofer = document.getElementById('nueva-ruta-chofer').value;
    const fecha = document.getElementById('nueva-ruta-fecha').value;
    
    if(!nombre || !id_chofer || !fecha) return alert('Complete todos los campos requeridos');
    
    const btn = event.currentTarget;
    const spanOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Creando ruta...';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nombre_ruta: nombre, id_chofer: id_chofer, fecha_salida: fecha })
        });
        const result = await response.json();
        if(result.success) {
            document.getElementById('modal-dinamico-ruta').remove();
            alert('¡Ruta creada exitosamente!');
            cargarPendientes();
            setTimeout(() => {
                switchTab('ruta');
                cargarRutaActiva();
            }, 800);
        } else {
            alert(result.error || 'No se pudo crear la ruta.');
        }
    } catch (error) {
        alert('Error de conexión.');
    } finally {
        if(document.getElementById('modal-dinamico-ruta')) {
            btn.disabled = false;
            btn.innerHTML = spanOriginal;
        }
    }
}

async function asignarSeleccionados() {
    const seleccionados = Array.from(document.querySelectorAll('.chk-pedido:checked')).map(cb => parseInt(cb.value));
    if(seleccionados.length === 0) return;
    
    let rutasHtml = '<option value="">Investigando rutas activas...</option>';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas-activas`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await resp.json();
        if(result.success && result.data && result.data.length > 0) {
            rutasHtml = '<option value="">Seleccione una Ruta Destino...</option>';
            result.data.forEach(r => {
                rutasHtml += `<option value="${r.id}">${r.nombre_ruta} (Chofer: ${r.chofer_nombre})</option>`;
            });
        } else {
            rutasHtml = '<option value="">No hay rutas en preparación (ARMANDO)</option>';
        }
    } catch(e) { console.error(e); }

    const modalHtml = `
    <div id="modal-asignar-ruta" class="modal-mobile" style="display: flex;">
        <div class="modal-content-mobile" style="padding:1.5rem;">
            <div class="modal-header-mobile" style="padding:0; border:none; margin-bottom:1.5rem;">
                <h2 style="font-size: 1.25rem;">📌 Asignar ${seleccionados.length} Pedidos</h2>
                <button onclick="document.getElementById('modal-asignar-ruta').remove()" style="background:none; border:none; font-size:1.5rem;">&times;</button>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Ruta Destino Activa</label>
                <select id="select-ruta-destino" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1.5rem; background:white; font-size:1rem;">
                    ${rutasHtml}
                </select>
            </div>
            <button onclick='ejecutarAsignarRuta(${JSON.stringify(seleccionados)}, event)' style="width:100%; padding:1rem; background:#10b981; color:white; border:none; border-radius:0.5rem; font-weight:bold; font-size:1.1rem; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);">Confirmar Asignación</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function ejecutarAsignarRuta(ids_presupuestos, event) {
    const rutaId = document.getElementById('select-ruta-destino').value;
    if(!rutaId) return alert('Por favor seleccione una ruta válida para inyectar estos pedidos.');
    
    const btn = event.currentTarget;
    const spanOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Asignando a ruta...';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${rutaId}/asignar`, {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${state.sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids_presupuestos: ids_presupuestos })
        });
        const result = await response.json();
        if(result.success) {
            document.getElementById('modal-asignar-ruta').remove();
            alert(`¡Se han cargado ${ids_presupuestos.length} sobres a la ruta exitosamente!`);
            cargarPendientes();
        } else {
            alert(result.error || 'Ocurrió un error al despachar.');
        }
    } catch(error) {
        alert('Fallo catastrófico en la red.');
    } finally {
        if(document.getElementById('modal-asignar-ruta')) {
            btn.disabled = false;
            btn.innerHTML = spanOriginal;
        }
    }
}
