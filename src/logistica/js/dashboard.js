/* global google, QRCode, MapaInteractivo, cargarConfiguracion, cargarGoogleMaps, cargarChoferes */

/**
 * Dashboard de Logística
 * Gestión de rutas y asignación de pedidos
 */

// Estado global
let state = {
    pedidos: [],
    rutas: [],
    choferes: [],
    rutaSeleccionada: null,
    map: null,
    markers: [],
    filtroTipoPool: 'TODOS'
};

/**
 * Inicializar dashboard
 */
async function inicializarDashboard() {
    console.log('[DASHBOARD] Inicializando...');

    try {
        // Cargar configuración
        await cargarConfiguracion();

        // Cargar datos iniciales
        await Promise.all([
            cargarPedidos(),
            cargarRutas(),
            cargarChoferes()
        ]);

        // Inicializar Google Maps
        await inicializarMapa();

        // Configurar event listeners
        configurarEventListeners();

        console.log('[DASHBOARD] Inicialización completada');

    } catch (error) {
        console.error('[DASHBOARD] Error al inicializar:', error);
        mostrarError('Error al inicializar el dashboard: ' + error.message);
    }
}

/**
 * Cargar pedidos pendientes
 */
async function cargarPedidos() {
    try {
        const response = await fetch('/api/logistica/rutas/presupuestos-disponibles');
        const result = await response.json();

        if (result.success) {
            const vistos = new Set();
            state.pedidos = (result.data || []).filter(p => {
                const key = String(p.id);
                if (vistos.has(key)) return false;
                vistos.add(key);
                return true;
            });
            renderizarPedidos();
            console.log('[DASHBOARD] Pedidos cargados:', state.pedidos.length);
        } else {
            throw new Error(result.error || 'Error al cargar pedidos');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al cargar pedidos:', error);
        mostrarError('Error al cargar pedidos');
    }
}

/**
 * Descartar Orden de Tratamiento
 */
window.descartarRetiro = async (idOrden) => {
    const idReal = String(idOrden).replace('RT-', '');
    if (!confirm(`⚠️ ¿Está seguro que desea DESCARTAR la Orden de Tratamiento #${idReal}? Esta acción no se puede deshacer y eliminará permanentemente la recepción de mantenimiento.`)) return;
    
    try {
        const response = await fetch(`/api/logistica/movil/retiros/${idReal}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            mostrarExito('Orden de Tratamiento descartada exitosamente.');
            await cargarPedidos(); // Recargar la columna de asignación
        } else {
            throw new Error(data.error || 'Error al descartar la orden');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error descartarRetiro:', error);
        mostrarError('Error descartando la orden: ' + error.message);
    }
}

/**
 * Revertir Envío de Orden de Tratamiento a Mantenimiento
 */
window.revertirEnvioTratamiento = async (idOrden) => {
    const idReal = String(idOrden).replace('RT-', '');
    
    // Alerta de confirmación de reversión de envío
    const result = await Swal.fire({
        title: '¿Revertir Envío?',
        text: `El pedido RT-${idReal} se retirará de Logística y regresará al Almacén de Mantenimiento en su estado original.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, revertir',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        const response = await fetch(`/api/logistica/tratamientos/${idReal}/revertir-envio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            await Swal.fire({
                title: 'Revertido con Éxito',
                text: data.message,
                icon: 'success',
                confirmButtonColor: '#3b82f6'
            });
            await cargarPedidos();
        } else {
            throw new Error(data.error || 'Error al procesar la reversión.');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error revertirEnvioTratamiento:', error);
        Swal.fire({
            title: 'Error',
            text: error.message,
            icon: 'error',
            confirmButtonColor: '#ef4444'
        });
    }
}

/**
 * FEATURE FASE 3: Generar QR (Asistente en PC)
 */
window.abrirAsistenteInmunizacionOficina = () => {
    let htmlContent = `
        <div style="text-align: left;">
            <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 1rem;">Busque al cliente para crear el registro de tratamiento/retiro y asignar a la cola.</p>
            <input id="swal-cliente-search" class="swal2-input" placeholder="Nombre del Cliente, ID..." style="width: 100%; box-sizing: border-box; margin: 0 auto 10px auto;" autocomplete="off">
            <div id="swal-cliente-results" style="max-height: 150px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: left; position: relative;"></div>
        </div>
    `;

    Swal.fire({
        title: '🦠 Generar QR Tratamiento',
        html: htmlContent,
        showCancelButton: true,
        showConfirmButton: false,
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const inputElement = document.getElementById('swal-cliente-search');
            let timeoutToken;
            inputElement.addEventListener('input', (e) => {
                clearTimeout(timeoutToken);
                const query = e.target.value.trim();
                if (query.length < 3) {
                    document.getElementById('swal-cliente-results').innerHTML = '';
                    return;
                }
                timeoutToken = setTimeout(async () => {
                    const resultsBox = document.getElementById('swal-cliente-results');
                    resultsBox.innerHTML = '<div style="padding: 10px; color:#64748b;">Buscando...</div>';
                    try {
                        const res = await fetch(`/api/logistica/tratamientos/clientes?q=${encodeURIComponent(query)}`);
                        const data = await res.json();
                        if (data.success && data.data.length > 0) {
                            resultsBox.innerHTML = data.data.map(c => `
                                <div onclick="window.generarQROficinaPayload(${c.id}, '${c.nombre.replace(/'/g, "\\'")}')" style="padding: 10px; border-bottom: 1px solid #e2e8f0; cursor: pointer; color:#1e293b; font-weight: bold;">
                                    ${c.nombre} ${c.apellido || ''} <span style="font-size: 0.75rem; color:#64748b; font-weight: normal;">[#${c.id}]</span>
                                </div>
                            `).join('');
                        } else {
                            resultsBox.innerHTML = '<div style="padding: 10px; color:#64748b;">Sin resultados</div>';
                        }
                    } catch(err) {
                        resultsBox.innerHTML = '<div style="padding: 10px; color:#ef4444;">Error de red</div>';
                    }
                }, 400);
            });
        }
    });
};

window.generarQROficinaPayload = async (idCliente, nombreCliente) => {
    Swal.close();
    Swal.fire({ title: 'Generando registro...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    try {
        const response = await fetch('/api/logistica/tratamientos/generar-qr-chofer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_cliente: idCliente, id_ruta: null })
        });
        const data = await response.json();
        
        if (data.success) {
            Swal.fire({
                title: 'Exito',
                text: 'Orden de Tratamiento Creada',
                icon: 'success'
            }).then(() => {
                if (window.cargarPedidos) window.cargarPedidos();
            });
        } else {
            Swal.fire('Error', data.error || 'Ocurrió un error', 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'No se pudo generar el registro', 'error');
    }
};

/**
 * Cargar rutas del día
 */
async function cargarRutas() {
    try {
        let url = '/api/logistica/rutas';
        const searchInput = document.getElementById('search-rutas');
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        const fechaFilter = document.getElementById('filter-fecha')?.value || 'todas';
        
        let queryParams = [];
        if (searchTerm) {
            queryParams.push(`busqueda=${encodeURIComponent(searchTerm)}`);
        }
        
        // La implementación anterior de 'filtrarRutas' en el front no funcionaba.
        // Ahora enviamos los parámetros para que el backend u otra lógica los maneje si lo desean.
        // Mantenemos la lógica de fecha básica para no romper el TODO original:
        const hoy = new Date();
        hoy.setHours(0,0,0,0);
        if (fechaFilter === 'hoy') {
            queryParams.push(`fecha_desde=${hoy.toISOString()}`);
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);
            queryParams.push(`fecha_hasta=${manana.toISOString()}`);
        } else if (fechaFilter === 'manana') {
            const manana = new Date(hoy);
            manana.setDate(manana.getDate() + 1);
            queryParams.push(`fecha_desde=${manana.toISOString()}`);
            const pasado = new Date(manana);
            pasado.setDate(pasado.getDate() + 1);
            queryParams.push(`fecha_hasta=${pasado.toISOString()}`);
        } else if (fechaFilter === 'semana') {
            queryParams.push(`fecha_desde=${hoy.toISOString()}`);
            const proxSemana = new Date(hoy);
            proxSemana.setDate(proxSemana.getDate() + 7);
            queryParams.push(`fecha_hasta=${proxSemana.toISOString()}`);
        }

        if (queryParams.length > 0) {
            url += '?' + queryParams.join('&');
        }

        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
            state.rutas = result.data;
            await renderizarRutas();
            console.log('[DASHBOARD] Rutas cargadas:', state.rutas.length);
        } else {
            throw new Error(result.error || 'Error al cargar rutas');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al cargar rutas:', error);
        mostrarError('Error al cargar rutas');
    }
}

async function buscarRutasBackend() {
    const btn = event?.currentTarget;
    if (btn && btn.tagName === 'BUTTON') {
        btn.innerHTML = '⏳';
        btn.disabled = true;
    }

    try {
        await cargarRutas();
    } finally {
        if (btn && btn.tagName === 'BUTTON') {
            btn.innerHTML = '🔍';
            btn.disabled = false;
        }
    }
}

/**
 * Quitar pedido de una ruta
 */
async function quitarPedidoDeRuta(rutaId, presupuestoId) {
    if (!confirm('¿Quitar este pedido de la ruta?')) {
        return;
    }

    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/presupuestos/${presupuestoId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito('Pedido quitado de la ruta');
            await Promise.all([cargarPedidos(), cargarRutas()]);

            // Si la ruta estaba seleccionada, actualizar detalles
            if (state.rutaSeleccionada === rutaId) {
                verDetallesRuta(rutaId);
            }
        } else {
            throw new Error(result.error || 'Error al quitar pedido');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al quitar pedido:', error);
        mostrarError('Error al quitar pedido: ' + error.message);
    }
}

/**
 * Cargar lista de choferes
 */
