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
    presupuestoImpresionId: null,

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
                    const esCategoriaRetiro = p.categoria === 'Orden de Tratamiento' || p.categoria === 'Orden de Retiro';
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
            const esRetiro = p.categoria === 'Orden de Tratamiento' || p.categoria === 'Orden de Retiro';
            const card = document.createElement('div');
            card.className = 'ticket-card compact-card'; // Clase ultra-compacta
            card.style.borderLeft = `3px solid ${esRetiro ? '#ef4444' : '#10b981'}`;

            // Determinar color de estado (Miniatura)
            let colorSt = '#94a3b8'; // default
            if(p.estado === 'PENDIENTE') colorSt = '#f59e0b'; // Naranja
            if(p.estado === 'FINALIZADO' || p.estado === 'ENTREGADO' || p.estado === 'FACTURADO') colorSt = '#10b981';

            // INDICADOR LOMASOFT ULTRASMOTH (Click para popup nativo Swal)
            const isReconciled = p.comprobante_lomasoft || p.id_factura_lomasoft;
            const badgeLomasoft = isReconciled 
                ? `<span class="badge-mini" style="background:#10b981; color:white; cursor:pointer;" onclick="event.stopPropagation(); Swal.fire('Conciliación Lomasoft','Comprobante asociado: <b>${p.comprobante_lomasoft || p.id_factura_lomasoft}</b>','info')">✅ Lomasoft</span>` 
                : `<span class="badge-mini" style="background:#475569; color:white; cursor:pointer;" onclick="event.stopPropagation(); Swal.fire('Pendiente Lomasoft','Aún no ha sido facturado ni conciliado.','info')">⏳ Pte. Facturación</span>`;
            
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

                    // Extensión PWA Imprimir (Excluimos Retiros)
                    if (this.estadoActual === 'ventas') {
                        // REGLAS CONTABLES ESTRICTAS: ¿El presupuesto es lógicamente modificable?
                        const pFound = this.listaMemoria.find(x => x.id == idPresupuesto) || {};
                        const stt = (pFound.estado || '').toUpperCase();
                        
                        const estaFacturado = !!pFound.esta_facturado;
                        const estaConciliado = !!pFound.comprobante_lomasoft;
                        const esEstadoTerminado = ['ENTREGADO', 'FACTURADO', 'FINALIZADO', 'CANCELADO', 'COMPLETADO'].includes(stt);
                        
                        const esIntocableContablemente = estaFacturado || estaConciliado || esEstadoTerminado;

                        const btnEditarDynamic = !esIntocableContablemente 
                            ? `<button class="btn-secondary" style="padding:0.6rem 1rem; font-size:0.85rem; background:#64748b; color:white; border:none; display:inline-flex; width:auto; border-radius:0.5rem;" onclick="window.location.href='crear-presupuesto-movil.html?edit=${idPresupuesto}'">✏️ Editar</button>`
                            : ''; // Si está sellado legalmente, desaparece el acceso a Edición

                        htmlDetalles += `
                            <div style="margin-top:1rem; text-align:right; display:flex; gap:0.5rem; justify-content:flex-end;">
                                ${btnEditarDynamic}
                                <button class="btn-continue" style="padding:0.6rem 1rem; font-size:0.85rem; background:#2563eb; display:inline-flex; width:auto; border-radius:0.5rem;" onclick="DashboardComercial.abrirPreImpresion(${idPresupuesto})">
                                    🖨️ Imprimir / Compartir
                                </button>
                            </div>
                        `;
                    }

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
    },

    async abrirPreImpresion(id) {
        this.presupuestoImpresionId = id;
        const modal = document.getElementById('modal-impresion');
        const selectFormato = document.getElementById('select-formato-impresion');
        const btnGenerar = document.getElementById('btn-generar-pdf-movil');
        
        document.getElementById('chk-solo-lista-movil').checked = false;
        
        // Bloquear scroll del fondo
        document.body.style.overflow = 'hidden';
        
        modal.style.display = 'flex';
        selectFormato.disabled = true;
        btnGenerar.disabled = true;
        btnGenerar.innerText = "Cargando...";

        try {
            const resp = await fetch(`${API_BASE_URL}/api/presupuestos/${id}`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const data = await resp.json();
            const condicion = data.data.condicion_iva || '';

            if (condicion.toUpperCase().includes('INSCRIPTO')) {
                selectFormato.value = 'IVA_DISCRIMINADO';
            } else {
                selectFormato.value = 'IVA_INCLUIDO';
            }
        } catch(e) {
            console.error('Error auto-detectando IVA:', e);
        } finally {
            selectFormato.disabled = false;
            btnGenerar.disabled = false;
            btnGenerar.innerText = "Compartir Ticket 📤";
        }
    },

    cerrarPreImpresion() {
        document.getElementById('modal-impresion').style.display = 'none';
        document.body.style.overflow = ''; // Restaurar scroll
        this.presupuestoImpresionId = null;
    },

    async generarImpresion() {
        if(!this.presupuestoImpresionId) return;
        const btnGenerar = document.getElementById('btn-generar-pdf-movil');
        const formato = document.getElementById('select-formato-impresion').value;
        const soloLista = document.getElementById('chk-solo-lista-movil').checked;
        const idTicket = this.presupuestoImpresionId;
        
        // Loader y Bloqueo de Interfaz mientras el Headless genera el Ticket Binario
        btnGenerar.disabled = true;
        btnGenerar.innerText = "Renderizando...";

        try {
            const queryParams = new URLSearchParams({ formato: formato });
            if (soloLista) queryParams.append('sololista', 'true');
            
            // Utilizamos el Proxy local Logístico '/api/presupuestos'
            const response = await fetch(`${API_BASE_URL}/api/presupuestos/${idTicket}/pdf?${queryParams.toString()}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            
            if (!response.ok) {
                const errJson = await response.json();
                throw new Error(errJson.error || "Fallo HTTP del generador P.D.F.");
            }
            
            const blob = await response.blob();
            const file = new File([blob], `Cotizacion_${idTicket}.pdf`, { type: 'application/pdf' });
            
            // Ocultar Modal YA MISMO para UX Instantánea
            this.cerrarPreImpresion();
            
            // Native Share API
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Presupuesto #${idTicket}`,
                    text: `Te comparto nuestra cotización.`,
                    files: [file]
                });
                console.log('✅ [SHARE] Archivo pasado al SO');
            } else {
                console.warn('⚠️ [SHARE] Web Share no disponible, descargando...');
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = `Cotizacion_${idTicket}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(objectUrl);
            }
            
        } catch (error) {
            console.error('❌ [PDF ERROR]:', error);
            alert(`Fallo en Renderización / Compartir: ${error.message}`);
        } finally {
            if(btnGenerar) {
                btnGenerar.disabled = false;
                btnGenerar.innerText = "Compartir Ticket 📤";
            }
        }
    }
};

window.DashboardComercial = DashboardComercial;
