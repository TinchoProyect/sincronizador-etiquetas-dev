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
            const totalDinero = parseFloat(p.total_final || 0).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2});

            const rawDesc = parseFloat(p.descuento || 0);
            const descPct = rawDesc > 0 && rawDesc < 1 ? Math.round(rawDesc * 10000) / 100 : Math.round(rawDesc * 100) / 100;
            const badgeDescuento = descPct > 0
                ? `<span class="compact-discount-pill">🏷️ -${descPct}% bonif.</span>`
                : '';

            card.innerHTML = `
                <div class="acordeon-header" onclick="DashboardComercial.toggleDetalles('${p.id}')">
                    <div class="compact-header-row">
                        <div class="compact-col-left">
                            <h4 class="compact-title">${nombreCliente}</h4>
                            <div class="compact-subtitle" style="display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap; margin-top:0.3rem;">
                                <span>#${p.id}</span>${hrString ? ` • <span>${hrString}</span>` : ''}
                                ${badgeLomasoft}
                                ${badgeAFIP}
                            </div>
                        </div>
                        <div class="compact-col-right">
                            <span class="compact-price ${esRetiro ? 'text-red' : ''}">$${totalDinero}</span>
                            ${badgeDescuento}
                            <div class="compact-status-row">
                                <span class="badge-dot" style="background:${colorSt}"></span>
                                <span style="font-size:0.7rem; color:${colorSt}; font-weight:800">${p.estado || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Acordeón Contenedor -->
                <div id="detalles-${p.id}" class="acordeon-body" style="display:none; margin-top:0.65rem; padding-top:0.65rem; border-top:1px dashed rgba(255,255,255,0.14);">
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
                const presuInfo = (!Array.isArray(data.data) && data.data.presupuesto) ? data.data.presupuesto : {};
                const pFound = this.listaMemoria.find(x => x.id == idPresupuesto) || {};
                
                if (items.length === 0) {
                    container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:0.8rem; margin:0.25rem 0;">Detalle sin artículos.</p>';
                } else {
                    let subtotalBrutoItems = 0;
                    let htmlDetalles = '<ul class="detalle-items-list">';
                    items.forEach(item => {
                        const cant = parseFloat(item.cantidad || 0);
                        const esDevuelto = cant < 0;
                        const lineaTotal = parseFloat(item.total || item.precio_total || 0);
                        subtotalBrutoItems += lineaTotal;
                        const unitPrice = Math.abs(cant) > 0 ? Math.abs(lineaTotal / cant) : parseFloat(item.precio1 || 0);
                        const nombreArt = item.description || item.descripcion_articulo || item.descripcion || item.articulo || 'Artículo';
                        const cantStr = Number.isInteger(Math.abs(cant)) ? Math.abs(cant) : Math.abs(cant).toLocaleString('es-AR', {maximumFractionDigits: 2});

                        htmlDetalles += `
                            <li class="detalle-item-row">
                                <div class="detalle-item-left">
                                    <span class="detalle-item-qty ${esDevuelto ? 'is-return' : ''}">${cantStr}x</span>
                                    <div style="flex:1; min-width:0;">
                                        <span class="detalle-item-name">${nombreArt}</span>
                                        ${Math.abs(cant) > 1 && unitPrice > 0 ? `<span class="detalle-item-unit">$${unitPrice.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} c/u</span>` : ''}
                                    </div>
                                </div>
                                <span class="detalle-item-price">$${lineaTotal.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                            </li>
                        `;
                    });
                    htmlDetalles += '</ul>';

                    // Desglose de bonificación / descuento y observaciones si existen
                    const rawDesc = parseFloat(presuInfo.descuento ?? pFound.descuento ?? 0);
                    const descDecimal = rawDesc > 1 ? rawDesc / 100 : rawDesc;
                    const descPct = Math.round(descDecimal * 10000) / 100;
                    const notaTexto = (presuInfo.nota || pFound.nota || '').trim();

                    if (descDecimal > 0 && subtotalBrutoItems > 0) {
                        const montoDescuento = Math.round(subtotalBrutoItems * descDecimal * 100) / 100;
                        const totalConDescuento = Math.round((subtotalBrutoItems - montoDescuento) * 100) / 100;
                        htmlDetalles += `
                            <div class="detalle-resumen-box">
                                <div class="detalle-resumen-line">
                                    <span>Subtotal (${items.length} ítem${items.length !== 1 ? 's' : ''})</span>
                                    <span style="font-weight:700; color:#e2e8f0;">$${subtotalBrutoItems.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                                </div>
                                <div class="detalle-resumen-line" style="color:#fbbf24;">
                                    <span>🏷️ Bonificación (-${descPct}%)</span>
                                    <span style="font-weight:800;">-$${montoDescuento.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                                </div>
                                <div class="detalle-resumen-line" style="margin-top:0.2rem; padding-top:0.25rem; border-top:1px solid rgba(255,255,255,0.1); font-weight:800; color:#34d399; font-size:0.84rem;">
                                    <span>Total Final</span>
                                    <span>$${totalConDescuento.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                                </div>
                            </div>
                        `;
                    }

                    if (notaTexto) {
                        htmlDetalles += `
                            <div class="detalle-nota-box">
                                <strong>📝 Nota:</strong> ${notaTexto}
                            </div>
                        `;
                    }

                    // Extensión PWA Imprimir y WhatsApp (Excluimos Retiros)
                    if (this.estadoActual === 'ventas') {
                        const stt = (pFound.estado || '').toUpperCase();
                        
                        const estaFacturado = !!pFound.esta_facturado;
                        const estaConciliado = !!pFound.comprobante_lomasoft;
                        const esEstadoTerminado = ['ENTREGADO', 'FACTURADO', 'FINALIZADO', 'CANCELADO', 'COMPLETADO'].includes(stt);
                        const esIntocableContablemente = estaFacturado || estaConciliado || esEstadoTerminado;

                        const btnEditarDynamic = !esIntocableContablemente 
                            ? `<button class="btn-cancel" style="padding:0.5rem 0.85rem; font-size:0.8rem; background:#334155; color:#f8fafc; border:none; display:inline-flex; width:auto; border-radius:0.5rem;" onclick="window.location.href='crear-presupuesto-movil.html?edit=${idPresupuesto}'">✏️ Editar</button>`
                            : '';

                        const btnEliminarDynamic = !esIntocableContablemente
                            ? `<button class="btn-cancel" style="padding:0.5rem 0.85rem; font-size:0.8rem; background:rgba(239,68,68,0.15); color:#fca5a5; border:1px solid rgba(239,68,68,0.3); display:inline-flex; width:auto; border-radius:0.5rem;" onclick="DashboardComercial.eliminarPresupuesto(${idPresupuesto})">🗑️</button>`
                            : '';

                        htmlDetalles += `
                            <div style="margin-top:0.85rem; text-align:right; display:flex; gap:0.4rem; justify-content:flex-end; flex-wrap:wrap;">
                                ${btnEliminarDynamic}
                                ${btnEditarDynamic}
                                <button class="btn-cancel" style="padding:0.5rem 0.85rem; font-size:0.8rem; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); display:inline-flex; width:auto; border-radius:0.5rem; gap:4px; align-items:center;" onclick="DashboardComercial.abrirModalEnvioOmnicanal(${idPresupuesto})">
                                    <span>📤</span> Enviar / WhatsApp
                                </button>
                                <button class="btn-continue" style="padding:0.5rem 0.85rem; font-size:0.8rem; background:#10b981; display:inline-flex; width:auto; border-radius:0.5rem; gap:4px; align-items:center;" onclick="DashboardComercial.abrirModalEnvioOmnicanal(${idPresupuesto}, true)">
                                    <span>🖨️</span> PDF
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

    async eliminarPresupuesto(id) {
        const confirmacion = await Swal.fire({
            title: '¿Eliminar documento?',
            text: "Esta acción no se puede deshacer.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#94a3b8',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        });

        if (!confirmacion.isConfirmed) return;

        try {
            Swal.fire({
                title: 'Eliminando...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading() }
            });

            const resp = await fetch(`${API_BASE_URL}/api/presupuestos/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const data = await resp.json();
            
            if(data.success) {
                Swal.fire('¡Eliminado!', 'El presupuesto ha sido borrado.', 'success');
                this.listaMemoria = this.listaMemoria.filter(p => p.id != id);
                this.renderizarTarjetas();
            } else {
                throw new Error(data.error || data.message || "Error al eliminar");
            }
        } catch(e) {
            console.error('❌ [ELIMINAR ERROR]:', e);
            Swal.fire('Error', e.message || "Error de conexión", 'error');
        }
    },

    /**
     * Modal Omnicanal Unificado Móvil (WhatsApp PDF, Correo, Selector de Contactos, Alias y Formato)
     */
    async abrirModalEnvioOmnicanal(idPresupuesto, prefiereDescargaPdf = false) {
        try {
            Swal.fire({
                title: 'Cargando cotización...',
                text: 'Consultando ficha fiscal y contactos...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const resp = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}`, {
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });
            const dataPresu = await resp.json();

            if (!dataPresu.success || !dataPresu.data) {
                throw new Error(dataPresu.error || 'No se pudo obtener la cotización');
            }

            const presupuesto = dataPresu.data;
            const clienteNombre = presupuesto.concepto || presupuesto.nombre_cliente || 'Cliente';
            const condicionIva = (presupuesto.condicion_iva || '').trim();
            const esInscripto = condicionIva.toUpperCase().includes('INSCRIPTO');

            // Determinar formato por defecto
            let formatoSeleccionado = presupuesto.formato_impresion || (esInscripto ? 'IVA_DISCRIMINADO' : 'IVA_INCLUIDO');

            // Mensaje por defecto con Alias LAMDA (en presupuestos consolidados no corresponde nota de bonificaciones)
            const transferInfo = '\n\n*Datos para transferencia:*\n*ALIAS:* LAMDA.SER.MARTIN';
            const tituloDoc = presupuesto.estado === 'Orden de Retiro' ? 'Orden de Retiro / Devolución' : 'Presupuesto';
            const defaultMensaje = `Hola, te enviamos el ${tituloDoc.toLowerCase()} N° ${idPresupuesto} de LAMDA.` + transferInfo;

            // 1. Recuperar y parsear contactos de WhatsApp
            let contactsWp = [];
            const rawWp = (presupuesto.whatsapp_bunker || '').trim();
            if (rawWp.startsWith('[')) {
                try { contactsWp = JSON.parse(rawWp); } catch(e) {}
            }
            if (!Array.isArray(contactsWp) || contactsWp.length === 0) {
                const rawPhone = rawWp || presupuesto.celular || presupuesto.telefono || '';
                contactsWp = rawPhone.split(',').map(num => ({
                    numero: num.trim(),
                    nombre: '',
                    cargo: ''
                })).filter(c => c.numero);
            }

            // 2. Recuperar y parsear contactos de Email
            let emails = [];
            const rawEmail = (presupuesto.email_bunker || '').trim();
            if (rawEmail.startsWith('[')) {
                try { emails = JSON.parse(rawEmail); } catch(e) {}
            }
            if (!Array.isArray(emails) || emails.length === 0) {
                const rawEmailStr = rawEmail || presupuesto.email || '';
                emails = rawEmailStr.split(',').map(em => ({
                    email: em.trim(),
                    nombre: '',
                    cargo: ''
                })).filter(e => e.email);
            }

            // Destinatarios predeterminados
            const hasWpPresupuestoConfig = contactsWp.some(c => typeof c.default_presupuesto === 'boolean');
            const hasEmailPresupuestoConfig = emails.some(e => typeof e.default_presupuesto === 'boolean');

            const hasWpGeneralConfig = !hasWpPresupuestoConfig && contactsWp.some(c => typeof c.default === 'boolean');
            const hasEmailGeneralConfig = !hasEmailPresupuestoConfig && emails.some(e => typeof e.default === 'boolean');

            const canalPreferido = (presupuesto.canal_envio_preferido || '').toLowerCase();

            // Construir HTML UI Touch Dark Búnker
            let html = `
                <div style="text-align:left; font-family: inherit; font-size: 13px; color: #cbd5e1;">
                    <!-- Cabecera Cliente -->
                    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 10px; margin-bottom: 14px;">
                        <div style="font-weight: 700; color: #f8fafc; font-size: 14px; margin-bottom: 3px;">${clienteNombre}</div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px;">
                            ${presupuesto.cuit ? `<span style="background:#334155; padding:2px 6px; border-radius:4px; color:#94a3b8;">CUIT: ${presupuesto.cuit}</span>` : ''}
                            <span style="background:${esInscripto ? '#065f46' : '#1e3a8a'}; color:${esInscripto ? '#34d399' : '#93c5fd'}; padding:2px 6px; border-radius:4px; font-weight:700;">
                                ${condicionIva || 'Consumidor Final'}
                            </span>
                        </div>
                    </div>

                    <!-- Selector de Formato de IVA -->
                    <div style="margin-bottom: 14px;">
                        <label style="font-weight: 700; font-size: 12px; color: #94a3b8; display: block; margin-bottom: 6px; text-transform: uppercase;">Formato de Documento:</label>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" id="btn-swal-fmt-disc" class="swal-fmt-btn ${formatoSeleccionado === 'IVA_DISCRIMINADO' ? 'active' : ''}" style="flex: 1; padding: 8px; border-radius: 8px; border: 1px solid ${formatoSeleccionado === 'IVA_DISCRIMINADO' ? '#10b981' : '#334155'}; background: ${formatoSeleccionado === 'IVA_DISCRIMINADO' ? 'rgba(16,185,129,0.2)' : '#1e293b'}; color: ${formatoSeleccionado === 'IVA_DISCRIMINADO' ? '#34d399' : '#94a3b8'}; font-weight: 700; font-size: 12px; cursor: pointer;">
                                📊 IVA Discriminado
                            </button>
                            <button type="button" id="btn-swal-fmt-inc" class="swal-fmt-btn ${formatoSeleccionado === 'IVA_INCLUIDO' ? 'active' : ''}" style="flex: 1; padding: 8px; border-radius: 8px; border: 1px solid ${formatoSeleccionado === 'IVA_INCLUIDO' ? '#10b981' : '#334155'}; background: ${formatoSeleccionado === 'IVA_INCLUIDO' ? 'rgba(16,185,129,0.2)' : '#1e293b'}; color: ${formatoSeleccionado === 'IVA_INCLUIDO' ? '#34d399' : '#94a3b8'}; font-weight: 700; font-size: 12px; cursor: pointer;">
                                💰 IVA Incluido
                            </button>
                        </div>
                    </div>

                    <!-- Toggles de Lista y Faltantes -->
                    <div style="display: flex; gap: 8px; margin-bottom: 14px;">
                        <label style="flex: 1; display: flex; align-items: center; gap: 6px; background: #0f172a; border: 1px solid #334155; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 11.5px; color: #f8fafc;">
                            <input type="checkbox" id="swal-solo-lista" style="width: 15px; height: 15px; accent-color: #10b981; cursor: pointer;">
                            <span>Solo Lista (Sin Totales)</span>
                        </label>
                        <label style="flex: 1; display: flex; align-items: center; gap: 6px; background: #0f172a; border: 1px solid #334155; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 11.5px; color: #f8fafc;">
                            <input type="checkbox" id="swal-faltantes" checked style="width: 15px; height: 15px; accent-color: #f59e0b; cursor: pointer;">
                            <span>Imprimir Faltantes</span>
                        </label>
                    </div>

                    <!-- Destinatarios WhatsApp -->
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 11px; font-weight: 700; color: #34d399; text-transform: uppercase; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                            <span>📱 Destinatarios WhatsApp</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; padding: 4px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
            `;

            if (contactsWp.length === 0) {
                html += `<div style="padding: 8px; font-size: 11px; color: #64748b; text-align: center;">Sin contactos de WhatsApp registrados.</div>`;
            } else {
                contactsWp.forEach((c, idx) => {
                    let isChecked = false;
                    if (hasWpPresupuestoConfig) {
                        isChecked = (c.default_presupuesto === true);
                    } else if (hasWpGeneralConfig) {
                        isChecked = (c.default === true);
                    } else {
                        isChecked = (canalPreferido !== 'email');
                    }

                    const formattedNum = c.numero.replace(/\D/g, '');
                    let displayNum = c.numero;
                    if (formattedNum.length === 10) {
                        displayNum = `(${formattedNum.substring(0,3)}) ${formattedNum.substring(3,6)}-${formattedNum.substring(6,10)}`;
                    } else if (formattedNum.length === 13 && formattedNum.startsWith('549')) {
                        displayNum = `+54 9 (${formattedNum.substring(3,6)}) ${formattedNum.substring(6,9)}-${formattedNum.substring(9,13)}`;
                    }

                    const labelText = c.nombre 
                        ? `<strong>${c.nombre}</strong>${c.cargo ? ` <span style="font-size: 9px; background: #0284c7; color: #fff; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase;">${c.cargo}</span>` : ''}`
                        : `Contacto #${idx + 1}`;

                    html += `
                        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid #334155; border-radius: 6px; background: #1e293b; cursor: pointer; margin: 0;">
                            <input type="checkbox" class="swal-wp-chk" value="${c.numero}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; width: 15px; height: 15px; accent-color: #10b981;">
                            <div style="flex: 1; min-width: 0;">
                                 <div style="font-size: 11.5px; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                                <div style="font-size: 10.5px; color: #94a3b8;">📱 ${displayNum}</div>
                            </div>
                        </label>
                    `;
                });
            }

            html += `
                        </div>
                    </div>

                    <!-- Destinatarios Email -->
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 11px; font-weight: 700; color: #818cf8; text-transform: uppercase; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                            <span>📧 Destinatarios Correo</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto; padding: 4px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
            `;

            if (emails.length === 0) {
                html += `<div style="padding: 8px; font-size: 11px; color: #64748b; text-align: center;">Sin correos registrados.</div>`;
            } else {
                emails.forEach((e, idx) => {
                    let isChecked = false;
                    if (hasEmailPresupuestoConfig) {
                        isChecked = (e.default_presupuesto === true);
                    } else if (hasEmailGeneralConfig) {
                        isChecked = (e.default === true);
                    } else {
                        if (canalPreferido === 'email' || canalPreferido === 'ambos') {
                            isChecked = true;
                        } else if (canalPreferido === 'whatsapp') {
                            isChecked = false;
                        } else {
                            isChecked = (contactsWp.length === 0);
                        }
                    }

                    const labelText = e.nombre 
                        ? `<strong>${e.nombre}</strong>${e.cargo ? ` <span style="font-size: 9px; background: #4338ca; color: #fff; padding: 1px 4px; border-radius: 3px; font-weight: 600; text-transform: uppercase;">${e.cargo}</span>` : ''}`
                        : `Correo #${idx + 1}`;

                    html += `
                        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid #334155; border-radius: 6px; background: #1e293b; cursor: pointer; margin: 0;">
                            <input type="checkbox" class="swal-email-chk" value="${e.email}" ${isChecked ? 'checked' : ''} style="margin-top: 2px; width: 15px; height: 15px; accent-color: #818cf8;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 11.5px; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelText}</div>
                                <div style="font-size: 10.5px; color: #94a3b8;">📧 ${e.email}</div>
                            </div>
                        </label>
                    `;
                });
            }

            html += `
                        </div>
                    </div>

                    <!-- Destinatarios Manuales -->
                    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 10.5px; color: #94a3b8; margin-bottom: 3px;">Otro WhatsApp (opcional):</label>
                            <input type="tel" id="swal-custom-wp" placeholder="Ej: 2216558737" style="width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; font-size: 12px; color: #f8fafc; box-sizing: border-box;">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 10.5px; color: #94a3b8; margin-bottom: 3px;">Otro Correo (opcional):</label>
                            <input type="email" id="swal-custom-email" placeholder="Ej: info@cliente.com" style="width: 100%; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; font-size: 12px; color: #f8fafc; box-sizing: border-box;">
                        </div>
                    </div>

                    <!-- Mensaje WhatsApp Editable -->
                    <div style="margin-bottom: 12px;">
                        <label for="swal-mensaje-texto" style="display: block; font-size: 11px; font-weight: 700; color: #34d399; margin-bottom: 4px;">
                            📝 Mensaje de WhatsApp (Editable):
                        </label>
                        <textarea id="swal-mensaje-texto" style="width: 100%; height: 75px; padding: 6px 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; font-size: 11.5px; color: #f8fafc; font-family: inherit; box-sizing: border-box; resize: vertical; line-height: 1.3;">${defaultMensaje}</textarea>
                    </div>
            `;

            if (presupuesto.bunker_cliente_id) {
                html += `
                    <label style="display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; font-size: 11.5px; color: #94a3b8;">
                        <input type="checkbox" id="swal-save-default" style="width: 15px; height: 15px; accent-color: #10b981; cursor: pointer;">
                        <span>💾 Guardar selección como contactos predeterminados</span>
                    </label>
                `;
            }

            html += `</div>`;

            // Mostrar SweetAlert2
            const result = await Swal.fire({
                title: `Enviar Presupuesto #${idPresupuesto}`,
                html: html,
                background: '#1e293b',
                color: '#f8fafc',
                width: '420px',
                showConfirmButton: true,
                confirmButtonText: '📤 Enviar (WhatsApp / Email)',
                confirmButtonColor: '#10b981',
                showDenyButton: true,
                denyButtonText: '📄 Ver / Compartir PDF',
                denyButtonColor: '#334155',
                showCancelButton: true,
                cancelButtonText: 'Cerrar',
                cancelButtonColor: '#64748b',
                didOpen: () => {
                    const btnDisc = document.getElementById('btn-swal-fmt-disc');
                    const btnInc = document.getElementById('btn-swal-fmt-inc');
                    const chkSoloLista = document.getElementById('swal-solo-lista');
                    const txtMsg = document.getElementById('swal-mensaje-texto');

                    btnDisc.addEventListener('click', () => {
                        formatoSeleccionado = 'IVA_DISCRIMINADO';
                        btnDisc.style.border = '1px solid #10b981';
                        btnDisc.style.background = 'rgba(16,185,129,0.2)';
                        btnDisc.style.color = '#34d399';
                        btnInc.style.border = '1px solid #334155';
                        btnInc.style.background = '#1e293b';
                        btnInc.style.color = '#94a3b8';
                    });

                    btnInc.addEventListener('click', () => {
                        formatoSeleccionado = 'IVA_INCLUIDO';
                        btnInc.style.border = '1px solid #10b981';
                        btnInc.style.background = 'rgba(16,185,129,0.2)';
                        btnInc.style.color = '#34d399';
                        btnDisc.style.border = '1px solid #334155';
                        btnDisc.style.background = '#1e293b';
                        btnDisc.style.color = '#94a3b8';
                    });

                    chkSoloLista.addEventListener('change', () => {
                        if (chkSoloLista.checked) {
                            txtMsg.value = `Hola, te enviamos la consulta de precios de LAMDA. Saludos.`;
                        } else {
                            txtMsg.value = defaultMensaje;
                        }
                    });
                },
                preConfirm: () => {
                    const selectedWp = Array.from(document.querySelectorAll('.swal-wp-chk:checked')).map(el => el.value);
                    const selectedEmail = Array.from(document.querySelectorAll('.swal-email-chk:checked')).map(el => el.value);
                    const customWp = document.getElementById('swal-custom-wp').value.trim();
                    const customEmail = document.getElementById('swal-custom-email').value.trim();
                    const saveDefault = document.getElementById('swal-save-default')?.checked || false;
                    const soloLista = document.getElementById('swal-solo-lista').checked;
                    const faltantes = document.getElementById('swal-faltantes').checked;
                    const mensajeTexto = document.getElementById('swal-mensaje-texto').value;

                    const finalWp = [...selectedWp];
                    if (customWp) {
                        const cleaned = customWp.replace(/[^\d,]/g, '');
                        if (cleaned) cleaned.split(',').forEach(n => { if(n.trim()) finalWp.push(n.trim()); });
                    }

                    const finalEmail = [...selectedEmail];
                    if (customEmail) {
                        customEmail.split(',').forEach(e => { if(e.trim()) finalEmail.push(e.trim()); });
                    }

                    return {
                        action: 'SEND',
                        destinatariosWp: finalWp,
                        destinatariosEmail: finalEmail,
                        saveDefault,
                        selectedWpRaw: selectedWp,
                        selectedEmailRaw: selectedEmail,
                        formato: formatoSeleccionado,
                        soloLista,
                        faltantes,
                        mensajeTexto
                    };
                }
            });

            // Si presionó Ver / Compartir PDF
            if (result.isDenied) {
                const soloLista = document.getElementById('swal-solo-lista')?.checked || false;
                const faltantes = document.getElementById('swal-faltantes')?.checked || true;
                await DashboardComercial.descargarCompartirPDF(idPresupuesto, formatoSeleccionado, soloLista, faltantes);
                return;
            }

            if (!result.isConfirmed || !result.value) return;

            const { destinatariosWp, destinatariosEmail, saveDefault, selectedWpRaw, selectedEmailRaw, formato, soloLista, faltantes, mensajeTexto } = result.value;

            // Si no seleccionó destinatarios, ofrecer descarga local
            if (destinatariosWp.length === 0 && destinatariosEmail.length === 0) {
                const confirmDl = await Swal.fire({
                    title: 'Sin destinatarios',
                    text: 'No seleccionaste ningún contacto. ¿Deseas ver o compartir el PDF localmente?',
                    icon: 'info',
                    showCancelButton: true,
                    confirmButtonText: '📄 Ver PDF',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#10b981',
                    background: '#1e293b',
                    color: '#f8fafc'
                });
                if (confirmDl.isConfirmed) {
                    await DashboardComercial.descargarCompartirPDF(idPresupuesto, formato, soloLista, faltantes);
                }
                return;
            }

            // Guardar selección como default si se solicitó
            if (saveDefault && presupuesto.bunker_cliente_id) {
                try {
                    const updatedWp = contactsWp.map(c => ({
                        ...c,
                        default_presupuesto: selectedWpRaw.some(num => String(num).trim() === String(c.numero).trim() || String(num).replace(/\D/g, '') === String(c.numero).replace(/\D/g, ''))
                    }));
                    const updatedEmail = emails.map(e => ({
                        ...e,
                        default_presupuesto: selectedEmailRaw.some(em => String(em).toLowerCase().trim() === String(e.email).toLowerCase().trim())
                    }));

                    let canalPref = 'ambos';
                    const hasWp = updatedWp.some(c => c.default_presupuesto === true);
                    const hasEm = updatedEmail.some(e => e.default_presupuesto === true);
                    if (hasWp && !hasEm) canalPref = 'whatsapp';
                    else if (!hasWp && hasEm) canalPref = 'email';
                    else if (!hasWp && !hasEm) canalPref = 'whatsapp';

                    fetch(`/api/logistica/bunker/clientes/${presupuesto.bunker_cliente_id}/whatsapp-contacts`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            whatsapp_facturas: JSON.stringify(updatedWp),
                            email_facturas: JSON.stringify(updatedEmail),
                            canal_envio_preferido: canalPref
                        })
                    }).catch(console.error);
                } catch(e) {}
            }

            // Despachar por backend
            Swal.fire({
                title: 'Generando y despachando...',
                text: 'El servidor está generando el PDF y enviándolo...',
                allowOutsideClick: false,
                background: '#1e293b',
                color: '#f8fafc',
                didOpen: () => Swal.showLoading()
            });

            let wpOk = false;
            let emailOk = false;
            let errores = [];

            // A. WhatsApp con PDF adjunto y mensaje personalizado
            if (destinatariosWp.length > 0) {
                try {
                    const resWp = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}/whatsapp`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${state.sesion.token}`
                        },
                        body: JSON.stringify({
                            destinatarios: destinatariosWp.join(', '),
                            formato: formato,
                            sololista: soloLista,
                            faltantes: faltantes,
                            nombreCliente: clienteNombre,
                            estado: presupuesto.estado,
                            mensajeTexto: mensajeTexto
                        })
                    });
                    const dataWp = await resWp.json();
                    if (resWp.ok && dataWp.success) {
                        wpOk = true;
                    } else {
                        errores.push(`WhatsApp: ${dataWp.message || dataWp.error || 'Error en servidor'}`);
                    }
                } catch(e) {
                    errores.push(`WhatsApp: ${e.message}`);
                }
            }

            // B. Email con PDF adjunto
            if (destinatariosEmail.length > 0) {
                try {
                    const resEmail = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}/email`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${state.sesion.token}`
                        },
                        body: JSON.stringify({
                            destinatarios: destinatariosEmail.join(', '),
                            formato: formato,
                            sololista: soloLista,
                            faltantes: faltantes
                        })
                    });
                    const dataEmail = await resEmail.json();
                    if (resEmail.ok && dataEmail.success) {
                        emailOk = true;
                    } else {
                        errores.push(`Correo: ${dataEmail.message || dataEmail.error || 'Error en servidor'}`);
                    }
                } catch(e) {
                    errores.push(`Correo: ${e.message}`);
                }
            }

            // Resultado final
            const totalIntentos = (destinatariosWp.length > 0 ? 1 : 0) + (destinatariosEmail.length > 0 ? 1 : 0);
            const totalExitos = (wpOk ? 1 : 0) + (emailOk ? 1 : 0);

            if (totalExitos === totalIntentos) {
                let detalle = '';
                if (wpOk && emailOk) detalle = `Enviado con PDF adjunto por WhatsApp y Correo.`;
                else if (wpOk) detalle = `Enviado con PDF adjunto a ${destinatariosWp.join(', ')}.`;
                else detalle = `Enviado con PDF adjunto a ${destinatariosEmail.join(', ')}.`;

                Swal.fire({
                    title: '¡Presupuesto Enviado!',
                    text: detalle,
                    icon: 'success',
                    confirmButtonText: 'Aceptar',
                    confirmButtonColor: '#10b981',
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            } else if (totalExitos > 0) {
                Swal.fire({
                    title: 'Envío Parcial',
                    html: `Se completaron algunos envíos:<br><small style="color:#f87171;">${errores.join('<br>')}</small>`,
                    icon: 'warning',
                    confirmButtonText: 'Entendido',
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            } else {
                Swal.fire({
                    title: 'Fallo al Enviar',
                    html: `No se pudo despachar el documento:<br><small style="color:#f87171;">${errores.join('<br>')}</small>`,
                    icon: 'error',
                    confirmButtonText: 'Cerrar',
                    background: '#1e293b',
                    color: '#f8fafc'
                });
            }

        } catch (error) {
            console.error('❌ [OMNICANAL-MOVIL ERROR]:', error);
            Swal.fire({
                title: 'Error',
                text: error.message || 'Error al procesar el presupuesto',
                icon: 'error',
                background: '#1e293b',
                color: '#f8fafc'
            });
        }
    },

    /**
     * Descargar o Compartir PDF mediante Web Share API
     */
    async descargarCompartirPDF(idPresupuesto, formato = 'IVA_DISCRIMINADO', soloLista = false, faltantes = true) {
        Swal.fire({
            title: 'Generando PDF...',
            text: 'Renderizando documento de alta resolución...',
            allowOutsideClick: false,
            background: '#1e293b',
            color: '#f8fafc',
            didOpen: () => Swal.showLoading()
        });

        try {
            const queryParams = new URLSearchParams({ formato: formato });
            if (soloLista) queryParams.append('sololista', 'true');
            if (!faltantes) queryParams.append('faltantes', 'false');

            const response = await fetch(`${API_BASE_URL}/api/presupuestos/${idPresupuesto}/pdf?${queryParams.toString()}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${state.sesion.token}` }
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({}));
                throw new Error(errJson.error || "Fallo del generador PDF.");
            }

            const blob = await response.blob();
            const filename = `Cotizacion_${idPresupuesto}.pdf`;
            const file = new File([blob], filename, { type: 'application/pdf' });

            Swal.close();

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Presupuesto #${idPresupuesto}`,
                    text: `Te comparto la cotización #${idPresupuesto} de LAMDA.`,
                    files: [file]
                });
            } else {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(objectUrl);
            }
        } catch (err) {
            console.error('❌ [PDF-DL ERROR]:', err);
            Swal.fire({
                title: 'Error de PDF',
                text: err.message || 'No se pudo generar el archivo PDF.',
                icon: 'error',
                background: '#1e293b',
                color: '#f8fafc'
            });
        }
    },

    abrirPreImpresion(id) {
        this.abrirModalEnvioOmnicanal(id, true);
    },

    compartirWhatsAppChat(id) {
        this.abrirModalEnvioOmnicanal(id, false);
    }
};

window.DashboardComercial = DashboardComercial;

