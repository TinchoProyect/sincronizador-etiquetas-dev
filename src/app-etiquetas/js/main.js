// ═══════════════════════════════════════════════════════════
// INDICADOR DE ENTORNO Y RELOJ PIZARRA
// ═══════════════════════════════════════════════════════════

/**
 * Consulta el estado del entorno y actualiza el indicador visual
 */
async function cargarIndicadorEntorno() {
  try {
    const response = await fetch('/api/config/status');
    
    if (!response.ok) {
      console.warn('No se pudo obtener el estado del entorno');
      return;
    }

    const data = await response.json();
    const indicator = document.getElementById('environment-indicator');
    const iconElement = indicator.querySelector('.icon');
    const textElement = indicator.querySelector('.text');
    const pulseElement = indicator.querySelector('.pulse');

    // Limpiar clases previas
    indicator.classList.remove('test', 'production');

    if (data.isTest) {
      // Modo PRUEBAS - Indicador llamativo
      indicator.classList.add('test');
      indicator.setAttribute('data-tooltip', `Conectado a Base de Datos de Pruebas (${data.database})`);
      if (iconElement) iconElement.textContent = '⚠️';
      if (textElement) textElement.textContent = `Pruebas: ${data.database}`;
      if (pulseElement) pulseElement.style.display = 'block';
      indicator.style.display = 'inline-block';
      
      console.log('%c🧪 MODO PRUEBAS ACTIVO', 'background: #ff6b6b; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Puedes realizar operaciones destructivas sin riesgo', 'color: #ff8e53; font-weight: bold;');
      
    } else if (data.isProduction) {
      // Modo PRODUCCIÓN - Indicador sutil
      indicator.classList.add('production');
      indicator.setAttribute('data-tooltip', 'Conectado a Base de Datos de Producción');
      if (iconElement) iconElement.textContent = '●';
      if (textElement) textElement.textContent = 'Producción';
      if (pulseElement) pulseElement.style.display = 'block';
      indicator.style.display = 'inline-block';
      
      console.log('%c✅ MODO PRODUCCIÓN', 'background: #28a745; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
      console.log(`📊 Base de datos: ${data.database}`);
      console.log(`🌍 Entorno: ${data.environment}`);
      console.log('%c⚠️ Ten cuidado con operaciones destructivas', 'color: #dc3545; font-weight: bold;');
    }

  } catch (error) {
    console.error('Error al cargar indicador de entorno:', error);
  }
}

/**
 * Actualiza la fecha y la hora en el canvas de la pizarra central
 */
function actualizarPizarraDateTime() {
  const timeEl = document.getElementById('pizarra-time');
  const dateEl = document.getElementById('pizarra-date');
  if (!timeEl || !dateEl) return;

  const ahora = new Date();
  
  // Formato Hora: HH:MM:SS
  timeEl.textContent = ahora.toLocaleTimeString('es-AR', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: false 
  });
  
  // Formato Fecha: viernes, 3 de julio de 2026
  const opcionesFecha = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const fechaFormateada = ahora.toLocaleDateString('es-AR', opcionesFecha);
  
  // Capitalizar primer letra
  dateEl.textContent = fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1);
}

// Cargar el indicador al iniciar la página
document.addEventListener('DOMContentLoaded', () => {
  cargarIndicadorEntorno();
  cargarIndicadorWhatsApp();
  
  // Inicializar y actualizar la pizarra central (fecha/hora)
  actualizarPizarraDateTime();
  setInterval(actualizarPizarraDateTime, 1000);

  // Inicializar y actualizar alertas dinámicas de la pizarra
  actualizarAlertasPizarra();
  setInterval(actualizarAlertasPizarra, 5000);

  // Inicializar y actualizar widget de colaboradores en depósito
  actualizarWidgetColaboradoresPizarra();
  setInterval(actualizarWidgetColaboradoresPizarra, 5000);
  setInterval(actualizarCronometrosColaboradoresLocal, 1000);

  // Polling activo cada 5 segundos para refrescar estado en tiempo real
  setInterval(cargarIndicadorWhatsApp, 5000);
});

/**
 * Limpia y normaliza la descripción del artículo para la visualización en la Pizarra
 */
