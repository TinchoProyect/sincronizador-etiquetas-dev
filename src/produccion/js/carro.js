
// ⏱️ Renderizador de Tarjeta de Métricas de Campo para Carro Finalizado/Archivado
function renderizarCardMetricasCarro(dataMed, articulos) {
    const durE1 = Number(dataMed.etapa1_duracion_ms || 0);
    const durE2 = Number(dataMed.etapa2_duracion_ms || 0);
    const durE3 = Number(dataMed.etapa3_duracion_ms || 0);
    const durPausa = Number(dataMed.tiempo_pausa_ms || 0);
    const durBruto = durE1 + durE2 + durE3;
    const durNetoTotal = Math.max(0, durBruto - durPausa);

    if (durNetoTotal <= 0 && (!dataMed.metricas || dataMed.metricas.length === 0)) {
        return '';
    }

    // Calcular unidades totales
    let totalUnidades = 0;
    if (dataMed.metricas && dataMed.metricas.length > 0) {
        totalUnidades = dataMed.metricas.reduce((acc, m) => acc + (parseFloat(m.unidades_producidas) || 1), 0);
    } else if (articulos && articulos.length > 0) {
        totalUnidades = articulos.reduce((acc, a) => acc + (parseFloat(a.cantidad) || 1), 0);
    }
    if (totalUnidades <= 0) totalUnidades = 1;

    const totalMinutosNetos = durNetoTotal / 60000;
    const minUnitTotal = totalMinutosNetos / totalUnidades;

    const factorNeto = durBruto > 0 ? (durNetoTotal / durBruto) : 1;
    const minE1Neto = (durE1 * factorNeto) / 60000;
    const minE2Neto = (durE2 * factorNeto) / 60000;
    const minE3Neto = (durE3 * factorNeto) / 60000;

    const minE1Unit = minE1Neto / totalUnidades;
    const minE2Unit = minE2Neto / totalUnidades;
    const minE3Unit = minE3Neto / totalUnidades;

    const fmtMs = (ms) => {
        if (!ms || ms <= 0) return '0s';
        const totalSeg = Math.round(ms / 1000);
        const m = Math.floor(totalSeg / 60);
        const s = totalSeg % 60;
        if (m === 0) return `${s}s`;
        if (s === 0) return `${m}m`;
        return `${m}m ${s}s`;
    };

    let filasArticulosHtml = '';
    const items = (dataMed.metricas && dataMed.metricas.length > 0) 
        ? dataMed.metricas 
        : (articulos || []).map(a => ({
            articulo_numero: a.numero,
            descripcion: a.descripcion,
            unidades_producidas: a.cantidad,
            minutos_unitarios_total: minUnitTotal,
            minutos_etapa1_unitario: minE1Unit,
            minutos_etapa2_unitario: minE2Unit,
            minutos_etapa3_unitario: minE3Unit
        }));

    items.forEach(item => {
        const cant = parseFloat(item.unidades_producidas || 1);
        const uTotal = parseFloat(item.minutos_unitarios_total || minUnitTotal).toFixed(2);
        const e1 = parseFloat(item.minutos_etapa1_unitario || minE1Unit).toFixed(2);
        const e2 = parseFloat(item.minutos_etapa2_unitario || minE2Unit).toFixed(2);
        const e3 = parseFloat(item.minutos_etapa3_unitario || minE3Unit).toFixed(2);

        filasArticulosHtml += `
            <tr>
                <td style="font-weight: 600; color: #1e293b;">
                    <span style="font-family: monospace; color: #0284c7; background: #e0f2fe; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">${item.articulo_numero}</span>
                    ${item.descripcion}
                </td>
                <td style="text-align: center; font-weight: bold; color: #334155;">${cant} u</td>
                <td style="text-align: center; color: #15803d; font-weight: 800; font-size: 13.5px; background: #f0fdf4;">${uTotal} min/u</td>
                <td style="text-align: center; color: #64748b; font-size: 11.5px;">${e1} m</td>
                <td style="text-align: center; color: #64748b; font-size: 11.5px;">${e2} m</td>
                <td style="text-align: center; color: #64748b; font-size: 11.5px;">${e3} m</td>
            </tr>
        `;
    });

    return `
        <div class="card-resumen-metricas-finalizado">
            <div class="resumen-metricas-header">
                <span class="resumen-metricas-titulo">
                    ⏱️ Métricas de Tiempo de Producción (Modo Medición)
                </span>
                <span class="metricas-badge-guardado">✅ Prorrateo Registrado</span>
            </div>

            <div class="resumen-metricas-grid">
                <div class="stat-box-metrica total">
                    <span class="stat-label-metrica">Tiempo Neto Total</span>
                    <span class="stat-value-metrica text-success">${fmtMs(durNetoTotal)}</span>
                    <span class="stat-sub-metrica">${totalMinutosNetos.toFixed(1)} min netos</span>
                </div>
                <div class="stat-box-metrica">
                    <span class="stat-label-metrica">🟡 1. Preparación</span>
                    <span class="stat-value-metrica">${fmtMs(durE1)}</span>
                    <span class="stat-sub-metrica">${(durE1 / 60000).toFixed(1)} min</span>
                </div>
                <div class="stat-box-metrica">
                    <span class="stat-label-metrica">🔵 2. Producción</span>
                    <span class="stat-value-metrica">${fmtMs(durE2)}</span>
                    <span class="stat-sub-metrica">${(durE2 / 60000).toFixed(1)} min</span>
                </div>
                <div class="stat-box-metrica">
                    <span class="stat-label-metrica">🟣 3. Etiquetado</span>
                    <span class="stat-value-metrica">${fmtMs(durE3)}</span>
                    <span class="stat-sub-metrica">${(durE3 / 60000).toFixed(1)} min</span>
                </div>
                <div class="stat-box-metrica">
                    <span class="stat-label-metrica">⏸️ Pausas</span>
                    <span class="stat-value-metrica">${fmtMs(durPausa)}</span>
                    <span class="stat-sub-metrica">descontadas</span>
                </div>
            </div>

            <div style="margin-top: 12px; margin-bottom: 4px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.3px;">
                📊 Desglose de Prorrateo Justo por Unidad Producida:
            </div>

            <div style="overflow-x: auto;">
                <table class="tabla-articulos-metricas">
                    <thead>
                        <tr>
                            <th>Artículo</th>
                            <th style="text-align: center;">Cantidad</th>
                            <th style="text-align: center; color: #15803d;">Costo Tiempo / Unidad</th>
                            <th style="text-align: center;">Prep / u</th>
                            <th style="text-align: center;">Prod / u</th>
                            <th style="text-align: center;">Etq / u</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasArticulosHtml}
                    </tbody>
                </table>
            </div>

            <div class="resumen-metricas-footer">
                <span>🟢 <strong>Integración Búnker:</strong> Estos valores empíricos están sincronizados con el <strong>Gestor de Precios</strong> en Logística para calibrar el asistente de mano de obra en tiempo real.</span>
            </div>
        </div>
    `;
}



import { mostrarError, estilosTablaCarros, agruparCarrosPorSemanas, agruparCarrosPorSemanasYMeses } from './utils.js';
import { abrirEdicionMix } from './mix.js';
import { limpiarIngresosManualesDelCarro, limpiarInformeIngresosManuales } from './ingresoManual.js';


// =========================================================================
// ESTIMACIÓN PREDICTIVA DE TIEMPOS DE PRODUCCIÓN (UI & CÁLCULO EN VIVO)
// =========================================================================

export function actualizarTopbarEstimacion(estimacion) {
    const container = document.getElementById('topbar-estimacion-tiempo');
    const valEl = document.getElementById('topbar-tiempo-val');
    const badgeEl = document.getElementById('topbar-tiempo-badge');

    if (!container || !valEl || !badgeEl) return;

    if (!estimacion || !estimacion.articulos || estimacion.articulos.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    valEl.textContent = estimacion.tiempo_formateado || '~ 0 min';

    // Clases del badge según origen
    badgeEl.className = 'badge-origen-tiempo';
    const origen = estimacion.origen_general || 'sin_datos';

    if (origen === 'planta') {
        badgeEl.classList.add('origen-planta');
        badgeEl.innerHTML = '🟢 Planta';
        badgeEl.title = 'Basado 100% en evidencia empírica real de mediciones en planta';
    } else if (origen === 'mixto' || origen === 'planta_parcial') {
        badgeEl.classList.add('origen-mixto');
        badgeEl.innerHTML = '🔵 Planta + Teórico';
        badgeEl.title = `Combinación de mediciones reales (${estimacion.articulos_con_planta || 0}) y teóricas (${estimacion.articulos_con_arbitraria || 0})`;
    } else if (origen === 'arbitraria') {
        badgeEl.classList.add('origen-arbitraria');
        badgeEl.innerHTML = '🟡 Teórico';
        badgeEl.title = 'Basado en tiempos teóricos configurados en el asistente de Búnker';
    } else {
        badgeEl.classList.add('origen-sin-datos');
        badgeEl.innerHTML = '⚪ Sin datos';
        badgeEl.title = 'No hay registros de tiempo en planta ni estimaciones en Búnker para estos artículos';
    }
}
window.actualizarTopbarEstimacion = actualizarTopbarEstimacion;

export function recalcularEstimacionesEnCaliente() {
    const containers = document.querySelectorAll('.articulo-container');
    let tiempoTotalMinutos = 0;
    let conPlanta = 0;
    let conArbitraria = 0;
    let totalArticulos = 0;

    containers.forEach(cont => {
        const cod = cont.dataset.numero;
        if (!cod) return;
        totalArticulos++;

        const inputCant = cont.querySelector('.input-cantidad-articulo');
        const badgeCant = cont.querySelector('.cantidad-badge-readonly');
        let cant = 1;
        if (inputCant) {
            cant = parseFloat(inputCant.value) || 0;
        } else if (badgeCant) {
            cant = parseFloat(badgeCant.textContent) || 1;
        }

        const est = window._estimacionArticulosMap ? window._estimacionArticulosMap[cod] : null;
        if (!est || !est.minutos_unitarios || cant <= 0) {
            return;
        }

        const subtotal = Number((est.minutos_unitarios * cant).toFixed(2));
        tiempoTotalMinutos += subtotal;

        if (est.origen === 'planta') conPlanta++;
        else if (est.origen === 'arbitraria') conArbitraria++;

        // Actualizar rengloncito del artículo
        const renglon = cont.querySelector(`#renglon-tiempo-${cod}`);
        if (renglon) {
            const calcCant = renglon.querySelector('.calc-cant');
            if (calcCant) calcCant.textContent = cant;

            const calcSubtotal = renglon.querySelector('.calc-subtotal');
            if (calcSubtotal) {
                const subStr = subtotal < 1 ? `${Math.round(subtotal * 60)} seg` : `${subtotal.toFixed(1)} min`;
                calcSubtotal.textContent = `~ ${subStr}`;
            }
        }
    });

    // Formatear tiempo humano
    let tiempoFormateado = '0 min';
    if (tiempoTotalMinutos > 0) {
        if (tiempoTotalMinutos < 1) {
            tiempoFormateado = `~ ${Math.round(tiempoTotalMinutos * 60)} seg`;
        } else {
            const h = Math.floor(tiempoTotalMinutos / 60);
            const m = Math.floor(tiempoTotalMinutos % 60);
            const s = Math.round((tiempoTotalMinutos - Math.floor(tiempoTotalMinutos)) * 60);
            if (h > 0) {
                tiempoFormateado = m > 0 ? `~ ${h}h ${m}m` : `~ ${h}h`;
            } else if (s > 0 && m < 5) {
                tiempoFormateado = `~ ${m}m ${s}s`;
            } else {
                tiempoFormateado = `~ ${Math.round(tiempoTotalMinutos)} min`;
            }
        }
    }

    let origenGeneral = 'sin_datos';
    const conTiempo = conPlanta + conArbitraria;
    if (conTiempo > 0) {
        if (conPlanta === totalArticulos) origenGeneral = 'planta';
        else if (conPlanta > 0 && conArbitraria > 0) origenGeneral = 'mixto';
        else if (conPlanta > 0) origenGeneral = 'planta_parcial';
        else origenGeneral = 'arbitraria';
    }

    actualizarTopbarEstimacion({
        articulos: new Array(totalArticulos),
        tiempo_total_minutos: tiempoTotalMinutos,
        tiempo_formateado: tiempoFormateado,
        origen_general: origenGeneral,
        articulos_con_planta: conPlanta,
        articulos_con_arbitraria: conArbitraria
    });
}
window.recalcularEstimacionesEnCaliente = recalcularEstimacionesEnCaliente;

// Listener en caliente para cambios de cantidad al tipear o usar stepper
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('input-cantidad-articulo')) {
        recalcularEstimacionesEnCaliente();
    }
});

