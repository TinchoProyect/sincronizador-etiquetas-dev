/**
 * Controlador Frontend: Monitor y Gestión de Ofertas Dinámicas
 * Sistema LAMDA - Módulo Comercial & CRM
 * Estándar Obligatorio: Política Universal de Búsqueda LAMDA (Fase 49)
 */

let ofertasCache = [];
let filtroEstadoActual = 'TODAS';
let articulosDisponiblesCache = [];
let listasDisponiblesCache = [];
let articulosSeleccionadosModal = new Map(); // Map de articulo_id -> { articulo_id, descripcion, descripcion_generada, kilos_unidad, familia_nombre }
let stockReferenciaCache = null;
let debounceStockCalc = null;

// =========================================================================
// 1. MOTOR DE BÚSQUEDA UNIVERSAL LAMDA (FASE 49)
// =========================================================================

/**
 * Normaliza cualquier texto a minúsculas y sin acentos/diacríticos
 */
function normalizarTexto(txt) {
    if (!txt) return '';
    return String(txt)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

/**
 * Bolsa de Búsqueda Combinada para Artículos LAMDA (Single Source of Truth)
 */
window.obtenerTextoBusquedaArticulo = function(art) {
    if (!art) return '';
    const tokens = [];

    // ID y número de artículo / código / nombre
    if (art.articulo_id) tokens.push(art.articulo_id);
    if (art.articulo_numero && art.articulo_numero !== art.articulo_id) tokens.push(art.articulo_numero);
    if (art.numero) tokens.push(art.numero);
    if (art.codigo) tokens.push(art.codigo);
    if (art.codigo_barras) tokens.push(art.codigo_barras);
    if (art.nombre) tokens.push(art.nombre);
    if (art.articulo_principal_texto) tokens.push(art.articulo_principal_texto);
    if (art.categoria) tokens.push(art.categoria);
    if (art.subcategoria) tokens.push(art.subcategoria);
    if (art.sector_letra) tokens.push(art.sector_letra);
    if (art.sector_nombre) tokens.push(art.sector_nombre);
    if (art.marca) tokens.push(art.marca);
    if (art.unidad_medida) tokens.push(art.unidad_medida);

    // 1. Nomenclador Generado Visible en Pantalla
    if (art.descripcion_generada) tokens.push(art.descripcion_generada);
    if (art.descripcion && art.descripcion !== art.descripcion_generada) {
        tokens.push(art.descripcion);
    }
    if (art.articulo_descripcion && art.articulo_descripcion !== art.descripcion && art.articulo_descripcion !== art.descripcion_generada) {
        tokens.push(art.articulo_descripcion);
    }

    // 2. Nombre de la Familia
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
    if (famNombre) tokens.push(famNombre);

    // 3. Atributos descriptivos de propiedades_dinamicas
    if (art.propiedades_dinamicas) {
        let pd = art.propiedades_dinamicas;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch (e) {}
        }
        if (pd && typeof pd === 'object') {
            if (pd.articulo_principal) tokens.push(pd.articulo_principal);
            const posObj = pd.posiciones || pd;
            if (posObj && typeof posObj === 'object') {
                Object.keys(posObj).forEach(key => {
                    if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) return;
                    const item = posObj[key];
                    if (item && typeof item === 'object' && item.valor) tokens.push(item.valor);
                    else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') tokens.push(item);
                });
            }
        }
    }

    // 4. Kilos o presentación
    if (art.kilos_unidad) {
        tokens.push(`${parseFloat(art.kilos_unidad)}kg`);
        tokens.push(`${parseFloat(art.kilos_unidad)}`);
    }

    return normalizarTexto(tokens.filter(Boolean).join(' '));
};

/**
 * Evaluación de coincidencia acumulativa (Espacios = AND)
 */
function cumpleBusquedaUniversal(textoIndexado, query) {
    if (!query) return true;
    const terminos = normalizarTexto(query).split(/\s+/).filter(Boolean);
    if (terminos.length === 0) return true;
    return terminos.every(term => textoIndexado.includes(term));
}

// =========================================================================
// 2. CICLO DE VIDA Y CARGA INICIAL
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Listener de teclado para tecla Escape en buscadores
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Escape') {
            const focused = document.activeElement;
            if (focused && focused.id === 'input-buscar-oferta') {
                limpiarBuscadorOfertas();
            } else if (focused && focused.id === 'input-buscar-articulo-modal') {
                limpiarBuscadorArticulosModal();
            }
        }
    });

    // Cerrar dropdown de artículos en modal si se hace clic afuera
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('dropdown-resultados-articulos');
        const searchBox = document.querySelector('.search-article-box');
        if (dropdown && searchBox && !searchBox.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    await cargarOfertas();
    await cargarCatalogosAuxiliares();
    consultarSyncStatus();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('nueva') === 'true') {
        setTimeout(abrirModalNuevaOferta, 200);
    }
});

// =========================================================================
// 3. CONSULTA Y GESTIÓN DE OFERTAS
// =========================================================================

/**
 * Carga el listado de ofertas desde el backend
 */
async function cargarOfertas() {
    const container = document.getElementById('ofertas-container');
    try {
        const res = await fetch('/api/ofertas-dinamicas');
        const data = await res.json();

        if (data.success && Array.isArray(data.data)) {
            ofertasCache = data.data;
            actualizarKPIs(ofertasCache);
            aplicarFiltros();
        } else {
            container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 30px;">Error al cargar ofertas: ${data.error || 'Respuesta inválida'}</div>`;
        }
    } catch (err) {
        console.error('Error cargando ofertas:', err);
        container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 30px;">Error de conexión con el servidor.</div>`;
    }
}

/**
 * Actualiza los contadores superiores (KPIs)
 */
function actualizarKPIs(ofertas) {
    const activas = ofertas.filter(o => o.activo && o.estado === 'ACTIVA');
    document.getElementById('kpi-activas').textContent = activas.length;

    let cuotaTotalKilos = 0;
    let cuotaDispKilos = 0;
    let cuotaReservadaKilos = 0;
    const listasSet = new Set();

    activas.forEach(o => {
        if (o.unidad_cuota === 'KILOS') {
            cuotaTotalKilos += parseFloat(o.cuota_total) || 0;
            cuotaDispKilos += parseFloat(o.cuota_disponible) || 0;
            cuotaReservadaKilos += parseFloat(o.kilos_reservados) || 0;
        }
        (o.listas || []).forEach(l => listasSet.add(l.bunker_lista_precio_id));
    });

    document.getElementById('kpi-cuota-total').textContent = `${cuotaTotalKilos.toLocaleString('es-AR')} kg`;
    const kpiReservada = document.getElementById('kpi-cuota-reservada');
    if (kpiReservada) kpiReservada.textContent = `${cuotaReservadaKilos.toLocaleString('es-AR')} kg`;
    document.getElementById('kpi-cuota-disponible').textContent = `${cuotaDispKilos.toLocaleString('es-AR')} kg`;
    document.getElementById('kpi-listas-cubiertas').textContent = listasSet.size;
}

/**
 * Renderiza la grilla de ofertas en el DOM
 */