function limpiarDescripcionArticulo(desc) {
  if (!desc) return '';
  let limpia = desc;
  if (limpia.includes('Mix/F/Secas/Premium')) {
    limpia = limpia.replace('Mix/F/Secas/Premium', 'Mix Frutos Secos Premium');
  }
  // Reemplazar " x " o " x" por " por "
  limpia = limpia.replace(/\s+x\s*/g, ' por ');
  // Reemplazar barras inclinadas sobrantes
  limpia = limpia.replace(/\//g, ' ');
  return limpia.trim();
}

// Memoria de pedidos desplegados en la Pizarra (se mantiene durante los ciclos de polling)
window.pizarraPedidosExpandidos = window.pizarraPedidosExpandidos || new Set();
// Memoria de estaciones del Plan de Trabajo de Depósito desplegadas (Mirada Consciente)
window.pizarraEstacionesExpandidas = window.pizarraEstacionesExpandidas || new Set();
// Horizonte activo seleccionado en el Plan de Trabajo de Depósito ('7d' | '15d' | '30d')
window.pizarraHorizonteDepositoActivo = window.pizarraHorizonteDepositoActivo || '7d';

window.togglePedidoFaltantes = function(pedidoId) {
  const pIdStr = String(pedidoId);
  const container = document.getElementById(`subitems-pedido-${pIdStr}`);
  const badge = document.getElementById(`badge-prod-${pIdStr}`);

  if (window.pizarraPedidosExpandidos.has(pIdStr)) {
    window.pizarraPedidosExpandidos.delete(pIdStr);
    if (container) container.classList.remove('is-open');
    if (badge) badge.classList.remove('is-open');
  } else {
    window.pizarraPedidosExpandidos.add(pIdStr);
    if (container) container.classList.add('is-open');
    if (badge) badge.classList.add('is-open');
  }
};

window.toggleEstacionDeposito = function(estacionId) {
  const idStr = String(estacionId);
  const drawer = document.getElementById(`drawer-estacion-${idStr}`);
  const chev = document.getElementById(`chev-estacion-${idStr}`);
  if (window.pizarraEstacionesExpandidas.has(idStr)) {
    window.pizarraEstacionesExpandidas.delete(idStr);
    if (drawer) drawer.classList.remove('abierto');
    if (chev) chev.textContent = '▼';
  } else {
    window.pizarraEstacionesExpandidas.add(idStr);
    if (drawer) drawer.classList.add('abierto');
    if (chev) chev.textContent = '▲';
  }
};

window.cambiarHorizonteDepositoPizarra = function(horizonte) {
  window.pizarraHorizonteDepositoActivo = horizonte;
  if (typeof window.actualizarAlertasPizarra === 'function') {
    window.actualizarAlertasPizarra();
  }
};

window.toggleAcordeonPlanDeposito = function() {
  const actual = typeof window.pizarraPlanDepositoExpandido === 'boolean'
    ? window.pizarraPlanDepositoExpandido
    : (localStorage.getItem('pizarra_plan_deposito_open') !== 'false');
  const nuevo = !actual;
  window.pizarraPlanDepositoExpandido = nuevo;
  localStorage.setItem('pizarra_plan_deposito_open', String(nuevo));
  const body = document.getElementById('pizarra-plan-deposito-body');
  const chev = document.getElementById('pizarra-plan-deposito-chevron');
  if (body) body.classList.toggle('abierto', nuevo);
  if (chev) chev.classList.toggle('rotado', nuevo);
};

/**
 * Fallback en caliente desde el navegador usando /api/produccion/informe/planificacion-lunes
 * si el proceso principal aún no fue reiniciado.
 */
window.construirPlanDepositoFallbackLive = async function() {
  try {
    const res = await fetch('/api/produccion/informe/planificacion-lunes?modo=plan_deposito_pizarra');
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success ? data : null;
  } catch (err) {
    return null;
  }
};

/**
 * Construye el HTML limpio y directo de las Tareas de Producción en Depósito
 * pensado exclusivamente para el colaborador que opera en taller/depósito.
 */
window.pizarraAcordeonesLdnAbiertos = window.pizarraAcordeonesLdnAbiertos || new Set();

window.toggleAcordeonGrupoLdn = function(grupoKey) {
  const key = String(grupoKey);
  const body = document.getElementById(`body-grupo-ldn-${key}`);
  const chev = document.getElementById(`chev-grupo-ldn-${key}`);
  if (window.pizarraAcordeonesLdnAbiertos.has(key)) {
    window.pizarraAcordeonesLdnAbiertos.delete(key);
    if (body) body.classList.remove('abierto');
    if (chev) chev.classList.remove('rotado');
  } else {
    window.pizarraAcordeonesLdnAbiertos.add(key);
    if (body) body.classList.add('abierto');
    if (chev) chev.classList.add('rotado');
  }
};

window.construirHtmlPlanTrabajoDeposito = function(plan) {
  if (!plan || !plan.resumen_horizontes) return '';

  const rh = plan.resumen_horizontes;
  const est7d = Array.isArray(plan.estaciones_semana_7d) ? plan.estaciones_semana_7d : [];
  const est15d = Array.isArray(plan.estaciones_adelanto_15d) ? plan.estaciones_adelanto_15d : [];
  const est30d = Array.isArray(plan.estaciones_adelanto_30d) ? plan.estaciones_adelanto_30d : [];

  const isOpen = typeof window.pizarraPlanDepositoExpandido === 'boolean'
    ? window.pizarraPlanDepositoExpandido
    : (localStorage.getItem('pizarra_plan_deposito_open') !== 'false');

  const hActivo = window.pizarraHorizonteDepositoActivo || '7d';

  const fmtMinGrupo = (minutos) => {
    const mTotal = Math.round(Number(minutos) || 0);
    if (mTotal <= 0) return '0 min';
    const h = Math.floor(mTotal / 60);
    const m = mTotal % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m} min`;
  };

  const fmtCeldaCant = (p, cant) => {
    if (!cant || cant <= 0) return '<span style="color:#94a3b8;">—</span>';
    const kU = Number(p.kilos_unidad) || 1;
    const pesoTxt = p.etiqueta_peso || (kU < 1 ? `${Math.round(kU * 1000)}g` : `${kU}kg`);
    const packU = p.es_hijo && p.pack_unidades > 1
      ? (kU === 0.5 && p.pack_unidades === 10 && cant % 5 === 0 ? 5 : p.pack_unidades)
      : 1;
    if (packU > 1 && cant % packU === 0) {
      const packs = Math.round(cant / packU);
      return `<strong style="font-size:0.92rem;">${cant} u.</strong> <span style="font-weight:500;color:#475569;">(${packs} ${packs === 1 ? 'pack' : 'packs'} de ${packU} x ${pesoTxt})</span>`;
    }
    return `<strong style="font-size:0.92rem;">${cant} u.</strong>`;
  };

  const renderTarjetaEstacion = (est, hKey) => {
    const isExpanded = window.pizarraEstacionesExpandidas.has(est.id);
    const met = est.metricas_horizonte?.[hKey] || est.metricas_horizonte?.['7d'] || { unidades: 0, kilos: 0, tiempo_formateado: '0 min' };
    const pasos = est.pasos_horizonte?.[hKey] || est.pasos_horizonte?.['7d'] || {};
    const presList = Array.isArray(est.presentaciones) ? est.presentaciones : [];

    const pillText = est.mirada_consciente?.pill || 'Detalle';

    let filasTabla = '';
    presList.forEach(p => {
      const descBunker = (p.descripcion || p.sku || '').trim();
      filasTabla += `
        <tr>
          <td><strong>${descBunker}</strong> <span style="color:#64748b;font-size:0.78rem;font-family:monospace;">(${p.sku})</span></td>
          <td>${p.stock_actual} u.</td>
          <td style="background:${hKey === '7d' ? '#eff6ff' : 'transparent'}; color:${p.sug_7d > 0 ? '#1d4ed8' : '#94a3b8'};">
            ${fmtCeldaCant(p, p.sug_7d)}
          </td>
          <td style="background:${hKey === '15d' ? '#f5f3ff' : 'transparent'}; color:${p.sug_15d > 0 ? '#6d28d9' : '#94a3b8'};">
            ${fmtCeldaCant(p, p.sug_15d)}
          </td>
          <td style="background:${hKey === '30d' ? '#fdf4ff' : 'transparent'}; color:${p.sug_30d > 0 ? '#7e22ce' : '#94a3b8'};">
            ${fmtCeldaCant(p, p.sug_30d)}
          </td>
        </tr>
      `;
    });

    let recetaHtml = '';
    const recetaItems = est.mirada_consciente?.receta_pesaje || [];
    if (recetaItems.length > 0) {
      const tituloReceta = est.mirada_consciente?.premix_nombre
        ? `Receta (${est.mirada_consciente.premix_nombre}):`
        : `Receta (10 kg):`;
      recetaHtml = `
        <div style="margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px solid #e2e8f0;">
          <div style="font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 4px;">${tituloReceta}</div>
          <div class="pizarra-receta-mini-grid">
            ${recetaItems.map(r => `
              <span class="pizarra-receta-chip">
                <strong>${r.componente_nombre}:</strong> ${r.etiqueta_peso || `${r.kilos_por_tanda_10kg} kg`}
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    const esCompletadaHoy = !!est.completada_hoy;
    return `
      <div class="pizarra-estacion-card ldn-${est.ldn}" style="${esCompletadaHoy ? 'background:#f0fdf4;border-color:#86efac;' : ''}">
        <div class="pizarra-estacion-header" onclick="window.toggleEstacionDeposito('${est.id}')">
          <div class="pizarra-estacion-main-info">
            <div class="pizarra-estacion-title-row">
              <span class="pizarra-estacion-titulo" style="${esCompletadaHoy ? 'color:#166534;' : ''}">${esCompletadaHoy ? '✅ ' : ''}${est.titulo}</span>
            </div>
            ${pasos.paso1 ? `<div class="pizarra-estacion-paso">${pasos.paso1}</div>` : ''}
            ${pasos.paso2 ? `<div class="pizarra-estacion-paso">${pasos.paso2}</div>` : ''}
          </div>
          <div class="pizarra-estacion-badges-right">
            ${esCompletadaHoy
              ? `<span class="pizarra-badge-stock-ok" style="font-size:0.76rem;padding:3px 8px;">✅ Producido hoy</span>`
              : `<span class="pizarra-badge-tiempo-estacion">⏱️ ~${met.tiempo_formateado}</span>`
            }
            <span class="pizarra-pill-consciente">
              ${pillText}
              <span id="chev-estacion-${est.id}" style="font-size:0.65rem;margin-left:3px;">${isExpanded ? '▲' : '▼'}</span>
            </span>
          </div>
        </div>

        <div id="drawer-estacion-${est.id}" class="pizarra-estacion-drawer ${isExpanded ? 'abierto' : ''}">
          ${recetaHtml}
          <table class="pizarra-consciente-table">
            <thead>
              <tr>
                <th>Artículo Búnker</th>
                <th>Stock</th>
                <th>Esta Semana</th>
                <th>15 Días</th>
                <th>Mes</th>
              </tr>
            </thead>
            <tbody>
              ${filasTabla}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  let listaActiva = est7d;
  let emptyBannerHtml = '';

  if (hActivo === '7d') {
    listaActiva = est7d;
    if (est7d.length === 0) {
      emptyBannerHtml = `
        <div class="pizarra-meta-finita-banner meta-victoria">
          <strong>✅ Trabajo de la semana terminado.</strong>
        </div>
      `;
    }
  } else if (hActivo === '15d') {
    listaActiva = est15d;
    if (est15d.length === 0) {
      emptyBannerHtml = `
        <div class="pizarra-meta-finita-banner meta-victoria">
          <strong>✅ Quincena al día.</strong>
        </div>
      `;
    }
  } else {
    listaActiva = est30d;
    if (est30d.length === 0) {
      emptyBannerHtml = `
        <div class="pizarra-meta-finita-banner meta-victoria">
          <strong>✅ Mes al día.</strong>
        </div>
      `;
    }
  }

  // Agrupación ordenada: 1° Línea de Negocio 2, 2° Línea de Negocio 3, 3° Líneas de Negocio 4, 5 y 6 juntas
  const gruposLdn = [
    {
      key: `${hActivo}-ldn2`,
      clase: 'grupo-ldn-2',
      titulo: 'Línea de Negocio 2',
      items: listaActiva.filter(e => e.ldn === 2)
    },
    {
      key: `${hActivo}-ldn3`,
      clase: 'grupo-ldn-3',
      titulo: 'Línea de Negocio 3',
      items: listaActiva.filter(e => e.ldn === 3)
    },
    {
      key: `${hActivo}-ldn456`,
      clase: 'grupo-ldn-456',
      titulo: 'Línea de Negocio 4, 5 y 6',
      items: listaActiva.filter(e => [4, 5, 6].includes(e.ldn))
    }
  ].filter(g => g.items.length > 0);

  const acordeonesLdnHtml = gruposLdn.map(g => {
    const abierto = window.pizarraAcordeonesLdnAbiertos.has(g.key);
    const pendientes = g.items.filter(e => !e.completada_hoy);
    const completadas = g.items.filter(e => e.completada_hoy);
    const minTot = pendientes.reduce((acc, e) => acc + (e.metricas_horizonte?.[hActivo]?.minutos || 0), 0);
    const txtPend = pendientes.length > 0
      ? `${pendientes.length} ${pendientes.length === 1 ? 'tarea' : 'tareas'} · ⏱️ ~${fmtMinGrupo(minTot)}`
      : `✅ Al día`;
    const txtComp = completadas.length > 0 ? ` · <span style="color:#15803d;font-weight:700;">✅ ${completadas.length} hoy</span>` : '';
    return `
      <div class="pizarra-ldn-acordeon ${g.clase}">
        <div class="pizarra-ldn-acordeon-header" onclick="window.toggleAcordeonGrupoLdn('${g.key}')">
          <div class="pizarra-ldn-acordeon-left">
            <span class="pizarra-acordeon-chevron ${abierto ? 'rotado' : ''}" id="chev-grupo-ldn-${g.key}">▶</span>
            <span class="pizarra-ldn-acordeon-titulo">${g.titulo}</span>
          </div>
          <div class="pizarra-ldn-acordeon-right">
            <span class="pizarra-badge-tiempo-estacion">${txtPend}${txtComp}</span>
          </div>
        </div>
        <div id="body-grupo-ldn-${g.key}" class="pizarra-ldn-acordeon-body ${abierto ? 'abierto' : ''}">
          ${g.items.map(est => renderTarjetaEstacion(est, hActivo)).join('')}
        </div>
      </div>
    `;
  }).join('');

  const ahoraLocal = new Date();
  const hoyLocalStr = `${ahoraLocal.getFullYear()}-${String(ahoraLocal.getMonth() + 1).padStart(2, '0')}-${String(ahoraLocal.getDate()).padStart(2, '0')}`;
  const infHoy = plan.informes_hoy || {};
  const esMismaFechaHoy = !infHoy.fecha_hoy || infHoy.fecha_hoy === hoyLocalStr;
  const mostrarPlanHoyPdf = typeof infHoy.plan_jornada_hoy_vigente === 'boolean'
    ? (esMismaFechaHoy && infHoy.plan_jornada_hoy_vigente)
    : true;
  const mostrarFundamentalsHoyPdf = typeof infHoy.fundamentals_hoy_vigente === 'boolean'
    ? (esMismaFechaHoy && infHoy.fundamentals_hoy_vigente)
    : mostrarPlanHoyPdf;
  const mostrarRetiroExternaPdf = typeof infHoy.retiro_externa_hoy_vigente === 'boolean'
    ? (esMismaFechaHoy && infHoy.retiro_externa_hoy_vigente)
    : true;
  const mostrarFundamentalsExternaPdf = typeof infHoy.fundamentals_externa_hoy_vigente === 'boolean'
    ? (esMismaFechaHoy && infHoy.fundamentals_externa_hoy_vigente)
    : mostrarRetiroExternaPdf;
  const mostrarPlan3JornadasPdf = typeof infHoy.plan_3_jornadas_vigente === 'boolean'
    ? infHoy.plan_3_jornadas_vigente
    : true;
  const mostrarFundamentals3JornadasPdf = typeof infHoy.fundamentals_3_jornadas_vigente === 'boolean'
    ? infHoy.fundamentals_3_jornadas_vigente
    : mostrarPlan3JornadasPdf;
  const vCache = hoyLocalStr.replace(/-/g, '');

  return `
    <div class="pizarra-plan-deposito-wrap" id="pizarra-plan-deposito-widget">
      <div class="pizarra-plan-deposito-header" onclick="window.toggleAcordeonPlanDeposito()">
        <div class="pizarra-plan-deposito-title-group">
          <span class="pizarra-acordeon-chevron ${isOpen ? 'rotado' : ''}" id="pizarra-plan-deposito-chevron">▶</span>
          <span class="pizarra-plan-deposito-title">📋 Tareas de Producción en Depósito</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;" onclick="event.stopPropagation();">
          ${mostrarPlanHoyPdf ? `
          <span class="pizarra-pdf-pair">
            <a href="${infHoy.url_plan_jornada_hoy || `/documentos/Plan_Jornada_Hoy_Deposito.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-pdf-hoy" title="Abrir hoja operativa en PDF de la Jornada de Hoy (Vence hoy)">
              📄 Plan de Hoy (PDF)
            </a>
            ${mostrarFundamentalsHoyPdf ? `
            <a href="${infHoy.url_fundamentals_hoy || `/documentos/Fundamentals_Jornada_Hoy_Deposito.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-clip-anexo clip-hoy" title="Anexo de Fundamentals y Auditoría Empírica — Plan de Hoy (PDF)">
              📎
            </a>` : ''}
          </span>` : ''}
          ${mostrarRetiroExternaPdf ? `
          <span class="pizarra-pdf-pair">
            <a href="${infHoy.url_retiro_externa_hoy || `/documentos/Plan_Retiro_Produccion_Externa_Hoy.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-pdf-externa" title="Abrir informe de Retiro para Producción Externa de Hoy (Vence hoy)">
              🚚 Retiro Externa (PDF)
            </a>
            ${mostrarFundamentalsExternaPdf ? `
            <a href="${infHoy.url_fundamentals_externa_hoy || `/documentos/Fundamentals_Retiro_Produccion_Externa_Hoy.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-clip-anexo clip-externa" title="Anexo de Fundamentals y Auditoría Empírica — Retiro Producción Externa (PDF)">
              📎
            </a>` : ''}
          </span>` : ''}
          ${mostrarPlan3JornadasPdf ? `
          <span class="pizarra-pdf-pair">
            <a href="${infHoy.url_plan_3_jornadas || `/documentos/Plan_Semanal_3_Jornadas_Deposito.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-pdf-semanal" title="Abrir Plan Operativo de 3 Jornadas para la Semana">
              📅 Plan 3 Jornadas (PDF)
            </a>
            ${mostrarFundamentals3JornadasPdf ? `
            <a href="${infHoy.url_fundamentals_3_jornadas || `/documentos/Fundamentals_Semanal_3_Jornadas_Deposito.pdf?v=${vCache}`}" target="_blank" rel="noopener" class="pizarra-btn-clip-anexo clip-semanal" title="Anexo de Fundamentals y Auditoría Empírica — Plan Semanal 3 Jornadas (PDF)">
              📎
            </a>` : ''}
          </span>` : ''}
          ${rh.semana_7d.estaciones_count === 0
            ? `<span class="pizarra-badge-stock-ok" style="font-size:0.78rem;padding:3px 9px;">✅ Semana al día</span>`
            : `<span class="pizarra-badge-tiempo-estacion">${rh.semana_7d.estaciones_count} tareas · ⏱️ ~${rh.semana_7d.tiempo_formateado}</span>`
          }
        </div>
      </div>

      <div id="pizarra-plan-deposito-body" class="pizarra-plan-deposito-body ${isOpen ? 'abierto' : ''}">
        <div class="pizarra-horizontes-tabs">
          <div class="pizarra-horizonte-tab ${hActivo === '7d' ? 'active-7d' : ''} ${rh.semana_7d.estaciones_count === 0 ? 'cubierto' : ''}" onclick="window.cambiarHorizonteDepositoPizarra('7d')">
            <div class="pizarra-horizonte-tab-top">
              <span>Esta Semana</span>
              <span style="color:${rh.semana_7d.estaciones_count === 0 ? '#15803d' : '#1d4ed8'};">
                ${rh.semana_7d.estaciones_count === 0 ? '✅ Al día' : `${rh.semana_7d.estaciones_count} tareas · ~${rh.semana_7d.tiempo_formateado}`}
              </span>
            </div>
          </div>

          <div class="pizarra-horizonte-tab ${hActivo === '15d' ? 'active-15d' : ''}" onclick="window.cambiarHorizonteDepositoPizarra('15d')">
            <div class="pizarra-horizonte-tab-top">
              <span>15 Días</span>
              <span style="color:#6d28d9;">
                ${rh.quincena_15d.estaciones_nuevas_count === 0 ? '✅ Al día' : `+${rh.quincena_15d.estaciones_nuevas_count} tareas · ~${rh.quincena_15d.tiempo_formateado}`}
              </span>
            </div>
          </div>

          <div class="pizarra-horizonte-tab ${hActivo === '30d' ? 'active-30d' : ''}" onclick="window.cambiarHorizonteDepositoPizarra('30d')">
            <div class="pizarra-horizonte-tab-top">
              <span>Mes</span>
              <span style="color:#7e22ce;">
                ${rh.mes_30d.estaciones_nuevas_count === 0 ? '✅ Al día' : `+${rh.mes_30d.estaciones_nuevas_count} tareas · ~${rh.mes_30d.tiempo_formateado}`}
              </span>
            </div>
          </div>
        </div>

        ${emptyBannerHtml}

        <div class="pizarra-estaciones-lista">
          ${acordeonesLdnHtml}
        </div>
      </div>
    </div>
  `;
};

/**
 * Consulta las alertas activas en segundo plano e inyecta la información en #pizarra-extra-widgets
 */
async function actualizarAlertasPizarra() {
  const container = document.getElementById('pizarra-extra-widgets');
  const btnLimpiar = document.getElementById('btn-limpiar-pizarra');
  if (!container) return;

  // Migración / saneamiento: limpiar claves viejas con tareas o estados residuales
  ['pizarra_tasks', 'pizarra_tasks_v2', 'pizarra_tasks_v3'].forEach(k => {
    if (localStorage.getItem(k)) localStorage.removeItem(k);
  });

  // Saneamiento proactivo de pizarra_tasks_v4 (eliminación de duplicados acumulados)
  try {
    const rawV4 = localStorage.getItem('pizarra_tasks_v4');
    if (rawV4) {
      const parsedV4 = JSON.parse(rawV4);
      if (Array.isArray(parsedV4)) {
        const seenMap = new Map();
        parsedV4.forEach(t => {
          if (t && t.id && !seenMap.has(t.id)) seenMap.set(t.id, t);
        });
        localStorage.setItem('pizarra_tasks_v4', JSON.stringify(Array.from(seenMap.values())));
      }
    }
  } catch (errV4) {}

  try {
    // 1. Consultar resumen_faltantes_parciales del módulo Producción
    const resProd = await fetch('/api/pizarra/resumen_faltantes_parciales');
    const dataProd = await resProd.json();
    const rawActiveProd = dataProd.success && Array.isArray(dataProd.data) ? dataProd.data : [];

    // 2. Consultar tratamientos activos (carpas) del módulo Mantenimiento
    const resCarpas = await fetch('/api/pizarra/mantenimiento_carpas');
    const dataCarpas = await resCarpas.json();
    const activeCarpas = dataCarpas.success && Array.isArray(dataCarpas.data) ? dataCarpas.data : [];

    // 3. Consultar datos operativos con tolerancia a fallos multi-canal
    let pedidosActivos = [];
    let pedidosArmados12h = [];
    let produccionRealizada12h = [];
    let comprasEnEspera = [];
    let demandaSatisfecha = [];
    let presupuestosEntregadosSinFacturar = [];
    let presupuestosFacturados12h = [];
    let seguimientosCrmResumen = { hoy: [], proximos: [] };
    let alertasWaEntrantes = { alertas: [], contadores: {} };
    if (typeof window.consultarAlertasWhatsappCrm === 'function') {
      try { alertasWaEntrantes = await window.consultarAlertasWhatsappCrm(); } catch (errWa) { console.warn('Error alertas WA:', errWa); }
    }
    let retirosMamusRecientes = [];
    let planTrabajoDeposito = window.planTrabajoDepositoCache || null;

    // 2.b Consultar seguimientos comerciales WhatsApp (CRM)
    if (typeof window.consultarSeguimientosResumen === 'function') {
      try {
        seguimientosCrmResumen = await window.consultarSeguimientosResumen();
      } catch (errCrm) {
        console.warn('Error consultando seguimientos CRM:', errCrm);
      }
    }

    // 2.c Consultar retiros recientes de Mamus (últimas 3 horas)
    try {
      const resMamus = await fetch('/api/produccion/ingredientes/retiros-mamus');
      if (resMamus.ok) {
        const dataMamus = await resMamus.json();
        if (dataMamus && Array.isArray(dataMamus.retiros)) {
          retirosMamusRecientes = dataMamus.retiros;
        }
      }
    } catch (errMamus) {
      console.warn('Error consultando retiros de Mamus para pizarra:', errMamus);
    }

    // Canal 1: Endpoint unificado de Pizarra (puerto 3000, relativo, cero CORS)
    try {
      const resPiz = await fetch('/api/pizarra/resumen_operativo');
      if (resPiz.ok) {
        const dataPiz = await resPiz.json();
        if (dataPiz.success) {
          pedidosActivos = dataPiz.pedidos_activos || [];
          pedidosArmados12h = dataPiz.pedidos_armados_12h || [];
          produccionRealizada12h = dataPiz.produccion_realizada_12h || [];
          comprasEnEspera = dataPiz.compras_en_espera || [];
          demandaSatisfecha = dataPiz.demanda_satisfecha || [];
          presupuestosEntregadosSinFacturar = dataPiz.presupuestos_entregados_sin_facturar || [];
          presupuestosFacturados12h = dataPiz.presupuestos_facturados_12h || [];
          if (dataPiz.plan_trabajo_deposito && dataPiz.plan_trabajo_deposito.estaciones_semana_7d?.[0]?.pasos_horizonte) {
            if (!window.planTrabajoDepositoCache || dataPiz.plan_trabajo_deposito.informes_hoy) {
              planTrabajoDeposito = dataPiz.plan_trabajo_deposito;
              window.planTrabajoDepositoCache = planTrabajoDeposito;
            }
          }
          window.demandaSatisfechaCache = demandaSatisfecha;
        }
      }
    } catch (e1) {
      console.warn('Canal 1 /pizarra/resumen_operativo no disponible:', e1);
    }

    const nowCacheMs = Date.now();
    if (!planTrabajoDeposito || !window.planTrabajoDepositoCacheTs || (nowCacheMs - window.planTrabajoDepositoCacheTs) > 25000) {
      try {
        const resPlanDep = await fetch('/api/produccion/informe/planificacion-lunes?modo=plan_deposito_pizarra');
        if (resPlanDep.ok) {
          const dataPlanDep = await resPlanDep.json();
          if (dataPlanDep && dataPlanDep.success) {
            planTrabajoDeposito = dataPlanDep;
            window.planTrabajoDepositoCache = planTrabajoDeposito;
            window.planTrabajoDepositoCacheTs = nowCacheMs;
          }
        } else if (typeof window.construirPlanDepositoFallbackLive === 'function') {
          const fallbackPlan = await window.construirPlanDepositoFallbackLive(produccionRealizada12h, pedidosActivos);
          if (fallbackPlan) {
            planTrabajoDeposito = fallbackPlan;
            window.planTrabajoDepositoCache = planTrabajoDeposito;
            window.planTrabajoDepositoCacheTs = nowCacheMs;
          }
        }
      } catch (ePlan) {}
    }

    // Fallback para producción realizada: Consultar carros finalizados en las últimas 12 horas si Canal 1 no los trajo directamente
    if (produccionRealizada12h.length === 0) {
      try {
        const resCarros = await fetch('/api/produccion/usuario/7/carros');
        if (resCarros.ok) {
          const carros = await resCarros.json();
          const limite12hMs = 12 * 60 * 60 * 1000;
          const ahoraMs = Date.now();
          const recientes = (carros || []).filter(c => {
            if (!c.fecha_confirmacion) return false;
            return (ahoraMs - new Date(c.fecha_confirmacion).getTime()) < limite12hMs;
          });
          for (const c of recientes.slice(0, 5)) {
            try {
              const resArts = await fetch(`/api/produccion/carro/${c.id}/articulos?usuarioId=7`);
              if (resArts.ok) {
                const arts = await resArts.json();
                (arts || []).forEach(a => {
                  produccionRealizada12h.push({
                    id: `${c.id}-${a.numero || a.codigo_barras}`,
                    carro_id: c.id,
                    articulo_numero: a.numero || a.codigo_barras,
                    descripcion: a.descripcion,
                    cantidad: a.cantidad,
                    fecha_confirmacion: c.fecha_confirmacion
                  });
                });
              }
            } catch (eArts) {}
          }
        }
      } catch (eCarros) {}
    }

    // Canal 2 (Fallback para compras si Canal 1 no devolvió compras):
    if (comprasEnEspera.length === 0) {
      try {
        const resEsp = await fetch('/api/pizarra/compras_pendientes');
        if (resEsp.ok) {
          const dataEsp = await resEsp.json();
          if (dataEsp.success && Array.isArray(dataEsp.data)) {
            comprasEnEspera = dataEsp.data;
          }
        }
      } catch (e2) {
        console.warn('Canal 2 /pizarra/compras_pendientes no disponible:', e2);
      }
    }

    // Canal 3 (Fallback directo a producción puerto 3002 si faltan pedidos):
    if (pedidosActivos.length === 0 && pedidosArmados12h.length === 0) {
      try {
        const resProdAgrup = await fetch('http://localhost:3002/api/produccion/compras/pendientes-agrupados');
        if (resProdAgrup.ok) {
          const dataProdAgrup = await resProdAgrup.json();
          if (dataProdAgrup.pizarra_resumen) {
            if (pedidosActivos.length === 0) pedidosActivos = dataProdAgrup.pizarra_resumen.pedidos_activos || [];
            if (pedidosArmados12h.length === 0) pedidosArmados12h = dataProdAgrup.pizarra_resumen.pedidos_armados_12h || [];
            if (comprasEnEspera.length === 0) comprasEnEspera = dataProdAgrup.pizarra_resumen.compras_en_espera || [];
          }
        }
      } catch (e3) {
        console.warn('Canal 3 producción puerto 3002 no disponible:', e3);
      }
    }

    // 4. Cargar tareas almacenadas en localStorage para persistencia (v4)
    let storedTasks = [];
    try {
      const stored = localStorage.getItem('pizarra_tasks_v4');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const dedupeMap = new Map();
          parsed.forEach(t => {
            if (t && t.id && !dedupeMap.has(t.id)) dedupeMap.set(t.id, t);
          });
          storedTasks = Array.from(dedupeMap.values());
        }
      }
    } catch (e) {
      console.warn('Error al leer pizarra_tasks_v4 desde localStorage:', e);
    }

    let dismissedIds = new Set();
    try {
      const dis = localStorage.getItem('pizarra_dismissed_v4');
      if (dis) dismissedIds = new Set(JSON.parse(dis));
    } catch (e) {}

    // 5. Vía A: Evaporación Automática a las 12 horas y Purga de Desestimados
    const limite12h = 12 * 60 * 60 * 1000;
    const ahora = Date.now();
    storedTasks = storedTasks.filter(t => {
      if (!t || !t.id) return false;
      if (dismissedIds.has(t.id)) return false;
      if (!t.completed) return true;
      return (ahora - t.completedAt) < limite12h;
    });

    // Mapeo defensivo de packs (GS5X500G -> GSX500G x5, GDF5X500G -> GDFX500G x5) y normalización flotante IEEE 754
    const packToChild = {
      'GS5X500G': { child: 'GSX500G', units: 5 },
      'GDF5X500G': { child: 'GDFX500G', units: 5 }
    };
    const prods12hMap = new Map();
    produccionRealizada12h.forEach(pr => {
      const cod = String(pr.articulo_numero).trim().toUpperCase();
      prods12hMap.set(cod, (prods12hMap.get(cod) || 0) + (parseFloat(pr.cantidad) || 0));
    });

    pedidosActivos.forEach(p => {
      (p.articulos || []).forEach(a => {
        const artUpper = String(a.articulo).trim().toUpperCase();
        if (packToChild[artUpper]) {
          const pInfo = packToChild[artUpper];
          const childProd = prods12hMap.get(pInfo.child) || 0;
          if (childProd >= (parseFloat(a.cantidad) || 1) * pInfo.units) {
            a.faltante = 0;
            a.estado_stock = 'COMPLETO';
          }
        }
        const falt = parseFloat(a.faltante) || 0;
        if (falt <= 0.005) {
          a.faltante = 0;
          if (a.estado_stock === 'FALTANTE') a.estado_stock = 'COMPLETO';
        }
      });
    });

    // 6. Preparar mapa de tareas del ciclo actual
    const updatedTasks = [];

    // --- PROCESAR PEDIDOS PARA ARMAR ---
    // A) Pedidos activos para armar (excluyendo derivados a compras)
    pedidosActivos.forEach(p => {
      const taskId = `pedido-activo-${p.id}`;
      const nombreCliente = (p.cliente_nombre || `Cliente ${p.id_cliente}`).trim();
      const taskText = `1 pedido para armar — ${nombreCliente} (${p.origen})`;
      
      if (!updatedTasks.some(u => u.id === taskId)) {
        updatedTasks.push({
          id: taskId,
          type: 'pedido',
          text: taskText,
          completed: false,
          completedAt: null
        });
      }
    });

    // B) Pedidos armados reales en las últimas 12 horas (filtrando secuencias de armado)
    pedidosArmados12h.filter(p => p.secuencia === 'Pedido_Listo' || p.secuencia === 'Retira_Deposito').forEach(p => {
      const taskId = `pedido-armado-${p.id}`;
      if (dismissedIds.has(taskId)) return;
      const nombreCliente = (p.cliente_nombre || `Cliente ${p.id_cliente}`).trim();
      const taskText = `Pedido armado — ${nombreCliente} (Cliente ${p.id_cliente})`;
      const fechaAct = p.fecha_actualizacion ? new Date(p.fecha_actualizacion).getTime() : ahora;

      if ((ahora - fechaAct) < limite12h) {
        if (!updatedTasks.some(u => u.id === taskId)) {
          updatedTasks.push({
            id: taskId,
            type: 'pedido',
            text: taskText,
            completed: true,
            completedAt: fechaAct
          });
        }
      }
    });

    // C) Artículos producidos en taller en las últimas 12 horas (con tilde verde)
    produccionRealizada12h.forEach(item => {
      const taskId = `carro-prod-${item.id}`;
      if (dismissedIds.has(taskId)) return;
      const cant = Math.round(parseFloat(item.cantidad) || 0);
      const descLimpia = limpiarDescripcionArticulo(item.descripcion);
      const taskText = `${cant} ${cant === 1 ? 'unidad producida' : 'unidades producidas'} — ${descLimpia} (Carro #${item.carro_id})`;
      const fechaAct = item.fecha_confirmacion ? new Date(item.fecha_confirmacion).getTime() : ahora;

      if ((ahora - fechaAct) < limite12h) {
        if (!updatedTasks.some(u => u.id === taskId)) {
          updatedTasks.push({
            id: taskId,
            type: 'produccion',
            text: taskText,
            completed: true,
            completedAt: fechaAct
          });
        }
      }
    });

    // --- PROCESAR COMPRAS PENDIENTES (EN ESPERA) ---
    // A) Activos en espera
    comprasEnEspera.forEach(item => {
      const taskId = `espera-${item.articulo_numero}`;
      const cant = Math.round(item.cantidad_faltante);
      const descLimpia = limpiarDescripcionArticulo(item.descripcion);
      const taskText = `${cant} unidad — ${descLimpia} (en espera)`;

      if (!updatedTasks.some(u => u.id === taskId)) {
        updatedTasks.push({
          id: taskId,
          type: 'espera',
          text: taskText,
          completed: false,
          completedAt: null
        });
      }
    });

    // B) Detectar si alguna tarea en espera se completó (resuelto en compras)
    storedTasks.forEach(st => {
      if (st.type === 'espera') {
        const stillInEspera = comprasEnEspera.some(item => `espera-${item.articulo_numero}` === st.id);
        if (!stillInEspera && !dismissedIds.has(st.id)) {
          if (!st.completed) {
            const cleanText = st.text.replace(/\s*\(en espera\)/gi, '');
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push({
                id: st.id,
                type: 'espera',
                text: cleanText,
                completed: true,
                completedAt: ahora
              });
            }
          } else {
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push(st);
            }
          }
        }
      }
    });

    // --- PROCESAR PRODUCCIÓN (FALTANTES DE ELABORACIÓN) ---
    // Filtrar: Omitir kits residuales y artículos derivados a compras
    const faltantesElaboracion = rawActiveProd.filter(item => {
      if (/^(135|136)$/.test(item.articulo_numero)) return false;
      if (comprasEnEspera.some(e => e.articulo_numero === item.articulo_numero)) return false;
      return true;
    });

    faltantesElaboracion.forEach(item => {
      const taskId = `prod-${item.articulo_numero}`;
      const cant = Math.round(item.faltante);
      const descLimpia = limpiarDescripcionArticulo(item.descripcion);
      const taskText = `${cant} unidad — ${descLimpia}`;
      
      if (!updatedTasks.some(u => u.id === taskId)) {
        updatedTasks.push({
          id: taskId,
          type: 'produccion',
          text: taskText,
          completed: false,
          completedAt: null
        });
      }
    });

    // Conservar tareas de producción completadas válidas (sin inferencia negativa de cancelados)
    storedTasks.forEach(st => {
      if (st.type === 'produccion') {
        // Los carros producidos en taller se leen directamente de produccionRealizada12h
        if (st.id && st.id.startsWith('carro-prod-')) return;
        if (comprasEnEspera.some(e => `prod-${e.articulo_numero}` === st.id)) return;
        if (dismissedIds.has(st.id)) return;
        if (st.completed) {
          if (!updatedTasks.some(u => u.id === st.id)) {
            updatedTasks.push(st);
          }
        }
      }
    });

    // --- PROCESAR MANTENIMIENTO (CARPAS) ---
    activeCarpas.forEach(carpa => {
      const taskId = `carpa-${carpa.id}`;
      const carpaFecha = new Date(carpa.fecha_inicio_cuarentena);
      const diffMs = ahora - carpaFecha;
      const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const kilos = Math.round(carpa.kilos_brutos_totales);
      const descLimpia = limpiarDescripcionArticulo(carpa.item_nombre);
      const taskText = `1 carpa activa (hace ${dias} días): ${kilos} kg de ${descLimpia}`;

      if (!updatedTasks.some(u => u.id === taskId)) {
        updatedTasks.push({
          id: taskId,
          type: 'mantenimiento',
          text: taskText,
          completed: false,
          completedAt: null
        });
      }
    });

    // Detectar si alguna carpa se completó
    storedTasks.forEach(st => {
      if (st.type === 'mantenimiento') {
        const stillActive = activeCarpas.some(carpa => `carpa-${carpa.id}` === st.id);
        if (!stillActive && !dismissedIds.has(st.id)) {
          if (!st.completed) {
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push({
                ...st,
                completed: true,
                completedAt: ahora
              });
            }
          } else {
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push(st);
            }
          }
        }
      }
    });

    // --- PROCESAR PRESUPUESTOS ENTREGADOS SIN FACTURAR ---
    // A) Activos entregados sin facturar
    presupuestosEntregadosSinFacturar.forEach(p => {
      const taskId = `entrega-sin-facturar-${p.id}`;
      if (dismissedIds.has(taskId)) return;

      const nombreCliente = (p.cliente_nombre || `Cliente ${p.id_cliente}`).trim();
      const totalNum = parseFloat(p.total) || 0;
      const totalStr = totalNum > 0 ? ` — $${totalNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
      const rutaStr = p.id_ruta ? ` (Ruta #${p.id_ruta})` : '';
      const taskText = `Presupuesto #${p.id} — ${nombreCliente}${totalStr}${rutaStr}`;

      if (!updatedTasks.some(u => u.id === taskId)) {
        updatedTasks.push({
          id: taskId,
          type: 'entrega_sin_facturar',
          text: taskText,
          completed: false,
          completedAt: null,
          presupuestoId: p.id,
          clienteNombre: nombreCliente,
          clienteId: p.id_cliente,
          total: totalNum
        });
      }
    });

    // B) Facturados en las últimas 12 horas
    presupuestosFacturados12h.forEach(p => {
      const taskId = `entrega-sin-facturar-${p.id}`;
      if (dismissedIds.has(taskId)) return;

      const nombreCliente = (p.cliente_nombre || `Cliente ${p.id_cliente}`).trim();
      let tipoComprobante = 'Factura';
      if (p.tipo_cbte === 1) tipoComprobante = 'Factura A';
      else if (p.tipo_cbte === 6) tipoComprobante = 'Factura B';
      else if (p.serie_interna) tipoComprobante = `Comprobante ${p.serie_interna}`;

      const nroCbte = p.cbte_nro ? `#${p.cbte_nro}` : (p.nro_interno ? `#${p.nro_interno}` : '');
      const impTotal = parseFloat(p.imp_total) || 0;
      const totalStr = impTotal > 0 ? ` — $${impTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
      const taskText = `Presupuesto #${p.id} facturado — ${nombreCliente} (${tipoComprobante} ${nroCbte}${totalStr})`;
      const fechaFact = p.emitida_en ? new Date(p.emitida_en).getTime() : ahora;

      if ((ahora - fechaFact) < limite12h) {
        if (!updatedTasks.some(u => u.id === taskId)) {
          updatedTasks.push({
            id: taskId,
            type: 'entrega_sin_facturar',
            text: taskText,
            completed: true,
            completedAt: fechaFact,
            presupuestoId: p.id,
            clienteNombre: nombreCliente
          });
        }
      }
    });

    // C) Detectar si una tarea activa almacenada previamente pasó a estar facturada
    storedTasks.forEach(st => {
      if (st.type === 'entrega_sin_facturar') {
        if (dismissedIds.has(st.id)) return;
        if (st.completed) {
          if ((ahora - st.completedAt) < limite12h) {
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push(st);
            }
          }
        } else {
          // Si estaba activa y ya no viene en presupuestosEntregadosSinFacturar, se facturó
          const stillSinFacturar = presupuestosEntregadosSinFacturar.some(p => `entrega-sin-facturar-${p.id}` === st.id);
          if (!stillSinFacturar) {
            const cleanText = st.text.replace(/^Presupuesto\s+#/, 'Presupuesto #').replace(/\s*—\s*/, ' facturado — ');
            if (!updatedTasks.some(u => u.id === st.id)) {
              updatedTasks.push({
                ...st,
                text: cleanText.includes('facturado') ? cleanText : `Presupuesto #${st.presupuestoId || ''} facturado — ${st.clienteNombre || ''}`,
                completed: true,
                completedAt: ahora
              });
            }
          }
        }
      }
    });

    // --- PROCESAR RETIROS RECIENTES DE MAMUS (visibles por 3 horas en Pizarra Principal) ---
    const limite3hMamus = 3 * 60 * 60 * 1000;
    retirosMamusRecientes.forEach(r => {
      const taskId = `retiro-mamus-${r.id}`;
      if (dismissedIds.has(taskId)) return;
      const fechaMs = r.fecha ? new Date(r.fecha).getTime() : ahora;
      if ((ahora - fechaMs) < limite3hMamus) {
        const kilosNum = parseFloat(r.kilos_retirados || 0);
        const cantTxt = kilosNum < 1
          ? `${Math.round(kilosNum * 1000)} g`
          : `${Number(kilosNum.toFixed(3)).toString().replace('.', ',')} kg (${Math.round(kilosNum * 1000)} g)`;
        const horaTxt = new Date(fechaMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const taskText = `${cantTxt} de ${r.ingrediente_nombre || 'Ingrediente'} (${horaTxt} hs)`;

        if (!updatedTasks.some(u => u.id === taskId)) {
          updatedTasks.push({
            id: taskId,
            type: 'retiro_mamus',
            text: taskText,
            completed: true,
            completedAt: fechaMs
          });
        }
      }
    });

    // 7. Desduplicación estricta y blindada por taskId antes de persistir y clasificar
    const tasksMap = new Map();
    updatedTasks.forEach(t => {
      if (t && t.id && !tasksMap.has(t.id)) {
        tasksMap.set(t.id, t);
      }
    });
    const finalTasks = Array.from(tasksMap.values());

    // Guardar tareas en localStorage (v4)
    localStorage.setItem('pizarra_tasks_v4', JSON.stringify(finalTasks));

    // 8. Separar tareas activas y completadas para el renderizado
    const activeProdGroup = finalTasks.filter(t => !t.completed && (t.type === 'produccion' || t.type === 'pedido'));
    const completedProdGroup = finalTasks.filter(t => t.completed && (t.type === 'produccion' || t.type === 'pedido'));

    const activeEsperaTasks = finalTasks.filter(t => !t.completed && t.type === 'espera');
    const completedEsperaTasks = finalTasks.filter(t => t.completed && t.type === 'espera');

    const activeMantenimiento = finalTasks.filter(t => !t.completed && t.type === 'mantenimiento');
    const completedMantenimiento = finalTasks.filter(t => t.completed && t.type === 'mantenimiento');

    const activeEntregasSinFacturar = finalTasks.filter(t => !t.completed && t.type === 'entrega_sin_facturar');
    const completedEntregasSinFacturar = finalTasks.filter(t => t.completed && t.type === 'entrega_sin_facturar');
    const totalEntregasSinFacturarCount = activeEntregasSinFacturar.length + completedEntregasSinFacturar.length;

    const completedMamusTasks = finalTasks.filter(t => t.type === 'retiro_mamus' && (ahora - (t.completedAt || 0)) < limite3hMamus);
    const totalMamusCount = completedMamusTasks.length;

    const totalDemandaCount = demandaSatisfecha.length;
    const totalProdCount = pedidosActivos.length + faltantesElaboracion.length + completedProdGroup.length;
    const totalEsperaCount = activeEsperaTasks.length + completedEsperaTasks.length;
    const totalMantenimientoCount = activeMantenimiento.length + completedMantenimiento.length;
    // En la Pizarra solo se muestran tareas de WhatsApp que requieren acción inmediata HOY
    const totalCrmCount = (seguimientosCrmResumen.hoy || []).length;
    const totalWaEntrantesCount = (alertasWaEntrantes && Array.isArray(alertasWaEntrantes.alertas)) ? alertasWaEntrantes.alertas.length : 0;

    // Condición de Pantalla Limpia de Alertas
    if (totalProdCount === 0 && totalEsperaCount === 0 && totalMantenimientoCount === 0 && totalDemandaCount === 0 && totalCrmCount === 0 && totalWaEntrantesCount === 0 && totalEntregasSinFacturarCount === 0 && totalMamusCount === 0 && !planTrabajoDeposito) {
      container.innerHTML = '';
      actualizarBotonLimpiarPizarra();
      return;
    }

    // Actualizar visibilidad de botón Limpiar Realizados
    actualizarBotonLimpiarPizarra();

    // 9. Construir y Renderizar HTML
    let html = '';

    // Renderizar sección de Retiros de Mamus (visibles durante 3 horas para confirmación visual en Pizarra Principal)
    if (totalMamusCount > 0) {
      html += `
        <div style="background: #fdf2f8; border: 2px solid #f472b6; border-radius: 12px; padding: 10px 14px; margin-bottom: 10px;">
          <div class="pizarra-alert-title" style="color: #be185d; margin-top: 0; margin-bottom: 6px; font-size: 1.05rem;">
            🌸 Retiros de Mamus (confirmados):
          </div>
      `;
      completedMamusTasks.forEach(t => {
        html += `<div class="pizarra-alert-item completed" style="font-size: 1.02rem; font-weight: 700; color: #15803d; padding: 3px 0;">✅ ${t.text}</div>`;
      });
      html += `</div>`;
    }

    // Renderizar sección de Mensajes Entrantes de Clientes por WhatsApp (CRM Bidireccional con Auto-Apagado)
    if (totalWaEntrantesCount > 0 && typeof window.construirHtmlAlertasWhatsappPizarra === 'function') {
      html += window.construirHtmlAlertasWhatsappPizarra(alertasWaEntrantes);
    }

    // Renderizar sección de Seguimientos Comerciales WhatsApp (CRM)
    if (totalCrmCount > 0 && typeof window.construirHtmlSeguimientosPizarra === 'function') {
      html += window.construirHtmlSeguimientosPizarra(seguimientosCrmResumen);
    }

    // Renderizar sección de Producción (pedidos activos destacados + unidades a producir plegadas)
    if (totalProdCount > 0) {
      html += `<div class="pizarra-alert-title">Producción:</div>`;

      // Recorrer pedidos activos y asociar sus faltantes de elaboración
      pedidosActivos.forEach(p => {
        const pIdStr = String(p.id);
        const nombreCliente = (p.cliente_nombre || `Cliente ${p.id_cliente}`).trim();
        const taskText = `1 pedido para armar — ${nombreCliente} (${p.origen})`;

        // Artículos propios del pedido con cálculo unificado de stock y disputa
        const arts = Array.isArray(p.articulos) ? p.articulos : [];
        const itemsFaltantes = arts.filter(a => (parseFloat(a.faltante) || 0) > 0.005);
        const itemsDisputa = arts.filter(a => a.en_disputa && (parseFloat(a.faltante) || 0) <= 0.005);

        if (itemsFaltantes.length > 0) {
          const totalUds = itemsFaltantes.reduce((acc, it) => acc + Math.round(parseFloat(it.faltante) || 0), 0);
          const isExpanded = window.pizarraPedidosExpandidos.has(pIdStr);

          html += `
            <div class="pizarra-pedido-bloque">
              <div class="pizarra-pedido-header" onclick="window.togglePedidoFaltantes('${pIdStr}')" title="Click para ver qué producir">
                <span class="pizarra-pedido-bullet">•</span>
                <span class="pizarra-pedido-texto">${taskText}</span>
                <span id="badge-prod-${pIdStr}" class="pizarra-badge-prod ${isExpanded ? 'is-open' : ''}">
                  ⚠️ ${totalUds} ${totalUds === 1 ? 'unidad' : 'unidades'} a producir
                  <span class="pizarra-chevron">▼</span>
                </span>
              </div>
              <div id="subitems-pedido-${pIdStr}" class="pizarra-subitems-container ${isExpanded ? 'is-open' : ''}">
          `;

          itemsFaltantes.forEach(it => {
            const cant = Math.round(parseFloat(it.faltante) || 0);
            const desc = limpiarDescripcionArticulo(it.descripcion);
            html += `
              <div class="pizarra-subitem-prod">
                <span class="pizarra-subitem-icon">↳</span>
                <span class="pizarra-subitem-cant">${cant} ${cant === 1 ? 'unidad' : 'unidades'}</span>
                <span class="pizarra-subitem-desc">— ${desc}</span>
              </div>
            `;
          });

          itemsDisputa.forEach(it => {
            const cant = Math.round(parseFloat(it.cantidad) || 0);
            const desc = limpiarDescripcionArticulo(it.descripcion);
            html += `
              <div class="pizarra-subitem-prod" style="color: #c2410c;">
                <span class="pizarra-subitem-icon" style="color: #ea580c;">⚠️</span>
                <span class="pizarra-subitem-cant">${cant} ${cant === 1 ? 'unidad' : 'unidades'}</span>
                <span class="pizarra-subitem-desc">— ${desc} (Stock comprometido por otros pedidos)</span>
              </div>
            `;
          });

          html += `
              </div>
            </div>
          `;
        } else if (itemsDisputa.length > 0) {
          // Pedido sin faltante propio, pero con stock en disputa / comprometido por otros pedidos
          const isExpanded = window.pizarraPedidosExpandidos.has(pIdStr);

          html += `
            <div class="pizarra-pedido-bloque">
              <div class="pizarra-pedido-header" onclick="window.togglePedidoFaltantes('${pIdStr}')" title="Click para ver stock comprometido">
                <span class="pizarra-pedido-bullet">•</span>
                <span class="pizarra-pedido-texto">${taskText}</span>
                <span id="badge-prod-${pIdStr}" class="pizarra-badge-disputa ${isExpanded ? 'is-open' : ''}">
                  ⚠️ Stock comprometido
                  <span class="pizarra-chevron">▼</span>
                </span>
              </div>
              <div id="subitems-pedido-${pIdStr}" class="pizarra-subitems-container ${isExpanded ? 'is-open' : ''}">
          `;

          itemsDisputa.forEach(it => {
            const cant = Math.round(parseFloat(it.cantidad) || 0);
            const desc = limpiarDescripcionArticulo(it.descripcion);
            html += `
              <div class="pizarra-subitem-prod" style="color: #c2410c;">
                <span class="pizarra-subitem-icon" style="color: #ea580c;">⚠️</span>
                <span class="pizarra-subitem-cant">${cant} ${cant === 1 ? 'unidad' : 'unidades'}</span>
                <span class="pizarra-subitem-desc">— ${desc} (Stock en disputa: demanda global supera disponible)</span>
              </div>
            `;
          });

          html += `
              </div>
            </div>
          `;
        } else {
          // Pedido activo con stock disponible completo y sin disputa (Visado en verde)
          const isExpanded = window.pizarraPedidosExpandidos.has(pIdStr);
          html += `
            <div class="pizarra-pedido-bloque">
              <div class="pizarra-pedido-header" onclick="window.togglePedidoFaltantes('${pIdStr}')" title="Click para ver artículos listos" style="cursor: pointer;">
                <span class="pizarra-pedido-bullet" style="color: #16a34a;">•</span>
                <span class="pizarra-pedido-texto">${taskText}</span>
                <span id="badge-prod-${pIdStr}" class="pizarra-badge-stock-ok ${isExpanded ? 'is-open' : ''}">
                  ✓ Stock listo
                  <span class="pizarra-chevron ${isExpanded ? 'is-open' : ''}" style="margin-left: 6px; font-size: 0.65rem;">▼</span>
                </span>
              </div>
              <div id="subitems-pedido-${pIdStr}" class="pizarra-subitems-container ${isExpanded ? 'is-open' : ''}">
          `;

          arts.forEach(it => {
            const cant = Math.round(parseFloat(it.cantidad) || 0);
            const desc = limpiarDescripcionArticulo(it.descripcion);
            html += `
              <div class="pizarra-subitem-prod" style="color: #15803d;">
                <span class="pizarra-subitem-icon" style="color: #16a34a;">✓</span>
                <span class="pizarra-subitem-cant">${cant} ${cant === 1 ? 'unidad' : 'unidades'}</span>
                <span class="pizarra-subitem-desc">— ${desc} (Listo en depósito)</span>
              </div>
            `;
          });

          html += `
              </div>
            </div>
          `;
        }
      });

      // Detectar si hay faltantes huérfanos (artículos a producir no asignados a los subitems anteriores)
      const articulosEnPedidosActivos = new Set();
      pedidosActivos.forEach(p => {
        (p.articulos || []).forEach(a => {
          if ((parseFloat(a.faltante) || 0) > 0.005) {
            articulosEnPedidosActivos.add(String(a.articulo).trim());
          }
        });
      });

      const faltantesHuerfanos = faltantesElaboracion.filter(f => {
        return !articulosEnPedidosActivos.has(String(f.articulo_numero).trim());
      });

      if (faltantesHuerfanos.length > 0) {
        const hId = 'otros-faltantes';
        const isHExpanded = window.pizarraPedidosExpandidos.has(hId);
        const totalHuerfanoUds = faltantesHuerfanos.reduce((acc, it) => acc + Math.round(it.faltante), 0);

        html += `
          <div class="pizarra-pedido-bloque" style="margin-top: 4px;">
            <div class="pizarra-pedido-header" onclick="window.togglePedidoFaltantes('${hId}')" title="Click para ver otros artículos a producir">
              <span class="pizarra-pedido-bullet">•</span>
              <span class="pizarra-pedido-texto">Otros artículos a producir</span>
              <span id="badge-prod-${hId}" class="pizarra-badge-prod ${isHExpanded ? 'is-open' : ''}">
                ⚠️ ${totalHuerfanoUds} ${totalHuerfanoUds === 1 ? 'unidad' : 'unidades'}
                <span class="pizarra-chevron">▼</span>
              </span>
            </div>
            <div id="subitems-pedido-${hId}" class="pizarra-subitems-container ${isHExpanded ? 'is-open' : ''}">
        `;

        faltantesHuerfanos.forEach(it => {
          const cant = Math.round(it.faltante);
          const desc = limpiarDescripcionArticulo(it.descripcion);
          html += `
            <div class="pizarra-subitem-prod">
              <span class="pizarra-subitem-icon">↳</span>
              <span class="pizarra-subitem-cant">${cant} ${cant === 1 ? 'unidad' : 'unidades'}</span>
              <span class="pizarra-subitem-desc">— ${desc}</span>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      }

      // Renderizar separador y pedidos completados después
      if (completedProdGroup.length > 0) {
        html += `<div class="pizarra-production-divider"></div>`;
        completedProdGroup.forEach(t => {
          html += `<div class="pizarra-alert-item completed">✅ ${t.text}</div>`;
        });
      }
    }

    // Renderizar el Plan de Trabajo Finito de Depósito (Metas por Horizonte Hoy -> 7d -> 15d -> 30d + Mirada Consciente)
    if (planTrabajoDeposito && typeof window.construirHtmlPlanTrabajoDeposito === 'function') {
      html += window.construirHtmlPlanTrabajoDeposito(planTrabajoDeposito, pedidosActivos, faltantesElaboracion);
    }

    // Renderizar sección de Presupuestos entregados o sin facturar
    if (totalEntregasSinFacturarCount > 0) {
      const tieneSoloCompletadas = activeEntregasSinFacturar.length === 0;

      // Estado de expansión: si solo hay completadas, replegado por defecto para despejar la pizarra
      let isEntregasExpanded = false;
      if (typeof window.pizarraEntregasSinFacturarExpandido === 'boolean') {
        isEntregasExpanded = window.pizarraEntregasSinFacturarExpandido;
      } else {
        const savedPref = localStorage.getItem('pizarra_entregas_acordeon_open');
        if (savedPref !== null) {
          isEntregasExpanded = (savedPref === 'true');
        } else {
          isEntregasExpanded = !tieneSoloCompletadas; // Abierto si hay pendientes, contraído si solo hay visadas
        }
      }

      const headerClass = tieneSoloCompletadas ? 'header-solo-completadas' : 'header-con-pendientes';
      const iconoTitulo = tieneSoloCompletadas ? '✅' : '⚠️';
      const tituloColor = tieneSoloCompletadas ? '#15803d' : '#ea580c';
      const textoTitulo = 'Presupuestos entregados o sin facturar:';

      html += `
        <div class="pizarra-seccion-entregas-bloque" id="seccion-entregas-sin-facturar">
          <div class="pizarra-seccion-entregas-header ${headerClass}" onclick="window.toggleAcordeonEntregasSinFacturar()" title="Hacer clic para ${isEntregasExpanded ? 'contraer' : 'desplegar'} el informe de presupuestos entregados">
            <div class="pizarra-seccion-entregas-titulo-wrap">
              <span class="pizarra-acordeon-chevron ${isEntregasExpanded ? 'rotado' : ''}" id="entregas-acordeon-chevron">▶</span>
              <span class="pizarra-alert-title-inline" style="color: ${tituloColor};">
                ${iconoTitulo} ${textoTitulo}
              </span>
            </div>
            <div class="pizarra-seccion-entregas-badges">
              ${activeEntregasSinFacturar.length > 0 ? `
                <span class="pizarra-globito globito-naranja" title="${activeEntregasSinFacturar.length} presupuesto(s) pendiente(s) de facturar">
                  ⚠️ ${activeEntregasSinFacturar.length}
                </span>
              ` : ''}
              ${completedEntregasSinFacturar.length > 0 ? `
                <span class="pizarra-globito globito-verde" title="${completedEntregasSinFacturar.length} presupuesto(s) con facturación visada (permanecen 12 hs)">
                  ✓ ${completedEntregasSinFacturar.length}
                </span>
              ` : ''}
            </div>
          </div>

          <div id="pizarra-entregas-acordeon-contenido" class="pizarra-entregas-acordeon-contenido ${isEntregasExpanded ? 'abierto' : ''}">
      `;

      // Activas (sin facturar)
      activeEntregasSinFacturar.forEach(t => {
        const estaExpandido = window.expandedTrazabilidadPresupuestos && window.expandedTrazabilidadPresupuestos.has(t.presupuestoId);
        let drawerHtml = '';
        if (estaExpandido) {
          if (window.trazabilidadCache && window.trazabilidadCache.has(t.presupuestoId)) {
            drawerHtml = window.renderizarTrazabilidadHTML(window.trazabilidadCache.get(t.presupuestoId));
          } else {
            drawerHtml = `
              <div class="trazabilidad-loading">
                <span class="trazabilidad-spinner"></span>
                <span>Consultando trazabilidad integral del Presupuesto #${t.presupuestoId}...</span>
              </div>
            `;
            if (!window.trazabilidadFetchPendiente || !window.trazabilidadFetchPendiente.has(t.presupuestoId)) {
              setTimeout(() => window.cargarTrazabilidadPresupuesto(t.presupuestoId), 50);
            }
          }
        }

        html += `
          <div class="pizarra-entrega-wrapper" id="wrapper-${t.id}">
            <div class="pizarra-entrega-fila" id="fila-${t.id}">
              <div class="pizarra-entrega-info" onclick="window.toggleTrazabilidadPresupuesto(${t.presupuestoId}, '${t.id}')" title="Hacer clic para ver toda la trazabilidad y flujo de este pedido">
                <span class="pizarra-toggle-btn ${estaExpandido ? 'rotado' : ''}" id="toggle-icon-${t.presupuestoId}">${estaExpandido ? '▼' : '▶'}</span>
                <span class="pizarra-pedido-bullet" style="color: #ea580c;">•</span>
                <span class="pizarra-entrega-texto"><strong>${t.text}</strong></span>
                <span class="pizarra-badge-trazabilidad">🔍 Ver Trazabilidad</span>
              </div>
              <div class="pizarra-entrega-acciones">
                <a href="http://localhost:3004/pages/facturas.html" target="_blank" class="btn-demanda-action btn-facturar" title="Ir a Facturación">🧾 Facturar</a>
                <button type="button" class="btn-demanda-action btn-desestimar" onclick="window.omitirAlertaPresupuestoNoFacturado('${t.id}', ${t.presupuestoId})" title="Omitir notificación por decisión del usuario">✕ Omitir</button>
              </div>
            </div>
            <div id="trazabilidad-drawer-${t.presupuestoId}" class="pizarra-trazabilidad-drawer ${estaExpandido ? 'abierto' : ''}">
              ${drawerHtml}
            </div>
          </div>
        `;
      });

      // Completadas (facturadas en las últimas 12 horas - en verde con tilde)
      completedEntregasSinFacturar.forEach(t => {
        const estaExpandidoComp = window.expandedTrazabilidadPresupuestos && window.expandedTrazabilidadPresupuestos.has(t.presupuestoId);
        let drawerHtmlComp = '';
        if (estaExpandidoComp) {
          if (window.trazabilidadCache && window.trazabilidadCache.has(t.presupuestoId)) {
            drawerHtmlComp = window.renderizarTrazabilidadHTML(window.trazabilidadCache.get(t.presupuestoId));
          } else {
            drawerHtmlComp = `
              <div class="trazabilidad-loading">
                <span class="trazabilidad-spinner"></span>
                <span>Consultando trazabilidad integral del Presupuesto #${t.presupuestoId}...</span>
              </div>
            `;
            if (!window.trazabilidadFetchPendiente || !window.trazabilidadFetchPendiente.has(t.presupuestoId)) {
              setTimeout(() => window.cargarTrazabilidadPresupuesto(t.presupuestoId), 50);
            }
          }
        }

        html += `
          <div class="pizarra-entrega-wrapper wrapper-completada" id="wrapper-${t.id}">
            <div class="pizarra-entrega-fila" id="fila-${t.id}" onclick="window.toggleTrazabilidadPresupuesto(${t.presupuestoId}, '${t.id}')" title="Hacer clic para ver trazabilidad del pedido facturado">
              <div class="pizarra-entrega-info">
                <span class="pizarra-toggle-btn ${estaExpandidoComp ? 'rotado' : ''}" id="toggle-icon-${t.presupuestoId}">${estaExpandidoComp ? '▼' : '▶'}</span>
                <span style="color: #15803d; font-weight: 500;">✅ ${t.text}</span>
                <span class="pizarra-badge-trazabilidad-green">🔍 Ver Trazabilidad</span>
              </div>
            </div>
            <div id="trazabilidad-drawer-${t.presupuestoId}" class="pizarra-trazabilidad-drawer ${estaExpandidoComp ? 'abierto' : ''}">
              ${drawerHtmlComp}
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    }

    // Renderizar sección de Demanda Satisfecha (Stock Ingresado)
    if (totalDemandaCount > 0) {
      html += `<div class="pizarra-alert-title" style="color: #16a34a; margin-top: 6px;">🟢 Demanda Satisfecha (Stock Ingresado):</div>`;
      demandaSatisfecha.forEach(item => {
        const dId = item.id;
        const cant = Math.round(item.cantidad);
        const desc = limpiarDescripcionArticulo(item.descripcion);
        const cli = item.cliente_nombre;
        const dispBadge = item.disponibilidad === 'STOCK_DIRECTO' 
          ? `<span class="pizarra-badge-stock-ok">✓ Stock listo: ${item.stock_consolidado} un.</span>`
          : `<span class="pizarra-badge-granel-ok">🌾 Granel listo: ${Number(item.stock_granel_disponible).toFixed(1)} kg</span>`;

        html += `
          <div class="pizarra-demanda-fila" id="demanda-fila-${dId}">
            <div class="pizarra-demanda-info">
              <span class="pizarra-pedido-bullet" style="color: #16a34a;">•</span>
              <span class="pizarra-demanda-texto"><strong>${cant} un.</strong> ${desc} — <span class="pizarra-demanda-cliente">${cli}</span></span>
              ${dispBadge}
            </div>
            <div class="pizarra-demanda-acciones">
              <button class="btn-demanda-action btn-contactar" onclick="window.abrirModalGestionDemanda(${dId})" title="Contactar cliente / Ver detalle">📞 Contactar</button>
              <button class="btn-demanda-action btn-cubierto" onclick="window.marcarDemandaCubierta(${dId})" title="Marcar como ya entregado / cubierto">✔️ Cubierto</button>
              <button class="btn-demanda-action btn-desestimar" onclick="window.desestimarDemanda(${dId})" title="Desestimar / Desechar">🗑️</button>
            </div>
          </div>
        `;
      });
    }

    // Renderizar sección de En Espera (Pendientes de Compra)
    if (totalEsperaCount > 0) {
      html += `<div class="pizarra-alert-title">En Espera:</div>`;

      // Activas
      activeEsperaTasks.forEach(t => {
        html += `<div class="pizarra-alert-item">• ${t.text}</div>`;
      });

      // Completadas
      completedEsperaTasks.forEach(t => {
        html += `<div class="pizarra-alert-item completed">✅ ${t.text}</div>`;
      });
    }

    // Renderizar sección de Mantenimiento
    if (totalMantenimientoCount > 0) {
      html += `<div class="pizarra-alert-title">Mantenimiento:</div>`;
      
      // Activas
      activeMantenimiento.forEach(t => {
        html += `<div class="pizarra-alert-item">• ${t.text}</div>`;
      });

      // Completadas
      completedMantenimiento.forEach(t => {
        html += `<div class="pizarra-alert-item completed">✅ ${t.text}</div>`;
      });
    }

    container.innerHTML = html;

  } catch (error) {
    console.error('Error al actualizar alertas de la pizarra:', error);
  }
}
window.actualizarAlertasPizarra = actualizarAlertasPizarra;

/**
 * Controla la visibilidad del botón "Limpiar realizados" de la pizarra
 */
function actualizarBotonLimpiarPizarra() {
  const btnLimpiar = document.getElementById('btn-limpiar-pizarra');
  if (!btnLimpiar) return;

  // 1. Verificar tareas/alertas completadas
  let hasCompletedTasks = false;
  try {
    const stored = localStorage.getItem('pizarra_tasks_v4');
    if (stored) {
      const tasks = JSON.parse(stored);
      hasCompletedTasks = tasks.some(t => t.completed);
    }
  } catch (e) {}

  // 2. Verificar jornadas completadas visibles
  const hasCompletedJornadas = Array.isArray(window.jornadasCompletadasVisibles) && window.jornadasCompletadasVisibles.length > 0;

  btnLimpiar.style.display = (hasCompletedTasks || hasCompletedJornadas) ? 'flex' : 'none';
}

/**
 * Vía B: Purga Manual Directa (Eliminar alertas y jornadas completadas con tilde verde)
 */
async function purgaManualAlertas() {
  try {
    // 1. Purgar alertas normales de producción y mantenimiento
    const stored = localStorage.getItem('pizarra_tasks_v4');
    if (stored) {
      let tasks = JSON.parse(stored);
      const completedIds = tasks.filter(t => t.completed).map(t => t.id);

      let dismissed = [];
      try {
        dismissed = JSON.parse(localStorage.getItem('pizarra_dismissed_v4') || '[]');
      } catch(e){}

      dismissed = Array.from(new Set([...dismissed, ...completedIds]));
      localStorage.setItem('pizarra_dismissed_v4', JSON.stringify(dismissed));

      tasks = tasks.filter(t => !t.completed);
      localStorage.setItem('pizarra_tasks_v4', JSON.stringify(tasks));
    }

    // 2. Purgar jornadas completadas de la pizarra
    if (Array.isArray(window.jornadasCompletadasVisibles) && window.jornadasCompletadasVisibles.length > 0) {
      let dismissedJornadas = [];
      try {
        dismissedJornadas = JSON.parse(localStorage.getItem('pizarra_dismissed_jornadas') || '[]');
      } catch(e){}

      for (const j of window.jornadasCompletadasVisibles) {
        dismissedJornadas.push(j.id);
        // Si fue una jornada accidental de 0 minutos o 0 horas, limpiarla de la BD para que no quede residuo
        const hsNum = parseFloat(j.horas_totales) || 0;
        const minsNum = parseInt(j.minutos_totales) || 0;
        if (hsNum === 0 && minsNum === 0) {
          try {
            await fetch(`/api/colaboradores/jornadas/${j.id}`, { method: 'DELETE' });
          } catch(err) {
            console.warn('Error al eliminar jornada 0 hs de BD:', err);
          }
        }
      }

      localStorage.setItem('pizarra_dismissed_jornadas', JSON.stringify(Array.from(new Set(dismissedJornadas))));
    }

    // Forzar actualización inmediata de la interfaz
    await actualizarAlertasPizarra();
    await actualizarWidgetColaboradoresPizarra();
    actualizarBotonLimpiarPizarra();
  } catch (error) {
    console.error('Error al purgar alertas y jornadas de la pizarra:', error);
  }
}

// Exponer la función globalmente para onclick de index.html
window.purgaManualAlertas = purgaManualAlertas;

/**
 * Permite al usuario omitir una alerta de presupuesto entregado sin facturar
 */
window.omitirAlertaPresupuestoNoFacturado = async function(taskId, idPresupuesto) {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: '¿Omitir notificación?',
      text: `¿Deseas omitir la alerta de entrega sin facturar para el Presupuesto #${idPresupuesto}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#ea580c',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, omitir',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;
  } else {
    if (!confirm(`¿Deseas omitir la alerta para el Presupuesto #${idPresupuesto}?`)) return;
  }

  try {
    let dismissed = [];
    try {
      dismissed = JSON.parse(localStorage.getItem('pizarra_dismissed_v4') || '[]');
    } catch(e){}
    if (!dismissed.includes(taskId)) {
      dismissed.push(taskId);
    }
    localStorage.setItem('pizarra_dismissed_v4', JSON.stringify(dismissed));

    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem('pizarra_tasks_v4') || '[]');
    } catch(e){}
    stored = stored.filter(t => t.id !== taskId);
    localStorage.setItem('pizarra_tasks_v4', JSON.stringify(stored));

    await actualizarAlertasPizarra();

    if (typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Alerta omitida correctamente',
        showConfirmButton: false,
        timer: 2000
      });
    }
  } catch(err) {
    console.error('Error al omitir alerta:', err);
  }
};