// Modal de desglose al hacer click en el widget del topbar
window.mostrarDetalleEstimacionCarro = function() {
    const containers = document.querySelectorAll('.articulo-container');
    if (!containers || containers.length === 0) {
        Swal.fire({
            title: 'Carro Vacío',
            text: 'No hay artículos en el carro para estimar el tiempo de producción.',
            icon: 'info',
            confirmButtonColor: '#007bff'
        });
        return;
    }

    let filasHtml = '';
    let totalMinutos = 0;
    let cantPlanta = 0;
    let cantTeorico = 0;
    let cantSinDatos = 0;

    containers.forEach(cont => {
        const cod = cont.dataset.numero;
        const desc = cont.querySelector('.articulo-descripcion')?.textContent || cod;
        const inputCant = cont.querySelector('.input-cantidad-articulo');
        const badgeCant = cont.querySelector('.cantidad-badge-readonly');
        let cant = 1;
        if (inputCant) cant = parseFloat(inputCant.value) || 0;
        else if (badgeCant) cant = parseFloat(badgeCant.textContent) || 1;

        const est = window._estimacionArticulosMap ? window._estimacionArticulosMap[cod] : null;
        let badgeHtml = '<span style="background: #f1f5f9; color: #64748b; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">⚪ Sin datos</span>';
        let unitStr = '-';
        let subtotalStr = '-';

        if (est && est.origen === 'planta') {
            cantPlanta++;
            const sub = Number((est.minutos_unitarios * cant).toFixed(2));
            totalMinutos += sub;
            unitStr = `${est.minutos_unitarios.toFixed(2)} m/u`;
            subtotalStr = sub < 1 ? `${Math.round(sub * 60)} seg` : `${sub.toFixed(1)} min`;
            badgeHtml = `<span style="background: #ecfdf5; color: #065f46; border: 1px solid #10b981; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;">🟢 Planta (${est.detalle || 'Medición real'})` + '</span>';
        } else if (est && est.origen === 'arbitraria') {
            cantTeorico++;
            const sub = Number((est.minutos_unitarios * cant).toFixed(2));
            totalMinutos += sub;
            unitStr = `${est.minutos_unitarios.toFixed(2)} m/u`;
            subtotalStr = sub < 1 ? `${Math.round(sub * 60)} seg` : `${sub.toFixed(1)} min`;
            badgeHtml = '<span style="background: #fffbeb; color: #92400e; border: 1px solid #f59e0b; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700;">🟡 Teórico Búnker</span>';
        } else {
            cantSinDatos++;
        }

        filasHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px; text-align: left;">
                    <div style="font-weight: 700; color: #1e293b;">${cod}</div>
                    <div style="font-size: 11.5px; color: #64748b;">${desc}</div>
                </td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 700;">${cant} u</td>
                <td style="padding: 8px 10px; text-align: center; color: #475569;">${unitStr}</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 800; color: #0f172a;">${subtotalStr}</td>
                <td style="padding: 8px 10px; text-align: center;">${badgeHtml}</td>
            </tr>
        `;
    });

    const horas = Math.floor(totalMinutos / 60);
    const mins = Math.floor(totalMinutos % 60);
    const tiempoTotalTexto = horas > 0 ? (mins > 0 ? `~ ${horas}h ${mins}m` : `~ ${horas}h`) : `~ ${Math.round(totalMinutos)} min`;

    Swal.fire({
        title: '<div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 20px;">⏳ Estimación de Tiempos del Carro</div>',
        html: `
            <div style="text-align: left; font-size: 13px;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 15px;">
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Demora Total Estimada</div>
                        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">${tiempoTotalTexto}</div>
                    </div>
                    <div style="text-align: right; font-size: 12px; color: #475569;">
                        <div>🟢 ${cantPlanta} de planta</div>
                        <div>🟡 ${cantTeorico} teóricos</div>
                        <div>⚪ ${cantSinDatos} sin datos</div>
                    </div>
                </div>

                <div style="max-height: 350px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <thead style="background: #f1f5f9; position: sticky; top: 0;">
                            <tr>
                                <th style="padding: 8px 10px; text-align: left;">Artículo</th>
                                <th style="padding: 8px 10px; text-align: center;">Cant.</th>
                                <th style="padding: 8px 10px; text-align: center;">Unitario</th>
                                <th style="padding: 8px 10px; text-align: center;">Subtotal</th>
                                <th style="padding: 8px 10px; text-align: center;">Fuente</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasHtml}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top: 10px; font-size: 11px; color: #94a3b8; text-align: center;">
                    💡 La estimación prioriza métricas reales tomadas con el cronómetro de planta. Si no hay registros, toma la mano de obra teórica de Búnker.
                </div>
            </div>
        `,
        width: '650px',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#007bff'
    });
};



// Hacer la función disponible globalmente
window.editarIngredienteCompuesto = async (mixId) => {
    try {
        console.log('🔧 editarIngredienteCompuesto llamado con:', mixId, typeof mixId);

        if (!mixId) {
            console.error('❌ editarIngredienteCompuesto: mixId no proporcionado');
            mostrarError('No se pudo identificar el mix a editar');
            return;
        }

        // Si mixId es un objeto
        let actualMixId = mixId;
        if (typeof mixId === 'object' && mixId !== null && mixId.id) {
            actualMixId = mixId.id;
        }

        // Si mixId es un string con número ("124")
        if (typeof actualMixId === 'string' && !isNaN(Number(actualMixId))) {
            actualMixId = parseInt(actualMixId, 10);
        }

        // Si mixId es un string (nombre), necesitamos obtener el ID
        if (typeof actualMixId === 'string') {
            console.log('🔍 Buscando ID para ingrediente:', actualMixId);
            try {
                const response = await fetch(`/api/produccion/ingredientes/buscar?nombre=${encodeURIComponent(actualMixId)}`);
                if (!response.ok) {
                    throw new Error(`No se encontró el ingrediente: ${actualMixId}`);
                }
                const data = await response.json();
                actualMixId = data.id;
                console.log('✅ ID encontrado:', actualMixId);
            } catch (error) {
                console.error('❌ Error buscando ID del ingrediente:', error);
                throw error;
            }
        }

        // Configurar la función de actualización para cuando se guarde el modal
        window.actualizarResumenIngredientes = async () => {
            const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
            const colaboradorData = localStorage.getItem('colaboradorActivo');

            if (carroId && colaboradorData) {
                const colaborador = JSON.parse(colaboradorData);

                // Actualizar resumen de ingredientes
                const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
                mostrarResumenIngredientes(ingredientes);

                // Actualizar resumen de mixes
                const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
                mostrarResumenMixes(mixes);

                // Actualizar lista desplegable de artículos del carro
                if (typeof mostrarArticulosDelCarro === 'function') {
                    await mostrarArticulosDelCarro();
                }
            }
        };

        console.log('🚀 Abriendo modal para mix ID:', actualMixId);
        console.log('🔗 Llamando a abrirEdicionMix desde carro.js...');
        // Mostrar el modal de edición de composición del mix
        await abrirEdicionMix(actualMixId);
        console.log('✅ abrirEdicionMix completado');

    } catch (error) {
        console.error('Error al editar ingrediente compuesto:', error);
        mostrarError('No se pudo abrir el editor de ingrediente compuesto');
    }
};

// Función para actualizar la información visual del carro activo
export async function actualizarEstadoCarro() {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const wsContainer = document.getElementById('workspace-container');
    if (wsContainer) {
        if (carroId) wsContainer.dataset.carroId = carroId;
        else delete wsContainer.dataset.carroId;
    }
    const carroInfo = document.getElementById('carro-actual');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!colaboradorData) {
        carroInfo.innerHTML = '<p>No hay colaborador seleccionado</p>';
        return;
    }

    const colaborador = JSON.parse(colaboradorData);

    try {
        console.log('Obteniendo carros para usuario:', colaborador.id);
        // Obtener todos los carros del usuario
        const response = await fetch(`http://localhost:3002/api/produccion/usuario/${colaborador.id}/carros`);

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Error response:', errorData);
            throw new Error(errorData.error || 'Error al obtener carros del usuario');
        }

        let carros = await response.json();

        // Ordenar carros por fecha (más reciente primero)
        carros = carros.sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio));

        // INMERSIÓN VISUAL: Activar atmósfera si el carro activo es externo
        const workspaceContainer = document.getElementById('workspace-container');
        const topbarTitulo = document.querySelector('.topbar-titulo');
        const carroActivoObj = carros.find(c => c.id.toString() === carroId);
        
        if (carroActivoObj && carroActivoObj.tipo_carro === 'externa') {
            document.body.classList.add('contexto-externo');
            if (workspaceContainer) workspaceContainer.classList.add('theme-externo');
            if (topbarTitulo) {
                const tituloLinea = carroActivoObj.nombre_linea_negocio ? ('MODO EXTERNO — ' + carroActivoObj.nombre_linea_negocio) : 'MODO EXTERNO';
                topbarTitulo.innerHTML = '🚚 Producción <span class="badge-externo">' + tituloLinea + '</span>';
            }
        } else {
            document.body.classList.remove('contexto-externo');
            if (workspaceContainer) workspaceContainer.classList.remove('theme-externo');
            if (topbarTitulo) {
                if (carroActivoObj && Number(carroActivoObj.linea_negocio) === 3) {
                    topbarTitulo.innerHTML = '🏭 Producción <span style="background: #dcfce7; color: #166534; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 12px; border: 1px solid #86efac; margin-left: 8px;">🥣 LÍNEA 3 — ARTÍCULOS PUENTE / MIX X KILO (1° ETAPA)</span>';
                } else if (carroActivoObj && Number(carroActivoObj.linea_negocio) === 2) {
                    topbarTitulo.innerHTML = '🏭 Producción <span style="background: #e0f2fe; color: #075985; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 12px; border: 1px solid #7dd3fc; margin-left: 8px;">📦 LÍNEA 2 — FRACCIONES COMERCIALES (2° ETAPA)</span>';
                } else {
                    topbarTitulo.innerHTML = '🏭 Producción';
                }
            }
        }

        if (carros.length === 0) {
            carroInfo.innerHTML = `
                <div class="no-carros">
                    <p>Este usuario aún no tiene carros activos.</p>
                    <p>Podés crear uno nuevo para comenzar.</p>
                </div>
            `;
            return;
        }

        // Verificar permisos para mostrar opción de producción externa en el modal global
        try {
            if (colaborador.rol_id != null) {
                const respPerm = await fetch(
                    `http://localhost:3002/api/roles/${encodeURIComponent(colaborador.rol_id)}/permisos`
                );
                if (respPerm.ok) {
                    const permisos = await respPerm.json();
                    const tienePermisoExterno = Array.isArray(permisos) &&
                        permisos.some(p => p.nombre === 'ProduccionesExternas');

                    const btnOpExterna = document.getElementById('btn-opcion-externa');
                    if (btnOpExterna) {
                        btnOpExterna.style.display = tienePermisoExterno ? 'flex' : 'none';
                    }
                } else {
                    console.debug('[ROLES] permisos HTTP', respPerm.status);
                }
            } else {
                console.debug('[ROLES] colaborador.rol_id es null/undefined');
            }
        } catch (error) {
            console.debug('[ROLES] error obteniendo permisos:', error);
        }

        // Agrupar carros por semanas y meses (nueva funcionalidad mixta)
        const gruposMixtos = agruparCarrosPorSemanasYMeses(carros);

        // Construir HTML con agrupación mixta
        let html = `
            <div class="carros-lista">
                <h3>Tus carros de producción</h3>
        `;

        gruposMixtos.forEach((grupo, indiceGrupo) => {
            const claseGrupo = grupo.esActual ? 'semana-actual' : '';
            const totalCarros = grupo.carros.length;
            const esGrupoMensual = grupo.anio !== undefined; // Los grupos mensuales tienen propiedades anio y mes

            // 🔍 DEPURACIÓN: Determinar si el grupo debe estar expandido por defecto
            const esEstaSemanaSoloExpandida = grupo.etiqueta.includes('Esta semana');
            console.log(`🔍 DEBUG EXPANSIÓN - Grupo: "${grupo.etiqueta}" | Es "Esta semana": ${esEstaSemanaSoloExpandida}`);

            const estaExpandido = esEstaSemanaSoloExpandida;
            const indicadorColapso = estaExpandido ? '▼' : '▶';
            const displayTabla = estaExpandido ? 'table' : 'none';
            const claseColapsado = estaExpandido ? '' : 'colapsado';

            console.log(`🔍 DEBUG EXPANSIÓN - Resultado: expandido=${estaExpandido}, display=${displayTabla}, clase="${claseColapsado}"`);

            html += `
                <div class="grupo-temporal ${claseGrupo} ${esGrupoMensual ? 'grupo-mensual' : 'grupo-semanal'} ${claseColapsado}" data-grupo="${indiceGrupo}">
                    <div class="header-grupo-temporal" onclick="toggleGrupoTemporal(${indiceGrupo})">
                        <div class="etiqueta-temporal">
                            ${grupo.etiqueta}
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="contador-carros">${totalCarros} carro${totalCarros !== 1 ? 's' : ''}</span>
                            <span class="indicador-colapso">${indicadorColapso}</span>
                        </div>
                    </div>
                    <table class="tabla-carros-grupo" style="display: ${displayTabla};">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Fecha de inicio</th>
                                <th>Artículos</th>
                                <th>Tipo</th>
                                <th>Estado</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            grupo.carros.forEach(carro => {
                const fecha = new Date(carro.fecha_inicio).toLocaleString();
                const estaActivo = carro.id.toString() === carroId;
                const esExterno = carro.tipo_carro === 'externa';
                const esFinalizado = carro.fecha_confirmacion !== null;
                const esPreparado = carro.fecha_preparado !== null;
                const esHoy = carro.esHoy;

                // Aplicar clases CSS para diferenciación visual
                let clasesFila = '';
                if (estaActivo) {
                    clasesFila += 'carro-activo ';
                }
                if (esExterno) {
                    clasesFila += 'carro-externo ';
                }
                if (esFinalizado) {
                    clasesFila += 'carro-finalizado ';
                }
                if (esHoy) {
                    clasesFila += 'carro-hoy ';
                }

                let tipoBadge = '';
                if (esExterno) {
                    let tagLinea = 'Externa';
                    if (carro.linea_negocio === 4) tagLinea = 'L4 Tostadero';
                    else if (carro.linea_negocio === 5) tagLinea = 'L5 Barritas';
                    else if (carro.linea_negocio === 6) tagLinea = 'L6 Granolas';
                    tipoBadge = `<span class="badge-tipo-carro externa" title="${carro.nombre_linea_negocio || 'Producción Externa'}">🚚 ${tagLinea}</span>`;
                } else {
                    if (Number(carro.linea_negocio) === 3) {
                        tipoBadge = `<span class="badge-tipo-carro interna" style="background: #dcfce7; color: #166534; border: 1px solid #86efac;" title="1° Etapa: Producción de Artículos Puente / Mixes a Granel x Kilo">🥣 L3 Art. Puente / Mix</span>`;
                    } else if (Number(carro.linea_negocio) === 2) {
                        tipoBadge = `<span class="badge-tipo-carro interna" style="background: #e0f2fe; color: #075985; border: 1px solid #7dd3fc;" title="2° Etapa: Producción de Fracciones Comerciales">📦 L2 Fracciones</span>`;
                    } else {
                        tipoBadge = `<span class="badge-tipo-carro interna">🏭 Interna</span>`;
                    }
                }

                const estadoBadge = esFinalizado
                    ? `<span class="badge-estado-carro finalizado" style="font-size: 10.5px; padding: 2px 8px;">✅ Finalizado</span>`
                    : (esPreparado ? `<span class="badge-estado-carro preparado" style="font-size: 10.5px; padding: 2px 8px;">📦 Listo</span>` : `<span class="badge-estado-carro en-edicion" style="font-size: 10.5px; padding: 2px 8px;">✏️ En curso</span>`);

                html += `
                    <tr class="${clasesFila.trim()}" onclick="seleccionarCarro(${carro.id})">
                        <td>
                            <div class="${esHoy ? 'celda-hoy' : ''}" style="font-weight: 700; color: #1e293b;">#${carro.id}</div>
                        </td>

                        <td>${fecha}</td>
                        <td><strong>${carro.total_articulos}</strong> art.</td>
                        <td>${tipoBadge}</td>
                        <td>${estadoBadge}</td>
                        <td>
                            <div class="btn-group">
                                ${estaActivo ?
                                    `<span class="chip-activo-toggle" onclick="event.stopPropagation(); deseleccionarCarro()" title="Carro actualmente en vista. Clic para desmarcar">● Activo <span class="icon-close">✕</span></span>` :
                                    ''
                                }
                                <button class="btn-eliminar" onclick="event.stopPropagation(); eliminarCarro(${carro.id})" title="Eliminar este carro">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            </div>
        `;
        });

        html += `</div>`; // cerrar carros-lista

        carroInfo.innerHTML = html;

        // Agregar estilos CSS inline para la tabla
        const style = document.createElement('style');
        style.textContent = estilosTablaCarros;
        document.head.appendChild(style);

    } catch (error) {
        console.error('Error:', error);
        carroInfo.innerHTML = '<p>Error al cargar los carros</p>';
    }
}

// Event listeners para los botones de eliminar artículo y cambios en cantidad
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-eliminar-articulo')) {
        const numeroArticulo = e.target.dataset.numero;
        await eliminarArticuloDelCarro(numeroArticulo);
    }
});

// Función de debounce para evitar múltiples llamadas
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Debounced version of the update function
const debouncedUpdateCantidad = debounce(async (numeroArticulo, nuevaCantidad, inputElement) => {
    try {
        // Actualizar UI inmediatamente
        const articuloContainer = inputElement.closest('.articulo-container');
        const ingredientesContainer = articuloContainer.nextElementSibling;
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            const rows = ingredientesContainer.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cantidadCell = row.cells[1];
                const cantidadBase = parseFloat(cantidadCell.dataset.base || cantidadCell.textContent);
                const cantidadCalculada = Number((cantidadBase * nuevaCantidad).toPrecision(10));
                cantidadCell.textContent = cantidadCalculada.toFixed(2);
                cantidadCell.dataset.valor = cantidadCalculada;
            });
        }

        // Hacer la llamada al servidor en segundo plano
        await modificarCantidadArticulo(numeroArticulo, nuevaCantidad);
        // Actualizar resumen de artículos externos también
        await actualizarResumenArticulos();
        recalcularEstimacionesEnCaliente();
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        inputElement.value = inputElement.dataset.lastValue || 1;
    }
}, 300);

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('input-cantidad-articulo')) {
        const numeroArticulo = e.target.dataset.numero;
        const nuevaCantidad = parseFloat(e.target.value);
        if (nuevaCantidad > 0) {
            e.target.dataset.lastValue = e.target.value;
            debouncedUpdateCantidad(numeroArticulo, nuevaCantidad, e.target);
        } else {
            e.target.value = e.target.dataset.lastValue || 1;
            mostrarError('La cantidad debe ser mayor a 0');
        }
    }
});

// Función para actualizar el resumen de ingredientes con debounce
const debouncedActualizarResumen = debounce(async () => {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (carroId && colaboradorData) {
        const colaborador = JSON.parse(colaboradorData);
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
        mostrarResumenIngredientes(ingredientes);

        // También actualizar el resumen de mixes
        const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
        mostrarResumenMixes(mixes);
    }
}, 500);

// Función para actualizar el resumen de ingredientes
export async function actualizarResumenIngredientes() {
    debouncedActualizarResumen();
}

// Función para actualizar el resumen de artículos vinculados (carros externos)
export async function actualizarResumenArticulos() {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!carroId || !colaboradorData) {
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    try {
        const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
        mostrarResumenArticulos(articulos);
    } catch (error) {
        console.error('Error al actualizar resumen de artículos:', error);
    }
}

async function eliminarArticuloDelCarro(numeroArticulo) {
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    const colaboradorData = localStorage.getItem('colaboradorActivo');

    if (!carroId || !colaboradorData) {
        mostrarError('No hay carro activo o colaborador seleccionado');
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    const articulo = document.querySelector(`.articulo-container[data-numero="${numeroArticulo}"]`);

    if (!articulo) {
        console.warn(`No se encontró el artículo ${numeroArticulo} en el DOM`);
        return;
    }

    const btnEliminar = articulo.querySelector('.btn-eliminar-articulo');
    if (btnEliminar) {
        btnEliminar.disabled = true;
        btnEliminar.textContent = '⏳';
    }

    try {
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${numeroArticuloEncoded}?usuarioId=${colaborador.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo eliminar el artículo del carro');
        }

        eliminarArticuloDelDOM(numeroArticulo);
        debouncedActualizarResumen();
        // También actualizar el resumen de artículos para carros externos
        await actualizarResumenArticulos();
        mostrarNotificacionEliminacion(numeroArticulo);

    } catch (error) {
        console.error('Error al eliminar artículo:', error);
        mostrarError(error.message);

        // Restaurar el botón si hubo un error
        if (btnEliminar) {
            btnEliminar.disabled = false;
            btnEliminar.textContent = '🗑️';
        }

    } finally {
        // Si todo salió bien, el DOM ya se limpió; si no, el botón ya se restauró
    }
}

// Función para eliminar artículo del DOM de forma segura
function eliminarArticuloDelDOM(numeroArticulo) {
    try {
        // Buscar el contenedor del artículo
        const articulo = document.querySelector(`.articulo-container[data-numero="${numeroArticulo}"]`);
        if (!articulo) {
            console.warn(`Artículo ${numeroArticulo} no encontrado en el DOM`);
            return;
        }

        // Buscar el contenedor de ingredientes (siguiente elemento hermano)
        const ingredientesContainer = articulo.nextElementSibling;

        // Buscar el artículo vinculado (si existe)
        let articuloVinculado = null;
        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            // El artículo vinculado estaría después del contenedor de ingredientes
            articuloVinculado = ingredientesContainer.nextElementSibling;
            if (articuloVinculado && !articuloVinculado.classList.contains('articulo-vinculado')) {
                articuloVinculado = null;
            }
        } else {
            // Si no hay ingredientes expandidos, el artículo vinculado estaría directamente después
            articuloVinculado = articulo.nextElementSibling;
            if (articuloVinculado && !articuloVinculado.classList.contains('articulo-vinculado')) {
                articuloVinculado = null;
            }
        }

        // También buscar por atributo data-articulo-padre como respaldo
        if (!articuloVinculado) {
            articuloVinculado = document.querySelector(`.articulo-vinculado[data-articulo-padre="${numeroArticulo}"]`);
        }

        // Eliminar con animación suave
        articulo.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        articulo.style.opacity = '0';
        articulo.style.transform = 'translateX(-100%)';

        if (ingredientesContainer && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
            ingredientesContainer.style.transition = 'opacity 0.3s ease-out';
            ingredientesContainer.style.opacity = '0';
        }

        // Animar también el artículo vinculado si existe
        if (articuloVinculado) {
            console.log(`🔗 Eliminando también artículo vinculado para ${numeroArticulo}`);
            articuloVinculado.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
            articuloVinculado.style.opacity = '0';
            articuloVinculado.style.transform = 'translateX(-100%)';
        }

        // Remover elementos después de la animación
        setTimeout(() => {
            try {
                if (articulo && articulo.parentNode) {
                    articulo.parentNode.removeChild(articulo);
                    recalcularEstimacionesEnCaliente();
                }
                if (ingredientesContainer && ingredientesContainer.parentNode && ingredientesContainer.classList.contains('ingredientes-expandidos')) {
                    ingredientesContainer.parentNode.removeChild(ingredientesContainer);
                }
                if (articuloVinculado && articuloVinculado.parentNode) {
                    console.log(`✅ Artículo vinculado eliminado del DOM para ${numeroArticulo}`);
                    articuloVinculado.parentNode.removeChild(articuloVinculado);
                }
            } catch (removeError) {
                console.error('Error al remover elementos del DOM:', removeError);
            }
        }, 300);

    } catch (error) {
        console.error('Error al eliminar artículo del DOM:', error);
    }
}

// Función para mostrar notificación de eliminación
function mostrarNotificacionEliminacion(numeroArticulo) {
    const notification = document.createElement('div');
    notification.textContent = `Artículo ${numeroArticulo} eliminado`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #dc3545;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        font-size: 14px;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 2000);
}

// Función para modificar la cantidad de un artículo
async function modificarCantidadArticulo(numeroArticulo, nuevaCantidad) {
    try {
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        const colaboradorData = localStorage.getItem('colaboradorActivo');

        if (!carroId || !colaboradorData) {
            throw new Error('No hay carro activo o colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);

        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${numeroArticuloEncoded}?usuarioId=${colaborador.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cantidad: nuevaCantidad
            })
        });

        if (!response.ok) {
            throw new Error('No se pudo actualizar la cantidad del artículo');
        }

        // Actualizar solo los ingredientes del artículo modificado
        await actualizarIngredientesArticulo(numeroArticulo, nuevaCantidad);

        // Actualizar resumen de ingredientes
        await actualizarResumenIngredientes();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        // Recargar la tabla para mostrar el valor anterior en caso de error
        await mostrarArticulosDelCarro();

        // Actualizar resumen de ingredientes
        await actualizarResumenIngredientes();
    }
}

// Función para actualizar solo los ingredientes de un artículo específico
/**
 * Escapa texto plano para insertarlo de forma segura dentro de atributos HTML.
 */
function escaparAtributoHtml(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Construye el pie con el botón Editar Receta dentro del desplegable de ingredientes.
 */
function construirBotonEditarRecetaHtml(numero, nombre, modo = 'editar') {
    const esCrear = modo === 'crear';
    const claseBtn = esCrear ? 'btn btn-primary btn-editar-receta' : 'btn btn-secondary btn-editar-receta';
    const etiqueta = esCrear ? 'Crear Receta' : 'Editar Receta';
    return `
        <div style="margin-top: 10px; text-align: right;">
            <button class="${claseBtn}" data-numero="${escaparAtributoHtml(numero)}" data-nombre="${escaparAtributoHtml(nombre)}" data-modo="${escaparAtributoHtml(modo)}">${etiqueta}</button>
        </div>
    `;
}

/**
 * Localiza el contenedor .ingredientes-expandidos asociado a un .articulo-container,
 * saltando banners intermedios (ej. .articulo-insumo-up-banner, .articulo-vinculado-banner).
 */
function buscarContenedorIngredientesExpandidos(articuloContainer) {
    if (!articuloContainer) return null;
    let sibling = articuloContainer.nextElementSibling;
    while (sibling && !sibling.classList.contains('articulo-container')) {
        if (sibling.classList.contains('ingredientes-expandidos')) {
            return sibling;
        }
        sibling = sibling.nextElementSibling;
    }
    const numero = articuloContainer.dataset?.numero;
    if (numero && articuloContainer.parentElement) {
        const selectorNumero = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(numero)
            : String(numero).replace(/"/g, '\\"');
        return articuloContainer.parentElement.querySelector(`.ingredientes-expandidos[data-numero="${selectorNumero}"]`);
    }
    return null;
}

// Función para actualizar solo los ingredientes de un artículo específico
async function actualizarIngredientesArticulo(numeroArticulo, nuevaCantidad) {
    try {
        // Buscar el contenedor del artículo
        const inputCantidad = document.querySelector(`input[data-numero="${numeroArticulo}"]`);
        if (!inputCantidad) return;

        const articuloContainer = inputCantidad.closest('.articulo-container');
        if (!articuloContainer) return;

        const ingredientesContainer = buscarContenedorIngredientesExpandidos(articuloContainer);
        if (!ingredientesContainer) return;

        const btnRecetaPrevio = ingredientesContainer.querySelector('.btn-editar-receta');
        const nombreArticulo = btnRecetaPrevio?.dataset?.nombre
            || articuloContainer.querySelector('.articulo-descripcion')?.textContent?.trim()
            || '';
        const modoReceta = btnRecetaPrevio?.dataset?.modo || 'editar';

        // Obtener ingredientes actualizados
        const ingredientes = await obtenerIngredientesExpandidos(numeroArticulo);

        if (ingredientes && ingredientes.length > 0) {
            // Generar nuevo HTML para la tabla de ingredientes
            let htmlIngredientes = `
                <div>
                    <table>
                        <thead>
                            <tr>
                                <th>Ingrediente</th>
                                <th>Cantidad</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            ingredientes.forEach(ing => {
                // Multiplicar la cantidad del ingrediente por la nueva cantidad del artículo
                const cantidadTotal = ing.cantidad * nuevaCantidad;
                htmlIngredientes += `
                    <tr>
                        <td>
                            ${ing.es_mix ?
                        `<span class="mix-nombre" 
                                       style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                                       onclick="editarIngredienteCompuesto(${ing.id || ing.ingrediente_id || '\'' + (ing.nombre || '').replace(/'/g, "\\'") + '\''})">${ing.nombre}</span>` :
                        ing.nombre}
                        </td>
                <td data-valor="${cantidadTotal}">${cantidadTotal.toFixed(2)}</td>
                        <td>${ing.unidad_medida}</td>
                    </tr>
                `;
            });

            htmlIngredientes += `
                        </tbody>
                    </table>
                    ${construirBotonEditarRecetaHtml(numeroArticulo, nombreArticulo, modoReceta)}
                </div>
            `;

            // Actualizar solo el contenido del contenedor de ingredientes
            ingredientesContainer.innerHTML = htmlIngredientes;
        } else {
            ingredientesContainer.innerHTML = `
                <div class="ingredientes-error">
                    No se pudieron cargar los ingredientes para este artículo.
                </div>
            `;
        }

    } catch (error) {
        console.error('Error al actualizar ingredientes:', error);
    }
}

// Función para validar el carro activo
export async function validarCarroActivo(usuarioId) {
    // Priorizar carroId solicitado desde Configurar Carros (URL param o localStorage cross-tab)
    const urlParams = new URLSearchParams(window.location.search);
    const carroDesdeUrl = urlParams.get('carroId');
    const carroDesdeLocal = localStorage.getItem('carroActivoSolicitado');
    const carroSolicitado = carroDesdeUrl || carroDesdeLocal;

    if (carroSolicitado) {
        sessionStorage.setItem('carroActivo', String(carroSolicitado));
        const wsContainer = document.getElementById('workspace-container');
        if (wsContainer) wsContainer.dataset.carroId = String(carroSolicitado);
        localStorage.removeItem('carroActivoSolicitado');
        if (carroDesdeUrl && window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    if (!carroId) return;

    try {
        // Intentar obtener los artículos del carro para validar propiedad
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${usuarioId}`);

        if (!response.ok) {
            // Si hay error, probablemente el carro no pertenece al usuario
            console.log('El carro no pertenece al usuario actual');
            sessionStorage.removeItem('carroActivo');
            const wsContainer = document.getElementById('workspace-container');
            if (wsContainer) delete wsContainer.dataset.carroId;
            actualizarEstadoCarro();
        }
    } catch (error) {
        console.error('Error al validar carro:', error);
        sessionStorage.removeItem('carroActivo');
        const wsContainer = document.getElementById('workspace-container');
        if (wsContainer) delete wsContainer.dataset.carroId;
        actualizarEstadoCarro();
    }
}

// Función para crear un nuevo carro de producción
export async function crearNuevoCarro(tipoCarro = 'interna', lineaNegocio = null) {
    try {
        console.log(`Iniciando creación de carro tipo: ${tipoCarro}`);

        // Verificar si ya existe un carro activo
        const carroActivo = sessionStorage.getItem('carroActivo');
        if (carroActivo) {
            throw new Error(`Ya hay un carro activo (ID: ${carroActivo})`);
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        console.log('Enviando solicitud para crear carro...');

        const response = await fetch('http://localhost:3002/api/produccion/carro', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuarioId: colaborador.id,
                enAuditoria: true,
                tipoCarro: tipoCarro,
                lineaNegocio: lineaNegocio
            })
        });

        if (!response.ok) {
            throw new Error('Error al crear el carro de producción');
        }

        const data = await response.json();
        console.log(`✅ Carro de producción ${tipoCarro} creado con ID:`, data.id);

        // Guardar el ID del carro en localStorage y variable global
        sessionStorage.setItem('carroActivo', data.id);
        const wsContainer = document.getElementById('workspace-container');
        if (wsContainer) wsContainer.dataset.carroId = data.id;

        console.log('Actualizando interfaz...');

        // Actualizar la información visual del carro
        await actualizarEstadoCarro();

        // Mostrar los artículos del carro (inicialmente vacío)
        await mostrarArticulosDelCarro();

        // Actualizar la visibilidad de los botones según el estado
        if (typeof window.actualizarVisibilidadBotones === 'function') {
            console.log('Actualizando visibilidad de botones...');
            await window.actualizarVisibilidadBotones();
        } else {
            console.warn('⚠️ actualizarVisibilidadBotones no está disponible');
        }

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Función para alternar la visibilidad de grupos temporales (semanas y meses)
window.toggleGrupoTemporal = function (indiceGrupo) {
    const grupo = document.querySelector(`[data-grupo="${indiceGrupo}"]`);
    if (!grupo) return;

    const tabla = grupo.querySelector('.tabla-carros-grupo');
    const indicador = grupo.querySelector('.indicador-colapso');

    if (!tabla || !indicador) return;

    // Alternar visibilidad de la tabla
    if (tabla.style.display === 'none') {
        tabla.style.display = 'table';
        indicador.textContent = '▼';
        grupo.classList.remove('colapsado');
    } else {
        tabla.style.display = 'none';
        indicador.textContent = '▶';
        grupo.classList.add('colapsado');
    }
};

// Hacer funciones disponibles globalmente para los botones HTML

