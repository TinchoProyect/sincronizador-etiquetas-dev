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
    markers: []
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
            state.pedidos = result.data;
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
 * Cargar rutas del día
 */
async function cargarRutas() {
    try {
        const response = await fetch('/api/logistica/rutas');
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
function renderizarPedidos() {
    const container = document.getElementById('pedidos-list');
    
    if (!state.pedidos || state.pedidos.length === 0) {
        container.innerHTML = '<div class="loading">No hay pedidos disponibles</div>';
        return;
    }
    
    container.innerHTML = state.pedidos.map(pedido => {
        const tieneDomicilio = pedido.id_domicilio_entrega && pedido.domicilio_direccion;
        const pedidoJson = JSON.stringify(pedido).replace(/'/g, "\\'");
        
        return `
            <div class="pedido-card" 
                 draggable="true" 
                 data-id="${pedido.id}"
                 data-pedido='${pedidoJson}'
                 ondragstart="handleDragStart(event)" 
                 ondragend="handleDragEnd(event)"
                 oncontextmenu="mostrarMenuContextual(event, ${pedido.id})">
                
                <!-- Indicador visual de domicilio -->
                <div class="pedido-domicilio-indicator ${tieneDomicilio ? 'tiene-domicilio' : ''}" 
                     title="${tieneDomicilio ? 'Tiene domicilio asignado' : 'Sin domicilio asignado'}">
                </div>
                
                <div class="pedido-header">
                    <span class="pedido-numero">#${pedido.id}</span>
                    <span class="pedido-badge badge-${pedido.estado_logistico?.toLowerCase() || 'pendiente'}">
                        ${pedido.estado_logistico || 'PENDIENTE'}
                    </span>
                </div>
                <div class="pedido-cliente">
                    👤 ${pedido.cliente_nombre || 'Cliente sin nombre'}
                </div>
                <div class="pedido-direccion">
                    📍 ${pedido.domicilio_direccion || 'Sin dirección asignada'}
                </div>
                ${pedido.total ? `<div class="pedido-monto">💰 $${parseFloat(pedido.total).toFixed(2)}</div>` : ''}
                ${pedido.bloqueo_entrega ? '<div class="pedido-badge badge-bloqueado">🔒 Bloqueado</div>' : ''}
            </div>
        `;
    }).join('');
}

/**
 * Renderizar lista de rutas
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
    
    container.innerHTML = rutasConDetalles.map(ruta => {
        // Generar lista de pedidos
        let pedidosHTML = '';
        if (ruta.presupuestos && ruta.presupuestos.length > 0) {
            const rutaId = ruta.id;
            const esArmando = ruta.estado === 'ARMANDO';
            
            pedidosHTML = `
                <div class="ruta-pedidos-lista" 
                     id="pedidos-ruta-${rutaId}" 
                     data-ruta-id="${rutaId}"
                     style="margin-top: 0.75rem; font-size: 0.75rem;">
                    ${ruta.presupuestos.map((p, index) => `
                        <div class="ruta-pedido-item ${esArmando ? 'sortable' : ''}" 
                             data-presupuesto-id="${p.id}"
                             draggable="${esArmando}"
                             ondragstart="${esArmando ? 'handlePedidoDragStart(event)' : ''}"
                             ondragover="${esArmando ? 'handlePedidoDragOver(event)' : ''}"
                             ondrop="${esArmando ? 'handlePedidoDrop(event, ' + rutaId + ')' : ''}"
                             ondragend="${esArmando ? 'handlePedidoDragEnd(event)' : ''}"
                             style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem; border-bottom: 1px solid #e2e8f0; ${esArmando ? 'cursor: move;' : ''}">
                            ${esArmando ? '<span style="color: #94a3b8; cursor: move;">⋮⋮</span>' : ''}
                            <span style="font-weight: bold; color: #2563eb; min-width: 1.5rem;">${index + 1}.</span>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    #${p.id} - ${p.cliente_nombre || 'Sin nombre'}
                                </div>
                                <div style="color: #64748b; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    📍 ${p.domicilio_direccion || 'Sin dirección'}
                                </div>
                            </div>
                            ${esArmando ? `
                                <button class="btn-icon-danger" 
                                        onclick="event.stopPropagation(); quitarPedidoDeRuta(${rutaId}, ${p.id})"
                                        title="Quitar de la ruta"
                                        style="padding: 0.25rem 0.5rem; font-size: 0.875rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; cursor: pointer;">
                                    🗑️
                                </button>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
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
                        <div class="ruta-stat-value">${ruta.estado || 'ARMANDO'}</div>
                        <div class="ruta-stat-label">Estado</div>
                    </div>
                </div>
                ${pedidosHTML}
                <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
                    <button class="btn-secondary" style="flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                            onclick="event.stopPropagation(); verDetallesRuta(${ruta.id})">
                        Ver en Mapa
                    </button>
                    ${ruta.estado === 'ARMANDO' ? `
                        <button class="btn-primary" style="flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem;" 
                                onclick="event.stopPropagation(); iniciarRuta(${ruta.id})">
                            Iniciar Ruta
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
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
    const searchTerm = document.getElementById('search-pedidos')?.value.toLowerCase() || '';
    const estadoFilter = document.getElementById('filter-estado')?.value || '';
    const zonaFilter = document.getElementById('filter-zona')?.value || '';
    
    const pedidosFiltrados = state.pedidos.filter(pedido => {
        const matchSearch = !searchTerm || 
            pedido.id.toString().includes(searchTerm) ||
            (pedido.cliente_nombre || '').toLowerCase().includes(searchTerm);
        
        const matchEstado = !estadoFilter || pedido.estado_logistico === estadoFilter;
        
        // TODO: Implementar filtro por zona cuando esté disponible
        const matchZona = !zonaFilter;
        
        return matchSearch && matchEstado && matchZona;
    });
    
    // Renderizar pedidos filtrados
    const container = document.getElementById('pedidos-list');
    if (pedidosFiltrados.length === 0) {
        container.innerHTML = '<div class="loading">No se encontraron pedidos</div>';
        return;
    }
    
    container.innerHTML = pedidosFiltrados.map(pedido => `
        <div class="pedido-card" draggable="true" data-id="${pedido.id}" 
             ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)">
            <div class="pedido-header">
                <span class="pedido-numero">#${pedido.id}</span>
                <span class="pedido-badge badge-${pedido.estado_logistico?.toLowerCase() || 'pendiente'}">
                    ${pedido.estado_logistico || 'PENDIENTE'}
                </span>
            </div>
            <div class="pedido-cliente">
                👤 ${pedido.cliente_nombre || 'Cliente sin nombre'}
            </div>
            <div class="pedido-direccion">
                📍 ${pedido.domicilio_direccion || 'Sin dirección'}
            </div>
            ${pedido.total ? `<div class="pedido-monto">💰 $${parseFloat(pedido.total).toFixed(2)}</div>` : ''}
        </div>
    `).join('');
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
    // TODO: Implementar filtro de rutas por fecha
    console.log('[DASHBOARD] Filtrar rutas');
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
                
                // Generar HTML con lista de pedidos
                let pedidosHTML = '';
                if (ruta.presupuestos && ruta.presupuestos.length > 0) {
                    pedidosHTML = '<div style="margin-top: 1rem;"><strong>Pedidos en ruta:</strong><ol style="margin: 0.5rem 0; padding-left: 1.5rem;">';
                    ruta.presupuestos.forEach((p, index) => {
                        pedidosHTML += `
                            <li style="margin: 0.25rem 0;">
                                <strong>#${p.id}</strong> - ${p.cliente_nombre || 'Sin nombre'}
                                <br><small style="color: #64748b;">📍 ${p.domicilio_direccion || 'Sin dirección'}</small>
                            </li>
                        `;
                    });
                    pedidosHTML += '</ol></div>';
                }
                
                detallesDiv.innerHTML = `
                    <p><strong>Nombre:</strong> ${ruta.nombre_ruta}</p>
                    <p><strong>Chofer:</strong> ${ruta.chofer_nombre || 'Sin asignar'}</p>
                    <p><strong>Estado:</strong> ${ruta.estado}</p>
                    <p><strong>Pedidos:</strong> ${ruta.presupuestos?.length || 0}</p>
                    <p><strong>Fecha Salida:</strong> ${new Date(ruta.fecha_salida).toLocaleString()}</p>
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
    
    // Crear marcador para cada presupuesto
    ruta.presupuestos.forEach((presupuesto, index) => {
        if (!presupuesto.latitud || !presupuesto.longitud) {
            console.warn(`[DASHBOARD] Presupuesto ${presupuesto.id} sin coordenadas`);
            return;
        }
        
        const position = {
            lat: parseFloat(presupuesto.latitud),
            lng: parseFloat(presupuesto.longitud)
        };
        
        // Crear marcador con número de orden
        const marker = new google.maps.Marker({
            position: position,
            map: state.map,
            title: `${index + 1}. ${presupuesto.cliente_nombre}`,
            label: {
                text: `${index + 1}`,
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold'
            },
            animation: google.maps.Animation.DROP
        });
        
        // Info window con detalles
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="padding: 0.5rem;">
                    <strong>Parada ${index + 1}</strong><br>
                    <strong>Pedido #${presupuesto.id}</strong><br>
                    Cliente: ${presupuesto.cliente_nombre || 'Sin nombre'}<br>
                    Dirección: ${presupuesto.domicilio_direccion || 'Sin dirección'}<br>
                    ${presupuesto.total ? `Monto: $${parseFloat(presupuesto.total).toFixed(2)}` : ''}
                </div>
            `
        });
        
        marker.addListener('click', () => {
            infoWindow.open(state.map, marker);
        });
        
        state.markers.push(marker);
        bounds.extend(position);
        marcadoresCreados++;
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
    // Validar que la ruta esté vacía
    if (cantidadPedidos > 0) {
        mostrarError('La ruta tiene pedidos asignados. Quítelos antes de eliminarla.');
        return;
    }
    
    if (!confirm('¿Está seguro de eliminar esta ruta?')) {
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
    if (!confirm('¿Está seguro de iniciar esta ruta? No podrá agregar más pedidos.')) {
        return;
    }
    
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
        } else {
            throw new Error(result.error || 'Error al iniciar ruta');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al iniciar ruta:', error);
        mostrarError('Error al iniciar ruta: ' + error.message);
    }
}

// ===== DRAG & DROP PEDIDOS A RUTAS =====

let draggedPedidoId = null;

function handleDragStart(event) {
    draggedPedidoId = event.target.dataset.id;
    event.target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(event) {
    event.target.classList.remove('dragging');
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

async function handleDrop(event, rutaId) {
    event.preventDefault();
    
    if (!draggedPedidoId) return;
    
    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/asignar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids_presupuestos: [parseInt(draggedPedidoId)] })
        });
        
        const result = await response.json();
        
        if (result.success) {
            mostrarExito('Pedido asignado exitosamente');
            await Promise.all([cargarPedidos(), cargarRutas()]);
        } else {
            throw new Error(result.error || 'Error al asignar pedido');
        }
    } catch (error) {
        console.error('[DASHBOARD] Error al asignar pedido:', error);
        mostrarError('Error al asignar pedido: ' + error.message);
    } finally {
        draggedPedidoId = null;
    }
}

// ===== DRAG & DROP REORDENAR PEDIDOS EN RUTA =====

let draggedPedidoEnRuta = null;

function handlePedidoDragStart(event) {
    draggedPedidoEnRuta = {
        presupuestoId: parseInt(event.currentTarget.dataset.presupuestoId),
        element: event.currentTarget
    };
    event.currentTarget.style.opacity = '0.5';
    event.dataTransfer.effectAllowed = 'move';
}

function handlePedidoDragEnd(event) {
    event.currentTarget.style.opacity = '1';
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
    
    const targetPresupuestoId = parseInt(dropTarget.dataset.presupuestoId);
    
    if (draggedPedidoEnRuta.presupuestoId === targetPresupuestoId) return;
    
    // Obtener lista actual
    const container = document.getElementById(`pedidos-ruta-${rutaId}`);
    const items = Array.from(container.querySelectorAll('.ruta-pedido-item'));
    
    // Obtener IDs en orden actual
    const ordenActual = items.map(item => parseInt(item.dataset.presupuestoId));
    
    // Calcular nuevo orden
    const draggedIndex = ordenActual.indexOf(draggedPedidoEnRuta.presupuestoId);
    const targetIndex = ordenActual.indexOf(targetPresupuestoId);
    
    // Reordenar array
    ordenActual.splice(draggedIndex, 1);
    ordenActual.splice(targetIndex, 0, draggedPedidoEnRuta.presupuestoId);
    
    console.log('[REORDEN] Nuevo orden:', ordenActual);
    
    // Enviar al backend
    try {
        const response = await fetch(`/api/logistica/rutas/${rutaId}/reordenar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: ordenActual })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Recargar rutas para actualizar UI
            await cargarRutas();
            
            // SIEMPRE actualizar el mapa si hay una ruta visible
            // Obtener datos actualizados de la ruta
            const responseRuta = await fetch(`/api/logistica/rutas/${rutaId}`);
            const resultRuta = await responseRuta.json();
            
            if (resultRuta.success) {
                // Actualizar mapa con nuevo orden
                mostrarMarcadoresRuta(resultRuta.data);
                console.log('[REORDEN] Mapa actualizado con nuevo orden');
            }
        } else {
            throw new Error(result.error || 'Error al reordenar');
        }
    } catch (error) {
        console.error('[REORDEN] Error:', error);
        mostrarError('Error al reordenar: ' + error.message);
        // Recargar para restaurar orden original
        await cargarRutas();
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
        const response = await fetch(`/api/logistica/presupuestos/${presupuestoId}/domicilio`, {
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
        
        // Inicializar mapa (Tucumán por defecto)
        await modalDomiciliosContext.mapaInteractivo.inicializar('mapa-nuevo-domicilio', {
            lat: -26.8241,
            lng: -65.2226,
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
        const esEdicion = modalDomiciliosContext.domicilioEditando !== null;
        
        // Crear o actualizar domicilio
        const url = esEdicion 
            ? `/api/logistica/domicilios/${modalDomiciliosContext.domicilioEditando}`
            : '/api/logistica/domicilios';
        
        const method = esEdicion ? 'PUT' : 'POST';
        
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