/**
 * Alterna el acordeón principal de la sección de Presupuestos Entregados
 */
window.toggleAcordeonEntregasSinFacturar = function() {
  const current = typeof window.pizarraEntregasSinFacturarExpandido === 'boolean'
    ? window.pizarraEntregasSinFacturarExpandido
    : false;

  const nuevoEstado = !current;
  window.pizarraEntregasSinFacturarExpandido = nuevoEstado;
  try {
    localStorage.setItem('pizarra_entregas_acordeon_open', String(nuevoEstado));
  } catch (e) {
    console.warn('No se pudo guardar preferencia en localStorage', e);
  }

  const container = document.getElementById('pizarra-entregas-acordeon-contenido');
  const chevron = document.getElementById('entregas-acordeon-chevron');
  if (container) {
    if (nuevoEstado) {
      container.classList.add('abierto');
      if (chevron) chevron.classList.add('rotado');
    } else {
      container.classList.remove('abierto');
      if (chevron) chevron.classList.remove('rotado');
    }
  }
};

/* ==========================================================================
   TRAZABILIDAD INTEGRAL Y EMPÍRICA DE PRESUPUESTOS (PIZARRA PRINCIPAL)
   ========================================================================== */
window.trazabilidadCache = window.trazabilidadCache || new Map();
window.expandedTrazabilidadPresupuestos = window.expandedTrazabilidadPresupuestos || new Set();
window.trazabilidadFetchPendiente = window.trazabilidadFetchPendiente || new Set();