// ============================================================================
// 🎯 TICKET #10: RENDERIZADO DEL DASHBOARD DE STOCK PERSONAL (PRODUCCIÓN EXTERNA)
// ============================================================================
function generarDashboardStockPersonal(ingredientes, estadoCarro, carroFinalizado, manualesPorIngrediente) {
    if (!ingredientes || ingredientes.length === 0) {
        return '<p style="text-align:center; padding: 20px; color: #6c757d;">No hay ingredientes asignados al stock personal.</p>';
    }

    const alimentos = ingredientes.filter(ing => !ing.es_insumo);
    const insumos = ingredientes.filter(ing => !!ing.es_insumo);

    let html = '<div class="dashboard-externo" style="display: flex; flex-direction: column; gap: 20px; padding: 10px;">';

    if (alimentos.length > 0) {
        html += `<h4 style="margin: 5px 0; font-size: 1.1em; color: #495057; border-left: 3px solid #10b981; padding-left: 8px; font-weight: bold; text-align: left;">Ingredientes Alimenticios</h4>`;
        html += generarBloqueDashboard(alimentos, false, estadoCarro, carroFinalizado, manualesPorIngrediente);
    }

    if (insumos.length > 0) {
        html += `<h4 style="margin: 15px 0 5px 0; font-size: 1.1em; color: #495057; border-left: 3px solid #64748b; padding-left: 8px; font-weight: bold; text-align: left;">Insumos Necesarios</h4>`;
        html += generarBloqueDashboard(insumos, true, estadoCarro, carroFinalizado, manualesPorIngrediente);
    }

    html += `</div>`;
    return html;
}

function generarBloqueDashboard(lista, esInsumo, estadoCarro, carroFinalizado, manualesPorIngrediente) {
    // Ordenar por nombre
    lista.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

    let html = `<div style="display: flex; flex-direction: column; gap: 15px;">`;

    lista.forEach(ing => {
        const cantidadNecesariaRaw = ing.cantidad;
        let cantidadNecesaria = 0;
        if (cantidadNecesariaRaw !== null && cantidadNecesariaRaw !== undefined) {
            const parsed = parseFloat(cantidadNecesariaRaw);
            cantidadNecesaria = isNaN(parsed) ? 0 : parsed;
        }

        let stockOriginal = 0;
        let stockRestante = 0;
        let consumo = cantidadNecesaria;
        let suficienciaReal = 0;

        if (carroFinalizado) {
            stockOriginal = parseFloat(ing.stock_snapshot || ing.stock_actual || 0);
            stockRestante = stockOriginal - cantidadNecesaria;
            suficienciaReal = stockRestante;
        } else {
            stockOriginal = parseFloat(ing.stock_actual || 0);
            stockRestante = stockOriginal;
            suficienciaReal = stockOriginal - cantidadNecesaria;
        }

        const tieneStock = suficienciaReal >= -0.01;
        
        let valorReferenciaParaBarra = ing.capacidad_base ? parseFloat(ing.capacidad_base) : stockOriginal;
        if (isNaN(valorReferenciaParaBarra) || valorReferenciaParaBarra <= 0) {
            valorReferenciaParaBarra = stockOriginal;
        }

        const porcentajeReal = valorReferenciaParaBarra > 0 ? Math.max(0, (stockRestante / valorReferenciaParaBarra) * 100) : 0;
        const porcentajeVisual = Math.min(100, porcentajeReal);
        const haySobreStock = porcentajeReal > 100;

        let colorBarra = '#28a745';
        if (haySobreStock) {
            colorBarra = '#19692c';
        } else if (!tieneStock || porcentajeReal < 20) {
            colorBarra = '#dc3545';
        } else if (porcentajeReal < 50) {
            colorBarra = '#fd7e14';
        }

        let botonesAccion = '';
        if (!carroFinalizado && estadoCarro === 'en_preparacion') {
            const carroIdActivo = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
            const deshabilitado = !carroIdActivo;
            
            const valAjusteStock = esInsumo ? Math.round(stockOriginal) : stockOriginal;
            const botonAjusteRapido = deshabilitado
                ? `<button disabled title="Seleccioná un carro primero" style="padding: 4px 8px; font-size: 11px; border: 1px solid #ccc; border-radius: 4px; background: #f8f9fa;">✎ Ajuste Rápido</button>`
                : `<button onclick="window.abrirModalAjusteDesdeCarro(${ing.id}, '${ing.nombre.replace(/'/g, "\\'")}', ${valAjusteStock}, ${carroIdActivo})" style="padding: 4px 8px; font-size: 11px; border: 1px solid #17a2b8; border-radius: 4px; background: #e0f7fa; color: #006064; cursor: pointer;">✎ Ajuste Rápido</button>`;
            
            const botonAbastecer = `<button onclick="window.abrirModalAbastecimientoExterno(${ing.id}, '${ing.nombre.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 11px; border: 1px solid #28a745; border-radius: 4px; background: #e8f5e9; color: #2e7d32; cursor: pointer; margin-left: 8px;">🚚 Abastecer</button>`;
            const botonDesactivar = `<button onclick="window.desactivarIngredienteStockPersonal(${ing.id}, '${ing.nombre.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 11px; border: 1px solid #dc3545; border-radius: 4px; background: #fff5f5; color: #dc3545; cursor: pointer; margin-left: 8px;">🚫 Desactivar</button>`;
            
            botonesAccion = `<div style="margin-top: 8px; text-align: right;">${botonAjusteRapido}${botonAbastecer}${botonDesactivar}</div>`;
        }

        const unidadMedida = esInsumo ? 'u' : (ing.unidad_medida || '');
        let badgeSobreStock = '';
        if (haySobreStock) {
            const excedente = stockRestante - valorReferenciaParaBarra;
            const valExcedente = esInsumo ? Math.round(excedente).toString() : excedente.toFixed(2);
            badgeSobreStock = `<span style="color: #19692c; font-weight: bold; background: #e8f5e9; padding: 2px 6px; border-radius: 4px; border: 1px solid #19692c; font-size: 10px; margin-left: 5px;">📦 SOBRE-STOCK (+${valExcedente} ${unidadMedida})</span>`;
        }

        const valConsumo = esInsumo ? Math.round(consumo).toString() : consumo.toFixed(2);
        const valStockOriginal = esInsumo ? Math.round(stockOriginal).toString() : stockOriginal.toFixed(2);
        const valStockRestante = esInsumo ? Math.round(stockRestante).toString() : stockRestante.toFixed(2);
        const valFaltante = esInsumo ? Math.round(Math.abs(suficienciaReal)).toString() : Math.abs(suficienciaReal).toFixed(2);

        html += `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <strong style="color: #343a40; font-size: 15px; text-align: left;">${ing.nombre || 'Desconocido'}</strong>
                    <span style="font-weight: bold; font-size: 13px; color: ${tieneStock ? '#495057' : '#dc3545'};">
                        Consumo: ${valConsumo} ${unidadMedida} / Disponible: ${valStockOriginal} ${unidadMedida}
                    </span>
                </div>
                
                <div style="height: 12px; background-color: #e9ecef; border-radius: 6px; overflow: hidden; position: relative;">
                    <div style="height: 100%; width: ${porcentajeVisual}%; background-color: ${colorBarra}; transition: width 0.5s ease;"></div>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: #6c757d; align-items: center;">
                    <span style="display:flex; align-items:center;">${!carroFinalizado && estadoCarro === 'en_preparacion' ? 'Stock Físico / Actual:' : 'Restante tras producción:'} <strong style="color: ${colorBarra}; margin-left:4px;">${valStockRestante} ${unidadMedida} (${porcentajeReal.toFixed(0)}%)</strong> ${badgeSobreStock}</span>
                    ${!tieneStock ? `<span style="color: #dc3545; font-weight: bold;">⚠️ Stock Insuficiente (Faltan ${valFaltante})</span>` : ''}
                </div>
                
                ${botonesAccion}
            </div>
        `;
    });

    html += `</div>`;
    return html;
}

// 🎯 TICKET: Función para desactivar (ocultar) ingredientes del stock personal
window.desactivarIngredienteStockPersonal = async function(ingredienteId, ingredienteNombre) {
    const colaboradorData = localStorage.getItem('colaboradorActivo');
    if (!colaboradorData) return;
    
    const colaborador = JSON.parse(colaboradorData);
    const usuarioId = colaborador.id;
    const nombreOperario = colaborador.nombre_completo || colaborador.nombre || 'este operario';

    const mensajeConfirmacion = `¿Está seguro que no desea gestionar este ingrediente ("${ingredienteNombre}") como parte del stock personal de ${nombreOperario}?`;
    
    if (!confirm(mensajeConfirmacion)) {
        return;
    }

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/stock-usuario/${usuarioId}/${ingredienteId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo desactivar el ingrediente del stock personal');
        }

        console.log(`✅ Ingrediente ${ingredienteId} desactivado del stock personal.`);
        
        // Refrescar el componente visual
        console.log("🔄 Actualizando resumen de ingredientes tras desactivación...");
        try {
            await actualizarResumenIngredientes();
            console.log("✅ Resumen visual actualizado");
        } catch (refreshError) {
            console.error("⚠️ Invocación directa falló, intentando como global", refreshError);
            if (typeof window.actualizarResumenIngredientes === 'function') {
                await window.actualizarResumenIngredientes();
            }
        }
        
    } catch (error) {
        console.error('Error al desactivar el ingrediente:', error);
        if (typeof window.mostrarError === 'function') {
            window.mostrarError(error.message);
        } else {
            alert('Error: ' + error.message);
        }
    }
};

window.crearNuevoCarro = crearNuevoCarro;
window.seleccionarCarro = seleccionarCarro;
window.deseleccionarCarro = deseleccionarCarro;
window.eliminarCarro = eliminarCarro;

// Función para seleccionar un carro
export async function seleccionarCarro(carroId) {
    try {
        console.log(`Seleccionando carro ID: ${carroId}`);

        // --- Usuario / validaciones ---
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }
        const colaborador = JSON.parse(colaboradorData);
        const usuarioId = colaborador.id;

        // Validar pertenencia del carro
        const validarResp = await fetch(
            `http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${usuarioId}`
        );
        if (!validarResp.ok) {
            throw new Error('No se puede seleccionar este carro');
        }

        // --- Establecer carro activo ---
        sessionStorage.setItem('carroActivo', String(carroId));
        const wsContainer = document.getElementById('workspace-container');
        if (wsContainer) wsContainer.dataset.carroId = carroId;

        // 🧹 LIMPIEZA AGRESIVA: Limpiar TODAS las secciones antes de cargar nuevo carro
        console.log('🧹 [LIMPIEZA] Limpiando UI completa antes de cargar nuevo carro...');

        // Limpiar datos del carro anterior
        limpiarIngresosManualesDelCarro();

        // Limpiar y ocultar TODAS las secciones específicas de tipo de carro
        const seccionArticulos = document.getElementById('resumen-articulos');
        const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
        const seccionMixes = document.getElementById('resumen-mixes');
        const contenedorMixes = document.getElementById('tabla-resumen-mixes');
        const contenedorIngredientes = document.getElementById('tabla-resumen-ingredientes');

        // Ocultar y limpiar artículos externos
        if (seccionArticulos) {
            seccionArticulos.style.display = 'none';
            console.log('🧹 [LIMPIEZA] Sección de artículos externos ocultada');
        }
        if (contenedorArticulos) {
            contenedorArticulos.innerHTML = '<p>Cargando...</p>';
            console.log('🧹 [LIMPIEZA] Contenedor de artículos externos limpiado');
        }

        // Ocultar y limpiar mixes
        if (seccionMixes) {
            seccionMixes.style.display = 'none';
            console.log('🧹 [LIMPIEZA] Sección de mixes ocultada');
        }
        if (contenedorMixes) {
            contenedorMixes.innerHTML = '<p>Cargando...</p>';
            console.log('🧹 [LIMPIEZA] Contenedor de mixes limpiado');
        }

        // Limpiar ingredientes
        if (contenedorIngredientes) {
            contenedorIngredientes.innerHTML = '<p>Cargando...</p>';
            console.log('🧹 [LIMPIEZA] Contenedor de ingredientes limpiado');
        }

        // 🧹 LIMPIAR PANELES DE CARRO PREPARADO (vinculación y preparación)
        console.log('🧹 [LIMPIEZA] Limpiando paneles de carro preparado al cambiar de carro...');

        // Panel de artículos secundarios/vinculados editables
        const seccionSecundarios = document.getElementById('seccion-articulos-secundarios');
        if (seccionSecundarios) {
            seccionSecundarios.remove();
            console.log('✅ [LIMPIEZA] Panel de artículos vinculados editables eliminado');
        }

        // Panel de ingredientes/artículos vinculados
        const seccionInformesVinculados = document.getElementById('resumen-ingredientes-vinculados');
        if (seccionInformesVinculados) {
            seccionInformesVinculados.remove();
            console.log('✅ [LIMPIEZA] Panel de ingredientes vinculados eliminado');
        }

        // Panel de kilos producidos (solo carros externos)
        const kilosProducidosContainer = document.getElementById('kilos-producidos-container');
        if (kilosProducidosContainer) {
            kilosProducidosContainer.remove();
            console.log('✅ [LIMPIEZA] Panel de kilos producidos eliminado');
        }

        // 🧹 LIMPIAR CLASES CSS DE ESTADOS AVANZADOS (segundo-plano, minimizado)
        console.log('🧹 [LIMPIEZA] Removiendo clases CSS de estados avanzados...');

        // Remover clase 'segundo-plano' de artículos padres
        const articulosPadres = document.querySelectorAll('.articulo-container.segundo-plano');
        articulosPadres.forEach(articulo => {
            articulo.classList.remove('segundo-plano');
        });
        if (articulosPadres.length > 0) {
            console.log(`✅ [LIMPIEZA] Clase 'segundo-plano' removida de ${articulosPadres.length} artículos`);
        }

        // Remover clase 'minimizado' de secciones de resumen
        const seccionesMinimizadas = document.querySelectorAll('.minimizado');
        seccionesMinimizadas.forEach(seccion => {
            seccion.classList.remove('minimizado');
        });
        if (seccionesMinimizadas.length > 0) {
            console.log(`✅ [LIMPIEZA] Clase 'minimizado' removida de ${seccionesMinimizadas.length} secciones`);
        }

        // Remover clase 'activa' de paneles dinámicos
        const panelesActivos = document.querySelectorAll('.seccion-articulos-secundarios.activa, .seccion-resumen.activa');
        panelesActivos.forEach(panel => {
            panel.classList.remove('activa');
        });
        if (panelesActivos.length > 0) {
            console.log(`✅ [LIMPIEZA] Clase 'activa' removida de ${panelesActivos.length} paneles`);
        }

        // Limpiar informe de ingresos manuales
        limpiarInformeIngresosManuales();
        console.log('✅ [LIMPIEZA] UI completamente limpiada');

        console.log('Actualizando interfaz después de seleccionar carro...');

        // --- UI / datos ---
        await actualizarEstadoCarro();
        await mostrarArticulosDelCarro();

        // Obtener tipo de carro PRIMERO para gestionar visibilidad
        let tipoCarro = 'interna';
        let lineaNegocioSel = null;
        let nombreLineaSel = null;
        try {
            const estadoResp = await fetch(`/api/produccion/carro/${carroId}/estado`);
            if (estadoResp.ok) {
                const estadoData = await estadoResp.json();
                tipoCarro = estadoData.tipo_carro || 'interna';
                lineaNegocioSel = estadoData.linea_negocio;
                nombreLineaSel = estadoData.nombre_linea_negocio;
                console.log(`📊 [TIPO-CARRO] Tipo detectado: ${tipoCarro} (Línea: ${lineaNegocioSel})`);
            }
        } catch (error) {
            console.warn('⚠️ No se pudo obtener tipo de carro, asumiendo interna');
        }

        // Atmósfera visual de marca
        const topbarTitulo = document.querySelector('.topbar-titulo');
        if (tipoCarro === 'externa') {
            document.body.classList.add('contexto-externo');
            if (wsContainer) wsContainer.classList.add('theme-externo');
            if (topbarTitulo) {
                const tituloLinea = nombreLineaSel ? ('MODO EXTERNO — ' + nombreLineaSel) : 'MODO EXTERNO';
                topbarTitulo.innerHTML = `🚚 Producción <span class="badge-externo">${tituloLinea}</span>`;
            }
        } else {
            document.body.classList.remove('contexto-externo');
            if (wsContainer) wsContainer.classList.remove('theme-externo');
            if (topbarTitulo) {
                if (Number(lineaNegocioSel) === 3) {
                    topbarTitulo.innerHTML = `🏭 Producción <span style="background: #dcfce7; color: #166534; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 12px; border: 1px solid #86efac; margin-left: 8px;">🥣 LÍNEA 3 — ARTÍCULOS PUENTE / MIX X KILO (1° ETAPA)</span>`;
                } else if (Number(lineaNegocioSel) === 2) {
                    topbarTitulo.innerHTML = `🏭 Producción <span style="background: #e0f2fe; color: #075985; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 12px; border: 1px solid #7dd3fc; margin-left: 8px;">📦 LÍNEA 2 — FRACCIONES COMERCIALES (2° ETAPA)</span>`;
                } else {
                    topbarTitulo.innerHTML = `🏭 Producción`;
                }
            }
        }

        // 🎯 GESTIONAR VISIBILIDAD DE SECCIONES SEGÚN TIPO DE CARRO
        gestionarVisibilidadSeccionesPorTipo(tipoCarro);

        // 📊 CARGAR DATOS SEGÚN TIPO DE CARRO

        // Resumen de ingredientes (SIEMPRE)
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, usuarioId);
        await mostrarResumenIngredientes(ingredientes);
        console.log('✅ [REACTIVIDAD] Resumen de ingredientes actualizado');

        // Resumen de mixes (SOLO si es carro externo)
        if (tipoCarro === 'externa') {
            const mixes = await obtenerResumenMixesCarro(carroId, usuarioId);
            mostrarResumenMixes(mixes);
            console.log('✅ [REACTIVIDAD] Resumen de mixes actualizado');
        }

        // Resumen de artículos externos (SOLO si es carro externo)
        if (tipoCarro === 'externa') {
            const articulos = await obtenerResumenArticulosCarro(carroId, usuarioId);
            if (articulos && articulos.length > 0) {
                mostrarResumenArticulos(articulos);
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                    console.log('✅ [REACTIVIDAD] Sección de artículos externos mostrada');
                }
            } else {
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'none';
                    console.log('ℹ️ [REACTIVIDAD] No hay artículos externos, sección oculta');
                }
            }
            console.log('✅ [REACTIVIDAD] Resumen de artículos externos actualizado');
        }

        // Informe de ingresos manuales (si existe)
        if (typeof window.actualizarInformeIngresosManuales === 'function') {
            console.log('Actualizando ingresos manuales después de seleccionar carro...');
            await window.actualizarInformeIngresosManuales();
        }

        // Visibilidad de botones según estado
        if (typeof window.actualizarVisibilidadBotones === 'function') {
            console.log('Actualizando visibilidad de botones después de seleccionar carro...');
            await window.actualizarVisibilidadBotones();
        } else {
            console.warn('⚠️ actualizarVisibilidadBotones no está disponible al seleccionar carro');
        }

        console.log('✅ [SELECCIÓN-CARRO] Carro seleccionado y UI actualizada completamente');

    } catch (error) {
        console.error('Error al seleccionar carro:', error);
        mostrarError(error.message);
    }
}



// Función para deseleccionar el carro actual
export async function deseleccionarCarro() {
    console.log('Deseleccionando carro activo...');

    if (window.hudMedicion && typeof window.hudMedicion.alDeseleccionarCarro === 'function') {
        await window.hudMedicion.alDeseleccionarCarro();
    }

    sessionStorage.removeItem('carroActivo');
    const wsContainer = document.getElementById('workspace-container');
    if (wsContainer) {
        delete wsContainer.dataset.carroId;
        wsContainer.classList.remove('theme-externo');
    }
    document.body.classList.remove('contexto-externo');

    const topbarTitulo = document.querySelector('.topbar-titulo');
    if (topbarTitulo) {
        topbarTitulo.innerHTML = '🏭 Producción';
    }

    // Purgar botones de impresión de packs anteriores
    document.querySelectorAll('.btn-imprimir-padre').forEach(btn => btn.remove());

    await actualizarEstadoCarro();

    const listaArticulosEl = document.getElementById('lista-articulos');
    if (listaArticulosEl) {
        listaArticulosEl.innerHTML = `
            <div class="aviso-sin-carro">
                <p>No hay carro de producción seleccionado</p>
                <small>Seleccione un carro del historial inferior para visualizarlo o cree uno nuevo.</small>
            </div>
        `;
    }

    // Limpiar resumen de ingredientes
    const contenedor = document.getElementById('tabla-resumen-ingredientes');
    if (contenedor) {
        contenedor.innerHTML = '<p style="color: #94a3b8; font-style: italic; padding: 15px; text-align: center;">No hay carro activo</p>';
    }

    // Limpiar resumen de mixes
    const contenedorMixes = document.getElementById('tabla-resumen-mixes');
    if (contenedorMixes) {
        contenedorMixes.innerHTML = '<p style="color: #94a3b8; font-style: italic; padding: 15px; text-align: center;">No hay carro activo</p>';
    }

    // Limpiar resumen de artículos externos
    const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
    if (contenedorArticulos) {
        contenedorArticulos.innerHTML = '<p style="color: #94a3b8; font-style: italic; padding: 15px; text-align: center;">No hay carro activo</p>';
    }

    // Ocultar sección de artículos externos
    const seccionArticulos = document.getElementById('resumen-articulos');
    if (seccionArticulos) {
        seccionArticulos.style.display = 'none';
    }

    // 🧹 LIMPIAR PANELES DE CARRO PREPARADO (vinculación y preparación)
    const seccionSecundarios = document.getElementById('seccion-articulos-secundarios');
    if (seccionSecundarios) seccionSecundarios.remove();

    const seccionInformesVinculados = document.getElementById('resumen-ingredientes-vinculados');
    if (seccionInformesVinculados) seccionInformesVinculados.remove();

    const kilosProducidosContainer = document.getElementById('kilos-producidos-container');
    if (kilosProducidosContainer) kilosProducidosContainer.remove();

    // Limpiar informe de ingresos manuales
    limpiarInformeIngresosManuales();

    // Actualizar la visibilidad de los botones (deben ocultarse al no haber carro)
    if (typeof window.actualizarVisibilidadBotones === 'function') {
        await window.actualizarVisibilidadBotones();
    }
}

