/**
 * Controlador Frontend para el Dashboard Dinámico de Demanda No Satisfecha
 * Conecta con el microservicio de Presupuestos (Puerto 3003 / Proxy 3000)
 */

let rawDashboardData = [];
let filtroActual = 'ConStock'; // 'ConStock', 'Pendiente', 'Cubierto', 'Desestimado', 'Todos'

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

// Calcula dinámicamente "Hace X días"
function calcularTiempoAtras(fechaIso) {
    if (!fechaIso) return 'Desconocido';
    const ahora = new Date();
    
    let fecha;
    if (typeof fechaIso === 'string' && fechaIso.length <= 10 && fechaIso.includes('-')) {
        const [y, m, d] = fechaIso.split('-');
        fecha = new Date(y, m - 1, d);
    } else {
        fecha = new Date(fechaIso);
    }
    
    const ahoraMedianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const fechaMedianoche = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    
    const diffTiempo = Math.abs(ahoraMedianoche - fechaMedianoche);
    const diffDias = Math.floor(diffTiempo / (1000 * 60 * 60 * 24)); 

    if (diffDias === 0) return 'Hoy';
    if (diffDias === 1) return 'Ayer';
    return `Hace ${diffDias} días`;
}

// Llama al microservicio backend con soporte de proxy y fallback
async function fetchDashboardData() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('dashboard-content').style.display = 'none';

    try {
        let response;
        try {
            response = await fetch('/api/presupuestos/faltantes/dashboard?estado=Todos');
            if (!response.ok) throw new Error('Proxy status: ' + response.status);
        } catch (e1) {
            response = await fetch('http://localhost:3003/api/presupuestos/faltantes/dashboard?estado=Todos');
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        document.getElementById('loading').style.display = 'none';
        
        if (result.success && result.data) {
            rawDashboardData = result.data;
            window.rawDashboardData = result.data;
            actualizarContadoresBadges();
            aplicarFiltrosYRenderizar();
        } else {
            renderEmptyState('No se encontraron registros de artículos faltantes.');
        }
        
    } catch (error) {
        console.error('Error cargando faltantes:', error);
        document.getElementById('loading').innerHTML = `
            <div style="color: #e74c3c;">
                <i class="fas fa-exclamation-triangle"></i> 
                Error de conexión al servidor de presupuestos (Puerto 3003).
            </div>`;
    }
}

// Actualiza los badges numéricos de las pestañas
function actualizarContadoresBadges() {
    let countConStock = 0;
    let countSinStock = 0;

    rawDashboardData.forEach(grupo => {
        const detallesPendientes = grupo.detalles.filter(d => (d.estado || 'Pendiente') === 'Pendiente');
        if (detallesPendientes.length > 0) {
            if (grupo.tiene_stock) {
                countConStock += detallesPendientes.length;
            } else {
                countSinStock += detallesPendientes.length;
            }
        }
    });

    const bCon = document.getElementById('badge-con-stock');
    const bSin = document.getElementById('badge-sin-stock');
    if (bCon) bCon.textContent = countConStock;
    if (bSin) bSin.textContent = countSinStock;
}

// Cambia de pestaña/filtro
window.filtrarVista = function(tipo, btnElement) {
    filtroActual = tipo;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    aplicarFiltrosYRenderizar();
};

// Filtro en vivo por texto (buscador)
window.filtrarPorTexto = function() {
    aplicarFiltrosYRenderizar();
};

function aplicarFiltrosYRenderizar() {
    const textoBusqueda = (document.getElementById('input-busqueda')?.value || '').toLowerCase().trim();
    const terminos = textoBusqueda.split(' ').filter(t => t.length > 0);

    const filtrados = [];

    rawDashboardData.forEach(grupo => {
        // Filtrar detalles según estado de la pestaña
        let detallesValidos = grupo.detalles.filter(d => {
            const est = d.estado || 'Pendiente';
            if (filtroActual === 'ConStock') {
                return est === 'Pendiente' && grupo.tiene_stock;
            } else if (filtroActual === 'Pendiente') {
                return est === 'Pendiente' && !grupo.tiene_stock;
            } else if (filtroActual === 'Cubierto') {
                return est === 'Cubierto';
            } else if (filtroActual === 'Desestimado') {
                return est === 'Desestimado';
            } else {
                return true; // 'Todos'
            }
        });

        // Filtrar por texto de búsqueda acumulativo (AND)
        if (terminos.length > 0) {
            detallesValidos = detallesValidos.filter(d => {
                const bolsaTexto = `${grupo.articulo} ${grupo.descripcion} ${d.cliente_nombre} ${d.presupuesto_ext || ''}`.toLowerCase();
                return terminos.every(term => bolsaTexto.includes(term));
            });
        }

        if (detallesValidos.length > 0) {
            const cantTotal = detallesValidos.reduce((acc, d) => acc + (parseFloat(d.cantidad) || 0), 0);
            filtrados.push({
                ...grupo,
                cantidad_total: cantTotal,
                detalles: detallesValidos
            });
        }
    });

    if (filtrados.length > 0) {
        renderDashboard(filtrados);
    } else {
        renderEmptyState(`No hay demandas en la categoría "${filtroActual}" con los filtros aplicados.`);
    }
}