/**
 * Alterna (despliega / pliega) el panel de trazabilidad empírica de un presupuesto
 */
window.toggleTrazabilidadPresupuesto = async function(presupuestoId, taskId) {
  if (!presupuestoId) return;

  const drawerId = `trazabilidad-drawer-${presupuestoId}`;
  const iconId = `toggle-icon-${presupuestoId}`;
  const drawerEl = document.getElementById(drawerId);
  const iconEl = document.getElementById(iconId);

  const yaAbierto = window.expandedTrazabilidadPresupuestos.has(presupuestoId);

  if (yaAbierto) {
    window.expandedTrazabilidadPresupuestos.delete(presupuestoId);
    if (drawerEl) {
      drawerEl.classList.remove('abierto');
      drawerEl.style.display = 'none';
    }
    if (iconEl) {
      iconEl.classList.remove('rotado');
      iconEl.textContent = '▶';
    }
  } else {
    window.expandedTrazabilidadPresupuestos.add(presupuestoId);
    if (drawerEl) {
      drawerEl.classList.add('abierto');
      drawerEl.style.display = 'block';
    }
    if (iconEl) {
      iconEl.classList.add('rotado');
      iconEl.textContent = '▼';
    }

    if (window.trazabilidadCache.has(presupuestoId)) {
      if (drawerEl) {
        drawerEl.innerHTML = window.renderizarTrazabilidadHTML(window.trazabilidadCache.get(presupuestoId));
      }
    } else {
      if (drawerEl) {
        drawerEl.innerHTML = `
          <div class="trazabilidad-loading">
            <span class="trazabilidad-spinner"></span>
            <span>Consultando trazabilidad integral del Presupuesto #${presupuestoId}...</span>
          </div>
        `;
      }
      await window.cargarTrazabilidadPresupuesto(presupuestoId);
    }
  }
};