// Función para eliminar un carro
export async function eliminarCarro(carroId) {
    if (!confirm('¿Estás seguro de que querés eliminar este carro? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}?usuarioId=${colaborador.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('No se pudo eliminar el carro');
        }

        // Si el carro eliminado era el activo, limpiarlo COMPLETAMENTE
        const carroActivo = sessionStorage.getItem('carroActivo');
        if (carroActivo === String(carroId)) {
            console.log('🧹 Limpiando UI completa del carro eliminado...');

            // Limpiar localStorage
            sessionStorage.removeItem('carroActivo');
            const wsContainer = document.getElementById('workspace-container');
            if (wsContainer) delete wsContainer.dataset.carroId;

            // Limpiar lista de artículos
            const listaArticulos = document.getElementById('lista-articulos');
            if (listaArticulos) {
                listaArticulos.innerHTML = '<p>No hay carro activo</p>';
            }

            // Limpiar resumen de ingredientes
            const contenedorIngredientes = document.getElementById('tabla-resumen-ingredientes');
            if (contenedorIngredientes) {
                contenedorIngredientes.innerHTML = '<p>No hay carro activo</p>';
            }

            // Limpiar resumen de mixes
            const contenedorMixes = document.getElementById('tabla-resumen-mixes');
            if (contenedorMixes) {
                contenedorMixes.innerHTML = '<p>No hay carro activo</p>';
            }

            // Limpiar resumen de artículos externos
            const contenedorArticulos = document.getElementById('tabla-resumen-articulos');
            if (contenedorArticulos) {
                contenedorArticulos.innerHTML = '<p>No hay carro activo</p>';
            }

            // Ocultar sección de artículos externos
            const seccionArticulos = document.getElementById('resumen-articulos');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'none';
            }

            // Ocultar sección de mixes
            const seccionMixes = document.getElementById('resumen-mixes');
            if (seccionMixes) {
                seccionMixes.style.display = 'none';
            }

            // 🧹 LIMPIAR PANELES DE CARRO PREPARADO (vinculación y preparación)
            console.log('🧹 Limpiando paneles de carro preparado al eliminar...');

            // Panel de artículos secundarios/vinculados editables
            const seccionSecundarios = document.getElementById('seccion-articulos-secundarios');
            if (seccionSecundarios) {
                seccionSecundarios.remove();
                console.log('✅ Panel de artículos vinculados editables eliminado');
            }

            // Panel de ingredientes/artículos vinculados
            const seccionInformesVinculados = document.getElementById('resumen-ingredientes-vinculados');
            if (seccionInformesVinculados) {
                seccionInformesVinculados.remove();
                console.log('✅ Panel de ingredientes vinculados eliminado');
            }

            // Panel de kilos producidos (solo carros externos)
            const kilosProducidosContainer = document.getElementById('kilos-producidos-container');
            if (kilosProducidosContainer) {
                kilosProducidosContainer.remove();
                console.log('✅ Panel de kilos producidos eliminado');
            }

            // Limpiar informe de ingresos manuales
            console.log('🧹 Limpiando informe de ingresos manuales...');
            limpiarInformeIngresosManuales();

            // Actualizar visibilidad de botones
            if (typeof window.actualizarVisibilidadBotones === 'function') {
                console.log('🔄 Actualizando visibilidad de botones...');
                await window.actualizarVisibilidadBotones();
            }

            console.log('✅ UI limpiada completamente');
        }

        // Actualizar la lista de carros
        await actualizarEstadoCarro();

    } catch (error) {
        console.error('Error al eliminar carro:', error);
        mostrarError(error.message);
    }
}

// Función para obtener el resumen consolidado de ingredientes de un carro
export async function obtenerResumenIngredientesCarro(carroId, usuarioId) {
    try {
        // Verificar el tipo de carro
        const responseTipoCarro = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        let tipoCarro = 'interna';
        if (responseTipoCarro.ok) {
            const dataTipoCarro = await responseTipoCarro.json();
            tipoCarro = dataTipoCarro.tipo_carro || 'interna';
        } else {
            console.warn('⚠️ No se pudo obtener el tipo de carro, asumiendo interna');
        }

        // Obtener ingredientes base
        const responseBase = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`);
        if (!responseBase.ok) {
            throw new Error('No se pudo obtener el resumen de ingredientes');
        }
        const ingredientesBase = await responseBase.json();

        // Obtener ingredientes de artículos vinculados (solo para carros externos)
        let ingredientesVinculados = [];

        if (tipoCarro === 'externa') {
            const responseVinculados = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/ingredientes-vinculados?usuarioId=${usuarioId}`);

            if (responseVinculados.ok) {
                ingredientesVinculados = await responseVinculados.json();
                console.log(`🔗 Ingredientes vinculados obtenidos: ${ingredientesVinculados.length}`);
            } else {
                console.warn('❌ No se pudieron obtener ingredientes de artículos vinculados');
            }
        }

        // Marcar ingredientes vinculados para diferenciarlos en UI
        ingredientesVinculados = ingredientesVinculados.map(ing => ({
            ...ing,
            es_de_articulo_vinculado: true
        }));

        // Combinar ambos arrays (Omitimos los vinculados para no invadir el panel de stock personal)
        let ingredientesCombinados = [...ingredientesBase];

        // 🎯 TICKET #10 RE-OPEN: Incluir TODO el stock personal para mostrar el dashboard incluso en carros vacíos
        if (tipoCarro === 'externa') {
            try {
                const responsePersonal = await fetch(`http://localhost:3002/api/produccion/ingredientes/stock-usuario/${usuarioId}`);
                if (responsePersonal.ok) {
                    const stockPersonal = await responsePersonal.json();
                    
                    // Crear un mapa de los ingredientes ya requeridos en el carro
                    const ingredientesRequeridosMap = new Map();
                    ingredientesCombinados.forEach(ing => ingredientesRequeridosMap.set(ing.id, ing));
                    
                    // Añadir el stock personal que no esté requerido (o vacíos)
                    stockPersonal.forEach(ingStock => {
                        const ingId = ingStock.ingrediente_id || ingStock.id;
                        if (!ingredientesRequeridosMap.has(ingId)) {
                            ingredientesCombinados.push({
                                id: ingId,
                                nombre: ingStock.nombre_ingrediente || ingStock.nombre,
                                unidad_medida: ingStock.unidad_medida,
                                cantidad: 0, // Consumo inicial nulo
                                stock_actual: parseFloat(ingStock.stock_total || 0),
                                stock_snapshot: parseFloat(ingStock.stock_total || 0),
                                capacidad_base: ingStock.capacidad_base,
                                es_de_articulo_vinculado: false,
                                sector_letra: 'Sin Sector'
                            });
                        } else {
                            const match = ingredientesRequeridosMap.get(ingId);
                            match.capacidad_base = ingStock.capacidad_base;
                        }
                    });
                }
            } catch (err) {
                console.warn('⚠️ No se pudo obtener el stock personal completo:', err);
            }
        }

        console.log(`📦 Resumen ingredientes - Base: ${ingredientesBase.length}, Vinculados: ${ingredientesVinculados.length}, Total: ${ingredientesCombinados.length}`);

        return ingredientesCombinados;
    } catch (error) {
        console.error('❌ Error al obtener resumen de ingredientes:', error);
        mostrarError(error.message);
        return [];
    }
}

// Función para obtener el resumen consolidado de mixes de un carro
export async function obtenerResumenMixesCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/mixes?usuarioId=${usuarioId}`);

        if (!response.ok) {
            throw new Error('No se pudo obtener el resumen de mixes');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener resumen de mixes:', error);
        mostrarError(error.message);
        return [];
    }
}

// Función para mostrar el resumen de ingredientes en la UI
import { abrirModalIngresoManual } from './ingresoManual.js';
// Helper para generar la tabla de resumen de ingredientes o insumos
function generarTablaResumen(lista, titulo, esSeccionInsumo, carroFinalizado, estadoCarro, tipoCarro, manualesPorIngrediente) {
    if (lista.length === 0) {
        return `
            <div class="resumen-seccion" style="margin-bottom: 20px;">
                <h4 style="margin: 15px 0 5px 0; font-size: 1em; color: #495057; border-left: 3px solid ${esSeccionInsumo ? '#64748b' : '#10b981'}; padding-left: 8px; font-weight: bold; text-align: left;">
                    ${titulo}
                </h4>
                <p style="color: #6c757d; font-style: italic; margin-left: 10px; font-size: 0.9em; text-align: left;">No hay registros en esta categoría</p>
            </div>
        `;
    }

    // Ordenar por sector_letra (Sin Sector al final), luego por nombre
    const listaOrdenada = [...lista].sort((a, b) => {
        if (a.sector_letra === 'Sin Sector' && b.sector_letra !== 'Sin Sector') return 1;
        if (a.sector_letra !== 'Sin Sector' && b.sector_letra === 'Sin Sector') return -1;
        if (a.sector_letra !== b.sector_letra) return String(a.sector_letra || '').localeCompare(String(b.sector_letra || ''));
        return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });

    let html = `
        <div class="resumen-seccion" style="margin-bottom: 20px;">
            <h4 style="margin: 15px 0 10px 0; font-size: 1em; color: #495057; border-left: 3px solid ${esSeccionInsumo ? '#64748b' : '#10b981'}; padding-left: 8px; font-weight: bold; text-align: left;">
                ${titulo}
            </h4>
    `;

    if (carroFinalizado) {
        html += `
            <table class="tabla-resumen tabla-historica">
                <thead>
                    <tr>
                        <th>${esSeccionInsumo ? 'Insumo' : 'Ingrediente'}</th>
                        <th style="background: #e3f2fd;">Stock Anterior</th>
                        <th style="background: #fff3e0;">Gestión Manual</th>
                        <th>Requerido</th>
                        <th style="background: #f5f5f5;">Nuevo Stock</th>
                        <th>Unidad</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
        `;
    } else {
        html += `
            <table class="tabla-resumen">
                <thead>
                    <tr>
                        <th>${esSeccionInsumo ? 'Insumo' : 'Ingrediente'}</th>
                        <th>Cantidad Necesaria</th>
                        <th>Stock Actual</th>
                        <th>Estado</th>
                        <th>Unidad</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
        `;
    }

    let currentSector = null;

    listaOrdenada.forEach((ing) => {
        const stockFinalRaw = ing.stock_actual;
        const cantidadNecesariaRaw = ing.cantidad;

        let stockFinal = 0;
        let cantidadNecesaria = 0;

        if (stockFinalRaw !== null && stockFinalRaw !== undefined && stockFinalRaw !== '') {
            const stockParsed = parseFloat(stockFinalRaw);
            stockFinal = isNaN(stockParsed) ? 0 : stockParsed;
        }

        if (cantidadNecesariaRaw !== null && cantidadNecesariaRaw !== undefined && cantidadNecesariaRaw !== '') {
            const cantidadParsed = parseFloat(cantidadNecesariaRaw);
            cantidadNecesaria = isNaN(cantidadParsed) ? 0 : cantidadParsed;
        }

        // Separador de sector
        if (ing.sector_letra !== currentSector) {
            currentSector = ing.sector_letra;
            const colSpan = carroFinalizado ? 7 : 6;
            html += `
                <tr class="sector-header" style="background-color: #f8f9fa; border-top: 2px solid #dee2e6; border-bottom: 2px solid #dee2e6;">
                    <td colspan="${colSpan}" style="padding: 10px; font-weight: bold; color: #495057; font-size: 1.1em; text-align: left;">
                        📍 Sector: <span style="color: #0056b3;">${currentSector}</span>
                    </td>
                </tr>
            `;
        }

        const unidadDisplay = esSeccionInsumo ? 'u' : (ing.unidad_medida || '');

        if (carroFinalizado) {
            const stockDisponibleSnapshot = parseFloat(ing.stock_snapshot || ing.stock_actual || 0);
            const ingresoManual = manualesPorIngrediente[ing.id] || 0;
            const ingresosPrePreparado = ing.ingresos_pre_preparado !== undefined
                ? parseFloat(ing.ingresos_pre_preparado || 0)
                : ingresoManual;
            const ingresosPostPreparado = ing.ingresos_post_preparado !== undefined
                ? parseFloat(ing.ingresos_post_preparado || 0)
                : 0;
            const stockAnterior = stockDisponibleSnapshot - ingresosPrePreparado;
            const stockNuevo = (ing.stock_live !== undefined && ing.stock_live !== null)
                ? parseFloat(ing.stock_live)
                : (stockDisponibleSnapshot + ingresosPostPreparado - cantidadNecesaria);
            const colorStockAnterior = stockAnterior < 0 ? '#dc3545' : '#28a745';
            const colorStockNuevo = stockNuevo < 0 ? '#dc3545' : '#1e293b';

            let btnSalvavidas = '';
            if (estadoCarro === 'preparado') {
                btnSalvavidas = `<button onclick="window.abrirModalSalvavidas(${ing.id}, '${(ing.nombre || '').replace(/'/g, "\\'")}', ${document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo')}, '${unidadDisplay}')" class="btn-salvavidas" title="Declarar stock fantasma y reponer" style="background-color: #dc3545; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">🛟 Salvavidas</button>`;
            } else {
                btnSalvavidas = `<span style="color: #6c757d; font-size: 0.9em;">-</span>`;
            }

            const valStockAnterior = esSeccionInsumo ? Math.round(stockAnterior).toString() : stockAnterior.toFixed(2);
            const valIngresoManual = ingresoManual > 0 ? (esSeccionInsumo ? `+${Math.round(ingresoManual)}` : `+${ingresoManual.toFixed(2)}`) : '-';
            const valRequerido = esSeccionInsumo ? Math.round(cantidadNecesaria).toString() : cantidadNecesaria.toFixed(2);
            const valStockNuevo = esSeccionInsumo ? Math.round(stockNuevo).toString() : stockNuevo.toFixed(2);

            html += `
                <tr>
                    <td><strong>${ing.nombre || 'Sin nombre'}</strong></td>
                    <td style="text-align: center; background: #e3f2fd; color: ${colorStockAnterior}; font-weight: bold;">
                        ${valStockAnterior}
                    </td>
                    <td style="text-align: center; background: #fff3e0;">
                        ${valIngresoManual}
                    </td>
                    <td style="text-align: center;">${valRequerido}</td>
                    <td style="text-align: center; background: #f5f5f5; font-weight: bold;">
                        ${valStockNuevo}
                    </td>
                    <td style="text-align: center;">${unidadDisplay}</td>
                    <td style="text-align: center;">${btnSalvavidas}</td>
                </tr>
            `;
        } else {
            const diferencia = stockFinal - cantidadNecesaria;
            const tieneStock = diferencia >= -0.01;
            const faltante = tieneStock ? 0 : Math.abs(diferencia);

            let indicadorEstado = '';
            if (tieneStock) {
                indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
            } else {
                const valFaltante = esSeccionInsumo ? Math.round(faltante).toString() : faltante.toFixed(2);
                indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${valFaltante} ${unidadDisplay}</span>`;
            }

            const esIngredienteVinculado = ing.es_de_articulo_vinculado === true;
            let mostrarBotones = true;

            if (tipoCarro === 'externa') {
                if (estadoCarro === 'en_preparacion') {
                    mostrarBotones = !esIngredienteVinculado;
                } else if (estadoCarro === 'preparado') {
                    mostrarBotones = esIngredienteVinculado;
                } else {
                    mostrarBotones = false;
                }
            } else {
                mostrarBotones = (estadoCarro !== 'preparado' && estadoCarro !== 'confirmado');
            }

            const carroIdActivo = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
            const deshabilitado = !carroIdActivo;
            const botonIngresoManual = deshabilitado
                ? `<button disabled title="Seleccioná un carro primero">Ingreso manual</button>`
                : `<button onclick="abrirModalIngresoManual(${ing.id}, ${carroIdActivo})">Ingreso manual</button>`;

            let botonesAccion = '';

            if (mostrarBotones) {
                const valStockFinal = esSeccionInsumo ? Math.round(stockFinal) : stockFinal;
                const botonAjusteRapido = deshabilitado
                    ? `<button disabled title="Seleccioná un carro primero" class="btn-ajuste-rapido">✎</button>`
                    : `<button onclick="window.abrirModalAjusteDesdeCarro(${ing.id}, '${ing.nombre.replace(/'/g, "\\'")}', ${valStockFinal}, ${carroIdActivo})" class="btn-ajuste-rapido" title="Ajuste rápido de stock">✎</button>`;

                if (tipoCarro === 'externa' && estadoCarro === 'preparado') {
                    botonesAccion = `
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            ${botonIngresoManual}
                        </div>
                    `;
                } else {
                    botonesAccion = `
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            ${botonIngresoManual}
                            ${botonAjusteRapido}
                        </div>
                    `;
                }
            } else {
                botonesAccion = `
                    <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                        ${botonIngresoManual}
                        <span style="color: #6c757d; font-style: italic; font-size: 0.9em;">Solo lectura</span>
                    </div>
                `;
            }

            let clasesFila = tieneStock ? 'stock-ok' : 'stock-faltante';
            if (ing.es_de_articulo_vinculado) {
                clasesFila += ' ingrediente-vinculado';
            }

            const claseCeldaSustituible = (!tieneStock) ? 'celda-sustituible' : '';
            const eventoDblClick = (!tieneStock)
                ? `ondblclick="abrirModalSustitucion(${ing.id}, ${faltante}, '${ing.nombre.replace(/'/g, "\\'")}', '${unidadDisplay}')"`
                : '';

            let cajasCerradasHtml = '';
            if (parseFloat(ing.stock_bultos || 0) > 0) {
                let botonAbrirCaja = '';
                if (mostrarBotones && !deshabilitado) {
                    botonAbrirCaja = `
                        <button onclick="event.stopPropagation(); window.abrirCajaDesdeCarro(${ing.id}, '${ing.nombre.replace(/'/g, "\\'")}', ${JSON.stringify(ing.lotes_cajas_cerradas).replace(/"/g, '&quot;')})" 
                                style="background: #10b981; color: white; border: none; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; font-weight: bold; transition: background 0.2s; margin-top: 2px;"
                                onmouseover="this.style.background='#059669'"
                                onmouseout="this.style.background='#10b981'"
                                title="Abrir una caja de este ingrediente">
                            🔓 Abrir
                        </button>
                    `;
                }
                cajasCerradasHtml = `
                    <div class="cajas-cerradas-badge" style="font-size: 0.8em; color: #0284c7; font-weight: bold; margin-top: 4px; display: flex; flex-direction: column; align-items: center; gap: 2px;" title="Cajas Cerradas en Bunker">
                        <span>📦 ${parseFloat(ing.stock_bultos)} cj</span>
                        ${botonAbrirCaja}
                    </div>
                `;
            }

            const valRequerido = esSeccionInsumo ? Math.round(cantidadNecesaria).toString() : cantidadNecesaria.toFixed(2);
            const valStockFinal = esSeccionInsumo ? Math.round(stockFinal).toString() : stockFinal.toFixed(2);

            html += `
                <tr class="${clasesFila.trim()}">
                    <td>${ing.nombre || 'Sin nombre'}</td>
                    <td>${valRequerido}</td>
                    <td class="${claseCeldaSustituible}" ${eventoDblClick} title="${!tieneStock ? 'Doble clic para sustituir ingrediente' : ''}">
                        ${valStockFinal}
                        ${cajasCerradasHtml}
                    </td>
                    <td>${indicadorEstado}</td>
                    <td>${unidadDisplay}</td>
                    <td>${botonesAccion}</td>
                </tr>
            `;
        }
    });

    html += `
            </tbody>
        </table>
    </div>
    `;

    return html;
}

export async function mostrarResumenIngredientes(ingredientes) {
    const contenedor = document.getElementById('tabla-resumen-ingredientes');
    if (!contenedor) return;

    console.log('\n🎯 VERIFICACIÓN FINAL DEL INFORME VISUAL');
    console.log('==========================================');
    console.log('Array final recibido para mostrar en la UI:');
    console.log('Cantidad de ingredientes únicos:', ingredientes?.length || 0);

    if (ingredientes && ingredientes.length > 0) {
        console.log('\n📋 INGREDIENTES FINALES PARA EL INFORME:');
        ingredientes.forEach((ing, index) => {
            const estado = ing.stock_actual >= ing.cantidad ? '✅' : '❌';
            console.log(`${index + 1}. ${ing.nombre} (${ing.unidad_medida}): ${ing.cantidad} - Stock: ${ing.stock_actual} ${estado}`);
        });
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay ingredientes para mostrar en el informe');
    }

    if (!ingredientes || ingredientes.length === 0) {
        contenedor.innerHTML = '<p>No hay ingredientes para mostrar</p>';
        return;
    }

    // 🔧 OBTENER ESTADO Y TIPO DE CARRO para lógica de permisos
    const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
    let estadoCarro = 'en_preparacion';
    let tipoCarro = 'interna';
    let lineaNegocio = null;

    if (carroId) {
        try {
            const response = await fetch(`/api/produccion/carro/${carroId}/estado`);
            if (response.ok) {
                const data = await response.json();
                estadoCarro = data.estado;
                tipoCarro = data.tipo_carro || 'interna';
                lineaNegocio = data.linea_negocio;
                console.log(`📊 [PERMISOS] Estado: ${estadoCarro}, Tipo: ${tipoCarro}, Línea: ${lineaNegocio}`);
            }
        } catch (error) {
            console.warn('⚠️ No se pudo obtener estado del carro');
        }
    }

    // 🎯 LÓGICA DE PERMISOS: Determinar si el carro está finalizado (preparado/confirmado)
    const carroFinalizado = (estadoCarro === 'confirmado' || estadoCarro === 'preparado');

    console.log(`📊 [TABLA-INGREDIENTES] Renderizando - Estado: ${estadoCarro}, Tipo: ${tipoCarro} (Vista: ${carroFinalizado ? 'SOLO LECTURA' : 'ACTIVA'})`);

    // 🎯 TICKET #10: Modificar Título del Panel para Externa y Etapas Internas
    const tituloSpan = document.querySelector('#resumen-ingredientes h3 span');
    if (tituloSpan) {
        if (tipoCarro === 'externa') {
            tituloSpan.innerHTML = '🏠 Control de Stock Personal / Domicilio';
        } else if (Number(lineaNegocio) === 3) {
            tituloSpan.innerHTML = '🥣 Ingredientes de los Sectores para armar el Mix (1° Etapa — Línea 3)';
        } else if (Number(lineaNegocio) === 2) {
            tituloSpan.innerHTML = '📦 Ingredientes y Envases para Fraccionar (2° Etapa — Línea 2)';
        } else {
            tituloSpan.innerHTML = 'Resumen de Ingredientes Necesarios';
        }
    }

    let manualesPorIngrediente = {};

    if (carroFinalizado) {
        // 🔄 FETCH DE INGRESOS MANUALES PARA CÁLCULO DE TRAZABILIDAD
        try {
            const respIngresos = await fetch(`/api/produccion/carro/${carroId}/ingresos-manuales`);
            if (respIngresos.ok) {
                const ingresos = await respIngresos.json();
                // Agrupar por ingrediente_id
                ingresos.forEach(m => {
                    if (!manualesPorIngrediente[m.ingrediente_id]) {
                        manualesPorIngrediente[m.ingrediente_id] = 0;
                    }
                    manualesPorIngrediente[m.ingrediente_id] += parseFloat(m.kilos_totales || m.kilos || 0);
                });
                console.log('📊 Ingresos manuales recuperados para trazabilidad:', manualesPorIngrediente);
            }
        } catch (err) {
            console.error('Error recuperando ingresos manuales:', err);
        }
    }

    // 📍 DEDUPLICACIÓN DE INGREDIENTES PARA EVITAR DUPLICIDAD EN LA UI (Ticket #9A)
    const ingredientesUnicos = {};
    ingredientes.forEach(ing => {
        if (!ing.sector_letra) ing.sector_letra = 'Sin Sector';
        
        // Normalizamos explícitamente la procedencia
        const esVinculado = !!ing.es_de_articulo_vinculado;
        
        if (!ingredientesUnicos[ing.id]) {
            ingredientesUnicos[ing.id] = { ...ing, es_de_articulo_vinculado: esVinculado };
        } else {
            // Si el ingrediente ya existe, sumamos su cantidad
            const cantidadExistente = parseFloat(ingredientesUnicos[ing.id].cantidad || 0);
            const cantidadNueva = parseFloat(ing.cantidad || 0);
            ingredientesUnicos[ing.id].cantidad = cantidadExistente + cantidadNueva;
            
            // 🎯 CORRECCIÓN TICKET #10 RE-OPEN: Salvaguarda para Stock Personal
            if (!esVinculado) {
                ingredientesUnicos[ing.id].es_de_articulo_vinculado = false;
            }
        }
    });

    // Convertir de vuelta a array y proceder a la ordenación
    let ingredientesFiltrados = Object.values(ingredientesUnicos);

    // 🎯 TICKET #10: Limpieza de Ruido Visual para Carros Externos (Excluir Fase 3 del panel superior)
    if (tipoCarro === 'externa') {
        ingredientesFiltrados = ingredientesFiltrados.filter(ing => !ing.es_de_articulo_vinculado);
    }

    // 🎯 TICKET #10: Bifurcación Visual para Dashboard de Stock Personal
    if (tipoCarro === 'externa') {
        const dashboardHtml = generarDashboardStockPersonal(ingredientesFiltrados, estadoCarro, carroFinalizado, manualesPorIngrediente);
        contenedor.innerHTML = dashboardHtml;
        return;
    }

    // Separar en Ingredientes Alimenticios e Insumos Necesarios
    const alimentos = ingredientesFiltrados.filter(ing => !ing.es_insumo);
    const insumos = ingredientesFiltrados.filter(ing => !!ing.es_insumo);

    let html = '';
    if (Number(lineaNegocio) === 3) {
        html += `
            <div style="background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; color: #14532d; text-align: left;">
                <strong>🥣 1° Etapa — Elaboración de Artículo Puente / Mix a Granel:</strong>
                Estos son los ingredientes individuales (sectores A y B) que debés pesar y mezclar. Al confirmar este carro, los kilos producidos ingresarán como <strong>Artículo Puente por kilo</strong> (listo para nutrir el ingrediente simple en la 2° etapa de fracciones).
            </div>
        `;
    } else if (Number(lineaNegocio) === 2) {
        html += `
            <div style="background: #f0f9ff; border-left: 4px solid #0284c7; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; color: #0c4a6e; text-align: left;">
                <strong>📦 2° Etapa — Envasado de Fracciones Comerciales:</strong>
                Estos ingredientes simples se nutren del <strong>Artículo Puente por kilo</strong> (elaborado en la 1° etapa) o de bulto cerrado. Si figura faltante en el ingrediente del mix, usá <strong>"Ingreso manual"</strong> para volcar los kilos del Artículo Puente al ingrediente.
            </div>
        `;
    }
    html += generarTablaResumen(alimentos, 'Ingredientes Alimenticios', false, carroFinalizado, estadoCarro, tipoCarro, manualesPorIngrediente);
    html += generarTablaResumen(insumos, 'Insumos Necesarios (Packaging)', true, carroFinalizado, estadoCarro, tipoCarro, manualesPorIngrediente);

    contenedor.innerHTML = html;
            if (typeof actualizarTopbarEstimacion === 'function' && window._estimacionCarroActual) {
        actualizarTopbarEstimacion(window._estimacionCarroActual);
    }
    // NOTA DE DESARROLLO (Corrección de Anomalía Crítica): 
    // Se corrigió una llave de cierre duplicada ('}') huérfana en este bloque 
    // que causaba un fallo de parseo (SyntaxError) en el navegador y congelaba el script.
}