function renderOfertas(ofertas, queryBusqueda = '') {
    const container = document.getElementById('ofertas-container');
    if (!container) return;

    if (ofertas.length === 0) {
        if (queryBusqueda && queryBusqueda.trim()) {
            container.innerHTML = `
                <div style="background: white; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 40px; text-align: center; color: #64748b;">
                    <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
                    <p style="font-size: 1.05rem; font-weight: 700; color: #1e293b; margin-bottom: 6px;">
                        No se encontraron ofertas que coincidan con "${queryBusqueda}"
                    </p>
                    <p style="font-size: 0.86rem; margin: 0 0 16px 0;">
                        Probá buscando por nombre de artículo (ej: <em>mani</em>, <em>cascara</em>), código o familia.
                    </p>
                    <button class="btn-nav-top" onclick="limpiarBuscadorOfertas()">
                        ✕ Limpiar búsqueda
                    </button>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div style="background: white; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 40px; text-align: center; color: #64748b;">
                    <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 6px;">No se encontraron ofertas dinámicas</p>
                    <p style="font-size: 0.88rem; margin: 0 0 16px 0;">Crea una nueva oferta con cuota de stock para asignarla a una o más listas.</p>
                    <button class="btn-primary-action" onclick="abrirModalNuevaOferta()">
                        <i class="fa-solid fa-plus"></i> Crear Primera Oferta
                    </button>
                </div>
            `;
        }
        return;
    }

    container.innerHTML = ofertas.map(o => {
        const total = parseFloat(o.cuota_total) || 1;
        const reservado = parseFloat(o.kilos_reservados) || 0;
        const consumido = parseFloat(o.kilos_consumidos) || 0;
        const comprometido = parseFloat(o.cuota_comprometida_total || (reservado + consumido)) || 0;
        const disponible = Math.max(0, total - comprometido);

        const pctConsumido = Math.min(100, Math.round((consumido / total) * 100));
        const pctReservado = Math.min(100 - pctConsumido, Math.round((reservado / total) * 100));
        const pctTotal = Math.min(100, pctConsumido + pctReservado);

        let statusClass = 'status-activa';
        let statusIcon = '🟢';
        if (o.estado === 'PAUSADA') {
            statusClass = 'status-pausada';
            statusIcon = '🟡';
        } else if (o.estado === 'AGOTADA' || o.estado === 'CANCELADA') {
            statusClass = 'status-agotada';
            statusIcon = '🔴';
        }

        const unidad = (o.unidad_cuota || 'KILOS').toLowerCase();

        let condicionLabel = 'Hasta agotar cuota';
        if (o.condicion_cierre === 'AMBAS') {
            const fStr = o.fecha_fin ? o.fecha_fin.split('T')[0].split('-').reverse().join('/') : '';
            condicionLabel = fStr ? `Hasta agotar cuota o ${fStr}` : 'Cuota o fecha límite';
        } else if (o.condicion_cierre === 'FECHA_LIMITE') {
            const fStr = o.fecha_fin ? o.fecha_fin.split('T')[0].split('-').reverse().join('/') : '';
            condicionLabel = fStr ? `Hasta ${fStr}` : 'Fecha límite';
        }

        const pedidosDetalle = Array.isArray(o.pedidos_detalle) ? o.pedidos_detalle : [];

        return `
            <div class="oferta-card" data-id="${o.id}">
                <div class="oferta-header">
                    <div>
                        <h3 class="oferta-title">
                            ${o.titulo}
                            <span class="status-badge ${statusClass}">${statusIcon} ${o.estado}</span>
                        </h3>
                        <p class="oferta-desc">${o.descripcion || 'Sin descripción adicional.'}</p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 1.3rem; font-weight: 800; color: #15803d;">
                            ${parseFloat(o.descuento_porcentaje)}% OFF
                        </span>
                        <div style="font-size: 0.75rem; color: #64748b;">Beneficio Directo</div>
                    </div>
                </div>

                <!-- Barra de Cuota Dinámica (Consumido + Reservado en Bandeja) -->
                <div class="cuota-container">
                    <div class="cuota-info-header">
                        <span>Progreso de Cuota Promocional:</span>
                        <span>
                            Comprometido: <strong>${comprometido.toLocaleString('es-AR')} ${unidad}</strong> (${pctTotal}%) de <strong>${total.toLocaleString('es-AR')} ${unidad}</strong>
                        </span>
                    </div>
                    <div class="progress-bar-bg" title="Facturado: ${consumido} ${unidad} (${pctConsumido}%) | Reservado en pedidos: ${reservado} ${unidad} (${pctReservado}%) | Disponible: ${disponible} ${unidad}">
                        <div class="progress-segment-consumido" style="width: ${pctConsumido}%;" title="Facturado / Entregado: ${consumido} ${unidad}"></div>
                        <div class="progress-segment-reservado" style="width: ${pctReservado}%;" title="Reservado en pedidos / bandeja: ${reservado} ${unidad}"></div>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-top: 8px; gap: 8px; color: #475569;">
                        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                            <span>⚡ <strong style="color: #15803d;">Remanente disponible:</strong> <strong style="font-size: 0.92rem; color: #166534;">${disponible.toLocaleString('es-AR')} ${unidad}</strong></span>
                            ${reservado > 0 ? `
                                <span style="color: #c2410c; background: #fff7ed; padding: 2px 8px; border-radius: 4px; border: 1px solid #fed7aa; font-weight: 600;">
                                    ⏳ <strong>Reservado en pedidos:</strong> ${reservado.toLocaleString('es-AR')} ${unidad}
                                </span>
                            ` : ''}
                            ${consumido > 0 ? `
                                <span style="color: #047857; background: #ecfdf5; padding: 2px 8px; border-radius: 4px; border: 1px solid #a7f3d0; font-weight: 600;">
                                    ✅ <strong>Facturado/Entregado:</strong> ${consumido.toLocaleString('es-AR')} ${unidad}
                                </span>
                            ` : ''}
                        </div>
                        <span>Condición: <strong>${condicionLabel}</strong></span>
                    </div>

                    ${pedidosDetalle.length > 0 ? `
                        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #cbd5e1;">
                            <button type="button" class="btn-toggle-pedidos" onclick="toggleDetallePedidosOferta(${o.id})">
                                <i class="fa-solid fa-clipboard-list"></i>
                                <span id="btn-toggle-text-${o.id}">Ver pedidos en bandeja reservando stock (${pedidosDetalle.length})</span>
                                <i class="fa-solid fa-chevron-down" id="btn-toggle-icon-${o.id}"></i>
                            </button>
                            <div id="pedidos-detalle-${o.id}" class="pedidos-reserva-wrapper" style="display: none;">
                                <table class="pedidos-reserva-table">
                                    <thead>
                                        <tr>
                                            <th>N° Pedido</th>
                                            <th>Cliente</th>
                                            <th>Artículo / Presentación</th>
                                            <th>Cant.</th>
                                            <th>Kilos</th>
                                            <th>Estado / Cola</th>
                                            <th>Tipo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${pedidosDetalle.map(p => `
                                            <tr>
                                                <td>
                                                    <a href="/presupuestos?buscar=${p.presupuesto_id}" target="_blank" style="color: #4f46e5; font-weight: 700; text-decoration: none;">
                                                        #${p.presupuesto_id}
                                                    </a>
                                                </td>
                                                <td><strong>${p.cliente_nombre || 'Cliente #' + p.id_cliente}</strong></td>
                                                <td>
                                                    <span style="font-family: monospace; font-size: 0.75rem; background: #e2e8f0; padding: 1px 4px; border-radius: 3px;">${p.articulo_codigo}</span>
                                                    ${p.articulo_descripcion || ''}
                                                </td>
                                                <td style="font-weight: 600;">${p.unidades} u.</td>
                                                <td style="font-weight: 700; color: ${p.tipo_cuota === 'RESERVADO' ? '#ea580c' : '#15803d'};">${p.kilos} kg</td>
                                                <td>
                                                    <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">
                                                        ${p.secuencia || p.estado}
                                                    </span>
                                                </td>
                                                <td>
                                                    ${p.tipo_cuota === 'RESERVADO' 
                                                        ? '<span style="color: #ea580c; background: #fff7ed; border: 1px solid #ffedd5; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">⏳ RESERVADO</span>'
                                                        : '<span style="color: #15803d; background: #f0fdf4; border: 1px solid #dcfce7; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 700;">✅ CONSUMIDO</span>'
                                                    }
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <!-- Metadata e Inclusiones -->
                <div class="meta-pills">
                    <span class="meta-pill highlight" title="Listas donde la oferta se encuentra activa">
                        <i class="fa-solid fa-list-check"></i> Listas: ${(o.listas || []).map(l => l.lista_nombre).join(', ') || 'Ninguna'}
                    </span>
                    <span class="meta-pill" title="Presentaciones y artículos que debitan de esta cuota">
                        <i class="fa-solid fa-box"></i> Artículos: ${(o.articulos || []).map(a => `${a.articulo_numero} (${parseFloat(a.factor_conversion_cuota || a.kilos_unidad || 1)}kg)`).join(', ') || 'Sin artículos'}
                    </span>
                    ${o.no_acumulable_con_politica ? `
                        <span class="meta-pill" style="background: #f0fdf4; border-color: #bbf7d0; color: #166534;" title="Protección de margen comercial">
                            🛡️ No suma a la bonif. de $300.000
                        </span>
                    ` : ''}
                    ${(o.excepciones && o.excepciones.length > 0) ? `
                        <span class="meta-pill" style="background: #fef2f2; border-color: #fecaca; color: #991b1b;">
                            ⚠️ ${o.excepciones.length} cliente(s) excluido(s)
                        </span>
                    ` : ''}
                </div>

                <!-- Botones de Acción -->
                <div class="card-actions">
                    <button class="btn-action btn-wa" onclick="abrirModalDifusion(${o.id})" title="Enviar WhatsApp a clientes de estas listas">
                        <svg style="width: 14px; height: 14px; fill: currentColor; vertical-align: -2px;" viewBox="0 0 448 512"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg> Difundir en Cascada
                    </button>
                    ${o.estado === 'ACTIVA' ? `
                        <button class="btn-action" style="color: #b45309; border-color: #fde68a; background: #fffbeb;" onclick="cambiarEstadoOferta(${o.id}, 'PAUSADA')" title="Desactivar temporalmente oferta">
                            ⏸️ Desactivar
                        </button>
                    ` : `
                        <button class="btn-action" style="color: #15803d; border-color: #bbf7d0; background: #f0fdf4;" onclick="cambiarEstadoOferta(${o.id}, 'ACTIVA')" title="Activar oferta">
                            ▶️ Activar Oferta
                        </button>
                    `}
                    <button class="btn-action" onclick="abrirModalEditarOferta(${o.id})" title="Editar parámetros de oferta">
                        ✏️ Editar
                    </button>
                    <button class="btn-action btn-danger" style="color: #b91c1c; border-color: #fecaca; background: #fef2f2; font-weight: 700;" onclick="eliminarOferta(${o.id})" title="Eliminar oferta permanentemente">
                        🗑️ Eliminar
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleDetallePedidosOferta = function(ofertaId) {
    const el = document.getElementById(`pedidos-detalle-${ofertaId}`);
    const icon = document.getElementById(`btn-toggle-icon-${ofertaId}`);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (icon) {
        icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
    }
};

// =========================================================================
// 4. FILTRADO EN VIVO Y BUSCADOR UNIVERSAL (MONITOR)
// =========================================================================

let debounceTimerBusquedaOfertas = null;

function filtrarOfertasEnVivo() {
    clearTimeout(debounceTimerBusquedaOfertas);
    debounceTimerBusquedaOfertas = setTimeout(() => {
        const input = document.getElementById('input-buscar-oferta');
        const btnClear = document.getElementById('btn-limpiar-busqueda');
        if (input && btnClear) {
            btnClear.style.display = input.value.trim() ? 'flex' : 'none';
        }
        aplicarFiltros();
    }, 60);
}

function limpiarBuscadorOfertas() {
    const input = document.getElementById('input-buscar-oferta');
    if (input) {
        input.value = '';
        const btnClear = document.getElementById('btn-limpiar-busqueda');
        if (btnClear) btnClear.style.display = 'none';
        aplicarFiltros();
        input.focus();
    }
}

function filtrarEstado(estado, elBtn) {
    filtroEstadoActual = estado;
    document.querySelectorAll('.tab-pill').forEach(btn => btn.classList.remove('active'));
    if (elBtn) elBtn.classList.add('active');
    aplicarFiltros();
}

function aplicarFiltros() {
    const query = document.getElementById('input-buscar-oferta')?.value || '';
    let res = ofertasCache;

    if (filtroEstadoActual !== 'TODAS') {
        res = res.filter(o => o.estado === filtroEstadoActual);
    }

    if (query.trim()) {
        res = res.filter(o => {
            // Construir la bolsa de búsqueda de la oferta con el estándar de Fase 49
            const tokensOferta = [
                o.titulo,
                o.descripcion,
                (o.articulos || []).map(a => window.obtenerTextoBusquedaArticulo(a)).join(' '),
                (o.listas || []).map(l => l.lista_nombre).join(' ')
            ].join(' ');

            const indexado = normalizarTexto(tokensOferta);
            return cumpleBusquedaUniversal(indexado, query);
        });
    }

    // Actualizar badge contador
    const badge = document.getElementById('search-counter-badge');
    if (badge) {
        badge.textContent = `${res.length} de ${ofertasCache.length} oferta${ofertasCache.length !== 1 ? 's' : ''}`;
    }

    renderOfertas(res, query);
}

// =========================================================================
// 5. SELECTOR INTERACTIVO DE ARTÍCULOS PARA EL MODAL (FASE 49)
// =========================================================================

/**
 * Carga artículos y listas disponibles para el modal
 */
async function cargarCatalogosAuxiliares() {
    try {
        const [resArts, resListas] = await Promise.all([
            fetch('/api/ofertas-dinamicas/articulos-disponibles'),
            fetch('/api/ofertas-dinamicas/listas-disponibles')
        ]);
        const dataArts = await resArts.json();
        const dataListas = await resListas.json();

        if (dataArts.success) articulosDisponiblesCache = dataArts.data;
        if (dataListas.success) listasDisponiblesCache = dataListas.data;
    } catch (e) {
        console.error('Error cargando catálogos auxiliares:', e);
    }
}

let debounceTimerArtModal = null;

function filtrarArticulosModalEnVivo() {
    clearTimeout(debounceTimerArtModal);
    debounceTimerArtModal = setTimeout(() => {
        const input = document.getElementById('input-buscar-articulo-modal');
        const btnClear = document.getElementById('btn-limpiar-art-modal');
        const dropdown = document.getElementById('dropdown-resultados-articulos');
        if (!input || !dropdown) return;

        const q = input.value.trim();
        if (btnClear) btnClear.style.display = q ? 'flex' : 'none';

        if (q.length < 1) {
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
            return;
        }

        // Filtrar con cumpleBusquedaUniversal
        const filtrados = articulosDisponiblesCache.filter(art => {
            const textIndexado = window.obtenerTextoBusquedaArticulo(art);
            return cumpleBusquedaUniversal(textIndexado, q);
        });

        if (filtrados.length === 0) {
            dropdown.innerHTML = `
                <div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.86rem;">
                    🔍 No se encontraron artículos que coincidan con <strong>"${q}"</strong>
                </div>
            `;
            dropdown.style.display = 'block';
            return;
        }

        // Agrupar por familia para presentar opciones limpias y ergonómicas
        const grupos = new Map();
        filtrados.forEach(art => {
            const grupoKey = art.familia_nombre || 'Otros Artículos';
            if (!grupos.has(grupoKey)) grupos.set(grupoKey, []);
            grupos.get(grupoKey).push(art);
        });

        let html = '';
        grupos.forEach((items, grupoNombre) => {
            const todosAgregados = items.every(it => articulosSeleccionadosModal.has(it.articulo_id));
            html += `
                <div class="art-group-header">
                    <span>📂 ${grupoNombre} (${items.length})</span>
                    ${items.length > 1 && !todosAgregados ? `
                        <button type="button" style="font-size: 0.74rem; font-weight: 700; color: #4f46e5; background: none; border: none; cursor: pointer;" onclick="agregarGrupoArticulosModal('${grupoNombre.replace(/'/g, "\\'")}', '${q.replace(/'/g, "\\'")}')">
                            ➕ Agregar todas las presentaciones (${items.length})
                        </button>
                    ` : ''}
                </div>
            `;

            items.forEach(art => {
                const isAdded = articulosSeleccionadosModal.has(art.articulo_id);
                const kilos = parseFloat(art.kilos_unidad) || 1;
                const desc = art.descripcion_generada || art.descripcion;
                html += `
                    <div class="art-item-row" id="row-art-${art.articulo_id}">
                        <div class="art-item-info">
                            <div>
                                <span class="art-code-pill">${art.articulo_id}</span>
                                <span class="art-desc-text">${desc}</span>
                            </div>
                            <div class="art-sub-meta">
                                ⚖️ Factor cuota: <strong>${kilos} kg por unidad</strong> ${art.familia_nombre ? `• ${art.familia_nombre}` : ''}
                            </div>
                        </div>
                        <div>
                            ${isAdded ? `
                                <button type="button" class="btn-add-art added">
                                    ✓ Vinculado
                                </button>
                            ` : `
                                <button type="button" class="btn-add-art" onclick="agregarArticuloModal('${art.articulo_id}')">
                                    ➕ Agregar
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });
        });

        dropdown.innerHTML = html;
        dropdown.style.display = 'block';
    }, 60);
}

function limpiarBuscadorArticulosModal() {
    const input = document.getElementById('input-buscar-articulo-modal');
    const dropdown = document.getElementById('dropdown-resultados-articulos');
    const btnClear = document.getElementById('btn-limpiar-art-modal');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (btnClear) btnClear.style.display = 'none';
    if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
    }
}

function agregarArticuloModal(artId) {
    const art = articulosDisponiblesCache.find(a => a.articulo_id === artId);
    if (!art) return;

    articulosSeleccionadosModal.set(artId, {
        articulo_id: art.articulo_id,
        descripcion: art.descripcion,
        descripcion_generada: art.descripcion_generada || art.descripcion,
        kilos_unidad: parseFloat(art.kilos_unidad) || 1,
        familia_nombre: art.familia_nombre || ''
    });

    renderDeckArticulos();
    filtrarArticulosModalEnVivo();
    actualizarStockReferenciaModal();
}

function agregarGrupoArticulosModal(grupoNombre, queryActual) {
    const items = articulosDisponiblesCache.filter(art => {
        const textIndexado = window.obtenerTextoBusquedaArticulo(art);
        const matchQuery = cumpleBusquedaUniversal(textIndexado, queryActual);
        const matchGrupo = (art.familia_nombre || 'Otros Artículos') === grupoNombre;
        return matchQuery && matchGrupo;
    });

    items.forEach(art => {
        articulosSeleccionadosModal.set(art.articulo_id, {
            articulo_id: art.articulo_id,
            descripcion: art.descripcion,
            descripcion_generada: art.descripcion_generada || art.descripcion,
            kilos_unidad: parseFloat(art.kilos_unidad) || 1,
            familia_nombre: art.familia_nombre || ''
        });
    });

    renderDeckArticulos();
    filtrarArticulosModalEnVivo();
    actualizarStockReferenciaModal();
}

function removerArticuloModal(artId) {
    articulosSeleccionadosModal.delete(artId);
    renderDeckArticulos();
    filtrarArticulosModalEnVivo();
    actualizarStockReferenciaModal();
}

function limpiarTodosArticulosSeleccionados() {
    articulosSeleccionadosModal.clear();
    renderDeckArticulos();
    filtrarArticulosModalEnVivo();
    actualizarStockReferenciaModal();
}

function renderDeckArticulos() {
    const chipsGrid = document.getElementById('deck-articulos-chips');
    const emptyNotice = document.getElementById('deck-empty-notice');
    const totalSpan = document.getElementById('total-articulos-seleccionados');
    const btnDesmarcar = document.getElementById('btn-desmarcar-todos');

    const selectedArr = Array.from(articulosSeleccionadosModal.values());
    if (totalSpan) totalSpan.textContent = selectedArr.length;
    if (btnDesmarcar) btnDesmarcar.style.display = selectedArr.length > 0 ? 'inline-block' : 'none';

    if (selectedArr.length === 0) {
        if (chipsGrid) chipsGrid.innerHTML = '';
        if (emptyNotice) emptyNotice.style.display = 'block';
        return;
    }

    if (emptyNotice) emptyNotice.style.display = 'none';
    if (chipsGrid) {
        chipsGrid.innerHTML = selectedArr.map(art => `
            <div class="art-chip" id="chip-${art.articulo_id}">
                <span class="art-code-pill" style="margin: 0;">${art.articulo_id}</span>
                <span style="font-size: 0.85rem; font-weight: 600; color: #0f172a;">${art.descripcion_generada || art.descripcion}</span>
                <span class="art-chip-kilos">${parseFloat(art.kilos_unidad)} kg/u</span>
                <button type="button" class="art-chip-del" onclick="removerArticuloModal('${art.articulo_id}')" title="Quitar de la oferta">✕</button>
            </div>
        `).join('');
    }
}

// =========================================================================
// 5.1 TELEMETRÍA DE STOCK DE REFERENCIA (LDN 1 & LDN 2)
// =========================================================================

/**
 * Consulta el stock real de ingredientes y productos terminados
 * para los artículos seleccionados en la oferta
 */
async function actualizarStockReferenciaModal() {
    const panel = document.getElementById('panel-stock-referencia');
    const kilosTotalEl = document.getElementById('stock-ref-kilos-total');
    const desgloseEl = document.getElementById('stock-ref-desglose-text');
    if (!panel || !kilosTotalEl || !desgloseEl) return;

    const articulosCodigos = Array.from(articulosSeleccionadosModal.keys());
    if (articulosCodigos.length === 0) {
        panel.style.display = 'none';
        stockReferenciaCache = null;
        return;
    }

    clearTimeout(debounceStockCalc);
    debounceStockCalc = setTimeout(async () => {
        try {
            const res = await fetch('/api/ofertas-dinamicas/calcular-stock-disponible', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulos: articulosCodigos })
            });

            if (!res.ok) {
                console.warn('Endpoint /calcular-stock-disponible respondió status:', res.status);
                panel.style.display = 'none';
                return;
            }

            const json = await res.json();
            if (json.success && json.data) {
                stockReferenciaCache = json.data;
                const totalKg = json.data.total_kilos_disponibles || 0;
                const bultosKg = json.data.bultos_cerrados_kg || 0;
                const bultosCant = json.data.bultos_cerrados_cantidad || 0;
                const fracKg = json.data.fracciones_listas_kg || 0;
                const abiertoKg = json.data.kilos_abiertos_taller || 0;

                kilosTotalEl.textContent = `${totalKg.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

                const desgloseItems = [];
                if (bultosKg > 0) desgloseItems.push(`📦 Bultos cerrados: <strong>${bultosCant} (${bultosKg.toFixed(1)} kg)</strong>`);
                if (fracKg > 0) desgloseItems.push(`🛍️ Fraccionados listos: <strong>${fracKg.toFixed(1)} kg</strong>`);
                if (abiertoKg > 0) desgloseItems.push(`🥫 Kilos abiertos taller: <strong>${abiertoKg.toFixed(2)} kg</strong>`);

                desgloseEl.innerHTML = desgloseItems.length > 0 
                    ? desgloseItems.join(' &nbsp;|&nbsp; ')
                    : 'Sin stock físico registrado en ingredientes ni depósitos';

                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        } catch (err) {
            console.warn('Error al calcular stock de referencia:', err);
            panel.style.display = 'none';
        }
    }, 150);
}

/**
 * Aplica una sugerencia porcentual del stock disponible a la cuota a ofertar
 */
function asignarSugerenciaCuota(porcentaje) {
    const inputCuota = document.getElementById('oferta-cuota-input');
    const selectUnidad = document.getElementById('oferta-unidad-cuota-select');
    if (!inputCuota) return;

    if (!stockReferenciaCache || typeof stockReferenciaCache.total_kilos_disponibles !== 'number') {
        return;
    }

    const totalKg = stockReferenciaCache.total_kilos_disponibles;
    const cuotaSugerida = Math.round((totalKg * porcentaje) * 100) / 100;

    inputCuota.value = cuotaSugerida;
    if (selectUnidad) selectUnidad.value = 'KILOS';

    inputCuota.style.transition = 'all 0.3s ease';
    inputCuota.style.backgroundColor = '#dcfce7';
    inputCuota.style.borderColor = '#16a34a';
    setTimeout(() => {
        inputCuota.style.backgroundColor = '';
        inputCuota.style.borderColor = '';
    }, 600);
}

// =========================================================================
// 5.2 CONDICIÓN DE FINALIZACIÓN DUAL (CUOTA Y/O FECHA LÍMITE)
// =========================================================================

/**
 * Sincroniza los checkboxes de condición de finalización (Cuota de Stock y/o Fecha Límite)
 */
function actualizarCondicionCierreUI() {
    const checkStock = document.getElementById('condicion-agotar-stock-check');
    const checkFecha = document.getElementById('condicion-fecha-limite-check');
    const inputFecha = document.getElementById('oferta-fecha-fin-input');
    const hiddenCond = document.getElementById('oferta-condicion-hidden');
    const resumen = document.getElementById('resumen-condicion-cierre');

    if (!checkStock || !checkFecha || !inputFecha || !hiddenCond) return;

    // Al menos uno debe estar seleccionado
    if (!checkStock.checked && !checkFecha.checked) {
        checkStock.checked = true;
    }

    let condicion = 'HASTA_AGOTAR_STOCK';
    let resumenHtml = '';

    if (checkStock.checked && checkFecha.checked) {
        condicion = 'AMBAS';
        inputFecha.style.display = 'inline-block';
        if (!inputFecha.value) {
            const d = new Date();
            d.setDate(d.getDate() + 15);
            inputFecha.value = d.toISOString().split('T')[0];
        }
        resumenHtml = `📌 <strong>Condición:</strong> Finaliza lo que ocurra primero: <em>agotar cuota de stock</em> O <em>llegar al ${inputFecha.value.split('-').reverse().join('/')}</em>.`;
    } else if (checkStock.checked) {
        condicion = 'HASTA_AGOTAR_STOCK';
        inputFecha.style.display = 'none';
        resumenHtml = `📌 <strong>Condición:</strong> Finaliza exclusivamente hasta agotar la cuota de stock asignada.`;
    } else if (checkFecha.checked) {
        condicion = 'FECHA_LIMITE';
        inputFecha.style.display = 'inline-block';
        if (!inputFecha.value) {
            const d = new Date();
            d.setDate(d.getDate() + 15);
            inputFecha.value = d.toISOString().split('T')[0];
        }
        resumenHtml = `📌 <strong>Condición:</strong> Vigente hasta la fecha límite establecida (${inputFecha.value.split('-').reverse().join('/')}), independientemente del stock consumido.`;
    }

    hiddenCond.value = condicion;
    if (resumen) resumen.innerHTML = resumenHtml;
}

// =========================================================================
// 6. MODAL: CREAR / EDITAR OFERTA
// =========================================================================

function abrirModalNuevaOferta() {
    document.getElementById('modal-oferta-titulo').textContent = '➕ Nueva Oferta Dinámica';
    document.getElementById('oferta-id-input').value = '';
    document.getElementById('oferta-titulo-input').value = '';
    document.getElementById('oferta-desc-input').value = '';
    document.getElementById('oferta-cuota-input').value = '40';
    document.getElementById('oferta-unidad-cuota-select').value = 'KILOS';
    document.getElementById('oferta-descuento-input').value = '5.0';

    // Condición de cierre dual por defecto: Agotar stock
    const checkStock = document.getElementById('condicion-agotar-stock-check');
    const checkFecha = document.getElementById('condicion-fecha-limite-check');
    const inputFecha = document.getElementById('oferta-fecha-fin-input');
    if (checkStock) checkStock.checked = true;
    if (checkFecha) checkFecha.checked = false;
    if (inputFecha) {
        inputFecha.value = '';
        inputFecha.style.display = 'none';
    }
    actualizarCondicionCierreUI();

    document.getElementById('oferta-no-acumulable-check').checked = true;

    // Reset stock panel
    const panelStock = document.getElementById('panel-stock-referencia');
    if (panelStock) panelStock.style.display = 'none';
    stockReferenciaCache = null;

    const btnDelModal = document.getElementById('btn-eliminar-modal-oferta');
    if (btnDelModal) btnDelModal.style.display = 'none';

    articulosSeleccionadosModal.clear();
    limpiarBuscadorArticulosModal();
    renderDeckArticulos();

    poblarListasChecks([2, 5]); // Por defecto marcar Berisso y Dietética
    document.getElementById('modal-oferta').style.display = 'flex';
}

function abrirModalEditarOferta(id) {
    const ofr = ofertasCache.find(o => o.id === id);
    if (!ofr) return;

    document.getElementById('modal-oferta-titulo').textContent = `✏️ Editar Oferta #${ofr.id}`;
    document.getElementById('oferta-id-input').value = ofr.id;
    document.getElementById('oferta-titulo-input').value = ofr.titulo || '';
    document.getElementById('oferta-desc-input').value = ofr.descripcion || '';
    document.getElementById('oferta-cuota-input').value = ofr.cuota_total || '';
    document.getElementById('oferta-unidad-cuota-select').value = ofr.unidad_cuota || 'KILOS';
    document.getElementById('oferta-descuento-input').value = ofr.descuento_porcentaje || '5.0';

    // Condición de cierre dual
    const checkStock = document.getElementById('condicion-agotar-stock-check');
    const checkFecha = document.getElementById('condicion-fecha-limite-check');
    const inputFecha = document.getElementById('oferta-fecha-fin-input');

    const cond = ofr.condicion_cierre || 'HASTA_AGOTAR_STOCK';
    if (cond === 'AMBAS') {
        if (checkStock) checkStock.checked = true;
        if (checkFecha) checkFecha.checked = true;
    } else if (cond === 'FECHA_LIMITE') {
        if (checkStock) checkStock.checked = false;
        if (checkFecha) checkFecha.checked = true;
    } else { // HASTA_AGOTAR_STOCK
        if (checkStock) checkStock.checked = true;
        if (checkFecha) checkFecha.checked = false;
    }

    if (ofr.fecha_fin && inputFecha) {
        inputFecha.value = ofr.fecha_fin.split('T')[0];
    } else if (inputFecha) {
        inputFecha.value = '';
    }
    actualizarCondicionCierreUI();

    document.getElementById('oferta-no-acumulable-check').checked = ofr.no_acumulable_con_politica !== false;

    const btnDelModal = document.getElementById('btn-eliminar-modal-oferta');
    if (btnDelModal) btnDelModal.style.display = 'inline-block';

    // Poblar artículos seleccionados en el Map
    articulosSeleccionadosModal.clear();
    (ofr.articulos || []).forEach(a => {
        const catalogoItem = articulosDisponiblesCache.find(it => it.articulo_id === a.articulo_numero);
        articulosSeleccionadosModal.set(a.articulo_numero, {
            articulo_id: a.articulo_numero,
            descripcion: a.articulo_descripcion || catalogoItem?.descripcion || a.articulo_numero,
            descripcion_generada: a.descripcion_generada || catalogoItem?.descripcion_generada || a.articulo_descripcion || a.articulo_numero,
            kilos_unidad: parseFloat(a.factor_conversion_cuota || a.kilos_unidad || 1),
            familia_nombre: a.familia_nombre || catalogoItem?.familia_nombre || ''
        });
    });

    limpiarBuscadorArticulosModal();
    renderDeckArticulos();
    actualizarStockReferenciaModal();

    const listasSeleccionadas = (ofr.listas || []).map(l => l.bunker_lista_precio_id);
    poblarListasChecks(listasSeleccionadas);

    document.getElementById('modal-oferta').style.display = 'flex';
}

async function eliminarOfertaDesdeModal() {
    const id = document.getElementById('oferta-id-input')?.value;
    if (!id) return;
    cerrarModalOferta();
    await eliminarOferta(parseInt(id, 10));
}

function cerrarModalOferta() {
    document.getElementById('modal-oferta').style.display = 'none';
}

function toggleFechaFin(condicion) {
    const cont = document.getElementById('contenedor-fecha-fin');
    if (cont) {
        if (condicion === 'FECHA_LIMITE' || condicion === 'AMBAS') {
            cont.style.display = 'block';
        } else {
            cont.style.display = 'none';
        }
    }
}

function poblarListasChecks(seleccionadas = []) {
    const cont = document.getElementById('contenedor-listas-checks');
    if (!cont) return;

    cont.innerHTML = listasDisponiblesCache.map(l => {
        const isChecked = seleccionadas.includes(l.id);
        return `
            <label class="checkbox-label">
                <input type="checkbox" name="oferta_listas" value="${l.id}" ${isChecked ? 'checked' : ''}>
                <span>${l.nombre}</span>
            </label>
        `;
    }).join('');
}

async function guardarOfertaSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('oferta-id-input').value;
    const titulo = document.getElementById('oferta-titulo-input').value.trim();
    const descripcion = document.getElementById('oferta-desc-input').value.trim();
    const cuota_total = parseFloat(document.getElementById('oferta-cuota-input').value);
    const unidad_cuota = document.getElementById('oferta-unidad-cuota-select').value;
    const descuento_porcentaje = parseFloat(document.getElementById('oferta-descuento-input').value);
    
    // Condición de cierre dual
    const hiddenCond = document.getElementById('oferta-condicion-hidden');
    const condicion_cierre = hiddenCond ? hiddenCond.value : 'HASTA_AGOTAR_STOCK';

    const checkFecha = document.getElementById('condicion-fecha-limite-check');
    const inputFecha = document.getElementById('oferta-fecha-fin-input');
    const fecha_fin = (checkFecha && checkFecha.checked && inputFecha && inputFecha.value) ? inputFecha.value : null;

    const no_acumulable_con_politica = document.getElementById('oferta-no-acumulable-check').checked;

    // Obtener artículos del Map del Deck
    const articulos = Array.from(articulosSeleccionadosModal.values()).map(art => ({
        articulo_numero: art.articulo_id,
        factor_conversion_cuota: parseFloat(art.kilos_unidad) || 1.0
    }));

    if (articulos.length === 0) {
        Swal.fire('Atención', 'Debes buscar y agregar al menos un artículo o presentación para la oferta.', 'warning');
        return;
    }

    // Obtener listas marcadas
    const checksListas = document.querySelectorAll('input[name="oferta_listas"]:checked');
    const listas = Array.from(checksListas).map(ch => parseInt(ch.value, 10));

    if (listas.length === 0) {
        Swal.fire('Atención', 'Debe seleccionar al menos una lista de precios habilitada.', 'warning');
        return;
    }

    const payload = {
        id: id ? parseInt(id, 10) : undefined,
        titulo,
        descripcion,
        cuota_total,
        unidad_cuota,
        descuento_porcentaje,
        condicion_cierre,
        fecha_fin,
        no_acumulable_con_politica,
        articulos,
        listas,
        excepciones: []
    };

    try {
        Swal.fire({ title: 'Guardando y sincronizando oferta...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        actualizarBadgeCloud('SYNCING');

        const res = await fetch('/api/ofertas-dinamicas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire({
                title: '¡Guardada!',
                text: 'La oferta dinámica ha sido configurada y sincronizada automáticamente.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
            actualizarBadgeCloud('SUCCESS');
            cerrarModalOferta();
            await cargarOfertas();
        } else {
            actualizarBadgeCloud('ERROR');
            Swal.fire('Error', data.error || 'No se pudo guardar la oferta', 'error');
        }
    } catch (err) {
        actualizarBadgeCloud('ERROR');
        Swal.fire('Error de Conexión', err.message, 'error');
    }
}

async function cambiarEstadoOferta(id, nuevoEstado) {
    try {
        actualizarBadgeCloud('SYNCING');
        const res = await fetch(`/api/ofertas-dinamicas/${id}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await res.json();
        if (data.success) {
            actualizarBadgeCloud('SUCCESS');
            await cargarOfertas();
        } else {
            actualizarBadgeCloud('ERROR');
            Swal.fire('Error', data.error, 'error');
        }
    } catch (e) {
        actualizarBadgeCloud('ERROR');
        Swal.fire('Error', e.message, 'error');
    }
}

async function eliminarOferta(id) {
    const confirm = await Swal.fire({
        title: '¿Eliminar oferta?',
        text: 'Se eliminarán la cuota y los vínculos de esta promoción. Los consumos históricos quedarán archivados.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
        try {
            actualizarBadgeCloud('SYNCING');
            const res = await fetch(`/api/ofertas-dinamicas/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                actualizarBadgeCloud('SUCCESS');
                Swal.fire('Eliminada', 'La oferta ha sido eliminada y dada de baja en B2B.', 'success');
                await cargarOfertas();
            } else {
                actualizarBadgeCloud('ERROR');
                Swal.fire('Error', data.error, 'error');
            }
        } catch (e) {
            actualizarBadgeCloud('ERROR');
            Swal.fire('Error', e.message, 'error');
        }
    }
}

// =========================================================================
// 7. DIFUSIÓN EN CASCADA POR WHATSAPP (MICROSERVICIO PUERTO 3004)
// =========================================================================

// =========================================================================
// 8. DIFUSIÓN EN CASCADA OMNICANAL (WHATSAPP + EMAIL)
// =========================================================================

let difusionDestinatariosCache = [];

async function abrirModalDifusion(ofertaId) {
    const ofr = ofertasCache.find(o => o.id === ofertaId);
    if (!ofr) return;

    document.getElementById('difusion-oferta-id').value = ofr.id;
    document.getElementById('difusion-oferta-titulo').textContent = `${ofr.titulo} (${ofr.descuento_porcentaje}% OFF)`;

    // Plantilla comercial unificada cordial (compartida para WhatsApp y Correo)
    const plantillaCompartida = `¡Hola {contacto}! Te contamos que en el taller tenemos una oportunidad especial: *${ofr.titulo}* con un *{descuento} OFF* hasta agotar stock ({cuota} disponibles). Podés pedir bolsón cerrado o fracción. ¡Avisanos para reservarte tu pedido!`;
    const textareaMsg = document.getElementById('difusion-mensaje-textarea');
    if (textareaMsg) textareaMsg.value = plantillaCompartida;

    const asuntoEmail = `🔥 Oportunidad Comercial: ${ofr.titulo} (${ofr.descuento_porcentaje}% OFF)`;
    const emailAsuntoInput = document.getElementById('difusion-email-asunto');
    if (emailAsuntoInput) emailAsuntoInput.value = asuntoEmail;

    const filtroInput = document.getElementById('difusion-filtro-input');
    if (filtroInput) filtroInput.value = '';

    const listCont = document.getElementById('difusion-clientes-list');
    listCont.innerHTML = '<span style="color: #64748b;">Consultando clientes habilitados y canales de contacto...</span>';
    document.getElementById('modal-difusion').style.display = 'flex';

    try {
        const res = await fetch(`/api/ofertas-dinamicas/${ofertaId}/destinatarios`);
        const data = await res.json();

        if (data.success && Array.isArray(data.data)) {
            difusionDestinatariosCache = data.data;
            if (difusionDestinatariosCache.length === 0) {
                listCont.innerHTML = '<span style="color: #64748b;">No se encontraron clientes con contactos registrados para las listas de esta oferta.</span>';
                actualizarContadoresDifusion();
                return;
            }
            renderDestinatariosModalDifusion();
            actualizarContadoresDifusion();
        } else {
            listCont.innerHTML = `<span style="color: #ef4444;">Error al cargar destinatarios: ${data.error || 'Respuesta inválida'}</span>`;
        }
    } catch (e) {
        listCont.innerHTML = `<span style="color: #ef4444;">Error de red consultando destinatarios.</span>`;
    }
}

function renderDestinatariosModalDifusion() {
    const listCont = document.getElementById('difusion-clientes-list');
    if (!listCont) return;

    const filtro = (document.getElementById('difusion-filtro-input')?.value || '').toLowerCase().trim();
    const filtrados = difusionDestinatariosCache.filter(c => {
        if (!filtro) return true;
        const nombre = (c.cliente_nombre || '').toLowerCase();
        const razon = (c.razon_social || '').toLowerCase();
        const lista = (c.lista_nombre || '').toLowerCase();
        const tieneTel = (c.whatsapp_contactos || []).some(w => w.numero.includes(filtro) || (w.nombre || '').toLowerCase().includes(filtro));
        const tieneMail = (c.email_contactos || []).some(e => e.email.toLowerCase().includes(filtro) || (e.nombre || '').toLowerCase().includes(filtro));
        return nombre.includes(filtro) || razon.includes(filtro) || lista.includes(filtro) || tieneTel || tieneMail;
    });

    if (filtrados.length === 0) {
        listCont.innerHTML = '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">No hay clientes que coincidan con el filtro actual.</div>';
        return;
    }

    // Agrupar clientes filtrados por lista de precios
    const gruposPorLista = {};
    filtrados.forEach(c => {
        const lId = c.lista_id || 'sin_lista';
        if (!gruposPorLista[lId]) {
            gruposPorLista[lId] = {
                lista_id: lId,
                lista_nombre: c.lista_nombre || 'Sin Lista Asignada',
                clientes: []
            };
        }
        gruposPorLista[lId].clientes.push(c);
    });

    const listaHtmlArr = Object.values(gruposPorLista).map(grupo => {
        const lId = grupo.lista_id;
        const clientesCardsHtml = grupo.clientes.map((c, idx) => {
            const wpItems = (c.whatsapp_contactos && c.whatsapp_contactos.length > 0)
                ? c.whatsapp_contactos.map(w => {
                    const checked = w.default ? 'checked' : '';
                    let tagPred = '';
                    if (w.es_predeterminado_difusion) {
                        tagPred = '<span style="color: #7e22ce; font-size: 0.66rem; font-weight: 700; background: #faf5ff; border: 1px solid #d8b4fe; padding: 1px 4px; border-radius: 4px;" title="Contacto predeterminado guardado para difusión">★ Difusión</span>';
                    } else if (w.default) {
                        tagPred = '<span style="color: #059669; font-size: 0.66rem; font-weight: 600; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1px 4px; border-radius: 4px;" title="Predeterminado sugerido">Predet.</span>';
                    }

                    return `
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.77rem; color: #1e293b; cursor: pointer; margin-bottom: 3px;">
                            <input type="checkbox" name="difusion_wp_check" 
                                   value="${c.bunker_cliente_id}" 
                                   data-cliente-id="${c.bunker_cliente_id}"
                                   data-lista-id="${lId}"
                                   data-nombre="${c.cliente_nombre}" 
                                   data-contacto="${w.nombre || c.cliente_nombre}" 
                                   data-tel="${w.numero}" 
                                   ${checked}
                                   onchange="actualizarContadoresDifusion()">
                            <span style="color: #15803d; font-weight: 600;">📞 ${w.numero}</span>
                            <span style="color: #64748b;">(${w.nombre || 'Contacto'}${w.cargo ? ' - ' + w.cargo : ''})</span>
                            ${tagPred}
                        </label>
                    `;
                }).join('')
                : '<span style="color: #94a3b8; font-size: 0.74rem; font-style: italic;">Sin teléfono registrado</span>';

            const emailItems = (c.email_contactos && c.email_contactos.length > 0)
                ? c.email_contactos.map(e => {
                    const checked = e.default ? 'checked' : '';
                    let tagPred = '';
                    if (e.es_predeterminado_difusion) {
                        tagPred = '<span style="color: #7e22ce; font-size: 0.66rem; font-weight: 700; background: #faf5ff; border: 1px solid #d8b4fe; padding: 1px 4px; border-radius: 4px;" title="Contacto predeterminado guardado para difusión">★ Difusión</span>';
                    } else if (e.default) {
                        tagPred = '<span style="color: #2563eb; font-size: 0.66rem; font-weight: 600; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 4px; border-radius: 4px;" title="Predeterminado sugerido">Predet.</span>';
                    }

                    return `
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.77rem; color: #1e293b; cursor: pointer; margin-bottom: 3px;">
                            <input type="checkbox" name="difusion_email_check" 
                                   value="${c.bunker_cliente_id}" 
                                   data-cliente-id="${c.bunker_cliente_id}"
                                   data-lista-id="${lId}"
                                   data-nombre="${c.cliente_nombre}" 
                                   data-contacto="${e.nombre || c.cliente_nombre}" 
                                   data-email="${e.email}" 
                                   ${checked}
                                   onchange="actualizarContadoresDifusion()">
                            <span style="color: #1d4ed8; font-weight: 600;">✉️ ${e.email}</span>
                            <span style="color: #64748b;">(${e.nombre || 'Contacto'}${e.cargo ? ' - ' + e.cargo : ''})</span>
                            ${tagPred}
                        </label>
                    `;
                }).join('')
                : '<span style="color: #94a3b8; font-size: 0.74rem; font-style: italic;">Sin correo registrado</span>';

            const bgColor = (idx % 2 === 0) ? '#ffffff' : '#fcfcfd';

            return `
                <div class="difusion-cliente-card" style="border-bottom: 1px solid #f1f5f9; padding: 7px 10px; display: grid; grid-template-columns: 210px 1fr 1fr; gap: 10px; align-items: start; background: ${bgColor};">
                    <div>
                        <strong style="font-size: 0.83rem; color: #0f172a; display: block; line-height: 1.2;">${c.cliente_nombre}</strong>
                        ${c.razon_social ? `<span style="font-size: 0.72rem; color: #64748b; display: block; margin-top: 1px;">${c.razon_social}</span>` : ''}
                        <span style="font-size: 0.69rem; color: #94a3b8; display: block; margin-top: 2px;">Cód: ${c.codigo_bunker_cliente || c.bunker_cliente_id}</span>
                    </div>
                    <div style="background: #f0fdf4; border-radius: 6px; padding: 5px 8px; border: 1px solid #dcfce7;">
                        ${wpItems}
                    </div>
                    <div style="background: #f8fafc; border-radius: 6px; padding: 5px 8px; border: 1px solid #e2e8f0;">
                        ${emailItems}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="difusion-grupo-lista" id="grupo-lista-${lId}" style="border: 1.5px solid #cbd5e1; border-radius: 8px; margin-bottom: 10px; overflow: hidden; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <!-- Header de la Lista de Precios -->
                <div style="background: #f8fafc; padding: 7px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="check-lista-${lId}" class="master-check-lista" 
                               data-lista-id="${lId}" 
                               style="cursor: pointer; width: 16px; height: 16px;" 
                               onchange="toggleListaCompleta('${lId}', this.checked)"
                               title="Marcar / Desmarcar todos los contactos de ${grupo.lista_nombre}">
                        <label for="check-lista-${lId}" style="font-weight: 700; font-size: 0.88rem; color: #0f172a; cursor: pointer; display: flex; align-items: center; gap: 6px; margin: 0;">
                            <span>📋 ${grupo.lista_nombre}</span>
                            <span style="font-size: 0.72rem; font-weight: 700; background: #e2e8f0; color: #334155; padding: 1px 7px; border-radius: 10px;">
                                ${grupo.clientes.length} clientes
                            </span>
                        </label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button type="button" class="btn-action" style="font-size: 0.72rem; padding: 2px 7px; background: #ecfdf5; border-color: #86efac; color: #166534;" onclick="toggleListaCanal('${lId}', 'wa')" title="Invertir / Marcar todos los WhatsApp de esta lista">
                            🟢 WA
                        </button>
                        <button type="button" class="btn-action" style="font-size: 0.72rem; padding: 2px 7px; background: #eff6ff; border-color: #93c5fd; color: #1d4ed8;" onclick="toggleListaCanal('${lId}', 'email')" title="Invertir / Marcar todos los Emails de esta lista">
                            ✉️ Email
                        </button>
                        <button type="button" class="btn-action" style="font-size: 0.72rem; padding: 2px 8px; background: #ffffff; border-color: #cbd5e1; color: #475569;" onclick="toggleAcordeonLista('${lId}')" title="Plegar / Desplegar clientes">
                            <span id="chevron-lista-${lId}" style="display: inline-block; transition: transform 0.2s;">▼</span>
                        </button>
                    </div>
                </div>

                <!-- Acordeón Desplegable de Clientes -->
                <div id="cuerpo-lista-${lId}" style="display: block;">
                    ${clientesCardsHtml}
                </div>
            </div>
        `;
    }).join('');

    listCont.innerHTML = listaHtmlArr;
}

function toggleListaCompleta(listaId, checked) {
    const checks = document.querySelectorAll(`input[name="difusion_wp_check"][data-lista-id="${listaId}"], input[name="difusion_email_check"][data-lista-id="${listaId}"]`);
    checks.forEach(c => c.checked = checked);
    actualizarContadoresDifusion();
}

function toggleListaCanal(listaId, canal) {
    const inputName = (canal === 'wa') ? 'difusion_wp_check' : 'difusion_email_check';
    const checks = document.querySelectorAll(`input[name="${inputName}"][data-lista-id="${listaId}"]`);
    if (checks.length === 0) return;
    const todosMarcados = Array.from(checks).every(c => c.checked);
    checks.forEach(c => c.checked = !todosMarcados);
    actualizarContadoresDifusion();
}

function toggleAcordeonLista(listaId) {
    const cuerpo = document.getElementById(`cuerpo-lista-${listaId}`);
    const chevron = document.getElementById(`chevron-lista-${listaId}`);
    if (!cuerpo) return;
    if (cuerpo.style.display === 'none') {
        cuerpo.style.display = 'block';
        if (chevron) chevron.textContent = '▼';
    } else {
        cuerpo.style.display = 'none';
        if (chevron) chevron.textContent = '►';
    }
}

async function guardarPredeterminadosDifusion() {
    if (!difusionDestinatariosCache || difusionDestinatariosCache.length === 0) {
        Swal.fire('Atención', 'No hay clientes cargados en la difusión.', 'info');
        return;
    }

    const payloadClientes = [];

    difusionDestinatariosCache.forEach(c => {
        const wpChecked = Array.from(
            document.querySelectorAll(`input[name="difusion_wp_check"][data-cliente-id="${c.bunker_cliente_id}"]:checked`)
        ).map(ch => ch.getAttribute('data-tel')).filter(Boolean);

        const emailChecked = Array.from(
            document.querySelectorAll(`input[name="difusion_email_check"][data-cliente-id="${c.bunker_cliente_id}"]:checked`)
        ).map(ch => ch.getAttribute('data-email')).filter(Boolean);

        payloadClientes.push({
            bunker_cliente_id: c.bunker_cliente_id,
            telefonos_seleccionados: wpChecked,
            emails_seleccionados: emailChecked
        });
    });

    try {
        Swal.fire({
            title: 'Guardando predeterminados...',
            text: 'Registrando configuración exclusiva para difusión omnicanal.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await fetch('/api/ofertas-dinamicas/guardar-predeterminados-difusion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientes: payloadClientes })
        });
        const data = await res.json();

        if (data.success) {
            // Actualizar difusionDestinatariosCache en memoria para reflejar 'es_predeterminado_difusion' y 'default'
            payloadClientes.forEach(item => {
                const cliCached = difusionDestinatariosCache.find(x => x.bunker_cliente_id === item.bunker_cliente_id);
                if (cliCached) {
                    const tels = item.telefonos_seleccionados.map(t => String(t).replace(/\D/g, ''));
                    (cliCached.whatsapp_contactos || []).forEach(w => {
                        const cleanNum = String(w.numero || '').replace(/\D/g, '');
                        w.default = tels.includes(cleanNum);
                        w.es_predeterminado_difusion = tels.includes(cleanNum);
                    });

                    const emails = item.emails_seleccionados.map(e => String(e).trim().toLowerCase());
                    (cliCached.email_contactos || []).forEach(e => {
                        const cleanMail = String(e.email || '').trim().toLowerCase();
                        e.default = emails.includes(cleanMail);
                        e.es_predeterminado_difusion = emails.includes(cleanMail);
                    });
                }
            });

            // Re-render sin perder filtros y actualizar contadores
            renderDestinatariosModalDifusion();
            actualizarContadoresDifusion();

            Swal.fire({
                title: '¡Predeterminados Guardados!',
                text: data.message || 'Se guardaron los contactos predeterminados de difusión exclusivamente.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            Swal.fire('Error', data.error || 'No se pudieron guardar los predeterminados.', 'error');
        }
    } catch (err) {
        Swal.fire('Error de Conexión', err.message, 'error');
    }
}

function filtrarClientesModalDifusion() {
    renderDestinatariosModalDifusion();
    actualizarContadoresDifusion();
}

function toggleCanalDestinatarios(canal) {
    if (canal === 'wa') {
        const checks = document.querySelectorAll('input[name="difusion_wp_check"]');
        const todosMarcados = Array.from(checks).every(c => c.checked);
        checks.forEach(c => c.checked = !todosMarcados);
    } else if (canal === 'email') {
        const checks = document.querySelectorAll('input[name="difusion_email_check"]');
        const todosMarcados = Array.from(checks).every(c => c.checked);
        checks.forEach(c => c.checked = !todosMarcados);
    }
    actualizarContadoresDifusion();
}

function actualizarContadoresDifusion() {
    const wpChecks = document.querySelectorAll('input[name="difusion_wp_check"]:checked');
    const emailChecks = document.querySelectorAll('input[name="difusion_email_check"]:checked');

    const clientesConCanal = new Set();
    wpChecks.forEach(ch => clientesConCanal.add(ch.getAttribute('data-cliente-id') || ch.value));
    emailChecks.forEach(ch => clientesConCanal.add(ch.getAttribute('data-cliente-id') || ch.value));

    const resumenBadges = document.getElementById('difusion-resumen-badges');
    if (resumenBadges) {
        resumenBadges.innerHTML = `<strong>${clientesConCanal.size}</strong> de ${difusionDestinatariosCache.length} clientes (<span id="count-wa" style="color: #16a34a;">${wpChecks.length} WhatsApp</span> | <span id="count-em" style="color: #2563eb;">${emailChecks.length} Email</span>)`;
    }

    const countWaEl = document.getElementById('count-wa');
    if (countWaEl) countWaEl.textContent = `${wpChecks.length} WhatsApp`;

    const countEmEl = document.getElementById('count-em');
    if (countEmEl) countEmEl.textContent = `${emailChecks.length} Email`;

    const footerInfo = document.getElementById('difusion-footer-info');
    if (footerInfo) {
        footerInfo.innerHTML = `Listo para despachar: <strong>${wpChecks.length}</strong> WhatsApp (intervalo 1.8s) y <strong>${emailChecks.length}</strong> Correos a <strong>${clientesConCanal.size}</strong> cliente(s).`;
    }

    // Actualizar estado de los checkboxes master por lista
    const masterChecks = document.querySelectorAll('.master-check-lista');
    masterChecks.forEach(mc => {
        const lId = mc.getAttribute('data-lista-id');
        const checksGrupo = document.querySelectorAll(`input[name="difusion_wp_check"][data-lista-id="${lId}"], input[name="difusion_email_check"][data-lista-id="${lId}"]`);
        if (checksGrupo.length > 0) {
            const marcados = Array.from(checksGrupo).filter(c => c.checked).length;
            mc.checked = (marcados === checksGrupo.length);
            mc.indeterminate = (marcados > 0 && marcados < checksGrupo.length);
        }
    });
}

function cerrarModalDifusion() {
    document.getElementById('modal-difusion').style.display = 'none';
}

async function ejecutarDifusionCascada() {
    const ofertaId = document.getElementById('difusion-oferta-id').value;
    const mensajeUnificado = (document.getElementById('difusion-mensaje-textarea')?.value || '').trim();
    const asuntoEmail = (document.getElementById('difusion-email-asunto')?.value || '').trim();
    const guardarPredeterminados = document.getElementById('difusion-guardar-predeterminados')?.checked || false;

    const wpChecks = document.querySelectorAll('input[name="difusion_wp_check"]:checked');
    const emailChecks = document.querySelectorAll('input[name="difusion_email_check"]:checked');

    const destinatarios_whatsapp = Array.from(wpChecks).map(ch => ({
        bunker_cliente_id: parseInt(ch.getAttribute('data-cliente-id') || ch.value, 10),
        cliente_nombre: ch.getAttribute('data-nombre'),
        contacto_nombre: ch.getAttribute('data-contacto'),
        telefono: ch.getAttribute('data-tel')
    }));

    const destinatarios_email = Array.from(emailChecks).map(ch => ({
        bunker_cliente_id: parseInt(ch.getAttribute('data-cliente-id') || ch.value, 10),
        cliente_nombre: ch.getAttribute('data-nombre'),
        contacto_nombre: ch.getAttribute('data-contacto'),
        email: ch.getAttribute('data-email')
    }));

    if (destinatarios_whatsapp.length === 0 && destinatarios_email.length === 0) {
        Swal.fire('Atención', 'Seleccione al menos un destinatario (WhatsApp o Email) para iniciar la difusión.', 'warning');
        return;
    }

    if (!mensajeUnificado) {
        Swal.fire('Atención', 'El cuerpo del mensaje de difusión no puede estar vacío.', 'warning');
        return;
    }

    const clientesSet = new Set([
        ...destinatarios_whatsapp.map(w => w.bunker_cliente_id),
        ...destinatarios_email.map(e => e.bunker_cliente_id)
    ]);

    const confirm = await Swal.fire({
        title: '¿Iniciar Difusión Omnicanal?',
        html: `
            Se iniciará la cascada comercial para:<br>
            • <strong>${destinatarios_whatsapp.length} mensaje(s) de WhatsApp</strong> (1 cada 1.8 segundos).<br>
            • <strong>${destinatarios_email.length} correo(s) electrónico(s)</strong> institucionales.<br>
            • <strong>${clientesSet.size} cliente(s)</strong> destinatarios en total.<br>
            ${guardarPredeterminados ? '<br><small style="color: #059669;">✓ Se guardará la selección de contactos como predeterminada de difusión.</small>' : ''}
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        confirmButtonText: '🚀 Sí, despachar cascada',
        cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
        try {
            Swal.fire({
                title: 'Iniciando despacho omnicanal...',
                text: 'La cola de difusión se está ejecutando en segundo plano en el servidor local.',
                icon: 'info',
                timer: 2500,
                showConfirmButton: false
            });

            const res = await fetch(`/api/ofertas-dinamicas/${ofertaId}/difundir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios_whatsapp,
                    destinatarios_email,
                    plantilla_whatsapp: mensajeUnificado,
                    asunto_email: asuntoEmail,
                    plantilla_email: mensajeUnificado,
                    guardar_predeterminados: guardarPredeterminados
                })
            });
            const data = await res.json();

            if (data.success) {
                Swal.fire({
                    title: '¡Difusión en Proceso!',
                    text: data.message,
                    icon: 'success'
                });
                cerrarModalDifusion();
            } else {
                Swal.fire('Error', data.error || 'No se pudo iniciar la difusión', 'error');
            }
        } catch (e) {
            Swal.fire('Error de Conexión', e.message, 'error');
        }
    }
}

// =========================================================================
// 8. ESTADO DE SINCRONIZACIÓN AUTOMÁTICA CLOUD B2B
// =========================================================================

async function consultarSyncStatus() {
    try {
        const res = await fetch('/api/ofertas-dinamicas/sync-b2b/status');
        const data = await res.json();
        if (data.success && data.data) {
            actualizarBadgeCloud(data.data.estado);
        }
    } catch (e) {
        actualizarBadgeCloud('ERROR');
    }
}

function actualizarBadgeCloud(estado) {
    const dot = document.getElementById('sync-dot');
    const txt = document.getElementById('cloud-sync-text');
    if (!dot || !txt) return;

    dot.className = 'sync-dot';
    if (estado === 'SYNCING') {
        dot.classList.add('syncing');
        txt.textContent = 'Sincronizando B2B...';
    } else if (estado === 'ERROR') {
        dot.classList.add('error');
        txt.textContent = 'B2B Auto-sync Activo';
    } else {
        txt.textContent = 'B2B Cloud Conectado';
    }
}

window.forzarSyncB2BManual = async function() {
    actualizarBadgeCloud('SYNCING');
    Swal.fire({
        title: 'Sincronización Automática con B2B',
        html: 'Las ofertas se sincronizan en tiempo real con Supabase Cloud cada vez que se crea, edita o consume cuota.<br><br>¿Deseas verificar la sincronización ahora?',
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Verificar ahora',
        cancelButtonText: 'Cerrar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'Sincronizando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await fetch('/api/ofertas-dinamicas/sync-b2b', { method: 'POST' });
                let data = null;
                try {
                    data = await res.json();
                } catch {
                    const txt = await res.text();
                    throw new Error(txt || `Error del servidor HTTP ${res.status}`);
                }
                if (data && data.success) {
                    actualizarBadgeCloud('SUCCESS');
                    Swal.fire('¡Sincronizado!', 'Las ofertas están 100% al día en Supabase Cloud.', 'success');
                } else {
                    actualizarBadgeCloud('ERROR');
                    Swal.fire('Aviso', (data && data.error) || 'Error al sincronizar con Supabase Cloud.', 'warning');
                }
            } catch (err) {
                actualizarBadgeCloud('ERROR');
                Swal.fire('Error', err.message, 'error');
            }
        }
    });
};

