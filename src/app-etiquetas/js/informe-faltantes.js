/**
 * Controlador Frontend para el Dashboard de Faltantes
 * Puerto Base Presupuestos: 3003
 */

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

// Calcula dinámicamente "Hace X días"
function calcularTiempoAtras(fechaIso) {
    if (!fechaIso) return 'Desconocido';
    const ahora = new Date();
    
    let fecha;
    // Previene desplazamiento de Medianoche UTC dividiendo fecha estática YYYY-MM-DD
    if (typeof fechaIso === 'string' && fechaIso.length <= 10 && fechaIso.includes('-')) {
        const [y, m, d] = fechaIso.split('-');
        fecha = new Date(y, m - 1, d);
    } else {
        fecha = new Date(fechaIso);
    }
    
    // Normalizar a medianoche para cálculo de días
    const ahoraMedianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const fechaMedianoche = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    
    const diffTiempo = Math.abs(ahoraMedianoche - fechaMedianoche);
    const diffDias = Math.floor(diffTiempo / (1000 * 60 * 60 * 24)); 

    if (diffDias === 0) return 'Hoy';
    if (diffDias === 1) return 'Ayer';
    return `Hace ${diffDias} días`;
}

// Llama al microservicio backend
async function fetchDashboardData() {
    try {
        const response = await fetch('http://localhost:3003/api/presupuestos/faltantes/dashboard');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        document.getElementById('loading').style.display = 'none';
        
        if (result.success && result.data && result.data.length > 0) {
            renderDashboard(result.data);
        } else {
            renderEmptyState();
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

function renderEmptyState() {
    document.getElementById('dashboard-content').style.display = 'block';
    document.getElementById('grid-body').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-box-open"></i>
            <h3>No hay demanda insatisfecha</h3>
            <p>No se encontraron registros de artículos faltantes en la base de datos.</p>
        </div>
    `;
}

function renderDashboard(datos) {
    document.getElementById('dashboard-content').style.display = 'block';
    const gridBody = document.getElementById('grid-body');
    let html = '';

    datos.forEach((grupo, index) => {
        const accordionId = `details-${index}`;
        
        // Nivel 1: Fila Maestra
        html += `
            <div class="item-row" onclick="toggleAccordion('${accordionId}', this)">
                <div class="item-title">${grupo.descripcion || grupo.articulo}</div>
                <div class="item-qty">${grupo.cantidad_total} Un.</div>
                <div class="chevron-icon"><i class="fas fa-chevron-down"></i></div>
            </div>
            
            <!-- Nivel 2: Detalles Acordeón -->
            <div id="${accordionId}" class="item-details">
                <table class="details-table">
                    <thead>
                        <tr>
                            <th style="width: 35%">Cliente</th>
                            <th style="width: 15%">Cantidad</th>
                            <th style="width: 30%">Observación</th>
                            <th style="width: 20%">Antigüedad</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Generar filas hijas de detalles
        grupo.detalles.forEach(detalle => {
            const tiempoRelativo = calcularTiempoAtras(detalle.fecha);
            html += `
                <tr>
                    <td><strong>${detalle.cliente_nombre}</strong><br><span style="font-size:0.85em; color:#7f8c8d;">Presupuesto: ${detalle.presupuesto_ext || 'N/A'}</span></td>
                    <td style="color:#e74c3c; font-weight:600;">${detalle.cantidad}</td>
                    <td><span class="reason-badge">${detalle.motivo_falta || 'Sin stock'}</span></td>
                    <td><span class="time-badge"><i class="far fa-clock"></i> ${tiempoRelativo}</span></td>
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