/**
 * Carga por HTTP la trazabilidad empírica desde el backend y actualiza el DOM
 */
window.cargarTrazabilidadPresupuesto = async function(presupuestoId) {
  if (!presupuestoId || window.trazabilidadFetchPendiente.has(presupuestoId)) return;
  window.trazabilidadFetchPendiente.add(presupuestoId);

  try {
    const res = await fetch(`/api/pizarra/presupuestos/${presupuestoId}/trazabilidad`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Error al obtener datos');
    }
    window.trazabilidadCache.set(presupuestoId, json);

    const drawerEl = document.getElementById(`trazabilidad-drawer-${presupuestoId}`);
    if (drawerEl && window.expandedTrazabilidadPresupuestos.has(presupuestoId)) {
      drawerEl.innerHTML = window.renderizarTrazabilidadHTML(json);
    }
  } catch (err) {
    console.error(`Error cargando trazabilidad para #${presupuestoId}:`, err);
    const drawerEl = document.getElementById(`trazabilidad-drawer-${presupuestoId}`);
    if (drawerEl) {
      drawerEl.innerHTML = `
        <div style="color: #dc2626; padding: 12px; font-size: 0.85rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;">
          ❌ <strong>No se pudo cargar la trazabilidad:</strong> ${err.message}
          <div style="margin-top: 6px;">
            <button type="button" class="trazabilidad-btn-action" onclick="window.cargarTrazabilidadPresupuesto(${presupuestoId})" style="background: #dc2626; cursor: pointer;">🔄 Reintentar</button>
          </div>
        </div>
      `;
    }
  } finally {
    window.trazabilidadFetchPendiente.delete(presupuestoId);
  }
};

