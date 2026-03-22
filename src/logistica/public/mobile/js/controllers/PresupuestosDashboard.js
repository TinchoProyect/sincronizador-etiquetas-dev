/**
 * Controlador de Dashboard Comercial (Ventas vs Retiros)
 * Archivo: PresupuestosDashboard.js
 */

const DashboardComercial = {
    estadoActual: 'ventas', // 'ventas' o 'retiros'
    currentPage: 1,
    fechaFiltro: '',
    listaMemoria: [],
    hasMore: false,

    init() {
        // Inicializar fecha de hoy por defecto si lo requiere, o vacio
        this.cargarHistorial();
    },

    setTab(tab) {
        this.estadoActual = tab;
        this.currentPage = 1;
        this.listaMemoria = [];
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        this.cargarHistorial();
    },

    aplicarFiltroFecha() {
        this.fechaFiltro = document.getElementById('filtro-fecha').value;
        this.currentPage = 1;
        this.listaMemoria = [];
        this.cargarHistorial();
    },

    cargarMas() {
        if(this.hasMore) {
            this.currentPage++;
            this.cargarHistorial(true);
        }
    },

    async cargarHistorial(append = false) {
        const contenedor = document.getElementById('historial-container');
        const btnCargarMas = document.getElementById('btn-cargar-mas');
        
        if (!append) {
            contenedor.innerHTML = '<div class="loader-spinner" style="margin:2rem auto; width:30px; height:30px;"></div>';
            btnCargarMas.style.display = 'none';
        } else {
            btnCargarMas.innerText = "Cargando...";
            btnCargarMas.disabled = true;
        }

        try {
            // Se utiliza el endpoint de presupuestos (que soporta limit y order default DESC)
            let queryUrl = `${API_BASE_URL}/api/presupuestos?limit=20&page=${this.currentPage}`;
            if (this.fechaFiltro) {
                // Si el backend nativo no soporta los query param de fecha directamente, la PWA debería tratar de simularlo.
                // Como PC paridad tiene filtros SQL, pasamos "fecha_inicio" o emulamos en RAM si el servidor los ignora
                queryUrl += `&fecha_inicio=${this.fechaFiltro}&fecha_fin=${this.fechaFiltro}`;
            }

            const response = await fetch(queryUrl, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });

            if (!response.ok) throw new Error("API devovió " + response.status);
            const data = await response.json();

            if (data.success && data.data) {
                const isRetiro = this.estadoActual === 'retiros';
                let filtrados = data.data.filter(p => {
                    const esCategoriaRetiro = p.categoria === 'Orden de Retiro';
                    return isRetiro ? esCategoriaRetiro : !esCategoriaRetiro;
                });

                // Si se usó filtro de fecha pero el SQL del Backend no lo atajó, lo atajamos en RAM
                if (this.fechaFiltro) {
                    filtrados = filtrados.filter(p => p.fecha_registro && p.fecha_registro.startsWith(this.fechaFiltro));
                }

                if (append) {
                    this.listaMemoria = this.listaMemoria.concat(filtrados);
                } else {
                    this.listaMemoria = filtrados;
                }

                // Determinamos hasMore chequeando la meta de paginación del back, o bien si trajo length == limit
                this.hasMore = data.pagination ? data.pagination.hasNext : (data.data.length === 20);

                this.renderizarTarjetas();
            } else {
                if(!append) contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Error al leer la base de datos.</div>';
            }

        } catch(error) {
            console.error('Error fetching historial:', error);
            if(!append) contenedor.innerHTML = '<div class="placeholder-msg" style="color:red">Sin conexión al servidor central.</div>';
        } finally {
            if(append) {
                btnCargarMas.innerText = "Cargar Más Antiguos ↓";
                btnCargarMas.disabled = false;
            }
        }
    },

    renderizarTarjetas() {
        const contenedor = document.getElementById('historial-container');
        const btnCargarMas = document.getElementById('btn-cargar-mas');

        if (this.listaMemoria.length === 0) {
            contenedor.innerHTML = `
                <div class="placeholder-card" style="padding:1rem;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
                    <p style="font-size:0.9rem"><strong>Listado Vacío</strong><br>No hay operaciones en este filtro.</p>
                </div>
            `;
            btnCargarMas.style.display = 'none';
            return;
        }

        contenedor.innerHTML = '';

        this.listaMemoria.forEach(p => {
            const esRetiro = p.categoria === 'Orden de Retiro';
            const card = document.createElement('div');
            card.className = 'ticket-card compact-card'; // Clase ultra-compacta
            card.style.borderLeft = `3px solid ${esRetiro ? '#ef4444' : '#10b981'}`;

            // Determinar color de estado (Miniatura)
            let colorSt = '#94a3b8'; // default
            if(p.estado === 'PENDIENTE') colorSt = '#f59e0b'; // Naranja
            if(p.estado === 'FINALIZADO' || p.estado === 'ENTREGADO' || p.estado === 'FACTURADO') colorSt = '#10b981';

            // INDICADOR LOMASOFT ULTRASMOTH (Click para popup nativo Swal)
            const badgeLomasoft = p.comprobante_lomasoft 
                ? `<span class="badge-mini link-loma" onclick="event.stopPropagation(); Swal.fire('Conciliación Lomasoft','Este registro pertenece al comprobante Lomasoft: <b>${p.comprobante_lomasoft}</b>','info')">🔗 Lomasoft</span>` 
                : '';
            
            const badgeAFIP = p.esta_facturado 
                ? `<span class="badge-mini" style="background:#10b981;">🧾 AFIP</span>` 
                : '';

            const nombreCliente = p.concepto || 'Consumidor Final';
            const hrString = p.fecha_registro ? new Date(p.fecha_registro).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}) : '';
            const totalDinero = parseFloat(p.total_final || 0).toLocaleString('es-AR', {minimumFractionDigits:2});

            card.innerHTML = `
                <div class="acordeon-header" onclick="DashboardComercial.toggleDetalles('${p.id}')">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="max-width:65%">
                            <h4 class="compact-title text-truncate">${nombreCliente}</h4>
                            <div class="compact-subtitle" style="display:flex; gap:0.3rem; align-items:center; flex-wrap:wrap">
                                <span>#${p.id}</span> • <span>${hrString}</span>
                                ${badgeLomasoft}
                                ${badgeAFIP}
                            </div>
                        </div>
                        <div style="text-align:right">
                            <span class="compact-price ${esRetiro ? 'text-red' : ''}">$${totalDinero}</span>
                            <div style="margin-top:0.2rem">
                                <span class="badge-dot" style="background:${colorSt}"></span>
                                <span style="font-size:0.7rem; color:${colorSt}; font-weight:800">${p.estado || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Acordeón Contenedor -->
                <div id="detalles-${p.id}" class="acordeon-body" style="display:none; margin-top:0.5rem; padding-top:0.5rem; border-top:1px dashed #e2e8f0;">
                    <div class="loader-spinner" style="width:16px; height:16px; border-width:2px; margin:0 auto;"></div>
                </div>
            `;
            
            contenedor.appendChild(card);
        });

        btnCargarMas.style.display = this.hasMore ? 'block' : 'none';
    },

    async toggleDetalles(idPresupuesto) {
        const container = document.getElementById(`detalles-${idPresupuesto}`);
        if (!container) return;

        // Si ya está abierto, lo cerramos
        if (container.style.display === 'block') {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        if (container.dataset.cargado === 'true') return;

        try {
            const resp = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}/detalles`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            if (!resp.ok) throw new Error("Endpoint Detalles 404/500");
            
            const data = await resp.json();

            if (data.success && data.data) {
                // Adaptación: El backend de PC nativo devuelve { presupuesto, detalles, totales } dentro de data.data
                const items = Array.isArray(data.data) ? data.data : (data.data.detalles || []);
                
                if (items.length === 0) {
                    container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:0.75rem; margin:0">Detalle vacío.</p>';
                } else {
                    let htmlDetalles = '<ul style="list-style:none; padding:0; margin:0; font-size:0.75rem; color:#334155">';
                    items.forEach(item => {
                        const esDevuelto = item.cantidad < 0; 
                        htmlDetalles += `
                            <li style="display:flex; justify-content:space-between; padding:0.2rem 0; border-bottom:1px solid #f8fafc">
                                <span class="text-truncate" style="max-width:70%"><strong style="color:${esDevuelto?'#ef4444':'#2563eb'}">${Math.abs(item.cantidad)}x</strong> ${item.description || item.descripcion_articulo || item.articulo || item.descripcion || 'Prod'}</span>
                                <span style="font-weight:bold">$${parseFloat(item.total || item.precio_total || 0).toLocaleString('es-AR',{minimumFractionDigits:2})}</span>
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
            console.error('[DETALLES ERROR]:', error);
            container.innerHTML = '<p style="text-align:center; color:#ef4444; font-size:0.75rem; margin:0">Error de conexión al cargar detalle.</p>';
        }
    }
};

window.DashboardComercial = DashboardComercial;