// Función para mostrar el resumen de mixes en la UI
export function mostrarResumenMixes(mixes) {
    const contenedor = document.getElementById('tabla-resumen-mixes');
    if (!contenedor) return;

    console.log('\n🧪 VERIFICACIÓN FINAL DEL INFORME DE MIXES');
    console.log('==========================================');
    console.log('Array final de mixes recibido para mostrar en la UI:');
    console.log('Cantidad de mixes únicos:', mixes?.length || 0);

    if (mixes && mixes.length > 0) {
        console.log('\n📋 MIXES FINALES PARA EL INFORME:');
        mixes.forEach((mix, index) => {
            console.log(`${index + 1}. ${mix.nombre} (${mix.unidad_medida}): ${mix.cantidad}`);
        });
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay mixes para mostrar en el informe');
    }

    const seccionMixes = document.getElementById('resumen-mixes');
    if (!mixes || mixes.length === 0) {
        contenedor.innerHTML = '<p>No hay ingredientes compuestos para mostrar</p>';
        if (seccionMixes) {
            seccionMixes.style.display = 'none';
        }
        return;
    }
    if (seccionMixes) {
        seccionMixes.style.display = 'block';
    }

    let html = `
        <table class="tabla-resumen">
            <thead>
                <tr>
                    <th>Ingrediente Compuesto</th>
                    <th>Cantidad Total</th>
                    <th>Unidad</th>
                    <th>Stock Actual</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
    `;

    mixes.forEach(mix => {
        const carroIdActivo = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        const deshabilitado = !carroIdActivo;
        const boton = deshabilitado
            ? `<button disabled title="Seleccioná un carro primero">Ingreso manual</button>`
            : `<button onclick="abrirModalIngresoManual(${mix.id}, ${carroIdActivo}, true)">Ingreso manual</button>`;

        // Calcular estado del stock con tolerancia para diferencias decimales
        const stockActual = mix.stock_actual || 0;
        const cantidadNecesaria = mix.cantidad;
        const diferencia = stockActual - cantidadNecesaria;
        const tieneStock = diferencia >= -0.01; // Tolerancia de 0.01 para diferencias decimales

        html += `
            <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'}">
                <td>
                    <span class="mix-nombre" 
                          style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                          onclick="editarIngredienteCompuesto(${mix.id || mix.ingrediente_id || '\'' + (mix.nombre || '').replace(/'/g, "\\'") + '\''})">${mix.nombre}</span>
                </td>
                <td>${mix.cantidad.toFixed(2)}</td>
                <td>${mix.unidad_medida}</td>
                <td>${stockActual.toFixed(2)}</td>
                <td>${boton}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    contenedor.innerHTML = html;
}

// Función para obtener el resumen consolidado de artículos de un carro (solo para carros externos)
export async function obtenerResumenArticulosCarro(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos-resumen?usuarioId=${usuarioId}`);

        if (!response.ok) {
            if (response.status === 404) {
                // No hay artículos o no es un carro externo
                return [];
            }
            throw new Error('No se pudo obtener el resumen de artículos');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener resumen de artículos:', error);
        return [];
    }
}

// Función para mostrar el resumen de artículos en la UI (solo para carros externos)
export function mostrarResumenArticulos(articulos) {
    const contenedor = document.getElementById('tabla-resumen-articulos');
    if (!contenedor) return;

    console.log('\n📦 VERIFICACIÓN FINAL DEL INFORME DE ARTÍCULOS');
    console.log('==========================================');
    console.log('Array final de artículos recibido para mostrar en la UI:');
    console.log('Cantidad de artículos únicos:', articulos?.length || 0);

    if (articulos && articulos.length > 0) {
        console.log('\n📋 ARTÍCULOS FINALES PARA EL INFORME:');
        articulos.forEach((art, index) => {
            console.log(`${index + 1}. ${art.articulo_numero} - ${art.nombre}: ${art.cantidad_total}`);
        });
        console.log('==========================================\n');
    } else {
        console.log('⚠️ No hay artículos para mostrar en el informe');
    }

    const seccionArticulos = document.getElementById('resumen-articulos');
    if (!articulos || articulos.length === 0) {
        contenedor.innerHTML = '<p>No hay artículos de producción externa para mostrar</p>';
        if (seccionArticulos) seccionArticulos.style.display = 'none';
        return;
    }
    if (seccionArticulos) seccionArticulos.style.display = 'block';

    const carroInfo = window._carroActivoInfo || window.carroActivoMetadata || {};
    const yaDescontado = carroInfo.preparado === true || carroInfo.confirmado === true || carroInfo.estado === 'preparado' || carroInfo.estado === 'confirmado';

    let html = `
        <div style="background: #f5f3ff; border-left: 4px solid #8b5cf6; padding: 8px 12px; border-radius: 4px; margin-bottom: 10px; font-size: 0.86em; color: #4c1d95;">
            ${yaDescontado
                ? '✅ <strong>Insumo / Mezcla ya descontado automáticamente</strong> del stock de depósito al preparar el carro (Receta UP).'
                : '📦 <strong>Insumo / Mezcla de Receta UP:</strong> Se descontará automáticamente del stock de depósito al marcar "Carro listo para producir".'}
        </div>
        <table class="tabla-resumen">
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Mezcla / Insumo (Receta UP)</th>
                    <th>Cant. UP</th>
                    <th>Peso Total</th>
                    <th>Stock Depósito</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>
    `;

    articulos.forEach((art, index) => {
        // Validación robusta para evitar errores con .toFixed()
        const stockActualRaw = art.stock_actual;
        const cantidadTotalRaw = art.cantidad_total;
        const kilosTotalesRaw = art.kilos_totales;
        const kilosUnidadRaw = art.kilos_unidad;

        let stockActual = parseFloat(stockActualRaw);
        if (isNaN(stockActual)) stockActual = 0;

        let cantidadNecesaria = parseFloat(cantidadTotalRaw);
        if (isNaN(cantidadNecesaria)) cantidadNecesaria = 0;

        const kilosUnidad = parseFloat(kilosUnidadRaw) || 1;
        let kilosTotales = parseFloat(kilosTotalesRaw);
        if (isNaN(kilosTotales) || kilosTotales <= 0) {
            kilosTotales = cantidadNecesaria * kilosUnidad;
        }

        const diferencia = stockActual - cantidadNecesaria;
        const tieneStock = yaDescontado || diferencia >= -0.01;
        const faltante = tieneStock ? 0 : Math.abs(diferencia);

        let indicadorEstado = '';
        if (yaDescontado) {
            indicadorEstado = `<span class="stock-suficiente" style="background:#dcfce7; color:#15803d; padding:3px 8px; border-radius:9999px; font-weight:700; font-size:0.85em;">✅ Cargado en Carro (Receta UP)</span>`;
        } else if (tieneStock) {
            indicadorEstado = `<span class="stock-suficiente">✅ Suficiente</span>`;
        } else {
            indicadorEstado = `<span class="stock-insuficiente">❌ Faltan ${faltante.toFixed(2)} u</span>`;
        }

        html += `
            <tr class="${tieneStock ? 'stock-ok' : 'stock-faltante'}">
                <td><strong>${art.articulo_numero}</strong></td>
                <td>${art.nombre || 'Sin descripción'}</td>
                <td><strong>${cantidadNecesaria.toFixed(2)} u</strong></td>
                <td style="color: #5b21b6; font-weight: 700;">${kilosTotales.toFixed(2)} kg</td>
                <td>${stockActual.toFixed(2)} u</td>
                <td>${indicadorEstado}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    contenedor.innerHTML = html;
}

// Función para obtener artículos de recetas de un carro (solo para carros externos)
async function obtenerArticulosDeRecetas(carroId, usuarioId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos-recetas?usuarioId=${usuarioId}`);

        if (!response.ok) {
            if (response.status === 404) {
                // No hay artículos de receta o no es un carro externo
                return [];
            }
            throw new Error('No se pudieron obtener los artículos de recetas');
        }

        return await response.json();
    } catch (error) {
        console.error('Error al obtener artículos de recetas:', error);
        return [];
    }
}

// Función para obtener ingredientes expandidos de un artículo
async function obtenerIngredientesExpandidos(numeroArticulo) {
    try {
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/receta-expandida?codigo=${numeroArticuloEncoded}`);
        if (!response.ok) throw new Error('No se encontraron ingredientes');
        const ingredientes = await response.json();

        // Para cada ingrediente, verificar si es un mix
        const ingredientesConMix = await Promise.all(ingredientes.map(async ing => {
            try {
                // Obtener el ID del ingrediente
                const queryId = await fetch(`http://localhost:3002/api/produccion/ingredientes/buscar?nombre=${encodeURIComponent(ing.nombre)}`);
                const { id } = await queryId.json();

                if (id) {
                    // Verificar si es un mix
                    const queryEsMix = await fetch(`http://localhost:3002/api/produccion/ingredientes/${id}/es-mix`);
                    const { es_mix } = await queryEsMix.json();

                    return {
                        ...ing,
                        id,
                        es_mix
                    };
                }
                return ing;
            } catch (error) {
                console.error(`Error verificando si ${ing.nombre} es mix:`, error);
                return ing;
            }
        }));

        return ingredientesConMix;
    } catch (error) {
        console.error(`Error al obtener ingredientes para ${numeroArticulo}:`, error);
        return null;
    }
}

/**
 * Muestra los artículos agregados al carro activo en el área de trabajo,
 * incluyendo sus ingredientes expandidos y botones de relación para carros externos
 */

