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

    // ORDENAMIENTO: Retiros primero, luego por fecha/id (implícito)
    const pedidosOrdenados = [...state.pedidos].sort((a, b) => {
        const aEsRetiro = a.estado === 'Orden de Retiro';
        const bEsRetiro = b.estado === 'Orden de Retiro';
        if (aEsRetiro && !bEsRetiro) return -1;
        if (!aEsRetiro && bEsRetiro) return 1;
        return 0;
    });

    container.innerHTML = pedidosOrdenados.map(pedido => {
        const tieneDomicilio = pedido.id_domicilio_entrega && pedido.domicilio_direccion;
        const pedidoJson = JSON.stringify(pedido).replace(/'/g, "\\'");
        const esRetiro = pedido.estado === 'Orden de Retiro';

        // Estilos específicos para Retiro
        const estiloCard = esRetiro
            ? 'border-left: 5px solid #d35400; background-color: #fdf2e9;'
            : '';

        const iconoCliente = esRetiro ? '🔙' : '👤'; // Icono distintivo

        // Fallbacks para edge cases (QA requirement)
        const clienteId = pedido.cliente_id || 'S/N';
        const clienteNombre = pedido.cliente_nombre || 'Cliente Desconocido';

        return `
            <div class="pedido-card ${esRetiro ? 'tipo-retiro' : ''}" 
                 draggable="true" 
                 data-id="${pedido.id}"
                 data-tipo="${esRetiro ? 'retiro' : 'venta'}"
                 data-pedido='${pedidoJson}'
                 ondragstart="handleDragStart(event)" 
                 ondragend="handleDragEnd(event)"
                 oncontextmenu="mostrarMenuContextual(event, ${pedido.id})"
                 style="${estiloCard}">
                
                <!-- Indicador visual de domicilio -->
                <div class="pedido-domicilio-indicator ${tieneDomicilio ? 'tiene-domicilio' : ''}" 
                     title="${tieneDomicilio ? 'Tiene domicilio asignado' : 'Sin domicilio asignado'}">
                </div>
                
                <!-- NUEVA JERARQUÍA: Cliente primero -->
                <div class="pedido-header">
                    <span class="pedido-cliente-id" style="font-size: 1.1rem; font-weight: 600; color: ${esRetiro ? '#d35400' : '#1e40af'};">
                        ${iconoCliente} ${esRetiro ? 'RETIRO' : 'Cliente'} #${clienteId}
                    </span>
                    <span class="pedido-badge badge-${pedido.estado_logistico?.toLowerCase() || 'pendiente'}">
                        ${pedido.estado_logistico || 'PENDIENTE'}
                    </span>
                </div>

                ${esRetiro ? `<div class="badge-retiro-visual" style="background: #e67e22; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; display: inline-block; margin-bottom: 4px; font-weight: bold;">🔙 ORDEN DE RETIRO</div>` : ''}

                <div class="pedido-cliente-nombre" style="font-weight: 600; margin-top: 0.25rem; color: #1e293b;">
                    ${clienteNombre}
                </div>
                <div class="pedido-numero-secundario" style="font-size: 0.875rem; color: #64748b; margin-top: 0.25rem;">
                    Pedido #${pedido.id} ${esRetiro ? '(Retiro)' : ''}
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
            const primerPedido = parada.presupuestos[0];

            // Fallbacks
            const clienteId = primerPedido.id_cliente || primerPedido.cliente_id || 'S/N';
            const clienteNombre = primerPedido.cliente_nombre || 'Cliente Desconocido';

            // DETECTAR SI ES RETIRO (O SI EL GRUPO CONTIENE UN RETIRO)
            // Asumimos que si agrupa por parada, todos son del mismo tipo o al menos mostramos estilo si el primero lo es.
            const esRetiro = primerPedido.estado === 'Orden de Retiro';

            // Estilos Austeros para Retiro en Ruta
            const estiloItem = esRetiro
                ? 'background-color: #fdf2e9; border-left: 4px solid #d35400;'
                : 'background-color: white;';
            const iconoCliente = esRetiro ? '🔙' : '👤';

            // Totales agrupados
            const totalMonto = parada.presupuestos.reduce((sum, p) => sum + parseFloat(p.total || 0), 0);
            const cantidadPedidos = parada.presupuestos.length;

            // Lista de IDs visual
            const listaIds = parada.presupuestos.map(p => `#${p.id}`).join(', ');

            return `
                    <div class="ruta-pedido-item ${esArmando ? 'sortable' : ''} ${esRetiro ? 'item-retiro' : ''}" 
                         data-presupuesto-ids='${idsPresupuestos}'
                         data-cliente-id="${clienteId}"
                         data-tipo="${esRetiro ? 'retiro' : 'venta'}"
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
                                <div style="font-weight: 600; color: ${esRetiro ? '#d35400' : '#1e40af'}; font-size: 0.8rem; background: ${esRetiro ? '#fae5d3' : '#dbeafe'}; padding: 0 0.25rem; border-radius: 0.25rem;">
                                    Cli #${clienteId}
                                </div>
                            </div>
                            
                            ${esRetiro ? '<div style="font-size: 0.7rem; font-weight: bold; color: #d35400; margin-top: 0.1rem;">🔙 RETIRO</div>' : ''}

                            <div style="color: #475569; font-size: 0.75rem; margin-top: 0.1rem;">
                                📍 ${primerPedido.domicilio_direccion || 'Sin dirección'}
                            </div>
                            
                            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem; align-items: center;">
                                <div style="color: #64748b; font-weight: 500;">
                                    ${esRetiro ? '↩️' : '📦'} ${cantidadPedidos > 1 ? 'Pedidos:' : 'Pedido:'} 
                                    <span style="color: #334155; font-weight: 600;">${listaIds} ${esRetiro ? '(Retiro)' : ''}</span>
                                </div>
                                ${totalMonto > 0 ? `
                                    <div style="color: #059669; font-weight: 600; font-size: 0.7rem;">
                                        💰 $${totalMonto.toFixed(2)}
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        ${esArmando ? `
                            <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                                ${parada.presupuestos.map(p => `
                                    <button class="btn-icon-danger" 
                                            onclick="event.stopPropagation(); quitarPedidoDeRuta(${rutaId}, ${p.id})"
                                            title="Quitar pedido #${p.id}"
                                            style="padding: 0.1rem 0.3rem; font-size: 0.7rem; background: #ef4444; color: white; border: none; border-radius: 0.25rem; cursor: pointer; opacity: 0.8;">
                                        🗑️ #${p.id}
                                    </button>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
        }).join('')}
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
        </div>
    `;
}

/**
 * Agrupar presupuestos por Cliente + Domicilio (lógica de Paradas)
 */
function agruparPresupuestosEnParadas(presupuestos) {
    if (!presupuestos || presupuestos.length === 0) return [];

    const paradas = [];
    const mapaParadas = new Map(); // Key: "idCliente_idDomicilio"

    presupuestos.forEach(p => {
        // Generar clave única de agrupación
        // IMPORTANTE: Si es distinta dirección pero mismo cliente -> Distinta parada
        const key = `${p.id_cliente}_${p.id_domicilio_entrega}`;

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

    // Importante: Mantener el orden relativo basado en el primer elemento de cada grupo
    // (Asumiendo que 'presupuestos' ya viene ordenado por secuencia)
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

    container.innerHTML = pedidosFiltrados.map(pedido => {
        const pedidoJson = JSON.stringify(pedido).replace(/'/g, "\\'");
        const tieneDomicilio = pedido.id_domicilio_entrega && pedido.domicilio_direccion;
        const clienteId = pedido.cliente_id || 'S/N';
        const clienteNombre = pedido.cliente_nombre || 'Cliente Desconocido';

        return `
        <div class="pedido-card" draggable="true" data-id="${pedido.id}" 
             data-pedido='${pedidoJson}'
             ondragstart="handleDragStart(event)" 
             ondragend="handleDragEnd(event)"
             oncontextmenu="mostrarMenuContextual(event, ${pedido.id})">
            
            <div class="pedido-domicilio-indicator ${tieneDomicilio ? 'tiene-domicilio' : ''}" 
                 title="${tieneDomicilio ? 'Tiene domicilio asignado' : 'Sin domicilio asignado'}">
            </div>

            <div class="pedido-header">
                <span class="pedido-cliente-id" style="font-size: 1.1rem; font-weight: 600; color: #1e40af;">
                    👤 Cliente #${clienteId}
                </span>
                <span class="pedido-badge badge-${pedido.estado_logistico?.toLowerCase() || 'pendiente'}">
                    ${pedido.estado_logistico || 'PENDIENTE'}
                </span>
            </div>
            <div class="pedido-cliente-nombre" style="font-weight: 600; margin-top: 0.25rem; color: #1e293b;">
                ${clienteNombre}
            </div>
            <div class="pedido-numero-secundario" style="font-size: 0.875rem; color: #64748b; margin-top: 0.25rem;">
                Pedido #${pedido.id}
            </div>
            <div class="pedido-direccion">
                📍 ${pedido.domicilio_direccion || 'Sin dirección'}
            </div>
            ${pedido.total ? `<div class="pedido-monto">💰 $${parseFloat(pedido.total).toFixed(2)}</div>` : ''}
            ${pedido.bloqueo_entrega ? '<div class="pedido-badge badge-bloqueado">🔒 Bloqueado</div>' : ''}
        </div>
    `}).join('');
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

                // Generar HTML con lista de pedidos (NUEVA JERARQUÍA: Cliente primero)
                let pedidosHTML = '';
                if (ruta.presupuestos && ruta.presupuestos.length > 0) {
                    pedidosHTML = '<div style="margin-top: 1rem;"><strong>Pedidos en ruta:</strong><ol style="margin: 0.5rem 0; padding-left: 1.5rem;">';
                    ruta.presupuestos.forEach((p, index) => {
                        // Fallbacks para edge cases (QA requirement)
                        // NOTA: El backend retorna 'id_cliente' (no 'cliente_id')
                        const clienteId = p.id_cliente || p.cliente_id || 'S/N';
                        const clienteNombre = p.cliente_nombre || 'Cliente Desconocido';

                        pedidosHTML += `
                            <li style="margin: 0.25rem 0;">
                                <strong style="color: #1e40af;">👤 Cliente #${clienteId}</strong> - ${clienteNombre}
                                <br><small style="color: #64748b;">Pedido #${p.id}</small>
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
        const response = await fetch(`/api/logistica/rutas/${rutaId}/asignar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids_presupuestos: [parseInt(draggedPedidoId)] })
        });

        const result = await response.json();

        if (result.success) {
            // Feedback contextual según el tipo (usando variable local segura)
            const mensaje = tipoPedidoActual === 'retiro'
                ? '✅ Orden de Retiro asignada exitosamente'
                : 'Pedido asignado exitosamente';

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