(function () {
    'use strict';

    const STATE = {
        radarData: null,
        simulacionActual: null,
        tabActiva: 'listas_b2b',
        modo: 'RADAR', // 'RADAR' | 'DISPARADOR'
        tipoDisparador: 'INGREDIENTE', // 'INGREDIENTE' | 'ARTICULO_BUNKER'
        itemSeleccionado: null,
        calidadSeleccionadaId: null,
        incluirManualesIds: new Set(),
        ldnsSeleccionadas: new Set(['LDN_1', 'LDN_2', 'LDN_3', 'LDN_4', 'LDN_5', 'LDN_6', 'LDN_8']),
        listasSeleccionadas: new Set(),
        incluirCanalNodos: true,
        cargando: false
    };

    const LDN_LABELS = [
        { key: 'LDN_1', label: 'LDN 1 · Bulto Directo' },
        { key: 'LDN_2', label: 'LDN 2 · Fraccionados' },
        { key: 'LDN_3', label: 'LDN 3 · Mixes' },
        { key: 'LDN_4', label: 'LDN 4 · Tostaderos' },
        { key: 'LDN_5', label: 'LDN 5 · Barritas' },
        { key: 'LDN_6', label: 'LDN 6 · Granolas' },
        { key: 'LDN_8', label: 'LDN 8 · Combos' }
    ];

    function fmtMoney(n) {
        const val = Number(n || 0);
        return '$' + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function actualizarBadgeHeader(radar) {
        const btn = document.getElementById('btn-radar-costos-header');
        const badge = document.getElementById('radar-costos-badge');
        if (!btn || !badge) return;

        const desfases = Number(radar?.total_desfases || 0);
        const ceros = Number(radar?.alertas_costo_cero?.length || 0);
        if (desfases > 0) {
            badge.textContent = String(desfases);
            badge.style.background = ceros > 0 ? '#ef4444' : '#f59e0b';
            badge.style.color = '#0f172a';
            btn.style.borderColor = ceros > 0 ? 'rgba(239,68,68,0.6)' : 'rgba(245,158,11,0.6)';
            btn.title = `Radar de Costos: ${desfases} desfase(s) detectado(s) sin publicar (${ceros} rama(s) con costo $0)`;
        } else {
            badge.textContent = 'OK';
            badge.style.background = '#10b981';
            badge.style.color = '#062e22';
            btn.style.borderColor = 'rgba(16,185,129,0.5)';
            btn.title = 'Radar de Costos al día (0 desfases detectados)';
        }
    }

    async function cargarRadarEnSegundoPlano() {
        try {
            const resp = await fetch('/api/produccion/costos-grafo/radar');
            if (!resp.ok) return null;
            const data = await resp.json();
            STATE.radarData = data;
            if (STATE.listasSeleccionadas.size === 0 && Array.isArray(data?.selectores?.listas)) {
                data.selectores.listas.forEach(l => STATE.listasSeleccionadas.add(Number(l.id)));
            }
            actualizarBadgeHeader(data);
            return data;
        } catch (err) {
            console.warn('⚠️ [ConsolaCascada] Error consultando Radar:', err.message);
            return null;
        }
    }

    function asegurarModalDom() {
        let modal = document.getElementById('modal-consola-cascada');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'modal-consola-cascada';
        modal.style.cssText = [
            'display:none', 'position:fixed', 'inset:0', 'z-index:9999',
            'background:rgba(2,6,23,0.82)', 'backdrop-filter:blur(4px)',
            'padding:20px', 'overflow-y:auto', 'font-family:inherit'
        ].join(';');
        modal.innerHTML = `
          <div style="max-width:1180px;margin:0 auto;background:#0f172a;border:1px solid #334155;border-radius:14px;color:#f8fafc;box-shadow:0 24px 60px rgba(0,0,0,0.55);overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:#1e293b;border-bottom:1px solid #334155;gap:12px;flex-wrap:wrap;">
              <div>
                <h2 style="margin:0;font-size:1.12rem;display:flex;align-items:center;gap:8px;">
                  <span>🕸️ Consola Única de Impacto en Cascada & Radar</span>
                </h2>
                <div style="font-size:0.78rem;color:#94a3b8;margin-top:3px;">
                  Motor Determinista LDN 1–8 · Mayorista B2B + Canal Nodos (Escalón 1 y 2) · Protección MANUAL
                </div>
              </div>
              <button type="button" onclick="window.cerrarConsolaImpactoCascada()" style="background:#334155;color:#f8fafc;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:700;">✕ Cerrar</button>
            </div>
            <div id="consola-cascada-body" style="padding:18px 20px;"></div>
          </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function obtenerSelectores() {
        return STATE.radarData?.selectores || { ingredientes: [], articulos_bunker: [], listas: [] };
    }

    function filtrarItemsBusqueda(termRaw) {
        const selectores = obtenerSelectores();
        const tokens = String(termRaw || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        const lista = STATE.tipoDisparador === 'INGREDIENTE'
            ? (selectores.ingredientes || [])
            : (selectores.articulos_bunker || []);
        const filtrados = tokens.length === 0
            ? lista
            : lista.filter(it => {
                const hay = STATE.tipoDisparador === 'INGREDIENTE'
                    ? `[${it.id}] ${it.codigo || ''} ${it.nombre} ${it.rol_ingrediente || ''}`.toLowerCase()
                    : `${it.articulo_id} ${it.nombre || ''}`.toLowerCase();
                return tokens.every(t => hay.includes(t));
            });
        return filtrados.slice(0, 40);
    }

    function renderizarTablaSimulacion() {
        const sim = STATE.simulacionActual;
        if (!sim) {
            return `<div style="padding:20px;text-align:center;color:#94a3b8;background:#1e293b;border-radius:10px;">Seleccioná un modo y ejecutá <strong>Simular (Solo Lectura)</strong> para inspeccionar el impacto completo antes de aplicar.</div>`;
        }

        if (sim.requiere_seleccion_calidad) {
            const cands = sim.calidades_candidatas || [];
            return `
              <div style="padding:16px;border-radius:10px;border:1px solid #f59e0b;background:rgba(245,158,11,0.12);margin-bottom:14px;">
                <div style="font-weight:700;color:#fcd34d;margin-bottom:6px;">⚠️ Selección de Calidad Obligatoria (${esc(sim.articulo_id)})</div>
                <div style="font-size:0.84rem;color:#fef3c7;margin-bottom:10px;">${esc(sim.mensaje)}</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${cands.map(c => `
                    <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0f172a;border-radius:8px;border:1px solid ${Number(STATE.calidadSeleccionadaId) === Number(c.ingrediente_id) ? '#10b981' : '#334155'};cursor:pointer;">
                      <input type="radio" name="cascada-calidad-radio" value="${c.ingrediente_id}" ${Number(STATE.calidadSeleccionadaId) === Number(c.ingrediente_id) ? 'checked' : ''} onchange="window._consolaCascadaSetCalidad(${c.ingrediente_id})" />
                      <span><strong>[#${c.ingrediente_id}] ${esc(c.nombre)}</strong> — Costo actual: ${fmtMoney(c.costo_patron)} ${c.es_vinculo_costo_primario ? '<span style="color:#6ee7b7;font-size:0.75rem;">(Vínculo primario)</span>' : ''}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
            `;
        }

        const c = sim.cambios || {};
        const alertasZero = sim.alertas_costo_cero || [];
        const manuales = c.listas_manuales_omitidas || [];
        const res = sim.resumen || {};

        let banners = '';
        if (alertasZero.length > 0) {
            banners += `
              <div style="padding:10px 14px;border-radius:8px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.12);color:#fecaca;font-size:0.82rem;margin-bottom:10px;">
                <strong>🛑 Alertas Costo $0,00 (${alertasZero.length}):</strong>
                ${alertasZero.slice(0, 6).map(a => `${esc(a.sku)} (ing #${a.ingrediente_id} ${esc(a.nombre)} · ${esc(a.contexto)})`).join(' · ')}
              </div>
            `;
        }
        if (manuales.length > 0) {
            banners += `
              <div style="padding:10px 14px;border-radius:8px;border:1px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.10);color:#fde68a;font-size:0.82rem;margin-bottom:10px;">
                <strong>🔒 Listas MANUAL Protegidas (${manuales.length}):</strong> No se sobreescribirán automáticamente a menos que marques una fila explícitamente en la pestaña "Protegidas MANUAL".
              </div>
            `;
        }

        const tabs = [
            { id: 'listas_b2b', label: `Listas B2B (${(c.listas_b2b || []).length})` },
            { id: 'ofertas_nodos', label: `Ofertas Nodos Esc.2 (${(c.ofertas_nodos || []).length})` },
            { id: 'catalogo_nodos', label: `Catálogo Nodos Esc.1 (${(c.catalogo_nodos || []).length})` },
            { id: 'articulos', label: `Artículos Búnker (${(c.articulos || []).length})` },
            { id: 'ingredientes', label: `Ingredientes/Puentes (${(c.ingredientes || []).length})` },
            { id: 'manuales', label: `🔒 MANUAL (${manuales.length})` }
        ];

        let tablaHtml = '';
        const listData = STATE.tabActiva === 'manuales' ? manuales : (c[STATE.tabActiva] || []);
        if (listData.length === 0) {
            tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">Sin diferencias en esta categoría para los filtros seleccionados.</div>`;
        } else if (STATE.tabActiva === 'listas_b2b') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">LDN</th><th style="padding:7px;">Lista</th><th style="padding:7px;">SKU</th><th style="padding:7px;">Actual</th><th style="padding:7px;">Nuevo</th><th style="padding:7px;">Diff</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;">${esc(r.ldn || '-')}</td>
                      <td style="padding:6px;">${esc(r.lista_nombre || `L${r.lista_id}`)}</td>
                      <td style="padding:6px;"><strong>${esc(r.articulo_numero)}</strong></td>
                      <td style="padding:6px;">${fmtMoney(r.precio_actual)}</td>
                      <td style="padding:6px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.precio_nuevo)}</td>
                      <td style="padding:6px;color:${r.diff_precio >= 0 ? '#fca5a5' : '#6ee7b7'};">${r.diff_precio >= 0 ? '+' : ''}${fmtMoney(r.diff_precio)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        } else if (STATE.tabActiva === 'ofertas_nodos') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">Nodo</th><th style="padding:7px;">SKU</th><th style="padding:7px;">Base Nodo</th><th style="padding:7px;">Margen</th><th style="padding:7px;">Vecino Act → Nvo</th><th style="padding:7px;">Gan. Neta</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;">${esc(r.nodo_nombre)}</td>
                      <td style="padding:6px;"><strong>${esc(r.sku_nodo)}</strong></td>
                      <td style="padding:6px;">${fmtMoney(r.precio_base_nodo_snapshot_actual)} → ${fmtMoney(r.precio_base_nodo_snapshot_nuevo)}</td>
                      <td style="padding:6px;">${Number(r.margen_gestor_pct_preservado || 0).toFixed(1)}%</td>
                      <td style="padding:6px;font-weight:700;color:#93c5fd;">${fmtMoney(r.precio_venta_vecino_actual)} → ${fmtMoney(r.precio_venta_vecino_nuevo)}</td>
                      <td style="padding:6px;color:#6ee7b7;">${fmtMoney(r.ganancia_unitaria_gestor_nuevo)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        } else if (STATE.tabActiva === 'catalogo_nodos') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">SKU</th><th style="padding:7px;">Costo Puro Act → Nvo</th><th style="padding:7px;">Base Nodo Act → Nvo</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;"><strong>${esc(r.sku_nodo)}</strong></td>
                      <td style="padding:6px;">${fmtMoney(r.costo_puro_total_actual)} → ${fmtMoney(r.costo_puro_total_nuevo)}</td>
                      <td style="padding:6px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.precio_base_nodo_final_actual)} → ${fmtMoney(r.precio_base_nodo_final_nuevo)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        } else if (STATE.tabActiva === 'articulos') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">LDN</th><th style="padding:7px;">SKU</th><th style="padding:7px;">Costo Base Actual</th><th style="padding:7px;">Costo Base Nuevo</th><th style="padding:7px;">Diff</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;">${esc(r.ldn || '-')}</td>
                      <td style="padding:6px;"><strong>${esc(r.articulo_id)}</strong></td>
                      <td style="padding:6px;">${fmtMoney(r.costo_base_actual)}</td>
                      <td style="padding:6px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.costo_base_nuevo)}</td>
                      <td style="padding:6px;">${r.diff >= 0 ? '+' : ''}${fmtMoney(r.diff)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        } else if (STATE.tabActiva === 'ingredientes') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">ID</th><th style="padding:7px;">Nombre</th><th style="padding:7px;">Rol</th><th style="padding:7px;">Actual</th><th style="padding:7px;">Nuevo</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;">#${r.ingrediente_id}</td>
                      <td style="padding:6px;"><strong>${esc(r.nombre)}</strong></td>
                      <td style="padding:6px;">${esc(r.rol_ingrediente)}</td>
                      <td style="padding:6px;">${fmtMoney(r.costo_actual)}</td>
                      <td style="padding:6px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.costo_nuevo)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        } else if (STATE.tabActiva === 'manuales') {
            tablaHtml = `
              <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;">
                  <th style="padding:7px;">Sobreescribir</th><th style="padding:7px;">Lista</th><th style="padding:7px;">SKU</th><th style="padding:7px;">Precio MANUAL</th><th style="padding:7px;">Sugerido Fórmula</th>
                </tr></thead>
                <tbody>
                  ${listData.slice(0, 150).map(r => `
                    <tr style="border-top:1px solid #334155;">
                      <td style="padding:6px;"><input type="checkbox" ${STATE.incluirManualesIds.has(Number(r.lista_articulo_id)) ? 'checked' : ''} onchange="window._consolaCascadaToggleManual(${r.lista_articulo_id}, this.checked)" /></td>
                      <td style="padding:6px;">${esc(r.lista_nombre)}</td>
                      <td style="padding:6px;"><strong>${esc(r.articulo_numero)}</strong></td>
                      <td style="padding:6px;color:#fcd34d;font-weight:700;">${fmtMoney(r.precio_actual)}</td>
                      <td style="padding:6px;">${fmtMoney(r.precio_sugerido_formula)} (${r.diff_teorica >= 0 ? '+' : ''}${fmtMoney(r.diff_teorica)})</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `;
        }

        return `
          ${banners}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:0.78rem;">
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Ingredientes: <strong>${res.ingredientes_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Artículos: <strong>${res.articulos_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Listas B2B: <strong>${res.listas_modificadas || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Catálogo Nodos: <strong>${res.catalogo_nodos_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Ofertas Nodos: <strong>${res.ofertas_nodos_modificadas || 0}</strong></span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            ${tabs.map(t => `
              <button type="button" onclick="window._consolaCascadaSetTab('${t.id}')" style="padding:6px 11px;border-radius:8px;border:1px solid ${STATE.tabActiva === t.id ? '#38bdf8' : '#334155'};background:${STATE.tabActiva === t.id ? 'rgba(56,189,248,0.18)' : '#1e293b'};color:#f8fafc;cursor:pointer;font-size:0.78rem;font-weight:600;">${esc(t.label)}</button>
            `).join('')}
          </div>
          <div style="max-height:330px;overflow:auto;border:1px solid #334155;border-radius:10px;background:#0b1120;">
            ${tablaHtml}
          </div>
        `;
    }

    function renderizarModal() {
        const body = document.getElementById('consola-cascada-body');
        if (!body) return;
        const selectores = obtenerSelectores();
        const listasAll = selectores.listas || [];
        const searchTerm = document.getElementById('cascada-search-input')?.value || '';
        const newCostVal = document.getElementById('cascada-nuevo-costo-input')?.value || '';
        const candidatos = filtrarItemsBusqueda(searchTerm);

        body.innerHTML = `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <button type="button" onclick="window._consolaCascadaSetModo('RADAR')" style="padding:8px 14px;border-radius:8px;border:1px solid ${STATE.modo === 'RADAR' ? '#f59e0b' : '#334155'};background:${STATE.modo === 'RADAR' ? 'rgba(245,158,11,0.18)' : '#1e293b'};color:#f8fafc;font-weight:700;cursor:pointer;">📡 Radar Global (Desfases Pendientes)</button>
            <button type="button" onclick="window._consolaCascadaSetModo('DISPARADOR')" style="padding:8px 14px;border-radius:8px;border:1px solid ${STATE.modo === 'DISPARADOR' ? '#10b981' : '#334155'};background:${STATE.modo === 'DISPARADOR' ? 'rgba(16,185,129,0.18)' : '#1e293b'};color:#f8fafc;font-weight:700;cursor:pointer;">⚡ Simular Cambio de Costo Puntual</button>
          </div>

          ${STATE.modo === 'DISPARADOR' ? `
            <div style="padding:14px;background:#1e293b;border:1px solid #334155;border-radius:10px;margin-bottom:14px;">
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
                <select id="cascada-tipo-disparador" onchange="window._consolaCascadaSetTipo(this.value)" style="background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:7px 10px;">
                  <option value="INGREDIENTE" ${STATE.tipoDisparador === 'INGREDIENTE' ? 'selected' : ''}>Ingrediente / Puente (por kg)</option>
                  <option value="ARTICULO_BUNKER" ${STATE.tipoDisparador === 'ARTICULO_BUNKER' ? 'selected' : ''}>Bulto / Artículo Búnker (LDN 1)</option>
                </select>
                <input id="cascada-search-input" type="text" value="${esc(searchTerm)}" oninput="window._consolaCascadaRefrescarLista()" placeholder="Buscar por código, ID o nombre (palabras separadas)..." style="flex:1;min-width:220px;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:7px 10px;" />
                <input id="cascada-nuevo-costo-input" type="number" step="0.01" min="0" value="${esc(newCostVal)}" placeholder="Nuevo costo ($)" style="width:160px;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:7px 10px;" />
              </div>
              <div id="cascada-search-results" style="max-height:135px;overflow-y:auto;border:1px solid #334155;border-radius:8px;background:#0f172a;">
                ${candidatos.map(it => {
                    const idKey = STATE.tipoDisparador === 'INGREDIENTE' ? String(it.id) : String(it.articulo_id);
                    const sel = STATE.itemSeleccionado && String(STATE.itemSeleccionado.key) === idKey;
                    const label = STATE.tipoDisparador === 'INGREDIENTE'
                        ? `[#${it.id}] ${esc(it.nombre)} (${esc(it.rol_ingrediente)}) · ${fmtMoney(it.costo_patron)}`
                        : `[${esc(it.articulo_id)}] ${esc(it.nombre)} · Base ${fmtMoney(it.costo_base)}`;
                    return `<div onclick="window._consolaCascadaElegir('${esc(idKey)}', ${Number(it.costo_patron ?? it.costo_base ?? 0)})" style="padding:6px 10px;cursor:pointer;font-size:0.80rem;border-bottom:1px solid #1e293b;background:${sel ? 'rgba(16,185,129,0.22)' : 'transparent'};">${label}</div>`;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div style="padding:10px 12px;background:#1e293b;border-radius:10px;border:1px solid #334155;">
              <div style="font-size:0.78rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;">Líneas de Negocio (LDN) a incluir:</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.76rem;">
                ${LDN_LABELS.map(l => `
                  <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="checkbox" ${STATE.ldnsSeleccionadas.has(l.key) ? 'checked' : ''} onchange="window._consolaCascadaToggleLdn('${l.key}', this.checked)" />
                    <span>${esc(l.label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
            <div style="padding:10px 12px;background:#1e293b;border-radius:10px;border:1px solid #334155;">
              <div style="font-size:0.78rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;">Listas B2B & Canal Nodos a actualizar:</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.76rem;">
                ${listasAll.map(lp => `
                  <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="checkbox" ${STATE.listasSeleccionadas.has(Number(lp.id)) ? 'checked' : ''} onchange="window._consolaCascadaToggleLista(${lp.id}, this.checked)" />
                    <span>${esc(lp.nombre)}</span>
                  </label>
                `).join('')}
                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#6ee7b7;font-weight:700;">
                  <input type="checkbox" ${STATE.incluirCanalNodos ? 'checked' : ''} onchange="window._consolaCascadaToggleCanalNodos(this.checked)" />
                  <span>🏘️ Canal Nodos (Esc.1+2)</span>
                </label>
              </div>
            </div>
          </div>

          <div id="consola-cascada-preview">${renderizarTablaSimulacion()}</div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap;">
            <div id="consola-cascada-status" style="font-size:0.82rem;color:#94a3b8;">${STATE.cargando ? '⏳ Procesando grafo de costos...' : 'Modo seguro: simulá antes de aplicar.'}</div>
            <div style="display:flex;gap:10px;">
              <button type="button" onclick="window._consolaCascadaSimular()" ${STATE.cargando ? 'disabled' : ''} style="padding:9px 16px;border-radius:8px;border:1px solid #38bdf8;background:#0284c7;color:#fff;font-weight:700;cursor:pointer;">🔍 Simular Cascada (Solo Lectura)</button>
              <button type="button" onclick="window._consolaCascadaAplicar()" ${STATE.cargando ? 'disabled' : ''} style="padding:9px 16px;border-radius:8px;border:none;background:#10b981;color:#062e22;font-weight:800;cursor:pointer;">✅ Aplicar Selección Atómicamente</button>
            </div>
          </div>
        `;
    }

    function construirPayload() {
        let disparador;
        if (STATE.modo === 'RADAR') {
            disparador = { tipo: 'FULL_GRAPH' };
        } else if (!STATE.itemSeleccionado) {
            throw new Error('Seleccioná primero un ingrediente o bulto para simular.');
        } else {
            const rawCosto = document.getElementById('cascada-nuevo-costo-input')?.value;
            const costoNum = Number(rawCosto);
            if (!Number.isFinite(costoNum) || costoNum < 0) {
                throw new Error('Ingresá un costo numérico válido mayor o igual a 0.');
            }
            if (STATE.tipoDisparador === 'INGREDIENTE') {
                disparador = {
                    tipo: 'INGREDIENTE',
                    ingrediente_id: Number(STATE.itemSeleccionado.key),
                    nuevo_costo_patron: costoNum
                };
            } else {
                disparador = {
                    tipo: 'ARTICULO_BUNKER',
                    articulo_id: String(STATE.itemSeleccionado.key),
                    nuevo_costo_base: costoNum,
                    ingrediente_calidad_id: STATE.calidadSeleccionadaId ? Number(STATE.calidadSeleccionadaId) : undefined
                };
            }
        }
        return {
            disparador,
            filtros: {
                ldns_seleccionadas: Array.from(STATE.ldnsSeleccionadas),
                listas_seleccionadas: Array.from(STATE.listasSeleccionadas),
                incluir_canal_nodos: STATE.incluirCanalNodos,
                incluir_manuales_ids: Array.from(STATE.incluirManualesIds)
            }
        };
    }

    async function simularActual() {
        try {
            const payload = construirPayload();
            STATE.cargando = true;
            renderizarModal();
            const resp = await fetch('/api/produccion/costos-grafo/simular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok && !data.requiere_seleccion_calidad) {
                throw new Error(data.error || 'Error simulando cascada.');
            }
            STATE.simulacionActual = data;
            STATE.cargando = false;
            renderizarModal();
        } catch (err) {
            STATE.cargando = false;
            renderizarModal();
            const st = document.getElementById('consola-cascada-status');
            if (st) st.innerHTML = `<span style="color:#fca5a5;">❌ ${esc(err.message)}</span>`;
        }
    }

    async function aplicarActual() {
        try {
            const payload = construirPayload();
            const msgConf = STATE.modo === 'RADAR'
                ? '¿Aplicar atómicamente los desfases filtrados del Radar (Listas B2B + Canal Nodos, respetando filas MANUAL)?'
                : '¿Aplicar esta variación de costo en cascada sobre las LDNs, Listas B2B y Canal Nodos seleccionados?';
            if (!window.confirm(msgConf)) return;

            STATE.cargando = true;
            renderizarModal();
            const resp = await fetch('/api/produccion/costos-grafo/aplicar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || 'No se pudo aplicar la cascada.');
            }
            STATE.cargando = false;
            await cargarRadarEnSegundoPlano();
            STATE.simulacionActual = STATE.radarData ? {
                ok: true,
                cambios: STATE.radarData.divergencias,
                resumen: STATE.radarData.resumen,
                alertas_costo_cero: STATE.radarData.alertas_costo_cero
            } : null;
            renderizarModal();
            const st = document.getElementById('consola-cascada-status');
            if (st) {
                const r = data.resumen || {};
                st.innerHTML = `<span style="color:#6ee7b7;font-weight:700;">✅ Aplicado: ${r.listas_modificadas || 0} listas B2B (${r.cambios_mayoristas_historial || 0} historial / ${r.notificaciones_clientes_pendientes || 0} alertas clientes) · ${r.ofertas_nodos_modificadas || 0} ofertas Nodos.</span>`;
            }
        } catch (err) {
            STATE.cargando = false;
            renderizarModal();
            const st = document.getElementById('consola-cascada-status');
            if (st) st.innerHTML = `<span style="color:#fca5a5;">❌ ${esc(err.message)}</span>`;
        }
    }

    window.abrirConsolaImpactoCascada = async function () {
        const modal = asegurarModalDom();
        modal.style.display = 'block';
        STATE.cargando = true;
        renderizarModal();
        const radar = await cargarRadarEnSegundoPlano();
        STATE.cargando = false;
        if (radar && STATE.modo === 'RADAR') {
            STATE.simulacionActual = {
                ok: true,
                cambios: radar.divergencias,
                resumen: radar.resumen,
                alertas_costo_cero: radar.alertas_costo_cero
            };
        }
        renderizarModal();
    };

    window.cerrarConsolaImpactoCascada = function () {
        const modal = document.getElementById('modal-consola-cascada');
        if (modal) modal.style.display = 'none';
    };

    window._consolaCascadaSetModo = function (m) {
        STATE.modo = m;
        STATE.simulacionActual = (m === 'RADAR' && STATE.radarData)
            ? { ok: true, cambios: STATE.radarData.divergencias, resumen: STATE.radarData.resumen, alertas_costo_cero: STATE.radarData.alertas_costo_cero }
            : null;
        renderizarModal();
    };
    window._consolaCascadaSetTipo = function (t) {
        STATE.tipoDisparador = t;
        STATE.itemSeleccionado = null;
        STATE.calidadSeleccionadaId = null;
        renderizarModal();
    };
    window._consolaCascadaRefrescarLista = function () {
        const container = document.getElementById('cascada-search-results');
        if (!container) return;
        const term = document.getElementById('cascada-search-input')?.value || '';
        const candidatos = filtrarItemsBusqueda(term);
        container.innerHTML = candidatos.map(it => {
            const idKey = STATE.tipoDisparador === 'INGREDIENTE' ? String(it.id) : String(it.articulo_id);
            const sel = STATE.itemSeleccionado && String(STATE.itemSeleccionado.key) === idKey;
            const label = STATE.tipoDisparador === 'INGREDIENTE'
                ? `[#${it.id}] ${esc(it.nombre)} (${esc(it.rol_ingrediente)}) · ${fmtMoney(it.costo_patron)}`
                : `[${esc(it.articulo_id)}] ${esc(it.nombre)} · Base ${fmtMoney(it.costo_base)}`;
            return `<div onclick="window._consolaCascadaElegir('${esc(idKey)}', ${Number(it.costo_patron ?? it.costo_base ?? 0)})" style="padding:6px 10px;cursor:pointer;font-size:0.80rem;border-bottom:1px solid #1e293b;background:${sel ? 'rgba(16,185,129,0.22)' : 'transparent'};">${label}</div>`;
        }).join('');
    };
    window._consolaCascadaElegir = function (key, costoActual) {
        STATE.itemSeleccionado = { key };
        STATE.calidadSeleccionadaId = null;
        renderizarModal();
        const inp = document.getElementById('cascada-nuevo-costo-input');
        if (inp) inp.value = String(costoActual || 0);
    };
    window._consolaCascadaSetCalidad = function (ingId) {
        STATE.calidadSeleccionadaId = Number(ingId);
        simularActual();
    };
    window._consolaCascadaSetTab = function (tabId) {
        STATE.tabActiva = tabId;
        const pv = document.getElementById('consola-cascada-preview');
        if (pv) pv.innerHTML = renderizarTablaSimulacion();
    };
    window._consolaCascadaToggleLdn = function (k, checked) {
        if (checked) STATE.ldnsSeleccionadas.add(k);
        else STATE.ldnsSeleccionadas.delete(k);
    };
    window._consolaCascadaToggleLista = function (id, checked) {
        if (checked) STATE.listasSeleccionadas.add(Number(id));
        else STATE.listasSeleccionadas.delete(Number(id));
    };
    window._consolaCascadaToggleCanalNodos = function (checked) {
        STATE.incluirCanalNodos = Boolean(checked);
    };
    window._consolaCascadaToggleManual = function (id, checked) {
        if (checked) STATE.incluirManualesIds.add(Number(id));
        else STATE.incluirManualesIds.delete(Number(id));
    };
    window._consolaCascadaSimular = simularActual;
    window._consolaCascadaAplicar = aplicarActual;

    document.addEventListener('DOMContentLoaded', () => {
        cargarRadarEnSegundoPlano();
    });
})();