export async function mostrarArticulosDelCarro() {
    try {
        const carroId = document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        if (!carroId) {
            document.getElementById('lista-articulos').innerHTML = '<p>No hay carro activo</p>';
            actualizarTopbarEstimacion(null);
            return;
        }

        // 🔍 UX: Preservar estado de los colapsables abiertos (Ticket #014)
        const listaArticulosContainer = document.getElementById('lista-articulos');
        let collapsiblesAbiertos = [];
        if (listaArticulosContainer) {
            collapsiblesAbiertos = Array.from(listaArticulosContainer.querySelectorAll('.ingredientes-expandidos:not(.hidden)'))
                .map(el => el.dataset?.numero || el.closest('.articulo-container')?.dataset.numero)
                .filter(Boolean);
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);

        // Obtener tipo y estado de carro
        const responseTipoCarro = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        let tipoCarro = 'interna';
        let estadoCarro = 'en_preparacion';
        let esConfirmado = false;
        let esPreparado = false;
        let fechaConfirmacion = null;

        let lineaNegocio = null;
        let nombreLineaNegocio = null;
        let iconoLineaNegocio = '🥜';
        let subtituloLineaNegocio = '';

        if (responseTipoCarro.ok) {
            const dataTipoCarro = await responseTipoCarro.json();
            window._carroActivoInfo = dataTipoCarro;
            tipoCarro = dataTipoCarro.tipo_carro || 'interna';
            estadoCarro = dataTipoCarro.estado || 'en_preparacion';
            esConfirmado = dataTipoCarro.confirmado === true || estadoCarro === 'confirmado';
            esPreparado = dataTipoCarro.preparado === true || estadoCarro === 'preparado';
            fechaConfirmacion = dataTipoCarro.fecha_confirmacion;
            lineaNegocio = dataTipoCarro.linea_negocio;
            nombreLineaNegocio = dataTipoCarro.nombre_linea_negocio;
            iconoLineaNegocio = dataTipoCarro.icono_linea_negocio || '🥜';
            subtituloLineaNegocio = dataTipoCarro.subtitulo_linea_negocio || '';
        }

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);

        if (!response.ok) {
            throw new Error('Error al obtener artículos del carro');
        }

        const articulos = await response.json();

        // ⏱️ Consulta de Estimación Predictiva de Tiempos para el Carro
        let estimacionCarro = null;
        try {
            const resEst = await fetch(`/api/tiempos/carro/${carroId}/estimacion`);
            if (resEst.ok) {
                estimacionCarro = await resEst.json();
                window._estimacionCarroActual = estimacionCarro;
            }
        } catch (errEst) {
            console.warn('No se pudo obtener la estimación predictiva de tiempo:', errEst);
        }

        const mapEstimacionArticulos = {};
        if (estimacionCarro && estimacionCarro.articulos) {
            estimacionCarro.articulos.forEach(a => {
                mapEstimacionArticulos[a.articulo_numero] = a;
            });
        }
        window._estimacionArticulosMap = mapEstimacionArticulos;
        if (typeof actualizarTopbarEstimacion === 'function') {
            actualizarTopbarEstimacion(estimacionCarro);
        }


        // 🔍 BULK CHECK PARA RECETAS (Ticket #014)
        let estadoRecetas = {};
        try {
            const articulosNumeros = articulos.map(art => art.numero);
            if (articulosNumeros.length > 0) {
                const estadoResponse = await fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ articulos: articulosNumeros })
                });
                if (estadoResponse.ok) {
                    estadoRecetas = await estadoResponse.json();
                }
            }
        } catch (error) {
            console.error('Error al realizar bulk check de estado de recetas:', error);
        }

        // Obtener relaciones existentes para carros externos
        let relacionesExistentes = {};
        if (tipoCarro === 'externa') {
            try {
                const relacionesResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/relaciones-articulos?usuarioId=${colaborador.id}`);
                if (relacionesResponse.ok) {
                    const relaciones = await relacionesResponse.json();
                    relaciones.forEach(rel => {
                        relacionesExistentes[rel.articulo_produccion_codigo] = rel;
                    });
                }
            } catch (error) {
                console.warn('Error al obtener relaciones:', error);
            }
        }

        // Badge de estado dinámico
        let badgeEstadoHtml = '';
        if (esConfirmado) {
            const fStr = fechaConfirmacion ? new Date(fechaConfirmacion).toLocaleString() : '';
            badgeEstadoHtml = `<span class="badge-estado-carro finalizado" title="Confirmado el ${fStr}">✅ Carro Finalizado</span>`;
        } else if (esPreparado) {
            badgeEstadoHtml = `<span class="badge-estado-carro preparado">📦 Listo para Producir</span>`;
        } else {
            badgeEstadoHtml = `<span class="badge-estado-carro en-edicion">✏️ En Edición</span>`;
        }

        // Síntesis de Producción Externa Finalizada
        let resumenExternoCardHtml = '';
        if (tipoCarro === 'externa' && esConfirmado) {
            try {
                const resExt = await fetch(`/api/produccion/carro/${carroId}/resumen-externo-finalizado`);
                if (resExt.ok) {
                    const dataExt = await resExt.json();
                    const fechaRegStr = dataExt.fecha_registro ? new Date(dataExt.fecha_registro).toLocaleString() : '';
                    resumenExternoCardHtml = `
                        <div class="card-resumen-externo-finalizado">
                            <div class="resumen-externo-header">
                                <span class="resumen-externo-titulo">📊 Síntesis de Producción Externa</span>
                                <small style="color: #64748b; font-size: 11.5px;">${fechaRegStr}</small>
                            </div>
                            <div class="resumen-externo-grid">
                                <div class="stat-box">
                                    <span class="stat-label">Materia Prima</span>
                                    <span class="stat-value">${parseFloat(dataExt.kilos_entrada || 0).toFixed(2)} kg</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-label">Producción Real</span>
                                    <span class="stat-value text-success">${parseFloat(dataExt.kilos_producidos || dataExt.kilos_salida || 0).toFixed(2)} kg</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-label">Merma</span>
                                    <span class="stat-value text-warning">${parseFloat(dataExt.porcentaje_merma || 0).toFixed(2)}%</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-label">Insumos Sumados</span>
                                    <span class="stat-value">${parseFloat(dataExt.ingredientes_sumados || 0).toFixed(2)} kg</span>
                                </div>
                            </div>
                            <div class="resumen-externo-footer" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                                <span>🏷️ <strong>Salida Fraccionada:</strong> [${dataExt.articulo_fraccionado_id}] ${dataExt.articulo_fraccionado_nombre || ''}</span>
                                <button type="button"
                                        class="btn-imprimir-etiqueta-puente"
                                        onclick="window.imprimirEtiquetaArticuloPuente && window.imprimirEtiquetaArticuloPuente('${(dataExt.articulo_fraccionado_id || '').replace(/'/g, "\\'")}', '${(dataExt.articulo_fraccionado_nombre || '').replace(/'/g, "\\'")}', '${(dataExt.articulo_fraccionado_codigo_barras || '').replace(/'/g, "\\'")}', '${carroId}')"
                                        style="background: #16a34a; color: white; border: none; padding: 5px 12px; border-radius: 5px; font-size: 0.85em; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">
                                    🏷️ Imprimir Etiqueta
                                </button>
                            </div>
                        </div>
                    `;
                }
            } catch (e) {
                console.warn('No se pudo cargar síntesis de carro externo:', e);
            }
        }

        let bannerLineaProductivaHtml = '';
        let textoBotonAgregarArticulo = 'Agregar artículo al carro';

        if (tipoCarro === 'externa') {
            const badgeLinea = lineaNegocio ? ('Línea de Negocio ' + lineaNegocio) : 'Producción Externa';
            const nomLinea = nombreLineaNegocio || 'Producción de Tostadero';
            bannerLineaProductivaHtml = `
                <div class="banner-linea-productiva-workspace" style="background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border: 2px solid #93c5fd; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: 0 2px 6px rgba(37,99,235,0.08);">
                    <div style="display: flex; align-items: center; gap: 14px;">
                        <span style="font-size: 32px;">${iconoLineaNegocio}</span>
                        <div>
                            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #1e40af;">Línea Productiva Asignada</div>
                            <div style="font-size: 17px; font-weight: 700; color: #1e3a8a;">
                                ${nomLinea} 
                                <span style="font-size: 12px; font-weight: 700; color: #1d4ed8; background: #ffffff; padding: 2px 8px; border-radius: 10px; border: 1px solid #bfdbfe; margin-left: 6px;">${badgeLinea}</span>
                            </div>
                            ${subtituloLineaNegocio ? `<div style="font-size: 12.5px; color: #3b82f6; margin-top: 2px;">${subtituloLineaNegocio}</div>` : ''}
                        </div>
                    </div>
                    <span style="background: #ffffff; color: #1d4ed8; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 14px; border: 1.5px solid #bfdbfe; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🚚 Carro Externo</span>
                </div>
            `;
        } else if (Number(lineaNegocio) === 3) {
            textoBotonAgregarArticulo = '🥣 Agregar Artículo Puente / Mix (x Kilo) al carro';
            bannerLineaProductivaHtml = `
                <div class="banner-linea-productiva-workspace" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #86efac; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: 0 2px 6px rgba(22,163,74,0.08);">
                    <div style="display: flex; align-items: center; gap: 14px;">
                        <span style="font-size: 32px;">🥣</span>
                        <div style="text-align: left;">
                            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #15803d;">1° Etapa de Producción Interna — Mezcla a Granel</div>
                            <div style="font-size: 16.5px; font-weight: 700; color: #166534;">
                                Producción de Artículos Puente (Mixes x Kilo)
                                <span style="font-size: 12px; font-weight: 700; color: #15803d; background: #ffffff; padding: 2px 8px; border-radius: 10px; border: 1px solid #86efac; margin-left: 6px;">Línea de Negocio 3</span>
                            </div>
                            <div style="font-size: 12.5px; color: #14532d; margin-top: 3px;">
                                Combinás ingredientes de los sectores A/B para elaborar el mix a granel. Se almacena como <strong>Artículo Puente por kilo</strong> (que luego abastece al ingrediente simple para fraccionar en Línea 2).
                            </div>
                        </div>
                    </div>
                    <span style="background: #ffffff; color: #166534; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 14px; border: 1.5px solid #86efac; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🥣 1° Etapa: Mix x Kilo</span>
                </div>
            `;
        } else if (Number(lineaNegocio) === 2) {
            textoBotonAgregarArticulo = '📦 Agregar Fracción Comercial al carro';
            bannerLineaProductivaHtml = `
                <div class="banner-linea-productiva-workspace" style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px solid #7dd3fc; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: 0 2px 6px rgba(2,132,199,0.08);">
                    <div style="display: flex; align-items: center; gap: 14px;">
                        <span style="font-size: 32px;">📦</span>
                        <div style="text-align: left;">
                            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #0369a1;">2° Etapa de Producción Interna — Envasado Final</div>
                            <div style="font-size: 16.5px; font-weight: 700; color: #075985;">
                                Producción de Fracciones (Envasado Comercial)
                                <span style="font-size: 12px; font-weight: 700; color: #0369a1; background: #ffffff; padding: 2px 8px; border-radius: 10px; border: 1px solid #7dd3fc; margin-left: 6px;">Línea de Negocio 2</span>
                            </div>
                            <div style="font-size: 12.5px; color: #0c4a6e; margin-top: 3px;">
                                Envasás las presentaciones pedidas (ej: x 2kg, x 5kg, x 300g). Se nutre del <strong>ingrediente simple</strong> (que recibe al Artículo Puente del mix o al bulto cerrado) + bolsa.
                            </div>
                        </div>
                    </div>
                    <span style="background: #ffffff; color: #075985; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 14px; border: 1.5px solid #7dd3fc; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">📦 2° Etapa: Fracciones</span>
                </div>
            `;
        }

        let html = `
            ${bannerLineaProductivaHtml}
            ${!esConfirmado ? `
                <div class="agregar-articulo-container">
                    <button id="agregar-articulo" class="btn btn-secondary">
                        ${textoBotonAgregarArticulo}
                    </button>
                </div>
            ` : ''}

            <div class="header-articulos-carro" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                <h3 class="titulo-articulos" style="margin: 0; display: flex; align-items: center; gap: 8px;">
                    Artículos en el carro
                    ${badgeEstadoHtml}
                </h3>

            </div>

            ${resumenExternoCardHtml}

            <div class="seccion-articulos">
        `;

        for (const art of articulos) {
            const relacion = relacionesExistentes[art.numero];
            const tieneRelacion = !!relacion;

            // Artículo original (siempre se muestra)
            const tieneReceta = estadoRecetas[art.numero];
            const btnClass = tieneReceta ? 'toggle-ingredientes' : 'toggle-ingredientes sin-receta';
            const btnStyle = tieneReceta ? '' : 'background-color: #dc3545; color: white; border-color: #dc3545;';

                        const estArt = mapEstimacionArticulos[art.numero];
            let renglonTiempoHtml = '';
            if (estArt && estArt.origen === 'planta') {
                const totalCalculado = estArt.minutos_totales ? (estArt.minutos_totales < 1 ? `${Math.round(estArt.minutos_totales * 60)} seg` : `${estArt.minutos_totales.toFixed(1)} min`) : '-';
                renglonTiempoHtml = `
                    <div class="articulo-renglon-tiempo origen-planta" id="renglon-tiempo-${art.numero}">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>⏱️</span>
                            <span>Tiempo estimado: <strong>${estArt.minutos_unitarios.toFixed(2)} min/u</strong> × <span class="calc-cant">${art.cantidad}</span> u = <strong class="calc-subtotal" style="color: #15803d;">~ ${totalCalculado}</strong></span>
                        </div>
                        <span class="articulo-tiempo-badge planta" title="${estArt.detalle || 'Evidencia real'}">🟢 ${estArt.detalle || 'Planta'}</span>
                    </div>
                `;
            } else if (estArt && estArt.origen === 'arbitraria') {
                const totalCalculado = estArt.minutos_totales ? (estArt.minutos_totales < 1 ? `${Math.round(estArt.minutos_totales * 60)} seg` : `${estArt.minutos_totales.toFixed(1)} min`) : '-';
                renglonTiempoHtml = `
                    <div class="articulo-renglon-tiempo origen-arbitraria" id="renglon-tiempo-${art.numero}">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>⏱️</span>
                            <span>Tiempo estimado: <strong>${estArt.minutos_unitarios.toFixed(2)} min/u</strong> × <span class="calc-cant">${art.cantidad}</span> u = <strong class="calc-subtotal" style="color: #b45309;">~ ${totalCalculado}</strong></span>
                        </div>
                        <span class="articulo-tiempo-badge arbitraria" title="Estimación teórica configurada en Búnker">🟡 Teórico Búnker</span>
                    </div>
                `;
            } else {
                renglonTiempoHtml = `
                    <div class="articulo-renglon-tiempo origen-sin-datos" id="renglon-tiempo-${art.numero}">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>⚪</span>
                            <span style="font-style: italic;">Sin datos de tiempo registrados</span>
                        </div>
                        <span class="articulo-tiempo-badge sin-datos" title="Sin métricas de planta ni tiempo teórico configurado">⚪ Sin datos</span>
                    </div>
                `;
            }

            html += `
                <div class="articulo-container" data-numero="${art.numero}" style="flex-direction: column; align-items: stretch; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div class="articulo-info">
                            <span class="articulo-codigo">${art.numero}</span>
                            <span class="articulo-descripcion">${art.descripcion}</span>
                        </div>
                        <div class="articulo-actions">
                            ${esConfirmado ? `
                                <span class="cantidad-badge-readonly" title="Cantidad producida">${art.cantidad} u</span>
                            ` : `
                                <input type="number"
                                       class="input-cantidad-articulo"
                                       value="${art.cantidad}"
                                       min="1"
                                       data-numero="${art.numero}">
                                <button class="btn-eliminar-articulo"
                                        data-numero="${art.numero}"
                                        title="Eliminar artículo">
                                    🗑️
                                </button>
                            `}
                        </div>
                        <div class="articulo-controls">
                            <button class="${btnClass}" style="${btnStyle}">Ver</button>
                        </div>
                    </div>
                    ${renglonTiempoHtml}
                </div>
            `;

            // 🔗 PARA CARROS EXTERNOS: Mostrar Insumos/Mezclas de Receta UP y estado del Artículo Puente (AP)
            let articulosRecetaUp = [];
            if (tipoCarro === 'externa') {
                try {
                    articulosRecetaUp = await obtenerResumenArticulosCarro(carroId, colaborador.id) || [];
                } catch (errUpArt) {
                    console.warn('No se pudieron obtener artículos de receta UP:', errUpArt);
                }

                if (articulosRecetaUp.length > 0) {
                    const detalleUpStr = articulosRecetaUp.map(ins => {
                        const cantU = parseFloat(ins.cantidad_total || 1);
                        const kTot = parseFloat(ins.kilos_totales || (cantU * (parseFloat(ins.kilos_unidad) || 1)));
                        return `<strong>${ins.articulo_numero}</strong> - ${ins.nombre || ''} (${cantU} u = ${kTot.toFixed(2)} kg)`;
                    }).join(' | ');
                    const badgeUpStatus = (esPreparado || esConfirmado)
                        ? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; font-size: 0.82em; font-weight: 700; padding: 3px 10px; border-radius: 9999px;">✅ Cargado y descontado (Receta UP)</span>`
                        : `<span style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; font-size: 0.82em; font-weight: 700; padding: 3px 10px; border-radius: 9999px;">⏳ Se descuenta al preparar carro</span>`;

                    html += `
                        <div class="articulo-insumo-up-banner" style="display: flex; align-items: center; justify-content: space-between; background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 6px; padding: 6px 12px; margin-top: 2px; margin-bottom: 6px; font-size: 0.88em; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.1em;">📦</span>
                                <span style="font-weight: bold; color: #5b21b6;">Insumo / Mezcla (Receta UP):</span>
                                <span style="color: #4c1d95;">${detalleUpStr}</span>
                            </div>
                            ${badgeUpStatus}
                        </div>
                    `;
                }

                if (tieneRelacion) {
                    const codPuenteSafe = (relacion.articulo_kilo_codigo || '').replace(/'/g, "\\'");
                    const nomPuenteSafe = (relacion.articulo_kilo_nombre || '').replace(/'/g, "\\'");
                    const barPuenteSafe = (relacion.articulo_kilo_codigo_barras || '').replace(/'/g, "\\'");
                    html += `
                        <div class="articulo-vinculado-banner" style="display: flex; align-items: center; justify-content: space-between; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 6px 12px; margin-top: 2px; margin-bottom: 8px; font-size: 0.88em; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.1em;">🔗</span>
                                <span style="font-weight: bold; color: #1e40af;">Artículo Puente:</span>
                                <span style="color: #1e3a8a;"><strong>${relacion.articulo_kilo_codigo}</strong> - ${relacion.articulo_kilo_nombre || ''}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button type="button"
                                        class="btn-imprimir-etiqueta-puente"
                                        onclick="window.imprimirEtiquetaArticuloPuente && window.imprimirEtiquetaArticuloPuente('${codPuenteSafe}', '${nomPuenteSafe}', '${barPuenteSafe}', '${carroId}')"
                                        style="background: #16a34a; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: bold; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;"
                                        title="Imprimir etiqueta de ${relacion.articulo_kilo_codigo}">
                                    🏷️ Imprimir Etiqueta
                                </button>
                                ${!esConfirmado ? `
                                    <button class="btn-editar-relacion-simple" 
                                            data-articulo="${art.numero}" 
                                            data-relacion-id="${relacion.id}"
                                            style="background: #2563eb; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; cursor: pointer;">
                                        ✏️ Cambiar
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                } else if (!esConfirmado) {
                    html += `
                        <div class="articulo-vinculado-banner" style="display: flex; align-items: center; justify-content: space-between; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 12px; margin-top: 2px; margin-bottom: 8px; font-size: 0.88em;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.1em;">⚠️</span>
                                <span style="font-weight: bold; color: #92400e;">Falta vincular Artículo Puente (AP)</span>
                            </div>
                            <button class="btn-vincular-articulo" 
                                    data-articulo="${art.numero}"
                                    style="background: #d97706; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: bold; cursor: pointer;">
                                ➕ Vincular Artículo Puente
                            </button>
                        </div>
                    `;
                }
            }


            // Obtener y mostrar ingredientes expandidos para este artículo
            const ingredientes = await obtenerIngredientesExpandidos(art.numero);

            if ((ingredientes && ingredientes.length > 0) || (articulosRecetaUp && articulosRecetaUp.length > 0)) {
                html += `
                    <div class="ingredientes-expandidos hidden" data-numero="${escaparAtributoHtml(art.numero)}">
                        <div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Ingrediente / Insumo Receta</th>
                                        <th>Cantidad</th>
                                        <th>Unidad / Peso</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                if (articulosRecetaUp && articulosRecetaUp.length > 0) {
                    articulosRecetaUp.forEach(ins => {
                        const cantU = parseFloat(ins.cantidad_total || 1);
                        const kTot = parseFloat(ins.kilos_totales || (cantU * (parseFloat(ins.kilos_unidad) || 1)));
                        html += `
                            <tr style="background: #faf5ff;">
                                <td>
                                    📦 <strong>[${ins.articulo_numero}]</strong> ${ins.nombre || ''}
                                    <span style="background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; font-size: 0.78em; font-weight: 700; padding: 1px 6px; border-radius: 9999px; margin-left: 6px;">Mezcla / Insumo Depósito</span>
                                </td>
                                <td style="font-weight: 700; color: #5b21b6;">${parseFloat(cantU.toFixed(2))}</td>
                                <td style="font-weight: 600; color: #5b21b6;">unidad (${kTot.toFixed(2)} kg)</td>
                            </tr>
                        `;
                    });
                }

                (ingredientes || []).forEach(ing => {
                    // Multiplicar la cantidad del ingrediente por la cantidad del artículo en el carro
                    const cantidadTotal = ing.cantidad * art.cantidad;

                    // Verificar si es un Mix por el nombre (contiene "Mix" al inicio)
                    const esMix = ing.nombre && ing.nombre.toLowerCase().startsWith('mix');

                    html += `
                        <tr>
                            <td>
                                ${ing.es_mix ?
                            `<span class="mix-nombre" 
                                           style="cursor: pointer; color: #0275d8; text-decoration: underline;"
                                           onclick="editarIngredienteCompuesto(${ing.id || ing.ingrediente_id || '\'' + (ing.nombre || '').replace(/'/g, "\\'") + '\''})">${ing.nombre}</span>` :
                            ing.nombre}
                            </td>
                <td data-base="${ing.cantidad}" data-valor="${cantidadTotal}">${parseFloat(cantidadTotal.toFixed(2))}</td>
                            <td>${ing.unidad_medida}</td>
                        </tr>
                    `;
                });

                html += `
                                </tbody>
                            </table>
                            ${construirBotonEditarRecetaHtml(art.numero, art.descripcion, 'editar')}
                        </div>
                    </div>
                `;
            } else {
                if (!tieneReceta) {
                    html += `
                        <div class="ingredientes-expandidos hidden" data-numero="${escaparAtributoHtml(art.numero)}">
                            <div style="text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 4px; margin-top: 10px;">
                                <p style="margin-bottom: 10px; color: #6c757d; font-weight: bold;">Este artículo no tiene una receta configurada.</p>
                                <button class="btn btn-primary btn-editar-receta" data-numero="${escaparAtributoHtml(art.numero)}" data-nombre="${escaparAtributoHtml(art.descripcion)}" data-modo="crear">Crear Receta</button>
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="ingredientes-expandidos hidden" data-numero="${escaparAtributoHtml(art.numero)}">
                            <div class="ingredientes-error">
                                No se pudieron cargar los ingredientes para este artículo.
                            </div>
                        </div>
                    `;
                }
            }

        }

        html += `</div>`; // cerrar seccion-articulos

        // ⏱️ Resumen de Métricas de Tiempo de Producción (para carros medidos o finalizados)
        try {
            const resMed = await fetch(`/api/tiempos/carro/${carroId}/estado-medicion?usuarioId=${colaborador.id}`);
            if (resMed.ok) {
                const dataMed = await resMed.json();
                if (dataMed && (dataMed.modo_medicion || dataMed.medicion_etapa_actual === 4 || (dataMed.metricas && dataMed.metricas.length > 0))) {
                    html += renderizarCardMetricasCarro(dataMed, articulos);
                }
            }
        } catch (e) {
            console.warn('Aviso al cargar métricas del carro:', e);
        }


        const contenedor = document.getElementById('lista-articulos');
        if (contenedor) {
            contenedor.innerHTML = html;

            // 🔍 UX: Restaurar colapsables abiertos
            collapsiblesAbiertos.forEach(numero => {
                const selectorNumero = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                    ? CSS.escape(numero)
                    : String(numero).replace(/"/g, '\\"');
                const articuloEl = contenedor.querySelector(`.articulo-container[data-numero="${selectorNumero}"]`);
                const expandido = buscarContenedorIngredientesExpandidos(articuloEl)
                    || contenedor.querySelector(`.ingredientes-expandidos[data-numero="${selectorNumero}"]`);
                if (expandido) {
                    expandido.classList.remove('hidden');
                    const btnToggle = articuloEl?.querySelector('.toggle-ingredientes');
                    if (btnToggle) btnToggle.textContent = 'Ocultar';
                }
            });

            // ⏱️ Sincronizar HUD de medición temporal si está disponible
            if (window.hudMedicion && carroId) {
                window.hudMedicion.activarParaCarro(carroId);
            }
        } else {
            console.error('No se encontró el contenedor lista-articulos');
        }

    } catch (error) {
        if (error.message.includes('No hay colaborador seleccionado')) {
            limpiarDatosSesion();
        } else {
            console.log('No se pueden cargar los artículos del carro porque no pertenece al usuario actual.');
            document.getElementById('lista-articulos').innerHTML = '<p>No se pueden mostrar los artículos del carro</p>';
        }
    }






}





/**
 * Genera los botones de relación para un artículo específico
 * @param {string} articuloCodigo - Código del artículo
 * @param {boolean} tieneRelacion - Si ya tiene una relación establecida
 * @param {Object} relacion - Objeto de relación existente (si existe)
 * @returns {string} HTML de los botones
 */
function generarBotonesRelacion(articuloCodigo, tieneRelacion, relacion) {
    if (tieneRelacion) {
        return ''; // No mostrar botones en el artículo original si ya tiene relación
    } else {
        return `
            <div class="botones-relacion">
                <button class="btn-vincular-articulo" 
                        data-articulo="${articuloCodigo}"
                        title="Vincular con artículo por kilo">
                    ➕ Vincular artículo por kilo
                </button>
            </div>
        `;
    }
}



/**
 * Genera la fila del artículo vinculado (visualmente atenuada)
 * @param {string} articuloProduccionCodigo - Código del artículo de producción
 * @param {Object} relacion - Objeto de relación con datos del artículo vinculado
 * @returns {string} HTML de la fila del artículo vinculado
 */
function generarFilaArticuloVinculado(articuloProduccionCodigo, relacion) {
    // Obtener descripción y código de barras del artículo vinculado
    const descripcionVinculado = relacion.articulo_kilo_nombre || 'Artículo vinculado por kilo';
    const codigoBarrasVinculado = relacion.articulo_kilo_codigo_barras || '';

    return `
        <div class="articulo-vinculado" data-articulo-padre="${articuloProduccionCodigo}">
            <div class="articulo-info">
                <span class="vinculo-icono">🔗</span>
                <span class="articulo-codigo">${relacion.articulo_kilo_codigo}</span>
                <span class="articulo-descripcion" title="${descripcionVinculado}">${descripcionVinculado}</span>
                ${codigoBarrasVinculado ? `<span class="codigo-barras" title="Código de barras: ${codigoBarrasVinculado}">📊 ${codigoBarrasVinculado}</span>` : ''}
                <span class="vinculo-etiqueta">Artículo vinculado</span>
            </div>
            <div class="articulo-actions">
                <span class="cantidad-vinculada">Cantidad automática</span>
            </div>
            <div class="articulo-controls">
                <button class="btn-editar-relacion-simple" 
                        data-articulo="${articuloProduccionCodigo}" 
                        data-relacion-id="${relacion.id}"
                        title="Editar vínculo con artículo por kilo">
                    ✏️ Editar vínculo
                </button>
                <button class="btn-eliminar-relacion" 
                        data-articulo="${articuloProduccionCodigo}" 
                        data-relacion-id="${relacion.id}"
                        title="Eliminar vínculo con artículo por kilo">
                    🗑️ Eliminar vínculo
                </button>
            </div>
        </div>
    `;
}

// ==========================================
// FUNCIONES PARA GESTIÓN DE RELACIONES
// ==========================================

/**
 * Abre el modal simplificado para vincular un artículo de producción externa con un artículo por kilo
 * @param {string} articuloCodigo - Código del artículo de producción externa
 */
async function abrirModalVincularArticulo(articuloCodigo) {
    try {
        console.log(`🔗 Abriendo modal simplificado para vincular artículo: ${articuloCodigo}`);

        // Obtener información del artículo padre
        const articuloInfo = await obtenerInfoArticulo(articuloCodigo);

        // Abrir el modal simplificado en modo crear
        await abrirModalEditarVinculoSimplificado(articuloCodigo, null, articuloInfo);

        // Cambiar el título del modal para reflejar que es para vincular
        const modal = document.getElementById('modal-editar-vinculo');
        if (modal) {
            const titulo = modal.querySelector('h2');
            if (titulo) {
                titulo.textContent = '➕ Vincular Artículo por Kilo';
            }

            // Configurar el modal para modo crear
            modal.dataset.modo = 'crear';
            delete modal.dataset.relacionId; // No hay relación existente
        }

    } catch (error) {
        console.error('Error al abrir modal de vinculación:', error);
        mostrarError('No se pudo abrir el modal de vinculación');
    }
}

/**
 * Abre el modal simplificado para editar una relación existente
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación existente
 */
async function abrirModalEditarRelacion(articuloCodigo, relacionId) {
    try {
        console.log(`✏️ Abriendo modal simplificado para editar relación: ${articuloCodigo} (ID: ${relacionId})`);

        // Obtener información del artículo padre
        const articuloInfo = await obtenerInfoArticulo(articuloCodigo);

        // Abrir el modal simplificado
        await abrirModalEditarVinculoSimplificado(articuloCodigo, relacionId, articuloInfo);

    } catch (error) {
        console.error('Error al abrir modal de edición:', error);
        mostrarError('No se pudo abrir el modal de edición');
    }
}

/**
 * Obtiene información de un artículo por su código
 * @param {string} articuloCodigo - Código del artículo
 * @returns {Object} Información del artículo
 */
async function obtenerInfoArticulo(articuloCodigo) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/articulos`);
        if (!response.ok) {
            throw new Error('Error al obtener información del artículo');
        }

        const responseData = await response.json();

        // 🛡️ BLINDAJE: Extraer array de diferentes formatos de respuesta
        const lista = responseData.data || responseData || [];

        // Validar que sea array
        if (!Array.isArray(lista)) {
            console.warn('⚠️ Respuesta no es array, asumiendo vacío');
            return { numero: articuloCodigo, nombre: 'Artículo no encontrado' };
        }

        const articulo = lista.find(art => art.numero === articuloCodigo);

        return articulo || { numero: articuloCodigo, nombre: 'Artículo no encontrado' };
    } catch (error) {
        console.error('Error al obtener info del artículo:', error);
        return { numero: articuloCodigo, nombre: 'Error al cargar información' };
    }
}

/**
 * Abre el modal simplificado para editar vínculos
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación existente
 * @param {Object} articuloInfo - Información del artículo padre
 */
async function abrirModalEditarVinculoSimplificado(articuloCodigo, relacionId, articuloInfo) {
    try {
        const modal = document.getElementById('modal-editar-vinculo');
        if (!modal) {
            throw new Error('No se encontró el modal de edición de vínculos');
        }

        // Configurar información del artículo padre
        const codigoPadre = modal.querySelector('.articulo-codigo-padre');
        const descripcionPadre = modal.querySelector('.articulo-descripcion-padre');

        if (codigoPadre) codigoPadre.textContent = articuloCodigo;
        if (descripcionPadre) descripcionPadre.textContent = articuloInfo.nombre || 'Sin descripción';

        // Cargar artículos disponibles PRIMERO
        await cargarArticulosParaVinculo();

        // Variable para guardar el artículo actualmente vinculado
        let articuloActualmenteVinculado = null;

        // Si es edición, cargar datos existentes de la relación
        if (relacionId && relacionId !== 'null' && relacionId !== 'undefined') {
            console.log(`\n🔍 DEPURACIÓN CARGA DE RELACIÓN EXISTENTE:`);
            console.log('===============================================');
            console.log('- relacionId:', relacionId, typeof relacionId);
            console.log('- URL a consultar:', `http://localhost:3002/api/produccion/relacion-articulo/${encodeURIComponent(articuloCodigo)}`);

            try {
                const response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${encodeURIComponent(articuloCodigo)}`);
                console.log('- Response status:', response.status);
                console.log('- Response ok:', response.ok);

                // 🛡️ MANEJO GRACEFUL DE 404: Tratar como nueva relación
                if (response.status === 404) {
                    console.log('⚠️ Relación no encontrada (404) - tratando como nueva relación');
                    console.log('🔄 Limpiando campos para permitir crear relación desde cero');

                    // Limpiar selector para modo "crear"
                    const selector = document.getElementById('selector-articulo-vinculo');
                    if (selector) {
                        selector.selectedIndex = 0;
                    }

                    // Cambiar el modo del modal a "crear"
                    delete modal.dataset.relacionId;
                    console.log('✅ Modal configurado en modo CREAR (relación no encontrada)');

                } else if (response.ok) {
                    const relacion = await response.json();
                    console.log(`\n📋 DATOS DE RELACIÓN RECIBIDOS DEL SERVIDOR:`);
                    console.log('- Objeto completo:', JSON.stringify(relacion, null, 2));
                    console.log('- articulo_kilo_codigo:', relacion.articulo_kilo_codigo);

                    // Guardar artículo actualmente vinculado para resaltarlo
                    articuloActualmenteVinculado = relacion.articulo_kilo_codigo;

                    // Preseleccionar el artículo vinculado
                    const selector = document.getElementById('selector-articulo-vinculo');
                    if (selector && relacion.articulo_kilo_codigo) {
                        selector.value = relacion.articulo_kilo_codigo;
                        console.log('✅ Artículo preseleccionado en selector:', relacion.articulo_kilo_codigo);
                    } else {
                        console.log('⚠️ No se pudo preseleccionar artículo - selector:', !!selector, 'codigo:', relacion.articulo_kilo_codigo);
                    }


                } else {
                    const errorText = await response.text();
                    console.warn('⚠️ Error al cargar relación (no 404)');
                    console.warn('- Status:', response.status);
                    console.warn('- Error response:', errorText);
                }
            } catch (error) {
                console.error('❌ Error al cargar datos de relación:', error);
                console.error('- Error completo:', error.message);
            }
        }

        // Elementos de estado visual (Estado A: Existente, Estado B: Búsqueda)
        const vinculoExistenteSection = document.getElementById('vinculo-existente-section');
        const selectorVinculoSection = document.getElementById('selector-vinculo-section');
        const btnCambiarVinculo = document.getElementById('btn-cambiar-vinculo');
        
        // Reset inicial de visibilidad (Modo Búsqueda por defecto)
        if (vinculoExistenteSection) vinculoExistenteSection.style.display = 'none';
        if (selectorVinculoSection) selectorVinculoSection.style.display = 'block';

        // 🎯 Si se está editando una relación existente, cambiar a Estado A
        if (articuloActualmenteVinculado) {
            // La receta se cargará automáticamente vía el evento 'change' disparado por cargarArticulosParaVinculo
            
            if (vinculoExistenteSection && selectorVinculoSection) {
                vinculoExistenteSection.style.display = 'block';
                selectorVinculoSection.style.display = 'none';
                
                // Setear información visual del vínculo actual extraída del array general
                const codigoArt = modal.querySelector('#vinculo-existente-section .articulo-codigo-padre');
                const descArt = modal.querySelector('#vinculo-existente-section .articulo-descripcion-padre');
                
                if (codigoArt) codigoArt.textContent = articuloActualmenteVinculado;
                
                // Buscar nombre
                const selector = document.getElementById('selector-articulo-vinculo');
                if (selector) {
                    const opcion = selector.querySelector(`option[value="${articuloActualmenteVinculado}"]`);
                    if (opcion && descArt) {
                        descArt.textContent = opcion.dataset.nombre || 'Artículo vinculado';
                    }
                }
                
                // Configurar el botón de cambio
                if (btnCambiarVinculo) {
                    btnCambiarVinculo.onclick = (e) => {
                        e.preventDefault();
                        vinculoExistenteSection.style.display = 'none';
                        selectorVinculoSection.style.display = 'block';
                        // Limpiar selection actual en el desplegable y receta para obligar nueva búsqueda
                        selector.value = '';
                        document.getElementById('preview-receta-vinculo').style.display = 'none';
                    };
                }
            }
        }

        // Configurar datos del modal
        modal.dataset.articuloCodigo = articuloCodigo;
        modal.dataset.relacionId = relacionId;

        // Mostrar el modal
        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

    } catch (error) {
        console.error('Error al abrir modal simplificado:', error);
        mostrarError(error.message);
    }
}

/**
 * Carga la lista de artículos disponibles para vincular
 * 🎯 OPTIMIZACIÓN: Filtra solo artículos fraccionables (por kilo)
 */
async function cargarArticulosParaVinculo() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/articulos-puente');
        if (!response.ok) {
            throw new Error('Error al cargar artículos puente');
        }

        const responseData = await response.json();

        // 🛡️ BLINDAJE: Extraer array de diferentes formatos de respuesta
        let lista = responseData.data || responseData || [];

        // Validar que sea array antes de usar .sort()
        if (!Array.isArray(lista)) {
            console.warn('⚠️ Respuesta no es array, asumiendo vacío');
            const selector = document.getElementById('selector-articulo-vinculo');
            if (selector) {
                selector.innerHTML = '<option value="">No hay artículos disponibles</option>';
            }
            return;
        }

        console.log(`🎯 [FILTRO-VINCULO DETERMINISTA] Artículos Puente cargados: ${lista.length}`);

        const selector = document.getElementById('selector-articulo-vinculo');

        if (!selector) return;

        // Limpiar opciones existentes
        selector.innerHTML = '<option value="">Seleccione un artículo puente...</option>';

        // Ordenar artículos alfabéticamente
        lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

        // Agregar opciones con icono identificador 🔗
        lista.forEach(articulo => {
            const option = document.createElement('option');
            option.value = articulo.numero;
            option.textContent = `🔗 ${articulo.numero} - ${articulo.nombre}`;
            option.dataset.nombre = articulo.nombre;
            selector.appendChild(option);
        });

        // Configurar búsqueda en tiempo real con lista filtrada
        configurarBusquedaVinculo(lista);

        // 🎯 EVENT LISTENER ÚNICO: Al seleccionar artículo, cargar preview de receta (usamos onchange para evitar multiplicar listeners al reabrir el modal)
        selector.onchange = (e) => {
            const codigoSeleccionado = e.target.value;
            if (codigoSeleccionado) {
                cargarPreviewReceta(codigoSeleccionado);
            } else {
                // Ocultar preview si se deselecciona
                const previewSection = document.getElementById('preview-receta-vinculo');
                if (previewSection) previewSection.style.display = 'none';
            }
        };

    } catch (error) {
        console.error('Error al cargar artículos:', error);
        const selector = document.getElementById('selector-articulo-vinculo');
        if (selector) {
            selector.innerHTML = '<option value="">Error al cargar artículos</option>';
        }
    }
}

/**
 * Configura la funcionalidad de búsqueda en tiempo real
 * @param {Array} articulos - Lista completa de artículos
 */
function configurarBusquedaVinculo(articulos) {
    const inputBusqueda = document.getElementById('buscar-articulo-vinculo');
    const selector = document.getElementById('selector-articulo-vinculo');

    if (!inputBusqueda || !selector) return;

    inputBusqueda.addEventListener('input', (e) => {
        const termino = e.target.value.toLowerCase().trim();

        // Limpiar selector
        selector.innerHTML = '<option value="">Seleccione un artículo...</option>';

        // 🎯 Filtrado Inteligente Multitérmino (Política Universal de Búsqueda)
        const terminos = termino.split(/\s+/).filter(t => t.length > 0);
        const articulosFiltrados = articulos.filter(articulo => {
            const indexCorpus = `${articulo.numero} ${articulo.nombre} ${articulo.nombre_legacy || ''} ${articulo.descripcion_generada || ''}`.toLowerCase();
            return terminos.every(t => indexCorpus.includes(t));
        });

        // Agregar opciones filtradas
        articulosFiltrados.forEach(articulo => {
            const option = document.createElement('option');
            option.value = articulo.numero;
            const esAP = articulo.propiedades_dinamicas && (articulo.propiedades_dinamicas.articulo_principal === 'Articulo Puente' || articulo.propiedades_dinamicas.articulo_principal === 'Artículo Puente');
            const prefixBadge = esAP ? '🔗 ' : '';
            option.textContent = `${prefixBadge}${articulo.numero} - ${articulo.nombre}`;
            option.dataset.nombre = articulo.nombre;
            selector.appendChild(option);
        });
    });
}

/**
 * Carga y renderiza la preview de receta del artículo vinculado seleccionado.
 * Consulta la API de ingredientes expandidos y muestra la tabla dinámica.
 * @param {string} articuloKiloCodigo - Código del artículo por kilo seleccionado
 */
async function cargarPreviewReceta(articuloKiloCodigo) {
    const previewSection = document.getElementById('preview-receta-vinculo');
    const loadingDiv = document.getElementById('preview-receta-loading');
    const emptyDiv = document.getElementById('preview-receta-empty');
    const tabla = document.getElementById('preview-receta-tabla');
    const tbody = document.getElementById('preview-receta-tbody');

    if (!previewSection || !tbody) {
        console.warn('⚠️ [PREVIEW-RECETA] Elementos del DOM no encontrados');
        return;
    }

    // Mostrar sección con estado de carga
    previewSection.style.display = 'block';
    if (loadingDiv) loadingDiv.style.display = 'flex';
    if (emptyDiv) emptyDiv.style.display = 'none';
    if (tabla) tabla.style.display = 'none';
    tbody.innerHTML = '';

    try {
        console.log(`📋 [PREVIEW-RECETA] Consultando receta expandida para: ${articuloKiloCodigo}`);

        const codigoCodificado = encodeURIComponent(articuloKiloCodigo);
        const response = await fetch(`http://localhost:3002/api/produccion/receta-expandida?codigo=${codigoCodificado}`);

        // Ocultar loading
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (response.status === 404) {
            // Artículo sin receta - permitir que agregue ingredientes
            console.log(`⚠️ [PREVIEW-RECETA] Artículo ${articuloKiloCodigo} no tiene receta`);
            if (emptyDiv) emptyDiv.style.display = 'flex';
            
            // Mostrar controles de todos modos
            if (tabla) tabla.style.display = 'table';
            const btnGuardar = document.getElementById('btn-guardar-receta-inline');
            if (btnGuardar) {
                btnGuardar.style.display = 'block';
                btnGuardar.dataset.articuloCodigo = encodeURIComponent(articuloKiloCodigo);
                btnGuardar.dataset.esNueva = 'true';
            }
            const addRow = document.getElementById('agregar-ingrediente-vinculo-row');
            if (addRow) addRow.style.display = 'flex';
            
            // Si no hay receta previa, limpiar pero mostrar tabla para que agregue
            tbody.innerHTML = '';
            configurarBuscadorIngredientesVinculo();
            return;
        }

        if (!response.ok) {
            throw new Error(`Error del servidor: ${response.status}`);
        }

        const ingredientes = await response.json();
        console.log(`✅ [PREVIEW-RECETA] ${ingredientes.length} ingredientes obtenidos`);

        if (!Array.isArray(ingredientes) || ingredientes.length === 0) {
            // Receta vacía
            if (emptyDiv) emptyDiv.style.display = 'flex';
            return;
        }

        // 🎯 INTERCEPCIÓN VITAL: Recuperar ingredientes customizados guardados (override a la global)
        const modal = document.getElementById('modal-editar-vinculo');
        const relacionId = modal.dataset.relacionId;
        const articuloCodigo = modal.dataset.articuloCodigo;
        
        if (relacionId && relacionId !== 'undefined' && relacionId !== 'null' && articuloCodigo) {
            try {
                const relResponse = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${encodeURIComponent(articuloCodigo)}`);
                if (relResponse.ok) {
                    const relacion = await relResponse.json();
                    if (relacion && relacion.ingredientes_custom && Array.isArray(relacion.ingredientes_custom)) {
                        console.log('🔄 [PERSISTENCIA] Inyectando receta customizada guardada en la tabla...');
                        relacion.ingredientes_custom.forEach(custom => {
                            const baseItem = ingredientes.find(ing => (ing.id == custom.ingrediente_id) || (ing.ingrediente_id == custom.ingrediente_id));
                            if (baseItem) {
                                baseItem.cantidad = custom.cantidad; // Sobrescribir con la cantidad editada y persistida
                            } else {
                                // Reinyectar adiciones manuales que no estaban en la receta origen
                                ingredientes.push({
                                    id: custom.ingrediente_id,
                                    ingrediente_id: custom.ingrediente_id,
                                    nombre_ingrediente: custom.nombre_ingrediente || 'Ingrediente Extra',
                                    unidad_medida: custom.unidad_medida || 'kg',
                                    cantidad: custom.cantidad
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.error('Error al intentar recuperar receta custom', e);
            }
        }

        // Renderizar tabla de ingredientes
        ingredientes.forEach(ing => {
            const tr = document.createElement('tr');
            const cantidadBase = parseFloat(ing.cantidad);
            const cantidadFormateada = cantidadBase.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

            tr.innerHTML = `
                <td>${ing.nombre || ing.nombre_ingrediente || '-'}</td>
                <td>
                    <input type="text" inputmode="decimal" class="input-receta-inline" 
                           data-ing-id="${ing.id || ing.ingrediente_id}" 
                           data-nombre="${ing.nombre || ing.nombre_ingrediente || ''}" 
                           data-unidad="${ing.unidad_medida || 'kg'}" 
                           value="${cantidadFormateada}" 
                           min="0" step="0.0001" 
                           style="width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
                </td>
                <td>${ing.unidad_medida || 'kg'}</td>
                <td>
                    <button class="btn-eliminar-ing-inline" onclick="this.closest('tr').remove()" title="Quitar ingrediente">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Habilitar agregados manuales
        const addRow = document.getElementById('agregar-ingrediente-vinculo-row');
        if (addRow) addRow.style.display = 'flex';
        configurarBuscadorIngredientesVinculo();

        // Mostrar tabla y botón de guardado
        if (tabla) tabla.style.display = 'table';
        const btnGuardar = document.getElementById('btn-guardar-receta-inline');
        if (btnGuardar) {
            btnGuardar.style.display = 'block';
            // Guardar en el botón a qué artículo pertenece la receta
            btnGuardar.dataset.articuloCodigo = encodeURIComponent(articuloKiloCodigo);
            btnGuardar.dataset.esNueva = 'false';
        }
        
        console.log(`✅ [PREVIEW-RECETA] Tabla renderizada con ${ingredientes.length} filas`);

    } catch (error) {
        console.error('❌ [PREVIEW-RECETA] Error al cargar receta:', error);
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (emptyDiv) {
            emptyDiv.querySelector('span:last-child').textContent = 'Error al cargar la receta. Intente de nuevo.';
            emptyDiv.style.display = 'flex';
        }
    }
}

/**
 * Cierra el modal simplificado de edición de vínculos
 */
function cerrarModalEditarVinculo() {
    const modal = document.getElementById('modal-editar-vinculo');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);

        // Limpiar datos
        delete modal.dataset.articuloCodigo;
        delete modal.dataset.relacionId;

        // Limpiar campos
        const inputBusqueda = document.getElementById('buscar-articulo-vinculo');
        const selector = document.getElementById('selector-articulo-vinculo');

        if (inputBusqueda) inputBusqueda.value = '';
        if (selector) selector.selectedIndex = 0;

        // 🎯 Limpiar panel de preview de receta
        const previewSection = document.getElementById('preview-receta-vinculo');
        const previewTbody = document.getElementById('preview-receta-tbody');
        const addRow = document.getElementById('agregar-ingrediente-vinculo-row');
        
        if (previewSection) previewSection.style.display = 'none';
        if (previewTbody) previewTbody.innerHTML = '';
        if (addRow) addRow.style.display = 'none';
    }
}

/**
 * Configura la búsqueda y agregado de ingredientes manuales en el modal de vínculo
 */
async function configurarBuscadorIngredientesVinculo() {
    const inputBuscar = document.getElementById('buscar-ingrediente-vinculo');
    const inputCantidad = document.getElementById('cantidad-ingrediente-vinculo');
    const ulResultados = document.getElementById('lista-resultados-vinculo');
    const btnAgregar = document.getElementById('btn-agregar-a-vinculo');
    const tbody = document.getElementById('preview-receta-tbody');
    const emptyDiv = document.getElementById('preview-receta-empty');
    let ingredienteSeleccionado = null;

    if (!inputBuscar || !ulResultados || !btnAgregar || !tbody) return;

    // Solo configurar una vez
    if (inputBuscar.dataset.configurado === 'true') return;
    inputBuscar.dataset.configurado = 'true';

    // Cargar ingredientes si no existen
    if (!window.ingredientesLista || window.ingredientesLista.length === 0) {
        try {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
            if (response.ok) {
                window.ingredientesLista = await response.json();
            } else {
                window.ingredientesLista = [];
            }
        } catch (e) {
            console.error('Error al cargar lista de ingredientes', e);
            window.ingredientesLista = [];
        }
    }

    inputBuscar.addEventListener('input', function() {
        const termino = this.value.toLowerCase().trim();
        ulResultados.innerHTML = '';
        ingredienteSeleccionado = null;

        if (termino.length < 2) {
            ulResultados.style.display = 'none';
            return;
        }

        // 🎯 Filtrado Inteligente Multitérmino
        const terminos = termino.split(/\s+/).filter(t => t.length > 0);
        const filtrados = window.ingredientesLista.filter(ing => {
            const indexCorpus = `${ing.id || ''} ${ing.nombre}`.toLowerCase();
            return terminos.every(t => indexCorpus.includes(t));
        });

        if (filtrados.length > 0) {
            filtrados.forEach(ing => {
                const li = document.createElement('li');
                li.textContent = `${ing.nombre} (${ing.unidad_medida})`;
                li.addEventListener('click', () => {
                    inputBuscar.value = ing.nombre;
                    ingredienteSeleccionado = ing;
                    ulResultados.style.display = 'none';
                    inputCantidad.focus();
                });
                ulResultados.appendChild(li);
            });
            ulResultados.style.display = 'block';
        } else {
            ulResultados.style.display = 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target !== inputBuscar && e.target !== ulResultados) {
            ulResultados.style.display = 'none';
        }
    });

    btnAgregar.addEventListener('click', (e) => {
        e.preventDefault();
        const cantidad = parseFloat(inputCantidad.value);

        if (!ingredienteSeleccionado) {
            alert('Por favor, busque y seleccione un ingrediente de la lista.');
            return;
        }
        if (isNaN(cantidad) || cantidad <= 0) {
            alert('Por favor, ingrese una cantidad válida mayor a 0.');
            return;
        }

        // Revisar si ya existe
        const existentes = tbody.querySelectorAll('.input-receta-inline');
        for (const input of existentes) {
            if (parseInt(input.dataset.ingId) === ingredienteSeleccionado.id) {
                alert('Este ingrediente ya está en la receta.');
                return;
            }
        }

        // Remover cartel vacío si estaba
        if (emptyDiv) emptyDiv.style.display = 'none';
        const tabla = document.getElementById('preview-receta-tabla');
        if (tabla) tabla.style.display = 'table';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${ingredienteSeleccionado.nombre}</td>
            <td>
                <input type="number" class="input-receta-inline" 
                       data-ing-id="${ingredienteSeleccionado.id}" 
                       data-nombre="${ingredienteSeleccionado.nombre}" 
                       data-unidad="${ingredienteSeleccionado.unidad_medida}" 
                       value="${cantidad.toFixed(4)}" 
                       min="0" step="0.0001" 
                       style="width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
            </td>
            <td>${ingredienteSeleccionado.unidad_medida}</td>
            <td>
                <button class="btn-eliminar-ing-inline" onclick="this.closest('tr').remove()" title="Quitar ingrediente">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);

        // Limpiar inputs
        inputBuscar.value = '';
        inputCantidad.value = '';
        ingredienteSeleccionado = null;
    });
}

/**
 * Procesa el guardado del vínculo (crear nuevo o editar existente)
 */
async function procesarGuardadoVinculo() {
    try {
        const modal = document.getElementById('modal-editar-vinculo');
        const selector = document.getElementById('selector-articulo-vinculo');

        if (!modal || !selector) {
            throw new Error('No se encontraron los elementos del modal');
        }

        const articuloCodigo = modal.dataset.articuloCodigo;
        const relacionId = modal.dataset.relacionId;
        const articuloKiloCodigo = selector.value;

        console.log(`\n🕵️‍♂️ VIGÍA DEPURADOR: Iniciando handleSaveLink (procesarGuardadoVinculo)`);
        console.log(`🔗 Guardando vínculo: ${articuloCodigo} → ${articuloKiloCodigo} (modo: ${relacionId ? 'editar' : 'crear'})`);

        if (!articuloCodigo) {
            console.log('❌ ERROR: Código de artículo de producción no válido');
            throw new Error('Código de artículo de producción no válido');
        }

        if (!articuloKiloCodigo) {
            console.log('❌ ERROR: Debe seleccionar un artículo por kilo');
            mostrarError('Debe seleccionar un artículo por kilo');
            return;
        }



        let response;
        let mensaje;
        let requestBody;

        // 1. Recolectar ingredientes custom de los inputs inline (si existen y fueron modificados)
        let ingredientesCustom = [];
        console.log('🔍 [VIGÍA] Capturando inputs de la tabla del modal...');
        const inputsInline = document.querySelectorAll('.input-receta-inline');
        if (inputsInline.length > 0) {
            inputsInline.forEach(input => {
                const ingrediente_id = parseInt(input.dataset.ingId);
                const cantidadRaw = input.value || '';
                // Transformación defensiva de origen: convertir coma europea a punto primitivo
                const cantidadParsed = parseFloat(cantidadRaw.replace(',', '.'));
                
                const idSeguro = isNaN(ingrediente_id) ? null : ingrediente_id;
                
                console.log(`  ➡️ [PARSE] Ingrediente ID ${idSeguro} | Input Txt: "${cantidadRaw}" -> Float nativo: ${cantidadParsed}`);
                
                const nombre_ingrediente = input.dataset.nombre || null;
                const unidad_medida = input.dataset.unidad || 'kg';
                
                if (!isNaN(cantidadParsed) && cantidadParsed > 0) {
                    ingredientesCustom.push({ 
                        ingrediente_id: idSeguro, 
                        cantidad: cantidadParsed, 
                        nombre_ingrediente,
                        unidad_medida
                    });
                } else {
                    console.warn(`  ⚠️ DATO IGNORADO: cantidad inválida=${cantidadParsed} para ingrediente ${nombre_ingrediente}`);
                }
            });
        }
        
        console.log(`📦 [VIGÍA] Array JSON final (ingredientes_custom) a persistir:`, ingredientesCustom);

        if (relacionId && relacionId !== 'undefined' && relacionId !== 'null') {
            // Editar relación existente
            requestBody = {
                articulo_kilo_codigo: articuloKiloCodigo,
                ingredientes_custom: ingredientesCustom.length > 0 ? ingredientesCustom : null
            };

            console.log(`✏️ Editando relación ${relacionId}: PUT /relacion-articulo/${relacionId}`);

            response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            mensaje = 'Vínculo actualizado correctamente';
        } else {
            // Crear nueva relación
            requestBody = {
                articulo_produccion_codigo: articuloCodigo,
                articulo_kilo_codigo: articuloKiloCodigo,
                ingredientes_custom: ingredientesCustom.length > 0 ? ingredientesCustom : null
            };

            console.log(`➕ Creando nueva relación: POST /relacion-articulo`);

            response = await fetch('http://localhost:3002/api/produccion/relacion-articulo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            mensaje = 'Vínculo creado correctamente';
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al procesar la relación');
        }

        const resultado = await response.json();
        console.log(`✅ Vínculo procesado: ${resultado.id || 'OK'}`);

        // Mostrar notificación de éxito
        mostrarNotificacionExito(mensaje);

        // Cerrar modal
        cerrarModalEditarVinculo();

        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();

    } catch (error) {
        console.error('❌ Error al guardar vínculo:', error);
        mostrarError(error.message);
    }
}

/**
 * Elimina una relación existente
 * @param {string} articuloCodigo - Código del artículo de producción externa
 * @param {number} relacionId - ID de la relación a eliminar
 */
async function eliminarRelacionArticulo(articuloCodigo, relacionId) {
    try {
        const confirmar = confirm(`¿Está seguro de que desea eliminar el vínculo del artículo ${articuloCodigo}?`);
        if (!confirmar) return;

        console.log(`🗑️ Eliminando relación: ${articuloCodigo} (ID: ${relacionId})`);

        const response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar la relación');
        }

        // Mostrar notificación de éxito
        mostrarNotificacionExito('Vínculo eliminado correctamente');

        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();

    } catch (error) {
        console.error('Error al eliminar relación:', error);
        mostrarError(error.message);
    }
}

/**
 * Abre el modal de artículos sin aplicar filtros de producción externa
 */
async function abrirModalArticulosSinFiltros() {
    try {
        const modal = document.getElementById('modal-articulos');
        if (!modal) {
            throw new Error('No se encontró el modal de artículos');
        }

        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        // Cargar TODOS los artículos sin filtros
        const response = await fetch('http://localhost:3002/api/produccion/articulos');

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener artículos');
        }

        const articulos = await response.json();

        if (articulos.length === 0) {
            mostrarError('No se encontraron artículos disponibles');
            return;
        }

        // Actualizar el título del modal
        const modalTitle = modal.querySelector('h2');
        if (modalTitle) {
            const tipoOperacion = window.modoVinculacion?.tipo === 'editar' ? 'Editar vínculo' : 'Vincular artículo';
            modalTitle.textContent = `🔗 ${tipoOperacion} - Seleccionar artículo por kilo`;
        }

        // Ocultar el switch de filtro de producción
        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        if (filtroProduccionSwitch) {
            filtroProduccionSwitch.checked = false;
            const formCheck = filtroProduccionSwitch.closest('.filtro-grupo');
            if (formCheck) {
                formCheck.style.display = 'none';
            }
        }

        // Actualizar la tabla con todos los artículos
        await actualizarTablaArticulosVinculacion(articulos);

    } catch (error) {
        console.error('Error al abrir modal sin filtros:', error);
        mostrarError(error.message);
        const modal = document.getElementById('modal-articulos');
        if (modal) {
            modal.style.display = 'none';
        }
    }
}

/**
 * Actualiza la tabla de artículos para el modo vinculación
 * @param {Array} articulos - Lista de artículos
 */
async function actualizarTablaArticulosVinculacion(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos disponibles</td></tr>';
        return;
    }

    // Ordenar artículos alfabéticamente
    articulos.sort((a, b) => a.nombre.localeCompare(b.nombre));

    articulos.forEach(articulo => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-numero', articulo.numero);

        tr.innerHTML = `
            <td>${articulo.numero}</td>
            <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
            <td style="text-align: center; font-weight: bold; color: ${articulo.stock_consolidado > 0 ? '#28a745' : '#dc3545'};">
                ${articulo.stock_consolidado || 0}
            </td>
            <td>
                <button class="btn-seleccionar-vinculacion" 
                        data-numero="${articulo.numero}" 
                        data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                        style="background-color: #007bff; color: white; border: none; padding: 6px 12px; border-radius: 4px;">
                    Seleccionar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Procesa la selección de un artículo para vinculación
 * @param {string} articuloKiloCodigo - Código del artículo por kilo seleccionado
 * @param {string} articuloKiloNombre - Nombre del artículo por kilo seleccionado
 */
async function procesarSeleccionVinculacion(articuloKiloCodigo, articuloKiloNombre) {
    try {
        if (!window.modoVinculacion || !window.modoVinculacion.activo) {
            throw new Error('No hay modo de vinculación activo');
        }

        const { articuloProduccion, relacionId, tipo } = window.modoVinculacion;

        console.log(`🔗 Procesando vinculación: ${articuloProduccion} -> ${articuloKiloCodigo}`);

        let response;

        if (tipo === 'crear') {
            // Crear nueva relación
            response = await fetch('http://localhost:3002/api/produccion/relacion-articulo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo_produccion_codigo: articuloProduccion,
                    articulo_kilo_codigo: articuloKiloCodigo
                })
            });
        } else if (tipo === 'editar') {
            // Actualizar relación existente
            response = await fetch(`http://localhost:3002/api/produccion/relacion-articulo/${relacionId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo_kilo_codigo: articuloKiloCodigo
                })
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al procesar la vinculación');
        }

        // Mostrar notificación de éxito
        const mensaje = tipo === 'crear' ? 'Vínculo creado correctamente' : 'Vínculo actualizado correctamente';
        mostrarNotificacionExito(mensaje);

        // Cerrar modal y limpiar modo vinculación
        cerrarModalVinculacion();

        // Actualizar la vista del carro
        await mostrarArticulosDelCarro();

    } catch (error) {
        console.error('Error al procesar vinculación:', error);
        mostrarError(error.message);
    }
}

