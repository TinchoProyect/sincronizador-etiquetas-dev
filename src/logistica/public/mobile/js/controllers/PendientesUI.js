// --- PendientesUI.js ---

window._pendientesData = [];
window._filtroPendientesTipo = 'TODOS';

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
            const vistos = new Set();
            window._pendientesData = result.data.filter(p => {
                const key = String(p.id);
                if (vistos.has(key)) return false;
                vistos.add(key);
                return true;
            });
            renderizarListaPendientesMovil();
        } else {
            window._pendientesData = [];
            container.innerHTML = `
                <div class="header-acciones" style="display:flex; justify-content:center; margin-bottom: 1rem; padding: 0.5rem;">
                    <button onclick="abrirModalNuevaRuta()" style="background:#2563eb; color:white; padding:0.75rem 1rem; border:none; border-radius:0.5rem; font-weight:bold; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">🛣️ Crear Ruta Vacía</button>
                </div>
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h2>Todo Asignado</h2>
                    <p>No hay pedidos, sobres ni retiros pendientes en la base.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[PENDIENTES] Error:', error);
        container.innerHTML = `<div class="empty-state"><p>Error cargando pendientes</p></div>`;
    }
}

window.cambiarFiltroPendientesMovil = function(tipo) {
    window._filtroPendientesTipo = tipo || 'TODOS';
    renderizarListaPendientesMovil();
};

function renderizarListaPendientesMovil() {
    const container = document.getElementById('pendientes-container');
    if (!container) return;

    const allItems = window._pendientesData || [];
    const filtro = window._filtroPendientesTipo || 'TODOS';

    let cantPedidos = 0;
    let cantSobres = 0;
    let cantRetiros = 0;
    let cantContactos = 0;

    const clientesConSobrePool = new Set();

    allItems.forEach(p => {
        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
        const esContacto = !esSobre && (String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial');
        const esIngreso = !esSobre && !esContacto && (p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
        if (esSobre) {
            cantSobres++;
            const cid = String(p.cliente_id || p.id_cliente || '').trim().replace(/^0+/, '');
            if (cid) clientesConSobrePool.add(cid);
        } else if (esContacto) {
            cantContactos++;
        } else if (esIngreso) {
            cantRetiros++;
        } else {
            cantPedidos++;
        }
    });

    const itemsFiltrados = allItems.filter(p => {
        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
        const esContacto = !esSobre && (String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial');
        const esIngreso = !esSobre && !esContacto && (p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
        if (filtro === 'PEDIDOS') return !esSobre && !esIngreso && !esContacto;
        if (filtro === 'SOBRES') return esSobre;
        if (filtro === 'RETIROS') return esIngreso;
        if (filtro === 'CONTACTOS') return esContacto;
        return true;
    });

    const tabStyle = (activo, colorActivo) => activo
        ? `background:${colorActivo}; color:white; border:1px solid ${colorActivo};`
        : `background:#ffffff; color:#475569; border:1px solid #cbd5e1;`;

    container.innerHTML = `
        <div class="acciones-pendientes" style="display:flex; justify-content:space-between; margin-bottom: 0.65rem; padding: 0.25rem;">
            <button onclick="abrirModalNuevaRuta()" style="background:#2563eb; color:white; padding:0.75rem 0.5rem; border:none; border-radius:0.5rem; font-weight:bold; flex:1; margin-right:0.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">🛣️ Crear Ruta</button>
            <button onclick="asignarSeleccionados()" id="btn-asignar-sel" style="background:#10b981; color:white; padding:0.75rem 0.5rem; border:none; border-radius:0.5rem; font-weight:bold; flex:1; opacity:0.5; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);" disabled>📌 Asignar (0)</button>
        </div>
        <div style="display:flex; gap:6px; overflow-x:auto; padding:0 0.25rem 0.75rem 0.25rem; margin-bottom:0.25rem;">
            <button type="button" onclick="window.cambiarFiltroPendientesMovil('TODOS')" style="${tabStyle(filtro === 'TODOS', '#1e293b')} padding:6px 10px; border-radius:999px; font-size:0.78rem; font-weight:700; white-space:nowrap;">
                Todos (${allItems.length})
            </button>
            <button type="button" onclick="window.cambiarFiltroPendientesMovil('PEDIDOS')" style="${tabStyle(filtro === 'PEDIDOS', '#2563eb')} padding:6px 10px; border-radius:999px; font-size:0.78rem; font-weight:700; white-space:nowrap;">
                📦 Pedidos (${cantPedidos})
            </button>
            <button type="button" onclick="window.cambiarFiltroPendientesMovil('SOBRES')" style="${tabStyle(filtro === 'SOBRES', '#7c3aed')} padding:6px 10px; border-radius:999px; font-size:0.78rem; font-weight:700; white-space:nowrap;">
                💵 Sobres (${cantSobres})
            </button>
            <button type="button" onclick="window.cambiarFiltroPendientesMovil('RETIROS')" style="${tabStyle(filtro === 'RETIROS', '#d35400')} padding:6px 10px; border-radius:999px; font-size:0.78rem; font-weight:700; white-space:nowrap;">
                🔙 Retiros (${cantRetiros})
            </button>
            <button type="button" onclick="window.cambiarFiltroPendientesMovil('CONTACTOS')" style="${tabStyle(filtro === 'CONTACTOS', '#0d9488')} padding:6px 10px; border-radius:999px; font-size:0.78rem; font-weight:700; white-space:nowrap;">
                🎯 Contactos (${cantContactos})
            </button>
        </div>
        ${itemsFiltrados.length === 0 ? `
            <div class="empty-state" style="padding: 2rem 1rem;">
                <div class="empty-state-icon">📭</div>
                <p>No hay elementos en esta categoría.</p>
            </div>
        ` : itemsFiltrados.map(p => {
            const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
            const esContacto = !esSobre && (String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial');
            const esIngreso = !esSobre && !esContacto && (p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
            const cidNorm = String(p.cliente_id || p.id_cliente || '').trim().replace(/^0+/, '');
            const clienteTieneSobre = !esSobre && !esContacto && cidNorm && clientesConSobrePool.has(cidNorm);

            if (esContacto) {
                const codProsp = p.codigo_prospecto || p.cliente_id || String(p.id);
                const idProspReal = p.id_prospecto_real || String(p.id).replace('PR-', '');
                return `
                <div class="entrega-card" style="border-left-color: #0d9488; background: #f0fdfa; display: flex; align-items: stretch; gap: 0.75rem; padding-left: 0.75rem;">
                    <div style="display: flex; align-items: center; justify-content: center;">
                        <input type="checkbox" class="chk-pedido" value="${p.id}" onchange="actualizarBotonAsignar()" style="width: 24px; height: 24px; accent-color: #0d9488;">
                    </div>
                    <div style="flex: 1;">
                        <div class="entrega-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                            <div style="font-weight: 800; color: #0f766e; font-size: 1rem;">${p.origen_contacto === 'CLIENTE_ACTIVO' ? '⭐ VISITA CLIENTE' : '🎯 CONTACTO'} • ${codProsp}</div>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span style="background: #ccfbf1; color: #115e59; border: 1px solid #99f6e4; padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">${p.origen_contacto === 'CLIENTE_ACTIVO' ? '⭐ CLIENTE S/PEDIDO' : '🤝 VISITA COMERCIAL'}</span>
                                <button type="button" onclick="event.preventDefault(); event.stopPropagation(); window.quitarContactoDePendientesMovil('${idProspReal}', '${(p.cliente_nombre || '').replace(/'/g, "\\'")}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">↩️ Quitar</button>
                            </div>
                        </div>
                        <div style="font-weight: 800; color: #0f172a; font-size: 0.96rem; margin-bottom: 0.2rem;">🏪 ${p.cliente_nombre}</div>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap; font-size: 0.78rem; color: #0f766e; font-weight: 700; margin-bottom: 0.25rem;">
                            <span>🏷️ ${p.rubro || 'Comercio'}</span>
                            ${p.contacto_nombre ? `<span>• 👤 ${p.contacto_nombre}</span>` : ''}
                            ${p.telefono_whatsapp ? `<span>• 📱 ${p.telefono_whatsapp}</span>` : ''}
                        </div>
                        <div class="entrega-direccion" style="margin-bottom: 0; font-size: 0.84rem; color: #334155;">
                            📍 ${p.domicilio_direccion || 'Sin dirección'}${p.domicilio_localidad ? ` • <b>${p.domicilio_localidad}</b>` : ''}
                        </div>
                        ${p.nota ? `<div style="font-size: 0.76rem; color: #115e59; padding: 0.35rem 0.5rem; background-color: #ccfbf1; border-radius: 0.375rem; border-left: 3px solid #0d9488; margin-top: 6px;">💡 ${p.nota}</div>` : ''}
                    </div>
                </div>`;
            }

            if (esSobre) {
                const codigoSobre = p.codigo_sobre || String(p.id).replace('SOB-', '');
                const montoSobre = parseFloat(p.monto_declarado || p.total || 0);
                const tieneFotos = Boolean(p.foto_frente_url || p.foto_dorso_url);
                return `
                <div class="entrega-card" style="border-left-color: #7c3aed; background: #faf5ff; display: flex; align-items: stretch; gap: 0.75rem; padding-left: 0.75rem;">
                    <div style="display: flex; align-items: center; justify-content: center;">
                        <input type="checkbox" class="chk-pedido" value="${p.id}" onchange="actualizarBotonAsignar()" style="width: 24px; height: 24px; accent-color: #7c3aed;">
                    </div>
                    <div style="flex: 1;">
                        <div class="entrega-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <div style="font-weight: 800; color: #5b21b6; font-size: 1.05rem;">💵 SOBRE #${codigoSobre}</div>
                            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end;">
                                <span style="font-weight: 900; color: #5b21b6; font-size: 0.95rem; background: #ede9fe; border: 1px solid #ddd6fe; padding: 0.15rem 0.45rem; border-radius: 0.375rem;">$ ${montoSobre.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                                <div class="entrega-badge" style="background:#ede9fe; color:#6d28d9; margin: 0; font-weight:700;">✅ CERRADO</div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem; gap: 6px;">
                            <div class="entrega-cliente" style="font-size: 0.95rem;">👤 <strong>[#${p.cliente_id || p.id_cliente || 'S/N'}]</strong> ${p.cliente_nombre}</div>
                            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                ${tieneFotos ? `<button type="button" onclick="event.preventDefault(); event.stopPropagation(); window.verFotosSobreMovil('${codigoSobre}', '${p.foto_frente_url || ''}', '${p.foto_dorso_url || ''}')" style="background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer;">📷 Fotos</button>` : ''}
                                <button type="button" onclick="event.preventDefault(); event.stopPropagation(); DomiciliosUI.abrirModalABM(${p.cliente_id || p.id_cliente})" style="background: #e2e8f0; color: #3b82f6; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer;">📍 Domicilios</button>
                            </div>
                        </div>
                        <div class="entrega-direccion" style="margin-bottom: 0; font-size: 0.85rem;">
                            📍 ${p.domicilio_direccion || 'Sin domicilio'} <br>
                            <small style="margin-left: 1.25rem; color: #94a3b8;">${p.domicilio_localidad || ''}</small>
                        </div>
                        ${p.nota ? `<div style="font-size: 0.78rem; color: #6d28d9; padding: 0.4rem 0.5rem; background-color: #f3e8ff; border-radius: 0.375rem; border-left: 3px solid #7c3aed; margin-top: 6px;">💬 ${p.nota}</div>` : ''}
                    </div>
                </div>`;
            }

            const iconColor = esIngreso ? '#dc2626' : '#2563eb';
            const borderColor = esIngreso ? '#fca5a5' : '#bfdbfe';
            
            // Badge Lomasoft
            let badgeLomasoft = '';
            if (p.comprobante_lomasoft) {
                badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #10b981; border-radius: 4px; display: inline-block;">✅ Lomasoft: ${p.comprobante_lomasoft}</div>`;
            } else if (p.id_factura_lomasoft) {
                badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #10b981; border-radius: 4px; display: inline-block;">✅ Lomasoft: ${p.id_factura_lomasoft}</div>`;
            } else if (!esIngreso) {
                badgeLomasoft = `<div style="font-size: 0.75rem; color: white; font-weight: bold; margin-top: 6px; padding: 4px 8px; background: #475569; border-radius: 4px; display: inline-block;">⏳ Pte. Facturación</div>`;
            }
            
            return `
            <div class="entrega-card" style="border-left-color: ${iconColor}; display: flex; align-items: stretch; gap: 0.75rem; padding-left: 0.75rem;">
                <div style="display: flex; align-items: center; justify-content: center;">
                    <input type="checkbox" class="chk-pedido" value="${p.id}" onchange="actualizarBotonAsignar()" style="width: 24px; height: 24px; accent-color: #2563eb;">
                </div>
                <div style="flex: 1;">
                    <div class="entrega-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <div style="font-weight: bold; color: #1e293b; font-size: 1.1rem;">${esIngreso ? (p.estado === 'Orden de Retiro' ? '↩️ ORDEN DE RETIRO #' : '↩️ Orden de Tratamiento #') : '📦 Pedido #'}${p.id}</div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end;">
                            ${!esIngreso ? `<span style="font-weight: 900; color: #15803d; font-size: 0.95rem; background: #dcfce7; padding: 0.15rem 0.4rem; border-radius: 0.375rem;">$ ${parseFloat(p.total || 0).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>` : ''}
                            <div class="entrega-badge badge-pendiente" style="background:${borderColor}; color:${iconColor}; margin: 0;">${p.estado_logistico || 'Pendiente'}</div>
                            ${p.motivo_no_entrega ? `<div class="entrega-badge" style="background:#ffedd5; color:#ea580c; border: 1px solid #fed7aa; margin: 0; font-size: 0.75rem;">⚠️ ${p.motivo_no_entrega}</div>` : ''}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.25rem;">
                        <div class="entrega-cliente" style="font-size: 0.95rem;">👤 <strong>[#${p.cliente_id || 'S/N'}]</strong> ${p.cliente_nombre}</div>
                        <div style="display: flex; gap: 8px;">
                            ${esIngreso ? `<button type="button" onclick="event.preventDefault(); event.stopPropagation(); window.descartarRetiro('${p.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️ Descartar</button>` : ''}
                            <button type="button" onclick="event.preventDefault(); event.stopPropagation(); DomiciliosUI.abrirModalABM(${p.cliente_id})" style="background: #e2e8f0; color: #3b82f6; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">📍 Domicilios</button>
                        </div>
                    </div>
                    <div class="entrega-direccion" style="margin-bottom: 0; font-size: 0.85rem;">
                        📍 ${p.domicilio_direccion || 'Sin domicilio'} <br>
                        <small style="margin-left: 1.25rem; color: #94a3b8;">${p.domicilio_localidad || ''}</small>
                    </div>
                    ${badgeLomasoft}
                    ${clienteTieneSobre ? `<div style="font-size: 0.73rem; color: #5b21b6; font-weight: 700; margin-top: 6px; padding: 3px 8px; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; display: inline-block; margin-left: 4px;">💵 Tiene sobre listo para retirar</div>` : ''}
                    ${p.nota ? `<div style="font-size: 0.8rem; color: #b45309; padding: 0.5rem; background-color: #fffbeb; border-radius: 0.375rem; border-left: 3px solid #f59e0b; margin-top: 8px;">💡 ${p.nota}</div>` : ''}
                </div>
            </div>
        `}).join('')}`;
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

function generarNombreSugeridoRutaMovil(fechaInput, segundosFijos = '00') {
    const fechaParsed = fechaInput ? new Date(fechaInput) : new Date();
    const f = isNaN(fechaParsed.getTime()) ? new Date() : fechaParsed;
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const diaSemana = diasSemana[f.getDay()];
    const dd = String(f.getDate()).padStart(2, '0');
    const mm = String(f.getMonth() + 1).padStart(2, '0');
    const yyyy = f.getFullYear();
    const hh = String(f.getHours()).padStart(2, '0');
    const min = String(f.getMinutes()).padStart(2, '0');
    const ss = String(segundosFijos).padStart(2, '0');
    return `Logística - ${diaSemana} ${dd}/${mm}/${yyyy} - ${hh}:${min}:${ss}`;
}

async function abrirModalNuevaRuta() {
    let choferesHtml = '<option value="">Cargando choferes...</option>';
    try {
        const resp = await fetch(`${API_BASE_URL}/api/logistica/usuarios/choferes`);
        const result = await resp.json();
        if(result.success) {
            choferesHtml = '<option value="">Seleccione un chofer...</option>';
            result.data.forEach(c => {
                // Pre-seleccionar al chofer que coincide con el usuario logueado (por ID de sesión)
                // CRÍTICO: NO usar comparación por nombre, ya que puede haber homónimos con IDs distintos
                const sesionActual = obtenerSesion();
                const seleccionado = (sesionActual && String(c.id) === String(sesionActual.id)) ? 'selected' : '';
                choferesHtml += `<option value="${c.id}" ${seleccionado}>${c.nombre_completo || c.usuario}</option>`;
            });
        }
    } catch(e) { console.error(e); }

    // Pre-popular fecha de salida con la hora actual y generar nombre sugerido: "Logística - [Día] DD/MM/YYYY - HH:MM:SS"
    const hoy = new Date();
    const ssInicial = String(hoy.getSeconds()).padStart(2, '0');
    const nowLocal = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000);
    const fechaIsoLocal = nowLocal.toISOString().slice(0, 16);
    const nombreSugerido = generarNombreSugeridoRutaMovil(fechaIsoLocal, ssInicial);

    const modalHtml = `
    <div id="modal-dinamico-ruta" class="modal-mobile" style="display: flex;">
        <div class="modal-content-mobile" style="padding:1.5rem;">
            <div class="modal-header-mobile" style="padding:0; border:none; margin-bottom:1.5rem;">
                <h2 style="font-size: 1.25rem;">Crear Nueva Ruta</h2>
                <button onclick="document.getElementById('modal-dinamico-ruta').remove()" style="background:none; border:none; font-size:1.5rem;">&times;</button>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Nombre de Ruta</label>
                <input type="text" id="nueva-ruta-nombre" value="${nombreSugerido}" placeholder="Ej: Reparto Tarde CABA" class="form-control" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1rem; font-size:1rem;">
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Chofer Asignado</label>
                <select id="nueva-ruta-chofer" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1rem; background:white; font-size:1rem;">
                    ${choferesHtml}
                </select>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Fecha de Salida</label>
                <input type="datetime-local" id="nueva-ruta-fecha" value="${fechaIsoLocal}" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1.5rem; font-size:1rem;">
            </div>
            <button onclick="ejecutarCrearRuta(event)" style="width:100%; padding:1rem; background:#2563eb; color:white; border:none; border-radius:0.5rem; font-weight:bold; font-size:1.1rem; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Guardar y Crear</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const inputFecha = document.getElementById('nueva-ruta-fecha');
    const inputNombre = document.getElementById('nueva-ruta-nombre');
    if (inputFecha && inputNombre) {
        inputFecha.value = fechaIsoLocal;
        inputNombre.dataset.ultimoNombreAuto = nombreSugerido;
        const sincronizarNombreConFecha = () => {
            if (!inputFecha.value) return;
            const actual = (inputNombre.value || '').trim();
            const ultimoAuto = inputNombre.dataset.ultimoNombreAuto || '';
            // Actualizar si el usuario mantiene el formato predeterminado ("Logística - ...") o no lo personalizó manualmente
            if (!actual || actual === ultimoAuto || actual.startsWith('Logística - ')) {
                const nuevoNombre = generarNombreSugeridoRutaMovil(inputFecha.value, ssInicial);
                inputNombre.value = nuevoNombre;
                inputNombre.dataset.ultimoNombreAuto = nuevoNombre;
            }
        };
        inputFecha.addEventListener('change', sincronizarNombreConFecha);
        inputFecha.addEventListener('input', sincronizarNombreConFecha);
    }
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

            const nuevaRutaId = result.data?.id || result.ruta?.id;
            if (nuevaRutaId) {
                sessionStorage.setItem('activeRouteId', String(nuevaRutaId));
            }

            // Notificar éxito con SweetAlert (no bloqueante)
            await Swal.fire({
                icon: 'success',
                title: '¡Ruta creada!',
                text: 'La ruta fue creada exitosamente.',
                confirmButtonColor: '#2563eb',
                timer: 2000,
                timerProgressBar: true
            });

            // Navegar a Mi Ruta y forzar re-fetch del estado con la nueva ruta
            switchTab('ruta');
            await cargarRutaActiva(nuevaRutaId);
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
    const seleccionados = Array.from(document.querySelectorAll('.chk-pedido:checked')).map(cb => {
        const val = String(cb.value);
        return (val.startsWith('RT-') || val.startsWith('SOB-') || val.startsWith('PR-')) ? val : parseInt(val);
    });
    if(seleccionados.length === 0) return;
    
    // Crear el modal vacio inmediatamente para evitar Lag de UI
    const modalHtml = `
    <div id="modal-asignar-ruta" class="modal-mobile" style="display: flex;">
        <div class="modal-content-mobile" style="padding:1.5rem;">
            <div class="modal-header-mobile" style="padding:0; border:none; margin-bottom:1.5rem;">
                <h2 style="font-size: 1.25rem;">📦 Asignar ${seleccionados.length} Pedidos</h2>
                <button onclick="document.getElementById('modal-asignar-ruta').remove()" style="background:none; border:none; font-size:1.5rem;">&times;</button>
            </div>
            <div class="form-group">
                <label style="font-weight:bold; margin-bottom:0.5rem; display:block;">Ruta Destino Activa</label>
                <select id="select-ruta-destino" style="width:100%; padding:0.75rem; border:1px solid #cbd5e1; border-radius:0.5rem; margin-bottom:1.5rem; background:white; font-size:1rem;" disabled>
                    <option value="">Investigando rutas activas...</option>
                </select>
            </div>
            <button id="btn-ejecutar-asignar" onclick='ejecutarAsignarRuta(${JSON.stringify(seleccionados)}, event)' style="width:100%; padding:1rem; background:#10b981; color:white; border:none; border-radius:0.5rem; font-weight:bold; font-size:1.1rem; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);" disabled>Cargando rutas...</button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Fetchear asíncronamente
    try {
        const resp = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas-activas`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await resp.json();
        
        const selector = document.getElementById('select-ruta-destino');
        const btnAsignar = document.getElementById('btn-ejecutar-asignar');
        if(!selector || !btnAsignar) return; // Se cerró antes de cargar
        
        let rutasHtml = '';
        if(result.success && result.data && result.data.length > 0) {
            rutasHtml = '<option value="">Seleccione una Ruta Destino...</option>';
            result.data.forEach(r => {
                rutasHtml += `<option value="${r.id}">${r.nombre_ruta} (Chofer: ${r.chofer_nombre})</option>`;
            });
            selector.innerHTML = rutasHtml;
            selector.disabled = false;
            btnAsignar.disabled = false;
            btnAsignar.innerText = 'Confirmar Asignación';
        } else {
            selector.innerHTML = '<option value="">No hay rutas en preparación (ARMANDO)</option>';
        }
    } catch(e) { 
        console.error(e);
        const selector = document.getElementById('select-ruta-destino');
        if (selector) selector.innerHTML = '<option value="">Error al cargar rutas</option>';
    }
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

window.descartarRetiro = async (idOrden) => {
    const idReal = String(idOrden).toUpperCase().replace('RT-', '');
    if(!confirm(`⚠️ ¿Está seguro que desea DESCARTAR la Orden de Tratamiento #${idReal}? Esta acción no se puede deshacer.`)) return;
    
    const container = document.getElementById('pendientes-container');
    if (container) {
        container.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Descartando orden...</p></div>';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/retiros/${idReal}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert('Orden descartada exitosamente.');
        } else {
            alert(data.error || 'Error descartando la orden');
        }
    } catch (err) {
        console.error('[MOVIL] Falla destructiva:', err);
        alert('Error de conexión o red.');
    } finally {
        cargarPendientes();
    }
};

window.quitarContactoDePendientesMovil = async (idProspReal, nombreComercio) => {
    const numId = String(idProspReal).replace('PR-', '');
    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/prospectos/${numId}/pool-logistica`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ en_pool_logistica: false })
        });
        const data = await res.json();
        if (data.success) {
            cargarPendientes();
        } else {
            alert(data.error || 'No se pudo retirar el contacto del pool');
        }
    } catch (e) {
        alert('Error de conexión al retirar contacto del pool');
    }
};