/**
 * Alterna la visibilidad de la tabla de artículos del pedido
 */
window.toggleTablaArticulosTrazabilidad = function(presupuestoId) {
  const bodyEl = document.getElementById(`tabla-articulos-body-${presupuestoId}`);
  const iconEl = document.getElementById(`tabla-articulos-icon-${presupuestoId}`);
  if (!bodyEl) return;
  if (bodyEl.style.display === 'none') {
    bodyEl.style.display = 'block';
    if (iconEl) iconEl.textContent = '▼ Ocultar detalle';
  } else {
    bodyEl.style.display = 'none';
    if (iconEl) iconEl.textContent = '▶ Desplegar detalle';
  }
};

/**
 * Genera el HTML de la tarjeta de trazabilidad con diseño profesional y determinista
 */
window.renderizarTrazabilidadHTML = function(data) {
  if (!data || !data.presupuesto) return '<div class="trazabilidad-error">No se encontraron datos de trazabilidad.</div>';

  const p = data.presupuesto;
  const c = data.cliente || {};
  const d = data.domicilio_entrega || {};
  const prod = data.produccion || {};
  const log = data.logistica || {};
  const com = data.comunicacion || {};
  const fact = data.facturacion || {};
  const items = data.items || [];

  const formatoMoneda = (val) => {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatoFechaHora = (isoStr) => {
    if (!isoStr) return 'No registrado';
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return isoStr;
      return date.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' hs';
    } catch(e) {
      return isoStr;
    }
  };

  const formatoFecha = (isoStr) => {
    if (!isoStr) return 'No registrado';
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return isoStr;
      return date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch(e) {
      return isoStr;
    }
  };

  // Diagnóstico de facturación
  let diagnosticoFacturacion = '';
  const facturas = fact.facturas || [];
  const tieneFacturaAprobada = facturas.some(f => f.estado === 'APROBADA');
  const facturasAnuladas = facturas.filter(f => f.estado === 'ANULADA');

  if (tieneFacturaAprobada) {
    const fOk = facturas.find(f => f.estado === 'APROBADA');
    const tipo = fOk.tipo_cbte === 1 ? 'Factura A' : (fOk.tipo_cbte === 6 ? 'Factura B' : 'Factura');
    const ptoVta = String(fOk.pto_vta || 32).padStart(4, '0');
    const nroComp = String(fOk.cbte_nro || '').padStart(8, '0');
    diagnosticoFacturacion = `
      <div class="trazabilidad-box box-success">
        <div class="trazabilidad-box-header">
          <span class="trazabilidad-tag tag-success">✅ Factura Emitida y Aprobada</span>
          <strong>${tipo} N° ${ptoVta}-${nroComp}</strong>
        </div>
        <div class="trazabilidad-box-body">
          <div><strong>Fecha Emisión:</strong> ${formatoFechaHora(fOk.emitida_en)}</div>
          <div><strong>Importe Facturado:</strong> $${formatoMoneda(fOk.imp_total)}</div>
          <div><strong>CAE AFIP:</strong> ${fOk.cae || 'Sin CAE'}</div>
          ${fOk.es_enviado ? `<div style="color: #16a34a; margin-top: 4px;">📱 <strong>Enviada al cliente por WhatsApp el:</strong> ${formatoFechaHora(fOk.enviado_at)}</div>` : '<div style="color: #64748b; margin-top: 4px;">📱 Sin constancia de despacho de factura por WhatsApp.</div>'}
        </div>
      </div>
    `;
  } else if (facturasAnuladas.length > 0) {
    const fAnul = facturasAnuladas[0];
    const tipo = fAnul.tipo_cbte === 1 ? 'Factura A' : (fAnul.tipo_cbte === 6 ? 'Factura B' : 'Factura');
    const ptoVta = String(fAnul.pto_vta || 32).padStart(4, '0');
    const nroComp = String(fAnul.cbte_nro || '').padStart(8, '0');
    diagnosticoFacturacion = `
      <div class="trazabilidad-box box-danger">
        <div class="trazabilidad-box-header">
          <span class="trazabilidad-tag tag-danger">⚠️ Factura ANULADA — Pendiente de Facturación</span>
          <strong>${tipo} N° ${ptoVta}-${nroComp}</strong>
        </div>
        <div class="trazabilidad-box-body">
          <div style="color: #b91c1c; font-weight: 600; margin-bottom: 4px;">
            ⚠️ CAUSA DE LA ALERTA: Esta factura fue ANULADA en facturación el ${formatoFechaHora(fAnul.updated_at || fAnul.emitida_en)}. El pedido fue entregado en destino pero actualmente no cuenta con comprobante fiscal activo ni saldo compensado.
          </div>
          <div><strong>Importe original:</strong> $${formatoMoneda(fAnul.imp_total)} | <strong>CAE:</strong> ${fAnul.cae || '-'}</div>
          ${fAnul.es_enviado ? `<div>📱 La factura anulada había sido enviada por WhatsApp el: ${formatoFechaHora(fAnul.enviado_at)}</div>` : ''}
          <div style="margin-top: 8px;">
            <a href="http://localhost:3004/pages/facturas.html" target="_blank" class="trazabilidad-btn-action">🧾 Ir a Facturación para re-emitir comprobante</a>
          </div>
        </div>
      </div>
    `;
  } else {
    diagnosticoFacturacion = `
      <div class="trazabilidad-box box-warning">
        <div class="trazabilidad-box-header">
          <span class="trazabilidad-tag tag-warning">⚠️ Sin Factura Generada</span>
          <strong>Presupuesto sin Comprobante Fiscal</strong>
        </div>
        <div class="trazabilidad-box-body">
          <div style="color: #c2410c; margin-bottom: 4px;">
            El presupuesto fue entregado logísticamente pero nunca ingresó ni se emitió factura en ARCA ni comprobante local.
          </div>
          <div style="margin-top: 8px;">
            <a href="http://localhost:3004/pages/facturas.html" target="_blank" class="trazabilidad-btn-action">🧾 Abrir Facturador (Puerto 3004)</a>
          </div>
        </div>
      </div>
    `;
  }

  // Snapshots de taller
  let snapshotsHtml = '';
  if (prod.snapshots && prod.snapshots.length > 0) {
    snapshotsHtml = prod.snapshots.map(s => `
      <div class="trazabilidad-timeline-item">
        <span class="trazabilidad-dot dot-blue"></span>
        <div class="trazabilidad-timeline-content">
          <strong>${s.motivo === 'primera_impresion' ? '🖨️ Primera Impresión para Armado en Taller' : '📝 Modificación / Re-impresión (' + s.motivo + ')'}</strong>
          <div>Fecha / Hora: <strong>${formatoFechaHora(s.fecha)}</strong> (Impresión N° ${s.numero_impresion || 1} — Secuencia: ${s.secuencia || 'Armar_Pedido'})</div>
        </div>
      </div>
    `).join('');
  } else {
    snapshotsHtml = `
      <div class="trazabilidad-timeline-item">
        <span class="trazabilidad-dot dot-gray"></span>
        <div class="trazabilidad-timeline-content">
          <span style="color: #64748b;">Sin registro de impresión/snapshot en taller. Secuencia actual: <strong>${prod.secuencia_actual || 'Imprimir'}</strong></span>
        </div>
      </div>
    `;
  }

  // Eventos de entrega y confirmación
  let entregaEventosHtml = '';
  if (log.eventos_entrega && log.eventos_entrega.length > 0) {
    entregaEventosHtml = log.eventos_entrega.map(e => `
      <div class="trazabilidad-timeline-item">
        <span class="trazabilidad-dot dot-green"></span>
        <div class="trazabilidad-timeline-content">
          <strong>📍 Entrega Confirmada en Destino</strong>
          <div>Fecha / Hora: <strong>${formatoFechaHora(e.fecha_entrega)}</strong></div>
          <div>Receptor: <strong>${e.receptor_nombre || 'Chofer'}</strong> (${e.receptor_vinculo || 'Chofer'}) — Tipo: ${e.tipo_evento || 'ENTREGA'}</div>
          ${e.lat && e.lng ? `<div>Coordenadas GPS: <code>${e.lat}, ${e.lng}</code> <a href="https://www.google.com/maps?q=${e.lat},${e.lng}" target="_blank" class="trazabilidad-link-mapa">🗺️ Ver en Google Maps</a></div>` : ''}
        </div>
      </div>
    `).join('');
  } else if (log.fecha_entrega_real) {
    entregaEventosHtml = `
      <div class="trazabilidad-timeline-item">
        <span class="trazabilidad-dot dot-green"></span>
        <div class="trazabilidad-timeline-content">
          <strong>📍 Entrega Registrada en Sistema</strong>
          <div>Fecha / Hora Real: <strong>${formatoFechaHora(log.fecha_entrega_real)}</strong> — Estado: <strong>${p.estado_logistico || 'ENTREGADO'}</strong></div>
        </div>
      </div>
    `;
  } else {
    entregaEventosHtml = `
      <div class="trazabilidad-timeline-item">
        <span class="trazabilidad-dot dot-orange"></span>
        <div class="trazabilidad-timeline-content">
          <span style="color: #ea580c;">Sin confirmación de entrega en destino.</span>
        </div>
      </div>
    `;
  }

  // WhatsApp contactos
  let contactosWpHtml = '';
  if (com.contactos_whatsapp && com.contactos_whatsapp.length > 0) {
    contactosWpHtml = com.contactos_whatsapp.map(cw => `
      <span class="trazabilidad-chip-wp">
        📱 <strong>${cw.nombre}</strong> (${cw.cargo || 'Contacto'}): ${cw.numero} ${cw.es_default ? '<span title="Contacto por defecto">★ Predeterminado</span>' : ''}
      </span>
    `).join(' ');
  } else {
    contactosWpHtml = '<span style="color: #64748b; font-size: 0.85rem;">No hay teléfonos de WhatsApp configurados en la ficha de Búnker.</span>';
  }

  // WhatsApp envíos
  let enviosWpHtml = '';
  if (com.envios_factura_whatsapp && com.envios_factura_whatsapp.length > 0) {
    enviosWpHtml = com.envios_factura_whatsapp.map(ew => `
      <div style="color: #15803d; font-size: 0.86rem; margin-top: 3px;">
        ✅ Factura <strong>${ew.cbte}</strong> enviada por WhatsApp el <strong>${formatoFechaHora(ew.enviado_at)}</strong> (Canal: ${ew.canal || 'WhatsApp'})
      </div>
    `).join('');
  } else {
    enviosWpHtml = '<div style="color: #64748b; font-size: 0.86rem; margin-top: 3px;">Sin registro de envío de factura por WhatsApp.</div>';
  }

  // Tabla de items
  let tablaItemsHtml = '';
  if (items && items.length > 0) {
    const filas = items.map((it, idx) => `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td><code>${it.articulo}</code></td>
        <td><strong>${it.descripcion || it.articulo}</strong></td>
        <td style="text-align: right;">${parseFloat(it.cantidad || 0).toFixed(2)}</td>
        <td style="text-align: right;">$${formatoMoneda(it.precio_unitario)}</td>
        <td style="text-align: right; font-weight: 600;">$${formatoMoneda(it.subtotal)}</td>
      </tr>
    `).join('');

    tablaItemsHtml = `
      <div class="trazabilidad-tabla-container">
        <table class="trazabilidad-tabla">
          <thead>
            <tr>
              <th style="width: 30px;">#</th>
              <th>Código</th>
              <th>Descripción</th>
              <th style="text-align: right;">Cant.</th>
              <th style="text-align: right;">P. Unit</th>
              <th style="text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${filas}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align: right; font-weight: 700;">Totales:</td>
              <td style="text-align: right; font-weight: 700;">${parseFloat(p.total_unidades || 0).toFixed(2)}</td>
              <td></td>
              <td style="text-align: right; font-weight: 700; color: #ea580c;">$${formatoMoneda(p.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  return `
    <div class="trazabilidad-card-inner">
      <!-- HEADER -->
      <div class="trazabilidad-header">
        <div class="trazabilidad-header-title">
          <span style="font-size: 1.15rem;">📋</span>
          <div>
            <h4 style="margin: 0; font-size: 1rem; color: #0f172a;">Trazabilidad Empírica — Presupuesto #${p.id}</h4>
            <span style="font-size: 0.8rem; color: #64748b;">Cliente: <strong>${c.nombre}</strong> (${c.codigo_bunker || 'CB-S/D'}) — Razón Social: ${c.razon_social || '-'}</span>
          </div>
        </div>
        <div class="trazabilidad-header-pills">
          <span class="trazabilidad-pill pill-portal">${p.origen_canal === 'Portal B2B' ? '🌐 Portal B2B' : '🏢 Local / Taller'}</span>
          <span class="trazabilidad-pill pill-total">💰 $${formatoMoneda(p.total)}</span>
          <span class="trazabilidad-pill pill-items">📦 ${p.cant_items} artículos (${parseFloat(p.total_unidades || 0).toFixed(0)} un.)</span>
          ${parseFloat(p.descuento || 0) > 0 ? `<span class="trazabilidad-pill pill-desc">🏷️ Desc: ${(parseFloat(p.descuento) * 100).toFixed(0)}%</span>` : ''}
          <button type="button" class="btn-cerrar-trazabilidad" onclick="window.toggleTrazabilidadPresupuesto(${p.id})" title="Cerrar panel">✕ Cerrar</button>
        </div>
      </div>

      <!-- GRID DE ETAPAS DEL FLUJO -->
      <div class="trazabilidad-grid">
        <!-- ETAPA 1: ORIGEN -->
        <div class="trazabilidad-col">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero">1</span>
            <strong>📝 Origen y Creación</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            <div><strong>Fecha Administrativa:</strong> ${formatoFecha(p.fecha_administrativa)}</div>
            ${p.supabase_pedido_id ? `
              <div><strong>Ingreso Portal B2B:</strong> ${formatoFechaHora(p.fecha_creacion_portal)}</div>
              <div style="font-size: 0.76rem; color: #64748b; word-break: break-all;"><strong>UUID Supabase:</strong> ${p.supabase_pedido_id}</div>
            ` : `<div><strong>Ingreso:</strong> Taller / Local</div>`}
            <div><strong>Agente / Creador:</strong> ${p.agente || 'Sistema'}</div>
            <div><strong>Tipo Comprobante:</strong> ${p.tipo_comprobante || 'Factura'}</div>
            ${p.nota ? `<div class="trazabilidad-nota"><strong>Nota:</strong> ${p.nota}</div>` : ''}
          </div>
        </div>

        <!-- ETAPA 2: TALLER / PRODUCCIÓN -->
        <div class="trazabilidad-col">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero">2</span>
            <strong>🏭 Armado en Taller</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            <div><strong>Secuencia Logística:</strong> <span class="badge-secuencia">${prod.secuencia_actual || 'Imprimir'}</span></div>
            <div style="margin-top: 6px;">${snapshotsHtml}</div>
          </div>
        </div>

        <!-- ETAPA 3: HOJA DE RUTA -->
        <div class="trazabilidad-col">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero">3</span>
            <strong>🚚 Hoja de Ruta & Despacho</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            ${log.id_ruta ? `
              <div><strong>Hoja de Ruta:</strong> #${log.id_ruta} — <em>${log.nombre_ruta || ''}</em></div>
              <div><strong>Asignado a Ruta:</strong> ${formatoFechaHora(log.fecha_asignacion_ruta)}</div>
              <div><strong>Chofer:</strong> 👤 ${log.chofer_nombre || 'No asignado'}</div>
              <div><strong>Orden en Hoja:</strong> Parada N° <strong>${log.orden_entrega || 1}</strong></div>
              <div><strong>Salida de Planta:</strong> ${formatoFechaHora(log.fecha_salida_ruta)}</div>
              <div><strong>Destino:</strong> ${d.direccion || c.domicilio || '-'} (${d.alias || 'Local'}) — ${d.localidad || c.localidad || ''}</div>
              <div><strong>Estado Ruta:</strong> <span class="badge-secuencia">${log.estado_ruta || 'En curso'}</span></div>
            ` : `<div style="color: #64748b;">No fue asignado a ninguna hoja de ruta.</div>`}
          </div>
        </div>

        <!-- ETAPA 4: ENTREGA FÍSICA -->
        <div class="trazabilidad-col">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero">4</span>
            <strong>📍 Entrega Física</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            <div><strong>Estado Logístico:</strong> <span class="badge-secuencia ${p.estado_logistico === 'ENTREGADO' ? 'badge-verde' : ''}">${p.estado_logistico || 'PENDIENTE'}</span></div>
            <div style="margin-top: 6px;">${entregaEventosHtml}</div>
          </div>
        </div>
      </div>

      <!-- WHATSAPP Y FISCAL -->
      <div class="trazabilidad-grid-secondary">
        <!-- WHATSAPP -->
        <div class="trazabilidad-col-sec">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero" style="background: #25D366;">💬</span>
            <strong>Comunicación por WhatsApp</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            <div style="margin-bottom: 6px;"><strong>Destinatarios registrados en Búnker:</strong></div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">${contactosWpHtml}</div>
            <div style="border-top: 1px dashed #cbd5e1; padding-top: 6px;">
              <div><strong>Envíos registrados:</strong></div>
              ${enviosWpHtml}
              <div style="color: #64748b; font-size: 0.82rem; margin-top: 4px;">
                ${p.supabase_pedido_id ? 'ℹ️ El pedido ingresó en formato digital directo desde el Portal B2B. No requirió envío manual previo de PDF.' : 'ℹ️ El presupuesto fue confeccionado en taller.'}
              </div>
            </div>
          </div>
        </div>

        <!-- ESTADO FISCAL / FACTURACIÓN -->
        <div class="trazabilidad-col-sec">
          <div class="trazabilidad-etapa-header">
            <span class="etapa-numero" style="background: #ea580c;">🧾</span>
            <strong>Diagnóstico Fiscal & Facturación</strong>
          </div>
          <div class="trazabilidad-etapa-body">
            ${diagnosticoFacturacion}
          </div>
        </div>
      </div>

      <!-- TABLA DE ARTÍCULOS PEDIDOS -->
      <div class="trazabilidad-items-seccion">
        <div class="trazabilidad-items-titulo" onclick="window.toggleTablaArticulosTrazabilidad(${p.id})">
          <span>📦 <strong>Artículos del Pedido (${items.length} ítems)</strong></span>
          <span id="tabla-articulos-icon-${p.id}" style="font-size: 0.8rem; color: #64748b;">▼ Ocultar detalle</span>
        </div>
        <div id="tabla-articulos-body-${p.id}">
          ${tablaItemsHtml}
        </div>
      </div>
    </div>
  `;
};




/**
 * Consulta el estado de WhatsApp en el puerto 3004 y actualiza el indicador global en el header
 */
async function cargarIndicadorWhatsApp() {
  const container = document.getElementById('global-whatsapp-indicator');
  if (!container) return;

  const portFacturacion = 3004;
  const url = `${window.location.protocol}//${window.location.hostname}:${portFacturacion}/facturacion/whatsapp/status`;
  const configUrl = `${window.location.protocol}//${window.location.hostname}:${portFacturacion}/pages/whatsapp-config.html`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const result = await response.json();
    if (result.success && result.data) {
      const { status } = result.data;
      
      let dotClass = '';
      let tooltipText = '';
      if (status === 'CONECTADO') {
        dotClass = 'connected';
        tooltipText = 'WhatsApp Activo';
      } else if (status === 'CONECTANDO') {
        dotClass = 'connecting';
        tooltipText = 'WhatsApp Conectando...';
      } else if (status === 'ESPERANDO_QR') {
        dotClass = 'waiting';
        tooltipText = 'WhatsApp Esperando QR';
      } else {
        dotClass = 'disconnected';
        tooltipText = 'WhatsApp Desconectado';
      }
      
      container.className = `whatsapp-status-indicator tooltip ${dotClass}`;
      container.setAttribute('data-tooltip', tooltipText);
      container.innerHTML = `
        <a href="${configUrl}" class="whatsapp-dot-link" style="display: block; width: 100%; height: 100%; border-radius: 50%;"></a>
      `;
    } else {
      throw new Error('Formato de respuesta inválido');
    }
  } catch (error) {
    console.warn('No se pudo obtener el estado de WhatsApp:', error.message);
    container.className = 'whatsapp-status-indicator tooltip disconnected';
    container.setAttribute('data-tooltip', 'WhatsApp Desconectado');
    container.innerHTML = `
      <a href="${configUrl}" class="whatsapp-dot-link" style="display: block; width: 100%; height: 100%; border-radius: 50%;"></a>
    `;
  }
}