// Exportar funciones globales
window.abrirModalNuevaOferta = abrirModalNuevaOferta;
window.abrirModalEditarOferta = abrirModalEditarOferta;
window.cerrarModalOferta = cerrarModalOferta;
window.guardarOfertaSubmit = guardarOfertaSubmit;
window.cambiarEstadoOferta = cambiarEstadoOferta;
window.eliminarOferta = eliminarOferta;
window.abrirModalDifusion = abrirModalDifusion;
window.cerrarModalDifusion = cerrarModalDifusion;
window.toggleCanalDestinatarios = toggleCanalDestinatarios;
window.filtrarClientesModalDifusion = filtrarClientesModalDifusion;
window.actualizarContadoresDifusion = actualizarContadoresDifusion;
window.ejecutarDifusionCascada = ejecutarDifusionCascada;
window.toggleFechaFin = toggleFechaFin;
window.filtrarEstado = filtrarEstado;
window.filtrarOfertasEnVivo = filtrarOfertasEnVivo;
window.limpiarBuscadorOfertas = limpiarBuscadorOfertas;
window.filtrarArticulosModalEnVivo = filtrarArticulosModalEnVivo;
window.limpiarBuscadorArticulosModal = limpiarBuscadorArticulosModal;
window.agregarArticuloModal = agregarArticuloModal;
window.agregarGrupoArticulosModal = agregarGrupoArticulosModal;
window.removerArticuloModal = removerArticuloModal;
window.limpiarTodosArticulosSeleccionados = limpiarTodosArticulosSeleccionados;
window.actualizarCondicionCierreUI = actualizarCondicionCierreUI;
window.asignarSugerenciaCuota = asignarSugerenciaCuota;
window.actualizarStockReferenciaModal = actualizarStockReferenciaModal;
window.eliminarOfertaDesdeModal = eliminarOfertaDesdeModal;
window.guardarPredeterminadosDifusion = guardarPredeterminadosDifusion;
window.toggleListaCompleta = toggleListaCompleta;
window.toggleListaCanal = toggleListaCanal;
window.toggleAcordeonLista = toggleAcordeonLista;