/**
 * Cierra el modal de vinculación y limpia el estado
 */
function cerrarModalVinculacion() {
    const modal = document.getElementById('modal-articulos');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }

    // Limpiar campos de filtro
    // Limpiar campo de código de barras
    const codigoBarras = document.getElementById('codigo-barras');
    if (codigoBarras) codigoBarras.value = '';

    // Mostrar nuevamente el switch de filtro de producción
    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    if (filtroProduccionSwitch) {
        const formCheck = filtroProduccionSwitch.closest('.filtro-grupo');
        if (formCheck) {
            formCheck.style.display = 'block';
        }
    }

    // Limpiar modo vinculación
    window.modoVinculacion = null;
}

/**
 * Muestra una notificación de éxito
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarNotificacionExito(mensaje) {
    const notification = document.createElement('div');
    notification.textContent = mensaje;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #28a745;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        font-size: 14px;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Event listeners para los botones de relación y vinculación
document.addEventListener('click', async (e) => {
    // Toggle para mostrar/ocultar ingredientes
    const toggleBtn = e.target.closest('.toggle-ingredientes');
    if (toggleBtn) {
        const articuloContainer = toggleBtn.closest('.articulo-container');
        const ingredientes = buscarContenedorIngredientesExpandidos(articuloContainer);
        if (ingredientes) {
            ingredientes.classList.toggle('hidden');
            toggleBtn.textContent = ingredientes.classList.contains('hidden') ?
                'Ver' : 'Ocultar';
        }
    }

    // Botón vincular artículo
    if (e.target.classList.contains('btn-vincular-articulo')) {
        const articuloCodigo = e.target.dataset.articulo;
        await abrirModalVincularArticulo(articuloCodigo);
    }

    // Botón editar relación
    if (e.target.classList.contains('btn-editar-relacion')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }

    // Botón editar relación simple
    if (e.target.classList.contains('btn-editar-relacion-simple')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }

    // Botón eliminar relación
    if (e.target.classList.contains('btn-eliminar-relacion')) {
        const articuloCodigo = e.target.dataset.articulo;
        const relacionId = e.target.dataset.relacionId;
        await eliminarRelacionArticulo(articuloCodigo, relacionId);
    }

    // ✅ NUEVOS EVENT LISTENERS PARA ARTÍCULOS SECUNDARIOS

    // Botón editar vínculo secundario
    if (e.target.classList.contains('btn-editar-vinculo-secundario')) {
        const articuloCodigo = e.target.dataset.articuloPadre;
        const relacionId = e.target.dataset.relacionId;
        await abrirModalEditarRelacion(articuloCodigo, relacionId);
    }

    // Botón eliminar vínculo secundario
    if (e.target.classList.contains('btn-eliminar-vinculo-secundario')) {
        const articuloCodigo = e.target.dataset.articuloPadre;
        const relacionId = e.target.dataset.relacionId;
        await eliminarRelacionArticulo(articuloCodigo, relacionId);
    }

    // Botón seleccionar en modo vinculación
    if (e.target.classList.contains('btn-seleccionar-vinculacion')) {
        const articuloKiloCodigo = e.target.dataset.numero;
        const articuloKiloNombre = e.target.dataset.nombre;
        await procesarSeleccionVinculacion(articuloKiloCodigo, articuloKiloNombre);
    }

    if (e.target.id === 'btn-guardar-receta-inline') {
        window.guardarRecetaInline();
    }
});

// Hacer funciones disponibles globalmente para reactividad
window.obtenerResumenIngredientesCarro = obtenerResumenIngredientesCarro;
window.mostrarResumenIngredientes = mostrarResumenIngredientes;
window.obtenerResumenMixesCarro = obtenerResumenMixesCarro;
window.mostrarResumenMixes = mostrarResumenMixes;
window.obtenerResumenArticulosCarro = obtenerResumenArticulosCarro;
window.mostrarResumenArticulos = mostrarResumenArticulos;
window.actualizarEstadoCarro = actualizarEstadoCarro;
window.mostrarArticulosDelCarro = mostrarArticulosDelCarro;

window.guardarRecetaInline = async function() {
    console.log('\n🕵️‍♂️ VIGÍA DEPURADOR: Iniciando handleSaveRecipe (guardarRecetaInline)');
    try {
        const btnGuardar = document.getElementById('btn-guardar-receta-inline');
        if (!btnGuardar) throw new Error('No se encontró el botón de guardado');
        const articuloCodigo = decodeURIComponent(btnGuardar.dataset.articuloCodigo);
        if (!articuloCodigo || articuloCodigo === 'undefined') throw new Error('Código de artículo no válido');

        // 1. Recolectar ingredientes
        let ingredientes = [];
        console.log('🔍 [VIGÍA] Capturando inputs de receta inline para receta BASE (global)...');
        const inputsInline = document.querySelectorAll('.input-receta-inline');
        inputsInline.forEach(input => {
            const ingrediente_id = parseInt(input.dataset.ingId);
            const cantidadRaw = input.value || '';
            const cantidadParsed = parseFloat(cantidadRaw.replace(',', '.'));
            
            const idSeguro = isNaN(ingrediente_id) ? null : ingrediente_id;
            
            console.log(`  ➡️ [PARSE] Ingrediente ID ${idSeguro} | Input Txt: "${cantidadRaw}" -> Float nativo: ${cantidadParsed}`);
            
            if (!isNaN(cantidadParsed) && cantidadParsed > 0) {
                ingredientes.push({
                    ingrediente_id: idSeguro,
                    cantidad: cantidadParsed,
                    nombre_ingrediente: input.dataset.nombre,
                    unidad_medida: input.dataset.unidad || 'kg'
                });
            } else {
                console.warn(`  ⚠️ DATO IGNORADO: cantidad inválida=${cantidadParsed} para ingrediente ${input.dataset.nombre}`);
            }
        });

        console.log(`📦 [VIGÍA] Array JSON a depositar en BD Recetas Global:`, ingredientes);

        if (ingredientes.length === 0) {
            alert('Debe agregar al menos un ingrediente válido mayor a 0');
            return;
        }

        const requestBody = {
            articulo_numero: articuloCodigo,
            descripcion: `Receta de ${articuloCodigo}`,
            ingredientes: ingredientes,
            articulos: [],
            esProduccionExternaConArticuloPrincipal: false,
            upsert: true
        };

        const esNueva = btnGuardar.dataset.esNueva === 'true';
        const finalMethod = esNueva ? 'POST' : 'PUT';
        const url = esNueva 
            ? '/api/produccion/recetas' 
            : `/api/produccion/recetas/${encodeURIComponent(articuloCodigo)}`;

        console.log(`🚀 [VIGÍA] Ejecutando ${finalMethod} a ${url}...`);
        console.log('- Payload JSON:', JSON.stringify(requestBody));

        const response = await fetch(url, {
            method: finalMethod,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Status ${response.status}: ${errText}`);
        }

        console.log('✅ [VIGÍA] Status 200/201 alcanzado - Receta global depositada c/éxito.');
        
        // Efecto UX de éxito
        const emptyDiv = document.getElementById('preview-receta-empty');
        if (emptyDiv) emptyDiv.style.display = 'none';
        
        btnGuardar.classList.remove('btn-primary');
        btnGuardar.classList.add('btn-success');
        btnGuardar.textContent = '✅ Guardada';
        setTimeout(() => {
            btnGuardar.classList.remove('btn-success');
            btnGuardar.classList.add('btn-primary');
            btnGuardar.textContent = '💾 Guardar Receta';
            btnGuardar.style.display = 'none'; // Se oculta porque legalmente ya existe
        }, 3000);

    } catch (e) {
        console.error('❌ [VIGÍA] Error crítico (Unhandled Exception atrapada) en handleSaveRecipe:\n', e);
        alert(`Error al guardar receta: ${e.message}`);
    }
};

// ==========================================
// FUNCIONES PARA ACORDEONES Y UI CONTEXTUAL
// ==========================================

/**
 * Función genérica para toggle de secciones colapsables (acordeón)
 * @param {string} seccionId - ID de la sección a colapsar/expandir
 */
