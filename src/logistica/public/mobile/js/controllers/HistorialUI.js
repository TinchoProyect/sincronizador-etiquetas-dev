// --- HistorialUI.js ---

async function cargarHistorial() {
    const container = document.getElementById('historial-container');
    if(!container) return;
    
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Cargando historial...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas-historial`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await response.json();
        
        if (result.success && result.data && result.data.length > 0) {
            container.innerHTML = result.data.map(r => `
                <div class="entrega-card completada" onclick="abrirDetalleRutaHistorial(${r.id})" style="cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div class="entrega-header">
                        <div style="font-weight: bold; color: #1e293b; font-size:1.1rem;">${r.nombre_ruta || 'Ruta #'+r.id}</div>
                        <div class="entrega-badge badge-completada">Auditar 🔍</div>
                    </div>
                    <div class="entrega-direccion" style="margin-bottom:0;">
                        <strong>Salida:</strong> ${r.fecha_salida ? formatearFecha(r.fecha_salida) + ' ' + formatearHora(r.fecha_salida) : 'N/A'}<br>
                        <strong>Cierre:</strong> ${r.fecha_finalizacion ? formatearFecha(r.fecha_finalizacion) + ' ' + formatearHora(r.fecha_finalizacion) : 'N/A'}
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🕒</div>
                    <h2>Sin Historial</h2>
                    <p>Aún no has cerrado ninguna ruta.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[HISTORIAL] Error:', error);
        container.innerHTML = `<div class="empty-state"><p>Error cargando historial</p></div>`;
    }
}
async function abrirDetalleRutaHistorial(idRuta) {
    if(!document.getElementById('modal-detalle-ruta')) {
        const modalHtml = `
        <div id="modal-detalle-ruta" class="modal-mobile" style="display: flex;">
            <div class="modal-content-mobile" style="padding:1.5rem; max-height: 85vh; overflow-y: auto;">
                <div class="modal-header-mobile" style="padding:0; border:none; margin-bottom:1rem;">
                    <h2 style="font-size: 1.25rem; color:#1e293b;" id="detalle-ruta-titulo">Cargando...</h2>
                    <button onclick="document.getElementById('modal-detalle-ruta').remove()" style="background:none; border:none; font-size:1.5rem;">&times;</button>
                </div>
                <div id="detalle-ruta-contenido">
                    <div class="loading-screen"><div class="spinner"></div><p>Buscando auditoría de mercancía...</p></div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    const container = document.getElementById('detalle-ruta-contenido');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${idRuta}/detalle-completo`, {
            headers: { 'Authorization': `Bearer ${state.sesion.token}` }
        });
        const result = await response.json();
        
        if (result.success && result.data) {
            const ruta = result.data;
            document.getElementById('detalle-ruta-titulo').textContent = `${ruta.nombre_ruta} (${ruta.chofer_nombre})`;
            
            if(ruta.entregas.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No se enviaron bultos en este reparto.</p></div>';
                return;
            }
            
            let html = '';
            ruta.entregas.forEach(e => {
                const esRetiro = e.estado === 'Orden de Tratamiento';
                const color = esRetiro ? '#dc2626' : '#2563eb';
                
                let articulosHtml = '<ul style="margin: 0.5rem 0 0.5rem 1.5rem; font-size: 0.85rem; color: #475569; padding-left:0;">';
                e.articulos.forEach(art => {
                    articulosHtml += `<li style="margin-bottom: 2px;">${art.cantidad}x ${art.articulo}</li>`;
                });
                articulosHtml += '</ul>';

                let badge = '';
                if(e.comprobante_lomasoft) badge = `<span style="font-size:0.7rem; background:#d1fae5; color:#059669; padding:2px 4px; border-radius:4px; margin-left:8px;">✅ ${e.comprobante_lomasoft}</span>`;
                else if(e.id_factura_lomasoft) badge = `<span style="font-size:0.7rem; background:#d1fae5; color:#059669; padding:2px 4px; border-radius:4px; margin-left:8px;">📄 ${e.id_factura_lomasoft}</span>`;

                const totalFormateado = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(e.total_monto || 0);

                html += `
                <div style="border-left: 3px solid ${color}; margin-bottom: 1rem; background: #fff; padding: 12px; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="font-weight: bold; margin-bottom: 4px; color:#1e293b; display: flex; justify-content: space-between; align-items: center;">
                        <span>${esRetiro ? '↩️ Orden de Tratamiento #' : '📦 Pedido #'}${e.id} ${badge}</span>
                        <span style="color:#0f172a; font-size:1.1rem;">${totalFormateado}</span>
                    </div>
                    <div style="font-size: 0.95rem; color: #334155; margin-bottom: 4px;">👤 ${e.cliente_nombre}</div>
                    <div style="font-size: 0.8rem; font-weight: bold; color: ${color};">${e.estado_logistico}</div>
                    ${articulosHtml}
                </div>`;
            });
            container.innerHTML = html;
        } else {
            document.getElementById('detalle-ruta-titulo').textContent = '⚠️ Falla en Carga';
            container.innerHTML = `<p style="color:red; text-align:center;">Error BD: ${result.error}</p>`;
        }
    } catch(err) {
        document.getElementById('detalle-ruta-titulo').textContent = '❌ Desconexión';
        container.innerHTML = `<p style="color:red; text-align:center;">Error conectando al nodo origen</p>`;
    }
}