function renderEmptyState(mensaje) {
    document.getElementById('dashboard-content').style.display = 'block';
    document.getElementById('grid-body').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-box-open"></i>
            <h3>No hay demanda en esta vista</h3>
            <p>${mensaje}</p>
        </div>
    `;
}

function renderDashboard(datos) {
    document.getElementById('dashboard-content').style.display = 'block';
    const gridBody = document.getElementById('grid-body');
    let html = '';

    datos.forEach((grupo, index) => {
        const accordionId = `details-${index}`;
        
        let badgeStockHtml = '';
        if (grupo.stock_consolidado > 0) {
            badgeStockHtml = `<span class="stock-badge-pill con-stock"><i class="fas fa-check"></i> Stock listo: ${grupo.stock_consolidado} un.</span>`;
        } else if (grupo.stock_granel_disponible > 0) {
            badgeStockHtml = `<span class="stock-badge-pill granel"><i class="fas fa-wheat"></i> Granel listo: ${grupo.stock_granel_disponible.toFixed(1)} kg</span>`;
        } else {
            badgeStockHtml = `<span class="stock-badge-pill sin-stock"><i class="fas fa-times"></i> Sin stock</span>`;
        }

        // Fila Maestra
        html += `
            <div class="item-row" onclick="toggleAccordion('${accordionId}', this)">
                <div class="item-title-box">
                    <span class="item-title">${grupo.descripcion || grupo.articulo}</span>
                </div>
                <div class="item-qty-box">
                    <span class="item-qty">${grupo.cantidad_total} Un. pedidas</span>
                    ${badgeStockHtml}
                </div>
                <div class="chevron-icon"><i class="fas fa-chevron-down"></i></div>
            </div>
            
            <!-- Detalles Acordeón -->
            <div id="${accordionId}" class="item-details">
                <table class="details-table">
                    <thead>
                        <tr>
                            <th style="width: 28%">Cliente & Presupuesto</th>
                            <th style="width: 10%">Cantidad</th>
                            <th style="width: 12%">Estado</th>
                            <th style="width: 18%">Observación</th>
                            <th style="width: 12%">Antigüedad</th>
                            <th style="width: 20%; text-align: center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Filas hijas de detalles
        grupo.detalles.forEach(detalle => {
            const tiempoRelativo = calcularTiempoAtras(detalle.fecha);
            const estadoActual = detalle.estado || 'Pendiente';

            let estadoBadge = '';
            if (estadoActual === 'Cubierto') {
                estadoBadge = `<span style="background:#dcfce7; color:#15803d; font-weight:600; padding:2px 8px; border-radius:12px; font-size:0.8em;"><i class="fas fa-check-circle"></i> Cubierto</span>`;
            } else if (estadoActual === 'Desestimado') {
                estadoBadge = `<span style="background:#fee2e2; color:#b91c1c; font-weight:600; padding:2px 8px; border-radius:12px; font-size:0.8em;"><i class="fas fa-ban"></i> Desestimado</span>`;
            } else {
                estadoBadge = `<span style="background:#e0f2fe; color:#0369a1; font-weight:600; padding:2px 8px; border-radius:12px; font-size:0.8em;"><i class="fas fa-clock"></i> Pendiente</span>`;
            }

            const waBtn = `<button type="button" class="btn-table-action btn-wa" onclick="window.abrirModalGestionDemanda(${detalle.id}, fetchDashboardData)" title="Contactar cliente (WhatsApp / Email)"><i class="fab fa-whatsapp"></i></button>`;

            const presBtn = detalle.cliente_id
                ? `<a href="http://localhost:3003/pages/crear-presupuesto.html?cliente_id=${detalle.cliente_id}" target="_blank" class="btn-table-action btn-presup" title="Cargar nuevo presupuesto"><i class="fas fa-file-invoice-dollar"></i></a>`
                : '';

            const accionesHtml = estadoActual === 'Pendiente' ? `
                <div class="table-actions" style="justify-content: center;">
                    ${waBtn}
                    ${presBtn}
                    <button class="btn-table-action btn-cubierto" onclick="window.marcarCubiertoEnInforme(${detalle.id})" title="Marcar como ya entregado / cubierto"><i class="fas fa-check"></i> Cubierto</button>
                    <button class="btn-table-action btn-desestimar" onclick="window.desestimarEnInforme(${detalle.id})" title="Desestimar / Desechar"><i class="fas fa-trash-alt"></i></button>
                </div>
            ` : `
                <div style="text-align: center; color: #9ca3af; font-size: 0.85em;">
                    ${detalle.motivo_resolucion || 'Procesado'}
                </div>
            `;

            html += `
                <tr id="fila-detalle-${detalle.id}">
                    <td>
                        <strong>${detalle.cliente_nombre}</strong><br>
                        <span style="font-size:0.82em; color:#6b7280;">Presupuesto: #${detalle.presupuesto_ext || 'N/A'}</span>
                    </td>
                    <td style="color:#e74c3c; font-weight:700; font-size: 1em;">${detalle.cantidad}</td>
                    <td>${estadoBadge}</td>
                    <td><span class="reason-badge">${detalle.motivo_falta || 'Sin stock'}</span></td>
                    <td><span class="time-badge"><i class="far fa-clock"></i> ${tiempoRelativo}</span></td>
                    <td>${accionesHtml}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
    });

    gridBody.innerHTML = html;
}

// Lógica Visual del Acordeón
window.toggleAccordion = function(id, rowElement) {
    const content = document.getElementById(id);
    const wasActive = content.classList.contains('active');
    
    // Cerrar todos
    document.querySelectorAll('.item-details').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.item-row').forEach(el => el.classList.remove('expanded'));
    
    // Abrir el clickeado si estaba cerrado
    if (!wasActive) {
        content.classList.add('active');
        rowElement.classList.add('expanded');
    }
};

// Acciones de Gestión de Demanda
window.marcarCubiertoEnInforme = async function(id) {
    const confirmacion = await Swal.fire({
        title: '¿Confirmar entrega?',
        text: 'Se dará de baja de la demanda pendiente marcándolo como cubierto/entregado.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, marcar cubierto',
        confirmButtonColor: '#16a34a',
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacion.isConfirmed) return;

    try {
        let res;
        try {
            res = await fetch(`/api/presupuestos/faltantes/${id}/estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevoEstado: 'Cubierto', motivo: 'Marcado cubierto desde informe de faltantes' })
            });
        } catch (e1) {
            res = await fetch(`http://localhost:3003/api/presupuestos/faltantes/${id}/estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevoEstado: 'Cubierto', motivo: 'Marcado cubierto desde informe de faltantes' })
            });
        }

        if (res.ok) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: '✅ Marcado como cubierto',
                showConfirmButton: false,
                timer: 2000
            });
            await fetchDashboardData();
        } else {
            throw new Error('Error al actualizar');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Error', 'No se pudo actualizar el estado.', 'error');
    }
};

window.desestimarEnInforme = async function(id) {
    const confirmacion = await Swal.fire({
        title: '¿Desestimar demanda?',
        text: 'Se dará de baja y no se considerará más en las alertas ni pendientes.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, desestimar',
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacion.isConfirmed) return;

    try {
        let res;
        try {
            res = await fetch(`/api/presupuestos/faltantes/${id}/estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevoEstado: 'Desestimado', motivo: 'Desestimado desde informe de faltantes' })
            });
        } catch (e1) {
            res = await fetch(`http://localhost:3003/api/presupuestos/faltantes/${id}/estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevoEstado: 'Desestimado', motivo: 'Desestimado desde informe de faltantes' })
            });
        }

        if (res.ok) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'info',
                title: '🗑️ Demanda desestimada',
                showConfirmButton: false,
                timer: 2000
            });
            await fetchDashboardData();
        } else {
            throw new Error('Error al desestimar');
        }
    } catch (err) {
        console.error(err);
        Swal.fire('Error', 'No se pudo desestimar.', 'error');
    }
};
