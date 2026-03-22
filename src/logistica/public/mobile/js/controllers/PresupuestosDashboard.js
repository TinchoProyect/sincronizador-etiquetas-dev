/**
 * Controlador de Dashboard Comercial (Ventas vs Retiros)
 * Archivo: PresupuestosDashboard.js
 */

const DashboardComercial = {
    estadoActual: 'ventas', // 'ventas' o 'retiros'

    init() {
        this.cargarHistorial();
    },

    setTab(tab) {
        this.estadoActual = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        this.cargarHistorial();
    },

    async cargarHistorial() {
        const contenedor = document.getElementById('historial-container');
        contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto"></div><p style="text-align:center; color:#64748b">Cargando movimientos...</p>';

        try {
            // Se utiliza el endpoint de presupuestos (que soporta limit y order default DESC)
            const response = await fetch(`${API_BASE_URL}/api/presupuestos?limit=25`, {
                headers: {
                    'Authorization': `Bearer ${state.sesion.token}`
                }
            });

            const data = await response.json();

            if (data.success && data.data) {
                // Filtrar según el tab actual (Retiros = "Orden de Retiro", Ventas = Resto)
                const isRetiro = this.estadoActual === 'retiros';
                
                const filtrados = data.data.filter(p => {
                    const esCategoriaRetiro = p.categoria === 'Orden de Retiro';
                    return isRetiro ? esCategoriaRetiro : !esCategoriaRetiro;
                });

                this.renderizarTarjetas(filtrados);
            } else {
                contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error al leer la base de datos.</div>';
            }

        } catch(error) {
            console.error('Error fetching historial:', error);
            contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Sin conexión al servidor central.</div>';
        }
    },

    renderizarTarjetas(lista) {
        const contenedor = document.getElementById('historial-container');
        contenedor.innerHTML = '';

        if (lista.length === 0) {
            contenedor.innerHTML = `
                <div class="placeholder-card">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
                    <p><strong>Listado Vacío</strong><br>No tenés operaciones recientes en este sector.</p>
                </div>
            `;
            return;
        }

        lista.forEach(p => {
            const esRetiro = p.categoria === 'Orden de Retiro';
            const card = document.createElement('div');
            card.className = 'ticket-card';
            card.style.marginBottom = '1rem';
            card.style.borderLeft = `4px solid ${esRetiro ? '#ef4444' : '#10b981'}`;

            // Determinar color de estado (Badge)
            let colorSt = '#94a3b8'; // default
            if(p.estado === 'PENDIENTE') colorSt = '#f59e0b'; // Naranja
            if(p.estado === 'FINALIZADO' || p.estado === 'ENTREGADO' || p.estado === 'FACTURADO') colorSt = '#10b981'; // Verde

            const badgeLomasoft = p.comprobante_lomasoft 
                ? `<span style="background:#2563eb; color:white; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius:1rem;">🔗 Lomasoft: ${p.comprobante_lomasoft}</span>` 
                : '';
            
            const badgeAFIP = p.esta_facturado 
                ? `<span style="background:#10b981; color:white; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius:1rem;">🧾 AFIP</span>` 
                : '';

            // Corrección Integral: p.concepto trae Cliente (o "Consumidor Final"), p.total_final es la facturación y p.fecha_registro es la fecha
            const nombreCliente = p.concepto || 'Consumidor Final';
            const fechaTxt = p.fecha_registro ? new Date(p.fecha_registro).toLocaleDateString() : 'Sin Fecha';
            const totalDinero = parseFloat(p.total_final || 0).toLocaleString('es-AR', {minimumFractionDigits:2});

            card.innerHTML = `
                <div class="acordeon-header" onclick="DashboardComercial.toggleDetalles(${p.id})" style="cursor:pointer">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem">
                        <div>
                            <span style="font-size:0.8rem; color:#64748b; font-weight:bold;">#${p.id} - ${fechaTxt}</span>
                            <h4 style="margin:0.2rem 0; font-size:1.15rem; color:#1e293b">${nombreCliente}</h4>
                        </div>
                        <span style="background:${colorSt}; color:white; font-size:0.75rem; padding: 0.2rem 0.5rem; border-radius:1rem; font-weight:bold">${p.estado || 'N/A'}</span>
                    </div>
                    
                    <div class="ticket-divider" style="margin: 0.5rem 0"></div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; gap:0.5remflex-wrap:wrap">
                            ${badgeLomasoft}
                            ${badgeAFIP}
                        </div>
                        <div style="flex-grow:1"></div>
                        <span style="font-weight:900; font-size:1.2rem; color:${esRetiro ? '#ef4444' : '#1e293b'}">
                            ${esRetiro ? '-' : ''}$${totalDinero}
                            <span style="font-size:0.9rem; color:#64748b; margin-left:0.3rem">▼</span>
                        </span>
                    </div>
                </div>
                <!-- Acordeón Contenedor -->
                <div id="detalles-${p.id}" class="acordeon-body" style="display:none; margin-top:1rem; padding-top:1rem; border-top:1px dashed #e2e8f0;">
                    <div class="loader-spinner" style="width:20px; height:20px; border-width:2px; margin:0 auto;"></div>
                </div>
            `;
            
            contenedor.appendChild(card);
        });
    },

    async toggleDetalles(idPresupuesto) {
        const container = document.getElementById(`detalles-${idPresupuesto}`);
        if (!container) return;

        // Si ya está abierto, lo cerramos
        if (container.style.display === 'block') {
            container.style.display = 'none';
            return;
        }

        // Si está cerrado, lo abrimos y si no está cargado, fetcheamos
        container.style.display = 'block';
        if (container.dataset.cargado === 'true') return;

        try {
            const resp = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}/detalles`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const data = await resp.json();

            if (data.success && data.data) {
                if (data.data.length === 0) {
                    container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:0.85rem">No posee artículos detallados.</p>';
                } else {
                    let htmlDetalles = '<ul style="list-style:none; padding:0; margin:0; font-size:0.85rem;">';
                    data.data.forEach(item => {
                        const esDevuelto = item.cantidad < 0; // Algunas ORD de la PC guardan cantidades negativas
                        htmlDetalles += `
                            <li style="display:flex; justify-content:space-between; padding:0.3rem 0; border-bottom:1px solid #f1f5f9">
                                <span><strong style="color:${esDevuelto?'#ef4444':'#2563eb'}">${Math.abs(item.cantidad)}x</strong> ${item.description || item.articulo || 'Producto'}</span>
                                <span style="font-weight:bold">$${parseFloat(item.precio_total || 0).toLocaleString('es-AR',{minimumFractionDigits:2})}</span>
                            </li>
                        `;
                    });
                    htmlDetalles += '</ul>';
                    container.innerHTML = htmlDetalles;
                }
                container.dataset.cargado = 'true';
            } else {
                throw new Error("Respuesta inválida al leer detalles");
            }
        } catch (error) {
            console.error(error);
            container.innerHTML = '<p style="text-align:center; color:red; font-size:0.85rem">Error al cargar artículos.</p>';
        }
    }
};

window.DashboardComercial = DashboardComercial;
