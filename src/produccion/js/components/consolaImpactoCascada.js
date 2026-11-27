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
        listasSeleccionadas: new Set(), // Solo Listas Mayoristas B2B (canal_comercial !== 'NODOS')
        listasInicializadas: false,
        incluirCanalNodos: true,
        filtroListaB2BId: '',
        filtroBusquedaArticulo: '',
        mostrarMicroDiferencias: false,
        skusExcluidos: new Set(),
        skusExpandidos: new Set(),
        cargando: false
    };

    const LDN_LABELS = [
        { key: 'LDN_1', corto: 'LDN 1', label: 'LDN 1 · Bulto Directo' },
        { key: 'LDN_2', corto: 'LDN 2', label: 'LDN 2 · Fraccionados' },
        { key: 'LDN_3', corto: 'LDN 3', label: 'LDN 3 · Mixes' },
        { key: 'LDN_4', corto: 'LDN 4', label: 'LDN 4 · Tostaderos' },
        { key: 'LDN_5', corto: 'LDN 5', label: 'LDN 5 · Barritas' },
        { key: 'LDN_6', corto: 'LDN 6', label: 'LDN 6 · Granolas' },
        { key: 'LDN_8', corto: 'LDN 8', label: 'LDN 8 · Combos' }
    ];

    const LDN_BADGE_MAP = {
        LDN_1: 'LDN 1',
        LDN_2: 'LDN 2',
        LDN_3: 'LDN 3',
        LDN_4: 'LDN 4',
        LDN_5: 'LDN 5',
        LDN_6: 'LDN 6',
        LDN_8: 'LDN 8'
    };

    function fmtMoney(n) {
        const val = Number(n || 0);
        return '$' + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtDiff(n) {
        const val = Number(n || 0);
        return (val >= 0 ? '+' : '') + fmtMoney(val);
    }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normSkuJs(s) {
        return String(s || '').trim().toUpperCase();
    }

    function obtenerListasMayoristas() {
        const all = STATE.radarData?.selectores?.listas || [];
        return all.filter(l => String(l.canal_comercial || 'MAYORISTA').toUpperCase() !== 'NODOS');
    }

    function renderCeldaArticulo(descripcion, sku, ldn) {
        const nom = String(descripcion || '').trim() || String(sku || '-');
        const cod = String(sku || '').trim();
        const ldnTxt = LDN_BADGE_MAP[ldn] || (ldn ? String(ldn).replace('_', ' ') : '');
        return `
          <div style="display:flex;flex-direction:column;gap:2px;">
            <strong style="color:#f8fafc;font-size:0.82rem;line-height:1.25;">${esc(nom)}</strong>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
              ${cod ? `<span style="font-family:monospace;font-size:0.69rem;padding:1px 6px;border-radius:4px;background:#1e293b;border:1px solid #334155;color:#cbd5e1;">${esc(cod)}</span>` : ''}
              ${ldnTxt ? `<span style="font-size:0.67rem;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.14);border:1px solid rgba(56,189,248,0.3);color:#bae6fd;font-weight:700;">${esc(ldnTxt)}</span>` : ''}
            </div>
          </div>
        `;
    }

    function calcularResumenMayoristaVisible(sim) {
        const todas = (sim?.cambios?.listas_b2b || []).filter(
            r => String(r.canal_comercial || 'MAYORISTA').toUpperCase() !== 'NODOS'
        );
        const microOcultas = todas.filter(r => Math.abs(Number(r.diff_precio || 0)) <= 1.0).length;
        const visibles = STATE.mostrarMicroDiferencias
            ? todas
            : todas.filter(r => Math.abs(Number(r.diff_precio || 0)) > 1.0);
        return { todas, visibles, microOcultas };
    }

    function agruparListasPorArticulo(filas) {
        const mapa = new Map();
        for (const r of filas) {
            const skuKey = normSkuJs(r.articulo_numero);
            if (!skuKey) continue;
            if (!mapa.has(skuKey)) {
                mapa.set(skuKey, {
                    sku_key: skuKey,
                    sku: r.articulo_numero,
                    descripcion_generada: r.descripcion_generada || r.articulo_numero,
                    ldn: r.ldn || '',
                    items: []
                });
            }
            mapa.get(skuKey).items.push(r);
        }
        return Array.from(mapa.values());
    }

    function pasaFiltroTextoGrupo(textoBase, sku, ldn) {
        const tokens = String(STATE.filtroBusquedaArticulo || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return true;
        const bolsa = `${textoBase || ''} ${sku || ''} ${ldn || ''}`.toLowerCase();
        return tokens.every(t => bolsa.includes(t));
    }

    function obtenerSkusUnicosVisibles(sim) {
        const c = sim?.cambios || {};
        const set = new Set();
        const { visibles } = calcularResumenMayoristaVisible(sim);
        visibles.forEach(r => set.add(normSkuJs(r.articulo_numero)));
        (c.catalogo_nodos || []).forEach(r => set.add(normSkuJs(r.sku_nodo)));
        (c.ofertas_nodos || []).forEach(r => set.add(normSkuJs(r.sku_nodo)));
        (c.articulos || []).forEach(r => set.add(normSkuJs(r.articulo_id)));
        return set;
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
            if (!STATE.listasInicializadas && Array.isArray(data?.selectores?.listas)) {
                STATE.listasSeleccionadas.clear();
                obtenerListasMayoristas().forEach(l => STATE.listasSeleccionadas.add(Number(l.id)));
                STATE.listasInicializadas = true;
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
            'background:rgba(2,6,23,0.84)', 'backdrop-filter:blur(4px)',
            'padding:18px', 'overflow-y:auto', 'font-family:inherit'
        ].join(';');
        modal.innerHTML = `
          <div style="max-width:1240px;margin:0 auto;background:#0f172a;border:1px solid #334155;border-radius:14px;color:#f8fafc;box-shadow:0 24px 60px rgba(0,0,0,0.55);overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:15px 20px;background:#1e293b;border-bottom:1px solid #334155;gap:12px;flex-wrap:wrap;">
              <div>
                <h2 style="margin:0;font-size:1.12rem;display:flex;align-items:center;gap:8px;">
                  <span>🕸️ Radar de Costos y Actualización de Precios</span>
                </h2>
                <div style="font-size:0.78rem;color:#94a3b8;margin-top:3px;">
                  Mayorista B2B + Canal Nodos (Precio Base LAMDA y Tiendas) · Protección automática de Precios Manuales
                </div>
              </div>
              <button type="button" onclick="window.cerrarConsolaImpactoCascada()" style="background:#334155;color:#f8fafc;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:700;">✕ Cerrar</button>
            </div>
            <div id="consola-cascada-body" style="padding:16px 20px;"></div>
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
                    : `${it.nombre || ''} ${it.articulo_id}`.toLowerCase();
                return tokens.every(t => hay.includes(t));
            });
        return filtrados.slice(0, 40);
    }

    function renderizarSoloTablaActiva() {
        const sim = STATE.simulacionActual;
        const container = document.getElementById('consola-cascada-tabla-scroll');
        if (!sim || !container) return;

        const c = sim.cambios || {};
        const manuales = c.listas_manuales_omitidas || [];
        let tablaHtml = '';

        if (STATE.tabActiva === 'listas_b2b') {
            const { visibles, microOcultas } = calcularResumenMayoristaVisible(sim);
            let filasFiltradas = visibles;
            if (STATE.filtroListaB2BId) {
                const lidTarget = Number(STATE.filtroListaB2BId);
                filasFiltradas = filasFiltradas.filter(r => Number(r.lista_id) === lidTarget);
            }
            const grupos = agruparListasPorArticulo(filasFiltradas).filter(g =>
                pasaFiltroTextoGrupo(g.descripcion_generada, g.sku, g.ldn)
            );

            const infoMicroEl = document.getElementById('radar-b2b-micro-info');
            if (infoMicroEl) {
                infoMicroEl.textContent = microOcultas > 0
                    ? `(${microOcultas} ajustes menores a $1 ocultos)`
                    : '(sin ajustes menores a $1)';
            }

            if (grupos.length === 0) {
                tablaHtml = `<div style="padding:20px;text-align:center;color:#94a3b8;">Sin diferencias en Listas Mayoristas B2B para los filtros seleccionados.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;z-index:2;">
                      <th style="padding:8px;width:34px;">Sel.</th>
                      <th style="padding:8px;min-width:250px;">Artículo</th>
                      <th style="padding:8px;">Listas afectadas (Actual → Nuevo)</th>
                      <th style="padding:8px;width:125px;text-align:right;">Detalle</th>
                    </tr></thead>
                    <tbody>
                      ${grupos.slice(0, 150).map(g => {
                          const incluido = !STATE.skusExcluidos.has(g.sku_key);
                          const expandido = STATE.skusExpandidos.has(g.sku_key);
                          const chipsHtml = g.items.map(it => {
                              const sube = Number(it.diff_precio) >= 0;
                              const colorDiff = sube ? '#fca5a5' : '#6ee7b7';
                              return `
                                <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:#1e293b;border:1px solid #334155;font-size:0.74rem;line-height:1.25;">
                                  <strong style="color:#e2e8f0;">${esc(it.lista_nombre || `Lista ${it.lista_id}`)}:</strong>
                                  <span style="color:#94a3b8;">${fmtMoney(it.precio_actual)}</span>
                                  <span style="color:#64748b;">→</span>
                                  <strong style="color:#6ee7b7;">${fmtMoney(it.precio_nuevo)}</strong>
                                  <span style="color:${colorDiff};font-weight:700;">(${fmtDiff(it.diff_precio)})</span>
                                </span>
                              `;
                          }).join('');

                          const detalleRow = expandido ? `
                            <tr style="background:#0f172a;">
                              <td></td>
                              <td colspan="3" style="padding:6px 10px 10px 10px;">
                                <table style="width:100%;border-collapse:collapse;font-size:0.76rem;border:1px solid #334155;border-radius:6px;overflow:hidden;">
                                  <thead><tr style="background:#1e293b;color:#94a3b8;text-align:left;">
                                    <th style="padding:5px 8px;">Lista Mayorista</th>
                                    <th style="padding:5px 8px;">Precio Actual</th>
                                    <th style="padding:5px 8px;">Precio Nuevo</th>
                                    <th style="padding:5px 8px;">Diferencia</th>
                                  </tr></thead>
                                  <tbody>
                                    ${g.items.map(it => `
                                      <tr style="border-top:1px solid #1e293b;">
                                        <td style="padding:5px 8px;color:#e2e8f0;font-weight:600;">${esc(it.lista_nombre || `Lista ${it.lista_id}`)}</td>
                                        <td style="padding:5px 8px;color:#94a3b8;">${fmtMoney(it.precio_actual)}</td>
                                        <td style="padding:5px 8px;color:#6ee7b7;font-weight:700;">${fmtMoney(it.precio_nuevo)}</td>
                                        <td style="padding:5px 8px;color:${it.diff_precio >= 0 ? '#fca5a5' : '#6ee7b7'};font-weight:700;">${fmtDiff(it.diff_precio)}</td>
                                      </tr>
                                    `).join('')}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ` : '';

                          return `
                            <tr style="border-top:1px solid #334155;opacity:${incluido ? '1' : '0.45'};">
                              <td style="padding:8px;vertical-align:top;">
                                <input type="checkbox" ${incluido ? 'checked' : ''} onchange="window._consolaCascadaToggleSku('${esc(g.sku_key)}', this.checked)" title="Incluir o excluir este artículo al impactar precios" />
                              </td>
                              <td style="padding:8px;vertical-align:top;">${renderCeldaArticulo(g.descripcion_generada, g.sku, g.ldn)}</td>
                              <td style="padding:8px;vertical-align:top;">
                                <div style="display:flex;flex-wrap:wrap;gap:5px;">${chipsHtml}</div>
                              </td>
                              <td style="padding:8px;vertical-align:top;text-align:right;">
                                <button type="button" onclick="window._consolaCascadaToggleExpandSku('${esc(g.sku_key)}')" style="padding:4px 8px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;cursor:pointer;font-size:0.72rem;white-space:nowrap;">
                                  ${expandido ? '▾ Ocultar' : `▸ Detalle (${g.items.length})`}
                                </button>
                              </td>
                            </tr>
                            ${detalleRow}
                          `;
                      }).join('')}
                    </tbody>
                  </table>
                `;
            }
        } else if (STATE.tabActiva === 'ofertas_nodos') {
            const listData = c.ofertas_nodos || [];
            if (listData.length === 0) {
                tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">Sin cambios pendientes en Ofertas en Tiendas de Nodos.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;">
                      <th style="padding:7px;width:34px;">Sel.</th>
                      <th style="padding:7px;">Nodo</th>
                      <th style="padding:7px;">Artículo</th>
                      <th style="padding:7px;">Base LAMDA → Nodo</th>
                      <th style="padding:7px;">Margen Nodo</th>
                      <th style="padding:7px;">Precio Vecino (Act → Nvo)</th>
                      <th style="padding:7px;">Gan. Neta Gestor</th>
                    </tr></thead>
                    <tbody>
                      ${listData.slice(0, 150).map(r => {
                          const skuKey = normSkuJs(r.sku_nodo);
                          const incluido = !STATE.skusExcluidos.has(skuKey);
                          return `
                            <tr style="border-top:1px solid #334155;opacity:${incluido ? '1' : '0.45'};">
                              <td style="padding:7px;"><input type="checkbox" ${incluido ? 'checked' : ''} onchange="window._consolaCascadaToggleSku('${esc(skuKey)}', this.checked)" /></td>
                              <td style="padding:7px;font-weight:700;color:#e2e8f0;">${esc(r.nodo_nombre)}</td>
                              <td style="padding:7px;">${renderCeldaArticulo(r.descripcion_generada, r.sku_nodo, r.ldn)}</td>
                              <td style="padding:7px;">${fmtMoney(r.precio_base_nodo_snapshot_actual)} → <strong style="color:#e2e8f0;">${fmtMoney(r.precio_base_nodo_snapshot_nuevo)}</strong></td>
                              <td style="padding:7px;">${Number(r.margen_gestor_pct_preservado || 0).toFixed(1)}%</td>
                              <td style="padding:7px;font-weight:700;color:#93c5fd;">${fmtMoney(r.precio_venta_vecino_actual)} → ${fmtMoney(r.precio_venta_vecino_nuevo)}</td>
                              <td style="padding:7px;color:#6ee7b7;font-weight:700;">${fmtMoney(r.ganancia_unitaria_gestor_nuevo)}</td>
                            </tr>
                          `;
                      }).join('')}
                    </tbody>
                  </table>
                `;
            }
        } else if (STATE.tabActiva === 'catalogo_nodos') {
            const listData = c.catalogo_nodos || [];
            if (listData.length === 0) {
                tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">Sin cambios pendientes en Precio Base LAMDA → Nodo.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;">
                      <th style="padding:7px;width:34px;">Sel.</th>
                      <th style="padding:7px;">Artículo</th>
                      <th style="padding:7px;">Costo Puro (Act → Nvo)</th>
                      <th style="padding:7px;">Precio Base LAMDA → Nodo (Act → Nvo)</th>
                    </tr></thead>
                    <tbody>
                      ${listData.slice(0, 150).map(r => {
                          const skuKey = normSkuJs(r.sku_nodo);
                          const incluido = !STATE.skusExcluidos.has(skuKey);
                          return `
                            <tr style="border-top:1px solid #334155;opacity:${incluido ? '1' : '0.45'};">
                              <td style="padding:7px;"><input type="checkbox" ${incluido ? 'checked' : ''} onchange="window._consolaCascadaToggleSku('${esc(skuKey)}', this.checked)" /></td>
                              <td style="padding:7px;">${renderCeldaArticulo(r.descripcion_generada, r.sku_nodo, r.ldn)}</td>
                              <td style="padding:7px;">${fmtMoney(r.costo_puro_total_actual)} → ${fmtMoney(r.costo_puro_total_nuevo)}</td>
                              <td style="padding:7px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.precio_base_nodo_final_actual)} → ${fmtMoney(r.precio_base_nodo_final_nuevo)}</td>
                            </tr>
                          `;
                      }).join('')}
                    </tbody>
                  </table>
                `;
            }
        } else if (STATE.tabActiva === 'articulos') {
            const listData = c.articulos || [];
            if (listData.length === 0) {
                tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">Sin cambios pendientes en Artículos Búnker.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;">
                      <th style="padding:7px;width:34px;">Sel.</th>
                      <th style="padding:7px;">Artículo</th>
                      <th style="padding:7px;">Costo Base Actual</th>
                      <th style="padding:7px;">Costo Base Nuevo</th>
                      <th style="padding:7px;">Diferencia</th>
                    </tr></thead>
                    <tbody>
                      ${listData.slice(0, 150).map(r => {
                          const skuKey = normSkuJs(r.articulo_id);
                          const incluido = !STATE.skusExcluidos.has(skuKey);
                          return `
                            <tr style="border-top:1px solid #334155;opacity:${incluido ? '1' : '0.45'};">
                              <td style="padding:7px;"><input type="checkbox" ${incluido ? 'checked' : ''} onchange="window._consolaCascadaToggleSku('${esc(skuKey)}', this.checked)" /></td>
                              <td style="padding:7px;">${renderCeldaArticulo(r.descripcion_generada, r.articulo_id, r.ldn)}</td>
                              <td style="padding:7px;">${fmtMoney(r.costo_base_actual)}</td>
                              <td style="padding:7px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.costo_base_nuevo)}</td>
                              <td style="padding:7px;color:${r.diff >= 0 ? '#fca5a5' : '#6ee7b7'};font-weight:700;">${fmtDiff(r.diff)}</td>
                            </tr>
                          `;
                      }).join('')}
                    </tbody>
                  </table>
                `;
            }
        } else if (STATE.tabActiva === 'ingredientes') {
            const listData = c.ingredientes || [];
            if (listData.length === 0) {
                tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">Sin cambios pendientes en Ingredientes / Puentes.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;">
                      <th style="padding:7px;">Ingrediente</th>
                      <th style="padding:7px;">Rol</th>
                      <th style="padding:7px;">Actual</th>
                      <th style="padding:7px;">Nuevo</th>
                    </tr></thead>
                    <tbody>
                      ${listData.slice(0, 150).map(r => `
                        <tr style="border-top:1px solid #334155;">
                          <td style="padding:7px;">
                            <strong style="color:#f8fafc;">${esc(r.nombre)}</strong>
                            <div style="font-size:0.70rem;color:#94a3b8;">#${r.ingrediente_id}${r.codigo ? ` · Cód. ${esc(r.codigo)}` : ''}</div>
                          </td>
                          <td style="padding:7px;">${esc(r.rol_ingrediente)}</td>
                          <td style="padding:7px;">${fmtMoney(r.costo_actual)}</td>
                          <td style="padding:7px;font-weight:700;color:#6ee7b7;">${fmtMoney(r.costo_nuevo)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `;
            }
        } else if (STATE.tabActiva === 'manuales') {
            if (manuales.length === 0) {
                tablaHtml = `<div style="padding:18px;text-align:center;color:#94a3b8;">No hay precios manuales protegidos alcanzados por esta consulta.</div>`;
            } else {
                tablaHtml = `
                  <table style="width:100%;border-collapse:collapse;font-size:0.80rem;">
                    <thead><tr style="background:#1e293b;color:#cbd5e1;text-align:left;position:sticky;top:0;">
                      <th style="padding:7px;">Actualizar</th>
                      <th style="padding:7px;">Lista</th>
                      <th style="padding:7px;">Artículo</th>
                      <th style="padding:7px;">Precio Manual Protegido</th>
                      <th style="padding:7px;">Sugerido por Fórmula</th>
                    </tr></thead>
                    <tbody>
                      ${manuales.slice(0, 150).map(r => `
                        <tr style="border-top:1px solid #334155;">
                          <td style="padding:7px;"><input type="checkbox" ${STATE.incluirManualesIds.has(Number(r.lista_articulo_id)) ? 'checked' : ''} onchange="window._consolaCascadaToggleManual(${r.lista_articulo_id}, this.checked)" /></td>
                          <td style="padding:7px;">${esc(r.lista_nombre)}</td>
                          <td style="padding:7px;">${renderCeldaArticulo(r.descripcion_generada, r.articulo_numero, r.ldn)}</td>
                          <td style="padding:7px;color:#fcd34d;font-weight:700;">${fmtMoney(r.precio_actual)}</td>
                          <td style="padding:7px;">${fmtMoney(r.precio_sugerido_formula)} (${fmtDiff(r.diff_teorica)})</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `;
            }
        }

        container.innerHTML = tablaHtml;
    }

    function renderizarTablaSimulacion() {
        const sim = STATE.simulacionActual;
        if (!sim) {
            return `<div style="padding:20px;text-align:center;color:#94a3b8;background:#1e293b;border-radius:10px;">Seleccioná un modo y ejecutá <strong>Previsualizar Impacto (Sin Guardar)</strong> para inspeccionar todos los precios antes de aplicarlos.</div>`;
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
                      <span><strong>${esc(c.nombre)}</strong> <span style="color:#94a3b8;font-size:0.76rem;">(#${c.ingrediente_id})</span> — Costo actual: ${fmtMoney(c.costo_patron)} ${c.es_vinculo_costo_primario ? '<span style="color:#6ee7b7;font-size:0.75rem;">(Vínculo primario)</span>' : ''}</span>
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
        const { visibles: filasMayVisibles, microOcultas } = calcularResumenMayoristaVisible(sim);
        const gruposMayoristasCount = agruparListasPorArticulo(filasMayVisibles).length;

        let banners = '';
        if (alertasZero.length > 0) {
            banners += `
              <div style="padding:10px 14px;border-radius:8px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.12);color:#fecaca;font-size:0.81rem;margin-bottom:10px;">
                <div style="font-weight:800;margin-bottom:4px;">🛑 Alertas Costo $0,00 (${alertasZero.length} ramas bloqueadas por seguridad):</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  ${alertasZero.slice(0, 8).map(a => `
                    <span style="padding:3px 8px;border-radius:6px;background:rgba(127,29,29,0.55);border:1px solid rgba(248,113,113,0.4);">
                      <strong>${esc(a.articulo_nombre || a.sku)}</strong>
                      <span style="font-family:monospace;font-size:0.72rem;color:#fecaca;">[${esc(a.sku)}]</span>
                      · falta costo de <strong>${esc(a.nombre)}</strong> (#${a.ingrediente_id})
                    </span>
                  `).join('')}
                </div>
              </div>
            `;
        }
        if (manuales.length > 0) {
            banners += `
              <div style="padding:9px 14px;border-radius:8px;border:1px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.10);color:#fde68a;font-size:0.81rem;margin-bottom:10px;">
                <strong>🔒 Precios Manuales Protegidos (${manuales.length}):</strong> No se modificarán automáticamente salvo que tildes filas específicas en la pestaña "🔒 Precios Manuales".
              </div>
            `;
        }

        const tabs = [
            { id: 'listas_b2b', label: `Listas Mayoristas B2B (${gruposMayoristasCount} art. / ${filasMayVisibles.length} precios)` },
            { id: 'ofertas_nodos', label: `Ofertas en Tiendas de Nodos (${(c.ofertas_nodos || []).length})` },
            { id: 'catalogo_nodos', label: `Precio Base LAMDA → Nodo (${(c.catalogo_nodos || []).length})` },
            { id: 'articulos', label: `Artículos Búnker (${(c.articulos || []).length})` },
            { id: 'ingredientes', label: `Ingredientes / Puentes (${(c.ingredientes || []).length})` },
            { id: 'manuales', label: `🔒 Precios Manuales (${manuales.length})` }
        ];

        const listasConCambiosMap = new Map();
        for (const r of filasMayVisibles) {
            if (!listasConCambiosMap.has(Number(r.lista_id))) {
                listasConCambiosMap.set(Number(r.lista_id), r.lista_nombre || `Lista ${r.lista_id}`);
            }
        }
        const listasDropdown = Array.from(listasConCambiosMap.entries());

        const toolbarMayoristaHtml = STATE.tabActiva === 'listas_b2b' ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;padding:8px 10px;background:#1e293b;border-radius:9px;border:1px solid #334155;">
            <select id="radar-b2b-lista-filter" onchange="window._consolaCascadaSetFiltroListaB2B(this.value)" style="background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:7px;padding:6px 9px;font-size:0.78rem;">
              <option value="">Todas las listas mayoristas (${listasDropdown.length})</option>
              ${listasDropdown.map(([lid, nom]) => `<option value="${lid}" ${String(STATE.filtroListaB2BId) === String(lid) ? 'selected' : ''}>${esc(nom)}</option>`).join('')}
            </select>
            <input id="radar-b2b-search-input" type="text" value="${esc(STATE.filtroBusquedaArticulo)}" oninput="window._consolaCascadaSetBusquedaArt(this.value)" placeholder="Buscar por nombre o código (palabras separadas)..." style="flex:1;min-width:210px;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:7px;padding:6px 10px;font-size:0.78rem;" />
            <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:0.76rem;color:#cbd5e1;">
              <input type="checkbox" ${STATE.mostrarMicroDiferencias ? 'checked' : ''} onchange="window._consolaCascadaToggleMicroDiff(this.checked)" />
              <span>Ver diferencias menores a $1</span>
              <span id="radar-b2b-micro-info" style="color:#94a3b8;font-size:0.72rem;">${microOcultas > 0 ? `(${microOcultas} ocultos)` : ''}</span>
            </label>
            <div style="display:flex;gap:4px;">
              <button type="button" onclick="window._consolaCascadaSelTodosSkus(true)" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#6ee7b7;font-size:0.72rem;cursor:pointer;font-weight:700;">✓ Todos</button>
              <button type="button" onclick="window._consolaCascadaSelTodosSkus(false)" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#fda4af;font-size:0.72rem;cursor:pointer;font-weight:700;">✕ Ninguno</button>
            </div>
          </div>
        ` : '';

        return `
          ${banners}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:0.77rem;">
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Ingredientes: <strong>${res.ingredientes_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Artículos Búnker: <strong>${res.articulos_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Mayorista B2B: <strong>${gruposMayoristasCount} art. (${filasMayVisibles.length} filas)</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Base LAMDA → Nodo: <strong>${res.catalogo_nodos_modificados || 0}</strong></span>
            <span style="padding:4px 10px;background:#1e293b;border-radius:999px;">Ofertas en Tiendas: <strong>${res.ofertas_nodos_modificadas || 0}</strong></span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            ${tabs.map(t => `
              <button type="button" onclick="window._consolaCascadaSetTab('${t.id}')" style="padding:6px 11px;border-radius:8px;border:1px solid ${STATE.tabActiva === t.id ? '#38bdf8' : '#334155'};background:${STATE.tabActiva === t.id ? 'rgba(56,189,248,0.18)' : '#1e293b'};color:#f8fafc;cursor:pointer;font-size:0.77rem;font-weight:600;">${esc(t.label)}</button>
            `).join('')}
          </div>
          ${toolbarMayoristaHtml}
          <div id="consola-cascada-tabla-scroll" style="max-height:360px;overflow:auto;border:1px solid #334155;border-radius:10px;background:#0b1120;"></div>
        `;
    }

    function renderizarModal() {
        const body = document.getElementById('consola-cascada-body');
        if (!body) return;
        const listasMayoristas = obtenerListasMayoristas();
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
                <input id="cascada-search-input" type="text" value="${esc(searchTerm)}" oninput="window._consolaCascadaRefrescarLista()" placeholder="Buscar por nombre o código (palabras separadas)..." style="flex:1;min-width:220px;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:7px 10px;" />
                <input id="cascada-nuevo-costo-input" type="number" step="0.01" min="0" value="${esc(newCostVal)}" placeholder="Nuevo costo ($)" style="width:160px;background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:7px 10px;" />
              </div>
              <div id="cascada-search-results" style="max-height:145px;overflow-y:auto;border:1px solid #334155;border-radius:8px;background:#0f172a;">
                ${candidatos.map(it => {
                    const idKey = STATE.tipoDisparador === 'INGREDIENTE' ? String(it.id) : String(it.articulo_id);
                    const sel = STATE.itemSeleccionado && String(STATE.itemSeleccionado.key) === idKey;
                    const label = STATE.tipoDisparador === 'INGREDIENTE'
                        ? `<strong>${esc(it.nombre)}</strong> <span style="color:#94a3b8;">[#${it.id} · ${esc(it.rol_ingrediente)}]</span> · ${fmtMoney(it.costo_patron)}`
                        : `<strong>${esc(it.nombre)}</strong> <span style="color:#94a3b8;">[${esc(it.articulo_id)}]</span> · Base ${fmtMoney(it.costo_base)}`;
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
              <div style="font-size:0.78rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;">Listas Mayoristas B2B y Canal Nodos a actualizar:</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.76rem;align-items:center;">
                ${listasMayoristas.map(lp => `
                  <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="checkbox" ${STATE.listasSeleccionadas.has(Number(lp.id)) ? 'checked' : ''} onchange="window._consolaCascadaToggleLista(${lp.id}, this.checked)" />
                    <span>${esc(lp.nombre)}</span>
                  </label>
                `).join('')}
              </div>
              <div style="margin-top:8px;padding-top:7px;border-top:1px dashed #334155;">
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#6ee7b7;font-weight:800;font-size:0.78rem;">
                  <input type="checkbox" ${STATE.incluirCanalNodos ? 'checked' : ''} onchange="window._consolaCascadaToggleCanalNodos(this.checked)" />
                  <span>🏘️ Canal Nodos (Precio Base Lista Nodos + Tiendas)</span>
                </label>
              </div>
            </div>
          </div>

          <div id="consola-cascada-preview">${renderizarTablaSimulacion()}</div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap;">
            <div id="consola-cascada-status" style="font-size:0.82rem;color:#94a3b8;">${STATE.cargando ? '⏳ Calculando impacto de costos...' : 'Modo seguro: revisá la vista previa y elegí qué artículos actualizar.'}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button type="button" onclick="window._consolaCascadaSimular()" ${STATE.cargando ? 'disabled' : ''} style="padding:9px 16px;border-radius:8px;border:1px solid #38bdf8;background:#0284c7;color:#fff;font-weight:700;cursor:pointer;">🔍 Previsualizar Impacto (Sin Guardar)</button>
              <button type="button" onclick="window._consolaCascadaAplicar()" ${STATE.cargando ? 'disabled' : ''} style="padding:9px 16px;border-radius:8px;border:none;background:#10b981;color:#062e22;font-weight:800;cursor:pointer;">✅ Impactar Precios Seleccionados</button>
            </div>
          </div>
        `;
        renderizarSoloTablaActiva();
    }

    function construirPayload(incluirExclusiones = true) {
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
        const listasIds = Array.from(STATE.listasSeleccionadas);
        return {
            disparador,
            filtros: {
                ldns_seleccionadas: Array.from(STATE.ldnsSeleccionadas),
                listas_seleccionadas: listasIds,
                ninguna_lista_b2b: listasIds.length === 0,
                incluir_canal_nodos: STATE.incluirCanalNodos,
                incluir_manuales_ids: Array.from(STATE.incluirManualesIds),
                articulos_excluidos: incluirExclusiones ? Array.from(STATE.skusExcluidos) : [],
                min_diff_precio: (STATE.modo === 'RADAR' && !STATE.mostrarMicroDiferencias) ? 1 : 0
            }
        };
    }

    async function simularActual() {
        try {
            const payload = construirPayload(false);
            STATE.cargando = true;
            renderizarModal();
            const resp = await fetch('/api/produccion/costos-grafo/simular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok && !data.requiere_seleccion_calidad) {
                throw new Error(data.error || 'Error simulando impacto.');
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

    function construirResumenConfirmacionHumana(simPrev) {
        const c = simPrev?.cambios || {};
        const artMap = new Map();
        const listasNombres = new Set();
        let filasMayoristas = 0;

        for (const r of (c.listas_b2b || [])) {
            const skuKey = normSkuJs(r.articulo_numero);
            if (STATE.skusExcluidos.has(skuKey)) continue;
            if (!artMap.has(skuKey)) artMap.set(skuKey, r.descripcion_generada || r.articulo_numero);
            if (String(r.canal_comercial || 'MAYORISTA').toUpperCase() !== 'NODOS') {
                filasMayoristas += 1;
                if (r.lista_nombre) listasNombres.add(r.lista_nombre);
            }
        }
        const catNodos = (c.catalogo_nodos || []).filter(r => !STATE.skusExcluidos.has(normSkuJs(r.sku_nodo)));
        catNodos.forEach(r => {
            const k = normSkuJs(r.sku_nodo);
            if (!artMap.has(k)) artMap.set(k, r.descripcion_generada || r.sku_nodo);
        });
        const ofeNodos = (c.ofertas_nodos || []).filter(r => !STATE.skusExcluidos.has(normSkuJs(r.sku_nodo)));
        const nodosAfectados = new Set(ofeNodos.map(o => Number(o.nodo_id)));
        const artsBunker = (c.articulos || []).filter(r => !STATE.skusExcluidos.has(normSkuJs(r.articulo_id)));
        artsBunker.forEach(r => {
            const k = normSkuJs(r.articulo_id);
            if (!artMap.has(k)) artMap.set(k, r.descripcion_generada || r.articulo_id);
        });
        const ings = c.ingredientes || [];
        const manualesProt = c.listas_manuales_omitidas || [];

        const totalImpactos = filasMayoristas + catNodos.length + ofeNodos.length + artsBunker.length + ings.length + STATE.incluirManualesIds.size;
        return {
            totalImpactos,
            articulosCount: artMap.size,
            muestraNombres: Array.from(artMap.values()).slice(0, 5),
            filasMayoristas,
            listasNombres: Array.from(listasNombres),
            catNodosCount: catNodos.length,
            ofeNodosCount: ofeNodos.length,
            nodosCount: nodosAfectados.size,
            artsBunkerCount: artsBunker.length,
            ingsCount: ings.length,
            manualesProtegidasCount: manualesProt.length,
            manualesOptInCount: STATE.incluirManualesIds.size
        };
    }

    async function confirmarImpactoUsuario(resumen) {
        if (window.Swal && typeof window.Swal.fire === 'function') {
            const listaEjemplos = resumen.muestraNombres.length > 0
                ? `<div style="margin-top:8px;font-size:0.79rem;color:#94a3b8;">Incluye: ${resumen.muestraNombres.map(n => `<strong style="color:#e2e8f0;">${esc(n)}</strong>`).join(', ')}${resumen.articulosCount > 5 ? ` y ${resumen.articulosCount - 5} más` : ''}</div>`
                : '';
            const resSwal = await window.Swal.fire({
                icon: 'question',
                title: '¿Confirmás impactar estos precios?',
                html: `
                  <div style="text-align:left;font-size:0.86rem;line-height:1.5;color:#e2e8f0;">
                    <div>• <strong>${resumen.articulosCount}</strong> artículo(s) distinto(s) seleccionado(s).</div>
                    <div>• <strong>${resumen.filasMayoristas}</strong> precio(s) en Listas Mayoristas B2B${resumen.listasNombres.length > 0 ? ` (${esc(resumen.listasNombres.join(', '))})` : ''}.</div>
                    ${STATE.incluirCanalNodos
                        ? `<div>• <strong>Canal Nodos:</strong> <strong>${resumen.catNodosCount}</strong> Precio(s) Base LAMDA → Nodo (incluye Lista Nodos) y <strong>${resumen.ofeNodosCount}</strong> oferta(s) en <strong>${resumen.nodosCount}</strong> tienda(s) preservando márgenes.</div>`
                        : `<div style="color:#94a3b8;">• Canal Nodos desmarcado (no se modificará Lista Base Nodos ni tiendas).</div>`}
                    ${resumen.artsBunkerCount > 0 ? `<div>• <strong>${resumen.artsBunkerCount}</strong> costo(s) base en Artículos Búnker${resumen.ingsCount > 0 ? ` y <strong>${resumen.ingsCount}</strong> ingrediente(s)` : ''}.</div>` : ''}
                    ${resumen.manualesProtegidasCount > 0 ? `<div style="color:#fde68a;">• 🔒 <strong>${resumen.manualesProtegidasCount}</strong> precio(s) manual(es) permanecerán intactos.</div>` : ''}
                    ${resumen.manualesOptInCount > 0 ? `<div style="color:#93c5fd;">• ✏️ <strong>${resumen.manualesOptInCount}</strong> precio(s) manual(es) marcado(s) manualmente serán actualizados.</div>` : ''}
                    ${listaEjemplos}
                  </div>
                `,
                background: '#0f172a',
                color: '#f8fafc',
                showCancelButton: true,
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#475569',
                confirmButtonText: 'Sí, impactar precios',
                cancelButtonText: 'Cancelar'
            });
            return Boolean(resSwal && resSwal.isConfirmed);
        }
        return window.confirm(
            `Se actualizarán ${resumen.articulosCount} artículo(s): ${resumen.filasMayoristas} precios en Listas Mayoristas` +
            (STATE.incluirCanalNodos ? `, ${resumen.catNodosCount} Precios Base Nodos y ${resumen.ofeNodosCount} ofertas en ${resumen.nodosCount} tienda(s)` : '') +
            '. ¿Confirmás continuar?'
        );
    }

    async function aplicarActual() {
        try {
            const payload = construirPayload(true);
            const simResp = await fetch('/api/produccion/costos-grafo/simular', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const simPrev = await simResp.json();
            if (!simResp.ok && !simPrev.requiere_seleccion_calidad) {
                throw new Error(simPrev.error || 'No se pudo previsualizar la selección actual.');
            }
            if (simPrev.requiere_seleccion_calidad) {
                STATE.simulacionActual = simPrev;
                renderizarModal();
                return;
            }

            const resumenHum = construirResumenConfirmacionHumana(simPrev);
            if (resumenHum.totalImpactos === 0) {
                if (window.Swal) {
                    await window.Swal.fire({ icon: 'info', title: 'Sin cambios para impactar', text: 'No hay artículos ni listas seleccionadas con diferencias pendientes.', background: '#0f172a', color: '#f8fafc' });
                } else {
                    alert('No hay precios seleccionados con diferencias para impactar.');
                }
                return;
            }

            const okConf = await confirmarImpactoUsuario(resumenHum);
            if (!okConf) return;

            STATE.cargando = true;
            renderizarModal();
            const resp = await fetch('/api/produccion/costos-grafo/aplicar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || 'No se pudieron impactar los precios.');
            }
            STATE.cargando = false;
            await cargarRadarEnSegundoPlano();
            if (typeof window.recargarModuloNodosBarriales === 'function') {
                window.recargarModuloNodosBarriales().catch(() => {});
            }
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
                st.innerHTML = `<span style="color:#6ee7b7;font-weight:700;">✅ Precios actualizados: ${r.listas_modificadas || 0} precios B2B (${r.cambios_mayoristas_historial || 0} historial / ${r.notificaciones_clientes_pendientes || 0} avisos a clientes) · ${r.catalogo_nodos_modificados || 0} Base Nodos · ${r.ofertas_nodos_modificadas || 0} ofertas en tiendas.</span>`;
            }
        } catch (err) {
            STATE.cargando = false;
            renderizarModal();
            const st = document.getElementById('consola-cascada-status');
            if (st) st.innerHTML = `<span style="color:#fca5a5;">❌ ${esc(err.message)}</span>`;
        }
    }

    window.refrescarRadarCostos = cargarRadarEnSegundoPlano;

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
        STATE.skusExcluidos.clear();
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
                ? `<strong>${esc(it.nombre)}</strong> <span style="color:#94a3b8;">[#${it.id} · ${esc(it.rol_ingrediente)}]</span> · ${fmtMoney(it.costo_patron)}`
                : `<strong>${esc(it.nombre)}</strong> <span style="color:#94a3b8;">[${esc(it.articulo_id)}]</span> · Base ${fmtMoney(it.costo_base)}`;
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
        if (pv) {
            pv.innerHTML = renderizarTablaSimulacion();
            renderizarSoloTablaActiva();
        }
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
    window._consolaCascadaSetFiltroListaB2B = function (val) {
        STATE.filtroListaB2BId = val || '';
        renderizarSoloTablaActiva();
    };
    window._consolaCascadaSetBusquedaArt = function (val) {
        STATE.filtroBusquedaArticulo = val || '';
        renderizarSoloTablaActiva();
    };
    window._consolaCascadaToggleMicroDiff = function (checked) {
        STATE.mostrarMicroDiferencias = Boolean(checked);
        const pv = document.getElementById('consola-cascada-preview');
        if (pv) {
            pv.innerHTML = renderizarTablaSimulacion();
            renderizarSoloTablaActiva();
        }
    };
    window._consolaCascadaToggleSku = function (skuKey, checked) {
        const k = normSkuJs(skuKey);
        if (checked) STATE.skusExcluidos.delete(k);
        else STATE.skusExcluidos.add(k);
        renderizarSoloTablaActiva();
    };
    window._consolaCascadaToggleExpandSku = function (skuKey) {
        const k = normSkuJs(skuKey);
        if (STATE.skusExpandidos.has(k)) STATE.skusExpandidos.delete(k);
        else STATE.skusExpandidos.add(k);
        renderizarSoloTablaActiva();
    };
    window._consolaCascadaSelTodosSkus = function (seleccionar) {
        const sim = STATE.simulacionActual;
        if (!sim) return;
        const visibles = obtenerSkusUnicosVisibles(sim);
        if (seleccionar) {
            visibles.forEach(k => STATE.skusExcluidos.delete(k));
        } else {
            visibles.forEach(k => STATE.skusExcluidos.add(k));
        }
        renderizarSoloTablaActiva();
    };
    window._consolaCascadaSimular = simularActual;
    window._consolaCascadaAplicar = aplicarActual;

    document.addEventListener('DOMContentLoaded', () => {
        cargarRadarEnSegundoPlano();
    });
})();