async function cargarChoferes() {
    try {
        const response = await fetch('/api/logistica/usuarios/choferes');
        const result = await response.json();

        if (result.success) {
            state.choferes = result.data;
            renderizarSelectChoferes();
            console.log('[DASHBOARD] Choferes cargados:', state.choferes.length);
        } else {
            throw new Error(result.error || 'Error al cargar choferes');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al cargar choferes:', error);
        // Fallback a datos mock si falla
        state.choferes = [];
        renderizarSelectChoferes();
    }
}

/**
 * Renderizar lista de pedidos
 */
/**
 * Obtener HTML de un pedido individual
 */
function obtenerPedidoHtml(pedido) {
    const tieneDomicilio = pedido.id_domicilio_entrega && pedido.domicilio_direccion;
    const pedidoJson = JSON.stringify(pedido).replace(/'/g, "\\'");
    const esSobre = String(pedido.id).startsWith('SOB-') || pedido.es_sobre_efectivo === true;
    const esContacto = String(pedido.id).startsWith('PR-') || pedido.es_visita_preventa === true || pedido.estado === 'Visita Comercial';
    const esTratamiento = pedido.estado === 'Orden de Tratamiento';
    const esOrdenRetiro = pedido.estado === 'Orden de Retiro';
    const esDevolucion = esTratamiento && pedido.estado_tratamiento === 'COMPLETADO';
    const esRetiro = !esSobre && !esContacto && ((esTratamiento && !esDevolucion) || esOrdenRetiro);

    // Fallbacks para edge cases
    const clienteId = pedido.cliente_id || pedido.id_cliente || 'S/N';
    const clienteNombre = pedido.cliente_nombre || 'Cliente Desconocido';
    const idCliNorm = String(clienteId).trim().replace(/^0+/, '');

    // Tarjeta especial para Contactos Comerciales / Preventa en Calle (Entidad separada, SIN facturación ni bultos)
    if (esContacto) {
        const codigoProsp = pedido.codigo_prospecto || pedido.id_presupuesto_ext || pedido.id;
        const idNumProsp = pedido.prospecto_id_numerico || String(pedido.id).replace('PR-', '');
        const rubroProsp = pedido.rubro || 'Comercio';
        const encargadoTxt = pedido.contacto_nombre
            ? `${pedido.contacto_nombre}${pedido.contacto_rol ? ` (${pedido.contacto_rol})` : ''}`
            : '';

        return `
            <div class="pedido-card tipo-contacto" 
                 draggable="true" 
                 data-id="${pedido.id}"
                 data-tipo="contacto"
                 data-pedido='${pedidoJson}'
                 ondragstart="handleDragStart(event)" 
                 ondragend="handleDragEnd(event)"
                 style="border-left: 5px solid #0d9488; background-color: #f0fdfa;">
                
                <div class="pedido-domicilio-indicator" style="background-color: #0d9488;" title="Contacto Comercial / Visita de Presentación"></div>
                
                <div class="pedido-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span class="pedido-cliente-id" style="font-size: 1.02rem; font-weight: 800; color: #0f766e;">
                            ${pedido.origen_contacto === 'CLIENTE_ACTIVO' ? '⭐ VISITA CLIENTE' : '🎯 CONTACTO'} • ${codigoProsp}
                        </span>
                    </div>
                    <div style="display:flex; gap:0.25rem; align-items:center;">
                        <span class="pedido-badge" style="background-color:#0d9488; color:white; font-weight:bold;">
                            ${pedido.origen_contacto === 'CLIENTE_ACTIVO' ? '⭐ VISITA SIN PEDIDO' : '🤝 VISITA COMERCIAL'}
                        </span>
                    </div>
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;">
                    <div style="background: #ccfbf1; color: #115e59; border: 1px solid #99f6e4; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; display: inline-block; font-weight: bold;">
                        🏷️ ${rubroProsp}
                    </div>
                    ${encargadoTxt ? `<div style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 2px 7px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">👤 ${encargadoTxt}</div>` : ''}
                </div>

                <div class="pedido-cliente-nombre" style="font-weight: 800; margin-top: 0.25rem; color: #0f172a; font-size: 0.95rem;">
                    ${clienteNombre}
                </div>
                <div class="pedido-direccion" style="margin-top: 0.2rem; color: #334155;">
                    📍 ${pedido.domicilio_direccion || 'Sin dirección asignada'}${pedido.domicilio_localidad ? ` • <b>${pedido.domicilio_localidad}</b>` : ''}
                </div>
                ${pedido.nota ? `<div style="margin-top: 0.25rem; font-size: 0.74rem; color: #475569; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${(pedido.nota || '').replace(/"/g, '&quot;')}">💡 ${pedido.nota}</div>` : ''}

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                    <div style="font-weight: 700; color: #0f766e; font-size: 0.78rem;">
                        ${pedido.cliente_telefono ? `📱 ${pedido.cliente_telefono}` : '🚶 Visita en local'}
                    </div>
                    <div style="display:flex; gap:0.25rem;">
                        <button type="button" onclick="event.stopPropagation(); window.quitarContactoDePoolLogistica('${idNumProsp}', '${(clienteNombre || '').replace(/'/g, "\\'")}')" class="btn-sm" style="padding: 2px 8px; font-size: 0.73rem; background-color: #ffffff; color: #dc2626; border: 1px solid #fca5a5; border-radius: 4px; cursor: pointer; font-weight: 700;" title="Retirar este contacto del Pool de Logística">
                            ↩️ Quitar de Logística
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Tarjeta especial para Ensobrados Activos (estado PREPARADO)
    if (esSobre) {
        const codigoSobre = pedido.codigo_sobre || pedido.id_presupuesto_ext || pedido.id;
        const montoSobre = parseFloat(pedido.monto_declarado || pedido.total || 0);
        const tieneFotos = Boolean(pedido.foto_frente_url || pedido.foto_dorso_url);
        const clienteTienePedidoEnPool = state.pedidos.some(p => {
            const pEsSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true;
            const pCliNorm = String(p.cliente_id || p.id_cliente || '').trim().replace(/^0+/, '');
            return !pEsSobre && pCliNorm && pCliNorm === idCliNorm;
        });

        return `
            <div class="pedido-card tipo-sobre" 
                 draggable="true" 
                 data-id="${pedido.id}"
                 data-tipo="sobre"
                 data-pedido='${pedidoJson}'
                 ondragstart="handleDragStart(event)" 
                 ondragend="handleDragEnd(event)"
                 oncontextmenu="mostrarMenuContextual(event, '${pedido.id}')"
                 style="border-left: 5px solid #7c3aed; background-color: #f5f3ff;">
                
                <div class="pedido-domicilio-indicator" style="background-color: #7c3aed;" title="Retiro de Sobre de Efectivo"></div>
                
                <div class="pedido-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span class="pedido-cliente-id" style="font-size: 1.05rem; font-weight: 700; color: #6d28d9;">
                            💵 SOBRE • Cli #${clienteId}
                        </span>
                    </div>
                    <div style="display:flex; gap:0.25rem; align-items:center;">
                        <span class="pedido-badge" style="background-color:#7c3aed; color:white; font-weight:bold;">
                            ✅ PREPARADO
                        </span>
                    </div>
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;">
                    <div class="badge-retiro-visual" style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; display: inline-block; font-weight: bold;">
                        💵 Retiro Efectivo #${codigoSobre}
                    </div>
                    ${clienteTienePedidoEnPool ? `<div style="background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">📦 Tiene pedido en pool</div>` : ''}
                </div>

                <div class="pedido-cliente-nombre" style="font-weight: 700; margin-top: 0.25rem; color: #1e293b;">
                    ${clienteNombre}
                </div>
                <div class="pedido-direccion" style="margin-top: 0.2rem;">
                    📍 ${pedido.domicilio_direccion || 'Sin dirección asignada'}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                    <div class="pedido-monto" style="font-weight: 800; color: #059669; font-size: 0.92rem;">
                        💵 $${montoSobre.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style="display:flex; gap:0.25rem;">
                        ${tieneFotos ? `<button onclick="event.stopPropagation(); window.verFotosSobreLogistica('${codigoSobre}', '${pedido.foto_frente_url || ''}', '${pedido.foto_dorso_url || ''}')" class="btn-sm" style="padding: 2px 8px; font-size: 0.74rem; background-color: #6d28d9; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600;" title="Ver fotos del sobre cerrado">📷 Fotos</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // Detectar si este mismo cliente tiene un sobre PREPARADO en el pool para avisar visualmente
    const clienteTieneSobreEnPool = state.pedidos.some(p => {
        const pEsSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true;
        const pCliNorm = String(p.cliente_id || p.id_cliente || '').trim().replace(/^0+/, '');
        return pEsSobre && pCliNorm && pCliNorm === idCliNorm;
    });

    // Estilos específicos para Tratamientos/Retiros/Devoluciones
    let estiloCard = '';
    if (esRetiro) estiloCard = 'border-left: 5px solid #d35400; background-color: #fdf2e9;';
    if (esDevolucion) estiloCard = 'border-left: 5px solid #2563eb; background-color: #eff6ff;';

    const iconoCliente = esRetiro ? '🔙' : (esDevolucion ? '🚚' : '👤');

    // Lógica de checkbox y badges de facturación para presupuestos ordinarios
    const esPresupuesto = !pedido.id.toString().startsWith('RT-') && !esSobre && !esContacto;
    let checkboxHTML = '';
    let badgeFacturacionHTML = '';

    if (esPresupuesto) {
        if (pedido.factura_id) {
            const esFacturado = (pedido.factura_estado === 'APROBADA' || pedido.factura_estado === 'APROBADA_LOCAL');
            const isLocal = pedido.factura_estado === 'APROBADA_LOCAL';
            const badgeColor = esFacturado ? (isLocal ? '#d4edda' : '#d1ecf1') : '#f59e0b';
            const textColor = esFacturado ? (isLocal ? '#155724' : '#0c5460') : 'white';
            const borderColor = esFacturado ? (isLocal ? '#c3e6cb' : '#bee5eb') : 'transparent';
            const badgeText = esFacturado ? (isLocal ? '✅ FACTURADO LOCAL' : '✅ FACTURADO ARCA') : '📄 ENVIADO A FACTURACIÓN';
            
            checkboxHTML = `<input type="checkbox" disabled style="margin-right: 0.5rem; width: 16px; height: 16px; min-width: 16px; cursor: not-allowed;">`;
            badgeFacturacionHTML = `<span onclick="event.stopPropagation(); window.verFacturaDetalle(${pedido.factura_id})" class="pedido-badge" style="background-color: ${badgeColor}; color: ${textColor}; border: 1px solid ${borderColor}; cursor: pointer; font-weight: bold; border-radius: 4px;" title="Haga clic para ver el detalle de la factura">${badgeText}</span>`;
        } else {
            checkboxHTML = `<input type="checkbox" class="pedido-selector" data-id="${pedido.id}" onchange="actualizarSeleccionPedidos()" onclick="event.stopPropagation()" style="margin-right: 0.5rem; width: 16px; height: 16px; min-width: 16px; cursor: pointer;">`;
        }
    }

    return `
        <div class="pedido-card ${esRetiro ? 'tipo-retiro' : ''}" 
             draggable="true" 
             data-id="${pedido.id}"
             data-tipo="${esRetiro ? 'retiro' : 'venta'}"
             data-pedido='${pedidoJson}'
             ondragstart="handleDragStart(event)" 
             ondragend="handleDragEnd(event)"
             oncontextmenu="mostrarMenuContextual(event, '${pedido.id}')"
             onclick="toggleSeleccionPedido(event, '${pedido.id}')"
             style="${estiloCard}">
            
            <!-- Indicador visual de domicilio -->
            ${!esRetiro ? `
            <div class="pedido-domicilio-indicator ${tieneDomicilio ? 'tiene-domicilio' : ''}" 
                 title="${tieneDomicilio ? 'Tiene domicilio asignado' : 'Sin domicilio asignado'}">
            </div>
            ` : `
            <div class="pedido-domicilio-indicator" style="background-color: #f59e0b;" title="Operación de Retiro">
            </div>
            `}
            
            <!-- NUEVA JERARQUÍA: Cliente primero -->
            <div class="pedido-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                <div style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${checkboxHTML}
                    <span class="pedido-cliente-id" style="font-size: 1.1rem; font-weight: 600; color: ${esRetiro ? '#d35400' : (esDevolucion ? '#2563eb' : '#1e40af')};">
                        ${iconoCliente} ${esRetiro ? 'RETIRO' : (esDevolucion ? 'ENTREGA MANT.' : 'Cliente')} #${clienteId}
                    </span>
                </div>
                <div style="display:flex; flex-direction: column; gap:0.25rem; align-items:flex-end;">
                    ${badgeFacturacionHTML}
                    <div style="display:flex; gap:0.25rem; align-items:center;">
                        ${!esTratamiento && !esOrdenRetiro ? (pedido.comprobante_lomasoft ? `<span title="Lomasoft: ${pedido.comprobante_lomasoft}" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Lomasoft</span>` : `<span title="Pendiente de Facturación" class="pedido-badge" style="background-color:#475569; color:white;">⏳ Pte. Facturación</span>`) : ''}
                        ${esTratamiento ? (pedido.tiene_checkin ? `<span title="Check-in Completado" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Check-in Listo</span>` : `<span title="Check-in Pendiente" class="pedido-badge" style="background-color:#f59e0b; color:white;">⏳ Check-in Pte.</span>`) : ''}
                        <span class="pedido-badge badge-${pedido.estado_logistico?.toLowerCase() || 'pendiente'}">
                            ${pedido.estado_logistico || 'PENDIENTE'}
                        </span>
                    </div>
                </div>
            </div>

            ${esRetiro ? `<div class="badge-retiro-visual" style="background: #e67e22; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; display: inline-block; margin-bottom: 4px; font-weight: bold;">🔙 ${esOrdenRetiro ? 'ORDEN DE RETIRO' : 'Orden de Tratamiento'}</div>` : ''}
            ${esDevolucion ? `<div class="badge-retiro-visual" style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; display: inline-block; margin-bottom: 4px; font-weight: bold;">🚚 Entrega Mantenimiento</div>` : ''}
            ${clienteTieneSobreEnPool ? `<div style="background: #f5f3ff; color: #6d28d9; border: 1px solid #c4b5fd; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; display: inline-block; margin-bottom: 4px; font-weight: 700;">💵 Tiene sobre listo para retirar</div>` : ''}

            <div class="pedido-cliente-nombre" style="font-weight: 600; margin-top: 0.25rem; color: #1e293b;">
                 ${clienteNombre}
            </div>
            <div class="pedido-numero-secundario" style="font-size: 0.875rem; color: #64748b; margin-top: 0.25rem;">
                Pedido #${pedido.id} ${esRetiro ? '(Retiro)' : (esDevolucion ? '(Entrega Mant.)' : '')}
            </div>
            <div class="pedido-direccion">
                📍 ${pedido.domicilio_direccion || 'Sin dirección asignada'}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                ${pedido.total ? `<div class="pedido-monto" style="font-weight:bold; color:#059669;">💰 $${parseFloat(pedido.total).toFixed(2)}</div>` : '<div></div>'}
                <div style="display:flex; gap:0.25rem;">
                    ${!pedido.comprobante_lomasoft && !esTratamiento && !esOrdenRetiro ? `<button onclick="event.stopPropagation(); window.buscarCandidatasLomasoft('${pedido.id}')" class="btn-sm btn-primary" style="padding: 2px 6px; font-size: 0.75rem; background-color: #8b5cf6; color:white; border:none; border-radius:3px; cursor:pointer;" title="Vincular con sistema externo">Conciliar / Facturar</button>` : ''}
                    ${esTratamiento && !esDevolucion ? `<button onclick="event.stopPropagation(); window.abrirModalContingencia('${pedido.hash}', ${pedido.tiene_checkin})" class="btn-sm btn-primary" style="padding: 2px 6px; font-size: 0.75rem; background-color: #f59e0b; color:white; border:none; border-radius:3px; cursor:pointer; margin-right: 2px;" title="Consultar o Completar Datos del Tratamiento">✏️ ${pedido.tiene_checkin ? 'Modificar' : 'Check-in'}</button>` : ''}
                    ${esTratamiento && pedido.tiene_checkin && !esDevolucion ? `<button onclick="event.stopPropagation(); window.open(\`/api/logistica/tratamientos/print/${pedido.hash}\`, '_blank')" class="btn-sm" style="padding: 2px 6px; font-size: 0.75rem; background-color: #2563eb; color:white; border:none; border-radius:3px; cursor:pointer; margin-right: 2px;" title="Ver Reporte PDF">🖨️ PDF</button>` : ''}
                    ${esTratamiento && !esDevolucion ? `<button onclick="event.stopPropagation(); window.descartarRetiro('${pedido.id}')" class="btn-sm btn-danger" style="padding: 2px 6px; font-size: 0.75rem; background-color: #ef4444; color:white; border:none; border-radius:3px; cursor:pointer;" title="Descartar Orden de Tratamiento Atómicamente">🗑️ Descartar</button>` : ''}
                    ${esDevolucion ? `<button onclick="event.stopPropagation(); window.revertirEnvioTratamiento('${pedido.id}')" class="btn-sm btn-warning" style="padding: 2px 6px; font-size: 0.75rem; background-color: #ea580c; color:white; border:none; border-radius:3px; cursor:pointer; margin-right: 2px;" title="Retrotraer Envío al Almacén de Mantenimiento">↩️ Devolver a Mantenimiento</button>` : ''}
                    <button onclick="event.stopPropagation(); window.imprimirEtiquetaLamda()" class="btn-sm btn-secondary" style="padding: 2px 6px; font-size: 0.75rem; background-color: #3b82f6; color:white; border:none; border-radius:3px; cursor:pointer;" title="Imprimir Etiqueta LAMDA">🖨️ LAMDA</button>
                </div>
            </div>
            ${pedido.bloqueo_entrega ? '<div class="pedido-badge badge-bloqueado" style="margin-top:0.25rem;">🔒 Bloqueado</div>' : ''}
            ${pedido.motivo_no_entrega ? `<div class="pedido-badge badge-incidencia" style="margin-top:0.25rem; background-color:#ffedd5; color:#ea580c; border: 1px solid #fed7aa; font-weight:bold; border-radius:4px; padding:2px 6px; font-size:0.75rem; display:inline-block;">⚠️ Regreso: ${pedido.motivo_no_entrega}</div>` : ''}
        </div>
    `;
}

/**
 * Actualizar contadores de la barra de segmentación del Pool
 */
function actualizarContadoresPool() {
    const lista = state.pedidos || [];
    let cantPedidos = 0;
    let cantSobres = 0;
    let cantRetiros = 0;
    let cantContactos = 0;

    lista.forEach(p => {
        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true;
        const esContacto = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
        const esRetiro = !esSobre && !esContacto && (p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
        if (esSobre) cantSobres++;
        else if (esContacto) cantContactos++;
        else if (esRetiro) cantRetiros++;
        else cantPedidos++;
    });

    const elTodos = document.getElementById('count-pool-todos');
    const elPedidos = document.getElementById('count-pool-pedidos');
    const elSobres = document.getElementById('count-pool-sobres');
    const elRetiros = document.getElementById('count-pool-retiros');
    const elContactos = document.getElementById('count-pool-contactos');

    if (elTodos) elTodos.textContent = `(${lista.length})`;
    if (elPedidos) elPedidos.textContent = `(${cantPedidos})`;
    if (elSobres) elSobres.textContent = `(${cantSobres})`;
    if (elRetiros) elRetiros.textContent = `(${cantRetiros})`;
    if (elContactos) elContactos.textContent = `(${cantContactos})`;
}

/**
 * Cambiar el filtro rápido por tipo en el Pool de Pendientes
 */
function cambiarFiltroTipoPool(tipo) {
    state.filtroTipoPool = tipo || 'TODOS';
    document.querySelectorAll('#pool-tipo-tabs .pool-tab-btn').forEach(btn => {
        const btnTipo = btn.getAttribute('data-tipo');
        const activo = btnTipo === state.filtroTipoPool;
        btn.classList.toggle('active', activo);
        if (activo) {
            const activeBg = btnTipo === 'SOBRES'
                ? '#7c3aed'
                : (btnTipo === 'RETIROS' ? '#ea580c' : (btnTipo === 'CONTACTOS' ? '#0d9488' : '#2563eb'));
            btn.style.background = activeBg;
            btn.style.borderColor = activeBg;
            btn.style.color = 'white';
            btn.style.fontWeight = '700';
        } else {
            btn.style.background = 'white';
            btn.style.borderColor = '#cbd5e1';
            btn.style.color = btnTipo === 'SOBRES'
                ? '#6d28d9'
                : (btnTipo === 'RETIROS' ? '#c2410c' : (btnTipo === 'CONTACTOS' ? '#0f766e' : '#334155'));
            btn.style.fontWeight = '600';
        }
    });
    filtrarPedidos();
}
window.cambiarFiltroTipoPool = cambiarFiltroTipoPool;

/**
 * Quitar un contacto comercial del Pool de Logística manualmente
 */
window.quitarContactoDePoolLogistica = async function(idProspecto, nombreComercio) {
    try {
        const res = await fetch(`/api/logistica/prospectos/${idProspecto}/pool-logistica`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ en_pool_logistica: false })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'No se pudo quitar del pool');
        await cargarPedidos();
    } catch (e) {
        console.error('[DASHBOARD] Error al quitar contacto del pool:', e);
        mostrarError('Error al quitar contacto de logística: ' + e.message);
    }
};

/**
 * Visor rápido de fotos del sobre desde Logística
 */
window.verFotosSobreLogistica = function(codigoSobre, fotoFrente, fotoDorso) {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
        title: `💵 Sobre #${codigoSobre}`,
        html: `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 8px;">
                ${fotoFrente ? `<div><div style="font-size:0.78rem; font-weight:700; color:#475569; margin-bottom:4px;">Frente del Sobre</div><img src="${fotoFrente}" style="width:100%; border-radius:8px; border:1px solid #cbd5e1; max-height:260px; object-fit:contain;"></div>` : ''}
                ${fotoDorso ? `<div><div style="font-size:0.78rem; font-weight:700; color:#475569; margin-bottom:4px;">Dorso / Cierre</div><img src="${fotoDorso}" style="width:100%; border-radius:8px; border:1px solid #cbd5e1; max-height:260px; object-fit:contain;"></div>` : ''}
            </div>
        `,
        width: 560,
        confirmButtonText: 'Cerrar',
        confirmButtonColor: '#7c3aed'
    });
};

/**
 * Renderizar lista de pedidos
 */
function renderizarPedidos() {
    actualizarContadoresPool();
    filtrarPedidos();
}

/**
 * Actualizar la barra de acciones masivas y el checkbox "Todos"
 */
function actualizarSeleccionPedidos() {
    const selectors = document.querySelectorAll('.pedidos-list .pedido-selector');
    const checkedSelectors = document.querySelectorAll('.pedidos-list .pedido-selector:checked');
    const totalCount = selectors.length;
    const selectedCount = checkedSelectors.length;

    // Sincronizar la clase visual 'seleccionado' en cada tarjeta
    selectors.forEach(checkbox => {
        const card = checkbox.closest('.pedido-card');
        if (card) {
            if (checkbox.checked) {
                card.classList.add('seleccionado');
            } else {
                card.classList.remove('seleccionado');
            }
        }
    });

    // Actualizar el checkbox general en la cabecera
    const selectAllCheckbox = document.getElementById('select-all-pedidos');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = totalCount > 0 && selectedCount === totalCount;
        selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }

    // Mostrar u ocultar barra de acciones masivas
    const bulkBar = document.getElementById('bulk-actions-bar');
    const selectedCountSpan = document.getElementById('selected-count');

    if (bulkBar && selectedCountSpan) {
        if (selectedCount > 0) {
            selectedCountSpan.textContent = selectedCount;
            bulkBar.style.display = 'flex';
        } else {
            bulkBar.style.display = 'none';
        }
    }
}

/**
 * Alternar selección de un pedido al hacer clic en su tarjeta
 */
window.toggleSeleccionPedido = function(event, pedidoId) {
    // Evitar disparar si el clic fue en un botón, un input, un badge o un elemento interactivo
    const target = event.target;
    if (
        target.tagName === 'BUTTON' || 
        target.tagName === 'INPUT' || 
        target.tagName === 'A' || 
        target.closest('button') || 
        target.closest('a') || 
        target.classList.contains('pedido-badge') || 
        target.closest('.pedido-badge')
    ) {
        return;
    }

    const checkbox = document.querySelector(`.pedidos-list .pedido-selector[data-id="${pedidoId}"]`);
    if (checkbox && !checkbox.disabled) {
        checkbox.checked = !checkbox.checked;
        actualizarSeleccionPedidos();
    }
};

/**
 * Seleccionar o deseleccionar todos los pedidos visibles y habilitados
 */
function toggleSelectAllPedidos(sourceCheckbox) {
    const selectors = document.querySelectorAll('.pedidos-list .pedido-selector:not(:disabled)');
    selectors.forEach(checkbox => {
        checkbox.checked = sourceCheckbox.checked;
    });
    actualizarSeleccionPedidos();
}

/**
 * Abrir una factura en el módulo de facturación
 */
window.verFacturaDetalle = function(facturaId) {
    const hostname = window.location.hostname;
    const url = `http://${hostname}:3004/pages/ver-factura.html?id=${facturaId}`;
    window.open(url, '_blank');
};

/**
 * Enviar presupuestos seleccionados a facturación respetando la preferencia comercial del cliente
 */
