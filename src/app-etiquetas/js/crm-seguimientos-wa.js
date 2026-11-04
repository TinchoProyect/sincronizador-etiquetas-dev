/**
 * Módulo Frontend: Seguimientos Comerciales, Armador Dinámico de Ofertas y Recordatorios WhatsApp (CRM)
 * Sistema LAMDA - Pizarra Principal & Monitor Dedicado
 * Estándar Obligatorio: Política Universal de Búsqueda LAMDA (Fase 49)
 */

(function () {
    'use strict';

    let clientesCrmCache = [];
    let seguimientoEnEdicionId = null;
    let tabActiva = 'nuevo'; // 'nuevo' | 'monitor'
    let filtroMonitorEstado = 'TODOS'; // 'TODOS' | 'PENDIENTE' | 'ENVIADO'

    // Estado del Armador Dinámico de Catálogo / Oferta
    let catalogoDinamicoCache = [];
    let listasPreciosCache = [];
    let plantillasWaCache = [];
    let armadorSeleccionadosSet = new Set(); // Set de articulo_id
    let armadorFiltroKilos = '2Y5'; // 'TODOS' | '2Y5' | '2' | '5' | '3' | '1'
    let armadorFiltroFamilia = 'Frutos Secos';
    let armadorFiltroStock = 'TODOS'; // 'TODOS' | 'CON_STOCK'
    let armadorExpanded = false;
    let contactoAnteriorClonado = null;

    /**
     * Nombres y meses en español
     */
    const NOMBRES_DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // =========================================================================
    // 1. MOTOR DE BÚSQUEDA UNIVERSAL LAMDA (FASE 49 - SINGLE SOURCE OF TRUTH)
    // =========================================================================

    function normalizarTextoLamda(txt) {
        if (!txt) return '';
        return String(txt)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    if (typeof window.obtenerTextoBusquedaArticulo !== 'function') {
        window.obtenerTextoBusquedaArticulo = function (art) {
            if (!art) return '';
            const tokens = [];

            if (art.articulo_id) tokens.push(art.articulo_id);
            if (art.articulo_numero && art.articulo_numero !== art.articulo_id) tokens.push(art.articulo_numero);
            if (art.numero) tokens.push(art.numero);
            if (art.codigo) tokens.push(art.codigo);
            if (art.codigo_barras) tokens.push(art.codigo_barras);
            if (art.nombre) tokens.push(art.nombre);
            if (art.descripcion_generada) tokens.push(art.descripcion_generada);
            if (art.descripcion && art.descripcion !== art.descripcion_generada) tokens.push(art.descripcion);
            if (art.nombre_visible && art.nombre_visible !== art.descripcion_generada) tokens.push(art.nombre_visible);
            if (art.articulo_principal_texto) tokens.push(art.articulo_principal_texto);
            if (art.categoria) tokens.push(art.categoria);
            if (art.subcategoria) tokens.push(art.subcategoria);
            if (art.sector_letra) tokens.push(art.sector_letra);
            if (art.sector_nombre) tokens.push(art.sector_nombre);
            if (art.marca) tokens.push(art.marca);
            if (art.unidad_medida) tokens.push(art.unidad_medida);

            const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
            if (famNombre) tokens.push(famNombre);

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

            if (art.kilos_unidad) {
                tokens.push(`${parseFloat(art.kilos_unidad)}kg`);
                tokens.push(`${parseFloat(art.kilos_unidad)}`);
            }

            return normalizarTextoLamda(tokens.filter(Boolean).join(' '));
        };
    }

    function cumpleBusquedaUniversalArt(art, queryRaw) {
        if (!queryRaw) return true;
        const terminos = normalizarTextoLamda(queryRaw).split(/\s+/).filter(Boolean);
        if (terminos.length === 0) return true;
        const bolsa = window.obtenerTextoBusquedaArticulo(art);
        return terminos.every(t => bolsa.includes(t));
    }

    // =========================================================================
    // 2. INYECCIÓN DEL ARMADOR DINÁMICO DE OFERTAS / CATÁLOGO EN EL MODAL
    // =========================================================================

    function asegurarArmadorDinamicoEnModal() {
        if (document.getElementById('crm-armador-dinamico-box')) return;

        const form = document.getElementById('form-programar-whatsapp');
        const bubblesContainer = document.getElementById('crm-bubbles-container');
        if (!form || !bubblesContainer) return;

        const bubblesGroup = bubblesContainer.closest('.form-group');
        if (!bubblesGroup) return;

        // Ampliar levemente el modal para que el armador se vea cómodo
        const modalContent = form.closest('.modal-content');
        if (modalContent) {
            modalContent.style.maxWidth = '720px';
        }

        // Badge de lista asignada junto al selector de cliente
        const cliSelect = document.getElementById('crm-cliente-select');
        if (cliSelect && !document.getElementById('crm-cliente-lista-badge')) {
            const badgeDiv = document.createElement('div');
            badgeDiv.id = 'crm-cliente-lista-badge';
            badgeDiv.style.cssText = 'margin-top: 5px; font-size: 0.78rem; color: #166534; display: none; align-items: center; justify-content: space-between; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 4px 10px; border-radius: 6px;';
            cliSelect.parentNode.appendChild(badgeDiv);
        }

        const box = document.createElement('div');
        box.id = 'crm-armador-dinamico-box';
        box.style.cssText = 'background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px;';
        box.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; gap: 8px;" onclick="window.toggleArmadorDinamicoWa()">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; color: #14532d; font-size: 0.9rem;">
                    <span id="crm-armador-chevron" style="font-size: 0.8rem; color: #15803d;">▶</span>
                    <span>🧺 Armador Dinámico de Oferta / Catálogo (Fracciones 2kg/5kg & Perfiles)</span>
                    <span id="crm-armador-count-badge" style="background: #16a34a; color: white; font-size: 0.72rem; padding: 1px 8px; border-radius: 10px; font-weight: 800;">0 art.</span>
                </div>
                <span style="font-size: 0.75rem; color: #15803d; font-weight: 700;">Click para abrir/cerrar</span>
            </div>

            <div id="crm-armador-body" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #bbf7d0;">
                <!-- Fila 1: Perfil / Combo Reutilizable -->
                <div style="background: white; border: 1px solid #dcfce7; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                        <label style="font-size: 0.8rem; font-weight: 700; color: #166534; margin: 0;">
                            🔖 Perfil / Combo de Interés Reutilizable (para clientes similares):
                        </label>
                        <div style="display: flex; gap: 6px;">
                            <button type="button" onclick="window.guardarPerfilPlantillaWa()" style="background: #ecfdf5; border: 1px solid #6ee7b7; color: #047857; font-size: 0.74rem; font-weight: 700; padding: 3px 8px; border-radius: 5px; cursor: pointer;" title="Guarda la selección actual de productos como un Perfil reutilizable para otros clientes">
                                💾 Guardar como Perfil
                            </button>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                        <select id="crm-armador-plantilla-select" onchange="window.onSeleccionarPlantillaWa()" style="flex: 1; min-width: 220px; padding: 6px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.84rem; font-weight: 600; color: #0f172a;">
                            <option value="">-- Seleccionar Perfil / Combo guardado --</option>
                        </select>
                        <button type="button" onclick="window.aplicarPlantillaSeleccionadaWa(true)" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">
                            ⚡ Cargar y Generar
                        </button>
                    </div>
                </div>

                <!-- Fila 2: Filtros Rápidos de Fracción, Familia, Stock y Buscador Universal -->
                <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px;">
                    <span style="font-size: 0.76rem; font-weight: 700; color: #334155;">Fracción:</span>
                    <button type="button" class="crm-kilo-pill active" data-kilo="2Y5" onclick="window.setFiltroKilosArmador('2Y5')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #16a34a; background: #16a34a; color: white; font-size: 0.74rem; font-weight: 700; cursor: pointer;">⭐ 2 y 5 kg (Verdulería)</button>
                    <button type="button" class="crm-kilo-pill" data-kilo="2" onclick="window.setFiltroKilosArmador('2')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #334155; font-size: 0.74rem; font-weight: 600; cursor: pointer;">Solo 2 kg</button>
                    <button type="button" class="crm-kilo-pill" data-kilo="5" onclick="window.setFiltroKilosArmador('5')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #334155; font-size: 0.74rem; font-weight: 600; cursor: pointer;">Solo 5 kg</button>
                    <button type="button" class="crm-kilo-pill" data-kilo="3" onclick="window.setFiltroKilosArmador('3')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #334155; font-size: 0.74rem; font-weight: 600; cursor: pointer;">3 kg</button>
                    <button type="button" class="crm-kilo-pill" data-kilo="1" onclick="window.setFiltroKilosArmador('1')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #334155; font-size: 0.74rem; font-weight: 600; cursor: pointer;">1 kg</button>
                    <button type="button" class="crm-kilo-pill" data-kilo="TODOS" onclick="window.setFiltroKilosArmador('TODOS')" style="padding: 3px 9px; border-radius: 14px; border: 1px solid #cbd5e1; background: white; color: #334155; font-size: 0.74rem; font-weight: 600; cursor: pointer;">Todas</button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 6px; margin-bottom: 8px;">
                    <select id="crm-armador-familia-select" onchange="window.renderListaArticulosArmador()" style="padding: 5px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
                        <option value="TODAS">Todas las familias</option>
                        <option value="Frutos Secos" selected>🥜 Frutos Secos</option>
                    </select>
                    <select id="crm-armador-stock-select" onchange="window.renderListaArticulosArmador()" style="padding: 5px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
                        <option value="TODOS">📦 Envasados + A envasar</option>
                        <option value="CON_STOCK">🟢 Solo ya envasados en stock</option>
                    </select>
                    <input type="text" id="crm-armador-search-input" oninput="window.renderListaArticulosArmador()" placeholder="🔍 Buscar (ej: nuez, caju tost, pistacho)..." style="padding: 5px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.8rem;" autocomplete="off">
                </div>

                <!-- Fila 3: Lista de Precios, Formato y Descuento -->
                <div style="display: grid; grid-template-columns: 1.1fr 1.2fr 0.7fr; gap: 6px; margin-bottom: 8px; background: white; padding: 6px 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <div>
                        <label style="font-size: 0.7rem; color: #64748b; display: block; font-weight: 700;">Lista de Precios:</label>
                        <select id="crm-armador-lista-select" onchange="window.renderListaArticulosArmador()" style="width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #cbd5e1; font-size: 0.8rem; font-weight: 700; color: #15803d;">
                            <option value="5">Dietetica</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.7rem; color: #64748b; display: block; font-weight: 700;">Formato en el mensaje:</label>
                        <select id="crm-armador-formato-select" onchange="window.renderListaArticulosArmador()" style="width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
                            <option value="BOLSA" selected>💰 Precio por bolsa cerrada (2kg / 5kg)</option>
                            <option value="BOLSA_Y_KG">💰 Precio por bolsa + valor $/kg</option>
                            <option value="KILO">⚖️ Precio por kilo ($/kg)</option>
                            <option value="SIN_PRECIO">📋 Sin precios (solo variedades)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.7rem; color: #64748b; display: block; font-weight: 700;">Bonif. % (opc):</label>
                        <input type="number" id="crm-armador-descuento-input" value="0" min="0" max="50" step="0.5" oninput="window.renderListaArticulosArmador()" style="width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #cbd5e1; font-size: 0.8rem; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Fila 4: Acciones sobre la grilla y listado de artículos -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 0.76rem;">
                    <span id="crm-armador-resumen-filtro" style="color: #475569; font-weight: 600;">Mostrando 0 productos</span>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" onclick="window.marcarVisiblesArmador(true)" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 7px; font-size: 0.72rem; cursor: pointer; font-weight: 600;">☑️ Marcar filtrados</button>
                        <button type="button" onclick="window.marcarVisiblesArmador(false)" style="background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 4px; padding: 2px 7px; font-size: 0.72rem; cursor: pointer; font-weight: 600;">🧹 Limpiar selección</button>
                    </div>
                </div>

                <div id="crm-armador-articulos-list" style="max-height: 195px; overflow-y: auto; background: white; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px; margin-bottom: 8px;"></div>

                <!-- Fila 5: Botón de Generación Dinámica -->
                <button type="button" onclick="window.volcarPropuestaEnBurbujasWa()" style="width: 100%; background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; border: none; border-radius: 7px; padding: 8px 12px; font-weight: 800; font-size: 0.86rem; cursor: pointer; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.25);">
                    ✨ Generar / Actualizar Burbujas de WhatsApp con los Productos Seleccionados
                </button>
            </div>
        `;

        bubblesGroup.parentNode.insertBefore(box, bubblesGroup);
    }

    window.toggleArmadorDinamicoWa = function (forzarEstado = null) {
        armadorExpanded = forzarEstado !== null ? Boolean(forzarEstado) : !armadorExpanded;
        const body = document.getElementById('crm-armador-body');
        const chev = document.getElementById('crm-armador-chevron');
        if (body) body.style.display = armadorExpanded ? 'block' : 'none';
        if (chev) chev.textContent = armadorExpanded ? '▼' : '▶';
    };

    window.cargarCatalogoYPlantillasWa = async function () {
        asegurarArmadorDinamicoEnModal();
        try {
            const [resCat, resPl] = await Promise.all([
                catalogoDinamicoCache.length > 0
                    ? Promise.resolve({ success: true, articulos: catalogoDinamicoCache, listas: listasPreciosCache })
                    : fetch('/api/crm/catalogo-dinamico').then(r => r.json()),
                fetch('/api/crm/plantillas-wa').then(r => r.json())
            ]);

            if (resCat && resCat.success) {
                catalogoDinamicoCache = resCat.articulos || [];
                listasPreciosCache = resCat.listas || [];

                // Poblar selector de familias
                const famSelect = document.getElementById('crm-armador-familia-select');
                if (famSelect) {
                    const fams = Array.from(new Set(catalogoDinamicoCache.map(a => a.familia_nombre).filter(Boolean))).sort();
                    const valorActual = famSelect.value || 'Frutos Secos';
                    famSelect.innerHTML = `<option value="TODAS">Todas las familias</option>` +
                        fams.map(f => `<option value="${f}" ${f === valorActual ? 'selected' : ''}>${f === 'Frutos Secos' ? '🥜 ' : ''}${f}</option>`).join('');
                }

                // Poblar selector de listas de precios
                const listaSelect = document.getElementById('crm-armador-lista-select');
                if (listaSelect && listasPreciosCache.length > 0) {
                    const valLista = listaSelect.value || '5';
                    listaSelect.innerHTML = listasPreciosCache.map(l =>
                        `<option value="${l.id}" ${String(l.id) === String(valLista) ? 'selected' : ''}>${l.nombre}</option>`
                    ).join('');
                }
            }

            if (resPl && resPl.success && Array.isArray(resPl.data)) {
                plantillasWaCache = resPl.data;
                renderSelectorPlantillasWa();
            }

            window.renderListaArticulosArmador();
        } catch (err) {
            console.warn('⚠️ Error cargando catálogo dinámico WA:', err.message);
        }
    };

    function renderSelectorPlantillasWa(seleccionadaId = null) {
        const sel = document.getElementById('crm-armador-plantilla-select');
        if (!sel) return;
        const actualId = seleccionadaId || sel.value || (plantillasWaCache[0]?.id ? String(plantillasWaCache[0].id) : '');
        sel.innerHTML = `<option value="">-- Seleccionar Perfil / Combo guardado --</option>` +
            plantillasWaCache.map(p => {
                const cant = Array.isArray(p.articulos_codigos) ? p.articulos_codigos.length : 0;
                return `<option value="${p.id}" ${String(p.id) === String(actualId) ? 'selected' : ''}>${p.nombre} (${cant} art.)</option>`;
            }).join('');
    }

    window.onSeleccionarPlantillaWa = function () {
        window.aplicarPlantillaSeleccionadaWa(false);
    };

    window.aplicarPlantillaSeleccionadaWa = function (volcarEnBurbujas = false) {
        const sel = document.getElementById('crm-armador-plantilla-select');
        if (!sel || !sel.value) return;
        const p = plantillasWaCache.find(x => String(x.id) === String(sel.value));
        if (!p) return;

        let codigos = p.articulos_codigos || [];
        if (typeof codigos === 'string') {
            try { codigos = JSON.parse(codigos); } catch (e) { codigos = []; }
        }
        armadorSeleccionadosSet = new Set(Array.isArray(codigos) ? codigos : []);

        const fmtSel = document.getElementById('crm-armador-formato-select');
        if (fmtSel && p.formato_precio) fmtSel.value = p.formato_precio;

        const descInp = document.getElementById('crm-armador-descuento-input');
        if (descInp && p.descuento_pct !== undefined) descInp.value = Number(p.descuento_pct || 0);

        window.renderListaArticulosArmador();
        if (volcarEnBurbujas) {
            window.volcarPropuestaEnBurbujasWa(p);
        }
    };

    window.setFiltroKilosArmador = function (kiloMode) {
        armadorFiltroKilos = kiloMode;
        const btns = document.querySelectorAll('.crm-kilo-pill');
        btns.forEach(b => {
            const activo = b.getAttribute('data-kilo') === kiloMode;
            b.style.background = activo ? '#16a34a' : 'white';
            b.style.color = activo ? 'white' : '#334155';
            b.style.borderColor = activo ? '#16a34a' : '#cbd5e1';
            b.style.fontWeight = activo ? '700' : '600';
        });
        window.renderListaArticulosArmador();
    };

    function obtenerArticulosFiltradosArmador() {
        const fam = document.getElementById('crm-armador-familia-select')?.value || 'TODAS';
        const stockMode = document.getElementById('crm-armador-stock-select')?.value || 'TODOS';
        const q = document.getElementById('crm-armador-search-input')?.value || '';

        return catalogoDinamicoCache.filter(art => {
            if (fam !== 'TODAS' && art.familia_nombre !== fam) return false;
            if (stockMode === 'CON_STOCK' && !(art.stock_real > 0)) return false;

            const k = Number(art.kilos_unidad || 0);
            if (armadorFiltroKilos === '2Y5') {
                if (![2, 3, 5].includes(k)) return false;
            } else if (armadorFiltroKilos === '2') {
                if (k !== 2) return false;
            } else if (armadorFiltroKilos === '5') {
                if (k !== 5) return false;
            } else if (armadorFiltroKilos === '3') {
                if (k !== 3) return false;
            } else if (armadorFiltroKilos === '1') {
                if (k !== 1) return false;
            }

            return cumpleBusquedaUniversalArt(art, q);
        });
    }

    function obtenerPrecioArticuloLista(art, listaId, descPct = 0) {
        const raw = (art.precios && art.precios[listaId]) || (art.precios && art.precios[5]) || 0;
        if (!raw) return 0;
        const factor = descPct > 0 ? (1 - descPct / 100) : 1;
        return Math.round(raw * factor);
    }

    window.renderListaArticulosArmador = function () {
        const listEl = document.getElementById('crm-armador-articulos-list');
        const badgeEl = document.getElementById('crm-armador-count-badge');
        const resEl = document.getElementById('crm-armador-resumen-filtro');
        if (badgeEl) badgeEl.textContent = `${armadorSeleccionadosSet.size} art.`;
        if (!listEl) return;

        const listaId = parseInt(document.getElementById('crm-armador-lista-select')?.value || '5', 10);
        const descPct = parseFloat(document.getElementById('crm-armador-descuento-input')?.value || '0') || 0;
        const filtrados = obtenerArticulosFiltradosArmador();

        if (resEl) {
            resEl.textContent = `Mostrando ${filtrados.length} producto(s) · ${armadorSeleccionadosSet.size} seleccionado(s) en total`;
        }

        if (filtrados.length === 0) {
            listEl.innerHTML = `<div style="padding: 14px; text-align: center; color: #64748b; font-size: 0.8rem;">No hay artículos que coincidan con el filtro actual.</div>`;
            return;
        }

        listEl.innerHTML = filtrados.map(art => {
            const checked = armadorSeleccionadosSet.has(art.articulo_id) ? 'checked' : '';
            const precioBolsa = obtenerPrecioArticuloLista(art, listaId, descPct);
            const precioStr = precioBolsa > 0 ? `$${precioBolsa.toLocaleString('es-AR')}` : 'S/P';
            const tieneStock = art.stock_real > 0;
            const stockBadge = tieneStock
                ? `<span style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:1px 6px; border-radius:4px; font-size:0.68rem; font-weight:700;">🟢 ${art.stock_real} u. stock</span>`
                : `<span style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; padding:1px 6px; border-radius:4px; font-size:0.68rem;">🏭 A envasar</span>`;

            return `
                <label style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 8px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 0.8rem; background: ${checked ? '#f0fdf4' : 'white'};">
                    <div style="display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1;">
                        <input type="checkbox" ${checked} onchange="window.toggleArticuloArmador('${art.articulo_id}', this.checked)">
                        <span style="font-weight: ${checked ? '700' : '500'}; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${art.nombre_visible}</span>
                        <code style="font-size: 0.7rem; color: #64748b; background: #f8fafc; padding: 1px 4px; border-radius: 3px;">${art.articulo_id}</code>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                        ${stockBadge}
                        <strong style="color: #15803d; min-width: 68px; text-align: right;">${precioStr}</strong>
                    </div>
                </label>
            `;
        }).join('');
    };

    window.toggleArticuloArmador = function (articuloId, isChecked) {
        if (isChecked) armadorSeleccionadosSet.add(articuloId);
        else armadorSeleccionadosSet.delete(articuloId);
        window.renderListaArticulosArmador();
    };

    window.marcarVisiblesArmador = function (marcar) {
        if (!marcar) {
            armadorSeleccionadosSet.clear();
        } else {
            const visibles = obtenerArticulosFiltradosArmador();
            visibles.forEach(a => armadorSeleccionadosSet.add(a.articulo_id));
        }
        window.renderListaArticulosArmador();
    };

    /**
     * Clasifica un artículo en su categoría visual para armar un mensaje de WhatsApp prolijo
     */
    function clasificarRubroWhatsApp(art) {
        const nom = (art.nombre_visible || '').toLowerCase();
        if (nom.includes('nuez') || nom.includes('nueces') || nom.includes('pecan')) return '🌰 *NUECES*';
        if (nom.includes('almendra')) return '🥜 *ALMENDRAS (Naturales, Tostadas y Saladas)*';
        if (nom.includes('avellana') || nom.includes('pistacho')) return '🌰 *AVELLANAS Y PISTACHOS*';
        if (nom.includes('castaña') || nom.includes('caju') || nom.includes('pará') || nom.includes('para ')) return '🥜 *CASTAÑAS DE CAJÚ Y DE PARÁ*';
        if (nom.includes('mix')) return '🥗 *MIXES DE FRUTOS SECOS*';
        return `📦 *${(art.familia_nombre || 'OTROS PRODUCTOS').toUpperCase()}*`;
    }

    /**
     * Limpia el nombre base del artículo quitando el sufijo "x 2kg" / "x 5kg" para agrupar presentaciones hermanas
     */
    function obtenerNombreBaseProducto(nombreVisible) {
        return String(nombreVisible || '')
            .replace(/\s+x\s*\d+([.,]\d+)?\s*kg\b/i, '')
            .replace(/\bTOTDO\b/i, 'Tostado')
            .replace(/\bTOST\/SAL\b/i, 'Tostada y Salada')
            .replace(/\bCHLER\b/i, 'Chandler')
            .replace(/\bMPSA\b/i, 'Mariposa')
            .replace(/\bEXLIGHT\b/i, 'Exlight')
            .replace(/\bC\/CAS\b/i, 'con Cáscara')
            .replace(/\bPELA\b/i, 'Pelado')
            .replace(/\bF\/SCOS\b/i, 'Frutos Secos')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    /**
     * Construye las burbujas de WhatsApp dinámicamente según los productos seleccionados,
     * el contacto actual y la lista de precios activa.
     */
    window.construirBurbujasDesdeArmador = function (plantillaOpcional = null) {
        const seleccionados = catalogoDinamicoCache.filter(a => armadorSeleccionadosSet.has(a.articulo_id));
        if (seleccionados.length === 0) return [];

        const contactoNombre = (document.getElementById('crm-contacto-nombre-input')?.value || '').trim() || 'Hola';
        const primerNombre = contactoNombre.split(/\s+/)[0] || contactoNombre;
        const listaId = parseInt(document.getElementById('crm-armador-lista-select')?.value || '5', 10);
        const formatoPrecio = document.getElementById('crm-armador-formato-select')?.value || 'BOLSA';
        const descPct = parseFloat(document.getElementById('crm-armador-descuento-input')?.value || '0') || 0;

        const selPlantillaId = document.getElementById('crm-armador-plantilla-select')?.value;
        const plantillaActiva = plantillaOpcional || plantillasWaCache.find(p => String(p.id) === String(selPlantillaId));

        const saludoBase = (plantillaActiva && plantillaActiva.saludo_template)
            ? plantillaActiva.saludo_template
            : '¡Hola {contacto}! ¿Cómo estás? Te paso el listado de frutos secos fraccionados en bolsas de 2 kg y 5 kg que tenemos preparados para que puedas ofrecer en tu comercio:';

        const cierreBase = (plantillaActiva && plantillaActiva.cierre_template)
            ? plantillaActiva.cierre_template
            : 'Como estamos acá cerquita, si querés probar alguna fracción de 2 kg o de 5 kg avisame cuál te sirve y te lo alcanzo sin cargo. ¡Que tengas un excelente arranque de semana!';

        const burbujaSaludo = saludoBase.replace(/\{contacto\}/gi, primerNombre);
        const burbujaCierre = cierreBase.replace(/\{contacto\}/gi, primerNombre);

        // Agrupar por Rubro y luego por Nombre Base para unir 2kg y 5kg en un mismo renglón
        const ordenRubros = [
            '🌰 *NUECES*',
            '🥜 *ALMENDRAS (Naturales, Tostadas y Saladas)*',
            '🌰 *AVELLANAS Y PISTACHOS*',
            '🥜 *CASTAÑAS DE CAJÚ Y DE PARÁ*',
            '🥗 *MIXES DE FRUTOS SECOS*'
        ];

        const mapaRubros = new Map();
        seleccionados.forEach(art => {
            const rubro = clasificarRubroWhatsApp(art);
            if (!mapaRubros.has(rubro)) mapaRubros.set(rubro, new Map());
            const mapaProductos = mapaRubros.get(rubro);
            const nombreBase = obtenerNombreBaseProducto(art.nombre_visible);
            if (!mapaProductos.has(nombreBase)) mapaProductos.set(nombreBase, []);
            mapaProductos.get(nombreBase).push(art);
        });

        const rubrosOrdenados = Array.from(mapaRubros.keys()).sort((a, b) => {
            const ia = ordenRubros.indexOf(a);
            const ib = ordenRubros.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });

        const bloquesRubros = [];
        for (const rubro of rubrosOrdenados) {
            const lineasRubro = [rubro];
            const mapaProductos = mapaRubros.get(rubro);

            for (const [nombreBase, presentaciones] of mapaProductos.entries()) {
                presentaciones.sort((a, b) => a.kilos_unidad - b.kilos_unidad);

                const partesPres = presentaciones.map(p => {
                    const k = p.kilos_unidad;
                    const precioBolsa = obtenerPrecioArticuloLista(p, listaId, descPct);
                    const precioKg = k > 0 ? Math.round(precioBolsa / k) : precioBolsa;

                    if (formatoPrecio === 'SIN_PRECIO' || !precioBolsa) {
                        return `x ${k}kg`;
                    } else if (formatoPrecio === 'KILO') {
                        return `x ${k}kg (*$${precioKg.toLocaleString('es-AR')}/kg*)`;
                    } else if (formatoPrecio === 'BOLSA_Y_KG') {
                        return `x ${k}kg *$${precioBolsa.toLocaleString('es-AR')}* ($${precioKg.toLocaleString('es-AR')}/kg)`;
                    } else {
                        return `x ${k}kg *$${precioBolsa.toLocaleString('es-AR')}*`;
                    }
                });

                lineasRubro.push(`• ${nombreBase}: ${partesPres.join(' | ')}`);
            }

            bloquesRubros.push(lineasRubro.join('\n'));
        }

        // Si hay muchos rubros, partir el catálogo en 2 burbujas para lectura cómoda en el celular
        const burbujasCatalogo = [];
        if (bloquesRubros.length >= 4) {
            burbujasCatalogo.push(bloquesRubros.slice(0, 3).join('\n\n'));
            burbujasCatalogo.push(bloquesRubros.slice(3).join('\n\n'));
        } else {
            burbujasCatalogo.push(bloquesRubros.join('\n\n'));
        }

        return [burbujaSaludo, ...burbujasCatalogo, burbujaCierre];
    };

    window.volcarPropuestaEnBurbujasWa = function (plantillaOpcional = null) {
        if (armadorSeleccionadosSet.size === 0) {
            Swal.fire('Atención', 'Seleccioná al menos un producto en el Armador Dinámico o elegí un Perfil arriba.', 'warning');
            return;
        }

        const burbujas = window.construirBurbujasDesdeArmador(plantillaOpcional);
        const container = document.getElementById('crm-bubbles-container');
        if (!container) return;

        container.innerHTML = '';
        burbujas.forEach(b => window.agregarBurbujaMensaje(b));

        // Actualizar nota estratégica si está vacía
        const notaInput = document.getElementById('crm-nota-input');
        const listaSel = document.getElementById('crm-armador-lista-select');
        const listaNombre = listaSel?.options[listaSel.selectedIndex]?.text || 'Lista asignada';
        if (notaInput && !notaInput.value.trim()) {
            notaInput.value = `Propuesta dinámica Frutos Secos 2kg/5kg (${armadorSeleccionadosSet.size} art. — ${listaNombre})`;
        }
    };

    /**
     * Guarda la selección actual como un Perfil / Plantilla reutilizable en base de datos
     */
    window.guardarPerfilPlantillaWa = async function () {
        if (armadorSeleccionadosSet.size === 0) {
            Swal.fire('Atención', 'Marcá primero los productos que querés guardar en el Perfil.', 'info');
            return;
        }

        const sel = document.getElementById('crm-armador-plantilla-select');
        const plantillaActual = plantillasWaCache.find(p => String(p.id) === String(sel?.value || ''));

        const { value: formValues } = await Swal.fire({
            title: '💾 Guardar Perfil / Combo Comercial',
            html: `
                <div style="text-align: left; font-size: 0.88rem;">
                    <p style="color: #475569; margin-bottom: 10px;">
                        Este perfil guardará los <strong>${armadorSeleccionadosSet.size} artículos seleccionados</strong> para que puedas reutilizarlos en 1 clic con cualquier cliente similar (actualizando su nombre y su lista de precios).
                    </p>
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Nombre del Perfil:</label>
                    <input id="swal-pl-nombre" class="swal2-input" style="margin: 0 0 10px 0; width: 100%; font-size: 0.9rem;" value="${plantillaActual ? plantillaActual.nombre : '🌱 Perfil Verdulería — Frutos Secos (2 kg y 5 kg)'}">
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Saludo base (usá {contacto}):</label>
                    <textarea id="swal-pl-saludo" class="swal2-textarea" style="margin: 0 0 10px 0; width: 100%; height: 68px; font-size: 0.84rem;">${plantillaActual?.saludo_template || '¡Hola {contacto}! ¿Cómo estás? Te paso el listado de frutos secos fraccionados en bolsas de 2 kg y 5 kg que tenemos preparados para que puedas ofrecer en la verdulería:'}</textarea>
                    <label style="font-weight: 700; display: block; margin-bottom: 4px;">Cierre base:</label>
                    <textarea id="swal-pl-cierre" class="swal2-textarea" style="margin: 0; width: 100%; height: 68px; font-size: 0.84rem;">${plantillaActual?.cierre_template || 'Como estamos acá cerquita, si querés probar alguna fracción de 2 kg o de 5 kg avisame cuál te sirve y te lo alcanzo sin cargo. ¡Que tengas un excelente arranque de semana!'}</textarea>
                </div>
            `,
            showDenyButton: Boolean(plantillaActual),
            showCancelButton: true,
            confirmButtonText: plantillaActual ? '💾 Actualizar Perfil Actual' : '💾 Crear Nuevo Perfil',
            denyButtonText: '➕ Guardar como Nuevo',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#16a34a',
            denyButtonColor: '#2563eb',
            preConfirm: () => ({
                modo: 'ACTUALIZAR',
                nombre: document.getElementById('swal-pl-nombre').value.trim(),
                saludo: document.getElementById('swal-pl-saludo').value.trim(),
                cierre: document.getElementById('swal-pl-cierre').value.trim()
            }),
            preDeny: () => ({
                modo: 'NUEVO',
                nombre: document.getElementById('swal-pl-nombre').value.trim(),
                saludo: document.getElementById('swal-pl-saludo').value.trim(),
                cierre: document.getElementById('swal-pl-cierre').value.trim()
            })
        });

        if (!formValues || !formValues.nombre) return;

        try {
            const payload = {
                id: (formValues.modo === 'ACTUALIZAR' && plantillaActual) ? plantillaActual.id : null,
                nombre: formValues.nombre,
                articulos_codigos: Array.from(armadorSeleccionadosSet),
                formato_precio: document.getElementById('crm-armador-formato-select')?.value || 'BOLSA',
                descuento_pct: parseFloat(document.getElementById('crm-armador-descuento-input')?.value || '0') || 0,
                saludo_template: formValues.saludo,
                cierre_template: formValues.cierre
            };

            const res = await fetch('/api/crm/plantillas-wa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error guardando perfil');

            const resPl = await fetch('/api/crm/plantillas-wa').then(r => r.json());
            if (resPl.success) {
                plantillasWaCache = resPl.data || [];
                renderSelectorPlantillasWa(data.data.id);
            }

            Swal.fire({
                icon: 'success',
                title: '¡Perfil Guardado!',
                text: `El perfil "${data.data.nombre}" quedó listo para usar con cualquier cliente similar.`,
                timer: 2200,
                showConfirmButton: false
            });
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    };

    // =========================================================================
    // 3. GESTIÓN DE FECHAS, PESTAÑAS Y MODAL PROGRAMADOR
    // =========================================================================

    function generarShortcutsDias(fechaSeleccionada = null) {
        const container = document.getElementById('crm-shortcuts-container');
        if (!container) return;
        container.innerHTML = '';

        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const yyyyMmDd = d.toLocaleDateString('en-CA');
            const diaSemana = NOMBRES_DIAS[d.getDay()];
            const diaNum = d.getDate();
            const mes = MESES[d.getMonth()];

            let label = '';
            if (i === 0) label = `Hoy (${diaSemana} ${diaNum})`;
            else if (i === 1) label = `Mañana (${diaSemana} ${diaNum})`;
            else label = `${diaSemana} ${diaNum}/${mes}`;

            const isSelected = fechaSeleccionada === yyyyMmDd;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `crm-pill-btn ${isSelected ? 'selected' : ''}`;
            btn.setAttribute('data-fecha', yyyyMmDd);
            btn.innerHTML = `📅 ${label}`;
            btn.onclick = () => window.seleccionarFechaShortcut(yyyyMmDd);
            container.appendChild(btn);
        }
    }

    window.seleccionarFechaShortcut = function (fechaYyyyMmDd) {
        const input = document.getElementById('crm-fecha-input');
        if (input) input.value = fechaYyyyMmDd;

        const pills = document.querySelectorAll('#crm-shortcuts-container .crm-pill-btn');
        pills.forEach(p => {
            if (p.getAttribute('data-fecha') === fechaYyyyMmDd) {
                p.classList.add('selected');
            } else {
                p.classList.remove('selected');
            }
        });
    };

    window.cambiarTabCrm = function (tab) {
        tabActiva = tab;
        const tabNuevo = document.getElementById('crm-tab-btn-nuevo');
        const tabMonitor = document.getElementById('crm-tab-btn-monitor');
        const vistaNuevo = document.getElementById('crm-vista-nuevo');
        const vistaMonitor = document.getElementById('crm-vista-monitor');

        if (tab === 'nuevo') {
            if (tabNuevo) tabNuevo.classList.add('active');
            if (tabMonitor) tabMonitor.classList.remove('active');
            if (vistaNuevo) vistaNuevo.style.display = 'block';
            if (vistaMonitor) vistaMonitor.style.display = 'none';
        } else {
            if (tabNuevo) tabNuevo.classList.remove('active');
            if (tabMonitor) tabMonitor.classList.add('active');
            if (vistaNuevo) vistaNuevo.style.display = 'none';
            if (vistaMonitor) vistaMonitor.style.display = 'block';
            window.cargarMonitorSeguimientos();
        }
    };

    /**
     * Abre el modal para programar, editar o compartir con otro cliente similar
     */
    window.abrirModalProgramarWhatsApp = async function (seguimientoId = null, tabInicial = 'nuevo') {
        seguimientoEnEdicionId = seguimientoId;
        contactoAnteriorClonado = null;
        const modal = document.getElementById('modal-programar-whatsapp');
        if (!modal) return;

        asegurarArmadorDinamicoEnModal();

        const tituloModal = document.getElementById('crm-modal-titulo');
        if (tituloModal) {
            tituloModal.textContent = seguimientoId ? '✏️ Editar Seguimiento WhatsApp' : '📅 Programador & Monitor WhatsApp';
        }

        await Promise.all([
            window.cargarClientesCrm(),
            window.cargarCatalogoYPlantillasWa()
        ]);

        window.actualizarBadgeProgramados();

        if (seguimientoId) {
            window.cambiarTabCrm('nuevo');
            try {
                const res = await fetch(`/api/crm/seguimientos/resumen`);
                const data = await res.json();
                if (data.success && Array.isArray(data.todos)) {
                    const item = data.todos.find(s => s.id === seguimientoId);
                    if (item) {
                        document.getElementById('crm-cliente-search').value = item.cliente_nombre || '';
                        window.filtrarClientesCrm(item.cliente_nombre || '');
                        document.getElementById('crm-cliente-select').value = item.bunker_cliente_id || '';
                        await window.onCrmClienteSeleccionado();
                        document.getElementById('crm-contacto-nombre-input').value = item.contacto_nombre || '';
                        document.getElementById('crm-telefono-input').value = item.telefono_destino || '';
                        document.getElementById('crm-fecha-input').value = item.fecha_programada || '';
                        document.getElementById('crm-hora-input').value = item.hora_programada || '09:00';
                        document.getElementById('crm-nota-input').value = item.nota_interna || '';

                        generarShortcutsDias(item.fecha_programada);

                        // Restaurar artículos seleccionados si los tenía
                        let cods = item.articulos_codigos;
                        if (typeof cods === 'string') {
                            try { cods = JSON.parse(cods); } catch (e) { cods = []; }
                        }
                        if (Array.isArray(cods) && cods.length > 0) {
                            armadorSeleccionadosSet = new Set(cods);
                            window.renderListaArticulosArmador();
                        }

                        const bubblesContainer = document.getElementById('crm-bubbles-container');
                        bubblesContainer.innerHTML = '';

                        let msgs = item.mensajes;
                        if (typeof msgs === 'string') {
                            try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
                        }
                        if (Array.isArray(msgs) && msgs.length > 0) {
                            msgs.forEach(m => window.agregarBurbujaMensaje(m));
                        } else {
                            window.agregarBurbujaMensaje('');
                        }
                    }
                }
            } catch (err) {
                console.error('Error cargando seguimiento para editar:', err);
            }
        } else {
            document.getElementById('crm-cliente-search').value = '';
            window.filtrarClientesCrm('');
            document.getElementById('crm-cliente-select').value = '';
            document.getElementById('crm-contacto-select').innerHTML = '<option value="">Primero seleccione un cliente...</option>';
            document.getElementById('crm-contacto-select').disabled = true;
            document.getElementById('crm-contacto-nombre-input').value = '';
            document.getElementById('crm-telefono-input').value = '';

            const badgeLista = document.getElementById('crm-cliente-lista-badge');
            if (badgeLista) badgeLista.style.display = 'none';

            // Si hoy es lunes, sugerir hoy mismo a las 09:00; si no, el próximo día hábil
            const hoy = new Date();
            const fechaDefecto = hoy.getDay() === 1 ? hoy.toLocaleDateString('en-CA') : getProximoLunesOMartes();
            document.getElementById('crm-fecha-input').value = fechaDefecto;
            document.getElementById('crm-hora-input').value = '09:00';
            document.getElementById('crm-nota-input').value = '';

            generarShortcutsDias(fechaDefecto);

            // Precargar la plantilla 1 (Pack Verdulería 2kg y 5kg) en el selector sin volcar todavía
            if (plantillasWaCache.length > 0) {
                renderSelectorPlantillasWa(plantillasWaCache[0].id);
                window.aplicarPlantillaSeleccionadaWa(false);
            }

            const bubblesContainer = document.getElementById('crm-bubbles-container');
            bubblesContainer.innerHTML = '';
            window.agregarBurbujaMensaje('');

            window.cambiarTabCrm(tabInicial);
        }

        modal.style.display = 'flex';
    };

    /**
     * Clona/Comparte un seguimiento existente para enviarlo o programarlo a OTRO cliente con intereses similares
     */
    window.compartirSeguimientoConOtroCliente = async function (seguimientoOrigenId) {
        try {
            const res = await fetch('/api/crm/seguimientos/resumen');
            const data = await res.json();
            const origen = (data.todos || []).find(s => s.id === seguimientoOrigenId);
            if (!origen) {
                Swal.fire('Error', 'No se encontró el seguimiento original para compartir.', 'error');
                return;
            }

            await window.abrirModalProgramarWhatsApp(null, 'nuevo');
            seguimientoEnEdicionId = null; // Es un NUEVO seguimiento para otro cliente
            contactoAnteriorClonado = (origen.contacto_nombre || '').split(/\s+/)[0] || null;

            const tituloModal = document.getElementById('crm-modal-titulo');
            if (tituloModal) {
                tituloModal.textContent = `👥 Compartir Propuesta con Cliente Similar (Base: ${origen.contacto_nombre})`;
            }

            document.getElementById('crm-fecha-input').value = origen.fecha_programada || new Date().toLocaleDateString('en-CA');
            document.getElementById('crm-hora-input').value = origen.hora_programada || '09:00';
            document.getElementById('crm-nota-input').value = origen.nota_interna || `Propuesta compartida (similar a ${origen.cliente_nombre})`;
            generarShortcutsDias(document.getElementById('crm-fecha-input').value);

            let cods = origen.articulos_codigos;
            if (typeof cods === 'string') {
                try { cods = JSON.parse(cods); } catch (e) { cods = []; }
            }
            if (Array.isArray(cods) && cods.length > 0) {
                armadorSeleccionadosSet = new Set(cods);
                window.renderListaArticulosArmador();
                window.toggleArmadorDinamicoWa(true);
            }

            let msgs = origen.mensajes;
            if (typeof msgs === 'string') {
                try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
            }
            const bubblesContainer = document.getElementById('crm-bubbles-container');
            bubblesContainer.innerHTML = '';
            (Array.isArray(msgs) ? msgs : [msgs]).forEach(m => window.agregarBurbujaMensaje(m));

            const searchInput = document.getElementById('crm-cliente-search');
            if (searchInput) {
                searchInput.value = '';
                searchInput.placeholder = '👉 Elegí acá al otro cliente similar para adaptar saludo y precios...';
                setTimeout(() => searchInput.focus(), 150);
            }
        } catch (err) {
            console.error('Error compartiendo seguimiento:', err);
        }
    };

    window.cerrarModalProgramarWhatsApp = function () {
        const modal = document.getElementById('modal-programar-whatsapp');
        if (modal) modal.style.display = 'none';
        seguimientoEnEdicionId = null;
        contactoAnteriorClonado = null;
    };

    function getProximoLunesOMartes() {
        const d = new Date();
        const day = d.getDay();
        if (day === 0) d.setDate(d.getDate() + 1); // Domingo -> Lunes
        else if (day === 6) d.setDate(d.getDate() + 2); // Sábado -> Lunes
        return d.toLocaleDateString('en-CA');
    }

    window.cargarClientesCrm = async function () {
        if (clientesCrmCache.length > 0) return;
        try {
            const res = await fetch('/api/crm/clientes');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                clientesCrmCache = data.data;
                window.renderizarOpcionesClientes(clientesCrmCache);
            }
        } catch (err) {
            console.error('Error cargando clientes CRM:', err);
        }
    };

    window.renderizarOpcionesClientes = function (lista) {
        const select = document.getElementById('crm-cliente-select');
        if (!select) return;
        select.innerHTML = '<option value="">-- Seleccionar Cliente Búnker --</option>';
        lista.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.cliente_nombre} (${c.codigo_bunker_cliente || 'Sin código'}) — [${c.lista_asignada_nombre || 'Dietetica'}]`;
            select.appendChild(opt);
        });
    };

    window.filtrarClientesCrm = function (query) {
        if (!Array.isArray(clientesCrmCache)) return;
        const q = String(query || '').trim().toLowerCase();

        if (!q) {
            window.renderizarOpcionesClientes(clientesCrmCache);
            return;
        }

        const tokens = q.split(/\s+/).filter(t => t.length > 0);
        const filtrados = clientesCrmCache.filter(c => {
            const bolsa = `${c.cliente_nombre || ''} ${c.razon_social || ''} ${c.codigo_bunker_cliente || ''} ${c.lomas_soft_id || ''} ${c.lista_asignada_nombre || ''}`.toLowerCase();
            return tokens.every(token => bolsa.includes(token));
        });

        window.renderizarOpcionesClientes(filtrados);

        const select = document.getElementById('crm-cliente-select');
        if (filtrados.length === 1 && select) {
            select.value = filtrados[0].id;
            window.onCrmClienteSeleccionado();
        }
    };

    window.onCrmClienteSeleccionado = async function () {
        const clienteId = document.getElementById('crm-cliente-select').value;
        const contactoSelect = document.getElementById('crm-contacto-select');
        const telInput = document.getElementById('crm-telefono-input');
        const nombreInput = document.getElementById('crm-contacto-nombre-input');
        const badgeLista = document.getElementById('crm-cliente-lista-badge');

        contactoSelect.innerHTML = '';

        if (!clienteId) {
            contactoSelect.innerHTML = '<option value="">Primero seleccione un cliente...</option>';
            contactoSelect.disabled = true;
            if (badgeLista) badgeLista.style.display = 'none';
            return;
        }

        const cliente = clientesCrmCache.find(c => String(c.id) === String(clienteId));
        if (!cliente) return;

        // Sincronizar lista de precios del cliente con el Armador Dinámico
        const listaClienteId = cliente.lista_asignada_id || 5;
        const listaClienteNombre = cliente.lista_asignada_nombre || 'Dietetica';
        const armadorListaSel = document.getElementById('crm-armador-lista-select');
        if (armadorListaSel) {
            armadorListaSel.value = String(listaClienteId);
            window.renderListaArticulosArmador();
        }

        if (badgeLista) {
            badgeLista.style.display = 'flex';
            badgeLista.innerHTML = `
                <span>📋 Lista asignada a <strong>${cliente.cliente_nombre}</strong>: <strong>${listaClienteNombre}</strong></span>
                <button type="button" onclick="window.toggleArmadorDinamicoWa(true); window.volcarPropuestaEnBurbujasWa();" style="background:#16a34a; color:white; border:none; border-radius:5px; padding:2px 8px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                    ✨ Armar / Actualizar oferta con su lista
                </button>
            `;
        }

        let contactos = [];
        if (cliente.whatsapp_facturas) {
            try {
                contactos = typeof cliente.whatsapp_facturas === 'string'
                    ? JSON.parse(cliente.whatsapp_facturas)
                    : cliente.whatsapp_facturas;
            } catch (e) {
                contactos = [];
            }
        }

        contactoSelect.disabled = false;
        contactoSelect.innerHTML = '<option value="">-- Seleccionar Contacto Registrado --</option>';

        if (Array.isArray(contactos) && contactos.length > 0) {
            contactos.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ nombre: c.nombre || 'Contacto', numero: c.numero || '' });
                opt.textContent = `👤 ${c.nombre || 'Contacto'} (${c.cargo || 'Responsable'}) - ${c.numero}`;
                contactoSelect.appendChild(opt);
            });
        }

        const optManual = document.createElement('option');
        optManual.value = 'MANUAL';
        optManual.textContent = '✏️ Ingresar número manualmente...';
        contactoSelect.appendChild(optManual);

        // Priorizar contacto titular / difusión / default antes que el contacto administrativo de facturas
        const defaultCont = contactos.find(c => c.default_difusion === true)
            || contactos.find(c => c.default === true)
            || contactos.find(c => c.default_factura === true)
            || contactos[0];

        if (defaultCont) {
            contactoSelect.value = JSON.stringify({ nombre: defaultCont.nombre || 'Contacto', numero: defaultCont.numero || '' });
            telInput.value = defaultCont.numero || '';
            nombreInput.value = defaultCont.nombre || '';
        }

        // Si venimos de "Compartir con otro cliente", adaptar automáticamente el saludo y los precios de la lista
        if (!seguimientoEnEdicionId && armadorSeleccionadosSet.size > 0) {
            const textareas = document.querySelectorAll('#crm-bubbles-container .crm-bubble-textarea');
            const hayTextoPrevio = Array.from(textareas).some(t => t.value.trim().length > 0);
            if (hayTextoPrevio && contactoAnteriorClonado) {
                window.volcarPropuestaEnBurbujasWa();
                contactoAnteriorClonado = (nombreInput.value || '').split(/\s+/)[0] || null;
            }
        }
    };

    window.onCrmContactoSeleccionado = function () {
        const val = document.getElementById('crm-contacto-select').value;
        const telInput = document.getElementById('crm-telefono-input');
        const nombreInput = document.getElementById('crm-contacto-nombre-input');

        if (!val || val === 'MANUAL') {
            telInput.value = '';
            nombreInput.value = '';
            telInput.focus();
            return;
        }

        try {
            const parsed = JSON.parse(val);
            telInput.value = parsed.numero || '';
            nombreInput.value = parsed.nombre || '';
        } catch (e) {}
    };

    window.agregarBurbujaMensaje = function (texto = '') {
        const container = document.getElementById('crm-bubbles-container');
        if (!container) return;

        const count = container.children.length + 1;
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'crm-bubble-item';
        bubbleDiv.innerHTML = `
            <div class="crm-bubble-header">
                <span class="crm-bubble-tag">💬 Burbuja #${count}</span>
                ${count > 1 ? '<button type="button" class="btn-bubble-del" onclick="window.eliminarBurbujaMensaje(this)" title="Eliminar burbuja">🗑️</button>' : ''}
            </div>
            <textarea class="crm-bubble-textarea" placeholder="Escribí el mensaje aquí...">${texto}</textarea>
        `;
        container.appendChild(bubbleDiv);
    };

    window.eliminarBurbujaMensaje = function (btn) {
        const item = btn.closest('.crm-bubble-item');
        if (item) {
            item.remove();
            const container = document.getElementById('crm-bubbles-container');
            const tags = container.querySelectorAll('.crm-bubble-tag');
            tags.forEach((t, i) => t.textContent = `💬 Burbuja #${i + 1}`);
        }
    };

    window.dividirTextoEnMensajitos = function (textoRaw) {
        const texto = String(textoRaw || '').trim();
        if (!texto) return [];

        const bloquesBase = texto.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);
        const resultado = [];

        bloquesBase.forEach(bloque => {
            const lineas = bloque.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lineas.length > 1 && /^(¡?hola|buen\s+d[ií]a|buenas)\b/i.test(lineas[0]) && lineas[0].length <= 75) {
                resultado.push(lineas[0]);
                resultado.push(lineas.slice(1).join('\n'));
            } else {
                resultado.push(bloque);
            }
        });

        if (resultado.length === 1 && resultado[0].length > 180) {
            const unico = resultado[0];
            const partesOracion = unico.split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚ¡¿•])/);
            if (partesOracion.length >= 3) {
                return [
                    partesOracion[0].trim(),
                    partesOracion.slice(1, -1).join(' ').trim(),
                    partesOracion[partesOracion.length - 1].trim()
                ].filter(Boolean);
            }
        }

        return resultado;
    };

    window.dividirBurbujasEnModal = function () {
        const container = document.getElementById('crm-bubbles-container');
        if (!container) return;
        const textareas = container.querySelectorAll('.crm-bubble-textarea');
        const textosActuales = Array.from(textareas).map(t => t.value.trim()).filter(Boolean);
        if (textosActuales.length === 0) {
            Swal.fire('Atención', 'Escribí primero el mensaje para poder dividirlo en partes.', 'info');
            return;
        }

        const nuevasBurbujas = [];
        textosActuales.forEach(t => {
            const partes = window.dividirTextoEnMensajitos(t);
            partes.forEach(p => nuevasBurbujas.push(p));
        });

        if (nuevasBurbujas.length <= textosActuales.length) {
            window.agregarBurbujaMensaje('');
            return;
        }

        container.innerHTML = '';
        nuevasBurbujas.forEach(b => window.agregarBurbujaMensaje(b));
    };

    window.guardarProgramacionWhatsApp = async function () {
        const clienteSelect = document.getElementById('crm-cliente-select');
        const clienteId = clienteSelect.value;
        const clienteNombre = clienteSelect.options[clienteSelect.selectedIndex]?.text.split('(')[0].trim() || 'Cliente';
        const contactoNombre = document.getElementById('crm-contacto-nombre-input').value.trim() || 'Cliente';
        const telefono = document.getElementById('crm-telefono-input').value.trim();
        const fecha = document.getElementById('crm-fecha-input').value;
        const hora = document.getElementById('crm-hora-input').value || '09:00';
        const nota = document.getElementById('crm-nota-input').value.trim();
        const plantillaId = document.getElementById('crm-armador-plantilla-select')?.value || null;

        const textareas = document.querySelectorAll('.crm-bubble-textarea');
        const mensajes = Array.from(textareas).map(t => t.value.trim()).filter(t => t.length > 0);

        if (!telefono) {
            Swal.fire('Atención', 'Por favor ingresá un número de teléfono de destino.', 'warning');
            return;
        }

        if (!fecha) {
            Swal.fire('Atención', 'Por favor seleccioná la fecha de envío.', 'warning');
            return;
        }

        if (mensajes.length === 0) {
            Swal.fire('Atención', 'Por favor redactá o generá al menos un mensaje de WhatsApp.', 'warning');
            return;
        }

        const payload = {
            bunker_cliente_id: clienteId ? parseInt(clienteId, 10) : null,
            cliente_nombre: clienteNombre,
            contacto_nombre: contactoNombre,
            telefono_destino: telefono,
            fecha_programada: fecha,
            hora_programada: hora,
            mensajes: mensajes,
            nota_interna: nota,
            plantilla_id: plantillaId ? parseInt(plantillaId, 10) : null,
            articulos_codigos: Array.from(armadorSeleccionadosSet)
        };

        try {
            let res;
            if (seguimientoEnEdicionId) {
                res = await fetch(`/api/crm/seguimientos/${seguimientoEnEdicionId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch('/api/crm/seguimientos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }

            const data = await res.json();
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Programado!',
                    text: `El recordatorio para ${contactoNombre} aparecerá el ${fecha} a las ${hora} hs.`,
                    timer: 2500,
                    showConfirmButton: false
                });
                window.cerrarModalProgramarWhatsApp();
                if (typeof window.actualizarAlertasPizarra === 'function') {
                    window.actualizarAlertasPizarra();
                }
                if (typeof window.recargarMonitorPage === 'function') {
                    window.recargarMonitorPage();
                }
            } else {
                throw new Error(data.error || 'Error al guardar');
            }
        } catch (err) {
            console.error('Error al guardar seguimiento:', err);
            Swal.fire('Error', err.message || 'No se pudo guardar la programación', 'error');
        }
    };

    // =========================================================================
    // 4. MONITOR DE SEGUIMIENTOS Y WIDGET DE PIZARRA
    // =========================================================================

    window.filtrarMonitorTab = function (btn, estado) {
        filtroMonitorEstado = estado;
        const btns = document.querySelectorAll('.crm-monitor-filter-btn');
        btns.forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        window.cargarMonitorSeguimientos(estado);
    };

    window.cargarMonitorSeguimientos = async function (filtroEstado = null) {
        if (filtroEstado) filtroMonitorEstado = filtroEstado;
        const container = document.getElementById('crm-monitor-lista');
        if (!container) return;

        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">⏳ Cargando seguimientos...</div>';

        try {
            const res = await fetch('/api/crm/seguimientos/resumen');
            const data = await res.json();

            if (!data.success || !Array.isArray(data.todos)) {
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">No hay seguimientos registrados.</div>';
                return;
            }

            let items = data.todos;
            if (filtroMonitorEstado !== 'TODOS') {
                items = items.filter(s => s.estado === filtroMonitorEstado);
            }

            const badge = document.getElementById('crm-badge-total-programados');
            const activosCount = data.todos.filter(s => s.estado === 'PENDIENTE').length;
            if (badge) badge.textContent = activosCount;

            if (items.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px; color: #64748b;">
                        <p style="font-size: 1.5rem; margin-bottom: 8px;">📭</p>
                        <p>No hay seguimientos para mostrar con el filtro actual (<strong>${filtroMonitorEstado}</strong>).</p>
                    </div>
                `;
                return;
            }

            let html = '';
            items.forEach(seg => {
                let msgs = seg.mensajes;
                if (typeof msgs === 'string') {
                    try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
                }
                if (!Array.isArray(msgs)) msgs = [msgs];

                const esPendiente = seg.estado === 'PENDIENTE';
                const esEnviado = seg.estado === 'ENVIADO';

                const badgeEstado = esPendiente
                    ? '<span class="crm-monitor-badge pendiente">🟡 PENDIENTE</span>'
                    : esEnviado
                        ? `<span class="crm-monitor-badge enviado">🟢 ENVIADO</span>`
                        : '<span class="crm-monitor-badge cancelado">⚪ CANCELADO</span>';

                html += `
                    <div class="crm-monitor-card ${seg.estado.toLowerCase()}">
                        <div class="crm-monitor-card-header">
                            <div>
                                <strong style="font-size: 1rem; color: #1e293b;">${seg.cliente_nombre}</strong>
                                <span style="color: #475569; font-size: 0.9rem;">— ${seg.contacto_nombre} (<code>${seg.telefono_destino}</code>)</span>
                            </div>
                            <div>${badgeEstado}</div>
                        </div>

                        <div class="crm-monitor-fecha-hora">
                            📅 <strong>Programado:</strong> ${seg.fecha_programada} a las ${seg.hora_programada || '09:00'} hs
                            ${seg.enviado_at ? `<span style="color: #15803d; margin-left: 10px;">(Enviado: ${new Date(seg.enviado_at).toLocaleTimeString()})</span>` : ''}
                        </div>

                        ${seg.nota_interna ? `<div class="crm-monitor-nota">📝 <strong>Estrategia:</strong> ${seg.nota_interna}</div>` : ''}

                        <div class="crm-monitor-bubbles">
                            ${msgs.map((m, idx) => `
                                <div class="crm-monitor-bubble" style="white-space: pre-wrap;">
                                    <span style="font-weight: 700; color: #15803d; font-size: 0.78rem;">Burbuja #${idx + 1}:</span> ${m}
                                </div>
                            `).join('')}
                        </div>

                        <div class="crm-monitor-actions">
                            ${esPendiente ? `
                                <button type="button" class="btn-crm-enviar" onclick="window.enviarSeguimientoWhatsApp(${seg.id})">
                                    🚀 Enviar Ahora
                                </button>
                                <button type="button" class="btn-crm-action" style="background:#eff6ff;color:#1d4ed8;border-color:#93c5fd;font-weight:700;" onclick="window.enviarPruebaSeguimientoWhatsApp(${seg.id})" title="Enviar prueba a mi propio WhatsApp (221 661 5746) sin marcar como enviado">
                                    🧪 Prueba (221 661 5746)
                                </button>
                                <button type="button" class="btn-crm-action" style="background:#f0fdf4;color:#15803d;border-color:#86efac;font-weight:700;" onclick="window.compartirSeguimientoConOtroCliente(${seg.id})" title="Reutilizar esta oferta para otro cliente similar (adapta nombre y precios)">
                                    👥 Compartir con otro cliente
                                </button>
                                <button type="button" class="btn-crm-action" onclick="window.abrirModalProgramarWhatsApp(${seg.id})">
                                    ✏️ Editar
                                </button>
                                <button type="button" class="btn-crm-action" onclick="window.posponerSeguimientoWhatsApp(${seg.id}, 1)">
                                    ⏳ +24h
                                </button>
                                <button type="button" class="btn-crm-action btn-crm-dismiss" onclick="window.desestimarSeguimientoWhatsApp(${seg.id})">
                                    🗑️ Desestimar
                                </button>
                            ` : `
                                <span style="font-size: 0.8rem; color: #64748b;">Completado</span>
                                <button type="button" class="btn-crm-action" style="background:#f0fdf4;color:#15803d;border-color:#86efac;font-weight:700;" onclick="window.compartirSeguimientoConOtroCliente(${seg.id})">
                                    👥 Compartir con otro cliente
                                </button>
                                <button type="button" class="btn-crm-action" style="background:#eff6ff;color:#1d4ed8;border-color:#93c5fd;" onclick="window.enviarPruebaSeguimientoWhatsApp(${seg.id})">
                                    🧪 Enviar Prueba
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;

        } catch (err) {
            console.error('Error cargando monitor:', err);
            container.innerHTML = '<div style="color: red; padding: 20px;">Error al cargar seguimientos.</div>';
        }
    };

    window.actualizarBadgeProgramados = async function () {
        try {
            const res = await fetch('/api/crm/seguimientos/resumen');
            const data = await res.json();
            if (data.success && Array.isArray(data.todos)) {
                const count = data.todos.filter(s => s.estado === 'PENDIENTE').length;
                const badge = document.getElementById('crm-badge-total-programados');
                if (badge) badge.textContent = count;
            }
        } catch (e) {}
    };

    window.consultarSeguimientosResumen = async function () {
        try {
            const res = await fetch('/api/crm/seguimientos/resumen');
            if (!res.ok) return { hoy: [], proximos: [] };
            const data = await res.json();
            return {
                hoy: data.hoy || [],
                proximos: data.proximos || []
            };
        } catch (e) {
            console.warn('⚠️ Error consultando resumen CRM:', e.message);
            return { hoy: [], proximos: [] };
        }
    };

    window.toggleAcordeonSeguimientosPizarra = function () {
        window.pizarraSeguimientosWaExpandido = !Boolean(window.pizarraSeguimientosWaExpandido);
        const bodyEl = document.getElementById('pizarra-crm-seg-acordeon-body');
        const chevEl = document.getElementById('pizarra-crm-seg-acordeon-chevron');
        if (bodyEl) {
            bodyEl.style.display = window.pizarraSeguimientosWaExpandido ? 'block' : 'none';
        }
        if (chevEl) {
            chevEl.textContent = window.pizarraSeguimientosWaExpandido ? '▼' : '▶';
        }
    };

    window.construirHtmlSeguimientosPizarra = function (resumenCrm) {
        const hoy = resumenCrm.hoy || [];
        if (!hoy || hoy.length === 0) return '';

        const estaExpandido = Boolean(window.pizarraSeguimientosWaExpandido);
        const ahora = new Date();
        const horaActualStr = ahora.toTimeString().substring(0, 5);

        const resumenClientes = hoy.slice(0, 3).map(seg => {
            const nom = seg.cliente_nombre || seg.contacto_nombre || 'Cliente';
            const hora = seg.hora_programada || '09:00';
            return `${nom} (${hora} hs)`;
        }).join(', ');
        const extraCount = hoy.length - 3;
        const textoResumenInline = extraCount > 0 ? `${resumenClientes} (+${extraCount} más)` : resumenClientes;

        let html = `
            <div class="pizarra-crm-seg-accordion-box" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #86efac; border-left: 5px solid #16a34a; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; box-shadow: 0 2px 6px rgba(22, 163, 74, 0.08);">
                <div onclick="window.toggleAcordeonSeguimientosPizarra()" title="Click para desplegar o plegar los seguimientos programados para hoy" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; color: #14532d; font-size: 0.9rem; flex: 1; min-width: 0;">
                        <span id="pizarra-crm-seg-acordeon-chevron" style="font-size: 0.78rem; color: #15803d; width: 12px; display: inline-block;">${estaExpandido ? '▼' : '▶'}</span>
                        <span style="white-space: nowrap;">🟢 Seguimientos Comerciales WhatsApp (Hoy)</span>
                        <span style="background: #16a34a; color: #fff; font-size: 0.74rem; font-weight: 800; padding: 1px 7px; border-radius: 10px; flex-shrink: 0;">${hoy.length}</span>
                        <span style="font-size: 0.78rem; font-weight: 600; color: #166534; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 440px;">— ${textoResumenInline}</span>
                    </div>
                    <div style="display: flex; gap: 6px; flex-shrink: 0;" onclick="event.stopPropagation();">
                        <button type="button" class="btn-pizarra-mini-nuevo-wa" onclick="window.abrirModalProgramarWhatsApp()" title="Nuevo Recordatorio" style="margin: 0;">➕ Programar otro</button>
                    </div>
                </div>
                <div id="pizarra-crm-seg-acordeon-body" style="display: ${estaExpandido ? 'block' : 'none'}; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(22, 163, 74, 0.2);">
        `;

        hoy.forEach(seg => {
            let msgs = seg.mensajes;
            if (typeof msgs === 'string') {
                try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
            }
            if (!Array.isArray(msgs)) msgs = [msgs];

            const horaProg = seg.hora_programada || '09:00';
            const esHoraAlcanzada = horaActualStr >= horaProg;

            const badgeHora = esHoraAlcanzada
                ? `<span class="crm-badge-hora reached">🔔 ¡Listo para enviar! (${horaProg} hs)</span>`
                : `<span class="crm-badge-hora scheduled">⏰ Programado: ${horaProg} hs</span>`;

            html += `
                <div class="pizarra-crm-card" id="crm-card-${seg.id}" style="margin-bottom: 6px;">
                    <div class="pizarra-crm-header">
                        <div class="pizarra-crm-title-area">
                            <span class="pizarra-crm-icon">📱</span>
                            <strong>${seg.cliente_nombre}</strong>
                            <span class="pizarra-crm-contacto">— ${seg.contacto_nombre} (${seg.telefono_destino})</span>
                        </div>
                        <div class="pizarra-crm-badge-area">
                            ${badgeHora}
                        </div>
                    </div>

                    ${seg.nota_interna ? `<div class="pizarra-crm-nota">📝 <strong>Estrategia:</strong> ${seg.nota_interna}</div>` : ''}

                    <div class="pizarra-crm-bubbles-preview">
                        ${msgs.map((m, idx) => `
                            <div class="pizarra-crm-bubble" style="white-space: pre-wrap;">
                                <span class="pizarra-crm-bubble-idx">💬 [${idx + 1}/${msgs.length}]</span>
                                <span>${m}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div class="pizarra-crm-actions">
                        <button type="button" class="btn-crm-enviar" onclick="window.enviarSeguimientoWhatsApp(${seg.id})">
                            🚀 Enviar WhatsApp Ahora (1 clic)
                        </button>
                        <button type="button" class="btn-crm-action" style="background:#eff6ff;color:#1d4ed8;border-color:#93c5fd;font-weight:700;" onclick="window.enviarPruebaSeguimientoWhatsApp(${seg.id})" title="Enviar prueba a mi propio WhatsApp (221 661 5746)">
                            🧪 Prueba
                        </button>
                        <button type="button" class="btn-crm-action" style="background:#f0fdf4;color:#15803d;border-color:#86efac;font-weight:700;" onclick="window.compartirSeguimientoConOtroCliente(${seg.id})" title="Compartir o programar esta misma oferta para otro cliente similar">
                            👥 Compartir con otro
                        </button>
                        <button type="button" class="btn-crm-action btn-crm-edit" onclick="window.abrirModalProgramarWhatsApp(${seg.id})" title="Editar texto, dividir en mensajitos o cambiar hora">
                            ✏️ Editar
                        </button>
                        <button type="button" class="btn-crm-action btn-crm-snooze" onclick="window.posponerSeguimientoWhatsApp(${seg.id}, 1)" title="Posponer para mañana (+24h)">
                            ⏳ +24h
                        </button>
                        <button type="button" class="btn-crm-action btn-crm-dismiss" onclick="window.desestimarSeguimientoWhatsApp(${seg.id})" title="Desestimar / Cancelar">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        return html;
    };

    window.enviarSeguimientoWhatsApp = async function (id) {
        try {
            const resList = await fetch('/api/crm/seguimientos/resumen');
            const dataList = await resList.json();
            const item = (dataList.todos || []).find(s => s.id === id);

            if (!item) {
                Swal.fire('Error', 'No se encontró el seguimiento a enviar.', 'error');
                return;
            }

            let msgs = item.mensajes;
            if (typeof msgs === 'string') {
                try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
            }
            if (!Array.isArray(msgs)) msgs = [msgs];

            const result = await Swal.fire({
                title: '¿Enviar WhatsApp ahora?',
                html: `
                    <div style="text-align: left; font-size: 0.92rem;">
                        <p><strong>Destinatario:</strong> ${item.contacto_nombre} (<code>${item.telefono_destino}</code>)</p>
                        <p><strong>Cliente:</strong> ${item.cliente_nombre}</p>
                        <p style="margin-top: 10px;"><strong>Mensajes a despachar (${msgs.length}):</strong></p>
                        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; max-height: 200px; overflow-y: auto;">
                            ${msgs.map((m, idx) => `<p style="margin: 4px 0; color: #166534; white-space: pre-wrap;"><strong>💬 ${idx + 1}:</strong> "${m}"</p>`).join('')}
                        </div>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#25D366',
                cancelButtonColor: '#64748b',
                confirmButtonText: '🚀 Sí, Enviar WhatsApp',
                cancelButtonText: 'Cancelar'
            });

            if (!result.isConfirmed) return;

            Swal.fire({
                title: 'Enviando WhatsApp...',
                text: 'Despachando mensaje(s) a través de la sesión de WhatsApp Web...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const resSend = await fetch(`/api/crm/seguimientos/${id}/enviar`, {
                method: 'POST'
            });

            const dataSend = await resSend.json();

            if (dataSend.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Enviado con éxito!',
                    text: `El mensaje fue entregado a ${item.contacto_nombre}.`,
                    timer: 2500,
                    showConfirmButton: false
                });

                if (typeof window.actualizarAlertasPizarra === 'function') {
                    window.actualizarAlertasPizarra();
                }
                if (tabActiva === 'monitor') {
                    window.cargarMonitorSeguimientos();
                }
            } else {
                throw new Error(dataSend.error || dataSend.message || 'Error al enviar');
            }

        } catch (err) {
            console.error('Error al enviar WhatsApp:', err);
            Swal.fire('Error de Envío', err.message || 'No se pudo despachar el mensaje por WhatsApp. Verificá que la sesión de WhatsApp esté conectada.', 'error');
        }
    };

    window.enviarPruebaSeguimientoWhatsApp = async function (id) {
        try {
            const resList = await fetch('/api/crm/seguimientos/resumen');
            const dataList = await resList.json();
            const item = (dataList.todos || []).find(s => s.id === id);

            if (!item) {
                Swal.fire('Error', 'No se encontró el seguimiento para probar.', 'error');
                return;
            }

            let msgs = item.mensajes;
            if (typeof msgs === 'string') {
                try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
            }
            if (!Array.isArray(msgs)) msgs = [msgs];

            const result = await Swal.fire({
                title: '🧪 Enviar Prueba a mi WhatsApp',
                html: `
                    <div style="text-align: left; font-size: 0.9rem;">
                        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px; margin-bottom: 10px; color: #1e3a8a;">
                            📱 <strong>Destino de prueba:</strong> <code>221 661 5746</code> (Tu propio WhatsApp)<br>
                            <span style="font-size: 0.8rem; color: #3b82f6;">El seguimiento de <strong>${item.cliente_nombre}</strong> seguirá en estado <strong>🟡 PENDIENTE</strong> para enviarse en su fecha programada.</span>
                        </div>
                        <p style="margin: 6px 0; font-weight: 700; color: #334155;">Mensajitos que vas a recibir (${msgs.length} ${msgs.length === 1 ? 'burbuja' : 'burbujas en secuencia'}):</p>
                        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; max-height: 220px; overflow-y: auto;">
                            ${msgs.map((m, idx) => `<div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #bbf7d0; color: #166534; white-space: pre-wrap;"><strong>💬 Parte #${idx + 1}:</strong>\n${m}</div>`).join('')}
                        </div>
                    </div>
                `,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#2563eb',
                cancelButtonColor: '#64748b',
                confirmButtonText: '🧪 Enviar Prueba al 221 661 5746',
                cancelButtonText: 'Cancelar'
            });

            if (!result.isConfirmed) return;

            Swal.fire({
                title: 'Enviando Prueba...',
                text: `Despachando ${msgs.length} mensajito(s) al 221 661 5746...`,
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const resTest = await fetch(`/api/crm/seguimientos/${id}/enviar-prueba`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telefono_prueba: '5492216615746' })
            });
            const dataTest = await resTest.json();

            if (dataTest.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Prueba enviada a tu WhatsApp!',
                    html: `Se enviaron <strong>${dataTest.burbujas_enviadas} mensajito(s)</strong> al <code>221 661 5746</code>.<br><small style="color:#64748b;">El envío real para ${item.cliente_nombre} sigue reservado como PENDIENTE.</small>`,
                    timer: 3200,
                    showConfirmButton: false
                });
            } else {
                throw new Error(dataTest.error || 'No se pudo enviar la prueba');
            }
        } catch (err) {
            console.error('Error en prueba WhatsApp:', err);
            Swal.fire('Error en Envío de Prueba', err.message || 'Verificá que WhatsApp esté conectado.', 'error');
        }
    };

    window.enviarPruebaDesdeModalProgramador = async function () {
        const textareas = document.querySelectorAll('#crm-bubbles-container .crm-bubble-textarea');
        const mensajes = Array.from(textareas).map(t => t.value.trim()).filter(t => t.length > 0);

        if (mensajes.length === 0) {
            Swal.fire('Atención', 'Redactá al menos una burbuja de mensaje para enviar la prueba.', 'warning');
            return;
        }

        try {
            Swal.fire({
                title: 'Enviando Prueba al 221 661 5746...',
                text: `Despachando ${mensajes.length} mensajito(s) en secuencia a tu WhatsApp...`,
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const res = await fetch('/api/crm/seguimientos/enviar-prueba-directa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telefono_prueba: '5492216615746',
                    mensajes
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error enviando prueba');

            Swal.fire({
                icon: 'success',
                title: '🧪 ¡Prueba enviada!',
                text: `Recibiste ${mensajes.length} mensajito(s) en el 221 661 5746 tal como los verá el cliente.`,
                timer: 2800,
                showConfirmButton: false
            });
        } catch (err) {
            Swal.fire('Error', err.message || 'No se pudo enviar la prueba', 'error');
        }
    };

    window.posponerSeguimientoWhatsApp = async function (id, dias = 1) {
        try {
            const res = await fetch(`/api/crm/seguimientos/${id}/posponer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dias })
            });
            const data = await res.json();
            if (data.success) {
                Swal.fire({
                    icon: 'info',
                    title: 'Pospuesto',
                    text: `El seguimiento se reprogramó.`,
                    timer: 2000,
                    showConfirmButton: false
                });
                if (typeof window.actualizarAlertasPizarra === 'function') {
                    window.actualizarAlertasPizarra();
                }
                if (tabActiva === 'monitor') {
                    window.cargarMonitorSeguimientos();
                }
            }
        } catch (err) {
            console.error('Error posponiendo:', err);
        }
    };

    window.desestimarSeguimientoWhatsApp = async function (id) {
        const result = await Swal.fire({
            title: '¿Desestimar recordatorio?',
            text: 'Este seguimiento se cancelará y no volverá a aparecer en la Pizarra.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, desestimar',
            cancelButtonText: 'Conservar'
        });

        if (!result.isConfirmed) return;

        try {
            const res = await fetch(`/api/crm/seguimientos/${id}/desestimar`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                if (typeof window.actualizarAlertasPizarra === 'function') {
                    window.actualizarAlertasPizarra();
                }
                if (tabActiva === 'monitor') {
                    window.cargarMonitorSeguimientos();
                }
            }
        } catch (err) {
            console.error('Error desestimando:', err);
        }
    };

})();