window.toggleSeccion = function (seccionId) {
    const seccion = document.getElementById(seccionId);
    if (!seccion) return;

    seccion.classList.toggle('collapsed');
    console.log(`🔄 Sección ${seccionId} ${seccion.classList.contains('collapsed') ? 'colapsada' : 'expandida'}`);
};

/**
 * Gestiona la visibilidad de secciones según el tipo de carro
 * @param {string} tipoCarro - 'interna' o 'externa'
 */
export function gestionarVisibilidadSeccionesPorTipo(tipoCarro) {
    const seccionMixes = document.getElementById('resumen-mixes');

    if (tipoCarro === 'interna') {
        // Ocultar sección de ingredientes compuestos para carros internos
        if (seccionMixes) {
            seccionMixes.style.display = 'none';
            console.log('🏭 Carro interno: ocultando sección de ingredientes compuestos');
        }
    } else {
        // Mostrar sección de ingredientes compuestos para carros externos
        if (seccionMixes) {
            seccionMixes.style.display = 'block';
            console.log('🚚 Carro externo: mostrando sección de ingredientes compuestos');
        }
    }
}

// ==========================================
// FUNCIÓN WRAPPER PARA AJUSTE DESDE CARRO
// ==========================================

/**
 * Función wrapper para abrir modal de ajuste desde el carro
 * Configura correctamente el contexto y la función de actualización
 * @param {number} ingredienteId - ID del ingrediente
 * @param {string} nombreIngrediente - Nombre del ingrediente
 * @param {number} stockActual - Stock actual del ingrediente
 * @param {number} carroId - ID del carro activo
 */
window.abrirModalAjusteDesdeCarro = async function (ingredienteId, nombreIngrediente, stockActual, carroId) {
    console.log('🚚 [CARRO-AJUSTE] Abriendo modal de ajuste desde carro...');
    console.log(`   - Ingrediente: ${nombreIngrediente} (ID: ${ingredienteId})`);
    console.log(`   - Stock actual: ${stockActual}`);
    console.log(`   - Carro ID: ${carroId}`);

    // Obtener datos del colaborador
    const colaboradorData = localStorage.getItem('colaboradorActivo');
    if (!colaboradorData) {
        alert('❌ Error: No hay colaborador seleccionado');
        return;
    }

    const colaborador = JSON.parse(colaboradorData);
    const usuarioId = colaborador.id;

    // Obtener tipo de carro para determinar si es stock de usuario
    let esStockUsuario = false;
    try {
        const estadoResp = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
        if (estadoResp.ok) {
            const estadoData = await estadoResp.json();
            esStockUsuario = (estadoData.tipo_carro === 'externa');
            console.log(`🔍 [CARRO-AJUSTE] Tipo de carro: ${estadoData.tipo_carro}, es stock usuario: ${esStockUsuario}`);
        }
    } catch (error) {
        console.warn('⚠️ [CARRO-AJUSTE] No se pudo determinar tipo de carro');
    }

    // 🔧 Configurar contexto en el modal usando data-attributes
    const modalAjuste = document.getElementById('modalAjusteKilos');
    if (modalAjuste && esStockUsuario) {
        modalAjuste.dataset.usuarioActivo = usuarioId;
        modalAjuste.dataset.origenContexto = 'carro_externo';
        console.log(`✅ [CARRO-AJUSTE] Contexto establecido: usuario=${usuarioId}, origen=carro_externo`);
    }

    // 🔧 Configurar función de actualización ANTES de abrir el modal
    window.actualizarResumenIngredientes = async () => {
        console.log('🔄 [CARRO-AJUSTE] Actualizando resumen después del ajuste...');
        const carroIdActual = sessionStorage.getItem('carroActivo');
        const colaboradorDataActual = localStorage.getItem('colaboradorActivo');

        if (carroIdActual && colaboradorDataActual) {
            const colaboradorActual = JSON.parse(colaboradorDataActual);

            // Actualizar resumen de ingredientes
            const ingredientes = await obtenerResumenIngredientesCarro(carroIdActual, colaboradorActual.id);
            await mostrarResumenIngredientes(ingredientes);

            // Actualizar resumen de mixes
            const mixes = await obtenerResumenMixesCarro(carroIdActual, colaboradorActual.id);
            mostrarResumenMixes(mixes);

            console.log('✅ [CARRO-AJUSTE] Resumen actualizado correctamente');
        }
    };

    // Abrir el modal de ajuste
    if (typeof window.abrirModalAjusteRapido === 'function') {
        console.log('🚀 [CARRO-AJUSTE] Llamando a abrirModalAjusteRapido...');
        window.abrirModalAjusteRapido(ingredienteId, nombreIngrediente, stockActual, carroId);
    } else {
        console.error('❌ [CARRO-AJUSTE] abrirModalAjusteRapido no está disponible');
        alert('❌ Error: El módulo de ajuste rápido no está cargado. Recarga la página con Ctrl+F5.');
    }
};

// Exportar funciones para uso en módulos ES6
export {
    cerrarModalEditarVinculo,
    procesarGuardadoVinculo
};

// ==========================================
// AUTO-REFRESH DEL CARRO AL ACTUALIZAR RECETAS (Ticket #014)
// ==========================================
document.addEventListener('recetaActualizada', async (event) => {
    try {
        console.log('🔄 [CARRO] Evento recetaActualizada capturado. Refrescando carro para artículo:', event.detail?.articulo_numero);
        
        // Refrescar el DOM del carro manteniendo los colapsables (gracias a la lógica en mostrarArticulosDelCarro)
        await mostrarArticulosDelCarro();
        
        // Refrescar los resúmenes consolidados de la derecha (Ingredientes, Mixes, Faltantes)
        const carroIdActual = sessionStorage.getItem('carroActivo');
        const colaboradorDataActual = localStorage.getItem('colaboradorActivo');
        
        if (carroIdActual && colaboradorDataActual) {
            const colaboradorActual = JSON.parse(colaboradorDataActual);
            
            const ingredientes = await obtenerResumenIngredientesCarro(carroIdActual, colaboradorActual.id);
            await mostrarResumenIngredientes(ingredientes);
            
            const mixes = await obtenerResumenMixesCarro(carroIdActual, colaboradorActual.id);
            mostrarResumenMixes(mixes);
            
            const articulos = await obtenerResumenArticulosCarro(carroIdActual, colaboradorActual.id);
            if (articulos && articulos.length > 0) {
                mostrarResumenArticulos(articulos);
                const seccionArticulos = document.getElementById('resumen-articulos');
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                }
            }
        }
        
    } catch (error) {
        console.error('⚠️ [CARRO] Error durante el auto-refresh tras actualización de receta:', error);
    }
});

// GESTIÓN ACTIVA DE APERTURA DE CAJAS DESDE EL CARRO DE PRODUCCIÓN
window.abrirCajaDesdeCarro = async function(ingredienteId, nombre, lotes) {
    if (!lotes || lotes.length === 0) {
        Swal.fire('Error', 'No hay lotes con cajas cerradas disponibles para este ingrediente.', 'warning');
        return;
    }

    let vinculoId = null;
    let loteIdSupabase = null;
    let idCorto = null;
    let cantidadDisponible = 0;

    if (lotes.length === 1) {
        vinculoId = lotes[0].vinculo_id;
        loteIdSupabase = lotes[0].lote_id_supabase;
        idCorto = loteIdSupabase.substring(0, 6);
        cantidadDisponible = lotes[0].cajas_disponibles;
    } else {
        // Múltiples lotes: mostrar selector de lote (FIFO y descripción)
        const options = {};
        lotes.forEach(l => {
            const dateStr = l.fecha_vinculacion ? new Date(l.fecha_vinculacion).toLocaleDateString() : 'N/A';
            options[l.vinculo_id] = `Lote: ${l.lote_id_supabase} (${l.cajas_disponibles} cj, ${parseFloat(l.kilos_por_caja).toFixed(2)} kg/cj) - Vinc: ${dateStr}`;
        });

        const { value: selectedVinculoId } = await Swal.fire({
            title: 'Seleccionar lote a abrir',
            text: `Selecciona de qué lote deseas abrir una caja para el ingrediente "${nombre}".`,
            input: 'select',
            inputOptions: options,
            inputPlaceholder: 'Seleccionar un lote...',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Seleccionar Lote',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value) {
                    return 'Debes seleccionar un lote';
                }
            }
        });

        if (!selectedVinculoId) return;

        const selectedLote = lotes.find(l => l.vinculo_id === selectedVinculoId);
        if (!selectedLote) return;

        vinculoId = selectedLote.vinculo_id;
        loteIdSupabase = selectedLote.lote_id_supabase;
        idCorto = loteIdSupabase.substring(0, 6);
        cantidadDisponible = selectedLote.cajas_disponibles;
    }

    let cantidadA_Abrir = 1;
    if (cantidadDisponible > 1) {
        const { value: inputCant } = await Swal.fire({
            title: '¿Cuántas cajas deseas abrir?',
            text: `Hay ${cantidadDisponible} cajas cerradas disponibles para el lote (${idCorto}). Se restarán las cajas seleccionadas y se ingresará el equivalente en Kilos Libres al stock de fábrica.`,
            input: 'number',
            inputLabel: 'Cantidad de cajas',
            inputValue: 1,
            inputAttributes: {
                min: 1,
                max: cantidadDisponible,
                step: 1
            },
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Abrir cajas',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || isNaN(value) || parseInt(value) < 1 || parseInt(value) > cantidadDisponible) {
                    return `Por favor, ingresa un número entre 1 y ${cantidadDisponible}`;
                }
            }
        });

        if (!inputCant) return;
        cantidadA_Abrir = parseInt(inputCant);
    } else {
        const confirm = await Swal.fire({
            title: '¿Abrir caja de ingrediente?',
            text: `Se restará 1 caja del stock cerrado de Ingredientes y se ingresará el equivalente en Kilos Libres al stock de fábrica para el lote ${idCorto}.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, abrir caja',
            cancelButtonText: 'Cancelar'
        });

        if (!confirm.isConfirmed) return;
    }

    Swal.fire({
        title: 'Procesando Apertura...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch('http://localhost:3005/api/logistica/bunker/lotes_vinculos/abrir_caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vinculo_id: vinculoId, destino_id: ingredienteId, cantidad: cantidadA_Abrir })
        });
        const result = await res.json();

        if (res.ok && result.success) {
            await Swal.fire('Caja Abierta', `Se ha transferido ${cantidadA_Abrir} caja(s) a stock de kilos libres de fábrica.`, 'success');
            
            // Recargar el resumen de ingredientes en caliente
            if (window.actualizarResumenIngredientes) {
                await window.actualizarResumenIngredientes();
            } else {
                window.location.reload();
            }
        } else {
            throw new Error(result.error || 'Error al procesar apertura');
        }
    } catch (e) {
        console.error('[VIGÍA FRONTEND] -> ERROR APERTURA DESDE CARRO:', e);
        Swal.fire('Error', e.message || 'Error de conexión', 'error');
    }
};