async function enviarAFacturacionSeleccionados() {
    const checkedSelectors = document.querySelectorAll('.pedidos-list .pedido-selector:checked');
    const ids = Array.from(checkedSelectors).map(cb => cb.getAttribute('data-id'));

    if (ids.length === 0) return;

    const selectedPedidos = ids.map(id => (state.pedidos || []).find(p => String(p.id) === String(id)) || { id });

    // Caso 1: Envío individual
    if (selectedPedidos.length === 1) {
        const p = selectedPedidos[0];
        const pref = p.preferencia_facturacion || 'PREGUNTAR';
        const clienteNombre = p.cliente_nombre || 'Cliente';
        const clienteId = p.cliente_id;

        if (pref === 'INTERNO') {
            return procesarEnvioFacturacionLote([{ id: p.id, dest: 'interno' }]);
        } else if (pref === 'ARCA') {
            return procesarEnvioFacturacionLote([{ id: p.id, dest: 'arca' }]);
        } else {
            // Modal de consulta interactiva (idéntico al de Presupuestos)
            Swal.fire({
                title: '¿Cómo deseas facturar?',
                html: `
                    <div style="text-align: left; margin-top: 15px;">
                        <p style="margin-bottom: 15px; font-size: 1.05em;">Selecciona el destino para el pedido de <strong>${clienteNombre}</strong>:</p>
                        
                        <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                            <input type="radio" id="log-fact-dest-interno" name="log-fact-dest" value="interno" checked style="cursor: pointer; width: 18px; height: 18px;">
                            <label for="log-fact-dest-interno" style="cursor: pointer; font-weight: 600; font-size: 1em;">🏢 Presupuestos Aprobados (Interno / Sin ARCA)</label>
                        </div>
                        <div style="margin-bottom: 20px; display: flex; align-items: center; gap: 8px;">
                            <input type="radio" id="log-fact-dest-arca" name="log-fact-dest" value="arca" style="cursor: pointer; width: 18px; height: 18px;">
                            <label for="log-fact-dest-arca" style="cursor: pointer; font-weight: 600; font-size: 1em;">📄 Verificador de ARCA (Oficial)</label>
                        </div>
                        
                        <hr style="border: 0; border-top: 1px solid rgba(0,0,0,0.1); margin: 15px 0;">
                        
                        <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">
                            <input type="checkbox" id="log-fact-remember" style="cursor: pointer; width: 16px; height: 16px;">
                            <label for="log-fact-remember" style="cursor: pointer; font-size: 0.9em; color: #64748b;">Establecer como opción predeterminada para este cliente</label>
                        </div>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#64748b',
                confirmButtonText: 'Continuar',
                cancelButtonText: 'Cancelar',
                preConfirm: () => {
                    const selectedDest = document.querySelector('input[name="log-fact-dest"]:checked').value;
                    const remember = document.getElementById('log-fact-remember').checked;
                    return { selectedDest, remember };
                }
            }).then(async (result) => {
                if (!result.isConfirmed) return;
                const { selectedDest, remember } = result.value;
                if (remember && clienteId) {
                    try {
                        const prefValue = selectedDest === 'arca' ? 'ARCA' : 'INTERNO';
                        await fetch(`/api/presupuestos/clientes/${clienteId}/preferencia-facturacion`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ preferencia_facturacion: prefValue })
                        });
                        p.preferencia_facturacion = prefValue;
                    } catch (err) {
                        console.error('Error al guardar preferencia del cliente:', err);
                    }
                }
                procesarEnvioFacturacionLote([{ id: p.id, dest: selectedDest }]);
            });
            return;
        }
    }

    // Caso 2: Múltiples pedidos seleccionados
    const countInterno = selectedPedidos.filter(p => p.preferencia_facturacion === 'INTERNO').length;
    const countArca = selectedPedidos.filter(p => p.preferencia_facturacion === 'ARCA').length;
    const countPreguntar = selectedPedidos.filter(p => !p.preferencia_facturacion || p.preferencia_facturacion === 'PREGUNTAR').length;

    let desgloseHtml = `<ul style="text-align: left; margin: 12px 0 16px 20px; font-size: 0.95em;">`;
    if (countInterno > 0) desgloseHtml += `<li>🏢 <b>${countInterno}</b> pedido(s) irán a <b>Presupuestos Aprobados (Interno)</b> según su ficha.</li>`;
    if (countArca > 0) desgloseHtml += `<li>📄 <b>${countArca}</b> pedido(s) irán a <b>Factura Oficial (ARCA)</b> según su ficha.</li>`;
    if (countPreguntar > 0) desgloseHtml += `<li>❓ <b>${countPreguntar}</b> pedido(s) no tienen preferencia configurada.</li>`;
    desgloseHtml += `</ul>`;

    let htmlModal = `<p>Se enviarán <b>${selectedPedidos.length}</b> pedido(s) a Facturación.</p>${desgloseHtml}`;

    if (countPreguntar > 0) {
        htmlModal += `
            <div style="text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-top: 10px;">
                <label style="display: block; font-weight: 600; font-size: 0.9em; margin-bottom: 8px; color: #1e293b;">
                    ¿A qué destino enviar los ${countPreguntar} pedido(s) sin preferencia definida?
                </label>
                <div style="display: flex; gap: 15px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="radio" name="log-batch-undef-dest" value="interno" checked>
                        <span>🏢 Presupuestos Aprobados (Interno)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="radio" name="log-batch-undef-dest" value="arca">
                        <span>📄 Factura Oficial (ARCA)</span>
                    </label>
                </div>
            </div>
        `;
    }

    const confirmResult = await Swal.fire({
        title: '¿Enviar a Facturación?',
        html: htmlModal,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, enviar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        preConfirm: () => {
            const rad = document.querySelector('input[name="log-batch-undef-dest"]:checked');
            return rad ? rad.value : 'interno';
        }
    });

    if (!confirmResult.isConfirmed) return;
    const defaultParaIndefinidos = confirmResult.value || 'interno';

    const itemsAProcesar = selectedPedidos.map(p => {
        let dest = 'interno';
        if (p.preferencia_facturacion === 'ARCA') dest = 'arca';
        else if (p.preferencia_facturacion === 'INTERNO') dest = 'interno';
        else dest = defaultParaIndefinidos;
        return { id: p.id, dest };
    });

    procesarEnvioFacturacionLote(itemsAProcesar);
}

/**
 * Procesa el envío a facturación ejecutando el endpoint correspondiente por pedido
 */
async function procesarEnvioFacturacionLote(items) {
    Swal.fire({
        title: 'Procesando...',
        html: `Enviando pedido <b>1</b> de ${items.length}...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const currentElement = Swal.getHtmlContainer()?.querySelector('b');
        if (currentElement) {
            currentElement.textContent = i + 1;
        }

        try {
            const endpoint = item.dest === 'interno'
                ? `/api/facturacion/presupuestos/${item.id}/facturar-local`
                : `/api/facturacion/presupuestos/${item.id}/facturar`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                successCount++;
            } else {
                failCount++;
                errors.push(`Pedido #${item.id}: ${data.error || data.message || 'Error desconocido'}`);
            }
        } catch (err) {
            failCount++;
            errors.push(`Pedido #${item.id}: ${err.message}`);
        }
    }

    if (failCount === 0) {
        Swal.fire({
            title: '¡Envío Completado!',
            text: `Se enviaron exitosamente ${successCount} pedido(s) a facturación según sus destinos configurados.`,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: '🧾 Ir a Gestión de Facturas',
            cancelButtonText: 'Seguir en Logística',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#64748b'
        }).then((res) => {
            cargarPedidos();
            if (res.isConfirmed) {
                window.location.href=(window.LAMDA_RESOLVE_URL?window.LAMDA_RESOLVE_URL('http://localhost:3004'):'http://localhost:3004');
            }
        });
    } else {
        const errorHtml = `<div style="text-align: left; max-height: 150px; overflow-y: auto; font-size: 0.85rem; margin-top: 1rem; padding: 0.5rem; background: #fee2e2; border-radius: 4px; border: 1px solid #fca5a5; color: #991b1b;">
            ${errors.map(e => `• ${e}`).join('<br>')}
        </div>`;

        Swal.fire({
            title: 'Envío parcial',
            html: `Se enviaron ${successCount} pedido(s) correctamente, pero fallaron ${failCount}.<br>${errorHtml}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '🧾 Ir a Gestión de Facturas',
            cancelButtonText: 'Cerrar',
            confirmButtonColor: '#2563eb'
        }).then((res) => {
            cargarPedidos();
            if (res.isConfirmed) {
                window.location.href=(window.LAMDA_RESOLVE_URL?window.LAMDA_RESOLVE_URL('http://localhost:3004'):'http://localhost:3004');
            }
        });
    }
}

/**
 * Enviar todos los pedidos pendientes de una ruta a facturación en lote
 */
async function enviarRutaAFacturacion(rutaId) {
    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}`);
        const result = await response.json();

        if (!result.success || !result.data) {
            throw new Error(result.error || 'No se pudo obtener el detalle de la ruta');
        }

        const ruta = result.data;
        if (!ruta.presupuestos || ruta.presupuestos.length === 0) {
            Swal.fire({
                title: 'Ruta sin pedidos',
                text: 'Esta ruta no contiene pedidos para facturar.',
                icon: 'warning'
            });
            return;
        }

        const pendingBudgets = ruta.presupuestos.filter(p => {
            const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
            const esContacto = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
            const esTratamiento = p.estado === 'Orden de Tratamiento';
            const esOrdenRetiro = p.estado === 'Orden de Retiro';
            const esFacturado = p.esta_facturado || p.comprobante_lomasoft || p.factura_estado === 'APROBADA' || p.factura_estado === 'APROBADA_LOCAL';
            const esEnviado = p.factura_estado === 'BORRADOR' || p.estado === 'Enviado a Facturación';
            return !esSobre && !esContacto && !esTratamiento && !esOrdenRetiro && !esFacturado && !esEnviado;
        });

        if (pendingBudgets.length === 0) {
            Swal.fire({
                title: 'Sin pedidos pendientes',
                text: 'Todos los pedidos de esta ruta ya han sido facturados o enviados.',
                icon: 'info'
            });
            return;
        }

        const listIds = pendingBudgets.map(p => `#${p.id}`).join(', ');
        const confirmResult = await Swal.fire({
            title: '¿Facturar Ruta por Lote?',
            html: `Se enviarán <b>${pendingBudgets.length}</b> pedido(s) pendientes (${listIds}) al módulo de facturación según la preferencia comercial de cada cliente (Presupuestos Aprobados / ARCA).`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, facturar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#8b5cf6',
            cancelButtonColor: '#64748b'
        });

        if (!confirmResult.isConfirmed) return;

        Swal.fire({
            title: 'Procesando facturación...',
            html: `Enviando pedido <b>1</b> de ${pendingBudgets.length}...`,
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        let successCount = 0;
        let failCount = 0;
        const errors = [];

        for (let i = 0; i < pendingBudgets.length; i++) {
            const p = pendingBudgets[i];
            const currentElement = Swal.getHtmlContainer()?.querySelector('b');
            if (currentElement) {
                currentElement.textContent = `${i + 1} (${p.cliente_nombre || 'Cliente'})`;
            }

            try {
                const dest = p.preferencia_facturacion === 'ARCA' ? 'arca' : 'interno';
                const endpoint = dest === 'interno'
                    ? `/api/facturacion/presupuestos/${p.id}/facturar-local`
                    : `/api/facturacion/presupuestos/${p.id}/facturar`;

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    successCount++;
                } else {
                    failCount++;
                    errors.push(`Pedido #${p.id}: ${data.error || data.message || 'Error desconocido'}`);
                }
            } catch (err) {
                failCount++;
                errors.push(`Pedido #${p.id}: ${err.message}`);
            }
        }

        await Promise.all([cargarPedidos(), cargarRutas()]);
        if (state.rutaSeleccionada === rutaId) {
            await verDetallesRuta(rutaId);
        }

        if (failCount === 0) {
            Swal.fire({
                title: '¡Proceso Finalizado!',
                text: `Se enviaron exitosamente ${successCount} pedido(s) a facturación.`,
                icon: 'success',
                showCancelButton: true,
                confirmButtonText: '🧾 Ir a Gestión de Facturas',
                cancelButtonText: 'Seguir en Logística',
                confirmButtonColor: '#2563eb',
                cancelButtonColor: '#64748b'
            }).then((res) => {
                if (res.isConfirmed) {
                    window.location.href=(window.LAMDA_RESOLVE_URL?window.LAMDA_RESOLVE_URL('http://localhost:3004'):'http://localhost:3004');
                }
            });
        } else {
            const errorHtml = `<div style="text-align: left; max-height: 150px; overflow-y: auto; font-size: 0.85rem; margin-top: 1rem; padding: 0.5rem; background: #fee2e2; border-radius: 4px; border: 1px solid #fca5a5; color: #991b1b;">
                ${errors.map(e => `• ${e}`).join('<br>')}
            </div>`;

            Swal.fire({
                title: 'Proceso con Errores',
                html: `Se enviaron ${successCount} pedido(s) correctamente, pero fallaron ${failCount}.<br>${errorHtml}`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: '🧾 Ir a Gestión de Facturas',
                cancelButtonText: 'Cerrar',
                confirmButtonColor: '#2563eb'
            }).then((res) => {
                if (res.isConfirmed) {
                    window.location.href=(window.LAMDA_RESOLVE_URL?window.LAMDA_RESOLVE_URL('http://localhost:3004'):'http://localhost:3004');
                }
            });
        }

    } catch (error) {
        console.error('[DASHBOARD] Error al enviar ruta a facturación:', error);
        mostrarError('Error al procesar facturación de la ruta: ' + error.message);
    }
}

window.enviarRutaAFacturacion = enviarRutaAFacturacion;

function toggleHeaderToolsMenu(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('header-tools-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

function cerrarHeaderToolsMenu() {
    const dropdown = document.getElementById('header-tools-dropdown');
    if (dropdown) {
        dropdown.classList.remove('open');
    }
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('header-tools-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

window.toggleHeaderToolsMenu = toggleHeaderToolsMenu;
window.cerrarHeaderToolsMenu = cerrarHeaderToolsMenu;

/**
 * Renderizar lista de rutas con agrupación
 */
async function renderizarRutas() {
    const container = document.getElementById('rutas-list');

    if (!state.rutas || state.rutas.length === 0) {
        container.innerHTML = '<div class="loading">No hay rutas creadas</div>';
        return;
    }

    // Cargar detalles de cada ruta para mostrar pedidos
    const rutasConDetalles = await Promise.all(
        state.rutas.map(async (ruta) => {
            try {
                const response = await fetch(`/api/logistica/rutas/${ruta.id}`);
                const result = await response.json();
                return result.success ? result.data : ruta;
            } catch (error) {
                console.error(`[DASHBOARD] Error al cargar detalles de ruta ${ruta.id}:`, error);
                return ruta;
            }
        })
    );

    // PASO 1: Separar rutas finalizadas de activas
    const rutasFinalizadas = rutasConDetalles.filter(r => r.estado === 'FINALIZADA');
    const rutasActivas = rutasConDetalles.filter(r => r.estado !== 'FINALIZADA');

    // PASO 2: Agrupar rutas activas por fecha
    const rutasPorFecha = agruparRutasPorFecha(rutasActivas);

    // PASO 3: Renderizar HTML con agrupación
    let html = '';

    // Renderizar rutas activas agrupadas por fecha
    if (rutasPorFecha.length > 0) {
        rutasPorFecha.forEach(grupo => {
            html += `
                <div class="fecha-separador">
                    <span class="fecha-separador-texto">${grupo.fechaTexto}</span>
                </div>
            `;

            html += grupo.rutas.map(ruta => renderizarTarjetaRuta(ruta)).join('');
        });
    }

    // Renderizar rutas finalizadas con agrupación jerárquica (Año > Mes > Rutas)
    if (rutasFinalizadas.length > 0) {
        const gruposAñoMes = agruparRutasPorAñoYMes(rutasFinalizadas);

        html += `
            <div class="rutas-grupo">
                <div class="rutas-grupo-header finalizadas collapsed" onclick="toggleGrupoRutas('finalizadas')">
                    <div class="rutas-grupo-titulo">
                        <span>✅ Rutas Finalizadas</span>
                        <span class="rutas-grupo-contador">${rutasFinalizadas.length}</span>
                    </div>
                    <span class="rutas-grupo-icono">▼</span>
                </div>
                <div class="rutas-grupo-contenido collapsed" id="grupo-finalizadas">
        `;

        // Renderizar cada año
        gruposAñoMes.forEach(grupoAño => {
            const totalRutasAño = grupoAño.meses.reduce((sum, mes) => sum + mes.rutas.length, 0);

            html += `
                <div class="año-grupo">
                    <div class="año-header collapsed" data-año="${grupoAño.año}" onclick="toggleGrupoAño(${grupoAño.año})">
                        <div class="año-titulo">
                            <span>📅 ${grupoAño.año}</span>
                            <span class="año-contador">${totalRutasAño} ruta${totalRutasAño !== 1 ? 's' : ''}</span>
                        </div>
                        <span class="año-icono">▼</span>
                    </div>
                    <div class="año-contenido collapsed" id="año-${grupoAño.año}">
            `;

            // Renderizar cada mes dentro del año
            grupoAño.meses.forEach(grupoMes => {
                html += `
                    <div class="mes-grupo">
                        <div class="mes-header collapsed" data-año="${grupoAño.año}" data-mes="${grupoMes.mes}" onclick="toggleGrupoMes(${grupoAño.año}, ${grupoMes.mes})">
                            <div class="mes-titulo">
                                <span>${grupoMes.nombreMes}</span>
                                <span class="mes-contador">${grupoMes.rutas.length}</span>
                            </div>
                            <span class="mes-icono">▼</span>
                        </div>
                        <div class="mes-contenido collapsed" id="mes-${grupoAño.año}-${grupoMes.mes}">
                            ${grupoMes.rutas.map(ruta => renderizarTarjetaRuta(ruta)).join('')}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    container.innerHTML = html || '<div class="loading">No hay rutas para mostrar</div>';
}

/**
 * Agrupar rutas por fecha
 */
function agruparRutasPorFecha(rutas) {
    // Ordenar por fecha ascendente (más próximas primero)
    const rutasOrdenadas = rutas.sort((a, b) => {
        const fechaA = new Date(a.fecha_salida);
        const fechaB = new Date(b.fecha_salida);
        return fechaA - fechaB;
    });

    // Agrupar por fecha (sin hora)
    const grupos = {};

    rutasOrdenadas.forEach(ruta => {
        const fecha = new Date(ruta.fecha_salida);
        const fechaKey = fecha.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!grupos[fechaKey]) {
            grupos[fechaKey] = {
                fecha: fecha,
                fechaKey: fechaKey,
                fechaTexto: formatearFechaGrupo(fecha),
                rutas: []
            };
        }

        grupos[fechaKey].rutas.push(ruta);
    });

    // Convertir objeto a array y ordenar
    return Object.values(grupos).sort((a, b) => a.fecha - b.fecha);
}

/**
 * Agrupar rutas finalizadas por Año > Mes
 */
function agruparRutasPorAñoYMes(rutas) {
    // Ordenar por fecha descendente (más recientes primero)
    const rutasOrdenadas = rutas.sort((a, b) => {
        const fechaA = new Date(a.fecha_salida);
        const fechaB = new Date(b.fecha_salida);
        return fechaB - fechaA; // Descendente
    });

    // Agrupar por año y mes
    const gruposPorAño = {};

    rutasOrdenadas.forEach(ruta => {
        const fecha = new Date(ruta.fecha_salida);
        const año = fecha.getFullYear();
        const mes = fecha.getMonth(); // 0-11

        // Crear grupo de año si no existe
        if (!gruposPorAño[año]) {
            gruposPorAño[año] = {
                año: año,
                meses: {}
            };
        }

        // Crear grupo de mes si no existe
        if (!gruposPorAño[año].meses[mes]) {
            gruposPorAño[año].meses[mes] = {
                mes: mes,
                nombreMes: obtenerNombreMes(mes),
                rutas: []
            };
        }

        // Agregar ruta al mes correspondiente
        gruposPorAño[año].meses[mes].rutas.push(ruta);
    });

    // Convertir a array y ordenar años descendente (más reciente primero)
    const añosArray = Object.keys(gruposPorAño)
        .map(año => parseInt(año))
        .sort((a, b) => b - a);

    const resultado = añosArray.map(año => {
        // Convertir meses a array y ordenar descendente (más reciente primero)
        const mesesArray = Object.keys(gruposPorAño[año].meses)
            .map(mes => parseInt(mes))
            .sort((a, b) => b - a);

        return {
            año: año,
            meses: mesesArray.map(mes => gruposPorAño[año].meses[mes])
        };
    });

    return resultado;
}

/**
 * Obtener nombre del mes
 */
function obtenerNombreMes(numeroMes) {
    const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return meses[numeroMes];
}

/**
 * Formatear fecha para encabezado de grupo
 */
function formatearFechaGrupo(fecha) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const fechaRuta = new Date(fecha);
    fechaRuta.setHours(0, 0, 0, 0);

    // Comparar fechas
    if (fechaRuta.getTime() === hoy.getTime()) {
        return '🔥 HOY - ' + formatearFechaCompleta(fecha);
    } else if (fechaRuta.getTime() === manana.getTime()) {
        return '⏰ MAÑANA - ' + formatearFechaCompleta(fecha);
    } else if (fechaRuta < hoy) {
        return '⏮️ ' + formatearFechaCompleta(fecha) + ' (Pasada)';
    } else {
        return '📅 ' + formatearFechaCompleta(fecha);
    }
}

/**
 * Formatear fecha completa (Día de Semana DD de Mes)
 */
function formatearFechaCompleta(fecha) {
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const f = new Date(fecha);
    const diaSemana = diasSemana[f.getDay()];
    const dia = f.getDate();
    const mes = meses[f.getMonth()];

    return `${diaSemana} ${dia} de ${mes}`;
}

/**
 * Toggle acordeón de grupo de rutas
 */
function toggleGrupoRutas(grupoId) {
    const header = document.querySelector(`.rutas-grupo-header.${grupoId}`);
    const contenido = document.getElementById(`grupo-${grupoId}`);

    if (!header || !contenido) return;

    const estaColapsado = header.classList.contains('collapsed');

    if (estaColapsado) {
        // Expandir
        header.classList.remove('collapsed');
        contenido.classList.remove('collapsed');
        console.log(`[DASHBOARD] Grupo ${grupoId} expandido`);
    } else {
        // Colapsar
        header.classList.add('collapsed');
        contenido.classList.add('collapsed');
        console.log(`[DASHBOARD] Grupo ${grupoId} colapsado`);
    }
}

/**
 * Toggle acordeón de año
 */
function toggleGrupoAño(año) {
    const header = document.querySelector(`.año-header[data-año="${año}"]`);
    const contenido = document.getElementById(`año-${año}`);

    if (!header || !contenido) return;

    const estaColapsado = header.classList.contains('collapsed');

    if (estaColapsado) {
        // Expandir
        header.classList.remove('collapsed');
        contenido.classList.remove('collapsed');
        console.log(`[DASHBOARD] Año ${año} expandido`);
    } else {
        // Colapsar
        header.classList.add('collapsed');
        contenido.classList.add('collapsed');
        console.log(`[DASHBOARD] Año ${año} colapsado`);
    }
}

/**
 * Toggle acordeón de mes
 */
function toggleGrupoMes(año, mes) {
    const header = document.querySelector(`.mes-header[data-año="${año}"][data-mes="${mes}"]`);
    const contenido = document.getElementById(`mes-${año}-${mes}`);

    if (!header || !contenido) return;

    const estaColapsado = header.classList.contains('collapsed');

    if (estaColapsado) {
        // Expandir
        header.classList.remove('collapsed');
        contenido.classList.remove('collapsed');
        console.log(`[DASHBOARD] Mes ${mes} del año ${año} expandido`);
    } else {
        // Colapsar
        header.classList.add('collapsed');
        contenido.classList.add('collapsed');
        console.log(`[DASHBOARD] Mes ${mes} del año ${año} colapsado`);
    }
}

/**
 * Renderizar tarjeta individual de ruta
 */
function renderizarTarjetaRuta(ruta) {
    // Calcular cantidad de presupuestos pendientes de facturación (excluyendo sobres, contactos y retiros)
    let cantPendientesFacturacion = 0;
    if (ruta.presupuestos && ruta.presupuestos.length > 0) {
        cantPendientesFacturacion = ruta.presupuestos.filter(p => {
            const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
            const esContacto = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
            const esTratamiento = p.estado === 'Orden de Tratamiento';
            const esOrdenRetiro = p.estado === 'Orden de Retiro';
            const esFacturado = p.esta_facturado || p.comprobante_lomasoft || p.factura_estado === 'APROBADA' || p.factura_estado === 'APROBADA_LOCAL';
            const esEnviado = p.factura_estado === 'BORRADOR' || p.estado === 'Enviado a Facturación';
            return !esSobre && !esContacto && !esTratamiento && !esOrdenRetiro && !esFacturado && !esEnviado;
        }).length;
    }

    // Generar lista de pedidos (agrupados por parada)
    let pedidosHTML = '';
    if (ruta.presupuestos && ruta.presupuestos.length > 0) {
        const rutaId = ruta.id;
        const esArmando = ruta.estado === 'ARMANDO';

        // AGRUPACIÓN POR CLIENTE Y DOMICILIO
        const paradas = agruparPresupuestosEnParadas(ruta.presupuestos);

        pedidosHTML = `
            <div class="ruta-pedidos-lista" 
                 id="pedidos-ruta-${rutaId}" 
                 data-ruta-id="${rutaId}"
                 style="margin-top: 0.75rem; font-size: 0.75rem;">
                ${paradas.map((parada, index) => {
            const idsPresupuestos = JSON.stringify(parada.presupuestos.map(p => p.id));
            // Preferir un item con dirección/coordenadas como cabecera de la parada
            const primerPedido = parada.presupuestos.find(p => !String(p.id).startsWith('SOB-') && p.domicilio_direccion)
                || parada.presupuestos.find(p => p.domicilio_direccion)
                || parada.presupuestos[0];

            // Fallbacks
            const clienteId = primerPedido.id_cliente || primerPedido.cliente_id || 'S/N';
            const clienteNombre = primerPedido.cliente_nombre || 'Cliente Desconocido';

            const sobresParada = parada.presupuestos.filter(p => String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo');
            const contactosParada = parada.presupuestos.filter(p => String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial');
            const itemsNoSobre = parada.presupuestos.filter(p => {
                const pSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
                const pContacto = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
                return !pSobre && !pContacto;
            });

            const tieneSobre = sobresParada.length > 0;
            const tieneContacto = contactosParada.length > 0;
            const esSoloSobre = tieneSobre && itemsNoSobre.length === 0 && !tieneContacto;
            const esSoloContacto = tieneContacto && itemsNoSobre.length === 0 && !tieneSobre;

            const algunRetiro = itemsNoSobre.some(p => (p.estado === 'Orden de Tratamiento' && p.estado_tratamiento !== 'COMPLETADO') || p.estado === 'Orden de Retiro');
            const algunaDevolucion = itemsNoSobre.some(p => p.estado === 'Orden de Tratamiento' && p.estado_tratamiento === 'COMPLETADO');
            const esRetiro = !esSoloSobre && !esSoloContacto && algunRetiro && itemsNoSobre.every(p => p.estado === 'Orden de Tratamiento' || p.estado === 'Orden de Retiro');
            const esDevolucion = !esSoloSobre && !esSoloContacto && !esRetiro && algunaDevolucion;

            // Estilos para parada en Ruta
            let estiloItem = 'background-color: white;';
            if (esSoloSobre) estiloItem = 'background-color: #faf5ff; border-left: 4px solid #7c3aed;';
            else if (esSoloContacto) estiloItem = 'background-color: #f0fdfa; border-left: 4px solid #0d9488;';
            else if (esRetiro) estiloItem = 'background-color: #fdf2e9; border-left: 4px solid #d35400;';
            else if (esDevolucion) estiloItem = 'background-color: #eff6ff; border-left: 4px solid #2563eb;';
            else if (tieneSobre) estiloItem = 'background-color: #fcfaff; border-left: 4px solid #7c3aed;';
            
            const iconoCliente = esSoloSobre ? '💵' : (esSoloContacto ? '🎯' : (esRetiro ? '🔙' : (esDevolucion ? '🚚' : '👤')));

            // Totales de pedidos (sin mezclar el monto del sobre con el total comercial de mercadería)
            const totalMontoPedidos = itemsNoSobre.reduce((sum, p) => sum + parseFloat(p.total || 0), 0);
            const cantidadPedidos = itemsNoSobre.length;
            const listaIdsPedidos = itemsNoSobre.map(p => `#${p.id}`).join(', ');

            return `
                    <div class="ruta-pedido-item ${esArmando ? 'sortable' : ''} ${esRetiro ? 'item-retiro' : ''} ${esDevolucion ? 'item-entrega-mant' : ''} ${esSoloSobre ? 'item-sobre' : ''} ${esSoloContacto ? 'item-contacto' : ''}" 
                         data-presupuesto-ids='${idsPresupuestos}'
                         data-cliente-id="${clienteId}"
                         data-tipo="${esSoloSobre ? 'sobre' : (esSoloContacto ? 'contacto' : (esRetiro ? 'retiro' : (esDevolucion ? 'entrega_mantenimiento' : 'venta')))}"
                         draggable="${esArmando}"
                         ondragstart="${esArmando ? 'handlePedidoDragStart(event)' : ''}"
                         ondragover="${esArmando ? 'handlePedidoDragOver(event)' : ''}"
                         ondrop="${esArmando ? 'handlePedidoDrop(event, ' + rutaId + ')' : ''}"
                         ondragend="${esArmando ? 'handlePedidoDragEnd(event)' : ''}"
                         style="display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; ${esArmando ? 'cursor: move;' : ''} ${estiloItem}">
                        
                        ${esArmando ? '<div style="color: #94a3b8; cursor: move; margin-top: 0.25rem;">⋮⋮</div>' : ''}
                        
                        <div style="font-weight: bold; color: #2563eb; min-width: 1.5rem; margin-top: 0.25rem;">
                            ${index + 1}.
                        </div>
                        
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div style="font-weight: 700; color: #0f172a; font-size: 0.85rem;">
                                    ${iconoCliente} ${clienteNombre}
                                </div>
                                <div style="font-weight: 600; color: ${esSoloSobre ? '#6d28d9' : (esSoloContacto ? '#0f766e' : (esRetiro ? '#d35400' : (esDevolucion ? '#2563eb' : '#1e40af')))}; font-size: 0.8rem; background: ${esSoloSobre ? '#ede9fe' : (esSoloContacto ? '#ccfbf1' : (esRetiro ? '#fae5d3' : '#dbeafe'))}; padding: 0 0.25rem; border-radius: 0.25rem;">
                                    ${esSoloContacto ? (primerPedido.codigo_prospecto || clienteId) : `Cli #${clienteId}`}
                                </div>
                            </div>
                            
                            ${esSoloSobre ? `<div style="font-size: 0.7rem; font-weight: bold; color: #6d28d9; margin-top: 0.1rem;">💵 PASO A RETIRAR SOBRE</div>` : ''}
                            ${esSoloContacto ? `<div style="font-size: 0.7rem; font-weight: bold; color: #0f766e; margin-top: 0.1rem;">🎯 VISITA DE CONTACTO COMERCIAL${primerPedido.rubro ? ` • ${primerPedido.rubro}` : ''}</div>` : ''}
                            ${esRetiro ? `<div style="font-size: 0.7rem; font-weight: bold; color: #d35400; margin-top: 0.1rem;">🔙 RETIRO</div>` : ''}
                            ${esDevolucion ? `<div style="font-size: 0.7rem; font-weight: bold; color: #2563eb; margin-top: 0.1rem;">🚚 ENTREGA MANTENIMIENTO</div>` : ''}

                            <div style="color: #475569; font-size: 0.75rem; margin-top: 0.1rem;">
                                📍 ${primerPedido.domicilio_direccion || 'Sin dirección'}
                            </div>
                            
                            ${cantidadPedidos > 0 ? `
                            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem; align-items: center;">
                                <div style="color: #64748b; font-weight: 500;">
                                    ${esRetiro ? '↩️' : (esDevolucion ? '🚚' : '📦')} ${cantidadPedidos > 1 ? 'Pedidos:' : 'Pedido:'} 
                                    <span style="color: #334155; font-weight: 600;">${listaIdsPedidos} ${esRetiro ? '(Retiro)' : (esDevolucion ? '(Entrega Mant.)' : '')}</span>
                                </div>
                                ${totalMontoPedidos > 0 ? `
                                    <div style="color: #059669; font-weight: 600; font-size: 0.7rem;">
                                        💰 $${totalMontoPedidos.toFixed(2)}
                                    </div>
                                ` : ''}
                            </div>
                            ` : ''}

                            ${contactosParada.map(c => {
                                const codP = c.codigo_prospecto || c.id;
                                const encP = c.contacto_nombre ? `👤 ${c.contacto_nombre}` : '';
                                const telP = c.cliente_telefono || c.telefono_whatsapp || '';
                                return `
                                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.25rem; align-items: center; background: #ccfbf1; border: 1px solid #99f6e4; padding: 2px 6px; border-radius: 4px;">
                                    <span style="color: #115e59; font-weight: 700; font-size: 0.71rem;">
                                        🤝 Presentación (${codP})
                                    </span>
                                    ${encP ? `<span style="color: #0f766e; font-weight: 600; font-size: 0.7rem;">${encP}</span>` : ''}
                                    ${telP ? `<span style="color: #047857; font-weight: 700; font-size: 0.7rem;">📱 ${telP}</span>` : ''}
                                </div>
                                `;
                            }).join('')}

                            ${sobresParada.map(s => {
                                const cod = s.codigo_sobre || String(s.id).replace('SOB-', '');
                                const montoS = parseFloat(s.monto_declarado || s.total || 0);
                                const tieneFotosS = Boolean(s.foto_frente_url || s.foto_dorso_url);
                                const yaRetirado = s.estado_logistico === 'RETIRADO' || s.estado_sobre === 'RETIRADO';
                                return `
                                <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.25rem; align-items: center; background: #ede9fe; border: 1px solid #ddd6fe; padding: 2px 6px; border-radius: 4px;">
                                    <span style="color: #5b21b6; font-weight: 700; font-size: 0.72rem;">
                                        💵 Sobre #${cod}
                                    </span>
                                    <span style="color: #6d28d9; font-weight: 700; font-size: 0.72rem;">
                                        $${montoS.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                    </span>
                                    ${yaRetirado ? `<span style="background:#dcfce7; color:#166534; font-weight:700; font-size:0.65rem; padding:1px 4px; border-radius:3px;">✅ RETIRADO</span>` : ''}
                                    ${tieneFotosS ? `<button type="button" onclick="event.stopPropagation(); verFotosSobreLogistica('${cod}', '${s.foto_frente_url || ''}', '${s.foto_dorso_url || ''}')" style="background:#7c3aed; color:white; border:none; border-radius:3px; padding:1px 5px; font-size:0.65rem; cursor:pointer;" title="Ver fotos del sobre">📷</button>` : ''}
                                </div>
                                `;
                            }).join('')}
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                            ${parada.presupuestos.map(p => {
                                const esSobreP = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
                                const esContactoP = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
                                const esTratP = p.estado === 'Orden de Tratamiento';
                                const esRetP = p.estado === 'Orden de Retiro';
                                const labelCorto = esSobreP ? (p.codigo_sobre || p.id) : (esContactoP ? (p.codigo_prospecto || p.id) : p.id);
                                const yaCompletado = p.estado_logistico === 'ENTREGADO' || p.estado_logistico === 'RETIRADO' || p.estado === 'Entregado' || p.estado === 'Retirado' || p.estado_ruta === 'VISITADO';

                                if (esContactoP) {
                                    return `
                                    <div style="display:flex; gap:2px; align-items:center; justify-content:flex-end;">
                                        ${(esArmando && !yaCompletado) ? `
                                            <button class="btn-icon-danger" 
                                                    onclick="event.stopPropagation(); quitarPedidoDeRuta(${rutaId}, '${p.id}')"
                                                    title="Quitar contacto ${labelCorto} de la ruta"
                                                    style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #0d9488; color: white; border: none; border-radius: 0.25rem; cursor: pointer; opacity: 0.9;">
                                                🗑️ ${labelCorto}
                                            </button>
                                        ` : `
                                            <span style="padding: 0.1rem 0.3rem; font-size: 0.68rem; border-radius: 0.25rem; font-weight: bold; color: ${yaCompletado ? '#166534' : '#0f766e'}; background: ${yaCompletado ? '#dcfce7' : '#ccfbf1'};">
                                                ${yaCompletado ? '✅ Visitado' : '🎯 En Ruta'}
                                            </span>
                                        `}
                                    </div>
                                    `;
                                }

                                if (esSobreP) {
                                    return `
                                    <div style="display:flex; gap:2px; align-items:center; justify-content:flex-end;">
                                        ${(esArmando && !yaCompletado) ? `
                                            <button class="btn-icon-danger" 
                                                    onclick="event.stopPropagation(); quitarPedidoDeRuta(${rutaId}, '${p.id}')"
                                                    title="Quitar sobre #${labelCorto}"
                                                    style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #7c3aed; color: white; border: none; border-radius: 0.25rem; cursor: pointer; opacity: 0.9;">
                                                🗑️ #${labelCorto}
                                            </button>
                                        ` : `
                                            <span style="padding: 0.1rem 0.3rem; font-size: 0.68rem; border-radius: 0.25rem; font-weight: bold; color: ${yaCompletado ? '#166534' : '#5b21b6'}; background: ${yaCompletado ? '#dcfce7' : '#ede9fe'};">
                                                ${yaCompletado ? '✅ Retirado' : '💵 En Ruta'}
                                            </span>
                                        `}
                                    </div>
                                    `;
                                }

                                return `
                                <div style="display:flex; gap:2px; align-items:center;">
                                    ${(esArmando && !yaCompletado) ? `
                                        <button class="btn-icon-danger" 
                                                onclick="event.stopPropagation(); quitarPedidoDeRuta(${rutaId}, '${p.id}')"
                                                title="Quitar pedido #${p.id}"
                                                style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; cursor: pointer; opacity: 0.8;">
                                            🗑️ #${p.id}
                                        </button>
                                    ` : ''}
                                    ${(!esTratP && !esRetP) ? (() => {
                                        const esFacturado = p.esta_facturado || p.comprobante_lomasoft || p.factura_estado === 'APROBADA' || p.factura_estado === 'APROBADA_LOCAL';
                                        const esEnviado = p.factura_estado === 'BORRADOR' || p.estado === 'Enviado a Facturación';
                                        const bg = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '#d4edda' : '#d1ecf1') : (esEnviado ? '#f59e0b' : '#64748b');
                                        const color = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '#155724' : '#0c5460') : 'white';
                                        const border = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '1px solid #c3e6cb' : '1px solid #bee5eb') : 'none';
                                        const text = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '🧾 Facturado Local' : '🧾 Facturado ARCA') : (esEnviado ? '📄 Enviado' : '⏳ Pendiente');
                                        return `<span style="padding: 0.1rem 0.3rem; font-size: 0.7rem; border-radius: 0.25rem; font-weight: bold; color: ${color}; background: ${bg}; border: ${border};">${text}</span>`;
                                    })() : ''}
                                    ${(p.comprobante_lomasoft || p.id_factura_lomasoft)
                                        ? `<span style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #10b981; color: white; border-radius: 0.25rem; font-weight: bold; cursor: help;" title="${p.comprobante_lomasoft || p.id_factura_lomasoft}">✅ L.S</span>`
                                        : (!p.esta_facturado && p.factura_estado !== 'APROBADA' && p.factura_estado !== 'APROBADA_LOCAL' && !esTratP && !esRetP
                                            ? `<button class="btn-icon-lomasoft" onclick="event.stopPropagation(); window.buscarCandidatasLomasoft('${p.id}')" title="Conciliar / Facturar #${p.id}" style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #8b5cf6; color: white; border: none; border-radius: 0.25rem; cursor: pointer;">C/F</button>`
                                            : ''
                                          )
                                    }
                                    <button class="btn-icon-lamda" 
                                            onclick="event.stopPropagation(); window.imprimirEtiquetaLamda()"
                                            title="Imprimir LAMDA #${p.id}"
                                            style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #3b82f6; color: white; border: none; border-radius: 0.25rem; cursor: pointer;">
                                        🖨️
                                    </button>
                                </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
        }).join('')}
            </div>
        `;
    }

    // Lógica de Tramos de Navegación (Batching) replicada de Móvil
    const puntosValidos = [];
    if (ruta.presupuestos && ruta.presupuestos.length > 0) {
        const paradas = agruparPresupuestosEnParadas(ruta.presupuestos);
        paradas.forEach((parada, idx) => {
            const p = parada.presupuestos[0];
            if (p && p.latitud && p.latitud !== 'null' && p.longitud !== 'null') {
                puntosValidos.push({ lat: parseFloat(p.latitud), lng: parseFloat(p.longitud), numero: idx + 1 });
            }
        });
    }

    let tramos = [];
    let i = 0;
    while (i < puntosValidos.length) {
        let chunk = puntosValidos.slice(i, i + 10);
        tramos.push(chunk);
        if (i + 10 >= puntosValidos.length) break;
        i += 9;
    }

    let tramosHTML = '';
    if (tramos.length > 0) {
        tramosHTML = `<div style="margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.25rem; padding-top: 0.5rem; border-top: 1px dashed #cbd5e1;">`;
        tramos.forEach((tramo, tIdx) => {
            if(tramo.length === 0) return;
            const encodedTramo = encodeURIComponent(JSON.stringify(tramo));
            let label = tIdx === 0 ? `🗺️ Tramo 1 [1-${tramo[tramo.length-1].numero}]` : `🗺️ Tramo ${tIdx+1} [${tramo[0].numero}-${tramo[tramo.length-1].numero}]`;
            tramosHTML += `<button onclick="event.stopPropagation(); window.abrirTramoGoogleMaps(${tIdx}, '${encodedTramo}')" class="btn-sm" style="background-color: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; border-radius: 4px; font-weight: bold; padding: 2px 6px; font-size: 0.7rem; cursor: pointer;" title="Abrir en Google Maps">
                ${label}
            </button>`;
        });
        tramosHTML += `</div>`;
    }

    return `
        <div class="ruta-card ${ruta.estado?.toLowerCase() || 'armando'}" 
             data-id="${ruta.id}"
             onclick="seleccionarRuta(${ruta.id})"
             ondrop="handleDrop(event, ${ruta.id})" 
             ondragover="handleDragOver(event)">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="ruta-nombre">${ruta.nombre_ruta || `Ruta #${ruta.id}`}</div>
                <button class="btn-icon-danger" 
                        onclick="event.stopPropagation(); eliminarRuta(${ruta.id}, ${ruta.presupuestos?.length || 0})"
                        title="Eliminar ruta"
                        style="padding: 0.25rem 0.5rem; font-size: 0.875rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; cursor: pointer;">
                    🗑️
                </button>
            </div>
            <div class="ruta-chofer">
                👤 ${ruta.chofer_nombre || 'Sin chofer'}
            </div>
            <div class="ruta-stats">
                <div class="ruta-stat">
                    <div class="ruta-stat-value">${ruta.cantidad_presupuestos || ruta.presupuestos?.length || 0}</div>
                    <div class="ruta-stat-label">Pedidos</div>
                </div>
                <div class="ruta-stat">
                    <div class="ruta-stat-value">
                        ${ruta.en_pausa ? '<span style="color:#ea580c;">⏸️ EN PAUSA</span>' : (ruta.estado || 'ARMANDO')}
                    </div>
                    <div class="ruta-stat-label">Estado</div>
                </div>
                ${ruta.estado === 'FINALIZADA' && ruta.duracion_neta_minutos !== null && ruta.duracion_neta_minutos !== undefined ? `
                <div class="ruta-stat" style="background-color: #f0fdf4; border-radius: 4px; padding: 2px 4px;">
                    <div class="ruta-stat-value" style="color: #166534; font-size: 0.8rem;">
                        ⏱️ ${Math.floor(ruta.duracion_neta_minutos / 60)}h ${ruta.duracion_neta_minutos % 60}m
                    </div>
                    <div class="ruta-stat-label" style="color: #166534;">Duración Neta</div>
                </div>
                ` : ''}
            </div>

            ${pedidosHTML}
            ${tramosHTML}
            <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                <button class="btn-secondary" style="flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                        onclick="event.stopPropagation(); verDetallesRuta(${ruta.id})">
                    Ver en Mapa
                </button>
                <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                        onclick="event.stopPropagation(); window.open('/api/logistica/rutas/${ruta.id}/manifiesto', '_blank')"
                        title="Imprimir Manifiesto de Carga">
                    🖨️
                </button>
                <button class="btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                        onclick="event.stopPropagation(); generarQRAcceso(${ruta.id})"
                        title="Generar QR de acceso rápido">
                    📱
                </button>
                ${ruta.estado === 'ARMANDO' ? `
                    <button class="btn-primary" style="flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                            onclick="event.stopPropagation(); iniciarRuta(${ruta.id})">
                        Iniciar Ruta
                    </button>
                ` : ruta.estado === 'EN_CAMINO' ? `
                    <button class="btn-warning" style="flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: #f59e0b; color: white;" 
                            onclick="event.stopPropagation(); detenerRuta(${ruta.id})">
                        ⏸️ Detener / Editar
                    </button>
                ` : ''}
            </div>
            ${cantPendientesFacturacion > 0 ? `
                <div style="margin-top: 0.5rem;">
                    <button class="btn-primary" 
                            style="width: 100%; padding: 0.4rem; font-size: 0.75rem; background-color: #8b5cf6; border-color: #7c3aed; color: white; font-weight: bold; border-radius: 0.375rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.25rem;" 
                            onclick="event.stopPropagation(); enviarRutaAFacturacion(${ruta.id})">
                        🧾 Facturar Ruta (${cantPendientesFacturacion} pendientes)
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Agrupar presupuestos por Cliente + Domicilio (lógica de Paradas)
 * Regla de Negocio LAMDA: Todo lo que pertenece a un cliente en la hoja de ruta
 * (Pedido + Sobre + Retiro) se unifica determinísticamente en la misma parada.
 */
function agruparPresupuestosEnParadas(presupuestos) {
    if (!presupuestos || presupuestos.length === 0) return [];

    const normClienteId = (p) => String(p.id_cliente || p.cliente_id || '').trim().replace(/^0+/, '');

    // Mapa auxiliar: si un cliente tiene un pedido/retiro con domicilio definido en la ruta,
    // cualquier sobre (o item sin domicilio específico distinto) de ese mismo cliente se acopla a esa parada.
    const domicilioPrincipalPorCliente = new Map();
    presupuestos.forEach(p => {
        const cid = normClienteId(p);
        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
        if (cid && p.id_domicilio_entrega && (!domicilioPrincipalPorCliente.has(cid) || !esSobre)) {
            domicilioPrincipalPorCliente.set(cid, p.id_domicilio_entrega);
        }
    });

    const paradas = [];
    const mapaParadas = new Map(); // Key: "idClienteNorm_idDomicilio"

    presupuestos.forEach(p => {
        const cid = normClienteId(p);
        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
        // Si es un sobre de un cliente que ya tiene parada en la ruta, o si no tiene domicilio propio, unificar con el domicilio del cliente en la ruta
        const domId = (esSobre && domicilioPrincipalPorCliente.has(cid))
            ? domicilioPrincipalPorCliente.get(cid)
            : (p.id_domicilio_entrega || domicilioPrincipalPorCliente.get(cid) || 'default');

        const key = `${cid}_${domId}`;

        if (!mapaParadas.has(key)) {
            const nuevaParada = {
                key: key,
                presupuestos: []
            };
            paradas.push(nuevaParada);
            mapaParadas.set(key, nuevaParada);
        }

        mapaParadas.get(key).presupuestos.push(p);
    });

    // Mantener el orden relativo basado en el primer elemento de cada grupo
    return paradas;
}

// ... existing code ...

// ===== DRAG & DROP REORDENAR PEDIDOS EN RUTA =====

let draggedPedidoEnRuta = null; // Ahora almacenará { ids: [1,2], element: ... }

function handlePedidoDragStart(event) {
    const rawIds = event.currentTarget.dataset.presupuestoIds;
    const ids = rawIds ? JSON.parse(rawIds) : [];

    if (ids.length === 0) return;

    draggedPedidoEnRuta = {
        ids: ids,
        element: event.currentTarget
    };

    event.currentTarget.style.opacity = '0.5';
    event.dataTransfer.effectAllowed = 'move';
    console.log('[DRAG] Iniciando arrastre de grupo:', ids);
}

function handlePedidoDragEnd(event) {
    if (event.currentTarget) {
        event.currentTarget.style.opacity = '1';
    }
    draggedPedidoEnRuta = null;
}

function handlePedidoDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const item = event.currentTarget;
    if (item.classList.contains('sortable')) {
        item.style.borderTop = '2px solid #2563eb';
    }
}

async function handlePedidoDrop(event, rutaId) {
    event.preventDefault();
    event.stopPropagation();

    const dropTarget = event.currentTarget;
    dropTarget.style.borderTop = '';

    if (!draggedPedidoEnRuta) return;

    // Identificar el grupo destino (sobre el cual se soltó)
    const rawTargetIds = dropTarget.dataset.presupuestoIds;
    const targetIds = rawTargetIds ? JSON.parse(rawTargetIds) : [];

    // Evitar soltar sobre sí mismo
    // Comprobamos si hay intersección de IDs
    const overlap = targetIds.some(id => draggedPedidoEnRuta.ids.includes(id));
    if (overlap) return;

    // --- LÓGICA DE REORDENAMIENTO FLATTEN ---

    // Obtener todos los elementos DOM de paradas
    const container = document.getElementById(`pedidos-ruta-${rutaId}`);
    const itemElements = Array.from(container.querySelectorAll('.ruta-pedido-item'));

    // Construir el nuevo array plano de IDs
    let nuevoOrdenIds = [];

    for (const el of itemElements) {
        // Ignorar el elemento que se está arrastrando (lo insertaremos manualmente)
        if (el === draggedPedidoEnRuta.element) continue;

        const elIds = JSON.parse(el.dataset.presupuestoIds || '[]');

        // Si este es el elemento destino, insertamos AQUÍ el grupo arrastrado ANTES de él
        if (el === dropTarget) {
            nuevoOrdenIds.push(...draggedPedidoEnRuta.ids);
        }

        nuevoOrdenIds.push(...elIds);
    }

    // Edge case: Si se suelta al final (aunque dragover difícilmente lo detecte si no hay un "contenedor" final)
    // Normalmente el drop ocurre SOBRE un elemento.
    // Si queremos permitir mover al FINAL, se necesitaría un dropzone al final.
    // Por ahora, la lógica inserta "Antes de". 
    // Si el usuario quiere mover al final, puede arrastrar el último elemento hacia arriba... 
    // O podemos detectar si dropTarget es el último y insertarlo después? 
    // Simplificación para MVP: Insertar ANTES del target es estándar.

    console.log('[REORDEN] Nuevo orden plano:', nuevoOrdenIds);

    // Enviar al backend
    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/reordenar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: nuevoOrdenIds })
        });

        const result = await response.json();

        if (result.success) {
            // Recargar rutas para actualizar UI
            await cargarRutas();

            // Actualizar mapa
            const responseRuta = await fetch(`/api/logistica/rutas/${rutaId}`);
            const resultRuta = await responseRuta.json();

            if (resultRuta.success) {
                mostrarMarcadoresRuta(resultRuta.data);
            }
        } else {
            throw new Error(result.error || 'Error al reordenar');
        }
    } catch (error) {
        console.error('[REORDEN] Error:', error);
        mostrarError('Error al reordenar: ' + error.message);
        await cargarRutas();
    }
}

/**
 * Renderizar select de choferes
 */
function renderizarSelectChoferes() {
    const select = document.getElementById('id_chofer');

    if (!select) return;

    select.innerHTML = '<option value="">Seleccione un chofer...</option>' +
        state.choferes.map(chofer => `
            <option value="${chofer.id}">${chofer.nombre_completo || chofer.nombre}</option>
        `).join('');
}

/**
 * Inicializar mapa de Google Maps
 */
async function inicializarMapa() {
    try {
        const mapLoaded = await cargarGoogleMaps();

        if (!mapLoaded) {
            console.warn('[DASHBOARD] Google Maps no disponible');
            document.getElementById('map').innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #64748b;">
                    <div style="text-align: center;">
                        <p style="font-size: 3rem; margin-bottom: 1rem;">🗺️</p>
                        <p>Google Maps no configurado</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">Configure GOOGLE_MAPS_API_KEY en .env</p>
                    </div>
                </div>
            `;
            return;
        }

        // Crear mapa centrado en Argentina
        const mapElement = document.getElementById('map');
        state.map = new google.maps.Map(mapElement, {
            center: { lat: -34.6037, lng: -58.3816 }, // Buenos Aires
            zoom: 12,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true
        });

        console.log('[DASHBOARD] Mapa inicializado');

    } catch (error) {
        console.error('[DASHBOARD] Error al inicializar mapa:', error);
    }
}

/**
 * Configurar event listeners
 */
function configurarEventListeners() {
    // Búsqueda de pedidos
    const searchInput = document.getElementById('search-pedidos');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filtrarPedidos();
        });
    }

    // Filtros
    const filterEstado = document.getElementById('filter-estado');
    if (filterEstado) {
        filterEstado.addEventListener('change', filtrarPedidos);
    }

    const filterZona = document.getElementById('filter-zona');
    if (filterZona) {
        filterZona.addEventListener('change', filtrarPedidos);
    }

    // Cerrar menú contextual al hacer click fuera
    document.addEventListener('click', (e) => {
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu && !contextMenu.contains(e.target)) {
            ocultarMenuContextual();
        }
    });

    // Cerrar menú contextual al hacer scroll
    document.addEventListener('scroll', ocultarMenuContextual, true);
}

/**
 * Filtrar pedidos
 */
function filtrarPedidos() {
    actualizarContadoresPool();

    const searchTerm = document.getElementById('search-pedidos')?.value.toLowerCase().trim() || '';
    const estadoFilter = document.getElementById('filter-estado')?.value || '';
    const zonaFilter = document.getElementById('filter-zona')?.value || '';
    const tipoFilter = state.filtroTipoPool || 'TODOS';

    const pedidosFiltrados = (state.pedidos || []).filter(pedido => {
        const esSobre = String(pedido.id).startsWith('SOB-') || pedido.es_sobre_efectivo === true || pedido.estado === 'Sobre de Efectivo';
        const esContacto = String(pedido.id).startsWith('PR-') || pedido.es_visita_preventa === true || pedido.estado === 'Visita Comercial';
        const esTratamiento = pedido.estado === 'Orden de Tratamiento';
        const esOrdenRetiro = pedido.estado === 'Orden de Retiro';
        const esDevolucion = esTratamiento && pedido.estado_tratamiento === 'COMPLETADO';
        const esRetiro = !esSobre && !esContacto && ((esTratamiento && !esDevolucion) || esOrdenRetiro);
        const esPedido = !esSobre && !esContacto && !esRetiro;

        if (tipoFilter === 'PEDIDOS' && !esPedido) return false;
        if (tipoFilter === 'SOBRES' && !esSobre) return false;
        if (tipoFilter === 'RETIROS' && !esRetiro) return false;
        if (tipoFilter === 'CONTACTOS' && !esContacto) return false;

        const matchSearch = !searchTerm ||
            String(pedido.id || '').toLowerCase().includes(searchTerm) ||
            String(pedido.codigo_sobre || '').toLowerCase().includes(searchTerm) ||
            String(pedido.codigo_prospecto || '').toLowerCase().includes(searchTerm) ||
            String(pedido.id_cliente || pedido.cliente_id || '').toLowerCase().includes(searchTerm) ||
            (pedido.cliente_nombre || '').toLowerCase().includes(searchTerm) ||
            (pedido.domicilio_direccion || '').toLowerCase().includes(searchTerm);

        const matchEstado = !estadoFilter || pedido.estado_logistico === estadoFilter;
        const matchZona = !zonaFilter;

        return matchSearch && matchEstado && matchZona;
    });

    // Renderizar pedidos filtrados
    const container = document.getElementById('pedidos-list');
    if (pedidosFiltrados.length === 0) {
        const msgVacio = tipoFilter === 'SOBRES'
            ? 'No hay sobres cerrados pendientes de retiro'
            : (tipoFilter === 'RETIROS'
                ? 'No hay retiros pendientes'
                : (tipoFilter === 'CONTACTOS'
                    ? 'No hay contactos enviados manualmente a logística'
                    : 'No se encontraron elementos'));
        container.innerHTML = `<div class="loading">${msgVacio}</div>`;
        const selectAll = document.getElementById('select-all-pedidos');
        if (selectAll) selectAll.checked = false;
        actualizarSeleccionPedidos();
        return;
    }

    container.innerHTML = pedidosFiltrados.map(pedido => obtenerPedidoHtml(pedido)).join('');

    const selectAll = document.getElementById('select-all-pedidos');
    if (selectAll) selectAll.checked = false;
    actualizarSeleccionPedidos();
}

/**
 * Refrescar pedidos
 */
async function refrescarPedidos() {
    const btn = event?.target;
    if (btn) {
        btn.textContent = '⏳';
        btn.disabled = true;
    }

    await cargarPedidos();

    if (btn) {
        btn.textContent = '🔄';
        btn.disabled = false;
    }
}

/**
 * Filtrar rutas
 */
function filtrarRutas() {
    // Reutilizamos la lógica del backend para filtrar rutas
    console.log('[DASHBOARD] Filtrar rutas por fecha y búsqueda de backend');
    cargarRutas();
}

/**
 * Crear nueva ruta
 */
function crearNuevaRuta() {
    // Establecer fecha/hora por defecto (mañana a las 8:00)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    const fechaInput = document.getElementById('fecha_salida');
    if (fechaInput) {
        fechaInput.value = tomorrow.toISOString().slice(0, 16);
    }

    // Pre-seleccionar vehículo LYU622
    const vehiculoInput = document.getElementById('id_vehiculo');
    if (vehiculoInput) {
        vehiculoInput.value = 'LYU622';
    }

    abrirModal('modal-nueva-ruta');
}

/**
 * Generar nombre de ruta automático
 */
function generarNombreRuta(fechaSalida) {
    const fecha = new Date(fechaSalida);

    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const diaSemana = diasSemana[fecha.getDay()];
    const dia = fecha.getDate();
    const mes = meses[fecha.getMonth()];
    const año = fecha.getFullYear();
    const horas = fecha.getHours().toString().padStart(2, '0');
    const minutos = fecha.getMinutes().toString().padStart(2, '0');

    return `${diaSemana} ${dia} de ${mes} ${año} - ${horas}:${minutos}`;
}

/**
 * Guardar nueva ruta
 */
async function guardarNuevaRuta(event) {
    event.preventDefault();

    const fechaSalida = document.getElementById('fecha_salida').value;
    const idChofer = parseInt(document.getElementById('id_chofer').value);

    if (!idChofer) {
        mostrarError('Debe seleccionar un chofer');
        return;
    }

    // Validar si la fecha es en el pasado (advertencia, no bloqueo)
    const fechaSeleccionada = new Date(fechaSalida);
    const ahora = new Date();

    if (fechaSeleccionada < ahora) {
        const confirmar = confirm(
            '⚠️ ATENCIÓN: Estás creando una ruta en el pasado.\n\n' +
            `Fecha seleccionada: ${fechaSeleccionada.toLocaleString()}\n` +
            `Fecha actual: ${ahora.toLocaleString()}\n\n` +
            '¿Deseas continuar?'
        );

        if (!confirmar) {
            console.log('[DASHBOARD] Creación de ruta cancelada por el usuario (fecha pasada)');
            return;
        }

        console.log('[DASHBOARD] Usuario confirmó creación de ruta en el pasado');
    }

    // Generar nombre automático
    const nombreRuta = generarNombreRuta(fechaSalida);

    const formData = {
        nombre_ruta: nombreRuta,
        fecha_salida: fechaSalida,
        id_chofer: idChofer,
        id_vehiculo: document.getElementById('id_vehiculo').value || null
    };

    try {
        const response = await fetch('/api/logistica/rutas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito(`Ruta creada: ${nombreRuta}`);
            cerrarModal('modal-nueva-ruta');
            await cargarRutas();
        } else {
            throw new Error(result.error || 'Error al crear ruta');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al crear ruta:', error);
        mostrarError('Error al crear ruta: ' + error.message);
    }
}

/**
 * Seleccionar ruta
 */
function seleccionarRuta(rutaId) {
    state.rutaSeleccionada = rutaId;
    console.log('[DASHBOARD] Ruta seleccionada:', rutaId);

    // Resaltar ruta seleccionada
    document.querySelectorAll('.ruta-card').forEach(card => {
        card.style.border = card.dataset.id == rutaId ? '2px solid #2563eb' : '';
    });

    // Cargar detalles de la ruta
    verDetallesRuta(rutaId);
}

/**
 * Ver detalles de ruta
 */
async function verDetallesRuta(rutaId) {
    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}`);
        const result = await response.json();

        if (result.success) {
            const ruta = result.data;
            const infoDiv = document.getElementById('ruta-info');
            const detallesDiv = document.getElementById('ruta-detalles');

            if (infoDiv && detallesDiv) {
                infoDiv.style.display = 'block';

                // Generar HTML con lista de pedidos (NUEVA JERARQUÍA: Cliente primero)
                let pedidosHTML = '';
                
                // Lógica de Tramos de Navegación (Batching) replicada de Móvil
                let tramosHTML = '';
                const puntosValidos = [];
                if (ruta.presupuestos && ruta.presupuestos.length > 0) {
                    const paradas = agruparPresupuestosEnParadas(ruta.presupuestos);
                    paradas.forEach((parada, idx) => {
                        const p = parada.presupuestos[0];
                        if (p && p.latitud && p.latitud !== 'null' && p.longitud !== 'null') {
                            puntosValidos.push({ lat: parseFloat(p.latitud), lng: parseFloat(p.longitud), numero: idx + 1 });
                        }
                    });
                }
            
                let tramos = [];
                let i = 0;
                while (i < puntosValidos.length) {
                    let chunk = puntosValidos.slice(i, i + 10);
                    tramos.push(chunk);
                    if (i + 10 >= puntosValidos.length) break;
                    i += 9;
                }
            
                if (tramos.length > 0) {
                    tramosHTML = `<div style="margin-top: 1rem; padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem;">
                                    <strong style="display: block; margin-bottom: 0.5rem; color: #1e3a8a;">🗺️ Navegación por Tramos (Google Maps)</strong>
                                    <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">`;
                    tramos.forEach((tramo, tIdx) => {
                        if(tramo.length === 0) return;
                        const encodedTramo = encodeURIComponent(JSON.stringify(tramo));
                        let label = tIdx === 0 ? `Tramo 1 [1-${tramo[tramo.length-1].numero}]` : `Tramo ${tIdx+1} [${tramo[0].numero}-${tramo[tramo.length-1].numero}]`;
                        tramosHTML += `<button onclick="window.abrirTramoGoogleMaps(${tIdx}, '${encodedTramo}')" style="background-color: #2563eb; color: white; border: none; border-radius: 4px; font-weight: bold; padding: 6px 12px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#1d4ed8'" onmouseout="this.style.backgroundColor='#2563eb'">
                            📍 ${label}
                        </button>`;
                    });
                    tramosHTML += `</div></div>`;
                }

                if (ruta.presupuestos && ruta.presupuestos.length > 0) {
                    pedidosHTML = '<div style="margin-top: 1rem;"><strong>Paradas / Elementos en ruta:</strong><ol style="margin: 0.5rem 0; padding-left: 1.5rem;">';
                    ruta.presupuestos.forEach((p, index) => {
                        const clienteId = p.id_cliente || p.cliente_id || 'S/N';
                        const clienteNombre = p.cliente_nombre || 'Cliente Desconocido';

                        const esSobre = String(p.id).startsWith('SOB-') || p.es_sobre_efectivo === true || p.estado === 'Sobre de Efectivo';
                        const esContacto = String(p.id).startsWith('PR-') || p.es_visita_preventa === true || p.estado === 'Visita Comercial';
                        const esTratamiento = p.estado === 'Orden de Tratamiento';
                        const esOrdenRetiro = p.estado === 'Orden de Retiro';
                        let badgeFacturacionHTML = '';
                        if (esSobre) {
                            const codSobre = p.codigo_sobre || String(p.id).replace('SOB-', '');
                            const montoS = parseFloat(p.monto_declarado || p.total || 0);
                            badgeFacturacionHTML = `<span style="padding: 0.1rem 0.35rem; font-size: 0.65rem; border-radius: 0.25rem; font-weight: bold; color: #5b21b6; background: #ede9fe; border: 1px solid #ddd6fe; margin-left: 0.5rem; display: inline-block; vertical-align: middle;">💵 Sobre #${codSobre} ($${montoS.toLocaleString('es-AR', { minimumFractionDigits: 2 })})</span>`;
                        } else if (esContacto) {
                            badgeFacturacionHTML = `<span style="padding: 0.1rem 0.35rem; font-size: 0.65rem; border-radius: 0.25rem; font-weight: bold; color: #0f766e; background: #ccfbf1; border: 1px solid #99f6e4; margin-left: 0.5rem; display: inline-block; vertical-align: middle;">🤝 Visita Comercial${p.rubro ? ` (${p.rubro})` : ''}</span>`;
                        } else if (!esTratamiento && !esOrdenRetiro) {
                            const esFacturado = p.esta_facturado || p.comprobante_lomasoft || p.factura_estado === 'APROBADA' || p.factura_estado === 'APROBADA_LOCAL';
                            const esEnviado = p.factura_estado === 'BORRADOR' || p.estado === 'Enviado a Facturación';
                            const bg = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '#d4edda' : '#d1ecf1') : (esEnviado ? '#f59e0b' : '#64748b');
                            const color = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '#155724' : '#0c5460') : 'white';
                            const border = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '1px solid #c3e6cb' : '1px solid #bee5eb') : 'none';
                            const label = esFacturado ? (p.factura_estado === 'APROBADA_LOCAL' ? '🧾 Facturado Local' : '🧾 Facturado ARCA') : (esEnviado ? '📄 Enviado' : '⏳ Pendiente');
                            badgeFacturacionHTML = `<span style="padding: 0.1rem 0.3rem; font-size: 0.65rem; border-radius: 0.25rem; font-weight: bold; color: ${color}; background: ${bg}; border: ${border}; margin-left: 0.5rem; display: inline-block; vertical-align: middle;">${label}</span>`;
                        }

                        pedidosHTML += `
                            <li style="margin: 0.25rem 0;">
                                <strong style="color: ${esSobre ? '#6d28d9' : (esContacto ? '#0f766e' : '#1e40af')};">${esSobre ? '💵' : (esContacto ? '🎯' : '👤')} ${esContacto ? `Contacto ${p.codigo_prospecto || clienteId}` : `Cliente #${clienteId}`}</strong> - ${clienteNombre}
                                <br><small style="color: #64748b;">${esSobre ? `Sobre #${p.codigo_sobre || p.id}` : (esContacto ? `Visita de Presentación` : `Pedido #${p.id}`)}</small>${badgeFacturacionHTML}
                                <br><small style="color: #64748b;">📍 ${p.domicilio_direccion || 'Sin dirección'}</small>
                            </li>
                        `;
                    });
                    pedidosHTML += '</ol></div>';
                }

                detallesDiv.innerHTML = `
                    <p><strong>Nombre:</strong> ${ruta.nombre_ruta}</p>
                    <p><strong>Chofer:</strong> ${ruta.chofer_nombre || 'Sin asignar'}</p>
                    <p><strong>Estado:</strong> ${ruta.en_pausa ? '<span style="color:#ea580c; font-weight:bold;">⏸️ EN PAUSA</span>' : ruta.estado}</p>
                    <p><strong>Pedidos:</strong> ${ruta.presupuestos?.length || 0}</p>
                    <p><strong>Fecha Salida:</strong> ${ruta.fecha_salida ? new Date(ruta.fecha_salida).toLocaleString() : 'N/A'}</p>
                    ${ruta.estado === 'FINALIZADA' && ruta.duracion_neta_minutos !== null && ruta.duracion_neta_minutos !== undefined ? `<p><strong>Duración Neta:</strong> ⏱️ ${Math.floor(ruta.duracion_neta_minutos / 60)}h ${ruta.duracion_neta_minutos % 60}m</p>` : ''}
                    ${ruta.estado === 'FINALIZADA' ? `<div style="margin-top: 1rem;"><button onclick="window.location.href='/pages/auditoria-rutas.html?id_ruta=${ruta.id}'" style="background-color: #1e293b; color: white; border: none; border-radius: 6px; font-weight: bold; padding: 10px; font-size: 0.9rem; cursor: pointer; transition: background 0.2s; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">🛰️ Auditar con Google Timeline</button></div>` : ''}
                    ${tramosHTML}
                    ${pedidosHTML}
                `;
            }

            // Mostrar marcadores en el mapa
            mostrarMarcadoresRuta(ruta);

        } else {
            throw new Error(result.error || 'Error al cargar detalles');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al cargar detalles:', error);
        mostrarError('Error al cargar detalles de la ruta');
    }
}

/**
 * Mostrar marcadores de una ruta en el mapa
 */
function mostrarMarcadoresRuta(ruta) {
    if (!state.map) {
        console.warn('[DASHBOARD] Mapa no inicializado');
        return;
    }

    // Limpiar marcadores anteriores
    state.markers.forEach(marker => marker.setMap(null));
    state.markers = [];

    if (!ruta.presupuestos || ruta.presupuestos.length === 0) {
        console.log('[DASHBOARD] Ruta sin presupuestos para mostrar');
        return;
    }

    const bounds = new google.maps.LatLngBounds();
    let marcadoresCreados = 0;

    // Agrupar por Coordenadas Físicas
    const paradasMap = new Map();
    ruta.presupuestos.forEach(p => {
        if (!p.latitud || !p.longitud) {
            console.warn(`[DASHBOARD] Presupuesto ${p.id} ignorado por falta de GPS`);
            return;
        }
        const key = `${p.latitud}_${p.longitud}`;
        if (!paradasMap.has(key)) {
            paradasMap.set(key, { 
                latitud: p.latitud, longitud: p.longitud, 
                cliente_nombre: p.cliente_nombre, 
                domicilio_direccion: p.domicilio_direccion,
                ids: [p.id], totales: p.total ? [parseFloat(p.total)] : [], 
                count: 1 
            });
        } else {
            const parada = paradasMap.get(key);
            parada.ids.push(p.id);
            if (p.total) parada.totales.push(parseFloat(p.total));
            parada.count++;
        }
    });

    let index = 0;
    paradasMap.forEach((parada, key) => {
        const position = {
            lat: parseFloat(parada.latitud),
            lng: parseFloat(parada.longitud)
        };

        const totalSuma = parada.totales.reduce((a,b)=>a+b, 0);
        const multilineLabel = parada.count > 1 ? ` (${parada.count} Pedidos)` : '';

        // Crear marcador con número de Parada Física
        const marker = new google.maps.Marker({
            position: position,
            map: state.map,
            title: `${index + 1}. ${parada.cliente_nombre}${multilineLabel}`,
            label: {
                text: `${index + 1}`,
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold'
            },
            animation: google.maps.Animation.DROP
        });

        // Info window agrupada
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 0.5rem; min-width: 200px;">
                    <div style="background: #1e3a8a; color: white; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-bottom: 8px;">
                        <strong>Parada Geográfica ${index + 1}</strong>
                    </div><br>
                    <strong>Carga Documental: #${parada.ids.join(', #')}</strong><br>
                    Cliente: ${parada.cliente_nombre || 'Sin nombre'}<br>
                    Dirección: ${parada.domicilio_direccion || 'Sin dirección'}<br>
                    ${totalSuma > 0 ? `<div style="margin-top: 6px; color: #059669; font-weight: bold;">Monto Físico Total: $${totalSuma.toFixed(2)}</div>` : ''}
                </div>
            `
        });

        marker.addListener('click', () => {
            infoWindow.open(state.map, marker);
        });

        state.markers.push(marker);
        bounds.extend(position);
        marcadoresCreados++;
        index++;
    });

    // Ajustar zoom para mostrar todos los marcadores
    if (marcadoresCreados > 0) {
        state.map.fitBounds(bounds);

        // Si solo hay un marcador, hacer zoom más cercano
        if (marcadoresCreados === 1) {
            google.maps.event.addListenerOnce(state.map, 'bounds_changed', () => {
                state.map.setZoom(15);
            });
        }

        console.log(`[DASHBOARD] ${marcadoresCreados} marcadores mostrados en el mapa`);
    }
}

/**
 * Eliminar ruta
 */
async function eliminarRuta(rutaId, cantidadPedidos) {
    // Nuevo mensaje de confirmación que explica la restauración automática
    let mensaje = '¿Está seguro de eliminar esta ruta?';

    if (cantidadPedidos > 0) {
        mensaje = `⚠️ ATENCIÓN: Esta ruta tiene ${cantidadPedidos} pedido(s) asignado(s).\n\n` +
            `Si la eliminas, los pedidos volverán automáticamente a estado PENDIENTE.\n\n` +
            `Esto significa que:\n` +
            `• Se desvincularán de la ruta\n` +
            `• Volverán a la lista de "Pedidos Listos para Asignar"\n` +
            `• Si estaban entregados, volverán a estado "Presupuesto/Orden"\n\n` +
            `¿Confirmar eliminación?`;
    }

    if (!confirm(mensaje)) {
        return;
    }

    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito('Ruta eliminada correctamente');
            await cargarRutas();

            // Limpiar panel de detalles si era la ruta seleccionada
            if (state.rutaSeleccionada === rutaId) {
                state.rutaSeleccionada = null;
                const infoDiv = document.getElementById('ruta-info');
                if (infoDiv) {
                    infoDiv.style.display = 'none';
                }
                // Limpiar marcadores del mapa
                state.markers.forEach(marker => marker.setMap(null));
                state.markers = [];
            }
        } else {
            throw new Error(result.error || 'Error al eliminar ruta');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al eliminar ruta:', error);
        mostrarError('Error al eliminar ruta: ' + error.message);
    }
}

/**
 * Iniciar ruta
 */
async function iniciarRuta(rutaId) {
    if (typeof Swal === 'undefined') {
        if (!confirm('¿Está seguro de iniciar esta ruta? No podrá agregar más pedidos.')) return;
        try {
            const response = await fetch(`/api/logistica/rutas/${rutaId}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: 'EN_CAMINO' })
            });
            const result = await response.json();
            if (result.success) {
                mostrarExito('Ruta iniciada exitosamente');
                await cargarRutas();
            } else throw new Error(result.error || 'Error al iniciar ruta');
        } catch (error) {
            console.error('[DASHBOARD] Error al iniciar ruta:', error);
            mostrarError('Error al iniciar ruta: ' + error.message);
        }
        return;
    }

    // 1. Mostrar loader breve y consultar destinatarios
    Swal.fire({
        title: 'Preparando ruta...',
        html: '<div style="font-size:0.9rem; color:#64748b;">Obteniendo clientes y datos de contacto...</div>',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    let clientesRuta = [];
    try {
        const resp = await fetch(`/api/logistica/rutas/${rutaId}/destinatarios-inicio`);
        const d = await resp.json();
        if (d.success && Array.isArray(d.clientes)) {
            clientesRuta = d.clientes;
        }
    } catch (e) {
        console.warn('[DASHBOARD] Error consultando destinatarios de inicio:', e.message);
    }

    if (clientesRuta.length === 0) {
        const resSimple = await Swal.fire({
            title: '🚀 Iniciar Ruta',
            text: '¿Está seguro de iniciar esta ruta? No podrá agregar más pedidos.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, Iniciar Ruta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            cancelButtonColor: '#64748b'
        });
        if (!resSimple.isConfirmed) return;

        try {
            const response = await fetch(`/api/logistica/rutas/${rutaId}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: 'EN_CAMINO', notificar_clientes: false })
            });
            const result = await response.json();
            if (result.success) {
                mostrarExito('Ruta iniciada exitosamente');
                await cargarRutas();
            } else throw new Error(result.error || 'Error al iniciar ruta');
        } catch (err) {
            mostrarError('Error al iniciar ruta: ' + err.message);
        }
        return;
    }

    // 2. Construir listado de clientes
    const conWhatsApp = clientesRuta.filter(c => c.tiene_whatsapp);
    let cantSeleccionados = conWhatsApp.length;

    const listaHtml = clientesRuta.map((c, idx) => {
        const partesBadge = [];
        if (Array.isArray(c.pedidos) && c.pedidos.length > 0) partesBadge.push(`📦 Pedido #${c.pedidos.join(', #')}`);
        if (Array.isArray(c.retiros) && c.retiros.length > 0) partesBadge.push(`🔄 Retiro #${c.retiros.join(', #')}`);
        if (Array.isArray(c.sobres) && c.sobres.length > 0) partesBadge.push(`💵 Sobre #${c.sobres.join(', #')}`);

        let badgeStyle = 'background: #dcfce7; color: #166534;';
        if (c.tipo_parada === 'SOLO_SOBRE') badgeStyle = 'background: #ede9fe; color: #5b21b6;';
        else if (c.tipo_parada === 'SOLO_RETIRO') badgeStyle = 'background: #ffedd5; color: #c2410c;';
        else if (partesBadge.length > 1) badgeStyle = 'background: #e0e7ff; color: #3730a3;';

        const badgeTipo = `<span style="${badgeStyle} padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: bold;">${partesBadge.join(' + ')}</span>`;

        const infoContacto = c.tiene_whatsapp
            ? `<div style="font-size: 0.75rem; color: #059669; font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 4px;">
                 <span>📱</span> <span>${c.destinatarios.map(d => `${d.nombre}: ${d.numero}`).join(' • ')}</span>
               </div>`
            : `<div style="font-size: 0.72rem; color: #dc2626; font-weight: bold; margin-top: 2px;">
                 ⚠️ Sin WhatsApp configurado
               </div>`;

        return `
            <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-bottom: 1px solid #f1f5f9; background: ${c.tiene_whatsapp ? '#ffffff' : '#f8fafc'}; text-align: left;">
                <input type="checkbox" 
                       class="chk-cliente-inicio-desktop" 
                       data-id="${c.cliente_id}" 
                       ${c.tiene_whatsapp ? 'checked' : 'disabled'}
                       style="margin-top: 3px; width: 18px; height: 18px; cursor: pointer; accent-color: #059669; flex-shrink: 0;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="font-weight: 700; font-size: 0.88rem; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${idx + 1}. ${c.nombre}
                        </span>
                        ${badgeTipo}
                    </div>
                    <div style="font-size: 0.76rem; color: #64748b; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        📍 ${c.direccion}
                    </div>
                    ${infoContacto}
                </div>
            </div>
        `;
    }).join('');

    const modalHtml = `
        <div style="font-family: inherit; width: 100%; box-sizing: border-box;">
            <p style="font-size: 0.88rem; color: #475569; margin: 0 0 12px 0; text-align: center;">
                Seleccione a qué clientes desea notificar por WhatsApp que la logística está en camino:
            </p>

            <div style="display: flex; justify-content: space-between; align-items: center; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px;">
                <span id="txt-contador-desktop" style="font-size: 0.8rem; font-weight: bold; color: #334155;">
                    Notificar: ${cantSeleccionados} de ${clientesRuta.length} clientes
                </span>
                <div style="display: flex; gap: 6px;">
                    <button type="button" id="btn-desktop-sel-todos" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; color: #334155; cursor: pointer;">
                        Todos
                    </button>
                    <button type="button" id="btn-desktop-des-todos" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; color: #334155; cursor: pointer;">
                        Ninguno
                    </button>
                </div>
            </div>

            <div style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
                ${listaHtml}
            </div>

            <div style="margin-top: 10px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 8px; font-size: 0.75rem; color: #64748b; text-align: left;">
                💬 <strong>Mensaje corto a enviar:</strong><br>
                <em>"Hola {Cliente}, le avisamos que nuestro chofer ya inició el recorrido de entregas de hoy y su orden se encuentra en camino. ¡Pronto estaremos allí!"</em>
            </div>
        </div>
    `;

    const result = await Swal.fire({
        title: '🚀 Iniciar Hoja de Ruta',
        html: modalHtml,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: `🚀 Iniciar y Notificar (${cantSeleccionados})`,
        denyButtonText: '⏩ Iniciar sin Notificar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#059669',
        denyButtonColor: '#64748b',
        cancelButtonColor: '#94a3b8',
        customClass: {
            confirmButton: 'swal2-confirm swal2-styled',
            denyButton: 'swal2-deny swal2-styled',
            cancelButton: 'swal2-cancel swal2-styled'
        },
        didOpen: () => {
            const getCheckboxes = () => document.querySelectorAll('.chk-cliente-inicio-desktop:not(:disabled)');
            const updateCount = () => {
                const checked = document.querySelectorAll('.chk-cliente-inicio-desktop:checked');
                cantSeleccionados = checked.length;
                const txtCont = document.getElementById('txt-contador-desktop');
                if (txtCont) txtCont.innerText = `Notificar: ${cantSeleccionados} de ${clientesRuta.length} clientes`;
                
                const btnConfirm = Swal.getConfirmButton();
                if (btnConfirm) {
                    btnConfirm.innerText = `🚀 Iniciar y Notificar (${cantSeleccionados})`;
                }
            };

            document.querySelectorAll('.chk-cliente-inicio-desktop').forEach(chk => {
                chk.addEventListener('change', updateCount);
            });

            document.getElementById('btn-desktop-sel-todos')?.addEventListener('click', () => {
                getCheckboxes().forEach(c => c.checked = true);
                updateCount();
            });

            document.getElementById('btn-desktop-des-todos')?.addEventListener('click', () => {
                getCheckboxes().forEach(c => c.checked = false);
                updateCount();
            });
        }
    });

    if (!result.isConfirmed && !result.isDenied) return;

    const notificar = result.isConfirmed;
    const selectedIds = notificar 
        ? Array.from(document.querySelectorAll('.chk-cliente-inicio-desktop:checked')).map(el => el.getAttribute('data-id'))
        : [];

    Swal.fire({
        title: 'Iniciando ruta...',
        html: notificar && selectedIds.length > 0
            ? 'Actualizando estado y despachando avisos de WhatsApp en segundo plano...'
            : 'Actualizando estado de la ruta...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                estado: 'EN_CAMINO',
                notificar_clientes: notificar,
                clientes_ids: selectedIds
            })
        });

        const resData = await response.json();

        if (resData.success) {
            Swal.fire({
                icon: 'success',
                title: '🚀 ¡Ruta Iniciada!',
                text: notificar && selectedIds.length > 0
                    ? `Ruta en camino. Notificando por WhatsApp a ${selectedIds.length} clientes en segundo plano.`
                    : 'Ruta iniciada correctamente en modo silencioso.',
                timer: 2500,
                showConfirmButton: false
            });
            await cargarRutas();
        } else {
            throw new Error(resData.error || 'Error al iniciar ruta');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al iniciar ruta:', error);
        Swal.fire('Error', 'Error al iniciar ruta: ' + error.message, 'error');
    }
}

/**
 * Detener ruta (volver a estado ARMANDO)
 */
async function detenerRuta(rutaId) {
    if (!confirm('¿Está seguro de detener esta ruta?\n\nVolverá al estado ARMANDO y podrá agregar o quitar pedidos nuevamente.')) {
        return;
    }

    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'ARMANDO' })
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito('Ruta detenida. Ahora puede editarla nuevamente.');
            await cargarRutas();
        } else {
            throw new Error(result.error || 'Error al detener ruta');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al detener ruta:', error);
        mostrarError('Error al detener ruta: ' + error.message);
    }
}