// ═══════════════════════════════════════════════════════════
// GESTIÓN DE COLABORADORES EN DEPÓSITO (PIZARRA CENTRAL)
// ═══════════════════════════════════════════════════════════

let jornadasActivasPizarra = [];

/**
 * Consulta las jornadas activas en depósito y actualiza el DOM de la Pizarra
 */
async function actualizarWidgetColaboradoresPizarra() {
  const btnTopContainer = document.getElementById('pizarra-colaborador-btn-top');
  const container = document.getElementById('pizarra-colaboradores-container');

  try {
    const res = await fetch('/api/colaboradores/jornadas/activas');
    if (!res.ok) return;

    const data = await res.json();
    const activas = Array.isArray(data) ? data : (data.activas || []);
    const rawCompletadas = Array.isArray(data) ? [] : (data.completadas_recientes || []);
    jornadasActivasPizarra = activas;

    // Filtrar completadas que el usuario ya haya purgado o cerrado manualmente
    let dismissedJornadas = [];
    try {
      dismissedJornadas = JSON.parse(localStorage.getItem('pizarra_dismissed_jornadas') || '[]');
    } catch(e){}
    const completadas = rawCompletadas.filter(c => !dismissedJornadas.includes(c.id));
    window.jornadasCompletadasVisibles = completadas;

    // Sincronizar visibilidad del botón de limpieza general (🧹 Limpiar realizados)
    actualizarBotonLimpiarPizarra();

    // 1. El botón de Inicio de Jornada SIEMPRE queda ubicado ARRIBA de todo
    if (btnTopContainer) {
      if (activas.length === 0) {
        btnTopContainer.innerHTML = `
          <div class="colaborador-empty-banner">
            <button type="button" class="btn-iniciar-jornada-pizarra" onclick="window.abrirModalIniciarJornada()">
              <span style="font-size: 1.1em;">⏱️</span> Inicio de Jornada
            </button>
          </div>
        `;
      } else {
        btnTopContainer.innerHTML = `
          <div class="colaborador-empty-banner">
            <button type="button" class="btn-iniciar-jornada-pizarra" onclick="window.abrirModalIniciarJornada()">
              <span style="font-size: 1.1em;">➕</span> Inicio de otra jornada
            </button>
          </div>
        `;
      }
    }

    if (!container) return;

    // 2. Si no hay turnos activos ni completados recientes visibles, ocultar el contenedor inferior
    if (activas.length === 0 && completadas.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    let html = '<div class="colaboradores-activos-list">';

    // 3. Renderizar turnos activos (con cronómetro en vivo) al final de la pizarra
    activas.forEach(j => {
      const horaIngreso = new Date(j.fecha_ingreso).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      html += `
        <div class="colaborador-card-activo" id="card-jornada-${j.id}">
          <div class="colaborador-activo-left">
            <div class="status-live-indicator">
              <span class="pulse-live"></span>
              <span class="live-text">EN DEPÓSITO</span>
            </div>
            <div class="colaborador-nombre">${j.nombre_completo}</div>
            <div class="colaborador-ingreso">
              Ingreso: <strong>${horaIngreso} hs</strong>
              ${j.observacion_ingreso ? `<span style="display:block; font-size: 0.8em; color: #64748b; margin-top: 2px;">💬 ${j.observacion_ingreso}</span>` : ''}
            </div>
          </div>
          <div class="colaborador-activo-center">
            <div class="cronometro-label">TIEMPO TRANSCURRIDO</div>
            <div class="cronometro-timer" id="cronometro-jornada-${j.id}">--:--:--</div>
          </div>
          <div class="colaborador-activo-right">
            <button type="button" class="btn-finalizar-jornada" onclick="window.finalizarJornadaColaborador(${j.id})">
              <span>⏹️</span> Fin de Jornada
            </button>
          </div>
        </div>
      `;
    });

    // 4. Renderizar turnos completados en las últimas 12 horas (con tilde verde)
    completadas.forEach(c => {
      const fechaObj = new Date(c.fecha_ingreso);
      const hoy = new Date();
      const esHoy = fechaObj.toDateString() === hoy.toDateString();
      const fechaStr = esHoy 
        ? 'Hoy' 
        : fechaObj.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });

      const horaIngreso = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const horaEgreso = c.fecha_egreso 
        ? new Date(c.fecha_egreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) 
        : '--:--';

      const mins = parseInt(c.minutos_totales) || 0;
      const hs = Math.floor(mins / 60);
      const minsRest = mins % 60;
      const duracionStr = `${hs} hs ${minsRest} min`;
      const hsDecimales = parseFloat(c.horas_totales || 0).toFixed(2);

      html += `
        <div class="colaborador-card-completado" id="card-completada-${c.id}">
          <div class="colaborador-completado-left">
            <div class="status-completado-badge">
              <span>✔️</span> JORNADA COMPLETADA
            </div>
            <div class="colaborador-completado-nombre">${c.nombre_completo}</div>
            <div class="colaborador-completado-tiempos">
              📅 <strong>${fechaStr}</strong> | Ingreso: <strong>${horaIngreso} hs</strong> — Egreso: <strong>${horaEgreso} hs</strong>
              ${c.observacion_egreso ? `<span style="display:block; font-size: 0.82em; color: #64748b; margin-top: 2px;">💬 ${c.observacion_egreso}</span>` : ''}
            </div>
          </div>
          <div class="colaborador-completado-right">
            <div class="colaborador-completado-duracion">
              <div class="duracion-label">TIEMPO TRABAJADO</div>
              <div class="duracion-val">${duracionStr}</div>
              <div style="font-size: 0.8rem; color: #166534; font-weight: 600;">(${hsDecimales} hs)</div>
            </div>
            <div class="tilde-verde-circle" title="Jornada registrada correctamente">
              ✔️
            </div>
            <button type="button" class="btn-quitar-jornada-pizarra" onclick="window.quitarJornadaPizarra(${c.id}, ${mins})" title="Quitar de la pizarra">
              ✕
            </button>
          </div>
        </div>
      `;
    });

    html += '</div>';

    container.innerHTML = html;
    actualizarCronometrosColaboradoresLocal();
  } catch (error) {
    console.error('Error al actualizar widget de colaboradores:', error);
  }
}

/**
 * Permite descartar o eliminar una jornada completada directamente desde la pizarra
 */
