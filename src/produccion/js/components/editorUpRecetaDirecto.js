(function () {
    if (window.__lamdaEditorUpRecetaDirectoLoaded) return;
    window.__lamdaEditorUpRecetaDirectoLoaded = true;

    function injectStyles() {
        if (document.getElementById('lamda-editor-up-directo-styles')) return;
        const style = document.createElement('style');
        style.id = 'lamda-editor-up-directo-styles';
        style.textContent = `
            #lamda-editor-up-directo-overlay {
                position: fixed;
                inset: 0;
                z-index: 100050;
                background: rgba(15, 23, 42, 0.72);
                backdrop-filter: blur(3px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .lud-modal {
                width: min(980px, 98vw);
                max-height: 92vh;
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid #334155;
                border-radius: 14px;
                box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .lud-header {
                padding: 16px 20px;
                background: #1e293b;
                border-bottom: 1px solid #334155;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
            }
            .lud-title {
                margin: 0;
                font-size: 17px;
                font-weight: 700;
                color: #f8fafc;
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .lud-sku-pill {
                background: #0ea5e9;
                color: #082f49;
                font-weight: 800;
                font-size: 12px;
                padding: 2px 8px;
                border-radius: 6px;
                font-family: monospace;
            }
            .lud-sub {
                margin-top: 6px;
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                font-size: 12px;
                color: #cbd5e1;
            }
            .lud-badge {
                padding: 3px 8px;
                border-radius: 6px;
                background: #0f172a;
                border: 1px solid #334155;
                font-weight: 600;
            }
            .lud-badge.ok { border-color: #10b981; color: #6ee7b7; }
            .lud-badge.danger { border-color: #ef4444; color: #fca5a5; background: rgba(239, 68, 68, 0.14); }
            .lud-badge.warn { border-color: #f59e0b; color: #fcd34d; }
            .lud-body {
                padding: 16px 20px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .lud-section {
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 10px;
                padding: 14px;
            }
            .lud-section-title {
                margin: 0 0 10px 0;
                font-size: 13px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.4px;
                color: #93c5fd;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .lud-search-wrap {
                position: relative;
                margin-bottom: 10px;
            }
            .lud-input, .lud-select {
                width: 100%;
                box-sizing: border-box;
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid #475569;
                border-radius: 7px;
                padding: 8px 10px;
                font-size: 13px;
            }
            .lud-input:focus, .lud-select:focus {
                outline: none;
                border-color: #38bdf8;
            }
            .lud-dropdown {
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                right: 0;
                max-height: 220px;
                overflow-y: auto;
                background: #0f172a;
                border: 1px solid #38bdf8;
                border-radius: 8px;
                z-index: 30;
                box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
                display: none;
            }
            .lud-dropdown-item {
                padding: 8px 10px;
                border-bottom: 1px solid #1e293b;
                cursor: pointer;
                font-size: 12.5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
            }
            .lud-dropdown-item:hover {
                background: #1e293b;
            }
            .lud-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12.5px;
            }
            .lud-table th {
                text-align: left;
                padding: 7px 8px;
                color: #94a3b8;
                border-bottom: 1px solid #334155;
                font-weight: 600;
            }
            .lud-table td {
                padding: 8px;
                border-bottom: 1px solid rgba(51, 65, 85, 0.6);
                vertical-align: middle;
            }
            .lud-footer {
                padding: 14px 20px;
                background: #1e293b;
                border-top: 1px solid #334155;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .lud-btn {
                border: none;
                border-radius: 8px;
                padding: 8px 14px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: filter 0.15s;
            }
            .lud-btn:hover { filter: brightness(1.08); }
            .lud-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .lud-btn-primary { background: #10b981; color: #052e16; }
            .lud-btn-secondary { background: #334155; color: #f8fafc; }
            .lud-btn-danger { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.45); padding: 4px 8px; font-size: 12px; }
            .lud-btn-switch { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.4); padding: 4px 10px; font-size: 12px; }
            .lud-status-msg { font-size: 12.5px; font-weight: 600; }
        `;
        document.head.appendChild(style);
    }

    function esc(v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtNum(n, dec = 2) {
        const val = Number(n) || 0;
        return val.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
    }

    function fmtMon(n) {
        const val = Number(n) || 0;
        return '$' + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Búsqueda acumulativa por espacios (Política Universal de Búsqueda LAMDA)
    function coincideTerminos(bolsaTexto, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        const terminos = q.split(/\s+/).filter(Boolean);
        const target = String(bolsaTexto || '').toLowerCase();
        return terminos.every((t) => target.includes(t));
    }

    window.abrirEditorUpDirecto = async function abrirEditorUpDirecto(codigoInicial, opts = {}) {
        const skuSolicitado = String(codigoInicial || '').trim();
        if (!skuSolicitado) return;

        injectStyles();

        let overlay = document.getElementById('lamda-editor-up-directo-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'lamda-editor-up-directo-overlay';
        overlay.innerHTML = `
            <div class="lud-modal" role="dialog" aria-modal="true">
                <div class="lud-header">
                    <div>
                        <h3 class="lud-title">⏳ Cargando configuración determinista de <span class="lud-sku-pill">${esc(skuSolicitado)}</span>...</h3>
                    </div>
                    <button type="button" class="lud-btn lud-btn-secondary" id="lud-btn-close-top">✕</button>
                </div>
                <div class="lud-body">
                    <div style="padding:24px;text-align:center;color:#94a3b8;">Consultando Búnker, Stock Consolidado, Recetas y Vínculos UP/AP...</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const cerrarModal = () => {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
        overlay.querySelector('#lud-btn-close-top')?.addEventListener('click', cerrarModal);
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) cerrarModal();
        });

        async function cargarYRenderizar(skuTarget, forzarSku = false) {
            try {
                const url = `/api/produccion/up-receta-directa/${encodeURIComponent(skuTarget)}${forzarSku ? '?forzar_sku=true' : ''}`;
                const resp = await fetch(url);
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    throw new Error(data.detalle || data.error || `HTTP ${resp.status}`);
                }

                const art = data.articulo;
                const catalogoArticulos = Array.isArray(data.catalogo_articulos) ? data.catalogo_articulos : [];
                const catalogoIngredientes = Array.isArray(data.catalogo_ingredientes) ? data.catalogo_ingredientes : [];

                const state = {
                    sku: art.sku,
                    descripcionReceta: data.receta?.descripcion || `Receta de ${art.sku}`,
                    enlazadoExterno: Boolean(data.receta?.enlazado_externo),
                    articulos: (data.receta_articulos || []).map((a) => ({ ...a })),
                    ingredientes: (data.receta_ingredientes || []).map((i) => ({ ...i })),
                    apCodigo: data.relacion_up_ap?.articulo_kilo_codigo || '',
                    multiplicadorPreservado: data.relacion_up_ap?.multiplicador_ingredientes ?? 1.0,
                    teniaRelacionUp: Boolean(data.relacion_up_ap)
                };

                const modalEl = overlay.querySelector('.lud-modal');

                function resolverInfoAp(apSku) {
                    if (!apSku) return null;
                    const artAp = catalogoArticulos.find((x) => x.sku.toUpperCase() === apSku.toUpperCase());
                    const ingVinc = catalogoIngredientes.find(
                        (i) => String(i.articulo_vinculado_numero || '').trim().toUpperCase() === apSku.toUpperCase()
                    );
                    return {
                        sku: artAp ? artAp.sku : apSku,
                        descripcion: artAp ? artAp.descripcion_bunker : apSku,
                        stock_kilos: artAp ? artAp.stock_bultos : 0,
                        ingrediente: ingVinc || null
                    };
                }

                const stockClass = art.stock_bultos > 0 ? 'ok' : 'danger';
                const bannerRedireccion = art.solicitado_desde_sku
                    ? `<div style="background:rgba(14,165,233,0.14);border:1px solid rgba(56,189,248,0.4);border-radius:8px;padding:8px 12px;font-size:12.5px;color:#bae6fd;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                         <span>🔗 Abierto desde Artículo Puente <b>[${esc(art.solicitado_desde_sku)}]</b> → mostrando su Unidad Productiva madre <b>[${esc(art.sku)}]</b>.</span>
                         <button type="button" class="lud-btn lud-btn-switch" id="lud-btn-ver-ap-directo">Ver ficha [${esc(art.solicitado_desde_sku)}]</button>
                       </div>`
                    : (art.sku_alternativo
                        ? `<div style="display:flex;justify-content:flex-end;">
                             <button type="button" class="lud-btn lud-btn-switch" id="lud-btn-ver-alternativo">Ir a par vinculado [${esc(art.sku_alternativo)}]</button>
                           </div>`
                        : '');

                modalEl.innerHTML = `
                    <div class="lud-header">
                        <div>
                            <h3 class="lud-title">
                                ⚙️ Configuración Directa UP / Receta
                                <span class="lud-sku-pill">[${esc(art.sku)}]</span>
                                <span>${esc(art.descripcion_bunker)}</span>
                            </h3>
                            <div class="lud-sub">
                                <span class="lud-badge ${stockClass}">📦 Stock Depósito: ${fmtNum(art.stock_bultos)} u (${fmtNum(art.stock_kilos)} kg)</span>
                                <span class="lud-badge">⚖️ Peso Unidad: ${fmtNum(art.kilos_unidad, 3)} kg</span>
                                <span class="lud-badge">💰 Costo Base: ${fmtMon(art.costo_bulto)} (${fmtMon(art.costo_kilo)}/kg)</span>
                                ${art.solo_produccion_externa ? '<span class="lud-badge warn">🏭 Unidad Productiva Externa</span>' : '<span class="lud-badge">🏠 Producción / Fracción</span>'}
                            </div>
                        </div>
                        <button type="button" class="lud-btn lud-btn-secondary" id="lud-btn-close-top">✕</button>
                    </div>
                    <div class="lud-body">
                        ${bannerRedireccion}

                        <!-- SECCIÓN 1: VÍNCULO UP -> AP -> INGREDIENTE -->
                        <div class="lud-section" id="lud-sec-up-ap" style="${(art.solo_produccion_externa || state.teniaRelacionUp || art.familia_id === 42) ? '' : 'display:none;'}">
                            <div class="lud-section-title">
                                <span>1. Cadena Externa Determinista: Unidad Productiva (UP) → Artículo Puente (AP) → Ingrediente</span>
                                <span style="font-size:11px;color:#94a3b8;text-transform:none;">Multiplicador preservado: x${fmtNum(state.multiplicadorPreservado, 2)}</span>
                            </div>
                            <div class="lud-search-wrap">
                                <input type="text" class="lud-input" id="lud-search-ap" placeholder="🔍 Buscar Artículo Puente de salida por código o descripción (ej: APTSPGXK)...">
                                <div class="lud-dropdown" id="lud-dropdown-ap"></div>
                            </div>
                            <div id="lud-ap-resumen"></div>
                        </div>

                        <!-- SECCIÓN 2: BULTOS CRUDOS / PRE-MEZCLAS EN RECETA_ARTICULOS -->
                        <div class="lud-section">
                            <div class="lud-section-title">
                                <span>2. Bultos Crudos / Artículos Padre en Receta (receta_articulos)</span>
                                <span style="font-size:11px;color:#94a3b8;text-transform:none;">Muestra stock real en depósito y costo $/kg antes de elegir</span>
                            </div>
                            <div class="lud-search-wrap">
                                <input type="text" class="lud-input" id="lud-search-art" placeholder="🔍 Buscar bulto crudo o pre-mezcla en Búnker (ej: almendra 27/30, APC2730X2268, MPB)...">
                                <div class="lud-dropdown" id="lud-dropdown-art"></div>
                            </div>
                            <div id="lud-tabla-articulos-wrap"></div>
                        </div>

                        <!-- SECCIÓN 3: INGREDIENTES E INSUMOS EN RECETA_INGREDIENTES -->
                        <div class="lud-section">
                            <div class="lud-section-title">
                                <span>3. Ingredientes y Envases en Receta (receta_ingredientes)</span>
                                <span style="font-size:11px;color:#94a3b8;text-transform:none;">Convive sin borrar los bultos de receta_articulos</span>
                            </div>
                            <div class="lud-search-wrap">
                                <input type="text" class="lud-input" id="lud-search-ing" placeholder="🔍 Buscar ingrediente o bolsa por código o nombre (ej: 98300858, sal, bolsa 15 x 18)...">
                                <div class="lud-dropdown" id="lud-dropdown-ing"></div>
                            </div>
                            <div id="lud-tabla-ingredientes-wrap"></div>
                        </div>
                    </div>
                    <div class="lud-footer">
                        <div class="lud-status-msg" id="lud-status-msg" style="color:#94a3b8;">
                            🛡️ Edición directa sobre tablas maestras: no abre ni altera carros en curso ni históricos.
                        </div>
                        <div style="display:flex;gap:10px;align-items:center;">
                            <button type="button" class="lud-btn lud-btn-secondary" id="lud-btn-cancelar">Cancelar</button>
                            <button type="button" class="lud-btn lud-btn-primary" id="lud-btn-guardar">💾 Guardar Configuración</button>
                        </div>
                    </div>
                `;

                modalEl.querySelector('#lud-btn-close-top')?.addEventListener('click', cerrarModal);
                modalEl.querySelector('#lud-btn-cancelar')?.addEventListener('click', cerrarModal);
                modalEl.querySelector('#lud-btn-ver-ap-directo')?.addEventListener('click', () => {
                    cargarYRenderizar(art.solicitado_desde_sku, true);
                });
                modalEl.querySelector('#lud-btn-ver-alternativo')?.addEventListener('click', () => {
                    cargarYRenderizar(art.sku_alternativo, true);
                });

                function renderApResumen() {
                    const wrap = modalEl.querySelector('#lud-ap-resumen');
                    if (!wrap) return;
                    if (!state.apCodigo) {
                        wrap.innerHTML = `<div style="font-size:12.5px;color:#94a3b8;padding:6px 2px;">Sin Artículo Puente (AP) vinculado como salida externa para [${esc(state.sku)}].</div>`;
                        return;
                    }
                    const info = resolverInfoAp(state.apCodigo);
                    const ingTxt = info.ingrediente
                        ? `<span class="lud-badge ok">🔗 Ingrediente Espejo: [${esc(info.ingrediente.codigo)}] ${esc(info.ingrediente.nombre)} (${fmtMon(info.ingrediente.costo_patron)}/kg)</span>`
                        : `<span class="lud-badge warn">⚠️ Sin ingrediente espejo con articulo_vinculado_numero = '${esc(info.sku)}'</span>`;
                    wrap.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:#0f172a;border:1px solid #334155;padding:10px 12px;border-radius:8px;">
                            <div style="display:flex;flex-direction:column;gap:6px;">
                                <div style="font-size:13px;font-weight:700;color:#f8fafc;">
                                    ➡️ Salida AP: <span class="lud-sku-pill">[${esc(info.sku)}]</span> ${esc(info.descripcion)}
                                    <span style="font-weight:500;color:#94a3b8;margin-left:6px;">(Stock AP: ${fmtNum(info.stock_kilos)} kg)</span>
                                </div>
                                <div>${ingTxt}</div>
                            </div>
                            <button type="button" class="lud-btn lud-btn-danger" id="lud-btn-quitar-ap">Quitar vínculo AP</button>
                        </div>
                    `;
                    wrap.querySelector('#lud-btn-quitar-ap')?.addEventListener('click', () => {
                        state.apCodigo = '';
                        renderApResumen();
                    });
                }

                function renderTablaArticulos() {
                    const wrap = modalEl.querySelector('#lud-tabla-articulos-wrap');
                    if (!wrap) return;
                    if (state.articulos.length === 0) {
                        wrap.innerHTML = `<div style="font-size:12.5px;color:#94a3b8;padding:6px 2px;">No hay bultos/artículos configurados en <code>receta_articulos</code>.</div>`;
                        return;
                    }
                    wrap.innerHTML = `
                        <table class="lud-table">
                            <thead>
                                <tr>
                                    <th>[SKU] Descripción Oficial Búnker</th>
                                    <th>Stock Depósito</th>
                                    <th>Costo Base</th>
                                    <th style="width:120px;">Cant. Bultos</th>
                                    <th style="width:70px;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${state.articulos.map((r, idx) => {
                                    const sinStock = (Number(r.stock_bultos) || 0) <= 0;
                                    return `
                                        <tr>
                                            <td>
                                                <span class="lud-sku-pill">[${esc(r.articulo_numero)}]</span>
                                                <strong style="margin-left:6px;">${esc(r.descripcion_bunker)}</strong>
                                                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Peso bulto: ${fmtNum(r.kilos_unidad, 2)} kg · Total receta: ${fmtNum((Number(r.cantidad) || 0) * (Number(r.kilos_unidad) || 1), 2)} kg</div>
                                            </td>
                                            <td>
                                                <span class="lud-badge ${sinStock ? 'danger' : 'ok'}">
                                                    ${sinStock ? '🚨 SIN STOCK: ' : ''}${fmtNum(r.stock_bultos)} bultos (${fmtNum(r.stock_kilos)} kg)
                                                </span>
                                            </td>
                                            <td>
                                                <div style="font-weight:700;color:#e2e8f0;">${fmtMon(r.costo_kilo)}/kg</div>
                                                <div style="font-size:11px;color:#94a3b8;">${fmtMon(r.costo_bulto)} / bulto</div>
                                            </td>
                                            <td>
                                                <input type="number" class="lud-input lud-art-cant" data-idx="${idx}" min="0.0001" step="any" value="${Number(r.cantidad) || 1}">
                                            </td>
                                            <td style="text-align:right;">
                                                <button type="button" class="lud-btn lud-btn-danger lud-art-del" data-idx="${idx}">🗑️</button>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `;
                    wrap.querySelectorAll('.lud-art-cant').forEach((inp) => {
                        inp.addEventListener('change', () => {
                            const i = Number(inp.dataset.idx);
                            const v = parseFloat(inp.value);
                            if (Number.isFinite(v) && v > 0 && state.articulos[i]) {
                                state.articulos[i].cantidad = v;
                                renderTablaArticulos();
                            }
                        });
                    });
                    wrap.querySelectorAll('.lud-art-del').forEach((btn) => {
                        btn.addEventListener('click', () => {
                            const i = Number(btn.dataset.idx);
                            state.articulos.splice(i, 1);
                            renderTablaArticulos();
                        });
                    });
                }

                function renderTablaIngredientes() {
                    const wrap = modalEl.querySelector('#lud-tabla-ingredientes-wrap');
                    if (!wrap) return;
                    if (state.ingredientes.length === 0) {
                        wrap.innerHTML = `<div style="font-size:12.5px;color:#94a3b8;padding:6px 2px;">No hay ingredientes/insumos configurados en <code>receta_ingredientes</code>.</div>`;
                        return;
                    }
                    wrap.innerHTML = `
                        <table class="lud-table">
                            <thead>
                                <tr>
                                    <th>[Código] Ingrediente / Envase</th>
                                    <th>Stock Actual</th>
                                    <th>Costo Patrón</th>
                                    <th style="width:120px;">Cantidad</th>
                                    <th style="width:100px;">Unidad</th>
                                    <th style="width:70px;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${state.ingredientes.map((r, idx) => `
                                    <tr>
                                        <td>
                                            <span class="lud-sku-pill">[${esc(r.codigo || '#' + r.ingrediente_id)}]</span>
                                            <strong style="margin-left:6px;">${esc(r.nombre)}</strong>
                                            ${r.es_insumo ? '<span class="lud-badge" style="margin-left:6px;font-size:10.5px;">Envase/Insumo</span>' : ''}
                                        </td>
                                        <td>${fmtNum(r.stock_actual)} ${esc(r.unidad_medida)}</td>
                                        <td>${fmtMon(r.costo_patron)}</td>
                                        <td>
                                            <input type="number" class="lud-input lud-ing-cant" data-idx="${idx}" min="0.0001" step="any" value="${Number(r.cantidad) || 1}">
                                        </td>
                                        <td>
                                            <input type="text" class="lud-input lud-ing-uni" data-idx="${idx}" value="${esc(r.unidad_medida || 'kg')}">
                                        </td>
                                        <td style="text-align:right;">
                                            <button type="button" class="lud-btn lud-btn-danger lud-ing-del" data-idx="${idx}">🗑️</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `;
                    wrap.querySelectorAll('.lud-ing-cant').forEach((inp) => {
                        inp.addEventListener('change', () => {
                            const i = Number(inp.dataset.idx);
                            const v = parseFloat(inp.value);
                            if (Number.isFinite(v) && v > 0 && state.ingredientes[i]) {
                                state.ingredientes[i].cantidad = v;
                            }
                        });
                    });
                    wrap.querySelectorAll('.lud-ing-uni').forEach((inp) => {
                        inp.addEventListener('change', () => {
                            const i = Number(inp.dataset.idx);
                            if (state.ingredientes[i]) {
                                state.ingredientes[i].unidad_medida = inp.value.trim() || 'kg';
                            }
                        });
                    });
                    wrap.querySelectorAll('.lud-ing-del').forEach((btn) => {
                        btn.addEventListener('click', () => {
                            const i = Number(btn.dataset.idx);
                            state.ingredientes.splice(i, 1);
                            renderTablaIngredientes();
                        });
                    });
                }

                // Buscador 1: Artículo Puente (AP)
                const inpAp = modalEl.querySelector('#lud-search-ap');
                const ddAp = modalEl.querySelector('#lud-dropdown-ap');
                if (inpAp && ddAp) {
                    inpAp.addEventListener('input', () => {
                        const q = inpAp.value.trim();
                        if (!q) {
                            ddAp.style.display = 'none';
                            return;
                        }
                        const matches = catalogoArticulos
                            .filter((c) => c.sku.toUpperCase() !== state.sku.toUpperCase() && coincideTerminos(`${c.sku} ${c.descripcion_bunker}`, q))
                            .slice(0, 20);
                        if (matches.length === 0) {
                            ddAp.innerHTML = `<div class="lud-dropdown-item" style="color:#94a3b8;">Sin coincidencias para "${esc(q)}"</div>`;
                        } else {
                            ddAp.innerHTML = matches.map((m) => `
                                <div class="lud-dropdown-item" data-sku="${esc(m.sku)}">
                                    <span><b>[${esc(m.sku)}]</b> ${esc(m.descripcion_bunker)}</span>
                                    <span style="color:#94a3b8;">Stock: ${fmtNum(m.stock_bultos)} u</span>
                                </div>
                            `).join('');
                            ddAp.querySelectorAll('.lud-dropdown-item[data-sku]').forEach((el) => {
                                el.addEventListener('click', () => {
                                    state.apCodigo = el.dataset.sku;
                                    inpAp.value = '';
                                    ddAp.style.display = 'none';
                                    renderApResumen();
                                });
                            });
                        }
                        ddAp.style.display = 'block';
                    });
                }

                // Buscador 2: Bultos Crudos / Pre-Mezclas (receta_articulos)
                const inpArt = modalEl.querySelector('#lud-search-art');
                const ddArt = modalEl.querySelector('#lud-dropdown-art');
                if (inpArt && ddArt) {
                    inpArt.addEventListener('input', () => {
                        const q = inpArt.value.trim();
                        if (!q) {
                            ddArt.style.display = 'none';
                            return;
                        }
                        const matches = catalogoArticulos
                            .filter((c) => c.sku.toUpperCase() !== state.sku.toUpperCase() && coincideTerminos(`${c.sku} ${c.descripcion_bunker}`, q))
                            .slice(0, 25);
                        if (matches.length === 0) {
                            ddArt.innerHTML = `<div class="lud-dropdown-item" style="color:#94a3b8;">Sin coincidencias para "${esc(q)}"</div>`;
                        } else {
                            ddArt.innerHTML = matches.map((m) => {
                                const sinStock = (Number(m.stock_bultos) || 0) <= 0;
                                return `
                                    <div class="lud-dropdown-item" data-sku="${esc(m.sku)}">
                                        <div>
                                            <b>[${esc(m.sku)}]</b> ${esc(m.descripcion_bunker)}
                                            <span style="color:#94a3b8;font-size:11.5px;margin-left:6px;">(${fmtNum(m.kilos_unidad, 2)} kg/u)</span>
                                        </div>
                                        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                                            <span style="color:${sinStock ? '#fca5a5' : '#6ee7b7'};font-weight:700;">
                                                ${sinStock ? '🚨 0' : fmtNum(m.stock_bultos)} u (${fmtNum(m.stock_kilos)} kg)
                                            </span>
                                            <span style="color:#cbd5e1;">${fmtMon(m.costo_kilo)}/kg</span>
                                        </div>
                                    </div>
                                `;
                            }).join('');
                            ddArt.querySelectorAll('.lud-dropdown-item[data-sku]').forEach((el) => {
                                el.addEventListener('click', () => {
                                    const chosen = catalogoArticulos.find((x) => x.sku === el.dataset.sku);
                                    if (!chosen) return;
                                    const existing = state.articulos.find((x) => x.articulo_numero.toUpperCase() === chosen.sku.toUpperCase());
                                    if (existing) {
                                        existing.cantidad = Number((Number(existing.cantidad || 0) + 1).toFixed(4));
                                    } else {
                                        state.articulos.push({
                                            articulo_numero: chosen.sku,
                                            descripcion_bunker: chosen.descripcion_bunker,
                                            cantidad: 1,
                                            kilos_unidad: chosen.kilos_unidad,
                                            stock_bultos: chosen.stock_bultos,
                                            stock_kilos: chosen.stock_kilos,
                                            costo_bulto: chosen.costo_bulto,
                                            costo_kilo: chosen.costo_kilo
                                        });
                                    }
                                    inpArt.value = '';
                                    ddArt.style.display = 'none';
                                    renderTablaArticulos();
                                });
                            });
                        }
                        ddArt.style.display = 'block';
                    });
                }

                // Buscador 3: Ingredientes / Envases (receta_ingredientes)
                const inpIng = modalEl.querySelector('#lud-search-ing');
                const ddIng = modalEl.querySelector('#lud-dropdown-ing');
                if (inpIng && ddIng) {
                    inpIng.addEventListener('input', () => {
                        const q = inpIng.value.trim();
                        if (!q) {
                            ddIng.style.display = 'none';
                            return;
                        }
                        const matches = catalogoIngredientes
                            .filter((i) => coincideTerminos(`${i.codigo || ''} ${i.nombre || ''}`, q))
                            .slice(0, 25);
                        if (matches.length === 0) {
                            ddIng.innerHTML = `<div class="lud-dropdown-item" style="color:#94a3b8;">Sin coincidencias para "${esc(q)}"</div>`;
                        } else {
                            ddIng.innerHTML = matches.map((m) => `
                                <div class="lud-dropdown-item" data-id="${m.id}">
                                    <div>
                                        <b>[${esc(m.codigo || '#' + m.id)}]</b> ${esc(m.nombre)}
                                        ${m.es_insumo ? '<span style="color:#93c5fd;font-size:11px;margin-left:6px;">[Envase/Insumo]</span>' : ''}
                                    </div>
                                    <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                                        <span style="color:#cbd5e1;">Stock: ${fmtNum(m.stock_actual)} ${esc(m.unidad_medida)}</span>
                                        <span style="color:#6ee7b7;">${fmtMon(m.costo_patron)}</span>
                                    </div>
                                </div>
                            `).join('');
                            ddIng.querySelectorAll('.lud-dropdown-item[data-id]').forEach((el) => {
                                el.addEventListener('click', () => {
                                    const chosen = catalogoIngredientes.find((x) => Number(x.id) === Number(el.dataset.id));
                                    if (!chosen) return;
                                    const existing = state.ingredientes.find((x) => Number(x.ingrediente_id) === Number(chosen.id));
                                    if (existing) {
                                        existing.cantidad = Number((Number(existing.cantidad || 0) + (chosen.es_insumo ? 1 : 0.1)).toFixed(4));
                                    } else {
                                        state.ingredientes.push({
                                            ingrediente_id: chosen.id,
                                            codigo: chosen.codigo || '',
                                            nombre: chosen.nombre,
                                            unidad_medida: chosen.unidad_medida || (chosen.es_insumo ? 'unidad' : 'kg'),
                                            cantidad: chosen.es_insumo ? 1 : Number(art.kilos_unidad) || 1,
                                            fase_produccion: 'externa',
                                            stock_actual: chosen.stock_actual,
                                            costo_patron: chosen.costo_patron,
                                            es_insumo: chosen.es_insumo
                                        });
                                    }
                                    inpIng.value = '';
                                    ddIng.style.display = 'none';
                                    renderTablaIngredientes();
                                });
                            });
                        }
                        ddIng.style.display = 'block';
                    });
                }

                renderApResumen();
                renderTablaArticulos();
                renderTablaIngredientes();

                // Guardar configuración
                const btnGuardar = modalEl.querySelector('#lud-btn-guardar');
                const statusEl = modalEl.querySelector('#lud-status-msg');
                btnGuardar?.addEventListener('click', async () => {
                    try {
                        if (state.apCodigo && state.apCodigo.toUpperCase() === state.sku.toUpperCase()) {
                            statusEl.style.color = '#fca5a5';
                            statusEl.textContent = '❌ Bloqueado: la UP no puede apuntarse a sí misma como Artículo Puente.';
                            return;
                        }
                        btnGuardar.disabled = true;
                        btnGuardar.textContent = '⏳ Guardando...';

                        const payload = {
                            descripcion: state.descripcionReceta,
                            enlazado_externo: state.enlazadoExterno || Boolean(state.apCodigo),
                            articulos: state.articulos.map((a) => ({
                                articulo_numero: a.articulo_numero,
                                cantidad: Number(a.cantidad)
                            })),
                            ingredientes: state.ingredientes.map((i) => ({
                                ingrediente_id: Number(i.ingrediente_id),
                                cantidad: Number(i.cantidad),
                                unidad_medida: i.unidad_medida || 'kg',
                                fase_produccion: i.fase_produccion || 'externa'
                            })),
                            actualizar_relacion_up: Boolean(art.solo_produccion_externa || state.teniaRelacionUp || state.apCodigo),
                            relacion_up_ap: {
                                articulo_kilo_codigo: state.apCodigo || null,
                                desvincular_ap: Boolean(state.teniaRelacionUp && !state.apCodigo)
                            }
                        };

                        const saveResp = await fetch(`/api/produccion/up-receta-directa/${encodeURIComponent(state.sku)}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const saveJson = await saveResp.json().catch(() => ({}));
                        if (!saveResp.ok) {
                            throw new Error(saveJson.detalle || saveJson.error || `HTTP ${saveResp.status}`);
                        }

                        statusEl.style.color = '#6ee7b7';
                        statusEl.textContent = `✅ ${saveJson.mensaje || 'Configuración guardada correctamente.'}`;

                        const evtDetail = {
                            articulo_numero: state.sku,
                            codigoArticulo: state.sku,
                            resultado: saveJson
                        };
                        window.dispatchEvent(new CustomEvent('recetaActualizada', { detail: evtDetail }));
                        document.dispatchEvent(new CustomEvent('recetaActualizada', { detail: evtDetail }));
                        if (typeof opts.onSaved === 'function') {
                            try { await opts.onSaved(saveJson); } catch (_) {}
                        }

                        setTimeout(() => {
                            cerrarModal();
                        }, 550);
                    } catch (errSave) {
                        btnGuardar.disabled = false;
                        btnGuardar.textContent = '💾 Guardar Configuración';
                        statusEl.style.color = '#fca5a5';
                        statusEl.textContent = `❌ Error: ${errSave.message}`;
                    }
                });
            } catch (errLoad) {
                const bodyEl = overlay.querySelector('.lud-body');
                if (bodyEl) {
                    bodyEl.innerHTML = `<div style="padding:20px;color:#fca5a5;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:8px;">❌ No se pudo cargar la configuración de <b>${esc(skuTarget)}</b>: ${esc(errLoad.message)}</div>`;
                }
            }
        }

        await cargarYRenderizar(skuSolicitado, Boolean(opts.forzarSku));
    };
})();