// ===== DRAG & DROP PEDIDOS A RUTAS =====

let draggedPedidoId = null;
let draggedPedidoTipo = null; // 'venta' | 'retiro'

function handleDragStart(event) {
    draggedPedidoId = event.target.dataset.id;
    draggedPedidoTipo = event.target.dataset.tipo || 'venta'; // Capturar tipo
    event.target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(event) {
    event.target.classList.remove('dragging');
    draggedPedidoId = null;
    draggedPedidoTipo = null;
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

async function handleDrop(event, rutaId) {
    event.preventDefault();

    if (!draggedPedidoId) return;

    // CAPTURA INMEDIATA (Local) para evitar race condition con handleDragEnd
    const tipoPedidoActual = draggedPedidoTipo;

    try {
        const esStringId = String(draggedPedidoId).startsWith('RT-') || String(draggedPedidoId).startsWith('SOB-') || String(draggedPedidoId).startsWith('PR-');
        const response = await fetch(`/api/logistica/rutas/${rutaId}/asignar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids_presupuestos: [esStringId ? String(draggedPedidoId) : parseInt(draggedPedidoId)] })
        });

        const result = await response.json();

        if (result.success) {
            // Feedback contextual según el tipo (usando variable local segura)
            const mensaje = tipoPedidoActual === 'sobre'
                ? '💵 Sobre de efectivo asignado a la ruta'
                : (tipoPedidoActual === 'contacto'
                    ? '🎯 Visita de contacto asignada a la ruta'
                    : (tipoPedidoActual === 'retiro'
                        ? '✅ Orden de Tratamiento asignada exitosamente'
                        : 'Pedido asignado exitosamente'));

            mostrarExito(mensaje);
            await Promise.all([cargarPedidos(), cargarRutas()]);
        } else {
            throw new Error(result.error || 'Error al asignar pedido');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al asignar pedido:', error);
        mostrarError('Error al asignar pedido: ' + error.message);
    } finally {
        draggedPedidoId = null;
        draggedPedidoTipo = null;
    }
}

// ===== UTILIDADES =====

function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
    }
}

function cerrarModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';

        // Limpiar formulario si existe
        const form = modal.querySelector('form');
        if (form) form.reset();
    }
}

function mostrarExito(mensaje) {
    alert('✅ ' + mensaje);
}

function mostrarError(mensaje) {
    alert('❌ ' + mensaje);
}

function centrarMapa() {
    if (state.map) {
        state.map.setCenter({ lat: -34.6037, lng: -58.3816 });
        state.map.setZoom(12);
    }
}

function toggleFullscreen() {
    const mapContainer = document.getElementById('map').parentElement;
    if (!document.fullscreenElement) {
        mapContainer.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// ===== MENÚ CONTEXTUAL =====

/**
 * Mostrar menú contextual
 */
function mostrarMenuContextual(event, pedidoId) {
    event.preventDefault();
    event.stopPropagation();

    // Obtener datos del pedido
    const pedidoCard = event.currentTarget;
    const pedidoData = pedidoCard.getAttribute('data-pedido');
    const pedido = JSON.parse(pedidoData);

    // Guardar referencia global para el onclick del menú
    window.contextMenuPedido = pedido;

    // Obtener menú
    const contextMenu = document.getElementById('context-menu');

    // Posicionar menú en la posición del cursor
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
    contextMenu.style.display = 'block';

    console.log('[CONTEXT-MENU] Menú abierto para pedido:', pedidoId);
}

/**
 * Ocultar menú contextual
 */
function ocultarMenuContextual() {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    window.contextMenuPedido = null;
}

// ===== GESTIÓN DE DOMICILIOS =====

// Variable global para el contexto del modal
let modalDomiciliosContext = {
    presupuestoId: null,
    clienteId: null,
    clienteNombre: null,
    mapaInteractivo: null,
    domicilioEditando: null // ID del domicilio en edición
};

/**
 * Abrir modal de gestión de domicilios
 */
async function abrirModalDomicilios(presupuesto) {
    console.log('[DOMICILIOS] Abriendo modal para presupuesto:', presupuesto.id);

    // Ocultar menú contextual
    ocultarMenuContextual();

    // Guardar contexto
    modalDomiciliosContext = {
        presupuestoId: presupuesto.id,
        clienteId: presupuesto.id_cliente,
        clienteNombre: presupuesto.cliente_nombre
    };

    // Actualizar info del modal
    document.getElementById('domicilio-cliente-nombre').textContent = presupuesto.cliente_nombre || 'Sin nombre';
    document.getElementById('domicilio-presupuesto-id').textContent = presupuesto.id;

    // Ocultar formulario de nuevo domicilio
    document.getElementById('form-nuevo-domicilio-container').style.display = 'none';

    // Cargar domicilios del cliente
    await cargarDomiciliosCliente(presupuesto.id_cliente);

    // Mostrar modal
    abrirModal('modal-domicilios');
}

/**
 * Cerrar modal de domicilios
 */
function cerrarModalDomicilios() {
    cerrarModal('modal-domicilios');

    // Limpiar contexto
    modalDomiciliosContext = {
        presupuestoId: null,
        clienteId: null,
        clienteNombre: null
    };

    // Ocultar formulario
    document.getElementById('form-nuevo-domicilio-container').style.display = 'none';

    // Limpiar formulario
    document.getElementById('form-nuevo-domicilio').reset();
}

/**
 * Cargar domicilios del cliente
 */
async function cargarDomiciliosCliente(clienteId) {
    const container = document.getElementById('lista-domicilios');
    container.innerHTML = '<div class="loading">Cargando domicilios...</div>';

    try {
        const response = await fetch(`/api/logistica/domicilios?id_cliente=${clienteId}`);
        const result = await response.json();

        if (result.success) {
            const domicilios = result.data;

            if (domicilios.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: #64748b;">
                        <p style="font-size: 2rem; margin-bottom: 0.5rem;">📍</p>
                        <p>Este cliente no tiene domicilios registrados</p>
                        <p style="font-size: 0.875rem; margin-top: 0.5rem;">Agregue una nueva dirección para continuar</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = domicilios.map(domicilio => renderizarDomicilioItem(domicilio)).join('');

            console.log('[DOMICILIOS] Domicilios cargados:', domicilios.length);

        } else {
            throw new Error(result.error || 'Error al cargar domicilios');
        }
    } catch (error) {
        console.error('[DOMICILIOS] Error al cargar domicilios:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #ef4444;">
                <p>❌ Error al cargar domicilios</p>
                <p style="font-size: 0.875rem;">${error.message}</p>
            </div>
        `;
    }
}

/**
 * Renderizar item de domicilio
 */
function renderizarDomicilioItem(domicilio) {
    const tieneCoordenadas = domicilio.latitud && domicilio.longitud;
    const claseAdicional = !tieneCoordenadas ? 'sin-coordenadas' : '';

    return `
        <div class="domicilio-item ${claseAdicional}" data-id="${domicilio.id}">
            <div class="domicilio-header">
                <span class="domicilio-alias">${domicilio.alias || 'Sin alias'}</span>
                <div class="domicilio-badges">
                    ${domicilio.es_predeterminado ? '<span class="domicilio-badge badge-predeterminado">Predeterminado</span>' : ''}
                    ${tieneCoordenadas ?
            (domicilio.coordenadas_validadas ?
                '<span class="domicilio-badge badge-validado">✓ Validado</span>' :
                '<span class="domicilio-badge badge-sin-validar">⚠ Sin Validar</span>')
            : '<span class="domicilio-badge badge-sin-validar">⚠ Sin Coordenadas</span>'}
                </div>
            </div>
            <div class="domicilio-direccion">
                📍 ${domicilio.direccion || 'Sin dirección'}
            </div>
            <div class="domicilio-localidad">
                ${domicilio.localidad || ''} ${domicilio.provincia ? ', ' + domicilio.provincia : ''}
                ${domicilio.codigo_postal ? ' (CP: ' + domicilio.codigo_postal + ')' : ''}
            </div>
            ${domicilio.telefono_contacto ? `
                <div class="domicilio-telefono">
                    📞 ${domicilio.telefono_contacto}
                </div>
            ` : ''}
            ${domicilio.instrucciones_entrega ? `
                <div class="domicilio-instrucciones">
                    💡 ${domicilio.instrucciones_entrega}
                </div>
            ` : ''}
            <div class="domicilio-actions">
                <button class="btn-select" onclick="seleccionarDomicilio(${domicilio.id})">
                    Seleccionar
                </button>
                <button class="btn-edit" onclick="editarDomicilio(${domicilio.id})" title="Editar dirección">
                    ✏️
                </button>
                <button class="btn-delete" onclick="eliminarDomicilio(${domicilio.id})" title="Eliminar dirección" style="background: #ef4444; color: white; border: none; padding: 0.5rem 0.75rem; border-radius: 0.25rem; cursor: pointer;">
                    🗑️
                </button>
                ${!tieneCoordenadas ? `
                    <button class="btn-edit" onclick="geocodificarDomicilio(${domicilio.id})">
                        📍 Geocodificar
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Seleccionar domicilio y asignarlo al presupuesto
 */
async function seleccionarDomicilio(domicilioId) {
    const { presupuestoId } = modalDomiciliosContext;

    if (!presupuestoId) {
        mostrarError('Error: No se encontró el presupuesto');
        return;
    }

    try {
        const isRetiro = String(presupuestoId).startsWith('RT-');
        const cleanId = isRetiro ? String(presupuestoId).replace('RT-', '') : presupuestoId;
        const url = isRetiro 
            ? `/api/logistica/tratamientos/${cleanId}/domicilio`
            : `/api/logistica/presupuestos/${presupuestoId}/domicilio`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_domicilio_entrega: domicilioId })
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito('Domicilio asignado correctamente');
            cerrarModalDomicilios();

            // Recargar pedidos para actualizar la UI
            await cargarPedidos();

        } else {
            throw new Error(result.error || 'Error al asignar domicilio');
        }
    } catch (error) {
        console.error('[DOMICILIOS] Error al asignar domicilio:', error);
        mostrarError('Error al asignar domicilio: ' + error.message);
    }
}

/**
 * Editar domicilio existente
 */
async function editarDomicilio(domicilioId) {
    try {
        // Obtener datos del domicilio
        const response = await fetch(`/api/logistica/domicilios?id_cliente=${modalDomiciliosContext.clienteId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error('Error al cargar domicilio');
        }

        const domicilio = result.data.find(d => d.id === domicilioId);
        if (!domicilio) {
            throw new Error('Domicilio no encontrado');
        }

        // Marcar que estamos editando
        modalDomiciliosContext.domicilioEditando = domicilioId;

        // Mostrar formulario
        await mostrarFormNuevoDomicilio();

        // Pre-cargar datos en el formulario
        document.getElementById('nuevo-alias').value = domicilio.alias || '';
        document.getElementById('nuevo-direccion').value = domicilio.direccion || '';
        document.getElementById('nuevo-localidad').value = domicilio.localidad || '';
        document.getElementById('nuevo-provincia').value = domicilio.provincia || '';
        document.getElementById('nuevo-codigo-postal').value = domicilio.codigo_postal || '';
        document.getElementById('nuevo-telefono').value = domicilio.telefono_contacto || '';
        document.getElementById('nuevo-instrucciones').value = domicilio.instrucciones_entrega || '';

        // Si tiene coordenadas, posicionar el marcador
        if (domicilio.latitud && domicilio.longitud) {
            const lat = parseFloat(domicilio.latitud);
            const lng = parseFloat(domicilio.longitud);

            // Actualizar campos ocultos
            document.getElementById('nuevo-latitud').value = lat;
            document.getElementById('nuevo-longitud').value = lng;

            // Actualizar display
            document.getElementById('coordenadas-display').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

            // Posicionar marcador en el mapa
            if (modalDomiciliosContext.mapaInteractivo) {
                modalDomiciliosContext.mapaInteractivo.posicionarMarcador(lat, lng);
            }
        }

        // Cambiar título del formulario
        const tituloForm = document.querySelector('#form-nuevo-domicilio-container h3');
        if (tituloForm) {
            tituloForm.textContent = 'Editar Dirección';
        }

        console.log('[DOMICILIOS] Editando domicilio:', domicilioId);

    } catch (error) {
        console.error('[DOMICILIOS] Error al editar:', error);
        mostrarError('Error al cargar domicilio: ' + error.message);
    }
}

/**
 * Eliminar domicilio
 */
async function eliminarDomicilio(domicilioId) {
    if (!confirm('¿Está seguro de eliminar esta dirección?')) {
        return;
    }

    try {
        const response = await fetch(`/api/logistica/domicilios/${domicilioId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito('Dirección eliminada correctamente');
            await cargarDomiciliosCliente(modalDomiciliosContext.clienteId);
        } else {
            throw new Error(result.error || 'Error al eliminar');
        }
    } catch (error) {
        console.error('[DOMICILIOS] Error al eliminar:', error);
        mostrarError('Error al eliminar dirección: ' + error.message);
    }
}

/**
 * Mostrar formulario de nuevo domicilio
 */
async function mostrarFormNuevoDomicilio() {
    const container = document.getElementById('form-nuevo-domicilio-container');
    container.style.display = 'block';

    // Restaurar título si estaba editando
    const tituloForm = document.querySelector('#form-nuevo-domicilio-container h3');
    if (tituloForm && !modalDomiciliosContext.domicilioEditando) {
        tituloForm.textContent = 'Nueva Dirección';
    }

    // Scroll al formulario
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Inicializar mapa interactivo
    try {
        if (!modalDomiciliosContext.mapaInteractivo) {
            modalDomiciliosContext.mapaInteractivo = new MapaInteractivo();
        }

        // Inicializar mapa (La Plata por defecto)
        await modalDomiciliosContext.mapaInteractivo.inicializar('mapa-nuevo-domicilio', {
            lat: -34.9214,
            lng: -57.9545,
            zoom: 15
        });

        // Configurar callbacks
        modalDomiciliosContext.mapaInteractivo.onCoordenadasChange = (lat, lng) => {
            // Actualizar campos ocultos
            document.getElementById('nuevo-latitud').value = lat;
            document.getElementById('nuevo-longitud').value = lng;

            // Actualizar display
            document.getElementById('coordenadas-display').textContent =
                `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        };

        modalDomiciliosContext.mapaInteractivo.onDireccionChange = (direccion) => {
            // Autocompletar campos del formulario
            const calleCompleta = direccion.calle && direccion.numero ?
                `${direccion.calle} ${direccion.numero}` :
                direccion.calle || direccion.direccion_completa || '';

            document.getElementById('nuevo-direccion').value = calleCompleta;
            document.getElementById('nuevo-localidad').value = direccion.localidad || '';
            document.getElementById('nuevo-provincia').value = direccion.provincia || '';
            document.getElementById('nuevo-codigo-postal').value = direccion.codigo_postal || '';

            console.log('[MAPA] Campos autocompletados desde reverse geocoding');
        };

        console.log('[DOMICILIOS] Mapa interactivo inicializado');

    } catch (error) {
        console.error('[DOMICILIOS] Error al inicializar mapa:', error);
        mostrarError('Error al cargar el mapa. Verifique la configuración de Google Maps API.');
    }

    // Focus en primer campo
    document.getElementById('nuevo-alias').focus();
}

/**
 * Cancelar nuevo domicilio
 */
function cancelarNuevoDomicilio() {
    document.getElementById('form-nuevo-domicilio-container').style.display = 'none';
    document.getElementById('form-nuevo-domicilio').reset();

    // Limpiar modo edición
    modalDomiciliosContext.domicilioEditando = null;

    // Destruir mapa para liberar recursos
    if (modalDomiciliosContext.mapaInteractivo) {
        modalDomiciliosContext.mapaInteractivo.destruir();
        modalDomiciliosContext.mapaInteractivo = null;
    }

    // Limpiar display de coordenadas
    document.getElementById('coordenadas-display').textContent = 'Selecciona una ubicación en el mapa';
}

/**
 * Guardar nuevo domicilio
 */
async function guardarNuevoDomicilio(event) {
    event.preventDefault();

    const { clienteId } = modalDomiciliosContext;

    if (!clienteId) {
        mostrarError('Error: No se encontró el cliente');
        return;
    }

    // Obtener coordenadas del mapa
    const latitud = document.getElementById('nuevo-latitud').value;
    const longitud = document.getElementById('nuevo-longitud').value;

    if (!latitud || !longitud) {
        mostrarError('Debe seleccionar una ubicación en el mapa');
        return;
    }

    const formData = {
        id_cliente: clienteId,
        alias: document.getElementById('nuevo-alias').value,
        direccion: document.getElementById('nuevo-direccion').value || 'Dirección desde mapa',
        localidad: document.getElementById('nuevo-localidad').value || '',
        provincia: document.getElementById('nuevo-provincia').value || '',
        codigo_postal: document.getElementById('nuevo-codigo-postal').value || null,
        telefono_contacto: document.getElementById('nuevo-telefono').value || null,
        instrucciones_entrega: document.getElementById('nuevo-instrucciones').value || null,
        latitud: parseFloat(latitud),
        longitud: parseFloat(longitud),
        coordenadas_validadas: true
    };

    try {
        const esEdicion = modalDomiciliosContext.domicilioEditando !== null &&
            modalDomiciliosContext.domicilioEditando !== undefined;

        // Validar ID en modo edición
        if (esEdicion && !modalDomiciliosContext.domicilioEditando) {
            throw new Error('ID de domicilio inválido para edición');
        }

        // Crear o actualizar domicilio
        const url = esEdicion
            ? `/api/logistica/domicilios/${modalDomiciliosContext.domicilioEditando}`
            : '/api/logistica/domicilios';

        const method = esEdicion ? 'PUT' : 'POST';

        console.log('[DOMICILIOS] Guardando domicilio:', { esEdicion, url, method });

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || `Error al ${esEdicion ? 'actualizar' : 'crear'} domicilio`);
        }

        const domicilioId = esEdicion ? modalDomiciliosContext.domicilioEditando : result.data.id;
        console.log(`[DOMICILIOS] Domicilio ${esEdicion ? 'actualizado' : 'creado'}:`, domicilioId);

        // Recargar lista de domicilios
        await cargarDomiciliosCliente(clienteId);

        // Ocultar formulario
        cancelarNuevoDomicilio();

        // Auto-seleccionar el domicilio (solo si es nuevo)
        if (!esEdicion) {
            await seleccionarDomicilio(domicilioId);
        }

        mostrarExito(`Domicilio ${esEdicion ? 'actualizado' : 'creado y asignado'} correctamente`);

    } catch (error) {
        console.error('[DOMICILIOS] Error al guardar domicilio:', error);
        mostrarError('Error al guardar domicilio: ' + error.message);
    }
}

/**
 * Geocodificar domicilio
 */
async function geocodificarDomicilio(domicilioId, mostrarMensaje = true) {
    try {
        const response = await fetch(`/api/logistica/domicilios/${domicilioId}/geocode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (result.success) {
            if (mostrarMensaje) {
                mostrarExito('Domicilio geocodificado correctamente');
            }

            // Recargar lista
            await cargarDomiciliosCliente(modalDomiciliosContext.clienteId);

            console.log('[DOMICILIOS] Geocodificado:', result.data);

        } else {
            throw new Error(result.error || 'Error al geocodificar');
        }
    } catch (error) {
        console.error('[DOMICILIOS] Error al geocodificar:', error);
        if (mostrarMensaje) {
            mostrarError('Error al geocodificar: ' + error.message);
        }
        throw error;
    }
}

// ===== ACCESO RÁPIDO CON QR =====

/**
 * Generar QR de acceso rápido para chofer
 */
async function generarQRAcceso(rutaId) {
    console.log('[QR] Generando QR de acceso para ruta:', rutaId);

    try {
        // Obtener detalles completos de la ruta
        const responseRuta = await fetch(`/api/logistica/rutas/${rutaId}`);
        const resultRuta = await responseRuta.json();

        if (!resultRuta.success) {
            throw new Error('Error al cargar datos de la ruta');
        }

        const ruta = resultRuta.data;

        if (!ruta.id_chofer) {
            mostrarError('Esta ruta no tiene chofer asignado');
            return;
        }

        // Obtener datos del chofer (usuario y contraseña)
        const responseChofer = await fetch(`/api/logistica/usuarios/${ruta.id_chofer}`);
        const resultChofer = await responseChofer.json();

        if (!resultChofer.success) {
            throw new Error('Error al cargar datos del chofer');
        }

        const chofer = resultChofer.data;

        // Obtener configuración central del servidor
        const config = await obtenerConfiguracion();

        // URL Base de IP Pública Directa configurada en .env
        const baseUrl = config.publicBaseUrl || window.location.origin;
        console.log('[QR] Usando IP Pública Directa desde configuración:', baseUrl);

        // Construir URL de autologin
        const urlAutologin = `${baseUrl}/public/mobile/index.html?u=${encodeURIComponent(chofer.usuario)}&p=${encodeURIComponent(chofer.contraseña)}&autologin=true`;

        console.log('[QR] URL generada:', urlAutologin.replace(/p=[^&]+/, 'p=***'));

        // Actualizar info del modal
        document.getElementById('qr-chofer-nombre').textContent = chofer.nombre_completo || chofer.usuario;
        document.getElementById('qr-ruta-nombre').textContent = ruta.nombre_ruta || `Ruta #${ruta.id}`;

        // Limpiar contenedor de QR
        const qrContainer = document.getElementById('qr-container');
        qrContainer.innerHTML = '';

        // Generar QR
        new QRCode(qrContainer, {
            text: urlAutologin,
            width: 256,
            height: 256,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        // Mostrar modal
        abrirModal('modal-qr-acceso');

        console.log('[QR] QR generado exitosamente');

    } catch (error) {
        console.error('[QR] Error al generar QR:', error);
        mostrarError('Error al generar QR: ' + error.message);
    }
}

/**
 * Obtener configuración (helper)
 */
async function obtenerConfiguracion() {
    try {
        const response = await fetch('/api/logistica/config');
        const result = await response.json();
        return result.success ? result.data : {};
    } catch (error) {
        console.error('[CONFIG] Error al obtener configuración:', error);
        return {};
    }
}

// ==========================================
// INTEGRACIONES EXTERNAS (LOMASOFT Y LAMDA)
// ==========================================

let LOMASOFT_CANDIDATAS = [];

window.buscarCandidatasLomasoft = async function(presupuestoId) {
    try {
        if (typeof Swal === 'undefined') {
            alert("Error: SweetAlert2 no está cargado. Se requiere recargar la página.");
            return;
        }

        Swal.fire({
            title: 'Buscando en Lomasoft...',
            text: 'Conectando con el ERP...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        // La API de presupuestos de Lomasoft corre en localhost:3003
        const LOMASOFT_URL = 'http://localhost:3003';
        const res = await fetch(`${LOMASOFT_URL}/api/presupuestos/${presupuestoId}/buscar-candidatas-lomasoft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
            throw new Error(json.message || 'Error en la consulta al túnel Lomasoft');
        }

        LOMASOFT_CANDIDATAS = json.data;

        if (!LOMASOFT_CANDIDATAS || LOMASOFT_CANDIDATAS.length === 0) {
            return Swal.fire('Sin resultados', 'Lomasoft no encontró facturas candidatas para este presupuesto.', 'info');
        }

        let tablaHtml = `
            <div style="max-height: 400px; overflow-y: auto;">
                <table class="table" style="width:100%; text-align:left; border-collapse: collapse; font-size: 0.9em;">
                    <thead>
                        <tr style="border-bottom: 2px solid #ccc;">
                            <th>Comprobante</th>
                            <th>Fecha</th>
                            <th>Total</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        LOMASOFT_CANDIDATAS.forEach((candidata, index) => {
            const numeroFormateado = candidata.comprobante_formateado || 'S/N';
            const importe = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(candidata.importe_total);
            const artsResumen = (candidata.articulos || []).map(a => `${a.cantidad}x ${a.nombre}`).join(' | ');

            let botonHtml = '';
            if (candidata.ya_conciliada) {
                const titleText = candidata.id_presupuesto_local ? `Usado en Presup. #${candidata.id_presupuesto_local}` : 'Ya vinculado';
                botonHtml = `
                    <button class="btn btn-sm" disabled style="background-color: #7f8c8d; border: none; padding: 5px 10px; color: white; border-radius: 4px; cursor: not-allowed; opacity: 0.6;" title="${titleText}">
                        Ya vinculado
                    </button>
                `;
            } else {
                botonHtml = `
                    <button class="btn btn-sm btn-primary" style="background-color: #8e44ad; border: none; padding: 5px 10px; color: white; border-radius: 4px; cursor: pointer;" onclick="seleccionarCandidataLomasoft(${presupuestoId}, ${index})">
                        Seleccionar
                    </button>
                `;
            }

            tablaHtml += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td title="${artsResumen}"><strong>${numeroFormateado}</strong><br><small style="color:#666">${candidata.tipo_comprobante}</small></td>
                    <td>${new Date(candidata.fecha).toLocaleDateString('es-AR')}</td>
                    <td>${importe}</td>
                    <td style="padding: 8px 0;">
                        ${botonHtml}
                    </td>
                </tr>
            `;
        });

        tablaHtml += `</tbody></table></div>`;

        Swal.fire({
            title: 'Facturas Candidatas (Lomasoft)',
            html: tablaHtml,
            width: '600px',
            showConfirmButton: false,
            showCloseButton: true
        });

    } catch (error) {
        console.error("Error Lomasoft:", error);
        Swal.fire('Error', error.message, 'error');
    }
}

window.seleccionarCandidataLomasoft = async function(presupuestoId, candidataIndex) {
    const seleccionada = LOMASOFT_CANDIDATAS[candidataIndex];
    if (!seleccionada) return;

    try {
        Swal.fire({
            title: 'Confirmando conciliación...',
            text: 'Vinculando presupuesto con la factura de Lomasoft...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const payload = {
            codigo: seleccionada.codigo,
            punto_venta: seleccionada.punto_venta,
            comprobante_formateado: seleccionada.comprobante_formateado
        };

        const LOMASOFT_URL = 'http://localhost:3003';
        const response = await fetch(`${LOMASOFT_URL}/api/presupuestos/${presupuestoId}/confirmar-conciliacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await response.json();

        if (!response.ok || !json.success) {
            throw new Error(json.message || 'Error al guardar la conciliación en el servidor');
        }

        await Swal.fire({
            title: '¡Conciliado!',
            text: `El pedido se vinculó exitosamente a la factura ${seleccionada.comprobante_formateado}.`,
            icon: 'success',
            timer: 2500,
            showConfirmButton: false
        });

        // REFRESCAR VISTAS PARA ACTUALIZAR BADGES 
        // (asumiendo que los métodos devuelven promise y repintan)
        if (typeof cargarPedidos === 'function') cargarPedidos();
        if (typeof cargarRutas === 'function') cargarRutas();

    } catch (error) {
        console.error("Error Lomasoft Conciliación:", error);
        Swal.fire('Error al conciliar', error.message, 'error');
    }
}

// =====================================================================
// MÓDULO CHECK-IN CONTINGENTE (PC Dashboard) - FASE 3
// =====================================================================

window.abrirModalContingencia = async function(hash, esEdicion) {
    const modal = document.getElementById('modal-contingencia-checkin');
    if (!modal) { console.error('[DASHBOARD] No existe modal-contingencia-checkin en el DOM'); return; }

    const form = document.getElementById('form-contingencia-checkin');
    form.reset();
    document.getElementById('checkin-hash').value = hash;

    // Set default datetime to now
    const ahora = new Date();
    ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
    document.getElementById('checkin-fecha').value = ahora.toISOString().slice(0,16);

    // Populate chofer dropdown from already-loaded state
    const selectChofer = document.getElementById('checkin-chofer-nombre');
    if (state.choferes && state.choferes.length > 0) {
        selectChofer.innerHTML = '<option value="">Seleccione Chofer</option>' +
            state.choferes.map(c => `<option value="${c.nombre_completo}">${c.nombre_completo}</option>`).join('');
    }

    // If editing an existing check-in, prefill with saved data
    if (esEdicion) {
        try {
            const res = await fetch(`/api/logistica/tratamientos/sesion/${hash}`);
            const data = await res.json();
            if (data.success && data.data) {
                const d = data.data;
                const det = d.detalles || {};
                document.getElementById('checkin-descripcion').value = det.descripcion_externa || '';
                document.getElementById('checkin-kilos').value = det.kilos || '';
                document.getElementById('checkin-bultos').value = det.bultos || '';
                document.getElementById('checkin-motivo').value = det.motivo || '';
                document.getElementById('checkin-responsable-nombre').value = d.responsable_nombre || '';
                document.getElementById('checkin-responsable-apellido').value = d.responsable_apellido || '';
                document.getElementById('checkin-responsable-celular').value = d.responsable_celular || '';
                // Set chofer in dropdown
                if (d.chofer_nombre) selectChofer.value = d.chofer_nombre;
                // Set datetime
                if (d.fecha_validacion_chofer) {
                    const fd = new Date(d.fecha_validacion_chofer);
                    fd.setMinutes(fd.getMinutes() - fd.getTimezoneOffset());
                    document.getElementById('checkin-fecha').value = fd.toISOString().slice(0,16);
                }
            }
        } catch(e) {
            console.error('[DASHBOARD] Error al cargar datos del check-in:', e);
        }
    }

    modal.style.display = 'flex';
};

window.cerrarModalContingencia = function() {
    const modal = document.getElementById('modal-contingencia-checkin');
    if (modal) modal.style.display = 'none';
};

window.guardarCheckinContingencia = async function(event) {
    event.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-contingencia');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    const hash = document.getElementById('checkin-hash').value;

    const kilosRaw = document.getElementById('checkin-kilos').value.trim();
    const kilosVal = parseFloat(kilosRaw.replace(',', '.'));
    const bultosVal = parseInt(document.getElementById('checkin-bultos').value);
    const responsableNombre = document.getElementById('checkin-responsable-nombre').value.trim();

    if (!responsableNombre) {
        Swal.fire('Campo Obligatorio', 'El Nombre del Responsable es obligatorio para la trazabilidad.', 'warning');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
        return;
    }
    if (isNaN(kilosVal) || kilosVal <= 0) {
        Swal.fire('Atención', 'Los Kilos deben ser un valor numérico mayor a 0', 'warning');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
        return;
    }

    const payload = {
        descripcion_externa: document.getElementById('checkin-descripcion').value.trim(),
        kilos: kilosVal,
        bultos: bultosVal,
        motivo: document.getElementById('checkin-motivo').value.trim(),
        responsable_nombre: responsableNombre,
        responsable_apellido: document.getElementById('checkin-responsable-apellido').value.trim(),
        responsable_celular: document.getElementById('checkin-responsable-celular').value.trim(),
        chofer_nombre: document.getElementById('checkin-chofer-nombre').value.trim(),
        fecha_evento: document.getElementById('checkin-fecha').value
    };

    try {
        const res = await fetch(`/api/logistica/tratamientos/dashboard/checkin/${hash}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            window.cerrarModalContingencia();
            Swal.fire('✅ Check-in Guardado', 'La trazabilidad fue registrada exitosamente.', 'success');
            await cargarPedidos();
            await cargarRutas();
        } else {
            throw new Error(data.error || 'Error al guardar check-in');
        }
    } catch(e) {
        Swal.fire('Error', e.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
    }
};

window.imprimirEtiquetaLamda = async function() {
    const datos = {
        textoPrincipal: 'LAMDA',
        textoSecundario: '221-6615746',
        textoAdicional: ''
    };
    
    // Asumimos cantidad 1 por defecto al imprimir rapido desde modulo logística
    const cantidad = 1;

    try {
        // La API de etiquetas corre en localhost:3000
        const res = await fetch('http://localhost:3000/api/imprimir-personalizada', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ datos, cantidad }),
        });
        
        const data = await res.json();
        if (res.ok) {
            if (typeof Swal !== 'undefined') {
                Swal.fire('Éxito', "Etiqueta LAMDA enviada a impresora", 'success');
            } else {
                alert("Etiqueta LAMDA enviada a impresora");
            }
        } else {
            console.error('Error al imprimir:', data.error);
            if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'No se pudo contactar al servidor LAMDA Impresiones: ' + data.error, 'error');
            } else {
                alert('Error al imprimir: ' + data.error);
            }
        }
    } catch (error) {
        console.error('Error al pedir impresión:', error.message);
        if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Impresora App-Etiquetas fuera de linea: ' + error.message, 'error');
        } else {
            alert('Error al imprimir: ' + error.message);
        }
    }
}

/**
 * Lógica de Tramos de Navegación Dinámicos (Batching)
 * Réplica de la funcionalidad de la PWA para el PC
 */
window.abrirTramoGoogleMaps = function(index, destinosJson) {
    const tramo = JSON.parse(decodeURIComponent(destinosJson));
    if (tramo.length === 0) return;
    
    if (index === 0) {
        const abrirConOrigen = (origenStr) => {
            let destino = `${tramo[tramo.length - 1].lat},${tramo[tramo.length - 1].lng}`;
            let waypointsArr = tramo.slice(0, tramo.length - 1);
            let url = `https://www.google.com/maps/dir/?api=1&destination=${destino}`;
            if (origenStr) url += `&origin=${origenStr}`;
            if (waypointsArr.length > 0) url += `&waypoints=${waypointsArr.map(p => `${p.lat},${p.lng}`).join('|')}`;
            window.open(url, '_blank');
        };

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => abrirConOrigen(`${pos.coords.latitude},${pos.coords.longitude}`),
                (err) => abrirConOrigen(''),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        } else {
            abrirConOrigen('');
        }
    } else {
        let origen = `${tramo[0].lat},${tramo[0].lng}`;
        let destino = `${tramo[tramo.length - 1].lat},${tramo[tramo.length - 1].lng}`;
        let waypointsArr = tramo.slice(1, tramo.length - 1);
        let url = `https://www.google.com/maps/dir/?api=1&destination=${destino}&origin=${origen}`;
        if (waypointsArr.length > 0) {
            url += `&waypoints=${waypointsArr.map(p => `${p.lat},${p.lng}`).join('|')}`;
        }
        window.open(url, '_blank');
    }
};