window.quitarJornadaPizarra = async function(jornadaId, minutos) {
  try {
    let dismissedJornadas = [];
    try {
      dismissedJornadas = JSON.parse(localStorage.getItem('pizarra_dismissed_jornadas') || '[]');
    } catch(e){}
    dismissedJornadas.push(jornadaId);
    localStorage.setItem('pizarra_dismissed_jornadas', JSON.stringify(Array.from(new Set(dismissedJornadas))));

    // Si fue de 0 minutos o accidental, eliminarla físicamente de la base de datos
    if ((parseInt(minutos) || 0) === 0) {
      try {
        await fetch(`/api/colaboradores/jornadas/${jornadaId}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Error al eliminar jornada 0 hs de BD:', err);
      }
    }

    await actualizarWidgetColaboradoresPizarra();
    actualizarBotonLimpiarPizarra();
  } catch (err) {
    console.error('Error al quitar jornada de pizarra:', err);
  }
};

/**
 * Actualiza segundo a segundo los cronómetros de las jornadas activas en memoria
 */
function actualizarCronometrosColaboradoresLocal() {
  if (!jornadasActivasPizarra || jornadasActivasPizarra.length === 0) return;

  const ahora = Date.now();
  jornadasActivasPizarra.forEach(j => {
    const el = document.getElementById(`cronometro-jornada-${j.id}`);
    if (!el) return;

    const ms = ahora - new Date(j.fecha_ingreso).getTime();
    if (ms < 0) {
      el.textContent = '00:00:00';
      return;
    }

    const totalSegundos = Math.floor(ms / 1000);
    const horas = Math.floor(totalSegundos / 3600);
    const minutos = Math.floor((totalSegundos % 3600) / 60);
    const segundos = totalSegundos % 60;

    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${pad(horas)}:${pad(minutos)}:${pad(segundos)}`;
  });
}

/**
 * Abre modal SweetAlert2 para iniciar jornada de un colaborador
 */
window.abrirModalIniciarJornada = async function() {
  try {
    const res = await fetch('/api/colaboradores/jornadas/elegibles');
    if (!res.ok) throw new Error('No se pudo obtener la lista de colaboradores elegibles');
    const colaboradores = await res.json();

    if (colaboradores.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Sin colaboradores disponibles',
        text: 'No hay usuarios activos configurados con rol "Proveedor de servicios", "Colaborador" o con tarifario asignado.'
      });
      return;
    }

    // Filtrar los que ya están con jornada en curso
    const idsEnCurso = new Set(jornadasActivasPizarra.map(j => j.usuario_id));
    const disponibles = colaboradores.filter(c => !idsEnCurso.has(c.usuario_id));

    if (disponibles.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Todos los colaboradores activos',
        text: 'Todos los colaboradores disponibles ya tienen una jornada abierta en depósito.'
      });
      return;
    }

    // Generar opciones para el selector: únicamente el nombre del colaborador
    let optionsHtml = '';
    disponibles.forEach((c, idx) => {
      // Matías seleccionado por defecto si está en la lista
      const esMatias = c.usuario.toLowerCase().includes('matias') || c.nombre_completo.toLowerCase().includes('matias');
      const selected = (esMatias || idx === 0) ? 'selected' : '';
      optionsHtml += `<option value="${c.usuario_id}" ${selected}>${c.nombre_completo}</option>`;
    });

    const ahora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    const { value: formValues } = await Swal.fire({
      title: '⏱️ Inicio de Jornada',
      html: `
        <div style="text-align: left; font-size: 0.95em;">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Seleccionar:</label>
            <select id="swal-colaborador-id" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1;">
              ${optionsHtml}
            </select>
          </div>
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Hora de Ingreso:</label>
            <input type="text" value="${ahora} hs (Hora del sistema)" disabled style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #64748b; box-sizing: border-box;">
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Observación / Tarea (opcional):</label>
            <input id="swal-colaborador-obs" type="text" placeholder="Ej: Depósito central / fraccionamiento" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '🟢 Confirmar Ingreso',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
      preConfirm: () => {
        const uId = document.getElementById('swal-colaborador-id').value;
        const obs = document.getElementById('swal-colaborador-obs').value;
        if (!uId) {
          Swal.showValidationMessage('Debe seleccionar una persona');
          return false;
        }
        return { usuario_id: parseInt(uId), observacion_ingreso: obs };
      }
    });

    if (formValues) {
      Swal.showLoading();
      const resp = await fetch('/api/colaboradores/jornadas/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al iniciar jornada');
      }

      await actualizarWidgetColaboradoresPizarra();
      Swal.fire({
        icon: 'success',
        title: '¡Inicio de Jornada Registrado!',
        text: 'El tiempo se encuentra corriendo en vivo en la pizarra.',
        timer: 2000,
        showConfirmButton: false
      });
    }
  } catch (error) {
    console.error('Error en abrirModalIniciarJornada:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'No se pudo iniciar la jornada.'
    });
  }
};

/**
 * Abre modal SweetAlert2 para finalizar la jornada de un colaborador
 */
window.finalizarJornadaColaborador = async function(jornadaId) {
  const jornada = jornadasActivasPizarra.find(j => j.id === jornadaId);
  if (!jornada) return;

  const ms = Date.now() - new Date(jornada.fecha_ingreso).getTime();
  const horasTotales = Number((ms / 3600000).toFixed(2));
  const minutosTotales = Math.round(ms / 60000);
  const hsEnteras = Math.floor(minutosTotales / 60);
  const minsRestantes = minutosTotales % 60;
  const tiempoStr = `${hsEnteras} hs ${minsRestantes} min (${horasTotales} hs decimales)`;

  const valorHora = parseFloat(jornada.tarifa_hora_actual || 0);
  const montoEstimado = Number((horasTotales * valorHora).toFixed(2));

  const horaIngreso = new Date(jornada.fecha_ingreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const horaActual = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const { value: formValues } = await Swal.fire({
    title: '🔴 Fin de Jornada',
    html: `
      <div style="text-align: left; font-size: 0.95em;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 15px;">
          <div style="font-size: 1.15em; font-weight: bold; color: #1e293b; margin-bottom: 8px;">
            ${jornada.nombre_completo}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9em; color: #475569;">
            <div>🕒 Ingreso: <strong>${horaIngreso} hs</strong></div>
            <div>🏁 Egreso: <strong>${horaActual} hs</strong></div>
            <div>⏱️ Total: <strong>${tiempoStr}</strong></div>
            <div>💵 Tarifa: <strong>$${valorHora.toLocaleString('es-AR')}/h</strong></div>
          </div>
          <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 1.05em; font-weight: 700; color: #047857;">
            💰 Subtotal a liquidar: $${montoEstimado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Detalle / Observaciones de salida (opcional):</label>
          <textarea id="swal-obs-egreso" rows="3" placeholder="Tareas realizadas, novedades o notas..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box; font-family: inherit; font-size: 0.95em;"></textarea>
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '🔴 Confirmar Fin de Jornada',
    cancelButtonText: 'Continuar Trabajando',
    confirmButtonColor: '#dc2626',
    preConfirm: () => {
      const obs = document.getElementById('swal-obs-egreso').value;
      return { observacion_egreso: obs };
    }
  });

  if (formValues) {
    Swal.showLoading();
    try {
      const resp = await fetch(`/api/colaboradores/jornadas/${jornadaId}/cerrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al cerrar jornada');
      }

      await actualizarWidgetColaboradoresPizarra();
      Swal.fire({
        icon: 'success',
        title: '¡Fin de Jornada Registrado!',
        html: `Se registraron <strong>${tiempoStr}</strong> trabajadas por <strong>${jornada.nombre_completo}</strong>.<br><br>El registro quedó asentado y listo para su liquidación administrativa.`,
        confirmButtonText: 'Aceptar'
      });
    } catch (error) {
      console.error('Error al cerrar jornada:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'No se pudo cerrar la jornada.'
      });
    }
  }
};

// ═══════════════════════════════════════════════════════════
// MODAL DE LOGIN
// ═══════════════════════════════════════════════════════════

let loginManualMode = false;

// Funciones para el modal de login
async function abrirModalLogin() {
  document.getElementById('modal-login').classList.add('active');
  
  // Resetear al modo dropdown por defecto al abrir
  loginManualMode = false;
  const container = document.getElementById('container-usuario');
  const btn = document.getElementById('btn-toggle-login-mode');
  if (container && btn) {
    container.innerHTML = `
      <select id="usuario" required>
        <option value="" disabled selected>Cargando usuarios...</option>
      </select>
    `;
    btn.textContent = 'Ingresar manualmente';
  }
  
  await cargarUsuariosAdmin();
  document.getElementById('usuario').focus();
}

function cerrarModalLogin() {
  document.getElementById('modal-login').classList.remove('active');
  document.getElementById('form-login').reset();
  document.getElementById('mensaje-error').textContent = '';
}

// Función para alternar entre selector desplegable e ingreso manual de usuario
function toggleLoginMode() {
  const container = document.getElementById('container-usuario');
  const btn = document.getElementById('btn-toggle-login-mode');
  if (!container || !btn) return;
  
  loginManualMode = !loginManualMode;
  
  if (loginManualMode) {
    container.innerHTML = '<input type="text" id="usuario" required placeholder="Escriba su usuario">';
    btn.textContent = 'Seleccionar de la lista';
    document.getElementById('usuario').focus();
  } else {
    container.innerHTML = `
      <select id="usuario" required>
        <option value="" disabled selected>Cargando usuarios...</option>
      </select>
    `;
    btn.textContent = 'Ingresar manualmente';
    cargarUsuariosAdmin().then(() => {
      document.getElementById('usuario').focus();
    });
  }
}

// Carga dinámica de los usuarios con permiso de configuración en el dropdown
async function cargarUsuariosAdmin() {
  const usuarioSelect = document.getElementById('usuario');
  if (!usuarioSelect || loginManualMode) return;
  
  const currentVal = usuarioSelect.value;
  
  try {
    usuarioSelect.innerHTML = '<option value="" disabled selected>Cargando usuarios...</option>';
    
    // Obtener los usuarios que tienen permiso 'Configuracion'
    const res = await fetch('/api/usuarios/con-permiso/Configuracion');
    if (!res.ok) throw new Error('Error al obtener usuarios con permiso');
    
    const usuarios = await res.json();
    
    if (usuarios.length === 0) {
      usuarioSelect.innerHTML = '<option value="" disabled selected>Sin usuarios administrativos</option>';
      return;
    }
    
    usuarioSelect.innerHTML = '<option value="" disabled selected>Seleccione un usuario...</option>';
    usuarios.forEach(u => {
      const option = document.createElement('option');
      option.value = u.usuario; // Se envía el identificador del usuario para el login
      option.textContent = `${u.nombre_completo} (${u.usuario})`;
      usuarioSelect.appendChild(option);
    });
    
    // Si existía un valor previamente seleccionado y sigue disponible, restaurarlo
    if (currentVal && Array.from(usuarioSelect.options).some(o => o.value === currentVal)) {
      usuarioSelect.value = currentVal;
    }
  } catch (error) {
    console.error('Error al cargar usuarios administradores:', error);
    usuarioSelect.innerHTML = '<option value="" disabled selected>Error al cargar usuarios</option>';
  }
}

// Función para autenticar al usuario
async function autenticar(event) {
  event.preventDefault();
  const usuario = document.getElementById('usuario').value;
  const contraseña = document.getElementById('contraseña').value;
  const mensajeError = document.getElementById('mensaje-error');

  try {
    // Intentar autenticar
    const loginRes = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, contraseña })
    });

    const loginData = await loginRes.json();

    if (!loginRes.ok) {
      mensajeError.textContent = loginData.error || 'Error de autenticación';
      return false;
    }

    // Guardar el token de autenticación
    localStorage.setItem('token', loginData.token);

    // Obtener información del usuario autenticado
    const userRes = await fetch('/api/usuarios/me', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!userRes.ok) {
      mensajeError.textContent = 'Error al obtener información del usuario';
      return false;
    }

    const userData = await userRes.json();
    
    // Verificar si el usuario tiene el permiso de configuración
    const tienePermiso = userData.permisos.some(p => p.toLowerCase() === 'configuracion');
    
    if (tienePermiso) {
      // Redirigir a la página de administración
      window.location.href = 'pages/usuarios.html';
    } else {
      mensajeError.textContent = 'Acceso denegado: No tiene los permisos necesarios';
    }

  } catch (error) {
    console.error('Error:', error);
    mensajeError.textContent = 'Error de conexión';
  }

  return false;
}

// Cerrar modal y sidebar con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalLogin();
    closeSidebar();
  }
});

// Cerrar modal al hacer clic fuera
document.getElementById('modal-login').addEventListener('click', (e) => {
  if (e.target.id === 'modal-login') {
    cerrarModalLogin();
  }
});

// ═══════════════════════════════════════════════════════════
// LÓGICA DE MENÚ LATERAL (SIDEBAR DRAWER & ACCORDION)
// ═══════════════════════════════════════════════════════════

function openSidebar() {
  const drawer = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (drawer && overlay) {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
}

function closeSidebar() {
  const drawer = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (drawer && overlay) {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

function toggleBranch(headerElement) {
  const branchItem = headerElement.parentElement;
  if (branchItem) {
    branchItem.classList.toggle('expanded');
  }
}

// ═══════════════════════════════════════════════════════════
// GESTIÓN DE DEMANDA SATISFECHA (PIZARRA CENTRAL)
// ═══════════════════════════════════════════════════════════

/**
 * Abre modal interactivo SweetAlert2 para gestionar la demanda faltante con stock
 */
window.abrirModalGestionDemanda = function(id) {
  if (typeof window.abrirModalGestionDemandaOmnicanal === 'function') {
    return window.abrirModalGestionDemandaOmnicanal(id, () => {
      if (typeof window.actualizarPizarra === 'function') window.actualizarPizarra();
    });
  }

  const item = (window.demandaSatisfechaCache || []).find(it => it.id === id);
  if (!item) {
    if (typeof Swal !== 'undefined') {
      Swal.fire('Atención', 'No se encontró la información del artículo.', 'warning');
    }
    return;
  }

  const telDisplay = item.telefono || item.celular || 'No registrado';
  const whatsappHtml = item.whatsapp_url 
    ? `<a href="${item.whatsapp_url}" target="_blank" class="swal2-confirm swal2-styled" style="background-color: #25D366; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; font-weight: bold; padding: 8px 16px; margin: 5px;"><i class="fab fa-whatsapp"></i> Enviar WhatsApp</a>`
    : `<span style="font-size: 0.85em; color: #6b7280; display: block; margin: 6px 0;">(Sin número celular para WhatsApp directo)</span>`;

  const presLink = item.cliente_id
    ? `<a href="http://localhost:3003/pages/crear-presupuesto.html?cliente_id=${item.cliente_id}" target="_blank" class="swal2-confirm swal2-styled" style="background-color: #3b82f6; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; margin: 5px;">🧾 Nuevo Presupuesto</a>`
    : '';

  Swal.fire({
    title: '📦 Demanda Satisfecha con Stock',
    html: `
      <div style="text-align: left; font-size: 0.95rem; line-height: 1.6; color: #1f2937;">
        <p style="margin: 4px 0;"><strong>Artículo:</strong> ${item.descripcion}</p>
        <p style="margin: 4px 0;"><strong>Cantidad Solicitada:</strong> <span style="color: #dc2626; font-weight: bold;">${item.cantidad} un.</span></p>
        <p style="margin: 4px 0;"><strong>Disponibilidad:</strong> <span style="color: #16a34a; font-weight: bold;">${item.disponibilidad_texto}</span></p>
        <hr style="margin: 10px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="margin: 4px 0;"><strong>Cliente:</strong> ${item.cliente_nombre}</p>
        <p style="margin: 4px 0;"><strong>Contacto:</strong> ${telDisplay}</p>
        <p style="margin: 4px 0;"><strong>Presupuesto Origen:</strong> #${item.id_presupuesto_ext || item.id_presupuesto || 'N/A'}</p>
        <div style="margin-top: 15px; text-align: center;">
          ${whatsappHtml}
          ${presLink}
        </div>
      </div>
    `,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: '✔️ Marcar Cubierto',
    confirmButtonColor: '#16a34a',
    denyButtonText: '🗑️ Desestimar',
    denyButtonColor: '#dc2626',
    cancelButtonText: 'Cerrar',
    cancelButtonColor: '#6b7280'
  }).then(async (result) => {
    if (result.isConfirmed) {
      await window.marcarDemandaCubierta(id, false);
    } else if (result.isDenied) {
      await window.desestimarDemanda(id, false);
    }
  });
};

/**
 * Marca una demanda faltante como 'Cubierto' (ya se entregó al cliente)
 */
window.marcarDemandaCubierta = async function(id, pedirConfirmacion = true) {
  if (pedirConfirmacion) {
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
  }

  try {
    const res = await fetch(`/api/pizarra/demanda-faltantes/${id}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nuevoEstado: 'Cubierto', motivo: 'Marcado como cubierto desde Pizarra' })
    });
    if (res.ok) {
      const fila = document.getElementById(`demanda-fila-${id}`);
      if (fila) fila.remove();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: '✅ Demanda marcada como cubierta',
        showConfirmButton: false,
        timer: 2500
      });
      await actualizarAlertasPizarra();
    } else {
      throw new Error('Error en el servidor al actualizar');
    }
  } catch (err) {
    console.error('Error al marcar cubierto:', err);
    Swal.fire('Error', 'No se pudo actualizar el estado.', 'error');
  }
};

/**
 * Desestima/desecha una demanda faltante (cliente desistió o se canceló)
 */
window.desestimarDemanda = async function(id, pedirConfirmacion = true) {
  if (pedirConfirmacion) {
    const confirmacion = await Swal.fire({
      title: '¿Desestimar demanda?',
      text: 'El artículo saldrá de la lista de pendientes y alertas.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, desestimar',
      confirmButtonColor: '#dc2626',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmacion.isConfirmed) return;
  }

  try {
    const res = await fetch(`/api/pizarra/demanda-faltantes/${id}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nuevoEstado: 'Desestimado', motivo: 'Desestimado desde Pizarra' })
    });
    if (res.ok) {
      const fila = document.getElementById(`demanda-fila-${id}`);
      if (fila) fila.remove();

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: '🗑️ Demanda desestimada',
        showConfirmButton: false,
        timer: 2500
      });
      await actualizarAlertasPizarra();
    } else {
      throw new Error('Error en el servidor al desestimar');
    }
  } catch (err) {
    console.error('Error al desestimar:', err);
    Swal.fire('Error', 'No se pudo desestimar la demanda.', 'error');
  }
};

